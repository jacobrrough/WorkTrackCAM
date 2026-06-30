/**
 * INTERACTIVE test (happy-dom) for the Plastic Boss dialog: renders the real
 * dialog, types values, clicks Apply, and asserts the EXACT emitted `plastic_boss`
 * kernel op — the behavioural check that source pins can never prove. Mirrors
 * `ExtrudeDialog.dom.spec.tsx`; see the `wire-feature-dialog` skill. Run with
 * `npm run test:dom` (or the dom vitest config directly).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlasticBossDialog } from '../PlasticBossDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

/** A sane opening boss the operator can overwrite per test. */
const params = {
  centerXMm: 0,
  centerYMm: 0,
  zBaseMm: 0,
  outerRadiusMm: 5,
  heightMm: 8,
  draftDeg: 1
} as const

describe('PlasticBossDialog — interactive (happy-dom)', () => {
  it('emits the exact plastic_boss op for a solid boss (hole left blank)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticBossDialog params={params} onApply={onApply} {...baseProps} />)

    const center = screen.getByTestId('fd-plastic_boss-centerX')
    await user.clear(center)
    await user.type(center, '12')

    const outer = screen.getByTestId('fd-plastic_boss-outerRadius')
    await user.clear(outer)
    await user.type(outer, '6')

    const height = screen.getByTestId('fd-plastic_boss-height')
    await user.clear(height)
    await user.type(height, '10')

    await user.click(screen.getByTestId('fd-plastic_boss-apply'))

    // Solid boss → NO holeRadiusMm key. draftDeg carries the opening default (1).
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'plastic_boss',
        centerXMm: 12,
        centerYMm: 0,
        zBaseMm: 0,
        outerRadiusMm: 6,
        heightMm: 10,
        draftDeg: 1
      }
    })
  })

  it('includes holeRadiusMm when a valid bore is entered', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticBossDialog params={params} onApply={onApply} {...baseProps} />)

    const outer = screen.getByTestId('fd-plastic_boss-outerRadius')
    await user.clear(outer)
    await user.type(outer, '5')

    const hole = screen.getByTestId('fd-plastic_boss-holeRadius')
    await user.clear(hole)
    await user.type(hole, '2')

    const draft = screen.getByTestId('fd-plastic_boss-draftDeg')
    await user.clear(draft)
    await user.type(draft, '3')

    await user.click(screen.getByTestId('fd-plastic_boss-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'plastic_boss',
        centerXMm: 0,
        centerYMm: 0,
        zBaseMm: 0,
        outerRadiusMm: 5,
        heightMm: 8,
        holeRadiusMm: 2,
        draftDeg: 3
      }
    })
  })

  it('clamps an over-range draft angle to the schema bound (8°)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticBossDialog params={params} onApply={onApply} {...baseProps} />)

    const draft = screen.getByTestId('fd-plastic_boss-draftDeg')
    await user.clear(draft)
    await user.type(draft, '20')

    await user.click(screen.getByTestId('fd-plastic_boss-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0].op.draftDeg).toBe(8)
  })

  it('gates Apply on a non-positive outer radius (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticBossDialog params={params} onApply={onApply} {...baseProps} />)

    const outer = screen.getByTestId('fd-plastic_boss-outerRadius')
    await user.clear(outer)
    await user.type(outer, '0')

    await user.click(screen.getByTestId('fd-plastic_boss-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when the hole radius is not strictly inside the boss (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticBossDialog params={params} onApply={onApply} {...baseProps} />)

    const outer = screen.getByTestId('fd-plastic_boss-outerRadius')
    await user.clear(outer)
    await user.type(outer, '4')

    // Hole radius >= outer radius: the kernel would silently drop the bore, so
    // the dialog must refuse to emit.
    const hole = screen.getByTestId('fd-plastic_boss-holeRadius')
    await user.clear(hole)
    await user.type(hole, '4')

    await user.click(screen.getByTestId('fd-plastic_boss-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
