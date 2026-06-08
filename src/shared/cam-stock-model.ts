/**
 * In-process workpiece (IPW) / remaining-stock model for CAM strategies.
 *
 * Unlike {@link ../cam-heightfield-2d5 | cam-heightfield-2d5}, which builds a
 * 2.5D height field **post-hoc** from finished toolpath segments, this model is
 * something a strategy *carves into and queries DURING* toolpath generation.
 *
 * A {@link StockModel} is a {@link HeightField2d5}-shaped grid (so it can be
 * sampled with the existing bilinear {@link sampleHeightFieldZ}) plus a
 * `floorZ` clamp: `topZ` holds the **remaining** solid top of the workpiece at
 * each cell. Carving lowers `topZ` under the swept tool but never below
 * `floorZ`, and never raises it. Roughing (Stack B) and rest machining
 * (Stack C) share this representation: they carve passes in, then query what
 * material is still above the part surface (+ allowance) to decide where to go.
 *
 * Carving REUSES the exact disk/segment stamp math exported from
 * `cam-heightfield-2d5` ({@link stampSegment}) — there is no duplicated
 * footprint geometry here.
 *
 * Pure math / data-structure module: NO G-code emission, NO file I/O.
 */

import {
  sampleHeightFieldZ,
  stampSegment,
  type HeightField2d5,
  type HeightFieldToolShape
} from './cam-heightfield-2d5'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

/**
 * Remaining-stock (in-process workpiece) model.
 *
 * Shaped exactly like a {@link HeightField2d5} so it reuses the bilinear
 * sampler, with an added hard `floorZ` floor: `topZ[i]` is the remaining solid
 * top of the workpiece at cell `i` and is always `>= floorZ`. Carving only ever
 * lowers `topZ` (toward `floorZ`); it never raises it.
 */
export type StockModel = HeightField2d5 & {
  /** Hard lower bound for the remaining top surface; carving never cuts below this Z. */
  floorZ: number
}

/** Default grid resolution caps (cols / rows) when neither `cellMm` nor explicit caps are given. */
const DEFAULT_STOCK_MAX_COLS = 256
const DEFAULT_STOCK_MAX_ROWS = 256
/** Minimum grid dimension so a stock model always has a usable bilinear neighbourhood. */
const STOCK_MIN_DIM = 2
/** Smallest cell size (mm) the grid will use, mirroring the heightfield floor. */
const STOCK_MIN_CELL_MM = 0.1

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

/**
 * Options for {@link createBoxStockModel}. The XY region is `[minX,maxX] ×
 * [minY,maxY]`; `stockTopZ` is the initial flat top; `floorZ` is the hard
 * lower clamp. Resolution is set either by `cellMm` (explicit cell size) or by
 * `maxCols`/`maxRows` (the grid is sized to fit the region within those caps).
 */
export type CreateBoxStockModelOptions = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Initial flat top Z of the stock (mm). */
  stockTopZ: number
  /** Hard lower bound — carving never lowers `topZ` below this (mm). */
  floorZ: number
  /** Upper bound on grid columns (X). Defaults to {@link DEFAULT_STOCK_MAX_COLS}. */
  maxCols?: number
  /** Upper bound on grid rows (Y). Defaults to {@link DEFAULT_STOCK_MAX_ROWS}. */
  maxRows?: number
  /** Explicit cell size (mm). When set it drives the grid resolution (still capped by maxCols/maxRows). */
  cellMm?: number
}

/**
 * Create a flat-top box stock model over an XY region. `topZ` is filled with
 * `stockTopZ` everywhere (uncut), `stockTopZ` is recorded for the bilinear
 * out-of-bounds fallback, and `floorZ` is the hard carve floor.
 *
 * Grid resolution: if `cellMm` is given it sets the cell size (clamped to a
 * sane minimum and re-derived so cols/rows do not exceed the caps); otherwise
 * the region is divided into at most `maxCols × maxRows` cells.
 */
