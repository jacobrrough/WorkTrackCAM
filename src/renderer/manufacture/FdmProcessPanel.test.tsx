/**
 * Render-pin tests for the editable FDM Process panel (Wave-3b).
 *
 * Pattern matches `ProfileStack.test.tsx` — `renderToStaticMarkup` in the
 * existing `node` vitest env (no jsdom). These pin the static surface so a
 * refactor cannot silently drop an editable field, and assert that the
 * temperature inputs carry the K2 ceiling as their `max`.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FdmProcessPanel, type FdmProcessPanelProps } from './FdmProcessPanel'
import { FDM_TEMP_CEILINGS, type FdmProcessOverrides } from '../../shared/fdm-process-overrides'

function makeProps(overrides: Partial<FdmProcessPanelProps> = {}): FdmProcessPanelProps {
  return {
    value: {},
    onChangeProcess: vi.fn(),
    qualityPresetId: 'standard',
    onChangeQualityPreset: vi.fn(),
    ...overrides
  }
}

function render(props: FdmProcessPanelProps): string {
  return renderToStaticMarkup(createElement(FdmProcessPanel, props))
}

describe('FdmProcessPanel — editable surface', () => {
  it('renders every editable process field', () => {
    const html = render(makeProps())
    expect(html).toContain('data-testid="fdm-process-panel"')
    expect(html).toContain('data-testid="fdm-process-quality-select"')
    expect(html).toContain('data-testid="fdm-process-layer-height"')
    expect(html).toContain('data-testid="fdm-process-infill"')
    expect(html).toContain('data-testid="fdm-process-walls"')
    expect(html).toContain('data-testid="fdm-process-speed"')
    expect(html).toContain('data-testid="fdm-process-nozzle-temp"')
    expect(html).toContain('data-testid="fdm-process-bed-temp"')
  })

  it('renders the Supports section with enable + style controls', () => {
    const html = render(makeProps())
    expect(html).toContain('data-testid="fdm-supports-fieldset"')
    expect(html).toContain('data-testid="fdm-supports-enable"')
    expect(html).toContain('data-testid="fdm-supports-type"')
  })

  it('caps the nozzle temp input at the K2 ceiling (350 °C)', () => {
    const html = render(makeProps())
    expect(html).toMatch(
      new RegExp(
        `data-testid="fdm-process-nozzle-temp"[^>]*max="${FDM_TEMP_CEILINGS.nozzleC}"`
      )
    )
  })

  it('caps the bed temp input at the K2 ceiling (120 °C)', () => {
    const html = render(makeProps())
    expect(html).toMatch(
      new RegExp(`data-testid="fdm-process-bed-temp"[^>]*max="${FDM_TEMP_CEILINGS.bedC}"`)
    )
  })

  it('reflects the current process state in the input values', () => {
    const value: FdmProcessOverrides = {
      layerHeightMm: 0.28,
      infillDensityPct: 25,
      wallLoops: 4
    }
    const html = render(makeProps({ value }))
    expect(html).toMatch(/data-testid="fdm-process-layer-height"[^>]*value="0.28"/)
    expect(html).toMatch(/data-testid="fdm-process-infill"[^>]*value="25"/)
    expect(html).toMatch(/data-testid="fdm-process-walls"[^>]*value="4"/)
  })

  it('disables the support style select when supports are off', () => {
    const html = render(makeProps({ value: { supportEnabled: false } }))
    expect(html).toMatch(/data-testid="fdm-supports-type"[^>]*disabled/)
  })

  it('enables the support style select when supports are on', () => {
    const html = render(makeProps({ value: { supportEnabled: true, supportType: 'tree' } }))
    expect(html).not.toMatch(/data-testid="fdm-supports-type"[^>]*disabled/)
  })

  it('selects the active quality preset in the dropdown', () => {
    const html = render(makeProps({ qualityPresetId: 'high_speed' }))
    expect(html).toMatch(/data-testid="fdm-process-quality-select"[^>]*>/)
    expect(html).toContain('high_speed')
  })
})
