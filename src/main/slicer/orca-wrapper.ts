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
 */
import { spawnBounded } from '../subprocess-bounded'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type OrcaSlicePreset = 'draft' | 'standard' | 'high-quality' | 'ultra-high-quality'

export type OrcaSliceConfig = {
  /** Absolute path to the input mesh (STL / 3MF / OBJ). */
  inputPath: string
  /** Absolute path where OrcaSlicer should write the output G-code. */
  outputGcodePath: string
  /** Machine ini file (machine-side OrcaSlicer profile) for the K2 Plus or other target. */
  machineProfileIni: string
  /** Process ini file (slice quality / speed / temps profile). */
  processProfileIni: string
  /** Filament ini file (active filament settings). */
  filamentProfileIni: string
  /** OrcaSlicer `--load-config` overrides as key=value pairs. */
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
 * Reference: https://github.com/SoftFever/OrcaSlicer/wiki/Command-Line-Slicing
 * The Orca CLI inherits the PrusaSlicer / Slic3r argument layout:
 *   orca-slicer --load <machine.ini> --load <process.ini> --load <filament.ini>
 *               [--set key=value]* --output <out.gcode> -g <input>
 *
 * Pure function — no FS or subprocess calls. Used by `runOrcaSlice` and by
 * the unit tests in `orca-wrapper.test.ts`.
 */
export function buildOrcaArgs(cfg: OrcaSliceConfig): string[] {
  const args: string[] = [
    '--load',
    cfg.machineProfileIni,
    '--load',
    cfg.processProfileIni,
    '--load',
    cfg.filamentProfileIni,
  ]
  if (cfg.overrides) {
    for (const [key, value] of Object.entries(cfg.overrides)) {
      args.push('--set', `${key}=${String(value)}`)
    }
  }
  args.push('--output', cfg.outputGcodePath, '-g', cfg.inputPath)
  return args
}

/** Invoke OrcaSlicer once for the given config. */
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
  return {
    ok: r.code === 0,
    outputGcodePath: cfg.outputGcodePath,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.code,
  }
}
