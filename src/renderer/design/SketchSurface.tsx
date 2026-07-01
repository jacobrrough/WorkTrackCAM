/**
 * SketchSurface — the LIVE, session-persisted 2D sketch surface mounted in the
 * Design cockpit's "Sketch" stage.
 *
 * Wave 3e (the keystone unlock): the rich 2D vector editor was built
 * (`Sketch2DCanvas` — line/rect/circle/arc/polygon/slot/spline/trim/extend/
 * fillet/chamfer/move/rotate/scale/mirror + numeric dimension popovers) but was
 * mounted **nowhere** in the running shell, so nearly the entire Vectors ribbon
 * read as "stub/unreachable" (see docs/plans/catalog/vcarve-laguna.md FG-3 and
 * docs/plans/catalog/cad-design.md). DesignWorkspace previously mounted the
 * SELF-CONTAINED `MvpSketchCanvas`, whose entity state lives in its own
 * `useReducer` — so a drawn vector NEVER persisted into the design model, never
 * survived a save+reload, and was lost on a Sketch→Model stage switch.
 *
 * This component fixes that by wrapping the legacy session-wired
 * `Sketch2DCanvas` (the variant that is bidirectionally bound to a
 * `DesignFileV2` via `design` / `onDesignChange`). The host threads
 * `DesignSessionContext.design` + `onDesignChange` straight through, so:
 *   (a) drawing a vector dispatches an `edit` into the session's design model;
 *   (b) the model is written to `design/sketch.json` by `session.saveDesign`
 *       and re-hydrated on reload (round-trip);
 *   (c) the entities live in the session, NOT in this component — so toggling
 *       between the Sketch and Model stages preserves them.
 *
 * The legacy canvas is a *controlled* editor (no internal tool palette and no
 * snap toggle — those live in the SELF-contained MVP canvas). To keep the task
 * contract ("internal tool palette, snap-to-grid toggle, and numeric dimension
 * input are all reachable + functional"), this wrapper supplies:
 *   - an internal tool palette (the {@link SKETCH_SURFACE_TOOLS} list) that
 *     drives the canvas's `activeTool`;
 *   - a snap-to-grid toggle that switches the effective `gridMm` between the
 *     grid pitch and an effectively-off fine value;
 *   - per-tool parameter fields (fillet radius / chamfer leg / rotate° / scale×)
 *     so those edit tools are usable;
 * while the numeric dimension input (ΔX/ΔY, W×H, R popovers) is provided by the
 * canvas itself.
 *
 * No `any` types; no provider dependency (it takes plain `design` /
 * `onDesignChange` props), so DesignWorkspace stays a pure, provider-less
 * component and every existing render-pin test keeps rendering it without a
 * `DesignSessionProvider`.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { DesignFileV2, SketchEntity } from '../../shared/design-schema'
import {
  isTypableKeyboardTarget,
  matchesRedo,
  matchesUndo
} from '../../shared/app-keyboard-shortcuts'
import { Sketch2DCanvas, type SketchTool } from './Sketch2DCanvas'
import {
  applyDimensionValue,
  createDrivingDimension,
  type DimensionIntent
} from './sketch-dimension-drive'
import {
  addConstraintFromSelection,
  applicableConstraints,
  constraintKindHint,
  constraintKindLabel,
  solveSketchToTolerance,
  TOOLBAR_CONSTRAINT_KINDS,
  type ConstraintKind
} from './sketch-constraint-apply'
import { analyzeSketchDofSettled } from './sketch-dof-seam'
import {
  analyzeConstraintBlame,
  describeSketchConstraint,
  type ConstraintBlameReport
} from './sketch-overconstraint'
import { sketchToolForDesignCommand } from './design-command-map'
import {
  createSketchHistory,
  deleteSelectedSketchEntities,
  toggleConstructionOnSelectedSketchEntities,
  translateSelectedSketchEntities,
  type SketchHistory
} from './sketch-history'
import { deletePolylineNode, insertPolylineNode, moveNode } from './sketch2d-node-edit'
import { TextDialog, type FontBufferLoader } from './feature-dialogs/TextDialog'
import {
  ArraySketchDialog,
  BooleanSketchDialog,
  OffsetSketchDialog,
  sketchEditDialogForCommand,
  type SketchEditDialogKind
} from './feature-dialogs/SketchEditDialogs'
import { closedLoopEntityIds } from '../../shared/sketch-boolean-offset'

/** Catalog id of the Text command — arming it opens the Text dialog on this surface. */
export const SKETCH_TEXT_COMMAND_ID = 'sk_text'

/**
 * Sketch S1 — the selection bridge this surface supplies to the canvas.
 *
 * INTERFACE CONTRACT with the direct-manipulation `Sketch2DCanvas` work: the
 * canvas (a) consumes `selectedEntityIds` to highlight selected vectors,
 * (b) emits `onEntityPick(id, additive)` from its click hit-test (`null` id =
 * clicked empty space → clear), (c) emits `onMoveSelected(dxMm, dyMm)` while
 * dragging the selection (the surface applies the delta + coalesces history),
 * and (d) emits `onDeleteSelected()` for its own delete gesture. The props are
 * passed via an object spread, so this surface stays compilable (and the
 * extras inert at runtime) until the canvas declares them — the prop NAMES
 * below are the contract and are pinned by the S1 history test.
 */
export interface SketchSurfaceCanvasBridge {
  /** Source of truth lives in SketchSurface (`selectedEntityIds` state). */
  readonly selectedEntityIds: ReadonlySet<string>
  /** Click hit-test result. `additive` = Ctrl/Shift pick (toggle). `null` clears. */
  readonly onEntityPick: (id: string | null, additive: boolean) => void
  /** Drag delta in sketch-plane mm, applied to the live selection. */
  readonly onMoveSelected: (dxMm: number, dyMm: number) => void
  /** Canvas-side delete gesture for the current selection. */
  readonly onDeleteSelected: () => void
  /** Sketch S2 — ONE completed node-handle drag (entity, node, resolved mm). */
  readonly onNodeMove: (entityId: string, nodeId: string, point: readonly [number, number]) => void
  /** Sketch S2 — double-click vertex insert on a polyline segment. */
  readonly onNodeInsert: (
    entityId: string,
    segmentIndex: number,
    point: readonly [number, number]
  ) => void
  /** Sketch S2 — Delete pressed with an armed node on the canvas. */
  readonly onNodeDelete: (entityId: string, nodeId: string) => void
}

/** The exact prop names {@link SketchSurfaceCanvasBridge} spreads onto the canvas. */
export const SKETCH_CANVAS_BRIDGE_PROP_NAMES = [
  'selectedEntityIds',
  'onEntityPick',
  'onMoveSelected',
  'onDeleteSelected',
  'onNodeMove',
  'onNodeInsert',
  'onNodeDelete'
] as const

/**
 * A short human label for a closed-loop entity, surfaced in the selection list
 * so the operator knows which loop a row is. Mirrors the `cam-2d-derive` labels.
 */
