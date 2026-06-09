/**
 * CamHandoffContext — the cross-workspace "pending CAM import" mailbox for the
 * Design → Manufacture STL hand-off (Wave 3h).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * The CAD `DesignWorkspace` and the CAM `ManufactureWorkspace` live in two
 * INDEPENDENT subtrees of the shell (`WorkspaceHost` renders exactly one
 * workspace at a time — switching routes unmounts the other). When the operator
 * clicks "Send to CAM" in Design, the STL is already exported (the design's
 * `onSendToCam(payload)` fires with `payload.stlPath`), but the Manufacture
 * subtree may not be mounted yet, so Design cannot call into it directly.
 *
 * This provider is the durable seam between the two: it holds a single optional
 * `{ stlPath, sourceName }` slot. Design SETS it (then navigates to
 * Manufacture); `ManufactureHost` CONSUMES it ONCE on mount/update and clears
 * it after importing the STL into the first plate. Because the provider is
 * mounted ABOVE `WorkspaceHost` (in `AppProviders`), the slot survives the
 * route switch that unmounts Design and mounts Manufacture.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CONSUME-ONCE SEMANTICS
 * ──────────────────────────────────────────────────────────────────────────
 * The consume-once state machine lives in the React-free
 * {@link createCamHandoffStore} (so it is unit-testable in the node test env).
 * `consumePendingCamImport()` returns the pending request AND clears the slot in
 * the same call. This guarantees an STL is imported into a plate exactly once
 * even if `ManufactureHost`'s consume effect re-runs (Strict-Mode double invoke,
 * or a project/machine change re-firing the effect): the second call sees `null`
 * and no-ops.
 *
 * SAFETY: this module is data-only — it stores a path + a display name and
 * emits no IPC and no G-code. The actual import (assets:importMesh → bind to
 * the first plate → save) is the consumer's job in `ManufactureHost`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  createCamHandoffStore,
  type CamHandoffStore,
  type PendingCamImport
} from './cam-handoff-store'

export type { PendingCamImport } from './cam-handoff-store'

export interface CamHandoffContextValue {
  /**
   * The currently-queued import, or `null` when nothing is pending.
   * `ManufactureHost` keys its consume effect on this.
   */
  readonly pendingCamImport: PendingCamImport | null
  /**
   * Queue an STL for import into CAM. Called by the Design hand-off (the Wire
   * phase wires this to `WorkspaceHost.handleSendToCam`). A non-empty `stlPath`
   * is required; an empty/whitespace path is rejected (clears nothing — a
   * malformed hand-off must never blow away an already-queued valid one). The
   * latest valid call wins.
   */
  readonly setPendingCamImport: (req: PendingCamImport) => void
  /**
   * Atomically read AND clear the queued import. Returns the request that was
   * pending (or `null` when the slot was empty). Idempotent: a second call
   * returns `null`. `ManufactureHost` calls this exactly once per queued part.
   */
  readonly consumePendingCamImport: () => PendingCamImport | null
  /**
   * Clear any queued import without consuming it (e.g. the operator abandoned
   * the hand-off). Rarely needed; exposed for completeness + tests.
   */
  readonly clearPendingCamImport: () => void
}

const Ctx = createContext<CamHandoffContextValue | null>(null)

export function CamHandoffProvider({ children }: { children: ReactNode }) {
  const [pendingCamImport, setPending] = useState<PendingCamImport | null>(null)
  // The store is the source of truth for the consume-once semantics; it pushes
  // every change into React state via the `onChange` callback so subscribers
  // re-render. Created once per provider instance (stable across renders).
  const storeRef = useRef<CamHandoffStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = createCamHandoffStore(setPending)
  }
  const store = storeRef.current

  const setPendingCamImport = useCallback(
    (req: PendingCamImport): void => {
      store.set(req)
    },
    [store]
  )

  const consumePendingCamImport = useCallback((): PendingCamImport | null => store.consume(), [store])

  const clearPendingCamImport = useCallback((): void => {
    store.clear()
  }, [store])

  const value = useMemo<CamHandoffContextValue>(
    () => ({
      pendingCamImport,
      setPendingCamImport,
      consumePendingCamImport,
      clearPendingCamImport
    }),
    [pendingCamImport, setPendingCamImport, consumePendingCamImport, clearPendingCamImport]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Access the CAM hand-off mailbox. Throws when used outside
 * {@link CamHandoffProvider} so a missing provider surfaces immediately in dev
 * rather than silently dropping hand-offs.
 */
export function useCamHandoff(): CamHandoffContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCamHandoff must be used within a CamHandoffProvider')
  return ctx
}
