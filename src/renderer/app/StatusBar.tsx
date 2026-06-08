import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { fab } from '../src/shop-types'
import type { WorkspaceId } from './useWorkspaceRouter'

const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  design: 'Design',
  assemble: 'Assemble',
  manufacture: 'Make',
  drawings: 'Drawings',
  workshop: 'Workshop',
  utilities: 'Utilities'
}

/**
 * Live sidecar health, derived from the one honest signal we have: the startup
 * Python dependency probe (`fab().pythonDepsCheck()` → `pythonDeps:check`),
 * which round-trips a `ping` to `engines/sidecar/main.py` and only reports
 * success when CadQuery / OpenCAMLib / numpy / trimesh all import.
 *
 *  - `unknown` — not probed yet, or the probe channel is unavailable in this
 *    build. We show this honestly rather than faking "ready".
 *  - `ready`   — the sidecar answered and every required import resolved.
 *  - `error`   — the probe ran but Python is unreachable or a dep is missing.
 */
type SidecarHealth = 'unknown' | 'ready' | 'error'

/**
 * Structural view of the `pythonDeps:check` outcome (mirrors the main-process
 * `PythonDepCheckOutcome`). Declared locally so the renderer does not import
 * from `src/main/*` (which can drag node-only deps into the bundle) — we only
 * read the two booleans the status dot needs.
 */
type PythonDepCheckOutcomeView =
  | { checked: true; result: { ok: boolean; pythonOk: boolean } }
  | { checked: false; error: string }

/** Narrow view of the preload bridge's health channel (not in `window.fab`). */
interface HealthBridge {
  pythonDepsCheck?: () => Promise<PythonDepCheckOutcomeView>
}

/** Loose view of the `settings:get` record — `units` arrives as `unknown`. */
interface SettingsBridge {
  settingsGet?: () => Promise<Record<string, unknown>>
}

/**
 * Probe the sidecar once on mount and report its health. One-shot rather than a
 * heartbeat: the main-process check is cached after its first call, and a
 * single honest "is the engine usable" read is what the status dot reflects.
 * Never throws — any failure (no channel, spawn error, timeout) degrades to the
 * honest `unknown`/`error` state instead of a faked "ready".
 */
function useSidecarHealth(): SidecarHealth {
  const [health, setHealth] = useState<SidecarHealth>('unknown')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bridge = fab() as unknown as HealthBridge
        const check = bridge.pythonDepsCheck
        if (typeof check !== 'function') return // leave 'unknown' — honest
        const outcome = await check()
        if (cancelled) return
        if (outcome.checked && outcome.result.ok && outcome.result.pythonOk) {
          setHealth('ready')
        } else {
          setHealth('error')
        }
      } catch {
        if (!cancelled) setHealth('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return health
}

/**
 * Resolve the document display unit. Reads `settings.units` (the General →
 * display-unit hint) once on mount, falling back to the `fallback` the shell
 * passes (the CLAUDE.md `mm` default) until settings load — so the read-out is
 * a real value, never a hard-coded literal.
 */
function useDisplayUnits(fallback: 'mm' | 'inch'): 'mm' | 'inch' {
  const [units, setUnits] = useState<'mm' | 'inch'>(fallback)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bridge = fab() as unknown as SettingsBridge
        const get = bridge.settingsGet
        if (typeof get !== 'function') return
        const settings = await get()
        if (cancelled) return
        const v = settings.units
        if (v === 'mm' || v === 'inch') setUnits(v)
      } catch {
        // Keep the fallback — a settings read failure is not worth a toast here.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return units
}

const SIDECAR_LABEL: Record<SidecarHealth, ReactElement> = {
  unknown: <b>checking…</b>,
  ready: <b>ready</b>,
  error: <b>unavailable</b>
}

/** Themed dot colour per health state (inline so no new CSS class is needed). */
const SIDECAR_DOT_STYLE: Record<SidecarHealth, CSSProperties> = {
  unknown: { background: 'var(--warn)' },
  ready: { background: 'var(--ok)' },
  error: { background: 'var(--err)' }
}

/**
 * Honest placeholder for a cursor/selection coordinate. There is no live
 * viewport cursor source in the shell yet (the functional `Viewport3D` is
 * mounted in FG-2), so we render an em dash rather than a faked `0.00`.
 */
const NO_COORD = '—'

export function StatusBar({
  machineName,
  units,
  activeWorkspace
}: {
  machineName: string | null
  units: 'mm' | 'inch'
  activeWorkspace: WorkspaceId
}): ReactElement {
  const sidecar = useSidecarHealth()
  const displayUnits = useDisplayUnits(units)

  const sidecarTitle =
    sidecar === 'ready'
      ? 'Python sidecar reachable; CAD/CAM engine imports resolved'
      : sidecar === 'error'
        ? 'Python sidecar unreachable or a required dependency is missing'
        : 'Checking the Python sidecar…'

  return (
    <footer className="wt-status" role="contentinfo">
      <span className="wt-status__item" title={sidecarTitle}>
        <span className="wt-status__dot" style={SIDECAR_DOT_STYLE[sidecar]} />
        Sidecar {SIDECAR_LABEL[sidecar]}
      </span>
      <span className="wt-status__item">
        Units <b>{displayUnits}</b>
      </span>
      <span className="wt-status__item">
        Workspace <b>{WORKSPACE_LABEL[activeWorkspace]}</b>
      </span>
      <span className="wt-status__spacer" />
      <span className="wt-status__item">
        X <b>{NO_COORD}</b>
      </span>
      <span className="wt-status__item">
        Y <b>{NO_COORD}</b>
      </span>
      <span className="wt-status__item">
        Z <b>{NO_COORD}</b>
      </span>
      <span className="wt-status__item wt-status__item--machine">{machineName ?? 'No machine'}</span>
    </footer>
  )
}
