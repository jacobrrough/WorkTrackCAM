/**
 * sketch-state.ts — reducer + adapter pinning tests (CAD V1 MVP).
 *
 * Pure unit tests; no React or DOM. Each test exercises a single
 * reducer branch or adapter conversion so a future regression points
 * straight at the broken transition.
 */

import { describe, expect, it } from 'vitest'
import {
  categoriseSolveResult,
  emptySketch,
  initialSketchState,
  sketchReducer,
  sketchToDesign,
  SOLVER_OK_RESIDUAL,
  type Constraint,
  type SketchAction
} from './sketch-state'

describe('sketch-state — reducer happy paths', () => {
  it('addPoint inserts a point + a point entity', () => {
    const s0 = initialSketchState()
    const s1 = sketchReducer(s0, {
      type: 'addPoint',
      pointId: 'p1',
      x: 1,
      y: 2
    })
    expect(Object.keys(s1.sketch.points)).toContain('p1')
    expect(s1.sketch.points['p1']).toEqual({ x: 1, y: 2, fixed: undefined })
    expect(s1.sketch.entities).toHaveLength(1)
    expect(s1.sketch.entities[0]!.kind).toBe('point')
  })

  it('addLine inserts two points + a line entity referencing them', () => {
    const s0 = initialSketchState()
    const s1 = sketchReducer(s0, {
      type: 'addLine',
      id: 'L1',
      start: { id: 'a', x: 0, y: 0 },
      end: { id: 'b', x: 10, y: 0 }
    })
    expect(s1.sketch.points).toHaveProperty('a')
    expect(s1.sketch.points).toHaveProperty('b')
    expect(s1.sketch.entities).toHaveLength(1)
    expect(s1.sketch.entities[0]).toMatchObject({ id: 'L1', kind: 'line', startId: 'a', endId: 'b' })
  })

  it('addCircle inserts a centre point + a circle entity', () => {
    const s0 = initialSketchState()
    const s1 = sketchReducer(s0, {
      type: 'addCircle',
      id: 'C1',
      center: { id: 'c', x: 5, y: 5 },
      radius: 3
    })
    expect(s1.sketch.points).toHaveProperty('c')
    expect(s1.sketch.entities[0]).toMatchObject({ id: 'C1', kind: 'circle', centerId: 'c', radius: 3 })
  })

  it('addArc inserts three points + an arc entity', () => {
    const s0 = initialSketchState()
    const s1 = sketchReducer(s0, {
      type: 'addArc',
      id: 'A1',
      start: { id: 's', x: 0, y: 0 },
      via: { id: 'v', x: 5, y: 5 },
      end: { id: 'e', x: 10, y: 0 }
    })
    expect(s1.sketch.entities[0]).toMatchObject({
      id: 'A1',
      kind: 'arc',
      startId: 's',
      viaId: 'v',
      endId: 'e'
    })
    expect(Object.keys(s1.sketch.points).sort()).toEqual(['e', 's', 'v'])
  })

  it('reuses an existing point id when supplied (no duplicate insert)', () => {
    const s0 = sketchReducer(initialSketchState(), {
      type: 'addPoint',
      pointId: 'shared',
      x: 0,
      y: 0
    })
    const s1 = sketchReducer(s0, {
      type: 'addLine',
      start: { id: 'shared', x: 99, y: 99 }, // coords ignored when id matches
      end: { x: 10, y: 0 }
    })
    // Existing point's coords are untouched
    expect(s1.sketch.points['shared']).toEqual({ x: 0, y: 0, fixed: undefined })
  })

  it('addConstraint appends a constraint record', () => {
    const c: Constraint = {
      id: 'co1',
      kind: 'horizontal',
      aId: 'a',
      bId: 'b'
    }
    const s1 = sketchReducer(initialSketchState(), {
      type: 'addConstraint',
      constraint: c
    })
    expect(s1.sketch.constraints).toEqual([c])
  })
})

