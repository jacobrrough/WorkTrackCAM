/**
 * Revolute-joint ANGLE/TANGENT mate solving (Cycle 264's deferral, now wired).
 *
 * The foundation solver computed the angle/tangent residual correctly but had no
 * rotational free variable to move, so a hinge + angle mate stalled at
 * `max_iterations`. The solver now wires a revolute joint's single rotational DOF
 * (about its `revolutePreviewAxis`) as a movable handle — a revolute (1 DOF) + one
 * angle mate (1 equation) is the `E === F` regime the loop already runs, so it
 * converges to the target angle. These tests pin that, plus the no-regression
 * cases (no-mate revolute stays under-constrained; translation still solves).
 */
import { describe, expect, it } from 'vitest'
import type { AssemblyComponent } from './assembly-schema'
import type { AssemblyMateConstraint } from './assembly-mate-schema'
import { solveMateConstraints } from './assembly-solver-core'

const DEG2RAD = Math.PI / 180

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

function angleMate(
  axis1: 'x' | 'y' | 'z',
  axis2: 'x' | 'y' | 'z',
  valueDeg: number,
  kind: 'angle' | 'tangent' = 'angle'
): AssemblyMateConstraint {
  return {
    id: 'ang',
    kind,
    part1Id: 'a',
    feature1: { x: 0, y: 0, z: 0, axis: axis1 },
    part2Id: 'b',
    feature2: { x: 0, y: 0, z: 0, axis: axis2 },
    ...(kind === 'angle' ? { value: valueDeg } : {})
  } as AssemblyMateConstraint
}

describe('revolute angle solving — Z hinge', () => {
  it('converges a 90° angle mate from an exactly-aligned start (anti-singularity seed)', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'revolute', revolutePreviewAxis: 'z' })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('x', 'x', 90)])
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-6)
    // B's local +X, rotated by the solved rz about Z, is perpendicular to A's +X
    // → dot = cos(rz) ≈ 0 → |rz| ≈ 90°.
    const b = transforms.get('b')!
    expect(Math.abs(Math.cos(b.rzDeg * DEG2RAD))).toBeLessThan(1e-3)
    // Only the revolute Euler angle moved — translation untouched.
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.z).toBe(0)
  })

  it('converges a 45° angle mate (dot → cos45°)', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'revolute', revolutePreviewAxis: 'z' })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('x', 'x', 45)])
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    expect(Math.cos(b.rzDeg * DEG2RAD)).toBeCloseTo(Math.cos(45 * DEG2RAD), 3)
  })

  it('converges a tangent (perpendicular) mate on a Z hinge', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'revolute', revolutePreviewAxis: 'z' })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('x', 'x', 0, 'tangent')])
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    // tangent → axes perpendicular → cos(rz) ≈ 0.
    expect(Math.abs(Math.cos(b.rzDeg * DEG2RAD))).toBeLessThan(1e-3)
  })
})

describe('revolute angle solving — X hinge', () => {
  it('rotates about +X to satisfy a 90° angle mate between Y axes', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, joint: 'revolute', revolutePreviewAxis: 'x' })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('y', 'y', 90)])
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    // Rotation happened about X (rxDeg moved); rz/ry untouched.
    expect(Math.abs(Math.cos(b.rxDeg * DEG2RAD))).toBeLessThan(1e-3)
    expect(b.rzDeg).toBe(0)
    expect(b.ryDeg).toBe(0)
  })
})

describe('revolute angle solving — no regressions', () => {
  it('a revolute with NO mate is still honestly under-constrained', () => {
    const components = [comp({ id: 'a', grounded: true }), comp({ id: 'b', grounded: false, joint: 'revolute' })]
    const { report } = solveMateConstraints(components, [])
    expect(report.status).toBe('under_constrained')
    expect(report.freeVariableCount).toBe(1)
  })

  it('translational coincident solving is unchanged (no rotational handle added)', () => {
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({ id: 'b', grounded: false, transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } })
    ]
    const mates: AssemblyMateConstraint[] = [
      { id: 'm1', kind: 'coincident', part1Id: 'a', feature1: { x: 5, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } }
    ]
    const { transforms, report } = solveMateConstraints(components, mates)
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    expect(b.x).toBeCloseTo(5, 5)
    // No rotation introduced on a pure-translation solve.
    expect(b.rxDeg).toBe(0)
    expect(b.ryDeg).toBe(0)
    expect(b.rzDeg).toBe(0)
  })
})
