/**
 * Assembly mate **persistence fold** (pure).
 *
 * Bridges the two mate representations the app already carries:
 *
 *   - **Model B** — the ephemeral, OCC-topology-oriented `cad.add_assembly_mate`
 *     wire shape the {@link ../renderer/design/AssemblyMatePanel} collects: a
 *     `point` / `axis` / `plane` draft made of raw 3-vectors in each child's
 *     local frame (`assembly-mate-form.ts` → `CadAssemblyMate`). This is what a
 *     *solved* mate hands back (`SolvedMate.draft`).
 *   - **Model C** — the durable, project-saved {@link AssemblyMateConstraint}
 *     (`assembly-mate-schema.ts`) the convergence solver
 *     (`solveMateConstraints`) consumes. Feature references are a local point
 *     `{ x, y, z }` and/or a **cardinal** axis label (`'x' | 'y' | 'z'`).
 *
 * The panel solves a Model-B mate (live B-rep), but persistence must survive a
 * disk round-trip with NO live handle — so we fold the solved Model-B draft into
 * a Model-C constraint and append it to the assembly's `mateConstraints` array.
 *
 * This module is **pure**: no React, no DOM, no IPC, no `Date.now` / `crypto`
 * (the caller supplies the stable id). It is consumed by the Wire phase
 * (`WorkspaceHost.onMateAdded` → `assembly:save`) and unit-tested with plain
 * objects.
 *
 * Safety Rule 2 (additive, never break a saved project): this only *appends* to
 * `mateConstraints`, which is already `.optional().default([])` in the schema —
 * an old project (no `mateConstraints`) loads, gains an empty array, and the
 * fold pushes onto it. No field is removed or repurposed.
 */

import type { AssemblyFile } from './assembly-schema'
import type {
  AssemblyMateAxis,
  AssemblyMateConstraint,
  AssemblyMateFeature,
  AssemblyMateKind
} from './assembly-mate-schema'

/** A solved Model-B mate kind (mirrors `CadAssemblyMateKind`). */
export type SolvedMateKind = 'point' | 'axis' | 'plane' | 'distance' | 'angle' | 'tangent'

/** A local-frame 3-vector `[x, y, z]` (finite numbers). */
export type SolvedVec3 = readonly [number, number, number]

/**
 * A **cardinal** local-frame axis label (`'x' | 'y' | 'z'`) — the directional
 * feature the persisted Model-C `angle` / `tangent` mate stores. Distinct from
 * the free 3-vectors the `axis` / `plane` kinds carry: a rotational mate's
 * authoring form picks one of the three local axes directly (the foundation
 * solver compares `worldFeatureAxis` dot products on the *current* pose, so a
 * cardinal label is all it consumes — see `assembly-solver-core.ts` `angle` /
 * `tangent` residuals).
 */
export type SolvedCardinalAxis = 'x' | 'y' | 'z'

/**
 * The structural input the fold needs from a solved mate. Mirrors the renderer's
 * `SolvedMate.draft` (parsed Model-B form) but is declared here, in `shared`, so
 * this module never depends on a renderer type — the caller adapts its
 * `SolvedMate` onto this shape (a 1:1 field copy).
 *
 * Per kind, only the relevant vectors are read (the rest may be anything):
 *   - `point`:    `point1` + `point2` (feature points coincide → coincident).
 *   - `axis`:     `axis1`  + `axis2`  (axes collinear → concentric; the point
 *                 defaults to each part's origin).
 *   - `plane`:    `point1` + `normal1` + `point2` + `normal2` (planar flush).
 *   - `distance`: `point1` + `point2` + `value` (feature points held at `value`
 *                 mm apart → a Model-C `distance` constraint the TS solver drives
 *                 to the target). `value` is required for this kind.
 *   - `angle`:    `axis1Cardinal` + `axis2Cardinal` + `angleDeg` (two local
 *                 cardinal axes held at a target angle in degrees → a Model-C
 *                 `angle` constraint the TS solver drives by rotating a revolute
 *                 hinge). `angleDeg` is required for this kind.
 *   - `tangent`:  `axis1Cardinal` + `axis2Cardinal` (two local cardinal axes held
 *                 perpendicular → a Model-C `tangent` constraint). NO angle value.
 */
