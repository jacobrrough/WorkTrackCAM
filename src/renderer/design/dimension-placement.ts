/**
 * Pure state machine for interactive two-click dimension placement in DrawingView.
 *
 * All functions are framework-agnostic and DOM-free. The caller (DrawingView.tsx)
 * drives the machine by calling `startDimensionPlacement` when a toolbar button is
 * clicked, then `advanceDimensionPlacement` on each SVG pointer-down event with the
 * resolved SVG-space coordinate (already mapped through `clientToSvgCoord` and
 * optionally snapped via `resolveSnap`).
 *
 * State transitions:
 *   null                    --startDimensionPlacement(kind)--> { kind, step: 0 }
 *   { kind, step: 0 }       --advanceDimensionPlacement(pt)--> { kind, step: 1, p1 }
 *   { kind, step: 1, p1 }   --advanceDimensionPlacement(pt)--> null  (+ completed result)
 *
 * Pressing a NEW dimension kind while a placement is in progress resets the machine
 * (step 0 of the new kind), discarding any partially-captured p1.
 *
 * Snap-point wiring is LIVE (no longer deferred): DrawingView fetches projected
 * geometry via the `cad.extract_drawing_geometry` sidecar method, feeds the
 * returned snap candidates to `resolveSnap`, and passes the SNAPPED coordinate
 * (or the raw `clientToSvgCoord` output when `resolveSnap` returns null — out of
 * tolerance, no candidates, or Alt-held override) into `advanceDimensionPlacement`.
 * This machine is coordinate-only: it stays agnostic to whether a click was
 * snapped, so a free-cursor click and a snapped click flow through identically.
 *
 * Plan reference: docs/plans/v2-drawing-dimension-snap-to-vertex.md §3 + §7.
 */

import type { DrawingDimensionKind } from './DrawingView'

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

/**
 * The dimension-placement state machine value.
 *
 * `null`         — no active placement (idle; toolbar buttons start a new one).
 * `step: 0`      — waiting for the first click (p1 not yet set).
 * `step: 1`      — p1 locked; waiting for the second click (p2) to complete.
 */
export type DimensionPlacementState =
  | null
  | {
      readonly kind: DrawingDimensionKind
      readonly step: 0
    }
  | {
      readonly kind: DrawingDimensionKind
      readonly step: 1
      readonly p1: { readonly x: number; readonly y: number }
    }

// ---------------------------------------------------------------------------
// Completed result
// ---------------------------------------------------------------------------

/**
 * Emitted when the second click completes a placement.
 * The caller constructs a `DrawingDimensionSpec` from `kind`, `p1`, and `p2`.
 */
export type DimensionPlacementCompleted = {
  readonly kind: DrawingDimensionKind
  readonly p1: { readonly x: number; readonly y: number }
  readonly p2: { readonly x: number; readonly y: number }
}

// ---------------------------------------------------------------------------
// advanceDimensionPlacement result
// ---------------------------------------------------------------------------

export type AdvancePlacementResult = {
  /** Next state after this click. `null` means placement completed (or was cancelled). */
  readonly next: DimensionPlacementState
  /** Defined only on the second click — the caller appends a dimension spec from this. */
  readonly completed?: DimensionPlacementCompleted
}

// ---------------------------------------------------------------------------
// startDimensionPlacement
// ---------------------------------------------------------------------------

/**
 * Begin a new placement sequence for the given dimension kind.
 *
 * Calling this while a placement is already active RESETS the machine to step 0
 * with the new kind — the previous p1 is discarded. This lets the user switch
 * dimension kind mid-flight without needing an explicit cancel action.
 */
export function startDimensionPlacement(kind: DrawingDimensionKind): DimensionPlacementState {
  return { kind, step: 0 }
}

// ---------------------------------------------------------------------------
// advanceDimensionPlacement
// ---------------------------------------------------------------------------

/**
 * Advance the state machine by one pointer click at `clickSvg` (SVG-space coords).
 *
 * Step 0 → 1: records `p1`, returns next state `{ kind, step: 1, p1 }`.
 * Step 1 → done: records `p2`, returns `{ next: null, completed: { kind, p1, p2 } }`.
 *
 * Calling with `state === null` is a no-op that returns `{ next: null }`.
 */
export function advanceDimensionPlacement(
  state: DimensionPlacementState,
  clickSvg: { readonly x: number; readonly y: number }
): AdvancePlacementResult {
  if (state === null) {
    return { next: null }
  }

  if (state.step === 0) {
    // First click: lock p1, advance to step 1.
    const next: DimensionPlacementState = {
      kind: state.kind,
      step: 1,
      p1: { x: clickSvg.x, y: clickSvg.y },
    }
    return { next }
  }

  // step === 1: second click completes the placement.
  const completed: DimensionPlacementCompleted = {
    kind: state.kind,
    p1: state.p1,
    p2: { x: clickSvg.x, y: clickSvg.y },
  }
  return { next: null, completed }
}
