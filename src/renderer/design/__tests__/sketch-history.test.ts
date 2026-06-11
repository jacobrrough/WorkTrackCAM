/**
 * Sketch S1 — unit pins for the PURE undo/redo seam (`sketch-history.ts`).
 *
 * Covers the contract the surface relies on:
 *   (A) ring behavior — push/undo/redo chains, branch truncation on
 *       edit-after-undo, snapshot cloning (never aliases inputs), limit
 *       eviction (oldest first), empty-stack nulls;
 *   (B) coalescing — same-tag pushes inside the sliding window collapse to ONE
 *       step (a drag's ghosting), different tag / window expiry / breakCoalescing
 *       / plain push / undo all end the run; deterministic via the injected clock;
 *   (C) the pure selection appliers — translateSelectedSketchEntities (the
 *       drag-delta applier) and deleteSelectedSketchEntities (delete +
 *       reference-clean pruning) — including the no-op same-reference returns
 *       the surface uses to skip history pushes.
 *
 * Everything here is framework-free (no DOM), per the repo's node-SSR test
 * convention: the load-bearing logic is pinned as pure functions.
 */

import { describe, expect, it } from 'vitest'
import {
  SKETCH_HISTORY_COALESCE_WINDOW_MS,
  SKETCH_HISTORY_DEFAULT_LIMIT,
  createSketchHistory,
  deleteSelectedSketchEntities,
  translateSelectedSketchEntities
} from '../sketch-history'
import {
  emptyDesign,
  type DesignFileV2,
  type SketchConstraint,
  type SketchDimension,
  type SketchEntity,
  type SketchPoint
} from '../../../shared/design-schema'

// ── fixtures ─────────────────────────────────────────────────────────────────

function rectEntity(id: string, cx = 0, cy = 0): SketchEntity {
  return { id, kind: 'rect', cx, cy, w: 10, h: 10, rotation: 0 }
}

function circleEntity(id: string, cx = 0, cy = 0, r = 5): SketchEntity {
  return { id, kind: 'circle', cx, cy, r }
}

function polylineEntity(id: string, pointIds: string[], closed = true): SketchEntity {
  return { id, kind: 'polyline', pointIds, closed }
}

function makeDesign(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {},
  extras: Partial<Pick<DesignFileV2, 'constraints' | 'dimensions'>> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points, ...extras }
}

/** Recursively freeze, so any in-place mutation throws under ESM strict mode. */
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[k])
    }
  }
  return v
}

const D0 = (): DesignFileV2 => makeDesign([])
const D1 = (): DesignFileV2 => makeDesign([rectEntity('r1')])
const D2 = (): DesignFileV2 => makeDesign([rectEntity('r1'), circleEntity('c1')])
const D3 = (): DesignFileV2 =>
  makeDesign([rectEntity('r1'), circleEntity('c1'), rectEntity('r2', 30, 30)])

// ── (A) ring behavior ────────────────────────────────────────────────────────

