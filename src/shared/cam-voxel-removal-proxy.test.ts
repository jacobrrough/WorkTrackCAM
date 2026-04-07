import { describe, expect, it } from 'vitest'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'
import {
  buildVoxelRemovalFromCuttingSegments,
  VOXEL_SIM_QUALITY_PRESETS
} from './cam-voxel-removal-proxy'

describe('VOXEL_SIM_QUALITY_PRESETS', () => {
  it('defines fast, balanced, and detailed budgets', () => {
    expect(VOXEL_SIM_QUALITY_PRESETS.fast.maxStamps).toBeLessThan(VOXEL_SIM_QUALITY_PRESETS.detailed.maxStamps!)
    expect(VOXEL_SIM_QUALITY_PRESETS.balanced.maxCols).toBeGreaterThan(0)
    const { fast, balanced, detailed } = VOXEL_SIM_QUALITY_PRESETS
    expect(fast.maxCols).toBeLessThanOrEqual(balanced.maxCols!)
    expect(balanced.maxCols).toBeLessThanOrEqual(detailed.maxCols!)
    expect(fast.maxLayers).toBeLessThanOrEqual(balanced.maxLayers!)
    expect(balanced.maxLayers).toBeLessThanOrEqual(detailed.maxLayers!)
  })

  it('all four budget dimensions are strictly monotonic: fast < balanced < detailed', () => {
    const { fast, balanced, detailed } = VOXEL_SIM_QUALITY_PRESETS
    // maxCols
    expect(fast.maxCols!).toBeLessThan(balanced.maxCols!)
    expect(balanced.maxCols!).toBeLessThan(detailed.maxCols!)
    // maxRows
    expect(fast.maxRows!).toBeLessThan(balanced.maxRows!)
    expect(balanced.maxRows!).toBeLessThan(detailed.maxRows!)
    // maxLayers
    expect(fast.maxLayers!).toBeLessThan(balanced.maxLayers!)
    expect(balanced.maxLayers!).toBeLessThan(detailed.maxLayers!)
    // maxStamps
    expect(fast.maxStamps!).toBeLessThan(balanced.maxStamps!)
    expect(balanced.maxStamps!).toBeLessThan(detailed.maxStamps!)
    // maxSamplePoints
    expect(fast.maxSamplePoints!).toBeLessThan(balanced.maxSamplePoints!)
    expect(balanced.maxSamplePoints!).toBeLessThan(detailed.maxSamplePoints!)
  })
})

