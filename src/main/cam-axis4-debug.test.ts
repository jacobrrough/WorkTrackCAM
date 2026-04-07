import { describe, expect, it } from 'vitest'
import { generateCylindricalMeshRasterLines } from './cam-axis4-cylindrical-raster'

function makeFlatBox(xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number) {
  const tris: [readonly [number,number,number], readonly [number,number,number], readonly [number,number,number]][] = []
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

function makeClosedCylinder(xMin: number, xMax: number, radius: number, segments: number = 24) {
  const tris: [readonly [number,number,number], readonly [number,number,number], readonly [number,number,number]][] = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const y0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius
    const y1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius
    tris.push([[xMin, y0, z0], [xMax, y0, z0], [xMin, y1, z1]])
    tris.push([[xMax, y0, z0], [xMax, y1, z1], [xMin, y1, z1]])
    tris.push([[xMin, 0, 0], [xMin, y0, z0], [xMin, y1, z1]])
    tris.push([[xMax, 0, 0], [xMax, y1, z1], [xMax, y0, z0]])
  }
  return tris
}

describe('4axis scenarios', () => {
  it('A: box centered on X-axis', () => {
    const tris = makeFlatBox(10, 80, -5, 5, -5, 5)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`A centered: lines=${lines.length} G1=${g1.length}`)
    expect(g1.length).toBeGreaterThan(10)
  })

  it('B: box NOT centered (above X-axis)', () => {
    const tris = makeFlatBox(10, 80, 0, 20, 0, 15)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`B off-center: lines=${lines.length} G1=${g1.length}`)
    expect(g1.length).toBeGreaterThan(10)
  })

  it('C: box bigger than stock', () => {
    const tris = makeFlatBox(10, 80, -20, 20, -20, 20)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`C bigger: lines=${lines.length} G1=${g1.length}`)
    // Mesh extends beyond stock — but waterline clearing still produces
    // cuts at NO_HIT cells (clearing stock around the oversized model).
    expect(g1.length).toBeGreaterThan(0)
  })

  it('D: single depth (no roughing layers)', () => {
    const tris = makeClosedCylinder(10, 80, 10, 24)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-3],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`D single depth: lines=${lines.length} G1=${g1.length}`)
    expect(g1.length).toBeGreaterThan(10)
  })

  it('E: very shallow cut', () => {
    const tris = makeClosedCylinder(10, 80, 10, 24)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-0.5],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`E shallow: lines=${lines.length} G1=${g1.length}`)
    expect(g1.length).toBeGreaterThan(10)
  })

  it('F: mesh touching stock surface (rHit ≈ stockR)', () => {
    // Part is exactly stock size — should still produce passes to cut inward
    const tris = makeClosedCylinder(10, 80, 14.9, 24) // r≈stockR
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`F at-stock-surface: lines=${lines.length} G1=${g1.length}`)
    expect(g1.length).toBeGreaterThan(0)
  })

  it('G: mesh larger than stock emits WARNING comment in header', () => {
    // Box with Y/Z extent ±20 centered on axis, stock radius only 15mm (Ø30).
    // meshRadialMax = sqrt(20² + 20²) ≈ 28.3 mm > 15 mm → WARNING expected.
    const tris = makeFlatBox(10, 80, -20, 20, -20, 20)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 30, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    // The WARNING comment is emitted at the start of the output
    const warnLine = lines.find(l => l.includes('WARNING') && l.includes('exceeds stock radius'))
    expect(warnLine).toBeDefined()
    expect(warnLine).toContain('mesh radial max')
  })
})
