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
import { inferredAxisConstraints, type AutoConstraintVertex } from '../sketch-auto-constraints'

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

// Node-env can't click the canvas, so the LAST inch (both commit sites actually persist the inferred
// constraints) is pinned textually — the same convention as sketch-cursor-world-threading-pin.test.ts.
const CANVAS = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')

describe('auto-constraint wiring — both polyline commit sites persist the inferred axes', () => {
  it('imports the pure core', () => {
    expect(CANVAS).toContain("import { inferredAxisConstraints } from './sketch-auto-constraints'")
  })

  it('the open-segment AND closed-loop commits both append the inferred constraints', () => {
    // Two call sites (commitOpenPolylineSegment + closePolyline), each spreading the result into the
    // committed design's constraints array — so a drawn-on-axis segment is constrained either way.
    expect(CANVAS.match(/inferredAxisConstraints\(/g) ?? []).toHaveLength(2)
    expect(
      CANVAS.match(/constraints: \[\.\.\.design\.constraints, \.\.\.autoCons\]/g) ?? []
    ).toHaveLength(2)
  })
})
