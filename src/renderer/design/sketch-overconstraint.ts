/**
 * Rank-based over-constraint gate for auto-constraints.
 *
 * `solver2d.ts` least-squares-settles a sketch but never reports whether the constraint set is
 * over-determined, so blindly auto-adding a parallel / perpendicular would silently over-constrain a
 * closed shape (a slanted quad's 4th perpendicular is IMPLIED by the other three + closure). This
 * module answers "would adding this constraint actually pin a new degree of freedom, or is it
 * redundant?" by counting the numerical rank of the constraint Jacobian.
 *
 * Scope: the auto-constraint subsystem only — horizontal / vertical / coincident / parallel /
 * perpendicular over the freshly-drawn vertices (existing points are treated as fixed anchors, since
 * a new polyline does not move prior geometry). That keeps the residual set to five known kinds; the
 * design's other constraints don't reference the new points, so they don't affect the new points'
 * DOF. Pure + framework-agnostic (node-env testable).
 */

import type { DesignFileV2, SketchConstraint, SketchEntity } from '../../shared/design-schema'
import { cloneDesign, constraintResidualComponents } from './solver2d'

type XY = { readonly x: number; readonly y: number }
type MutXY = { x: number; y: number }

/** Per-scalar residuals for the five auto-constraint kinds (others contribute nothing here). */
function residualVector(
  constraints: ReadonlyArray<SketchConstraint>,
  pts: Record<string, XY>
): number[] {
  const g = (id: string): XY => pts[id] ?? { x: 0, y: 0 }
  const out: number[] = []
  for (const c of constraints) {
    if (c.type === 'horizontal') {
      const a = g(c.a.pointId)
      const b = g(c.b.pointId)
      out.push(a.y - b.y)
    } else if (c.type === 'vertical') {
      const a = g(c.a.pointId)
      const b = g(c.b.pointId)
      out.push(a.x - b.x)
    } else if (c.type === 'coincident') {
      const a = g(c.a.pointId)
      const b = g(c.b.pointId)
      out.push(a.x - b.x, a.y - b.y)
    } else if (c.type === 'perpendicular') {
      const a1 = g(c.a1.pointId)
      const b1 = g(c.b1.pointId)
      const a2 = g(c.a2.pointId)
      const b2 = g(c.b2.pointId)
      out.push((b1.x - a1.x) * (b2.x - a2.x) + (b1.y - a1.y) * (b2.y - a2.y))
    } else if (c.type === 'parallel') {
      const a1 = g(c.a1.pointId)
      const b1 = g(c.b1.pointId)
      const a2 = g(c.a2.pointId)
      const b2 = g(c.b2.pointId)
      out.push((b1.x - a1.x) * (b2.y - a2.y) - (b1.y - a1.y) * (b2.x - a2.x))
    }
    // distance / angle / equal / collinear / midpoint / etc. don't appear in the auto set.
  }
  return out
}

// Central finite differences (O(ε²) error) so the LINEAR rows from H/V/coincident and the QUADRATIC
// rows from parallel/perpendicular agree precisely enough that a dependent row eliminates to ~0 — a
// one-sided difference leaves ~1e-6 noise on the quadratic rows and spuriously inflates the rank.
const FD_EPS = 1e-5
const RANK_TOL = 1e-7

