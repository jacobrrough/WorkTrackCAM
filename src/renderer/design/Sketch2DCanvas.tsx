import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignFileV2 } from '../../shared/design-schema'
import {
  constraintPickPointIdEdges,
  pickNearestCircularEntityId,
  type SketchTrimEdgeRef
} from '../../shared/sketch-profile'
import { clientToCanvasLocal, distSqPointSegment, screenToWorld, snap } from './sketch2d-canvas-coords'
import { drawSketch2D, type ConstraintPickHit } from './sketch2d-draw'
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
  /** Degrees for rotate_sk (ribbon). */
  sketchRotateDeg?: number
  /** Factor for scale_sk (ribbon). */
  sketchScaleFactor?: number
  /** Shown at top-left (e.g. sketch plane name). */
  planeLabel?: string
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
  entityHoverId: string | null
): string | undefined {
  if (CROSSHAIR_TOOLS.has(activeTool)) return 'crosshair'
  if (constraintPickActive && (onConstraintPointPick || onConstraintSegmentPick)) {
    return constraintHover ? 'pointer' : 'crosshair'
  }
  if (constraintEntityPickActive && onConstraintEntityPick) {
    return entityHoverId ? 'pointer' : 'crosshair'
  }
  return undefined
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
  sketchRotateDeg = 0,
  sketchScaleFactor = 1,
  planeLabel
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
      onDesignChange({
        ...design,
        points: {
          ...design.points,
          [idA]: { x: a[0], y: a[1] },
          [idB]: { x: b[0], y: b[1] }
        },
        entities: [...design.entities, { id: eid, kind: 'polyline', pointIds: [idA, idB], closed: false }]
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

  function onMouseDown(ev: React.MouseEvent) {
    const c = ref.current
    if (!c) return
    if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
      panRef.current = { sx: ev.clientX, sy: ev.clientY, ox, oy }
      return
    }
    if (ev.button !== 0) return
    const [lx, ly] = clientToCanvasLocal(ev.clientX, ev.clientY, c)
    const view = viewportSize()
    const raw = screenToWorld(lx, ly, view.w, view.h, scale, ox, oy)
    const w: [number, number] = [snap(raw[0], gridMm), snap(raw[1], gridMm)]

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
    const view = viewportSize()
    const raw = screenToWorld(lx, ly, view.w, view.h, scale, ox, oy)
    const p: [number, number] = [snap(raw[0], gridMm), snap(raw[1], gridMm)]

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
    if (drag?.kind === 'rect') {
      finalizeRectDrag()
    }
    if (drag?.kind === 'circle') {
      finalizeCircleDrag()
    }
  }

  function closePolyline() {
    if (polyDraft.length < 3) return
    const ids = polyDraft.map(() => crypto.randomUUID())
    const nextPoints = { ...design.points }
    polyDraft.forEach((pt, i) => {
      nextPoints[ids[i]!] = { x: pt[0], y: pt[1] }
    })
    const id = crypto.randomUUID()
    onDesignChange({
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id, kind: 'polyline', pointIds: ids, closed: true }]
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

  return (
    <div className="sketch-wrap">
      <canvas
        ref={ref}
        width={width}
        height={height}
        className="sketch-canvas"
        style={{
          cursor: getCanvasCursor(
            activeTool,
            constraintPickActive,
            onConstraintPointPick,
            onConstraintSegmentPick,
            constraintHover,
            constraintEntityPickActive,
            onConstraintEntityPick,
            entityHoverId
          )
        }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          panRef.current = null
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
