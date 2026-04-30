/**
 * brand-bar-machine-badge -- pure label helpers for the ShopApp brand-bar
 * machine-badge button.
 *
 * Cycle 61 ui-polish [ID-0152]. Extracted from `ShopApp.tsx` so the
 * tooltip + ARIA label + visible-text formatting can be unit-tested
 * without mounting the 2k-line shop component.
 *
 * Render-contract pins (see `brand-bar-machine-badge.test.ts`):
 *   1. `formatMachineBadgeLabel`  -> visible button text. Falls back to
 *      `"No machine"` when the active profile is null/undefined/empty
 *      so the badge always has stable visible content.
 *   2. `formatMachineBadgeTitle`  -> tooltip surfaced on hover. Pinned to
 *      its pre-Cycle-61 wording (`"Current machine: <name> -- Click to
 *      change"`) for Safety Rule 2 byte-identical compatibility:
 *      operators already trained on the existing tooltip see the same
 *      string after this cycle.
 *   3. `formatMachineBadgeAriaLabel` -> screen-reader label. The badge
 *      icon comes from `MODE_ICONS` and is decorative; the button itself
 *      had NO `aria-label` before this cycle, so SR users heard either a
 *      mojibake glyph or nothing at all. The new label conveys both the
 *      action and the current state plus the human-readable mode label
 *      from `MODE_LABELS` (e.g. "FDM Printer" instead of the printer
 *      glyph U+1F5A8).
 *
 * Pure module: no React, no I/O, no `electron` import. Safe to import
 * from any renderer surface.
 */

import { MODE_LABELS, type MachineUIMode } from './shop-types'

/**
 * Visible badge text fallback when no machine profile is loaded. Pinned
 * for byte-identical compatibility with the pre-Cycle-61 ShopApp.tsx
 * `?? 'No machine'` expression.
 */
export const MACHINE_BADGE_NAME_FALLBACK = 'No machine'

/**
 * Tooltip fallback name when no machine profile is loaded. Pinned for
 * byte-identical compatibility with the pre-Cycle-61 ShopApp.tsx
 * `?? 'None'` expression inside the `title` template literal.
 */
export const MACHINE_BADGE_TITLE_FALLBACK = 'None'

export type MachineBadgeFormatInput = {
  /** Active machine display name. Empty / whitespace / null falls back. */
  readonly machineName: string | null | undefined
  /** Resolved UI mode for the active profile (drives the mode-label suffix). */
  readonly mode: MachineUIMode
}

function resolveBadgeName(
  raw: string | null | undefined,
  fallback: string
): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

/**
 * Visible badge text. Mirrors the pre-Cycle-61 inline expression
 * `sessionMachine?.name ?? 'No machine'` so the visual surface is
 * unchanged (Safety Rule 2 pin).
 */
export function formatMachineBadgeLabel(
  machineName: string | null | undefined
): string {
  return resolveBadgeName(machineName, MACHINE_BADGE_NAME_FALLBACK)
}

/**
 * Tooltip surfaced on hover. Pinned to the pre-Cycle-61 wording so
 * existing operator muscle memory is preserved. Uses an em-dash
 * (U+2014) as the visual separator -- multi-byte UTF-8 character, see
 * `docs/EDIT-WORKFLOW.md` R1.5 trigger #1.
 */
export function formatMachineBadgeTitle(
  input: MachineBadgeFormatInput
): string {
  const name = resolveBadgeName(
    input.machineName,
    MACHINE_BADGE_TITLE_FALLBACK
  )
  return `Current machine: ${name} — Click to change`
}

/**
 * Screen-reader label for the machine-badge button. The visible icon
 * comes from `MODE_ICONS` and is decorative (`aria-hidden="true"` in
 * the rendered span); this string is what SR users actually hear.
 *
 * Format rules:
 *   - With a machine: `"Change active machine -- currently <name> (<mode>)"`.
 *   - Without:        `"Set active machine -- <mode> mode"`.
 *
 * The mode label comes from `MODE_LABELS` (`"FDM Printer"`,
 * `"CNC 4-Axis"`, etc.) so SR users get human-readable context.
 */
export function formatMachineBadgeAriaLabel(
  input: MachineBadgeFormatInput
): string {
  const modeLabel = MODE_LABELS[input.mode]
  const trimmed = typeof input.machineName === 'string'
    ? input.machineName.trim()
    : ''
  if (trimmed.length === 0) {
    return `Set active machine — ${modeLabel} mode`
  }
  return `Change active machine — currently ${trimmed} (${modeLabel})`
}
