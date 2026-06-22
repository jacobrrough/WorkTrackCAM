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
 * Free-variable model: each **non-grounded** component contributes free variables. A `joint`-bearing
 * component contributes its joint's scalar DOF (a `revolute` wires its single rotation about
 * `revolutePreviewAxis`; other joint kinds are DOF-counted but not yet wired). A **no-joint free
 * body** is full 6-DOF: it always exposes its 3 translational handles (x/y/z), and additionally
 * exposes its 3 rotational handles (rx/ry/rz) **only when an active mate actually constrains its
 * orientation** — a directional mate (angle / tangent), or a positional mate acting on an offset
 * feature of that body. A body whose mates leave rotation free (e.g. a single coincident on its
 * origin) keeps translation-only handles: its rotational DOF are an unconstrained null-space the
 * count heuristic must not pad, and the anti-singularity seed then has no rotational handle to
 * drift. Grounded components are fixed.
 *
 * Over/under-constrained detection runs the least-squares solve FIRST, then classifies on the
 * solved pose using the **residual** and the **rank of the residual Jacobian** `∂r/∂v` — a refinement
 * of the old raw constraint-count heuristic. With `F` = total free DOF (a no-joint body counts 3
 * when its rotation is unconstrained, 6 once an orientation mate activates it), `E` = total scalar
 * equations, and `rank` = independent constraints the handles can act on (≤ F):
 *   • residual ≈ 0 and `rank == F` → **converged** (includes a *consistent* over-determination such
 *     as 3-point rigid registration, `E > F` but rank `F` — residual-gated, not flagged conflicting);
 *   • residual ≈ 0 and `rank < F` → **under_constrained** with `F - rank` free DOF (catches a count-
 *     balanced but rank-deficient system, e.g. two offset coincidents leaving a free spin);
 *   • residual > 0 and `E > F` → **over_constrained** (surplus equations genuinely conflict);
 *   • residual > 0 and `rank < F` → **under_constrained**; otherwise the loop's terminal status.
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

/**
 * Canonicalize an angle (degrees) to the half-open range **(-180, 180]** for REPORTING. Because every
 * residual and forward-kinematics term reads angles through 360°-periodic `cos`/`sin`, reducing an
 * Euler angle by whole turns is geometrically a no-op — this only tidies the *reported* number (a
 * hinge that solved to 1710° reports −90°). Values already in range are returned byte-identically so
 * exact-equality assertions on untouched poses (e.g. `rxDeg === 0`) still hold.
 */
function normalizeAngleDeg(deg: number): number {
  if (deg > -180 && deg <= 180) return deg
  if (!Number.isFinite(deg)) return deg
  // Reduce modulo 360 into (-180, 180]: shift to [0,360), wrap, then fold the (180,360) half down.
  let r = deg % 360
  if (r <= -180) r += 360
  else if (r > 180) r -= 360
  return r
}

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
      // No joint kind: a free-floating body. This returns its 3 *translational* DOF only; the
      // 3 rotational DOF of a 6-DOF free body are added in `solveMateConstraints` (and only when
      // an active mate constrains the body's orientation — see `bodyHasRotationalConstraint`).
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

/** True when a feature's local point is offset from its body origin (any non-zero coordinate). */
function featurePointIsOffset(f: AssemblyMateFeature): boolean {
  const [x, y, z] = featurePoint(f)
  return x !== 0 || y !== 0 || z !== 0
}

/**
 * Does this mate's residual depend on `bodyId`'s **orientation** — i.e. would moving the body's
 * rotational DOF change the residual? Decides whether a no-joint free body should expose its 3
 * rotational handles (and have its 3 rotational DOF counted in `F`).
 *
 * Matches the residual math in {@link mateSquaredResidual} exactly:
 * - `angle` / `tangent`: directional — both feature axes rotate with their owners, so either part's
 *   rotation always changes the residual.
 * - `flush` / `concentric`: the residual is measured along feature1's axis, which rotates with
 *   part1 → part1's rotation always matters; part2 only enters through its (possibly offset) point.
 * - `coincident` / `distance`: a pure point residual → a body's rotation matters only when its own
 *   feature point is offset from its origin (rotating about a point at the origin moves nothing).
 *
 * A body pinned only through rotation-invariant residuals keeps its rotation a free null-space, so
 * its rotational DOF stay unwired and uncounted (the count heuristic stays balanced; the seed has
 * no rotational handle to perturb).
 */