export type SolvedMateDraftInput = {
  readonly kind: SolvedMateKind
  readonly part1Id: string
  readonly part2Id: string
  readonly point1?: SolvedVec3
  readonly point2?: SolvedVec3
  readonly axis1?: SolvedVec3
  readonly axis2?: SolvedVec3
  readonly normal1?: SolvedVec3
  readonly normal2?: SolvedVec3
  /** distance: target separation (mm). Finite, non-negative. Ignored by other kinds. */
  readonly value?: number
  /**
   * angle / tangent: the **cardinal** local axis (`'x' | 'y' | 'z'`) of each
   * part's directional feature. Distinct from the free 3-vectors `axis1` / `axis2`
   * carry — a rotational mate persists a cardinal label, not a snapped direction.
   * Required for `angle` / `tangent`; ignored by other kinds.
   */
  readonly axis1Cardinal?: SolvedCardinalAxis
  readonly axis2Cardinal?: SolvedCardinalAxis
  /**
   * angle: the target angle (DEGREES) between the two cardinal axes — kept
   * **separate** from the distance-mm `value` so the two parametric targets never
   * alias. Required for `angle`; ignored by `tangent` (perpendicular contact has
   * no free target) and every non-rotational kind.
   */
  readonly angleDeg?: number
}

/** A solved mate plus its caller-owned stable id (the renderer's `SolvedMate`). */
export type SolvedMateInput = {
  /** Stable, caller-supplied id (deterministic — the panel mints it once). */
  readonly id: string
  readonly draft: SolvedMateDraftInput
}

/** Discriminated result of {@link buildMateConstraintFromSolved}. */
export type BuildMateConstraintResult =
  | { readonly ok: true; readonly constraint: AssemblyMateConstraint }
  | { readonly ok: false; readonly reason: string }

/**
 * Map a solved Model-B mate **kind** onto the persisted Model-C kind:
 *   - `point`    → `coincident` (two feature points welded together).
 *   - `axis`     → `concentric` (two feature axes made collinear).
 *   - `plane`    → `flush`      (feature points share their coordinate along the
 *                               plane normal — the foundation solver's planar mate).
 *   - `distance` → `distance`   (two feature points held a numeric `value` mm
 *                               apart; the TS `solveMateConstraints` drives the
 *                               part's translation to the target separation).
 *
 *   - `angle`    → `angle`      (two feature axes held at a target angle in
 *                               degrees; the TS solver rotates a revolute hinge
 *                               about its axis to satisfy it — Cycle 272).
 *   - `tangent`  → `tangent`    (two feature axes held perpendicular; same
 *                               revolute-hinge rotational solve, no angle target).
 *
 * All six are solver-backed kinds, so a persisted mate round-trips straight into
 * `solveMateConstraints` with no extra mapping. (`angle` / `tangent` converge only
 * when the driven part is a **non-grounded, revolute-jointed** component — the one
 * rotational DOF the foundation solver wires; the authoring form gates the offer
 * on exactly that, so a non-convergent combination is never persisted.)
 */
export function solvedKindToMateKind(kind: SolvedMateKind): AssemblyMateKind {
  switch (kind) {
    case 'point':
      return 'coincident'
    case 'axis':
      return 'concentric'
    case 'plane':
      return 'flush'
    case 'distance':
      return 'distance'
    case 'angle':
      return 'angle'
    case 'tangent':
      return 'tangent'
    default: {
      // Exhaustiveness guard: a new SolvedMateKind must extend the map above.
      const never: never = kind
      return never
    }
  }
}

/** A finite `[number, number, number]`? */
function isVec3(v: SolvedVec3 | undefined): v is SolvedVec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  )
}

/** Local point feature from a 3-vector (drops `-0` to `0` for canonical JSON). */
function pointFeature(v: SolvedVec3): AssemblyMateFeature {
  return { x: v[0] === 0 ? 0 : v[0], y: v[1] === 0 ? 0 : v[1], z: v[2] === 0 ? 0 : v[2] }
}

/** A literal cardinal axis label (`'x' | 'y' | 'z'`)? Used by the angle/tangent fold. */
function isCardinalAxis(v: SolvedCardinalAxis | undefined): v is SolvedCardinalAxis {
  return v === 'x' || v === 'y' || v === 'z'
}

