/**
 * Tests for `heightmap.ts` — cylindrical raycasting in machine frame.
 *
 * The CRITICAL test in this file is the "A=0 maps to +STL_Z" assertion: it
 * validates the rotation-frame fix at the heart of this rewire. If that test
 * fails, every toolpath the new engine produces will be rotated 90° around X
 * relative to the displayed mesh.
 */
import { describe, expect, it } from 'vitest'
import { buildCylindricalHeightmap, countHits, hmGet, HIT_CLAMPED, NO_HIT } from '../heightmap'
import type { Triangle } from '../frame'

const STOCK_R = 20

function tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]): Triangle {
  return [a, b, c]
}

/**
 * A square plate facing +Z, centered on the X-axis at (X, 0, +zPos).
 * Used to confirm the angle convention: a plate at +Z should be hit when
 * the ray comes from +Z, i.e. at A=0.
 */
function plateAtPlusZ(xCenter: number, halfSize: number, zPos: number): Triangle[] {
  return [
    tri([xCenter - halfSize, -halfSize, zPos], [xCenter + halfSize, -halfSize, zPos], [xCenter + halfSize, halfSize, zPos]),
    tri([xCenter - halfSize, -halfSize, zPos], [xCenter + halfSize, halfSize, zPos], [xCenter - halfSize, halfSize, zPos])
  ]
}

/** Same shape rotated 90° around X — plate at +Y instead of +Z. */
function plateAtPlusY(xCenter: number, halfSize: number, yPos: number): Triangle[] {
  return [
    tri([xCenter - halfSize, yPos, -halfSize], [xCenter + halfSize, yPos, -halfSize], [xCenter + halfSize, yPos, halfSize]),
    tri([xCenter - halfSize, yPos, -halfSize], [xCenter + halfSize, yPos, halfSize], [xCenter - halfSize, yPos, halfSize])
  ]
}

describe('buildCylindricalHeightmap — angle convention (CRITICAL: A=0 → +Z)', () => {
  it('a plate at +STL_Z is hit at A=0 (not A=90°)', () => {
    const tris = plateAtPlusZ(50, 5, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36 // 10° steps
    })
    // ix=20 corresponds to x=50 (the plate center).
    // ia=0 corresponds to A=0°. Should hit at radius ≈ 10.
    const rA0 = hmGet(hm, 20, 0)
    expect(rA0).toBeGreaterThan(0)
    expect(rA0).toBeCloseTo(10, 1)
    // ia=9 corresponds to A=90°. Should be NO_HIT (the plate is at +Z, not +Y).
    const rA90 = hmGet(hm, 20, 9)
    expect(rA90).toBe(NO_HIT)
  })

  it('a plate at +STL_Y is hit at A=90° (not A=0)', () => {
    const tris = plateAtPlusY(50, 5, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    // The plate is at +Y, so the ray from +Y direction (A=90°) should hit it.
    const rA90 = hmGet(hm, 20, 9)
    expect(rA90).toBeGreaterThan(0)
    expect(rA90).toBeCloseTo(10, 1)
    // A=0° should not hit it (the plate is not at +Z).
    const rA0 = hmGet(hm, 20, 0)
    expect(rA0).toBe(NO_HIT)
  })

  it('a plate at -STL_Z is hit at A=180°', () => {
    const tris = plateAtPlusZ(50, 5, -10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    // ia=18 corresponds to A=180°.
    const rA180 = hmGet(hm, 20, 18)
    expect(rA180).toBeGreaterThan(0)
    expect(rA180).toBeCloseTo(10, 1)
  })
})

describe('buildCylindricalHeightmap — out-of-stock hits', () => {
  it('rejects (HIT_CLAMPED) by default if a triangle is past stockRadius', () => {
    // Plate at +Z = 25, stockRadius = 20 → 5 mm past OD
    const tris = plateAtPlusZ(50, 5, 25)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    expect(hmGet(hm, 20, 0)).toBe(HIT_CLAMPED)
  })

  it('clamps to stockRadius when outOfStockHitMode = "clamp"', () => {
    const tris = plateAtPlusZ(50, 5, 25)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36,
      outOfStockHitMode: 'clamp'
    })
    expect(hmGet(hm, 20, 0)).toBeCloseTo(STOCK_R, 6)
  })
})

describe('buildCylindricalHeightmap — degenerate inputs', () => {
  it('returns an empty heightmap for zero triangles', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 100,
      nx: 11,
      na: 12
    })
    const stats = countHits(hm)
    expect(stats.hitCount).toBe(0)
    expect(stats.clampedCount).toBe(0)
  })

  it('does not crash on a degenerate (zero-area) triangle', () => {
    const tris: Triangle[] = [tri([50, 0, 0], [50, 0, 0], [50, 0, 0])]
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 21,
      na: 36
    })
    // Degenerate triangles produce no hits (det ≈ 0 in Möller–Trumbore).
    const stats = countHits(hm)
    expect(stats.hitCount).toBe(0)
  })
})

describe('hmGet — bounds checking', () => {
  it('returns NO_HIT for out-of-bounds indices', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    expect(hmGet(hm, -1, 0)).toBe(NO_HIT)
    expect(hmGet(hm, 5, 0)).toBe(NO_HIT)
    expect(hmGet(hm, 0, -1)).toBe(NO_HIT)
    expect(hmGet(hm, 0, 6)).toBe(NO_HIT)
  })
})
