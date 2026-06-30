/**
 * INTERACTIVE test (happy-dom): renders the Intersect Box dialog, types into its six bound fields,
 * clicks Apply, and asserts the EXACT emitted `boolean_intersect_box` kernelOp — behaviour a source
 * pin can't prove. Mirrors `ExtrudeDialog.dom.spec.tsx`; see the `wire-feature-dialog` skill. Run
 * with `npm run test:dom` (or `npx vitest run -c vitest.dom.config.ts <thisfile>`).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntersectBoxDialog } from '../IntersectBoxDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

const defaultParams = {
  xMinMm: -10,
  xMaxMm: 10,
  yMinMm: -10,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 20
} as const

/** Clear a numeric field and type a fresh value into it. */
async function setField(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
): Promise<void> {
  const field = screen.getByTestId(testId)
  await user.clear(field)
  await user.type(field, value)
}

describe('IntersectBoxDialog — interactive (happy-dom)', () => {
  it('emits the exact boolean_intersect_box op from the typed bounds', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<IntersectBoxDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await setField(user, 'fd-boolean_intersect_box-x-min', '-5')
    await setField(user, 'fd-boolean_intersect_box-x-max', '15')
    await setField(user, 'fd-boolean_intersect_box-y-min', '-7.5')
    await setField(user, 'fd-boolean_intersect_box-y-max', '7.5')
    await setField(user, 'fd-boolean_intersect_box-z-min', '0')
    await setField(user, 'fd-boolean_intersect_box-z-max', '12')

    await user.click(screen.getByTestId('fd-boolean_intersect_box-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_intersect_box',
        xMinMm: -5,
        xMaxMm: 15,
        yMinMm: -7.5,
        yMaxMm: 7.5,
        zMinMm: 0,
        zMaxMm: 12
      }
    })
  })

  it('gates Apply when an axis is not strictly increasing (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<IntersectBoxDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    // Make X max <= X min — the schema's refine would reject this, so Apply must not emit.
    await setField(user, 'fd-boolean_intersect_box-x-min', '20')
    await setField(user, 'fd-boolean_intersect_box-x-max', '5')

    await user.click(screen.getByTestId('fd-boolean_intersect_box-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when a bound is left blank / non-numeric (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<IntersectBoxDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await user.clear(screen.getByTestId('fd-boolean_intersect_box-z-max'))

    await user.click(screen.getByTestId('fd-boolean_intersect_box-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
