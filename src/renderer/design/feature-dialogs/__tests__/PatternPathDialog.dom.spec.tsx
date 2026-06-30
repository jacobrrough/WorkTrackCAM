/**
 * Pattern Along Path dialog — interactive proof (happy-dom) for the PATH PICKER pattern: choose an
 * open polyline from the sketch-derived dropdown (holding its entity id), type a count, toggle the
 * optional flags, Apply, and assert the emitted kernel op carries the RESOLVED pathPoints (not the
 * id). Also pins the honest empty-state (no paths -> no emit).
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatternPathDialog } from '../PatternPathDialog'
import type { PathOption } from '../profile-path-options'

const PATHS: PathOption[] = [
  { id: 'pl-1', label: 'Polyline · 2 pts', points: [[0, 0], [40, 0]] },
  {
    id: 'pl-2',
    label: 'Polyline · 4 pts',
    points: [[0, 0], [20, 0], [20, 20], [0, 20]]
  }
]
const base = { selectionInfo: { selection: null, label: null }, busy: false, disabled: false } as const

describe('PatternPathDialog — interactive (happy-dom)', () => {
  it('emits pattern_path with the resolved pathPoints for the chosen path + count + flags', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PatternPathDialog params={{}} paths={PATHS} onApply={onApply} {...base} />)

    await user.selectOptions(screen.getByTestId('fd-pattern_path-path'), 'pl-2')
    const count = screen.getByTestId('fd-pattern_path-count')
    await user.clear(count)
    await user.type(count, '6')
    await user.click(screen.getByTestId('fd-pattern_path-closed'))
    await user.click(screen.getByTestId('fd-pattern_path-align'))
    await user.click(screen.getByTestId('fd-pattern_path-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: {
        kind: 'pattern_path',
        count: 6,
        pathPoints: [[0, 0], [20, 0], [20, 20], [0, 20]],
        closedPath: true,
        alignToPathTangent: true
      }
    })
  })

  it('defaults to the first path and omits the optional flags when left off', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PatternPathDialog params={{}} paths={PATHS} onApply={onApply} {...base} />)

    // No path selection → defaults to paths[0] (pl-1); count default is 4; flags off.
    await user.click(screen.getByTestId('fd-pattern_path-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'pattern_path', count: 4, pathPoints: [[0, 0], [40, 0]] }
    })
  })

  it('shows an honest empty-state + gates Apply when the sketch has no open polyline', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PatternPathDialog params={{}} paths={[]} onApply={onApply} {...base} />)

    expect(screen.getByTestId('fd-pattern_path-path-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('fd-pattern_path-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when “closed” is on but the chosen path has only 2 points', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PatternPathDialog params={{}} paths={PATHS} onApply={onApply} {...base} />)

    // pl-1 has 2 points; closedPath requires ≥3, so Apply must not emit.
    await user.selectOptions(screen.getByTestId('fd-pattern_path-path'), 'pl-1')
    await user.click(screen.getByTestId('fd-pattern_path-closed'))
    await user.click(screen.getByTestId('fd-pattern_path-apply'))
    expect(onApply).not.toHaveBeenCalled()
  })
})
