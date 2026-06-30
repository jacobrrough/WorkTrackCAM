/**
 * INTERACTIVE test (happy-dom) for the Cut Box dialog: renders the real dialog,
 * types six box extents, clicks Apply, and asserts the EXACT emitted
 * `boolean_subtract_box` kernel op — behaviour a source pin can never prove.
 * Mirrors `ExtrudeDialog.dom.spec.tsx`. Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CutBoxDialog } from '../CutBoxDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

/** Opening defaults — a valid box (max > min on every axis). */
const defaultParams = {
  xMinMm: 0,
  xMaxMm: 10,
  yMinMm: 0,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 10
} as const

async function setField(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
): Promise<void> {
  const input = screen.getByTestId(testId)
  await user.clear(input)
  await user.type(input, value)
}

describe('CutBoxDialog — interactive (happy-dom)', () => {
  it('applies the typed extents as a boolean_subtract_box kernel op', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutBoxDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await setField(user, 'fd-boolean_subtract_box-xMin', '2')
    await setField(user, 'fd-boolean_subtract_box-xMax', '8')
    await setField(user, 'fd-boolean_subtract_box-yMin', '-5')
    await setField(user, 'fd-boolean_subtract_box-yMax', '5')
    await setField(user, 'fd-boolean_subtract_box-zMin', '0')
    await setField(user, 'fd-boolean_subtract_box-zMax', '3.5')
    await user.click(screen.getByTestId('fd-boolean_subtract_box-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_subtract_box',
        xMinMm: 2,
        xMaxMm: 8,
        yMinMm: -5,
        yMaxMm: 5,
        zMinMm: 0,
        zMaxMm: 3.5
      }
    })
  })

  it('gates Apply when an axis is not strictly increasing (max <= min, no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutBoxDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    // Make X max equal to X min — the schema's refine would reject this box.
    await setField(user, 'fd-boolean_subtract_box-xMin', '4')
    await setField(user, 'fd-boolean_subtract_box-xMax', '4')
    await user.click(screen.getByTestId('fd-boolean_subtract_box-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when a field is left blank (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutBoxDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    // Clear Z max — an unparseable (empty) field must block Apply.
    const zMax = screen.getByTestId('fd-boolean_subtract_box-zMax')
    await user.clear(zMax)
    await user.click(screen.getByTestId('fd-boolean_subtract_box-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
