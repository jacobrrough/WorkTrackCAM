import ClipperLib, { type IntPoint } from 'clipper-lib'
import type { StlBounds, Vec3 } from './stl'
import { extractToolpathSegmentsFromGcode } from '../shared/cam-gcode-toolpath'
import { CLIPPER_SCALE } from '../shared/sketch-boolean-offset'

export type ParallelFinishParams = {
  bounds: StlBounds
  /** Pass depth below top of stock (mm), negative into material */
  zPassMm: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
}

/** Caps Y passes so pathological stepovers cannot emit multi-million-line programs. */
export const PARALLEL_FINISH_MAX_Y_PASSES = 40_000

/**
 * Naive parallel XZ passes at fixed Y steps — for regression / demo when OpenCAMLib is unavailable.
 * Not industrial surfacing; produces valid G1 moves within mesh XY bounds.
 */
export function generateParallelFinishLines(params: ParallelFinishParams): string[] {
  const { bounds, zPassMm, stepoverMm, feedMmMin, plungeMmMin, safeZMm } = params
  const [minX, minY] = bounds.min
  const [maxX, maxY] = bounds.max
  const lines: string[] = []
  const zWork = zPassMm

  const spanY = Math.max(1e-9, maxY - minY)
  const minStepForCap = spanY / PARALLEL_FINISH_MAX_Y_PASSES
  const step = Math.max(stepoverMm, minStepForCap)
  if (step > stepoverMm + 1e-9) {
    lines.push(
      `; UFSCAM: stepover raised ${stepoverMm.toFixed(4)}→${step.toFixed(4)} mm to cap at ${PARALLEL_FINISH_MAX_Y_PASSES} Y passes (efficiency guard)`
    )
  }

  let y = minY
  let flip = false
  let passCount = 0
  while (y <= maxY + 1e-6) {
    if (++passCount > PARALLEL_FINISH_MAX_Y_PASSES) {
      lines.push('; UFSCAM: parallel pass limit — aborting further Y rows')
      break
    }
    const x0 = flip ? maxX : minX
    const x1 = flip ? minX : maxX
    lines.push(`G0 Z${safeZMm.toFixed(3)}`)
    lines.push(`G0 X${x0.toFixed(3)} Y${y.toFixed(3)}`)
    lines.push(`G1 Z${zWork.toFixed(3)} F${plungeMmMin.toFixed(0)}`)
    lines.push(`G1 X${x1.toFixed(3)} Y${y.toFixed(3)} F${feedMmMin.toFixed(0)}`)
    flip = !flip
    y += step
  }
  lines.push(`G0 Z${safeZMm.toFixed(3)}`)
  return lines
}

/** Cross-like sign for barycentric inside test: sign(P, A, B). */
function triSign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

function pointInTriangle2d(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = triSign(px, py, ax, ay, bx, by)
  const d2 = triSign(px, py, bx, by, cx, cy)
  const d3 = triSign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** Upper Z on triangle plane at (px,py); null if nearly vertical or outside (caller filters outside). */
function zOnTrianglePlane(px: number, py: number, v0: Vec3, v1: Vec3, v2: Vec3): number | null {
  const [x0, y0, z0] = v0
  const [x1, y1, z1] = v1
  const [x2, y2, z2] = v2
  const ux = x1 - x0
  const uy = y1 - y0
  const uz = z1 - z0
  const vx = x2 - x0
  const vy = y2 - y0
  const vz = z2 - z0
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  if (Math.abs(nz) < 1e-9) return null
  const z = z0 - (nx * (px - x0) + ny * (py - y0)) / nz
  return Number.isFinite(z) ? z : null
}

export function heightAtXyFromTriangles(triangles: ReadonlyArray<readonly [Vec3, Vec3, Vec3]>, px: number, py: number): number | null {
  let best: number | null = null
  for (const [v0, v1, v2] of triangles) {
    const [x0, y0] = v0
    const [x1, y1] = v1
    const [x2, y2] = v2
    if (!pointInTriangle2d(px, py, x0, y0, x1, y1, x2, y2)) continue
    const z = zOnTrianglePlane(px, py, v0, v1, v2)
    if (z == null) continue
    if (best == null || z > best) best = z
  }
  return best
}

/** Caps point×triangle inner tests for mesh height-field raster (main-process safety). */
export const MESH_RASTER_INNER_OP_BUDGET = 60_000_000

const MESH_RASTER_MAX_ROWS_CAP = 400
const MESH_RASTER_MAX_COLS_CAP = 450
const MESH_RASTER_MIN_DIM = 4

/**
 * Max raster sample budget (row×col target) from triangle count. Capped by the legacy 400×450 grid so
 * stride math stays bounded; for huge meshes this drops to ~{@link MESH_RASTER_INNER_OP_BUDGET}/n.
 */
export function resolveMeshRasterSampleBudget(triangleCount: number): number {
  const n = Math.max(1, triangleCount)
  const byBudget = Math.floor(MESH_RASTER_INNER_OP_BUDGET / n)
  const legacyMax = MESH_RASTER_MAX_ROWS_CAP * MESH_RASTER_MAX_COLS_CAP
  return Math.max(200, Math.min(legacyMax, byBudget))
}

/**
 * Row/column caps for the height-field grid from bbox aspect and sample budget (exported for tests).
 */
export function chooseMeshRasterGridCaps(spanX: number, spanY: number, maxSamples: number): { maxRows: number; maxCols: number } {
  if (!(spanX > 0) || !(spanY > 0) || maxSamples < 1) {
    return { maxRows: MESH_RASTER_MIN_DIM, maxCols: MESH_RASTER_MIN_DIM }
  }
  const ratio = spanX / spanY
  let maxCols = Math.min(MESH_RASTER_MAX_COLS_CAP, Math.max(MESH_RASTER_MIN_DIM, Math.round(Math.sqrt(maxSamples * ratio))))
  let maxRows = Math.min(MESH_RASTER_MAX_ROWS_CAP, Math.max(MESH_RASTER_MIN_DIM, Math.round(maxSamples / maxCols)))
  while (maxRows * maxCols > maxSamples && (maxRows > MESH_RASTER_MIN_DIM || maxCols > MESH_RASTER_MIN_DIM)) {
    if (maxCols >= maxRows && maxCols > MESH_RASTER_MIN_DIM) maxCols--
    else if (maxRows > MESH_RASTER_MIN_DIM) maxRows--
    else break
  }
  return { maxRows, maxCols }
}

/** Triangles whose XY AABB spans more than this many bucket cells go to `overflow` (checked every query). */
const MAX_BUCKET_CELLS_PER_TRI = 256

type TriangleBucketGrid = {
  buckets: number[][]
  /** Triangle indices too large for fine bucketing — tested on every height query. */
  overflow: readonly number[]
  nx: number
  ny: number
  minX: number
  minY: number
  cellW: number
  cellH: number
}

function buildTriangleBucketGrid(
  triangles: ReadonlyArray<readonly [Vec3, Vec3, Vec3]>,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): TriangleBucketGrid {
  const spanX = maxX - minX
  const spanY = maxY - minY
  const n = triangles.length
  const base = Math.min(80, Math.max(10, Math.ceil(Math.pow(Math.max(1, n), 0.25) * 3)))
  let nx = Math.round((base * spanX) / Math.max(spanX, spanY, 1e-9))
  let ny = Math.round((base * spanY) / Math.max(spanX, spanY, 1e-9))
  nx = Math.min(96, Math.max(8, nx))
  ny = Math.min(96, Math.max(8, ny))
  const cellW = spanX / nx || 1
  const cellH = spanY / ny || 1
  const buckets: number[][] = Array.from({ length: nx * ny }, () => [])
  const overflow: number[] = []

  for (let ti = 0; ti < n; ti++) {
    const [v0, v1, v2] = triangles[ti]!
    const xs = [v0[0], v1[0], v2[0]]
    const ys = [v0[1], v1[1], v2[1]]
    let tMinX = Math.min(xs[0], xs[1], xs[2])
    let tMaxX = Math.max(xs[0], xs[1], xs[2])
    let tMinY = Math.min(ys[0], ys[1], ys[2])
    let tMaxY = Math.max(ys[0], ys[1], ys[2])
    tMinX = Math.max(minX, tMinX)
    tMaxX = Math.min(maxX, tMaxX)
    tMinY = Math.max(minY, tMinY)
    tMaxY = Math.min(maxY, tMaxY)
    if (!(tMaxX >= tMinX) || !(tMaxY >= tMinY)) continue

    let ix0 = Math.floor((tMinX - minX) / cellW)
    let ix1 = Math.floor((tMaxX - minX) / cellW)
    let iy0 = Math.floor((tMinY - minY) / cellH)
    let iy1 = Math.floor((tMaxY - minY) / cellH)
    ix0 = Math.max(0, Math.min(nx - 1, ix0))
    ix1 = Math.max(0, Math.min(nx - 1, ix1))
    iy0 = Math.max(0, Math.min(ny - 1, iy0))
    iy1 = Math.max(0, Math.min(ny - 1, iy1))
    const cellSpan = (ix1 - ix0 + 1) * (iy1 - iy0 + 1)
    if (cellSpan > MAX_BUCKET_CELLS_PER_TRI) {
      overflow.push(ti)
      continue
    }
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        buckets[ix * ny + iy].push(ti)
      }
    }
  }

  return { buckets, overflow, nx, ny, minX, minY, cellW, cellH }
}

