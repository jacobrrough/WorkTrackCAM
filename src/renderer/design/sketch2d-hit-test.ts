/**
 * Pure 2D hit-testing for the session-wired sketch canvas's select tool.
 *
 * Sketch S1 (direct manipulation): clicking the canvas in select mode must
 * resolve "which entity did the operator mean?" -- the FEEL-wave primitive
 * that click-select, drag-move, and Delete all hang off. This module is
 * deliberately framework-free and DOM-free (node-SSR testable, the repo
 * convention): the canvas feeds it world-space mm and a tolerance; it answers
 * with an entity id.
 *
 * Outline-only, CAD convention: closed shapes (rect / circle / ellipse / slot
 * / closed polyline / closed arc / closed spline) hit on their OUTLINE, not
 * their fill -- clicking the middle of a big pocket boundary selects nothing,
 * exactly like Fusion / Mastercam sketch selection.
 *
 * Every entity kind reuses the SAME world tessellation helpers the canvas
 * renderer + kernel-profile extraction use (`sketch-profile.ts`), so what you
 * see is what you hit: `polylinePositions` (incl. legacy inline-points
 * polylines and text-derived letter outlines), `worldCornersFromRectParams`,
 * `slotCapsuleLoopWorld`, `ellipseLoopWorld` (a circle is the rx = ry
 * ellipse), `arcSamplePositions`, `splineFit/CpPolylineFromEntity`. Distances
 * run through `distSqPointSegment` over the sampled segments.
 */

import type { DesignFileV2, SketchEntity, SketchPoint } from '../../shared/design-schema'
import {
  arcSamplePositions,
  ELLIPSE_PROFILE_SEGMENTS,
  ellipseLoopWorld,
  polylinePositions,
  SLOT_PROFILE_CAP_SEGMENTS,
  slotCapsuleLoopWorld,
  splineCpPolylineFromEntity,
  splineFitPolylineFromEntity,
  worldCornersFromRectParams
} from '../../shared/sketch-profile'
import { distSqPointSegment, snap } from './sketch2d-canvas-coords'

/** Arc tessellation for hit-testing -- matches the canvas draw density (28). */
export const HIT_TEST_ARC_SEGMENTS = 28

/** Sampled world-space outline (sketch-plane mm) of one sketch entity. */
export interface EntityOutlineWorld {
  /** Ordered sample vertices along the outline. */
  pts: [number, number][]
  /** When true, the outline closes from the last vertex back to the first. */
  closed: boolean
}

/**
 * World outline samples for any sketch entity, or `null` when degenerate
 * (missing tessellation, < 2 resolvable vertices). Shared by the hit test
 * below AND the canvas's selection-highlight / drag-ghost rendering, so the
 * highlight always traces exactly the geometry the pick resolved.
 */
export function entityOutlineWorld(
  e: SketchEntity,
  points: Record<string, SketchPoint>
): EntityOutlineWorld | null {
  switch (e.kind) {
    case 'polyline': {
      const pts = polylinePositions(e, points)
      if (pts.length < 2) return null
      return { pts, closed: e.closed }
    }
    case 'rect':
      return { pts: worldCornersFromRectParams(e), closed: true }
    case 'circle':
      // No dedicated circle tessellator in sketch-profile -- a circle is the
      // rx = ry degenerate ellipse; reuse the ellipse loop at kernel density.
      return {
        pts: ellipseLoopWorld(e.cx, e.cy, e.r, e.r, 0, ELLIPSE_PROFILE_SEGMENTS),
        closed: true
      }
    case 'ellipse':
      return {
        pts: ellipseLoopWorld(e.cx, e.cy, e.rx, e.ry, e.rotation, ELLIPSE_PROFILE_SEGMENTS),
        closed: true
      }
    case 'slot': {
      const loop = slotCapsuleLoopWorld(
        e.cx,
        e.cy,
        e.length,
        e.width,
        e.rotation,
        SLOT_PROFILE_CAP_SEGMENTS
      )
      if (loop.length < 3) return null
      return { pts: loop, closed: true }
    }
    case 'arc': {
      const pts = arcSamplePositions(e, points, HIT_TEST_ARC_SEGMENTS)
      if (pts.length < 2) return null
      // A closed arc's profile is the sampled arc plus its chord as the
      // closing edge (see `closedArcProfileLoop`) -- the outline includes it.
      return { pts, closed: !!e.closed }
    }
    case 'spline_fit': {
      const loop = splineFitPolylineFromEntity(e, points)
      if (!loop || loop.length < 2) return null
      return { pts: loop, closed: !!e.closed }
    }
    case 'spline_cp': {
      const loop = splineCpPolylineFromEntity(e, points)
      if (!loop || loop.length < 2) return null
      return { pts: loop, closed: !!e.closed }
    }
    default: {
      const _exhaustive: never = e
      void _exhaustive
      return null
    }
  }
}

