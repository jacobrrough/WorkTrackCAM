import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as opentype from 'opentype.js'
import type { Font } from 'opentype.js'
import {
  contourPointSignature,
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign
} from './cam-2d-derive'
import { emptyDesign, type DesignFileV2 } from './design-schema'
import { mergeTextVectorsIntoDesign } from './text-to-vectors'
import { dxfToSketch } from './dxf-to-sketch'
import { convertDxfToMm, parseDxf } from './dxf-parser'

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

/**
 * Wave 3f integration — Text-inserted AND DXF-imported vectors both land in the
 * SAME DesignFileV2 sketch model and BOTH feed cam-2d-derive, so each can become
 * a contour / pocket / V-carve op downstream. This is the load-bearing contract
 * for "Sign work is impossible without machinable text vectors": the dialog folds
 * `textToSketchVectors` output into the session model exactly like `dxfToSketch`,
 * and `deriveContourPointsFromDesign` (the function the 2D CAM derive calls) reads
 * both indiscriminately.
 */
describe('cam-2d-derive — Wave 3f: text + DXF both derive from the shared model', () => {
  let font: Font
  beforeAll(() => {
    // The same bundled Roboto buffer the main process would stream to the
    // renderer; the engine is pure, so no Electron / network is needed here.
    const buf = readFileSync(join(process.cwd(), 'resources', 'fonts', 'Roboto-Regular.ttf'))
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  })

  it("text 'O' yields 2 rings (outer + counter) that are both contour candidates", () => {
    const { design, result } = mergeTextVectorsIntoDesign({
      text: 'O',
      font,
      sizeMm: 20,
      idPrefix: 'txtO'
    })
    // The engine classifies one solid outer ring + one hole (the counter).
    expect(result.contours.filter((c) => !c.isHole)).toHaveLength(1)
    expect(result.contours.filter((c) => c.isHole)).toHaveLength(1)

    // Both rings are CLOSED polylines in the design, so cam-2d-derive lists two
    // contour candidates (the exact loops a profile/pocket/V-carve op consumes).
    const candidates = listContourCandidatesFromDesign(design)
    expect(candidates).toHaveLength(2)
    for (const c of candidates) {
      expect(c.points.length).toBeGreaterThanOrEqual(3)
      expect(c.signature.length).toBeGreaterThan(0)
    }
  })

  it('deriveContourPointsFromDesign returns a usable closed loop for inserted text', () => {
    const { design } = mergeTextVectorsIntoDesign({ text: 'O', font, sizeMm: 18, idPrefix: 'txtO2' })
    // The function the 2D CAM derive actually calls returns the first candidate's
    // points — a closed loop ready to drive a toolpath.
    const pts = deriveContourPointsFromDesign(design)
    expect(pts.length).toBeGreaterThanOrEqual(3)

    // And it can target a specific text contour by its source entity id.
    const candidates = listContourCandidatesFromDesign(design)
    const second = candidates[1]!
    const picked = deriveContourPointsFromDesign(design, second.sourceId)
    expect(picked).toEqual(second.points)
  })

  it('a DXF import and a text insert coexist + both derive from one model', () => {
    // 1) Import a closed rectangle from a tiny DXF (the Wave-3d path).
    const RECT_DXF = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'CUT', '90', '4', '70', '1',
      '10', '0', '20', '0',
      '10', '60', '20', '0',
      '10', '60', '20', '40',
      '10', '0', '20', '40',
      '0', 'ENDSEC', '0', 'EOF'
    ].join('\n')
    const parse = parseDxf(RECT_DXF)
    convertDxfToMm(parse)
    const dxfStep = dxfToSketch(parse, emptyDesign(), { idPrefix: 'dxfRect' })
    expect(dxfStep.importedCount).toBe(1)

    // 2) Insert text 'O' into the SAME model (additive — mirrors the dialog).
    const { design: combined } = mergeTextVectorsIntoDesign(
      { text: 'O', font, sizeMm: 16, idPrefix: 'txtCombo' },
      dxfStep.design
    )

    // The combined model now holds: the DXF rectangle (1) + the text O's two
    // rings (2) = 3 closed contour candidates, all derivable.
    const candidates = listContourCandidatesFromDesign(combined)
    expect(candidates).toHaveLength(3)
    for (const c of candidates) {
      expect(deriveContourPointsFromDesign(combined, c.sourceId).length).toBeGreaterThanOrEqual(3)
    }
    // The default derive (no id) still returns a usable loop from the shared model.
    expect(deriveContourPointsFromDesign(combined).length).toBeGreaterThanOrEqual(3)
  })
})

