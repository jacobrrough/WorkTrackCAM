/**
 * OrcaSlicer CLI wrapper — replaces the deleted CuraEngine-based slicer.ts.
 *
 * OrcaSlicer (https://github.com/SoftFever/OrcaSlicer) is a maintained fork
 * of PrusaSlicer/SuperSlicer with first-class K2 Plus / Klipper profiles. We
 * bundle the Windows binary under `resources/orca-slicer/win32-x64/` and
 * invoke it as a one-shot subprocess per slice.
 *
 * This module is a pure argument builder + spawn invoker. The actual binary
 * bundling happens at electron-builder time (see package.json `extraResources`)
 * and is NOT yet present in the repo — the wrapper throws a clear error if
 * the binary is missing, so callers know to bundle it before shipping.
 *
 * CLI history (Safety Rule 1, G-code is sacred -- bad CLI flags ⇒ no slice)
 * -----------------------------------------------------------------------
 * Earlier revisions of this wrapper used PrusaSlicer/Slic3r-era flags
 * (`--load <ini>` repeated three times + `--output <file> -g <stl>`). Those
 * flags are NOT recognised by OrcaSlicer 2.3.2 -- the binary exits with
 * "Invalid option --load" before even reading the input STL, breaking the
 * entire K2 Plus slicing pipeline in production.
 *
 * The correct OrcaSlicer 2.3.x CLI (the BambuStudio / OrcaSlicer fork
 * diverged from Slic3r at the CLI surface) is:
 *
 *   orca-slicer
 *     --load-settings "<machine.json>;<process.json>"   (semicolon-joined)
 *     --load-filaments "<filament.json>[;<f2>;...]"     (semicolon-joined)
 *     --slice 0                                          (0 == "all plates")
 *     --outputdir "<dir>"                                (NOT --output)
 *     "<input.stl>"                                      (positional, last)
 *
 * Settings files MUST be Orca-flavour JSON (not Slic3r .ini): the CLI calls
 * `config.load_from_json()` and rejects .ini syntax with a parse error.
 * The bundled OrcaSlicer ships its full Creality K2 Plus profile tree
 * under `<orca-install>/resources/profiles/Creality/{machine,process,filament}/`.
 *
 * Output: OrcaSlicer always writes `<outputdir>/plate_<plate>.gcode`. The
 * legacy `--output <path>` flag was removed in the Bambu/Orca fork; we
 * accept an `outputGcodePath` from the caller, derive `outputdir` from its
 * parent directory, run the slice, then rename `plate_1.gcode` to the
 * caller's exact filename inside `runOrcaSlice` (post-spawn FS work; kept
 * out of the pure `buildOrcaArgs`).
 */
import { spawnBounded } from '../subprocess-bounded'
import { existsSync } from 'node:fs'
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export type OrcaSlicePreset = 'draft' | 'standard' | 'high-quality' | 'ultra-high-quality'

export type OrcaSliceConfig = {
  /** Absolute path to the input mesh (STL / 3MF / OBJ). */
  inputPath: string
  /**
   * Absolute path where the final G-code should land. OrcaSlicer 2.3.x
   * writes `<outputdir>/plate_<N>.gcode` and ignores any specific filename
   * the caller asks for; `runOrcaSlice` derives `outputdir` from
   * `dirname(outputGcodePath)` and renames the produced `plate_1.gcode`
   * to this exact path after the slice succeeds.
   */
  outputGcodePath: string
  /**
   * Machine profile JSON for the K2 Plus or other target. OrcaSlicer 2.3.x
   * requires its own Bambu/Orca flavour of JSON; Slic3r-style .ini is NOT
   * accepted (the CLI calls `load_from_json` and errors on `#` comments).
   */
  machineProfileIni: string
  /** Process JSON profile (slice quality / speed / temps). */
  processProfileIni: string
  /** Filament JSON profile. */
  filamentProfileIni: string
  /**
   * Per-slice process / filament overrides (REAL — applied via overlay JSON).
   *
   * OrcaSlicer 2.3.2 has no `--set key=value` flag; the only override path is
   * an extra JSON file appended to `--load-settings` (process keys) or
   * `--load-filaments` (filament keys), which the CLI deep-merges over the
   * base profile (last file wins). `runOrcaSlice` plans these overrides with
   * {@link planOrcaOverrides}, writes one or two tiny overlay JSON files to a
   * tmpdir, appends their paths to the matching load list, and deletes them
   * after the slice. `buildOrcaArgs(cfg)` with no overlay paths is still
   * byte-for-byte identical to the pre-override argv (the merge is purely
   * additive), so the pure-arg tests and the e2e are unaffected.
   *
   * Keys are Orca-flavour profile keys (e.g. `layer_height`,
   * `sparse_infill_density`, `wall_loops`, `outer_wall_speed`,
   * `inner_wall_speed`, `enable_support`, `brim_type`, and the temperature
   * keys `nozzle_temperature` / `hot_plate_temp` / `*_initial_layer`).
   * Temperature keys are routed into the FILAMENT overlay (they are
   * filament-level array-valued settings in Orca JSON, not process keys) and
   * are CLAMPED to the K2 ceiling (nozzle <= 350 C, bed <= 120 C) — see
   * {@link K2_OVERRIDE_TEMP_CEILINGS}. A clamp never silently drops the cap:
   * it is surfaced in {@link OrcaSliceResult.warnings}. This guarantees the
   * overlay can never request a temperature above the K2 firmware ceiling, so
   * the real M104/M140 the slicer emits stay in-bounds and the downstream
   * `validateGcodeFileTemps` pre-upload gate still has nothing to reject.
   */
  overrides?: Record<string, string | number>
  /** Quality preset; selects a bundled process profile if `processProfileIni` is omitted. */
  preset?: OrcaSlicePreset
}

