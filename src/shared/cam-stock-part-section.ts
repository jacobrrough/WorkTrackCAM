/**
 * Build the PART mesh's TOP surface as a {@link HeightField2d5} for the
 * in-process stock model ({@link ./cam-stock-model}).
 *
 * Roughing/rest machining clears the remaining stock down toward this part
 * surface (+ allowance). Each grid cell takes the **maximum Z over the
 * triangles covering its center** (the upper envelope, as seen from +Z) —
 * exactly the semantics of `heightAtXyFromTriangles` in `src/main/cam-local.ts`.
 *
 * Why a sibling sampler instead of importing that one: `cam-local.ts` lives in
 * `src/main/` and the `src/shared/` layer never imports from `src/main/`
 * (one-way dependency). The barycentric inside-test + triangle-plane-Z math
 * here is the same algorithm as `pointInTriangle2d` / `zOnTrianglePlane`, kept
 * pure and dependency-free for the shared layer (and matching the `Vec3`
 * triangle shape used by `src/main/stl.ts`).
 *
 * Cells with no covering triangle get `emptyZ` — a safe low sentinel — so the
 * stock model's TO-CLEAR query never reports phantom material outside the part
 * footprint.
 *
 * Pure math / data-structure module: NO G-code emission, NO file I/O.
 */

import type { HeightField2d5 } from './cam-heightfield-2d5'

/**
 * A 3D point `[x, y, z]` (mm). Matches the `Vec3` shape from `src/main/stl.ts`
 * and the triangle vertices yielded by the binary/ASCII STL collectors, so the
 * same triangle arrays feed directly into {@link buildPartHeightField}.
 */
export type Vec3 = readonly [number, number, number]

/** A triangle as three vertices, mirroring the tuples from the STL collectors. */
export type Triangle3 = readonly [Vec3, Vec3, Vec3]

/** Default sentinel for cells with no triangle coverage — well below any realistic part top. */
const DEFAULT_EMPTY_Z = -1e6
const DEFAULT_PART_MAX_COLS = 256
const DEFAULT_PART_MAX_ROWS = 256
const PART_MIN_DIM = 2
const PART_MIN_CELL_MM = 0.1

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

/** Signed area sign for the barycentric inside-test (sign of (P,A,B)). */
function triSign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

/** True when (px,py) is inside (or on) triangle (a,b,c) in the XY plane. */
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

/** Z on the triangle's plane at (px,py); null when the triangle is (near) vertical. */
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

/**
 * Maximum Z over all triangles covering (px, py) in XY — the upper surface as
 * seen from +Z. Returns null when no (non-vertical) triangle covers the point.
 *
 * Same contract as `heightAtXyFromTriangles` in `src/main/cam-local.ts`.
 */
function partHeightAtXy(triangles: ReadonlyArray<Triangle3>, px: number, py: number): number | null {
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

/**
 * Options for {@link buildPartHeightField}. The XY region is `[minX,maxX] ×
 * [minY,maxY]`; resolution is set by `cellMm` (explicit) or `maxCols`/`maxRows`
 * (caps). `emptyZ` is the sentinel for cells with no triangle coverage.
 */
export type BuildPartHeightFieldOptions = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Upper bound on grid columns (X). Defaults to {@link DEFAULT_PART_MAX_COLS}. */
  maxCols?: number
  /** Upper bound on grid rows (Y). Defaults to {@link DEFAULT_PART_MAX_ROWS}. */
  maxRows?: number
  /** Explicit cell size (mm). When set it drives resolution (still capped by maxCols/maxRows). */
  cellMm?: number
  /** Sentinel Z for cells with no covering triangle. Defaults to a large negative value. */
  emptyZ?: number
}

/**
 * Sample a triangle mesh's top surface onto a {@link HeightField2d5} grid.
 *
 * Grid layout matches {@link ../cam-stock-model.createBoxStockModel} (same
 * origin/cell math) so a part field and a stock model over the same region
 * align cell-for-cell. Each cell center is tested against the mesh; covered
 * cells get the max covering Z, uncovered cells get `emptyZ`.
 *
 * `stockTopZ` on the returned field is set to `emptyZ` so the bilinear
 * out-of-bounds fallback in {@link ../cam-heightfield-2d5.sampleHeightFieldZ}
 * also returns the empty sentinel beyond the grid.
 */
export function buildPartHeightField(
  triangles: ReadonlyArray<Triangle3>,
  opts: BuildPartHeightFieldOptions
): HeightField2d5 {
  const emptyZ =
    typeof opts.emptyZ === 'number' && Number.isFinite(opts.emptyZ) ? opts.emptyZ : DEFAULT_EMPTY_Z
  const maxCols = clampInt(opts.maxCols ?? DEFAULT_PART_MAX_COLS, PART_MIN_DIM, 4096)
  const maxRows = clampInt(opts.maxRows ?? DEFAULT_PART_MAX_ROWS, PART_MIN_DIM, 4096)

  const minX = Math.min(opts.minX, opts.maxX)
  const maxX = Math.max(opts.minX, opts.maxX)
  const minY = Math.min(opts.minY, opts.maxY)
  const maxY = Math.max(opts.minY, opts.maxY)

  const spanX = Math.max(maxX - minX, PART_MIN_CELL_MM)
  const spanY = Math.max(maxY - minY, PART_MIN_CELL_MM)

  let cellMm: number
  if (typeof opts.cellMm === 'number' && Number.isFinite(opts.cellMm) && opts.cellMm > 0) {
    cellMm = Math.max(opts.cellMm, PART_MIN_CELL_MM)
  } else {
    cellMm = Math.max(spanX / maxCols, spanY / maxRows, PART_MIN_CELL_MM)
  }

  let cols = clampInt(Math.ceil(spanX / cellMm), PART_MIN_DIM, maxCols)
  let rows = clampInt(Math.ceil(spanY / cellMm), PART_MIN_DIM, maxRows)
  if (Math.ceil(spanX / cellMm) > maxCols || Math.ceil(spanY / cellMm) > maxRows) {
    cellMm = Math.max(spanX / maxCols, spanY / maxRows, PART_MIN_CELL_MM)
    cols = clampInt(Math.ceil(spanX / cellMm), PART_MIN_DIM, maxCols)
    rows = clampInt(Math.ceil(spanY / cellMm), PART_MIN_DIM, maxRows)
  }

  const topZ = new Float32Array(cols * rows)
  topZ.fill(emptyZ)

  for (let j = 0; j < rows; j++) {
    const cy = minY + (j + 0.5) * cellMm
    for (let i = 0; i < cols; i++) {
      const cx = minX + (i + 0.5) * cellMm
      const z = partHeightAtXy(triangles, cx, cy)
      if (z != null && Number.isFinite(z)) topZ[j * cols + i] = z
    }
  }

  return { originX: minX, originY: minY, cellMm, cols, rows, topZ, stockTopZ: emptyZ }
}
