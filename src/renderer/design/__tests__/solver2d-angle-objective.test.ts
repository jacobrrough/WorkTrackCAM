/**
 * Sketch S5.1 — the `angle` constraint objective in solver2d.ts.
 * Node env, no React/DOM/IPC.
 *
 * S5.1 replaced the old `(cos meas − cos target)²` angle term — whose gradient is
 * ∝ sin(θ)·Δθ and FLATTENS as the angle nears the target, so the bounded
 * `solveSketchToTolerance` plateau-stopped short (45°→90° settled ≈84.5°) — with
 * the TRUE signed-angle difference, arm-scaled into a tangential arc-length so it
 * is mm-commensurate with the distance/radius residuals:
 *
 *     residual = wrapToPi(θ_meas − sign(θ_meas)·θ_target) · sqrt(|arm1|·|arm2|)
 *     energy  += residual²
 *
 * The angle helpers are module-internal, so this suite exercises them through the
 * public surfaces (`energy`, `solveSketch`, `solveSketchToTolerance`,
 * `sketchResidualReport`). For a sketch with a SINGLE angle constraint and zero
 * point displacement, `energy === residual²`, which lets us assert the residual's
 * sign / ±180° wrap / scale precisely.
 *
 * Coverage:
 *   - a satisfied angle has ~0 energy; an unsatisfied one is residual² (arm²·Δθ²);
 *   - the ±180° seam: 179°→179° is satisfied (~0) but 179°→1° is a ~178° error
 *     (the residual WRAPS, it does not collapse to 0);
 *   - the gradient drives the right way: solving strictly reduces the angle error;
 *   - exact landing within 1e-2° for acute/right/obtuse targets in ONE solve;
 *   - landing is orientation-preserving (a line below the x-axis stays below);
 *   - distance/radius landing is UNCHANGED (still exact);
 *   - the bounded loop still terminates on a conflicting angle+angle sketch.
 */

import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'
import { circleThroughThreePoints } from '../../../shared/sketch-profile'
import { energy, solveSketch, solveSketchToTolerance, sketchResidualReport } from '../solver2d'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Two segments sharing the origin: line 1 along +X, line 2 at `startDeg` (signed,
 * CCW positive), arm length `arm`. A single `angle` driver targets `targetDeg`.
 */
function angleDriver(startDeg: number, targetDeg: number, arm = 40): DesignFileV2 {
  const rad = (startDeg * Math.PI) / 180
  return {
    ...emptyDesign(),
    points: {
      o: { x: 0, y: 0 },
      e1: { x: arm, y: 0 },
      e2: { x: arm * Math.cos(rad), y: arm * Math.sin(rad) }
    },
    entities: [
      { id: 'L1', kind: 'polyline', pointIds: ['o', 'e1'], closed: false },
      { id: 'L2', kind: 'polyline', pointIds: ['o', 'e2'], closed: false }
    ],
    parameters: { ang: targetDeg },
    constraints: [
      {
        id: 'c',
        type: 'angle',
        a1: { pointId: 'o' },
        b1: { pointId: 'e1' },
        a2: { pointId: 'o' },
        b2: { pointId: 'e2' },
        parameterKey: 'ang'
      }
    ]
  }
}

/** Unsigned measured angle (deg) between L1 (o→e1) and L2 (o→e2) — what the UI shows. */
function measuredAngleDeg(d: DesignFileV2): number {
  const o = d.points.o!
  const e1 = d.points.e1!
  const e2 = d.points.e2!
  const v1x = e1.x - o.x
  const v1y = e1.y - o.y
  const v2x = e2.x - o.x
  const v2y = e2.y - o.y
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y))))
  return (Math.acos(cos) * 180) / Math.PI
}

/** Signed cross of (o→e1)×(o→e2): >0 ⇒ e2 is CCW (above), <0 ⇒ CW (below). */
function signOfSide(d: DesignFileV2): number {
  const o = d.points.o!
  const e1 = d.points.e1!
  const e2 = d.points.e2!
  return (e1.x - o.x) * (e2.y - o.y) - (e1.y - o.y) * (e2.x - o.x)
}

function allFinite(d: DesignFileV2): boolean {
  return Object.values(d.points).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}

