/**
 * [ID-0186] Cycle 104 -- test-coverage paired-pin contract for the
 * 5 pure helpers exported from `sketch2d-canvas-coords.ts`. The module
 * is consumed by `Sketch2DCanvas.tsx` (pointer + render path) and
 * `sketch2d-draw.ts` (axis-label step picker), so a regression that
 * silently breaks the world<->screen inverse, the snap-to-step contract,
 * the 1/2/5/10 nice-step ladder, or the segment-distance clamping would
 * land directly in the design-tab UI of every operator workflow across
 * all three target machines (K2 Plus print-bed sketch, Laguna Swift
 * full-sheet sketch, Carvera 4-axis indexed sketch).
 *
 * The tests are deliberately overspecified vs the production code to
 * lock the *exact* numerical contract -- inverse round-trips, axis sign
 * conventions, IEEE-754 edge cases (0, +/-Infinity, NaN), and the
 * specific 1/2/5/10 nice-step ladder. Mirrors the cam-axis4 paired-pin
 * convention: any future drift in production semantics WILL break a
 * test here.
 */

import { describe, expect, it } from 'vitest'
import {
  clientToCanvasLocal,
  distSqPointSegment,
  niceStepMm,
  screenToWorld,
  snap
} from './sketch2d-canvas-coords'

describe('[ID-0186] sketch2d-canvas-coords -- screenToWorld', () => {
  it('returns (ox, oy) at the screen center', () => {
    const [wx, wy] = screenToWorld(400, 300, 800, 600, 1, 12.5, -7.25)
    expect(wx).toBe(12.5)
    expect(wy).toBe(-7.25)
  })

  it('flips the Y axis (screen +Y is world -Y)', () => {
    // sx == cx so wx == ox; sy = cy + 50 with scale=1 -> wy = -50 + oy
    const [wx, wy] = screenToWorld(400, 350, 800, 600, 1, 0, 0)
    expect(wx).toBe(0)
    expect(wy).toBe(-50)
  })

  it('does NOT flip the X axis (screen +X is world +X)', () => {
    const [wx, wy] = screenToWorld(450, 300, 800, 600, 1, 0, 0)
    expect(wx).toBe(50)
    expect(wy).toBe(0)
  })

  it('divides screen-space delta by scale', () => {
    // sx = cx + 100 with scale=2 -> wx = 50 + ox
    const [wx, wy] = screenToWorld(500, 300, 800, 600, 2, 0, 0)
    expect(wx).toBe(50)
    expect(wy).toBe(0)
  })

  it('respects scale on the Y axis', () => {
    // sy = cy - 100 with scale=4 -> wy = -(-100/4) + oy = 25
    const [, wy] = screenToWorld(400, 200, 800, 600, 4, 0, 0)
    expect(wy).toBe(25)
  })

  it('returns numeric tuples (length 2, both finite for finite inputs)', () => {
    const out = screenToWorld(123, 456, 800, 600, 1.7, 3.3, -2.2)
    expect(out).toHaveLength(2)
    expect(Number.isFinite(out[0])).toBe(true)
    expect(Number.isFinite(out[1])).toBe(true)
  })

  it('is the inverse of itself for non-zero scale (round-trip)', () => {
    // Build a synthetic forward map matching the inverse formula:
    //   sx = (wx - ox) * scale + w/2
    //   sy = -(wy - oy) * scale + h/2
    const w = 1000
    const h = 800
    const scale = 1.5
    const ox = 11
    const oy = -22
    const wx0 = 7
    const wy0 = 13
    const sx = (wx0 - ox) * scale + w / 2
    const sy = -(wy0 - oy) * scale + h / 2
    const [wx, wy] = screenToWorld(sx, sy, w, h, scale, ox, oy)
    expect(wx).toBeCloseTo(wx0, 12)
    expect(wy).toBeCloseTo(wy0, 12)
  })
})

describe('[ID-0186] sketch2d-canvas-coords -- clientToCanvasLocal', () => {
  function makeCanvas(rect: { left: number; top: number }): HTMLCanvasElement {
    return {
      getBoundingClientRect: () => ({ left: rect.left, top: rect.top })
    } as unknown as HTMLCanvasElement
  }

  it('subtracts rect.left from clientX and rect.top from clientY', () => {
    const c = makeCanvas({ left: 100, top: 50 })
    const [x, y] = clientToCanvasLocal(150, 80, c)
    expect(x).toBe(50)
    expect(y).toBe(30)
  })

  it('returns (clientX, clientY) when the canvas is at the viewport origin', () => {
    const c = makeCanvas({ left: 0, top: 0 })
    const [x, y] = clientToCanvasLocal(42, 17, c)
    expect(x).toBe(42)
    expect(y).toBe(17)
  })

  it('handles negative client coordinates (pointer above/left of canvas)', () => {
    const c = makeCanvas({ left: 200, top: 150 })
    const [x, y] = clientToCanvasLocal(180, 120, c)
    expect(x).toBe(-20)
    expect(y).toBe(-30)
  })

  it('returns numeric tuple of length 2', () => {
    const c = makeCanvas({ left: 1, top: 2 })
    const out = clientToCanvasLocal(0, 0, c)
    expect(out).toHaveLength(2)
    expect(typeof out[0]).toBe('number')
    expect(typeof out[1]).toBe('number')
  })
})

