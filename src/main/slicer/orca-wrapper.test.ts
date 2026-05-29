import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildOrcaArgs,
  resolveOrcaInstall,
  orcaBinaryCandidates,
  bundledOrcaBinaryPath,
  type OrcaSliceConfig,
} from './orca-wrapper'

const baseConfig: OrcaSliceConfig = {
  inputPath: '/jobs/widget.stl',
  outputGcodePath: '/jobs/widget.gcode',
  machineProfileIni: '/profiles/k2-plus-machine.json',
  processProfileIni: '/profiles/standard-process.json',
  filamentProfileIni: '/profiles/pla-filament.json',
}

describe('buildOrcaArgs', () => {
  // OrcaSlicer 2.3.x CLI (verified against the bundled win32-x64 binary on
  // 2026-05-27 -- see the wrapper docstring for the full probe). The argv
  // shape is intentionally NOT the Slic3r `--load` / `--output` / `-g`
  // layout earlier revisions of this wrapper used, which the binary
  // rejects with "Invalid option ..." before reading the input STL.
  it('emits --load-settings + --load-filaments + --slice 0 + --outputdir + positional input', () => {
    const args = buildOrcaArgs(baseConfig)
    expect(args).toEqual([
      '--load-settings',
      '/profiles/k2-plus-machine.json;/profiles/standard-process.json',
      '--load-filaments',
      '/profiles/pla-filament.json',
      '--slice',
      '0',
      '--outputdir',
      '/jobs',
      '/jobs/widget.stl',
    ])
  })

  it('joins machine and process settings paths with a semicolon (multi-file convention)', () => {
    const args = buildOrcaArgs(baseConfig)
    const idx = args.indexOf('--load-settings')
    expect(idx).toBeGreaterThanOrEqual(0)
    const settings = args[idx + 1]
    // Bambu/Orca multi-file separator is `;`, NOT `,` or repeated flags.
    expect(settings).toBe('/profiles/k2-plus-machine.json;/profiles/standard-process.json')
    expect(settings.split(';')).toHaveLength(2)
  })

  it('keeps filament profile separate (`--load-filaments`, NOT folded into --load-settings)', () => {
    const args = buildOrcaArgs(baseConfig)
    const settings = args[args.indexOf('--load-settings') + 1]
    const filaments = args[args.indexOf('--load-filaments') + 1]
    expect(settings).not.toContain('pla-filament.json')
    expect(filaments).toBe('/profiles/pla-filament.json')
  })

  it('passes --slice 0 as two separate argv elements (int parser, "all plates")', () => {
    const args = buildOrcaArgs(baseConfig)
    const idx = args.indexOf('--slice')
    expect(idx).toBeGreaterThanOrEqual(0)
    // `0` is the documented "slice all plates" sentinel for OrcaSlicer's
    // ConfigOptionInt --slice parser.
    expect(args[idx + 1]).toBe('0')
  })

  it('derives --outputdir from dirname(outputGcodePath) (no --output filename in CLI)', () => {
    // OrcaSlicer 2.3.x removed the legacy `--output <file>` flag; it
    // always writes `<outputdir>/plate_<N>.gcode`. The wrapper renames
    // the produced file to the caller's exact outputGcodePath inside
    // `runOrcaSlice`, AFTER the spawn completes.
    const args = buildOrcaArgs(baseConfig)
    const idx = args.indexOf('--outputdir')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe('/jobs')
    // No --output flag should appear (Slic3r-era; rejected by Orca CLI).
    expect(args).not.toContain('--output')
  })

  it('places the input mesh argument LAST as a positional, with no -g flag', () => {
    const args = buildOrcaArgs(baseConfig)
    expect(args[args.length - 1]).toBe('/jobs/widget.stl')
    // `-g` was a PrusaSlicer/Slic3r flag (export G-code). OrcaSlicer 2.3.x
    // takes the input as a bare positional argument; -g is "Invalid option".
    expect(args).not.toContain('-g')
  })

  it('regression: rejects --load (CLI bug from 2026-05-27)', () => {
    // Earlier revisions of this wrapper assembled `--load <ini>` (repeated)
    // because the docstring cited the Slic3r/PrusaSlicer CLI layout. The
    // bundled OrcaSlicer 2.3.2 rejects `--load` with "Invalid option" and
    // exit code 127, so EVERY slice failed in production. This regression
    // pin fails loudly if anyone re-introduces the wrong flag.
    const args = buildOrcaArgs(baseConfig)
    expect(args).not.toContain('--load')
    // Also pin the related Slic3r flags whose removal in Orca was the
    // root cause of the broken pipeline.
    expect(args).not.toContain('--output')
    expect(args).not.toContain('-g')
    expect(args).not.toContain('--set')
  })

  it('overrides field is currently ignored (no --set flag in Orca 2.3.x CLI)', () => {
    // The OrcaSliceConfig type retains `overrides` for source-compat with
    // the IPC handler and existing callers, but OrcaSlicer 2.3.x has no
    // `--set key=value` flag. Per-job overrides must go through a tmpdir
    // overlay JSON appended to `--load-settings`; that work is tracked
    // separately. This test pins the current "ignored" behaviour so the
    // pure-function `buildOrcaArgs` stays predictable.
    const args = buildOrcaArgs({
      ...baseConfig,
      overrides: { nozzle_temperature: 220, layer_height: 0.2 },
    })
    expect(args).not.toContain('--set')
    expect(args).not.toContain('nozzle_temperature=220')
    expect(args).not.toContain('layer_height=0.2')
    // The four required flags + positional are still produced.
    expect(args).toContain('--load-settings')
    expect(args).toContain('--load-filaments')
    expect(args).toContain('--slice')
    expect(args).toContain('--outputdir')
    expect(args[args.length - 1]).toBe('/jobs/widget.stl')
  })

  it('preserves the order: settings → filaments → slice → outputdir → input', () => {
    const args = buildOrcaArgs(baseConfig)
    const order = [
      args.indexOf('--load-settings'),
      args.indexOf('--load-filaments'),
      args.indexOf('--slice'),
      args.indexOf('--outputdir'),
    ]
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i >= 0)).toBe(true)
    // Input mesh must be after every flag-and-value pair.
    expect(args.indexOf('/jobs/widget.stl')).toBe(args.length - 1)
  })
})

