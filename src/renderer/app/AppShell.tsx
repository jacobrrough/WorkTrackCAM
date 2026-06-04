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
import { NewShellCommandPalette } from './NewShellCommandPalette'
import { KeyboardShortcutsDialog } from '../src/KeyboardShortcutsDialog'
import {
  isTypableKeyboardTarget,
  matchesCommandPaletteToggle,
  matchesKeyboardShortcutsReference
} from '../../shared/app-keyboard-shortcuts'

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
  const { setCmdOpen, showShortcuts, setShowShortcuts, helpOpen, setHelpOpen } = useUI()
  const { pushToast } = useToast()
  const { activeWorkspace, setActiveWorkspace } = useWorkspaceRouter('design')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Global shortcuts: Ctrl/Cmd+K command palette, Ctrl/Cmd+Shift+? shortcuts
  // reference, F1 help, Escape closes overlays. Reuses the shared matchers so
  // the bindings stay identical to the legacy shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypableKeyboardTarget(e.target)) return
      if (matchesCommandPaletteToggle(e)) {
        e.preventDefault()
        setCmdOpen((x) => !x)
      } else if (matchesKeyboardShortcutsReference(e)) {
        e.preventDefault()
        setShowShortcuts((x) => !x)
      } else if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setHelpOpen((x) => !x)
      } else if (e.key === 'Escape') {
        setCmdOpen(false)
        setShowShortcuts(false)
        setHelpOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCmdOpen, setShowShortcuts, setHelpOpen])

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
      {showShortcuts ? <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} /> : null}
      <NewShellCommandPalette
        onNavigate={setActiveWorkspace}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
    </div>
  )
}
