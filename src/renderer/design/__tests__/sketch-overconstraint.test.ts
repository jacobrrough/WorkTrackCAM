/**
 * Rank-based over-constraint gate — pure unit pins (node-env).
 *
 * The load-bearing guarantee: auto-adding perpendicular corners never over-constrains a closed shape.
 * A slanted rectangle's four right-angles are not independent (the fourth is implied by the other
 * three + closure), and a corner already pinned by horizontal+vertical sides is redundant — the gate
 * must drop exactly those, and keep genuinely independent constraints.
 */

import { describe, expect, it } from 'vitest'
import { keepRankIndependent } from '../sketch-overconstraint'
import { inferredPerpendicularCandidates, type AutoConstraintVertex } from '../sketch-auto-constraints'
import type { SketchConstraint } from '../../../shared/design-schema'

const v = (id: string, x: number, y: number): AutoConstraintVertex => ({ id, pt: [x, y] })
const ptsOf = (vs: AutoConstraintVertex[]): Record<string, { x: number; y: number }> =>
  Object.fromEntries(vs.map((p) => [p.id, { x: p.pt[0], y: p.pt[1] }]))

// A slanted RECTANGLE: sides A=(4,3) and B=(-3,4) are perpendicular, length 5, neither axis-aligned.
// Every one of the four corners is exactly a right angle.
const SLANTED_RECT = [v('v0', 0, 0), v('v1', 4, 3), v('v2', 1, 7), v('v3', -3, 4)]

describe('keepRankIndependent — over-constraint gate', () => {
  it('keeps 3 of a closed slanted rectangle 4 perpendiculars (drops the implied one)', () => {
    const cands = inferredPerpendicularCandidates(SLANTED_RECT, true, new Set())
    expect(cands).toHaveLength(4) // every corner is a right angle
    const kept = keepRankIndependent(
      [],
      cands,
      ptsOf(SLANTED_RECT),
      SLANTED_RECT.map((p) => p.id)
    )
    expect(kept).toHaveLength(3)
  })

  it('keeps the single perpendicular of an open 3-vertex corner', () => {
    const open = [v('a', 0, 0), v('b', 4, 3), v('c', 1, 7)] // a→b=(4,3) ⟂ b→c=(-3,4)
    const cands = inferredPerpendicularCandidates(open, false, new Set())
    expect(cands).toHaveLength(1)
    const kept = keepRankIndependent([], cands, ptsOf(open), open.map((p) => p.id))
    expect(kept).toHaveLength(1)
  })

  it('drops a perpendicular already implied by horizontal + vertical sides', () => {
    const base: SketchConstraint[] = [
      { id: 'con_1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } },
      { id: 'con_2', type: 'vertical', a: { pointId: 'b' }, b: { pointId: 'c' } }
    ]
    const perp: SketchConstraint = {
      id: 'con_3',
      type: 'perpendicular',
      a1: { pointId: 'a' },
      b1: { pointId: 'b' },
      a2: { pointId: 'b' },
      b2: { pointId: 'c' }
    }
    const pts = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 8 } }
    expect(keepRankIndependent(base, [perp], pts, ['a', 'b', 'c'])).toHaveLength(0)
  })

  it('keeps an independent perpendicular not implied by the base', () => {
    const perp: SketchConstraint = {
      id: 'con_1',
      type: 'perpendicular',
      a1: { pointId: 'a' },
      b1: { pointId: 'b' },
      a2: { pointId: 'b' },
      b2: { pointId: 'c' }
    }
    const pts = { a: { x: 0, y: 0 }, b: { x: 4, y: 3 }, c: { x: 1, y: 7 } }
    expect(keepRankIndependent([], [perp], pts, ['a', 'b', 'c'])).toHaveLength(1)
  })

  it('an empty candidate list yields nothing', () => {
    expect(keepRankIndependent([], [], ptsOf(SLANTED_RECT), ['v0'])).toEqual([])
  })
})
