import { useCallback, useEffect, useRef, useState } from 'react'
import type { CamProgressEvent } from '../../shared/cam-progress'

/**
 * Human-readable labels for each CAM engine phase.
 * Shown to the user during progress updates so they know
 * what the engine is doing at any moment.
 */
const PHASE_LABELS: Record<CamProgressEvent['phase'], string> = {
  init: 'Initializing engine...',
  mesh_load: 'Loading mesh...',
  heightfield: 'Computing height field...',
  toolpath: 'Computing toolpath...',
  post_process: 'Post-processing...',
  write: 'Writing G-code...',
  complete: 'Complete',
  error: 'Error'
}

export type CamProgressBarProps = {
  /** Whether a CAM run is currently active (controls visibility). */
  running: boolean
  /** Called when the user clicks Cancel. */
  onCancel: () => void
}

/**
 * Real-time CAM generation progress bar.
 *
 * Subscribes to `window.fab.onCamProgress` when `running` is true
 * and displays the current phase label + a determinate or indeterminate
 * progress bar. Automatically hides on completion or error.
 */
export function CamProgressBar({ running, onCancel }: CamProgressBarProps): React.ReactNode {
  const [event, setEvent] = useState<CamProgressEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  const handleProgress = useCallback((ev: CamProgressEvent) => {
    setEvent(ev)
    if (ev.phase === 'complete' || ev.phase === 'error') {
      // Keep visible briefly so user sees the final state, then fade out
      setTimeout(() => setVisible(false), ev.phase === 'error' ? 3000 : 1200)
    }
  }, [])

  useEffect(() => {
    if (running) {
      setVisible(true)
      setEvent(null)
      unsubRef.current = window.fab.onCamProgress(handleProgress)
    } else {
      // If running becomes false externally (e.g. camRun resolved), schedule hide
      if (visible && event?.phase !== 'complete' && event?.phase !== 'error') {
        setTimeout(() => setVisible(false), 600)
      }
    }
    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  const phase = event?.phase ?? 'init'
  const percent = event?.percent ?? 0
  const message = event?.message ?? PHASE_LABELS[phase]
  const isDeterminate = event != null && phase !== 'init' && phase !== 'error'
  const isError = phase === 'error'
  const isComplete = phase === 'complete'

  return (
    <div
      className={`cam-progress-overlay${isComplete ? ' cam-progress-overlay--complete' : ''}${isError ? ' cam-progress-overlay--error' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="CAM generation progress"
    >
      <div className="cam-progress-content">
        <div className="cam-progress-header">
          <span className="cam-progress-phase">{message}</span>
          {isDeterminate && !isError ? (
            <span className="cam-progress-percent">{Math.round(percent)}%</span>
          ) : null}
        </div>
        <div
          className={`cam-progress-bar${isDeterminate ? '' : ' cam-progress-bar--indeterminate'}`}
          role="progressbar"
          aria-valuenow={isDeterminate ? Math.round(percent) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="cam-progress-bar__fill"
            style={isDeterminate ? { width: `${Math.min(100, percent)}%` } : undefined}
          />
        </div>
        {event?.detail?.strategy ? (
          <span className="cam-progress-detail">Engine: {event.detail.strategy}</span>
        ) : null}
        {event?.detail?.pointCount != null && event.detail.pointCount > 0 ? (
          <span className="cam-progress-detail">{event.detail.pointCount.toLocaleString()} points</span>
        ) : null}
      </div>
      {running && !isComplete ? (
        <button
          type="button"
          className="cam-progress-cancel"
          onClick={onCancel}
          aria-label="Cancel CAM generation"
        >
          Cancel
        </button>
      ) : null}
    </div>
  )
}
