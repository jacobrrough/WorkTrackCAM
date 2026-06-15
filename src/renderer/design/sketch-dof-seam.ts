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
import { analyzeSketchDof as analyzeEngineDof } from './sketch-dof'

/**
 * DOF verdict the badge renders + styles off.
 *   - 'fully' — estimated 0 residual DOF (geometry pinned, approx).
 *   - 'under' — estimated DOF > 0 (still free to move).
 *   - 'over'  — more constraint equations than coordinates (likely redundant /
 *               conflicting); the estimate went negative.
 *   - 'empty' — nothing to analyse (no movable points); the badge stays blank.
 *
 * Mirrors the engine's `SketchDofStatus` except the engine's `'full'` is renamed
 * to `'fully'` here to match the badge's BEM modifier + the surrounding UI
 * wording ("Fully constrained").
 */
export type SketchDofStatus = 'fully' | 'under' | 'over' | 'empty'

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
