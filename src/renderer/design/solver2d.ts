import type { DesignFileV2, SketchConstraint, SketchPoint } from '../../shared/design-schema'
import { circleThroughThreePoints } from '../../shared/sketch-profile'

/**
 * 2D sketch v2 constraint energy + gradient steps on the points map.
 * `arc` entities have no solver terms — the curve is implied by three point positions; constrain those points as usual.
 * `spline_fit` / `spline_cp` / `ellipse` have no extra solver terms: constrain referenced point IDs (knots/controls) or primitive centers
 * where applicable; the displayed curve is derived from positions (see sketch-profile tessellation).
 */

type Pt = { x: number; y: number }
type ArcCircle = { center: Pt; radius: number }

function getPoint(d: DesignFileV2, id: string): Pt {
  const p = d.points[id]
  if (!p) return { x: 0, y: 0 }
  return { x: p.x, y: p.y }
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function arcCircleFromEntity(d: DesignFileV2, entityId: string): ArcCircle | null {
  const ent = d.entities.find((e) => e.id === entityId)
  if (!ent) return null
  if (ent.kind === 'circle') {
    return { center: { x: ent.cx, y: ent.cy }, radius: ent.r }
  }
  if (ent.kind !== 'arc') return null
  const s = d.points[ent.startId]
  const v = d.points[ent.viaId]
  const e = d.points[ent.endId]
  if (!s || !v || !e) return null
  const circ = circleThroughThreePoints(s.x, s.y, v.x, v.y, e.x, e.y)
  if (!circ) return null
  return { center: { x: circ.ox, y: circ.oy }, radius: circ.r }
}

const LEN_EPS = 1e-9

/** Stops angle-only (dot² / cross²) objectives from collapsing segment lengths to zero. */
const ANCHOR_WEIGHT = 0.015

/** Dot product of segment directions; 0 when perpendicular. */
function perpDot(a1: Pt, b1: Pt, a2: Pt, b2: Pt): number {
  const v1x = b1.x - a1.x
  const v1y = b1.y - a1.y
  const v2x = b2.x - a2.x
  const v2y = b2.y - a2.y
  return v1x * v2x + v1y * v2y
}

/** Signed 2D cross (b−a)×(c−a); 0 when a,b,c are collinear. */
function collinearCross(a: Pt, b: Pt, c: Pt): number {
  const v1x = b.x - a.x
  const v1y = b.y - a.y
  const v2x = c.x - a.x
  const v2y = c.y - a.y
  return v1x * v2y - v1y * v2x
}

/** 2D cross of segment directions; 0 when parallel. */
function parallelCross(a1: Pt, b1: Pt, a2: Pt, b2: Pt): number {
  const v1x = b1.x - a1.x
  const v1y = b1.y - a1.y
  const v2x = b2.x - a2.x
  const v2y = b2.y - a2.y
  return v1x * v2y - v1y * v2x
}

/** |cos θ| for reporting when edges are non-degenerate. */
function perpResidual(a1: Pt, b1: Pt, a2: Pt, b2: Pt): number {
  const v1x = b1.x - a1.x
  const v1y = b1.y - a1.y
  const v2x = b2.x - a2.x
  const v2y = b2.y - a2.y
  const len1 = Math.hypot(v1x, v1y)
  const len2 = Math.hypot(v2x, v2y)
  if (len1 < LEN_EPS || len2 < LEN_EPS) return 0
  return perpDot(a1, b1, a2, b2) / (len1 * len2)
}

/** |sin θ| for reporting when edges are non-degenerate. */
function parallelResidual(a1: Pt, b1: Pt, a2: Pt, b2: Pt): number {
  const v1x = b1.x - a1.x
  const v1y = b1.y - a1.y
  const v2x = b2.x - a2.x
  const v2y = b2.y - a2.y
  const len1 = Math.hypot(v1x, v1y)
  const len2 = Math.hypot(v2x, v2y)
  if (len1 < LEN_EPS || len2 < LEN_EPS) return 0
  return parallelCross(a1, b1, a2, b2) / (len1 * len2)
}

/** Sum of squared constraint residuals. */
export function energy(d: DesignFileV2): number {
  let e = 0
  const P = d.parameters
  for (const c of d.constraints) {
    if (c.type === 'coincident') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      e += (a.x - b.x) ** 2 + (a.y - b.y) ** 2
    } else if (c.type === 'distance') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const target = P[c.parameterKey]
      if (target == null || !Number.isFinite(target)) continue
      const dd = dist(a, b) - target
      e += dd * dd
    } else if (c.type === 'horizontal') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      e += (a.y - b.y) ** 2
    } else if (c.type === 'vertical') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      e += (a.x - b.x) ** 2
    } else if (c.type === 'perpendicular') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const dot = perpDot(a1, b1, a2, b2)
      e += dot * dot
    } else if (c.type === 'parallel') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const cr = parallelCross(a1, b1, a2, b2)
      e += cr * cr
    } else if (c.type === 'equal') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const dl = dist(a1, b1) - dist(a2, b2)
      e += dl * dl
    } else if (c.type === 'collinear') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const p = getPoint(d, c.c.pointId)
      const cr = collinearCross(a, b, p)
      e += cr * cr
    } else if (c.type === 'midpoint') {
      const m = getPoint(d, c.m.pointId)
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const ex = 2 * m.x - a.x - b.x
      const ey = 2 * m.y - a.y - b.y
      e += ex * ex + ey * ey
    } else if (c.type === 'angle') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const targetDeg = P[c.parameterKey]
      if (targetDeg == null || !Number.isFinite(targetDeg)) continue
      const cosT = Math.cos((targetDeg * Math.PI) / 180)
      const v1x = b1.x - a1.x
      const v1y = b1.y - a1.y
      const v2x = b2.x - a2.x
      const v2y = b2.y - a2.y
      const len1 = Math.hypot(v1x, v1y)
      const len2 = Math.hypot(v2x, v2y)
      if (len1 < LEN_EPS || len2 < LEN_EPS) continue
      const cmeas = (v1x * v2x + v1y * v2y) / (len1 * len2)
      const dd = cmeas - cosT
      e += dd * dd
    } else if (c.type === 'tangent') {
      const pa = getPoint(d, c.lineA.pointId)
      const pb = getPoint(d, c.lineB.pointId)
      const sa = getPoint(d, c.arcStart.pointId)
      const sv = getPoint(d, c.arcVia.pointId)
      const se = getPoint(d, c.arcEnd.pointId)
      const circ = circleThroughThreePoints(sa.x, sa.y, sv.x, sv.y, se.x, se.y)
      if (!circ) continue
      const P = c.arcTangentAt === 'start' ? sa : se
      const radialx = P.x - circ.ox
      const radialy = P.y - circ.oy
      const rlen = Math.hypot(radialx, radialy)
      if (rlen < LEN_EPS) continue
      let ldx: number, ldy: number
      if (c.lineTangentAt === 'a') {
        ldx = pb.x - pa.x
        ldy = pb.y - pa.y
      } else {
        ldx = pa.x - pb.x
        ldy = pa.y - pb.y
      }
      const llen = Math.hypot(ldx, ldy)
      if (llen < LEN_EPS) continue
      const dot = ldx * radialx + ldy * radialy
      e += (dot * dot) / (llen * llen * rlen * rlen + LEN_EPS * LEN_EPS)
    } else if (c.type === 'symmetric') {
      const p1 = getPoint(d, c.p1.pointId)
      const p2 = getPoint(d, c.p2.pointId)
      const la = getPoint(d, c.la.pointId)
      const lb = getPoint(d, c.lb.pointId)
      const rx = reflectAcrossLine(p1.x, p1.y, la.x, la.y, lb.x, lb.y)
      const dx = p2.x - rx.x
      const dy = p2.y - rx.y
      e += dx * dx + dy * dy
    } else if (c.type === 'concentric') {
      const a = arcCircleFromEntity(d, c.entityAId)
      const b = arcCircleFromEntity(d, c.entityBId)
      if (!a || !b) continue
      const dx = a.center.x - b.center.x
      const dy = a.center.y - b.center.y
      e += dx * dx + dy * dy
    } else if (c.type === 'radius' || c.type === 'diameter') {
      const arc = arcCircleFromEntity(d, c.entityId)
      const target = P[c.parameterKey]
      if (!arc || target == null || !Number.isFinite(target)) continue
      const targetR = c.type === 'diameter' ? target * 0.5 : target
      const dr = arc.radius - targetR
      e += dr * dr
    }
  }
  return e
}

