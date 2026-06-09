import { describe, expect, it } from 'vitest'
import { dxfToSketch, tessellateBulgeArc } from './dxf-to-sketch'
import { convertDxfToMm, parseDxf, type DxfParseResult, type Point2D } from './dxf-parser'
import { emptyDesign } from './design-schema'
import { polylinePositions } from './sketch-profile'
import {
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign
} from './cam-2d-derive'

/**
 * A real ASCII DXF with one closed LWPOLYLINE (a 100×60 mm rectangle), one
 * CIRCLE (a 5 mm-radius hole), and one open LINE — the canonical Laguna sign /
 * cabinet input. Inch units so the mm-conversion path is exercised end-to-end.
 */
const RECT_HOLE_LINE_DXF = `0
SECTION
2
HEADER
9
$INSUNITS
70
1
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
PROFILE
90
4
70
1
10
0
20
0
10
100
20
0
10
100
20
60
10
0
20
60
0
CIRCLE
8
HOLES
10
50
20
30
40
5
0
LINE
8
MARKS
10
10
20
10
11
90
21
50
0
ENDSEC
0
EOF
`

function parseAndConvertToMm(text: string): DxfParseResult {
  const r = parseDxf(text)
  convertDxfToMm(r)
  return r
}

describe('dxfToSketch — real DXF fixture → sketch model', () => {
  it('parses the fixture into the expected mm primitives', () => {
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    expect(parse.units).toBe('mm') // converted in place from inches
    const types = parse.entities.map((e) => e.type).sort()
    expect(types).toEqual(['circle', 'line', 'polyline'])
    // inch → mm: the rectangle's far corner 100 in → 2540 mm.
    const poly = parse.entities.find((e) => e.type === 'polyline')
    expect(poly && poly.type === 'polyline' && poly.closed).toBe(true)
  })

  it('produces a sketch design that round-trips through cam-2d-derive', () => {
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design, importedCount, skippedCount } = dxfToSketch(parse, emptyDesign(), {
      idPrefix: 'fix'
    })
    expect(importedCount).toBe(3)
    expect(skippedCount).toBe(0)

    // The closed rectangle is a contour candidate; the line is NOT (open).
    const candidates = listContourCandidatesFromDesign(design)
    expect(candidates.length).toBe(2) // closed rect polyline + the circle loop
    const labels = candidates.map((c) => c.label)
    expect(labels.some((l) => l.startsWith('Polyline'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Circle'))).toBe(true)

    // deriveContour returns a usable closed loop (≥3 points).
    const contour = deriveContourPointsFromDesign(design)
    expect(contour.length).toBeGreaterThanOrEqual(3)

    // The circle becomes a drill point (deriveDrillPointsFromDesign maps circles → points).
    const drills = deriveDrillPointsFromDesign(design)
    expect(drills.length).toBe(1)
    // 50 in → 1270 mm, 30 in → 762 mm (inch fixture, converted).
    expect(drills[0]![0]).toBeCloseTo(50 * 25.4, 3)
    expect(drills[0]![1]).toBeCloseTo(30 * 25.4, 3)
  })

  it('the derived rectangle contour has the right extent (mm)', () => {
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'fix' })
    // Find the polyline (rectangle) candidate specifically.
    const rect = listContourCandidatesFromDesign(design).find((c) => c.label.startsWith('Polyline'))
    expect(rect).toBeDefined()
    const xs = rect!.points.map((p) => p[0])
    const ys = rect!.points.map((p) => p[1])
    // 0..100 in → 0..2540 mm ; 0..60 in → 0..1524 mm.
    expect(Math.min(...xs)).toBeCloseTo(0, 3)
    expect(Math.max(...xs)).toBeCloseTo(100 * 25.4, 3)
    expect(Math.min(...ys)).toBeCloseTo(0, 3)
    expect(Math.max(...ys)).toBeCloseTo(60 * 25.4, 3)
  })
})

