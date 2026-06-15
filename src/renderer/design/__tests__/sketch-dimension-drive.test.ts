/**
 * Sketch S4 — pure unit contracts for the driving-dimension engine
 * (`sketch-dimension-drive.ts`). Node env, no React/DOM/IPC.
 *
 * Coverage matrix:
 *   measureDimensionValue — every intent kind; non-circle radial -> null;
 *     missing point/entity -> null; degenerate line/angle -> null.
 *   createDrivingDimension — adds matching dim + constraint + parameter for
 *     every kind; parameter == measured so geometry does NOT move (within 1e-6
 *     after a solve); input never mutated; unique ids don't collide; explicit
 *     parameterKey honoured / rejected on collision; null on unmeasurable.
 *   applyDimensionValue — distance 50->80 pulls points apart; radius edit
 *     changes r; angle edit changes the measured angle; idempotent re-apply is
 *     stable; invalid/zero/annotation-only returns the SAME reference; unknown
 *     id returns same ref.
 *   Module surface — exported functions.
 */

import { describe, expect, it } from 'vitest'
import type { DesignFileV2, SketchEntity, SketchPoint } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import { circleThroughThreePoints } from '../../../shared/sketch-profile'
import { solveSketch } from '../solver2d'
import {
  applyDimensionValue,
  createDrivingDimension,
  measureDimensionValue,
  type DimensionIntent
} from '../sketch-dimension-drive'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function designWith(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

/** Two free points + a connecting open polyline (segment a→b). */
function twoPointSegment(
  a: { x: number; y: number },
  b: { x: number; y: number }
): DesignFileV2 {
  return designWith(
    [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
    { pa: { x: a.x, y: a.y }, pb: { x: b.x, y: b.y } }
  )
}

/** Measured radius of the arc fitted through its three points. */
function arcFitRadius(d: DesignFileV2, startId: string, viaId: string, endId: string): number {
  const s = d.points[startId]!
  const v = d.points[viaId]!
  const e = d.points[endId]!
  const c = circleThroughThreePoints(s.x, s.y, v.x, v.y, e.x, e.y)!
  return c.r
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('sketch-dimension-drive — module surface', () => {
  it('exports the three functions', () => {
    expect(typeof measureDimensionValue).toBe('function')
    expect(typeof createDrivingDimension).toBe('function')
    expect(typeof applyDimensionValue).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// measureDimensionValue
// ---------------------------------------------------------------------------

describe('measureDimensionValue', () => {
  it('linear: Euclidean distance between two points', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 30, y: 40 })
    expect(measureDimensionValue(d, { kind: 'linear', aId: 'pa', bId: 'pb' })).toBeCloseTo(50, 9)
  })

  it('aligned: same Euclidean distance as linear', () => {
    const d = twoPointSegment({ x: 1, y: 2 }, { x: 4, y: 6 })
    expect(measureDimensionValue(d, { kind: 'aligned', aId: 'pa', bId: 'pb' })).toBeCloseTo(5, 9)
  })

  it('radial: circle radius', () => {
    const d = designWith([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 12.5 }])
    expect(measureDimensionValue(d, { kind: 'radial', entityId: 'c' })).toBeCloseTo(12.5, 9)
  })

  it('diameter: 2 * circle radius', () => {
    const d = designWith([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 7 }])
    expect(measureDimensionValue(d, { kind: 'diameter', entityId: 'c' })).toBeCloseTo(14, 9)
  })

  it('radial: arc fit radius (start/via/end on a unit-ish circle)', () => {
    // Semicircle of radius 10 centred at origin: (10,0) via (0,10) to (-10,0).
    const d = designWith([{ id: 'a', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }], {
      s: { x: 10, y: 0 },
      v: { x: 0, y: 10 },
      e: { x: -10, y: 0 }
    })
    expect(measureDimensionValue(d, { kind: 'radial', entityId: 'a' })).toBeCloseTo(10, 6)
    expect(measureDimensionValue(d, { kind: 'diameter', entityId: 'a' })).toBeCloseTo(20, 6)
  })

  it('angular: 90° between perpendicular lines', () => {
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'y'], closed: false }
      ],
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, y: { x: 0, y: 10 } }
    )
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'y' }
    expect(measureDimensionValue(d, intent)).toBeCloseTo(90, 6)
  })

  it('angular: 45° between lines', () => {
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'd'], closed: false }
      ],
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, d: { x: 10, y: 10 } }
    )
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'd' }
    expect(measureDimensionValue(d, intent)).toBeCloseTo(45, 6)
  })

  it('radial on a non-circle entity (polyline) returns null', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 10, y: 0 })
    expect(measureDimensionValue(d, { kind: 'radial', entityId: 'seg' })).toBeNull()
    expect(measureDimensionValue(d, { kind: 'diameter', entityId: 'seg' })).toBeNull()
  })

  it('radial on a missing entity returns null', () => {
    const d = designWith([])
    expect(measureDimensionValue(d, { kind: 'radial', entityId: 'nope' })).toBeNull()
  })

  it('linear with a missing point returns null', () => {
    const d = designWith([], { pa: { x: 0, y: 0 } })
    expect(measureDimensionValue(d, { kind: 'linear', aId: 'pa', bId: 'missing' })).toBeNull()
  })

  it('angular with coincident leg (degenerate) returns null', () => {
    const d = designWith([], { o: { x: 0, y: 0 }, x: { x: 10, y: 0 } })
    // second line a2==b2 -> zero length
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'o' }
    expect(measureDimensionValue(d, intent)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// createDrivingDimension — structure + non-mutation + non-moving
// ---------------------------------------------------------------------------

describe('createDrivingDimension — structure', () => {
  it('linear: adds a linear dimension, a distance constraint, and the param', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })
    expect(res).not.toBeNull()
    const { design, dimensionId, parameterKey } = res!
    const dim = design.dimensions.find((x) => x.id === dimensionId)!
    expect(dim.kind).toBe('linear')
    expect(dim.parameterKey).toBe(parameterKey)
    expect(design.parameters[parameterKey]).toBeCloseTo(50, 9)
    const con = design.constraints.find((c) => c.type === 'distance')
    expect(con).toBeDefined()
    expect(con && 'parameterKey' in con && con.parameterKey).toBe(parameterKey)
  })

  it('radial: adds a radius constraint reading the same param', () => {
    const d = designWith([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 9 }])
    const res = createDrivingDimension(d, { kind: 'radial', entityId: 'c' })!
    const dim = res.design.dimensions.find((x) => x.id === res.dimensionId)!
    expect(dim.kind).toBe('radial')
    expect(res.design.parameters[res.parameterKey]).toBeCloseTo(9, 9)
    const con = res.design.constraints.find((c) => c.type === 'radius')!
    expect('parameterKey' in con && con.parameterKey).toBe(res.parameterKey)
    expect('entityId' in con && con.entityId).toBe('c')
  })

  it('diameter: adds a diameter constraint; param stores 2*r', () => {
    const d = designWith([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 6 }])
    const res = createDrivingDimension(d, { kind: 'diameter', entityId: 'c' })!
    expect(res.design.parameters[res.parameterKey]).toBeCloseTo(12, 9)
    const con = res.design.constraints.find((c) => c.type === 'diameter')!
    expect('parameterKey' in con && con.parameterKey).toBe(res.parameterKey)
  })

  it('angular: adds an angle constraint reading the same param', () => {
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'y'], closed: false }
      ],
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, y: { x: 0, y: 10 } }
    )
    const res = createDrivingDimension(d, {
      kind: 'angular',
      a1Id: 'o',
      b1Id: 'x',
      a2Id: 'o',
      b2Id: 'y'
    })!
    expect(res.design.parameters[res.parameterKey]).toBeCloseTo(90, 6)
    const con = res.design.constraints.find((c) => c.type === 'angle')!
    expect('parameterKey' in con && con.parameterKey).toBe(res.parameterKey)
  })

  it('does NOT mutate the input design', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 20, y: 0 })
    const beforeDims = d.dimensions.length
    const beforeCons = d.constraints.length
    const beforeParams = Object.keys(d.parameters).length
    createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })
    expect(d.dimensions.length).toBe(beforeDims)
    expect(d.constraints.length).toBe(beforeCons)
    expect(Object.keys(d.parameters).length).toBe(beforeParams)
  })

  it('returns null on an unmeasurable intent (radial on a polyline)', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 10, y: 0 })
    expect(createDrivingDimension(d, { kind: 'radial', entityId: 'seg' })).toBeNull()
  })

  it('honours an explicit parameterKey; rejects a colliding one', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 10, y: 0 })
    const ok = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' }, { parameterKey: 'width' })!
    expect(ok.parameterKey).toBe('width')
    expect(ok.design.parameters.width).toBeCloseTo(10, 9)
    // Now a design that already has the key -> reject.
    const collide = createDrivingDimension(ok.design, { kind: 'linear', aId: 'pa', bId: 'pb' }, {
      parameterKey: 'width'
    })
    expect(collide).toBeNull()
  })

  it('generates collision-free ids across repeated creates', () => {
    let d = designWith([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 5 }])
    const r1 = createDrivingDimension(d, { kind: 'radial', entityId: 'c' })!
    d = r1.design
    const r2 = createDrivingDimension(d, { kind: 'diameter', entityId: 'c' })!
    d = r2.design
    expect(r1.parameterKey).not.toBe(r2.parameterKey)
    expect(r1.dimensionId).not.toBe(r2.dimensionId)
    // All dim ids unique, all constraint ids unique, all param keys unique.
    const dimIds = d.dimensions.map((x) => x.id)
    expect(new Set(dimIds).size).toBe(dimIds.length)
    const conIds = d.constraints.map((c) => c.id)
    expect(new Set(conIds).size).toBe(conIds.length)
    const paramKeys = Object.keys(d.parameters)
    expect(new Set(paramKeys).size).toBe(paramKeys.length)
  })
})

