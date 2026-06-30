/**
 * INTERACTIVE test (happy-dom) for the Split Body dialog (`split_keep_halfspace`):
 * renders the real dialog, drives the axis/keep selects + the signed offset field
 * via userEvent, clicks Apply, and asserts the EXACT emitted `kernelOp` payload —
 * behaviour a source pin can never prove. Mirrors `ExtrudeDialog.dom.spec.tsx`.
 * Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SplitBodyDialog } from '../SplitBodyDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('SplitBodyDialog — interactive (happy-dom)', () => {
  it('emits the typed split_keep_halfspace op from the chosen axis/offset/keep', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SplitBodyDialog params={{ axis: 'Z', offsetMm: 0, keep: 'positive' }} onApply={onApply} {...baseProps} />)

    await user.selectOptions(screen.getByTestId('fd-split_keep_halfspace-axis'), 'X')
    const offset = screen.getByTestId('fd-split_keep_halfspace-offset')
    await user.clear(offset)
    await user.type(offset, '12.5')
    await user.selectOptions(screen.getByTestId('fd-split_keep_halfspace-keep'), 'negative')
    await user.click(screen.getByTestId('fd-split_keep_halfspace-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'split_keep_halfspace', axis: 'X', offsetMm: 12.5, keep: 'negative' }
    })
  })

  it('keeps a negative offset (the plane offset is signed)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SplitBodyDialog params={{ axis: 'Y', offsetMm: 0, keep: 'positive' }} onApply={onApply} {...baseProps} />)

    const offset = screen.getByTestId('fd-split_keep_halfspace-offset')
    await user.clear(offset)
    await user.type(offset, '-4')
    await user.click(screen.getByTestId('fd-split_keep_halfspace-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'split_keep_halfspace', axis: 'Y', offsetMm: -4, keep: 'positive' }
    })
  })

  it('emits the seeded defaults unchanged when nothing is edited', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SplitBodyDialog params={{ axis: 'Z', offsetMm: 0, keep: 'positive' }} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-split_keep_halfspace-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'split_keep_halfspace', axis: 'Z', offsetMm: 0, keep: 'positive' }
    })
  })

  it('gates Apply on a non-finite offset (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SplitBodyDialog params={{ axis: 'Z', offsetMm: 0, keep: 'positive' }} onApply={onApply} {...baseProps} />)

    const offset = screen.getByTestId('fd-split_keep_halfspace-offset')
    await user.clear(offset)
    await user.click(screen.getByTestId('fd-split_keep_halfspace-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
