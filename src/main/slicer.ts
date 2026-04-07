import { spawnBounded } from './subprocess-bounded'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CURA_SLICE_CLI_DEFAULTS,
  curaCliParamsToEngineSettingsMap,
  resolveCuraSliceParams,
  type CuraSliceCliParams
} from '../shared/cura-slice-defaults'
import { getResourcesRoot } from './paths'

export type SliceRequest = {
  curaEnginePath: string
  inputStlPath: string
  outputGcodePath: string
  /** Optional override for machine definition JSON */
  definitionPath?: string
  /** Folder containing fdmprinter.def.json (sets CURA_ENGINE_SEARCH_PATH) */
  curaDefinitionsPath?: string
  /** Named Cura `-s` bundle; see `cura-slice-defaults.ts` */
  slicePreset?: string | null
  /**
   * Full merged Cura `-s` map (Cura setting id → value). When non-empty, used instead of
   * rebuilding from `slicePreset` alone.
   */
  curaEngineSettings?: Record<string, string>
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
 * Slice STL using CuraEngine CLI. Requires a valid Ultimaker-style definition chain on your machine
 * or the bundled minimal definition (may need tuning for your CuraEngine version).
 */
export async function sliceWithCuraEngine(req: SliceRequest): Promise<{ ok: boolean; stderr?: string; stdout?: string }> {
  const resources = getResourcesRoot()
  await mkdir(dirname(req.outputGcodePath), { recursive: true })

  const merged =
    req.curaEngineSettings && Object.keys(req.curaEngineSettings).length > 0
      ? new Map(Object.entries(req.curaEngineSettings))
      : curaCliParamsToEngineSettingsMap(resolveCuraSliceParams(req.slicePreset))
  const args = buildCuraSliceArgsFromSettingsMap(resources, req, merged)

  const extraEnv: NodeJS.ProcessEnv = {}
  if (req.curaDefinitionsPath) {
    extraEnv.CURA_ENGINE_SEARCH_PATH = req.curaDefinitionsPath
  }
  const { code, stderr, stdout } = await runProcess(req.curaEnginePath, args, undefined, extraEnv)
  if (code !== 0) {
    return { ok: false, stderr: stderr || stdout }
  }
  return { ok: true, stdout }
}

/** Copy STL into project assets and return path — helper for UI. */
export async function stageStlForProject(projectDir: string, sourceStlPath: string): Promise<string> {
  const assets = join(projectDir, 'assets')
  await mkdir(assets, { recursive: true })
  const base = sourceStlPath.split(/[/\\]/).pop() ?? 'model.stl'
  const dest = join(assets, base)
  await copyFile(sourceStlPath, dest)
  return dest
}
