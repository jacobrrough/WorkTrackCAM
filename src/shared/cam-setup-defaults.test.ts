import { describe, expect, it } from 'vitest'
import {
  rasterRestGapFromStockAndMeshMinZ,
  recommendedSafeZFromStockThicknessMm,
  rotaryDimsFromSetupStock,
  rotaryMachinableXSpanMm,
  rotaryMeshStockAlignmentHint,
  setupStockHasDims,
  setupStockThicknessZMm,
  shopJobStockAsCamSetup,
  suggestedZPassMmFromStockAndMeshMinZ
} from './cam-setup-defaults'

describe('cam-setup-defaults', () => {
  it('recommendedSafeZFromStockThicknessMm scales with stock height', () => {
    expect(recommendedSafeZFromStockThicknessMm(10)).toBeLessThan(recommendedSafeZFromStockThicknessMm(80))
    expect(recommendedSafeZFromStockThicknessMm(5)).toBeGreaterThanOrEqual(4)
  })

  it('rasterRestGapFromStockAndMeshMinZ uses WCS stock top Z0 convention', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(20, -12)).toBeCloseTo(8, 5)
    expect(rasterRestGapFromStockAndMeshMinZ(20, -25)).toBeUndefined()
  })

  it('rasterRestGapFromStockAndMeshMinZ returns undefined for degenerate inputs', () => {
    // Non-positive stock Z
    expect(rasterRestGapFromStockAndMeshMinZ(0, -5)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(-10, -5)).toBeUndefined()
    // Non-finite mesh Z
    expect(rasterRestGapFromStockAndMeshMinZ(20, NaN)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(20, Infinity)).toBeUndefined()
    // Gap too small (< 0.02)
    expect(rasterRestGapFromStockAndMeshMinZ(10, -9.99)).toBeUndefined()
  })

  it('shopJobStockAsCamSetup builds box stock for resolveCamCutParams', () => {
    const s = shopJobStockAsCamSetup({ x: 120, y: 40, z: 15 })
    expect(s.stock?.kind).toBe('box')
    expect(s.stock?.z).toBe(15)
  })

  it('suggestedZPassMmFromStockAndMeshMinZ returns negative depth capped by stock', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -8)).toBe(-8)
    expect(suggestedZPassMmFromStockAndMeshMinZ(5, -25)).toBe(-5)
    expect(suggestedZPassMmFromStockAndMeshMinZ(10, 2)).toBeUndefined()
  })

  it('suggestedZPassMmFromStockAndMeshMinZ returns undefined for degenerate inputs', () => {
    // Depth too shallow (< 0.5 mm)
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -0.3)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -0.499)).toBeUndefined()
    // Non-positive stock Z
    expect(suggestedZPassMmFromStockAndMeshMinZ(0, -5)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(-5, -5)).toBeUndefined()
    // Non-finite mesh Z
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, NaN)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -Infinity)).toBeUndefined()
    // meshMinZMm at or above surface (≥ -1e-6)
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, 0)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, 1e-7)).toBeUndefined()
  })

  it('rotaryMachinableXSpanMm skips chuck and clamp buffer', () => {
    const { machXStartMm, machXEndMm } = rotaryMachinableXSpanMm(100, 10, 5)
    expect(machXEndMm).toBe(100)
    expect(machXStartMm).toBeGreaterThan(10)
  })

  it('rotaryMeshStockAlignmentHint warns on centered mesh vs long stock', () => {
    const h = rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -40, meshMaxX: 40 })
    expect(h).toBeTruthy()
    expect(h).toContain('CAM_4TH_AXIS_REFERENCE')
  })

  it('rotaryMeshStockAlignmentHint returns undefined when mesh is well-aligned', () => {
    // Mesh fully in positive X (WCS-aligned, no centering issue)
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: 0, meshMaxX: 80 })).toBeUndefined()
    // Mesh spans negative X but maxX reaches far into stock (not the centered-CAD pattern)
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -5, meshMaxX: 90 })).toBeUndefined()
    // Degenerate: zero-length stock
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 0, meshMinX: -40, meshMaxX: 40 })).toBeUndefined()
  })
})

describe('setupStockThicknessZMm', () => {
  it('returns undefined for undefined stock', () => {
    expect(setupStockThicknessZMm(undefined)).toBeUndefined()
  })

  it('returns undefined for fromExtents stock', () => {
    expect(setupStockThicknessZMm({ kind: 'fromExtents' })).toBeUndefined()
  })

  it('returns z for box stock with valid z', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: 20 })).toBe(20)
  })

  it('returns undefined for box stock with non-positive z', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: 0 })).toBeUndefined()
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: -5 })).toBeUndefined()
  })

  it('returns undefined for box stock with non-finite z', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: NaN })).toBeUndefined()
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: Infinity })).toBeUndefined()
  })
})

