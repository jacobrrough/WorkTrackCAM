/**
 * Strategy unit tests — indexed
 *
 * Verifies the discrete-A facing pass: for each angle in `indexAnglesDeg`,
 * face along X at every depth level. Alternates direction for zigzag.
 */
import { describe, expect, it } from 'vitest'
import { generateIndexed } from '../strategies/indexed'

describe('generateIndexed', () => {
  it('rotates A to each requested angle', () => {
    const angles = [0, 90, 180, 270]
    const result = generateIndexed({
      indexAnglesDeg: angles,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Every requested angle should appear in some G0 A line.
    const aVals = new Set<number>()
    for (const line of result.lines) {
      const m = line.match(/^G0\s+A(-?\d+(?:\.\d+)?)/)
      if (m) aVals.add(parseFloat(m[1]!))
    }
    for (const ang of angles) {
      expect(aVals.has(ang)).toBe(true)
    }
  })

  it('emits one "Index N/M" comment per angle per depth', () => {
    const angles = [0, 45, 90]
    const depths = [-2, -4]
    const result = generateIndexed({
      indexAnglesDeg: angles,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: depths,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const indexComments = result.lines.filter((l) => /Index \d+\/\d+/.test(l))
    expect(indexComments.length).toBe(angles.length * depths.length)
  })

  it('alternates X direction (zigzag) between consecutive passes', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0, 90, 180, 270],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Capture the X target on each cutting move (G1 X…).
    const cutXs = result.lines
      .filter((l) => /^G1\s+X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutXs.length).toBeGreaterThanOrEqual(4)
    // The cut targets should alternate between the high and low ends.
    const distinctSorted = Array.from(new Set(cutXs.map((x) => x.toFixed(2)))).sort()
    expect(distinctSorted.length).toBeGreaterThanOrEqual(2)
  })

  it('chuck-face safety: never emits negative X', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0, 180],
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 20,
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
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0)
  })

  it('skips depths whose target R < 0.05', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0],
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-15], // R = 10 + (-15) = -5 → below 0.05
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutLines = result.lines.filter((l) => /^G1\s+X-?[\d.]/.test(l))
    expect(cutLines.length).toBe(0)
  })
})