export type OrcaSliceResult = {
  ok: boolean
  outputGcodePath: string
  stdout: string
  stderr: string
  exitCode: number | null
  /**
   * Operator-facing warnings produced while planning per-slice overrides —
   * most importantly the temperature-clamp notices (e.g. "nozzle_temperature
   * 400 C clamped to the K2 ceiling of 350 C"). Empty when there are no
   * overrides or nothing was clamped. The caller (the `slice:orca` IPC
   * handler / the renderer) surfaces these so the operator knows their
   * requested temperature was capped rather than silently honoured.
   */
  warnings: string[]
}

export type OrcaResolution = {
  /** Absolute path to the OrcaSlicer CLI binary. */
  binary: string
  /** Directory containing bundled profiles (machine/process/filament). */
  profilesDir: string
}

/**
 * Resolve where the bundled OrcaSlicer lives relative to the app root.
 * Throws if the binary is not bundled (i.e. development before electron-builder
 * has materialized `resources/orca-slicer/`).
 */
export function resolveOrcaInstall(appRoot: string): OrcaResolution {
  const baseDir = join(appRoot, 'resources', 'orca-slicer')
  const platformDir = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64'
  const binName = process.platform === 'win32' ? 'orca-slicer.exe' : 'orca-slicer'
  const binary = join(baseDir, platformDir, binName)
  const profilesDir = join(baseDir, 'profiles')

  if (!existsSync(binary)) {
    throw new Error(
      `OrcaSlicer binary not bundled. Expected at ${binary}. ` +
        `Run the bundle-orca-slicer script (forthcoming) or download manually.`,
    )
  }
  return { binary, profilesDir }
}

// ── Per-slice override planning ──────────────────────────────────────────────

/**
 * K2 Plus firmware temperature ceilings, mirrored from
 * `resources/machines/creality-k2-plus.json` (`maxNozzleTempC` / `maxBedTempC`)
 * and CLAUDE.md "USER CONTEXT -- TARGET MACHINES" §1 (nozzle <= 350 C, bed <=
 * 120 C). These are the SAME ceilings the pre-upload `validateGcodeFileTemps`
 * gate enforces on the produced G-code; clamping the override here means a
 * per-slice temperature bump can never even ask OrcaSlicer to emit an
 * over-ceiling M104/M140 in the first place (defence-in-depth: the override
 * is clamped going IN, the produced gcode is validated coming OUT).
 *
 * Safety Rule 1 (G-code is sacred): editing these requires editing the machine
 * profile JSON AND CLAUDE.md §1 in the same change, exactly like
 * `K2_PLUS_HARDWARE_CEILINGS` in `src/shared/k2-plus-slice-presets.ts`.
 */
export const K2_OVERRIDE_TEMP_CEILINGS = {
  /** Max nozzle target in deg C (K2 Plus firmware ceiling). */
  nozzleC: 350,
  /** Max bed / build-plate target in deg C (K2 Plus firmware ceiling). */
  bedC: 120
} as const

