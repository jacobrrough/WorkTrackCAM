/**
 * Sketch S5 — exact-landing solver (`solveSketchToTolerance` in solver2d.ts).
 * Node env, no React/DOM/IPC.
 *
 * The single-pass `solveSketch` converges TOWARD a freshly-changed driver, not
 * ONTO it (50→80 lands ≈79.8 after one 120-iter pass). `solveSketchToTolerance`
 * runs bounded rounds until the residual is inside tolerance or stops improving.
 *
 * Coverage:
 *   - a single distance driver lands within 1e-3 in ONE call;
 *   - a single radius driver lands within 1e-3 in ONE call;
 *   - the loop is BOUNDED (respects maxRounds; terminates on a plateau);
 *   - a conflicting dual-driver sketch stays finite (no NaN, no throw);
 *   - an already-satisfied sketch (create-then-no-edit) stays < 1e-6;
 *   - empty-constraint + same-return contracts;
 *   - never returns NaN geometry.
 */

import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'
import { circleThroughThreePoints } from '../../../shared/sketch-profile'
import { cloneDesign, energy, solveSketch, solveSketchToTolerance } from '../solver2d'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Two free points pa→pb joined by an open polyline + a distance driver `dd`. */
function distanceDriver(start: number, target: number): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
    points: { pa: { x: 0, y: 0 }, pb: { x: start, y: 0 } },
    parameters: { dd: target },
    constraints: [
      { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'dd' }
    ]
  }
}

/** Semicircle arc (radius `start`) + a radius driver `rr` targeting `target`. */
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

