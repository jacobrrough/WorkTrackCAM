import { useState } from 'react'
import type { ReactElement } from 'react'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { useUI } from '../contexts/UIContext'
import { useWorkspaceRouter } from './useWorkspaceRouter'
import { TopBar } from './TopBar'
import { WorkspaceNav } from './WorkspaceNav'
import { WorkspaceHost } from './WorkspaceHost'
import { StatusBar } from './StatusBar'
import { SettingsDrawer } from '../shell/SettingsDrawer'

/**
 * The new WorkTrack3D shell frame: a CSS grid of TopBar / WorkspaceNav /
 * WorkspaceHost / StatusBar. Reuses the existing contexts (machine session,
 * toast, UI) and the SettingsDrawer (which carries the 10-theme picker), so the
 * theme can be changed live from the new shell. Machine/CAM env selection +
 * the command palette / help overlays are wired in the next P3 increment.
 */
export function AppShell(): ReactElement {
  const { sessionMachine } = useMachineSession()
  const { setCmdOpen, setHelpOpen } = useUI()
  const { pushToast } = useToast()
  const { activeWorkspace, setActiveWorkspace } = useWorkspaceRouter('design')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="wt-shell">
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
    </div>
  )
}
