/**
 * CAD V1 — pure mapping from a constraint-solver *diagnosis* onto the
 * per-entity / per-constraint UI flags the sketch canvas paints.
 *
 * Pure module. No React, no DOM, no IPC. The renderer feeds in:
 *   - the current ``Sketch`` (entities + constraints), and
 *   - a normalised ``SketchSolveDiagnosis`` (DOF count + status + the
 *     conflicting / redundant constraint id lists the sidecar reports), and
 * gets back a ``SketchConstraintStatusMap`` it can consult while drawing:
 *   - the sketch-wide status (``'under' | 'fully' | 'over'``) used to tint
 *     all geometry (Fusion: blue/white under-constrained, green fully
 *     constrained, red over-constrained),
 *   - the set of conflicting constraint ids (paint those constraint glyphs
 *     red), and
 *   - per-entity status so an entity that participates in a conflicting
 *     constraint is highlighted even though the entity itself carries no
 *     status from the solver.
 *
 * Keeping this pure mirrors ``categoriseSolveResult`` in ``sketch-state.ts``
 * and means the unit tests can exercise every branch with a plain object —
 * no canvas, no jsdom. The renderer (a later phase) consumes the result;
 * this module must never import the React component.
 */

import type { Constraint, Sketch, SketchEntity } from './sketch-state'

// ── Inputs ───────────────────────────────────────────────────────────────────

/**
 * Solver-derived constraint health for a single entity / constraint / the
 * whole sketch.
 *   - ``under``  — degrees of freedom remain (sketch can still move).
 *   - ``fully``  — exactly constrained (DOF == 0, no conflicts).
 *   - ``over``   — redundant / conflicting constraints (the solver could not
 *                  satisfy every constraint, or DOF went negative).
 */
export type EntityConstraintStatus = 'under' | 'fully' | 'over'

/**
 * Normalised solver diagnosis the renderer threads in after a solve. This
 * is intentionally decoupled from the IPC wire type (``CadSolveSketchResult``)
 * so the mapping logic can be unit-tested without the bridge — the renderer
 * adapts the bridge payload into this shape.
 *
 * ``status`` is optional: when omitted it is derived from ``dof`` +
 * ``conflictingConstraintIds`` (negative or conflicting → over; > 0 → under;
 * exactly 0 with no conflicts → fully). Supplying it lets the sidecar's own
 * ``diagnose()`` verdict win when the two disagree.
 */
export type SketchSolveDiagnosis = {
  /** Residual degrees of freedom reported by the solver (>= 0 normally). */
  dof?: number
  /** Solver's own verdict, when available. Overrides the dof-derived guess. */
  status?: EntityConstraintStatus
  /** Constraint ids the solver flagged as mutually conflicting. */
  conflictingConstraintIds?: readonly string[]
  /** Constraint ids the solver flagged as redundant (satisfied but extra). */
  redundantConstraintIds?: readonly string[]
}

// ── Output ───────────────────────────────────────────────────────────────────

/**
 * Per-constraint UI flag. ``conflicting`` constraints are painted red;
 * ``redundant`` ones get a muted warning tint; ``ok`` constraints draw
 * normally.
 */
export type ConstraintUiState = 'ok' | 'redundant' | 'conflicting'

/**
 * Per-entity UI flag. ``status`` is the sketch-wide constraint status the
 * entity inherits (drives the base tint). ``conflicting`` is true when the
 * entity participates in at least one conflicting constraint, so the canvas
 * can highlight the offending geometry specifically.
 */
export type EntityUiFlags = {
  status: EntityConstraintStatus
  conflicting: boolean
}

export type SketchConstraintStatusMap = {
  /** Sketch-wide status used to tint all geometry. */
  sketchStatus: EntityConstraintStatus
  /** Residual DOF echoed through for the badge label (undefined if unknown). */
  dof?: number
  /** Conflicting constraint ids as a set for O(1) ``has`` lookups in draw(). */
  conflictingConstraintIds: ReadonlySet<string>
  /** Redundant constraint ids as a set. */
  redundantConstraintIds: ReadonlySet<string>
  /**
   * Human-readable labels for the conflicting constraints ("Horizontal h1"),
   * in sketch constraint order — the badge names the culprit instead of
   * dumping raw ids (Fusion parity: the operator learns WHICH relation
   * fights, not just that one does).
   */
  conflictingConstraintLabels: readonly string[]
  /** constraintId → UI state. Every constraint in the sketch is present. */
  constraintState: ReadonlyMap<string, ConstraintUiState>
  /** entityId → flags. Every entity in the sketch is present. */
  entityFlags: ReadonlyMap<string, EntityUiFlags>
}

