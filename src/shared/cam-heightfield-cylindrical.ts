/**
 * Cylindrical heightfield for 4-axis Tier 2/3 preview.
 *
 * Maps a 2D grid of (axial X, angular A) cells to a radial distance from the
 * rotation axis.  Tool footprints are stamped along 4-axis cutting segments to
 * produce a stock-removal preview that wraps around the cylinder.
 *
 * Coordinate convention (matches cam-axis4-cylindrical-raster.ts):
 *   X = axial position along rotation axis
 *   Z = radial distance from rotation center (G-code Z)
 *   A = rotation angle in degrees (0-360, wraps)
 */

import type { ToolpathSegment4 } from './cam-gcode-toolpath'

export type CylindricalHeightField = {
  /** Axial origin (mm). */
  originX: number
  /** Axial cell size (mm). */
  cellMm: number
  /** Angular cell size (degrees). */
  cellDeg: number
  /** Number of axial columns. */
  cols: number
  /** Number of angular rows (wraps at 360). */
  rows: number
  /**
   * Remaining radial distance from rotation axis per (X, A) cell.
   * Higher values = more stock remaining; tool stamps lower this toward
   * the part surface.  Initialized to stockRadius.
   */
  radii: Float32Array
  /** Initial stock outer radius (mm). */
  stockRadius: number
}

export type CylindricalHeightFieldToolShape = 'flat' | 'ball'

