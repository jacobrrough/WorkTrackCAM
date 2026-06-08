import { describe, expect, it } from 'vitest'
import {
  carveSegmentIntoStock,
  carveToolpathIntoStock,
  cloneStockModel,
  createBoxStockModel,
  remainingCellsAboveFloor,
  remainingDepthAt,
  sampleStockTopZ,
  stockRemainingVolumeMm3,
  type StockModel
} from './cam-stock-model'
import { buildPartHeightField } from './cam-stock-part-section'
import type { HeightField2d5 } from './cam-heightfield-2d5'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

/** Flat part field at a constant Z over the whole region (helper for clear-set tests). */
function flatPartField(z: number, cols = 8, rows = 8, cellMm = 5): HeightField2d5 {
  const topZ = new Float32Array(cols * rows)
  topZ.fill(z)
  return { originX: 0, originY: 0, cellMm, cols, rows, topZ, stockTopZ: z }
}

describe('createBoxStockModel', () => {
  it('fills topZ flat at stockTopZ everywhere and records floorZ', () => {
    const m = createBoxStockModel({
      minX: 0, minY: 0, maxX: 40, maxY: 30, stockTopZ: 2, floorZ: -10, maxCols: 32, maxRows: 24
    })
    expect(m.stockTopZ).toBe(2)
    expect(m.floorZ).toBe(-10)
    expect(Array.from(m.topZ).every((z) => z === 2)).toBe(true)
    expect(m.originX).toBe(0)
    expect(m.originY).toBe(0)
  })

  it('produces sane, in-bounds grid dimensions', () => {
    const m = createBoxStockModel({
      minX: 0, minY: 0, maxX: 100, maxY: 50, stockTopZ: 0, floorZ: -5, maxCols: 64, maxRows: 64
    })
    expect(m.cols).toBeGreaterThanOrEqual(2)
    expect(m.rows).toBeGreaterThanOrEqual(2)
    expect(m.cols).toBeLessThanOrEqual(64)
    expect(m.rows).toBeLessThanOrEqual(64)
    expect(m.topZ.length).toBe(m.cols * m.rows)
    expect(m.cellMm).toBeGreaterThan(0)
  })

  it('respects max cols / rows caps even for a large region', () => {
    const m = createBoxStockModel({
      minX: 0, minY: 0, maxX: 1000, maxY: 1000, stockTopZ: 0, floorZ: -50, maxCols: 20, maxRows: 16
    })
    expect(m.cols).toBeLessThanOrEqual(20)
    expect(m.rows).toBeLessThanOrEqual(16)
  })

  it('respects an explicit cellMm but still caps cols/rows', () => {
    // 100mm span at 1mm cells would want 100 cols, but cap is 32 → grid grows the cell.
    const m = createBoxStockModel({
      minX: 0, minY: 0, maxX: 100, maxY: 100, stockTopZ: 0, floorZ: -5, cellMm: 1, maxCols: 32, maxRows: 32
    })
    expect(m.cols).toBeLessThanOrEqual(32)
    expect(m.rows).toBeLessThanOrEqual(32)
  })

  it('honors a reasonable explicit cellMm within caps', () => {
    const m = createBoxStockModel({
      minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -5, cellMm: 2, maxCols: 64, maxRows: 64
    })
    expect(m.cellMm).toBeCloseTo(2, 5)
    expect(m.cols).toBe(10)
    expect(m.rows).toBe(10)
  })

  it('caps floorZ at stockTopZ when floorZ is given ABOVE the stock top (monotonicity guard)', () => {
    // Degenerate config: floorZ (5) above stockTopZ (0). Without the cap the
    // post-carve floor clamp would RAISE every cell 0→5 (a monotonicity break).
    const m = createBoxStockModel({
      minX: 0, minY: 0, maxX: 10, maxY: 10, stockTopZ: 0, floorZ: 5, maxCols: 10, maxRows: 10
    })
    expect(m.floorZ).toBe(0) // capped to stockTopZ, NOT the requested 5
    const before = cloneStockModel(m)
    carveSegmentIntoStock(m, { kind: 'feed', x0: 0, y0: 5, z0: -3, x1: 10, y1: 5, z1: -3 }, 2)
    // No cell may rise above its pre-carve value, and with floor==top nothing is removable.
    for (let i = 0; i < m.topZ.length; i++) {
      expect(m.topZ[i]!).toBeLessThanOrEqual(before.topZ[i]! + 1e-6)
    }
    expect(Array.from(m.topZ).every((z) => z === 0)).toBe(true)
  })
})

