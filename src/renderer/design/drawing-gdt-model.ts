/**
 * Pure, framework-agnostic model layer for associative GD&T feature control
 * frames — the sibling of `drawing-annotation-model.ts` for the dimension path.
 *
 * `DrawingView.tsx` is a thin orchestrator over the functions here: it reuses
 * the SAME two-click anchored-snap machinery dimensions use (the placement
 * state machine + `cad.extract_drawing_geometry` snap points), captures the
 * operator's click, and hands the resolved click + the chosen characteristic /
 * tolerance / datums to {@link buildGdtFrame} to mint an **anchored**
 * `GdtFeatureControlFrame` that is persisted into
 * `drawingSheetSchema.annotations.featureControlFrames`. On every fresh geometry
 * projection it re-runs {@link reanchorGdtFrames} to refresh each frame's
 * resolved position and badge any frame whose anchor link has gone missing.
 *
 * ## Why a separate module
 *
 *  * The renderer's test environment is `node` (no jsdom, no
 *    `@testing-library/react`), so the interactive click→persist→re-resolve
 *    logic cannot be exercised through a rendered component. Extracting the
 *    build + the SVG-frame mapping into pure functions makes the whole GD&T
 *    contract — including the Safety-Rule-4 escaping passthrough — unit-testable
 *    at the model level (`__tests__/DrawingView.gdt.test.tsx`).
 *  * Keeps `DrawingView.tsx` focused on wiring + JSX.
 *
 * ## Safety Rule 4 (stored-XSS) — the escaping boundary
 *
 * Datums and the optional label are operator free-text persisted in
 * `drawing.json` and ultimately injected into `<text>` markup that the renderer
 * drops in via `dangerouslySetInnerHTML`. This module does NOT escape — it is a
 * pure pass-through of the operator's literal strings up to the sidecar, which
 * is the single trust boundary that entity-escapes EVERY datum cell and the
 * label before injection (`engines/cad/cadquery_drawing.py::_build_fcf_svg`).
 * The model-level test pins that a markup-bearing datum / label survives the
 * frame→spec mapping verbatim (so the sidecar still receives — and escapes — the
 * raw string) and is NEVER pre-mangled here, which would mask a regression in
 * the real escaping site.
 *
 * Safety Rule 1: documentation overlays only. Nothing here is read by CAM /
 * G-code / post-processing. Safety Rule 3: no `any`.
 */

import type {
  DrawingDimensionAnchor,
  GdtCharacteristic,
  GdtFeatureControlFrame,
} from '../../shared/drawing-annotation-schema'
import {
  anchorFromClick,
  FREE_ANCHOR_REF_ID,
  resolveAnchor,
  type FreshSnapPoint,
  type ResolvedClick,
} from './drawing-annotation-model'
import { buildSnapIndex } from './drawing-annotation-model'

// ---------------------------------------------------------------------------
// Stable id minting
// ---------------------------------------------------------------------------

/**
 * Monotonic-ish unique id for a freshly placed feature control frame. Combines
 * a kind prefix, a base-36 timestamp, and a per-call counter so two frames
 * placed in the same millisecond never collide. Opaque to the rest of the
 * system — only equality matters.
 */
let gdtIdCounter = 0
export function makeGdtFrameId(): string {
  gdtIdCounter += 1
  return `gdt:${Date.now().toString(36)}:${gdtIdCounter.toString(36)}`
}

// ---------------------------------------------------------------------------
// Anchored-frame builder (one-click placement → GdtFeatureControlFrame)
// ---------------------------------------------------------------------------

/**
 * Options carried alongside the placement click when minting a frame.
 *
 * The persisted {@link GdtFeatureControlFrame} schema carries NO caption field
 * (it is frozen + additive-only), so a placed frame has no operator-supplied
 * label. The operator free-text that DOES reach `<text>` markup — and therefore
 * must be escaped sidecar-side (Safety Rule 4) — is the `datums` list.
 */
export interface GdtFrameOptions {
  /** The geometric characteristic (e.g. `position`, `flatness`). */
  readonly characteristic: GdtCharacteristic
  /** Tolerance-zone size in mm (non-negative). */
  readonly toleranceMm: number
  /** Ordered datum reference letters, primary first. At most 3. Operator free-text. */
  readonly datums?: readonly string[]
}

/**
 * Build an anchored {@link GdtFeatureControlFrame} from a single resolved
 * placement click and the operator-chosen characteristic / tolerance / datums.
 *
 * Like the dimension builders, the click resolves to either a snapped feature
 * (its `sourceId` becomes the anchor `refId`, the live associative link) or a
 * free cursor point (empty `refId` sentinel — associative-inert, never
 * dangling). `placement` defaults to the resolved click coordinate so the frame
 * box renders where the operator clicked; the caller may nudge it later.
 *
 * Datums are copied through verbatim — NOT escaped here. The sidecar is the
 * escaping trust boundary (Safety Rule 4). `datums` is clamped to the schema cap
 * of 3 and empty strings are dropped so the persisted frame parses.
 */
export function buildGdtFrame(
  click: ResolvedClick,
  options: GdtFrameOptions,
): GdtFeatureControlFrame {
  const anchor = anchorFromClick(click)
  const datums = (options.datums ?? [])
    .filter((d) => typeof d === 'string' && d.length > 0)
    .slice(0, 3)
  const frame: GdtFeatureControlFrame = {
    id: makeGdtFrameId(),
    characteristic: options.characteristic,
    toleranceMm: options.toleranceMm,
    datums,
    anchor,
    placement: { x: anchor.cachedPoint.x, y: anchor.cachedPoint.y },
  }
  return frame
}