export function createBoxStockModel(opts: CreateBoxStockModelOptions): StockModel {
  const maxCols = clampInt(opts.maxCols ?? DEFAULT_STOCK_MAX_COLS, STOCK_MIN_DIM, 4096)
  const maxRows = clampInt(opts.maxRows ?? DEFAULT_STOCK_MAX_ROWS, STOCK_MIN_DIM, 4096)

  const minX = Math.min(opts.minX, opts.maxX)
  const maxX = Math.max(opts.minX, opts.maxX)
  const minY = Math.min(opts.minY, opts.maxY)
  const maxY = Math.max(opts.minY, opts.maxY)

  const spanX = Math.max(maxX - minX, STOCK_MIN_CELL_MM)
  const spanY = Math.max(maxY - minY, STOCK_MIN_CELL_MM)

  // Resolve cell size + dims. Prefer explicit cellMm; otherwise fit the region
  // within the col/row caps. Either way, re-derive cols/rows from the final
  // cell size and clamp to [STOCK_MIN_DIM, cap] so the grid is always usable.
  let cellMm: number
  if (typeof opts.cellMm === 'number' && Number.isFinite(opts.cellMm) && opts.cellMm > 0) {
    cellMm = Math.max(opts.cellMm, STOCK_MIN_CELL_MM)
  } else {
    cellMm = Math.max(spanX / maxCols, spanY / maxRows, STOCK_MIN_CELL_MM)
  }

  let cols = clampInt(Math.ceil(spanX / cellMm), STOCK_MIN_DIM, maxCols)
  let rows = clampInt(Math.ceil(spanY / cellMm), STOCK_MIN_DIM, maxRows)
  // If a small explicit cellMm would overrun the caps, grow the cell to fit.
  if (Math.ceil(spanX / cellMm) > maxCols || Math.ceil(spanY / cellMm) > maxRows) {
    cellMm = Math.max(spanX / maxCols, spanY / maxRows, STOCK_MIN_CELL_MM)
    cols = clampInt(Math.ceil(spanX / cellMm), STOCK_MIN_DIM, maxCols)
    rows = clampInt(Math.ceil(spanY / cellMm), STOCK_MIN_DIM, maxRows)
  }

  const stockTopZ = opts.stockTopZ
  // Cap the floor at the stock top: a floorZ ABOVE the initial surface would make
  // the post-carve floor clamp RAISE every cell above its pre-carve value, breaking
  // the monotonic "carving only ever lowers topZ" guarantee. Capped, floorZ ==
  // stockTopZ degenerately means "no material to remove" (every carve clamps back up).
  const floorZ = Math.min(opts.floorZ, stockTopZ)
  const topZ = new Float32Array(cols * rows)
  topZ.fill(stockTopZ)

  return { originX: minX, originY: minY, cellMm, cols, rows, topZ, stockTopZ, floorZ }
}

/**
 * Clamp every cell of `topZ` up to `>= floorZ`. Safe to call after a stamp:
 * the only cells below `floorZ` are ones the stamp just cut there, so raising
 * them to `floorZ` never lifts a cell above its pre-carve value (which was
 * already `>= floorZ` by the model invariant). Preserves min-semantics.
 */
function clampTopZToFloor(model: StockModel): void {
  const { topZ, floorZ } = model
  if (!Number.isFinite(floorZ)) return
  for (let i = 0; i < topZ.length; i++) {
    const v = topZ[i]!
    if (v < floorZ) topZ[i] = floorZ
  }
}

/**
 * NEAREST-cell sample of a height field's top Z at world (x, y).
 *
 * Unlike the bilinear {@link sampleHeightFieldZ}, this never blends a real
 * surface value with a neighbouring sentinel cell. It is the correct sampler
 * for the PART field, whose out-of-footprint cells hold a large-negative
 * `emptyZ` sentinel: bilinear sampling bleeds that sentinel into footprint-edge
 * cells and reports a bogus, far-too-deep part top (which a consumer reading it
 * as a cut target would gouge to). A step function is the honest representation
 * of an upper-envelope surface against an empty sentinel. Returns the field's
 * `stockTopZ` fallback for out-of-bounds coordinates.
 */
function sampleHeightFieldNearest(hf: HeightField2d5, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return hf.stockTopZ
  const i = Math.floor((x - hf.originX) / hf.cellMm)
  const j = Math.floor((y - hf.originY) / hf.cellMm)
  if (i < 0 || i >= hf.cols || j < 0 || j >= hf.rows) return hf.stockTopZ
  const v = hf.topZ[j * hf.cols + i]
  return v !== undefined && Number.isFinite(v) ? v : hf.stockTopZ
}

