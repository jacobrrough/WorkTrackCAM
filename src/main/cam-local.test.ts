import { describe, expect, it } from 'vitest'
import {
  buildPriorRoughFloorSamplerFromGcode,
  chooseMeshRasterGridCaps,
  computeNegativeZDepthPasses,
  computeTabPositionsMm,
  generateChamfer2dLines,
  generateContour2dLines,
  generateDrill2dLines,
  generateMeshHeightRasterLines,
  generateOrthoBoundsRasterLines,
  generateParallelFinishLines,
  generatePocket2dLines,
  generateRampEntryLines,
  heightAtXyFromTriangles,
  injectTabsIntoContourPass,
  MESH_RASTER_INNER_OP_BUDGET,
  minRampRunForMaxAngleMm,
  polygonPerimeterMm,
  resolveMeshRasterSampleBudget
} from './cam-local'

describe('computeNegativeZDepthPasses', () => {
  it('returns single level for non-negative Z', () => {
    expect(computeNegativeZDepthPasses(3, 2)).toEqual([3])
    expect(computeNegativeZDepthPasses(0, 2)).toEqual([0])
  })

  it('steps into negative Z ending at target', () => {
    expect(computeNegativeZDepthPasses(-6, 2)).toEqual([-2, -4, -6])
    expect(computeNegativeZDepthPasses(-5, 2)).toEqual([-2, -4, -5])
  })
})

describe('generateParallelFinishLines', () => {
  it('emits zigzag G0/G1 moves within bounds', () => {
    const lines = generateParallelFinishLines({
      bounds: {
        min: [0, 0, 0],
        max: [10, 10, 5],
        triangleCount: 2
      },
      zPassMm: 4,
      stepoverMm: 5,
      feedMmMin: 1000,
      plungeMmMin: 300,
      safeZMm: 8
    })
    expect(lines.some((l) => l.startsWith('G1'))).toBe(true)
    expect(lines.join('\n')).toContain('Y0.000')
    expect(lines.join('\n')).toContain('Z8.000')
  })
})

describe('heightAtXyFromTriangles', () => {
  it('returns plane Z for horizontal triangle', () => {
    const t: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, 3],
      [10, 0, 3],
      [0, 10, 3]
    ]
    expect(heightAtXyFromTriangles([t], 5, 5)).toBeCloseTo(3, 5)
  })
})

describe('buildPriorRoughFloorSamplerFromGcode', () => {
  it('returns null when no feed moves', () => {
    expect(
      buildPriorRoughFloorSamplerFromGcode({
        gcode: 'G0 X0 Y0 Z5\n',
        minX: 0,
        maxX: 10,
        minY: 0,
        maxY: 10,
        toolRadiusMm: 3
      })
    ).toBeNull()
  })

  it('samples min Z from prior feed and mesh raster skips machined columns', () => {
    const gcode = `
G0 X5 Y5 Z2
G1 X5 Y5 Z-4 F500
`
    const sampler = buildPriorRoughFloorSamplerFromGcode({
      gcode,
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      toolRadiusMm: 5,
      maxGridCols: 16,
      maxGridRows: 16
    })
    expect(sampler).not.toBeNull()
    const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, -1],
      [10, 0, -1],
      [0, 10, -1]
    ]
    const withFloor = generateMeshHeightRasterLines({
      triangles: [tri],
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      stepoverMm: 5,
      sampleStepMm: 5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5,
      priorRoughFloorSampler: sampler!
    })
    const noFloor = generateMeshHeightRasterLines({
      triangles: [tri],
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      stepoverMm: 5,
      sampleStepMm: 5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5
    })
    expect(withFloor.length).toBeLessThan(noFloor.length)
  })

  it('meshAnalyticPriorRoughStockMm skips samples when simulated rough is already at finish rest (no G-code sampler)', () => {
    const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, -1],
      [10, 0, -1],
      [0, 10, -1]
    ]
    const baseline = generateMeshHeightRasterLines({
      triangles: [tri],
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      stepoverMm: 5,
      sampleStepMm: 5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5,
      rasterRestStockMm: 0.1
    })
    const withAnalytic = generateMeshHeightRasterLines({
      triangles: [tri],
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      stepoverMm: 5,
      sampleStepMm: 5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5,
      rasterRestStockMm: 0.1,
      meshAnalyticPriorRoughStockMm: 0.05
    })
    expect(withAnalytic.length).toBeLessThan(baseline.length)
  })
})

