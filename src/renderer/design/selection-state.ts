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

/** A picked face on the active body. */
export interface FaceSelection {
  readonly kind: 'face'
  /** 0-based index into the mesh's `userData.faceIds` parallel array. */
  readonly faceId: number
  /**
   * Stable OCCT topology hash returned by the sidecar's
   * `cad.tessellate_with_ids` handler. Absent in V1 — once the sidecar
   * surface lands, selections that have a hash will survive re-runs of
   * the script when the topology is unchanged.
   */
  readonly occtHash?: string
}

/** A picked edge between two faces. Reserved for V1.5. */
export interface EdgeSelection {
  readonly kind: 'edge'
  readonly faceId: number
  readonly occtHash?: string
}

/** A picked vertex (corner). Reserved for V1.5. */
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
export function makeFaceSelection(faceId: number, occtHash?: string): FaceSelection {
  return occtHash !== undefined
    ? { kind: 'face', faceId, occtHash }
    : { kind: 'face', faceId }
}

/**
 * Build an `EdgeSelection`. Mirrors {@link makeFaceSelection} so the edge
 * branch has a single construction site once an edge-granular pick lands.
 *
 * IMPORTANT (honesty boundary): the running viewport CANNOT yet produce an
 * edge id from a raycast — the sidecar's `cad.tessellate_with_ids` emits a
 * per-triangle `faceIds` array and a `faceMap` but NO edge-id mapping (see
 * `engines/cad/cadquery_script.py::tessellate_with_face_ids`). This
 * constructor exists so a surface that already HAS an edge id from another
 * source (e.g. a future `tessellate_with_edge_ids`, or a feature dialog
 * that names an edge by index) can build the value. The viewport does not
 * fabricate edge ids.
 */
export function makeEdgeSelection(edgeId: number, occtHash?: string): EdgeSelection {
  return occtHash !== undefined
    ? { kind: 'edge', faceId: edgeId, occtHash }
    : { kind: 'edge', faceId: edgeId }
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
 * engine reads. Pure: no React, no DOM. The `useDesignSelection` hook calls
 * this to push selection state up through `useCommandSurface` so
 * `hasSelection` / `selectionKind` gate Design-ribbon commands
 * (e.g. "sketch on face", "fillet edge") that require a live pick.
 *
 * Returns the stable {@link EMPTY_SELECTION_SURFACE} for `null` so the
 * consumer's identity comparison stays cheap; otherwise carries the
 * selection's `kind`.
 */
export function selectionToSurface(selection: Selection | null): SelectionSurface {
  if (selection === null) return EMPTY_SELECTION_SURFACE
  return { hasSelection: true, selectionKind: selection.kind }
}
