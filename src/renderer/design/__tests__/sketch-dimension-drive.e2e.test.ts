/**
 * Sketch S4 — END-TO-END data-level pipeline test (node env, no React/DOM/IPC).
 *
 * The pure engine (`sketch-dimension-drive.ts`), the label-pick geometry
 * (`sketch2d-dimension-pick.ts`), and the surface/canvas wiring each have their
 * own focused suites. THIS file is the seam: it drives the SAME path the live
 * `SketchSurface` runs — the surface-owned `createSketchHistory` ring plus the
 * `createDrivingDimension` / `applyDimensionValue` engine — to prove the whole
 * "click a dimension, retype, geometry re-solves, one undo step" loop works on
 * real data, then round-trips the resulting design through the v2 Zod schema so
 * a driving dimension (params + constraints + dimensions) survives save+reload.
 *
 * It deliberately re-creates the surface's THREE history operations as tiny
 * pure helpers (`applyDesignEdit` / `performUndo` / `performRedo`) that match
 * `SketchSurface.tsx` line-for-line:
 *   applyDesignEdit(next): history.push(live) ; live = next
 *   performUndo():          prev = history.undo(live) ; live = prev
 *   performRedo():          next = history.redo(live) ; live = next
 * so the undo/redo assertions exercise the genuine ring semantics (branch
 * truncation, clone-on-store) the surface relies on, without a DOM the repo's
 * node test env can't provide.
 *
 * NOTE on identity: `sketch-history` defensively DEEP-CLONES every snapshot it
 * stores (the 2D solver mutates point records in place, so storing raw refs
 * would let a later mutation corrupt history). So an undo/redo returns a design
 * that is VALUE-equal to the recorded step, not reference-equal — the
 * assertions below use `toEqual` accordingly, which is exactly what the live
 * surface delivers back through `onDesignChange`.
 */

