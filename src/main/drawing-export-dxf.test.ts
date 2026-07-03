/**
 * Full-document tests for the REAL drawing DXF export
 * (`drawing-export-templates.ts` → `buildPlaceholderDxf` +
 * `annotationsToDxfEntities`).
 *
 * Covers:
 *   - a full document with 2 dimensions + 1 note + 1 center mark + projection
 *     segments: parse-back sanity (section order, single EOF, entity counts per
 *     layer),
 *   - the SVG-mm → DXF Y-flip coordinate mapping (annotations land at
 *     `SVG_SHEET_HEIGHT_MM - y`),
 *   - control-code escaping surviving into the emitted TEXT,
 *   - byte-stability (same input → identical output),
 *   - graceful omission (no annotations → no DIMENSIONS/CENTERLINES entities).
 *
 * A minimal inline group-code reader is reused (no DXF parser dependency).
 */
import { describe, expect, it } from 'vitest'
import {
  annotationsToDxfEntities,
  buildPlaceholderDxf,
  SVG_SHEET_HEIGHT_MM,
  type ProjectedModelViewForExport
} from './drawing-export-templates'
import type { DrawingSheetAnnotations } from '../shared/drawing-annotation-schema'
import { emptyDrawingSheetAnnotations } from '../shared/drawing-annotation-schema'

// ---------------------------------------------------------------------------
// Minimal group-code reader (inline)
// ---------------------------------------------------------------------------

interface GroupPair {
  code: string
  value: string
}

function readGroups(dxf: string): GroupPair[] {
  const lines = dxf.split(/\r\n|\r|\n/)
  const pairs: GroupPair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: lines[i]!.trim(), value: lines[i + 1]! })
  }
  return pairs
}

function count(dxf: string, code: string, value: string): number {
  return readGroups(dxf).filter((p) => p.code === code && p.value === value).length
}

/** Walk ONLY the ENTITIES section, returning each entity's type + layer. */
function entities(dxf: string): Array<{ type: string; layer: string; texts: string[] }> {
  const groups = readGroups(dxf)
  let start = -1
  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i]!.code === '2' && groups[i]!.value === 'ENTITIES') {
      start = i + 1
      break
    }
  }
  if (start === -1) return []
  const out: Array<{ type: string; layer: string; texts: string[] }> = []
  let current: { type: string; layer: string; texts: string[] } | null = null
  for (let i = start; i < groups.length; i++) {
    const g = groups[i]!
    if (g.code === '0' && g.value === 'ENDSEC') break
    if (g.code === '0') {
      if (current) out.push(current)
      current = { type: g.value, layer: '', texts: [] }
    } else if (current) {
      if (g.code === '8') current.layer = g.value
      if (g.code === '1') current.texts.push(g.value)
    }
  }
  if (current) out.push(current)
  return out
}

