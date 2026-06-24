import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { DesignFileV2 } from '../../shared/design-schema'
import {
  isTypableKeyboardTarget,
  matchesSketchCanvasHotkey
} from '../../shared/app-keyboard-shortcuts'
import {
  constraintPickPointIdEdges,
  pickNearestCircularEntityId,
  pickNearestSketchEdge,
  type SketchTrimEdgeRef
} from '../../shared/sketch-profile'
import { clientToCanvasLocal, distSqPointSegment, screenToWorld, snap } from './sketch2d-canvas-coords'
import {
  dragExceedsThreshold,
  entityOutlineWorld,
  hitTestSketchEntities,
  selectPickToleranceMm,
  type EntityOutlineWorld
} from './sketch2d-hit-test'
import {
  entitiesInBox,
  marqueeBoxFromCorners,
  marqueeModeForDrag,
  type MarqueeMode
} from './sketch2d-marquee'
import {
  listEditableNodes,
  moveNode,
  nearestEditableNode,
  nearestPolylineSegment,
  nodeHandlePickToleranceMm
} from './sketch2d-node-edit'
import { inferDrawConstraints, type InferredConstraintKind } from './sketch-inference'
import { inferredAxisConstraints } from './sketch-auto-constraints'
import {
  collectOsnapCandidates,
  collectOsnapCandidatesDetailed,
  osnapToleranceMm,
  resolveDragDeltaWithOsnap,
  resolveSnappedPoint,
  type OsnapCandidate,
  type OsnapResolution
} from './sketch2d-osnap'
import { drawSketch2D, type ConstraintPickHit } from './sketch2d-draw'
import {
  angularLinePointIds,
  dimensionCurrentValue,
  dimensionLabelPickToleranceMm,
  hitTestDimensionLabel,
  nearestPointIdWithin
} from './sketch2d-dimension-pick'
import type { DimensionIntent } from './sketch-dimension-drive'
import {
  categoriseSolveResult,
  initialSketchState,
  sketchReducer,
  sketchToDesign,
  type Sketch,
  type SketchSolveError
} from './sketch-state'
import {
  emptyDraft,
  handleSketchToolClick,
  makeDeterministicIdFactory,
  SKETCH_TOOLS,
  type SketchPick,
  type SketchToolDraft,
  type SketchToolId
} from './sketch-tools'
import { cloneDesign, solveSketch as runLocalSketchSolve, energy } from './solver2d'
import {
  adaptSolveResultToDiagnosis,
  entityStrokeToken,
  mapSolveDiagnosisToStatus,
  selectDofBadgeView,
  type SketchConstraintStatusMap,
  type SketchSolveDiagnosis
} from './sketch-solve-status'
import {
  handleFilletClick,
  handleChamferClick,
  handleTrimClick,
  handleSplitClick,
  handleBreakClick,
  handleExtendClick,
  handlePolygonClick,
  handleSlotCenterClick,
  handleSlotOverallClick,
  handleCircle2ptClick,
  handleCircle3ptClick,
  handleRect3ptClick,
  handleEllipseClick,
  handleMoveClick,
  handleRotateClick,
  handleScaleClick,
  handleMirrorClick,
  handleArcClick,
  handleArcCenterClick,
  handleConstraintPickClick,
  type ToolEditAction,
  type TransformAction
} from './sketch2d-event-handlers'

export type SketchTool =
  | 'select'
  | 'dimension'
  | 'point'
  | 'polygon'
  | 'polyline'
  | 'line'
  | 'rect'
  | 'rect_3pt'
  | 'slot_center'
  | 'slot_overall'
  | 'circle'
  | 'circle_2pt'
  | 'circle_3pt'
  | 'ellipse'
  | 'spline_fit'
  | 'spline_cp'
  | 'arc'
  | 'arc_center'
  | 'trim'
  | 'split'
  | 'break'
  | 'extend'
  | 'fillet'
  | 'chamfer'
  | 'move_sk'
  | 'rotate_sk'
  | 'scale_sk'
  | 'mirror_sk'

type Props = {
  width: number
  height: number
  design: DesignFileV2
  onDesignChange: (next: DesignFileV2) => void
  activeTool: SketchTool
  /** Radius (mm) for sketch corner fillet when `activeTool === 'fillet'`. */
  filletRadiusMm?: number
  /** Leg length (mm) along each edge for sketch chamfer when `activeTool === 'chamfer'`. */
  chamferLengthMm?: number
  gridMm: number
  /** When set, left-clicks pick the nearest sketch vertex (within radius) instead of drawing. */
  constraintPickActive?: boolean
  constraintPickRadiusMm?: number
  onConstraintPointPick?: (pointId: string) => void
  /** When set with callback, after vertex miss: pick nearest polyline edge (pointId endpoints). */
  constraintSegmentPickActive?: boolean
  onConstraintSegmentPick?: (pointIdA: string, pointIdB: string) => void
  /** Left-click in pick mode with no vertex/edge in tolerance. */
  onConstraintPickMiss?: () => void
  /** When set, left-click picks nearest circle/arc entity id. */
  constraintEntityPickActive?: boolean
  onConstraintEntityPick?: (entityId: string) => void
  onSketchHint?: (msg: string) => void
  /**
   * Wave 3n — pass-through OUTPUT of the canvas's own pointer->world value:
   * the snap-resolved point `p` that onMouseMove already computes for the
   * placement/crosshair logic (clientToCanvasLocal -> screenToWorld -> snap),
   * in sketch-plane mm. Fired on every tracked move; fired with `null` when
   * the pointer leaves the canvas. Threaded (NEVER recomputed) up to the
   * shell StatusBar's X/Y read-out. Optional + additive.
   */
  onCursorWorld?: (xyMm: readonly [number, number] | null) => void
  /** Degrees for rotate_sk (ribbon). */
  sketchRotateDeg?: number
  /** Factor for scale_sk (ribbon). */
  sketchScaleFactor?: number
  /** Shown at top-left (e.g. sketch plane name). */
  planeLabel?: string
  /**
   * Sketch S1 — ids of the currently-selected entities (owned upstream by the
   * surface/session). The canvas re-strokes them with the selection highlight
   * and ghosts them during a drag-move. Optional + additive: absent keeps
   * every legacy mount byte-identical.
   */
  selectedEntityIds?: ReadonlySet<string>
  /**
   * Sketch S1 — select-tool pick. `id` is the hit entity (topmost within the
   * ~8 px aperture) or `null` for an empty click; `additive` is Shift. The
   * canvas never mutates selection state itself.
   */
  onEntityPick?: (id: string | null, additive: boolean) => void
  /** Sketch S1 — ONE grid-snapped (dx, dy) per completed drag-move of the selection. */
  onMoveSelected?: (dxMm: number, dyMm: number) => void
  /** Sketch S1 — Delete/Backspace pressed with a non-empty selection (canvas focused). */
  onDeleteSelected?: () => void
  /**
   * Sketch S2 -- node/vertex editing. Active ONLY in select mode with EXACTLY
   * ONE selected entity and this callback wired (absent props keep every
   * legacy mount byte-identical). The canvas renders square node handles for
   * that entity; a completed handle drag emits ONE resolved move and the
   * surface applies the pure `moveNode` (shared point-refs move every
   * referencing entity -- the S1 semantic).
   */
  onNodeMove?: (entityId: string, nodeId: string, point: readonly [number, number]) => void
  /** Sketch S2 -- double-click a segment of the single-selected polyline inserts a vertex. */
  onNodeInsert?: (entityId: string, segmentIndex: number, point: readonly [number, number]) => void
  /** Sketch S2 -- Delete/Backspace with an ARMED (clicked) node deletes that vertex. */
  onNodeDelete?: (entityId: string, nodeId: string) => void
  /**
   * Sketch S3 -- single-key tool hotkeys (S / L / R / C / A / E), fired only
   * while the canvas wrap is hovered or holds focus (never while typing in
   * an input). The canvas owns NO tool state: the surface's EXISTING
   * tool-arming state applies the switch, exactly like a palette click.
   * Optional + additive: absent keeps every legacy mount byte-identical.
   */
  onToolHotkey?: (tool: SketchTool) => void
  /**
   * Sketch S3 -- G pressed (same canvas scoping): flip the surface's
   * EXISTING grid-snap toggle (the Snap button's setter). Optional + additive.
   */
  onGridSnapToggle?: () => void
  /**
   * Sketch S4 -- the DIMENSION tool placed a dimension. The canvas resolves
   * the gesture (click point A then B -> aligned; click a circle/arc entity ->
   * radial, or diameter with Shift held) and emits the placement INTENT; the
   * surface turns it into a DRIVING dimension via `createDrivingDimension` and
   * records ONE undo step. Optional + additive: absent keeps the dimension tool
   * inert (and every legacy mount byte-identical).
   */
  onPlaceDimension?: (intent: DimensionIntent) => void
  /**
   * Sketch S4 -- the operator committed an inline value edit on a dimension's
   * value label (select tool: click the label, retype, Enter/blur). The canvas
   * owns the transient input state locally; on commit it emits ONE (dimId,
   * value) and the surface applies `applyDimensionValue` + re-solve as ONE undo
   * step. Optional + additive: absent disables inline editing entirely.
   */
  onCommitDimensionValue?: (dimensionId: string, value: number) => void
}

const CROSSHAIR_TOOLS: ReadonlySet<SketchTool> = new Set([
  'trim', 'fillet', 'chamfer', 'split', 'break', 'extend', 'point', 'polygon', 'slot_center', 'slot_overall'
])

function getCanvasCursor(
  activeTool: SketchTool,
  constraintPickActive: boolean,
  onConstraintPointPick: ((pointId: string) => void) | undefined,
  onConstraintSegmentPick: ((pointIdA: string, pointIdB: string) => void) | undefined,
  constraintHover: ConstraintPickHit | null,
  constraintEntityPickActive: boolean,
  onConstraintEntityPick: ((entityId: string) => void) | undefined,
  entityHoverId: string | null,
  selectActive: boolean,
  selectHoverId: string | null,
  selectDragging: boolean
): string | undefined {
  if (selectActive) {
    if (selectDragging) return 'grabbing'
    return selectHoverId ? 'move' : 'default'
  }
  if (CROSSHAIR_TOOLS.has(activeTool)) return 'crosshair'
  if (constraintPickActive && (onConstraintPointPick || onConstraintSegmentPick)) {
    return constraintHover ? 'pointer' : 'crosshair'
  }
  if (constraintEntityPickActive && onConstraintEntityPick) {
    return entityHoverId ? 'pointer' : 'crosshair'
  }
  return undefined
}

/**
 * Resolve the target sketch-plane point for a heads-up numeric entry: use a typed X / Y when it
 * parses to a finite number, else fall back to the live (snap-resolved) cursor coordinate. Pure +
 * exported so the HUD's "type to constrain the next point" behaviour is unit-testable in node-env.
 */
export function resolveHudTargetPoint(
  xIn: string,
  yIn: string,
  live: readonly [number, number]
): [number, number] {
  const px = Number.parseFloat(xIn)
  const py = Number.parseFloat(yIn)
  return [Number.isFinite(px) ? px : live[0], Number.isFinite(py) ? py : live[1]]
}

/**
 * Resolve the next sketch point from a heads-up POLAR entry: anchor + (len ∠ angDeg). A blank /
 * non-numeric Length OR Angle falls back to the live segment's value, so typing only Length keeps
 * the live angle (and vice-versa) — the Fusion "type one dimension, leave the rest live" feel. Pure
 * + exported so the HUD's type-to-constrain behaviour is unit-testable in node-env.
 */
export function resolvePolarEntryPoint(
  lenIn: string,
  angDegIn: string,
  anchor: readonly [number, number],
  live: readonly [number, number]
): [number, number] {
  const liveDx = live[0] - anchor[0]
  const liveDy = live[1] - anchor[1]
  const lenParsed = Number.parseFloat(lenIn)
  const len = Number.isFinite(lenParsed) ? lenParsed : Math.hypot(liveDx, liveDy)
  const angParsed = Number.parseFloat(angDegIn)
  const angRad = Number.isFinite(angParsed)
    ? (angParsed * Math.PI) / 180
    : Math.atan2(liveDy, liveDx)
  return [anchor[0] + len * Math.cos(angRad), anchor[1] + len * Math.sin(angRad)]
}

