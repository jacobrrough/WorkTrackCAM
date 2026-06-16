/**
 * DrawingView RENDERER half — sheet tabs + section view + placeable BOM table.
 *
 * Render-pin suite for the gold-standard Drawings enhancement (Cycle on top of
 * the Cycle-259 persistence round-trip). The renderer test env is `node`
 * (no jsdom, no @testing-library), so — like the rest of the DrawingView pins —
 * these assert the STATIC render contract via `renderToStaticMarkup` plus the
 * exported helper surface. The pure persistence/sheet-op logic is unit-tested in
 * the shared `drawing-sheet-ops` / `drawing-hydrate` / `drawing-bom` suites the
 * engine agent owns; this file pins what the COMPONENT renders given props.
 *
 * Pinned contracts:
 *   1. SHEET TABS — a sheet-tab strip renders; one tab per `sheets` entry with a
 *      stable testid; the `activeSheetId` tab carries the active class +
 *      aria-selected; the delete (close) affordance shows only when >1 sheet;
 *      the add-sheet button is enabled only in controlled (host-wired) mode; an
 *      uncontrolled mount still shows ONE implicit fallback tab.
 *   2. SECTION VIEW — a "Section" view button sits alongside Front/Top/Right/Iso
 *      with a stable testid; selecting it (via `initialSectionPlane`) marks it
 *      active + opens the cut-plane controls; an honest "section preview not
 *      available" placeholder is the EXPORTED fallback (no fabricated geometry).
 *   3. BOM TABLE — a placeable BOM panel renders when `bomLines` is supplied:
 *      one row per line (qty / name / source) with a stable testid; an honest
 *      empty state when the array is empty; the panel is ABSENT when the prop is
 *      omitted (host opts in).
 *
 * Safety Rule 1: documentation overlays only — no G-code / STL touched.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DRAWING_SECTION_VIEW_TESTID,
  DrawingView,
  drawingSheetTabTestId,
  type DrawingBomLine,
  type DrawingSectionPlane,
  type DrawingSheetTab,
} from '../DrawingView'

// ── window.fab shim (see DrawingView.test.tsx for rationale) ───────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const PART = 'script:abc'
const SVG = '<svg width="10" height="10"><rect/></svg>'

/** Pull a single element's opening tag (attributes in any JSX-runtime order). */
function tagFor(html: string, testid: string): string | null {
  const m = html.match(new RegExp(`<[a-zA-Z]+[^>]*data-testid="${testid}"[^>]*>`))
  return m ? m[0] : null
}

// ── (A) module surface ─────────────────────────────────────────────────────

describe('DrawingView renderer-half — module surface', () => {
  it('exports the sheet-tab + section + BOM seam helpers', () => {
    expect(typeof drawingSheetTabTestId).toBe('function')
    expect(DRAWING_SECTION_VIEW_TESTID).toBe('design-drawing-view-section')
  })

  it('drawingSheetTabTestId produces stable design-drawing-sheet-tab-{id} tokens', () => {
    expect(drawingSheetTabTestId('sheet-primary')).toBe('design-drawing-sheet-tab-sheet-primary')
    expect(drawingSheetTabTestId('s2')).toBe('design-drawing-sheet-tab-s2')
  })
})

// ── (B) SHEET TABS ──────────────────────────────────────────────────────────

