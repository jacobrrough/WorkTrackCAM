/**
 * CAD feature-timeline edit actions — pure, framework-agnostic.
 *
 * This is the edit-action -> persisted-state mapping that the FeatureTree
 * timeline UI (`FeatureTree.tsx`) and the session context
 * (`DesignSessionContext.tsx`) both drive. It turns a single operator gesture
 * (reorder a row, toggle suppress, set / clear the roll-back marker) into the
 * NEXT persisted timeline state — the `{ kernelOps, rolledBackTo }` pair that
 * gets written into `part/features.json`.
 *
 * Design tenets (mirror `feature-timeline-resolve.ts`):
 *   1. **No React, no IPC, no Zod here.** A gesture comes in as a plain object;
 *      a `TimelineState` goes out. The component owns the click / drag / key
 *      events and the IPC save (`fab.featuresSave`); the context owns the
 *      in-memory `features` object. This module is the pure pivot between them,
 *      so it is unit-testable in the existing `node` vitest environment with no
 *      jsdom and no live CadQuery round-trip (the sidecar exec path cannot run
 *      CadQuery locally — pre-existing issue #11). The reorder / suppress /
 *      rollback math is proven by the sibling Vitest, not a B-rep build.
 *   2. **Additive-state only.** The two fields this module returns
 *      (`kernelOps` and `rolledBackTo`) are exactly the two ADDITIVE fields the
 *      schema already carries (`kernelOps` is `.optional()`; `rolledBackTo` is
 *      `.optional()` — see `partFeaturesFileSchema`). No version bump, nothing
 *      else touched. A timeline with no edits round-trips byte-for-byte.
 *   3. **Reuse the resolver — never re-implement the math.** Validation of a
 *      multi-row drag funnels through `validateTimelineOrder`; the "what will
 *      actually replay" preview funnels through `resolveTimeline`. This module
 *      only owns the *persistence shape* of an edit, not the replay semantics.
 *
 * Relationship to the build path: the persisted `{ kernelOps, rolledBackTo }`
 * is read back by `build-kernel-part.ts`, which calls
 * `attachKernelPostOpsToPayload` -> `resolveTimeline` to produce the EFFECTIVE
 * `postSolidOps` for the kernel. So an edit committed here and a Build STEP read
 * the SAME resolver — the on-screen preview and the actual build can never
 * disagree about a reorder / suppress / rollback.
 */

import type { KernelPostSolidOp, PartFeatureItem } from '../../shared/part-features-schema'
import {
  resolveTimeline,
  validateTimelineOrder,
  type TimelineOrderValidation
} from './feature-timeline-resolve'

export type { KernelPostSolidOp, PartFeatureItem }

/**
 * The persisted timeline state — exactly the two ADDITIVE fields of
 * `partFeaturesFileSchema` this UI owns. `rolledBackTo` follows the schema's
 * sentinel contract: `undefined` (field absent) or `-1` both mean "build all
 * ops"; an inclusive index `n >= 0` means "replay `kernelOps[0..n]`".
 */
export interface TimelineState {
  readonly kernelOps: ReadonlyArray<KernelPostSolidOp>
  /** Inclusive roll-back index, or `undefined` / `-1` for "no roll-back". */
  readonly rolledBackTo?: number
}

/**
 * A single operator gesture against the timeline. One discriminated union so
 * the component dispatches exactly one shape and the reducer returns exactly
 * one next state.
 *
 *   - `move`        — keyboard "move up / down" (delta ±1), the accessible
 *                     alternative to a drag. Honors the finishing-op rule.
 *   - `reorder`     — a completed drag: move the op at `from` to land at `to`
 *                     (post-removal index). Honors the finishing-op rule.
 *   - `suppress`    — toggle a single op's own `suppressed` flag.
 *   - `update`      — FEATURE RE-EDIT: replace the op at `index` IN PLACE (same
 *                     timeline position) with an edited op. Preserves the
 *                     existing op's `suppressed` flag unless the replacement
 *                     explicitly carries one, keeps the roll-back bar where it
 *                     is (the list length is unchanged), and honors the
 *                     finishing-op rule (a kind change may not land a finishing
 *                     op before a create/boolean/pattern op).
 *   - `setRollback` — drop / move the roll-back bar to an inclusive index.
 *   - `clearRollback` — remove the roll-back bar (back to "build all").
 */
export type TimelineAction =
  | { readonly type: 'move'; readonly index: number; readonly delta: -1 | 1 }
  | { readonly type: 'reorder'; readonly from: number; readonly to: number }
  | { readonly type: 'suppress'; readonly index: number; readonly suppressed: boolean }
  | { readonly type: 'update'; readonly index: number; readonly op: KernelPostSolidOp }
  | { readonly type: 'setRollback'; readonly index: number }
  | { readonly type: 'clearRollback' }

