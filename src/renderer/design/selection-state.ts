/**
 * CAD V1 selection state — pure, framework-agnostic helpers for the
 * Design workspace's 3D entity picking flow (Workflow H).
 *
 * Design tenets:
 *   1. **No React inside this module.** The component layer (`DesignWorkspace`)
 *      owns the `useState<Selection | null>` cell; this module exposes
 *      pure functions that return the next state. That keeps the helpers
 *      unit-testable in the existing `node` vitest environment without a
 *      jsdom dependency (same pattern as `Viewport3D.test.ts`).
 *   2. **Discriminated union by `kind`.** A selection is either a face,
 *      an edge, or a vertex. The MVP only exercises the `face` branch,
 *      but the wider type is in place so the upcoming sketch-on-face
 *      and edge-fillet flows can extend the union without reshaping the
 *      consumer surface.
 *   3. **OCCT hash is optional.** Once the sidecar's `tessellate_with_ids`
 *      surface lands ([task #54]), each face will carry a stable OCCT
 *      hash that survives re-tessellation. Until then, the renderer
 *      uses only the local `faceId` (an index into the tessellation's
 *      per-triangle parallel array). The two-step migration path is:
 *        - V1 (now):     faceId only — selection cleared when the user
 *                        re-runs the script (geometry pointer changes).
 *        - V1.5 (later): occtHash present — selection survives re-runs
 *                        when the topology is unchanged.
 *   4. **Tier-2 signature is optional too.** Alongside the stable `occtHash`
 *      (the absolute-geometry Tier-1 handle), a pick MAY carry a geometry-
 *      invariant `signature` (`CadFaceSignature` / `CadEdgeSignature` from the
 *      sidecar). The picked-edge consumers route the pair `{ occtHash, signature }`
 *      through `resolvePickedId` (`src/shared/kernel-pick-file.ts`) so a pick
 *      survives an upstream parametric MOVE / UNIFORM RESIZE: Tier 1 (exact
 *      hash) → Tier 2 (unique signature) → honest loss. Absent on legacy /
 *      pre-Tier-2 geometry — then only the hash drives resolution.
 *
 * Why this module instead of inlining the helpers into `DesignWorkspace`?
 *   - Other surfaces (the upcoming `FeatureTree` row click, the
 *     `MeasurementTool` "pick this entity" affordance, the sketch
 *     placement flow) will all need to read/write the same selection
 *     cell. Pulling the state shape + transitions into one file means
 *     there's exactly one source of truth for "what does a selection
 *     look like" — and one place to audit when the sidecar widens the
 *     wire types.
 */

// ── Discriminated union ─────────────────────────────────────────────────────

import type { CadEdgeSignature, CadFaceSignature } from '../../shared/sidecar-protocol'

/** A picked face on the active body. */
export interface FaceSelection {
  readonly kind: 'face'
  /** 0-based index into the mesh's `userData.faceIds` parallel array. */
  readonly faceId: number
  /**
   * FG-5b · STABLE geometry-derived OCCT handle (`"f:<hex>"`) from the
   * sidecar's `cad.tessellate_with_ids` `faceMap[faceId].occtId`, carried up
   * by `Viewport3D` when the geometry has the parallel `userData.faceOcctIds`
   * stash. This is the value the Shell dialog emits as
   * `shell_inward.pickedFaceIds`; the kernel resolves it back to the exact face
   * at build (and it survives a rebuild that reproduces the same geometry).
   * Absent on legacy / assembly tessellations that don't carry the stash —
   * then only `faceId` is known and the dialogs fall back to the axis bucket.
   */
  readonly occtHash?: string
  /**
   * Tier-2 · OPTIONAL geometry-invariant signature captured at pick time (from
   * `faceMap[faceId].signature`). Travels with `occtHash` so the picked-edge
   * consumers can recover the pick through `resolvePickedId` after a parametric
   * MOVE / UNIFORM RESIZE (when the absolute-hash `occtHash` no longer matches).
   * Absent on legacy / pre-Tier-2 geometry.
   */
  readonly signature?: CadFaceSignature
  /**
   * WINDOW/BOX SELECT (Phase 2) · OPTIONAL multi-face payload. When present,
   * EVERY selected face id (finite integers, deduped, always length >= 2 and
   * always containing `faceId` — the PRIMARY face: the operator's most recent
   * explicit pick, or the first box hit). ABSENT on a plain single-click pick
   * and on a one-face box (both normalize to the classic single shape), so
   * every pre-multi consumer — feature dialogs, status chip, context menu,
   * command surface — keeps reading the primary `faceId` / `occtHash` exactly
   * as before. HONEST V1 LIMITATION: per-face occtHash/signature metadata is
   * NOT tracked for the extra faces; only the primary carries it, so the
   * kernel-targeting dialogs act on the primary pick.
   *
   * `isSameEntity` / `toggleSelection` compare the PRIMARY `faceId` only —
   * the multi-select transitions below (`addFacesToSelection` /
   * `toggleFaceInSelection`) are the set-aware paths.
   */
  readonly faceIds?: readonly number[]
}

