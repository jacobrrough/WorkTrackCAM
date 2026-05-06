import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type PrinterState = {
  state: string
  filename?: string
  progress?: number
  etaSeconds?: number
}

type Props = {
  moonrakerUrl: string
  onStatus?: (msg: string) => void
}

const POLL_INTERVAL_MS = 5000
const IDLE_STATES = new Set(['standby', 'complete', 'cancelled', 'error', 'offline'])

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function stateLabel(state: string): string {
  switch (state) {
    case 'printing': return 'Printing'
    case 'paused': return 'Paused'
    case 'standby': return 'Standby'
    case 'complete': return 'Complete'
    case 'cancelled': return 'Cancelled'
    case 'error': return 'Error'
    default: return state
  }
}

export function PrinterMonitorPanel({ moonrakerUrl, onStatus }: Props): ReactNode {
  const [printer, setPrinter] = useState<PrinterState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!moonrakerUrl) return
    try {
      const r = await window.fab.moonrakerStatus(moonrakerUrl, 5000)
      if (r.ok) {
        setPrinter({
          state: r.state ?? 'unknown',
          filename: r.filename,
          progress: r.progress,
          etaSeconds: r.etaSeconds
        })
        setError('')
      } else {
        setError(r.error ?? 'Connection failed')
        setPrinter(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPrinter(null)
    }
  }, [moonrakerUrl])

  useEffect(() => {
    if (!moonrakerUrl) return
    void poll()
    timerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [moonrakerUrl, poll])

  const handleAction = useCallback(async (action: 'cancel' | 'pause' | 'resume') => {
    if (!moonrakerUrl || busy) return
    setBusy(true)
    try {
      const fn = action === 'cancel'
        ? window.fab.moonrakerCancel
        : action === 'pause'
          ? window.fab.moonrakerPause
          : window.fab.moonrakerResume
      const r = await fn(moonrakerUrl, 5000)
      if (r.ok) {
        onStatus?.(`Print ${action} sent.`)
        void poll()
      } else {
        onStatus?.(`${action} failed: ${r.error ?? 'unknown'}`)
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [moonrakerUrl, busy, onStatus, poll])

  if (!moonrakerUrl) return null

  const isPrinting = printer?.state === 'printing'
  const isPaused = printer?.state === 'paused'
  const isActive = isPrinting || isPaused
  const pct = typeof printer?.progress === 'number' ? Math.round(printer.progress * 100) : null

  return (
    <section className="panel panel--nested printer-monitor" aria-labelledby="printer-monitor-heading">
      <h3 id="printer-monitor-heading" className="subh">Printer Monitor</h3>

      {error ? (
        <p className="msg msg--muted" role="status">{error}</p>
      ) : !printer ? (
        <p className="msg msg--muted" role="status">Connecting to printer...</p>
      ) : (
        <>
          <div className="printer-monitor__status" role="status" aria-live="polite">
            <span className={`printer-monitor__state printer-monitor__state--${printer.state}`}>
              {stateLabel(printer.state)}
            </span>
            {printer.filename ? (
              <span className="printer-monitor__filename">{printer.filename}</span>
            ) : null}
          </div>

          {pct !== null && isActive ? (
            <div className="printer-monitor__progress">
              <div className="printer-monitor__bar">
                <div
                  className="printer-monitor__bar-fill"
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Print progress"
                />
              </div>
              <span className="printer-monitor__pct">{pct}%</span>
              {typeof printer.etaSeconds === 'number' && printer.etaSeconds > 0 ? (
                <span className="printer-monitor__eta">ETA {formatEta(printer.etaSeconds)}</span>
              ) : null}
            </div>
          ) : null}

          {isActive ? (
            <div className="row row--wrap printer-monitor__actions">
              {isPrinting ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void handleAction('pause')}
                >
                  Pause
                </button>
              ) : null}
              {isPaused ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void handleAction('resume')}
                >
                  Resume
                </button>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void handleAction('cancel')}
              >
                Cancel Print
              </button>
            </div>
          ) : null}

          {IDLE_STATES.has(printer.state) ? (
            <p className="msg msg--muted msg--xs">Printer is idle. Slice and send a file to start a print.</p>
          ) : null}
        </>
      )}
    </section>
  )
}
