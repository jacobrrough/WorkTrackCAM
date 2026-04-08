import type { Workspace } from './WorkspaceBar'
import type {
  CommandParityStatus,
  CommandRibbonGroup,
  CommandShellWorkspace
} from '../../shared/fusion-style-command-catalog'

/**
 * Manufacture workspace sub-tabs.
 * - plan: operation list / job editor (Makera-style functions panel)
 * - setup: stock, WCS origin, material type per setup
 * - cam: G-code generation + toolpath output
 * - simulate: 3D toolpath simulation viewer
 * - slice: FDM CuraEngine slice
 * - tools: tool library management
 */
export type ManufacturePanelTab = 'plan' | 'setup' | 'cam' | 'simulate' | 'slice' | 'tools'

const VALID_MFG_PANEL: ReadonlySet<ManufacturePanelTab> = new Set(['plan', 'setup', 'cam', 'simulate', 'slice', 'tools'])

const MFG_PANEL_TAB_KEY = 'ufs_manufacture_panel_tab'

/** Left combo view: model tree vs tasks (FreeCAD-style). */
export type PersistedComboViewTab = 'model' | 'tasks'

const VALID_COMBO_TAB: ReadonlySet<PersistedComboViewTab> = new Set(['model', 'tasks'])

const COMBO_VIEW_TAB_KEY = 'ufs_combo_view_tab'

const LAST_WORKSPACE_KEY = 'ufs_last_workspace'
const MFG_OP_FILTER_KEY = 'ufs_mfg_op_filter'
const MFG_ACTIONABLE_ONLY_KEY = 'ufs_mfg_actionable_only'
const COMMAND_CATALOG_QUERY_KEY = 'ufs_command_catalog_query'
const COMMAND_CATALOG_WORKSPACE_KEY = 'ufs_command_catalog_workspace'
const COMMAND_CATALOG_STATUS_KEY = 'ufs_command_catalog_status'
const COMMAND_CATALOG_RIBBON_KEY = 'ufs_command_catalog_ribbon'
const MFG_LAST_SOURCE_STL_KEY = 'ufs_mfg_last_source_stl'
const MFG_LAST_RUN_MODE_KEY = 'ufs_mfg_last_run_mode'

const VALID: ReadonlySet<Workspace> = new Set(['design', 'assemble', 'manufacture', 'utilities'])

/** Restore last workspace from localStorage, or `fallback` if missing / invalid. */
export function readPersistedWorkspace(fallback: Workspace): Workspace {
  try {
    const raw = localStorage.getItem(LAST_WORKSPACE_KEY)
    if (raw && VALID.has(raw as Workspace)) return raw as Workspace
  } catch {
    /* private mode / quota */
  }
  return fallback
}

export function writePersistedWorkspace(w: Workspace): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, w)
  } catch {
    /* ignore */
  }
}

