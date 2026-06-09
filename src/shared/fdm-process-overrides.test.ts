import { describe, expect, it } from 'vitest'
import {
  EMPTY_FDM_PROCESS_OVERRIDES,
  FDM_TEMP_CEILINGS,
  buildFdmSliceOverrides,
  parseFdmProcessOverrides,
  serializeFdmProcessOverrides,
  type FdmProcessOverrides
} from './fdm-process-overrides'

describe('buildFdmSliceOverrides — field → Orca-key mapping', () => {
  it('returns null overrides + no warnings for an empty state', () => {
    const plan = buildFdmSliceOverrides(EMPTY_FDM_PROCESS_OVERRIDES)
    expect(plan.overrides).toBeNull()
    expect(plan.warnings).toEqual([])
  })

  it('maps layer height to layer_height (string mm)', () => {
    const plan = buildFdmSliceOverrides({ layerHeightMm: 0.24 })
    expect(plan.overrides).toEqual({ layer_height: '0.24' })
  })

  it('maps infill density to sparse_infill_density as an Orca percent string', () => {
    const plan = buildFdmSliceOverrides({ infillDensityPct: 15 })
    expect(plan.overrides).toEqual({ sparse_infill_density: '15%' })
  })

  it('clamps infill density to 0..100 and rounds', () => {
    expect(buildFdmSliceOverrides({ infillDensityPct: 140 }).overrides).toEqual({
      sparse_infill_density: '100%'
    })
    expect(buildFdmSliceOverrides({ infillDensityPct: -5 }).overrides).toEqual({
      sparse_infill_density: '0%'
    })
    expect(buildFdmSliceOverrides({ infillDensityPct: 17.6 }).overrides).toEqual({
      sparse_infill_density: '18%'
    })
  })

  it('maps wall loops to wall_loops (rounded, ≥ 1)', () => {
    expect(buildFdmSliceOverrides({ wallLoops: 4 }).overrides).toEqual({ wall_loops: '4' })
    expect(buildFdmSliceOverrides({ wallLoops: 2.7 }).overrides).toEqual({ wall_loops: '3' })
  })

  it('maps a single print speed onto all four wall/infill speed keys', () => {
    const plan = buildFdmSliceOverrides({ printSpeedMmS: 200 })
    expect(plan.overrides).toEqual({
      outer_wall_speed: '200',
      inner_wall_speed: '200',
      sparse_infill_speed: '200',
      internal_solid_infill_speed: '200'
    })
  })

  it('maps support enabled + style to enable_support + support_type', () => {
    expect(buildFdmSliceOverrides({ supportEnabled: true, supportType: 'tree' }).overrides).toEqual({
      enable_support: '1',
      support_type: 'tree(auto)'
    })
    expect(buildFdmSliceOverrides({ supportEnabled: true, supportType: 'normal' }).overrides).toEqual({
      enable_support: '1',
      support_type: 'normal(auto)'
    })
  })

  it('defaults to normal support style when enabled with no explicit style', () => {
    expect(buildFdmSliceOverrides({ supportEnabled: true }).overrides).toEqual({
      enable_support: '1',
      support_type: 'normal(auto)'
    })
  })

  it('emits enable_support 0 and NO support_type when supports are off', () => {
    const plan = buildFdmSliceOverrides({ supportEnabled: false, supportType: 'tree' })
    expect(plan.overrides).toEqual({ enable_support: '0' })
    expect(plan.overrides).not.toHaveProperty('support_type')
  })
})

