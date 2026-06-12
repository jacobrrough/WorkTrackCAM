/**
 * Sketch S2 -- pure object-snap (osnap) engine for the 2D sketch canvas.
 *
 * Framework-free and DOM-free (node-SSR testable, the repo convention): the
 * canvas feeds it the design plus a raw pointer point in sketch-plane mm; it
 * answers with the resolved placement point and which snap candidate (if any)
 * won. The session-wired `Sketch2DCanvas` routes its ONE pointer-resolution
 * path through {@link resolveSnappedPoint}; node/vertex-edit handle drags can
 * call the same function so every precision affordance agrees on where a
 * click lands.
 *
 * Candidate sources (AutoCAD / Fusion object-snap convention):
 *   - endpoint:     polyline vertices (incl. legacy inline-points polylines
 *                   and text-derived letter outlines), rect corners, arc
 *                   start/end, open spline curve ends (spline_fit ends are
 *                   its first/last knots; spline_cp ends are the tessellated
 *                   curve ends -- control points are NOT on the curve).
 *   - midpoint:     per-segment midpoints of polylines (closing edge included
 *                   when closed) and rect edges; the arc's sweep midpoint.
 *   - center:       circle / ellipse / slot / rect centers, the arc's
 *                   circumcenter, and the vertex centroid of CLOSED polylines
 *                   (the regular-polygon tool stores its output as a closed
 *                   polyline, so "polygon center" is the closed-polyline
 *                   centroid).
 *   - quadrant:     0/90/180/270-degree rim points -- circles use the world
 *                   axes, ellipses use the parametric axes (follows
 *                   `rotation`), arcs keep only the world-axis angles that
 *                   lie strictly inside the sweep.
 *   - intersection: pairwise PROPER crossings of the SAMPLED outlines of two
 *                   DIFFERENT entities. Outlines come from the same
 *                   `entityOutlineWorld` the hit test and selection highlight
 *                   trace, so what you see crossing is what you snap to.
 *
 * Intersection cost control (sketch scale is hundreds of entities, not
 * thousands): entity pairs are AABB-prefiltered, then at most
 * `OSNAP_INTERSECTION_PAIR_CAP` surviving pairs are segment-tested, walking
 * pairs in entity order. TRUNCATION NOTE: pairs beyond the cap contribute no
 * intersection candidates -- endpoint/midpoint/center/quadrant candidates are
 * never truncated, so degradation on a pathological sketch is partial (only
 * the latest-in-draw-order crossing snaps disappear). Tests exercise the
 * behavior through the `intersectionPairCap` override.
 */

import type { DesignFileV2, SketchEntity, SketchPoint } from '../../shared/design-schema'
import {
  arcEntityGeometry,
  polylinePositions,
  worldCornersFromRectParams
} from '../../shared/sketch-profile'
import { snap } from './sketch2d-canvas-coords'
import { entityOutlineWorld, snappedDragDelta, type EntityOutlineWorld } from './sketch2d-hit-test'

export type OsnapKind = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'intersection'

export interface OsnapCandidate {
  kind: OsnapKind
  /** Sketch-plane mm. */
  point: [number, number]
  /** Owning entities (one id; two ids for an intersection, in entity order). */
  sourceEntityIds: string[]
}

/** Tie-break priority when two candidates are EXACTLY equally near (lower rank wins). */
export const OSNAP_KIND_RANK: Readonly<Record<OsnapKind, number>> = {
  endpoint: 0,
  midpoint: 1,
  center: 2,
  quadrant: 3,
  intersection: 4
}

/** Osnap aperture in CSS px (slightly wider than the 8 px select pick). */
export const OSNAP_PICK_PX = 10

/** Convert the px aperture to world mm at the current zoom (px-per-mm scale). */
export function osnapToleranceMm(scalePxPerMm: number): number {
  return OSNAP_PICK_PX / Math.max(scalePxPerMm, 0.05)
}

/**
 * Max AABB-surviving entity pairs segment-tested for intersection candidates
 * per collect (see the module-header truncation note).
 */
export const OSNAP_INTERSECTION_PAIR_CAP = 1500

/** Operator-facing label for the marker chip next to the cursor (exhaustive). */
export function osnapKindLabel(kind: OsnapKind): string {
  switch (kind) {
    case 'endpoint':
      return 'Endpoint'
    case 'midpoint':
      return 'Midpoint'
    case 'center':
      return 'Center'
    case 'quadrant':
      return 'Quadrant'
    case 'intersection':
      return 'Intersection'
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      return ''
    }
  }
}

const TAU = Math.PI * 2

/** World-axis quadrant angles (+X, +Y, -X, -Y). */
const QUADRANT_ANGLES: readonly number[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]