describe('carveSegmentIntoStock', () => {
  function freshModel(): StockModel {
    return createBoxStockModel({
      minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -3, maxCols: 40, maxRows: 40
    })
  }

  it('lowers topZ under the path', () => {
    const m = freshModel()
    const seg: ToolpathSegment3 = { kind: 'feed', x0: 2, y0: 10, z0: -2, x1: 18, y1: 10, z1: -2 }
    carveSegmentIntoStock(m, seg, 1)
    // Sample on the path centre line → should be cut to -2.
    expect(sampleStockTopZ(m, 10, 10)).toBeLessThanOrEqual(-2 + 1e-3)
  })

  it('never lowers topZ below floorZ', () => {
    const m = freshModel()
    // Commanded Z (-9) is far below the floor (-3).
    const seg: ToolpathSegment3 = { kind: 'feed', x0: 2, y0: 10, z0: -9, x1: 18, y1: 10, z1: -9 }
    carveSegmentIntoStock(m, seg, 1.5)
    const min = Math.min(...Array.from(m.topZ))
    expect(min).toBeGreaterThanOrEqual(m.floorZ - 1e-6)
  })

  it('never raises topZ anywhere (monotonic vs a pre-carve clone)', () => {
    const m = freshModel()
    const before = cloneStockModel(m)
    const seg: ToolpathSegment3 = { kind: 'feed', x0: 0, y0: 5, z0: -1.5, x1: 20, y1: 15, z1: -1.5 }
    carveSegmentIntoStock(m, seg, 2)
    for (let i = 0; i < m.topZ.length; i++) {
      expect(m.topZ[i]!).toBeLessThanOrEqual(before.topZ[i]! + 1e-6)
    }
  })

  it('leaves cells outside the swept tool unchanged', () => {
    const m = freshModel()
    const seg: ToolpathSegment3 = { kind: 'feed', x0: 2, y0: 2, z0: -2, x1: 6, y1: 2, z1: -2 }
    carveSegmentIntoStock(m, seg, 1)
    // A point in the opposite corner, far from the short cut, must still be at stockTopZ.
    const farZ = sampleStockTopZ(m, 18, 18)
    expect(farZ).toBeCloseTo(m.stockTopZ, 5)
  })

  it('preserves min-semantics: a shallow pass does not overwrite a deeper cut', () => {
    const m = freshModel()
    const deep: ToolpathSegment3 = { kind: 'feed', x0: 2, y0: 10, z0: -2.5, x1: 18, y1: 10, z1: -2.5 }
    const shallow: ToolpathSegment3 = { kind: 'feed', x0: 2, y0: 10, z0: -0.5, x1: 18, y1: 10, z1: -0.5 }
    carveSegmentIntoStock(m, deep, 1)
    carveSegmentIntoStock(m, shallow, 1)
    expect(sampleStockTopZ(m, 10, 10)).toBeLessThanOrEqual(-2.5 + 1e-3)
  })

  it('ignores a non-finite segment and keeps the model all-finite', () => {
    const m = freshModel()
    const before = cloneStockModel(m)
    const bad: ToolpathSegment3 = { kind: 'feed', x0: NaN, y0: 10, z0: -2, x1: 18, y1: 10, z1: -2 }
    carveSegmentIntoStock(m, bad, 1)
    expect(Array.from(m.topZ).every((z) => Number.isFinite(z))).toBe(true)
    expect(Array.from(m.topZ)).toEqual(Array.from(before.topZ))

    const badZ: ToolpathSegment3 = { kind: 'feed', x0: 2, y0: 10, z0: Infinity, x1: 18, y1: 10, z1: -Infinity }
    carveSegmentIntoStock(m, badZ, 1)
    expect(Array.from(m.topZ).every((z) => Number.isFinite(z))).toBe(true)
    expect(Array.from(m.topZ)).toEqual(Array.from(before.topZ))
  })
})

