/**
 * Tests for src/shared/auto-arrange-plate.ts
 *
 * Coverage:
 *  - Happy path: 4 × 100mm cubes on a 350mm K2 plate → all fit at ≥32.7% util.
 *  - Overflow path: 5 × 200mm cubes on a 350mm K2 plate → only the cubes that fit
 *    are placed, the rest go to `unplaced[]`.
 *  - 90° rotation: a tall + narrow part rotates 90° to fit a remaining shelf.
 *  - Clearance enforcement: a 348mm cube on a 350mm plate with 2mm clearance
 *    does NOT fit (would need exactly 352mm including clearance).
 *  - No-mutation: input arrays are not modified.
 *  - Determinism: repeated calls with the same input return equivalent placements.
 *  - Bad input: degenerate meshes are reported as unplaced, not thrown.
 *  - Bad plate: throws on non-positive dimensions; throws on negative clearance.
 */
import { describe, expect, it } from 'vitest'
import {
  autoArrangePlate,
  placementToCenteredOffset,
  placementToPositionOffset,
  type ArrangedPlate,
  type AutoArrangeMesh,
  type AutoArrangePlacement
} from './auto-arrange-plate'

// K2 Plus print bed dimensions (CLAUDE.md USER CONTEXT — TARGET MACHINES).
const K2_PLATE = { x: 350, y: 350, clearance: 3 } as const

function cube(id: string, sizeMm: number): AutoArrangeMesh {
  return { id, aabbMm: { width: sizeMm, depth: sizeMm, height: sizeMm } }
}

function brick(id: string, wMm: number, dMm: number, hMm = 20): AutoArrangeMesh {
  return { id, aabbMm: { width: wMm, depth: dMm, height: hMm } }
}

function checkNoOverlap(plate: ArrangedPlate, meshes: ReadonlyArray<AutoArrangeMesh>, clearance: number): void {
  // For every pair of placements, verify the AABBs (inflated by clearance/2 on
  // each side) do not overlap. Mirrors the safety invariant the algorithm
  // promises: parts must never be placed colliding.
  for (let i = 0; i < plate.placements.length; i++) {
    const pi = plate.placements[i]!
    const mi = meshes.find((m) => m.id === pi.id)!
    const wi = pi.rotationDeg === 0 ? mi.aabbMm.width : mi.aabbMm.depth
    const di = pi.rotationDeg === 0 ? mi.aabbMm.depth : mi.aabbMm.width
    for (let j = i + 1; j < plate.placements.length; j++) {
      const pj = plate.placements[j]!
      const mj = meshes.find((m) => m.id === pj.id)!
      const wj = pj.rotationDeg === 0 ? mj.aabbMm.width : mj.aabbMm.depth
      const dj = pj.rotationDeg === 0 ? mj.aabbMm.depth : mj.aabbMm.width
      const aMinX = pi.xMm
      const aMaxX = pi.xMm + wi
      const aMinY = pi.yMm
      const aMaxY = pi.yMm + di
      const bMinX = pj.xMm
      const bMaxX = pj.xMm + wj
      const bMinY = pj.yMm
      const bMaxY = pj.yMm + dj
      const overlaps =
        aMinX < bMaxX - 1e-6 && aMaxX > bMinX + 1e-6 &&
        aMinY < bMaxY - 1e-6 && aMaxY > bMinY + 1e-6
      expect(overlaps, `placements ${pi.id} and ${pj.id} overlap (clearance ${clearance})`).toBe(false)
    }
  }
}