export function readPersistedComboViewTab(fallback: PersistedComboViewTab): PersistedComboViewTab {
  try {
    const raw = localStorage.getItem(COMBO_VIEW_TAB_KEY)
    if (raw && VALID_COMBO_TAB.has(raw as PersistedComboViewTab)) return raw as PersistedComboViewTab
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedComboViewTab(t: PersistedComboViewTab): void {
  try {
    localStorage.setItem(COMBO_VIEW_TAB_KEY, t)
  } catch {
    /* ignore */
  }
}

export function readPersistedManufacturePanelTab(fallback: ManufacturePanelTab): ManufacturePanelTab {
  try {
    const raw = localStorage.getItem(MFG_PANEL_TAB_KEY)
    if (raw && VALID_MFG_PANEL.has(raw as ManufacturePanelTab)) return raw as ManufacturePanelTab
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedManufacturePanelTab(t: ManufacturePanelTab): void {
  try {
    localStorage.setItem(MFG_PANEL_TAB_KEY, t)
  } catch {
    /* ignore */
  }
}

export type ManufactureOpFilter =
  | 'all'
  | 'missing geometry'
  | 'stale geometry'
  | 'suppressed'
  | 'non-cam'

const VALID_MFG_FILTERS: ReadonlySet<ManufactureOpFilter> = new Set([
  'all',
  'missing geometry',
  'stale geometry',
  'suppressed',
  'non-cam'
])

const VALID_COMMAND_WORKSPACE_FILTERS: ReadonlySet<CommandShellWorkspace | 'all'> = new Set([
  'all',
  'design',
  'assemble',
  'manufacture',
  'utilities'
])
const VALID_COMMAND_STATUS_FILTERS: ReadonlySet<CommandParityStatus | 'all'> = new Set([
  'all',
  'implemented',
  'partial',
  'planned'
])
const VALID_COMMAND_RIBBON_FILTERS: ReadonlySet<CommandRibbonGroup | 'all'> = new Set([
  'all',
  'sketch_create',
  'sketch_modify',
  'sketch_constraint',
  'sketch_dimension',
  'solid_create',
  'solid_modify',
  'solid_pattern',
  'surface',
  'sheet_metal',
  'plastic',
  'assemble',
  'assemble_joint',
  'manufacture_setup',
  'manufacture_2d',
  'manufacture_3d',
  'drawing',
  'inspect',
  'manage'
])

export function readPersistedManufactureOpFilter(fallback: ManufactureOpFilter): ManufactureOpFilter {
  try {
    const raw = localStorage.getItem(MFG_OP_FILTER_KEY)
    if (raw && VALID_MFG_FILTERS.has(raw as ManufactureOpFilter)) return raw as ManufactureOpFilter
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedManufactureOpFilter(v: ManufactureOpFilter): void {
  try {
    localStorage.setItem(MFG_OP_FILTER_KEY, v)
  } catch {
    /* ignore */
  }
}

export function readPersistedManufactureActionableOnly(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(MFG_ACTIONABLE_ONLY_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedManufactureActionableOnly(v: boolean): void {
  try {
    localStorage.setItem(MFG_ACTIONABLE_ONLY_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function readPersistedCommandCatalogQuery(fallback = ''): string {
  try {
    const raw = localStorage.getItem(COMMAND_CATALOG_QUERY_KEY)
    if (raw != null) return raw
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedCommandCatalogQuery(v: string): void {
  try {
    localStorage.setItem(COMMAND_CATALOG_QUERY_KEY, v)
  } catch {
    /* ignore */
  }
}

export function readPersistedCommandCatalogWorkspace(
  fallback: CommandShellWorkspace | 'all'
): CommandShellWorkspace | 'all' {
  try {
    const raw = localStorage.getItem(COMMAND_CATALOG_WORKSPACE_KEY)
    if (raw && VALID_COMMAND_WORKSPACE_FILTERS.has(raw as CommandShellWorkspace | 'all')) {
      return raw as CommandShellWorkspace | 'all'
    }
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedCommandCatalogWorkspace(v: CommandShellWorkspace | 'all'): void {
  try {
    localStorage.setItem(COMMAND_CATALOG_WORKSPACE_KEY, v)
  } catch {
    /* ignore */
  }
}

export function readPersistedCommandCatalogStatus(fallback: CommandParityStatus | 'all'): CommandParityStatus | 'all' {
  try {
    const raw = localStorage.getItem(COMMAND_CATALOG_STATUS_KEY)
    if (raw && VALID_COMMAND_STATUS_FILTERS.has(raw as CommandParityStatus | 'all')) {
      return raw as CommandParityStatus | 'all'
    }
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedCommandCatalogStatus(v: CommandParityStatus | 'all'): void {
  try {
    localStorage.setItem(COMMAND_CATALOG_STATUS_KEY, v)
  } catch {
    /* ignore */
  }
}

export function readPersistedCommandCatalogRibbon(fallback: CommandRibbonGroup | 'all'): CommandRibbonGroup | 'all' {
  try {
    const raw = localStorage.getItem(COMMAND_CATALOG_RIBBON_KEY)
    if (raw && VALID_COMMAND_RIBBON_FILTERS.has(raw as CommandRibbonGroup | 'all')) {
      return raw as CommandRibbonGroup | 'all'
    }
  } catch {
    /* ignore */
  }
  return fallback
}

export function writePersistedCommandCatalogRibbon(v: CommandRibbonGroup | 'all'): void {
  try {
    localStorage.setItem(COMMAND_CATALOG_RIBBON_KEY, v)
  } catch {
    /* ignore */
  }
}

export function readPersistedManufactureLastSourceStl(fallback = ''): string {
  try {
    return localStorage.getItem(MFG_LAST_SOURCE_STL_KEY) ?? fallback
  } catch {
    return fallback
  }
}

export function writePersistedManufactureLastSourceStl(path: string): void {
  try {
    if (!path.trim()) localStorage.removeItem(MFG_LAST_SOURCE_STL_KEY)
    else localStorage.setItem(MFG_LAST_SOURCE_STL_KEY, path)
  } catch {
    /* ignore */
  }
}

export function readPersistedManufactureLastRunMode(fallback: 'slice' | 'cam' = 'cam'): 'slice' | 'cam' {
  try {
    const raw = localStorage.getItem(MFG_LAST_RUN_MODE_KEY)
    return raw === 'slice' || raw === 'cam' ? raw : fallback
  } catch {
    return fallback
  }
}

export function writePersistedManufactureLastRunMode(mode: 'slice' | 'cam'): void {
  try {
    localStorage.setItem(MFG_LAST_RUN_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}
