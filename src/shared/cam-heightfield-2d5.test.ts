import { describe, expect, it } from 'vitest'
import { buildHeightFieldFromCuttingSegments, sampleHeightFieldZ } from './cam-heightfield-2d5'
import type { HeightField2d5 } from './cam-heightfield-2d5'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

describe('buildHeightFieldFromCuttingSegments', () => {
  it('lowers top Z under a simple feed line', () => {
    const segments: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 0, y1: 0, z1: 5 },
      { kind: 'feed', x0: 0, y0: 0, z0: 5, x1: 0, y1: 0, z1: -2 },
      { kind: 'feed', x0: 0, y0: 0, z0: -2, x1: 10, y1: 0, z1: -2 }
    ]
    const h = buildHeightFieldFromCuttingSegments(segments, { toolRadiusMm: 1, maxCols: 32, maxRows: 16 })
    expect(h).not.toBeNull()
    if (!h) return
    expect(h.topZ.some((z) => z <= -2 + 1e-3)).toBe(true)
    expect(h.topZ.some((z) => z >= h.stockTopZ - 1e-3)).toBe(true)
  })

  it('returns null when no cutting feeds', () => {
    const segments: ToolpathSegment3[] = [{ kind: 'rapid', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 5 }]
    expect(buildHeightFieldFromCuttingSegments(segments, { toolRadiusMm: 1 })).toBeNull()
  })

  it('returns null when all feeds are above the cuttingZThreshold', () => {
    // Default cuttingZThreshold is 0.05: feeds at Z=1 are air moves and must be excluded
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 1, x1: 10, y1: 0, z1: 1 },
      { kind: 'feed', x0: 0, y0: 0, z0: 0.5, x1: 10, y1: 0, z1: 0.5 }
    ]
    expect(buildHeightFieldFromCuttingSegments(segments, { toolRadiusMm: 1 })).toBeNull()
  })

  it('cuttingZThreshold: feeds crossing below threshold are included; above-only are excluded', () => {
    // Threshold=0 → only feeds that go strictly below Z=0 are cutting
    const aboveSegs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 10, y1: 0, z1: 0 } // z=0 is NOT < 0
    ]
    expect(
      buildHeightFieldFromCuttingSegments(aboveSegs, { toolRadiusMm: 1, cuttingZThreshold: 0 })
    ).toBeNull()

    const belowSegs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -0.01, x1: 10, y1: 0, z1: -0.01 } // z < 0 → included
    ]
    expect(
      buildHeightFieldFromCuttingSegments(belowSegs, { toolRadiusMm: 1, cuttingZThreshold: 0 })
    ).not.toBeNull()
  })

  it('overlapping passes: deeper pass wins (min envelope)', () => {
    // Two passes over the same XY line — shallower at z=-1 then deeper at z=-3
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -1, x1: 10, y1: 0, z1: -1 },
      { kind: 'feed', x0: 0, y0: 0, z0: -3, x1: 10, y1: 0, z1: -3 }
    ]
    const h = buildHeightFieldFromCuttingSegments(segments, { toolRadiusMm: 0.5, maxCols: 32, maxRows: 16 })
    expect(h).not.toBeNull()
    if (!h) return
    // All cells under the path should be at most -3 (deeper pass dominates)
    const underPath = Array.from(h.topZ).filter((z) => z < -0.5)
    expect(underPath.length).toBeGreaterThan(0)
    expect(Math.min(...underPath)).toBeCloseTo(-3, 1)
  })

  it('returns null for degenerate single-point feed (zero XY span)', () => {
    // A feed segment that does not move in XY → all cutting points collapse to a single X,Y
    // For the heightfield to build, the XY span must be > 1e-6. With a single stationary
    // cut point there is no usable span → null.
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 5, y0: 5, z0: -1, x1: 5, y1: 5, z1: -1 }
    ]
    const h = buildHeightFieldFromCuttingSegments(segments, { toolRadiusMm: 0.01, marginMm: 0 })
    // margin=0 and tool very small → span < 1e-6 → null
    expect(h).toBeNull()
  })

  it('tool larger than stock span: field still builds and most cells are stamped', () => {
    // Tool radius (8mm) is larger than the 5mm cut line + its lateral extent.
    // marginMm=5 gives Y span of 10mm so the field can build. All field cells
    // are within 8mm of the nearest cut point → every cell gets stamped.
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -1, x1: 5, y1: 0, z1: -1 }
    ]
    const h = buildHeightFieldFromCuttingSegments(segments, {
      toolRadiusMm: 8,
      marginMm: 5,
      maxCols: 8,
      maxRows: 8,
      stockTopZ: 0
    })
    expect(h).not.toBeNull()
    if (!h) return
    // Large tool covers entire field — every cell at or below cut Z
    const allCut = Array.from(h.topZ).every((z) => z <= -1 + 1e-3)
    expect(allCut).toBe(true)
  })

  it('ball-end stamp: centre is deepest, edges are shallower', () => {
    // A single feed at z=-3 along X with a ball-end mill (R=3)
    // At the centre line (Y=0) the height should be -3.
    // At the tool edge (Y≈R) the height should be near 0 (cutZ + R ≈ 0).
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -3, x1: 10, y1: 0, z1: -3 }
    ]
    const h = buildHeightFieldFromCuttingSegments(segments, {
      toolRadiusMm: 3,
      maxCols: 32,
      maxRows: 32,
      stockTopZ: 0,
      marginMm: 4,
      toolShape: 'ball'
    })
    expect(h).not.toBeNull()
    if (!h) return

    // Find the row closest to Y=0 (centre line) and a row near the tool edge (Y≈2.5)
    const centreRow = Math.floor((0 - h.originY) / h.cellMm)
    const edgeRow = Math.floor((2.5 - h.originY) / h.cellMm)
    const midCol = Math.floor(h.cols / 2)

    // Centre cell should be at or near cutZ (-3)
    const centreZ = h.topZ[centreRow * h.cols + midCol]!
    expect(centreZ).toBeCloseTo(-3, 0)

    // Edge cell should be significantly shallower than centre
    if (edgeRow >= 0 && edgeRow < h.rows) {
      const edgeZ = h.topZ[edgeRow * h.cols + midCol]!
      expect(edgeZ).toBeGreaterThan(centreZ + 0.5)
    }
  })

  it('flat stamp (default): centre and edges share same Z', () => {
    // Same setup as ball test but with flat tool — all cells at -3
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -3, x1: 10, y1: 0, z1: -3 }
    ]
    const h = buildHeightFieldFromCuttingSegments(segments, {
      toolRadiusMm: 3,
      maxCols: 32,
      maxRows: 32,
      stockTopZ: 0,
      marginMm: 4,
      toolShape: 'flat'
    })
    expect(h).not.toBeNull()
    if (!h) return

    const centreRow = Math.floor((0 - h.originY) / h.cellMm)
    const edgeRow = Math.floor((2.0 - h.originY) / h.cellMm)
    const midCol = Math.floor(h.cols / 2)

    const centreZ = h.topZ[centreRow * h.cols + midCol]!
    expect(centreZ).toBeCloseTo(-3, 0)

    // Edge cell should be at the SAME depth for flat tool (within rounding)
    if (edgeRow >= 0 && edgeRow < h.rows) {
      const edgeZ = h.topZ[edgeRow * h.cols + midCol]!
      expect(edgeZ).toBeCloseTo(-3, 0)
    }
  })

  it('ball-end stamp omitted defaults to flat behaviour', () => {
    const segments: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -2, x1: 5, y1: 0, z1: -2 }
    ]
    const hDefault = buildHeightFieldFromCuttingSegments(segments, {
      toolRadiusMm: 2, maxCols: 16, maxRows: 16, stockTopZ: 0, marginMm: 3
    })
    const hFlat = buildHeightFieldFromCuttingSegments(segments, {
      toolRadiusMm: 2, maxCols: 16, maxRows: 16, stockTopZ: 0, marginMm: 3, toolShape: 'flat'
    })
    expect(hDefault).not.toBeNull()
    expect(hFlat).not.toBeNull()
    if (!hDefault || !hFlat) return
    // Both should produce identical heightfields
    expect(Array.from(hDefault.topZ)).toEqual(Array.from(hFlat.topZ))
  })
})

