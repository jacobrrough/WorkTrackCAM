import { describe, expect, it } from 'vitest'
import { circularArray, rectangularArray } from './sketch-array'
import {
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from './design-schema'

/** A 1-circle design at (cx,cy) r — the simplest center-based entity for offset checks. */
function designWithCircle(id: string, cx: number, cy: number, r = 2): DesignFileV2 {
  const d = emptyDesign()
  d.entities.push({ id, kind: 'circle', cx, cy, r })
  return d
}

/** A design holding one closed polyline (unit square) anchored at its centroid. */
function designWithSquare(id: string, cx: number, cy: number, half = 1): DesignFileV2 {
  const d = emptyDesign()
  const corners: Array<[number, number]> = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half]
  ]
  const pointIds: string[] = []
  corners.forEach((p, i) => {
    const pid = `${id}_p${i}`
    d.points[pid] = { x: p[0], y: p[1] }
    pointIds.push(pid)
  })
  d.entities.push({ id, kind: 'polyline', pointIds, closed: true })
  return d
}

/** Pull a circle entity by id (typed). */
function circleById(d: DesignFileV2, id: string): Extract<SketchEntity, { kind: 'circle' }> {
  const e = d.entities.find((x) => x.id === id)
  if (!e || e.kind !== 'circle') throw new Error(`no circle ${id}`)
  return e
}

/** Centroid of a polyline-by-ids entity (for offset assertions). */
function polyCentroid(d: DesignFileV2, id: string): { x: number; y: number } {
  const e = d.entities.find((x) => x.id === id)
  if (!e || e.kind !== 'polyline' || !('pointIds' in e) || !e.pointIds) {
    throw new Error(`no polyline ${id}`)
  }
  let sx = 0
  let sy = 0
  for (const pid of e.pointIds) {
    const p = d.points[pid] as SketchPoint
    sx += p.x
    sy += p.y
  }
  return { x: sx / e.pointIds.length, y: sy / e.pointIds.length }
}