describe('generateMeshHeightRasterLines', () => {
  it('emits XY cutting moves on a flat slab', () => {
    const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, 1],
      [10, 0, 1],
      [0, 10, 1]
    ]
    const lines = generateMeshHeightRasterLines({
      triangles: [tri],
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      stepoverMm: 5,
      sampleStepMm: 5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5
    })
    expect(lines.some((l) => /^G1 X[\d.]+ Y[\d.]+ Z[\d.]+ F/.test(l))).toBe(true)
  })

  it('tightens sample budget when triangle count is huge', () => {
    expect(resolveMeshRasterSampleBudget(250_000)).toBe(240)
    expect(resolveMeshRasterSampleBudget(1)).toBe(180_000)
    expect(resolveMeshRasterSampleBudget(250_000) * 250_000).toBeLessThanOrEqual(MESH_RASTER_INNER_OP_BUDGET)
  })

  it('resolveMeshRasterSampleBudget clamps zero/negative triangle count to 1 (returns max grid)', () => {
    // n = Math.max(1, 0) = 1 → budget = 60M / 1 = 60M → clipped to legacyMax (180_000)
    expect(resolveMeshRasterSampleBudget(0)).toBe(180_000)
    expect(resolveMeshRasterSampleBudget(-1)).toBe(180_000)
  })

  it('resolveMeshRasterSampleBudget clamps to 200 floor for extreme triangle counts', () => {
    // 60_000_000 / 1_000_000_000 = 0.06 → floor to 0 < 200 → clamped to 200
    expect(resolveMeshRasterSampleBudget(1_000_000_000)).toBe(200)
  })

  it('chooses grid caps within sample budget', () => {
    const { maxRows, maxCols } = chooseMeshRasterGridCaps(100, 100, 500)
    expect(maxRows * maxCols).toBeLessThanOrEqual(500)
    expect(maxRows).toBeGreaterThanOrEqual(4)
    expect(maxCols).toBeGreaterThanOrEqual(4)
  })

  it('chooseMeshRasterGridCaps returns minimum dims for degenerate inputs', () => {
    // Zero span or zero budget → {maxRows: 4, maxCols: 4}
    expect(chooseMeshRasterGridCaps(0, 100, 500)).toEqual({ maxRows: 4, maxCols: 4 })
    expect(chooseMeshRasterGridCaps(100, 0, 500)).toEqual({ maxRows: 4, maxCols: 4 })
    expect(chooseMeshRasterGridCaps(100, 100, 0)).toEqual({ maxRows: 4, maxCols: 4 })
    expect(chooseMeshRasterGridCaps(-1, 100, 500)).toEqual({ maxRows: 4, maxCols: 4 })
  })

  it('completes quickly with many small triangles (bucket path)', () => {
    const tris: [[number, number, number], [number, number, number], [number, number, number]][] = []
    const nx = 28
    const ny = 28
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x0 = (i / nx) * 10
        const y0 = (j / ny) * 10
        const x1 = ((i + 1) / nx) * 10
        const y1 = ((j + 1) / ny) * 10
        tris.push(
          [
            [x0, y0, 1],
            [x1, y0, 1],
            [x0, y1, 1]
          ],
          [
            [x1, y0, 1],
            [x1, y1, 1],
            [x0, y1, 1]
          ]
        )
      }
    }
    expect(tris.length).toBeGreaterThanOrEqual(400)
    const t0 = performance.now()
    const lines = generateMeshHeightRasterLines({
      triangles: tris,
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      stepoverMm: 1,
      sampleStepMm: 1,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5
    })
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(8000)
    expect(lines.some((l) => /Z1\.000/.test(l))).toBe(true)
  })
})

describe('generateOrthoBoundsRasterLines', () => {
  it('steps in X and sweeps Y', () => {
    const lines = generateOrthoBoundsRasterLines({
      bounds: { min: [0, 0, 0], max: [4, 4, 2], triangleCount: 0 },
      zPassMm: -1,
      stepoverMm: 4,
      feedMmMin: 500,
      plungeMmMin: 100,
      safeZMm: 3
    })
    expect(lines.join('\n')).toMatch(/X0\.000 Y4\.000/)
    expect(lines.join('\n')).toMatch(/X4\.000/)
  })
})