// Distance / radius drivers, to prove the non-angle terms are untouched.
function distanceDriver(start: number, target: number): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
    points: { pa: { x: 0, y: 0 }, pb: { x: start, y: 0 } },
    parameters: { dd: target },
    constraints: [{ id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'dd' }]
  }
}
function radiusDriver(start: number, target: number): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [{ id: 'a', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }],
    points: { s: { x: start, y: 0 }, v: { x: 0, y: start }, e: { x: -start, y: 0 } },
    parameters: { rr: target },
    constraints: [{ id: 'c1', type: 'radius', entityId: 'a', parameterKey: 'rr' }]
  }
}
const segLen = (d: DesignFileV2): number =>
  Math.hypot(d.points.pb!.x - d.points.pa!.x, d.points.pb!.y - d.points.pa!.y)
function arcRadius(d: DesignFileV2): number {
  const s = d.points.s!
  const v = d.points.v!
  const e = d.points.e!
  return circleThroughThreePoints(s.x, s.y, v.x, v.y, e.x, e.y)!.r
}

// ---------------------------------------------------------------------------
// Residual magnitude + scale (energy === residual² for one constraint, no move)
// ---------------------------------------------------------------------------

describe('angle objective — residual magnitude & arm scaling', () => {
  it('a satisfied angle has ~zero energy', () => {
    expect(energy(angleDriver(90, 90))).toBeLessThan(1e-12)
    expect(energy(angleDriver(45, 45))).toBeLessThan(1e-12)
    expect(energy(angleDriver(150, 150))).toBeLessThan(1e-12)
  })

  it('an unsatisfied angle contributes (arm · Δθ_rad)² to the energy', () => {
    // 45° away from a 90° target, arm = 40 ⇒ residual = (π/4)·40, energy = residual².
    const arm = 40
    const dThetaRad = (45 * Math.PI) / 180
    const expected = (dThetaRad * arm) ** 2
    expect(energy(angleDriver(45, 90, arm))).toBeCloseTo(expected, 6)
  })

  it('scales with arm length (longer arms ⇒ larger residual for the same angle error)', () => {
    const small = energy(angleDriver(45, 90, 10))
    const large = energy(angleDriver(45, 90, 80))
    // arm 80 vs 10 ⇒ (80/10)² = 64× the energy for the identical 45° error.
    expect(large / small).toBeCloseTo(64, 4)
  })
})

// ---------------------------------------------------------------------------
// ±180° seam — the residual WRAPS, it does not vanish across the boundary
// ---------------------------------------------------------------------------

describe('angle objective — ±180° seam wrap', () => {
  it('179°→179° is satisfied (~0) — no spurious wrap energy at the boundary', () => {
    expect(energy(angleDriver(179, 179))).toBeLessThan(1e-9)
  })

  it('179°→1° is a ~178° error, NOT a ~0 error (wrapToPi keeps the true difference)', () => {
    // If the residual naively used (179 − 1) without sign-matching, or collapsed
    // mod 180, this would look small. wrapToPi(179° − (+1°)) = 178° (huge).
    const arm = 40
    const dThetaRad = (178 * Math.PI) / 180
    const expected = (dThetaRad * arm) ** 2
    expect(energy(angleDriver(179, 1, arm))).toBeCloseTo(expected, 4)
  })

  it('1°→179° is symmetric to 179°→1° (same large residual)', () => {
    expect(energy(angleDriver(1, 179))).toBeCloseTo(energy(angleDriver(179, 1)), 4)
  })
})

// ---------------------------------------------------------------------------
// sketchResidualReport mirrors energy and reports the unsigned measured angle
// ---------------------------------------------------------------------------

