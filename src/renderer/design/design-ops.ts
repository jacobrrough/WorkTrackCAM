import type { DesignFileV2, SketchEntity } from '../../shared/design-schema'
import { polylinePositions } from '../../shared/sketch-profile'

/** Rotate point (px,py) around pivot (cx,cy) by `rad` (radians), CCW +. */
export function rotatePoint(px: number, py: number, cx: number, cy: number, rad: number): [number, number] {
  const x = px - cx
  const y = py - cy
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [cx + x * c - y * s, cy + x * s + y * c]
}

/** Mirror all sketch data across X = 0. */
export function mirrorDesignAcrossYAxis(d: DesignFileV2): DesignFileV2 {
  const points: DesignFileV2['points'] = {}
  for (const [id, p] of Object.entries(d.points)) {
    points[id] = { x: -p.x, y: p.y, fixed: p.fixed }
  }
  const entities: SketchEntity[] = d.entities.map((e) => {
    if (e.kind === 'rect') return { ...e, cx: -e.cx }
    if (e.kind === 'circle') return { ...e, cx: -e.cx }
    if (e.kind === 'slot') return { ...e, cx: -e.cx }
    if (e.kind === 'ellipse') return { ...e, cx: -e.cx, rotation: -e.rotation }
    return e
  })
  return { ...d, points, entities }
}

/**
 * Duplicate `entities` using positions from `pointMap`, offset by `dx,dy`.
 * Returns merged points map and **new** entities only (caller appends to design).
 */
export function duplicateSketchEntitiesAtOffset(
  pointMap: DesignFileV2['points'],
  entities: SketchEntity[],
  dx: number,
  dy: number
): { points: DesignFileV2['points']; entities: SketchEntity[] } {
  const newPoints: DesignFileV2['points'] = { ...pointMap }
  const newEntities: SketchEntity[] = []

  for (const e of entities) {
    if (e.kind === 'polyline' && 'pointIds' in e && e.pointIds.length >= 2) {
      const newIds = e.pointIds.map((pid: string) => {
        const nid = crypto.randomUUID()
        const p = pointMap[pid]
        if (p) newPoints[nid] = { x: p.x + dx, y: p.y + dy, fixed: false }
        return nid
      })
      newEntities.push({
        id: crypto.randomUUID(),
        kind: 'polyline',
        pointIds: newIds,
        closed: e.closed
      })
    } else if (e.kind === 'rect') {
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: e.cx + dx,
        cy: e.cy + dy
      })
    } else if (e.kind === 'circle') {
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: e.cx + dx,
        cy: e.cy + dy
      })
    } else if (e.kind === 'slot') {
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: e.cx + dx,
        cy: e.cy + dy
      })
    } else if (e.kind === 'arc') {
      const dup = (pid: string) => {
        const nid = crypto.randomUUID()
        const p = pointMap[pid]
        if (p) newPoints[nid] = { x: p.x + dx, y: p.y + dy, fixed: false }
        return nid
      }
      newEntities.push({
        id: crypto.randomUUID(),
        kind: 'arc',
        startId: dup(e.startId),
        viaId: dup(e.viaId),
        endId: dup(e.endId),
        ...(e.closed ? { closed: true as const } : {})
      })
    } else if (e.kind === 'ellipse') {
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: e.cx + dx,
        cy: e.cy + dy
      })
    } else if (e.kind === 'spline_fit' || e.kind === 'spline_cp') {
      const newIds = e.pointIds.map((pid: string) => {
        const nid = crypto.randomUUID()
        const p = pointMap[pid]
        if (p) newPoints[nid] = { x: p.x + dx, y: p.y + dy, fixed: false }
        return nid
      })
      newEntities.push({
        id: crypto.randomUUID(),
        kind: e.kind,
        pointIds: newIds,
        ...(e.closed ? { closed: true as const } : {})
      })
    }
  }
  return { points: newPoints, entities: newEntities }
}

/**
 * Duplicate `entities` using positions from `pointMap`, rotated by `rad` (radians) around pivot.
 * Returns merged points map and **new** entities only (caller appends to design).
 */
