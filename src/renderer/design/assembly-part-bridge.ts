/**
 * assembly-part-bridge — the thin RENDERER adapter over the shared, pure
 * Assembly parts/mates round-trip seam (`src/shared/assembly-hydrate.ts`).
 *
 * The campaign's data agent owns the canonical, framework-agnostic persistence
 * core in `shared` (`persistParts` / `hydrateAssembly`, keyed on the renderer-
 * shaped `AssemblyPartView`). This module is the **single, small** translation
 * layer between THAT shape and the renderer component's own `AssemblyPart` row
 * (which additionally carries a live CadQuery `handle` + a `transformSummary`
 * for the UI). Keeping the data transforms in one shared place (and only the
 * `AssemblyPart ⇄ AssemblyPartView` field copy here) means there is exactly one
 * source of truth for how parts fold into `assembly.json` `components` and how a
 * loaded file hydrates back — no drift between a renderer copy and the data
 * agent's copy.
 *
 * Why a renderer adapter at all (vs. consuming the shared types directly)?
 * `AssemblyView`'s `AssemblyPart` is heavily pinned (its `handle` field, its
 * `transformSummary`, the V1.5 mate modal). Reshaping the component's row type to
 * the shared `AssemblyPartView` would churn those pins for no behavioural gain.
 * The adapter lets the components keep their renderer-typed row while the durable
 * fold/hydrate logic lives in `shared`.
 *
 * Closes the audited Assembly gaps via the shared core:
 *   - #8  — parts fold into schema-valid components with stable ids (mate refs
 *           resolve) → {@link partsToComponents} / `persistParts`.
 *   - #9  — a parsed AssemblyFile hydrates into rows + durable mates →
 *           {@link hydrateAssembly}.
 *   - #11 — each part keeps its OWN geometry source → the per-row `geometrySource`
 *           maps to the shared structured `geometry` (handle ref).
 *
 * Pure: no React, no DOM, no IPC. Backward-compatible (Safety Rule 2): everything
 * routes through the shared seam, which only sets `.optional()` / `.default()`
 * fields and tolerates a legacy file with no components/mates.
 */

import {
  hydrateAssembly as sharedHydrateAssembly,
  persistParts as sharedPersistParts,
  syntheticPartPath,
  type AssemblyPartView
} from '../../shared/assembly-hydrate'
import type { AssemblyComponent, AssemblyFile } from '../../shared/assembly-schema'
import type { AssemblyMateConstraint } from '../../shared/assembly-mate-schema'
import type { AssemblyPart } from './AssemblyView'

/**
 * Prefix used by {@link partPathForRow} when a row carries no durable geometry
 * source — a stable, id-keyed token so the instance still persists as a DISTINCT
 * row (never an empty/colliding path). Retained for the AssemblyView solve-input
 * path, which needs a non-empty `partPath` per the component schema.
 */
export const FALLBACK_PART_PATH_PREFIX = 'part-source:'

/** A finite number, or the provided fallback when the value is missing/NaN. */
function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Whether a part row's live geometry is loaded in the current session.
 *
 * `false` for a row hydrated from disk (handle blank until the operator rebuilds
 * / re-sends the part) — the AssemblyView surfaces an honest placeholder for
 * these rather than crashing on a missing body. `true` for a freshly-added row
 * carrying a live handle.
 */
export function partHasLiveGeometry(part: AssemblyPart): boolean {
  return typeof part.handle === 'string' && part.handle.trim().length > 0
}

/**
 * Derive a stable, non-empty `partPath` token for a part row, used by the
 * AssemblyView `assembly:solve` input (whose component schema requires a
 * non-empty `partPath`). Prefers an explicit `geometrySource`; otherwise a token
 * derived from the row id (NOT the volatile live handle), so two instances of
 * one body still resolve to distinct rows.
 */
