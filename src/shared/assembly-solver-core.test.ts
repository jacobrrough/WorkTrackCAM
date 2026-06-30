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

  it('the conflicting block only lists constraints still violated (non-zero residual) at the solved pose', () => {
    // The least-squares pose leaves BOTH coincident mates unsatisfied (their A targets are 5mm
    // apart), so each residual stays above the conflict floor and both ids are reported. The
    // reported set is exactly the still-violated set — not a blanket "all mates".
    const { report } = solveMateConstraints(components, mates)
    const violated = new Set(report.conflictingConstraintIds ?? [])
    expect(violated.size).toBe(2)
    // Every reported id maps to a per-constraint residual that is genuinely non-trivial.
    for (const r of report.perConstraintResiduals) {
      if (violated.has(r.constraintId)) expect(r.residual).toBeGreaterThan(1e-4)
    }
  })
})

describe('solveMateConstraints — (2b) over-DETERMINED but CONSISTENT (redundant, not conflicting)', () => {
  // E > F by count, but the surplus equations are redundant (mutually satisfiable), so a
  // least-squares solve drives the residual to ~0. This must classify as `converged`, NOT
  // `over_constrained` — the count alone never proves a conflict. (Prompt: report
  // over-constrained only when E>F WITH non-zero conflicting residuals.)
  it('two IDENTICAL coincident mates (E=6 > F=3) converge instead of flagging a conflict', () => {
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    // Both mates pin B.origin to the SAME world point [5,0,0]: 6 equations, but only 3 are
    // independent → redundant-consistent.
    const mate = (id: string): AssemblyMateConstraint => ({
      id,
      kind: 'coincident',
      part1Id: 'a',
      feature1: { x: 5, y: 0, z: 0 },
      part2Id: 'b',
      feature2: { x: 0, y: 0, z: 0 }
    })
    const { transforms, report } = solveMateConstraints(components, [mate('dup1'), mate('dup2')])
    expect(report.status).toBe('converged')
    expect(report.converged).toBe(true)
    expect(report.finalResidual).toBeLessThan(1e-5)
    // No conflict surfaced when the system is actually satisfiable.
    expect(report.conflictingConstraintIds).toBeUndefined()
    // And B still lands on the analytic pose.
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(5, 4)
    expect(b.y).toBeCloseTo(0, 4)
    expect(b.z).toBeCloseTo(0, 4)
  })

  it('a coincident (3 eq) + a redundant flush along Z (1 eq), E=4 > F=3, still converges', () => {
    // Coincident already pins all three of B's translational DOF to [5,0,0]; the extra flush
    // along Z is automatically satisfied at that pose → redundant, not conflicting.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, transform: { x: 9, y: -2, z: 4, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'co', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'fz', kind: 'flush', part1Id: 'a', feature1: { x: 0, y: 0, z: 0, axis: 'z' }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0, axis: 'z' } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-5)
    expect(report.conflictingConstraintIds).toBeUndefined()
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(5, 4)
    expect(b.y).toBeCloseTo(0, 4)
    expect(b.z).toBeCloseTo(0, 4)
  })

  it('an over-determined CONFLICTING set with the same E>F count is still flagged (no false negative)', () => {
    // Sanity counter-case: same E=4 > F=3 shape, but the flush demands a DIFFERENT Z than the
    // coincident → irreducible conflict survives the least-squares solve.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, transform: { x: 1, y: 1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      // coincident pins B.origin to [0,0,0]...
      { id: 'co', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      // ...but this distance demands B.origin sit 5mm from A.origin → cannot hold both.
      { id: 'di', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 5 }
    ]
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('over_constrained')
    expect(report.converged).toBe(false)
    expect(report.conflictingConstraintIds?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('solveMateConstraints — (2b) minimal conflicting set EXCLUDES an innocent mate', () => {
  // B is over-constrained by two coincidents pinning B.origin to two DIFFERENT A points (the real
  // conflict). C, on a SEPARATE part pair, has one satisfiable coincident → innocent. The whole
  // system is over_constrained by count (E=9 > F=6), but the conflict report must name ONLY the two
  // B mates and exclude the innocent C mate (suppressing it leaves the B conflict intact).
  const components = [
    comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
    comp({ id: 'b', grounded: false, transform: { x: 1, y: 1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
    comp({ id: 'c', grounded: false, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
  ]
  const mates: AssemblyMateConstraint[] = [
    { id: 'm_alpha', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
    { id: 'm_beta', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
    // Innocent: C.origin coincident with A.[9,9,9] — independently satisfiable (C is otherwise free).
    { id: 'innocent', kind: 'coincident', part1Id: 'a', feature1: { x: 9, y: 9, z: 9 }, part2Id: 'c', feature2: { x: 0, y: 0, z: 0 } }
  ]

  it('reports over_constrained and the conflicting set is exactly the two B mates', () => {
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('over_constrained')
    expect(report.conflictingConstraintIds).toContain('m_alpha')
    expect(report.conflictingConstraintIds).toContain('m_beta')
    // The innocent, satisfiable mate is NOT blamed.
    expect(report.conflictingConstraintIds).not.toContain('innocent')
    // And the set is precisely the culprits (deterministic, sorted order).
    expect(report.conflictingConstraintIds).toEqual(['m_alpha', 'm_beta'])
  })

  it('the innocent part C is still positioned onto its satisfiable target', () => {
    const { transforms } = solveMateConstraints(components, mates)
    const c = transforms.get('c')!
    expect(c.x).toBeCloseTo(9, 3)
    expect(c.y).toBeCloseTo(9, 3)
    expect(c.z).toBeCloseTo(9, 3)
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

// ── 6-DOF free body (no joint): rotational handles + the count refinement ──────
//
// A no-joint free body is full 6-DOF. It always exposes translational handles, and exposes
// rotational handles ONLY when an active mate constrains its orientation (a directional mate, or a
// positional mate on an offset feature). These tests pin the new rotational convergence AND the
// count refinement that keeps existing balanced positional cases from flipping to under_constrained.

const DEG = Math.PI / 180

/** World direction of a part-local axis under an Euler-ZYX transform (matches the solver's R=Rz·Ry·Rx). */
function worldDir(t: { rxDeg: number; ryDeg: number; rzDeg: number }, local: [number, number, number]): [number, number, number] {
  const [lx, ly, lz] = local
  const cz = Math.cos(t.rzDeg * DEG)
  const sz = Math.sin(t.rzDeg * DEG)
  const cy = Math.cos(t.ryDeg * DEG)
  const sy = Math.sin(t.ryDeg * DEG)
  const cx = Math.cos(t.rxDeg * DEG)
  const sx = Math.sin(t.rxDeg * DEG)
  const x1 = lx
  const y1 = cx * ly - sx * lz
  const z1 = sx * ly + cx * lz
  const x2 = cy * x1 + sy * z1
  const y2 = y1
  const z2 = -sy * x1 + cy * z1
  return [cz * x2 - sz * y2, sz * x2 + cz * y2, z2]
}

describe('solveMateConstraints — 6-DOF free body (no-joint) rotation', () => {
  it('flags a rank-deficient free body: two offset coincidents pin a line but leave a free spin → under_constrained (still positioned)', () => {
    // A grounded at origin. B free (no joint), parked off-pose. Two coincident mates:
    //   c1 pins B.origin → world origin (translation; B feature at origin → no rotation by itself).
    //   c2 pins B's local +X point [1,0,0] → world [0,1,0]; the offset feature activates B's rotation,
    //      and translation ALONE cannot satisfy it — the body MUST rotate local +X onto world +Y.
    // E = 6 and F = 6 by COUNT, but the body can still spin about the line through the two pinned
    // points, so the residual Jacobian has rank 5. The rank check reports the genuine 1 free DOF
    // instead of a false "converged" — yet the parts ARE positioned (the solve reaches the manifold).
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 1, y: -1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'c1', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'c2', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 1, z: 0 }, part2Id: 'b', feature2: { x: 1, y: 0, z: 0 } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    // Rank 5 of 6 free DOF → one genuine free DOF (the spin), reported honestly.
    expect(report.status).toBe('under_constrained')
    expect(report.freeVariableCount).toBe(1)
    // ...but the least-squares solve still drove the parts ONTO the constraint manifold.
    expect(report.finalResidual).toBeLessThan(1e-6)
    const b = transforms.get('b')!
    // B.origin pinned to the world origin (feature at origin → world point is the translation).
    expect(b.x).toBeCloseTo(0, 4)
    expect(b.y).toBeCloseTo(0, 4)
    expect(b.z).toBeCloseTo(0, 4)
    // Rotation WAS used: B's local +X now points along world +Y (the offset point landed on [0,1,0]).
    const bx = worldDir(b, [1, 0, 0])
    expect(bx[0]).toBeCloseTo(0, 4)
    expect(bx[1]).toBeCloseTo(1, 4)
    expect(bx[2]).toBeCloseTo(0, 4)
  })

  it('drives a free body to a unique 6-DOF pose: a point coincidence + three angle mates (E===F===6)', () => {
    // A grounded. B free (no joint), parked off-pose. One coincident on an OFFSET feature of A pins
    // B.origin to world [7,8,9] (translation); three 90° angle mates pin B's orientation so each of
    // its axes is perpendicular to the same-named grounded axis. E = 3 + 1 + 1 + 1 = 6; the angle
    // mates activate all 3 rotational DOF → F = 6. A genuinely rotation-requiring, fully-determined
    // solve (the identity pose satisfies none of the angle mates).
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 1, y: 1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'pos', kind: 'coincident', part1Id: 'a', feature1: { x: 7, y: 8, z: 9 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'ax', kind: 'angle', part1Id: 'a', feature1: { axis: 'x' }, part2Id: 'b', feature2: { axis: 'x' }, value: 90 },
      { id: 'ay', kind: 'angle', part1Id: 'a', feature1: { axis: 'y' }, part2Id: 'b', feature2: { axis: 'y' }, value: 90 },
      { id: 'az', kind: 'angle', part1Id: 'a', feature1: { axis: 'z' }, part2Id: 'b', feature2: { axis: 'z' }, value: 90 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-5)
    const b = transforms.get('b')!
    // Translation is fully determined by the coincident mate.
    expect(b.x).toBeCloseTo(7, 3)
    expect(b.y).toBeCloseTo(8, 3)
    expect(b.z).toBeCloseTo(9, 3)
    // Each body axis ended up perpendicular to the same-named world axis (cos 90° = 0).
    const bx = worldDir(b, [1, 0, 0])
    const by = worldDir(b, [0, 1, 0])
    const bz = worldDir(b, [0, 0, 1])
    expect(Math.abs(bx[0])).toBeLessThan(1e-2) // B.x ⟂ world +X
    expect(Math.abs(by[1])).toBeLessThan(1e-2) // B.y ⟂ world +Y
    expect(Math.abs(bz[2])).toBeLessThan(1e-2) // B.z ⟂ world +Z
  })
})

describe('solveMateConstraints — 6-DOF free body count refinement', () => {
  it('keeps a coincident-at-origin free body translation-only (stays converged at F=3, no rotation introduced)', () => {
    // The deferral hazard: making no-joint bodies 6-DOF unconditionally would turn this E=3/F=3
    // converging case into E=3/F=6 under_constrained, and let the 2° seed rotate B. The refinement
    // (rotation counted only when an orientation mate activates it) keeps it converged AND unrotated.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'm1', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.freeVariableCount).toBeUndefined()
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(5, 5)
    // No rotational handle exists → the anti-singularity seed cannot touch orientation.
    expect(b.rxDeg).toBe(0)
    expect(b.ryDeg).toBe(0)
    expect(b.rzDeg).toBe(0)
  })

  it('classifies a free body with only an angle mate as under_constrained (rotation activated → F=6, E=1)', () => {
    const components = [comp({ id: 'a', grounded: true }), comp({ id: 'b', grounded: false })]
    const mates: AssemblyMateConstraint[] = [
      { id: 'ang', kind: 'angle', part1Id: 'a', feature1: { axis: 'x' }, part2Id: 'b', feature2: { axis: 'x' }, value: 30 }
    ]
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('under_constrained')
    // angle activates the 3 rotational DOF → F = 3 trans + 3 rot = 6; E = 1 → 5 DOF unpinned.
    expect(report.freeVariableCount).toBe(5)
  })

  it('classifies a free body with only an offset coincident as under_constrained (offset feature activates rotation → F=6, E=3)', () => {
    const components = [comp({ id: 'a', grounded: true }), comp({ id: 'b', grounded: false })]
    const mates: AssemblyMateConstraint[] = [
      // B's feature point is offset → the body can rotate about the pinned point, so rotation is
      // activated (F=6) and the single point mate leaves 3 DOF free.
      { id: 'c', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 5, y: 0, z: 0 } }
    ]
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('under_constrained')
    expect(report.freeVariableCount).toBe(3)
  })

  it('still flags two conflicting coincidents on origin features as over_constrained (rotation NOT activated → F=3)', () => {
    // Both coincidents act on B's ORIGIN → rotation stays unactivated (F=3), so E=6 > F=3 keeps the
    // existing over_constrained classification rather than inflating F and masking the conflict.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, transform: { x: 1, y: 1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'm_alpha', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'm_beta', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } }
    ]
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('over_constrained')
    expect(report.conflictingConstraintIds).toContain('m_alpha')
    expect(report.conflictingConstraintIds).toContain('m_beta')
  })
})

// ── Over-constrained refinement: classify AFTER a least-squares solve, gated on the residual ──
//
// The classifier no longer bails the moment the equation count exceeds the DOF count. It runs the
// solve first: a *consistent* over-determination (the surplus equations agree) converges to zero
// residual and is reported converged; only an *inconsistent* one (the surplus equations conflict)
// keeps a positive residual and is flagged over_constrained.
describe('solveMateConstraints — over-constrained refinement (residual-gated)', () => {
  it('a consistent over-determination (3-point rigid registration, E=9 > F=6) converges instead of being flagged conflicting', () => {
    // Three coincident point-pairs (9 equations) on a free body (6 DOF). Over-determined BY COUNT,
    // but the two triples are congruent — a rigid +90°-about-Z rotation plus a [5,6,7] translation
    // maps B's local points onto A's targets — so the system is solvable. B-local p0=[0,0,0],
    // p1=[2,0,0], p2=[0,3,0] → after the motion: [5,6,7], [5,8,7], [2,6,7].
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'p0', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 6, z: 7 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'p1', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 8, z: 7 }, part2Id: 'b', feature2: { x: 2, y: 0, z: 0 } },
      { id: 'p2', kind: 'coincident', part1Id: 'a', feature1: { x: 2, y: 6, z: 7 }, part2Id: 'b', feature2: { x: 0, y: 3, z: 0 } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-5)
    const b = transforms.get('b')!
    // Fully determined by 3 non-collinear point pairs: B.origin at [5,6,7], local +X mapped to +Y.
    expect(b.x).toBeCloseTo(5, 3)
    expect(b.y).toBeCloseTo(6, 3)
    expect(b.z).toBeCloseTo(7, 3)
    const bx = worldDir(b, [1, 0, 0])
    expect(bx[0]).toBeCloseTo(0, 3)
    expect(bx[1]).toBeCloseTo(1, 3)
    expect(bx[2]).toBeCloseTo(0, 3)
  })

  it('an inconsistent over-determination (non-congruent point triples) is still flagged over_constrained', () => {
    // The B-side spacing (origin→[2,0,0] = 2mm) cannot rigidly match the A-side spacing
    // (origin→[10,0,0] = 10mm), so no pose satisfies all three → positive residual → over_constrained.
    const components = [comp({ id: 'a', grounded: true }), comp({ id: 'b', grounded: false })]
    const mates: AssemblyMateConstraint[] = [
      { id: 'p0', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'p1', kind: 'coincident', part1Id: 'a', feature1: { x: 10, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 2, y: 0, z: 0 } },
      { id: 'p2', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 10, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 3, z: 0 } }
    ]
    const { report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('over_constrained')
    expect(report.conflictingConstraintIds).toEqual(expect.arrayContaining(['p0', 'p1', 'p2']))
  })
})

// ── Solver conditioning: Levenberg-Marquardt handles translation↔rotation coupling ─────────────
describe('solveMateConstraints — solver conditioning (Levenberg-Marquardt)', () => {
  it('reaches the constraint manifold for a large feature lever arm within the default iteration budget', () => {
    // A 10mm offset feature couples translation strongly into rotation. Plain fixed-step gradient
    // descent needed >1000 iterations for this (and missed the default budget); LM solves the damped
    // normal equations and reaches zero residual in a handful. (The case is rank-deficient — a free
    // spin — so it classifies under_constrained; the point here is that it CONVERGES the residual fast.)
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, transform: { x: 4, y: -2, z: 3, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'c1', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
      { id: 'c2', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 10, z: 0 }, part2Id: 'b', feature2: { x: 10, y: 0, z: 0 } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.finalResidual).toBeLessThan(1e-6) // reached the manifold
    expect(report.iterations).toBeLessThan(50) // and fast (fixed-step descent took >1000)
    expect(report.status).toBe('under_constrained') // rank-deficient: the free spin
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(0, 4)
    expect(b.y).toBeCloseTo(0, 4)
    expect(b.z).toBeCloseTo(0, 4)
  })
})

// ── Non-revolute joint wiring: slider / cylindrical / planar / ball / universal ────────────────
//
// Before this step only no-joint and revolute bodies got movable handles, so a mate on any other
// joint kind could not be solved (the part stayed at its start pose). Each joint's scalar DOF is now
// mapped to transform-component handles along the joint's WORLD-frame cardinal preview axis (the same
// foundation simplification revolute uses). These analytic tests prove a representative mate solves
// for each newly-wired joint kind.

describe('solveMateConstraints — slider joint wiring', () => {
  it('a slider + distance mate reaches the target offset ALONG the slide axis (E===F===1)', () => {
    // B is a Z-slider; A grounded at origin. A distance mate holds the origins 7mm apart. The slider
    // has one translational DOF along +Z, so B must slide to z=+7 (started at z=1 → +Z branch).
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, joint: 'slider', sliderPreviewAxis: 'z', transform: { x: 0, y: 0, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'd1', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 7 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-5)
    const b = transforms.get('b')!
    expect(b.z).toBeCloseTo(7, 4)
    // The slide handle only moved Z — the off-axis translations are untouched at their start (0).
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
  })

  it('a slider on +X only moves along X (a distance target is reached on the X branch)', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'slider', sliderPreviewAxis: 'x', transform: { x: 2, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'd1', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 12 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(12, 4)
    expect(b.y).toBe(0)
    expect(b.z).toBe(0)
  })

  it('a limited slider that cannot reach its distance target stops AT the limit and is NOT converged', () => {
    // A Z-slider whose slide is limited to a delta of [0, 5] mm FROM its stored pose (start z=1, the
    // delta-from-rest convention `assembly-viewport-math` uses). A distance mate wants 20mm. The slide
    // handle is projected into the absolute range [1, 6] each step, so it stops at z=6 with a positive
    // residual — honest non-convergence, never a false converge at an out-of-range slide.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({
        id: 'b',
        grounded: false,
        joint: 'slider',
        sliderPreviewAxis: 'z',
        transform: { x: 0, y: 0, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        jointLimits: { scalarMinMm: 0, scalarMaxMm: 5 }
      })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'd1', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 20 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.converged).toBe(false)
    expect(report.status).not.toBe('converged')
    const b = transforms.get('b')!
    // Absolute reachable range = start(1) + delta[0,5] = [1, 6]; the solve stops at the +6 boundary.
    expect(b.z).toBeLessThanOrEqual(6 + 1e-6) // never escapes start + maxDelta
    expect(b.z).toBeCloseTo(6, 3) // pushed to the boundary nearest the unreachable 20mm target
    expect(report.finalResidual).toBeGreaterThan(1e-3) // 20 − 6 = 14mm short → real residual
  })
})

describe('solveMateConstraints — cylindrical joint wiring', () => {
  it('a cylindrical joint satisfies BOTH a distance (slide) and an angle (spin) about its axis (E===F===2)', () => {
    // B is a Z-cylindrical joint (slide + spin about +Z); A grounded at origin. A distance mate
    // (7mm between origins) drives the slide; a 90° angle mate (B.x vs A.x) drives the spin about Z.
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, joint: 'cylindrical', cylindricalPreviewAxis: 'z', transform: { x: 0, y: 0, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'd1', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, value: 7 },
      { id: 'ang', kind: 'angle', part1Id: 'a', feature1: { axis: 'x' }, part2Id: 'b', feature2: { axis: 'x' }, value: 90 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-5)
    const b = transforms.get('b')!
    // Slide reached the distance target on +Z.
    expect(b.z).toBeCloseTo(7, 3)
    // Spin about Z made B's +X perpendicular to A's +X → cos(rz) ≈ 0 → |rz| ≈ 90°.
    expect(Math.abs(Math.cos(b.rzDeg * DEG))).toBeLessThan(1e-2)
    // No off-axis translation drift (only the slide DOF and the spin DOF were wired).
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
  })
})

describe('solveMateConstraints — planar joint wiring', () => {
  it('a planar joint (normal +Z) reaches an in-plane XY target via a coincident mate (E vs F=2)', () => {
    // B is a planar joint with normal +Z → in-plane DOF are X and Y. A coincident mate pins B's
    // origin to world [3,4,0]. The two in-plane handles drive X→3 and Y→4; Z is NOT a handle, so the
    // out-of-plane residual cannot be removed — we assert the in-plane components are satisfied.
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, joint: 'planar', planarPreviewNormalAxis: 'z', transform: { x: 1, y: 1, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'c1', kind: 'coincident', part1Id: 'a', feature1: { x: 3, y: 4, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    const b = transforms.get('b')!
    // The two in-plane handles drove X and Y exactly onto the target.
    expect(b.x).toBeCloseTo(3, 4)
    expect(b.y).toBeCloseTo(4, 4)
    // Z is not a handle on a planar joint → it stays at its start (out-of-plane motion is locked).
    expect(b.z).toBe(0)
  })
})

describe('solveMateConstraints — ball joint wiring', () => {
  it('a ball joint reaches a 3-axis orientation target (three 90° angle mates, E===F===3)', () => {
    // B is a ball joint (3 rotational DOF). Three 90° angle mates pin each of B's axes perpendicular
    // to the same-named grounded axis — a genuinely rotation-requiring, fully-determined orientation.
    const components = [
      comp({ id: 'a', grounded: true, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }),
      comp({ id: 'b', grounded: false, joint: 'ball', transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'ax', kind: 'angle', part1Id: 'a', feature1: { axis: 'x' }, part2Id: 'b', feature2: { axis: 'x' }, value: 90 },
      { id: 'ay', kind: 'angle', part1Id: 'a', feature1: { axis: 'y' }, part2Id: 'b', feature2: { axis: 'y' }, value: 90 },
      { id: 'az', kind: 'angle', part1Id: 'a', feature1: { axis: 'z' }, part2Id: 'b', feature2: { axis: 'z' }, value: 90 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-5)
    const b = transforms.get('b')!
    // Each body axis ended up perpendicular to the same-named world axis (cos 90° = 0).
    expect(Math.abs(worldDir(b, [1, 0, 0])[0])).toBeLessThan(1e-2)
    expect(Math.abs(worldDir(b, [0, 1, 0])[1])).toBeLessThan(1e-2)
    expect(Math.abs(worldDir(b, [0, 0, 1])[2])).toBeLessThan(1e-2)
    // A ball joint has no translational handle → B's position never drifts.
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.z).toBe(0)
  })

  it('a ball joint reaches a single angle target (under_constrained but residual ~0)', () => {
    // One angle mate (E=1) on a 3-DOF ball → under_constrained, but the orientation IS reachable, so
    // the residual still converges to ~0 (the part is positioned onto the constraint manifold).
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'ball' })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'ang', kind: 'angle', part1Id: 'a', feature1: { axis: 'x' }, part2Id: 'b', feature2: { axis: 'x' }, value: 90 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('under_constrained')
    expect(report.freeVariableCount).toBe(2) // 3 ball DOF − rank 1
    expect(report.finalResidual).toBeLessThan(1e-6)
    const b = transforms.get('b')!
    expect(Math.abs(worldDir(b, [1, 0, 0])[0])).toBeLessThan(1e-2) // B.x ⟂ world +X
  })
})

describe('solveMateConstraints — universal joint wiring', () => {
  it('a universal joint reaches an angle target about its first Cardan axis (Z), within E vs F=2', () => {
    // B is a universal joint (axis1 +Z, axis2 +X by default) → 2 rotational handles. A 90° angle mate
    // between the X axes is satisfied by rotating about axis1 (+Z). E=1 < F=2 → under_constrained, but
    // the target is reachable so the residual converges to ~0.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'universal', universalPreviewAxis1: 'z', universalPreviewAxis2: 'x' })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'ang', kind: 'angle', part1Id: 'a', feature1: { axis: 'x' }, part2Id: 'b', feature2: { axis: 'x' }, value: 90 }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('under_constrained')
    expect(report.finalResidual).toBeLessThan(1e-6)
    const b = transforms.get('b')!
    // B's +X is now perpendicular to A's +X.
    expect(Math.abs(worldDir(b, [1, 0, 0])[0])).toBeLessThan(1e-2)
  })
})
