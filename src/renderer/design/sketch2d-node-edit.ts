/**
 * sketch2d-node-edit -- PURE node/vertex editing over the immutable
 * {@link DesignFileV2} (Sketch S2, the precision wave).
 *
 * The session-wired sketch canvas renders one square handle per "editable
 * node" of the SINGLE selected entity; dragging a handle reshapes the entity
 * through {@link moveNode}, double-clicking a polyline segment inserts a
 * vertex via {@link insertPolylineNode}, and Delete on an armed handle prunes
 * it via {@link deletePolylineNode}. Everything here is framework-free and
 * DOM-free (node-SSR testable, the repo convention): the canvas feeds world
 * mm + tolerances; this module answers with nodes and new designs. Appliers
 * NEVER mutate -- they return the SAME design reference when there is nothing
 * to do (invalid target, no-op move, integrity floor), so callers can cheaply
 * skip the apply + history push (the `translateSelectedSketchEntities`
 * convention).
 *
 * NODE MODEL -- two roles:
 *
 *  - `'point-ref'` -- the vertex IS a shared {@link SketchPoint} record
 *    (polyline `pointIds`, arc `startId`/`viaId`/`endId`, spline `pointIds`).
 *    `nodeId` is the POINT id itself. Moving it rewrites that ONE record, so
 *    every entity referencing the same point follows -- exactly the S1
 *    shared-point semantic (a shared point moves WITH the selection, applied
 *    exactly once; connected geometry drags along).
 *
 *  - `'param'` -- the vertex is SYNTHESIZED from entity params (rect / circle
 *    / slot / ellipse / legacy inline-points polylines). `nodeId` is a
 *    namespaced `param:` key and moving it RECOMPUTES the params:
 *      rect    -> `param:center` (translate cx/cy) + `param:corner:0..3`
 *                 (drag corner i; the OPPOSITE corner stays fixed; w/h/cx/cy
 *                 recompute in the rect's rotated frame; rotation unchanged)
 *      circle  -> `param:center` + `param:rim` (rim point on +X; drag sets r
 *                 from the distance to center)
 *      slot    -> `param:center` + `param:length` (cap-center on the +axis
 *                 end; new center-to-center length = 2*|axis projection|) +
 *                 `param:width` (side midpoint; new width = 2*|perp proj|)
 *      ellipse -> `param:center` + `param:rx` (major-axis tip) + `param:ry`
 *                 (minor-axis tip); a tip drag sets that radius to the
 *                 |projection| onto its axis
 *      legacy polyline (inline `points`) -> `param:v:<index>` per vertex
 *    Sizes clamp at {@link MIN_PARAM_MM} so a handle drag can never produce
 *    the zero/negative dimension the schema (`w`/`h`/`r`/`width` positive)
 *    rejects. Real point ids are uuid-generated, so the `param:` namespace
 *    cannot collide with a point-ref node id in practice.
 */

import type {
  DesignFileV2,
  SketchConstraint,
  SketchDimension,
  SketchEntity,
  SketchPoint
} from '../../shared/design-schema'
import { worldCornersFromRectParams } from '../../shared/sketch-profile'
import { distSqPointSegment } from './sketch2d-canvas-coords'

/** Node role: a shared point record vs a synthesized param handle. */
export type SketchNodeRole = 'point-ref' | 'param'

/** One draggable node of an entity (position in world sketch-plane mm). */
export interface SketchEditableNode {
  /** Point id (`point-ref`) or namespaced `param:...` key (`param`). */
  readonly nodeId: string
  readonly point: readonly [number, number]
  readonly role: SketchNodeRole
}

/**
 * Smallest param-backed dimension a handle drag can produce (mm) -- matches
 * the canvas placement thresholds (rect w/h > 0.5, circle r > 0.5).
 */
export const MIN_PARAM_MM = 0.5

/** Square-handle pick aperture in CSS px (slightly tighter than the 8 px entity pick). */
export const NODE_HANDLE_PICK_PX = 7

