/**
 * Unit + document tests for the pure R12 DXF entity emitter (`dxf-entities.ts`).
 *
 * These pin the entity-level group-code contract (a LINE's group codes, an
 * LWPOLYLINE's vertex count + 70-flag, TEXT height + escaping), the LTYPE +
 * LAYER table presence/shape, the document section order + single EOF, units
 * header ($INSUNITS 4), and byte-stability (same input → identical output).
 *
 * A minimal group-code reader is written INLINE here (no DXF parser dependency
 * added — the repo's `src/shared/dxf-parser.ts` is a renderer-side importer with
 * a different contract; the tests need only pair up (code, value) lines).
 */
import { describe, expect, it } from 'vitest'
import {
  assembleDxfDocument,
  computeEntitiesExtents,
  DXF_LAYERS,
  DXF_LINETYPES,
  emitEntity,
  escapeDxfText,
  formatDxfNumber,
  type DxfEntity
} from './dxf-entities'

// ---------------------------------------------------------------------------
// Minimal group-code reader (inline — no dependency)
// ---------------------------------------------------------------------------

interface GroupPair {
  code: string
  value: string
}

/** Split a DXF string into (code, value) pairs. DXF is strictly code\nvalue\n… */
function readGroups(dxf: string): GroupPair[] {
  const lines = dxf.split(/\r\n|\r|\n/)
  const pairs: GroupPair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: lines[i]!.trim(), value: lines[i + 1]! })
  }
  return pairs
}

/** All values that appear under a given group code. */
function valuesForCode(dxf: string, code: string): string[] {
  return readGroups(dxf)
    .filter((p) => p.code === code)
    .map((p) => p.value)
}

/** Count how many entities of a DXF entity-type keyword appear (group 0). */
function countEntities(dxf: string, keyword: string): number {
  return readGroups(dxf).filter((p) => p.code === '0' && p.value === keyword).length
}

/**
 * Walk the ENTITIES section and return, for each entity, its type keyword and
 * layer (group 8 value). Reads only the ENTITIES section so table LAYER rows
 * (which also use `0 LAYER` + `8`… no — LAYER table rows use group 2 for the
 * name) do not leak in. We slice from `2 ENTITIES` to the following `0 ENDSEC`.
 */
function entityLayers(dxf: string): Array<{ type: string; layer: string }> {
  const groups = readGroups(dxf)
  // Find the ENTITIES section bounds.
  let start = -1
  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i]!.code === '2' && groups[i]!.value === 'ENTITIES') {
      start = i + 1
      break
    }
  }
  if (start === -1) return []
  const out: Array<{ type: string; layer: string }> = []
  let current: { type: string; layer: string } | null = null
  for (let i = start; i < groups.length; i++) {
    const g = groups[i]!
    if (g.code === '0' && g.value === 'ENDSEC') break
    if (g.code === '0') {
      if (current) out.push(current)
      current = { type: g.value, layer: '' }
    } else if (g.code === '8' && current) {
      current.layer = g.value
    }
  }
  if (current) out.push(current)
  return out
}

// ---------------------------------------------------------------------------
// formatDxfNumber
// ---------------------------------------------------------------------------

