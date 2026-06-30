/**
 * Combine Profile dialog — interactive proof (happy-dom) for the PROFILE PICKER pattern: pick a
 * combine mode, choose a profile from the sketch-derived dropdown, type the extrude depth + Z start,
 * Apply, and assert the EXACT emitted `boolean_combine_profile` kernel op. Also pins the honest
 * empty-state (no profiles -> no emit) and the optional `extrudeDirection` branch (default OMITS the
 * field; an explicit choice writes it). Mirrors PressPullProfileDialog.dom.spec.tsx.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CombineProfileDialog } from '../CombineProfileDialog'
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

describe('CombineProfileDialog — interactive (happy-dom)', () => {
  it('emits boolean_combine_profile (default direction OMITS extrudeDirection) for the chosen profile + mode + depths', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CombineProfileDialog params={{}} profiles={PROFILES} onApply={onApply} {...base} />)

    await user.selectOptions(screen.getByTestId('fd-boolean_combine_profile-mode'), 'subtract')
    await user.selectOptions(screen.getByTestId('fd-boolean_combine_profile-profile'), '1')
    const depth = screen.getByTestId('fd-boolean_combine_profile-depth')
    await user.clear(depth)
    await user.type(depth, '8')
    const zStart = screen.getByTestId('fd-boolean_combine_profile-zstart')
    await user.clear(zStart)
    await user.type(zStart, '2')
    await user.click(screen.getByTestId('fd-boolean_combine_profile-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_combine_profile',
        mode: 'subtract',
        profileIndex: 1,
        extrudeDepthMm: 8,
        zStartMm: 2
      }
    })
    // The default direction choice must NOT write the optional field.
    expect(onApply.mock.calls[0][0].op).not.toHaveProperty('extrudeDirection')
  })

  it('writes extrudeDirection when the operator explicitly picks −Z', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CombineProfileDialog params={{}} profiles={PROFILES} onApply={onApply} {...base} />)

    await user.selectOptions(screen.getByTestId('fd-boolean_combine_profile-direction'), '-Z')
    await user.click(screen.getByTestId('fd-boolean_combine_profile-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'boolean_combine_profile',
        mode: 'union',
        profileIndex: 0,
        extrudeDepthMm: 5,
        zStartMm: 0,
        extrudeDirection: '-Z'
      }
    })
  })

  it('shows an honest empty-state + gates Apply when the sketch has no closed profile', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CombineProfileDialog params={{}} profiles={[]} onApply={onApply} {...base} />)

    expect(screen.getByTestId('fd-boolean_combine_profile-profile-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('fd-boolean_combine_profile-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply on a non-positive extrude depth (no tool body to combine)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<CombineProfileDialog params={{}} profiles={PROFILES} onApply={onApply} {...base} />)

    const depth = screen.getByTestId('fd-boolean_combine_profile-depth')
    await user.clear(depth)
    await user.type(depth, '0')
    await user.click(screen.getByTestId('fd-boolean_combine_profile-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})