describe('createSketchHistory — push / undo / redo ring', () => {
  it('starts empty: nothing to undo or redo, both step calls return null', () => {
    const h = createSketchHistory()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
    expect(h.undoDepth()).toBe(0)
    expect(h.redoDepth()).toBe(0)
    expect(h.undo(D0())).toBeNull()
    expect(h.redo(D0())).toBeNull()
  })

  it('default limit constant matches the documented 100', () => {
    expect(SKETCH_HISTORY_DEFAULT_LIMIT).toBe(100)
  })

  it('walks a push→undo→redo chain returning value-equal snapshots', () => {
    const h = createSketchHistory()
    // Edit 1: d0 → d1 (push the PRE-state d0). Edit 2: d1 → d2.
    h.push(D0())
    h.push(D1())
    expect(h.canUndo()).toBe(true)
    expect(h.undoDepth()).toBe(2)

    const back1 = h.undo(D2()) // live was d2
    expect(back1).toEqual(D1())
    expect(h.canRedo()).toBe(true)

    const back2 = h.undo(back1!)
    expect(back2).toEqual(D0())
    expect(h.canUndo()).toBe(false)
    expect(h.redoDepth()).toBe(2)

    const fwd1 = h.redo(back2!)
    expect(fwd1).toEqual(D1())
    const fwd2 = h.redo(fwd1!)
    expect(fwd2).toEqual(D2()) // the exact live design handed to the first undo
    expect(h.canRedo()).toBe(false)
    expect(h.canUndo()).toBe(true)
  })

  it('snapshots are CLONES — never the same reference as the pushed input', () => {
    const h = createSketchHistory()
    const input = D1()
    h.push(input)
    const out = h.undo(D2())
    expect(out).not.toBe(input)
    expect(out).toEqual(input)
    // Nested structures are cloned too (entities array + records).
    expect(out!.entities).not.toBe(input.entities)
    expect(out!.entities[0]).not.toBe(input.entities[0])
  })

  it('undo stores the live design for redo as a clone (no aliasing)', () => {
    const h = createSketchHistory()
    h.push(D0())
    const live = D1()
    const prev = h.undo(live)
    expect(prev).toEqual(D0())
    const again = h.redo(prev!)
    expect(again).toEqual(live)
    expect(again).not.toBe(live)
  })

  it('truncates the redo branch on edit-after-undo (push clears redo)', () => {
    const h = createSketchHistory()
    h.push(D0())
    h.push(D1())
    h.undo(D2())
    expect(h.canRedo()).toBe(true)
    // New edit from the undone state — the old future is gone.
    h.push(D1())
    expect(h.canRedo()).toBe(false)
    expect(h.redoDepth()).toBe(0)
  })

  it('evicts the OLDEST step beyond the limit', () => {
    const h = createSketchHistory(3)
    const designs = [D0(), D1(), D2(), D3(), makeDesign([rectEntity('r9', 99, 99)])]
    for (const d of designs) h.push(d)
    expect(h.undoDepth()).toBe(3)
    // Newest-first walk returns the last three pushed pre-states …
    expect(h.undo(D0())).toEqual(designs[4])
    expect(h.undo(D0())).toEqual(designs[3])
    expect(h.undo(D0())).toEqual(designs[2])
    // … and the two oldest were evicted.
    expect(h.undo(D0())).toBeNull()
  })

  it('clamps a non-positive limit to 1 (always at least one step)', () => {
    const h = createSketchHistory(0)
    h.push(D0())
    h.push(D1())
    expect(h.undoDepth()).toBe(1)
    expect(h.undo(D2())).toEqual(D1())
  })

  it('never mutates the designs it is given (deep-frozen inputs survive)', () => {
    const h = createSketchHistory()
    const a = deepFreeze(D1())
    const b = deepFreeze(D2())
    const json = JSON.stringify({ a, b })
    h.push(a)
    h.pushCoalesced(a, 'drag')
    const prev = h.undo(b)
    h.redo(prev!)
    expect(JSON.stringify({ a, b })).toBe(json)
  })
})

// ── (B) coalescing ───────────────────────────────────────────────────────────

