/**
 * Sketch2DCanvas event-handler logic, extracted from the monolithic component.
 *
 * These are **pure functions** that receive the current sketch state and return
 * an action descriptor (or `null` when nothing should happen). The component
 * interprets the descriptors to update React state. This keeps the handlers
 * fully testable without mounting a React tree.
 */
import type { DesignFileV2 } from '../../shared/design-schema'
import {
  applySketchCornerChamfer,
  applySketchCornerFillet,
  breakSketchEdge,
  circleFromDiameterEndpoints,
  circleThroughThreePoints,
  ellipseFromCenterMajorMinor,
  extendSketchEdge,
  pickNearestCircularEntityId,
  pickNearestSketchEdge,
  rectFromThreePoints,
  regularPolygonVertices,
  perpDistanceToLineThroughPoints,
  slotParamsFromCapCenters,
  slotParamsFromOverallTips,
  splitSketchEdge,
  trimSketchEdge,
  arcViaForCenterStartEnd,
  sampleArcThroughThreePoints,
  sampleCenterStartEndArc,
  type SketchTrimEdgeRef
} from '../../shared/sketch-profile'
import {
  mirrorSketchAcrossLine,
  mirrorSketchPointsAcrossLine,
  rotateSketchAround,
  rotateSketchPointsAround,
  scaleSketchAround,
  scaleSketchPointsAround,
  translateSketch,
  translateSketchPoints
} from './design-ops'
import type { SketchTool } from './Sketch2DCanvas'

// ---------------------------------------------------------------------------
// Action types returned by handler functions
// ---------------------------------------------------------------------------

/** Returned when a fillet/chamfer/trim/split/break/extend tool click is handled. */
export type ToolEditAction =
  | { tag: 'designChange'; design: DesignFileV2; hint?: string }
  | { tag: 'setFirstEdge'; ref: SketchTrimEdgeRef; hint?: string }
  | { tag: 'clearFirstEdge'; hint: string }
  | { tag: 'hint'; message: string }

/** Handle fillet tool click. */
export function handleFilletClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number,
  filletFirst: SketchTrimEdgeRef | null,
  filletRadiusMm: number
): ToolEditAction {
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestSketchEdge(design, rawX, rawY, tol)
  if (!hit) return { tag: 'hint', message: 'Fillet: pick two edges (polyline corner or two arcs sharing an endpoint).' }
  const targetEnt = design.entities.find((e) => e.id === hit.entityId)
  if (!targetEnt || (targetEnt.kind !== 'polyline' && targetEnt.kind !== 'arc')) {
    return { tag: 'hint', message: 'Fillet: currently supports point-ID polyline corners or arc-arc shared endpoints.' }
  }
  if (!filletFirst) {
    return { tag: 'setFirstEdge', ref: { entityId: hit.entityId, edgeIndex: hit.edgeIndex }, hint: 'Fillet: pick the second edge meeting at the same corner.' }
  }
  const res = applySketchCornerFillet(
    design,
    filletFirst,
    { entityId: hit.entityId, edgeIndex: hit.edgeIndex },
    Math.max(0.01, filletRadiusMm)
  )
  if (!res.ok) return { tag: 'clearFirstEdge', hint: `Fillet failed: ${res.error}` }
  return { tag: 'designChange', design: res.design, hint: 'Fillet applied.' }
}

/** Handle chamfer tool click. */
export function handleChamferClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number,
  chamferFirst: SketchTrimEdgeRef | null,
  chamferLengthMm: number
): ToolEditAction {
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestSketchEdge(design, rawX, rawY, tol)
  if (!hit) return { tag: 'hint', message: 'Chamfer: pick two consecutive polyline edges at a corner (not arc / rect).' }
  const ent = design.entities.find((e) => e.id === hit.entityId)
  if (!ent || ent.kind !== 'polyline' || !('pointIds' in ent)) {
    return { tag: 'hint', message: 'Chamfer: only point-ID polyline edges (not legacy inline polyline).' }
  }
  if (!chamferFirst) {
    return { tag: 'setFirstEdge', ref: { entityId: hit.entityId, edgeIndex: hit.edgeIndex }, hint: 'Chamfer: pick the second edge meeting at the same corner.' }
  }
  const res = applySketchCornerChamfer(
    design,
    chamferFirst,
    { entityId: hit.entityId, edgeIndex: hit.edgeIndex },
    Math.max(0.01, chamferLengthMm)
  )
  if (!res.ok) return { tag: 'clearFirstEdge', hint: `Chamfer failed: ${res.error}` }
  return { tag: 'designChange', design: res.design, hint: 'Chamfer applied.' }
}

