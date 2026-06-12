/**
 * Sketch S3 -- pure unit contracts for the marquee box-select resolver
 * (sketch2d-marquee.ts): AutoCAD window vs crossing semantics over the SAME
 * entityOutlineWorld tessellation the canvas renders, exercised on every
 * entity kind, plus the geometry primitives (mode-from-direction, box
 * normalization, Liang-Barsky segment-vs-box).
 *
 * Node-SSR pure units per the repo convention -- no DOM, no canvas.
 */
import { describe, expect, it } from 'vitest'
import type { DesignFileV2, SketchEntity, SketchPoint } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import {
  entitiesInBox,
  marqueeBoxFromCorners,
  marqueeModeForDrag,
  segmentIntersectsBox,
  type MarqueeBox
} from '../sketch2d-marquee'

function designWith(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

function box(minX: number, minY: number, maxX: number, maxY: number): MarqueeBox {
  return { minX, minY, maxX, maxY }
}

const ids = (design: DesignFileV2, b: MarqueeBox, mode: 'window' | 'crossing'): string[] =>
  entitiesInBox({ design, box: b, mode })

describe('marqueeModeForDrag -- the AutoCAD direction rule', () => {
  it('left -> right = window; right -> left = crossing; vertical tie = window', () => {
    expect(marqueeModeForDrag([0, 0], [10, 2])).toBe('window')
    expect(marqueeModeForDrag([10, 0], [0, 2])).toBe('crossing')
    expect(marqueeModeForDrag([5, 0], [5, 10])).toBe('window')
  })
})

describe('marqueeBoxFromCorners -- normalization', () => {
  it('normalizes any corner pair to min/max', () => {
    expect(marqueeBoxFromCorners([10, 2], [-3, 8])).toEqual({
      minX: -3,
      minY: 2,
      maxX: 10,
      maxY: 8
    })
    expect(marqueeBoxFromCorners([1, 9], [4, 3])).toEqual({ minX: 1, minY: 3, maxX: 4, maxY: 9 })
  })
})

describe('segmentIntersectsBox -- Liang-Barsky against the CLOSED box', () => {
  const b = box(0, 0, 10, 10)
  it('detects a pass-through whose endpoints are BOTH outside', () => {
    expect(segmentIntersectsBox(-5, 5, 15, 5, b)).toBe(true)
  })
  it('counts a single-point corner touch', () => {
    expect(segmentIntersectsBox(-1, 1, 1, -1, b)).toBe(true)
  })
  it('counts a collinear graze ALONG a box edge', () => {
    expect(segmentIntersectsBox(-5, 0, 15, 0, b)).toBe(true)
  })
  it('rejects a parallel segment strictly outside the slab', () => {
    expect(segmentIntersectsBox(-5, -1, 15, -1, b)).toBe(false)
  })
  it('accepts a segment fully INSIDE the box', () => {
    expect(segmentIntersectsBox(2, 2, 3, 3, b)).toBe(true)
  })
  it('rejects disjoint segments (far and near-miss diagonals)', () => {
    expect(segmentIntersectsBox(20, 20, 30, 30, b)).toBe(false)
    expect(segmentIntersectsBox(11, 0, 20, 9, b)).toBe(false)
  })
  it('a zero-length segment degrades to the inclusive point test', () => {
    expect(segmentIntersectsBox(5, 5, 5, 5, b)).toBe(true)
    expect(segmentIntersectsBox(10, 10, 10, 10, b)).toBe(true)
    expect(segmentIntersectsBox(11, 5, 11, 5, b)).toBe(false)
  })
})

interface KindCase {
  label: string
  entity: SketchEntity
  points?: Record<string, SketchPoint>
  /** Box fully containing the sampled outline. */
  full: MarqueeBox
  /** Box overlapping PART of the outline (clips it). */
  partial: MarqueeBox
}

const KIND_CASES: KindCase[] = [
  {
    label: 'rect',
    entity: { id: 'k', kind: 'rect', cx: 5, cy: 5, w: 10, h: 10, rotation: 0 },
    full: box(-1, -1, 11, 11),
    partial: box(-1, -1, 5, 11)
  },
  {
    label: 'circle',
    entity: { id: 'k', kind: 'circle', cx: 30, cy: 5, r: 5 },
    full: box(24, -1, 36, 11),
    partial: box(24, -1, 30, 11)
  },
  {
    label: 'ellipse',
    entity: { id: 'k', kind: 'ellipse', cx: 50, cy: 5, rx: 6, ry: 3, rotation: 0 },
    full: box(43, 1, 57, 9),
    partial: box(43, 1, 50, 9)
  },
  {
    label: 'slot',
    entity: { id: 'k', kind: 'slot', cx: 70, cy: 5, length: 10, width: 6, rotation: 0 },
    full: box(61, 1, 79, 9),
    partial: box(61, 1, 70, 9)
  },
  {
    label: 'open polyline',
    entity: { id: 'k', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false },
    points: { a: { x: 90, y: 0 }, b: { x: 100, y: 0 }, c: { x: 100, y: 10 } },
    full: box(89, -1, 101, 11),
    partial: box(89, -1, 95, 1)
  },
  {
    label: 'closed polyline',
    entity: { id: 'k', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true },
    points: { a: { x: 90, y: 0 }, b: { x: 100, y: 0 }, c: { x: 95, y: 10 } },
    full: box(89, -1, 101, 11),
    partial: box(89, -1, 95, 11)
  },
  {
    label: 'legacy inline-points polyline',
    entity: {
      id: 'k',
      kind: 'polyline',
      points: [
        [0, 20],
        [10, 20],
        [10, 30]
      ] as [number, number][],
      closed: false
    },
    full: box(-1, 19, 11, 31),
    partial: box(-1, 19, 5, 31)
  },
  {
    label: 'arc (3pt)',
    entity: { id: 'k', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' },
    points: { s: { x: 110, y: 0 }, v: { x: 115, y: 5 }, e: { x: 120, y: 0 } },
    full: box(109, -1, 121, 6),
    partial: box(109, -1, 115, 6)
  },
  {
    label: 'spline (fit)',
    entity: { id: 'k', kind: 'spline_fit', pointIds: ['f1', 'f2', 'f3'], closed: false },
    points: { f1: { x: 130, y: 0 }, f2: { x: 135, y: 5 }, f3: { x: 140, y: 0 } },
    full: box(125, -5, 145, 10),
    partial: box(125, -5, 135, 10)
  },
  {
    label: 'spline (control)',
    entity: { id: 'k', kind: 'spline_cp', pointIds: ['g1', 'g2', 'g3', 'g4'], closed: false },
    points: {
      g1: { x: 150, y: 0 },
      g2: { x: 155, y: 5 },
      g3: { x: 160, y: 5 },
      g4: { x: 165, y: 0 }
    },
    full: box(149, -1, 166, 6),
    partial: box(149, -1, 157, 6)
  }
]

describe('entitiesInBox -- window vs crossing on every entity kind', () => {
  for (const kc of KIND_CASES) {
    it(`${kc.label}: window only when FULLY inside; crossing on any touch`, () => {
      const d = designWith([kc.entity], kc.points ?? {})
      // Fully containing box: both modes select.
      expect(ids(d, kc.full, 'window')).toEqual(['k'])
      expect(ids(d, kc.full, 'crossing')).toEqual(['k'])
      // Partially-overlapping box: window excludes, crossing includes.
      expect(ids(d, kc.partial, 'window')).toEqual([])
      expect(ids(d, kc.partial, 'crossing')).toEqual(['k'])
      // Fully-disjoint box: neither mode selects.
      expect(ids(d, box(500, 500, 510, 510), 'window')).toEqual([])
      expect(ids(d, box(500, 500, 510, 510), 'crossing')).toEqual([])
    })
  }

  it('a CLOSED arc exposes its chord as a crossing edge (closed-wrap segment)', () => {
    const points = { s: { x: 110, y: 5 }, v: { x: 115, y: 0 }, e: { x: 120, y: 5 } }
    // A sliver box straddling ONLY the chord (the sampled arc dips to y ~ 0).
    const chordBox = box(114, 4.5, 116, 5.5)
    const open = designWith(
      [{ id: 'k', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }],
      points
    )
    const closed = designWith(
      [{ id: 'k', kind: 'arc', startId: 's', viaId: 'v', endId: 'e', closed: true }],
      points
    )
    expect(ids(open, chordBox, 'crossing')).toEqual([])
    expect(ids(closed, chordBox, 'crossing')).toEqual(['k'])
  })
})

describe('entitiesInBox -- box-edge grazing (inclusive boundary)', () => {
  it('a rect whose outline lies EXACTLY on the box boundary window-selects', () => {
    const d = designWith([{ id: 'r', kind: 'rect', cx: 5, cy: 5, w: 10, h: 10, rotation: 0 }])
    expect(ids(d, box(0, 0, 10, 10), 'window')).toEqual(['r'])
    expect(ids(d, box(0, 0, 10, 10), 'crossing')).toEqual(['r'])
  })

  it('a circle tangent to the box edge from OUTSIDE crossing-selects, never window-selects', () => {
    // ELLIPSE_PROFILE_SEGMENTS is even, so the angle-pi sample lands exactly
    // on the tangent point (10, ~5) ON the box edge x = 10 (inclusive).
    const d = designWith([{ id: 'c', kind: 'circle', cx: 15, cy: 5, r: 5 }])
    expect(ids(d, box(0, 0, 10, 10), 'crossing')).toEqual(['c'])
    expect(ids(d, box(0, 0, 10, 10), 'window')).toEqual([])
  })
})

describe('entitiesInBox -- degenerate boxes and degenerate outlines', () => {
  it('zero-area box: window matches nothing real; crossing only outlines through the point', () => {
    const zero = marqueeBoxFromCorners([5, 5], [5, 5])
    const d = designWith(
      [
        { id: 'vertexAt', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false },
        { id: 'through', kind: 'polyline', pointIds: ['d', 'e'], closed: false },
        { id: 'far', kind: 'circle', cx: 30, cy: 30, r: 2 }
      ],
      {
        a: { x: 0, y: 0 },
        b: { x: 5, y: 5 },
        c: { x: 10, y: 0 },
        d: { x: 0, y: 0 },
        e: { x: 10, y: 10 }
      }
    )
    expect(ids(d, zero, 'window')).toEqual([])
    expect(ids(d, zero, 'crossing')).toEqual(['vertexAt', 'through'])
  })

  it('an invalid (NaN / inverted) box selects nothing in either mode', () => {
    const d = designWith([{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }])
    expect(ids(d, box(Number.NaN, 0, 10, 10), 'crossing')).toEqual([])
    expect(ids(d, box(Number.NaN, 0, 10, 10), 'window')).toEqual([])
    expect(ids(d, { minX: 10, minY: 0, maxX: 0, maxY: 10 }, 'crossing')).toEqual([])
  })

  it('entities with a degenerate outline are never selected (and never throw)', () => {
    const d = designWith(
      [
        // spline_fit referencing missing points -> null tessellation -> skipped.
        { id: 'ghost', kind: 'spline_fit', pointIds: ['m1', 'm2', 'm3'], closed: false },
        // 1-point legacy polyline -> < 2 resolvable vertices -> skipped.
        { id: 'dot', kind: 'polyline', points: [[2, 2]] as [number, number][], closed: false },
        { id: 'real', kind: 'circle', cx: 0, cy: 0, r: 2 }
      ]
    )
    const huge = box(-100, -100, 100, 100)
    expect(ids(d, huge, 'window')).toEqual(['real'])
    expect(ids(d, huge, 'crossing')).toEqual(['real'])
  })
})

describe('entitiesInBox -- rotated entities resolve against the ROTATED outline', () => {
  it('rect at 45 deg: the box that window-selects it unrotated misses its corners', () => {
    const flat = designWith([{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }])
    const tilted = designWith([
      { id: 'r', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: Math.PI / 4 }
    ])
    const b = box(-6, -6, 6, 6)
    expect(ids(flat, b, 'window')).toEqual(['r'])
    // Rotated corners land at ~(0, +/-7.07) -- outside the same box.
    expect(ids(tilted, b, 'window')).toEqual([])
    expect(ids(tilted, b, 'crossing')).toEqual(['r'])
    expect(ids(tilted, box(-8, -8, 8, 8), 'window')).toEqual(['r'])
  })

  it('ellipse rotated 90 deg fits a tall box its unrotated extents would overflow', () => {
    const tall = box(-3, -7, 3, 7)
    const flat = designWith([{ id: 'e', kind: 'ellipse', cx: 0, cy: 0, rx: 6, ry: 2, rotation: 0 }])
    const turned = designWith([
      { id: 'e', kind: 'ellipse', cx: 0, cy: 0, rx: 6, ry: 2, rotation: Math.PI / 2 }
    ])
    expect(ids(flat, tall, 'window')).toEqual([])
    expect(ids(turned, tall, 'window')).toEqual(['e'])
  })
})

describe('entitiesInBox -- result ordering', () => {
  it('returns ids in design (draw) order regardless of geometry', () => {
    const d = designWith([
      { id: 'first', kind: 'circle', cx: 0, cy: 0, r: 2 },
      { id: 'second', kind: 'rect', cx: 0, cy: 0, w: 2, h: 2, rotation: 0 }
    ])
    expect(ids(d, box(-5, -5, 5, 5), 'window')).toEqual(['first', 'second'])
    expect(ids(d, box(-5, -5, 5, 5), 'crossing')).toEqual(['first', 'second'])
  })
})