describe('carveToolpathIntoStock', () => {
  it('carves a multi-segment path equivalently to per-segment carving', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 2, y0: 8, z0: -2, x1: 18, y1: 8, z1: -2 },
      { kind: 'feed', x0: 18, y0: 12, z0: -2, x1: 2, y1: 12, z1: -2 }
    ]
    const a = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -3, maxCols: 40, maxRows: 40 })
    const b = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -3, maxCols: 40, maxRows: 40 })
    carveToolpathIntoStock(a, segs, 1)
    for (const s of segs) carveSegmentIntoStock(b, s, 1)
    expect(Array.from(a.topZ)).toEqual(Array.from(b.topZ))
    expect(Math.min(...Array.from(a.topZ))).toBeGreaterThanOrEqual(a.floorZ - 1e-6)
  })

  it('skips non-finite segments in the batch', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 2, y0: 10, z0: -2, x1: 18, y1: 10, z1: -2 },
      { kind: 'feed', x0: NaN, y0: 10, z0: -2, x1: 18, y1: 10, z1: -2 }
    ]
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -3, maxCols: 40, maxRows: 40 })
    carveToolpathIntoStock(m, segs, 1)
    expect(Array.from(m.topZ).every((z) => Number.isFinite(z))).toBe(true)
    expect(sampleStockTopZ(m, 10, 10)).toBeLessThanOrEqual(-2 + 1e-3)
  })
})

describe('sampleStockTopZ', () => {
  it('returns stockTopZ outside any cut and the lowered value inside a cut', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 30, maxY: 30, stockTopZ: 1, floorZ: -4, maxCols: 60, maxRows: 60 })
    expect(sampleStockTopZ(m, 15, 15)).toBeCloseTo(1, 5)
    carveSegmentIntoStock(m, { kind: 'feed', x0: 5, y0: 15, z0: -2, x1: 25, y1: 15, z1: -2 }, 1.5)
    expect(sampleStockTopZ(m, 15, 15)).toBeLessThanOrEqual(-2 + 1e-3)
    // A point far from the path is still uncut.
    expect(sampleStockTopZ(m, 15, 2)).toBeCloseTo(1, 1)
  })

  it('returns stockTopZ for out-of-bounds coordinates', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 10, maxY: 10, stockTopZ: 3, floorZ: -2, maxCols: 20, maxRows: 20 })
    expect(sampleStockTopZ(m, -100, -100)).toBe(3)
    expect(sampleStockTopZ(m, NaN, 5)).toBe(3)
  })
})

describe('remainingDepthAt', () => {
  it('reports full depth before carving and ~0 after carving down to the part top', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 30, maxY: 30, stockTopZ: 0, floorZ: -5, maxCols: 60, maxRows: 60 })
    const partTopZ = -3
    // Before carving: stock top 0, part top -3 → 3 mm to remove.
    expect(remainingDepthAt(m, 15, 15, partTopZ)).toBeCloseTo(3, 1)
    // Carve a swath down to the part top.
    carveSegmentIntoStock(m, { kind: 'feed', x0: 3, y0: 15, z0: -3, x1: 27, y1: 15, z1: -3 }, 2)
    expect(remainingDepthAt(m, 15, 15, partTopZ)).toBeCloseTo(0, 1)
  })

  it('clamps the target to floorZ when the part top is below the floor', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 10, maxY: 10, stockTopZ: 0, floorZ: -2, maxCols: 20, maxRows: 20 })
    // part top -8 is below the floor (-2) → only 2 mm is reachable.
    expect(remainingDepthAt(m, 5, 5, -8)).toBeCloseTo(2, 5)
  })

  it('returns 0 for out-of-bounds / non-finite queries gracefully', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 10, maxY: 10, stockTopZ: 0, floorZ: -2, maxCols: 20, maxRows: 20 })
    // Out of bounds → stock top falls back to stockTopZ (0); part top 0 → depth 0.
    expect(remainingDepthAt(m, -50, -50, 0)).toBe(0)
    expect(remainingDepthAt(m, 5, 5, NaN)).toBeGreaterThanOrEqual(0)
  })
})

