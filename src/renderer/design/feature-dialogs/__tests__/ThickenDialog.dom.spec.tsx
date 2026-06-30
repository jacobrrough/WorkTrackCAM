/**
 * INTERACTIVE test (happy-dom): renders the Thicken dialog, types a distance,
 * picks a side, clicks Apply, and asserts the EXACT emitted `thicken_offset`
 * kernel op — behaviour a source pin can never prove. Mirrors
 * `ExtrudeDialog.dom.spec.tsx`. Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThickenDialog } from '../ThickenDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('ThickenDialog — interactive (happy-dom)', () => {
  it('emits a thicken_offset op with the typed distance and the default side', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThickenDialog params={{ distanceMm: 2 }} onApply={onApply} {...baseProps} />)

    const distance = screen.getByTestId('fd-thicken_offset-distance')
    await user.clear(distance)
    await user.type(distance, '3.5')
    await user.click(screen.getByTestId('fd-thicken_offset-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'thicken_offset', distanceMm: 3.5, side: 'outward' }
    })
  })

  it('carries the chosen side through to the emitted op', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThickenDialog params={{ distanceMm: 1 }} onApply={onApply} {...baseProps} />)

    const distance = screen.getByTestId('fd-thicken_offset-distance')
    await user.clear(distance)
    await user.type(distance, '4')
    await user.selectOptions(screen.getByTestId('fd-thicken_offset-side'), 'inward')
    await user.click(screen.getByTestId('fd-thicken_offset-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'thicken_offset', distanceMm: 4, side: 'inward' }
    })
  })

  it('honors a non-default initial side from params', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <ThickenDialog
        params={{ distanceMm: 2, side: 'both' }}
        onApply={onApply}
        {...baseProps}
      />
    )

    await user.click(screen.getByTestId('fd-thicken_offset-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'thicken_offset', distanceMm: 2, side: 'both' }
    })
  })

  it('gates Apply on a non-positive distance (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThickenDialog params={{ distanceMm: 2 }} onApply={onApply} {...baseProps} />)

    const distance = screen.getByTestId('fd-thicken_offset-distance')
    await user.clear(distance)
    await user.type(distance, '0')
    await user.click(screen.getByTestId('fd-thicken_offset-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when the distance field is cleared (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThickenDialog params={{ distanceMm: 2 }} onApply={onApply} {...baseProps} />)

    const distance = screen.getByTestId('fd-thicken_offset-distance')
    await user.clear(distance)
    await user.click(screen.getByTestId('fd-thicken_offset-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
