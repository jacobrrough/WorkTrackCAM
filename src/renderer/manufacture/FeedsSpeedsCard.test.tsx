import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FeedsSpeedsCard } from './FeedsSpeedsCard'

const LAGUNA = { name: 'Laguna Swift 5x10', maxFeedMmMin: 15000, minSpindleRpm: 6000, maxSpindleRpm: 24000 }
const CARVERA = { name: 'Makera Carvera', maxFeedMmMin: 2400, minSpindleRpm: 13000, maxSpindleRpm: 15000 }

describe('FeedsSpeedsCard', () => {
  it('renders a recommendation for the default (plywood / 6mm / 2-flute) selection', () => {
    const html = renderToStaticMarkup(<FeedsSpeedsCard machine={LAGUNA} />)
    expect(html).toContain('Feeds &amp; Speeds')
    expect(html).toContain('Laguna Swift 5x10') // machine name in the intro
    expect(html).toContain('data-testid="fs-readout"')
    expect(html).toContain('RPM')
    expect(html).toContain('mm/min')
    // The readout must show concrete numbers, not blanks.
    expect(html).toMatch(/data-testid="fs-rpm">[\d,]+ RPM/)
    expect(html).toMatch(/data-testid="fs-feed">[\d,]+ mm\/min/)
    // Default plywood/6mm/Laguna does not clamp → no clamp suffix, no notes list.
    expect(html).not.toContain('· clamped')
    expect(html).not.toContain('data-testid="fs-notes"')
  })

  it('surfaces an RPM clamp + advisory note for a fast material on the narrow Carvera spindle', () => {
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard
        machine={CARVERA}
        initialMaterialKey="aluminum_6061"
        initialToolType="endmill_2f"
        initialToolDiameterMm={3}
      />
    )
    // Ideal RPM ≈ 21k >> 15k ceiling → clamped, with a note.
    expect(html).toContain('· clamped')
    expect(html).toContain('data-testid="fs-notes"')
    expect(html).toMatch(/exceeds the spindle max/)
  })

  it('shows the honest fallback when the material/tool has no reference data', () => {
    const html = renderToStaticMarkup(
      <FeedsSpeedsCard machine={LAGUNA} initialMaterialKey="unobtanium" />
    )
    expect(html).toContain('data-testid="fs-unavailable"')
    expect(html).not.toContain('data-testid="fs-readout"')
  })
})
