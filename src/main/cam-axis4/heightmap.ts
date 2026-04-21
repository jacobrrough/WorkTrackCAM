/**
 * 4-Axis Cylindrical Heightmap (raycasting in machine frame)
 *
 * For each (axial X, angular A) grid cell, casts a ray from outside the stock
 * inward toward the rotation axis and records the radial distance to the part
 * surface (or `NO_HIT` if no triangle is in the way).
 *
 * Coordinate convention (matches `frame.ts` and the renderer's
 * `mapGcodeToThreeEndpoints`):
 *   - Triangles are in machine frame: X axial, Y/Z perpendicular
 *   - At A=0, the radial direction is +STL_Z (matches the renderer's
 *     `viewerY = axisY + r*cos(0)`). At A=90°, it is +STL_Y.
 *
 * Three explicit cell states:
 *   - `NO_HIT`         — no triangle was hit at this (X, A)
 *   - `HIT(radius)`    — surface found at the given radial distance
 *   - `HIT_CLAMPED`    — only reachable if the caller explicitly opts in;
 *                       validation rejects undercut meshes before reaching
 *                       here, so clamping should not occur in production
 */
import type { Triangle } from './frame'
import type { Vec3 } from '../stl'

const EPS = 1e-7

/** Sentinel: no triangle was hit at this (X, A) cell. */
export const NO_HIT = -1
/** Sentinel: a triangle was hit but its radius exceeds stockRadius (clamped). */
export const HIT_CLAMPED = -2

export type CylindricalHeightmap = {
  /** [ix * na + ia] → radial distance, or NO_HIT, or HIT_CLAMPED. */
  radii: Float32Array
  nx: number
  na: number
  /** Axial X at index 0 (machine frame, ≥ 0). */
  xStart: number
  /** Axial step in mm. */
  dx: number
  /** Angular step in degrees. */
  daDeg: number
}

export type BuildHeightmapOpts = {
  /** Stock outer radius (mm). Hits beyond this are clamped or rejected. */
  stockRadius: number
  /** Axial start (mm, machine frame). */
  xStart: number
  /** Axial end (mm, machine frame). */
  xEnd: number
  /** Number of axial samples (X cells). */
  nx: number
  /** Number of angular samples (A cells). */
  na: number
  /**
   * What to do if a triangle is found at radius > stockRadius:
   *   - 'reject' (default): set cell to HIT_CLAMPED. Rare in practice because
   *     `validateAxis4Job` should fail before reaching here.
   *   - 'clamp': set cell to stockRadius. Old engine behavior — kept for
   *     migration only; do not use in new code.
   */
  outOfStockHitMode?: 'reject' | 'clamp'
}

// ─── Möller–Trumbore ray–triangle intersection ──────────────────────────────

function rayIntersectTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  v0: Vec3,
  v1: Vec3,
  v2: Vec3
): number | null {
  const [x0, y0, z0] = v0
  const [x1, y1, z1] = v1
  const [x2, y2, z2] = v2
  const e1x = x1 - x0
  const e1y = y1 - y0
  const e1z = z1 - z0
  const e2x = x2 - x0
  const e2y = y2 - y0
  const e2z = z2 - z0
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < EPS) return null
  const invDet = 1 / det
  const tx = ox - x0
  const ty = oy - y0
  const tz = oz - z0
  const u = (tx * px + ty * py + tz * pz) * invDet
  if (u < -EPS || u > 1 + EPS) return null
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * invDet
  if (v < -EPS || u + v > 1 + EPS) return null
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet
  return t > EPS ? t : null
}

// ─── Spatial acceleration: bin triangles by axial X bucket ──────────────────

type XBuckets = {
  buckets: Triangle[][]
  xMin: number
  bucketWidth: number
  count: number
}

function buildXBuckets(
  triangles: Triangle[],
  xMin: number,
  xMax: number,
  numBuckets: number
): XBuckets {
  const span = Math.max(1e-6, xMax - xMin)
  const w = span / numBuckets
  const buckets: Triangle[][] = Array.from({ length: numBuckets }, () => [])
  for (const tri of triangles) {
    const txMin = Math.min(tri[0]![0], tri[1]![0], tri[2]![0])
    const txMax = Math.max(tri[0]![0], tri[1]![0], tri[2]![0])
    const i0 = Math.max(0, Math.min(numBuckets - 1, Math.floor((txMin - xMin) / w)))
    const i1 = Math.max(0, Math.min(numBuckets - 1, Math.floor((txMax - xMin) / w)))
    for (let i = i0; i <= i1; i++) buckets[i]!.push(tri)
  }
  return { buckets, xMin, bucketWidth: w, count: numBuckets }
}

