import type { AssemblyComponent } from './assembly-schema'
import type { AssemblyMateConstraint } from './assembly-mate-schema'
import { computeAssemblyKinematicPreviewTransforms, type AssemblyTransform6 } from './assembly-viewport-math'
import { solveMateConstraints, type SolverConfig, type SolverConvergenceReport } from './assembly-solver-core'

export type AssemblyJointViolation = {
  componentId: string
  joint: NonNullable<AssemblyComponent['joint']>
  dof: string
  raw: number
  clamped: number
  min: number
  max: number
}

export type AssemblyKinematicsDiagnostics = {
  violations: AssemblyJointViolation[]
  clampedDofs: string[]
  residuals: number[]
  /**
   * Mate-solver convergence report. Present only when `solveAssemblyKinematics` was given a
   * non-empty `mateConstraints` set (otherwise the legacy single-pass FK path runs and this is
   * omitted). When present, `residuals` is filled from `convergenceReport.perConstraintResiduals`.
   */
  convergenceReport?: SolverConvergenceReport
}

export type AssemblyKinematicsSolveResult = {
  transforms: Map<string, AssemblyTransform6>
  diagnostics: AssemblyKinematicsDiagnostics
}

function clamp(raw: number | undefined, minV: number, maxV: number): { raw: number; clamped: number } | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const lo = Math.min(minV, maxV)
  const hi = Math.max(minV, maxV)
  return { raw, clamped: Math.max(lo, Math.min(hi, raw)) }
}

function readState(c: AssemblyComponent, key: keyof NonNullable<AssemblyComponent['jointState']>, fallback: number | undefined): number | undefined {
  const fromState = c.jointState?.[key]
  return Number.isFinite(fromState) ? fromState : fallback
}

/**
 * Solve assembly kinematics for the active components.
 *
 * - When `mateConstraints` is **absent or empty**, runs the EXISTING single-pass forward-kinematics
 *   preview + joint-limit clamp path unchanged (zero regression), and `diagnostics.convergenceReport`
 *   is omitted with `residuals: []`.
 * - When `mateConstraints` is **non-empty**, runs the iterative {@link solveMateConstraints} solver,
 *   uses its solved transforms, attaches the `convergenceReport`, and fills `residuals` from the
 *   report's per-constraint residual magnitudes. Joint-limit clamp diagnostics still run on top.
 */
export function solveAssemblyKinematics(
  active: AssemblyComponent[],
  mateConstraints?: AssemblyMateConstraint[],
  solverConfig?: Partial<SolverConfig>
): AssemblyKinematicsSolveResult {
  const hasMates = mateConstraints != null && mateConstraints.length > 0
  const mateResult = hasMates ? solveMateConstraints(active, mateConstraints!, solverConfig) : null
  const transforms = mateResult
    ? mateResult.transforms
    : computeAssemblyKinematicPreviewTransforms(active)
  const violations: AssemblyJointViolation[] = []
  const clampedDofs: string[] = []

  for (const c of active) {
    const joint = c.joint
    if (!joint) continue
    const limits = c.jointLimits
    if (joint === 'revolute') {
      const raw = readState(c, 'scalarDeg', c.revolutePreviewAngleDeg)
      const minV = limits?.scalarMinDeg ?? c.revolutePreviewMinDeg ?? -180
      const maxV = limits?.scalarMaxDeg ?? c.revolutePreviewMaxDeg ?? 180
      const v = clamp(raw, minV, maxV)
      if (v && v.raw !== v.clamped) {
        violations.push({ componentId: c.id, joint, dof: 'scalarDeg', raw: v.raw, clamped: v.clamped, min: Math.min(minV, maxV), max: Math.max(minV, maxV) })
        clampedDofs.push(`${c.id}:scalarDeg`)
      }
    }
    if (joint === 'slider') {
      const raw = readState(c, 'scalarMm', c.sliderPreviewMm)
      const minV = limits?.scalarMinMm ?? c.sliderPreviewMinMm ?? -1e6
      const maxV = limits?.scalarMaxMm ?? c.sliderPreviewMaxMm ?? 1e6
      const v = clamp(raw, minV, maxV)
      if (v && v.raw !== v.clamped) {
        violations.push({ componentId: c.id, joint, dof: 'scalarMm', raw: v.raw, clamped: v.clamped, min: Math.min(minV, maxV), max: Math.max(minV, maxV) })
        clampedDofs.push(`${c.id}:scalarMm`)
      }
    }
    if (joint === 'planar') {
      const checks: Array<[number | undefined, number, number, string]> = [
        [readState(c, 'uMm', c.planarPreviewUMm), limits?.uMinMm ?? c.planarPreviewUMinMm ?? -1e6, limits?.uMaxMm ?? c.planarPreviewUMaxMm ?? 1e6, 'uMm'],
        [readState(c, 'vMm', c.planarPreviewVMm), limits?.vMinMm ?? c.planarPreviewVMinMm ?? -1e6, limits?.vMaxMm ?? c.planarPreviewVMaxMm ?? 1e6, 'vMm']
      ]
      for (const [raw, minV, maxV, dof] of checks) {
        const v = clamp(raw, minV, maxV)
        if (v && v.raw !== v.clamped) {
          violations.push({ componentId: c.id, joint, dof, raw: v.raw, clamped: v.clamped, min: Math.min(minV, maxV), max: Math.max(minV, maxV) })
          clampedDofs.push(`${c.id}:${dof}`)
        }
      }
    }
  }

  return {
    transforms,
    diagnostics: {
      violations,
      clampedDofs,
      residuals: mateResult ? mateResult.report.perConstraintResiduals.map((r) => r.residual) : [],
      ...(mateResult ? { convergenceReport: mateResult.report } : {})
    }
  }
}
