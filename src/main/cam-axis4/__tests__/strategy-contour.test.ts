/**
 * Strategy unit tests -- contour wrapping.
 *
 * Verifies the 2D-contour-to-cylinder mapping: A = (yMm / (pi*D)) * 360 deg.
 */
import { describe, expect, it } from 'vitest'
import { FULL_WRAP_SPLIT_DEG, generateContour } from '../strategies/contour'

describe('generateContour', () => {
  it('emits a header naming the strategy and the diameter', () => {
    const pts: Array<[number, number]> = [
      [10, 0],
      [40, 50],
      [70, 100]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('contour wrapping'))
    expect(header).toBeDefined()
    expect(header).toContain('D=50')
  })

  it('handles an empty contour gracefully', () => {
    const result = generateContour({
      contourPoints: [],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const g1Cuts = result.lines.filter((l) => l.startsWith('G1') && /Z[\d.]/.test(l))
    expect(g1Cuts.length).toBe(0)
  })

  it('clamps X to the machinable span', () => {
    const pts: Array<[number, number]> = [
      [-50, 0],
      [200, 0]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const xs = result.lines
      .filter((l) => /^G[01]\s+.*X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-3)
      expect(x).toBeLessThanOrEqual(80 + 1e-3)
    }
  })

  it('linear Y to angular A: half a circumference maps to ~180 deg', () => {
    const D = 50
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [40, 0],
      [40, circumference / 2]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const aVals = result.lines.flatMap((l) => {
      const m = l.match(/A(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    expect(aVals.length).toBeGreaterThan(0)
    expect(Math.max(...aVals)).toBeCloseTo(180, 0)
  })

  it('full-wrap Y span emits A-words reaching 360 deg (roadmap [ID-0010])', () => {
    const D = 50
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [40, 0],
      [40, circumference]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const aVals = result.lines.flatMap((l) => {
      const m = l.match(/A(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    expect(aVals.length).toBeGreaterThan(1)
    expect(aVals.some((a) => Math.abs(a - 360) < 1e-3)).toBe(true)

    const cutAs = result.lines
      .filter((l) => /^G1\b.*\bA-?\d/.test(l))
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutAs.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < cutAs.length; i++) {
      expect(cutAs[i]!).toBeGreaterThan(cutAs[i - 1]! - 1e-6)
    }
    let prev = 0
    for (const a of cutAs) {
      expect(Math.abs(a - prev)).toBeLessThanOrEqual(FULL_WRAP_SPLIT_DEG + 1e-3)
      prev = a
    }
  })

  it('multi-wrap Y span (2x) emits cumulative A reaching 720 deg with no aliasing', () => {
    const D = 40
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [25, 0],
      [25, 2 * circumference]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-1.5],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutAs = result.lines
      .filter((l) => /^G1\b.*\bA-?\d/.test(l))
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutAs.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < cutAs.length; i++) {
      expect(cutAs[i]!).toBeGreaterThan(cutAs[i - 1]! - 1e-6)
    }
    expect(Math.abs(cutAs.at(-1)! - 720)).toBeLessThan(1e-3)
    let prev = 0
    for (const a of cutAs) {
      expect(Math.abs(a - prev)).toBeLessThanOrEqual(FULL_WRAP_SPLIT_DEG + 1e-3)
      prev = a
    }
  })

  it('reverse-wrap (negative Y sweep) subdivides symmetrically', () => {
    const D = 30
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [30, circumference],
      [30, 0]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-1],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutAs = result.lines
      .filter((l) => /^G1\b.*\bA-?\d/.test(l))
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutAs.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < cutAs.length; i++) {
      expect(cutAs[i]!).toBeLessThan(cutAs[i - 1]! + 1e-6)
    }
    expect(Math.abs(cutAs.at(-1)! - 0)).toBeLessThan(1e-3)
  })

  it('triple-wrap Y span (3x) emits cumulative A reaching 1080 deg with monotonic sub-FULL_WRAP_SPLIT_DEG steps -- DISCOVERED-2026-04-25 [ID-0010b]', () => {
    // Pins the > 360 deg multi-wrap path at the strategy-unit layer beyond
    // the existing 2x-wrap test. Three full wraps amplify any latent
    // mod-360 / shortest-path aliasing into a 1080 deg cumulative sweep.
    const D = 25
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [20, 0],
      [20, 3 * circumference]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-1.0],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutAs = result.lines
      .filter((l) => /^G1\b.*\bA-?\d/.test(l))
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    // 1080 / 170 -> 7 sub-segments minimum (ceil(1080/170)=7).
    expect(cutAs.length).toBeGreaterThanOrEqual(7)
    for (let i = 1; i < cutAs.length; i++) {
      expect(cutAs[i]!).toBeGreaterThan(cutAs[i - 1]! - 1e-6)
    }
    expect(Math.abs(cutAs.at(-1)! - 1080)).toBeLessThan(1e-3)
    let prev = 0
    for (const a of cutAs) {
      expect(Math.abs(a - prev)).toBeLessThanOrEqual(FULL_WRAP_SPLIT_DEG + 1e-3)
      prev = a
    }
  })

  it('fractional multi-wrap Y span (1.5x = 540 deg) subdivides without snapping to a multiple of FULL_WRAP_SPLIT_DEG -- DISCOVERED-2026-04-25 [ID-0010b]', () => {
    // 540 deg is NOT a multiple of FULL_WRAP_SPLIT_DEG (170): the strategy
    // must emit sub-segments whose final A lands EXACTLY on the
    // caller-requested 540, not on a rounded-to-step value. ceil(540/170)
    // = 4 sub-segments of 135 deg each.
    const D = 32
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [22, 0],
      [22, 1.5 * circumference]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-1.0],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutAs = result.lines
      .filter((l) => /^G1\b.*\bA-?\d/.test(l))
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    // ceil(540/170) = 4 sub-segments, so 4 cut A samples on this single Z pass.
    expect(cutAs.length).toBe(4)
    expect(Math.abs(cutAs.at(-1)! - 540)).toBeLessThan(1e-3)
    // Each step is exactly 540/4 = 135 deg -- well below FULL_WRAP_SPLIT_DEG.
    expect(Math.abs(cutAs[0]! - 135)).toBeLessThan(1e-3)
    expect(Math.abs(cutAs[1]! - 270)).toBeLessThan(1e-3)
    expect(Math.abs(cutAs[2]! - 405)).toBeLessThan(1e-3)
    expect(Math.abs(cutAs[3]! - 540)).toBeLessThan(1e-3)
  })

  it('reverse multi-wrap Y span (-2x = -720 deg) subdivides symmetrically with monotonic decreasing A -- DISCOVERED-2026-04-25 [ID-0010b]', () => {
    // The existing reverse-wrap test only covers a single -360 sweep.
    // This pins -720 deg so a future regression that drops the sign of
    // the sub-segment interpolation in negative-direction multi-wraps
    // would be caught.
    const D = 28
    const circumference = Math.PI * D
    const pts: Array<[number, number]> = [
      [25, 2 * circumference],
      [25, 0]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: D,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-1.0],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutAs = result.lines
      .filter((l) => /^G1\b.*\bA-?\d/.test(l))
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutAs.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < cutAs.length; i++) {
      expect(cutAs[i]!).toBeLessThan(cutAs[i - 1]! + 1e-6)
    }
    expect(Math.abs(cutAs.at(-1)! - 0)).toBeLessThan(1e-3)
    // The first cut A is at the START of the reverse sweep (after plunge),
    // which the emitter rotates to the absolute starting A = 720 deg
    // before plunging. So the first feed A should be the first sub-step,
    // i.e. 720 - 720/ceil(720/170) ≈ 720 - 720/5 = 576 deg.
    const firstStep = 720 / Math.ceil(720 / FULL_WRAP_SPLIT_DEG)
    expect(Math.abs(cutAs[0]! - (720 - firstStep))).toBeLessThan(1e-3)
  })

  it('multiple Z depths each generate a "contour at Z_pass=" comment', () => {
    const pts: Array<[number, number]> = [
      [20, 0],
      [60, 0]
    ]
    const result = generateContour({
      contourPoints: pts,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const depthComments = result.lines.filter((l) => l.includes('contour at Z_pass='))
    expect(depthComments.length).toBe(3)
  })
})
