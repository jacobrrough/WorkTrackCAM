/**
 * Pure constraint-from-selection builder for the 2D sketch surface (Sketch S5).
 *
 * The S1 selection state on `SketchSurface` is a set of *entity* ids
 * (`selectedEntityIds`). A constraints toolbar lets the operator turn the
 * current selection into a `SketchConstraint` (parallel / perpendicular /
 * equal / tangent / coincident / horizontal / vertical / concentric). This
 * module owns the two pure halves of that:
 *
 *   applicableConstraints(design, selectedEntityIds)        -> which kinds make
 *       sense for the current selection (drives the toolbar's per-button enable).
 *   addConstraintFromSelection(design, selectedEntityIds, k) -> resolve the
 *       selection to the point/entity ids `k` needs, build the constraint with a
 *       collision-free id, and return the design WITH it added (or `null` when
 *       the selection can't satisfy the kind).
 *
 * The SURFACE then re-solves in ONE undo step:
 *   applyDesignEdit(solveSketchToTolerance(addConstraintFromSelection(...)))
 *
 * Design invariants
 * -----------------
 *  - PURE + DOM-FREE (node-SSR testable, the repo convention). `design` is
 *    never mutated; `addConstraintFromSelection` shallow-copies the constraints
 *    array and appends.
 *  - DETERMINISTIC IDS: the new constraint id is the first free `con_<n>` slot,
 *    scanning the existing constraint ids — no randomness, matching
 *    `sketch-dimension-drive.createDrivingDimension`.
 *  - SELECTION → GEOMETRY RESOLUTION RULE (documented per kind below).
 *
 * ── Resolution rules (how a SELECTED ENTITY maps to the ids a constraint needs) ──
 *
 * A constraint references POINT ids (parallel/perpendicular/equal/tangent/
 * coincident/horizontal/vertical) or ENTITY ids (concentric). The toolbar
 * selection is entity ids, so we resolve:
 *
 *   "line-like" entity  -> its FIRST straight segment as an ordered (a, b)
 *       point pair:
 *         · polyline  -> (pointIds[0], pointIds[1])   — the first drawn segment.
 *           A two-point polyline (the `line` tool's output) is exactly that
 *           segment, so a drawn line resolves to its own two endpoints.
 *         · arc       -> (startId, endId)             — the chord endpoints; an
 *           arc's tangent/parallel intent is taken against its chord direction
 *           (the same endpoints `tangent` already anchors on).
 *       rect / circle / slot / ellipse / spline have NO exposed vertex point
 *       ids (they store centers/dims, not a point map), so they are NOT
 *       line-like and never satisfy a 2-line constraint.
 *
 *   "circular" entity   -> the entity id itself (circle or arc) for `concentric`.
 *
 *   coincident          -> needs TWO point-bearing entities; it binds the FIRST
 *       vertex of each (polyline pointIds[0] / arc startId). This is the most
 *       predictable "make these two endpoints touch" mapping for an
 *       entity-level selection; finer point-level coincidence is the canvas's
 *       constraint-pick path, out of this toolbar's scope.
 *
 *   horizontal / vertical -> a SINGLE line-like entity; constrains its first
 *       segment (a, b) to be axis-aligned.
 *
 * `tangent` additionally needs the arc's via id and an arc/line role split, so
 * its resolution picks the line-like entity that is a *line* (polyline) and the
 * one that is an *arc* (see `buildTangent`).
 */

import type {
  DesignFileV2,
  SketchConstraint,
  SketchEntity
} from '../../shared/design-schema'
import { cloneDesign } from './solver2d'
// Re-export the engine agent's robust converge-to-tolerance solver (warm-start +
// plateau/NaN guards) so the surface applies a constraint and lands ON it (not
// merely toward it) in ONE undo step. Owned by `solver2d.ts`; the constraint
// toolbar is its first non-dimension consumer, so we surface it from here too.
export { solveSketchToTolerance } from './solver2d'

/**
 * The constraint kinds the S5 toolbar can create from an ENTITY selection.
 * A subset of `SketchConstraint['type']` — the toolbar deliberately omits the
 * point-pick-only kinds (distance/angle/midpoint/symmetric/fix/radius/
 * diameter) which the dimension tool + canvas constraint-pick already own.
 * `collinear` IS a toolbar kind: two line-like selections resolve to TWO
 * three-point collinear constraints (both endpoints of the second segment on
 * the first segment's infinite line — true segment collinearity, per Fusion).
 */
export type ConstraintKind =
  | 'parallel'
  | 'perpendicular'
  | 'collinear'
  | 'equal'
  | 'tangent'
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'concentric'

/** Every kind the toolbar renders a button for, in display order. */
export const TOOLBAR_CONSTRAINT_KINDS: readonly ConstraintKind[] = [
  'parallel',
  'perpendicular',
  'collinear',
  'equal',
  'tangent',
  'coincident',
  'horizontal',
  'vertical',
  'concentric'
]

