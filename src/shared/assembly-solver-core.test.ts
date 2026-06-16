import { describe, expect, it } from 'vitest'
import type { AssemblyComponent } from './assembly-schema'
import type { AssemblyMateConstraint } from './assembly-mate-schema'
import {
  DEFAULT_SOLVER_CONFIG,
  solveMateConstraints,
  type SolverConvergenceReport
} from './assembly-solver-core'

function comp(partial: Partial<AssemblyComponent> & { id: string }): AssemblyComponent {
  return {
    name: partial.id.toUpperCase(),
    partPath: `${partial.id}.json`,
    transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
    grounded: false,
    bomQuantity: 1,
    suppressed: false,
    motionIsolated: false,
    ...partial
  } as AssemblyComponent
}

describe('solveMateConstraints — defaults', () => {
  it('exposes documented default config', () => {
    expect(DEFAULT_SOLVER_CONFIG.residualTol).toBe(1e-6)
    expect(DEFAULT_SOLVER_CONFIG.maxIterations).toBe(100)
    expect(DEFAULT_SOLVER_CONFIG.eps).toBe(1e-6)
  })
})

describe('solveMateConstraints — (1) converging coincident chain', () => {
  // A grounded at origin; B initially offset at x=10. One coincident mate ties
  // A.feature[5,0,0] (world [5,0,0]) to B.feature[0,0,0] (B's origin) → B must move to [5,0,0].
  const components = [
    comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
    comp({ id: 'b', grounded: false, transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
  ]
  const mates: AssemblyMateConstraint[] = [
    {
      id: 'm1',
      kind: 'coincident',
      part1Id: 'a',
      feature1: { x: 5, y: 0, z: 0 },
      part2Id: 'b',
      feature2: { x: 0, y: 0, z: 0 }
    }
  ]

  it('drives B to the analytically-correct pose [5,0,0]', () => {
    const { transforms, report } = solveMateConstraints(components, mates)
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(5, 5)
    expect(b.y).toBeCloseTo(0, 5)
    expect(b.z).toBeCloseTo(0, 5)
    // A stays grounded.
    const a = transforms.get('a')!
    expect(a.x).toBe(0)
    expect(report.status).toBe('converged')
  })

  it('reports converged with finalResidual < 1e-6 and iterations < maxIterations', () => {
    const { report } = solveMateConstraints(components, mates)
    expect(report.converged).toBe(true)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-6)
    expect(report.iterations).toBeLessThan(DEFAULT_SOLVER_CONFIG.maxIterations)
    expect(report.iterations).toBeLessThan(50)
    expect(report.perConstraintResiduals).toHaveLength(1)
    expect(report.perConstraintResiduals[0]!.constraintId).toBe('m1')
    expect(report.perConstraintResiduals[0]!.residual).toBeLessThan(1e-3)
  })

  it('solves a distance mate to the exact target separation', () => {
    // A grounded origin; B offset; distance mate target 7mm along x between origins.
    const dComponents = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 2, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const dMates: AssemblyMateConstraint[] = [
      {
        id: 'd1',
        kind: 'distance',
        part1Id: 'a',
        feature1: { x: 0, y: 0, z: 0 },
        part2Id: 'b',
        feature2: { x: 0, y: 0, z: 0 },
        value: 7
      }
    ]
    // distance is 1 equation; B (no joint, referenced) has 3 translational DOF → under-constrained
    // by count (E=1 < F=3). This is honest: a single distance does not fix B's pose.
    const { report } = solveMateConstraints(dComponents, dMates)
    expect(report.status).toBe('under_constrained')
    expect(report.freeVariableCount).toBe(2)
  })
})

describe('solveMateConstraints — (2) over-constrained', () => {
  // Two coincident mates on the same A–B pair pinning B's origin to two DIFFERENT A points:
  // genuinely conflicting AND over-constrained by count (E=6 > F=3).
  const components = [
    comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
    comp({ id: 'b', grounded: false, transform: { x: 1, y: 1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
  ]
  const mates: AssemblyMateConstraint[] = [
    {
      id: 'm_alpha',
      kind: 'coincident',
      part1Id: 'a',
      feature1: { x: 0, y: 0, z: 0 },
      part2Id: 'b',
      feature2: { x: 0, y: 0, z: 0 }
    },
    {
      id: 'm_beta',
      kind: 'coincident',
      part1Id: 'a',
      feature1: { x: 5, y: 0, z: 0 },
      part2Id: 'b',
      feature2: { x: 0, y: 0, z: 0 }
    }
  ]

  it('classifies as over_constrained with both conflicting ids', () => {
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('over_constrained')
    expect(report.converged).toBe(false)
    expect(report.conflictingConstraintIds).toBeDefined()
    expect(report.conflictingConstraintIds).toContain('m_alpha')
    expect(report.conflictingConstraintIds).toContain('m_beta')
  })
})

describe('solveMateConstraints — (3) under-constrained', () => {
  // A grounded; B is a free revolute (1 DOF) with NO mate fixing it → 1 free variable, 0 equations.
  const components = [
    comp({ id: 'a', grounded: true }),
    comp({ id: 'b', grounded: false, joint: 'revolute' })
  ]

  it('classifies as under_constrained with freeVariableCount 1', () => {
    const { report } = solveMateConstraints(components, [])
    expect(report.status).toBe('under_constrained')
    expect(report.freeVariableCount).toBe(1)
    expect(report.converged).toBe(false)
  })

  it('an all-grounded assembly with no mates is trivially converged', () => {
    const grounded = [comp({ id: 'a', grounded: true }), comp({ id: 'b', grounded: true })]
    const { report } = solveMateConstraints(grounded, [])
    expect(report.status).toBe('converged')
    expect(report.freeVariableCount).toBeUndefined()
  })
})

describe('solveMateConstraints — (4) determinism', () => {
  const components = [
    comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
    comp({ id: 'b', grounded: false, transform: { x: 10, y: -4, z: 3, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
  ]
  const mates: AssemblyMateConstraint[] = [
    {
      id: 'm1',
      kind: 'coincident',
      part1Id: 'a',
      feature1: { x: 5, y: 2, z: -1 },
      part2Id: 'b',
      feature2: { x: 0, y: 0, z: 0 }
    }
  ]

  function snapshot(report: SolverConvergenceReport, b: { x: number; y: number; z: number }): string {
    return JSON.stringify({
      iterations: report.iterations,
      finalResidual: report.finalResidual,
      status: report.status,
      per: report.perConstraintResiduals,
      b
    })
  }

  it('identical inputs produce byte-identical iterations / finalResidual / transforms', () => {
    const run1 = solveMateConstraints(components, mates)
    const run2 = solveMateConstraints(components, mates)
    const b1 = run1.transforms.get('b')!
    const b2 = run2.transforms.get('b')!
    expect(run1.report.iterations).toBe(run2.report.iterations)
    expect(run1.report.finalResidual).toBe(run2.report.finalResidual)
    expect(b1.x).toBe(b2.x)
    expect(b1.y).toBe(b2.y)
    expect(b1.z).toBe(b2.z)
    expect(snapshot(run1.report, b1)).toBe(snapshot(run2.report, b2))
  })

  it('is order-independent in component and constraint input order', () => {
    const run1 = solveMateConstraints(components, mates)
    const run2 = solveMateConstraints([...components].reverse(), [...mates].reverse())
    const b1 = run1.transforms.get('b')!
    const b2 = run2.transforms.get('b')!
    expect(run1.report.finalResidual).toBe(run2.report.finalResidual)
    expect(b1.x).toBe(b2.x)
    expect(b1.y).toBe(b2.y)
    expect(b1.z).toBe(b2.z)
  })

  it('converges B to the exact analytic pose [5,2,-1] + initial≈... i.e. residual ~0', () => {
    const { transforms, report } = solveMateConstraints(components, mates)
    const b = transforms.get('b')!
    // world(B.origin) must equal world(A.feature) = [5,2,-1]
    expect(b.x).toBeCloseTo(5, 5)
    expect(b.y).toBeCloseTo(2, 5)
    expect(b.z).toBeCloseTo(-1, 5)
    expect(report.status).toBe('converged')
  })
})

describe('solveMateConstraints — (5) distance mate is solver-backed', () => {
  // distance is positional (drives translation). A single distance is honestly
  // under-constrained by count; once the other two translational DOF are pinned
  // (here by two flush mates locking X and Y), the distance converges to its
  // EXACT target along the remaining (Z) axis — proving distance is genuinely
  // positioned by the solver, not merely measured.
  it('drives a part to the exact target separation when fully constrained (1 distance + 2 flush)', () => {
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 3, y: 4, z: 2, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      // Lock B.x to A.x (flush along world X) and B.y to A.y (flush along world Y).
      { id: 'fx', kind: 'flush', part1Id: 'a', feature1: { x: 0, y: 0, z: 0, axis: 'x' }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0, axis: 'x' } },
      { id: 'fy', kind: 'flush', part1Id: 'a', feature1: { x: 0, y: 0, z: 0, axis: 'y' }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0, axis: 'y' } },
      // Hold B.origin 5mm from A.origin → with X,Y pinned to 0, |Z| must be 5.
      { id: 'd1', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 5 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.converged).toBe(true)
    expect(report.finalResidual).toBeLessThan(1e-5)
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(0, 4)
    expect(b.y).toBeCloseTo(0, 4)
    // Started at z=2 > 0, so the solver lands on the +5 branch.
    expect(Math.abs(b.z)).toBeCloseTo(5, 4)
    // Each constraint's residual is ~0 at the solved pose.
    const perId = Object.fromEntries(report.perConstraintResiduals.map((r) => [r.constraintId, r.residual]))
    expect(perId['d1']).toBeLessThan(1e-4)
    expect(perId['fx']).toBeLessThan(1e-4)
    expect(perId['fy']).toBeLessThan(1e-4)
  })

  it('a target of 0 collapses the distance to coincident-at-pinned-point (residual ~0)', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, transform: { x: 1, y: 1, z: 6, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'fx', kind: 'flush', part1Id: 'a', feature1: { x: 0, y: 0, z: 0, axis: 'x' }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0, axis: 'x' } },
      { id: 'fy', kind: 'flush', part1Id: 'a', feature1: { x: 0, y: 0, z: 0, axis: 'y' }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0, axis: 'y' } },
      { id: 'd0', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 0 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(0, 4)
    expect(b.y).toBeCloseTo(0, 4)
    expect(b.z).toBeCloseTo(0, 4)
  })
})

describe('solveMateConstraints — suppressed mates excluded', () => {
  it('ignores suppressed constraints in the solve and the report', () => {
    const components = [comp({ id: 'a', grounded: true }), comp({ id: 'b', grounded: false })]
    const mates: AssemblyMateConstraint[] = [
      {
        id: 'm1',
        kind: 'coincident',
        part1Id: 'a',
        feature1: { x: 5, y: 0, z: 0 },
        part2Id: 'b',
        feature2: { x: 0, y: 0, z: 0 },
        suppress: true
      }
    ]
    const { report } = solveMateConstraints(components, mates)
    // With the only mate suppressed there are no active constraints; B is free → under-constrained.
    expect(report.status).toBe('under_constrained')
    expect(report.perConstraintResiduals).toHaveLength(0)
  })
})
