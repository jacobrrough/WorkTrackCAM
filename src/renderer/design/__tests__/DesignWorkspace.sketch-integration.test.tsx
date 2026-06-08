/**
 * DesignWorkspace — FG-3 / FG-5 Wave-2 Integrate render-pins.
 *
 * Proves the new ribbon-driven cockpit wiring is REACHABLE + correctly gated:
 *
 *   1. `sketchActive` swaps the cockpit center pane from the 3D viewport to the
 *      mounted 2D sketcher (`MvpSketchCanvas` — `sketch-mvp-wrap`). The viewport
 *      pane host stays (it's the positioning context) but the Viewport3D/empty
 *      body is replaced by the sketch host.
 *   2. The ribbon-armed sketch tool surfaces as an honest read-out above the
 *      sketcher (`design-workspace-sketch-armed`) resolved to its friendly name.
 *   3. The Finish-sketch affordance renders only when the host wires
 *      `onSketchExit`.
 *   4. `requestedFeatureDialog` opens that dialog in the Properties pane (the
 *      `fd-host` wrapper) — but ONLY when `onAppendKernelOp` is also wired (the
 *      FG-5b additive gate); without it the section stays absent.
 *   5. `onCommandSurface` is OPTIONAL + additive — omitting it must not change
 *      any existing render (the splash-preview / legacy path).
 *
 * `renderToStaticMarkup` is one-shot SSR (no effects, no clicks): the
 * `sketchActive`/`requestedFeatureDialog` *seed* drives the branch render, which
 * is the same node-env constraint the sibling Design pins document.
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

const noop = (): void => undefined

describe('DesignWorkspace — FG-3 mounted sketcher', () => {
  it('mounts the 2D sketcher in the center when sketchActive is true', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
      }),
    )
    expect(html).toContain('data-testid="design-workspace-sketch-host"')
    // The self-contained MvpSketchCanvas mounts (its palette + ribbon render).
    expect(html).toContain('data-testid="sketch-mvp-wrap"')
    expect(html).toContain('data-testid="sketch-mvp-dof-badge"')
  })

  it('renders the 3D viewport (not the sketcher) when sketchActive is false', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: false,
      }),
    )
    expect(html).not.toContain('data-testid="design-workspace-sketch-host"')
    expect(html).not.toContain('data-testid="sketch-mvp-wrap"')
    // The viewport column host is still present.
    expect(html).toContain('data-testid="design-workspace-viewport"')
  })

  it('surfaces the ribbon-armed sketch tool as a friendly read-out', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
        armedSketchTool: 'sk_line',
      }),
    )
    expect(html).toContain('data-testid="design-workspace-sketch-armed"')
    // 'sk_line' resolves through sketchToolForDesignCommand → 'line'.
    expect(html).toContain('line')
  })

  it('hides the armed read-out when no tool is armed', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
        armedSketchTool: null,
      }),
    )
    expect(html).not.toContain('data-testid="design-workspace-sketch-armed"')
  })

  it('renders the Finish-sketch button only when onSketchExit is wired', () => {
    const withExit = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
        onSketchExit: noop,
      }),
    )
    const withoutExit = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
      }),
    )
    expect(withExit).toContain('data-testid="design-workspace-sketch-finish"')
    expect(withoutExit).not.toContain('data-testid="design-workspace-sketch-finish"')
  })

  it('the Finish-sketch button is a type="button"', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
        onSketchExit: noop,
      }),
    )
    const tag = html.match(/<button[^>]*data-testid="design-workspace-sketch-finish"[^>]*>/)
    expect(tag).not.toBeNull()
    expect(tag?.[0].includes('type="button"')).toBe(true)
  })

  it('the empty-state branch still wins over sketchActive (no script = no cockpit)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '',
        sketchActive: true,
      }),
    )
    expect(html).toContain('data-testid="design-workspace-empty"')
    expect(html).not.toContain('data-testid="design-workspace-sketch-host"')
  })
})

describe('DesignWorkspace — FG-5 ribbon-requested feature dialog', () => {
  it('opens the requested dialog in the Properties pane (with onAppendKernelOp)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop,
        requestedFeatureDialog: 'fillet',
      }),
    )
    // The host wrapper renders once a dialog is armed.
    expect(html).toContain('data-testid="fd-host"')
    expect(html).toContain('data-fd-kind="fillet"')
  })

  it('does NOT open a dialog from the request without onAppendKernelOp (gate holds)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        requestedFeatureDialog: 'fillet',
      }),
    )
    // No session → no feature-dialog section at all.
    expect(html).not.toContain('data-testid="design-workspace-feature-dialogs"')
    expect(html).not.toContain('data-testid="fd-host"')
  })
})

describe('DesignWorkspace — additive-prop safety', () => {
  it('omitting all FG-3/FG-5 props renders identically to the pre-integration Part view', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT, onSendToCam: noop }),
    )
    // No new section leaks when the host wires none of the new props.
    expect(html).not.toContain('data-testid="design-workspace-sketch-host"')
    expect(html).not.toContain('data-testid="design-workspace-sketch-armed"')
    // Historical Part view still intact.
    expect(html).toContain('design-workspace__viewport-col')
    expect(html).toContain('data-testid="design-workspace-send-to-cam"')
  })

  it('does not throw or warn on a typical sketch-mode render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(DesignWorkspace, {
          initialScript: STARTER_SCRIPT,
          sketchActive: true,
          armedSketchTool: 'sk_circle_center',
          onSketchExit: noop,
          onToast: noop,
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
