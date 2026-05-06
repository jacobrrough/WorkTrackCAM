import { spawnBounded } from './subprocess-bounded'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CURA_SLICE_CLI_DEFAULTS,
  curaCliParamsToEngineSettingsMap,
  mergeFdmCapabilitiesUnder,
  resolveCuraSliceParams,
  type CuraSliceCliParams,
  type FdmCapabilityFields
} from '../shared/cura-slice-defaults'
import { getResourcesRoot } from './paths'
import {
  resolveBundledCuraDefinitionsPath,
  resolveBundledCuraEnginePath
} from './cura-bundled-paths'
import {
  k2PlusPresetToEngineSettingsMap,
  resolveK2PlusPreset,
  type K2PlusQualityPresetId
} from '../shared/k2-plus-slice-presets'

export type SliceRequest = {
  /**
   * Explicit user-supplied CuraEngine binary path. When empty / undefined,
   * `sliceWithCuraEngine` falls back to the bundled binary resolved via
   * `resolveBundledCuraEnginePath` (Phase 2 [P2-K2-SLICE]/Cycle 2 -- Jacob
   * approved Option A on 2026-05-05). The user-supplied path always wins
   * when set, so the bundled binary is the default, NOT the only option.
   */
  curaEnginePath?: string
  inputStlPath: string
  outputGcodePath: string
  /** Optional override for machine definition JSON */
  definitionPath?: string
  /** Folder containing fdmprinter.def.json (sets CURA_ENGINE_SEARCH_PATH) */
  curaDefinitionsPath?: string
  /** Named Cura `-s` bundle; see `cura-slice-defaults.ts` */
  slicePreset?: string | null
  /**
   * Full merged Cura `-s` map (Cura setting id -> value). When non-empty, used instead of
   * rebuilding from `slicePreset` alone.
   */
  curaEngineSettings?: Record<string, string>
  /**
   * Optional FDM capability subset of the active `MachineProfile`.
   * When supplied, the K2 Plus hard ceilings (maxNozzleTempC /
   * maxBedTempC / chamberTempC) are merged UNDER the preset/profile
   * settings so explicit job-level overrides always win. See
   * `fdmCapabilitiesToEngineSettings` in `cura-slice-defaults.ts`.
   * Roadmap: [ID-0068] (follow-up to [ID-0012]).
   */
  machineCapabilities?: FdmCapabilityFields
  /**
   * K2 Plus quality preset id ('standard' or 'high_speed'). When set
   * AND `curaEngineSettings` is empty/unset, the K2 preset's settings
   * are used as the base map for the engine. Layers UNDER explicit
   * `curaEngineSettings` and OVER the generic `slicePreset` baseline.
   * Roadmap: [P2-K2-SLICE]/Cycle 5.
   */
  k2QualityPresetId?: K2PlusQualityPresetId
  /**
   * Active filament print settings. When supplied, layered OVER the
   * quality preset and UNDER explicit curaEngineSettings overrides.
   * Merge chain: machine ceilings < quality preset < filament < user overrides.
   */
  filamentSettings?: {
    nozzleTempC: number
    bedTempC: number
    chamberTempC?: number
    fanSpeedPercent: number
    fanSpeedFirstLayerPercent?: number
    retractionMm?: number
    retractionSpeedMmPerSec?: number
  }
}

const CURA_OUTPUT_MAX_BYTES = 12 * 1024 * 1024
const CURA_TIMEOUT_MS = 900_000

async function runProcess(
  cmd: string,
  args: string[],
  cwd?: string,
  extraEnv?: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await spawnBounded(cmd, args, {
      cwd,
      env: extraEnv,
      timeoutMs: CURA_TIMEOUT_MS,
      maxBufferBytes: CURA_OUTPUT_MAX_BYTES
    })
    return { code: r.code ?? 1, stdout: r.stdout, stderr: r.stderr }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { code: 1, stdout: '', stderr: msg }
  }
}

/** Pure helper: `-s` list from a merged Cura settings map. */
export function buildCuraSliceArgsFromSettingsMap(
  resourcesRoot: string,
  req: Pick<SliceRequest, 'definitionPath' | 'inputStlPath' | 'outputGcodePath'>,
  settings: Map<string, string>
): string[] {
  const defPath = req.definitionPath ?? join(resourcesRoot, 'slicer', 'creality_k2_plus.def.json')
  const flags = [...settings.entries()].flatMap(([k, v]) => ['-s', `${k}=${v}`])
  return ['slice', '-v', '-j', defPath, ...flags, '-l', req.inputStlPath, '-o', req.outputGcodePath]
}

