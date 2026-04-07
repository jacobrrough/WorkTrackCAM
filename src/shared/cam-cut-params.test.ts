import { describe, expect, it } from 'vitest'
import type { ManufactureOperation } from './manufacture-schema'
import type { MaterialRecord } from './material-schema'
import type { ToolRecord } from './tool-schema'
import {
  CAM_CUT_DEFAULTS,
  adjustFeedForEngagement,
  applyMaterialToNewOpParams,
  computeAdaptiveFeed,
  computeEngagementAngleDeg,
  resolveCamCutParams,
  resolveCamCutParamsWithMaterial,
  resolveManufactureSetupForCam,
  resolvePencilStepoverMm,
  resolveRasterScanAngleDeg
} from './cam-cut-params'

describe('computeEngagementAngleDeg', () => {
  it('returns 0 for zero/negative inputs', () => {
    expect(computeEngagementAngleDeg(0, 1)).toBe(0)
    expect(computeEngagementAngleDeg(3, 0)).toBe(0)
    expect(computeEngagementAngleDeg(-1, 1)).toBe(0)
  })

  it('returns 180 for full slotting (stepover >= 2*radius)', () => {
    expect(computeEngagementAngleDeg(3, 6)).toBe(180)
    expect(computeEngagementAngleDeg(3, 10)).toBe(180)
  })

  it('returns 120 degrees for 25% stepover (stepover = radius/2)', () => {
    // ratio = stepover/radius = 0.5 → cos_val = 0.5 → arccos(0.5) = 60° → θ = 120°
    const r = 4
    const stepover = r / 2 // 25% of tool diameter
    expect(computeEngagementAngleDeg(r, stepover)).toBeCloseTo(120, 5)
  })

  it('returns 180 degrees for full slotting when stepover = diameter', () => {
    // ratio = stepover/radius = 2 → clipped to 180°
    expect(computeEngagementAngleDeg(3, 6)).toBe(180)
  })

  it('matches Python formula for typical finish pass (10% stepover)', () => {
    // stepover = 0.1 * 2R = 0.2R, so ratio = 0.2, cos_val = 0.8
    // θ = 2*arccos(0.8) ≈ 2*36.87° ≈ 73.74°
    const ang = computeEngagementAngleDeg(5, 1)
    expect(ang).toBeCloseTo(2 * (Math.acos(1 - 1 / 5) * 180) / Math.PI, 10)
  })
})

describe('adjustFeedForEngagement', () => {
  it('returns base feed unchanged when engagement is 0', () => {
    expect(adjustFeedForEngagement(1000, 0)).toBe(1000)
  })

  it('returns base feed unchanged at 90° engagement (target default)', () => {
    // sin(90/2)=sin(45°)=target_factor=actual_factor → ratio=1
    expect(adjustFeedForEngagement(1000, 90)).toBeCloseTo(1000, 5)
  })

  it('increases feed at low engagement (chip thinning)', () => {
    // Low engagement → thin chips → increase feed to maintain chip load
    const result = adjustFeedForEngagement(1000, 30)
    expect(result).toBeGreaterThan(1000)
  })

  it('decreases feed at very high engagement (slotting)', () => {
    const result = adjustFeedForEngagement(1000, 170)
    expect(result).toBeLessThan(1000)
  })

  it('clamps output to [50%, 200%] of base', () => {
    // Near-zero engagement should be clamped to 200% not infinity
    expect(adjustFeedForEngagement(1000, 1)).toBeLessThanOrEqual(2000)
    // Full slotting should be clamped to 50% not lower
    expect(adjustFeedForEngagement(1000, 179)).toBeGreaterThanOrEqual(500)
  })

  it('is consistent with Python optimizer formula', () => {
    // Python: target_factor=sin(90*π/360)=sin(π/4)≈0.7071
    //         actual_factor=sin(45*π/360)=sin(π/8)≈0.3827
    //         adjusted = 1000 * (0.7071/0.3827) ≈ 1848, clamped to 2000
    const r = adjustFeedForEngagement(1000, 45)
    // sin(45/2)=sin(22.5°)≈0.3827, sin(90/2)=sin(45°)≈0.7071
    const expected = 1000 * (Math.sin((Math.PI / 4)) / Math.sin((45 * Math.PI) / 360))
    const clamped = Math.max(500, Math.min(expected, 2000))
    expect(r).toBeCloseTo(clamped, 5)
  })
})