/**
 * Snap a free direction vector to the **cardinal** axis label (`'x' | 'y' | 'z'`)
 * the Model-C feature stores — the axis whose absolute component dominates. Ties
 * resolve deterministically x > y > z. A (near-)zero vector has no direction and
 * returns `null` (the caller rejects the mate rather than persist a meaningless
 * axis). The sign is intentionally discarded: the persisted feature carries a
 * cardinal axis label, and the foundation solver's directional mates are
 * sign-agnostic (they compare |cos θ| / orthogonality), so a +Z and a −Z normal
 * both persist as `'z'` and solve identically.
 */
export function dominantCardinalAxis(v: SolvedVec3): AssemblyMateAxis | null {
  if (!isVec3(v)) return null
  const ax = Math.abs(v[0])
  const ay = Math.abs(v[1])
  const az = Math.abs(v[2])
  if (ax === 0 && ay === 0 && az === 0) return null
  if (ax >= ay && ax >= az) return 'x'
  if (ay >= az) return 'y'
  return 'z'
}

/**
 * Fold one **solved Model-B mate** into a durable Model-C
 * {@link AssemblyMateConstraint}.
 *
 * Returns a discriminated result rather than throwing so the caller can surface
 * a precise reason (e.g. a zero-length axis) without a try/catch. Validation:
 *   1. both part ids non-empty and distinct (a mate joins two parts);
 *   2. the per-kind feature vectors are finite 3-tuples;
 *   3. directional kinds (`axis` / `plane`) have a non-zero direction to snap to
 *      a cardinal axis.
 *
 * The produced constraint is schema-valid by construction (every branch builds a
 * concrete, typed feature) — but the caller should still parse the *assembly*
 * through `parseAssemblyFile` / `assemblyFileSchema` on save (the IPC already
 * does), which re-validates the whole array.
 */
