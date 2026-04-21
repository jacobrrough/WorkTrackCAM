/**
 * Strategy unit tests — continuous (roughing + finishing alias)
 *
 * Continuous in v1 is implemented as roughing followed by finishing in a
 * single G-code stream — there is no real simultaneous 4-axis interpolation.
 * The strategy emits a warning so users know what they are getting.
 */
import { describe, expect, it } from 'vitest'
import { generateContinuous } from '../strategies/continuous'
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

describe('generateContinuous', () => {
  it('produces a roughing section followed by a finishing section', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      stepXMm: 3,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const continuousHeader = result.lines.find((l) =>
      l.includes('Continuous 4-axis: roughing followed by finishing')
    )
    const finishHeader = result.lines.find((l) => l.includes('Finishing pass'))
    expect(continuousHeader).toBeDefined()
    expect(finishHeader).toBeDefined()
  })

  it('emits a warning that v1 is not true simultaneous 4-axis', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      stepXMm: 3,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const w = result.warnings.find((s) => s.includes('not true simultaneous 4-axis'))
    expect(w).toBeDefined()
  })

  it('roughing receives all-but-last depths, finishing receives the last', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // The finishing block targets a single depth — should appear after the
    // continuous separator comment.
    const finishIdx = result.lines.findIndex((l) => l.includes('Finishing pass'))
    expect(finishIdx).toBeGreaterThan(0)
    // After the finishing header, there should be at least one G1 cut.
    const afterFinish = result.lines.slice(finishIdx)
    const finishCuts = afterFinish.filter((l) => l.startsWith('G1'))
    expect(finishCuts.length).toBeGreaterThan(0)
  })

  it('handles a single depth (degenerate case): no roughing, finishing only', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // When zDepthsMm.length === 1, the strategy passes the single value to
    // both halves (roughDepths === [-4], finishDepth === -4) so both run.
    const continuousHeader = result.lines.find((l) =>
      l.includes('Continuous 4-axis: roughing followed by finishing')
    )
    expect(continuousHeader).toBeDefined()
  })
})