// ---------------------------------------------------------------------------
// createDrivingDimension — geometry must NOT move (constraint already satisfied)
// ---------------------------------------------------------------------------

describe('createDrivingDimension — geometry does not move on create', () => {
  it('linear: a solve after create leaves both points within 1e-6', () => {
    const d = twoPointSegment({ x: 3, y: 4 }, { x: 53, y: 4 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    const solved = solveSketch(res.design)
    expect(solved.points.pa!.x).toBeCloseTo(3, 6)
    expect(solved.points.pa!.y).toBeCloseTo(4, 6)
    expect(solved.points.pb!.x).toBeCloseTo(53, 6)
    expect(solved.points.pb!.y).toBeCloseTo(4, 6)
  })

  it('radial: a solve after create leaves the arc fit radius within 1e-6', () => {
    const d = designWith([{ id: 'a', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }], {
      s: { x: 10, y: 0 },
      v: { x: 0, y: 10 },
      e: { x: -10, y: 0 }
    })
    const r0 = arcFitRadius(d, 's', 'v', 'e')
    const res = createDrivingDimension(d, { kind: 'radial', entityId: 'a' })!
    const solved = solveSketch(res.design)
    const r1 = arcFitRadius(solved, 's', 'v', 'e')
    expect(r1).toBeCloseTo(r0, 6)
  })

  it('angular: a solve after create leaves the measured angle within 1e-6', () => {
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'y'], closed: false }
      ],
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, y: { x: 0, y: 10 } }
    )
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'y' }
    const before = measureDimensionValue(d, intent)!
    const res = createDrivingDimension(d, intent)!
    const solved = solveSketch(res.design)
    const after = measureDimensionValue(solved, intent)!
    expect(after).toBeCloseTo(before, 6)
  })
})

