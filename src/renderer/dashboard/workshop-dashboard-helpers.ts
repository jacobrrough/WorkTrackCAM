/**
 * Pure helpers for the WorkshopDashboard (Gap #10 — Competitive Gap Analysis).
 *
 * The dashboard surfaces one card per CLAUDE.md target machine
 * (Laguna Swift 5x10, Creality K2 Plus, Makera Carvera) and reuses
 * existing job state to derive a "last outcome" line without standing
 * up any new IPC channels.
 *
 * This module is PURE — no React imports, no `window`, no `fab()` calls.
 * The component (`WorkshopDashboard.tsx`) owns the polling + IPC side;
 * this file is exclusively the data-shaping it depends on so the unit
 * tests can run in the existing node-vitest environment.
 *
 * Scope (My-Shop-Only):
 *   - The dashboard recognises exactly the three target machine IDs from
 *     `MY_SHOP_MACHINE_IDS` (see `src/renderer/src/environments/my-shop-presets.ts`).
 *   - The Makera 3-axis variant is treated as the same "card bucket" as
 *     the 4-axis HD because the operator runs both off one Carvera unit.
 *     Jobs targeting `makera-carvera-3axis` are listed under the Carvera
 *     card; the card itself displays the active variant's name so the
 *     operator knows which mode their last job ran in.
 */
import type { Job } from '../src/shop-types'

/**
 * The three dashboard card slots. Order matches the visual layout
 * (Laguna left, K2 Plus middle, Carvera right — mirrors the brand-bar
 * env switcher order: VCarve Pro → Creality Print → Makera CAM).
 */
export const DASHBOARD_CARD_IDS = [
  'laguna-swift-5x10',
  'creality-k2-plus',
  'makera-carvera'
] as const

/**
 * Stable string identifier for each dashboard card slot. The Carvera
 * card slot covers BOTH `makera-carvera-3axis` and `makera-carvera-4axis`
 * machine IDs because they're the same physical machine in two modes.
 */
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number]

/**
 * Maps a raw machine ID to the dashboard card slot that should display
 * its jobs. Returns `null` for machine IDs outside the three-machine
 * target list (e.g. a hypothetical `prusa-mk4`). Drives the
 * `latestJobForCard` helper so unscoped jobs never leak into the cards.
 */
export function dashboardCardIdForMachine(
  machineId: string | null | undefined
): DashboardCardId | null {
  if (!machineId) return null
  if (machineId === 'laguna-swift-5x10') return 'laguna-swift-5x10'
  if (machineId === 'creality-k2-plus') return 'creality-k2-plus'
  if (machineId === 'makera-carvera-3axis' || machineId === 'makera-carvera-4axis') {
    return 'makera-carvera'
  }
  return null
}

/**
 * Find the most recent job that belongs to a given card slot. "Most
 * recent" is order-as-last-in-array because Job has no timestamp field;
 * `Job[]` insertion order already reflects creation order (see
 * `createJob` in ShopApp.tsx, which appends with `setJobs(prev => [...prev, ...])`).
 *
 * Returns `null` when no job in `jobs` targets a machine that maps to
 * the requested card. Pure — `jobs` is not mutated.
 */
export function latestJobForCard(
  jobs: readonly Job[],
  cardId: DashboardCardId
): Job | null {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]
    if (dashboardCardIdForMachine(j.machineId) === cardId) return j
  }
  return null
}

/**
 * Derived per-card status. The dashboard never shows raw `Job.status`
 * verbatim because:
 *   - The K2 card layers a live Moonraker poll on top — the printer
 *     state ("printing" / "paused" / "complete") is more truthful than
 *     the last CAM-generate run's local status.
 *   - The Laguna has no live IPC (RichAuto handheld is offline) so the
 *     card is purely derived from the most recent CAM run.
 *   - The Carvera card has an explicit "uploading" pseudo-state for
 *     when the renderer is awaiting a `carveraUpload` IPC response.
 */
export type DashboardStatusKind =
  | 'idle'           // no job for this card OR last job is idle
  | 'running'        // last job is `running` (CAM generation in flight)
  | 'paused'         // K2 only: Moonraker reports paused
  | 'printing'       // K2 only: Moonraker reports printing
  | 'uploading'      // Carvera only: an upload is in flight
  | 'error'          // last job failed
  | 'setup-required' // Laguna only: gcode but no setup sheet generated yet
  | 'done'           // last job ran successfully