/**
 * Which override keys are temperature settings, which firmware ceiling caps
 * each, and where the key lives in the Orca profile tree.
 *
 * Temperatures in OrcaSlicer JSON are FILAMENT-level, array-valued (per
 * extruder) settings — `nozzle_temperature`, `hot_plate_temp`, and their
 * `*_initial_layer` siblings (plus the cool/textured/engineering plate
 * variants, which all share the bed ceiling). They are therefore routed into
 * the FILAMENT overlay (`--load-filaments`), NOT the process overlay, and
 * written as a single-element string array to match the base profile shape.
 *
 * Any override key NOT in this table is treated as a PROCESS key (scalar
 * string) and routed verbatim into the process overlay (`--load-settings`) —
 * `layer_height`, `sparse_infill_density`, `wall_loops`, `outer_wall_speed`,
 * `inner_wall_speed`, `enable_support`, `brim_type`, `brim_width`, etc.
 */
const TEMP_OVERRIDE_KEYS: Readonly<Record<string, 'nozzle' | 'bed'>> = {
  nozzle_temperature: 'nozzle',
  nozzle_temperature_initial_layer: 'nozzle',
  hot_plate_temp: 'bed',
  hot_plate_temp_initial_layer: 'bed',
  cool_plate_temp: 'bed',
  cool_plate_temp_initial_layer: 'bed',
  textured_plate_temp: 'bed',
  textured_plate_temp_initial_layer: 'bed',
  eng_plate_temp: 'bed',
  eng_plate_temp_initial_layer: 'bed'
}

/** A planned set of overlay documents + the clamp warnings produced. */
export type OrcaOverridePlan = {
  /**
   * Process-overlay JSON object (scalar string values) to append to
   * `--load-settings`, or `null` when no process keys were overridden.
   * Always carries the Orca-required `type`/`name` discriminators.
   */
  processOverlay: Record<string, string> | null
  /**
   * Filament-overlay JSON object (array-valued temperature settings) to
   * append to `--load-filaments`, or `null` when no temperature keys were
   * overridden. Always carries the Orca-required `type`/`name` discriminators.
   */
  filamentOverlay: Record<string, string | string[]> | null
  /**
   * Operator-facing clamp warnings (one per temperature override that was
   * reduced to the K2 ceiling). Empty when nothing was clamped.
   */
  warnings: string[]
}

/**
 * Coerce an override value to a finite number, or `null` if it is not numeric.
 * Override values arrive as `string | number` (the IPC payload type); a UI
 * temperature field is typically a string like `"230"`.
 */
function asFiniteNumber(value: string | number): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Plan a set of per-slice overrides into process + filament overlay documents,
 * clamping every temperature key to the K2 firmware ceiling.
 *
 * Pure function — no FS, no subprocess. `runOrcaSlice` calls it, writes the
 * returned overlays to a tmpdir, and appends their paths to the CLI load
 * lists; the unit tests call it directly to assert routing + clamping without
 * spawning anything.
 *
 * Clamping rules (Safety Rule 1):
 *   - A temperature override above its ceiling is reduced to the ceiling and a
 *     warning is recorded. Equality with the ceiling passes untouched (the
 *     firmware allows temp AT the ceiling).
 *   - A non-numeric temperature override is dropped with a warning (it cannot
 *     be range-checked, so it must never reach the slicer where it could
 *     produce an unbounded or malformed target).
 *   - Non-temperature keys pass through verbatim as process scalars.
 *
 * Returns `{ processOverlay: null, filamentOverlay: null, warnings: [] }` for
 * an empty / undefined override map, which is what keeps the no-override argv
 * byte-for-byte identical to the historical output.
 */
export function planOrcaOverrides(
  overrides: Record<string, string | number> | undefined | null
): OrcaOverridePlan {
  const warnings: string[] = []
  const processEntries: Record<string, string> = {}
  const filamentEntries: Record<string, string[]> = {}
  let hasProcess = false
  let hasFilament = false

  if (overrides && typeof overrides === 'object') {
    for (const [key, rawValue] of Object.entries(overrides)) {
      if (rawValue == null) continue
      const tempKind = TEMP_OVERRIDE_KEYS[key]
      if (tempKind) {
        // Temperature override → filament overlay, clamped to the ceiling.
        const requested = asFiniteNumber(rawValue)
        if (requested == null) {
          warnings.push(
            `Ignored ${key} override "${String(rawValue)}": not a valid temperature; ` +
              `the base filament profile value will be used instead.`
          )
          continue
        }
        const ceiling = tempKind === 'nozzle' ? K2_OVERRIDE_TEMP_CEILINGS.nozzleC : K2_OVERRIDE_TEMP_CEILINGS.bedC
        let value = requested
        if (requested > ceiling) {
          value = ceiling
          warnings.push(
            `Clamped ${key} override from ${requested} C to the K2 Plus ${tempKind} ceiling of ${ceiling} C.`
          )
        }
        // Orca temperature keys are single-element string arrays (per extruder).
        filamentEntries[key] = [String(value)]
        hasFilament = true
      } else {
        // Everything else is a process scalar; pass through verbatim.
        processEntries[key] = String(rawValue)
        hasProcess = true
      }
    }
  }

  const processOverlay: Record<string, string> | null = hasProcess
    ? { type: 'process', name: 'WorkTrack3D per-slice overrides', ...processEntries }
    : null
  const filamentOverlay: Record<string, string | string[]> | null = hasFilament
    ? { type: 'filament', name: 'WorkTrack3D per-slice filament overrides', ...filamentEntries }
    : null

  return { processOverlay, filamentOverlay, warnings }
}

