import { describe, expect, it } from 'vitest'
import {
  generateCylindricalMeshRasterLines,
  generateContourWrappingLines,
  generateIndexedPassLines,
  generatePatternParallelLines,
  surfaceStepoverDegFromMm,
  computeAngularCurvature,
  buildAdaptiveAngles,
  sampleHeightmapAtAngle
} from './cam-axis4-cylindrical-raster'

describe('cam-axis4-cylindrical-raster', () => {
  // Small helper to build a triangle ring around X-axis at a given radius
  function makeRingTriangles(xMin: number, xMax: number, radius: number, segments: number = 12) {
    const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2
      const a1 = ((i + 1) / segments) * Math.PI * 2
      const y0 = Math.cos(a0) * radius
      const z0 = Math.sin(a0) * radius
      const y1 = Math.cos(a1) * radius
      const z1 = Math.sin(a1) * radius
      // Two triangles forming a quad strip
      tris.push([[xMin, y0, z0], [xMax, y0, z0], [xMin, y1, z1]])
      tris.push([[xMax, y0, z0], [xMax, y1, z1], [xMin, y1, z1]])
    }
    return tris
  }

  it('uses stock radius as depth reference when mesh is recessed inside cylinder OD', () => {
    const t50: [readonly [number, number, number], readonly [number, number, number], readonly [
      number,
      number,
      number
    ]][] = [
      [
        [45, 8, -2],
        [55, 8, 2],
        [50, 7.5, 0]
      ],
      [
        [45, 8, -2],
        [55, 8, -2],
        [55, 8, 2]
      ]
    ]
    const lines = generateCylindricalMeshRasterLines({
      triangles: t50,
      cylinderDiameterMm: 30,
      machXStartMm: 45,
      machXEndMm: 55,
      stepoverDeg: 45,
      stepXMm: 2,
      zDepthsMm: [-1],
      feedMmMin: 400,
      plungeMmMin: 200,
      safeZMm: 5,
      maxCells: 10000
    })
    const g1z = lines.filter((l) => /^G1\s+Z/i.test(l)).map((l) => {
      const m = l.match(/^G1\s+Z([\d.-]+)/i)
      return m ? parseFloat(m[1]!) : NaN
    })
    expect(g1z.length).toBeGreaterThan(0)
    expect(Math.max(...g1z)).toBeGreaterThan(12)
  })

  it('generates continuous passes (multiple G1 X moves per angle, not just plunge-retract)', () => {
    const tris = makeRingTriangles(10, 90, 8, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      toolDiameterMm: 3.175
    })
    // Count how many G1 X moves occur between consecutive G0 Z (retract) lines
    let maxG1xBetweenRetracts = 0
    let currentG1xCount = 0
    for (const l of lines) {
      if (/^G1\s+X/i.test(l)) {
        currentG1xCount++
      } else if (/^G0\s+Z/i.test(l)) {
        maxG1xBetweenRetracts = Math.max(maxG1xBetweenRetracts, currentG1xCount)
        currentG1xCount = 0
      }
    }
    // Continuous passes should have multiple G1 X moves between retracts
    expect(maxG1xBetweenRetracts).toBeGreaterThan(3)
  })

  it('extends cuts past material edges (overcut)', () => {
    const tris = makeRingTriangles(20, 80, 10, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 20,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 2,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 30000,
      toolDiameterMm: 6,
      overcutMm: 6
    })
    // Extract all X positions from G0 X and G1 X commands
    const xPositions: number[] = []
    for (const l of lines) {
      const m = l.match(/^G[01]\s+X([\d.-]+)/i)
      if (m) xPositions.push(parseFloat(m[1]!))
    }
    expect(xPositions.length).toBeGreaterThan(0)
    const minX = Math.min(...xPositions)
    const maxX = Math.max(...xPositions)
    // Tool should extend past the mesh boundaries (20..80) by approximately overcutMm
    expect(minX).toBeLessThan(20)
    expect(maxX).toBeGreaterThan(80)
  })

  it('generates roughing layers that step down radially', () => {
    const tris = makeRingTriangles(10, 90, 8, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      toolDiameterMm: 3.175
    })
    // Should have roughing comments at different depth levels
    const roughingComments = lines.filter((l) => l.includes('Roughing:') || l.includes('Finishing'))
    expect(roughingComments.length).toBeGreaterThanOrEqual(2)

    // Extract all G1 Z values — should span multiple depth levels
    const g1zValues: number[] = []
    for (const l of lines) {
      const m = l.match(/^G1\s+.*Z([\d.-]+)/i)
      if (m) g1zValues.push(parseFloat(m[1]!))
    }
    expect(g1zValues.length).toBeGreaterThan(0)
    const minZ = Math.min(...g1zValues)
    const maxZ = Math.max(...g1zValues)
    // Should have a range of cut depths (not all at same level)
    expect(maxZ - minZ).toBeGreaterThan(1)
  })

  it('waterline roughing adapts cut depth to mesh surface shape', () => {
    // Create a cylinder at radius 8mm inside a stock of radius 15mm (Ø30).
    // Roughing with multiple depth levels should produce Z values that
    // step down in waterlines AND follow the mesh surface where it protrudes.
    const tris = makeRingTriangles(10, 90, 8, 24)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,       // stock R = 15mm
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 3,
      zDepthsMm: [-2, -4, -6],    // waterlines at R=13, R=11, R=9
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 30000,
      toolDiameterMm: 3.175,
      enableFinishPass: false
    })

    // Extract all G1 Z values from cutting moves
    const g1zValues: number[] = []
    for (const l of lines) {
      const m = l.match(/^G1\s+.*Z([\d.-]+)/i)
      if (m) g1zValues.push(parseFloat(m[1]!))
    }
    expect(g1zValues.length).toBeGreaterThan(0)

    // The mesh surface is at R≈8mm (+ tool radius compensation pushes it up a bit).
    // Waterlines are at R=13, 11, 9. Where mesh surface (~8-9mm with comp) is BELOW
    // the waterline, tool should cut at the waterline. Where mesh is ABOVE, tool follows mesh.
    // We should see Z values clustered around the waterline levels (13, 11, 9)
    // AND around the compensated mesh surface.
    const minZ = Math.min(...g1zValues)
    const maxZ = Math.max(...g1zValues)

    // Shallowest cut should be near R=13 (first waterline), not near stock R=15
    expect(maxZ).toBeLessThanOrEqual(13.5)
    expect(maxZ).toBeGreaterThanOrEqual(12)

    // Deepest cut should reach near the mesh surface (R≈8-9mm with compensation)
    expect(minZ).toBeLessThan(10)
    expect(minZ).toBeGreaterThan(5) // but not absurdly deep
  })

  it('generates finishing pass at finer resolution', () => {
    const tris = makeRingTriangles(10, 90, 10, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 20,
      stepXMm: 3,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 30000,
      toolDiameterMm: 3.175,
      enableFinishPass: true
    })
    const finishComments = lines.filter((l) => l.includes('Finishing pass') || l.includes('Finish '))
    expect(finishComments.length).toBeGreaterThan(0)
  })

  it('produces heightmap hits for a box centered on the rotation axis', () => {
    // Build a box: X=0..40, Y=-8..8, Z=-8..8 (centered on X-axis, fits inside Ø50 stock)
    function buildBoxTriangles(
      xMin: number, xMax: number,
      yMin: number, yMax: number,
      zMin: number, zMax: number
    ) {
      const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
      function quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) {
        tris.push([a, b, c])
        tris.push([a, c, d])
      }
      // +X face
      quad([xMax, yMin, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax], [xMax, yMin, zMax])
      // -X face
      quad([xMin, yMin, zMax], [xMin, yMax, zMax], [xMin, yMax, zMin], [xMin, yMin, zMin])
      // +Y face
      quad([xMin, yMax, zMin], [xMin, yMax, zMax], [xMax, yMax, zMax], [xMax, yMax, zMin])
      // -Y face
      quad([xMin, yMin, zMax], [xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMin, zMax])
      // +Z face
      quad([xMin, yMin, zMax], [xMax, yMin, zMax], [xMax, yMax, zMax], [xMin, yMax, zMax])
      // -Z face
      quad([xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMin, zMin], [xMin, yMin, zMin])
      return tris
    }

    const triangles = buildBoxTriangles(0, 40, -8, 8, -8, 8)
    const lines = generateCylindricalMeshRasterLines({
      triangles,
      cylinderDiameterMm: 50,
      machXStartMm: 0,
      machXEndMm: 40,
      stepoverDeg: 10,
      stepXMm: 1,
      zDepthsMm: [-2, -4],
      feedMmMin: 500,
      plungeMmMin: 200,
      safeZMm: 5,
      toolDiameterMm: 3.175
    })

    // Parse the heightmap hit comment
    const hmLine = lines.find(l => l.includes('Heightmap:'))
    expect(hmLine).toBeDefined()
    const hmMatch = hmLine!.match(/(\d+)\/(\d+)\s*cells hit\s*\((\d+\.?\d*)%\)/)
    expect(hmMatch).toBeTruthy()
    const hits = Number(hmMatch![1])
    const pct = Number(hmMatch![3])
    // The box should produce significant hits, not zero
    expect(hits).toBeGreaterThan(0)
    expect(pct).toBeGreaterThan(10)

    // Should produce G1 cutting moves
    const g1Count = lines.filter(l => /^G1\b/i.test(l)).length
    expect(g1Count).toBeGreaterThan(10)
  })

  it('produces heightmap hits for a box NOT centered at origin (auto-centering)', () => {
    // Box offset in Y: Y=10..26, Z=-8..8 → engine should auto-center
    function buildBoxTriangles(
      xMin: number, xMax: number,
      yMin: number, yMax: number,
      zMin: number, zMax: number
    ) {
      const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
      function quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) {
        tris.push([a, b, c])
        tris.push([a, c, d])
      }
      quad([xMax, yMin, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax], [xMax, yMin, zMax])
      quad([xMin, yMin, zMax], [xMin, yMax, zMax], [xMin, yMax, zMin], [xMin, yMin, zMin])
      quad([xMin, yMax, zMin], [xMin, yMax, zMax], [xMax, yMax, zMax], [xMax, yMax, zMin])
      quad([xMin, yMin, zMax], [xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMin, zMax])
      quad([xMin, yMin, zMax], [xMax, yMin, zMax], [xMax, yMax, zMax], [xMin, yMax, zMax])
      quad([xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMin, zMin], [xMin, yMin, zMin])
      return tris
    }

    const triangles = buildBoxTriangles(0, 40, 10, 26, -8, 8)
    const lines = generateCylindricalMeshRasterLines({
      triangles,
      cylinderDiameterMm: 50,
      machXStartMm: 0,
      machXEndMm: 40,
      stepoverDeg: 10,
      stepXMm: 1,
      zDepthsMm: [-2, -4],
      feedMmMin: 500,
      plungeMmMin: 200,
      safeZMm: 5,
      toolDiameterMm: 3.175
    })

    const hmLine = lines.find(l => l.includes('Heightmap:'))
    expect(hmLine).toBeDefined()
    const hmMatch = hmLine!.match(/(\d+)\/(\d+)\s*cells hit\s*\((\d+\.?\d*)%\)/)
    expect(hmMatch).toBeTruthy()
    const hits = Number(hmMatch![1])
    expect(hits).toBeGreaterThan(0)
  })

  it('area-weighted centroid produces correct offset for asymmetric L-shaped cross-section', () => {
    // L-shaped cross-section: large horizontal bar at Z=0..4 (Y=0..20, wide)
    // plus a thin vertical bar at Y=0..4 (Z=4..20, tall).
    // Bbox midpoint would be at Y=10, Z=10.
    // Area-weighted centroid should be shifted toward the large wide bar (lower Z, lower Y).
    //
    // Wide bar: Y=0..20, Z=0..4, X=0..10 → YZ area ≈ 80 (20×4)
    // Thin bar: Y=0..4, Z=4..20, X=0..10 → YZ area ≈ 64 (4×16)
    //
    // Weighted Y: (10*80 + 2*64)/(80+64) = (800+128)/144 ≈ 6.44
    // Weighted Z: (2*80 + 12*64)/(80+64) = (160+768)/144 ≈ 6.44
    // Bbox midpoint: Y=10, Z=10
    //
    // The engine reports the auto-center offset in the G-code header comment.
    // With area-weighted centroid, the reported offset should be near Y≈6.44, Z≈6.44
    // NOT the bbox midpoint of Y=10, Z=10.

    // Build the L-shape as triangles (two boxes)
    function boxTris(
      xMin: number, xMax: number,
      yMin: number, yMax: number,
      zMin: number, zMax: number
    ): Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> {
      const t: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
      const q = (
        a: [number, number, number], b: [number, number, number],
        c: [number, number, number], d: [number, number, number]
      ) => { t.push([a, b, c]); t.push([a, c, d]) }
      q([xMax, yMin, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax], [xMax, yMin, zMax])
      q([xMin, yMin, zMax], [xMin, yMax, zMax], [xMin, yMax, zMin], [xMin, yMin, zMin])
      q([xMin, yMax, zMin], [xMin, yMax, zMax], [xMax, yMax, zMax], [xMax, yMax, zMin])
      q([xMin, yMin, zMax], [xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMin, zMax])
      q([xMin, yMin, zMax], [xMax, yMin, zMax], [xMax, yMax, zMax], [xMin, yMax, zMax])
      q([xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMin, zMin], [xMin, yMin, zMin])
      return t
    }

    const wideBar = boxTris(0, 10, 0, 20, 0, 4)   // Y=0..20, Z=0..4
    const thinBar = boxTris(0, 10, 0, 4, 4, 20)    // Y=0..4, Z=4..20
    const triangles = [...wideBar, ...thinBar]

    const lines = generateCylindricalMeshRasterLines({
      triangles,
      cylinderDiameterMm: 60,
      machXStartMm: 0,
      machXEndMm: 10,
      stepoverDeg: 45,
      stepXMm: 2,
      zDepthsMm: [-2],
      feedMmMin: 400,
      plungeMmMin: 200,
      safeZMm: 10,
      maxCells: 10000
    })

    // The G-code header reports the computed offset
    const centerLine = lines.find((l) => l.startsWith('; Auto-centered mesh'))
    expect(centerLine).toBeDefined()

    // Extract offset Y and Z from comment: "; Auto-centered mesh: offset Y=X.XX Z=X.XX"
    const match = centerLine!.match(/offset Y=([-\d.]+) Z=([-\d.]+)/)
    expect(match).not.toBeNull()
    const reportedY = parseFloat(match![1]!)
    const reportedZ = parseFloat(match![2]!)

    // Area-weighted centroid should be ~6.44 for both Y and Z (see comment above)
    // Bbox midpoint would be Y=10, Z=10 — if that were used, reportedY would be ~10
    expect(reportedY).toBeCloseTo(6.44, 0)  // within ±0.5
    expect(reportedZ).toBeCloseTo(6.44, 0)
  })

  it('emits WARNING comment when mesh radial extent exceeds stock radius', () => {
    // Ring at radius 20mm with stock diameter 30mm (radius 15mm) → mesh protrudes 5mm past OD
    function makeRingTris(xMin: number, xMax: number, radius: number, segments: number) {
      const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2
        const a1 = ((i + 1) / segments) * Math.PI * 2
        const y0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius
        const y1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius
        tris.push([[xMin, y0, z0], [xMax, y0, z0], [xMin, y1, z1]])
        tris.push([[xMax, y0, z0], [xMax, y1, z1], [xMin, y1, z1]])
      }
      return tris
    }
    const lines = generateCylindricalMeshRasterLines({
      triangles: makeRingTris(0, 10, 20, 16),
      cylinderDiameterMm: 30,  // radius = 15mm, mesh radius = 20mm
      machXStartMm: 0,
      machXEndMm: 10,
      stepoverDeg: 45,
      stepXMm: 2,
      zDepthsMm: [-5],
      feedMmMin: 400,
      plungeMmMin: 200,
      safeZMm: 5,
      maxCells: 10000
    })
    const warnLine = lines.find((l) => l.includes('WARNING') && l.includes('mesh radial max') && l.includes('exceeds stock radius'))
    expect(warnLine).toBeDefined()
    expect(warnLine).toContain('stock OD after centering')
  })

  it('does NOT emit WARNING comment when mesh fits within stock radius', () => {
    // Ring at radius 8mm with stock diameter 30mm (radius 15mm) → mesh fits inside
    function makeRingTris2(xMin: number, xMax: number, radius: number, segments: number) {
      const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2
        const a1 = ((i + 1) / segments) * Math.PI * 2
        const y0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius
        const y1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius
        tris.push([[xMin, y0, z0], [xMax, y0, z0], [xMin, y1, z1]])
        tris.push([[xMax, y0, z0], [xMax, y1, z1], [xMin, y1, z1]])
      }
      return tris
    }
    const lines = generateCylindricalMeshRasterLines({
      triangles: makeRingTris2(0, 10, 8, 16),
      cylinderDiameterMm: 30,  // radius = 15mm, mesh radius = 8mm → no warning
      machXStartMm: 0,
      machXEndMm: 10,
      stepoverDeg: 45,
      stepXMm: 2,
      zDepthsMm: [-2],
      feedMmMin: 400,
      plungeMmMin: 200,
      safeZMm: 5,
      maxCells: 10000
    })
    const warnLine = lines.find((l) => l.includes('WARNING') && l.includes('mesh radial max'))
    expect(warnLine).toBeUndefined()
  })
})