/**
 * Result of applying an action. `changed: false` carries the reason a no-op
 * gesture was rejected (out-of-range index, finishing-op rule, identity move)
 * so the caller can surface it as a status string and SKIP the IPC save — the
 * existing handlers only persist + toast on a real change.
 *
 * `state` is ALWAYS a valid next state: on rejection it is the unchanged input
 * state (referentially equal), so a caller that ignores `changed` still never
 * corrupts the timeline.
 */
export type TimelineActionResult =
  | { readonly changed: true; readonly state: TimelineState; readonly status: string }
  | { readonly changed: false; readonly state: TimelineState; readonly reason: string }

/**
 * Build a permutation index array that moves the element at `from` so it lands
 * at index `to` in the resulting order (the index AFTER removal — i.e. standard
 * "drag row from i, drop at j" semantics). Out-of-range inputs clamp into range
 * so a stray drop coordinate can never throw.
 */
function reorderPermutation(len: number, from: number, to: number): number[] {
  const idx = Array.from({ length: len }, (_, i) => i)
  const f = Math.max(0, Math.min(len - 1, from))
  const t = Math.max(0, Math.min(len - 1, to))
  const [moved] = idx.splice(f, 1)
  idx.splice(t, 0, moved!)
  return idx
}

/**
 * Re-clamp a roll-back marker against a (possibly reordered / shortened) op
 * list. A marker that no longer addresses a row collapses to `undefined`
 * ("build all") rather than silently truncating the build — same stale-pointer
 * safety `resolveTimeline` enforces, applied at persistence time so the value
 * written to disk is always meaningful.
 */
function clampRollback(rolledBackTo: number | undefined, len: number): number | undefined {
  if (rolledBackTo === undefined || rolledBackTo === -1) return undefined
  if (!Number.isInteger(rolledBackTo)) return undefined
  if (rolledBackTo < 0 || rolledBackTo >= len) return undefined
  // A marker at the last row is a no-op cut; normalize to "build all" so the
  // persisted state is canonical (matches resolveTimeline keeping everything).
  if (rolledBackTo === len - 1) return undefined
  return rolledBackTo
}

/** Normalize the `rolledBackTo` field for an out-going state (drop the no-op). */
function normalizeState(
  kernelOps: ReadonlyArray<KernelPostSolidOp>,
  rolledBackTo: number | undefined
): TimelineState {
  const clamped = clampRollback(rolledBackTo, kernelOps.length)
  return clamped === undefined ? { kernelOps } : { kernelOps, rolledBackTo: clamped }
}

/**
 * Apply a timeline gesture to the current persisted state and return the next
 * persisted state. Pure: never mutates `state` or `state.kernelOps`.
 *
 * Decision — finishing-op rule is enforced on reorder, NOT silently repaired.
 * Both `move` and `reorder` validate the resulting permutation with
 * `validateTimelineOrder` (the same rule the single-step `canSwapKernelOpOrder`
 * guard uses). A rejected gesture returns `changed: false` with the rule's
 * reason; the caller surfaces it and does not persist. This keeps a finishing
 * op (fillet / chamfer / shell) from ever being committed before a
 * create / boolean / pattern op, where the kernel would have no edges to act on.
 */
