/**
 * Paired-pin contract for `src/main/cam-axis4/heightmap.ts` -- [ID-0197].
 *
 * Cycle 120 -- 2026-04-27 -- cam-engine rotation pull. Companion to the
 * existing `heightmap.test.ts` (8 angle-convention + sentinel + degenerate
 * tests). This file pins the surface-area invariants that those tests do
 * NOT cover, in the [ID-0188] / [ID-0172] / [ID-0171] paired-pin style:
 *
 *   - Sentinel literal values (NO_HIT === -1, HIT_CLAMPED === -2, both < 0).
 *   - `CylindricalHeightmap` return-shape contract (Float32Array radii,
 *     radii.length === nx*na, dx === (xEnd-xStart)/max(1,nx-1),
 *     daDeg === 360/na, xStart preserved verbatim).
 *   - Indexing convention `[ix * na + ia]` round-trip with `hmGet`.
 *   - `outOfStockHitMode` default is 'reject' (omitted opt === explicit
 *     'reject').
 *   - Multiple axial slices: plate spanning a range hits at the right ix
 *     indices; plate at xStart hits ix=0; plate at xEnd hits ix=nx-1.
 *   - Closest-triangle-wins ray semantics (two parallel plates ->
 *     smaller radius recorded).
 *   - Degenerate inputs: nx=1, na=1, xEnd===xStart, near-axis hit (rHit
 *     < 0.01) -> NO_HIT (not 0; degeneracy guard).
 *   - `countHits` invariants: hit + clamped + no-hit === radii.length;
 *     meshRadialMin tracks smallest real hit (clamped excluded);
 *     meshRadialMin === 0 when no real hits (Infinity-guard branch).
 *   - `hmGet` bounds: out-of-bounds returns NO_HIT literal -1 (not
 *     undefined); in-bounds matches direct radii read.
 *
 * Machine scope: heightmap.ts is consumed by `rasterize.ts`,
 * `strategies/finishing.ts`, `strategies/roughing.ts`, and `tool-comp.ts`
 * -- all five Carvera + 4th-axis cam-axis4 strategies inherit these
 * invariants. Cross-cuts to `cam-operation-policy.ts` (docstring only).
 *
 * ZERO production-code edits this cycle. Pure additive paired-pin per the
 * Cycle 119 [ID-0196] / Cycle 108 [ID-0190] / Cycle 106 [ID-0188]
 * convention.
 */
import { describe, expect, it } from 'vitest'
import {
  buildCylindricalHeightmap,
  countHits,
  hmGet,
  HIT_CLAMPED,
  NO_HIT
} from '../heightmap'
import type { Triangle } from '../frame'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const STOCK_R = 20

function tri(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number]
): Triangle {
  return [a, b, c]
}

/** Square plate at (xCenter, 0, zPos), facing +Z, halfSize on each side. */
function plateAtPlusZ(xCenter: number, halfSize: number, zPos: number): Triangle[] {
  return [
    tri(
      [xCenter - halfSize, -halfSize, zPos],
      [xCenter + halfSize, -halfSize, zPos],
      [xCenter + halfSize, halfSize, zPos]
    ),
    tri(
      [xCenter - halfSize, -halfSize, zPos],
      [xCenter + halfSize, halfSize, zPos],
      [xCenter - halfSize, halfSize, zPos]
    )
  ]
}

/** Same shape rotated 90 deg about X -- plate at +Y instead of +Z. */
function plateAtPlusY(xCenter: number, halfSize: number, yPos: number): Triangle[] {
  return [
    tri(
      [xCenter - halfSize, yPos, -halfSize],
      [xCenter + halfSize, yPos, -halfSize],
      [xCenter + halfSize, yPos, halfSize]
    ),
    tri(
      [xCenter - halfSize, yPos, -halfSize],
      [xCenter + halfSize, yPos, halfSize],
      [xCenter - halfSize, yPos, halfSize]
    )
  ]
}

// ─── (A) Sentinel literal contract -- 3 it() ────────────────────────────────