function heightAtXyFromBucketGrid(
  grid: TriangleBucketGrid,
  triangles: ReadonlyArray<readonly [Vec3, Vec3, Vec3]>,
  px: number,
  py: number
): number | null {
  const { buckets, overflow, nx, ny, minX, minY, cellW, cellH } = grid
  let ix = Math.floor((px - minX) / cellW)
  let iy = Math.floor((py - minY) / cellH)
  ix = Math.max(0, Math.min(nx - 1, ix))
  iy = Math.max(0, Math.min(ny - 1, iy))

  const seen = new Set<number>()
  let best: number | null = null

  const consider = (ti: number): void => {
    if (seen.has(ti)) return
    seen.add(ti)
    const [v0, v1, v2] = triangles[ti]!
    const [x0, y0] = v0
    const [x1, y1] = v1
    const [x2, y2] = v2
    if (!pointInTriangle2d(px, py, x0, y0, x1, y1, x2, y2)) return
    const z = zOnTrianglePlane(px, py, v0, v1, v2)
    if (z == null) return
    if (best == null || z > best) best = z
  }

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = ix + dx
      const cy = iy + dy
      if (cx < 0 || cx >= nx || cy < 0 || cy >= ny) continue
      const list = buckets[cx * ny + cy]
      for (let k = 0; k < list.length; k++) consider(list[k]!)
    }
  }
  for (let o = 0; o < overflow.length; o++) consider(overflow[o]!)
  return best
}

/** Returns minimum feed Z (mm) the prior roughing pass reached near (x,y), or null if unknown / no coverage. */
export type PriorRoughFloorSampler = (x: number, y: number) => number | null

/**
 * Build a coarse grid of minimum feed Z from prior posted G-code (2.5D MVP).
 * Used to skip mesh raster points where roughing already machined at or past the part surface (+ allowance).
 */
export function buildPriorRoughFloorSamplerFromGcode(opts: {
  gcode: string
  minX: number
  maxX: number
  minY: number
  maxY: number
  toolRadiusMm: number
  maxGridCols?: number
  maxGridRows?: number
}): PriorRoughFloorSampler | null {
  const segs = extractToolpathSegmentsFromGcode(opts.gcode).filter((s) => s.kind === 'feed')
  if (segs.length === 0) return null

  const spanX = opts.maxX - opts.minX
  const spanY = opts.maxY - opts.minY
  if (!(spanX > 1e-9) || !(spanY > 1e-9)) return null

  const maxCols = Math.min(64, Math.max(8, opts.maxGridCols ?? 48))
  const maxRows = Math.min(64, Math.max(8, opts.maxGridRows ?? 48))
  const cellW = spanX / maxCols
  const cellH = spanY / maxRows
  const originX = opts.minX
  const originY = opts.minY
  const grid = new Float32Array(maxCols * maxRows)
  grid.fill(Number.NaN)

  const stampDisk = (cx: number, cy: number, z: number, radiusMm: number) => {
    const rCellsX = Math.ceil(radiusMm / cellW) + 1
    const rCellsY = Math.ceil(radiusMm / cellH) + 1
    const ic = Math.floor((cx - originX) / cellW)
    const jc = Math.floor((cy - originY) / cellH)
    for (let dj = -rCellsY; dj <= rCellsY; dj++) {
      for (let di = -rCellsX; di <= rCellsX; di++) {
        const i = ic + di
        const j = jc + dj
        if (i < 0 || j < 0 || i >= maxCols || j >= maxRows) continue
        const px = originX + (i + 0.5) * cellW
        const py = originY + (j + 0.5) * cellH
        if (Math.hypot(px - cx, py - cy) > radiusMm + 1e-6) continue
        const idx = j * maxCols + i
        const cur = grid[idx]!
        grid[idx] = Number.isNaN(cur) ? z : Math.min(cur, z)
      }
    }
  }

  const R = Math.max(0.05, opts.toolRadiusMm)
  const step = Math.max(Math.min(cellW, cellH) * 0.35, 0.15)
  for (const s of segs) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const x = s.x0 + t * (s.x1 - s.x0)
      const y = s.y0 + t * (s.y1 - s.y0)
      const z = s.z0 + t * (s.z1 - s.z0)
      stampDisk(x, y, z, R)
    }
  }

  let any = false
  for (let i = 0; i < grid.length; i++) {
    if (!Number.isNaN(grid[i]!)) {
      any = true
      break
    }
  }
  if (!any) return null

  return (x: number, y: number) => {
    const i = Math.floor((x - originX) / cellW)
    const j = Math.floor((y - originY) / cellH)
    if (i < 0 || j < 0 || i >= maxCols || j >= maxRows) return null
    const v = grid[j * maxCols + i]!
    return Number.isNaN(v) ? null : v
  }
}

export type MeshHeightRasterParams = {
  triangles: ReadonlyArray<readonly [Vec3, Vec3, Vec3]>
  minX: number
  maxX: number
  minY: number
  maxY: number
  stepoverMm: number
  sampleStepMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /**
   * Positive: leave this much material along +Z on the mesh envelope (coarse “rest” / allowance on 2.5D raster).
   * Applied to sampled Z before emitting G1 (no cutter-radius compensation).
   */
  rasterRestStockMm?: number
  /**
   * When set, skip samples where prior roughing already reached Z at or past the mesh surface (+ {@link rasterRestStockMm}).
   * 2.5D heuristic only — not full rest-roughing simulation.
   */
  priorRoughFloorSampler?: PriorRoughFloorSampler
  /**
   * When {@link priorRoughFloorSampler} is **unset**: treat each sample as if a prior rough pass left this much stock
   * “above” the mesh along Z (`floorZ = zMesh + meshAnalyticPriorRoughStockMm`) for skip logic vs `zMesh + rasterRestStockMm`.
   * Ignored when a G-code-derived prior sampler is present (that path wins). 2.5D heuristic only.
   */
  meshAnalyticPriorRoughStockMm?: number
}

/**
 * XY zigzag raster with Z from a 2.5D upper envelope of STL triangles (no cutter offset / undercuts).
 * Adaptive sample budget (vs triangle count) plus XY bucketing keep main-thread work bounded.
 */
