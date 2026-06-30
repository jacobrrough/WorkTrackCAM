/**
 * Pipe dialog — interactive proof (happy-dom) for the PATH PICKER pattern: choose an open polyline
 * from the sketch-derived dropdown, type the outer radius / optional wall / z-start, pick an
 * orientation mode, Apply, and assert the emitted kernel op carries the RESOLVED path points (not the
 * entity id). Also pins the honest empty-state (no open polylines -> no emit) and the
 * wall-thickness >= outer-radius gate (schema refinement).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipeDialog } from '../PipeDialog'
import type { PathOption } from '../profile-path-options'

const PATHS: PathOption[] = [
  { id: 'pl-1', label: 'Polyline · 3 pts', points: [[0, 0], [10, 0], [10, 10]] },
  { id: 'pl-2', label: 'Polyline · 2 pts', points: [[0, 0], [20, 5]] }
]
const base = { selectionInfo: { selection: null, label: null }, busy: false, disabled: false } as const

describe('PipeDialog — interactive (happy-dom)', () => {
  it('emits pipe_path with resolved pathPoints for the chosen path + radius + orientation', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PipeDialog params={{}} paths={PATHS} onApply={onApply} {...base} />)

    await user.selectOptions(screen.getByTestId('fd-pipe_path-path'), 'pl-2')

    const outer = screen.getByTestId('fd-pipe_path-outer')
    await user.clear(outer)
    await user.type(outer, '4')

    const zStart = screen.getByTestId('fd-pipe_path-zstart')
    await user.clear(zStart)
    await user.type(zStart, '2')

    await user.selectOptions(screen.getByTestId('fd-pipe_path-orientation'), 'path_tangent_lock')

    await user.click(screen.getByTestId('fd-pipe_path-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'pipe_path',
        pathPoints: [[0, 0], [20, 5]],
        outerRadiusMm: 4,
        zStartMm: 2,
        orientationMode: 'path_tangent_lock'
      }
    })
  })

  it('includes wallThicknessMm only when a valid (< outer) value is entered', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PipeDialog params={{}} paths={PATHS} onApply={onApply} {...base} />)

    // Defaults: path pl-1, outer radius 5, z 0, frenet. Add a hollow wall of 1.5 mm.
    const wall = screen.getByTestId('fd-pipe_path-wall')
    await user.clear(wall)
    await user.type(wall, '1.5')

    await user.click(screen.getByTestId('fd-pipe_path-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'pipe_path',
        pathPoints: [[0, 0], [10, 0], [10, 10]],
        outerRadiusMm: 5,
        zStartMm: 0,
        orientationMode: 'frenet',
        wallThicknessMm: 1.5
      }
    })
  })

  it('shows an honest empty-state + gates Apply when the sketch has no open polyline', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PipeDialog params={{}} paths={[]} onApply={onApply} {...base} />)

    expect(screen.getByTestId('fd-pipe_path-path-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('fd-pipe_path-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when wall thickness is not less than the outer radius', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PipeDialog params={{}} paths={PATHS} onApply={onApply} {...base} />)

    // outer radius default 5; a wall of 5 (not strictly less) is invalid.
    const wall = screen.getByTestId('fd-pipe_path-wall')
    await user.clear(wall)
    await user.type(wall, '5')
    await user.click(screen.getByTestId('fd-pipe_path-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})