/**
 * Map the result of a single `moonrakerStatus(url)` poll into the
 * dashboard's K2 card status kind. `null` means we have no useful state
 * yet (initial mount or poll error) and the card should fall back to
 * the local Job-derived kind.
 */
export function k2StatusKindFromMoonraker(
  rawState: string | undefined | null
): DashboardStatusKind | null {
  if (!rawState) return null
  // Moonraker normalises printer state through Klipper's `print_stats`
  // object — see `parseMoonrakerStatusBody` in `src/main/moonraker-push.ts`.
  switch (rawState) {
    case 'printing':
      return 'printing'
    case 'paused':
      return 'paused'
    case 'error':
      return 'error'
    case 'complete':
      return 'done'
    case 'standby':
    case 'cancelled':
      return 'idle'
    default:
      return null
  }
}

/**
 * Derive a card's status purely from the latest Job, ignoring any
 * live Moonraker / Carvera signals. Used as the baseline that live
 * polling can override.
 */
export function statusFromJob(job: Job | null): DashboardStatusKind {
  if (!job) return 'idle'
  switch (job.status) {
    case 'running':
      return 'running'
    case 'error':
      return 'error'
    case 'done':
      return 'done'
    case 'idle':
    default:
      return 'idle'
  }
}

/**
 * Plain-English label for each status kind. Renders inside the status
 * dot's accessible name + tooltip.
 */
export const DASHBOARD_STATUS_LABELS: Record<DashboardStatusKind, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  printing: 'Printing',
  uploading: 'Uploading',
  error: 'Error',
  'setup-required': 'Setup required',
  done: 'Complete'
}

/**
 * Color token name (matches `src/renderer/styles/utilities.css`
 * `--ok` / `--err` / `--warn` / `--accent`) for each status. The
 * component maps this to a small dot via inline styling so the
 * dashboard CSS surface stays minimal.
 */
export const DASHBOARD_STATUS_COLORS: Record<DashboardStatusKind, string> = {
  idle: 'var(--txt2)',
  running: 'var(--accent)',
  paused: 'var(--warn)',
  printing: 'var(--accent)',
  uploading: 'var(--accent)',
  error: 'var(--err)',
  'setup-required': 'var(--warn)',
  done: 'var(--ok)'
}

/**
 * Strip a filesystem path down to its trailing filename component.
 * Used to render "Last G-code: pocket.gcode" instead of the full
 * absolute path. Tolerates both forward and back slashes (Electron
 * runs on Windows + macOS + Linux).
 */
export function fileBasename(path: string | null | undefined): string | null {
  if (!path) return null
  const parts = path.split(/[\\/]/)
  const last = parts[parts.length - 1]
  return last.length > 0 ? last : null
}

/**
 * One "Send latest slice" quick action is offered on the K2 card only
 * when BOTH a fresh slice path and a Moonraker URL are configured.
 * Mirrors the gate the existing K2 send flow in ShopApp uses.
 */
export function k2CanSendLatestSlice(args: {
  lastSliceGcodePath: string | null | undefined
  moonrakerUrl: string | null | undefined
}): boolean {
  const slice = args.lastSliceGcodePath?.trim()
  const url = args.moonrakerUrl?.trim()
  return Boolean(slice && url)
}

/**
 * Format a Moonraker `etaSeconds` value into a compact "X h Y m"
 * string. Returns `null` for missing / non-finite values so the
 * caller can render nothing rather than `0 m`.
 */
export function formatEta(seconds: number | undefined | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null
  }
  const rounded = Math.round(seconds)
  const h = Math.floor(rounded / 3600)
  const m = Math.floor((rounded % 3600) / 60)
  if (h > 0 && m > 0) return `${h} h ${m} m`
  if (h > 0) return `${h} h`
  if (m > 0) return `${m} m`
  return '<1 m'
}

/**
 * Format a Moonraker `progress` number (0..1) as an integer percent.
 * Returns `null` for non-finite / out-of-range inputs so the renderer
 * skips the chip rather than showing `NaN%`.
 */
export function formatProgressPercent(progress: number | undefined | null): string | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  if (progress < 0 || progress > 1) return null
  return `${Math.round(progress * 100)}%`
}