// ---------------------------------------------------------------------------
// Selection resolution helpers (read-only).
// ---------------------------------------------------------------------------

/** An ordered straight-segment point pair resolved from a line-like entity. */
interface LineLike {
  readonly entityId: string
  readonly aId: string
  readonly bId: string
  /** True when the source entity is an arc (so tangent can split roles). */
  readonly isArc: boolean
}

function findEntity(design: DesignFileV2, id: string): SketchEntity | undefined {
  return design.entities.find((e) => e.id === id)
}

/** True when both ids resolve to real points in the design. */
function pointsExist(design: DesignFileV2, ...ids: string[]): boolean {
  return ids.every((id) => design.points[id] != null)
}

/**
 * Resolve an entity to its first straight-segment (a, b) point pair, or `null`
 * when the entity is not line-like (no exposed vertex ids) or its points are
 * missing. See the module header for the per-kind rule.
 */
function lineLikeFromEntity(design: DesignFileV2, entityId: string): LineLike | null {
  const ent = findEntity(design, entityId)
  if (!ent) return null
  if (ent.kind === 'polyline') {
    if (!('pointIds' in ent) || ent.pointIds.length < 2) return null
    const aId = ent.pointIds[0]!
    const bId = ent.pointIds[1]!
    if (!pointsExist(design, aId, bId)) return null
    return { entityId, aId, bId, isArc: false }
  }
  if (ent.kind === 'arc') {
    if (!pointsExist(design, ent.startId, ent.endId)) return null
    return { entityId, aId: ent.startId, bId: ent.endId, isArc: true }
  }
  return null
}

/** The FIRST vertex point id of a point-bearing entity (polyline / arc), or null. */
function firstVertexId(design: DesignFileV2, entityId: string): string | null {
  const ent = findEntity(design, entityId)
  if (!ent) return null
  if (ent.kind === 'polyline') {
    if (!('pointIds' in ent) || ent.pointIds.length < 1) return null
    const id = ent.pointIds[0]!
    return design.points[id] != null ? id : null
  }
  if (ent.kind === 'arc') {
    return design.points[ent.startId] != null ? ent.startId : null
  }
  return null
}

/** A circle or arc entity id (the entity kinds `concentric` accepts). */
function isCircularEntity(design: DesignFileV2, entityId: string): boolean {
  const ent = findEntity(design, entityId)
  return ent != null && (ent.kind === 'circle' || ent.kind === 'arc')
}

/**
 * Stable, display-ordered list of the SELECTED ids that exist in the design.
 * Order follows `design.entities` (draw order), NOT set-iteration order, so the
 * "first / second" resolution is deterministic regardless of click order.
 */
function selectedEntityIdsInDrawOrder(
  design: DesignFileV2,
  selected: ReadonlySet<string>
): string[] {
  return design.entities.filter((e) => selected.has(e.id)).map((e) => e.id)
}

// ---------------------------------------------------------------------------
// 1. applicableConstraints
// ---------------------------------------------------------------------------

/**
 * Which toolbar constraint kinds the current selection can satisfy. Pure; the
 * toolbar enables exactly the returned kinds. Returned in
 * `TOOLBAR_CONSTRAINT_KINDS` order so the UI is stable.
 *
 * Requirements per kind:
 *   parallel / perpendicular / collinear / equal -> exactly TWO line-like selections.
 *   tangent                          -> one line-like LINE (polyline) + one ARC.
 *   coincident                       -> exactly TWO point-bearing selections.
 *   horizontal / vertical            -> exactly ONE line-like selection.
 *   concentric                       -> exactly TWO circle/arc selections.
 */
export function applicableConstraints(
  design: DesignFileV2,
  selectedEntityIds: ReadonlySet<string>
): ConstraintKind[] {
  const ids = selectedEntityIdsInDrawOrder(design, selectedEntityIds)
  const lineLikes = ids
    .map((id) => lineLikeFromEntity(design, id))
    .filter((l): l is LineLike => l !== null)
  const circulars = ids.filter((id) => isCircularEntity(design, id))
  const pointBearing = ids.filter((id) => firstVertexId(design, id) !== null)

  const out: ConstraintKind[] = []
  const twoLines = lineLikes.length === 2 && ids.length === 2
  const oneLine = lineLikes.length === 1 && ids.length === 1
  // tangent: one of the two line-likes is an arc and the other is a line.
  const lineForTangent = lineLikes.find((l) => !l.isArc)
  const arcForTangent = lineLikes.find((l) => l.isArc)
  const tangentOk = ids.length === 2 && lineForTangent != null && arcForTangent != null

  if (twoLines) {
    out.push('parallel', 'perpendicular', 'collinear', 'equal')
  }
  if (tangentOk) out.push('tangent')
  if (pointBearing.length === 2 && ids.length === 2) out.push('coincident')
  if (oneLine) out.push('horizontal', 'vertical')
  if (circulars.length === 2 && ids.length === 2) out.push('concentric')

  // Keep the result in TOOLBAR order + de-duplicated (tangent + parallel can
  // both qualify for a line+arc pair: a chord IS line-like).
  const set = new Set(out)
  return TOOLBAR_CONSTRAINT_KINDS.filter((k) => set.has(k))
}