describe('resolveOrcaInstall', () => {
  it('throws an actionable error when nothing is found (injected exists:false)', () => {
    // `exists: () => false` keeps this deterministic even on a machine that
    // actually has OrcaSlicer installed — otherwise the system-install
    // fallback would resolve and the throw would never fire.
    expect(() =>
      resolveOrcaInstall('/nonexistent/app/root', {
        env: {},
        platform: 'win32',
        exists: () => false,
      }),
    ).toThrow(/OrcaSlicer binary not found/)
  })

  it('error lists checked paths and names the env var + bundle script as fixes', () => {
    let msg = ''
    try {
      resolveOrcaInstall('/app', { env: {}, platform: 'win32', exists: () => false })
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toContain('WORKTRACKCAM_ORCA_BIN')
    expect(msg).toContain('bundle-orca-slicer')
    expect(msg).toContain('(bundled)')
    expect(msg).toContain('(system)')
  })

  it('prefers the WORKTRACKCAM_ORCA_BIN override over bundled + system', () => {
    const r = resolveOrcaInstall('/app', {
      env: { WORKTRACKCAM_ORCA_BIN: '/custom/orca.exe' },
      platform: 'win32',
      exists: () => true, // even with everything "present", the override wins
    })
    expect(r.binary).toBe('/custom/orca.exe')
    expect(r.source).toBe('env')
  })

  it('falls back to the bundled binary when no override is set', () => {
    const bundled = bundledOrcaBinaryPath('/app', 'win32')
    const r = resolveOrcaInstall('/app', {
      env: {},
      platform: 'win32',
      exists: (p) => p === bundled,
    })
    expect(r.binary).toBe(bundled)
    expect(r.source).toBe('bundled')
  })

  it('falls back to a Windows system install when override + bundle are absent', () => {
    const systemPath = join('C:\\Program Files', 'OrcaSlicer', 'OrcaSlicer.exe')
    const r = resolveOrcaInstall('/app', {
      env: { PROGRAMFILES: 'C:\\Program Files' },
      platform: 'win32',
      exists: (p) => p === systemPath,
    })
    expect(r.binary).toBe(systemPath)
    expect(r.source).toBe('system')
  })

  it('resolves a macOS .app-bundle system install', () => {
    const macPath = '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'
    const r = resolveOrcaInstall('/app', {
      env: {},
      platform: 'darwin',
      exists: (p) => p === macPath,
    })
    expect(r.binary).toBe(macPath)
    expect(r.source).toBe('system')
  })
})

describe('orcaBinaryCandidates', () => {
  it('orders env override first, then bundled, then system installs', () => {
    const c = orcaBinaryCandidates(
      '/app',
      { WORKTRACKCAM_ORCA_BIN: '/x/orca.exe', PROGRAMFILES: 'C:\\Program Files' },
      'win32',
    )
    expect(c[0]).toEqual({ path: '/x/orca.exe', source: 'env' })
    expect(c[1].source).toBe('bundled')
    expect(c.slice(2).every((x) => x.source === 'system')).toBe(true)
  })

  it('omits the env candidate when the override is unset or blank', () => {
    const c = orcaBinaryCandidates('/app', { WORKTRACKCAM_ORCA_BIN: '   ' }, 'win32')
    expect(c.some((x) => x.source === 'env')).toBe(false)
    expect(c[0].source).toBe('bundled')
  })

  it('includes the standard Program Files OrcaSlicer.exe on Windows', () => {
    const paths = orcaBinaryCandidates('/app', { PROGRAMFILES: 'C:\\Program Files' }, 'win32').map(
      (x) => x.path,
    )
    expect(paths).toContain(join('C:\\Program Files', 'OrcaSlicer', 'OrcaSlicer.exe'))
  })

  it('uses the .app bundle on macOS and standard bins on linux', () => {
    const mac = orcaBinaryCandidates('/app', {}, 'darwin').map((x) => x.path)
    expect(mac).toContain('/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer')
    const linux = orcaBinaryCandidates('/app', {}, 'linux').map((x) => x.path)
    expect(linux).toContain('/usr/bin/orca-slicer')
  })

  it('bundled candidate uses the platform subdir + exe name', () => {
    const win = orcaBinaryCandidates('/app', {}, 'win32').find((x) => x.source === 'bundled')
    expect(win?.path).toContain(join('resources', 'orca-slicer', 'win32-x64', 'orca-slicer.exe'))
    const lin = orcaBinaryCandidates('/app', {}, 'linux').find((x) => x.source === 'bundled')
    expect(lin?.path).toContain(join('resources', 'orca-slicer', 'linux-x64', 'orca-slicer'))
  })
})