/** Convert the handle aperture to world mm at the current zoom (px-per-mm scale). */
export function nodeHandlePickToleranceMm(scalePxPerMm: number): number {
  return NODE_HANDLE_PICK_PX / Math.max(scalePxPerMm, 0.05)
}

const PARAM_PREFIX = 'param:'

function finitePt(p: readonly [number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1])
}

/** Point ids an entity's geometry references (mirrors the S1 history walker). */
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

/** Point ids a constraint references, walked structurally (future-kind safe). */
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

/** Point-ref nodes for a list of point ids (deduped; missing records skipped). */
function pointRefNodes(
  pointIds: readonly string[],
  points: Record<string, SketchPoint>
): SketchEditableNode[] {
  const seen = new Set<string>()
  const out: SketchEditableNode[] = []
  for (const pid of pointIds) {
    if (seen.has(pid)) continue
    seen.add(pid)
    const p = points[pid]
    if (!p) continue
    out.push({ nodeId: pid, point: [p.x, p.y], role: 'point-ref' })
  }
  return out
}

/**
 * Every draggable node of `entity`, in a stable order. Point-record-backed
 * vertices expose the SHARED point id (so the canvas can highlight the armed
 * node by id); param-backed geometry exposes synthetic `param:` handles per
 * the mapping documented in the module header.
 */
export function listEditableNodes(
  entity: SketchEntity,
  points: Record<string, SketchPoint>
): SketchEditableNode[] {
  switch (entity.kind) {
    case 'polyline': {
      if ('pointIds' in entity) return pointRefNodes(entity.pointIds, points)
      return entity.points.map(
        (p, i): SketchEditableNode => ({
          nodeId: `param:v:${i}`,
          point: [p[0], p[1]],
          role: 'param'
        })
      )
    }
    case 'arc':
      return pointRefNodes([entity.startId, entity.viaId, entity.endId], points)
    case 'spline_fit':
    case 'spline_cp':
      return pointRefNodes(entity.pointIds, points)
    case 'rect': {
      const out: SketchEditableNode[] = [
        { nodeId: 'param:center', point: [entity.cx, entity.cy], role: 'param' }
      ]
      worldCornersFromRectParams(entity).forEach((c, i) => {
        out.push({ nodeId: `param:corner:${i}`, point: [c[0], c[1]], role: 'param' })
      })
      return out
    }
    case 'circle':
      return [
        { nodeId: 'param:center', point: [entity.cx, entity.cy], role: 'param' },
        { nodeId: 'param:rim', point: [entity.cx + entity.r, entity.cy], role: 'param' }
      ]
    case 'slot': {
      const ax = Math.cos(entity.rotation)
      const ay = Math.sin(entity.rotation)
      return [
        { nodeId: 'param:center', point: [entity.cx, entity.cy], role: 'param' },
        {
          nodeId: 'param:length',
          point: [entity.cx + (ax * entity.length) / 2, entity.cy + (ay * entity.length) / 2],
          role: 'param'
        },
        {
          nodeId: 'param:width',
          point: [entity.cx - (ay * entity.width) / 2, entity.cy + (ax * entity.width) / 2],
          role: 'param'
        }
      ]
    }
    case 'ellipse': {
      const ax = Math.cos(entity.rotation)
      const ay = Math.sin(entity.rotation)
      return [
        { nodeId: 'param:center', point: [entity.cx, entity.cy], role: 'param' },
        {
          nodeId: 'param:rx',
          point: [entity.cx + ax * entity.rx, entity.cy + ay * entity.rx],
          role: 'param'
        },
        {
          nodeId: 'param:ry',
          point: [entity.cx - ay * entity.ry, entity.cy + ax * entity.ry],
          role: 'param'
        }
      ]
    }
    default: {
      const _never: never = entity
      void _never
      return []
    }
  }
}

