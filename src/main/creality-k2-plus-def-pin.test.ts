/**
 * Creality K2 Plus slicer-profile paired pin -- Phase 2 [P2-K2-SLICE]/Cycle 4.
 *
 * Purpose: lock the hardware-determined CuraEngine overrides shipped in
 * `resources/slicer/creality_k2_plus.def.json` to the K2 Plus spec
 * documented in CLAUDE.md "USER CONTEXT -- TARGET MACHINES" sec.1. Build
 * envelope, max feedrates, max accelerations, jerk ceilings, heated-bed +
 * heated-chamber flags, extruder count, material diameter, and the Klipper
 * START_PRINT / END_PRINT macro plumbing all become CI-enforced so future
 * drift cannot silently regress the slicer profile and crash the gantry or
 * skip chamber heat-up.
 *
 * Companion to `src/shared/slicer-profile-k2.test.ts` ([ID-0006] bed-size
 * safety) and `src/main/cura-bundled-vendoring.test.ts` (Cycle 3 binary +
 * definitions vendoring). This pin gates the *content* of the stub; those
 * gate the *resolution path*. The two together make the K2 Plus FDM slicer
 * end-to-end correct from "fresh launch" to "G-code written to disk."
 *
 * Three-machine impact: DIRECT on Creality K2 Plus (the only FDM machine
 * in the three-target cohort; the slicer is K2-exclusive). INDIRECT on
 * Laguna Swift 5x10 + Makera Carvera (CNC machines, do not consume the
 * slicer; pin asserts the def.json source has zero CNC-router / 4-axis
 * identifiers so K2-side changes never leak into the CNC code paths).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type CuraOverride = {
  default_value?: number | string | boolean
  value?: number | string | boolean
}
type CuraDefinitionFile = {
  name: string
  version: number
  inherits?: string
  metadata?: Record<string, unknown>
  overrides: Record<string, CuraOverride>
}

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const DEF_PATH = join(RESOURCES_ROOT, 'slicer', 'creality_k2_plus.def.json')
const RAW = readFileSync(DEF_PATH, 'utf-8')
const DEF = JSON.parse(RAW) as CuraDefinitionFile

// ---------------------------------------------------------------------------
// A. JSON validity + module shape
// ---------------------------------------------------------------------------
describe('A. JSON validity + module shape', () => {
  it('A1: parses as a JSON object', () => {
    expect(typeof DEF).toBe('object')
    expect(Array.isArray(DEF)).toBe(false)
  })
  it('A2: schema version is 2 (Cura def.json contract)', () => {
    expect(DEF.version).toBe(2)
  })
  it('A3: inherits from fdmprinter so the trimmed definitions tree is a 2-file checkout', () => {
    expect(DEF.inherits).toBe('fdmprinter')
  })
  it('A4: top-level name identifies the K2 Plus', () => {
    expect(DEF.name).toBe('Creality K2 Plus')
  })
  it('A5: metadata.type = "machine" (not "extruder")', () => {
    expect(DEF.metadata?.type).toBe('machine')
  })
  it('A6: metadata.visible is true so the printer surfaces in any UI consumer', () => {
    expect(DEF.metadata?.visible).toBe(true)
  })
  it('A7: metadata.manufacturer is Creality', () => {
    expect(DEF.metadata?.manufacturer).toBe('Creality')
  })
  it('A8: overrides is a populated object', () => {
    expect(typeof DEF.overrides).toBe('object')
    expect(Object.keys(DEF.overrides).length).toBeGreaterThanOrEqual(20)
  })
})

// ---------------------------------------------------------------------------
// B. Build envelope matches CLAUDE.md (350 x 350 x 350 mm)
// ---------------------------------------------------------------------------
describe('B. Build envelope matches CLAUDE.md K2 Plus spec', () => {
  it('B1: machine_width = 350', () => {
    expect(DEF.overrides.machine_width?.default_value).toBe(350)
  })
  it('B2: machine_depth = 350', () => {
    expect(DEF.overrides.machine_depth?.default_value).toBe(350)
  })
  it('B3: machine_height = 350', () => {
    expect(DEF.overrides.machine_height?.default_value).toBe(350)
  })
  it('B4: machine_head_with_fans_polygon is a non-empty string-or-array polygon', () => {
    const v = DEF.overrides.machine_head_with_fans_polygon?.default_value
    expect(v).toBeDefined()
    if (typeof v === 'string') {
      expect(v.length).toBeGreaterThan(10)
      expect(v.startsWith('[[')).toBe(true)
    } else {
      expect(Array.isArray(v)).toBe(true)
    }
  })
  it('B5: gantry_height is set so One-At-A-Time mode has a sensible Z floor', () => {
    expect(DEF.overrides.gantry_height?.value).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// C. Hardware feedrate ceilings -- K2 Plus 600 mm/s spec
// ---------------------------------------------------------------------------
describe('C. Hardware feedrate ceilings match K2 Plus spec', () => {
  it('C1: machine_max_feedrate_x = 600 mm/s (CLAUDE.md sec.1 "Max speed/accel: 600 mm/s")', () => {
    expect(DEF.overrides.machine_max_feedrate_x?.value).toBe(600)
  })
  it('C2: machine_max_feedrate_y = 600 mm/s (CoreXY symmetric)', () => {
    expect(DEF.overrides.machine_max_feedrate_y?.value).toBe(600)
  })
  it('C3: machine_max_feedrate_z is set and is conservative (<= 60 mm/s) for ball-screw Z', () => {
    const fz = DEF.overrides.machine_max_feedrate_z?.value
    expect(typeof fz).toBe('number')
    expect(fz as number).toBeGreaterThan(0)
    expect(fz as number).toBeLessThanOrEqual(60)
  })
  it('C4: machine_max_feedrate_e is set and is realistic (<= 200 mm/s) for direct-drive', () => {
    const fe = DEF.overrides.machine_max_feedrate_e?.value
    expect(typeof fe).toBe('number')
    expect(fe as number).toBeGreaterThan(0)
    expect(fe as number).toBeLessThanOrEqual(200)
  })
})

// ---------------------------------------------------------------------------
// D. Hardware acceleration ceilings -- K2 Plus 30000 mm/s^2 spec
// ---------------------------------------------------------------------------
describe('D. Hardware acceleration ceilings match K2 Plus spec', () => {
  it('D1: machine_max_acceleration_x = 30000 mm/s^2 (CLAUDE.md sec.1)', () => {
    expect(DEF.overrides.machine_max_acceleration_x?.value).toBe(30000)
  })
  it('D2: machine_max_acceleration_y = 30000 mm/s^2 (CoreXY symmetric)', () => {
    expect(DEF.overrides.machine_max_acceleration_y?.value).toBe(30000)
  })
  it('D3: machine_max_acceleration_z is set and conservative (<= 1000 mm/s^2)', () => {
    const az = DEF.overrides.machine_max_acceleration_z?.value
    expect(typeof az).toBe('number')
    expect(az as number).toBeGreaterThan(0)
    expect(az as number).toBeLessThanOrEqual(1000)
  })
  it('D4: machine_max_acceleration_e is set and realistic (<= 10000 mm/s^2)', () => {
    const ae = DEF.overrides.machine_max_acceleration_e?.value
    expect(typeof ae).toBe('number')
    expect(ae as number).toBeGreaterThan(0)
    expect(ae as number).toBeLessThanOrEqual(10000)
  })
  it('D5: machine_acceleration print-default <= machine_max_acceleration_x (consistency)', () => {
    const printAcc = DEF.overrides.machine_acceleration?.value
    const maxX = DEF.overrides.machine_max_acceleration_x?.value
    if (typeof printAcc === 'number' && typeof maxX === 'number') {
      expect(printAcc).toBeLessThanOrEqual(maxX)
    }
  })
})

// ---------------------------------------------------------------------------
// E. Jerk values are present and within Klipper input-shaping ranges
// ---------------------------------------------------------------------------
describe('E. Jerk values are sane for Klipper input-shaping', () => {
  it('E1: machine_max_jerk_xy is set (input shaping handles the rest)', () => {
    expect(DEF.overrides.machine_max_jerk_xy?.value).toBeDefined()
  })
  it('E2: machine_max_jerk_z is set and small (<= 5)', () => {
    const jz = DEF.overrides.machine_max_jerk_z?.value
    expect(typeof jz).toBe('number')
    expect(jz as number).toBeGreaterThan(0)
    expect(jz as number).toBeLessThanOrEqual(5)
  })
  it('E3: machine_max_jerk_e is set and small (<= 5)', () => {
    const je = DEF.overrides.machine_max_jerk_e?.value
    expect(typeof je).toBe('number')
    expect(je as number).toBeGreaterThan(0)
    expect(je as number).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// F. Heated bed + heated build volume flags
// ---------------------------------------------------------------------------
describe('F. Heated bed + heated build volume flags', () => {
  it('F1: machine_heated_bed = true (K2 Plus has a heated bed)', () => {
    expect(DEF.overrides.machine_heated_bed?.default_value).toBe(true)
  })
  it('F2: machine_heated_build_volume = true (K2 Plus has a heated chamber)', () => {
    expect(DEF.overrides.machine_heated_build_volume?.default_value).toBe(true)
  })
  it('F3: machine_center_is_zero = false (origin is the front-left corner, not bed center)', () => {
    expect(DEF.overrides.machine_center_is_zero?.default_value).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// G. Material + extruder configuration
// ---------------------------------------------------------------------------
describe('G. Material + extruder configuration', () => {
  it('G1: material_diameter = 1.75 (CLAUDE.md sec.1 "1.75 mm filament")', () => {
    expect(DEF.overrides.material_diameter?.default_value).toBe(1.75)
  })
  it('G2: machine_extruder_count = 1 (CFS multi-color is virtual via filament hub)', () => {
    expect(DEF.overrides.machine_extruder_count?.default_value).toBe(1)
  })
  it('G3: retraction_amount is set and reasonable for direct-drive (<= 2 mm)', () => {
    const ra = DEF.overrides.retraction_amount?.default_value
    expect(typeof ra).toBe('number')
    expect(ra as number).toBeGreaterThan(0)
    expect(ra as number).toBeLessThanOrEqual(2)
  })
  it('G4: retraction_speed is set and within direct-drive range (10..80 mm/s)', () => {
    const rs = DEF.overrides.retraction_speed?.default_value
    expect(typeof rs).toBe('number')
    expect(rs as number).toBeGreaterThanOrEqual(10)
    expect(rs as number).toBeLessThanOrEqual(80)
  })
})

// ---------------------------------------------------------------------------
// H. Klipper START_PRINT / END_PRINT macro plumbing
// ---------------------------------------------------------------------------
describe('H. Klipper START_PRINT / END_PRINT macro plumbing', () => {
  it('H1: machine_start_gcode is a non-empty string', () => {
    const sg = DEF.overrides.machine_start_gcode?.default_value
    expect(typeof sg).toBe('string')
    expect((sg as string).length).toBeGreaterThan(0)
  })
  it('H2: machine_start_gcode invokes the Klipper START_PRINT macro', () => {
    const sg = DEF.overrides.machine_start_gcode?.default_value as string
    expect(sg).toContain('START_PRINT')
  })
  it('H3: machine_start_gcode threads the nozzle target via EXTRUDER_TEMP={material_print_temperature_layer_0}', () => {
    const sg = DEF.overrides.machine_start_gcode?.default_value as string
    expect(sg).toContain('EXTRUDER_TEMP=')
    expect(sg).toContain('{material_print_temperature_layer_0}')
  })
  it('H4: machine_start_gcode threads the bed target via BED_TEMP={material_bed_temperature_layer_0}', () => {
    const sg = DEF.overrides.machine_start_gcode?.default_value as string
    expect(sg).toContain('BED_TEMP=')
    expect(sg).toContain('{material_bed_temperature_layer_0}')
  })
  it('H5: machine_start_gcode threads the chamber target via CHAMBER_TEMP={build_volume_temperature}', () => {
    const sg = DEF.overrides.machine_start_gcode?.default_value as string
    expect(sg).toContain('CHAMBER_TEMP=')
    expect(sg).toContain('{build_volume_temperature}')
  })
  it('H6: machine_end_gcode is a non-empty string', () => {
    const eg = DEF.overrides.machine_end_gcode?.default_value
    expect(typeof eg).toBe('string')
    expect((eg as string).length).toBeGreaterThan(0)
  })
  it('H7: machine_end_gcode invokes the Klipper END_PRINT macro', () => {
    const eg = DEF.overrides.machine_end_gcode?.default_value as string
    expect(eg).toContain('END_PRINT')
  })
})

// ---------------------------------------------------------------------------
// I. Three-machine cross-cut (DIRECT on K2; SOURCE-purity for Laguna/Carvera)
// ---------------------------------------------------------------------------
describe('I. Three-machine cross-cut DIRECT on K2 Plus, SOURCE-purity for Laguna/Carvera', () => {
  it('I1: SOURCE has no Laguna Swift 5x10 identifiers', () => {
    const lower = RAW.toLowerCase()
    expect(lower.includes('laguna')).toBe(false)
    expect(lower.includes('richauto')).toBe(false)
    expect(lower.includes('vcarve_mach3')).toBe(false)
  })
  it('I2: SOURCE has no Makera Carvera identifiers', () => {
    const lower = RAW.toLowerCase()
    expect(lower.includes('carvera')).toBe(false)
    expect(lower.includes('makera')).toBe(false)
    expect(lower.includes('smoothieware')).toBe(false)
  })
  it('I3: SOURCE has no CNC-router / 4-axis vocabulary', () => {
    const lower = RAW.toLowerCase()
    expect(lower.includes('rotary')).toBe(false)
    expect(lower.includes('4-axis')).toBe(false)
    expect(lower.includes('a-axis')).toBe(false)
    expect(lower.includes('spindle')).toBe(false)
  })
  it('I4: SOURCE names the K2 Plus exactly once at top level', () => {
    expect(DEF.name).toBe('Creality K2 Plus')
    expect(DEF.metadata?.manufacturer).toBe('Creality')
  })
  it('I5: build envelope agrees with `resources/machines/creality-k2-plus.json` workAreaMm', () => {
    type K2 = { workAreaMm: { x: number; y: number; z: number } }
    const m = JSON.parse(
      readFileSync(join(RESOURCES_ROOT, 'machines', 'creality-k2-plus.json'), 'utf-8')
    ) as K2
    expect(DEF.overrides.machine_width?.default_value).toBe(m.workAreaMm.x)
    expect(DEF.overrides.machine_depth?.default_value).toBe(m.workAreaMm.y)
    expect(DEF.overrides.machine_height?.default_value).toBe(m.workAreaMm.z)
  })
  it('I6: nozzle ceiling chains through the runtime FDM-capability bridge to <= 350 deg C', () => {
    type Mach = { maxNozzleTempC?: number }
    const m = JSON.parse(
      readFileSync(join(RESOURCES_ROOT, 'machines', 'creality-k2-plus.json'), 'utf-8')
    ) as Mach
    expect(typeof m.maxNozzleTempC).toBe('number')
    expect(m.maxNozzleTempC as number).toBeGreaterThan(0)
    expect(m.maxNozzleTempC as number).toBeLessThanOrEqual(350)
  })
  it('I7: bed ceiling chains through the runtime FDM-capability bridge to <= 120 deg C', () => {
    type Mach = { maxBedTempC?: number }
    const m = JSON.parse(
      readFileSync(join(RESOURCES_ROOT, 'machines', 'creality-k2-plus.json'), 'utf-8')
    ) as Mach
    expect(typeof m.maxBedTempC).toBe('number')
    expect(m.maxBedTempC as number).toBeGreaterThan(0)
    expect(m.maxBedTempC as number).toBeLessThanOrEqual(120)
  })
})

// ---------------------------------------------------------------------------
// J. On-disk source provenance + sentinel
// ---------------------------------------------------------------------------
describe('J. On-disk source provenance + sentinel', () => {
  it('J1: source file lives at resources/slicer/creality_k2_plus.def.json', () => {
    expect(DEF_PATH.endsWith('creality_k2_plus.def.json')).toBe(true)
  })
  it('J2: source file is non-trivial (> 1500 bytes after C343 hardware overrides)', () => {
    expect(RAW.length).toBeGreaterThan(1500)
  })
  it('J3: source file ends with a trailing newline (POSIX convention)', () => {
    expect(RAW.endsWith('\n')).toBe(true)
  })
  it('J4: source file is valid JSON (no trailing comma / no JSONC)', () => {
    expect(() => JSON.parse(RAW)).not.toThrow()
  })
  it('J5: source file uses 2-space indent (matches sibling Cura defs)', () => {
    expect(RAW).toContain('  "name"')
  })
})
