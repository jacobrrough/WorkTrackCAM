/**
 * Pure snap helpers for the 2D drawing / section-view dimension placement workflow.
 *
 * All functions are DOM-free and framework-agnostic. The only DOM-touching helper is
 * `clientToSvgCoord`, which accepts an SVGSVGElement solely to call `getScreenCTM()`.
 * It remains pure in the functional sense (no side effects; same inputs → same output).
 *
 * Used by `DrawingView.tsx` to resolve cursor positions to snap points projected from
 * model vertices/edges/arc-centers by the `cad.extract_drawing_snap_points` sidecar method.
 *
 * Three-machine context: drawing snap operates on the 2D projection canvas shared by
 * Laguna Swift 5x10 (large-format sheet layouts) and Makera Carvera (rotary reliefs).
 * The K2 Plus FDM path does not use drawing views. All coordinate values are in SVG mm
 * (the same space CadQuery's `getSVG(width=800, height=600)` emits).
 *
 * Plan reference: docs/plans/v2-drawing-dimension-snap-to-vertex.md §3 + §4 (Step 1).
 */

// ---------------------------------------------------------------------------
// Snap point types
// ---------------------------------------------------------------------------

/** Geometric classification of a snap point. Lower SNAP_KIND_PRIORITY → higher priority. */
export type SnapPointKind = 'vertex' | 'endpoint' | 'midpoint' | 'center'

/** A candidate snap point in SVG coordinate space (mm, same scale as CadQuery getSVG output). */
export type SnapPoint = {
  readonly x: number
  readonly y: number
  readonly kind: SnapPointKind
  /** Optional opaque ID linking back to the source geometry (vertex index, edge id, etc.). */
  readonly sourceId?: string
}

/** The result of a successful snap resolution: the chosen SnapPoint plus the actual distance. */
export type SnapResult = SnapPoint & {
  readonly distanceSvgUnits: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Priority table for tie-breaking when two snap points are equidistant from the cursor.
 * Lower number = higher priority. vertex(0) > endpoint(1) > center(2) > midpoint(3).
 */
export const SNAP_KIND_PRIORITY: Record<SnapPointKind, number> = {
  vertex: 0,
  endpoint: 1,
  center: 2,
  midpoint: 3
}

/** Default snap search radius in SVG units (pixels at 1:1 screen mapping). */
export const DEFAULT_SNAP_TOLERANCE_PX = 12

// ---------------------------------------------------------------------------
// resolveSnap
// ---------------------------------------------------------------------------

/**
 * Find the best snap target for a cursor position in SVG space.
 *
 * Algorithm:
 *  1. If `override` is true, return null immediately (caller held the override key, e.g. Alt).
 *  2. Compute squared Euclidean distance from `cursorSvg` to every point in `snapPoints`.
 *  3. Discard any point whose distance exceeds `toleranceSvgUnits`.
 *  4. Among remaining candidates, pick the one with:
 *     a. Smallest distance (squared), then
 *     b. Lowest SNAP_KIND_PRIORITY value, then
 *     c. Lowest array index (stable sort).
 *  5. Return the winning SnapResult (with `distanceSvgUnits` = actual Euclidean distance), or null.
 *
 * `toleranceSvgUnits` is a length (not squared); the comparison is done in squared space for
 * efficiency but the returned `distanceSvgUnits` is the real distance.
 */
export function resolveSnap(
  cursorSvg: { x: number; y: number },
  snapPoints: readonly SnapPoint[],
  toleranceSvgUnits: number,
  override: boolean
): SnapResult | null {
  if (override) return null
  if (snapPoints.length === 0) return null

  const toleranceSq = toleranceSvgUnits * toleranceSvgUnits

  let bestPoint: SnapPoint | null = null
  let bestDistSq = Infinity
  let bestPriority = Infinity

  for (let i = 0; i < snapPoints.length; i++) {
    const pt = snapPoints[i]
    const dx = pt.x - cursorSvg.x
    const dy = pt.y - cursorSvg.y
    const distSq = dx * dx + dy * dy

    if (distSq > toleranceSq) continue

    const priority = SNAP_KIND_PRIORITY[pt.kind]

    // Tie-break: distance first, then kind priority, then stable array index (first wins).
    if (
      bestPoint === null ||
      distSq < bestDistSq ||
      (distSq === bestDistSq && priority < bestPriority)
    ) {
      bestPoint = pt
      bestDistSq = distSq
      bestPriority = priority
    }
  }

  if (bestPoint === null) return null

  return {
    ...bestPoint,
    distanceSvgUnits: Math.sqrt(bestDistSq)
  }
}

// ---------------------------------------------------------------------------
// clientToSvgCoord
// ---------------------------------------------------------------------------

/**
 * Map a pointer event's viewport coordinates to SVG user-space coordinates.
 *
 * Uses `svgEl.getScreenCTM().inverse()` (the standard DOM approach) to handle any CSS
 * transforms, zoom, or DPR scaling applied to the SVG element or its ancestors.
 *
 * Null-guard behaviour (documented):
 *  - If `getScreenCTM()` returns null (element not rendered / detached from document),
 *    the function falls back to returning `{ x: clientX, y: clientY }`. This is a safe
 *    no-op: callers should not rely on the returned coordinate being in SVG space when
 *    the element is off-screen, but it avoids a thrown exception.
 *  - If `matrix.inverse()` is not available (very old environments), the function
 *    manually applies the inverse of the affine [a, b, c, d, e, f] matrix using the
 *    standard 2D formula.
 *
 * DOMPoint availability:
 *  - When `DOMPoint` is available (all modern browsers), the function uses
 *    `new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())`.
 *  - Otherwise it falls back to the manual a/d/e/f affine inverse.
 */
export function clientToSvgCoord(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement
): { x: number; y: number } {
  const ctm = svgEl.getScreenCTM()

  if (ctm === null) {
    // Element not connected or not rendered — return client coords as fallback.
    return { x: clientX, y: clientY }
  }

  const inv = ctm.inverse()

  // Prefer DOMPoint.matrixTransform when available (modern browsers).
  if (typeof DOMPoint !== 'undefined') {
    const pt = new DOMPoint(clientX, clientY).matrixTransform(inv)
    return { x: pt.x, y: pt.y }
  }

  // Manual affine inverse fallback for environments without DOMPoint.
  // For a 2D matrix [[a, c, e], [b, d, f], [0, 0, 1]]:
  //   inv(x_client, y_client) = (a*x + c*y + e, b*x + d*y + f)
  // where a/b/c/d/e/f are already the inverse matrix entries.
  return {
    x: inv.a * clientX + inv.c * clientY + inv.e,
    y: inv.b * clientX + inv.d * clientY + inv.f
  }
}
