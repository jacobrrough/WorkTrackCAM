/**
 * INTERACTIVE test (happy-dom): renders the real Mirror feature dialog, picks a
 * plane, types the origin coordinates, clicks Apply, and asserts the EXACT
 * emitted `mirror_union_plane` kernel op — the kind of behavioural proof source
 * pins can never give. Mirrors `ExtrudeDialog.dom.spec.tsx`; see the
 * `wire-feature-dialog` skill. Run with `npx vitest run -c vitest.dom.config.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MirrorDialog } from '../MirrorDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('MirrorDialog — interactive (happy-dom)', () => {
  it('emits the mirror_union_plane op with the picked plane + typed origins', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<MirrorDialog params={{ plane: 'YZ' }} onApply={onApply} {...baseProps} />)

    await user.selectOptions(screen.getByTestId('fd-mirror_union_plane-plane'), 'XZ')

    const originX = screen.getByTestId('fd-mirror_union_plane-originX')
    await user.clear(originX)
    await user.type(originX, '5')

    const originY = screen.getByTestId('fd-mirror_union_plane-originY')
    await user.clear(originY)
    await user.type(originY, '-12.5')

    const originZ = screen.getByTestId('fd-mirror_union_plane-originZ')
    await user.clear(originZ)
    await user.type(originZ, '0')

    await user.click(screen.getByTestId('fd-mirror_union_plane-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'mirror_union_plane',
        plane: 'XZ',
        originXMm: 5,
        originYMm: -12.5,
        originZMm: 0
      }
    })
  })

  it('defaults to the YZ plane with zero origins when applied untouched', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<MirrorDialog params={{}} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-mirror_union_plane-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'mirror_union_plane',
        plane: 'YZ',
        originXMm: 0,
        originYMm: 0,
        originZMm: 0
      }
    })
  })

  it('gates Apply on a non-finite origin (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<MirrorDialog params={{ plane: 'YZ' }} onApply={onApply} {...baseProps} />)

    // A bare "-" parses to NaN → parseFiniteMm rejects it → Apply is gated.
    const originX = screen.getByTestId('fd-mirror_union_plane-originX')
    await user.clear(originX)
    await user.type(originX, '-')
    await user.click(screen.getByTestId('fd-mirror_union_plane-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
