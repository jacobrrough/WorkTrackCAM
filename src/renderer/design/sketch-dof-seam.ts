/**
 * Typed seam for the sketch degrees-of-freedom (DOF) read-out (Sketch S5).
 *
 * The SketchSurface status row shows an HONEST DOF badge. The authoritative DOF
 * analysis is the engine agent's `analyzeSketchDof` (the equation-counting
 * heuristic in `./sketch-dof`). The surface consumes it through THIS seam so the
 * UI depends on one stable shape regardless of how the engine evolves:
 *
 *   - the seam adapts the engine report (`./sketch-dof`) into a badge view
 *     (`{ dof, status, label }`) the surface renders directly;
 *   - it maps the engine's `'full'` verdict onto the badge's `'fully'` status
 *     key (so the BEM modifier + colour token stay `--fully`);
 *   - it adds the operator-facing `label`, already honesty-qualified.
 *
 * Honesty contract (the whole reason this is a *seam*, not an inline call)
 * -----------------------------------------------------------------------
 *  - The engine estimate is APPROXIMATE (equation count cannot detect redundant
 *    or conflicting constraints — see `sketch-dof.ts`). So the badge labels every
 *    verdict "(approx)": a 0-DOF estimate reads "Fully constrained (approx)",
 *    NEVER a bare "Fully constrained" that would imply a rigorous rank analysis.
 *  - An EMPTY sketch (no movable points) → `status: 'empty'`, blank label, so the
 *    badge stays hidden rather than claim a verdict about nothing.
 *
 * Resilience: if `./sketch-dof` were absent at build time this file is the single
 * point that would need a local fallback — the surface never imports the engine
 * module directly, only this seam.
 *
 * Pure + DOM-free (node-SSR testable, the repo convention).
 */

import type { DesignFileV2 } from '../../shared/design-schema'
import {
  analyzeSketchDof as analyzeEngineDof,
  dofStatusWithResidual
} from './sketch-dof'

/**
 * DOF verdict the badge renders + styles off.
 *   - 'fully' — estimated 0 residual DOF (geometry pinned, approx).
 *   - 'under' — estimated DOF > 0 (still free to move).
 *   - 'over'  — more constraint equations than coordinates (the equation COUNT
 *               went negative — a redundancy the count itself can see).
 *   - 'conflicting' — the count looks fine (`under`/`fully`) but the SETTLED
 *               geometry's post-solve residual is high: the solver cannot
 *               satisfy the constraints simultaneously (e.g. a dimension fights
 *               another constraint). A genuine conflict the count cannot see.
 *               Only ever reported for a SETTLED design (see
 *               {@link analyzeSketchDofSettled}'s gating contract).
 *   - 'empty' — nothing to analyse (no movable points); the badge stays blank.
 *
 * Mirrors the engine's `SketchDofStatus` except the engine's `'full'` is renamed
 * to `'fully'` here to match the badge's BEM modifier + the surrounding UI
 * wording ("Fully constrained"), and the badge adds `'conflicting'` (the
 * residual-detected, count-invisible conflict) which has no engine-count twin.
 */
export type SketchDofStatus = 'fully' | 'under' | 'over' | 'conflicting' | 'empty'

/** The seam's badge view (what the SketchSurface DOF badge renders). */
export interface SketchDofReport {
  /** Estimated residual degrees of freedom (the engine's `approxDof`). */
  readonly dof: number
  /** Coarse verdict the badge styles + labels off. */
  readonly status: SketchDofStatus
  /** Operator-facing badge text (already honesty-qualified; see header). */
  readonly label: string
}

/** Map the engine's status vocabulary onto the badge's. */
function toBadgeStatus(engineStatus: 'under' | 'full' | 'over' | 'empty'): SketchDofStatus {
  return engineStatus === 'full' ? 'fully' : engineStatus
}

/** Honesty-qualified badge label for a verdict. */
function badgeLabel(status: SketchDofStatus, dof: number): string {
  switch (status) {
    case 'empty':
      return ''
    case 'fully':
      return 'Fully constrained (approx)'
    case 'over':
      return 'Over-constrained (approx)'
    case 'conflicting':
      // Residual-detected conflict (the count looked satisfiable): point the
      // operator at the dimensions/relations that are fighting. The "(approx)"
      // honesty qualifier lives in the badge TITLE for this verdict (the label
      // already carries the actionable "check dimensions").
      return 'Conflicting (check dimensions)'
    case 'under':
      return `${dof} DoF (approx)`
    default: {
      const _exhaustive: never = status
      void _exhaustive
      return ''
    }
  }
}

