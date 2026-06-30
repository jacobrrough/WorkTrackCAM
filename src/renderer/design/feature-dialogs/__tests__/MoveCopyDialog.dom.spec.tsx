/**
 * Tier-1 · INTERACTIVE test (happy-dom) for the Move / Copy dialog
 * (`transform_translate`). Renders the real dialog, types the translation
 * vector with userEvent, clicks Apply, and asserts the EXACT emitted kernel op
 * — the behavioural check a source pin can never prove. Mirrors
 * `ExtrudeDialog.dom.spec.tsx`; run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoveCopyDialog } from '../MoveCopyDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('MoveCopyDialog — interactive (happy-dom)', () => {
  it('emits a transform_translate MOVE op with the typed vector', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<MoveCopyDialog params={{}} onApply={onApply} {...baseProps} />)

    const dx = screen.getByTestId('fd-transform_translate-dx')
    const dy = screen.getByTestId('fd-transform_translate-dy')
    const dz = screen.getByTestId('fd-transform_translate-dz')
    await user.clear(dx)
    await user.type(dx, '10')
    await user.clear(dy)
    await user.type(dy, '-5')
    await user.clear(dz)
    await user.type(dz, '2.5')
    await user.click(screen.getByTestId('fd-transform_translate-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'transform_translate',
        dxMm: 10,
        dyMm: -5,
        dzMm: 2.5,
        keepOriginal: false
      }
    })
  })

  it('emits keepOriginal:true when the result mode is set to Copy', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <MoveCopyDialog
        params={{ dxMm: 0, dyMm: 0, dzMm: 0 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const dz = screen.getByTestId('fd-transform_translate-dz')
    await user.clear(dz)
    await user.type(dz, '12')
    await user.selectOptions(screen.getByTestId('fd-transform_translate-mode'), 'copy')
    await user.click(screen.getByTestId('fd-transform_translate-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'transform_translate',
        dxMm: 0,
        dyMm: 0,
        dzMm: 12,
        keepOriginal: true
      }
    })
  })

  it('gates Apply on a non-finite delta (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <MoveCopyDialog
        params={{ dxMm: 1, dyMm: 1, dzMm: 1 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    // Blank out ΔY so the vector no longer parses — Apply must stay inert.
    const dy = screen.getByTestId('fd-transform_translate-dy')
    await user.clear(dy)
    await user.click(screen.getByTestId('fd-transform_translate-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