/** Rank of the (row-normalised) constraint Jacobian over the free point coordinates. */
function constraintRank(
  constraints: ReadonlyArray<SketchConstraint>,
  pts: Record<string, XY>,
  freePointIds: ReadonlyArray<string>
): number {
  const r0 = residualVector(constraints, pts)
  if (r0.length === 0) return 0

  // Work on a mutable copy so the finite-difference perturbations never escape.
  const work: Record<string, MutXY> = {}
  for (const [id, p] of Object.entries(pts)) work[id] = { x: p.x, y: p.y }

  const cols: Array<readonly [string, 'x' | 'y']> = []
  for (const id of freePointIds) {
    if (work[id]) cols.push([id, 'x'], [id, 'y'])
  }
  if (cols.length === 0) return 0

  // Numerical Jacobian J[i][j] = ∂r_i/∂col_j via CENTRAL differences.
  const J: number[][] = r0.map(() => new Array<number>(cols.length).fill(0))
  for (let j = 0; j < cols.length; j++) {
    const [id, axis] = cols[j]!
    const saved = work[id]![axis]
    work[id]![axis] = saved + FD_EPS
    const rPlus = residualVector(constraints, work)
    work[id]![axis] = saved - FD_EPS
    const rMinus = residualVector(constraints, work)
    work[id]![axis] = saved
    for (let i = 0; i < r0.length; i++) J[i]![j] = (rPlus[i]! - rMinus[i]!) / (2 * FD_EPS)
  }

  // Normalise each row to unit norm so mixed residual scales (linear H/V vs quadratic perp/parallel)
  // compare fairly in the elimination.
  for (const row of J) {
    let norm = 0
    for (const v of row) norm += v * v
    norm = Math.sqrt(norm)
    if (norm > RANK_TOL) for (let k = 0; k < row.length; k++) row[k]! /= norm
  }

  return gaussianRank(J)
}

/** Rank of a matrix via Gaussian elimination with partial pivoting. */
function gaussianRank(matrix: number[][]): number {
  const rows = matrix.map((r) => r.slice())
  const nRows = rows.length
  const nCols = rows[0]?.length ?? 0
  let rank = 0
  for (let col = 0; col < nCols && rank < nRows; col++) {
    let pivot = -1
    let best = RANK_TOL
    for (let r = rank; r < nRows; r++) {
      const v = Math.abs(rows[r]![col]!)
      if (v > best) {
        best = v
        pivot = r
      }
    }
    if (pivot === -1) continue
    const tmp = rows[rank]!
    rows[rank] = rows[pivot]!
    rows[pivot] = tmp
    const pivVal = rows[rank]![col]!
    for (let r = 0; r < nRows; r++) {
      if (r === rank) continue
      const factor = rows[r]![col]! / pivVal
      if (Math.abs(factor) < RANK_TOL) continue
      for (let cc = col; cc < nCols; cc++) rows[r]![cc]! -= factor * rows[rank]![cc]!
    }
    rank++
  }
  return rank
}

/**
 * Greedily keep the candidate constraints that each pin a NEW degree of freedom on top of `base`
 * (plus the candidates already kept). A candidate whose Jacobian row is linearly dependent on the
 * accepted set raises no rank → it is redundant / over-constraining → dropped. This is what stops a
 * closed slanted polygon's last perpendicular from over-constraining it.
 *
 * - `points`: every point referenced by base + candidates (new vertices AND any existing anchors).
 * - `freePointIds`: the points free to move (the freshly-drawn vertices); existing anchors are fixed.
 */
export function keepRankIndependent(
  base: ReadonlyArray<SketchConstraint>,
  candidates: ReadonlyArray<SketchConstraint>,
  points: Record<string, XY>,
  freePointIds: ReadonlyArray<string>
): SketchConstraint[] {
  const kept: SketchConstraint[] = []
  let currentRank = constraintRank(base, points, freePointIds)
  for (const cand of candidates) {
    const r = constraintRank([...base, ...kept, cand], points, freePointIds)
    if (r > currentRank) {
      kept.push(cand)
      currentRank = r
    }
  }
  return kept
}

/**
 * Name the existing constraint that made a DROPPED auto-constraint candidate
 * redundant — the "which one blocked it" half of the rank gate (requirement:
 * the block path should say WHICH existing constraint implied the new one).
 *
 * Leave-one-out over `base`, NEWEST FIRST (auto-constraint arrays append, so
 * reverse order = recency): `base[i]` is a blocker iff removing it lets the
 * candidate pin a new degree of freedom (`rank(rest ∪ {candidate}) >
 * rank(rest)`). Returns the FIRST (newest) blocker found, or `null` when no
 * single removal unlocks the candidate (it is implied only by a combination —
 * e.g. loop closure plus several constraints at once) or when `base` exceeds
 * {@link BLAME_MAX_CONSTRAINTS}.
 *
 * Cost: ≤ 2·N rank computations over the same 5-kind residual basis the gate
 * itself uses — the polyline auto-constraint sets are tens of rows at most.
 */