/** CCW angular distance from `a` to `b` in (0, 2*PI]. */
function sweepCCWLocal(a: number, b: number): number {
  let d = b - a
  while (d <= 0) d += TAU
  while (d > TAU + 1e-12) d -= TAU
  return d
}

/** `t` lies strictly inside the arc sweep (ends excluded -- those are endpoint candidates). */
function angleStrictlyInsideSweep(t: number, ta: number, tc: number, ccw: boolean): boolean {
  const eps = 1e-6
  const span = ccw ? sweepCCWLocal(ta, tc) : sweepCCWLocal(tc, ta)
  const st = ccw ? sweepCCWLocal(ta, t) : sweepCCWLocal(tc, t)
  return st > eps && st < span - eps
}

function pushCandidate(
  out: OsnapCandidate[],
  kind: OsnapKind,
  x: number,
  y: number,
  sourceEntityIds: string[]
): void {
  out.push({ kind, point: [x, y], sourceEntityIds })
}

/** Endpoint / midpoint / center / quadrant candidates for one entity (exhaustive). */
function collectEntityLocalCandidates(
  e: SketchEntity,
  points: Record<string, SketchPoint>,
  out: OsnapCandidate[]
): void {
  switch (e.kind) {
    case 'polyline': {
      const pts = polylinePositions(e, points)
      if (pts.length < 2) return
      for (const p of pts) pushCandidate(out, 'endpoint', p[0], p[1], [e.id])
      const closed = e.closed && pts.length >= 3
      const segCount = closed ? pts.length : pts.length - 1
      for (let i = 0; i < segCount; i++) {
        const a = pts[i]!
        const b = pts[(i + 1) % pts.length]!
        pushCandidate(out, 'midpoint', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, [e.id])
      }
      if (closed) {
        let sx = 0
        let sy = 0
        for (const p of pts) {
          sx += p[0]
          sy += p[1]
        }
        pushCandidate(out, 'center', sx / pts.length, sy / pts.length, [e.id])
      }
      return
    }
    case 'rect': {
      const corners = worldCornersFromRectParams(e)
      for (const c of corners) pushCandidate(out, 'endpoint', c[0], c[1], [e.id])
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i]!
        const b = corners[(i + 1) % corners.length]!
        pushCandidate(out, 'midpoint', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, [e.id])
      }
      pushCandidate(out, 'center', e.cx, e.cy, [e.id])
      return
    }
    case 'circle': {
      pushCandidate(out, 'center', e.cx, e.cy, [e.id])
      pushCandidate(out, 'quadrant', e.cx + e.r, e.cy, [e.id])
      pushCandidate(out, 'quadrant', e.cx, e.cy + e.r, [e.id])
      pushCandidate(out, 'quadrant', e.cx - e.r, e.cy, [e.id])
      pushCandidate(out, 'quadrant', e.cx, e.cy - e.r, [e.id])
      return
    }
    case 'ellipse': {
      pushCandidate(out, 'center', e.cx, e.cy, [e.id])
      const cos = Math.cos(e.rotation)
      const sin = Math.sin(e.rotation)
      const axisLocals: readonly [number, number][] = [
        [e.rx, 0],
        [0, e.ry],
        [-e.rx, 0],
        [0, -e.ry]
      ]
      for (const [lx, ly] of axisLocals) {
        pushCandidate(out, 'quadrant', e.cx + lx * cos - ly * sin, e.cy + lx * sin + ly * cos, [
          e.id
        ])
      }
      return
    }
    case 'slot': {
      pushCandidate(out, 'center', e.cx, e.cy, [e.id])
      return
    }
    case 'arc': {
      const pa = points[e.startId]
      const pc = points[e.endId]
      if (pa) pushCandidate(out, 'endpoint', pa.x, pa.y, [e.id])
      if (pc) pushCandidate(out, 'endpoint', pc.x, pc.y, [e.id])
      const g = arcEntityGeometry(e, points)
      if (!g) return
      pushCandidate(out, 'center', g.ox, g.oy, [e.id])
      const span = g.ccw ? sweepCCWLocal(g.ta, g.tc) : sweepCCWLocal(g.tc, g.ta)
      const tMid = g.ccw ? g.ta + span / 2 : g.ta - span / 2
      pushCandidate(out, 'midpoint', g.ox + g.r * Math.cos(tMid), g.oy + g.r * Math.sin(tMid), [
        e.id
      ])
      for (const q of QUADRANT_ANGLES) {
        if (angleStrictlyInsideSweep(q, g.ta, g.tc, g.ccw)) {
          pushCandidate(out, 'quadrant', g.ox + g.r * Math.cos(q), g.oy + g.r * Math.sin(q), [
            e.id
          ])
        }
      }
      return
    }
    case 'spline_fit':
    case 'spline_cp': {
      const outline = entityOutlineWorld(e, points)
      if (!outline || outline.closed || outline.pts.length < 2) return
      const first = outline.pts[0]!
      const last = outline.pts[outline.pts.length - 1]!
      pushCandidate(out, 'endpoint', first[0], first[1], [e.id])
      pushCandidate(out, 'endpoint', last[0], last[1], [e.id])
      return
    }
    default: {
      const _exhaustive: never = e
      void _exhaustive
      return
    }
  }
}