/** Handle trim tool click. */
export function handleTrimClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number,
  trimCutter: SketchTrimEdgeRef | null
): ToolEditAction {
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestSketchEdge(design, rawX, rawY, tol)
  if (!hit) return { tag: 'hint', message: 'Trim: click closer to a polyline or arc.' }
  if (!trimCutter) {
    return { tag: 'setFirstEdge', ref: { entityId: hit.entityId, edgeIndex: hit.edgeIndex }, hint: 'Trim: pick edge to trim — click on the side you want to remove.' }
  }
  const res = trimSketchEdge(
    design,
    trimCutter,
    { entityId: hit.entityId, edgeIndex: hit.edgeIndex },
    [rawX, rawY]
  )
  if (!res.ok) return { tag: 'clearFirstEdge', hint: `Trim failed: ${res.error}` }
  return { tag: 'designChange', design: res.design, hint: 'Trim applied.' }
}

/** Handle split tool click. */
export function handleSplitClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number
): ToolEditAction | null {
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestSketchEdge(design, rawX, rawY, tol)
  if (!hit) return { tag: 'hint', message: 'Split: click closer to a polyline edge or arc.' }
  const res = splitSketchEdge(design, { entityId: hit.entityId, edgeIndex: hit.edgeIndex }, [rawX, rawY])
  if (!res.ok) return { tag: 'hint', message: `Split failed: ${res.error}` }
  return { tag: 'designChange', design: res.design, hint: 'Split applied.' }
}

/** Handle break tool click. */
export function handleBreakClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number
): ToolEditAction | null {
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestSketchEdge(design, rawX, rawY, tol)
  if (!hit) return { tag: 'hint', message: 'Break: click closer to a polyline edge or arc.' }
  const res = breakSketchEdge(design, { entityId: hit.entityId, edgeIndex: hit.edgeIndex }, [rawX, rawY])
  if (!res.ok) return { tag: 'hint', message: `Break failed: ${res.error}` }
  return { tag: 'designChange', design: res.design, hint: 'Break applied.' }
}

/** Handle extend tool click. */
export function handleExtendClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number,
  extendCutter: SketchTrimEdgeRef | null
): ToolEditAction {
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestSketchEdge(design, rawX, rawY, tol)
  if (!hit) return { tag: 'hint', message: 'Extend: click closer to a boundary/target edge or arc.' }
  if (!extendCutter) {
    return { tag: 'setFirstEdge', ref: { entityId: hit.entityId, edgeIndex: hit.edgeIndex }, hint: 'Extend: pick target edge to extend.' }
  }
  const res = extendSketchEdge(
    design,
    extendCutter,
    { entityId: hit.entityId, edgeIndex: hit.edgeIndex },
    [rawX, rawY]
  )
  if (!res.ok) return { tag: 'clearFirstEdge', hint: `Extend failed: ${res.error}` }
  return { tag: 'designChange', design: res.design, hint: 'Extend applied.' }
}

// ---------------------------------------------------------------------------
// Geometry creation helpers (polygon, slot, circle variants, rect_3pt, ellipse)
// ---------------------------------------------------------------------------

export type GeometryCreateAction =
  | { tag: 'designChange'; design: DesignFileV2; hint?: string }
  | { tag: 'advanceDraft'; hint?: string }
  | { tag: 'hint'; message: string }