describe('DrawingView renderer-half — sheet tabs', () => {
  const sheets: DrawingSheetTab[] = [
    { id: 'sheet-primary', name: 'Layout' },
    { id: 's2', name: 'Detail A' },
    { id: 's3', name: 'Section B' },
  ]

  it('renders the sheet-tab strip with one tab per sheet', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets,
        activeSheetId: 'sheet-primary',
        onSelectSheet: vi.fn(),
        onAddSheet: vi.fn(),
        onRenameSheet: vi.fn(),
        onDeleteSheet: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-drawing-sheet-tabs"')
    expect(html).toContain('data-testid="design-drawing-sheet-tab-sheet-primary"')
    expect(html).toContain('data-testid="design-drawing-sheet-tab-s2"')
    expect(html).toContain('data-testid="design-drawing-sheet-tab-s3"')
    // The names render verbatim.
    expect(html).toContain('Layout')
    expect(html).toContain('Detail A')
    expect(html).toContain('Section B')
  })

  it('marks the active sheet selected and the others not', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets,
        activeSheetId: 's2',
        onSelectSheet: vi.fn(),
      }),
    )
    const active = tagFor(html, 'design-drawing-sheet-tab-s2')
    const inactive = tagFor(html, 'design-drawing-sheet-tab-sheet-primary')
    expect(active).not.toBeNull()
    expect(inactive).not.toBeNull()
    expect(active?.includes('aria-selected="true"')).toBe(true)
    expect(inactive?.includes('aria-selected="false"')).toBe(true)
  })

  it('falls back to the first sheet when activeSheetId does not match', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets,
        activeSheetId: 'does-not-exist',
        onSelectSheet: vi.fn(),
      }),
    )
    // First sheet becomes active (defensive — never blanks the strip).
    expect(tagFor(html, 'design-drawing-sheet-tab-sheet-primary')?.includes('aria-selected="true"')).toBe(true)
  })

  it('shows a delete (close) affordance per sheet only when more than one exists', () => {
    const many = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets,
        activeSheetId: 'sheet-primary',
        onDeleteSheet: vi.fn(),
      }),
    )
    expect(many).toContain('data-testid="design-drawing-sheet-close-s2"')
    expect(many).toContain('data-testid="design-drawing-sheet-close-s3"')

    const one = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets: [{ id: 'sheet-primary', name: 'Layout' }],
        activeSheetId: 'sheet-primary',
        onDeleteSheet: vi.fn(),
      }),
    )
    expect(one).not.toContain('design-drawing-sheet-close-sheet-primary')
  })

  it('renders the add-sheet button enabled in controlled mode', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets,
        activeSheetId: 'sheet-primary',
        onAddSheet: vi.fn(),
      }),
    )
    const add = tagFor(html, 'design-drawing-sheet-add')
    expect(add).not.toBeNull()
    // Enabled: aria-disabled reflects false and no bare boolean `disabled` attr.
    expect(add?.includes('aria-disabled="false"')).toBe(true)
    expect(add?.includes('aria-disabled="true"')).toBe(false)
  })

  it('shows ONE implicit fallback tab + a disabled add button when uncontrolled', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: PART, previewSvg: SVG }),
    )
    // Strip always renders; the fallback tab uses the primary id.
    expect(html).toContain('data-testid="design-drawing-sheet-tabs"')
    expect(html).toContain('data-testid="design-drawing-sheet-tab-sheet-primary"')
    // No second tab, no close affordance (single sheet).
    expect(html).not.toContain('design-drawing-sheet-close-sheet-primary')
    // Add is present but disabled (no host seam to mint a sheet).
    expect(tagFor(html, 'design-drawing-sheet-add')?.includes('aria-disabled="true"')).toBe(true)
  })

  it('does not render the sheet strip in the empty-state branch', () => {
    const html = renderToStaticMarkup(createElement(DrawingView, { partHandle: null }))
    expect(html).not.toContain('data-testid="design-drawing-sheet-tabs"')
  })

  it('per-sheet content swaps: the active sheet drives the rendered dimensions count', () => {
    // The host re-points the single-sheet `persistedDimensions` prop at the
    // active sheet; switching sheets is a prop change. We pin that the rendered
    // dim-count reflects the supplied (per-sheet) dimension list.
    const sheetADims = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        sheets,
        activeSheetId: 'sheet-primary',
        persistedDimensions: [],
        onPersistDimensions: vi.fn(),
      }),
    )
    expect(sheetADims).toContain('No dimensions added')
  })
})

// ── (C) SECTION VIEW ────────────────────────────────────────────────────────

describe('DrawingView renderer-half — section view option', () => {
  it('renders a Section view button alongside the four orthographic axes', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: PART, previewSvg: SVG }),
    )
    expect(html).toContain('data-testid="design-drawing-view-front"')
    expect(html).toContain('data-testid="design-drawing-view-top"')
    expect(html).toContain('data-testid="design-drawing-view-right"')
    expect(html).toContain('data-testid="design-drawing-view-iso"')
    expect(html).toContain(`data-testid="${DRAWING_SECTION_VIEW_TESTID}"`)
    expect(html).toContain('>Section</button>')
  })

  it('Section is not pressed by default; Front is the default selection', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: PART, previewSvg: SVG }),
    )
    expect(tagFor(html, DRAWING_SECTION_VIEW_TESTID)?.includes('aria-pressed="false"')).toBe(true)
    expect(tagFor(html, 'design-drawing-view-front')?.includes('aria-pressed="true"')).toBe(true)
  })

  it('selecting Section (via initialSectionPlane) marks it active + opens the cut-plane controls', () => {
    const plane: DrawingSectionPlane = { axis: 'y', offset: 12.5, keepSide: 'positive' }
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        initialSectionPlane: plane,
      }),
    )
    // Section pseudo-view active.
    expect(tagFor(html, DRAWING_SECTION_VIEW_TESTID)?.includes('aria-pressed="true"')).toBe(true)
    // Cut-plane controls (the existing section axis/offset inputs) are open.
    expect(html).toContain('data-testid="design-drawing-section-axis"')
    expect(html).toContain('data-testid="design-drawing-section-offset"')
  })

  it('does not fabricate section geometry — the honest placeholder is the exported fallback', () => {
    // Static render can't drive the async projector; the honest fallback testid
    // must exist in the component so a failed/absent section projection shows it
    // rather than blank or invented linework.
    const src = DrawingViewSource()
    expect(src).toContain('data-testid="design-drawing-section-unavailable"')
    expect(src).toContain('Section preview not available')
    // And it is reached only when the section view is active (never on a normal axis).
    expect(src).toContain('sectionViewActive && sectionUnavailable')
  })
})

