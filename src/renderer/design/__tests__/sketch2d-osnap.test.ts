/**
 * Sketch S2 -- unit contracts for the pure object-snap engine
 * (`sketch2d-osnap.ts`): candidate extraction for every entity kind,
 * pairwise sampled-outline intersections (bbox prefilter + documented pair
 * cap), the excludeEntityIds path (a dragged entity must not snap to
 * ITSELF), and the resolution rules (osnap wins within tolerance; nearest
 * candidate; endpoint > midpoint > center > quadrant > intersection on exact
 * ties; grid lattice fallback; raw passthrough).
 */
import { describe, expect, it } from 'vitest'
import type { DesignFileV2, SketchEntity, SketchPoint } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import { splineCpPolylineFromEntity } from '../../../shared/sketch-profile'
import { snap } from '../sketch2d-canvas-coords'
import { snappedDragDelta } from '../sketch2d-hit-test'
import {
  collectOsnapCandidates,
  OSNAP_INTERSECTION_PAIR_CAP,
  OSNAP_KIND_RANK,
  OSNAP_PICK_PX,
  osnapKindLabel,
  osnapToleranceMm,
  resolveDragDeltaWithOsnap,
  resolveSnappedPoint,
  segmentProperIntersection,
  type OsnapCandidate,
  type OsnapKind
} from '../sketch2d-osnap'