/** Handle polygon tool click. Returns `null` when setting polygon center (first click). */
export function handlePolygonClick(
  design: DesignFileV2,
  w: [number, number],
  polygonCenter: [number, number] | null,
  polygonSides: number
): GeometryCreateAction | null {
  if (!polygonCenter) return null // caller sets center
  const sides = Math.max(3, Math.min(128, Math.floor(polygonSides)))
  const r = Math.hypot(w[0] - polygonCenter[0], w[1] - polygonCenter[1])
  if (r < 0.5) return { tag: 'hint', message: 'Polygon: second pick must be away from center (sets radius).' }
  const start = Math.atan2(w[1] - polygonCenter[1], w[0] - polygonCenter[0])
  const verts = regularPolygonVertices(polygonCenter[0], polygonCenter[1], r, start, sides)
  const ids = verts.map(() => crypto.randomUUID())
  const nextPoints = { ...design.points }
  verts.forEach((pt, i) => { nextPoints[ids[i]!] = { x: pt[0], y: pt[1] } })
  const eid = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: {
      ...design,
      points: nextPoints,
      entities: [...design.entities, { id: eid, kind: 'polyline', pointIds: ids, closed: true }]
    },
    hint: `Polygon (${sides} sides) placed.`
  }
}

/** Handle slot_center tool click. Returns `null` when draft is still building. */
export function handleSlotCenterClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][]
): GeometryCreateAction | null {
  if (draft.length === 0 || draft.length === 1) return null // caller appends to draft
  const c0 = draft[0]!
  const c1 = draft[1]!
  const width = 2 * perpDistanceToLineThroughPoints(w[0], w[1], c0[0], c0[1], c1[0], c1[1])
  const p = slotParamsFromCapCenters(c0[0], c0[1], c1[0], c1[1], width)
  if (!p) return { tag: 'hint', message: 'Slot: width too small — click farther from the center line.' }
  const id = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: {
      ...design,
      entities: [...design.entities, { id, kind: 'slot', cx: p.cx, cy: p.cy, length: p.length, width: p.width, rotation: p.rotation }]
    },
    hint: 'Slot placed.'
  }
}

/** Handle slot_overall tool click. Returns `null` when draft is building. */
export function handleSlotOverallClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][]
): GeometryCreateAction | null {
  if (draft.length === 0 || draft.length === 1) return null
  const t0 = draft[0]!
  const t1 = draft[1]!
  const width = 2 * perpDistanceToLineThroughPoints(w[0], w[1], t0[0], t0[1], t1[0], t1[1])
  const p = slotParamsFromOverallTips(t0[0], t0[1], t1[0], t1[1], width)
  if (!p) return { tag: 'hint', message: 'Slot (overall): width must not exceed tip-to-tip distance; click farther from the axis.' }
  const id = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: {
      ...design,
      entities: [...design.entities, { id, kind: 'slot', cx: p.cx, cy: p.cy, length: p.length, width: p.width, rotation: p.rotation }]
    },
    hint: 'Slot (overall) placed.'
  }
}

/** Handle circle_2pt tool second click. Returns `null` if still waiting for first click. */
export function handleCircle2ptClick(
  design: DesignFileV2,
  w: [number, number],
  start: [number, number] | null
): GeometryCreateAction | null {
  if (!start) return null
  const g = circleFromDiameterEndpoints(start[0], start[1], w[0], w[1])
  if (!g || g.r < 0.5) return { tag: 'hint', message: 'Circle (2 pt): pick two distinct points for diameter.' }
  const id = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: { ...design, entities: [...design.entities, { id, kind: 'circle', cx: g.cx, cy: g.cy, r: g.r }] }
  }
}

/** Handle circle_3pt tool click. Returns `null` when still collecting draft points. */
export function handleCircle3ptClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][]
): GeometryCreateAction | null {
  if (draft.length < 2) return null
  const p0 = draft[0]!
  const p1 = draft[1]!
  const circ = circleThroughThreePoints(p0[0], p0[1], p1[0], p1[1], w[0], w[1])
  if (!circ || circ.r < 1e-6) return { tag: 'hint', message: 'Circle (3 pt): points must not be collinear.' }
  const id = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: { ...design, entities: [...design.entities, { id, kind: 'circle', cx: circ.ox, cy: circ.oy, r: circ.r }] }
  }
}

/** Handle rect_3pt tool third click. Returns `null` when still collecting draft points. */
export function handleRect3ptClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][]
): GeometryCreateAction | null {
  if (draft.length < 2) return null
  const p0 = draft[0]!
  const p1 = draft[1]!
  const rr = rectFromThreePoints(p0[0], p0[1], p1[0], p1[1], w[0], w[1])
  if (!rr || rr.w < 0.5 || rr.h < 0.5) return { tag: 'hint', message: 'Rect (3 pt): third point must be off the first edge (non-zero height).' }
  const id = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: { ...design, entities: [...design.entities, { id, kind: 'rect', cx: rr.cx, cy: rr.cy, w: rr.w, h: rr.h, rotation: rr.rotation }] }
  }
}