/** Pure helper for tests and CLI construction. */
export function buildCuraSliceArgs(
  resourcesRoot: string,
  req: Pick<SliceRequest, 'definitionPath' | 'inputStlPath' | 'outputGcodePath'>,
  sliceParams?: CuraSliceCliParams
): string[] {
  const d = sliceParams ?? CURA_SLICE_CLI_DEFAULTS
  return buildCuraSliceArgsFromSettingsMap(resourcesRoot, req, curaCliParamsToEngineSettingsMap(d))
}

/**
 * Pure helper that walks the full settings-merge pipeline end-to-end for
 * the `sliceWithCuraEngine` entrypoint. Kept exported so tests can assert
 * the exact `-s` argv without spawning a process. Roadmap: [ID-0068].
 *
 * Precedence (lowest first): machine FDM capability ceilings < preset /
 * `curaEngineSettings`. Explicit `curaEngineSettings` entries always win
 * over the profile ceilings so a hot-spring filament test that pushes
 * `machine_nozzle_temp_max=380` is never silently clamped back to the
 * profile's `maxNozzleTempC=350`. Callers that want the opposite
 * precedence can build their own map.
 */
export function resolveCuraSliceArgv(
  resourcesRoot: string,
  req: SliceRequest
): string[] {
  // 1. Base: K2 quality preset or generic slice preset
  const k2Preset = resolveK2PlusPreset(req.k2QualityPresetId)
  let base: Map<string, string>
  if (k2Preset) {
    base = k2PlusPresetToEngineSettingsMap(k2Preset)
  } else {
    base = curaCliParamsToEngineSettingsMap(resolveCuraSliceParams(req.slicePreset))
  }

  // 2. Layer filament settings OVER preset
  if (req.filamentSettings) {
    const fs = req.filamentSettings
    base.set('material_print_temperature', String(fs.nozzleTempC))
    base.set('material_bed_temperature', String(fs.bedTempC))
    if (fs.chamberTempC != null) base.set('build_volume_temperature', String(fs.chamberTempC))
    base.set('cool_fan_speed', String(fs.fanSpeedPercent))
    if (fs.fanSpeedFirstLayerPercent != null) base.set('cool_fan_speed_0', String(fs.fanSpeedFirstLayerPercent))
    if (fs.retractionMm != null) base.set('retraction_amount', String(fs.retractionMm))
    if (fs.retractionSpeedMmPerSec != null) base.set('retraction_speed', String(fs.retractionSpeedMmPerSec))
  }

  // 3. Layer explicit user overrides (highest priority)
  if (req.curaEngineSettings && Object.keys(req.curaEngineSettings).length > 0) {
    for (const [k, v] of Object.entries(req.curaEngineSettings)) {
      base.set(k, v)
    }
  }

  // 4. Machine capability ceilings go UNDER everything
  const merged = mergeFdmCapabilitiesUnder(req.machineCapabilities ?? null, base)
  return buildCuraSliceArgsFromSettingsMap(resourcesRoot, req, merged)
}

/**
 * Result of resolving the engine + definitions paths for a slice request.
 *
 * `engineSource` and `definitionsSource` make the resolution path visible
 * to callers (the renderer can show "Using bundled CuraEngine" vs "Using
 * configured CuraEngine path" without re-deriving). `error` is set when
 * neither the explicit nor the bundled path is usable.
 *
 * Phase 2 [P2-K2-SLICE]/Cycle 2 ([ID-0016]).
 */
export type SliceEnginePathResolution = {
  /** Resolved CuraEngine binary path; empty string when `error` is set. */
  enginePath: string
  /** Resolved definitions folder; empty string when neither bundled nor user-set. */
  definitionsPath: string
  engineSource: 'user' | 'bundled' | 'unresolved'
  definitionsSource: 'user' | 'bundled' | 'unresolved'
  /** Set when the engine path could not be resolved at all. */
  error?: string
}

