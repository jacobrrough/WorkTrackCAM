/**
 * Pure, framework-agnostic model layer for associative 2D drawing dimensions.
 *
 * `DrawingView.tsx` (the React surface) is a thin orchestrator over the
 * functions here: it fetches projected geometry via
 * `cad.extract_drawing_geometry`, drives the two-click placement state machine
 * (`dimension-placement.ts`), and then hands the captured clicks to the
 * builders below to mint an **anchored** `DrawingDimension` that is persisted
 * into `drawingSheetSchema.annotations.dimensions`. On reload (or after the
 * part regenerates and a fresh geometry projection arrives) it re-runs
 * {@link reanchorDimensions} to re-resolve every `refId` against the new snap
 * points and badge any dimension whose anchor link has gone missing.
 *
 * ## Why a separate module
 *
 *  * The renderer's test environment is `node` (no jsdom, no
 *    `@testing-library/react`), so the interactive click/persist/re-resolve
 *    logic cannot be exercised through a rendered component. Extracting it into
 *    pure functions makes the whole associativity contract unit-testable
 *    (`__tests__/DrawingView.dimensions.test.tsx`).
 *  * Keeps `DrawingView.tsx` focused on wiring + JSX.
 *
 * ## Associativity contract
 *
 * Each placed click resolves to either:
 *  * a **snap point** carrying a stable `sourceId` (the id of the projected
 *    vertex / edge it came from — see `cad.extract_drawing_geometry`), which
 *    becomes the anchor's `refId` (the live link), OR
 *  * a **free** cursor position with no snap — encoded with an EMPTY `refId`
 *    ({@link FREE_ANCHOR_REF_ID}). A free anchor is never "dangling": there is
 *    nothing to re-resolve, so its `cachedPoint` is authoritative forever.
 *
 * Both cases persist a `cachedPoint` (the resolved `{ x, y }` at placement
 * time), so a reopened sheet always has a coordinate to draw even before a
 * fresh projection arrives — and as the graceful fallback when a `refId` no
 * longer resolves (orphaned anchor → render `stale` rather than drop it).
 *
 * Safety Rule 1: documentation overlays only. Nothing here is read by CAM /
 * G-code / post-processing. Safety Rule 3: no `any`.
 */

import type {
  DrawingCenterMark,
  DrawingCenterline,
  DrawingDimension,
  DrawingDimensionAnchor,
  DrawingLinearOrientation,
  DrawingNote,
  DrawingPoint2D
} from '../../shared/drawing-annotation-schema'

// ---------------------------------------------------------------------------
// Snap-resolved click input
// ---------------------------------------------------------------------------

/**
 * The empty-string sentinel used for a `refId` when a click was placed at a
 * free cursor position with no snap target. A free anchor is associative-inert:
 * {@link resolveAnchor} treats it as permanently resolved to its `cachedPoint`,
 * never `dangling`.
 */
export const FREE_ANCHOR_REF_ID = ''

/**
 * Test whether an anchor is a live associative link (has a non-empty `refId`)
 * versus a free, non-associative point. Pure.
 */
export function isAssociativeAnchor(anchor: DrawingDimensionAnchor): boolean {
  return anchor.refId !== FREE_ANCHOR_REF_ID
}

/**
 * A resolved placement click: the SVG-mm coordinate the operator clicked, plus
 * the `sourceId` of the snap target it landed on (or `null` for a free click).
 *
 * `DrawingView` builds one of these per click from the
 * `cad.extract_drawing_geometry` snap-point result (`sourceId`) and the
 * cursor's SVG coordinate.
 */
export interface ResolvedClick {
  /** Resolved SVG-mm coordinate of the click (snapped or free). */
  readonly point: DrawingPoint2D
  /**
   * `sourceId` of the snapped geometry (the live anchor link), or `null` when
   * the click was free (no snap within tolerance / Alt-override held).
   */
  readonly sourceId: string | null
}

/** Build a {@link DrawingDimensionAnchor} from a resolved click. Pure. */
export function anchorFromClick(click: ResolvedClick): DrawingDimensionAnchor {
  return {
    refId: click.sourceId ?? FREE_ANCHOR_REF_ID,
    cachedPoint: { x: click.point.x, y: click.point.y }
  }
}

// ---------------------------------------------------------------------------
// Stable id minting
// ---------------------------------------------------------------------------

/**
 * Monotonic-ish unique id for a freshly placed dimension. Combines a kind
 * prefix, a base-36 timestamp, and a per-call counter so two dimensions placed
 * in the same millisecond never collide. The id is opaque to the rest of the
 * system — only equality matters.
 */
let dimensionIdCounter = 0
export function makeDimensionId(kind: DrawingDimension['kind']): string {
  dimensionIdCounter += 1
  return `dim:${kind}:${Date.now().toString(36)}:${dimensionIdCounter.toString(36)}`
}

/** Deterministic id for a generated dimension SET (baseline / chain run). */
let setIdCounter = 0
export function makeSetId(prefix: 'baseline' | 'chain'): string {
  setIdCounter += 1
  return `set:${prefix}:${Date.now().toString(36)}:${setIdCounter.toString(36)}`
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure)
// ---------------------------------------------------------------------------

function distance(a: DrawingPoint2D, b: DrawingPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function midpoint(a: DrawingPoint2D, b: DrawingPoint2D): DrawingPoint2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Default dimension-line offset placement: midpoint nudged perpendicular. */
function offsetMidpoint(a: DrawingPoint2D, b: DrawingPoint2D, offset: number): DrawingPoint2D {
  const mid = midpoint(a, b)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: mid.x, y: mid.y - offset }
  // Perpendicular unit vector (rotate the direction 90°).
  const px = -dy / len
  const py = dx / len
  return { x: mid.x + px * offset, y: mid.y + py * offset }
}

/** Interior angle (degrees) at `vertex` between the arms to `a` and `b`. */
function angleDegrees(vertex: DrawingPoint2D, a: DrawingPoint2D, b: DrawingPoint2D): number {
  const a1 = Math.atan2(a.y - vertex.y, a.x - vertex.x)
  const a2 = Math.atan2(b.y - vertex.y, b.x - vertex.x)
  let deg = ((a2 - a1) * 180) / Math.PI
  if (deg < 0) deg += 360
  if (deg > 180) deg = 360 - deg
  return deg
}

/** Default placement offset (SVG-mm) for the dimension line / text. */
export const DEFAULT_DIMENSION_OFFSET = 8

// ---------------------------------------------------------------------------
// Anchored-spec builders (two-click placement → DrawingDimension)
// ---------------------------------------------------------------------------

/**
 * Build a `linear` dimension from two resolved clicks. `value` is the resolved
 * model-mm distance between the two cached points; `placement` defaults to the
 * perpendicular-offset midpoint. `orientation` defaults to `aligned` (true
 * length) — the caller may override for horizontal/vertical.
 */