// ---------------------------------------------------------------------------
// Persisted frame → cad.annotateGdt frame spec
// ---------------------------------------------------------------------------

/**
 * The wire-spec shape consumed by `cad.annotateGdt` (mirrors
 * `CadGdtFrameSpec` in `src/shared/sidecar-protocol.ts`). The renderer maps each
 * persisted, anchored frame to one of these before composing the FCF layer.
 *
 *  * `placement` is the resolved anchor position (sheet-space mm) — the sidecar
 *    treats it as the frame box's top-left, exactly as the frozen contract
 *    documents (`_build_fcf_svg(frame, resolvedAnchor)` → the anchor flows in as
 *    `placement`).
 *  * `datums` are the operator's verbatim strings — the sidecar entity-escapes
 *    them (Safety Rule 4); this mapping must NOT mangle them.
 *
 * `label` is part of the wire contract (the sidecar accepts + escapes one) but a
 * persisted frame carries none, so this mapping never sets it.
 */
export interface GdtFrameSpec {
  readonly characteristic: GdtCharacteristic
  readonly toleranceMm: number
  readonly placement: { readonly x: number; readonly y: number }
  readonly datums?: readonly string[]
}

/**
 * Map a persisted {@link GdtFeatureControlFrame} into the `cad.annotateGdt`
 * frame spec. The frame box is anchored at the resolved anchor `cachedPoint`
 * (refreshed by the last re-anchor pass), so a frame whose feature moved on
 * rebuild stamps at the new spot. Datums pass through verbatim — the sidecar
 * owns escaping (Safety Rule 4); this mapping must NOT mangle them. Pure.
 */
export function gdtFrameToSpec(frame: GdtFeatureControlFrame): GdtFrameSpec {
  return {
    characteristic: frame.characteristic,
    toleranceMm: frame.toleranceMm,
    placement: { x: frame.anchor.cachedPoint.x, y: frame.anchor.cachedPoint.y },
    ...(frame.datums.length > 0 ? { datums: [...frame.datums] } : {}),
  }
}

/** Map a whole list of persisted frames to wire specs (render order preserved). Pure. */
export function gdtFramesToSpecs(
  frames: readonly GdtFeatureControlFrame[],
): GdtFrameSpec[] {
  return frames.map(gdtFrameToSpec)
}

// ---------------------------------------------------------------------------
// Re-anchor-on-reload resolver
// ---------------------------------------------------------------------------

/**
 * A GD&T frame re-resolved against fresh geometry, paired with whether its
 * associative anchor lost its link.
 */
export interface ReanchoredGdtFrame {
  /** The frame with its resolved anchor `cachedPoint` (and `placement`) refreshed. */
  readonly frame: GdtFeatureControlFrame
  /**
   * `true` when the frame's associative anchor `refId` no longer resolves
   * against the fresh geometry. The renderer badges these `dangling` (drawn from
   * the stale `cachedPoint` fallback) so the operator can re-attach them. A free
   * anchor never dangles.
   */
  readonly dangling: boolean
}

/**
 * Re-resolve one persisted frame's anchor against the fresh snap index,
 * refreshing the resolved `cachedPoint` (and the frame `placement`, which tracks
 * the anchor) and flagging the frame `dangling` when the associative anchor lost
 * its link. Free anchors never dangle. Pure — returns a new frame; the input is
 * never mutated.
 */
export function reanchorGdtFrame(
  frame: GdtFeatureControlFrame,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): ReanchoredGdtFrame {
  const { anchor, status } = resolveAnchor(frame.anchor, index)
  if (status === 'resolved') {
    return {
      frame: {
        ...frame,
        anchor,
        // Keep the frame box pinned to its (refreshed) anchor.
        placement: { x: anchor.cachedPoint.x, y: anchor.cachedPoint.y },
      },
      dangling: false,
    }
  }
  // free / dangling: keep the anchor + placement as-is (graceful fallback).
  return { frame: { ...frame, anchor }, dangling: status === 'dangling' }
}

/**
 * Re-resolve a whole list of persisted frames against a fresh snap-point list
 * (typically the `snapPoints` from a fresh `cad.extract_drawing_geometry` call).
 * Returns the refreshed frames plus a parallel set of the ids that are now
 * `dangling`. Pure. The single entry point `DrawingView` calls on every geometry
 * refresh.
 */
export function reanchorGdtFrames(
  frames: readonly GdtFeatureControlFrame[],
  snapPoints: readonly FreshSnapPoint[],
): { frames: GdtFeatureControlFrame[]; danglingIds: ReadonlySet<string> } {
  const index = buildSnapIndex(snapPoints)
  const out: GdtFeatureControlFrame[] = []
  const danglingIds = new Set<string>()
  for (const frame of frames) {
    const { frame: next, dangling } = reanchorGdtFrame(frame, index)
    out.push(next)
    if (dangling) danglingIds.add(next.id)
  }
  return { frames: out, danglingIds }
}

/** Re-export the free-anchor sentinel for callers that classify frame anchors. */
export { FREE_ANCHOR_REF_ID }

/** Test whether a frame's anchor is a live associative link. Pure. */
export function isAssociativeGdtFrame(frame: GdtFeatureControlFrame): boolean {
  return frame.anchor.refId !== FREE_ANCHOR_REF_ID
}

/** Narrow re-export so callers don't need to import the dimension module too. */
export type { DrawingDimensionAnchor }
