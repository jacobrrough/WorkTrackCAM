# Plan — V2: assembly mate solver convergence iterations

> **Stack:** F (V2-era) · **Status:** 🔮 V2-era · **Effort:** L (foundation+UI) / XL (full SE(3) vision)
> **Machines:** CAD design · **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only

Iterate the assembly mate/constraint solver to **true convergence**: a real solve loop with a residual
tolerance, a max-iteration cap, residual/iteration diagnostics, and over/under-constrained detection —
replacing today's single-pass forward kinematics (TS) and black-box one-shot solve (Python). Deterministic,
no `any`, no `.wtcam` breakage.

---

## 1. Current state

Three separate solver domains:

| Domain | Location | Library | Convergence today |
|---|---|---|---|
| 2D sketch constraints | `engines/cad/sketch_solver.py` | planegcs | `solve()` + `diagnose()` (over/under, `dof`) — already iterative |
| 3D assembly FK preview | `src/shared/assembly-kinematics-core.ts` | none | **single-pass**, clamp-only |
| 3D assembly mates (CadQuery) | `engines/cad/cadquery_assembly.py` | `cq.Assembly.solve()` → OCC | **single** black-box call |

- **`assembly-kinematics-core.ts:37`** `solveAssemblyKinematics(active)` → delegates to
  `computeAssemblyKinematicPreviewTransforms` (`assembly-viewport-math.ts:307`, single-pass FK, no mate
  enforcement), then a one-pass DOF clamp. `diagnostics.residuals` is hardcoded `[]` (`:88`). **No loop, no
  convergence, no residual, no over/under detection.** Only TS solve call site.
- **IPC:** `ipc-modeling.ts` `assembly:solve` (`:435`), `assembly:simulate` (`:446`, returns N identical poses),
  `assembly:interferenceCheckSimulated` (`:420`). Not exposed in preload yet (no renderer caller).
- **Schema:** `assembly-schema.ts` (977 lines) — components have `joint`/`jointState`/`jointLimits`/
  `linkedInstanceId`/`motionLinkKind` (an explicit "stub" with no solver, no geometry). **No persisted mate
  constraint with geometry**; `assemblyFileSchema` has **no** `mates[]`. `project-schema.ts:109` only has
  `designModels[]`.
- **Python:** `cadquery_assembly.py:1149` `_solve_with_mates` → bare `assembly.solve()`; failure is binary
  `mate_solve_failed`; no residual/iteration/over/under distinction. Mate kinds `point`/`axis`/`plane` via
  `cad.add_assembly_mate` are **sidecar-ephemeral**, not persisted.
- **planegcs is 2D only** (FreeCAD Sketcher kernel) — not usable for SE(3) assembly mates.

Primary target: the **TS `solveAssemblyKinematics` path** (does no iteration) + the Python diagnostics.

## 2. Goal (definition of done)

`solveAssemblyKinematics` (and a new `solveMateConstraints`) accepts components + mates + an initial guess and:
1. Runs a true **iterative** solve with configurable `residualTol` (default 1e-6) and `maxIterations` (default 100).
2. Returns a `ConvergenceReport`: `converged`, `iterations`, `finalResidual`, `perConstraintResiduals[]`,
   `status ∈ {converged, max_iterations_reached, diverged, over_constrained, under_constrained}`,
   `conflictingConstraintIds?`, `freeVariableCount?`.
3. Detects **over-constrained** (Jacobian rank < active constraints) and **under-constrained** (constraints < free DOF).
4. Surfaces status to the UI (FeatureTree / AssemblyView badge).
5. Is **strictly deterministic**: no `Math.random()`/`Date.now()`; constraints sorted by id; components by id.
6. Ships with analytic Vitest tests; no `any`; `.default([])` keeps old `assembly.json` parsing.

## 3. Approach

**Recommended — convergence loop in TypeScript** (the hot path the IPC/renderer sees; unit-testable; no
sidecar round-trip per viewport update). Mirror the existing `solver2d.ts` blueprint (energy = Σ squared
residuals, central-difference gradients, adaptive gradient descent w/ backtracking) but in joint-scalar space
for the foundation:
- State = free joint scalars (FK already maps scalars → world transforms).
- Energy = Σ squared mate residuals; converge when energy < `residualTol` or `|Δenergy|/(1+energy) < 1e-10`.
- Over-constrained: column-pivoted Gram–Schmidt QR rank of the constraint Jacobian (deterministic; pivot by
  column norm). Foundation may start with the `constraintCount > totalJointDOF` heuristic and add full rank later.

**Full vision** — SE(3) Gauss–Newton / Levenberg–Marquardt on rigid-body twists (`δx = −(JᵀJ+λI)⁻¹Jᵀr`),
unit-quaternion internal state (singularity-free), analytic mate Jacobians.

- **Alt A — Python `cq.Assembly.solve()` for all mates:** exists, but black-box (no residual/iters), slow
  round-trips, untestable in Vitest, ephemeral mates. Keep only as the CadQuery-side fallback.
- **Alt B — planegcs for 3D:** 2D-only; rejected.
- **Alt C — py-slvs (SolveSpace):** mature 3D constraint solver w/ native DOF + over/under reports — the
  **full-vision** recommendation (new Python dep, sidecar round-trip). Wave 3+.

## 4. Touchpoints

