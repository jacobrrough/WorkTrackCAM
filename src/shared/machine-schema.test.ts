import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema } from './machine-schema'

const minimalCnc = {
  id: 'cnc1',
  name: 'Bench',
  kind: 'cnc' as const,
  workAreaMm: { x: 200, y: 200, z: 50 },
  maxFeedMmMin: 3000,
  postTemplate: 'grbl_mm.hbs',
  dialect: 'grbl' as const
}

describe('machineProfileSchema', () => {
  it('parses CNC profile', () => {
    const m = machineProfileSchema.parse(minimalCnc)
    expect(m.kind).toBe('cnc')
  })

  it('trims id, name, and postTemplate', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      id: '  cnc1  ',
      name: '  Bench  ',
      postTemplate: '  grbl_mm.hbs  '
    })
    expect(m).toMatchObject({ id: 'cnc1', name: 'Bench', postTemplate: 'grbl_mm.hbs' })
  })

  it('rejects empty id, name, or postTemplate after trim', () => {
    expect(() => machineProfileSchema.parse({ ...minimalCnc, id: '' })).toThrow()
    expect(() => machineProfileSchema.parse({ ...minimalCnc, name: '   ' })).toThrow()
    expect(() => machineProfileSchema.parse({ ...minimalCnc, postTemplate: '' })).toThrow()
  })

  it('allows optional CPS import meta', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      meta: { source: 'user', importedFromCps: true, cpsOriginalBasename: 'foo.cps' }
    })
    expect(m.meta).toMatchObject({ importedFromCps: true, cpsOriginalBasename: 'foo.cps' })
  })

  it('parses 4-axis machine profile with axisCount and aAxisRangeDeg', () => {
    const fourAxis = {
      ...minimalCnc,
      id: 'makera-carvera-4axis',
      name: 'Makera Carvera (4th Axis)',
      postTemplate: 'cnc_4axis_grbl.hbs',
      dialect: 'grbl_4axis' as const,
      axisCount: 4,
      aAxisRangeDeg: 360,
      aAxisOrientation: 'x' as const
    }
    const m = machineProfileSchema.parse(fourAxis)
    expect(m.axisCount).toBe(4)
    expect(m.aAxisRangeDeg).toBe(360)
    expect(m.aAxisOrientation).toBe('x')
    expect(m.dialect).toBe('grbl_4axis')
  })

  it('rejects axisCount below 3', () => {
    expect(() => machineProfileSchema.parse({ ...minimalCnc, axisCount: 2 })).toThrow()
  })

  it('rejects unknown aAxisOrientation', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, axisCount: 4, aAxisOrientation: 'z' as never })
    ).toThrow()
  })

  it('allows grbl_4axis dialect', () => {
    const m = machineProfileSchema.parse({ ...minimalCnc, dialect: 'grbl_4axis' as const })
    expect(m.dialect).toBe('grbl_4axis')
  })

  it('allows fanuc, siemens, and heidenhain dialects', () => {
    for (const dialect of ['fanuc', 'siemens', 'heidenhain'] as const) {
      const m = machineProfileSchema.parse({ ...minimalCnc, dialect })
      expect(m.dialect).toBe(dialect)
    }
  })

  it('allows fanuc_4axis dialect for 4-axis Fanuc machines', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      dialect: 'fanuc_4axis' as const,
      axisCount: 4,
      aAxisRangeDeg: 360,
      aAxisOrientation: 'x' as const
    })
    expect(m.dialect).toBe('fanuc_4axis')
    expect(m.axisCount).toBe(4)
  })

  it('allows mach3_4axis dialect for 4-axis Mach3 machines', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      dialect: 'mach3_4axis' as const,
      axisCount: 4,
      aAxisRangeDeg: 360,
      aAxisOrientation: 'x' as const
    })
    expect(m.dialect).toBe('mach3_4axis')
    expect(m.axisCount).toBe(4)
  })

  it('allows siemens_4axis dialect for 4-axis Siemens machines', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      dialect: 'siemens_4axis' as const,
      axisCount: 4,
      aAxisRangeDeg: 360,
      aAxisOrientation: 'x' as const
    })
    expect(m.dialect).toBe('siemens_4axis')
    expect(m.axisCount).toBe(4)
  })

  it('allows heidenhain_4axis dialect for 4-axis Heidenhain machines', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      dialect: 'heidenhain_4axis' as const,
      axisCount: 4,
      aAxisRangeDeg: 360,
      aAxisOrientation: 'x' as const
    })
    expect(m.dialect).toBe('heidenhain_4axis')
    expect(m.axisCount).toBe(4)
  })

  it('rejects unknown dialect', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, dialect: 'okuma' as never })
    ).toThrow()
  })

  it('parses 5-axis machine profile with all 5-axis fields', () => {
    // The speculative 5-axis Fanuc/Siemens post templates were removed in the
    // June 2026 My-Shop-Only cleanup, but the 5-axis schema surface is kept
    // additive (Safety Rule 2: no migration needed for saved profiles). A
    // 5-axis machine profile still parses cleanly when pointed at the
    // generic-mm post fallback.
    const fiveAxis = {
      ...minimalCnc,
      id: 'generic-5axis-th',
      name: 'Generic 5-axis (Table-Head)',
      postTemplate: 'cnc_generic_mm.hbs',
      dialect: 'fanuc' as const,
      axisCount: 5,
      aAxisRangeDeg: 360,
      aAxisOrientation: 'x' as const,
      bAxisOrientation: 'y' as const,
      bAxisRangeDeg: 120,
      fiveAxisType: 'table-head' as const,
      maxTiltDeg: 60
    }
    const m = machineProfileSchema.parse(fiveAxis)
    expect(m.axisCount).toBe(5)
    expect(m.bAxisOrientation).toBe('y')
    expect(m.bAxisRangeDeg).toBe(120)
    expect(m.fiveAxisType).toBe('table-head')
    expect(m.maxTiltDeg).toBe(60)
  })

  it('allows all three fiveAxisType values', () => {
    for (const fiveAxisType of ['table-table', 'head-head', 'table-head'] as const) {
      const m = machineProfileSchema.parse({ ...minimalCnc, axisCount: 5, fiveAxisType })
      expect(m.fiveAxisType).toBe(fiveAxisType)
    }
  })

  it('rejects unknown fiveAxisType', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, axisCount: 5, fiveAxisType: 'head-table' as never })
    ).toThrow()
  })

  it('allows both bAxisOrientation values', () => {
    for (const bAxisOrientation of ['y', 'z'] as const) {
      const m = machineProfileSchema.parse({ ...minimalCnc, axisCount: 5, bAxisOrientation })
      expect(m.bAxisOrientation).toBe(bAxisOrientation)
    }
  })

  it('rejects non-positive bAxisRangeDeg', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, axisCount: 5, bAxisRangeDeg: 0 })
    ).toThrow()
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, axisCount: 5, bAxisRangeDeg: -10 })
    ).toThrow()
  })

  it('rejects non-positive maxTiltDeg', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, maxTiltDeg: 0 })
    ).toThrow()
  })

  it('parses maxRotaryRpm when provided', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      axisCount: 4,
      maxRotaryRpm: 30
    })
    expect(m.maxRotaryRpm).toBe(30)
  })

  it('maxRotaryRpm is optional and absent from minimal profile', () => {
    const m = machineProfileSchema.parse(minimalCnc)
    expect(m.maxRotaryRpm).toBeUndefined()
  })

  it('rejects non-positive maxRotaryRpm', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, maxRotaryRpm: 0 })
    ).toThrow()
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, maxRotaryRpm: -5 })
    ).toThrow()
  })

  it('parses chuckOuterRadiusMm and chuckDepthMm for the rotary collision overlay', () => {
    // [v2 toolpath playback — rotary collision overlay] additive chuck-geometry
    // fields consumed by the renderer simulation-panel collision overlay.
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      axisCount: 4,
      chuckOuterRadiusMm: 46,
      chuckDepthMm: 25
    })
    expect(m.chuckOuterRadiusMm).toBe(46)
    expect(m.chuckDepthMm).toBe(25)
  })

  it('chuckOuterRadiusMm and chuckDepthMm are optional (absent from minimal profile)', () => {
    const m = machineProfileSchema.parse(minimalCnc)
    expect(m.chuckOuterRadiusMm).toBeUndefined()
    expect(m.chuckDepthMm).toBeUndefined()
  })

  it('rejects non-positive chuckOuterRadiusMm / chuckDepthMm', () => {
    expect(() => machineProfileSchema.parse({ ...minimalCnc, chuckOuterRadiusMm: 0 })).toThrow()
    expect(() => machineProfileSchema.parse({ ...minimalCnc, chuckOuterRadiusMm: -1 })).toThrow()
    expect(() => machineProfileSchema.parse({ ...minimalCnc, chuckDepthMm: 0 })).toThrow()
    expect(() => machineProfileSchema.parse({ ...minimalCnc, chuckDepthMm: -5 })).toThrow()
  })

  it('5-axis fields are all optional (absent from minimal profile)', () => {
    const m = machineProfileSchema.parse(minimalCnc)
    expect(m.bAxisOrientation).toBeUndefined()
    expect(m.bAxisRangeDeg).toBeUndefined()
    expect(m.fiveAxisType).toBeUndefined()
    expect(m.maxTiltDeg).toBeUndefined()
  })

  it('all top-level fields have .describe() annotations', () => {
    const shape = machineProfileSchema.shape
    for (const [key, field] of Object.entries(shape)) {
      expect(field.description, `field '${key}' missing .describe()`).toBeTruthy()
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Carvera 4-axis rotary-safety schema fields (yAxisMustBeZero,
// rotaryHeadstockXOffsetMm)
// ───────────────────────────────────────────────────────────────────────────
//
// These two fields encode the Makera Carvera 4th-Axis HD safety constraints at
// the SCHEMA layer so a misconfigured profile is rejected before any G-code is
// generated. The validators in src/main/cam-axis4/validation.ts consume them.
// Here we pin the Zod surface itself: the fields parse when present, reject bad
// shapes/ranges, and — per Safety Rule 2 — stay optional so the other two
// machines and existing saved profiles still validate.
describe('machineProfileSchema — Carvera 4-axis rotary-safety fields', () => {
  it('parses yAxisMustBeZero: true on a 4-axis profile', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      axisCount: 4,
      aAxisOrientation: 'x' as const,
      yAxisMustBeZero: true
    })
    expect(m.yAxisMustBeZero).toBe(true)
  })

  it('parses yAxisMustBeZero: false', () => {
    const m = machineProfileSchema.parse({ ...minimalCnc, yAxisMustBeZero: false })
    expect(m.yAxisMustBeZero).toBe(false)
  })

  it('rejects a non-boolean yAxisMustBeZero', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, yAxisMustBeZero: 'yes' as never })
    ).toThrow()
  })

  it('parses rotaryHeadstockXOffsetMm with the bundled Carvera value (5 mm)', () => {
    const m = machineProfileSchema.parse({
      ...minimalCnc,
      axisCount: 4,
      aAxisOrientation: 'x' as const,
      rotaryHeadstockXOffsetMm: 5
    })
    expect(m.rotaryHeadstockXOffsetMm).toBe(5)
  })

  it('accepts rotaryHeadstockXOffsetMm = 0 (boundary inclusive — G54 X at chuck face)', () => {
    const m = machineProfileSchema.parse({ ...minimalCnc, rotaryHeadstockXOffsetMm: 0 })
    expect(m.rotaryHeadstockXOffsetMm).toBe(0)
  })

  it('rejects a negative rotaryHeadstockXOffsetMm (chuck face is in front of X=0)', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, rotaryHeadstockXOffsetMm: -1 })
    ).toThrow()
  })

  it('rejects a non-numeric rotaryHeadstockXOffsetMm', () => {
    expect(() =>
      machineProfileSchema.parse({ ...minimalCnc, rotaryHeadstockXOffsetMm: '5' as never })
    ).toThrow()
  })

  it('both rotary-safety fields are optional (absent from minimal profile — Safety Rule 2)', () => {
    const m = machineProfileSchema.parse(minimalCnc)
    expect(m.yAxisMustBeZero).toBeUndefined()
    expect(m.rotaryHeadstockXOffsetMm).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Bundled-profile validation — the three shipped JSON files must parse through
// the schema unchanged. The Carvera 4-axis profile carries the new rotary-
// safety fields; K2 Plus and Laguna must NOT (their shapes are unchanged).
// ───────────────────────────────────────────────────────────────────────────
describe('machineProfileSchema — bundled machine profiles validate', () => {
  const MACHINES_DIR = join(__dirname, '..', '..', 'resources', 'machines')
  const loadRaw = (file: string): unknown =>
    JSON.parse(readFileSync(join(MACHINES_DIR, file), 'utf-8'))

  it('Makera Carvera (4-axis) parses and carries yAxisMustBeZero + rotaryHeadstockXOffsetMm', () => {
    const m = machineProfileSchema.parse(loadRaw('makera-carvera-4axis.json'))
    expect(m.axisCount).toBe(4)
    expect(m.yAxisMustBeZero).toBe(true)
    expect(m.rotaryHeadstockXOffsetMm).toBe(5)
  })

  it('Creality K2 Plus (FDM) still validates and does NOT carry rotary-safety fields', () => {
    const m = machineProfileSchema.parse(loadRaw('creality-k2-plus.json'))
    expect(m.kind).toBe('fdm')
    expect(m.yAxisMustBeZero).toBeUndefined()
    expect(m.rotaryHeadstockXOffsetMm).toBeUndefined()
  })

  it('Laguna Swift 5x10 (CNC 3-axis) still validates and does NOT carry rotary-safety fields', () => {
    const m = machineProfileSchema.parse(loadRaw('laguna-swift-5x10.json'))
    expect(m.kind).toBe('cnc')
    expect(m.yAxisMustBeZero).toBeUndefined()
    expect(m.rotaryHeadstockXOffsetMm).toBeUndefined()
  })

  it('Makera Carvera (3-axis) still validates and does NOT carry rotary-safety fields', () => {
    const m = machineProfileSchema.parse(loadRaw('makera-carvera-3axis.json'))
    expect(m.axisCount).toBe(3)
    expect(m.yAxisMustBeZero).toBeUndefined()
    expect(m.rotaryHeadstockXOffsetMm).toBeUndefined()
  })
})