describe('rectangularArray — grid of copies', () => {
  it('a 1-entity rect array 3×2 @ (10,8) → 6 entities at the right offsets', () => {
    // VALIDATION: 3 cols × 2 rows including the original = 6 total instances.
    const base = designWithCircle('c0', 0, 0)
    const { design, copyCount } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 3,
      rows: 2,
      dxMm: 10,
      dyMm: 8
    })
    // The original is preserved; 5 new copies are produced (3·2 − 1).
    expect(copyCount).toBe(5)
    expect(design.entities.length).toBe(6)

    // Every grid cell (col·10, row·8) must be occupied exactly once.
    const centers = design.entities
      .filter((e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle')
      .map((e) => `${e.cx},${e.cy}`)
      .sort()
    const expected: string[] = []
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) expected.push(`${c * 10},${r * 8}`)
    expect(centers).toEqual(expected.sort())
  })

  it('preserves the original in cell (0,0) and never mutates the base', () => {
    const base = designWithCircle('c0', 5, 5)
    const before = JSON.parse(JSON.stringify(base))
    const { design } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 2,
      rows: 2,
      dxMm: 10,
      dyMm: 10
    })
    // Base untouched.
    expect(base).toEqual(before)
    // Original survives by id; its center is unchanged.
    const orig = circleById(design, 'c0')
    expect([orig.cx, orig.cy]).toEqual([5, 5])
  })

  it('derives copy ids deterministically from source id + cell index (no clock/RNG)', () => {
    const base = designWithCircle('c0', 0, 0)
    const run = () =>
      rectangularArray({ design: base, sourceIds: ['c0'], cols: 2, rows: 2, dxMm: 4, dyMm: 4 })
    const a = run()
    const b = run()
    const idsA = a.design.entities.map((e) => e.id).sort()
    const idsB = b.design.entities.map((e) => e.id).sort()
    expect(idsA).toEqual(idsB)
    // Stable suffix scheme: r<row>c<col> on the source id.
    expect(idsA).toEqual(['c0', 'c0#r0c1', 'c0#r1c0', 'c0#r1c1'].sort())
  })

  it('translates a polyline by grid offset (vertices shift, no spin)', () => {
    const base = designWithSquare('sq', 0, 0, 1)
    const { design } = rectangularArray({
      design: base,
      sourceIds: ['sq'],
      cols: 2,
      rows: 1,
      dxMm: 10,
      dyMm: 0
    })
    // Copy centroid is shifted +10 in X; the square keeps its 2×2 extent (axis-aligned).
    const copy = design.entities.find((e) => e.id === 'sq#r0c1')
    expect(copy).toBeDefined()
    const cen = polyCentroid(design, 'sq#r0c1')
    expect(cen.x).toBeCloseTo(10, 9)
    expect(cen.y).toBeCloseTo(0, 9)
    // All four corner points exist with the copy's id suffix.
    if (copy && copy.kind === 'polyline' && 'pointIds' in copy && copy.pointIds) {
      expect(copy.pointIds).toHaveLength(4)
      for (const pid of copy.pointIds) expect(design.points[pid]).toBeDefined()
      const xs = copy.pointIds.map((p) => design.points[p]!.x).sort((m, n) => m - n)
      expect(xs[0]).toBeCloseTo(9, 9)
      expect(xs[3]).toBeCloseTo(11, 9)
    }
  })

  it('supports replace:true (only sources + copies remain)', () => {
    const base = designWithCircle('c0', 0, 0)
    base.entities.push({ id: 'keepNot', kind: 'circle', cx: 99, cy: 99, r: 1 })
    const { design } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 2,
      rows: 1,
      dxMm: 5,
      dyMm: 0,
      replace: true
    })
    // The non-source 'keepNot' is dropped; only c0 + its copy survive.
    expect(design.entities.map((e) => e.id).sort()).toEqual(['c0', 'c0#r0c1'].sort())
  })

  it('notes an unknown source id and produces no copies for it', () => {
    const base = designWithCircle('c0', 0, 0)
    const { design, copyCount, notes } = rectangularArray({
      design: base,
      sourceIds: ['ghost'],
      cols: 3,
      rows: 1,
      dxMm: 5,
      dyMm: 0
    })
    expect(copyCount).toBe(0)
    expect(design.entities.length).toBe(1) // just the untouched original
    expect(notes.join(' ')).toMatch(/not found/i)
  })

  it('cols=1 rows=1 is a no-op (only the original, no copies)', () => {
    const base = designWithCircle('c0', 0, 0)
    const { copyCount } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 1,
      rows: 1,
      dxMm: 10,
      dyMm: 10
    })
    expect(copyCount).toBe(0)
  })

  it('accepts an explicit entity list (no design) and merges onto an empty design', () => {
    const ent: SketchEntity = { id: 'c0', kind: 'circle', cx: 0, cy: 0, r: 3 }
    const { design, copyCount } = rectangularArray({
      entities: [ent],
      sourceIds: ['c0'],
      cols: 2,
      rows: 1,
      dxMm: 7,
      dyMm: 0
    })
    // Source list path: the base is an empty design, so result = copies only
    // (the source entity is NOT in the empty base's entities, so additive append
    // yields just the copy). copyCount counts the produced copies.
    expect(copyCount).toBe(1)
    const copy = design.entities.find((e) => e.id === 'c0#r0c1')
    expect(copy && copy.kind === 'circle' && copy.cx).toBe(7)
  })
})

