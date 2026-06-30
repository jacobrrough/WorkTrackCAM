/**
 * Sweep dialog — interactive proof (happy-dom) for the PROFILE + PATH picker pattern: choose a
 * profile and an open path from sketch-derived dropdowns, pick an orientation mode, type Z-start,
 * Apply, and assert the emitted `sweep_profile_path_true` kernel op (with the path RESOLVED to its
 * point list). Also pins: the `fixed_normal` mode reveals + requires the normal vector, and the
 * honest empty-state for both an empty profile list and an empty path list (no emit either way).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SweepDialog } from '../SweepDialog'
import type { PathOption, ProfileOption } from '../profile-path-options'

const PROFILES: ProfileOption[] = [
  { index: 0, label: '0 · Circle ⌀20 @ (5, 5)', profile: { type: 'circle', cx: 5, cy: 5, r: 10 } },
  {
    index: 1,
    label: '1 · Loop · 4 pts',
    profile: { type: 'loop', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }
  }
]
const PATHS: PathOption[] = [
  { id: 'poly-a', label: 'Polyline · 3 pts', points: [[0, 0], [10, 0], [10, 10]] },
  { id: 'poly-b', label: 'Polyline · 2 pts', points: [[0, 0], [0, 20]] }
]
const base = { selectionInfo: { selection: null, label: null }, busy: false, disabled: false } as const

describe('SweepDialog — interactive (happy-dom)', () => {
  it('emits sweep_profile_path_true with the resolved path points (frenet default)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <SweepDialog params={{}} profiles={PROFILES} paths={PATHS} onApply={onApply} {...base} />
    )

    await user.selectOptions(screen.getByTestId('fd-sweep_profile_path_true-profile'), '1')
    await user.selectOptions(screen.getByTestId('fd-sweep_profile_path_true-path'), 'poly-b')
    const zstart = screen.getByTestId('fd-sweep_profile_path_true-zstart')
    await user.clear(zstart)
    await user.type(zstart, '2')
    await user.click(screen.getByTestId('fd-sweep_profile_path_true-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'sweep_profile_path_true',
        profileIndex: 1,
        pathPoints: [[0, 0], [0, 20]],
        zStartMm: 2,
        orientationMode: 'frenet'
      }
    })
  })

  it('reveals + emits the fixed-normal vector only in fixed_normal mode', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <SweepDialog params={{}} profiles={PROFILES} paths={PATHS} onApply={onApply} {...base} />
    )

    // Normal fields are hidden until fixed_normal is chosen.
    expect(screen.queryByTestId('fd-sweep_profile_path_true-nx')).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByTestId('fd-sweep_profile_path_true-orientation'),
      'fixed_normal'
    )
    const nx = screen.getByTestId('fd-sweep_profile_path_true-nx')
    const ny = screen.getByTestId('fd-sweep_profile_path_true-ny')
    const nz = screen.getByTestId('fd-sweep_profile_path_true-nz')
    await user.clear(nx)
    await user.type(nx, '1')
    await user.clear(ny)
    await user.type(ny, '0')
    await user.clear(nz)
    await user.type(nz, '0')
    await user.click(screen.getByTestId('fd-sweep_profile_path_true-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'sweep_profile_path_true',
        profileIndex: 0,
        pathPoints: [[0, 0], [10, 0], [10, 10]],
        zStartMm: 0,
        orientationMode: 'fixed_normal',
        fixedNormal: [1, 0, 0]
      }
    })
  })

  it('shows an honest empty-state + gates Apply when the sketch has no closed profile', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SweepDialog params={{}} profiles={[]} paths={PATHS} onApply={onApply} {...base} />)

    expect(screen.getByTestId('fd-sweep_profile_path_true-profile-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('fd-sweep_profile_path_true-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows an honest empty-state + gates Apply when the sketch has no open path', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SweepDialog params={{}} profiles={PROFILES} paths={[]} onApply={onApply} {...base} />)

    expect(screen.getByTestId('fd-sweep_profile_path_true-path-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('fd-sweep_profile_path_true-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})