/** Reflect point P across the infinite line through A–B. */
function reflectAcrossLine(px: number, py: number, ax: number, ay: number, bx: number, by: number): Pt {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  if (len2 < LEN_EPS * LEN_EPS) return { x: px, y: py }
  const t = ((px - ax) * vx + (py - ay) * vy) / len2
  const qx = ax + t * vx
  const qy = ay + t * vy
  return { x: 2 * qx - px, y: 2 * qy - py }
}

function anchorEnergy(d: DesignFileV2, initial: Record<string, Pt>, freeIds: string[]): number {
  let e = 0
  for (const id of freeIds) {
    const p = d.points[id]
    const p0 = initial[id]
    if (!p || !p0) continue
    e += (p.x - p0.x) ** 2 + (p.y - p0.y) ** 2
  }
  return e
}

function totalSolveEnergy(
  d: DesignFileV2,
  initial: Record<string, Pt>,
  freeIds: string[]
): number {
  return energy(d) + ANCHOR_WEIGHT * anchorEnergy(d, initial, freeIds)
}

function applyFixConstraints(d: DesignFileV2): void {
  for (const c of d.constraints) {
    if (c.type === 'fix') {
      const p = d.points[c.pointId]
      if (p) p.fixed = true
    }
  }
}

function collectFreePointIds(d: DesignFileV2): string[] {
  return Object.keys(d.points).filter((id) => !d.points[id]!.fixed)
}

