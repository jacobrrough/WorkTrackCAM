/**
 * INTERACTIVE test (happy-dom) for the Lip / Groove dialog: renders the real
 * dialog, picks a mode, types the footprint + depth, clicks Apply, and asserts
 * the EXACT emitted `plastic_lip_groove` kernel op — behaviour a source pin can
 * never prove. Mirrors `CutBoxDialog.dom.spec.tsx`. Run with `npm run test:dom`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlasticLipGrooveDialog } from '../PlasticLipGrooveDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

/** Opening defaults — a valid footprint (max > min on X and Y) + positive depth. */
const defaultParams = {
  mode: 'lip',
  xMinMm: 0,
  xMaxMm: 50,
  yMinMm: 0,
  yMaxMm: 30,
  zBaseMm: 10,
  depthMm: 2
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

describe('PlasticLipGrooveDialog — interactive (happy-dom)', () => {
  it('applies the typed footprint + groove mode as a plastic_lip_groove kernel op', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <PlasticLipGrooveDialog params={defaultParams} onApply={onApply} {...baseProps} />
    )

    await user.selectOptions(screen.getByTestId('fd-plastic_lip_groove-mode'), 'groove')
    await setField(user, 'fd-plastic_lip_groove-xMin', '2')
    await setField(user, 'fd-plastic_lip_groove-xMax', '48')
    await setField(user, 'fd-plastic_lip_groove-yMin', '-5')
    await setField(user, 'fd-plastic_lip_groove-yMax', '25')
    await setField(user, 'fd-plastic_lip_groove-zBase', '12.5')
    await setField(user, 'fd-plastic_lip_groove-depth', '1.5')
    await user.click(screen.getByTestId('fd-plastic_lip_groove-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'plastic_lip_groove',
        mode: 'groove',
        xMinMm: 2,
        xMaxMm: 48,
        yMinMm: -5,
        yMaxMm: 25,
        zBaseMm: 12.5,
        depthMm: 1.5
      }
    })
  })

  it('emits the default lip mode when the operator does not change it', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <PlasticLipGrooveDialog params={defaultParams} onApply={onApply} {...baseProps} />
    )

    await user.click(screen.getByTestId('fd-plastic_lip_groove-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'plastic_lip_groove',
        mode: 'lip',
        xMinMm: 0,
        xMaxMm: 50,
        yMinMm: 0,
        yMaxMm: 30,
        zBaseMm: 10,
        depthMm: 2
      }
    })
  })

  it('gates Apply when the footprint is not strictly increasing (X max <= X min, no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <PlasticLipGrooveDialog params={defaultParams} onApply={onApply} {...baseProps} />
    )

    // Make X max equal to X min — a zero-area footprint the dialog must reject.
    await setField(user, 'fd-plastic_lip_groove-xMin', '4')
    await setField(user, 'fd-plastic_lip_groove-xMax', '4')
    await user.click(screen.getByTestId('fd-plastic_lip_groove-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when depth is non-positive (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <PlasticLipGrooveDialog params={defaultParams} onApply={onApply} {...baseProps} />
    )

    // Depth 0 — the schema's mmPos would reject it; the dialog gate blocks first.
    await setField(user, 'fd-plastic_lip_groove-depth', '0')
    await user.click(screen.getByTestId('fd-plastic_lip_groove-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when a field is left blank (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <PlasticLipGrooveDialog params={defaultParams} onApply={onApply} {...baseProps} />
    )

    // Clear Y max — an unparseable (empty) field must block Apply.
    const yMax = screen.getByTestId('fd-plastic_lip_groove-yMax')
    await user.clear(yMax)
    await user.click(screen.getByTestId('fd-plastic_lip_groove-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