function entityLabel(e: SketchEntity): string {
  switch (e.kind) {
    case 'rect':
      return `Rectangle ${e.id}`
    case 'circle':
      return `Circle ${e.id}`
    case 'slot':
      return `Slot ${e.id}`
    case 'ellipse':
      return `Ellipse ${e.id}`
    case 'arc':
      return `Arc ${e.id}`
    case 'polyline':
      return `Polyline ${e.id}`
    case 'spline_fit':
    case 'spline_cp':
      return `Spline ${e.id}`
    default: {
      const _never: never = e
      void _never
      return 'Loop'
    }
  }
}

/** A palette entry: the canvas tool id + its human label + group heading. */
interface SketchSurfaceToolDef {
  readonly id: SketchTool
  readonly label: string
  readonly group: 'Select' | 'Create' | 'Modify' | 'Transform' | 'Annotate'
}

/**
 * The tools surfaced in the mounted palette, grouped the way the Vectric /
 * Fusion ribbons group them. Every id is a real `SketchTool` the legacy
 * `Sketch2DCanvas` already handles (verified against its `onMouseDown` switch),
 * so each button drives a working draw/edit path. Exported so the render-pin
 * test can assert one button per entry without re-deriving the list.
 */
export const SKETCH_SURFACE_TOOLS: readonly SketchSurfaceToolDef[] = [
  // Sketch S1 — the direct-manipulation tool: click-pick (Ctrl/Shift additive),
  // drag-move, Delete. The DEFAULT tool, matching MvpSketchCanvas + Fusion.
  { id: 'select', label: 'Select', group: 'Select' },
  { id: 'line', label: 'Line', group: 'Create' },
  { id: 'polyline', label: 'Polyline', group: 'Create' },
  { id: 'rect', label: 'Rectangle', group: 'Create' },
  { id: 'rect_3pt', label: 'Rect (3-pt)', group: 'Create' },
  { id: 'circle', label: 'Circle', group: 'Create' },
  { id: 'circle_2pt', label: 'Circle (2-pt)', group: 'Create' },
  { id: 'circle_3pt', label: 'Circle (3-pt)', group: 'Create' },
  { id: 'ellipse', label: 'Ellipse', group: 'Create' },
  { id: 'arc', label: 'Arc (3-pt)', group: 'Create' },
  { id: 'arc_center', label: 'Arc (center)', group: 'Create' },
  { id: 'polygon', label: 'Polygon', group: 'Create' },
  { id: 'slot_center', label: 'Slot (center)', group: 'Create' },
  { id: 'slot_overall', label: 'Slot (overall)', group: 'Create' },
  { id: 'spline_fit', label: 'Spline (fit)', group: 'Create' },
  { id: 'spline_cp', label: 'Spline (CV)', group: 'Create' },
  { id: 'point', label: 'Point', group: 'Create' },
  { id: 'trim', label: 'Trim', group: 'Modify' },
  { id: 'extend', label: 'Extend', group: 'Modify' },
  { id: 'split', label: 'Split', group: 'Modify' },
  { id: 'break', label: 'Break', group: 'Modify' },
  { id: 'fillet', label: 'Fillet', group: 'Modify' },
  { id: 'chamfer', label: 'Chamfer', group: 'Modify' },
  { id: 'move_sk', label: 'Move', group: 'Transform' },
  { id: 'rotate_sk', label: 'Rotate', group: 'Transform' },
  { id: 'scale_sk', label: 'Scale', group: 'Transform' },
  { id: 'mirror_sk', label: 'Mirror', group: 'Transform' },
  // Sketch S4 — the dimension tool: click two vertices (aligned distance) or a
  // circle/arc (radial/diameter) to place a DRIVING dimension. Retyping its
  // value in select mode re-solves the geometry.
  { id: 'dimension', label: 'Dimension', group: 'Annotate' }
]

/** Ordered group headings for the palette render. */
const TOOL_GROUPS: ReadonlyArray<SketchSurfaceToolDef['group']> = [
  'Select',
  'Create',
  'Modify',
  'Transform',
  'Annotate'
]

/** Grid pitch (mm) used when snap is ON. Matches the cockpit's other 5 mm grids. */
const SNAP_GRID_MM = 5
/**
 * Effective `gridMm` when snap is OFF. The legacy canvas always routes
 * placements through `snap(value, gridMm)`, so there is no literal "no snap";
 * a tiny pitch makes the lattice finer than the operator can perceive (≈ free
 * placement) while keeping the canvas's grid-render guard (`gridPx >= 4`) from
 * drawing a solid wall of lines.
 */
const SNAP_OFF_GRID_MM = 0.01

/** The fixed canvas bitmap. CSS stretches it to the host; the canvas's pointer
 * math rescales for the CSS stretch (see its `clientToCanvasLocal` comment), so
 * a generous bitmap keeps the rendered grid crisp without a resize observer. */
const CANVAS_BITMAP_W = 1200
const CANVAS_BITMAP_H = 820

export interface SketchSurfaceProps {
  /**
   * The live sketch model (the session's `DesignFileV2`). Drawing mutates this
   * via {@link onDesignChange}; persistence + reload are owned by the session,
   * so this surface is stateless w.r.t. entities (only UI state — active tool,
   * snap, per-tool params — is local).
   */
  readonly design: DesignFileV2
  /** Apply a sketch edit (a drawn/edited vector). Wired to `session.onDesignChange`. */
  readonly onDesignChange: (next: DesignFileV2) => void
  /**
   * The catalog id of the sketch tool the ribbon most recently armed (e.g.
   * `'sk_line'`), or `null`. When it changes to a recognised id, the palette
   * pre-selects the matching tool — so the ribbon's `armSketchTool` actually
   * drives the mounted surface (resolving the FG-3 "armed tool is only a hint"
   * limitation for the live, session-wired surface). Optional.
   */
  readonly armedToolCommandId?: string | null
  /** Transient one-line hint from the canvas (tool prompts, placement notes). */
  readonly onSketchHint?: (msg: string) => void
  /** Plane label shown at the canvas top-left (e.g. the sketch plane name). */
  readonly planeLabel?: string
  /**
   * Wave 3f — import machinable DXF vectors directly onto THIS sketch surface.
   * When wired (DesignWorkspaceHost fills it), the palette shows an "Import DXF"
   * button that runs the host's file-picker → `dxf:import` → `dxfToSketch`
   * additive-merge into the SAME session design model, so the imported
   * (bulge-accurate) vectors appear immediately on the mounted canvas AND persist.
   * Resolves the Wave-3e item-e caveat (the only DXF button used to live on the
   * Manufacture ribbon, so an import there was invisible to an already-mounted
   * Design canvas). Optional — absent hides the button (the splash preview +
   * render-pin tests render without it).
   *
   * Sketch S2 (race fix): the host SHOULD resolve with the MERGED design it
   * applied (or `null` when nothing changed — cancelled picker, parse failure).
   * That makes the surface's one-undo-step bookkeeping deterministic: the old
   * contract (`void`) forced the surface to compare its live ref after the
   * await, which races React's prop flush and silently skipped the import's
   * undo step. `void`-resolving hosts still work but keep the legacy
   * best-effort comparison (see {@link resolveDxfImportCommit}).
   */
  readonly onImportDxf?: () => void | DesignFileV2 | null | Promise<void | DesignFileV2 | null>
  /**
   * Wave 3f — inject the font-bytes loader the {@link TextDialog} uses. Defaults
   * (when omitted) to the dialog's own `font:read`-IPC loader. Tests pass a
   * loader backed by an on-disk font buffer so the surface mounts the dialog
   * without Electron. Optional.
   */
  readonly loadFontBuffer?: FontBufferLoader
  /**
   * Wave 3n — pass-through of the canvas's own pointer->world output
   * (`Sketch2DCanvas.onCursorWorld`: the snap-resolved sketch-plane mm the
   * placement logic uses; `null` on pointer-leave). This surface adds exactly
   * one behavior: it fires `null` on unmount, so the shell StatusBar read-out
   * blanks when the operator leaves the Sketch stage. Optional + additive.
   */
  readonly onCursorWorld?: (xyMm: readonly [number, number] | null) => void
}

