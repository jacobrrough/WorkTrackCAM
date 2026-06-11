/**
 * WorkshopDashboard — single consolidated view of "what is each of the
 * three target machines doing right now". Closes Gap #10 from the
 * 2026-05-27 Competitive Gap Analysis ("docs/COMPETITIVE-GAP-ANALYSIS.md"):
 *
 *   > Today these are scattered: Moonraker banner is in ShopApp.tsx,
 *   > Carvera CLI is in a Makera panel, Laguna's setup sheet is a
 *   > button. Pro apps consolidate "what is each machine doing right now".
 *
 * Layout: three machine status cards (Laguna Swift 5x10 / Creality K2
 * Plus / Makera Carvera) in a grid that mirrors the brand-bar env
 * switcher order (VCarve Pro → Creality Print → Makera CAM).
 *
 * Each card shows:
 *   1. Status dot + label (idle / running / printing / paused / error
 *      / done / setup-required / uploading)
 *   2. Last-outcome line (filename + status), derived from the latest
 *      job that targets the card's machine slot
 *   3. ONE quick-action button reusing an existing IPC channel
 *
 * Wiring (HARD CONSTRAINT — NO new IPC handlers):
 *   - K2 card status: live `moonrakerStatus(url)` poll every 5 s when
 *     a `moonrakerUrl` is configured. The poll lifecycle is bound to
 *     the dashboard's mount; the cleanup function in the `useEffect`
 *     clears the interval on unmount or when the URL changes.
 *   - Carvera card status: derived from the latest job's `status`
 *     field. There is no live `carveraStatus` IPC (the Carvera CLI is
 *     fire-and-forget upload-only — see `src/main/carvera-cli-run.ts`)
 *     so the card surfaces local CAM-run state only.
 *   - Laguna card status: derived from the latest job's `status` field
 *     plus a "setup-required" pseudo-state when a `gcodeOut` exists but
 *     the operator has not yet generated a setup sheet for that run.
 *     The RichAuto A-series handheld is offline-by-design — no live IPC
 *     is possible.
 *
 * Safety:
 *   - The dashboard EMITS no G-code and POSTS to no endpoint on its
 *     own. The "Send latest slice" / "Send to Carvera" / "Open setup
 *     sheet" actions delegate to whatever handlers the parent passes in.
 *     In the current shell (`WorkshopHost.tsx`) those handlers are
 *     advisory toasts ONLY — no G-code dispatch happens from this
 *     dashboard; they point the operator at the Manufacture workspace,
 *     whose live send/export surfaces run the real safety gates (the
 *     `gcode-send-gate.ts` seam for CNC sends/exports plus the
 *     main-process `validateGcodeFileTemps` hard gate for K2 pushes).
 *   - No `any` types. Polling errors are swallowed; the card falls
 *     back to job-derived status (Safety Rule: "graceful network
 *     degradation — never crash the dashboard if the K2 is off").
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Job } from '../src/shop-types'
import { EmptyState } from '../src/EmptyState'
import {
  DASHBOARD_CARD_IDS,
  DASHBOARD_STATUS_COLORS,
  DASHBOARD_STATUS_LABELS,
  type DashboardCardId,
  type DashboardStatusKind,
  fileBasename,
  formatEta,
  formatProgressPercent,
  k2CanSendLatestSlice,
  k2StatusKindFromMoonraker,
  latestJobForCard,
  statusFromJob
} from './workshop-dashboard-helpers'

/**
 * Subset of the preload `fab` surface this component depends on.
 * Inlined here so the dashboard's render contract test can supply a
 * narrow mock without dragging the full Electron API surface into the
 * vitest fixture. Mirrors the channel names already in
 * `src/preload/index.ts` — NO new IPC handlers were added.
 */
export interface WorkshopDashboardFabBridge {
  /**
   * Existing `moonraker:status` channel (see
   * `src/main/moonraker-push.ts:moonrakerStatus`). 5-second poll.
   */
  moonrakerStatus: (url: string) => Promise<{
    ok: boolean
    state?: string
    rawState?: string
    filename?: string
    progress?: number
    etaSeconds?: number
    error?: string
  }>
}