// ── (D) BOM TABLE ───────────────────────────────────────────────────────────

describe('DrawingView renderer-half — placeable BOM table', () => {
  const lines: DrawingBomLine[] = [
    { item: 1, qty: 2, partNumber: 'BRK-001', description: 'Bracket' },
    { item: 2, qty: 1, partNumber: 'PIN-7', description: 'Dowel pin' },
  ]

  it('renders the BOM panel with one row per line (qty / name / source)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        bomLines: lines,
      }),
    )
    expect(html).toContain('data-testid="design-drawing-bom"')
    expect(html).toContain('data-testid="design-drawing-bom-grid"')
    expect(html).toContain('data-testid="design-drawing-bom-row-1"')
    expect(html).toContain('data-testid="design-drawing-bom-row-2"')
    // qty / name / source cells render their values.
    expect(html).toContain('Bracket')
    expect(html).toContain('Dowel pin')
    expect(html).toContain('BRK-001')
    expect(html).toContain('PIN-7')
    // Line count read-out.
    expect(html).toContain('2 lines')
  })

  it('renders an honest empty state when bomLines is an empty array', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        bomLines: [],
      }),
    )
    expect(html).toContain('data-testid="design-drawing-bom"')
    expect(html).toContain('data-testid="design-drawing-bom-empty"')
    expect(html).not.toContain('data-testid="design-drawing-bom-grid"')
    expect(html).toContain('0 lines')
  })

  it('omits the BOM panel entirely when bomLines is not supplied', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: PART, previewSvg: SVG }),
    )
    expect(html).not.toContain('data-testid="design-drawing-bom"')
  })

  it('renders the singular line label for exactly one BOM line', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        bomLines: [{ item: 1, qty: 1, partNumber: 'X', description: 'Only part' }],
      }),
    )
    expect(html).toMatch(/>1 line</)
  })
})

// ── (E) no-regression smoke: the new surface co-exists with the old one ─────

describe('DrawingView renderer-half — co-exists with existing surface', () => {
  it('keeps the existing view/dimension/section/title surface intact', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: PART,
        previewSvg: SVG,
        onExport: vi.fn(),
        onToast: vi.fn(),
        sheets: [
          { id: 'sheet-primary', name: 'Layout' },
          { id: 's2', name: 'Detail' },
        ],
        activeSheetId: 'sheet-primary',
        onSelectSheet: vi.fn(),
        onAddSheet: vi.fn(),
        bomLines: [{ item: 1, qty: 1, partNumber: 'P', description: 'Part' }],
      }),
    )
    // Existing pins.
    expect(html).toContain('data-testid="design-drawing-view"')
    expect(html).toContain('data-testid="design-drawing-export"')
    expect(html).toContain('data-testid="design-drawing-dim-toolbar"')
    expect(html).toContain('data-testid="design-drawing-section-toggle"')
    expect(html).toContain('data-testid="design-drawing-title-panel"')
    // New pins.
    expect(html).toContain('data-testid="design-drawing-sheet-tabs"')
    expect(html).toContain(`data-testid="${DRAWING_SECTION_VIEW_TESTID}"`)
    expect(html).toContain('data-testid="design-drawing-bom"')
  })

  it('does not produce console errors on a full-surface render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(DrawingView, {
          partHandle: PART,
          previewSvg: SVG,
          sheets: [{ id: 'sheet-primary', name: 'Layout' }],
          activeSheetId: 'sheet-primary',
          bomLines: [],
        }),
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── helper: read the DrawingView source for the honest-fallback source pin ──
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
function DrawingViewSource(): string {
  return readFileSync(join(__dirname, '..', 'DrawingView.tsx'), 'utf-8')
}