// ---------------------------------------------------------------------------
// Deterministic constraint id (scans existing ids; matches the dim engine).
// ---------------------------------------------------------------------------

/** First `con_<n>` (n ≥ 1) not already used by a constraint. */
function freeConstraintId(design: DesignFileV2): string {
  return freeConstraintIds(design, 1)[0]!
}

/** The first `count` free `con_<n>` ids (n ≥ 1), in ascending order. */
function freeConstraintIds(design: DesignFileV2, count: number): string[] {
  const taken = new Set(design.constraints.map((c) => c.id))
  const out: string[] = []
  let n = 1
  while (out.length < count) {
    const id = `con_${n}`
    if (!taken.has(id)) out.push(id)
    n += 1
  }
  return out
}

// ---------------------------------------------------------------------------
// 2. addConstraintFromSelection
// ---------------------------------------------------------------------------

/**
 * Resolve `selectedEntityIds` to the ids `kind` needs and return a NEW design
 * with the built `SketchConstraint`(s) appended, or `null` when the selection
 * cannot satisfy the kind (so the caller records no undo step). Never mutates
 * `design`. The new constraint's residual is non-zero in general — the caller
 * re-solves; this function does NOT move geometry.
 *
 * Every kind appends exactly ONE constraint except `collinear`, which appends
 * TWO three-point collinear constraints (see `buildCollinearPair`) — still ONE
 * apply, ONE undo step for the caller.
 *
 * The result is a DEEP clone (`cloneDesign`): `solveSketchToTolerance` mutates
 * its argument's points in place, so a deep clone keeps the surface's undo
 * pre-state (the original `design`, kept in history) pristine even though the
 * re-solve runs on the returned object.
 */
export function addConstraintFromSelection(
  design: DesignFileV2,
  selectedEntityIds: ReadonlySet<string>,
  kind: ConstraintKind
): DesignFileV2 | null {
  // Gate on the same predicate the toolbar uses, so an impossible request is a
  // clean null rather than a malformed constraint.
  if (!applicableConstraints(design, selectedEntityIds).includes(kind)) return null

  const constraints = buildConstraints(design, selectedEntityIds, kind)
  if (!constraints || constraints.length === 0) return null

  const next = cloneDesign(design)
  next.constraints = [...next.constraints, ...constraints]
  return next
}

function buildConstraints(
  design: DesignFileV2,
  selectedEntityIds: ReadonlySet<string>,
  kind: ConstraintKind
): SketchConstraint[] | null {
  const ids = selectedEntityIdsInDrawOrder(design, selectedEntityIds)
  switch (kind) {
    case 'parallel':
    case 'perpendicular':
    case 'equal': {
      const c = buildTwoLine(design, ids, kind, freeConstraintId(design))
      return c ? [c] : null
    }
    case 'collinear':
      return buildCollinearPair(design, ids)
    case 'tangent': {
      const c = buildTangent(design, ids, freeConstraintId(design))
      return c ? [c] : null
    }
    case 'coincident': {
      const c = buildCoincident(design, ids, freeConstraintId(design))
      return c ? [c] : null
    }
    case 'horizontal':
    case 'vertical': {
      const c = buildAxisAligned(design, ids, kind, freeConstraintId(design))
      return c ? [c] : null
    }
    case 'concentric': {
      const c = buildConcentric(design, ids, freeConstraintId(design))
      return c ? [c] : null
    }
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      return null
    }
  }
}

function buildTwoLine(
  design: DesignFileV2,
  ids: string[],
  kind: 'parallel' | 'perpendicular' | 'equal',
  id: string
): SketchConstraint | null {
  const l1 = lineLikeFromEntity(design, ids[0] ?? '')
  const l2 = lineLikeFromEntity(design, ids[1] ?? '')
  if (!l1 || !l2) return null
  return {
    id,
    type: kind,
    a1: { pointId: l1.aId },
    b1: { pointId: l1.bId },
    a2: { pointId: l2.aId },
    b2: { pointId: l2.bId }
  }
}