function designWith(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

function ofKind(cands: OsnapCandidate[], kind: OsnapKind): OsnapCandidate[] {
  return cands.filter((c) => c.kind === kind)
}

function hasPointNear(cands: OsnapCandidate[], x: number, y: number, eps = 1e-9): boolean {
  return cands.some((c) => Math.abs(c.point[0] - x) <= eps && Math.abs(c.point[1] - y) <= eps)
}

describe('collectOsnapCandidates -- per-kind extraction', () => {
  it('open polyline: every vertex is an endpoint, every segment has a midpoint, no center', () => {
    const d = designWith(
      [{ id: 'pl', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    )
    const cands = collectOsnapCandidates({ design: d })
    const ends = ofKind(cands, 'endpoint')
    expect(ends).toHaveLength(2)
    expect(hasPointNear(ends, 0, 0)).toBe(true)
    expect(hasPointNear(ends, 10, 0)).toBe(true)
    const mids = ofKind(cands, 'midpoint')
    expect(mids).toHaveLength(1)
    expect(hasPointNear(mids, 5, 0)).toBe(true)
    expect(ofKind(cands, 'center')).toHaveLength(0)
    expect(ends[0]!.sourceEntityIds).toEqual(['pl'])
  })

  it('closed polyline: closing-edge midpoint + vertex-centroid center (the polygon case)', () => {
    const d = designWith(
      [{ id: 'tri', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: 10 } }
    )
    const cands = collectOsnapCandidates({ design: d })
    expect(ofKind(cands, 'endpoint')).toHaveLength(3)
    const mids = ofKind(cands, 'midpoint')
    expect(mids).toHaveLength(3)
    expect(hasPointNear(mids, 0, 5)).toBe(true)
    const centers = ofKind(cands, 'center')
    expect(centers).toHaveLength(1)
    expect(centers[0]!.point[0]).toBeCloseTo(10 / 3, 9)
    expect(centers[0]!.point[1]).toBeCloseTo(10 / 3, 9)
  })

  it('legacy inline-points polyline still contributes endpoints + midpoints', () => {
    const d = designWith([
      { id: 'leg', kind: 'polyline', points: [[0, 0], [4, 0]], closed: false }
    ])
    const cands = collectOsnapCandidates({ design: d })
    expect(ofKind(cands, 'endpoint')).toHaveLength(2)
    expect(hasPointNear(ofKind(cands, 'midpoint'), 2, 0)).toBe(true)
  })

  it('rect: 4 corner endpoints, 4 edge midpoints, 1 center', () => {
    const d = designWith([
      { id: 'r', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }
    ])
    const cands = collectOsnapCandidates({ design: d })
    const ends = ofKind(cands, 'endpoint')
    expect(ends).toHaveLength(4)
    expect(hasPointNear(ends, 10, 5)).toBe(true)
    expect(hasPointNear(ends, -10, -5)).toBe(true)
    const mids = ofKind(cands, 'midpoint')
    expect(mids).toHaveLength(4)
    expect(hasPointNear(mids, 10, 0)).toBe(true)
    expect(hasPointNear(mids, 0, 5)).toBe(true)
    const centers = ofKind(cands, 'center')
    expect(centers).toHaveLength(1)
    expect(hasPointNear(centers, 0, 0)).toBe(true)
    expect(ofKind(cands, 'quadrant')).toHaveLength(0)
  })

  it('circle: center + 4 world-axis quadrants, nothing else', () => {
    const d = designWith([{ id: 'c', kind: 'circle', cx: 30, cy: 0, r: 5 }])
    const cands = collectOsnapCandidates({ design: d })
    expect(hasPointNear(ofKind(cands, 'center'), 30, 0)).toBe(true)
    const quads = ofKind(cands, 'quadrant')
    expect(quads).toHaveLength(4)
    expect(hasPointNear(quads, 35, 0)).toBe(true)
    expect(hasPointNear(quads, 30, 5)).toBe(true)
    expect(hasPointNear(quads, 25, 0)).toBe(true)
    expect(hasPointNear(quads, 30, -5)).toBe(true)
    expect(ofKind(cands, 'endpoint')).toHaveLength(0)
    expect(ofKind(cands, 'midpoint')).toHaveLength(0)
  })

  it('ellipse: quadrants follow the rotated parametric axes', () => {
    const d = designWith([
      { id: 'el', kind: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 5, rotation: Math.PI / 2 }
    ])
    const cands = collectOsnapCandidates({ design: d })
    const quads = ofKind(cands, 'quadrant')
    expect(quads).toHaveLength(4)
    expect(hasPointNear(quads, 0, 10, 1e-7)).toBe(true)
    expect(hasPointNear(quads, -5, 0, 1e-7)).toBe(true)
    expect(hasPointNear(quads, 0, -10, 1e-7)).toBe(true)
    expect(hasPointNear(quads, 5, 0, 1e-7)).toBe(true)
    expect(hasPointNear(ofKind(cands, 'center'), 0, 0)).toBe(true)
  })

  it('slot: exactly one candidate -- its center', () => {
    const d = designWith([
      { id: 's', kind: 'slot', cx: 5, cy: 5, length: 20, width: 6, rotation: 0 }
    ])
    const cands = collectOsnapCandidates({ design: d })
    expect(cands).toHaveLength(1)
    expect(cands[0]!.kind).toBe('center')
    expect(hasPointNear(cands, 5, 5)).toBe(true)
  })

  it('arc: endpoints, circumcenter, sweep midpoint, and only in-sweep quadrants', () => {
    const d = designWith(
      [{ id: 'arc', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }],
      { s: { x: 10, y: 0 }, v: { x: 0, y: 10 }, e: { x: -10, y: 0 } }
    )
    const cands = collectOsnapCandidates({ design: d })
    const ends = ofKind(cands, 'endpoint')
    expect(ends).toHaveLength(2)
    expect(hasPointNear(ends, 10, 0, 1e-7)).toBe(true)
    expect(hasPointNear(ends, -10, 0, 1e-7)).toBe(true)
    const centers = ofKind(cands, 'center')
    expect(centers).toHaveLength(1)
    expect(hasPointNear(centers, 0, 0, 1e-7)).toBe(true)
    const mids = ofKind(cands, 'midpoint')
    expect(mids).toHaveLength(1)
    expect(hasPointNear(mids, 0, 10, 1e-7)).toBe(true)
    // Upper semicircle sweep (0..180): only the 90-degree rim point is
    // strictly inside; 0/180 are the endpoints, 270 is off-arc.
    const quads = ofKind(cands, 'quadrant')
    expect(quads).toHaveLength(1)
    expect(hasPointNear(quads, 0, 10, 1e-7)).toBe(true)
  })

  it('open spline_fit: first/last knots are the only candidates; closed contributes none', () => {
    const open = designWith(
      [{ id: 'sf', kind: 'spline_fit', pointIds: ['a', 'b', 'c'], closed: false }],
      { a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, c: { x: 10, y: 0 } }
    )
    const openCands = collectOsnapCandidates({ design: open })
    expect(openCands).toHaveLength(2)
    expect(openCands.every((c) => c.kind === 'endpoint')).toBe(true)
    expect(hasPointNear(openCands, 0, 0, 1e-7)).toBe(true)
    expect(hasPointNear(openCands, 10, 0, 1e-7)).toBe(true)

    const closed = designWith(
      [{ id: 'sf', kind: 'spline_fit', pointIds: ['a', 'b', 'c'], closed: true }],
      { a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, c: { x: 10, y: 0 } }
    )
    expect(collectOsnapCandidates({ design: closed })).toHaveLength(0)
  })

  it('open spline_cp: endpoints are the TESSELLATED curve ends (controls are not on the curve)', () => {
    const e: SketchEntity = {
      id: 'cp',
      kind: 'spline_cp',
      pointIds: ['a', 'b', 'c', 'd'],
      closed: false
    }
    const points: Record<string, SketchPoint> = {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 10 },
      c: { x: 10, y: 10 },
      d: { x: 10, y: 0 }
    }
    const d = designWith([e], points)
    const cands = collectOsnapCandidates({ design: d })
    expect(cands).toHaveLength(2)
    const loop = splineCpPolylineFromEntity(
      e as Extract<SketchEntity, { kind: 'spline_cp' }>,
      points
    )
    expect(loop).not.toBeNull()
    const first = loop![0]!
    const last = loop![loop!.length - 1]!
    expect(hasPointNear(cands, first[0], first[1], 1e-9)).toBe(true)
    expect(hasPointNear(cands, last[0], last[1], 1e-9)).toBe(true)
    // The control polygon corners are NOT candidates.
    expect(hasPointNear(cands, 0, 0, 1e-6)).toBe(false)
  })
})

describe('collectOsnapCandidates -- intersections (sampled outlines)', () => {
  const vSeg = (id: string, x: number): SketchEntity => ({
    id,
    kind: 'polyline',
    points: [
      [x, -5],
      [x, 5]
    ],
    closed: false
  })
  const hSeg = (id: string, y: number): SketchEntity => ({
    id,
    kind: 'polyline',
    points: [
      [-5, y],
      [5, y]
    ],
    closed: false
  })

  it('two crossing segments produce ONE intersection candidate with both source ids', () => {
    const d = designWith([vSeg('A', 0), hSeg('B', 0)])
    const inters = ofKind(collectOsnapCandidates({ design: d }), 'intersection')
    expect(inters).toHaveLength(1)
    expect(inters[0]!.point[0]).toBeCloseTo(0, 9)
    expect(inters[0]!.point[1]).toBeCloseTo(0, 9)
    expect(inters[0]!.sourceEntityIds).toEqual(['A', 'B'])
  })

  it('AABB prefilter: disjoint entities contribute no intersections', () => {
    const d = designWith([
      vSeg('A', 0),
      {
        id: 'B',
        kind: 'polyline',
        points: [
          [100, 100],
          [101, 100]
        ],
        closed: false
      }
    ])
    expect(ofKind(collectOsnapCandidates({ design: d }), 'intersection')).toHaveLength(0)
  })

  it('a T-junction is NOT an intersection (the touching endpoint already snaps as endpoint)', () => {
    const d = designWith([
      {
        id: 'A',
        kind: 'polyline',
        points: [
          [0, 0],
          [10, 0]
        ],
        closed: false
      },
      {
        id: 'B',
        kind: 'polyline',
        points: [
          [5, 0],
          [5, 10]
        ],
        closed: false
      }
    ])
    expect(ofKind(collectOsnapCandidates({ design: d }), 'intersection')).toHaveLength(0)
  })

  it('circle x segment: sampled-outline crossings land near the analytic points', () => {
    // Cross at y=1 so the crossings fall strictly INSIDE sampled edges (at
    // y=0 the 48-gon has exact vertices ON the line, and vertex touches are
    // excluded by the proper-crossing rule -- see the T-junction contract).
    const wide: SketchEntity = {
      id: 'B',
      kind: 'polyline',
      points: [
        [-20, 1],
        [20, 1]
      ],
      closed: false
    }
    const d = designWith([{ id: 'C', kind: 'circle', cx: 0, cy: 0, r: 4 }, wide])
    const inters = ofKind(collectOsnapCandidates({ design: d }), 'intersection')
    expect(inters).toHaveLength(2)
    const xs = inters.map((c) => c.point[0]).sort((a, b) => a - b)
    const analytic = Math.sqrt(16 - 1)
    // 48-segment sampled circle: rim crossings land within the chord error.
    expect(Math.abs(xs[0]! + analytic)).toBeLessThan(0.15)
    expect(Math.abs(xs[1]! - analytic)).toBeLessThan(0.15)
  })

  it('the documented pair cap truncates intersections only (locals never truncated)', () => {
    const three = [vSeg('A', 0), hSeg('B', 0), vSeg('C', 2)]
    const all = collectOsnapCandidates({ design: designWith(three) })
    // A x B at (0,0) and B x C at (2,0); A and C are parallel verticals.
    expect(ofKind(all, 'intersection')).toHaveLength(2)

    const capped = collectOsnapCandidates({ design: designWith(three), intersectionPairCap: 1 })
    const inters = ofKind(capped, 'intersection')
    expect(inters).toHaveLength(1)
    expect(inters[0]!.sourceEntityIds).toEqual(['A', 'B'])
    // Endpoint/midpoint candidates survive the cap untouched.
    expect(ofKind(capped, 'endpoint')).toHaveLength(6)
    expect(ofKind(capped, 'midpoint')).toHaveLength(3)

    const zero = collectOsnapCandidates({ design: designWith(three), intersectionPairCap: 0 })
    expect(ofKind(zero, 'intersection')).toHaveLength(0)
    expect(OSNAP_INTERSECTION_PAIR_CAP).toBe(1500)
  })

  it('bbox-prefiltered pairs do not consume the cap (disjoint pairs skipped for free)', () => {
    // Order matters: A(0) and C(2) are parallel verticals whose boxes are
    // disjoint in x -- prefiltered BEFORE the cap check -- so cap=2 still
    // reaches both real crossing pairs.
    const d = designWith([vSeg('A', 0), vSeg('C', 2), hSeg('B', 0)])
    const inters = ofKind(
      collectOsnapCandidates({ design: d, intersectionPairCap: 2 }),
      'intersection'
    )
    expect(inters).toHaveLength(2)
  })
})

describe('collectOsnapCandidates -- excludeEntityIds (drag self-snap guard)', () => {
  const cross = (): SketchEntity[] => [
    {
      id: 'A',
      kind: 'polyline',
      points: [
        [0, -5],
        [0, 5]
      ],
      closed: false
    },
    {
      id: 'B',
      kind: 'polyline',
      points: [
        [-5, 0],
        [5, 0]
      ],
      closed: false
    },
    { id: 'C', kind: 'circle', cx: 30, cy: 0, r: 5 }
  ]

  it('an excluded entity contributes NO local candidates and NO intersections', () => {
    const d = designWith(cross())
    const cands = collectOsnapCandidates({ design: d, excludeEntityIds: new Set(['B']) })
    expect(cands.some((c) => c.sourceEntityIds.includes('B'))).toBe(false)
    expect(ofKind(cands, 'intersection')).toHaveLength(0)
    // A and C are untouched.
    expect(hasPointNear(ofKind(cands, 'endpoint'), 0, 5)).toBe(true)
    expect(hasPointNear(ofKind(cands, 'center'), 30, 0)).toBe(true)
  })

  it('accepts any Iterable (array works like a Set)', () => {
    const d = designWith(cross())
    const viaArray = collectOsnapCandidates({ design: d, excludeEntityIds: ['A', 'C'] })
    expect(viaArray.every((c) => c.sourceEntityIds.join() === 'B')).toBe(true)
  })

  it('the dragged entity itself never appears: exclusion removes its own endpoints', () => {
    const d = designWith(cross())
    const cands = collectOsnapCandidates({ design: d, excludeEntityIds: ['A'] })
    expect(hasPointNear(cands, 0, 5)).toBe(false)
    expect(hasPointNear(cands, 0, -5)).toBe(false)
  })
})

describe('resolveSnappedPoint -- resolution rules', () => {
  const cand = (kind: OsnapKind, x: number, y: number, ids: string[] = ['e']): OsnapCandidate => ({
    kind,
    point: [x, y],
    sourceEntityIds: ids
  })

  it('OSNAP WINS within tolerance even when the grid would snap elsewhere', () => {
    const res = resolveSnappedPoint({
      raw: [7.4, 3.2],
      candidates: [cand('endpoint', 7, 3)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res.point).toEqual([7, 3])
    expect(res.snapped?.kind).toBe('endpoint')
  })

  it('nearest candidate wins regardless of kind priority', () => {
    const res = resolveSnappedPoint({
      raw: [0.9, 0],
      candidates: [cand('endpoint', 0, 0), cand('center', 1, 0)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 2
    })
    expect(res.snapped?.kind).toBe('center')
    expect(res.point).toEqual([1, 0])
  })

  it('EXACT-distance ties resolve by priority: endpoint > midpoint > center > quadrant > intersection', () => {
    // Same point shared by two kinds (list order deliberately inverted).
    const res = resolveSnappedPoint({
      raw: [5.4, 0],
      candidates: [cand('midpoint', 5, 0), cand('endpoint', 5, 0)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res.snapped?.kind).toBe('endpoint')
    const res2 = resolveSnappedPoint({
      raw: [5.4, 0],
      candidates: [cand('intersection', 5, 0), cand('quadrant', 5, 0)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res2.snapped?.kind).toBe('quadrant')
    expect(OSNAP_KIND_RANK.endpoint).toBeLessThan(OSNAP_KIND_RANK.midpoint)
    expect(OSNAP_KIND_RANK.midpoint).toBeLessThan(OSNAP_KIND_RANK.center)
    expect(OSNAP_KIND_RANK.center).toBeLessThan(OSNAP_KIND_RANK.quadrant)
    expect(OSNAP_KIND_RANK.quadrant).toBeLessThan(OSNAP_KIND_RANK.intersection)
  })

  it('tolerance boundary is inclusive: exactly AT tolerance snaps, just beyond falls to grid', () => {
    const at = resolveSnappedPoint({
      raw: [10.5, 0],
      candidates: [cand('endpoint', 10, 0)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 0.5
    })
    expect(at.snapped?.kind).toBe('endpoint')
    const beyond = resolveSnappedPoint({
      raw: [10.5000001, 0],
      candidates: [cand('endpoint', 10, 0)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 0.5
    })
    expect(beyond.snapped).toBeNull()
    expect(beyond.point).toEqual([10, 0])
  })

  it('osnapEnabled=false ignores candidates: pure grid lattice (byte-parity with snap())', () => {
    const res = resolveSnappedPoint({
      raw: [7.4, 3.2],
      candidates: [cand('endpoint', 7, 3)],
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: false,
      toleranceMm: 1
    })
    expect(res.snapped).toBeNull()
    expect(res.point).toEqual([snap(7.4, 5), snap(3.2, 5)])
    expect(res.point).toEqual([5, 5])
  })

  it('grid off + osnap miss = raw passthrough; both off = raw passthrough', () => {
    const miss = resolveSnappedPoint({
      raw: [7.4, 3.2],
      candidates: [],
      gridMm: 5,
      gridEnabled: false,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(miss.snapped).toBeNull()
    expect(miss.point).toEqual([7.4, 3.2])
    const bothOff = resolveSnappedPoint({
      raw: [7.4, 3.2],
      candidates: [cand('endpoint', 100, 100)],
      gridMm: 5,
      gridEnabled: false,
      osnapEnabled: false,
      toleranceMm: 1
    })
    expect(bothOff.point).toEqual([7.4, 3.2])
  })

  it('toggles are independent: grid OFF while osnap ON still snaps to candidates', () => {
    const res = resolveSnappedPoint({
      raw: [7.4, 3.2],
      candidates: [cand('midpoint', 7, 3)],
      gridMm: 5,
      gridEnabled: false,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res.snapped?.kind).toBe('midpoint')
    expect(res.point).toEqual([7, 3])
  })
})

describe('resolveDragDeltaWithOsnap -- drag end-point resolution', () => {
  const cand = (kind: OsnapKind, x: number, y: number): OsnapCandidate => ({
    kind,
    point: [x, y],
    sourceEntityIds: ['other']
  })

  it('osnap hit: delta is EXACT candidate minus start (no lattice rounding)', () => {
    const res = resolveDragDeltaWithOsnap({
      startWorld: [3, 4],
      rawEndWorld: [19.8, 10.3],
      candidates: [cand('endpoint', 20, 10)],
      gridMm: 5,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res.snapped?.kind).toBe('endpoint')
    expect(res.deltaMm[0]).toBeCloseTo(17, 12)
    expect(res.deltaMm[1]).toBeCloseTo(6, 12)
  })

  it('osnap miss: falls back to the S1 lattice delta byte-for-byte (snappedDragDelta)', () => {
    const start: [number, number] = [1.2, 3.4]
    const end: [number, number] = [11.7, 9.1]
    const res = resolveDragDeltaWithOsnap({
      startWorld: start,
      rawEndWorld: end,
      candidates: [],
      gridMm: 5,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res.snapped).toBeNull()
    expect(res.deltaMm).toEqual(snappedDragDelta(start, end, 5))
    expect(res.deltaMm).toEqual([10, 5])
  })

  it('osnapEnabled=false: identical to the S1 path even with candidates in range', () => {
    const res = resolveDragDeltaWithOsnap({
      startWorld: [0, 0],
      rawEndWorld: [19.9, 0.2],
      candidates: [cand('endpoint', 20, 0)],
      gridMm: 5,
      osnapEnabled: false,
      toleranceMm: 1
    })
    expect(res.snapped).toBeNull()
    expect(res.deltaMm).toEqual(snappedDragDelta([0, 0], [19.9, 0.2], 5))
  })
})

describe('aperture, labels, helpers', () => {
  it('osnapToleranceMm converts the px aperture at the current zoom with the scale floor', () => {
    expect(OSNAP_PICK_PX).toBe(10)
    expect(osnapToleranceMm(2)).toBe(5)
    expect(osnapToleranceMm(10)).toBe(1)
    expect(osnapToleranceMm(0.01)).toBe(200)
  })

  it('osnapKindLabel covers every kind', () => {
    expect(osnapKindLabel('endpoint')).toBe('Endpoint')
    expect(osnapKindLabel('midpoint')).toBe('Midpoint')
    expect(osnapKindLabel('center')).toBe('Center')
    expect(osnapKindLabel('quadrant')).toBe('Quadrant')
    expect(osnapKindLabel('intersection')).toBe('Intersection')
  })

  it('segmentProperIntersection: crossing yields the point; touches and parallels yield null', () => {
    expect(segmentProperIntersection(0, -5, 0, 5, -5, 0, 5, 0)).toEqual([0, 0])
    // Endpoint touch (T-junction).
    expect(segmentProperIntersection(0, 0, 10, 0, 5, 0, 5, 10)).toBeNull()
    // Parallel.
    expect(segmentProperIntersection(0, 0, 10, 0, 0, 1, 10, 1)).toBeNull()
    // Collinear overlap.
    expect(segmentProperIntersection(0, 0, 10, 0, 2, 0, 8, 0)).toBeNull()
  })

  it('a midpoint/quadrant coincidence on a real arc resolves to the midpoint (rank wins)', () => {
    const d = designWith(
      [{ id: 'arc', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }],
      { s: { x: 10, y: 0 }, v: { x: 0, y: 10 }, e: { x: -10, y: 0 } }
    )
    const cands = collectOsnapCandidates({ design: d })
    const res = resolveSnappedPoint({
      raw: [0.2, 10.1],
      candidates: cands,
      gridMm: 5,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: 1
    })
    expect(res.snapped?.kind).toBe('midpoint')
    expect(res.point[0]).toBeCloseTo(0, 7)
    expect(res.point[1]).toBeCloseTo(10, 7)
  })
})
