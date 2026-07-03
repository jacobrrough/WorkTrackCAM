/**
 * DrawingView — Wave 6 hidden-line-removal (HLR) toggle render-pins.
 *
 * Pins the "Hidden lines" toggle surface + its re-project wiring:
 *   1. The toggle renders in the Drawing-views toolbar with a stable testid
 *      (`design-drawing-hlr-toggle`), defaulting OFF (`aria-pressed="false"`,
 *      "Hidden lines: OFF").
 *   2. `initialHlr: true` lands the component in the ON state
 *      (`aria-pressed="true"`, "Hidden lines: ON", `--on` BEM modifier) and the
 *      projection-caveat note switches to the HLR wording.
 *   3. The toggle is absent in the empty-state branch.
 *   4. Wiring source-pin: the projection effect threads `includeHlr: hlrEnabled`
 *      into the `projectDrawing` bridge call AND `hlrEnabled` sits in the
 *      effect's dependency array (so toggling re-projects on the busy path).
 *      Static render can't drive the async effect, so the wiring is pinned at
 *      the source — the same posture the sibling DrawingView pin-tests use.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrawingView } from '../DrawingView'

// ── window.fab shim (see DrawingView.test.tsx for rationale) ────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const HLR_TOGGLE_TESTID = 'design-drawing-hlr-toggle'

describe('DrawingView HLR — toggle render contract', () => {
  it('renders the Hidden-lines toggle OFF by default', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain(`data-testid="${HLR_TOGGLE_TESTID}"`)
    const tag = html.match(
      new RegExp(`<button[^>]*data-testid="${HLR_TOGGLE_TESTID}"[^>]*>`),
    )
    expect(tag).not.toBeNull()
    expect(tag?.[0].includes('aria-pressed="false"')).toBe(true)
    expect(html).toContain('Hidden lines: OFF')
    // The OFF caveat wording points the operator at the toggle. (React
    // entity-escapes the double-quotes in the rendered markup, so match on the
    // quote-free spans that bracket the escaped token.)
    expect(html).toContain('Enable ')
    expect(html).toContain('above for true hidden-line removal')
  })

  it('renders the Hidden-lines toggle ON when initialHlr is true', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        initialHlr: true,
      }),
    )
    const tag = html.match(
      new RegExp(`<button[^>]*data-testid="${HLR_TOGGLE_TESTID}"[^>]*>`),
    )
    expect(tag).not.toBeNull()
    expect(tag?.[0].includes('aria-pressed="true"')).toBe(true)
    expect(tag?.[0].includes('design-drawing__hlr-toggle--on')).toBe(true)
    expect(html).toContain('Hidden lines: ON')
    // The ON caveat wording confirms true HLR is active.
    expect(html).toContain('True hidden-line removal is ON')
  })

  it('omits the Hidden-lines toggle in the empty-state branch', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, { partHandle: null }),
    )
    expect(html).not.toContain(`data-testid="${HLR_TOGGLE_TESTID}"`)
  })

  it('does not regress the existing view toolbar buttons', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        onExport: () => { /* noop */ },
      }),
    )
    // The HLR toggle sits alongside the four view buttons + export button.
    expect(html).toContain('data-testid="design-drawing-view-front"')
    expect(html).toContain('data-testid="design-drawing-view-iso"')
    expect(html).toContain('data-testid="design-drawing-export"')
    expect(html).toContain(`data-testid="${HLR_TOGGLE_TESTID}"`)
  })
})

describe('DrawingView HLR — re-project wiring source-pin', () => {
  const SRC = readFileSync(join(__dirname, '..', 'DrawingView.tsx'), 'utf-8')

  it('threads includeHlr: hlrEnabled into the projectDrawing bridge call', () => {
    expect(SRC).toContain('includeHlr: hlrEnabled')
    // The bridge payload type carries the optional includeHlr field.
    expect(SRC).toContain('readonly includeHlr?: boolean')
  })

  it('lists hlrEnabled in the base-projection effect dependency array', () => {
    // The effect that fetches the base projection must depend on hlrEnabled so
    // toggling re-runs it (re-projecting through the busy/progress affordance).
    // Assert the dep block that also carries activeView + previewSvg contains
    // hlrEnabled — proving the toggle is a re-projection trigger.
    const depBlockMatch = SRC.match(
      /previewSvg,\s*hlrEnabled,\s*sectionEnabled,/,
    )
    expect(depBlockMatch).not.toBeNull()
  })

  it('drives the toggle through a stable useState + toggleHlr callback', () => {
    expect(SRC).toContain('const [hlrEnabled, setHlrEnabled] = useState<boolean>(initialHlr)')
    expect(SRC).toContain('const toggleHlr = useCallback')
    expect(SRC).toContain('setHlrEnabled((prev) => !prev)')
  })
})
