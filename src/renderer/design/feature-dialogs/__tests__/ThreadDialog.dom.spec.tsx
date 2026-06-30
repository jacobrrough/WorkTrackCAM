/**
 * INTERACTIVE test (happy-dom): renders the real Thread dialog, types into every
 * numeric field, picks the selects, clicks Apply, and asserts the EXACT emitted
 * `thread_wizard` kernel op — behaviour a source pin can never prove. Mirrors
 * `ExtrudeDialog.dom.spec.tsx`; see the `wire-feature-dialog` skill. Run with
 * `npx vitest run -c vitest.dom.config.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThreadDialog } from '../ThreadDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

/** Schema-default opening params (matches what the host seeds the dialog with). */
const defaultParams = {
  centerXMm: 0,
  centerYMm: 0,
  majorRadiusMm: 8,
  pitchMm: 1.25,
  lengthMm: 20,
  depthMm: 0.8,
  zStartMm: 0,
  hand: 'right',
  mode: 'modeled',
  standard: 'ISO',
  designation: 'M',
  class: '6g',
  starts: 1
} as const

describe('ThreadDialog — interactive (happy-dom)', () => {
  it('emits the EXACT thread_wizard op from typed values + selects', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThreadDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    const typeInto = async (testId: string, value: string): Promise<void> => {
      const input = screen.getByTestId(testId)
      await user.clear(input)
      await user.type(input, value)
    }

    await typeInto('fd-thread_wizard-centerX', '2')
    await typeInto('fd-thread_wizard-centerY', '-3')
    await typeInto('fd-thread_wizard-majorRadius', '10')
    await typeInto('fd-thread_wizard-pitch', '1.5')
    await typeInto('fd-thread_wizard-length', '25')
    await typeInto('fd-thread_wizard-depth', '0.9')
    await typeInto('fd-thread_wizard-zStart', '4')
    await typeInto('fd-thread_wizard-starts', '2')

    await user.selectOptions(screen.getByTestId('fd-thread_wizard-hand'), 'left')
    await user.selectOptions(screen.getByTestId('fd-thread_wizard-mode'), 'cosmetic')
    await user.selectOptions(screen.getByTestId('fd-thread_wizard-standard'), 'UTS')
    await user.selectOptions(screen.getByTestId('fd-thread_wizard-designation'), 'UNF')
    await user.selectOptions(screen.getByTestId('fd-thread_wizard-class'), '2A')

    await user.click(screen.getByTestId('fd-thread_wizard-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'thread_wizard',
        centerXMm: 2,
        centerYMm: -3,
        majorRadiusMm: 10,
        pitchMm: 1.5,
        lengthMm: 25,
        depthMm: 0.9,
        zStartMm: 4,
        hand: 'left',
        mode: 'cosmetic',
        standard: 'UTS',
        designation: 'UNF',
        class: '2A',
        starts: 2
      }
    })
  })

  it('emits the schema defaults unchanged when nothing is edited', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThreadDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-thread_wizard-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'thread_wizard',
        centerXMm: 0,
        centerYMm: 0,
        majorRadiusMm: 8,
        pitchMm: 1.25,
        lengthMm: 20,
        depthMm: 0.8,
        zStartMm: 0,
        hand: 'right',
        mode: 'modeled',
        standard: 'ISO',
        designation: 'M',
        class: '6g',
        starts: 1
      }
    })
  })

  it('gates Apply on a non-positive major radius (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThreadDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    const radius = screen.getByTestId('fd-thread_wizard-majorRadius')
    await user.clear(radius)
    await user.type(radius, '0')
    await user.click(screen.getByTestId('fd-thread_wizard-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on an empty (non-finite) position field (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ThreadDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    // Clearing Center X leaves it blank → parseFiniteMm returns null → gated.
    await user.clear(screen.getByTestId('fd-thread_wizard-centerX'))
    await user.click(screen.getByTestId('fd-thread_wizard-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
