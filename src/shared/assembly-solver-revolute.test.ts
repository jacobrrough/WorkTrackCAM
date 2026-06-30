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

// ── Joint limits respected DURING the solve (not clamped post-hoc into a broken mate) ───────────
describe('revolute angle solving — joint limits', () => {
  it('a ±30° limited revolute that cannot reach a 90° angle target ends WITHIN limits and is NOT converged', () => {
    // The angle mate wants rz = 90° (B.x ⟂ A.x), but the hinge is limited to ±30°. The solver must
    // project the handle into [-30, 30] every step, so it CANNOT report a false 'converged' at 90°.
    // (Before this fix it converged to a huge out-of-range angle that the kinematics clamp then broke.)
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({
        id: 'b',
        grounded: false,
        joint: 'revolute',
        revolutePreviewAxis: 'z',
        jointLimits: { scalarMinDeg: -30, scalarMaxDeg: 30 }
      })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('x', 'x', 90)])
    // Unreachable within the range → honest non-convergence with a residual that remains positive.
    expect(report.status).not.toBe('converged')
    expect(report.converged).toBe(false)
    expect(report.finalResidual).toBeGreaterThan(1e-3)
    const b = transforms.get('b')!
    // The solved angle stays inside the hard limit (with a hair of numeric tolerance).
    expect(b.rzDeg).toBeLessThanOrEqual(30 + 1e-6)
    expect(b.rzDeg).toBeGreaterThanOrEqual(-30 - 1e-6)
    // It pushed AS FAR AS the limit allows toward the target (cos shrinks toward 90°) → lands at +30°.
    expect(b.rzDeg).toBeCloseTo(30, 2)
  })

  it('a ±120° limited revolute REACHES a 90° angle target (limit wide enough → converged)', () => {
    // Proves the clamp does not over-restrict: 90° is inside ±120°, so the solve still converges.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({
        id: 'b',
        grounded: false,
        joint: 'revolute',
        revolutePreviewAxis: 'z',
        jointLimits: { scalarMinDeg: -120, scalarMaxDeg: 120 }
      })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('x', 'x', 90)])
    expect(report.status).toBe('converged')
    expect(report.finalResidual).toBeLessThan(1e-6)
    const b = transforms.get('b')!
    expect(Math.abs(Math.cos(b.rzDeg * DEG2RAD))).toBeLessThan(1e-3) // |rz| ≈ 90°, within ±120°
    expect(Math.abs(b.rzDeg)).toBeLessThanOrEqual(120 + 1e-6)
  })
})

// ── Reported angles canonicalized to (-180, 180] WITHOUT changing solved geometry ──────────────
describe('revolute angle solving — reported-angle normalization', () => {
  it('a hinge already satisfied at a wound 1710° start reports the canonical −90° (geometry unchanged)', () => {
    // B starts at rzDeg=1710 (≡ 270° ≡ −90°), which ALREADY satisfies a 90° angle mate (cos 1710°=0),
    // so the solver converges at the start pose with no change. The REPORTED angle must be folded into
    // (-180, 180] → −90°, even though geometrically 1710° and −90° are identical.
    const components = [
      comp({ id: 'a', grounded: true }),
      comp({
        id: 'b',
        grounded: false,
        joint: 'revolute',
        revolutePreviewAxis: 'z',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 1710 }
      })
    ]
    const { transforms, report } = solveMateConstraints(components, [angleMate('x', 'x', 90)])
    expect(report.status).toBe('converged')
    const b = transforms.get('b')!
    // Reported angle is canonical, NOT the raw 1710°.
    expect(b.rzDeg).toBeCloseTo(-90, 6)
    expect(b.rzDeg).toBeGreaterThan(-180)
    expect(b.rzDeg).toBeLessThanOrEqual(180)
    // Geometry preserved: cos of the reported angle still satisfies the perpendicular (90°) mate.
    expect(Math.abs(Math.cos(b.rzDeg * DEG2RAD))).toBeLessThan(1e-9)
  })
})