describe('resolveCamCutParams', () => {
  it('uses defaults without op or params', () => {
    expect(resolveCamCutParams(undefined)).toEqual({ ...CAM_CUT_DEFAULTS })
    const op: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamCutParams(op)).toEqual({ ...CAM_CUT_DEFAULTS })
  })

  it('merges partial params', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_waterline',
      label: 'x',
      params: { feedMmMin: 800, stepoverMm: 1.5 }
    }
    const r = resolveCamCutParams(op)
    expect(r.feedMmMin).toBe(800)
    expect(r.stepoverMm).toBe(1.5)
    expect(r.zPassMm).toBe(CAM_CUT_DEFAULTS.zPassMm)
    expect(r.plungeMmMin).toBe(CAM_CUT_DEFAULTS.plungeMmMin)
    expect(r.safeZMm).toBe(CAM_CUT_DEFAULTS.safeZMm)
  })

  it('derives safeZ from manufacture setup stock Z when op omits safeZMm', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_raster',
      label: 'r',
      params: { feedMmMin: 900 }
    }
    const setup = { stock: { kind: 'box' as const, x: 100, y: 80, z: 30 } }
    const r = resolveCamCutParams(op, setup)
    expect(r.safeZMm).toBeGreaterThan(5)
    expect(r.safeZMm).toBeLessThanOrEqual(30)
    expect(r.feedMmMin).toBe(900)
  })

  it('explicit safeZMm overrides setup stock default', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'p',
      params: { safeZMm: 7 }
    }
    const setup = { stock: { kind: 'box' as const, x: 100, y: 80, z: 50 } }
    expect(resolveCamCutParams(op, setup).safeZMm).toBe(7)
  })

  it('applies same cut fields for OCL 3D kinds (adaptive / raster)', () => {
    const adaptive: ManufactureOperation = {
      id: '1',
      kind: 'cnc_adaptive',
      label: 'a',
      params: { zPassMm: -0.4, safeZMm: 12 }
    }
    const ra = resolveCamCutParams(adaptive)
    expect(ra.zPassMm).toBe(-0.4)
    expect(ra.safeZMm).toBe(12)
    const raster: ManufactureOperation = {
      id: '2',
      kind: 'cnc_raster',
      label: 'r',
      params: { zPassMm: 0.25 }
    }
    expect(resolveCamCutParams(raster).zPassMm).toBe(0.25)
  })

  it('allows negative zPassMm (work plane / depth convention)', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { zPassMm: -2 }
    }
    expect(resolveCamCutParams(op).zPassMm).toBe(-2)
  })

  it('rejects non-positive stepover and falls back', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { stepoverMm: 0 }
    }
    expect(resolveCamCutParams(op).stepoverMm).toBe(CAM_CUT_DEFAULTS.stepoverMm)
  })

  it('accepts numeric strings from loose JSON', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { safeZMm: '15' }
    }
    expect(resolveCamCutParams(op).safeZMm).toBe(15)
  })

  it('rejects zPassMm zero', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { zPassMm: 0 }
    }
    expect(resolveCamCutParams(op).zPassMm).toBe(CAM_CUT_DEFAULTS.zPassMm)
  })

  it('accepts string-valued zPassMm from loose JSON (finiteNonZeroNumber string branch)', () => {
    // String "-2" should parse to -2 via finiteNonZeroNumber string branch (lines 35-37)
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { zPassMm: '-2' }
    }
    expect(resolveCamCutParams(op).zPassMm).toBe(-2)
  })

  it('rejects string zPassMm "0" (finiteNonZeroNumber rejects zero strings)', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { zPassMm: '0' }
    }
    expect(resolveCamCutParams(op).zPassMm).toBe(CAM_CUT_DEFAULTS.zPassMm)
  })

  it('clamps feedMmMin below floor to CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { feedMmMin: 0.5 }
    }
    expect(resolveCamCutParams(op).feedMmMin).toBe(1)
  })

  it('clamps plungeMmMin below floor to CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { plungeMmMin: 0.001 }
    }
    expect(resolveCamCutParams(op).plungeMmMin).toBe(1)
  })

  it('passes feedMmMin above floor through unchanged', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { feedMmMin: 800 }
    }
    expect(resolveCamCutParams(op).feedMmMin).toBe(800)
  })
})

