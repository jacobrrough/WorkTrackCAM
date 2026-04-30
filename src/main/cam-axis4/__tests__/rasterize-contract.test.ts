/**
 * Paired-pin contract set for `src/main/cam-axis4/rasterize.ts` -- pins
 * both the doc-string contract and the runtime behavior of the cam-axis4
 * rasterization helpers used by every 4-axis strategy on the Makera
 * Carvera + 4th Axis Rotary (the only 4-axis target in CLAUDE.md "USER
 * CONTEXT -- TARGET MACHINES"):
 *
 *   - `computePerAngleXExtents` (per-angle X cells with material; overcut
 *     padding; gap-fill across discontinuities; wraparound).
 *   - `computeAngularCurvature` (per-angle abs second derivative of radius;
 *     adaptive-refinement signal).
 *   - `buildAdaptiveAngles` (refined pass list; midpoint passes added in
 *     high-curvature regions up to a budget; sorted ascending).
 *   - `sampleHeightmapAtAngle` (linear interpolation between two grid
 *     angles; NO_HIT propagation; wraparound at last angle).
 *   - `surfaceStepoverDegFromMm` (arc-length to degrees; clamped to
 *     [0.1 deg, 180 deg]; epsilon protection on degenerate inputs).
 *
 * Roadmap: [ID-0172] (test-coverage, Cycle 84). Pure helper-level unit
 * tests: NO machine profile, NO mesh raycast, NO post-template
 * invocation, NO production-code edits this cycle. Fixtures are direct
 * `CylindricalHeightmap` / `Float32Array` literals so the rasterization
 * algorithms are the only thing under test.
 *
 * Cross-cuts:
 *   - Makera Carvera + 4th Axis Rotary (PRIMARY) -- every cam-axis4
 *     strategy threads through these helpers when generating per-angle
 *     toolpath envelopes and adaptive pass lists.
 *   - Creality K2 Plus, Laguna Swift 5x10 -- UNAFFECTED (3-axis paths
 *     do not touch this module).
 */
import { describe, expect, it } from 'vitest'
import {
  buildAdaptiveAngles,
  computeAngularCurvature,
  computePerAngleXExtents,
  sampleHeightmapAtAngle,
  surfaceStepoverDegFromMm
} from '../rasterize'
import { NO_HIT, type CylindricalHeightmap } from '../heightmap'

/**
 * Build a CylindricalHeightmap with all cells set to NO_HIT. Caller pokes
 * individual hit cells via `setHit`. Keeps fixtures pure -- no triangle
 * raycasting in the test path.
 */
function emptyHm(opts: {
  nx: number
  na: number
  dx?: number
  daDeg?: number
  xStart?: number
}): CylindricalHeightmap {
  const dx = opts.dx ?? 1
  const daDeg = opts.daDeg ?? 360 / opts.na
  return {
    radii: new Float32Array(opts.nx * opts.na).fill(NO_HIT),
    nx: opts.nx,
    na: opts.na,
    xStart: opts.xStart ?? 0,
    dx,
    daDeg
  }
}

function setHit(hm: CylindricalHeightmap, ix: number, ia: number, r: number): void {
  hm.radii[ix * hm.na + ia] = r
}

// --- 1. computePerAngleXExtents ---------------------------------------------