/** Handle ellipse tool third click. Returns `null` when still collecting draft points. */
export function handleEllipseClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][]
): GeometryCreateAction | null {
  if (draft.length < 2) return null
  const c = draft[0]!
  const maj = draft[1]!
  const g = ellipseFromCenterMajorMinor(c[0], c[1], maj[0], maj[1], w[0], w[1])
  if (!g) return { tag: 'hint', message: 'Ellipse: third pick must define a non-zero minor axis.' }
  const id = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: {
      ...design,
      entities: [...design.entities, { id, kind: 'ellipse', cx: c[0], cy: c[1], rx: g.rx, ry: g.ry, rotation: g.rotation }]
    },
    hint: 'Ellipse placed.'
  }
}

// ---------------------------------------------------------------------------
// Transform tools (move, rotate, scale, mirror)
// ---------------------------------------------------------------------------

export type TransformAction =
  | { tag: 'designChange'; design: DesignFileV2; hint: string }
  | { tag: 'setAnchor' }

/** Handle move_sk tool click. */
export function handleMoveClick(
  design: DesignFileV2,
  w: [number, number],
  anchor: [number, number] | null,
  selectionIds: string[]
): TransformAction {
  if (!anchor) return { tag: 'setAnchor' }
  const dx = w[0] - anchor[0]
  const dy = w[1] - anchor[1]
  if (selectionIds.length > 0) {
    return { tag: 'designChange', design: translateSketchPoints(design, dx, dy, new Set(selectionIds)), hint: 'Selection moved.' }
  }
  return { tag: 'designChange', design: translateSketch(design, dx, dy), hint: 'Sketch moved.' }
}

/** Handle rotate_sk tool click. */
export function handleRotateClick(
  design: DesignFileV2,
  w: [number, number],
  anchor: [number, number] | null,
  selectionIds: string[],
  rotateDeg: number
): TransformAction {
  if (!anchor) return { tag: 'setAnchor' }
  if (selectionIds.length > 0) {
    return { tag: 'designChange', design: rotateSketchPointsAround(design, anchor[0], anchor[1], rotateDeg, new Set(selectionIds)), hint: `Selection rotated ${rotateDeg}\u00B0.` }
  }
  return { tag: 'designChange', design: rotateSketchAround(design, anchor[0], anchor[1], rotateDeg), hint: `Sketch rotated ${rotateDeg}\u00B0.` }
}

/** Handle scale_sk tool click. */
export function handleScaleClick(
  design: DesignFileV2,
  w: [number, number],
  anchor: [number, number] | null,
  selectionIds: string[],
  scaleFactor: number
): TransformAction {
  if (!anchor) return { tag: 'setAnchor' }
  if (selectionIds.length > 0) {
    return { tag: 'designChange', design: scaleSketchPointsAround(design, anchor[0], anchor[1], scaleFactor, new Set(selectionIds)), hint: `Selection scaled \u00D7${scaleFactor}.` }
  }
  return { tag: 'designChange', design: scaleSketchAround(design, anchor[0], anchor[1], scaleFactor), hint: `Sketch scaled \u00D7${scaleFactor}.` }
}

/** Handle mirror_sk tool click. */
export function handleMirrorClick(
  design: DesignFileV2,
  w: [number, number],
  anchor: [number, number] | null,
  selectionIds: string[]
): TransformAction {
  if (!anchor) return { tag: 'setAnchor' }
  if (selectionIds.length > 0) {
    return { tag: 'designChange', design: mirrorSketchPointsAcrossLine(design, anchor[0], anchor[1], w[0], w[1], new Set(selectionIds)), hint: 'Selection mirrored across axis.' }
  }
  return { tag: 'designChange', design: mirrorSketchAcrossLine(design, anchor[0], anchor[1], w[0], w[1]), hint: 'Sketch mirrored across axis.' }
}

// ---------------------------------------------------------------------------
// Arc tools
// ---------------------------------------------------------------------------