function queryBucket(xb: XBuckets, x: number): Triangle[] {
  const i = Math.max(0, Math.min(xb.count - 1, Math.floor((x - xb.xMin) / xb.bucketWidth)))
  return xb.buckets[i]!
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a cylindrical heightmap by ray-casting each (X, A) cell.
 *
 * The angle convention here is the same as the renderer's:
 *   A = 0   → ray comes from +STL_Z (corresponds to viewer "up")
 *   A = 90° → ray comes from +STL_Y (corresponds to viewer "depth")
 * This is the FIX for the 90°-rotation bug in the old engine.
 */
export function buildCylindricalHeightmap(
  triangles: Triangle[],
  opts: BuildHeightmapOpts
): CylindricalHeightmap {
  const { stockRadius, xStart, xEnd, nx, na } = opts
  const outMode = opts.outOfStockHitMode ?? 'reject'

  const radii = new Float32Array(nx * na).fill(NO_HIT)
  const spanX = xEnd - xStart
  const dx = spanX / Math.max(1, nx - 1)
  const daDeg = 360 / na
  const castR = stockRadius + 30 // start ray well outside stock

  if (triangles.length === 0) {
    return { radii, nx, na, xStart, dx, daDeg }
  }

  // Spatial acceleration: scale bucket count with mesh length so short meshes
  // still get adequate spatial binning. Cap at min(nx, 4000).
  const meshLengthMm = Math.max(1, xEnd - xStart)
  const numBuckets = Math.max(
    Math.ceil(nx / 2),
    Math.min(nx, Math.ceil(meshLengthMm * 2), 4000)
  )
  const xb = buildXBuckets(triangles, xStart - dx, xEnd + dx, numBuckets)

  // Precompute the ray direction for each angular cell. `uy`/`uz` depend only
  // on `ia`, so hoist them out of the `ix` loop (saves nx × na trig calls).
  // CRITICAL: angle convention matches the renderer
  //   A=0   → (uy=0, uz=1) → ray comes from +STL_Z
  //   A=90° → (uy=1, uz=0) → ray comes from +STL_Y
  const uyTable = new Float32Array(na)
  const uzTable = new Float32Array(na)
  for (let ia = 0; ia < na; ia++) {
    const aRad = (ia * daDeg * Math.PI) / 180
    uyTable[ia] = Math.sin(aRad)
    uzTable[ia] = Math.cos(aRad)
  }

  for (let ix = 0; ix < nx; ix++) {
    const x = xStart + ix * dx
    const localTris = queryBucket(xb, x)
    if (localTris.length === 0) continue

    for (let ia = 0; ia < na; ia++) {
      const uy = uyTable[ia]!
      const uz = uzTable[ia]!
      const oy = uy * castR
      const oz = uz * castR
      const dy = -uy
      const dz = -uz

      let bestT: number | null = null
      for (const [v0, v1, v2] of localTris) {
        const t = rayIntersectTriangle(x, oy, oz, 0, dy, dz, v0, v1, v2)
        if (t != null && (bestT == null || t < bestT)) bestT = t
      }
      if (bestT == null) continue

      // Compute radial distance of hit point from the X-axis.
      const hy = oy + bestT * dy
      const hz = oz + bestT * dz
      const rHit = Math.hypot(hy, hz)

      // Ignore hits at the axis center (degenerate).
      if (rHit < 0.01) continue

      if (rHit > stockRadius + 0.01) {
        // Out-of-stock hit: validation should normally have rejected this job.
        radii[ix * na + ia] = outMode === 'clamp' ? stockRadius : HIT_CLAMPED
      } else {
        radii[ix * na + ia] = rHit
      }
    }
  }

  return { radii, nx, na, xStart, dx, daDeg }
}

/** Read a heightmap cell (returns NO_HIT for out-of-bounds indices). */
export function hmGet(hm: CylindricalHeightmap, ix: number, ia: number): number {
  if (ix < 0 || ix >= hm.nx || ia < 0 || ia >= hm.na) return NO_HIT
  return hm.radii[ix * hm.na + ia]!
}

/** Count cells that contain a real (non-sentinel) hit. */
export function countHits(hm: CylindricalHeightmap): {
  hitCount: number
  clampedCount: number
  meshRadialMin: number
} {
  let hitCount = 0
  let clampedCount = 0
  let meshRadialMin = Infinity
  for (let i = 0; i < hm.radii.length; i++) {
    const v = hm.radii[i]!
    if (v === NO_HIT) continue
    if (v === HIT_CLAMPED) {
      clampedCount++
      continue
    }
    hitCount++
    if (v < meshRadialMin) meshRadialMin = v
  }
  if (meshRadialMin === Infinity) meshRadialMin = 0
  return { hitCount, clampedCount, meshRadialMin }
}