/**
 * A picked edge between two faces. `occtHash` (when present) is the STABLE
 * `"e:<hex>"` handle the Fillet / Chamfer dialogs emit as `pickedEdgeIds`.
 */
export interface EdgeSelection {
  readonly kind: 'edge'
  readonly faceId: number
  readonly occtHash?: string
  /** Tier-2 · OPTIONAL geometry-invariant edge signature (see {@link FaceSelection.signature}). */
  readonly signature?: CadEdgeSignature
}

/** A picked vertex (corner). `occtHash` carries the stable handle when present. */
export interface VertexSelection {
  readonly kind: 'vertex'
  readonly faceId: number
  readonly occtHash?: string
}

export type Selection = FaceSelection | EdgeSelection | VertexSelection

/**
 * The discriminator string of a {@link Selection}. Exported so consumers
 * (the command-surface bridge, per-feature dialogs, the status chip) can
 * narrow on `selectionKind` without re-spelling the literal union.
 */
export type SelectionKind = Selection['kind']

// ── Constructors ────────────────────────────────────────────────────────────

/**
 * Build a `FaceSelection`. Exists so callers don't repeat the literal
 * `{ kind: 'face' }` discriminator at every callsite and so a future
 * shape change (e.g. adding a normal vector) lands in one place.
 */
export function makeFaceSelection(
  faceId: number,
  occtHash?: string,
  signature?: CadFaceSignature
): FaceSelection {
  // Build up so we never carry an `undefined` key (the selection-state pins
  // assert no stray keys when an optional field is absent).
  const base: FaceSelection = { kind: 'face', faceId }
  const withHash = occtHash !== undefined ? { ...base, occtHash } : base
  return signature !== undefined ? { ...withHash, signature } : withHash
}

/**
 * Build an `EdgeSelection`. Mirrors {@link makeFaceSelection} so the edge
 * branch has a single construction site.
 *
 * FG-5: the running viewport NOW produces a real edge pick. The mesh is
 * face-tessellated (so there is no per-triangle edge mapping), so instead the
 * sidecar's `cad.tessellate_with_ids` emits a per-edge sampled POLYLINE list
 * (`edges`, each with its stable `"e:<hex>"` id); `Viewport3D` renders one
 * raycastable `LineSegments` per polyline and calls this constructor with the
 * polyline ordinal (`edgeId`) + its stable id (`occtHash`) when the operator
 * clicks near an edge in Edges mode. When `occtHash` carries the stable id, the
 * Fillet / Chamfer dialogs forward it to the kernel as `pickedEdgeIds` so the op
 * targets exactly that edge. The viewport never fabricates an id — a polyline
 * without a stable id is simply not pickable.
 */
export function makeEdgeSelection(
  edgeId: number,
  occtHash?: string,
  signature?: CadEdgeSignature
): EdgeSelection {
  const base: EdgeSelection = { kind: 'edge', faceId: edgeId }
  const withHash = occtHash !== undefined ? { ...base, occtHash } : base
  return signature !== undefined ? { ...withHash, signature } : withHash
}

/**
 * Build a `VertexSelection`. Reserved for V1.5 — same honesty boundary as
 * {@link makeEdgeSelection} (no kernel vertex-id mapping exists yet).
 */