describe('[ID-0186] sketch2d-canvas-coords -- snap', () => {
  it('rounds to the nearest step', () => {
    expect(snap(7, 5)).toBe(5)
    expect(snap(8, 5)).toBe(10)
    expect(snap(2.4, 1)).toBe(2)
    expect(snap(2.6, 1)).toBe(3)
  })

  it('snaps zero to zero', () => {
    expect(snap(0, 5)).toBe(0)
  })

  it('returns v unchanged when step is zero', () => {
    expect(snap(7.123, 0)).toBe(7.123)
  })

  it('returns v unchanged when step is negative (guarded against bad config)', () => {
    expect(snap(7.123, -1)).toBe(7.123)
    expect(snap(-3.5, -2)).toBe(-3.5)
  })

  it('handles negative values symmetrically', () => {
    // Math.round rounds half toward +Infinity, so -2.5 -> -2 not -3.
    expect(snap(-7, 5)).toBe(-5)
    expect(snap(-8, 5)).toBe(-10)
  })

  it('preserves step granularity for fractional steps', () => {
    expect(snap(0.13, 0.05)).toBeCloseTo(0.15, 12)
    expect(snap(0.04, 0.1)).toBeCloseTo(0, 12)
  })
})

describe('[ID-0186] sketch2d-canvas-coords -- niceStepMm', () => {
  it('returns 1 for zero or non-positive input (defensive)', () => {
    expect(niceStepMm(0)).toBe(1)
    expect(niceStepMm(-5)).toBe(1)
    expect(niceStepMm(-0.001)).toBe(1)
  })

  it('returns 1 for NaN / Infinity / -Infinity (IEEE-754 defensive)', () => {
    expect(niceStepMm(Number.NaN)).toBe(1)
    expect(niceStepMm(Number.POSITIVE_INFINITY)).toBe(1)
    expect(niceStepMm(Number.NEGATIVE_INFINITY)).toBe(1)
  })

  it('preserves exact 1/2/5/10 ladder values', () => {
    expect(niceStepMm(1)).toBe(1)
    expect(niceStepMm(2)).toBe(2)
    expect(niceStepMm(5)).toBe(5)
    expect(niceStepMm(10)).toBe(10)
  })

  it('rounds up to the next-larger ladder step (1 -> 2 -> 5 -> 10)', () => {
    expect(niceStepMm(1.5)).toBe(2)
    expect(niceStepMm(3)).toBe(5)
    expect(niceStepMm(7)).toBe(10)
  })

  it('scales by powers of 10 (decade-aware)', () => {
    // 15 -> p=10, n=1.5 -> base=2 -> 20
    expect(niceStepMm(15)).toBe(20)
    // 30 -> p=10, n=3 -> base=5 -> 50
    expect(niceStepMm(30)).toBe(50)
    // 70 -> p=10, n=7 -> base=10 -> 100
    expect(niceStepMm(70)).toBe(100)
    // 150 -> p=100, n=1.5 -> base=2 -> 200
    expect(niceStepMm(150)).toBe(200)
  })

  it('scales below 1 (sub-millimeter steps)', () => {
    // 0.05 -> p=0.01, n=5 -> base=5 -> 0.05
    expect(niceStepMm(0.05)).toBeCloseTo(0.05, 12)
    // 0.04 -> p=0.01, n=4 -> base=5 -> 0.05
    expect(niceStepMm(0.04)).toBeCloseTo(0.05, 12)
    // 0.7 -> p=0.1, n=7 -> base=10 -> 1.0
    expect(niceStepMm(0.7)).toBeCloseTo(1, 12)
  })

  it('always returns a value from the {1,2,5} * 10^k ladder', () => {
    const samples = [0.001, 0.018, 0.21, 0.5, 1.234, 3.7, 8.8, 24, 67, 412, 9999]
    for (const s of samples) {
      const v = niceStepMm(s)
      // Normalize: v / 10^floor(log10(v)) should be in {1, 2, 5, 10}
      const p = Math.pow(10, Math.floor(Math.log10(v)))
      const n = v / p
      // Allow a wide tolerance because of float division.
      const isLadder = [1, 2, 5, 10].some((b) => Math.abs(n - b) < 1e-9)
      expect(isLadder).toBe(true)
    }
  })

  it('is monotonic non-decreasing across the ladder boundary', () => {
    // Successive samples around boundaries shouldn't go down.
    const samples = [0.9, 1, 1.5, 2, 2.5, 5, 5.1, 9.9, 10, 11]
    let last = -Infinity
    for (const s of samples) {
      const v = niceStepMm(s)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })
})

describe('[ID-0186] sketch2d-canvas-coords -- distSqPointSegment', () => {
  it('returns squared distance to A when segment is degenerate (A == B)', () => {
    expect(distSqPointSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(25, 12)
    expect(distSqPointSegment(0, 0, 1, 2, 1, 2)).toBeCloseTo(5, 12)
  })

  it('returns 0 when the point is on the segment', () => {
    // Midpoint of (0,0)-(4,0)
    expect(distSqPointSegment(2, 0, 0, 0, 4, 0)).toBeCloseTo(0, 12)
    // Endpoint A
    expect(distSqPointSegment(0, 0, 0, 0, 4, 0)).toBeCloseTo(0, 12)
    // Endpoint B
    expect(distSqPointSegment(4, 0, 0, 0, 4, 0)).toBeCloseTo(0, 12)
  })

  it('clamps to endpoint A when the point is past A', () => {
    // P=(-3,0), AB=(0,0)->(4,0); closest point is A=(0,0); dist^2 = 9
    expect(distSqPointSegment(-3, 0, 0, 0, 4, 0)).toBeCloseTo(9, 12)
  })

  it('clamps to endpoint B when the point is past B', () => {
    // P=(7,0), AB=(0,0)->(4,0); closest is B=(4,0); dist^2 = 9
    expect(distSqPointSegment(7, 0, 0, 0, 4, 0)).toBeCloseTo(9, 12)
  })

  it('returns squared perpendicular distance for points beside the interior', () => {
    // P=(2,3), AB=(0,0)->(4,0); foot = (2,0); dist^2 = 9
    expect(distSqPointSegment(2, 3, 0, 0, 4, 0)).toBeCloseTo(9, 12)
    // P=(2,-3), foot = (2,0); dist^2 = 9
    expect(distSqPointSegment(2, -3, 0, 0, 4, 0)).toBeCloseTo(9, 12)
  })

  it('handles diagonal segments (non-axis-aligned)', () => {
    // AB = (0,0)->(4,4); P=(2,0); foot = (1,1); dist^2 = (2-1)^2 + (0-1)^2 = 2
    expect(distSqPointSegment(2, 0, 0, 0, 4, 4)).toBeCloseTo(2, 12)
    // AB = (0,0)->(4,4); P=(4,0); foot = (2,2); dist^2 = 4+4 = 8
    expect(distSqPointSegment(4, 0, 0, 0, 4, 4)).toBeCloseTo(8, 12)
  })

  it('is symmetric in segment direction (A<->B swap)', () => {
    // Swapping A and B should produce the same squared distance.
    const d1 = distSqPointSegment(2, 3, 0, 0, 4, 0)
    const d2 = distSqPointSegment(2, 3, 4, 0, 0, 0)
    expect(d1).toBeCloseTo(d2, 12)
  })

  it('returns non-negative values for arbitrary inputs', () => {
    const samples: Array<[number, number, number, number, number, number]> = [
      [1, 2, 3, 4, 5, 6],
      [-3, -2, 0, 0, 7, 1],
      [100, -100, 50, 50, 60, 60],
      [0.001, 0.001, 0, 0, 1e-6, 1e-6]
    ]
    for (const args of samples) {
      const d = distSqPointSegment(...args)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(d)).toBe(true)
    }
  })
})

describe('[ID-0186] sketch2d-canvas-coords -- JSDoc paired-pin', () => {
  it('module exports the full pin set used by the sketch tab', () => {
    // If a refactor renames or removes any of these, this import-side
    // check fires before any production-side caller breaks at runtime.
    expect(typeof screenToWorld).toBe('function')
    expect(typeof clientToCanvasLocal).toBe('function')
    expect(typeof snap).toBe('function')
    expect(typeof niceStepMm).toBe('function')
    expect(typeof distSqPointSegment).toBe('function')
  })

  it('helpers preserve their documented arities (param counts)', () => {
    // Function.length reports declared (non-default) param counts and
    // is part of the public contract for any caller relying on
    // .length-based duck-typing.
    expect(screenToWorld.length).toBe(7)
    expect(clientToCanvasLocal.length).toBe(3)
    expect(snap.length).toBe(2)
    expect(niceStepMm.length).toBe(1)
    expect(distSqPointSegment.length).toBe(6)
  })
})