export function explainRedundantAutoConstraint(
  base: ReadonlyArray<SketchConstraint>,
  candidate: SketchConstraint,
  points: Record<string, XY>,
  freePointIds: ReadonlyArray<string>
): SketchConstraint | null {
  if (base.length === 0 || base.length > BLAME_MAX_CONSTRAINTS) return null
  // Only a candidate that IS redundant against the full base has a blocker —
  // an independent candidate (the gate kept it) must never name one.
  const baseRank = constraintRank(base, points, freePointIds)
  if (constraintRank([...base, candidate], points, freePointIds) > baseRank) return null
  for (let i = base.length - 1; i >= 0; i--) {
    const rest = base.filter((_, j) => j !== i)
    const withoutBlocker = constraintRank(rest, points, freePointIds)
    const withCandidate = constraintRank([...rest, candidate], points, freePointIds)
    if (withCandidate > withoutBlocker) return base[i]!
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Over-constraint CONFLICT NAMING (Fusion parity) — full-vocabulary blame.
//
// The gate above answers "would this NEW auto-constraint be redundant?" over
// the five auto kinds. The machinery below answers the operator-facing inverse
// on the WHOLE sketch: "the badge says over-constrained/conflicting — WHICH
// constraint is the culprit?" It builds ONE finite-difference Jacobian over
// every constraint's residual components (`solver2d.constraintResidualComponents`,
// the exact terms `energy()` squares) and rank-tests row subsets:
//
//   deficiency = rows − rank(J)   (> 0 ⇔ some residual rows are dependent —
//                                  redundant if targets agree, CONFLICTING if
//                                  they fight, e.g. distance 10 vs 80 on the
//                                  same pair: parallel rows, different targets)
//
//   culprit    = a constraint whose rows' removal makes the REMAINING rows
//                independent — i.e. removing that one constraint resolves the
//                whole conflict. Tested newest-first (constraints append, so
//                the most recent add is almost always the culprit).
//
// Cost, honestly: the Jacobian builds ONCE at O(freeCols × totalResidualCost);
// each rank check is Gaussian elimination O(rows² × cols); leave-one-out over
// N candidate constraints is O(N × rank-cost). Fine for real sketches (tens of
// constraints); {@link BLAME_MAX_CONSTRAINTS} caps the scan and reports
// 'too-large' beyond it. With `firstOnly` the newest-culprit common case is
// O(1)-ish (full rank + one leave-one-out check). Deterministic throughout —
// fixed FD epsilon, no randomness, no clock.
// ─────────────────────────────────────────────────────────────────────────────

/** Leave-one-out scans only run at or below this constraint count. */
export const BLAME_MAX_CONSTRAINTS = 200

export type ConstraintBlameStatus =
  /** No constraints at all — nothing to blame. */
  | 'empty'
  /** Every residual row is independent — no redundancy/conflict to name. */
  | 'independent'
  /** ≥1 constraint found whose individual removal restores independence. */
  | 'culprits'
  /** Rank-deficient, but no SINGLE removal resolves it (≥2 separate redundancies). */
  | 'unresolved'
  /** Constraint count exceeds {@link BLAME_MAX_CONSTRAINTS} — scan skipped. */
  | 'too-large'

export interface ConstraintBlameReport {
  readonly status: ConstraintBlameStatus
  /**
   * Ids of the constraints whose INDIVIDUAL removal restores full row
   * independence, newest-first (every entry is a sufficient fix on its own —
   * the operator removes ANY ONE of them).
   */
  readonly culpritIds: readonly string[]
  /** Redundant residual-equation count (rows − rank); 0 when independent. */
  readonly deficiency: number
  /** Rank computations performed — the cost pin for the recency early-out. */
  readonly rankChecks: number
}

export interface AnalyzeBlameOptions {
  /** Override the {@link BLAME_MAX_CONSTRAINTS} scan cap (tests). */
  readonly maxConstraints?: number
  /** Stop at the FIRST (newest) culprit — the O(1)-ish hot-path mode. */
  readonly firstOnly?: boolean
}

/** Structural guard for `{ pointId: string }` refs inside the constraint union. */
function isPointRef(v: unknown): v is { pointId: string } {
  return (
    typeof v === 'object' && v !== null && typeof (v as { pointId?: unknown }).pointId === 'string'
  )
}

/**
 * Every point id a constraint references, walked STRUCTURALLY (each
 * `{ pointId }` ref + the bare `pointId` of `fix`) so future constraint kinds
 * keep working without touching this module (mirrors `sketch-history`).
 */
export function constraintReferencedPointIds(c: SketchConstraint): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(c)) {
    if (key === 'pointId' && typeof value === 'string') {
      out.push(value)
      continue
    }
    if (isPointRef(value)) out.push(value.pointId)
  }
  return out
}

