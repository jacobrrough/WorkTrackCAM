/**
 * RotaryOrientGizmo render-pin tests.
 *
 * The component is the UI half of the Carvera 4-axis part-orientation gap
 * (tool-catalog §2.4 / carvera-4axis.md #1). These tests pin:
 *   - the control surface (3 numeric rotation fields + 3 quick-sets + reset),
 *   - controlled vs uncontrolled rendering of the placement value,
 *   - the honest disabling of bounds-driven quick-sets when no bounds are given,
 *   - the live read-out (rotation °, axial X mm) and the advisory radial / "fits
 *     Ø" hint when a stock diameter is supplied.
 *
 * Uses `react-dom/server.renderToStaticMarkup` so it runs in the existing `node`
 * vitest env (same pattern as `WorkflowStageTabs.test.tsx`). Effects do not fire
 * under static rendering, but this component has none — it renders purely from
 * props + the (separately unit-tested) `rotary-placement` helper.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RotaryOrientGizmo, type RotaryOrientGizmoProps } from './RotaryOrientGizmo'
import {
  type PartBounds,
  buildPlacement,
  identityPlacement,
  placementXIsRotationAxis
} from './rotary-placement'

function render(props: RotaryOrientGizmoProps): string {
  return renderToStaticMarkup(createElement(RotaryOrientGizmo, props))
}

function baseProps(overrides: Partial<RotaryOrientGizmoProps> = {}): RotaryOrientGizmoProps {
  return {
    onChange: vi.fn(),
    ...overrides
  }
}

// A long-along-X bar so quick-sets have something to chew on.
const X_LONG: PartBounds = { min: { x: -50, y: -5, z: -3 }, max: { x: 50, y: 5, z: 3 } }

describe('RotaryOrientGizmo — control surface', () => {
  it('renders the container with the rotary-orient-gizmo test id + aria label', () => {
    const html = render(baseProps())
    expect(html).toContain('data-testid="rotary-orient-gizmo"')
    expect(html).toContain('aria-label="Rotary part orientation"')
  })

  it('renders three numeric rotation fields (X/Y/Z)', () => {
    const html = render(baseProps())
    expect(html).toContain('data-testid="rotary-orient-gizmo-rot-x"')
    expect(html).toContain('data-testid="rotary-orient-gizmo-rot-y"')
    expect(html).toContain('data-testid="rotary-orient-gizmo-rot-z"')
    // type=number, not free text — numeric entry.
    expect(html).toContain('type="number"')
  })

  it('renders all three axis-align quick-sets + a reset', () => {
    const html = render(baseProps())
    expect(html).toContain('data-testid="rotary-orient-gizmo-quickset-x_is_rotation_axis"')
    expect(html).toContain('data-testid="rotary-orient-gizmo-quickset-lay_flat"')
    expect(html).toContain('data-testid="rotary-orient-gizmo-quickset-center_on_chuck"')
    expect(html).toContain('data-testid="rotary-orient-gizmo-reset"')
    // The literal "X = rotation axis" affordance the spec asks for.
    expect(html).toContain('X = rotation axis')
  })

  it('every button is type=button (no implicit submit)', () => {
    const html = render(baseProps())
    // No button without an explicit type should appear. Count opening <button>
    // tags and assert each is immediately followed by type="button".
    const buttonOpens = html.match(/<button\b/g) ?? []
    const typedButtons = html.match(/<button type="button"/g) ?? []
    expect(buttonOpens.length).toBeGreaterThan(0)
    expect(typedButtons.length).toBe(buttonOpens.length)
  })
})

describe('RotaryOrientGizmo — bounds gating', () => {
  it('disables the bounds-driven quick-sets when no part bounds are supplied', () => {
    const html = render(baseProps({ partBounds: undefined }))
    // The three quick-sets are disabled; reset is NOT.
    for (const id of ['x_is_rotation_axis', 'lay_flat', 'center_on_chuck']) {
      const re = new RegExp(`data-testid="rotary-orient-gizmo-quickset-${id}"[^>]*\\bdisabled\\b`)
      expect(re.test(html)).toBe(true)
    }
    const resetDisabled = /data-testid="rotary-orient-gizmo-reset"[^>]*\bdisabled\b/.test(html)
    expect(resetDisabled).toBe(false)
  })

  it('enables the quick-sets once part bounds are supplied', () => {
    const html = render(baseProps({ partBounds: X_LONG }))
    const re = /data-testid="rotary-orient-gizmo-quickset-x_is_rotation_axis"[^>]*\bdisabled\b/
    expect(re.test(html)).toBe(false)
  })

  it('disables ALL controls (including reset) when disabled=true', () => {
    const html = render(baseProps({ partBounds: X_LONG, disabled: true }))
    expect(/data-testid="rotary-orient-gizmo-reset"[^>]*\bdisabled\b/.test(html)).toBe(true)
    expect(/data-testid="rotary-orient-gizmo-rot-x"[^>]*\bdisabled\b/.test(html)).toBe(true)
    expect(html).toContain('aria-disabled="true"')
  })
})

describe('RotaryOrientGizmo — placement read-out (controlled)', () => {
  it('reflects a controlled rotation value in the numeric read-out', () => {
    const value = buildPlacement({ rotation: { x: 90, y: 0, z: 45 } })
    const html = render(baseProps({ value }))
    // The read-out prints "90° · 0° · 45°".
    expect(html).toContain('data-testid="rotary-orient-gizmo-readout-rotation"')
    expect(html).toContain('90°')
    expect(html).toContain('45°')
  })

  it('reflects a controlled axial X offset', () => {
    const value = buildPlacement({ position: { x: 50 } })
    const html = render(baseProps({ value }))
    expect(html).toContain('data-testid="rotary-orient-gizmo-readout-axial"')
    expect(html).toContain('50 mm')
  })

  it('shows the input value bound to the controlled placement', () => {
    const value = placementXIsRotationAxis({
      min: { x: -5, y: -50, z: -3 },
      max: { x: 5, y: 50, z: 3 }
    }) // Y-long → gizmo Y-rotation 90 (engine-correct; see rotary-placement)
    const html = render(baseProps({ value }))
    // The Y rotation field's value attribute should carry 90.
    expect(/data-testid="rotary-orient-gizmo-rot-y"[^>]*value="90"/.test(html)).toBe(true)
    // ...and the Z field stays at 0.
    expect(/data-testid="rotary-orient-gizmo-rot-z"[^>]*value="0"/.test(html)).toBe(true)
  })
})

describe('RotaryOrientGizmo — radial / fits-Ø hint', () => {
  it('shows an em dash for max radial when no bounds', () => {
    const html = render(baseProps({ partBounds: undefined }))
    expect(html).toContain('data-testid="rotary-orient-gizmo-readout-radial"')
    // No fit pill without bounds + stock.
    expect(html).not.toContain('data-testid="rotary-orient-gizmo-readout-fit"')
  })

  it('shows "fits Ø" when the oriented part is within the stock OD', () => {
    // X_LONG at identity: max radial √(5²+3²) ≈ 5.83 mm; Ø50 → r=25 ⇒ fits.
    const html = render(
      baseProps({ value: identityPlacement(), partBounds: X_LONG, stockDiameterMm: 50 })
    )
    expect(html).toContain('data-testid="rotary-orient-gizmo-readout-fit"')
    expect(html).toContain('fits Ø')
    expect(html).toContain('rotary-orient-gizmo__fit--ok')
  })

  it('shows "exceeds Ø" when the oriented part is larger than the stock OD', () => {
    // A part 40mm radial in a Ø10 (r=5) stock ⇒ exceeds.
    const big: PartBounds = { min: { x: -50, y: -40, z: -40 }, max: { x: 50, y: 40, z: 40 } }
    const html = render(
      baseProps({ value: identityPlacement(), partBounds: big, stockDiameterMm: 10 })
    )
    expect(html).toContain('exceeds Ø')
    expect(html).toContain('rotary-orient-gizmo__fit--over')
  })
})

describe('RotaryOrientGizmo — uncontrolled default', () => {
  it('seeds from defaultValue when uncontrolled', () => {
    const html = render(baseProps({ defaultValue: buildPlacement({ rotation: { x: 180 } }) }))
    expect(/data-testid="rotary-orient-gizmo-rot-x"[^>]*value="180"/.test(html)).toBe(true)
  })

  it('defaults to identity (0/0/0) when neither value nor defaultValue given', () => {
    const html = render(baseProps())
    expect(/data-testid="rotary-orient-gizmo-rot-x"[^>]*value="0"/.test(html)).toBe(true)
  })
})