describe('dxfToSketch — merge semantics', () => {
  it('additively merges onto an existing design by default (preserves CAD entities)', () => {
    const base = emptyDesign()
    base.entities.push({ id: 'cad1', kind: 'circle', cx: 1, cy: 2, r: 3 })
    base.points['keepme'] = { x: 9, y: 9 }
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design } = dxfToSketch(parse, base, { idPrefix: 'fix' })
    // Original entity + point survive; DXF entities are appended.
    expect(design.entities.some((e) => e.id === 'cad1')).toBe(true)
    expect(design.points['keepme']).toEqual({ x: 9, y: 9 })
    expect(design.entities.length).toBe(1 + 3)
    // base is not mutated.
    expect(base.entities.length).toBe(1)
  })

  it('replaces entities/points when replace:true (clean re-import)', () => {
    const base = emptyDesign()
    base.entities.push({ id: 'cad1', kind: 'circle', cx: 1, cy: 2, r: 3 })
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design } = dxfToSketch(parse, base, { replace: true, idPrefix: 'fix' })
    expect(design.entities.some((e) => e.id === 'cad1')).toBe(false)
    expect(design.entities.length).toBe(3)
  })

  it('preserves non-geometry design fields (parameters/plane/extrude)', () => {
    const base = emptyDesign()
    base.extrudeDepthMm = 42
    base.parameters['w'] = 100
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design } = dxfToSketch(parse, base, { idPrefix: 'fix' })
    expect(design.extrudeDepthMm).toBe(42)
    expect(design.parameters['w']).toBe(100)
    expect(design.sketchPlane).toEqual({ kind: 'datum', datum: 'XY' })
  })
})

describe('dxfToSketch — degenerate handling', () => {
  it('drops a zero-radius circle and a zero-length line with notes', () => {
    const dxf = `0
SECTION
2
ENTITIES
0
CIRCLE
8
0
10
0
20
0
40
0
0
LINE
8
0
10
5
20
5
11
5
21
5
0
ENDSEC
0
EOF
`
    const parse = parseDxf(dxf) // no unit header → 'unknown', stays as-is
    const { design, importedCount, skippedCount, notes } = dxfToSketch(parse, emptyDesign(), {
      idPrefix: 'fix'
    })
    expect(importedCount).toBe(0)
    expect(skippedCount).toBe(2)
    expect(design.entities.length).toBe(0)
    expect(notes.some((n) => /skipped/i.test(n))).toBe(true)
  })

  it('linearises a bulge polyline and flags it', () => {
    const dxf = `0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
90
3
70
1
10
0
20
0
42
0.5
10
10
20
0
10
10
20
10
0
ENDSEC
0
EOF
`
    const parse = parseDxf(dxf)
    const { design, importedCount, notes } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'fix' })
    expect(importedCount).toBe(1)
    expect(design.entities[0]!.kind).toBe('polyline')
    expect(notes.some((n) => /bulge/i.test(n))).toBe(true)
  })

  it('emits ids under the supplied prefix (stable, collision-resistant)', () => {
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'wave3d' })
    for (const e of design.entities) expect(e.id.startsWith('wave3d_')).toBe(true)
    for (const id of Object.keys(design.points)) expect(id.startsWith('wave3d_')).toBe(true)
  })

  it('the produced design still parses against the v2 schema', async () => {
    const { designFileSchemaV2 } = await import('./design-schema')
    const parse = parseAndConvertToMm(RECT_HOLE_LINE_DXF)
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'fix' })
    expect(() => designFileSchemaV2.parse(design)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Bulge-arc fidelity — tessellateBulgeArc unit behaviour + rounded-rect round-trip
// ---------------------------------------------------------------------------

/** Bulge value for a 90° arc: b = tan(θ/4) = tan(22.5°). */
const QUARTER_ARC_BULGE = Math.tan(Math.PI / 8)

describe('tessellateBulgeArc — circular-arc sampling', () => {
  it('samples a 90° CCW arc onto the true circle (radius preserved)', () => {
    // Quarter arc from (10,0) to (0,10), CCW, exact circle of radius 10 about origin.
    const interior = tessellateBulgeArc({ x: 10, y: 0 }, { x: 0, y: 10 }, QUARTER_ARC_BULGE)
    expect(interior.length).toBeGreaterThan(0)
    for (const p of interior) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6) // on the true circle
    }
  })

  it('respects the chord-deviation tolerance (max segment sagitta < 0.05 mm)', () => {
    const p0: Point2D = { x: 10, y: 0 }
    const p1: Point2D = { x: 0, y: 10 }
    const interior = tessellateBulgeArc(p0, p1, QUARTER_ARC_BULGE)
    const path: Point2D[] = [p0, ...interior, p1]
    // Center is the origin, radius 10 for this construction.
    let maxSag = 0
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!
      const b = path[i + 1]!
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const sag = 10 - Math.hypot(mid.x, mid.y) // r − dist(center, chord-midpoint)
      maxSag = Math.max(maxSag, sag)
    }
    expect(maxSag).toBeLessThan(0.05)
    expect(maxSag).toBeGreaterThan(0) // genuinely curved, not collapsed to the chord
  })

  it('negative bulge sweeps clockwise (convex side flips)', () => {
    // CW quarter arc from (0,10) → (10,0): apex bulges into the +x+y quadrant.
    const interior = tessellateBulgeArc({ x: 0, y: 10 }, { x: 10, y: 0 }, -QUARTER_ARC_BULGE)
    const apex = interior[Math.floor(interior.length / 2)]!
    expect(apex.x).toBeGreaterThan(0)
    expect(apex.y).toBeGreaterThan(0)
    expect(Math.hypot(apex.x, apex.y)).toBeCloseTo(10, 6)
  })

  it('returns no interior points for a straight (zero / sub-epsilon) bulge', () => {
    expect(tessellateBulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toHaveLength(0)
    expect(tessellateBulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1e-12)).toHaveLength(0)
  })

  it('hard-caps a full-sweep arc at 64 segments (bounded point count)', () => {
    // bulge=1 → 180° semicircle of radius 5; a finer tol could request >64 but the cap holds.
    const interior = tessellateBulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)
    expect(interior.length).toBeLessThanOrEqual(63) // ≤ MAX_SEGMENTS − 1 interior points
    // apex of a radius-5 semicircle sits 5 below the chord (CCW from (0,0)→(10,0) bulges −y).
    const apex = interior[Math.floor(interior.length / 2)]!
    expect(Math.hypot(apex.x - 5, apex.y - 0)).toBeCloseTo(5, 6)
  })
})