describe('angle objective — residual report', () => {
  it("report total equals energy() and the line shows the unsigned measured angle", () => {
    const d = angleDriver(45, 90)
    const report = sketchResidualReport(d)
    expect(report.total).toBeCloseTo(energy(d), 9)
    expect(report.lines[0]).toContain('meas≈45.00°')
    expect(report.lines[0]).toContain('target=90°')
  })

  it('a degenerate (zero-length) leg reports a degenerate segment, not NaN', () => {
    const d = angleDriver(45, 90)
    d.points.e2 = { x: 0, y: 0 } // collapse L2 onto the origin
    const report = sketchResidualReport(d)
    expect(report.lines[0]).toContain('degenerate')
    expect(Number.isFinite(report.total)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Gradient drives toward the target; exact landing in ONE solve
// ---------------------------------------------------------------------------

describe('angle objective — gradient drives toward the target', () => {
  it('a single solveSketch pass strictly REDUCES the angle error (gradient points the right way)', () => {
    const d = angleDriver(45, 90)
    const before = Math.abs(measuredAngleDeg(d) - 90)
    solveSketch(d)
    const after = Math.abs(measuredAngleDeg(d) - 90)
    expect(after).toBeLessThan(before)
  })

  it('the new gradient does NOT vanish near the solution (a near-target sketch still tightens)', () => {
    // The OLD cosine objective stalled here (gradient ∝ sin·Δθ ≈ 0). The new
    // arm-scaled angle term still has a non-trivial gradient at a small error.
    const d = angleDriver(89, 90) // only 1° away
    const before = Math.abs(measuredAngleDeg(d) - 90)
    solveSketchToTolerance(d)
    const after = Math.abs(measuredAngleDeg(d) - 90)
    expect(after).toBeLessThan(before)
    expect(after).toBeLessThan(1e-2)
  })
})

describe('angle objective — exact landing within 1e-2° in ONE solveSketchToTolerance', () => {
  it.each([
    [45, 90], // open to a right angle
    [90, 45], // close from a right angle
    [30, 120], // acute -> obtuse
    [60, 150], // obtuse target
    [120, 60], // obtuse -> acute
    [150, 150], // already on target (no-op)
    [10, 150], // large swing, shallow start
    [170, 30] // large swing, reflex-ish start
  ])('lands %i° -> %i° within 1e-2°', (start, target) => {
    const d = angleDriver(start, target)
    solveSketchToTolerance(d)
    expect(Math.abs(measuredAngleDeg(d) - target)).toBeLessThan(1e-2)
    expect(allFinite(d)).toBe(true)
  })

  it('is orientation-preserving: with line 1 pinned, a leg below the x-axis stays below', () => {
    // A single angle constraint with ALL points free is rotationally ambiguous
    // (it fixes only the RELATIVE angle), so the side of any one point isn't
    // well-defined. Pin line 1 (o, e1) so only e2 moves; then the orientation of
    // e2 is meaningful. Start at -45° (e2 below +X), drive the magnitude to 90°:
    // e2 must end at -90° (still BELOW), not flip up to +90°.
    const d = angleDriver(-45, 90)
    d.points.o = { ...d.points.o!, fixed: true }
    d.points.e1 = { ...d.points.e1!, fixed: true }
    expect(signOfSide(d)).toBeLessThan(0) // below to start
    solveSketchToTolerance(d)
    expect(Math.abs(measuredAngleDeg(d) - 90)).toBeLessThan(1e-2)
    expect(signOfSide(d)).toBeLessThan(0) // still below — orientation kept
  })
})

// ---------------------------------------------------------------------------
// Non-angle terms unchanged; bounded loop still terminates on conflicts
// ---------------------------------------------------------------------------

describe('angle objective — does not disturb distance/radius landing or boundedness', () => {
  it('distance driver still lands exactly (the angle rewrite left it alone)', () => {
    const d = distanceDriver(50, 80)
    solveSketchToTolerance(d)
    expect(Math.abs(segLen(d) - 80)).toBeLessThan(1e-3)
  })

  it('radius driver still lands exactly', () => {
    const d = radiusDriver(10, 25)
    solveSketchToTolerance(d)
    expect(Math.abs(arcRadius(d) - 25)).toBeLessThan(1e-3)
  })

  it('two conflicting angle drivers on the same line pair stay finite and terminate', () => {
    const d: DesignFileV2 = {
      ...angleDriver(45, 90),
      parameters: { ang: 90, ang2: 30 },
      constraints: [
        {
          id: 'c',
          type: 'angle',
          a1: { pointId: 'o' },
          b1: { pointId: 'e1' },
          a2: { pointId: 'o' },
          b2: { pointId: 'e2' },
          parameterKey: 'ang'
        },
        {
          id: 'c2',
          type: 'angle',
          a1: { pointId: 'o' },
          b1: { pointId: 'e1' },
          a2: { pointId: 'o' },
          b2: { pointId: 'e2' },
          parameterKey: 'ang2'
        }
      ]
    }
    let out!: DesignFileV2
    expect(() => {
      out = solveSketchToTolerance(d, { maxRounds: 50 })
    }).not.toThrow()
    expect(allFinite(out)).toBe(true)
    // Settles at a compromise BETWEEN the two targets (30..90), residual finite.
    const m = measuredAngleDeg(out)
    expect(m).toBeGreaterThan(30 - 1)
    expect(m).toBeLessThan(90 + 1)
    expect(Number.isFinite(energy(out))).toBe(true)
  })
})
