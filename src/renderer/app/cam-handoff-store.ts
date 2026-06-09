/**
 * cam-handoff-store — the pure, React-free core of the Design → Manufacture
 * STL hand-off mailbox (Wave 3h).
 *
 * The consume-once semantics (set → consume returns-and-clears → second consume
 * yields null) are the load-bearing contract of the hand-off, so they live here
 * as a plain closure with no React dependency. `CamHandoffContext` wraps an
 * instance of this store behind a React provider for the running app; the unit
 * tests drive THIS module directly (the renderer test env is node — there is no
 * DOM renderer), exactly the way `design-commands` separates its action bag
 * from the host component.
 *
 * SAFETY: data-only. Stores a path + optional display name; performs no IPC and
 * emits no G-code.
 */

/**
 * A queued hand-off from Design to Manufacture.
 *
 * `stlPath` — absolute path to the STL the CAD sidecar exported. Required,
 *             non-empty.
 * `sourceName` — optional human label for the source part.
 */
export interface PendingCamImport {
  readonly stlPath: string
  readonly sourceName?: string
}

/** Imperative mailbox surface shared by the React provider and the tests. */
export interface CamHandoffStore {
  /** Current queued import, or `null` when the slot is empty. */
  get(): PendingCamImport | null
  /**
   * Queue an import. A non-empty `stlPath` is required; a malformed request is
   * rejected (returns `false`) and never disturbs an already-queued valid one.
   * The latest valid call wins. Returns `true` when the slot was updated.
   */
  set(req: PendingCamImport): boolean
  /**
   * Atomically read AND clear the queued import. Returns what was pending (or
   * `null`). Idempotent: a second call returns `null`.
   */
  consume(): PendingCamImport | null
  /** Clear any queued import without consuming it. */
  clear(): void
}

/**
 * Normalize a candidate hand-off into the stored shape, or `null` when it is
 * malformed (missing / blank `stlPath`). Drops a blank `sourceName` so the
 * stored object is minimal.
 */
export function normalizePendingCamImport(req: PendingCamImport): PendingCamImport | null {
  if (typeof req?.stlPath !== 'string' || req.stlPath.trim().length === 0) {
    return null
  }
  if (typeof req.sourceName === 'string' && req.sourceName.trim().length > 0) {
    return { stlPath: req.stlPath, sourceName: req.sourceName }
  }
  return { stlPath: req.stlPath }
}

/**
 * Create a fresh hand-off mailbox. Optionally notify a subscriber whenever the
 * slot changes (the React provider passes a setState so subscribers re-render);
 * the notifier is best-effort and never affects the stored value.
 */
export function createCamHandoffStore(
  onChange?: (next: PendingCamImport | null) => void
): CamHandoffStore {
  let pending: PendingCamImport | null = null

  const emit = (next: PendingCamImport | null): void => {
    if (onChange) onChange(next)
  }

  return {
    get(): PendingCamImport | null {
      return pending
    },
    set(req: PendingCamImport): boolean {
      const next = normalizePendingCamImport(req)
      if (next === null) return false
      pending = next
      emit(next)
      return true
    },
    consume(): PendingCamImport | null {
      const current = pending
      if (current === null) return null
      pending = null
      emit(null)
      return current
    },
    clear(): void {
      if (pending === null) return
      pending = null
      emit(null)
    }
  }
}