describe('sketch-state — removeEntity cascade', () => {
  it('removes the entity and the orphaned points it owned', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addLine',
      id: 'L',
      start: { id: 'a', x: 0, y: 0 },
      end: { id: 'b', x: 5, y: 0 }
    })
    s = sketchReducer(s, { type: 'removeEntity', id: 'L' })
    expect(s.sketch.entities).toHaveLength(0)
    expect(s.sketch.points).toEqual({})
  })

  it('keeps shared points alive when another entity still references them', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addLine',
      id: 'L1',
      start: { id: 'a', x: 0, y: 0 },
      end: { id: 'b', x: 5, y: 0 }
    })
    s = sketchReducer(s, {
      type: 'addLine',
      id: 'L2',
      start: { id: 'b', x: 5, y: 0 },
      end: { id: 'c', x: 10, y: 0 }
    })
    s = sketchReducer(s, { type: 'removeEntity', id: 'L1' })
    expect(s.sketch.points).toHaveProperty('b') // still in L2
    expect(s.sketch.points).not.toHaveProperty('a') // orphaned
  })

  it('drops radius constraints attached to a removed circle', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addCircle',
      id: 'C',
      center: { id: 'cp', x: 0, y: 0 },
      radius: 5
    })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'co', kind: 'radius', entityId: 'C', value: 5 }
    })
    s = sketchReducer(s, { type: 'removeEntity', id: 'C' })
    expect(s.sketch.constraints).toHaveLength(0)
  })
})

describe('sketch-state — undo / redo', () => {
  it('undo reverts the most recent mutation', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 1, y: 1 })
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p2', x: 2, y: 2 })
    expect(s.sketch.entities).toHaveLength(2)
    s = sketchReducer(s, { type: 'undo' })
    expect(s.sketch.entities).toHaveLength(1)
    expect(s.sketch.points).not.toHaveProperty('p2')
  })

  it('redo re-applies the most recently undone mutation', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 1, y: 1 })
    s = sketchReducer(s, { type: 'undo' })
    expect(s.sketch.entities).toHaveLength(0)
    s = sketchReducer(s, { type: 'redo' })
    expect(s.sketch.entities).toHaveLength(1)
    expect(s.sketch.points).toHaveProperty('p1')
  })

  it('a new mutation after undo clears the redo stack', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 1, y: 1 })
    s = sketchReducer(s, { type: 'undo' })
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p2', x: 5, y: 5 })
    expect(s.future).toEqual([])
    // Redo should now be a no-op
    const before = s
    const after = sketchReducer(s, { type: 'redo' })
    expect(after).toBe(before)
  })

  it('undo on an empty history is a no-op (returns same state)', () => {
    const s0 = initialSketchState()
    const s1 = sketchReducer(s0, { type: 'undo' })
    expect(s1).toBe(s0)
  })
})

describe('sketch-state — clear', () => {
  it('clear drops all sketch data + history', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 1, y: 1 })
    s = sketchReducer(s, { type: 'clear' })
    expect(s.sketch).toEqual(emptySketch())
    expect(s.past).toEqual([])
    expect(s.future).toEqual([])
  })

  it('clear on an empty sketch is a no-op (returns same state)', () => {
    const s0 = initialSketchState()
    const s1 = sketchReducer(s0, { type: 'clear' })
    expect(s1).toBe(s0)
  })
})

describe('sketch-state — mergeSolvedPoints', () => {
  it('updates point coords from a solver response', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 0, y: 0 })
    s = sketchReducer(s, {
      type: 'mergeSolvedPoints',
      points: { p1: { x: 3, y: 4 } }
    })
    expect(s.sketch.points['p1']).toMatchObject({ x: 3, y: 4 })
  })

  it('ignores extra ids the renderer does not know about', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 0, y: 0 })
    s = sketchReducer(s, {
      type: 'mergeSolvedPoints',
      points: { p1: { x: 1, y: 1 }, ghost: { x: 9, y: 9 } }
    })
    expect(s.sketch.points).not.toHaveProperty('ghost')
  })

  it('returns the same state when nothing changed', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'p1', x: 2, y: 3 })
    const same = sketchReducer(s, {
      type: 'mergeSolvedPoints',
      points: { p1: { x: 2, y: 3 } }
    })
    expect(same).toBe(s)
  })
})

