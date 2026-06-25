/**
 * FG-5b · DesignWorkspace integration pin — the per-feature property dialog is REACHABLE in
 * the Properties pane, gated by the additive contract. The in-panel 6-way picker was RETIRED
 * as a redundant launcher: feature dialogs now open from the Design ribbon's Solid / Construct
 * commands (`requestedFeatureDialog`), and the dialog's header ✕ dismisses it (the picker used
 * to be the only way to close it).
 *
 *   - WITHOUT `onAppendKernelOp` (the splash preview / legacy render-pins): nothing renders.
 *   - WITH `onAppendKernelOp` but NO open dialog: nothing renders (no empty "Features" card).
 *   - WITH `onAppendKernelOp` AND a requested dialog: the dialog card renders, incl. its ✕.
 *
 * `renderToStaticMarkup` is one-shot SSR (effects don't run), so the open state is driven
 * through `effectiveFeatureDialog`'s `requestedFeatureDialog` SSR fallback.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesignWorkspace, STARTER_SCRIPT } from '../DesignWorkspace'

const noop = (): void => undefined

describe('DesignWorkspace — feature-dialog section gating', () => {
  it('does NOT render the feature-dialog section without onAppendKernelOp', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT })
    )
    expect(html).not.toContain('data-testid="design-workspace-feature-dialogs"')
  })

  it('the retired in-panel picker is GONE (features open from the ribbon now)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT, onAppendKernelOp: noop })
    )
    expect(html).not.toContain('data-testid="design-workspace-feature-picker"')
    for (const kind of ['extrude', 'revolve', 'fillet', 'chamfer', 'shell', 'hole']) {
      expect(html).not.toContain(`data-testid="design-workspace-feature-pick-${kind}"`)
    }
  })

  it('renders no feature-dialog card until a dialog is requested (no empty card)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT, onAppendKernelOp: noop })
    )
    expect(html).not.toContain('data-testid="design-workspace-feature-dialogs"')
  })

  it('renders the dialog card + its close ✕ when a feature dialog is requested', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop,
        requestedFeatureDialog: 'extrude'
      })
    )
    expect(html).toContain('data-testid="design-workspace-feature-dialogs"')
    expect(html).toMatch(
      /<button type="button"[^>]*data-testid="design-workspace-feature-dialog-close"/
    )
  })

  it('keeps the existing parameters + Save + Send-to-CAM pins intact', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop,
        onSave: noop,
        onSendToCam: noop
      })
    )
    expect(html).toContain('data-testid="design-workspace-save"')
    expect(html).toContain('data-testid="design-workspace-send-to-cam"')
  })

  it('no dialog host is mounted by default (nothing armed)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT, onAppendKernelOp: noop })
    )
    expect(html).not.toContain('data-testid="fd-host"')
  })
})