export type ArcAction =
  | { tag: 'designChange'; design: DesignFileV2 }
  | { tag: 'advanceDraft' }
  | { tag: 'noop' }

/** Handle arc (3-point) tool click. Returns updated design or draft advance. */
export function handleArcClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][],
  arcCloseProfile: boolean
): ArcAction {
  if (draft.length < 2) return { tag: 'advanceDraft' }
  const p0 = draft[0]!
  const p1 = draft[1]!
  if (!sampleArcThroughThreePoints(p0[0], p0[1], p1[0], p1[1], w[0], w[1], 8)) return { tag: 'noop' }
  const idA = crypto.randomUUID()
  const idB = crypto.randomUUID()
  const idC = crypto.randomUUID()
  const eid = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: {
      ...design,
      points: { ...design.points, [idA]: { x: p0[0], y: p0[1] }, [idB]: { x: p1[0], y: p1[1] }, [idC]: { x: w[0], y: w[1] } },
      entities: [...design.entities, { id: eid, kind: 'arc', startId: idA, viaId: idB, endId: idC, ...(arcCloseProfile ? { closed: true as const } : {}) }]
    }
  }
}

/** Handle arc_center tool click. Returns updated design or draft advance. */
export function handleArcCenterClick(
  design: DesignFileV2,
  w: [number, number],
  draft: [number, number][],
  arcCloseProfile: boolean
): ArcAction {
  if (draft.length < 2) return { tag: 'advanceDraft' }
  const c0 = draft[0]!
  const s0 = draft[1]!
  const via = arcViaForCenterStartEnd(c0[0], c0[1], s0[0], s0[1], w[0], w[1])
  if (!via || !sampleCenterStartEndArc(c0[0], c0[1], s0[0], s0[1], w[0], w[1], 8)) return { tag: 'noop' }
  const r = Math.hypot(s0[0] - c0[0], s0[1] - c0[1])
  const vex = w[0] - c0[0]
  const vey = w[1] - c0[1]
  const vlen = Math.hypot(vex, vey)
  const px = c0[0] + (vex / vlen) * r
  const py = c0[1] + (vey / vlen) * r
  const idA = crypto.randomUUID()
  const idB = crypto.randomUUID()
  const idC = crypto.randomUUID()
  const eid = crypto.randomUUID()
  return {
    tag: 'designChange',
    design: {
      ...design,
      points: { ...design.points, [idA]: { x: s0[0], y: s0[1] }, [idB]: { x: via[0], y: via[1] }, [idC]: { x: px, y: py } },
      entities: [...design.entities, { id: eid, kind: 'arc', startId: idA, viaId: idB, endId: idC, ...(arcCloseProfile ? { closed: true as const } : {}) }]
    }
  }
}

// ---------------------------------------------------------------------------
// Constraint pick
// ---------------------------------------------------------------------------

export type ConstraintPickAction =
  | { tag: 'pointPick'; pointId: string }
  | { tag: 'segmentPick'; a: string; b: string }
  | { tag: 'entityPick'; entityId: string }
  | { tag: 'miss' }

/** Handle constraint-pick click. */
export function handleConstraintPickClick(
  design: DesignFileV2,
  rawX: number,
  rawY: number,
  scale: number,
  mode: 'vertex_segment' | 'entity',
  probeConstraintPick: (wx: number, wy: number) => { kind: 'vertex'; id: string } | { kind: 'segment'; a: string; b: string } | null,
  hasPointPick: boolean,
  hasSegmentPick: boolean
): ConstraintPickAction {
  if (mode === 'vertex_segment') {
    const hit = probeConstraintPick(rawX, rawY)
    if (hit?.kind === 'vertex' && hasPointPick) return { tag: 'pointPick', pointId: hit.id }
    if (hit?.kind === 'segment' && hasSegmentPick) return { tag: 'segmentPick', a: hit.a, b: hit.b }
    return { tag: 'miss' }
  }
  // entity mode
  const tol = Math.max(2, 10 / Math.max(scale, 0.05))
  const hit = pickNearestCircularEntityId(design, rawX, rawY, tol)
  if (hit) return { tag: 'entityPick', entityId: hit.entityId }
  return { tag: 'miss' }
}
