/**
 * Assembly **parts ⇄ components** persistence + the pure **load-hydrate seam**.
 *
 * This module is the data-layer half of the Assembly end-to-end fix (the shake-
 * down audit found Assembly was write-only + degenerate). It closes three gaps
 * at the data layer, leaving the renderer to consume these pure helpers:
 *
 *   - **#8** parts were never written into `assembly.json` `components`, so the
 *     `mateConstraints[].part1Id / part2Id` (folded by `assembly-mate-persist`)
 *     dangled. {@link persistParts} folds the renderer's parts into `components`
 *     with stable ids so a persisted mate's refs resolve.
 *   - **#9** a saved assembly's parts + mates were invisible after reload (the
 *     renderer never read `assembly.json` back to HYDRATE the UI).
 *     {@link hydrateAssembly} parses a loaded `AssemblyFile` into the renderer's
 *     view shape (`parts` + `mateConstraints`), tolerant of legacy/missing
 *     fields, and {@link hydrateAssembly}'s `danglingMateIds` reports mates whose
 *     part refs are not present so the renderer can drop them honestly.
 *   - **#11** every added part used to share one body handle. {@link persistParts}
 *     records each part's OWN `geometrySource` (handle / designModelId / relPath)
 *     so distinct bodies round-trip.
 *
 * Symmetry with `assembly-mate-persist.ts`: that module folds a *mate*; this one
 * folds the *parts* and adds the inverse (hydrate) read path. Both are **pure**
 * (no React, no DOM, no IPC, no `Date.now` / `crypto` — the caller supplies any
 * ids) and unit-tested with plain objects.
 *
 * Safety Rule 2 (additive, never break a saved project): {@link persistParts}
 * only sets fields that are `.optional()` / `.default()` in `assemblyComponentSchema`
 * (`geometrySource`, `transform`); {@link hydrateAssembly} tolerates a legacy file
 * with no `components` / no `mateConstraints` (→ empty arrays). No field is removed
 * or repurposed.
 */

import {
  assemblyFileSchema,
  type AssemblyComponent,
  type AssemblyFile,
  type AssemblyGeometrySource
} from './assembly-schema'
import type { AssemblyMateConstraint } from './assembly-mate-schema'

// ── Renderer view shape (declared HERE so neither side imports the other) ─────

/**
 * The renderer's per-row assembly part as the persistence layer sees it. Mirrors
 * `src/renderer/design/AssemblyView.tsx`'s `AssemblyPart` but is declared in
 * `shared` so this module never depends on a renderer type — the caller adapts
 * its `AssemblyPart` onto this shape (a 1:1 field copy).
 *
 *   - `id`          — stable, renderer-owned row id (NOT a CadQuery handle). The
 *                     mate form's `part1Id` / `part2Id` reference exactly this.
 *   - `name`        — display name.
 *   - `geometry`    — this part's OWN body ref (closes #11). At least one of
 *                     handle / designModelId / relPath. Optional so a row that
 *                     has not produced geometry yet still persists (it just
 *                     carries no source).
 *   - `transform`   — optional placement; position `[x,y,z]` mm + rotation
 *                     `[rx,ry,rz]` degrees (Euler, matching `assembly-viewport-math`
 *                     / the solver's Euler-ZYX). Omit for identity.
 *   - `partPath`    — optional explicit project-relative part path. When absent
 *                     {@link persistParts} synthesizes a stable placeholder from
 *                     the id (the schema requires a non-empty `partPath`).
 *   - `joint`       — optional persisted joint kind for this instance (mirrors
 *                     `AssemblyComponent.joint`). Carried through the round-trip
 *                     so a disk-loaded assembly keeps the angle/tangent rotational-
 *                     mate gate (`joint === 'revolute' && !grounded`) WITHOUT the
 *                     operator re-setting the joint in-session. Optional + additive:
 *                     a legacy view / saved row with no joint is "free-floating".
 *   - `grounded`    — optional persisted grounded flag (mirrors
 *                     `AssemblyComponent.grounded`). Threaded for the same gate (a
 *                     grounded part has no free DOF). Optional + additive; the
 *                     schema defaults it to `false` so existing assemblies still load.
 */
export type AssemblyPartView = {
  readonly id: string
  readonly name: string
  readonly geometry?: AssemblyGeometrySource
  readonly transform?: {
    readonly position?: readonly [number, number, number]
    readonly rotation?: readonly [number, number, number]
  }
  readonly partPath?: string
  readonly joint?: AssemblyComponent['joint']
  readonly grounded?: boolean
}

