/**
 * sketch-solve-status.ts — pure mapping tests (CAD V1).
 *
 * No React or DOM. Each test exercises one branch of the diagnosis →
 * UI-flag mapping so a regression points straight at the broken case.
 */

import { describe, expect, it } from 'vitest'
import {
  deriveSketchStatus,
  mapSolveDiagnosisToStatus,
  sketchStatusBadgeLabel,
  type SketchSolveDiagnosis
} from './sketch-solve-status'
import { initialSketchState, sketchReducer, type Sketch } from './sketch-state'

/** Build a sketch with one horizontal-constrained line for the mapping tests. */
function lineWithHorizontal(): Sketch {
  let s = initialSketchState()
  s = sketchReducer(s, {
    type: 'addLine',
    id: 'L1',
    start: { id: 'a', x: 0, y: 0 },
    end: { id: 'b', x: 10, y: 1 }
  })
  s = sketchReducer(s, {
    type: 'addConstraint',
    constraint: { id: 'h1', kind: 'horizontal', aId: 'a', bId: 'b' }
  })
  return s.sketch
}

describe('sketch-solve-status — deriveSketchStatus', () => {
  it('conflicts always win (over) regardless of dof', () => {
    expect(deriveSketchStatus(0, true)).toBe('over')
    expect(deriveSketchStatus(5, true)).toBe('over')
  })

  it('positive dof → under', () => {
    expect(deriveSketchStatus(3, false)).toBe('under')
  })

  it('exactly zero dof + no conflicts → fully', () => {
    expect(deriveSketchStatus(0, false)).toBe('fully')
  })

  it('negative dof (over-determined) → over', () => {
    expect(deriveSketchStatus(-2, false)).toBe('over')
  })

  it('missing dof + no conflicts → under (never a false "fully")', () => {
    expect(deriveSketchStatus(undefined, false)).toBe('under')
  })
})

describe('sketch-solve-status — mapSolveDiagnosisToStatus base maps', () => {
  it('populates a flag for every entity and a state for every constraint', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, { dof: 4 })
    // line entity + (no point entities) → one entity flag
    expect(map.entityFlags.has('L1')).toBe(true)
    expect(map.constraintState.has('h1')).toBe(true)
    expect(map.constraintState.get('h1')).toBe('ok')
    expect(map.entityFlags.get('L1')).toEqual({ status: 'under', conflicting: false })
  })

  it('echoes dof and derives under status from a positive dof', () => {
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), { dof: 4 })
    expect(map.dof).toBe(4)
    expect(map.sketchStatus).toBe('under')
  })

  it('a fully constrained solve tints every entity fully', () => {
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), { dof: 0 })
    expect(map.sketchStatus).toBe('fully')
    expect(map.entityFlags.get('L1')?.status).toBe('fully')
  })

  it('explicit solver status overrides the dof-derived guess', () => {
    // dof 0 would derive "fully", but the solver says "over".
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), { dof: 0, status: 'over' })
    expect(map.sketchStatus).toBe('over')
  })
})

describe('sketch-solve-status — conflict highlighting', () => {
  it('marks a conflicting constraint and lights the entity sharing its point', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, {
      dof: 0,
      conflictingConstraintIds: ['h1']
    })
    expect(map.sketchStatus).toBe('over')
    expect(map.constraintState.get('h1')).toBe('conflicting')
    expect(map.conflictingConstraintIds.has('h1')).toBe(true)
    // h1 references points a/b which the line L1 owns → line is conflicting.
    expect(map.entityFlags.get('L1')?.conflicting).toBe(true)
  })

  it('lights a circle entity when a radius constraint on it conflicts', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addCircle',
      id: 'C1',
      center: { id: 'c', x: 0, y: 0 },
      radius: 5
    })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'r1', kind: 'radius', entityId: 'C1', value: 5 }
    })
    const map = mapSolveDiagnosisToStatus(s.sketch, { conflictingConstraintIds: ['r1'] })
    expect(map.entityFlags.get('C1')?.conflicting).toBe(true)
    expect(map.constraintState.get('r1')).toBe('conflicting')
  })

  it('lights both circles when a concentric constraint conflicts (entity refs)', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addCircle', id: 'C1', center: { id: 'c1', x: 0, y: 0 }, radius: 5 })
    s = sketchReducer(s, { type: 'addCircle', id: 'C2', center: { id: 'c2', x: 9, y: 0 }, radius: 3 })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'cc1', kind: 'concentric', entityAId: 'C1', entityBId: 'C2' }
    })
    const map = mapSolveDiagnosisToStatus(s.sketch, { conflictingConstraintIds: ['cc1'] })
    expect(map.entityFlags.get('C1')?.conflicting).toBe(true)
    expect(map.entityFlags.get('C2')?.conflicting).toBe(true)
  })

  it('non-conflicting entities stay un-highlighted', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addLine', id: 'L1', start: { id: 'a', x: 0, y: 0 }, end: { id: 'b', x: 5, y: 0 } })
    s = sketchReducer(s, { type: 'addLine', id: 'L2', start: { id: 'c', x: 0, y: 5 }, end: { id: 'd', x: 5, y: 5 } })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'h1', kind: 'horizontal', aId: 'a', bId: 'b' }
    })
    const map = mapSolveDiagnosisToStatus(s.sketch, { conflictingConstraintIds: ['h1'] })
    expect(map.entityFlags.get('L1')?.conflicting).toBe(true)
    expect(map.entityFlags.get('L2')?.conflicting).toBe(false)
  })
})

