/**
 * Pure dimension-label geometry for the 2D sketch canvas (Sketch S4).
 *
 * The dimension TOOL places dimensions and the SELECT tool's inline value-edit
 * needs to answer "did the operator click a dimension's value label?". Both the
 * canvas renderer (`sketch2d-draw.ts`) and the select hit-test must agree on
 * exactly WHERE a dimension's value label sits, or the edit box would open at a
 * spot the label is not drawn. To keep render == pick, the per-kind label
 * ANCHOR (the world-space mm point the value text is drawn relative to) is
 * computed here ONCE and consumed by both:
 *   - `sketch2d-draw.ts` reads {@link dimensionLabelAnchorWorld} so the text is
 *     drawn at the same anchor this module reports;
 *   - the canvas select hit-test calls {@link hitTestDimensionLabel} to resolve
 *     a clicked label to a dimension id.
 *
 * Framework-free + DOM-free (node-SSR testable, the repo convention): callers
 * feed world-space mm + a tolerance; this answers with anchors / ids. The
 * value-TEXT formatting (driven vs measured, units) stays in the draw module —
 * this module only owns the geometry of WHERE the text sits.
 *
 * IMPORTANT: a dimension whose endpoints/entity no longer resolve (a deleted
 * point or entity) has NO anchor (`null`); it renders nothing and is unpickable,
 * matching the draw module's `continue` guards.
 */

import type { DesignFileV2, SketchDimension } from '../../shared/design-schema'
import {
  circleThroughThreePoints,
  sampleArcThroughThreePoints
} from '../../shared/sketch-profile'

/**
 * The value currently SHOWN for a dimension (and pre-filled into the inline
 * edit box): the solver-driven `parameters[parameterKey]` when the dimension
 * drives, else the live measured value. `null` when neither resolves (the
 * dimension's geometry is degenerate/missing). Mirrors the draw module's
 * driven-vs-measured precedence so the edit box opens on exactly the number the
 * operator sees.
 */
export function dimensionCurrentValue(
  dm: SketchDimension,
  design: DesignFileV2
): number | null {
  const pk = dm.parameterKey
  if (pk && design.parameters[pk] !== undefined && Number.isFinite(design.parameters[pk])) {
    return design.parameters[pk]!
  }
  return measuredDimensionValue(dm, design)
}

/**
 * The live measured value of an EXISTING dimension (mm for length kinds,
 * degrees for angular), matching `sketch2d-draw.ts` + `solver2d.ts`. `null`
 * when the geometry no longer resolves. Used to pre-fill the inline editor for
 * an annotation-only dimension (no parameterKey) and as the fallback for a
 * driving dimension whose param is somehow unset.
 */
export function measuredDimensionValue(
  dm: SketchDimension,
  design: DesignFileV2
): number | null {
  const { points, entities } = design
  if (dm.kind === 'linear' || dm.kind === 'aligned') {
    const pa = points[dm.aId]
    const pb = points[dm.bId]
    if (!pa || !pb) return null
    return Math.hypot(pb.x - pa.x, pb.y - pa.y)
  }
  if (dm.kind === 'angular') {
    const p1 = points[dm.a1Id]
    const p2 = points[dm.b1Id]
    const p3 = points[dm.a2Id]
    const p4 = points[dm.b2Id]
    if (!p1 || !p2 || !p3 || !p4) return null
    const v1x = p2.x - p1.x
    const v1y = p2.y - p1.y
    const v2x = p4.x - p3.x
    const v2y = p4.y - p3.y
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    if (l1 < 1e-9 || l2 < 1e-9) return null
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
    return (Math.acos(cos) * 180) / Math.PI
  }
  // radial | diameter
  const ent = entities.find((e) => e.id === dm.entityId)
  if (!ent) return null
  let r: number | null = null
  if (ent.kind === 'circle') r = ent.r
  else if (ent.kind === 'ellipse') r = (ent.rx + ent.ry) / 2
  else if (ent.kind === 'arc') {
    const p0 = points[ent.startId]
    const p1 = points[ent.viaId]
    const p2 = points[ent.endId]
    if (!p0 || !p1 || !p2) return null
    const arcPts = sampleArcThroughThreePoints(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, 10)
    if (!arcPts || arcPts.length < 2) return null
    const a = arcPts[0]!
    const b = arcPts[Math.floor(arcPts.length / 2)]!
    const c3 = arcPts[arcPts.length - 1]!
    const cc = circleThroughThreePoints(a[0], a[1], b[0], b[1], c3[0], c3[1])
    if (!cc) return null
    r = cc.r
  }
  if (r == null) return null
  return dm.kind === 'diameter' ? r * 2 : r
}

