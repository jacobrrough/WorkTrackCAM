/**
 * FdmDeviceControls — live K2 Plus job controls (Wave-3b).
 *
 * Pause / Resume / Cancel buttons that call the existing Moonraker IPC
 * (`moonraker:pause` / `:resume` / `:cancel`) on the configured printer URL.
 * Mounted in the Manufacture → Device stage beside the Send-to-K2 surface.
 *
 * GATING (honest enablement):
 *   - The whole control row only renders for the K2 Plus (FDM). The parent
 *     passes `printerUrl` from `AppSettings.moonrakerUrl`; an empty URL ⇒ a
 *     clear "configure Moonraker" hint and disabled buttons (no IPC fires).
 *   - The buttons additionally key off a polled job `state`:
 *       • Pause   enabled when printing.
 *       • Resume  enabled when paused.
 *       • Cancel  enabled when printing OR paused.
 *     When idle / disconnected / unknown all three are disabled — there is no
 *     job to act on, and we never pretend otherwise.
 *
 * SAFETY: these are remote MACHINE-CONTROL actions, not G-code generation.
 * They move NO temperature targets and emit NO G-code; they hand the verb
 * straight to the Moonraker `/printer/print/{pause,resume,cancel}` endpoints
 * via the proven IPC. The `fdm_passthrough` post + the pre-upload
 * temperature-validator gate are entirely untouched by this surface.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** Live print state, narrowed to the values that gate the job controls. */
export type FdmJobState =
  | 'printing'
  | 'paused'
  | 'idle'
  | 'complete'
  | 'error'
  | 'unknown'

/**
 * Map a raw Moonraker `print_stats.state` (or the `moonraker:status` `state`
 * field) to our narrowed {@link FdmJobState}. Moonraker reports `printing`,
 * `paused`, `complete`, `cancelled`, `error`, `standby`. Anything else (or a
 * failed status probe) collapses to `unknown` so the controls stay disabled
 * rather than guessing.
 */
export function mapMoonrakerState(raw: string | null | undefined): FdmJobState {
  switch ((raw ?? '').toLowerCase()) {
    case 'printing':
      return 'printing'
    case 'paused':
      return 'paused'
    case 'complete':
      return 'complete'
    case 'cancelled':
    case 'standby':
      return 'idle'
    case 'error':
      return 'error'
    default:
      return 'unknown'
  }
}

export interface FdmDeviceControlsProps {
  /** Moonraker base URL (`AppSettings.moonrakerUrl`); blank ⇒ disabled. */
  readonly printerUrl: string
  /** Status line callback (toast / status bar). */
  readonly onStatus?: (msg: string) => void
}

/** Result envelope shared by the three Moonraker job-control IPC calls. */
type JobControlResult = { ok: boolean; error?: string }

export function FdmDeviceControls({ printerUrl, onStatus }: FdmDeviceControlsProps): ReactNode {
  const url = printerUrl.trim()
  const hasUrl = url.length > 0
  const [jobState, setJobState] = useState<FdmJobState>('unknown')
  const [busy, setBusy] = useState(false)
  // Guard against setState after unmount across the async IPC + poll.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** Poll the printer once for its live job state (no-op without a URL). */
  const refreshState = useCallback(async (): Promise<void> => {
    if (!hasUrl) {
      setJobState('unknown')
      return
    }
    try {
      const r = await window.fab.moonrakerStatus(url)
      if (!mountedRef.current) return
      setJobState(r.ok ? mapMoonrakerState(r.state) : 'unknown')
    } catch {
      if (mountedRef.current) setJobState('unknown')
    }
  }, [hasUrl, url])

  // Poll on mount + whenever the URL changes, then every 5s while mounted so
  // the buttons reflect the live job without an operator refresh.
  useEffect(() => {
    void refreshState()
    if (!hasUrl) return
    const id = window.setInterval(() => void refreshState(), 5000)
    return () => window.clearInterval(id)
  }, [hasUrl, refreshState])

  /**
   * Dispatch one job-control verb. Shared by the three buttons: fire the IPC,
   * surface the result, then re-poll so the button states settle to the new
   * job state. Never throws — a transport error folds into a status message.
   */
  const dispatch = useCallback(
    async (
      verb: 'pause' | 'resume' | 'cancel',
      call: (printerUrl: string) => Promise<JobControlResult>
    ): Promise<void> => {
      if (!hasUrl || busy) return
      setBusy(true)
      try {
        const r = await call(url)
        if (r.ok) {
          onStatus?.(`K2 Plus: ${verb} sent.`)
        } else {
          onStatus?.(`K2 Plus ${verb} failed${r.error ? `: ${r.error}` : ''}.`)
        }
      } catch (e) {
        onStatus?.(`K2 Plus ${verb} failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (mountedRef.current) setBusy(false)
        await refreshState()
      }
    },
    [hasUrl, busy, url, onStatus, refreshState]
  )

  const isPrinting = jobState === 'printing'
  const isPaused = jobState === 'paused'
  const canPause = hasUrl && !busy && isPrinting
  const canResume = hasUrl && !busy && isPaused
  const canCancel = hasUrl && !busy && (isPrinting || isPaused)

  const stateLabel: Record<FdmJobState, string> = {
    printing: 'Printing',
    paused: 'Paused',
    idle: 'Idle',
    complete: 'Complete',
    error: 'Error',
    unknown: hasUrl ? 'Unknown' : 'Not connected'
  }

  return (
    <section
      className="panel workspace-util-panel fdm-device-controls"
      aria-labelledby="fdm-device-controls-heading"
      data-testid="fdm-device-controls"
    >
      <h3 id="fdm-device-controls-heading">Live job controls</h3>
      {hasUrl ? (
        <p className="msg msg--muted" data-testid="fdm-device-controls-state" role="status">
          Printer state: <strong>{stateLabel[jobState]}</strong>
        </p>
      ) : (
        <p className="msg" data-testid="fdm-device-controls-no-url">
          Add a Moonraker URL in File → Settings to control the running print.
        </p>
      )}
      <div className="row fdm-device-controls-row" role="group" aria-label="Print job controls">
        <button
          type="button"
          className="secondary"
          data-testid="fdm-device-pause"
          disabled={!canPause}
          title={canPause ? 'Pause the running print' : 'No running print to pause'}
          onClick={() => void dispatch('pause', (u) => window.fab.moonrakerPause(u))}
        >
          Pause
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="fdm-device-resume"
          disabled={!canResume}
          title={canResume ? 'Resume the paused print' : 'No paused print to resume'}
          onClick={() => void dispatch('resume', (u) => window.fab.moonrakerResume(u))}
        >
          Resume
        </button>
        <button
          type="button"
          className="secondary fdm-device-cancel"
          data-testid="fdm-device-cancel"
          disabled={!canCancel}
          title={canCancel ? 'Cancel the running print' : 'No active print to cancel'}
          onClick={() => void dispatch('cancel', (u) => window.fab.moonrakerCancel(u))}
        >
          Cancel
        </button>
      </div>
    </section>
  )
}

export default FdmDeviceControls
