/**
 * StatusBar × CursorCoordsContext — Wave 3n render pins.
 *
 * The sibling `StatusBar.test.tsx` (FG-7) pins the bare-mount honesty: with no
 * provider the X/Y/Z slots degrade to em dashes, never a faked `0.00`. This
 * file pins the LIVE half wired by Wave 3n:
 *
 *   - a `sketch2d` source shows X/Y (two-decimal mm, matching the in-canvas
 *     sketch readout) while Z stays an honest dash — the sketch value is
 *     plane-local, so claiming a world Z would be fabrication;
 *   - a `pick3d` source (last viewport face/edge pick) shows all three;
 *   - no source (provider mounted, nothing published) keeps all three blank.
 *
 * Node-env vitest via `renderToStaticMarkup` (same pattern as the sibling).
 * The provider's `initialCoords` test seam stands in for the live publish —
 * effects/events do not run under static render.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusBar } from '../StatusBar'
import { CursorCoordsProvider, type CursorCoords } from '../CursorCoordsContext'

function renderWithCoords(initialCoords: CursorCoords | null): string {
  return renderToStaticMarkup(
    createElement(CursorCoordsProvider, {
      initialCoords,
      children: createElement(StatusBar, {
        machineName: null,
        units: 'mm',
        activeWorkspace: 'design'
      })
    })
  )
}

describe('StatusBar cursor coordinates (Wave 3n)', () => {
  it('sketch2d source: live X/Y at two decimals; Z stays the honest dash', () => {
    const html = renderWithCoords({ kind: 'sketch2d', xMm: 12.5, yMm: -3 })
    expect(html).toContain('12.50')
    expect(html).toContain('-3.00')
    // The Z slot keeps the em-dash placeholder (plane-local value has no Z).
    expect(html).toMatch(/data-testid="status-coord-z"[^<]*>Z <b>—<\/b>/)
    expect(html).toContain('Sketch cursor (sketch-plane mm)')
  })

  it('pick3d source: the LAST pick shows all three world coordinates', () => {
    const html = renderWithCoords({ kind: 'pick3d', xMm: 10.25, yMm: 20.5, zMm: 5.75 })
    expect(html).toContain('10.25')
    expect(html).toContain('20.50')
    expect(html).toContain('5.75')
    expect(html).toContain('Last viewport pick (world mm)')
  })

  it('no active source: all three slots stay blank (em dash), never 0.00', () => {
    const html = renderWithCoords(null)
    expect(html).not.toContain('0.00')
    expect(html).toMatch(/data-testid="status-coord-x"[^<]*>X <b>—<\/b>/)
    expect(html).toMatch(/data-testid="status-coord-y"[^<]*>Y <b>—<\/b>/)
    expect(html).toMatch(/data-testid="status-coord-z"[^<]*>Z <b>—<\/b>/)
  })

  it('the no-source title points the operator at the live sources', () => {
    const html = renderWithCoords(null)
    expect(html).toContain('No live coordinate source')
  })

  it('provider-less mount (the FG-7 pin context) still degrades to dashes', () => {
    const html = renderToStaticMarkup(
      createElement(StatusBar, { machineName: null, units: 'mm', activeWorkspace: 'design' })
    )
    expect(html).not.toContain('0.00')
    const dashes = html.split('—').length - 1
    expect(dashes).toBeGreaterThanOrEqual(3)
  })
})