// ── Reference extraction (kept local + pure) ─────────────────────────────────

/** Every POINT id a constraint references. */
function constraintPointRefs(c: Constraint): readonly string[] {
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':
    case 'coincident':
    case 'distance':
      return [c.aId, c.bId]
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'angle':
      return [c.a1Id, c.b1Id, c.a2Id, c.b2Id]
    case 'tangent':
      return [c.lineAId, c.lineBId, c.arcStartId, c.arcViaId, c.arcEndId]
    case 'symmetric':
      return [c.aId, c.bId, c.laId, c.lbId]
    case 'midpoint':
      return [c.mId, c.aId, c.bId]
    case 'pointOnLine':
      return [c.pId, c.aId, c.bId]
    case 'fix':
      return [c.pointId]
    case 'radius':
    case 'concentric':
      return []
    default: {
      const _exhaustive: never = c
      void _exhaustive
      return []
    }
  }
}

/** Every ENTITY id a constraint references (radius / concentric). */
function constraintEntityRefs(c: Constraint): readonly string[] {
  if (c.kind === 'radius') return [c.entityId]
  if (c.kind === 'concentric') return [c.entityAId, c.entityBId]
  return []
}

/** Human label per constraint kind (the badge's culprit-naming vocabulary). */
const CONSTRAINT_KIND_LABELS: Record<Constraint['kind'], string> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  coincident: 'Coincident',
  distance: 'Distance',
  radius: 'Radius',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  equal: 'Equal',
  tangent: 'Tangent',
  concentric: 'Concentric',
  symmetric: 'Symmetric',
  midpoint: 'Midpoint',
  pointOnLine: 'Point-on-line',
  angle: 'Angle',
  fix: 'Fix'
}

/**
 * Human-readable culprit label for one conflicting constraint: its kind name
 * plus the id ("Perpendicular pp1"), so the badge names WHICH relation fights
 * rather than echoing a bare id.
 */
export function constraintConflictLabel(c: Constraint): string {
  return `${CONSTRAINT_KIND_LABELS[c.kind]} ${c.id}`
}

/** Every point id an entity owns (so a conflict on a point lights its entity). */
function entityPointIds(e: SketchEntity): readonly string[] {
  switch (e.kind) {
    case 'point':
      return [e.pointId]
    case 'line':
      return [e.startId, e.endId]
    case 'circle':
      return [e.centerId]
    case 'spline':
      return e.pointIds
    case 'arc':
      return [e.startId, e.viaId, e.endId]
    default: {
      const _exhaustive: never = e
      void _exhaustive
      return []
    }
  }
}

// ── Status derivation ────────────────────────────────────────────────────────

/**
 * Derive the sketch-wide status when the solver did not hand one back.
 * Conflicts always win (over). Otherwise a positive DOF means under; an
 * exact 0 with no conflicts means fully. A negative DOF (more constraints
 * than freedoms) is treated as over.
 */
export function deriveSketchStatus(
  dof: number | undefined,
  hasConflicts: boolean
): EntityConstraintStatus {
  if (hasConflicts) return 'over'
  if (dof === undefined) {
    // No DOF signal and no conflicts: assume the solve under-determined the
    // sketch rather than claiming a false "fully constrained".
    return 'under'
  }
  if (dof > 0) return 'under'
  if (dof < 0) return 'over'
  return 'fully'
}

/**
 * Map a solver diagnosis onto per-entity + per-constraint UI flags.
 *
 * Guarantees
 * ----------
 *   - Every entity in ``sketch.entities`` has an ``entityFlags`` record.
 *   - Every constraint in ``sketch.constraints`` has a ``constraintState``
 *     record.
 *   - Conflicting / redundant ids the solver reports for constraints that no
 *     longer exist in the sketch are ignored (stale ids never crash draw()).
 *   - An entity is ``conflicting`` when any conflicting constraint references
 *     one of its points (point-level constraints) or the entity directly
 *     (radius / concentric on a circle / arc).
 */