export function duplicateSketchEntitiesAtRotation(
  pointMap: DesignFileV2['points'],
  entities: SketchEntity[],
  pivotX: number,
  pivotY: number,
  rad: number
): { points: DesignFileV2['points']; entities: SketchEntity[] } {
  const newPoints: DesignFileV2['points'] = { ...pointMap }
  const newEntities: SketchEntity[] = []

  for (const e of entities) {
    if (e.kind === 'polyline' && 'pointIds' in e && e.pointIds.length >= 2) {
      const newIds = e.pointIds.map((pid: string) => {
        const nid = crypto.randomUUID()
        const p = pointMap[pid]
        if (p) {
          const [nx, ny] = rotatePoint(p.x, p.y, pivotX, pivotY, rad)
          newPoints[nid] = { x: nx, y: ny, fixed: false }
        }
        return nid
      })
      newEntities.push({
        id: crypto.randomUUID(),
        kind: 'polyline',
        pointIds: newIds,
        closed: e.closed
      })
    } else if (e.kind === 'rect') {
      const [ncx, ncy] = rotatePoint(e.cx, e.cy, pivotX, pivotY, rad)
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: ncx,
        cy: ncy,
        rotation: e.rotation + rad
      })
    } else if (e.kind === 'circle') {
      const [ncx, ncy] = rotatePoint(e.cx, e.cy, pivotX, pivotY, rad)
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: ncx,
        cy: ncy
      })
    } else if (e.kind === 'slot') {
      const [ncx, ncy] = rotatePoint(e.cx, e.cy, pivotX, pivotY, rad)
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: ncx,
        cy: ncy,
        rotation: e.rotation + rad
      })
    } else if (e.kind === 'arc') {
      const dup = (pid: string) => {
        const nid = crypto.randomUUID()
        const p = pointMap[pid]
        if (p) {
          const [nx, ny] = rotatePoint(p.x, p.y, pivotX, pivotY, rad)
          newPoints[nid] = { x: nx, y: ny, fixed: false }
        }
        return nid
      }
      newEntities.push({
        id: crypto.randomUUID(),
        kind: 'arc',
        startId: dup(e.startId),
        viaId: dup(e.viaId),
        endId: dup(e.endId),
        ...(e.closed ? { closed: true as const } : {})
      })
    } else if (e.kind === 'ellipse') {
      const [ncx, ncy] = rotatePoint(e.cx, e.cy, pivotX, pivotY, rad)
      newEntities.push({
        ...e,
        id: crypto.randomUUID(),
        cx: ncx,
        cy: ncy,
        rotation: e.rotation + rad
      })
    } else if (e.kind === 'spline_fit' || e.kind === 'spline_cp') {
      const newIds = e.pointIds.map((pid: string) => {
        const nid = crypto.randomUUID()
        const p = pointMap[pid]
        if (p) {
          const [nx, ny] = rotatePoint(p.x, p.y, pivotX, pivotY, rad)
          newPoints[nid] = { x: nx, y: ny, fixed: false }
        }
        return nid
      })
      newEntities.push({
        id: crypto.randomUUID(),
        kind: e.kind,
        pointIds: newIds,
        ...(e.closed ? { closed: true as const } : {})
      })
    }
  }
  return { points: newPoints, entities: newEntities }
}

/** Append one offset copy of every entity (same as one step of `linearPatternSketchInstances` with totalInstances=2). */
export function linearPatternSketch(d: DesignFileV2, dx: number, dy: number): DesignFileV2 {
  const layer = duplicateSketchEntitiesAtOffset(d.points, d.entities, dx, dy)
  return { ...d, points: layer.points, entities: [...d.entities, ...layer.entities] }
}

/**
 * Linear pattern: `totalInstances` copies of the **original** sketch (including the first at identity),
 * spaced at `dx,dy` between consecutive instances (2nd at +dx,dy, 3rd at +2dx,2dy, …).
 */
