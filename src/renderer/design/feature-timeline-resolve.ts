/**
 * CAD feature-timeline resolution — pure, framework-agnostic.
 *
 * Turns the persisted, editable `kernelOps[]` timeline (the `KernelPostSolidOp`
 * array in `part/features.json`) plus a UI edit (reorder / suppress / roll-back)
 * into the EFFECTIVE ordered op list that the kernel should replay.
 *
 * Design tenets (mirrors `selection-state.ts`):
 *   1. **No React, no IPC, no Zod inside this module.** The component layer
 *      (`DesignWorkspace` / `DesignSessionContext`) owns the persisted array and
 *      the IPC save; this module is a pure `ops + edit -> ops` transform. That
 *      keeps it unit-testable in the existing `node` vitest environment with no
 *      jsdom / CadQuery dependency — which matters because the sidecar exec path
 *      cannot run CadQuery locally (pre-existing issue #11). Correctness of the
 *      reorder/suppress/rollback math is proven by the sibling Vitest alone, no
 *      live B-rep round-trip required.
 *   2. **Positional model, preserved.** The kernel applies `kernelOps[]` "in
 *      sequence as written" (see `part-features-schema.ts` near the
 *      `kernelPostSolidOpSchema` union). Ops carry no stable `id`, so every
 *      reference here is a 0-based index into the input array. This module adds
 *      NO schema field and never bumps a version — it is a read-only projection
 *      that the build path can opt into.
 *   3. **Resolution pipeline order is fixed: reorder -> rollback -> suppress.**
 *      Reorder first so the user's drag order is the timeline everything else
 *      reasons about. Roll-back is an inclusive cut *in that reordered timeline*
 *      (a roll-back bar the user drags sits at a visible row, i.e. a post-reorder
 *      position). Suppress runs last so a suppressed op still counts toward the
 *      roll-back position (it occupies a row) but is omitted from the replay.
 *
 * Relationship to the build path: `activeKernelOpsForPython`
 * (`src/shared/sketch-profile.ts`) is the existing impure resolver that only
 * drops `suppressed` ops. This module is the superset used by the UI to preview
 * "what will the next Build STEP actually run" for an arbitrary reorder/rollback
 * before the edit is committed to disk.
 */

import type { KernelPostSolidOp } from '../../shared/part-features-schema'

export type { KernelPostSolidOp }

/**
 * Kernel op kinds that finish an existing solid (round/ream/hollow its edges)
 * rather than create or combine bodies. They must stay AFTER every
 * create/boolean/pattern op or the kernel has no edges to act on.
 *
 * Kept deliberately in sync with `kernelFinishingOpKinds` in
 * `DesignSessionContext.tsx`; the single-step swap guard there
 * (`canSwapKernelOpOrder`) and the arbitrary-order validator here
 * (`validateTimelineOrder`) must agree, so the same rule gates a one-row nudge
 * and a multi-row drag.
 */
const FINISHING_OP_KINDS: ReadonlySet<KernelPostSolidOp['kind']> = new Set<KernelPostSolidOp['kind']>([
  'fillet_all',
  'fillet_select',
  'chamfer_all',
  'chamfer_select',
  'shell_inward'
])

function isFinishingOp(op: KernelPostSolidOp): boolean {
  return FINISHING_OP_KINDS.has(op.kind)
}

/**
 * A UI edit to apply to the persisted `kernelOps[]` timeline. Every field is
 * optional; an empty/default edit is the identity transform (returns the ops
 * as-is, only stripping each op's own pre-existing `suppressed: true`).
 *
 * All indices are 0-based positions in the ORIGINAL `ops` array.
 */
export interface TimelineEdit {
  /**
   * Explicit replay order as a permutation of indices into `ops`. Absent =
   * keep the array's positional order. When present it MUST list each valid
   * index exactly once (a true permutation); an invalid `order`
   * (wrong length, out-of-range, or duplicate index) is treated as "no
   * explicit order" and the positional order is used instead — the resolver
   * never throws and never silently drops or duplicates an op.
   */
  readonly order?: ReadonlyArray<number>
  /**
   * Extra op indices (positions in the ORIGINAL `ops`) to treat as suppressed,
   * on top of any op that already carries `suppressed: true`. Out-of-range
   * entries are ignored. This is additive: it never un-suppresses an op whose
   * own `suppressed` flag is set.
   */
  readonly suppressedIndices?: ReadonlyArray<number>
  /**
   * Inclusive roll-back marker, expressed as a position in the RESOLVED
   * (post-reorder) timeline: keep resolved positions `[0..rollbackTo]` and
   * exclude everything after. `-1` or `undefined` keeps the whole timeline.
   * A marker that no longer addresses a row (out of `[0, resolvedLen-1]`,
   * other than the `-1` sentinel) is treated as "no roll-back" so a stale
   * pointer left over from a delete can never silently truncate the build.
   *
   * Note: ops after the marker are EXCLUDED FROM THE REPLAY ONLY — they remain
   * in the persisted `kernelOps[]` on disk. Roll-back is non-destructive.
   */
  readonly rollbackTo?: number
}

/** Result of validating an explicit `order` against the finishing-op rule. */
export type TimelineOrderValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Is `order` a true permutation of `[0, len)` — every index present exactly
 * once? Used to decide whether to honor an explicit order or fall back to
 * positional.
 */
function isPermutation(order: ReadonlyArray<number>, len: number): boolean {
  if (order.length !== len) return false
  const seen = new Array<boolean>(len).fill(false)
  for (const idx of order) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= len || seen[idx]) return false
    seen[idx] = true
  }
  return true
}