/**
 * Carve a single toolpath segment into the stock: lower `topZ` under the swept
 * tool (via the shared {@link stampSegment} sweep), then clamp every cell back
 * up to `>= floorZ`. Non-finite segment coordinates are ignored (the model
 * stays all-finite). Min-semantics are preserved — a shallower pass never
 * overwrites a deeper existing cut.
 *
 * Only `feed`/`rapid` geometry matters here: the caller decides which segments
 * are cutting. (A rapid above stock simply stamps at a Z above `stockTopZ`,
 * which lowers nothing.)
 */
export function carveSegmentIntoStock(
  model: StockModel,
  seg: ToolpathSegment3,
  toolRadiusMm: number,
  toolShape: HeightFieldToolShape = 'flat'
): void {
  if (
    !Number.isFinite(seg.x0) ||
    !Number.isFinite(seg.y0) ||
    !Number.isFinite(seg.z0) ||
    !Number.isFinite(seg.x1) ||
    !Number.isFinite(seg.y1) ||
    !Number.isFinite(seg.z1)
  ) {
    return
  }
  const r = Math.max(STOCK_MIN_CELL_MM * 0.5, toolRadiusMm)
  if (!Number.isFinite(r)) return

  // stampSegment lowers topZ under the swept disk (min-semantics, with its own
  // non-finite cutZ guard). It may dip below floorZ; clampTopZToFloor restores
  // the floor afterwards.
  stampSegment(model, seg.x0, seg.y0, seg.x1, seg.y1, seg.z0, seg.z1, r, toolShape)
  clampTopZToFloor(model)
}

/**
 * Carve a whole ordered list of segments into the stock. Equivalent to calling
 * {@link carveSegmentIntoStock} for each segment but clamps the floor once at
 * the end (the per-segment clamp is skipped for the interior segments for
 * throughput; the final state is identical because the floor clamp is
 * idempotent and order-independent).
 */
export function carveToolpathIntoStock(
  model: StockModel,
  segments: ReadonlyArray<ToolpathSegment3>,
  toolRadiusMm: number,
  toolShape: HeightFieldToolShape = 'flat'
): void {
  const r = Math.max(STOCK_MIN_CELL_MM * 0.5, toolRadiusMm)
  if (!Number.isFinite(r)) return
  for (const seg of segments) {
    if (
      !Number.isFinite(seg.x0) ||
      !Number.isFinite(seg.y0) ||
      !Number.isFinite(seg.z0) ||
      !Number.isFinite(seg.x1) ||
      !Number.isFinite(seg.y1) ||
      !Number.isFinite(seg.z1)
    ) {
      continue
    }
    stampSegment(model, seg.x0, seg.y0, seg.x1, seg.y1, seg.z0, seg.z1, r, toolShape)
  }
  clampTopZToFloor(model)
}

/**
 * Bilinear sample of the remaining stock top Z at world (x, y). Reuses
 * {@link sampleHeightFieldZ}; returns `stockTopZ` (uncut surface) outside the
 * grid bounds.
 *
 * NOTE for callers sampling by world coords: out-of-bounds returns the UNCUT
 * stock surface (`stockTopZ`), NOT "no material". A strategy that rasters
 * slightly outside the stock region reads full uncut stock there — iterate the
 * in-grid to-clear set ({@link remainingCellsAboveFloor}) rather than world-coord
 * sampling at the edges to avoid synthesising phantom passes off the model.
 */
export function sampleStockTopZ(model: StockModel, x: number, y: number): number {
  return sampleHeightFieldZ(model, x, y)
}

/**
 * Remaining material depth above the part surface at world (x, y): how much
 * stock is still left to remove down to `partTopZ` (but never below `floorZ`).
 *
 * `max(0, stockTop - max(partTopZ, floorZ))`. Zero when the stock has already
 * been cut down to (or below) the part top / floor at that point.
 */