export type BuildCylindricalHeightFieldOptions = {
  toolRadiusMm: number
  /** Cylinder stock outer diameter (mm). */
  cylinderDiameterMm: number
  /** Axial extent of the stock (mm). */
  stockXMin: number
  stockXMax: number
  /** Upper bound on grid resolution (performance). */
  maxCols?: number
  maxRows?: number
  /** Ignore feed segments where radial Z stays above this (air moves). */
  cuttingRadiusThreshold?: number
  marginMm?: number
  toolShape?: CylindricalHeightFieldToolShape
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Wrap an angle (degrees) into [0, 360). */
function wrapDeg(a: number): number {
  const m = a % 360
  return m < 0 ? m + 360 : m
}

/**
 * Stamp a disk (tool footprint) onto the cylindrical heightfield at axial
 * position `cx`, angular position `aDeg`, and radial depth `cutRadius`.
 *
 * The stamp lowers the radii grid wherever the tool envelope reaches,
 * in both axial (X) and angular (A) space.
 */
function stampDiskCylindrical(
  field: CylindricalHeightField,
  cx: number,
  aDeg: number,
  cutRadius: number,
  toolRadiusMm: number,
  toolShape: CylindricalHeightFieldToolShape = 'flat'
): void {
  if (!Number.isFinite(cutRadius) || !Number.isFinite(cx) || !Number.isFinite(aDeg)) return
  const { originX, cellMm, cellDeg, cols, rows, radii, stockRadius } = field

  // Axial extent of tool in cells
  const rCellsX = Math.ceil(toolRadiusMm / cellMm) + 1
  const ic = Math.floor((cx - originX) / cellMm)

  // Angular extent: at the stock surface, tool radius subtends this angle
  const circumAtStock = stockRadius > 0.01 ? stockRadius : 1
  const angularSpanDeg = (toolRadiusMm / circumAtStock) * (180 / Math.PI)
  const rCellsA = Math.ceil(angularSpanDeg / cellDeg) + 1

  const jc = Math.floor(wrapDeg(aDeg) / cellDeg)
  const R = toolRadiusMm
  const R2 = R * R

  for (let dj = -rCellsA; dj <= rCellsA; dj++) {
    // Wrap angular index
    let j = (jc + dj) % rows
    if (j < 0) j += rows

    const cellAngleDeg = (j + 0.5) * cellDeg
    // Angular distance (shortest arc) in mm at stock OD
    const angDiffDeg = wrapDeg(cellAngleDeg - wrapDeg(aDeg) + 180) - 180
    const arcDistMm = Math.abs(angDiffDeg) * (Math.PI / 180) * circumAtStock

    for (let di = -rCellsX; di <= rCellsX; di++) {
      const i = ic + di
      if (i < 0 || i >= cols) continue

      const px = originX + (i + 0.5) * cellMm
      const axialDist = px - cx

      // Combine axial and arc distance for tool footprint check
      const dist = Math.sqrt(axialDist * axialDist + arcDistMm * arcDistMm)
      if (dist > R + 1e-6) continue

      let effectiveRadius = cutRadius
      if (toolShape === 'ball' && dist < R) {
        // Ball-end: tool surface is a hemisphere, so effective cut is shallower
        // at the edges.  The radial depth rises by R - sqrt(R^2 - dist^2).
        effectiveRadius = cutRadius + R - Math.sqrt(R2 - dist * dist)
      }

      const idx = j * cols + i
      const cur = radii[idx]!
      if (effectiveRadius < cur) {
        radii[idx] = effectiveRadius
      }
    }
  }
}

/**
 * Stamp a linear segment between two 4-axis points.
 */
function stampSegmentCylindrical(
  field: CylindricalHeightField,
  x0: number, a0: number, r0: number,
  x1: number, a1: number, r1: number,
  toolRadiusMm: number,
  toolShape: CylindricalHeightFieldToolShape = 'flat'
): void {
  const axialDist = Math.abs(x1 - x0)
  const angularDist = Math.abs(a1 - a0)
  const step = Math.max(field.cellMm * 0.35, 0.05)
  // Use axial distance and approximate arc-length for step count
  const circumAtStock = field.stockRadius > 0.01 ? field.stockRadius : 1
  const arcLen = angularDist * (Math.PI / 180) * circumAtStock
  const totalLen = Math.sqrt(axialDist * axialDist + arcLen * arcLen)
  const n = Math.max(1, Math.ceil(totalLen / step))

  for (let k = 0; k <= n; k++) {
    const t = k / n
    const x = x0 + t * (x1 - x0)
    const a = a0 + t * (a1 - a0)
    const r = r0 + t * (r1 - r0)
    stampDiskCylindrical(field, x, a, r, toolRadiusMm, toolShape)
  }
}

/**
 * Build a cylindrical heightfield from 4-axis cutting segments.
 *
 * Stamps the tool footprint along feed segments to approximate the
 * remaining stock radial profile after machining.  Used by the Tier 2
 * preview for 4-axis rotary operations.
 */
export function buildCylindricalHeightFieldFromSegments(
  segments: ReadonlyArray<ToolpathSegment4>,
  opts: BuildCylindricalHeightFieldOptions
): CylindricalHeightField | null {
  const toolRadiusMm = Math.max(0.05, opts.toolRadiusMm)
  const stockRadius = opts.cylinderDiameterMm * 0.5
  const maxCols = opts.maxCols ?? 96
  const maxRows = opts.maxRows ?? 120 // angular resolution (~3 deg/cell at 120)
  const marginMm = opts.marginMm ?? toolRadiusMm + 1
  const cuttingThreshold = opts.cuttingRadiusThreshold ?? stockRadius * 0.98

  // Filter to cutting feeds that actually remove material
  const cutting = segments.filter(
    (s) =>
      s.kind === 'feed' &&
      (Math.min(s.z0, s.z1) < cuttingThreshold)
  )
  if (cutting.length === 0) return null

  // Determine axial bounds from cutting segments
  let minX = opts.stockXMin
  let maxX = opts.stockXMax
  for (const s of cutting) {
    minX = Math.min(minX, s.x0, s.x1)
    maxX = Math.max(maxX, s.x0, s.x1)
  }
  minX -= marginMm
  maxX += marginMm

  const spanX = maxX - minX
  if (!(spanX > 1e-6)) return null

  // Compute grid dimensions
  let cellMm = Math.max(spanX / maxCols, 0.1)
  let cols = clamp(Math.ceil(spanX / cellMm), 2, maxCols)
  cellMm = spanX / cols

  // Angular: full 360 degrees
  const cellDeg = 360 / maxRows
  const rows = maxRows

  const radii = new Float32Array(cols * rows)
  radii.fill(stockRadius)

  const field: CylindricalHeightField = {
    originX: minX,
    cellMm,
    cellDeg,
    cols,
    rows,
    radii,
    stockRadius,
  }

  const toolShape: CylindricalHeightFieldToolShape = opts.toolShape ?? 'flat'

  for (const s of cutting) {
    stampSegmentCylindrical(
      field,
      s.x0, s.a0, s.z0,
      s.x1, s.a1, s.z1,
      toolRadiusMm,
      toolShape,
    )
  }

  return field
}
