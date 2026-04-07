/**
 * Verify roughing covers the full machinable X range and all 360° angles,
 * not just where the mesh has hits.
 */
import { describe, expect, it } from 'vitest'
import { generateCylindricalMeshRasterLines, surfaceStepoverDegFromMm } from './cam-axis4-cylindrical-raster'

type Tri = [readonly [number,number,number], readonly [number,number,number], readonly [number,number,number]]

function makeBox(xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number): Tri[] {
  const tris: Tri[] = []
  tris.push([[xMin,yMin,zMin],[xMax,yMin,zMin],[xMax,yMax,zMin]])
  tris.push([[xMin,yMin,zMin],[xMax,yMax,zMin],[xMin,yMax,zMin]])
  tris.push([[xMin,yMin,zMax],[xMax,yMax,zMax],[xMax,yMin,zMax]])
  tris.push([[xMin,yMin,zMax],[xMin,yMax,zMax],[xMax,yMax,zMax]])
  tris.push([[xMin,yMin,zMin],[xMin,yMax,zMin],[xMin,yMax,zMax]])
  tris.push([[xMin,yMin,zMin],[xMin,yMax,zMax],[xMin,yMin,zMax]])
  tris.push([[xMax,yMin,zMin],[xMax,yMax,zMax],[xMax,yMax,zMin]])
  tris.push([[xMax,yMin,zMin],[xMax,yMin,zMax],[xMax,yMax,zMax]])
  tris.push([[xMin,yMin,zMin],[xMax,yMin,zMax],[xMax,yMin,zMin]])
  tris.push([[xMin,yMin,zMin],[xMin,yMin,zMax],[xMax,yMin,zMax]])
  tris.push([[xMin,yMax,zMin],[xMax,yMax,zMin],[xMax,yMax,zMax]])
  tris.push([[xMin,yMax,zMin],[xMax,yMax,zMax],[xMin,yMax,zMax]])
  return tris
}

describe('4-axis roughing coverage', () => {
  it('roughing covers full machinable X range even where mesh is narrow', () => {
    // Small box (X=40..50) on a large machinable range (X=10..80)
    // Roughing should still cut the full X=10..80 range at every angle
    const tris = makeBox(40, 50, -5, 5, -5, 5)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 50, // diameter=50 → radius=25
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 3,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
    })

    // Extract all X coordinates from G1 moves
    const g1x: number[] = []
    for (const l of lines) {
      if (l.startsWith('G1') || l.startsWith('G0 X')) {
        const m = l.match(/X([-\d.]+)/)
        if (m) g1x.push(parseFloat(m[1]!))
      }
    }

    const xMin = Math.min(...g1x)
    const xMax = Math.max(...g1x)
    console.log(`X coverage: ${xMin.toFixed(1)} to ${xMax.toFixed(1)} (machinable: 10..80)`)

    // Roughing should extend close to the full 10..80 range (minus/plus overcut)
    expect(xMin).toBeLessThan(12) // Should start near machXStart
    expect(xMax).toBeGreaterThan(78) // Should extend near machXEnd
  })

  it('roughing covers all 360° angles', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 3,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
    })

    // Extract all A angles from G0/G1 moves containing A words
    const angles = new Set<string>()
    for (const l of lines) {
      const m = l.match(/^G[01]\b.*\bA([\d.]+)/)
      if (m) angles.add(m[1]!)
    }

    console.log(`Angles covered: ${angles.size} unique: ${[...angles].sort((a,b) => +a - +b).join(', ')}`)

    // With stepoverDeg=30 → 12 roughing angles; finishing may add more.
    // At minimum, all 12 roughing angles must be present.
    expect(angles.size).toBeGreaterThanOrEqual(12)
  })
})

describe('surfaceStepoverDegFromMm', () => {
  it('returns 1° for a 1mm step on a 1/(π/180) ≈ 57.3mm radius cylinder', () => {
    // arc_length = radius × θ(rad) → θ = arc / r
    // For θ=1°: arc = r × π/180 → r = arc × 180/π
    // If arc=1mm, r = 180/π ≈ 57.296mm → θ = 1°
    const r = 180 / Math.PI
    expect(surfaceStepoverDegFromMm(r, 1)).toBeCloseTo(1, 5)
  })

  it('returns 11.46° for a 5mm step on a 25mm radius cylinder', () => {
    // θ = (5/25) × (180/π) = 0.2 × 57.296 ≈ 11.459°
    expect(surfaceStepoverDegFromMm(25, 5)).toBeCloseTo((5 / 25) * (180 / Math.PI), 4)
  })

  it('scales inversely with radius — larger radius yields smaller angle for same arc', () => {
    const small = surfaceStepoverDegFromMm(10, 2)
    const large = surfaceStepoverDegFromMm(50, 2)
    expect(small).toBeGreaterThan(large)
  })

  it('scales linearly with arc length — larger arc yields proportionally larger angle', () => {
    const step1 = surfaceStepoverDegFromMm(25, 1)
    const step4 = surfaceStepoverDegFromMm(25, 4)
    expect(step4).toBeCloseTo(step1 * 4, 5)
  })

  it('clamps output to minimum 0.1°', () => {
    // Near-zero arc on a very large cylinder should not go below 0.1°
    expect(surfaceStepoverDegFromMm(1e6, 0.001)).toBeCloseTo(0.1, 5)
  })

  it('clamps output to maximum 180°', () => {
    // Huge arc on a tiny cylinder should not exceed 180°
    expect(surfaceStepoverDegFromMm(1, 1e6)).toBeCloseTo(180, 5)
  })

  it('zero/negative radius is clamped to minimum, preventing division by zero', () => {
    // Zero and negative radii must not throw — clamp to 1e-6
    const r0 = surfaceStepoverDegFromMm(0, 2)
    const rNeg = surfaceStepoverDegFromMm(-10, 2)
    expect(Number.isFinite(r0)).toBe(true)
    expect(Number.isFinite(rNeg)).toBe(true)
    expect(r0).toBeLessThanOrEqual(180)
    expect(rNeg).toBeLessThanOrEqual(180)
  })

  it('zero/negative stepover is clamped to minimum, not zero or NaN', () => {
    const s0 = surfaceStepoverDegFromMm(25, 0)
    const sNeg = surfaceStepoverDegFromMm(25, -5)
    expect(Number.isFinite(s0)).toBe(true)
    expect(s0).toBeGreaterThanOrEqual(0.1)
    expect(sNeg).toBeGreaterThanOrEqual(0.1)
  })

  it('round-trips via arc-length formula: arc = radius × θ(rad)', () => {
    // Given arc and radius, get degrees, convert back to arc and compare
    const radius = 30
    const arcMm = 3
    const deg = surfaceStepoverDegFromMm(radius, arcMm)
    const radians = deg * (Math.PI / 180)
    const arcBack = radius * radians
    expect(arcBack).toBeCloseTo(arcMm, 4)
  })
})