describe('2D toolpath generators', () => {
  it('emits closed contour from ring points', () => {
    const lines = generateContour2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8]
      ],
      zPassMm: -1.5,
      feedMmMin: 700,
      plungeMmMin: 250,
      safeZMm: 6
    })
    expect(lines.join('\n')).toMatch(/G1 X10\.000 Y8\.000 F700/)
    expect(lines.join('\n')).toMatch(/G1 X0\.000 Y0\.000 F700/)
  })

  it('supports contour side and lead-in/out segments', () => {
    const lines = generateContour2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8]
      ],
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      contourSide: 'conventional',
      leadInMm: 2,
      leadOutMm: 1
    })
    // Entry shifted before first point by lead-in.
    expect(lines.join('\n')).toMatch(/G0 X-2\.000 Y8\.000/)
    // Side reversal: first feed move after entering point goes toward last vertex.
    expect(lines.join('\n')).toMatch(/G1 X0\.000 Y8\.000 F600/)
    // Lead-out extends past start along first segment direction.
    expect(lines.join('\n')).toMatch(/G1 X1\.000 Y8\.000 F600/)
  })

  it('supports arc lead-in mode with G2 entry arc', () => {
    const lines = generateContour2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8]
      ],
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 3,
      leadInMode: 'arc'
    })
    const joined = lines.join('\n')
    // Should contain a G2 arc entry (not G1 linear lead-in)
    expect(joined).toMatch(/G2 X0\.000 Y0\.000 I/)
    // Should NOT have a linear lead-in move before the first contour point
    // (the G2 replaces it)
    expect(joined).not.toMatch(/G1 X0\.000 Y0\.000 F600\nG1 X10/)
    // Still closes the loop and retracts
    expect(joined).toMatch(/G0 Z5\.000/)
  })

  it('arc lead-in falls back to linear when leadInMm is tiny', () => {
    const lines = generateContour2dLines({
      contourPoints: [[0, 0], [10, 0], [10, 8], [0, 8]],
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 0.01,
      leadInMode: 'arc'
    })
    // Too small for arc → should fall back to linear (no G2)
    expect(lines.join('\n')).not.toMatch(/G2/)
  })

  it('supports arc lead-out mode with G3 exit arc', () => {
    const lines = generateContour2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8]
      ],
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadOutMm: 3,
      leadOutMode: 'arc'
    })
    const joined = lines.join('\n')
    // Should contain a G3 arc exit
    expect(joined).toMatch(/G3 /)
    // Should NOT have a linear lead-out (G1 past the close point)
    // The G3 replaces the linear extension
  })

  it('combined arc lead-in and arc lead-out', () => {
    const lines = generateContour2dLines({
      contourPoints: [[0, 0], [10, 0], [10, 8], [0, 8]],
      zPassMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      leadInMm: 2,
      leadOutMm: 2,
      leadInMode: 'arc',
      leadOutMode: 'arc'
    })
    const joined = lines.join('\n')
    expect(joined).toMatch(/G2/)   // arc lead-in
    expect(joined).toMatch(/G3/)   // arc lead-out
    // Still retracts to safe Z at the end
    expect(joined).toMatch(/G0 Z10\.000/)
  })

  it('computes min ramp run for max angle vs Z drop', () => {
    expect(minRampRunForMaxAngleMm(7, 45)).toBeCloseTo(7, 5)
    expect(minRampRunForMaxAngleMm(0, 45)).toBe(0)
  })

  it('clamps ramp angle guardrails at edge values', () => {
    const runAtOneDeg = minRampRunForMaxAngleMm(7, 1)
    const runAtEightyNineDeg = minRampRunForMaxAngleMm(7, 89)
    expect(runAtOneDeg).toBeGreaterThan(300)
    expect(runAtEightyNineDeg).toBeLessThan(1)
    expect(minRampRunForMaxAngleMm(7, 0)).toBeCloseTo(runAtOneDeg, 6)
  })

  it('emits pocket raster passes from contour bounds', () => {
    const { lines } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [12, 0],
        [12, 6],
        [0, 6]
      ],
      stepoverMm: 3,
      zPassMm: -2,
      feedMmMin: 900,
      plungeMmMin: 300,
      safeZMm: 5
    })
    expect(lines.join('\n')).toMatch(/X12\.000 Y3\.000/)
    expect(lines.join('\n')).toMatch(/Z-2\.000 F300/)
  })

  it('clips pocket passes to contour interior (not full bbox width)', () => {
    const { lines } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [8, 0],
        [8, 8],
        [4, 4],
        [0, 8]
      ],
      stepoverMm: 4,
      zPassMm: -1.5,
      feedMmMin: 500,
      plungeMmMin: 200,
      safeZMm: 5
    })
    const g1Cuts = lines.filter((l) => /^G1 X/.test(l))
    // y=4 row should be clipped to x in [0,4] for this concave ring.
    expect(g1Cuts.some((l) => /X4\.000 Y4\.000/.test(l))).toBe(true)
    expect(g1Cuts.some((l) => /X8\.000 Y4\.000/.test(l))).toBe(false)
  })

  it('applies true geometric wall stock on a convex pocket (corner clearance)', () => {
    const { lines } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6]
      ],
      stepoverMm: 3,
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      wallStockMm: 1
    })
    const cutRows = lines.filter((l) => /^G1 X/.test(l))
    // At y=0, true inset leaves only a tangent point at x=1 (no finite span).
    expect(cutRows.some((l) => / Y0\.000 /.test(l))).toBe(false)
    // Interior row remains and is clipped to true offset limits.
    expect(cutRows.some((l) => /X9\.000 Y3\.000 F600/.test(l))).toBe(true)
  })

  it('applies true geometric wall stock on concave pocket re-entrant notch', () => {
    const { lines } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 8],
        [7, 8],
        [5, 6],
        [3, 8],
        [0, 8]
      ],
      stepoverMm: 1,
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      wallStockMm: 1
    })
    const text = lines.join('\n')
    // At y=7, true inset follows the 45-degree notch walls and lands at non-axis values.
    // Naive endpoint shrink would produce integer endpoints (x=2 and x=8 for this row).
    expect(text).toMatch(/G1 X2\.586 Y7\.000 F600/)
    expect(text).toMatch(/G0 X7\.414 Y7\.000/)
    expect(text).not.toMatch(/G1 X2\.000 Y7\.000 F600/)
    expect(text).not.toMatch(/G0 X8\.000 Y7\.000/)
  })

  it('supports multi-depth pocketing via zStepMm', () => {
    const { lines } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6]
      ],
      stepoverMm: 3,
      zPassMm: -6,
      zStepMm: 2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    const text = lines.join('\n')
    expect(text).toMatch(/G1 Z-2\.000 F200/)
    expect(text).toMatch(/G1 Z-4\.000 F200/)
    expect(text).toMatch(/G1 Z-6\.000 F200/)
  })

  it('can finish contour at each depth when enabled', () => {
    const { lines } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6]
      ],
      stepoverMm: 3,
      zPassMm: -4,
      zStepMm: 2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      finishEachDepth: true
    })
    const text = lines.join('\n')
    // Expect contour-style close move at both depth levels.
    expect((text.match(/G1 X0\.000 Y0\.000 F600/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('supports pocket ramp entry mode and lengthens run to respect max ramp angle', () => {
    const { lines, hints } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6]
      ],
      stepoverMm: 3,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      entryMode: 'ramp',
      rampMm: 1.5,
      rampMaxAngleDeg: 45
    })
    const text = lines.join('\n')
    // |safeZ - z| = 7 mm → 45° needs ≥7 mm horizontal run; rampMm 1.5 is extended to 7 mm.
    expect(text).toMatch(/G1 X7\.000 Y0\.000 Z-2\.000 F200/)
    expect(text).not.toMatch(/G1 Z-2\.000 F200/)
    expect(hints.some((h) => /lengthened/i.test(h))).toBe(true)
  })

  it('allows short ramp when rampMaxAngleDeg is relaxed', () => {
    const { lines, hints } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6]
      ],
      stepoverMm: 3,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      entryMode: 'ramp',
      rampMm: 1.5,
      rampMaxAngleDeg: 89
    })
    const text = lines.join('\n')
    expect(text).toMatch(/G1 X1\.500 Y0\.000 Z-2\.000 F200/)
    expect(hints.length).toBe(0)
  })

  it('warns when segment span cannot satisfy max ramp angle', () => {
    const { lines, hints } = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [1, 0],
        [1, 10],
        [0, 10]
      ],
      stepoverMm: 2,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      entryMode: 'ramp',
      rampMm: 2,
      rampMaxAngleDeg: 45
    })
    expect(lines.join('\n')).toMatch(/G1 X1\.000 Y0\.000 Z-2\.000 F200/)
    expect(hints.some((h) => /shorter than the horizontal run needed/i.test(h))).toBe(true)
  })

  it('treats invalid rampMaxAngleDeg as default (45 deg) and still emits robust hints', () => {
    const base = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [1, 0],
        [1, 10],
        [0, 10]
      ],
      stepoverMm: 2,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      entryMode: 'ramp',
      rampMm: 2,
      rampMaxAngleDeg: 45
    })
    const invalid = generatePocket2dLines({
      contourPoints: [
        [0, 0],
        [1, 0],
        [1, 10],
        [0, 10]
      ],
      stepoverMm: 2,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      entryMode: 'ramp',
      rampMm: 2,
      rampMaxAngleDeg: Number.NaN
    })
    expect(invalid.lines).toEqual(base.lines)
    expect(invalid.hints.join(' ')).toContain('rampMaxAngleDeg (45')
  })

  it('emits drill canned cycles for each point', () => {
    const lines = generateDrill2dLines({
      drillPoints: [
        [5, 5],
        [10, 5]
      ],
      zPassMm: -4,
      feedMmMin: 180,
      safeZMm: 7,
      retractMm: 2
    })
    expect(lines.join('\n')).toMatch(/G81 X5\.000 Y5\.000 Z-4\.000 R2\.000 F180/)
    expect(lines.filter((l) => l === 'G80').length).toBe(1)
  })

  it('supports expanded drill moves (grbl-safe fallback)', () => {
    const lines = generateDrill2dLines({
      drillPoints: [[2, 3]],
      zPassMm: -2,
      feedMmMin: 120,
      safeZMm: 5,
      cycleMode: 'expanded'
    })
    expect(lines.join('\n')).toMatch(/G1 Z-2\.000 F120/)
    expect(lines.some((l) => l.startsWith('G73') || l.startsWith('G81') || l.startsWith('G82') || l.startsWith('G83') || l === 'G80')).toBe(false)
  })

  it('supports G82 dwell cycle', () => {
    const lines = generateDrill2dLines({
      drillPoints: [[3, 2]],
      zPassMm: -5,
      feedMmMin: 150,
      safeZMm: 8,
      retractMm: 2,
      cycleMode: 'g82',
      dwellMs: 250
    })
    expect(lines.join('\n')).toMatch(/G82 X3\.000 Y2\.000 Z-5\.000 R2\.000 P250 F150/)
    expect(lines).toContain('G80')
  })

  it('supports G83 peck cycle', () => {
    const lines = generateDrill2dLines({
      drillPoints: [[1, 1]],
      zPassMm: -6,
      feedMmMin: 160,
      safeZMm: 8,
      retractMm: 1.5,
      cycleMode: 'g83',
      peckMm: 1
    })
    expect(lines.join('\n')).toMatch(/G83 X1\.000 Y1\.000 Z-6\.000 R1\.500 Q1\.000 F160/)
    expect(lines).toContain('G80')
  })

  it('supports G73 high-speed peck cycle', () => {
    const lines = generateDrill2dLines({
      drillPoints: [[2, 3]],
      zPassMm: -5,
      feedMmMin: 200,
      safeZMm: 10,
      retractMm: 2,
      cycleMode: 'g73',
      peckMm: 0.5
    })
    expect(lines.join('\n')).toMatch(/G73 X2\.000 Y3\.000 Z-5\.000 R2\.000 Q0\.500 F200/)
    expect(lines).toContain('G80')
  })
})