function mateConstrainsRotationOf(mate: AssemblyMateConstraint, bodyId: string): boolean {
  const isPart1 = mate.part1Id === bodyId
  const isPart2 = mate.part2Id === bodyId
  if (!isPart1 && !isPart2) return false
  switch (mate.kind) {
    case 'angle':
    case 'tangent':
      return true
    case 'flush':
    case 'concentric':
      if (isPart1) return true
      return featurePointIsOffset(mate.feature2)
    case 'coincident':
    case 'distance':
      return (
        (isPart1 && featurePointIsOffset(mate.feature1)) ||
        (isPart2 && featurePointIsOffset(mate.feature2))
      )
    default:
      return false
  }
}

/** True when any active mate constrains `bodyId`'s orientation (see {@link mateConstrainsRotationOf}). */
function bodyHasRotationalConstraint(bodyId: string, mates: AssemblyMateConstraint[]): boolean {
  return mates.some((m) => mateConstrainsRotationOf(m, bodyId))
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

/**
 * Scalar residual **components** for one mate at a given transform set. The energy is `Σ component²`
 * and the residual-vector Jacobian (used for rank classification) is built by differencing these,
 * so this is the single source of truth for both. Component counts match {@link mateEquationCount}
 * except `concentric`, which returns its 3-vector perpendicular offset (rank ≤ 2 by construction).
 */
function mateResidualVector(
  mate: AssemblyMateConstraint,
  transforms: Map<string, AssemblyTransform6>
): number[] {
  const t1 = transforms.get(mate.part1Id)
  const t2 = transforms.get(mate.part2Id)
  if (!t1 || !t2) return []
  switch (mate.kind) {
    case 'coincident': {
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
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
      return [dx - along * axis[0], dy - along * axis[1], dz - along * axis[2]]
    }
    case 'distance': {
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      const target = mate.value ?? 0
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      return [d - target]
    }
    case 'flush': {
      // One equation: feature points share their coordinate along feature1's axis.
      const a = worldFeaturePoint(t1, featurePoint(mate.feature1))
      const b = worldFeaturePoint(t2, featurePoint(mate.feature2))
      const axis = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      return [(b[0] - a[0]) * axis[0] + (b[1] - a[1]) * axis[1] + (b[2] - a[2]) * axis[2]]
    }
    case 'angle': {
      const u = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      const v = normalize(worldFeatureAxis(t2, featureAxisUnit(mate.feature2)))
      const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      const target = Math.cos((mate.value ?? 0) * DEG2RAD)
      return [dot - target]
    }
    case 'tangent': {
      // Perpendicular contact: feature axes orthogonal → cos(angle) = 0.
      const u = normalize(worldFeatureAxis(t1, featureAxisUnit(mate.feature1)))
      const v = normalize(worldFeatureAxis(t2, featureAxisUnit(mate.feature2)))
      const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      return [dot]
    }
    default:
      return []
  }
}

/** Squared residual contribution for one mate (`Σ component²`), summed into the solve energy. */
function mateSquaredResidual(
  mate: AssemblyMateConstraint,
  transforms: Map<string, AssemblyTransform6>
): number {
  let sum = 0
  for (const c of mateResidualVector(mate, transforms)) sum += c * c
  return sum
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
 * One free-variable handle: which component, and which DOF of its transform the loop may move.
 * Translational axes (`x`/`y`/`z`) move `transform.{x,y,z}` directly; rotational axes
 * (`rx`/`ry`/`rz`) move the corresponding Euler angle (read/written in RADIANS — see
 * {@link readVar}/{@link writeVar} — so a rotational handle's gradient is the same O(1) scale as a
 * translational one and a single learning rate converges both). A no-joint free body contributes
 * x/y/z always and rx/ry/rz once an orientation mate activates them; a `revolute` contributes the
 * single rotational handle about its `revolutePreviewAxis`.
 */
type FreeVarAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'
type FreeVar = { componentId: string; axis: FreeVarAxis }

/**
 * Translational handle for a joint's world cardinal preview axis (`x|y|z` → `x|y|z`, default +z).
 * Foundation simplification: the same world-cardinal model the revolute branch uses — parent-frame /
 * arbitrary axes are intentionally out of scope here (see the module header).
 */
function translationalHandleAxis(ax: AssemblyComponent['sliderPreviewAxis']): FreeVarAxis {
  return ax === 'x' ? 'x' : ax === 'y' ? 'y' : 'z'
}

/** Rotational handle for a joint's world cardinal preview axis (`x|y|z` → `rx|ry|rz`, default +z). */
function rotationalHandleAxis(ax: AssemblyComponent['revolutePreviewAxis']): FreeVarAxis {
  return ax === 'x' ? 'rx' : ax === 'y' ? 'ry' : 'rz'
}

/**
 * The two translational handles spanning the plane orthogonal to a planar joint's world cardinal
 * normal axis: normal `z` → `[x, y]`, `x` → `[y, z]`, `y` → `[x, z]` (default normal +z). These are
 * the in-plane DOF a planar mate can drive (the foundation world-cardinal simplification).
 */
function planarInPlaneHandleAxes(
  normal: AssemblyComponent['planarPreviewNormalAxis']
): [FreeVarAxis, FreeVarAxis] {
  if (normal === 'x') return ['y', 'z']
  if (normal === 'y') return ['x', 'z']
  return ['x', 'y']
}

/**
 * Native-unit **delta bounds** for one wired handle, captured at wire time. `lo`/`hi` are in the
 * SAME units the loop reads/writes the handle in (radians for `rx/ry/rz`, mm for `x/y/z`), expressed
 * as an offset from the handle's start value (the joint scalar is a displacement from the component's
 * stored transform — matching the post-solve clamp in `assembly-kinematics-core`). `start` is filled
 * in `solveMateConstraints` once the initial transforms exist; `null` means the handle is unbounded.
 */
type HandleBounds = { lo: number; hi: number } | null

/**
 * Resolve a joint limit pair into native-unit delta bounds, mirroring the limit-resolution chain in
 * `assembly-kinematics-core` (jointLimits → legacy preview field → none). Returns `null` when NO
 * explicit limit is set on either source, so an unconstrained handle stays unbounded (the solver
 * must not invent a ±180° / ±1e6 cap that the kinematics layer only applies as a hard fallback).
 * `scale` converts the stored degree/mm limit into the handle's native unit (DEG2RAD for rotational
 * handles, 1 for translational).
 */
function resolveHandleBounds(
  limit: number | undefined,
  legacy: number | undefined,
  other: number | undefined,
  otherLegacy: number | undefined,
  scale: number
): HandleBounds {
  const min = limit ?? legacy
  const max = other ?? otherLegacy
  if (min == null && max == null) return null
  // Only one side specified → bound that side, leave the other open (huge sentinel in native units).
  const open = 1e12
  const loRaw = (min ?? -open / scale) * scale
  const hiRaw = (max ?? open / scale) * scale
  return { lo: Math.min(loRaw, hiRaw), hi: Math.max(loRaw, hiRaw) }
}

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

/** All active mates' residual components concatenated into one vector (the stacked residual r). */
function stackResidualVectors(
  mates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>
): number[] {
  const out: number[] = []
  for (const m of mates) {
    for (const c of mateResidualVector(m, transforms)) out.push(c)
  }
  return out
}

/**
 * Numerical rank of the residual-vector Jacobian `∂r/∂v` (rows = residual components, cols = the
 * movable handles `freeVars`) at the current pose, via central differences + Gaussian elimination
 * with a relative pivot tolerance.
 *
 * This is the **effective number of independent constraints** the solver can actually act on, which
 * refines the constraint-COUNT heuristic: a system can be count-balanced (`E === F`) yet rank-
 * deficient (e.g. two coincident mates on offset points pin a line but leave a free spin — 6
 * equations, 6 DOF, rank 5). `F - rank` is then the genuine free-DOF count. Components a handle
 * does not influence difference to exact zero (the term is structurally absent, not noisy), so the
 * matrix is clean and the rank gap between dependent and independent rows is wide.
 */
/** Residual-vector Jacobian `∂r/∂v` (rows = residual components, cols = handles) via central diff. */
function buildResidualJacobian(
  mates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>,
  freeVars: FreeVar[],
  eps: number
): number[][] {
  const nComp = stackResidualVectors(mates, transforms).length
  if (nComp === 0 || freeVars.length === 0) return []
  const j: number[][] = Array.from({ length: nComp }, () => new Array<number>(freeVars.length).fill(0))
  for (let h = 0; h < freeVars.length; h++) {
    const fv = freeVars[h]!
    const v0 = readVar(transforms, fv)
    writeVar(transforms, fv, v0 + eps)
    const plus = stackResidualVectors(mates, transforms)
    writeVar(transforms, fv, v0 - eps)
    const minus = stackResidualVectors(mates, transforms)
    writeVar(transforms, fv, v0)
    for (let c = 0; c < nComp; c++) j[c]![h] = (plus[c]! - minus[c]!) / (2 * eps)
  }
  return j
}

function residualJacobianRank(
  mates: AssemblyMateConstraint[],
  transforms: Map<string, AssemblyTransform6>,
  freeVars: FreeVar[],
  eps: number
): number {
  if (freeVars.length === 0) return 0
  return matrixRank(buildResidualJacobian(mates, transforms, freeVars, eps))
}

/**
 * Solve the dense linear system `M x = b` (M is n×n) by Gauss-Jordan elimination with partial
 * pivoting. Returns `null` if M is numerically singular. `n` is tiny here (the free-DOF count), so
 * a direct dense solve is both fast and deterministic — used for the Levenberg-Marquardt normal
 * equations.
 *
 * NOTE: this dense elimination is O(F³) in the free-DOF count F (and JᵀJ assembly is O(E·F²)); for a
 * very large assembly (hundreds of free DOF) a sparse linear solver would scale better — intentionally
 * out of scope at foundation, where F is small and a dense solve keeps the code simple + deterministic.
 */
function solveLinearSystem(m: number[][], b: number[]): number[] | null {
  const n = b.length
  if (n === 0) return []
  const a = m.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r
    }
    if (Math.abs(a[pivot]![col]!) < 1e-14) return null
    const tmp = a[col]!
    a[col] = a[pivot]!
    a[pivot] = tmp
    const pivVal = a[col]![col]!
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = a[r]![col]! / pivVal
      if (factor === 0) continue
      for (let c = col; c <= n; c++) a[r]![c]! -= factor * a[col]![c]!
    }
  }
  // After full Gauss-Jordan the matrix is diagonal: x_i = rhs_i / pivot_i = row[n] / row[i].
  return a.map((row, i) => row[n]! / row[i]!)
}