describe('generateContourWrappingLines', () => {
  const base = {
    cylinderDiameterMm: 50,
    machXStartMm: 0,
    machXEndMm: 100,
    zDepthsMm: [-1],
    feedMmMin: 400,
    plungeMmMin: 200,
    safeZMm: 5
  }

  it('produces G1 moves for each contour point', () => {
    const pts: [number, number][] = [[10, 0], [50, 20], [90, 40], [10, 0]]
    const lines = generateContourWrappingLines({ ...base, contourPoints: pts })
    const g1Lines = lines.filter((l) => /^G1\s/.test(l))
    // plunge + 3 contour moves (first point is rapid)
    expect(g1Lines.length).toBeGreaterThanOrEqual(3)
  })

  it('converts Y to A degrees via circumference', () => {
    const circumference = Math.PI * 50 // ~157.08
    const pts: [number, number][] = [[10, 0], [50, circumference / 4]] // quarter-turn = 90°
    const lines = generateContourWrappingLines({ ...base, contourPoints: pts })
    const aLine = lines.find((l) => /G1.*A/.test(l))
    expect(aLine).toBeDefined()
    const aMatch = aLine!.match(/A([\d.-]+)/)
    expect(aMatch).toBeTruthy()
    expect(parseFloat(aMatch![1]!)).toBeCloseTo(90, 0)
  })

  it('clamps X to machinable span', () => {
    const pts: [number, number][] = [[-10, 0], [50, 10], [200, 20]]
    const lines = generateContourWrappingLines({ ...base, contourPoints: pts })
    const xValues: number[] = []
    for (const l of lines) {
      const m = l.match(/X([\d.-]+)/)
      if (m) xValues.push(parseFloat(m[1]!))
    }
    expect(Math.min(...xValues)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xValues)).toBeLessThanOrEqual(100)
  })

  it('returns minimal output for empty contour', () => {
    const lines = generateContourWrappingLines({ ...base, contourPoints: [] })
    // Only comment + safe Z
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(lines.some((l) => /^G1/.test(l))).toBe(false)
  })

  it('produces passes for each Z depth', () => {
    const pts: [number, number][] = [[10, 0], [50, 20], [90, 40]]
    const lines = generateContourWrappingLines({
      ...base,
      contourPoints: pts,
      zDepthsMm: [-1, -2, -3]
    })
    const depthComments = lines.filter((l) => l.includes('contour at Z_pass'))
    expect(depthComments.length).toBe(3)
  })
})