import { describe, expect, it } from 'vitest'
import {
  designFileSchemaV2,
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from '../../../shared/design-schema'
import { createSketchHistory, type SketchHistory } from '../sketch-history'
import {
  applyDimensionValue,
  createDrivingDimension,
  measureDimensionValue
} from '../sketch-dimension-drive'

// ---------------------------------------------------------------------------
// A tiny model of SketchSurface's history seam (matches SketchSurface.tsx).
// `live` stands in for `liveDesignRef.current` + the session's design prop;
// the helpers mirror applyDesignEdit / performUndo / performRedo exactly.
// ---------------------------------------------------------------------------

interface Surface {
  history: SketchHistory
  live: DesignFileV2
}

function makeSurface(design: DesignFileV2): Surface {
  return { history: createSketchHistory(), live: design }
}

/** SketchSurface.applyDesignEdit: push the PRE-state, then adopt `next`. */
function applyDesignEdit(s: Surface, next: DesignFileV2): void {
  s.history.push(s.live)
  s.live = next
}

/** SketchSurface.performUndo: undo returns the prior snapshot (or null = no-op). */
function performUndo(s: Surface): boolean {
  const prev = s.history.undo(s.live)
  if (prev === null) return false
  s.live = prev
  return true
}

/** SketchSurface.performRedo: redo returns the next snapshot (or null = no-op). */
function performRedo(s: Surface): boolean {
  const next = s.history.redo(s.live)
  if (next === null) return false
  s.live = next
  return true
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function designWith(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

/** Two points pa→pb joined by an open polyline segment (the canonical S4 case). */
function twoPointSegment(
  a: { x: number; y: number },
  b: { x: number; y: number }
): DesignFileV2 {
  return designWith(
    [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }],
    { pa: { x: a.x, y: a.y }, pb: { x: b.x, y: b.y } }
  )
}

function alignedLen(d: DesignFileV2): number {
  return measureDimensionValue(d, { kind: 'aligned', aId: 'pa', bId: 'pb' })!
}

// ---------------------------------------------------------------------------
// 1. The full place → edit → undo → redo loop on real data.
// ---------------------------------------------------------------------------

describe('Sketch S4 — end-to-end: place aligned driving dim, edit, undo, redo', () => {
  it('placing the dimension does not move geometry; editing re-solves; undo/redo are ONE step each', () => {
    // Start: two points 50 mm apart joined by a line.
    const start = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const s = makeSurface(start)
    expect(alignedLen(s.live)).toBeCloseTo(50, 9)

    // --- Place an aligned DRIVING dimension (surface.handlePlaceDimension) ---
    const created = createDrivingDimension(s.live, { kind: 'aligned', aId: 'pa', bId: 'pb' })
    expect(created).not.toBeNull()
    const { dimensionId, parameterKey } = created!
    applyDesignEdit(s, created!.design)

    // param seeded to the measured value -> geometry is UNCHANGED on create.
    expect(s.live.parameters[parameterKey]).toBeCloseTo(50, 9)
    expect(alignedLen(s.live)).toBeCloseTo(50, 9)
    expect(s.live.dimensions).toHaveLength(1)
    expect(s.live.constraints.some((c) => c.type === 'distance')).toBe(true)
    const afterPlace = s.live

    // --- Edit the value to 80 (surface.handleCommitDimensionValue) ---
    const edited = applyDimensionValue(s.live, dimensionId, 80)
    expect(edited).not.toBe(s.live) // a real change -> new ref -> records a step
    applyDesignEdit(s, edited)
    const afterEdit = s.live
    // The two points are now (approximately) the new distance apart.
    expect(alignedLen(s.live)).toBeGreaterThan(51)
    expect(Math.abs(alignedLen(s.live) - 80)).toBeLessThan(0.5)
    expect(s.live.parameters[parameterKey]).toBeCloseTo(80, 6)

    // --- UNDO once -> back to the post-place design (the prior step) ---
    // History clones on store, so the returned design is VALUE-equal (not the
    // same ref) to afterPlace — exactly what the surface re-applies.
    expect(performUndo(s)).toBe(true)
    expect(s.live).toEqual(afterPlace) // one step back, value-identical
    expect(alignedLen(s.live)).toBeCloseTo(50, 9)
    expect(s.live.parameters[parameterKey]).toBeCloseTo(50, 9)

    // --- UNDO again -> back to the original (no dimension at all) ---
    expect(performUndo(s)).toBe(true)
    expect(s.live).toEqual(start)
    expect(s.live.dimensions).toHaveLength(0)
    expect(s.live.constraints).toHaveLength(0)
    expect(alignedLen(s.live)).toBeCloseTo(50, 9)

    // Nothing left to undo.
    expect(s.history.canUndo()).toBe(false)
    expect(performUndo(s)).toBe(false)

    // --- REDO forward -> the dimension comes back, then the 80 mm edit ---
    expect(performRedo(s)).toBe(true)
    expect(s.live).toEqual(afterPlace)
    expect(s.live.dimensions).toHaveLength(1)

    expect(performRedo(s)).toBe(true)
    expect(s.live).toEqual(afterEdit)
    expect(Math.abs(alignedLen(s.live) - 80)).toBeLessThan(0.5)

    // Fully redone.
    expect(s.history.canRedo()).toBe(false)
    expect(performRedo(s)).toBe(false)
  })

  it('a no-op commit (annotation-only / invalid value) records NO step (reference-equality gate)', () => {
    // The surface only calls applyDesignEdit when applyDimensionValue returns a
    // NEW ref. Mirror that gate here and prove the history stays empty.
    const start = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const created = createDrivingDimension(start, { kind: 'aligned', aId: 'pa', bId: 'pb' })!
    const s = makeSurface(created.design)

    // Invalid value -> same ref -> the surface would NOT push.
    const unchanged = applyDimensionValue(s.live, created.dimensionId, Number.NaN)
    expect(unchanged).toBe(s.live)
    if (unchanged !== s.live) applyDesignEdit(s, unchanged) // never taken
    expect(s.history.canUndo()).toBe(false)

    // Zero length -> same ref too.
    expect(applyDimensionValue(s.live, created.dimensionId, 0)).toBe(s.live)
    expect(s.history.canUndo()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. A radial driving dimension on a circle edits its radius.
// ---------------------------------------------------------------------------

describe('Sketch S4 — end-to-end: radial driving dimension on a circle', () => {
  it('places a radius driver (no move on create) and editing drives the radius', () => {
    const start = designWith([{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }])
    const s = makeSurface(start)
    expect(measureDimensionValue(s.live, { kind: 'radial', entityId: 'c' })).toBeCloseTo(10, 9)

    const created = createDrivingDimension(s.live, { kind: 'radial', entityId: 'c' })!
    applyDesignEdit(s, created.design)
    // Create stores the measured radius -> unchanged.
    expect(s.live.parameters[created.parameterKey]).toBeCloseTo(10, 9)
    expect(s.live.constraints.some((c) => c.type === 'radius')).toBe(true)

    // Edit the radius to 18 mm. The circle entity carries its radius directly,
    // so the solver writes the new value straight onto the param the
    // radius-constraint reads; the entity radius reflected on next measure.
    const edited = applyDimensionValue(s.live, created.dimensionId, 18)
    expect(edited).not.toBe(s.live)
    applyDesignEdit(s, edited)
    expect(s.live.parameters[created.parameterKey]).toBeCloseTo(18, 6)

    // Undo returns to the 10 mm post-place state in one step.
    expect(performUndo(s)).toBe(true)
    expect(s.live.parameters[created.parameterKey]).toBeCloseTo(10, 9)
  })
})

// ---------------------------------------------------------------------------
// 3. Persistence round-trip — a driving dimension survives schema serialise/parse.
// ---------------------------------------------------------------------------

describe('Sketch S4 — end-to-end: persistence round-trip via the v2 schema', () => {
  it('a design with parameters + a driving constraint + a dimension re-parses byte-for-byte', () => {
    // Build a driven design exactly as the surface would, then re-solve once so
    // the persisted model carries moved geometry too (the realistic save state).
    const start = twoPointSegment({ x: 0, y: 0 }, { x: 50, y: 0 })
    const created = createDrivingDimension(start, { kind: 'aligned', aId: 'pa', bId: 'pb' })!
    const driven = applyDimensionValue(created.design, created.dimensionId, 70)

    // Persist (session.saveDesign writes JSON) and reload (normalize/parse).
    const onDisk = JSON.parse(JSON.stringify(driven)) as unknown
    const reloaded = designFileSchemaV2.parse(onDisk)

    // The dimension carries its parameterKey; the constraint reads it; the
    // parameter value is preserved; the geometry the solver moved is preserved.
    expect(reloaded.dimensions).toHaveLength(1)
    const dim = reloaded.dimensions[0]!
    expect(dim.kind).toBe('aligned')
    expect(dim.parameterKey).toBe(created.parameterKey)

    const distance = reloaded.constraints.find((c) => c.type === 'distance')!
    expect('parameterKey' in distance && distance.parameterKey).toBe(created.parameterKey)

    expect(reloaded.parameters[created.parameterKey]).toBeCloseTo(
      driven.parameters[created.parameterKey]!,
      9
    )
    // Whole-model fidelity: the parsed design equals the saved one.
    expect(reloaded).toEqual(driven)

    // And the reloaded design is still drivable: editing it re-solves further.
    const editedAgain = applyDimensionValue(reloaded, created.dimensionId, 40)
    expect(editedAgain).not.toBe(reloaded)
    expect(measureDimensionValue(editedAgain, { kind: 'aligned', aId: 'pa', bId: 'pb' })).toBeLessThan(
      measureDimensionValue(reloaded, { kind: 'aligned', aId: 'pa', bId: 'pb' })!
    )
  })

  it('an annotation-only dimension (no parameterKey) also survives the round-trip unchanged', () => {
    // S4 must NOT change annotation-only behavior: a dimension without a
    // parameterKey serialises and re-parses with the field simply absent.
    const design: DesignFileV2 = {
      ...twoPointSegment({ x: 0, y: 0 }, { x: 25, y: 0 }),
      dimensions: [{ id: 'annA', kind: 'linear', aId: 'pa', bId: 'pb' }]
    }
    const reloaded = designFileSchemaV2.parse(JSON.parse(JSON.stringify(design)))
    expect(reloaded.dimensions[0]).toEqual({ id: 'annA', kind: 'linear', aId: 'pa', bId: 'pb' })
    expect('parameterKey' in reloaded.dimensions[0]!).toBe(false)
    // It is still inert as a driver (applyDimensionValue is a no-op).
    expect(applyDimensionValue(reloaded, 'annA', 99)).toBe(reloaded)
  })
})