export function makeVertexSelection(vertexId: number, occtHash?: string): VertexSelection {
  return occtHash !== undefined
    ? { kind: 'vertex', faceId: vertexId, occtHash }
    : { kind: 'vertex', faceId: vertexId }
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * "Set" the selection. Returns the `next` value untouched. Exists as a
 * named transition so future invariants (logging, telemetry, debounced
 * UI commits) have one place to hook.
 *
 * NOTE: callers pass `null` to clear via `clearSelection` instead -- but
 * the helper accepts `null` too for symmetry with the React `setState`
 * dispatcher signature.
 */
export function setSelection(_prev: Selection | null, next: Selection | null): Selection | null {
  void _prev
  return next
}

/**
 * Toggle the selection: re-clicking the same entity clears it; clicking
 * a different entity replaces it. Equality is determined by `kind` +
 * `faceId` (V1 -- `occtHash` ignored for toggle so the user can re-click
 * the same face even when the hash is missing).
 *
 * Returns `null` when the click hit the currently-selected entity (so
 * the operator can dismiss a selection without a separate "clear" step,
 * matching the Fusion 360 / Onshape interaction model).
 */
export function toggleSelection(prev: Selection | null, next: Selection): Selection | null {
  if (prev === null) return next
  if (isSameEntity(prev, next)) return null
  return next
}

/**
 * Clear the selection. Always returns `null`. Named export rather than
 * a literal so consumers can rely on the function identity in
 * `useEffect` dependency arrays.
 */
export function clearSelection(): null {
  return null
}

// ── Equality helper (exported for tests + downstream consumers) ─────────────

/**
 * Two selections are "the same entity" when they have the same `kind`
 * AND the same `faceId`. The OCCT hash is intentionally ignored here --
 * V1 needs the click-to-deselect behavior to work even before the
 * sidecar starts emitting hashes.
 */
export function isSameEntity(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false
  return a.faceId === b.faceId
}

// ── WINDOW/BOX SELECT — multi-face selection (Phase 2) ────────────────────

/**
 * Every selected face id for a `Selection | null`, in stable order:
 *   - `null` / edge / vertex selections → `[]` (no faces selected),
 *   - a single face pick → `[faceId]`,
 *   - a multi-face pick → the `faceIds` payload verbatim.
 * The ONE accessor consumers use for the multi-face highlight overlay and the
 * status-chip count, so “how many faces are selected” has a single source of
 * truth. Pure — never mutates, never fabricates ids.
 */
export function selectedFaceIds(selection: Selection | null): readonly number[] {
  if (selection === null || selection.kind !== 'face') return []
  return selection.faceIds ?? [selection.faceId]
}

/**
 * Keep finite-integer ids only, first-occurrence order, deduped. Internal —
 * the multi-face constructors funnel through this so a malformed id can never
 * enter a `faceIds` payload (mirrors `triangleToFaceId`'s honesty checks).
 */
function sanitizeFaceIds(faceIds: readonly number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const id of faceIds) {
    if (typeof id !== 'number' || !Number.isFinite(id) || !Number.isInteger(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Build a face selection covering `faceIds` (the box-select release path).
 * Normalization contract:
 *   - empty (after dropping non-finite / duplicate ids) → `null`,
 *   - exactly ONE id → a plain single `FaceSelection` (NO `faceIds` key), so
 *     a one-face box behaves exactly like a click — the no-stray-key pins and
 *     every single-pick consumer stay honest,
 *   - two or more → `{ kind: 'face', faceId: <primary>, faceIds }`.
 * `primary` (when provided AND still a member of the set) donates the primary
 * `faceId` + its occtHash/signature metadata so the feature dialogs keep
 * targeting the operator's explicit pick; otherwise the first id is primary.
 */
export function makeMultiFaceSelection(
  faceIds: readonly number[],
  primary?: FaceSelection
): FaceSelection | null {
  const ids = sanitizeFaceIds(faceIds)
  if (ids.length === 0) return null
  const primaryValid = primary !== undefined && ids.includes(primary.faceId)
  const base = primaryValid
    ? makeFaceSelection(primary.faceId, primary.occtHash, primary.signature)
    : makeFaceSelection(ids[0])
  if (ids.length === 1) return base
  return { ...base, faceIds: ids }
}

/**
 * Box-select release transition: UNION the freshly boxed `faceIds` into the
 * current selection (SHIFT+drag is the ADDITIVE convention — see
 * `selection-box.ts`).
 *   - empty hit-set → `prev` unchanged (an additive box that catches nothing
 *     adds nothing — it never clears; ESC / empty-click clears),
 *   - `prev` is a face selection → union; `prev` keeps the primary + metadata,
 *   - `prev` is null / edge / vertex → just the boxed set (kind switch
 *     replaces, mirroring `handleSelectionModeChange`'s clear-on-switch).
 */
export function addFacesToSelection(
  prev: Selection | null,
  faceIds: readonly number[]
): Selection | null {
  const incoming = sanitizeFaceIds(faceIds)
  if (incoming.length === 0) return prev
  if (prev === null || prev.kind !== 'face') return makeMultiFaceSelection(incoming)
  return makeMultiFaceSelection([...selectedFaceIds(prev), ...incoming], prev)
}

/**
 * Ctrl/Cmd-click transition: toggle ONE face's membership in the selection.
 *   - nothing / edge / vertex selected → the clicked face (plain single pick),
 *   - clicked face already selected → remove it (→ `null` when it was the
 *     last). When the removed face WAS the primary, the first survivor is
 *     re-seated as primary WITHOUT metadata (honest V1 — extra faces never
 *     carried occtHash/signature to promote),
 *   - otherwise → add it; the clicked face becomes the new PRIMARY (with its
 *     metadata) so the feature dialogs track the latest explicit pick.
 */
export function toggleFaceInSelection(
  prev: Selection | null,
  next: FaceSelection
): Selection | null {
  if (prev === null || prev.kind !== 'face') return next
  const ids = selectedFaceIds(prev)
  if (ids.includes(next.faceId)) {
    const remaining = ids.filter((id) => id !== next.faceId)
    if (prev.faceId !== next.faceId) {
      // The primary survives the removal — keep its metadata.
      return makeMultiFaceSelection(remaining, prev)
    }
    return makeMultiFaceSelection(remaining)
  }
  return makeMultiFaceSelection([...ids, next.faceId], next)
}

// ── Command-surface bridge (pure) ──────────────────────────────────

/**
 * The shape the Context Engine's `useCommandSurface` consumes
 * (`commands/CommandContextProvider.tsx::CommandSurfaceState`). Declared
 * structurally here so this module stays framework-agnostic and does NOT
 * import the React command layer (keeps the dependency edge pointing
 * design → commands, never the reverse). The two shapes are duck-typed: a
 * `SelectionSurface` is assignable to `CommandSurfaceState`.
 */
export interface SelectionSurface {
  /** True when any entity is selected. Drives ribbon-command enablement. */
  readonly hasSelection: boolean
  /** Discriminator of the active selection, or `undefined` when none. */
  readonly selectionKind?: SelectionKind
}

/**
 * The canonical "nothing selected" surface. Frozen + module-level so
 * {@link selectionToSurface} returns one stable reference for every cleared
 * state (the provider's setter de-dupes on field equality, but a stable
 * reference keeps effect-dependency churn to a minimum).
 */
export const EMPTY_SELECTION_SURFACE: SelectionSurface = Object.freeze({ hasSelection: false })

/**
 * Project a `Selection | null` onto the {@link SelectionSurface} the command
 * engine reads. Pure: no React, no DOM. `DesignWorkspace` calls this (alongside
 * its `sketchMode` flag) to push selection state up through its
 * `onCommandSurface` callback so `hasSelection` / `selectionKind` gate
 * Design-ribbon commands (e.g. "sketch on face", "fillet edge") that require a
 * live pick.
 *
 * Returns the stable {@link EMPTY_SELECTION_SURFACE} for `null` so the
 * consumer's identity comparison stays cheap; otherwise carries the
 * selection's `kind`.
 *
 * WINDOW/BOX SELECT: a MULTI-face selection (`faceIds` payload) presents
 * exactly like a single face pick — `{ hasSelection: true, selectionKind:
 * 'face' }`. Face-gated commands stay enabled and act on the PRIMARY
 * `faceId` / `occtHash`; the surface deliberately carries NO count so every
 * existing consumer (ribbon gating, viewport context menu, host bridge)
 * keeps its contract byte-for-byte unchanged.
 */
export function selectionToSurface(selection: Selection | null): SelectionSurface {
  if (selection === null) return EMPTY_SELECTION_SURFACE
  return { hasSelection: true, selectionKind: selection.kind }
}