describe('polygonPerimeterMm', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(polygonPerimeterMm([])).toBe(0)
    expect(polygonPerimeterMm([[0, 0]])).toBe(0)
  })

  it('computes perimeter of a unit square (closed polygon)', () => {
    // Unit square: (0,0)→(1,0)→(1,1)→(0,1)→(0,0); perimeter = 4
    const pts: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    expect(polygonPerimeterMm(pts)).toBeCloseTo(4, 10)
  })

  it('computes perimeter of a 3-4-5 right triangle', () => {
    // Hypotenuse = 5; perimeter = 3+4+5 = 12
    const pts: [number, number][] = [[0, 0], [3, 0], [3, 4]]
    expect(polygonPerimeterMm(pts)).toBeCloseTo(12, 10)
  })

  it('handles collinear points (degenerate polygon)', () => {
    // Collinear: (0,0)→(5,0)→(10,0) — back-and-forth gives 10+10+10=30? No: closed is 10+5+5=20
    // Actually: (0,0)→(5,0)=5, (5,0)→(10,0)=5, (10,0)→(0,0)=10 → 20
    const pts: [number, number][] = [[0, 0], [5, 0], [10, 0]]
    expect(polygonPerimeterMm(pts)).toBeCloseTo(20, 10)
  })
})

describe('computeTabPositionsMm', () => {
  it('returns empty array when tabsMode is none', () => {
    expect(computeTabPositionsMm(100, { tabsMode: 'none' })).toEqual([])
  })

  it('returns empty array for zero perimeter', () => {
    expect(computeTabPositionsMm(0, { tabsMode: 'count', tabCount: 4 })).toEqual([])
  })

  it('produces correct count positions evenly spaced', () => {
    const pos = computeTabPositionsMm(100, { tabsMode: 'count', tabCount: 4 })
    expect(pos).toHaveLength(4)
    expect(pos[0]).toBe(0)
    expect(pos[1]).toBeCloseTo(25, 10)
    expect(pos[2]).toBeCloseTo(50, 10)
    expect(pos[3]).toBeCloseTo(75, 10)
  })

  it('rounds tabCount to nearest integer (clamped to 1)', () => {
    // tabCount=0 → clamped to 1
    const pos = computeTabPositionsMm(60, { tabsMode: 'count', tabCount: 0 })
    expect(pos).toHaveLength(1)
    expect(pos[0]).toBe(0)
  })

  it('produces interval-based positions', () => {
    // perimeter=100, interval=25 → 4 tabs at 0,25,50,75
    const pos = computeTabPositionsMm(100, { tabsMode: 'interval', tabIntervalMm: 25 })
    expect(pos).toHaveLength(4)
    expect(pos[0]).toBe(0)
    expect(pos[1]).toBeCloseTo(25, 10)
  })

  it('defaults tabIntervalMm to 50 when missing for interval mode', () => {
    // perimeter=100, default interval=50 → 2 tabs
    const pos = computeTabPositionsMm(100, { tabsMode: 'interval' })
    expect(pos).toHaveLength(2)
  })

  it('returns empty for unknown tabsMode', () => {
    expect(computeTabPositionsMm(100, { tabsMode: 'bogus' as never })).toEqual([])
  })
})