describe('createSketchHistory — pushCoalesced (drag ghosting → one step)', () => {
  function clockedHistory(limit = 100): { h: ReturnType<typeof createSketchHistory>; tick: (ms: number) => void } {
    let t = 0
    const h = createSketchHistory(limit, { now: () => t })
    return {
      h,
      tick: (ms: number) => {
        t += ms
      }
    }
  }

  it('collapses same-tag pushes inside the window into the FIRST snapshot', () => {
    const { h, tick } = clockedHistory()
    h.pushCoalesced(D0(), 'move:r1') // drag start — pre-drag state
    tick(50)
    h.pushCoalesced(D1(), 'move:r1') // ghost frame
    tick(50)
    h.pushCoalesced(D2(), 'move:r1') // ghost frame
    expect(h.undoDepth()).toBe(1)
    // ONE undo lands back on the pre-drag state.
    expect(h.undo(D3())).toEqual(D0())
  })

  it('a different tag starts a new step', () => {
    const { h, tick } = clockedHistory()
    h.pushCoalesced(D0(), 'move:r1')
    tick(10)
    h.pushCoalesced(D1(), 'move:c1')
    expect(h.undoDepth()).toBe(2)
  })

  it('window expiry ends the gesture (same tag, long pause → new step)', () => {
    const { h, tick } = clockedHistory()
    h.pushCoalesced(D0(), 'move:r1')
    tick(SKETCH_HISTORY_COALESCE_WINDOW_MS + 1)
    h.pushCoalesced(D1(), 'move:r1')
    expect(h.undoDepth()).toBe(2)
  })

  it('the window SLIDES with each accepted continuation', () => {
    const { h, tick } = clockedHistory()
    h.pushCoalesced(D0(), 'move:r1')
    // Three continuations each inside the window of the PREVIOUS event …
    for (let i = 0; i < 3; i++) {
      tick(SKETCH_HISTORY_COALESCE_WINDOW_MS - 10)
      h.pushCoalesced(D1(), 'move:r1')
    }
    // … stay one step even though total elapsed exceeds one window.
    expect(h.undoDepth()).toBe(1)
  })

  it('breakCoalescing forces the next same-tag push into a new step', () => {
    const { h, tick } = clockedHistory()
    h.pushCoalesced(D0(), 'move:r1')
    h.breakCoalescing()
    tick(1)
    h.pushCoalesced(D1(), 'move:r1')
    expect(h.undoDepth()).toBe(2)
  })

  it('a plain push ends the run; undo ends the run', () => {
    const { h, tick } = clockedHistory()
    h.pushCoalesced(D0(), 'move:r1')
    h.push(D1()) // unrelated edit
    tick(1)
    h.pushCoalesced(D2(), 'move:r1')
    expect(h.undoDepth()).toBe(3)

    // Undo resets coalescing: the next same-tag push records again.
    h.undo(D3())
    tick(1)
    h.pushCoalesced(D2(), 'move:r1')
    expect(h.undoDepth()).toBe(3)
    expect(h.canRedo()).toBe(false) // and it truncated the redo branch
  })
})

// ── (C) pure selection appliers ──────────────────────────────────────────────