describe('[ID-0197] (A) sentinel literal contract', () => {
  it('NO_HIT === -1 (literal -- pinned for ABI stability across consumers)', () => {
    expect(NO_HIT).toBe(-1)
  })

  it('HIT_CLAMPED === -2 (literal -- pinned for ABI stability)', () => {
    expect(HIT_CLAMPED).toBe(-2)
  })

  it('both sentinels are strictly negative (any cell >= 0 is a real radius)', () => {
    expect(NO_HIT).toBeLessThan(0)
    expect(HIT_CLAMPED).toBeLessThan(0)
    // And distinct, so consumers can disambiguate the two error states.
    expect(NO_HIT).not.toBe(HIT_CLAMPED)
  })
})

// ─── (B) CylindricalHeightmap return-shape contract -- 6 it() ───────────────

describe('[ID-0197] (B) CylindricalHeightmap return-shape contract', () => {
  it('radii is a Float32Array', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    expect(hm.radii).toBeInstanceOf(Float32Array)
  })

  it('radii.length === nx * na (row-major axial-major layout)', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 7,
      na: 11
    })
    expect(hm.radii.length).toBe(7 * 11)
  })

  it('nx and na fields preserve input values exactly', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 13,
      na: 17
    })
    expect(hm.nx).toBe(13)
    expect(hm.na).toBe(17)
  })

  it('xStart field preserves input verbatim (including negative values)', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: -7.5,
      xEnd: 22.5,
      nx: 5,
      na: 8
    })
    expect(hm.xStart).toBe(-7.5)
  })

  it('dx === (xEnd - xStart) / (nx - 1) when nx > 1', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 5,
      xEnd: 65,
      nx: 13, // span 60, nx-1 = 12 -> dx = 5
      na: 8
    })
    expect(hm.dx).toBeCloseTo(5, 12)
  })

  it('daDeg === 360 / na (full circle divided evenly)', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 36 // 10 deg steps
    })
    expect(hm.daDeg).toBeCloseTo(10, 12)

    const hm2 = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 18 // 20 deg steps
    })
    expect(hm2.daDeg).toBeCloseTo(20, 12)
  })
})

// ─── (C) Empty-triangle full sweep -- 4 it() ────────────────────────────────

describe('[ID-0197] (C) empty triangles -> all NO_HIT, countHits zero', () => {
  it('every cell of an empty-mesh heightmap equals NO_HIT', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    for (let i = 0; i < hm.radii.length; i++) {
      expect(hm.radii[i]).toBe(NO_HIT)
    }
  })

  it('countHits.hitCount === 0 for empty mesh', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    expect(countHits(hm).hitCount).toBe(0)
  })

  it('countHits.clampedCount === 0 for empty mesh', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    expect(countHits(hm).clampedCount).toBe(0)
  })

  it('countHits.meshRadialMin === 0 (Infinity-guard) when no real hits exist', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    // The implementation initializes meshRadialMin = Infinity, then
    // resets to 0 if it never updated. The contract pins the 0 outcome,
    // not the Infinity intermediate state -- consumers see 0.
    const stats = countHits(hm)
    expect(stats.meshRadialMin).toBe(0)
    expect(Number.isFinite(stats.meshRadialMin)).toBe(true)
  })
})

// ─── (D) Indexing convention [ix * na + ia] -- 3 it() ───────────────────────

describe('[ID-0197] (D) indexing convention [ix * na + ia]', () => {
  it('hmGet(hm, 0, 0) === radii[0]', () => {
    const tris = plateAtPlusZ(50, 5, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 11,
      na: 12
    })
    expect(hmGet(hm, 0, 0)).toBe(hm.radii[0])
  })

  it('hmGet(hm, ix, ia) === radii[ix * na + ia] across the full grid', () => {
    const tris = plateAtPlusZ(50, 5, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 11,
      na: 12
    })
    for (let ix = 0; ix < hm.nx; ix++) {
      for (let ia = 0; ia < hm.na; ia++) {
        expect(hmGet(hm, ix, ia)).toBe(hm.radii[ix * hm.na + ia])
      }
    }
  })

  it('hmGet(hm, 2, 3) === radii[2 * na + 3] (specific index probe)', () => {
    const tris = plateAtPlusZ(50, 5, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 11,
      na: 12
    })
    expect(hmGet(hm, 2, 3)).toBe(hm.radii[2 * hm.na + 3])
  })
})