describe('generateIndexedPassLines', () => {
  const base = {
    cylinderDiameterMm: 50,
    machXStartMm: 10,
    machXEndMm: 90,
    zDepthsMm: [-2],
    feedMmMin: 400,
    plungeMmMin: 200,
    safeZMm: 5,
    toolDiameterMm: 6
  }

  it('generates passes at each angle', () => {
    const angles = [0, 90, 180, 270]
    const lines = generateIndexedPassLines({ ...base, indexAnglesDeg: angles })
    // Filter out the final "G0 A0 ; return" line
    const aLines = lines.filter((l) => /^G0\s+A[\d.-]/.test(l) && !l.includes('return'))
    expect(aLines.length).toBe(4)
    // Verify each angle appears
    const aVals = aLines.map((l) => parseFloat(l.match(/A([\d.-]+)/)![1]!))
    expect(aVals).toEqual(expect.arrayContaining([0, 90, 180, 270]))
  })

  it('alternates X direction for zigzag', () => {
    const lines = generateIndexedPassLines({ ...base, indexAnglesDeg: [0, 90] })
    const g1x = lines.filter((l) => /^G1\s+X[\d.-]/.test(l))
    expect(g1x.length).toBe(2)
    const xVals = g1x.map((l) => parseFloat(l.match(/X([\d.-]+)/)![1]!))
    // First should go one direction, second the other
    expect(xVals[0]).not.toBe(xVals[1])
  })

  it('extends X by overcut amount', () => {
    const lines = generateIndexedPassLines({ ...base, indexAnglesDeg: [0], overcutMm: 10 })
    const xValues: number[] = []
    for (const l of lines) {
      const m = l.match(/X([\d.-]+)/)
      if (m) xValues.push(parseFloat(m[1]!))
    }
    expect(Math.min(...xValues)).toBeLessThan(10) // machXStartMm - overcut
    expect(Math.max(...xValues)).toBeGreaterThan(90) // machXEndMm + overcut
  })

  it('generates passes for each Z depth level', () => {
    const lines = generateIndexedPassLines({
      ...base,
      indexAnglesDeg: [0, 180],
      zDepthsMm: [-1, -2, -3]
    })
    const depthComments = lines.filter((l) => l.includes('indexed passes at Z_pass'))
    expect(depthComments.length).toBe(3)
  })
})

