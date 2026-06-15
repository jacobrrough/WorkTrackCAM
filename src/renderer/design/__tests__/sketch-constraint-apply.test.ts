/**
 * Sketch S5 — pure units for the constraint-from-selection builder.
 *
 * Node-SSR / pure (no jsdom): exercises every toolbar kind on a RIGHT selection
 * (constraint added, correct ids resolved) and a WRONG selection (null), plus
 * the `applicableConstraints` gate and the `solveSketchToTolerance` re-solve
 * coupling. Purity (input never mutated) + deterministic ids are pinned too.
 */

import { describe, expect, it } from 'vitest'
import {
  addConstraintFromSelection,
  applicableConstraints,
  constraintKindHint,
  constraintKindLabel,
  solveSketchToTolerance,
  TOOLBAR_CONSTRAINT_KINDS,
  type ConstraintKind
} from '../sketch-constraint-apply'
import { emptyDesign, type DesignFileV2, type SketchConstraint } from '../../../shared/design-schema'

/**
 * A design with two open polylines (each a 2-vertex line), two circles, one arc,
 * and one rect — enough to satisfy every toolbar kind under the right selection.
 */
function fixture(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      // line 1 (horizontal-ish)
      l1a: { x: 0, y: 0 },
      l1b: { x: 10, y: 1 },
      // line 2 (vertical-ish)
      l2a: { x: 20, y: 0 },
      l2b: { x: 21, y: 12 },
      // arc points
      arS: { x: 30, y: 0 },
      arV: { x: 33, y: 3 },
      arE: { x: 36, y: 0 }
    },
    entities: [
      { id: 'line1', kind: 'polyline', pointIds: ['l1a', 'l1b'], closed: false },
      { id: 'line2', kind: 'polyline', pointIds: ['l2a', 'l2b'], closed: false },
      { id: 'circ1', kind: 'circle', cx: 50, cy: 0, r: 5 },
      { id: 'circ2', kind: 'circle', cx: 60, cy: 0, r: 8 },
      { id: 'arc1', kind: 'arc', startId: 'arS', viaId: 'arV', endId: 'arE' },
      { id: 'rect1', kind: 'rect', cx: 70, cy: 0, w: 10, h: 6, rotation: 0 }
    ]
  }
}

const sel = (...ids: string[]): Set<string> => new Set(ids)

function lastConstraint(d: DesignFileV2): SketchConstraint {
  return d.constraints[d.constraints.length - 1]!
}

describe('applicableConstraints', () => {
  it('two lines → parallel/perpendicular/equal (and coincident on their vertices)', () => {
    const d = fixture()
    const kinds = applicableConstraints(d, sel('line1', 'line2'))
    expect(kinds).toContain('parallel')
    expect(kinds).toContain('perpendicular')
    expect(kinds).toContain('equal')
    expect(kinds).toContain('coincident')
    expect(kinds).not.toContain('concentric')
    expect(kinds).not.toContain('horizontal')
  })

  it('one line → horizontal/vertical only (no two-line kinds)', () => {
    const d = fixture()
    const kinds = applicableConstraints(d, sel('line1'))
    expect(kinds).toEqual(expect.arrayContaining(['horizontal', 'vertical']))
    expect(kinds).not.toContain('parallel')
    expect(kinds).not.toContain('perpendicular')
    expect(kinds).not.toContain('concentric')
  })

  it('two circles → concentric (and coincident? no — circles have no vertices)', () => {
    const d = fixture()
    const kinds = applicableConstraints(d, sel('circ1', 'circ2'))
    expect(kinds).toContain('concentric')
    expect(kinds).not.toContain('parallel')
    expect(kinds).not.toContain('coincident')
  })

  it('one line + one arc → tangent + parallel (the arc chord is line-like)', () => {
    const d = fixture()
    const kinds = applicableConstraints(d, sel('line1', 'arc1'))
    expect(kinds).toContain('tangent')
    expect(kinds).toContain('parallel')
    // an arc + line are both point-bearing, so coincident is offered too.
    expect(kinds).toContain('coincident')
  })

  it('a rect is not line-like and not circular → no kinds from a single rect', () => {
    const d = fixture()
    expect(applicableConstraints(d, sel('rect1'))).toEqual([])
    // rect + line: only one line-like, so no two-line kind, no concentric.
    expect(applicableConstraints(d, sel('rect1', 'line1'))).toEqual([])
  })

  it('empty / stale selection → no kinds', () => {
    const d = fixture()
    expect(applicableConstraints(d, sel())).toEqual([])
    expect(applicableConstraints(d, sel('does-not-exist'))).toEqual([])
  })

  it('results are returned in TOOLBAR order', () => {
    const d = fixture()
    const kinds = applicableConstraints(d, sel('line1', 'line2'))
    const order = TOOLBAR_CONSTRAINT_KINDS.filter((k) => kinds.includes(k))
    expect(kinds).toEqual(order)
  })
})

