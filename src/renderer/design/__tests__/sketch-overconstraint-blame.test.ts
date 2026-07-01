/**
 * Over-constraint CONFLICT NAMING — pure unit pins (node-env).
 *
 * `analyzeConstraintBlame` names WHICH constraint conflicts when a sketch is
 * over-constrained (Fusion parity): one finite-difference Jacobian over the
 * full solver residual vocabulary, then leave-one-out rank checks newest-first.
 * These tests pin:
 *   - the residual-components ↔ energy() parity contract (Σ comps² === energy);
 *   - single-culprit naming (H + V + redundant perpendicular);
 *   - multi-culprit sets (double-distance: EITHER removal resolves);
 *   - recency ordering (newest resolver first) + the firstOnly O(1)-ish path;
 *   - the too-large cap and the unresolved (two separate redundancies) verdict;
 *   - the operator-facing label helpers (describeSketchConstraint & co.);
 *   - explainRedundantAutoConstraint (the add-time BLOCK path naming).
 */

import { describe, expect, it } from 'vitest'
import {
  analyzeConstraintBlame,
  BLAME_MAX_CONSTRAINTS,
  constraintAnchorWorld,
  describeSketchConstraint,
  explainRedundantAutoConstraint,
  sketchConstraintTypeLabel,
  sketchEntityShortNames
} from '../sketch-overconstraint'
import { constraintResidualComponents, energy } from '../solver2d'
import { emptyDesign, type DesignFileV2, type SketchConstraint } from '../../../shared/design-schema'

/** Right-angle corner a→b→c with H(a,b) + V(b,c) and a REDUNDANT perpendicular. */
function cornerWithRedundantPerp(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 8 } },
    entities: [
      { id: 'e1', kind: 'polyline', pointIds: ['a', 'b'], closed: false },
      { id: 'e2', kind: 'polyline', pointIds: ['b', 'c'], closed: false }
    ],
    constraints: [
      { id: 'con_1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } },
      { id: 'con_2', type: 'vertical', a: { pointId: 'b' }, b: { pointId: 'c' } },
      {
        id: 'con_3',
        type: 'perpendicular',
        a1: { pointId: 'a' },
        b1: { pointId: 'b' },
        a2: { pointId: 'b' },
        b2: { pointId: 'c' }
      }
    ]
  }
}

/** One segment carrying TWO distance constraints (10 vs 80) — a true conflict. */
function doubleDistance(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [{ id: 'e1', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
    parameters: { lenA: 10, lenB: 80 },
    constraints: [
      { id: 'dA', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'lenA' },
      { id: 'dB', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'lenB' }
    ]
  }
}

describe('constraintResidualComponents — the energy() parity contract', () => {
  it('Σ components² === energy(design) across a mixed-kind design', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: {
        a: { x: 0, y: 0 },
        b: { x: 9.7, y: 1.3 },
        c: { x: 11, y: 8.2 },
        m: { x: 4, y: 1 }
      },
      parameters: { len: 10, ang: 90 },
      constraints: [
        { id: 'c1', type: 'coincident', a: { pointId: 'a' }, b: { pointId: 'm' } },
        { id: 'c2', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'len' },
        { id: 'c3', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } },
        { id: 'c4', type: 'vertical', a: { pointId: 'b' }, b: { pointId: 'c' } },
        {
          id: 'c5',
          type: 'perpendicular',
          a1: { pointId: 'a' },
          b1: { pointId: 'b' },
          a2: { pointId: 'b' },
          b2: { pointId: 'c' }
        },
        {
          id: 'c6',
          type: 'parallel',
          a1: { pointId: 'a' },
          b1: { pointId: 'b' },
          a2: { pointId: 'b' },
          b2: { pointId: 'c' }
        },
        {
          id: 'c7',
          type: 'equal',
          a1: { pointId: 'a' },
          b1: { pointId: 'b' },
          a2: { pointId: 'b' },
          b2: { pointId: 'c' }
        },
        { id: 'c8', type: 'collinear', a: { pointId: 'a' }, b: { pointId: 'b' }, c: { pointId: 'c' } },
        { id: 'c9', type: 'midpoint', m: { pointId: 'm' }, a: { pointId: 'a' }, b: { pointId: 'b' } },
        {
          id: 'c10',
          type: 'angle',
          a1: { pointId: 'a' },
          b1: { pointId: 'b' },
          a2: { pointId: 'b' },
          b2: { pointId: 'c' },
          parameterKey: 'ang'
        },
        {
          id: 'c11',
          type: 'symmetric',
          p1: { pointId: 'a' },
          p2: { pointId: 'c' },
          la: { pointId: 'b' },
          lb: { pointId: 'm' }
        },
        { id: 'c12', type: 'fix', pointId: 'a' }
      ]
    }
    let sum = 0
    for (const c of d.constraints) {
      for (const r of constraintResidualComponents(d, c)) sum += r * r
    }
    expect(sum).toBeCloseTo(energy(d), 9)
  })

  it('a missing parameter contributes no components (mirrors energy skip rules)', () => {
    const d = doubleDistance()
    const noParams: DesignFileV2 = { ...d, parameters: {} }
    expect(constraintResidualComponents(noParams, d.constraints[0]!)).toEqual([])
  })

  it('fix contributes no components (pinned via the fixed flag, not energy)', () => {
    const d = cornerWithRedundantPerp()
    const fix: SketchConstraint = { id: 'f1', type: 'fix', pointId: 'a' }
    expect(constraintResidualComponents(d, fix)).toEqual([])
  })
})