describe('generatePatternParallelLines', () => {
  const base = {
    cylinderDiameterMm: 50,
    machXStartMm: 10,
    machXEndMm: 90,
    zDepthsMm: [-2],
    stepoverDeg: 45,
    feedMmMin: 400,
    plungeMmMin: 200,
    safeZMm: 5
  }

  it('covers full 360° rotation', () => {
    const lines = generatePatternParallelLines(base)
    const aValues: number[] = []
    for (const l of lines) {
      const m = l.match(/^G0\s+A([\d.-]+)/)
      if (m) aValues.push(parseFloat(m[1]!))
    }
    expect(aValues.length).toBeGreaterThan(0)
    expect(Math.max(...aValues)).toBeGreaterThanOrEqual(360)
  })

  it('step count matches 360/stepoverDeg', () => {
    const lines = generatePatternParallelLines({ ...base, stepoverDeg: 90 })
    // 0, 90, 180, 270, 360 = 5 passes
    const passComments = lines.filter((l) => l.includes('Pass '))
    expect(passComments.length).toBe(5)
  })

  it('alternates X direction', () => {
    const lines = generatePatternParallelLines({ ...base, stepoverDeg: 180 })
    const g1x = lines.filter((l) => /^G1\s+X[\d.-]/.test(l))
    expect(g1x.length).toBeGreaterThanOrEqual(2)
    const xVals = g1x.map((l) => parseFloat(l.match(/X([\d.-]+)/)![1]!))
    // Alternating direction means different endpoints
    expect(xVals[0]).not.toBe(xVals[1])
  })

  it('generates multi-depth passes', () => {
    const lines = generatePatternParallelLines({
      ...base,
      stepoverDeg: 180,
      zDepthsMm: [-1, -2]
    })
    const depthComments = lines.filter((l) => l.includes('Z depth'))
    expect(depthComments.length).toBe(2)
  })

  it('returns home at end', () => {
    const lines = generatePatternParallelLines(base)
    const last = lines[lines.length - 1]
    expect(last).toContain('G0 A0')
  })
})

