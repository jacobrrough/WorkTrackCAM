/**
 * INTERACTIVE test (happy-dom): renders the real HOLE WIZARD dialog, exercises
 * the hole-type selector, proves the conditional counterbore / countersink
 * fields appear only for their type, and asserts the EXACT emitted
 * `hole_from_profile` kernel op — behaviour a source pin can never prove. Also
 * covers the wave-1 EDIT-MODE pre-fill round-trip (params → dialog → same op).
 * Mirrors `ThreadDialog.dom.spec.tsx`; run with
 * `npx vitest run --config vitest.dom.config.ts <spec>`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HoleDialog } from '../HoleDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('HoleDialog — interactive (happy-dom)', () => {
  it('defaults to a simple through-all bore and hides the recess fields', () => {
    render(<HoleDialog params={{ profileIndex: 0 }} onApply={vi.fn()} {...baseProps} />)
    expect(screen.getByTestId('fd-hole-type')).toHaveValue('simple')
    // No recess fields for a simple hole.
    expect(screen.queryByTestId('fd-hole-cbore-dia')).toBeNull()
    expect(screen.queryByTestId('fd-hole-csink-dia')).toBeNull()
    // Through-all hides depth.
    expect(screen.queryByTestId('fd-hole-depth')).toBeNull()
  })

  it('emits a plain simple hole (no holeType / recess fields) when unedited', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<HoleDialog params={{ profileIndex: 0, mode: 'through_all' }} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-hole-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'hole_from_profile', profileIndex: 0, mode: 'through_all', zStartMm: 0 }
    })
  })

  it('selecting Counterbore reveals its fields and emits the counterbore op', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<HoleDialog params={{ profileIndex: 0, mode: 'through_all' }} onApply={onApply} {...baseProps} />)

    // Counterbore fields are absent until the type is chosen.
    expect(screen.queryByTestId('fd-hole-cbore-dia')).toBeNull()
    await user.selectOptions(screen.getByTestId('fd-hole-type'), 'counterbore')
    expect(screen.getByTestId('fd-hole-cbore-dia')).toBeTruthy()
    expect(screen.getByTestId('fd-hole-cbore-depth')).toBeTruthy()

    const typeInto = async (testId: string, value: string): Promise<void> => {
      const input = screen.getByTestId(testId)
      await user.clear(input)
      await user.type(input, value)
    }
    await typeInto('fd-hole-cbore-dia', '12')
    await typeInto('fd-hole-cbore-depth', '4')

    await user.click(screen.getByTestId('fd-hole-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'counterbore',
        cboreDiameterMm: 12,
        cboreDepthMm: 4
      }
    })
  })

  it('selecting Countersink reveals its fields and emits the countersink op', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<HoleDialog params={{ profileIndex: 2, mode: 'through_all' }} onApply={onApply} {...baseProps} />)

    await user.selectOptions(screen.getByTestId('fd-hole-type'), 'countersink')
    expect(screen.getByTestId('fd-hole-csink-dia')).toBeTruthy()
    expect(screen.getByTestId('fd-hole-csink-angle')).toBeTruthy()
    // Choosing countersink hides the counterbore fields.
    expect(screen.queryByTestId('fd-hole-cbore-dia')).toBeNull()

    const typeInto = async (testId: string, value: string): Promise<void> => {
      const input = screen.getByTestId(testId)
      await user.clear(input)
      await user.type(input, value)
    }
    await typeInto('fd-hole-csink-dia', '10')
    await typeInto('fd-hole-csink-angle', '82')

    await user.click(screen.getByTestId('fd-hole-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'hole_from_profile',
        profileIndex: 2,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'countersink',
        csinkDiameterMm: 10,
        csinkAngleDeg: 82
      }
    })
  })

  it('records a tap designation (metadata) on the emitted op', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<HoleDialog params={{ profileIndex: 0, mode: 'through_all' }} onApply={onApply} {...baseProps} />)

    await user.type(screen.getByTestId('fd-hole-tap'), 'M5x0.8')
    await user.click(screen.getByTestId('fd-hole-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0,
        tapDesignation: 'M5x0.8'
      }
    })
  })

  it('gates Apply on a countersink angle out of (0,180) — no emit', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<HoleDialog params={{ profileIndex: 0, mode: 'through_all' }} onApply={onApply} {...baseProps} />)

    await user.selectOptions(screen.getByTestId('fd-hole-type'), 'countersink')
    const angle = screen.getByTestId('fd-hole-csink-angle')
    await user.clear(angle)
    await user.type(angle, '200') // >= 180 is invalid
    await user.click(screen.getByTestId('fd-hole-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('EDIT MODE: pre-fills a persisted counterbore op and round-trips it back', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    // The host seeds the dialog from featureDialogSpecForOp(op).params.
    render(
      <HoleDialog
        params={{
          profileIndex: 1,
          mode: 'through_all',
          zStartMm: 0,
          holeType: 'counterbore',
          cboreDiameterMm: 14,
          cboreDepthMm: 5,
          tapDesignation: 'M8x1.25'
        }}
        onApply={onApply}
        {...baseProps}
      />
    )

    // The persisted values are pre-filled…
    expect(screen.getByTestId('fd-hole-type')).toHaveValue('counterbore')
    expect(screen.getByTestId('fd-hole-cbore-dia')).toHaveValue(14)
    expect(screen.getByTestId('fd-hole-cbore-depth')).toHaveValue(5)
    expect(screen.getByTestId('fd-hole-tap')).toHaveValue('M8x1.25')

    // …and applying with no edits re-emits the SAME op.
    await user.click(screen.getByTestId('fd-hole-apply'))
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'hole_from_profile',
        profileIndex: 1,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'counterbore',
        cboreDiameterMm: 14,
        cboreDepthMm: 5,
        tapDesignation: 'M8x1.25'
      }
    })
  })
})
