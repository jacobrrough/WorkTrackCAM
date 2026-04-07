/**
 * Arc fitting for G-code toolpath optimization.
 *
 * Converts sequences of linear G1 moves into G2/G3 circular arcs where the
 * points lie within a specified tolerance of a fitted circle. This reduces
 * G-code file size and improves surface finish on CNC controllers that
 * support look-ahead on arcs.
 *
 * Algorithm: sliding window. For each starting index, extend a window of
 * consecutive points and attempt to fit a circle. If all points are within
 * tolerance of the fitted circle, the window is extended. When the fit
 * breaks, the largest valid window is emitted as a G2/G3 arc (or G1 if
 * fewer than 3 points could be grouped).
 *
 * Supports XY-plane arcs (G17, default), XZ-plane arcs (G18), and YZ-plane
 * arcs (G19). The plane is selected based on which pair of axes has the
 * largest variation in the candidate window.
 */

/** A 3D point in machine coordinates (mm). */
export type Point3D = {
  x: number
  y: number
  z: number
}

/** A single segment in the fitted G-code output. */
export type GCodeSegment =
  | { type: 'G1'; x: number; y: number; z: number }
  | { type: 'G2' | 'G3'; x: number; y: number; z: number; i: number; j: number; k: number; plane: 'G17' | 'G18' | 'G19' }

/** Arc plane selection. */
type ArcPlane = 'G17' | 'G18' | 'G19'

/**
 * Fit a circle through three 2D points using the circumscribed circle formula.
 * Returns null if the points are collinear (or nearly so).
 */
function fitCircle2D(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): { cx: number; cy: number; r: number } | null {
  const dA = ax * ax + ay * ay
  const dB = bx * bx + by * by
  const dC = cx * cx + cy * cy

  const denom = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(denom) < 1e-12) return null

  const ux = (dA * (by - cy) + dB * (cy - ay) + dC * (ay - by)) / denom
  const uy = (dA * (cx - bx) + dB * (ax - cx) + dC * (bx - ax)) / denom
  const r = Math.hypot(ax - ux, ay - uy)

  // Reject degenerate circles
  if (!Number.isFinite(r) || r < 1e-6) return null

  return { cx: ux, cy: uy, r }
}

/**
 * Extract the two planar coordinates from a 3D point for a given arc plane.
 *   G17 (XY): u=x, v=y, w=z
 *   G18 (XZ): u=x, v=z, w=y  (note: ISO G18 uses ZX plane, so u=Z, v=X — but
 *     in practice most CAM systems and controllers treat G18 as XZ with I/K offsets)
 *   G19 (YZ): u=y, v=z, w=x
 */
function planarCoords(p: Point3D, plane: ArcPlane): { u: number; v: number; w: number } {
  switch (plane) {
    case 'G17': return { u: p.x, v: p.y, w: p.z }
    case 'G18': return { u: p.x, v: p.z, w: p.y }
    case 'G19': return { u: p.y, v: p.z, w: p.x }
  }
}

/**
 * Determine the best arc plane for a set of points by checking which pair
 * of axes has the most variation (span).
 */
function bestArcPlane(points: Point3D[]): ArcPlane {
  if (points.length < 2) return 'G17'

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity

  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }

  const spanX = maxX - minX
  const spanY = maxY - minY
  const spanZ = maxZ - minZ

  // The plane with the two largest spans contains the arc.
  // Equivalently, the axis with the smallest span is the "normal" axis.
  if (spanZ <= spanX && spanZ <= spanY) return 'G17' // XY plane, Z is flat
  if (spanY <= spanX && spanY <= spanZ) return 'G18' // XZ plane, Y is flat
  return 'G19' // YZ plane, X is flat
}

/**
 * Check whether all points in the window lie within `tolerance` of the circle
 * defined by center (cx, cy) and radius r in the given plane.
 * Also verifies the out-of-plane (w) coordinates are approximately linear.
 */
function allPointsOnCircle(
  points: Point3D[],
  startIdx: number,
  endIdx: number,
  circleCx: number,
  circleCy: number,
  circleR: number,
  plane: ArcPlane,
  tolerance: number
): boolean {
  const first = planarCoords(points[startIdx]!, plane)
  const last = planarCoords(points[endIdx]!, plane)
  const wSpan = last.w - first.w
  const count = endIdx - startIdx

  for (let i = startIdx; i <= endIdx; i++) {
    const { u, v, w } = planarCoords(points[i]!, plane)
    const dist = Math.abs(Math.hypot(u - circleCx, v - circleCy) - circleR)
    if (dist > tolerance) return false

    // Check out-of-plane linearity (helical arcs are supported with linear Z interpolation)
    if (count > 0) {
      const t = (i - startIdx) / count
      const expectedW = first.w + wSpan * t
      if (Math.abs(w - expectedW) > tolerance) return false
    }
  }
  return true
}

/**
 * Determine arc direction (CW vs CCW) for a sequence of points on a circle.
 * Uses the cross product of consecutive chords to determine winding direction.
 * Returns 'G2' for clockwise (negative cross product in standard math coords)
 * and 'G3' for counter-clockwise.
 *
 * Note: In CNC G-code convention with G17 (XY plane), looking down the Z axis:
 *   G2 = clockwise = negative cross product
 *   G3 = counter-clockwise = positive cross product
 */
function arcDirection(
  points: Point3D[],
  startIdx: number,
  endIdx: number,
  plane: ArcPlane
): 'G2' | 'G3' {
  // Use three points: start, middle, end to determine winding
  const midIdx = Math.floor((startIdx + endIdx) / 2)
  const a = planarCoords(points[startIdx]!, plane)
  const b = planarCoords(points[midIdx]!, plane)
  const c = planarCoords(points[endIdx]!, plane)

  // Cross product of (B-A) x (C-B) in 2D
  const cross = (b.u - a.u) * (c.v - b.v) - (b.v - a.v) * (c.u - b.u)

  // Positive cross product = CCW = G3, Negative = CW = G2
  return cross >= 0 ? 'G3' : 'G2'
}

