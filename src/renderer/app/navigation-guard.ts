/**
 * navigation-guard — the PURE decision helper behind the shell's
 * unsaved-changes navigation guard.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (the Manufacture route-switch DATA-LOSS gap)
 * ──────────────────────────────────────────────────────────────────────────
 * `WorkspaceHost` returns `<ManufactureHost/>` ONLY for the `manufacture`
 * route; switching to ANY other route UNMOUNTS it, which destroys
 * `ManufactureWorkspace`'s in-memory plan (`mfg` — plates / setups /
 * operations). That plan persists to disk ONLY on the explicit Save button.
 * So a single mis-click on the nav rail (or a keyboard 1–6 / ribbon / command
 * palette navigate, which all funnel through the same `setActiveWorkspace`)
 * silently discards unsaved CAM work.
 *
 * This is DISTINCT from the Cycle-249 effect-re-fire clobber
 * (`manufacture-load-guard.ts`), which guarded the disk-load effect from
 * re-reading over unsaved edits. That fix keeps a spurious re-render from
 * wiping state; THIS guard keeps an intentional navigation from unmounting it
 * without a confirm.
 *
 * THE SEAM: AppShell wraps `setActiveWorkspace` into a `guardedNavigate` that
 * asks this pure function what to do. Keeping the decision pure means it is
 * node-SSR unit-testable in isolation (no React, no DOM), and AppShell's
 * wrapper stays a thin dispatcher over the returned intent.
 *
 * SAFETY: pure — no React, no IPC, no DOM, no G-code.
 */
import type { WorkspaceId } from './useWorkspaceRouter'

/** The two outcomes of an attempted navigation. */
export type NavIntent =
  | 'navigate' // proceed immediately (no confirm needed)
  | 'confirm' // a registered surface is dirty → open the leave-confirm first

/** Inputs to {@link resolveNavIntent}. */
export interface ResolveNavIntentInput {
  /** The currently-shown workspace. */
  readonly active: WorkspaceId
  /** The workspace the operator is trying to switch to. */
  readonly target: WorkspaceId
  /**
   * Whether ANY registered surface currently has unsaved changes. Read
   * synchronously from the {@link NavigationGuardContext} registry by AppShell
   * at click time.
   */
  readonly hasUnsavedChanges: boolean
}

/**
 * Decide whether an attempted navigation may proceed immediately or must first
 * raise the unsaved-changes confirm.
 *
 * Rules (in order):
 *   1. Navigating to the SAME workspace is always a no-op-proceed — re-selecting
 *      the active tab must never raise a confirm (nothing unmounts).
 *   2. Otherwise, if any registered surface is dirty → `confirm`.
 *   3. Otherwise → `navigate`.
 *
 * PURE: deterministic over its inputs; safe to call on every nav attempt.
 */
export function resolveNavIntent({
  active,
  target,
  hasUnsavedChanges
}: ResolveNavIntentInput): NavIntent {
  // Re-selecting the current workspace never unmounts anything — proceed.
  if (target === active) return 'navigate'
  return hasUnsavedChanges ? 'confirm' : 'navigate'
}
