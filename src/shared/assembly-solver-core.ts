import type { AssemblyComponent } from './assembly-schema'
import type { AssemblyMateConstraint, AssemblyMateFeature } from './assembly-mate-schema'
import type { AssemblyTransform6 } from './assembly-viewport-math'

/**
 * Assembly mate **convergence solver** (foundation).
 *
 * Mirrors the proven `src/renderer/design/solver2d.ts` blueprint — energy = Σ squared residuals,
 * central-difference gradient, adaptive gradient descent with backtracking — but in 3D assembly
 * pose space instead of 2D sketch points. See `docs/plans/v2-assembly-mate-solver-convergence.md`
 * §3 (recommended approach) and §6 (analytic tests).
 *
 * Free-variable model (foundation): each **non-grounded** component contributes free variables —
 * its 3 translational DOF when it has no `joint`, or its joint's scalar DOF count when it does.
 * Grounded components are fixed. Positional mates (coincident / concentric / distance / flush)
 * drive translation; directional mates (angle / tangent) contribute a scalar residual evaluated
 * on the *current* pose (full rotational DOF in the variable vector is a full-vision enhancement).
 *
 * Over/under-constrained detection uses the documented **constraint-count vs free-DOF** heuristic
 * (full Jacobian-rank is a later enhancement): `E` = total scalar residual equations, `F` = total
 * free DOF. `E < F` → under-constrained. `E == F` → run the loop. `E > F` is over-DETERMINED but
 * not necessarily conflicting — a redundant-but-consistent set (e.g. two identical coincident
 * mates) is satisfiable — so we run a least-squares solve and classify on the FINAL residual:
 * residual converges → `converged` (redundant); residual stays above
 * `CONFLICTING_RESIDUAL_FLOOR` → `over_constrained`, reporting the still-violated ids as the
 * conflicting block. (With no movable free vars the over-determined report is immediate.)
 *
 * Strictly deterministic: components sorted by id, constraints sorted by id, fixed variable order,
 * and NO `Math.random` / `Date.now` / `crypto`.
 */

/** Solver tuning knobs. All optional at the call site; defaults below. */
export type SolverConfig = {
  /**
   * Convergence threshold on the **L2 residual magnitude** (`finalResidual = sqrt(Σ squared
   * residuals)`, i.e. total geometric error in mm/rad). Converge when `finalResidual < residualTol`.
   * Default 1e-6.
   */
  residualTol: number
  /** Hard cap on solve iterations. Default 100. */
  maxIterations: number
  /** Central-difference perturbation for numeric gradients. Default 1e-6. */
  eps: number
}

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  residualTol: 1e-6,
  maxIterations: 100,
  eps: 1e-6
}

/** Terminal classification of a solve. */
export type SolverConvergenceStatus =
  | 'converged'
  | 'max_iterations_reached'
  | 'diverged'
  | 'over_constrained'
  | 'under_constrained'

/** Per-constraint residual magnitude (geometric error: mm for positional, rad for directional). */
export type PerConstraintResidual = {
  constraintId: string
  /** L2 magnitude of this constraint's residual vector at the final pose. */
  residual: number
}

/** Full diagnostic report returned by the solver. */
export type SolverConvergenceReport = {
  converged: boolean
  iterations: number
  /**
   * L2 residual magnitude at termination = `sqrt(Σ squared residuals)` across all active
   * constraints (total geometric error in mm/rad). 0 means every mate is satisfied exactly.
   */
  finalResidual: number
  perConstraintResiduals: PerConstraintResidual[]
  status: SolverConvergenceStatus
  /** Populated for `over_constrained`: ids of the constraints in the over-determined block. */
  conflictingConstraintIds?: string[]
  /** Populated for `under_constrained`: free DOF not pinned by any constraint (`F - E`). */
  freeVariableCount?: number
}

/** Solver output: solved world transforms keyed by component id + the convergence report. */
export type AssemblyMateSolveResult = {
  transforms: Map<string, AssemblyTransform6>
  report: SolverConvergenceReport
}

const DEG2RAD = Math.PI / 180

/** Scalar DOF a joint contributes when its owner is non-grounded (foundation free-variable model). */
function jointDof(joint: AssemblyComponent['joint'] | undefined): number {
  switch (joint) {
    case 'rigid':
      return 0
    case 'revolute':
    case 'slider':
      return 1
    case 'planar':
    case 'cylindrical':
    case 'universal':
      return 2
    case 'ball':
      return 3
    case undefined:
      // No joint kind: a free-floating body — translational DOF only in the foundation.
      return 3
    default:
      return 3
  }
}

