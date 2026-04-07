import type { DesignFileV2, SketchConstraint, SketchEntity, SketchPlane } from './design-schema'
import type { KernelPostSolidOp } from './part-features-schema'

export type { KernelPostSolidOp }

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

/** CadQuery `postSolidOps` entries — no `suppressed` field. */
export type KernelPostSolidOpPayload = DistributiveOmit<KernelPostSolidOp, 'suppressed'>

function normalizeKernelOpForPython(op: KernelPostSolidOpPayload): KernelPostSolidOpPayload {
  if (op.kind === 'thread_cosmetic') {
    return {
      kind: 'thread_wizard',
      centerXMm: op.centerXMm,
      centerYMm: op.centerYMm,
      majorRadiusMm: op.majorRadiusMm,
      pitchMm: op.pitchMm,
      lengthMm: op.lengthMm,
      depthMm: op.depthMm,
      zStartMm: op.zStartMm,
      hand: 'right',
      mode: 'cosmetic',
      standard: 'legacy',
      designation: 'legacy',
      class: 'legacy',
      starts: 1
    }
  }
  if (op.kind === 'sweep_profile_path') {
    return {
      kind: 'sweep_profile_path_true',
      profileIndex: op.profileIndex,
      pathPoints: op.pathPoints,
      zStartMm: op.zStartMm,
      orientationMode: 'frenet'
    }
  }
  if (op.kind === 'thicken_scale') {
    return {
      kind: 'thicken_offset',
      distanceMm: op.deltaMm,
      side: op.deltaMm > 0 ? 'outward' : 'inward'
    }
  }
  return op
}

/** Queue rows with `suppressed: true` are skipped for the kernel JSON (order preserved on disk). */
export function activeKernelOpsForPython(ops: KernelPostSolidOp[] | undefined): KernelPostSolidOpPayload[] {
  if (!ops?.length) return []
  const out: KernelPostSolidOpPayload[] = []
  for (const o of ops) {
    if (o.suppressed) continue
    const { suppressed: _s, ...rest } = o
    out.push(normalizeKernelOpForPython(rest))
  }
  return out
}

const ARC_COLLINEAR_EPS = 1e-9

/** CCW angular distance from `ta` to `tb` in (0, 2π]. */
function sweepCCW(ta: number, tb: number): number {
  let d = tb - ta
  while (d <= 0) d += 2 * Math.PI
  while (d > 2 * Math.PI + 1e-12) d -= 2 * Math.PI
  return d
}

/** `tb` lies strictly between `ta` and `tc` when moving CCW. */
function angleBetweenCCW(ta: number, tb: number, tc: number): boolean {
  return sweepCCW(ta, tb) < sweepCCW(ta, tc) - 1e-7
}

/** Clockwise angular distance from `ta` to `tb` in (0, 2π]. */
function sweepCW(ta: number, tb: number): number {
  let d = ta - tb
  while (d <= 0) d += 2 * Math.PI
  while (d > 2 * Math.PI + 1e-12) d -= 2 * Math.PI
  return d
}

/**
 * Circumcircle of three non-collinear points; `null` if collinear or degenerate.
 */
export function circleThroughThreePoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): { ox: number; oy: number; r: number } | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < ARC_COLLINEAR_EPS) return null
  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  const ox = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const oy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  const r = Math.hypot(ax - ox, ay - oy)
  if (r < 1e-9) return null
  return { ox, oy, r }
}

/**
 * Circle whose diameter is the segment A—B (center = midpoint, radius = half length).
 * `null` when the two points coincide.
 */
export function circleFromDiameterEndpoints(
  ax: number,
  ay: number,
  bx: number,
  by: number
): { cx: number; cy: number; r: number } | null {
  const dx = bx - ax
  const dy = by - ay
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return null
  return { cx: (ax + bx) / 2, cy: (ay + by) / 2, r: d / 2 }
}

/**
 * Oriented rectangle: A and B define the first edge (width); C sets the perpendicular extent (height).
 * Matches v2 `rect` semantics: center, full `w`/`h`, `rotation` = angle of local +X (edge A→B).
 */
export function rectFromThreePoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): { cx: number; cy: number; w: number; h: number; rotation: number } | null {
  const abx = bx - ax
  const aby = by - ay
  const w = Math.hypot(abx, aby)
  if (w < 1e-9) return null
  const dirx = abx / w
  const diry = aby / w
  const px = -diry
  const py = dirx
  const acx = cx - ax
  const acy = cy - ay
  const hSigned = (abx * acy - aby * acx) / w
  const h = Math.abs(hSigned)
  if (h < 1e-9) return null
  const rcx = (ax + bx + px * hSigned) / 2
  const rcy = (ay + by + py * hSigned) / 2
  return { cx: rcx, cy: rcy, w, h, rotation: Math.atan2(diry, dirx) }
}

/**
 * CCW world vertices for a regular N-gon on a circle (circumradius `radius`).
 * First vertex at `startAngleRad` (+X = 0, +Y up — matches sketch `atan2` usage).
 */
export function regularPolygonVertices(
  cx: number,
  cy: number,
  radius: number,
  startAngleRad: number,
  n: number
): [number, number][] {
  const sides = Math.max(3, Math.floor(n))
  const out: [number, number][] = []
  const step = (2 * Math.PI) / sides
  for (let k = 0; k < sides; k++) {
    const t = startAngleRad + k * step
    out.push([cx + radius * Math.cos(t), cy + radius * Math.sin(t)])
  }
  return out
}

/** Perpendicular distance from P to the infinite line through A–B (mm). */
export function perpDistanceToLineThroughPoints(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const ab = Math.hypot(abx, aby)
  if (ab < 1e-12) return Math.hypot(px - ax, py - ay)
  return Math.abs(abx * (py - ay) - aby * (px - ax)) / ab
}

/**
 * Closed CCW loop (world mm) for a rounded slot: cap centers `length` mm apart on local +X from −L/2 to +L/2;
 * `width` = opening (each cap radius = width/2). `length` ≈ 0 → circle.
 */
export function slotCapsuleLoopWorld(
  cx: number,
  cy: number,
  lengthCenterToCenter: number,
  width: number,
  rotationRad: number,
  segmentsPerHalfCircle: number
): [number, number][] {
  const D = lengthCenterToCenter
  const r = width / 2
  if (r < 1e-9) return []
  const n = Math.max(4, Math.floor(segmentsPerHalfCircle))
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const toW = (lx: number, ly: number): [number, number] => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos
  ]
  const pts: [number, number][] = []

  if (D < 1e-9) {
    const m = Math.max(8, n * 2)
    for (let i = 0; i < m; i++) {
      const t = (i / m) * Math.PI * 2
      pts.push(toW(r * Math.cos(t), r * Math.sin(t)))
    }
    return pts
  }

  const hl = D / 2

  for (let i = 0; i <= n; i++) {
    const t = (-Math.PI / 2) + (Math.PI * i) / n
    pts.push(toW(hl + r * Math.cos(t), r * Math.sin(t)))
  }
  for (let i = 1; i <= n; i++) {
    const x = hl - (2 * hl * i) / n
    pts.push(toW(x, r))
  }
  for (let i = 1; i <= n; i++) {
    const t = Math.PI / 2 + (Math.PI * i) / n
    pts.push(toW(-hl + r * Math.cos(t), r * Math.sin(t)))
  }
  for (let i = 1; i <= n; i++) {
    const x = -hl + (2 * hl * i) / n
    pts.push(toW(x, -r))
  }

  if (pts.length >= 2) {
    const a = pts[0]!
    const b = pts[pts.length - 1]!
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) pts.pop()
  }
  return pts
}

/** Midpoint, center-to-center length, and axis angle for a slot from two cap-center picks. */
export function slotParamsFromCapCenters(
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  width: number
): { cx: number; cy: number; length: number; width: number; rotation: number } | null {
  if (width < 0.5 || !Number.isFinite(width)) return null
  const dx = c2x - c1x
  const dy = c2y - c1y
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return null
  return {
    cx: (c1x + c2x) / 2,
    cy: (c1y + c2y) / 2,
    length: len,
    width,
    rotation: Math.atan2(dy, dx)
  }
}

/**
 * Same `slot` storage as {@link slotParamsFromCapCenters}, but the first two picks are **overall**
 * tip-to-tip distance along the slot axis (stadium outer length). Center-to-center length = overall − width.
 */
export function slotParamsFromOverallTips(
  tip1x: number,
  tip1y: number,
  tip2x: number,
  tip2y: number,
  width: number
): { cx: number; cy: number; length: number; width: number; rotation: number } | null {
  if (width < 0.5 || !Number.isFinite(width)) return null
  const dx = tip2x - tip1x
  const dy = tip2y - tip1y
  const overall = Math.hypot(dx, dy)
  if (overall < 0.5) return null
  const length = overall - width
  if (length < -1e-6) return null
  return {
    cx: (tip1x + tip2x) / 2,
    cy: (tip1y + tip2y) / 2,
    length: Math.max(0, length),
    width,
    rotation: Math.atan2(dy, dx)
  }
}

/** World-space CCW corners for a `rect` entity (same as canvas / kernel rect loop). */
export function worldCornersFromRectParams(r: {
  cx: number
  cy: number
  w: number
  h: number
  rotation: number
}): [number, number][] {
  const hw = r.w / 2
  const hh = r.h / 2
  const cos = Math.cos(r.rotation)
  const sin = Math.sin(r.rotation)
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh]
  ].map(([x, y]) => [r.cx + x * cos - y * sin, r.cy + x * sin + y * cos] as [number, number])
}

/**
 * Sample the arc from start → via → end along the circle (the branch that passes through `via`).
 * Returns `null` if points are collinear or missing from `pointsMap`.
 */
export function sampleArcThroughThreePoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  segments: number
): [number, number][] | null {
  const circ = circleThroughThreePoints(ax, ay, bx, by, cx, cy)
  if (!circ) return null
  const { ox, oy, r } = circ
  const ta = Math.atan2(ay - oy, ax - ox)
  const tb = Math.atan2(by - oy, bx - ox)
  const tc = Math.atan2(cy - oy, cx - ox)

  let useCcw: boolean
  if (angleBetweenCCW(ta, tb, tc)) {
    useCcw = true
  } else if (angleBetweenCCW(tc, tb, ta)) {
    useCcw = false
  } else {
    useCcw = sweepCCW(ta, tc) <= Math.PI
  }

  const n = Math.max(8, Math.floor(segments))
  const out: [number, number][] = []
  if (useCcw) {
    const span = sweepCCW(ta, tc)
    for (let i = 0; i <= n; i++) {
      const t = ta + (span * i) / n
      out.push([ox + r * Math.cos(t), oy + r * Math.sin(t)])
    }
  } else {
    const span = sweepCCW(tc, ta)
    for (let i = 0; i <= n; i++) {
      const t = ta - (span * i) / n
      out.push([ox + r * Math.cos(t), oy + r * Math.sin(t)])
    }
  }
  return out
}

/**
 * For center → start → end arc (minor arc on the circle through start with given center).
 * Projects the raw end click onto the rim, picks the shorter sweep from start to that rim point,
 * and returns a via point on that arc for conversion to v2 `arc` (three point IDs).
 */
export function arcViaForCenterStartEnd(
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number
): [number, number] | null {
  const r = Math.hypot(sx - cx, sy - cy)
  if (r < 1e-9) return null
  const vex = ex - cx
  const vey = ey - cy
  const vlen = Math.hypot(vex, vey)
  if (vlen < 1e-9) return null
  const px = cx + (vex / vlen) * r
  const py = cy + (vey / vlen) * r
  const ta = Math.atan2(sy - cy, sx - cx)
  const tb = Math.atan2(py - cy, px - cx)
  const dCCW = sweepCCW(ta, tb)
  const minorSpan = Math.min(dCCW, 2 * Math.PI - dCCW)
  if (minorSpan < 1e-5) return null
  const minorCcw = dCCW <= Math.PI
  let tMid: number
  if (minorCcw) {
    tMid = ta + dCCW / 2
  } else {
    const dCW = sweepCW(ta, tb)
    tMid = ta - dCW / 2
  }
  return [cx + r * Math.cos(tMid), cy + r * Math.sin(tMid)]
}