export function generateMeshHeightRasterLines(params: MeshHeightRasterParams): string[] {
  const { triangles, minX, maxX, minY, maxY, feedMmMin, plungeMmMin, safeZMm } = params
  const restZ =
    typeof params.rasterRestStockMm === 'number' && Number.isFinite(params.rasterRestStockMm) && params.rasterRestStockMm > 0
      ? params.rasterRestStockMm
      : 0
  if (triangles.length === 0 || !(maxX > minX) || !(maxY > minY)) return []

  const stepY = Math.max(0.05, params.stepoverMm)
  const rawStepX = Math.max(0.05, params.sampleStepMm)
  const spanY = maxY - minY
  const spanX = maxX - minX

  const maxSamples = resolveMeshRasterSampleBudget(triangles.length)
  const { maxRows, maxCols } = chooseMeshRasterGridCaps(spanX, spanY, maxSamples)
  const yStride = Math.max(stepY, spanY / maxRows)
  const xStride = Math.max(rawStepX, spanX / maxCols)

  const approxSamples = Math.ceil(spanY / yStride + 2) * Math.ceil(spanX / xStride + 2)
  const naiveInnerBudget = approxSamples * triangles.length
  const useBuckets = triangles.length >= 400 || naiveInnerBudget > 2_000_000
  const grid = useBuckets ? buildTriangleBucketGrid(triangles, minX, maxX, minY, maxY) : null
  const heightAt = (px: number, py: number): number | null =>
    grid ? heightAtXyFromBucketGrid(grid, triangles, px, py) : heightAtXyFromTriangles(triangles, px, py)

  const lines: string[] = []
  let y = minY
  let flip = false
  while (y <= maxY + 1e-6) {
    const xs: number[] = []
    for (let x = minX; x <= maxX + 1e-6; x += xStride) xs.push(Math.min(x, maxX))
    if (xs.length === 0) xs.push(minX)
    if (flip) xs.reverse()

    type P = { x: number; y: number; z: number }
    const segment: P[] = []
    const flush = () => {
      if (segment.length === 0) return
      const f = segment[0]!
      lines.push(`G0 Z${safeZMm.toFixed(3)}`)
      lines.push(`G0 X${f.x.toFixed(3)} Y${f.y.toFixed(3)}`)
      lines.push(`G1 Z${f.z.toFixed(3)} F${plungeMmMin.toFixed(0)}`)
      for (let i = 1; i < segment.length; i++) {
        const p = segment[i]!
        lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} Z${p.z.toFixed(3)} F${feedMmMin.toFixed(0)}`)
      }
      segment.length = 0
    }

    for (const x of xs) {
      const zRaw = heightAt(x, y)
      if (zRaw == null) {
        flush()
        continue
      }
      let floorZ = params.priorRoughFloorSampler?.(x, y) ?? null
      const aStock = params.meshAnalyticPriorRoughStockMm
      if (
        floorZ == null &&
        typeof aStock === 'number' &&
        Number.isFinite(aStock) &&
        aStock > 0
      ) {
        floorZ = zRaw + aStock
      }
      if (floorZ != null && Number.isFinite(floorZ) && floorZ <= zRaw + restZ + 1e-5) {
        flush()
        continue
      }
      const z = zRaw + restZ
      const last = segment[segment.length - 1]
      if (last && Math.hypot(last.x - x, last.y - y) < 1e-6) continue
      segment.push({ x, y, z })
    }
    flush()

    flip = !flip
    y += yStride
  }
  lines.push(`G0 Z${safeZMm.toFixed(3)}`)
  return lines
}

export type OrthoBoundsRasterParams = ParallelFinishParams

/**
 * Constant-Z zigzag stepping in X, sweeping Y — orthogonal to {@link generateParallelFinishLines} (Y-step / X-sweep).
 */
export function generateOrthoBoundsRasterLines(params: OrthoBoundsRasterParams): string[] {
  const { bounds, zPassMm, stepoverMm, feedMmMin, plungeMmMin, safeZMm } = params
  const [minX, minY] = bounds.min
  const [maxX, maxY] = bounds.max
  const lines: string[] = []
  const zWork = zPassMm

  let x = minX
  let flip = false
  while (x <= maxX + 1e-6) {
    const y0 = flip ? maxY : minY
    const y1 = flip ? minY : maxY
    lines.push(`G0 Z${safeZMm.toFixed(3)}`)
    lines.push(`G0 X${x.toFixed(3)} Y${y0.toFixed(3)}`)
    lines.push(`G1 Z${zWork.toFixed(3)} F${plungeMmMin.toFixed(0)}`)
    lines.push(`G1 X${x.toFixed(3)} Y${y1.toFixed(3)} F${feedMmMin.toFixed(0)}`)
    flip = !flip
    x += stepoverMm
  }
  lines.push(`G0 Z${safeZMm.toFixed(3)}`)
  return lines
}

export type CamPoint2d = readonly [number, number]

export type Contour2dParams = {
  contourPoints: ReadonlyArray<CamPoint2d>
  zPassMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Climb keeps CCW ring direction; conventional flips to CW. */
  contourSide?: 'climb' | 'conventional'
  /** Optional linear lead-in distance before entering first contour point. */
  leadInMm?: number
  /** Optional linear lead-out distance after closing the contour. */
  leadOutMm?: number
  /**
   * Lead-in approach mode.
   * - `'linear'` (default): straight G1 move along the tangent direction.
   * - `'arc'`: quarter-circle G2/G3 arc tangential to the contour start,
   *   approaching from the perpendicular (normal) direction. Uses `leadInMm`
   *   as the arc radius. Produces a smoother entry with less tool deflection.
   */
  leadInMode?: 'linear' | 'arc'
  /**
   * Lead-out exit mode.
   * - `'linear'` (default): straight G1 move along the tangent direction.
   * - `'arc'`: quarter-circle G3 arc departing tangentially into the
   *   perpendicular (normal) direction. Uses `leadOutMm` as the arc radius.
   *   Eliminates dwell marks at the contour close point.
   */
  leadOutMode?: 'linear' | 'arc'
  /**
   * Contour entry mode — how the tool reaches cutting depth at the start.
   * - `'plunge'` (default): straight vertical G1 plunge to zPassMm.
   * - `'linear'`: linear ramp along the first contour segment direction.
   * - `'helix'`: helical ramp around the entry point (circular descent).
   */
  rampType?: 'plunge' | 'linear' | 'helix'
  /**
   * Ramp angle from horizontal (degrees, default 3). Smaller angles are gentler
   * on the tool. Only used when rampType is 'linear' or 'helix'.
   */
  rampAngleDeg?: number
  /**
   * Tab insertion parameters. When provided with tabsMode !== 'none',
   * holding bridges are inserted into the contour pass to prevent the part
   * from shifting during the final cut-through.
   */
  tabParams?: TabParams
}

export type Pocket2dParams = {
  contourPoints: ReadonlyArray<CamPoint2d>
  /**
   * Optional interior ISLAND rings (keep-out polygons inside the pocket).
   * Raster scanline spans are clipped even-odd across ALL rings, so a row
   * crossing an island splits into separate cut segments on either side, each
   * honouring `wallStockMm` clearance from island edges as well as the outer
   * wall. Absent / empty -> exact legacy single-ring behaviour (byte-identical
   * output; the original single-ring helper still runs).
   */
  islandRings?: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  stepoverMm: number
  zPassMm: number
  /** Optional step-down increment (mm); default single depth at zPassMm. */
  zStepMm?: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Optional radial stock to leave on walls during rough pocket raster. */
  wallStockMm?: number
  /** Optional finish contour at each depth step (default false = final depth only). */
  finishEachDepth?: boolean
  /** Pocket roughing entry mode per segment. */
  entryMode?: 'plunge' | 'ramp'
  /** Ramp run length in XY (mm) when `entryMode` is `ramp`. */
  rampMm?: number
  /**
   * Max ramp angle from horizontal (degrees). XY run is lengthened (up to segment span) so that
   * atan2(|ΔZ|, run) ≤ this value when possible. Default 45.
   */
  rampMaxAngleDeg?: number
}

export type Pocket2dGenerateResult = {
  lines: string[]
  /** User-facing CAM notes (e.g. ramp geometry limits). */
  hints: string[]
}

/** Minimum XY run (mm) for a ramp from `safeZ` to target Z so incline is ≤ `maxAngleDeg` from horizontal. */
export function minRampRunForMaxAngleMm(zDropMm: number, maxAngleDeg: number): number {
  if (!(zDropMm > 0) || !Number.isFinite(zDropMm)) return 0
  const clamped = Math.min(89, Math.max(1, maxAngleDeg))
  return zDropMm / Math.tan((clamped * Math.PI) / 180)
}

export type Drill2dParams = {
  drillPoints: ReadonlyArray<CamPoint2d>
  zPassMm: number
  feedMmMin: number
  safeZMm: number
  retractMm?: number
  cycleMode?: 'g73' | 'g81' | 'g82' | 'g83' | 'expanded'
  peckMm?: number
  /** Optional dwell in milliseconds for G82. */
  dwellMs?: number
}

function ringBounds(points: ReadonlyArray<CamPoint2d>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length < 3) return null
  let minX = points[0]![0]
  let minY = points[0]![1]
  let maxX = points[0]![0]
  let maxY = points[0]![1]
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

/** Even-odd horizontal intersections of ring at y (excluding horizontal edges). */
function horizontalSegmentsInsideRing(ring: ReadonlyArray<CamPoint2d>, y: number): Array<[number, number]> {
  if (ring.length < 3) return []
  const xs: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!
    const [x2, y2] = ring[(i + 1) % ring.length]!
    if (Math.abs(y2 - y1) < 1e-9) continue
    // Half-open to avoid double counting at vertices.
    const ymin = Math.min(y1, y2)
    const ymax = Math.max(y1, y2)
    if (!(y >= ymin && y < ymax)) continue
    const t = (y - y1) / (y2 - y1)
    xs.push(x1 + t * (x2 - x1))
  }
  xs.sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i]!
    const b = xs[i + 1]!
    if (b - a > 1e-6) out.push([a, b])
  }
  return out
}

function pointInRing2d(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function distancePointToSegment2d(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function minDistanceToRingEdges(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!
    const [bx, by] = ring[(i + 1) % ring.length]!
    const d = distancePointToSegment2d(x, y, ax, ay, bx, by)
    if (d < best) best = d
  }
  return best
}

function uniqueSorted(values: number[], eps = 1e-7): number[] {
  values.sort((a, b) => a - b)
  const out: number[] = []
  for (const v of values) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > eps) out.push(v)
  }
  return out
}

function rootsAtDistanceFromSegmentForY(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  y: number,
  r: number
): number[] {
  const roots: number[] = []
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const len = Math.sqrt(len2)
  const eps = 1e-9

  const endpointRoots = (xe: number, ye: number): void => {
    const yy = y - ye
    const rem = r * r - yy * yy
    if (rem < -eps) return
    const s = Math.sqrt(Math.max(0, rem))
    roots.push(xe - s, xe + s)
  }
  endpointRoots(x1, y1)
  endpointRoots(x2, y2)

  if (len <= eps) return roots

  if (Math.abs(dy) > eps) {
    const rhsBase = dx * (y - y1)
    const rhs = r * len
    const xA = x1 + (rhsBase + rhs) / dy
    const xB = x1 + (rhsBase - rhs) / dy
    for (const x of [xA, xB]) {
      const t = ((x - x1) * dx + (y - y1) * dy) / len2
      if (t >= -1e-6 && t <= 1 + 1e-6) roots.push(x)
    }
  } else if (Math.abs(Math.abs(y - y1) - r) <= 1e-6) {
    roots.push(x1, x2)
  }

  return roots
}

function horizontalSegmentsInsideInsetRing(ring: ReadonlyArray<CamPoint2d>, y: number, insetMm: number): Array<[number, number]> {
  const base = horizontalSegmentsInsideRing(ring, y)
  if (base.length === 0 || insetMm <= 1e-9) return base
  const out: Array<[number, number]> = []
  for (const [a, b] of base) {
    const candidates = [a, b]
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!
      const [x2, y2] = ring[(i + 1) % ring.length]!
      const roots = rootsAtDistanceFromSegmentForY(x1, y1, x2, y2, y, insetMm)
      for (const x of roots) {
        if (x > a + 1e-7 && x < b - 1e-7) candidates.push(x)
      }
    }
    const xs = uniqueSorted(candidates)
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i]!
      const x1 = xs[i + 1]!
      if (x1 - x0 <= 1e-6) continue
      const xm = 0.5 * (x0 + x1)
      if (!pointInRing2d(ring, xm, y)) continue
      const d = minDistanceToRingEdges(ring, xm, y)
      if (d + 1e-6 < insetMm) continue
      out.push([x0, x1])
    }
  }
  return out
}

/**
 * Even-odd horizontal crossings at `y` across MANY rings, paired into inside
 * spans -- the multi-ring generalization of {@link horizontalSegmentsInsideRing}
 * (outer ring + islands). Crossing parity flips at every ring edge, so a span
 * crossing an island splits into the sub-spans on either side of it.
 */
function horizontalSegmentsInsideRings(
  rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  y: number
): Array<[number, number]> {
  const xs: number[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!
      const [x2, y2] = ring[(i + 1) % ring.length]!
      if (Math.abs(y2 - y1) < 1e-9) continue
      // Half-open to avoid double counting at vertices (same rule as single-ring).
      const ymin = Math.min(y1, y2)
      const ymax = Math.max(y1, y2)
      if (!(y >= ymin && y < ymax)) continue
      const t = (y - y1) / (y2 - y1)
      xs.push(x1 + t * (x2 - x1))
    }
  }
  xs.sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i]!
    const b = xs[i + 1]!
    if (b - a > 1e-6) out.push([a, b])
  }
  return out
}

/**
 * Multi-ring generalization of {@link horizontalSegmentsInsideInsetRing}: spans
 * of the scanline at `y` lying inside (outer - islands) by even-odd across ALL
 * rings, with >= `insetMm` TRUE GEOMETRIC clearance to EVERY ring edge (outer
 * wall AND island walls). Uses the same exact distance root-finding as the
 * single-ring inset -- no polygonal offset approximation -- so island wall
 * stock is honoured to the same tolerance as the outer wall.
 */
function horizontalSegmentsInsideInsetRings(
  rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  y: number,
  insetMm: number
): Array<[number, number]> {
  const base = horizontalSegmentsInsideRings(rings, y)
  if (base.length === 0 || insetMm <= 1e-9) return base
  const out: Array<[number, number]> = []
  for (const [a, b] of base) {
    const candidates = [a, b]
    for (const ring of rings) {
      if (ring.length < 3) continue
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!
        const [x2, y2] = ring[(i + 1) % ring.length]!
        const roots = rootsAtDistanceFromSegmentForY(x1, y1, x2, y2, y, insetMm)
        for (const x of roots) {
          if (x > a + 1e-7 && x < b - 1e-7) candidates.push(x)
        }
      }
    }
    const xs = uniqueSorted(candidates)
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i]!
      const x1 = xs[i + 1]!
      if (x1 - x0 <= 1e-6) continue
      const xm = 0.5 * (x0 + x1)
      if (!pointInsideRings(rings, xm, y)) continue
      const d = minDistanceToAnyRing(rings, xm, y)
      if (d + 1e-6 < insetMm) continue
      out.push([x0, x1])
    }
  }
  return out
}

/**
 * Z levels from surface toward {@link targetZ} when cutting negative Z (into material).
 * If {@link targetZ} ≥ 0, returns a single pass at {@link targetZ}.
 */
export function computeNegativeZDepthPasses(targetZ: number, stepDownMm: number): number[] {
  const stepDown = Math.max(0.01, Math.abs(stepDownMm))
  const depths: number[] = []
  if (targetZ < 0) {
    for (let d = -stepDown; d > targetZ + 1e-9; d -= stepDown) depths.push(d)
    depths.push(targetZ)
  } else {
    depths.push(targetZ)
  }
  return depths
}

/**
 * Generate a ramp entry sequence for contour operations.
 *
 * - `'linear'`: ramp along the first contour segment direction, descending
 *   at the configured angle. The XY run is `|zDrop| / tan(rampAngle)`.
 * - `'helix'`: helical ramp around the entry point. The tool spirals in a
 *   circle of radius = first-segment-length/4 (clamped to [0.5, 10] mm)
 *   descending at the ramp angle. Full 360-degree loops until target Z.
 *
 * @returns G-code lines for the ramp entry (tool ends at `(x0, y0, zTarget)`).
 */
export function generateRampEntryLines(
  x0: number,
  y0: number,
  safeZ: number,
  zTarget: number,
  feedMmMin: number,
  plungeMmMin: number,
  rampType: 'linear' | 'helix',
  rampAngleDeg: number,
  tx: number,
  ty: number,
  segLen: number
): string[] {
  const lines: string[] = []
  const zDrop = Math.abs(safeZ - zTarget)
  if (zDrop < 0.001) return lines

  const angle = Math.min(89, Math.max(0.5, rampAngleDeg))
  const rampFeed = Math.min(feedMmMin, plungeMmMin * 2)

  if (rampType === 'linear') {
    // Linear ramp along the tangent direction of the first segment
    const xyRun = zDrop / Math.tan((angle * Math.PI) / 180)
    // Clamp run to segment length — if segment is too short, ramp will be steeper
    const run = Math.min(xyRun, Math.max(segLen, 1))
    const rampEndX = x0 + tx * run
    const rampEndY = y0 + ty * run
    // Rapid to ramp start above entry point
    lines.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)}`)
    lines.push(`G0 Z${safeZ.toFixed(3)}`)
    // Ramp down along the first segment direction
    lines.push(`G1 X${rampEndX.toFixed(3)} Y${rampEndY.toFixed(3)} Z${zTarget.toFixed(3)} F${rampFeed.toFixed(0)}`)
    // Return to entry point at cutting depth
    lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} Z${zTarget.toFixed(3)} F${feedMmMin.toFixed(0)}`)
  } else {
    // Helix ramp: circle around entry point, descending each revolution
    const helixR = Math.min(10, Math.max(0.5, segLen / 4))
    const circumference = 2 * Math.PI * helixR
    // Z drop per revolution at the configured ramp angle
    const zPerRev = circumference * Math.tan((angle * Math.PI) / 180)
    const totalRevs = Math.ceil(zDrop / Math.max(0.01, zPerRev))
    const zPerRevActual = zDrop / totalRevs

    // Rapid to start of helix (offset in normal direction from entry point)
    const helixStartX = x0 + helixR
    const helixStartY = y0
    lines.push(`G0 X${helixStartX.toFixed(3)} Y${helixStartY.toFixed(3)}`)
    lines.push(`G0 Z${safeZ.toFixed(3)}`)

    // Generate helix revolutions using G2 (CW) arcs
    // Each revolution is two semicircles for controller compatibility
    let currentZ = safeZ
    for (let rev = 0; rev < totalRevs; rev++) {
      const zAfterHalf = currentZ - zPerRevActual / 2
      const zAfterFull = currentZ - zPerRevActual
      const targetZHalf = rev === totalRevs - 1 ? zTarget + zPerRevActual / 2 : zAfterHalf
      const targetZFull = rev === totalRevs - 1 ? zTarget : zAfterFull

      // First semicircle: from +R to -R
      lines.push(
        `G2 X${(x0 - helixR).toFixed(3)} Y${y0.toFixed(3)} Z${targetZHalf.toFixed(3)} I${(-helixR).toFixed(3)} J0.000 F${rampFeed.toFixed(0)}`
      )
      // Second semicircle: from -R back to +R
      lines.push(
        `G2 X${(x0 + helixR).toFixed(3)} Y${y0.toFixed(3)} Z${targetZFull.toFixed(3)} I${helixR.toFixed(3)} J0.000 F${rampFeed.toFixed(0)}`
      )
      currentZ = targetZFull
    }
    // Move to the actual entry point at cutting depth
    lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} Z${zTarget.toFixed(3)} F${feedMmMin.toFixed(0)}`)
  }
  return lines
}