interface OutlineEntry {
  id: string
  pts: [number, number][]
  closed: boolean
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function makeOutlineEntry(id: string, outline: EntityOutlineWorld): OutlineEntry {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of outline.pts) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  return { id, pts: outline.pts, closed: outline.closed, minX, minY, maxX, maxY }
}

/**
 * Proper (interior-interior) crossing of segments AB and CD, or null. Touches
 * at segment ends are excluded on purpose: a T-junction or shared vertex is
 * already an endpoint candidate, and endpoint outranks intersection anyway.
 */
export function segmentProperIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): [number, number] | null {
  const r1x = bx - ax
  const r1y = by - ay
  const r2x = dx - cx
  const r2y = dy - cy
  const den = r1x * r2y - r1y * r2x
  if (Math.abs(den) < 1e-14) return null
  const qx = cx - ax
  const qy = cy - ay
  const t = (qx * r2y - qy * r2x) / den
  const u = (qx * r1y - qy * r1x) / den
  const EPS = 1e-9
  if (t < EPS || t > 1 - EPS || u < EPS || u > 1 - EPS) return null
  return [ax + t * r1x, ay + t * r1y]
}

/** Near-duplicate window (mm) for crossings of the same entity pair (tessellation jitter). */
const PAIR_DEDUPE_MM = 1e-6

function collectPairIntersections(a: OutlineEntry, b: OutlineEntry, out: OsnapCandidate[]): void {
  const na = a.pts.length
  const nb = b.pts.length
  const segsA = a.closed ? na : na - 1
  const segsB = b.closed ? nb : nb - 1
  const found: [number, number][] = []
  for (let i = 0; i < segsA; i++) {
    const a0 = a.pts[i]!
    const a1 = a.pts[(i + 1) % na]!
    const sMinX = Math.min(a0[0], a1[0])
    const sMaxX = Math.max(a0[0], a1[0])
    const sMinY = Math.min(a0[1], a1[1])
    const sMaxY = Math.max(a0[1], a1[1])
    if (sMaxX < b.minX || sMinX > b.maxX || sMaxY < b.minY || sMinY > b.maxY) continue
    for (let j = 0; j < segsB; j++) {
      const b0 = b.pts[j]!
      const b1 = b.pts[(j + 1) % nb]!
      if (
        Math.max(b0[0], b1[0]) < sMinX ||
        Math.min(b0[0], b1[0]) > sMaxX ||
        Math.max(b0[1], b1[1]) < sMinY ||
        Math.min(b0[1], b1[1]) > sMaxY
      ) {
        continue
      }
      const hit = segmentProperIntersection(a0[0], a0[1], a1[0], a1[1], b0[0], b0[1], b1[0], b1[1])
      if (!hit) continue
      let dup = false
      for (const f of found) {
        if (Math.abs(f[0] - hit[0]) <= PAIR_DEDUPE_MM && Math.abs(f[1] - hit[1]) <= PAIR_DEDUPE_MM) {
          dup = true
          break
        }
      }
      if (dup) continue
      found.push(hit)
      out.push({ kind: 'intersection', point: hit, sourceEntityIds: [a.id, b.id] })
    }
  }
}

export interface CollectOsnapCandidatesInput {
  design: DesignFileV2
  /**
   * Entities to omit entirely -- their local candidates AND any intersection
   * involving them. Drag-move passes the dragged selection here so a dragged
   * entity never snaps to ITSELF (or to crossings that move with it).
   */
  excludeEntityIds?: Iterable<string>
  /** Test override for {@link OSNAP_INTERSECTION_PAIR_CAP}. */
  intersectionPairCap?: number
}

/**
 * All osnap candidates for a design, in a flat list the resolver scans
 * linearly. Memoize per design revision (the canvas recomputes on design
 * identity change only).
 */
export function collectOsnapCandidates(input: CollectOsnapCandidatesInput): OsnapCandidate[] {
  const { design } = input
  const exclude = new Set(input.excludeEntityIds ?? [])
  const cap = input.intersectionPairCap ?? OSNAP_INTERSECTION_PAIR_CAP
  const out: OsnapCandidate[] = []
  const entries: OutlineEntry[] = []
  for (const e of design.entities) {
    if (exclude.has(e.id)) continue
    collectEntityLocalCandidates(e, design.points, out)
    const outline = entityOutlineWorld(e, design.points)
    if (outline && outline.pts.length >= 2) entries.push(makeOutlineEntry(e.id, outline))
  }
  let pairsTested = 0
  let truncated = false
  for (let i = 0; i < entries.length && !truncated; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const A = entries[i]!
      const B = entries[j]!
      if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) continue
      if (pairsTested >= cap) {
        truncated = true
        break
      }
      pairsTested++
      collectPairIntersections(A, B, out)
    }
  }
  return out
}