/**
 * Map the ribbon-armed catalog id to a `SketchTool`, or `null` when it does not
 * resolve (constraints/dimensions have no draw tool — the palette stays put).
 */
function toolForArmedCommand(commandId: string | null | undefined): SketchTool | null {
  if (!commandId) return null
  return sketchToolForDesignCommand(commandId) ?? null
}

/** What the surface should do once a DXF import settles (see {@link resolveDxfImportCommit}). */
export interface DxfImportCommitDecision {
  /** True = the import changed the model: record EXACTLY ONE undo step (push `before`). */
  readonly record: boolean
  /** The freshest post-import design the surface must treat as live. */
  readonly live: DesignFileV2
}

/**
 * Sketch S2 — the DETERMINISTIC undo-step decision for a settled DXF import
 * (the S1 race fix, exported pure so the regression test runs the REAL logic).
 *
 * S1's bug: the import handler compared `liveDesignRef.current !== before` in
 * a `finally` that can run BEFORE React re-renders the surface with the
 * host's session edit — the comparison saw the stale pre-import design and
 * silently skipped the import's undo step (the import itself was fine).
 *
 * The fix: the host now RESOLVES with the merged design it applied
 * (`resolvedMerged`). When present, the decision depends ONLY on values the
 * await chain owns — no dependence on React having flushed:
 *   - `resolvedMerged !== before`  → record one step, treat it as live;
 *   - identical reference          → nothing changed, record nothing.
 * `null` (legacy `void` hosts) falls back to the old live-ref comparison,
 * which is best-effort by construction.
 */
export function resolveDxfImportCommit(
  before: DesignFileV2,
  resolvedMerged: DesignFileV2 | null,
  liveAfter: DesignFileV2
): DxfImportCommitDecision {
  if (resolvedMerged !== null) {
    return resolvedMerged !== before
      ? { record: true, live: resolvedMerged }
      : { record: false, live: liveAfter }
  }
  return { record: liveAfter !== before, live: liveAfter }
}