export function generateContour2dLines(params: Contour2dParams): string[] {
  const rawRing = params.contourPoints
  let ring = [...rawRing]
  if (ring.length < 3) return []
  const signedArea = (() => {
    let a = 0
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!
      const [x2, y2] = ring[(i + 1) % ring.length]!
      a += x1 * y2 - x2 * y1
    }
    return 0.5 * a
  })()
  if (params.contourSide === 'conventional' && signedArea > 0) ring.reverse()
  if (params.contourSide === 'climb' && signedArea < 0) ring.reverse()
  const lines: string[] = []
  const [x0, y0] = ring[0]!
  const [x1, y1] = ring[1]!
  const dx = x1 - x0
  const dy = y1 - y0
  const segLen = Math.hypot(dx, dy)
  const tx = segLen > 1e-9 ? dx / segLen : 1
  const ty = segLen > 1e-9 ? dy / segLen : 0
  const leadIn = Math.max(0, params.leadInMm ?? 0)
  const leadOut = Math.max(0, params.leadOutMm ?? 0)
  const useArc = params.leadInMode === 'arc' && leadIn > 0.05
  // Normal direction (perpendicular left of tangent)
  const nx = -ty
  const ny = tx

  const rampType = params.rampType ?? 'plunge'

  // ── Entry: ramp or plunge to cutting depth ────────────────────────────
  if (rampType === 'linear' || rampType === 'helix') {
    const rampAngle = params.rampAngleDeg ?? 3
    if (useArc) {
      // Arc lead-in approach first (at safe Z), then ramp to depth
      const arcR = leadIn
      const entryX = x0 + nx * arcR
      const entryY = y0 + ny * arcR
      lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
      lines.push(`G0 X${entryX.toFixed(3)} Y${entryY.toFixed(3)}`)
      // Arc approach at safe Z, then ramp entry at the contour start
      const iOff = -nx * arcR
      const jOff = -ny * arcR
      lines.push(`G1 X${entryX.toFixed(3)} Y${entryY.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
      lines.push(`G2 X${x0.toFixed(3)} Y${y0.toFixed(3)} I${iOff.toFixed(3)} J${jOff.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
    }
    lines.push(
      ...generateRampEntryLines(
        x0, y0, params.safeZMm, params.zPassMm,
        params.feedMmMin, params.plungeMmMin,
        rampType, rampAngle, tx, ty, segLen
      )
    )
  } else if (useArc) {
    // Arc lead-in: approach from the perpendicular direction, arc into contour
    const arcR = leadIn
    const entryX = x0 + nx * arcR
    const entryY = y0 + ny * arcR
    lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
    lines.push(`G0 X${entryX.toFixed(3)} Y${entryY.toFixed(3)}`)
    lines.push(`G1 Z${params.zPassMm.toFixed(3)} F${params.plungeMmMin.toFixed(0)}`)
    // Arc from entry point to first contour point; centre offset = -nx*arcR, -ny*arcR
    // CW (G2) sweeps from normal toward tangent
    const iOff = -nx * arcR
    const jOff = -ny * arcR
    lines.push(`G2 X${x0.toFixed(3)} Y${y0.toFixed(3)} I${iOff.toFixed(3)} J${jOff.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
  } else {
    const entryX = x0 - tx * leadIn
    const entryY = y0 - ty * leadIn
    lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
    lines.push(`G0 X${entryX.toFixed(3)} Y${entryY.toFixed(3)}`)
    lines.push(`G1 Z${params.zPassMm.toFixed(3)} F${params.plungeMmMin.toFixed(0)}`)
    if (leadIn > 0) {
      lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
    }
  }

  // ── Contour pass: with optional tab bridges ────────────────────────────
  const tp = params.tabParams
  const hasActiveTabs = tp != null && tp.tabsMode !== 'none'

  if (hasActiveTabs) {
    const perimeter = polygonPerimeterMm(ring)
    const tabPositions = computeTabPositionsMm(perimeter, tp)
    const tabWidth = tp.tabWidthMm ?? 3
    const tabHeight = tp.tabHeightMm ?? 1.5
    if (tabPositions.length > 0) {
      const tabLines = injectTabsIntoContourPass(
        ring, params.zPassMm, params.feedMmMin,
        tabPositions, tabWidth, tabHeight
      )
      lines.push(...tabLines)
    } else {
      // No tab positions resolved — fall through to normal contour
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i]!
        lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
      }
      lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
    }
  } else {
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = ring[i]!
      lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
    }
    lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
  }

  // ── Lead-out ────────────────────────────────────────────────────────────
  const useArcOut = params.leadOutMode === 'arc' && leadOut > 0.05
  if (useArcOut) {
    // Arc lead-out: depart tangentially into the normal direction via G3 (CCW)
    const arcR = leadOut
    const exitX = x0 + nx * arcR
    const exitY = y0 + ny * arcR
    // Centre is at (x0 + nx*arcR, y0 + ny*arcR) → offset from start = (nx*arcR, ny*arcR)
    const iOff = nx * arcR
    const jOff = ny * arcR
    lines.push(`G3 X${exitX.toFixed(3)} Y${exitY.toFixed(3)} I${iOff.toFixed(3)} J${jOff.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
  } else if (leadOut > 0) {
    const outX = x0 + tx * leadOut
    const outY = y0 + ty * leadOut
    lines.push(`G1 X${outX.toFixed(3)} Y${outY.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
  }
  lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
  return lines
}

export function generatePocket2dLines(params: Pocket2dParams): Pocket2dGenerateResult {
  const b = ringBounds(params.contourPoints)
  if (!b || params.stepoverMm <= 0) return { lines: [], hints: [] }
  // Island-aware raster (additive): with islands present the scanline spans are
  // clipped even-odd across outer + island rings; without them the original
  // single-ring helper runs untouched (byte-identical legacy output).
  const islandRingsClean = (params.islandRings ?? []).filter((r) => r.length >= 3)
  const lines: string[] = []
  const targetZ = params.zPassMm
  const stepDown = Math.max(0.01, Math.abs(params.zStepMm ?? params.zPassMm))
  const depths = computeNegativeZDepthPasses(targetZ, stepDown)
  const stock = Math.max(0, params.wallStockMm ?? 0)
  const finishEachDepth = params.finishEachDepth === true
  const entryMode = params.entryMode === 'ramp' ? 'ramp' : 'plunge'
  const rampMm = Math.max(0.01, params.rampMm ?? 2)
  const rampMaxAngleDeg =
    typeof params.rampMaxAngleDeg === 'number' && Number.isFinite(params.rampMaxAngleDeg)
      ? params.rampMaxAngleDeg
      : 45
  let rampExtendedForAngle = false
  let rampSteepDespiteSpan = false
  for (const z of depths) {
    const zDrop = Math.abs(params.safeZMm - z)
    const minRunForAngle = minRampRunForMaxAngleMm(zDrop, rampMaxAngleDeg)
    let y = b.minY
    let reverseRow = false
    while (y <= b.maxY + 1e-6) {
      const segs =
        islandRingsClean.length > 0
          ? horizontalSegmentsInsideInsetRings([params.contourPoints, ...islandRingsClean], y, stock)
          : horizontalSegmentsInsideInsetRing(params.contourPoints, y, stock)
      if (segs.length > 0) {
        const row = reverseRow ? [...segs].reverse() : segs
        for (let s = 0; s < row.length; s++) {
          const [a, b] = row[s]!
          if (b - a <= 1e-6) continue
          const x0 = reverseRow ? b : a
          const x1 = reverseRow ? a : b
          lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
          lines.push(`G0 X${x0.toFixed(3)} Y${y.toFixed(3)}`)
          if (entryMode === 'ramp') {
            const span = Math.abs(x1 - x0)
            const requested = Math.min(rampMm, span)
            let run: number
            if (minRunForAngle > span + 1e-6) {
              run = span
              rampSteepDespiteSpan = true
            } else {
              run = Math.min(span, Math.max(requested, minRunForAngle))
              if (run > requested + 1e-3) rampExtendedForAngle = true
            }
            const xr = reverseRow ? x0 - run : x0 + run
            lines.push(`G1 X${xr.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} F${params.plungeMmMin.toFixed(0)}`)
          } else {
            lines.push(`G1 Z${z.toFixed(3)} F${params.plungeMmMin.toFixed(0)}`)
          }
          lines.push(`G1 X${x1.toFixed(3)} Y${y.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
        }
        reverseRow = !reverseRow
      }
      y += params.stepoverMm
    }
    if (finishEachDepth) {
      lines.push(
        ...generateContour2dLines({
          contourPoints: params.contourPoints,
          zPassMm: z,
          feedMmMin: params.feedMmMin,
          plungeMmMin: params.plungeMmMin,
          safeZMm: params.safeZMm
        })
      )
    }
  }
  lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
  const hints: string[] = []
  if (entryMode === 'ramp') {
    if (rampExtendedForAngle) {
      hints.push(
        `Pocket ramp: XY run was lengthened (within each segment) to stay within rampMaxAngleDeg (${rampMaxAngleDeg.toFixed(0)}°) versus safe-Z to cut depth.`
      )
    }
    if (rampSteepDespiteSpan) {
      hints.push(
        `Pocket ramp: some segment spans are shorter than the horizontal run needed for rampMaxAngleDeg (${rampMaxAngleDeg.toFixed(0)}°); those entries may be steeper than the limit.`
      )
    }
  }
  return { lines, hints }
}

export function generateDrill2dLines(params: Drill2dParams): string[] {
  if (params.drillPoints.length === 0) return []
  /** Retract plane R in G81/G82/G83 (mm); defaults to safeZMm when retractMm omitted. */
  const r = params.retractMm ?? params.safeZMm
  const lines: string[] = []
  lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
  const mode = params.cycleMode ?? 'g81'
  const peck = typeof params.peckMm === 'number' && Number.isFinite(params.peckMm) && params.peckMm > 0 ? params.peckMm : undefined
  const dwellMs = typeof params.dwellMs === 'number' && Number.isFinite(params.dwellMs) && params.dwellMs > 0 ? params.dwellMs : undefined
  for (const [x, y] of params.drillPoints) {
    if (mode === 'expanded') {
      lines.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`)
      lines.push(`G1 Z${params.zPassMm.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
      lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
      continue
    }
    if (mode === 'g73' && peck != null) {
      lines.push(`G73 X${x.toFixed(3)} Y${y.toFixed(3)} Z${params.zPassMm.toFixed(3)} R${r.toFixed(3)} Q${peck.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
      continue
    }
    if (mode === 'g83' && peck != null) {
      lines.push(`G83 X${x.toFixed(3)} Y${y.toFixed(3)} Z${params.zPassMm.toFixed(3)} R${r.toFixed(3)} Q${peck.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
      continue
    }
    if (mode === 'g82' && dwellMs != null) {
      lines.push(`G82 X${x.toFixed(3)} Y${y.toFixed(3)} Z${params.zPassMm.toFixed(3)} R${r.toFixed(3)} P${dwellMs.toFixed(0)} F${params.feedMmMin.toFixed(0)}`)
      continue
    }
    lines.push(`G81 X${x.toFixed(3)} Y${y.toFixed(3)} Z${params.zPassMm.toFixed(3)} R${r.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
  }
  if (mode !== 'expanded') lines.push('G80')
  lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
  return lines
}

// ────────────────────────────────────────────────────────────────────────────
// CHAMFER TOOLPATH  (Makera CAM-style cnc_chamfer operation)
// ────────────────────────────────────────────────────────────────────────────

export type Chamfer2dParams = {
  /** Closed polygon in setup WCS (mm). */
  contourPoints: ReadonlyArray<CamPoint2d>
  /** Depth from Z0 to the bottom of the chamfer profile (mm, positive). */
  chamferDepthMm: number
  /** Tool half-angle from vertical axis (degrees, default 45 for a 90° V-bit). */
  chamferAngleDeg?: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Tool diameter at tip (mm). */
  toolDiameterMm?: number
}

/**
 * Generates a single-pass chamfer toolpath along a closed contour.
 *
 * The tool follows the polygon at `chamferDepthMm` below Z0.
 * The XY offset from the profile equals `depth × tan(chamferAngleDeg)`, giving
 * the correct chamfer width for a V-bit of the chosen included angle.
 */
export function generateChamfer2dLines(params: Chamfer2dParams): string[] {
  const { contourPoints, chamferDepthMm, feedMmMin, plungeMmMin, safeZMm } = params
  if (contourPoints.length < 3) return []
  const angleDeg = params.chamferAngleDeg ?? 45
  const xyOffset = chamferDepthMm * Math.tan((angleDeg * Math.PI) / 180)
  const zWork = -Math.abs(chamferDepthMm)
  const lines: string[] = []

  const [x0, y0] = contourPoints[0]!
  lines.push(`; Chamfer — depth ${chamferDepthMm.toFixed(3)} mm, angle ${angleDeg}°, XY offset ${xyOffset.toFixed(3)} mm`)
  lines.push(`G0 Z${safeZMm.toFixed(3)}`)
  lines.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)}`)
  lines.push(`G1 Z${zWork.toFixed(3)} F${plungeMmMin.toFixed(0)}`)

  for (let i = 1; i < contourPoints.length; i++) {
    const [x, y] = contourPoints[i]!
    lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedMmMin.toFixed(0)}`)
  }
  // Close the loop
  lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${feedMmMin.toFixed(0)}`)
  lines.push(`G0 Z${safeZMm.toFixed(3)}`)
  return lines
}

// ────────────────────────────────────────────────────────────────────────────
// V-CARVE TOOLPATH  (Vectric VCarve Pro / Carveco-style cnc_vcarve operation)
// ────────────────────────────────────────────────────────────────────────────
//
// This is the TRUE variable-depth sign-lettering carve — NOT the single-offset
// fixed-depth bevel that `generateChamfer2dLines` produces. From closed input
// vector(s) it solves a medial-axis RIDGE; at each ridge point the clearance
// radius `r` (distance to the nearest boundary edge) sets the V-bit depth
// `d = r / tan(vBitAngleDeg/2)`, so the carve is deepest where the shape is
// widest and runs out to zero at narrow tips. The depth profile is therefore
// monotonic-with-width and is HARD-CAPPED to `min(maxDepthMm, stockThickness)`
// so the V-bit can never plunge past the material.
//
// Medial-axis solver — honest approximation note:
//   A full Voronoi/exact medial-axis is ideal but heavy. This uses a
//   DISTANCE-FIELD RIDGE approximation (acceptable per the build brief), which
//   is robust for closed polygons and main-process-safe:
//     1. Rasterize a signed clearance field over the contour bbox — for each
//        interior sample, `r` = distance to the nearest boundary edge across all
//        rings (even-odd inside test, so islands subtract).
//     2. A sample is a RIDGE cell when its `r` is a 1-D local maximum along the
//        X axis OR the Y axis (the discrete skeleton of the distance field).
//     3. depth = clamp(r / tan(halfAngle), 0, cap).
//     4. Chain ridge cells into polylines by greedy nearest-neighbour within a
//        small connection radius; whenever the next ridge cell is beyond that
//        radius (a disjoint branch / stroke / island) the tool LIFTS to safe-Z
//        before the rapid to the next branch — never a transit through stock.
//   Validated (see cam-local-vcarve.test.ts): deepest point sits in the widest
//   span, depth never exceeds the cap, and the spine depth is monotonic with
//   local width. The approximation can fragment a ridge at T-junctions into
//   several branches — that costs extra safe-Z rapids but is never unsafe.

export type VCarve2dParams = {
  /**
   * One or more closed polygons in setup WCS (mm). The first ring is the outer
   * boundary; any further rings are treated as islands (even-odd) so the carve
   * respects holes. A single ring is the common sign-lettering case.
   */
  rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  /** FULL included angle of the V-bit (degrees), e.g. 60 or 90. */
  vBitAngleDeg: number
  /** HARD depth cap (mm, positive). The carve never plunges deeper than this. */
  maxDepthMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /**
   * Medial-axis sampling resolution (mm). Smaller = finer ridge + more moves.
   * Defaults to a value derived from the shape size, clamped for main-process
   * safety. The grid is additionally capped to {@link VCARVE_MAX_GRID_CELLS}.
   */
  stepoverMm?: number
  /**
   * Flat-bottom (prism) carving — raster stepover (mm) for the floor clearance
   * pass. When set (> 0) and the carve saturates {@link maxDepthMm} somewhere,
   * a SECOND chained section clears the FLAT floor at z = -maxDepthMm over the
   * region where the uncapped V depth exceeds the cap (the input loops inset by
   * maxDepthMm·tan(vBitAngleDeg/2), see {@link solveVCarveFlatRegion}), then
   * finishes the inset rim so the floor meets the V-walls with no un-carved
   * sliver. Absent/0 ⇒ V-walls only (output byte-identical to the engine
   * without a flat-bottom pass).
   */
  flatBottomClearance?: number
}

export type VCarve2dGenerateResult = {
  lines: string[]
  /** User-facing CAM notes (resolution clamps, approximation honesty, etc.). */
  hints: string[]
}

/** Caps the V-carve distance-field grid so a full-sheet Laguna job can't blow up the main process. */
export const VCARVE_MAX_GRID_CELLS = 360_000

/** A solved ridge sample: world XY, clearance radius `r`, and capped carve depth (positive mm). */
export type VCarveRidgePoint = { x: number; y: number; r: number; depthMm: number }

/** Even-odd inside test across many rings (interior when an odd number of rings contain the point). */
function pointInsideRings(rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>, x: number, y: number): boolean {
  let parity = 0
  for (const ring of rings) {
    if (ring.length >= 3 && pointInRing2d(ring, x, y)) parity ^= 1
  }
  return parity === 1
}

/** Distance to the nearest boundary edge across all rings (the inscribed-clearance radius). */
function minDistanceToAnyRing(rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const ring of rings) {
    if (ring.length < 2) continue
    const d = minDistanceToRingEdges(ring, x, y)
    if (d < best) best = d
  }
  return best
}

/**
 * Convert a V-bit FULL included angle to depth-per-clearance-radius (`1/tan(half)`).
 * A 90° bit → half 45° → factor 1 (depth == radius). A 60° bit → ~1.732 (deeper).
 * Clamped to a sane half-angle band so a degenerate angle can't divide by ~0.
 */
export function vCarveDepthPerRadius(vBitAngleDeg: number): number {
  const full = Number.isFinite(vBitAngleDeg) ? vBitAngleDeg : 90
  const halfDeg = Math.min(89, Math.max(1, full / 2))
  return 1 / Math.tan((halfDeg * Math.PI) / 180)
}

/**
 * Solve the distance-field medial-axis ridge for a set of closed rings and map
 * each ridge cell to a capped V-carve depth. Exported so the engine test can
 * assert the depth profile (deepest-at-widest, monotonic-with-width, capped)
 * directly without parsing G-code.
 */
export function solveVCarveRidge(params: {
  rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  vBitAngleDeg: number
  maxDepthMm: number
  stepoverMm?: number
}): { points: VCarveRidgePoint[]; stepMm: number; capMm: number; clampedResolution: boolean } {
  const rings = params.rings.filter((r) => r.length >= 3)
  const capMm = Math.max(0, params.maxDepthMm)
  if (rings.length === 0 || !(capMm > 0)) {
    return { points: [], stepMm: 0, capMm, clampedResolution: false }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  if (!(spanX > 1e-6) || !(spanY > 1e-6)) {
    return { points: [], stepMm: 0, capMm, clampedResolution: false }
  }

  // Default resolution: ~1/120 of the larger span, clamped to [0.2, 2] mm, then
  // raised if the grid would exceed the cell budget (full-sheet safety).
  const requested =
    typeof params.stepoverMm === 'number' && Number.isFinite(params.stepoverMm) && params.stepoverMm > 0
      ? params.stepoverMm
      : Math.max(0.2, Math.min(2, Math.max(spanX, spanY) / 120))
  let step = Math.max(0.05, requested)
  let clampedResolution = false
  // Ensure (cols * rows) <= budget by lifting step if necessary. The closed-form
  // sqrt(area/budget) is a first estimate; the +1 padding and ceil() rounding on
  // each axis can still tip the product over the cap, so we grow the step in a
  // bounded loop until the invariant holds exactly (hard main-process guarantee).
  const cellsAt = (s: number): number => (Math.ceil(spanX / s) + 1) * (Math.ceil(spanY / s) + 1)
  if (cellsAt(step) > VCARVE_MAX_GRID_CELLS) {
    step = Math.max(step, Math.sqrt((spanX * spanY) / VCARVE_MAX_GRID_CELLS))
    let guard = 0
    while (cellsAt(step) > VCARVE_MAX_GRID_CELLS && guard < 1000) {
      step *= 1.02
      guard += 1
    }
    clampedResolution = true
  }

  const cols = Math.ceil(spanX / step) + 1
  const rows = Math.ceil(spanY / step) + 1
  const field = new Float64Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    const y = minY + j * step
    for (let i = 0; i < cols; i++) {
      const x = minX + i * step
      field[j * cols + i] = pointInsideRings(rings, x, y) ? minDistanceToAnyRing(rings, x, y) : 0
    }
  }

  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : field[j * cols + i]!)
  const depthPerR = vCarveDepthPerRadius(params.vBitAngleDeg)
  const points: VCarveRidgePoint[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = field[j * cols + i]!
      if (d <= 1e-6) continue
      const left = at(i - 1, j)
      const right = at(i + 1, j)
      const up = at(i, j - 1)
      const down = at(i, j + 1)
      // 1-D local maximum along X or Y (the discrete distance-field skeleton).
      // The `(d > nbr || nbr === 0)` plateau-breaker keeps a flat ridge one cell
      // wide instead of a thick band, so the toolpath traces the spine.
      const ridgeX = d >= left && d >= right && (d > left || d > right || left === 0 || right === 0)
      const ridgeY = d >= up && d >= down && (d > up || d > down || up === 0 || down === 0)
      if (!ridgeX && !ridgeY) continue
      points.push({
        x: minX + i * step,
        y: minY + j * step,
        r: d,
        depthMm: Math.min(capMm, d * depthPerR)
      })
    }
  }
  return { points, stepMm: step, capMm, clampedResolution }
}

/** Caps flat-bottom raster rows so a pathological stepover cannot emit a multi-million-line floor pass. */
export const VCARVE_FLAT_MAX_RASTER_ROWS = 40_000

/**
 * Arc tolerance (mm) for the rounded rim corners Clipper generates at reflex
 * boundary vertices during the flat-floor inset. 0.02 mm keeps the rim within a
 * couple hundredths of the true distance-field boundary without exploding the
 * vertex count (the raster scanline is O(rows × rim vertices)).
 */
const VCARVE_FLAT_ARC_TOLERANCE_MM = 0.02

/** The flat-bottom (prism) floor region of a capped V-carve (see {@link solveVCarveFlatRegion}). */
export type VCarveFlatRegion = {
  /**
   * Floor-boundary rings (mm) at z = -maxDepthMm: the input loops inset by
   * {@link insetMm}. Clipper-normalised polygon-with-holes — outer boundaries
   * CCW (positive area), holes CW — the same winding contract as
   * `sketch-boolean-offset`. Empty when the cap never binds (no flat floor).
   */
  rings: CamPoint2d[][]
  /** Rim inset distance (mm): maxDepthMm · tan(vBitAngleDeg / 2). */
  insetMm: number
}

/**
 * Solve the flat-bottom (prism) floor region for a capped V-carve.
 *
 * The V-bit saturates the depth cap wherever the clearance radius `r` exceeds
 * `cap · tan(half)` (uncapped depth `r / tan(half)` > cap), so the floor at
 * z = -cap is the even-odd region of the input rings ERODED by that radius.
 * Computed with Clipper (the Wave-3g offset/boolean engine, `CLIPPER_SCALE`
 * mm→int convention): an even-odd union first normalises arbitrary ring
 * winding/nesting into outer-CCW / hole-CW rings, then a negative round-join
 * offset erodes by the rim inset (round joins reproduce the distance-field's
 * circular rim arcs at reflex corners). Returns no rings when the inset
 * swallows the shape — narrow geometry that never reaches the cap has no flat
 * floor and needs no clearance pass.
 */
export function solveVCarveFlatRegion(params: {
  rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  vBitAngleDeg: number
  maxDepthMm: number
}): VCarveFlatRegion {
  const capMm = Math.max(0, params.maxDepthMm)
  const insetMm = capMm / vCarveDepthPerRadius(params.vBitAngleDeg)
  const rings = params.rings.filter((r) => r.length >= 3)
  if (rings.length === 0 || !(capMm > 0) || !(insetMm > 0)) {
    return { rings: [], insetMm }
  }

  // mm → Clipper integer paths (shared CLIPPER_SCALE convention: 1e4 ⇒ 0.1 µm
  // resolution; the Laguna's 3048 mm bed maps far inside Clipper's safe range).
  const subject = rings.map((ring) =>
    ring.map((p): IntPoint => ({ X: Math.round(p[0] * CLIPPER_SCALE), Y: Math.round(p[1] * CLIPPER_SCALE) }))
  )

  // 1) Even-odd union normalises the rings (matches VCarve2dParams island
  //    semantics) into outer-CCW / hole-CW polygon-with-holes form.
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
  const normalized: IntPoint[][] = []
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    normalized,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd
  )
  if (normalized.length === 0) return { rings: [], insetMm }

  // 2) Erode by the rim inset: a negative delta shrinks outers and grows holes.
  const offsetter = new ClipperLib.ClipperOffset(2, VCARVE_FLAT_ARC_TOLERANCE_MM * CLIPPER_SCALE)
  offsetter.AddPaths(normalized, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const eroded: IntPoint[][] = []
  offsetter.Execute(eroded, -insetMm * CLIPPER_SCALE)

  const out: CamPoint2d[][] = []
  for (const path of eroded) {
    if (path.length < 3) continue
    out.push(path.map((ip): CamPoint2d => [ip.X / CLIPPER_SCALE, ip.Y / CLIPPER_SCALE]))
  }
  return { rings: out, insetMm }
}

/**
 * Even-odd horizontal scanline across MANY rings (the flat-floor variant of the
 * single-ring `horizontalSegmentsInsideRing`): crossings from every ring are
 * pooled, sorted, and paired, so holes punched by inner rings are skipped and
 * disjoint floor islands yield separate segments.
 */
function horizontalSegmentsInsideRingsEvenOdd(
  rings: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  y: number
): Array<[number, number]> {
  const xs: number[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i]!
      const [x2, y2] = ring[(i + 1) % ring.length]!
      if (Math.abs(y2 - y1) < 1e-9) continue
      // Half-open to avoid double counting at shared vertices.
      const ymin = Math.min(y1, y2)
      const ymax = Math.max(y1, y2)
      if (!(y >= ymin && y < ymax)) continue
      const t = (y - y1) / (y2 - y1)
      xs.push(x1 + t * (x2 - x1))
    }
  }
  xs.sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i]!
    const b = xs[i + 1]!
    if (b - a > 1e-6) out.push([a, b])
  }
  return out
}