/** Polyline samples for center–start–end minor arc (for canvas preview). */
export function sampleCenterStartEndArc(
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  segments: number
): [number, number][] | null {
  const via = arcViaForCenterStartEnd(cx, cy, sx, sy, ex, ey)
  if (!via) return null
  const vex = ex - cx
  const vey = ey - cy
  const vlen = Math.hypot(vex, vey)
  if (vlen < 1e-9) return null
  const r = Math.hypot(sx - cx, sy - cy)
  const px = cx + (vex / vlen) * r
  const py = cy + (vey / vlen) * r
  return sampleArcThroughThreePoints(sx, sy, via[0], via[1], px, py, segments)
}

export function arcSamplePositions(
  e: Extract<SketchEntity, { kind: 'arc' }>,
  points: Record<string, { x: number; y: number }>,
  segments = 24
): [number, number][] {
  const pa = points[e.startId]
  const pb = points[e.viaId]
  const pc = points[e.endId]
  if (!pa || !pb || !pc) return []
  const s = sampleArcThroughThreePoints(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y, segments)
  return s ?? []
}

/** Tessellation count for closed-arc profiles — keep in sync with `sketch-mesh` Three preview. */
export const KERNEL_PROFILE_ARC_SEGMENTS = 32

/** Tessellation segments per semicircle for `slot` kernel loops / mesh (even caps). */
export const SLOT_PROFILE_CAP_SEGMENTS = 16

/** Ordered loop vertices for a closed arc (arc samples only; chord is the closing edge). */
export function closedArcProfileLoop(
  e: Extract<SketchEntity, { kind: 'arc' }>,
  points: Record<string, { x: number; y: number }>
): [number, number][] | null {
  if (!e.closed) return null
  const loop = arcSamplePositions(e, points, KERNEL_PROFILE_ARC_SEGMENTS)
  return loop.length >= 3 ? loop : null
}

/** Polyline vertex positions in sketch plane (mm). */
export function polylinePositions(e: SketchEntity, points: Record<string, { x: number; y: number }>): [number, number][] {
  if (e.kind !== 'polyline') return []
  if ('pointIds' in e && e.pointIds && e.pointIds.length >= 2) {
    return e.pointIds.map((id) => {
      const p = points[id]
      return p ? ([p.x, p.y] as [number, number]) : ([0, 0] as [number, number])
    })
  }
  if ('points' in e && e.points && e.points.length >= 2) {
    return e.points as [number, number][]
  }
  return []
}

/**
 * Point-id segment pairs for constraint “edge” picking: polyline links + arc start→via and via→end.
 */
export function constraintPickPointIdEdges(d: DesignFileV2): { a: string; b: string }[] {
  const out: { a: string; b: string }[] = []
  for (const e of d.entities) {
    if (e.kind === 'polyline') {
      if (!('pointIds' in e) || !e.pointIds || e.pointIds.length < 2) continue
      const ids = e.pointIds
      for (let i = 0; i < ids.length - 1; i++) {
        out.push({ a: ids[i]!, b: ids[i + 1]! })
      }
      if (e.closed && ids.length >= 3) {
        out.push({ a: ids[ids.length - 1]!, b: ids[0]! })
      }
    } else if (e.kind === 'arc') {
      const { startId, viaId, endId } = e
      if (d.points[startId] && d.points[viaId]) out.push({ a: startId, b: viaId })
      if (d.points[viaId] && d.points[endId]) out.push({ a: viaId, b: endId })
    }
  }
  return out
}

export function entitiesToResolvedSketch(d: DesignFileV2): SketchEntity[] {
  return d.entities.map((e) => {
    if (e.kind !== 'polyline') return e
    const pts = polylinePositions(e, d.points)
    if (pts.length < 2) return e
    return { id: e.id, kind: 'polyline' as const, points: pts, closed: e.closed }
  })
}

/** Plain loops / circles for CadQuery kernel (no Three.js). */
export type KernelProfileV1 =
  | { type: 'loop'; points: [number, number][] }
  | { type: 'circle'; cx: number; cy: number; r: number }

/**
 * Payload written for `engines/occt/build_part.py`.
 * Phase 1: extrude + revolve. Phase 3–4: optional `postSolidOps` (version 2–3 when non-empty; v3 includes sheet_tab_union).
 * **`sketchPlane`:** matches renderer `sketchPreviewPlacementMatrix`; `build_part.py` applies it after post-ops so STEP/STL align with preview.
 */
export type KernelBuildPayload = {
  version: 1 | 2 | 3 | 4
  solidKind: 'extrude' | 'revolve' | 'loft'
  extrudeDepthMm: number
  revolve: { angleDeg: number; axisX: number }
  /**
   * Loft only: uniform +Z spacing between **consecutive** closed profiles (entity order).
   * Payload includes up to `LOFT_MAX_PROFILES` profiles; kernel chains section lofts along Z.
   */
  loftSeparationMm?: number
  profiles: KernelProfileV1[]
  /** Placement of canonical XY/+Z extrude into world mm (datum or picked face). */
  sketchPlane: SketchPlane
  postSolidOps?: KernelPostSolidOp[]
  /**
   * Optional CadQuery STL `angularTolerance` (degrees). Finer values increase mesh count for kernel STL
   * (inspect/measure) and main-body export; omitted = CadQuery default.
   */
  stlMeshAngularToleranceDeg?: number
}

/** @deprecated alias — use `KernelBuildPayload` */
export type KernelBuildPayloadV1 = KernelBuildPayload

function rectCorners(e: Extract<SketchEntity, { kind: 'rect' }>): [number, number][] {
  return worldCornersFromRectParams({
    cx: e.cx,
    cy: e.cy,
    w: e.w,
    h: e.h,
    rotation: e.rotation
  })
}

/** Tessellation count for ellipse → loop (kernel + Three preview). */
export const ELLIPSE_PROFILE_SEGMENTS = 48

export function ellipseLoopWorld(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  segments: number
): [number, number][] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const out: [number, number][] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    const wx = cx + ex * cos - ey * sin
    const wy = cy + ex * sin + ey * cos
    out.push([wx, wy])
  }
  return out
}

/** Center → major-axis endpoint → third point (minor extent) defines rx, ry, rotation. */
export function ellipseFromCenterMajorMinor(
  cx: number,
  cy: number,
  mx: number,
  my: number,
  px: number,
  py: number
): { rx: number; ry: number; rotation: number } | null {
  const dx = mx - cx
  const dy = my - cy
  const rx = Math.hypot(dx, dy)
  if (rx < 1e-9) return null
  const ux = dx / rx
  const uy = dy / rx
  const vx = -uy
  const vy = ux
  const wx = px - cx
  const wy = py - cy
  const ry = Math.abs(wx * vx + wy * vy)
  if (ry < 1e-9) return null
  return { rx, ry, rotation: Math.atan2(uy, ux) }
}

function catmullRom1d(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/** Catmull–Rom through knots (interpolating). */
export function splineFitPolyline(
  pts: [number, number][],
  closed: boolean,
  samplesPerSeg: number
): [number, number][] {
  const n = pts.length
  if (n < 2) return []
  const out: [number, number][] = []
  const get = (i: number): [number, number] => {
    if (closed) return pts[((i % n) + n) % n]!
    if (i < 0) return pts[0]!
    if (i >= n) return pts[n - 1]!
    return pts[i]!
  }
  const segCount = closed ? n : n - 1
  for (let s = 0; s < segCount; s++) {
    const p0 = get(closed ? s - 1 : s - 1)
    const p1 = get(closed ? s : s)
    const p2 = get(closed ? s + 1 : s + 1)
    const p3 = get(closed ? s + 2 : s + 2)
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg
      out.push([
        catmullRom1d(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom1d(p0[1], p1[1], p2[1], p3[1], t)
      ])
    }
  }
  if (!closed) {
    out.push(pts[n - 1]!)
  }
  return out
}

function cubicBSpline1d(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return ((1 - t) ** 3 * p0 + (3 * t3 - 6 * t2 + 4) * p1 + (-3 * t3 + 3 * t2 + 3 * t + 1) * p2 + t3 * p3) / 6
}

/** Uniform cubic B-spline (approximating control polygon). */
export function splineCpPolyline(
  pts: [number, number][],
  closed: boolean,
  samplesPerSeg: number
): [number, number][] {
  const n = pts.length
  if (n < 4) return []
  const out: [number, number][] = []
  const get = (i: number): [number, number] => {
    if (closed) return pts[((i % n) + n) % n]!
    return pts[Math.max(0, Math.min(n - 1, i))]!
  }
  const segCount = closed ? n : n - 3
  for (let s = 0; s < segCount; s++) {
    const p0 = get(closed ? s : s)
    const p1 = get(closed ? s + 1 : s + 1)
    const p2 = get(closed ? s + 2 : s + 2)
    const p3 = get(closed ? s + 3 : s + 3)
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg
      out.push([
        cubicBSpline1d(p0[0], p1[0], p2[0], p3[0], t),
        cubicBSpline1d(p0[1], p1[1], p2[1], p3[1], t)
      ])
    }
  }
  if (!closed) {
    const p0 = pts[n - 4]!
    const p1 = pts[n - 3]!
    const p2 = pts[n - 2]!
    const p3 = pts[n - 1]!
    out.push([
      cubicBSpline1d(p0[0], p1[0], p2[0], p3[0], 1),
      cubicBSpline1d(p0[1], p1[1], p2[1], p3[1], 1)
    ])
  }
  return out
}

export function splineFitPolylineFromEntity(
  e: Extract<SketchEntity, { kind: 'spline_fit' }>,
  points: Record<string, { x: number; y: number }>
): [number, number][] | null {
  const pts: [number, number][] = []
  for (const id of e.pointIds) {
    const p = points[id]
    if (!p) return null
    pts.push([p.x, p.y])
  }
  return splineFitPolyline(pts, !!e.closed, 8)
}

export function splineCpPolylineFromEntity(
  e: Extract<SketchEntity, { kind: 'spline_cp' }>,
  points: Record<string, { x: number; y: number }>
): [number, number][] | null {
  const pts: [number, number][] = []
  for (const id of e.pointIds) {
    const p = points[id]
    if (!p) return null
    pts.push([p.x, p.y])
  }
  return splineCpPolyline(pts, !!e.closed, 8)
}

/**
 * Extract closed profiles from design (same rules as Three preview: closed polyline, rect, circle,
 * `slot` (tessellated stadium), and `arc` with `closed: true` as a tessellated loop + chord).
 * Returns null if nothing to build.
 */
export function extractKernelProfiles(design: DesignFileV2): KernelProfileV1[] | null {
  const profiles: KernelProfileV1[] = []
  for (const e of design.entities) {
    if (e.kind === 'polyline') {
      const pts = polylinePositions(e, design.points)
      if (!e.closed || pts.length < 3) continue
      profiles.push({ type: 'loop', points: [...pts] })
    } else if (e.kind === 'rect') {
      profiles.push({ type: 'loop', points: rectCorners(e) })
    } else if (e.kind === 'circle') {
      profiles.push({ type: 'circle', cx: e.cx, cy: e.cy, r: e.r })
    } else if (e.kind === 'slot') {
      const loop = slotCapsuleLoopWorld(
        e.cx,
        e.cy,
        e.length,
        e.width,
        e.rotation,
        SLOT_PROFILE_CAP_SEGMENTS
      )
      if (loop.length >= 3) profiles.push({ type: 'loop', points: [...loop] })
    } else if (e.kind === 'arc') {
      const loop = closedArcProfileLoop(e, design.points)
      if (loop) profiles.push({ type: 'loop', points: [...loop] })
    } else if (e.kind === 'ellipse') {
      const loop = ellipseLoopWorld(e.cx, e.cy, e.rx, e.ry, e.rotation, ELLIPSE_PROFILE_SEGMENTS)
      if (loop.length >= 3) profiles.push({ type: 'loop', points: [...loop] })
    } else if (e.kind === 'spline_fit') {
      const loop = splineFitPolylineFromEntity(e, design.points)
      if (loop && loop.length >= 3 && e.closed) profiles.push({ type: 'loop', points: [...loop] })
    } else if (e.kind === 'spline_cp') {
      const loop = splineCpPolylineFromEntity(e, design.points)
      if (loop && loop.length >= 3 && e.closed) profiles.push({ type: 'loop', points: [...loop] })
    }
  }
  return profiles.length ? profiles : null
}