/** Param-handle recompute for one entity; `null` = unknown handle for this kind. */
function moveParamNode(
  entity: SketchEntity,
  nodeId: string,
  x: number,
  y: number
): SketchEntity | null {
  switch (entity.kind) {
    case 'rect': {
      if (nodeId === 'param:center') {
        if (entity.cx === x && entity.cy === y) return entity
        return { ...entity, cx: x, cy: y }
      }
      const m = /^param:corner:([0-3])$/.exec(nodeId)
      if (!m) return null
      const cornerIndex = Number.parseInt(m[1]!, 10)
      const opposite = worldCornersFromRectParams(entity)[(cornerIndex + 2) % 4]!
      const cos = Math.cos(entity.rotation)
      const sin = Math.sin(entity.rotation)
      // The dragged corner in the rect's rotated frame, relative to the FIXED
      // opposite corner: local = R^T * (p - opposite).
      const dx = x - opposite[0]
      const dy = y - opposite[1]
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos
      const w = Math.max(MIN_PARAM_MM, Math.abs(lx))
      const h = Math.max(MIN_PARAM_MM, Math.abs(ly))
      const sx = lx >= 0 ? 1 : -1
      const sy = ly >= 0 ? 1 : -1
      // Effective dragged corner after the min-size clamp, back in world space;
      // the new center is the midpoint of the fixed and effective corners.
      const ex = opposite[0] + sx * w * cos - sy * h * sin
      const ey = opposite[1] + sx * w * sin + sy * h * cos
      return { ...entity, cx: (opposite[0] + ex) / 2, cy: (opposite[1] + ey) / 2, w, h }
    }
    case 'circle': {
      if (nodeId === 'param:center') {
        if (entity.cx === x && entity.cy === y) return entity
        return { ...entity, cx: x, cy: y }
      }
      if (nodeId === 'param:rim') {
        const r = Math.max(MIN_PARAM_MM, Math.hypot(x - entity.cx, y - entity.cy))
        if (r === entity.r) return entity
        return { ...entity, r }
      }
      return null
    }
    case 'slot': {
      if (nodeId === 'param:center') {
        if (entity.cx === x && entity.cy === y) return entity
        return { ...entity, cx: x, cy: y }
      }
      const ax = Math.cos(entity.rotation)
      const ay = Math.sin(entity.rotation)
      const dx = x - entity.cx
      const dy = y - entity.cy
      if (nodeId === 'param:length') {
        const length = Math.max(0, 2 * Math.abs(dx * ax + dy * ay))
        if (length === entity.length) return entity
        return { ...entity, length }
      }
      if (nodeId === 'param:width') {
        const width = Math.max(MIN_PARAM_MM, 2 * Math.abs(-dx * ay + dy * ax))
        if (width === entity.width) return entity
        return { ...entity, width }
      }
      return null
    }
    case 'ellipse': {
      if (nodeId === 'param:center') {
        if (entity.cx === x && entity.cy === y) return entity
        return { ...entity, cx: x, cy: y }
      }
      const ax = Math.cos(entity.rotation)
      const ay = Math.sin(entity.rotation)
      const dx = x - entity.cx
      const dy = y - entity.cy
      if (nodeId === 'param:rx') {
        const rx = Math.max(MIN_PARAM_MM, Math.abs(dx * ax + dy * ay))
        if (rx === entity.rx) return entity
        return { ...entity, rx }
      }
      if (nodeId === 'param:ry') {
        const ry = Math.max(MIN_PARAM_MM, Math.abs(-dx * ay + dy * ax))
        if (ry === entity.ry) return entity
        return { ...entity, ry }
      }
      return null
    }
    case 'polyline': {
      if ('pointIds' in entity) return null
      const m = /^param:v:(\d+)$/.exec(nodeId)
      if (!m) return null
      const i = Number.parseInt(m[1]!, 10)
      if (i < 0 || i >= entity.points.length) return null
      const cur = entity.points[i]!
      if (cur[0] === x && cur[1] === y) return entity
      return {
        ...entity,
        points: entity.points.map((q, idx) => (idx === i ? ([x, y] as [number, number]) : q))
      }
    }
    case 'arc':
    case 'spline_fit':
    case 'spline_cp':
      // Point-record-backed -- their nodes are point-refs, never params.
      return null
    default: {
      const _never: never = entity
      void _never
      return null
    }
  }
}