export function linearPatternSketchInstances(d: DesignFileV2, dx: number, dy: number, totalInstances: number): DesignFileV2 {
  const n = Math.max(1, Math.floor(totalInstances))
  if (n <= 1) return d
  const snapshotEntities = [...d.entities]
  const snapshotPoints = d.points
  let points = { ...d.points }
  let entities = [...d.entities]
  for (let k = 1; k < n; k++) {
    const layer = duplicateSketchEntitiesAtOffset(snapshotPoints, snapshotEntities, k * dx, k * dy)
    points = { ...points, ...layer.points }
    entities = [...entities, ...layer.entities]
  }
  return { ...d, points, entities }
}

/**
 * Circular pattern: `totalInstances` copies of the **original** sketch (first at identity),
 * matching kernel `pattern_circular`: `stepDeg = totalAngleDeg / totalInstances`, copies at
 * `startAngleDeg + k * stepDeg` for k = 1 … n−1 around `(pivotX, pivotY)`.
 * `totalAngleDeg` must be in (0, 360] (same spirit as kernel); otherwise returns `d` unchanged.
 */
export function circularPatternSketchInstances(
  d: DesignFileV2,
  pivotX: number,
  pivotY: number,
  totalInstances: number,
  totalAngleDeg: number,
  startAngleDeg: number
): DesignFileV2 {
  const n = Math.max(1, Math.floor(totalInstances))
  if (n <= 1) return d
  if (!Number.isFinite(totalAngleDeg) || totalAngleDeg <= 0 || totalAngleDeg > 360.0001) return d
  const snapshotEntities = [...d.entities]
  const snapshotPoints = d.points
  const stepDeg = totalAngleDeg / n
  let points = { ...d.points }
  let entities = [...d.entities]
  for (let k = 1; k < n; k++) {
    const angleDeg = startAngleDeg + k * stepDeg
    const rad = (angleDeg * Math.PI) / 180
    const layer = duplicateSketchEntitiesAtRotation(snapshotPoints, snapshotEntities, pivotX, pivotY, rad)
    points = { ...points, ...layer.points }
    entities = [...entities, ...layer.entities]
  }
  return { ...d, points, entities }
}

function buildPolylinePathSamples(
  d: DesignFileV2,
  pathEntityId: string,
  totalInstances: number,
  closedPath: boolean
): Array<{ x: number; y: number }> | null {
  const ent = d.entities.find((e) => e.id === pathEntityId)
  if (!ent || ent.kind !== 'polyline' || !('pointIds' in ent)) return null
  const pts = polylinePositions(ent, d.points)
  if (pts.length < 2) return null
  const pathPts: [number, number][] = [...pts]
  if (closedPath && pts.length >= 3) {
    const a = pts[0]!
    const b = pts[pts.length - 1]!
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) pathPts.push([a[0], a[1]])
  }
  let total = 0
  const segCum: number[] = [0]
  for (let i = 0; i < pathPts.length - 1; i++) {
    const a = pathPts[i]!
    const b = pathPts[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len <= 1e-9) continue
    total += len
    segCum.push(total)
  }
  if (total <= 1e-9 || segCum.length < 2) return null
  const n = Math.max(1, Math.floor(totalInstances))
  const out: Array<{ x: number; y: number }> = []
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total
    let seg = 0
    while (seg + 1 < segCum.length && segCum[seg + 1]! < s) seg++
    const s0 = segCum[seg]!
    const s1 = segCum[Math.min(seg + 1, segCum.length - 1)]!
    const a = pathPts[seg]!
    const b = pathPts[Math.min(seg + 1, pathPts.length - 1)]!
    const span = Math.max(1e-9, s1 - s0)
    const t = Math.min(1, Math.max(0, (s - s0) / span))
    out.push({
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t
    })
  }
  return out
}

/**
 * Path pattern: place copies of the original sketch at evenly spaced path samples.
 * First sample is identity; remaining samples are translation-only copies.
 */