export function buildLinearDimension(
  start: ResolvedClick,
  end: ResolvedClick,
  options?: { readonly orientation?: DrawingLinearOrientation; readonly label?: string }
): Extract<DrawingDimension, { kind: 'linear' }> {
  const a = anchorFromClick(start)
  const b = anchorFromClick(end)
  return {
    kind: 'linear',
    id: makeDimensionId('linear'),
    orientation: options?.orientation ?? 'aligned',
    start: a,
    end: b,
    value: distance(a.cachedPoint, b.cachedPoint),
    placement: offsetMidpoint(a.cachedPoint, b.cachedPoint, DEFAULT_DIMENSION_OFFSET),
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

/**
 * Build a `radial` dimension. First click is the arc/circle `center`, second
 * is a point `on` the arc. `value` is the radius (center→on distance).
 */
export function buildRadialDimension(
  center: ResolvedClick,
  on: ResolvedClick,
  options?: { readonly label?: string }
): Extract<DrawingDimension, { kind: 'radial' }> {
  const c = anchorFromClick(center)
  const o = anchorFromClick(on)
  return {
    kind: 'radial',
    id: makeDimensionId('radial'),
    center: c,
    on: o,
    value: distance(c.cachedPoint, o.cachedPoint),
    placement: midpoint(c.cachedPoint, o.cachedPoint),
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

/**
 * Build a `diameter` dimension. First click is the circle `center`, second is a
 * point `on` the circle. `value` is the diameter (2× radius).
 */
export function buildDiameterDimension(
  center: ResolvedClick,
  on: ResolvedClick,
  options?: { readonly label?: string }
): Extract<DrawingDimension, { kind: 'diameter' }> {
  const c = anchorFromClick(center)
  const o = anchorFromClick(on)
  return {
    kind: 'diameter',
    id: makeDimensionId('diameter'),
    center: c,
    on: o,
    value: distance(c.cachedPoint, o.cachedPoint) * 2,
    placement: midpoint(c.cachedPoint, o.cachedPoint),
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

/**
 * Build an `angular` dimension from three resolved clicks: `vertex`, `arm1`,
 * `arm2`. `value` is the interior angle in degrees.
 */
export function buildAngularDimension(
  vertex: ResolvedClick,
  arm1: ResolvedClick,
  arm2: ResolvedClick,
  options?: { readonly label?: string }
): Extract<DrawingDimension, { kind: 'angular' }> {
  const v = anchorFromClick(vertex)
  const a1 = anchorFromClick(arm1)
  const a2 = anchorFromClick(arm2)
  return {
    kind: 'angular',
    id: makeDimensionId('angular'),
    vertex: v,
    arm1: a1,
    arm2: a2,
    value: angleDegrees(v.cachedPoint, a1.cachedPoint, a2.cachedPoint),
    placement: { x: v.cachedPoint.x, y: v.cachedPoint.y - DEFAULT_DIMENSION_OFFSET },
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

/**
 * Build a single `ordinate` dimension: a coordinate read-out from `origin`
 * (the datum) to `feature`, along one `axis`. `value` is the signed coordinate
 * delta along that axis. Default `placement` (the leader end / text anchor)
 * offsets perpendicular to the measured axis -- the drafting convention: X
 * read-outs sit on vertical leaders, Y read-outs on horizontal leaders.
 */
export function buildOrdinateDimension(
  origin: ResolvedClick,
  feature: ResolvedClick,
  axis: 'x' | 'y',
  options?: { readonly label?: string }
): Extract<DrawingDimension, { kind: 'ordinate' }> {
  const o = anchorFromClick(origin)
  const f = anchorFromClick(feature)
  const value = axis === 'x' ? f.cachedPoint.x - o.cachedPoint.x : f.cachedPoint.y - o.cachedPoint.y
  return {
    kind: 'ordinate',
    id: makeDimensionId('ordinate'),
    origin: o,
    feature: f,
    axis,
    value,
    placement:
      axis === 'x'
        ? { x: f.cachedPoint.x, y: f.cachedPoint.y - DEFAULT_DIMENSION_OFFSET }
        : { x: f.cachedPoint.x + DEFAULT_DIMENSION_OFFSET, y: f.cachedPoint.y },
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

/**
 * Build a single `baseline` dimension: one member of a baseline (datum) set,
 * measured from the shared `origin` datum to `feature`. `memberIndex` is the
 * member's 0-based position within its set and drives the standard stacked
 * placement (each subsequent dimension line offset one more `stepMm` from the
 * geometry), so an INCREMENTAL run (one click at a time) stacks exactly like
 * a batch {@link expandBaselineSet}. Omitted options mint a fresh setId and
 * place the first row.
 */
export function buildBaselineDimension(
  origin: ResolvedClick,
  feature: ResolvedClick,
  options?: {
    readonly setId?: string
    readonly memberIndex?: number
    readonly stepMm?: number
    readonly label?: string
  }
): Extract<DrawingDimension, { kind: 'baseline' }> {
  const setId = options?.setId ?? makeSetId('baseline')
  const memberIndex = options?.memberIndex ?? 0
  const step = options?.stepMm ?? DEFAULT_DIMENSION_OFFSET
  const o = anchorFromClick(origin)
  const f = anchorFromClick(feature)
  return {
    kind: 'baseline',
    id: makeDimensionId('baseline'),
    origin: o,
    feature: f,
    setId,
    value: distance(o.cachedPoint, f.cachedPoint),
    placement: {
      x: f.cachedPoint.x,
      y: o.cachedPoint.y - step * (memberIndex + 1)
    },
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

/**
 * Build a single `chain` dimension: one segment of a continuous (chained)
 * dimension run between two adjacent anchors. Members of one run share the
 * caller-supplied `setId` (omitted mints a fresh one). Placement is the
 * standard perpendicular-offset midpoint, so consecutive collinear segments
 * align on one row.
 */
export function buildChainDimension(
  start: ResolvedClick,
  end: ResolvedClick,
  options?: { readonly setId?: string; readonly label?: string }
): Extract<DrawingDimension, { kind: 'chain' }> {
  const setId = options?.setId ?? makeSetId('chain')
  const a = anchorFromClick(start)
  const b = anchorFromClick(end)
  return {
    kind: 'chain',
    id: makeDimensionId('chain'),
    start: a,
    end: b,
    setId,
    value: distance(a.cachedPoint, b.cachedPoint),
    placement: offsetMidpoint(a.cachedPoint, b.cachedPoint, DEFAULT_DIMENSION_OFFSET),
    ...(options?.label !== undefined ? { label: options.label } : {})
  }
}

// ---------------------------------------------------------------------------
// Set expanders (baseline / chain / ordinate runs)
// ---------------------------------------------------------------------------

/**
 * Expand a baseline (datum) dimension SET: every feature is dimensioned from a
 * single shared `origin` datum. Returns one `baseline` member per feature, all
 * sharing the generated `setId`. `value` is the straight-line distance from the
 * origin to each feature (model-mm). Placement steps the text out so members
 * stack without overlapping.
 *
 * `origin` is the first click; `features` are the subsequent clicks (order
 * preserved). An empty `features` list yields an empty array.
 */
export function expandBaselineSet(
  origin: ResolvedClick,
  features: readonly ResolvedClick[],
  options?: { readonly setId?: string; readonly stepMm?: number }
): Array<Extract<DrawingDimension, { kind: 'baseline' }>> {
  const setId = options?.setId ?? makeSetId('baseline')
  const step = options?.stepMm ?? DEFAULT_DIMENSION_OFFSET
  return features.map((feat, i) =>
    buildBaselineDimension(origin, feat, { setId, memberIndex: i, stepMm: step })
  )
}

/**
 * Expand a chained (continuous) dimension RUN: consecutive clicks are
 * dimensioned end-to-end (`pᵢ → pᵢ₊₁`). Returns one `chain` member per adjacent
 * pair, all sharing the generated `setId`. `value` is the straight-line
 * distance of each segment.
 *
 * Fewer than two clicks yields an empty array (a chain needs at least one
 * segment).
 */
export function expandChainSet(
  clicks: readonly ResolvedClick[],
  options?: { readonly setId?: string }
): Array<Extract<DrawingDimension, { kind: 'chain' }>> {
  if (clicks.length < 2) return []
  const setId = options?.setId ?? makeSetId('chain')
  const out: Array<Extract<DrawingDimension, { kind: 'chain' }>> = []
  for (let i = 0; i < clicks.length - 1; i++) {
    out.push(buildChainDimension(clicks[i], clicks[i + 1], { setId }))
  }
  return out
}

/**
 * Expand an ordinate dimension SET: every feature is read out from a single
 * shared `origin` datum along the SAME `axis`. Returns one `ordinate` member
 * per feature. (Ordinate dimensions are independent annotations, so there is no
 * `setId` field on the schema; this helper is the convenience batch builder.)
 */
export function expandOrdinateSet(
  origin: ResolvedClick,
  features: readonly ResolvedClick[],
  axis: 'x' | 'y'
): Array<Extract<DrawingDimension, { kind: 'ordinate' }>> {
  return features.map((feat) => buildOrdinateDimension(origin, feat, axis))
}

// ---------------------------------------------------------------------------
// Re-anchor-on-reload resolver
// ---------------------------------------------------------------------------

/**
 * A fresh snap point from a re-projection. `id` is the snap point's own id;
 * `sourceId` is the id of the source vertex/edge it derives from. A persisted
 * anchor's `refId` is matched against BOTH so a dimension stays attached
 * whether it snapped to a vertex/edge directly (`id`) or to a derived snap
 * point (`sourceId`).
 */
export interface FreshSnapPoint {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly sourceId: string
}

/** Outcome of re-resolving one anchor against fresh geometry. */
export interface AnchorResolution {
  /** The anchor after re-resolution (cachedPoint refreshed when resolved). */
  readonly anchor: DrawingDimensionAnchor
  /**
   * `resolved` — refId matched fresh geometry (cachedPoint refreshed).
   * `free`     — non-associative anchor (empty refId); cachedPoint kept as-is.
   * `dangling` — associative refId did NOT match any fresh snap point; the old
   *              cachedPoint is kept as the graceful fallback.
   */
  readonly status: 'resolved' | 'free' | 'dangling'
}

/**
 * Re-resolve a single anchor against a map of fresh snap points keyed by the
 * id(s) an anchor `refId` can match (both the snap point `id` and its
 * `sourceId`). Pure.
 *
 *  * empty `refId` (free)         → `{ anchor unchanged, status: 'free' }`
 *  * `refId` hits the index       → refresh `cachedPoint` to the fresh coord,
 *                                    `status: 'resolved'`
 *  * `refId` misses the index     → keep old `cachedPoint`, `status: 'dangling'`
 */
export function resolveAnchor(
  anchor: DrawingDimensionAnchor,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>
): AnchorResolution {
  if (anchor.refId === FREE_ANCHOR_REF_ID) {
    return { anchor, status: 'free' }
  }
  const hit = index.get(anchor.refId)
  if (hit === undefined) {
    return { anchor, status: 'dangling' }
  }
  return {
    anchor: { refId: anchor.refId, cachedPoint: { x: hit.x, y: hit.y } },
    status: 'resolved'
  }
}

/**
 * Build the lookup index used by {@link resolveAnchor} / {@link reanchorDimensions}
 * from a fresh snap-point list. A snap point is indexed under BOTH its own `id`
 * and its `sourceId` so an anchor that recorded either flavour re-resolves.
 * When two snap points share a key the first wins (stable). Pure.
 */
export function buildSnapIndex(
  snapPoints: readonly FreshSnapPoint[]
): Map<string, { x: number; y: number }> {
  const index = new Map<string, { x: number; y: number }>()
  for (const sp of snapPoints) {
    if (!index.has(sp.id)) index.set(sp.id, { x: sp.x, y: sp.y })
    if (!index.has(sp.sourceId)) index.set(sp.sourceId, { x: sp.x, y: sp.y })
  }
  return index
}

/** The set of anchor field names per dimension kind, in display order. */
const ANCHOR_FIELDS: Record<DrawingDimension['kind'], readonly string[]> = {
  linear: ['start', 'end'],
  radial: ['center', 'on'],
  diameter: ['center', 'on'],
  angular: ['vertex', 'arm1', 'arm2'],
  ordinate: ['origin', 'feature'],
  baseline: ['origin', 'feature'],
  chain: ['start', 'end']
}

/**
 * A dimension re-resolved against fresh geometry, paired with whether any of
 * its associative anchors lost its link.
 */
export interface ReanchoredDimension {
  /** The dimension with every resolved anchor's `cachedPoint` refreshed. */
  readonly dimension: DrawingDimension
  /**
   * `true` when at least one associative anchor's `refId` no longer resolves
   * against the fresh geometry. The renderer badges these `dangling` (drawn
   * from the stale `cachedPoint` fallback) so the operator can re-attach them.
   */
  readonly dangling: boolean
}

/**
 * Re-resolve every anchor of one persisted dimension against the fresh snap
 * index, refreshing resolved `cachedPoint`s and flagging the dimension
 * `dangling` if any associative anchor lost its link. Free anchors never make a
 * dimension dangling. Pure — returns a new dimension object; the input is never
 * mutated.
 */
export function reanchorDimension(
  dimension: DrawingDimension,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>
): ReanchoredDimension {
  const fields = ANCHOR_FIELDS[dimension.kind]
  // Operate on a shallow record copy so we can rewrite the anchor fields
  // without `any`. Every anchor field on the union is a DrawingDimensionAnchor.
  const next: Record<string, unknown> = { ...(dimension as unknown as Record<string, unknown>) }
  let dangling = false
  for (const field of fields) {
    const current = next[field] as DrawingDimensionAnchor
    const { anchor, status } = resolveAnchor(current, index)
    next[field] = anchor
    if (status === 'dangling') dangling = true
  }
  return { dimension: next as unknown as DrawingDimension, dangling }
}

/**
 * Re-resolve a whole list of persisted dimensions against a fresh snap-point
 * list (typically the `snapPoints` from a fresh `cad.extract_drawing_geometry`
 * call). Returns the refreshed dimensions plus a parallel set of the ids that
 * are now `dangling`. Pure.
 *
 * This is the single entry point `DrawingView` calls on reload / after every
 * geometry refresh:
 *
 * ```ts
 * const { dimensions, danglingIds } = reanchorDimensions(persisted, fresh.snapPoints)
 * ```
 */
export function reanchorDimensions(
  dimensions: readonly DrawingDimension[],
  snapPoints: readonly FreshSnapPoint[]
): { dimensions: DrawingDimension[]; danglingIds: ReadonlySet<string> } {
  const index = buildSnapIndex(snapPoints)
  const out: DrawingDimension[] = []
  const danglingIds = new Set<string>()
  for (const dim of dimensions) {
    const { dimension, dangling } = reanchorDimension(dim, index)
    out.push(dimension)
    if (dangling) danglingIds.add(dimension.id)
  }
  return { dimensions: out, danglingIds }
}

// ---------------------------------------------------------------------------
// Free-text notes (general / leader notes)
// ---------------------------------------------------------------------------
//
// The note annotation (`drawingNoteSchema`) follows the SAME persistence +
// associativity pattern as GD&T frames / surface-finish symbols, with two
// differences:
//
//  1. The associative link is OPTIONAL — `note.leader` is a
//     `DrawingDimensionAnchor` when the placement click snapped to a feature
//     (the note points at that feature via a leader line) and absent for a
//     free-floating note block. A note without a leader is associative-inert:
//     it can never dangle.
//  2. The note text is OPERATOR FREE-TEXT rendered by a CLIENT-SIDE SVG
//     emitter ({@link noteToSvg}) — there is no sidecar round-trip, so unlike
//     GD&T datums the escaping trust boundary is HERE. {@link escapeSvgText}
//     entity-escapes every line before it reaches the `<text>` markup the
//     renderer drops in via `dangerouslySetInnerHTML` (Safety Rule 4: a note
//     like `</text><script>` must render as literal text, never as markup).
//
// Safety Rule 1 still holds: documentation overlays only — nothing here is
// read by CAM / G-code / post-processing.

/**
 * Monotonic-ish unique id for a freshly placed note. Combines a kind prefix, a
 * base-36 timestamp, and a per-call counter so two notes placed in the same
 * millisecond never collide. Opaque — only equality matters. (Mirrors
 * `makeGdtFrameId` / `makeSurfaceFinishId`.)
 */
let noteIdCounter = 0
export function makeNoteId(): string {
  noteIdCounter += 1
  return `note:${Date.now().toString(36)}:${noteIdCounter.toString(36)}`
}

/**
 * Offset (SVG-mm) from a snapped leader target to the note text block, so the
 * leader line has visible length and the text does not sit on the geometry.
 * Up-and-right of the target, the drafting-convention default.
 */
export const NOTE_LEADER_OFFSET: DrawingPoint2D = { x: 12, y: -12 }

/**
 * Build an anchored {@link DrawingNote} from a single resolved placement click
 * and the operator's note text.
 *
 *  * Snapped click (`sourceId` non-null) → the snap target becomes the note's
 *    LEADER anchor (`refId` = the live associative link, exactly like a GD&T
 *    frame anchor) and the text block is offset by {@link NOTE_LEADER_OFFSET}
 *    so the leader line is visible.
 *  * Free click → a free-floating note block at the click point, NO leader.
 *
 * The text is stored VERBATIM (schema `z.string()`); escaping happens at the
 * SVG emitter ({@link noteToSvg}), the client-side trust boundary. Pure.
 */
export function buildDrawingNote(click: ResolvedClick, text: string): DrawingNote {
  if (click.sourceId !== null) {
    const leader = anchorFromClick(click)
    return {
      id: makeNoteId(),
      text,
      placement: {
        x: click.point.x + NOTE_LEADER_OFFSET.x,
        y: click.point.y + NOTE_LEADER_OFFSET.y
      },
      leader
    }
  }
  return {
    id: makeNoteId(),
    text,
    placement: { x: click.point.x, y: click.point.y }
  }
}

/** Replace one note's text (per-note edit affordance). Pure — new list, inputs untouched. */
export function updateNoteText(
  notes: readonly DrawingNote[],
  id: string,
  text: string
): DrawingNote[] {
  return notes.map((n) => (n.id === id ? { ...n, text } : n))
}

/** Remove one note by id (per-note delete affordance). Pure — new list, inputs untouched. */
export function removeNote(notes: readonly DrawingNote[], id: string): DrawingNote[] {
  return notes.filter((n) => n.id !== id)
}

/**
 * A note re-resolved against fresh geometry, paired with whether its leader
 * anchor lost its link. (Mirrors `ReanchoredGdtFrame` / `ReanchoredSurfaceFinish`.)
 */
export interface ReanchoredNote {
  /** The note with its resolved leader `cachedPoint` (and placement) refreshed. */
  readonly note: DrawingNote
  /**
   * `true` when the note's associative leader `refId` no longer resolves against
   * the fresh geometry. The renderer badges these `dangling` (drawn from the
   * stale `cachedPoint` fallback). A leaderless or free-anchored note never
   * dangles.
   */
  readonly dangling: boolean
}

/**
 * Re-resolve one persisted note's leader anchor against the fresh snap index.
 * A resolved leader refreshes its `cachedPoint` AND translates the note
 * `placement` by the same delta — the text block keeps the offset the operator
 * gave it, riding along with the feature it points at (unlike GD&T frames,
 * whose placement is pinned to the anchor). Dangling / free leaders keep the
 * stale coordinates as the graceful fallback. Leaderless notes pass through
 * untouched. Pure — returns a new note; the input is never mutated.
 */
export function reanchorNote(
  note: DrawingNote,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>
): ReanchoredNote {
  if (note.leader === undefined) {
    return { note, dangling: false }
  }
  const { anchor, status } = resolveAnchor(note.leader, index)
  if (status === 'resolved') {
    const dx = anchor.cachedPoint.x - note.leader.cachedPoint.x
    const dy = anchor.cachedPoint.y - note.leader.cachedPoint.y
    return {
      note: {
        ...note,
        leader: anchor,
        placement: { x: note.placement.x + dx, y: note.placement.y + dy }
      },
      dangling: false
    }
  }
  // free / dangling: keep the anchor + placement as-is (graceful fallback).
  return { note: { ...note, leader: anchor }, dangling: status === 'dangling' }
}

/**
 * Re-resolve a whole list of persisted notes against a fresh snap-point list
 * (typically the `snapPoints` from a fresh `cad.extract_drawing_geometry`
 * call). Returns the refreshed notes plus a parallel set of the ids that are
 * now `dangling`. Pure. The single entry point `DrawingView` calls on every
 * geometry refresh — the exact sibling of `reanchorGdtFrames` /
 * `reanchorSurfaceFinishes`.
 */
export function reanchorNotes(
  notes: readonly DrawingNote[],
  snapPoints: readonly FreshSnapPoint[]
): { notes: DrawingNote[]; danglingIds: ReadonlySet<string> } {
  const index = buildSnapIndex(snapPoints)
  const out: DrawingNote[] = []
  const danglingIds = new Set<string>()
  for (const note of notes) {
    const { note: next, dangling } = reanchorNote(note, index)
    out.push(next)
    if (dangling) danglingIds.add(next.id)
  }
  return { notes: out, danglingIds }
}

// ---------------------------------------------------------------------------
// Note SVG emitter (client-side composition — the escaping trust boundary)
// ---------------------------------------------------------------------------

/** Note text size (SVG-mm), matching the surface-finish label scale. */
export const NOTE_FONT_SIZE = 3.5
/** Vertical advance per note line (SVG-mm). */
export const NOTE_LINE_HEIGHT = 4.6
/** Approximate glyph advance for the background-box width estimate (SVG-mm). */
const NOTE_CHAR_WIDTH = NOTE_FONT_SIZE * 0.62
/** Horizontal / vertical padding between the text and its backing box (SVG-mm). */
const NOTE_PAD_X = 1.6
const NOTE_PAD_Y = 1.2

/**
 * Entity-escape operator free-text for injection into SVG markup. This is the
 * CLIENT-SIDE escaping trust boundary for the note layer (Safety Rule 4): the
 * composed SVG string is rendered via `dangerouslySetInnerHTML`, so React's JSX
 * escaping never sees it — every interpolated text node MUST pass through here.
 * Order matters: `&` first, so already-escaped entities are not double-broken.
 * Pure.
 */
export function escapeSvgText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Format a finite number for SVG markup with bounded precision (3 dp, trailing
 * zeros trimmed). `NaN`/`Infinity` collapse to `0` so the emitted geometry is
 * always valid. Markup-safe (digits/dot/minus). (Local sibling of the
 * surface-finish module's private formatter.)
 */
function svgNum(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(3)).toString()
}

/**
 * Split note text into render lines. Handles `\r\n` / `\r` / `\n`; an empty
 * string yields one empty line so the note box never collapses to nothing.
 */
export function noteTextLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return lines.length === 0 ? [''] : lines
}

/**
 * Emit one note as a self-contained SVG `<g>` fragment:
 *
 *  * a subtle backing box (`currentColor` at low opacity) sized to the text,
 *    with `note.placement` as its TOP-LEFT corner,
 *  * one `<text>` element per line (multi-line notes stack down the box),
 *    every line entity-escaped by {@link escapeSvgText},
 *  * when `note.leader` is present: a leader line from the box edge nearest the
 *    target to `leader.cachedPoint`, with a small dot at the target. A dangling
 *    leader draws dashed.
 *
 * The fragment carries `data-note-id` and, when `dangling`, the
 * `drawing-note--dangling` class + `data-note-dangling="true"` (the exact
 * surface-finish dangling-badge analogue). Coordinates are SVG-mm sheet space.
 * Pure: same input → byte-identical output.
 */
export function noteToSvg(
  note: DrawingNote,
  options?: { readonly dangling?: boolean }
): string {
  const dangling = options?.dangling === true
  const lines = noteTextLines(note.text)
  const maxChars = lines.reduce((m, l) => Math.max(m, l.length), 1)
  const boxX = note.placement.x
  const boxY = note.placement.y
  const boxW = maxChars * NOTE_CHAR_WIDTH + 2 * NOTE_PAD_X
  const boxH = lines.length * NOTE_LINE_HEIGHT + 2 * NOTE_PAD_Y

  const parts: string[] = []

  // Leader first so the box + text paint on top of the line.
  if (note.leader !== undefined) {
    const target = note.leader.cachedPoint
    // Attach the leader to the box edge nearest the target.
    let attachX = boxX + boxW / 2
    let attachY = boxY + boxH / 2
    if (target.x <= boxX) {
      attachX = boxX
    } else if (target.x >= boxX + boxW) {
      attachX = boxX + boxW
    } else if (target.y <= boxY) {
      attachY = boxY
    } else {
      attachY = boxY + boxH
    }
    const dash = dangling ? ' stroke-dasharray="1.5 1"' : ''
    parts.push(
      `<line fill="none" stroke="currentColor" stroke-width="0.3"${dash} x1="${svgNum(attachX)}" y1="${svgNum(attachY)}" x2="${svgNum(target.x)}" y2="${svgNum(target.y)}" />`
    )
    parts.push(
      `<circle fill="currentColor" stroke="none" cx="${svgNum(target.x)}" cy="${svgNum(target.y)}" r="0.7" />`
    )
  }

  // Subtle backing box.
  parts.push(
    `<rect fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-opacity="0.35" stroke-width="0.25" x="${svgNum(boxX)}" y="${svgNum(boxY)}" width="${svgNum(boxW)}" height="${svgNum(boxH)}" />`
  )

  // Text lines — every line entity-escaped (the trust boundary).
  const textCommon = `fill="currentColor" stroke="none" font-size="${svgNum(NOTE_FONT_SIZE)}" font-family="sans-serif" text-anchor="start"`
  lines.forEach((line, i) => {
    const baselineY = boxY + NOTE_PAD_Y + i * NOTE_LINE_HEIGHT + NOTE_FONT_SIZE * 0.85
    parts.push(
      `<text ${textCommon} x="${svgNum(boxX + NOTE_PAD_X)}" y="${svgNum(baselineY)}">${escapeSvgText(line)}</text>`
    )
  })

  const cls = dangling ? 'drawing-note drawing-note--dangling' : 'drawing-note'
  const danglingAttr = dangling ? ' data-note-dangling="true"' : ''
  // The note id is minted internally (makeNoteId) but escape defensively — a
  // hydrated drawing.json could carry an arbitrary string id.
  return `<g class="${cls}" data-note-id="${escapeSvgText(note.id)}"${danglingAttr}>${parts.join('')}</g>`
}

/**
 * Compose every note into one `<g class="drawing-note-layer">` fragment (render
 * order preserved), badging any note whose id is in `danglingIds`. Returns the
 * empty string when there are no notes so the caller can skip composition. Pure.
 */
export function notesLayerSvg(
  notes: readonly DrawingNote[],
  danglingIds?: ReadonlySet<string>
): string {
  if (notes.length === 0) return ''
  const inner = notes
    .map((n) => noteToSvg(n, { dangling: danglingIds?.has(n.id) === true }))
    .join('')
  return `<g class="drawing-note-layer" data-testid="design-drawing-note-layer">${inner}</g>`
}

/**
 * Splice the note `<g>` layer into an existing projection SVG, just before the
 * closing `</svg>` so it paints on top of the linework + dimension + GD&T +
 * surface-finish layers. When the SVG has no `</svg>` close tag (defensive) the
 * layer is appended. When there are no notes the input SVG is returned
 * unchanged. Pure. (Mirrors `composeSurfaceFinishIntoSvg`.)
 */
export function composeNotesIntoSvg(
  svg: string,
  notes: readonly DrawingNote[],
  danglingIds?: ReadonlySet<string>
): string {
  const layer = notesLayerSvg(notes, danglingIds)
  if (layer === '') return svg
  const closeIdx = svg.lastIndexOf('</svg>')
  if (closeIdx === -1) return svg + layer
  return svg.slice(0, closeIdx) + layer + svg.slice(closeIdx)
}

/** Test whether a note has a live associative leader link. Pure. */
export function isAssociativeNote(note: DrawingNote): boolean {
  return note.leader !== undefined && note.leader.refId !== FREE_ANCHOR_REF_ID
}

// ---------------------------------------------------------------------------
// Center marks + centerlines (drafting crosshair + chain-dashed line)
// ---------------------------------------------------------------------------
//
// Both annotations follow the SAME persistence + associativity pattern as
// notes / surface-finish symbols: anchored to snap points via
// `drawingDimensionAnchorSchema` (`refId` live link + `cachedPoint` fallback),
// re-resolved against fresh geometry on every re-projection (dangling badge),
// and composed into the drawing CLIENT-SIDE as pure SVG `<g>` overlays.
// Neither carries free text -- every emitted attribute is a number or an
// internally-minted id -- so (unlike notes) there is no Safety-Rule-4 escaping
// surface here, though ids are still escaped defensively (a hydrated
// drawing.json could carry an arbitrary string id).
//
// Safety Rule 1 still holds: documentation overlays only -- nothing here is
// read by CAM / G-code / post-processing.

/**
 * Monotonic-ish unique id for a freshly placed center mark. Mirrors
 * `makeNoteId`. Opaque -- only equality matters.
 */
let centerMarkIdCounter = 0
export function makeCenterMarkId(): string {
  centerMarkIdCounter += 1
  return `cmark:${Date.now().toString(36)}:${centerMarkIdCounter.toString(36)}`
}

/** Monotonic-ish unique id for a freshly placed centerline. */
let centerlineIdCounter = 0
export function makeCenterlineId(): string {
  centerlineIdCounter += 1
  return `cline:${Date.now().toString(36)}:${centerlineIdCounter.toString(36)}`
}

/** Default crosshair half-extent (SVG-mm) for a freshly placed center mark. */
export const DEFAULT_CENTER_MARK_SIZE_MM = 3

/**
 * Standard drafting proportions of the center-mark crosshair, as fractions of
 * `sizeMm` (the half-extent). Each leg is drawn as ONE line of length
 * `2 x sizeMm` with a five-entry dash pattern -- long leg, gap, short center
 * dash (straddling the center exactly), gap, long leg -- whose entries sum to
 * the full line length so the pattern paints exactly once:
 * 0.7 + 0.15 + 0.3 + 0.15 + 0.7 = 2.
 */
export const CENTER_MARK_LONG_RATIO = 0.7
export const CENTER_MARK_GAP_RATIO = 0.15
export const CENTER_MARK_CENTER_DASH_RATIO = 0.3

/** How far (SVG-mm) a centerline extends past each of its two anchors. */
export const CENTERLINE_EXTENSION_MM = 3

/**
 * ISO / ASME chain (center) line dash pattern: long dash, gap, short dash,
 * gap -- repeating. SVG-mm units.
 */
export const CENTERLINE_DASH_PATTERN = '6 1.5 1.5 1.5'

/**
 * Build an anchored {@link DrawingCenterMark} from a single resolved placement
 * click (typically snapped to a `center`-kind snap point -- the hole / bore /
 * arc center). A free click mints a free (non-associative) mark at the cursor
 * point -- honest placement, never fabricated geometry. `sizeMm` falls back to
 * {@link DEFAULT_CENTER_MARK_SIZE_MM}; a non-finite / non-positive override is
 * coerced to the default so the schema (`positive()`) always accepts the
 * result. Pure aside from id minting.
 */
export function buildCenterMark(
  click: ResolvedClick,
  options?: { readonly sizeMm?: number }
): DrawingCenterMark {
  const requested = options?.sizeMm
  const sizeMm =
    requested !== undefined && Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_CENTER_MARK_SIZE_MM
  return {
    id: makeCenterMarkId(),
    anchor: anchorFromClick(click),
    sizeMm
  }
}

/**
 * Build an anchored {@link DrawingCenterline} from the two resolved clicks of
 * the two-click placement flow (first click = `start`, second = `end`). Either
 * click may be free (empty refId) -- a free endpoint is associative-inert and
 * never dangles. Pure aside from id minting.
 */
export function buildCenterline(start: ResolvedClick, end: ResolvedClick): DrawingCenterline {
  return {
    id: makeCenterlineId(),
    start: anchorFromClick(start),
    end: anchorFromClick(end)
  }
}

/** Remove one center mark by id (per-item delete affordance). Pure -- new list, inputs untouched. */
export function removeCenterMark(
  marks: readonly DrawingCenterMark[],
  id: string
): DrawingCenterMark[] {
  return marks.filter((m) => m.id !== id)
}

/** Remove one centerline by id (per-item delete affordance). Pure -- new list, inputs untouched. */
export function removeCenterline(
  lines: readonly DrawingCenterline[],
  id: string
): DrawingCenterline[] {
  return lines.filter((l) => l.id !== id)
}

/**
 * A center mark re-resolved against fresh geometry, paired with whether its
 * anchor lost its link. (Mirrors `ReanchoredNote`.)
 */
export interface ReanchoredCenterMark {
  /** The mark with a resolved anchor's `cachedPoint` refreshed. */
  readonly mark: DrawingCenterMark
  /** `true` when the associative anchor `refId` no longer resolves. */
  readonly dangling: boolean
}

/**
 * Re-resolve one persisted center mark's anchor against the fresh snap index.
 * A resolved anchor refreshes its `cachedPoint` (the mark draws AT the anchor,
 * so nothing else moves); a dangling anchor keeps the stale coordinate as the
 * graceful fallback; a free anchor never dangles. Pure -- returns a new mark;
 * the input is never mutated.
 */
export function reanchorCenterMark(
  mark: DrawingCenterMark,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>
): ReanchoredCenterMark {
  const { anchor, status } = resolveAnchor(mark.anchor, index)
  return { mark: { ...mark, anchor }, dangling: status === 'dangling' }
}

/**
 * Re-resolve a whole list of persisted center marks against a fresh snap-point
 * list. Returns the refreshed marks plus the set of ids that are now
 * `dangling`. Pure. The exact sibling of `reanchorNotes`.
 */
export function reanchorCenterMarks(
  marks: readonly DrawingCenterMark[],
  snapPoints: readonly FreshSnapPoint[]
): { centerMarks: DrawingCenterMark[]; danglingIds: ReadonlySet<string> } {
  const index = buildSnapIndex(snapPoints)
  const out: DrawingCenterMark[] = []
  const danglingIds = new Set<string>()
  for (const mark of marks) {
    const { mark: next, dangling } = reanchorCenterMark(mark, index)
    out.push(next)
    if (dangling) danglingIds.add(next.id)
  }
  return { centerMarks: out, danglingIds }
}

/**
 * A centerline re-resolved against fresh geometry, paired with whether EITHER
 * endpoint anchor lost its link.
 */
export interface ReanchoredCenterline {
  /** The centerline with every resolved anchor's `cachedPoint` refreshed. */
  readonly centerline: DrawingCenterline
  /** `true` when at least one associative endpoint `refId` no longer resolves. */
  readonly dangling: boolean
}

/**
 * Re-resolve one persisted centerline's two endpoint anchors against the fresh
 * snap index. Each resolved anchor refreshes its `cachedPoint`; a dangling
 * anchor keeps the stale coordinate; free anchors never dangle. The line is
 * `dangling` when EITHER associative endpoint lost its link. Pure.
 */
export function reanchorCenterline(
  line: DrawingCenterline,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>
): ReanchoredCenterline {
  const start = resolveAnchor(line.start, index)
  const end = resolveAnchor(line.end, index)
  return {
    centerline: { ...line, start: start.anchor, end: end.anchor },
    dangling: start.status === 'dangling' || end.status === 'dangling'
  }
}

/**
 * Re-resolve a whole list of persisted centerlines against a fresh snap-point
 * list. Returns the refreshed lines plus the set of ids that are now
 * `dangling`. Pure. The exact sibling of `reanchorCenterMarks`.
 */
export function reanchorCenterlines(
  lines: readonly DrawingCenterline[],
  snapPoints: readonly FreshSnapPoint[]
): { centerlines: DrawingCenterline[]; danglingIds: ReadonlySet<string> } {
  const index = buildSnapIndex(snapPoints)
  const out: DrawingCenterline[] = []
  const danglingIds = new Set<string>()
  for (const line of lines) {
    const { centerline: next, dangling } = reanchorCenterline(line, index)
    out.push(next)
    if (dangling) danglingIds.add(next.id)
  }
  return { centerlines: out, danglingIds }
}

// ---------------------------------------------------------------------------
// Center-mark / centerline SVG emitters (client-side composition)
// ---------------------------------------------------------------------------

/**
 * Emit one center mark as a self-contained SVG `<g>` fragment: two
 * perpendicular chain-dashed lines crossing at `anchor.cachedPoint`, each of
 * total length `2 x sizeMm`, dashed with the standard drafting long / gap /
 * short-center-dash / gap / long pattern (see the `CENTER_MARK_*_RATIO`
 * constants -- the entries sum to the line length so the pattern paints
 * exactly once, with the short dash straddling the center).
 *
 * The fragment carries `data-center-mark-id` and, when `dangling`, the
 * `drawing-center-mark--dangling` class + `data-center-mark-dangling="true"`
 * + halved stroke opacity (the note dangling-badge analogue). `currentColor`
 * styling throughout. Coordinates are SVG-mm sheet space. Pure: same input ->
 * byte-identical output.
 */
export function centerMarkToSvg(
  mark: DrawingCenterMark,
  options?: { readonly dangling?: boolean }
): string {
  const dangling = options?.dangling === true
  const x = mark.anchor.cachedPoint.x
  const y = mark.anchor.cachedPoint.y
  const s = mark.sizeMm
  const dash = [
    CENTER_MARK_LONG_RATIO * s,
    CENTER_MARK_GAP_RATIO * s,
    CENTER_MARK_CENTER_DASH_RATIO * s,
    CENTER_MARK_GAP_RATIO * s,
    CENTER_MARK_LONG_RATIO * s
  ]
    .map(svgNum)
    .join(' ')
  const opacity = dangling ? ' stroke-opacity="0.5"' : ''
  const lineCommon = `fill="none" stroke="currentColor" stroke-width="0.25" stroke-dasharray="${dash}"${opacity}`
  const horizontal = `<line ${lineCommon} x1="${svgNum(x - s)}" y1="${svgNum(y)}" x2="${svgNum(x + s)}" y2="${svgNum(y)}" />`
  const vertical = `<line ${lineCommon} x1="${svgNum(x)}" y1="${svgNum(y - s)}" x2="${svgNum(x)}" y2="${svgNum(y + s)}" />`
  const cls = dangling
    ? 'drawing-center-mark drawing-center-mark--dangling'
    : 'drawing-center-mark'
  const danglingAttr = dangling ? ' data-center-mark-dangling="true"' : ''
  return `<g class="${cls}" data-center-mark-id="${escapeSvgText(mark.id)}"${danglingAttr}>${horizontal}${vertical}</g>`
}

/**
 * Emit one centerline as a self-contained SVG `<g>` fragment: a single
 * chain-dashed ({@link CENTERLINE_DASH_PATTERN}) line through both anchors,
 * extended {@link CENTERLINE_EXTENSION_MM} past each end along the line
 * direction (the drafting convention -- a centerline overshoots the features
 * it relates). A degenerate zero-length line falls back to the +x direction so
 * the emitted geometry stays valid. Dangling: modifier class + data attr +
 * halved stroke opacity. `currentColor` styling. Pure.
 */
export function centerlineToSvg(
  line: DrawingCenterline,
  options?: { readonly dangling?: boolean }
): string {
  const dangling = options?.dangling === true
  const a = line.start.cachedPoint
  const b = line.end.cachedPoint
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const ux = len === 0 ? 1 : dx / len
  const uy = len === 0 ? 0 : dy / len
  const x1 = a.x - ux * CENTERLINE_EXTENSION_MM
  const y1 = a.y - uy * CENTERLINE_EXTENSION_MM
  const x2 = b.x + ux * CENTERLINE_EXTENSION_MM
  const y2 = b.y + uy * CENTERLINE_EXTENSION_MM
  const opacity = dangling ? ' stroke-opacity="0.5"' : ''
  const cls = dangling ? 'drawing-centerline drawing-centerline--dangling' : 'drawing-centerline'
  const danglingAttr = dangling ? ' data-centerline-dangling="true"' : ''
  return `<g class="${cls}" data-centerline-id="${escapeSvgText(line.id)}"${danglingAttr}><line fill="none" stroke="currentColor" stroke-width="0.25" stroke-dasharray="${CENTERLINE_DASH_PATTERN}"${opacity} x1="${svgNum(x1)}" y1="${svgNum(y1)}" x2="${svgNum(x2)}" y2="${svgNum(y2)}" /></g>`
}

/**
 * Compose every center mark into one `<g class="drawing-center-mark-layer">`
 * fragment (render order preserved), badging any mark whose id is in
 * `danglingIds`. Empty string when there are no marks. Pure.
 */
export function centerMarksLayerSvg(
  marks: readonly DrawingCenterMark[],
  danglingIds?: ReadonlySet<string>
): string {
  if (marks.length === 0) return ''
  const inner = marks
    .map((m) => centerMarkToSvg(m, { dangling: danglingIds?.has(m.id) === true }))
    .join('')
  return `<g class="drawing-center-mark-layer" data-testid="design-drawing-center-mark-layer">${inner}</g>`
}

/**
 * Compose every centerline into one `<g class="drawing-centerline-layer">`
 * fragment (render order preserved), badging any line whose id is in
 * `danglingIds`. Empty string when there are no lines. Pure.
 */
export function centerlinesLayerSvg(
  lines: readonly DrawingCenterline[],
  danglingIds?: ReadonlySet<string>
): string {
  if (lines.length === 0) return ''
  const inner = lines
    .map((l) => centerlineToSvg(l, { dangling: danglingIds?.has(l.id) === true }))
    .join('')
  return `<g class="drawing-centerline-layer" data-testid="design-drawing-centerline-layer">${inner}</g>`
}

/**
 * Splice the center-mark `<g>` layer into an existing projection SVG, just
 * before the closing `</svg>` (appended when the close tag is missing --
 * defensive). Unchanged input when there are no marks. Pure. (Mirrors
 * `composeNotesIntoSvg`.)
 */
export function composeCenterMarksIntoSvg(
  svg: string,
  marks: readonly DrawingCenterMark[],
  danglingIds?: ReadonlySet<string>
): string {
  const layer = centerMarksLayerSvg(marks, danglingIds)
  if (layer === '') return svg
  const closeIdx = svg.lastIndexOf('</svg>')
  if (closeIdx === -1) return svg + layer
  return svg.slice(0, closeIdx) + layer + svg.slice(closeIdx)
}

/**
 * Splice the centerline `<g>` layer into an existing projection SVG, just
 * before the closing `</svg>` (appended when the close tag is missing --
 * defensive). Unchanged input when there are no lines. Pure.
 */
export function composeCenterlinesIntoSvg(
  svg: string,
  lines: readonly DrawingCenterline[],
  danglingIds?: ReadonlySet<string>
): string {
  const layer = centerlinesLayerSvg(lines, danglingIds)
  if (layer === '') return svg
  const closeIdx = svg.lastIndexOf('</svg>')
  if (closeIdx === -1) return svg + layer
  return svg.slice(0, closeIdx) + layer + svg.slice(closeIdx)
}

/** Test whether a center mark has a live associative anchor link. Pure. */
export function isAssociativeCenterMark(mark: DrawingCenterMark): boolean {
  return mark.anchor.refId !== FREE_ANCHOR_REF_ID
}

// ---------------------------------------------------------------------------
// Set-based dimension runs (ordinate / baseline / chain) -- pure run machine
// ---------------------------------------------------------------------------
//
// The Phase-5 drawings toolbar arms one of four run tools (Ordinate X,
// Ordinate Y, Baseline, Chain). Unlike the fixed two-click machine in
// `dimension-placement.ts`, a RUN is open-ended: after a priming click (the
// ordinate 0-datum origin / the baseline base feature / the first chain
// point), EVERY subsequent click mints one persisted dimension, until the
// operator ends the run (Esc or re-clicking the armed button -- the caller
// owns termination; this machine only advances). Pure and framework-agnostic
// so the whole flow is unit-testable in the node-env suite; `DrawingView`
// holds the state in a `useState` and feeds resolved clicks through
// {@link advanceDimensionRun}.

/** Axis of an ordinate read-out run. */
export type OrdinateAxis = 'x' | 'y'

/**
 * The in-progress state of one set-based dimension run.
 *
 *  * `ordinate` -- `origin` is the 0-datum (null until the priming click);
 *    every later click mints one ordinate read-out from that SHARED origin
 *    along `axis`. Switching axis mid-run may carry the origin over (the
 *    caller passes it to {@link startOrdinateRun}).
 *  * `baseline` -- `origin` is the shared base feature; `minted` counts the
 *    members already placed so each new member stacks one step further out.
 *  * `chain`    -- `prev` is the last clicked point; each click mints the
 *    `prev -> click` segment and becomes the new `prev`.
 */
export type DimensionRunState =
  | {
      readonly kind: 'ordinate'
      readonly axis: OrdinateAxis
      readonly origin: ResolvedClick | null
    }
  | {
      readonly kind: 'baseline'
      readonly setId: string
      readonly origin: ResolvedClick | null
      readonly minted: number
    }
  | {
      readonly kind: 'chain'
      readonly setId: string
      readonly prev: ResolvedClick | null
    }

/**
 * Arm an ordinate run along `axis`. `origin` seeds an already-picked 0-datum
 * (the axis-switch mid-run case -- the origin is REUSED, the operator does
 * not re-pick it); null waits for the priming click.
 */
export function startOrdinateRun(
  axis: OrdinateAxis,
  origin: ResolvedClick | null = null
): DimensionRunState {
  return { kind: 'ordinate', axis, origin }
}

/** Arm a baseline (datum) run. Mints the set's shared setId up front. */
export function startBaselineRun(): DimensionRunState {
  return { kind: 'baseline', setId: makeSetId('baseline'), origin: null, minted: 0 }
}

/** Arm a chained (continuous) run. Mints the run's shared setId up front. */
export function startChainRun(): DimensionRunState {
  return { kind: 'chain', setId: makeSetId('chain'), prev: null }
}

/** Result of feeding one resolved click into an armed run. */
export interface AdvanceRunResult {
  /** The run state after this click (a run NEVER self-terminates). */
  readonly next: DimensionRunState
  /** The dimension this click minted, or null for a priming click. */
  readonly minted: DrawingDimension | null
}

/**
 * Advance an armed run by one resolved click.
 *
 *  * ordinate: priming click stores the origin; every later click mints one
 *    `ordinate` dimension from the SHARED origin along the run's axis.
 *  * baseline: priming click stores the base; every later click mints one
 *    `baseline` member (shared setId), stacked `minted + 1` steps out.
 *  * chain: priming click stores the first point; every later click mints
 *    the `prev -> click` segment (shared setId) and the click becomes `prev`.
 *
 * Pure aside from id minting inside the builders.
 */
export function advanceDimensionRun(
  state: DimensionRunState,
  click: ResolvedClick
): AdvanceRunResult {
  if (state.kind === 'ordinate') {
    if (state.origin === null) {
      return { next: { ...state, origin: click }, minted: null }
    }
    return { next: state, minted: buildOrdinateDimension(state.origin, click, state.axis) }
  }
  if (state.kind === 'baseline') {
    if (state.origin === null) {
      return { next: { ...state, origin: click }, minted: null }
    }
    const minted = buildBaselineDimension(state.origin, click, {
      setId: state.setId,
      memberIndex: state.minted
    })
    return { next: { ...state, minted: state.minted + 1 }, minted }
  }
  if (state.prev === null) {
    return { next: { ...state, prev: click }, minted: null }
  }
  const minted = buildChainDimension(state.prev, click, { setId: state.setId })
  return { next: { ...state, prev: click }, minted }
}

/** Remove one dimension by id (per-item delete affordance). Pure -- new list, inputs untouched. */
export function removeDimension(
  dimensions: readonly DrawingDimension[],
  id: string
): DrawingDimension[] {
  return dimensions.filter((d) => d.id !== id)
}

// ---------------------------------------------------------------------------
// Ordinate / baseline / chain SVG emitters (client-side composition)
// ---------------------------------------------------------------------------
//
// The sidecar `cad.dimension_drawing` handler renders the four native kinds
// (distance / radius / diameter / angle) and has NO ordinate / baseline /
// chain primitive, so these three kinds compose CLIENT-SIDE as pure `<g>`
// overlays -- the exact centerline / note emitter pattern (same layer +
// compose + splice shape, same dangling badging). They stay on the SAME
// persisted dimension list, the SAME re-anchor pass, and the SAME dangling
// set as every other dimension -- only the paint path differs. The optional
// `label` is operator free-text and is entity-escaped here
// ({@link escapeSvgText}), the client-side trust boundary (Safety Rule 4).

/** Text size (SVG-mm) of the client-side dimension read-outs. */
export const DIMENSION_SET_FONT_SIZE = 3
/** Half-length (SVG-mm) of the oblique end ticks on baseline / chain dimension lines. */
export const DIMENSION_TICK_MM = 1.2
/** Radius (SVG-mm) of the ordinate 0-datum origin marker circle. */
export const ORDINATE_ORIGIN_MARK_R = 1

/**
 * The read-out a set-dimension shows: the escaped operator label override
 * when present, else the measured value (3 dp, trailing zeros trimmed).
 * Escaping here is the trust boundary -- the composed string reaches
 * `dangerouslySetInnerHTML` (Safety Rule 4).
 */
function dimensionSetText(value: number, label: string | undefined): string {
  return escapeSvgText(label !== undefined ? label : svgNum(value))
}

/**
 * Emit one ordinate read-out as a self-contained SVG `<g>` fragment:
 *
 *  * a small circle at the 0-datum origin ({@link ORDINATE_ORIGIN_MARK_R}),
 *  * a dot on the measured feature,
 *  * a short leader from the feature to `placement` (perpendicular to the
 *    measured axis by construction of {@link buildOrdinateDimension}), and
 *  * the read-out text (the signed distance from the origin along the axis,
 *    or the escaped label override) at the leader end.
 *
 * The fragment carries `data-dim-id` / `data-dim-kind` / `data-dim-axis` and,
 * when `dangling`, the `drawing-dim-set--dangling` modifier + data attr +
 * dashed leader + halved stroke opacity (the centerline badge analogue).
 * `currentColor` styling. Coordinates are SVG-mm sheet space. Pure.
 */
export function ordinateDimensionToSvg(
  dim: Extract<DrawingDimension, { kind: 'ordinate' }>,
  options?: { readonly dangling?: boolean }
): string {
  const dangling = options?.dangling === true
  const o = dim.origin.cachedPoint
  const f = dim.feature.cachedPoint
  const p = dim.placement
  const opacity = dangling ? ' stroke-opacity="0.5"' : ''
  const dash = dangling ? ' stroke-dasharray="1.5 1"' : ''
  const parts: string[] = []
  parts.push(
    `<circle fill="none" stroke="currentColor" stroke-width="0.25"${opacity} cx="${svgNum(o.x)}" cy="${svgNum(o.y)}" r="${svgNum(ORDINATE_ORIGIN_MARK_R)}" />`
  )
  parts.push(
    `<circle fill="currentColor" stroke="none" cx="${svgNum(f.x)}" cy="${svgNum(f.y)}" r="0.6" />`
  )
  parts.push(
    `<line fill="none" stroke="currentColor" stroke-width="0.25"${dash}${opacity} x1="${svgNum(f.x)}" y1="${svgNum(f.y)}" x2="${svgNum(p.x)}" y2="${svgNum(p.y)}" />`
  )
  parts.push(
    `<text fill="currentColor" stroke="none" font-size="${svgNum(DIMENSION_SET_FONT_SIZE)}" font-family="sans-serif" text-anchor="middle" x="${svgNum(p.x)}" y="${svgNum(p.y - 1)}">${dimensionSetText(dim.value, dim.label)}</text>`
  )
  const cls = dangling
    ? 'drawing-dim-set drawing-dim-set--ordinate drawing-dim-set--dangling'
    : 'drawing-dim-set drawing-dim-set--ordinate'
  const danglingAttr = dangling ? ' data-dim-dangling="true"' : ''
  return `<g class="${cls}" data-dim-id="${escapeSvgText(dim.id)}" data-dim-kind="ordinate" data-dim-axis="${dim.axis}"${danglingAttr}>${parts.join('')}</g>`
}

/**
 * Shared linear-dimension paintwork for baseline / chain members: extension
 * lines from both measured points out to the dimension-line row (the parallel
 * line through `placement`), the dimension line itself with oblique drafting
 * ticks at both ends, and the read-out text nudged off the line on the
 * placement side. The row is wherever `placement` sits, so baseline members
 * stack by construction (their builder steps `placement` out per member) and
 * collinear chain segments align on one row. A degenerate zero-length span
 * falls back to the +x direction so the emitted geometry stays valid. Pure.
 */
function linearDimensionFragment(
  a: DrawingPoint2D,
  b: DrawingPoint2D,
  placement: DrawingPoint2D,
  text: string,
  dangling: boolean
): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const ux = len === 0 ? 1 : dx / len
  const uy = len === 0 ? 0 : dy / len
  // Perpendicular unit normal (rotate the direction 90 degrees).
  const nx = -uy
  const ny = ux
  // Signed offset from the a-b line to the placement point along the normal.
  const d = (placement.x - a.x) * nx + (placement.y - a.y) * ny
  const a2 = { x: a.x + nx * d, y: a.y + ny * d }
  const b2 = { x: b.x + nx * d, y: b.y + ny * d }
  const opacity = dangling ? ' stroke-opacity="0.5"' : ''
  const dash = dangling ? ' stroke-dasharray="1.5 1"' : ''
  const lineCommon = `fill="none" stroke="currentColor" stroke-width="0.25"${dash}${opacity}`
  const parts: string[] = []
  // Extension lines from the measured points out to the dimension-line row.
  parts.push(
    `<line ${lineCommon} x1="${svgNum(a.x)}" y1="${svgNum(a.y)}" x2="${svgNum(a2.x)}" y2="${svgNum(a2.y)}" />`
  )
  parts.push(
    `<line ${lineCommon} x1="${svgNum(b.x)}" y1="${svgNum(b.y)}" x2="${svgNum(b2.x)}" y2="${svgNum(b2.y)}" />`
  )
  // The dimension line itself.
  parts.push(
    `<line ${lineCommon} x1="${svgNum(a2.x)}" y1="${svgNum(a2.y)}" x2="${svgNum(b2.x)}" y2="${svgNum(b2.y)}" />`
  )
  // Oblique 45-degree drafting ticks at both ends of the dimension line.
  const tx = ((ux + nx) / Math.SQRT2) * DIMENSION_TICK_MM
  const ty = ((uy + ny) / Math.SQRT2) * DIMENSION_TICK_MM
  parts.push(
    `<line ${lineCommon} x1="${svgNum(a2.x - tx)}" y1="${svgNum(a2.y - ty)}" x2="${svgNum(a2.x + tx)}" y2="${svgNum(a2.y + ty)}" />`
  )
  parts.push(
    `<line ${lineCommon} x1="${svgNum(b2.x - tx)}" y1="${svgNum(b2.y - ty)}" x2="${svgNum(b2.x + tx)}" y2="${svgNum(b2.y + ty)}" />`
  )
  // Read-out text just off the dimension line, on the placement side.
  const side = d >= 0 ? 1 : -1
  const textX = (a2.x + b2.x) / 2 + nx * 1.5 * side
  const textY = (a2.y + b2.y) / 2 + ny * 1.5 * side
  parts.push(
    `<text fill="currentColor" stroke="none" font-size="${svgNum(DIMENSION_SET_FONT_SIZE)}" font-family="sans-serif" text-anchor="middle" x="${svgNum(textX)}" y="${svgNum(textY)}">${text}</text>`
  )
  return parts.join('')
}

/**
 * Emit one baseline (datum) member: a linear dimension from the SHARED origin
 * datum to this member's feature, painted on its own stacked row (the
 * builder's `placement` stepping). Carries `data-dim-set` so one whole set is
 * addressable. Dangling badge mirrors the centerline pattern. Pure.
 */
export function baselineDimensionToSvg(
  dim: Extract<DrawingDimension, { kind: 'baseline' }>,
  options?: { readonly dangling?: boolean }
): string {
  const dangling = options?.dangling === true
  const frag = linearDimensionFragment(
    dim.origin.cachedPoint,
    dim.feature.cachedPoint,
    dim.placement,
    dimensionSetText(dim.value, dim.label),
    dangling
  )
  const cls = dangling
    ? 'drawing-dim-set drawing-dim-set--baseline drawing-dim-set--dangling'
    : 'drawing-dim-set drawing-dim-set--baseline'
  const danglingAttr = dangling ? ' data-dim-dangling="true"' : ''
  return `<g class="${cls}" data-dim-id="${escapeSvgText(dim.id)}" data-dim-kind="baseline" data-dim-set="${escapeSvgText(dim.setId)}"${danglingAttr}>${frag}</g>`
}

/**
 * Emit one chained (continuous) segment: a linear dimension between its two
 * adjacent anchors. Carries `data-dim-set` so one whole run is addressable.
 * Dangling badge mirrors the centerline pattern. Pure.
 */
export function chainDimensionToSvg(
  dim: Extract<DrawingDimension, { kind: 'chain' }>,
  options?: { readonly dangling?: boolean }
): string {
  const dangling = options?.dangling === true
  const frag = linearDimensionFragment(
    dim.start.cachedPoint,
    dim.end.cachedPoint,
    dim.placement,
    dimensionSetText(dim.value, dim.label),
    dangling
  )
  const cls = dangling
    ? 'drawing-dim-set drawing-dim-set--chain drawing-dim-set--dangling'
    : 'drawing-dim-set drawing-dim-set--chain'
  const danglingAttr = dangling ? ' data-dim-dangling="true"' : ''
  return `<g class="${cls}" data-dim-id="${escapeSvgText(dim.id)}" data-dim-kind="chain" data-dim-set="${escapeSvgText(dim.setId)}"${danglingAttr}>${frag}</g>`
}

/**
 * Compose every ordinate / baseline / chain member of a dimension list into
 * one `<g class="drawing-dim-set-layer">` fragment (render order preserved),
 * badging any member whose id is in `danglingIds`. The four sidecar-native
 * kinds are SKIPPED (they render through `cad.dimension_drawing`). Empty
 * string when the list holds no set-based members. Pure.
 */
export function dimensionSetsLayerSvg(
  dimensions: readonly DrawingDimension[],
  danglingIds?: ReadonlySet<string>
): string {
  const parts: string[] = []
  for (const dim of dimensions) {
    const dangling = danglingIds?.has(dim.id) === true
    if (dim.kind === 'ordinate') {
      parts.push(ordinateDimensionToSvg(dim, { dangling }))
    } else if (dim.kind === 'baseline') {
      parts.push(baselineDimensionToSvg(dim, { dangling }))
    } else if (dim.kind === 'chain') {
      parts.push(chainDimensionToSvg(dim, { dangling }))
    }
  }
  if (parts.length === 0) return ''
  return `<g class="drawing-dim-set-layer" data-testid="design-drawing-dim-set-layer">${parts.join('')}</g>`
}

/**
 * Splice the set-dimension `<g>` layer into an existing projection SVG, just
 * before the closing `</svg>` (appended when the close tag is missing --
 * defensive). Unchanged input when the list holds no ordinate / baseline /
 * chain members. Pure. (Mirrors `composeCenterlinesIntoSvg`.)
 */
export function composeDimensionSetsIntoSvg(
  svg: string,
  dimensions: readonly DrawingDimension[],
  danglingIds?: ReadonlySet<string>
): string {
  const layer = dimensionSetsLayerSvg(dimensions, danglingIds)
  if (layer === '') return svg
  const closeIdx = svg.lastIndexOf('</svg>')
  if (closeIdx === -1) return svg + layer
  return svg.slice(0, closeIdx) + layer + svg.slice(closeIdx)
}