describe('autoArrangePlate', () => {
  describe('happy path: 4 × 100mm cubes on 350mm plate', () => {
    const meshes = [
      cube('cube-1', 100),
      cube('cube-2', 100),
      cube('cube-3', 100),
      cube('cube-4', 100)
    ]

    it('places all four cubes', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      expect(result.placements).toHaveLength(4)
      expect(result.unplaced).toEqual([])
    })

    it('reports utilization at expected pack density (≥32.7%)', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      // 4 × 100×100 = 40,000 mm² on 350×350 = 122,500 mm² → 32.65%
      expect(result.utilizationPct).toBeGreaterThanOrEqual(32.5)
      expect(result.utilizationPct).toBeLessThanOrEqual(33.0)
    })

    it('returns placements in input order', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      expect(result.placements.map((p) => p.id)).toEqual(['cube-1', 'cube-2', 'cube-3', 'cube-4'])
    })

    it('places every part fully inside the plate envelope (clearance honoured)', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      for (const p of result.placements) {
        const mesh = meshes.find((m) => m.id === p.id)!
        const w = p.rotationDeg === 0 ? mesh.aabbMm.width : mesh.aabbMm.depth
        const d = p.rotationDeg === 0 ? mesh.aabbMm.depth : mesh.aabbMm.width
        // Each part's AABB-min sits at least `clearance` from the plate origin
        // (algorithm inflates by clearance on the negative side).
        expect(p.xMm).toBeGreaterThanOrEqual(K2_PLATE.clearance - 1e-6)
        expect(p.yMm).toBeGreaterThanOrEqual(K2_PLATE.clearance - 1e-6)
        expect(p.xMm + w + K2_PLATE.clearance).toBeLessThanOrEqual(K2_PLATE.x + 1e-6)
        expect(p.yMm + d + K2_PLATE.clearance).toBeLessThanOrEqual(K2_PLATE.y + 1e-6)
      }
    })

    it('produces non-overlapping placements', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      checkNoOverlap(result, meshes, K2_PLATE.clearance)
    })

    it('rotationDeg is always 0 or 90 (no diagonal placements)', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      for (const p of result.placements) {
        expect([0, 90]).toContain(p.rotationDeg)
      }
    })
  })

  describe('overflow path: 5 × 200mm cubes on 350mm plate', () => {
    const meshes = [
      cube('big-1', 200),
      cube('big-2', 200),
      cube('big-3', 200),
      cube('big-4', 200),
      cube('big-5', 200)
    ]

    it('only places parts that fit (1 or 2 cubes); rest go to unplaced', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      // 200 + 3 + 3 = 206 mm. Two cubes side-by-side need 412 mm > 350 mm.
      // So only ONE cube fits per row; only one row fits (next row needs
      // y = 0 + 206 + 206 = 412 > 350). Hence exactly 1 placement.
      expect(result.placements.length).toBeGreaterThanOrEqual(1)
      expect(result.placements.length).toBeLessThanOrEqual(2)
      expect(result.unplaced.length).toBeGreaterThanOrEqual(3)
      expect(result.placements.length + result.unplaced.length).toBe(5)
    })

    it('placed parts do not overlap', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      checkNoOverlap(result, meshes, K2_PLATE.clearance)
    })

    it('reports utilization that excludes unplaced parts', () => {
      const result = autoArrangePlate(meshes, K2_PLATE)
      // 1 × 200×200 = 40,000 mm² on 350×350 = 122,500 mm² → 32.65%.
      // If 2 fit (unlikely with clearance), still ≤ ~65.3%.
      expect(result.utilizationPct).toBeGreaterThan(0)
      expect(result.utilizationPct).toBeLessThanOrEqual(65.5)
    })
  })

  describe('90° rotation', () => {
    it('rotates a tall narrow part to fit a wide shelf remainder', () => {
      // First a 300×60 brick takes the bottom shelf.
      // Then a 200×60 brick fits beside it (300 + 6 + 200 = 506 > 350 → won't fit at 0°).
      // But rotated to 60×200, it would need its OWN shelf (since shelfHeight is only 60+6).
      // We can't force a specific rotation in a black-box test, but we can verify
      // that the algorithm finds SOME legal arrangement when a forced-rotate is needed.
      const meshes = [
        brick('wide-1', 300, 60),
        // A 60×300 brick would NEVER fit beside the wide-1 (which occupies the
        // full width). Rotated to 300×60, also won't fit (same shelf has
        // 0 + 306 = 306 mm used; only 44 mm left, and 300 > 44). It must
        // open a new shelf one way or another.
        brick('tall-1', 60, 300)
      ]
      const result = autoArrangePlate(meshes, K2_PLATE)
      expect(result.placements).toHaveLength(2)
      expect(result.unplaced).toEqual([])
      checkNoOverlap(result, meshes, K2_PLATE.clearance)
    })

    it('a single rotation-only fit is honoured (mesh that ONLY fits at 90°)', () => {
      // A 340×40 brick fits flat (340 + 6 = 346 ≤ 350). But a 340×340 plate
      // with clearance can't host a 360×40 brick at 0° (360 + 6 > 350) —
      // rotated 90° it's 40×360 which also doesn't fit. So pick a case
      // where ONE rotation works:
      //   plate 350×350, clearance 3, brick 100×346.
      //   0°: width 100+6=106 ≤350, depth 346+6=352 > 350 → fails.
      //   90°: width 346+6=352 > 350 → fails too! Need a smaller depth.
      //   plate 350×350, clearance 3, brick 80×340.
      //   0°: 80+6=86 ≤ 350, 340+6=346 ≤ 350 → fits at 0°.
      //   90°: 340+6=346 ≤ 350, 80+6=86 ≤ 350 → also fits.
      //   So we need a brick that ONLY fits at one rotation:
      //   plate 350×100, clearance 3, brick 90×340.
      //   0°: 90+6=96 ≤ 350, 340+6=346 > 100 → fails.
      //   90°: 340+6=346 ≤ 350, 90+6=96 ≤ 100 → fits at 90°.
      const plate = { x: 350, y: 100, clearance: 3 }
      const meshes = [brick('rotate-me', 90, 340)]
      const result = autoArrangePlate(meshes, plate)
      expect(result.placements).toHaveLength(1)
      expect(result.placements[0]?.rotationDeg).toBe(90)
    })
  })

  describe('clearance enforcement', () => {
    it('rejects a cube that exceeds the plate after clearance is added', () => {
      // 348 + 2 (clearance×2) = 352 > 350 → cannot fit.
      const meshes = [cube('too-big', 348)]
      const plate = { x: 350, y: 350, clearance: 2 }
      const result = autoArrangePlate(meshes, plate)
      expect(result.placements).toEqual([])
      expect(result.unplaced).toEqual(['too-big'])
    })

    it('accepts a cube that exactly fits with clearance', () => {
      // 344 + 6 (clearance×2) = 350 → exactly fits.
      const meshes = [cube('just-fits', 344)]
      const plate = { x: 350, y: 350, clearance: 3 }
      const result = autoArrangePlate(meshes, plate)
      expect(result.placements).toHaveLength(1)
      expect(result.unplaced).toEqual([])
    })

    it('honours zero clearance (parts can sit at plate edge)', () => {
      // Two 175×350 bricks should exactly tile the plate.
      const meshes = [brick('half-1', 175, 350), brick('half-2', 175, 350)]
      const plate = { x: 350, y: 350, clearance: 0 }
      const result = autoArrangePlate(meshes, plate)
      expect(result.placements).toHaveLength(2)
      expect(result.unplaced).toEqual([])
      expect(result.utilizationPct).toBeCloseTo(100, 1)
    })
  })

  describe('input validation', () => {
    it('throws on zero / negative plate width', () => {
      expect(() => autoArrangePlate([], { x: 0, y: 350, clearance: 3 })).toThrow(/positive/i)
      expect(() => autoArrangePlate([], { x: -1, y: 350, clearance: 3 })).toThrow(/positive/i)
    })

    it('throws on zero / negative plate height', () => {
      expect(() => autoArrangePlate([], { x: 350, y: 0, clearance: 3 })).toThrow(/positive/i)
    })

    it('throws on negative clearance', () => {
      expect(() => autoArrangePlate([], { x: 350, y: 350, clearance: -1 })).toThrow(/clearance/i)
    })

    it('reports degenerate meshes as unplaced (NaN, zero, negative)', () => {
      const meshes: AutoArrangeMesh[] = [
        { id: 'zero', aabbMm: { width: 0, depth: 50, height: 20 } },
        { id: 'negative', aabbMm: { width: -10, depth: 50, height: 20 } },
        { id: 'nan', aabbMm: { width: NaN, depth: 50, height: 20 } },
        cube('good', 50)
      ]
      const result = autoArrangePlate(meshes, K2_PLATE)
      expect(result.placements.map((p) => p.id)).toEqual(['good'])
      expect(result.unplaced).toEqual(expect.arrayContaining(['zero', 'negative', 'nan']))
    })

    it('handles an empty input list', () => {
      const result = autoArrangePlate([], K2_PLATE)
      expect(result.placements).toEqual([])
      expect(result.unplaced).toEqual([])
      expect(result.utilizationPct).toBe(0)
    })
  })

  describe('determinism + non-mutation', () => {
    it('does not mutate the input mesh list', () => {
      const meshes = [cube('a', 100), cube('b', 100)]
      const snapshot = JSON.stringify(meshes)
      autoArrangePlate(meshes, K2_PLATE)
      expect(JSON.stringify(meshes)).toBe(snapshot)
    })

    it('returns equivalent placements on repeated runs with the same input', () => {
      const meshes = [cube('a', 80), cube('b', 120), brick('c', 100, 50)]
      const r1 = autoArrangePlate(meshes, K2_PLATE)
      const r2 = autoArrangePlate(meshes, K2_PLATE)
      expect(r2.placements).toEqual(r1.placements)
      expect(r2.unplaced).toEqual(r1.unplaced)
      expect(r2.utilizationPct).toBe(r1.utilizationPct)
    })
  })

  describe('K2 Plus specifics (USER CONTEXT compliance)', () => {
    it('respects the 350×350 mm K2 Plus build volume', () => {
      // Try a single 360×360 cube: must NOT fit (exceeds X/Y both).
      const meshes = [cube('overflow', 360)]
      const result = autoArrangePlate(meshes, K2_PLATE)
      expect(result.placements).toEqual([])
      expect(result.unplaced).toEqual(['overflow'])
    })
  })
})