export function remainingDepthAt(
  model: StockModel,
  x: number,
  y: number,
  partTopZ: number
): number {
  const stockTop = sampleStockTopZ(model, x, y)
  if (!Number.isFinite(stockTop)) return 0
  const floor = Number.isFinite(model.floorZ) ? model.floorZ : -Infinity
  const part = Number.isFinite(partTopZ) ? partTopZ : floor
  const target = Math.max(part, floor)
  const depth = stockTop - target
  return depth > 0 ? depth : 0
}

/** One cell flagged as still needing material removed, with its center coords. */
export type StockToClearCell = {
  /** Cell-center world X (mm). */
  x: number
  /** Cell-center world Y (mm). */
  y: number
  /** Remaining stock top Z at this cell (mm). */
  stockTopZ: number
  /** Part surface top Z sampled at this cell center (mm). */
  partTopZ: number
}

/**
 * The TO-CLEAR set: cells (by center coords) where the remaining stock top
 * still exceeds `partTopZ + allowanceMm`. This is what roughing (Stack B) and
 * rest machining (Stack C) consume to decide where material is left.
 *
 * `partField` is sampled (bilinear, via {@link sampleHeightFieldZ}) at each
 * cell center to get that cell's part-surface top. When `atOrAboveZ` is given,
 * only cells whose stock top is `>= atOrAboveZ` are reported (lets a strategy
 * ask "what is left at or above this Z level").
 */
export function remainingCellsAboveFloor(
  model: StockModel,
  partField: HeightField2d5,
  allowanceMm: number,
  atOrAboveZ?: number
): StockToClearCell[] {
  const { originX, originY, cellMm, cols, rows, topZ } = model
  const allowance = Number.isFinite(allowanceMm) ? allowanceMm : 0
  const hasZGate = typeof atOrAboveZ === 'number' && Number.isFinite(atOrAboveZ)
  const out: StockToClearCell[] = []

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const stockTop = topZ[j * cols + i]!
      if (!Number.isFinite(stockTop)) continue
      if (hasZGate && stockTop < atOrAboveZ - 1e-9) continue
      const cx = originX + (i + 0.5) * cellMm
      const cy = originY + (j + 0.5) * cellMm
      const partTopZ = sampleHeightFieldNearest(partField, cx, cy)
      const threshold = (Number.isFinite(partTopZ) ? partTopZ : -Infinity) + allowance
      if (stockTop > threshold + 1e-9) {
        out.push({ x: cx, y: cy, stockTopZ: stockTop, partTopZ })
      }
    }
  }
  return out
}

/** Deep copy of a stock model (fresh `Float32Array`); mutating the clone never touches the original. */
export function cloneStockModel(model: StockModel): StockModel {
  return {
    originX: model.originX,
    originY: model.originY,
    cellMm: model.cellMm,
    cols: model.cols,
    rows: model.rows,
    topZ: new Float32Array(model.topZ),
    stockTopZ: model.stockTopZ,
    floorZ: model.floorZ
  }
}

/**
 * Approximate remaining stock volume (mm³): sum over cells of the material
 * still above the clear target, times the cell footprint area.
 *
 * Per cell: `max(0, stockTop - max(partTop + allowance, floorZ)) * cellMm²`.
 * When `partField` is omitted the target is the model floor (total remaining
 * solid above `floorZ`).
 */
export function stockRemainingVolumeMm3(
  model: StockModel,
  partField?: HeightField2d5,
  allowanceMm: number = 0
): number {
  const { originX, originY, cellMm, cols, rows, topZ, floorZ } = model
  const cellArea = cellMm * cellMm
  const floor = Number.isFinite(floorZ) ? floorZ : -Infinity
  const allowance = Number.isFinite(allowanceMm) ? allowanceMm : 0
  let volume = 0

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const stockTop = topZ[j * cols + i]!
      if (!Number.isFinite(stockTop)) continue
      let target = floor
      if (partField) {
        const cx = originX + (i + 0.5) * cellMm
        const cy = originY + (j + 0.5) * cellMm
        const partTopZ = sampleHeightFieldNearest(partField, cx, cy)
        if (Number.isFinite(partTopZ)) target = Math.max(partTopZ + allowance, floor)
      }
      const h = stockTop - target
      if (h > 0) volume += h * cellArea
    }
  }
  return volume
}