/** Number of scalar residual equations a mate kind contributes. */
function mateEquationCount(kind: AssemblyMateConstraint['kind']): number {
  switch (kind) {
    case 'coincident':
      return 3
    case 'concentric':
      return 2
    case 'distance':
      return 1
    case 'angle':
      return 1
    case 'flush':
      return 1
    case 'tangent':
      return 1
    default:
      return 1
  }
}

/** Local feature point (defaults each missing axis to 0). */
function featurePoint(f: AssemblyMateFeature): [number, number, number] {
  return [f.x ?? 0, f.y ?? 0, f.z ?? 0]
}

/** Local feature axis as a world-unconverted cardinal unit (defaults to +z). */
function featureAxisUnit(f: AssemblyMateFeature): [number, number, number] {
  switch (f.axis) {
    case 'x':
      return [1, 0, 0]
    case 'y':
      return [0, 1, 0]
    case 'z':
      return [0, 0, 1]
    default:
      return [0, 0, 1]
  }
}

/**
 * World position of a local feature point under a 6-DOF transform.
 * Applies Euler-ZYX rotation (matching `assembly-viewport-math` conventions) then translation.
 */
function worldFeaturePoint(t: AssemblyTransform6, local: [number, number, number]): [number, number, number] {
  const [lx, ly, lz] = local
  const cz = Math.cos(t.rzDeg * DEG2RAD)
  const sz = Math.sin(t.rzDeg * DEG2RAD)
  const cy = Math.cos(t.ryDeg * DEG2RAD)
  const sy = Math.sin(t.ryDeg * DEG2RAD)
  const cx = Math.cos(t.rxDeg * DEG2RAD)
  const sx = Math.sin(t.rxDeg * DEG2RAD)
  // R = Rz * Ry * Rx applied to the local vector.
  // Rx
  const x1 = lx
  const y1 = cx * ly - sx * lz
  const z1 = sx * ly + cx * lz
  // Ry
  const x2 = cy * x1 + sy * z1
  const y2 = y1
  const z2 = -sy * x1 + cy * z1
  // Rz
  const x3 = cz * x2 - sz * y2
  const y3 = sz * x2 + cz * y2
  const z3 = z2
  return [x3 + t.x, y3 + t.y, z3 + t.z]
}

