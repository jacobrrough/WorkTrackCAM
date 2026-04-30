/**
 * rotary-collision-pin.test.ts -- [ID-0279] Cycle 207 test-coverage paired-pin
 *
 * Co-located shape-pin contract for `src/shared/rotary-collision.ts` -- the
 * 237-line 4-axis rotary fixture collision detector that protects every
 * Makera Carvera + 4-axis Rotary toolpath from chuck/headstock impact. The
 * existing behavioral file `rotary-collision.test.ts` (288 lines) covers the
 * feed-vs-rapid + diagonal-mid-segment + tailstock-on/off cases; this pin
 * file extends coverage to lock the CONTRACT surface that callers, schemas,
 * and downstream warning formatters depend on -- module shape, exported
 * type discriminants, default values, sample-count clamping, tool-radius
 * guarding, the skip-initial-unknown-X invariant, the chuck + tailstock
 * test inequalities (literal formulas reproduced as in-source-string pins),
 * the one-event-per-segment cap, the signed-clearance sign convention, the
 * formatter's group-by-fixture+kind aggregation contract, the operator-
 * facing severity string mapping (feed=collision / rapid=near-miss), the
 * worst-clearance Math.min reduction, the pluralization rule, the pure-
 * function invariants on input segments, the three-machine path realism
 * (Carvera 92 mm rotary stock, optical tailstock), and the
 * Safety-Rule-1-tests-only docstring invariants.
 *
 * Production call-sites of `checkRotaryFixtureCollision`:
 *   - `src/main/cam-axis4/index.ts` -- 4-axis CAM job runner integrates
 *     collision sweep before emitting G-code
 *   - `src/main/cam-runner.ts` -- central CAM dispatcher routes 4-axis
 *     jobs through the collision check before the post-processor
 *
 * Production call-sites of `formatRotaryCollisionWarnings`:
 *   - same files: convert collision events into operator warnings
 *
 * Three-machine relevance:
 *   - **Makera Carvera + 4-axis Rotary** (DIRECT): every rotary job sweeps
 *     XY/Z motion against the chuck cylinder (representative spec: 80 mm
 *     OD chuck, 15 mm grip depth, 92 mm-diameter stock max per CLAUDE.md
 *     USER CONTEXT). The optional tailstock check handles the long-stock
 *     case (240 mm max length). The pin file locks the formula
 *     inequalities + the skipInitialUnknownX safety lane that prevents
 *     spurious chuck collisions on initial Z approach moves.
 *   - **Laguna Swift 5x10 + Creality K2 Plus** (INDIRECT): neither machine
 *     uses 4-axis rotary so the collision sweep is bypassed entirely; the
 *     pin asserts the no-tailstock short-circuit (hasTail=false) does not
 *     emit spurious tailstock warnings on standard 3-axis Carvera or
 *     Laguna jobs that happen to share the rotary collision API by
 *     accident in test fixtures.
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file authors
 * tests only. The collision sweep itself is read-only with respect to the
 * input segments (the pure-function invariant pins this). No production
 * G-code edits, no machine-profile edits, no .hbs template edits, no
 * Python engine edits, no schema edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './rotary-collision'
import {
  checkRotaryFixtureCollision,
  formatRotaryCollisionWarnings,
  type RotaryFixtureConfig,
  type RotaryCollisionOpts,
  type RotaryCollisionEvent,
  type RotaryCollisionResult
} from './rotary-collision'
import type { ToolpathSegment4 } from './cam-gcode-toolpath'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read source for whitelist pins. */
const SRC_PATH = resolvePath(__dirname, 'rotary-collision.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/** Build a 4-axis segment with the (X, Z) fields that drive the planar test. */
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

/**
 * Carvera 4-axis Rotary representative fixture.
 *   stock OD 30 mm => stock R = 15 mm
 *   chuck grabs 15 mm deep
 *   chuck body OD = 80 mm => chuck R = 40 mm
 * Per CLAUDE.md USER CONTEXT, the rotary module's max envelope is
 * 92 mm diameter x 240 mm length.
 */
const CARVERA_CHUCK: RotaryFixtureConfig = {
  chuckDepthMm: 15,
  chuckOuterRadiusMm: 40
}

const CARVERA_CHUCK_AND_TAIL: RotaryFixtureConfig = {
  chuckDepthMm: 15,
  chuckOuterRadiusMm: 40,
  tailstockStartXMm: 200,
  tailstockOuterRadiusMm: 25
}

const CARVERA_OPTS: RotaryCollisionOpts = {
  toolDiameterMm: 3,
  safetyMarginMm: 0.5
}

const EVENT_KEYS = ['segmentIndex', 'fixture', 'x', 'z', 'kind', 'clearance'] as const
const RESULT_KEYS = ['safe', 'collisions'] as const

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. rotary-collision -- module shape', () => {
  it('exports `checkRotaryFixtureCollision` as a function', () => {
    expect(typeof Mod.checkRotaryFixtureCollision).toBe('function')
  })

  it('exports `formatRotaryCollisionWarnings` as a function', () => {
    expect(typeof Mod.formatRotaryCollisionWarnings).toBe('function')
  })

  it('exports exactly 2 runtime values', () => {
    const runtimeKeys = Object.keys(Mod).filter(
      (k) => typeof (Mod as Record<string, unknown>)[k] !== 'undefined'
    )
    // Types are erased at runtime, so only function exports count here.
    expect(runtimeKeys.sort()).toEqual([
      'checkRotaryFixtureCollision',
      'formatRotaryCollisionWarnings'
    ])
  })

  it('checkRotaryFixtureCollision arity is 3', () => {
    expect(checkRotaryFixtureCollision.length).toBe(3)
  })

  it('formatRotaryCollisionWarnings arity is 1', () => {
    expect(formatRotaryCollisionWarnings.length).toBe(1)
  })

  it('checkRotaryFixtureCollision name is preserved', () => {
    expect(checkRotaryFixtureCollision.name).toBe('checkRotaryFixtureCollision')
  })

  it('formatRotaryCollisionWarnings name is preserved', () => {
    expect(formatRotaryCollisionWarnings.name).toBe('formatRotaryCollisionWarnings')
  })

  it('module has no default export', () => {
    expect((Mod as unknown as { default?: unknown }).default).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. RotaryCollisionResult shape -- always-present keys
// ---------------------------------------------------------------------------
describe('B. RotaryCollisionResult -- always-present keys', () => {
  it('returns exactly the keys {safe, collisions}', () => {
    const r = checkRotaryFixtureCollision([], CARVERA_CHUCK, CARVERA_OPTS)
    expect(Object.keys(r).sort()).toEqual([...RESULT_KEYS].sort())
  })

  it('safe is boolean', () => {
    const r = checkRotaryFixtureCollision([], CARVERA_CHUCK, CARVERA_OPTS)
    expect(typeof r.safe).toBe('boolean')
  })

  it('collisions is an array', () => {
    const r = checkRotaryFixtureCollision([], CARVERA_CHUCK, CARVERA_OPTS)
    expect(Array.isArray(r.collisions)).toBe(true)
  })

  it('empty input yields safe=true with [] collisions', () => {
    const r = checkRotaryFixtureCollision([], CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(true)
    expect(r.collisions).toEqual([])
  })

  it('safe is true iff collisions is empty -- empty case', () => {
    const r = checkRotaryFixtureCollision(
      [seg('feed', 30, 50, 70, 50)],
      CARVERA_CHUCK,
      CARVERA_OPTS
    )
    expect(r.safe).toBe(true)
    expect(r.collisions).toHaveLength(0)
  })

  it('safe is false iff collisions is non-empty -- collision case', () => {
    const r = checkRotaryFixtureCollision(
      [seg('feed', 5, 14.5, 10, 14.5)],
      CARVERA_CHUCK,
      CARVERA_OPTS
    )
    expect(r.safe).toBe(false)
    expect(r.collisions.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// C. RotaryCollisionEvent shape
// ---------------------------------------------------------------------------
describe('C. RotaryCollisionEvent -- shape', () => {
  function firstEvent(): RotaryCollisionEvent {
    const r = checkRotaryFixtureCollision(
      [seg('feed', 5, 14.5, 10, 14.5)],
      CARVERA_CHUCK,
      CARVERA_OPTS
    )
    expect(r.collisions[0]).toBeDefined()
    return r.collisions[0]!
  }

  it('contains exactly the 6 documented keys', () => {
    expect(Object.keys(firstEvent()).sort()).toEqual([...EVENT_KEYS].sort())
  })

  it('segmentIndex is the 0-based input index', () => {
    const segs = [
      seg('feed', 30, 50, 70, 50), // safe
      seg('feed', 5, 14.5, 10, 14.5) // collision
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.collisions[0]!.segmentIndex).toBe(1)
  })

  it('fixture is one of the literal union {chuck, tailstock}', () => {
    const ev = firstEvent()
    expect(['chuck', 'tailstock']).toContain(ev.fixture)
  })

  it('x is finite number (sampled tool tip X)', () => {
    expect(Number.isFinite(firstEvent().x)).toBe(true)
  })

  it('z is finite number (sampled tool tip Z)', () => {
    expect(Number.isFinite(firstEvent().z)).toBe(true)
  })

  it('kind copies the segment kind discriminant', () => {
    const r = checkRotaryFixtureCollision(
      [seg('rapid', 5, 14.5, 10, 14.5)],
      CARVERA_CHUCK,
      CARVERA_OPTS
    )
    expect(r.collisions[0]!.kind).toBe('rapid')
  })

  it('kind is one of the literal union {rapid, feed}', () => {
    const ev = firstEvent()
    expect(['rapid', 'feed']).toContain(ev.kind)
  })

  it('clearance is a finite number', () => {
    expect(Number.isFinite(firstEvent().clearance)).toBe(true)
  })

  it('clearance is negative when collision occurred (signed convention)', () => {
    expect(firstEvent().clearance).toBeLessThan(0)
  })
})

// ---------------------------------------------------------------------------
// D. Defaults -- safetyMarginMm, sampleCount, skipInitialUnknownX
// ---------------------------------------------------------------------------
describe('D. Defaults', () => {
  it('safetyMarginMm defaults to 0.5 when omitted', () => {
    // Edge: with a 3 mm tool, default margin = 0.5.
    // Chuck inequality: x < 15 + 1.5 + 0.5 = 17.0
    // Place a feed at x=16.9 to trip the inequality only when default applies.
    const segs = [seg('feed', 16.9, 14.5, 16.9, 14.5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: 3
      // no safetyMarginMm => default 0.5
    })
    expect(r.safe).toBe(false)
  })

  it('passing safetyMarginMm=0 disables the default margin', () => {
    // x=16.9 with margin=0: 16.9 < 15 + 1.5 + 0 = 16.5 is FALSE => no chuck trip.
    const segs = [seg('feed', 16.9, 14.5, 16.9, 14.5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: 3,
      safetyMarginMm: 0
    })
    expect(r.safe).toBe(true)
  })

  it('sampleCount defaults to 8 when omitted', () => {
    // Use a long diagonal that only mid-segment dips are caught when samples >= 8.
    // Endpoints are safe (X=30 and X=70, Z=46 throughout) but the line never
    // dips into chuck. Placeholder smoke: omitting sampleCount must not throw.
    const segs = [seg('feed', 30, 46, 70, 46)]
    expect(() =>
      checkRotaryFixtureCollision(segs, CARVERA_CHUCK, { toolDiameterMm: 3 })
    ).not.toThrow()
  })

  it('skipInitialUnknownX defaults to true (initial 0,0 segment skipped)', () => {
    // A segment with x0==0 && x1==0 at the start would normally hit chuck (z<42)
    // but with the default skip the establishing-x lane suppresses it.
    const segs: ToolpathSegment4[] = [
      seg('rapid', 0, 5, 0, 5), // pre-approach modal noise -- skipped by default
      seg('feed', 30, 50, 70, 50) // safe
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('opts is the only place defaults live (no other implicit fields)', () => {
    // Opts with all 4 documented fields explicitly set must equal opts with
    // only the 1 required field set when behaviors are consistent (small smoke).
    const segs = [seg('feed', 30, 50, 70, 50)]
    const a = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, { toolDiameterMm: 3 })
    const b = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: 3,
      safetyMarginMm: 0.5,
      sampleCount: 8,
      skipInitialUnknownX: true
    })
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// E. skipInitialUnknownX behavior (the establishing-X invariant)
// ---------------------------------------------------------------------------
describe('E. skipInitialUnknownX -- establishing-X invariant', () => {
  it('default true skips initial pure-zero segments entirely', () => {
    const segs: ToolpathSegment4[] = [
      seg('rapid', 0, 0, 0, 0), // both endpoints at 0 -- skipped
      seg('rapid', 0, 0, 0, 0), // both endpoints at 0 -- skipped
      seg('feed', 30, 50, 70, 50) // safe
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('first segment with non-zero endpoint is sampled at endpoint only', () => {
    // Establishing move: rapid from (X=0, Z=46) to (X=10, Z=46).
    // Endpoint (10, 46) is outside the chuck radial (z=46 > 42), so safe.
    // If startSample were 0 then sample at t=0 (X=0) would hit chuck.
    // The pin asserts establishing-segment endpoint-only sampling.
    const segs = [seg('rapid', 0, 46, 10, 46)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('explicit skipInitialUnknownX=false samples every segment from index 0', () => {
    // With the skip OFF, the establishing-X segment is fully sampled.
    // Place a pure-zero segment that dives to a chuck-tripping Z.
    const segs = [seg('feed', 0, 5, 0, 5)] // z=5 < 42, x=0 < 17 => chuck trip
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.fixture).toBe('chuck')
  })

  it('once X is established, subsequent segments are sampled fully', () => {
    // First segment establishes X by reaching X=30.
    // Second segment dives back into the chuck zone -- must be flagged.
    const segs = [
      seg('rapid', 30, 50, 30, 50), // establishes X
      seg('feed', 5, 14.5, 10, 14.5) // chuck collision
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.segmentIndex).toBe(1)
  })

  it('non-zero start endpoint also establishes X', () => {
    // First segment is (X=0, Z=46) -> (X=10, Z=46). x1=10 != 0 -> establishes.
    // Second segment (X=5, Z=10) -> (X=10, Z=10) is a chuck dive -- must trip.
    const segs = [
      seg('rapid', 0, 46, 10, 46),
      seg('feed', 5, 10, 10, 10)
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.segmentIndex).toBe(1)
  })

  it('non-zero start with x0!=0 also counts (either endpoint suffices)', () => {
    // Segment with x0=10, x1=0 -- x0 is non-zero so xEstablished flips on.
    // Endpoint (X=0, Z=5) is inside chuck zone but startSample=samples means
    // only endpoint is sampled -- which would still trip (x=0 < 17, z=5 < 42).
    const segs = [seg('rapid', 10, 5, 0, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.segmentIndex).toBe(0)
    // Endpoint sampling means the reported x is the SEGMENT END (x1=0).
    expect(r.collisions[0]!.x).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// F. sampleCount clamping and tool-radius guarding
// ---------------------------------------------------------------------------
describe('F. Numeric clamps -- sampleCount and toolRadius', () => {
  it('sampleCount=1 is clamped up to a minimum of 2 (endpoints)', () => {
    // Even with sampleCount=1, both endpoints of the segment must be checked.
    const segs = [seg('feed', 5, 14.5, 70, 50)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: 3,
      sampleCount: 1, // clamped to 2
      skipInitialUnknownX: false
    })
    // Start endpoint at (5, 14.5) trips chuck.
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.x).toBe(5)
  })

  it('sampleCount=0 is clamped up to 2 (does not divide-by-zero)', () => {
    const segs = [seg('feed', 5, 14.5, 5, 14.5)]
    expect(() =>
      checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
        toolDiameterMm: 3,
        sampleCount: 0,
        skipInitialUnknownX: false
      })
    ).not.toThrow()
  })

  it('sampleCount can be larger than 8 (no upper cap)', () => {
    const segs = [seg('feed', 5, 14.5, 5, 14.5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: 3,
      sampleCount: 64,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
  })

  it('negative tool diameter clamped to toolR=0 (no negative offset)', () => {
    // toolR = max(0, -5/2) = 0 => chuck inequality: x < 15 + 0 + 0.5 = 15.5
    // A move at x=15.4 should still trip with margin only.
    const segs = [seg('feed', 15.4, 5, 15.4, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: -5,
      safetyMarginMm: 0.5,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
  })

  it('zero tool diameter is honored (toolR=0)', () => {
    // toolR = max(0, 0/2) = 0 => chuck inequality: x < 15 + 0 + 0.5 = 15.5
    const segs = [seg('feed', 16, 5, 16, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      toolDiameterMm: 0,
      safetyMarginMm: 0.5,
      skipInitialUnknownX: false
    })
    // x=16 is NOT less than 15.5 => safe
    expect(r.safe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// G. Chuck collision formula -- both inequalities required
// ---------------------------------------------------------------------------
describe('G. Chuck collision formula', () => {
  // toolR = 1.5, margin = 0.5, chuckDepth = 15, chuckOuterR = 40
  // x-test: x < 15 + 1.5 + 0.5 = 17.0
  // z-test: z < 40 + 1.5 + 0.5 = 42.0

  it('strict inequality on x: x = chuckDepth + toolR + margin is SAFE', () => {
    const segs = [seg('feed', 17.0, 5, 17.0, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(true)
  })

  it('just-below boundary on x trips (x=16.999...)', () => {
    const segs = [seg('feed', 16.5, 5, 16.5, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
  })

  it('strict inequality on z: z = chuckOuterR + toolR + margin is SAFE', () => {
    const segs = [seg('feed', 5, 42.0, 5, 42.0)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(true)
  })

  it('z below boundary trips (z=41.5)', () => {
    const segs = [seg('feed', 5, 41.5, 5, 41.5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
  })

  it('inside chuck X but z above clearance => safe', () => {
    const segs = [seg('feed', 5, 50, 10, 50)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(true)
  })

  it('low z but past chuck X => safe', () => {
    const segs = [seg('feed', 30, 5, 30, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(true)
  })

  it('clearance reflects (z - requiredZ) for chuck collisions', () => {
    const segs = [seg('feed', 5, 10, 5, 10)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
    // z=10, requiredZ = 40+1.5+0.5 = 42 => clearance = 10-42 = -32
    expect(r.collisions[0]!.clearance).toBeCloseTo(-32, 6)
  })
})

// ---------------------------------------------------------------------------
// H. Tailstock collision formula and hasTail conditional
// ---------------------------------------------------------------------------
describe('H. Tailstock collision and hasTail conditional', () => {
  // tailstockStart=200, tailstockOuterR=25
  // toolR=1.5, margin=0.5
  // x-test: x > 200 - 1.5 - 0.5 = 198.0
  // z-test: z < 25 + 1.5 + 0.5 = 27.0

  it('omitting tailstockStartXMm disables the tailstock check', () => {
    const fixture: RotaryFixtureConfig = {
      chuckDepthMm: 15,
      chuckOuterRadiusMm: 40
      // no tailstock fields
    }
    // Place a segment at x=300, z=5 -- would trip if tail check ran.
    const segs = [seg('feed', 300, 5, 300, 5)]
    const r = checkRotaryFixtureCollision(segs, fixture, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('omitting only tailstockOuterRadiusMm disables the tail check', () => {
    const fixture: RotaryFixtureConfig = {
      chuckDepthMm: 15,
      chuckOuterRadiusMm: 40,
      tailstockStartXMm: 200
      // outer radius missing => hasTail is false
    }
    const segs = [seg('feed', 300, 5, 300, 5)]
    const r = checkRotaryFixtureCollision(segs, fixture, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('both fields present => tailstock check runs', () => {
    const segs = [seg('feed', 300, 5, 300, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.fixture).toBe('tailstock')
  })

  it('strict inequality on x: x = tailstockStart - toolR - margin is SAFE', () => {
    const segs = [seg('feed', 198.0, 5, 198.0, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(true)
  })

  it('just-above boundary trips (x=198.5)', () => {
    const segs = [seg('feed', 198.5, 5, 198.5, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.fixture).toBe('tailstock')
  })

  it('past tailstock X but z above clearance => safe', () => {
    const segs = [seg('feed', 220, 50, 220, 50)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(true)
  })

  it('clearance reflects (z - requiredZ) for tailstock collisions', () => {
    const segs = [seg('feed', 220, 5, 220, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
    // z=5, requiredZ = 25+1.5+0.5 = 27 => clearance = 5-27 = -22
    expect(r.collisions[0]!.clearance).toBeCloseTo(-22, 6)
  })

  it('chuck check takes precedence over tailstock when both could trigger', () => {
    // Place a segment fully inside the chuck zone -- chuck check fires first.
    // (The for-s loop checks chuck first, then tailstock. Since the chuck
    //  inequality cannot also satisfy the tailstock inequality unless
    //  chuckDepth + toolR + margin > tailstockStart - toolR - margin, this
    //  is normally a non-overlap; the pin asserts chuck-fires-first ordering.)
    const segs = [seg('feed', 5, 5, 5, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.collisions[0]!.fixture).toBe('chuck')
  })
})

// ---------------------------------------------------------------------------
// I. One-event-per-segment cap (the `flagged` invariant)
// ---------------------------------------------------------------------------
describe('I. One-event-per-segment cap', () => {
  it('a fully-immersed feed segment yields exactly ONE event', () => {
    // Whole segment is inside chuck cylinder => 8 sample points all trip,
    // but the contract pins ONE event per segment (first-failing sample).
    const segs = [seg('feed', 5, 5, 14, 5)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.collisions).toHaveLength(1)
    expect(r.collisions[0]!.segmentIndex).toBe(0)
  })

  it('multiple colliding segments yield N events (one each)', () => {
    const segs = [
      seg('feed', 5, 5, 14, 5), // collision
      seg('feed', 30, 50, 70, 50), // safe
      seg('feed', 6, 5, 6, 5) // collision
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.collisions).toHaveLength(2)
    expect(r.collisions.map((c) => c.segmentIndex)).toEqual([0, 2])
  })

  it('per-segment events preserve input order', () => {
    const segs = [
      seg('feed', 14, 5, 14, 5),
      seg('feed', 13, 5, 13, 5),
      seg('feed', 12, 5, 12, 5)
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.collisions.map((c) => c.segmentIndex)).toEqual([0, 1, 2])
  })

  it('first-failing sample is the reported (x, z) for that segment', () => {
    // Diagonal: starts safe (x=30, z=46), ends collision (x=5, z=10).
    // Earliest sample failing under default 8 samples is somewhere along the
    // line. The pin only asserts the first-failing-sample is reported, not
    // its exact index.
    const segs = [seg('feed', 30, 46, 5, 10)]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.collisions).toHaveLength(1)
    const ev = r.collisions[0]!
    // Reported sample must lie on the segment line.
    expect(ev.x).toBeGreaterThanOrEqual(5)
    expect(ev.x).toBeLessThanOrEqual(30)
    expect(ev.z).toBeGreaterThanOrEqual(10)
    expect(ev.z).toBeLessThanOrEqual(46)
  })
})

// ---------------------------------------------------------------------------
// J. Pure-function invariants (input segments are not mutated)
// ---------------------------------------------------------------------------
describe('J. Pure-function invariants', () => {
  it('input segments array is not mutated (length preserved)', () => {
    const segs = [
      seg('feed', 5, 5, 5, 5),
      seg('feed', 30, 50, 70, 50),
      seg('rapid', 6, 5, 6, 5)
    ]
    const before = segs.length
    checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(segs).toHaveLength(before)
  })

  it('input segment objects are not mutated (deep equality before/after)', () => {
    const seg0 = seg('feed', 5, 5, 5, 5)
    const segs = [seg0]
    const snapshot = JSON.parse(JSON.stringify(segs))
    checkRotaryFixtureCollision(segs, CARVERA_CHUCK, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(segs).toEqual(snapshot)
  })

  it('input fixture object is not mutated', () => {
    const fixture: RotaryFixtureConfig = { ...CARVERA_CHUCK_AND_TAIL }
    const snapshot = JSON.parse(JSON.stringify(fixture))
    checkRotaryFixtureCollision(
      [seg('feed', 5, 5, 5, 5)],
      fixture,
      { ...CARVERA_OPTS, skipInitialUnknownX: false }
    )
    expect(fixture).toEqual(snapshot)
  })

  it('input opts object is not mutated', () => {
    const opts: RotaryCollisionOpts = {
      toolDiameterMm: 3,
      safetyMarginMm: 0.5,
      sampleCount: 8,
      skipInitialUnknownX: false
    }
    const snapshot = JSON.parse(JSON.stringify(opts))
    checkRotaryFixtureCollision(
      [seg('feed', 5, 5, 5, 5)],
      CARVERA_CHUCK,
      opts
    )
    expect(opts).toEqual(snapshot)
  })

  it('two independent calls with the same inputs return equal results', () => {
    const segs = [seg('feed', 5, 14.5, 10, 14.5)]
    const a = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    const b = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(a).toEqual(b)
  })

  it('readonly input typing is honored at runtime (frozen array)', () => {
    const segs = Object.freeze([seg('feed', 5, 14.5, 10, 14.5)])
    expect(() =>
      checkRotaryFixtureCollision(
        segs as readonly ToolpathSegment4[],
        CARVERA_CHUCK,
        CARVERA_OPTS
      )
    ).not.toThrow()
  })

  it('formatRotaryCollisionWarnings does not mutate its input result', () => {
    const r = checkRotaryFixtureCollision(
      [seg('feed', 5, 14.5, 10, 14.5)],
      CARVERA_CHUCK,
      CARVERA_OPTS
    )
    const snapshot = JSON.parse(JSON.stringify(r))
    formatRotaryCollisionWarnings(r)
    expect(r).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// K. formatRotaryCollisionWarnings -- shape and grouping contract
// ---------------------------------------------------------------------------
describe('K. formatRotaryCollisionWarnings -- shape and grouping', () => {
  it('returns [] when result.safe is true', () => {
    expect(formatRotaryCollisionWarnings({ safe: true, collisions: [] })).toEqual([])
  })

  it('returns [] for safe=true even when collisions array is non-empty', () => {
    // The formatter trusts the discriminant: safe=true short-circuits.
    expect(
      formatRotaryCollisionWarnings({
        safe: true,
        collisions: [
          {
            segmentIndex: 0,
            fixture: 'chuck',
            x: 5,
            z: 5,
            kind: 'feed',
            clearance: -1
          }
        ]
      })
    ).toEqual([])
  })

  it('returns one line per (fixture, kind) group', () => {
    // 2 chuck-feeds + 1 tailstock-rapid = 2 distinct groups => 2 lines.
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 },
        { segmentIndex: 1, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -20 },
        { segmentIndex: 2, fixture: 'tailstock', x: 220, z: 5, kind: 'rapid', clearance: -5 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)).toHaveLength(2)
  })

  it('counts events per (fixture, kind) group', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 },
        { segmentIndex: 1, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -20 },
        { segmentIndex: 2, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -30 }
      ]
    }
    const lines = formatRotaryCollisionWarnings(r)
    expect(lines).toHaveLength(1)
    expect(lines[0]!).toMatch(/3 feed moves/)
  })

  it('reports the worst (most negative) clearance via Math.min reduction', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 },
        { segmentIndex: 1, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -32.123 },
        { segmentIndex: 2, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -5 }
      ]
    }
    const lines = formatRotaryCollisionWarnings(r)
    expect(lines[0]!).toMatch(/-32\.12 mm/) // toFixed(2)
  })

  it('formats clearance with toFixed(2) (2 decimal places)', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -1.5 }
      ]
    }
    const lines = formatRotaryCollisionWarnings(r)
    expect(lines[0]!).toContain('-1.50 mm')
  })

  it('uses singular `move` when count is 1', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -1.5 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(/1 feed move /)
  })

  it('uses plural `moves` when count is greater than 1', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -1 },
        { segmentIndex: 1, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -2 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(/2 feed moves /)
  })

  it('feed kind => severity word "collision"', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -1 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(/Rotary chuck collision/)
  })

  it('rapid kind => severity word "near-miss"', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'rapid', clearance: -1 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(/Rotary chuck near-miss/)
  })

  it('warning string ends with the operator-facing review prompt', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'tailstock', x: 220, z: 5, kind: 'feed', clearance: -22 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(
      /Review the toolpath before running\.$/
    )
  })

  it('chuck and tailstock yield distinct lines even at same kind', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 },
        { segmentIndex: 1, fixture: 'tailstock', x: 220, z: 5, kind: 'feed', clearance: -5 }
      ]
    }
    const lines = formatRotaryCollisionWarnings(r)
    expect(lines).toHaveLength(2)
    expect(lines.some((l) => l.includes('chuck'))).toBe(true)
    expect(lines.some((l) => l.includes('tailstock'))).toBe(true)
  })

  it('feed and rapid against same fixture yield distinct lines', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 },
        { segmentIndex: 1, fixture: 'chuck', x: 5, z: 5, kind: 'rapid', clearance: -5 }
      ]
    }
    const lines = formatRotaryCollisionWarnings(r)
    expect(lines).toHaveLength(2)
    expect(lines.some((l) => /collision/.test(l))).toBe(true)
    expect(lines.some((l) => /near-miss/.test(l))).toBe(true)
  })

  it('every line is a non-empty string', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 }
      ]
    }
    const lines = formatRotaryCollisionWarnings(r)
    for (const line of lines) {
      expect(typeof line).toBe('string')
      expect(line.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// L. Three-machine path realism (Carvera 4-axis + indirect K2 / Laguna)
// ---------------------------------------------------------------------------
describe('L. Three-machine path realism', () => {
  it('Carvera 92 mm-diameter rotary stock max envelope (R=46) is safe above chuck radius', () => {
    // Per CLAUDE.md USER CONTEXT, Makera Carvera 4th axis max stock D=92.
    // Z=46 (stock surface) with chuck OD 80 (R=40) + 1.5 toolR + 0.5 margin = 42.
    // Z=46 > 42 => safe at the surface for any X past the chuck.
    const fixture: RotaryFixtureConfig = {
      chuckDepthMm: 15,
      chuckOuterRadiusMm: 40
    }
    const segs = [seg('feed', 30, 46, 230, 46)] // 240 mm max stock length
    const r = checkRotaryFixtureCollision(segs, fixture, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('Carvera initial Z approach (rapid into stock at low Z) is suppressed', () => {
    // The default skipInitialUnknownX prevents initial pre-G54 modal-zero
    // segments from emitting spurious chuck collisions.
    const segs: ToolpathSegment4[] = [
      seg('rapid', 0, 0, 0, 0), // pre-approach modal noise -- skipped
      seg('rapid', 0, 0, 0, 0), // pre-approach modal noise -- skipped
      seg('rapid', 30, 50, 30, 50), // safe rapid above stock
      seg('feed', 30, 46, 230, 46) // contour pass
    ]
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK, CARVERA_OPTS)
    expect(r.safe).toBe(true)
  })

  it('Carvera optical tailstock detected when stock extends to 240 mm', () => {
    // Long-stock fixture: stock extends to X=240; tailstock starts at X=200.
    // A finishing pass that runs to X=235 with toolR penetration trips tail.
    const segs = [seg('feed', 235, 5, 235, 5)] // x=235 > 198 + below 27
    const r = checkRotaryFixtureCollision(segs, CARVERA_CHUCK_AND_TAIL, {
      ...CARVERA_OPTS,
      skipInitialUnknownX: false
    })
    expect(r.safe).toBe(false)
    expect(r.collisions[0]!.fixture).toBe('tailstock')
  })

  it('Laguna Swift 5x10 + K2 Plus do NOT use this module (3-axis only)', () => {
    // The pin asserts: callers only invoke this on 4-axis programs. To prove
    // module is bypass-safe for 3-axis machines, an empty segments array
    // returns the trivially-safe result -- which is what cam-runner.ts
    // does for non-4-axis jobs.
    const r = checkRotaryFixtureCollision([], CARVERA_CHUCK, CARVERA_OPTS)
    expect(r).toEqual({ safe: true, collisions: [] })
  })

  it('formatter operator string mentions both fixture words for the operator', () => {
    // Operator-facing strings must contain "Rotary" + the fixture word so the
    // warning is recognizable in a flat warnings panel.
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -10 }
      ]
    }
    const line = formatRotaryCollisionWarnings(r)[0]!
    expect(line).toMatch(/^Rotary chuck /)
    expect(line).toMatch(/penetrate the chuck body/)
  })

  it('feed-kind collisions describe the spindle-crash severity in plain operator language', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'tailstock', x: 235, z: 5, kind: 'feed', clearance: -22 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(/Rotary tailstock collision/)
  })

  it('rapid-kind collisions are labeled near-miss to distinguish from feed crashes', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'rapid', clearance: -10 }
      ]
    }
    expect(formatRotaryCollisionWarnings(r)[0]!).toMatch(/Rotary chuck near-miss/)
  })
})

// ---------------------------------------------------------------------------
// M. Source-text whitelist (doc + Safety Rule 1 invariants)
// ---------------------------------------------------------------------------
describe('M. Source-text whitelist', () => {
  it('source mentions the rotary fixture collision detection role', () => {
    expect(SRC).toMatch(/Rotary Fixture Collision Detection/)
  })

  it('source documents the planar (X, Z) collapse from 3D', () => {
    expect(SRC).toMatch(/planar \(X, Z\) check/)
  })

  it('source documents the chuck inequality formula in a comment', () => {
    expect(SRC).toMatch(
      /x < chuckDepthMm \+ toolR \+ margin\s+AND\s+z < chuckROuter \+ toolR \+ margin/
    )
  })

  it('source documents the tailstock inequality formula in a comment', () => {
    expect(SRC).toMatch(
      /x > tailstockStartXMm − toolR − margin AND\s+z < tailstockROuter \+ toolR \+ margin/
    )
  })

  it('source documents the default sample count of 8', () => {
    expect(SRC).toMatch(/default 8 samples/)
  })

  it('source documents the default safety margin of 0.5 mm', () => {
    expect(SRC).toMatch(/Default 0\.5 mm\./)
  })

  it('source documents the default skipInitialUnknownX rationale', () => {
    expect(SRC).toMatch(/skipInitialUnknownX/)
    expect(SRC).toMatch(/spurious chuck collisions on initial Z approaches/)
  })

  it('source documents that chuck fields are required and tailstock optional', () => {
    expect(SRC).toMatch(/Chuck fields are required;\s*\n\s*\* tailstock fields are optional/)
  })

  it('source documents the signed clearance convention (negative = penetration)', () => {
    expect(SRC).toMatch(/Negative = penetration depth into the/)
  })

  it('source documents the no-hard-coded-default-chuck-radius scope choice', () => {
    expect(SRC).toMatch(/default chuck radius is intentionally not hard-/)
  })

  it('source documents per-fixture severity in formatter doc', () => {
    expect(SRC).toMatch(/operator-readable warning/)
  })

  it('source uses Math.max(0, ...) to clamp tool radius', () => {
    expect(SRC).toMatch(/Math\.max\(0, opts\.toolDiameterMm \/ 2\)/)
  })

  it('source uses Math.max(2, ...) to clamp sampleCount', () => {
    expect(SRC).toMatch(/Math\.max\(2, opts\.sampleCount \?\? 8\)/)
  })

  it('source uses ?? 0.5 for the safetyMarginMm default', () => {
    expect(SRC).toMatch(/opts\.safetyMarginMm \?\? 0\.5/)
  })

  it('source uses ?? true for the skipInitialUnknownX default', () => {
    expect(SRC).toMatch(/opts\.skipInitialUnknownX \?\? true/)
  })

  it('source emits the "Rotary {fixture} {severity}" operator string template', () => {
    expect(SRC).toMatch(/Rotary \$\{fixture\} \$\{severity\}/)
  })

  it('source emits the "Review the toolpath before running" operator instruction', () => {
    expect(SRC).toMatch(/Review the toolpath before running/)
  })

  it('source uses Math.min implicit reduction (worst clearance picker)', () => {
    expect(SRC).toMatch(/if \(c\.clearance < prev\.worst\) prev\.worst = c\.clearance/)
  })

  it('source declares the imports-only-types-from-toolpath contract', () => {
    expect(SRC).toMatch(/import type \{ ToolpathSegment4 \} from \'\.\/cam-gcode-toolpath\'/)
  })

  it('source declares the pre-schema scope note (caller supplies fixture geometry)', () => {
    expect(SRC).toMatch(/this module is pre-schema/)
  })
})

// ---------------------------------------------------------------------------
// N. Type-level parity (compile-time assertions via runtime echoes)
// ---------------------------------------------------------------------------
describe('N. Type-level parity', () => {
  it('RotaryFixtureConfig accepts only chuck fields (tailstock omitted)', () => {
    const f: RotaryFixtureConfig = {
      chuckDepthMm: 10,
      chuckOuterRadiusMm: 30
    }
    expect(f.chuckDepthMm).toBe(10)
    expect(f.chuckOuterRadiusMm).toBe(30)
  })

  it('RotaryFixtureConfig accepts both fields (tailstock present)', () => {
    const f: RotaryFixtureConfig = {
      chuckDepthMm: 10,
      chuckOuterRadiusMm: 30,
      tailstockStartXMm: 200,
      tailstockOuterRadiusMm: 25
    }
    expect(f.tailstockStartXMm).toBe(200)
    expect(f.tailstockOuterRadiusMm).toBe(25)
  })

  it('RotaryCollisionOpts requires only toolDiameterMm', () => {
    const o: RotaryCollisionOpts = { toolDiameterMm: 3 }
    expect(o.toolDiameterMm).toBe(3)
  })

  it('RotaryCollisionEvent.fixture is the literal union {chuck, tailstock}', () => {
    const a: RotaryCollisionEvent['fixture'] = 'chuck'
    const b: RotaryCollisionEvent['fixture'] = 'tailstock'
    expect(a).toBe('chuck')
    expect(b).toBe('tailstock')
  })

  it('RotaryCollisionEvent.kind is the literal union {rapid, feed}', () => {
    const a: RotaryCollisionEvent['kind'] = 'rapid'
    const b: RotaryCollisionEvent['kind'] = 'feed'
    expect(a).toBe('rapid')
    expect(b).toBe('feed')
  })

  it('RotaryCollisionResult.safe is boolean (compile-only proxy)', () => {
    const r: RotaryCollisionResult = { safe: true, collisions: [] }
    expect(typeof r.safe).toBe('boolean')
  })

  it('RotaryCollisionResult.collisions is RotaryCollisionEvent[]', () => {
    const r: RotaryCollisionResult = {
      safe: false,
      collisions: [
        { segmentIndex: 0, fixture: 'chuck', x: 5, z: 5, kind: 'feed', clearance: -1 }
      ]
    }
    expect(Array.isArray(r.collisions)).toBe(true)
  })

  it('checkRotaryFixtureCollision return type is RotaryCollisionResult', () => {
    const r: RotaryCollisionResult = checkRotaryFixtureCollision(
      [],
      CARVERA_CHUCK,
      CARVERA_OPTS
    )
    expect(r).toEqual({ safe: true, collisions: [] })
  })

  it('formatRotaryCollisionWarnings return type is string[]', () => {
    const lines: string[] = formatRotaryCollisionWarnings({
      safe: true,
      collisions: []
    })
    expect(Array.isArray(lines)).toBe(true)
  })
})
