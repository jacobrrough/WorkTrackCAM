/**
 * Strategy unit tests — contour wrapping
 *
 * Verifies the 2D-contour-to-cylinder mapping: A = (yMm / πD) × 360°.
 */
import { describe, expect, it } from 'vitest'
import { generateContour } from '../strategies/contour'

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
    // Should still produce a header + retract + return-home, no G1 cuts.
    const g1Cuts = result.lines.filter((l) => l.startsWith('G1') && /Z[\d.]/.test(l))
    expect(g1Cuts.length).toBe(0)
  })

  it('clamps X to the machinable span', () => {
    // Two points outside the span — both should be clamped.
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
    // Extract every X token from G0/G1 lines and verify all in [10, 80].
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

  it('linear Y → angular A: half a circumference maps to ~180°', () => {
    // Using half a circumference avoids the 0°/360° aliasing trap
    // (shortest-path would collapse 0→360 to a zero-delta move).
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
    // Find every A token (G0 A… or G1 …A…) and capture the maximum value.
    const aVals = result.lines
      .flatMap((l) => {
        const m = l.match(/A(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(aVals.length).toBeGreaterThan(0)
    expect(Math.max(...aVals)).toBeCloseTo(180, 0)
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