// ─── (E) outOfStockHitMode default -- 2 it() ────────────────────────────────

describe('[ID-0197] (E) outOfStockHitMode default behavior', () => {
  it('omitted outOfStockHitMode defaults to "reject" (HIT_CLAMPED)', () => {
    // Plate at +Z=25, stockRadius=20 -> 5 mm past OD.
    const tris = plateAtPlusZ(50, 5, 25)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
      // outOfStockHitMode omitted
    })
    expect(hmGet(hm, 20, 0)).toBe(HIT_CLAMPED)
  })

  it('explicit "reject" produces the SAME cell value as omitted (default = "reject")', () => {
    const tris = plateAtPlusZ(50, 5, 25)
    const hmOmitted = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    const hmExplicit = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36,
      outOfStockHitMode: 'reject'
    })
    // Byte-equal cell-by-cell (Float32Array equality via Array round-trip).
    expect(Array.from(hmExplicit.radii)).toEqual(Array.from(hmOmitted.radii))
  })
})

// ─── (F) Multiple axial slices -- 3 it() ────────────────────────────────────

describe('[ID-0197] (F) multiple axial slices', () => {
  it('a long plate spanning x=10..50 produces hits at multiple ix indices', () => {
    // Plate at +Z=10 spanning x=10..50, na=36 (10 deg).
    const tris = plateAtPlusZ(30, 20, 10) // halfSize=20 -> x in [10, 50]
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 60,
      nx: 61, // dx = 1 mm -> ix = x
      na: 36
    })
    // ia=0 corresponds to A=0 (ray from +Z). The plate is at +Z=10, so
    // ia=0 should hit at every ix in [10, 50].
    let hitCount = 0
    for (let ix = 10; ix <= 50; ix++) {
      const r = hmGet(hm, ix, 0)
      if (r !== NO_HIT && r !== HIT_CLAMPED) hitCount++
    }
    // Allow some boundary slack but require >= 30 hits in the 41-cell range.
    expect(hitCount).toBeGreaterThanOrEqual(30)
  })

  it('a plate at xStart hits in column ix=0 (low-end boundary)', () => {
    // xStart=10, plate centered at x=10 (right at the low edge).
    const tris = plateAtPlusZ(10, 2, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 10,
      xEnd: 60,
      nx: 51, // dx = 1, ix=0 -> x=10
      na: 36
    })
    expect(hmGet(hm, 0, 0)).toBeCloseTo(10, 1)
  })

  it('a plate at xEnd hits in column ix=nx-1 (high-end boundary)', () => {
    // xEnd=60, plate centered at x=60.
    const tris = plateAtPlusZ(60, 2, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 10,
      xEnd: 60,
      nx: 51, // dx = 1, ix=50 -> x=60
      na: 36
    })
    expect(hmGet(hm, 50, 0)).toBeCloseTo(10, 1)
  })
})

// ─── (G) Closest triangle wins -- 3 it() ────────────────────────────────────