/** Entity ids a constraint references directly (`concentric` / `radius` / `diameter`). */
function constraintReferencedEntityIds(c: SketchConstraint): string[] {
  if (c.type === 'concentric') return [c.entityAId, c.entityBId]
  if (c.type === 'radius' || c.type === 'diameter') return [c.entityId]
  return []
}

/** Point ids pinned by a `fix` CONSTRAINT (excluded from the free columns). */
function fixConstrainedPointIds(design: DesignFileV2): Set<string> {
  const ids = new Set<string>()
  for (const c of design.constraints) {
    if (c.type === 'fix') ids.add(c.pointId)
  }
  return ids
}

/**
 * The free coordinate columns of the blame Jacobian: every point that is
 * neither schema-`fixed` nor pinned by a `fix` constraint — exactly the points
 * `solveSketch` moves (`applyFixConstraints` + `collectFreePointIds`).
 */
function blameFreePointIds(design: DesignFileV2): string[] {
  const fixIds = fixConstrainedPointIds(design)
  return Object.keys(design.points).filter(
    (id) => design.points[id]!.fixed !== true && !fixIds.has(id)
  )
}

interface BlameJacobian {
  /** One entry per residual row: the id of the constraint that owns the row. */
  readonly rowOwners: readonly string[]
  /** Row-normalised FD Jacobian rows (a row of zeros stays zeros). */
  readonly rows: number[][]
}

/**
 * Build the full-vocabulary constraint Jacobian ONCE via central finite
 * differences over the free point coordinates. Rows come from
 * `constraintResidualComponents` (the exact pre-squared `energy()` terms), so
 * every solver-visible constraint kind participates — not just the five auto
 * kinds `residualVector` covers. Rows are unit-normalised (mixed mm / mm²
 * scales compare fairly); a constraint on fully-fixed points yields an
 * all-zero row, which correctly counts as a dependent (redundant) equation.
 */
function buildBlameJacobian(design: DesignFileV2, freePointIds: readonly string[]): BlameJacobian {
  const work = cloneDesign(design)
  const cols: Array<readonly [string, 'x' | 'y']> = []
  for (const id of freePointIds) {
    if (work.points[id]) cols.push([id, 'x'], [id, 'y'])
  }

  const rowOwners: string[] = []
  const rows: number[][] = []
  /** Baseline component count per constraint keeps FD chunks aligned. */
  const baseCounts: number[] = []
  for (const c of work.constraints) {
    const comps = constraintResidualComponents(work, c)
    baseCounts.push(comps.length)
    for (let k = 0; k < comps.length; k++) {
      rowOwners.push(c.id)
      rows.push(new Array<number>(cols.length).fill(0))
    }
  }
  if (rows.length === 0) return { rowOwners, rows }

  for (let j = 0; j < cols.length; j++) {
    const [id, axis] = cols[j]!
    const p = work.points[id]!
    const saved = p[axis]
    p[axis] = saved + FD_EPS
    const plus = work.constraints.map((c) => constraintResidualComponents(work, c))
    p[axis] = saved - FD_EPS
    const minus = work.constraints.map((c) => constraintResidualComponents(work, c))
    p[axis] = saved
    let row = 0
    for (let ci = 0; ci < work.constraints.length; ci++) {
      const n = baseCounts[ci]!
      const cPlus = plus[ci]!
      const cMinus = minus[ci]!
      // A perturbation that crosses a degeneracy skip-rule changes the chunk
      // length; leave that constraint's entries 0 for this column (defensive —
      // FD_EPS is far below any real geometry scale).
      const aligned = cPlus.length === n && cMinus.length === n
      for (let k = 0; k < n; k++) {
        rows[row + k]![j] = aligned ? (cPlus[k]! - cMinus[k]!) / (2 * FD_EPS) : 0
      }
      row += n
    }
  }

  for (const row of rows) {
    let norm = 0
    for (const v of row) norm += v * v
    norm = Math.sqrt(norm)
    if (norm > RANK_TOL) for (let k = 0; k < row.length; k++) row[k]! /= norm
  }
  return { rowOwners, rows }
}