function allFinite(d: DesignFileV2): boolean {
  return Object.values(d.points).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('solveSketchToTolerance — module surface', () => {
  it('is exported as a function', () => {
    expect(typeof solveSketchToTolerance).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Exact landing — single drivers
// ---------------------------------------------------------------------------

describe('solveSketchToTolerance — exact landing on a single distance driver', () => {
  it('lands 50 -> 80 within 1e-3 in ONE call', () => {
    const d = distanceDriver(50, 80)
    solveSketchToTolerance(d)
    expect(Math.abs(segLen(d) - 80)).toBeLessThan(1e-3)
  })

  it('lands 50 -> 20 within 1e-3 in ONE call', () => {
    const d = distanceDriver(50, 20)
    solveSketchToTolerance(d)
    expect(Math.abs(segLen(d) - 20)).toBeLessThan(1e-3)
  })

  it('one call lands TIGHTER than a single solveSketch pass (proves multi-round)', () => {
    const onePass = solveSketch(distanceDriver(50, 80))
    const toTol = solveSketchToTolerance(distanceDriver(50, 80))
    // single pass is merely near (~0.2 mm off); the wrapper is far closer.
    expect(Math.abs(segLen(onePass) - 80)).toBeGreaterThan(Math.abs(segLen(toTol) - 80))
    expect(Math.abs(segLen(toTol) - 80)).toBeLessThan(1e-3)
  })
})

describe('solveSketchToTolerance — exact landing on a single radius driver', () => {
  it('lands radius 10 -> 4 within 1e-3 in ONE call', () => {
    const d = radiusDriver(10, 4)
    solveSketchToTolerance(d)
    expect(Math.abs(arcRadius(d) - 4)).toBeLessThan(1e-3)
  })

  it('lands radius 10 -> 25 within 1e-3 in ONE call', () => {
    const d = radiusDriver(10, 25)
    solveSketchToTolerance(d)
    expect(Math.abs(arcRadius(d) - 25)).toBeLessThan(1e-3)
  })
})

// ---------------------------------------------------------------------------
// Boundedness — never runs forever
// ---------------------------------------------------------------------------

describe('solveSketchToTolerance — bounded convergence', () => {
  it('terminates and returns finite geometry (does not hang)', () => {
    const d = distanceDriver(50, 80)
    const out = solveSketchToTolerance(d)
    expect(allFinite(out)).toBe(true)
  })

  it('respects a tiny maxRounds cap (1 round ~= one solveSketch pass, not yet landed)', () => {
    // With a single round we should get the single-pass behaviour: near, not on.
    const capped = solveSketchToTolerance(distanceDriver(50, 80), { maxRounds: 1 })
    const onePass = solveSketch(distanceDriver(50, 80))
    expect(Math.abs(segLen(capped) - segLen(onePass))).toBeLessThan(1e-9)
    // And it is NOT yet within the tight tolerance after only one round.
    expect(Math.abs(segLen(capped) - 80)).toBeGreaterThan(1e-3)
  })

  it('a generous maxRounds still terminates quickly on a well-conditioned driver', () => {
    // Even allowing 100 rounds, a clean driver lands (and the loop stops early).
    const d = solveSketchToTolerance(distanceDriver(50, 80), { maxRounds: 100 })
    expect(Math.abs(segLen(d) - 80)).toBeLessThan(1e-3)
  })

  it('a loose tolerance lands inside that looser band', () => {
    const d = solveSketchToTolerance(distanceDriver(50, 80), { toleranceMm: 0.1 })
    expect(Math.abs(segLen(d) - 80)).toBeLessThanOrEqual(0.1 + 1e-9)
  })
})

// ---------------------------------------------------------------------------
// Conflicting / over-constrained — degrades gracefully
// ---------------------------------------------------------------------------

describe('solveSketchToTolerance — conflicting dual drivers degrade gracefully', () => {
  it('two opposing distance drivers on the same pair stay finite (no NaN, no throw)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
      points: { pa: { x: 0, y: 0 }, pb: { x: 50, y: 0 } },
      parameters: { d1: 80, d2: 20 },
      constraints: [
        { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'd1' },
        { id: 'c2', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'd2' }
      ]
    }
    let out!: DesignFileV2
    expect(() => {
      out = solveSketchToTolerance(d)
    }).not.toThrow()
    expect(allFinite(out)).toBe(true)
    const len = segLen(out)
    expect(Number.isFinite(len)).toBe(true)
    // Cannot satisfy both -> it settles at a compromise BETWEEN the two targets,
    // residual stays high (a genuine conflict), but is finite and bounded.
    expect(len).toBeGreaterThan(20 - 1)
    expect(len).toBeLessThan(80 + 1)
    expect(Number.isFinite(energy(out))).toBe(true)
  })

  it('still terminates with a generous maxRounds on a conflicting sketch', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
      points: { pa: { x: 0, y: 0 }, pb: { x: 50, y: 0 } },
      parameters: { d1: 80, d2: 20 },
      constraints: [
        { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'd1' },
        { id: 'c2', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'd2' }
      ]
    }
    const out = solveSketchToTolerance(d, { maxRounds: 50 })
    expect(allFinite(out)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Already-satisfied + skip contracts
// ---------------------------------------------------------------------------

describe('solveSketchToTolerance — already-satisfied + contracts', () => {
  it('a satisfied driver (param == measured) stays put within 1e-6', () => {
    // start already 50 mm with a 50 mm target: no work to do.
    const d = distanceDriver(50, 50)
    solveSketchToTolerance(d)
    expect(Math.abs(segLen(d) - 50)).toBeLessThan(1e-6)
  })

  it('an empty-constraint design is returned untouched (mirrors solveSketch)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
      points: { pa: { x: 0, y: 0 }, pb: { x: 50, y: 0 } }
    }
    const out = solveSketchToTolerance(d)
    expect(out).toBe(d) // solveSketch returns the same ref when no constraints
    expect(segLen(out)).toBeCloseTo(50, 12)
  })

  it('never produces NaN geometry across a sweep of targets', () => {
    for (const target of [1, 5, 13.37, 200]) {
      const out = solveSketchToTolerance(distanceDriver(50, target))
      expect(allFinite(out)).toBe(true)
      expect(Math.abs(segLen(out) - target)).toBeLessThan(1e-3)
    }
  })

  it('mutates in place and returns the same ref on the happy path', () => {
    const d = distanceDriver(50, 80)
    const out = solveSketchToTolerance(d)
    expect(out).toBe(d)
  })

  it('does not corrupt a separate clone (clone-then-solve isolation)', () => {
    const original = distanceDriver(50, 80)
    const working = cloneDesign(original)
    solveSketchToTolerance(working)
    // original untouched; only the working copy moved.
    expect(segLen(original)).toBeCloseTo(50, 12)
    expect(Math.abs(segLen(working) - 80)).toBeLessThan(1e-3)
  })
})