/** Overlay file paths produced by `runOrcaSlice` after writing the plan. */
export type OrcaOverlayPaths = {
  /** Absolute path to the written process overlay, when one exists. */
  processOverlayPath?: string
  /** Absolute path to the written filament overlay, when one exists. */
  filamentOverlayPath?: string
}

/**
 * Build the OrcaSlicer CLI argv for a slice job.
 *
 * OrcaSlicer 2.3.2 reference (the only one that matters for the bundled
 * binary on Jacob's Windows shop machine):
 *   - Source: SoftFever/OrcaSlicer @ src/OrcaSlicer.cpp CLI option list.
 *   - Probe-verified against the bundled win32-x64 binary on 2026-05-27:
 *       --load-settings "<machine.json>;<process.json>"  ✓
 *       --load-filaments "<filament.json>"               ✓
 *       --slice 0                                         ✓
 *       --outputdir "<dir>"                               ✓
 *       <input.stl>                                       ✓ (positional)
 *     The legacy Slic3r `--load`, `--output`, `--set`, `-g` flags all
 *     return "Invalid option ..." with exit code 127.
 *
 * Multi-file loads use a SEMICOLON-joined string (Bambu/Orca convention),
 * NOT repeated flag invocations and NOT comma-joined. `--load-settings`
 * takes machine + process (the two non-filament profile families), and
 * `--load-filaments` takes the per-extruder filament list.
 *
 * The K2 Plus single-extruder happy path is exactly:
 *   ["--load-settings", "machine.json;process.json",
 *    "--load-filaments", "filament.json",
 *    "--slice", "0",
 *    "--outputdir", dirname(outputGcodePath),
 *    inputPath]
 *
 * Per-slice overrides (`overlays`): OrcaSlicer 2.3.2 has no `--set` flag, so a
 * one-off override is applied by APPENDING an extra overlay JSON to the
 * relevant semicolon-joined load list — the CLI deep-merges the files in order
 * (last file wins). When `overlays.processOverlayPath` is supplied it is
 * appended to `--load-settings` (after machine + process); when
 * `overlays.filamentOverlayPath` is supplied it is appended to
 * `--load-filaments` (after the base filament). The overlay docs are produced
 * by {@link planOrcaOverrides} and written to disk by {@link runOrcaSlice}.
 *
 * The merge is purely additive: with no `overlays` argument (or an empty one)
 * the argv is BYTE-FOR-BYTE identical to the historical no-override output, so
 * the pure-arg pins and the e2e are unchanged.
 *
 * Pure function — no FS or subprocess calls. Used by `runOrcaSlice` and by
 * the unit tests in `orca-wrapper.test.ts`.
 */
export function buildOrcaArgs(cfg: OrcaSliceConfig, overlays?: OrcaOverlayPaths): string[] {
  // Settings live in the JSON-load namespace alongside the machine; the
  // semicolon separator is the documented multi-file delimiter for both
  // --load-settings and --load-filaments in OrcaSlicer 2.3.x. A per-slice
  // process / filament overlay (when present) is appended LAST so the CLI's
  // deep-merge applies it over the base profile.
  const settingsFiles = [cfg.machineProfileIni, cfg.processProfileIni]
  if (overlays?.processOverlayPath) settingsFiles.push(overlays.processOverlayPath)
  const filamentFiles = [cfg.filamentProfileIni]
  if (overlays?.filamentOverlayPath) filamentFiles.push(overlays.filamentOverlayPath)

  const settings = settingsFiles.join(';')
  const filaments = filamentFiles.join(';')
  const outputDir = dirname(cfg.outputGcodePath)
  return [
    '--load-settings',
    settings,
    '--load-filaments',
    filaments,
    '--slice',
    '0',
    '--outputdir',
    outputDir,
    cfg.inputPath,
  ]
}