export function pathPatternSketchInstances(
  d: DesignFileV2,
  pathEntityId: string,
  totalInstances: number,
  closedPath: boolean
): DesignFileV2 {
  const samples = buildPolylinePathSamples(d, pathEntityId, totalInstances, closedPath)
  if (!samples || samples.length <= 1) return d
  const origin = samples[0]!
  const snapshotEntities = [...d.entities]
  const snapshotPoints = d.points
  let points = { ...d.points }
  let entities = [...d.entities]
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!
    const layer = duplicateSketchEntitiesAtOffset(snapshotPoints, snapshotEntities, s.x - origin.x, s.y - origin.y)
    points = { ...points, ...layer.points }
    entities = [...entities, ...layer.entities]
  }
  return { ...d, points, entities }
}

/** Drop duplicate consecutive picks and close tiny tails for projected polyline drafting. */
export function sanitizeProjectedPolylineDraft(
  raw: Array<{ x: number; y: number }>,
  epsilonMm = 1e-3
): { points: Array<{ x: number; y: number }>; closed: boolean } {
  if (raw.length === 0) return { points: [], closed: false }
  const pts: Array<{ x: number; y: number }> = []
  for (const p of raw) {
    const prev = pts[pts.length - 1]
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > epsilonMm) {
      pts.push({ x: p.x, y: p.y })
    }
  }
  if (pts.length < 2) return { points: pts, closed: false }
  const compact: Array<{ x: number; y: number }> = []
  for (const p of pts) {
    if (compact.length < 2) {
      compact.push(p)
      continue
    }
    const a = compact[compact.length - 2]!
    const b = compact[compact.length - 1]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const bcx = p.x - b.x
    const bcy = p.y - b.y
    const lab = Math.hypot(abx, aby)
    const lbc = Math.hypot(bcx, bcy)
    if (lab < epsilonMm || lbc < epsilonMm) continue
    const cross = Math.abs(abx * bcy - aby * bcx)
    const sin = cross / (lab * lbc)
    if (sin < 2e-3) {
      compact[compact.length - 1] = p
      continue
    }
    compact.push(p)
  }
  const out = compact.length >= 2 ? compact : pts
  const first = out[0]!
  const last = out[out.length - 1]!
  const closed = out.length >= 3 && Math.hypot(last.x - first.x, last.y - first.y) <= epsilonMm * 20
  if (closed) out.pop()
  return { points: out, closed }
}

/**
 * Miter offset of a closed CCW (or CW) polygon in order. Positive distance moves each edge outward
 * from the polygon interior (standard CCW positive area).
 */
export function offsetClosedPolygon(
  pts: [number, number][],
  dist: number
): [number, number][] | null {
  const n = pts.length
  if (n < 3 || !Number.isFinite(dist) || Math.abs(dist) < 1e-12) return null
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = pts[i]!
    const b = pts[j]!
    area2 += a[0] * b[1] - b[0] * a[1]
  }
  const sign = area2 >= 0 ? 1 : -1
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const i0 = (i + n - 1) % n
    const i2 = (i + 1) % n
    const p0 = pts[i0]!
    const p1 = pts[i]!
    const p2 = pts[i2]!
    let einx = p1[0] - p0[0]
    let einy = p1[1] - p0[1]
    let eoutx = p2[0] - p1[0]
    let eouty = p2[1] - p1[1]
    const lenin = Math.hypot(einx, einy)
    const lenout = Math.hypot(eoutx, eouty)
    if (lenin < 1e-12 || lenout < 1e-12) return null
    einx /= lenin
    einy /= lenin
    eoutx /= lenout
    eouty /= lenout
    const n1x = sign * einy
    const n1y = -sign * einx
    const n2x = sign * eouty
    const n2y = -sign * eoutx
    const ax = p0[0] + n1x * dist
    const ay = p0[1] + n1y * dist
    const bx = p1[0] + n2x * dist
    const by = p1[1] + n2y * dist
    const denom = einx * (-eouty) - einy * (-eoutx)
    if (Math.abs(denom) < 1e-14) return null
    const dx = bx - ax
    const dy = by - ay
    const t = (dx * (-eouty) - dy * (-eoutx)) / denom
    out.push([ax + t * einx, ay + t * einy])
  }
  return out
}

