/**
 * Tests for `kinematics.ts` — A-axis math used by the emitter.
 */
import { describe, expect, it } from 'vitest'
import { adaptFeedForAngularVelocity, arcLengthMm, shortestAngularPath } from '../kinematics'

describe('shortestAngularPath', () => {
  it('returns 0 for identical angles', () => {
    expect(shortestAngularPath(90, 90)).toBe(0)
  })

  it('takes the short way around (358° → 2° = +4°, not -356°)', () => {
    expect(shortestAngularPath(358, 2)).toBeCloseTo(4, 6)
  })

  it('handles negative shortest paths (350 → 0 = -350+360 = +10... actually -10? no)', () => {
    // 350 → 0: forward = -350 + 360 = 10° (counterclockwise back); backward = 0 - 350 = -350.
    // Shortest signed delta: -350 wraps to +10 in (-180, 180].
    expect(shortestAngularPath(350, 0)).toBeCloseTo(10, 6)
  })

  it('handles wrap-around in the opposite direction (10 → 350 = -20)', () => {
    expect(shortestAngularPath(10, 350)).toBeCloseTo(-20, 6)
  })

  it('handles 180° (the boundary case) consistently', () => {
    // -180 maps to +180 by convention.
    expect(shortestAngularPath(0, 180)).toBeCloseTo(180, 6)
    expect(shortestAngularPath(180, 0)).toBeCloseTo(180, 6)
  })

  it('handles arbitrary numeric inputs (>360)', () => {
    expect(shortestAngularPath(720, 730)).toBeCloseTo(10, 6)
    expect(shortestAngularPath(-90, 90)).toBeCloseTo(180, 6)
  })
})

describe('arcLengthMm', () => {
  it('zero degrees → zero arc length', () => {
    expect(arcLengthMm(0, 25)).toBe(0)
  })

  it('360° at radius 10 → 2π × 10 ≈ 62.83 mm', () => {
    expect(arcLengthMm(360, 10)).toBeCloseTo(2 * Math.PI * 10, 3)
  })

  it('uses the absolute value of the angle (no negative arc lengths)', () => {
    expect(arcLengthMm(-90, 10)).toBeCloseTo(arcLengthMm(90, 10), 6)
  })

  it('zero radius → zero arc length', () => {
    expect(arcLengthMm(180, 0)).toBe(0)
  })
})

describe('adaptFeedForAngularVelocity', () => {
  it('passes through the requested feed when no rotation', () => {
    const r = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 1500,
      deltaADeg: 0,
      linearDistMm: 10,
      stockDiameterMm: 40,
      maxRotaryRpm: 20
    })
    expect(r.feedMmMin).toBe(1500)
    expect(r.throttled).toBe(false)
  })

  it('passes through the requested feed when below the angular limit', () => {
    // Pure rotation, large stock, slow feed → easily within 20 RPM
    const r = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 100,
      deltaADeg: 5,
      linearDistMm: 0,
      stockDiameterMm: 100,
      maxRotaryRpm: 20
    })
    expect(r.feedMmMin).toBe(100)
    expect(r.throttled).toBe(false)
  })

  it('throttles a pure rotation that would exceed max RPM', () => {
    // Pure rotation: requested F = 10000 mm/min on a 10 mm stock would yield
    //   angVel = 10000 * 360 / (π * 10) ≈ 114,591 deg/min ≈ 318 RPM
    // Cap at 20 RPM (= 7200 deg/min):
    //   F_max = 7200 * π * 10 / 360 ≈ 628.3 mm/min
    const r = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 10_000,
      deltaADeg: 30,
      linearDistMm: 0,
      stockDiameterMm: 10,
      maxRotaryRpm: 20
    })
    expect(r.throttled).toBe(true)
    expect(r.feedMmMin).toBeLessThan(700)
    expect(r.feedMmMin).toBeGreaterThan(600)
    expect(r.warning).toMatch(/reduced/)
  })

  it('throttles a combined XYZ + A move that would exceed max RPM', () => {
    // Combined: requested F = 5000 mm/min on a 1 mm linear move with 90° A change.
    //   angVel = 90 * 5000 / 1 = 450,000 deg/min → way too fast.
    // Cap: F_max = maxDegPerMin * linearDist / dA = 7200 * 1 / 90 = 80 mm/min.
    const r = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 5000,
      deltaADeg: 90,
      linearDistMm: 1,
      stockDiameterMm: 40,
      maxRotaryRpm: 20
    })
    expect(r.throttled).toBe(true)
    expect(r.feedMmMin).toBeLessThan(85)
    expect(r.feedMmMin).toBeGreaterThan(75)
  })

  it('does not throttle below 1 mm/min (floor for safety)', () => {
    const r = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 100,
      deltaADeg: 360,
      linearDistMm: 0.001,
      stockDiameterMm: 40,
      maxRotaryRpm: 1
    })
    expect(r.feedMmMin).toBeGreaterThanOrEqual(1)
  })
})
