import { describe, expect, it } from 'vitest'
import {
  contourPointSignature,
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign
} from './cam-2d-derive'
import { emptyDesign, type DesignFileV2 } from './design-schema'

describe('cam-2d-derive', () => {
  it('derives contour points from first closed profile', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'p1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }],
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 5 } }
    }
    const pts = deriveContourPointsFromDesign(d)
    expect(pts.length).toBe(3)
    expect(pts[1]).toEqual([10, 0])
  })

  it('supports selecting contour source by id', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'p1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true },
        { id: 'p2', kind: 'polyline', pointIds: ['d', 'e', 'f'], closed: true }
      ],
      points: {
        a: { x: 0, y: 0 },
        b: { x: 10, y: 0 },
        c: { x: 0, y: 5 },
        d: { x: 20, y: 20 },
        e: { x: 30, y: 20 },
        f: { x: 20, y: 25 }
      }
    }
    const picked = deriveContourPointsFromDesign(d, 'p2')
    expect(picked[0]).toEqual([20, 20])
  })

  it('lists contour candidates from closed sketch entities', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'r1', kind: 'rect', cx: 5, cy: 5, w: 4, h: 2, rotation: 0 },
        { id: 'c1', kind: 'circle', cx: 10, cy: 10, r: 2 }
      ]
    }
    const cands = listContourCandidatesFromDesign(d)
    expect(cands.some((c) => c.sourceId === 'r1')).toBe(true)
    expect(cands.some((c) => c.sourceId === 'c1')).toBe(true)
    expect(cands.every((c) => c.signature.length > 0)).toBe(true)
  })

  it('lists slot as contour candidate', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 's1', kind: 'slot', cx: 0, cy: 0, length: 12, width: 4, rotation: 0 }]
    }
    const cands = listContourCandidatesFromDesign(d)
    const s = cands.find((c) => c.sourceId === 's1')
    expect(s).toBeDefined()
    expect(s!.points.length).toBeGreaterThanOrEqual(8)
  })

  it('builds stable signatures with rounded precision', () => {
    const a = contourPointSignature([
      [1.0004, 2],
      [3, 4]
    ])
    const b = contourPointSignature([
      [1.00049, 2],
      [3, 4]
    ])
    expect(a).toBe(b)
  })

  it('derives drill points from circle centers', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'c1', kind: 'circle', cx: 5, cy: 6, r: 1 },
        { id: 'c2', kind: 'circle', cx: 7, cy: 8, r: 1.5 }
      ]
    }
    expect(deriveDrillPointsFromDesign(d)).toEqual([
      [5, 6],
      [7, 8]
    ])
  })
})