/** Offset a closed point-ID polyline by creating a new polyline entity + new point ids. */
export function offsetClosedPolylineEntity(
  d: DesignFileV2,
  entityId: string,
  distanceMm: number
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const ent = d.entities.find((e) => e.id === entityId)
  if (!ent || ent.kind !== 'polyline' || !('pointIds' in ent)) {
    return { ok: false, error: 'Entity is not a point-ID polyline.' }
  }
  if (!ent.closed) {
    return { ok: false, error: 'Polyline must be closed to offset.' }
  }
  const pts = polylinePositions(ent, d.points)
  if (pts.length < 3) return { ok: false, error: 'Need at least 3 vertices.' }
  const off = offsetClosedPolygon(pts, distanceMm)
  if (!off || off.length !== pts.length) {
    return { ok: false, error: 'Offset failed (degenerate corner or parallel edges).' }
  }
  const newIds = off.map(() => crypto.randomUUID())
  const nextPoints = { ...d.points }
  for (let i = 0; i < newIds.length; i++) {
    const q = off[i]!
    nextPoints[newIds[i]!] = { x: q[0], y: q[1] }
  }
  const newEnt: SketchEntity = {
    id: crypto.randomUUID(),
    kind: 'polyline',
    pointIds: newIds,
    closed: true
  }
  return {
    ok: true,
    design: {
      ...d,
      points: nextPoints,
      entities: [...d.entities, newEnt]
    }
  }
}

/** Translate only the given point IDs (for selection-scoped move). */
export function translateSketchPoints(d: DesignFileV2, dx: number, dy: number, ids: Set<string>): DesignFileV2 {
  const points = { ...d.points }
  for (const id of ids) {
    const p = points[id]
    if (p) points[id] = { ...p, x: p.x + dx, y: p.y + dy }
  }
  return { ...d, points }
}

/** Rotate only selected points around pivot (degrees). */
export function rotateSketchPointsAround(d: DesignFileV2, cx: number, cy: number, deg: number, ids: Set<string>): DesignFileV2 {
  const rad = (deg * Math.PI) / 180
  const points = { ...d.points }
  for (const id of ids) {
    const p = points[id]
    if (!p) continue
    const [nx, ny] = rotatePoint(p.x, p.y, cx, cy, rad)
    points[id] = { ...p, x: nx, y: ny }
  }
  return { ...d, points }
}

/** Scale only selected points about pivot. */
export function scaleSketchPointsAround(d: DesignFileV2, cx: number, cy: number, factor: number, ids: Set<string>): DesignFileV2 {
  if (!Number.isFinite(factor) || factor <= 0) return d
  const points = { ...d.points }
  for (const id of ids) {
    const p = points[id]
    if (!p) continue
    points[id] = { ...p, x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }
  }
  return { ...d, points }
}

/** Mirror only selected points across line A→B. */
export function mirrorSketchPointsAcrossLine(
  d: DesignFileV2,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ids: Set<string>
): DesignFileV2 {
  const points = { ...d.points }
  for (const id of ids) {
    const p = points[id]
    if (!p) continue
    const [nx, ny] = reflectPoint(p.x, p.y, ax, ay, bx, by)
    points[id] = { ...p, x: nx, y: ny }
  }
  return { ...d, points }
}

/** Translate all sketch points and primitive centers. */
export function translateSketch(d: DesignFileV2, dx: number, dy: number): DesignFileV2 {
  const points: DesignFileV2['points'] = {}
  for (const [id, p] of Object.entries(d.points)) {
    points[id] = { ...p, x: p.x + dx, y: p.y + dy }
  }
  const entities = d.entities.map((e) => {
    if (e.kind === 'rect' || e.kind === 'circle' || e.kind === 'slot' || e.kind === 'ellipse') {
      return { ...e, cx: e.cx + dx, cy: e.cy + dy }
    }
    return e
  })
  return { ...d, points, entities }
}

