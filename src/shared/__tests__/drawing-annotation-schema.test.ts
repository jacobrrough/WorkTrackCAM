import { describe, expect, it } from 'vitest'
import {
  drawingBomRowSchema,
  drawingCenterlineSchema,
  drawingCenterMarkSchema,
  drawingDimensionAnchorSchema,
  drawingDimensionSchema,
  drawingNoteSchema,
  drawingRevisionSchema,
  drawingSheetAnnotationsSchema,
  emptyDrawingSheetAnnotations,
  gdtFeatureControlFrameSchema,
  surfaceFinishLaySchema,
  surfaceFinishMaterialSchema,
  surfaceFinishSymbolSchema,
  type DrawingDimension,
  type DrawingSheetAnnotations,
  type SurfaceFinishLay,
  type SurfaceFinishMaterial,
  type SurfaceFinishSymbol
} from '../drawing-annotation-schema'
import { drawingFileSchema, parseDrawingFile } from '../drawing-sheet-schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anchor(refId: string, x: number, y: number) {
  return { refId, cachedPoint: { x, y } }
}

// ---------------------------------------------------------------------------
// Anchor (associativity primitive)
// ---------------------------------------------------------------------------

describe('drawingDimensionAnchorSchema', () => {
  it('round-trips a refId + cachedPoint', () => {
    const a = anchor('edge-7', 30, 0)
    expect(drawingDimensionAnchorSchema.parse(a)).toEqual(a)
  })

  it('rejects a non-finite cachedPoint coordinate', () => {
    expect(() =>
      drawingDimensionAnchorSchema.parse({ refId: 'e0', cachedPoint: { x: Infinity, y: 0 } })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Dimension discriminated union — one round-trip per kind
// ---------------------------------------------------------------------------

describe('drawingDimensionSchema (round-trip per kind)', () => {
  const cases: ReadonlyArray<{ name: string; value: DrawingDimension }> = [
    {
      name: 'linear/horizontal',
      value: {
        kind: 'linear',
        id: 'd1',
        orientation: 'horizontal',
        start: anchor('v0', 0, 0),
        end: anchor('v1', 30, 0),
        value: 30,
        placement: { x: 15, y: -8 },
        label: '30 ±0.05'
      }
    },
    {
      name: 'linear/vertical (no label)',
      value: {
        kind: 'linear',
        id: 'd2',
        orientation: 'vertical',
        start: anchor('v0', 0, 0),
        end: anchor('v2', 0, 20),
        value: 20,
        placement: { x: -8, y: 10 }
      }
    },
    {
      name: 'linear/aligned',
      value: {
        kind: 'linear',
        id: 'd3',
        orientation: 'aligned',
        start: anchor('v0', 0, 0),
        end: anchor('v3', 30, 40),
        value: 50,
        placement: { x: 15, y: 20 }
      }
    },
    {
      name: 'radial',
      value: {
        kind: 'radial',
        id: 'd4',
        center: anchor('c0', 0, 0),
        on: anchor('a0', 10, 0),
        value: 10,
        placement: { x: 7, y: 7 }
      }
    },
    {
      name: 'diameter',
      value: {
        kind: 'diameter',
        id: 'd5',
        center: anchor('c1', 0, 0),
        on: anchor('a1', 12, 0),
        value: 24,
        placement: { x: 8, y: 8 }
      }
    },
    {
      name: 'angular',
      value: {
        kind: 'angular',
        id: 'd6',
        vertex: anchor('vx', 0, 0),
        arm1: anchor('a2', 10, 0),
        arm2: anchor('a3', 0, 10),
        value: 90,
        placement: { x: 6, y: 6 }
      }
    },
    {
      name: 'ordinate',
      value: {
        kind: 'ordinate',
        id: 'd7',
        origin: anchor('o0', 0, 0),
        feature: anchor('f0', 42, 0),
        axis: 'x',
        value: 42,
        placement: { x: 42, y: -12 }
      }
    },
    {
      name: 'baseline',
      value: {
        kind: 'baseline',
        id: 'd8',
        origin: anchor('o0', 0, 0),
        feature: anchor('f1', 60, 0),
        setId: 'set-A',
        value: 60,
        placement: { x: 60, y: -16 }
      }
    },
    {
      name: 'chain',
      value: {
        kind: 'chain',
        id: 'd9',
        start: anchor('f1', 60, 0),
        end: anchor('f2', 90, 0),
        setId: 'run-A',
        value: 30,
        placement: { x: 75, y: -8 }
      }
    }
  ]

  for (const c of cases) {
    it(`round-trips ${c.name}`, () => {
      const parsed = drawingDimensionSchema.parse(c.value)
      expect(parsed).toEqual(c.value)
    })
  }

  it('discriminates on kind (rejects an unknown kind)', () => {
    expect(() => drawingDimensionSchema.parse({ kind: 'bogus', id: 'x' })).toThrow()
  })

  it('rejects a linear dimension missing the orientation discriminant field', () => {
    expect(() =>
      drawingDimensionSchema.parse({
        kind: 'linear',
        id: 'd1',
        start: anchor('v0', 0, 0),
        end: anchor('v1', 30, 0),
        value: 30,
        placement: { x: 15, y: -8 }
      })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// GD&T feature control frame
// ---------------------------------------------------------------------------

describe('gdtFeatureControlFrameSchema', () => {
  it('round-trips a position tolerance with two datums', () => {
    const fcf = {
      id: 'g1',
      characteristic: 'position' as const,
      toleranceMm: 0.1,
      datums: ['A', 'B'],
      anchor: anchor('hole-3', 25, 25),
      placement: { x: 25, y: 40 }
    }
    expect(gdtFeatureControlFrameSchema.parse(fcf)).toEqual(fcf)
  })

  it('defaults datums to [] when omitted', () => {
    const parsed = gdtFeatureControlFrameSchema.parse({
      id: 'g2',
      characteristic: 'flatness',
      toleranceMm: 0.05,
      anchor: anchor('face-1', 0, 0),
      placement: { x: 0, y: 10 }
    })
    expect(parsed.datums).toEqual([])
  })

  it('rejects more than three datums', () => {
    expect(() =>
      gdtFeatureControlFrameSchema.parse({
        id: 'g3',
        characteristic: 'position',
        toleranceMm: 0.1,
        datums: ['A', 'B', 'C', 'D'],
        anchor: anchor('hole-3', 0, 0),
        placement: { x: 0, y: 0 }
      })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Notes / revisions / BOM
// ---------------------------------------------------------------------------

describe('note / revision / bom schemas', () => {
  it('round-trips a note with a leader', () => {
    const note = {
      id: 'n1',
      text: 'BREAK ALL SHARP EDGES',
      placement: { x: 100, y: 100 },
      leader: anchor('edge-2', 80, 80)
    }
    expect(drawingNoteSchema.parse(note)).toEqual(note)
  })

  it('round-trips a note without a leader', () => {
    const note = { id: 'n2', text: 'GENERAL NOTE', placement: { x: 10, y: 10 } }
    expect(drawingNoteSchema.parse(note)).toEqual(note)
  })

  it('round-trips a revision row', () => {
    const rev = { rev: 'A', date: '2026-06-04', desc: 'Initial release', author: 'JR' }
    expect(drawingRevisionSchema.parse(rev)).toEqual(rev)
  })

  it('round-trips a BOM row', () => {
    const row = { item: 1, qty: 4, partNumber: 'M3x8-SHCS', description: 'Socket head cap screw' }
    expect(drawingBomRowSchema.parse(row)).toEqual(row)
  })
})

// ---------------------------------------------------------------------------
// Annotations container — round-trip + defaults
// ---------------------------------------------------------------------------

describe('drawingSheetAnnotationsSchema', () => {
  it('defaults every array to empty when given {}', () => {
    const empty = drawingSheetAnnotationsSchema.parse({})
    expect(empty).toEqual({
      dimensions: [],
      featureControlFrames: [],
      surfaceFinishes: [],
      notes: [],
      centerMarks: [],
      centerlines: [],
      revisions: [],
      bom: []
    })
  })

  it('emptyDrawingSheetAnnotations() matches the parsed-empty shape', () => {
    expect(emptyDrawingSheetAnnotations()).toEqual(drawingSheetAnnotationsSchema.parse({}))
  })

  it('round-trips a fully-populated container', () => {
    const full: DrawingSheetAnnotations = {
      dimensions: [
        {
          kind: 'linear',
          id: 'd1',
          orientation: 'horizontal',
          start: anchor('v0', 0, 0),
          end: anchor('v1', 30, 0),
          value: 30,
          placement: { x: 15, y: -8 }
        }
      ],
      featureControlFrames: [
        {
          id: 'g1',
          characteristic: 'position',
          toleranceMm: 0.1,
          datums: ['A'],
          anchor: anchor('hole-1', 5, 5),
          placement: { x: 5, y: 20 }
        }
      ],
      surfaceFinishes: [
        {
          id: 's1',
          material: 'required',
          ra: 1.6,
          machiningAllowanceMm: 0.5,
          lay: 'perpendicular',
          anchor: anchor('face-1', 8, 0),
          placement: { x: 8, y: 0 }
        }
      ],
      notes: [{ id: 'n1', text: 'NOTE', placement: { x: 0, y: 0 } }],
      centerMarks: [{ id: 'cm1', anchor: anchor('hole-1', 5, 5), sizeMm: 3 }],
      centerlines: [{ id: 'cl1', start: anchor('hole-1', 5, 5), end: anchor('hole-2', 25, 5) }],
      revisions: [{ rev: 'A', date: '2026-06-04', desc: 'Init', author: 'JR' }],
      bom: [{ item: 1, qty: 2, partNumber: 'PN-1', description: 'Widget' }]
    }
    expect(drawingSheetAnnotationsSchema.parse(full)).toEqual(full)
  })
})

// ---------------------------------------------------------------------------
// Back-compat: existing drawing.json (NO annotations) must still parse.
// This is the load-bearing Safety-Rule-2 test.
// ---------------------------------------------------------------------------

describe('drawing-sheet-schema back-compat with additive annotations', () => {
  it('parses a v1 sheet WITHOUT an annotations field (byte-faithful: stays absent)', () => {
    // Shape exactly as written by versions before annotations existed.
    const legacy = {
      version: 1,
      sheets: [{ id: 'a', name: 'General', scale: '1:1' }]
    }
    const file = parseDrawingFile(legacy)
    const sheet = file.sheets[0]!
    // Pre-existing fields untouched...
    expect(sheet.id).toBe('a')
    expect(sheet.name).toBe('General')
    expect(sheet.scale).toBe('1:1')
    // ...and `annotations` is OPTIONAL with no Zod default, so it stays absent
    // for a legacy file (save/load remains byte-faithful — the field never
    // materializes onto an old sheet, which is what keeps the drawing-file
    // round-trip pins green). Consumers default at read-time via
    // emptyDrawingSheetAnnotations().
    expect(sheet.annotations).toBeUndefined()
    expect(sheet.annotations ?? emptyDrawingSheetAnnotations()).toEqual(
      emptyDrawingSheetAnnotations()
    )
  })

  it('parses an empty legacy drawing file unchanged', () => {
    const file = drawingFileSchema.parse({ version: 1, sheets: [] })
    expect(file.sheets).toEqual([])
  })

  it('does NOT add an annotations key to a parsed legacy sheet (exact-shape pin)', () => {
    // Guards the byte-faithfulness the round-trip pins rely on: the parsed
    // sheet object must equal its input verbatim, with no injected default.
    const sheet = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'x', name: 'No Annotations' }]
    }).sheets[0]!
    expect(sheet).toEqual({ id: 'x', name: 'No Annotations' })
    expect(Object.keys(sheet)).not.toContain('annotations')
  })

  it('round-trips a sheet that DOES carry annotations', () => {
    const withAnnotations = {
      version: 1 as const,
      sheets: [
        {
          id: 'b',
          name: 'Detail',
          annotations: {
            dimensions: [
              {
                kind: 'diameter' as const,
                id: 'd1',
                center: anchor('c0', 0, 0),
                on: anchor('a0', 6, 0),
                value: 12,
                placement: { x: 4, y: 4 }
              }
            ],
            featureControlFrames: [],
            notes: [],
            revisions: [],
            bom: []
          }
        }
      ]
    }
    const file = parseDrawingFile(withAnnotations)
    const ann = file.sheets[0]!.annotations!
    expect(ann.dimensions).toHaveLength(1)
    expect(ann.dimensions[0]!.kind).toBe('diameter')
    // refId survived the round-trip — this is what makes the dimension associative.
    const dim = ann.dimensions[0]!
    if (dim.kind === 'diameter') {
      expect(dim.center.refId).toBe('c0')
    }
  })
})

// ---------------------------------------------------------------------------
// Surface-finish symbol (ISO 1302 / ASME Y14.36) — the new annotation layer.
// Mirrors the GD&T frame coverage above (shape + round-trip + associativity +
// enum validation + additive back-compat).
// ---------------------------------------------------------------------------

describe('surfaceFinishSymbolSchema', () => {
  const FULL: SurfaceFinishSymbol = {
    id: 's1',
    material: 'required',
    ra: 1.6,
    machiningAllowanceMm: 0.5,
    lay: 'perpendicular',
    anchor: anchor('edge-3', 40, 18),
    placement: { x: 40, y: 18 }
  }

  it('round-trips a fully-populated symbol (anchor refId intact)', () => {
    expect(surfaceFinishSymbolSchema.parse(FULL)).toEqual(FULL)
    expect(surfaceFinishSymbolSchema.parse(FULL).anchor.refId).toBe('edge-3')
  })

  it('accepts a bare minimal symbol (material + anchor + placement only)', () => {
    const bare: SurfaceFinishSymbol = {
      id: 's2',
      material: 'any',
      anchor: anchor('', 5, 6),
      placement: { x: 5, y: 6 }
    }
    const parsed = surfaceFinishSymbolSchema.parse(bare)
    expect(parsed.ra).toBeUndefined()
    expect(parsed.machiningAllowanceMm).toBeUndefined()
    expect(parsed.lay).toBeUndefined()
  })

  it('every material id parses', () => {
    const materials: SurfaceFinishMaterial[] = ['any', 'required', 'prohibited']
    for (const m of materials) expect(() => surfaceFinishMaterialSchema.parse(m)).not.toThrow()
  })

  it('every lay id parses', () => {
    const lays: SurfaceFinishLay[] = [
      'parallel',
      'perpendicular',
      'crossed',
      'multidirectional',
      'circular',
      'radial',
      'particulate'
    ]
    for (const l of lays) expect(() => surfaceFinishLaySchema.parse(l)).not.toThrow()
  })

  it('rejects an unknown material and a negative / non-finite Ra', () => {
    expect(() => surfaceFinishMaterialSchema.parse('sandblasted')).toThrow()
    expect(() =>
      surfaceFinishSymbolSchema.parse({ ...FULL, ra: -1 })
    ).toThrow()
    expect(() =>
      surfaceFinishSymbolSchema.parse({ ...FULL, ra: Number.POSITIVE_INFINITY })
    ).toThrow()
  })
})

describe('drawingSheetAnnotationsSchema — surfaceFinishes additive back-compat', () => {
  it('a legacy annotations payload with NO surfaceFinishes defaults to []', () => {
    const legacy = drawingSheetAnnotationsSchema.parse({
      dimensions: [],
      featureControlFrames: [],
      notes: [],
      revisions: [],
      bom: []
    })
    expect(legacy.surfaceFinishes).toEqual([])
  })

  it('emptyDrawingSheetAnnotations() includes an empty surfaceFinishes array', () => {
    expect(emptyDrawingSheetAnnotations().surfaceFinishes).toEqual([])
  })

  it('round-trips a sheet that carries a surface-finish symbol through parseDrawingFile', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: 'b',
          name: 'Detail',
          annotations: {
            surfaceFinishes: [
              {
                id: 's1',
                material: 'prohibited',
                ra: 3.2,
                anchor: anchor('face-9', 2, 2),
                placement: { x: 2, y: 2 }
              }
            ]
          }
        }
      ]
    })
    const ann = file.sheets[0]!.annotations!
    expect(ann.surfaceFinishes).toHaveLength(1)
    expect(ann.surfaceFinishes[0]!.material).toBe('prohibited')
    // refId survived the round-trip — the symbol is associative.
    expect(ann.surfaceFinishes[0]!.anchor.refId).toBe('face-9')
  })
})

// ---------------------------------------------------------------------------
// Center marks + centerlines — schema round-trip + additive back-compat
// ---------------------------------------------------------------------------

describe('drawingCenterMarkSchema / drawingCenterlineSchema', () => {
  it('round-trips a center mark (anchor + sizeMm)', () => {
    const mark = { id: 'cm1', anchor: anchor('hole-1', 12, 34), sizeMm: 3 }
    expect(drawingCenterMarkSchema.parse(mark)).toEqual(mark)
  })

  it('rejects a non-positive / non-finite mark size', () => {
    expect(() =>
      drawingCenterMarkSchema.parse({ id: 'cm1', anchor: anchor('h', 0, 0), sizeMm: 0 })
    ).toThrow()
    expect(() =>
      drawingCenterMarkSchema.parse({ id: 'cm1', anchor: anchor('h', 0, 0), sizeMm: -1 })
    ).toThrow()
    expect(() =>
      drawingCenterMarkSchema.parse({
        id: 'cm1',
        anchor: anchor('h', 0, 0),
        sizeMm: Number.POSITIVE_INFINITY
      })
    ).toThrow()
  })

  it('round-trips a centerline (two anchors)', () => {
    const line = { id: 'cl1', start: anchor('hole-1', 0, 0), end: anchor('hole-2', 40, 0) }
    expect(drawingCenterlineSchema.parse(line)).toEqual(line)
  })
})

describe('drawingSheetAnnotationsSchema — centerMarks/centerlines additive back-compat', () => {
  it('a legacy annotations payload with NEITHER array defaults both to []', () => {
    const legacy = drawingSheetAnnotationsSchema.parse({
      dimensions: [],
      featureControlFrames: [],
      surfaceFinishes: [],
      notes: [],
      revisions: [],
      bom: []
    })
    expect(legacy.centerMarks).toEqual([])
    expect(legacy.centerlines).toEqual([])
  })

  it('emptyDrawingSheetAnnotations() includes both empty arrays', () => {
    expect(emptyDrawingSheetAnnotations().centerMarks).toEqual([])
    expect(emptyDrawingSheetAnnotations().centerlines).toEqual([])
  })

  it('a legacy drawing.json sheet (no centerMarks/centerlines) parses unchanged through parseDrawingFile', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: 'legacy',
          name: 'Old Sheet',
          annotations: {
            dimensions: [],
            notes: [{ id: 'n1', text: 'LEGACY NOTE', placement: { x: 0, y: 0 } }]
          }
        }
      ]
    })
    const ann = file.sheets[0]!.annotations!
    expect(ann.notes).toHaveLength(1)
    expect(ann.centerMarks).toEqual([])
    expect(ann.centerlines).toEqual([])
  })

  it('round-trips a sheet carrying a center mark + centerline through parseDrawingFile', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: 'b',
          name: 'Detail',
          annotations: {
            centerMarks: [{ id: 'cm1', anchor: anchor('hole-7', 2, 2), sizeMm: 4 }],
            centerlines: [
              { id: 'cl1', start: anchor('hole-7', 2, 2), end: anchor('hole-8', 30, 2) }
            ]
          }
        }
      ]
    })
    const ann = file.sheets[0]!.annotations!
    expect(ann.centerMarks).toHaveLength(1)
    expect(ann.centerMarks[0]!.anchor.refId).toBe('hole-7')
    expect(ann.centerMarks[0]!.sizeMm).toBe(4)
    expect(ann.centerlines).toHaveLength(1)
    expect(ann.centerlines[0]!.end.refId).toBe('hole-8')
  })
})