/**
 * Name the constraint(s) to blame for an over-constrained / conflicting
 * sketch. See the section header for the method + cost bounds. Pure and
 * deterministic; never mutates `design` (FD runs on a clone).
 *
 * Interpretation of the result:
 *   - `independent` — the rows are full-rank; the count-based badge may still
 *     say "over" (equation counting is cruder than rank), but no single
 *     constraint can be named. Callers should keep the generic message.
 *   - `culprits` — `culpritIds` (newest-first) each individually resolve the
 *     redundancy; the typical case is exactly one recently-added constraint.
 *   - `unresolved` — rank-deficient but ≥2 separate redundancies exist; no
 *     single removal fixes everything.
 *   - `too-large` — the scan was skipped (cap); report "too large to isolate".
 */
export function analyzeConstraintBlame(
  design: DesignFileV2,
  opts: AnalyzeBlameOptions = {}
): ConstraintBlameReport {
  const cap = opts.maxConstraints ?? BLAME_MAX_CONSTRAINTS
  const constraints = design.constraints
  if (constraints.length === 0) {
    return { status: 'empty', culpritIds: [], deficiency: 0, rankChecks: 0 }
  }
  if (constraints.length > cap) {
    return { status: 'too-large', culpritIds: [], deficiency: 0, rankChecks: 0 }
  }

  const { rowOwners, rows } = buildBlameJacobian(design, blameFreePointIds(design))
  if (rows.length === 0) {
    return { status: 'independent', culpritIds: [], deficiency: 0, rankChecks: 0 }
  }

  let rankChecks = 1
  const fullRank = gaussianRank(rows)
  const deficiency = rows.length - fullRank
  if (deficiency === 0) {
    return { status: 'independent', culpritIds: [], deficiency: 0, rankChecks }
  }

  const owners = new Set(rowOwners)
  const culprits: string[] = []
  // Newest-first: constraints append on creation, so reverse array order is
  // recency order — the most recent add is almost always the culprit.
  for (let i = constraints.length - 1; i >= 0; i--) {
    const id = constraints[i]!.id
    if (!owners.has(id)) continue
    const sub = rows.filter((_, r) => rowOwners[r] !== id)
    rankChecks += 1
    if (gaussianRank(sub) === sub.length) {
      culprits.push(id)
      if (opts.firstOnly) break
    }
  }

  return {
    status: culprits.length > 0 ? 'culprits' : 'unresolved',
    culpritIds: culprits,
    deficiency,
    rankChecks
  }
}

// ── Operator-facing naming helpers (labels + canvas anchors) ─────────────────

const CONSTRAINT_TYPE_LABELS: Record<SketchConstraint['type'], string> = {
  coincident: 'Coincident',
  distance: 'Distance',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  fix: 'Fix',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  equal: 'Equal',
  collinear: 'Collinear',
  midpoint: 'Midpoint',
  angle: 'Angle',
  tangent: 'Tangent',
  symmetric: 'Symmetric',
  concentric: 'Concentric',
  radius: 'Radius',
  diameter: 'Diameter'
}

