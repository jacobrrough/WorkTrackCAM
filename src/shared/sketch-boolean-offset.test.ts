import { describe, expect, it } from 'vitest'
import ClipperLib from 'clipper-lib'
import {
  booleanSketchEntities,
  CLIPPER_SCALE,
  closedLoopForEntity,
  offsetSketchEntities,
  type ResultLoop
} from './sketch-boolean-offset'
import { emptyDesign, type DesignFileV2, type SketchEntity, type SketchPoint } from './design-schema'
import { listContourCandidatesFromDesign } from './cam-2d-derive'

/**
 * Validates the PURE offset + boolean sketch engine (src/shared/sketch-boolean-offset.ts).
 * Runs in the `node` vitest env (the engine is pure — no DOM/IPC). Geometry is checked
 * by area / vertex / winding so the result is provably machinable and consumable by
 * cam-2d-derive's contour candidates.
 */

// ── helpers ───────────────────────────────────────────────────────────────

/** Shoelace signed area (×2): >0 CCW, <0 CW. */
function signedArea2(points: ReadonlyArray<readonly [number, number]>): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s
}

/** Absolute polygon area (mm²). */
function area(points: ReadonlyArray<readonly [number, number]>): number {
  return Math.abs(signedArea2(points)) / 2
}

/** Tight bbox of a loop. */
function bbox(points: ReadonlyArray<readonly [number, number]>) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/**
 * Build a design holding closed rectangular polylines (CCW) from center+size specs.
 * Each square is a 4-vertex closed point-id polyline — the exact shape the live
 * sketch surface persists and cam-2d-derive reads.
 */
function squareDesign(
  squares: ReadonlyArray<{ id: string; cx: number; cy: number; size: number }>
): DesignFileV2 {
  const points: Record<string, SketchPoint> = {}
  const entities: SketchEntity[] = []
  for (const sq of squares) {
    const h = sq.size / 2
    const corners: [number, number][] = [
      [sq.cx - h, sq.cy - h],
      [sq.cx + h, sq.cy - h],
      [sq.cx + h, sq.cy + h],
      [sq.cx - h, sq.cy + h]
    ]
    const pointIds: string[] = []
    corners.forEach((c, i) => {
      const id = `${sq.id}_p${i}`
      points[id] = { x: c[0], y: c[1] }
      pointIds.push(id)
    })
    entities.push({ id: sq.id, kind: 'polyline', pointIds, closed: true })
  }
  return { ...emptyDesign(), points, entities }
}

/** The single largest-area loop in a result (the outer boundary). */
function outerLoop(loops: ReadonlyArray<ResultLoop>): ResultLoop {
  expect(loops.length).toBeGreaterThan(0)
  return [...loops].sort((a, b) => area(b.points) - area(a.points))[0]!
}

// ── import shape (Wave-3f build lesson) ─────────────────────────────────────

describe('sketch-boolean-offset — clipper-lib import shape', () => {
  it('default import exposes the ClipperLib namespace (CJS interop, not import *)', () => {
    // The module is CommonJS (module.exports = ClipperLib); the default import must
    // resolve to the namespace object under the Vite transform AND the Rollup build.
    expect(typeof ClipperLib).toBe('object')
    expect(typeof ClipperLib.Clipper).toBe('function')
    expect(typeof ClipperLib.ClipperOffset).toBe('function')
    expect(typeof ClipperLib.ClipType.ctUnion).toBe('number')
    expect(typeof ClipperLib.JoinType.jtMiter).toBe('number')
  })

  it('CLIPPER_SCALE is the documented 1e4 integer factor', () => {
    expect(CLIPPER_SCALE).toBe(1e4)
  })
})

// ── closed-loop extraction (matches cam-2d-derive) ──────────────────────────

describe('sketch-boolean-offset — closedLoopForEntity', () => {
  it('open polylines yield no loop (cannot bound a region)', () => {
    const e: SketchEntity = { id: 'L', kind: 'polyline', pointIds: ['a', 'b'], closed: false }
    expect(closedLoopForEntity(e, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })).toHaveLength(0)
  })

  it('a circle tessellates into a closed loop with ~πr² area', () => {
    const e: SketchEntity = { id: 'C', kind: 'circle', cx: 0, cy: 0, r: 10 }
    const loop = closedLoopForEntity(e, {})
    expect(loop.length).toBeGreaterThanOrEqual(32)
    // Inscribed polygon area is slightly under πr²; within 1% for 64 segments.
    expect(area(loop)).toBeGreaterThan(Math.PI * 100 * 0.99)
    expect(area(loop)).toBeLessThanOrEqual(Math.PI * 100)
  })
})