export type SketchTrimEdgeRef = { entityId: string; edgeIndex: number }

/** Circle + start/end angles for a three-point arc (same branch as `sampleArcThroughThreePoints`). */
export type ArcEntityGeometry = {
  ox: number
  oy: number
  r: number
  ta: number
  tb: number
  tc: number
  ccw: boolean
}

export function arcEntityGeometry(
  e: Extract<SketchEntity, { kind: 'arc' }>,
  points: Record<string, { x: number; y: number }>
): ArcEntityGeometry | null {
  const pa = points[e.startId]
  const pb = points[e.viaId]
  const pc = points[e.endId]
  if (!pa || !pb || !pc) return null
  const circ = circleThroughThreePoints(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y)
  if (!circ) return null
  const { ox, oy, r } = circ
  const ta = Math.atan2(pa.y - oy, pa.x - ox)
  const tb = Math.atan2(pb.y - oy, pb.x - ox)
  const tc = Math.atan2(pc.y - oy, pc.x - ox)
  let ccw: boolean
  if (angleBetweenCCW(ta, tb, tc)) {
    ccw = true
  } else if (angleBetweenCCW(tc, tb, ta)) {
    ccw = false
  } else {
    ccw = sweepCCW(ta, tc) <= Math.PI
  }
  return { ox, oy, r, ta, tb, tc, ccw }
}

function arcInteriorAngleEps(r: number): number {
  return Math.max(1e-5, 0.02 / Math.max(r, 1e-6))
}

/** Strictly between `ta` and `tc` along the arc when `ccw` is the arc’s sweep direction. */
function angleInOpenArc(t: number, ta: number, tc: number, ccw: boolean, eps: number): boolean {
  if (ccw) {
    const s = sweepCCW(ta, tc)
    if (s <= eps * 2) return false
    const st = sweepCCW(ta, t)
    return st > eps && st < s - eps
  }
  const s = sweepCCW(tc, ta)
  if (s <= eps * 2) return false
  const st = sweepCCW(tc, t)
  return st > eps && st < s - eps
}

function viaAngleOnTrimmedArc(ti: number, te: number, ccw: boolean): number {
  if (ccw) return ti + sweepCCW(ti, te) * 0.5
  return ti - sweepCCW(te, ti) * 0.5
}

function intersectInfiniteLineCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ox: number,
  oy: number,
  r: number
): { x: number; y: number }[] {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - ox
  const fy = ay - oy
  const a = dx * dx + dy * dy
  if (a < 1e-18) return []
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * a * c
  if (disc < -1e-10) return []
  const sq = disc <= 0 ? 0 : Math.sqrt(disc)
  const pts: { x: number; y: number }[] = []
  const t1 = (-b + sq) / (2 * a)
  const t2 = (-b - sq) / (2 * a)
  pts.push({ x: ax + t1 * dx, y: ay + t1 * dy })
  if (sq > 1e-8) pts.push({ x: ax + t2 * dx, y: ay + t2 * dy })
  return pts
}

function intersectSegmentCircleInterior(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ox: number,
  oy: number,
  r: number,
  tEps: number
): { x: number; y: number; tab: number }[] {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - ox
  const fy = ay - oy
  const a = dx * dx + dy * dy
  if (a < 1e-18) return []
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * a * c
  if (disc < -1e-10) return []
  const sq = disc <= 0 ? 0 : Math.sqrt(disc)
  const out: { x: number; y: number; tab: number }[] = []
  for (const sgn of [1, -1] as const) {
    const t = (-b + sgn * sq) / (2 * a)
    if (t > tEps && t < 1 - tEps) {
      out.push({ x: ax + t * dx, y: ay + t * dy, tab: t })
    }
  }
  return out
}

function intersectCirclesXY(
  ox: number,
  oy: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number
): [number, number][] {
  const dx = x1 - ox
  const dy = y1 - oy
  const d = Math.hypot(dx, dy)
  if (d < 1e-12) return []
  if (d > r0 + r1 + 1e-7) return []
  if (d < Math.abs(r0 - r1) - 1e-7) return []
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
  const h2 = r0 * r0 - a * a
  if (h2 < -1e-8) return []
  const h = h2 <= 0 ? 0 : Math.sqrt(h2)
  const xm = ox + (a * dx) / d
  const ym = oy + (a * dy) / d
  if (h < 1e-8) return [[xm, ym]]
  const rx = (-dy * h) / d
  const ry = (dx * h) / d
  return [
    [xm + rx, ym + ry],
    [xm - rx, ym - ry]
  ]
}

function distSqPointArc(wx: number, wy: number, g: ArcEntityGeometry): number {
  const { ox, oy, r, ta, tc, ccw } = g
  const vx = wx - ox
  const vy = wy - oy
  const pr = Math.hypot(vx, vy)
  const eps = arcInteriorAngleEps(r)
  if (pr < 1e-12) {
    const pa = { x: ox + r * Math.cos(ta), y: oy + r * Math.sin(ta) }
    const pb = { x: ox + r * Math.cos(tc), y: oy + r * Math.sin(tc) }
    const da = (wx - pa.x) ** 2 + (wy - pa.y) ** 2
    const db = (wx - pb.x) ** 2 + (wy - pb.y) ** 2
    return Math.min(da, db)
  }
  const t = Math.atan2(vy, vx)
  if (angleInOpenArc(t, ta, tc, ccw, eps)) {
    const dr = pr - r
    return dr * dr
  }
  const sa = { x: ox + r * Math.cos(ta), y: oy + r * Math.sin(ta) }
  const sb = { x: ox + r * Math.cos(tc), y: oy + r * Math.sin(tc) }
  const da = (wx - sa.x) ** 2 + (wy - sa.y) ** 2
  const db = (wx - sb.x) ** 2 + (wy - sb.y) ** 2
  return Math.min(da, db)
}

function pickBestByClick2d<T extends { x: number; y: number }>(candidates: T[], click: [number, number]): T | null {
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]!
  let best = candidates[0]!
  let bd = (click[0] - best.x) ** 2 + (click[1] - best.y) ** 2
  for (let i = 1; i < candidates.length; i++) {
    const p = candidates[i]!
    const d = (click[0] - p.x) ** 2 + (click[1] - p.y) ** 2
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

function polylineEdgeCount(pointIds: string[], closed: boolean): number {
  const n = pointIds.length
  if (n < 2) return 0
  return closed ? n : n - 1
}

function polylineEdgeEndpoints(
  pointIds: string[],
  closed: boolean,
  edgeIndex: number,
  points: Record<string, { x: number; y: number }>
): { ax: number; ay: number; bx: number; by: number; idA: string; idB: string } | null {
  const n = pointIds.length
  const ne = polylineEdgeCount(pointIds, closed)
  if (edgeIndex < 0 || edgeIndex >= ne) return null
  const idA = pointIds[edgeIndex]!
  const idB = closed ? pointIds[(edgeIndex + 1) % n]! : pointIds[edgeIndex + 1]!
  const pa = points[idA]
  const pb = points[idB]
  if (!pa || !pb) return null
  return { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, idA, idB }
}

/** Infinite line–line intersection; `tab` is parameter on AB (A + tab*(B−A)). */
export function intersectLines2d(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): { x: number; y: number; tab: number; tcd: number } | null {
  const r1x = bx - ax
  const r1y = by - ay
  const r2x = dx - cx
  const r2y = dy - cy
  const den = r1x * r2y - r1y * r2x
  if (Math.abs(den) < 1e-14) return null
  const qx = cx - ax
  const qy = cy - ay
  const tab = (qx * r2y - qy * r2x) / den
  const tcd = (qx * r1y - qy * r1x) / den
  return { x: ax + tab * r1x, y: ay + tab * r1y, tab, tcd }
}

function worldToEllipseLocal(px: number, py: number, cx: number, cy: number, rot: number): { lx: number; ly: number } {
  const dx = px - cx
  const dy = py - cy
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { lx: dx * c + dy * s, ly: -dx * s + dy * c }
}

function ellipseLocalPoint(theta: number, rx: number, ry: number): { lx: number; ly: number } {
  return { lx: rx * Math.cos(theta), ly: ry * Math.sin(theta) }
}

/** Signed distance (mm) from point to infinite line through A→B (sign from cross product). */
function signedDistToLine2d(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const len = Math.hypot(abx, aby)
  if (len < 1e-12) return 0
  return (abx * apy - aby * apx) / len
}

/** Intersections of infinite line (A→B) with axis-aligned ellipse x²/rx² + y²/ry² = 1 in local frame. */
function intersectLineEllipseLocal(
  lax: number,
  lay: number,
  lbx: number,
  lby: number,
  rx: number,
  ry: number
): { lx: number; ly: number; t: number }[] {
  const dx = lbx - lax
  const dy = lby - lay
  const invRx2 = 1 / (rx * rx)
  const invRy2 = 1 / (ry * ry)
  const A = dx * dx * invRx2 + dy * dy * invRy2
  const B = 2 * (lax * dx * invRx2 + lay * dy * invRy2)
  const C = lax * lax * invRx2 + lay * lay * invRy2 - 1
  if (Math.abs(A) < 1e-18) return []
  let disc = B * B - 4 * A * C
  if (disc < -1e-9) return []
  if (disc < 0) disc = 0
  const s = Math.sqrt(disc)
  const t1 = (-B - s) / (2 * A)
  const t2 = (-B + s) / (2 * A)
  const out: { lx: number; ly: number; t: number }[] = []
  const add = (t: number) => {
    const lx = lax + t * dx
    const ly = lay + t * dy
    out.push({ lx, ly, t })
  }
  if (Math.abs(t1 - t2) < 1e-7) {
    add(t1)
  } else {
    add(t1)
    add(t2)
  }
  return out
}

function ellipseParamFromLocal(lx: number, ly: number, rx: number, ry: number): number {
  return Math.atan2(ly * rx, lx * ry)
}

function trimEllipseWithLineCutter(
  design: DesignFileV2,
  cut: { ax: number; ay: number; bx: number; by: number },
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const ent = design.entities.find((e) => e.id === target.entityId)
  if (!ent || ent.kind !== 'ellipse') return { ok: false, error: 'target_not_ellipse' }
  const { cx, cy, rx, ry, rotation: rot } = ent
  const la = worldToEllipseLocal(cut.ax, cut.ay, cx, cy, rot)
  const lb = worldToEllipseLocal(cut.bx, cut.by, cx, cy, rot)
  const hits = intersectLineEllipseLocal(la.lx, la.ly, lb.lx, lb.ly, rx, ry)
  if (hits.length < 2) return { ok: false, error: 'no_two_intersections' }

  const [h0, h1] = hits
  const t1 = ellipseParamFromLocal(h0.lx, h0.ly, rx, ry)
  const t2 = ellipseParamFromLocal(h1.lx, h1.ly, rx, ry)

  const clickL = worldToEllipseLocal(clickWorld[0], clickWorld[1], cx, cy, rot)
  const sdClick = signedDistToLine2d(clickL.lx, clickL.ly, la.lx, la.ly, lb.lx, lb.ly)

  const span12 = sweepCCW(t1, t2)
  const span21 = sweepCCW(t2, t1)
  const wrapAng = (t: number) => {
    let x = t
    while (x < 0) x += 2 * Math.PI
    while (x >= 2 * Math.PI - 1e-14) x -= 2 * Math.PI
    return x
  }
  const mid12 = wrapAng(t1 + span12 * 0.5)
  const p12 = ellipseLocalPoint(mid12, rx, ry)
  const sd12 = signedDistToLine2d(p12.lx, p12.ly, la.lx, la.ly, lb.lx, lb.ly)

  const sameSign = (a: number, b: number) => a * b > 0 || (Math.abs(a) < 1e-4 && Math.abs(b) < 1e-4)

  let tStart: number
  let tSpan: number
  if (sameSign(sdClick, sd12)) {
    tStart = t2
    tSpan = span21
  } else {
    tStart = t1
    tSpan = span12
  }

  const segs = Math.max(16, Math.min(ELLIPSE_PROFILE_SEGMENTS, Math.ceil((tSpan / (2 * Math.PI)) * ELLIPSE_PROFILE_SEGMENTS)))
  const pts: [number, number][] = []
  for (let i = 0; i <= segs; i++) {
    const u = i / segs
    const theta = wrapAng(tStart + u * tSpan)
    const lp = ellipseLocalPoint(theta, rx, ry)
    const w = localToWorld(lp.lx, lp.ly, cx, cy, rot)
    pts.push([w.x, w.y])
  }

  const newIds = pts.map(() => crypto.randomUUID())
  const nextPoints = { ...design.points }
  for (let i = 0; i < pts.length; i++) {
    nextPoints[newIds[i]!] = { x: pts[i]![0], y: pts[i]![1] }
  }
  const polyEnt: SketchEntity = {
    id: ent.id,
    kind: 'polyline',
    pointIds: newIds,
    closed: false
  }
  const newEntities = design.entities.map((e) => (e.id === ent.id ? polyEnt : e))
  return { ok: true, design: { ...design, points: nextPoints, entities: newEntities } }
}

function localToWorld(lx: number, ly: number, cx: number, cy: number, rot: number): { x: number; y: number } {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }
}