export function partPathForRow(part: AssemblyPart): string {
  const src = part.geometrySource?.trim()
  if (src && src.length > 0) return src
  const id = part.id?.trim()
  return `${FALLBACK_PART_PATH_PREFIX}${id && id.length > 0 ? id : 'unknown'}`
}

/**
 * Adapt one renderer {@link AssemblyPart} onto the shared {@link AssemblyPartView}
 * the persistence core consumes. The row id + name copy across 1:1; the live
 * `handle` (or, for a hydrated row, the durable `geometrySource`) becomes the
 * structured `geometry.handle` ref; the position/rotation tuples copy through.
 *
 * A row with neither a live handle nor a geometrySource yields no `geometry`
 * (the shared `persistParts` then synthesizes a stable `partPath` from the id),
 * so a part that has not produced geometry yet still persists as a distinct row.
 */
export function partToView(part: AssemblyPart): AssemblyPartView {
  const handleRef = part.handle?.trim()
  const sourceRef = part.geometrySource?.trim()
  // Prefer the DURABLE geometrySource over the ephemeral live handle: the source
  // is the stable identity that survives a reload, the handle is only the
  // in-session body hint. For a freshly-added row the two agree (the add path
  // sets geometrySource = handle); for a hydrated row the handle is blank and the
  // source carries the identity. Distinct instances of one body still keep
  // distinct rows via their `id`, regardless of which ref backs the geometry.
  const ref = (sourceRef && sourceRef.length > 0 ? sourceRef : handleRef) || undefined
  const view: {
    id: string
    name: string
    geometry?: { handle: string }
    transform?: NonNullable<AssemblyPartView['transform']>
    partPath?: string
    joint?: AssemblyPart['joint']
    grounded?: boolean
  } = {
    id: part.id,
    name: part.name
  }
  if (ref) view.geometry = { handle: ref }
  // Carry the durable gating fields onto the view so a persist writes them to the
  // component (the rotational-mate gate `joint === 'revolute' && !grounded` then
  // survives a reload without the operator re-setting the joint). Only forward the
  // values the row actually carries — an omitted field stays omitted so the shared
  // persistParts preserves any prior persisted value / schema default.
  if (part.joint !== undefined) view.joint = part.joint
  if (part.grounded !== undefined) view.grounded = part.grounded
  if (part.transform) {
    view.transform = {
      position: part.transform.position
        ? [
            num(part.transform.position[0], 0),
            num(part.transform.position[1], 0),
            num(part.transform.position[2], 0)
          ]
        : [0, 0, 0],
      rotation: part.transform.rotation
        ? [
            num(part.transform.rotation[0], 0),
            num(part.transform.rotation[1], 0),
            num(part.transform.rotation[2], 0)
          ]
        : [0, 0, 0]
    }
  }
  return view
}

/**
 * Compact one-line transform summary for a hydrated part (mirrors
 * {@link AssemblyView.formatTransformSummary} so the reload surface reads
 * identically to a freshly-added row). `identity` at the origin; else `@(x,y,z)`.
 */
export function summarizeViewTransform(t: AssemblyPartView['transform']): string {
  const pos = t?.position
  if (pos && (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0)) {
    return `@(${pos[0]}, ${pos[1]}, ${pos[2]})`
  }
  return 'identity'
}

/**
 * Adapt one shared {@link AssemblyPartView} (as `hydrateAssembly` returns) back
 * onto a renderer {@link AssemblyPart} row for display + editing.
 *
 * The view's durable geometry handle rides back as the row's `geometrySource`
 * (so a re-persist preserves the geometry identity). The live `handle` is set to
 * `''` — it is gone after a reload; the AssemblyView renders an honest "geometry
 * not loaded" placeholder for a blank-handle row rather than pretending the body
 * is in memory (the parts list, mate rows, and pickers all still work off the
 * row id + name).
 */