describe('formatDxfNumber', () => {
  it('renders an integer without a decimal point', () => {
    expect(formatDxfNumber(10)).toBe('10')
    expect(formatDxfNumber(0)).toBe('0')
    expect(formatDxfNumber(-5)).toBe('-5')
  })

  it('trims trailing zeros on a real', () => {
    expect(formatDxfNumber(1.5)).toBe('1.5')
    expect(formatDxfNumber(2.25)).toBe('2.25')
    expect(formatDxfNumber(3.14159265)).toBe('3.141593')
  })

  it('collapses non-finite input to "0"', () => {
    expect(formatDxfNumber(NaN)).toBe('0')
    expect(formatDxfNumber(Infinity)).toBe('0')
    expect(formatDxfNumber(-Infinity)).toBe('0')
  })

  it('normalises a tiny negative to "0" (no "-0")', () => {
    expect(formatDxfNumber(-0.0000001)).toBe('0')
    expect(formatDxfNumber(-0)).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// escapeDxfText
// ---------------------------------------------------------------------------

describe('escapeDxfText', () => {
  it('replaces newlines / CR / tab with a single space (stream-safe)', () => {
    expect(escapeDxfText('line1\nline2')).toBe('line1 line2')
    expect(escapeDxfText('a\r\nb')).toBe('a  b') // CR then LF → two spaces
    expect(escapeDxfText('a\tb')).toBe('a b')
  })

  it('degrades non-ASCII to "?" honestly', () => {
    expect(escapeDxfText('Ø45')).toBe('?45')
    expect(escapeDxfText('30 µm')).toBe('30 ?m')
    expect(escapeDxfText('café')).toBe('caf?')
  })

  it('leaves plain ASCII untouched', () => {
    expect(escapeDxfText('30 +/-0.05 A B C')).toBe('30 +/-0.05 A B C')
    expect(escapeDxfText('R12.5')).toBe('R12.5')
  })

  it('leaves R12-inert backslash / caret as literal characters', () => {
    expect(escapeDxfText('a\\b^c')).toBe('a\\b^c')
  })

  it('is pure — same input → same output', () => {
    const a = escapeDxfText('Ø30\nnote')
    const b = escapeDxfText('Ø30\nnote')
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// emitEntity — LINE
// ---------------------------------------------------------------------------

describe('emitEntity: LINE', () => {
  it('emits the LINE group codes in order (0/8/10/20/30/11/21/31)', () => {
    const e: DxfEntity = {
      type: 'line',
      layer: DXF_LAYERS.PROJECTION,
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 }
    }
    expect(emitEntity(e)).toEqual([
      '0', 'LINE',
      '8', 'PROJECTION',
      '10', '1', '20', '2', '30', '0',
      '11', '3', '21', '4', '31', '0'
    ])
  })

  it('includes a group-6 linetype override when present', () => {
    const e: DxfEntity = {
      type: 'line',
      layer: DXF_LAYERS.CENTERLINES,
      linetype: 'CENTER',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 }
    }
    const out = emitEntity(e)
    const i6 = out.indexOf('6')
    expect(i6).toBeGreaterThan(-1)
    expect(out[i6 + 1]).toBe('CENTER')
  })

  it('omits group-6 when no linetype override', () => {
    const e: DxfEntity = {
      type: 'line',
      layer: DXF_LAYERS.PROJECTION,
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 }
    }
    expect(emitEntity(e)).not.toContain('6')
  })
})

// ---------------------------------------------------------------------------
// emitEntity — LWPOLYLINE
// ---------------------------------------------------------------------------

describe('emitEntity: LWPOLYLINE', () => {
  it('emits vertex count (90), closed flag (70), and one 10/20 per vertex', () => {
    const e: DxfEntity = {
      type: 'polyline',
      layer: DXF_LAYERS.TITLE,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 }
      ]
    }
    const out = emitEntity(e)
    expect(out[0]).toBe('0')
    expect(out[1]).toBe('LWPOLYLINE')
    const i90 = out.indexOf('90')
    expect(out[i90 + 1]).toBe('3') // 3 vertices
    const i70 = out.indexOf('70')
    expect(out[i70 + 1]).toBe('1') // closed
    // Three vertex pairs: after the 70-flag value, the tail is [10,x,20,y]×3.
    const tail = out.slice(i70 + 2)
    expect(tail).toEqual(['10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '5'])
  })

  it('open polyline sets the 70-flag to 0', () => {
    const e: DxfEntity = {
      type: 'polyline',
      layer: DXF_LAYERS.PROJECTION,
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ]
    }
    const out = emitEntity(e)
    const i70 = out.indexOf('70')
    expect(out[i70 + 1]).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// emitEntity — TEXT
// ---------------------------------------------------------------------------

describe('emitEntity: TEXT', () => {
  it('emits insertion point (10/20), height (40), and escaped value (1)', () => {
    const e: DxfEntity = {
      type: 'text',
      layer: DXF_LAYERS.DIMENSIONS,
      at: { x: 5, y: 6 },
      height: 3,
      value: '30.5'
    }
    const out = emitEntity(e)
    expect(out.slice(0, 4)).toEqual(['0', 'TEXT', '8', 'DIMENSIONS'])
    const i40 = out.indexOf('40')
    expect(out[i40 + 1]).toBe('3')
    const i1 = out.indexOf('1')
    expect(out[i1 + 1]).toBe('30.5')
  })

  it('escapes control codes in the value', () => {
    const e: DxfEntity = {
      type: 'text',
      layer: DXF_LAYERS.ANNOTATIONS,
      at: { x: 0, y: 0 },
      height: 3,
      value: 'Ø30\nnote'
    }
    const out = emitEntity(e)
    const i1 = out.indexOf('1')
    expect(out[i1 + 1]).toBe('?30 note')
  })

  it('emits rotation (50) only when non-zero', () => {
    const rotated: DxfEntity = {
      type: 'text',
      layer: DXF_LAYERS.ANNOTATIONS,
      at: { x: 0, y: 0 },
      height: 3,
      value: 'x',
      rotationDeg: 90
    }
    expect(emitEntity(rotated)).toContain('50')
    const unrotated: DxfEntity = {
      type: 'text',
      layer: DXF_LAYERS.ANNOTATIONS,
      at: { x: 0, y: 0 },
      height: 3,
      value: 'x'
    }
    expect(emitEntity(unrotated)).not.toContain('50')
  })

  it('emits a 72 justification + alignment point for center align', () => {
    const e: DxfEntity = {
      type: 'text',
      layer: DXF_LAYERS.DIMENSIONS,
      at: { x: 2, y: 3 },
      height: 3,
      value: 'x',
      hAlign: 'center'
    }
    const out = emitEntity(e)
    const i72 = out.indexOf('72')
    expect(out[i72 + 1]).toBe('1')
    // Alignment point group 11/21 present.
    expect(out).toContain('11')
    expect(out).toContain('21')
  })
})

// ---------------------------------------------------------------------------
// emitEntity — CIRCLE
// ---------------------------------------------------------------------------

describe('emitEntity: CIRCLE', () => {
  it('emits the CIRCLE group codes in order (0/8/10/20/30/40)', () => {
    const e: DxfEntity = {
      type: 'circle',
      layer: DXF_LAYERS.ANNOTATIONS,
      center: { x: 5, y: 6 },
      radius: 1.6
    }
    expect(emitEntity(e)).toEqual([
      '0', 'CIRCLE',
      '8', 'ANNOTATIONS',
      '10', '5', '20', '6', '30', '0',
      '40', '1.6'
    ])
  })

  it('includes a group-6 linetype override when present', () => {
    const e: DxfEntity = {
      type: 'circle',
      layer: DXF_LAYERS.CENTERLINES,
      linetype: 'CENTER',
      center: { x: 0, y: 0 },
      radius: 2
    }
    const out = emitEntity(e)
    const i6 = out.indexOf('6')
    expect(i6).toBeGreaterThan(-1)
    expect(out[i6 + 1]).toBe('CENTER')
  })

  it('omits group-6 when no linetype override', () => {
    const e: DxfEntity = {
      type: 'circle',
      layer: DXF_LAYERS.ANNOTATIONS,
      center: { x: 0, y: 0 },
      radius: 2
    }
    expect(emitEntity(e)).not.toContain('6')
  })
})

// ---------------------------------------------------------------------------
// assembleDxfDocument — section order, tables, header, EOF
// ---------------------------------------------------------------------------

describe('assembleDxfDocument', () => {
  const sampleEntities: DxfEntity[] = [
    {
      type: 'line',
      layer: DXF_LAYERS.PROJECTION,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 }
    },
    {
      type: 'text',
      layer: DXF_LAYERS.DIMENSIONS,
      at: { x: 5, y: 5 },
      height: 3,
      value: '14.14'
    }
  ]

  it('emits sections in canonical order: HEADER, TABLES, BLOCKS, ENTITIES', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    const sectionNames = readGroups(dxf)
      .filter((p, i, all) => p.code === '2' && all[i - 1]?.value === 'SECTION')
      .map((p) => p.value)
    expect(sectionNames).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'])
  })

  it('has exactly one EOF and it is the final token', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    const groups = readGroups(dxf)
    const eofs = groups.filter((p) => p.code === '0' && p.value === 'EOF')
    expect(eofs).toHaveLength(1)
    expect(groups[groups.length - 1]).toEqual({ code: '0', value: 'EOF' })
  })

  it('SECTION count matches ENDSEC count (balanced)', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    expect(countEntities(dxf, 'SECTION')).toBe(countEntities(dxf, 'ENDSEC'))
    expect(countEntities(dxf, 'SECTION')).toBe(4)
  })

  it('declares millimetres via $INSUNITS = 4 in the header', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    const groups = readGroups(dxf)
    const insunitsIdx = groups.findIndex((p) => p.code === '9' && p.value === '$INSUNITS')
    expect(insunitsIdx).toBeGreaterThan(-1)
    expect(groups[insunitsIdx + 1]).toEqual({ code: '70', value: '4' })
  })

  it('declares R12 via $ACADVER = AC1009', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    const groups = readGroups(dxf)
    const idx = groups.findIndex((p) => p.code === '9' && p.value === '$ACADVER')
    expect(groups[idx + 1]).toEqual({ code: '1', value: 'AC1009' })
  })

  it('includes the LTYPE table with CONTINUOUS, HIDDEN, CENTER linetypes', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    // The linetype names appear as group-2 values inside the LTYPE table.
    const names = new Set(DXF_LINETYPES.map((lt) => lt.name))
    for (const name of names) {
      expect(dxf).toContain(name)
    }
    // The HIDDEN + CENTER linetypes carry group-49 dash elements.
    expect(dxf).toContain('49')
  })

  it('includes the LAYER table with all six named layers', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    for (const layer of [
      DXF_LAYERS.PROJECTION,
      DXF_LAYERS.HIDDEN,
      DXF_LAYERS.DIMENSIONS,
      DXF_LAYERS.ANNOTATIONS,
      DXF_LAYERS.CENTERLINES,
      DXF_LAYERS.TITLE
    ]) {
      expect(dxf).toContain(layer)
    }
  })

  it('emits an empty-but-present ENTITIES section for an empty entity list', () => {
    const dxf = assembleDxfDocument([])
    expect(countEntities(dxf, 'SECTION')).toBe(4)
    expect(countEntities(dxf, 'EOF')).toBe(1)
    // No LINE/TEXT/LWPOLYLINE entities.
    expect(countEntities(dxf, 'LINE')).toBe(0)
    expect(countEntities(dxf, 'TEXT')).toBe(0)
    expect(countEntities(dxf, 'LWPOLYLINE')).toBe(0)
  })

  it('assigns each entity to its declared layer', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    const layers = entityLayers(dxf)
    expect(layers).toEqual([
      { type: 'LINE', layer: 'PROJECTION' },
      { type: 'TEXT', layer: 'DIMENSIONS' }
    ])
  })

  it('emits $EXTMIN/$EXTMAX when extents are supplied', () => {
    const dxf = assembleDxfDocument(sampleEntities, {
      extents: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }
    })
    expect(valuesForCode(dxf, '9')).toContain('$EXTMIN')
    expect(valuesForCode(dxf, '9')).toContain('$EXTMAX')
  })

  it('uses CRLF line separators', () => {
    const dxf = assembleDxfDocument(sampleEntities)
    expect(dxf).toContain('\r\n')
    expect(dxf.split('\r\n').length).toBeGreaterThan(1)
  })

  it('is byte-stable: same input → identical output', () => {
    const a = assembleDxfDocument(sampleEntities)
    const b = assembleDxfDocument(sampleEntities)
    expect(a).toBe(b)
  })

  it('emits a CIRCLE entity in the ENTITIES section on its layer', () => {
    const dxf = assembleDxfDocument([
      { type: 'circle', layer: DXF_LAYERS.ANNOTATIONS, center: { x: 1, y: 2 }, radius: 1.6 }
    ])
    expect(countEntities(dxf, 'CIRCLE')).toBe(1)
    expect(entityLayers(dxf)).toEqual([{ type: 'CIRCLE', layer: 'ANNOTATIONS' }])
  })
})