function entitiesOnLayer(dxf: string, layer: string): Array<{ type: string; texts: string[] }> {
  return entities(dxf)
    .filter((e) => e.layer === layer)
    .map((e) => ({ type: e.type, texts: e.texts }))
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A free anchor (empty refId) at a fixed SVG-mm point. */
function anchor(x: number, y: number): { refId: string; cachedPoint: { x: number; y: number } } {
  return { refId: '', cachedPoint: { x, y } }
}

function fixtureAnnotations(): DrawingSheetAnnotations {
  const base = emptyDrawingSheetAnnotations()
  return {
    ...base,
    dimensions: [
      {
        kind: 'linear',
        id: 'dim-1',
        orientation: 'horizontal',
        start: anchor(100, 100),
        end: anchor(200, 100),
        value: 100,
        placement: { x: 150, y: 120 }
      },
      {
        kind: 'radial',
        id: 'dim-2',
        center: anchor(300, 300),
        on: anchor(320, 300),
        value: 20,
        placement: { x: 340, y: 280 }
      }
    ],
    notes: [
      {
        id: 'note-1',
        text: 'BREAK ALL EDGES',
        placement: { x: 400, y: 50 }
      }
    ],
    centerMarks: [
      {
        id: 'cm-1',
        anchor: anchor(250, 250),
        sizeMm: 3
      }
    ]
  }
}

function fixtureProjection(): ProjectedModelViewForExport[] {
  return [
    {
      id: 'view-1',
      label: 'front',
      axis: 'front',
      segments: [
        { x1: 0, y1: 0, x2: 40, y2: 0 },
        { x1: 40, y1: 0, x2: 40, y2: 30 },
        { x1: 40, y1: 30, x2: 0, y2: 30 },
        { x1: 0, y1: 30, x2: 0, y2: 0 }
      ]
    }
  ]
}

// ---------------------------------------------------------------------------
// annotationsToDxfEntities — per-kind mapping
// ---------------------------------------------------------------------------

describe('annotationsToDxfEntities', () => {
  it('returns an empty list for empty annotations', () => {
    expect(annotationsToDxfEntities(emptyDrawingSheetAnnotations())).toEqual([])
  })

  it('explodes a linear dimension to lines + a value TEXT on DIMENSIONS', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.dimensions = [
      {
        kind: 'linear',
        id: 'd',
        orientation: 'horizontal',
        start: anchor(0, 0),
        end: anchor(50, 0),
        value: 50,
        placement: { x: 25, y: 10 }
      }
    ]
    const out = annotationsToDxfEntities(ann)
    expect(out.every((e) => e.type !== 'text' || e.layer === 'DIMENSIONS')).toBe(true)
    const texts = out.filter((e) => e.type === 'text')
    expect(texts).toHaveLength(1)
    expect((texts[0] as { value: string }).value).toBe('50')
    // Extension lines + dimension line + two ticks = 5 lines.
    expect(out.filter((e) => e.type === 'line')).toHaveLength(5)
  })

  it('uses the label override as the read-out when present', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.dimensions = [
      {
        kind: 'linear',
        id: 'd',
        orientation: 'horizontal',
        start: anchor(0, 0),
        end: anchor(50, 0),
        value: 50,
        placement: { x: 25, y: 10 },
        label: '50 H7'
      }
    ]
    const text = annotationsToDxfEntities(ann).find((e) => e.type === 'text') as { value: string }
    expect(text.value).toBe('50 H7')
  })

  it('prefixes radial with R and diameter with D', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.dimensions = [
      { kind: 'radial', id: 'r', center: anchor(0, 0), on: anchor(10, 0), value: 10, placement: { x: 20, y: 0 } },
      { kind: 'diameter', id: 'd', center: anchor(0, 0), on: anchor(5, 0), value: 10, placement: { x: 20, y: 5 } }
    ]
    const texts = annotationsToDxfEntities(ann)
      .filter((e) => e.type === 'text')
      .map((e) => (e as { value: string }).value)
    expect(texts).toContain('R10')
    expect(texts).toContain('D10')
  })

  it('maps a GD&T frame to a closed polyline box + an abbreviation TEXT on ANNOTATIONS', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.featureControlFrames = [
      {
        id: 'g',
        characteristic: 'position',
        toleranceMm: 0.1,
        datums: ['A', 'B'],
        anchor: anchor(0, 0),
        placement: { x: 10, y: 10 }
      }
    ]
    const out = annotationsToDxfEntities(ann)
    const box = out.find((e) => e.type === 'polyline')
    expect(box).toBeDefined()
    expect((box as { closed: boolean }).closed).toBe(true)
    expect(box!.layer).toBe('ANNOTATIONS')
    const text = out.find((e) => e.type === 'text') as { value: string }
    expect(text.value).toBe('POS 0.1 A B')
  })

  it('maps a multi-line note to one TEXT per line + a leader when anchored', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.notes = [
      { id: 'n', text: 'LINE1\nLINE2', placement: { x: 0, y: 0 }, leader: anchor(50, 50) }
    ]
    const out = annotationsToDxfEntities(ann)
    expect(out.filter((e) => e.type === 'text')).toHaveLength(2)
    expect(out.filter((e) => e.type === 'line')).toHaveLength(1) // the leader
    expect(out.every((e) => e.layer === 'ANNOTATIONS')).toBe(true)
  })

  it('maps a center mark to two crossed CENTER-linetype lines on CENTERLINES', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.centerMarks = [{ id: 'c', anchor: anchor(100, 100), sizeMm: 4 }]
    const out = annotationsToDxfEntities(ann)
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.type === 'line' && e.layer === 'CENTERLINES')).toBe(true)
    expect(out.every((e) => (e as { linetype?: string }).linetype === 'CENTER')).toBe(true)
  })

  it('maps a centerline to one extended CENTER line on CENTERLINES', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.centerlines = [{ id: 'l', start: anchor(0, 100), end: anchor(50, 100) }]
    const out = annotationsToDxfEntities(ann)
    expect(out).toHaveLength(1)
    expect(out[0]!.layer).toBe('CENTERLINES')
  })
})

// ---------------------------------------------------------------------------
// Coordinate mapping — SVG-mm → DXF Y-flip
// ---------------------------------------------------------------------------

describe('annotation coordinate mapping (Y-flip)', () => {
  it('flips a center mark center about SVG_SHEET_HEIGHT_MM', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.centerMarks = [{ id: 'c', anchor: anchor(120, 100), sizeMm: 3 }]
    const out = annotationsToDxfEntities(ann)
    // Horizontal leg: y is constant = flipped(100) = 600 - 100 = 500.
    const horizontal = out[0] as { start: { x: number; y: number }; end: { x: number; y: number } }
    expect(horizontal.start.y).toBe(SVG_SHEET_HEIGHT_MM - 100)
    expect(horizontal.end.y).toBe(SVG_SHEET_HEIGHT_MM - 100)
    // Legs span ±sizeMm in X around 120.
    expect(horizontal.start.x).toBe(117)
    expect(horizontal.end.x).toBe(123)
  })
})

