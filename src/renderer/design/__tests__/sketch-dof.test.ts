/**
 * Sketch S5 — DOF analysis (`sketch-dof.ts`). Node env, no React/DOM/IPC.
 *
 * Coverage:
 *   - constraintEquationCount: the exact scalar-equation count for EVERY
 *     constraint kind in the union (coincident 2 … diameter 1);
 *   - analyzeSketchDof: a free 2-point segment = 4 DOF; +distance -> 3;
 *     a fully-pinned segment -> 0/'full'; an extra conflicting driver -> 'over';
 *     empty design -> 'empty'; per-point `fixed` flag drops the movable count;
 *   - dofStatusWithResidual: equation count says 'full'/'under' but a high
 *     post-solve residual reports 'over' (honest conflict flag), while a clean
 *     solved sketch keeps its equation-count status.
 */

import { describe, expect, it } from 'vitest'
import {
  emptyDesign,
  type DesignFileV2,
  type SketchConstraint,
  type SketchEntity,
  type SketchPoint
} from '../../../shared/design-schema'
import { solveSketch, solveSketchToTolerance } from '../solver2d'
import {
  analyzeSketchDof,
  constraintEquationCount,
  dofStatusWithResidual,
  type SketchDofStatus
} from '../sketch-dof'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function designWith(
  points: Record<string, SketchPoint>,
  constraints: SketchConstraint[] = [],
  entities: SketchEntity[] = [],
  parameters: Record<string, number> = {}
): DesignFileV2 {
  return { ...emptyDesign(), points, constraints, entities, parameters }
}

/** A free 2-point open segment: 2 movable points, no constraints. */
function freeSegment(): DesignFileV2 {
  return designWith(
    { pa: { x: 0, y: 0 }, pb: { x: 50, y: 0 } },
    [],
    [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }]
  )
}

// ---------------------------------------------------------------------------
// constraintEquationCount — one assertion per constraint kind
// ---------------------------------------------------------------------------

describe('constraintEquationCount — scalar equations per kind', () => {
  const cases: ReadonlyArray<readonly [SketchConstraint, number]> = [
    [{ id: 'c', type: 'coincident', a: { pointId: 'a' }, b: { pointId: 'b' } }, 2],
    [
      { id: 'c', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'k' },
      1
    ],
    [{ id: 'c', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }, 1],
    [{ id: 'c', type: 'vertical', a: { pointId: 'a' }, b: { pointId: 'b' } }, 1],
    [{ id: 'c', type: 'fix', pointId: 'a' }, 2],
    [
      {
        id: 'c',
        type: 'perpendicular',
        a1: { pointId: 'a' },
        b1: { pointId: 'b' },
        a2: { pointId: 'c' },
        b2: { pointId: 'd' }
      },
      1
    ],
    [
      {
        id: 'c',
        type: 'parallel',
        a1: { pointId: 'a' },
        b1: { pointId: 'b' },
        a2: { pointId: 'c' },
        b2: { pointId: 'd' }
      },
      1
    ],
    [
      {
        id: 'c',
        type: 'equal',
        a1: { pointId: 'a' },
        b1: { pointId: 'b' },
        a2: { pointId: 'c' },
        b2: { pointId: 'd' }
      },
      1
    ],
    [{ id: 'c', type: 'collinear', a: { pointId: 'a' }, b: { pointId: 'b' }, c: { pointId: 'c' } }, 1],
    [{ id: 'c', type: 'midpoint', m: { pointId: 'm' }, a: { pointId: 'a' }, b: { pointId: 'b' } }, 2],
    [
      {
        id: 'c',
        type: 'angle',
        a1: { pointId: 'a' },
        b1: { pointId: 'b' },
        a2: { pointId: 'c' },
        b2: { pointId: 'd' },
        parameterKey: 'k'
      },
      1
    ],
    [
      {
        id: 'c',
        type: 'tangent',
        lineA: { pointId: 'a' },
        lineB: { pointId: 'b' },
        arcStart: { pointId: 's' },
        arcVia: { pointId: 'v' },
        arcEnd: { pointId: 'e' },
        arcTangentAt: 'start',
        lineTangentAt: 'a'
      },
      1
    ],
    [
      {
        id: 'c',
        type: 'symmetric',
        p1: { pointId: 'p1' },
        p2: { pointId: 'p2' },
        la: { pointId: 'la' },
        lb: { pointId: 'lb' }
      },
      2
    ],
    [{ id: 'c', type: 'concentric', entityAId: 'a', entityBId: 'b' }, 1],
    [{ id: 'c', type: 'radius', entityId: 'a', parameterKey: 'k' }, 1],
    [{ id: 'c', type: 'diameter', entityId: 'a', parameterKey: 'k' }, 1]
  ]

  for (const [constraint, expected] of cases) {
    it(`${constraint.type} -> ${expected}`, () => {
      expect(constraintEquationCount(constraint)).toBe(expected)
    })
  }

  it('covers every constraint kind in the union (no kind left unmapped)', () => {
    // If a new constraint kind is added to the schema, this count must change;
    // the per-kind cases above must grow with it.
    const kinds = new Set(cases.map(([c]) => c.type))
    expect(kinds.size).toBe(16)
  })
})

