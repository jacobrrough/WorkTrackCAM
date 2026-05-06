import React from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { Job } from './shop-types'

interface AppStatusBarProps {
  activeJob: Job | null
  running: boolean
  sessionMachine: MachineProfile | null
  lastGenMs: number | null
  logOpen: boolean
  onToggleLog: () => void
}

export function AppStatusBar({
  activeJob, running, sessionMachine, lastGenMs, logOpen, onToggleLog
}: AppStatusBarProps): React.ReactElement {
  return (
    <footer className="cc-status" role="status" aria-live="polite">
      <div className="cc-status__left">
        {running ? (
          <span className="cc-status__indicator cc-status__indicator--running">
            <span className="spinner spinner--sm" /> Generating{'…'}
          </span>
        ) : activeJob?.status === 'error' ? (
          <span className="cc-status__indicator cc-status__indicator--error">
            {'✕'} Error
          </span>
        ) : activeJob?.status === 'done' ? (
          <span className="cc-status__indicator cc-status__indicator--ok">
            {'✓'} Ready
          </span>
        ) : (
          <span className="cc-status__indicator">Idle</span>
        )}
        {sessionMachine && (
          <>
            <span className="cc-status__dot">{'·'}</span>
            <span className="cc-status__machine">{sessionMachine.name}</span>
          </>
        )}
      </div>

      <div className="cc-status__center">
        {activeJob && (
          <span className="cc-status__ops">
            {activeJob.operations.length} op{activeJob.operations.length !== 1 ? 's' : ''}
          </span>
        )}
        {activeJob && !running && activeJob.stock && (
          <>
            <span className="cc-status__dot">{'·'}</span>
            <span className="cc-status__stock">
              {activeJob.stock.x}{'×'}{activeJob.stock.y}{'×'}{activeJob.stock.z} mm
            </span>
          </>
        )}
      </div>

      <div className="cc-status__right">
        <button
          type="button"
          className={`cc-status__log-btn${logOpen ? ' cc-status__log-btn--active' : ''}`}
          onClick={onToggleLog}
          title="Toggle output log"
        >
          {'⎯'} Log
        </button>
        {lastGenMs !== null && (
          <span className="cc-status__gen-time">
            {lastGenMs < 1000 ? `${lastGenMs}ms` : `${(lastGenMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <span className="cc-status__hint">
          Ctrl+K Commands
        </span>
      </div>
    </footer>
  )
}
