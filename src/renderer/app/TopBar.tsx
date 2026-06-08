import { useCallback } from 'react'
import type { ReactElement } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import { fab } from '../src/shop-types'
import { useToast } from '../contexts/ToastContext'
import { useUI } from '../contexts/UIContext'
import { EnvSwitcher } from './EnvSwitcher'
import { useProjectSession } from './useProjectSession'

/** Narrow view of the preload bridge's machine.estop channel (see shop-types). */
interface EstopBridge {
  machine?: {
    estop?: (payload: { machineId: string }) => Promise<{ ok: boolean; error?: string; hint?: string }>
  }
}

export function TopBar({
  machine,
  projectName,
  onOpenCommand,
  onOpenSettings,
  onOpenHelp
}: {
  machine: MachineProfile | null
  /**
   * Fallback project name from the shell. Used only until a real project is
   * open — the live name comes from {@link useProjectSession}. Kept so the
   * shell's prop contract is unchanged.
   */
  projectName: string
  onOpenCommand: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}): ReactElement {
  const { pushToast } = useToast()

  // Live project title + dirty marker.
  //   name : `useProjectSession` owns the open `project.json`; `project.name` is
  //          the real title, falling back to the shell-supplied `projectName`
  //          prop until a project is open.
  //   *    : binds to the app's saved-indicator flag (`UIContext.savedIndicator`)
  //          — the only session-level save signal that exists. The marker is
  //          clean when nothing is open and tracks the flag once a project is
  //          loaded, so it becomes fully correct the moment the save flow starts
  //          toggling `savedIndicator`. We deliberately do NOT fabricate a dirty
  //          state when no project is open.
  const { projectDir, project } = useProjectSession()
  const { savedIndicator } = useUI()
  const liveName = (project?.name ?? '').trim()
  const displayName = liveName.length > 0 ? liveName : projectName
  const isDirty = projectDir !== null && !savedIndicator
  const titleName = `${displayName}${isDirty ? ' • unsaved changes' : ''}`

  const handleEstop = useCallback((): void => {
    const machineId = machine?.id ?? null
    if (machineId === null) {
      pushToast('warn', 'No machine selected — nothing to stop.')
      return
    }
    const confirmed = window.confirm(
      'E-STOP — abort the current machine operation?\n\nFor the K2 Plus this sends an emergency stop to the printer. For the CNC machines this advises you to hit the physical e-stop.'
    )
    if (!confirmed) return
    void (async () => {
      try {
        const bridge = fab() as unknown as EstopBridge
        const estopFn = bridge.machine?.estop
        if (typeof estopFn !== 'function') {
          pushToast('err', 'E-stop is not available in this build.')
          return
        }
        const r = await estopFn({ machineId })
        if (r.ok) {
          pushToast('ok', `E-stop sent to ${machine?.name ?? machineId}`)
        } else {
          pushToast('err', `E-stop: ${r.error ?? 'failed'}${r.hint ? ` — ${r.hint}` : ''}`)
        }
      } catch (e) {
        pushToast('err', `E-stop failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [machine?.id, machine?.name, pushToast])

  return (
    <header className="wt-topbar" role="banner">
      <div className="wt-brand">
        <svg className="wt-brand__logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M3 7l9 5 9-5M12 12v10" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity=".55" />
        </svg>
        WorkTrack<b>3D</b>
      </div>

      <span className="wt-project" title={titleName}>
        {displayName}
        {isDirty ? <span className="wt-project__dirty" aria-label="unsaved changes"> *</span> : null}
      </span>

      <EnvSwitcher />

      <div className="wt-topbar__spacer" />

      <div className="wt-machine" title={machine ? `${machine.name}` : 'No machine selected'}>
        <span className={`wt-dot ${machine ? 'wt-dot--ok' : 'wt-dot--idle'}`} />
        <span className="wt-machine__name">{machine?.name ?? 'No machine'}</span>
      </div>

      <button type="button" className="wt-estop" onClick={handleEstop}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <rect x="9" y="9" width="6" height="6" fill="currentColor" />
        </svg>
        E-STOP
      </button>

      <div className="wt-topbar__actions">
        <button type="button" className="wt-iconbtn" title="Command palette (Ctrl+K)" onClick={onOpenCommand}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 10h2m6 0h2M7 14h10" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button type="button" className="wt-iconbtn" title="Settings" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button type="button" className="wt-iconbtn" title="Help (F1)" onClick={onOpenHelp}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