describe('circularArray — copies about a center', () => {
  it('count=4 over 360° → 4 instances at 0/90/180/270 about center', () => {
    // VALIDATION: a hole at (10,0); center at origin; 4-up around the circle.
    const base = designWithCircle('h', 10, 0, 1)
    const { design, copyCount } = circularArray({
      design: base,
      sourceIds: ['h'],
      count: 4,
      centerXY: [0, 0],
      totalAngleDeg: 360
    })
    // 3 new copies + preserved original = 4 instances total.
    expect(copyCount).toBe(3)
    const circles = design.entities.filter(
      (e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle'
    )
    expect(circles.length).toBe(4)
    // Centers should be at angles 0/90/180/270 on radius 10: (10,0)(0,10)(-10,0)(0,-10).
    const found = circles.map((c) => [Math.round(c.cx), Math.round(c.cy)] as const)
    const norm = (pts: ReadonlyArray<readonly [number, number]>) =>
      pts.map((p) => `${p[0]},${p[1]}`).sort()
    expect(norm(found)).toEqual(norm([
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10]
    ]))
  })

  it('places the original at angle 0 (preserved) and copies at the other steps', () => {
    const base = designWithCircle('h', 10, 0, 1)
    const { design } = circularArray({
      design: base,
      sourceIds: ['h'],
      count: 4,
      centerXY: [0, 0]
    })
    // The original keeps its id + position (angle 0).
    const orig = circleById(design, 'h')
    expect([Math.round(orig.cx), Math.round(orig.cy)]).toEqual([10, 0])
    // Copy n1 is +90° → (0,10).
    const n1 = circleById(design, 'h#n1')
    expect(Math.round(n1.cx)).toBe(0)
    expect(Math.round(n1.cy)).toBe(10)
  })

  it('rotateCopies:true spins each copy geometry; rotateCopies:false only translates', () => {
    // A unit square centered at (10,0). A 45° step (count=8 over 360°) is the
    // discriminator: at a NON-90° angle the spun square is visibly TILTED off
    // the axes, while the translate-only copy stays axis-aligned. (A 90° step
    // would be degenerate — an axis-aligned square is 90°-symmetric.)
    const base = designWithSquare('sq', 10, 0, 1)
    const opt = { design: base, sourceIds: ['sq'], count: 8, centerXY: [0, 0] as [number, number], totalAngleDeg: 360 }
    const spun = circularArray({ ...opt, rotateCopies: true })
    const flat = circularArray({ ...opt, rotateCopies: false })

    // Both place the copy's CENTROID at radius 10, angle 45° → (7.071, 7.071).
    const cen45 = [10 * Math.cos(Math.PI / 4), 10 * Math.sin(Math.PI / 4)] as const
    for (const d of [spun.design, flat.design]) {
      const cen = polyCentroid(d, 'sq#n1')
      expect(cen.x).toBeCloseTo(cen45[0], 6)
      expect(cen.y).toBeCloseTo(cen45[1], 6)
    }

    const cornerOf = (d: DesignFileV2, id: string): Array<[number, number]> => {
      const ent = d.entities.find((e) => e.id === id)
      if (!ent || ent.kind !== 'polyline' || !('pointIds' in ent) || !ent.pointIds) return []
      return ent.pointIds.map((p) => [d.points[p]!.x, d.points[p]!.y])
    }

    // Translate-only: each vertex offset from the centroid is exactly (±1,±1)
    // (axis-aligned, unchanged shape — pure slide).
    const flatLocal = cornerOf(flat.design, 'sq#n1')
      .map((p) => `${Math.round((p[0] - cen45[0]) * 1e6) / 1e6},${Math.round((p[1] - cen45[1]) * 1e6) / 1e6}`)
      .sort()
    expect(flatLocal).toEqual(['-1,-1', '-1,1', '1,-1', '1,1'].sort())

    // Spun: each vertex offset from the centroid is the (±1,±1) corner ROTATED
    // 45° → (0,±√2) and (±√2,0). Distinct from the axis-aligned flat set.
    const s2 = Math.SQRT2
    const spunLocal = cornerOf(spun.design, 'sq#n1')
      .map((p) => `${Math.round((p[0] - cen45[0]) * 1e6) / 1e6},${Math.round((p[1] - cen45[1]) * 1e6) / 1e6}`)
      .sort()
    const r = (n: number) => Math.round(n * 1e6) / 1e6
    expect(spunLocal).toEqual([`${r(s2)},0`, `${r(-s2)},0`, `0,${r(s2)}`, `0,${r(-s2)}`].sort())
    expect(spunLocal).not.toEqual(flatLocal)
  })

  it('advances a rect entity rotation when spinning, leaves it when not', () => {
    const d = emptyDesign()
    d.entities.push({ id: 'r0', kind: 'rect', cx: 10, cy: 0, w: 4, h: 2, rotation: 0 })
    const spun = circularArray({
      design: d,
      sourceIds: ['r0'],
      count: 4,
      centerXY: [0, 0],
      rotateCopies: true
    })
    const flat = circularArray({
      design: d,
      sourceIds: ['r0'],
      count: 4,
      centerXY: [0, 0],
      rotateCopies: false
    })
    const rectById = (des: DesignFileV2, id: string) => {
      const e = des.entities.find((x) => x.id === id)
      if (!e || e.kind !== 'rect') throw new Error(`no rect ${id}`)
      return e
    }
    // +90° instance: spun rect rotation = π/2; flat rect rotation stays 0.
    expect(rectById(spun.design, 'r0#n1').rotation).toBeCloseTo(Math.PI / 2, 9)
    expect(rectById(flat.design, 'r0#n1').rotation).toBeCloseTo(0, 9)
  })

  it('count=4 over 180° steps by 45° (totalAngle/count)', () => {
    const base = designWithCircle('h', 10, 0, 1)
    const { design } = circularArray({
      design: base,
      sourceIds: ['h'],
      count: 4,
      centerXY: [0, 0],
      totalAngleDeg: 180
    })
    // step = 180/4 = 45°. Copy n1 at 45°: (10cos45, 10sin45) ≈ (7.071, 7.071).
    const n1 = circleById(design, 'h#n1')
    expect(n1.cx).toBeCloseTo(10 * Math.cos(Math.PI / 4), 6)
    expect(n1.cy).toBeCloseTo(10 * Math.sin(Math.PI / 4), 6)
  })

  it('arc copies remap all three vertex ids and keep the closed flag', () => {
    const d = emptyDesign()
    d.points['a'] = { x: 1, y: 0 }
    d.points['b'] = { x: 0, y: 1 }
    d.points['c'] = { x: -1, y: 0 }
    d.entities.push({ id: 'arc0', kind: 'arc', startId: 'a', viaId: 'b', endId: 'c', closed: true })
    const { design } = circularArray({
      design: d,
      sourceIds: ['arc0'],
      count: 2,
      centerXY: [0, 0],
      totalAngleDeg: 360
    })
    const copy = design.entities.find((e) => e.id === 'arc0#n1')
    expect(copy && copy.kind === 'arc').toBe(true)
    if (copy && copy.kind === 'arc') {
      expect(copy.closed).toBe(true)
      // Fresh, deterministic point ids; all resolvable.
      expect(copy.startId).toBe('a#n1')
      expect(copy.viaId).toBe('b#n1')
      expect(copy.endId).toBe('c#n1')
      // count=2 over 360 → step 180°: vertex 'a' (1,0) rotates to (−1,0).
      expect(design.points['a#n1']!.x).toBeCloseTo(-1, 6)
      expect(design.points['a#n1']!.y).toBeCloseTo(0, 6)
    }
  })

  it('does not mutate the base design (circular)', () => {
    const base = designWithCircle('h', 10, 0, 1)
    const before = JSON.parse(JSON.stringify(base))
    circularArray({ design: base, sourceIds: ['h'], count: 6, centerXY: [0, 0] })
    expect(base).toEqual(before)
  })

  it('count=1 is a no-op (only original, no copies)', () => {
    const base = designWithCircle('h', 10, 0, 1)
    const { copyCount } = circularArray({ design: base, sourceIds: ['h'], count: 1, centerXY: [0, 0] })
    expect(copyCount).toBe(0)
  })

  it('arrays multiple selected entities together per instance', () => {
    const d = emptyDesign()
    d.entities.push({ id: 'a', kind: 'circle', cx: 10, cy: 0, r: 1 })
    d.entities.push({ id: 'b', kind: 'circle', cx: 12, cy: 0, r: 1 })
    const { design, copyCount } = circularArray({
      design: d,
      sourceIds: ['a', 'b'],
      count: 4,
      centerXY: [0, 0]
    })
    // 2 sources × 3 copy instances = 6 new entities.
    expect(copyCount).toBe(6)
    expect(design.entities.length).toBe(8)
    expect(design.entities.some((e) => e.id === 'a#n2')).toBe(true)
    expect(design.entities.some((e) => e.id === 'b#n3')).toBe(true)
  })
})

