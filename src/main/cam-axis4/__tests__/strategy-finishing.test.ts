/**
 * Strategy unit tests — finishing
 *
 * Ported from `cam-axis4-realworld.test.ts` "finishing with single depth
 * follows mesh surface". The new finishing strategy always operates on a
 * single deepest depth and does surface-following at the finer angular
 * stepover (default = roughingStep / 2).
 */
import { describe, expect, it } from 'vitest'
import { generateFinishing } from '../strategies/finishing'
import type { Triangle } from '../frame'

function makeBox(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number
): Triangle[] {
  const tris: Triangle[] = []
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMax, zMin]])
  tris.push([[xMin, yMin, zMin], [xMax, yMax, zMin], [xMin, yMax, zMin]])
  tris.push([[xMin, yMin, zMax], [xMax, yMax, zMax], [xMax, yMin, zMax]])
  tris.push([[xMin, yMin, zMax], [xMin, yMax, zMax], [xMax, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMin], [xMin, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMax], [xMin, yMin, zMax]])
  tris.push([[xMax, yMin, zMin], [xMax, yMax, zMax], [xMax, yMax, zMin]])
  tris.push([[xMax, yMin, zMin], [xMax, yMin, zMax], [xMax, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMax], [xMax, yMin, zMin]])
  tris.push([[xMin, yMin, zMin], [xMin, yMin, zMax], [xMax, yMin, zMax]])
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax]])
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMax], [xMin, yMax, zMax]])
  return tris
}

function extractAllXValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G[01]\s+.*X-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/X(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

describe('generateFinishing', () => {
  it('produces a high G1 count at single deepest depth', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 10,
      stepXMm: 2,
      finishDepthMm: -6,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const g1 = result.lines.filter((l) => l.startsWith('G1'))
    // Surface-following at fine angular density should yield > 100 G1 moves.
    expect(g1.length).toBeGreaterThan(100)
  })

  it('uses finer angular stepover than roughing (default = stepover/2)', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    // No explicit finishStepoverDeg → defaults to stepoverDeg/2 = 7.5°
    // → 360 / 7.5 = 48 angular passes minimum.
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      stepXMm: 3,
      finishDepthMm: -4,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('A step='))
    expect(header).toBeDefined()
    const m = header!.match(/A step=([\d.]+)°/)
    expect(m).toBeTruthy()
    const aStep = parseFloat(m![1]!)
    // Should be ≤ 7.5° (the implicit finer step), allowing for grid quantisation.
    expect(aStep).toBeLessThanOrEqual(7.6)
  })

  it('respects an explicit finishStepoverDeg', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      finishStepoverDeg: 5,
      stepXMm: 3,
      finishDepthMm: -4,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('A step='))
    expect(header).toBeDefined()
    const m = header!.match(/A step=([\d.]+)°/)
    const aStep = parseFloat(m![1]!)
    expect(aStep).toBeLessThanOrEqual(5.1)
  })

  it('chuck-face safety: never emits negative X', () => {
    const tris = makeBox(2, 30, -5, 5, -5, 5)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 30,
      stepoverDeg: 20,
      stepXMm: 3,
      finishDepthMm: -3,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const xs = extractAllXValues(result.lines)
    if (xs.length > 0) {
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    }
  })

  it('skips finishing when finish target is below cutting threshold', () => {
    // finishDepthMm well past the rotation axis → finishTargetR < 0.05
    const tris = makeBox(10, 60, -5, 5, -5, 5)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 15,
      stepXMm: 3,
      finishDepthMm: -15, // R = 10 + (-15) = -5 → below 0.05
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const skipComment = result.lines.find((l) => l.includes('Skipping finish'))
    expect(skipComment).toBeDefined()
  })
})