// ---------------------------------------------------------------------------
// computeEntitiesExtents
// ---------------------------------------------------------------------------

describe('computeEntitiesExtents', () => {
  it('returns null for an empty list', () => {
    expect(computeEntitiesExtents([])).toBeNull()
  })

  it('bounds every point across line + polyline + text', () => {
    const ext = computeEntitiesExtents([
      { type: 'line', layer: DXF_LAYERS.PROJECTION, start: { x: -5, y: 2 }, end: { x: 3, y: 8 } },
      {
        type: 'polyline',
        layer: DXF_LAYERS.TITLE,
        closed: false,
        points: [
          { x: 10, y: -1 },
          { x: 0, y: 0 }
        ]
      },
      { type: 'text', layer: DXF_LAYERS.ANNOTATIONS, at: { x: 4, y: 12 }, height: 3, value: 'x' }
    ])
    expect(ext).toEqual({ min: { x: -5, y: -1 }, max: { x: 10, y: 12 } })
  })

  it('bounds a circle by its centre ± radius', () => {
    const ext = computeEntitiesExtents([
      { type: 'circle', layer: DXF_LAYERS.ANNOTATIONS, center: { x: 10, y: 20 }, radius: 3 }
    ])
    expect(ext).toEqual({ min: { x: 7, y: 17 }, max: { x: 13, y: 23 } })
  })
})
