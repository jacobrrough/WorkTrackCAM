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
