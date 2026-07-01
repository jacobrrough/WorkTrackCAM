/**
 * sketch-history — the PURE undo/redo seam for the live (session-wired) sketch
 * surface, plus the pure selection-mutation appliers the surface routes
 * through it (Sketch S1, the direct-manipulation wave).
 *
 * Why a surface-owned history instead of the session's `past` array:
 * `DesignSessionContext`'s `docReducer` keeps an undo-ONLY `past` (capped 64)
 * with no redo stack and no UI consumer on the live path. This module is the
 * real bidirectional history: a snapshot ring over the immutable
 * {@link DesignFileV2} with branch truncation, drag coalescing, and a memory
 * cap. `SketchSurface` owns one instance and pushes the PRE-mutation state
 * before every design mutation it controls; undo/redo re-apply snapshots via
 * the same `onDesignChange` path every edit uses, so persistence (Save →
 * `design/sketch.json`) is untouched.
 *
 * Snapshots are defensively cloned with the session's own {@link cloneDesign}
 * (the `docReducer` does exactly this for `past`) because parts of the
 * codebase — notably the 2D solver — mutate point records in place; storing
 * raw references would let a later in-place mutation corrupt history. Sketch
 * models are small (entities + a points map), so `limit` clones stay cheap.
 *
 * Framework-agnostic and side-effect free: no React, no DOM, no IPC. The
 * injectable `now` clock keeps coalescing deterministic under test.
 */

import type {
  DesignFileV2,
  SketchConstraint,
  SketchDimension,
  SketchEntity
} from '../../shared/design-schema'
import { translateSketchPoints } from './design-ops'
import { cloneDesign } from './solver2d'

/** Default snapshot cap — matches Fusion-class sketchers (and bounds memory). */
export const SKETCH_HISTORY_DEFAULT_LIMIT = 100

/**
 * Default sliding coalesce window (ms). Pointer-drag ghosting emits mutations
 * every few ms; two pushes with the same tag closer together than this are one
 * gesture. A pause longer than this (or any plain `push`, undo/redo, or
 * `breakCoalescing`) ends the gesture, so the NEXT same-tag push starts a new
 * undoable step.
 */
export const SKETCH_HISTORY_COALESCE_WINDOW_MS = 1500

export interface SketchHistory {
  /**
   * Record `design` — the PRE-mutation state — as one undoable step.
   * Truncates the redo branch (edit-after-undo) and ends any open coalescing
   * run. Evicts the OLDEST step beyond the limit.
   */
  push(design: DesignFileV2): void
  /**
   * Like {@link push}, but consecutive calls with the SAME `tag` inside the
   * sliding coalesce window collapse into the FIRST call's snapshot — so a
   * drag's live ghosting (N incremental mutations) undoes in ONE step back to
   * the pre-drag state. A different tag, a plain push, undo/redo, or
   * {@link breakCoalescing} starts a new step.
   */
  pushCoalesced(design: DesignFileV2, tag: string): void
  /** End any open coalescing run (the next pushCoalesced starts a new step). */
  breakCoalescing(): void
  /**
   * Step back: stores `current` (the live design) on the redo stack and
   * returns the most recent snapshot, or `null` when there is nothing to undo.
   * The caller applies the returned design through its normal change path.
   */
  undo(current: DesignFileV2): DesignFileV2 | null
  /**
   * Step forward: stores `current` on the undo stack and returns the most
   * recently undone snapshot, or `null` when there is nothing to redo.
   */
  redo(current: DesignFileV2): DesignFileV2 | null
  canUndo(): boolean
  canRedo(): boolean
  /** Number of undoable steps currently held (bounded by the limit). */
  undoDepth(): number
  /** Number of redoable steps currently held. */
  redoDepth(): number
}

export interface SketchHistoryOptions {
  /** Sliding coalesce window in ms (default {@link SKETCH_HISTORY_COALESCE_WINDOW_MS}). */
  readonly coalesceWindowMs?: number
  /** Injectable clock for deterministic coalescing tests (default `Date.now`). */
  readonly now?: () => number
}

/**
 * Create a bounded snapshot history for the sketch surface.
 *
 * @param limit Max undoable steps held (oldest evicted first). Default 100.
 */