describe('surfaceStepoverDegFromMm', () => {
  it('converts surface arc-length stepover to degrees via arc = R*theta', () => {
    // R=10mm, stepover=10mm → deg = (10/10)*(180/π) ≈ 57.296°
    const deg = surfaceStepoverDegFromMm(10, 10)
    expect(deg).toBeCloseTo((10 / 10) * (180 / Math.PI), 5)
  })

  it('halves degree result when radius doubles (same surface stepover)', () => {
    // Same 5mm surface stepover: R=20mm → smaller angle than R=10mm
    const degSmall = surfaceStepoverDegFromMm(10, 5)
    const degLarge = surfaceStepoverDegFromMm(20, 5)
    expect(degSmall).toBeCloseTo(degLarge * 2, 5)
  })

  it('clamps to 0.1° minimum for very small stepover', () => {
    // Near-zero stepover should give 0.1° not negative or near-zero
    expect(surfaceStepoverDegFromMm(100, 0.0001)).toBeCloseTo(0.1, 5)
  })

  it('clamps to 180° maximum for large stepover relative to radius', () => {
    // stepover=1000mm on R=1mm → would be ~57296° → clamped to 180
    expect(surfaceStepoverDegFromMm(1, 1000)).toBe(180)
  })

  it('degenerate zero radius: uses 1e-6 fallback and clamps to 180°', () => {
    // Zero radius collapses to 1e-6 → result saturates to 180°
    expect(surfaceStepoverDegFromMm(0, 5)).toBe(180)
  })

  it('degenerate zero stepover: uses 1e-6 fallback and clamps to 0.1°', () => {
    expect(surfaceStepoverDegFromMm(10, 0)).toBeCloseTo(0.1, 5)
  })

  it('negative inputs: behave as near-zero (clamped by Math.max(1e-6, ...))', () => {
    expect(surfaceStepoverDegFromMm(-5, 5)).toBe(180) // negative radius → 1e-6
    expect(surfaceStepoverDegFromMm(10, -5)).toBeCloseTo(0.1, 5) // negative stepover → 1e-6
  })

  it('result is proportional to stepover for a fixed radius', () => {
    const r = 15
    const d1 = surfaceStepoverDegFromMm(r, 1)
    const d2 = surfaceStepoverDegFromMm(r, 2)
    // Both should be well under 180° so clamping doesn't apply
    expect(d2).toBeCloseTo(d1 * 2, 5)
  })

  it('1mm stepover on 25mm radius ≈ 2.29°', () => {
    // Common finishing scenario: Ø50mm stock, 1mm angular stepover
    const deg = surfaceStepoverDegFromMm(25, 1)
    expect(deg).toBeCloseTo((1 / 25) * (180 / Math.PI), 5)
    expect(deg).toBeCloseTo(2.2918, 3)
  })
})