/**
 * Badge view for the sketch's DOF, sourced from the engine's `analyzeSketchDof`
 * (equation-count heuristic) and qualified honest. APPROXIMATE by construction:
 * redundant constraints make a 0/positive count optimistic, so the label always
 * carries "(approx)". Pure: never mutates `design`.
 */
export function analyzeSketchDof(design: DesignFileV2): SketchDofReport {
  const report = analyzeEngineDof(design)
  const status = toBadgeStatus(report.status)
  return { dof: report.approxDof, status, label: badgeLabel(status, report.approxDof) }
}

/**
 * True when `design` carries at least one driving/relating artifact — a
 * constraint OR a dimension. The residual-conflict check is meaningless without
 * one (a free sketch has nothing to over-define), so this is the FLOOR gate
 * below which the badge NEVER reads `'conflicting'`.
 */
function hasRelations(design: DesignFileV2): boolean {
  return design.constraints.length > 0 || (design.dimensions?.length ?? 0) > 0
}

/**
 * Conflict-AWARE badge view — the honest upgrade over {@link analyzeSketchDof}.
 *
 * The plain {@link analyzeSketchDof} is equation-count ONLY (it cannot see
 * redundant/conflicting constraints, by construction — see `sketch-dof.ts`).
 * This variant folds in the engine's `dofStatusWithResidual` (which consults the
 * post-solve residual via `sketchResidualReport`) to surface a GENUINE conflict
 * the count is blind to — but ONLY under a strict gating contract, so the badge
 * can never false-positive on a transiently-unsolved or mid-draw design.
 *
 * Gating contract (the honesty bar — why this never lies "Conflicting")
 * --------------------------------------------------------------------
 * The residual is consulted (and `'conflicting'` is only ever returned) when ALL
 * of these hold; otherwise the result is byte-identical to {@link analyzeSketchDof}:
 *
 *   1. `settled === true`. The CALLER asserts the rendered design is the result
 *      of a solve. On `SketchSurface` that means the design came out of a
 *      solve-bearing edit path (`handleApplyConstraint` /
 *      `handleCommitDimensionValue` re-solve via `solveSketchToTolerance`); a
 *      raw draw / drag / DXF-import / undo-redo is NOT settled, so `settled` is
 *      `false` and a mid-edit design can never read `'conflicting'`.
 *   2. The design has ≥1 constraint OR dimension ({@link hasRelations}). A
 *      constraint-free sketch has nothing to over-define — it is NEVER
 *      `'conflicting'`.
 *   3. The post-solve residual (`sketchResidualReport(design).total`) is high or
 *      non-finite (folded in by `dofStatusWithResidual`, which returns `'over'`
 *      in that case).
 *
 * Result mapping:
 *   - When the gate is open and `dofStatusWithResidual` flags `'over'` while the
 *     equation COUNT did NOT already say `over`, the verdict is `'conflicting'`
 *     ("Conflicting (check dimensions)") — a residual conflict the count missed.
 *   - When the count ALREADY says `over`, the verdict stays `'over'`
 *     ("Over-constrained") — the count saw the redundancy; no need to re-badge.
 *   - Otherwise (`under`/`fully`/`empty`, or the gate closed) the count verdict
 *     stands unchanged.
 *
 * Pure: never mutates `design`. `dofStatusWithResidual` reads (does not solve)
 * the design, so callers MUST pass the already-solved design (the gate's job).
 */
export function analyzeSketchDofSettled(
  design: DesignFileV2,
  settled: boolean
): SketchDofReport {
  const base = analyzeSketchDof(design)
  // Gate 1 + 2: a non-settled or relation-free design only ever reads the
  // count-only verdict — the residual is never consulted, so no false positive.
  if (!settled || base.status === 'empty' || !hasRelations(design)) return base
  // Gate 3: fold in the post-solve residual. `dofStatusWithResidual` returns
  // 'over' when the residual is high/non-finite. Only upgrade to 'conflicting'
  // when the COUNT itself did NOT already flag 'over' (else keep the honest
  // count verdict + its "Over-constrained" copy).
  const residualStatus = dofStatusWithResidual(design)
  if (residualStatus === 'over' && base.status !== 'over') {
    return { dof: base.dof, status: 'conflicting', label: badgeLabel('conflicting', base.dof) }
  }
  return base
}