/**
 * Tessellated trim: replace spline entity with a polyline, then apply polyline line trim.
 * Keeps sketch ops consistent with kernel (polyline loops).
 */
function trimSplineEntityWithLineCutter(
  design: DesignFileV2,
  cut: { ax: number; ay: number; bx: number; by: number },
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const ent = design.entities.find((e) => e.id === target.entityId)
  if (!ent || (ent.kind !== 'spline_fit' && ent.kind !== 'spline_cp')) return { ok: false, error: 'target_not_spline' }
  const ctrl = ent.pointIds.map((id) => design.points[id]).filter((p): p is { x: number; y: number } => !!p)
  const loop =
    ent.kind === 'spline_fit'
      ? splineFitPolyline(
          ctrl.map((p) => [p.x, p.y]),
          !!ent.closed,
          24
        )
      : splineCpPolyline(
          ctrl.map((p) => [p.x, p.y]),
          !!ent.closed,
          24
        )
  if (!loop || loop.length < 2) return { ok: false, error: 'degenerate_spline' }
  const cleanLoop: [number, number][] = []
  for (const p of loop) {
    const prev = cleanLoop[cleanLoop.length - 1]
    if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) > 1e-4) cleanLoop.push(p)
  }
  if (cleanLoop.length < 2) return { ok: false, error: 'degenerate_spline' }

  const newIds = cleanLoop.map(() => crypto.randomUUID())
  const nextPoints = { ...design.points }
  for (let i = 0; i < cleanLoop.length; i++) {
    nextPoints[newIds[i]!] = { x: cleanLoop[i]![0], y: cleanLoop[i]![1] }
  }
  const closed = !!ent.closed
  const polyEnt: SketchEntity = {
    id: ent.id,
    kind: 'polyline',
    pointIds: newIds,
    closed
  }
  const design2: DesignFileV2 = {
    ...design,
    points: nextPoints,
    entities: design.entities.map((e) => (e.id === ent.id ? polyEnt : e))
  }
  const ne = polylineEdgeCount(newIds, closed)
  /** Prefer an edge where the line cut hits the segment interior (tess vertices often sit on the cutter). */
  let edgeIndex = 0
  let bestScore = -1
  for (let ei = 0; ei < ne; ei++) {
    const end = polylineEdgeEndpoints(newIds, closed, ei, design2.points)
    if (!end) continue
    const hit = intersectLines2d(end.ax, end.ay, end.bx, end.by, cut.ax, cut.ay, cut.bx, cut.by)
    if (!hit) continue
    const abx = end.bx - end.ax
    const aby = end.by - end.ay
    const ab2 = abx * abx + aby * aby
    if (ab2 < 1e-18) continue
    const tab = ((hit.x - end.ax) * abx + (hit.y - end.ay) * aby) / ab2
    if (tab < -1e-6 || tab > 1 + 1e-6) continue
    const tClamped = Math.max(0, Math.min(1, tab))
    const interior = Math.min(tClamped, 1 - tClamped)
    const score = interior + 1e-9 * (1 / (1 + (hit.x - clickWorld[0]) ** 2 + (hit.y - clickWorld[1]) ** 2))
    if (score > bestScore) {
      bestScore = score
      edgeIndex = ei
    }
  }
  if (bestScore < 0) return { ok: false, error: 'no_intersection' }
  return trimPolylineWithLineCutter(design2, cut, { entityId: ent.id, edgeIndex }, clickWorld)
}

function insertVertexOnPolylineEdge(pointIds: string[], closed: boolean, edgeIndex: number, newId: string): string[] | null {
  const n = pointIds.length
  const ne = polylineEdgeCount(pointIds, closed)
  if (edgeIndex < 0 || edgeIndex >= ne) return null
  if (!closed) {
    return [...pointIds.slice(0, edgeIndex + 1), newId, ...pointIds.slice(edgeIndex + 1)]
  }
  if (edgeIndex < n - 1) {
    return [...pointIds.slice(0, edgeIndex + 1), newId, ...pointIds.slice(edgeIndex + 1)]
  }
  return [newId, ...pointIds]
}

function trimPolylineWithLineCutter(
  design: DesignFileV2,
  cut: { ax: number; ay: number; bx: number; by: number },
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const entities = design.entities
  const targetEnt = entities.find((e) => e.id === target.entityId)
  if (!targetEnt || targetEnt.kind !== 'polyline') return { ok: false, error: 'target_not_polyline' }
  if (!('pointIds' in targetEnt)) return { ok: false, error: 'legacy_polyline_points' }
  const tIds = targetEnt.pointIds
  const tClosed = targetEnt.closed
  if (polylineEdgeCount(tIds, tClosed) === 0) return { ok: false, error: 'degenerate_polyline' }

  const tgt = polylineEdgeEndpoints(tIds, tClosed, target.edgeIndex, design.points)
  if (!tgt) return { ok: false, error: 'missing_endpoints' }

  const hit = intersectLines2d(tgt.ax, tgt.ay, tgt.bx, tgt.by, cut.ax, cut.ay, cut.bx, cut.by)
  if (!hit) return { ok: false, error: 'parallel_lines' }

  const tEps = 1e-4
  if (hit.tab <= tEps || hit.tab >= 1 - tEps) return { ok: false, error: 'intersection_at_target_endpoint' }

  const abx = tgt.bx - tgt.ax
  const aby = tgt.by - tgt.ay
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return { ok: false, error: 'degenerate_target_edge' }
  let tClick = ((clickWorld[0] - tgt.ax) * abx + (clickWorld[1] - tgt.ay) * aby) / ab2
  tClick = Math.max(0, Math.min(1, tClick))
  const removeTowardA = tClick < hit.tab

  const ix = crypto.randomUUID()
  const nextPoints = {
    ...design.points,
    [ix]: { x: hit.x, y: hit.y }
  }

  const inserted = insertVertexOnPolylineEdge(tIds, tClosed, target.edgeIndex, ix)
  if (!inserted) return { ok: false, error: 'insert_failed' }

  if (!inserted.includes(ix) || !inserted.includes(tgt.idA) || !inserted.includes(tgt.idB)) {
    return { ok: false, error: 'vertex_lookup_failed' }
  }

  let newIds: string[]
  if (removeTowardA) {
    newIds = inserted.filter((id) => id !== tgt.idA)
  } else {
    newIds = inserted.filter((id) => id !== tgt.idB)
  }

  if (newIds.length < 2) return { ok: false, error: 'too_few_vertices' }

  const newEntities = entities.map((e) => {
    if (e.id !== target.entityId) return e
    return { ...e, kind: 'polyline' as const, pointIds: newIds, closed: tClosed }
  })

  return {
    ok: true,
    design: { ...design, points: nextPoints, entities: newEntities }
  }
}

function trimPolylineWithCircleCutter(
  design: DesignFileV2,
  ox: number,
  oy: number,
  r: number,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const entities = design.entities
  const targetEnt = entities.find((e) => e.id === target.entityId)
  if (!targetEnt || targetEnt.kind !== 'polyline') return { ok: false, error: 'target_not_polyline' }
  if (!('pointIds' in targetEnt)) return { ok: false, error: 'legacy_polyline_points' }
  const tIds = targetEnt.pointIds
  const tClosed = targetEnt.closed
  const tgt = polylineEdgeEndpoints(tIds, tClosed, target.edgeIndex, design.points)
  if (!tgt) return { ok: false, error: 'missing_endpoints' }

  const tEps = 1e-4
  const hits = intersectSegmentCircleInterior(tgt.ax, tgt.ay, tgt.bx, tgt.by, ox, oy, r, tEps)
  if (!hits.length) return { ok: false, error: 'no_intersection' }

  const hit = pickBestByClick2d(
    hits.map((h) => ({ x: h.x, y: h.y, tab: h.tab })),
    clickWorld
  )
  if (!hit) return { ok: false, error: 'no_intersection' }

  const abx = tgt.bx - tgt.ax
  const aby = tgt.by - tgt.ay
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return { ok: false, error: 'degenerate_target_edge' }
  let tClick = ((clickWorld[0] - tgt.ax) * abx + (clickWorld[1] - tgt.ay) * aby) / ab2
  tClick = Math.max(0, Math.min(1, tClick))
  const removeTowardA = tClick < hit.tab

  const ix = crypto.randomUUID()
  const nextPoints = {
    ...design.points,
    [ix]: { x: hit.x, y: hit.y }
  }

  const inserted = insertVertexOnPolylineEdge(tIds, tClosed, target.edgeIndex, ix)
  if (!inserted) return { ok: false, error: 'insert_failed' }
  if (!inserted.includes(ix) || !inserted.includes(tgt.idA) || !inserted.includes(tgt.idB)) {
    return { ok: false, error: 'vertex_lookup_failed' }
  }

  let newIds: string[]
  if (removeTowardA) {
    newIds = inserted.filter((id) => id !== tgt.idA)
  } else {
    newIds = inserted.filter((id) => id !== tgt.idB)
  }
  if (newIds.length < 2) return { ok: false, error: 'too_few_vertices' }

  const newEntities = entities.map((e) => {
    if (e.id !== target.entityId) return e
    return { ...e, kind: 'polyline' as const, pointIds: newIds, closed: tClosed }
  })

  return { ok: true, design: { ...design, points: nextPoints, entities: newEntities } }
}

function trimArcTarget(
  design: DesignFileV2,
  arcEnt: Extract<SketchEntity, { kind: 'arc' }>,
  g: ArcEntityGeometry,
  ix: number,
  iy: number,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const eps = arcInteriorAngleEps(g.r)
  const tI = Math.atan2(iy - g.oy, ix - g.ox)
  if (!angleInOpenArc(tI, g.ta, g.tc, g.ccw, eps)) return { ok: false, error: 'intersection_off_arc' }

  const dcx = clickWorld[0] - g.ox
  const dcy = clickWorld[1] - g.oy
  const cr = Math.hypot(dcx, dcy)
  let tClick: number
  if (cr < 1e-9) {
    const ps = design.points[arcEnt.startId]
    const pe = design.points[arcEnt.endId]
    if (!ps || !pe) return { ok: false, error: 'missing_endpoints' }
    const ds = (clickWorld[0] - ps.x) ** 2 + (clickWorld[1] - ps.y) ** 2
    const de = (clickWorld[0] - pe.x) ** 2 + (clickWorld[1] - pe.y) ** 2
    tClick = ds <= de ? g.ta : g.tc
  } else {
    tClick = Math.atan2(dcy, dcx)
  }

  const removeTowardStart = g.ccw
    ? angleInOpenArc(tClick, g.ta, tI, true, eps * 0.5)
    : angleInOpenArc(tClick, tI, g.ta, true, eps * 0.5)

  const newPtId = crypto.randomUUID()
  const viaId = crypto.randomUUID()
  let startId = arcEnt.startId
  let endId = arcEnt.endId
  let tv: number
  if (removeTowardStart) {
    startId = newPtId
    tv = viaAngleOnTrimmedArc(tI, g.tc, g.ccw)
    endId = arcEnt.endId
  } else {
    endId = newPtId
    tv = viaAngleOnTrimmedArc(g.ta, tI, g.ccw)
    startId = arcEnt.startId
  }

  const spanKeep = removeTowardStart
    ? g.ccw
      ? sweepCCW(tI, g.tc)
      : sweepCCW(g.tc, tI)
    : g.ccw
      ? sweepCCW(g.ta, tI)
      : sweepCCW(tI, g.ta)
  if (spanKeep < arcInteriorAngleEps(g.r) * 2) return { ok: false, error: 'trim_collapsed_arc' }

  const vx = g.ox + g.r * Math.cos(tv)
  const vy = g.oy + g.r * Math.sin(tv)

  const nextPoints = {
    ...design.points,
    [newPtId]: { x: ix, y: iy },
    [viaId]: { x: vx, y: vy }
  }

  const newArc: Extract<SketchEntity, { kind: 'arc' }> = {
    id: arcEnt.id,
    kind: 'arc',
    startId,
    viaId,
    endId,
    ...(arcEnt.closed ? { closed: true as const } : {})
  }

  const newEntities = design.entities.map((e) => (e.id === arcEnt.id ? newArc : e))
  return { ok: true, design: { ...design, points: nextPoints, entities: newEntities } }
}