function restoreFreePoints(d: DesignFileV2, snap: Record<string, Pt>, freeIds: string[]): void {
  for (const id of freeIds) {
    const p = d.points[id]
    const s = snap[id]
    if (p && s) {
      p.x = s.x
      p.y = s.y
    }
  }
}

/**
 * Gradient descent using central differences on free point coordinates.
 * Uses a Jacobi sweep (snapshot → all gradients → apply) so multi-point constraints stay stable.
 */
export function solveSketch(design: DesignFileV2, iterations = 120, step = 0.4): DesignFileV2 {
  const d = design
  applyFixConstraints(d)
  if (d.constraints.length === 0) return d

  const initial: Record<string, Pt> = {}
  for (const id of collectFreePointIds(d)) {
    const p = d.points[id]
    if (p) initial[id] = { x: p.x, y: p.y }
  }

  let lr = step
  for (let it = 0; it < iterations; it++) {
    const free = collectFreePointIds(d)
    if (free.length === 0) break
    const e0 = totalSolveEnergy(d, initial, free)
    if (e0 < 1e-14) break

    const snap: Record<string, Pt> = {}
    for (const id of free) {
      const p = d.points[id]!
      snap[id] = { x: p.x, y: p.y }
    }

    const eps = 1e-5
    const next: Record<string, Pt> = {}
    for (const pid of free) {
      restoreFreePoints(d, snap, free)
      const p = d.points[pid]!
      const x0 = p.x
      const y0 = p.y
      p.x = x0 + eps
      const ex = totalSolveEnergy(d, initial, free)
      p.x = x0 - eps
      const emx = totalSolveEnergy(d, initial, free)
      p.x = x0
      const gx = (ex - emx) / (2 * eps)

      p.y = y0 + eps
      const ey = totalSolveEnergy(d, initial, free)
      p.y = y0 - eps
      const emy = totalSolveEnergy(d, initial, free)
      p.y = y0
      const gy = (ey - emy) / (2 * eps)

      next[pid] = { x: x0 - lr * gx, y: y0 - lr * gy }
    }

    for (const pid of free) {
      const p = d.points[pid]!
      const q = next[pid]!
      p.x = q.x
      p.y = q.y
    }

    const e1 = totalSolveEnergy(d, initial, collectFreePointIds(d))
    if (!Number.isFinite(e1) || e1 > e0 * 1.001) {
      restoreFreePoints(d, snap, free)
      lr *= 0.5
      if (lr < 1e-8) break
    }
  }
  return d
}