export function mapSolveDiagnosisToStatus(
  sketch: Sketch,
  diagnosis: SketchSolveDiagnosis
): SketchConstraintStatusMap {
  const liveConstraintIds = new Set(sketch.constraints.map((c) => c.id))

  // Filter the solver's id lists down to constraints that still exist.
  const conflicting = new Set<string>()
  for (const id of diagnosis.conflictingConstraintIds ?? []) {
    if (liveConstraintIds.has(id)) conflicting.add(id)
  }
  const redundant = new Set<string>()
  for (const id of diagnosis.redundantConstraintIds ?? []) {
    // A constraint reported as both conflicting and redundant is treated as
    // conflicting (the stronger signal) and excluded from the redundant set.
    if (liveConstraintIds.has(id) && !conflicting.has(id)) redundant.add(id)
  }

  const sketchStatus = diagnosis.status ?? deriveSketchStatus(diagnosis.dof, conflicting.size > 0)

  // Point ids + entity ids touched by a conflicting constraint.
  const conflictingPointIds = new Set<string>()
  const conflictingEntityIds = new Set<string>()
  for (const c of sketch.constraints) {
    if (!conflicting.has(c.id)) continue
    for (const pid of constraintPointRefs(c)) conflictingPointIds.add(pid)
    for (const eid of constraintEntityRefs(c)) conflictingEntityIds.add(eid)
  }

  const constraintState = new Map<string, ConstraintUiState>()
  const conflictingConstraintLabels: string[] = []
  for (const c of sketch.constraints) {
    constraintState.set(
      c.id,
      conflicting.has(c.id) ? 'conflicting' : redundant.has(c.id) ? 'redundant' : 'ok'
    )
    if (conflicting.has(c.id)) conflictingConstraintLabels.push(constraintConflictLabel(c))
  }

  const entityFlags = new Map<string, EntityUiFlags>()
  for (const e of sketch.entities) {
    const directHit = conflictingEntityIds.has(e.id)
    const pointHit = entityPointIds(e).some((pid) => conflictingPointIds.has(pid))
    entityFlags.set(e.id, { status: sketchStatus, conflicting: directHit || pointHit })
  }

  return {
    sketchStatus,
    dof: diagnosis.dof,
    conflictingConstraintIds: conflicting,
    redundantConstraintIds: redundant,
    conflictingConstraintLabels,
    constraintState,
    entityFlags
  }
}

/**
 * Human-readable badge label for the sketch DOF status — mirrors the
 * assembly solver badge wording (``AssemblyView.tsx``). Pure; the renderer
 * drops the string straight into the badge span.
 */
export function sketchStatusBadgeLabel(map: SketchConstraintStatusMap): string {
  if (map.sketchStatus === 'fully') return 'Fully constrained'
  if (map.sketchStatus === 'under') {
    const n = map.dof ?? 0
    return `Under-constrained: ${n} DOF`
  }
  // over — name the culprit(s) so the operator knows WHICH relation to remove
  // (Fusion parity); a single culprit gets the actionable long form, several
  // are listed, and no ids at all falls back to the bare verdict.
  const labels = map.conflictingConstraintLabels
  if (labels.length === 1) {
    return `Over-constrained — ${labels[0]} conflicts; remove it or another constraint on these entities`
  }
  if (labels.length > 1) {
    return `Over-constrained — ${labels.join(', ')} conflict; remove one of them`
  }
  return 'Over-constrained'
}

// ── Bridge adapter ───────────────────────────────────────────────────────────

/**
 * Structural shape of the sidecar ``cad.solveSketch`` success result this
 * module knows how to consume. Declared locally (rather than importing
 * ``CadSolveSketchResult`` from ``src/shared/sidecar-protocol``) to keep this
 * module free of the IPC wire types — the same decoupling the rest of the file
 * relies on so the unit tests run with plain objects. The renderer passes the
 * bridge payload straight in; extra fields on the real wire type are ignored.
 *
 * Note the wire ``status`` vocabulary has FOUR values
 * (``'fully' | 'under' | 'over' | 'conflicting'``) whereas the UI status is
 * three-valued — ``'conflicting'`` collapses onto ``'over'`` (both paint red).
 */
export type SolveResultLike = {
  dof?: number
  status?: 'fully' | 'under' | 'over' | 'conflicting'
  conflictingConstraintIds?: readonly string[]
  redundantConstraintIds?: readonly string[]
}

/**
 * Adapt a sidecar solve result into the normalised ``SketchSolveDiagnosis``
 * the mapper consumes. Pure: the four-valued wire ``status`` is folded to the
 * three-valued UI status (``'conflicting' → 'over'``); the id lists pass
 * through untouched (the mapper filters stale ids against the live sketch).
 */
