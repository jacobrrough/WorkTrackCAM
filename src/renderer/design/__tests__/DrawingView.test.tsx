/**
 * DrawingView — CAD V2 drawing-projection render-pin.
 *
 * Pinned contracts (see `../DrawingView.tsx` header for the
 * authoritative list):
 *   1. Empty-state branch (partHandle === null): shared `EmptyState`,
 *      canonical testid `design-drawing-empty`, BEM modifier class
 *      `design-drawing--empty`.
 *   2. Populated-state branch: toolbar exposes Front / Top / Right /
 *      Iso buttons with stable testids, plus an Export PDF/SVG
 *      button when `onExport` is wired.
 *   3. The active view button carries `aria-pressed="true"` AND the
 *      `--active` BEM modifier; the other three are `aria-pressed="false"`.
 *   4. When a `previewSvg` prop is supplied, the component skips the
 *      sidecar round-trip and renders the SVG inline (testid
 *      `design-drawing-svg`).
 *   5. When no SVG is present, the canvas shows the placeholder
 *      (`data-testid="design-drawing-placeholder"`).
 *   6. The component's root container always carries
 *      `data-testid="design-drawing-view"`.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DIMENSION_LABELS,
  DIMENSION_TOOL_ORDER,
  DRAWING_VIEW_LABELS,
  DrawingView,
  dimensionToolTestId,
  drawingViewTestId,
  defaultTitleBlock,
  makeDefaultDimensionSpec,
  type DrawingDimensionKind,
  type DrawingDimensionSpec,
  type DrawingSectionPlane,
  type DrawingTitleBlock,
  type DrawingViewAxis,
} from '../DrawingView'

// ── window.fab shim (see AssemblyView.test.tsx for rationale) ──────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// ── (A) Module shape ───────────────────────────────────────────────────────

describe('DrawingView — module surface', () => {
  it('exports DrawingView, DRAWING_VIEW_LABELS, drawingViewTestId', () => {
    expect(typeof DrawingView).toBe('function')
    expect(typeof DRAWING_VIEW_LABELS).toBe('object')
    expect(typeof drawingViewTestId).toBe('function')
  })

  it('DRAWING_VIEW_LABELS covers all four standard views', () => {
    expect(DRAWING_VIEW_LABELS.front).toBe('Front')
    expect(DRAWING_VIEW_LABELS.top).toBe('Top')
    expect(DRAWING_VIEW_LABELS.right).toBe('Right')
    expect(DRAWING_VIEW_LABELS.iso).toBe('Iso')
  })

  it('drawingViewTestId produces stable design-drawing-view-{axis} tokens', () => {
    const axes: DrawingViewAxis[] = ['front', 'top', 'right', 'iso']
    for (const axis of axes) {
      expect(drawingViewTestId(axis)).toBe(`design-drawing-view-${axis}`)
    }
  })
})

// ── (B) Empty-state branch ─────────────────────────────────────────────────

describe('DrawingView — empty-state render contract', () => {
  it('renders the shared EmptyState when partHandle is null', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: null }),
    )
    expect(html).toContain('data-testid="design-drawing-view"')
    expect(html).toContain('data-testid="design-drawing-empty"')
    expect(html).toContain('No part selected')
  })

  it('uses the BEM-aware design-drawing--empty modifier class', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: null }),
    )
    expect(html).toContain('design-drawing--empty')
  })

  it('does not render the toolbar or any view button in the empty state', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: null, onExport: vi.fn() }),
    )
    expect(html).not.toContain('design-drawing-view-front')
    expect(html).not.toContain('design-drawing-export')
  })
})

// ── (C) Populated-state branch ─────────────────────────────────────────────

describe('DrawingView — populated-state render contract', () => {
  it('renders all four view buttons with the canonical testids', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: 'script:abc' }),
    )
    expect(html).toContain('data-testid="design-drawing-view-front"')
    expect(html).toContain('data-testid="design-drawing-view-top"')
    expect(html).toContain('data-testid="design-drawing-view-right"')
    expect(html).toContain('data-testid="design-drawing-view-iso"')
  })

  it('marks the initial view as pressed + active', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: 'script:abc', initialView: 'top' }),
    )
    // Pull the full <button> tags so we can assert attributes in any
    // JSX-runtime order.
    const topTag = html.match(/<button[^>]*data-testid="design-drawing-view-top"[^>]*>/)
    const frontTag = html.match(/<button[^>]*data-testid="design-drawing-view-front"[^>]*>/)
    expect(topTag).not.toBeNull()
    expect(frontTag).not.toBeNull()
    expect(topTag?.[0].includes('aria-pressed="true"')).toBe(true)
    expect(topTag?.[0].includes('design-drawing__view-btn--active')).toBe(true)
    expect(frontTag?.[0].includes('aria-pressed="false"')).toBe(true)
    expect(frontTag?.[0].includes('design-drawing__view-btn--active')).toBe(false)
  })

  it('renders an Export PDF/SVG button when onExport is wired', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        onExport: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-drawing-export"')
    expect(html).toContain('Export PDF/SVG')
  })

  it('omits the Export button when no onExport handler is wired', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: 'script:abc' }),
    )
    expect(html).not.toContain('design-drawing-export')
  })

  it('disables the Export button until an SVG has been produced', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        onExport: vi.fn(),
      }),
    )
    expect(html).toMatch(/data-testid="design-drawing-export"[^>]*disabled/)
  })

  it('renders the inline SVG when previewSvg is supplied', () => {
    const svg = '<svg width="10" height="10"><rect width="10" height="10"/></svg>'
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: svg,
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('<rect')
  })

  it('renders the placeholder when no SVG and no preview is wired', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: 'script:abc' }),
    )
    expect(html).toContain('data-testid="design-drawing-placeholder"')
  })

  it('does not produce console errors on a typical render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(DrawingView, {
          partHandle: 'script:abc',
          onExport: vi.fn(),
          onToast: vi.fn(),
          previewSvg: '<svg></svg>',
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

// ── (D) CAD V1.5 — Dimension toolbar / Section toggle / Title-block panel ──
//
// 12 render-pin tests pinning the V1.5 surface:
//   - 4× module-shape (defaults / labels / testid generators)
//   - 5× dimension-toolbar JSX contracts (buttons / count / clear button)
//   - 5× section / title-block contracts (toggle pressed-state / inputs)
//     (overlap: a couple of pins exercise multiple V1.5 contracts in one
//      render to keep the surface area manageable.)

describe('DrawingView V1.5 — module surface', () => {
  it('exports DIMENSION_TOOL_ORDER + DIMENSION_LABELS for every kind', () => {
    expect(DIMENSION_TOOL_ORDER).toEqual(['distance', 'radius', 'diameter', 'angle'])
    for (const kind of DIMENSION_TOOL_ORDER) {
      expect(typeof DIMENSION_LABELS[kind]).toBe('string')
      expect(DIMENSION_LABELS[kind].length).toBeGreaterThan(0)
    }
  })

  it('dimensionToolTestId produces stable design-drawing-dim-{kind} tokens', () => {
    const kinds: DrawingDimensionKind[] = ['distance', 'radius', 'diameter', 'angle']
    for (const kind of kinds) {
      expect(dimensionToolTestId(kind)).toBe(`design-drawing-dim-${kind}`)
    }
  })

  it('defaultTitleBlock returns a normalized 5-field block', () => {
    const tb = defaultTitleBlock()
    expect(tb).toEqual({ name: '', scale: '1:1', author: '', date: '', sheet: '1 of 1' })
  })

  it('makeDefaultDimensionSpec returns the expected shape per kind', () => {
    const distance = makeDefaultDimensionSpec('distance')
    expect(distance.kind).toBe('distance')
    expect((distance as DrawingDimensionSpec & { kind: 'distance' }).offset).toBe(8)
    const radius = makeDefaultDimensionSpec('radius')
    expect(radius.kind).toBe('radius')
    const diameter = makeDefaultDimensionSpec('diameter')
    expect(diameter.kind).toBe('diameter')
    const angle = makeDefaultDimensionSpec('angle')
    expect(angle.kind).toBe('angle')
  })
})

describe('DrawingView V1.5 — Dimensions toolbar render contract', () => {
  it('renders the dimensions toolbar with all four dimension buttons', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-dim-toolbar"')
    expect(html).toContain('data-testid="design-drawing-dim-distance"')
    expect(html).toContain('data-testid="design-drawing-dim-radius"')
    expect(html).toContain('data-testid="design-drawing-dim-diameter"')
    expect(html).toContain('data-testid="design-drawing-dim-angle"')
  })

  it('renders an empty dimension count when initialDimensions is omitted', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-dim-count"')
    expect(html).toContain('No dimensions added')
    // Clear button is hidden when the list is empty.
    expect(html).not.toContain('data-testid="design-drawing-dim-clear"')
  })

  it('reports the right tally when initialDimensions seeds the list', () => {
    const dims: DrawingDimensionSpec[] = [
      makeDefaultDimensionSpec('distance'),
      makeDefaultDimensionSpec('radius'),
    ]
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        initialDimensions: dims,
      }),
    )
    expect(html).toContain('2 dimensions')
    // Clear button is visible when there's at least one dimension.
    expect(html).toContain('data-testid="design-drawing-dim-clear"')
  })

  it('renders the singular dimension label when only one dimension exists', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        initialDimensions: [makeDefaultDimensionSpec('distance')],
      }),
    )
    expect(html).toMatch(/>1 dimension</)
  })

  it('omits the entire dimension toolbar in the empty-state branch', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: null }),
    )
    expect(html).not.toContain('data-testid="design-drawing-dim-toolbar"')
  })
})

describe('DrawingView V1.5 — Section toggle + Title-block panel', () => {
  it('renders the section toggle in the OFF state by default', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-section-toggle"')
    expect(html).toMatch(
      /<button[^>]*data-testid="design-drawing-section-toggle"[^>]*aria-pressed="false"/,
    )
    expect(html).toContain('Section: OFF')
    // Inputs are hidden until the toggle is enabled.
    expect(html).not.toContain('data-testid="design-drawing-section-axis"')
    expect(html).not.toContain('data-testid="design-drawing-section-offset"')
  })

  it('renders the axis + offset controls when initialSectionPlane is supplied', () => {
    const plane: DrawingSectionPlane = { axis: 'y', offset: 12.5, keepSide: 'positive' }
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        initialSectionPlane: plane,
      }),
    )
    expect(html).toMatch(
      /<button[^>]*data-testid="design-drawing-section-toggle"[^>]*aria-pressed="true"/,
    )
    expect(html).toContain('Section: ON')
    expect(html).toContain('data-testid="design-drawing-section-axis"')
    expect(html).toContain('data-testid="design-drawing-section-offset"')
    expect(html).toContain('design-drawing__section-toggle--on')
  })

  it('renders the title-block side panel with all five fields', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-title-panel"')
    expect(html).toContain('data-testid="design-drawing-title-name"')
    expect(html).toContain('data-testid="design-drawing-title-scale"')
    expect(html).toContain('data-testid="design-drawing-title-author"')
    expect(html).toContain('data-testid="design-drawing-title-date"')
    expect(html).toContain('data-testid="design-drawing-title-sheet"')
  })

  it('seeds the title-block inputs from initialTitleBlock', () => {
    const tb: DrawingTitleBlock = {
      name: 'Bracket-V1',
      scale: '2:1',
      author: 'Jacob',
      date: '2026-06-01',
      sheet: '2 of 4',
    }
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        initialTitleBlock: tb,
      }),
    )
    expect(html).toContain('value="Bracket-V1"')
    expect(html).toContain('value="2:1"')
    expect(html).toContain('value="Jacob"')
    expect(html).toContain('value="2026-06-01"')
    expect(html).toContain('value="2 of 4"')
  })

  it('omits the title-block panel in the empty-state branch', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: null }),
    )
    expect(html).not.toContain('data-testid="design-drawing-title-panel"')
    expect(html).not.toContain('data-testid="design-drawing-section-toggle"')
  })
})