// ── OFFSET ──────────────────────────────────────────────────────────────────

describe('sketch-boolean-offset — offsetSketchEntities', () => {
  it('a 10 mm square offset +2 mm grows to ~14 mm (area 196)', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    const r = offsetSketchEntities({ design, distanceMm: 2, joinType: 'miter' })
    expect(r.empty).toBe(false)
    const outer = outerLoop(r.loops)
    const b = bbox(outer.points)
    expect(b.w).toBeCloseTo(14, 2)
    expect(b.h).toBeCloseTo(14, 2)
    expect(area(outer.points)).toBeCloseTo(196, 0)
    // Outer ring is solid + oriented CCW (cam-2d-derive contract).
    expect(outer.isHole).toBe(false)
    expect(signedArea2(outer.points)).toBeGreaterThan(0)
  })

  it('a 10 mm square inset -2 mm shrinks to ~6 mm (area 36)', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    const r = offsetSketchEntities({ design, distanceMm: -2 })
    expect(r.empty).toBe(false)
    const outer = outerLoop(r.loops)
    const b = bbox(outer.points)
    expect(b.w).toBeCloseTo(6, 2)
    expect(b.h).toBeCloseTo(6, 2)
    expect(area(outer.points)).toBeCloseTo(36, 0)
  })

  it('an inset larger than half-width collapses to EMPTY without throwing', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    // Half-width is 5 mm; -6 mm removes the whole square.
    let r!: ReturnType<typeof offsetSketchEntities>
    expect(() => {
      r = offsetSketchEntities({ design, distanceMm: -6 })
    }).not.toThrow()
    expect(r.empty).toBe(true)
    expect(r.loops).toHaveLength(0)
    expect(r.entities).toHaveLength(0)
    // The base design's geometry is preserved (additive: nothing added, nothing lost).
    expect(r.design.entities).toHaveLength(1)
  })

  it('round join keeps the outset area within the miter bound (corners rounded)', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    const miter = offsetSketchEntities({ design, distanceMm: 3, joinType: 'miter' })
    const round = offsetSketchEntities({ design, distanceMm: 3, joinType: 'round' })
    // Rounded corners trim area vs the square miter (16x16=256 minus rounded corners).
    expect(area(outerLoop(round.loops).points)).toBeLessThan(area(outerLoop(miter.loops).points))
    // Round result has many more vertices than the 4-corner miter square.
    expect(outerLoop(round.loops).points.length).toBeGreaterThan(outerLoop(miter.loops).points.length)
  })

  it('a zero-distance offset is a no-op-sized clean copy (area unchanged)', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    const r = offsetSketchEntities({ design, distanceMm: 0 })
    expect(r.empty).toBe(false)
    expect(area(outerLoop(r.loops).points)).toBeCloseTo(100, 0)
  })

  it('throws on a non-finite distance', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    expect(() => offsetSketchEntities({ design, distanceMm: Number.NaN })).toThrow()
  })

  it('never mutates the base design', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    const before = JSON.stringify(design)
    offsetSketchEntities({ design, distanceMm: 2 })
    expect(JSON.stringify(design)).toBe(before)
  })

  it('result loops merge additively + are derivable by cam-2d-derive', () => {
    const design = squareDesign([{ id: 'sq', cx: 0, cy: 0, size: 10 }])
    const r = offsetSketchEntities({ design, distanceMm: 2 })
    // Additive: original square + the offset copy.
    expect(r.design.entities.length).toBe(2)
    const candidates = listContourCandidatesFromDesign(r.design)
    // Both closed loops are contour candidates downstream.
    expect(candidates.length).toBe(2)
  })

  it('accepts a bare entities + points list (no design)', () => {
    const points: Record<string, SketchPoint> = {
      a: { x: -5, y: -5 },
      b: { x: 5, y: -5 },
      c: { x: 5, y: 5 },
      d: { x: -5, y: 5 }
    }
    const entities: SketchEntity[] = [
      { id: 'sq', kind: 'polyline', pointIds: ['a', 'b', 'c', 'd'], closed: true }
    ]
    const r = offsetSketchEntities({ entities, points, distanceMm: 2 })
    expect(area(outerLoop(r.loops).points)).toBeCloseTo(196, 0)
  })
})