describe('sketch-array — merge fidelity', () => {
  it('preserves non-geometry design fields (parameters / plane / extrude)', () => {
    const base = designWithCircle('c0', 0, 0)
    base.extrudeDepthMm = 42
    base.parameters['w'] = 100
    base.sketchPlane = { kind: 'datum', datum: 'XZ' }
    const { design } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 2,
      rows: 1,
      dxMm: 5,
      dyMm: 0
    })
    expect(design.extrudeDepthMm).toBe(42)
    expect(design.parameters['w']).toBe(100)
    expect(design.sketchPlane).toEqual({ kind: 'datum', datum: 'XZ' })
  })

  it('additively appends to an existing design by default (other geometry survives)', () => {
    const base = designWithCircle('c0', 0, 0)
    base.entities.push({ id: 'other', kind: 'circle', cx: 50, cy: 50, r: 4 })
    base.points['standalone'] = { x: 7, y: 7 }
    const { design } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 2,
      rows: 1,
      dxMm: 5,
      dyMm: 0
    })
    expect(design.entities.some((e) => e.id === 'other')).toBe(true)
    expect(design.points['standalone']).toEqual({ x: 7, y: 7 })
    // original (2) + 1 new copy = 3.
    expect(design.entities.length).toBe(3)
  })

  it('custom idSeparator flows into copy ids', () => {
    const base = designWithCircle('c0', 0, 0)
    const { design } = rectangularArray({
      design: base,
      sourceIds: ['c0'],
      cols: 2,
      rows: 1,
      dxMm: 5,
      dyMm: 0,
      idSeparator: '~~'
    })
    expect(design.entities.some((e) => e.id === 'c0~~r0c1')).toBe(true)
  })
})