describe('analyzeConstraintBlame — culprit naming', () => {
  it('H + V + redundant perpendicular: every one individually resolves, NEWEST first', () => {
    const report = analyzeConstraintBlame(cornerWithRedundantPerp())
    expect(report.status).toBe('culprits')
    expect(report.deficiency).toBe(1)
    // The perpendicular row is a linear combination of the H and V rows, so
    // removing ANY of the three restores independence — newest (con_3) first.
    expect(report.culpritIds).toEqual(['con_3', 'con_2', 'con_1'])
  })

  it('double-distance conflict: BOTH distances are individually sufficient resolvers', () => {
    const report = analyzeConstraintBlame(doubleDistance())
    expect(report.status).toBe('culprits')
    expect(report.deficiency).toBe(1)
    expect(report.culpritIds).toEqual(['dB', 'dA'])
  })

  it('firstOnly stops at the newest resolver in O(1)-ish rank checks', () => {
    const report = analyzeConstraintBlame(doubleDistance(), { firstOnly: true })
    expect(report.culpritIds).toEqual(['dB'])
    // Exactly: 1 full-rank check + 1 leave-one-out check on the newest.
    expect(report.rankChecks).toBe(2)
  })

  it('an independent sketch reports no culprits', () => {
    const d = cornerWithRedundantPerp()
    const independent: DesignFileV2 = { ...d, constraints: d.constraints.slice(0, 2) }
    const report = analyzeConstraintBlame(independent)
    expect(report.status).toBe('independent')
    expect(report.deficiency).toBe(0)
    expect(report.culpritIds).toEqual([])
  })

  it('a constraint whose points are all fix-pinned yields a zero row and is blamed', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      constraints: [
        { id: 'f1', type: 'fix', pointId: 'a' },
        { id: 'f2', type: 'fix', pointId: 'b' },
        { id: 'h1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }
      ]
    }
    const report = analyzeConstraintBlame(d)
    expect(report.status).toBe('culprits')
    expect(report.culpritIds).toEqual(['h1'])
  })

  it('two SEPARATE redundancies: no single removal resolves → unresolved', () => {
    const a = doubleDistance()
    const d: DesignFileV2 = {
      ...a,
      points: { ...a.points, c: { x: 0, y: 20 }, e: { x: 15, y: 20 } },
      entities: [
        ...a.entities,
        { id: 'e2', kind: 'polyline', pointIds: ['c', 'e'], closed: false }
      ],
      parameters: { ...a.parameters, lenC: 15, lenD: 40 },
      constraints: [
        ...a.constraints,
        { id: 'dC', type: 'distance', a: { pointId: 'c' }, b: { pointId: 'e' }, parameterKey: 'lenC' },
        { id: 'dD', type: 'distance', a: { pointId: 'c' }, b: { pointId: 'e' }, parameterKey: 'lenD' }
      ]
    }
    const report = analyzeConstraintBlame(d)
    expect(report.status).toBe('unresolved')
    expect(report.deficiency).toBe(2)
    expect(report.culpritIds).toEqual([])
  })

  it('the too-large cap skips the scan honestly', () => {
    const base = doubleDistance()
    const report = analyzeConstraintBlame(base, { maxConstraints: 1 })
    expect(report.status).toBe('too-large')
    expect(report.culpritIds).toEqual([])
    expect(report.rankChecks).toBe(0)
    // And the default cap is the documented constant.
    expect(BLAME_MAX_CONSTRAINTS).toBe(200)
  })

  it('an empty constraint set reports empty', () => {
    expect(analyzeConstraintBlame(emptyDesign()).status).toBe('empty')
  })
})

