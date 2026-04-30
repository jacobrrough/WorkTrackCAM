import { describe, expect, it } from 'vitest'
import type { ToolpathSegment4 } from './cam-gcode-toolpath'
import {
  checkRotaryFixtureCollision,
  formatRotaryCollisionWarnings
} from './rotary-collision'

/**
 * Build a ToolpathSegment4 with the fields we care about for the rotary
 * collision check; y/a/b values are irrelevant to this check because the
 * planar (X, Z) test is what collapses the 3D geometry.
 */
function seg(
  kind: 'rapid' | 'feed',
  x0: number,
  z0: number,
  x1: number,
  z1: number
): ToolpathSegment4 {
  return {
    kind,
    x0,
    y0: 0,
    z0,
    a0: 0,
    b0: 0,
    x1,
    y1: 0,
    z1,
    a1: 0,
    b1: 0
  }
}

describe('checkRotaryFixtureCollision — chuck', () => {
  // Representative Carvera 4th Axis HD setup:
  //   stock D=30 (R=15), chuck grabs 15 mm deep, chuck body OD ≈ 80 mm (R=40).
  const fixture = {
    chuckDepthMm: 15,
    chuckOuterRadiusMm: 40
  }
  const opts = { toolDiameterMm: 3, safetyMarginMm: 0.5 }

  it('passes a contour cut fully outside the chuck X extent', () => {
    // Feed from (X=30, Z=14.5) to (X=70, Z=14.5): well past chuckDepth.
    const segs = [seg('feed', 30, 14.5, 70, 14.5)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(true)
    expect(r.collisions).toHaveLength(0)
  })

  it('passes a rapid that retracts high above the chuck', () => {
    // Rapid from (X=50, Z=46) to (X=0, Z=46): crosses chuck X but above R=40+toolR+margin.
    const segs = [seg('rapid', 50, 46, 0, 46)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(true)
  })

  it('flags a feed move that dives into the chuck zone (both endpoints inside)', () => {
    // Feed from (X=5, Z=14.5) to (X=10, Z=14.5): both endpoints inside chuck X, Z below 40.
    const segs = [seg('feed', 5, 14.5, 10, 14.5)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(false)
    expect(r.collisions).toHaveLength(1)
    expect(r.collisions[0]!.fixture).toBe('chuck')
    expect(r.collisions[0]!.kind).toBe('feed')
    // Penetration: 14.5 − (40 + 1.5 + 0.5) = 14.5 − 42 = −27.5
    expect(r.collisions[0]!.clearance).toBeLessThan(-25)
  })

  it('catches a diagonal feed that dips into the chuck mid-segment', () => {
    // Starts outside the chuck (X=30, Z=14.5), ends inside (X=10, Z=14.5).
    // Only endpoint check would catch the X=10 end but sampling should flag
    // many points. Endpoint-only wouldn't catch this next case though:
    //   start (X=30, Z=46) outside + above, end (X=5, Z=14.5) inside chuck.
    // The straight-line midpoint is (X=17.5, Z≈30), also violating.
    const segs = [seg('rapid', 30, 46, 5, 14.5)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(false)
    expect(r.collisions.length).toBe(1)
    expect(r.collisions[0]!.fixture).toBe('chuck')
  })

  it('respects the safety margin: a just-clear move is safe, a just-inside move is flagged', () => {
    const tightOpts = { toolDiameterMm: 3, safetyMarginMm: 0.5 }
    // Safe: z = chuckOuterR + toolR + margin = 40 + 1.5 + 0.5 = 42 → Z=42.01 is above.
    const safe = checkRotaryFixtureCollision(
      [seg('rapid', 5, 42.01, 5, 42.01)],
      fixture,
      tightOpts
    )
    expect(safe.safe).toBe(true)
    // Just inside by 0.1 mm:
    const unsafe = checkRotaryFixtureCollision(
      [seg('rapid', 5, 41.9, 5, 41.9)],
      fixture,
      tightOpts
    )
    expect(unsafe.safe).toBe(false)
  })

  it('emits only one event per segment even if many samples fail', () => {
    // Long segment wholly inside the chuck zone — should flag exactly once.
    const segs = [seg('feed', 2, 14, 12, 14)]
    const r = checkRotaryFixtureCollision(segs, fixture, {
      ...opts,
      sampleCount: 64
    })
    expect(r.collisions).toHaveLength(1)
  })
})

describe('checkRotaryFixtureCollision — tailstock', () => {
  const fixture = {
    chuckDepthMm: 15,
    chuckOuterRadiusMm: 40,
    tailstockStartXMm: 100,
    tailstockOuterRadiusMm: 25
  }
  const opts = { toolDiameterMm: 3, safetyMarginMm: 0.5 }

  it('passes a cut well before the tailstock', () => {
    const segs = [seg('feed', 50, 14.5, 80, 14.5)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(true)
  })

  it('flags a cut past the tailstock X with Z below tailstock radius', () => {
    // Feed from (X=95, Z=14.5) to (X=105, Z=14.5): ends inside tailstock X, Z < 25+1.5+0.5=27.
    const segs = [seg('feed', 95, 14.5, 105, 14.5)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.fixture).toBe('tailstock')
  })

  it('does not flag a high retract over the tailstock', () => {
    // Rapid from (X=50, Z=46) to (X=105, Z=46): crosses tailstock X but above 27.
    const segs = [seg('rapid', 50, 46, 105, 46)]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(true)
  })

  it('skips the tailstock check entirely when tailstock config is omitted', () => {
    const noTail = {
      chuckDepthMm: 15,
      chuckOuterRadiusMm: 40
    }
    // Same "collision with tailstock" coordinates, but no tailstock configured.
    const segs = [seg('feed', 95, 14.5, 105, 14.5)]
    const r = checkRotaryFixtureCollision(segs, noTail, opts)
    expect(r.safe).toBe(true)
  })
})

describe('checkRotaryFixtureCollision — edge cases', () => {
  it('returns safe for an empty segment list', () => {
    const r = checkRotaryFixtureCollision([], { chuckDepthMm: 10, chuckOuterRadiusMm: 30 }, {
      toolDiameterMm: 3
    })
    expect(r.safe).toBe(true)
    expect(r.collisions).toHaveLength(0)
  })

  it('clamps sampleCount to a minimum of 2', () => {
    // With samples=0 (invalid), endpoints still sampled → collision caught.
    const segs = [seg('feed', 5, 14, 5, 14)]
    const r = checkRotaryFixtureCollision(
      segs,
      { chuckDepthMm: 15, chuckOuterRadiusMm: 40 },
      { toolDiameterMm: 3, sampleCount: 0 }
    )
    expect(r.safe).toBe(false)
  })

  it('treats toolDiameterMm=0 as a point tool', () => {
    // With toolR=0, only the fixture+margin buffer applies.
    const segs = [seg('feed', 15.4, 40.4, 15.4, 40.4)]
    const r = checkRotaryFixtureCollision(
      segs,
      { chuckDepthMm: 15, chuckOuterRadiusMm: 40 },
      { toolDiameterMm: 0, safetyMarginMm: 0.5 }
    )
    // x < 15 + 0 + 0.5 = 15.5 → yes (15.4 < 15.5). z < 40 + 0 + 0.5 = 40.5 → yes (40.4 < 40.5).
    expect(r.safe).toBe(false)
  })
})

describe('checkRotaryFixtureCollision — initial-approach handling', () => {
  const fixture = { chuckDepthMm: 15, chuckOuterRadiusMm: 40 }
  const opts = { toolDiameterMm: 3, safetyMarginMm: 0.5 }

  it('skips the pre-X-established approach (default behavior)', () => {
    // Mimics what the extractor produces for a Carvera 4-axis program:
    // initial (0,0,0) → (0,0,46) "safe Z retract", then (0,0,46) → (0,0,40)
    // "approach", then (0,0,40) → (50,0,40) "first X move". Without the
    // initial-approach guard, the two pre-X segments would flag the chuck.
    const segs = [
      seg('rapid', 0, 0, 0, 46),
      seg('rapid', 0, 46, 0, 40),
      seg('rapid', 0, 40, 50, 40), // establishing move — endpoint-only check
      seg('feed', 50, 14.5, 50, 14.5) // cut well outside chuck axially
    ]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(true)
  })

  it('sets initial-approach off and flags ambiguous pre-X segments', () => {
    const segs = [
      seg('rapid', 0, 0, 0, 46),
      seg('rapid', 0, 46, 0, 40) // Z=40, X=0 — chuck collision if checked
    ]
    const withGuard = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(withGuard.safe).toBe(true)
    const withoutGuard = checkRotaryFixtureCollision(segs, fixture, {
      ...opts,
      skipInitialUnknownX: false
    })
    expect(withoutGuard.safe).toBe(false)
  })

  it('still flags the endpoint of the establishing move if it lands in the chuck', () => {
    // The first X move goes (0,0,?) → (10, 0, 14.5): endpoint has X=10 (inside
    // chuck axial zone) and Z=14.5 (below chuck radius). Even with the initial-
    // approach guard, the endpoint sample should catch this.
    const segs = [
      seg('rapid', 0, 0, 0, 46), // pre-approach — skipped
      seg('rapid', 0, 46, 10, 14.5) // establishing move — endpoint inside chuck
    ]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.fixture).toBe('chuck')
  })

  it('treats all segments normally once X is established', () => {
    const segs = [
      seg('rapid', 0, 0, 30, 46), // establishing — endpoint safe
      seg('rapid', 30, 46, 5, 14.5), // post-establishing — samples interior → collision
      seg('feed', 5, 14.5, 5, 14.5) // also flagged; but only one event per segment
    ]
    const r = checkRotaryFixtureCollision(segs, fixture, opts)
    expect(r.safe).toBe(false)
    // At least the mid-segment rapid collision and the feed collision get reported.
    expect(r.collisions.length).toBeGreaterThanOrEqual(2)
  })
})

describe('formatRotaryCollisionWarnings', () => {
  it('returns an empty array when the result is safe', () => {
    expect(formatRotaryCollisionWarnings({ safe: true, collisions: [] })).toEqual([])
  })

  it('groups collisions by fixture and kind, reporting the worst clearance', () => {
    const result = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck' as const, x: 5, z: 14, kind: 'feed' as const, clearance: -27.5 },
        { segmentIndex: 1, fixture: 'chuck' as const, x: 8, z: 10, kind: 'feed' as const, clearance: -31.5 },
        { segmentIndex: 2, fixture: 'chuck' as const, x: 2, z: 20, kind: 'rapid' as const, clearance: -21.5 }
      ]
    }
    const msgs = formatRotaryCollisionWarnings(result)
    expect(msgs).toHaveLength(2) // chuck:feed and chuck:rapid grouped separately
    const feed = msgs.find((m) => m.includes('feed'))
    const rapid = msgs.find((m) => m.includes('rapid'))
    expect(feed).toBeDefined()
    expect(rapid).toBeDefined()
    // Feed is a collision (worst −31.5), rapid is a near-miss (worst −21.5).
    expect(feed).toMatch(/collision/)
    expect(feed).toMatch(/2 feed moves/)
    expect(feed).toMatch(/-31\.50 mm/)
    expect(rapid).toMatch(/near-miss/)
    expect(rapid).toMatch(/1 rapid move/)
  })

  it('reports chuck and tailstock events as separate warnings', () => {
    const result = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck' as const, x: 5, z: 14, kind: 'feed' as const, clearance: -25 },
        { segmentIndex: 5, fixture: 'tailstock' as const, x: 105, z: 14, kind: 'feed' as const, clearance: -12 }
      ]
    }
    const msgs = formatRotaryCollisionWarnings(result)
    expect(msgs).toHaveLength(2)
    expect(msgs.some((m) => m.includes('chuck'))).toBe(true)
    expect(msgs.some((m) => m.includes('tailstock'))).toBe(true)
  })
})
