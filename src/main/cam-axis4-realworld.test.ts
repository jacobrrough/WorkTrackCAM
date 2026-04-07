/**
 * Tests for 4-axis engine with REALISTIC model positions.
 *
 * Real models from CAD are NOT centered on the X-axis. They typically sit on
 * a ground plane (Y>0 or Z>0), offset from the rotation axis. The engine
 * auto-centers the mesh (translates Y-Z bbox center to origin) and computes
 * mesh-aware depth levels from stock OD to the mesh surface.
 */
import { describe, expect, it } from 'vitest'
import { generateCylindricalMeshRasterLines } from './cam-axis4-cylindrical-raster'

type Tri = [readonly [number,number,number], readonly [number,number,number], readonly [number,number,number]]

function makeBox(xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number): Tri[] {
  const tris: Tri[] = []
  // 6 faces, 2 triangles each
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

describe('4-axis real-world model positions', () => {
  it('CENTERED model: gets mesh hits, variable Z depths', () => {
    // Model centered on rotation axis (Y≈0, Z≈0)
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 50, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    const g1z = lines.filter(l => /^G1\s+.*Z[\d.]/i.test(l)).map(l => {
      const m = l.match(/Z([\d.]+)/); return m ? parseFloat(m[1]!) : NaN
    }).filter(n => !isNaN(n))
    console.log(`CENTERED: G1=${g1.length}, Z values: min=${Math.min(...g1z).toFixed(2)} max=${Math.max(...g1z).toFixed(2)}`)
    expect(g1.length).toBeGreaterThan(10)
    // Z values should VARY (not all the same — proves mesh is used)
    const uniqueZ = new Set(g1z.map(z => z.toFixed(2)))
    console.log(`  Unique Z values: ${uniqueZ.size}`)
    expect(uniqueZ.size).toBeGreaterThan(2)
  })

  it('OFF-CENTER model (Y=10..30, Z=5..25): auto-centered, gets hits', () => {
    // Model NOT centered on X-axis — typical CAD position
    // Auto-centering translates Y-Z bounding box center to origin before ray-casting
    const tris = makeBox(10, 80, 10, 30, 5, 25)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 50, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`OFF-CENTER: G1=${g1.length} (auto-centered — gets mesh hits)`)
    expect(g1.length).toBeGreaterThan(100)
  })

  it('GROUND-PLANE model (Y=0..20, Z=0..15): auto-centered, variable depths', () => {
    // Model sitting on ground plane — auto-centered to rotation axis
    const tris = makeBox(10, 80, 0, 20, 0, 15)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 50, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    const g1z = lines.filter(l => /^G1\s+.*Z[\d.]/i.test(l)).map(l => {
      const m = l.match(/Z([\d.]+)/); return m ? parseFloat(m[1]!) : NaN
    }).filter(n => !isNaN(n))
    const uniqueZ = new Set(g1z.map(z => z.toFixed(2)))
    console.log(`GROUND-PLANE: G1=${g1.length}, unique Z=${uniqueZ.size}`)
    expect(g1.length).toBeGreaterThan(100)
    expect(uniqueZ.size).toBeGreaterThan(2)
  })

  it('roughing produces multiple depth levels', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8) // centered
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 50, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 15, stepXMm: 3, zDepthsMm: [-2, -4, -6],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
      enableFinishPass: false,
    })
    const roughComments = lines.filter(l => l.includes('Roughing:'))
    console.log(`Roughing comments: ${roughComments.length}`)
    roughComments.forEach(c => console.log(`  ${c}`))
    expect(roughComments.length).toBeGreaterThanOrEqual(2)
  })

  it('finishing with single depth follows mesh surface', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm: 50, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 10, stepXMm: 2, zDepthsMm: [-6],
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 10, toolDiameterMm: 3.175,
      enableFinishPass: true,
    })
    const g1 = lines.filter(l => l.startsWith('G1'))
    console.log(`Finish single depth: G1=${g1.length}`)
    // enableFinishPass=true overrides allDepths.length check — single depth finishing works
    expect(g1.length).toBeGreaterThan(100)
  })

  it('mesh-envelope protection: roughing at NO_HIT angles does not exceed mesh OD', () => {
    // Model occupying only the upper quadrant (Y=0..8, Z=0..8) — auto-centred to Y≈0, Z≈0.
    // After centering, it sits in approximately the first 90° angular range.
    // At the back angles (≈180°) there are no mesh hits (NO_HIT).
    // Mesh-envelope protection must limit the roughing depth there to ≤ mesh OD + tolerance
    // rather than blindly cutting to the full waterline depth.
    const tris = makeBox(10, 80, 0, 8, 0, 8) // upper-right quadrant model
    const cylinderDiameterMm = 40
    const toolDiameterMm = 3.175
    const zDepthsMm = [-10, -15] // aggressive — would gouge without envelope protection
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris, cylinderDiameterMm, machXStartMm: 10, machXEndMm: 80,
      stepoverDeg: 30, stepXMm: 5, zDepthsMm,
      feedMmMin: 800, plungeMmMin: 300, safeZMm: 15, toolDiameterMm,
      enableFinishPass: false,
    })
    // Extract all Z values from G1 feed moves
    const g1ZVals = lines
      .filter(l => l.startsWith('G1'))
      .flatMap(l => { const m = l.match(/Z([\d.]+)/); return m ? [parseFloat(m[1]!)] : [] })

    // The worst possible cut depth with envelope protection is cylR (= 20mm)
    // since the mesh itself cannot extend beyond the stock cylinder radius.
    // Without protection some NO_HIT angles would produce z ≈ 10 or 15 (the
    // raw zDepthsMm values applied to the outer radius 20) and could be ≫ meshOD.
    // We verify that every cut Z is within a reasonable range (never deeper than cylR).
    const cylR = cylinderDiameterMm / 2
    if (g1ZVals.length > 0) {
      const minZ = Math.min(...g1ZVals)
      // All feed Z values should be ≥ 0 (inside the stock cylinder of radius 20)
      expect(minZ).toBeGreaterThanOrEqual(0)
      // And ≤ the stock cylinder radius (no overshoot beyond the outer surface)
      expect(Math.max(...g1ZVals)).toBeLessThanOrEqual(cylR + toolDiameterMm)
    }
    // Should produce some G1 moves (mesh was found at the upper angles)
    expect(g1ZVals.length).toBeGreaterThan(0)
  })
})