function filterHitsOnArcInterior(
  pts: { x: number; y: number }[],
  g: ArcEntityGeometry
): { x: number; y: number }[] {
  const eps = arcInteriorAngleEps(g.r)
  return pts.filter((p) => {
    const t = Math.atan2(p.y - g.oy, p.x - g.ox)
    return angleInOpenArc(t, g.ta, g.tc, g.ccw, eps)
  })
}

function trimArcWithLineCutter(
  design: DesignFileV2,
  cut: { ax: number; ay: number; bx: number; by: number },
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const targetEnt = design.entities.find((e) => e.id === target.entityId)
  if (!targetEnt || targetEnt.kind !== 'arc') return { ok: false, error: 'target_not_arc' }
  const g = arcEntityGeometry(targetEnt, design.points)
  if (!g) return { ok: false, error: 'degenerate_arc' }

  const raw = intersectInfiniteLineCircle(cut.ax, cut.ay, cut.bx, cut.by, g.ox, g.oy, g.r)
  const onArc = filterHitsOnArcInterior(raw, g)
  if (!onArc.length) return { ok: false, error: 'no_intersection' }

  const hit = pickBestByClick2d(onArc, clickWorld)
  if (!hit) return { ok: false, error: 'no_intersection' }
  return trimArcTarget(design, targetEnt, g, hit.x, hit.y, clickWorld)
}

function trimArcWithCircleCutter(
  design: DesignFileV2,
  ox: number,
  oy: number,
  rCut: number,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const targetEnt = design.entities.find((e) => e.id === target.entityId)
  if (!targetEnt || targetEnt.kind !== 'arc') return { ok: false, error: 'target_not_arc' }
  const g = arcEntityGeometry(targetEnt, design.points)
  if (!g) return { ok: false, error: 'degenerate_arc' }

  if (Math.hypot(g.ox - ox, g.oy - oy) < 1e-8 && Math.abs(g.r - rCut) < 1e-6) {
    return { ok: false, error: 'same_circle_trim' }
  }

  const rawPts = intersectCirclesXY(g.ox, g.oy, g.r, ox, oy, rCut).map(([x, y]) => ({ x, y }))
  const onArc = filterHitsOnArcInterior(rawPts, g)
  if (!onArc.length) return { ok: false, error: 'no_intersection' }

  const hit = pickBestByClick2d(onArc, clickWorld)
  if (!hit) return { ok: false, error: 'no_intersection' }
  return trimArcTarget(design, targetEnt, g, hit.x, hit.y, clickWorld)
}

function polylineCutterLine(
  design: DesignFileV2,
  cutter: SketchTrimEdgeRef
): { ax: number; ay: number; bx: number; by: number } | null {
  const cutterEnt = design.entities.find((e) => e.id === cutter.entityId)
  if (!cutterEnt || cutterEnt.kind !== 'polyline') return null
  if (!('pointIds' in cutterEnt)) return null
  const cIds = cutterEnt.pointIds
  const cClosed = cutterEnt.closed
  return polylineEdgeEndpoints(cIds, cClosed, cutter.edgeIndex, design.points)
}

function arcCutterCircle(
  design: DesignFileV2,
  cutter: SketchTrimEdgeRef
): { ox: number; oy: number; r: number } | null {
  const cutterEnt = design.entities.find((e) => e.id === cutter.entityId)
  if (!cutterEnt || cutterEnt.kind !== 'arc') return null
  const g = arcEntityGeometry(cutterEnt, design.points)
  if (!g) return null
  return { ox: g.ox, oy: g.oy, r: g.r }
}

/**
 * Trim a sketch edge: cutter may be a **polyline edge** (infinite line) or an **arc** (full circumcircle).
 * Target may be a **polyline** edge (point IDs) or the **arc curve** (three-point arc; `edgeIndex` ignored).
 * `clickWorld` picks which side of the intersection to discard (same convention as legacy polyline trim).
 */
export function trimSketchEdge(
  design: DesignFileV2,
  cutter: SketchTrimEdgeRef,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const entities = design.entities
  const cutterEnt = entities.find((e) => e.id === cutter.entityId)
  const targetEnt = entities.find((e) => e.id === target.entityId)
  if (!cutterEnt || !targetEnt) return { ok: false, error: 'missing_entity' }

  const targetIsPoly = targetEnt.kind === 'polyline'
  const targetIsArc = targetEnt.kind === 'arc'

  if (targetIsPoly) {
    if (!('pointIds' in targetEnt)) return { ok: false, error: 'legacy_polyline_points' }
    if (cutterEnt.kind === 'polyline') {
      const cut = polylineCutterLine(design, cutter)
      if (!cut) return { ok: false, error: 'cutter_not_polyline' }
      return trimPolylineWithLineCutter(design, cut, target, clickWorld)
    }
    if (cutterEnt.kind === 'arc') {
      const circ = arcCutterCircle(design, cutter)
      if (!circ) return { ok: false, error: 'degenerate_arc_cutter' }
      return trimPolylineWithCircleCutter(design, circ.ox, circ.oy, circ.r, target, clickWorld)
    }
    return { ok: false, error: 'cutter_kind_unsupported' }
  }

  if (targetIsArc) {
    if (cutterEnt.kind === 'polyline') {
      const cut = polylineCutterLine(design, cutter)
      if (!cut) return { ok: false, error: 'cutter_not_polyline' }
      return trimArcWithLineCutter(design, cut, target, clickWorld)
    }
    if (cutterEnt.kind === 'arc') {
      const circ = arcCutterCircle(design, cutter)
      if (!circ) return { ok: false, error: 'degenerate_arc_cutter' }
      return trimArcWithCircleCutter(design, circ.ox, circ.oy, circ.r, target, clickWorld)
    }
    return { ok: false, error: 'cutter_kind_unsupported' }
  }

  if (targetEnt.kind === 'ellipse') {
    if (cutterEnt.kind === 'polyline') {
      const cut = polylineCutterLine(design, cutter)
      if (!cut) return { ok: false, error: 'cutter_not_polyline' }
      return trimEllipseWithLineCutter(design, cut, target, clickWorld)
    }
    return { ok: false, error: 'cutter_kind_unsupported' }
  }

  if (targetEnt.kind === 'spline_fit' || targetEnt.kind === 'spline_cp') {
    if (cutterEnt.kind === 'polyline') {
      const cut = polylineCutterLine(design, cutter)
      if (!cut) return { ok: false, error: 'cutter_not_polyline' }
      return trimSplineEntityWithLineCutter(design, cut, target, clickWorld)
    }
    return { ok: false, error: 'cutter_kind_unsupported' }
  }

  return { ok: false, error: 'target_kind_unsupported' }
}

/**
 * @deprecated Prefer `trimSketchEdge` — same behavior for polyline-only; extended for arcs.
 */
export function trimSketchPolylineEdge(
  design: DesignFileV2,
  cutter: SketchTrimEdgeRef,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  return trimSketchEdge(design, cutter, target, clickWorld)
}

/**
 * Split one sketch edge at click location:
 * - polyline edge: inserts a new vertex on that segment
 * - arc: splits into two arc entities sharing a new split point
 */
export function splitSketchEdge(
  design: DesignFileV2,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const ent = design.entities.find((e) => e.id === target.entityId)
  if (!ent) return { ok: false, error: 'missing_entity' }

  if (ent.kind === 'polyline') {
    if (!('pointIds' in ent)) return { ok: false, error: 'legacy_polyline_points' }
    const end = polylineEdgeEndpoints(ent.pointIds, ent.closed, target.edgeIndex, design.points)
    if (!end) return { ok: false, error: 'missing_endpoints' }
    const abx = end.bx - end.ax
    const aby = end.by - end.ay
    const ab2 = abx * abx + aby * aby
    if (ab2 < 1e-18) return { ok: false, error: 'degenerate_target_edge' }
    let t = ((clickWorld[0] - end.ax) * abx + (clickWorld[1] - end.ay) * aby) / ab2
    t = Math.max(0, Math.min(1, t))
    const tEps = 1e-4
    if (t <= tEps || t >= 1 - tEps) return { ok: false, error: 'split_at_endpoint' }
    const sx = end.ax + t * abx
    const sy = end.ay + t * aby
    const sid = crypto.randomUUID()
    const inserted = insertVertexOnPolylineEdge(ent.pointIds, ent.closed, target.edgeIndex, sid)
    if (!inserted) return { ok: false, error: 'insert_failed' }
    const nextPoints = { ...design.points, [sid]: { x: sx, y: sy } }
    const nextEntities = design.entities.map((e) =>
      e.id === ent.id ? { ...e, kind: 'polyline' as const, pointIds: inserted, closed: ent.closed } : e
    )
    return { ok: true, design: { ...design, points: nextPoints, entities: nextEntities } }
  }

  if (ent.kind === 'arc') {
    if (ent.closed) return { ok: false, error: 'closed_arc_unsupported' }
    const g = arcEntityGeometry(ent, design.points)
    if (!g) return { ok: false, error: 'degenerate_arc' }
    const vx = clickWorld[0] - g.ox
    const vy = clickWorld[1] - g.oy
    const vlen = Math.hypot(vx, vy)
    if (vlen < 1e-9) return { ok: false, error: 'click_at_center' }
    const tSplit = Math.atan2(vy, vx)
    const eps = arcInteriorAngleEps(g.r)
    if (!angleInOpenArc(tSplit, g.ta, g.tc, g.ccw, eps)) return { ok: false, error: 'split_off_arc' }

    const span1 = g.ccw ? sweepCCW(g.ta, tSplit) : sweepCCW(tSplit, g.ta)
    const span2 = g.ccw ? sweepCCW(tSplit, g.tc) : sweepCCW(g.tc, tSplit)
    if (span1 < eps * 2 || span2 < eps * 2) return { ok: false, error: 'split_collapsed_arc' }

    const splitId = crypto.randomUUID()
    const via1Id = crypto.randomUUID()
    const via2Id = crypto.randomUUID()
    const arc2Id = crypto.randomUUID()
    const splitX = g.ox + g.r * Math.cos(tSplit)
    const splitY = g.oy + g.r * Math.sin(tSplit)
    const tv1 = viaAngleOnTrimmedArc(g.ta, tSplit, g.ccw)
    const tv2 = viaAngleOnTrimmedArc(tSplit, g.tc, g.ccw)
    const nextPoints = {
      ...design.points,
      [splitId]: { x: splitX, y: splitY },
      [via1Id]: { x: g.ox + g.r * Math.cos(tv1), y: g.oy + g.r * Math.sin(tv1) },
      [via2Id]: { x: g.ox + g.r * Math.cos(tv2), y: g.oy + g.r * Math.sin(tv2) }
    }
    const arc1: Extract<SketchEntity, { kind: 'arc' }> = {
      id: ent.id,
      kind: 'arc',
      startId: ent.startId,
      viaId: via1Id,
      endId: splitId
    }
    const arc2: Extract<SketchEntity, { kind: 'arc' }> = {
      id: arc2Id,
      kind: 'arc',
      startId: splitId,
      viaId: via2Id,
      endId: ent.endId
    }
    const nextEntities = design.entities.flatMap((e) => (e.id === ent.id ? [arc1, arc2] : [e]))
    return { ok: true, design: { ...design, points: nextPoints, entities: nextEntities } }
  }

  return { ok: false, error: 'target_kind_unsupported' }
}

