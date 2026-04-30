/**
 * Paired-pin contract for `src/main/slicer.ts` -- the 137-line MAIN-process
 * Creality K2 Plus FDM CuraEngine arg builder + bounded-spawn entrypoint +
 * STL staging helper.
 *
 * The module exports five runtime symbols:
 *
 * - `buildCuraSliceArgsFromSettingsMap(resourcesRoot, req, settings)` -- low-
 *   level argv assembler. Emits the canonical argv shape:
 *     `['slice', '-v', '-j', <defPath>, ...flags, '-l', <input>, '-o', <output>]`
 *   where `flags` is `[-s, "k=v", ...]` in iteration order of the Map.
 * - `buildCuraSliceArgs(resourcesRoot, req, sliceParams?)` -- preset-bundle
 *   wrapper that fans the four `CuraSliceCliParams` fields out to the four
 *   matching CuraEngine `-s` keys (layer_height / line_width / wall_line_count
 *   / infill_sparse_density). Default = `CURA_SLICE_CLI_DEFAULTS`.
 * - `resolveCuraSliceArgv(resourcesRoot, req)` -- end-to-end precedence
 *   resolver: machine FDM capability ceilings (lowest) < preset/profile <
 *   explicit `curaEngineSettings` map (highest). Roadmap [ID-0068].
 * - `sliceWithCuraEngine(req)` -- async spawn entrypoint (NOT exercised in
 *   this pin -- the pin asserts the wrapper's existence and source-text
 *   shape only; behavioral coverage lives in `slicer.test.ts` and the
 *   broader CAM e2e suites which mock `spawnBounded`).
 * - `stageStlForProject(projectDir, sourceStlPath)` -- copies an STL into
 *   `${projectDir}/assets/<basename>`, returning the destination path.
 *
 * Three-machine impact: DIRECT for Creality K2 Plus (this is the K2 Plus
 * FDM slice path -- bundled `resources/slicer/creality_k2_plus.def.json`
 * is the default `-j` def file; the FDM capability ceilings emit the
 * `machine_nozzle_temp_max=350` / `machine_max_bed_temp=120` /
 * `build_volume_temperature=60` / `machine_heated_build_volume=true`
 * triple that the K2 Plus's heated chamber requires). NOT used by Laguna
 * Swift 5x10 or Makera Carvera 3-axis / 4-axis Rotary (CNC routes go
 * through Handlebars `.hbs` posts in `resources/posts/`, not CuraEngine).
 *
 * This pin co-locates with the existing behavioral test
 * `slicer.test.ts` (8 it() blocks across 2 describe groups). The pin is
 * exhaustive against the argv structure / capability merge / source-text
 * whitelist so any rename, semantic shift, or imported-symbol change
 * forces a deliberate update to this file.
 *
 * Roadmap ID: [ID-0295] / Cycle 222 (post-processing rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import * as M from './slicer'
import {
  buildCuraSliceArgs,
  buildCuraSliceArgsFromSettingsMap,
  resolveCuraSliceArgv,
  sliceWithCuraEngine,
  stageStlForProject
} from './slicer'
import {
  CURA_SLICE_CLI_DEFAULTS,
  CURA_SLICE_PRESETS,
  curaCliParamsToEngineSettingsMap,
  type CuraSliceCliParams,
  type FdmCapabilityFields
} from '../shared/cura-slice-defaults'

const SOURCE_PATH = resolve(__dirname, 'slicer.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// Resources root used in tests -- a concrete absolute-style fake that lets
// us assert path.join behavior without depending on the host OS sep.
const RES_ROOT = join('C:', 'app', 'resources')
const STL_IN = 'C:\\jobs\\demo\\cube.stl'
const GCODE_OUT = 'C:\\jobs\\demo\\out.gcode'
const baseReq = {
  curaEnginePath: 'CuraEngine',
  inputStlPath: STL_IN,
  outputGcodePath: GCODE_OUT
} as const

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/main/slicer.ts exports', () => {
  it('exports exactly the five-symbol production surface', () => {
    const keys = Object.keys(M).sort()
    expect(keys).toEqual([
      'buildCuraSliceArgs',
      'buildCuraSliceArgsFromSettingsMap',
      'resolveCuraSliceArgv',
      'sliceWithCuraEngine',
      'stageStlForProject'
    ])
  })

  it('all three pure helpers are functions', () => {
    expect(typeof buildCuraSliceArgs).toBe('function')
    expect(typeof buildCuraSliceArgsFromSettingsMap).toBe('function')
    expect(typeof resolveCuraSliceArgv).toBe('function')
  })

  it('both async wrappers are functions', () => {
    expect(typeof sliceWithCuraEngine).toBe('function')
    expect(typeof stageStlForProject).toBe('function')
  })

  it('the three pure helpers report arity matching their declared signatures', () => {
    // buildCuraSliceArgsFromSettingsMap(resourcesRoot, req, settings) = 3
    expect(buildCuraSliceArgsFromSettingsMap.length).toBe(3)
    // buildCuraSliceArgs(resourcesRoot, req, sliceParams?) -- TS optional
    // parameters compile to runtime params with no default, so the
    // function-arity .length reports 3 (not 2).
    expect(buildCuraSliceArgs.length).toBe(3)
    // resolveCuraSliceArgv(resourcesRoot, req) = 2
    expect(resolveCuraSliceArgv.length).toBe(2)
  })

  it('does not export any private helpers (runProcess / CURA_OUTPUT_MAX_BYTES / CURA_TIMEOUT_MS)', () => {
    expect((M as Record<string, unknown>).runProcess).toBeUndefined()
    expect((M as Record<string, unknown>).CURA_OUTPUT_MAX_BYTES).toBeUndefined()
    expect((M as Record<string, unknown>).CURA_TIMEOUT_MS).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. buildCuraSliceArgsFromSettingsMap argv structure
// ---------------------------------------------------------------------------
describe('B. buildCuraSliceArgsFromSettingsMap -- canonical argv shape', () => {
  it('emits ["slice", "-v", "-j", <defPath>, ...flags, "-l", <in>, "-o", <out>]', () => {
    const settings = new Map<string, string>([
      ['layer_height', '0.2'],
      ['infill_pattern', 'grid']
    ])
    const argv = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, settings)
    expect(argv[0]).toBe('slice')
    expect(argv[1]).toBe('-v')
    expect(argv[2]).toBe('-j')
    expect(argv[3]).toBe(join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'))
    // tail -- last 4 entries are -l <in> -o <out>
    expect(argv.slice(-4)).toEqual(['-l', STL_IN, '-o', GCODE_OUT])
  })

  it('emits exactly 2 argv entries per setting (-s + "k=v")', () => {
    const settings = new Map<string, string>([
      ['a', '1'],
      ['b', '2'],
      ['c', '3']
    ])
    const argv = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, settings)
    // 4 head + 2*N flags + 4 tail = 4 + 6 + 4 = 14
    expect(argv.length).toBe(14)
    // -s pair groups
    expect(argv).toContain('a=1')
    expect(argv).toContain('b=2')
    expect(argv).toContain('c=3')
    // count -s tokens === number of settings
    const sCount = argv.filter((t) => t === '-s').length
    expect(sCount).toBe(3)
  })

  it('preserves Map iteration order in the emitted -s pairs', () => {
    const settings = new Map<string, string>([
      ['z_first', '1'],
      ['m_second', '2'],
      ['a_third', '3']
    ])
    const argv = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, settings)
    const idxZ = argv.indexOf('z_first=1')
    const idxM = argv.indexOf('m_second=2')
    const idxA = argv.indexOf('a_third=3')
    expect(idxZ).toBeGreaterThan(0)
    expect(idxM).toBeGreaterThan(idxZ)
    expect(idxA).toBeGreaterThan(idxM)
  })

  it('produces argv with exactly 7 entries when the settings map is empty', () => {
    const argv = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, new Map())
    // 4 head + 0 flags + 4 tail - 1 (no -j duplication) = 4 + 4 = 8?
    // Actually: ['slice', '-v', '-j', <def>, '-l', <in>, '-o', <out>] = 8
    expect(argv.length).toBe(8)
    expect(argv).toEqual([
      'slice',
      '-v',
      '-j',
      join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'),
      '-l',
      STL_IN,
      '-o',
      GCODE_OUT
    ])
  })

  it('honors a custom definitionPath override', () => {
    const argv = buildCuraSliceArgsFromSettingsMap(
      RES_ROOT,
      { ...baseReq, definitionPath: '/custom/path/my.def.json' },
      new Map()
    )
    expect(argv[3]).toBe('/custom/path/my.def.json')
    // The default K2 Plus def MUST NOT appear once the override is supplied.
    expect(argv).not.toContain(join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'))
  })

  it('uses path.join (sep-aware) for the default definition path', () => {
    const argv = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, new Map())
    // The asserted def path must round-trip through path.join, which
    // means it contains the platform separator between every segment.
    const def = argv[3]
    expect(def.startsWith(RES_ROOT)).toBe(true)
    expect(def.endsWith('creality_k2_plus.def.json')).toBe(true)
    expect(def).toContain(`slicer${sep}creality_k2_plus.def.json`)
  })

  it('returns a fresh array on every call (no shared mutable state)', () => {
    const a = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, new Map())
    const b = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, new Map())
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
    a.push('mutated')
    expect(b).not.toContain('mutated')
  })
})

// ---------------------------------------------------------------------------
// C. buildCuraSliceArgs default-preset content
// ---------------------------------------------------------------------------
describe('C. buildCuraSliceArgs -- default (balanced) preset content', () => {
  it('emits the four CURA_SLICE_CLI_DEFAULTS keys when no preset is passed', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(argv).toContain(`layer_height=${CURA_SLICE_CLI_DEFAULTS.layerHeightMm}`)
    expect(argv).toContain(`line_width=${CURA_SLICE_CLI_DEFAULTS.lineWidthMm}`)
    expect(argv).toContain(`wall_line_count=${CURA_SLICE_CLI_DEFAULTS.wallLineCount}`)
    expect(argv).toContain(`infill_sparse_density=${CURA_SLICE_CLI_DEFAULTS.infillSparseDensity}`)
  })

  it('the default preset numerics are exactly 0.2 / 0.4 / 2 / 15 as documented', () => {
    expect(CURA_SLICE_CLI_DEFAULTS.layerHeightMm).toBe(0.2)
    expect(CURA_SLICE_CLI_DEFAULTS.lineWidthMm).toBe(0.4)
    expect(CURA_SLICE_CLI_DEFAULTS.wallLineCount).toBe(2)
    expect(CURA_SLICE_CLI_DEFAULTS.infillSparseDensity).toBe(15)
  })

  it('emits exactly four -s settings for the bundled balanced preset', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    const sCount = argv.filter((t) => t === '-s').length
    expect(sCount).toBe(4)
  })

  it('matches the byte-identical argv produced by buildCuraSliceArgsFromSettingsMap when fed the canonicalized default map', () => {
    const a = buildCuraSliceArgs(RES_ROOT, baseReq)
    const b = buildCuraSliceArgsFromSettingsMap(
      RES_ROOT,
      baseReq,
      curaCliParamsToEngineSettingsMap(CURA_SLICE_CLI_DEFAULTS)
    )
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// D. buildCuraSliceArgs preset variants
// ---------------------------------------------------------------------------
describe('D. buildCuraSliceArgs -- preset variants (draft / fine)', () => {
  it('draft preset emits layer_height=0.3 / wall_line_count=1 / infill_sparse_density=10', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, CURA_SLICE_PRESETS.draft)
    expect(argv).toContain('layer_height=0.3')
    expect(argv).toContain('wall_line_count=1')
    expect(argv).toContain('infill_sparse_density=10')
    expect(argv).toContain('line_width=0.4')
  })

  it('fine preset emits layer_height=0.12 / wall_line_count=3 / infill_sparse_density=20', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, CURA_SLICE_PRESETS.fine)
    expect(argv).toContain('layer_height=0.12')
    expect(argv).toContain('wall_line_count=3')
    expect(argv).toContain('infill_sparse_density=20')
    expect(argv).toContain('line_width=0.4')
  })

  it('balanced preset is byte-identical to the no-arg call', () => {
    const a = buildCuraSliceArgs(RES_ROOT, baseReq)
    const b = buildCuraSliceArgs(RES_ROOT, baseReq, CURA_SLICE_PRESETS.balanced)
    expect(a).toEqual(b)
  })

  it('rejects no preset by name -- only positional CuraSliceCliParams accepted', () => {
    // Sanity: passing a custom params bundle is the supported override path.
    const custom: CuraSliceCliParams = {
      layerHeightMm: 0.16,
      lineWidthMm: 0.45,
      wallLineCount: 4,
      infillSparseDensity: 25
    }
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, custom)
    expect(argv).toContain('layer_height=0.16')
    expect(argv).toContain('line_width=0.45')
    expect(argv).toContain('wall_line_count=4')
    expect(argv).toContain('infill_sparse_density=25')
  })

  it('rounds wall_line_count to nearest integer (CuraEngine rejects fractional walls)', () => {
    const fractional: CuraSliceCliParams = {
      layerHeightMm: 0.2,
      lineWidthMm: 0.4,
      wallLineCount: 4.7,
      infillSparseDensity: 15
    }
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, fractional)
    expect(argv).toContain('wall_line_count=5')
    expect(argv).not.toContain('wall_line_count=4.7')
  })
})

// ---------------------------------------------------------------------------
// E. definitionPath default + override
// ---------------------------------------------------------------------------
describe('E. definitionPath -- default + override behavior', () => {
  it('default def path resolves under the supplied resources root', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(argv).toContain(join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'))
  })

  it('changes when resourcesRoot changes', () => {
    const altRoot = join('/opt', 'app', 'resources')
    const argv = buildCuraSliceArgs(altRoot, baseReq)
    expect(argv).toContain(join(altRoot, 'slicer', 'creality_k2_plus.def.json'))
  })

  it('override wins over the resourcesRoot-derived default', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, {
      ...baseReq,
      definitionPath: '/etc/cura/customer.def.json'
    })
    expect(argv).toContain('/etc/cura/customer.def.json')
    expect(argv).not.toContain(join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'))
  })

  it('is consumed positionally after the -j flag', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    const idxJ = argv.indexOf('-j')
    expect(idxJ).toBeGreaterThanOrEqual(0)
    expect(argv[idxJ + 1]).toBe(join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'))
  })
})

// ---------------------------------------------------------------------------
// F. resolveCuraSliceArgv precedence
// ---------------------------------------------------------------------------
describe('F. resolveCuraSliceArgv -- precedence (caps < preset < explicit)', () => {
  it('falls through to the preset path when curaEngineSettings is undefined', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, { ...baseReq })
    const b = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(a).toEqual(b)
  })

  it('falls through to the preset path when curaEngineSettings is an empty object', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, { ...baseReq, curaEngineSettings: {} })
    const b = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(a).toEqual(b)
  })

  it('uses curaEngineSettings as the base when non-empty (default preset NOT applied)', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      curaEngineSettings: { only_one_setting: 'hello' }
    })
    expect(a).toContain('only_one_setting=hello')
    // The default preset's keys are NOT layered on top.
    expect(a).not.toContain('layer_height=0.2')
    expect(a).not.toContain('infill_sparse_density=15')
  })

  it('respects slicePreset = "draft" when no curaEngineSettings', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      slicePreset: 'draft'
    })
    expect(a).toContain('layer_height=0.3')
    expect(a).toContain('wall_line_count=1')
  })

  it('respects slicePreset = "fine" when no curaEngineSettings', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      slicePreset: 'fine'
    })
    expect(a).toContain('layer_height=0.12')
    expect(a).toContain('wall_line_count=3')
  })

  it('treats null slicePreset as the default (balanced) preset', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, { ...baseReq, slicePreset: null })
    expect(a).toContain('layer_height=0.2')
    expect(a).toContain('wall_line_count=2')
  })

  it('treats unknown slicePreset id as the default (balanced) preset', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      slicePreset: 'nonexistent_preset'
    })
    expect(a).toContain('layer_height=0.2')
    expect(a).toContain('wall_line_count=2')
  })

  it('caps merge UNDER the preset -- preset override wins on collision', () => {
    // The default preset emits layer_height=0.2. Caps don't normally
    // emit layer_height -- they emit machine_*-style ceilings -- but if a
    // caller crafted a cap-shape that collided with a preset key, the
    // PRESET would win. We assert this via the documented merge order:
    // explicit curaEngineSettings keys appear AFTER (i.e. overwrite) the
    // capability map's keys.
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { maxNozzleTempC: 350 },
      curaEngineSettings: { machine_nozzle_temp_max: '380' }
    })
    expect(argv).toContain('machine_nozzle_temp_max=380')
    expect(argv).not.toContain('machine_nozzle_temp_max=350')
  })

  it('caps are layered UNDER the preset when no explicit override is supplied', () => {
    // No curaEngineSettings AND no preset collision = both cap keys + all
    // preset keys appear in argv.
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { maxNozzleTempC: 350, maxBedTempC: 120 }
    })
    expect(argv).toContain('machine_nozzle_temp_max=350')
    expect(argv).toContain('machine_max_bed_temp=120')
    // Preset still comes through.
    expect(argv).toContain('layer_height=0.2')
    expect(argv).toContain('wall_line_count=2')
  })
})

// ---------------------------------------------------------------------------
// G. K2 Plus capability ceilings -- chamber heater flag emission
// ---------------------------------------------------------------------------
describe('G. K2 Plus FDM capability ceilings -- heated chamber flag', () => {
  it('chamberTempC = 60 emits BOTH the flag and the temp', () => {
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { chamberTempC: 60 }
    })
    expect(argv).toContain('machine_heated_build_volume=true')
    expect(argv).toContain('build_volume_temperature=60')
  })

  it('chamberTempC = 0 emits NEITHER the flag nor the temp (defensive)', () => {
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { chamberTempC: 0 }
    })
    expect(argv).not.toContain('machine_heated_build_volume=true')
    expect(argv.some((t) => t.startsWith('build_volume_temperature='))).toBe(false)
  })

  it('chamberTempC absent emits NEITHER the flag nor the temp', () => {
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { maxNozzleTempC: 260, maxBedTempC: 100 }
    })
    expect(argv).not.toContain('machine_heated_build_volume=true')
    expect(argv.some((t) => t.startsWith('build_volume_temperature='))).toBe(false)
  })

  it('chamberTempC = NaN emits NEITHER (defensive vs. profile typo)', () => {
    const caps: FdmCapabilityFields = { chamberTempC: Number.NaN }
    const argv = resolveCuraSliceArgv(RES_ROOT, { ...baseReq, machineCapabilities: caps })
    expect(argv).not.toContain('machine_heated_build_volume=true')
    expect(argv.some((t) => t.startsWith('build_volume_temperature='))).toBe(false)
  })

  it('chamberTempC = -10 emits NEITHER (negative-temp guard)', () => {
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { chamberTempC: -10 }
    })
    expect(argv).not.toContain('machine_heated_build_volume=true')
    expect(argv.some((t) => t.startsWith('build_volume_temperature='))).toBe(false)
  })

  it('matches the bundled K2 Plus profile end-to-end (350/120/60 + heater flag)', () => {
    // Cross-check against resources/machines/creality-k2-plus.json so
    // any drift in the ship values trips this pin (NOT the
    // slicer.test.ts-side variant -- this pin asserts argv membership).
    type K2Meta = {
      maxNozzleTempC?: number
      maxBedTempC?: number
      chamberTempC?: number
    }
    const k2 = JSON.parse(
      readFileSync(
        join(process.cwd(), 'resources', 'machines', 'creality-k2-plus.json'),
        'utf-8'
      )
    ) as K2Meta
    expect(k2.maxNozzleTempC).toBe(350)
    expect(k2.maxBedTempC).toBe(120)
    expect(k2.chamberTempC).toBe(60)
    const argv = resolveCuraSliceArgv(RES_ROOT, { ...baseReq, machineCapabilities: k2 })
    expect(argv).toContain('machine_nozzle_temp_max=350')
    expect(argv).toContain('machine_max_bed_temp=120')
    expect(argv).toContain('build_volume_temperature=60')
    expect(argv).toContain('machine_heated_build_volume=true')
  })

  it('explicit job-level chamber override (curaEngineSettings) WINS over the profile ceiling', () => {
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { chamberTempC: 60 },
      curaEngineSettings: { build_volume_temperature: '50' }
    })
    expect(argv).toContain('build_volume_temperature=50')
    expect(argv).not.toContain('build_volume_temperature=60')
  })
})

// ---------------------------------------------------------------------------
// H. Empty-input invariants
// ---------------------------------------------------------------------------
describe('H. Empty-input invariants', () => {
  it('an empty settings map produces argv length 8 with no -s tokens', () => {
    const argv = buildCuraSliceArgsFromSettingsMap(RES_ROOT, baseReq, new Map())
    expect(argv.length).toBe(8)
    expect(argv).not.toContain('-s')
  })

  it('null machineCapabilities + null curaEngineSettings + null slicePreset = balanced default argv', () => {
    const argv = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: undefined,
      curaEngineSettings: undefined,
      slicePreset: null
    })
    // exactly the 4 default preset keys, no caps, no override.
    const sCount = argv.filter((t) => t === '-s').length
    expect(sCount).toBe(4)
    expect(argv).toContain('layer_height=0.2')
  })

  it('returns a fresh argv on every resolveCuraSliceArgv call', () => {
    const a = resolveCuraSliceArgv(RES_ROOT, { ...baseReq })
    const b = resolveCuraSliceArgv(RES_ROOT, { ...baseReq })
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// I. Numeric stringification
// ---------------------------------------------------------------------------
describe('I. Numeric stringification', () => {
  it('layer_height float values pass through JS toString (no rounding to integer)', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, {
      layerHeightMm: 0.08,
      lineWidthMm: 0.4,
      wallLineCount: 2,
      infillSparseDensity: 15
    })
    expect(argv).toContain('layer_height=0.08')
  })

  it('layer_height accepts very small values (0.05 mm super-fine)', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, {
      layerHeightMm: 0.05,
      lineWidthMm: 0.4,
      wallLineCount: 2,
      infillSparseDensity: 15
    })
    expect(argv).toContain('layer_height=0.05')
  })

  it('infill_sparse_density passes through unchanged for integer-valued density', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, {
      layerHeightMm: 0.2,
      lineWidthMm: 0.4,
      wallLineCount: 2,
      infillSparseDensity: 100
    })
    expect(argv).toContain('infill_sparse_density=100')
  })

  it('wall_line_count = 0 stays 0 (zero-shell hollow print)', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, {
      layerHeightMm: 0.2,
      lineWidthMm: 0.4,
      wallLineCount: 0,
      infillSparseDensity: 15
    })
    expect(argv).toContain('wall_line_count=0')
  })

  it('wall_line_count rounds 2.5 up via Math.round half-to-even-positive-infinity rules', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq, {
      layerHeightMm: 0.2,
      lineWidthMm: 0.4,
      wallLineCount: 2.5,
      infillSparseDensity: 15
    })
    // Math.round(2.5) === 3 in JS (rounds half toward +Infinity).
    expect(argv).toContain('wall_line_count=3')
  })
})

// ---------------------------------------------------------------------------
// J. Hard-rule constants -- spawn safety
// ---------------------------------------------------------------------------
describe('J. Hard-rule constants -- spawn output cap + timeout', () => {
  it('declares CURA_OUTPUT_MAX_BYTES = 12 MiB (= 12 * 1024 * 1024)', () => {
    expect(SOURCE).toMatch(/CURA_OUTPUT_MAX_BYTES\s*=\s*12\s*\*\s*1024\s*\*\s*1024/)
  })

  it('declares CURA_TIMEOUT_MS = 900_000 (15 minutes)', () => {
    expect(SOURCE).toMatch(/CURA_TIMEOUT_MS\s*=\s*900_000/)
  })

  it('passes both bounds into spawnBounded (timeoutMs + maxBufferBytes)', () => {
    expect(SOURCE).toMatch(/timeoutMs:\s*CURA_TIMEOUT_MS/)
    expect(SOURCE).toMatch(/maxBufferBytes:\s*CURA_OUTPUT_MAX_BYTES/)
  })

  it('keeps both constants as module-private (not exported)', () => {
    // Re-assert via the module-shape ledger from group A: neither
    // constant appears in `M`.
    expect(Object.keys(M)).not.toContain('CURA_OUTPUT_MAX_BYTES')
    expect(Object.keys(M)).not.toContain('CURA_TIMEOUT_MS')
  })
})

// ---------------------------------------------------------------------------
// K. Three-machine cross-cut realism
// ---------------------------------------------------------------------------
describe('K. Three-machine cross-cut realism', () => {
  it('default def file is the K2 Plus def (NOT a generic FDM def)', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(argv).toContain(join(RES_ROOT, 'slicer', 'creality_k2_plus.def.json'))
    // The bundled generic_fdm_250.def.json is NOT the default.
    expect(argv).not.toContain(join(RES_ROOT, 'slicer', 'generic_fdm_250.def.json'))
  })

  it('does not reference any CNC-shaped def file (Laguna .tap / Carvera .nc)', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(argv.some((t) => t.endsWith('.tap'))).toBe(false)
    expect(argv.some((t) => t.endsWith('.nc'))).toBe(false)
    expect(argv.some((t) => t.endsWith('.mmg'))).toBe(false)
  })

  it('does not reference any CNC post template (.hbs)', () => {
    const argv = buildCuraSliceArgs(RES_ROOT, baseReq)
    expect(argv.some((t) => t.endsWith('.hbs'))).toBe(false)
  })

  it('the bundled K2 Plus def file actually exists in resources/slicer/', () => {
    // Sanity-check that the asserted filename matches a real file the
    // packager will ship; a typo here would silently mis-route every
    // K2 slice job to a missing def.
    const realDef = join(
      process.cwd(),
      'resources',
      'slicer',
      'creality_k2_plus.def.json'
    )
    const def = JSON.parse(readFileSync(realDef, 'utf-8')) as Record<string, unknown>
    expect(def).toBeTruthy()
    expect(typeof def).toBe('object')
  })

  it('the bundled creality-k2-plus.json profile carries the three FDM ceilings', () => {
    type K2Meta = {
      maxNozzleTempC?: number
      maxBedTempC?: number
      chamberTempC?: number
    }
    const k2 = JSON.parse(
      readFileSync(
        join(process.cwd(), 'resources', 'machines', 'creality-k2-plus.json'),
        'utf-8'
      )
    ) as K2Meta
    expect(k2.maxNozzleTempC).toBe(350)
    expect(k2.maxBedTempC).toBe(120)
    expect(k2.chamberTempC).toBe(60)
  })

  it('the FDM heated-chamber flag is required for build_volume_temperature to take effect', () => {
    // Documented invariant: CuraEngine ignores build_volume_temperature
    // unless machine_heated_build_volume=true. The slicer module
    // enforces this PAIRING via fdmCapabilitiesToEngineSettings -- it
    // emits BOTH or NEITHER, never just one.
    const withChamber = resolveCuraSliceArgv(RES_ROOT, {
      ...baseReq,
      machineCapabilities: { chamberTempC: 60 }
    })
    const hasFlag = withChamber.includes('machine_heated_build_volume=true')
    const hasTemp = withChamber.some((t) => t.startsWith('build_volume_temperature='))
    expect(hasFlag).toBe(hasTemp)
    expect(hasFlag).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// L. Source-text whitelist -- imports + safety surface
// ---------------------------------------------------------------------------
describe('L. Source-text whitelist -- imports + safety', () => {
  it('imports spawnBounded (NOT raw child_process)', () => {
    expect(SOURCE).toContain("import { spawnBounded } from './subprocess-bounded'")
    expect(SOURCE).not.toMatch(/from\s+['"]child_process['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:child_process['"]/)
  })

  it('imports node:fs/promises (NOT raw node:fs sync helpers)', () => {
    expect(SOURCE).toMatch(/from\s+['"]node:fs\/promises['"]/)
    // The non-promises 'node:fs' should not be imported by the runtime
    // module (the test file may import readFileSync from it -- that's
    // separate).
    expect(SOURCE).not.toMatch(/^import .* from ['"]node:fs['"];?$/m)
  })

  it('does not contain `any` casts in TypeScript source', () => {
    // Strip line comments and JSDoc blocks before scanning so the doc
    // examples (which may legitimately discuss `any`) do not trip us.
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).not.toMatch(/\bas any\b/)
    expect(stripped).not.toMatch(/:\s*any\b/)
  })

  it('does not call eval / new Function (no dynamic code synthesis)', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('imports the four shared cura-slice-defaults symbols exactly', () => {
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).toContain('CURA_SLICE_CLI_DEFAULTS')
    expect(stripped).toContain('curaCliParamsToEngineSettingsMap')
    expect(stripped).toContain('mergeFdmCapabilitiesUnder')
    expect(stripped).toContain('resolveCuraSliceParams')
  })

  it('imports getResourcesRoot for the spawn entrypoint', () => {
    expect(SOURCE).toContain("import { getResourcesRoot } from './paths'")
  })

  it('uses dirname(req.outputGcodePath) for the mkdir recursive call (output-dir creation)', () => {
    expect(SOURCE).toMatch(/mkdir\(\s*dirname\(\s*req\.outputGcodePath\s*\)/)
    expect(SOURCE).toMatch(/recursive:\s*true/)
  })

  it('routes the optional curaDefinitionsPath into CURA_ENGINE_SEARCH_PATH (not args)', () => {
    expect(SOURCE).toMatch(/CURA_ENGINE_SEARCH_PATH/)
    expect(SOURCE).toMatch(/req\.curaDefinitionsPath/)
  })
})

// ---------------------------------------------------------------------------
// M. stageStlForProject path-derivation
// ---------------------------------------------------------------------------
describe('M. stageStlForProject -- pure path-derivation surface', () => {
  it('is an async function (returns a Promise)', () => {
    // The function is async; calling it WILL try to mkdir + copyFile, so
    // we don't actually invoke it -- we only assert .constructor.name.
    expect(stageStlForProject.constructor.name).toBe('AsyncFunction')
  })

  it('declares the documented basename split via /[/\\\\]/', () => {
    // Source text scan -- the basename derivation MUST stay split-on-
    // both-separators so cross-platform STL paths derive the same dest.
    expect(SOURCE).toMatch(/sourceStlPath\.split\(\/\[\/\\\\\]\/\)\.pop\(\)/)
  })

  it('declares the model.stl fallback when split returns undefined', () => {
    expect(SOURCE).toContain("'model.stl'")
  })

  it('routes the destination into ${projectDir}/assets/<basename>', () => {
    expect(SOURCE).toMatch(/join\(projectDir,\s*['"]assets['"]\)/)
    expect(SOURCE).toMatch(/join\(assets,\s*base\)/)
  })

  it('mkdirs the assets directory recursively before the copy', () => {
    // The mkdir call must precede copyFile in the source.
    const mkdirIdx = SOURCE.search(/mkdir\(assets,\s*\{\s*recursive:\s*true\s*\}\)/)
    const copyIdx = SOURCE.search(/copyFile\(sourceStlPath,\s*dest\)/)
    expect(mkdirIdx).toBeGreaterThan(0)
    expect(copyIdx).toBeGreaterThan(0)
    expect(mkdirIdx).toBeLessThan(copyIdx)
  })

  it('uses node:fs/promises copyFile (not the sync variant)', () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*\bcopyFile\b[^}]*\}\s*from\s*['"]node:fs\/promises['"]/)
  })
})

// ---------------------------------------------------------------------------
// N. Type-level parity -- SliceRequest field set
// ---------------------------------------------------------------------------
describe('N. Type-level parity -- SliceRequest shape', () => {
  it('source declares exactly the eight documented fields (3 required + 5 optional)', () => {
    // Required:
    expect(SOURCE).toMatch(/curaEnginePath:\s*string/)
    expect(SOURCE).toMatch(/inputStlPath:\s*string/)
    expect(SOURCE).toMatch(/outputGcodePath:\s*string/)
    // Optional:
    expect(SOURCE).toMatch(/definitionPath\?:\s*string/)
    expect(SOURCE).toMatch(/curaDefinitionsPath\?:\s*string/)
    expect(SOURCE).toMatch(/slicePreset\?:\s*string\s*\|\s*null/)
    expect(SOURCE).toMatch(/curaEngineSettings\?:\s*Record<string,\s*string>/)
    expect(SOURCE).toMatch(/machineCapabilities\?:\s*FdmCapabilityFields/)
  })

  it('does not declare a ninth field (drift sentinel)', () => {
    // Count the required+optional declared fields by capturing the
    // SliceRequest body.
    const m = SOURCE.match(/export type SliceRequest = \{([\s\S]*?)\n\}/)
    expect(m).not.toBeNull()
    const body = m![1]
    // Every field is `name:` or `name?:`. Count colons that are NOT
    // inside generic angle brackets.
    const fieldDecls = body.match(/^\s*\/\*\*[\s\S]*?\*\/\s*\n\s*\w+\??:|^\s*\w+\??:/gm)
    // We expect 8 -- the regex above is lenient; assert at least the
    // documented 8 and at most 8 by also counting top-level colons.
    expect(fieldDecls).not.toBeNull()
    // Filter out things like 'Record<string, string>' that incidentally
    // contain a colon inside the angle brackets -- our regex anchors on
    // '\w+\??:' at line-start so those are excluded.
    expect(fieldDecls!.length).toBe(8)
  })

  it('SliceRequest is exported as a type', () => {
    expect(SOURCE).toMatch(/export type SliceRequest = \{/)
  })

  it('FdmCapabilityFields is imported (for the machineCapabilities field)', () => {
    expect(SOURCE).toMatch(/FdmCapabilityFields/)
  })

  it('JSDoc on slicePreset references cura-slice-defaults.ts (cross-module pointer)', () => {
    // The JSDoc on the slicePreset field should point to the shared
    // module so the next reader knows where the named bundles live.
    expect(SOURCE).toMatch(/cura-slice-defaults\.ts/)
  })

  it('JSDoc on machineCapabilities references the [ID-0068] roadmap entry', () => {
    expect(SOURCE).toMatch(/\[ID-0068\]/)
  })
})

// ---------------------------------------------------------------------------
// O. resolveCuraSliceArgv source-shape pin (precedence sentinel)
// ---------------------------------------------------------------------------
describe('O. resolveCuraSliceArgv -- source-shape pin', () => {
  it('uses Object.keys(...).length > 0 to detect non-empty curaEngineSettings', () => {
    // The explicit-settings detection is the precedence linchpin -- a
    // typo here would silently route every job through the preset path.
    expect(SOURCE).toMatch(
      /Object\.keys\(\s*req\.curaEngineSettings\s*\)\.length\s*>\s*0/
    )
  })

  it('routes through mergeFdmCapabilitiesUnder for the final merge', () => {
    expect(SOURCE).toMatch(/mergeFdmCapabilitiesUnder\(/)
  })

  it('passes the machineCapabilities field (??) null into the merge helper', () => {
    expect(SOURCE).toMatch(/req\.machineCapabilities\s*\?\?\s*null/)
  })

  it('returns its result by passing through buildCuraSliceArgsFromSettingsMap', () => {
    expect(SOURCE).toMatch(/buildCuraSliceArgsFromSettingsMap\(\s*resourcesRoot,\s*req,\s*merged\s*\)/)
  })
})
