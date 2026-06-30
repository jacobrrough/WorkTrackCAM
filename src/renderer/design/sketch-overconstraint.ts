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

import type { SketchConstraint } from '../../shared/design-schema'

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
