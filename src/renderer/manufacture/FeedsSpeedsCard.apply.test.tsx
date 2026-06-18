/**
 * Wave C render-pin: the FeedsSpeedsCard "Apply to op" button.
 *
 *   - The button renders ONLY when `onApplyToActiveOp` is supplied (advisory-only
 *     by default — the legacy standalone mounts pass no callback).
 *   - The apply hint surfaces the machine-CLAMPED numbers the click would write
 *     (spindle RPM + cutting feed) and the active-op label.
 *   - The button is NOT present when the material/tool has no reference (the card
 *     shows its honest fallback instead).
 *   - The values handed to the callback are the engine's already-clamped outputs —
 *     pinned by recomputing `computeFeedsAndSpeeds` with the same inputs and
 *     asserting the rendered hint matches (renderToStaticMarkup cannot fire the
 *     click, so the callback contract is pinned against the engine output the
 *     handler reads, matching the manufacture-aux-k2-send-render.test.tsx pattern).
 *
 * Node vitest environment + `react-dom/server.renderToStaticMarkup` — no jsdom.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FeedsSpeedsCard } from './FeedsSpeedsCard'
import { computeFeedsAndSpeeds } from '../../shared/feeds-and-speeds'

const LAGUNA = { name: 'Laguna Swift 5x10', maxFeedMmMin: 15000, minSpindleRpm: 6000, maxSpindleRpm: 24000 }
const CARVERA = { name: 'Makera Carvera', maxFeedMmMin: 2400, minSpindleRpm: 13000, maxSpindleRpm: 15000 }

describe('FeedsSpeedsCard — Apply to op', () => {
  it('does NOT render the Apply button when no onApplyToActiveOp is supplied', () => {
    const html = renderToStaticMarkup(<FeedsSpeedsCard machine={LAGUNA} />)
    expect(html).not.toContain('data-testid="fs-apply"')
    expect(html).not.toContain('data-testid="fs-apply-button"')
    // The readout still renders (the card stays a working advisory reference).
    expect(html).toContain('data-testid="fs-readout"')
  })

  it('renders the Apply button when onApplyToActiveOp is supplied', () => {
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard machine={LAGUNA} onApplyToActiveOp={() => {}} />
    )
    expect(html).toContain('data-testid="fs-apply"')
    expect(html).toContain('data-testid="fs-apply-button"')
    expect(html).toContain('>Apply to op<')
  })

  it('apply hint surfaces the machine-clamped RPM + feed the click would write', () => {
    // Default plywood / 6 mm / 2-flute on the Laguna — engine output is the
    // source of truth; the hint must echo those exact (locale-formatted) numbers.
    const result = computeFeedsAndSpeeds({
      materialKey: 'plywood',
      toolType: 'endmill_2f',
      toolDiameterMm: 6,
      machine: { maxFeedMmMin: LAGUNA.maxFeedMmMin, minSpindleRpm: LAGUNA.minSpindleRpm, maxSpindleRpm: LAGUNA.maxSpindleRpm }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard machine={LAGUNA} onApplyToActiveOp={() => {}} />
    )
    expect(html).toContain(`${result.spindleRpm.toLocaleString()} RPM`)
    expect(html).toContain(`${result.feedMmMin.toLocaleString()} mm/min`)
    // Plunge is intentionally left op-controlled.
    expect(html).toContain('Plunge stays op-controlled')
  })

  it('shows the active-op label in the apply hint when provided', () => {
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard machine={LAGUNA} onApplyToActiveOp={() => {}} activeOpLabel="Op 2 · Contour" />
    )
    expect(html).toContain('Op 2 · Contour')
  })

  it('falls back to a generic op phrasing when no label is provided', () => {
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard machine={LAGUNA} onApplyToActiveOp={() => {}} />
    )
    expect(html).toContain('the selected operation')
  })

  it('applies the CLAMPED RPM on the narrow Carvera spindle (not the ideal RPM)', () => {
    // aluminum / 3 mm on the Carvera clamps RPM down to the 15k ceiling — the
    // Apply hint must show the clamped value, proving Apply writes machine-safe
    // numbers (the engine clamps; Apply does not re-clamp).
    const result = computeFeedsAndSpeeds({
      materialKey: 'aluminum_6061',
      toolType: 'endmill_2f',
      toolDiameterMm: 3,
      machine: { maxFeedMmMin: CARVERA.maxFeedMmMin, minSpindleRpm: CARVERA.minSpindleRpm, maxSpindleRpm: CARVERA.maxSpindleRpm }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spindleRpm).toBe(15000) // clamped to maxSpindleRpm
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard
        machine={CARVERA}
        initialMaterialKey="aluminum_6061"
        initialToolType="endmill_2f"
        initialToolDiameterMm={3}
        onApplyToActiveOp={() => {}}
      />
    )
    expect(html).toContain('15,000 RPM')
    expect(html).toContain(`${result.feedMmMin.toLocaleString()} mm/min`)
  })

  it('omits the Apply button when there is no reference data (honest fallback shown)', () => {
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard machine={LAGUNA} initialMaterialKey="unobtanium" onApplyToActiveOp={() => {}} />
    )
    expect(html).toContain('data-testid="fs-unavailable"')
    expect(html).not.toContain('data-testid="fs-apply-button"')
  })
})
