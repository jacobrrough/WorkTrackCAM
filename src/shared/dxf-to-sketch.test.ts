import { describe, expect, it } from 'vitest'
import { dxfToSketch } from './dxf-to-sketch'
import { convertDxfToMm, parseDxf, type DxfParseResult } from './dxf-parser'
import { emptyDesign } from './design-schema'
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