describe('resolvePencilStepoverMm', () => {
  it('uses default factor 0.22 and clamps to tool diameter', () => {
    expect(resolvePencilStepoverMm({ baseStepoverMm: 2, toolDiameterMm: 6, operationParams: {} })).toBeCloseTo(0.44, 5)
    expect(resolvePencilStepoverMm({ baseStepoverMm: 100, toolDiameterMm: 6, operationParams: {} })).toBeCloseTo(2.94, 5)
  })

  it('respects pencilStepoverMm when set', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverMm: 0.3 }
      })
    ).toBe(0.3)
  })

  it('respects pencilStepoverFactor', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 10,
        operationParams: { pencilStepoverFactor: 0.5 }
      })
    ).toBe(1)
  })

  it('parses pencilStepoverFactor as a string', () => {
    const result = resolvePencilStepoverMm({
      baseStepoverMm: 2,
      toolDiameterMm: 10,
      operationParams: { pencilStepoverFactor: '0.5' }
    })
    expect(result).toBeCloseTo(1, 5)
  })

  it('ignores non-numeric string pencilStepoverFactor and falls back to default factor', () => {
    const result = resolvePencilStepoverMm({
      baseStepoverMm: 2,
      toolDiameterMm: 10,
      operationParams: { pencilStepoverFactor: 'invalid' }
    })
    expect(result).toBeCloseTo(2 * 0.22, 5)
  })

  it('uses default factor when operationParams is omitted (null-coalescing ?? {} branch)', () => {
    // Omitting operationParams exercises the `?? {}` right side on line 155
    const result = resolvePencilStepoverMm({ baseStepoverMm: 2, toolDiameterMm: 6 })
    expect(result).toBeCloseTo(0.44, 5)
  })
})

describe('resolveManufactureSetupForCam', () => {
  it('prefers setup matching CNC machine id', () => {
    const mfg = {
      setups: [
        { id: 'a', label: 'S1', machineId: 'm1' },
        { id: 'b', label: 'S2', machineId: 'm2' }
      ]
    }
    expect(resolveManufactureSetupForCam(mfg, 'm2')?.id).toBe('b')
  })

  it('falls back to first setup when no machine match', () => {
    const mfg = {
      setups: [
        { id: 'a', label: 'S1', machineId: 'm1' },
        { id: 'b', label: 'S2', machineId: 'm2' }
      ]
    }
    expect(resolveManufactureSetupForCam(mfg, 'unknown')?.id).toBe('a')
    expect(resolveManufactureSetupForCam(mfg, undefined)?.id).toBe('a')
  })

  it('returns undefined when setups array is empty (early return branch)', () => {
    // Exercises the `if (mfg.setups.length === 0) return undefined` branch on line 206
    expect(resolveManufactureSetupForCam({ setups: [] }, 'm1')).toBeUndefined()
    expect(resolveManufactureSetupForCam({ setups: [] }, undefined)).toBeUndefined()
  })
})