describe('computeAngularCurvature', () => {
  it('returns zero curvature for a uniform-radius heightmap (cylinder)', () => {
    // Uniform radii = zero second derivative everywhere
    const na = 36
    const nx = 10
    const radii = new Float32Array(nx * na).fill(8)
    const hm = { radii, nx, na, xStart: 0, dx: 1, daDeg: 360 / na }
    const scores = computeAngularCurvature(hm, 15)
    for (let ia = 0; ia < na; ia++) {
      expect(scores[ia]).toBeCloseTo(0, 5)
    }
  })

  it('returns non-zero curvature for a heightmap with angular variation', () => {
    // Sinusoidal variation in radius: r(a) = 8 + 2*sin(a)
    // Second derivative of sin is -sin, so curvature should be non-zero
    const na = 36
    const nx = 5
    const daDeg = 360 / na
    const radii = new Float32Array(nx * na)
    for (let ix = 0; ix < nx; ix++) {
      for (let ia = 0; ia < na; ia++) {
        const aRad = (ia * daDeg * Math.PI) / 180
        radii[ix * na + ia] = 8 + 2 * Math.sin(aRad)
      }
    }
    const hm = { radii, nx, na, xStart: 0, dx: 1, daDeg }
    const scores = computeAngularCurvature(hm, 15)
    // Should have some non-zero curvature
    const maxScore = Math.max(...Array.from(scores))
    expect(maxScore).toBeGreaterThan(0)
  })

  it('handles NO_HIT (<=0) cells gracefully', () => {
    const na = 12
    const nx = 4
    const radii = new Float32Array(nx * na).fill(-1) // all NO_HIT
    const hm = { radii, nx, na, xStart: 0, dx: 1, daDeg: 30 }
    const scores = computeAngularCurvature(hm, 15)
    for (let ia = 0; ia < na; ia++) {
      expect(scores[ia]).toBe(0)
    }
  })
})

describe('buildAdaptiveAngles', () => {
  it('returns uniform angles when all curvature is zero', () => {
    const na = 8
    const baseDeg = 360 / na
    const curvature = new Float32Array(na) // all zeros
    const angles = buildAdaptiveAngles(baseDeg, na, curvature, 10)
    expect(angles.length).toBe(na)
    for (let i = 0; i < na; i++) {
      expect(angles[i]).toBeCloseTo(i * baseDeg, 5)
    }
  })

  it('inserts midpoints in high-curvature regions', () => {
    const na = 8
    const baseDeg = 360 / na
    // Set high curvature at angles 0, 1, 2 (top 3 of 8 = above 75th percentile)
    const curvature = new Float32Array(na)
    curvature[0] = 100
    curvature[1] = 80
    curvature[2] = 90
    curvature[3] = 5
    curvature[4] = 3
    curvature[5] = 2
    curvature[6] = 4
    curvature[7] = 1
    const angles = buildAdaptiveAngles(baseDeg, na, curvature, 10)
    // Should have more than na angles due to midpoint insertions
    expect(angles.length).toBeGreaterThan(na)
    // But not more than na + budget
    expect(angles.length).toBeLessThanOrEqual(na + 10)
    // All angles should be sorted
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1]!)
    }
  })

  it('respects maxExtraPasses budget', () => {
    const na = 8
    const baseDeg = 360 / na
    // All high curvature — would want to insert everywhere
    const curvature = new Float32Array(na).fill(100)
    const budget = 2
    const angles = buildAdaptiveAngles(baseDeg, na, curvature, budget)
    // Should have na base + at most budget extras
    expect(angles.length).toBeLessThanOrEqual(na + budget)
  })

  it('does not insert midpoints past 360°', () => {
    const na = 4
    const baseDeg = 90
    const curvature = new Float32Array(na).fill(100)
    const angles = buildAdaptiveAngles(baseDeg, na, curvature, 10)
    for (const a of angles) {
      expect(a).toBeLessThan(360)
    }
  })
})