/** World direction (rotation only, no translation) of a local feature axis. */
function worldFeatureAxis(t: AssemblyTransform6, local: [number, number, number]): [number, number, number] {
  const p0 = worldFeaturePoint({ ...t, x: 0, y: 0, z: 0 }, [0, 0, 0])
  const p1 = worldFeaturePoint({ ...t, x: 0, y: 0, z: 0 }, local)
  return [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
}

function cloneTransform(t: AssemblyComponent['transform']): AssemblyTransform6 {
  return { x: t.x, y: t.y, z: t.z, rxDeg: t.rxDeg, ryDeg: t.ryDeg, rzDeg: t.rzDeg }
}

/** Squared residual contributions for one mate at a given transform set, summed into energy. */
function mateSquaredResidual(
  mate: AssemblyMateConstraint,
  transforms: Map<string, AssemblyTransform6>
): number {
  const t1 = transforms.get(mate.part1Id)
  const t2 = transforms.get(mate.part2Id)
  if (!t1 || !t2) return 0
  switch (mate.kind) {
    case 'coincident': {
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    }
    case 'concentric': {
      // Two scalar equations: the perpendicular distance between feature points across the
      // shared axis. Foundation models it as the planar offset orthogonal to feature1's axis.
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      const axis = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const dz = b[2] - a[2]
      const along = dx * axis[0] + dy * axis[1] + dz * axis[2]
      // perpendicular component = d - (d·axis)axis
      const px = dx - along * axis[0]
      const py = dy - along * axis[1]
      const pz = dz - along * axis[2]
      return px * px + py * py + pz * pz
    }
    case 'distance': {
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      const target = mate.value ?? 0
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      const r = d - target
      return r * r
    }
    case 'flush': {
      // One equation: feature points share their coordinate along feature1's axis.
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      const axis = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      const r = (b[0] - a[0]) * axis[0] + (b[1] - a[1]) * axis[1] + (b[2] - a[2]) * axis[2]
      return r * r
    }
    case 'angle': {
      const u = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      const v = normalize(worldFeatureAxis(t2, featureAxisUnit(mate.feature2)))
      const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      const target = Math.cos((mate.value ?? 0) * DEG2RAD)
      const r = dot - target
      return r * r
    }
    case 'tangent': {
      // Perpendicular contact: feature axes orthogonal → cos(angle) = 0.
      const u = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      const v = normalize(worldFeatureAxis(t2, featureAxisUnit(mate.feature2)))
      const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      return dot * dot
    }
    default:
      return 0
  }
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** L2 residual magnitude (geometric error) for one mate — used for per-constraint reporting. */
function mateResidualMagnitude(
  mate: AssemblyMateConstraint,
  transforms: Map<string, AssemblyTransform6>
): number {
  return Math.sqrt(mateSquaredResidual(mate, transforms))
}

/** Total energy = Σ squared residuals over active mates. */
function totalEnergy(
  mates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>
): number {
  let e = 0
  for (const m of mates) e += mateSquaredResidual(m, transforms)
  return e
}

/**
 * One translational free variable handle: which component, and which axis of its translation.
 * (Foundation moves translation only; jointed-but-no-mate components are short-circuited as
 * under-constrained before the loop runs, so they never need scalar handles here.)
 */
type FreeVarAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'
type FreeVar = { componentId: string; axis: FreeVarAxis }

function readVar(transforms: Map<string, AssemblyTransform6>, fv: FreeVar): number {
  const t = transforms.get(fv.componentId)!
  switch (fv.axis) {
    case 'x':
      return t.x
    case 'y':
      return t.y
    case 'z':
      return t.z
    // Rotational handles operate in RADIANS so their gradient is the same O(1)
    // scale as the (mm) translational handles — a single learning rate then
    // converges both without ill-conditioning.
    case 'rx':
      return t.rxDeg * DEG2RAD
    case 'ry':
      return t.ryDeg * DEG2RAD
    case 'rz':
      return t.rzDeg * DEG2RAD
  }
}

function writeVar(transforms: Map<string, AssemblyTransform6>, fv: FreeVar, value: number): void {
  const t = transforms.get(fv.componentId)!
  switch (fv.axis) {
    case 'x':
      transforms.set(fv.componentId, { ...t, x: value })
      return
    case 'y':
      transforms.set(fv.componentId, { ...t, y: value })
      return
    case 'z':
      transforms.set(fv.componentId, { ...t, z: value })
      return
    case 'rx':
      transforms.set(fv.componentId, { ...t, rxDeg: value / DEG2RAD })
      return
    case 'ry':
      transforms.set(fv.componentId, { ...t, ryDeg: value / DEG2RAD })
      return
    case 'rz':
      transforms.set(fv.componentId, { ...t, rzDeg: value / DEG2RAD })
      return
  }
}

function buildReport(
  mates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>,
  iterations: number,
  status: SolverConvergenceStatus,
  extra: { conflictingConstraintIds?: string[]; freeVariableCount?: number } = {}
): SolverConvergenceReport {
  const perConstraintResiduals: PerConstraintResidual[] = mates.map((m) => ({
    constraintId: m.id,
    residual: mateResidualMagnitude(m, transforms)
  }))
  const finalResidual = Math.sqrt(totalEnergy(mates, transforms))
  return {
    converged: status === 'converged',
    iterations,
    finalResidual,
    perConstraintResiduals,
    status,
    ...(extra.conflictingConstraintIds != null
      ? { conflictingConstraintIds: extra.conflictingConstraintIds }
      : {}),
    ...(extra.freeVariableCount != null ? { freeVariableCount: extra.freeVariableCount } : {})
  }
}

/**
 * Run the gradient-descent + backtracking convergence loop **in place** on `transforms`
 * (mirrors solver2d). Shared by the balanced `E === F` path and the over-determined
 * `E > F` least-squares path so both reduce energy with identical, deterministic mechanics.
 *
 * Returns the iteration count and a terminal status of `converged` / `max_iterations_reached`
 * / `diverged`. The caller is responsible for the over/under-constrained *classification*
 * (this helper only drives energy down and reports raw convergence).
 */
function runMateConvergenceLoop(
  activeMates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>,
  freeVars: FreeVar[],
  cfg: SolverConfig,
  energyTol: number
): { iterations: number; status: SolverConvergenceStatus } {
  // Anti-singularity seed: a cos-based angle/tangent residual has a ZERO gradient
  // when the two axes start exactly aligned or perpendicular (sin = 0 at the
  // extremum), which would stall a rotational handle at its start pose. If we are
  // not already converged, nudge each rotational handle a deterministic 2° to
  // break the symmetry so gradient descent has a slope to follow. Harmless when
  // already near the target (the loop corrects it); skipped once energy < tol, and
  // never touches translational handles.
  if (totalEnergy(activeMates, transforms) >= energyTol) {
    const seedRad = 2 * DEG2RAD
    for (const fv of freeVars) {
      if (fv.axis === 'rx' || fv.axis === 'ry' || fv.axis === 'rz') {
        writeVar(transforms, fv, readVar(transforms, fv) + seedRad)
      }
    }
  }

  let lr = 0.4
  let iterations = 0
  let status: SolverConvergenceStatus = 'max_iterations_reached'

  for (let it = 0; it < cfg.maxIterations; it++) {
    iterations = it + 1
    const e0 = totalEnergy(activeMates, transforms)
    if (e0 < energyTol) {
      status = 'converged'
      break
    }
    if (freeVars.length === 0) {
      // No movable handles (e.g. all DOF are joint scalars not yet wired): can't
      // reduce energy in the foundation — report honestly rather than spin.
      status = e0 < energyTol ? 'converged' : 'max_iterations_reached'
      break
    }

    // Jacobi sweep: snapshot, compute all gradients at the snapshot, then apply together.
    const snapshot = new Map<string, AssemblyTransform6>()
    for (const [id, t] of transforms) snapshot.set(id, { ...t })

    const gradients: number[] = []
    for (const fv of freeVars) {
      // Restore from snapshot before each partial so multi-var mates stay consistent.
      for (const [id, t] of snapshot) transforms.set(id, { ...t })
      const v0 = readVar(transforms, fv)
      writeVar(transforms, fv, v0 + cfg.eps)
      const ePlus = totalEnergy(activeMates, transforms)
      writeVar(transforms, fv, v0 - cfg.eps)
      const eMinus = totalEnergy(activeMates, transforms)
      writeVar(transforms, fv, v0)
      gradients.push((ePlus - eMinus) / (2 * cfg.eps))
    }

    // Restore snapshot, then take the step.
    for (const [id, t] of snapshot) transforms.set(id, { ...t })
    for (let i = 0; i < freeVars.length; i++) {
      const fv = freeVars[i]!
      const v0 = readVar(transforms, fv)
      writeVar(transforms, fv, v0 - lr * gradients[i]!)
    }

    const e1 = totalEnergy(activeMates, transforms)
    if (!Number.isFinite(e1)) {
      // Numerical blow-up: restore and report diverged.
      for (const [id, t] of snapshot) transforms.set(id, { ...t })
      status = 'diverged'
      break
    }
    if (e1 > e0 * 1.0 + 1e-18) {
      // No improvement: restore and shrink the step (backtracking line search).
      for (const [id, t] of snapshot) transforms.set(id, { ...t })
      lr *= 0.5
      if (lr < 1e-12) {
        status = totalEnergy(activeMates, transforms) < energyTol ? 'converged' : 'max_iterations_reached'
        break
      }
    }
  }

  // Final convergence check (covers the case where the last accepted step crossed the threshold).
  if (status === 'max_iterations_reached' && totalEnergy(activeMates, transforms) < energyTol) {
    status = 'converged'
  }
  return { iterations, status }
}

/**
 * Constraints whose residual magnitude stays above this floor after a least-squares
 * solve of an over-determined system (`E > F`) are reported as the **conflicting**
 * block. The floor is generous relative to the convergence tolerance so a merely
 * redundant-but-consistent system (which the loop drives to ~0) is NOT flagged.
 */
const CONFLICTING_RESIDUAL_FLOOR = 1e-4

/** Ids of constraints still carrying a residual above {@link CONFLICTING_RESIDUAL_FLOOR}. */
function conflictingMateIds(
  activeMates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>
): string[] {
  return activeMates
    .filter((m) => mateResidualMagnitude(m, transforms) > CONFLICTING_RESIDUAL_FLOOR)
    .map((m) => m.id)
}

/**
 * Solve a set of mate constraints to convergence.
 *
 * @param components assembly components (any order; sorted by id internally)
 * @param mates persisted mate constraints (any order; sorted by id internally; suppressed skipped)
 * @param config optional solver tuning (merged over {@link DEFAULT_SOLVER_CONFIG})
 */
export function solveMateConstraints(
  components: AssemblyComponent[],
  mates: AssemblyMateConstraint[],
  config?: Partial<SolverConfig>
): AssemblyMateSolveResult {
  const cfg: SolverConfig = { ...DEFAULT_SOLVER_CONFIG, ...config }
  // The loop tracks energy (Σ squared residuals); the public tolerance is on the L2 magnitude,
  // so converge when energy < residualTol². finalResidual is reported as sqrt(energy).
  const energyTol = cfg.residualTol * cfg.residualTol

  // Deterministic ordering.
  const sortedComponents = [...components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const activeMates = mates
    .filter((m) => m.suppress !== true)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Initial transforms = each component's stored placement.
  const transforms = new Map<string, AssemblyTransform6>()
  for (const c of sortedComponents) transforms.set(c.id, cloneTransform(c.transform))

  // Restrict the solve to components actually referenced by an active mate (others are inert).
  const referenced = new Set<string>()
  for (const m of activeMates) {
    referenced.add(m.part1Id)
    referenced.add(m.part2Id)
  }

  // Free DOF (F) and free translational variables.
  let freeDof = 0
  const freeVars: FreeVar[] = []
  for (const c of sortedComponents) {
    if (c.grounded) continue
    const dof = jointDof(c.joint)
    freeDof += dof
    if (!referenced.has(c.id)) continue
    if (c.joint == null) {
      // No-joint, mate-referenced: translational handles the loop can move.
      freeVars.push({ componentId: c.id, axis: 'x' })
      freeVars.push({ componentId: c.id, axis: 'y' })
      freeVars.push({ componentId: c.id, axis: 'z' })
    } else if (c.joint === 'revolute') {
      // Revolute (1 rotational DOF): wire the single rotation about the joint's
      // world axis (`revolutePreviewAxis`, default +Z) as a movable handle, so an
      // angle/tangent mate on a hinge converges (E===F=1) instead of stalling at
      // max_iterations with no handle to move. Other joint kinds stay
      // DOF-counted-but-unwired (foundation — see jointDof).
      const ax = c.revolutePreviewAxis
      const rot: FreeVarAxis = ax === 'x' ? 'rx' : ax === 'y' ? 'ry' : 'rz'
      freeVars.push({ componentId: c.id, axis: rot })
    }
  }

  // Constraint equation count (E).
  let equationCount = 0
  for (const m of activeMates) equationCount += mateEquationCount(m.kind)

  // No active constraints: nothing to solve. Under-constrained iff there are free DOF.
  if (activeMates.length === 0) {
    const status: SolverConvergenceStatus = freeDof > 0 ? 'under_constrained' : 'converged'
    return {
      transforms,
      report: buildReport(activeMates, transforms, 0, status, {
        freeVariableCount: freeDof > 0 ? freeDof : undefined
      })
    }
  }

  // Over-determined by count (E > F). The count alone does NOT prove conflict: a
  // redundant-but-consistent set (e.g. two identical coincident mates) is satisfiable.
  // So run a least-squares solve of the free vars and classify on the FINAL residual —
  //   • residual converges  → the extra equations were redundant, report `converged`;
  //   • residual stays high → genuinely `over_constrained`, and the conflicting block is
  //     the constraints still carrying a residual above CONFLICTING_RESIDUAL_FLOOR.
  // With NO free vars to move (every DOF grounded/unwired), nothing can satisfy the surplus
  // equations unless we already start satisfied — keep the honest immediate report.
  if (equationCount > freeDof) {
    if (freeVars.length === 0) {
      const startResidual = Math.sqrt(totalEnergy(activeMates, transforms))
      if (startResidual < cfg.residualTol) {
        return { transforms, report: buildReport(activeMates, transforms, 0, 'converged') }
      }
      return {
        transforms,
        report: buildReport(activeMates, transforms, 0, 'over_constrained', {
          conflictingConstraintIds: conflictingMateIds(activeMates, transforms)
        })
      }
    }
    const loop = runMateConvergenceLoop(activeMates, transforms, freeVars, cfg, energyTol)
    if (loop.status === 'converged') {
      // The surplus equations were consistent (redundant) — the system solved.
      return { transforms, report: buildReport(activeMates, transforms, loop.iterations, 'converged') }
    }
    // Could not satisfy all equations: report the irreducible conflict honestly.
    const conflicting = conflictingMateIds(activeMates, transforms)
    return {
      transforms,
      report: buildReport(activeMates, transforms, loop.iterations, 'over_constrained', {
        // Fall back to all ids if the floor filtered everything (defensive: never empty).
        conflictingConstraintIds: conflicting.length > 0 ? conflicting : activeMates.map((m) => m.id)
      })
    }
  }
  if (equationCount < freeDof) {
    return {
      transforms,
      report: buildReport(activeMates, transforms, 0, 'under_constrained', {
        freeVariableCount: freeDof - equationCount
      })
    }
  }

  // E === F: run the convergence loop (gradient descent with backtracking, mirroring solver2d).
  const { iterations, status } = runMateConvergenceLoop(activeMates, transforms, freeVars, cfg, energyTol)
  return { transforms, report: buildReport(activeMates, transforms, iterations, status) }
}