export function buildMateConstraintFromSolved(
  solved: SolvedMateInput
): BuildMateConstraintResult {
  const { id, draft } = solved
  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'Mate id is required.' }
  }
  const part1Id = draft.part1Id?.trim() ?? ''
  const part2Id = draft.part2Id?.trim() ?? ''
  if (part1Id.length === 0) return { ok: false, reason: 'Part 1 id is required.' }
  if (part2Id.length === 0) return { ok: false, reason: 'Part 2 id is required.' }
  if (part1Id === part2Id) {
    return { ok: false, reason: 'A mate must connect two different parts.' }
  }

  const kind = solvedKindToMateKind(draft.kind)

  if (draft.kind === 'distance') {
    if (!isVec3(draft.point1)) return { ok: false, reason: 'Point 1 must be three finite numbers.' }
    if (!isVec3(draft.point2)) return { ok: false, reason: 'Point 2 must be three finite numbers.' }
    const value = draft.value
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, reason: 'Distance value must be a finite number (mm).' }
    }
    if (value < 0) {
      return { ok: false, reason: 'Distance value must be zero or positive (mm).' }
    }
    return {
      ok: true,
      constraint: {
        id: id.trim(),
        kind,
        part1Id,
        feature1: pointFeature(draft.point1),
        part2Id,
        feature2: pointFeature(draft.point2),
        // Drop -0 to 0 for canonical JSON, matching pointFeature's convention.
        value: value === 0 ? 0 : value
      }
    }
  }

  if (draft.kind === 'angle') {
    const a1 = draft.axis1Cardinal
    const a2 = draft.axis2Cardinal
    if (!isCardinalAxis(a1)) return { ok: false, reason: 'Axis 1 must be a cardinal axis (x, y, or z).' }
    if (!isCardinalAxis(a2)) return { ok: false, reason: 'Axis 2 must be a cardinal axis (x, y, or z).' }
    const deg = draft.angleDeg
    if (typeof deg !== 'number' || !Number.isFinite(deg)) {
      return { ok: false, reason: 'Angle value must be a finite number (degrees).' }
    }
    return {
      ok: true,
      constraint: {
        id: id.trim(),
        kind,
        part1Id,
        // Directional-only feature: a cardinal axis, no point. The foundation
        // solver's angle residual reads only `feature.axis`.
        feature1: { axis: a1 },
        part2Id,
        feature2: { axis: a2 },
        // Drop -0 to 0 for canonical JSON, matching pointFeature's convention.
        value: deg === 0 ? 0 : deg
      }
    }
  }

  if (draft.kind === 'tangent') {
    const a1 = draft.axis1Cardinal
    const a2 = draft.axis2Cardinal
    if (!isCardinalAxis(a1)) return { ok: false, reason: 'Axis 1 must be a cardinal axis (x, y, or z).' }
    if (!isCardinalAxis(a2)) return { ok: false, reason: 'Axis 2 must be a cardinal axis (x, y, or z).' }
    // Tangent (perpendicular contact) has NO numeric target — omit `value`.
    return {
      ok: true,
      constraint: {
        id: id.trim(),
        kind,
        part1Id,
        feature1: { axis: a1 },
        part2Id,
        feature2: { axis: a2 }
      }
    }
  }

  if (draft.kind === 'point') {
    if (!isVec3(draft.point1)) return { ok: false, reason: 'Point 1 must be three finite numbers.' }
    if (!isVec3(draft.point2)) return { ok: false, reason: 'Point 2 must be three finite numbers.' }
    return {
      ok: true,
      constraint: {
        id: id.trim(),
        kind,
        part1Id,
        feature1: pointFeature(draft.point1),
        part2Id,
        feature2: pointFeature(draft.point2)
      }
    }
  }

  if (draft.kind === 'axis') {
    if (!isVec3(draft.axis1)) return { ok: false, reason: 'Axis 1 must be three finite numbers.' }
    if (!isVec3(draft.axis2)) return { ok: false, reason: 'Axis 2 must be three finite numbers.' }
    const a1 = dominantCardinalAxis(draft.axis1)
    const a2 = dominantCardinalAxis(draft.axis2)
    if (a1 == null) return { ok: false, reason: 'Axis 1 must be a non-zero direction.' }
    if (a2 == null) return { ok: false, reason: 'Axis 2 must be a non-zero direction.' }
    // Concentric needs a feature point too (the foundation solver measures the
    // perpendicular offset between the feature points across the axis). The
    // axis-mate form carries no explicit point, so anchor at each part's origin —
    // the cardinal axis is what actually drives the concentric residual.
    return {
      ok: true,
      constraint: {
        id: id.trim(),
        kind,
        part1Id,
        feature1: { x: 0, y: 0, z: 0, axis: a1 },
        part2Id,
        feature2: { x: 0, y: 0, z: 0, axis: a2 }
      }
    }
  }

  // plane → flush
  if (!isVec3(draft.point1)) return { ok: false, reason: 'Plane 1 origin must be three finite numbers.' }
  if (!isVec3(draft.normal1)) return { ok: false, reason: 'Plane 1 normal must be three finite numbers.' }
  if (!isVec3(draft.point2)) return { ok: false, reason: 'Plane 2 origin must be three finite numbers.' }
  if (!isVec3(draft.normal2)) return { ok: false, reason: 'Plane 2 normal must be three finite numbers.' }
  const n1 = dominantCardinalAxis(draft.normal1)
  const n2 = dominantCardinalAxis(draft.normal2)
  if (n1 == null) return { ok: false, reason: 'Plane 1 normal must be non-zero.' }
  if (n2 == null) return { ok: false, reason: 'Plane 2 normal must be non-zero.' }
  return {
    ok: true,
    constraint: {
      id: id.trim(),
      kind,
      part1Id,
      feature1: { ...pointFeature(draft.point1), axis: n1 },
      part2Id,
      feature2: { ...pointFeature(draft.point2), axis: n2 }
    }
  }
}

/**
 * Append a fully-built {@link AssemblyMateConstraint} to an assembly's
 * `mateConstraints`, returning a NEW {@link AssemblyFile} (no mutation of the
 * input). When a constraint with the same `id` already exists it is **replaced
 * in place** (idempotent re-persist — re-solving the same mate updates its row
 * rather than duplicating it). Otherwise the constraint is appended.
 *
 * Pure: the returned object shares the input's other fields by reference (only
 * `mateConstraints` is a fresh array), so React state updates see a new identity.
 */
export function withMateConstraint(
  assembly: AssemblyFile,
  constraint: AssemblyMateConstraint
): AssemblyFile {
  const existing = assembly.mateConstraints ?? []
  const idx = existing.findIndex((c) => c.id === constraint.id)
  const next =
    idx >= 0
      ? existing.map((c, i) => (i === idx ? constraint : c))
      : [...existing, constraint]
  return { ...assembly, mateConstraints: next }
}