describe('resolveCamCutParamsWithMaterial', () => {
  const materials: MaterialRecord[] = [
    {
      id: 'al6061',
      name: 'Aluminum 6061',
      category: 'aluminum_6061',
      cutParams: {
        default: {
          surfaceSpeedMMin: 120,
          chiploadMm: 0.03,
          docFactor: 0.4,
          stepoverFactor: 0.35,
          plungeFactor: 0.25
        }
      }
    }
  ]
  const tools: ToolRecord[] = [
    {
      id: 'tool-6mm',
      name: '6mm endmill',
      diameterMm: 6,
      fluteCount: 3,
      type: 'endmill'
    }
  ]

  it('keeps default-op params when no material id is selected', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'parallel',
      params: { feedMmMin: 800 }
    }
    expect(
      resolveCamCutParamsWithMaterial({
        operation: op,
        materialId: null,
        materials,
        tools
      }).feedMmMin
    ).toBe(800)
  })

  it('overrides feed/plunge/stepover/zPass from material and tool selection', () => {
    const op: ManufactureOperation = {
      id: '2',
      kind: 'cnc_contour',
      label: 'contour',
      params: { toolId: 'tool-6mm', safeZMm: 12 }
    }
    const resolved = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: 'al6061',
      materials,
      tools
    })
    // Expected: rpm~6366, feed~573, plunge~143, stepover=2.1, zPass=-2.4
    expect(resolved.feedMmMin).toBeGreaterThan(560)
    expect(resolved.feedMmMin).toBeLessThan(590)
    expect(resolved.plungeMmMin).toBeGreaterThan(130)
    expect(resolved.plungeMmMin).toBeLessThan(160)
    expect(resolved.stepoverMm).toBeCloseTo(2.1, 5)
    expect(resolved.zPassMm).toBeCloseTo(-2.4, 5)
    expect(resolved.safeZMm).toBe(12)
  })

  it('resolves flute count from tool matched by diameter when no toolId', () => {
    // Use toolDiameterMm without toolId — resolveOperationFluteCount must find
    // the tool by diameter (lines 117-118 of cam-cut-params.ts) and return its fluteCount (4).
    // A 4-flute vs 2-flute (default) at same chip load gives 2× the feed rate.
    const toolsWith4Flutes: ToolRecord[] = [
      { id: 'tool-6mm-4fl', name: '6mm 4-flute', diameterMm: 6, fluteCount: 4, type: 'endmill' }
    ]
    const opWithDiameter: ManufactureOperation = {
      id: '3',
      kind: 'cnc_raster',
      label: 'raster',
      params: { toolDiameterMm: 6 }
    }
    const withDiamLookup = resolveCamCutParamsWithMaterial({
      operation: opWithDiameter,
      materialId: 'al6061',
      materials,
      tools: toolsWith4Flutes
    })
    const withDefault2Flutes = resolveCamCutParamsWithMaterial({
      operation: opWithDiameter,
      materialId: 'al6061',
      materials,
      tools: []
    })
    // 4-flute lookup should produce higher feed than the default 2-flute fallback
    expect(withDiamLookup.feedMmMin).toBeGreaterThan(withDefault2Flutes.feedMmMin)
  })

  it('falls back to base params when materialId does not match any material', () => {
    // Non-existent material ID → resolveCamCutParamsWithMaterial returns base cut params
    const op: ManufactureOperation = {
      id: '4',
      kind: 'cnc_parallel',
      label: 'parallel',
      params: { feedMmMin: 750 }
    }
    const resolved = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: 'nonexistent-material',
      materials,
      tools
    })
    // Should return base params (feedMmMin=750), not material-derived params
    expect(resolved.feedMmMin).toBe(750)
  })

  it('falls back to 6mm diameter and 2-flute defaults when toolId is not found', () => {
    // toolId points to a non-existent tool → resolveOperationToolDiameterMm returns 6mm,
    // resolveOperationFluteCount returns 2 → same as if no tool was specified at all.
    const op: ManufactureOperation = {
      id: '5',
      kind: 'cnc_raster',
      label: 'raster',
      params: { toolId: 'nonexistent-tool' }
    }
    const withMissingTool = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: 'al6061',
      materials,
      tools: [] // empty tool library — toolId lookup fails
    })
    const withNoOp = resolveCamCutParamsWithMaterial({
      operation: { id: '6', kind: 'cnc_raster', label: 'raster', params: {} },
      materialId: 'al6061',
      materials,
      tools: []
    })
    // Both should resolve to the same params (6mm / 2-flute defaults)
    expect(withMissingTool.feedMmMin).toBeCloseTo(withNoOp.feedMmMin, 1)
    expect(withMissingTool.stepoverMm).toBeCloseTo(withNoOp.stepoverMm, 5)
  })

  it('accepts string-valued toolDiameterMm from loose JSON (resolvePositiveNumber string branch)', () => {
    // toolDiameterMm as string "8" triggers resolvePositiveNumber string branch (lines 81-83).
    // An 8mm tool at 2 flutes produces a different (larger) feed than the 6mm default.
    const op: ManufactureOperation = {
      id: '7',
      kind: 'cnc_raster',
      label: 'raster',
      params: { toolDiameterMm: '8' }
    }
    const with8mm = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: 'al6061',
      materials,
      tools: []
    })
    const withDefault6mm = resolveCamCutParamsWithMaterial({
      operation: { id: '8', kind: 'cnc_raster', label: 'raster', params: {} },
      materialId: 'al6061',
      materials,
      tools: []
    })
    // 8mm tool → lower RPM (same surface speed / larger circumference) → lower feed than 6mm.
    // feed = surface_speed × chipload × flutes / (π × d) — inversely proportional to diameter.
    expect(with8mm.feedMmMin).toBeLessThan(withDefault6mm.feedMmMin)
    // Stepover scales with tool diameter (stepoverFactor × d), so 8mm > 6mm.
    expect(with8mm.stepoverMm).toBeGreaterThan(withDefault6mm.stepoverMm)
  })
})

