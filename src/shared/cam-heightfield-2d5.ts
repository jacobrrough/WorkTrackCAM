import type { ToolpathSegment3 } from './cam-gcode-toolpath'

export type HeightField2d5 = {
  originX: number
  originY: number
  cellMm: number
  cols: number
  rows: number
  /** Remaining solid top Z (mm); lowered under the tool envelope along cutting segments. */
  topZ: Float32Array
  stockTopZ: number
}

/**
 * Tool shape for heightfield stamping. Determines the cross-sectional Z profile
 * stamped onto the height field at each cut point.
 * - `'flat'`: cylindrical endmill — Z is constant across the tool footprint (default).
 * - `'ball'`: ball-end mill — Z rises toward the tool edge following the hemisphere profile.
 */
export type HeightFieldToolShape = 'flat' | 'ball'

export type BuildHeightFieldOptions = {
  toolRadiusMm: number
  /** Upper bound on grid resolution (performance). */
  maxCols?: number
  maxRows?: number
  /** Initial planar stock top Z before cuts. */
  stockTopZ?: number
  /** Ignore feed segments entirely above this Z (air moves near stock top). */
  cuttingZThreshold?: number
  marginMm?: number
  /**
   * Tool shape for stamping accuracy. Ball-end mills produce a hemisphere
   * stamp (deeper at centre, shallower at edges); flat endmills produce a
   * constant-depth cylinder stamp. Defaults to `'flat'` (legacy behaviour).
   */
  toolShape?: HeightFieldToolShape
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function stampDisk(
  field: { originX: number; originY: number; cellMm: number; cols: number; rows: number; topZ: Float32Array; stockTopZ: number },
  cx: number,
  cy: number,
  cutZ: number,
  radiusMm: number,
  toolShape: HeightFieldToolShape = 'flat'
): void {
  // Guard: skip stamps with non-finite depth to prevent corrupted heightfield values.
  if (!Number.isFinite(cutZ)) return
  const { originX, originY, cellMm, cols, rows, topZ } = field
  const rCells = Math.ceil(radiusMm / cellMm) + 1
  const ic = Math.floor((cx - originX) / cellMm)
  const jc = Math.floor((cy - originY) / cellMm)
  const R = radiusMm
  const R2 = R * R
  for (let dj = -rCells; dj <= rCells; dj++) {
    for (let di = -rCells; di <= rCells; di++) {
      const i = ic + di
      const j = jc + dj
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue
      const px = originX + (i + 0.5) * cellMm
      const py = originY + (j + 0.5) * cellMm
      const r = Math.hypot(px - cx, py - cy)
      if (r > R + 1e-6) continue
      // For a ball-end mill the cutting surface is a hemisphere: at radial
      // distance r from centre the Z rises by R - sqrt(R² - r²). At the
      // centre (r=0) effectiveZ = cutZ; at the edge (r≈R) effectiveZ ≈ cutZ+R.
      let effectiveZ = cutZ
      if (toolShape === 'ball' && r < R) {
        effectiveZ = cutZ + R - Math.sqrt(R2 - r * r)
      }
      const idx = j * cols + i
      const cur = topZ[idx]!
      if (effectiveZ < cur) topZ[idx] = effectiveZ
    }
  }
}

function stampSegment(
  field: Parameters<typeof stampDisk>[0],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  radiusMm: number,
  toolShape: HeightFieldToolShape = 'flat'
): void {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(field.cellMm * 0.35, 0.05)
  const n = Math.max(1, Math.ceil(len / step))
  for (let k = 0; k <= n; k++) {
    const t = k / n
    const x = x0 + t * (x1 - x0)
    const y = y0 + t * (y1 - y0)
    const z = z0 + t * (z1 - z0)
    stampDisk(field, x, y, z, radiusMm, toolShape)
  }
}

/**
 * Approximate 2.5D stock top after passes: stamps a cylindrical tool footprint along **feed** segments
 * whose depth goes below {@link BuildHeightFieldOptions.cuttingZThreshold}.
 */
export function buildHeightFieldFromCuttingSegments(
  segments: ReadonlyArray<ToolpathSegment3>,
  opts: BuildHeightFieldOptions
): HeightField2d5 | null {
  const toolRadiusMm = Math.max(0.05, opts.toolRadiusMm)
  const maxCols = opts.maxCols ?? 96
  const maxRows = opts.maxRows ?? 96
  const stockTopZ = opts.stockTopZ ?? 0
  const cuttingZThreshold = opts.cuttingZThreshold ?? 0.05
  const marginMm = opts.marginMm ?? toolRadiusMm + 1

  const cutting = segments.filter(
    (s) =>
      s.kind === 'feed' &&
      (Math.min(s.z0, s.z1) < cuttingZThreshold || Math.max(s.z0, s.z1) < cuttingZThreshold)
  )
  if (cutting.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of cutting) {
    minX = Math.min(minX, s.x0, s.x1)
    minY = Math.min(minY, s.y0, s.y1)
    maxX = Math.max(maxX, s.x0, s.x1)
    maxY = Math.max(maxY, s.y0, s.y1)
  }
  minX -= marginMm
  minY -= marginMm
  maxX += marginMm
  maxY += marginMm

  const spanX = maxX - minX
  const spanY = maxY - minY
  if (!(spanX > 1e-6) || !(spanY > 1e-6)) return null

  let cellMm = Math.max(spanX / maxCols, spanY / maxRows, 0.1)
  let cols = Math.ceil(spanX / cellMm)
  let rows = Math.ceil(spanY / cellMm)
  if (cols > maxCols) {
    cellMm = spanX / maxCols
    cols = maxCols
    rows = Math.ceil(spanY / cellMm)
  }
  if (rows > maxRows) {
    cellMm = Math.max(cellMm, spanY / maxRows)
    rows = maxRows
    cols = Math.ceil(spanX / cellMm)
  }
  cols = clamp(cols, 2, maxCols)
  rows = clamp(rows, 2, maxRows)
  cellMm = Math.max(spanX / cols, spanY / rows, 0.1)

  const originX = minX
  const originY = minY
  const topZ = new Float32Array(cols * rows)
  topZ.fill(stockTopZ)

  const field = { originX, originY, cellMm, cols, rows, topZ, stockTopZ }
  const toolShape: HeightFieldToolShape = opts.toolShape ?? 'flat'

  for (const s of cutting) {
    stampSegment(field, s.x0, s.y0, s.x1, s.y1, s.z0, s.z1, toolRadiusMm, toolShape)
  }

  return { originX, originY, cellMm, cols, rows, topZ, stockTopZ }
}

/**
 * Bilinear interpolation of the remaining stock top Z at world coordinates (x, y).
 *
 * Uses the four nearest grid cells to produce a smoother Z estimate than
 * nearest-neighbour lookup.  Returns `hf.stockTopZ` (uncut surface) when
 * (x, y) lies outside the field bounds.
 */
export function sampleHeightFieldZ(hf: HeightField2d5, x: number, y: number): number {
  const { originX, originY, cellMm, cols, rows, topZ, stockTopZ } = hf
  if (!Number.isFinite(x) || !Number.isFinite(y)) return stockTopZ

  const fx = (x - originX) / cellMm
  const fy = (y - originY) / cellMm

  const ix = Math.floor(fx)
  const iy = Math.floor(fy)

  // Clamp to valid bilinear neighbourhood [0, cols-2] × [0, rows-2]
  const ix0 = Math.max(0, Math.min(ix, cols - 2))
  const iy0 = Math.max(0, Math.min(iy, rows - 2))
  const ix1 = ix0 + 1
  const iy1 = iy0 + 1

  // Fractional offsets within the cell (clamped to [0, 1])
  const tx = Math.max(0, Math.min(1, fx - ix0))
  const ty = Math.max(0, Math.min(1, fy - iy0))

  const z00 = topZ[iy0 * cols + ix0]!
  const z10 = topZ[iy0 * cols + ix1]!
  const z01 = topZ[iy1 * cols + ix0]!
  const z11 = topZ[iy1 * cols + ix1]!

  // Guard: if any corner cell is non-finite (should not occur given stampDisk guards, but
  // defensive against future code paths that might write sentinel values), fall back to
  // stockTopZ so callers always receive a valid Z.
  if (!Number.isFinite(z00) || !Number.isFinite(z10) || !Number.isFinite(z01) || !Number.isFinite(z11)) {
    return stockTopZ
  }

  const z0 = z00 + (z10 - z00) * tx
  const z1 = z01 + (z11 - z01) * tx
  const result = z0 + (z1 - z0) * ty
  return Number.isFinite(result) ? result : stockTopZ
}
