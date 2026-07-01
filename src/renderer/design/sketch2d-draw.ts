/**
 * Pure canvas draw logic for the 2D sketch canvas.
 * Extracted from Sketch2DCanvas.tsx to reduce file size.
 *
 * This module contains the `drawSketch2D` function that renders the full sketch
 * on the given canvas context: grid, axes, entities, dimensions, drafts,
 * constraint highlights, and status text.
 */

import type { DesignFileV2 } from '../../shared/design-schema'
import {
  arcSamplePositions,
  circleFromDiameterEndpoints,
  circleThroughThreePoints,
  ellipseFromCenterMajorMinor,
  ellipseLoopWorld,
  ELLIPSE_PROFILE_SEGMENTS,
  polylinePositions,
  rectFromThreePoints,
  regularPolygonVertices,
  sampleArcThroughThreePoints,
  sampleCenterStartEndArc,
  slotCapsuleLoopWorld,
  slotParamsFromCapCenters,
  slotParamsFromOverallTips,
  splineCpPolylineFromEntity,
  splineFitPolylineFromEntity,
  worldCornersFromRectParams,
  perpDistanceToLineThroughPoints,
  type SketchTrimEdgeRef
} from '../../shared/sketch-profile'
import { niceStepMm, screenToWorld } from './sketch2d-canvas-coords'
import { dimensionLabelAnchorWorld } from './sketch2d-dimension-pick'
import { entityOutlineWorld } from './sketch2d-hit-test'
import { osnapKindLabel, type OsnapKind } from './sketch2d-osnap'
import type { MarqueeMode } from './sketch2d-marquee'
import type { SketchTool } from './Sketch2DCanvas'

const CANVAS_SLOT_SEGMENTS = 24

/**
 * CONSTRUCTION (reference) geometry render tokens — Fusion's X-key concept.
 * Construction entities stroke dashed + dimmer (same purple family, lower
 * alpha) and are never filled; they read as guides, not part geometry.
 * Exported so the render-pin test shares one source of truth.
 */
export const CONSTRUCTION_DASH: readonly number[] = [5, 4]
export const CONSTRUCTION_STROKE = 'rgba(196, 181, 253, 0.55)'

export type ConstraintPickHit = { kind: 'vertex'; id: string } | { kind: 'segment'; a: string; b: string }

export interface DrawSketch2DParams {
  canvas: HTMLCanvasElement
  width: number
  height: number
  design: DesignFileV2
  scale: number
  ox: number
  oy: number
  gridMm: number
  activeTool: SketchTool
  planeLabel?: string

  // Draft state for various tools
  polyDraft: [number, number][]
  lineStart: [number, number] | null
  lineHover: [number, number] | null
  circle2ptStart: [number, number] | null
  circle2ptHover: [number, number] | null
  circle3Draft: [number, number][]
  circle3Hover: [number, number] | null
  rect3Draft: [number, number][]
  rect3Hover: [number, number] | null
  polygonSides: number
  polygonCenter: [number, number] | null
  polygonHover: [number, number] | null
  slotCenterDraft: [number, number][]
  slotWidthHover: [number, number] | null
  slotOverallDraft: [number, number][]
  slotOverallWidthHover: [number, number] | null
  arcDraft: [number, number][]
  arcHover: [number, number] | null
  ellipseDraft: [number, number][]
  ellipseHover: [number, number] | null
  splineFitDraft: [number, number][]
  splineCpDraft: [number, number][]
  xformDraft: [number, number][]
  xformSelectionIds: string[]

  // Sketch S1 — select-tool rendering (optional + additive; absent = no change)
  /** Ids of selected entities — re-stroked with the selection highlight. */
  selectedEntityIds?: ReadonlySet<string>
  /** Live grid-snapped drag offset (mm) — selected outlines ghost at this offset. */
  selectionGhostOffsetMm?: [number, number] | null
  /**
   * Sketch S2 -- active object-snap marker: a distinct glyph per kind at the
   * snapped point plus a kind label chip near the cursor. Optional + additive;
   * absent = no change.
   */
  osnapMarker?: { kind: OsnapKind; point: readonly [number, number] } | null
  /**
   * Sketch S2 -- node-edit overlay for the single-selected entity: square
   * grip handles (active = armed / dragging, drawn filled) plus an optional
   * dashed ghost outline of the reshaped entity while a handle drags.
   * Optional + additive; absent = no change.
   */
  nodeEditOverlay?: {
    handles: ReadonlyArray<{ x: number; y: number; active: boolean }>
    ghostOutline: { pts: [number, number][]; closed: boolean } | null
  } | null
  /**
   * Sketch S3 -- marquee box-select rubber band: press corner `a` to live
   * cursor corner `b` (sketch-plane mm) plus the AutoCAD mode the drag
   * direction picked. Window (L->R) draws the solid blue box; crossing
   * (R->L) draws the dashed green box. Optional + additive; absent = no
   * change.
   */
  marquee?: {
    a: readonly [number, number]
    b: readonly [number, number]
    mode: MarqueeMode
  } | null
  /**
   * Sketch S4 -- the DIMENSION tool's first-picked vertex (sketch-plane mm),
   * highlighted with a ring so the operator sees which endpoint a point-to-
   * point dimension started from. Optional + additive; absent = no change.
   */
  dimensionDraftPoint?: readonly [number, number] | null
  /**
   * Sketch S5 -- the angular DIMENSION tool's first-picked line (sketch-plane mm
   * endpoints), highlighted so the operator sees which side they are measuring
   * the angle from before picking the second line. Optional + additive; absent =
   * no change.
   */
  dimensionAngularFirstLine?: readonly [readonly [number, number], readonly [number, number]] | null

  // Drag state
  drag:
    | { kind: 'rect'; a: [number, number]; b: [number, number] }
    | { kind: 'circle'; c: [number, number]; r: number }
    | null