/**
 * Emit the flat-bottom clearance section: a raster zig-zag over the floor
 * region plus a rim finish trace along every floor ring, all at exactly
 * z = -capMm. Mirrors the pocket-raster safety convention — EVERY stroke
 * (row or rim) begins with a safe-Z lift + XY rapid + plunge, so no XY rapid
 * ever happens at cut depth and disjoint floor islands are always separated
 * by a lift. The rim finish is the wall/floor join: the V-bit tip riding the
 * inset boundary at z = -cap puts the bit's cone exactly against the V-wall
 * (cone radius at the surface = capMm · tan(half) = the rim inset), so the
 * floor meets the walls with no un-carved sliver.
 */
function emitVCarveFlatBottomLines(opts: {
  region: VCarveFlatRegion
  capMm: number
  /** Requested raster stepover (mm) — `flatBottomClearance` from the op params. */
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
}): { lines: string[]; rasterRowCount: number; stepMm: number; clampedStepover: boolean } {
  const rings = opts.region.rings
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const ring of rings) {
    for (const [, yv] of ring) {
      minY = Math.min(minY, yv)
      maxY = Math.max(maxY, yv)
    }
  }
  if (!(maxY >= minY)) {
    return { lines: [], rasterRowCount: 0, stepMm: opts.stepoverMm, clampedStepover: false }
  }

  // Row cap (main-process safety, mirrors PARALLEL_FINISH_MAX_Y_PASSES): lift
  // the stepover until the row count fits, growing in a bounded loop so the
  // ceil() rounding can never tip the invariant.
  const spanY = maxY - minY
  let step = Math.max(0.05, opts.stepoverMm)
  let clampedStepover = false
  const rowsAt = (s: number): number => Math.ceil(spanY / s) + 1
  if (rowsAt(step) > VCARVE_FLAT_MAX_RASTER_ROWS) {
    step = Math.max(step, spanY / Math.max(1, VCARVE_FLAT_MAX_RASTER_ROWS - 1))
    let guard = 0
    while (rowsAt(step) > VCARVE_FLAT_MAX_RASTER_ROWS && guard < 1000) {
      step *= 1.02
      guard += 1
    }
    clampedStepover = true
  }

  const zCut = (-opts.capMm).toFixed(3)
  const safe = opts.safeZMm.toFixed(3)
  const feed = opts.feedMmMin.toFixed(0)
  const plunge = opts.plungeMmMin.toFixed(0)
  const lines: string[] = []
  lines.push(
    `; V-carve flat-bottom — ${rings.length} floor ring(s), rim inset ${opts.region.insetMm.toFixed(3)} mm, floor z ${zCut} mm, stepover ${step.toFixed(3)} mm`
  )

  // 1) Raster zig-zag floor fill (safe-Z lift before every stroke — pocket precedent).
  let rasterRowCount = 0
  let y = minY
  let reverseRow = false
  while (y <= maxY + 1e-6) {
    const segs = horizontalSegmentsInsideRingsEvenOdd(rings, y)
    if (segs.length > 0) {
      const row = reverseRow ? [...segs].reverse() : segs
      for (const seg of row) {
        const [a, b] = seg
        if (b - a <= 1e-6) continue
        const x0 = reverseRow ? b : a
        const x1 = reverseRow ? a : b
        lines.push(`G0 Z${safe}`)
        lines.push(`G0 X${x0.toFixed(3)} Y${y.toFixed(3)}`)
        lines.push(`G1 Z${zCut} F${plunge}`)
        lines.push(`G1 X${x1.toFixed(3)} Y${y.toFixed(3)} F${feed}`)
        rasterRowCount += 1
      }
      reverseRow = !reverseRow
    }
    y += step
  }

  // 2) Rim finish — trace every floor ring at z = -cap (the wall/floor join).
  for (const ring of rings) {
    if (ring.length < 3) continue
    const [sx, sy] = ring[0]!
    lines.push(`G0 Z${safe}`)
    lines.push(`G0 X${sx.toFixed(3)} Y${sy.toFixed(3)}`)
    lines.push(`G1 Z${zCut} F${plunge}`)
    for (let i = 1; i < ring.length; i++) {
      const [px, py] = ring[i]!
      lines.push(`G1 X${px.toFixed(3)} Y${py.toFixed(3)} F${feed}`)
    }
    lines.push(`G1 X${sx.toFixed(3)} Y${sy.toFixed(3)} F${feed}`)
  }

  return { lines, rasterRowCount, stepMm: step, clampedStepover }
}

