/**
 * FG-5a · `useDesignSelection` — the React seam over the pure selection-state
 * helpers (`selection-state.ts`).
 *
 * Why this hook exists
 * --------------------
 * `selection-state.ts` is intentionally framework-agnostic (no React) so its
 * transitions unit-test in the `node` vitest pool. But several Design surfaces
 * need to *share* one selection cell and react to it:
 *   - `Viewport3D.onSelect` (the plain-click face pick) writes it,
 *   - the per-feature dialogs (Fillet / Chamfer / Shell / Hole — Wave-2 FG-5)
 *     read the selected face/edge id to seed their geometry input,
 *   - op-geometry derivation reads `selection.faceId` to scope a kernel op,
 *   - the contextual ribbon needs `hasSelection` / `selectionKind` to grey-out
 *     commands that require a live pick (e.g. `sk_choose_plane`).
 *
 * This hook owns the `useState<Selection | null>` cell, exposes the three pure
 * transitions as stable callbacks, derives the convenience flags, AND pushes
 * the selection up into the Context Engine through `useCommandSurface` so
 * ribbon-command enablement tracks the live pick — exactly the seam the FG-1
 * provider left open ("Wave 2 calls this from the mounted viewport's selection
 * flow", `CommandContextProvider.tsx`).
 *
 * Honesty boundary
 * ----------------
 * The selection union has `face` / `edge` / `vertex` branches, but the running
 * kernel only produces stable ids for **faces** (`cad.tessellate_with_ids`
 * emits a per-triangle `faceIds` array + `faceMap`; there is NO edge/vertex id
 * mapping — see `engines/cad/cadquery_script.py`). This hook therefore drives
 * every branch type, but the *viewport raycast* can only originate a `face`
 * pick today. Edge/vertex selections are supported for callers that already
 * hold an id (a feature dialog naming an edge by index, or a future
 * `tessellate_with_edge_ids` surface). We never fabricate an edge id from a
 * face pick.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCommandSurface } from '../commands'
import {
  clearSelection,
  selectionToSurface,
  setSelection,
  toggleSelection,
  type Selection,
  type SelectionKind
} from './selection-state'

/** The handle `useDesignSelection` returns. */
export interface DesignSelectionApi {
  /** The active selection, or `null` when nothing is picked. */
  readonly selection: Selection | null
  /** `true` when any entity is selected. */
  readonly hasSelection: boolean
  /** Discriminator of the active selection, or `undefined` when none. */
  readonly selectionKind: SelectionKind | undefined
  /**
   * Replace the selection unconditionally (the plain-click pick semantics the
   * viewport uses). Pass `null` to clear. Stable identity.
   */
  readonly select: (next: Selection | null) => void
  /**
   * Toggle: re-selecting the same entity clears it, a different entity
   * replaces it (the Fusion/Onshape click-to-deselect model). Stable identity.
   */
  readonly toggle: (next: Selection) => void
  /** Clear the selection. Stable identity (safe for effect deps / ESC wiring). */
  readonly clear: () => void
}

/**
 * Own + share the Design workspace's entity selection.
 *
 * @param initialSelection seed value (defaults to `null`); lets a host restore
 *   a selection or a test mount a pre-picked state without a click.
 *
 * Side effect: whenever the selection changes, the hook pushes
 * `{ hasSelection, selectionKind }` up via `useCommandSurface` so the ribbon /
 * palette enablement reflects the pick. The push de-dupes inside the provider
 * (it compares fields before re-rendering), so a no-op selection change does
 * not churn the command context.
 *
 * MUST be called inside a `<CommandContextProvider>` (it reads the surface
 * setter). The Design workspace already mounts under that provider via
 * `WorkspaceHost`.
 */
export function useDesignSelection(initialSelection: Selection | null = null): DesignSelectionApi {
  const [selection, setSelectionState] = useState<Selection | null>(initialSelection)
  const pushSurface = useCommandSurface()

  const select = useCallback((next: Selection | null): void => {
    setSelectionState((prev) => setSelection(prev, next))
  }, [])

  const toggle = useCallback((next: Selection): void => {
    setSelectionState((prev) => toggleSelection(prev, next))
  }, [])

  const clear = useCallback((): void => {
    setSelectionState(clearSelection())
  }, [])

  // Push selection → command surface so ribbon/palette enablement tracks the
  // live pick. Runs on every selection change; the provider de-dupes by field
  // equality, so identical-field updates are cheap.
  useEffect(() => {
    pushSurface(selectionToSurface(selection))
  }, [selection, pushSurface])

  const hasSelection = selection !== null
  const selectionKind = selection?.kind

  return useMemo<DesignSelectionApi>(
    () => ({ selection, hasSelection, selectionKind, select, toggle, clear }),
    [selection, hasSelection, selectionKind, select, toggle, clear]
  )
}