/**
 * Move one node to `newPoint` (world mm). Pure -- never mutates.
 *
 * `point-ref` nodes update the SHARED point record, so ALL entities
 * referencing that point follow (the S1 shared-point semantic). `param:`
 * nodes recompute the owning entity's params per the module-header mapping.
 * Returns the SAME design reference when there is nothing to do (unknown
 * entity/node, point not referenced by the entity, non-finite input, no-op).
 */
export function moveNode(
  design: DesignFileV2,
  entityId: string,
  nodeId: string,
  newPoint: readonly [number, number]
): DesignFileV2 {
  if (!finitePt(newPoint)) return design
  const entity = design.entities.find((e) => e.id === entityId)
  if (!entity) return design
  const [x, y] = newPoint

  if (!nodeId.startsWith(PARAM_PREFIX)) {
    if (!entityPointIds(entity).includes(nodeId)) return design
    const prev = design.points[nodeId]
    if (!prev) return design
    if (prev.x === x && prev.y === y) return design
    return { ...design, points: { ...design.points, [nodeId]: { ...prev, x, y } } }
  }

  const next = moveParamNode(entity, nodeId, x, y)
  if (next === null || next === entity) return design
  return { ...design, entities: design.entities.map((e) => (e.id === entityId ? next : e)) }
}

/** Fresh point-record id (same factory the canvas draw commits use). */
function newSketchPointId(): string {
  return crypto.randomUUID()
}

/**
 * Insert a vertex on polyline `segmentIndex` (segment i joins vertex i to
 * vertex i+1; on a closed loop the last segment wraps back to vertex 0). The
 * new vertex lands at `point` immediately AFTER vertex i.
 *
 * Point-id polylines mint a fresh point record (`newPointId` injectable for
 * deterministic tests); legacy inline-points polylines splice the coordinate
 * array. Returns the SAME design reference on any invalid input (wrong
 * entity kind, out-of-range segment, non-finite point, id collision).
 */
export function insertPolylineNode(
  design: DesignFileV2,
  entityId: string,
  segmentIndex: number,
  point: readonly [number, number],
  newPointId?: string
): DesignFileV2 {
  if (!finitePt(point) || !Number.isInteger(segmentIndex) || segmentIndex < 0) return design
  const entity = design.entities.find((e) => e.id === entityId)
  if (!entity || entity.kind !== 'polyline') return design
  const [x, y] = point

  if ('pointIds' in entity) {
    const n = entity.pointIds.length
    const segCount = entity.closed ? n : n - 1
    if (segmentIndex >= segCount) return design
    const pid = newPointId ?? newSketchPointId()
    if (design.points[pid]) return design // collision guard -- never clobber a live record
    const pointIds = [...entity.pointIds]
    pointIds.splice(segmentIndex + 1, 0, pid)
    return {
      ...design,
      points: { ...design.points, [pid]: { x, y } },
      entities: design.entities.map((e) => (e.id === entityId ? { ...entity, pointIds } : e))
    }
  }

  const n = entity.points.length
  const segCount = entity.closed ? n : n - 1
  if (segmentIndex >= segCount) return design
  const pts = [...entity.points]
  pts.splice(segmentIndex + 1, 0, [x, y])
  return {
    ...design,
    entities: design.entities.map((e) => (e.id === entityId ? { ...entity, points: pts } : e))
  }
}

/**
 * Delete a polyline vertex, holding the loop-integrity floor: a CLOSED loop
 * keeps >= 3 vertices, an open path keeps >= 2 -- below the floor the call is
 * a no-op (same reference back).
 *
 * Point-id polylines drop every occurrence of `nodeId` from the entity, then
 * prune the point RECORD only when nothing else references it -- not another
 * entity, not a constraint, not a dimension (mirrors the
 * `deleteSelectedSketchEntities` orphan rules; a point shared with an arc or
 * pinned by a `fix` constraint survives). Legacy inline-points polylines take
 * the `param:v:<index>` node id and splice the coordinate array.
 */
