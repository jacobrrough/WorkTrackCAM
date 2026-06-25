/**
 * Auto-constraint-on-draw core — pure unit pins (node-env, no DOM).
 *
 * Proves that committed axis-aligned segments become persisted horizontal / vertical constraints
 * (the relation the live inference snapped to is now REAL — the solver maintains it on later edits),
 * that off-axis / zero-length segments stay free, and that the `con_<n>` allocator dodges existing ids.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  inferredAxisConstraints,
  inferredCoincidentConstraints,
  type AutoConstraintVertex
} from '../sketch-auto-constraints'

const v = (id: string, x: number, y: number): AutoConstraintVertex => ({ id, pt: [x, y] })

describe('inferredAxisConstraints — auto-constraint on draw (horizontal / vertical)', () => {
  it('constrains an exactly horizontal open segment', () => {
    expect(inferredAxisConstraints([v('p1', 0, 5), v('p2', 10, 5)], false, new Set())).toEqual([
      { id: 'con_1', type: 'horizontal', a: { pointId: 'p1' }, b: { pointId: 'p2' } }
    ])
  })

  it('constrains an exactly vertical open segment', () => {
    expect(inferredAxisConstraints([v('p1', 3, 0), v('p2', 3, 8)], false, new Set())).toEqual([
      { id: 'con_1', type: 'vertical', a: { pointId: 'p1' }, b: { pointId: 'p2' } }
    ])
  })

  it('leaves an off-axis segment free (no constraint)', () => {
    expect(inferredAxisConstraints([v('p1', 0, 0), v('p2', 10, 7)], false, new Set())).toEqual([])
  })

  it('constrains every side of a closed axis-aligned rectangle incl. the closing segment', () => {
    // (0,0) → (10,0) H → (10,6) V → (0,6) H → close (0,6)→(0,0) V
    const out = inferredAxisConstraints(
      [v('a', 0, 0), v('b', 10, 0), v('c', 10, 6), v('d', 0, 6)],
      true,
      new Set()
    )
    expect(out.map((c) => c.type)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical'])
    // The closing segment d→a is the 4th and is vertical.
    expect(out[3]).toEqual({
      id: 'con_4',
      type: 'vertical',
      a: { pointId: 'd' },
      b: { pointId: 'a' }
    })
  })

  it('skips zero-length segments and only constrains the axial ones in a mixed chain', () => {
    // p1→p2 horizontal, p2→p3 zero-length (dup), p3→p4 off-axis.
    expect(
      inferredAxisConstraints(
        [v('p1', 0, 0), v('p2', 5, 0), v('p3', 5, 0), v('p4', 9, 4)],
        false,
        new Set()
      )
    ).toEqual([{ id: 'con_1', type: 'horizontal', a: { pointId: 'p1' }, b: { pointId: 'p2' } }])
  })

  it('allocates con_<n> ids around the already-taken set', () => {
    const out = inferredAxisConstraints(
      [v('p1', 0, 0), v('p2', 4, 0), v('p3', 4, 4)],
      false,
      new Set(['con_1', 'con_3'])
    )
    expect(out.map((c) => c.id)).toEqual(['con_2', 'con_4'])
  })

  it('returns nothing for a degenerate (<2 vertex) chain', () => {
    expect(inferredAxisConstraints([v('only', 1, 1)], false, new Set())).toEqual([])
    expect(inferredAxisConstraints([], true, new Set())).toEqual([])
  })

  it('never emits both horizontal and vertical for one segment (conflict-free)', () => {
    expect(inferredAxisConstraints([v('a', 0, 0), v('b', 0, 0)], false, new Set())).toEqual([])
    expect(inferredAxisConstraints([v('a', 0, 0), v('b', 0, 5)], false, new Set())).toHaveLength(1)
  })
})

describe('inferredCoincidentConstraints — auto-coincident on snap', () => {
  it('constrains a new vertex that lands exactly on an existing point', () => {
    expect(
      inferredCoincidentConstraints([v('new1', 10, 5), v('new2', 20, 8)], [v('old1', 10, 5)], new Set())
    ).toEqual([{ id: 'con_1', type: 'coincident', a: { pointId: 'new1' }, b: { pointId: 'old1' } }])
  })

  it('leaves a vertex that matches no existing point free', () => {
    expect(inferredCoincidentConstraints([v('new1', 1, 2)], [v('old1', 9, 9)], new Set())).toEqual([])
  })

  it('constrains multiple snapped vertices, allocating fresh con ids around the taken set', () => {
    expect(
      inferredCoincidentConstraints(
        [v('a', 0, 0), v('b', 5, 5)],
        [v('p', 0, 0), v('q', 5, 5)],
        new Set(['con_1'])
      )
    ).toEqual([
      { id: 'con_2', type: 'coincident', a: { pointId: 'a' }, b: { pointId: 'p' } },
      { id: 'con_3', type: 'coincident', a: { pointId: 'b' }, b: { pointId: 'q' } }
    ])
  })

  it('takes the first existing point at a coordinate (degenerate stacks)', () => {
    expect(
      inferredCoincidentConstraints([v('new', 3, 3)], [v('first', 3, 3), v('second', 3, 3)], new Set())
    ).toEqual([{ id: 'con_1', type: 'coincident', a: { pointId: 'new' }, b: { pointId: 'first' } }])
  })

  it('returns nothing with no new vertices or no existing points', () => {
    expect(inferredCoincidentConstraints([], [v('p', 0, 0)], new Set())).toEqual([])
    expect(inferredCoincidentConstraints([v('n', 0, 0)], [], new Set())).toEqual([])
  })
})

// Node-env can't click the canvas, so the LAST inch (both commit sites actually persist the inferred
// constraints) is pinned textually — the same convention as sketch-cursor-world-threading-pin.test.ts.
const CANVAS = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')

describe('auto-constraint wiring — both polyline commit sites persist the inferred constraints', () => {
  it('imports the pure cores', () => {
    expect(CANVAS).toContain(
      "import { inferredAxisConstraints, inferredCoincidentConstraints } from './sketch-auto-constraints'"
    )
  })

  it('the open-segment AND closed-loop commits both append axis + coincident constraints', () => {
    // Two call sites (commitOpenPolylineSegment + closePolyline), each running both pure cores and
    // spreading the result into the committed design's constraints array.
    expect(CANVAS.match(/inferredAxisConstraints\(/g) ?? []).toHaveLength(2)
    expect(CANVAS.match(/inferredCoincidentConstraints\(/g) ?? []).toHaveLength(2)
    expect(
      CANVAS.match(/constraints: \[\.\.\.design\.constraints, \.\.\.autoCons\]/g) ?? []
    ).toHaveLength(2)
  })
})