/** Rank of a dense matrix via Gaussian elimination with partial pivoting + relative tolerance. */
function matrixRank(rows: number[][]): number {
  const m = rows.map((r) => [...r])
  const nRows = m.length
  const nCols = nRows > 0 ? m[0]!.length : 0
  if (nRows === 0 || nCols === 0) return 0
  // Tolerance scales with the largest entry (handle gradients grow with feature lever arm).
  let maxAbs = 0
  for (const r of m) for (const v of r) {
    const a = Math.abs(v)
    if (a > maxAbs) maxAbs = a
  }
  const tol = Math.max(maxAbs * 1e-9, 1e-12)
  let rank = 0
  for (let col = 0; col < nCols && rank < nRows; col++) {
    let pivot = rank
    for (let r = rank + 1; r < nRows; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r
    }
    if (Math.abs(m[pivot]![col]!) <= tol) continue
    const tmp = m[rank]!
    m[rank] = m[pivot]!
    m[pivot] = tmp
    const pivVal = m[rank]![col]!
    for (let r = rank + 1; r < nRows; r++) {
      const factor = m[r]![col]! / pivVal
      if (factor === 0) continue
      for (let c = col; c < nCols; c++) m[r]![c]! -= factor * m[rank]![c]!
    }
    rank++
  }
  return rank
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

/** Result of one least-squares solve pass over a (possibly reduced) mate set — pre-classification. */
type MateSolvePass = {
  transforms: Map<string, AssemblyTransform6>
  activeMates: AssemblyMateConstraint[]
  finalEnergy: number
  freeDof: number
  equationCount: number
  rank: number
  iterations: number
  /** Loop's terminal status before the rank/residual classification refines it. */
  loopStatus: SolverConvergenceStatus
  /** Component ids the solver wired a handle for (the parts it could have moved). */
  movableIds: Set<string>
}

/**
 * Run the Levenberg-Marquardt least-squares solve for a mate set and return the solved transforms +
 * the raw quantities the classifier needs — WITHOUT classifying. Factored out of
 * {@link solveMateConstraints} so the over-constrained conflict analysis can re-run the solve on
 * reduced mate subsets to find the minimal conflicting set, with no recursion into the classifier.
 *
 * The `mates` passed here are already-active (suppressed filtered out by the caller); this function
 * re-sorts them deterministically and rebuilds the free-variable / limit wiring for that exact subset.
 */
function runMateSolve(
  sortedComponents: AssemblyComponent[],
  mates: AssemblyMateConstraint[],
  cfg: SolverConfig
): MateSolvePass {
  const energyTol = cfg.residualTol * cfg.residualTol
  const activeMates = [...mates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Initial transforms = each component's stored placement.
  const transforms = new Map<string, AssemblyTransform6>()
  for (const c of sortedComponents) transforms.set(c.id, cloneTransform(c.transform))

  // Restrict the solve to components actually referenced by an active mate (others are inert).
  const referenced = new Set<string>()
  for (const m of activeMates) {
    referenced.add(m.part1Id)
    referenced.add(m.part2Id)
  }

  // Free DOF (F) and the movable handles (translational always; rotational when activated).
  // `boundsDefs` is built in LOCK-STEP with `freeVars` (one entry per handle) and holds each handle's
  // absolute clamp range (in the handle's native unit) once the joint's limits are applied to the
  // handle's start value. `null` = unbounded. The `pushHandle` closure keeps the two arrays aligned.
  let freeDof = 0
  const freeVars: FreeVar[] = []
  const boundsDefs: HandleBounds[] = []
  const pushHandle = (fv: FreeVar, deltaBounds: HandleBounds): void => {
    freeVars.push(fv)
    if (deltaBounds == null) {
      boundsDefs.push(null)
      return
    }
    // The joint scalar is a displacement from the stored transform, so the absolute clamp range is
    // the start value (current handle value = stored transform component) plus the delta bounds.
    const start = readVar(transforms, fv)
    boundsDefs.push({ lo: start + deltaBounds.lo, hi: start + deltaBounds.hi })
  }
  for (const c of sortedComponents) {
    if (c.grounded) continue
    const dof = jointDof(c.joint)
    freeDof += dof
    if (!referenced.has(c.id)) continue
    const lim = c.jointLimits
    if (c.joint == null) {
      // No-joint, mate-referenced: a full 6-DOF free body. Translational handles always; a free body
      // has no joint limits, so all six handles are unbounded.
      pushHandle({ componentId: c.id, axis: 'x' }, null)
      pushHandle({ componentId: c.id, axis: 'y' }, null)
      pushHandle({ componentId: c.id, axis: 'z' }, null)
      // Rotational handles + the matching 3 rotational DOF are added ONLY when an active mate
      // actually constrains this body's orientation (a directional mate, or a positional mate on
      // an offset feature). Otherwise rotation is an unconstrained null-space: wiring it would (a)
      // inflate F and flip balanced positional cases to under_constrained, and (b) give the 2°
      // anti-singularity seed a handle to drift the body along that null-space. `jointDof` already
      // counted the 3 translational DOF; here we add the 3 rotational DOF to keep F and the handle
      // set in lock-step.
      if (bodyHasRotationalConstraint(c.id, activeMates)) {
        pushHandle({ componentId: c.id, axis: 'rx' }, null)
        pushHandle({ componentId: c.id, axis: 'ry' }, null)
        pushHandle({ componentId: c.id, axis: 'rz' }, null)
        freeDof += 3
      }
    } else if (c.joint === 'revolute') {
      // Revolute (1 rotational DOF): wire the single rotation about the joint's
      // world axis (`revolutePreviewAxis`, default +Z) as a movable handle, so an
      // angle/tangent mate on a hinge converges (E===F=1) instead of stalling at
      // max_iterations with no handle to move. Limits (scalarMin/MaxDeg) bound the angle delta.
      pushHandle(
        { componentId: c.id, axis: rotationalHandleAxis(c.revolutePreviewAxis) },
        resolveHandleBounds(lim?.scalarMinDeg, c.revolutePreviewMinDeg, lim?.scalarMaxDeg, c.revolutePreviewMaxDeg, DEG2RAD)
      )
    } else if (c.joint === 'slider') {
      // Slider (1 translational DOF): one handle along `sliderPreviewAxis` (world cardinal,
      // default +Z) so e.g. a slider + distance mate reaches its target offset along the slide.
      pushHandle(
        { componentId: c.id, axis: translationalHandleAxis(c.sliderPreviewAxis) },
        resolveHandleBounds(lim?.scalarMinMm, c.sliderPreviewMinMm, lim?.scalarMaxMm, c.sliderPreviewMaxMm, 1)
      )
    } else if (c.joint === 'cylindrical') {
      // Cylindrical (1 translational + 1 rotational DOF) about the SAME `cylindricalPreviewAxis`:
      // a slide handle and a spin handle, so it can satisfy both a distance and an angle mate.
      pushHandle(
        { componentId: c.id, axis: translationalHandleAxis(c.cylindricalPreviewAxis) },
        resolveHandleBounds(lim?.slideMinMm, c.cylindricalPreviewSlideMinMm, lim?.slideMaxMm, c.cylindricalPreviewSlideMaxMm, 1)
      )
      pushHandle(
        { componentId: c.id, axis: rotationalHandleAxis(c.cylindricalPreviewAxis) },
        resolveHandleBounds(lim?.spinMinDeg, c.cylindricalPreviewSpinMinDeg, lim?.spinMaxDeg, c.cylindricalPreviewSpinMaxDeg, DEG2RAD)
      )
    } else if (c.joint === 'planar') {
      // Planar (2 translational DOF): the two in-plane handles orthogonal to
      // `planarPreviewNormalAxis` (world cardinal, default normal +Z → handles X/Y). U-limits bound
      // the first in-plane handle, V-limits the second (the foundation world-cardinal U/V mapping).
      const [u, v] = planarInPlaneHandleAxes(c.planarPreviewNormalAxis)
      pushHandle(
        { componentId: c.id, axis: u },
        resolveHandleBounds(lim?.uMinMm, c.planarPreviewUMinMm, lim?.uMaxMm, c.planarPreviewUMaxMm, 1)
      )
      pushHandle(
        { componentId: c.id, axis: v },
        resolveHandleBounds(lim?.vMinMm, c.planarPreviewVMinMm, lim?.vMaxMm, c.planarPreviewVMaxMm, 1)
      )
    } else if (c.joint === 'ball') {
      // Ball (3 rotational DOF): rx, ry, rz handles so any orientation mate target is reachable.
      pushHandle(
        { componentId: c.id, axis: 'rx' },
        resolveHandleBounds(lim?.rxMinDeg, c.ballPreviewRxMinDeg, lim?.rxMaxDeg, c.ballPreviewRxMaxDeg, DEG2RAD)
      )
      pushHandle(
        { componentId: c.id, axis: 'ry' },
        resolveHandleBounds(lim?.ryMinDeg, c.ballPreviewRyMinDeg, lim?.ryMaxDeg, c.ballPreviewRyMaxDeg, DEG2RAD)
      )
      pushHandle(
        { componentId: c.id, axis: 'rz' },
        resolveHandleBounds(lim?.rzMinDeg, c.ballPreviewRzMinDeg, lim?.rzMaxDeg, c.ballPreviewRzMaxDeg, DEG2RAD)
      )
    } else if (c.joint === 'universal') {
      // Universal (2 rotational DOF): one handle about each Cardan axis
      // (`universalPreviewAxis1` default +Z, `universalPreviewAxis2` default +X).
      pushHandle(
        { componentId: c.id, axis: rotationalHandleAxis(c.universalPreviewAxis1 ?? 'z') },
        resolveHandleBounds(lim?.angle1MinDeg, c.universalPreviewAngle1MinDeg, lim?.angle1MaxDeg, c.universalPreviewAngle1MaxDeg, DEG2RAD)
      )
      pushHandle(
        { componentId: c.id, axis: rotationalHandleAxis(c.universalPreviewAxis2 ?? 'x') },
        resolveHandleBounds(lim?.angle2MinDeg, c.universalPreviewAngle2MinDeg, lim?.angle2MaxDeg, c.universalPreviewAngle2MaxDeg, DEG2RAD)
      )
    }
    // Note: `freeDof` already counted each joint's scalar DOF via `jointDof(c.joint)` above; the
    // branches here only wire the matching handles, keeping `freeDof` and `freeVars` in lock-step.
  }

  // Project every wired handle into its joint limits (no-op for unbounded handles). Applied after the
  // anti-singularity seed and after each accepted LM step so the solve NEVER lands a joint outside its
  // range — the post-hoc clamp in `assembly-kinematics-core` would otherwise break a satisfied mate.
  const clampHandlesToLimits = (): void => {
    for (let i = 0; i < freeVars.length; i++) {
      const b = boundsDefs[i]
      if (b == null) continue
      const fv = freeVars[i]!
      const v = readVar(transforms, fv)
      const clamped = Math.max(b.lo, Math.min(b.hi, v))
      if (clamped !== v) writeVar(transforms, fv, clamped)
    }
  }

  // Constraint equation count (E).
  let equationCount = 0
  for (const m of activeMates) equationCount += mateEquationCount(m.kind)

  // No active constraints: nothing to solve. The caller classifies (under_constrained iff free DOF).
  if (activeMates.length === 0) {
    return {
      transforms,
      activeMates,
      finalEnergy: 0,
      freeDof,
      equationCount,
      rank: 0,
      iterations: 0,
      loopStatus: 'converged',
      movableIds: new Set(freeVars.map((fv) => fv.componentId))
    }
  }

  // NOTE: over/under classification is deferred until AFTER the solve (see the rank-based block at
  // the end). We always run the least-squares loop first so that (a) a *consistent* over-determined
  // system — e.g. 3-point rigid registration, E=9 > F=6 but rank 6 — converges to zero residual and
  // is reported converged (residual-gated, not flagged conflicting by raw count), and (b) a count-
  // balanced but rank-deficient system is caught by the Jacobian rank rather than mislabelled.

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
    // Keep the seed inside the joint range (a tiny ±2° nudge must not jump a tight limit).
    clampHandlesToLimits()
  }

  // Least-squares loop: Levenberg-Marquardt on the residual vector. Each iteration builds the
  // residual Jacobian `J` and solves the damped normal equations `(JᵀJ + λ·diag(JᵀJ)) Δ = -Jᵀr`.
  // This is far better conditioned than plain gradient descent for mates that couple translation
  // and rotation (offset features, point-cloud registration), where a single learning rate either
  // overshoots rotation or crawls on translation — LM converges those in a handful of iterations.
  // λ adapts: shrink it on an accepted step (toward fast Gauss-Newton), grow it on a rejected one
  // (toward safe gradient descent). Marquardt's diagonal scaling keeps it robust to mixed units;
  // the damping also tolerates a rank-deficient JᵀJ (under-constrained systems still take a step).
  let lambda = 1e-3
  let iterations = 0
  let status: SolverConvergenceStatus = 'max_iterations_reached'

  for (let it = 0; it < cfg.maxIterations; it++) {
    iterations = it + 1
    const e0 = totalEnergy(activeMates, transforms)
    if (e0 < energyTol) {
      status = 'converged'
      break
    }
    if (!Number.isFinite(e0)) {
      status = 'diverged'
      break
    }
    if (freeVars.length === 0) {
      // No movable handles (e.g. all DOF are joint scalars not yet wired): can't reduce energy.
      break
    }

    const n = freeVars.length
    const r0 = stackResidualVectors(activeMates, transforms)
    const jac = buildResidualJacobian(activeMates, transforms, freeVars, cfg.eps)
    // Normal equations: ata = JᵀJ (n×n), g = Jᵀr (n).
    const ata: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    const g = new Array<number>(n).fill(0)
    for (let a = 0; a < n; a++) {
      for (let b = a; b < n; b++) {
        let s = 0
        for (let c = 0; c < jac.length; c++) s += jac[c]![a]! * jac[c]![b]!
        ata[a]![b] = s
        ata[b]![a] = s
      }
      let gi = 0
      for (let c = 0; c < jac.length; c++) gi += jac[c]![a]! * r0[c]!
      g[a] = gi
    }
    // Marquardt diagonal scale (floored so a zero-gradient handle is still dampable).
    let maxDiag = 0
    for (let a = 0; a < n; a++) maxDiag = Math.max(maxDiag, ata[a]![a]!)
    const diagScale = maxDiag > 0 ? maxDiag : 1

    const snapshot = new Map<string, AssemblyTransform6>()
    for (const [id, t] of transforms) snapshot.set(id, { ...t })

    // Try LM steps, increasing λ until one lowers the energy (or λ saturates).
    let accepted = false
    for (let attempt = 0; attempt < 40; attempt++) {
      const damped = ata.map((row, a) => {
        const copy = [...row]
        copy[a] = copy[a]! + lambda * Math.max(ata[a]![a]!, diagScale * 1e-6)
        return copy
      })
      const neg = g.map((v) => -v)
      const delta = solveLinearSystem(damped, neg)
      if (delta && delta.every((d) => Number.isFinite(d))) {
        for (const [id, t] of snapshot) transforms.set(id, { ...t })
        for (let i = 0; i < n; i++) {
          const fv = freeVars[i]!
          writeVar(transforms, fv, readVar(transforms, fv) + delta[i]!)
        }
        // Projected step: clamp every handle into its joint range BEFORE judging the step, so the
        // accepted pose is feasible. An unreachable-within-limits target then keeps a positive
        // residual and is reported honestly (max_iterations_reached / under_constrained), never a
        // false 'converged' at an out-of-range pose the kinematics clamp would later undo.
        clampHandlesToLimits()
        const e1 = totalEnergy(activeMates, transforms)
        if (Number.isFinite(e1) && e1 < e0) {
          accepted = true
          lambda = Math.max(lambda * 0.3, 1e-12)
          break
        }
      }
      // Rejected (no improvement, or singular even when damped): restore and damp harder.
      for (const [id, t] of snapshot) transforms.set(id, { ...t })
      lambda = Math.min(lambda * 5, 1e12)
    }
    if (!accepted) {
      // No downhill step even at maximum damping → a (local) least-squares minimum. The
      // rank/residual classification below decides converged vs under-/over-constrained.
      break
    }
  }

  const finalEnergy = totalEnergy(activeMates, transforms)
  const rank = residualJacobianRank(activeMates, transforms, freeVars, cfg.eps)
  return {
    transforms,
    activeMates,
    finalEnergy,
    freeDof,
    equationCount,
    rank,
    iterations,
    loopStatus: status,
    movableIds: new Set(freeVars.map((fv) => fv.componentId))
  }
}

/**
 * Narrow an over-constrained system's conflicting set to the minimal culprit subset, deterministically.
 *
 * Greedy **leave-one-out**: for each active mate (in sorted-id order), re-solve with just that mate
 * suppressed; if the remaining mates then reach residual < tol, that mate is part of the conflict
 * (removing it resolves the over-determination), so it is flagged. An *innocent*, independently-
 * satisfiable mate is excluded — suppressing it leaves the conflict intact, so the reduced solve
 * still fails. If no single removal resolves the system (a deeper ≥3-way conflict that needs two
 * removals), fall back to the full active set so the report never under-reports the culprits.
 *
 * Deterministic: the candidate order is the sorted active mates and each probe is a fresh
 * {@link runMateSolve}. Cost is O(E) extra solves of an (E−1)-mate system — fine at foundation scale.
 */
function findConflictingMateIds(
  sortedComponents: AssemblyComponent[],
  activeMates: AssemblyMateConstraint[],
  cfg: SolverConfig
): string[] {
  const energyTol = cfg.residualTol * cfg.residualTol
  const culprits: string[] = []
  for (const candidate of activeMates) {
    const reduced = activeMates.filter((m) => m.id !== candidate.id)
    if (reduced.length === 0) {
      // Removing the only mate trivially "resolves" it — a lone mate cannot be over-constrained, so
      // this branch is unreachable in practice; treat the mate as a culprit for safety.
      culprits.push(candidate.id)
      continue
    }
    const pass = runMateSolve(sortedComponents, reduced, cfg)
    if (pass.finalEnergy < energyTol) culprits.push(candidate.id)
  }
  // Fallback: if the leave-one-out probe found no single resolving removal, report the whole set.
  return culprits.length > 0 ? culprits : activeMates.map((m) => m.id)
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

  // Deterministic ordering. Suppressed mates are excluded from the active set.
  const sortedComponents = [...components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const activeMatesIn = mates.filter((m) => m.suppress !== true)

  const pass = runMateSolve(sortedComponents, activeMatesIn, cfg)
  const { transforms, activeMates, finalEnergy, freeDof, equationCount, rank } = pass

  // Canonicalize the REPORTED Euler angles of every part the solver moved to (-180, 180] (e.g. a hinge
  // that wound to 1710° reports −90°). This runs at report time only and is geometrically a no-op —
  // all residuals/FK read angles through 360°-periodic cos/sin — so it never alters solved geometry,
  // and the classification above used the pre-normalized `finalEnergy`/`rank` (identical either way).
  for (const id of pass.movableIds) {
    const t = transforms.get(id)
    if (!t) continue
    transforms.set(id, {
      ...t,
      rxDeg: normalizeAngleDeg(t.rxDeg),
      ryDeg: normalizeAngleDeg(t.ryDeg),
      rzDeg: normalizeAngleDeg(t.rzDeg)
    })
  }

  // No active constraints: under-constrained iff there are free DOF.
  if (activeMates.length === 0) {
    const status: SolverConvergenceStatus = freeDof > 0 ? 'under_constrained' : 'converged'
    return {
      transforms,
      report: buildReport(activeMates, transforms, 0, status, {
        freeVariableCount: freeDof > 0 ? freeDof : undefined
      })
    }
  }

  // ── Classify on the SOLVED pose (residual + Jacobian rank), refining the count heuristic ──
  // `rank` = the effective number of independent constraints the handles can act on (≤ freeDof).
  //   residual ≈ 0  → solved. rank < freeDof means free DOF remain (e.g. a free spin about a
  //                   pinned line) → under_constrained; otherwise converged.
  //   residual > 0  → some mates can't be met. An over-determined-by-count system (E > F) has
  //                   surplus equations that conflict → over_constrained (a *consistent* over-
  //                   determination already hit the residual≈0 branch); else rank<freeDof →
  //                   under_constrained; else the loop's terminal status (max_iterations / diverged).
  const extra: { conflictingConstraintIds?: string[]; freeVariableCount?: number } = {}
  let finalStatus: SolverConvergenceStatus
  if (finalEnergy < energyTol) {
    if (rank < freeDof) {
      finalStatus = 'under_constrained'
      extra.freeVariableCount = freeDof - rank
    } else {
      finalStatus = 'converged'
    }
  } else if (equationCount > freeDof) {
    finalStatus = 'over_constrained'
    // Narrow to the minimal conflicting subset rather than blaming every active mate.
    extra.conflictingConstraintIds = findConflictingMateIds(sortedComponents, activeMates, cfg)
  } else if (rank < freeDof) {
    finalStatus = 'under_constrained'
    extra.freeVariableCount = freeDof - rank
  } else {
    finalStatus = pass.loopStatus
  }

  return { transforms, report: buildReport(activeMates, transforms, pass.iterations, finalStatus, extra) }
}