/** Rotate all sketch data around a pivot (degrees). */
export function rotateSketchAround(d: DesignFileV2, cx: number, cy: number, deg: number): DesignFileV2 {
  const rad = (deg * Math.PI) / 180
  const points: DesignFileV2['points'] = {}
  for (const [id, p] of Object.entries(d.points)) {
    const [nx, ny] = rotatePoint(p.x, p.y, cx, cy, rad)
    points[id] = { ...p, x: nx, y: ny }
  }
  const entities = d.entities.map((e) => {
    if (e.kind === 'rect' || e.kind === 'slot' || e.kind === 'ellipse') {
      const [ncx, ncy] = rotatePoint(e.cx, e.cy, cx, cy, rad)
      return { ...e, cx: ncx, cy: ncy, rotation: e.rotation + rad }
    }
    if (e.kind === 'circle') {
      const [ncx, ncy] = rotatePoint(e.cx, e.cy, cx, cy, rad)
      return { ...e, cx: ncx, cy: ncy }
    }
    return e
  })
  return { ...d, points, entities }
}

/** Uniform scale about a pivot. */
export function scaleSketchAround(d: DesignFileV2, cx: number, cy: number, factor: number): DesignFileV2 {
  if (!Number.isFinite(factor) || factor <= 0) return d
  const points: DesignFileV2['points'] = {}
  for (const [id, p] of Object.entries(d.points)) {
    points[id] = { ...p, x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }
  }
  const entities = d.entities.map((e) => {
    if (e.kind === 'circle') {
      return {
        ...e,
        cx: cx + (e.cx - cx) * factor,
        cy: cy + (e.cy - cy) * factor,
        r: e.r * factor
      }
    }
    if (e.kind === 'ellipse') {
      return {
        ...e,
        cx: cx + (e.cx - cx) * factor,
        cy: cy + (e.cy - cy) * factor,
        rx: e.rx * factor,
        ry: e.ry * factor
      }
    }
    if (e.kind === 'rect') {
      return {
        ...e,
        cx: cx + (e.cx - cx) * factor,
        cy: cy + (e.cy - cy) * factor,
        w: e.w * factor,
        h: e.h * factor
      }
    }
    if (e.kind === 'slot') {
      return {
        ...e,
        cx: cx + (e.cx - cx) * factor,
        cy: cy + (e.cy - cy) * factor,
        length: e.length * factor,
        width: e.width * factor
      }
    }
    return e
  })
  return { ...d, points, entities }
}

function reflectPoint(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const ex = bx - ax
  const ey = by - ay
  const elen = Math.hypot(ex, ey)
  if (elen < 1e-12) return [px, py]
  const nx = -ey / elen
  const ny = ex / elen
  const vx = px - ax
  const vy = py - ay
  const dist = vx * nx + vy * ny
  return [px - 2 * dist * nx, py - 2 * dist * ny]
}

/** Mirror across infinite line through A→B (points + primitive centers; rotation fields adjusted). */
export function mirrorSketchAcrossLine(d: DesignFileV2, ax: number, ay: number, bx: number, by: number): DesignFileV2 {
  const lineAngle = Math.atan2(by - ay, bx - ax)
  const points: DesignFileV2['points'] = {}
  for (const [id, p] of Object.entries(d.points)) {
    const [nx, ny] = reflectPoint(p.x, p.y, ax, ay, bx, by)
    points[id] = { ...p, x: nx, y: ny }
  }
  const entities = d.entities.map((e) => {
    if (e.kind === 'circle') {
      const [ncx, ncy] = reflectPoint(e.cx, e.cy, ax, ay, bx, by)
      return { ...e, cx: ncx, cy: ncy }
    }
    if (e.kind === 'ellipse' || e.kind === 'rect' || e.kind === 'slot') {
      const [ncx, ncy] = reflectPoint(e.cx, e.cy, ax, ay, bx, by)
      return { ...e, cx: ncx, cy: ncy, rotation: 2 * lineAngle - e.rotation }
    }
    return e
  })
  return { ...d, points, entities }
}