describe('injectTabsIntoContourPass', () => {
  // Simple rectangle contour: 4 corners → each side is 10mm, perimeter = 40mm
  const rect: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('returns empty for empty tabPositions', () => {
    expect(injectTabsIntoContourPass(rect, -2, 600, [], 3, 1)).toEqual([])
  })

  it('returns empty for fewer than 3 contour points', () => {
    expect(injectTabsIntoContourPass([[0, 0], [10, 0]], -2, 600, [5], 2, 1)).toEqual([])
  })

  it('emits G1 moves when no tabs intersect a segment', () => {
    // Tab at position 25 (far side of rect), check first segment (0→10 along x, positions 0–10)
    const lines = injectTabsIntoContourPass(rect, -2, 600, [25], 2, 1)
    // Should include a G1 to the end of the first segment (x=10,y=0)
    expect(lines.some((l) => l.includes('X10.000') && l.includes('Y0.000'))).toBe(true)
  })

  it('injects tab lift (zTab > zWork) and descent when tab intersects segment', () => {
    // Tab at position 5 (midpoint of first segment, x 0→10 along bottom)
    const lines = injectTabsIntoContourPass(rect, -2, 600, [5], 4, 1.5)
    // Tab Z should be zWork + tabHeight = -2 + 1.5 = -0.5
    expect(lines.some((l) => l.includes('Z-0.500'))).toBe(true)
    // After tab, should descend back to zWork = -2
    expect(lines.some((l) => l.includes('Z-2.000'))).toBe(true)
  })

  it('uses the supplied feed rate in all G1 lines', () => {
    const lines = injectTabsIntoContourPass(rect, -2, 800, [5], 3, 1)
    expect(lines.every((l) => l.includes('F800'))).toBe(true)
  })
})

