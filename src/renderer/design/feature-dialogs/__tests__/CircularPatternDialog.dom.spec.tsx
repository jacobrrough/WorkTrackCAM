/**
 * INTERACTIVE test (happy-dom): renders the Circular Pattern dialog, types real
 * values, clicks Apply, and asserts the EXACT emitted `pattern_circular` op —
 * the behavioural check a source pin can't prove. Mirrors the shape of
 * ExtrudeDialog.dom.spec.tsx (the dialog-wiring template). Run with
 * `npm run test:dom` (or `npx vitest run -c vitest.dom.config.ts <file>`).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CircularPatternDialog } from '../CircularPatternDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('CircularPatternDialog — interactive (happy-dom)', () => {
  it('emits the exact pattern_circular op from the typed values', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <CircularPatternDialog
        params={{ count: 4, centerXMm: 0, centerYMm: 0, startAngleDeg: 0, totalAngleDeg: 360 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const count = screen.getByTestId('fd-pattern_circular-count')
    await user.clear(count)
    await user.type(count, '6')

    const centerX = screen.getByTestId('fd-pattern_circular-centerX')
    await user.clear(centerX)
    await user.type(centerX, '12.5')

    const centerY = screen.getByTestId('fd-pattern_circular-centerY')
    await user.clear(centerY)
    await user.type(centerY, '-8')

    const startAngle = screen.getByTestId('fd-pattern_circular-startAngle')
    await user.clear(startAngle)
    await user.type(startAngle, '15')

    const totalAngle = screen.getByTestId('fd-pattern_circular-totalAngle')
    await user.clear(totalAngle)
    await user.type(totalAngle, '270')

    await user.click(screen.getByTestId('fd-pattern_circular-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'pattern_circular',
        count: 6,
        centerXMm: 12.5,
        centerYMm: -8,
        startAngleDeg: 15,
        totalAngleDeg: 270
      }
    })
  })

  it('gates Apply when the count is empty / unparseable (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <CircularPatternDialog
        params={{ count: 4, centerXMm: 0, centerYMm: 0, startAngleDeg: 0, totalAngleDeg: 360 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    // Clearing the count leaves it unparseable → the parse returns null → Apply
    // is gated. Clicking must NOT emit a partial/garbage op.
    const count = screen.getByTestId('fd-pattern_circular-count')
    await user.clear(count)
    await user.click(screen.getByTestId('fd-pattern_circular-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