// ---------------------------------------------------------------------------
// Full document — buildPlaceholderDxf
// ---------------------------------------------------------------------------

describe('buildPlaceholderDxf: full document', () => {
  const dxf = buildPlaceholderDxf({
    projectTitle: 'Bracket',
    generatedAtIso: '2026-07-03T00:00:00.000Z',
    sheetTitle: 'Sheet 1',
    sheetScale: '1:1',
    projectedModelViews: fixtureProjection(),
    annotations: fixtureAnnotations()
  })

  it('parses back with canonical section order + a single EOF', () => {
    const sectionNames = readGroups(dxf)
      .filter((p, i, all) => p.code === '2' && all[i - 1]?.value === 'SECTION')
      .map((p) => p.value)
    expect(sectionNames).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'])
    expect(count(dxf, '0', 'EOF')).toBe(1)
    expect(count(dxf, '0', 'SECTION')).toBe(count(dxf, '0', 'ENDSEC'))
  })

  it('places projection segments on the PROJECTION layer (4 lines)', () => {
    const proj = entitiesOnLayer(dxf, 'PROJECTION')
    expect(proj).toHaveLength(4)
    expect(proj.every((e) => e.type === 'LINE')).toBe(true)
  })

  it('places dimension value texts on the DIMENSIONS layer', () => {
    const dims = entitiesOnLayer(dxf, 'DIMENSIONS')
    const texts = dims.flatMap((e) => e.texts)
    // linear "100" + radial "R20".
    expect(texts).toContain('100')
    expect(texts).toContain('R20')
  })

  it('places the note text on the ANNOTATIONS layer', () => {
    const ann = entitiesOnLayer(dxf, 'ANNOTATIONS')
    expect(ann.flatMap((e) => e.texts)).toContain('BREAK ALL EDGES')
  })

  it('places the center mark on the CENTERLINES layer (2 crossed lines)', () => {
    const cl = entitiesOnLayer(dxf, 'CENTERLINES')
    expect(cl).toHaveLength(2)
    expect(cl.every((e) => e.type === 'LINE')).toBe(true)
  })

  it('draws the sheet frame + title on the TITLE layer', () => {
    const title = entitiesOnLayer(dxf, 'TITLE')
    // 1 frame polyline + 2 title texts.
    expect(title.filter((e) => e.type === 'LWPOLYLINE')).toHaveLength(1)
    expect(title.flatMap((e) => e.texts)).toContain('Bracket')
  })

  it('declares $INSUNITS = 4 (mm)', () => {
    const groups = readGroups(dxf)
    const idx = groups.findIndex((p) => p.code === '9' && p.value === '$INSUNITS')
    expect(groups[idx + 1]).toEqual({ code: '70', value: '4' })
  })

  it('is byte-stable: same input → identical output', () => {
    const a = buildPlaceholderDxf({
      projectTitle: 'Bracket',
      generatedAtIso: '2026-07-03T00:00:00.000Z',
      sheetTitle: 'Sheet 1',
      sheetScale: '1:1',
      projectedModelViews: fixtureProjection(),
      annotations: fixtureAnnotations()
    })
    const b = buildPlaceholderDxf({
      projectTitle: 'Bracket',
      generatedAtIso: '2026-07-03T00:00:00.000Z',
      sheetTitle: 'Sheet 1',
      sheetScale: '1:1',
      projectedModelViews: fixtureProjection(),
      annotations: fixtureAnnotations()
    })
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

describe('buildPlaceholderDxf: graceful degradation', () => {
  it('emits no DIMENSIONS / CENTERLINES entities when there are no annotations', () => {
    const dxf = buildPlaceholderDxf({
      projectTitle: 'Empty',
      generatedAtIso: '2026-07-03T00:00:00.000Z'
    })
    expect(entitiesOnLayer(dxf, 'DIMENSIONS')).toHaveLength(0)
    expect(entitiesOnLayer(dxf, 'CENTERLINES')).toHaveLength(0)
    // Still a valid document with the frame + title.
    expect(count(dxf, '0', 'EOF')).toBe(1)
    expect(entitiesOnLayer(dxf, 'TITLE').length).toBeGreaterThan(0)
  })

  it('escapes control codes in a note that reach the emitted TEXT', () => {
    const ann = emptyDrawingSheetAnnotations()
    ann.notes = [{ id: 'n', text: 'Ø30 REAM', placement: { x: 10, y: 10 } }]
    const dxf = buildPlaceholderDxf({
      projectTitle: 'x',
      generatedAtIso: 'now',
      annotations: ann
    })
    const annTexts = entitiesOnLayer(dxf, 'ANNOTATIONS').flatMap((e) => e.texts)
    expect(annTexts).toContain('?30 REAM')
    // The raw non-ASCII must NOT survive into the DXF.
    expect(dxf).not.toContain('Ø')
  })
})