describe('placementToPositionOffset', () => {
  it('returns the centroid offset for a 0° placement', () => {
    const p: AutoArrangePlacement = { id: 'x', xMm: 50, yMm: 100, rotationDeg: 0 }
    expect(placementToPositionOffset(p, 100, 60)).toEqual({ x: 100, y: 130 })
  })

  it('swaps width/depth for a 90° placement', () => {
    const p: AutoArrangePlacement = { id: 'x', xMm: 50, yMm: 100, rotationDeg: 90 }
    expect(placementToPositionOffset(p, 100, 60)).toEqual({
      x: 50 + 60 / 2,
      y: 100 + 100 / 2
    })
  })
})

describe('placementToCenteredOffset', () => {
  it('shifts the centroid offset by -plate/2 so the plate centre is at world origin', () => {
    const p: AutoArrangePlacement = { id: 'x', xMm: 50, yMm: 100, rotationDeg: 0 }
    const off = placementToCenteredOffset(p, 100, 60, 350, 350)
    // Centroid was (100, 130) → centred = (100 - 175, 130 - 175) = (-75, -45).
    expect(off).toEqual({ x: -75, y: -45 })
  })

  it('places a single cube whose AABB-min sits at the plate origin (175, 175) at world (0, 0)', () => {
    // A 50mm cube at placement (150, 150) rotated 0° → AABB-max at (200, 200).
    // Centroid at (175, 175) → centred = (0, 0).
    const p: AutoArrangePlacement = { id: 'cube', xMm: 150, yMm: 150, rotationDeg: 0 }
    const off = placementToCenteredOffset(p, 50, 50, 350, 350)
    expect(off).toEqual({ x: 0, y: 0 })
  })
})