**Create**
- `src/shared/assembly-mate-schema.ts` — persisted mate constraints: `AssemblyMateKind` discriminated union
  (`coincident`/`concentric`/`distance`/`angle`/`flush`/`tangent`); `AssemblyMateConstraint`
  (`id`, `kind`, `part1Id`, `feature1`, `part2Id`, `feature2`, `value?`, `suppress?`);
  `assemblyMateConstraintsSchema = z.array(...).default([])`. (Distinct from the sidecar `CadAssemblyMate` wire shape.)
- `src/shared/assembly-solver-core.ts` — `SolverConfig` `{ residualTol, maxIterations, eps }`;
  `SolverConvergenceStatus` union; `SolverConvergenceReport`; `solveMateConstraints(components, mates, config?)`.
- `src/shared/assembly-solver-core.test.ts`.

**Modify**
- `src/shared/assembly-schema.ts` *(977 → Python-via-bash)* — add `mateConstraints: z.array(...).default([])`
  to `assemblyIncomingSchema` + `assemblyFileSchema`; export type; **no migration** (the `.default([])` handles
  absence, same pattern as `designModels`).
- `src/shared/assembly-kinematics-core.ts` — add `convergenceReport?` to `AssemblyKinematicsDiagnostics`;
  call `solveMateConstraints` when `mateConstraints` non-empty (else existing FK path → zero regression);
  populate `diagnostics.residuals` from the report.
- `src/main/ipc-modeling.ts` *(Python-via-bash)* — add `convergenceReport` to `assembly:solve`; make
  `assembly:simulate` step joint states (real motion study).
- `src/preload/index.ts` — expose `assemblySolve` / `assemblySimulate` on `window.fab`.
- `src/renderer/design/AssemblyView.tsx` *(941 → Python-via-bash)* — solver-status badge
  (green "converged in N", yellow "under-constrained: N DOF", red "over-constrained: [ids]", gray "not solved")
  + a "Solve" button.
- `engines/cad/cadquery_assembly.py` *(1446 → Python-via-bash)* — wrap `_solve_with_mates` to return
  `{ converged, iterations, dof, conflictingIds }`.
- `src/shared/sidecar-protocol.ts` — add optional `convergenceReport` to `CadAddAssemblyMateResult` (additive).

**No change:** `sketch_solver.py` (2D), `assembly-viewport-math.ts` (FK math), `project-schema.ts`.

## 5. Risks & mitigations

- **Ill-conditioned/redundant constraints** → damped GN (LM `+λI`); foundation's backtracking handles
  near-singular steps; flag near-zero Jacobian columns (< 1e-10) as degenerate.
- **Gimbal lock (Euler ZYX):** foundation solves in joint-scalar space (gimbal only affects output transform);
  full-vision uses quaternions internally, Euler only on write-back.
- **Rank computation cost** (O(C·N·min): pivoted Gram–Schmidt QR, no external lib, deterministic; foundation may
  use the count heuristic first.
- **Determinism:** sort constraints by `id`, components by `id`; no `Math.random`/`Date.now`/`crypto`.
- **Under-constrained:** report `freeVariableCount = totalJointDOF − effectiveRank`; still return a valid pose;
  yellow badge.
- **`.wtcam` compat:** `mateConstraints` is `.default([])` → old files parse unchanged; no migration entry.

## 6. Test strategy (analytic)

`src/shared/assembly-solver-core.test.ts`:
1. **Converging chain:** A grounded, B at [10,0,0], coincident A.feature[5,0,0]↔B.feature[0,0,0] → B→[5,0,0];
   `status:'converged'`, `finalResidual<1e-6`, `iterations<50`.
2. **Over-constrained:** two redundant A–B coincident mates → `status:'over_constrained'`, `conflictingConstraintIds`
   contains both.
3. **Under-constrained:** A grounded, B free revolute, no mates → `status:'under_constrained'`, `freeVariableCount:1`.
4. **Regression:** existing `assembly-kinematics-core.test.ts` (out-of-limit revolute) still passes.
5. **Determinism:** identical inputs twice → identical iters/residual/transforms (within `Number.EPSILON*100`).

Python (`test_cad_assembly_handlers.py`): plane mate → `converged:True`; conflicting second plane mate →
`mate_solve_failed` with a useful detail string.

## 7. Sequencing

1. **Phase 1 (foundation):** `assembly-mate-schema.ts` (+pin); extend `assembly-schema.ts` (`.default([])`);
   `assembly-solver-core.ts` (gradient-descent loop, tests 1–5); wire into `assembly-kinematics-core.ts`
   (non-empty mates only).
2. **Phase 2 (IPC):** `convergenceReport` on `assembly:solve`; real `assembly:simulate`; expose in preload.
3. **Phase 3 (UI):** AssemblyView badge + Solve button.
4. **Phase 4 (Python):** `_solve_with_mates` diagnostics; protocol field.
5. **Phase 5 (full vision, later):** LM solver; py-slvs for geometric mates; sidecar-side solve with B-rep Jacobians.

## Effort & open questions

**Effort: L** foundation+UI (~1.5–2 wk single engineer) · **XL** full SE(3)/py-slvs (~3–4 wk; Lie-group math).

1. Mate persistence: top-level `mateConstraints[]` on `assemblyFileSchema` (recommended; constraints span two parts) vs per-component.
2. Feature reference format: local `[x,y,z]` (matches sidecar wire, fine for foundation) vs stable B-rep topology ids (full vision).
3. `assembly:simulate` real motion study needs a concrete `AssemblyMotionStudyKeyframe` type (currently a stub).
4. No grounded component → globally under-constrained by 6 DOF; solver must detect/report.
5. Analytic SE(3) mate Jacobians (Murray–Li–Sastry) for the full vision; foundation uses central differences.
