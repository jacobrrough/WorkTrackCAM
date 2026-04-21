/**
 * Strategy unit tests — pattern (no-mesh fallback)
 *
 * Verifies the simple pattern-parallel routine used when no STL is provided:
 * for each Z depth, sweep A from 0 → 360 stepping by `stepoverDeg`, cutting
 * along X at each angle.
 */
import { describe, expect, it } from 'vitest'
import { generatePattern } from '../strategies/pattern'

describe('generatePattern', () => {
  it('emits one A rotation per stepover increment per depth', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 30,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // 360/30 = 12 + 1 (the inclusive end) = 13 rotations
    const aRotations = result.lines.filter((l) => /^G0\s+A-?[\d.]/.test(l))
    expect(aRotations.length).toBeGreaterThanOrEqual(12)
  })

  it('produces a header naming the strategy', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 30,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('cylindrical parallel (pattern)'))
    expect(header).toBeDefined()
  })

  it('multiple Z depths each generate a depth comment', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2, -4, -6],
      stepoverDeg: 60,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const depthComments = result.lines.filter((l) => /Z depth/.test(l))
    expect(depthComments.length).toBe(3)
  })

  it('chuck-face safety: never emits negative X', () => {
    const result = generatePattern({
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 20,
      zDepthsMm: [-2],
      stepoverDeg: 90,
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
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0)
  })

  it('skips depths whose target R < 0.05', () => {
    const result = generatePattern({
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-15], // R = 10 + (-15) = -5
      stepoverDeg: 60,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutLines = result.lines.filter((l) => /^G1\s+X-?[\d.]/.test(l))
    expect(cutLines.length).toBe(0)
  })
})