/**
 * Pure resolver: derive the engine + definitions paths to use for a given
 * `SliceRequest`, given the bundled-resources root. Splits out from
 * `sliceWithCuraEngine` so unit tests can assert the precedence rules
 * without spawning a subprocess.
 *
 * Precedence:
 *   1. Explicit `req.curaEnginePath` (when non-empty after trim) -- the
 *      historical user-set path. Always wins when set.
 *   2. Bundled binary at `resources/slicer/bin/<platform>-<arch>/CuraEngine[.exe]`
 *      (Phase 2 [P2-K2-SLICE]/Cycle 2 -- approved 2026-05-05).
 *   3. Failure -- caller surfaces the error.
 *
 * Same precedence applies for `curaDefinitionsPath` against the bundled
 * `resources/slicer/definitions/` tree.
 */
export function resolveSliceEnginePaths(
  resourcesRoot: string,
  req: Pick<SliceRequest, 'curaEnginePath' | 'curaDefinitionsPath'>
): SliceEnginePathResolution {
  // Engine path: user explicit > bundled > unresolved.
  const explicitEngine = (req.curaEnginePath ?? '').trim()
  let enginePath = ''
  let engineSource: SliceEnginePathResolution['engineSource'] = 'unresolved'
  let error: string | undefined
  if (explicitEngine.length > 0) {
    enginePath = explicitEngine
    engineSource = 'user'
  } else {
    const bundled = resolveBundledCuraEnginePath(resourcesRoot)
    if (bundled.ok) {
      enginePath = bundled.path
      engineSource = 'bundled'
    } else {
      const expected = bundled.expectedPath ?? '(unsupported platform)'
      error =
        bundled.reason === 'unsupported-platform'
          ? 'No bundled CuraEngine for this platform. Set CuraEngine path under File -> Settings.'
          : `Bundled CuraEngine not found at ${expected}. Set CuraEngine path under File -> Settings or vendor the binary per docs/SLICING.md Cycle 2.`
    }
  }

  // Definitions path: user explicit > bundled > '' (empty = let CuraEngine
  // use its compiled-in default; not strictly fatal).
  const explicitDefs = (req.curaDefinitionsPath ?? '').trim()
  let definitionsPath = ''
  let definitionsSource: SliceEnginePathResolution['definitionsSource'] = 'unresolved'
  if (explicitDefs.length > 0) {
    definitionsPath = explicitDefs
    definitionsSource = 'user'
  } else {
    const bundledDefs = resolveBundledCuraDefinitionsPath(resourcesRoot)
    if (bundledDefs.ok) {
      definitionsPath = bundledDefs.path
      definitionsSource = 'bundled'
    }
  }

  return error
    ? { enginePath, definitionsPath, engineSource, definitionsSource, error }
    : { enginePath, definitionsPath, engineSource, definitionsSource }
}

/**
 * Slice STL using CuraEngine CLI. When `req.curaEnginePath` is empty, falls
 * back to the bundled binary at `resources/slicer/bin/<platform>-<arch>/`
 * (Phase 2 [P2-K2-SLICE]/Cycle 2 -- approved 2026-05-05). When neither the
 * explicit nor the bundled path resolves, returns `{ ok: false }` with a
 * friendly error string.
 */
export async function sliceWithCuraEngine(
  req: SliceRequest
): Promise<{ ok: boolean; stderr?: string; stdout?: string }> {
  const resources = getResourcesRoot()
  const resolution = resolveSliceEnginePaths(resources, req)
  if (resolution.error) {
    return { ok: false, stderr: resolution.error }
  }
  await mkdir(dirname(req.outputGcodePath), { recursive: true })

  const args = resolveCuraSliceArgv(resources, req)

  const extraEnv: NodeJS.ProcessEnv = {}
  if (resolution.definitionsPath.length > 0) {
    extraEnv.CURA_ENGINE_SEARCH_PATH = resolution.definitionsPath
  }
  const { code, stderr, stdout } = await runProcess(
    resolution.enginePath,
    args,
    undefined,
    extraEnv
  )
  if (code !== 0) {
    return { ok: false, stderr: stderr || stdout }
  }
  return { ok: true, stdout }
}

/** Copy STL into project assets and return path - helper for UI. */
export async function stageStlForProject(
  projectDir: string,
  sourceStlPath: string
): Promise<string> {
  const assets = join(projectDir, 'assets')
  await mkdir(assets, { recursive: true })
  const base = sourceStlPath.split(/[/\\]/).pop() ?? 'model.stl'
  const dest = join(assets, base)
  await copyFile(sourceStlPath, dest)
  return dest
}
