/**
 * AppHeader — fixed-top app-wide status strip (Mainsail/Fluidd pattern).
 *
 * UX MOVE 7. A locked global status strip that pins to the top of the
 * Control Center shell. It surfaces the live machine state at a glance
 * and exposes an optional E-stop affordance.
 *
 *   - Left   : StatusDot + state label (reuses the dashboard's status
 *              color/label map so the 8 status kinds render identically
 *              everywhere). For the K2 Plus, the state derives from the
 *              SAME 5-second `moonrakerStatus` poll the WorkshopDashboard
 *              uses (logic shared via `workshop-dashboard-helpers.ts`).
 *   - Center : Active machine ID in mono font (e.g. `creality-k2-plus`).
 *              Falls back to `No machine` when no session machine has
 *              been picked.
 *   - Right  : E-stop button. Renders ONLY when `onEstop` is supplied
 *              AND a `currentMachineId` is active. V2 will wire actual
 *              M112 / M5 commands; for now the callback is invoked and
 *              the parent decides what to do.
 *
 * The strip is intentionally above the legacy brand-bar so the machine
 * state never scrolls out of sight — operators always know what the
 * active machine is doing.
 *
 * UX MOVE 9 — the legacy "control center" header (machine pill, env
 * triad, action buttons, file actions) is preserved as `ShopBrandBar`
 * exported from this same file. The pin test in
 * `shop-app-toolbar-button-types.test.ts` parses this file directly and
 * MUST keep finding the `cc-header__*` button bodies — keeping
 * `ShopBrandBar` here keeps that contract intact while letting the new
 * AppHeader own the status-strip surface.
 */
import React, { useEffect, useRef, useState } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { MachineUIMode, Job } from './shop-types'
import { MODE_ICONS } from './shop-types'
import { ENVIRONMENT_LIST, type EnvironmentId } from './environments/registry'
import type { ShopEnvironment } from './environments/registry'
import {
  DASHBOARD_STATUS_COLORS,
  DASHBOARD_STATUS_LABELS,
  type DashboardStatusKind,
  k2StatusKindFromMoonraker,
  latestJobForCard,
  statusFromJob
} from '../dashboard/workshop-dashboard-helpers'

// ── Status-strip Moonraker bridge ───────────────────────────────────────
/**
 * Subset of the preload `fab` surface the status strip depends on.
 * Inlined here so the AppHeader render-pin test can supply a narrow
 * mock without dragging the full Electron API surface into the vitest
 * fixture (mirrors `WorkshopDashboardFabBridge`).
 */
export interface AppHeaderFabBridge {
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

/**
 * Pull the live `fab` bridge from `window` at render time. Falls back
 * to a no-op stub when running outside Electron (the node-vitest
 * environment never has `window.fab` — tests pass a stub directly).
 */
function defaultFab(): AppHeaderFabBridge {
  const w = (globalThis as { window?: { fab?: AppHeaderFabBridge } }).window
  if (w?.fab && typeof w.fab.moonrakerStatus === 'function') return w.fab
  return {
    moonrakerStatus: () => Promise.resolve({ ok: false, error: 'no-window' })
  }
}

/**
 * Default polling interval — 5 seconds, matching the WorkshopDashboard
 * so the two surfaces stay perfectly in sync.
 */
export const APP_HEADER_POLL_INTERVAL_MS = 5000

// ── Public props ────────────────────────────────────────────────────────

export interface AppHeaderProps {
  /** Machine ID for the active session (e.g. `creality-k2-plus`). Empty/null when nothing is selected. */
  readonly currentMachineId: string | null
  /** Current job list — used to derive state for non-FDM machines (Laguna / Carvera). */
  readonly jobs: readonly Job[]
  /** Configured Moonraker URL from `appSettings.moonrakerUrl`, or null. */
  readonly moonrakerUrl: string | null
  /**
   * Optional E-stop callback. When supplied AND `currentMachineId` is
   * non-empty, the right side renders an E-stop button. V2 will wire
   * the actual M112 / M5 commands.
   */
  readonly onEstop?: () => void
  /**
   * Polling override for tests — passing `Number.MAX_SAFE_INTEGER` runs
   * exactly one initial poll and skips the recurring tick so
   * `renderToStaticMarkup` produces a deterministic snapshot.
   */
  readonly pollIntervalMs?: number
  /**
   * Test-only bridge. Production uses the runtime `window.fab` accessor.
   */
  readonly fab?: AppHeaderFabBridge
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isK2Plus(machineId: string | null): boolean {
  return machineId === 'creality-k2-plus'
}

/**
 * Derive a machine's status purely from the latest matching Job in the
 * provided list. The "latest" lookup uses `latestJobForCard` so the
 * Carvera 3-axis + 4-axis variants are bucketed together (same physical
 * machine, two modes).
 */
function statusFromJobsForMachine(
  jobs: readonly Job[],
  machineId: string | null
): DashboardStatusKind {
  if (!machineId) return 'idle'
  if (machineId === 'laguna-swift-5x10') {
    return statusFromJob(latestJobForCard(jobs, 'laguna-swift-5x10'))
  }
  if (machineId === 'creality-k2-plus') {
    return statusFromJob(latestJobForCard(jobs, 'creality-k2-plus'))
  }
  if (machineId === 'makera-carvera-3axis' || machineId === 'makera-carvera-4axis') {
    return statusFromJob(latestJobForCard(jobs, 'makera-carvera'))
  }
  // Off-list machine — surface the most recent job that targets it.
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].machineId === machineId) return statusFromJob(jobs[i])
  }
  return 'idle'
}