/**
 * Build a closed rounded-rectangle LWPOLYLINE in mm: axis-aligned box spanning
 * x∈[0,W], y∈[0,H] with quarter-circle corners of radius R. CCW winding; the four
 * corner segments carry a +tan(22.5°) bulge (incl. the closing segment), the four
 * edges are straight. This is the canonical sign-blank / cabinet-door outline that
 * loses its curves when bulges are linearised.
 */
function roundedRectDxf(w: number, h: number, r: number): string {
  // 8 tangent points, CCW from the bottom edge's left tangent.
  const verts: Array<{ x: number; y: number; bulge?: number }> = [
    { x: r, y: 0 },
    { x: w - r, y: 0, bulge: QUARTER_ARC_BULGE }, // → corner to (w, r)
    { x: w, y: r },
    { x: w, y: h - r, bulge: QUARTER_ARC_BULGE }, // → corner to (w−r, h)
    { x: w - r, y: h },
    { x: r, y: h, bulge: QUARTER_ARC_BULGE }, // → corner to (0, h−r)
    { x: 0, y: h - r },
    { x: 0, y: r, bulge: QUARTER_ARC_BULGE } // closing corner → (r, 0)
  ]
  const lines = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', 'PROFILE', '90', String(verts.length), '70', '1']
  for (const v of verts) {
    if (v.bulge !== undefined) lines.push('42', String(v.bulge))
    lines.push('10', String(v.x), '20', String(v.y))
  }
  lines.push('0', 'ENDSEC', '0', 'EOF', '')
  return lines.join('\n')
}

/**
 * Signed distance from a point to the boundary of a rounded rectangle (x∈[0,W],
 * y∈[0,H], corner radius R). 0 on the boundary; used to verify tessellated points
 * actually lie on the true rounded-rect outline, not just "somewhere closed".
 */