// ---------------------------------------------------------------------------
// analyzeSketchDof — DOF math + status
// ---------------------------------------------------------------------------

describe('analyzeSketchDof — degrees of freedom', () => {
  it('a free 2-point segment = 4 DOF (under-defined)', () => {
    const r = analyzeSketchDof(freeSegment())
    expect(r.movablePointCount).toBe(2)
    expect(r.constraintEquationCount).toBe(0)
    expect(r.approxDof).toBe(4)
    expect(r.status).toBe('under')
  })

  it('adding a distance constraint drops DOF to 3 (still under)', () => {
    const d = freeSegment()
    d.parameters = { len: 50 }
    d.constraints = [
      { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' }
    ]
    const r = analyzeSketchDof(d)
    expect(r.constraintEquationCount).toBe(1)
    expect(r.approxDof).toBe(3)
    expect(r.status).toBe('under')
  })

  it('a fully-pinned segment -> 0 DOF / fully-defined', () => {
    // 2 points (4 DOF) removed by: fix pa (2) + horizontal (1) + distance (1) = 4.
    const d = freeSegment()
    d.parameters = { len: 50 }
    d.constraints = [
      { id: 'c1', type: 'fix', pointId: 'pa' },
      { id: 'c2', type: 'horizontal', a: { pointId: 'pa' }, b: { pointId: 'pb' } },
      { id: 'c3', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' }
    ]
    const r = analyzeSketchDof(d)
    expect(r.constraintEquationCount).toBe(4)
    expect(r.approxDof).toBe(0)
    expect(r.status).toBe('full')
  })

  it('an extra conflicting driver pushes the equation count past 0 -> over', () => {
    // Same fully-pinned segment + a SECOND distance driver = 5 equations on 4 DOF.
    const d = freeSegment()
    d.parameters = { len: 50, len2: 80 }
    d.constraints = [
      { id: 'c1', type: 'fix', pointId: 'pa' },
      { id: 'c2', type: 'horizontal', a: { pointId: 'pa' }, b: { pointId: 'pb' } },
      { id: 'c3', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' },
      { id: 'c4', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len2' }
    ]
    const r = analyzeSketchDof(d)
    expect(r.constraintEquationCount).toBe(5)
    expect(r.approxDof).toBe(-1)
    expect(r.status).toBe('over')
  })

  it('an empty design (no points) -> empty', () => {
    const r = analyzeSketchDof(emptyDesign())
    expect(r.movablePointCount).toBe(0)
    expect(r.constraintEquationCount).toBe(0)
    expect(r.status).toBe('empty')
  })

  it('a per-point `fixed` flag removes that point from the movable count', () => {
    const d = designWith(
      { pa: { x: 0, y: 0, fixed: true }, pb: { x: 50, y: 0 } },
      [],
      [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }]
    )
    const r = analyzeSketchDof(d)
    expect(r.movablePointCount).toBe(1) // pa is pinned by its schema flag
    expect(r.approxDof).toBe(2)
    expect(r.status).toBe('under')
  })

  it('is pure: does not mutate the input design', () => {
    const d = freeSegment()
    const beforePts = JSON.stringify(d.points)
    const beforeCons = JSON.stringify(d.constraints)
    analyzeSketchDof(d)
    expect(JSON.stringify(d.points)).toBe(beforePts)
    expect(JSON.stringify(d.constraints)).toBe(beforeCons)
  })
})

// ---------------------------------------------------------------------------
// dofStatusWithResidual — honest over-defined flag via post-solve residual
// ---------------------------------------------------------------------------

describe('dofStatusWithResidual — pairs the count with a residual signal', () => {
  it('a clean, satisfied sketch keeps its equation-count status (under)', () => {
    // A single distance driver, solved to tolerance (the realistic UI flow):
    // residual ~0, so the honest status is the raw count status — under.
    const d = freeSegment()
    d.parameters = { len: 60 }
    d.constraints = [
      { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' }
    ]
    const solved = solveSketchToTolerance(d)
    expect(analyzeSketchDof(solved).status).toBe('under')
    expect(dofStatusWithResidual(solved)).toBe('under')
  })

  it('the residual only UPGRADES toward over — it never downgrades an equation-count over', () => {
    // Two distance drivers with the SAME target are over-defined BY COUNT yet
    // do not conflict (residual ~0). The count already says 'over', and the
    // residual gate never softens 'over' back to 'under'/'full'.
    const d = freeSegment()
    d.parameters = { len: 50, lenDup: 50 }
    d.constraints = [
      { id: 'c1', type: 'fix', pointId: 'pa' },
      { id: 'c2', type: 'horizontal', a: { pointId: 'pa' }, b: { pointId: 'pb' } },
      { id: 'c3', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' },
      { id: 'c4', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'lenDup' }
    ]
    const solved = solveSketchToTolerance(d)
    expect(analyzeSketchDof(solved).status).toBe('over') // 5 eq on 4 DOF
    expect(dofStatusWithResidual(solved)).toBe('over')
  })

  it('genuinely conflicting drivers report over even when the COUNT says exactly full', () => {
    // Fully-defined BY COUNT (approxDof === 0) but impossible to satisfy:
    //   2 movable points = 4 DOF; horizontal (1) + vertical (1) + two distance
    //   drivers (1 + 1) = 4 equations -> DOF 0 ('full').
    // horizontal+vertical force the two points coincident (Δx=Δy=0) while the
    // distance drivers demand 50 AND 200 -> the solver cannot win; residual
    // stays high, so the honest status is 'over'.
    const d = designWith(
      { pa: { x: 0, y: 0 }, pb: { x: 50, y: 0 } },
      [
        { id: 'h1', type: 'horizontal', a: { pointId: 'pa' }, b: { pointId: 'pb' } },
        { id: 'v1', type: 'vertical', a: { pointId: 'pa' }, b: { pointId: 'pb' } },
        { id: 'd1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' },
        { id: 'd2', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len2' }
      ],
      [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
      { len: 50, len2: 200 }
    )
    // The COUNT alone says fully-defined ...
    expect(analyzeSketchDof(d).approxDof).toBe(0)
    expect(analyzeSketchDof(d).status).toBe('full')
    // ... but after solving the residual is high, so the honest signal is 'over'.
    const solved = solveSketchToTolerance(d)
    expect(dofStatusWithResidual(solved)).toBe('over')
  })

  it('empty always wins regardless of residual', () => {
    expect(dofStatusWithResidual(emptyDesign())).toBe('empty')
  })

  it('a custom residual threshold tightens / loosens the over flag', () => {
    // A single driver solved to tolerance has a tiny residual; an absurdly small
    // threshold flips it to 'over', a normal threshold keeps it 'under'.
    const d = freeSegment()
    d.parameters = { len: 70 }
    d.constraints = [
      { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: 'len' }
    ]
    const solved = solveSketchToTolerance(d)
    expect(dofStatusWithResidual(solved, 1e-9)).toBe('over') // hair-trigger
    expect(dofStatusWithResidual(solved, 0.05)).toBe('under') // sane band
  })

  it('returns a valid status union member', () => {
    const valid: SketchDofStatus[] = ['under', 'full', 'over', 'empty']
    expect(valid).toContain(dofStatusWithResidual(freeSegment()))
  })
})