describe('remainingCellsAboveFloor', () => {
  it('returns cells over a sub-region before carving and empties after carving that region', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 40, maxY: 40, stockTopZ: 0, floorZ: -5, maxCols: 8, maxRows: 8 })
    // Part field deep below stock everywhere → every cell is "to clear" initially.
    const part = flatPartField(-4, 8, 8, 5)
    const before = remainingCellsAboveFloor(m, part, 0)
    expect(before.length).toBeGreaterThan(0)
    // Each reported cell carries center coords + the two Z values.
    expect(before[0]!.stockTopZ).toBeCloseTo(0, 5)
    expect(before[0]!.partTopZ).toBeCloseTo(-4, 5)

    // Carve the WHOLE region down to part top (-4) with a wide raster so every cell clears.
    for (let y = 2; y <= 38; y += 2) {
      carveSegmentIntoStock(m, { kind: 'feed', x0: 0, y0: y, z0: -4, x1: 40, y1: y, z1: -4 }, 3)
    }
    const after = remainingCellsAboveFloor(m, part, 0)
    expect(after.length).toBe(0)
  })

  it('respects the allowance: stock just above part+allowance is reported, at/under it is not', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -5, maxCols: 4, maxRows: 4 })
    const part = flatPartField(-1, 4, 4, 5)
    // allowance 1.5 → threshold = -1 + 1.5 = 0.5; stock top is 0 < 0.5 → nothing to clear.
    expect(remainingCellsAboveFloor(m, part, 1.5).length).toBe(0)
    // allowance 0 → threshold -1; stock top 0 > -1 → all cells to clear.
    expect(remainingCellsAboveFloor(m, part, 0).length).toBe(16)
  })

  it('atOrAboveZ gates cells by stock top Z level', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -5, maxCols: 4, maxRows: 4 })
    const part = flatPartField(-4, 4, 4, 5)
    // All cells exceed part+0; gate at Z >= 0 keeps them (stock top is 0).
    expect(remainingCellsAboveFloor(m, part, 0, 0).length).toBe(16)
    // Gate at Z >= 1 (above the flat stock top of 0) → no cells qualify.
    expect(remainingCellsAboveFloor(m, part, 0, 1).length).toBe(0)
  })
})

describe('stockRemainingVolumeMm3', () => {
  it('computes full box volume above the floor with no part field', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 10, maxY: 10, stockTopZ: 0, floorZ: -4, cellMm: 1, maxCols: 64, maxRows: 64 })
    // 10×10 footprint, 4 mm of stock above the floor → ~400 mm³ (grid is exactly 10×10 @ 1mm).
    expect(stockRemainingVolumeMm3(m)).toBeCloseTo(400, 0)
  })

  it('drops toward zero as the region is carved to the part top', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -5, maxCols: 16, maxRows: 16 })
    const part = flatPartField(-3, 16, 16, 20 / 16)
    const v0 = stockRemainingVolumeMm3(m, part, 0)
    for (let y = 1; y <= 19; y += 1) {
      carveSegmentIntoStock(m, { kind: 'feed', x0: 0, y0: y, z0: -3, x1: 20, y1: y, z1: -3 }, 2)
    }
    const v1 = stockRemainingVolumeMm3(m, part, 0)
    expect(v0).toBeGreaterThan(0)
    expect(v1).toBeLessThan(v0)
  })
})

describe('cloneStockModel', () => {
  it('deep-copies so mutating the clone does not touch the original', () => {
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -3, maxCols: 40, maxRows: 40 })
    const c = cloneStockModel(m)
    expect(c.topZ).not.toBe(m.topZ)
    expect(Array.from(c.topZ)).toEqual(Array.from(m.topZ))
    carveSegmentIntoStock(c, { kind: 'feed', x0: 2, y0: 10, z0: -2, x1: 18, y1: 10, z1: -2 }, 2)
    // Original must remain pristine (all stockTopZ), clone changed.
    expect(Array.from(m.topZ).every((z) => z === 0)).toBe(true)
    expect(Math.min(...Array.from(c.topZ))).toBeLessThan(0)
  })

  it('copies all scalar fields', () => {
    const m = createBoxStockModel({ minX: 1, minY: 2, maxX: 21, maxY: 22, stockTopZ: 4, floorZ: -6, maxCols: 30, maxRows: 30 })
    const c = cloneStockModel(m)
    expect(c.originX).toBe(m.originX)
    expect(c.originY).toBe(m.originY)
    expect(c.cellMm).toBe(m.cellMm)
    expect(c.cols).toBe(m.cols)
    expect(c.rows).toBe(m.rows)
    expect(c.stockTopZ).toBe(m.stockTopZ)
    expect(c.floorZ).toBe(m.floorZ)
  })
})