function roundedRectBoundaryDeviation(p: Point2D, w: number, h: number, r: number): number {
  // SDF of a rounded box centered at origin (half-extents), then take |sdf|.
  const cx = w / 2
  const cy = h / 2
  const qx = Math.abs(p.x - cx) - (cx - r)
  const qy = Math.abs(p.y - cy) - (cy - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return Math.abs(outside + inside - r)
}

describe('dxfToSketch — bulge arcs tessellate (rounded-rectangle round-trip)', () => {
  const W = 120
  const H = 80
  const R = 15

  it('imports the rounded rectangle as a single closed, curved polyline', () => {
    const parse = parseDxf(roundedRectDxf(W, H, R)) // already mm — no conversion
    const { design, importedCount, skippedCount, notes } = dxfToSketch(parse, emptyDesign(), {
      idPrefix: 'rr'
    })
    expect(importedCount).toBe(1)
    expect(skippedCount).toBe(0)

    const poly = design.entities[0]!
    expect(poly.kind).toBe('polyline')
    if (poly.kind !== 'polyline') throw new Error('expected polyline')
    expect(poly.closed).toBe(true) // closed loop stays closed → machinable boundary

    // Bulge tessellation inserts interior points: far more than the 8 raw vertices.
    const pts = polylinePositions(poly, design.points)
    expect(pts.length).toBeGreaterThan(8 + 4 * 3) // 8 corners' worth of arc samples added

    // The note announces tessellation (not linearisation).
    expect(notes.some((n) => /bulge/i.test(n) && /tessellat/i.test(n))).toBe(true)
  })

  it('every emitted point lies on the true rounded-rect boundary (< 0.05 mm)', () => {
    const parse = parseDxf(roundedRectDxf(W, H, R))
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'rr' })
    const poly = design.entities[0]!
    if (poly.kind !== 'polyline') throw new Error('expected polyline')
    const pts = polylinePositions(poly, design.points)
    let maxDev = 0
    for (const [x, y] of pts) maxDev = Math.max(maxDev, roundedRectBoundaryDeviation({ x, y }, W, H, R))
    expect(maxDev).toBeLessThan(0.05) // curve preserved within tolerance
  })

  it('the rounded corners are genuinely curved (not a straight chamfer chord)', () => {
    const parse = parseDxf(roundedRectDxf(W, H, R))
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'rr' })
    const poly = design.entities[0]!
    if (poly.kind !== 'polyline') throw new Error('expected polyline')
    const pts = polylinePositions(poly, design.points)
    // Points strictly inside every corner square (the diagonal band a chord would skip)
    // confirm a real arc. Bottom-left corner center is (R, R); arc points sit at radius R.
    const onBottomLeftArc = pts.filter(([x, y]) => {
      if (x >= R || y >= R) return false // only the corner quadrant
      const d = Math.hypot(x - R, y - R)
      return Math.abs(d - R) < 0.05
    })
    expect(onBottomLeftArc.length).toBeGreaterThanOrEqual(2) // intermediate arc samples exist
  })

  it('round-trips through cam-2d-derive as a closed contour candidate', () => {
    const parse = parseDxf(roundedRectDxf(W, H, R))
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'rr' })
    const candidates = listContourCandidatesFromDesign(design)
    const contour = candidates.find((c) => c.label.startsWith('Polyline'))
    expect(contour).toBeDefined()
    // Extent matches the rounded-rect bounding box exactly (tangent points hit 0 and W/H).
    const xs = contour!.points.map((p) => p[0])
    const ys = contour!.points.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(W, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(H, 6)
    // A usable closed loop (≥3 points) for contour/pocket/V-carve derive.
    const derived = deriveContourPointsFromDesign(design)
    expect(derived.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps a partially-bulged polyline mixed (straight segments stay straight)', () => {
    // Triangle where only the first segment bulges; the other two are straight chords.
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '1',
      '42', String(QUARTER_ARC_BULGE), '10', '0', '20', '0', // seg 0→1 bulges
      '10', '20', '20', '0', // seg 1→2 straight
      '10', '20', '20', '20', // seg 2→0 (closing) straight
      '0', 'ENDSEC', '0', 'EOF', ''
    ].join('\n')
    const parse = parseDxf(dxf)
    const { design } = dxfToSketch(parse, emptyDesign(), { idPrefix: 'mix' })
    const poly = design.entities[0]!
    if (poly.kind !== 'polyline') throw new Error('expected polyline')
    const pts = polylinePositions(poly, design.points)
    // 3 base vertices + interior samples on exactly ONE arc (the 0→1 segment).
    expect(pts.length).toBeGreaterThan(3)
    expect(poly.closed).toBe(true)
    // The straight 1→2 edge (y=0 from x=20→x=20? no — vertices (20,0)→(20,20)) has no
    // interior points injected: verify no sample sits strictly between those two on x=20.
    const between = pts.filter(([x, y]) => Math.abs(x - 20) < 1e-9 && y > 1e-6 && y < 20 - 1e-6)
    expect(between.length).toBe(0)
  })
})
