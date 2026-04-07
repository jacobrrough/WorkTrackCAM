import { describe, expect, it } from 'vitest'
import { calcCutParams, materialRecordSchema } from './material-schema'

const validCutParams = {
  surfaceSpeedMMin: 200,
  chiploadMm: 0.05,
  docFactor: 0.5,
  stepoverFactor: 0.45
}

describe('materialRecordSchema cutParams validation', () => {
  it('accepts a material with a default cutParams entry', () => {
    const mat = materialRecordSchema.parse({
      id: 'alum',
      name: 'Aluminum 6061',
      category: 'aluminum_6061',
      cutParams: { default: validCutParams }
    })
    expect(Object.keys(mat.cutParams)).toContain('default')
  })

  it('accepts a material with tool-type-specific cutParams (no "default" key required)', () => {
    const mat = materialRecordSchema.parse({
      id: 'wood',
      name: 'Oak',
      category: 'hardwood',
      cutParams: { endmill: validCutParams, ball: validCutParams }
    })
    expect(Object.keys(mat.cutParams)).toContain('endmill')
  })

  it('rejects a material with empty cutParams (zero entries)', () => {
    expect(() =>
      materialRecordSchema.parse({
        id: 'bad',
        name: 'No Params',
        category: 'other',
        cutParams: {}
      })
    ).toThrow(/at least one entry/i)
  })
})

describe('calcCutParams', () => {
  it('floors feed and plunge to at least 1 mm/min (guardrail parity)', () => {
    const mat = materialRecordSchema.parse({
      id: 'floor-test',
      name: 'Floor test',
      category: 'foam',
      cutParams: {
        default: {
          surfaceSpeedMMin: 20,
          chiploadMm: 1e-6,
          docFactor: 0.1,
          stepoverFactor: 0.4,
          plungeFactor: 0.05
        }
      }
    })
    const r = calcCutParams(mat, 200, 2)
    expect(r.feedMmMin).toBeGreaterThanOrEqual(1)
    expect(r.plungeMmMin).toBeGreaterThanOrEqual(1)
    expect(r.feedClampedToFloor).toBe(true)
    expect(r.recommendedFeedMmMin).toBeLessThan(1)
  })
})