describe('cam-2d-derive — edge cases', () => {
  it('deriveContourPointsFromDesign returns [] when design has no valid contour entities', () => {
    // emptyDesign has no entities; no candidates → empty array
    expect(deriveContourPointsFromDesign(emptyDesign())).toEqual([])
  })

  it('deriveContourPointsFromDesign returns [] when only open polylines exist', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'p1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false }],
      points: { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, c: { x: 5, y: 5 } }
    }
    expect(deriveContourPointsFromDesign(d)).toEqual([])
  })

  it('deriveContourPointsFromDesign falls back to first candidate when sourceId not found', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 5, rotation: 0 },
        { id: 'r2', kind: 'rect', cx: 20, cy: 20, w: 4, h: 4, rotation: 0 }
      ]
    }
    const fallback = deriveContourPointsFromDesign(d, 'nonexistent-id')
    const first = deriveContourPointsFromDesign(d)
    // When sourceId is not found, implementation returns first candidate's points
    expect(fallback).toEqual(first)
    expect(fallback.length).toBeGreaterThan(0)
  })

  it('deriveDrillPointsFromDesign returns [] when design has no circles', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 5, rotation: 0 }]
    }
    expect(deriveDrillPointsFromDesign(d)).toEqual([])
  })

  it('deriveDrillPointsFromDesign returns [] for empty design', () => {
    expect(deriveDrillPointsFromDesign(emptyDesign())).toEqual([])
  })

  it('listContourCandidatesFromDesign returns [] for empty design', () => {
    expect(listContourCandidatesFromDesign(emptyDesign())).toEqual([])
  })

  it('listContourCandidatesFromDesign skips open polylines (< 3 pts or not closed)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'open', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false },
        { id: 'short', kind: 'polyline', pointIds: ['a', 'b'], closed: true }
      ],
      points: { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, c: { x: 5, y: 5 } }
    }
    expect(listContourCandidatesFromDesign(d)).toEqual([])
  })

  it('contourPointSignature differs for different coordinates', () => {
    const a = contourPointSignature([[0, 0], [1, 0]])
    const b = contourPointSignature([[0, 0], [2, 0]])
    expect(a).not.toBe(b)
  })

  it('listContourCandidatesFromDesign includes closed arc entity as candidate', () => {
    // Three non-collinear points forming an arc (semicircle on a circle of radius ~7.07)
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'arc1', kind: 'arc', startId: 's', viaId: 'v', endId: 'e', closed: true }
      ],
      points: { s: { x: 0, y: 0 }, v: { x: 5, y: 5 }, e: { x: 10, y: 0 } }
    }
    const cands = listContourCandidatesFromDesign(d)
    const a = cands.find((c) => c.sourceId === 'arc1')
    expect(a).toBeDefined()
    expect(a!.points.length).toBeGreaterThanOrEqual(3)
    expect(a!.label).toMatch(/arc/i)
  })

  it('listContourCandidatesFromDesign skips open arc entity', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'arc2', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }
      ],
      points: { s: { x: 0, y: 0 }, v: { x: 5, y: 5 }, e: { x: 10, y: 0 } }
    }
    expect(listContourCandidatesFromDesign(d)).toEqual([])
  })

  it('listContourCandidatesFromDesign includes ellipse entity as candidate', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'ell1', kind: 'ellipse', cx: 5, cy: 5, rx: 4, ry: 2, rotation: 0 }
      ]
    }
    const cands = listContourCandidatesFromDesign(d)
    const e = cands.find((c) => c.sourceId === 'ell1')
    expect(e).toBeDefined()
    expect(e!.points.length).toBeGreaterThanOrEqual(3)
    expect(e!.label).toMatch(/ellipse/i)
  })

  it('listContourCandidatesFromDesign includes closed spline_fit entity as candidate', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'sp1', kind: 'spline_fit', pointIds: ['a', 'b', 'c', 'd'], closed: true }
      ],
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 10 }, d: { x: 0, y: 10 } }
    }
    const cands = listContourCandidatesFromDesign(d)
    const s = cands.find((c) => c.sourceId === 'sp1')
    expect(s).toBeDefined()
    expect(s!.points.length).toBeGreaterThanOrEqual(3)
    expect(s!.label).toContain('spline_fit')
  })

  it('listContourCandidatesFromDesign includes closed spline_cp entity as candidate', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'sp2', kind: 'spline_cp', pointIds: ['a', 'b', 'c', 'd'], closed: true }
      ],
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 10 }, d: { x: 0, y: 10 } }
    }
    const cands = listContourCandidatesFromDesign(d)
    const s = cands.find((c) => c.sourceId === 'sp2')
    expect(s).toBeDefined()
    expect(s!.points.length).toBeGreaterThanOrEqual(3)
    expect(s!.label).toContain('spline_cp')
  })

  it('listContourCandidatesFromDesign skips open spline_fit and spline_cp', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'sf', kind: 'spline_fit', pointIds: ['a', 'b', 'c'], closed: false },
        { id: 'sc', kind: 'spline_cp', pointIds: ['a', 'b', 'c', 'd'], closed: false }
      ],
      points: { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, c: { x: 5, y: 5 }, d: { x: 0, y: 5 } }
    }
    expect(listContourCandidatesFromDesign(d)).toEqual([])
  })
})