describe('rotaryDimsFromSetupStock', () => {
  it('returns empty object for undefined stock', () => {
    expect(rotaryDimsFromSetupStock(undefined)).toEqual({})
  })

  it('returns empty object for fromExtents stock', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'fromExtents' })).toEqual({})
  })

  it('returns lengthMm and diameterMm for box stock', () => {
    const result = rotaryDimsFromSetupStock({ kind: 'box', x: 100, y: 40, z: 40 })
    expect(result.lengthMm).toBe(100)
    expect(result.diameterMm).toBe(40)
  })

  it('returns lengthMm and diameterMm for cylinder stock', () => {
    const result = rotaryDimsFromSetupStock({ kind: 'cylinder', x: 80, y: 30, z: 30 })
    expect(result.lengthMm).toBe(80)
    expect(result.diameterMm).toBe(30)
  })

  it('returns undefined dims when x or y is missing or non-positive', () => {
    const result = rotaryDimsFromSetupStock({ kind: 'box', x: 0, y: 40, z: 40 })
    expect(result.lengthMm).toBeUndefined()
    expect(result.diameterMm).toBe(40)
  })

  it('returns undefined diameterMm when y is non-positive', () => {
    const result = rotaryDimsFromSetupStock({ kind: 'cylinder', x: 80, y: 0, z: 30 })
    expect(result.lengthMm).toBe(80)
    expect(result.diameterMm).toBeUndefined()
  })

  it('returns empty object for unknown stock kind', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'unknown' } as any)).toEqual({})
  })
})

describe('rasterRestGapFromStockAndMeshMinZ — edge cases', () => {
  it('returns undefined when stockZMm is zero or negative', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(0, -12)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(-5, -12)).toBeUndefined()
  })

  it('returns undefined when meshMinZMm is non-finite', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(20, NaN)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(20, Infinity)).toBeUndefined()
  })

  it('returns undefined when gap is at or below the 0.02 threshold', () => {
    // gap = meshMinZMm + stockZMm = -20 + 20 = 0 → below threshold
    expect(rasterRestGapFromStockAndMeshMinZ(20, -20)).toBeUndefined()
  })
})

describe('suggestedZPassMmFromStockAndMeshMinZ — edge cases', () => {
  it('returns undefined when stockZMm is zero or negative', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(0, -8)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(-1, -8)).toBeUndefined()
  })

  it('returns undefined when meshMinZMm is non-finite', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(10, NaN)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(10, Infinity)).toBeUndefined()
  })

  it('returns undefined when computed depth is below 0.5mm minimum', () => {
    // meshMinZMm = -0.3 → depth = min(10, 0.3) = 0.3 < 0.5 → undefined
    expect(suggestedZPassMmFromStockAndMeshMinZ(10, -0.3)).toBeUndefined()
  })
})

describe('recommendedSafeZFromStockThicknessMm — clamp behaviour', () => {
  it('clamps to 4 mm floor for very thin stock', () => {
    // z=0.01 → 4 + 0.01*0.08 ≈ 4.0008 — floor is 4 (Math.max(4, ...))
    expect(recommendedSafeZFromStockThicknessMm(0.01)).toBeGreaterThanOrEqual(4)
    expect(recommendedSafeZFromStockThicknessMm(1)).toBeCloseTo(4 + 1 * 0.08, 5)
  })

  it('scales linearly in the middle range', () => {
    // z=50 → 4 + 50*0.08 = 8
    expect(recommendedSafeZFromStockThicknessMm(50)).toBeCloseTo(8, 5)
  })

  it('clamps to 30 mm ceiling for very thick stock', () => {
    // z=400 → 4 + 400*0.08 = 36 → clamped to 30
    expect(recommendedSafeZFromStockThicknessMm(400)).toBe(30)
    expect(recommendedSafeZFromStockThicknessMm(1000)).toBe(30)
  })

  it('returns exactly 30 at the upper clamp boundary', () => {
    // z=325 → 4 + 325*0.08 = 30 (exact boundary)
    expect(recommendedSafeZFromStockThicknessMm(325)).toBeCloseTo(30, 5)
  })
})

describe('setupStockHasDims', () => {
  it('returns false for undefined stock', () => {
    expect(setupStockHasDims(undefined)).toBe(false)
  })

  it('returns false for fromExtents stock (no explicit dimensions)', () => {
    expect(setupStockHasDims({ kind: 'fromExtents' })).toBe(false)
  })

  it('returns true for box stock with valid x and z', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100, z: 50 })).toBe(true)
  })

  it('returns true for box stock with valid x and y (xz check can fail when z omitted)', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100, y: 80 })).toBe(true)
  })

  it('returns true for cylinder stock with valid x and y', () => {
    expect(setupStockHasDims({ kind: 'cylinder', x: 120, y: 50 })).toBe(true)
  })

  it('returns false when x is zero or missing', () => {
    expect(setupStockHasDims({ kind: 'box', x: 0, y: 80, z: 50 })).toBe(false)
    expect(setupStockHasDims({ kind: 'box', y: 80, z: 50 })).toBe(false)
  })

  it('returns false when both y and z are missing or zero', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100, y: 0, z: 0 })).toBe(false)
  })

  it('returns true when only z is positive (xz path)', () => {
    expect(setupStockHasDims({ kind: 'box', x: 80, z: 20 })).toBe(true)
  })
})