describe('applyMaterialToNewOpParams', () => {
  const materials: MaterialRecord[] = [
    {
      id: 'alu',
      name: 'Aluminum 6061',
      category: 'aluminum_6061',
      cutParams: {
        default: {
          surfaceSpeedMMin: 120,
          chiploadMm: 0.03,
          docFactor: 0.4,
          stepoverFactor: 0.35,
          plungeFactor: 0.25
        }
      }
    }
  ]
  const tools: ToolRecord[] = [
    { id: 't6', name: '6mm 3-flute', diameterMm: 6, fluteCount: 3, type: 'endmill' }
  ]

  const baseParams: Record<string, unknown> = {
    zPassMm: -1,
    stepoverMm: 2,
    feedMmMin: 1200,
    plungeMmMin: 400,
    safeZMm: 5,
    toolDiameterMm: 6
  }

  it('returns baseParams unchanged when materialId is null', () => {
    const result = applyMaterialToNewOpParams(baseParams, { materialId: null, materials, tools })
    expect(result).toBe(baseParams) // same reference — no allocation
  })

  it('returns baseParams unchanged when materialId is empty string', () => {
    const result = applyMaterialToNewOpParams(baseParams, { materialId: '', materials, tools })
    expect(result).toBe(baseParams)
  })

  it('returns baseParams unchanged when material is not found', () => {
    const result = applyMaterialToNewOpParams(baseParams, { materialId: 'unknown', materials, tools })
    expect(result).toBe(baseParams)
  })

  it('overrides feed/plunge/stepover/zPass from material when materialId matches', () => {
    const result = applyMaterialToNewOpParams(baseParams, { materialId: 'alu', materials, tools })
    // Material-derived values are different from static 1200/400/2/-1 defaults
    expect(result).not.toBe(baseParams) // new object
    expect(typeof result['feedMmMin']).toBe('number')
    expect(typeof result['plungeMmMin']).toBe('number')
    expect(typeof result['stepoverMm']).toBe('number')
    expect(typeof result['zPassMm']).toBe('number')
    // Generic static defaults are replaced
    expect(result['feedMmMin']).not.toBe(1200)
  })

  it('preserves non-cut-motion fields (safeZMm, toolDiameterMm)', () => {
    const result = applyMaterialToNewOpParams(baseParams, { materialId: 'alu', materials, tools })
    expect(result['safeZMm']).toBe(5)
    expect(result['toolDiameterMm']).toBe(6)
  })

  it('uses tool flute count from library when diameter matches', () => {
    // 3-flute tool → higher feed than 2-flute default
    const result3fl = applyMaterialToNewOpParams(baseParams, { materialId: 'alu', materials, tools })
    const result2fl = applyMaterialToNewOpParams(baseParams, { materialId: 'alu', materials, tools: [] })
    expect(result3fl['feedMmMin'] as number).toBeGreaterThan(result2fl['feedMmMin'] as number)
  })

  it('falls back to 6mm / 2-flute when toolDiameterMm is absent from baseParams', () => {
    const paramsNoToolDiam: Record<string, unknown> = { feedMmMin: 1200, plungeMmMin: 400 }
    const result = applyMaterialToNewOpParams(paramsNoToolDiam, { materialId: 'alu', materials, tools: [] })
    // Should still apply material defaults (no crash)
    expect(typeof result['feedMmMin']).toBe('number')
    expect(typeof result['zPassMm']).toBe('number')
  })
})