// ---------------------------------------------------------------------------
// applyDimensionValue — editing moves geometry
// ---------------------------------------------------------------------------

describe('applyDimensionValue — editing moves geometry', () => {
  it('distance 50 -> 80 pulls the two points apart', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    const before = measureDimensionValue(res.design, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    expect(before).toBeCloseTo(50, 6)

    const edited = applyDimensionValue(res.design, res.dimensionId, 80)
    expect(edited).not.toBe(res.design) // a real edit -> new ref
    const after = measureDimensionValue(edited, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    // Materially closer to 80 than it was, and within a sane tolerance.
    expect(after).toBeGreaterThan(before + 1)
    expect(Math.abs(after - 80)).toBeLessThan(0.5)
    expect(res.design.parameters[res.parameterKey]).toBeCloseTo(50, 6) // input untouched
  })

  it('distance 50 -> 20 pulls the two points together', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    const edited = applyDimensionValue(res.design, res.dimensionId, 20)
    const after = measureDimensionValue(edited, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    expect(after).toBeLessThan(50 - 1)
    expect(Math.abs(after - 20)).toBeLessThan(0.5)
  })

  it('radius edit changes the circle radius toward the target', () => {
    // Circle whose radius the solver drives via its center + a rim point is
    // overkill here; use an arc so the radius truly has DOF in the points.
    const d = designWith([{ id: 'a', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }], {
      s: { x: 10, y: 0 },
      v: { x: 0, y: 10 },
      e: { x: -10, y: 0 }
    })
    const res = createDrivingDimension(d, { kind: 'radial', entityId: 'a' })!
    const r0 = arcFitRadius(res.design, 's', 'v', 'e')
    expect(r0).toBeCloseTo(10, 6)
    const edited = applyDimensionValue(res.design, res.dimensionId, 14)
    const r1 = arcFitRadius(edited, 's', 'v', 'e')
    // Radius grew toward 14.
    expect(r1).toBeGreaterThan(r0 + 0.5)
    expect(r1).toBeLessThanOrEqual(14 + 0.5)
  })

  it('angle edit LANDS the measured angle on the new target (S5.1 exact landing)', () => {
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'y'], closed: false }
      ],
      // start near 90°; leg endpoints are free so the angle can change.
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, y: { x: 0, y: 10 } }
    )
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'y' }
    const res = createDrivingDimension(d, intent)!
    const a0 = measureDimensionValue(res.design, intent)!
    expect(a0).toBeCloseTo(90, 6)
    const edited = applyDimensionValue(res.design, res.dimensionId, 60)
    const a1 = measureDimensionValue(edited, intent)!
    expect(a1).toBeLessThan(a0)
    // The arm-scaled signed-angle objective has a non-vanishing gradient, so a
    // single applyDimensionValue (which re-solves to tolerance) lands the angle
    // ON 60° -- not merely "closer". The old cosine objective plateaued short.
    expect(Math.abs(a1 - 60)).toBeLessThan(1e-2)
  })

  it('angle edit lands a range of targets (acute 30, obtuse 120 & 150) in ONE edit', () => {
    // Build a fresh ~45° wedge per target and confirm exact landing in both
    // directions (opening and closing) and well past 90° into the obtuse range.
    const make = (): DesignFileV2 =>
      designWith(
        [
          { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
          { id: 'l2', kind: 'polyline', pointIds: ['o', 'd'], closed: false }
        ],
        { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, d: { x: 10, y: 10 } } // 45°
      )
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'd' }
    for (const target of [30, 120, 150]) {
      const res = createDrivingDimension(make(), intent)!
      const edited = applyDimensionValue(res.design, res.dimensionId, target)
      const measured = measureDimensionValue(edited, intent)!
      expect(Math.abs(measured - target)).toBeLessThan(1e-2)
    }
  })

  it('a right-angle (90°) driver is stable: re-applying 90 does not drift', () => {
    // Perpendicular-equivalent case. Create at 90°, drive 90° again -> stays at 90.
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'y'], closed: false }
      ],
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, y: { x: 0, y: 10 } }
    )
    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'x', a2Id: 'o', b2Id: 'y' }
    const res = createDrivingDimension(d, intent)!
    const edited = applyDimensionValue(res.design, res.dimensionId, 90)
    expect(Math.abs(measureDimensionValue(edited, intent)! - 90)).toBeLessThan(1e-2)
  })
})