/**
 * One-call fold: validate a solved Model-B mate, then (on success) append/replace
 * it in the assembly's `mateConstraints`. The convenience the Wire phase uses —
 * `WorkspaceHost.onMateAdded` adapts its `SolvedMate` onto {@link SolvedMateInput},
 * calls this, and (on `ok`) writes the returned assembly through `assembly:save`.
 *
 * On a rejected draft the assembly is returned **unchanged** alongside the
 * reason, so the caller can toast the reason and skip the save.
 */
export type PersistMateResult =
  | { readonly ok: true; readonly assembly: AssemblyFile; readonly constraint: AssemblyMateConstraint }
  | { readonly ok: false; readonly reason: string; readonly assembly: AssemblyFile }

export function persistMate(
  assembly: AssemblyFile,
  solved: SolvedMateInput
): PersistMateResult {
  const built = buildMateConstraintFromSolved(solved)
  if (!built.ok) {
    return { ok: false, reason: built.reason, assembly }
  }
  return {
    ok: true,
    assembly: withMateConstraint(assembly, built.constraint),
    constraint: built.constraint
  }
}

// ── Mate list EDIT operations (delete / edit-scalar / suppress) ───────────────
//
// The authoring path above APPENDS a solved mate. These folds power the
// AssemblyView Mates panel's per-row actions on the ALREADY-persisted list. Each
// is a pure, id-keyed rewrite over `mateConstraints` returning a NEW array (never
// mutating the input) so a React state update sees a fresh identity, mirroring
// `withMateConstraint`. They operate on the durable Model-C list directly (no
// Model-B round-trip) because a delete / a scalar tweak / a suppress toggle never
// needs to re-derive feature vectors — the geometry is unchanged.

/**
 * Which mate kinds carry a numeric scalar the operator can edit inline:
 *   - `distance` → target separation (mm), must be finite and ≥ 0;
 *   - `angle`    → target angle (degrees), any finite value.
 * Every other kind (`coincident` / `concentric` / `flush` / `tangent`) has no
 * free scalar — its geometry is fully determined by the feature refs — so the
 * Mates panel offers no inline edit for those (full re-authoring stays in the
 * AssemblyMatePanel). Exported so the renderer and the tests agree on exactly
 * which rows get the Edit affordance.
 */
export const SCALAR_MATE_KINDS: ReadonlySet<AssemblyMateKind> = new Set<AssemblyMateKind>([
  'distance',
  'angle'
])

/** Does this mate kind carry an editable numeric scalar (`distance` / `angle`)? */
export function mateKindHasScalar(kind: AssemblyMateKind): boolean {
  return SCALAR_MATE_KINDS.has(kind)
}

/**
 * Human-readable label for a persisted Model-C mate kind, shown in the Mates
 * panel row. Distinct from the AUTHORING panel's Model-B labels (`Point` / `Axis`
 * / `Plane`): the durable list shows the SOLVER's vocabulary (`coincident` →
 * "Coincident", etc.) so the row reflects what actually constrains the parts.
 */
export const MATE_CONSTRAINT_KIND_LABELS: Record<AssemblyMateKind, string> = {
  coincident: 'Coincident',
  concentric: 'Concentric',
  distance: 'Distance',
  angle: 'Angle',
  flush: 'Flush',
  tangent: 'Tangent'
}

/**
 * Compact one-line label for a persisted mate's editable scalar, or `null` for a
 * kind with none. `distance` → `"12 mm"`, `angle` → `"90°"`. Trailing-zero-free
 * (`12.5 mm`, not `12.50 mm`) via `Number`'s default formatting. A scalar kind
 * whose `value` is missing (a malformed / partially-authored mate) reads `"— mm"`
 * / `"—°"` so the row stays honest rather than printing `undefined`.
 */
export function formatMateScalar(mate: AssemblyMateConstraint): string | null {
  if (mate.kind === 'distance') {
    return `${typeof mate.value === 'number' && Number.isFinite(mate.value) ? mate.value : '—'} mm`
  }
  if (mate.kind === 'angle') {
    return `${typeof mate.value === 'number' && Number.isFinite(mate.value) ? mate.value : '—'}°`
  }
  return null
}

/**
 * Remove the mate with `id` from an assembly's `mateConstraints`, returning a NEW
 * {@link AssemblyFile} (input untouched). A no-op (same-value new array) when no
 * mate matches — idempotent, so a double-delete never throws. This is the durable
 * seam the Mates panel's row DELETE uses: one load → this fold → save round-trip,
 * and the next solve reflects the shorter list.
 */