export function viewToPart(view: AssemblyPartView): AssemblyPart {
  const geometrySource = view.geometry?.handle ?? view.partPath
  const part: {
    id: string
    name: string
    handle: string
    geometrySource?: string
    transform?: AssemblyPart['transform']
    transformSummary?: string
    joint?: AssemblyPart['joint']
    grounded?: boolean
  } = {
    id: view.id,
    name: view.name,
    handle: ''
  }
  if (geometrySource) part.geometrySource = geometrySource
  // Restore the gating fields onto the row so the AssemblyMatePanel's angle/tangent
  // gate (`joint === 'revolute' && !grounded`) is correct immediately after a
  // reload. Only set what the view carries (the shared hydrate emits `joint` only
  // when present and `grounded` only when `true`), so a free-floating row stays
  // free-floating without spurious keys.
  if (view.joint !== undefined) part.joint = view.joint
  if (view.grounded !== undefined) part.grounded = view.grounded
  if (view.transform) {
    part.transform = {
      position: view.transform.position,
      rotation: view.transform.rotation
    }
  }
  part.transformSummary = summarizeViewTransform(view.transform)
  return part
}

/**
 * Map one renderer {@link AssemblyPart} onto a durable {@link AssemblyComponent}
 * via the shared `persistParts` core (so the fold logic + schema defaults live in
 * one place). Returns `null` for a blank-id row (a component MUST have a non-empty
 * id; a blank-id row could never be a mate target anyway).
 */
export function partToComponent(part: AssemblyPart): AssemblyComponent | null {
  const id = part.id?.trim()
  if (!id || id.length === 0) return null
  const emptyFile: AssemblyFile = { version: 2, name: 'Assembly', components: [], mateConstraints: [] }
  const folded = sharedPersistParts(emptyFile, [partToView(part)])
  return folded.components[0] ?? null
}

/**
 * Map the renderer's parts list onto durable components via the shared
 * `persistParts` core. Order-preserving; blank-id rows are dropped. The produced
 * components are schema-valid by construction (the shared core parses each row).
 */
export function partsToComponents(parts: readonly AssemblyPart[]): AssemblyComponent[] {
  const views = parts.filter((p) => p.id?.trim().length).map(partToView)
  const emptyFile: AssemblyFile = { version: 2, name: 'Assembly', components: [], mateConstraints: [] }
  return sharedPersistParts(emptyFile, views).components
}

/** The renderer-side view of a hydrated assembly: rows + durable mate constraints. */
export type HydratedAssembly = {
  /** Display name of the assembly (root name). */
  readonly name: string
  /** Part rows for the AssemblyView (geometry source preserved; handle blank). */
  readonly parts: AssemblyPart[]
  /** Durable mate constraints fed to the solver + the (read-only) mate readout. */
  readonly mateConstraints: AssemblyMateConstraint[]
  /**
   * Ids of mates the shared hydrate DROPPED because a part ref did not resolve
   * (honest reporting; no crash). Empty when every mate resolves.
   */
  readonly danglingMateIds: string[]
}

/**
 * Hydrate a parsed {@link AssemblyFile} into the renderer's view-model via the
 * shared `hydrateAssembly` core, then adapt the shared `AssemblyPartView[]` back
 * onto renderer rows. A saved assembly thus shows its parts + mates (editable /
 * deletable) after reload, and dangling-ref mates are filtered (the shared core
 * reports their ids) so the solver never sees an unresolvable constraint.
 *
 * Backward-compatible: a legacy file with empty `components` / `mateConstraints`
 * yields empty `parts` / `mateConstraints` (the AssemblyView shows its
 * empty-state).
 */
export function hydrateAssembly(file: AssemblyFile): HydratedAssembly {
  const shared = sharedHydrateAssembly(file)
  return {
    name: file.name,
    parts: shared.parts.map(viewToPart),
    mateConstraints: shared.mateConstraints,
    danglingMateIds: shared.danglingMateIds
  }
}

// Re-export the shared synthetic-path helper so renderer call sites can reference
// the SAME placeholder logic the persistence core uses (single source of truth).
export { syntheticPartPath }
