/**
 * Press/Pull dialog — interactive proof (happy-dom) for the PROFILE PICKER pattern: choose a profile
 * from the sketch-derived dropdown, type a signed distance, Apply, and assert the emitted kernel op.
 * Also pins the honest empty-state (no profiles -> no emit). Template for the other profile/path dialogs.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PressPullProfileDialog } from '../PressPullProfileDialog'
import type { ProfileOption } from '../profile-path-options'

const PROFILES: ProfileOption[] = [
  { index: 0, label: '0 · Circle ⌀20 @ (5, 5)', profile: { type: 'circle', cx: 5, cy: 5, r: 10 } },
  {
    index: 1,
    label: '1 · Loop · 4 pts',
    profile: { type: 'loop', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }
  }
]
const base = { selectionInfo: { selection: null, label: null }, busy: false, disabled: false } as const

describe('PressPullProfileDialog — interactive (happy-dom)', () => {
  it('emits press_pull_profile for the chosen profile + signed distance', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PressPullProfileDialog params={{}} profiles={PROFILES} onApply={onApply} {...base} />)

    await user.selectOptions(screen.getByTestId('fd-press_pull_profile-profile'), '1')
    const delta = screen.getByTestId('fd-press_pull_profile-delta')
    await user.clear(delta)
    await user.type(delta, '-3')
    await user.click(screen.getByTestId('fd-press_pull_profile-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'press_pull_profile', profileIndex: 1, deltaMm: -3, zStartMm: 0 }
    })
  })

  it('shows an honest empty-state + gates Apply when the sketch has no closed profile', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PressPullProfileDialog params={{}} profiles={[]} onApply={onApply} {...base} />)

    expect(screen.getByTestId('fd-press_pull_profile-profile-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('fd-press_pull_profile-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on a zero distance (no-op press/pull)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PressPullProfileDialog params={{}} profiles={PROFILES} onApply={onApply} {...base} />)

    const delta = screen.getByTestId('fd-press_pull_profile-delta')
    await user.clear(delta)
    await user.type(delta, '0')
    await user.click(screen.getByTestId('fd-press_pull_profile-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})