/**
 * The id of the existing sketch point nearest `xy` within `toleranceMm`, or
 * `null`. The dimension tool uses this so a point pick that lands on a real
 * vertex (a polyline/arc/spline node) reuses that vertex's id — making the
 * resulting aligned/linear dimension a TRUE driver of that geometry. A miss
 * falls back to a fresh free point (see the canvas's gesture).
 */
export function nearestPointIdWithin(
  design: DesignFileV2,
  xy: readonly [number, number],
  toleranceMm: number
): string | null {
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return null
  const tol2 = toleranceMm * toleranceMm
  let bestId: string | null = null
  let bestD2 = Number.POSITIVE_INFINITY
  for (const [id, p] of Object.entries(design.points)) {
    const dx = p.x - xy[0]
    const dy = p.y - xy[1]
    const d2 = dx * dx + dy * dy
    if (d2 <= tol2 && d2 < bestD2) {
      bestD2 = d2
      bestId = id
    }
  }
  return bestId
}

/**
 * The world-space mm anchor of a dimension's value label, i.e. the point the
 * draw module's `fillText` is positioned relative to (before its small +4,+4 px
 * nudge). `null` when the dimension's geometry no longer resolves.
 *
 * Mirrors the anchor math in `sketch2d-draw.ts` exactly:
 *   - linear / aligned: the dimension-line midpoint, offset along the segment
 *     normal by the SAME 5 mm the extension lines use;
 *   - radial / diameter: the rim point on the circle's +X side (center + r on
 *     X) — the same spot the value text sits beside, stable in world mm so the
 *     edit box opens on the label, not the geometry;
 *   - angular: the 4-point centroid.
 */
export function dimensionLabelAnchorWorld(
  dm: SketchDimension,
  design: DesignFileV2
): [number, number] | null {
  const { points, entities } = design
  if (dm.kind === 'linear' || dm.kind === 'aligned') {
    const pa = points[dm.aId]
    const pb = points[dm.bId]
    if (!pa || !pb) return null
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return null
    // The draw module offsets the dimension line by `(nx, ny) * scale` where
    // (nx, ny) is the unit normal * 5; in WORLD mm that offset is exactly the
    // unit normal * 5 (the `* scale` is the world->screen conversion). So the
    // world anchor is the segment midpoint + unit-normal * 5 mm.
    const nx = (-dy / len) * 5
    const ny = (dx / len) * 5
    return [(pa.x + pb.x) / 2 + nx, (pa.y + pb.y) / 2 + ny]
  }
  if (dm.kind === 'angular') {
    const p1 = points[dm.a1Id]
    const p2 = points[dm.b1Id]
    const p3 = points[dm.a2Id]
    const p4 = points[dm.b2Id]
    if (!p1 || !p2 || !p3 || !p4) return null
    const v1x = p2.x - p1.x
    const v1y = p2.y - p1.y
    const v2x = p4.x - p3.x
    const v2y = p4.y - p3.y
    if (Math.hypot(v1x, v1y) < 1e-9 || Math.hypot(v2x, v2y) < 1e-9) return null
    return [(p1.x + p2.x + p3.x + p4.x) * 0.25, (p1.y + p2.y + p3.y + p4.y) * 0.25]
  }
  // radial | diameter — anchor at the rim point on +X (center + r on X), the
  // spot the value text sits beside (see the draw module's
  // `csx + rMm * scale + 6`). The center + radius resolution mirrors the draw
  // module's `cxMm`/`cyMm`/`rMm` exactly.
  const ent = entities.find((e) => e.id === dm.entityId)
  if (!ent) return null
  if (ent.kind === 'circle') {
    return [ent.cx + ent.r, ent.cy]
  }
  if (ent.kind === 'ellipse') {
    return [ent.cx + (ent.rx + ent.ry) / 2, ent.cy]
  }
  if (ent.kind === 'arc') {
    const p0 = points[ent.startId]
    const p1 = points[ent.viaId]
    const p2 = points[ent.endId]
    if (!p0 || !p1 || !p2) return null
    const arcPts = sampleArcThroughThreePoints(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, 10)
    if (!arcPts || arcPts.length < 2) return null
    const a = arcPts[0]!
    const b = arcPts[Math.floor(arcPts.length / 2)]!
    const c3 = arcPts[arcPts.length - 1]!
    const cc = circleThroughThreePoints(a[0], a[1], b[0], b[1], c3[0], c3[1])
    if (!cc) return null
    return [cc.ox + cc.r, cc.oy]
  }
  return null
}

