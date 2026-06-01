/**
 * DesignWorkspace — CAD V2 view-mode tab bar render-pin.
 *
 * Pinned contracts (see `../DesignWorkspace.tsx` for the source):
 *   1. The tab bar is always rendered at the top of the workspace,
 *      including on the empty-state branch. Testid:
 *      `design-workspace-tabbar`. Each tab carries the canonical testid
 *      defined in `DESIGN_VIEW_TAB_TESTIDS`.
 *   2. The active tab carries `aria-selected="true"` and the
 *      `--active` BEM modifier; the inactive tabs carry
 *      `aria-selected="false"`.
 *   3. When `initialViewMode === 'assembly'`, the AssemblyView's
 *      `design-assembly-view` root mounts AND the Part view's
 *      `design-workspace__editor-col` does NOT — even when the
 *      operator has typed a script.
 *   4. When `initialViewMode === 'drawing'`, the DrawingView's
 *      `design-drawing-view` root mounts AND the editor column does
 *      NOT.
 *   5. The existing Part-view contracts (Send-to-CAM, editor column,
 *      etc.) are preserved when `initialViewMode === 'part'` — this
 *      test re-asserts them against the new render path so a future
 *      tab-bar refactor cannot regress the historical pins.
 *
 * Why `renderToStaticMarkup`? Same rationale as the original
 * `DesignWorkspace.test.tsx` — the project's node-env vitest does not
 * ship a DOM. Tab-switch click handlers are pinned via the active-tab
 * state + the tab-bar render contract.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DESIGN_VIEW_TAB_TESTIDS,
  DesignWorkspace,
  STARTER_SCRIPT,
} from '../DesignWorkspace'

// ── window.fab shim ────────────────────────────────────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// ── (A) Tab bar render contract ────────────────────────────────────────────

describe('DesignWorkspace — tab bar render contract', () => {
  it('exposes DESIGN_VIEW_TAB_TESTIDS for the three modes', () => {
    expect(DESIGN_VIEW_TAB_TESTIDS.part).toBe('design-workspace-tab-part')
    expect(DESIGN_VIEW_TAB_TESTIDS.assembly).toBe('design-workspace-tab-assembly')
    expect(DESIGN_VIEW_TAB_TESTIDS.drawing).toBe('design-workspace-tab-drawing')
  })

  it('renders the tab bar at the top of the Part view', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT }),
    )
    expect(html).toContain('data-testid="design-workspace-tabbar"')
    expect(html).toContain('data-testid="design-workspace-tab-part"')
    expect(html).toContain('data-testid="design-workspace-tab-assembly"')
    expect(html).toContain('data-testid="design-workspace-tab-drawing"')
  })

  it('renders the tab bar on the empty-state branch too', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: '' }),
    )
    // Empty-state branch is preserved so the existing test still passes,
    // but the new tab bar lives alongside it.
    expect(html).toContain('data-testid="design-workspace-empty"')
    expect(html).toContain('data-testid="design-workspace-tabbar"')
    expect(html).toContain('data-testid="design-workspace-tab-assembly"')
  })

  it('marks the active tab via aria-selected="true" + --active modifier', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'part',
      }),
    )
    // Pull the full <button> tag for each tab; assert the attributes
    // are present in any JSX-runtime order.
    const partTag = html.match(/<button[^>]*data-testid="design-workspace-tab-part"[^>]*>/)
    const assemblyTag = html.match(
      /<button[^>]*data-testid="design-workspace-tab-assembly"[^>]*>/,
    )
    expect(partTag).not.toBeNull()
    expect(assemblyTag).not.toBeNull()
    expect(partTag?.[0].includes('aria-selected="true"')).toBe(true)
    expect(partTag?.[0].includes('design-workspace__tab--active')).toBe(true)
    expect(assemblyTag?.[0].includes('aria-selected="false"')).toBe(true)
    expect(assemblyTag?.[0].includes('design-workspace__tab--active')).toBe(false)
  })
})

// ── (B) Tab-switch render branches ─────────────────────────────────────────

describe('DesignWorkspace — view-mode branches', () => {
  it('mounts AssemblyView (not the Part editor) when initialViewMode is assembly', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
      }),
    )
    expect(html).toContain('data-testid="design-assembly-view"')
    // Part view's editor column is NOT in the DOM in assembly mode.
    expect(html).not.toContain('design-workspace__editor-col')
    expect(html).not.toContain('data-testid="design-workspace-viewport"')
  })

  it('mounts DrawingView (not the Part editor) when initialViewMode is drawing', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'drawing',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-view"')
    expect(html).not.toContain('design-workspace__editor-col')
    expect(html).not.toContain('data-testid="design-workspace-viewport"')
  })

  it('keeps the Part view fully rendered when initialViewMode is part', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'part',
        onSendToCam: vi.fn(),
      }),
    )
    // Historical Part view contract MUST still hold.
    expect(html).toContain('design-workspace__editor-col')
    expect(html).toContain('design-workspace__viewport-col')
    expect(html).toContain('design-workspace__tree-col')
    expect(html).toContain('data-testid="design-workspace-send-to-cam"')
  })

  it('seeds the Assembly view from initialAssemblyParts', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: [
          { id: 'p1', name: 'Bracket', handle: 'script:abc' },
        ],
      }),
    )
    expect(html).toContain('data-testid="design-assembly-part-p1"')
    // Toolbar Add still wired (Part view's mesh = null in static render,
    // but the AssemblyView toolbar is independent).
    expect(html).toContain('data-testid="design-assembly-add"')
  })

  it('Drawing view renders the empty-state placeholder when no mesh has been built', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'drawing',
      }),
    )
    // No tessellation in state → activePartHandle is null → DrawingView
    // shows its own empty-state branch.
    expect(html).toContain('data-testid="design-drawing-empty"')
    expect(html).toContain('No part selected')
  })

  it('the assembly branch carries the role="tabpanel" wrapper', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
      }),
    )
    expect(html).toMatch(
      /id="design-workspace-panel-assembly"[^>]*role="tabpanel"|role="tabpanel"[^>]*id="design-workspace-panel-assembly"/,
    )
  })

  it('does not produce console errors on a typical render across all three modes', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      for (const mode of ['part', 'assembly', 'drawing'] as const) {
        renderToStaticMarkup(
          createElement(DesignWorkspace, {
            initialScript: STARTER_SCRIPT,
            initialViewMode: mode,
            onSendToCam: vi.fn(),
            onToast: vi.fn(),
          }),
        )
      }
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
