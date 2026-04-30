/**
 * Paired-pin contract set for the cam-axis4 depth-pass helpers exported
 * from `src/main/cam-axis4/index.ts`:
 *
 *   - `normalizeRadialZPassMm(zPassMm)`
 *   - `iterDepthsMm(zPassMm, zStepMm)`
 *   - `computeDepthsMm(zPassMm, zStepMm, cylinderRadiusMm, useMeshRadial, meshRadialMaxMm?)`
 *
 * Roadmap: [ID-0178] (cam-engine, Cycle 93). Cross-cuts:
 *   - Makera Carvera + 4th Axis Rotary -- the only 4-axis target in
 *     CLAUDE.md "USER CONTEXT -- TARGET MACHINES". The depth-pass
 *     scheduler decides how many waterline passes the rotary roughing
 *     strategy emits and how shallow the first pass starts on undersized
 *     mesh stock; an off-by-one or sign-coercion regression here either
 *     wastes time on dozens of empty passes (mesh-shallow shortcut broken)
 *     or dives the tool to full depth on the first pass (sign-coercion
 *     regression in zPass).
 *
 * Pure helper-level unit tests: NO machine profile, NO mesh raycast, NO
 * post-template invocation, NO production-code edits this cycle. The tests
 * pin the JSDoc contract above each helper to its runtime behavior so any
 * doc/code drift fails a focused test.
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeRadialZPassMm,
  iterDepthsMm,
  computeDepthsMm
} from '../index'

describe('normalizeRadialZPassMm -- sign-coercion + zero-fallback contract', () => {
  it('returns negative input unchanged (already a radial cut depth)', () => {
    expect(normalizeRadialZPassMm(-1)).toBe(-1)
    expect(normalizeRadialZPassMm(-0.25)).toBe(-0.25)
    expect(normalizeRadialZPassMm(-3.7)).toBe(-3.7)
  })

  it('flips a positive input to its negative magnitude (operators sometimes type a positive depth)', () => {
    expect(normalizeRadialZPassMm(1)).toBe(-1)
    expect(normalizeRadialZPassMm(0.25)).toBe(-0.25)
    expect(normalizeRadialZPassMm(3.7)).toBe(-3.7)
  })

  it('returns the -0.5 sentinel default when zPassMm is exactly zero', () => {
    expect(normalizeRadialZPassMm(0)).toBe(-0.5)
  })

  it('treats sub-epsilon magnitudes (|zPass| <= 1e-9) as zero and emits the -0.5 sentinel', () => {
    expect(normalizeRadialZPassMm(1e-10)).toBe(-0.5)
    expect(normalizeRadialZPassMm(-1e-10)).toBe(-0.5)
    // Just outside the epsilon band on the negative side: returned as-is.
    expect(normalizeRadialZPassMm(-1e-8)).toBe(-1e-8)
    // Just outside the epsilon band on the positive side: sign-flipped.
    expect(normalizeRadialZPassMm(1e-8)).toBe(-1e-8)
  })

  it('output is always negative (or the -0.5 sentinel) -- the strategies expect a strictly-negative cut depth', () => {
    for (const zp of [-5, -1, -0.001, 0, 0.001, 1, 5]) {
      expect(normalizeRadialZPassMm(zp)).toBeLessThan(0)
    }
  })
})

describe('iterDepthsMm -- depth-pass schedule + degenerate guards', () => {
  it('returns a single-element schedule [zPass] when zPass is non-negative (above-stock cut, no schedule needed)', () => {
    expect(iterDepthsMm(0, 1)).toEqual([0])
    expect(iterDepthsMm(1.5, 1)).toEqual([1.5])
  })

  it('returns a single-element schedule [zPass] when zStep is effectively zero (degenerate guard)', () => {
    expect(iterDepthsMm(-2, 0)).toEqual([-2])
    expect(iterDepthsMm(-2, 1e-9)).toEqual([-2])
    // Negative or sub-epsilon zStep is clamped to 0 by Math.max(0, ...) and trips the same guard.
    expect(iterDepthsMm(-2, -1)).toEqual([-2])
  })

  it('emits intermediate -zStep, -2*zStep, ... passes and appends zPass as the final pass', () => {
    // zPass=-2, zStep=0.5 -> passes -0.5, -1.0, -1.5, then -2.0 (final).
    expect(iterDepthsMm(-2, 0.5)).toEqual([-0.5, -1, -1.5, -2])
  })

  it('does NOT emit a duplicate of zPass when zPass is an integer multiple of zStep (the +1e-6 epsilon guard)', () => {
    // zPass=-2, zStep=1: naive loop "-1, -2, then append -2" would duplicate
    // the -2 pass. The +1e-6 epsilon in the loop guard stops the loop one
    // step early so the final append is the only -2 pass.
    expect(iterDepthsMm(-2, 1)).toEqual([-1, -2])
    // zPass=-3, zStep=1: -1, -2, then final -3.
    expect(iterDepthsMm(-3, 1)).toEqual([-1, -2, -3])
  })

  it('clamps overshoot: the LAST element is always exactly zPass (not -k*zStep when -k*zStep < zPass)', () => {
    // zPass=-1.7, zStep=0.5 -> -0.5, -1.0, -1.5, then final -1.7.
    // (-2.0 would overshoot zPass, so the loop stops before it.)
    const out = iterDepthsMm(-1.7, 0.5)
    expect(out[out.length - 1]).toBe(-1.7)
    expect(out).toEqual([-0.5, -1, -1.5, -1.7])
  })

  it('every emitted pass is in [zPass, 0) and the schedule is strictly monotonically decreasing', () => {
    const out = iterDepthsMm(-5, 0.7)
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-5)
      expect(out[i]).toBeLessThan(0)
      if (i > 0) expect(out[i]).toBeLessThan(out[i - 1]!)
    }
    // Final pass is exactly zPass.
    expect(out[out.length - 1]).toBe(-5)
  })

  it('schedule length grows with |zPass|/zStep -- a deeper target needs more passes', () => {
    const shallow = iterDepthsMm(-1, 0.5).length // -0.5, -1
    const medium = iterDepthsMm(-2, 0.5).length // -0.5, -1, -1.5, -2
    const deep = iterDepthsMm(-5, 0.5).length // -0.5 .. -4.5, -5
    expect(shallow).toBe(2)
    expect(medium).toBe(4)
    expect(deep).toBe(10)
    expect(deep).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(shallow)
  })
})

describe('computeDepthsMm -- mesh-aware shallow start + fall-through guards', () => {
  it('falls through to iterDepthsMm when useMeshRadial=false (no shortcut, even if meshRadialMaxMm is set)', () => {
    const r = 25
    const mr = 10 // would otherwise be a deep-shortcut candidate
    const fallthrough = computeDepthsMm(-2, 0.5, r, /* useMeshRadial */ false, mr)
    const baseline = iterDepthsMm(-2, 0.5)
    expect(fallthrough).toEqual(baseline)
  })

  it('falls through to iterDepthsMm when meshRadialMaxMm is undefined / 0 / negative (no shortcut)', () => {
    const baseline = iterDepthsMm(-2, 0.5)
    expect(computeDepthsMm(-2, 0.5, 25, true, undefined)).toEqual(baseline)
    expect(computeDepthsMm(-2, 0.5, 25, true, 0)).toEqual(baseline)
    expect(computeDepthsMm(-2, 0.5, 25, true, -5)).toEqual(baseline)
  })

  it('falls through to iterDepthsMm when the mesh extends to (or past) the stock OD (mr >= r - 1e-6, nothing to skip)', () => {
    // Mesh at-or-past the cylinder OD: zShallow = mr - r >= -1e-6, which is
    // effectively "no air above the part" -- no shallow-start savings.
    const baseline = iterDepthsMm(-2, 0.5)
    expect(computeDepthsMm(-2, 0.5, 25, true, 25)).toEqual(baseline)
    expect(computeDepthsMm(-2, 0.5, 25, true, 25.5)).toEqual(baseline)
    // Just inside the epsilon band on the "extends past" side: still falls through.
    expect(computeDepthsMm(-2, 0.5, 25, true, 25 - 5e-7)).toEqual(baseline)
  })

  it('falls through to iterDepthsMm when zShallow (mr - r) is already deeper than zPass (single pass would do it anyway)', () => {
    // r=25, mr=20 -> zShallow = -5. With zPass=-2, the shallow start is
    // BELOW the target depth, so the shortcut would emit nothing useful --
    // fall through to the regular schedule.
    const baseline = iterDepthsMm(-2, 0.5)
    expect(computeDepthsMm(-2, 0.5, 25, true, 20)).toEqual(baseline)
  })

  it('emits a [zPass] degenerate schedule when zStep is effectively zero (even with a valid shallow start)', () => {
    // r=25, mr=24 -> zShallow = -1. zPass=-3, zStep=0 -> degenerate guard
    // returns [zPass] only.
    expect(computeDepthsMm(-3, 0, 25, true, 24)).toEqual([-3])
    expect(computeDepthsMm(-3, 1e-9, 25, true, 24)).toEqual([-3])
  })

  it('starts the schedule at zShallow=mr-r (NOT at -zStep) when the mesh is undersized -- the load-bearing perf win', () => {
    // r=25, mr=24 -> zShallow = -1. zPass=-3, zStep=0.5.
    // Without the shallow shortcut: -0.5, -1, -1.5, -2, -2.5, -3 (6 passes).
    // With the shortcut:            -1, -1.5, -2, -2.5, -3       (5 passes).
    const out = computeDepthsMm(-3, 0.5, 25, true, 24)
    expect(out[0]).toBeCloseTo(-1, 9)
    expect(out[out.length - 1]).toBe(-3)
    expect(out).toEqual([-1, -1.5, -2, -2.5, -3])
    // And it MUST be strictly shorter than the no-mesh-shortcut baseline.
    const baseline = iterDepthsMm(-3, 0.5)
    expect(out.length).toBeLessThan(baseline.length)
  })

  it('does NOT emit a duplicate of zPass when zShallow is an integer multiple of zStep above zPass (epsilon guard mirrors iterDepthsMm)', () => {
    // r=25, mr=24 -> zShallow = -1. zPass=-3, zStep=1 -> naive loop
    // "-1, -2, -3, then append -3" would duplicate. The +1e-6 epsilon
    // stops the loop early so -3 appears exactly once.
    const out = computeDepthsMm(-3, 1, 25, true, 24)
    expect(out).toEqual([-1, -2, -3])
    // Final pass is exactly zPass, no duplicate trailing pass.
    expect(out.filter((d) => d === -3).length).toBe(1)
  })

  it('every emitted pass is in [zPass, zShallow] and strictly monotonically decreasing', () => {
    // r=25, mr=23 -> zShallow = -2. zPass=-5, zStep=0.7.
    const out = computeDepthsMm(-5, 0.7, 25, true, 23)
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-5)
      expect(out[i]).toBeLessThanOrEqual(-2 + 1e-9)
      if (i > 0) expect(out[i]).toBeLessThan(out[i - 1]!)
    }
    expect(out[out.length - 1]).toBe(-5)
    expect(out[0]).toBeCloseTo(-2, 9)
  })

  it('clamps cylinderRadiusMm to a positive minimum (zero/negative radius does not divide-by-zero or NaN)', () => {
    // The contract uses `Math.max(1e-6, cylinderRadiusMm)` to avoid a
    // zero-radius pathology. With r clamped to ~1e-6 and any positive mr,
    // mr will trivially exceed r so the function falls through to
    // iterDepthsMm -- no NaN, no Infinity, just the regular schedule.
    const baseline = iterDepthsMm(-2, 0.5)
    expect(computeDepthsMm(-2, 0.5, 0, true, 5)).toEqual(baseline)
    expect(computeDepthsMm(-2, 0.5, -10, true, 5)).toEqual(baseline)
    // No NaN/Infinity anywhere.
    for (const d of computeDepthsMm(-2, 0.5, 0, true, 5)) {
      expect(Number.isFinite(d)).toBe(true)
    }
  })
})
