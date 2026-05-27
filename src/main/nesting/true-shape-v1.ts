/**
 * True-shape nesting (v1) — Bottom-Left-Fill (BLF) with axis-aligned
 * bounding-box overlap tests on a snap grid.
 *
 * Gap #9 from docs/COMPETITIVE-GAP-ANALYSIS.md: Laguna Swift 5x10 sheet jobs
 * need VCarve-Pro-style true-shape nesting so the operator can stop hand-laying
 * cabinet / sign cuts on full sheets of plywood, MDF, or aluminum.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v1 algorithm (this file): per-part bottom-left search on a 2 mm snap grid
 * with bounding-box overlap as the legality test. For each candidate position
 * the part is rotated through `allowedRotations` (default 0° and 90°), the
 * (axis-aligned) bounding box is translated, and a strict bounding-box overlap
 * check eliminates overlap with already-placed parts and clipping against the
 * sheet envelope. The first legal (x, y, rot) wins.
 *
 * Why bounding-box not polygon-clip in v1: the goal here is to ship a working
 * "Nest parts on stock" UX for the Laguna workflow without taking on a polygon
 * clipping engine. Real polygon-aware NFP-with-genetic-algorithm nesting
 * (Deepnest-style) is planned for v2 — see the "v2 upgrade path" note at the
 * end of this file. v1 is safe for rectangular and near-rectangular cabinet /
 * sign panels (the dominant Laguna workload). It will over-reserve area for
 * very non-rectangular parts, leaving real material on the floor that v2 can
 * recover. v1 NEVER places parts overlapping; it errs on the side of unplaced.
 *
 * License hygiene: this module is written from scratch by the WorkTrackCAM
 * project. No external library is copied or ported. There is no Deepnest /
 * nfp-polygon / clipper-lib source in this file or its dependencies. v2 may
 * port a permissively-licensed (MIT / Apache / BSD) NFP routine; that port
 * must add the upstream attribution + license header at that time.
 *
 * Safety Rule 1 (G-code is sacred): this module produces PLACEMENTS only —
 * (xMm, yMm, rotationDeg) triples that the renderer writes onto each
 * `cnc_contour` op's `params.placement` field. The downstream CAM runner and
 * post-processor consume those placements when emitting toolpath G-code; this
 * module emits no G-code and no machine motion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A closed 2D polygon ring (CCW outer ring; no holes in v1). */
export interface Polygon {
  /** Stable identifier — typically the op id or part id. */
  id: string
  /** Vertex list in millimetres. CCW outer ring. v1 ignores winding. */
  points: ReadonlyArray<readonly [number, number]>
}

/** Sheet stock specification (Laguna typical: 1524 mm × 3048 mm). */
export interface SheetSpec {
  /** Sheet X extent in mm (e.g. 1524 for 60"). */
  widthMm: number
  /** Sheet Y extent in mm (e.g. 3048 for 120"). */
  heightMm: number
  /**
   * Outer sheet margin (mm). Parts cannot be placed within this band of any
   * sheet edge. Defaults to 0; common Laguna sheet jobs leave 10–20 mm.
   */
  marginMm?: number
}

/** Nesting options. */
export interface NestOptions {
  /**
   * Grid resolution for the BLF search in mm. Smaller = denser pack but slower.
   * Default 2 mm (router-friendly on 60×120 sheets).
   */
  snapMm?: number
  /**
   * Inter-part margin in mm (kerf-aware buffer). Default 3 mm.
   */
  partMarginMm?: number
  /**
   * Allowed rotations per part in degrees. Default [0, 90]. v1 only supports
   * the four cardinal rotations (0, 90, 180, 270). Other values are rejected.
   */
  allowedRotations?: ReadonlyArray<Rotation>
}

/** Cardinal rotation values accepted by v1. */
export type Rotation = 0 | 90 | 180 | 270

/** A placement of a single part on the sheet. */
export interface Placement {
  /** Polygon id from the input. */
  partId: string
  /** Translation in mm. Applied AFTER the rotation. */
  xMm: number
  /** Translation in mm. Applied AFTER the rotation. */
  yMm: number
  /** Rotation applied around the part's local origin (centroid of input). */
  rotationDeg: Rotation
}

