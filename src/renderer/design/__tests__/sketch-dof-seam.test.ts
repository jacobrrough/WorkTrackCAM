/**
 * Sketch S5 — pure units for the DOF seam (the honest, conservative fallback
 * the SketchSurface badge consumes until the engine agent's `analyzeSketchDof`
 * lands). Each verdict (empty / under / fully / over) is exercised, plus the
 * honesty qualifier in every label.
 */

import { describe, expect, it } from 'vitest'
import { analyzeSketchDof, analyzeSketchDofSettled } from '../sketch-dof-seam'
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

// ─────────────────────────────────────────────────────────────────────────────
// Sketch S5.1 — analyzeSketchDofSettled: the conflict-AWARE, settled-gated badge
// read. It folds the post-solve residual in ONLY under a strict gate, so the
// badge can never claim a conflict on a transiently-unsolved / mid-draw design.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A 2-vertex segment whose endpoints sit 10 mm apart, carrying TWO distance
 * constraints with CONFLICTING targets (10 and 80). The equation count reads
 * `under` (4 free coords − 2 distance eqns = 2 DOF), but no geometry can satisfy
 * both distances at once, so the post-solve residual is high — the exact case
 * the count is blind to. (Geometry is left at the 10 mm state, i.e. distance #2
 * is violated by 70 mm; `sketchResidualReport` reads the design as-given, which
 * is what the SETTLED design the surface passes looks like after a solve that
 * cannot converge.)
 */
function conflictingDistances(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
    parameters: { lenA: 10, lenB: 80 },
    constraints: [
      { id: 'dA', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'lenA' },
      { id: 'dB', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'lenB' }
    ]
  }
}

/** A 2-vertex 10 mm segment with ONE satisfiable distance constraint (target 10). */
function satisfiableDistance(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
    parameters: { len: 10 },
    constraints: [
      { id: 'd1', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'len' }
    ]
  }
}

describe('analyzeSketchDofSettled (S5.1 conflict-aware, gated)', () => {
  it('settled + count says under BUT residual is high → "conflicting"', () => {
    const d = conflictingDistances()
    // Count alone cannot see the conflict — it reads under.
    expect(analyzeSketchDof(d).status).toBe('under')
    // Settled: the residual is folded in → genuine conflict surfaced.
    const r = analyzeSketchDofSettled(d, true)
    expect(r.status).toBe('conflicting')
    expect(r.label).toBe('Conflicting (check dimensions)')
  })

  it('UNSETTLED never reads "conflicting" — same conflict design reads count-only', () => {
    const d = conflictingDistances()
    // The honesty bar: a transiently-unsolved/mid-draw design (settled === false)
    // falls back to the count verdict and NEVER false-positives a conflict.
    const r = analyzeSketchDofSettled(d, false)
    expect(r.status).toBe('under')
    expect(r).toEqual(analyzeSketchDof(d))
  })

  it('a constraint-free design is NEVER "conflicting", even when settled', () => {
    // No constraints/dimensions = nothing to over-define. The residual is not
    // even consulted (the hasRelations floor gate), so it stays count-only.
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }]
    }
    const r = analyzeSketchDofSettled(d, true)
    expect(r.status).toBe('under')
    expect(r.status).not.toBe('conflicting')
  })

  it('settled + satisfiable constraint (low residual) keeps the count verdict', () => {
    const d = satisfiableDistance()
    // Count: 4 − 1 = 3 DOF → under; residual is ~0 (distance already met), so no
    // upgrade — the badge reads the honest count verdict.
    const r = analyzeSketchDofSettled(d, true)
    expect(r.status).toBe('under')
    expect(r.dof).toBe(3)
  })

  it('settled + the COUNT already flags over → stays "over" (not re-badged conflicting)', () => {
    // Over-by-count (the equation count itself saw the redundancy): keep the
    // structural 'over' verdict + its "Over-constrained" copy, don't relabel it.
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
    expect(analyzeSketchDof(d).status).toBe('over')
    const r = analyzeSketchDofSettled(d, true)
    expect(r.status).toBe('over')
    expect(r.label).toBe('Over-constrained (approx)')
  })

  it('an empty sketch is "empty" regardless of the settled flag', () => {
    expect(analyzeSketchDofSettled(emptyDesign(), true).status).toBe('empty')
    expect(analyzeSketchDofSettled(emptyDesign(), false).status).toBe('empty')
    expect(analyzeSketchDofSettled(emptyDesign(), true).label).toBe('')
  })

  it('an annotation-only dimension (no constraint) gates conflict via hasRelations', () => {
    // A dimension counts as a relation for the floor gate, but with no actual
    // constraint the residual is 0, so a satisfiable annotation design stays
    // count-only — proving the dimension path of hasRelations is reachable.
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      dimensions: [{ id: 'dim1', kind: 'aligned', aId: 'a', bId: 'b' }]
    }
    expect(analyzeSketchDofSettled(d, true).status).toBe('under')
  })
})