  // Constraint pick
  constraintPickActive: boolean
  constraintSegmentPickActive: boolean
  onConstraintSegmentPick: ((pointIdA: string, pointIdB: string) => void) | undefined
  constraintHover: ConstraintPickHit | null

  // Trim / extend / fillet / chamfer cutter highlights
  trimCutter: SketchTrimEdgeRef | null
  extendCutter: SketchTrimEdgeRef | null

  // Viewport size resolver
  viewportSize: () => { w: number; h: number }
}

export function drawSketch2D(params: DrawSketch2DParams): void {
  const {
    canvas: c,
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
    selectionGhostOffsetMm,
    osnapMarker,
    nodeEditOverlay,
    marquee,
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
  } = params

  const { entities, points } = design

  const ctx = c.getContext('2d')
  if (!ctx) return
  const view = viewportSize()
  const vw = view.w
  const vh = view.h
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const bitmapW = Math.max(1, Math.round(vw * dpr))
  const bitmapH = Math.max(1, Math.round(vh * dpr))
  if (c.width !== bitmapW || c.height !== bitmapH) {
    c.width = bitmapW
    c.height = bitmapH
  }
  c.style.width = `${vw}px`
  c.style.height = `${vh}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.fillStyle = '#0c0612'
  ctx.fillRect(0, 0, vw, vh)
  const cx = vw / 2
  const cy = vh / 2

  const w2m = (x: number, y: number): [number, number] => screenToWorld(x, y, vw, vh, scale, ox, oy)
  const crisp = (v: number) => Math.round(v) + 0.5

  const grid = Math.max(0.0001, gridMm)
  const majorStep = grid * 5
  const axisLabelStep = Math.max(grid, niceStepMm(90 / Math.max(scale, 0.05)))
  const minorGridColor = '#241732'
  const majorGridColor = '#3b2753'
  const minorPx = grid * scale
  const shouldDrawMinor = minorPx >= 6

  ctx.strokeStyle = minorGridColor
  ctx.lineWidth = 1
  const minW = w2m(0, vh)
  const maxW = w2m(vw, 0)
  const x0 = Math.floor(Math.min(minW[0], maxW[0]) / grid) * grid
  const x1 = Math.ceil(Math.max(minW[0], maxW[0]) / grid) * grid
  const y0 = Math.floor(Math.min(minW[1], maxW[1]) / grid) * grid
  const y1 = Math.ceil(Math.max(minW[1], maxW[1]) / grid) * grid

  if (shouldDrawMinor) {
    for (let x = x0; x <= x1 + grid * 0.25; x += grid) {
      const majorHit = Math.abs(Math.round(x / majorStep) * majorStep - x) < grid * 0.08
      if (majorHit) continue
      const sx = crisp(cx + (x - ox) * scale)
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, vh)
      ctx.stroke()
    }
    for (let y = y0; y <= y1 + grid * 0.25; y += grid) {
      const majorHit = Math.abs(Math.round(y / majorStep) * majorStep - y) < grid * 0.08
      if (majorHit) continue
      const sy = crisp(cy - (y - oy) * scale)
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(vw, sy)
      ctx.stroke()
    }
  }

  const x0Major = Math.floor(Math.min(minW[0], maxW[0]) / majorStep) * majorStep
  const x1Major = Math.ceil(Math.max(minW[0], maxW[0]) / majorStep) * majorStep
  const y0Major = Math.floor(Math.min(minW[1], maxW[1]) / majorStep) * majorStep
  const y1Major = Math.ceil(Math.max(minW[1], maxW[1]) / majorStep) * majorStep
  ctx.strokeStyle = majorGridColor
  for (let x = x0Major; x <= x1Major + majorStep * 0.25; x += majorStep) {
    const sx = crisp(cx + (x - ox) * scale)
    ctx.beginPath()
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
    ctx.stroke()
  }
  for (let y = y0Major; y <= y1Major + majorStep * 0.25; y += majorStep) {
    const sy = crisp(cy - (y - oy) * scale)
    ctx.beginPath()
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
    ctx.stroke()
  }

  // World axes and origin marker so users can quickly orient and place geometry.
  const axisX = crisp(cx + (0 - ox) * scale)
  const axisY = crisp(cy - (0 - oy) * scale)
  ctx.lineWidth = 2.25
  ctx.strokeStyle = '#7dd3fc'
  ctx.beginPath()
  ctx.moveTo(axisX, 0)
  ctx.lineTo(axisX, vh)
  ctx.stroke()
  ctx.strokeStyle = '#86efac'
  ctx.beginPath()
  ctx.moveTo(0, axisY)
  ctx.lineTo(vw, axisY)
  ctx.stroke()

  if (planeLabel) {
    ctx.save()
    ctx.fillStyle = 'rgba(233, 213, 255, 0.92)'
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.fillText(`Sketch · ${planeLabel}`, 10, 18)
    ctx.restore()
  }

  const drawAxisMarks = () => {
    if (axisLabelStep <= 0 || !Number.isFinite(axisLabelStep)) return
    const tick = 5
    ctx.save()
    ctx.strokeStyle = '#e9d5ff'
    ctx.fillStyle = '#e9d5ff'
    ctx.lineWidth = 1
    ctx.font = '10px system-ui'
    if (axisY >= 0 && axisY <= vh) {
      const xMark0 = Math.floor(Math.min(minW[0], maxW[0]) / axisLabelStep) * axisLabelStep
      const xMark1 = Math.ceil(Math.max(minW[0], maxW[0]) / axisLabelStep) * axisLabelStep
      for (let x = xMark0; x <= xMark1 + axisLabelStep * 0.25; x += axisLabelStep) {
        const sx = cx + (x - ox) * scale
        if (sx < -8 || sx > vw + 8) continue
        const scx = crisp(sx)
        ctx.beginPath()
        ctx.moveTo(scx, axisY - tick)
        ctx.lineTo(scx, axisY + tick)
        ctx.stroke()
        if (Math.abs(x) > 1e-6) {
          const lbl = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(2).replace(/\.?0+$/, '')
          ctx.fillText(lbl, scx + 3, Math.min(vh - 6, axisY + 14))
        }
      }
    }
    if (axisX >= 0 && axisX <= vw) {
      const yMark0 = Math.floor(Math.min(minW[1], maxW[1]) / axisLabelStep) * axisLabelStep
      const yMark1 = Math.ceil(Math.max(minW[1], maxW[1]) / axisLabelStep) * axisLabelStep
      for (let y = yMark0; y <= yMark1 + axisLabelStep * 0.25; y += axisLabelStep) {
        const sy = cy - (y - oy) * scale
        if (sy < -8 || sy > vh + 8) continue
        const scy = crisp(sy)
        ctx.beginPath()
        ctx.moveTo(axisX - tick, scy)
        ctx.lineTo(axisX + tick, scy)
        ctx.stroke()
        if (Math.abs(y) > 1e-6) {
          const lbl = Number.isInteger(y) ? y.toFixed(0) : y.toFixed(2).replace(/\.?0+$/, '')
          ctx.fillText(lbl, Math.min(vw - 26, axisX + 8), scy - 3)
        }
      }
    }
    ctx.restore()
  }
  drawAxisMarks()

  const originSx = cx + (0 - ox) * scale
  const originSy = cy - (0 - oy) * scale
  ctx.fillStyle = '#f5d0fe'
  ctx.beginPath()
  ctx.arc(originSx, originSy, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '11px system-ui'
  ctx.fillStyle = '#e9d5ff'
  ctx.fillText('Origin (0,0)', originSx + 8, originSy - 8)

  ctx.strokeStyle = '#9333ea'
  ctx.lineWidth = 2
  ctx.fillStyle = 'rgba(147, 51, 234, 0.12)'

  const drawShape = (pts: [number, number][], closed: boolean) => {
    if (pts.length === 0) return
    ctx.beginPath()
    const p0 = pts[0]!
    ctx.moveTo(cx + (p0[0] - ox) * scale, cy - (p0[1] - oy) * scale)
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!
      ctx.lineTo(cx + (p[0] - ox) * scale, cy - (p[1] - oy) * scale)
    }
    if (closed) {
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.stroke()
    }
  }

  for (const e of entities) {
    // Construction (reference) geometry: dashed + dimmer, never filled. The
    // save/restore fences the override so the next entity paints normally.
    const isConstruction = e.construction === true
    if (isConstruction) {
      ctx.save()
      ctx.setLineDash([...CONSTRUCTION_DASH])
      ctx.strokeStyle = CONSTRUCTION_STROKE
      ctx.lineWidth = 1.5
      ctx.fillStyle = 'transparent'
    }
    if (e.kind === 'polyline') {
      const pts = polylinePositions(e, points)
      drawShape(pts, e.closed)
    } else if (e.kind === 'rect') {
      const hw = e.w / 2
      const hh = e.h / 2
      const cos = Math.cos(e.rotation)
      const sin = Math.sin(e.rotation)
      const corners: [number, number][] = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh]
      ].map(([x, y]) => [e.cx + x * cos - y * sin, e.cy + x * sin + y * cos])
      drawShape(corners, true)
    } else if (e.kind === 'circle') {
      const sx = cx + (e.cx - ox) * scale
      const sy = cy - (e.cy - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, e.r * scale, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else if (e.kind === 'slot') {
      const loop = slotCapsuleLoopWorld(
        e.cx,
        e.cy,
        e.length,
        e.width,
        e.rotation,
        CANVAS_SLOT_SEGMENTS
      )
      if (loop.length >= 3) drawShape(loop, true)
    } else if (e.kind === 'arc') {
      const apt = arcSamplePositions(e, points, 28)
      if (apt.length >= 2) {
        ctx.fillStyle = e.closed && !isConstruction ? 'rgba(147, 51, 234, 0.12)' : 'transparent'
        drawShape(apt, !!e.closed)
        ctx.fillStyle = 'rgba(147, 51, 234, 0.12)'
      }
    } else if (e.kind === 'ellipse') {
      const loop = ellipseLoopWorld(e.cx, e.cy, e.rx, e.ry, e.rotation, ELLIPSE_PROFILE_SEGMENTS)
      if (loop.length >= 3) drawShape(loop, true)
    } else if (e.kind === 'spline_fit' || e.kind === 'spline_cp') {
      const loop =
        e.kind === 'spline_fit' ? splineFitPolylineFromEntity(e, points) : splineCpPolylineFromEntity(e, points)
      if (loop && loop.length >= 2) {
        ctx.fillStyle = e.closed && !isConstruction ? 'rgba(147, 51, 234, 0.12)' : 'transparent'
        drawShape(loop, !!e.closed)
        ctx.fillStyle = 'rgba(147, 51, 234, 0.12)'
      }
    }
    if (isConstruction) ctx.restore()
  }

  const dims = design.dimensions ?? []
  // Sketch S4 -- a driving dimension (parameterKey set + the param resolves)
  // reads its value FROM the solver-driven parameter; render it in a distinct
  // colour + an "fx" marker so the operator can tell driven from annotation.
  // Annotation-only dims keep today's slate text exactly.
  const DIM_ANNOTATION_COLOR = '#cbd5e1'
  const DIM_DRIVEN_COLOR = '#67e8f9'
  for (const dm of dims) {
    const pkv = dm.parameterKey
    const drivenValue =
      pkv && design.parameters[pkv] !== undefined && Number.isFinite(design.parameters[pkv])
        ? design.parameters[pkv]!
        : null
    const isDriven = drivenValue != null
    // The "fx" marker prefixes a driving dim's value text (Fusion shows a
    // small fx glyph beside driven dimensions); annotation dims show no marker.
    const fxMark = isDriven ? 'fx ' : ''
    ctx.strokeStyle = '#64748b'
    ctx.fillStyle = isDriven ? DIM_DRIVEN_COLOR : DIM_ANNOTATION_COLOR
    ctx.lineWidth = 1
    ctx.font = isDriven ? 'bold 11px system-ui' : '11px system-ui'
    // Render the value text at the SAME world anchor the select hit-test picks
    // (`dimensionLabelAnchorWorld`), so the inline edit box opens on the label.
    const anchor = dimensionLabelAnchorWorld(dm, design)
    const labelSx = anchor ? cx + (anchor[0] - ox) * scale : 0
    const labelSy = anchor ? cy - (anchor[1] - oy) * scale : 0
    if (dm.kind === 'linear' || dm.kind === 'aligned') {
      const pa = points[dm.aId]
      const pb = points[dm.bId]
      if (!pa || !pb) continue
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-9) continue
      const nx = (-dy / len) * 5
      const ny = (dx / len) * 5
      const sax = cx + (pa.x - ox) * scale
      const say = cy - (pa.y - oy) * scale
      const sbx = cx + (pb.x - ox) * scale
      const sby = cy - (pb.y - oy) * scale
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(sax + nx * scale * 0.15, say - ny * scale * 0.15)
      ctx.lineTo(sax + nx * scale, say - ny * scale)
      ctx.moveTo(sbx + nx * scale * 0.15, sby - ny * scale * 0.15)
      ctx.lineTo(sbx + nx * scale, sby - ny * scale)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(sax + nx * scale, say - ny * scale)
      ctx.lineTo(sbx + nx * scale, sby - ny * scale)
      ctx.stroke()
      const prefix = dm.kind === 'aligned' ? 'A ' : ''
      const label =
        drivenValue != null
          ? `${fxMark}${prefix}${drivenValue.toFixed(2)} mm (param ${pkv})`
          : `${prefix}${len.toFixed(2)} mm`
      ctx.fillText(label, labelSx + 4, labelSy + 4)
    } else if (dm.kind === 'angular') {
      const p1 = points[dm.a1Id]
      const p2 = points[dm.b1Id]
      const p3 = points[dm.a2Id]
      const p4 = points[dm.b2Id]
      if (!p1 || !p2 || !p3 || !p4) continue
      const v1x = p2.x - p1.x
      const v1y = p2.y - p1.y
      const v2x = p4.x - p3.x
      const v2y = p4.y - p3.y
      const l1 = Math.hypot(v1x, v1y)
      const l2 = Math.hypot(v2x, v2y)
      if (l1 < 1e-9 || l2 < 1e-9) continue
      const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
      const deg = (Math.acos(cos) * 180) / Math.PI
      ctx.fillText(
        drivenValue != null
          ? `${fxMark}${drivenValue.toFixed(2)}\u00B0 (param ${pkv})`
          : `${deg.toFixed(2)}\u00B0`,
        labelSx + 4,
        labelSy + 4
      )
    } else {
      const ent = entities.find((e) => e.id === dm.entityId)
      if (!ent) continue
      let cxMm = 0
      let cyMm = 0
      let rMm = 0
      if (ent.kind === 'circle') {
        cxMm = ent.cx
        cyMm = ent.cy
        rMm = ent.r
      } else if (ent.kind === 'ellipse') {
        cxMm = ent.cx
        cyMm = ent.cy
        rMm = (ent.rx + ent.ry) / 2
      } else if (ent.kind === 'arc') {
        const p0 = points[ent.startId]
        const p1 = points[ent.viaId]
        const p2 = points[ent.endId]
        if (!p0 || !p1 || !p2) continue
        const arcPts = sampleArcThroughThreePoints(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, 10)
        if (!arcPts || arcPts.length < 2) continue
        const a = arcPts[0]!
        const b = arcPts[Math.floor(arcPts.length / 2)]!
        const c3 = arcPts[arcPts.length - 1]!
        const cc = circleThroughThreePoints(a[0], a[1], b[0], b[1], c3[0], c3[1])
        if (!cc) continue
        cxMm = cc.ox
        cyMm = cc.oy
        rMm = cc.r
      } else {
        continue
      }
      const csx = cx + (cxMm - ox) * scale
      const csy = cy - (cyMm - oy) * scale
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.arc(csx, csy, rMm * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      const label =
        dm.kind === 'radial'
          ? drivenValue != null
            ? `${fxMark}R ${drivenValue.toFixed(2)} mm (param ${pkv})`
            : `R ${rMm.toFixed(2)} mm`
          : drivenValue != null
            ? `${fxMark}\u00D8 ${drivenValue.toFixed(2)} mm (param ${pkv})`
            : `\u00D8 ${(rMm * 2).toFixed(2)} mm`
      // Text sits at the shared label anchor (rim point on +X) so the select
      // hit-test (`dimensionLabelAnchorWorld`) opens the edit box on the label.
      ctx.fillText(label, labelSx + 6, labelSy - 6)
    }
  }

  if (trimCutter && activeTool === 'trim') {
    const ent = entities.find((x) => x.id === trimCutter.entityId)
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 3
    if (ent?.kind === 'polyline' && 'pointIds' in ent) {
      const ids = ent.pointIds
      const n = ids.length
      const ne = ent.closed ? n : n - 1
      if (trimCutter.edgeIndex >= 0 && trimCutter.edgeIndex < ne) {
        const ia = trimCutter.edgeIndex
        const idA = ids[ia]!
        const idB = ent.closed ? ids[(ia + 1) % n]! : ids[ia + 1]!
        const pa = points[idA]
        const pb = points[idB]
        if (pa && pb) {
          ctx.beginPath()
          ctx.moveTo(cx + (pa.x - ox) * scale, cy - (pa.y - oy) * scale)
          ctx.lineTo(cx + (pb.x - ox) * scale, cy - (pb.y - oy) * scale)
          ctx.stroke()
        }
      }
    } else if (ent?.kind === 'arc') {
      const apt = arcSamplePositions(ent, points, 36)
      if (apt.length >= 2) {
        ctx.beginPath()
        const p0 = apt[0]!
        ctx.moveTo(cx + (p0[0] - ox) * scale, cy - (p0[1] - oy) * scale)
        for (let i = 1; i < apt.length; i++) {
          const p = apt[i]!
          ctx.lineTo(cx + (p[0] - ox) * scale, cy - (p[1] - oy) * scale)
        }
        ctx.stroke()
      }
    }
    ctx.strokeStyle = '#9333ea'
    ctx.lineWidth = 2
  }

  if (extendCutter && activeTool === 'extend') {
    const ent = entities.find((x) => x.id === extendCutter.entityId)
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 3
    if (ent?.kind === 'polyline' && 'pointIds' in ent) {
      const ids = ent.pointIds
      const n = ids.length
      const ne = ent.closed ? n : n - 1
      if (extendCutter.edgeIndex >= 0 && extendCutter.edgeIndex < ne) {
        const ia = extendCutter.edgeIndex
        const idA = ids[ia]!
        const idB = ent.closed ? ids[(ia + 1) % n]! : ids[ia + 1]!
        const pa = points[idA]
        const pb = points[idB]
        if (pa && pb) {
          ctx.beginPath()
          ctx.moveTo(cx + (pa.x - ox) * scale, cy - (pa.y - oy) * scale)
          ctx.lineTo(cx + (pb.x - ox) * scale, cy - (pb.y - oy) * scale)
          ctx.stroke()
        }
      }
    } else if (ent?.kind === 'arc') {
      const apt = arcSamplePositions(ent, points, 36)
      if (apt.length >= 2) {
        ctx.beginPath()
        const p0 = apt[0]!
        ctx.moveTo(cx + (p0[0] - ox) * scale, cy - (p0[1] - oy) * scale)
        for (let i = 1; i < apt.length; i++) {
          const p = apt[i]!
          ctx.lineTo(cx + (p[0] - ox) * scale, cy - (p[1] - oy) * scale)
        }
        ctx.stroke()
      }
    }
    ctx.strokeStyle = '#9333ea'
    ctx.lineWidth = 2
  }

  // ── Sketch S1 — selected-entity highlight + drag-move ghost (select tool) ──
  // Mirrors the existing highlight idiom: solid re-stroke in the selection
  // green (same #4ade80 the xform vertex selection uses, cutter-weight 3 px);
  // the drag ghost re-strokes the SAME outlines dashed at the snapped offset,
  // so the preview always lands exactly where the committed move will.
  if (selectedEntityIds && selectedEntityIds.size > 0) {
    ctx.save()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#4ade80'
    ctx.fillStyle = 'transparent'
    for (const e of entities) {
      if (!selectedEntityIds.has(e.id)) continue
      const outline = entityOutlineWorld(e, points)
      if (!outline) continue
      // Selected CONSTRUCTION geometry keeps its dashed identity: solid green
      // is reserved for selected normal geometry, dashed green = selected
      // construction — both states stay visually distinct.
      ctx.setLineDash(e.construction === true ? [...CONSTRUCTION_DASH] : [])
      drawShape(outline.pts, outline.closed)
    }
    ctx.setLineDash([])
    const ghost = selectionGhostOffsetMm
    if (ghost && (ghost[0] !== 0 || ghost[1] !== 0)) {
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#86efac'
      for (const e of entities) {
        if (!selectedEntityIds.has(e.id)) continue
        const outline = entityOutlineWorld(e, points)
        if (!outline) continue
        drawShape(
          outline.pts.map(([gx, gy]) => [gx + ghost[0], gy + ghost[1]] as [number, number]),
          outline.closed
        )
      }
      ctx.setLineDash([])
    }
    ctx.restore()
  }

  // -- Sketch S2 -- node-edit handles (single-selected entity, select tool) --
  // Square grips in the same selection green; the ACTIVE (armed / dragging)
  // node fills solid. A mid-drag ghost re-strokes the reshaped outline dashed
  // in the S1 ghost tint, so the preview lands exactly where the commit will.
  if (nodeEditOverlay && nodeEditOverlay.handles.length > 0) {
    ctx.save()
    if (nodeEditOverlay.ghostOutline) {
      ctx.lineWidth = 2
      ctx.strokeStyle = '#86efac'
      ctx.fillStyle = 'transparent'
      ctx.setLineDash([4, 4])
      drawShape(nodeEditOverlay.ghostOutline.pts, nodeEditOverlay.ghostOutline.closed)
      ctx.setLineDash([])
    }
    const half = 4
    ctx.lineWidth = 2
    for (const grip of nodeEditOverlay.handles) {
      const hx = cx + (grip.x - ox) * scale
      const hy = cy - (grip.y - oy) * scale
      ctx.strokeStyle = '#4ade80'
      ctx.fillStyle = grip.active ? '#4ade80' : '#0c0612'
      ctx.beginPath()
      ctx.rect(hx - half, hy - half, half * 2, half * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.fillStyle = '#c4b5fd'
  for (const p of Object.values(points)) {
    const sx = cx + (p.x - ox) * scale
    const sy = cy - (p.y - oy) * scale
    ctx.beginPath()
    const pr = constraintPickActive ? (p.fixed ? 6 : 5) : p.fixed ? 4 : 3
    ctx.arc(sx, sy, pr, 0, Math.PI * 2)
    ctx.fill()
  }

  if (constraintPickActive && constraintHover) {
    ctx.save()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    if (constraintHover.kind === 'vertex') {
      const pv = points[constraintHover.id]
      if (pv) {
        const sx = cx + (pv.x - ox) * scale
        const sy = cy - (pv.y - oy) * scale
        ctx.beginPath()
        ctx.arc(sx, sy, 11, 0, Math.PI * 2)
        ctx.stroke()
      }
    } else {
      const pa = points[constraintHover.a]
      const pb = points[constraintHover.b]
      if (pa && pb) {
        ctx.beginPath()
        ctx.moveTo(cx + (pa.x - ox) * scale, cy - (pa.y - oy) * scale)
        ctx.lineTo(cx + (pb.x - ox) * scale, cy - (pb.y - oy) * scale)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  if (polyDraft.length > 0) {
    ctx.strokeStyle = '#a78bfa'
    ctx.fillStyle = 'transparent'
    drawShape(polyDraft, false)
  }

  if (activeTool === 'ellipse' && ellipseDraft.length > 0) {
    ctx.fillStyle = '#a78bfa'
    for (const q of ellipseDraft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (ellipseDraft.length === 2 && ellipseHover) {
      const c2 = ellipseDraft[0]!
      const maj = ellipseDraft[1]!
      const g = ellipseFromCenterMajorMinor(c2[0], c2[1], maj[0], maj[1], ellipseHover[0], ellipseHover[1])
      if (g && g.rx > 0.5 && g.ry > 0.5) {
        const ghost = ellipseLoopWorld(c2[0], c2[1], g.rx, g.ry, g.rotation, ELLIPSE_PROFILE_SEGMENTS)
        ctx.strokeStyle = '#a78bfa'
        ctx.fillStyle = 'transparent'
        ctx.setLineDash([4, 4])
        drawShape(ghost, true)
        ctx.setLineDash([])
      }
    }
  }

  if (splineFitDraft.length > 0) {
    ctx.strokeStyle = '#a78bfa'
    ctx.fillStyle = 'transparent'
    drawShape(splineFitDraft, false)
  }
  if (splineCpDraft.length > 0) {
    ctx.strokeStyle = '#c4b5fd'
    ctx.fillStyle = 'transparent'
    drawShape(splineCpDraft, false)
  }

  if (
    xformDraft.length > 0 &&
    (activeTool === 'move_sk' ||
      activeTool === 'rotate_sk' ||
      activeTool === 'scale_sk' ||
      activeTool === 'mirror_sk')
  ) {
    ctx.fillStyle = '#fbbf24'
    for (const q of xformDraft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (
    xformSelectionIds.length > 0 &&
    (activeTool === 'move_sk' ||
      activeTool === 'rotate_sk' ||
      activeTool === 'scale_sk' ||
      activeTool === 'mirror_sk')
  ) {
    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = 2
    for (const id of xformSelectionIds) {
      const p = points[id]
      if (!p) continue
      const sx = cx + (p.x - ox) * scale
      const sy = cy - (p.y - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  if (activeTool === 'line' && lineStart && lineHover) {
    ctx.strokeStyle = '#a78bfa'
    ctx.fillStyle = 'transparent'
    ctx.setLineDash([4, 4])
    drawShape([lineStart, lineHover], false)
    ctx.setLineDash([])
  }

  if (activeTool === 'circle_2pt' && circle2ptStart && circle2ptHover) {
    const g = circleFromDiameterEndpoints(
      circle2ptStart[0],
      circle2ptStart[1],
      circle2ptHover[0],
      circle2ptHover[1]
    )
    if (g && g.r > 1e-6) {
      ctx.strokeStyle = '#a78bfa'
      ctx.fillStyle = 'transparent'
      ctx.setLineDash([4, 4])
      drawShape([circle2ptStart, circle2ptHover], false)
      ctx.beginPath()
      ctx.arc(cx + (g.cx - ox) * scale, cy - (g.cy - oy) * scale, g.r * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  if (activeTool === 'circle_3pt' && circle3Draft.length > 0) {
    ctx.fillStyle = '#a78bfa'
    for (const q of circle3Draft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (circle3Draft.length === 2 && circle3Hover) {
      const [a, b] = circle3Draft
      const circ = circleThroughThreePoints(a![0], a![1], b![0], b![1], circle3Hover[0], circle3Hover[1])
      if (circ && circ.r > 1e-6) {
        ctx.strokeStyle = '#a78bfa'
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.arc(cx + (circ.ox - ox) * scale, cy - (circ.oy - oy) * scale, circ.r * scale, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }

  if (activeTool === 'rect_3pt' && rect3Draft.length > 0) {
    ctx.fillStyle = '#a78bfa'
    for (const q of rect3Draft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (rect3Draft.length === 2 && rect3Hover) {
      const [a, b] = rect3Draft
      const rr = rectFromThreePoints(a![0], a![1], b![0], b![1], rect3Hover[0], rect3Hover[1])
      if (rr && rr.w >= 0.5 && rr.h >= 0.5) {
        const ghost = worldCornersFromRectParams(rr)
        ctx.strokeStyle = '#a78bfa'
        ctx.fillStyle = 'transparent'
        ctx.setLineDash([4, 4])
        drawShape(ghost, true)
        ctx.setLineDash([])
      }
    }
  }

  if (activeTool === 'polygon' && polygonCenter) {
    const pcx = cx + (polygonCenter[0] - ox) * scale
    const pcy = cy - (polygonCenter[1] - oy) * scale
    ctx.fillStyle = '#a78bfa'
    ctx.beginPath()
    ctx.arc(pcx, pcy, 5, 0, Math.PI * 2)
    ctx.fill()
    const hover = polygonHover ?? polygonCenter
    const r = Math.hypot(hover[0] - polygonCenter[0], hover[1] - polygonCenter[1])
    if (r > 0.5) {
      const sides = Math.max(3, Math.min(128, Math.floor(polygonSides)))
      const start = Math.atan2(hover[1] - polygonCenter[1], hover[0] - polygonCenter[0])
      const ghost = regularPolygonVertices(polygonCenter[0], polygonCenter[1], r, start, sides)
      ctx.strokeStyle = '#a78bfa'
      ctx.fillStyle = 'transparent'
      ctx.setLineDash([4, 4])
      drawShape(ghost, true)
      ctx.setLineDash([])
    }
  }

  if (activeTool === 'slot_center' && slotCenterDraft.length > 0) {
    ctx.fillStyle = '#a78bfa'
    for (const q of slotCenterDraft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (slotCenterDraft.length === 2 && slotWidthHover) {
      const c0 = slotCenterDraft[0]!
      const c1 = slotCenterDraft[1]!
      const wMm = 2 * perpDistanceToLineThroughPoints(
        slotWidthHover[0],
        slotWidthHover[1],
        c0[0],
        c0[1],
        c1[0],
        c1[1]
      )
      const pr = slotParamsFromCapCenters(c0[0], c0[1], c1[0], c1[1], Math.max(0.5, wMm))
      if (pr && wMm > 0.25) {
        const ghost = slotCapsuleLoopWorld(
          pr.cx,
          pr.cy,
          pr.length,
          pr.width,
          pr.rotation,
          CANVAS_SLOT_SEGMENTS
        )
        if (ghost.length >= 3) {
          ctx.strokeStyle = '#a78bfa'
          ctx.fillStyle = 'transparent'
          ctx.setLineDash([4, 4])
          drawShape(ghost, true)
          ctx.setLineDash([])
        }
      }
    }
  }

  if (activeTool === 'slot_overall' && slotOverallDraft.length > 0) {
    ctx.fillStyle = '#a78bfa'
    for (const q of slotOverallDraft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (slotOverallDraft.length === 2 && slotOverallWidthHover) {
      const t0 = slotOverallDraft[0]!
      const t1 = slotOverallDraft[1]!
      const wMm = 2 * perpDistanceToLineThroughPoints(
        slotOverallWidthHover[0],
        slotOverallWidthHover[1],
        t0[0],
        t0[1],
        t1[0],
        t1[1]
      )
      const pr = slotParamsFromOverallTips(t0[0], t0[1], t1[0], t1[1], Math.max(0.5, wMm))
      if (pr && wMm > 0.25) {
        const ghost = slotCapsuleLoopWorld(
          pr.cx,
          pr.cy,
          pr.length,
          pr.width,
          pr.rotation,
          CANVAS_SLOT_SEGMENTS
        )
        if (ghost.length >= 3) {
          ctx.strokeStyle = '#a78bfa'
          ctx.fillStyle = 'transparent'
          ctx.setLineDash([4, 4])
          drawShape(ghost, true)
          ctx.setLineDash([])
        }
      }
    }
  }

  if ((activeTool === 'arc' || activeTool === 'arc_center') && arcDraft.length > 0) {
    ctx.fillStyle = '#a78bfa'
    for (const q of arcDraft) {
      const sx = cx + (q[0] - ox) * scale
      const sy = cy - (q[1] - oy) * scale
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (arcDraft.length === 2) {
      ctx.strokeStyle = '#a78bfa'
      ctx.fillStyle = 'transparent'
      const [a, b] = arcDraft
      if (activeTool === 'arc') {
        drawShape([a!, b!], false)
      } else {
        const [cx0, cy0] = a!
        const [sx0, sy0] = b!
        const r0 = Math.hypot(sx0 - cx0, sy0 - cy0)
        if (r0 > 1e-6) {
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          const scx = cx + (cx0 - ox) * scale
          const scy = cy - (cy0 - oy) * scale
          ctx.arc(scx, scy, r0 * scale, 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
      if (arcHover) {
        const ghost =
          activeTool === 'arc'
            ? sampleArcThroughThreePoints(a![0], a![1], b![0], b![1], arcHover[0], arcHover[1], 32)
            : sampleCenterStartEndArc(a![0], a![1], b![0], b![1], arcHover[0], arcHover[1], 32)
        if (ghost && ghost.length >= 2) {
          ctx.setLineDash([4, 4])
          drawShape(ghost, false)
          ctx.setLineDash([])
        }
      }
    }
  }

  if (drag?.kind === 'rect') {
    const [x1d, y1d] = drag.a
    const [x2d, y2d] = drag.b
    const pts: [number, number][] = [
      [x1d, y1d],
      [x2d, y1d],
      [x2d, y2d],
      [x1d, y2d]
    ]
    drawShape(pts, true)
  }
  if (drag?.kind === 'circle') {
    const sx = cx + (drag.c[0] - ox) * scale
    const sy = cy - (drag.c[1] - oy) * scale
    ctx.beginPath()
    ctx.arc(sx, sy, drag.r * scale, 0, Math.PI * 2)
    ctx.strokeStyle = '#a78bfa'
    ctx.stroke()
  }

  // Sketch S3 -- marquee box-select rubber band (AutoCAD convention): window
  // (L->R) = solid box in the classic blue tint, crossing (R->L) = dashed box
  // in the classic green tint. Canvas strokeStyle cannot take ``var(--x)``
  // literals, so the marquee CSS vars resolve through getComputedStyle with
  // literal fallbacks (the established token idiom) -- jsdom / a detached
  // canvas still paints a sane colour.
  if (marquee) {
    const max1 = cx + (marquee.a[0] - ox) * scale
    const may1 = cy - (marquee.a[1] - oy) * scale
    const mbx2 = cx + (marquee.b[0] - ox) * scale
    const mby2 = cy - (marquee.b[1] - oy) * scale
    const mLeft = Math.min(max1, mbx2)
    const mTop = Math.min(may1, mby2)
    const mW = Math.abs(mbx2 - max1)
    const mH = Math.abs(mby2 - may1)
    const marqueeVars = typeof window !== 'undefined' ? window.getComputedStyle(c) : null
    const marqueeToken = (name: string, fallback: string): string => {
      const live = marqueeVars?.getPropertyValue(name).trim()
      return live && live.length > 0 ? live : fallback
    }
    const isWindowBox = marquee.mode === 'window'
    ctx.save()
    ctx.fillStyle = isWindowBox
      ? marqueeToken('--sketch-marquee-window-fill', 'rgba(96, 165, 250, 0.14)')
      : marqueeToken('--sketch-marquee-crossing-fill', 'rgba(74, 222, 128, 0.12)')
    ctx.fillRect(mLeft, mTop, mW, mH)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = isWindowBox
      ? marqueeToken('--sketch-marquee-window', '#60a5fa')
      : marqueeToken('--sketch-marquee-crossing', '#4ade80')
    ctx.setLineDash(isWindowBox ? [] : [5, 4])
    ctx.strokeRect(crisp(mLeft), crisp(mTop), Math.max(1, Math.round(mW)), Math.max(1, Math.round(mH)))
    ctx.setLineDash([])
    ctx.restore()
  }

  // Sketch S4 -- the dimension tool's first-picked vertex, ringed so the
  // operator sees where a point-to-point dimension started (drawn before the
  // osnap glyph so an active snap still reads on top).
  if (dimensionDraftPoint) {
    const dsx = cx + (dimensionDraftPoint[0] - ox) * scale
    const dsy = cy - (dimensionDraftPoint[1] - oy) * scale
    ctx.save()
    ctx.strokeStyle = '#67e8f9'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(dsx, dsy, 7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // Sketch S5 -- the angular tool's first picked line, re-stroked in the same
  // dimension cyan so the operator sees which side they are measuring the angle
  // from before picking the second line (mirrors the draft-point ring idiom).
  if (dimensionAngularFirstLine) {
    const [a, b] = dimensionAngularFirstLine
    ctx.save()
    ctx.strokeStyle = '#67e8f9'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(cx + (a[0] - ox) * scale, cy - (a[1] - oy) * scale)
    ctx.lineTo(cx + (b[0] - ox) * scale, cy - (b[1] - oy) * scale)
    ctx.stroke()
    ctx.restore()
  }

  // Sketch S2 -- active object-snap marker: AutoCAD-style glyph per kind at
  // the snapped point + a kind label chip near the cursor (drawn last so it
  // overlays entities; mirrors the canvas's fillText readout idiom).
  if (osnapMarker) {
    const msx = cx + (osnapMarker.point[0] - ox) * scale
    const msy = cy - (osnapMarker.point[1] - oy) * scale
    const r = 6
    ctx.save()
    ctx.lineWidth = 1.6
    ctx.strokeStyle = '#fbbf24'
    ctx.fillStyle = 'rgba(251, 191, 36, 0.16)'
    ctx.beginPath()
    switch (osnapMarker.kind) {
      case 'endpoint':
        ctx.rect(msx - r, msy - r, r * 2, r * 2)
        break
      case 'midpoint':
        ctx.moveTo(msx, msy - r)
        ctx.lineTo(msx + r, msy + r)
        ctx.lineTo(msx - r, msy + r)
        ctx.closePath()
        break
      case 'center':
        ctx.arc(msx, msy, r, 0, Math.PI * 2)
        break
      case 'quadrant':
        ctx.moveTo(msx, msy - r)
        ctx.lineTo(msx + r, msy)
        ctx.lineTo(msx, msy + r)
        ctx.lineTo(msx - r, msy)
        ctx.closePath()
        break
      case 'intersection':
        ctx.moveTo(msx - r, msy - r)
        ctx.lineTo(msx + r, msy + r)
        ctx.moveTo(msx - r, msy + r)
        ctx.lineTo(msx + r, msy - r)
        break
      default: {
        const _exhaustive: never = osnapMarker.kind
        void _exhaustive
        break
      }
    }
    if (osnapMarker.kind !== 'intersection') ctx.fill()
    ctx.stroke()
    if (osnapMarker.kind === 'center') {
      ctx.beginPath()
      ctx.arc(msx, msy, 1.5, 0, Math.PI * 2)
      ctx.fillStyle = '#fbbf24'
      ctx.fill()
    }
    const chip = osnapKindLabel(osnapMarker.kind)
    ctx.font = 'bold 10px system-ui, sans-serif'
    const chipW = ctx.measureText(chip).width + 10
    const chipX = Math.min(vw - chipW - 4, msx + 12)
    const chipY = Math.max(14, msy - 14)
    ctx.fillStyle = 'rgba(12, 6, 18, 0.85)'
    ctx.fillRect(chipX, chipY - 10, chipW, 14)
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(chipX + 0.5, chipY - 9.5, chipW - 1, 13)
    ctx.fillStyle = '#fbbf24'
    ctx.fillText(chip, chipX + 5, chipY + 1)
    ctx.restore()
  }

  ctx.fillStyle = '#a78bfa'
  ctx.font = '12px system-ui'
  let pickHint = ''
  if (constraintPickActive) {
    pickHint =
      constraintSegmentPickActive && onConstraintSegmentPick
        ? ' \u00B7 Pick: vertex or segment (exact click, not grid snap)'
        : ' \u00B7 Pick: vertex (exact click, not grid snap)'
  }
  ctx.fillText(`Scale ${scale.toFixed(2)} px/mm \u00B7 Middle-drag pan \u00B7 Wheel zoom${pickHint}`, 8, vh - 8)
}