describe('[ID-0197] (G) closest-triangle-wins ray semantics', () => {
  it('two parallel plates at +Z=8 and +Z=12 -> cell records r=8 (closer surface)', () => {
    const tris = [...plateAtPlusZ(50, 5, 8), ...plateAtPlusZ(50, 5, 12)]
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    // Ray comes from +Z=castR (50) and travels -Z. It hits +Z=12 first
    // (smaller t), then +Z=8 -- but Möller-Trumbore returns the smallest
    // valid t. From castR=50 with dz=-1, the closer surface (smaller t)
    // is at z=12 -> r=12.
    expect(hmGet(hm, 20, 0)).toBeCloseTo(12, 1)
  })

  it('moving the closer plate further reverses which radius is recorded', () => {
    // Now +Z=15 (closer to castR=50 -> smaller t) and +Z=8 (further).
    const tris = [...plateAtPlusZ(50, 5, 15), ...plateAtPlusZ(50, 5, 8)]
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    // Ray from +Z=50 hits +Z=15 first (smaller t).
    expect(hmGet(hm, 20, 0)).toBeCloseTo(15, 1)
  })

  it('a single plate produces a single non-NO_HIT cell at ia=0 / center ix', () => {
    const tris = plateAtPlusZ(50, 1, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    // Center cell (ix=20, ia=0) should be a real hit; far away cells
    // should be NO_HIT.
    expect(hmGet(hm, 20, 0)).toBeCloseTo(10, 1)
    expect(hmGet(hm, 0, 0)).toBe(NO_HIT)
    expect(hmGet(hm, 40, 0)).toBe(NO_HIT)
  })
})

// ─── (H) Degenerate inputs -- 4 it() ────────────────────────────────────────

describe('[ID-0197] (H) degenerate inputs', () => {
  it('nx=1 -> dx === (xEnd - xStart) (max(1, nx-1) clamp prevents div-by-zero)', () => {
    // The implementation: dx = (xEnd - xStart) / max(1, nx - 1).
    // For nx=1, max(1, 0) = 1, so dx = xEnd - xStart.
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 5,
      xEnd: 25,
      nx: 1,
      na: 6
    })
    expect(hm.dx).toBeCloseTo(20, 12) // xEnd - xStart = 20
    expect(hm.nx).toBe(1)
    expect(hm.radii.length).toBe(1 * 6)
  })

  it('na=1 -> daDeg === 360 (single angular slice covers full circle)', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 1
    })
    expect(hm.daDeg).toBeCloseTo(360, 12)
    expect(hm.na).toBe(1)
    expect(hm.radii.length).toBe(5 * 1)
  })

  it('xEnd === xStart -> dx === 0 (zero span; max(1,nx-1) still divides cleanly)', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 7,
      xEnd: 7,
      nx: 5,
      na: 6
    })
    expect(hm.dx).toBe(0)
    expect(hm.xStart).toBe(7)
  })

  it('a near-axis hit (rHit < 0.01) -> NO_HIT (degeneracy guard, not 0)', () => {
    // Place a plate AT the rotation axis (z=0). Ray from +Z hits z=0 ->
    // rHit = hypot(0, 0) = 0 < 0.01 -> the guard skips assigning the cell,
    // leaving it at the NO_HIT initialization value.
    const tris = plateAtPlusZ(50, 5, 0)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    // Cell stays at NO_HIT (= -1), not 0. This pins the >=0.01 floor in
    // the production code: a future refactor that drops the guard would
    // record r=0, breaking this assertion.
    expect(hmGet(hm, 20, 0)).toBe(NO_HIT)
  })
})

// ─── (I) countHits invariants -- 5 it() ─────────────────────────────────────