/**
 * The radius (mm) of the round pick aperture around a dimension label anchor.
 * The label text spans roughly a chip-width in screen px; a generous fixed
 * px aperture (converted to mm at the current zoom) makes the value easy to
 * click without overlapping neighbouring geometry picks.
 */
export const DIMENSION_LABEL_PICK_PX = 16

/** Convert the label px aperture to world mm at the current zoom (px-per-mm). */
export function dimensionLabelPickToleranceMm(scalePxPerMm: number): number {
  return DIMENSION_LABEL_PICK_PX / Math.max(scalePxPerMm, 0.05)
}

/**
 * Sketch S5 — the ordered (a, b) point-id pair of a clicked sketch EDGE, for
 * the angular dimension tool (which dimensions the angle between two lines).
 *
 * `pickNearestSketchEdge` resolves a click to `{ entityId, edgeIndex }`; this
 * maps that edge to the two point ids whose direction the `angle` constraint
 * reads:
 *   - polyline: edge `i` is (pointIds[i] -> pointIds[i+1]); the closing edge of
 *     a closed polyline wraps to pointIds[0].
 *   - arc: the chord (startId -> endId) — an arc's "line" direction for an angle
 *     dimension is its chord, the same endpoints the tangent constraint anchors.
 *
 * Returns `null` for entities with no exposed vertex ids (rect / circle / slot /
 * ellipse / spline) or when the resolved ids are missing from the point map, so
 * the angular tool only forms an angle against geometry it can actually drive.
 */
export function angularLinePointIds(
  design: DesignFileV2,
  entityId: string,
  edgeIndex: number
): { aId: string; bId: string } | null {
  const ent = design.entities.find((e) => e.id === entityId)
  if (!ent) return null
  if (ent.kind === 'polyline') {
    if (!('pointIds' in ent) || ent.pointIds.length < 2) return null
    const ids = ent.pointIds
    const n = ids.length
    const segCount = ent.closed ? n : n - 1
    if (edgeIndex < 0 || edgeIndex >= segCount) return null
    const aId = ids[edgeIndex]!
    const bId = ids[(edgeIndex + 1) % n]!
    if (!design.points[aId] || !design.points[bId] || aId === bId) return null
    return { aId, bId }
  }
  if (ent.kind === 'arc') {
    if (!design.points[ent.startId] || !design.points[ent.endId]) return null
    if (ent.startId === ent.endId) return null
    return { aId: ent.startId, bId: ent.endId }
  }
  return null
}

export interface DimensionLabelHit {
  /** The id of the dimension whose value label was clicked. */
  dimId: string
  /** Its world-space label anchor (so the caller can place the edit box). */
  anchorWorld: [number, number]
}

/**
 * Nearest dimension whose value-label anchor lies within `toleranceMm` of
 * `worldPoint`, or `null`. Ties resolve to the topmost dimension (last in the
 * `dimensions` array — draw order, the standard CAD z-pick rule, matching the
 * entity hit-test).
 */
export function hitTestDimensionLabel(
  design: DesignFileV2,
  worldPoint: readonly [number, number],
  toleranceMm: number
): DimensionLabelHit | null {
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return null
  const [wx, wy] = worldPoint
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null
  const tol2 = toleranceMm * toleranceMm
  const dims = design.dimensions ?? []
  let best: DimensionLabelHit | null = null
  let bestD2 = Number.POSITIVE_INFINITY
  for (const dm of dims) {
    const anchor = dimensionLabelAnchorWorld(dm, design)
    if (!anchor) continue
    const dx = wx - anchor[0]
    const dy = wy - anchor[1]
    const d2 = dx * dx + dy * dy
    if (d2 > tol2) continue
    // `<=` so an exact tie prefers the LATER (topmost) dimension.
    if (d2 <= bestD2) {
      bestD2 = d2
      best = { dimId: dm.id, anchorWorld: anchor }
    }
  }
  return best
}
