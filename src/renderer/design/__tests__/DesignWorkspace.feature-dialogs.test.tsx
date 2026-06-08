/**
 * FG-5b · DesignWorkspace integration pin — the feature-dialog section is
 * REACHABLE in the Properties pane (not built-but-orphaned, the exact failure
 * the FG-5 audit warns about), and is gated by the additive contract:
 *
 *   - WITHOUT `onAppendKernelOp` (the splash preview / legacy render-pins):
 *     the feature-dialog section does NOT render, so every pre-existing
 *     Properties-pane pin (parameters, Save, Send-to-CAM) is untouched.
 *   - WITH `onAppendKernelOp` (a live session via DesignWorkspaceHost):
 *     the 6-way feature picker renders, and selecting one mounts that dialog.
 *
 * `renderToStaticMarkup` is one-shot SSR (no click events), so we drive the
 * "which dialog is open" state through the picker's default-closed render and
 * assert the picker buttons exist + are typed. The picker → dialog open path is
 * covered structurally (the picker arms `activeFeatureDialog`, whose render is
 * pinned by the FeatureDialogHost tests).
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
    expect(html).not.toContain('data-testid="design-workspace-feature-picker"')
  })

  it('renders the 6-way feature picker when onAppendKernelOp is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop
      })
    )
    expect(html).toContain('data-testid="design-workspace-feature-dialogs"')
    expect(html).toContain('data-testid="design-workspace-feature-picker"')
    for (const kind of ['extrude', 'revolve', 'fillet', 'chamfer', 'shell', 'hole']) {
      expect(html).toContain(`data-testid="design-workspace-feature-pick-${kind}"`)
    }
  })

  it('every feature-picker button is type="button"', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop
      })
    )
    // Slice to the picker region and assert each button tag is typed.
    const start = html.indexOf('data-testid="design-workspace-feature-picker"')
    expect(start).toBeGreaterThan(-1)
    const region = html.slice(start, start + 2000)
    const buttons = region.match(/<button[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThanOrEqual(6)
    for (const tag of buttons) {
      expect(tag).toContain('type="button"')
    }
  })

  it('keeps the existing parameters + Save + Send-to-CAM pins intact alongside it', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop,
        onSave: noop,
        onSendToCam: noop
      })
    )
    // Pre-existing Properties-pane affordances still present.
    expect(html).toContain('data-testid="design-workspace-save"')
    expect(html).toContain('data-testid="design-workspace-send-to-cam"')
    // And the new section co-exists.
    expect(html).toContain('data-testid="design-workspace-feature-dialogs"')
  })

  it('no dialog is open by default (picker armed, no active dialog mounted)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onAppendKernelOp: noop
      })
    )
    // The host wrapper only renders once a feature is armed.
    expect(html).not.toContain('data-testid="fd-host"')
  })
})
