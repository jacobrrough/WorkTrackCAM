import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { useUI } from '../contexts/UIContext'
import { getEnvironmentForMachine } from '../src/environments/env-routing'
import { useWorkspaceRouter } from './useWorkspaceRouter'
import { TopBar } from './TopBar'
import { WorkspaceNav } from './WorkspaceNav'
import { WorkspaceHost } from './WorkspaceHost'
import { StatusBar } from './StatusBar'
import { SettingsDrawer } from '../shell/SettingsDrawer'
import { HelpPanel } from '../src/HelpPanel'

/**
 * The new WorkTrack3D shell frame: a CSS grid of TopBar / WorkspaceNav /
 * WorkspaceHost / StatusBar. Reuses the existing contexts (machine session,
 * toast, UI) and the SettingsDrawer (which carries the 10-theme picker), so the
 * theme can be changed live from the new shell. Machine/CAM env selection +
 * the command palette / help overlays are wired in the next P3 increment.
 */
export function AppShell(): ReactElement {
  const { sessionMachine, setSessionMachine, machines, lastMachineId, loadToolsForMachine } =
    useMachineSession()
  const { setCmdOpen, helpOpen, setHelpOpen } = useUI()
  const { pushToast } = useToast()
  const { activeWorkspace, setActiveWorkspace } = useWorkspaceRouter('design')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Reuse the global F1 = Help / Escape = close-overlays bindings. The command
  // palette + full shortcuts dialog are wired in the next increment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing = el ? /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable : false
      if (typing) return
      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setHelpOpen((x) => !x)
      } else if (e.key === 'Escape') {
        setHelpOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setHelpOpen])

  // CAD-first: there is no splash machine-picker. Once the machine library has
  // loaded (MachineSessionProvider fetches it on mount), adopt the operator's
  // last machine — or the first installed — in the background, so machine status
  // and CAM work without forcing a choice up front. The operator can change it
  // later from the (forthcoming) machine switcher / My Shop drawer.
  useEffect(() => {
    if (sessionMachine || machines.length === 0) return
    const preferred =
      (lastMachineId ? machines.find((m) => m.id === lastMachineId) : undefined) ?? machines[0]
    if (preferred) {
      setSessionMachine(preferred)
      void loadToolsForMachine(preferred.id)
    }
  }, [sessionMachine, machines, lastMachineId, setSessionMachine, loadToolsForMachine])

  // Layer the active machine's environment accent over the theme (themes.css
  // [data-environment] overrides). Null while no machine is selected → the
  // theme's own accent (Titanium steel-blue by default) is used.
  const env = getEnvironmentForMachine(sessionMachine?.id ?? null)

  return (
    <div className="wt-shell" data-environment={env?.id}>
      <TopBar
        machine={sessionMachine}
        projectName="Untitled project"
        onOpenCommand={() => setCmdOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen((x) => !x)}
      />
      <WorkspaceNav active={activeWorkspace} onSelect={setActiveWorkspace} />
      <main className="wt-main">
        <WorkspaceHost active={activeWorkspace} onNavigate={setActiveWorkspace} />
      </main>
      <StatusBar machineName={sessionMachine?.name ?? null} units="mm" activeWorkspace={activeWorkspace} />

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} onToast={pushToast} />
      {helpOpen ? <HelpPanel onClose={() => setHelpOpen(false)} /> : null}
    </div>
  )
}