export interface WorkshopDashboardProps {
  /** Current job list, scoped to the active env. */
  readonly jobs: readonly Job[]
  /** Configured Moonraker URL from `appSettings.moonrakerUrl`, or null. */
  readonly moonrakerUrl: string | null
  /** Active session machine id (for highlighting the current card). */
  readonly currentMachineId: string | null
  /**
   * Optional override for the polling interval — purely for the
   * dashboard render-contract test, which sets it to `Number.MAX_SAFE_INTEGER`
   * to disable the recurring poll. Production defaults to 5000 ms.
   */
  readonly pollIntervalMs?: number
  /** Wired by parent: route to the K2 send-to-printer flow. */
  readonly onSendLatestSlice?: (slicePath: string) => void
  /** Wired by parent: route to the existing setup-sheet generator. */
  readonly onOpenSetupSheet?: (job: Job) => void
  /** Wired by parent: route to the Carvera CLI upload flow. */
  readonly onSendToCarvera?: (job: Job) => void
  /**
   * Wired by parent: route to the existing "new project" flow (mirrors the
   * Ctrl+N shortcut and the brand-bar File menu's New Project action).
   * When supplied AND `jobs.length === 0`, the dashboard surfaces an
   * `EmptyState` with a primary "Create project" CTA. When omitted, the
   * `EmptyState` still renders but the CTA is hidden — keeping the
   * surface honest when the parent has no create flow to delegate to.
   */
  readonly onCreateProject?: () => void
  /**
   * Bridge to the existing Electron preload `fab` API. Defaults to the
   * runtime `window.fab` accessor; tests inject a stub.
   */
  readonly fab?: WorkshopDashboardFabBridge
}

/**
 * Pull the live `fab` bridge from `window` at render time. Falls back
 * to a no-op stub when running outside Electron (vitest environment is
 * `node`; the harness never actually invokes the moonraker channel
 * because the render test passes a stub `fab` directly).
 */
function defaultFab(): WorkshopDashboardFabBridge {
  // `globalThis.window` is the Electron renderer window in production
  // and is `undefined` in the node-vitest environment. Defensive cast
  // because `Window['fab']` isn't part of the standard DOM lib.
  const w = (globalThis as { window?: { fab?: WorkshopDashboardFabBridge } }).window
  if (w?.fab && typeof w.fab.moonrakerStatus === 'function') return w.fab
  return {
    moonrakerStatus: () => Promise.resolve({ ok: false, error: 'no-window' })
  }
}

/**
 * Per-card live state derived from `moonrakerStatus` polls. Only the
 * K2 card maintains this; the other two have no live signal.
 */
type K2LiveState = {
  readonly rawState: string | null
  readonly filename: string | null
  readonly progress: number | null
  readonly etaSeconds: number | null
}

const EMPTY_K2_STATE: K2LiveState = {
  rawState: null,
  filename: null,
  progress: null,
  etaSeconds: null
}

/**
 * Tiny status-dot SVG with an aria-label that names the status. Visual
 * weight matches the brand-bar dots — 10 px circle, color via the
 * `DASHBOARD_STATUS_COLORS` token map.
 */