export function applyTimelineAction(
  state: TimelineState,
  action: TimelineAction
): TimelineActionResult {
  const ops = state.kernelOps
  const len = ops.length

  switch (action.type) {
    case 'move': {
      const { index, delta } = action
      const j = index + delta
      if (index < 0 || index >= len || j < 0 || j >= len) {
        return { changed: false, state, reason: 'Move out of range.' }
      }
      const order = reorderPermutation(len, index, j)
      const valid: TimelineOrderValidation = validateTimelineOrder(ops, order)
      if (!valid.ok) {
        return { changed: false, state, reason: valid.reason }
      }
      const nextOps = resolveOrderOnly(ops, order)
      // The marker addresses a RESOLVED position; after a reorder that position
      // points at a different op. Re-clamp (drop if it became the last row).
      const next = normalizeState(nextOps, state.rolledBackTo)
      return { changed: true, state: next, status: 'Kernel op order updated.' }
    }

    case 'reorder': {
      const { from, to } = action
      if (from < 0 || from >= len || to < 0 || to >= len) {
        return { changed: false, state, reason: 'Reorder out of range.' }
      }
      if (from === to) {
        return { changed: false, state, reason: 'Op did not move.' }
      }
      const order = reorderPermutation(len, from, to)
      const valid: TimelineOrderValidation = validateTimelineOrder(ops, order)
      if (!valid.ok) {
        return { changed: false, state, reason: valid.reason }
      }
      const nextOps = resolveOrderOnly(ops, order)
      const next = normalizeState(nextOps, state.rolledBackTo)
      return { changed: true, state: next, status: 'Kernel op order updated.' }
    }

    case 'suppress': {
      const { index, suppressed } = action
      if (index < 0 || index >= len) {
        return { changed: false, state, reason: 'Suppress out of range.' }
      }
      const cur = ops[index]!
      const already = cur.suppressed === true
      if (already === suppressed) {
        return { changed: false, state, reason: 'Suppress state unchanged.' }
      }
      const nextOps = ops.map((op, i) =>
        i === index ? withSuppressed(op, suppressed) : op
      )
      const next = normalizeState(nextOps, state.rolledBackTo)
      return {
        changed: true,
        state: next,
        status: suppressed
          ? 'Kernel op suppressed (skipped in build).'
          : 'Kernel op active again.'
      }
    }

    case 'update': {
      const { index, op } = action
      if (index < 0 || index >= len) {
        return { changed: false, state, reason: 'Update out of range.' }
      }
      const cur = ops[index]!
      // Suppress preservation: the edit dialogs re-emit the op's PARAMETERS,
      // not its enable/disable state — so an incoming op that omits the
      // `suppressed` key inherits the current flag. An op that explicitly
      // carries the key wins (normalized through `withSuppressed` so clearing
      // still DROPS the key rather than writing `suppressed: false`).
      const merged: KernelPostSolidOp =
        op.suppressed === undefined
          ? cur.suppressed === true
            ? { ...op, suppressed: true }
            : op
          : withSuppressed(op, op.suppressed === true)
      if (JSON.stringify(merged) === JSON.stringify(cur)) {
        return { changed: false, state, reason: 'Kernel op unchanged.' }
      }
      const nextOps = ops.map((existing, i) => (i === index ? merged : existing))
      // A replacement that CHANGES the op's kind could break the finishing-op
      // rule in place (e.g. editing a create op into a fillet ahead of a
      // boolean). Validate the replaced list with the identity permutation —
      // the same rule move/reorder enforce.
      const identity = nextOps.map((_, i) => i)
      const valid: TimelineOrderValidation = validateTimelineOrder(nextOps, identity)
      if (!valid.ok) {
        return { changed: false, state, reason: valid.reason }
      }
      // Length is unchanged, so the roll-back marker still addresses the same
      // row; normalizeState only re-canonicalizes (drops a stale no-op cut).
      const next = normalizeState(nextOps, state.rolledBackTo)
      return { changed: true, state: next, status: 'Kernel op updated.' }
    }

    case 'setRollback': {
      const { index } = action
      if (index < 0 || index >= len) {
        return { changed: false, state, reason: 'Roll-back target out of range.' }
      }
      const clamped = clampRollback(index, len)
      // Setting the marker at the last row is a no-op cut -> "build all".
      if (clamped === state.rolledBackTo || (clamped === undefined && state.rolledBackTo === undefined)) {
        return { changed: false, state, reason: 'Roll-back marker unchanged.' }
      }
      const next: TimelineState = clamped === undefined ? { kernelOps: ops } : { kernelOps: ops, rolledBackTo: clamped }
      return {
        changed: true,
        state: next,
        status:
          clamped === undefined
            ? 'Roll-back cleared — building all ops.'
            : `Rolled back to op ${clamped + 1} of ${len}.`
      }
    }

    case 'clearRollback': {
      if (state.rolledBackTo === undefined) {
        return { changed: false, state, reason: 'No roll-back marker set.' }
      }
      return {
        changed: true,
        state: { kernelOps: ops },
        status: 'Roll-back cleared — building all ops.'
      }
    }

    default: {
      // Exhaustiveness guard — a new action variant must be handled above.
      const _never: never = action
      return { changed: false, state, reason: `Unknown action: ${String(_never)}` }
    }
  }
}

/**
 * Apply ONLY a reorder permutation, preserving each op's own `suppressed` flag
 * (unlike `resolveTimeline`, which strips it for a replay-ready payload). The
 * persisted `kernelOps[]` must KEEP the suppress flags — suppress is enable /
 * disable state, orthogonal to order. So we re-materialize the array in the new
 * order from the originals, leaving `suppressed` intact.
 */
function resolveOrderOnly(
  ops: ReadonlyArray<KernelPostSolidOp>,
  order: ReadonlyArray<number>
): KernelPostSolidOp[] {
  return order.map((i) => ops[i]!)
}

/**
 * Return a copy of `op` with its `suppressed` flag set or cleared. Clearing
 * DROPS the key entirely (rather than writing `suppressed: false`) so a
 * round-tripped, never-suppressed op stays byte-identical to how it was first
 * persisted — keeping the additive contract tight and the disk diff minimal.
 */
function withSuppressed(op: KernelPostSolidOp, suppressed: boolean): KernelPostSolidOp {
  if (suppressed) {
    return { ...op, suppressed: true }
  }
  if (op.suppressed === undefined) return op
  const { suppressed: _omit, ...rest } = op
  return rest as KernelPostSolidOp
}

