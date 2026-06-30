/**
 * INTERACTIVE test (happy-dom) for the Linear Pattern dialog: renders the real
 * dialog, types a count + step vector, clicks Apply, and asserts the exact
 * emitted `pattern_linear_3d` kernelOp payload — the behavioural check source
 * pins can't prove. Mirrors `ExtrudeDialog.dom.spec.tsx`. Run with
 * `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinearPatternDialog } from '../LinearPatternDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

const defaultParams = { count: 3, dxMm: 10, dyMm: 0, dzMm: 0 } as const

describe('LinearPatternDialog — interactive (happy-dom)', () => {
  it('emits the exact pattern_linear_3d op for the typed count + step', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<LinearPatternDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    const count = screen.getByTestId('fd-pattern_linear_3d-count')
    const dx = screen.getByTestId('fd-pattern_linear_3d-dx')
    const dy = screen.getByTestId('fd-pattern_linear_3d-dy')
    const dz = screen.getByTestId('fd-pattern_linear_3d-dz')

    await user.clear(count)
    await user.type(count, '5')
    await user.clear(dx)
    await user.type(dx, '20')
    await user.clear(dy)
    await user.type(dy, '12.5')
    await user.clear(dz)
    await user.type(dz, '0')
    await user.click(screen.getByTestId('fd-pattern_linear_3d-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'pattern_linear_3d', count: 5, dxMm: 20, dyMm: 12.5, dzMm: 0 }
    })
  })

  it('clamps an out-of-range count to the schema max (32)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<LinearPatternDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    const count = screen.getByTestId('fd-pattern_linear_3d-count')
    await user.clear(count)
    await user.type(count, '99')
    await user.click(screen.getByTestId('fd-pattern_linear_3d-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'pattern_linear_3d', count: 32, dxMm: 10, dyMm: 0, dzMm: 0 }
    })
  })

  it('gates Apply on an all-zero step (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <LinearPatternDialog
        params={{ count: 3, dxMm: 0, dyMm: 0, dzMm: 0 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    // All three steps are zero → the schema would reject; Apply must be inert.
    await user.click(screen.getByTestId('fd-pattern_linear_3d-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on an empty (unparseable) count (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<LinearPatternDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    const count = screen.getByTestId('fd-pattern_linear_3d-count')
    await user.clear(count)
    await user.click(screen.getByTestId('fd-pattern_linear_3d-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
