/**
 * Pure-helper tests for ManufactureCamSimulationPanel — the two V2 toolpath
 * playback "full vision" features that are cleanly testable without React or
 * react-three-fiber:
 *   1. Feed-rate color coding  → computeFeedRateRangeMmMin + feedRateHeatColor
 *   2. Rotary collision overlay → collidingRawSegmentIndices (segment→index map)
 *
 * The panel module imports @react-three/fiber and @react-three/drei at the top
 * level; those are mocked so the module loads under the `node` test environment.
 * `three` itself is REAL — feedRateHeatColor uses THREE.Color (pure math, no DOM)
 * and collidingRawSegmentIndices delegates to the real, battle-tested
 * checkRotaryFixtureCollision (it is not reimplemented here).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ToolpathSegment4 } from '../../shared/cam-gcode-toolpath'

vi.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useFrame: () => {},
  useThree: () => ({})
}))
vi.mock('@react-three/drei', () => ({
  Bounds: () => null,
  ContactShadows: () => null,
  Grid: () => null,
  Line: () => null,
  OrbitControls: () => null
}))

import {
  computeFeedRateRangeMmMin,
  feedRateHeatColor,
  collidingRawSegmentIndices
} from './ManufactureCamSimulationPanel'

describe('computeFeedRateRangeMmMin', () => {
  it('returns null when no segment carries a feed', () => {
    expect(computeFeedRateRangeMmMin([])).toBeNull()
    expect(computeFeedRateRangeMmMin([{}, {}])).toBeNull()
    expect(computeFeedRateRangeMmMin([{ feedMmMin: undefined }])).toBeNull()
  })

  it('returns {min,max} over segments that carry a feed', () => {
    const r = computeFeedRateRangeMmMin([
      { feedMmMin: 300 },
      { feedMmMin: 1200 },
      { feedMmMin: 600 }
    ])
    expect(r).toEqual({ min: 300, max: 1200 })
  })

  it('ignores undefined / non-finite feeds but keeps the valid ones', () => {
    const r = computeFeedRateRangeMmMin([
      { feedMmMin: 500 },
      { feedMmMin: undefined },
      { feedMmMin: Number.NaN },
      { feedMmMin: 900 }
    ])
    expect(r).toEqual({ min: 500, max: 900 })
  })

  it('a single feed value yields min === max', () => {
    expect(computeFeedRateRangeMmMin([{ feedMmMin: 800 }, { feedMmMin: 800 }])).toEqual({
      min: 800,
      max: 800
    })
  })
})

describe('feedRateHeatColor', () => {
  it('maps the slow end to a cold (blue-dominant) color', () => {
    const [r, , b] = feedRateHeatColor(100, 100, 1000)
    expect(b).toBeGreaterThan(r) // blue channel dominates at the cold end
  })

  it('maps the fast end to a hot (red-dominant) color', () => {
    const [r, , b] = feedRateHeatColor(1000, 100, 1000)
    expect(r).toBeGreaterThan(b) // red channel dominates at the hot end
  })

  it('clamps feeds outside [min,max] to the endpoints', () => {
    expect(feedRateHeatColor(50, 100, 1000)).toEqual(feedRateHeatColor(100, 100, 1000))
    expect(feedRateHeatColor(5000, 100, 1000)).toEqual(feedRateHeatColor(1000, 100, 1000))
  })

  it('uses the midpoint color when min === max (degenerate range)', () => {
    const mid = feedRateHeatColor(500, 500, 500)
    // Should equal the t=0.5 color of any non-degenerate range with the same hue mapping.
    const half = feedRateHeatColor(550, 100, 1000) // t = 0.5
    expect(mid[0]).toBeCloseTo(half[0], 6)
    expect(mid[1]).toBeCloseTo(half[1], 6)
    expect(mid[2]).toBeCloseTo(half[2], 6)
  })

  it('returns the cold end for a non-finite feed', () => {
    expect(feedRateHeatColor(Number.NaN, 100, 1000)).toEqual(feedRateHeatColor(100, 100, 1000))
  })

  it('every channel is within [0,1]', () => {
    for (const f of [100, 300, 550, 800, 1000]) {
      for (const c of feedRateHeatColor(f, 100, 1000)) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })
})

/** Build a ToolpathSegment4 (only x/z matter for the planar chuck check). */
function seg(
  kind: 'rapid' | 'feed',
  x0: number,
  z0: number,
  x1: number,
  z1: number
): ToolpathSegment4 {
  return { kind, x0, y0: 0, z0, a0: 0, b0: 0, x1, y1: 0, z1, a1: 0, b1: 0 }
}

describe('collidingRawSegmentIndices (segment → collision-index mapping)', () => {
  // Representative Carvera 4th-Axis HD setup: chuck body OD ≈ 92 mm (R=46),
  // grabbing ~25 mm deep — the bundled makera-carvera-4axis.json values.
  const fixture = { chuckDepthMm: 25, chuckOuterRadiusMm: 46 }
  const opts = { toolDiameterMm: 3 }

  it('returns [] for an empty segment list', () => {
    expect(collidingRawSegmentIndices([], fixture, opts)).toEqual([])
  })

  it('returns [] when the whole path clears the chuck', () => {
    // Establish X past the chuck, then cut at a safe radius well outside R=46.
    const segs = [seg('feed', 40, 60, 80, 60)]
    expect(collidingRawSegmentIndices(segs, fixture, opts)).toEqual([])
  })

  it('flags exactly the colliding feed segment by its index', () => {
    // seg0: establishing rapid to X past the chuck (safe, high Z).
    // seg1: safe contour outside the chuck.
    // seg2: a feed that dives into the chuck X-zone at a low radius → collision.
    const segs = [
      seg('rapid', 40, 60, 40, 60),
      seg('feed', 40, 50, 80, 50),
      seg('feed', 80, 50, 5, 5)
    ]
    const idxs = collidingRawSegmentIndices(segs, fixture, opts)
    expect(idxs).toContain(2)
    expect(idxs).not.toContain(1)
  })

  it('returns a sorted, de-duplicated ascending index list', () => {
    // Multiple distinct segments collide; result must be sorted unique indices.
    const segs = [
      seg('feed', 50, 5, 5, 5), // establishing move ends deep in the chuck → index 0
      seg('feed', 5, 5, 10, 5), // stays in the chuck zone → index 1
      seg('feed', 10, 5, 60, 5) // climbs back out (starts inside) → index 2
    ]
    const idxs = collidingRawSegmentIndices(segs, fixture, opts)
    // All three segments collide → exactly [0, 1, 2], sorted ascending, no dupes.
    expect(idxs).toEqual([0, 1, 2])
    const sortedUnique = Array.from(new Set(idxs)).sort((a, b) => a - b)
    expect(idxs).toEqual(sortedUnique)
  })
})