/**
 * Convenience preview: the EFFECTIVE op list a Build STEP would replay for the
 * given persisted state. Thin wrapper over `resolveTimeline` so the UI can show
 * "N of M ops will build" without re-deriving the rollback / suppress logic.
 */
export function effectiveOpsForState(state: TimelineState): KernelPostSolidOp[] {
  return resolveTimeline(state.kernelOps, { rollbackTo: state.rolledBackTo })
}

// ── Feature-BROWSER (`items[]`) edit ops — pure, by stable id ────────────────
//
// The two halves of the editable timeline address DIFFERENT arrays:
//   • `kernelOps[]` — the ordered KERNEL build queue, edited by INDEX through
//     the `applyTimelineAction` reducer above (it owns the finishing-op order
//     rule + the roll-back marker; it is what actually drives the B-rep build).
//   • `items[]`     — the Fusion-style feature-browser metadata
//     (`PartFeaturesFile.items[]`), edited by stable feature `id`.
//
// These four helpers are the pure `items[]`-by-id half: a row reorder, a
// suppress flip, or a delete comes in as `(items, id)` and a NEW `items` array
// goes out. Same tenets as the reducer above — no React, no IPC, no Zod, never
// mutate the input (`.map` / `.filter` / `.slice` only) — so they are unit-
// testable in the node-env vitest with no jsdom and no live CadQuery round-trip.
//
// `suppressed` on an item mirrors the schema's per-row `suppressed?: boolean`;
// the kernel build already drops suppressed ops via
// `activeKernelOpsForPython` (shared/sketch-profile.ts), so toggling it here is
// the persistence shape, not a second build filter. An unknown id is a no-op:
// the SAME array reference comes back so a caller can cheaply detect "nothing
// changed" by identity.

/** Index of the item with `id`, or `-1` when absent. */
function indexOfFeature(items: ReadonlyArray<PartFeatureItem>, id: string): number {
  return items.findIndex((it) => it.id === id)
}

/**
 * Swap the item at `index` with its neighbour at `index + delta`, returning a
 * NEW array. Caller guarantees both indices are in range.
 */
function swapAt(
  items: ReadonlyArray<PartFeatureItem>,
  index: number,
  delta: -1 | 1
): PartFeatureItem[] {
  const next = items.slice()
  const j = index + delta
  const tmp = next[index]!
  next[index] = next[j]!
  next[j] = tmp
  return next
}

/**
 * Move the feature with `id` one slot earlier in `items`. Returns a new array,
 * or the SAME reference when the id is unknown or the feature is already first
 * (idempotent at the top — no wrap-around).
 */
export function moveFeatureUp(
  items: ReadonlyArray<PartFeatureItem>,
  id: string
): PartFeatureItem[] {
  const i = indexOfFeature(items, id)
  if (i <= 0) return items as PartFeatureItem[]
  return swapAt(items, i, -1)
}

/**
 * Move the feature with `id` one slot later in `items`. Returns a new array, or
 * the SAME reference when the id is unknown or the feature is already last
 * (idempotent at the bottom — no wrap-around).
 */
export function moveFeatureDown(
  items: ReadonlyArray<PartFeatureItem>,
  id: string
): PartFeatureItem[] {
  const i = indexOfFeature(items, id)
  if (i < 0 || i >= items.length - 1) return items as PartFeatureItem[]
  return swapAt(items, i, 1)
}

/**
 * Flip the `suppressed` flag of the feature with `id`. A newly-suppressed row
 * gets `suppressed: true`; un-suppressing DROPS the key entirely (rather than
 * writing `suppressed: false`) so a round-tripped, never-suppressed item stays
 * byte-identical to how it was first persisted — keeping the additive contract
 * tight (mirrors `withSuppressed` for kernel ops). Returns a new array, or the
 * SAME reference when the id is unknown.
 */
export function toggleSuppress(
  items: ReadonlyArray<PartFeatureItem>,
  id: string
): PartFeatureItem[] {
  const i = indexOfFeature(items, id)
  if (i < 0) return items as PartFeatureItem[]
  return items.map((it, idx) => {
    if (idx !== i) return it
    if (it.suppressed === true) {
      const { suppressed: _omit, ...rest } = it
      return rest
    }
    return { ...it, suppressed: true }
  })
}

/**
 * Remove the feature with `id` from `items`. Returns a new array, or the SAME
 * reference when the id is unknown.
 */
export function deleteFeature(
  items: ReadonlyArray<PartFeatureItem>,
  id: string
): PartFeatureItem[] {
  const i = indexOfFeature(items, id)
  if (i < 0) return items as PartFeatureItem[]
  return items.filter((_, idx) => idx !== i)
}