/** Result of a nest run. */
export interface NestResult {
  /** Placements for parts that fit. Order matches the input scan order. */
  placements: Placement[]
  /** IDs of parts that did not fit on the sheet under any rotation. */
  unplaced: string[]
  /** Material utilization (0..100): placed-part-area / sheet-area × 100. */
  utilizationPct: number
  /** Sheet area in mm² (width × height; v1 does not subtract margin). */
  sheetUsedAreaMm2: number
  /** Total mm² of the placed parts (area inside their polygon outer rings). */
  totalPartAreaMm2: number
}

/** Internal axis-aligned bounding box. */
interface Aabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const DEFAULT_SNAP_MM = 2
const DEFAULT_PART_MARGIN_MM = 3
const DEFAULT_ROTATIONS: ReadonlyArray<Rotation> = [0, 90]

/**
 * Nest the given polygons onto the sheet using bottom-left-fill.
 *
 * Order of operations per part:
 *  1. Sort parts by descending bounding-box area (largest first — BLF heuristic).
 *  2. For each part, try each rotation in `allowedRotations`.
 *  3. For each rotation, scan a snap grid from (margin, margin) upward in Y,
 *     then X. First legal (no overlap, fits in sheet) position wins.
 *  4. If no rotation fits anywhere, the part is added to `unplaced[]`.
 */
export function nestPolygonsOnSheet(
  parts: ReadonlyArray<Polygon>,
  sheet: SheetSpec,
  opts: NestOptions = {}
): NestResult {
  if (sheet.widthMm <= 0 || sheet.heightMm <= 0) {
    throw new Error(`SheetSpec must have positive dimensions; got ${sheet.widthMm} x ${sheet.heightMm}`)
  }
  const sheetMargin = Math.max(0, sheet.marginMm ?? 0)
  const partMargin = Math.max(0, opts.partMarginMm ?? DEFAULT_PART_MARGIN_MM)
  const snap = Math.max(0.1, opts.snapMm ?? DEFAULT_SNAP_MM)
  const rotations = (opts.allowedRotations && opts.allowedRotations.length > 0
    ? opts.allowedRotations
    : DEFAULT_ROTATIONS) as ReadonlyArray<Rotation>

  // Validate rotations.
  for (const r of rotations) {
    if (r !== 0 && r !== 90 && r !== 180 && r !== 270) {
      throw new Error(`Invalid rotation ${r as number}; v1 supports only 0, 90, 180, 270`)
    }
  }

  // Pre-compute rotated bounding boxes + areas for each candidate.
  type PartCandidate = {
    id: string
    /** Polygon area (mm²) — same under any rotation. */
    area: number
    /** Map from rotation → AABB (in local coordinates, min at origin). */
    aabbByRot: Map<Rotation, Aabb>
    /** Largest bbox area across allowed rotations — used for sort key. */
    sortKey: number
  }

  const candidates: PartCandidate[] = parts.map((p) => {
    const aabbByRot = new Map<Rotation, Aabb>()
    let largestBoxArea = 0
    for (const rot of rotations) {
      const rotated = rotatePoints(p.points, rot)
      const box = aabbOf(rotated)
      // Normalize to (0,0)-origin to simplify offset math during search.
      const normalized: Aabb = {
        minX: 0,
        minY: 0,
        maxX: box.maxX - box.minX,
        maxY: box.maxY - box.minY
      }
      aabbByRot.set(rot, normalized)
      const ba = (box.maxX - box.minX) * (box.maxY - box.minY)
      if (ba > largestBoxArea) largestBoxArea = ba
    }
    return {
      id: p.id,
      area: polygonAreaAbs(p.points),
      aabbByRot,
      sortKey: largestBoxArea
    }
  })

  // BLF heuristic: largest parts first.
  candidates.sort((a, b) => b.sortKey - a.sortKey)

  const placements: Placement[] = []
  const unplaced: string[] = []
  /** Already-placed AABBs (in sheet coordinates), inflated by partMargin/2 on each side. */
  const placedBoxes: Aabb[] = []
  let totalPartAreaMm2 = 0

  const sheetMinX = sheetMargin
  const sheetMinY = sheetMargin
  const sheetMaxX = sheet.widthMm - sheetMargin
  const sheetMaxY = sheet.heightMm - sheetMargin

  for (const c of candidates) {
    let placed = false
    for (const rot of rotations) {
      const local = c.aabbByRot.get(rot)
      if (!local) continue
      const w = local.maxX
      const h = local.maxY
      if (w > sheetMaxX - sheetMinX || h > sheetMaxY - sheetMinY) {
        // This rotation doesn't fit in the sheet bounding region; try next rot.
        continue
      }
      // BLF scan: Y-major, X-minor — produces "bottom-left" packing.
      const yMax = sheetMaxY - h
      const xMax = sheetMaxX - w
      let foundX = NaN
      let foundY = NaN
      for (let y = sheetMinY; y <= yMax + 1e-6; y += snap) {
        for (let x = sheetMinX; x <= xMax + 1e-6; x += snap) {
          const candBox: Aabb = {
            minX: x,
            minY: y,
            maxX: x + w,
            maxY: y + h
          }
          if (collidesWithAny(candBox, placedBoxes, partMargin)) continue
          foundX = x
          foundY = y
          break
        }
        if (!Number.isNaN(foundX)) break
      }
      if (!Number.isNaN(foundX)) {
        placements.push({
          partId: c.id,
          xMm: round3(foundX),
          yMm: round3(foundY),
          rotationDeg: rot
        })
        placedBoxes.push({
          minX: foundX,
          minY: foundY,
          maxX: foundX + w,
          maxY: foundY + h
        })
        totalPartAreaMm2 += c.area
        placed = true
        break
      }
    }
    if (!placed) {
      unplaced.push(c.id)
    }
  }

  const sheetUsedAreaMm2 = sheet.widthMm * sheet.heightMm
  const utilizationPct = sheetUsedAreaMm2 > 0
    ? round3((totalPartAreaMm2 / sheetUsedAreaMm2) * 100)
    : 0

  return {
    placements,
    unplaced,
    utilizationPct,
    sheetUsedAreaMm2: round3(sheetUsedAreaMm2),
    totalPartAreaMm2: round3(totalPartAreaMm2)
  }
}