/**
 * Break one sketch edge at click location into two disconnected entities:
 * - open polyline edge -> two open polylines with duplicated break vertex
 * - arc -> two arc entities with duplicated break vertex
 */
export function breakSketchEdge(
  design: DesignFileV2,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const ent = design.entities.find((e) => e.id === target.entityId)
  if (!ent) return { ok: false, error: 'missing_entity' }

  if (ent.kind === 'polyline') {
    if (!('pointIds' in ent)) return { ok: false, error: 'legacy_polyline_points' }
    if (ent.closed) return { ok: false, error: 'closed_polyline_unsupported' }
    const end = polylineEdgeEndpoints(ent.pointIds, ent.closed, target.edgeIndex, design.points)
    if (!end) return { ok: false, error: 'missing_endpoints' }
    const abx = end.bx - end.ax
    const aby = end.by - end.ay
    const ab2 = abx * abx + aby * aby
    if (ab2 < 1e-18) return { ok: false, error: 'degenerate_target_edge' }
    let t = ((clickWorld[0] - end.ax) * abx + (clickWorld[1] - end.ay) * aby) / ab2
    t = Math.max(0, Math.min(1, t))
    const tEps = 1e-4
    if (t <= tEps || t >= 1 - tEps) return { ok: false, error: 'break_at_endpoint' }
    const bx = end.ax + t * abx
    const by = end.ay + t * aby
    const idL = crypto.randomUUID()
    const idR = crypto.randomUUID()
    const firstIds = [...ent.pointIds.slice(0, target.edgeIndex + 1), idL]
    const secondIds = [idR, ...ent.pointIds.slice(target.edgeIndex + 1)]
    if (firstIds.length < 2 || secondIds.length < 2) return { ok: false, error: 'too_few_vertices' }
    const nextPoints = {
      ...design.points,
      [idL]: { x: bx, y: by },
      [idR]: { x: bx, y: by }
    }
    const secondEntityId = crypto.randomUUID()
    const firstEntity: Extract<SketchEntity, { kind: 'polyline' }> = {
      id: ent.id,
      kind: 'polyline',
      pointIds: firstIds,
      closed: false
    }
    const secondEntity: Extract<SketchEntity, { kind: 'polyline' }> = {
      id: secondEntityId,
      kind: 'polyline',
      pointIds: secondIds,
      closed: false
    }
    const nextEntities = design.entities.flatMap((e) => (e.id === ent.id ? [firstEntity, secondEntity] : [e]))
    return { ok: true, design: { ...design, points: nextPoints, entities: nextEntities } }
  }

  if (ent.kind === 'arc') {
    if (ent.closed) return { ok: false, error: 'closed_arc_unsupported' }
    const g = arcEntityGeometry(ent, design.points)
    if (!g) return { ok: false, error: 'degenerate_arc' }
    const vx = clickWorld[0] - g.ox
    const vy = clickWorld[1] - g.oy
    const vlen = Math.hypot(vx, vy)
    if (vlen < 1e-9) return { ok: false, error: 'click_at_center' }
    const tBreak = Math.atan2(vy, vx)
    const eps = arcInteriorAngleEps(g.r)
    if (!angleInOpenArc(tBreak, g.ta, g.tc, g.ccw, eps)) return { ok: false, error: 'break_off_arc' }
    const span1 = g.ccw ? sweepCCW(g.ta, tBreak) : sweepCCW(tBreak, g.ta)
    const span2 = g.ccw ? sweepCCW(tBreak, g.tc) : sweepCCW(g.tc, tBreak)
    if (span1 < eps * 2 || span2 < eps * 2) return { ok: false, error: 'break_collapsed_arc' }

    const splitAId = crypto.randomUUID()
    const splitBId = crypto.randomUUID()
    const via1Id = crypto.randomUUID()
    const via2Id = crypto.randomUUID()
    const arc2Id = crypto.randomUUID()
    const px = g.ox + g.r * Math.cos(tBreak)
    const py = g.oy + g.r * Math.sin(tBreak)
    const tv1 = viaAngleOnTrimmedArc(g.ta, tBreak, g.ccw)
    const tv2 = viaAngleOnTrimmedArc(tBreak, g.tc, g.ccw)
    const nextPoints = {
      ...design.points,
      [splitAId]: { x: px, y: py },
      [splitBId]: { x: px, y: py },
      [via1Id]: { x: g.ox + g.r * Math.cos(tv1), y: g.oy + g.r * Math.sin(tv1) },
      [via2Id]: { x: g.ox + g.r * Math.cos(tv2), y: g.oy + g.r * Math.sin(tv2) }
    }
    const arc1: Extract<SketchEntity, { kind: 'arc' }> = {
      id: ent.id,
      kind: 'arc',
      startId: ent.startId,
      viaId: via1Id,
      endId: splitAId
    }
    const arc2: Extract<SketchEntity, { kind: 'arc' }> = {
      id: arc2Id,
      kind: 'arc',
      startId: splitBId,
      viaId: via2Id,
      endId: ent.endId
    }
    const nextEntities = design.entities.flatMap((e) => (e.id === ent.id ? [arc1, arc2] : [e]))
    return { ok: true, design: { ...design, points: nextPoints, entities: nextEntities } }
  }

  return { ok: false, error: 'target_kind_unsupported' }
}

function pickExtendEndpoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  clickWorld: [number, number]
): { extendA: boolean } {
  const abx = bx - ax
  const aby = by - ay
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return { extendA: true }
  let t = ((clickWorld[0] - ax) * abx + (clickWorld[1] - ay) * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  return { extendA: t < 0.5 }
}

function pickRayForwardHit(
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  candidates: Array<{ x: number; y: number }>
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestT = Number.POSITIVE_INFINITY
  const d2 = dir.x * dir.x + dir.y * dir.y
  if (d2 < 1e-18) return null
  for (const c of candidates) {
    const vx = c.x - origin.x
    const vy = c.y - origin.y
    const t = (vx * dir.x + vy * dir.y) / d2
    if (t <= 1e-6) continue
    if (t < bestT) {
      bestT = t
      best = c
    }
  }
  return best
}

/**
 * Extend an open polyline edge to a boundary edge.
 * Cutter may be polyline edge (infinite line) or arc (full circumcircle).
 */
export function extendSketchEdge(
  design: DesignFileV2,
  cutter: SketchTrimEdgeRef,
  target: SketchTrimEdgeRef,
  clickWorld: [number, number]
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const cutterEnt = design.entities.find((e) => e.id === cutter.entityId)
  const targetEnt = design.entities.find((e) => e.id === target.entityId)
  if (!cutterEnt || !targetEnt) return { ok: false, error: 'missing_entity' }
  if (targetEnt.kind !== 'polyline' || !('pointIds' in targetEnt)) return { ok: false, error: 'target_not_polyline' }
  if (targetEnt.closed) return { ok: false, error: 'target_closed_polyline_unsupported' }

  const end = polylineEdgeEndpoints(targetEnt.pointIds, false, target.edgeIndex, design.points)
  if (!end) return { ok: false, error: 'missing_endpoints' }
  const choose = pickExtendEndpoint(end.ax, end.ay, end.bx, end.by, clickWorld)
  const origin = choose.extendA ? { x: end.ax, y: end.ay } : { x: end.bx, y: end.by }
  const other = choose.extendA ? { x: end.bx, y: end.by } : { x: end.ax, y: end.ay }
  const dir = { x: origin.x - other.x, y: origin.y - other.y }

  let hit: { x: number; y: number } | null = null
  if (cutterEnt.kind === 'polyline') {
    const cut = polylineCutterLine(design, cutter)
    if (!cut) return { ok: false, error: 'cutter_not_polyline' }
    const inter = intersectLines2d(end.ax, end.ay, end.bx, end.by, cut.ax, cut.ay, cut.bx, cut.by)
    if (!inter) return { ok: false, error: 'parallel_lines' }
    hit = pickRayForwardHit(origin, dir, [{ x: inter.x, y: inter.y }])
  } else if (cutterEnt.kind === 'arc') {
    const circ = arcCutterCircle(design, cutter)
    if (!circ) return { ok: false, error: 'degenerate_arc_cutter' }
    const ints = intersectInfiniteLineCircle(end.ax, end.ay, end.bx, end.by, circ.ox, circ.oy, circ.r)
    hit = pickRayForwardHit(origin, dir, ints)
  } else {
    return { ok: false, error: 'cutter_kind_unsupported' }
  }
  if (!hit) return { ok: false, error: 'no_forward_intersection' }

  const movedId = choose.extendA ? end.idA : end.idB
  const nextPoints = { ...design.points, [movedId]: { x: hit.x, y: hit.y } }
  return { ok: true, design: { ...design, points: nextPoints } }
}

function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return apx * apx + apy * apy
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * abx
  const qy = ay + t * aby
  const dx = px - qx
  const dy = py - qy
  return dx * dx + dy * dy
}

function distSqPointEllipseBoundary(
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number
): number {
  let best = Infinity
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const px = cx + ex * cos - ey * sin
    const py = cy + ex * sin + ey * cos
    const dx = wx - px
    const dy = wy - py
    best = Math.min(best, dx * dx + dy * dy)
  }
  return best
}

function distSqPointSplineEntity(
  e: Extract<SketchEntity, { kind: 'spline_fit' } | { kind: 'spline_cp' }>,
  design: DesignFileV2,
  wx: number,
  wy: number
): number | null {
  const loop =
    e.kind === 'spline_fit' ? splineFitPolylineFromEntity(e, design.points) : splineCpPolylineFromEntity(e, design.points)
  if (!loop || loop.length < 2) return null
  let best = Infinity
  for (let i = 0; i < loop.length - 1; i++) {
    const a = loop[i]!
    const b = loop[i + 1]!
    best = Math.min(best, distSqPointSegment(wx, wy, a[0], a[1], b[0], b[1]))
  }
  if (e.closed) {
    const a = loop[loop.length - 1]!
    const b = loop[0]!
    best = Math.min(best, distSqPointSegment(wx, wy, a[0], a[1], b[0], b[1]))
  }
  return best
}

/** Hit-test polyline segments and arc curves for trim (arcs use `edgeIndex` 0). */
export function pickNearestSketchEdge(
  design: DesignFileV2,
  wx: number,
  wy: number,
  tolMm: number
): (SketchTrimEdgeRef & { d2: number }) | null {
  const tol2 = tolMm * tolMm
  let best: (SketchTrimEdgeRef & { d2: number }) | null = null
  for (const e of design.entities) {
    if (e.kind === 'polyline' && 'pointIds' in e) {
      const ids = e.pointIds
      const ne = polylineEdgeCount(ids, e.closed)
      for (let ei = 0; ei < ne; ei++) {
        const end = polylineEdgeEndpoints(ids, e.closed, ei, design.points)
        if (!end) continue
        const d2 = distSqPointSegment(wx, wy, end.ax, end.ay, end.bx, end.by)
        if (d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, edgeIndex: ei, d2 }
      }
    } else if (e.kind === 'arc') {
      const g = arcEntityGeometry(e, design.points)
      if (!g) continue
      const d2 = distSqPointArc(wx, wy, g)
      if (d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, edgeIndex: 0, d2 }
    } else if (e.kind === 'ellipse') {
      const d2 = distSqPointEllipseBoundary(wx, wy, e.cx, e.cy, e.rx, e.ry, e.rotation)
      if (d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, edgeIndex: 0, d2 }
    } else if (e.kind === 'spline_fit' || e.kind === 'spline_cp') {
      const d2 = distSqPointSplineEntity(e, design, wx, wy)
      if (d2 != null && d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, edgeIndex: 0, d2 }
    }
  }
  return best
}

/** Hit-test polyline edges (point-ID polylines only). */
export function pickNearestPolylineEdge(
  design: DesignFileV2,
  wx: number,
  wy: number,
  tolMm: number
): (SketchTrimEdgeRef & { d2: number }) | null {
  const hit = pickNearestSketchEdge(design, wx, wy, tolMm)
  if (!hit) return null
  const ent = design.entities.find((x) => x.id === hit.entityId)
  if (!ent || ent.kind !== 'polyline') return null
  return hit
}