function StatusDot({ status }: { readonly status: DashboardStatusKind }): React.ReactElement {
  const color = DASHBOARD_STATUS_COLORS[status]
  const label = DASHBOARD_STATUS_LABELS[status]
  // Dimensions, radius, and spacing live in `.workshop-dashboard__dot`
  // (manufacture.css). Only the dynamic per-status color stays inline —
  // it is driven by the DASHBOARD_STATUS_COLORS map which encodes one of
  // eight discrete kinds (idle/running/printing/paused/error/done/
  // setup-required/uploading) and is therefore not a static CSS value.
  return (
    <span
      className="workshop-dashboard__dot"
      role="img"
      aria-label={label}
      title={label}
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * Human-readable display name for each card slot. Pulled from CLAUDE.md
 * §"USER CONTEXT — TARGET MACHINES" verbatim so the surface matches the
 * spec the operator sees in the rest of the app.
 */
const CARD_DISPLAY_NAMES: Record<DashboardCardId, string> = {
  'laguna-swift-5x10': 'Laguna Swift 5x10',
  'creality-k2-plus': 'Creality K2 Plus',
  'makera-carvera': 'Makera Carvera'
}

/**
 * One-line subtitle for each card — what kind of machine, no specs.
 */
const CARD_SUBTITLES: Record<DashboardCardId, string> = {
  'laguna-swift-5x10': 'Large-format CNC router',
  'creality-k2-plus': 'FDM 3D printer (Klipper/Moonraker)',
  'makera-carvera': 'Desktop CNC + 4th axis'
}

/**
 * One-card render. Pure presentation — all live state arrives via
 * props. The card never owns IPC of its own; the parent dashboard
 * owns the 5-second Moonraker poll and forwards the result here.
 */
interface CardProps {
  readonly cardId: DashboardCardId
  readonly job: Job | null
  readonly status: DashboardStatusKind
  readonly isCurrent: boolean
  readonly k2Live: K2LiveState | null
  readonly canSendLatestSlice: boolean
  readonly onSendLatestSlice?: () => void
  readonly onOpenSetupSheet?: () => void
  readonly onSendToCarvera?: () => void
}

function WorkshopCard(props: CardProps): React.ReactElement {
  const {
    cardId, job, status, isCurrent, k2Live,
    canSendLatestSlice, onSendLatestSlice, onOpenSetupSheet, onSendToCarvera
  } = props
  const name = CARD_DISPLAY_NAMES[cardId]
  const subtitle = CARD_SUBTITLES[cardId]
  const lastFile = fileBasename(job?.gcodeOut ?? null) ?? '—'
  const lastStatusLabel = job ? DASHBOARD_STATUS_LABELS[statusFromJob(job)] : 'No jobs yet'

  // Live chips (K2 only) — printing filename + progress + ETA.
  const liveChips: React.ReactElement[] = []
  if (cardId === 'creality-k2-plus' && k2Live) {
    if (k2Live.filename) {
      liveChips.push(
        <span key="filename" className="workshop-dashboard__chip workshop-dashboard__chip--filename">
          {fileBasename(k2Live.filename) ?? k2Live.filename}
        </span>
      )
    }
    const pct = formatProgressPercent(k2Live.progress)
    if (pct !== null) {
      liveChips.push(
        <span key="pct" className="workshop-dashboard__chip">
          {pct}
        </span>
      )
    }
    const eta = formatEta(k2Live.etaSeconds)
    if (eta !== null) {
      liveChips.push(
        <span key="eta" className="workshop-dashboard__chip">
          ETA {eta}
        </span>
      )
    }
  }

  // One quick action per card. Kept conditional + button-disabled so a
  // missing precondition surfaces visibly rather than silently no-op'ing.
  let quickAction: React.ReactElement | null = null
  if (cardId === 'creality-k2-plus' && onSendLatestSlice) {
    quickAction = (
      <button
        type="button"
        className="workshop-dashboard__action btn btn-ghost btn-sm"
        disabled={!canSendLatestSlice}
        onClick={onSendLatestSlice}
        title={
          canSendLatestSlice
            ? 'Send the latest sliced G-code to the K2 Plus via Moonraker'
            : 'Slice a job and configure the Moonraker URL under Settings'
        }
        data-action="send-latest-slice"
      >
        {'→'} Send latest slice
      </button>
    )
  } else if (cardId === 'laguna-swift-5x10' && onOpenSetupSheet) {
    quickAction = (
      <button
        type="button"
        className="workshop-dashboard__action btn btn-ghost btn-sm"
        disabled={!job}
        onClick={onOpenSetupSheet}
        title={
          job
            ? 'Open / regenerate the setup sheet for the latest Laguna job'
            : 'Create a Laguna job first'
        }
        data-action="open-setup-sheet"
      >
        {'\u{1F4CB}'} Open setup sheet
      </button>
    )
  } else if (cardId === 'makera-carvera' && onSendToCarvera) {
    const hasGcode = Boolean(job?.gcodeOut)
    quickAction = (
      <button
        type="button"
        className="workshop-dashboard__action btn btn-ghost btn-sm"
        disabled={!hasGcode}
        onClick={onSendToCarvera}
        title={
          hasGcode
            ? 'Upload the latest Carvera G-code via the Carvera CLI'
            : 'Generate G-code for a Carvera job first'
        }
        data-action="send-to-carvera"
      >
        {'→'} Send to Carvera
      </button>
    )
  }

  return (
    <section
      className={`workshop-dashboard__card${isCurrent ? ' workshop-dashboard__card--current' : ''}`}
      data-card-id={cardId}
      aria-label={name}
      // `role="listitem"` pairs with the grid container's `role="list"`
      // so the dashboard reads as a well-formed list to screen readers
      // (ARIA requires listitem children when an ancestor declares list).
      role="listitem"
    >
      <header className="workshop-dashboard__card-header">
        <div className="workshop-dashboard__card-titleblock">
          <h3 className="workshop-dashboard__card-name">{name}</h3>
          <div className="workshop-dashboard__card-subtitle">{subtitle}</div>
        </div>
        {isCurrent && (
          <span
            className="workshop-dashboard__badge"
            aria-label="Active session machine"
          >
            Active
          </span>
        )}
      </header>

      <div className="workshop-dashboard__status-row">
        <StatusDot status={status} />
        <span className="workshop-dashboard__status-label">
          {DASHBOARD_STATUS_LABELS[status]}
        </span>
      </div>

      {liveChips.length > 0 && (
        <div className="workshop-dashboard__chip-row" aria-label="Live print info">
          {liveChips}
        </div>
      )}

      <dl className="workshop-dashboard__last-row" aria-label="Last outcome">
        <dt className="workshop-dashboard__last-key">Last:</dt>
        <dd className="workshop-dashboard__last-val">
          <span className="workshop-dashboard__last-file" title={job?.gcodeOut ?? undefined}>
            {lastFile}
          </span>
          <span className="workshop-dashboard__last-status">
            {' · '}{lastStatusLabel}
          </span>
        </dd>
      </dl>

      {quickAction && (
        <div className="workshop-dashboard__action-row">
          {quickAction}
        </div>
      )}
    </section>
  )
}

/**
 * Default polling interval — 5 seconds per the Gap #10 spec
 * ("driven by `moonrakerStatus()` polling every 5s").
 */
export const DEFAULT_POLL_INTERVAL_MS = 5000

export function WorkshopDashboard(props: WorkshopDashboardProps): React.ReactElement {
  const {
    jobs, moonrakerUrl, currentMachineId,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onSendLatestSlice, onOpenSetupSheet, onSendToCarvera, onCreateProject,
    fab
  } = props

  // Live K2 state from `moonrakerStatus` polls. `null` means we never
  // got a successful poll (no URL configured, network unreachable, etc.)
  // and the K2 card falls back to job-derived status.
  const [k2Live, setK2Live] = useState<K2LiveState | null>(null)

  // Stable bridge reference so the effect deps stay narrow.
  const fabRef = useRef<WorkshopDashboardFabBridge>(fab ?? defaultFab())
  useEffect(() => {
    fabRef.current = fab ?? defaultFab()
  }, [fab])

  // 5-second Moonraker poll. Lifecycle bound to the dashboard mount:
  // start on mount when a URL is configured, stop on unmount or URL change.
  // `pollIntervalMs === Number.MAX_SAFE_INTEGER` short-circuits the
  // recurring tick (used by the render-contract test to keep the
  // component pure during static snapshot).
  useEffect(() => {
    const url = moonrakerUrl?.trim()
    if (!url) {
      setK2Live(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const runPoll = async (): Promise<void> => {
      try {
        const r = await fabRef.current.moonrakerStatus(url)
        if (cancelled) return
        if (r.ok) {
          setK2Live({
            rawState: r.rawState ?? r.state ?? null,
            filename: r.filename ?? null,
            progress: typeof r.progress === 'number' ? r.progress : null,
            etaSeconds: typeof r.etaSeconds === 'number' ? r.etaSeconds : null
          })
        } else {
          // Soft-fall to the empty state so the card returns to
          // job-derived status until the next successful poll.
          setK2Live(EMPTY_K2_STATE)
        }
      } catch {
        if (!cancelled) setK2Live(EMPTY_K2_STATE)
      }
    }

    // Kick off an immediate poll so the card lights up without a
    // 5-second delay on mount.
    void runPoll()
    if (Number.isFinite(pollIntervalMs) && pollIntervalMs < Number.MAX_SAFE_INTEGER) {
      timer = setInterval(() => { void runPoll() }, pollIntervalMs)
    }

    return () => {
      cancelled = true
      if (timer !== null) clearInterval(timer)
    }
  }, [moonrakerUrl, pollIntervalMs])

  // Per-card derivations. `useMemo` is overkill for a 3-element list
  // but keeps the render predictable and matches the project's style.
  const cards = useMemo(() => {
    return DASHBOARD_CARD_IDS.map((cardId) => {
      const job = latestJobForCard(jobs, cardId)
      // K2 baseline = job-derived; if Moonraker gave us a state, that
      // overrides because the printer is the ground truth.
      let status = statusFromJob(job)
      if (cardId === 'creality-k2-plus' && k2Live) {
        const live = k2StatusKindFromMoonraker(k2Live.rawState)
        if (live !== null) status = live
      }
      // Laguna: bump idle -> setup-required when gcodeOut exists.
      // Setup-sheet generation is encouraged but not auto-tracked; the
      // pseudo-state nudges the operator to either run the setup sheet
      // OR clear the job before walking to the machine.
      if (cardId === 'laguna-swift-5x10' && status === 'done' && job?.gcodeOut) {
        status = 'setup-required'
      }
      const isCurrent =
        currentMachineId !== null &&
        (
          (cardId === 'laguna-swift-5x10' && currentMachineId === 'laguna-swift-5x10') ||
          (cardId === 'creality-k2-plus' && currentMachineId === 'creality-k2-plus') ||
          (cardId === 'makera-carvera' && (
            currentMachineId === 'makera-carvera-3axis' ||
            currentMachineId === 'makera-carvera-4axis'
          ))
        )
      return { cardId, job, status, isCurrent }
    })
  }, [jobs, k2Live, currentMachineId])

  // K2 "Send latest slice" precondition. Uses the LATEST K2 job's
  // `gcodeOut` (which is the most recent successful CAM / slice run
  // for the K2) and the configured Moonraker URL from app settings.
  const k2Job = cards.find((c) => c.cardId === 'creality-k2-plus')?.job ?? null
  const k2CanSend = k2CanSendLatestSlice({
    lastSliceGcodePath: k2Job?.gcodeOut ?? null,
    moonrakerUrl
  })

  return (
    <div className="workshop-dashboard" role="region" aria-label="Workshop dashboard">
      <header className="workshop-dashboard__header">
        <h2 className="workshop-dashboard__title">Workshop</h2>
        <p className="workshop-dashboard__sub">
          One view of all three machines: status, last outcome, and a single quick action per machine.
        </p>
      </header>
      <div
        className="workshop-dashboard__grid"
        role="list"
        aria-label="Machine status cards"
      >
        {cards.map(({ cardId, job, status, isCurrent }) => (
          <WorkshopCard
            key={cardId}
            cardId={cardId}
            job={job}
            status={status}
            isCurrent={isCurrent}
            k2Live={cardId === 'creality-k2-plus' ? k2Live : null}
            canSendLatestSlice={k2CanSend}
            onSendLatestSlice={
              cardId === 'creality-k2-plus' && k2Job?.gcodeOut && onSendLatestSlice
                ? () => onSendLatestSlice(k2Job.gcodeOut as string)
                : undefined
            }
            onOpenSetupSheet={
              cardId === 'laguna-swift-5x10' && job && onOpenSetupSheet
                ? () => onOpenSetupSheet(job)
                : undefined
            }
            onSendToCarvera={
              cardId === 'makera-carvera' && job && onSendToCarvera
                ? () => onSendToCarvera(job)
                : undefined
            }
          />
        ))}
      </div>
      {/*
       * UX Overhaul #8 — shared `EmptyState` block surfaces only when the
       * dashboard has zero jobs across all three machines. The three
       * cards above still render (each shows "No jobs yet" in its Last:
       * row) so the operator sees the machine roster, but this block
       * gives a one-click path back to the project-creation flow.
       *
       * The CTA is gated on `onCreateProject` being wired — when the
       * parent has no create flow (e.g., the dashboard render-pin
       * fixture) the block still renders the message but omits the
       * button, so the surface stays honest.
       */}
      {jobs.length === 0 ? (
        <EmptyState
          testId="workshop-dashboard-empty-state"
          title="No jobs yet"
          body="Create your first project to see machine status here."
          cta={
            onCreateProject
              ? { label: 'Create project', onClick: onCreateProject, variant: 'primary' }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}

export default WorkshopDashboard