// ── Status dot (matches WorkshopDashboard convention) ───────────────────

function StatusDot({ status }: { readonly status: DashboardStatusKind }): React.ReactElement {
  const color = DASHBOARD_STATUS_COLORS[status]
  const label = DASHBOARD_STATUS_LABELS[status]
  return (
    <span
      className="app-header__status-dot"
      role="img"
      aria-label={label}
      title={label}
      style={{ backgroundColor: color }}
    />
  )
}

// ── AppHeader (the new status strip) ────────────────────────────────────

export function AppHeader(props: AppHeaderProps): React.ReactElement {
  const {
    currentMachineId,
    jobs,
    moonrakerUrl,
    onEstop,
    pollIntervalMs = APP_HEADER_POLL_INTERVAL_MS,
    fab
  } = props

  // Live K2 state from `moonrakerStatus`. `null` means we have not had
  // a successful poll (no URL, network unreachable, etc.) so the strip
  // falls back to the job-derived status.
  const [k2RawState, setK2RawState] = useState<string | null>(null)

  // Stable bridge reference so the effect deps stay narrow.
  const fabRef = useRef<AppHeaderFabBridge>(fab ?? defaultFab())
  useEffect(() => {
    fabRef.current = fab ?? defaultFab()
  }, [fab])

  // 5-second Moonraker poll — only when the active machine is the K2
  // Plus AND a URL is configured. Mirrors the WorkshopDashboard pattern
  // so the strip and the dashboard agree on the printer state. Cleanup
  // clears the interval on unmount, URL change, or machine change.
  const url = moonrakerUrl?.trim() ?? ''
  const k2Selected = isK2Plus(currentMachineId)
  useEffect(() => {
    if (!k2Selected || url.length === 0) {
      setK2RawState(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const runPoll = async (): Promise<void> => {
      try {
        const r = await fabRef.current.moonrakerStatus(url)
        if (cancelled) return
        if (r.ok) {
          setK2RawState(r.rawState ?? r.state ?? null)
        } else {
          setK2RawState(null)
        }
      } catch {
        if (!cancelled) setK2RawState(null)
      }
    }

    void runPoll()
    if (Number.isFinite(pollIntervalMs) && pollIntervalMs < Number.MAX_SAFE_INTEGER) {
      timer = setInterval(() => { void runPoll() }, pollIntervalMs)
    }
    return () => {
      cancelled = true
      if (timer !== null) clearInterval(timer)
    }
  }, [k2Selected, url, pollIntervalMs])

  // Resolve the displayed status. Baseline = job-derived; K2 + live
  // Moonraker raw state overrides because the printer is the ground
  // truth (matches WorkshopDashboard's resolution order).
  let status: DashboardStatusKind = statusFromJobsForMachine(jobs, currentMachineId)
  if (k2Selected && k2RawState !== null) {
    const live = k2StatusKindFromMoonraker(k2RawState)
    if (live !== null) status = live
  }

  const machineLabel = currentMachineId && currentMachineId.length > 0
    ? currentMachineId
    : 'No machine'

  const showEstop = Boolean(onEstop) && currentMachineId !== null && currentMachineId.length > 0

  return (
    <div
      className="app-header"
      role="banner"
      aria-label="Machine status"
      data-status={status}
    >
      {/* Left — status dot + state label */}
      <div className="app-header__left">
        <StatusDot status={status} />
        <span className="app-header__status-label">
          {DASHBOARD_STATUS_LABELS[status]}
        </span>
      </div>

      {/* Center — machine ID in mono */}
      <div className="app-header__center">
        <span
          className="app-header__machine-id"
          aria-label={`Active machine: ${machineLabel}`}
          title={machineLabel}
        >
          {machineLabel}
        </span>
      </div>

      {/* Right — E-stop (conditional) */}
      <div className="app-header__right">
        {showEstop && (
          <button
            type="button"
            className="app-header__estop"
            onClick={onEstop}
            title="Emergency stop"
            aria-label="Emergency stop"
            data-action="estop"
          >
            E-STOP
          </button>
        )}
      </div>
    </div>
  )
}

// ── ShopBrandBar (preserved legacy Control Center header) ───────────────
// The original `AppHeader` component (machine pill + env triad + actions)
// is preserved verbatim here as `ShopBrandBar`. The
// `shop-app-toolbar-button-types.test.ts` pin parses this file for every
// `cc-header__*` button opening tag, so keeping the markup in the same
// file keeps that contract intact.

export interface ShopBrandBarProps {
  sessionMachine: MachineProfile | null
  activeEnv: ShopEnvironment | null
  mode: MachineUIMode
  activeJob: Job | null
  running: boolean
  isFdm: boolean
  savedIndicator: boolean
  /**
   * UX MOVE 9 — when true, the new Design pill renders with
   * `data-active="true"` so the CSS modifier styles the pressed state.
   * The pill always renders; this flag drives the pressed indicator.
   */
  designOpen: boolean

  onSwitchEnv: (envId: EnvironmentId) => void
  onChangeMachine: () => void
  onCmdOpen: () => void
  onShortcuts: () => void
  onHelp: () => void
  onGenerate: () => void
  onSendToPrinter: () => void
  onGcodeView: () => void
  onGcodeExport: () => void
  onGcodeOpenFile: () => void
  onImportModel: () => void
  onNewProject: () => void
  onOpenProject: () => void
  onSaveProject: () => void
  onSetupSheet: () => void
  /** UX MOVE 9 — toggle the Design overlay. */
  onToggleDesign: () => void
}

export function ShopBrandBar({
  sessionMachine, activeEnv, mode, activeJob, running, isFdm, savedIndicator, designOpen,
  onSwitchEnv, onChangeMachine, onCmdOpen, onShortcuts, onHelp,
  onGenerate, onSendToPrinter, onGcodeView, onGcodeExport, onGcodeOpenFile,
  onImportModel, onNewProject, onOpenProject, onSaveProject, onSetupSheet,
  onToggleDesign
}: ShopBrandBarProps): React.ReactElement {
  // `onHelp` is a registered prop but the legacy header doesn't surface
  // a dedicated Help icon — the F1 shortcut and NavRail's help button
  // cover it. The prop stays in the type so the ShopApp wiring doesn't
  // need to thread two header components with diverging contracts.
  void onHelp
  return (
    <header className="cc-header shop-brand-bar" role="banner">
      {/* Left: Brand + machine selector */}
      <div className="cc-header__left">
        <span className="cc-header__logo" aria-hidden="true">
          {activeEnv?.iconGlyph ?? '◆'}
        </span>
        <span className="cc-header__brand">WorkTrackCAM</span>
        <button
          type="button"
          className="cc-header__machine-btn"
          onClick={onChangeMachine}
          title={sessionMachine ? `${sessionMachine.name} — click to change` : 'Select machine'}
        >
          <span className="cc-header__machine-icon" aria-hidden="true">{MODE_ICONS[mode]}</span>
          <span className="cc-header__machine-name">
            {sessionMachine?.name ?? 'No machine'}
          </span>
          <span className="cc-header__machine-chevron" aria-hidden="true">▾</span>
        </button>
      </div>

      {/* Center: Env quick-switch + Design pill */}
      <div className="cc-header__center">
        <div
          className="cc-header__env-switch shop-brand-bar__env-switcher"
          role="group"
          aria-label="Environment quick-switch"
        >
          {ENVIRONMENT_LIST.map(env => {
            const isActive = activeEnv?.id === env.id
            return (
              <button
                key={env.id}
                type="button"
                data-environment={env.id}
                className={`cc-header__env-btn${isActive ? ' cc-header__env-btn--active' : ''}`}
                aria-pressed={isActive}
                title={`Switch to ${env.name}`}
                onClick={() => onSwitchEnv(env.id)}
              >
                <span aria-hidden="true">{env.iconGlyph}</span>
                <span>{env.name}</span>
              </button>
            )
          })}
        </div>
        {/* UX MOVE 9 — Design pill, sibling to (NOT inside) the env triad. */}
        <button
          type="button"
          className="shop-brand-bar__design-pill"
          data-active={designOpen ? 'true' : 'false'}
          aria-pressed={designOpen}
          onClick={onToggleDesign}
          title="Open Design workspace (Ctrl+Shift+D)"
        >
          <span aria-hidden="true">✎</span>
          <span> Design</span>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="cc-header__right">
        {/* Generate / Slice */}
        <button
          type="button"
          className="cc-header__generate-btn"
          disabled={running || !activeJob}
          onClick={onGenerate}
          title={isFdm ? 'Slice (Ctrl+Enter)' : 'Generate G-code (Ctrl+Enter)'}
        >
          {running
            ? <><span className="spinner spinner--sm" /> Running{'…'}</>
            : isFdm ? '▶ Slice' : '▶ Generate'}
        </button>

        {/* Send */}
        {isFdm && (
          <button
            type="button"
            className="cc-header__action-btn"
            disabled={!activeJob?.gcodeOut}
            onClick={onSendToPrinter}
            title="Send G-code to printer via Moonraker"
          >
            {'→'} Send
          </button>
        )}

        {/* G-code actions */}
        {activeJob?.gcodeOut && (
          <div className="cc-header__gcode-group">
            <button type="button" className="cc-header__sm-btn" onClick={onGcodeView} title="View G-code">
              G-code
            </button>
            <button type="button" className="cc-header__sm-btn" onClick={onGcodeExport} title="Export G-code copy">
              Export{'…'}
            </button>
            <button type="button" className="cc-header__sm-btn" onClick={onGcodeOpenFile} title="Open in default app">
              Open
            </button>
          </div>
        )}

        <span className="cc-header__sep" />

        {/* File actions */}
        <button type="button" className="cc-header__icon-btn" onClick={onImportModel} disabled={!activeJob} title="Import model" aria-label="Import model">
          {'\u{1F4E5}'}
        </button>
        {!isFdm && activeJob && (
          <button type="button" className="cc-header__icon-btn" onClick={onSetupSheet} title="Setup sheet" aria-label="Setup sheet">
            {'\u{1F4CB}'}
          </button>
        )}
        <button type="button" className="cc-header__icon-btn" onClick={onNewProject} title="New project (Ctrl+N)" aria-label="New project">
          {'\u{1F4C4}'}
        </button>
        <button type="button" className="cc-header__icon-btn" onClick={onOpenProject} title="Open project (Ctrl+O)" aria-label="Open project">
          {'\u{1F4C2}'}
        </button>
        <button
          type="button"
          className={`cc-header__icon-btn${savedIndicator ? ' cc-header__icon-btn--saved' : ''}`}
          onClick={onSaveProject}
          title="Save (Ctrl+S)"
          aria-label="Save"
        >
          {savedIndicator ? '✓' : '\u{1F4BE}'}
        </button>

        <span className="cc-header__sep" />

        <button type="button" className="cc-header__icon-btn" onClick={onCmdOpen} title="Command palette (Ctrl+K)" aria-label="Command palette">
          {'⌘'}
        </button>
        <button type="button" className="cc-header__icon-btn" onClick={onShortcuts} title="Shortcuts (Ctrl+Shift+?)" aria-label="Keyboard shortcuts">
          ?
        </button>
      </div>
    </header>
  )
}