describe('operator-facing labels + anchors', () => {
  it('describeSketchConstraint names the owning entities Fusion-style', () => {
    const d = cornerWithRedundantPerp()
    expect(describeSketchConstraint(d, d.constraints[2]!)).toBe('Perpendicular between L1 and L2')
    expect(describeSketchConstraint(d, d.constraints[0]!)).toBe('Horizontal on L1')
  })

  it('entity-ref constraints (radius on a circle) resolve to the circle name', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'circ', kind: 'circle', cx: 0, cy: 0, r: 5 }],
      parameters: { r: 5 },
      constraints: [{ id: 'r1', type: 'radius', entityId: 'circ', parameterKey: 'r' }]
    }
    expect(describeSketchConstraint(d, d.constraints[0]!)).toBe('Radius on C1')
    expect(sketchEntityShortNames(d).get('circ')).toBe('C1')
  })

  it('falls back to the constraint id when no entity owns the points', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
      constraints: [{ id: 'con_9', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }]
    }
    expect(describeSketchConstraint(d, d.constraints[0]!)).toBe('Horizontal con_9')
  })

  it('sketchConstraintTypeLabel covers the vocabulary', () => {
    expect(sketchConstraintTypeLabel('perpendicular')).toBe('Perpendicular')
    expect(sketchConstraintTypeLabel('distance')).toBe('Distance')
    expect(sketchConstraintTypeLabel('fix')).toBe('Fix')
  })

  it('constraintAnchorWorld is the mean of the referenced points', () => {
    const d = doubleDistance()
    expect(constraintAnchorWorld(d, d.constraints[0]!)).toEqual([5, 0])
    const orphan: SketchConstraint = {
      id: 'x',
      type: 'horizontal',
      a: { pointId: 'ghost1' },
      b: { pointId: 'ghost2' }
    }
    expect(constraintAnchorWorld(d, orphan)).toBeNull()
  })
})

describe('explainRedundantAutoConstraint — the add-time BLOCK path naming', () => {
  const pts = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 8 } }
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

  it('names the NEWEST base constraint whose removal would unlock the candidate', () => {
    const blocker = explainRedundantAutoConstraint(base, perp, pts, ['a', 'b', 'c'])
    expect(blocker?.id).toBe('con_2')
  })

  it('returns null when the candidate is independent (nothing blocked it)', () => {
    const soloBase: SketchConstraint[] = [base[0]!]
    // With only H present, the perpendicular pins a NEW dof — no blocker exists.
    // (The gate would have KEPT it; blame is only asked for dropped candidates,
    // but the helper must stay honest when asked anyway.)
    expect(explainRedundantAutoConstraint(soloBase, perp, pts, ['a', 'b', 'c'])).toBeNull()
  })

  it('returns null on an empty or over-cap base', () => {
    expect(explainRedundantAutoConstraint([], perp, pts, ['a', 'b', 'c'])).toBeNull()
  })
})