/**
 * Build the IJK center offset for a G2/G3 command.
 * IJK are incremental offsets from the arc start point to the center.
 *   G17: I (X offset), J (Y offset), K=0
 *   G18: I (X offset), J=0, K (Z offset)
 *   G19: I=0, J (Y offset), K (Z offset)
 */
function buildIJK(
  startPoint: Point3D,
  centerU: number,
  centerV: number,
  plane: ArcPlane
): { i: number; j: number; k: number } {
  const s = planarCoords(startPoint, plane)
  const du = centerU - s.u
  const dv = centerV - s.v

  switch (plane) {
    case 'G17': return { i: du, j: dv, k: 0 }
    case 'G18': return { i: du, j: 0, k: dv }
    case 'G19': return { i: 0, j: du, k: dv }
  }
}

/**
 * Fit arcs to a sequence of linear toolpath points.
 *
 * Takes an array of 3D points (vertices of a polyline produced by linear
 * interpolation) and returns a mixed array of G1 (linear) and G2/G3 (arc)
 * segments. Where consecutive points lie on a circular arc within the
 * specified tolerance, they are replaced by a single G2 or G3 command.
 *
 * @param points    Ordered array of toolpath vertices (at least 2 for any output).
 * @param tolerance Maximum deviation (mm) from the fitted circle for a point
 *                  to be included in an arc. Typical values: 0.001–0.01 mm.
 * @returns Array of GCodeSegment objects representing the fitted toolpath.
 */
export function fitArcsToLinearPath(points: Point3D[], tolerance: number): GCodeSegment[] {
  if (points.length < 2) return []
  if (tolerance <= 0) {
    // Zero or negative tolerance: no arc fitting possible, emit all G1
    return emitAllLinear(points)
  }

  const segments: GCodeSegment[] = []
  let i = 0

  while (i < points.length - 1) {
    // Try to extend an arc window starting at point i
    let bestArcEnd = -1
    let bestCircleCx = 0
    let bestCircleCy = 0
    let bestPlane: ArcPlane = 'G17'

    // Need at least 3 points for an arc
    if (i + 2 < points.length) {
      // Determine the best plane for this local region
      const lookahead = Math.min(i + 20, points.length)
      const plane = bestArcPlane(points.slice(i, lookahead))

      // Use first, last, and middle points of growing window to fit circle
      for (let j = i + 2; j < points.length; j++) {
        // Fit circle through start, midpoint, and candidate endpoint
        const midIdx = Math.floor((i + j) / 2)
        const a = planarCoords(points[i]!, plane)
        const b = planarCoords(points[midIdx]!, plane)
        const c = planarCoords(points[j]!, plane)

        const circle = fitCircle2D(a.u, a.v, b.u, b.v, c.u, c.v)
        if (!circle) break // collinear — can't form arc

        // Reject arcs with very large radii (essentially straight lines)
        // A circle with radius > 1000x the chord length is nearly linear
        const chordLen = Math.hypot(c.u - a.u, c.v - a.v)
        if (chordLen > 0 && circle.r > 1000 * chordLen) break

        // Check all points in window
        if (allPointsOnCircle(points, i, j, circle.cx, circle.cy, circle.r, plane, tolerance)) {
          bestArcEnd = j
          bestCircleCx = circle.cx
          bestCircleCy = circle.cy
          bestPlane = plane
        } else {
          break // Once a point fails, no need to extend further
        }
      }
    }

    if (bestArcEnd >= i + 2) {
      // Emit arc segment
      const endPt = points[bestArcEnd]!
      const dir = arcDirection(points, i, bestArcEnd, bestPlane)
      const ijk = buildIJK(points[i]!, bestCircleCx, bestCircleCy, bestPlane)

      segments.push({
        type: dir,
        x: endPt.x,
        y: endPt.y,
        z: endPt.z,
        i: ijk.i,
        j: ijk.j,
        k: ijk.k,
        plane: bestPlane
      })
      i = bestArcEnd
    } else {
      // Emit G1 to next point
      const next = points[i + 1]!
      segments.push({
        type: 'G1',
        x: next.x,
        y: next.y,
        z: next.z
      })
      i++
    }
  }

  return segments
}

/** Emit all points as G1 segments (fallback when no arc fitting is possible). */
function emitAllLinear(points: Point3D[]): GCodeSegment[] {
  const segments: GCodeSegment[] = []
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    segments.push({ type: 'G1', x: p.x, y: p.y, z: p.z })
  }
  return segments
}

/**
 * Generate points on a circle for testing purposes.
 * Returns `n` evenly-spaced points on a circle of radius `r` centered at (cx, cy)
 * in the XY plane at constant Z.
 *
 * @param cx  Center X
 * @param cy  Center Y
 * @param z   Constant Z height
 * @param r   Circle radius
 * @param n   Number of points
 * @param startAngle  Starting angle in radians (default 0)
 * @param sweepAngle  Sweep angle in radians (default 2*PI for full circle)
 * @param ccw  Counter-clockwise direction (default true)
 */
export function generateCirclePoints(
  cx: number, cy: number, z: number,
  r: number, n: number,
  startAngle = 0,
  sweepAngle = 2 * Math.PI,
  ccw = true
): Point3D[] {
  const points: Point3D[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const angle = ccw
      ? startAngle + sweepAngle * t
      : startAngle - sweepAngle * t
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      z
    })
  }
  return points
}
