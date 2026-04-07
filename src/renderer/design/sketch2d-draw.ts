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
import type { SketchTool } from './Sketch2DCanvas'

const CANVAS_SLOT_SEGMENTS = 24

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
        ctx.fillStyle = e.closed ? 'rgba(147, 51, 234, 0.12)' : 'transparent'
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
        ctx.fillStyle = e.closed ? 'rgba(147, 51, 234, 0.12)' : 'transparent'
        drawShape(loop, !!e.closed)
        ctx.fillStyle = 'rgba(147, 51, 234, 0.12)'
      }
    }
  }

  const dims = design.dimensions ?? []
  for (const dm of dims) {
    ctx.strokeStyle = '#64748b'
    ctx.fillStyle = '#cbd5e1'
    ctx.lineWidth = 1
    ctx.font = '11px system-ui'
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
      const mx = (sax + sbx) / 2 + nx * scale
      const my = (say + sby) / 2 - ny * scale
      const prefix = dm.kind === 'aligned' ? 'A ' : ''
      const pk = dm.parameterKey
      const driven =
        pk && design.parameters[pk] !== undefined && Number.isFinite(design.parameters[pk])
          ? design.parameters[pk]!
          : null
      const label =
        driven != null ? `${prefix}${driven.toFixed(2)} mm (param ${pk})` : `${prefix}${len.toFixed(2)} mm`
      ctx.fillText(label, mx + 4, my + 4)
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
      const mmx = ((p1.x + p2.x + p3.x + p4.x) * 0.25 - ox) * scale + cx
      const mmy = (-(p1.y + p2.y + p3.y + p4.y) * 0.25 + oy) * scale + cy
      const pk = dm.parameterKey
      const driven =
        pk && design.parameters[pk] !== undefined && Number.isFinite(design.parameters[pk])
          ? design.parameters[pk]!
          : null
      ctx.fillText(
        driven != null ? `${driven.toFixed(2)}\u00B0 (param ${pk})` : `${deg.toFixed(2)}\u00B0`,
        mmx + 4,
        mmy + 4
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
      const pk = dm.parameterKey
      const driven =
        pk && design.parameters[pk] !== undefined && Number.isFinite(design.parameters[pk])
          ? design.parameters[pk]!
          : null
      const label =
        dm.kind === 'radial'
          ? driven != null
            ? `R ${driven.toFixed(2)} mm (param ${pk})`
            : `R ${rMm.toFixed(2)} mm`
          : driven != null
            ? `\u00D8 ${driven.toFixed(2)} mm (param ${pk})`
            : `\u00D8 ${(rMm * 2).toFixed(2)} mm`
      ctx.fillText(label, csx + rMm * scale + 6, csy - 6)
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