describe('addConstraintFromSelection — each kind: right selection adds the constraint', () => {
  it('parallel: two lines → parallel{a1,b1,a2,b2} on the first segments', () => {
    const d = fixture()
    const out = addConstraintFromSelection(d, sel('line1', 'line2'), 'parallel')
    expect(out).not.toBeNull()
    const c = lastConstraint(out!)
    expect(c).toMatchObject({
      type: 'parallel',
      a1: { pointId: 'l1a' },
      b1: { pointId: 'l1b' },
      a2: { pointId: 'l2a' },
      b2: { pointId: 'l2b' }
    })
  })

  it('perpendicular: two lines → perpendicular with the same ids', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1', 'line2'), 'perpendicular')!)
    expect(c.type).toBe('perpendicular')
  })

  it('equal: two lines → equal', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1', 'line2'), 'equal')!)
    expect(c.type).toBe('equal')
  })

  it('tangent: line + arc → tangent referencing the arc 3 points + the line', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1', 'arc1'), 'tangent')!)
    expect(c).toMatchObject({
      type: 'tangent',
      lineA: { pointId: 'l1a' },
      lineB: { pointId: 'l1b' },
      arcStart: { pointId: 'arS' },
      arcVia: { pointId: 'arV' },
      arcEnd: { pointId: 'arE' },
      arcTangentAt: 'end',
      lineTangentAt: 'b'
    })
  })

  it('coincident: two lines → coincident binds their FIRST vertices', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1', 'line2'), 'coincident')!)
    expect(c).toMatchObject({ type: 'coincident', a: { pointId: 'l1a' }, b: { pointId: 'l2a' } })
  })

  it('horizontal: one line → horizontal on its first segment', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1'), 'horizontal')!)
    expect(c).toMatchObject({ type: 'horizontal', a: { pointId: 'l1a' }, b: { pointId: 'l1b' } })
  })

  it('vertical: one line → vertical on its first segment', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1'), 'vertical')!)
    expect(c).toMatchObject({ type: 'vertical', a: { pointId: 'l1a' }, b: { pointId: 'l1b' } })
  })

  it('concentric: two circles → concentric on the entity ids', () => {
    const d = fixture()
    const c = lastConstraint(addConstraintFromSelection(d, sel('circ1', 'circ2'), 'concentric')!)
    expect(c).toMatchObject({ type: 'concentric', entityAId: 'circ1', entityBId: 'circ2' })
  })

  it('gives the new constraint a collision-free con_<n> id', () => {
    const d = fixture()
    d.constraints = [{ id: 'con_1', type: 'horizontal', a: { pointId: 'l1a' }, b: { pointId: 'l1b' } }]
    const c = lastConstraint(addConstraintFromSelection(d, sel('line1', 'line2'), 'parallel')!)
    expect(c.id).toBe('con_2')
  })

  it('is PURE — the input design is never mutated', () => {
    const d = fixture()
    const before = JSON.stringify(d)
    addConstraintFromSelection(d, sel('line1', 'line2'), 'parallel')
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe('addConstraintFromSelection — wrong selection → null', () => {
  const cases: ReadonlyArray<{ kind: ConstraintKind; sel: Set<string>; why: string }> = [
    { kind: 'parallel', sel: sel('line1'), why: 'needs two lines' },
    { kind: 'perpendicular', sel: sel('circ1', 'circ2'), why: 'circles are not lines' },
    { kind: 'equal', sel: sel('line1', 'rect1'), why: 'rect is not line-like' },
    { kind: 'tangent', sel: sel('line1', 'line2'), why: 'needs an arc' },
    { kind: 'tangent', sel: sel('circ1', 'arc1'), why: 'circle is not a line' },
    { kind: 'coincident', sel: sel('line1'), why: 'needs two point-bearing entities' },
    { kind: 'coincident', sel: sel('circ1', 'circ2'), why: 'circles expose no vertices' },
    { kind: 'horizontal', sel: sel('circ1'), why: 'circle is not a line' },
    { kind: 'vertical', sel: sel('rect1'), why: 'rect is not a line' },
    { kind: 'concentric', sel: sel('circ1', 'line1'), why: 'line is not circular' },
    { kind: 'concentric', sel: sel('circ1'), why: 'needs two circles' }
  ]
  for (const { kind, sel: s, why } of cases) {
    it(`${kind} rejects (${why})`, () => {
      expect(addConstraintFromSelection(fixture(), s, kind)).toBeNull()
    })
  }

  it('an empty selection rejects every kind', () => {
    const d = fixture()
    for (const kind of TOOLBAR_CONSTRAINT_KINDS) {
      expect(addConstraintFromSelection(d, sel(), kind)).toBeNull()
    }
  })
})

describe('solveSketchToTolerance (engine re-export) + addConstraintFromSelection coupling', () => {
  it('drives a freshly-added horizontal constraint onto the axis (exact landing)', () => {
    const d = fixture()
    // line1 is slightly off-horizontal (l1b.y = 1). Add horizontal + re-solve.
    const withC = addConstraintFromSelection(d, sel('line1'), 'horizontal')!
    const solved = solveSketchToTolerance(withC)
    const a = solved.points['l1a']!
    const b = solved.points['l1b']!
    // The two endpoints' y values should converge to (near) equal — and tighter
    // than a single solveSketch pass (the converge-to-tolerance loop lands ON it).
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-3)
  })

  it('the constraint-add clone keeps the ORIGINAL design pristine across the re-solve', () => {
    // The surface relies on this: applyDesignEdit pushes the original design as
    // the undo pre-state, so the in-place solve must NOT reach back into it.
    const d = fixture()
    const before = JSON.stringify(d)
    const withC = addConstraintFromSelection(d, sel('line1'), 'horizontal')!
    solveSketchToTolerance(withC) // engine solver mutates `withC` in place
    expect(JSON.stringify(d)).toBe(before) // original untouched (deep clone)
  })

  it('returns the design unchanged when there are no constraints (mirrors solveSketch)', () => {
    const d: DesignFileV2 = { ...emptyDesign() }
    expect(solveSketchToTolerance(d)).toBe(d)
  })
})

describe('labels + hints', () => {
  it('every toolbar kind has a non-empty label and hint', () => {
    for (const kind of TOOLBAR_CONSTRAINT_KINDS) {
      expect(constraintKindLabel(kind).length).toBeGreaterThan(0)
      expect(constraintKindHint(kind).length).toBeGreaterThan(0)
    }
  })
})