describe('resolveRasterScanAngleDeg', () => {
  it('returns 0 when no params provided', () => {
    expect(resolveRasterScanAngleDeg()).toBe(0)
    expect(resolveRasterScanAngleDeg({})).toBe(0)
  })

  it('returns scanAngleDeg when set', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 45 })).toBe(45)
  })

  it('scanAngleDeg takes precedence over rasterAngleDeg', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 60, rasterAngleDeg: 30 })).toBe(60)
  })

  it('falls back to rasterAngleDeg when scanAngleDeg is absent', () => {
    expect(resolveRasterScanAngleDeg({ rasterAngleDeg: 90 })).toBe(90)
  })

  it('returns 0 when scanAngleDeg is zero (finiteNonZeroNumber rejects 0)', () => {
    // finiteNonZeroNumber returns undefined for zero, so falls through
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 0 })).toBe(0)
  })

  it('handles negative angles', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: -45 })).toBe(-45)
  })
})

describe('computeAdaptiveFeed', () => {
  it('returns base feed for flat pass at target engagement', () => {
    const feed = computeAdaptiveFeed(1000, 0, 0, 3, 1, 1, 90)
    expect(feed).toBeGreaterThanOrEqual(500)
    expect(feed).toBeLessThanOrEqual(1500)
  })

  it('reduces feed for descending cuts (more material)', () => {
    const flatFeed = computeAdaptiveFeed(1000, 0, 0, 3, 1, 1, 90)
    const deepFeed = computeAdaptiveFeed(1000, 0, -1, 3, 1, 1, 90)
    expect(deepFeed).toBeLessThanOrEqual(flatFeed)
  })

  it('clamps to [50%, 150%] of base feed', () => {
    // Very heavy cut
    const heavyFeed = computeAdaptiveFeed(1000, 0, -100, 3, 6, 1, 90)
    expect(heavyFeed).toBeGreaterThanOrEqual(500)
    expect(heavyFeed).toBeLessThanOrEqual(1500)
  })

  it('returns base feed unchanged for zero/negative inputs', () => {
    expect(computeAdaptiveFeed(0, 0, -1, 3, 1, 1)).toBe(0)
    expect(computeAdaptiveFeed(1000, 0, -1, 0, 1, 1)).toBe(1000)
    expect(computeAdaptiveFeed(1000, 0, -1, 3, 0, 1)).toBe(1000)
  })

  it('is consistent with Python compute_adaptive_feed formula', () => {
    // Both TS and Python use: base_engagement + z_factor * 30
    // then adjust_feed_for_engagement with the same formula
    const feed = computeAdaptiveFeed(1000, 0, -0.5, 3, 1, 1, 90)
    expect(feed).toBeGreaterThan(0)
    expect(feed).toBeLessThanOrEqual(1500)
  })
})