/**
 * Generate a V-carve toolpath from closed vector(s). Emits XYZ feed polylines
 * (z = -depth) along the medial-axis ridge with safe-Z lifts between disjoint
 * branches. The body is posted unchanged by `vcarve_mach3.hbs` (Laguna Swift):
 * the post supplies `%`, G21/G90/G17, spindle warm-up/cool-down, dust M7/M9,
 * and the M30 terminator — this generator owns only the cut body + safe-Z.
 *
 * Caller MUST pass `maxDepthMm` already clamped to the stock thickness / Z
 * envelope (see `dispatch2dStrategy`) so the cap honours the material.
 *
 * With `flatBottomClearance` set, a SECOND chained section follows the V-wall
 * pass: the flat floor (where the uncapped V depth would exceed the cap) is
 * cleared at z = -maxDepthMm — raster rows at the flatBottomClearance stepover
 * plus a rim finish along the inset boundary — with a safe-Z lift before every
 * disjoint stroke (see `solveVCarveFlatRegion`).
 */
export function generateVCarve2dLines(params: VCarve2dParams): VCarve2dGenerateResult {
  const hints: string[] = []
  const { points, stepMm, capMm, clampedResolution } = solveVCarveRidge({
    rings: params.rings,
    vBitAngleDeg: params.vBitAngleDeg,
    maxDepthMm: params.maxDepthMm,
    stepoverMm: params.stepoverMm
  })
  if (points.length === 0) return { lines: [], hints }

  const safeZ = params.safeZMm
  const feed = params.feedMmMin
  const plunge = params.plungeMmMin
  // Connection radius: a ridge step away from a 4/8-neighbour is at most ~√2·step.
  // 2.2·step keeps chaining local (true disjoint branches stay separated) while
  // tolerating the diagonal skeleton spacing so a single stroke stays one branch.
  const connR = Math.max(1e-6, stepMm * 2.2)
  const connR2 = connR * connR

  const used = new Array<boolean>(points.length).fill(false)
  // Seed branches from the deepest unused ridge point so the heaviest cut leads.
  const order = [...points.keys()].sort((a, b) => points[b]!.depthMm - points[a]!.depthMm)

  const lines: string[] = []
  lines.push(
    `; V-carve — ${points.length} ridge pts, ${params.vBitAngleDeg.toFixed(0)}° V-bit, depth cap ${capMm.toFixed(3)} mm, res ${stepMm.toFixed(3)} mm`
  )
  for (const seed of order) {
    if (used[seed]) continue
    let cur = seed
    used[cur] = true
    const p0 = points[cur]!
    // Disjoint branch: always lift to safe-Z, rapid in XY, then plunge.
    lines.push(`G0 Z${safeZ.toFixed(3)}`)
    lines.push(`G0 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)}`)
    lines.push(`G1 Z${(-p0.depthMm).toFixed(3)} F${plunge.toFixed(0)}`)
    // Greedy nearest-neighbour walk within the connection radius.
    for (;;) {
      const c = points[cur]!
      let best = -1
      let bestD2 = connR2 + 1
      for (let k = 0; k < points.length; k++) {
        if (used[k]) continue
        const pk = points[k]!
        const dx = pk.x - c.x
        const dy = pk.y - c.y
        const d2 = dx * dx + dy * dy
        if (d2 <= connR2 && d2 < bestD2) {
          bestD2 = d2
          best = k
        }
      }
      if (best < 0) break
      used[best] = true
      cur = best
      const pn = points[cur]!
      lines.push(`G1 X${pn.x.toFixed(3)} Y${pn.y.toFixed(3)} Z${(-pn.depthMm).toFixed(3)} F${feed.toFixed(0)}`)
    }
  }
  // ── Flat-bottom (prism) clearance pass ────────────────────────────────────
  // Where the UNCAPPED depth r·depthPerR exceeds the cap, the V-bit bottoms out
  // at z = -cap and the floor between the V-walls is FLAT. With
  // flatBottomClearance set, chain a SECOND section that clears that floor
  // (raster + rim finish at exactly z = -cap); every stroke starts with its own
  // safe-Z lift, so the section is always separated from the V-wall pass (and
  // from disjoint floor islands) by a lift. Without the param the body above is
  // byte-identical to the V-walls-only engine.
  const flatHints: string[] = []
  if (
    typeof params.flatBottomClearance === 'number' &&
    Number.isFinite(params.flatBottomClearance) &&
    params.flatBottomClearance > 0
  ) {
    const flat = solveVCarveFlatRegion({
      rings: params.rings,
      vBitAngleDeg: params.vBitAngleDeg,
      maxDepthMm: capMm
    })
    if (flat.rings.length === 0) {
      flatHints.push(
        `V-carve: flatBottomClearance is set but the carve never saturates the ${capMm.toFixed(3)} mm depth cap anywhere, so no flat floor exists — no flat-bottom pass emitted (the V-walls cover the full carve).`
      )
    } else {
      const floor = emitVCarveFlatBottomLines({
        region: flat,
        capMm,
        stepoverMm: params.flatBottomClearance,
        feedMmMin: feed,
        plungeMmMin: plunge,
        safeZMm: safeZ
      })
      lines.push(...floor.lines)
      if (floor.clampedStepover) {
        flatHints.push(
          `V-carve: flat-bottom raster stepover was coarsened to ${floor.stepMm.toFixed(3)} mm to keep the floor pass under ${VCARVE_FLAT_MAX_RASTER_ROWS.toLocaleString()} rows for this region size.`
        )
      }
      flatHints.push(
        `V-carve: flat-bottom clearance pass emitted — floor cleared at z=${(-capMm).toFixed(3)} mm across ${flat.rings.length} floor ring(s) (rim inset ${flat.insetMm.toFixed(3)} mm where the V cut saturates the depth cap): ${floor.rasterRowCount} raster row(s) at the ${floor.stepMm.toFixed(3)} mm flatBottomClearance stepover + a rim finish pass joining floor to V-walls.`
      )
    }
  }

  // Final safe-Z so the post's cool-down/retract starts from clearance.
  lines.push(`G0 Z${safeZ.toFixed(3)}`)

  if (clampedResolution) {
    hints.push(
      `V-carve: sampling resolution was coarsened to ${stepMm.toFixed(3)} mm to keep the medial-axis grid under ${VCARVE_MAX_GRID_CELLS.toLocaleString()} cells for this shape size — pass a larger stepoverMm for an explicit resolution.`
    )
  }
  hints.push(...flatHints)
  hints.push(
    'V-carve depth is a distance-field medial-axis approximation (deepest at the widest span, capped to stock); verify against your V-bit angle + stock thickness before cutting.'
  )
  return { lines, hints }
}