/** Hydrate output: the renderer-shaped parts + mate constraints from a loaded file. */
export type HydratedAssembly = {
  /** Parts in `components` order, mapped to the renderer's `AssemblyPartView`. */
  readonly parts: AssemblyPartView[]
  /**
   * Mate constraints whose BOTH part refs resolve to a hydrated part id. Mates
   * with a dangling ref are excluded here and listed in {@link danglingMateIds}
   * so the renderer never feeds the solver a constraint that references a part
   * that no longer exists.
   */
  readonly mateConstraints: AssemblyMateConstraint[]
  /**
   * Ids of mates dropped because `part1Id` and/or `part2Id` is not among the
   * hydrated component ids (honest reporting; no crash). Empty when every mate
   * resolves. Deterministic order (source array order).
   */
  readonly danglingMateIds: string[]
}

// ── Synthetic part path (placeholder for a row with no explicit path) ─────────

/**
 * Build a stable, project-relative placeholder `partPath` for a part row that
 * carries no explicit path (in-session parts only have a handle). Deterministic
 * (id-keyed, no clock) so re-persisting the same part produces the same path —
 * the schema requires `partPath` to be non-empty, and a real path is unknown
 * until the body is exported. The renderer's durable geometry ref lives in
 * `geometrySource`, so this path is only a stable label, never a load target.
 */
export function syntheticPartPath(id: string): string {
  const safe = id.trim()
  return `assembly/parts/${safe.length > 0 ? safe : 'part'}.ref`
}

// ── Transform mapping (renderer tuples ⇄ schema TRS) ──────────────────────────

const ZERO3: readonly [number, number, number] = [0, 0, 0]