describe('sketch-solve-status — redundant + stale id handling', () => {
  it('classifies redundant constraints distinctly from conflicting', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, { dof: 0, redundantConstraintIds: ['h1'] })
    expect(map.constraintState.get('h1')).toBe('redundant')
    expect(map.redundantConstraintIds.has('h1')).toBe(true)
    // Redundant (not conflicting) does NOT force over-constrained.
    expect(map.sketchStatus).toBe('fully')
    expect(map.entityFlags.get('L1')?.conflicting).toBe(false)
  })

  it('a constraint flagged both conflicting + redundant is treated as conflicting', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, {
      conflictingConstraintIds: ['h1'],
      redundantConstraintIds: ['h1']
    })
    expect(map.constraintState.get('h1')).toBe('conflicting')
    expect(map.redundantConstraintIds.has('h1')).toBe(false)
  })

  it('ignores stale constraint ids the sketch no longer contains', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, {
      dof: 0,
      conflictingConstraintIds: ['ghost', 'h1'],
      redundantConstraintIds: ['also-gone']
    })
    expect(map.conflictingConstraintIds.has('ghost')).toBe(false)
    expect(map.conflictingConstraintIds.has('h1')).toBe(true)
    expect(map.redundantConstraintIds.has('also-gone')).toBe(false)
    // Stale ids must never appear as constraintState keys.
    expect([...map.constraintState.keys()]).toEqual(['h1'])
  })
})

describe('sketch-solve-status — sketchStatusBadgeLabel', () => {
  it('fully constrained label', () => {
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), { dof: 0 })
    expect(sketchStatusBadgeLabel(map)).toBe('Fully constrained')
  })

  it('under-constrained label includes the DOF count', () => {
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), { dof: 3 })
    expect(sketchStatusBadgeLabel(map)).toBe('Under-constrained: 3 DOF')
  })

  it('over-constrained label NAMES the culprit (kind + id) with the removal hint', () => {
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), {
      conflictingConstraintIds: ['h1']
    })
    expect(sketchStatusBadgeLabel(map)).toBe(
      'Over-constrained — Horizontal h1 conflicts; remove it or another constraint on these entities'
    )
  })

  it('several conflicting constraints are all named, with the pick-one hint', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addLine',
      id: 'L1',
      start: { id: 'a', x: 0, y: 0 },
      end: { id: 'b', x: 10, y: 1 }
    })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'h1', kind: 'horizontal', aId: 'a', bId: 'b' }
    })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'd1', kind: 'distance', aId: 'a', bId: 'b', value: 10 }
    })
    const map = mapSolveDiagnosisToStatus(s.sketch, {
      conflictingConstraintIds: ['h1', 'd1']
    })
    expect(sketchStatusBadgeLabel(map)).toBe(
      'Over-constrained — Horizontal h1, Distance d1 conflict; remove one of them'
    )
  })

  it('over-constrained with no ids falls back to the bare label', () => {
    const map = mapSolveDiagnosisToStatus(lineWithHorizontal(), { dof: -1 })
    expect(sketchStatusBadgeLabel(map)).toBe('Over-constrained')
  })
})
