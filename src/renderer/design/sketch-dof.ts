/**
 * Pure degrees-of-freedom (DOF) analysis for a v2 sketch (Sketch S5).
 *
 * This is the data behind the "constraint state" badge the sketcher shows
 * (Fusion / SolidWorks call it under-/fully-/over-defined). It is framework-
 * agnostic and DOM-free; the UI layer reads {@link analyzeSketchDof} and renders
 * the `status`.
 *
 * Method — equation-counting heuristic
 * ------------------------------------
 * We approximate the sketch's residual degrees of freedom with the classic
 * planar mobility formula:
 *
 *     approxDof = 2 * movablePointCount − Σ(equations per constraint)
 *
 * Every sketch point carries two coordinates (x, y) ⇒ 2 DOF. A point pinned via
 * its schema `fixed` flag contributes none, so it is excluded from
 * `movablePointCount`. Each constraint removes a fixed number of DOF equal to
 * the number of scalar equations it imposes:
 *
 *     coincident 2   distance 1   horizontal 1   vertical 1   fix 2
 *     perpendicular 1   parallel 1   equal 1   collinear 1   midpoint 2
 *     angle 1   tangent 1   symmetric 2   concentric 1   radius 1   diameter 1
 *
 * (The `fix` CONSTRAINT counts 2 here — it is the constraint-graph way to pin a
 * point, distinct from the per-point `fixed` schema flag handled above. A point
 * pinned by BOTH mechanisms is redundant authoring the heuristic cannot see;
 * see the limitation note below.)
 *
 * LIMITATION — this is an APPROXIMATION. Equation counting cannot detect
 * REDUNDANT or CONFLICTING constraints: two constraints that each remove a
 * nominal DOF but actually fight over (or duplicate) the SAME DOF still
 * subtract 2 from the count, so a sketch that is geometrically over-defined can
 * read `approxDof === 0` ("full") by the count alone. To flag genuine
 * over-definition honestly rather than fake it, callers should ALSO look at the
 * post-solve residual: {@link dofStatusWithResidual} pairs the equation-count
 * status with a high-residual signal from `sketchResidualReport`, so a sketch
 * that the solver cannot satisfy is reported `over` even when the raw count says
 * `full`/`under`.
 */

import type { DesignFileV2, SketchConstraint } from '../../shared/design-schema'
import { sketchResidualReport } from './solver2d'

/** Scalar equations each constraint kind imposes (DOF it nominally removes). */
const CONSTRAINT_EQUATIONS: Record<SketchConstraint['type'], number> = {
  coincident: 2,
  distance: 1,
  horizontal: 1,
  vertical: 1,
  fix: 2,
  perpendicular: 1,
  parallel: 1,
  equal: 1,
  collinear: 1,
  midpoint: 2,
  angle: 1,
  tangent: 1,
  symmetric: 2,
  concentric: 1,
  radius: 1,
  diameter: 1
}

/** Number of scalar equations a single constraint imposes. */
export function constraintEquationCount(constraint: SketchConstraint): number {
  return CONSTRAINT_EQUATIONS[constraint.type]
}

/** DOF state of a sketch (mirrors the Fusion/SolidWorks under/fully/over wording). */
export type SketchDofStatus = 'under' | 'full' | 'over' | 'empty'

/** Result of {@link analyzeSketchDof}. */
export interface SketchDofReport {
  /** Points whose `fixed` schema flag is not set (each = 2 DOF). */
  readonly movablePointCount: number
  /** Σ of scalar equations across all constraints. */
  readonly constraintEquationCount: number
  /** `2 * movablePointCount − constraintEquationCount` (equation-count heuristic). */
  readonly approxDof: number
  /**
   * `empty` when there are no points at all; otherwise by sign of `approxDof`:
   * `> 0` → `under`, `=== 0` → `full`, `< 0` → `over`.
   *
   * NOTE: this is the RAW equation-count status — it cannot see redundant or
   * conflicting constraints. Use {@link dofStatusWithResidual} to fold in a
   * post-solve high-residual signal for an honest over-defined flag.
   */
  readonly status: SketchDofStatus
}

