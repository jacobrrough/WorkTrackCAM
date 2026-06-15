/**
 * NavigationGuardContext — the shell-level seam that lets a workspace declare
 * "I have unsaved changes" so the shell can confirm before navigating away
 * (which UNMOUNTS the workspace and destroys its in-memory state).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * `WorkspaceHost` mounts exactly one workspace per route; switching routes
 * unmounts the old one. `ManufactureWorkspace` keeps its plan (`mfg`) in memory
 * and only persists on the explicit Save button, so a route switch silently
 * discards unsaved setups/operations (see `navigation-guard.ts` for the full
 * write-up). This context is the additive seam that makes that loss
 * preventable WITHOUT autosaving and WITHOUT hoisting the workspace's state.
 *
 * DESIGN (mirrors the provider-tolerance convention of
 * `useOptionalCommandSurface` / `useOptionalSetCursorCoords`):
 *   - A workspace REGISTERS a `() => boolean` dirty-probe under a stable id on
 *     mount and UNREGISTERS on unmount.
 *   - The registry is a `useRef`-held `Map`, so:
 *       • `hasUnsavedChanges()` reads it SYNCHRONOUSLY at click time (AppShell
 *         must decide navigate-vs-confirm inline, not on a re-render), and
 *       • register / unregister DO NOT churn React renders (mutating a ref Map
 *         is not a state update) — important because the workspace re-registers
 *         only on mount/unmount, never per keystroke.
 *   - `useNavigationGuard()` is PROVIDER-TOLERANT: with no provider it returns
 *     stable no-ops + a `false` probe, so the many node-SSR render-pin tests
 *     that mount a workspace WITHOUT the shell provider chain keep passing
 *     (exactly the rationale behind `useOptionalCommandSurface`).
 *
 * The shell wraps this provider around its children and wires `hasUnsavedChanges`
 * into the pure `resolveNavIntent` decision; the WORKSPACE only ever touches
 * `register` / `unregister`.
 *
 * This seam is deliberately generic (keyed by id), so the Design workspace —
 * which has the SAME unsaved-changes gap but is owned by a concurrent effort —
 * can hook in later by registering its own probe, with NO change to this file.
 *
 * SAFETY: data-only — no IPC, no disk I/O, no G-code.
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ReactElement, type ReactNode } from 'react'

/** A synchronous probe: does this surface currently have unsaved changes? */
export type DirtyProbe = () => boolean

/** The seam exposed to consumers. All members are stable for a provider's life. */
export interface NavigationGuardApi {
  /**
   * Register (or replace) a dirty-probe under `id`. The shell calls every
   * registered probe to decide whether to confirm before navigating. Returns
   * nothing; pair with {@link NavigationGuardApi.unregister} on unmount.
   */
  readonly register: (id: string, isDirty: DirtyProbe) => void
  /** Remove the probe registered under `id` (no-op if absent). */
  readonly unregister: (id: string) => void
  /**
   * Whether ANY currently-registered probe reports dirty. Read synchronously by
   * the shell at navigation-attempt time.
   */
  readonly hasUnsavedChanges: () => boolean
}

const NavigationGuardCtx = createContext<NavigationGuardApi | null>(null)

/**
 * Provider that owns the ref-Map registry of dirty-probes and exposes the
 * stable {@link NavigationGuardApi}. Mount it around the shell body (AppShell)
 * so every workspace shares one registry and the shell can read it at click
 * time.
 */
export function NavigationGuardProvider({ children }: { readonly children: ReactNode }): ReactElement {
  // Ref-held registry: synchronous reads + zero render churn on (un)register.
  const probesRef = useRef<Map<string, DirtyProbe>>(new Map())

  const register = useCallback((id: string, isDirty: DirtyProbe): void => {
    probesRef.current.set(id, isDirty)
  }, [])

  const unregister = useCallback((id: string): void => {
    probesRef.current.delete(id)
  }, [])

  const hasUnsavedChanges = useCallback((): boolean => {
    for (const probe of probesRef.current.values()) {
      // A throwing probe must never wedge navigation; treat a failure as clean
      // (the operator can still Save explicitly). Defensive: probes are simple
      // ref-reads in practice.
      try {
        if (probe()) return true
      } catch {
        // ignore a misbehaving probe
      }
    }
    return false
  }, [])

  const api = useMemo<NavigationGuardApi>(
    () => ({ register, unregister, hasUnsavedChanges }),
    [register, unregister, hasUnsavedChanges]
  )

  return <NavigationGuardCtx.Provider value={api}>{children}</NavigationGuardCtx.Provider>
}

/** Stable no-op API for the provider-less branch (no identity churn per render). */
const NOOP_GUARD_API: NavigationGuardApi = {
  register: (_id, _isDirty) => {
    void _id
    void _isDirty
  },
  unregister: (_id) => {
    void _id
  },
  hasUnsavedChanges: () => false
}

/**
 * Read the navigation-guard seam.
 *
 * Returns the live {@link NavigationGuardApi} when a {@link NavigationGuardProvider}
 * is an ancestor, else a stable no-op API (PROVIDER-TOLERANT — mirrors
 * `useOptionalCommandSurface`). The no-op's `hasUnsavedChanges` returns `false`,
 * so a provider-less mount never blocks navigation and the node-SSR render pins
 * that mount workspaces bare keep passing.
 */
export function useNavigationGuard(): NavigationGuardApi {
  return useContext(NavigationGuardCtx) ?? NOOP_GUARD_API
}