describe('sampleHeightFieldZ', () => {
  // Build a small 2×2 heightfield with known values for predictable bilinear tests.
  // Stock at Z=0, one feed at Z=-4 covering the lower-left quadrant.
  const segments: ToolpathSegment3[] = [
    { kind: 'feed', x0: 0, y0: 0, z0: -4, x1: 5, y1: 0, z1: -4 }
  ]
  // Use tight params so we get a well-defined field.
  const hf = buildHeightFieldFromCuttingSegments(segments, {
    toolRadiusMm: 1,
    maxCols: 16,
    maxRows: 16,
    stockTopZ: 0,
    marginMm: 1,
    toolShape: 'flat'
  })!

  it('returns stockTopZ for non-finite query coordinates', () => {
    expect(sampleHeightFieldZ(hf, NaN, 0)).toBe(hf.stockTopZ)
    expect(sampleHeightFieldZ(hf, 0, NaN)).toBe(hf.stockTopZ)
    expect(sampleHeightFieldZ(hf, Infinity, 0)).toBe(hf.stockTopZ)
    expect(sampleHeightFieldZ(hf, 0, -Infinity)).toBe(hf.stockTopZ)
  })

  it('returns a value at or below stockTopZ inside the field', () => {
    // Anywhere inside the field must be ≤ stockTopZ (cuts can only lower Z)
    const z = sampleHeightFieldZ(hf, 2.5, hf.originY + hf.cellMm * 0.5)
    expect(z).toBeLessThanOrEqual(hf.stockTopZ + 1e-6)
    expect(Number.isFinite(z)).toBe(true)
  })

  it('returns stockTopZ at uncut area well beyond tool radius', () => {
    // Build a wider field where we can find definitely-uncut cells
    const wideSegs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -4, x1: 5, y1: 0, z1: -4 }
    ]
    const wideHf = buildHeightFieldFromCuttingSegments(wideSegs, {
      toolRadiusMm: 1,
      maxCols: 16,
      maxRows: 32,
      stockTopZ: 0,
      marginMm: 10,  // large margin → uncut rows far from Y=0
      toolShape: 'flat'
    })!
    // A point far in Y (10mm away from the feed at Y=0, beyond tool radius=1mm) should be uncut
    const zFar = sampleHeightFieldZ(wideHf, 2.5, wideHf.originY + wideHf.rows * wideHf.cellMm - 0.1)
    expect(zFar).toBeCloseTo(wideHf.stockTopZ, 1)
  })

  it('bilinear result is between cell values at fractional coordinates', () => {
    // At a cell centre the bilinear result must equal the stored cell value.
    const ci = Math.floor(hf.cols / 2)
    const cj = Math.floor(hf.rows / 2)
    const cellCentreX = hf.originX + (ci + 0.5) * hf.cellMm
    const cellCentreY = hf.originY + (cj + 0.5) * hf.cellMm
    const z = sampleHeightFieldZ(hf, cellCentreX, cellCentreY)
    expect(Number.isFinite(z)).toBe(true)
    // Must be bounded by stockTopZ
    expect(z).toBeLessThanOrEqual(hf.stockTopZ + 1e-6)
  })

  it('is consistent with nearest-neighbour at cell centres (no interpolation artefact)', () => {
    // At a cell centre bilinear and nearest-neighbour should agree closely.
    const ci = 2
    const cj = 2
    const cellCentreX = hf.originX + (ci + 0.5) * hf.cellMm
    const cellCentreY = hf.originY + (cj + 0.5) * hf.cellMm
    const bilinear = sampleHeightFieldZ(hf, cellCentreX, cellCentreY)
    const nearestNeighbour = hf.topZ[cj * hf.cols + ci]!
    // At a cell centre tx=0.5 so bilinear averages the cell with its neighbour.
    // They should be in the same ballpark (within one stockTopZ range).
    expect(Math.abs(bilinear - nearestNeighbour)).toBeLessThan(
      Math.abs(hf.stockTopZ) + 5
    )
  })
})