/** Hit-test nearest circle/arc entity by curve distance (for concentric/radius/diameter picks). */
export function pickNearestCircularEntityId(
  design: DesignFileV2,
  wx: number,
  wy: number,
  tolMm: number
): { entityId: string; d2: number } | null {
  const tol2 = tolMm * tolMm
  let best: { entityId: string; d2: number } | null = null
  for (const e of design.entities) {
    if (e.kind === 'circle') {
      const dr = Math.hypot(wx - e.cx, wy - e.cy) - e.r
      const d2 = dr * dr
      if (d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, d2 }
      continue
    }
    if (e.kind === 'arc') {
      const g = arcEntityGeometry(e, design.points)
      if (!g) continue
      const d2 = distSqPointArc(wx, wy, g)
      if (d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, d2 }
    }
    if (e.kind === 'ellipse') {
      const d2 = distSqPointEllipseBoundary(wx, wy, e.cx, e.cy, e.rx, e.ry, e.rotation)
      if (d2 <= tol2 && (!best || d2 < best.d2)) best = { entityId: e.id, d2 }
    }
  }
  return best
}

function constraintReferencesPointId(c: SketchConstraint, pid: string): boolean {
  switch (c.type) {
    case 'fix':
      return c.pointId === pid
    case 'coincident':
    case 'distance':
    case 'horizontal':
    case 'vertical':
      return c.a.pointId === pid || c.b.pointId === pid
    case 'perpendicular':
    case 'parallel':
    case 'equal':
    case 'angle':
      return (
        c.a1.pointId === pid ||
        c.b1.pointId === pid ||
        c.a2.pointId === pid ||
        c.b2.pointId === pid
      )
    case 'collinear':
      return c.a.pointId === pid || c.b.pointId === pid || c.c.pointId === pid
    case 'midpoint':
      return c.m.pointId === pid || c.a.pointId === pid || c.b.pointId === pid
    default:
      return false
  }
}

function incidentEdgesAtVertex(pointIds: string[], closed: boolean, k: number): { e1: number; e2: number } | null {
  const n = pointIds.length
  if (n < 3) return null
  const ne = polylineEdgeCount(pointIds, closed)
  if (!closed) {
    if (k <= 0 || k >= n - 1) return null
    return { e1: k - 1, e2: k }
  }
  return { e1: (k - 1 + ne) % ne, e2: k }
}

function cornerIndexFromEdges(
  pointIds: string[],
  closed: boolean,
  i1: number,
  i2: number
): number | null {
  const n = pointIds.length
  for (let k = 0; k < n; k++) {
    const inc = incidentEdgesAtVertex(pointIds, closed, k)
    if (!inc) continue
    const match =
      (i1 === inc.e1 && i2 === inc.e2) || (i1 === inc.e2 && i2 === inc.e1)
    if (match) return k
  }
  return null
}

function neighborPointIdsAtCorner(pointIds: string[], closed: boolean, k: number): [string, string] | null {
  const n = pointIds.length
  if (k < 0 || k >= n) return null
  if (!closed) {
    if (k <= 0 || k >= n - 1) return null
    return [pointIds[k - 1]!, pointIds[k + 1]!]
  }
  const prev = pointIds[(k - 1 + n) % n]!
  const next = pointIds[(k + 1) % n]!
  return [prev, next]
}

function tangentDirAtArcEndpoint(g: ArcEntityGeometry, atStart: boolean): { tx: number; ty: number } {
  const t = atStart ? g.ta : g.tc
  const rx = Math.cos(t)
  const ry = Math.sin(t)
  if (g.ccw) return { tx: -ry, ty: rx }
  return { tx: ry, ty: -rx }
}

function applyArcArcFilletAtSharedEndpoint(
  design: DesignFileV2,
  a: Extract<SketchEntity, { kind: 'arc' }>,
  b: Extract<SketchEntity, { kind: 'arc' }>,
  radiusMm: number
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  const nearSame = (idA: string, idB: string): boolean => {
    if (idA === idB) return true
    const pa = design.points[idA]
    const pb = design.points[idB]
    if (!pa || !pb) return false
    return Math.hypot(pa.x - pb.x, pa.y - pb.y) <= 1e-3
  }
  const sharedCandidates = [
    nearSame(a.startId, b.startId) ? a.startId : null,
    nearSame(a.startId, b.endId) ? a.startId : null,
    nearSame(a.endId, b.startId) ? a.endId : null,
    nearSame(a.endId, b.endId) ? a.endId : null
  ].filter((x): x is string => !!x)
  const sharedId = sharedCandidates[0]
  if (!sharedId) return { ok: false, error: 'arc_arc_no_shared_endpoint' }
  if (design.constraints.some((c) => constraintReferencesPointId(c, sharedId))) {
    return { ok: false, error: 'vertex_has_constraints' }
  }
  const s = design.points[sharedId]
  if (!s) return { ok: false, error: 'missing_points' }
  const ga = arcEntityGeometry(a, design.points)
  const gb = arcEntityGeometry(b, design.points)
  if (!ga || !gb) return { ok: false, error: 'arc_geometry_failed' }
  const aAtStart = a.startId === sharedId
  const bAtStart = b.startId === sharedId
  const ta = tangentDirAtArcEndpoint(ga, aAtStart)
  const tb = tangentDirAtArcEndpoint(gb, bAtStart)
  const dA = Math.hypot(ta.tx, ta.ty)
  const dB = Math.hypot(tb.tx, tb.ty)
  if (dA < 1e-9 || dB < 1e-9) return { ok: false, error: 'degenerate_edge' }
  const uaX = ta.tx / dA
  const uaY = ta.ty / dA
  const ubX = tb.tx / dB
  const ubY = tb.ty / dB
  const dot = Math.max(-1, Math.min(1, uaX * ubX + uaY * ubY))
  let theta = Math.acos(dot)
  if (theta <= 1e-3 || theta >= Math.PI - 1e-3) theta = Math.PI * 0.5
  const half = theta * 0.5
  const tanHalf = Math.tan(half)
  const t = tanHalf < 1e-8 ? radiusMm : radiusMm / tanHalf
  const candA = { x: s.x + uaX * t, y: s.y + uaY * t }
  const candB = { x: s.x + ubX * t, y: s.y + ubY * t }
  const angA = Math.atan2(candA.y - ga.oy, candA.x - ga.ox)
  const angB = Math.atan2(candB.y - gb.oy, candB.x - gb.ox)
  const epsA = arcInteriorAngleEps(ga.r)
  const epsB = arcInteriorAngleEps(gb.r)
  const sharedAngA = aAtStart ? ga.ta : ga.tc
  const sharedAngB = bAtStart ? gb.ta : gb.tc
  const spanA = ga.ccw ? sweepCCW(ga.ta, ga.tc) : sweepCCW(ga.tc, ga.ta)
  const spanB = gb.ccw ? sweepCCW(gb.ta, gb.tc) : sweepCCW(gb.tc, gb.ta)
  const dirA = aAtStart ? (ga.ccw ? 1 : -1) : ga.ccw ? -1 : 1
  const dirB = bAtStart ? (gb.ccw ? 1 : -1) : gb.ccw ? -1 : 1
  const fallbackAngA = sharedAngA + dirA * Math.min(0.35, spanA * 0.3)
  const fallbackAngB = sharedAngB + dirB * Math.min(0.35, spanB * 0.3)
  const useAngA = angleInOpenArc(angA, ga.ta, ga.tc, ga.ccw, epsA) ? angA : fallbackAngA
  const useAngB = angleInOpenArc(angB, gb.ta, gb.tc, gb.ccw, epsB) ? angB : fallbackAngB
  if (!angleInOpenArc(useAngA, ga.ta, ga.tc, ga.ccw, epsA)) return { ok: false, error: 'fillet_tangent_off_arc_a' }
  if (!angleInOpenArc(useAngB, gb.ta, gb.tc, gb.ccw, epsB)) return { ok: false, error: 'fillet_tangent_off_arc_b' }
  const tA = { x: ga.ox + ga.r * Math.cos(useAngA), y: ga.oy + ga.r * Math.sin(useAngA) }
  const tB = { x: gb.ox + gb.r * Math.cos(useAngB), y: gb.oy + gb.r * Math.sin(useAngB) }
  const bx = uaX + ubX
  const by = uaY + ubY
  const bl = Math.hypot(bx, by)
  const wx = bl < 1e-8 ? -uaY : bx / bl
  const wy = bl < 1e-8 ? uaX : by / bl
  const sinHalf = Math.sin(half)
  const dCenter = sinHalf < 1e-8 ? radiusMm * 1.4 : radiusMm / sinHalf
  const cx = s.x + dCenter * wx
  const cy = s.y + dCenter * wy
  const taFillet = Math.atan2(tA.y - cy, tA.x - cx)
  const tbFillet = Math.atan2(tB.y - cy, tB.x - cx)
  const spanCcw = sweepCCW(taFillet, tbFillet)
  const spanCw = sweepCW(taFillet, tbFillet)
  const targetCentral = Math.PI - theta
  const useCcw = Math.abs(spanCcw - targetCentral) <= Math.abs(spanCw - targetCentral)
  const span = useCcw ? spanCcw : spanCw
  const fallbackVia = {
    x: (tA.x + tB.x) * 0.5 + (s.x - (tA.x + tB.x) * 0.5) * 0.5,
    y: (tA.y + tB.y) * 0.5 + (s.y - (tA.y + tB.y) * 0.5) * 0.5
  }
  const viaAng = useCcw ? taFillet + span * 0.5 : taFillet - span * 0.5
  const via =
    span < 1e-5
      ? fallbackVia
      : { x: cx + radiusMm * Math.cos(viaAng), y: cy + radiusMm * Math.sin(viaAng) }
  const idA = crypto.randomUUID()
  const idB = crypto.randomUUID()
  const idVia = crypto.randomUUID()
  const idFillet = crypto.randomUUID()
  const nextPoints = { ...design.points }
  delete nextPoints[sharedId]
  nextPoints[idA] = { x: tA.x, y: tA.y }
  nextPoints[idB] = { x: tB.x, y: tB.y }
  nextPoints[idVia] = { x: via.x, y: via.y }
  const newEntities = design.entities.map((e) => {
    if (e.id === a.id && e.kind === 'arc') {
      return aAtStart ? { ...e, startId: idA } : { ...e, endId: idA }
    }
    if (e.id === b.id && e.kind === 'arc') {
      return bAtStart ? { ...e, startId: idB } : { ...e, endId: idB }
    }
    return e
  })
  newEntities.push({ id: idFillet, kind: 'arc', startId: idA, viaId: idVia, endId: idB })
  return { ok: true, design: { ...design, points: nextPoints, entities: newEntities } }
}

/**
 * Round a **convex** corner of a point-ID polyline with a tangent circular arc, replacing the vertex
 * by a short chain of straight segments (keeps a single closed/open loop for `extractKernelProfiles`).
 * The two picked edges must be consecutive on the same polyline and meet at an interior vertex
 * (open chain: not endpoints).
 */
