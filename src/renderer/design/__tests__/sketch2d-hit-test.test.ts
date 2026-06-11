/**
 * Sketch S1 -- unit pins for the pure select-tool hit-test resolver.
 *
 * Every entity kind the schema can hold gets a pick + a miss; closed shapes
 * additionally prove the CAD outline-not-fill convention (a click in the
 * middle of a closed shape selects NOTHING). Tie-breaking, the inclusive
 * tolerance boundary, degenerate entities, and the drag-delta helpers are
 * pinned here too -- these are the load-bearing halves of the canvas's
 * select/drag behavior that node-SSR render tests cannot click.
 */
import { describe, expect, it } from 'vitest'
import type { DesignFileV2, SketchEntity, SketchPoint } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import { regularPolygonVertices } from '../../../shared/sketch-profile'
import {
  dragExceedsThreshold,
  entityOutlineWorld,
  hitTestSketchEntities,
  SELECT_DRAG_THRESHOLD_PX,
  SELECT_PICK_PX,
  selectPickToleranceMm,
  snappedDragDelta
} from '../sketch2d-hit-test'

function makeDesign(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

function hit(design: DesignFileV2, x: number, y: number, tol: number): string | null {
  return hitTestSketchEntities({ design, worldPoint: [x, y], toleranceMm: tol })?.entityId ?? null
}

describe('hitTestSketchEntities -- per-kind pick + outline-not-fill', () => {
  it('returns null for an empty design', () => {
    expect(hit(makeDesign([]), 0, 0, 100)).toBeNull()
  })

  it('open polyline (line tool product): hits near the segment, misses beyond tolerance', () => {
    const d = makeDesign(
      [{ id: 'ln', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    )
    expect(hit(d, 5, 1, 2)).toBe('ln')
    expect(hit(d, 5, 3, 2)).toBeNull()
    // No closing edge on an open polyline: beyond endpoint B the pick falls off.
    expect(hit(d, 14, 0, 2)).toBeNull()
  })

  it('tolerance boundary is INCLUSIVE (d == tol hits; just over misses)', () => {
    const d = makeDesign(
      [{ id: 'ln', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    )
    expect(hit(d, 5, 2, 2)).toBe('ln')
    expect(hit(d, 5, 2.0001, 2)).toBeNull()
  })

  it('closed polyline: the closing edge participates; the interior does NOT', () => {
    const d = makeDesign(
      [{ id: 'tri', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: 10 } }
    )
    // Closing edge c->a lies on x = 0.
    expect(hit(d, -1, 5, 2)).toBe('tri')
    // Interior point, all edges > 1 mm away -- outline only, no fill pick.
    expect(hit(d, 3, 3, 1)).toBeNull()
  })

  it('legacy inline-points polyline (v1 + text-derived letter outlines) hits', () => {
    const d = makeDesign([{ id: 'leg', kind: 'polyline', points: [[0, 0], [10, 0]], closed: false }])
    expect(hit(d, 5, 0.5, 1)).toBe('leg')
    expect(hit(d, 5, 2, 1)).toBeNull()
  })

  it('rect: edge hits, center (fill) misses', () => {
    const d = makeDesign([{ id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }])
    expect(hit(d, 0, 5.5, 1)).toBe('r1')
    expect(hit(d, 10.4, 0, 1)).toBe('r1')
    expect(hit(d, 0, 0, 4)).toBeNull()
  })

  it('rotated rect: hits follow the rotated outline', () => {
    const rot = Math.PI / 2
    const d = makeDesign([{ id: 'r2', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: rot }])
    // After 90 deg the half-extent along +X is h/2 = 5.
    expect(hit(d, 5.5, 0, 1)).toBe('r2')
    expect(hit(d, 9, 0, 1)).toBeNull()
  })

  it('circle: rim hits from outside and inside, center misses', () => {
    const d = makeDesign([{ id: 'c1', kind: 'circle', cx: 50, cy: 0, r: 10 }])
    expect(hit(d, 61, 0, 1.5)).toBe('c1')
    expect(hit(d, 59.2, 0, 1)).toBe('c1')
    expect(hit(d, 50, 0, 5)).toBeNull()
  })

  it('ellipse: major-vertex hit; center misses; rotation respected', () => {
    const d = makeDesign([{ id: 'e1', kind: 'ellipse', cx: 0, cy: 0, rx: 20, ry: 10, rotation: 0 }])
    expect(hit(d, 20.5, 0, 1)).toBe('e1')
    expect(hit(d, 0, 0, 5)).toBeNull()
    const rot = makeDesign([
      { id: 'e2', kind: 'ellipse', cx: 0, cy: 0, rx: 20, ry: 10, rotation: Math.PI / 2 }
    ])
    expect(hit(rot, 0, 20.5, 1)).toBe('e2')
    expect(hit(rot, 20.5, 0, 1)).toBeNull()
  })

  it('arc (3-pt): hits on the sampled arc; the chord is NOT pickable while open', () => {
    const pts = { s: { x: 10, y: 0 }, v: { x: 0, y: 10 }, e: { x: -10, y: 0 } }
    const open = makeDesign(
      [{ id: 'a1', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }],
      pts
    )
    expect(hit(open, 0, 10.5, 1)).toBe('a1')
    // Chord midpoint (0, 0.5): only 0.5 mm from the s->e chord but ~9.5 mm
    // from the arc itself -- an OPEN arc must not pick on its chord.
    expect(hit(open, 0, 0.5, 1)).toBeNull()
  })

  it('arc closed profile: the chord IS the closing edge and picks', () => {
    const pts = { s: { x: 10, y: 0 }, v: { x: 0, y: 10 }, e: { x: -10, y: 0 } }
    const closed = makeDesign(
      [{ id: 'a2', kind: 'arc', startId: 's', viaId: 'v', endId: 'e', closed: true }],
      pts
    )
    expect(hit(closed, 0, 0.5, 1)).toBe('a2')
  })

  it('regular polygon (closed polyline storage): edge midpoint hits, centroid misses', () => {
    const verts = regularPolygonVertices(0, 0, 10, 0, 6)
    const points: Record<string, SketchPoint> = {}
    const ids = verts.map((v, i) => {
      points[`p${i}`] = { x: v[0], y: v[1] }
      return `p${i}`
    })
    const d = makeDesign([{ id: 'hex', kind: 'polyline', pointIds: ids, closed: true }], points)
    const mx = (verts[0]![0] + verts[1]![0]) / 2
    const my = (verts[0]![1] + verts[1]![1]) / 2
    expect(hit(d, mx, my, 0.5)).toBe('hex')
    expect(hit(d, 0, 0, 2)).toBeNull()
  })

  it('slot: flank and cap rim hit, the stadium interior misses', () => {
    const d = makeDesign([
      { id: 's1', kind: 'slot', cx: 0, cy: 0, length: 20, width: 10, rotation: 0 }
    ])
    expect(hit(d, 0, 5.4, 1)).toBe('s1')
    expect(hit(d, 15.5, 0, 1)).toBe('s1')
    expect(hit(d, 0, 0, 3)).toBeNull()
  })

  it('spline_fit interpolates its knots: a knot-adjacent click hits', () => {
    const d = makeDesign(
      [{ id: 'sf', kind: 'spline_fit', pointIds: ['k0', 'k1', 'k2'] }],
      { k0: { x: 0, y: 0 }, k1: { x: 10, y: 0 }, k2: { x: 20, y: 0 } }
    )
    expect(hit(d, 10, 0.5, 1)).toBe('sf')
    expect(hit(d, 10, 3, 1)).toBeNull()
  })

  it('spline_cp approximates: the curve (not the control polygon ends) is what picks', () => {
    const d = makeDesign(
      [{ id: 'sc', kind: 'spline_cp', pointIds: ['c0', 'c1', 'c2', 'c3'] }],
      {
        c0: { x: 0, y: 0 },
        c1: { x: 10, y: 0 },
        c2: { x: 20, y: 0 },
        c3: { x: 30, y: 0 }
      }
    )
    // Collinear controls: the cubic B-spline spans x in [10, 20] on y = 0.
    expect(hit(d, 15, 0.5, 1)).toBe('sc')
    // The first CONTROL point is ~10 mm off the curve start -- no pick there.
    expect(hit(d, 0, 0, 1)).toBeNull()
  })

  it('degenerate entities (missing point ids) are skipped without throwing', () => {
    const d = makeDesign([
      { id: 'bad', kind: 'arc', startId: 'missing1', viaId: 'missing2', endId: 'missing3' },
      { id: 'sfbad', kind: 'spline_fit', pointIds: ['m1', 'm2', 'm3'] }
    ])
    expect(hit(d, 0, 0, 100)).toBeNull()
  })

  it('guards: non-positive / non-finite tolerance and non-finite point return null', () => {
    const d = makeDesign([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }])
    expect(hitTestSketchEntities({ design: d, worldPoint: [10, 0], toleranceMm: 0 })).toBeNull()
    expect(hitTestSketchEntities({ design: d, worldPoint: [10, 0], toleranceMm: Number.NaN })).toBeNull()
    expect(hitTestSketchEntities({ design: d, worldPoint: [Number.NaN, 0], toleranceMm: 1 })).toBeNull()
  })
})

describe('hitTestSketchEntities -- tie-breaking', () => {
  it('smallest distance wins regardless of array order', () => {
    const d = makeDesign([
      { id: 'near', kind: 'circle', cx: 0, cy: 0, r: 10 },
      { id: 'far', kind: 'circle', cx: 0, cy: 0, r: 12 }
    ])
    // Click at 10.2: 0.2 from `near`, 1.8 from `far` -- near wins though it is first.
    expect(hit(d, 10.2, 0, 2)).toBe('near')
    // Click at 11.8: 1.8 vs 0.2 -- far wins.
    expect(hit(d, 11.8, 0, 2)).toBe('far')
  })

  it('an EXACT tie picks the topmost (last-in-array) entity', () => {
    const d = makeDesign([
      { id: 'under', kind: 'circle', cx: 0, cy: 0, r: 10 },
      { id: 'over', kind: 'circle', cx: 0, cy: 0, r: 10 }
    ])
    expect(hit(d, 10.3, 0, 1)).toBe('over')
  })
})

describe('entityOutlineWorld -- shared outline extractor', () => {
  it('rect yields the 4 world corners, closed', () => {
    const o = entityOutlineWorld(
      { id: 'r', kind: 'rect', cx: 5, cy: 5, w: 10, h: 4, rotation: 0 },
      {}
    )
    expect(o).not.toBeNull()
    expect(o!.closed).toBe(true)
    expect(o!.pts).toHaveLength(4)
    expect(o!.pts[0]).toEqual([0, 3])
  })

  it('open arc outline is open; closed arc outline closes (chord)', () => {
    const points = { s: { x: 10, y: 0 }, v: { x: 0, y: 10 }, e: { x: -10, y: 0 } }
    const open = entityOutlineWorld(
      { id: 'a', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' },
      points
    )
    const closed = entityOutlineWorld(
      { id: 'a', kind: 'arc', startId: 's', viaId: 'v', endId: 'e', closed: true },
      points
    )
    expect(open!.closed).toBe(false)
    expect(closed!.closed).toBe(true)
  })

  it('degenerate polyline (single resolvable point) yields null', () => {
    const o = entityOutlineWorld(
      { id: 'p', kind: 'polyline', pointIds: ['only'], closed: false },
      { only: { x: 1, y: 1 } }
    )
    expect(o).toBeNull()
  })
})

describe('select-tool drag helpers', () => {
  it('snappedDragDelta snaps each axis of the TOTAL delta to the lattice', () => {
    expect(snappedDragDelta([1.2, 3.4], [11.7, 9.1], 5)).toEqual([10, 5])
    expect(snappedDragDelta([0, 0], [2.4, 2.6], 5)).toEqual([0, 5])
  })

  it('snappedDragDelta with snap off (step <= 0) passes the raw delta through', () => {
    const [dx, dy] = snappedDragDelta([1, 1], [2.25, 3.5], 0)
    expect(dx).toBeCloseTo(1.25, 10)
    expect(dy).toBeCloseTo(2.5, 10)
  })

  it('selectPickToleranceMm is the px aperture over the zoom scale, clamped', () => {
    expect(selectPickToleranceMm(2.5)).toBeCloseTo(SELECT_PICK_PX / 2.5, 10)
    expect(selectPickToleranceMm(0)).toBeCloseTo(SELECT_PICK_PX / 0.05, 10)
  })

  it('dragExceedsThreshold converts world motion to screen px before comparing', () => {
    // 1 mm at 2.5 px/mm = 2.5 px < 3 px threshold -> still a click.
    expect(dragExceedsThreshold([0, 0], [1, 0], 2.5)).toBe(false)
    // 1.3 mm at 2.5 px/mm = 3.25 px > 3 px -> a drag.
    expect(dragExceedsThreshold([0, 0], [1.3, 0], 2.5)).toBe(true)
    expect(SELECT_DRAG_THRESHOLD_PX).toBe(3)
  })
})