describe('sketch-state — sketchToDesign adapter', () => {
  it('maps lines to 2-vertex open polylines', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addLine',
      id: 'L',
      start: { id: 'a', x: 0, y: 0 },
      end: { id: 'b', x: 10, y: 0 }
    })
    const d = sketchToDesign(s.sketch)
    expect(d.entities).toHaveLength(1)
    const e = d.entities[0]!
    expect(e.kind).toBe('polyline')
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toEqual(['a', 'b'])
      expect(e.closed).toBe(false)
    }
  })

  it('maps circles using the renderer-side centre coordinates', () => {
    let s = initialSketchState()
    s = sketchReducer(s, {
      type: 'addCircle',
      id: 'C',
      center: { id: 'c', x: 7, y: -3 },
      radius: 4
    })
    const d = sketchToDesign(s.sketch)
    const e = d.entities[0]!
    expect(e.kind).toBe('circle')
    if (e.kind === 'circle') {
      expect(e.cx).toBe(7)
      expect(e.cy).toBe(-3)
      expect(e.r).toBe(4)
    }
  })

  it('inlines distance values under an auto-generated parameter key', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'a', x: 0, y: 0 })
    s = sketchReducer(s, { type: 'addPoint', pointId: 'b', x: 10, y: 0 })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'd1', kind: 'distance', aId: 'a', bId: 'b', value: 15 }
    })
    const d = sketchToDesign(s.sketch)
    const c = d.constraints[0]!
    expect(c.type).toBe('distance')
    if (c.type === 'distance') {
      expect(d.parameters[c.parameterKey]).toBe(15)
    }
  })

  it('translates horizontal / vertical / coincident constraints 1:1', () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'a', x: 0, y: 0 })
    s = sketchReducer(s, { type: 'addPoint', pointId: 'b', x: 5, y: 1 })
    const actions: SketchAction[] = [
      {
        type: 'addConstraint',
        constraint: { id: 'h', kind: 'horizontal', aId: 'a', bId: 'b' }
      },
      {
        type: 'addConstraint',
        constraint: { id: 'v', kind: 'vertical', aId: 'a', bId: 'b' }
      },
      {
        type: 'addConstraint',
        constraint: { id: 'c', kind: 'coincident', aId: 'a', bId: 'b' }
      }
    ]
    for (const a of actions) s = sketchReducer(s, a)
    const d = sketchToDesign(s.sketch)
    const types = d.constraints.map((c) => c.type)
    expect(types).toEqual(['horizontal', 'vertical', 'coincident'])
  })

  it('emits a DesignFileV2 that solver2d.cloneDesign + energy can consume', async () => {
    let s = initialSketchState()
    s = sketchReducer(s, { type: 'addPoint', pointId: 'a', x: 0, y: 0 })
    s = sketchReducer(s, { type: 'addPoint', pointId: 'b', x: 10, y: 1 })
    s = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'h', kind: 'horizontal', aId: 'a', bId: 'b' }
    })
    const { cloneDesign, energy } = await import('./solver2d')
    const d = sketchToDesign(s.sketch)
    const cloned = cloneDesign(d)
    const e = energy(cloned)
    // Initial horizontal violation: (y_a - y_b)^2 == 1.
    expect(e).toBeCloseTo(1, 6)
  })
})

describe('sketch-state — categoriseSolveResult', () => {
  it('returns under-constrained when no constraints are present', () => {
    const s = emptySketch()
    const r = categoriseSolveResult(s, { p1: { x: 0, y: 0 } }, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('under-constrained')
  })

  it('returns over-constrained when residual exceeds the threshold', () => {
    const s: typeof initialSketchState extends () => infer T ? T : never = initialSketchState()
    const sketchWithCon = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'h', kind: 'horizontal', aId: 'a', bId: 'b' }
    })
    const r = categoriseSolveResult(
      sketchWithCon.sketch,
      { p1: { x: 0, y: 0 } },
      SOLVER_OK_RESIDUAL * 10
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('over-constrained')
  })

  it('returns numerical when residual is NaN', () => {
    const s = initialSketchState()
    const sketchWithCon = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'h', kind: 'horizontal', aId: 'a', bId: 'b' }
    })
    const r = categoriseSolveResult(sketchWithCon.sketch, { p1: { x: 1, y: 1 } }, Number.NaN)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('numerical')
  })

  it('returns ok with merged points when residual is small', () => {
    const s = initialSketchState()
    const sketchWithCon = sketchReducer(s, {
      type: 'addConstraint',
      constraint: { id: 'h', kind: 'horizontal', aId: 'a', bId: 'b' }
    })
    const r = categoriseSolveResult(
      sketchWithCon.sketch,
      { p1: { x: 5, y: 5 } },
      SOLVER_OK_RESIDUAL / 10
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.points['p1']).toMatchObject({ x: 5, y: 5 })
  })
})