// ────────────────────────────────────────────────────────────────────────────
// AUTO-TAB (HOLDING BRIDGE) INSERTION  (Makera CAM-style tabsMode for contour)
// ────────────────────────────────────────────────────────────────────────────

export type TabInsertionMode = 'none' | 'count' | 'interval'

export type TabParams = {
  tabsMode: TabInsertionMode
  /** Number of evenly-spaced tabs (for tabsMode = 'count'). */
  tabCount?: number
  /** Approximate spacing between tab centres (mm, for tabsMode = 'interval'). */
  tabIntervalMm?: number
  /** Width of each tab bridge in XY (mm, default 3). */
  tabWidthMm?: number
  /** Height of each tab above the cut floor (mm, default 1.5). */
  tabHeightMm?: number
}

/** Compute perimeter length of a closed polygon. */
export function polygonPerimeterMm(points: ReadonlyArray<CamPoint2d>): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    total += Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  }
  return total
}

/**
 * Returns arc-length positions (mm along perimeter) for tab centres.
 */
export function computeTabPositionsMm(perimeter: number, params: TabParams): number[] {
  if (params.tabsMode === 'none' || perimeter <= 0) return []
  if (params.tabsMode === 'count') {
    const n = Math.max(1, Math.round(params.tabCount ?? 4))
    return Array.from({ length: n }, (_, k) => (perimeter * k) / n)
  }
  if (params.tabsMode === 'interval') {
    const interval = Math.max(1, params.tabIntervalMm ?? 50)
    const n = Math.max(1, Math.round(perimeter / interval))
    return Array.from({ length: n }, (_, k) => (perimeter * k) / n)
  }
  return []
}