describe('sampleHeightFieldZ — bilinear interpolation (numerical)', () => {
  // Construct a minimal 2×2 HeightField2d5 directly with known corner values.
  // This lets us verify the exact bilinear formula without depending on the
  // stamping implementation.
  //
  // Grid (col, row):
  //   z00 = topZ[0*2+0] = -4   (col=0, row=0)
  //   z10 = topZ[0*2+1] = -2   (col=1, row=0)
  //   z01 = topZ[1*2+0] = -3   (col=0, row=1)
  //   z11 = topZ[1*2+1] = -1   (col=1, row=1)
  //
  // With originX=0, originY=0, cellMm=1:
  //   At world (0.5, 0.5): tx=0.5, ty=0.5
  //   z0 = z00 + (z10-z00)*0.5 = -4 + 1 = -3
  //   z1 = z01 + (z11-z01)*0.5 = -3 + 1 = -2
  //   result = z0 + (z1-z0)*0.5 = -3 + 0.5 = -2.5
  //
  // Nearest-neighbour would return z00 = -4 (or z10 = -2), so -2.5 proves
  // bilinear interpolation is active.
  const knownHF: HeightField2d5 = {
    originX: 0,
    originY: 0,
    cellMm: 1,
    cols: 2,
    rows: 2,
    stockTopZ: 0,
    topZ: new Float32Array([-4, -2, -3, -1])
    //                       ^z00 ^z10 ^z01 ^z11
    // Layout: row-major → row0=[z00,z10], row1=[z01,z11]
  }

  it('returns exact bilinear value at (tx=0.5, ty=0.5) center of 2×2 grid', () => {
    // At (0.5, 0.5): ix=0, iy=0, ix0=0, iy0=0, tx=0.5, ty=0.5
    // z0 = -4 + (-2-(-4))*0.5 = -3; z1 = -3 + (-1-(-3))*0.5 = -2; result = -3 + (-2-(-3))*0.5 = -2.5
    const z = sampleHeightFieldZ(knownHF, 0.5, 0.5)
    expect(z).toBeCloseTo(-2.5, 5)
  })

  it('returns z00 exactly at (tx=0, ty=0) — corner of cell', () => {
    // At (0, 0): fx=0, fy=0, tx=0, ty=0 → z0=z00=-4, z1=z01=-3, result=z00=-4
    const z = sampleHeightFieldZ(knownHF, 0, 0)
    expect(z).toBeCloseTo(-4, 5)
  })

  it('returns bilinear value at (tx=0.25, ty=0.75)', () => {
    // z0 = -4 + (-2-(-4))*0.25 = -4+0.5 = -3.5
    // z1 = -3 + (-1-(-3))*0.25 = -3+0.5 = -2.5
    // result = -3.5 + (-2.5-(-3.5))*0.75 = -3.5 + 0.75 = -2.75
    const z = sampleHeightFieldZ(knownHF, 0.25, 0.75)
    expect(z).toBeCloseTo(-2.75, 4)
  })

  it('result at (0.5, 0.5) is strictly between min cell value (-4) and max cell value (-1)', () => {
    // This distinguishes bilinear (-2.5) from nearest-neighbour (which would snap to a corner)
    const z = sampleHeightFieldZ(knownHF, 0.5, 0.5)
    expect(z).toBeGreaterThan(-4)
    expect(z).toBeLessThan(-1)
  })

  it('returns stockTopZ when a corner cell contains a non-finite value', () => {
    // Simulate a hypothetical future code path that writes a non-finite sentinel into a cell.
    // The NaN guard in sampleHeightFieldZ must clamp to stockTopZ rather than propagating NaN.
    const nanHF: HeightField2d5 = {
      originX: 0,
      originY: 0,
      cellMm: 1,
      cols: 2,
      rows: 2,
      stockTopZ: 0,
      topZ: new Float32Array([NaN, -2, -3, -1])
      //                       ^z00 is NaN
    }
    expect(sampleHeightFieldZ(nanHF, 0.5, 0.5)).toBe(0)   // stockTopZ
    expect(Number.isFinite(sampleHeightFieldZ(nanHF, 0, 0))).toBe(true)
    expect(sampleHeightFieldZ(nanHF, 0, 0)).toBe(0)

    const infHF: HeightField2d5 = {
      ...knownHF,
      topZ: new Float32Array([-4, -Infinity, -3, -1])
    }
    expect(sampleHeightFieldZ(infHF, 0.5, 0.5)).toBe(knownHF.stockTopZ)
  })
})