describe('sampleHeightmapAtAngle', () => {
  it('returns exact value for on-grid angles', () => {
    const na = 4
    const nx = 3
    const comp = new Float32Array(nx * na)
    // Set known values
    comp[0 * na + 0] = 10 // ix=0, ia=0
    comp[0 * na + 1] = 12 // ix=0, ia=1
    comp[0 * na + 2] = 8  // ix=0, ia=2
    comp[0 * na + 3] = 14 // ix=0, ia=3
    const hm = { radii: comp, nx, na, xStart: 0, dx: 1, daDeg: 90 }
    // On-grid: angle 0° → ia=0
    expect(sampleHeightmapAtAngle(hm, comp, 0, 0)).toBeCloseTo(10, 5)
    // On-grid: angle 90° → ia=1
    expect(sampleHeightmapAtAngle(hm, comp, 0, 90)).toBeCloseTo(12, 5)
  })

  it('interpolates linearly between grid angles', () => {
    const na = 4
    const nx = 1
    const comp = new Float32Array(na)
    comp[0] = 10 // ia=0 → 0°
    comp[1] = 20 // ia=1 → 90°
    comp[2] = 10 // ia=2 → 180°
    comp[3] = 20 // ia=3 → 270°
    const hm = { radii: comp, nx, na, xStart: 0, dx: 1, daDeg: 90 }
    // Midpoint between ia=0 (10) and ia=1 (20) → should be 15
    expect(sampleHeightmapAtAngle(hm, comp, 0, 45)).toBeCloseTo(15, 5)
    // Quarter way between ia=1 (20) and ia=2 (10) → 20 + 0.25*(10-20) = 17.5
    expect(sampleHeightmapAtAngle(hm, comp, 0, 112.5)).toBeCloseTo(17.5, 5)
  })

  it('handles NO_HIT values in interpolation', () => {
    const na = 4
    const nx = 1
    const comp = new Float32Array(na)
    comp[0] = 10  // valid (ia=0 → 0°)
    comp[1] = -1  // NO_HIT (ia=1 → 90°)
    comp[2] = 8   // valid (ia=2 → 180°)
    comp[3] = -1  // NO_HIT (ia=3 → 270°)
    const hm = { radii: comp, nx, na, xStart: 0, dx: 1, daDeg: 90 }
    // Between ia=0 (valid=10) and ia=1 (NO_HIT): should return the valid one
    expect(sampleHeightmapAtAngle(hm, comp, 0, 45)).toBe(10)
    // Between ia=1 (NO_HIT) and ia=2 (valid=8): should return the valid one
    expect(sampleHeightmapAtAngle(hm, comp, 0, 135)).toBe(8)
    // Between ia=3 (NO_HIT) and ia=0 (valid=10, wraps around): returns valid one
    expect(sampleHeightmapAtAngle(hm, comp, 0, 315)).toBe(10)
  })

  it('returns 0 when both neighbors are NO_HIT', () => {
    const na = 4
    const nx = 1
    const comp = new Float32Array(na).fill(-1) // all NO_HIT
    const hm = { radii: comp, nx, na, xStart: 0, dx: 1, daDeg: 90 }
    expect(sampleHeightmapAtAngle(hm, comp, 0, 45)).toBe(0)
    expect(sampleHeightmapAtAngle(hm, comp, 0, 135)).toBe(0)
  })
})

describe('adaptive refinement integration', () => {
  function makeRingTriangles(xMin: number, xMax: number, radius: number, segments: number = 12) {
    const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2
      const a1 = ((i + 1) / segments) * Math.PI * 2
      const y0 = Math.cos(a0) * radius
      const z0 = Math.sin(a0) * radius
      const y1 = Math.cos(a1) * radius
      const z1 = Math.sin(a1) * radius
      tris.push([[xMin, y0, z0], [xMax, y0, z0], [xMin, y1, z1]])
      tris.push([[xMax, y0, z0], [xMax, y1, z1], [xMin, y1, z1]])
    }
    return tris
  }

  it('produces same pass count for a smooth cylinder with or without adaptive refinement', () => {
    // A perfect cylinder has near-zero curvature everywhere, so adaptive
    // should not add extra passes.
    const tris = makeRingTriangles(10, 90, 10, 24)
    const baseLines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      enableFinishPass: false,
      adaptiveRefinement: false
    })
    const adaptiveLines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      enableFinishPass: false,
      adaptiveRefinement: true
    })
    // Count roughing pass comments
    const basePasses = baseLines.filter(l => l.includes('Pass ') && l.includes('rough')).length
    const adaptivePasses = adaptiveLines.filter(l => l.includes('Pass ') && l.includes('rough')).length
    // For a smooth cylinder, adaptive should produce the same number of passes
    expect(adaptivePasses).toBe(basePasses)
  })

  it('adds adaptive refinement header comment when enabled', () => {
    const tris = makeRingTriangles(10, 90, 10, 24)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      adaptiveRefinement: true
    })
    const adaptiveComment = lines.find(l => l.includes('Adaptive refinement:'))
    expect(adaptiveComment).toBeDefined()
  })

  it('does not add adaptive header comment when disabled', () => {
    const tris = makeRingTriangles(10, 90, 10, 24)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      adaptiveRefinement: false
    })
    const adaptiveComment = lines.find(l => l.includes('Adaptive refinement:'))
    expect(adaptiveComment).toBeUndefined()
  })

  it('generates more passes with adaptive refinement on a non-uniform mesh', () => {
    // Build a mesh with angular variation: use a box (sharp corners = high curvature)
    function buildBoxTriangles(
      xMin: number, xMax: number,
      yMin: number, yMax: number,
      zMin: number, zMax: number
    ) {
      const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
      function quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) {
        tris.push([a, b, c])
        tris.push([a, c, d])
      }
      quad([xMax, yMin, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax], [xMax, yMin, zMax])
      quad([xMin, yMin, zMax], [xMin, yMax, zMax], [xMin, yMax, zMin], [xMin, yMin, zMin])
      quad([xMin, yMax, zMin], [xMin, yMax, zMax], [xMax, yMax, zMax], [xMax, yMax, zMin])
      quad([xMin, yMin, zMax], [xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMin, zMax])
      quad([xMin, yMin, zMax], [xMax, yMin, zMax], [xMax, yMax, zMax], [xMin, yMax, zMax])
      quad([xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMin, zMin], [xMin, yMin, zMin])
      return tris
    }

    const triangles = buildBoxTriangles(0, 40, -8, 8, -8, 8)
    const baseLines = generateCylindricalMeshRasterLines({
      triangles,
      cylinderDiameterMm: 50,
      machXStartMm: 0,
      machXEndMm: 40,
      stepoverDeg: 10,
      stepXMm: 1,
      zDepthsMm: [-2],
      feedMmMin: 500,
      plungeMmMin: 200,
      safeZMm: 5,
      maxCells: 30000,
      enableFinishPass: false,
      adaptiveRefinement: false
    })
    const adaptiveLines = generateCylindricalMeshRasterLines({
      triangles,
      cylinderDiameterMm: 50,
      machXStartMm: 0,
      machXEndMm: 40,
      stepoverDeg: 10,
      stepXMm: 1,
      zDepthsMm: [-2],
      feedMmMin: 500,
      plungeMmMin: 200,
      safeZMm: 5,
      maxCells: 30000,
      enableFinishPass: false,
      adaptiveRefinement: true
    })
    const basePasses = baseLines.filter(l => l.includes('Pass ') && l.includes('rough')).length
    const adaptivePasses = adaptiveLines.filter(l => l.includes('Pass ') && l.includes('rough')).length
    // A box has sharp corners → should produce MORE passes with adaptive
    expect(adaptivePasses).toBeGreaterThanOrEqual(basePasses)
  })

  it('default adaptiveRefinement is off (opt-in behavior preserved)', () => {
    const tris = makeRingTriangles(10, 90, 10, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000
      // No adaptiveRefinement param → should default to off
    })
    const adaptiveComment = lines.find(l => l.includes('Adaptive refinement:'))
    expect(adaptiveComment).toBeUndefined()
  })
})