/** Human label for a constraint kind ("perpendicular" → "Perpendicular"). */
export function sketchConstraintTypeLabel(type: SketchConstraint['type']): string {
  return CONSTRAINT_TYPE_LABELS[type]
}

/** Point ids an entity exposes in the shared points map (others own none). */
function entityPointIds(e: SketchEntity): readonly string[] {
  if (e.kind === 'arc') return [e.startId, e.viaId, e.endId]
  if ((e.kind === 'polyline' || e.kind === 'spline_fit' || e.kind === 'spline_cp') && 'pointIds' in e) {
    return e.pointIds
  }
  return []
}

/**
 * Short Fusion-style display names for every entity, keyed by entity id:
 * polylines are L1, L2, …; circles C1, …; arcs A1, …; everything else E1, ….
 * Deterministic: numbered in `design.entities` order.
 */
export function sketchEntityShortNames(design: DesignFileV2): Map<string, string> {
  const counters = new Map<string, number>()
  const names = new Map<string, string>()
  for (const e of design.entities) {
    const prefix =
      e.kind === 'polyline' ? 'L' : e.kind === 'circle' ? 'C' : e.kind === 'arc' ? 'A' : 'E'
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    names.set(e.id, `${prefix}${n}`)
  }
  return names
}

/**
 * Human-readable culprit label, e.g. "Perpendicular between L1 and L2",
 * "Horizontal on L1", "Radius on C1". Entities are resolved from the
 * constraint's entity refs plus the OWNERS of its referenced points (first
 * entity in `design.entities` order whose point ids contain the ref). When no
 * owning entity resolves (bare points), falls back to the constraint id.
 */
export function describeSketchConstraint(design: DesignFileV2, c: SketchConstraint): string {
  const label = sketchConstraintTypeLabel(c.type)
  const names = sketchEntityShortNames(design)
  const involved: string[] = []
  const push = (name: string | undefined): void => {
    if (name && !involved.includes(name)) involved.push(name)
  }
  for (const eid of constraintReferencedEntityIds(c)) push(names.get(eid))
  for (const pid of constraintReferencedPointIds(c)) {
    const owner = design.entities.find((e) => entityPointIds(e).includes(pid))
    if (owner) push(names.get(owner.id))
  }
  if (involved.length === 0) return `${label} ${c.id}`
  if (involved.length === 1) return `${label} on ${involved[0]}`
  if (involved.length === 2) return `${label} between ${involved[0]} and ${involved[1]}`
  return `${label} across ${involved.join(', ')}`
}

/**
 * World-space (sketch mm) points a constraint visibly touches — the referenced
 * points that exist, plus circle centers for entity-ref constraints. Drives
 * the canvas error glyph's dashed spokes.
 */
export function constraintDisplayPointsWorld(
  design: DesignFileV2,
  c: SketchConstraint
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const pid of constraintReferencedPointIds(c)) {
    const p = design.points[pid]
    if (p) out.push([p.x, p.y])
  }
  for (const eid of constraintReferencedEntityIds(c)) {
    const e = design.entities.find((en) => en.id === eid)
    if (e && (e.kind === 'circle' || e.kind === 'rect' || e.kind === 'slot' || e.kind === 'ellipse')) {
      out.push([e.cx, e.cy])
    } else if (e && e.kind === 'arc') {
      for (const pid of [e.startId, e.viaId, e.endId]) {
        const p = design.points[pid]
        if (p) out.push([p.x, p.y])
      }
    }
  }
  return out
}

/**
 * Anchor (mean of the display points) where the canvas paints the culprit's
 * error glyph, or `null` when the constraint references nothing drawable.
 */
export function constraintAnchorWorld(
  design: DesignFileV2,
  c: SketchConstraint
): [number, number] | null {
  const pts = constraintDisplayPointsWorld(design, c)
  if (pts.length === 0) return null
  let sx = 0
  let sy = 0
  for (const [x, y] of pts) {
    sx += x
    sy += y
  }
  return [sx / pts.length, sy / pts.length]
}