/**
 * Collinear from TWO line-like selections — mirrors the parallel/perpendicular
 * resolution (first straight segments (a1,b1) / (a2,b2)) but the schema's
 * `collinear` is a THREE-point relation (a, b, c on one line). One three-point
 * constraint only pins ONE endpoint of the second segment to the first's
 * infinite line; TRUE segment collinearity (what the Fusion button means)
 * needs BOTH, so this builds the pair:
 *   collinear(a1, b1, a2)  and  collinear(a1, b1, b2)
 * with consecutive collision-free `con_<n>` ids.
 */
function buildCollinearPair(design: DesignFileV2, ids: string[]): SketchConstraint[] | null {
  const l1 = lineLikeFromEntity(design, ids[0] ?? '')
  const l2 = lineLikeFromEntity(design, ids[1] ?? '')
  if (!l1 || !l2) return null
  const [id1, id2] = freeConstraintIds(design, 2)
  return [
    {
      id: id1!,
      type: 'collinear',
      a: { pointId: l1.aId },
      b: { pointId: l1.bId },
      c: { pointId: l2.aId }
    },
    {
      id: id2!,
      type: 'collinear',
      a: { pointId: l1.aId },
      b: { pointId: l1.bId },
      c: { pointId: l2.bId }
    }
  ]
}

function buildTangent(design: DesignFileV2, ids: string[], id: string): SketchConstraint | null {
  const lineLikes = ids
    .map((eid) => lineLikeFromEntity(design, eid))
    .filter((l): l is LineLike => l !== null)
  const line = lineLikes.find((l) => !l.isArc)
  const arcLine = lineLikes.find((l) => l.isArc)
  if (!line || !arcLine) return null
  const arcEnt = findEntity(design, arcLine.entityId)
  if (!arcEnt || arcEnt.kind !== 'arc') return null
  if (!pointsExist(design, arcEnt.startId, arcEnt.viaId, arcEnt.endId)) return null
  // Tangent at the arc END against the line's B end — the chord endpoints the
  // resolution picked (line.aId→line.bId, arc start→end) make `b`/`end` the
  // shared-ish corner the operator most often means; coincidence between them
  // (if wanted) is the canvas constraint-pick's job, not the toolbar's.
  return {
    id,
    type: 'tangent',
    lineA: { pointId: line.aId },
    lineB: { pointId: line.bId },
    arcStart: { pointId: arcEnt.startId },
    arcVia: { pointId: arcEnt.viaId },
    arcEnd: { pointId: arcEnt.endId },
    arcTangentAt: 'end',
    lineTangentAt: 'b'
  }
}

function buildCoincident(design: DesignFileV2, ids: string[], id: string): SketchConstraint | null {
  const aId = firstVertexId(design, ids[0] ?? '')
  const bId = firstVertexId(design, ids[1] ?? '')
  if (!aId || !bId || aId === bId) return null
  return { id, type: 'coincident', a: { pointId: aId }, b: { pointId: bId } }
}

function buildAxisAligned(
  design: DesignFileV2,
  ids: string[],
  kind: 'horizontal' | 'vertical',
  id: string
): SketchConstraint | null {
  const l = lineLikeFromEntity(design, ids[0] ?? '')
  if (!l) return null
  return { id, type: kind, a: { pointId: l.aId }, b: { pointId: l.bId } }
}

function buildConcentric(design: DesignFileV2, ids: string[], id: string): SketchConstraint | null {
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  if (!isCircularEntity(design, a) || !isCircularEntity(design, b)) return null
  return { id, type: 'concentric', entityAId: a, entityBId: b }
}

/**
 * A short human label for a constraint kind, for the toolbar button + its
 * title/aria. Pure; exported so the toolbar render + its test share one source.
 */
export function constraintKindLabel(kind: ConstraintKind): string {
  switch (kind) {
    case 'parallel':
      return 'Parallel'
    case 'perpendicular':
      return 'Perpendicular'
    case 'collinear':
      return 'Collinear'
    case 'equal':
      return 'Equal'
    case 'tangent':
      return 'Tangent'
    case 'coincident':
      return 'Coincident'
    case 'horizontal':
      return 'Horizontal'
    case 'vertical':
      return 'Vertical'
    case 'concentric':
      return 'Concentric'
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      return 'Constraint'
    }
  }
}

/** One-line "what selection this needs" hint for the toolbar button title. */
export function constraintKindHint(kind: ConstraintKind): string {
  switch (kind) {
    case 'parallel':
    case 'perpendicular':
    case 'equal':
      return 'Select two lines (or line/arc chords).'
    case 'collinear':
      return 'Select two lines — makes them lie on one line.'
    case 'tangent':
      return 'Select one line and one arc.'
    case 'coincident':
      return 'Select two line/arc entities (binds their first vertices).'
    case 'horizontal':
    case 'vertical':
      return 'Select one line.'
    case 'concentric':
      return 'Select two circles/arcs.'
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      return ''
    }
  }
}
