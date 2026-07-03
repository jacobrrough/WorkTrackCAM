/**
 * DrawingView hole-table model + render pins (node-env) — Phase-5.
 *
 * Sibling of `DrawingView.centermarks.test.tsx` (the template this mirrors). The
 * renderer test environment is `node` (no jsdom, no @testing-library), so the
 * interactive scan→persist path in `DrawingView.tsx` cannot be driven through a
 * rendered component. All of the table logic lives in the pure
 * `drawing-hole-table-model.ts`, which IS unit-testable; the component's static
 * surface is pinned with `renderToStaticMarkup`, and the scan/replace wiring is
 * source-pinned (the drawings-persistence-wiring convention). This suite covers:
 *
 *   1. SCHEMA — a hole-table row + table parse against the persistence schema;
 *      a legacy annotations payload WITHOUT `holeTables` parses unchanged and
 *      defaults it to [] (Safety Rule 2); a full round-trip.
 *   2. PROTOCOL GUARD — `isCadHoleTableRow` accepts well-formed rows and rejects
 *      malformed ones (bad depthMm, missing tag, non-finite coord).
 *   3. MODEL / EMITTERS — `buildHoleTable`; the table-block SVG (header + data
 *      rows + THRU / blind-depth cell + empty-state "No holes found"); the tag
 *      marker SVG (circle + tag at the hole centre); compose splices before
 *      `</svg>`; `removeHoleTable`.
 *   4. DrawingView AFFORDANCE — toolbar + scan button; empty count by default;
 *      a persisted table composes into the canvas SVG (table block + tag layer)
 *      and renders a delete row; a drawing WITHOUT the props still renders
 *      (back-compat); the scan/replace-per-view wiring is source-pinned.
 *
 * Safety Rule 1: documentation overlay only — no G-code / STL touched. No free
 * text reaches the emitters (tags are scanner-minted); ids are escaped
 * defensively all the same.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildHoleTable,
  composeHoleTablesIntoSvg,
  formatHoleDepth,
  formatHoleDiameter,
  holeTableToSvg,
  holeTableLayerSvg,
  holeTagMarkerToSvg,
  holeTagMarkersLayerSvg,
  removeHoleTable,
} from '../drawing-hole-table-model'
import { DrawingView } from '../DrawingView'
import {
  drawingHoleTableRowSchema,
  drawingHoleTableSchema,
  drawingSheetAnnotationsSchema,
  type DrawingHoleTable,
  type DrawingHoleTableRow,
} from '../../../shared/drawing-annotation-schema'
import { isCadHoleTableRow } from '../../../shared/sidecar-protocol'

// -- window.fab shim (see DrawingView.test.tsx for rationale) ------------------
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const DRAWING_VIEW_SRC = readFileSync(join(__dirname, '..', 'DrawingView.tsx'), 'utf-8')

// -- Fixtures ------------------------------------------------------------------

const THROUGH_ROW: DrawingHoleTableRow = {
  tag: 'A1',
  x: 10,
  y: 5,
  diameterMm: 6,
  depthMm: null,
  through: true,
}
const BLIND_ROW: DrawingHoleTableRow = {
  tag: 'A2',
  x: 20,
  y: 5,
  diameterMm: 3,
  depthMm: 4,
  through: false,
}
const TABLE: DrawingHoleTable = {
  id: 'ht-1',
  view: 'top',
  rows: [THROUGH_ROW, BLIND_ROW],
  placement: { x: 10, y: 10 },
}
const EMPTY_TABLE: DrawingHoleTable = {
  id: 'ht-empty',
  view: 'front',
  rows: [],
  placement: { x: 5, y: 5 },
}

// -- (A) Schema ----------------------------------------------------------------

describe('drawingHoleTable schema', () => {
  it('parses a through row (depthMm null) and a blind row (positive depthMm)', () => {
    expect(() => drawingHoleTableRowSchema.parse(THROUGH_ROW)).not.toThrow()
    expect(() => drawingHoleTableRowSchema.parse(BLIND_ROW)).not.toThrow()
  })

  it('rejects a non-positive diameter and a non-positive blind depth', () => {
    expect(() =>
      drawingHoleTableRowSchema.parse({ ...THROUGH_ROW, diameterMm: 0 }),
    ).toThrow()
    expect(() =>
      drawingHoleTableRowSchema.parse({ ...BLIND_ROW, depthMm: 0 }),
    ).toThrow()
  })

  it('parses a placed table and round-trips it through the annotations schema', () => {
    expect(() => drawingHoleTableSchema.parse(TABLE)).not.toThrow()
    const parsed = drawingSheetAnnotationsSchema.parse({ holeTables: [TABLE] })
    expect(parsed.holeTables).toHaveLength(1)
    expect(parsed.holeTables[0]).toEqual(TABLE)
  })

  it('accepts an empty-rows table (a scanned view with no holes)', () => {
    expect(() => drawingHoleTableSchema.parse(EMPTY_TABLE)).not.toThrow()
  })

  it('a legacy annotations payload without holeTables defaults it to [] (Safety Rule 2)', () => {
    const parsed = drawingSheetAnnotationsSchema.parse({})
    expect(parsed.holeTables).toEqual([])
    const legacy = drawingSheetAnnotationsSchema.parse({
      notes: [{ id: 'n1', text: 'LEGACY', placement: { x: 0, y: 0 } }],
    })
    expect(legacy.holeTables).toEqual([])
  })
})

// -- (B) Protocol guard --------------------------------------------------------

describe('isCadHoleTableRow guard', () => {
  it('accepts a well-formed through row and a well-formed blind row', () => {
    expect(isCadHoleTableRow(THROUGH_ROW)).toBe(true)
    expect(isCadHoleTableRow(BLIND_ROW)).toBe(true)
  })

  it('rejects a malformed row', () => {
    expect(isCadHoleTableRow(null)).toBe(false)
    expect(isCadHoleTableRow({ ...THROUGH_ROW, tag: '' })).toBe(false)
    expect(isCadHoleTableRow({ ...THROUGH_ROW, x: Number.NaN })).toBe(false)
    // depthMm must be null OR a finite number.
    expect(isCadHoleTableRow({ ...THROUGH_ROW, depthMm: 'deep' })).toBe(false)
    expect(isCadHoleTableRow({ ...THROUGH_ROW, through: 'yes' })).toBe(false)
    expect(isCadHoleTableRow([THROUGH_ROW])).toBe(false)
  })
})

// -- (C) Model / emitters ------------------------------------------------------

describe('buildHoleTable', () => {
  it('mints a table from scan rows + view + placement with a supplied id', () => {
    const t = buildHoleTable({
      rows: [THROUGH_ROW, BLIND_ROW],
      view: 'top',
      placement: { x: 3, y: 4 },
      id: 'fixed-id',
    })
    expect(t.id).toBe('fixed-id')
    expect(t.view).toBe('top')
    expect(t.rows).toHaveLength(2)
    expect(t.placement).toEqual({ x: 3, y: 4 })
    // Parses into the persistence schema.
    expect(() => drawingHoleTableSchema.parse(t)).not.toThrow()
  })

  it('copies the rows array (no shared reference)', () => {
    const rows = [THROUGH_ROW]
    const t = buildHoleTable({ rows, view: 'top', placement: { x: 0, y: 0 }, id: 'x' })
    expect(t.rows).not.toBe(rows)
    expect(t.rows).toEqual(rows)
  })
})

describe('formatHoleDepth / formatHoleDiameter', () => {
  it('a through hole reads THRU; a blind hole reads its depth', () => {
    expect(formatHoleDepth(THROUGH_ROW)).toBe('THRU')
    expect(formatHoleDepth(BLIND_ROW)).toContain('4')
    expect(formatHoleDepth(BLIND_ROW)).not.toBe('THRU')
  })

  it('diameter is prefixed with the Ø glyph', () => {
    expect(formatHoleDiameter(THROUGH_ROW)).toBe('Ø6')
    expect(formatHoleDiameter(BLIND_ROW)).toBe('Ø3')
  })
})

describe('holeTableToSvg — table block', () => {
  it('renders the header row + one data row per hole with THRU / depth cells', () => {
    const svg = holeTableToSvg(TABLE)
    expect(svg).toContain('class="drawing-hole-table"')
    expect(svg).toContain('data-hole-table-id="ht-1"')
    expect(svg).toContain('data-hole-table-view="top"')
    // Header labels.
    expect(svg).toContain('>Tag<')
    expect(svg).toContain('>Dia<')
    expect(svg).toContain('>Depth<')
    // Data cells: tags, diameters, and THRU / depth.
    expect(svg).toContain('>A1<')
    expect(svg).toContain('>A2<')
    expect(svg).toContain('>Ø6<')
    expect(svg).toContain('>Ø3<')
    expect(svg).toContain('>THRU<')
  })

  it('renders an honest "No holes found" row for an empty table', () => {
    const svg = holeTableToSvg(EMPTY_TABLE)
    expect(svg).toContain('class="drawing-hole-table"')
    expect(svg).toContain('No holes found')
    // No data tags in an empty table.
    expect(svg).not.toContain('>A1<')
  })

  it('is pure: same input → byte-identical output', () => {
    expect(holeTableToSvg(TABLE)).toBe(holeTableToSvg(TABLE))
  })
})

describe('holeTagMarkerToSvg / holeTagMarkersLayerSvg — tag markers', () => {
  it('draws a circle + the tag at the hole centre', () => {
    const svg = holeTagMarkerToSvg(THROUGH_ROW)
    expect(svg).toContain('class="drawing-hole-tag"')
    expect(svg).toContain('data-hole-tag="A1"')
    expect(svg).toContain('<circle')
    expect(svg).toContain('cx="10"')
    expect(svg).toContain('cy="5"')
    expect(svg).toContain('>A1<')
    expect(svg).toContain('stroke="currentColor"')
  })

  it('wraps one marker per hole row in a testable layer', () => {
    const layer = holeTagMarkersLayerSvg(TABLE)
    expect(layer).toContain('class="drawing-hole-tag-layer"')
    expect(layer).toContain('data-testid="design-drawing-hole-tag-layer"')
    expect((layer.match(/data-hole-tag=/g) ?? [])).toHaveLength(2)
  })

  it('returns the empty string when there are no rows to mark', () => {
    expect(holeTagMarkersLayerSvg(EMPTY_TABLE)).toBe('')
  })
})

describe('holeTableLayerSvg / composeHoleTablesIntoSvg', () => {
  it('the combined layer carries the tag markers AND the table block', () => {
    const layer = holeTableLayerSvg(TABLE)
    expect(layer).toContain('class="drawing-hole-table-layer"')
    expect(layer).toContain('drawing-hole-tag-layer')
    expect(layer).toContain('drawing-hole-table"') // the block group
  })

  it('splices the layer in just before </svg>', () => {
    const base = '<svg width="800" height="600"><rect/></svg>'
    const composed = composeHoleTablesIntoSvg(base, [TABLE])
    const rectIdx = composed.indexOf('<rect/>')
    const layerIdx = composed.indexOf('drawing-hole-table-layer')
    const closeIdx = composed.indexOf('</svg>')
    expect(rectIdx).toBeGreaterThanOrEqual(0)
    expect(layerIdx).toBeGreaterThan(rectIdx)
    expect(closeIdx).toBeGreaterThan(layerIdx)
  })

  it('returns the input SVG unchanged when there is nothing to compose', () => {
    const base = '<svg></svg>'
    expect(composeHoleTablesIntoSvg(base, [])).toBe(base)
  })
})

describe('removeHoleTable — pure delete', () => {
  it('removes exactly the matching table (input untouched)', () => {
    const a = buildHoleTable({ rows: [], view: 'top', placement: { x: 0, y: 0 }, id: 'a' })
    const b = buildHoleTable({ rows: [], view: 'front', placement: { x: 0, y: 0 }, id: 'b' })
    const tables = [a, b]
    const next = removeHoleTable(tables, 'b')
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('a')
    expect(tables).toHaveLength(2)
  })

  it('is a no-op for an unknown id', () => {
    const a = buildHoleTable({ rows: [], view: 'top', placement: { x: 0, y: 0 }, id: 'a' })
    expect(removeHoleTable([a], 'nope')).toHaveLength(1)
  })
})

// -- (D) DrawingView affordance + render pins ----------------------------------

describe('DrawingView — hole-table affordance render contract', () => {
  it('renders the hole-table toolbar with the scan button', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-hole-table-toolbar"')
    expect(html).toContain('data-testid="design-drawing-hole-table-scan"')
    expect(html).toContain('Hole table')
  })

  it('reports an empty count by default + hides Clear and the list', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-hole-table-count"')
    expect(html).toContain('No hole table')
    expect(html).not.toContain('data-testid="design-drawing-hole-table-clear"')
    expect(html).not.toContain('data-testid="design-drawing-hole-table-list"')
  })

  it('omits the toolbar in the empty-state branch (no part)', () => {
    const html = renderToStaticMarkup(createElement(DrawingView, { partHandle: null }))
    expect(html).not.toContain('data-testid="design-drawing-hole-table-toolbar"')
  })

  it('composes a persisted table into the canvas SVG + renders the delete row', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedHoleTables: [TABLE],
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    // Both the tag layer AND the table block reach the canvas.
    expect(html).toContain('drawing-hole-table-layer')
    expect(html).toContain('drawing-hole-tag-layer')
    expect(html).toContain('THRU')
    // Count + clear + list + delete row.
    expect(html).toContain('1 hole table, 2 holes')
    expect(html).toContain('data-testid="design-drawing-hole-table-clear"')
    expect(html).toContain('data-testid="design-drawing-hole-table-list"')
    expect(html).toContain('data-testid="design-drawing-hole-table-delete-ht-1"')
  })

  it('renders an honest empty-table state (scanned view with no holes)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedHoleTables: [EMPTY_TABLE],
      }),
    )
    expect(html).toContain('No holes found')
    expect(html).toContain('1 hole table, 0 holes')
  })

  it('renders fine for a drawing WITHOUT the hole-table props (back-compat)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><circle/></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('<circle')
    expect(html).toContain('data-testid="design-drawing-hole-table-toolbar"')
    expect(html).not.toContain('drawing-hole-table-layer')
  })
})

// -- (E) Scan / replace-per-view wiring (source pins) --------------------------

describe('DrawingView — hole-table scan wiring (source pins)', () => {
  it('the scan handler calls the holeTable bridge for the active view', () => {
    expect(DRAWING_VIEW_SRC).toContain(
      'bridge.holeTable!({ handle: partHandle, view: activeView })',
    )
  })

  it('re-scanning replaces the table for the SAME view (one table per view)', () => {
    expect(DRAWING_VIEW_SRC).toContain(
      '(persistedHoleTables ?? []).filter((t) => t.view !== activeView)',
    )
    expect(DRAWING_VIEW_SRC).toContain('onPersistHoleTables?.([...kept, table])')
  })

  it('rows are validated through the shared guard before persisting', () => {
    expect(DRAWING_VIEW_SRC).toContain('readHoleRowsFromResult(res.result)')
    expect(DRAWING_VIEW_SRC).toContain('if (isCadHoleTableRow(entry))')
  })

  it('hole tables compose into displaySvg LAST (on top of every other layer)', () => {
    const centerlineIdx = DRAWING_VIEW_SRC.indexOf('composeCenterlinesIntoSvg(composed')
    const holeIdx = DRAWING_VIEW_SRC.indexOf('composeHoleTablesIntoSvg(composed')
    expect(centerlineIdx).toBeGreaterThan(-1)
    expect(holeIdx).toBeGreaterThan(centerlineIdx)
  })
})
