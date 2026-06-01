/**
 * MvpSketchCanvas — render-contract pin (CAD V1 MVP).
 *
 * Uses ``react-dom/server.renderToStaticMarkup`` to keep the suite in
 * the existing ``node`` vitest environment without a jsdom dependency
 * (matches the EmptyState / CadQueryEditor / FeatureTree pattern).
 *
 * Contract pinned here:
 *   - Renders a ``.sketch-mvp-wrap`` shell with a tool palette and the
 *     canvas column.
 *   - Surfaces every tool from ``SKETCH_TOOLS`` as a button with a
 *     stable ``data-testid="sketch-mvp-tool-<id>"`` and an
 *     ``aria-pressed`` state.
 *   - Defaults the active tool to ``select`` (no draw on first paint).
 *   - The ribbon includes Solve, Undo, Redo, Clear buttons that the
 *     keyboard-driven test below depends on.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MvpSketchCanvas } from '../Sketch2DCanvas'
import { SKETCH_TOOLS } from '../sketch-tools'

describe('MvpSketchCanvas — render contract', () => {
  it('renders the sketch-mvp-wrap shell with a tool palette and the canvas column', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    expect(html).toContain('data-testid="sketch-mvp-wrap"')
    expect(html).toContain('data-testid="sketch-mvp-palette"')
    expect(html).toContain('data-testid="sketch-mvp-ribbon"')
  })

  it('renders a button for every tool in SKETCH_TOOLS', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    for (const t of SKETCH_TOOLS) {
      expect(html).toContain(`data-testid="sketch-mvp-tool-${t.id}"`)
      expect(html).toContain(t.label)
    }
  })

  it('defaults the active tool to "select"', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    expect(html).toContain('data-active-tool="select"')
    // The Select button is pressed
    expect(html).toMatch(/data-testid="sketch-mvp-tool-select"[^>]*aria-pressed="true"/)
  })

  it('exposes Solve / Undo / Redo / Clear ribbon buttons', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    expect(html).toContain('data-testid="sketch-mvp-solve"')
    expect(html).toContain('data-testid="sketch-mvp-undo"')
    expect(html).toContain('data-testid="sketch-mvp-redo"')
    expect(html).toContain('data-testid="sketch-mvp-clear"')
  })

  it('Solve / Undo / Redo are disabled on an empty sketch (no constraints, no history)', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    // React serialises attributes alphabetically -- disabled appears
    // BEFORE data-testid. Pin: each button has both attrs in the same tag.
    for (const id of ['sketch-mvp-solve', 'sketch-mvp-undo', 'sketch-mvp-redo']) {
      const re = new RegExp(`<button[^>]*disabled[^>]*data-testid="${id}"`)
      expect(html).toMatch(re)
    }
    // Clear is always enabled (no disabled attribute on its tag).
    expect(html).toMatch(/<button[^>]*data-testid="sketch-mvp-clear"(?:(?!disabled)[^>])*>/)
  })

  it('hides the numeric input by default (only shown for distance/radius tools)', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    expect(html).not.toContain('data-testid="sketch-mvp-numeric-input"')
  })

  it('does NOT render an error or ok banner when there is no solver result yet', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    expect(html).not.toContain('data-testid="sketch-mvp-error-banner"')
    expect(html).not.toContain('data-testid="sketch-mvp-ok-banner"')
  })

  it('headless mode skips the canvas element (no jsdom required)', () => {
    const html = renderToStaticMarkup(
      createElement(MvpSketchCanvas, { width: 800, height: 600, headless: true })
    )
    expect(html).not.toContain('data-testid="sketch-mvp-canvas"')
  })
})