describe('buildFdmSliceOverrides — TEMPERATURE SAFETY (K2 ceiling)', () => {
  it('passes through nozzle / bed temps at or under the ceiling untouched', () => {
    const plan = buildFdmSliceOverrides({ nozzleTempC: 230, bedTempC: 60 })
    expect(plan.overrides).toMatchObject({
      nozzle_temperature: '230',
      nozzle_temperature_initial_layer: '230',
      hot_plate_temp: '60',
      hot_plate_temp_initial_layer: '60'
    })
    expect(plan.warnings).toEqual([])
  })

  it('allows exactly the ceiling value (firmware permits temp AT the ceiling)', () => {
    const plan = buildFdmSliceOverrides({
      nozzleTempC: FDM_TEMP_CEILINGS.nozzleC,
      bedTempC: FDM_TEMP_CEILINGS.bedC
    })
    expect(plan.overrides?.nozzle_temperature).toBe(String(FDM_TEMP_CEILINGS.nozzleC))
    expect(plan.overrides?.hot_plate_temp).toBe(String(FDM_TEMP_CEILINGS.bedC))
    expect(plan.warnings).toEqual([])
  })

  it('CLAMPS an over-ceiling nozzle temp to 350 °C and warns (never exceeds)', () => {
    const plan = buildFdmSliceOverrides({ nozzleTempC: 400 })
    expect(plan.overrides?.nozzle_temperature).toBe('350')
    expect(plan.overrides?.nozzle_temperature_initial_layer).toBe('350')
    expect(plan.warnings.some((w) => /clamped/i.test(w) && /350/.test(w))).toBe(true)
  })

  it('CLAMPS an over-ceiling bed temp to 120 °C and warns (never exceeds)', () => {
    const plan = buildFdmSliceOverrides({ bedTempC: 200 })
    expect(plan.overrides?.hot_plate_temp).toBe('120')
    expect(plan.overrides?.hot_plate_temp_initial_layer).toBe('120')
    expect(plan.warnings.some((w) => /clamped/i.test(w) && /120/.test(w))).toBe(true)
  })

  it('DROPS a non-positive / non-finite temperature with a warning (never forwards NaN)', () => {
    const plan = buildFdmSliceOverrides({ nozzleTempC: 0, bedTempC: Number.NaN })
    expect(plan.overrides).toBeNull()
    expect(plan.warnings.length).toBe(2)
    expect(plan.warnings.every((w) => /ignored/i.test(w))).toBe(true)
  })

  it('the produced override map can never carry a temp above the ceiling for any input', () => {
    // Fuzz a range of requested temps; the emitted value must always be ≤ ceiling.
    for (let t = 100; t <= 800; t += 17) {
      const plan = buildFdmSliceOverrides({ nozzleTempC: t, bedTempC: t })
      const nozzle = plan.overrides?.nozzle_temperature
      const bed = plan.overrides?.hot_plate_temp
      if (typeof nozzle === 'string') {
        expect(Number(nozzle)).toBeLessThanOrEqual(FDM_TEMP_CEILINGS.nozzleC)
      }
      if (typeof bed === 'string') {
        expect(Number(bed)).toBeLessThanOrEqual(FDM_TEMP_CEILINGS.bedC)
      }
    }
  })
})

describe('serialize / parse round-trip', () => {
  it('serializes a populated state and parses it back identically', () => {
    const state: FdmProcessOverrides = {
      layerHeightMm: 0.2,
      infillDensityPct: 20,
      wallLoops: 3,
      printSpeedMmS: 200,
      nozzleTempC: 230,
      bedTempC: 60,
      supportEnabled: true,
      supportType: 'tree'
    }
    const json = serializeFdmProcessOverrides(state)
    expect(json).not.toBeNull()
    expect(parseFdmProcessOverrides(json)).toEqual(state)
  })

  it('serializes an empty state to null (so the setting is cleared, not "{}")', () => {
    expect(serializeFdmProcessOverrides(EMPTY_FDM_PROCESS_OVERRIDES)).toBeNull()
  })

  it('parses null / blank / malformed input to the empty state (never throws)', () => {
    expect(parseFdmProcessOverrides(null)).toEqual(EMPTY_FDM_PROCESS_OVERRIDES)
    expect(parseFdmProcessOverrides(undefined)).toEqual(EMPTY_FDM_PROCESS_OVERRIDES)
    expect(parseFdmProcessOverrides('   ')).toEqual(EMPTY_FDM_PROCESS_OVERRIDES)
    expect(parseFdmProcessOverrides('not json')).toEqual(EMPTY_FDM_PROCESS_OVERRIDES)
    expect(parseFdmProcessOverrides('[1,2,3]')).toEqual(EMPTY_FDM_PROCESS_OVERRIDES)
  })

  it('drops unknown / wrong-typed fields when parsing', () => {
    const parsed = parseFdmProcessOverrides(
      JSON.stringify({
        layerHeightMm: 0.3,
        infillDensityPct: 'lots', // wrong type → dropped
        wallLoops: null, // wrong type → dropped
        supportType: 'bogus', // not in enum → dropped
        extra: 'ignored'
      })
    )
    expect(parsed).toEqual({ layerHeightMm: 0.3 })
  })
})
