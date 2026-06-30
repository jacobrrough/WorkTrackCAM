/**
 * Tier-1 · INTERACTIVE test (happy-dom) for the Rectangular Pattern dialog.
 *
 * Renders the real dialog, types into every field, clicks Apply, and asserts the
 * EXACT emitted `kernelOp` payload — the behavioural check source pins can never
 * prove. Mirrors `ExtrudeDialog.dom.spec.tsx`. Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RectangularPatternDialog } from '../RectangularPatternDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('RectangularPatternDialog — interactive (happy-dom)', () => {
  it('emits the exact pattern_rectangular kernel op from the typed values', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <RectangularPatternDialog
        params={{ countX: 2, countY: 1, spacingXMm: 20, spacingYMm: 20 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const countX = screen.getByTestId('fd-pattern_rectangular-countX')
    const countY = screen.getByTestId('fd-pattern_rectangular-countY')
    const spacingX = screen.getByTestId('fd-pattern_rectangular-spacingX')
    const spacingY = screen.getByTestId('fd-pattern_rectangular-spacingY')

    await user.clear(countX)
    await user.type(countX, '3')
    await user.clear(countY)
    await user.type(countY, '4')
    await user.clear(spacingX)
    await user.type(spacingX, '12.5')
    await user.clear(spacingY)
    await user.type(spacingY, '8')

    await user.click(screen.getByTestId('fd-pattern_rectangular-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'pattern_rectangular',
        countX: 3,
        countY: 4,
        spacingXMm: 12.5,
        spacingYMm: 8
      }
    })
  })

  it('supports a single-row pattern (countY=1) with a negative spacing', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <RectangularPatternDialog
        params={{ countX: 2, countY: 1, spacingXMm: 20, spacingYMm: 20 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const countX = screen.getByTestId('fd-pattern_rectangular-countX')
    const spacingX = screen.getByTestId('fd-pattern_rectangular-spacingX')

    await user.clear(countX)
    await user.type(countX, '5')
    await user.clear(spacingX)
    await user.type(spacingX, '-15')

    await user.click(screen.getByTestId('fd-pattern_rectangular-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'pattern_rectangular',
        countX: 5,
        countY: 1,
        spacingXMm: -15,
        spacingYMm: 20
      }
    })
  })

  it('gates Apply when both counts are 1 (1×1 is a no-op the schema rejects)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <RectangularPatternDialog
        params={{ countX: 2, countY: 1, spacingXMm: 20, spacingYMm: 20 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const countX = screen.getByTestId('fd-pattern_rectangular-countX')
    await user.clear(countX)
    await user.type(countX, '1')

    await user.click(screen.getByTestId('fd-pattern_rectangular-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on an empty count (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <RectangularPatternDialog
        params={{ countX: 2, countY: 1, spacingXMm: 20, spacingYMm: 20 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const countX = screen.getByTestId('fd-pattern_rectangular-countX')
    await user.clear(countX)

    await user.click(screen.getByTestId('fd-pattern_rectangular-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on a non-finite spacing (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <RectangularPatternDialog
        params={{ countX: 3, countY: 1, spacingXMm: 20, spacingYMm: 20 }}
        onApply={onApply}
        {...baseProps}
      />
    )

    const spacingX = screen.getByTestId('fd-pattern_rectangular-spacingX')
    await user.clear(spacingX)

    await user.click(screen.getByTestId('fd-pattern_rectangular-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