export function SketchSurface({
  design,
  onDesignChange,
  armedToolCommandId = null,
  onSketchHint,
  planeLabel,
  onImportDxf,
  loadFontBuffer,
  onCursorWorld
}: SketchSurfaceProps): JSX.Element {
  // Sketch S1 — direct manipulation is the resting state (matches the MVP
  // variant + Fusion): the operator picks/moves/deletes by default and arms a
  // draw tool explicitly (palette click or ribbon command).
  const [activeTool, setActiveTool] = useState<SketchTool>('select')
  // The internal tool palette duplicates the top CREATE/MODIFY ribbon (which also arms tools via
  // `armedSketchTool`), so let the operator collapse it to a thin rail to cut the overlap. Sticky.
  const [paletteCollapsed, setPaletteCollapsed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem('wt.sketch.toolsCollapsed') === '1'
    } catch {
      return false
    }
  })
  const [snapEnabled, setSnapEnabled] = useState(true)
  // Wave 3n — blank the StatusBar coordinate read-out when this surface
  // unmounts (Sketch->Model stage switch / sketch exit): the canvas can only
  // report pointer-leave, not its own teardown. Latest-callback ref so the
  // once-only cleanup never re-runs on a prop identity change.
  const onCursorWorldRef = useRef(onCursorWorld)
  onCursorWorldRef.current = onCursorWorld
  useEffect(() => {
    return () => {
      onCursorWorldRef.current?.(null)
    }
  }, [])
  // Wave 3f — the Text dialog mounts as an overlay on the surface. Armed by the
  // `sk_text` ribbon command (auto-open) or the surface's own "Text" button.
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  // Wave 3g — which sketch-edit dialog (offset / boolean / array) is open, or
  // `null`. Opened by the `sk_offset`/`sk_boolean`/`sk_array_*` ribbon commands
  // (auto-open, mirroring `sk_text`) or the surface's own Modify buttons.
  const [editDialog, setEditDialog] = useState<SketchEditDialogKind | null>(null)
  // Wave 3g — the closed loops the operator has picked as the op's inputs. A Set
  // of entity ids from the live design; toggled in the selection list. Stale ids
  // (an entity deleted out from under the selection) are filtered at read time.
  // Sketch S1 lifted this into the surface-wide selection source of truth: the
  // canvas's click hit-test (onEntityPick) and the loop checkbox list both
  // read+write THIS state, and the edit dialogs consume the same selection.
  const [selectedEntityIds, setSelectedEntityIds] = useState<ReadonlySet<string>>(new Set())

  // ── Sketch S1 — surface-owned undo/redo history (the mutation seam) ────────
  // One bounded snapshot ring per mounted surface. EVERY design mutation this
  // surface controls pushes the PRE-mutation state BEFORE applying via
  // onDesignChange; undo/redo re-apply snapshots through the SAME path, so the
  // session reducer + Save-persistence are untouched.
  const historyRef = useRef<SketchHistory | null>(null)
  if (historyRef.current === null) historyRef.current = createSketchHistory()
  const history = historyRef.current
  // Bumped after every history-affecting op so the Undo/Redo disabled states
  // (read from the ring at render time) stay current. Surfaced as a root data-
  // attribute so it is genuinely consumed (and test-visible).
  const [historyRevision, setHistoryRevision] = useState(0)
  // The freshest design — the prop, OR the `next` just applied when several
  // mutations land between React renders (drag bursts). Pushing from this ref
  // (never the render closure) keeps every snapshot an accurate pre-state.
  const liveDesignRef = useRef(design)
  liveDesignRef.current = design
  // Sketch S5.1 — the conflict-aware DOF badge's SETTLED gate. True only while
  // the live design is the result of a solve-bearing edit (a constraint apply or
  // a dimension value re-solve, which run `solveSketchToTolerance`); ANY other
  // mutation — a raw draw, a drag, a node edit, a delete, a DXF import, a
  // text/offset/boolean/array apply, an undo/redo — clears it. The badge only
  // consults the post-solve residual (and can ever read 'Conflicting') when this
  // is true, so a transiently-unsolved / mid-draw design can never false-positive
  // a conflict. See `analyzeSketchDofSettled`'s gating contract.
  const [designSettled, setDesignSettled] = useState(false)
  // Guards the Import-DXF button while the host's picker + parse + merge is in
  // flight, so a double-click can't kick off two overlapping file pickers.
  const [importingDxf, setImportingDxf] = useState(false)
  // Per-tool parameters so the fillet/chamfer/transform tools are functional.
  const [filletRadiusMm, setFilletRadiusMm] = useState(2)
  const [chamferLengthMm, setChamferLengthMm] = useState(2)
  const [rotateDeg, setRotateDeg] = useState(90)
  const [scaleFactor, setScaleFactor] = useState(2)

  // Pre-select the tool the ribbon armed (when it resolves to a draw/edit tool).
  useEffect(() => {
    const t = toolForArmedCommand(armedToolCommandId)
    if (t) setActiveTool(t)
  }, [armedToolCommandId])

  // Wave 3f — the Text command has no draw-tool mapping; arming `sk_text` opens
  // the Text dialog instead. Fires on the transition to `sk_text` so a closed
  // dialog re-opens if the ribbon arms Text again.
  useEffect(() => {
    if (armedToolCommandId === SKETCH_TEXT_COMMAND_ID) setTextDialogOpen(true)
  }, [armedToolCommandId])

  // Wave 3g — the offset / boolean / array commands likewise have no draw tool;
  // arming one opens the matching edit dialog (mirroring the Text pattern). Fires
  // on the transition so re-arming the same op re-opens a dialog the operator closed.
  useEffect(() => {
    const kind = sketchEditDialogForCommand(armedToolCommandId ?? '')
    if (kind) setEditDialog(kind)
  }, [armedToolCommandId])

  const gridMm = snapEnabled ? SNAP_GRID_MM : SNAP_OFF_GRID_MM

  /** Total entity + point count, surfaced as an honest "what's in the sketch" read-out. */
  const entityCount = design.entities.length
  const pointCount = useMemo(() => Object.keys(design.points).length, [design.points])

  // Wave 3g — the closed loops in the design (entity ids that bound a region),
  // the rows of the selection list + the pool the edit dialogs accept as inputs.
  const closedLoopIds = useMemo(() => new Set(closedLoopEntityIds(design)), [design])
  const closedLoopEntities = useMemo(
    () => design.entities.filter((e) => closedLoopIds.has(e.id)),
    [design.entities, closedLoopIds]
  )
  // The selection narrowed to ids still present in the design (drop stale picks).
  const selectedIds = useMemo(() => {
    const live = new Set(design.entities.map((e) => e.id))
    return [...selectedEntityIds].filter((id) => live.has(id))
  }, [design.entities, selectedEntityIds])

  // ── Sketch S1 — the history-recorded mutation paths ────────────────────────

  /**
   * Route EVERY surface-controlled design mutation through the history seam:
   * record the pre-mutation state, then apply via the session's onDesignChange.
   * Draw commits (canvas), Text inserts, and Offset/Boolean/Array applies all
   * call this instead of the raw prop.
   *
   * Sketch S5.1 — `solved` declares whether `next` came out of a solve
   * (`solveSketchToTolerance`). It gates the conflict-aware DOF badge's settled
   * read: ONLY the two re-solving handlers pass `true`; every other caller
   * (draws, text, offset/boolean/array — the default) leaves the design
   * UNSETTLED, so the badge stays count-only and can never claim a conflict it
   * hasn't actually solved for.
   */
  function applyDesignEdit(next: DesignFileV2, solved = false): void {
    history.push(liveDesignRef.current)
    liveDesignRef.current = next
    onDesignChange(next)
    setDesignSettled(solved)
    setHistoryRevision((v) => v + 1)
  }

  function performUndo(): void {
    const prev = history.undo(liveDesignRef.current)
    if (prev === null) return
    liveDesignRef.current = prev
    onDesignChange(prev)
    // A restored snapshot is not a fresh solve — drop the settled gate so the
    // badge falls back to the honest count-only verdict.
    setDesignSettled(false)
    setHistoryRevision((v) => v + 1)
    onSketchHint?.('Undo.')
  }

  function performRedo(): void {
    const next = history.redo(liveDesignRef.current)
    if (next === null) return
    liveDesignRef.current = next
    onDesignChange(next)
    setDesignSettled(false)
    setHistoryRevision((v) => v + 1)
    onSketchHint?.('Redo.')
  }

  /** Canvas click hit-test → selection. `null` = empty-space click (clear). */
  function handleEntityPick(id: string | null, additive: boolean): void {
    setSelectedEntityIds((prev) => {
      if (id === null) return prev.size === 0 ? prev : new Set<string>()
      if (!additive) return new Set([id])
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** The loop-list checkboxes are an additive toggle over the SAME state. */
  function toggleSelected(id: string): void {
    handleEntityPick(id, true)
  }

  /**
   * Canvas drag delta → translate the live selection. Coalesced per selection
   * (the tag), so a drag's stream of deltas undoes in ONE step back to the
   * pre-drag state.
   */
  function handleMoveSelected(dxMm: number, dyMm: number): void {
    const cur = liveDesignRef.current
    const ids = new Set(
      [...selectedEntityIds].filter((id) => cur.entities.some((e) => e.id === id))
    )
    if (ids.size === 0) return
    const next = translateSelectedSketchEntities(cur, ids, dxMm, dyMm)
    if (next === cur) return
    history.pushCoalesced(cur, `move:${[...ids].sort().join('|')}`)
    liveDesignRef.current = next
    onDesignChange(next)
    setDesignSettled(false)
    setHistoryRevision((v) => v + 1)
  }

  /** Delete the live selection — ONE history step, selection pruned after. */
  function handleDeleteSelected(): void {
    const cur = liveDesignRef.current
    const result = deleteSelectedSketchEntities(cur, selectedEntityIds)
    if (result.removedEntityIds.length === 0) return
    history.push(cur)
    liveDesignRef.current = result.design
    onDesignChange(result.design)
    setDesignSettled(false)
    setSelectedEntityIds((prev) => {
      const next = new Set(prev)
      for (const id of result.removedEntityIds) next.delete(id)
      return next
    })
    setHistoryRevision((v) => v + 1)
    onSketchHint?.(
      result.removedEntityIds.length === 1
        ? 'Deleted 1 vector.'
        : `Deleted ${result.removedEntityIds.length} vectors.`
    )
  }

  /**
   * Toggle CONSTRUCTION (reference) geometry on the live selection — Fusion's
   * X-key concept, ONE history step through the same seam as every other
   * surface mutation (`applyDesignEdit`). Each selected entity toggles
   * individually (pure `toggleConstructionOnSelectedSketchEntities`); the
   * applier returns the SAME reference for an empty/stale selection, so no
   * undo step is recorded then. Construction entities render dashed, keep
   * constraints/dimensions/snapping, and never derive into the solid or CAM.
   */
  function handleToggleConstruction(): void {
    const cur = liveDesignRef.current
    const ids = new Set(selectedIds)
    const next = toggleConstructionOnSelectedSketchEntities(cur, ids)
    if (next === cur) return
    applyDesignEdit(next)
    onSketchHint?.(
      ids.size === 1
        ? 'Toggled construction on 1 vector.'
        : `Toggled construction on ${ids.size} vectors.`
    )
  }

  // Surface-level keyboard seam: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z via the central
  // shortcut catalog matchers, plus Delete for the selection. Window-level so it
  // works regardless of which child has focus; gated off while typing in an
  // input/textarea/select/contentEditable (e.target check) and removed when the
  // surface unmounts (the mounted-surface gate). Latest-handler ref so the
  // once-only listener never goes stale.
  const keyHandlersRef = useRef({ performUndo, performRedo, handleDeleteSelected })
  keyHandlersRef.current = { performUndo, performRedo, handleDeleteSelected }
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypableKeyboardTarget(e.target)) return
      if (matchesUndo(e)) {
        e.preventDefault()
        keyHandlersRef.current.performUndo()
        return
      }
      if (matchesRedo(e)) {
        e.preventDefault()
        keyHandlersRef.current.performRedo()
        return
      }
      if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        keyHandlersRef.current.handleDeleteSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Sketch S2 — node/vertex edit appliers (canvas → pure module → history) ─

  /**
   * ONE completed node-handle drag → ONE `moveNode` commit. Coalesced per
   * node (the tag), mirroring the S1 entity-move semantics; a shared
   * point-ref node moves EVERY entity referencing that record (S1 semantic,
   * applied exactly once by the pure applier).
   */
  function handleNodeMove(entityId: string, nodeId: string, point: readonly [number, number]): void {
    const cur = liveDesignRef.current
    const next = moveNode(cur, entityId, nodeId, point)
    if (next === cur) return
    history.pushCoalesced(cur, `node:${entityId}:${nodeId}`)
    liveDesignRef.current = next
    onDesignChange(next)
    setDesignSettled(false)
    setHistoryRevision((v) => v + 1)
  }

  /** Double-click vertex insert — ONE history step per insert. */
  function handleNodeInsert(
    entityId: string,
    segmentIndex: number,
    point: readonly [number, number]
  ): void {
    const cur = liveDesignRef.current
    const next = insertPolylineNode(cur, entityId, segmentIndex, point)
    if (next === cur) return
    history.push(cur)
    liveDesignRef.current = next
    onDesignChange(next)
    setDesignSettled(false)
    setHistoryRevision((v) => v + 1)
    onSketchHint?.('Node inserted.')
  }

  /** Delete the armed node — the pure applier refuses below the loop floor. */
  function handleNodeDelete(entityId: string, nodeId: string): void {
    const cur = liveDesignRef.current
    const next = deletePolylineNode(cur, entityId, nodeId)
    if (next === cur) {
      onSketchHint?.('Node not removable — a closed loop keeps 3 points (2 for an open path).')
      return
    }
    history.push(cur)
    liveDesignRef.current = next
    onDesignChange(next)
    setDesignSettled(false)
    setHistoryRevision((v) => v + 1)
    onSketchHint?.('Node deleted.')
  }

  // ── Sketch S4 — dimension placement + inline value-edit (one undo step) ────

  /**
   * The dimension tool placed a dimension → make it a DRIVING dimension. The
   * pure `createDrivingDimension` (other agent's module) adds the dimension +
   * its parameter (seeded to the CURRENT measured value, so creating it does
   * NOT move geometry) + the matching solver constraint. A null result (the
   * intent couldn't be measured — e.g. radial on a non-circle) is a no-op.
   * Records EXACTLY ONE undo step via the surface history seam.
   */
  function handlePlaceDimension(intent: DimensionIntent): void {
    const result = createDrivingDimension(liveDesignRef.current, intent)
    if (!result) {
      onSketchHint?.('Could not dimension that selection.')
      return
    }
    applyDesignEdit(result.design)
    onSketchHint?.('Driving dimension added.')
  }

  /**
   * The operator committed an inline value edit on a dimension's value label →
   * set its parameter + re-solve via the pure `applyDimensionValue`. That
   * returns the SAME design reference when nothing changes (unknown id,
   * annotation-only dim, or an invalid value), so we only record an undo step
   * when the geometry actually moved. ONE undo step on a real edit.
   */
  function handleCommitDimensionValue(dimId: string, value: number): void {
    const cur = liveDesignRef.current
    const next = applyDimensionValue(cur, dimId, value)
    if (next === cur) {
      onSketchHint?.('Dimension unchanged (annotation-only or invalid value).')
      return
    }
    // `applyDimensionValue` re-solves to tolerance — mark the result SETTLED so
    // the DOF badge may consult the residual (and surface a genuine conflict).
    applyDesignEdit(next, true)
    onSketchHint?.('Dimension updated — geometry re-solved.')
  }

  // ── Sketch S5 — constraints toolbar (apply a relation to the selection) ────

  /**
   * The constraint kinds the CURRENT selection can satisfy (drives each toolbar
   * button's enabled state). Narrowed to the live selection (stale picks
   * dropped) so a button never offers a relation the geometry can't form.
   */
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const applicableConstraintKinds = useMemo(
    () => new Set<ConstraintKind>(applicableConstraints(design, selectedIdSet)),
    [design, selectedIdSet]
  )

  /**
   * Apply a geometric constraint built from the current selection, then RE-SOLVE
   * to tolerance — all as ONE undo step. The pure `addConstraintFromSelection`
   * resolves the selection to the point/entity ids the kind needs (see its
   * resolution rules) and returns the design with the constraint added, or
   * `null` when the selection can't satisfy the kind (a no-op, no undo step).
   * `solveSketchToTolerance` then drives the geometry onto the new relation.
   */
  function handleApplyConstraint(kind: ConstraintKind): void {
    const cur = liveDesignRef.current
    const withConstraint = addConstraintFromSelection(cur, selectedIdSet, kind)
    if (!withConstraint) {
      onSketchHint?.(`Can't apply ${constraintKindLabel(kind)} to that selection.`)
      return
    }
    // `solveSketchToTolerance` re-solves onto the new relation — mark SETTLED so
    // the DOF badge may consult the residual (and surface a genuine conflict).
    applyDesignEdit(solveSketchToTolerance(withConstraint), true)
    onSketchHint?.(`${constraintKindLabel(kind)} constraint applied — geometry re-solved.`)
  }

  // ── Sketch S5 / S5.1 — honest, conflict-AWARE DOF read-out (status badge) ──
  // Consumes the engine agent's DOF analysis through the typed seam. S5.1 upgrade:
  // `analyzeSketchDofSettled` folds in the post-solve RESIDUAL — so a genuine
  // conflict the equation count cannot see (a dimension fighting a constraint)
  // surfaces as 'Conflicting' — but ONLY when `designSettled` is true (the live
  // design came out of a solve-bearing edit). A transiently-unsolved / mid-draw
  // design (settled === false) reads the count-only verdict and can NEVER
  // false-positive a conflict. The badge labels itself approximate; an empty
  // sketch shows nothing. See `analyzeSketchDofSettled`'s gating contract.
  const dofReport = useMemo(
    () => analyzeSketchDofSettled(design, designSettled),
    [design, designSettled]
  )

  // Over-constraint CONFLICT NAMING (Fusion parity): WHICH constraint is to
  // blame. Gated on the badge already reading over/conflicting so the
  // O(N x rank) leave-one-out scan never runs on a healthy sketch;
  // `analyzeConstraintBlame` additionally caps itself (BLAME_MAX_CONSTRAINTS
  // => the honest 'too-large' fallback instead of a stall). Deterministic and
  // pure — safe to derive during render.
  const conflictBlame = useMemo<ConstraintBlameReport | null>(() => {
    if (dofReport.status !== 'over' && dofReport.status !== 'conflicting') return null
    return analyzeConstraintBlame(design)
  }, [design, dofReport.status])

  /** The blamed constraints resolved to human labels (stale ids dropped). */
  const conflictCulprits = useMemo(() => {
    if (!conflictBlame) return []
    const out: Array<{ id: string; label: string }> = []
    for (const id of conflictBlame.culpritIds) {
      const con = design.constraints.find((c) => c.id === id)
      if (con) out.push({ id, label: describeSketchConstraint(design, con) })
    }
    return out
  }, [conflictBlame, design])

  /** Set form of the culprit ids for the canvas's error-glyph prop. */
  const conflictCulpritIdSet = useMemo(
    () => new Set(conflictCulprits.map((cc) => cc.id)),
    [conflictCulprits]
  )

  /**
   * Over-constraint conflict naming — remove the blamed constraint and
   * RE-SOLVE, as ONE undo step through the standard seam. This is the
   * message's actionable path: the surface has no constraint-manager panel,
   * so the named culprit gets a one-click removal (Undo restores it). The
   * re-solve is a settled edit, so the DOF badge immediately reflects the
   * resolution instead of waiting for the next solve-bearing edit.
   */
  function handleRemoveCulpritConstraint(constraintId: string): void {
    const cur = liveDesignRef.current
    const con = cur.constraints.find((c) => c.id === constraintId)
    if (!con) return
    const removed: DesignFileV2 = {
      ...cur,
      constraints: cur.constraints.filter((c) => c.id !== constraintId)
    }
    applyDesignEdit(solveSketchToTolerance(removed), true)
    onSketchHint?.(`Removed ${describeSketchConstraint(cur, con)} — geometry re-solved.`)
  }

  // S1 selection bridge → canvas (see SketchSurfaceCanvasBridge). Spread as a
  // variable so this compiles before the canvas declares the props; extra props
  // are inert at runtime until the canvas's hit-test half lands.
  const canvasSelectionBridge: SketchSurfaceCanvasBridge = {
    selectedEntityIds,
    onEntityPick: handleEntityPick,
    onMoveSelected: handleMoveSelected,
    onDeleteSelected: handleDeleteSelected,
    onNodeMove: handleNodeMove,
    onNodeInsert: handleNodeInsert,
    onNodeDelete: handleNodeDelete
  }

  // Run the host's DXF import, guarding against overlapping pickers. The host
  // owns the file-picker → parse → additive-merge → persist chain; this only
  // toggles the in-flight flag around it. `onImportDxf` may be sync or async.
  // Sketch S2 (race fix): the host RESOLVES with the merged design it applied,
  // so the one-undo-step decision runs through the pure, DETERMINISTIC
  // `resolveDxfImportCommit` — no dependence on React having flushed the
  // session edit back into the `design` prop before this `finally` runs (the
  // S1 live-ref comparison silently skipped the step exactly there). A
  // cancelled picker resolves `null` and records nothing.
  async function handleImportDxfClick(): Promise<void> {
    if (!onImportDxf || importingDxf) return
    setImportingDxf(true)
    const before = liveDesignRef.current
    let resolvedMerged: DesignFileV2 | null = null
    try {
      const result = await onImportDxf()
      resolvedMerged = typeof result === 'object' && result !== null ? result : null
    } finally {
      setImportingDxf(false)
      const commit = resolveDxfImportCommit(before, resolvedMerged, liveDesignRef.current)
      liveDesignRef.current = commit.live
      if (commit.record) {
        history.push(before)
        // An import additively merges vectors — it is not a solve. Drop the
        // settled gate so the badge stays count-only after it.
        setDesignSettled(false)
        setHistoryRevision((v) => v + 1)
      }
    }
  }

  // Which contextual param field (if any) the active tool needs.
  const showFilletParam = activeTool === 'fillet'
  const showChamferParam = activeTool === 'chamfer'
  const showRotateParam = activeTool === 'rotate_sk'
  const showScaleParam = activeTool === 'scale_sk'

  const canUndo = history.canUndo()
  const canRedo = history.canRedo()

  return (
    <div
      className="sketch-surface"
      data-testid="sketch-surface"
      data-active-tool={activeTool}
      data-history-revision={historyRevision}
    >
      {/* ── Tool palette (internal — drives the canvas activeTool) ───────── */}
      <div
        className={
          paletteCollapsed
            ? 'sketch-surface__palette sketch-surface__palette--collapsed'
            : 'sketch-surface__palette'
        }
        role="toolbar"
        aria-label="Sketch tools"
        data-testid="sketch-surface-palette"
      >
        <button
          type="button"
          className="sketch-surface__palette-collapse"
          data-testid="sketch-surface-palette-collapse"
          aria-expanded={!paletteCollapsed}
          aria-label={paletteCollapsed ? 'Show sketch tools panel' : 'Hide sketch tools panel'}
          title={
            paletteCollapsed
              ? 'Show sketch tools'
              : 'Hide sketch tools (duplicates the ribbon — use the ribbon instead)'
          }
          onClick={() =>
            setPaletteCollapsed((v) => {
              const next = !v
              try {
                globalThis.localStorage?.setItem('wt.sketch.toolsCollapsed', next ? '1' : '0')
              } catch {
                /* best-effort */
              }
              return next
            })
          }
        >
          {paletteCollapsed ? '☰' : '‹'}
        </button>
        {!paletteCollapsed &&
          TOOL_GROUPS.map((group) => (
          <div key={group} className="sketch-surface__palette-group">
            <div className="sketch-surface__palette-heading">{group}</div>
            {SKETCH_SURFACE_TOOLS.filter((t) => t.group === group).map((t) => {
              const isActive = activeTool === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  className={
                    isActive
                      ? 'sketch-surface__tool sketch-surface__tool--active'
                      : 'sketch-surface__tool'
                  }
                  aria-pressed={isActive}
                  data-testid={`sketch-surface-tool-${t.id}`}
                  data-tool-active={isActive ? 'true' : 'false'}
                  onClick={() => setActiveTool(t.id)}
                >
                  {t.label}
                </button>
              )
            })}
            {group === 'Modify' && (
              /* Construction is an ACTION on the selection (not a draw tool):
                 it toggles the reference-geometry flag on the selected
                 entities in ONE undo step. Disabled with nothing selected. */
              <button
                type="button"
                className="sketch-surface__tool sketch-surface__tool--construction"
                data-testid="sketch-surface-construction"
                disabled={selectedIds.length === 0}
                title="Toggle construction (reference) geometry on the selection — dashed guide geometry: snappable and constrainable, but never part of the solid or CAM toolpaths"
                onClick={handleToggleConstruction}
              >
                Construction
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Canvas column: status row (snap toggle + params) + the canvas ── */}
      <div className="sketch-surface__canvas-col">
        <div
          className="sketch-surface__status"
          role="group"
          aria-label="Sketch options"
          data-testid="sketch-surface-status"
        >
          <button
            type="button"
            className={
              snapEnabled
                ? 'sketch-surface__snap sketch-surface__snap--on'
                : 'sketch-surface__snap'
            }
            aria-pressed={snapEnabled}
            data-testid="sketch-surface-snap-toggle"
            data-snap={snapEnabled ? 'on' : 'off'}
            title="Toggle snap-to-grid (placements lock to the grid lattice)"
            onClick={() => setSnapEnabled((s) => !s)}
          >
            {snapEnabled ? `Snap ${SNAP_GRID_MM} mm` : 'Snap off'}
          </button>

          {/* Sketch S1 — the history seam's visible controls. Disabled states
              mirror the snapshot ring; keyboard twins are Ctrl+Z / Ctrl+Y /
              Ctrl+Shift+Z (catalog matchers) and Delete for the selection. */}
          <button
            type="button"
            className="sketch-surface__history-btn"
            data-testid="sketch-surface-undo"
            disabled={!canUndo}
            aria-keyshortcuts="Control+Z"
            title="Undo (Ctrl+Z)"
            onClick={performUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="sketch-surface__history-btn"
            data-testid="sketch-surface-redo"
            disabled={!canRedo}
            aria-keyshortcuts="Control+Y Control+Shift+Z"
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
            onClick={performRedo}
          >
            Redo
          </button>
          <button
            type="button"
            className="sketch-surface__history-btn sketch-surface__history-btn--delete"
            data-testid="sketch-surface-delete-selected"
            disabled={selectedIds.length === 0}
            aria-keyshortcuts="Delete"
            title="Delete the selected vectors (Delete)"
            onClick={handleDeleteSelected}
          >
            {selectedIds.length > 0 ? `Delete (${selectedIds.length})` : 'Delete'}
          </button>

          {onImportDxf && (
            <button
              type="button"
              className="sketch-surface__import-dxf"
              data-testid="sketch-surface-import-dxf"
              disabled={importingDxf}
              aria-busy={importingDxf}
              title="Import DXF vectors directly onto this sketch (machinable text / sign / clipart outlines)"
              onClick={() => {
                void handleImportDxfClick()
              }}
            >
              {importingDxf ? 'Importing…' : 'Import DXF'}
            </button>
          )}

          {/* Wave 3f — open the Text → machinable-vectors dialog on this surface. */}
          <button
            type="button"
            className="sketch-surface__text-btn"
            data-testid="sketch-surface-text"
            aria-pressed={textDialogOpen}
            title="Insert text as machinable closed contours (sign / lettering vectors)"
            onClick={() => setTextDialogOpen((open) => !open)}
          >
            Text
          </button>

          {/* Wave 3g — Modify launchers: open the offset / boolean / array dialog
              on the currently-selected closed loops (the selection list below). */}
          <button
            type="button"
            className="sketch-surface__edit-btn"
            data-testid="sketch-surface-offset"
            aria-pressed={editDialog === 'offset'}
            title="Offset the selected closed loop(s) by a signed distance (+ outset / − inset)"
            onClick={() => setEditDialog((d) => (d === 'offset' ? null : 'offset'))}
          >
            Offset
          </button>
          <button
            type="button"
            className="sketch-surface__edit-btn"
            data-testid="sketch-surface-boolean"
            aria-pressed={editDialog === 'boolean'}
            title="Boolean union / subtract / intersect of 2+ selected closed loops"
            onClick={() => setEditDialog((d) => (d === 'boolean' ? null : 'boolean'))}
          >
            Boolean
          </button>
          <button
            type="button"
            className="sketch-surface__edit-btn"
            data-testid="sketch-surface-array"
            aria-pressed={editDialog === 'array'}
            title="Rectangular or circular array of the selected entities"
            onClick={() => setEditDialog((d) => (d === 'array' ? null : 'array'))}
          >
            Array
          </button>

          {showFilletParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-fillet-radius">
              Radius (mm)
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={filletRadiusMm}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) setFilletRadiusMm(v)
                }}
              />
            </label>
          )}
          {showChamferParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-chamfer-length">
              Leg (mm)
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={chamferLengthMm}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) setChamferLengthMm(v)
                }}
              />
            </label>
          )}
          {showRotateParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-rotate-deg">
              Angle (deg)
              <input
                type="number"
                step={5}
                value={rotateDeg}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v)) setRotateDeg(v)
                }}
              />
            </label>
          )}
          {showScaleParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-scale-factor">
              Factor (×)
              <input
                type="number"
                min={0.01}
                step={0.1}
                value={scaleFactor}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) setScaleFactor(v)
                }}
              />
            </label>
          )}

          {/* Sketch S5 / S5.1 — honest, conflict-aware DOF badge. Distinct,
              non-blocking, aria-live. The title keeps the approximate ("approx")
              honesty qualifier for every verdict (the local 2D solver has no
              rigorous rank analysis — see `sketch-dof-seam`); the 'conflicting'
              verdict's title additionally explains it is a SETTLED post-solve
              residual conflict the equation count cannot see. An empty sketch
              (status 'empty', blank label) renders no badge. */}
          {dofReport.status !== 'empty' && (
            <span
              className={`sketch-surface__dof sketch-surface__dof--${dofReport.status}`}
              data-testid="sketch-surface-dof-badge"
              data-dof-status={dofReport.status}
              aria-live="polite"
              title={
                dofReport.status === 'conflicting'
                  ? 'The solved sketch has a high residual — constraints/dimensions conflict (approx; not a rigorous rank analysis).'
                  : 'Approximate (approx) degrees of freedom (equations vs. free coordinates — not a rigorous rank analysis).'
              }
            >
              {dofReport.label}
            </span>
          )}

          {/* Over-constraint CONFLICT NAMING (Fusion parity): the leave-one-out
              rank analysis names WHICH constraint fights. Rendered only when
              the badge already shows an over/conflicting verdict (the blame
              memo is gated identically). The Remove button deletes the named
              culprit and re-solves in ONE undo step — the surface's only
              delete-constraint affordance (no constraint-manager panel exists;
              Undo remains the fallback). 'too-large' and 'unresolved' degrade
              to honest generic guidance. */}
          {conflictBlame !== null &&
            conflictBlame.status !== 'independent' &&
            conflictBlame.status !== 'empty' && (
              <span
                className="sketch-surface__conflict"
                data-testid="sketch-surface-conflict-culprit"
                data-blame-status={conflictBlame.status}
                aria-live="polite"
              >
                {conflictBlame.status === 'too-large'
                  ? 'Over-constrained (too large to isolate) — remove recent constraints or Undo.'
                  : conflictCulprits.length === 0
                    ? 'Over-constrained — multiple constraints interact; no single removal resolves it (Undo the recent ones).'
                    : `${dofReport.status === 'conflicting' ? 'Conflicting' : 'Over-constrained'} — ${conflictCulprits[0]!.label} conflicts; remove it or another constraint on these entities.${
                        conflictCulprits.length > 1
                          ? ` Also sufficient: ${conflictCulprits
                              .slice(1)
                              .map((cc) => cc.label)
                              .join(', ')}.`
                          : ''
                      }`}
                {conflictCulprits.length > 0 && (
                  <button
                    type="button"
                    className="sketch-surface__conflict-remove"
                    data-testid="sketch-surface-conflict-remove"
                    title={`Delete ${conflictCulprits[0]!.label} and re-solve (one undo step)`}
                    onClick={() => handleRemoveCulpritConstraint(conflictCulprits[0]!.id)}
                  >
                    Remove
                  </button>
                )}
              </span>
            )}

          <span
            className="sketch-surface__count"
            data-testid="sketch-surface-count"
            aria-live="polite"
          >
            {entityCount} {entityCount === 1 ? 'entity' : 'entities'}
            {pointCount > 0 ? ` · ${pointCount} pts` : ''}
          </span>
        </div>

        {/* Sketch S5 — constraints toolbar. One button per relation; each is
            enabled only when `applicableConstraints` includes it for the current
            selection. Clicking builds the constraint from the selection (pure
            `addConstraintFromSelection`) and re-solves in ONE undo step. */}
        <div
          className="sketch-surface__constraints"
          role="toolbar"
          aria-label="Sketch constraints"
          data-testid="sketch-surface-constraints"
        >
          <span className="sketch-surface__constraints-heading">Constrain</span>
          {TOOLBAR_CONSTRAINT_KINDS.map((kind) => {
            const enabled = applicableConstraintKinds.has(kind)
            return (
              <button
                key={kind}
                type="button"
                className="sketch-surface__constraint-btn"
                data-testid={`sketch-surface-constraint-${kind}`}
                data-constraint-enabled={enabled ? 'true' : 'false'}
                disabled={!enabled}
                title={constraintKindHint(kind)}
                onClick={() => handleApplyConstraint(kind)}
              >
                {constraintKindLabel(kind)}
              </button>
            )
          })}
        </div>

        <div className="sketch-surface__canvas-host" data-testid="sketch-surface-canvas-host">
          <Sketch2DCanvas
            {...canvasSelectionBridge}
            width={CANVAS_BITMAP_W}
            height={CANVAS_BITMAP_H}
            design={design}
            onDesignChange={applyDesignEdit}
            activeTool={activeTool}
            filletRadiusMm={filletRadiusMm}
            chamferLengthMm={chamferLengthMm}
            sketchRotateDeg={rotateDeg}
            sketchScaleFactor={scaleFactor}
            gridMm={gridMm}
            onSketchHint={onSketchHint}
            onCursorWorld={onCursorWorld}
            onToolHotkey={setActiveTool}
            onGridSnapToggle={() => setSnapEnabled((s) => !s)}
            onPlaceDimension={handlePlaceDimension}
            onCommitDimensionValue={handleCommitDimensionValue}
            planeLabel={planeLabel}
            conflictConstraintIds={conflictCulpritIdSet}
          />
          {textDialogOpen && (
            <div className="sketch-surface__text-overlay" data-testid="sketch-surface-text-overlay">
              <TextDialog
                design={design}
                onInsert={(next) => {
                  applyDesignEdit(next)
                }}
                onClose={() => setTextDialogOpen(false)}
                onHint={onSketchHint}
                loadFontBuffer={loadFontBuffer}
              />
            </div>
          )}

          {/* Wave 3g — the offset / boolean / array dialog overlay. Operates on
              the `selectedIds` picked in the loop-selection list; on Apply the
              dialog pushes the additively-merged design through onDesignChange. */}
          {editDialog !== null && (
            <div className="sketch-surface__edit-overlay" data-testid="sketch-surface-edit-overlay">
              {/* Loop selection list — pick the closed loop(s) the op acts on. */}
              <div
                className="sketch-surface__loop-list"
                role="group"
                aria-label="Closed loops"
                data-testid="sketch-surface-loop-list"
              >
                <div className="sketch-surface__loop-list-head">
                  Closed loops ({closedLoopEntities.length})
                </div>
                {closedLoopEntities.length === 0 ? (
                  <div
                    className="sketch-surface__loop-empty"
                    data-testid="sketch-surface-loop-empty"
                  >
                    Draw or import a closed loop to use this tool.
                  </div>
                ) : (
                  closedLoopEntities.map((e) => {
                    const checked = selectedEntityIds.has(e.id)
                    return (
                      <label
                        key={e.id}
                        className="sketch-surface__loop-row"
                        data-testid={`sketch-surface-loop-${e.id}`}
                        data-selected={checked ? 'true' : 'false'}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          data-testid={`sketch-surface-loop-check-${e.id}`}
                          onChange={() => toggleSelected(e.id)}
                        />
                        {entityLabel(e)}
                      </label>
                    )
                  })
                )}
              </div>

              {editDialog === 'offset' && (
                <OffsetSketchDialog
                  design={design}
                  selectedIds={selectedIds}
                  onApply={(next) => applyDesignEdit(next)}
                  onClose={() => setEditDialog(null)}
                  onHint={onSketchHint}
                />
              )}
              {editDialog === 'boolean' && (
                <BooleanSketchDialog
                  design={design}
                  selectedIds={selectedIds}
                  onApply={(next) => applyDesignEdit(next)}
                  onClose={() => setEditDialog(null)}
                  onHint={onSketchHint}
                />
              )}
              {editDialog === 'array' && (
                <ArraySketchDialog
                  design={design}
                  selectedIds={selectedIds}
                  onApply={(next) => applyDesignEdit(next)}
                  onClose={() => setEditDialog(null)}
                  onHint={onSketchHint}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SketchSurface