function finite(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/** Renderer position/rotation tuples → the schema's `{ x, y, z, rxDeg, ryDeg, rzDeg }`. */
function viewTransformToTrs(t: AssemblyPartView['transform']): AssemblyComponent['transform'] {
  const pos = t?.position ?? ZERO3
  const rot = t?.rotation ?? ZERO3
  return {
    x: finite(pos[0]),
    y: finite(pos[1]),
    z: finite(pos[2]),
    rxDeg: finite(rot[0]),
    ryDeg: finite(rot[1]),
    rzDeg: finite(rot[2])
  }
}

/** Schema TRS → renderer position/rotation tuples (always concrete, never undefined). */
function trsToViewTransform(t: AssemblyComponent['transform']): NonNullable<AssemblyPartView['transform']> {
  return {
    position: [t.x, t.y, t.z],
    rotation: [t.rxDeg, t.ryDeg, t.rzDeg]
  }
}

// ── (Task 2) PERSIST PARTS — fold renderer parts into assembly components ──────

/**
 * Fold the renderer's `parts` into an assembly's `components`, returning a NEW
 * {@link AssemblyFile} (no mutation of the input). Closes #8 (parts now persist
 * so mate refs resolve) and #11 (each row keeps its own `geometrySource`).
 *
 * The fold is **id-keyed and order-preserving** over `parts`:
 *   - A part whose `id` matches an existing component **updates that component
 *     in place** — its `name`, `geometrySource`, and `transform` are refreshed,
 *     but every other persisted field (grounded, joint, BOM metadata, mesh path,
 *     …) is **preserved**. This makes re-persisting after an edit idempotent and
 *     non-destructive to fields the renderer's part view does not model.
 *   - A part with a new `id` is appended as a fresh component.
 *   - Components NOT present in `parts` are **dropped** (the renderer's parts list
 *     is the source of truth for which instances exist — removing a part in the
 *     UI must remove it from disk). `mateConstraints` are left untouched here;
 *     pruning mates that now dangle is the load-time concern of
 *     {@link hydrateAssembly} (and the caller may re-fold mates separately).
 *
 * Pure: shares the input's non-`components` fields by reference (only
 * `components` is a fresh array) so React state sees a new identity.
 *
 * @param assembly the current (loaded) assembly file
 * @param parts the renderer's source-of-truth parts list (any order)
 */
export function persistParts(
  assembly: AssemblyFile,
  parts: readonly AssemblyPartView[]
): AssemblyFile {
  const existingById = new Map(assembly.components.map((c) => [c.id, c]))

  const nextComponents: AssemblyComponent[] = parts.map((part) => {
    const id = part.id.trim()
    const prior = existingById.get(id)
    const transform = viewTransformToTrs(part.transform)
    const partPath =
      part.partPath != null && part.partPath.trim().length > 0
        ? part.partPath.trim()
        : prior?.partPath ?? syntheticPartPath(id)

    if (prior) {
      // Update in place: refresh the renderer-owned fields, preserve the rest.
      // `joint` / `grounded` are now part of the renderer's view, so a view that
      // CARRIES them refreshes the prior value; a view that OMITS them (legacy
      // caller / a row that never modelled a joint) leaves the prior intact — so
      // a re-persist after an edit is still non-destructive to fields set elsewhere.
      return {
        ...prior,
        name: part.name,
        partPath,
        transform,
        ...(part.joint !== undefined ? { joint: part.joint } : {}),
        ...(part.grounded !== undefined ? { grounded: part.grounded } : {}),
        ...(part.geometry != null
          ? { geometrySource: part.geometry }
          : prior.geometrySource != null
            ? { geometrySource: prior.geometrySource }
            : {})
      }
    }

    // Fresh component. Build the minimal valid row, then let the schema fill
    // every defaulted field (grounded, bomQuantity, suppressed, …) on parse.
    const raw: Record<string, unknown> = {
      id,
      name: part.name,
      partPath,
      transform
    }
    if (part.geometry != null) raw.geometrySource = part.geometry
    // Carry the renderer's joint / grounded onto the fresh row so the rotational-
    // mate gate survives the first persist. Omitted fields let the schema default
    // (`grounded → false`, `joint → undefined`), so a row that never modelled a
    // joint round-trips exactly as before.
    if (part.joint !== undefined) raw.joint = part.joint
    if (part.grounded !== undefined) raw.grounded = part.grounded
    return assemblyComponentSchemaParse(raw)
  })

  return { ...assembly, components: nextComponents }
}

/**
 * Parse one raw component through the canonical assembly schema so a freshly
 * minted row gains all the schema defaults (and is rejected if malformed) — the
 * same guarantee `parseAssemblyFile` gives the whole array, applied to one row.
 * Kept private; callers use {@link persistParts}.
 */
function assemblyComponentSchemaParse(raw: Record<string, unknown>): AssemblyComponent {
  // Round-trip through the file schema (single-component array) to reuse its
  // exact component validation + defaults without exporting an extra symbol.
  const parsed = assemblyFileSchema.parse({
    version: 2,
    name: 'Assembly',
    components: [raw],
    mateConstraints: []
  })
  return parsed.components[0]!
}

// ── (Task 3) PURE HYDRATE SEAM — loaded file → renderer view shape ────────────

/**
 * Parse a loaded {@link AssemblyFile} into the renderer's view shape — the pure
 * seam that closes #9 at the data layer. Tolerant of legacy / missing fields:
 *
 *   - A legacy file with NO `components` → `parts: []`.
 *   - A legacy file with NO `mateConstraints` → `mateConstraints: []`,
 *     `danglingMateIds: []`.
 *   - Stable ids are preserved verbatim (the renderer's part rows and the mate
 *     refs share these).
 *   - A mate whose `part1Id` and/or `part2Id` is not among the hydrated part ids
 *     is **filtered out** of `mateConstraints` and reported in `danglingMateIds`
 *     (honest, no crash) so the renderer never feeds the solver a dangling ref.
 *
 * The caller is expected to have already normalised the on-disk JSON through
 * `parseAssemblyFile` (the `assembly:load` IPC does). Passing a raw
 * `AssemblyFile` (post-parse) keeps this function pure + synchronous.
 *
 * @param file a parsed assembly file (post `parseAssemblyFile`)
 */
export function hydrateAssembly(file: AssemblyFile): HydratedAssembly {
  const parts: AssemblyPartView[] = file.components.map((c) => {
    const view: {
      id: string
      name: string
      geometry?: AssemblyGeometrySource
      transform?: NonNullable<AssemblyPartView['transform']>
      partPath?: string
      joint?: AssemblyComponent['joint']
      grounded?: boolean
    } = {
      id: c.id,
      name: c.name,
      partPath: c.partPath,
      transform: trsToViewTransform(c.transform)
    }
    if (c.geometrySource != null) view.geometry = c.geometrySource
    // Carry the gating fields back so a disk-loaded assembly keeps the rotational-
    // mate gate (`joint === 'revolute' && !grounded`). Only emit the NON-default
    // values: an absent `joint` stays absent, and `grounded` is emitted only when
    // `true` (the schema default is `false`, and the gate treats absent === false),
    // so a legacy row with neither field hydrates to the exact same shape as before.
    if (c.joint !== undefined) view.joint = c.joint
    if (c.grounded === true) view.grounded = true
    return view
  })

  const partIds = new Set(parts.map((p) => p.id))
  const mateConstraints: AssemblyMateConstraint[] = []
  const danglingMateIds: string[] = []
  for (const m of file.mateConstraints) {
    if (partIds.has(m.part1Id) && partIds.has(m.part2Id)) {
      mateConstraints.push(m)
    } else {
      danglingMateIds.push(m.id)
    }
  }

  return { parts, mateConstraints, danglingMateIds }
}
