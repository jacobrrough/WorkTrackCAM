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
export type SolvedMateKind = 'point' | 'axis' | 'plane'

/** A local-frame 3-vector `[x, y, z]` (finite numbers). */
export type SolvedVec3 = readonly [number, number, number]

/**
 * The structural input the fold needs from a solved mate. Mirrors the renderer's
 * `SolvedMate.draft` (parsed Model-B form) but is declared here, in `shared`, so
 * this module never depends on a renderer type — the caller adapts its
 * `SolvedMate` onto this shape (a 1:1 field copy).
 *
 * Per kind, only the relevant vectors are read (the rest may be anything):
 *   - `point`: `point1` + `point2` (feature points coincide → coincident).
 *   - `axis`:  `axis1`  + `axis2`  (axes collinear → concentric; the point
 *              defaults to each part's origin).
 *   - `plane`: `point1` + `normal1` + `point2` + `normal2` (planar flush).
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
 *   - `point` → `coincident` (two feature points welded together).
 *   - `axis`  → `concentric` (two feature axes made collinear).
 *   - `plane` → `flush`      (feature points share their coordinate along the
 *                             plane normal — the foundation solver's planar mate).
 *
 * These three are exactly the foundation solver's well-supported kinds, so a
 * persisted mate round-trips straight into `solveMateConstraints` with no extra
 * mapping. (`distance` / `angle` / `tangent` have no Model-B form yet — they are
 * a later enhancement once the form grows a numeric target.)
 */
export function solvedKindToMateKind(kind: SolvedMateKind): AssemblyMateKind {
  switch (kind) {
    case 'point':
      return 'coincident'
    case 'axis':
      return 'concentric'
    case 'plane':
      return 'flush'
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