/**
 * Injects G-code tab bridges into a contour pass.
 * The tool rises to `zWork + tabHeightMm` across the tab width, then drops back.
 */
export function injectTabsIntoContourPass(
  contourPoints: ReadonlyArray<CamPoint2d>,
  zWork: number,
  feedMmMin: number,
  tabPositionsMm: number[],
  tabWidthMm: number,
  tabHeightMm: number
): string[] {
  if (tabPositionsMm.length === 0 || contourPoints.length < 3) return []
  const pts = [...contourPoints, contourPoints[0]!] // closed
  const zTab = zWork + Math.abs(tabHeightMm)
  const halfTab = tabWidthMm / 2
  const lines: string[] = []

  const segLengths: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[i + 1]!
    segLengths.push(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2))
  }

  const tabRanges = tabPositionsMm.map((c) => [c - halfTab, c + halfTab] as [number, number])

  let arcPos = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[i + 1]!
    const segLen = segLengths[i]!
    const segEnd = arcPos + segLen

    const intersectingTabs = tabRanges.filter(([ts, te]) => ts < segEnd && te > arcPos)
    if (intersectingTabs.length === 0) {
      lines.push(`G1 X${x2.toFixed(3)} Y${y2.toFixed(3)} F${feedMmMin.toFixed(0)}`)
      arcPos = segEnd
      continue
    }

    if (segLen < 1e-9) { arcPos = segEnd; continue }
    const dx = (x2 - x1) / segLen
    const dy = (y2 - y1) / segLen

    for (const [tabStart, tabEnd] of intersectingTabs) {
      const localStart = Math.max(tabStart - arcPos, 0)
      const localEnd = Math.min(tabEnd - arcPos, segLen)
      if (localStart > 0) {
        lines.push(`G1 X${(x1 + dx * localStart).toFixed(3)} Y${(y1 + dy * localStart).toFixed(3)} Z${zWork.toFixed(3)} F${feedMmMin.toFixed(0)}`)
      }
      lines.push(`G1 X${(x1 + dx * localStart).toFixed(3)} Y${(y1 + dy * localStart).toFixed(3)} Z${zTab.toFixed(3)} F${feedMmMin.toFixed(0)}`)
      lines.push(`G1 X${(x1 + dx * localEnd).toFixed(3)} Y${(y1 + dy * localEnd).toFixed(3)} Z${zTab.toFixed(3)} F${feedMmMin.toFixed(0)}`)
      lines.push(`G1 X${(x1 + dx * localEnd).toFixed(3)} Y${(y1 + dy * localEnd).toFixed(3)} Z${zWork.toFixed(3)} F${feedMmMin.toFixed(0)}`)
    }
    lines.push(`G1 X${x2.toFixed(3)} Y${y2.toFixed(3)} Z${zWork.toFixed(3)} F${feedMmMin.toFixed(0)}`)
    arcPos = segEnd
  }
  return lines
}
