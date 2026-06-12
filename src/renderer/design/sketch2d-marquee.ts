/**
 * Pure marquee box-select resolution for the 2D sketch canvas (Sketch S3).
 *
 * AutoCAD convention, outline-only (matching the repo's click hit-test
 * semantics -- a marquee never selects by fill):
 *   - WINDOW (drag left -> right): an entity is selected only when EVERY
 *     sampled outline point lies inside the closed box.
 *   - CROSSING (drag right -> left): an entity is selected when ANY sampled
 *     outline point lies inside the box OR any sampled outline segment
 *     intersects the box (Liang-Barsky against the CLOSED box, so
 *     pass-throughs, corner touches and edge grazes all count).
 *
 * Outlines come from the SAME `entityOutlineWorld` tessellation the canvas
 * renderer + click hit-test use, so what you see is exactly what the box
 * selects. Framework-free and DOM-free (node-SSR testable, the repo
 * convention).
 */

import type { DesignFileV2 } from '../../shared/design-schema'
import { entityOutlineWorld } from './sketch2d-hit-test'

/** Marquee select mode -- decided by horizontal drag direction (AutoCAD). */
export type MarqueeMode = 'window' | 'crossing'

/** Normalized axis-aligned marquee box in sketch-plane mm. */
export interface MarqueeBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Normalized box from the press corner and the live/release corner. */
export function marqueeBoxFromCorners(
  a: readonly [number, number],
  b: readonly [number, number]
): MarqueeBox {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1])
  }
}

/**
 * AutoCAD direction rule: dragging left -> right = WINDOW (fully inside);
 * right -> left = CROSSING (any touch). A pure-vertical drag (zero horizontal
 * travel) counts as window.
 */
export function marqueeModeForDrag(
  start: readonly [number, number],
  end: readonly [number, number]
): MarqueeMode {
  return end[0] >= start[0] ? 'window' : 'crossing'
}

/** Inclusive point-in-box (a point ON the boundary counts as inside). */
function pointInBox(box: MarqueeBox, x: number, y: number): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY
}

/**
 * True when segment AB intersects the CLOSED axis-aligned box (Liang-Barsky
 * clip). Inclusive on the boundary: corner touches and collinear grazes along
 * a box edge count, as does a segment fully inside the box. A degenerate
 * (zero-length) segment degrades to the inclusive point test, and a
 * degenerate (zero-area) box degrades to segment-through-point.
 */
export function segmentIntersectsBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: MarqueeBox
): boolean {
  const dx = bx - ax
  const dy = by - ay
  const p = [-dx, dx, -dy, dy]
  const q = [ax - box.minX, box.maxX - ax, ay - box.minY, box.maxY - ay]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!
    const qi = q[i]!
    if (pi === 0) {
      // Parallel to this slab: strictly outside it means no intersection.
      if (qi < 0) return false
      continue
    }
    const r = qi / pi
    if (pi < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return true
}

export interface EntitiesInBoxInput {
  design: DesignFileV2
  /** Normalized marquee box (see {@link marqueeBoxFromCorners}). */
  box: MarqueeBox
  /** Window = fully inside; crossing = any outline touch. */
  mode: MarqueeMode
}

/**
 * Ids of the entities the marquee selects, in design (draw) order. Entities
 * with a degenerate outline (no resolvable tessellation) are never selected.
 * A zero-area box is handled gracefully: window matches nothing real and
 * crossing matches only outlines passing exactly through the point.
 */
export function entitiesInBox(input: EntitiesInBoxInput): string[] {
  const { design, box, mode } = input
  if (
    !Number.isFinite(box.minX) ||
    !Number.isFinite(box.minY) ||
    !Number.isFinite(box.maxX) ||
    !Number.isFinite(box.maxY) ||
    box.maxX < box.minX ||
    box.maxY < box.minY
  ) {
    return []
  }
  const out: string[] = []
  for (const e of design.entities) {
    const outline = entityOutlineWorld(e, design.points)
    if (!outline || outline.pts.length === 0) continue
    if (mode === 'window') {
      let allInside = true
      for (const pt of outline.pts) {
        if (!pointInBox(box, pt[0], pt[1])) {
          allInside = false
          break
        }
      }
      if (allInside) out.push(e.id)
      continue
    }
    // Crossing: any sampled point inside, else any sampled segment touching
    // the box (covers pass-throughs whose endpoints are both outside).
    let hit = false
    for (const pt of outline.pts) {
      if (pointInBox(box, pt[0], pt[1])) {
        hit = true
        break
      }
    }
    if (!hit) {
      const pts = outline.pts
      const n = pts.length
      const segCount = outline.closed ? n : n - 1
      for (let i = 0; i < segCount; i++) {
        const a = pts[i]!
        const b = pts[(i + 1) % n]!
        if (segmentIntersectsBox(a[0], a[1], b[0], b[1], box)) {
          hit = true
          break
        }
      }
    }
    if (hit) out.push(e.id)
  }
  return out
}
