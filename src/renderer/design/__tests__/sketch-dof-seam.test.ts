/**
 * Sketch S5 — pure units for the DOF seam (the honest, conservative fallback
 * the SketchSurface badge consumes until the engine agent's `analyzeSketchDof`
 * lands). Each verdict (empty / under / fully / over) is exercised, plus the
 * honesty qualifier in every label.
 */

import { describe, expect, it } from 'vitest'
import { analyzeSketchDof } from '../sketch-dof-seam'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'

/** Two free points = 4 free coordinates. */
function twoFreePoints(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }]
  }
}

describe('analyzeSketchDof', () => {
  it('empty sketch (no points) → status "empty" + blank label', () => {
    const r = analyzeSketchDof(emptyDesign())
    expect(r.status).toBe('empty')
    expect(r.label).toBe('')
  })

  it('points but no constraints → under-constrained, DOF = free coords', () => {
    const r = analyzeSketchDof(twoFreePoints())
    expect(r.status).toBe('under')
    expect(r.dof).toBe(4) // 2 points * 2 coords
    expect(r.label).toContain('4 DoF')
    expect(r.label.toLowerCase()).toContain('approx')
  })

  it('a coincident (2 eqns) drops DOF by 2', () => {
    const d = twoFreePoints()
    d.constraints = [{ id: 'c1', type: 'coincident', a: { pointId: 'a' }, b: { pointId: 'b' } }]
    const r = analyzeSketchDof(d)
    expect(r.dof).toBe(2)
    expect(r.status).toBe('under')
  })

  it('exactly enough equations → fully constrained (approx), DOF 0', () => {
    const d = twoFreePoints()
    // 4 free coords; pin both points with two `fix` (2 eqns each) = 4 equations.
    d.constraints = [
      { id: 'f1', type: 'fix', pointId: 'a' },
      { id: 'f2', type: 'fix', pointId: 'b' }
    ]
    const r = analyzeSketchDof(d)
    expect(r.dof).toBe(0)
    expect(r.status).toBe('fully')
    expect(r.label).toBe('Fully constrained (approx)')
  })

  it('NEVER claims a bare "Fully constrained" (honesty qualifier present)', () => {
    const d = twoFreePoints()
    d.constraints = [
      { id: 'f1', type: 'fix', pointId: 'a' },
      { id: 'f2', type: 'fix', pointId: 'b' }
    ]
    const r = analyzeSketchDof(d)
    expect(r.label).not.toBe('Fully constrained')
    expect(r.label.toLowerCase()).toContain('approx')
  })

  it('more equations than coordinates → over-constrained (approx)', () => {
    const d = twoFreePoints()
    d.constraints = [
      { id: 'f1', type: 'fix', pointId: 'a' },
      { id: 'f2', type: 'fix', pointId: 'b' },
      { id: 'h1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }
    ]
    const r = analyzeSketchDof(d)
    expect(r.dof).toBeLessThan(0)
    expect(r.status).toBe('over')
    expect(r.label).toBe('Over-constrained (approx)')
  })

  it('a distance constraint removes one DOF (engine counts it as 1 equation)', () => {
    const d = twoFreePoints()
    d.parameters = { len: 10 }
    d.constraints = [{ id: 'd1', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'len' }]
    // 4 free coords − 1 distance equation → DOF 3.
    expect(analyzeSketchDof(d).dof).toBe(3)
    expect(analyzeSketchDof(d).status).toBe('under')
  })

  it('a FIXED point contributes no free coordinates', () => {
    const d = twoFreePoints()
    d.points['a']!.fixed = true
    // only b is free → 2 free coords, no constraints → DOF 2.
    expect(analyzeSketchDof(d).dof).toBe(2)
  })
})
