/**
 * Sketch edit dialogs (Offset / Array) — INTERACTIVE proof (happy-dom). These were wired into the
 * SketchSurface palette + unit-tested at the module level, but node-env never proved the dialog
 * actually applies on a click. This drives the real flow: render with a selected closed loop, click
 * Apply, and assert the merged design grew — and that an empty selection honestly gates Apply.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OffsetSketchDialog, ArraySketchDialog } from '../SketchEditDialogs'
import { emptyDesign, type DesignFileV2 } from '../../../../shared/design-schema'

/** A single closed 10×10 square loop selectable as 'sq'. */
function squareDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [{ id: 'sq', kind: 'polyline', pointIds: ['a', 'b', 'c', 'd'], closed: true }],
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 10 }, d: { x: 0, y: 10 } }
  }
}

describe('OffsetSketchDialog — interactive (happy-dom)', () => {
  it('offsets the selected closed loop and applies a grown design', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const design = squareDesign()
    render(<OffsetSketchDialog design={design} selectedIds={['sq']} onApply={onApply} />)

    const distance = screen.getByTestId('fd-sk-offset-distance')
    await user.clear(distance)
    await user.type(distance, '2') // outset → a real new loop is added
    await user.click(screen.getByTestId('fd-sk-offset-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    const next = onApply.mock.calls[0]![0] as DesignFileV2
    expect(next.entities.length).toBeGreaterThan(design.entities.length)
  })

  it('honestly gates Apply when no closed loop is selected', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<OffsetSketchDialog design={squareDesign()} selectedIds={[]} onApply={onApply} />)

    expect(screen.getByTestId('fd-sk-offset-selection').textContent).toContain('No closed loop')
    await user.click(screen.getByTestId('fd-sk-offset-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('ArraySketchDialog — interactive (happy-dom)', () => {
  it('rectangular-arrays the selection into a grown design', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const design = squareDesign()
    render(<ArraySketchDialog design={design} selectedIds={['sq']} onApply={onApply} />)

    const cols = screen.getByTestId('fd-sk-array-cols')
    await user.clear(cols)
    await user.type(cols, '3') // 3 cols × default rows → copies added
    await user.click(screen.getByTestId('fd-sk-array-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    const next = onApply.mock.calls[0]![0] as DesignFileV2
    expect(next.entities.length).toBeGreaterThan(design.entities.length)
  })

  it('honestly gates Apply with no selection', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ArraySketchDialog design={squareDesign()} selectedIds={[]} onApply={onApply} />)

    await user.click(screen.getByTestId('fd-sk-array-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})