export function cloneDesign(d: DesignFileV2): DesignFileV2 {
  const points: Record<string, SketchPoint> = {}
  for (const [k, v] of Object.entries(d.points)) {
    points[k] = { x: v.x, y: v.y, fixed: v.fixed }
  }
  return {
    ...d,
    points,
    parameters: { ...d.parameters },
    entities: d.entities.map((e) => ({ ...e })),
    constraints: d.constraints.map((c) => ({ ...c })) as SketchConstraint[],
    dimensions: (d.dimensions ?? []).map((dim) => ({ ...dim }))
  }
}

export function sketchResidualReport(d: DesignFileV2): { total: number; lines: string[] } {
  const lines: string[] = []
  let total = 0
  const P = d.parameters
  for (const c of d.constraints) {
    if (c.type === 'coincident') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const r = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      total += r
      lines.push(`coincident: err²=${r.toExponential(2)}`)
    } else if (c.type === 'distance') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const target = P[c.parameterKey]
      if (target == null) {
        lines.push(`distance ${c.parameterKey}: missing parameter`)
        continue
      }
      const r = (dist(a, b) - target) ** 2
      total += r
      lines.push(`distance ${c.parameterKey}: |Δ|=${Math.sqrt(r).toFixed(4)} mm`)
    } else if (c.type === 'horizontal') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const r = (a.y - b.y) ** 2
      total += r
      lines.push(`horizontal: Δy²=${r.toExponential(2)}`)
    } else if (c.type === 'vertical') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const r = (a.x - b.x) ** 2
      total += r
      lines.push(`vertical: Δx²=${r.toExponential(2)}`)
    } else if (c.type === 'perpendicular') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const dot = perpDot(a1, b1, a2, b2)
      total += dot * dot
      const r = perpResidual(a1, b1, a2, b2)
      lines.push(
        r === 0
          ? `perpendicular: |dot|=${Math.abs(dot).toExponential(2)} (degenerate edge)`
          : `perpendicular: |cos θ|=${Math.abs(r).toExponential(2)}`
      )
    } else if (c.type === 'parallel') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const cr = parallelCross(a1, b1, a2, b2)
      total += cr * cr
      const r = parallelResidual(a1, b1, a2, b2)
      lines.push(
        r === 0
          ? `parallel: |cross|=${Math.abs(cr).toExponential(2)} (degenerate edge)`
          : `parallel: |sin θ|=${Math.abs(r).toExponential(2)}`
      )
    } else if (c.type === 'equal') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const l1 = dist(a1, b1)
      const l2 = dist(a2, b2)
      const dl = l1 - l2
      total += dl * dl
      lines.push(`equal: |ΔL|=${Math.abs(dl).toFixed(4)} mm (L1=${l1.toFixed(4)}, L2=${l2.toFixed(4)})`)
    } else if (c.type === 'collinear') {
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const p = getPoint(d, c.c.pointId)
      const cr = collinearCross(a, b, p)
      total += cr * cr
      const lab = dist(a, b)
      const residual = lab < LEN_EPS ? 0 : Math.abs(cr) / lab
      lines.push(
        residual === 0
          ? `collinear: |cross|=${Math.abs(cr).toExponential(2)} (degenerate A—B)`
          : `collinear: |dist×|/|AB|=${residual.toExponential(2)}`
      )
    } else if (c.type === 'midpoint') {
      const m = getPoint(d, c.m.pointId)
      const a = getPoint(d, c.a.pointId)
      const b = getPoint(d, c.b.pointId)
      const ex = 2 * m.x - a.x - b.x
      const ey = 2 * m.y - a.y - b.y
      const err = ex * ex + ey * ey
      total += err
      lines.push(`midpoint: |2M−A−B|=${Math.hypot(ex, ey).toFixed(4)} mm`)
    } else if (c.type === 'angle') {
      const a1 = getPoint(d, c.a1.pointId)
      const b1 = getPoint(d, c.b1.pointId)
      const a2 = getPoint(d, c.a2.pointId)
      const b2 = getPoint(d, c.b2.pointId)
      const targetDeg = P[c.parameterKey]
      if (targetDeg == null) {
        lines.push(`angle ${c.parameterKey}: missing parameter`)
        continue
      }
      const v1x = b1.x - a1.x
      const v1y = b1.y - a1.y
      const v2x = b2.x - a2.x
      const v2y = b2.y - a2.y
      const len1 = Math.hypot(v1x, v1y)
      const len2 = Math.hypot(v2x, v2y)
      if (len1 < LEN_EPS || len2 < LEN_EPS) {
        lines.push('angle: degenerate segment')
        continue
      }
      const cmeas = (v1x * v2x + v1y * v2y) / (len1 * len2)
      const cosT = Math.cos((targetDeg * Math.PI) / 180)
      const dd = cmeas - cosT
      total += dd * dd
      const measDeg = (Math.acos(Math.max(-1, Math.min(1, cmeas))) * 180) / Math.PI
      lines.push(`angle ${c.parameterKey}: meas≈${measDeg.toFixed(2)}° target=${targetDeg}°`)
    } else if (c.type === 'tangent') {
      const pa = getPoint(d, c.lineA.pointId)
      const pb = getPoint(d, c.lineB.pointId)
      const sa = getPoint(d, c.arcStart.pointId)
      const sv = getPoint(d, c.arcVia.pointId)
      const se = getPoint(d, c.arcEnd.pointId)
      const circ = circleThroughThreePoints(sa.x, sa.y, sv.x, sv.y, se.x, se.y)
      if (!circ) {
        lines.push('tangent: arc points collinear')
        continue
      }
      const P = c.arcTangentAt === 'start' ? sa : se
      const radialx = P.x - circ.ox
      const radialy = P.y - circ.oy
      const rlen = Math.hypot(radialx, radialy)
      let ldx: number, ldy: number
      if (c.lineTangentAt === 'a') {
        ldx = pb.x - pa.x
        ldy = pb.y - pa.y
      } else {
        ldx = pa.x - pb.x
        ldy = pa.y - pb.y
      }
      const llen = Math.hypot(ldx, ldy)
      if (rlen < LEN_EPS || llen < LEN_EPS) {
        lines.push('tangent: degenerate arc radius or line')
        continue
      }
      const cosAlign = (ldx * radialx + ldy * radialy) / (llen * rlen)
      const err = cosAlign * cosAlign
      total += err
      lines.push(`tangent: |cos(line,radial)|=${Math.abs(cosAlign).toExponential(2)} (want 0)`)
    } else if (c.type === 'symmetric') {
      const p1 = getPoint(d, c.p1.pointId)
      const p2 = getPoint(d, c.p2.pointId)
      const la = getPoint(d, c.la.pointId)
      const lb = getPoint(d, c.lb.pointId)
      const rx = reflectAcrossLine(p1.x, p1.y, la.x, la.y, lb.x, lb.y)
      const dx = p2.x - rx.x
      const dy = p2.y - rx.y
      const err = dx * dx + dy * dy
      total += err
      lines.push(`symmetric: |P2−reflect(P1)|=${Math.hypot(dx, dy).toFixed(4)} mm`)
    } else if (c.type === 'concentric') {
      const a = arcCircleFromEntity(d, c.entityAId)
      const b = arcCircleFromEntity(d, c.entityBId)
      if (!a || !b) {
        lines.push(`concentric: missing or invalid circle/arc entity`)
        continue
      }
      const dx = a.center.x - b.center.x
      const dy = a.center.y - b.center.y
      const err = dx * dx + dy * dy
      total += err
      lines.push(`concentric: Δcenter=${Math.hypot(dx, dy).toFixed(4)} mm`)
    } else if (c.type === 'radius' || c.type === 'diameter') {
      const arc = arcCircleFromEntity(d, c.entityId)
      const target = P[c.parameterKey]
      if (!arc) {
        lines.push(`${c.type} ${c.parameterKey}: missing or invalid circle/arc entity`)
        continue
      }
      if (target == null || !Number.isFinite(target)) {
        lines.push(`${c.type} ${c.parameterKey}: missing parameter`)
        continue
      }
      const targetR = c.type === 'diameter' ? target * 0.5 : target
      const dr = arc.radius - targetR
      const err = dr * dr
      total += err
      lines.push(`${c.type} ${c.parameterKey}: |ΔR|=${Math.abs(dr).toFixed(4)} mm`)
    }
  }
  return { total, lines }
}