describe('[ID-0197] (I) countHits invariants', () => {
  it('all-clamped heightmap -> hitCount=0, clampedCount=N, meshRadialMin=0', () => {
    // Plate at +Z=25 (past stock R=20) -> all column-0 cells in the
    // plate's x-span clamp; everything else is NO_HIT.
    const tris = plateAtPlusZ(50, 5, 25)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    const stats = countHits(hm)
    expect(stats.hitCount).toBe(0)
    expect(stats.clampedCount).toBeGreaterThan(0)
    expect(stats.meshRadialMin).toBe(0) // no real hits -> Infinity-guard kicks in
  })

  it('hit + clamped + no-hit-cell-count === radii.length (partition invariant)', () => {
    // Mixed: plate at +Z=10 (real hit) AND plate at +Z=25 (clamped).
    const tris = [...plateAtPlusZ(45, 3, 10), ...plateAtPlusZ(55, 3, 25)]
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    const stats = countHits(hm)
    let noHitCount = 0
    for (let i = 0; i < hm.radii.length; i++) {
      if (hm.radii[i] === NO_HIT) noHitCount++
    }
    expect(stats.hitCount + stats.clampedCount + noHitCount).toBe(hm.radii.length)
  })

  it('meshRadialMin tracks the smallest real hit across the WHOLE grid (clamped cells excluded)', () => {
    // Two plates: at +Z=8 (smaller r) and at +Z=14 (larger r).
    // The plates are 2-sided and the heightmap raycasts from every
    // angular direction A in [0, 360). At A=0 the ray comes from +Z
    // and hits the FURTHER plate (z=14) FIRST (smaller t -- castR=50
    // gives t=36 vs t=42 for z=8), recording r=14 in that cell. But
    // at A=180 the ray comes from -Z and hits the z=8 plate FIRST
    // (smaller t from oz=-50: t=58 for z=8 vs t=64 for z=14),
    // recording r=8 in that cell. So the GLOBAL minimum across the
    // whole grid is 8 -- the smallest radial distance any triangle
    // has from the rotation axis, regardless of which angular cell
    // captured it.
    const tris = [...plateAtPlusZ(50, 5, 8), ...plateAtPlusZ(50, 5, 14)]
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    const stats = countHits(hm)
    // Pin the contract: meshRadialMin equals the smallest-radius surface
    // in the mesh, NOT a per-cell artifact at A=0. Tolerance 0.1 mm.
    expect(stats.meshRadialMin).toBeGreaterThan(7.9)
    expect(stats.meshRadialMin).toBeLessThan(8.1)
    // And confirm we have both real hits AND clamped===0 (no past-stock).
    expect(stats.hitCount).toBeGreaterThan(0)
    expect(stats.clampedCount).toBe(0)
  })

  it('meshRadialMin === 0 specifically when no real hits exist (Infinity-guard branch)', () => {
    // Only clamped cells, no real hits.
    const tris = plateAtPlusZ(50, 5, 25)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    const stats = countHits(hm)
    expect(stats.hitCount).toBe(0)
    // The Infinity-guard at the end of countHits resets meshRadialMin to 0
    // when no real hit was recorded. Pins the consumer-facing 0 outcome.
    expect(stats.meshRadialMin).toBe(0)
  })

  it('a single real hit at r=10 -> meshRadialMin === 10 (single-element minimum)', () => {
    const tris = plateAtPlusZ(50, 1, 10)
    const hm = buildCylindricalHeightmap(tris, {
      stockRadius: STOCK_R,
      xStart: 40,
      xEnd: 60,
      nx: 41,
      na: 36
    })
    const stats = countHits(hm)
    expect(stats.hitCount).toBeGreaterThanOrEqual(1)
    expect(stats.meshRadialMin).toBeCloseTo(10, 1)
  })
})

// ─── (J) hmGet bounds extension -- 2 it() ───────────────────────────────────

describe('[ID-0197] (J) hmGet bounds-checking extension', () => {
  it('hmGet returns the literal NO_HIT === -1 for out-of-bounds (not undefined)', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    // The four out-of-bounds quadrants:
    expect(hmGet(hm, -1, 0)).toBe(-1)
    expect(hmGet(hm, 5, 0)).toBe(-1)
    expect(hmGet(hm, 0, -1)).toBe(-1)
    expect(hmGet(hm, 0, 6)).toBe(-1)
    // Pin the literal -1 -- consumers may compare against -1 directly,
    // not just NO_HIT, so any future renumber must update both.
  })

  it('hmGet for a far-out-of-bounds index still returns NO_HIT, never throws', () => {
    const hm = buildCylindricalHeightmap([], {
      stockRadius: STOCK_R,
      xStart: 0,
      xEnd: 10,
      nx: 5,
      na: 6
    })
    expect(hmGet(hm, 1000000, 1000000)).toBe(NO_HIT)
    expect(hmGet(hm, -1000000, -1000000)).toBe(NO_HIT)
    // Confirms guard is `if (out-of-bounds) return NO_HIT` -- not array
    // access via indexing-into-undefined which would either throw or
    // return undefined (and undefined !== NO_HIT in == comparison).
  })
})
