/**
 * BROKEN PATH #5 render-pin: the Plan tab "Add a Setup first" banner.
 *
 * The previous "Add a setup so work offset and stock context are defined"
 * hint lived buried at the bottom of the Plan sidebar and was only emitted
 * when both `setups.length === 0` AND `!camResolvedSetup`. Users could
 * create operations on the Plan tab without ever seeing it and only
 * discover the missing Setup once CAM generation failed with a confusing
 * error. This test pins the new prominent banner contract:
 *
 *   - Render when `setupCount === 0`: visible with heading, subtitle,
 *     warning icon, and a primary "Add Setup" CTA wired to `onAddSetup`.
 *   - Hide when `setupCount > 0`: nothing renders.
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matching the pattern in
 * `PlateTabs.test.tsx` and `calibration-panel-render.test.tsx`) so the
 * test runs in the existing `node` vitest environment without a jsdom
 * dependency.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManufactureNoSetupBanner, type ManufactureNoSetupBannerProps } from './ManufactureNoSetupBanner'

function baseProps(overrides: Partial<ManufactureNoSetupBannerProps>): ManufactureNoSetupBannerProps {
  return {
    setupCount: 0,
    onAddSetup: vi.fn(),
    ...overrides
  }
}

function render(props: ManufactureNoSetupBannerProps): string {
  return renderToStaticMarkup(createElement(ManufactureNoSetupBanner, props))
}

describe('ManufactureNoSetupBanner (BROKEN PATH #5)', () => {
  it('renders the banner when no setups exist on the active plate', () => {
    const html = render(baseProps({ setupCount: 0 }))
    expect(html).toContain('data-testid="manufacture-plan-no-setup-banner"')
  })

  it('renders the heading, subtitle, warning icon, and primary CTA when setupCount === 0', () => {
    const html = render(baseProps({ setupCount: 0 }))
    // Heading text - the "next step" call out
    expect(html).toContain('Add a Setup first')
    // Explanatory subtitle covers why the Setup is required
    expect(html).toContain('Operations need a Setup to define work offset (WCS), stock, and tool reference.')
    // Warning icon glyph (matches the WorkspaceErrorBoundary + ShopModelViewer pattern)
    expect(html).toContain('aria-hidden="true">⚠</span>')
    // role="alert" so the banner is announced by screen readers
    expect(html).toContain('role="alert"')
    // Primary CTA - existing .btn .btn-primary classes
    expect(html).toContain('data-testid="manufacture-plan-no-setup-cta"')
    expect(html).toContain('class="btn btn-primary"')
    expect(html).toContain('>Add Setup<')
  })

  it('does not render the banner when at least one setup exists', () => {
    const html = render(baseProps({ setupCount: 1 }))
    expect(html).toBe('')
    expect(html).not.toContain('manufacture-plan-no-setup-banner')
    expect(html).not.toContain('Add a Setup first')
  })

  it('does not render the banner when multiple setups exist', () => {
    const html = render(baseProps({ setupCount: 3 }))
    expect(html).toBe('')
    expect(html).not.toContain('manufacture-plan-no-setup-banner')
  })

  it('CTA button is type="button" so it never accidentally submits a parent form', () => {
    const html = render(baseProps({ setupCount: 0 }))
    // React-DOM emits `type="button"` before the testid attribute in static markup;
    // assert the type attr is present somewhere on the CTA button's opening tag.
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-testid="manufacture-plan-no-setup-cta"/)
  })
})