// ---------------------------------------------------------------------------
// applyDimensionValue — idempotence + same-ref short-circuits
// ---------------------------------------------------------------------------

describe('applyDimensionValue — stability + skip paths', () => {
  it('re-applying the same value keeps converging toward the target (stable, monotonic, no overshoot)', () => {
    // The gradient solver runs a bounded 120 iterations per call, so a single
    // edit may not land EXACTLY on the target. Re-applying the same value must
    // (a) move the same direction (toward the target, never past it / away),
    // and (b) take a strictly smaller step than the first — i.e. it settles
    // rather than oscillating or diverging.
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    const len0 = 50
    const once = applyDimensionValue(res.design, res.dimensionId, 80)
    const len1 = measureDimensionValue(once, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    const twice = applyDimensionValue(once, res.dimensionId, 80)
    const len2 = measureDimensionValue(twice, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    // Still approaching from below, never overshooting 80.
    expect(len1).toBeGreaterThan(len0)
    expect(len1).toBeLessThanOrEqual(80 + 1e-6)
    expect(len2).toBeGreaterThanOrEqual(len1 - 1e-6)
    expect(len2).toBeLessThanOrEqual(80 + 1e-6)
    // Second step is no larger than the first — it is settling, not diverging.
    expect(Math.abs(len2 - len1)).toBeLessThanOrEqual(Math.abs(len1 - len0) + 1e-9)
    // And it is at least as close to the target as before.
    expect(Math.abs(len2 - 80)).toBeLessThanOrEqual(Math.abs(len1 - 80) + 1e-9)
  })

  it('repeated re-applies eventually converge to the target within tolerance', () => {
    // Caller can re-trigger the edit (e.g. user presses Enter again) and the
    // solve will continue to tighten — proving the coupling is a true driver.
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    let cur = res.design
    for (let i = 0; i < 8; i++) {
      cur = applyDimensionValue(cur, res.dimensionId, 80)
    }
    const len = measureDimensionValue(cur, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    expect(Math.abs(len - 80)).toBeLessThan(1e-3)
  })

  it('an unknown dimension id returns the SAME reference', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    expect(applyDimensionValue(d, 'no_such_dim', 80)).toBe(d)
  })

  it('an annotation-only dimension (no parameterKey) returns the SAME reference', () => {
    const d: DesignFileV2 = {
      ...twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 }),
      dimensions: [{ id: 'dimA', kind: 'linear', aId: 'pa', bId: 'pb' }]
    }
    expect(applyDimensionValue(d, 'dimA', 80)).toBe(d)
  })

  it('an invalid (NaN) value returns the SAME reference', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    expect(applyDimensionValue(res.design, res.dimensionId, Number.NaN)).toBe(res.design)
  })

  it('a zero / negative length value returns the SAME reference', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    expect(applyDimensionValue(res.design, res.dimensionId, 0)).toBe(res.design)
    expect(applyDimensionValue(res.design, res.dimensionId, -5)).toBe(res.design)
  })

  it('a degenerate angle (0°) returns the SAME reference', () => {
    const d = designWith(
      [
        { id: 'l1', kind: 'polyline', pointIds: ['o', 'x'], closed: false },
        { id: 'l2', kind: 'polyline', pointIds: ['o', 'y'], closed: false }
      ],
      { o: { x: 0, y: 0 }, x: { x: 10, y: 0 }, y: { x: 0, y: 10 } }
    )
    const res = createDrivingDimension(d, {
      kind: 'angular',
      a1Id: 'o',
      b1Id: 'x',
      a2Id: 'o',
      b2Id: 'y'
    })!
    expect(applyDimensionValue(res.design, res.dimensionId, 0)).toBe(res.design)
    expect(applyDimensionValue(res.design, res.dimensionId, 180)).toBe(res.design)
  })

  it('does not mutate the input design on a real edit', () => {
    const d = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const res = createDrivingDimension(d, { kind: 'linear', aId: 'pa', bId: 'pb' })!
    const snapshotXa = res.design.points.pb!.x
    applyDimensionValue(res.design, res.dimensionId, 80)
    expect(res.design.points.pb!.x).toBe(snapshotXa)
  })
})
