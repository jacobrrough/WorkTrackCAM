/**
 * INTERACTIVE test (happy-dom) for the Cut Cylinder dialog: renders the real dialog, types every
 * param, clicks Apply, and asserts the EXACT emitted `boolean_subtract_cylinder` kernel op — the
 * behavioural proof source pins can't give. Mirrors `ExtrudeDialog.dom.spec.tsx`. Run with
 * `npm run test:dom` (or `npx vitest run -c vitest.dom.config.ts ...`).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CutCylinderDialog } from '../CutCylinderDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

const defaultParams = {
  centerXMm: 0,
  centerYMm: 0,
  radiusMm: 5,
  zMinMm: 0,
  zMaxMm: 10
} as const

async function typeInto(user: ReturnType<typeof userEvent.setup>, testId: string, value: string) {
  const input = screen.getByTestId(testId)
  await user.clear(input)
  await user.type(input, value)
}

describe('CutCylinderDialog — interactive (happy-dom)', () => {
  it('emits the exact boolean_subtract_cylinder op from the typed values', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutCylinderDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await typeInto(user, 'fd-boolean_subtract_cylinder-centerX', '12.5')
    await typeInto(user, 'fd-boolean_subtract_cylinder-centerY', '-4')
    await typeInto(user, 'fd-boolean_subtract_cylinder-radius', '3.25')
    await typeInto(user, 'fd-boolean_subtract_cylinder-zMin', '1')
    await typeInto(user, 'fd-boolean_subtract_cylinder-zMax', '8')
    await user.click(screen.getByTestId('fd-boolean_subtract_cylinder-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_subtract_cylinder',
        centerXMm: 12.5,
        centerYMm: -4,
        radiusMm: 3.25,
        zMinMm: 1,
        zMaxMm: 8
      }
    })
  })

  it('applies the opening defaults when nothing is changed', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutCylinderDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-boolean_subtract_cylinder-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_subtract_cylinder',
        centerXMm: 0,
        centerYMm: 0,
        radiusMm: 5,
        zMinMm: 0,
        zMaxMm: 10
      }
    })
  })

  it('gates Apply on a non-positive radius (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutCylinderDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    await typeInto(user, 'fd-boolean_subtract_cylinder-radius', '0')
    await user.click(screen.getByTestId('fd-boolean_subtract_cylinder-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when the Z span is not strictly increasing (zMax <= zMin, no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CutCylinderDialog params={defaultParams} onApply={onApply} {...baseProps} />)

    // zMin = 10, zMax = 10 → span is zero, the schema refine would reject it.
    await typeInto(user, 'fd-boolean_subtract_cylinder-zMin', '10')
    await typeInto(user, 'fd-boolean_subtract_cylinder-zMax', '10')
    await user.click(screen.getByTestId('fd-boolean_subtract_cylinder-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
