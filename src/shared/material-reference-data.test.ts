import { describe, expect, it } from 'vitest'
import {
  SURFACE_SPEED_REFERENCE,
  CHIP_LOAD_REFERENCE,
  mapToolTypeToAudit,
  type AuditToolType,
  type SurfaceSpeedRange,
  type ChipLoadRange
} from './material-reference-data'

describe('SURFACE_SPEED_REFERENCE', () => {
  it('is a non-empty object', () => {
    expect(typeof SURFACE_SPEED_REFERENCE).toBe('object')
    expect(Object.keys(SURFACE_SPEED_REFERENCE).length).toBeGreaterThan(0)
  })

  it('every entry has minMMin < maxMMin', () => {
    for (const [material, range] of Object.entries(SURFACE_SPEED_REFERENCE)) {
      expect(range.minMMin).toBeLessThan(range.maxMMin)
    }
  })

  it('every speed value is positive', () => {
    for (const range of Object.values(SURFACE_SPEED_REFERENCE)) {
      expect(range.minMMin).toBeGreaterThan(0)
      expect(range.maxMMin).toBeGreaterThan(0)
    }
  })

  it('contains common metal materials', () => {
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('aluminum_6061')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('steel_mild')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('stainless')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('brass')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('titanium')
  })

  it('contains common plastic materials', () => {
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('acrylic')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('hdpe')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('delrin')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('pvc')
  })

  it('contains wood and composite materials', () => {
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('softwood')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('hardwood')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('mdf')
    expect(SURFACE_SPEED_REFERENCE).toHaveProperty('carbon_fiber')
  })

  it('aluminum speeds are higher than steel speeds (sanity check)', () => {
    const alum = SURFACE_SPEED_REFERENCE['aluminum_6061']!
    const steel = SURFACE_SPEED_REFERENCE['steel_mild']!
    expect(alum.maxMMin).toBeGreaterThan(steel.maxMMin)
  })

  it('foam speeds are the highest (soft material)', () => {
    const foam = SURFACE_SPEED_REFERENCE['foam']!
    for (const [key, range] of Object.entries(SURFACE_SPEED_REFERENCE)) {
      if (key === 'foam') continue
      expect(foam.maxMMin).toBeGreaterThanOrEqual(range.maxMMin)
    }
  })
})

describe('CHIP_LOAD_REFERENCE', () => {
  it('is a non-empty object', () => {
    expect(typeof CHIP_LOAD_REFERENCE).toBe('object')
    expect(Object.keys(CHIP_LOAD_REFERENCE).length).toBeGreaterThan(0)
  })

  it('has the same material keys as SURFACE_SPEED_REFERENCE', () => {
    const surfaceKeys = Object.keys(SURFACE_SPEED_REFERENCE).sort()
    const chipKeys = Object.keys(CHIP_LOAD_REFERENCE).sort()
    expect(chipKeys).toEqual(surfaceKeys)
  })

  it('every material has all four tool types', () => {
    const expectedToolTypes: AuditToolType[] = ['endmill_2f', 'endmill_4f', 'ball', 'drill']
    for (const [material, toolMap] of Object.entries(CHIP_LOAD_REFERENCE)) {
      for (const tt of expectedToolTypes) {
        expect(toolMap).toHaveProperty(tt)
      }
    }
  })

  it('every chip load range has minMm < maxMm', () => {
    for (const toolMap of Object.values(CHIP_LOAD_REFERENCE)) {
      for (const range of Object.values(toolMap)) {
        expect((range as ChipLoadRange).minMm).toBeLessThan((range as ChipLoadRange).maxMm)
      }
    }
  })

  it('every chip load value is positive', () => {
    for (const toolMap of Object.values(CHIP_LOAD_REFERENCE)) {
      for (const range of Object.values(toolMap)) {
        expect((range as ChipLoadRange).minMm).toBeGreaterThan(0)
        expect((range as ChipLoadRange).maxMm).toBeGreaterThan(0)
      }
    }
  })

  it('drill chip loads are generally higher than ball chip loads for same material', () => {
    for (const [material, toolMap] of Object.entries(CHIP_LOAD_REFERENCE)) {
      const ball = toolMap['ball']
      const drill = toolMap['drill']
      expect(drill.maxMm).toBeGreaterThanOrEqual(ball.maxMm)
    }
  })
})

describe('mapToolTypeToAudit', () => {
  it('maps "endmill" to endmill_2f', () => {
    expect(mapToolTypeToAudit('endmill')).toBe('endmill_2f')
  })

  it('maps "default" to endmill_2f', () => {
    expect(mapToolTypeToAudit('default')).toBe('endmill_2f')
  })

  it('maps "vbit" to endmill_2f', () => {
    expect(mapToolTypeToAudit('vbit')).toBe('endmill_2f')
  })

  it('maps "o_flute" to endmill_2f', () => {
    expect(mapToolTypeToAudit('o_flute')).toBe('endmill_2f')
  })

  it('maps "face" to endmill_2f', () => {
    expect(mapToolTypeToAudit('face')).toBe('endmill_2f')
  })

  it('maps "chamfer" to endmill_2f', () => {
    expect(mapToolTypeToAudit('chamfer')).toBe('endmill_2f')
  })

  it('maps "ball" to ball', () => {
    expect(mapToolTypeToAudit('ball')).toBe('ball')
  })

  it('maps "drill" to drill', () => {
    expect(mapToolTypeToAudit('drill')).toBe('drill')
  })

  it('maps unknown tool types to endmill_2f (conservative default)', () => {
    expect(mapToolTypeToAudit('unknown_tool')).toBe('endmill_2f')
    expect(mapToolTypeToAudit('')).toBe('endmill_2f')
    expect(mapToolTypeToAudit('custom_xyz')).toBe('endmill_2f')
  })
})
