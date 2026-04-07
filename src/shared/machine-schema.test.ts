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
    const fiveAxis = {
      ...minimalCnc,
      id: 'generic-5axis-th',
      name: 'Generic 5-axis (Table-Head)',
      postTemplate: 'cnc_5axis_fanuc.hbs',
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