export function createSketchHistory(
  limit: number = SKETCH_HISTORY_DEFAULT_LIMIT,
  options: SketchHistoryOptions = {}
): SketchHistory {
  const cap = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : SKETCH_HISTORY_DEFAULT_LIMIT))
  const windowMs = options.coalesceWindowMs ?? SKETCH_HISTORY_COALESCE_WINDOW_MS
  const now = options.now ?? ((): number => Date.now())

  const undoStack: DesignFileV2[] = []
  const redoStack: DesignFileV2[] = []
  /** Open coalescing run: the tag + timestamp of its latest accepted event. */
  let openCoalesce: { tag: string; at: number } | null = null

  function recordStep(design: DesignFileV2): void {
    undoStack.push(cloneDesign(design))
    if (undoStack.length > cap) undoStack.splice(0, undoStack.length - cap)
    redoStack.length = 0
  }

  return {
    push(design: DesignFileV2): void {
      openCoalesce = null
      recordStep(design)
    },
    pushCoalesced(design: DesignFileV2, tag: string): void {
      const at = now()
      if (
        openCoalesce !== null &&
        openCoalesce.tag === tag &&
        at - openCoalesce.at <= windowMs &&
        undoStack.length > 0
      ) {
        // Same gesture — keep the FIRST pre-state, just slide the window.
        openCoalesce.at = at
        return
      }
      recordStep(design)
      openCoalesce = { tag, at }
    },
    breakCoalescing(): void {
      openCoalesce = null
    },
    undo(current: DesignFileV2): DesignFileV2 | null {
      if (undoStack.length === 0) return null
      openCoalesce = null
      const snapshot = undoStack.pop()!
      redoStack.push(cloneDesign(current))
      return snapshot
    },
    redo(current: DesignFileV2): DesignFileV2 | null {
      if (redoStack.length === 0) return null
      openCoalesce = null
      const snapshot = redoStack.pop()!
      undoStack.push(cloneDesign(current))
      if (undoStack.length > cap) undoStack.splice(0, undoStack.length - cap)
      return snapshot
    },
    canUndo(): boolean {
      return undoStack.length > 0
    },
    canRedo(): boolean {
      return redoStack.length > 0
    },
    undoDepth(): number {
      return undoStack.length
    },
    redoDepth(): number {
      return redoStack.length
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure selection-mutation appliers — what the surface DOES when the canvas
// emits `onMoveSelected(dx, dy)` / `onDeleteSelected()`. Kept here (next to
// the history seam they always pair with) so the load-bearing logic is unit-
// testable without a DOM, per the repo's node-SSR test convention.
// ─────────────────────────────────────────────────────────────────────────────

/** Point ids an entity's geometry references (empty for center-based kinds). */
function entityPointIds(e: SketchEntity): readonly string[] {
  switch (e.kind) {
    case 'polyline':
      return 'pointIds' in e ? e.pointIds : []
    case 'arc':
      return [e.startId, e.viaId, e.endId]
    case 'spline_fit':
    case 'spline_cp':
      return e.pointIds
    case 'rect':
    case 'circle':
    case 'slot':
    case 'ellipse':
      return []
    default: {
      const _never: never = e
      void _never
      return []
    }
  }
}

/** Structural guard for `{ pointId: string }` refs inside the constraint union. */
function isPointRef(v: unknown): v is { pointId: string } {
  return (
    typeof v === 'object' && v !== null && typeof (v as { pointId?: unknown }).pointId === 'string'
  )
}

/**
 * Point ids a constraint references, walked STRUCTURALLY (every `{ pointId }`
 * ref + the bare `pointId` of `fix`) so future constraint kinds keep working
 * without touching this module.
 */
function constraintPointIds(c: SketchConstraint): readonly string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(c)) {
    if (key === 'pointId' && typeof value === 'string') {
      out.push(value)
      continue
    }
    if (isPointRef(value)) out.push(value.pointId)
  }
  return out
}

/** Entity ids a constraint references (`concentric` / `radius` / `diameter`). */
function constraintEntityIds(c: SketchConstraint): readonly string[] {
  if (c.type === 'concentric') return [c.entityAId, c.entityBId]
  if (c.type === 'radius' || c.type === 'diameter') return [c.entityId]
  return []
}

/** Point ids a dimension annotates (entity-anchored kinds reference none). */
function dimensionPointIds(dim: SketchDimension): readonly string[] {
  switch (dim.kind) {
    case 'linear':
    case 'aligned':
      return [dim.aId, dim.bId]
    case 'angular':
      return [dim.a1Id, dim.b1Id, dim.a2Id, dim.b2Id]
    case 'radial':
    case 'diameter':
      return []
    default: {
      const _never: never = dim
      void _never
      return []
    }
  }
}

/**
 * Translate the selected entities by (dxMm, dyMm) in sketch-plane mm — the
 * drag-delta applier behind the canvas's `onMoveSelected`.
 *
 * Semantics match the existing transform tools (`design-ops.translateSketch`):
 * center-based kinds (rect / circle / slot / ellipse) move `cx/cy`; point-
 * backed kinds (polyline / arc / splines) move their referenced points via
 * {@link translateSketchPoints} — each shared point exactly once. Points
 * shared with UNSELECTED entities drag that geometry along, which is standard
 * connected-sketch behavior. Returns the SAME reference when there is nothing
 * to do (no live selection, zero or non-finite delta) so callers can cheaply
 * skip the apply + history push.
 */
