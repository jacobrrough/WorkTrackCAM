import { DESIGN_RIBBON_COMMAND_IDS, type FusionStyleCommand } from '../../shared/fusion-style-command-catalog'
import { dispatchDesignCommand } from '../design/design-command-bridge'
import { drawingPaletteStatusFor } from './drawing-command-status'
import type { UtilityTab } from '../shell/AppShell'
import type { Workspace } from '../shell/WorkspaceBar'
import type { ManufacturePanelTab } from '../shell/workspaceMemory'

type CommandDispatchDeps = {
  setWorkspace: (workspace: Workspace) => void
  setUtilityTab: (tab: UtilityTab) => void
  setManufacturePanelTab: (tab: ManufacturePanelTab) => void
  setShortcutsDialogOpen: (open: boolean) => void
  setStatus: (message: string) => void
  setCommandPaletteOpen: (open: boolean) => void
  openProjectFolder: () => Promise<void>
  createProject: () => Promise<void>
  createProjectFromImport: () => Promise<void>
  saveProject: () => Promise<void>
  importModel3D: () => Promise<void>
  exportDrawing: (kind: 'pdf' | 'dxf') => Promise<void>
}

export function openShortcutsReference(
  setShortcutsDialogOpen: (open: boolean) => void,
  setStatus: (message: string) => void
): void {
  setShortcutsDialogOpen(true)
  setStatus('Keyboard shortcuts — press Esc or Close to dismiss.')
}

export function createCommandPickHandler({
  setWorkspace,
  setUtilityTab,
  setManufacturePanelTab,
  setShortcutsDialogOpen,
  setStatus,
  setCommandPaletteOpen,
  openProjectFolder,
  createProject,
  createProjectFromImport,
  saveProject,
  importModel3D,
  exportDrawing
}: CommandDispatchDeps): (cmd: FusionStyleCommand) => void {
  return (cmd: FusionStyleCommand) => {
    switch (cmd.id) {
      case 'ut_open':
        void openProjectFolder()
        return
      case 'ut_new':
        void createProject()
        return
      case 'ut_new_from_import':
        void createProjectFromImport()
        return
      case 'ut_save':
        void saveProject()
        return
      case 'ut_import_3d':
      case 'ut_import_stl':
      case 'ut_import_step':
        void importModel3D()
        return
      case 'ut_slice':
        setWorkspace('manufacture')
        setManufacturePanelTab('slice')
        setStatus('Slice — Manufacture workspace.')
        return
      case 'ut_cam':
        setWorkspace('manufacture')
        setManufacturePanelTab('cam')
        setStatus('CAM — Manufacture workspace.')
        return
      case 'ut_tools':
        setWorkspace('manufacture')
        setManufacturePanelTab('tools')
        setStatus('Tool library — Manufacture workspace.')
        return
      case 'ut_command_palette':
        setCommandPaletteOpen(true)
        setStatus('Command palette — search commands or browse recent picks.')
        return
      case 'ut_keyboard_shortcuts':
        openShortcutsReference(setShortcutsDialogOpen, setStatus)
        return
      case 'ut_interference':
        setWorkspace('assemble')
        setStatus(
          'Interference — switched to **Assemble**. Open **Interference check** in the assembly panel, then download JSON or save a report under output/.'
        )
        return
      case 'ut_material':
        setWorkspace('utilities')
        setUtilityTab('project')
        setStatus('Physical material — edit name and density (kg/m³) on **File → Project**; saved in project.json.')
        queueMicrotask(() =>
          document.getElementById('util-physical-material-heading')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        )
        return
      case 'ut_appearance':
        setWorkspace('utilities')
        setUtilityTab('project')
        setStatus('Appearance — notes for finish/color; saved in project.json.')
        queueMicrotask(() =>
          document.getElementById('util-appearance-heading')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        )
        return
      case 'as_interference':
        setWorkspace('assemble')
        setStatus(
          `${cmd.label} — Assembly: **Interference check**, then download JSON or **Save report to output/** (project folder).`
        )
        return
      case 'as_summary':
        setWorkspace('assemble')
        setStatus(`${cmd.label} — click Assembly summary in the assembly panel.`)
        return
      case 'dr_export_pdf':
        setWorkspace('utilities')
        setUtilityTab('project')
        void exportDrawing('pdf')
        return
      case 'dr_export_dxf':
        setWorkspace('utilities')
        setUtilityTab('project')
        void exportDrawing('dxf')
        return
      case 'dr_new_sheet':
      case 'dr_base_view':
      case 'dr_projected_view':
        setWorkspace('utilities')
        setUtilityTab('project')
        setStatus(drawingPaletteStatusFor(cmd))
        return
      case 'ut_measure':
      case 'ut_section':
        setWorkspace('design')
        dispatchDesignCommand(cmd.id)
        setStatus(
          cmd.id === 'ut_measure'
            ? 'Measure — 3D preview: enable Measure, Shift+click two points on the solid. Esc clears.'
            : 'Section — 3D preview: enable Section, drag Y clip. Esc clears.'
        )
        return
      default:
        break
    }
    if (cmd.ribbon === 'drawing') {
      setWorkspace('utilities')
      setUtilityTab('project')
      setStatus(
        `${cmd.label} — PDF/DXF export + view **placeholders** on the Project tab; true projected geometry is not implemented.`
      )
      return
    }
    if (cmd.workspace === 'design') {
      setWorkspace('design')
      if (DESIGN_RIBBON_COMMAND_IDS.has(cmd.id)) {
        dispatchDesignCommand(cmd.id)
      }
      if (cmd.id === 'ut_parameters') {
        setStatus(
          'Parameters — Design ribbon **Parameters** group: add/rename/delete keys and values; File → Project **Export/Import parameters JSON** for file merge.'
        )
      } else {
        setStatus(
          cmd.status === 'implemented'
            ? `${cmd.label} — Design workspace (ribbon synced when applicable).`
            : `${cmd.label} — not implemented yet; Design workspace for closest tools.`
        )
      }
      return
    }
    if (cmd.workspace === 'assemble') {
      setWorkspace('assemble')
      setStatus(`${cmd.label} — Assemble workspace.`)
      return
    }
    if (cmd.workspace === 'manufacture') {
      setWorkspace('manufacture')
      setStatus(`${cmd.label} — Manufacture workspace.`)
      return
    }
    setWorkspace('utilities')
    setStatus(`${cmd.label} — File workspace (Project, Settings). Use command palette for more.`)
  }
}