// ─── Internal helpers (pure geometry) ────────────────────────────────────────

/** Absolute signed-polygon area (mm²) via the shoelace formula. */
function polygonAreaAbs(points: ReadonlyArray<readonly [number, number]>): number {
  const n = points.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/** Axis-aligned bounding box for a polygon. */
function aabbOf(points: ReadonlyArray<readonly [number, number]>): Aabb {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Apply a cardinal CCW rotation to a list of points. */
function rotatePoints(
  points: ReadonlyArray<readonly [number, number]>,
  rotDeg: Rotation
): ReadonlyArray<readonly [number, number]> {
  if (rotDeg === 0) return points
  const out: Array<readonly [number, number]> = []
  for (const [x, y] of points) {
    if (rotDeg === 90) out.push([-y, x])
    else if (rotDeg === 180) out.push([-x, -y])
    else out.push([y, -x]) // 270
  }
  return out
}

/**
 * True if `box` (inflated outward by `marginMm/2`) overlaps any of `others`
 * (also inflated by `marginMm/2`). Inflating both by half achieves the
 * intended inter-part clearance of `marginMm`.
 */
function collidesWithAny(box: Aabb, others: ReadonlyArray<Aabb>, marginMm: number): boolean {
  const m = marginMm / 2
  const a: Aabb = {
    minX: box.minX - m,
    minY: box.minY - m,
    maxX: box.maxX + m,
    maxY: box.maxY + m
  }
  for (const o of others) {
    const b: Aabb = {
      minX: o.minX - m,
      minY: o.minY - m,
      maxX: o.maxX + m,
      maxY: o.maxY + m
    }
    if (a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY) {
      return true
    }
  }
  return false
}

/** Round to 3 decimal places — sub-micron tolerance for reporting. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ─────────────────────────────────────────────────────────────────────────────
// v2 upgrade path (planned)
// ─────────────────────────────────────────────────────────────────────────────
// v2 will replace the bounding-box overlap test with a true No-Fit-Polygon
// (NFP) routine and add a genetic-algorithm meta-optimizer over part ordering
// + rotations. Candidate ports (all permissively licensed):
//
//   - SVGnest / Deepnest (MIT, https://github.com/Jack000/SVGnest)
//   - jsClipper / clipper-lib (BSL — incompatible, do NOT port)
//   - polygon-clipping (MIT, https://github.com/mfogel/polygon-clipping)
//
// Whichever is chosen must:
//   - keep the public NestResult / Placement contract (this file's exports),
//   - keep "Safety Rule 1: G-code is sacred" — produce only placements,
//   - add a `nestVersion: 'v1' | 'v2'` field to NestResult so callers can
//     diff old vs new layouts during the v2 rollout.
//
// Until then, v1 ships behind a Laguna-only UI gate (see the renderer's
// "Nest parts on stock" button in ManufactureOperationList.tsx).