export function translateSelectedSketchEntities(
  design: DesignFileV2,
  selectedEntityIds: ReadonlySet<string>,
  dxMm: number,
  dyMm: number
): DesignFileV2 {
  if (!Number.isFinite(dxMm) || !Number.isFinite(dyMm)) return design
  if (dxMm === 0 && dyMm === 0) return design
  const selected = design.entities.filter((e) => selectedEntityIds.has(e.id))
  if (selected.length === 0) return design

  const movePointIds = new Set<string>()
  for (const e of selected) {
    for (const pid of entityPointIds(e)) movePointIds.add(pid)
  }
  const moved =
    movePointIds.size > 0 ? translateSketchPoints(design, dxMm, dyMm, movePointIds) : design

  const entities = moved.entities.map((e): SketchEntity => {
    if (!selectedEntityIds.has(e.id)) return e
    if (e.kind === 'rect' || e.kind === 'circle' || e.kind === 'slot' || e.kind === 'ellipse') {
      return { ...e, cx: e.cx + dxMm, cy: e.cy + dyMm }
    }
    if (e.kind === 'polyline' && 'points' in e) {
      // Legacy v1 polyline with inline coordinates (no point records).
      return {
        ...e,
        points: e.points.map(([x, y]): [number, number] => [x + dxMm, y + dyMm])
      }
    }
    return e
  })
  return { ...moved, entities }
}

/**
 * Toggle the CONSTRUCTION (reference-geometry) flag on the selected entities —
 * the applier behind the palette's "Construction" action (Fusion's X-key
 * concept). Each selected entity toggles INDIVIDUALLY (a mixed selection flips
 * each entity's own state, matching Fusion), so toggling twice always
 * round-trips. Construction entities render dashed, keep participating in
 * constraints / dimensions / snapping, and are EXCLUDED from profile
 * derivation (`extractKernelProfiles` / `cam-2d-derive`) — they never become
 * solid or cut geometry.
 *
 * Returns the SAME design reference when the selection matches nothing, so
 * callers can skip the apply + history push (the S1 applier convention).
 */
export function toggleConstructionOnSelectedSketchEntities(
  design: DesignFileV2,
  selectedEntityIds: ReadonlySet<string>
): DesignFileV2 {
  const anySelected = design.entities.some((e) => selectedEntityIds.has(e.id))
  if (!anySelected) return design
  const entities = design.entities.map((e): SketchEntity => {
    if (!selectedEntityIds.has(e.id)) return e
    return { ...e, construction: e.construction !== true }
  })
  return { ...design, entities }
}

export interface SketchDeleteResult {
  readonly design: DesignFileV2
  /** Entity ids actually removed (selection ∩ live entities). */
  readonly removedEntityIds: readonly string[]
  /** Point ids pruned because ONLY the removed entities referenced them. */
  readonly removedPointIds: readonly string[]
}

/**
 * Delete the selected entities — the applier behind `onDeleteSelected` and the
 * surface's Delete key/button.
 *
 * Beyond filtering `entities` (what `DesignSessionContext.removeEntity` does
 * for single ids), this also keeps the model reference-clean:
 *  - constraints + dimensions anchored to a removed ENTITY id are dropped;
 *  - points referenced ONLY by removed entities are pruned — but a point
 *    survives if any remaining entity, constraint, or dimension references it
 *    (and standalone point-tool points are never touched, since they were
 *    never referenced by the removed entities).
 *
 * Returns the SAME design reference (and empty id lists) when the selection
 * matches nothing, so callers can skip the apply + history push.
 */
export function deleteSelectedSketchEntities(
  design: DesignFileV2,
  selectedEntityIds: ReadonlySet<string>
): SketchDeleteResult {
  const removedEntities = design.entities.filter((e) => selectedEntityIds.has(e.id))
  if (removedEntities.length === 0) {
    return { design, removedEntityIds: [], removedPointIds: [] }
  }
  const removedEntityIdSet = new Set(removedEntities.map((e) => e.id))
  const entities = design.entities.filter((e) => !removedEntityIdSet.has(e.id))

  const constraints = design.constraints.filter(
    (c) => !constraintEntityIds(c).some((id) => removedEntityIdSet.has(id))
  )
  const dimensions = design.dimensions.filter(
    (dim) =>
      !((dim.kind === 'radial' || dim.kind === 'diameter') && removedEntityIdSet.has(dim.entityId))
  )

  // Orphan pruning: candidates are points the removed entities referenced …
  const candidates = new Set<string>()
  for (const e of removedEntities) {
    for (const pid of entityPointIds(e)) candidates.add(pid)
  }
  // … minus every point something surviving still references.
  if (candidates.size > 0) {
    for (const e of entities) {
      for (const pid of entityPointIds(e)) candidates.delete(pid)
    }
    for (const c of constraints) {
      for (const pid of constraintPointIds(c)) candidates.delete(pid)
    }
    for (const dim of dimensions) {
      for (const pid of dimensionPointIds(dim)) candidates.delete(pid)
    }
  }
  const removedPointIds = [...candidates]
  let points = design.points
  if (removedPointIds.length > 0) {
    points = { ...design.points }
    for (const pid of removedPointIds) delete points[pid]
  }

  return {
    design: { ...design, entities, constraints, dimensions, points },
    removedEntityIds: [...removedEntityIdSet],
    removedPointIds
  }
}
