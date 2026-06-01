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
  DRAWING_VIEW_LABELS,
  DrawingView,
  drawingViewTestId,
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