describe('computePerAngleXExtents -- shape, overcut padding, NO_HIT, gap-fill', () => {
  it('returns padded [first - overcut, last + overcut] for each angle that has hits', () => {
    // Single hit angle (ia=0); other angles will gap-fill from it.
    const hm = emptyHm({ nx: 10, na: 4 })
    setHit(hm, 3, 0, 5)
    setHit(hm, 4, 0, 5)
    setHit(hm, 5, 0, 5)
    setHit(hm, 6, 0, 5)
    const ext = computePerAngleXExtents(hm, /* overcutCells */ 2)
    expect(ext.length).toBe(4)
    // ia=0: first=3, last=6, +/-2 -> [1, 8]
    expect(ext[0]).toEqual([1, 8])
    // Other angles (ia=1..3) will be gap-filled from ia=0 (and its
    // wraparound neighbour); none should retain the [-1, -1] sentinel.
    for (let ia = 1; ia < 4; ia++) {
      expect(ext[ia]![0]).not.toBe(-1)
      expect(ext[ia]![1]).not.toBe(-1)
    }
  })

  it('emits [-1, -1] for every angle when no cell has a hit (gap-fill cannot rescue all-empty)', () => {
    const hm = emptyHm({ nx: 4, na: 3 })
    const ext = computePerAngleXExtents(hm, 1)
    expect(ext).toEqual([
      [-1, -1],
      [-1, -1],
      [-1, -1]
    ])
  })

  it('gap-fills empty angles via min/max of both neighbours and respects wraparound at the last angle', () => {
    // na=5. Hits at ia=0 (ix=1..3) and ia=2 (ix=4..6). Empty angles:
    //   ia=1 (between hits)
    //   ia=3 (after the last hit, only prev has hits at first)
    //   ia=4 (wraparound: prev=ia=3 just gap-filled, next=ia=0)
    const hm = emptyHm({ nx: 8, na: 5 })
    for (let ix = 1; ix <= 3; ix++) setHit(hm, ix, 0, 7)
    for (let ix = 4; ix <= 6; ix++) setHit(hm, ix, 2, 9)
    const ext = computePerAngleXExtents(hm, 1)
    // ia=0: first=1, last=3, +/-1 -> [0, 4]
    expect(ext[0]).toEqual([0, 4])
    // ia=2: first=4, last=6, +/-1 -> [3, 7]
    expect(ext[2]).toEqual([3, 7])
    // ia=1: gap-fill between ia=0=[0,4] and ia=2=[3,7] ->
    //   [min(0,3), max(4,7)] = [0, 7]
    expect(ext[1]).toEqual([0, 7])
    // ia=3: prev=ia=2=[3,7], next=ia=4=[-1,-1] yet -> inherit prev = [3, 7]
    expect(ext[3]).toEqual([3, 7])
    // ia=4 (wraparound): prev=ia=3 (just updated to [3,7]), next=ia=0=[0,4]
    //   -> [min(3,0), max(7,4)] = [0, 7]
    expect(ext[4]).toEqual([0, 7])
  })

  it('clamps extStart at 0 and extEnd at nx-1 when overcutCells extends past the heightmap edge', () => {
    const hm = emptyHm({ nx: 5, na: 2 })
    for (let ix = 1; ix <= 3; ix++) setHit(hm, ix, 0, 5)
    const ext = computePerAngleXExtents(hm, /* overcutCells */ 10)
    // ia=0: first=1, last=3, +/-10 -> max(0, -9)=0, min(4, 13)=4 -> [0, 4]
    expect(ext[0]).toEqual([0, 4])
    // ia=1 inherits via gap-fill (both wraparound neighbours are ia=0) -> [0, 4]
    expect(ext[1]).toEqual([0, 4])
  })
})

// --- 2. computeAngularCurvature ---------------------------------------------

describe('computeAngularCurvature -- per-angle abs second derivative of radius', () => {
  it('returns a Float32Array of length na with zero everywhere when radius is constant across angles', () => {
    const hm = emptyHm({ nx: 4, na: 4 })
    for (let ix = 0; ix < hm.nx; ix++) {
      for (let ia = 0; ia < hm.na; ia++) {
        setHit(hm, ix, ia, 5)
      }
    }
    const scores = computeAngularCurvature(hm)
    expect(scores).toBeInstanceOf(Float32Array)
    expect(scores.length).toBe(hm.na)
    for (let ia = 0; ia < hm.na; ia++) {
      expect(scores[ia]).toBe(0)
    }
  })

  it('produces strictly higher scores for a high-variance radius profile than for a smooth profile (monotonicity)', () => {
    // Smooth: radii oscillate within +/-0.1 mm around 5 (low |second derivative|).
    const smooth = emptyHm({ nx: 4, na: 4 })
    const smoothPattern = [5, 5.1, 5, 4.9]
    for (let ix = 0; ix < smooth.nx; ix++) {
      for (let ia = 0; ia < smooth.na; ia++) {
        setHit(smooth, ix, ia, smoothPattern[ia]!)
      }
    }
    // Spiky: radii alternate between 5 and 20 mm (huge |second derivative|).
    const spiky = emptyHm({ nx: 4, na: 4 })
    const spikyPattern = [5, 20, 5, 20]
    for (let ix = 0; ix < spiky.nx; ix++) {
      for (let ia = 0; ia < spiky.na; ia++) {
        setHit(spiky, ix, ia, spikyPattern[ia]!)
      }
    }
    const sSmooth = computeAngularCurvature(smooth)
    const sSpiky = computeAngularCurvature(spiky)
    // Monotonicity: every angle's spiky score is strictly greater than the
    // smooth score (spiky's |d2r| = 30, smooth's |d2r| <= 0.2).
    for (let ia = 0; ia < smooth.na; ia++) {
      expect(sSpiky[ia]!).toBeGreaterThan(sSmooth[ia]!)
    }
    // Headline: at ia=0 the smooth profile has |d2r| = 0 exactly because
    // r(prev) + r(next) = 4.9 + 5.1 = 2*5 = 2*r ; the spiky score is the
    // full 30/daRad^2. The 50x lower bound holds at every angle.
    for (let ia = 0; ia < smooth.na; ia++) {
      expect(sSpiky[ia]!).toBeGreaterThan(sSmooth[ia]! * 50)
    }
  })
})