export function deletePolylineNode(
  design: DesignFileV2,
  entityId: string,
  nodeId: string
): DesignFileV2 {
  const entity = design.entities.find((e) => e.id === entityId)
  if (!entity || entity.kind !== 'polyline') return design

  if ('pointIds' in entity) {
    if (!entity.pointIds.includes(nodeId)) return design
    const kept = entity.pointIds.filter((pid) => pid !== nodeId)
    if (kept.length < (entity.closed ? 3 : 2)) return design
    const entities = design.entities.map((e) =>
      e.id === entityId ? { ...entity, pointIds: kept } : e
    )

    let stillReferenced = false
    for (const e of entities) {
      if (entityPointIds(e).includes(nodeId)) {
        stillReferenced = true
        break
      }
    }
    if (!stillReferenced) {
      for (const c of design.constraints) {
        if (constraintPointIds(c).includes(nodeId)) {
          stillReferenced = true
          break
        }
      }
    }
    if (!stillReferenced) {
      for (const dim of design.dimensions) {
        if (dimensionPointIds(dim).includes(nodeId)) {
          stillReferenced = true
          break
        }
      }
    }
    let points = design.points
    if (!stillReferenced && points[nodeId]) {
      points = { ...points }
      delete points[nodeId]
    }
    return { ...design, entities, points }
  }

  const m = /^param:v:(\d+)$/.exec(nodeId)
  if (!m) return design
  const i = Number.parseInt(m[1]!, 10)
  if (i < 0 || i >= entity.points.length) return design
  if (entity.points.length - 1 < (entity.closed ? 3 : 2)) return design
  const pts = entity.points.filter((_, idx) => idx !== i)
  return {
    ...design,
    entities: design.entities.map((e) => (e.id === entityId ? { ...entity, points: pts } : e))
  }
}

/**
 * Nearest polyline segment of `entity` within `toleranceMm` of `world`, or
 * `null`. Segment i joins vertex i to i+1 (closed loops wrap). Backs the
 * canvas's double-click vertex insert.
 */
export function nearestPolylineSegment(
  entity: SketchEntity,
  points: Record<string, SketchPoint>,
  world: readonly [number, number],
  toleranceMm: number
): { segmentIndex: number } | null {
  if (entity.kind !== 'polyline') return null
  if (!finitePt(world) || !Number.isFinite(toleranceMm) || toleranceMm <= 0) return null
  const verts: [number, number][] = []
  if ('pointIds' in entity) {
    for (const pid of entity.pointIds) {
      const p = points[pid]
      if (!p) return null
      verts.push([p.x, p.y])
    }
  } else {
    for (const q of entity.points) verts.push([q[0], q[1]])
  }
  const n = verts.length
  if (n < 2) return null
  const segCount = entity.closed ? n : n - 1
  const tol2 = toleranceMm * toleranceMm
  let best: { segmentIndex: number; d2: number } | null = null
  for (let i = 0; i < segCount; i++) {
    const a = verts[i]!
    const b = verts[(i + 1) % n]!
    const d2 = distSqPointSegment(world[0], world[1], a[0], a[1], b[0], b[1])
    if (d2 <= tol2 && (best === null || d2 < best.d2)) best = { segmentIndex: i, d2 }
  }
  return best === null ? null : { segmentIndex: best.segmentIndex }
}

/** Nearest editable node within `toleranceMm` of `world`, or `null` (handle pick). */
export function nearestEditableNode(
  nodes: readonly SketchEditableNode[],
  world: readonly [number, number],
  toleranceMm: number
): SketchEditableNode | null {
  if (!finitePt(world) || !Number.isFinite(toleranceMm) || toleranceMm <= 0) return null
  const tol2 = toleranceMm * toleranceMm
  let best: { node: SketchEditableNode; d2: number } | null = null
  for (const node of nodes) {
    const dx = world[0] - node.point[0]
    const dy = world[1] - node.point[1]
    const d2 = dx * dx + dy * dy
    if (d2 <= tol2 && (best === null || d2 < best.d2)) best = { node, d2 }
  }
  return best === null ? null : best.node
}
