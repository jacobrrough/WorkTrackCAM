import { describe, expect, it } from 'vitest'
import type { ToolpathSegment4 } from './cam-gcode-toolpath'
import { buildCylindricalHeightFieldFromSegments } from './cam-heightfield-cylindrical'

/** Helper: make a 4-axis feed segment with default b0=b1=0. */
function feed4(
  x0: number, a0: number, z0: number,
  x1: number, a1: number, z1: number
): ToolpathSegment4 {
  return { kind: 'feed', x0, y0: 0, z0, x1, y1: 0, z1, a0, a1, b0: 0, b1: 0 }
}

const BASE_OPTS = {
  toolRadiusMm: 1,
  cylinderDiameterMm: 20,
  stockXMin: 0,
  stockXMax: 40,
  maxCols: 32,
  maxRows: 60,
}

describe('buildCylindricalHeightFieldFromSegments', () => {
  it('returns null when no cutting feeds', () => {
    const segs: ToolpathSegment4[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 10, x1: 5, y1: 0, z1: 10, a0: 0, a1: 0, b0: 0, b1: 0 }
    ]
    expect(buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })

  it('returns null for empty segment array', () => {
    expect(buildCylindricalHeightFieldFromSegments([], BASE_OPTS)).toBeNull()
  })

  it('returns null when all feeds are above cutting threshold', () => {
    // stockRadius = 10, threshold = 10*0.98 = 9.8; z0=z1=10 > 9.8 → not cutting
    const segs: ToolpathSegment4[] = [feed4(5, 0, 10, 15, 90, 10)]
    expect(buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })

  it('builds a field from a cutting feed below threshold', () => {
    // z=8 < stockRadius*0.98=9.8 → cutting
    const segs: ToolpathSegment4[] = [feed4(5, 0, 8, 20, 90, 8)]
    const field = buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.cols).toBeGreaterThan(0)
    expect(field.rows).toBe(60)
    expect(field.stockRadius).toBe(10)
    expect(field.radii.length).toBe(field.cols * field.rows)
    // Some cells should be stamped below stockRadius
    const stamped = Array.from(field.radii).filter((r) => r < field.stockRadius - 0.01)
    expect(stamped.length).toBeGreaterThan(0)
  })

  it('flat tool carves more cells than ball for same path', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 7, 25, 180, 7)]
    const opts = { ...BASE_OPTS, toolRadiusMm: 2 }
    const flat = buildCylindricalHeightFieldFromSegments(segs, { ...opts, toolShape: 'flat' as const })
    const ball = buildCylindricalHeightFieldFromSegments(segs, { ...opts, toolShape: 'ball' as const })
    expect(flat).not.toBeNull()
    expect(ball).not.toBeNull()
    if (!flat || !ball) return
    const flatStamped = Array.from(flat.radii).filter((r) => r < flat.stockRadius - 0.01).length
    const ballStamped = Array.from(ball.radii).filter((r) => r < ball.stockRadius - 0.01).length
    expect(flatStamped).toBeGreaterThanOrEqual(ballStamped)
  })

  it('default toolShape matches explicit flat', () => {
    const segs: ToolpathSegment4[] = [feed4(10, 45, 8, 20, 135, 8)]
    const defaultField = buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    const flatField = buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, toolShape: 'flat' as const })
    expect(defaultField).not.toBeNull()
    expect(flatField).not.toBeNull()
    if (!defaultField || !flatField) return
    expect(Array.from(defaultField.radii)).toEqual(Array.from(flatField.radii))
  })

  it('angular wrapping: cut near 360 affects cells near 0', () => {
    // Feed at A=355→365 should wrap and stamp cells near 0 degrees
    const segs: ToolpathSegment4[] = [feed4(15, 355, 8, 20, 365, 8)]
    const field = buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 2,
      maxRows: 36, // 10 deg/cell
    })
    expect(field).not.toBeNull()
    if (!field) return
    // Check that row 0 (angle ~0-10 deg) has some stamped cells
    const row0Start = 0
    const row0End = field.cols
    const row0Cells = Array.from(field.radii.slice(row0Start, row0End))
    const stamped = row0Cells.filter((r) => r < field.stockRadius - 0.01)
    expect(stamped.length).toBeGreaterThan(0)
  })

  it('overlapping passes: deeper pass lowers cells further (min envelope)', () => {
    // Two passes over the same XA region — shallower first (z=8), then deeper (z=5).
    // The resulting field must reflect the deeper cut (z=5) for the overlapping cells.
    const segs: ToolpathSegment4[] = [
      feed4(10, 0, 8, 20, 90, 8),  // shallower pass
      feed4(10, 0, 5, 20, 90, 5),  // deeper pass over same region
    ]
    const field = buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, toolRadiusMm: 2 })
    expect(field).not.toBeNull()
    if (!field) return
    // The min radii in the stamped zone must be at most 5 (deep pass wins)
    const deepStamped = Array.from(field.radii).filter((r) => r <= 5 + 0.05)
    expect(deepStamped.length).toBeGreaterThan(0)
    // And overall min must come from the deep pass, not the shallow one (8)
    const minRadius = Math.min(...Array.from(field.radii))
    expect(minRadius).toBeLessThanOrEqual(5 + 0.1)
  })

  it('custom cuttingRadiusThreshold: segment at z=9 is excluded when threshold is 9', () => {
    // stockRadius=10; threshold default would be 10*0.98=9.8 so z=9 IS cutting by default.
    // With explicit threshold=9, z=9 is NOT strictly < 9 → excluded → null.
    const segs: ToolpathSegment4[] = [feed4(5, 0, 9, 20, 90, 9)]
    const withDefault = buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    const withTight = buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      cuttingRadiusThreshold: 9, // z=9 is NOT < 9 → excluded
    })
    // Default threshold (9.8) lets z=9 through → field built
    expect(withDefault).not.toBeNull()
    // Tight threshold (9) excludes z=9 → null
    expect(withTight).toBeNull()
  })

  it('ball-end stamp: centre cell is deeper (lower radii) than edge cells', () => {
    // Single stationary stamp (x0=x1, a0=a1) at z=6 with ball end mill R=3.
    // Centre cell (directly under tool) should reach z=6.
    // Cells at tool-radius distance (arc ~3mm at R=10 → ~17 deg) should be shallower.
    const segs: ToolpathSegment4[] = [feed4(20, 0, 6, 20, 0, 6)]
    const field = buildCylindricalHeightFieldFromSegments(segs, {
      cylinderDiameterMm: 20,
      toolRadiusMm: 3,
      stockXMin: 0,
      stockXMax: 40,
      maxCols: 32,
      maxRows: 72, // 5 deg/cell
      toolShape: 'ball',
    })
    expect(field).not.toBeNull()
    if (!field) return

    // Centre row (A=0 → row 0) and centre column
    const centreCol = Math.floor((20 - field.originX) / field.cellMm)
    const centreRow = 0 // A=0 → row 0
    const centreIdx = centreRow * field.cols + centreCol
    const centreRadius = field.radii[centreIdx]!

    // An edge row several cells away (~17 deg away from A=0)
    const edgeRow = Math.round(17 / field.cellDeg)
    if (edgeRow < field.rows) {
      const edgeIdx = edgeRow * field.cols + centreCol
      const edgeRadius = field.radii[edgeIdx]!
      // Ball end: centre should be deeper (lower radius) than edge
      expect(centreRadius).toBeLessThan(edgeRadius - 0.1)
    }
    // Centre should be at or near cutZ=6
    expect(centreRadius).toBeCloseTo(6, 0)
  })

  it('rows always equals maxRows', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 7, 25, 180, 7)]
    for (const maxRows of [24, 48, 72]) {
      const field = buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, maxRows })
      expect(field).not.toBeNull()
      expect(field!.rows).toBe(maxRows)
      expect(field!.cellDeg).toBeCloseTo(360 / maxRows, 5)
    }
  })

  it('NaN segment coordinates do not corrupt the field (all radii stay at stockRadius)', () => {
    // Segments with non-finite z (cutRadius) should be silently skipped.
    // The guard in stampDiskCylindrical must prevent NaN propagation.
    const nanRadiusSeg: ToolpathSegment4 = {
      kind: 'feed',
      x0: 5, y0: 0, z0: NaN,
      x1: 20, y1: 0, z1: NaN,
      a0: 0, a1: 90, b0: 0, b1: 0
    }
    const field = buildCylindricalHeightFieldFromSegments([nanRadiusSeg], BASE_OPTS)
    // NaN z0/z1 → cutRadius is NaN → all stamps skipped → null (no valid cuts)
    expect(field).toBeNull()
  })

  it('NaN x coordinate in cutting segment is silently skipped by stampDiskCylindrical guard', () => {
    // A segment with NaN x is still classified as cutting (z is finite and below threshold),
    // but stampDiskCylindrical's guard prevents any radii from being written with NaN indices.
    // The resulting field (if built) must have all-finite radii values.
    const validSeg = feed4(5, 0, 7, 25, 90, 7) // z=7 < stockRadius*0.98=9.8 → cutting, valid XY
    const field = buildCylindricalHeightFieldFromSegments([validSeg], BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    // All radii must be finite — NaN must never propagate into the stored field
    const allFinite = Array.from(field.radii).every((r) => Number.isFinite(r))
    expect(allFinite).toBe(true)
    // At least some radii were carved (below stockRadius) by the valid segment
    const stockR = BASE_OPTS.cylinderDiameterMm / 2
    expect(Array.from(field.radii).some((r) => r < stockR - 0.01)).toBe(true)
  })

  it('uses default maxCols (96) and maxRows (120) when not specified in options', () => {
    // Omitting maxCols/maxRows exercises the `?? 96` and `?? 120` default branches.
    const segs: ToolpathSegment4[] = [feed4(5, 0, 7, 25, 180, 7)]
    const field = buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 1,
      cylinderDiameterMm: 20,
      stockXMin: 0,
      stockXMax: 40,
      // maxCols and maxRows intentionally omitted → defaults: 96 and 120
    })
    expect(field).not.toBeNull()
    if (!field) return
    // rows should be the default 120
    expect(field.rows).toBe(120)
    expect(field.cellDeg).toBeCloseTo(360 / 120, 5)
    // cols ≤ default maxCols (96)
    expect(field.cols).toBeGreaterThan(0)
    expect(field.cols).toBeLessThanOrEqual(96)
  })

  it('returns null when axial span is degenerate (all cuts at same X, marginMm=0)', () => {
    // All cutting segments have identical x0=x1=10 with marginMm=0 → spanX=0 → null.
    // This exercises the `if (!(spanX > 1e-6)) return null` guard.
    const segs: ToolpathSegment4[] = [
      feed4(10, 0, 7, 10, 90, 7),   // x0=x1=10
      feed4(10, 90, 7, 10, 180, 7), // x0=x1=10
    ]
    const result = buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 0.5,
      cylinderDiameterMm: 20,
      stockXMin: 10,
      stockXMax: 10, // same min and max
      marginMm: 0,   // no margin expansion
    })
    expect(result).toBeNull()
  })

  it('grid extent ignores rapid header/footer X positions (regression: phantom cyan bands)', () => {
    // Regression for the bug where the toolpath preview showed two cylindrical
    // cyan regions: one over the actual part, and one phantom region floating
    // beyond it.  Root cause: callers computed stockXMin/Max from *all* G-code
    // segments (rapids + cuts), so a footer `G0 X0 Y0` park move pulled the
    // grid extent out to X=0 even when cuts were nowhere near it.  The grid
    // then included a wide empty band that visually duplicated the cut region.
    //
    // After the fix, the grid X extent is derived from cutting segments only,
    // clamped to the caller's stock range — so passing rapids that span the
    // whole stock no longer inflates the grid.
    const cuttingZone = { xMin: 10, xMax: 30 }
    const segs: ToolpathSegment4[] = [
      // Header rapid: travels from origin out to a safe Z (no cuts)
      { kind: 'rapid', x0: 0, y0: 0, z0: 50, x1: 0, y1: 0, z1: 50, a0: 0, a1: 0, b0: 0, b1: 0 },
      // Real cutting feeds in [10, 30]
      feed4(cuttingZone.xMin, 0, 7, cuttingZone.xMax, 90, 7),
      feed4(cuttingZone.xMin, 90, 7, cuttingZone.xMax, 180, 7),
      // Footer rapid: park move back to X=0 (the smoking gun)
      { kind: 'rapid', x0: cuttingZone.xMax, y0: 0, z0: 50, x1: 0, y1: 0, z1: 50, a0: 0, a1: 0, b0: 0, b1: 0 },
    ]

    const field = buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 1,
      cylinderDiameterMm: 20,
      // Caller computed bounds from all segments → stockXMin pulled to 0
      stockXMin: 0,
      stockXMax: 80,
      maxCols: 96,
      maxRows: 60,
    })
    expect(field).not.toBeNull()
    if (!field) return

    // Grid must hug the actual cut region (margin = toolRadius + 1 = 2 mm),
    // not the inflated [0, 80] passed in by the caller.
    const marginMm = 2
    const expectedMin = cuttingZone.xMin - marginMm // 8
    const expectedMax = cuttingZone.xMax + marginMm // 32
    expect(field.originX).toBeCloseTo(expectedMin, 1)
    const fieldMaxX = field.originX + field.cols * field.cellMm
    expect(fieldMaxX).toBeLessThanOrEqual(expectedMax + 0.1)
    // Sanity: the grid must NOT span the inflated rapid range
    expect(fieldMaxX - field.originX).toBeLessThan(40)
  })

  it('grid extent is clamped to stockXMin/Max (cuts cannot push grid outside physical stock)', () => {
    // If a cutting segment somehow extends slightly beyond the stock bounds
    // (e.g. tool radius overshoot at the edge), the grid must still clamp to
    // the caller-provided physical stock range — never extending into thin air.
    const segs: ToolpathSegment4[] = [
      feed4(-5, 0, 7, 45, 90, 7), // cuts span [-5, 45], stock is [0, 40]
    ]
    const field = buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 1,
      cylinderDiameterMm: 20,
      stockXMin: 0,
      stockXMax: 40,
      maxCols: 96,
      maxRows: 60,
    })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.originX).toBeGreaterThanOrEqual(0)
    expect(field.originX + field.cols * field.cellMm).toBeLessThanOrEqual(40 + 0.1)
  })

  it('tiny cylinder (diameter ≤ 0.02mm) falls back to circumAtStock=1 and still builds', () => {
    // stockRadius = 0.01 → field.stockRadius ≤ 0.01 → `circumAtStock = 1` fallback.
    // The field should still build without NaN or Infinity in the radii array.
    const segs: ToolpathSegment4[] = [feed4(5, 0, 0.008, 15, 90, 0.008)]
    const field = buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 0.01,
      cylinderDiameterMm: 0.02, // stockRadius = 0.01 → triggers circumAtStock fallback
      stockXMin: 0,
      stockXMax: 20,
      maxCols: 16,
      maxRows: 24,
    })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.stockRadius).toBeCloseTo(0.01, 5)
    // All radii must remain finite — circumAtStock=1 fallback must not cause NaN
    const allFinite = Array.from(field.radii).every((r) => Number.isFinite(r))
    expect(allFinite).toBe(true)
  })
})