/** Squared distance (mm squared) from a world point to a sampled outline. */
function outlineDistSq(outline: EntityOutlineWorld, wx: number, wy: number): number {
  const pts = outline.pts
  const n = pts.length
  if (n === 0) return Number.POSITIVE_INFINITY
  if (n === 1) {
    const dx = wx - pts[0]![0]
    const dy = wy - pts[0]![1]
    return dx * dx + dy * dy
  }
  const segCount = outline.closed ? n : n - 1
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    const d2 = distSqPointSegment(wx, wy, a[0], a[1], b[0], b[1])
    if (d2 < best) best = d2
  }
  return best
}

export interface SketchHitTestInput {
  design: DesignFileV2
  /** Click location in sketch-plane mm (RAW, unsnapped -- picks are exact, like constraint picks). */
  worldPoint: readonly [number, number]
  /** Pick aperture in mm (px at current zoom divided by scale). */
  toleranceMm: number
}

/**
 * Nearest entity whose outline lies within `toleranceMm` of `worldPoint`, or
 * `null`. Ties resolve to the smallest distance; EXACT distance ties resolve
 * to the topmost entity (last in the entities array -- draw order, so the
 * entity painted on top wins, the standard CAD z-pick rule).
 */
export function hitTestSketchEntities(input: SketchHitTestInput): { entityId: string } | null {
  const { design, worldPoint, toleranceMm } = input
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return null
  const [wx, wy] = worldPoint
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null
  const tol2 = toleranceMm * toleranceMm
  let bestId: string | null = null
  let bestD2 = Number.POSITIVE_INFINITY
  for (const e of design.entities) {
    const outline = entityOutlineWorld(e, design.points)
    if (!outline) continue
    const d2 = outlineDistSq(outline, wx, wy)
    if (d2 > tol2) continue
    // `<=` so an exact tie prefers the LATER (topmost) entity.
    if (d2 <= bestD2) {
      bestD2 = d2
      bestId = e.id
    }
  }
  return bestId === null ? null : { entityId: bestId }
}

/** Select-tool pick aperture in CSS px (Fusion-like ~8 px). */
export const SELECT_PICK_PX = 8

/** Convert the px aperture to world mm at the current zoom (px-per-mm scale). */
export function selectPickToleranceMm(scalePxPerMm: number): number {
  return SELECT_PICK_PX / Math.max(scalePxPerMm, 0.05)
}

/**
 * The ONE grid-snapped translation a completed select-drag emits on release
 * (`onMoveSelected`): each axis of the TOTAL world delta snaps to the lattice
 * independently, so the ghost preview and the committed move are identical.
 */
export function snappedDragDelta(
  startWorld: readonly [number, number],
  endWorld: readonly [number, number],
  gridMm: number
): [number, number] {
  return [snap(endWorld[0] - startWorld[0], gridMm), snap(endWorld[1] - startWorld[1], gridMm)]
}

/**
 * Screen-px movement separating a click from a drag-move (kept small so the
 * canvas still feels immediate, big enough that a shaky click never moves
 * geometry).
 */
export const SELECT_DRAG_THRESHOLD_PX = 3

/** True once the pointer has travelled far enough on screen to count as a drag. */
export function dragExceedsThreshold(
  startWorld: readonly [number, number],
  currentWorld: readonly [number, number],
  scalePxPerMm: number
): boolean {
  const dx = currentWorld[0] - startWorld[0]
  const dy = currentWorld[1] - startWorld[1]
  return Math.hypot(dx, dy) * Math.max(scalePxPerMm, 0.05) > SELECT_DRAG_THRESHOLD_PX
}