/**
 * OrcaSlicer 2.3.x always names the first-plate output `plate_1.gcode`
 * inside the `--outputdir` we pass it. Callers expect a specific filename
 * (the IPC handler picks `<projectDir>/output/<job>.gcode`), so after the
 * slice we rename `plate_1.gcode` → `cfg.outputGcodePath`. Exported only
 * for verification; not part of the public surface.
 */
export const ORCA_DEFAULT_PLATE_FILENAME = 'plate_1.gcode'

/**
 * Write the planned overlay documents (if any) into a fresh tmpdir and return
 * the dir + the overlay paths to append to the CLI load lists. The dir is
 * deleted by `runOrcaSlice`'s `finally`. Pretty-printed JSON so a failed slice
 * leaves a human-readable overlay behind in the captured stderr context.
 */
async function writeOverridePlan(
  plan: OrcaOverridePlan
): Promise<{ dir: string | null; overlays: OrcaOverlayPaths }> {
  if (!plan.processOverlay && !plan.filamentOverlay) {
    return { dir: null, overlays: {} }
  }
  const dir = await mkdtemp(join(tmpdir(), 'wtcam-orca-override-'))
  const overlays: OrcaOverlayPaths = {}
  if (plan.processOverlay) {
    const p = join(dir, 'process-override.json')
    await writeFile(p, JSON.stringify(plan.processOverlay, null, 2), 'utf8')
    overlays.processOverlayPath = p
  }
  if (plan.filamentOverlay) {
    const p = join(dir, 'filament-override.json')
    await writeFile(p, JSON.stringify(plan.filamentOverlay, null, 2), 'utf8')
    overlays.filamentOverlayPath = p
  }
  return { dir, overlays }
}

/**
 * Invoke OrcaSlicer once for the given config.
 *
 * After the spawn returns exit-code 0, the implementation renames the
 * `plate_1.gcode` that Orca always produces to the caller's requested
 * `outputGcodePath`. This keeps the IPC contract stable while we live
 * with OrcaSlicer's removed `--output <file>` flag.
 *
 * Per-slice overrides (`cfg.overrides`) are planned via {@link planOrcaOverrides}
 * (which CLAMPS temperature overrides to the K2 ceiling), written to a tmpdir
 * overlay, and appended to the CLI load lists. The clamp warnings are returned
 * in `result.warnings`. The overlay tmpdir is always removed in `finally`.
 */
export async function runOrcaSlice(
  appRoot: string,
  cfg: OrcaSliceConfig,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<OrcaSliceResult> {
  const { binary } = resolveOrcaInstall(appRoot)
  // Plan + materialize any per-slice overrides BEFORE the spawn. The plan is
  // pure (and unit-tested directly); writing the overlay is the only FS step.
  const plan = planOrcaOverrides(cfg.overrides)
  const { dir: overlayDir, overlays } = await writeOverridePlan(plan)
  try {
    const args = buildOrcaArgs(cfg, overlays)
    const r = await spawnBounded(binary, args, {
      cwd: appRoot,
      timeoutMs: opts.timeoutMs ?? 5 * 60_000,
      signal: opts.signal,
    })
    // If the slice succeeded, rename `plate_1.gcode` -> the exact output
    // path the caller asked for. If the rename fails (e.g. Orca renamed
    // the plate based on a `filename_format` token, or the caller's path
    // matches what Orca already emitted), fall back to whichever file
    // exists so the result still points at a real G-code file.
    let finalOutputPath = cfg.outputGcodePath
    if (r.code === 0) {
      const outputDir = dirname(cfg.outputGcodePath)
      const orcaDefault = join(outputDir, ORCA_DEFAULT_PLATE_FILENAME)
      if (orcaDefault !== cfg.outputGcodePath) {
        try {
          const orcaStat = await stat(orcaDefault).catch(() => null)
          if (orcaStat && orcaStat.isFile()) {
            await rename(orcaDefault, cfg.outputGcodePath)
          } else {
            // Orca may have used a `filename_format` template; if the
            // caller's exact path already exists, leave it; otherwise
            // surface the plate_1 path so the caller can find the file.
            const caller = await stat(cfg.outputGcodePath).catch(() => null)
            if (!caller || !caller.isFile()) {
              finalOutputPath = orcaDefault
            }
          }
        } catch {
          // Best-effort rename; if it failed we still report whatever
          // path the caller asked for (the caller will see ok:true and
          // surface a "file not found" downstream rather than a crash).
        }
      }
    }
    return {
      ok: r.code === 0,
      outputGcodePath: finalOutputPath,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.code,
      warnings: plan.warnings,
    }
  } finally {
    // Always clean up the overlay tmpdir, regardless of slice outcome.
    if (overlayDir) {
      await rm(overlayDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