export interface ResolveSnappedPointInput {
  /** Raw pointer location in sketch-plane mm (post screenToWorld, pre snap). */
  raw: readonly [number, number]
  candidates: readonly OsnapCandidate[]
  /** Grid lattice pitch (mm) for the fallback (the canvas's existing snap()). */
  gridMm: number
  /** When false the lattice fallback is skipped (raw passes through). */
  gridEnabled: boolean
  /** When false candidates are ignored entirely (OSNAP toggle off). */
  osnapEnabled: boolean
  /** Osnap aperture in mm (see {@link osnapToleranceMm}). */
  toleranceMm: number
}

export interface OsnapResolution {
  /** The resolved placement point (osnap point, lattice point, or raw). */
  point: [number, number]
  /** The winning candidate, or null when the grid/raw fallback applied. */
  snapped: OsnapCandidate | null
}

/**
 * THE pointer resolution: the nearest osnap candidate within `toleranceMm`
 * (inclusive) wins; ties at EXACTLY equal distance resolve by kind priority
 * (endpoint > midpoint > center > quadrant > intersection). Otherwise the
 * grid lattice when `gridEnabled`, otherwise the raw point. The two toggles
 * are independent -- grid may be off while osnap stays on, and vice versa.
 */
export function resolveSnappedPoint(input: ResolveSnappedPointInput): OsnapResolution {
  const { raw, candidates, gridMm, gridEnabled, osnapEnabled, toleranceMm } = input
  const rx = raw[0]
  const ry = raw[1]
  if (osnapEnabled && Number.isFinite(toleranceMm) && toleranceMm > 0) {
    const tol2 = toleranceMm * toleranceMm
    let best: OsnapCandidate | null = null
    let bestD2 = Number.POSITIVE_INFINITY
    let bestRank = Number.POSITIVE_INFINITY
    for (const cand of candidates) {
      const dx = cand.point[0] - rx
      const dy = cand.point[1] - ry
      const d2 = dx * dx + dy * dy
      if (d2 > tol2) continue
      const rank = OSNAP_KIND_RANK[cand.kind]
      if (d2 < bestD2 || (d2 === bestD2 && rank < bestRank)) {
        best = cand
        bestD2 = d2
        bestRank = rank
      }
    }
    if (best) return { point: [best.point[0], best.point[1]], snapped: best }
  }
  if (gridEnabled) return { point: [snap(rx, gridMm), snap(ry, gridMm)], snapped: null }
  return { point: [rx, ry], snapped: null }
}

export interface ResolveDragDeltaInput {
  /** Where the drag gesture pressed (sketch-plane mm). */
  startWorld: readonly [number, number]
  /** Raw (unsnapped) pointer location now / at release. */
  rawEndWorld: readonly [number, number]
  /** Candidates collected WITH the dragged selection excluded. */
  candidates: readonly OsnapCandidate[]
  gridMm: number
  osnapEnabled: boolean
  toleranceMm: number
}

export interface OsnapDragResolution {
  /** The ONE translation a completed drag emits (the ghost shows the same value). */
  deltaMm: [number, number]
  snapped: OsnapCandidate | null
}

/**
 * Drag-move resolution: the drag END POINT resolves through
 * {@link resolveSnappedPoint} (osnap only -- candidates must already exclude
 * the dragged selection); when no candidate is in range the delta falls back
 * to the S1 lattice behavior byte-for-byte (`snappedDragDelta`: each axis of
 * the TOTAL delta snaps independently). Node-edit handle drags can reuse this
 * for the same ghost == commit guarantee.
 */
export function resolveDragDeltaWithOsnap(input: ResolveDragDeltaInput): OsnapDragResolution {
  const { startWorld, rawEndWorld, candidates, gridMm, osnapEnabled, toleranceMm } = input
  const probe = resolveSnappedPoint({
    raw: rawEndWorld,
    candidates,
    gridMm,
    gridEnabled: false,
    osnapEnabled,
    toleranceMm
  })
  if (probe.snapped) {
    return {
      deltaMm: [probe.point[0] - startWorld[0], probe.point[1] - startWorld[1]],
      snapped: probe.snapped
    }
  }
  return { deltaMm: snappedDragDelta(startWorld, rawEndWorld, gridMm), snapped: null }
}