describe('translateSelectedSketchEntities — the drag-delta applier', () => {
  it('moves center-based kinds (rect/circle) by cx/cy', () => {
    const d = makeDesign([rectEntity('r1', 10, 20), circleEntity('c1', -5, 0)])
    const out = translateSelectedSketchEntities(d, new Set(['r1', 'c1']), 5, -2.5)
    const r = out.entities[0]!
    const c = out.entities[1]!
    expect(r.kind === 'rect' && r.cx === 15 && r.cy === 17.5).toBe(true)
    expect(c.kind === 'circle' && c.cx === 0 && c.cy === -2.5).toBe(true)
  })

  it('moves a polyline by translating its referenced points (others untouched)', () => {
    const d = makeDesign(
      [polylineEntity('p1', ['a', 'b']), rectEntity('r1', 0, 0)],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    )
    const out = translateSelectedSketchEntities(d, new Set(['p1']), 3, 4)
    expect(out.points['a']).toEqual({ x: 3, y: 4 })
    expect(out.points['b']).toEqual({ x: 13, y: 4 })
    // The unselected rect did not move.
    const r = out.entities[1]!
    expect(r.kind === 'rect' && r.cx === 0 && r.cy === 0).toBe(true)
  })

  it('translates a point shared by TWO selected entities exactly once', () => {
    const d = makeDesign(
      [polylineEntity('p1', ['a', 'shared']), polylineEntity('p2', ['shared', 'b'])],
      { a: { x: 0, y: 0 }, shared: { x: 10, y: 10 }, b: { x: 20, y: 0 } }
    )
    const out = translateSelectedSketchEntities(d, new Set(['p1', 'p2']), 5, 0)
    expect(out.points['shared']).toEqual({ x: 15, y: 10 }) // +5, not +10
  })

  it('moves arc endpoints via their point records', () => {
    const arc: SketchEntity = { id: 'a1', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' }
    const d = makeDesign([arc], {
      s: { x: 0, y: 0 },
      v: { x: 5, y: 5 },
      e: { x: 10, y: 0 }
    })
    const out = translateSelectedSketchEntities(d, new Set(['a1']), 1, 1)
    expect(out.points['s']).toEqual({ x: 1, y: 1 })
    expect(out.points['v']).toEqual({ x: 6, y: 6 })
    expect(out.points['e']).toEqual({ x: 11, y: 1 })
  })

  it('translates legacy inline-coordinate polylines', () => {
    const legacy: SketchEntity = {
      id: 'lp1',
      kind: 'polyline',
      points: [
        [0, 0],
        [10, 0]
      ],
      closed: false
    }
    const d = makeDesign([legacy])
    const out = translateSelectedSketchEntities(d, new Set(['lp1']), 2, 3)
    const e = out.entities[0]!
    expect(e.kind === 'polyline' && 'points' in e ? e.points : []).toEqual([
      [2, 3],
      [12, 3]
    ])
  })

  it('returns the SAME reference for no-ops (empty/stale selection, zero or non-finite delta)', () => {
    const d = makeDesign([rectEntity('r1')])
    expect(translateSelectedSketchEntities(d, new Set(), 5, 5)).toBe(d)
    expect(translateSelectedSketchEntities(d, new Set(['ghost']), 5, 5)).toBe(d)
    expect(translateSelectedSketchEntities(d, new Set(['r1']), 0, 0)).toBe(d)
    expect(translateSelectedSketchEntities(d, new Set(['r1']), Number.NaN, 1)).toBe(d)
    expect(translateSelectedSketchEntities(d, new Set(['r1']), 1, Number.POSITIVE_INFINITY)).toBe(d)
  })

  it('never mutates the input design', () => {
    const d = deepFreeze(
      makeDesign([polylineEntity('p1', ['a', 'b']), rectEntity('r1', 1, 2)], {
        a: { x: 0, y: 0 },
        b: { x: 10, y: 0 }
      })
    )
    const json = JSON.stringify(d)
    translateSelectedSketchEntities(d, new Set(['p1', 'r1']), 7, -7)
    expect(JSON.stringify(d)).toBe(json)
  })
})

describe('deleteSelectedSketchEntities — delete + reference-clean pruning', () => {
  it('removes the selected entities and reports their ids', () => {
    const d = makeDesign([rectEntity('r1'), circleEntity('c1'), rectEntity('r2')])
    const out = deleteSelectedSketchEntities(d, new Set(['r1', 'r2']))
    expect(out.design.entities.map((e) => e.id)).toEqual(['c1'])
    expect([...out.removedEntityIds].sort()).toEqual(['r1', 'r2'])
  })

  it('prunes points ONLY the removed entities referenced', () => {
    const d = makeDesign([polylineEntity('p1', ['a', 'b', 'c'])], {
      a: { x: 0, y: 0 },
      b: { x: 10, y: 0 },
      c: { x: 10, y: 10 }
    })
    const out = deleteSelectedSketchEntities(d, new Set(['p1']))
    expect(out.design.points).toEqual({})
    expect([...out.removedPointIds].sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps a point a SURVIVING entity still references', () => {
    const d = makeDesign(
      [polylineEntity('p1', ['a', 'shared']), polylineEntity('p2', ['shared', 'b'])],
      { a: { x: 0, y: 0 }, shared: { x: 5, y: 5 }, b: { x: 10, y: 0 } }
    )
    const out = deleteSelectedSketchEntities(d, new Set(['p1']))
    expect(out.design.points['shared']).toEqual({ x: 5, y: 5 })
    expect(out.design.points['b']).toEqual({ x: 10, y: 0 })
    expect(out.design.points['a']).toBeUndefined()
    expect(out.removedPointIds).toEqual(['a'])
  })

  it('never touches standalone (point-tool) points', () => {
    const d = makeDesign([rectEntity('r1')], { lone: { x: 1, y: 2 } })
    const out = deleteSelectedSketchEntities(d, new Set(['r1']))
    expect(out.design.points['lone']).toEqual({ x: 1, y: 2 })
    expect(out.removedPointIds).toEqual([])
  })

  it('drops constraints anchored to a removed ENTITY id, keeps the rest', () => {
    const constraints: SketchConstraint[] = [
      { id: 'k1', type: 'radius', entityId: 'c1', parameterKey: 'r' },
      { id: 'k2', type: 'concentric', entityAId: 'c1', entityBId: 'c2' },
      { id: 'k3', type: 'radius', entityId: 'c2', parameterKey: 'r2' }
    ]
    const d = makeDesign([circleEntity('c1'), circleEntity('c2')], {}, { constraints })
    const out = deleteSelectedSketchEntities(d, new Set(['c1']))
    expect(out.design.constraints.map((c) => c.id)).toEqual(['k3'])
  })

  it('keeps a removed entity\'s point ALIVE when a surviving constraint references it', () => {
    const constraints: SketchConstraint[] = [
      {
        id: 'k1',
        type: 'coincident',
        a: { pointId: 'a' }, // belongs to the polyline being deleted
        b: { pointId: 'x' } // belongs to the survivor
      }
    ]
    const d = makeDesign(
      [polylineEntity('p1', ['a', 'b']), polylineEntity('p2', ['x', 'y'])],
      {
        a: { x: 0, y: 0 },
        b: { x: 1, y: 0 },
        x: { x: 0, y: 0 },
        y: { x: 2, y: 2 }
      },
      { constraints }
    )
    const out = deleteSelectedSketchEntities(d, new Set(['p1']))
    // `a` survives (constraint still references it); `b` is orphaned.
    expect(out.design.points['a']).toBeDefined()
    expect(out.design.points['b']).toBeUndefined()
    expect(out.design.constraints).toHaveLength(1)
    expect(out.removedPointIds).toEqual(['b'])
  })

  it('drops entity-anchored dimensions of removed entities, keeps point dims + their points', () => {
    const dims: SketchDimension[] = [
      { id: 'd1', kind: 'radial', entityId: 'c1' },
      { id: 'd2', kind: 'linear', aId: 'a', bId: 'b' }
    ]
    const d = makeDesign(
      [circleEntity('c1'), polylineEntity('p1', ['a', 'b'])],
      { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
      { dimensions: dims }
    )
    const out = deleteSelectedSketchEntities(d, new Set(['c1', 'p1']))
    expect(out.design.dimensions.map((x) => x.id)).toEqual(['d2'])
    // The linear dimension keeps its anchor points alive.
    expect(out.design.points['a']).toBeDefined()
    expect(out.design.points['b']).toBeDefined()
  })

  it('returns the SAME design reference (and empty lists) when nothing matches', () => {
    const d = makeDesign([rectEntity('r1')])
    const out = deleteSelectedSketchEntities(d, new Set(['nope']))
    expect(out.design).toBe(d)
    expect(out.removedEntityIds).toEqual([])
    expect(out.removedPointIds).toEqual([])
  })

  it('never mutates the input design', () => {
    const d = deepFreeze(
      makeDesign(
        [polylineEntity('p1', ['a', 'b']), rectEntity('r1')],
        { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
        { constraints: [{ id: 'k', type: 'fix', pointId: 'a' }] }
      )
    )
    const json = JSON.stringify(d)
    deleteSelectedSketchEntities(d, new Set(['p1', 'r1']))
    expect(JSON.stringify(d)).toBe(json)
  })
})
