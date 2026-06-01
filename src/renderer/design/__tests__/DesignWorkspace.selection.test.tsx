/**
 * DesignWorkspace — CAD V1 Workflow H selection-foundation render-pin.
 *
 * Pinned contracts:
 *   1. The `data-testid="design-workspace-selection-chip"` element is
 *      ABSENT on a typical mount (no `initialSelection` prop). The
 *      workspace must NOT pre-select anything on a cold start.
 *   2. When `initialSelection` is a face, the chip RENDERS and carries
 *      the friendly label "Face N" (no faceMap available so no area
 *      suffix).
 *   3. The chip uses the BEM-aware `design-workspace__selection-chip`
 *      class so the existing CSS theme covers it without inline
 *      styles (CLAUDE.md design-token rule).
 *   4. The chip carries `role="status"` + `aria-live="polite"` so a
 *      screen reader announces the new selection non-destructively.
 *   5. ESC clearing is wired via the pure `clearSelection` helper —
 *      pinned separately in `selection-state.test.ts` (and the
 *      `useEffect` keydown wiring inside the component runs against
 *      the same helper).
 *
 * Why no live-keydown test? `renderToStaticMarkup` is one-shot SSR — it
 * does NOT mount React to a DOM, so `document.addEventListener` runs
 * outside the SSR context. We assert wiring correctness by pinning the
 * pure helpers + the initial-prop seed flow, which together cover the
 * complete state-transition chain.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesignWorkspace, STARTER_SCRIPT } from '../DesignWorkspace'
import { makeFaceSelection } from '../selection-state'

describe('DesignWorkspace — selection chip render contract', () => {
  it('renders NO selection chip on a typical mount (no initialSelection)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT })
    )
    expect(html).not.toContain('design-workspace-selection-chip')
  })

  it('renders NO selection chip on the empty-state branch even with initialSelection', () => {
    // Empty-state path short-circuits before the chip code path runs;
    // pinning this so a future refactor cannot leak the chip into the
    // first-launch surface where no mesh exists.
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '',
        initialSelection: makeFaceSelection(2),
      })
    )
    expect(html).toContain('data-testid="design-workspace-empty"')
    expect(html).not.toContain('design-workspace-selection-chip')
  })

  it('renders the chip with the canonical "Face N" label when initialSelection is a face', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialSelection: makeFaceSelection(4),
      })
    )
    expect(html).toContain('data-testid="design-workspace-selection-chip"')
    expect(html).toContain('Face 4')
  })

  it('chip uses the BEM-aware design-workspace__selection-chip class (no inline styles)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialSelection: makeFaceSelection(0),
      })
    )
    expect(html).toMatch(/class="design-workspace__selection-chip"/)
    // No inline styles leaking into the chip element.
    expect(html).not.toMatch(/design-workspace__selection-chip"[^>]*style=/)
  })

  it('chip is announced via role="status" + aria-live="polite"', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialSelection: makeFaceSelection(7),
      })
    )
    expect(html).toMatch(
      /design-workspace__selection-chip"[^>]*role="status"[^>]*aria-live="polite"/
    )
  })

  it('does NOT throw or log warnings on a typical render', () => {
    const errs: unknown[] = []
    const warns: unknown[] = []
    const origErr = console.error
    const origWarn = console.warn
    console.error = ((...args: unknown[]) => { errs.push(args) }) as typeof console.error
    console.warn = ((...args: unknown[]) => { warns.push(args) }) as typeof console.warn
    try {
      renderToStaticMarkup(
        createElement(DesignWorkspace, {
          initialScript: STARTER_SCRIPT,
          initialSelection: makeFaceSelection(1),
        })
      )
      expect(errs).toEqual([])
      expect(warns).toEqual([])
    } finally {
      console.error = origErr
      console.warn = origWarn
    }
  })
})
