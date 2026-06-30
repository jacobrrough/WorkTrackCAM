/**
 * Proof-of-concept INTERACTIVE test (happy-dom): renders a real feature dialog, types into it,
 * clicks Apply, and asserts the emitted payload — the kind of behavioural check that source pins
 * (`toContain('onApply')`) can never prove. This is the template for the Tier-1 dialog-wiring wave;
 * see the `wire-feature-dialog` skill. Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtrudeDialog } from '../ExtrudeDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('ExtrudeDialog — interactive (happy-dom)', () => {
  it('applies the typed depth to the script parameter', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ExtrudeDialog params={{ depthMm: 10 }} onApply={onApply} {...baseProps} />)

    const depth = screen.getByTestId('fd-extrude-depth')
    await user.clear(depth)
    await user.type(depth, '25')
    await user.click(screen.getByTestId('fd-extrude-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'scriptParams',
      params: { extrudeDepthMm: 25 }
    })
  })

  it('respects a custom depth parameter key', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <ExtrudeDialog
        params={{ depthMm: 5, depthParamKey: 'plateHeightMm' }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const depth = screen.getByTestId('fd-extrude-depth')
    await user.clear(depth)
    await user.type(depth, '12.5')
    await user.click(screen.getByTestId('fd-extrude-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'scriptParams',
      params: { plateHeightMm: 12.5 }
    })
  })

  it('gates Apply on a non-positive depth (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ExtrudeDialog params={{ depthMm: 10 }} onApply={onApply} {...baseProps} />)

    const depth = screen.getByTestId('fd-extrude-depth')
    await user.clear(depth)
    await user.type(depth, '0')
    await user.click(screen.getByTestId('fd-extrude-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
