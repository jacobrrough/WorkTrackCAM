/**
 * INTERACTIVE test (happy-dom): renders the real CoilDialog, types into every field, clicks Apply,
 * and asserts the EXACT emitted `coil_cut` op — behaviour a source pin can't prove. Mirrors
 * `ExtrudeDialog.dom.spec.tsx`; see the `wire-feature-dialog` skill. Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoilDialog } from '../CoilDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

const openingParams = {
  centerXMm: 0,
  centerYMm: 0,
  majorRadiusMm: 10,
  pitchMm: 2,
  turns: 5,
  depthMm: 1,
  zStartMm: 0
} as const

/** Clear a numeric field and type a fresh value into it. */
async function setField(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
): Promise<void> {
  const input = screen.getByTestId(testId)
  await user.clear(input)
  await user.type(input, value)
}

describe('CoilDialog — interactive (happy-dom)', () => {
  it('emits the exact coil_cut kernel op from the typed values', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CoilDialog params={openingParams} onApply={onApply} {...baseProps} />)

    await setField(user, 'fd-coil_cut-centerX', '3')
    await setField(user, 'fd-coil_cut-centerY', '-4')
    await setField(user, 'fd-coil_cut-majorRadius', '12.5')
    await setField(user, 'fd-coil_cut-pitch', '2.5')
    await setField(user, 'fd-coil_cut-turns', '8')
    await setField(user, 'fd-coil_cut-depth', '1.5')
    await setField(user, 'fd-coil_cut-zStart', '6')
    await user.click(screen.getByTestId('fd-coil_cut-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'coil_cut',
        centerXMm: 3,
        centerYMm: -4,
        majorRadiusMm: 12.5,
        pitchMm: 2.5,
        turns: 8,
        depthMm: 1.5,
        zStartMm: 6
      }
    })
  })

  it('applies the opening params unchanged when nothing is edited', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CoilDialog params={openingParams} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-coil_cut-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'coil_cut',
        centerXMm: 0,
        centerYMm: 0,
        majorRadiusMm: 10,
        pitchMm: 2,
        turns: 5,
        depthMm: 1,
        zStartMm: 0
      }
    })
  })

  it('gates Apply on a non-positive major radius (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CoilDialog params={openingParams} onApply={onApply} {...baseProps} />)

    await setField(user, 'fd-coil_cut-majorRadius', '0')
    await user.click(screen.getByTestId('fd-coil_cut-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when turns exceeds the schema cap of 100 (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CoilDialog params={openingParams} onApply={onApply} {...baseProps} />)

    await setField(user, 'fd-coil_cut-turns', '101')
    await user.click(screen.getByTestId('fd-coil_cut-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on an empty pitch (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CoilDialog params={openingParams} onApply={onApply} {...baseProps} />)

    await user.clear(screen.getByTestId('fd-coil_cut-pitch'))
    await user.click(screen.getByTestId('fd-coil_cut-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