export function applySketchCornerFillet(
  design: DesignFileV2,
  edge1: SketchTrimEdgeRef,
  edge2: SketchTrimEdgeRef,
  radiusMm: number,
  opts?: { arcSegments?: number }
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  if (!(radiusMm > 0)) return { ok: false, error: 'radius_invalid' }
  const arcSegments = Math.max(1, Math.min(64, Math.floor(opts?.arcSegments ?? 8)))

  if (edge1.entityId !== edge2.entityId) {
    const e1 = design.entities.find((e) => e.id === edge1.entityId)
    const e2 = design.entities.find((e) => e.id === edge2.entityId)
    if (e1?.kind === 'arc' && e2?.kind === 'arc') {
      return applyArcArcFilletAtSharedEndpoint(design, e1, e2, radiusMm)
    }
    return { ok: false, error: 'different_entities' }
  }
  const ent = design.entities.find((e) => e.id === edge1.entityId)
  if (!ent || ent.kind !== 'polyline') return { ok: false, error: 'not_polyline' }
  if (!('pointIds' in ent)) return { ok: false, error: 'legacy_polyline_points' }

  const pointIds = ent.pointIds
  const closed = ent.closed
  const k = cornerIndexFromEdges(pointIds, closed, edge1.edgeIndex, edge2.edgeIndex)
  if (k == null) return { ok: false, error: 'edges_not_consecutive' }

  const vId = pointIds[k]!
  if (design.constraints.some((c) => constraintReferencesPointId(c, vId))) {
    return { ok: false, error: 'vertex_has_constraints' }
  }

  const nb = neighborPointIdsAtCorner(pointIds, closed, k)
  if (!nb) return { ok: false, error: 'corner_not_interior' }
  const [prevId, nextId] = nb

  const pv = design.points[vId]
  const pPrev = design.points[prevId]
  const pNext = design.points[nextId]
  if (!pv || !pPrev || !pNext) return { ok: false, error: 'missing_points' }

  const ux = pPrev.x - pv.x
  const uy = pPrev.y - pv.y
  const vx = pNext.x - pv.x
  const vy = pNext.y - pv.y
  const lu = Math.hypot(ux, uy)
  const lv = Math.hypot(vx, vy)
  if (lu < 1e-9 || lv < 1e-9) return { ok: false, error: 'degenerate_edge' }

  const uaX = ux / lu
  const uaY = uy / lu
  const ubX = vx / lv
  const ubY = vy / lv

  const dot = uaX * ubX + uaY * ubY
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)))
  const thetaMin = 1e-3
  const thetaMax = Math.PI - 1e-3
  if (theta <= thetaMin || theta >= thetaMax) return { ok: false, error: 'angle_out_of_range' }

  const half = theta * 0.5
  const tanHalf = Math.tan(half)
  if (tanHalf < 1e-8) return { ok: false, error: 'tan_half_degenerate' }

  const t = radiusMm / tanHalf
  const edgeTol = 1e-3
  if (t >= lu - edgeTol || t >= lv - edgeTol) return { ok: false, error: 'radius_too_large_for_edges' }

  const bx = uaX + ubX
  const by = uaY + ubY
  const bl = Math.hypot(bx, by)
  if (bl < 1e-8) return { ok: false, error: 'opposite_rays' }

  const wx = bx / bl
  const wy = by / bl
  const sinHalf = Math.sin(half)
  if (sinHalf < 1e-8) return { ok: false, error: 'sin_half_degenerate' }

  const dCenter = radiusMm / sinHalf
  const cx = pv.x + dCenter * wx
  const cy = pv.y + dCenter * wy

  const t1x = pv.x + t * uaX
  const t1y = pv.y + t * uaY
  const t2x = pv.x + t * ubX
  const t2y = pv.y + t * ubY

  const ta = Math.atan2(t1y - cy, t1x - cx)
  const tb = Math.atan2(t2y - cy, t2x - cx)
  const targetCentral = Math.PI - theta
  const spanCcw = sweepCCW(ta, tb)
  const spanCw = sweepCW(ta, tb)
  const useCcw = Math.abs(spanCcw - targetCentral) <= Math.abs(spanCw - targetCentral)
  const span = useCcw ? spanCcw : spanCw

  const arcPts: [number, number][] = []
  for (let i = 0; i <= arcSegments; i++) {
    const ang = useCcw ? ta + (span * i) / arcSegments : ta - (span * i) / arcSegments
    arcPts.push([cx + radiusMm * Math.cos(ang), cy + radiusMm * Math.sin(ang)])
  }

  const newPointEntries = arcPts.map(([x, y]) => ({ id: crypto.randomUUID(), x, y }))
  const insertedIds = newPointEntries.map((p) => p.id)

  const nextPointIds = [...pointIds.slice(0, k), ...insertedIds, ...pointIds.slice(k + 1)]

  const nextPoints = { ...design.points }
  delete nextPoints[vId]
  for (const p of newPointEntries) {
    nextPoints[p.id] = { x: p.x, y: p.y }
  }

  const newEntities = design.entities.map((e) => {
    if (e.id !== ent.id) return e
    return { ...e, kind: 'polyline' as const, pointIds: nextPointIds, closed }
  })

  return {
    ok: true,
    design: { ...design, points: nextPoints, entities: newEntities }
  }
}

/**
 * Chamfer a **convex** corner of a point-ID polyline with a single straight cut, replacing the vertex
 * by two new points `L` mm along each incident edge from the corner (same eligibility as fillet).
 */
export function applySketchCornerChamfer(
  design: DesignFileV2,
  edge1: SketchTrimEdgeRef,
  edge2: SketchTrimEdgeRef,
  lengthMm: number
): { ok: true; design: DesignFileV2 } | { ok: false; error: string } {
  if (!(lengthMm > 0)) return { ok: false, error: 'length_invalid' }

  if (edge1.entityId !== edge2.entityId) return { ok: false, error: 'different_entities' }
  const ent = design.entities.find((e) => e.id === edge1.entityId)
  if (!ent || ent.kind !== 'polyline') return { ok: false, error: 'not_polyline' }
  if (!('pointIds' in ent)) return { ok: false, error: 'legacy_polyline_points' }

  const pointIds = ent.pointIds
  const closed = ent.closed
  const k = cornerIndexFromEdges(pointIds, closed, edge1.edgeIndex, edge2.edgeIndex)
  if (k == null) return { ok: false, error: 'edges_not_consecutive' }

  const vId = pointIds[k]!
  if (design.constraints.some((c) => constraintReferencesPointId(c, vId))) {
    return { ok: false, error: 'vertex_has_constraints' }
  }

  const nb = neighborPointIdsAtCorner(pointIds, closed, k)
  if (!nb) return { ok: false, error: 'corner_not_interior' }
  const [prevId, nextId] = nb

  const pv = design.points[vId]
  const pPrev = design.points[prevId]
  const pNext = design.points[nextId]
  if (!pv || !pPrev || !pNext) return { ok: false, error: 'missing_points' }

  const ux = pPrev.x - pv.x
  const uy = pPrev.y - pv.y
  const vx = pNext.x - pv.x
  const vy = pNext.y - pv.y
  const lu = Math.hypot(ux, uy)
  const lv = Math.hypot(vx, vy)
  if (lu < 1e-9 || lv < 1e-9) return { ok: false, error: 'degenerate_edge' }

  const uaX = ux / lu
  const uaY = uy / lu
  const ubX = vx / lv
  const ubY = vy / lv

  const dot = uaX * ubX + uaY * ubY
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)))
  const thetaMin = 1e-3
  const thetaMax = Math.PI - 1e-3
  if (theta <= thetaMin || theta >= thetaMax) return { ok: false, error: 'angle_out_of_range' }

  const edgeTol = 1e-3
  if (lengthMm >= lu - edgeTol || lengthMm >= lv - edgeTol) {
    return { ok: false, error: 'length_too_large_for_edges' }
  }

  const id1 = crypto.randomUUID()
  const id2 = crypto.randomUUID()
  const p1 = { x: pv.x + lengthMm * uaX, y: pv.y + lengthMm * uaY }
  const p2 = { x: pv.x + lengthMm * ubX, y: pv.y + lengthMm * ubY }

  const nextPointIds = [...pointIds.slice(0, k), id1, id2, ...pointIds.slice(k + 1)]
  const nextPoints = { ...design.points }
  delete nextPoints[vId]
  nextPoints[id1] = p1
  nextPoints[id2] = p2

  const newEntities = design.entities.map((e) => {
    if (e.id !== ent.id) return e
    return { ...e, kind: 'polyline' as const, pointIds: nextPointIds, closed }
  })

  return {
    ok: true,
    design: { ...design, points: nextPoints, entities: newEntities }
  }
}

export type KernelPayloadResult = { ok: true; payload: KernelBuildPayload } | { ok: false; error: string }

/** Payload version after attaching post ops (keeps v1 when no ops). */
export function kernelPayloadVersionForOps(
  baseVersion: KernelBuildPayload['version'],
  ops: KernelPostSolidOp[] | undefined
): KernelBuildPayload['version'] {
  if (!ops?.length) return baseVersion
  const needsV3 = ops.some(
    (o) =>
      o.kind === 'pattern_rectangular' ||
      o.kind === 'pattern_circular' ||
      o.kind === 'pattern_linear_3d' ||
      o.kind === 'pattern_path' ||
      o.kind === 'boolean_subtract_cylinder' ||
      o.kind === 'boolean_union_box' ||
      o.kind === 'boolean_subtract_box' ||
      o.kind === 'boolean_intersect_box' ||
      o.kind === 'boolean_combine_profile' ||
      o.kind === 'split_keep_halfspace' ||
      o.kind === 'hole_from_profile' ||
      o.kind === 'thread_cosmetic' ||
      o.kind === 'transform_translate' ||
      o.kind === 'press_pull_profile' ||
      o.kind === 'sweep_profile_path' ||
      o.kind === 'pipe_path' ||
      o.kind === 'thicken_scale' ||
      o.kind === 'coil_cut' ||
      o.kind === 'mirror_union_plane' ||
      o.kind === 'sheet_tab_union' ||
      o.kind === 'sheet_fold' ||
      o.kind === 'sheet_flat_pattern' ||
      o.kind === 'loft_guide_rails' ||
      o.kind === 'plastic_rule_fillet' ||
      o.kind === 'plastic_boss' ||
      o.kind === 'plastic_lip_groove' ||
      (o.kind === 'shell_inward' && o.openDirection != null)
  )
  const needsV4 = ops.some(
    (o) => o.kind === 'sweep_profile_path_true' || o.kind === 'thicken_offset' || o.kind === 'thread_wizard'
  )
  if (needsV4) return 4
  return needsV3 ? 3 : 2
}

/** Max closed profiles sent for `solidKind: loft` (kernel + preview). */
export const LOFT_MAX_PROFILES = 16

/** Merge kernel ops from `part/features.json` for CadQuery regeneration. */
export function attachKernelPostOpsToPayload(
  payload: KernelBuildPayload,
  ops: KernelPostSolidOp[] | undefined
): KernelBuildPayload {
  const active = activeKernelOpsForPython(ops)
  if (active.length === 0) return payload
  const version = kernelPayloadVersionForOps(payload.version, active as KernelPostSolidOp[])
  return { ...payload, version, postSolidOps: active as KernelPostSolidOp[] }
}

/** Build JSON payload for the OCCT/CadQuery sidecar. */
export function buildKernelBuildPayload(design: DesignFileV2): KernelPayloadResult {
  const profiles = extractKernelProfiles(design)
  if (!profiles) {
    return { ok: false, error: 'no_closed_profile' }
  }
  const depth = design.extrudeDepthMm
  if (!Number.isFinite(depth) || depth <= 0) {
    return { ok: false, error: 'invalid_extrude_depth_mm' }
  }
  const loftSep = design.loftSeparationMm
  if (!Number.isFinite(loftSep) || loftSep <= 0) {
    return { ok: false, error: 'invalid_loft_separation_mm' }
  }
  const { angleDeg, axisX } = design.revolve
  if (!Number.isFinite(angleDeg) || angleDeg <= 0 || !Number.isFinite(axisX)) {
    return { ok: false, error: 'invalid_revolve_params' }
  }
  const sketchPlane = design.sketchPlane
  if (design.solidKind === 'revolve' && profiles.some((p) => p.type === 'circle')) {
    return { ok: false, error: 'circle_revolve_use_polyline_approximation' }
  }
  if (design.solidKind === 'loft') {
    if (profiles.length < 2) {
      return { ok: false, error: 'loft_requires_two_profiles' }
    }
    if (profiles.length > LOFT_MAX_PROFILES) {
      return { ok: false, error: 'loft_too_many_profiles' }
    }
    return {
      ok: true,
      payload: {
        version: 1,
        solidKind: 'loft',
        extrudeDepthMm: design.extrudeDepthMm,
        revolve: design.revolve,
        loftSeparationMm: design.loftSeparationMm,
        profiles,
        sketchPlane
      }
    }
  }
  if (design.solidKind === 'extrude') {
    return {
      ok: true,
      payload: {
        version: 1,
        solidKind: 'extrude',
        extrudeDepthMm: design.extrudeDepthMm,
        revolve: design.revolve,
        profiles,
        sketchPlane
      }
    }
  }
  return {
    ok: true,
    payload: {
      version: 1,
      solidKind: 'revolve',
      extrudeDepthMm: design.extrudeDepthMm,
      revolve: { angleDeg: design.revolve.angleDeg, axisX: design.revolve.axisX },
      profiles,
      sketchPlane
    }
  }
}