// --- 3. buildAdaptiveAngles -------------------------------------------------

describe('buildAdaptiveAngles -- baseline + midpoint passes, budget, sort', () => {
  it('returns the unrefined `na` evenly-spaced baseline pass list when curvature is all zeros', () => {
    const na = 4
    const baseDeg = 90
    const curvature = new Float32Array(na) // all zeros
    const angles = buildAdaptiveAngles(baseDeg, na, curvature, /* maxExtraPasses */ 10)
    expect(angles).toEqual([0, 90, 180, 270])
  })

  it('inserts midpoint passes only where curvature exceeds the 75th-percentile threshold and respects the budget', () => {
    // Monotonic curvature 10..100 across 10 cells. nonZero sorted = [10..100].
    // threshold = sorted[floor(10*0.75)] = sorted[7] = 80. The strict ">"
    // gate means cells with c=80 do NOT qualify; only ia=8 (c=90) and
    // ia=9 (c=100) get midpoints. baseDeg=36, na=10 -> baseline angles
    // 0..324 in 36-deg steps; midpoints at 288+18=306 and 324+18=342.
    const na = 10
    const baseDeg = 36
    const curvature = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    const generous = buildAdaptiveAngles(baseDeg, na, curvature, /* maxExtraPasses */ 10)
    // 10 baseline + 2 midpoints = 12.
    expect(generous.length).toBe(12)
    // Sorted ascending.
    for (let i = 1; i < generous.length; i++) {
      expect(generous[i]!).toBeGreaterThanOrEqual(generous[i - 1]!)
    }
    // Baseline angles all present.
    for (let ia = 0; ia < na; ia++) {
      expect(generous).toContain(ia * baseDeg)
    }
    // Midpoints inserted at ia=8 and ia=9 only.
    expect(generous).toContain(306)
    expect(generous).toContain(342)
    // No midpoint at ia=7 (c=80, threshold gate is strict >, 80>80 is false).
    expect(generous).not.toContain(270) // ia=7 baseAngle=252, midpoint=270

    // Budget=0 forces baseline-only regardless of curvature (no midpoints).
    const tight = buildAdaptiveAngles(baseDeg, na, curvature, 0)
    expect(tight.length).toBe(na)
    expect(tight).toEqual(Array.from({ length: na }, (_, i) => i * baseDeg))
  })
})

// --- 4. sampleHeightmapAtAngle ----------------------------------------------