export function removeMateConstraint(assembly: AssemblyFile, id: string): AssemblyFile {
  const existing = assembly.mateConstraints ?? []
  const next = existing.filter((c) => c.id !== id)
  return { ...assembly, mateConstraints: next }
}

/** Discriminated result of {@link setMateConstraintScalar}. */
export type EditMateScalarResult =
  | { readonly ok: true; readonly assembly: AssemblyFile; readonly constraint: AssemblyMateConstraint }
  | { readonly ok: false; readonly reason: string; readonly assembly: AssemblyFile }

/**
 * Edit the numeric `value` of a scalar-bearing mate (`distance` mm / `angle` deg)
 * in place, returning a NEW {@link AssemblyFile}. Validation mirrors the authoring
 * fold's per-kind rules so an edited constraint is always schema-valid AND
 * solver-meaningful:
 *   - the mate must exist and be a scalar kind (`distance` / `angle`);
 *   - `value` must be finite; `distance` additionally rejects a negative target.
 *   - `-0` is canonicalised to `0` (matching `pointFeature`'s JSON convention).
 * On a rejected edit the assembly is returned UNCHANGED alongside the reason.
 */
export function setMateConstraintScalar(
  assembly: AssemblyFile,
  id: string,
  value: number
): EditMateScalarResult {
  const existing = assembly.mateConstraints ?? []
  const idx = existing.findIndex((c) => c.id === id)
  if (idx < 0) {
    return { ok: false, reason: 'Mate not found.', assembly }
  }
  const target = existing[idx]!
  if (!mateKindHasScalar(target.kind)) {
    return {
      ok: false,
      reason: `The ${target.kind} mate has no editable value (only distance / angle do).`,
      assembly
    }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      reason:
        target.kind === 'distance'
          ? 'Distance value must be a finite number (mm).'
          : 'Angle value must be a finite number (degrees).',
      assembly
    }
  }
  if (target.kind === 'distance' && value < 0) {
    return { ok: false, reason: 'Distance value must be zero or positive (mm).', assembly }
  }
  const constraint: AssemblyMateConstraint = { ...target, value: value === 0 ? 0 : value }
  const next = existing.map((c, i) => (i === idx ? constraint : c))
  return { ok: true, assembly: { ...assembly, mateConstraints: next }, constraint }
}

/**
 * Set (or clear) the `suppress` flag of the mate with `id`, returning a NEW
 * {@link AssemblyFile}. The schema's `suppress?: boolean` is already honoured by
 * `solveMateConstraints` (it filters `suppress !== true`), so a suppressed mate is
 * parked — kept on disk + visible in the list, but excluded from the solve —
 * without any solver change. A no-op when no mate matches. Setting `false`
 * canonically OMITS the flag (so an enabled mate never carries a redundant
 * `suppress: false`, keeping the on-disk JSON minimal + matching a legacy mate
 * that never had the key).
 */
export function setMateSuppress(
  assembly: AssemblyFile,
  id: string,
  suppress: boolean
): AssemblyFile {
  const existing = assembly.mateConstraints ?? []
  const next = existing.map((c) => {
    if (c.id !== id) return c
    if (suppress) return { ...c, suppress: true }
    // Enable = drop the flag entirely (omitted === active).
    const { suppress: _omit, ...rest } = c
    return rest
  })
  return { ...assembly, mateConstraints: next }
}

/**
 * Ids of mates whose `part1Id` and/or `part2Id` is NOT among `partIds` — a mate
 * left dangling by a removed part. The reachable data flow prunes these at load
 * (`hydrateAssembly`) and on part-removal, so this is normally empty; it exists so
 * the Mates panel can flag (and still allow deleting) a mate that references a
 * part no longer in the list — a belt-and-suspenders honesty check that never
 * feeds the solver an unresolvable ref. Deterministic (source order).
 */
export function danglingMateIds(
  mates: readonly AssemblyMateConstraint[],
  partIds: ReadonlySet<string>
): string[] {
  const out: string[] = []
  for (const m of mates) {
    if (!partIds.has(m.part1Id) || !partIds.has(m.part2Id)) out.push(m.id)
  }
  return out
}
