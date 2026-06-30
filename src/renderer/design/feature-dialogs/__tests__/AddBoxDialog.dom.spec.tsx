/**
 * INTERACTIVE test (happy-dom) for the Add Box dialog — the `boolean_union_box`
 * front end. Renders the real dialog, types into every bound, clicks Apply, and
 * asserts the EXACT emitted `kernelOp` payload (the behavioural check a source
 * pin can't prove). Mirrors `ExtrudeDialog.dom.spec.tsx`; run `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddBoxDialog } from '../AddBoxDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

/** A valid opening box so a single edited field still yields a valid solid. */
const validParams = {
  xMinMm: 0,
  xMaxMm: 10,
  yMinMm: 0,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 10
} as const

async function setBound(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
): Promise<void> {
  const input = screen.getByTestId(testId)
  await user.clear(input)
  await user.type(input, value)
}

describe('AddBoxDialog — interactive (happy-dom)', () => {
  it('emits the exact boolean_union_box op from the typed bounds', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<AddBoxDialog params={validParams} onApply={onApply} {...baseProps} />)

    await setBound(user, 'fd-boolean_union_box-xmin', '-5')
    await setBound(user, 'fd-boolean_union_box-xmax', '15')
    await setBound(user, 'fd-boolean_union_box-ymin', '-2.5')
    await setBound(user, 'fd-boolean_union_box-ymax', '7.5')
    await setBound(user, 'fd-boolean_union_box-zmin', '0')
    await setBound(user, 'fd-boolean_union_box-zmax', '20')
    await user.click(screen.getByTestId('fd-boolean_union_box-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_union_box',
        xMinMm: -5,
        xMaxMm: 15,
        yMinMm: -2.5,
        yMaxMm: 7.5,
        zMinMm: 0,
        zMaxMm: 20
      }
    })
  })

  it('applies the unedited opening bounds when nothing is changed', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<AddBoxDialog params={validParams} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-boolean_union_box-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_union_box',
        xMinMm: 0,
        xMaxMm: 10,
        yMinMm: 0,
        yMaxMm: 10,
        zMinMm: 0,
        zMaxMm: 10
      }
    })
  })

  it('gates Apply when an axis is not strictly increasing (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<AddBoxDialog params={validParams} onApply={onApply} {...baseProps} />)

    // Make X degenerate: xMax === xMin. The schema refine would reject this, so
    // the dialog must NOT emit.
    await setBound(user, 'fd-boolean_union_box-xmax', '0')
    await user.click(screen.getByTestId('fd-boolean_union_box-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when a bound is blank / non-numeric (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<AddBoxDialog params={validParams} onApply={onApply} {...baseProps} />)

    const zMax = screen.getByTestId('fd-boolean_union_box-zmax')
    await user.clear(zMax)
    await user.click(screen.getByTestId('fd-boolean_union_box-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
