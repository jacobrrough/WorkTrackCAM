import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  buildOrcaArgs,
  bundledOrcaBinaryPath,
  planOrcaOverrides,
  resolveOrcaInstall,
  K2_OVERRIDE_TEMP_CEILINGS,
  type OrcaSliceConfig
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

  it('overrides never become a --set flag (Orca 2.3.x CLI has none); merge is overlay-based', () => {
    // Per-slice overrides are applied by APPENDING an overlay JSON to the
    // load list (see planOrcaOverrides + the overlay-merge suite below), NOT
    // by a `--set key=value` flag (which OrcaSlicer 2.3.x rejects). Even with
    // `overlays` supplied, no Slic3r-era `--set` / `key=value` argv appears.
    const args = buildOrcaArgs(
      { ...baseConfig, overrides: { nozzle_temperature: 220, layer_height: 0.2 } },
      { processOverlayPath: '/tmp/p.json', filamentOverlayPath: '/tmp/f.json' }
    )
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

  it('EMPTY/absent overrides → argv is byte-for-byte identical to the no-override baseline', () => {
    // The override merge is purely additive: passing no `overlays` arg, an
    // empty one, or a config whose `overrides` is undefined/empty must all
    // reproduce the historical argv exactly. This is the load-bearing
    // regression guard so the e2e + the pure-arg pins above never shift.
    const baseline = buildOrcaArgs(baseConfig)
    expect(buildOrcaArgs(baseConfig, {})).toEqual(baseline)
    expect(buildOrcaArgs({ ...baseConfig, overrides: undefined })).toEqual(baseline)
    expect(buildOrcaArgs({ ...baseConfig, overrides: {} })).toEqual(baseline)
    // And an explicitly-empty overlay object (no paths) is still identical.
    expect(
      buildOrcaArgs(
        { ...baseConfig, overrides: { layer_height: 0.3 } },
        { processOverlayPath: undefined, filamentOverlayPath: undefined }
      )
    ).toEqual(baseline)
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

  // ── Per-slice overlay merge ────────────────────────────────────────────────

  it('appends a PROCESS overlay LAST in --load-settings (after machine;process)', () => {
    const args = buildOrcaArgs(baseConfig, { processOverlayPath: '/tmp/ov/process-override.json' })
    const settings = args[args.indexOf('--load-settings') + 1]
    // The CLI deep-merges files left→right; the overlay must come last so it
    // wins over the base process profile.
    expect(settings).toBe(
      '/profiles/k2-plus-machine.json;/profiles/standard-process.json;/tmp/ov/process-override.json'
    )
    expect(settings.split(';')).toHaveLength(3)
    // A process overlay must NOT leak into the filament load list.
    const filaments = args[args.indexOf('--load-filaments') + 1]
    expect(filaments).toBe('/profiles/pla-filament.json')
  })

  it('appends a FILAMENT overlay LAST in --load-filaments (after the base filament)', () => {
    const args = buildOrcaArgs(baseConfig, { filamentOverlayPath: '/tmp/ov/filament-override.json' })
    const filaments = args[args.indexOf('--load-filaments') + 1]
    expect(filaments).toBe('/profiles/pla-filament.json;/tmp/ov/filament-override.json')
    expect(filaments.split(';')).toHaveLength(2)
    // A filament overlay must NOT leak into --load-settings.
    const settings = args[args.indexOf('--load-settings') + 1]
    expect(settings).toBe('/profiles/k2-plus-machine.json;/profiles/standard-process.json')
  })

  it('appends BOTH overlays to their respective load lists when both are present', () => {
    const args = buildOrcaArgs(baseConfig, {
      processOverlayPath: '/tmp/ov/process-override.json',
      filamentOverlayPath: '/tmp/ov/filament-override.json',
    })
    expect(args[args.indexOf('--load-settings') + 1]).toBe(
      '/profiles/k2-plus-machine.json;/profiles/standard-process.json;/tmp/ov/process-override.json'
    )
    expect(args[args.indexOf('--load-filaments') + 1]).toBe(
      '/profiles/pla-filament.json;/tmp/ov/filament-override.json'
    )
    // Flag/positional shape is otherwise unchanged.
    expect(args[args.length - 1]).toBe('/jobs/widget.stl')
    expect(args).not.toContain('--set')
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

describe('planOrcaOverrides', () => {
  it('empty / undefined / null → no overlays, no warnings (keeps argv byte-for-byte)', () => {
    for (const empty of [undefined, null, {}] as const) {
      const plan = planOrcaOverrides(empty)
      expect(plan.processOverlay).toBeNull()
      expect(plan.filamentOverlay).toBeNull()
      expect(plan.warnings).toEqual([])
    }
  })

  it('routes process keys into a process overlay (scalar strings) with the Orca discriminators', () => {
    const plan = planOrcaOverrides({
      layer_height: 0.3,
      sparse_infill_density: '40%',
      wall_loops: 4,
      outer_wall_speed: 120,
      inner_wall_speed: 150,
      enable_support: '1',
      brim_type: 'outer_only',
    })
    expect(plan.filamentOverlay).toBeNull()
    expect(plan.warnings).toEqual([])
    expect(plan.processOverlay).toEqual({
      type: 'process',
      name: 'WorkTrack3D per-slice overrides',
      // numbers coerced to strings; strings preserved verbatim.
      layer_height: '0.3',
      sparse_infill_density: '40%',
      wall_loops: '4',
      outer_wall_speed: '120',
      inner_wall_speed: '150',
      enable_support: '1',
      brim_type: 'outer_only',
    })
  })

  it('routes temperature keys into a FILAMENT overlay as single-element string arrays', () => {
    const plan = planOrcaOverrides({
      nozzle_temperature: 230,
      nozzle_temperature_initial_layer: '235',
      hot_plate_temp: 60,
      hot_plate_temp_initial_layer: 65,
    })
    // No process overlay when only temps were overridden.
    expect(plan.processOverlay).toBeNull()
    expect(plan.warnings).toEqual([])
    expect(plan.filamentOverlay).toEqual({
      type: 'filament',
      name: 'WorkTrack3D per-slice filament overrides',
      nozzle_temperature: ['230'],
      nozzle_temperature_initial_layer: ['235'],
      hot_plate_temp: ['60'],
      hot_plate_temp_initial_layer: ['65'],
    })
  })

  it('CLAMPS an over-ceiling NOZZLE override to 350 C and records a warning', () => {
    const plan = planOrcaOverrides({ nozzle_temperature: 400 })
    expect(plan.filamentOverlay?.nozzle_temperature).toEqual([
      String(K2_OVERRIDE_TEMP_CEILINGS.nozzleC),
    ])
    expect(plan.filamentOverlay?.nozzle_temperature).toEqual(['350'])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toMatch(/nozzle_temperature/)
    expect(plan.warnings[0]).toMatch(/400 C/)
    expect(plan.warnings[0]).toMatch(/350 C/)
  })

  it('CLAMPS an over-ceiling BED override to 120 C and records a warning', () => {
    const plan = planOrcaOverrides({ hot_plate_temp: 150 })
    expect(plan.filamentOverlay?.hot_plate_temp).toEqual([
      String(K2_OVERRIDE_TEMP_CEILINGS.bedC),
    ])
    expect(plan.filamentOverlay?.hot_plate_temp).toEqual(['120'])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toMatch(/hot_plate_temp/)
    expect(plan.warnings[0]).toMatch(/150 C/)
    expect(plan.warnings[0]).toMatch(/120 C/)
  })

  it('a temperature AT the ceiling passes untouched with no warning (firmware allows equality)', () => {
    const plan = planOrcaOverrides({ nozzle_temperature: 350, hot_plate_temp: 120 })
    expect(plan.filamentOverlay?.nozzle_temperature).toEqual(['350'])
    expect(plan.filamentOverlay?.hot_plate_temp).toEqual(['120'])
    expect(plan.warnings).toEqual([])
  })

  it('a BELOW-ceiling temperature is honoured verbatim (no clamp, no warning)', () => {
    const plan = planOrcaOverrides({ nozzle_temperature: 215, hot_plate_temp: 60 })
    expect(plan.filamentOverlay?.nozzle_temperature).toEqual(['215'])
    expect(plan.filamentOverlay?.hot_plate_temp).toEqual(['60'])
    expect(plan.warnings).toEqual([])
  })

  it('drops a non-numeric temperature override with a warning (never reaches the slicer)', () => {
    const plan = planOrcaOverrides({ nozzle_temperature: 'hot', layer_height: 0.2 })
    // The bad temp is NOT written into the filament overlay.
    expect(plan.filamentOverlay).toBeNull()
    // The valid process key still flows through.
    expect(plan.processOverlay?.layer_height).toBe('0.2')
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toMatch(/nozzle_temperature/)
    expect(plan.warnings[0]).toMatch(/not a valid temperature/)
  })

  it('mixes process + temperature overrides into separate overlays in one plan', () => {
    const plan = planOrcaOverrides({
      layer_height: 0.16,
      wall_loops: 5,
      nozzle_temperature: 500, // clamped
    })
    expect(plan.processOverlay).toMatchObject({
      type: 'process',
      layer_height: '0.16',
      wall_loops: '5',
    })
    expect(plan.filamentOverlay?.nozzle_temperature).toEqual(['350'])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toMatch(/Clamped nozzle_temperature/)
  })

  it('K2 ceilings match the machine profile (nozzle 350 C / bed 120 C)', () => {
    // Pins the ceiling constants to CLAUDE.md §1 + creality-k2-plus.json so a
    // careless bump cannot silently raise the clamp above the K2 firmware cap.
    expect(K2_OVERRIDE_TEMP_CEILINGS.nozzleC).toBe(350)
    expect(K2_OVERRIDE_TEMP_CEILINGS.bedC).toBe(120)
  })
})