describe('sampleHeightmapAtAngle -- linear interp + NO_HIT propagation + wraparound', () => {
  it('returns the exact cell value at grid angles and a linearly-interpolated value between two grid angles', () => {
    const hm = emptyHm({ nx: 4, na: 36 })
    const comp = new Float32Array(hm.nx * hm.na).fill(NO_HIT)
    // ix=0 row: r=10 at ia=0, r=20 at ia=1, r=15 at ia=2 (rest NO_HIT).
    comp[0 * hm.na + 0] = 10
    comp[0 * hm.na + 1] = 20
    comp[0 * hm.na + 2] = 15
    // Exact-grid sample at ia=0 (aDeg=0): frac=0 -> r0 = 10.
    expect(sampleHeightmapAtAngle(hm, comp, 0, 0)).toBe(10)
    // Exact-grid sample at ia=1 (aDeg=10): frac=0 -> r0 = 20.
    expect(sampleHeightmapAtAngle(hm, comp, 0, 10)).toBe(20)
    // Exact-grid sample at ia=2 (aDeg=20): frac=0 -> r0 = 15. (r1 at
    // ia=3 is NO_HIT but the frac=0 path takes r0 directly.)
    expect(sampleHeightmapAtAngle(hm, comp, 0, 20)).toBe(15)
    // Half-step between ia=0 (r=10) and ia=1 (r=20): aDeg=5, frac=0.5 -> 15.
    expect(sampleHeightmapAtAngle(hm, comp, 0, 5)).toBeCloseTo(15, 4)
    // Quarter-step between ia=1 (r=20) and ia=2 (r=15): aDeg=12.5, frac=0.25 -> 18.75.
    expect(sampleHeightmapAtAngle(hm, comp, 0, 12.5)).toBeCloseTo(18.75, 4)
  })

  it('propagates NO_HIT (both empty -> NO_HIT, single empty -> the non-empty neighbour) and wraps around the last angle', () => {
    const hm = emptyHm({ nx: 2, na: 36 })
    const comp = new Float32Array(hm.nx * hm.na).fill(NO_HIT)
    // ix=0 row, only ia=1 hit (r=7) -> sample between ia=0 (NO_HIT) and ia=1 returns r1.
    comp[0 * hm.na + 1] = 7
    expect(sampleHeightmapAtAngle(hm, comp, 0, 5)).toBe(7)
    // ix=0 row, ia=2 hit (r=9), ia=3 NO_HIT -> sample between ia=2 and ia=3 returns r0.
    comp[0 * hm.na + 2] = 9
    expect(sampleHeightmapAtAngle(hm, comp, 0, 25)).toBe(9)
    // Both NO_HIT (ia=10 and ia=11) -> NO_HIT propagates.
    expect(sampleHeightmapAtAngle(hm, comp, 0, 105)).toBe(NO_HIT)
    // Wraparound: ix=1 row, set ia=35 = 11 and ia=0 = 13.
    // aDeg=355 -> iaFloat=35.5 -> ia0=35, ia1=(35+1)%36=0, frac=0.5
    //   -> 11 + 0.5*(13-11) = 12
    comp[1 * hm.na + 35] = 11
    comp[1 * hm.na + 0] = 13
    expect(sampleHeightmapAtAngle(hm, comp, 1, 355)).toBeCloseTo(12, 4)
  })
})

// --- 5. surfaceStepoverDegFromMm --------------------------------------------

describe('surfaceStepoverDegFromMm -- arc-length conversion and clamping', () => {
  it('converts surface arc-step to degrees via deg = (s/r) * (180/PI) at typical Carvera 4-axis stock sizes', () => {
    // 20 mm stock radius, 1 mm desired surface step -> approx 2.8648 deg.
    expect(surfaceStepoverDegFromMm(20, 1)).toBeCloseTo((1 / 20) * (180 / Math.PI), 4)
    // 50 mm stock radius, 0.5 mm step -> approx 0.5730 deg.
    expect(surfaceStepoverDegFromMm(50, 0.5)).toBeCloseTo((0.5 / 50) * (180 / Math.PI), 4)
    // 10 mm stock radius, 2 mm step -> approx 11.4592 deg.
    expect(surfaceStepoverDegFromMm(10, 2)).toBeCloseTo((2 / 10) * (180 / Math.PI), 4)
  })

  it('clamps to [0.1 deg, 180 deg] and protects degenerate (zero / negative) inputs via a 1e-6 epsilon floor', () => {
    // Degenerate r=0 (-> 1e-6), s=1 -> deg approx 5.73e7 -> clamped to 180.
    expect(surfaceStepoverDegFromMm(0, 1)).toBe(180)
    // Degenerate s=0 (-> 1e-6), r=20 -> deg approx 2.86e-6 -> clamped to 0.1.
    expect(surfaceStepoverDegFromMm(20, 0)).toBe(0.1)
    // Very large s on small r -> clamped to 180.
    expect(surfaceStepoverDegFromMm(1, 1000)).toBe(180)
    // Very small s on huge r -> clamped to 0.1.
    expect(surfaceStepoverDegFromMm(1000, 1e-9)).toBe(0.1)
    // Negative inputs (defensive): both floors hit -> deg = (1e-6/1e-6)*(180/PI)
    //   = 180/PI approx 57.296 deg. Inside [0.1, 180] so returned as-is.
    expect(surfaceStepoverDegFromMm(-5, -2)).toBeCloseTo(180 / Math.PI, 4)
  })
})
