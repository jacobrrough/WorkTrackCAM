/**
 * Strategy unit tests — roughing
 *
 * Ported from `cam-axis4-realworld.test.ts` (the centered case + envelope
 * protection cases). The new strategy receives triangles ALREADY in machine
 * frame, so the off-center / ground-plane / auto-centering cases from the
 * old tests are now covered by `frame.test.ts` instead.
 *
 * These tests assert outcome-level behavior:
 *   - mesh hits produce variable cut Z values (proves the heightmap is used)
 *   - multiple depth levels produce multiple "Roughing: depth …" comments
 *   - cut Z values stay inside `[0, stockRadius + tolerance]` even at angles
 *     where the mesh is absent (envelope protection)
 *   - chuck-face safety: no negative X anywhere
 */
import { describe, expect, it } from 'vitest'
import { generateRoughing } from '../strategies/roughing'
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
  // bottom
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMax, zMin]])
  tris.push([[xMin, yMin, zMin], [xMax, yMax, zMin], [xMin, yMax, zMin]])
  // top
  tris.push([[xMin, yMin, zMax], [xMax, yMax, zMax], [xMax, yMin, zMax]])
  tris.push([[xMin, yMin, zMax], [xMin, yMax, zMax], [xMax, yMax, zMax]])
  // -X face
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMin], [xMin, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMax], [xMin, yMin, zMax]])
  // +X face
  tris.push([[xMax, yMin, zMin], [xMax, yMax, zMax], [xMax, yMax, zMin]])
  tris.push([[xMax, yMin, zMin], [xMax, yMin, zMax], [xMax, yMax, zMax]])
  // -Y face
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMax], [xMax, yMin, zMin]])
  tris.push([[xMin, yMin, zMin], [xMin, yMin, zMax], [xMax, yMin, zMax]])
  // +Y face
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax]])
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMax], [xMin, yMax, zMax]])
  return tris
}

function extractG1ZValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G1\s+.*Z[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/Z(\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

function extractAllXValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G[01]\s+.*X-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/X(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

describe('generateRoughing', () => {
  it('centered box: gets mesh hits, variable Z depths', () => {
    // Box centered on the rotation axis: Y∈[-8,8], Z∈[-8,8]
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateRoughing({
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
    const g1 = result.lines.filter((l) => l.startsWith('G1'))
    const zVals = extractG1ZValues(result.lines)
    expect(g1.length).toBeGreaterThan(10)
    // Variable Z values prove the mesh heightmap is feeding the cut depths.
    const uniqueZ = new Set(zVals.map((z) => z.toFixed(2)))
    expect(uniqueZ.size).toBeGreaterThan(2)
  })

  it('produces multiple depth levels', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateRoughing({
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
    const roughComments = result.lines.filter((l) => l.includes('Roughing: depth'))
    expect(roughComments.length).toBeGreaterThanOrEqual(2)
  })

  it('mesh-envelope protection: cut Z stays inside stock cylinder', () => {
    // Small partial mesh: the upper half only, Y∈[-4,4], Z∈[0,8].
    // At angles where the mesh is absent the engine cuts at the waterline
    // depth — but it must never produce a Z deeper than `stockRadius + tol`.
    const tris = makeBox(10, 80, -4, 4, 0, 8)
    const cylinderDiameterMm = 40
    const toolDiameterMm = 3.175
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-10, -15],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 15,
      toolDiameterMm
    })
    const zVals = extractG1ZValues(result.lines)
    expect(zVals.length).toBeGreaterThan(0)
    const cylR = cylinderDiameterMm / 2
    const minZ = Math.min(...zVals)
    const maxZ = Math.max(...zVals)
    expect(minZ).toBeGreaterThanOrEqual(0)
    expect(maxZ).toBeLessThanOrEqual(cylR + toolDiameterMm)
  })

  it('chuck-face safety: never emits negative X', () => {
    const tris = makeBox(2, 20, -5, 5, -5, 5)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 20,
      stepoverDeg: 30,
      stepXMm: 3,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const xs = extractAllXValues(result.lines)
    expect(xs.length).toBeGreaterThan(0)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
  })

  it('emits a comment header naming the strategy', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('cylindrical roughing'))
    expect(header).toBeDefined()
  })

  it('returns warnings array (may be empty for nominal jobs)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    expect(Array.isArray(result.warnings)).toBe(true)
  })
})