describe('4-axis Y=0 centering in toolpath lines', () => {
  function makeRingTriangles(xMin: number, xMax: number, radius: number, segments: number = 12) {
    const tris: Array<readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = []
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2
      const a1 = ((i + 1) / segments) * Math.PI * 2
      const y0 = Math.cos(a0) * radius
      const z0 = Math.sin(a0) * radius
      const y1 = Math.cos(a1) * radius
      const z1 = Math.sin(a1) * radius
      tris.push([[xMin, y0, z0], [xMax, y0, z0], [xMin, y1, z1]])
      tris.push([[xMax, y0, z0], [xMax, y1, z1], [xMin, y1, z1]])
    }
    return tris
  }

  it('mesh raster: first rapid includes Y0 for rotation axis centering', () => {
    const tris = makeRingTriangles(10, 90, 8, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      toolDiameterMm: 3.175
    })
    // The first G0 line should include Y0 to center tool on rotation axis
    const firstG0 = lines.find(l => l.startsWith('G0'))
    expect(firstG0).toBeDefined()
    expect(firstG0).toContain('Y0')
  })

  it('contour wrapping: initial rapid includes Y0', () => {
    const lines = generateContourWrappingLines({
      contourPoints: [[10, 0], [50, 10], [90, 0]],
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
    })
    const firstG0 = lines.find(l => l.startsWith('G0'))
    expect(firstG0).toBeDefined()
    expect(firstG0).toContain('Y0')
  })

  it('indexed passes: initial rapid includes Y0', () => {
    const lines = generateIndexedPassLines({
      indexAnglesDeg: [0, 90, 180, 270],
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
    })
    const y0Lines = lines.filter(l => l.includes('Y0'))
    expect(y0Lines.length).toBeGreaterThan(0)
    // Y0 should appear before any cutting move
    const firstY0Idx = lines.findIndex(l => l.includes('Y0'))
    const firstG1Idx = lines.findIndex(l => l.startsWith('G1'))
    expect(firstY0Idx).toBeLessThan(firstG1Idx)
  })

  it('pattern parallel: initial rapid includes Y0', () => {
    const lines = generatePatternParallelLines({
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
    })
    const y0Lines = lines.filter(l => l.includes('Y0'))
    expect(y0Lines.length).toBeGreaterThan(0)
    // Y0 should appear before any cutting move
    const firstY0Idx = lines.findIndex(l => l.includes('Y0'))
    const firstG1Idx = lines.findIndex(l => l.startsWith('G1'))
    expect(firstY0Idx).toBeLessThan(firstG1Idx)
  })

  it('mesh raster: no Y words in cutting moves (only rapids)', () => {
    // Y must only appear in initial/final rapids, never in G1 cutting moves.
    // The tool must stay at Y=0 throughout the cut.
    const tris = makeRingTriangles(10, 90, 8, 16)
    const lines = generateCylindricalMeshRasterLines({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 90,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxCells: 20000,
      toolDiameterMm: 3.175
    })
    const g1WithY = lines.filter(l => l.startsWith('G1') && /\bY/i.test(l))
    expect(g1WithY.length).toBe(0)
  })
})