describe('buildVoxelRemovalFromCuttingSegments', () => {
  it('returns null when no cutting feeds', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 1, x1: 1, y1: 0, z1: 1 }]
    expect(buildVoxelRemovalFromCuttingSegments(segs, { toolRadiusMm: 1 })).toBeNull()
  })

  it('carves along a shallow feed move', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 4, y1: 0, z1: -0.5 }]
    const v = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 0.8,
      maxCols: 24,
      maxRows: 24,
      maxLayers: 16,
      maxStamps: 5000
    })
    expect(v).not.toBeNull()
    if (!v) return
    expect(v.carvedVoxelCount).toBeGreaterThan(0)
    expect(v.approxRemovedVolumeMm3).toBeGreaterThan(0)
    expect(v.samplePositions.length % 3).toBe(0)
  })

  it('extends nominal stock downward when stockBottomZ is set', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 4, y1: 0, z1: -0.5 }]
    const shallow = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 0.8,
      maxCols: 24,
      maxRows: 24,
      maxLayers: 24,
      maxStamps: 8000,
      stockTopZ: 0
    })
    const deep = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 0.8,
      maxCols: 24,
      maxRows: 24,
      maxLayers: 24,
      maxStamps: 8000,
      stockTopZ: 0,
      stockBottomZ: -40
    })
    expect(shallow).not.toBeNull()
    expect(deep).not.toBeNull()
    if (!shallow || !deep) return
    expect(deep.zBottom).toBeLessThan(shallow.zBottom - 1)
    expect(deep.layers).toBeGreaterThanOrEqual(shallow.layers)
  })

  it('expands XY bounds when stockRectXYMm is set', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 2, y0: 2, z0: 0, x1: 3, y1: 2, z1: -0.5 }]
    const narrow = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 0.5,
      maxCols: 20,
      maxRows: 20,
      maxLayers: 16,
      maxStamps: 4000,
      stockTopZ: 0,
      stockRectXYMm: { minX: 0, maxX: 50, minY: 0, maxY: 40 }
    })
    const noRect = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 0.5,
      maxCols: 20,
      maxRows: 20,
      maxLayers: 16,
      maxStamps: 4000,
      stockTopZ: 0
    })
    expect(narrow).not.toBeNull()
    expect(noRect).not.toBeNull()
    if (!narrow || !noRect) return
    expect(narrow.cols * narrow.rows).toBeGreaterThanOrEqual(noRect.cols * noRect.rows)
  })

  it('flat toolShape carves more voxels than ball for an angled cut (cylinder vs sphere)', () => {
    // Angled feed going diagonally in Z — for a sphere stamp the effective XY radius
    // shrinks away from the stamp centre; a cylinder stamp uses full toolR in XY at every Z.
    // Therefore flat (cylinder) carves >= ball (sphere) for the same path.
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 4, y1: 0, z1: -2 }]
    const base = { toolRadiusMm: 1.5, maxCols: 20, maxRows: 20, maxLayers: 20, maxStamps: 8000, stockTopZ: 0 }
    const flatResult = buildVoxelRemovalFromCuttingSegments(segs, { ...base, toolShape: 'flat' })
    const ballResult = buildVoxelRemovalFromCuttingSegments(segs, { ...base, toolShape: 'ball' })
    expect(flatResult).not.toBeNull()
    expect(ballResult).not.toBeNull()
    if (!flatResult || !ballResult) return
    // Cylinder removes at least as many voxels as sphere along an angled path
    expect(flatResult.carvedVoxelCount).toBeGreaterThanOrEqual(ballResult.carvedVoxelCount)
  })

  it('default toolShape (flat) matches explicit flat', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 4, y1: 0, z1: -0.5 }]
    const base = { toolRadiusMm: 1.0, maxCols: 20, maxRows: 20, maxLayers: 16, maxStamps: 6000, stockTopZ: 0 }
    const defaultResult = buildVoxelRemovalFromCuttingSegments(segs, base)
    const explicitFlat = buildVoxelRemovalFromCuttingSegments(segs, { ...base, toolShape: 'flat' })
    expect(defaultResult).not.toBeNull()
    expect(explicitFlat).not.toBeNull()
    if (!defaultResult || !explicitFlat) return
    expect(defaultResult.carvedVoxelCount).toBe(explicitFlat.carvedVoxelCount)
  })

  it('stampsCapped is false when budget is sufficient', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 4, y1: 0, z1: -0.5 }]
    const v = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 0.5,
      maxCols: 16,
      maxRows: 16,
      maxLayers: 12,
      maxStamps: 50000,
      stockTopZ: 0
    })
    expect(v).not.toBeNull()
    expect(v!.stampsCapped).toBe(false)
  })

  it('stampsCapped is true when maxStamps budget is exhausted', () => {
    // Long toolpath (X: 0→50) with tiny tool and strict stamp budget — must cap
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 50, y1: 0, z1: -1 }]
    const v = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1.0,
      maxCols: 24,
      maxRows: 24,
      maxLayers: 16,
      maxStamps: 3, // far below what this path requires
      stockTopZ: 0
    })
    expect(v).not.toBeNull()
    expect(v!.stampsCapped).toBe(true)
  })

  it('quality presets produce monotonically finer grids: fast < balanced < detailed', () => {
    // A simple cutting segment that all three presets can process
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: -2, x1: 10, y1: 0, z1: -2 }
    ]
    const baseOpts = { toolRadiusMm: 1, stockTopZ: 0, stockBottomZ: -5 }

    const fast = buildVoxelRemovalFromCuttingSegments(segs, {
      ...baseOpts,
      ...VOXEL_SIM_QUALITY_PRESETS.fast
    })
    const balanced = buildVoxelRemovalFromCuttingSegments(segs, {
      ...baseOpts,
      ...VOXEL_SIM_QUALITY_PRESETS.balanced
    })
    const detailed = buildVoxelRemovalFromCuttingSegments(segs, {
      ...baseOpts,
      ...VOXEL_SIM_QUALITY_PRESETS.detailed
    })

    expect(fast).not.toBeNull()
    expect(balanced).not.toBeNull()
    expect(detailed).not.toBeNull()
    if (!fast || !balanced || !detailed) return

    // Grid volume (cols × rows × layers) should increase with quality
    const fastVol = fast.cols * fast.rows * fast.layers
    const balancedVol = balanced.cols * balanced.rows * balanced.layers
    const detailedVol = detailed.cols * detailed.rows * detailed.layers

    expect(balancedVol).toBeGreaterThanOrEqual(fastVol)
    expect(detailedVol).toBeGreaterThanOrEqual(balancedVol)

    // cellMm should decrease (finer) with higher quality
    expect(balanced.cellMm).toBeLessThanOrEqual(fast.cellMm + 1e-6)
    expect(detailed.cellMm).toBeLessThanOrEqual(balanced.cellMm + 1e-6)
  })
})