/**
 * Validate an arbitrary reorder against the same finishing-op rule the
 * single-step swap guard enforces: no finishing op (fillet/chamfer/shell) may
 * land before a create/boolean/pattern op in the resolved order. Returns the
 * first offending pair's reason.
 *
 * This is exposed so the renderer can gate a drag-to-reorder BEFORE committing,
 * using identical semantics to `canSwapKernelOpOrder`'s single-step path. It is
 * intentionally NOT called inside `resolveTimeline` — resolution stays a pure
 * data transform that always produces a defined op list; rejecting an invalid
 * drag is a UI policy decision the caller makes with this helper.
 */
export function validateTimelineOrder(
  ops: ReadonlyArray<KernelPostSolidOp>,
  order: ReadonlyArray<number>
): TimelineOrderValidation {
  if (!isPermutation(order, ops.length)) {
    return { ok: false, reason: 'Order must list every op exactly once.' }
  }
  let lastNonFinishingPos = -1
  for (let pos = 0; pos < order.length; pos++) {
    const op = ops[order[pos]!]!
    if (isFinishingOp(op)) {
      // A finishing op is fine as long as nothing creates/combines after it.
    } else {
      if (lastNonFinishingPos < pos - 1) {
        // A finishing op sits between the previous create/boolean op and this
        // one — i.e. a finishing op precedes a create/boolean op. Reject.
        return {
          ok: false,
          reason: 'Finishing ops (fillet / chamfer / shell) must stay after create / boolean / pattern ops.'
        }
      }
      lastNonFinishingPos = pos
    }
  }
  return { ok: true }
}

/**
 * Resolve the editable kernel timeline into the EFFECTIVE ordered op list to
 * replay. Pure: never mutates `ops` or `edit`, never throws.
 *
 * Pipeline (see module docstring for rationale):
 *   1. **Reorder** — apply `edit.order` if it is a valid permutation, else keep
 *      positional order.
 *   2. **Roll-back truncate** — keep resolved positions `[0..rollbackTo]`; a
 *      stale/out-of-range marker is ignored (keep all).
 *   3. **Suppress filter** — drop any op flagged by its own `suppressed: true`
 *      OR by `edit.suppressedIndices`, and strip the `suppressed` key so the
 *      result is replay-ready (matching `activeKernelOpsForPython`'s contract).
 *
 * Dependency handling — IMPORTANT: kernel ops carry NO dependency graph (no
 * `id`, no `dependsOn`). When a suppressed op is one that a later op implicitly
 * relies on (e.g. suppressing the `boolean_union_box` that a later
 * `fillet_select` was meant to round), this function does NOT attempt to repair,
 * reorder, or auto-suppress the dependents, and it does NOT silently substitute
 * a "safe" op list. It simply excludes the suppressed op and returns the rest in
 * order. The subsequent kernel rebuild (`build_part.py`) then either succeeds
 * (the dependent had nothing to bind to and is a no-op / OCC tolerates it) or
 * fails loudly with a real geometry error that the existing
 * `kernelInspectStaleReason` / build-error surface reports to the operator.
 * This is deliberate: producing a quietly-broken-but-"successful" replay would
 * be far more dangerous than a visible rebuild error. Once ops gain stable ids
 * and a dependency edge ([task #54]-style work), this is the single choke point
 * to add cascade-suppress or dependent-validation logic.
 */
export function resolveTimeline(
  ops: ReadonlyArray<KernelPostSolidOp>,
  edit: TimelineEdit = {}
): KernelPostSolidOp[] {
  if (ops.length === 0) return []

  // 1. Reorder. Honor an explicit order only when it is a true permutation;
  //    otherwise fall back to positional so no op is ever dropped/duplicated.
  const order =
    edit.order && isPermutation(edit.order, ops.length)
      ? edit.order
      : ops.map((_, i) => i)

  // The set of ORIGINAL indices suppressed by the edit (in addition to each
  // op's own flag). Normalized to a Set of valid in-range integers.
  const editSuppressed = new Set<number>()
  if (edit.suppressedIndices) {
    for (const idx of edit.suppressedIndices) {
      if (Number.isInteger(idx) && idx >= 0 && idx < ops.length) editSuppressed.add(idx)
    }
  }

  // Materialize the reordered op list, remembering each op's original index so
  // `suppressedIndices` (which addresses ORIGINAL positions) still applies after
  // the shuffle.
  const reordered = order.map((originalIndex) => ({ originalIndex, op: ops[originalIndex]! }))

  // 2. Roll-back truncate, in the RESOLVED order. -1 / undefined keeps all; a
  //    marker outside [0, len-1] is stale and ignored (keep all) so a leftover
  //    pointer can never silently shorten the build.
  let keepThrough = reordered.length - 1
  const marker = edit.rollbackTo
  if (typeof marker === 'number' && marker !== -1) {
    if (Number.isInteger(marker) && marker >= 0 && marker < reordered.length) {
      keepThrough = marker
    }
    // else: stale/out-of-range marker -> treat as no roll-back (keepThrough unchanged).
  }

  // 3. Suppress filter + strip the `suppressed` key for a replay-ready result.
  const out: KernelPostSolidOp[] = []
  for (let pos = 0; pos <= keepThrough; pos++) {
    const { originalIndex, op } = reordered[pos]!
    if (op.suppressed || editSuppressed.has(originalIndex)) continue
    if (op.suppressed === undefined) {
      out.push(op)
    } else {
      const { suppressed: _omit, ...rest } = op
      // `rest` is structurally a KernelPostSolidOp minus the optional flag,
      // which is assignable back to the union (the flag is optional everywhere).
      out.push(rest as KernelPostSolidOp)
    }
  }
  return out
}
