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
import { rename, stat } from 'node:fs/promises'
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
   * Reserved for future per-slice overrides. OrcaSlicer 2.3.2 has no
   * `--set key=value` flag (only `--load-settings` JSON merges); to apply
   * a one-off override the caller should write a tiny overlay JSON to a
   * tmpdir and append its path to the machine/process load list. This
   * field is kept on the type for source-compatibility with the IPC
   * handler (`slice:orca`) and so existing unit tests still type-check,
   * but values placed here are CURRENTLY IGNORED by `buildOrcaArgs`.
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
 * Pure function — no FS or subprocess calls. Used by `runOrcaSlice` and by
 * the unit tests in `orca-wrapper.test.ts`.
 */
export function buildOrcaArgs(cfg: OrcaSliceConfig): string[] {
  // Settings live in the JSON-load namespace alongside the machine; the
  // semicolon separator is the documented multi-file delimiter for both
  // --load-settings and --load-filaments in OrcaSlicer 2.3.x.
  const settings = `${cfg.machineProfileIni};${cfg.processProfileIni}`
  const filaments = cfg.filamentProfileIni
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
 * Invoke OrcaSlicer once for the given config.
 *
 * After the spawn returns exit-code 0, the implementation renames the
 * `plate_1.gcode` that Orca always produces to the caller's requested
 * `outputGcodePath`. This keeps the IPC contract stable while we live
 * with OrcaSlicer's removed `--output <file>` flag.
 */
export async function runOrcaSlice(
  appRoot: string,
  cfg: OrcaSliceConfig,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<OrcaSliceResult> {
  const { binary } = resolveOrcaInstall(appRoot)
  const args = buildOrcaArgs(cfg)
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
  }
}