/** Point ids pinned by a `fix` CONSTRAINT (distinct from the per-point flag). */
function fixConstrainedPointIds(design: DesignFileV2): Set<string> {
  const ids = new Set<string>()
  for (const c of design.constraints) {
    if (c.type === 'fix') ids.add(c.pointId)
  }
  return ids
}

/**
 * Movable points = those with two free coordinates for the base `2 * P` term.
 *
 * A point is NON-movable only when its schema `fixed` flag is true AND no `fix`
 * constraint targets it. This keeps the count STABLE across a solve: `solveSketch`
 * stamps `fixed = true` onto every fix-constrained point (`applyFixConstraints`),
 * but those points' DOF are already removed by the `fix` constraint's 2 equations
 * in the sum — counting the flag too would double-subtract. So a point whose
 * `fixed` flag is owed to a `fix` constraint stays "movable" for the base term;
 * only a point pinned PURELY by the schema flag (no fix constraint) drops out.
 */
function movablePointCount(design: DesignFileV2): number {
  const fixIds = fixConstrainedPointIds(design)
  let count = 0
  for (const id of Object.keys(design.points)) {
    const p = design.points[id]
    if (!p) continue
    const pinnedByFlagOnly = p.fixed === true && !fixIds.has(id)
    if (!pinnedByFlagOnly) count += 1
  }
  return count
}

function totalConstraintEquations(design: DesignFileV2): number {
  let sum = 0
  for (const c of design.constraints) sum += constraintEquationCount(c)
  return sum
}

function statusFromDof(movablePoints: number, approxDof: number): SketchDofStatus {
  if (movablePoints === 0) return 'empty'
  if (approxDof > 0) return 'under'
  if (approxDof === 0) return 'full'
  return 'over'
}

/**
 * Equation-count DOF analysis of a sketch.
 *
 * Pure and allocation-light: reads `design.points` + `design.constraints`,
 * never mutates. See the module header for the formula and its known
 * limitation (cannot detect redundant/conflicting constraints — pair with
 * {@link dofStatusWithResidual} for that).
 */
export function analyzeSketchDof(design: DesignFileV2): SketchDofReport {
  const movable = movablePointCount(design)
  const equations = totalConstraintEquations(design)
  const approxDof = 2 * movable - equations
  return {
    movablePointCount: movable,
    constraintEquationCount: equations,
    approxDof,
    status: statusFromDof(movable, approxDof)
  }
}

/**
 * Residual magnitude (in mm) above which a sketch is treated as genuinely
 * over-/conflicting-defined regardless of the equation count. `sketchResidualReport`
 * sums SQUARED residuals, so this compares against the squared threshold; the
 * default ≈ (0.05 mm)² catches a sketch the solver visibly cannot satisfy while
 * staying well clear of a well-conditioned solve's ~1e-12 floor.
 */
export const DOF_CONFLICT_RESIDUAL_MM = 0.05

/**
 * DOF status that is HONEST about conflicts.
 *
 * Combines the equation-count {@link analyzeSketchDof} status with the
 * post-solve total residual (`sketchResidualReport(design).total`, a sum of
 * squared residuals). Because equation counting cannot see redundant/conflicting
 * constraints, a sketch whose residual stays high after solving is reported
 * `over` even if the raw count says `under`/`full`. This is the value the UI
 * badge should show when the sketch has been solved.
 *
 * `empty` always wins (no geometry to analyse). The residual is only consulted
 * for non-empty sketches; pass the SOLVED design so the residual reflects the
 * solver's best effort.
 */
export function dofStatusWithResidual(
  design: DesignFileV2,
  residualThresholdMm: number = DOF_CONFLICT_RESIDUAL_MM
): SketchDofStatus {
  const report = analyzeSketchDof(design)
  if (report.status === 'empty') return 'empty'
  const thresholdSq =
    Number.isFinite(residualThresholdMm) && residualThresholdMm > 0
      ? residualThresholdMm * residualThresholdMm
      : DOF_CONFLICT_RESIDUAL_MM * DOF_CONFLICT_RESIDUAL_MM
  const { total } = sketchResidualReport(design)
  if (!Number.isFinite(total) || total > thresholdSq) return 'over'
  return report.status
}