// ── BOOLEAN ───────────────────────────────────────────────────────────────

describe('sketch-boolean-offset — booleanSketchEntities', () => {
  /** Two 10 mm squares overlapping by 5 mm on X (centers 5 mm apart). */
  const overlapping = () =>
    squareDesign([
      { id: 'A', cx: 0, cy: 0, size: 10 },
      { id: 'B', cx: 5, cy: 0, size: 10 }
    ])

  it('union of two overlapping squares → ONE merged outline (single outer, larger area)', () => {
    const design = overlapping()
    const r = booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['B'], op: 'union' })
    expect(r.empty).toBe(false)
    // Exactly one outer ring (no holes), and it's a single merged outline.
    const solids = r.loops.filter((l) => !l.isHole)
    const holes = r.loops.filter((l) => l.isHole)
    expect(solids).toHaveLength(1)
    expect(holes).toHaveLength(0)
    const outer = outerLoop(r.loops)
    const b = bbox(outer.points)
    // Union spans X from -5 (A left) to +10 (B right) = 15 mm wide, 10 mm tall.
    expect(b.w).toBeCloseTo(15, 2)
    expect(b.h).toBeCloseTo(10, 2)
    // Union area = 100 + 100 − overlap(5×10=50) = 150 mm².
    expect(area(outer.points)).toBeCloseTo(150, 0)
  })

  it('difference (A − B) leaves a notch (area = A minus the overlap)', () => {
    const design = overlapping()
    const r = booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['B'], op: 'difference' })
    expect(r.empty).toBe(false)
    const outer = outerLoop(r.loops)
    const b = bbox(outer.points)
    // A spans X[-5,5]; B removes X[0,5] → remaining X[-5,0] = 5 mm wide, 10 tall.
    expect(b.w).toBeCloseTo(5, 2)
    expect(b.h).toBeCloseTo(10, 2)
    // Remaining area = 100 − 50 = 50 mm².
    expect(area(outer.points)).toBeCloseTo(50, 0)
  })

  it('intersection → only the overlap region (5×10 = 50 mm²)', () => {
    const design = overlapping()
    const r = booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['B'], op: 'intersection' })
    expect(r.empty).toBe(false)
    const outer = outerLoop(r.loops)
    const b = bbox(outer.points)
    // Overlap is X[0,5] × Y[-5,5] = 5 mm wide, 10 mm tall.
    expect(b.w).toBeCloseTo(5, 2)
    expect(b.h).toBeCloseTo(10, 2)
    expect(area(outer.points)).toBeCloseTo(50, 0)
  })

  it('difference that punches a hole through the middle → outer CCW + inner CW hole', () => {
    // Big 20 mm square with a small 8 mm square fully inside it, both at origin.
    const design = squareDesign([
      { id: 'BIG', cx: 0, cy: 0, size: 20 },
      { id: 'SMALL', cx: 0, cy: 0, size: 8 }
    ])
    const r = booleanSketchEntities({ design, subjectIds: ['BIG'], clipIds: ['SMALL'], op: 'difference' })
    expect(r.empty).toBe(false)
    const solids = r.loops.filter((l) => !l.isHole)
    const holes = r.loops.filter((l) => l.isHole)
    expect(solids).toHaveLength(1)
    expect(holes).toHaveLength(1)
    // Outer solid CCW (positive area); hole CW (negative area) — cam-2d-derive contract.
    expect(signedArea2(solids[0]!.points)).toBeGreaterThan(0)
    expect(signedArea2(holes[0]!.points)).toBeLessThan(0)
    // Net machinable area = 400 − 64 = 336 mm² (outer minus hole).
    const net = area(solids[0]!.points) - area(holes[0]!.points)
    expect(net).toBeCloseTo(336, 0)
  })

  it('intersection of DISJOINT squares → EMPTY without throwing', () => {
    const design = squareDesign([
      { id: 'A', cx: 0, cy: 0, size: 10 },
      { id: 'B', cx: 100, cy: 0, size: 10 }
    ])
    let r!: ReturnType<typeof booleanSketchEntities>
    expect(() => {
      r = booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['B'], op: 'intersection' })
    }).not.toThrow()
    expect(r.empty).toBe(true)
    expect(r.loops).toHaveLength(0)
  })

  it('difference removing everything (clip ⊇ subject) → EMPTY without throwing', () => {
    const design = squareDesign([
      { id: 'A', cx: 0, cy: 0, size: 8 },
      { id: 'BIG', cx: 0, cy: 0, size: 20 }
    ])
    const r = booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['BIG'], op: 'difference' })
    expect(r.empty).toBe(true)
    expect(r.entities).toHaveLength(0)
  })

  it('union with empty clipIds welds the subjects (overlap merges)', () => {
    const design = overlapping()
    const r = booleanSketchEntities({ design, subjectIds: ['A', 'B'], clipIds: [], op: 'union' })
    expect(r.empty).toBe(false)
    expect(r.loops.filter((l) => !l.isHole)).toHaveLength(1)
    expect(area(outerLoop(r.loops).points)).toBeCloseTo(150, 0)
  })

  it('an empty/unknown subject set → EMPTY without throwing', () => {
    const design = overlapping()
    let r!: ReturnType<typeof booleanSketchEntities>
    expect(() => {
      r = booleanSketchEntities({ design, subjectIds: ['NOPE'], clipIds: ['B'], op: 'union' })
    }).not.toThrow()
    expect(r.empty).toBe(true)
  })

  it('never mutates the base design', () => {
    const design = overlapping()
    const before = JSON.stringify(design)
    booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['B'], op: 'difference' })
    expect(JSON.stringify(design)).toBe(before)
  })

  it('result merges additively + is derivable by cam-2d-derive', () => {
    const design = overlapping()
    const r = booleanSketchEntities({ design, subjectIds: ['A'], clipIds: ['B'], op: 'union' })
    // Additive: 2 original squares + 1 merged outline.
    expect(r.design.entities.length).toBe(3)
    // The merged loop is a contour candidate downstream.
    const candidates = listContourCandidatesFromDesign(r.design)
    expect(candidates.length).toBeGreaterThanOrEqual(3)
    // Every emitted entity is a CLOSED polyline.
    expect(r.entities.every((e) => e.kind === 'polyline' && e.closed)).toBe(true)
  })

  it('replace:true returns ONLY the result loops (clean re-author)', () => {
    const design = overlapping()
    const r = booleanSketchEntities({
      design,
      subjectIds: ['A'],
      clipIds: ['B'],
      op: 'union',
      replace: true
    })
    // Base squares dropped; only the single merged outline remains.
    expect(r.design.entities.length).toBe(1)
  })

  it('works on circles (union of two overlapping circles is a single blob)', () => {
    const points: Record<string, SketchPoint> = {}
    const entities: SketchEntity[] = [
      { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 10 },
      { id: 'c2', kind: 'circle', cx: 10, cy: 0, r: 10 }
    ]
    const r = booleanSketchEntities({ entities, points, subjectIds: ['c1'], clipIds: ['c2'], op: 'union' })
    expect(r.empty).toBe(false)
    expect(r.loops.filter((l) => !l.isHole)).toHaveLength(1)
    // Two r=10 circles 10 mm apart → union area < 2·πr² (overlap subtracted once).
    expect(area(outerLoop(r.loops).points)).toBeLessThan(2 * Math.PI * 100)
    expect(area(outerLoop(r.loops).points)).toBeGreaterThan(Math.PI * 100)
  })

  it('deterministic id prefix yields stable, reproducible ids', () => {
    const design = overlapping()
    const a = booleanSketchEntities({
      design,
      subjectIds: ['A'],
      clipIds: ['B'],
      op: 'union',
      idPrefix: 'fixed'
    })
    const b = booleanSketchEntities({
      design,
      subjectIds: ['A'],
      clipIds: ['B'],
      op: 'union',
      idPrefix: 'fixed'
    })
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id))
    // The IdMinter shares one counter across points + entities (like dxf-to-sketch),
    // so the entity id is prefix-tagged + deterministic, not necessarily `_c0`.
    expect(a.entities[0]!.id).toMatch(/^fixed_c\d+$/)
    // Point ids are likewise stable + prefixed across runs.
    expect(Object.keys(a.points)).toEqual(Object.keys(b.points))
    expect(Object.keys(a.points)[0]).toMatch(/^fixed_p\d+$/)
  })
})