export function adaptSolveResultToDiagnosis(result: SolveResultLike): SketchSolveDiagnosis {
  const status: EntityConstraintStatus | undefined =
    result.status === undefined ? undefined : result.status === 'conflicting' ? 'over' : result.status
  return {
    dof: result.dof,
    status,
    conflictingConstraintIds: result.conflictingConstraintIds,
    redundantConstraintIds: result.redundantConstraintIds
  }
}

// ── Token-driven paint helpers (no inline literals; theme vars only) ──────────

/**
 * Stroke colour (a CSS custom-property reference, never a raw literal) for an
 * entity given its solver flags. A conflicting entity always paints red; an
 * un-flagged entity inherits the sketch-wide tint:
 *   - ``under``  → ``var(--accent)``  (Fusion blue — still free to move),
 *   - ``fully``  → ``var(--txt0)``    (defined geometry, near-black/white per theme),
 *   - ``over``   → ``var(--err)``     (the whole sketch is over-determined).
 *
 * Returned as ``var(--token)`` strings so every visual stays theme-driven; the
 * canvas 2D context receives these directly as ``strokeStyle``. (Canvas cannot
 * read CSS classes, so a token *reference* is the closest token-driven option —
 * the renderer resolves it against the live computed style before painting.)
 */
export function entityStrokeToken(flags: EntityUiFlags): string {
  if (flags.conflicting) return 'var(--err)'
  if (flags.status === 'under') return 'var(--accent)'
  if (flags.status === 'over') return 'var(--err)'
  return 'var(--txt0)'
}

/**
 * Glyph colour token for a constraint marker: conflicting → red, redundant →
 * amber warning, ok → muted foreground.
 */
export function constraintGlyphToken(state: ConstraintUiState): string {
  if (state === 'conflicting') return 'var(--err)'
  if (state === 'redundant') return 'var(--warn)'
  return 'var(--txt2)'
}

/**
 * BEM modifier suffix for the DOF badge, mirroring the assembly solver badge
 * modifiers (``design-assembly__solver-badge--{converged|under-constrained|
 * over-constrained}``). The renderer appends this to ``sketch-mvp-dof-badge--``.
 * Returns the status verbatim (the three UI statuses already make valid BEM
 * suffixes); typed as the narrow union so callers can switch exhaustively.
 */
export function sketchStatusBadgeModifier(
  status: EntityConstraintStatus
): EntityConstraintStatus {
  return status
}

// ── DOF badge view selection (the honesty contract) ──────────────────────────

/**
 * Every state the ribbon DOF badge can render. The three constraint verdicts
 * (``EntityConstraintStatus``) require an *authoritative* solver diagnosis;
 * ``'not-solved'`` and ``'solved'`` cover the two non-authoritative states.
 */
export type DofBadgeStatus = EntityConstraintStatus | 'not-solved' | 'solved'

/** Label + status the ribbon badge renders. */
export type DofBadgeView = {
  /** The exact string the operator reads in the badge. */
  label: string
  /** data-status / BEM suffix + the palette key the badge style consumes. */
  status: DofBadgeStatus
}

/**
 * Pick the DOF-badge label + status, given the current diagnosis, whether that
 * diagnosis is *authoritative* (came from the sidecar's real planegcs
 * ``diagnose()`` DOF analysis), and the mapped status. Pure, so the
 * operator-facing wording is unit-tested without a render.
 *
 * Honesty contract — the whole reason this helper exists:
 *   - no diagnosis yet              → ``not-solved`` / "Not solved"
 *   - solved but DOF *not* analysed → ``solved``     / "Solved"
 *   - authoritative diagnosis       → the real verdict (fully / under / over)
 *
 * The middle case is the safety guarantee: a locally-converged sketch (the
 * energy-minimising fallback has no DOF concept) must read "Solved", NEVER
 * "Fully constrained". Claiming full constraint on a sketch that is merely
 * geometrically settled would mislead the operator into trusting a part that
 * is still free to move.
 */
export function selectDofBadgeView(
  diagnosis: SketchSolveDiagnosis | null,
  dofAuthoritative: boolean,
  statusMap: SketchConstraintStatusMap
): DofBadgeView {
  if (diagnosis === null) return { label: 'Not solved', status: 'not-solved' }
  if (!dofAuthoritative) return { label: 'Solved', status: 'solved' }
  return {
    label: sketchStatusBadgeLabel(statusMap),
    status: sketchStatusBadgeModifier(statusMap.sketchStatus)
  }
}
