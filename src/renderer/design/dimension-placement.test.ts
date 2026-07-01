/**
 * Pure unit tests for `src/renderer/design/dimension-placement.ts`.
 *
 * All tests exercise the state-machine functions only — no React, no DOM, no IPC.
 *
 * Coverage matrix:
 *   startDimensionPlacement — creates step-0 state for each kind.
 *   advanceDimensionPlacement — null no-op; step 0 -> step 1 records p1;
 *     step 1 -> completed with both points, next resets to null;
 *     restarting with a new kind resets the machine;
 *     completed result carries exact coordinates.
 *   Module surface — no `any`; exported types; exported functions.
 */

import { describe, expect, it } from 'vitest'
import {
  startDimensionPlacement,
  advanceDimensionPlacement,
} from './dimension-placement'
import type {
  DimensionPlacementState,
  DimensionPlacementCompleted,
  AdvancePlacementResult,
} from './dimension-placement'
import type { DrawingDimensionKind } from './DrawingView'
import { resolveSnap, DEFAULT_SNAP_TOLERANCE_PX } from './drawing-snap'
import type { SnapPoint } from './drawing-snap'

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('dimension-placement — module surface', () => {
  it('exports startDimensionPlacement as a function', () => {
    expect(typeof startDimensionPlacement).toBe('function')
  })

  it('exports advanceDimensionPlacement as a function', () => {
    expect(typeof advanceDimensionPlacement).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// startDimensionPlacement
// ---------------------------------------------------------------------------

describe('startDimensionPlacement', () => {
  it('returns step: 0 for kind "distance"', () => {
    const state = startDimensionPlacement('distance')
    expect(state).not.toBeNull()
    expect(state!.kind).toBe('distance')
    expect(state!.step).toBe(0)
  })

  it('returns step: 0 for kind "radius"', () => {
    const state = startDimensionPlacement('radius')
    expect(state!.kind).toBe('radius')
    expect(state!.step).toBe(0)
  })

  it('returns step: 0 for kind "diameter"', () => {
    const state = startDimensionPlacement('diameter')
    expect(state!.kind).toBe('diameter')
    expect(state!.step).toBe(0)
  })

  it('returns step: 0 for kind "angle"', () => {
    const state = startDimensionPlacement('angle')
    expect(state!.kind).toBe('angle')
    expect(state!.step).toBe(0)
  })

  it('does not include a p1 field at step 0', () => {
    const state = startDimensionPlacement('distance')
    // At step 0 there is no p1 — the type discriminant enforces this;
    // a runtime check confirms the field is absent.
    expect(state).not.toHaveProperty('p1')
  })
})

// ---------------------------------------------------------------------------
// advanceDimensionPlacement — null no-op
// ---------------------------------------------------------------------------

describe('advanceDimensionPlacement — null state (no-op)', () => {
  it('returns { next: null } when state is null', () => {
    const result: AdvancePlacementResult = advanceDimensionPlacement(null, { x: 10, y: 20 })
    expect(result.next).toBeNull()
    expect(result.completed).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// advanceDimensionPlacement — step 0 -> step 1
// ---------------------------------------------------------------------------

describe('advanceDimensionPlacement — first click (step 0 -> 1)', () => {
  it('records p1 from the click coordinate', () => {
    const state = startDimensionPlacement('distance')
    const result = advanceDimensionPlacement(state, { x: 15, y: 25 })
    expect(result.next).not.toBeNull()
    expect(result.next!.step).toBe(1)
    expect((result.next as { p1: { x: number; y: number } }).p1).toEqual({ x: 15, y: 25 })
  })

  it('preserves the dimension kind through the transition', () => {
    const state = startDimensionPlacement('angle')
    const result = advanceDimensionPlacement(state, { x: 0, y: 0 })
    expect(result.next!.kind).toBe('angle')
  })

  it('does NOT emit a completed result on the first click', () => {
    const state = startDimensionPlacement('distance')
    const result = advanceDimensionPlacement(state, { x: 5, y: 5 })
    expect(result.completed).toBeUndefined()
  })

  it('records fractional coordinates exactly', () => {
    const state = startDimensionPlacement('radius')
    const result = advanceDimensionPlacement(state, { x: 12.75, y: 99.001 })
    const next = result.next as { step: 1; p1: { x: number; y: number } }
    expect(next.p1.x).toBe(12.75)
    expect(next.p1.y).toBe(99.001)
  })
})

// ---------------------------------------------------------------------------
// advanceDimensionPlacement — step 1 -> completed
// ---------------------------------------------------------------------------

describe('advanceDimensionPlacement — second click (step 1 -> completed)', () => {
  it('emits a completed result with both p1 and p2', () => {
    const s0 = startDimensionPlacement('distance')
    const { next: s1 } = advanceDimensionPlacement(s0, { x: 10, y: 20 })
    const { next, completed } = advanceDimensionPlacement(s1, { x: 40, y: 60 })
    expect(next).toBeNull()
    expect(completed).toBeDefined()
    expect(completed!.p1).toEqual({ x: 10, y: 20 })
    expect(completed!.p2).toEqual({ x: 40, y: 60 })
  })

  it('resets next to null after completion', () => {
    const s0 = startDimensionPlacement('diameter')
    const { next: s1 } = advanceDimensionPlacement(s0, { x: 0, y: 0 })
    const { next } = advanceDimensionPlacement(s1, { x: 30, y: 0 })
    expect(next).toBeNull()
  })

  it('preserves kind in the completed result', () => {
    const s0 = startDimensionPlacement('diameter')
    const { next: s1 } = advanceDimensionPlacement(s0, { x: 0, y: 0 })
    const { completed } = advanceDimensionPlacement(s1, { x: 30, y: 0 })
    const c = completed as DimensionPlacementCompleted
    expect(c.kind).toBe('diameter')
  })

  it('carries exact fractional coordinates in completed', () => {
    const s0 = startDimensionPlacement('distance')
    const { next: s1 } = advanceDimensionPlacement(s0, { x: 3.14, y: 2.71 })
    const { completed } = advanceDimensionPlacement(s1, { x: 100.5, y: 200.25 })
    const c = completed as DimensionPlacementCompleted
    expect(c.p1.x).toBe(3.14)
    expect(c.p1.y).toBe(2.71)
    expect(c.p2.x).toBe(100.5)
    expect(c.p2.y).toBe(200.25)
  })
})

// ---------------------------------------------------------------------------
// Restarting with a new kind resets the machine
// ---------------------------------------------------------------------------

describe('startDimensionPlacement — restart discards in-progress state', () => {
  it('resets from step 1 back to step 0 with a new kind', () => {
    const s0 = startDimensionPlacement('distance')
    const { next: s1 } = advanceDimensionPlacement(s0, { x: 50, y: 50 })
    // Operator clicks a different dimension button mid-flight.
    const restarted = startDimensionPlacement('angle')
    expect(restarted!.kind).toBe('angle')
    expect(restarted!.step).toBe(0)
    // The old step-1 state is no longer in play.
    expect(s1!.step).toBe(1) // original reference still exists; new state is fresh
    expect(restarted).not.toHaveProperty('p1')
  })

  it('resets from step 0 to step 0 with the SAME kind (idempotent restart)', () => {
    const s0 = startDimensionPlacement('distance')
    const restarted = startDimensionPlacement('distance')
    expect(restarted!.step).toBe(0)
    expect(restarted!.kind).toBe('distance')
    // startDimensionPlacement always returns a fresh object.
    expect(restarted).not.toBe(s0)
  })
})

// ---------------------------------------------------------------------------
// Type-level: DimensionPlacementState discriminant exhaustiveness
// ---------------------------------------------------------------------------

describe('DimensionPlacementState discriminant', () => {
  it('state at step 0 is not step 1', () => {
    const state: DimensionPlacementState = startDimensionPlacement('radius')
    // This assertion is also the type-narrowing test — TS should enforce it.
    if (state !== null && state.step === 0) {
      expect(state.step).toBe(0)
    } else {
      throw new Error('expected step 0')
    }
  })

  it('state at step 1 has p1', () => {
    const s0 = startDimensionPlacement('radius')
    const { next } = advanceDimensionPlacement(s0, { x: 7, y: 8 })
    if (next !== null && next.step === 1) {
      expect(next.p1).toEqual({ x: 7, y: 8 })
    } else {
      throw new Error('expected step 1')
    }
  })
})

// ---------------------------------------------------------------------------
// DrawingDimensionKind import (type-level surface check)
// ---------------------------------------------------------------------------

describe('DrawingDimensionKind integration', () => {
  it('startDimensionPlacement accepts all four dimension kinds', () => {
    const kinds: readonly DrawingDimensionKind[] = ['distance', 'radius', 'diameter', 'angle']
    for (const kind of kinds) {
      const state = startDimensionPlacement(kind)
      expect(state!.kind).toBe(kind)
    }
  })
})

// ---------------------------------------------------------------------------
// Snap → placement resolution contract
// ---------------------------------------------------------------------------
//
// DrawingView resolves each pointer click to an SVG coordinate, runs
// `resolveSnap` against the snap candidates fetched from
// `cad.extract_drawing_geometry`, and feeds the SNAPPED point (or the raw
// cursor when nothing is in range) into `advanceDimensionPlacement`. These
// tests pin that contract at the boundary the two pure modules share: a
// snapped click commits the snapped coordinate; a free click (no candidate in
// range, or Alt-held override) commits the raw cursor unchanged.

describe('snap → placement resolution', () => {
  // A small candidate set mimicking projected geometry: a vertex at the origin
  // and an arc centre well away from it.
  const candidates: readonly SnapPoint[] = [
    { x: 0, y: 0, kind: 'vertex', sourceId: 'v:origin' },
    { x: 100, y: 100, kind: 'center', sourceId: 'e:hole' },
  ]

  /**
   * Mirror DrawingView's resolve step: snap the cursor, else use it verbatim.
   * DrawingView reads only `.x` / `.y` off the result (`clickSvg.x`,
   * `clickSvg.y`), so the snap result's extra `distanceSvgUnits` / `kind` /
   * `sourceId` fields are inert here — we narrow to the coordinate the machine
   * consumes.
   */
  function resolveClick(
    cursor: { readonly x: number; readonly y: number },
    altHeld: boolean,
  ): { readonly x: number; readonly y: number } {
    const snap = resolveSnap(cursor, candidates, DEFAULT_SNAP_TOLERANCE_PX, altHeld)
    const resolved = snap ?? cursor
    return { x: resolved.x, y: resolved.y }
  }

  it('commits the SNAPPED coordinate when the cursor is within tolerance', () => {
    // Cursor a few SVG units off the origin vertex -> snaps back to (0, 0).
    const c1 = resolveClick({ x: 3, y: 4 }, false) // dist 5 < 12 tolerance
    expect(c1).toEqual({ x: 0, y: 0 })

    const s0 = startDimensionPlacement('distance')
    const { next: s1 } = advanceDimensionPlacement(s0, c1)
    const c2 = resolveClick({ x: 102, y: 99 }, false) // near the centre -> (100,100)
    expect(c2).toEqual({ x: 100, y: 100 })
    const { completed } = advanceDimensionPlacement(s1, c2)
    expect(completed!.p1).toEqual({ x: 0, y: 0 })
    expect(completed!.p2).toEqual({ x: 100, y: 100 })
  })

  it('falls back to the raw cursor when NO candidate is in range', () => {
    // Cursor far from every candidate -> resolveSnap returns null -> free cursor.
    const cursor = { x: 50, y: 50 }
    expect(resolveSnap(cursor, candidates, DEFAULT_SNAP_TOLERANCE_PX, false)).toBeNull()
    const click = resolveClick(cursor, false)
    expect(click).toEqual(cursor)

    const s0 = startDimensionPlacement('distance')
    const { next: s1 } = advanceDimensionPlacement(s0, click)
    const { completed } = advanceDimensionPlacement(s1, resolveClick({ x: 70, y: 70 }, false))
    // Both clicks were out of range: the placement records the raw cursors.
    expect(completed!.p1).toEqual({ x: 50, y: 50 })
    expect(completed!.p2).toEqual({ x: 70, y: 70 })
  })

  it('falls back to the raw cursor when Alt overrides snap (even atop a candidate)', () => {
    // Cursor exactly on the origin vertex, but Alt held -> snap suppressed.
    const cursor = { x: 0, y: 0 }
    const click = resolveClick(cursor, true)
    expect(click).toEqual(cursor)
    expect(resolveSnap(cursor, candidates, DEFAULT_SNAP_TOLERANCE_PX, true)).toBeNull()
  })

  it('falls back to the raw cursor when there are no candidates at all', () => {
    const empty: readonly SnapPoint[] = []
    const cursor = { x: 5, y: 7 }
    expect(resolveSnap(cursor, empty, DEFAULT_SNAP_TOLERANCE_PX, false)).toBeNull()
    const s0 = startDimensionPlacement('radius')
    const { next: s1 } = advanceDimensionPlacement(
      s0,
      resolveSnap(cursor, empty, DEFAULT_SNAP_TOLERANCE_PX, false) ?? cursor,
    )
    expect((s1 as { p1: { x: number; y: number } }).p1).toEqual(cursor)
  })
})