describe('generateChamfer2dLines', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('returns empty for fewer than 3 contour points', () => {
    expect(generateChamfer2dLines({
      contourPoints: [[0, 0], [10, 0]],
      chamferDepthMm: 1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })).toEqual([])
  })

  it('emits safe-Z rapid, plunge, contour loop, and retract', () => {
    const lines = generateChamfer2dLines({
      contourPoints: square,
      chamferDepthMm: 1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    // Safe-Z rapid at start
    expect(lines).toContain('G0 Z5.000')
    // Plunge to chamfer depth (negative)
    expect(lines.some((l) => l.startsWith('G1 Z-1.000'))).toBe(true)
    // Closes back to start point
    const feedMoves = lines.filter((l) => l.startsWith('G1 X'))
    expect(feedMoves[feedMoves.length - 1]).toMatch(/X0\.000 Y0\.000/)
  })

  it('uses negative zWork regardless of positive chamferDepthMm', () => {
    const lines = generateChamfer2dLines({
      contourPoints: square,
      chamferDepthMm: 2.5,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    expect(lines.some((l) => l.includes('Z-2.500'))).toBe(true)
  })

  it('defaults chamferAngleDeg to 45° when omitted', () => {
    const lines = generateChamfer2dLines({
      contourPoints: square,
      chamferDepthMm: 1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    // Comment line should mention 45°
    expect(lines[0]).toMatch(/45/)
  })

  it('applies explicit chamferAngleDeg in comment and XY offset calculation', () => {
    // 60° → offset = 1 * tan(60°) ≈ 1.732
    const lines = generateChamfer2dLines({
      contourPoints: square,
      chamferDepthMm: 1,
      chamferAngleDeg: 60,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    expect(lines[0]).toMatch(/60/)
    expect(lines[0]).toMatch(/1\.732/)
  })

  it('uses plungeMmMin for the Z plunge and feedMmMin for contour moves', () => {
    const lines = generateChamfer2dLines({
      contourPoints: square,
      chamferDepthMm: 1,
      feedMmMin: 700,
      plungeMmMin: 150,
      safeZMm: 5
    })
    // Plunge line uses plungeMmMin
    expect(lines.some((l) => l.startsWith('G1 Z') && l.includes('F150'))).toBe(true)
    // Contour lines use feedMmMin
    expect(lines.filter((l) => l.startsWith('G1 X')).every((l) => l.includes('F700'))).toBe(true)
  })

  it('emits safeZMm retract at the end', () => {
    const lines = generateChamfer2dLines({
      contourPoints: square,
      chamferDepthMm: 1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 8
    })
    expect(lines[lines.length - 1]).toBe('G0 Z8.000')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// RAMP ENTRY (Feature A)
// ────────────────────────────────────────────────────────────────────────────

describe('generateRampEntryLines', () => {
  it('returns empty when Z drop is negligible', () => {
    const lines = generateRampEntryLines(0, 0, 5, 5, 600, 200, 'linear', 3, 1, 0, 10)
    expect(lines).toEqual([])
  })

  it('linear ramp emits G1 with X/Y/Z descent along tangent', () => {
    // Ramp from Z=5 to Z=-3, along X axis (tx=1, ty=0), segment length 20
    const lines = generateRampEntryLines(0, 0, 5, -3, 600, 200, 'linear', 3, 1, 0, 20)
    expect(lines.length).toBeGreaterThanOrEqual(3)
    // Should have a rapid to start position
    expect(lines.some((l) => l.startsWith('G0 X'))).toBe(true)
    // Should have a G1 ramp move with both X and Z
    const rampLine = lines.find((l) => l.startsWith('G1') && l.includes('Z-3.000'))
    expect(rampLine).toBeDefined()
    // Ramp end should have a positive X (moved along tangent)
    expect(rampLine!).toMatch(/X\d+\.\d+/)
    // Should return to entry point at final depth
    expect(lines.some((l) => l.includes('X0.000') && l.includes('Y0.000') && l.includes('Z-3.000'))).toBe(true)
  })

  it('linear ramp clamps run to segment length', () => {
    // Very shallow 1-degree ramp with short segment: run would be huge, but clamped
    const lines = generateRampEntryLines(5, 5, 10, 0, 600, 200, 'linear', 1, 1, 0, 3)
    // Should not produce XY moves beyond 3mm from start point
    const g1Lines = lines.filter((l) => l.startsWith('G1'))
    for (const l of g1Lines) {
      const xm = l.match(/X([+-]?\d+\.\d+)/)
      if (xm) {
        expect(Math.abs(parseFloat(xm[1]!) - 5)).toBeLessThanOrEqual(3.01)
      }
    }
  })

  it('helix ramp emits G2 arc moves descending to target Z', () => {
    const lines = generateRampEntryLines(10, 10, 5, -2, 600, 200, 'helix', 5, 1, 0, 20)
    expect(lines.length).toBeGreaterThanOrEqual(3)
    // Should have G2 (CW arc) moves
    expect(lines.some((l) => l.startsWith('G2'))).toBe(true)
    // Should end with a G1 move to the entry point at target Z
    const lastG1 = lines.filter((l) => l.startsWith('G1')).pop()
    expect(lastG1).toBeDefined()
    expect(lastG1!).toContain('X10.000')
    expect(lastG1!).toContain('Y10.000')
    expect(lastG1!).toContain('Z-2.000')
  })

  it('helix ramp produces valid arc segments (I/J offsets present)', () => {
    const lines = generateRampEntryLines(0, 0, 10, -5, 600, 200, 'helix', 10, 1, 0, 16)
    const arcLines = lines.filter((l) => l.startsWith('G2'))
    expect(arcLines.length).toBeGreaterThanOrEqual(2) // at least one full revolution (2 semicircles)
    for (const arc of arcLines) {
      expect(arc).toMatch(/I[+-]?\d+\.\d+/)
      expect(arc).toMatch(/J[+-]?\d+\.\d+/)
    }
  })
})

describe('generateContour2dLines — ramp entry (Feature A)', () => {
  const square: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20]]

  it('plunge (default) does NOT emit G2 arc ramp', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    // Should have a straight plunge (G1 Z... without X/Y in same line)
    const plungeLine = lines.find((l) => l.startsWith('G1 Z'))
    expect(plungeLine).toBeDefined()
    // No G2 moves in a plunge entry
    expect(lines.filter((l) => l.startsWith('G2')).length).toBe(0)
  })

  it('linear ramp emits diagonal entry instead of vertical plunge', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      rampType: 'linear',
      rampAngleDeg: 5
    })
    // Should NOT have a straight vertical plunge G1 Z without X
    const verticalPlunges = lines.filter((l) => /^G1 Z[+-]?\d/.test(l.trim()))
    expect(verticalPlunges.length).toBe(0)
    // Should have a G1 with X and Z combined (ramp move)
    const rampMoves = lines.filter((l) => l.startsWith('G1') && l.includes('X') && l.includes('Z-3.000'))
    expect(rampMoves.length).toBeGreaterThanOrEqual(1)
  })

  it('helix ramp emits G2 arcs for the entry', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 10,
      rampType: 'helix',
      rampAngleDeg: 3
    })
    // Should have G2 arc segments from helix ramp
    expect(lines.some((l) => l.startsWith('G2'))).toBe(true)
    // Should still end with retract to safe Z
    expect(lines[lines.length - 1]).toBe('G0 Z10.000')
    // Should emit contour G1 moves after the ramp
    const g1Moves = lines.filter((l) => l.startsWith('G1 X'))
    expect(g1Moves.length).toBeGreaterThanOrEqual(4) // at least the 4 sides of the square
  })

  it('ramp entry still produces valid contour that closes the loop', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      rampType: 'linear',
      rampAngleDeg: 10
    })
    // Last contour G1 should return to start point (0,0)
    const g1Moves = lines.filter((l) => l.startsWith('G1 X'))
    const lastContourMove = g1Moves[g1Moves.length - 1]
    expect(lastContourMove).toContain('X0.000')
    expect(lastContourMove).toContain('Y0.000')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// LEAD-IN / LEAD-OUT ARCS (Feature B)
// ────────────────────────────────────────────────────────────────────────────

describe('generateContour2dLines — lead-in/lead-out arcs (Feature B)', () => {
  const square: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20]]

  it('arc lead-in emits G2 approach arc', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 3,
      leadInMode: 'arc'
    })
    // Should have a G2 arc for lead-in
    expect(lines.some((l) => l.startsWith('G2'))).toBe(true)
    // The G2 should end at the first contour point (0,0)
    const g2Line = lines.find((l) => l.startsWith('G2'))!
    expect(g2Line).toContain('X0.000')
    expect(g2Line).toContain('Y0.000')
    // Should have I/J offsets
    expect(g2Line).toMatch(/I[+-]?\d+\.\d+/)
    expect(g2Line).toMatch(/J[+-]?\d+\.\d+/)
  })

  it('arc lead-out emits G3 departure arc', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadOutMm: 3,
      leadOutMode: 'arc'
    })
    // Should have a G3 arc for lead-out
    expect(lines.some((l) => l.startsWith('G3'))).toBe(true)
    const g3Line = lines.find((l) => l.startsWith('G3'))!
    expect(g3Line).toMatch(/I[+-]?\d+\.\d+/)
    expect(g3Line).toMatch(/J[+-]?\d+\.\d+/)
  })

  it('combined arc lead-in and lead-out with no ramp', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -1,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 2,
      leadInMode: 'arc',
      leadOutMm: 2,
      leadOutMode: 'arc'
    })
    expect(lines.some((l) => l.startsWith('G2'))).toBe(true) // lead-in
    expect(lines.some((l) => l.startsWith('G3'))).toBe(true) // lead-out
    expect(lines[lines.length - 1]).toBe('G0 Z5.000')
  })

  it('linear lead-in extends entry point backward along tangent', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 5,
      leadInMode: 'linear'
    })
    // Entry rapid should be at X = 0 - 5*tx = -5 (tangent along first segment is +X)
    expect(lines.some((l) => l.includes('X-5.000') && l.includes('Y0.000'))).toBe(true)
  })

  it('linear lead-out extends exit along tangent', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadOutMm: 4,
      leadOutMode: 'linear'
    })
    // Lead-out move should be along +X (tangent at close point)
    expect(lines.some((l) => l.includes('X4.000') && l.includes('Y0.000'))).toBe(true)
  })

  it('arc lead-in combined with linear ramp entry', () => {
    const lines = generateContour2dLines({
      contourPoints: square,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 3,
      leadInMode: 'arc',
      rampType: 'linear',
      rampAngleDeg: 5
    })
    // Should have both an arc approach (G2) and no straight vertical plunge
    expect(lines.some((l) => l.startsWith('G2'))).toBe(true)
    // Ramp move should have X and Z combined
    const rampMoves = lines.filter((l) => l.startsWith('G1') && l.includes('X') && l.includes('Z-3.000'))
    expect(rampMoves.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// HOLDING TABS IN CONTOUR (Feature C)
// ────────────────────────────────────────────────────────────────────────────

describe('generateContour2dLines — holding tabs (Feature C)', () => {
  const rect: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]]

  it('no tabs by default — produces standard contour lines', () => {
    const lines = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    // Should not have any tab-height Z values (only -3 and 5)
    const zValues = lines.flatMap((l) => {
      const m = l.match(/Z([+-]?\d+\.\d+)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    const uniqueZ = [...new Set(zValues)]
    expect(uniqueZ.every((z) => z === -3 || z === 5)).toBe(true)
  })

  it('tab mode "count" inserts tab bridges into the contour pass', () => {
    const lines = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -4,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      tabParams: {
        tabsMode: 'count',
        tabCount: 4,
        tabWidthMm: 3,
        tabHeightMm: 2
      }
    })
    // Tab height Z = -4 + 2 = -2
    const zValues = lines.flatMap((l) => {
      const m = l.match(/Z([+-]?\d+\.\d+)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    expect(zValues).toContain(-2) // tab height
    expect(zValues).toContain(-4) // normal cut depth
  })

  it('tab mode "interval" distributes tabs at intervals', () => {
    const lines = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      tabParams: {
        tabsMode: 'interval',
        tabIntervalMm: 15,
        tabWidthMm: 2,
        tabHeightMm: 1.5
      }
    })
    // Tab height Z = -3 + 1.5 = -1.5
    expect(lines.some((l) => l.includes('Z-1.500'))).toBe(true)
  })

  it('tab mode "none" produces no tabs', () => {
    const linesNoTabs = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      tabParams: { tabsMode: 'none' }
    })
    const linesDefault = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -3,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5
    })
    // Both should produce identical output
    expect(linesNoTabs).toEqual(linesDefault)
  })

  it('tabs combined with ramp entry produce valid G-code', () => {
    const lines = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 10,
      rampType: 'linear',
      rampAngleDeg: 5,
      tabParams: {
        tabsMode: 'count',
        tabCount: 3,
        tabWidthMm: 2,
        tabHeightMm: 1.5
      }
    })
    // Should have no vertical plunges (ramp entry)
    const verticalPlunges = lines.filter((l) => /^G1 Z[+-]?\d/.test(l.trim()))
    expect(verticalPlunges.length).toBe(0)
    // Should have tab height Z = -5 + 1.5 = -3.5
    expect(lines.some((l) => l.includes('Z-3.500'))).toBe(true)
    // Should retract to safe Z at the end
    expect(lines[lines.length - 1]).toBe('G0 Z10.000')
  })

  it('tabs combined with arc lead-in/lead-out', () => {
    const lines = generateContour2dLines({
      contourPoints: rect,
      zPassMm: -4,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      leadInMm: 3,
      leadInMode: 'arc',
      leadOutMm: 3,
      leadOutMode: 'arc',
      tabParams: {
        tabsMode: 'count',
        tabCount: 2,
        tabWidthMm: 3,
        tabHeightMm: 2
      }
    })
    // Should have G2 for lead-in, G3 for lead-out, and tab Z values
    expect(lines.some((l) => l.startsWith('G2'))).toBe(true)
    expect(lines.some((l) => l.startsWith('G3'))).toBe(true)
    // Tab height Z = -4 + 2 = -2
    expect(lines.some((l) => l.includes('Z-2.000'))).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CAM RUNNER RESOLVERS
// ────────────────────────────────────────────────────────────────────────────

describe('resolveContourRampOptions', () => {
  // Import inline to avoid circular deps — these are integration-style tests
  let resolveContourRampOptions: typeof import('./cam-runner').resolveContourRampOptions
  let resolveContourTabParams: typeof import('./cam-runner').resolveContourTabParams

  // Dynamic import so vitest resolves the module
  it('loads resolvers', async () => {
    const mod = await import('./cam-runner')
    resolveContourRampOptions = mod.resolveContourRampOptions
    resolveContourTabParams = mod.resolveContourTabParams
  })

  it('defaults to plunge with 3-degree angle', () => {
    const { rampType, rampAngleDeg } = resolveContourRampOptions!({})
    expect(rampType).toBe('plunge')
    expect(rampAngleDeg).toBe(3)
  })

  it('resolves linear ramp type', () => {
    const { rampType } = resolveContourRampOptions!({ rampType: 'linear' })
    expect(rampType).toBe('linear')
  })

  it('resolves helix ramp type', () => {
    const { rampType } = resolveContourRampOptions!({ rampType: 'helix' })
    expect(rampType).toBe('helix')
  })

  it('clamps ramp angle to valid range', () => {
    expect(resolveContourRampOptions!({ rampAngleDeg: 0 }).rampAngleDeg).toBe(0.5)
    expect(resolveContourRampOptions!({ rampAngleDeg: 95 }).rampAngleDeg).toBe(89)
    expect(resolveContourRampOptions!({ rampAngleDeg: 15 }).rampAngleDeg).toBe(15)
  })

  it('resolves tab params with count mode', () => {
    const tab = resolveContourTabParams!({ tabsMode: 'count', tabCount: 6, tabWidthMm: 4, tabHeightMm: 2 })
    expect(tab).toBeDefined()
    expect(tab!.tabsMode).toBe('count')
    expect(tab!.tabCount).toBe(6)
    expect(tab!.tabWidthMm).toBe(4)
    expect(tab!.tabHeightMm).toBe(2)
  })

  it('resolves tab params with interval mode', () => {
    const tab = resolveContourTabParams!({ tabsMode: 'interval', tabIntervalMm: 25 })
    expect(tab).toBeDefined()
    expect(tab!.tabsMode).toBe('interval')
    expect(tab!.tabIntervalMm).toBe(25)
  })

  it('returns undefined for no tabs or unknown mode', () => {
    expect(resolveContourTabParams!({})).toBeUndefined()
    expect(resolveContourTabParams!({ tabsMode: 'none' })).toBeUndefined()
    expect(resolveContourTabParams!({ tabsMode: 'bogus' })).toBeUndefined()
  })

  it('applies defaults for missing tab dimensions', () => {
    const tab = resolveContourTabParams!({ tabsMode: 'count' })
    expect(tab).toBeDefined()
    expect(tab!.tabCount).toBe(4) // default
    expect(tab!.tabWidthMm).toBe(3) // default
    expect(tab!.tabHeightMm).toBe(1.5) // default
  })
})