export function Sketch2DCanvas({
  width,
  height,
  design,
  onDesignChange,
  activeTool,
  filletRadiusMm = 2,
  chamferLengthMm = 2,
  gridMm,
  constraintPickActive = false,
  constraintPickRadiusMm = 5,
  onConstraintPointPick,
  constraintSegmentPickActive = false,
  onConstraintSegmentPick,
  onConstraintPickMiss,
  constraintEntityPickActive = false,
  onConstraintEntityPick,
  onSketchHint,
  onCursorWorld,
  sketchRotateDeg = 0,
  sketchScaleFactor = 1,
  planeLabel,
  selectedEntityIds,
  onEntityPick,
  onMoveSelected,
  onDeleteSelected,
  onNodeMove,
  onNodeInsert,
  onNodeDelete,
  onToolHotkey,
  onGridSnapToggle,
  onPlaceDimension,
  onCommitDimensionValue
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { entities, points } = design
  const [scale, setScale] = useState(2.5)
  const [ox, setOx] = useState(0)
  const [oy, setOy] = useState(0)
  const [polyDraft, setPolyDraft] = useState<[number, number][]>([])
  /** First click for two-point open polyline (`line` tool). */
  const [lineStart, setLineStart] = useState<[number, number] | null>(null)
  const [lineHover, setLineHover] = useState<[number, number] | null>(null)
  /** Diameter endpoints for two-click circle (`circle_2pt`). */
  const [circle2ptStart, setCircle2ptStart] = useState<[number, number] | null>(null)
  const [circle2ptHover, setCircle2ptHover] = useState<[number, number] | null>(null)
  /** Three rim picks for circumcircle (`circle_3pt`). */
  const [circle3Draft, setCircle3Draft] = useState<[number, number][]>([])
  const [circle3Hover, setCircle3Hover] = useState<[number, number] | null>(null)
  /** Corner A, B then C for oriented `rect_3pt`. */
  const [rect3Draft, setRect3Draft] = useState<[number, number][]>([])
  const [rect3Hover, setRect3Hover] = useState<[number, number] | null>(null)
  /** Regular polygon: circumcenter, then corner (radius + rotation). */
  const [polygonSides, setPolygonSides] = useState(6)
  const [polygonCenter, setPolygonCenter] = useState<[number, number] | null>(null)
  const [polygonHover, setPolygonHover] = useState<[number, number] | null>(null)
  /** Cap centers (two picks) for `slot_center`; third pick sets width via perpendicular distance. */
  const [slotCenterDraft, setSlotCenterDraft] = useState<[number, number][]>([])
  const [slotWidthHover, setSlotWidthHover] = useState<[number, number] | null>(null)
  /** Overall tip-to-tip picks for `slot_overall`; third pick sets width. */
  const [slotOverallDraft, setSlotOverallDraft] = useState<[number, number][]>([])
  const [slotOverallWidthHover, setSlotOverallWidthHover] = useState<[number, number] | null>(null)
  /** Two clicked positions (mm); third click completes the arc. */
  const [arcDraft, setArcDraft] = useState<[number, number][]>([])
  const [arcHover, setArcHover] = useState<[number, number] | null>(null)
  /** Ellipse: center, major endpoint, then minor (three picks). */
  const [ellipseDraft, setEllipseDraft] = useState<[number, number][]>([])
  const [ellipseHover, setEllipseHover] = useState<[number, number] | null>(null)
  const [splineFitDraft, setSplineFitDraft] = useState<[number, number][]>([])
  const [splineCpDraft, setSplineCpDraft] = useState<[number, number][]>([])
  /** Transform tools: first point (and second for mirror axis). */
  const [xformDraft, setXformDraft] = useState<[number, number][]>([])
  const [arcCloseProfile, setArcCloseProfile] = useState(false)
  const [trimCutter, setTrimCutter] = useState<SketchTrimEdgeRef | null>(null)
  const [extendCutter, setExtendCutter] = useState<SketchTrimEdgeRef | null>(null)
  const [filletFirst, setFilletFirst] = useState<SketchTrimEdgeRef | null>(null)
  const [chamferFirst, setChamferFirst] = useState<SketchTrimEdgeRef | null>(null)
  const [drag, setDrag] = useState<
    | { kind: 'rect'; a: [number, number]; b: [number, number] }
    | { kind: 'circle'; c: [number, number]; r: number }
    | null
  >(null)
  /** While true, mouse move does not overwrite typed dimension fields / drag preview. */
  const lineDimFocused = useRef(false)
  const rectDimFocused = useRef(false)
  const circleDimFocused = useRef(false)
  const [lineDeltaX, setLineDeltaX] = useState('')
  const [lineDeltaY, setLineDeltaY] = useState('')
  const [rectWIn, setRectWIn] = useState('')
  const [rectHIn, setRectHIn] = useState('')
  const [circleRIn, setCircleRIn] = useState('')
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [constraintHover, setConstraintHover] = useState<ConstraintPickHit | null>(null)
  const [entityHoverId, setEntityHoverId] = useState<string | null>(null)

  // ── Sketch S1 — select-tool state (interactions only run when the pick props are wired) ──
  /** In-flight press/drag gesture on the selection (select tool). */
  const selectDragRef = useRef<{
    startWorld: [number, number]
    pickedId: string
    additive: boolean
    /** Pick already emitted on press (fresh pick) — release without movement emits nothing more. */
    pickedOnDown: boolean
    moved: boolean
    /** Sketch S2 -- osnap candidates with the MOVING selection excluded (gesture-scoped). */
    osnapCandidates: OsnapCandidate[]
  } | null>(null)
  /** Live grid-snapped ghost offset while drag-moving the selection (render-only). */
  const [selectGhostOffset, setSelectGhostOffset] = useState<[number, number] | null>(null)
  /** Entity under the cursor in select mode (cursor affordance only). */
  const [selectHoverId, setSelectHoverId] = useState<string | null>(null)
  const selectedCount = selectedEntityIds?.size ?? 0

  useEffect(() => {
    if (activeTool !== 'select') {
      selectDragRef.current = null
      setSelectGhostOffset(null)
      setSelectHoverId(null)
    }
  }, [activeTool])

  // -- Sketch S4 -- DIMENSION tool draft + inline value-edit state --
  // The tool is a two-stage gesture: the FIRST pick (an existing vertex id) is
  // held here; the SECOND pick (another vertex OR a circle/arc entity)
  // completes the placement INTENT emitted via onPlaceDimension.
  // `dimDiameterMode` makes an entity pick a diameter dimension instead of the
  // default radial (toggled in the tool toolbar or by holding Shift).
  const [dimFirstPoint, setDimFirstPoint] = useState<string | null>(null)
  const [dimDiameterMode, setDimDiameterMode] = useState(false)
  // Sketch S5 -- angular dimension sub-mode: when on, the dimension tool picks
  // TWO line segments and emits an `angular` intent. `dimAngularFirstLine` holds
  // the first picked line's ordered (a, b) point ids until the second pick.
  const [dimAngularMode, setDimAngularMode] = useState(false)
  const [dimAngularFirstLine, setDimAngularFirstLine] = useState<{
    aId: string
    bId: string
  } | null>(null)
  // Inline value edit (select tool): the dimension whose value label was
  // clicked + its world anchor (so the input floats on the label), and the
  // controlled text being typed. `null` editingDim = no input open.
  const [editingDim, setEditingDim] = useState<{
    dimId: string
    anchorWorld: [number, number]
  } | null>(null)
  const [editingValue, setEditingValue] = useState('')
  // Guards the inline editor against a DOUBLE finalize: pressing Enter (or Esc)
  // closes the input, and React then fires its `blur` on unmount -- without this
  // latch that blur would commit a SECOND time (two undo steps upstream). Set
  // true on the first finalize; reset to false whenever a fresh editor opens.
  const dimEditDoneRef = useRef(false)

  // Tool switch tears down any in-flight dimension draft (mirrors the other
  // per-tool draft resets); the diameter-mode toggle persists per session.
  useEffect(() => {
    if (activeTool !== 'dimension') {
      setDimFirstPoint(null)
      setDimAngularFirstLine(null)
    }
  }, [activeTool])

  // Leaving select mode (or losing the wiring) closes any open inline editor so
  // a stale input never lingers over a different tool's canvas.
  useEffect(() => {
    if (activeTool !== 'select' || !onCommitDimensionValue) setEditingDim(null)
  }, [activeTool, onCommitDimensionValue])

  // -- Sketch S3 -- marquee box-select state (plain press on EMPTY canvas) --
  /** In-flight marquee gesture; the S1 3 px threshold gates the rubber band. */
  const marqueeRef = useRef<{ startWorld: [number, number]; moved: boolean } | null>(null)
  /** Live rubber-band rectangle while the marquee drags (render-only). */
  const [marqueeRect, setMarqueeRect] = useState<{
    a: [number, number]
    b: [number, number]
    mode: MarqueeMode
  } | null>(null)

  useEffect(() => {
    if (activeTool !== 'select') {
      marqueeRef.current = null
      setMarqueeRect(null)
    }
  }, [activeTool])

  // Sketch S3 -- Escape cancels an in-flight marquee WITHOUT clearing the
  // selection. The listener exists ONLY while the rubber band is live and
  // runs in the window CAPTURE phase so the cancel wins over the
  // canvas-scoped select keys (mirrors the xform Escape listener idiom; the
  // canvas keydown handler itself stays untouched).
  const marqueeActive = marqueeRect !== null
  useEffect(() => {
    if (!marqueeActive) return
    const onMarqueeKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      marqueeRef.current = null
      setMarqueeRect(null)
      ev.preventDefault()
      ev.stopPropagation()
    }
    window.addEventListener('keydown', onMarqueeKey, true)
    return () => window.removeEventListener('keydown', onMarqueeKey, true)
  }, [marqueeActive])

  /**
   * Sketch S3 -- apply a completed marquee through the EXISTING onEntityPick
   * bridge (the canvas never owns selection; upstream updates are
   * functional): Shift ADDS without ever toggling off (already-selected ids
   * are skipped); plain REPLACES (first id replaces, the rest add); an empty
   * plain box clears, exactly like the empty click.
   */
  const applyMarqueeSelection = (ids: readonly string[], additive: boolean): void => {
    if (!onEntityPick) return
    if (ids.length === 0) {
      if (!additive) onEntityPick(null, false)
      return
    }
    if (additive) {
      for (const id of ids) {
        if (!selectedEntityIds?.has(id)) onEntityPick(id, true)
      }
      return
    }
    onEntityPick(ids[0]!, false)
    for (let i = 1; i < ids.length; i++) onEntityPick(ids[i]!, true)
  }

  // Sketch S2 -- object snaps: candidates memoized per design revision
  // (recomputed on design identity change only); both toggles independent
  // (grid snap lives upstream via gridMm; osnap is this canvas's own state).
  const [osnapEnabled, setOsnapEnabled] = useState(true)
  const [osnapHover, setOsnapHover] = useState<OsnapCandidate | null>(null)
  const osnapCollect = useMemo(() => collectOsnapCandidatesDetailed({ design }), [design])
  const osnapCandidates = osnapCollect.candidates
  // Sketch S3 -- intersection-cap truncation flag for the "snap simplified" badge.
  const osnapTruncated = osnapCollect.truncated
  useEffect(() => {
    if (!osnapEnabled) setOsnapHover(null)
  }, [osnapEnabled])

  // -- Sketch S3 -- canvas-scoped hotkeys (documented in the catalog's
  // 'sketch_canvas' group): S/L/R/C/A/E arm tools through the surface's
  // EXISTING tool-arming state (onToolHotkey), F3 flips the EXISTING osnap
  // toggle above, G flips the surface's EXISTING grid-snap toggle
  // (onGridSnapToggle). The listener is window-level but STRICTLY
  // canvas-scoped: it fires only while the canvas wrap is hovered or holds
  // focus, and never while a typable control has focus (the catalog's
  // isTypableKeyboardTarget gate). Latest-callback refs keep the once-only
  // listener from going stale (the SketchSurface keyboard-seam pattern).
  const sketchWrapRef = useRef<HTMLDivElement>(null)
  const wrapHoverRef = useRef(false)
  const hotkeyHandlersRef = useRef({ onToolHotkey, onGridSnapToggle })
  hotkeyHandlersRef.current = { onToolHotkey, onGridSnapToggle }
  useEffect(() => {
    const wrap = sketchWrapRef.current
    if (!wrap) return
    const onWrapPointerEnter = (): void => {
      wrapHoverRef.current = true
    }
    const onWrapPointerLeave = (): void => {
      wrapHoverRef.current = false
    }
    wrap.addEventListener('pointerenter', onWrapPointerEnter)
    wrap.addEventListener('pointerleave', onWrapPointerLeave)
    const onHotkeyDown = (e: KeyboardEvent): void => {
      if (isTypableKeyboardTarget(e.target)) return
      const focusInside = wrap.contains(document.activeElement)
      if (!wrapHoverRef.current && !focusInside) return
      const action = matchesSketchCanvasHotkey(e)
      if (!action) return
      if (action.kind === 'tool') {
        if (hotkeyHandlersRef.current.onToolHotkey) {
          hotkeyHandlersRef.current.onToolHotkey(action.tool)
          e.preventDefault()
        }
        return
      }
      if (action.kind === 'toggleOsnap') {
        setOsnapEnabled((v) => !v)
        e.preventDefault()
        return
      }
      if (hotkeyHandlersRef.current.onGridSnapToggle) {
        hotkeyHandlersRef.current.onGridSnapToggle()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onHotkeyDown)
    return () => {
      wrap.removeEventListener('pointerenter', onWrapPointerEnter)
      wrap.removeEventListener('pointerleave', onWrapPointerLeave)
      window.removeEventListener('keydown', onHotkeyDown)
    }
  }, [])

  /** Sketch S2 -- THE pointer-resolution path: osnap wins within tolerance, else grid lattice. */
  const resolvePointerPlacement = useCallback(
    (raw: readonly [number, number]): OsnapResolution =>
      resolveSnappedPoint({
        raw,
        candidates: osnapCandidates,
        gridMm,
        gridEnabled: true,
        osnapEnabled,
        toleranceMm: osnapToleranceMm(scale)
      }),
    [osnapCandidates, gridMm, osnapEnabled, scale]
  )

  /** Sketch S2 -- drag end-point resolution: same engine, selection-excluded candidates. */
  const resolveSelectDragDelta = (
    sd: { startWorld: [number, number]; osnapCandidates: OsnapCandidate[] },
    rawEnd: readonly [number, number]
  ): { deltaMm: [number, number]; snapped: OsnapCandidate | null } =>
    resolveDragDeltaWithOsnap({
      startWorld: sd.startWorld,
      rawEndWorld: rawEnd,
      candidates: sd.osnapCandidates,
      gridMm,
      osnapEnabled,
      toleranceMm: osnapToleranceMm(scale)
    })

  // -- Sketch S2 -- node/vertex editing state (select tool, EXACTLY ONE selected) --
  /** In-flight node-handle drag; release emits ONE onNodeMove. */
  const nodeDragRef = useRef<{
    entityId: string
    nodeId: string
    startWorld: [number, number]
    moved: boolean
    /** Osnap candidates with the edited entity excluded (a node never snaps to its own entity). */
    osnapCandidates: OsnapCandidate[]
  } | null>(null)
  /** Live resolved ghost for the dragged node (render-only; null = not dragging). */
  const [nodeGhost, setNodeGhost] = useState<{ nodeId: string; point: [number, number] } | null>(
    null
  )
  /**
   * Always-on heads-up read-out: the snap-resolved sketch-plane point under the
   * cursor (mm). Drives the `.sketch-cursor-hud` overlay so the operator can SEE
   * where a point will land + the live length/angle of the segment being drawn,
   * regardless of which tool has its own numeric popover. Render-only; null when
   * the pointer is off the canvas.
   */
  const [hudCursor, setHudCursor] = useState<[number, number] | null>(null)
  // The live inference relation under the cursor (horizontal/vertical/parallel/perpendicular/
  // coincident), or null when free — drives the inference glyph in the read-out.
  const [inferenceKind, setInferenceKind] = useState<InferredConstraintKind | null>(null)
  // Heads-up numeric ENTRY (polyline): editable X/Y strings mirror the live cursor until focused,
  // then the operator types exact coordinates and Enter places the next vertex there. `hudFocused`
  // latches editing so a live mouse move doesn't clobber what's being typed (mirrors lineDimFocused).
  const [hudXIn, setHudXIn] = useState('')
  const [hudYIn, setHudYIn] = useState('')
  // Polar twins of the X/Y entry: Length / Angle of the segment in flight. Tab (on the canvas) focuses
  // Length FIRST; focusing either freezes BOTH (the sync effect bails on `hudFocused`) so the typed
  // dimension holds while the other stays at its live value — the Fusion "type the dimension" entry.
  const [hudLenIn, setHudLenIn] = useState('')
  const [hudAngIn, setHudAngIn] = useState('')
  const hudLenRef = useRef<HTMLInputElement | null>(null)
  const hudAngRef = useRef<HTMLInputElement | null>(null)
  const hudFocused = useRef(false)
  // Cursor position in canvas-local CSS px + per-edge flip flags — floats the read-out at the cursor
  // (offset so it never sits under the crosshair). Frozen while a field is focused so the operator can
  // reach the inputs without the HUD running away. null = pointer off-canvas → CSS corner fallback.
  const [hudScreen, setHudScreen] = useState<{
    x: number
    y: number
    flipX: boolean
    flipY: boolean
  } | null>(null)
  /** Armed (clicked) node -- Delete removes it; Esc or a second click disarms. */
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)

  // Node editing is available ONLY with the select tool, the move callback
  // wired, and EXACTLY ONE selected entity (the Fusion grip convention).
  const nodeEditEntity = useMemo(() => {
    if (activeTool !== 'select' || !onNodeMove || selectedEntityIds?.size !== 1) return null
    return entities.find((e) => selectedEntityIds.has(e.id)) ?? null
  }, [activeTool, onNodeMove, selectedEntityIds, entities])
  const editableNodes = useMemo(
    () => (nodeEditEntity ? listEditableNodes(nodeEditEntity, points) : []),
    [nodeEditEntity, points]
  )

  // Tool switch or a different single target tears down any node gesture.
  useEffect(() => {
    nodeDragRef.current = null
    setNodeGhost(null)
    setActiveNodeId(null)
  }, [activeTool, nodeEditEntity?.id])

  /**
   * Sketch S2 -- node-drag pointer resolution through the SAME osnap engine
   * the placement path uses (`resolveSnappedPoint`), with the edited entity's
   * own candidates excluded so a handle never snaps to the geometry it is
   * reshaping. Grid lattice fallback matches every other placement path.
   */
  const resolveNodeDragPoint = (
    nd: { osnapCandidates: OsnapCandidate[] },
    raw: readonly [number, number]
  ): OsnapResolution =>
    resolveSnappedPoint({
      raw,
      candidates: nd.osnapCandidates,
      gridMm,
      gridEnabled: true,
      osnapEnabled,
      toleranceMm: osnapToleranceMm(scale)
    })

  /** Press in select mode: a node-handle hit arms a node drag (true = consumed). */
  const beginNodeDragAtPoint = (raw: [number, number]): boolean => {
    if (!nodeEditEntity || editableNodes.length === 0) return false
    const hit = nearestEditableNode(editableNodes, raw, nodeHandlePickToleranceMm(scale))
    if (!hit) return false
    nodeDragRef.current = {
      entityId: nodeEditEntity.id,
      nodeId: hit.nodeId,
      startWorld: [raw[0], raw[1]],
      moved: false,
      osnapCandidates: collectOsnapCandidates({ design, excludeEntityIds: [nodeEditEntity.id] })
    }
    setNodeGhost(null)
    return true
  }

  /** Esc steps node editing down first: cancel a live node drag, then disarm. */
  const cancelNodeGestureOnEscape = (ev: React.KeyboardEvent<HTMLCanvasElement>): boolean => {
    if (nodeDragRef.current) {
      nodeDragRef.current = null
      setNodeGhost(null)
      setOsnapHover(null)
      ev.preventDefault()
      ev.stopPropagation()
      return true
    }
    if (activeNodeId !== null) {
      setActiveNodeId(null)
      ev.preventDefault()
      ev.stopPropagation()
      return true
    }
    return false
  }

  /** Press on an entity in select mode: emit the pick when it changes the selection, and arm a drag. */
  const beginSelectGesture = (entityId: string, startWorld: [number, number], additive: boolean): void => {
    const alreadySelected = !!selectedEntityIds?.has(entityId)
    let pickedOnDown = false
    if (!alreadySelected) {
      onEntityPick?.(entityId, additive)
      pickedOnDown = true
    }
    // Sketch S2 -- candidates for THIS gesture exclude every entity the drag
    // will move (the selection receiving the translation), so a dragged
    // entity never snaps to ITSELF or to crossings that move with it.
    const moving =
      alreadySelected || additive ? new Set<string>(selectedEntityIds) : new Set<string>()
    moving.add(entityId)
    const gestureCandidates = osnapEnabled
      ? collectOsnapCandidates({ design, excludeEntityIds: moving })
      : []
    selectDragRef.current = {
      startWorld,
      pickedId: entityId,
      additive,
      pickedOnDown,
      moved: false,
      osnapCandidates: gestureCandidates
    }
    setSelectGhostOffset(null)
  }

  /** Select-mode keys — bound to the CANVAS element (focus-scoped), never to window. */
  const onSelectKeyDown = (ev: React.KeyboardEvent<HTMLCanvasElement>): void => {
    if (ev.key === 'Escape') {
      if (cancelNodeGestureOnEscape(ev)) return
      if (selectDragRef.current) {
        // Cancel an in-flight drag without emitting a move.
        selectDragRef.current = null
        setSelectGhostOffset(null)
        setOsnapHover(null)
        ev.preventDefault()
        ev.stopPropagation()
        return
      }
      if (selectedCount > 0) {
        onEntityPick?.(null, false)
        ev.preventDefault()
        ev.stopPropagation()
      }
      return
    }
    if (
      (ev.key === 'Delete' || ev.key === 'Backspace') &&
      activeNodeId !== null &&
      nodeEditEntity &&
      onNodeDelete
    ) {
      // Sketch S2 -- an ARMED node owns Delete; entity-delete still runs via
      // the branch below when no node is armed.
      onNodeDelete(nodeEditEntity.id, activeNodeId)
      setActiveNodeId(null)
      ev.preventDefault()
      ev.stopPropagation()
      return
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedCount > 0) {
      // stopPropagation: the surface ALSO listens for Delete at window level
      // (its history wiring); a focused canvas owns the keystroke so the two
      // paths never double-dispatch. Unhandled keys (Ctrl+Z/Y) still bubble.
      onDeleteSelected?.()
      ev.preventDefault()
      ev.stopPropagation()
    }
  }

  const viewportSize = useCallback((): { w: number; h: number } => {
    const c = ref.current
    if (!c) return { w: width, h: height }
    const rect = c.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    return { w, h }
  }, [width, height])

  useEffect(() => {
    if (!constraintPickActive) setConstraintHover(null)
  }, [constraintPickActive])
  useEffect(() => {
    if (!constraintEntityPickActive) setEntityHoverId(null)
  }, [constraintEntityPickActive])

  useEffect(() => {
    if (!lineStart) {
      setLineDeltaX('')
      setLineDeltaY('')
    }
  }, [lineStart])

  useEffect(() => {
    if (!lineStart || !lineHover) return
    if (lineDimFocused.current) return
    const dx = lineHover[0] - lineStart[0]
    const dy = lineHover[1] - lineStart[1]
    setLineDeltaX(String(Math.round(dx * 1000) / 1000))
    setLineDeltaY(String(Math.round(dy * 1000) / 1000))
  }, [lineStart, lineHover])

  // Mirror the live cursor into the HUD numeric fields while they aren't being edited.
  useEffect(() => {
    if (hudFocused.current) return
    if (!hudCursor) return
    setHudXIn(String(Math.round(hudCursor[0] * 1000) / 1000))
    setHudYIn(String(Math.round(hudCursor[1] * 1000) / 1000))
  }, [hudCursor])

  // Mirror the live segment's length / angle into the polar HUD fields while neither is being edited.
  // The SAME `hudFocused` latch freezes both the moment the operator Tabs into either field.
  useEffect(() => {
    if (hudFocused.current) return
    const anchor = lineStart ?? (polyDraft.length > 0 ? polyDraft[polyDraft.length - 1]! : null)
    if (!hudCursor || !anchor) {
      setHudLenIn('')
      setHudAngIn('')
      return
    }
    const dx = hudCursor[0] - anchor[0]
    const dy = hudCursor[1] - anchor[1]
    setHudLenIn(String(Math.round(Math.hypot(dx, dy) * 1000) / 1000))
    setHudAngIn(String(Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 1000) / 1000))
  }, [hudCursor, lineStart, polyDraft])

  useEffect(() => {
    if (drag?.kind !== 'rect') {
      setRectWIn('')
      setRectHIn('')
      return
    }
    if (rectDimFocused.current) return
    const w = Math.abs(drag.b[0] - drag.a[0])
    const h = Math.abs(drag.b[1] - drag.a[1])
    setRectWIn(String(Math.max(0, Math.round(w * 1000) / 1000)))
    setRectHIn(String(Math.max(0, Math.round(h * 1000) / 1000)))
  }, [drag])

  useEffect(() => {
    if (drag?.kind !== 'circle') {
      setCircleRIn('')
      return
    }
    if (circleDimFocused.current) return
    setCircleRIn(String(Math.max(0, Math.round(drag.r * 1000) / 1000)))
  }, [drag])

  useEffect(() => {
    setXformDraft([])
  }, [activeTool])

  /** Point IDs for selection-scoped move/rotate/scale/mirror (Shift+click to toggle). */
  const [xformSelectionIds, setXformSelectionIds] = useState<string[]>([])

  useEffect(() => {
    setXformSelectionIds([])
  }, [activeTool])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && xformSelectionIds.length > 0) {
        setXformSelectionIds([])
        onSketchHint?.('Transform selection cleared.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [xformSelectionIds.length, onSketchHint])

  const probeXformVertex = useCallback(
    (wx: number, wy: number): string | null => {
      const pxWorld = 10 / Math.max(scale, 0.05)
      const r = Math.max(constraintPickRadiusMm, pxWorld)
      const r2 = r * r
      let best: { id: string; d2: number } | null = null
      for (const [id, p] of Object.entries(points)) {
        const dx = p.x - wx
        const dy = p.y - wy
        const d2 = dx * dx + dy * dy
        if (d2 <= r2 && (!best || d2 < best.d2)) best = { id, d2 }
      }
      return best?.id ?? null
    },
    [points, scale, constraintPickRadiusMm]
  )

  const probeConstraintPick = useCallback(
    (wx: number, wy: number): ConstraintPickHit | null => {
      const pxWorld = 10 / Math.max(scale, 0.05)
      const r = Math.max(constraintPickRadiusMm, pxWorld)
      const r2 = r * r
      let best: { id: string; d2: number } | null = null
      for (const [id, p] of Object.entries(points)) {
        const dx = p.x - wx
        const dy = p.y - wy
        const d2 = dx * dx + dy * dy
        if (d2 <= r2 && (!best || d2 < best.d2)) best = { id, d2 }
      }
      if (best) return { kind: 'vertex', id: best.id }
      if (constraintSegmentPickActive && onConstraintSegmentPick) {
        const segTol = Math.max(constraintPickRadiusMm, 14 / Math.max(scale, 0.05))
        const segTol2 = segTol * segTol
        let bestSeg: { a: string; b: string; d2: number } | null = null
        for (const { a, b } of constraintPickPointIdEdges(design)) {
          const pa = points[a]
          const pb = points[b]
          if (!pa || !pb) continue
          const d2 = distSqPointSegment(wx, wy, pa.x, pa.y, pb.x, pb.y)
          if (d2 <= segTol2 && (!bestSeg || d2 < bestSeg.d2)) bestSeg = { a, b, d2 }
        }
        if (bestSeg) return { kind: 'segment', a: bestSeg.a, b: bestSeg.b }
      }
      return null
    },
    [
      design,
      points,
      scale,
      constraintPickRadiusMm,
      constraintSegmentPickActive,
      onConstraintSegmentPick
    ]
  )

  useEffect(() => {
    if (activeTool !== 'arc' && activeTool !== 'arc_center') {
      setArcDraft([])
      setArcHover(null)
      setArcCloseProfile(false)
    }
    if (activeTool !== 'trim') {
      setTrimCutter(null)
    }
    if (activeTool !== 'split') {
      setTrimCutter(null)
    }
    if (activeTool !== 'break') {
      setTrimCutter(null)
    }
    if (activeTool !== 'extend') {
      setExtendCutter(null)
    }
    if (activeTool !== 'fillet') {
      setFilletFirst(null)
    }
    if (activeTool !== 'chamfer') {
      setChamferFirst(null)
    }
    if (activeTool !== 'polyline') {
      setPolyDraft([])
    }
    if (activeTool !== 'line') {
      setLineStart(null)
      setLineHover(null)
    }
    if (activeTool !== 'circle_2pt') {
      setCircle2ptStart(null)
      setCircle2ptHover(null)
    }
    if (activeTool !== 'circle_3pt') {
      setCircle3Draft([])
      setCircle3Hover(null)
    }
    if (activeTool !== 'rect_3pt') {
      setRect3Draft([])
      setRect3Hover(null)
    }
    if (activeTool !== 'polygon') {
      setPolygonCenter(null)
      setPolygonHover(null)
    }
    if (activeTool !== 'slot_center') {
      setSlotCenterDraft([])
      setSlotWidthHover(null)
    }
    if (activeTool !== 'slot_overall') {
      setSlotOverallDraft([])
      setSlotOverallWidthHover(null)
    }
  }, [activeTool])

  // -- Sketch S2 -- node-handle overlay (render-only; null = no node editing) --
  // The ghost outline re-tessellates the edited entity through the SAME pure
  // moveNode the release will commit, so the dashed preview IS the result.
  const nodeEditOverlay = useMemo(() => {
    if (!nodeEditEntity || editableNodes.length === 0) return null
    let ghostOutline: EntityOutlineWorld | null = null
    if (nodeGhost) {
      const ghostDesign = moveNode(design, nodeEditEntity.id, nodeGhost.nodeId, nodeGhost.point)
      const ghostEntity = ghostDesign.entities.find((e) => e.id === nodeEditEntity.id)
      ghostOutline = ghostEntity ? entityOutlineWorld(ghostEntity, ghostDesign.points) : null
    }
    return {
      handles: editableNodes.map((n) => {
        const ghost = nodeGhost !== null && nodeGhost.nodeId === n.nodeId ? nodeGhost : null
        return {
          x: ghost ? ghost.point[0] : n.point[0],
          y: ghost ? ghost.point[1] : n.point[1],
          active: n.nodeId === activeNodeId || ghost !== null
        }
      }),
      ghostOutline
    }
  }, [nodeEditEntity, editableNodes, nodeGhost, activeNodeId, design])

  // Sketch S4 -- resolve the dimension first-pick vertex id to coords for the
  // draft ring highlight (null when no pick is in flight or the id is stale).
  const dimensionDraftPoint = useMemo<[number, number] | null>(() => {
    if (dimFirstPoint === null) return null
    const pt = points[dimFirstPoint]
    return pt ? [pt.x, pt.y] : null
  }, [dimFirstPoint, points])

  // Sketch S5 -- the angular tool's first picked line, as a world-space segment
  // (null when no pick is in flight or a point id is stale), for the draft
  // highlight so the operator sees which line side one is measuring from.
  const dimensionAngularFirstLine = useMemo<[[number, number], [number, number]] | null>(() => {
    if (dimAngularFirstLine === null) return null
    const a = points[dimAngularFirstLine.aId]
    const b = points[dimAngularFirstLine.bId]
    if (!a || !b) return null
    return [
      [a.x, a.y],
      [b.x, b.y]
    ]
  }, [dimAngularFirstLine, points])

  const draw = useCallback(() => {
    const c = ref.current
    if (!c) return
    drawSketch2D({
      canvas: c,
      width,
      height,
      design,
      scale,
      ox,
      oy,
      gridMm,
      activeTool,
      planeLabel,
      polyDraft,
      lineStart,
      lineHover,
      circle2ptStart,
      circle2ptHover,
      circle3Draft,
      circle3Hover,
      rect3Draft,
      rect3Hover,
      polygonSides,
      polygonCenter,
      polygonHover,
      slotCenterDraft,
      slotWidthHover,
      slotOverallDraft,
      slotOverallWidthHover,
      arcDraft,
      arcHover,
      ellipseDraft,
      ellipseHover,
      splineFitDraft,
      splineCpDraft,
      xformDraft,
      xformSelectionIds,
      selectedEntityIds,
      selectionGhostOffsetMm: selectGhostOffset,
      osnapMarker: osnapHover,
      nodeEditOverlay,
      marquee: marqueeRect,
      dimensionDraftPoint,
      dimensionAngularFirstLine,
      drag,
      constraintPickActive,
      constraintSegmentPickActive,
      onConstraintSegmentPick,
      constraintHover,
      trimCutter,
      extendCutter,
      viewportSize
    })
  }, [
    width,
    height,
    entities,
    points,
    design.dimensions,
    design.parameters,
    polyDraft,
    lineStart,
    lineHover,
    circle2ptStart,
    circle2ptHover,
    circle3Draft,
    circle3Hover,
    rect3Draft,
    rect3Hover,
    polygonSides,
    polygonCenter,
    polygonHover,
    slotCenterDraft,
    slotWidthHover,
    slotOverallDraft,
    slotOverallWidthHover,
    arcDraft,
    arcHover,
    ellipseDraft,
    ellipseHover,
    splineFitDraft,
    splineCpDraft,
    xformDraft,
    xformSelectionIds,
    selectedEntityIds,
    selectGhostOffset,
    osnapHover,
    nodeEditOverlay,
    marqueeRect,
    dimensionDraftPoint,
    dimensionAngularFirstLine,
    sketchRotateDeg,
    sketchScaleFactor,
    planeLabel,
    activeTool,
    drag,
    scale,
    ox,
    oy,
    gridMm,
    constraintPickActive,
    constraintSegmentPickActive,
    onConstraintSegmentPick,
    constraintHover,
    trimCutter,
    extendCutter,
    viewportSize
  ])

  useEffect(() => {
    draw()
  }, [draw])

  const commitOpenPolylineSegment = useCallback(
    (a: [number, number], b: [number, number]) => {
      const idA = crypto.randomUUID()
      const idB = crypto.randomUUID()
      const eid = crypto.randomUUID()
      // Auto-constraint on draw: persist horizontal / vertical if the segment was snapped on-axis.
      const autoCons = inferredAxisConstraints(
        [
          { id: idA, pt: a },
          { id: idB, pt: b }
        ],
        false,
        new Set(design.constraints.map((c) => c.id))
      )
      onDesignChange({
        ...design,
        points: {
          ...design.points,
          [idA]: { x: a[0], y: a[1] },
          [idB]: { x: b[0], y: b[1] }
        },
        entities: [...design.entities, { id: eid, kind: 'polyline', pointIds: [idA, idB], closed: false }],
        constraints: [...design.constraints, ...autoCons]
      })
    },
    [design, onDesignChange]
  )

  const applyLineNumeric = useCallback(() => {
    if (!lineStart) return
    const dx = Number.parseFloat(lineDeltaX)
    const dy = Number.parseFloat(lineDeltaY)
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      onSketchHint?.('Enter numeric ΔX and ΔY (mm).')
      return
    }
    const end: [number, number] = [snap(lineStart[0] + dx, gridMm), snap(lineStart[1] + dy, gridMm)]
    if (Math.hypot(end[0] - lineStart[0], end[1] - lineStart[1]) < 0.25) {
      onSketchHint?.('Segment length must be greater than ~0.25 mm.')
      return
    }
    commitOpenPolylineSegment(lineStart, end)
    setLineStart(null)
    setLineHover(null)
    onSketchHint?.('Line segment placed.')
  }, [lineStart, lineDeltaX, lineDeltaY, gridMm, commitOpenPolylineSegment, onSketchHint])

  const syncRectDragFromInputs = useCallback(() => {
    if (drag?.kind !== 'rect') return
    const w = Number.parseFloat(rectWIn)
    const h = Number.parseFloat(rectHIn)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return
    const [x1, y1] = drag.a
    const [x2, y2] = drag.b
    const sx = x2 >= x1 ? 1 : -1
    const sy = y2 >= y1 ? 1 : -1
    setDrag({
      kind: 'rect',
      a: drag.a,
      b: [snap(x1 + sx * w, gridMm), snap(y1 + sy * h, gridMm)]
    })
  }, [drag, rectWIn, rectHIn, gridMm])

  const finalizeRectDrag = useCallback(() => {
    if (drag?.kind !== 'rect') return
    const [x1, y1] = drag.a
    const [x2, y2] = drag.b
    let w = Math.abs(x2 - x1)
    let h = Math.abs(y2 - y1)
    if (rectDimFocused.current) {
      const pw = Number.parseFloat(rectWIn)
      const ph = Number.parseFloat(rectHIn)
      if (Number.isFinite(pw) && Number.isFinite(ph) && pw > 0.5 && ph > 0.5) {
        w = pw
        h = ph
      }
    }
    if (w > 0.5 && h > 0.5) {
      const sx = x2 >= x1 ? 1 : -1
      const sy = y2 >= y1 ? 1 : -1
      const nx2 = x1 + sx * w
      const ny2 = y1 + sy * h
      const rcx = (x1 + nx2) / 2
      const rcy = (y1 + ny2) / 2
      const id = crypto.randomUUID()
      onDesignChange({
        ...design,
        entities: [...design.entities, { id, kind: 'rect', cx: rcx, cy: rcy, w, h, rotation: 0 }]
      })
      onSketchHint?.('Rectangle placed.')
    }
    setDrag(null)
  }, [drag, rectWIn, rectHIn, design, onDesignChange, onSketchHint])

  const finalizeCircleDrag = useCallback(() => {
    if (drag?.kind !== 'circle') return
    let r = drag.r
    if (circleDimFocused.current) {
      const pr = Number.parseFloat(circleRIn)
      if (Number.isFinite(pr) && pr > 0.5) {
        r = Math.max(0.5, snap(pr, gridMm))
      }
    }
    if (r > 0.5) {
      const id = crypto.randomUUID()
      onDesignChange({
        ...design,
        entities: [...design.entities, { id, kind: 'circle', cx: drag.c[0], cy: drag.c[1], r }]
      })
      onSketchHint?.('Circle placed.')
      setDrag(null)
    }
  }, [drag, circleRIn, design, onDesignChange, onSketchHint, gridMm])

  function onWheel(ev: React.WheelEvent) {
    ev.preventDefault()
    const factor = ev.deltaY > 0 ? 0.92 : 1.08
    setScale((s) => Math.min(40, Math.max(0.1, s * factor)))
  }

  // Live horizontal/vertical inference while a line/polyline segment is in flight: lock the resolved
  // cursor to the axis (within sketch-inference's cone) UNLESS an object snap already grabbed
  // geometry. Phase A of the sketch rebuild — the Fusion "it snaps straight as you draw" feel.
  function inferDrawPoint(
    point: [number, number],
    objectSnapped: boolean
  ): { point: [number, number]; kind: InferredConstraintKind | null } {
    const anchor: [number, number] | null =
      activeTool === 'line'
        ? lineStart
        : activeTool === 'polyline' && polyDraft.length > 0
          ? polyDraft[polyDraft.length - 1]!
          : null
    if (anchor === null || objectSnapped) return { point, kind: null }
    // The previous polyline segment's direction lets the NEXT segment lock parallel/perpendicular
    // to it (Fusion-style), on top of horizontal/vertical.
    const refs: number[] = []
    if (activeTool === 'polyline' && polyDraft.length >= 2) {
      const prev = polyDraft[polyDraft.length - 2]!
      refs.push(Math.atan2(anchor[1] - prev[1], anchor[0] - prev[0]))
    }
    // The polyline's own earlier vertices are snap targets too (osnap only covers committed
    // geometry), so the cursor can lock coincident onto the start vertex to close the loop. The
    // point radius is a screen-px tolerance converted to world mm so it stays steady as you zoom.
    const snapPts = activeTool === 'polyline' ? polyDraft.slice(0, -1) : []
    const coincidentToleranceMm = 4 / Math.max(scale, 0.05)
    const result = inferDrawConstraints(anchor, point, snapPts, { coincidentToleranceMm }, refs)
    return { point: result.point, kind: result.hints[0] ?? null }
  }

  function onMouseDown(ev: React.MouseEvent) {
    const c = ref.current
    if (!c) return
    if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
      // Sketch S1 — in select mode, Shift+left over an entity is an ADDITIVE
      // pick (CAD convention), not a pan. Shift+left on empty canvas still
      // pans, and middle-drag always pans.
      if (activeTool === 'select' && onEntityPick && ev.button === 0) {
        const [slx, sly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
        const sdpr = Math.max(1, window.devicePixelRatio || 1)
        const sraw = screenToWorld(slx, sly, c.width, c.height, scale * sdpr, ox, oy)
        const sHit = hitTestSketchEntities({
          design,
          worldPoint: sraw,
          toleranceMm: selectPickToleranceMm(scale)
        })
        if (sHit) {
          beginSelectGesture(sHit.entityId, [sraw[0], sraw[1]], true)
          return
        }
      }
      panRef.current = { sx: ev.clientX, sy: ev.clientY, ox, oy }
      return
    }
    if (ev.button !== 0) return
    // `clientToCanvasLocal` now returns BITMAP-space px (it rescales by
    // canvas.width/rect.width when the canvas is CSS-stretched). Map from that
    // same bitmap space: feed the bitmap dimensions and a DPR-scaled px/mm. The
    // DPR factor cancels against the bitmap/CSS ratio, so the world result is
    // identical to the CSS-space mapping at dpr=1 and stays correct at dpr>1.
    const [lx, ly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const raw = screenToWorld(lx, ly, c.width, c.height, scale * dpr, ox, oy)
    // Sketch S2 -- the ONE pointer->world resolution: object snaps win within
    // tolerance, else the grid lattice exactly as before. Phase A: H/V inference
    // then locks the COMMITTED point to the axis (deferring to any object snap).
    const placement = resolvePointerPlacement(raw)
    const w: [number, number] = inferDrawPoint(placement.point, placement.snapped != null).point

    if (constraintPickActive && (onConstraintPointPick || onConstraintSegmentPick)) {
      const action = handleConstraintPickClick(design, raw[0], raw[1], scale, 'vertex_segment', probeConstraintPick, !!onConstraintPointPick, !!onConstraintSegmentPick)
      if (action.tag === 'pointPick') { onConstraintPointPick?.(action.pointId); return }
      if (action.tag === 'segmentPick') { onConstraintSegmentPick?.(action.a, action.b); return }
      onConstraintPickMiss?.()
      return
    }
    if (constraintEntityPickActive && onConstraintEntityPick) {
      const action = handleConstraintPickClick(design, raw[0], raw[1], scale, 'entity', probeConstraintPick, false, false)
      if (action.tag === 'entityPick') onConstraintEntityPick(action.entityId)
      else onConstraintPickMiss?.()
      return
    }

    // Sketch S1 — select tool: resolve the pick at the RAW (unsnapped) click
    // location (picks are exact, like constraint picks); a press on an entity
    // arms a drag-move of the selection. An empty press arms the Sketch S3
    // marquee (its no-drag release still clears; Shift handled in the pan arm
    // above). Unwired mounts do nothing.
    if (activeTool === 'select') {
      // Sketch S4 -- a click on a dimension's VALUE label (resolved at the RAW
      // point, like every other select pick) opens the inline numeric editor
      // pre-filled with the current value. Checked BEFORE the entity hit-test so
      // the label wins over geometry beneath it.
      if (onCommitDimensionValue) {
        const dimHit = hitTestDimensionLabel(design, raw, dimensionLabelPickToleranceMm(scale))
        if (dimHit) {
          const dm = (design.dimensions ?? []).find((d) => d.id === dimHit.dimId)
          const current = dm ? dimensionCurrentValue(dm, design) : null
          dimEditDoneRef.current = false
          setEditingDim({ dimId: dimHit.dimId, anchorWorld: dimHit.anchorWorld })
          setEditingValue(current != null ? String(Math.round(current * 1000) / 1000) : '')
          return
        }
      }
      if (!onEntityPick) return
      if (beginNodeDragAtPoint([raw[0], raw[1]])) return
      const hit = hitTestSketchEntities({
        design,
        worldPoint: raw,
        toleranceMm: selectPickToleranceMm(scale)
      })
      if (hit) {
        beginSelectGesture(hit.entityId, [raw[0], raw[1]], false)
      } else {
        // Sketch S3 -- a plain press on EMPTY canvas arms a marquee instead
        // of clearing immediately: the clear now happens on the NO-DRAG
        // release in onMouseUp (same observable click behavior), and a drag
        // past the S1 threshold rubber-bands a box select.
        marqueeRef.current = { startWorld: [raw[0], raw[1]], moved: false }
        setMarqueeRect(null)
      }
      return
    }

    // Sketch S4 -- DIMENSION tool (two-stage). A circle/arc pick makes a
    // radial (default) or diameter (toolbar toggle / Shift) dimension; a
    // point pick that lands on an EXISTING vertex starts/continues an aligned
    // point-to-point dimension. Both reference live ids only, so the surface's
    // createDrivingDimension never depends on a not-yet-flushed new point.
    // Unwired mounts (no onPlaceDimension) are inert.
    if (activeTool === 'dimension') {
      if (!onPlaceDimension) return
      // Sketch S5 -- angular sub-mode: pick two line segments (polyline edge
      // or arc chord) and emit an `angular` intent. The edge -> point-id pair
      // is resolved purely (`angularLinePointIds`) so the angle constraint
      // reads exactly the picked segment's direction.
      if (dimAngularMode) {
        const edge = pickNearestSketchEdge(design, raw[0], raw[1], 10 / Math.max(scale, 0.05))
        if (!edge) {
          onSketchHint?.('Angular: click a line segment (polyline edge or arc) for each side.')
          return
        }
        const line = angularLinePointIds(design, edge.entityId, edge.edgeIndex)
        if (!line) {
          onSketchHint?.('Angular: that entity has no straight edge to dimension.')
          return
        }
        if (dimAngularFirstLine === null) {
          setDimAngularFirstLine(line)
          onSketchHint?.('Angular: pick the second line.')
          return
        }
        const first = dimAngularFirstLine
        if (first.aId === line.aId && first.bId === line.bId) {
          onSketchHint?.('Angular: pick a DIFFERENT second line.')
          return
        }
        onPlaceDimension({
          kind: 'angular',
          a1Id: first.aId,
          b1Id: first.bId,
          a2Id: line.aId,
          b2Id: line.bId
        })
        setDimAngularFirstLine(null)
        onSketchHint?.('Angular dimension placed.')
        return
      }
      const entHit = pickNearestCircularEntityId(
        design,
        raw[0],
        raw[1],
        Math.max(2, 10 / Math.max(scale, 0.05))
      )
      if (entHit && dimFirstPoint === null) {
        const wantDiameter = dimDiameterMode || ev.shiftKey
        onPlaceDimension(
          wantDiameter
            ? { kind: 'diameter', entityId: entHit.entityId }
            : { kind: 'radial', entityId: entHit.entityId }
        )
        onSketchHint?.(wantDiameter ? 'Diameter dimension placed.' : 'Radius dimension placed.')
        return
      }
      // Aligned point-to-point: each endpoint must snap to a REAL vertex.
      const vid = nearestPointIdWithin(design, raw, osnapToleranceMm(scale))
      if (!vid) {
        onSketchHint?.('Dimension: click a sketch vertex (endpoint snap) for each end.')
        return
      }
      if (dimFirstPoint === null) {
        setDimFirstPoint(vid)
        onSketchHint?.('Dimension: pick the second vertex (or click a circle/arc for radius).')
        return
      }
      if (vid === dimFirstPoint) {
        onSketchHint?.('Dimension: pick a DIFFERENT second vertex.')
        return
      }
      onPlaceDimension({ kind: 'aligned', aId: dimFirstPoint, bId: vid })
      setDimFirstPoint(null)
      onSketchHint?.('Dimension placed.')
      return
    }

    if (
      (activeTool === 'move_sk' ||
        activeTool === 'rotate_sk' ||
        activeTool === 'scale_sk' ||
        activeTool === 'mirror_sk') &&
      ev.altKey
    ) {
      const vid = probeXformVertex(raw[0], raw[1])
      if (vid) {
        setXformSelectionIds((prev) => {
          const s = new Set(prev)
          if (s.has(vid)) s.delete(vid)
          else s.add(vid)
          return Array.from(s)
        })
        onSketchHint?.(
          'Transform: Alt+click toggles vertex selection. Esc clears. With selection, only those points transform.'
        )
        return
      }
    }

    if (activeTool === 'fillet') {
      const action = handleFilletClick(design, raw[0], raw[1], scale, filletFirst, filletRadiusMm)
      if (action.tag === 'setFirstEdge') { setFilletFirst(action.ref); onSketchHint?.(action.hint ?? ''); return }
      if (action.tag === 'clearFirstEdge') { setFilletFirst(null); onSketchHint?.(action.hint); return }
      if (action.tag === 'designChange') { setFilletFirst(null); onDesignChange(action.design); onSketchHint?.(action.hint ?? ''); return }
      onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'chamfer') {
      const action = handleChamferClick(design, raw[0], raw[1], scale, chamferFirst, chamferLengthMm)
      if (action.tag === 'setFirstEdge') { setChamferFirst(action.ref); onSketchHint?.(action.hint ?? ''); return }
      if (action.tag === 'clearFirstEdge') { setChamferFirst(null); onSketchHint?.(action.hint); return }
      if (action.tag === 'designChange') { setChamferFirst(null); onDesignChange(action.design); onSketchHint?.(action.hint ?? ''); return }
      onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'trim') {
      const action = handleTrimClick(design, raw[0], raw[1], scale, trimCutter)
      if (action.tag === 'setFirstEdge') { setTrimCutter(action.ref); onSketchHint?.(action.hint ?? ''); return }
      if (action.tag === 'clearFirstEdge') { setTrimCutter(null); onSketchHint?.(action.hint); return }
      if (action.tag === 'designChange') { setTrimCutter(null); onDesignChange(action.design); onSketchHint?.(action.hint ?? ''); return }
      onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'split') {
      const action = handleSplitClick(design, raw[0], raw[1], scale)
      if (action?.tag === 'designChange') { onDesignChange(action.design); onSketchHint?.(action.hint ?? ''); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'break') {
      const action = handleBreakClick(design, raw[0], raw[1], scale)
      if (action?.tag === 'designChange') { onDesignChange(action.design); onSketchHint?.(action.hint ?? ''); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'extend') {
      const action = handleExtendClick(design, raw[0], raw[1], scale, extendCutter)
      if (action.tag === 'setFirstEdge') { setExtendCutter(action.ref); onSketchHint?.(action.hint ?? ''); return }
      if (action.tag === 'clearFirstEdge') { setExtendCutter(null); onSketchHint?.(action.hint); return }
      if (action.tag === 'designChange') { setExtendCutter(null); onDesignChange(action.design); onSketchHint?.(action.hint ?? ''); return }
      onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'point') {
      const id = crypto.randomUUID()
      onDesignChange({
        ...design,
        points: { ...design.points, [id]: { x: w[0], y: w[1] } }
      })
      onSketchHint?.('Point placed.')
      return
    }

    if (activeTool === 'polygon') {
      if (!polygonCenter) { setPolygonCenter(w); return }
      const action = handlePolygonClick(design, w, polygonCenter, polygonSides)
      if (!action) { setPolygonCenter(w); return }
      if (action.tag === 'designChange') { onDesignChange(action.design); setPolygonCenter(null); setPolygonHover(null); onSketchHint?.(action.hint ?? ''); return }
      if (action.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'slot_center') {
      if (slotCenterDraft.length === 0) { setSlotCenterDraft([w]); return }
      if (slotCenterDraft.length === 1) {
        const c0 = slotCenterDraft[0]!
        if (Math.hypot(w[0] - c0[0], w[1] - c0[1]) < 0.5) { onSketchHint?.('Slot: second center must be away from the first.'); return }
        setSlotCenterDraft([c0, w]); return
      }
      const action = handleSlotCenterClick(design, w, slotCenterDraft)
      if (action?.tag === 'designChange') { onDesignChange(action.design); setSlotCenterDraft([]); setSlotWidthHover(null); onSketchHint?.(action.hint ?? ''); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'slot_overall') {
      if (slotOverallDraft.length === 0) { setSlotOverallDraft([w]); return }
      if (slotOverallDraft.length === 1) {
        const t0 = slotOverallDraft[0]!
        if (Math.hypot(w[0] - t0[0], w[1] - t0[1]) < 0.5) { onSketchHint?.('Slot (overall): second point must be away from the first (tip to tip).'); return }
        setSlotOverallDraft([t0, w]); return
      }
      const action = handleSlotOverallClick(design, w, slotOverallDraft)
      if (action?.tag === 'designChange') { onDesignChange(action.design); setSlotOverallDraft([]); setSlotOverallWidthHover(null); onSketchHint?.(action.hint ?? ''); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'line') {
      if (!lineStart) {
        setLineStart(w)
        lineDimFocused.current = false
        return
      }
      commitOpenPolylineSegment(lineStart, w)
      setLineStart(null)
      setLineHover(null)
      onSketchHint?.('Line segment placed.')
      return
    }

    if (activeTool === 'circle_2pt') {
      if (!circle2ptStart) { setCircle2ptStart(w); return }
      const action = handleCircle2ptClick(design, w, circle2ptStart)
      if (action?.tag === 'designChange') { onDesignChange(action.design); setCircle2ptStart(null); setCircle2ptHover(null); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'circle_3pt') {
      if (circle3Draft.length < 2) {
        setCircle3Draft((d) => d.length === 0 ? [w] : [d[0]!, w])
        return
      }
      const action = handleCircle3ptClick(design, w, circle3Draft)
      if (action?.tag === 'designChange') { onDesignChange(action.design); setCircle3Draft([]); setCircle3Hover(null); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'rect_3pt') {
      if (rect3Draft.length < 2) {
        if (rect3Draft.length === 1 && Math.hypot(w[0] - rect3Draft[0]![0], w[1] - rect3Draft[0]![1]) < 0.5) {
          onSketchHint?.('Rect (3 pt): second point must be away from the first.'); return
        }
        setRect3Draft((d) => d.length === 0 ? [w] : [d[0]!, w]); return
      }
      const action = handleRect3ptClick(design, w, rect3Draft)
      if (action?.tag === 'designChange') { onDesignChange(action.design); setRect3Draft([]); setRect3Hover(null); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'ellipse') {
      if (ellipseDraft.length < 2) {
        if (ellipseDraft.length === 1 && Math.hypot(w[0] - ellipseDraft[0]![0], w[1] - ellipseDraft[0]![1]) < 0.5) {
          onSketchHint?.('Ellipse: second point must be away from center.'); return
        }
        setEllipseDraft((d) => d.length === 0 ? [w] : [d[0]!, w]); return
      }
      const action = handleEllipseClick(design, w, ellipseDraft)
      if (action?.tag === 'designChange') { onDesignChange(action.design); setEllipseDraft([]); setEllipseHover(null); onSketchHint?.(action.hint ?? ''); return }
      if (action?.tag === 'hint') onSketchHint?.(action.message)
      return
    }

    if (activeTool === 'spline_fit') {
      setSplineFitDraft((d) => [...d, w])
      return
    }
    if (activeTool === 'spline_cp') {
      setSplineCpDraft((d) => [...d, w])
      return
    }

    if (activeTool === 'move_sk') {
      const anchor = xformDraft.length > 0 ? xformDraft[0]! : null
      const action = handleMoveClick(design, w, anchor, xformSelectionIds)
      if (action.tag === 'setAnchor') { setXformDraft([w]); return }
      onDesignChange(action.design); setXformDraft([]); onSketchHint?.(action.hint); return
    }
    if (activeTool === 'rotate_sk') {
      const anchor = xformDraft.length > 0 ? xformDraft[0]! : null
      const action = handleRotateClick(design, w, anchor, xformSelectionIds, sketchRotateDeg)
      if (action.tag === 'setAnchor') { setXformDraft([w]); return }
      onDesignChange(action.design); setXformDraft([]); onSketchHint?.(action.hint); return
    }
    if (activeTool === 'scale_sk') {
      const anchor = xformDraft.length > 0 ? xformDraft[0]! : null
      const action = handleScaleClick(design, w, anchor, xformSelectionIds, sketchScaleFactor)
      if (action.tag === 'setAnchor') { setXformDraft([w]); return }
      onDesignChange(action.design); setXformDraft([]); onSketchHint?.(action.hint); return
    }
    if (activeTool === 'mirror_sk') {
      const anchor = xformDraft.length > 0 ? xformDraft[0]! : null
      const action = handleMirrorClick(design, w, anchor, xformSelectionIds)
      if (action.tag === 'setAnchor') { setXformDraft([w]); return }
      onDesignChange(action.design); setXformDraft([]); onSketchHint?.(action.hint); return
    }

    if (activeTool === 'polyline') {
      setPolyDraft((d) => [...d, w])
      return
    }
    if (activeTool === 'rect') {
      setDrag({ kind: 'rect', a: w, b: w })
      return
    }
    if (activeTool === 'circle') {
      setDrag({ kind: 'circle', c: w, r: 0 })
      return
    }
    if (activeTool === 'arc') {
      setArcDraft((d) => {
        if (d.length < 2) return d.length === 0 ? [w] : [d[0]!, w]
        const action = handleArcClick(design, w, d, arcCloseProfile)
        if (action.tag === 'designChange') { onDesignChange(action.design); return [] }
        return d
      })
    }
    if (activeTool === 'arc_center') {
      setArcDraft((d) => {
        if (d.length < 2) return d.length === 0 ? [w] : [d[0]!, w]
        const action = handleArcCenterClick(design, w, d, arcCloseProfile)
        if (action.tag === 'designChange') { onDesignChange(action.design); return [] }
        return d
      })
    }
  }

  function onMouseMove(ev: React.MouseEvent) {
    const c = ref.current
    if (!c) return
    if (panRef.current) {
      const dCanvasX = ev.clientX - panRef.current.sx
      const dCanvasY = ev.clientY - panRef.current.sy
      const dx = dCanvasX / scale
      const ddy = -dCanvasY / scale
      setOx(panRef.current.ox - dx)
      setOy(panRef.current.oy - ddy)
      return
    }
    const [lx, ly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const raw = screenToWorld(lx, ly, c.width, c.height, scale * dpr, ox, oy)
    // Sketch S2 -- same ONE resolution as onMouseDown placements.
    const res = resolvePointerPlacement(raw)
    // Phase A: lock the preview point to horizontal/vertical while drawing (deferring to osnap), so
    // the rubber-band, HUD and committed vertex all agree on the inferred point.
    const inferred = inferDrawPoint(res.point, res.snapped != null)
    const p: [number, number] = inferred.point
    setInferenceKind(inferred.kind)
    // Wave 3n — thread the SAME snap-resolved value the placement logic uses
    // up to the shell StatusBar (pass-through only; nothing recomputed).
    onCursorWorld?.(p)
    // Same resolved point feeds the always-on cursor read-out HUD.
    setHudCursor(p)
    // Float the HUD at the cursor (CSS px in the canvas box). Frozen while a field is focused so the
    // inputs stay reachable; the flip flags keep it on-canvas near the right / bottom edges.
    if (!hudFocused.current) {
      const hr = c.getBoundingClientRect()
      const hx = ev.clientX - hr.left
      const hy = ev.clientY - hr.top
      setHudScreen({ x: hx, y: hy, flipX: hx > hr.width * 0.62, flipY: hy > hr.height * 0.72 })
    }

    // Sketch S2 -- live node-handle drag: ghost the dragged node + the
    // reshaped outline at the resolved point (osnap into OTHER geometry,
    // else grid); the ONE onNodeMove emit happens on release.
    const nd = nodeDragRef.current
    if (nd) {
      if (!nd.moved && dragExceedsThreshold(nd.startWorld, raw, scale)) nd.moved = true
      if (nd.moved) {
        const nodeRes = resolveNodeDragPoint(nd, raw)
        setNodeGhost({ nodeId: nd.nodeId, point: nodeRes.point })
        setOsnapHover(nodeRes.snapped)
        // Sketch S3 (S2 cosmetic) -- readout == ghost: override the full-set
        // emit above with the SAME gesture-scoped (entity-excluded)
        // resolution the ghost just rendered, so the StatusBar X/Y never
        // momentarily disagrees with the dashed node preview mid-drag.
        onCursorWorld?.(nodeRes.point)
      }
      return
    }
    // Sketch S1 — live drag-move of the selection (select tool): track the
    // grid-snapped ghost offset locally; the single onMoveSelected emit
    // happens on release. Hover bookkeeping is suppressed mid-drag.
    const sd = selectDragRef.current
    if (sd) {
      if (!sd.moved && dragExceedsThreshold(sd.startWorld, raw, scale)) sd.moved = true
      if (sd.moved) {
        // Sketch S2 -- ghost == commit: the SAME selection-excluded resolution
        // the release will emit (osnap end-point, else the S1 lattice delta).
        const dragRes = resolveSelectDragDelta(sd, raw)
        setSelectGhostOffset(dragRes.deltaMm)
        setOsnapHover(dragRes.snapped)
        // Sketch S3 (S2 cosmetic) -- readout == ghost: the resolved drag end
        // point IS startWorld + deltaMm (the osnap end point, else the S1
        // lattice delta) -- the SAME selection-excluded value the ghost
        // previews, overriding the full-set emit above.
        onCursorWorld?.([sd.startWorld[0] + dragRes.deltaMm[0], sd.startWorld[1] + dragRes.deltaMm[1]])
      }
      return
    }
    // Sketch S3 -- live marquee on empty canvas: the rubber band appears
    // once the press travels past the SAME S1 drag threshold; the horizontal
    // direction picks the AutoCAD mode live (L->R window, R->L crossing).
    const mq = marqueeRef.current
    if (mq) {
      if (!mq.moved && dragExceedsThreshold(mq.startWorld, raw, scale)) mq.moved = true
      if (mq.moved) {
        setMarqueeRect({
          a: mq.startWorld,
          b: [raw[0], raw[1]],
          mode: marqueeModeForDrag(mq.startWorld, raw)
        })
      }
      return
    }
    // Sketch S2 -- marker only where the resolution drives a placement:
    // hidden in select hover + constraint pick modes (those pick at RAW).
    const markerEligible =
      activeTool !== 'select' &&
      !(constraintPickActive && (onConstraintPointPick || onConstraintSegmentPick)) &&
      !(constraintEntityPickActive && onConstraintEntityPick)
    setOsnapHover(markerEligible ? res.snapped : null)
    if (activeTool === 'select' && onEntityPick) {
      const hover = hitTestSketchEntities({
        design,
        worldPoint: raw,
        toleranceMm: selectPickToleranceMm(scale)
      })
      setSelectHoverId(hover?.entityId ?? null)
    } else {
      setSelectHoverId((prev) => (prev === null ? prev : null))
    }

    if (constraintPickActive && (onConstraintPointPick || onConstraintSegmentPick)) {
      setConstraintHover(probeConstraintPick(raw[0], raw[1]))
    } else {
      setConstraintHover(null)
    }
    if (constraintEntityPickActive && onConstraintEntityPick) {
      const tol = Math.max(2, 10 / Math.max(scale, 0.05))
      const hit = pickNearestCircularEntityId(design, raw[0], raw[1], tol)
      setEntityHoverId(hit?.entityId ?? null)
    } else {
      setEntityHoverId(null)
    }

    if (drag?.kind === 'rect') {
      if (!rectDimFocused.current) {
        setDrag({ ...drag, b: p })
      }
    } else if (drag?.kind === 'circle') {
      if (!circleDimFocused.current) {
        const dx = p[0] - drag.c[0]
        const dy = p[1] - drag.c[1]
        const r = Math.max(0.5, Math.hypot(dx, dy))
        setDrag({ ...drag, r })
      }
    } else if ((activeTool === 'arc' || activeTool === 'arc_center') && arcDraft.length === 2) {
      setArcHover(p)
    } else if (activeTool === 'line' && lineStart) {
      setLineHover(p)
    } else if (activeTool === 'circle_2pt' && circle2ptStart) {
      setCircle2ptHover(p)
    } else if (activeTool === 'circle_3pt' && circle3Draft.length === 2) {
      setCircle3Hover(p)
    } else if (activeTool === 'rect_3pt' && rect3Draft.length === 2) {
      setRect3Hover(p)
    } else if (activeTool === 'ellipse' && ellipseDraft.length === 2) {
      setEllipseHover(p)
    } else if (activeTool === 'polygon' && polygonCenter) {
      setPolygonHover(p)
    } else if (activeTool === 'slot_center' && slotCenterDraft.length === 2) {
      setSlotWidthHover(p)
    } else if (activeTool === 'slot_overall' && slotOverallDraft.length === 2) {
      setSlotOverallWidthHover(p)
    }
  }

  function onMouseUp(ev: React.MouseEvent) {
    if (ev.button === 1 || ev.button === 0) {
      panRef.current = null
    }
    if (ev.button !== 0) return
    // Sketch S2 -- finish a node drag: a real drag emits ONE resolved
    // onNodeMove (one undoable step upstream); an in-place release ARMS the
    // node (click-to-arm; Delete removes it; a second click disarms).
    const nd = nodeDragRef.current
    if (nd) {
      nodeDragRef.current = null
      setNodeGhost(null)
      setOsnapHover(null)
      const nc = ref.current
      if (nd.moved && nc) {
        const [nlx, nly] = clientToCanvasLocal(ev.clientX, ev.clientY, nc)
        const ndpr = Math.max(1, window.devicePixelRatio || 1)
        const nraw = screenToWorld(nlx, nly, nc.width, nc.height, scale * ndpr, ox, oy)
        const placed = resolveNodeDragPoint(nd, nraw).point
        const startNode = editableNodes.find((n) => n.nodeId === nd.nodeId)
        if (!startNode || startNode.point[0] !== placed[0] || startNode.point[1] !== placed[1]) {
          onNodeMove?.(nd.entityId, nd.nodeId, placed)
        }
      } else if (!nd.moved) {
        setActiveNodeId((prev) => (prev === nd.nodeId ? null : nd.nodeId))
      }
      return
    }
    // Sketch S1 — finish a select gesture: a real drag emits ONE grid-snapped
    // move (a single undoable step upstream); an in-place release on an
    // already-selected entity emits the toggle/replace pick instead.
    const sd = selectDragRef.current
    if (sd) {
      selectDragRef.current = null
      setSelectGhostOffset(null)
      setOsnapHover(null)
      const c = ref.current
      if (sd.moved && c) {
        const [lx, ly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
        const dpr = Math.max(1, window.devicePixelRatio || 1)
        const raw = screenToWorld(lx, ly, c.width, c.height, scale * dpr, ox, oy)
        // Sketch S2 -- same selection-excluded resolution the ghost previewed.
        const [dxMm, dyMm] = resolveSelectDragDelta(sd, raw).deltaMm
        if (dxMm !== 0 || dyMm !== 0) onMoveSelected?.(dxMm, dyMm)
      } else if (!sd.moved && !sd.pickedOnDown) {
        onEntityPick?.(sd.pickedId, sd.additive)
      }
      return
    }
    // Sketch S3 -- finish a marquee: a real drag resolves the box select
    // through the pure entitiesInBox (window = fully inside, crossing = any
    // outline touch) with Shift AT RELEASE adding to the selection; a
    // no-drag release keeps today's empty-click clear.
    const mq = marqueeRef.current
    if (mq) {
      marqueeRef.current = null
      setMarqueeRect(null)
      const mc = ref.current
      if (mq.moved && mc) {
        const [mlx, mly] = clientToCanvasLocal(ev.clientX, ev.clientY, mc)
        const mdpr = Math.max(1, window.devicePixelRatio || 1)
        const mraw = screenToWorld(mlx, mly, mc.width, mc.height, scale * mdpr, ox, oy)
        const ids = entitiesInBox({
          design,
          box: marqueeBoxFromCorners(mq.startWorld, mraw),
          mode: marqueeModeForDrag(mq.startWorld, mraw)
        })
        applyMarqueeSelection(ids, ev.shiftKey)
      } else if (!mq.moved) {
        onEntityPick?.(null, false)
      }
      return
    }
    if (drag?.kind === 'rect') {
      finalizeRectDrag()
    }
    if (drag?.kind === 'circle') {
      finalizeCircleDrag()
    }
  }

  /** Sketch S2 -- double-click on the single-selected polyline inserts a vertex on the nearest segment. */
  function onCanvasDoubleClick(ev: React.MouseEvent) {
    if (activeTool !== 'select' || !nodeEditEntity || !onNodeInsert) return
    const c = ref.current
    if (!c) return
    const [lx, ly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const raw = screenToWorld(lx, ly, c.width, c.height, scale * dpr, ox, oy)
    // Segment resolves at the RAW point (picks are exact); the inserted vertex
    // placement resolves through the SAME osnap+grid engine as node drags,
    // with the edited polyline excluded so it cannot snap to itself.
    const seg = nearestPolylineSegment(nodeEditEntity, points, raw, selectPickToleranceMm(scale))
    if (!seg) return
    const placed = resolveSnappedPoint({
      raw,
      candidates: collectOsnapCandidates({ design, excludeEntityIds: [nodeEditEntity.id] }),
      gridMm,
      gridEnabled: true,
      osnapEnabled,
      toleranceMm: osnapToleranceMm(scale)
    })
    onNodeInsert(nodeEditEntity.id, seg.segmentIndex, placed.point)
  }

  function closePolyline() {
    if (polyDraft.length < 3) return
    const ids = polyDraft.map(() => crypto.randomUUID())
    const nextPoints = { ...design.points }
    polyDraft.forEach((pt, i) => {
      nextPoints[ids[i]!] = { x: pt[0], y: pt[1] }
    })
    const id = crypto.randomUUID()
    // Auto-constraint on draw: each side that was snapped on-axis becomes a persisted horizontal /
    // vertical constraint (closed loop, so the final side wraps back to the first vertex).
    const autoCons = inferredAxisConstraints(
      polyDraft.map((pt, i) => ({ id: ids[i]!, pt })),
      true,
      new Set(design.constraints.map((c) => c.id))
    )
    onDesignChange({
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id, kind: 'polyline', pointIds: ids, closed: true }],
      constraints: [...design.constraints, ...autoCons]
    })
    setPolyDraft([])
  }

  function closeSplineFitLoop() {
    if (splineFitDraft.length < 3) return
    const ids = splineFitDraft.map(() => crypto.randomUUID())
    const nextPoints = { ...design.points }
    splineFitDraft.forEach((pt, i) => {
      nextPoints[ids[i]!] = { x: pt[0], y: pt[1] }
    })
    const id = crypto.randomUUID()
    onDesignChange({
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id, kind: 'spline_fit', pointIds: ids, closed: true }]
    })
    setSplineFitDraft([])
    onSketchHint?.('Closed spline (fit) placed.')
  }

  function finishSplineFitOpen() {
    if (splineFitDraft.length < 3) return
    const ids = splineFitDraft.map(() => crypto.randomUUID())
    const nextPoints = { ...design.points }
    splineFitDraft.forEach((pt, i) => {
      nextPoints[ids[i]!] = { x: pt[0], y: pt[1] }
    })
    const id = crypto.randomUUID()
    onDesignChange({
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id, kind: 'spline_fit', pointIds: ids, closed: false }]
    })
    setSplineFitDraft([])
    onSketchHint?.('Open spline (fit) placed.')
  }

  function closeSplineCpLoop() {
    if (splineCpDraft.length < 4) return
    const ids = splineCpDraft.map(() => crypto.randomUUID())
    const nextPoints = { ...design.points }
    splineCpDraft.forEach((pt, i) => {
      nextPoints[ids[i]!] = { x: pt[0], y: pt[1] }
    })
    const id = crypto.randomUUID()
    onDesignChange({
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id, kind: 'spline_cp', pointIds: ids, closed: true }]
    })
    setSplineCpDraft([])
    onSketchHint?.('Closed spline (control) placed.')
  }

  function finishSplineCpOpen() {
    if (splineCpDraft.length < 4) return
    const ids = splineCpDraft.map(() => crypto.randomUUID())
    const nextPoints = { ...design.points }
    splineCpDraft.forEach((pt, i) => {
      nextPoints[ids[i]!] = { x: pt[0], y: pt[1] }
    })
    const id = crypto.randomUUID()
    onDesignChange({
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id, kind: 'spline_cp', pointIds: ids, closed: false }]
    })
    setSplineCpDraft([])
    onSketchHint?.('Open spline (control) placed.')
  }

  function cancelPolyline() {
    setPolyDraft([])
  }

  function cancelArcDraft() {
    setArcDraft([])
    setArcHover(null)
  }

  function cancelCircle3Draft() {
    setCircle3Draft([])
    setCircle3Hover(null)
  }

  function cancelRect3Draft() {
    setRect3Draft([])
    setRect3Hover(null)
  }

  function cancelPolygonDraft() {
    setPolygonCenter(null)
    setPolygonHover(null)
  }

  function cancelSlotCenterDraft() {
    setSlotCenterDraft([])
    setSlotWidthHover(null)
  }

  function cancelSlotOverallDraft() {
    setSlotOverallDraft([])
    setSlotOverallWidthHover(null)
  }

  /**
   * Draw-mode canvas keydown: Fusion "Tab to type the dimension". While a polyline segment is
   * rubber-banding (an anchor exists), Tab moves focus into the heads-up Length field FIRST (Angle is
   * one Tab further); focusing it freezes both fields. Shift+Tab is left to the browser (reverse tab).
   */
  function onDrawKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>): void {
    if (e.key !== 'Tab' || e.shiftKey) return
    if (activeTool !== 'polyline' || !hudCursor || polyDraft.length === 0) return
    e.preventDefault()
    hudLenRef.current?.focus()
    hudLenRef.current?.select()
  }

  return (
    <div className="sketch-wrap" ref={sketchWrapRef}>
      <canvas
        ref={ref}
        width={width}
        height={height}
        className="sketch-canvas"
        data-marquee={marqueeRect ? marqueeRect.mode : undefined}
        tabIndex={
          (activeTool === 'select' && onEntityPick) || activeTool === 'polyline' ? 0 : undefined
        }
        onKeyDown={
          activeTool === 'select' && onEntityPick
            ? onSelectKeyDown
            : activeTool === 'polyline'
              ? onDrawKeyDown
              : undefined
        }
        style={{
          cursor: getCanvasCursor(
            activeTool,
            constraintPickActive,
            onConstraintPointPick,
            onConstraintSegmentPick,
            constraintHover,
            constraintEntityPickActive,
            onConstraintEntityPick,
            entityHoverId,
            activeTool === 'select' && !!onEntityPick,
            selectHoverId,
            selectGhostOffset !== null
          )
        }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDoubleClick={activeTool === 'select' && onNodeInsert ? onCanvasDoubleClick : undefined}
        onMouseLeave={() => {
          panRef.current = null
          // Wave 3n — the source goes inactive; blank the StatusBar read-out.
          onCursorWorld?.(null)
          // ...and blank the always-on cursor HUD — UNLESS a field is being edited (moving the cursor
          // onto a HUD input leaves the canvas; tearing the read-out down would drop the edit).
          if (!hudFocused.current) {
            setHudCursor(null)
            setInferenceKind(null)
            setHudScreen(null)
          }
          // Sketch S1 — cancel any in-flight select drag (no move emitted).
          selectDragRef.current = null
          setSelectGhostOffset(null)
          setSelectHoverId(null)
          // Sketch S3 -- likewise cancel an in-flight marquee (no select).
          marqueeRef.current = null
          setMarqueeRect(null)
          setOsnapHover(null)
          // Sketch S2 -- likewise cancel an in-flight node drag (no emit).
          nodeDragRef.current = null
          setNodeGhost(null)
          setArcHover(null)
          setLineHover(null)
          setCircle2ptHover(null)
          setCircle3Hover(null)
          setRect3Hover(null)
          setPolygonHover(null)
          setSlotWidthHover(null)
          setSlotOverallWidthHover(null)
          setEllipseHover(null)
          setConstraintHover(null)
          setEntityHoverId(null)
        }}
      />
      {hudCursor &&
        (() => {
          const anchor =
            lineStart ?? (polyDraft.length > 0 ? polyDraft[polyDraft.length - 1]! : null)
          const fmt = (n: number): string => {
            const r = Math.round(n * 1000) / 1000
            return Object.is(r, -0) ? '0' : String(r)
          }
          let lenAng: { len: number; ang: number } | null = null
          if (anchor) {
            const dx = hudCursor[0] - anchor[0]
            const dy = hudCursor[1] - anchor[1]
            lenAng = { len: Math.hypot(dx, dy), ang: (Math.atan2(dy, dx) * 180) / Math.PI }
          }
          // The polyline tool has no per-tool numeric popover, so its X/Y become editable here:
          // type exact coordinates and Enter places the next vertex (resolveHudTargetPoint falls
          // back to the live cursor for a blank field). Other tools keep a read-only read-out
          // (line/rect/circle already own their own ΔX-ΔY / W×H / radius popovers).
          const editable = activeTool === 'polyline'
          const commitEntry = (): void => {
            if (!hudCursor) return
            const target = resolveHudTargetPoint(hudXIn, hudYIn, hudCursor)
            setPolyDraft((d) => [...d, target])
            onSketchHint?.('Vertex placed from typed coordinates.')
          }
          const commitPolarEntry = (): void => {
            if (!hudCursor || !anchor) return
            const target = resolvePolarEntryPoint(hudLenIn, hudAngIn, anchor, hudCursor)
            setPolyDraft((d) => [...d, target])
            onSketchHint?.('Vertex placed from typed length / angle.')
            // Unfreeze + hand focus back to the canvas so the next Tab re-arms the entry.
            hudFocused.current = false
            ref.current?.focus()
          }
          return (
            <div
              className="sketch-cursor-hud"
              data-testid="sketch-cursor-hud"
              style={
                hudScreen
                  ? {
                      left: hudScreen.x,
                      top: hudScreen.y,
                      right: 'auto',
                      bottom: 'auto',
                      transform: `translate(${
                        hudScreen.flipX ? 'calc(-100% - 14px)' : '14px'
                      }, ${hudScreen.flipY ? 'calc(-100% - 14px)' : '14px'})`
                    }
                  : undefined
              }
            >
              {inferenceKind && (
                <span className="sketch-cursor-hud__hint" data-testid="sketch-cursor-hud-hint">
                  {inferenceKind === 'horizontal'
                    ? '—'
                    : inferenceKind === 'vertical'
                      ? '|'
                      : inferenceKind === 'parallel'
                        ? '∥'
                        : inferenceKind === 'perpendicular'
                          ? '⊥'
                          : '○'}{' '}
                  {inferenceKind}
                </span>
              )}
              {editable ? (
                <>
                  <label className="sketch-cursor-hud__pair">
                    <b>X</b>
                    <input
                      className="sketch-cursor-hud__input"
                      data-testid="sketch-cursor-hud-x"
                      inputMode="decimal"
                      aria-label="Next vertex X (mm)"
                      value={hudXIn}
                      onFocus={() => {
                        hudFocused.current = true
                      }}
                      onBlur={() => {
                        hudFocused.current = false
                      }}
                      onChange={(e) => setHudXIn(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEntry()
                        } else if (e.key === 'Escape') {
                          e.currentTarget.blur()
                        }
                      }}
                    />
                  </label>
                  <label className="sketch-cursor-hud__pair">
                    <b>Y</b>
                    <input
                      className="sketch-cursor-hud__input"
                      data-testid="sketch-cursor-hud-y"
                      inputMode="decimal"
                      aria-label="Next vertex Y (mm)"
                      value={hudYIn}
                      onFocus={() => {
                        hudFocused.current = true
                      }}
                      onBlur={() => {
                        hudFocused.current = false
                      }}
                      onChange={(e) => setHudYIn(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEntry()
                        } else if (e.key === 'Escape') {
                          e.currentTarget.blur()
                        }
                      }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <span className="sketch-cursor-hud__pair">
                    <b>X</b>
                    {fmt(hudCursor[0])}
                  </span>
                  <span className="sketch-cursor-hud__pair">
                    <b>Y</b>
                    {fmt(hudCursor[1])}
                  </span>
                </>
              )}
              {lenAng &&
                (editable ? (
                  <>
                    <label className="sketch-cursor-hud__pair">
                      <b>L</b>
                      <input
                        ref={hudLenRef}
                        className="sketch-cursor-hud__input"
                        data-testid="sketch-cursor-hud-len"
                        inputMode="decimal"
                        aria-label="Segment length (mm)"
                        value={hudLenIn}
                        onFocus={() => {
                          hudFocused.current = true
                        }}
                        onBlur={() => {
                          hudFocused.current = false
                        }}
                        onChange={(e) => setHudLenIn(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitPolarEntry()
                          } else if (e.key === 'Escape') {
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    </label>
                    <label className="sketch-cursor-hud__pair">
                      <b>∠</b>
                      <input
                        ref={hudAngRef}
                        className="sketch-cursor-hud__input"
                        data-testid="sketch-cursor-hud-ang"
                        inputMode="decimal"
                        aria-label="Segment angle (degrees)"
                        value={hudAngIn}
                        onFocus={() => {
                          hudFocused.current = true
                        }}
                        onBlur={() => {
                          hudFocused.current = false
                        }}
                        onChange={(e) => setHudAngIn(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitPolarEntry()
                          } else if (e.key === 'Escape') {
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <span className="sketch-cursor-hud__pair">
                      <b>L</b>
                      {fmt(lenAng.len)}
                    </span>
                    <span className="sketch-cursor-hud__pair">
                      <b>∠</b>
                      {`${fmt(lenAng.ang)}°`}
                    </span>
                  </>
                ))}
            </div>
          )
        })()}
      <button
        type="button"
        className={
          osnapEnabled ? 'sketch-osnap-toggle sketch-osnap-toggle--on' : 'sketch-osnap-toggle'
        }
        data-testid="sketch-osnap-toggle"
        data-osnap={osnapEnabled ? 'on' : 'off'}
        aria-pressed={osnapEnabled}
        title="Object snap: endpoint, midpoint, center, quadrant, intersection. Independent of grid snap (grid may be off while osnap stays on)."
        onClick={() => setOsnapEnabled((v) => !v)}
      >
        {osnapEnabled ? 'OSNAP on' : 'OSNAP off'}
      </button>

      {/* Sketch S4 -- DIMENSION tool toolbar: prompt + radius/diameter toggle.
          Mirrors the other per-tool toolbars; only rendered with the tool wired. */}
      {activeTool === 'dimension' && onPlaceDimension && (
        <div className="sketch-toolbar sketch-dimension-toolbar" data-testid="sketch-dimension-toolbar">
          <span className="msg">
            {dimAngularMode
              ? dimAngularFirstLine
                ? 'Angular: pick the second line.'
                : 'Angular: pick the first line (polyline edge or arc).'
              : dimFirstPoint
                ? 'Pick the second vertex to dimension (or click a circle/arc for radius/diameter).'
                : 'Click a vertex to start a dimension, or a circle/arc for radius/diameter.'}
          </span>
          <label className="msg label--inline-flex-6">
            <input
              type="checkbox"
              data-testid="sketch-dimension-angular-toggle"
              checked={dimAngularMode}
              onChange={(e) => {
                setDimAngularMode(e.target.checked)
                setDimAngularFirstLine(null)
                setDimFirstPoint(null)
              }}
            />{' '}
            Angular (two lines)
          </label>
          <label className="msg label--inline-flex-6">
            <input
              type="checkbox"
              data-testid="sketch-dimension-diameter-toggle"
              checked={dimDiameterMode}
              disabled={dimAngularMode}
              onChange={(e) => setDimDiameterMode(e.target.checked)}
            />{' '}
            Diameter (circle/arc)
          </label>
          <button
            type="button"
            className="secondary"
            data-testid="sketch-dimension-cancel"
            onClick={() => {
              setDimFirstPoint(null)
              setDimAngularFirstLine(null)
            }}
            disabled={dimFirstPoint === null && dimAngularFirstLine === null}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Sketch S4 -- inline value editor: a small numeric input floating on the
          clicked dimension's value label. Local, transient state; Enter/blur
          commits one (dimId, value) through onCommitDimensionValue (the surface
          applies applyDimensionValue + re-solve as ONE undo step), Esc cancels.
          Positioned via the SAME world->CSS-px map the canvas renderer uses, so
          the box lands exactly on the label `dimensionLabelAnchorWorld` reports. */}
      {editingDim && onCommitDimensionValue && (() => {
        const vp = viewportSize()
        const px = vp.w / 2 + (editingDim.anchorWorld[0] - ox) * scale
        const py = vp.h / 2 - (editingDim.anchorWorld[1] - oy) * scale
        const commit = (): void => {
          if (dimEditDoneRef.current) return
          dimEditDoneRef.current = true
          const v = Number.parseFloat(editingValue)
          if (Number.isFinite(v)) onCommitDimensionValue(editingDim.dimId, v)
          setEditingDim(null)
        }
        const cancel = (): void => {
          if (dimEditDoneRef.current) return
          dimEditDoneRef.current = true
          setEditingDim(null)
        }
        return (
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            className="sketch-dimension-edit-input"
            data-testid="sketch-dimension-edit-input"
            data-dim-id={editingDim.dimId}
            style={{ position: 'absolute', left: `${px}px`, top: `${py}px` }}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                cancel()
              }
            }}
            onBlur={commit}
          />
        )
      })()}

      {osnapEnabled && osnapTruncated && (
        <span
          className="sketch-osnap-simplified-badge"
          data-testid="sketch-osnap-simplified"
          title="Crowded sketch: intersection snaps past the pair cap were skipped this pass. Endpoint / midpoint / center / quadrant snaps stay complete."
        >
          snap simplified
        </span>
      )}
      {activeTool === 'line' && lineStart && (
        <div
          className="sketch-numeric-popover"
          role="group"
          aria-label="Line segment dimensions"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyLineNumeric()
            }
          }}
        >
          <span className="sketch-numeric-popover__title">ΔX / ΔY (mm)</span>
          <label className="sketch-numeric-popover__field">
            <span>ΔX</span>
            <input
              type="text"
              inputMode="decimal"
              className="sketch-numeric-popover__input"
              value={lineDeltaX}
              onChange={(e) => setLineDeltaX(e.target.value)}
              onFocus={() => {
                lineDimFocused.current = true
              }}
              onBlur={() => {
                lineDimFocused.current = false
              }}
            />
          </label>
          <label className="sketch-numeric-popover__field">
            <span>ΔY</span>
            <input
              type="text"
              inputMode="decimal"
              className="sketch-numeric-popover__input"
              value={lineDeltaY}
              onChange={(e) => setLineDeltaY(e.target.value)}
              onFocus={() => {
                lineDimFocused.current = true
              }}
              onBlur={() => {
                lineDimFocused.current = false
              }}
            />
          </label>
          <button type="button" className="primary sketch-numeric-popover__apply" onClick={applyLineNumeric}>
            Apply
          </button>
        </div>
      )}
      {activeTool === 'rect' && drag?.kind === 'rect' && (
        <div
          className="sketch-numeric-popover"
          role="group"
          aria-label="Rectangle dimensions"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              finalizeRectDrag()
            }
          }}
        >
          <span className="sketch-numeric-popover__title">Width × height (mm)</span>
          <label className="sketch-numeric-popover__field">
            <span>W</span>
            <input
              type="text"
              inputMode="decimal"
              className="sketch-numeric-popover__input"
              value={rectWIn}
              onChange={(e) => setRectWIn(e.target.value)}
              onFocus={() => {
                rectDimFocused.current = true
              }}
              onBlur={() => {
                rectDimFocused.current = false
                syncRectDragFromInputs()
              }}
            />
          </label>
          <label className="sketch-numeric-popover__field">
            <span>H</span>
            <input
              type="text"
              inputMode="decimal"
              className="sketch-numeric-popover__input"
              value={rectHIn}
              onChange={(e) => setRectHIn(e.target.value)}
              onFocus={() => {
                rectDimFocused.current = true
              }}
              onBlur={() => {
                rectDimFocused.current = false
                syncRectDragFromInputs()
              }}
            />
          </label>
          <button type="button" className="primary sketch-numeric-popover__apply" onClick={finalizeRectDrag}>
            Place
          </button>
        </div>
      )}
      {activeTool === 'circle' && drag?.kind === 'circle' && (
        <div
          className="sketch-numeric-popover"
          role="group"
          aria-label="Circle radius"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              finalizeCircleDrag()
            }
          }}
        >
          <span className="sketch-numeric-popover__title">Radius (mm)</span>
          <label className="sketch-numeric-popover__field">
            <span>R</span>
            <input
              type="text"
              inputMode="decimal"
              className="sketch-numeric-popover__input"
              value={circleRIn}
              onChange={(e) => {
                const v = e.target.value
                setCircleRIn(v)
                const pr = Number.parseFloat(v)
                if (Number.isFinite(pr) && pr > 0) {
                  setDrag((d) =>
                    d?.kind === 'circle' ? { ...d, r: Math.max(0.5, snap(pr, gridMm)) } : d
                  )
                }
              }}
              onFocus={() => {
                circleDimFocused.current = true
              }}
              onBlur={() => {
                circleDimFocused.current = false
              }}
            />
          </label>
          <button type="button" className="primary sketch-numeric-popover__apply" onClick={finalizeCircleDrag}>
            Place
          </button>
        </div>
      )}
      {activeTool === 'select' && onEntityPick && (
        <div
          className="sketch-toolbar sketch-select-toolbar"
          data-testid="sketch-select-toolbar"
          data-selected-count={selectedCount}
          data-node-editing={onNodeMove ? (nodeEditEntity ? 'true' : 'false') : undefined}
        >
          <span className="msg">
            {selectedCount > 0
              ? `${selectedCount} selected · drag to move · Shift+click adds · Delete removes · Esc clears${nodeEditEntity ? ' · drag a node handle to reshape · double-click a segment to add a node' : ''}`
              : 'Select: click an entity · Shift+click adds · drag a selected entity to move it.'}
          </span>
          <button
            type="button"
            className="secondary"
            data-testid="sketch-select-delete"
            onClick={() => onDeleteSelected?.()}
            disabled={selectedCount === 0}
          >
            Delete
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="sketch-select-clear"
            onClick={() => onEntityPick(null, false)}
            disabled={selectedCount === 0}
          >
            Clear selection
          </button>
        </div>
      )}
      {activeTool === 'point' && (
        <div className="sketch-toolbar">
          <span className="msg">Click to add a construction point (stored in the sketch point map).</span>
        </div>
      )}
      {activeTool === 'slot_center' && (
        <div className="sketch-toolbar">
          <span className="msg">Two cap centers, then a third pick for slot width (perp. to axis).</span>
          <button
            type="button"
            className="secondary"
            onClick={cancelSlotCenterDraft}
            disabled={slotCenterDraft.length === 0}
          >
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'slot_overall' && (
        <div className="sketch-toolbar">
          <span className="msg">
            Two tips (overall length along axis), then a third pick for width — stored as center-to-center length.
          </span>
          <button
            type="button"
            className="secondary"
            onClick={cancelSlotOverallDraft}
            disabled={slotOverallDraft.length === 0}
          >
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'polygon' && (
        <div className="sketch-toolbar">
          <label className="msg label--inline-flex-6">
            Sides
            <input
              type="number"
              min={3}
              max={128}
              value={polygonSides}
              onChange={(ev) => {
                const v = Number(ev.target.value)
                if (!Number.isFinite(v)) return
                setPolygonSides(Math.max(3, Math.min(128, Math.floor(v))))
              }}
              className="input-w-56"
            />
          </label>
          <span className="msg">Center, then corner — closed polyline.</span>
          <button type="button" className="secondary" onClick={cancelPolygonDraft} disabled={!polygonCenter}>
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'line' && (
        <div className="sketch-toolbar">
          <span className="msg">Click start, then end — each segment is an open polyline.</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setLineStart(null)
              setLineHover(null)
              lineDimFocused.current = false
            }}
            disabled={!lineStart}
          >
            Cancel segment
          </button>
        </div>
      )}
      {activeTool === 'circle_2pt' && (
        <div className="sketch-toolbar">
          <span className="msg">Click two points on opposite ends of the diameter.</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setCircle2ptStart(null)
              setCircle2ptHover(null)
            }}
            disabled={!circle2ptStart}
          >
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'circle_3pt' && (
        <div className="sketch-toolbar">
          <span className="msg">Three non-collinear points on the circle (circumcircle).</span>
          <button type="button" className="secondary" onClick={cancelCircle3Draft} disabled={circle3Draft.length === 0}>
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'rect_3pt' && (
        <div className="sketch-toolbar">
          <span className="msg">First edge (two clicks), then third point for rectangle height.</span>
          <button type="button" className="secondary" onClick={cancelRect3Draft} disabled={rect3Draft.length === 0}>
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'ellipse' && (
        <div className="sketch-toolbar">
          <span className="msg">Center → major axis → minor extent (perp. distance).</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEllipseDraft([])
              setEllipseHover(null)
            }}
            disabled={ellipseDraft.length === 0}
          >
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'spline_fit' && (
        <div className="sketch-toolbar">
          <button type="button" className="secondary" onClick={closeSplineFitLoop} disabled={splineFitDraft.length < 3}>
            Close loop
          </button>
          <button type="button" className="secondary" onClick={finishSplineFitOpen} disabled={splineFitDraft.length < 3}>
            Finish open
          </button>
          <button type="button" className="secondary" onClick={() => setSplineFitDraft([])} disabled={splineFitDraft.length === 0}>
            Clear
          </button>
        </div>
      )}
      {activeTool === 'spline_cp' && (
        <div className="sketch-toolbar">
          <button type="button" className="secondary" onClick={closeSplineCpLoop} disabled={splineCpDraft.length < 4}>
            Close loop
          </button>
          <button type="button" className="secondary" onClick={finishSplineCpOpen} disabled={splineCpDraft.length < 4}>
            Finish open
          </button>
          <button type="button" className="secondary" onClick={() => setSplineCpDraft([])} disabled={splineCpDraft.length === 0}>
            Clear
          </button>
        </div>
      )}
      {(activeTool === 'move_sk' ||
        activeTool === 'rotate_sk' ||
        activeTool === 'scale_sk' ||
        activeTool === 'mirror_sk') && (
        <div className="sketch-toolbar">
          <span className="msg">
            {activeTool === 'move_sk' &&
              (xformSelectionIds.length > 0
                ? 'Move: Alt+click toggles vertices · Esc clears · two-click moves selection only.'
                : 'Move: two-click moves entire sketch · Alt+click vertices to move selection only.')}
            {activeTool === 'rotate_sk' &&
              (xformSelectionIds.length > 0
                ? `Rotate selection: pivot · ${sketchRotateDeg}° · Alt+click vertices · Esc clears selection.`
                : `Rotate sketch: click pivot (${sketchRotateDeg}°) · Alt+click vertices for selection-only.`)}
            {activeTool === 'scale_sk' &&
              (xformSelectionIds.length > 0
                ? `Scale selection: pivot · ×${sketchScaleFactor} · Alt+click vertices · Esc clears.`
                : `Scale sketch: click pivot (×${sketchScaleFactor}) · Alt+click vertices for selection-only.`)}
            {activeTool === 'mirror_sk' &&
              (xformSelectionIds.length > 0
                ? 'Mirror selection: axis A→B · Alt+click vertices · Esc clears.'
                : 'Mirror sketch: axis A→B · Alt+click vertices for selection-only.')}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => setXformSelectionIds([])}
            disabled={xformSelectionIds.length === 0}
          >
            Clear selection
          </button>
          <button type="button" className="secondary" onClick={() => setXformDraft([])} disabled={xformDraft.length === 0}>
            Clear
          </button>
        </div>
      )}
      {activeTool === 'polyline' && (
        <div className="sketch-toolbar">
          <button type="button" className="secondary" onClick={closePolyline} disabled={polyDraft.length < 3}>
            Close loop
          </button>
          <button type="button" className="secondary" onClick={cancelPolyline}>
            Cancel
          </button>
        </div>
      )}
      {activeTool === 'arc' && (
        <div className="sketch-toolbar">
          <span className="msg mr-2">Start → point on arc → end (non-collinear)</span>
          <label className="msg mr-2">
            <input
              type="checkbox"
              checked={arcCloseProfile}
              onChange={(ev) => setArcCloseProfile(ev.target.checked)}
            />{' '}
            Closed profile (chord)
          </label>
          <button type="button" className="secondary" onClick={cancelArcDraft} disabled={arcDraft.length === 0}>
            Cancel arc
          </button>
        </div>
      )}
      {activeTool === 'arc_center' && (
        <div className="sketch-toolbar">
          <span className="msg mr-2">Center → start (radius) → end (minor arc on that circle)</span>
          <label className="msg mr-2">
            <input
              type="checkbox"
              checked={arcCloseProfile}
              onChange={(ev) => setArcCloseProfile(ev.target.checked)}
            />{' '}
            Closed profile (chord)
          </label>
          <button type="button" className="secondary" onClick={cancelArcDraft} disabled={arcDraft.length === 0}>
            Cancel arc
          </button>
        </div>
      )}
      {activeTool === 'fillet' && (
        <div className="sketch-toolbar">
          <span className="msg">
            {filletFirst
              ? 'Second click: other edge at the same corner (same polyline, consecutive segment).'
              : 'First click: one polyline edge at the corner to round.'}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFilletFirst(null)
              onSketchHint?.('Fillet first edge cleared.')
            }}
            disabled={!filletFirst}
          >
            Clear first edge
          </button>
        </div>
      )}
      {activeTool === 'chamfer' && (
        <div className="sketch-toolbar">
          <span className="msg">
            {chamferFirst
              ? 'Second click: other edge at the same corner (same polyline, consecutive segment).'
              : 'First click: one polyline edge at the corner to chamfer.'}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setChamferFirst(null)
              onSketchHint?.('Chamfer first edge cleared.')
            }}
            disabled={!chamferFirst}
          >
            Clear first edge
          </button>
        </div>
      )}
      {activeTool === 'trim' && (
        <div className="sketch-toolbar">
          <span className="msg">
            {trimCutter
              ? 'Second click: target edge. Cutter: polyline → infinite line; arc → full circle. Click the side to discard.'
              : 'First click: cutting edge (polyline segment or arc).'}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setTrimCutter(null)
              onSketchHint?.('Trim cutter cleared.')
            }}
            disabled={!trimCutter}
          >
            Clear cutter
          </button>
        </div>
      )}
      {activeTool === 'split' && (
        <div className="sketch-toolbar">
          <span className="msg">Click a polyline edge or arc to split at the clicked location.</span>
        </div>
      )}
      {activeTool === 'break' && (
        <div className="sketch-toolbar">
          <span className="msg">Click a polyline edge or arc to break into two disconnected entities.</span>
        </div>
      )}
      {activeTool === 'extend' && (
        <div className="sketch-toolbar">
          <span className="msg">
            {extendCutter
              ? 'Second click: target edge to extend (click near the end you want to extend).'
              : 'First click: boundary edge or arc to extend toward.'}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => setExtendCutter(null)}
            disabled={!extendCutter}
          >
            Clear boundary
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MvpSketchCanvas (CAD V1 MVP sketcher)
// ============================================================================
//
// Self-contained 2D sketch editor built on the new ``sketch-state.ts`` +
// ``sketch-tools.ts`` modules. Renders to its own ``<canvas>`` -- it does
// NOT share the legacy ``Sketch2DCanvas`` pipeline above. The MVP path is
// deliberately independent so the existing DesignWorkspace flow keeps
// rendering through the legacy code while the new sketcher matures.
//
// Layout (column-stacked, token-driven):
//   ┌───────────────────────────────────────────────────────┐
//   │ [tool palette]      [solve / clear ribbon]            │
//   ├──────────┬────────────────────────────────────────────┤
//   │          │                                            │
//   │  Tool    │   <canvas>  (grid + entities + draft)      │
//   │  list    │                                            │
//   │          │                                            │
//   └──────────┴────────────────────────────────────────────┘
//   [solver banner: hidden | success | error]
//
// All non-canvas chrome uses ``.sketch-mvp-*`` BEM classes (no Tailwind);
// inline styles fall back to design-token vars so a follow-on CSS pass
// can theme without touching this file. The canvas itself uses fixed
// integer width / height (parent supplies via props -- defaults to a
// reasonable 800 x 600).

type MvpProps = {
  width?: number
  height?: number
  gridMm?: number
  /** Debounce window (ms) for auto-solve. 0 disables auto-solve. */
  autoSolveDebounceMs?: number
  /** Override the global crypto-based id factory (tests). */
  idFactory?: (prefix: 'p' | 'e' | 'c') => string
  /** Disable the canvas + render path (tests / SSR). */
  headless?: boolean
}

/** Vertex-pick tolerance in screen pixels (converted to world mm via scale). */
const MVP_PICK_PX = 10
/** Entity-pick tolerance (for radius constraints) in screen pixels. */
const MVP_ENTITY_PICK_PX = 12

export function MvpSketchCanvas({
  width = 800,
  height = 600,
  gridMm = 5,
  autoSolveDebounceMs = 250,
  idFactory,
  headless = false
}: MvpProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [state, dispatch] = useReducer(sketchReducer, undefined, initialSketchState)
  const [activeToolId, setActiveToolId] = useState<SketchToolId>('select')
  const [draft, setDraft] = useState<SketchToolDraft>(emptyDraft)
  const [numericInput, setNumericInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [solverError, setSolverError] = useState<SketchSolveError | null>(null)
  const [lastResidual, setLastResidual] = useState<number | null>(null)
  /**
   * Normalised solver diagnosis (DOF / status / conflicting-constraint ids)
   * from the most recent solve, or ``null`` before the first solve. Drives the
   * DOF badge and the per-entity colour-highlighting. Decoupled from the IPC
   * wire shape via ``adaptSolveResultToDiagnosis`` so the mapper stays pure.
   */
  const [diagnosis, setDiagnosis] = useState<SketchSolveDiagnosis | null>(null)
  /**
   * True only when the active ``diagnosis`` came from the sidecar's real DOF
   * analysis (``window.fab.cad.solveSketch`` → planegcs ``diagnose()``). The
   * local energy-minimising fallback has no DOF concept, so when it produces
   * the solve this stays ``false`` and the badge reads a neutral "Solved"
   * instead of asserting a (possibly false) "Fully constrained". See
   * ``selectDofBadgeView`` for the honesty contract.
   */
  const [dofAuthoritative, setDofAuthoritative] = useState(false)
  /**
   * True while a sidecar ``window.fab.cad.solveSketch`` IPC round-trip is
   * in flight. The Solve button reflects this with a disabled state + a
   * ``data-solving`` attribute so the render-pin tests can pin the
   * loading affordance.
   */
  const [solving, setSolving] = useState(false)
  // View transform (mm per pixel + origin); fixed in the MVP -- no pan/zoom yet.
  const scale = 4
  const ox = 0
  const oy = 0
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Responsive sizing ──────────────────────────────────────────────────────
  // The canvas used to be a FIXED ``width``x``height`` bitmap that the cockpit
  // CSS then stretched to fill the pane, so ``rect.width !== width`` and every
  // pointer→world map landed offset (the "mouse doesn't line up with the grid"
  // bug). We now measure the host element and size the bitmap to its displayed
  // CSS box (×devicePixelRatio for crispness). The pointer path reads the SAME
  // measured size, so a click on a rendered grid intersection lands on the exact
  // world mm of that intersection. ``viewport`` falls back to the ``width`` /
  // ``height`` props until the first ResizeObserver callback (and in headless /
  // SSR where there is no layout engine).
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: width, h: height })
  /** Snap pointer placements to the ``gridMm`` lattice. Toggleable (Fusion-style). */
  const [snapEnabled, setSnapEnabled] = useState(true)
  /** Live cursor position in world mm (for the read-out + numeric-draw direction). */
  const [cursorWorld, setCursorWorld] = useState<[number, number] | null>(null)

  useEffect(() => {
    if (headless) return
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const r = host.getBoundingClientRect()
      const w = Math.max(1, Math.floor(r.width))
      const h = Math.max(1, Math.floor(r.height))
      setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [headless])

  /**
   * The drawable CSS size in px. When the host has been measured it is the live
   * box; before that (and in headless/SSR) it falls back to the props so the
   * world math + grid stay self-consistent.
   */
  const viewW = headless ? width : viewport.w
  const viewH = headless ? height : viewport.h

  const tool = useMemo(() => SKETCH_TOOLS.find((t) => t.id === activeToolId)!, [activeToolId])

  /**
   * Per-entity / per-constraint UI flags derived from the latest solver
   * diagnosis. Recomputed whenever the sketch or the diagnosis changes so the
   * canvas tints geometry (under = blue, fully = black, conflicting = red) and
   * the DOF badge reflects the current solve. ``null`` diagnosis (pre-first-
   * solve) yields a neutral under-constrained map so freshly-drawn geometry
   * reads as "still free" rather than mis-claiming "fully constrained".
   */
  const statusMap: SketchConstraintStatusMap = useMemo(
    () => mapSolveDiagnosisToStatus(state.sketch, diagnosis ?? {}),
    [state.sketch, diagnosis]
  )

  // Reset draft + numeric input when the user switches tools.
  useEffect(() => {
    setDraft(emptyDraft)
    setNumericInput('')
  }, [activeToolId])

  /**
   * Solve the current sketch, preferring the sidecar ``window.fab.cad.solveSketch``
   * IPC bridge when available (richer planegcs-backed solver, Wave 2 commit
   * 96e6019). Falls back to the local renderer-side ``solver2d`` when the
   * bridge is missing (test / SSR / non-Electron environments). Either
   * path produces a ``{ points, residual }`` payload that flows through
   * ``categoriseSolveResult`` so the UI banners speak one language.
   */
  const runSolve = useCallback(
    async (sketch: Sketch) => {
      if (sketch.constraints.length === 0) {
        setSolverError(null)
        setLastResidual(null)
        setDiagnosis(null)
        setDofAuthoritative(false)
        return
      }
      const designIn = sketchToDesign(sketch)
      // Read off the IPC bridge defensively: tests + SSR + dev hot-reload
      // can all surface a window without the ``fab.cad.solveSketch`` shape.
      // The result type widens ``CadSolveSketchResult``'s additive DOF
      // diagnostics (status / dof / conflicting+redundant ids) so the live
      // badge + entity highlighting can read them (Gap #3, additive).
      const bridge =
        typeof window !== 'undefined'
          ? (window as unknown as {
              fab?: {
                cad?: {
                  solveSketch?: (payload: {
                    sketch: Record<string, unknown>
                    constraints: unknown[]
                  }) => Promise<
                    | {
                        ok: true
                        result: {
                          points: Record<string, { x: number; y: number; fixed?: boolean }>
                          residual?: number
                          dof?: number
                          status?: 'fully' | 'under' | 'over' | 'conflicting'
                          conflictingConstraintIds?: string[]
                          redundantConstraintIds?: string[]
                        }
                      }
                    | { ok: false; error: string; hint?: string }
                  >
                }
              }
            }).fab?.cad?.solveSketch
          : undefined
      let solvedPoints: Record<string, { x: number; y: number; fixed?: boolean }>
      let residual: number | undefined
      /**
       * The bridge's DOF diagnosis when the sidecar path ran; ``null`` on the
       * local-fallback path (solver2d has no DOF concept — we synthesise a
       * residual-based diagnosis after categorising below).
       */
      let bridgeDiagnosis: SketchSolveDiagnosis | null = null

      /**
       * The local energy-minimising solve. Used when the IPC bridge is absent
       * (tests / SSR / pre-bridge boot) AND as a graceful fallback when a
       * present bridge call fails — a broken or unavailable sidecar solve
       * degrades to a working local solve rather than spamming a per-keystroke
       * error banner. Returns the solved points, or ``null`` if the local
       * solver itself threw (in which case the error banner is surfaced).
       */
      const runLocalSolve = (): Record<
        string,
        { x: number; y: number; fixed?: boolean }
      > | null => {
        try {
          const cloned = cloneDesign(designIn)
          const solved = runLocalSketchSolve(cloned, 80, 0.35)
          residual = energy(solved)
          return Object.fromEntries(
            Object.entries(solved.points).map(([k, v]) => [k, { x: v.x, y: v.y, fixed: v.fixed }])
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setSolverError({ kind: 'numerical', message: `Solver crashed: ${message}` })
          setLastResidual(null)
          return null
        }
      }

      if (typeof bridge === 'function') {
        setSolving(true)
        let fromBridge: Record<string, { x: number; y: number; fixed?: boolean }> | null = null
        try {
          const res = await bridge({
            sketch: designIn as unknown as Record<string, unknown>,
            constraints: designIn.constraints as unknown as unknown[]
          })
          if (res.ok) {
            fromBridge = res.result.points
            residual = res.result.residual
            bridgeDiagnosis = adaptSolveResultToDiagnosis(res.result)
          }
          // res.ok === false → leave fromBridge null and fall back to the local
          // solver below. The sidecar solve path is currently inert (the
          // IPC↔sidecar param/return contract is mismatched and planegcs is not
          // bundled — tracked as a dedicated task), so degrading keeps live
          // solving working instead of erroring on every edit.
        } catch {
          // Bridge threw (no sidecar / transport error) → graceful local fallback.
        } finally {
          setSolving(false)
        }
        if (fromBridge) {
          solvedPoints = fromBridge
        } else {
          const local = runLocalSolve()
          if (!local) return
          solvedPoints = local
        }
      } else {
        const local = runLocalSolve()
        if (!local) return
        solvedPoints = local
      }
      const outcome = categoriseSolveResult(sketch, solvedPoints, residual)
      if (!outcome.ok) {
        setSolverError(outcome.error)
        setLastResidual(outcome.error.residual ?? null)
        // An error path always carries a verdict — the bridge's structured DOF
        // report, or the local categoriser's over/under heuristic — so the
        // badge shows it (authoritative). Surface a diagnosis even here so
        // geometry still tints.
        setDofAuthoritative(true)
        setDiagnosis(
          bridgeDiagnosis ?? {
            status: outcome.error.kind === 'over-constrained' ? 'over' : 'under'
          }
        )
        return
      }
      setSolverError(null)
      setLastResidual(outcome.residual ?? null)
      // Converged. The bridge supplies a real DOF verdict; the local solver
      // cannot distinguish "fully" from "under" (it only minimises energy), so
      // we tint geometry as resolved (status 'fully' = the normal
      // defined-geometry colour) but keep ``dofAuthoritative`` false — the badge
      // then reads the honest "Solved" rather than a possibly-false
      // "Fully constrained".
      setDofAuthoritative(bridgeDiagnosis !== null)
      setDiagnosis(bridgeDiagnosis ?? { dof: 0, status: 'fully' })
      dispatch({ type: 'mergeSolvedPoints', points: outcome.points })
    },
    [dispatch]
  )

  // Auto-solve debounce: any sketch mutation schedules a solve. ``runSolve``
  // is now async (sidecar IPC) but the debounce still fire-and-forgets --
  // unhandled rejections fall back to the solverError banner via the
  // inner try/catch in ``runSolve`` itself.
  useEffect(() => {
    if (autoSolveDebounceMs <= 0) return
    if (state.sketch.constraints.length === 0) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSolve(state.sketch)
    }, autoSolveDebounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [state.sketch, autoSolveDebounceMs, runSolve])

  // ── Render the canvas (entities + grid + draft preview). ──────────────────
  const draw = useCallback(() => {
    if (headless) return
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    // Size the bitmap to the measured CSS box × devicePixelRatio so the drawn
    // grid fills the pane crisply AND lines up 1:1 with the pointer math (which
    // reads the same bitmap dimensions). All drawing below is in CSS-pixel space
    // because we scale the context by ``dpr``.
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const vw = Math.max(1, Math.floor(viewW))
    const vh = Math.max(1, Math.floor(viewH))
    const bitmapW = Math.max(1, Math.round(vw * dpr))
    const bitmapH = Math.max(1, Math.round(vh * dpr))
    if (c.width !== bitmapW || c.height !== bitmapH) {
      c.width = bitmapW
      c.height = bitmapH
    }
    c.style.width = `${vw}px`
    c.style.height = `${vh}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = 'rgba(20, 24, 32, 1)' // matches var(--bg2) approx
    ctx.fillRect(0, 0, vw, vh)
    const cx = vw / 2
    const cy = vh / 2
    // Grid -- light lines at EXACTLY ``gridMm`` spacing, anchored to the world
    // origin so what the operator sees is exactly the lattice that ``snap``
    // lands on. We iterate world coordinates and project, rather than walking
    // ``cx % gridPx``, so the lines stay locked to integer-mm multiples.
    const gridPx = gridMm * scale
    if (gridPx >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      // Left/right world bounds at the current view.
      const wxMin = (0 - cx) / scale + ox
      const wxMax = (vw - cx) / scale + ox
      const wyMin = oy - (vh - cy) / scale
      const wyMax = oy - (0 - cy) / scale
      const gx0 = Math.ceil(wxMin / gridMm) * gridMm
      const gx1 = Math.floor(wxMax / gridMm) * gridMm
      for (let gx = gx0; gx <= gx1 + gridMm * 0.5; gx += gridMm) {
        const sx = Math.round(cx + (gx - ox) * scale) + 0.5
        ctx.beginPath()
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, vh)
        ctx.stroke()
      }
      const gy0 = Math.ceil(wyMin / gridMm) * gridMm
      const gy1 = Math.floor(wyMax / gridMm) * gridMm
      for (let gy = gy0; gy <= gy1 + gridMm * 0.5; gy += gridMm) {
        const sy = Math.round(cy - (gy - oy) * scale) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, sy)
        ctx.lineTo(vw, sy)
        ctx.stroke()
      }
    }
    // Axes (world X/Y through the origin).
    ctx.strokeStyle = 'rgba(160,160,160,0.25)'
    const axX = Math.round(cx + (0 - ox) * scale) + 0.5
    const axY = Math.round(cy - (0 - oy) * scale) + 0.5
    ctx.beginPath()
    ctx.moveTo(axX, 0)
    ctx.lineTo(axX, vh)
    ctx.moveTo(0, axY)
    ctx.lineTo(vw, axY)
    ctx.stroke()
    // Entities
    const wp = (wx: number, wy: number): [number, number] => [
      cx + (wx - ox) * scale,
      cy - (wy - oy) * scale
    ]
    // Resolve the theme color tokens once per draw (canvas strokeStyle can't
    // take ``var(--x)`` literals). ``getComputedStyle`` reads the live values
    // so a theme swap re-tints on the next paint; the literal fallbacks keep
    // jsdom / a detached canvas (no layout engine) painting a sane colour.
    const cssVars = typeof window !== 'undefined' ? window.getComputedStyle(c) : null
    const TOKEN_FALLBACK: Record<string, string> = {
      '--err': '#e0726f',
      '--accent': '#6f9fc4',
      '--warn': '#e6b84a',
      '--txt0': '#eef1f5',
      '--txt2': '#868f9c'
    }
    const resolveToken = (tokenRef: string): string => {
      // tokenRef looks like ``var(--err)``; pull the custom-property name out.
      const name = tokenRef.replace(/^var\(/, '').replace(/\)$/, '').trim()
      const live = cssVars?.getPropertyValue(name).trim()
      return live && live.length > 0 ? live : TOKEN_FALLBACK[name] ?? '#eef1f5'
    }
    /** Status-driven stroke for an entity (falls back to the geometry default). */
    const entityStroke = (entityId: string, fallback: string): string => {
      const flags = statusMap.entityFlags.get(entityId)
      return flags ? resolveToken(entityStrokeToken(flags)) : fallback
    }
    for (const e of state.sketch.entities) {
      if (e.kind === 'line') {
        const a = state.sketch.points[e.startId]
        const b = state.sketch.points[e.endId]
        if (!a || !b) continue
        const [ax, ay] = wp(a.x, a.y)
        const [bx, by] = wp(b.x, b.y)
        ctx.strokeStyle = entityStroke(e.id, 'rgba(220,220,220,0.95)')
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      } else if (e.kind === 'circle') {
        const c0 = state.sketch.points[e.centerId]
        if (!c0) continue
        const [px, py] = wp(c0.x, c0.y)
        ctx.strokeStyle = entityStroke(e.id, 'rgba(220,220,220,0.95)')
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(px, py, e.radius * scale, 0, Math.PI * 2)
        ctx.stroke()
      } else if (e.kind === 'arc') {
        // Tessellate via three points (no analytic arc for MVP).
        const s = state.sketch.points[e.startId]
        const v = state.sketch.points[e.viaId]
        const en = state.sketch.points[e.endId]
        if (!s || !v || !en) continue
        ctx.strokeStyle = entityStroke(e.id, 'rgba(255,200,120,0.95)')
        ctx.lineWidth = 1.5
        ctx.beginPath()
        const [sx, sy] = wp(s.x, s.y)
        const [vx, vy] = wp(v.x, v.y)
        const [ex, ey] = wp(en.x, en.y)
        ctx.moveTo(sx, sy)
        ctx.quadraticCurveTo(vx, vy, ex, ey)
        ctx.stroke()
      } else if (e.kind === 'spline') {
        // CAD V1.5 spline: render a quadratic Bézier through the first three
        // control points. Distinct tint from the arc so the operator can
        // tell them apart at a glance even though both use ``quadraticCurveTo``.
        if (e.pointIds.length < 3) continue
        const s = state.sketch.points[e.pointIds[0]!]
        const v = state.sketch.points[e.pointIds[1]!]
        const en = state.sketch.points[e.pointIds[2]!]
        if (!s || !v || !en) continue
        ctx.strokeStyle = entityStroke(e.id, 'rgba(140,220,180,0.95)')
        ctx.lineWidth = 1.5
        ctx.beginPath()
        const [sx, sy] = wp(s.x, s.y)
        const [vx, vy] = wp(v.x, v.y)
        const [ex, ey] = wp(en.x, en.y)
        ctx.moveTo(sx, sy)
        ctx.quadraticCurveTo(vx, vy, ex, ey)
        ctx.stroke()
      } else if (e.kind === 'point') {
        const p = state.sketch.points[e.pointId]
        if (!p) continue
        const [px, py] = wp(p.x, p.y)
        ctx.fillStyle = entityStroke(e.id, 'rgba(80,200,255,0.95)')
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // Points (small dots for any point that's referenced)
    ctx.fillStyle = 'rgba(80,200,255,0.9)'
    for (const p of Object.values(state.sketch.points)) {
      const [px, py] = wp(p.x, p.y)
      ctx.beginPath()
      ctx.arc(px, py, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    // Draft (in-progress picks)
    if (draft.picks.length > 0) {
      ctx.strokeStyle = 'rgba(255,180,80,0.95)'
      ctx.fillStyle = 'rgba(255,180,80,0.95)'
      ctx.lineWidth = 1
      for (const p of draft.picks) {
        const [px, py] = wp(p.x, p.y)
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      // Rubber-band from the last pick to the live (snapped) cursor so a draw
      // tool reads like Fusion: you see the segment / radius before committing.
      if (cursorWorld && tool.kind === 'draw') {
        const last = draft.picks[draft.picks.length - 1]!
        const [lpx, lpy] = wp(last.x, last.y)
        const [cpx, cpy] = wp(cursorWorld[0], cursorWorld[1])
        ctx.strokeStyle = 'rgba(255,180,80,0.6)'
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(lpx, lpy)
        ctx.lineTo(cpx, cpy)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    // Snapped-cursor crosshair: a small marker at the exact lattice point the
    // next click will land on, so "what you see is what you snap to" is literal.
    if (cursorWorld && tool.kind !== 'select') {
      const [hx, hy] = wp(cursorWorld[0], cursorWorld[1])
      ctx.strokeStyle = snapEnabled ? 'rgba(120,220,160,0.95)' : 'rgba(255,180,80,0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hx - 7, hy)
      ctx.lineTo(hx + 7, hy)
      ctx.moveTo(hx, hy - 7)
      ctx.lineTo(hx, hy + 7)
      ctx.stroke()
      if (snapEnabled) {
        ctx.beginPath()
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }, [headless, state.sketch, draft, viewW, viewH, gridMm, statusMap, cursorWorld, snapEnabled, tool])

  useEffect(() => {
    draw()
  }, [draw])

  // ── Pointer routing ───────────────────────────────────────────────────────
  function probePointId(wx: number, wy: number): string | null {
    const r = MVP_PICK_PX / scale
    const r2 = r * r
    let best: { id: string; d2: number } | null = null
    for (const [id, p] of Object.entries(state.sketch.points)) {
      const dx = p.x - wx
      const dy = p.y - wy
      const d2 = dx * dx + dy * dy
      if (d2 <= r2 && (!best || d2 < best.d2)) best = { id, d2 }
    }
    return best?.id ?? null
  }

  function probeEntityId(wx: number, wy: number): string | null {
    const tol = MVP_ENTITY_PICK_PX / scale
    const tol2 = tol * tol
    let best: { id: string; d2: number } | null = null
    for (const e of state.sketch.entities) {
      if (e.kind === 'circle') {
        const c = state.sketch.points[e.centerId]
        if (!c) continue
        const dr = Math.hypot(wx - c.x, wy - c.y) - e.radius
        const d2 = dr * dr
        if (d2 <= tol2 && (!best || d2 < best.d2)) best = { id: e.id, d2 }
      } else if (e.kind === 'arc') {
        const s = state.sketch.points[e.startId]
        const v = state.sketch.points[e.viaId]
        const en = state.sketch.points[e.endId]
        if (!s || !v || !en) continue
        // Approximate: closest of the three knot distances.
        const dKnot = Math.min(
          Math.hypot(wx - s.x, wy - s.y),
          Math.hypot(wx - v.x, wy - v.y),
          Math.hypot(wx - en.x, wy - en.y)
        )
        const d2 = dKnot * dKnot
        if (d2 <= tol2 && (!best || d2 < best.d2)) best = { id: e.id, d2 }
      }
    }
    return best?.id ?? null
  }

  /**
   * Map a DOM pointer event to a world-space point in the SAME bitmap space the
   * grid is drawn in. ``clientToCanvasLocal`` returns bitmap px (rescaled for any
   * CSS stretch); we feed the bitmap dimensions + a DPR-scaled px/mm to
   * ``screenToWorld`` so the DPR factor cancels and the returned mm is exact.
   */
  const pointerToWorld = useCallback(
    (ev: { clientX: number; clientY: number }): [number, number] | null => {
      const c = canvasRef.current
      if (!c) return null
      const [lx, ly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      return screenToWorld(lx, ly, c.width, c.height, scale * dpr, ox, oy)
    },
    []
  )

  /**
   * Resolve the placement coordinates for a raw world point: snap to an existing
   * point if the cursor is within tolerance (always -- endpoint snapping is
   * unconditionally helpful), else snap to the ``gridMm`` lattice when snapping
   * is enabled, else use the raw world point. Returns the resolved pick.
   */
  const resolvePick = useCallback(
    (rawX: number, rawY: number): SketchPick => {
      const pointId = probePointId(rawX, rawY) ?? undefined
      const entityId = probeEntityId(rawX, rawY) ?? undefined
      if (pointId) {
        const pt = state.sketch.points[pointId]!
        return { x: pt.x, y: pt.y, pointId, entityId }
      }
      const x = snapEnabled ? snap(rawX, gridMm) : rawX
      const y = snapEnabled ? snap(rawY, gridMm) : rawY
      return { x, y, pointId, entityId }
    },
    [state.sketch.points, state.sketch.entities, snapEnabled, gridMm]
  )

  /** Route a resolved pick through the pure tool router + apply the result. */
  const routePick = useCallback(
    (pick: SketchPick, value?: number) => {
      const draftWithValue: SketchToolDraft = { ...draft, numericValue: value }
      const result = handleSketchToolClick(activeToolId, draftWithValue, pick, {
        entities: state.sketch.entities,
        nextId: idFactory
      })
      if (result.kind === 'updateDraft') {
        setDraft(result.draft)
        setHint(`${tool.label}: ${draft.picks.length + 1}/${tool.requiredPicks} picks.`)
        return
      }
      if (result.kind === 'commit') {
        dispatch(result.action)
        setDraft(emptyDraft)
        setNumericInput('')
        if (result.hint) setHint(result.hint)
        return
      }
      if (result.kind === 'commitMany') {
        for (const a of result.actions) dispatch(a)
        setDraft(emptyDraft)
        setNumericInput('')
        if (result.hint) setHint(result.hint)
        return
      }
      if (result.kind === 'error') {
        setHint(`Error: ${result.message}`)
        return
      }
      setHint(null)
    },
    [draft, activeToolId, state.sketch.entities, idFactory, tool]
  )

  function onCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const w = pointerToWorld(ev)
    if (!w) return
    const pick = resolvePick(w[0], w[1])
    const numericValue = numericInput.trim().length > 0 ? Number.parseFloat(numericInput) : undefined
    routePick(pick, numericValue)
  }

  function onCanvasMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    const w = pointerToWorld(ev)
    if (!w) {
      setCursorWorld(null)
      return
    }
    // Mirror the placement resolution so the read-out + crosshair show exactly
    // where a click would land (point-snap wins, else grid snap when enabled).
    const pick = resolvePick(w[0], w[1])
    setCursorWorld([pick.x, pick.y])
  }

  function onCanvasLeave() {
    setCursorWorld(null)
  }

  /**
   * Fusion-style typed dimension: with a draw tool's FIRST pick already placed,
   * a typed value (+ Enter / Apply) synthesises the remaining pick along the
   * current cursor direction and commits the entity. Wires
   * ``numericInput -> active tool draft -> committed entity`` through the same
   * pure router a click uses.
   *   - line:      value = segment length along the cursor direction.
   *   - circle:    value = radius (direction irrelevant).
   *   - rectangle: ``W`` (square) or ``WxH`` -- sign follows the cursor quadrant.
   */
  function applyNumericDraw(): void {
    const start = draft.picks[0]
    if (!start) {
      setHint('Place a start point first, then type a dimension.')
      return
    }
    const raw = numericInput.trim()
    if (raw.length === 0) {
      setHint('Type a dimension value first.')
      return
    }
    // Cursor direction relative to the start pick (defaults if no movement yet).
    const dirX = cursorWorld ? cursorWorld[0] - start.x : 0
    const dirY = cursorWorld ? cursorWorld[1] - start.y : 0

    if (activeToolId === 'line') {
      const len = Number.parseFloat(raw)
      if (!Number.isFinite(len) || len <= 0) {
        setHint('Line length must be a positive number (mm).')
        return
      }
      const mag = Math.hypot(dirX, dirY)
      const ux = mag > 1e-9 ? dirX / mag : 1
      const uy = mag > 1e-9 ? dirY / mag : 0
      routePick({ x: start.x + ux * len, y: start.y + uy * len })
      return
    }
    if (activeToolId === 'circle') {
      const r = Number.parseFloat(raw)
      if (!Number.isFinite(r) || r <= 0) {
        setHint('Circle radius must be a positive number (mm).')
        return
      }
      const mag = Math.hypot(dirX, dirY)
      const ux = mag > 1e-9 ? dirX / mag : 1
      const uy = mag > 1e-9 ? dirY / mag : 0
      routePick({ x: start.x + ux * r, y: start.y + uy * r })
      return
    }
    if (activeToolId === 'rectangle') {
      const parts = raw.split(/[x*×]/i).map((s) => Number.parseFloat(s.trim()))
      const wv = parts[0]
      const hv = parts.length > 1 ? parts[1] : parts[0]
      if (!Number.isFinite(wv) || !Number.isFinite(hv) || (wv ?? 0) <= 0 || (hv ?? 0) <= 0) {
        setHint('Rectangle size must be `W` or `WxH` (positive mm).')
        return
      }
      const sgnX = dirX >= 0 ? 1 : -1
      const sgnY = dirY >= 0 ? 1 : -1
      routePick({ x: start.x + sgnX * (wv as number), y: start.y + sgnY * (hv as number) })
      return
    }
    setHint('Type-a-dimension works with the Line, Circle, and Rectangle tools.')
  }

  // ── Tokenised inline styles (no Tailwind). ────────────────────────────────
  const wrapStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    gap: '8px',
    padding: '8px',
    background: 'var(--bg1, #0e1117)',
    color: 'var(--fg, #e6e6e6)',
    border: '1px solid var(--border, #2a2f37)',
    borderRadius: '6px',
    // Fill the mounted sketch host so the canvas column has a real height to
    // measure (otherwise the ResizeObserver sees a content-collapsed 0px box).
    height: '100%',
    minHeight: '420px',
    boxSizing: 'border-box'
  }
  const paletteStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '4px',
    background: 'var(--bg2, #151a22)',
    border: '1px solid var(--border, #2a2f37)',
    borderRadius: '4px'
  }
  const headerStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--muted, #9aa4b2)',
    padding: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  }
  const toolButtonStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent, #5b9aff)' : 'transparent',
    color: active ? 'var(--bg0, #000)' : 'var(--fg, #e6e6e6)',
    border: `1px solid ${active ? 'var(--accent, #5b9aff)' : 'var(--border, #2a2f37)'}`,
    padding: '6px 8px',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '12px',
    textAlign: 'left'
  })
  const canvasColStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minHeight: 0
  }
  const ribbonStyle: React.CSSProperties = {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    padding: '4px 6px',
    background: 'var(--bg2, #151a22)',
    border: '1px solid var(--border, #2a2f37)',
    borderRadius: '4px'
  }
  const ribbonLabelStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--muted, #9aa4b2)'
  }
  const inputStyle: React.CSSProperties = {
    width: '70px',
    padding: '3px 6px',
    fontSize: '12px',
    background: 'var(--bg0, #0b0d12)',
    color: 'var(--fg, #e6e6e6)',
    border: '1px solid var(--border, #2a2f37)',
    borderRadius: '3px'
  }
  const btnStyle: React.CSSProperties = {
    background: 'var(--bg0, #0b0d12)',
    color: 'var(--fg, #e6e6e6)',
    border: '1px solid var(--border, #2a2f37)',
    padding: '4px 10px',
    fontSize: '12px',
    borderRadius: '3px',
    cursor: 'pointer'
  }
  const canvasStyle: React.CSSProperties = {
    display: 'block',
    cursor: tool.kind === 'select' ? 'default' : 'crosshair',
    background: 'var(--bg2, #151a22)',
    border: '1px solid var(--border, #2a2f37)',
    borderRadius: '4px',
    width: '100%',
    height: '100%'
  }
  // The flex-growing host whose CSS box the canvas bitmap matches 1:1.
  const canvasHostStyle: React.CSSProperties = {
    position: 'relative',
    flex: '1 1 auto',
    minHeight: '320px',
    display: 'flex'
  }
  // Snap-toggle + live cursor read-out row under the ribbon.
  const statusRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '11px',
    color: 'var(--muted, #9aa4b2)'
  }
  const snapToggleStyle: React.CSSProperties = {
    ...btnStyle,
    padding: '3px 8px',
    borderColor: snapEnabled ? 'var(--accent, #5b9aff)' : 'var(--border, #2a2f37)',
    color: snapEnabled ? 'var(--accent, #5b9aff)' : 'var(--fg, #e6e6e6)'
  }
  const bannerStyle = (kind: 'ok' | 'err'): React.CSSProperties => ({
    padding: '6px 10px',
    fontSize: '12px',
    borderRadius: '3px',
    background: kind === 'ok' ? 'var(--accent-soft, rgba(91,154,255,0.15))' : 'rgba(220,80,80,0.18)',
    border: `1px solid ${kind === 'ok' ? 'var(--accent, #5b9aff)' : 'rgba(220,80,80,0.8)'}`,
    color: 'var(--fg, #e6e6e6)'
  })
  /**
   * DOF badge style keyed by the status modifier. Token-driven (fully = ok
   * green, under = accent blue, over = err red, not-solved = muted) so the
   * badge re-themes with the rest of the shell; literal fallbacks match the
   * other inline styles in this MVP canvas.
   */
  const dofBadgeStyle = (
    status: 'fully' | 'under' | 'over' | 'not-solved' | 'solved'
  ): React.CSSProperties => {
    const palette: Record<typeof status, { fg: string; bg: string; bd: string }> = {
      fully: { fg: 'var(--ok, #5cc99a)', bg: 'var(--ok-dim, rgba(92,201,154,0.12))', bd: 'var(--ok, #5cc99a)' },
      under: { fg: 'var(--accent, #6f9fc4)', bg: 'var(--accent-12, rgba(111,159,196,0.12))', bd: 'var(--accent, #6f9fc4)' },
      over: { fg: 'var(--err, #e0726f)', bg: 'var(--err-dim, rgba(224,114,111,0.1))', bd: 'var(--err, #e0726f)' },
      // Neutral "geometry settled, DOF not analysed" — deliberately NOT the
      // green ``fully`` palette, so a local solve never *looks* like a verified
      // fully-constrained sketch.
      solved: { fg: 'var(--txt1, #c4ccd6)', bg: 'transparent', bd: 'var(--border, #424954)' },
      'not-solved': { fg: 'var(--txt2, #868f9c)', bg: 'transparent', bd: 'var(--border, #424954)' }
    }
    const c = palette[status]
    return {
      padding: '3px 8px',
      fontSize: '11px',
      fontWeight: 600,
      borderRadius: '3px',
      whiteSpace: 'nowrap',
      color: c.fg,
      background: c.bg,
      border: `1px solid ${c.bd}`
    }
  }

  // The numeric ribbon field serves two audiences:
  //   • constraint tools (distance / radius / angle) — the value is consumed by
  //     the NEXT pick that completes the constraint (existing behaviour).
  //   • draw tools (line / circle / rectangle) once a start pick exists — typing
  //     a value + Enter/Apply commits the dimension along the cursor direction
  //     (Fusion-style). Hidden again until the first pick lands so it never
  //     competes with the very first click.
  const drawDimActive =
    draft.picks.length >= 1 &&
    (activeToolId === 'line' || activeToolId === 'circle' || activeToolId === 'rectangle')
  const showNumericInput =
    activeToolId === 'distanceConstraint' ||
    activeToolId === 'radiusConstraint' ||
    activeToolId === 'angleConstraint' ||
    drawDimActive
  const numericFieldLabel = drawDimActive
    ? activeToolId === 'line'
      ? 'Length (mm)'
      : activeToolId === 'circle'
        ? 'Radius (mm)'
        : 'W or WxH (mm)'
    : activeToolId === 'angleConstraint'
      ? 'Angle (deg)'
      : 'Value (mm)'

  return (
    <div
      className="sketch-mvp-wrap"
      data-testid="sketch-mvp-wrap"
      data-active-tool={activeToolId}
      style={wrapStyle}
    >
      <div className="sketch-mvp-palette" data-testid="sketch-mvp-palette" style={paletteStyle}>
        <div className="sketch-mvp-palette__header" style={headerStyle}>
          Tools
        </div>
        {SKETCH_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sketch-mvp-tool sketch-mvp-tool--${t.id} ${activeToolId === t.id ? 'is-active' : ''}`}
            data-testid={`sketch-mvp-tool-${t.id}`}
            data-tool-active={activeToolId === t.id ? 'true' : 'false'}
            title={t.description}
            aria-pressed={activeToolId === t.id}
            onClick={() => setActiveToolId(t.id)}
            style={toolButtonStyle(activeToolId === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sketch-mvp-canvas-col" style={canvasColStyle}>
        <div className="sketch-mvp-ribbon" data-testid="sketch-mvp-ribbon" style={ribbonStyle}>
          <span className="sketch-mvp-ribbon__current" style={ribbonLabelStyle}>
            Current: <strong data-testid="sketch-mvp-current-tool">{tool.label}</strong>
          </span>
          {showNumericInput && (
            <label className="sketch-mvp-ribbon__numeric" style={ribbonLabelStyle}>
              {numericFieldLabel}
              <input
                type="text"
                inputMode="decimal"
                value={numericInput}
                onChange={(e) => setNumericInput(e.target.value)}
                onKeyDown={(e) => {
                  // Fusion-style: Enter/Tab commits a typed draw dimension. For
                  // constraint tools the value is consumed by the next pick, so
                  // Enter is a no-op there (avoids a confusing empty commit).
                  if ((e.key === 'Enter' || e.key === 'Tab') && drawDimActive) {
                    if (e.key === 'Enter') e.preventDefault()
                    applyNumericDraw()
                  }
                }}
                style={{ ...inputStyle, marginLeft: '4px' }}
                data-testid="sketch-mvp-numeric-input"
              />
            </label>
          )}
          {drawDimActive && (
            <button
              type="button"
              onClick={applyNumericDraw}
              style={btnStyle}
              data-testid="sketch-mvp-apply-dim"
              title="Commit the typed dimension along the current cursor direction"
            >
              Apply
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void runSolve(state.sketch)
            }}
            disabled={state.sketch.constraints.length === 0 || solving}
            style={btnStyle}
            data-testid="sketch-mvp-solve"
            data-solving={solving ? 'true' : 'false'}
            aria-busy={solving}
          >
            {solving ? 'Solving…' : 'Solve'}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={state.past.length === 0}
            style={btnStyle}
            data-testid="sketch-mvp-undo"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={state.future.length === 0}
            style={btnStyle}
            data-testid="sketch-mvp-redo"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'clear' })
              setDraft(emptyDraft)
              setSolverError(null)
              setLastResidual(null)
              setDiagnosis(null)
              setDofAuthoritative(false)
              setHint(null)
            }}
            style={btnStyle}
            data-testid="sketch-mvp-clear"
          >
            Clear
          </button>
          {/* Degrees-of-freedom badge (mirrors the assembly solver badge).
              ``selectDofBadgeView`` enforces the honesty contract: "Not solved"
              before the first solve, a neutral "Solved" after a local
              (non-authoritative) solve, and the real verdict (Fully constrained /
              Under-constrained: N DOF / Over-constrained — ids) ONLY when the
              sidecar supplied a DOF diagnosis. The data-status attr drives the
              colour. */}
          {(() => {
            const badge = selectDofBadgeView(diagnosis, dofAuthoritative, statusMap)
            return (
              <span
                className={`sketch-mvp-dof-badge sketch-mvp-dof-badge--${badge.status}`}
                data-testid="sketch-mvp-dof-badge"
                data-status={badge.status}
                style={dofBadgeStyle(badge.status)}
              >
                {badge.label}
              </span>
            )
          })()}
          <span
            className="sketch-mvp-ribbon__hint"
            style={{ ...ribbonLabelStyle, marginLeft: 'auto' }}
            data-testid="sketch-mvp-hint"
          >
            {hint ?? tool.description}
          </span>
        </div>
        {!headless && (
          <div className="sketch-mvp-status" data-testid="sketch-mvp-status" style={statusRowStyle}>
            <button
              type="button"
              onClick={() => setSnapEnabled((s) => !s)}
              style={snapToggleStyle}
              data-testid="sketch-mvp-snap-toggle"
              data-snap={snapEnabled ? 'on' : 'off'}
              aria-pressed={snapEnabled}
              title="Toggle snap-to-grid (placements lock to the grid lattice)"
            >
              {snapEnabled ? `Snap ${gridMm} mm` : 'Snap off'}
            </button>
            <span data-testid="sketch-mvp-cursor-readout" className="sketch-mvp-cursor">
              {cursorWorld
                ? `X ${cursorWorld[0].toFixed(2)}  Y ${cursorWorld[1].toFixed(2)} mm`
                : 'X --  Y -- mm'}
            </span>
          </div>
        )}
        {!headless && (
          <div ref={hostRef} className="sketch-mvp-canvas-host" style={canvasHostStyle}>
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              data-testid="sketch-mvp-canvas"
              className="sketch-mvp-canvas"
              style={canvasStyle}
              onClick={onCanvasClick}
              onMouseMove={onCanvasMove}
              onMouseLeave={onCanvasLeave}
            />
          </div>
        )}
        {solverError && (
          <div
            role="alert"
            className="sketch-mvp-banner sketch-mvp-banner--err"
            data-testid="sketch-mvp-error-banner"
            data-error-kind={solverError.kind}
            style={bannerStyle('err')}
          >
            <strong>{solverError.kind}:</strong> {solverError.message}
          </div>
        )}
        {!solverError && lastResidual !== null && (
          <div
            className="sketch-mvp-banner sketch-mvp-banner--ok"
            data-testid="sketch-mvp-ok-banner"
            style={bannerStyle('ok')}
          >
            Solved (residual {lastResidual.toExponential(2)}).
          </div>
        )}
      </div>
    </div>
  )
}

/** Test-only helper -- expose a deterministic id factory creator for harnesses. */
export { makeDeterministicIdFactory as createMvpDeterministicIdFactory } from './sketch-tools'