describe('determinism', () => {
  it('identical inputs produce byte-identical topZ', () => {
    const build = (): StockModel => {
      const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 30, maxY: 20, stockTopZ: 0, floorZ: -4, maxCols: 48, maxRows: 32 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 2, y0: 5, z0: -2, x1: 28, y1: 5, z1: -2 },
        { kind: 'feed', x0: 28, y0: 10, z0: -3, x1: 2, y1: 10, z1: -3 },
        { kind: 'feed', x0: 2, y0: 15, z0: -1.5, x1: 28, y1: 15, z1: -1.5 }
      ]
      carveToolpathIntoStock(m, segs, 1.25)
      return m
    }
    const a = build()
    const b = build()
    expect(Array.from(a.topZ)).toEqual(Array.from(b.topZ))
    // Byte-identical at the buffer level too.
    expect(new Uint8Array(a.topZ.buffer)).toEqual(new Uint8Array(b.topZ.buffer))
  })
})

describe('integration with buildPartHeightField', () => {
  it('clears against a real part field built from a flat-top box mesh', () => {
    // Flat top at Z=-2 over a 0..20 square (two triangles).
    const top = -2
    const tris = [
      [[0, 0, top], [20, 0, top], [20, 20, top]],
      [[0, 0, top], [20, 20, top], [0, 20, top]]
    ] as const
    const part = buildPartHeightField(tris, { minX: 0, minY: 0, maxX: 20, maxY: 20, maxCols: 16, maxRows: 16 })
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -5, maxCols: 16, maxRows: 16 })
    // Before: stock at 0, part at -2 → material everywhere.
    expect(remainingCellsAboveFloor(m, part, 0).length).toBeGreaterThan(0)
    // Carve a dense raster down to the part top.
    for (let y = 0.5; y <= 19.5; y += 0.75) {
      carveSegmentIntoStock(m, { kind: 'feed', x0: 0, y0: y, z0: top, x1: 20, y1: y, z1: top }, 1.5)
    }
    expect(remainingCellsAboveFloor(m, part, 0).length).toBe(0)
  })

  it('reports honest part tops at footprint-edge cells (no emptyZ bilinear bleed)', () => {
    // Part footprint (0..10) is SMALLER than the stock region (0..20), so the
    // part field's out-of-footprint cells hold the large-negative emptyZ sentinel.
    const top = -2
    const tris = [
      [[0, 0, top], [10, 0, top], [10, 10, top]],
      [[0, 0, top], [10, 10, top], [0, 10, top]]
    ] as const
    const part = buildPartHeightField(tris, { minX: 0, minY: 0, maxX: 20, maxY: 20, maxCols: 20, maxRows: 20 })
    const m = createBoxStockModel({ minX: 0, minY: 0, maxX: 20, maxY: 20, stockTopZ: 0, floorZ: -5, maxCols: 20, maxRows: 20 })
    const cells = remainingCellsAboveFloor(m, part, 0)
    // Nearest-neighbour sampling means every partTopZ is EITHER the true part top
    // (≈ -2, inside the footprint) OR the deep emptyZ sentinel (outside) — never a
    // bilinear-bled in-between value (the bug produced ~ -7.5e5 at inside-edge cells).
    for (const c of cells) {
      const isRealPartTop = Math.abs(c.partTopZ - top) < 1e-3
      const isEmptySentinel = c.partTopZ < -1e5
      expect(isRealPartTop || isEmptySentinel).toBe(true)
    }
    // A cell just inside the footprint edge must report the TRUE part top, not a bled value.
    const insideEdge = cells.find((c) => c.x > 8 && c.x < 10 && c.y > 8 && c.y < 10)
    expect(insideEdge).toBeDefined()
    expect(insideEdge!.partTopZ).toBeCloseTo(top, 2)
  })
})
