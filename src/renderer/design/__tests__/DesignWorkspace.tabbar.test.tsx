/**
 * DesignWorkspace — FG-6 view-mode de-dupe render-pin (Wave 2 Integrate).
 *
 * Wave 2 / FG-6 REMOVED the in-workspace Part/Assembly/Drawing tab bar: the
 * shell `WorkspaceNav` (Design · Assemble · Drawings) + the FG-4 ribbon own
 * view switching now, so the divergent in-workspace tab strip was deleted. This
 * pin replaces the former tab-bar render-pin and locks the new contract:
 *
 *   1. NO tab bar renders any more — the `design-workspace-tabbar` element and
 *      the `design-workspace-tab-*` tab buttons are GONE on every branch
 *      (empty-state, Part, Assembly, Drawing). `DESIGN_VIEW_TAB_TESTIDS` is no
 *      longer exported.
 *   2. `activeView` is still driven by `initialViewMode` (the route maps it in
 *      `WorkspaceHost`): `'assembly'` mounts the AssemblyView, `'drawing'` the
 *      DrawingView, `'part'` (default) the Part cockpit — WITHOUT a tab strip.
 *   3. The historical Part-view contracts (Send-to-CAM, the three cockpit
 *      columns) are re-asserted against the de-duped render path so the FG-6
 *      removal cannot regress them.
 *
 * Why `renderToStaticMarkup`? Same rationale as the original — the project's
 * node-env vitest does not ship a DOM. View selection is pinned via the
 * `initialViewMode`-seeded branch render contract.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesignWorkspace, STARTER_SCRIPT } from '../DesignWorkspace'

// ── window.fab shim ────────────────────────────────────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// ── (A) The tab bar is gone (FG-6) ─────────────────────────────────────────

describe('DesignWorkspace — FG-6 tab-bar removal', () => {
  it('renders NO tab bar on the Part view', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT }),
    )
    expect(html).not.toContain('data-testid="design-workspace-tabbar"')
    expect(html).not.toContain('data-testid="design-workspace-tab-part"')
    expect(html).not.toContain('data-testid="design-workspace-tab-assembly"')
    expect(html).not.toContain('data-testid="design-workspace-tab-drawing"')
  })

  it('renders NO tab bar on the empty-state branch', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: '' }),
    )
    // Empty-state branch still renders; the tab bar does not.
    expect(html).toContain('data-testid="design-workspace-empty"')
    expect(html).not.toContain('data-testid="design-workspace-tabbar"')
    expect(html).not.toContain('data-testid="design-workspace-tab-assembly"')
  })

  it('renders NO tab bar on the Assembly or Drawing branches', () => {
    const assembly = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
      }),
    )
    const drawing = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'drawing',
      }),
    )
    expect(assembly).not.toContain('data-testid="design-workspace-tabbar"')
    expect(drawing).not.toContain('data-testid="design-workspace-tabbar"')
  })
})

// ── (B) initialViewMode still drives which body renders ─────────────────────

describe('DesignWorkspace — initialViewMode-driven branches (no tab bar)', () => {
  it('mounts AssemblyView (not the Part editor) when initialViewMode is assembly', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
      }),
    )
    expect(html).toContain('data-testid="design-assembly-view"')
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
    // Historical Part view contract MUST still hold after the de-dupe.
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
    expect(html).toContain('data-testid="design-assembly-add"')
  })

  it('Drawing view renders the empty-state placeholder when no mesh has been built', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'drawing',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-empty"')
    expect(html).toContain('No part selected')
  })

  it('the assembly branch still carries the role="tabpanel" wrapper', () => {
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
