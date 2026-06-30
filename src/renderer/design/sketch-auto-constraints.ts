/**
 * Auto-constraint on draw — the Fusion "as you draw, the relation becomes a real constraint" step.
 *
 * The live inference (`sketch-inference.ts`) snaps a horizontal / vertical segment to the EXACT axis
 * coordinate and glyphs it while drawing. This module turns that snapped geometry into persisted
 * `SketchConstraint`s at commit time, so the 2D solver (`solver2d.ts`, which already solves
 * horizontal / vertical) MAINTAINS the relation after a later node drag — not just at the moment of
 * the click.
 *
 * Scope today: horizontal + vertical. These are conflict-free by construction (a segment is either
 * horizontal, vertical, or neither — never both), so the returned set can never self-over-constrain,
 * which is why no solver-rank gate is needed here. Parallel / perpendicular / coincident need a
 * reference-segment id map / point merge and land in a follow-up.
 *
 * Pure + framework-agnostic (node-env testable), matching the sketcher's pure-core convention.
 */

import type { SketchConstraint } from '../../shared/design-schema'

/** A committed sketch vertex: its stable point id + its sketch-plane mm coordinate. */
export type AutoConstraintVertex = {
  readonly id: string
  readonly pt: readonly [number, number]
}

/**
 * Horizontal / vertical constraints inferred from the EXACTLY axis-aligned segments of a vertex
 * chain. Detection is an exact `=== 0` component compare (not a tolerance): the draw-time snap makes
 * an inferred-axis segment exactly Δy = 0 (horizontal) or Δx = 0 (vertical), while a segment the user
 * drew off-axis keeps a non-zero delta and stays free.
 *
 * - `closed` wraps the last vertex back to the first (the extra closing segment).
 * - `takenConstraintIds` seeds the `con_<n>` allocator so new ids never collide with existing ones.
 * - Zero-length segments yield nothing; each real segment yields at most one constraint.
 */
export function inferredAxisConstraints(
  vertices: ReadonlyArray<AutoConstraintVertex>,
  closed: boolean,
  takenConstraintIds: ReadonlySet<string>
): SketchConstraint[] {
  if (vertices.length < 2) return []

  const taken = new Set(takenConstraintIds)
  const nextId = (): string => {
    let n = 1
    while (taken.has(`con_${n}`)) n += 1
    const id = `con_${n}`
    taken.add(id)
    return id
  }

  const out: SketchConstraint[] = []
  const segCount = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < segCount; i++) {
    const a = vertices[i]!
    const b = vertices[(i + 1) % vertices.length]!
    const dx = b.pt[0] - a.pt[0]
    const dy = b.pt[1] - a.pt[1]
    if (dx === 0 && dy === 0) continue // zero-length: nothing to constrain
    if (dy === 0) {
      out.push({ id: nextId(), type: 'horizontal', a: { pointId: a.id }, b: { pointId: b.id } })
    } else if (dx === 0) {
      out.push({ id: nextId(), type: 'vertical', a: { pointId: a.id }, b: { pointId: b.id } })
    }
  }
  return out
}

/**
 * Coincident constraints for the new vertices that landed EXACTLY on an existing sketch point. An
 * osnap endpoint snap writes the existing point's exact coordinate into the new vertex, so the match
 * is an exact `===` compare (no tolerance) — only a vertex the operator actually snapped onto another
 * point gets constrained; one that merely passed nearby stays free. Each match becomes a `coincident`
 * so the two points move together on a later edit instead of sharing a coordinate by accident.
 *
 * `existing` MUST exclude the new vertices — pass the design's points as they were BEFORE this commit.
 * The first existing point at the coordinate wins (stacked duplicates are degenerate). Pure.
 */
export function inferredCoincidentConstraints(
  vertices: ReadonlyArray<AutoConstraintVertex>,
  existing: ReadonlyArray<AutoConstraintVertex>,
  takenConstraintIds: ReadonlySet<string>
): SketchConstraint[] {
  if (vertices.length === 0 || existing.length === 0) return []

  const taken = new Set(takenConstraintIds)
  const nextId = (): string => {
    let n = 1
    while (taken.has(`con_${n}`)) n += 1
    const id = `con_${n}`
    taken.add(id)
    return id
  }

  const out: SketchConstraint[] = []
  for (const v of vertices) {
    const hit = existing.find((e) => e.pt[0] === v.pt[0] && e.pt[1] === v.pt[1])
    if (hit) {
      out.push({ id: nextId(), type: 'coincident', a: { pointId: v.id }, b: { pointId: hit.id } })
    }
  }
  return out
}

const PERP_TOL_DEG = 2
const PERP_TOL_SIN = Math.sin((PERP_TOL_DEG * Math.PI) / 180)

/**
 * Perpendicular CANDIDATES for the corners of a drawn chain — each consecutive segment pair whose
 * included angle is within {@link PERP_TOL_DEG}° of 90°. These are CANDIDATES, not final constraints:
 * a closed shape's corners are not all independent (a slanted quad's 4th right-angle is implied), so
 * the caller MUST pass the result through the rank gate (`keepRankIndependent`) before persisting.
 *
 * Sides that are themselves axis-aligned are skipped — a horizontal/vertical pair's right angle is
 * already pinned by the H/V auto-constraints, so a perpendicular there would only be redundant.
 * `closed` adds the wrap-around corners (last↔first); an open chain only constrains interior corners.
 */
export function inferredPerpendicularCandidates(
  vertices: ReadonlyArray<AutoConstraintVertex>,
  closed: boolean,
  takenConstraintIds: ReadonlySet<string>
): SketchConstraint[] {
  const n = vertices.length
  if (n < 3) return []

  const taken = new Set(takenConstraintIds)
  const nextId = (): string => {
    let k = 1
    while (taken.has(`con_${k}`)) k += 1
    const id = `con_${k}`
    taken.add(id)
    return id
  }

  const out: SketchConstraint[] = []
  const start = closed ? 0 : 1
  const end = closed ? n : n - 1
  for (let i = start; i < end; i++) {
    const prev = vertices[(i - 1 + n) % n]!
    const cur = vertices[i]!
    const next = vertices[(i + 1) % n]!
    const d1x = cur.pt[0] - prev.pt[0]
    const d1y = cur.pt[1] - prev.pt[1]
    const d2x = next.pt[0] - cur.pt[0]
    const d2y = next.pt[1] - cur.pt[1]
    const l1 = Math.hypot(d1x, d1y)
    const l2 = Math.hypot(d2x, d2y)
    if (l1 === 0 || l2 === 0) continue
    // H/V already pins a right angle when either side is on-axis — skip to avoid a redundant perp.
    if (d1x === 0 || d1y === 0 || d2x === 0 || d2y === 0) continue
    const cosAbs = Math.abs(d1x * d2x + d1y * d2y) / (l1 * l2)
    if (cosAbs < PERP_TOL_SIN) {
      out.push({
        id: nextId(),
        type: 'perpendicular',
        a1: { pointId: prev.id },
        b1: { pointId: cur.id },
        a2: { pointId: cur.id },
        b2: { pointId: next.id }
      })
    }
  }
  return out
}
