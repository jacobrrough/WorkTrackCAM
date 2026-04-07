import {
  COMMAND_CATALOG_RIBBON_FILTER_OPTIONS,
  type CommandRibbonGroup,
  type CommandShellWorkspace
} from '../../shared/fusion-style-command-catalog'

const VALID_RIBBON = new Set<CommandRibbonGroup | 'all'>(
  COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.map((o) => o.id)
)

const RECENT_KEY = 'ufs_cmd_palette_recent'
const FILTER_KEY = 'ufs_cmd_palette_filters'
const MAX_RECENT = 12

export type PaletteFilters = {
  implementedOnly: boolean
  workspaceFilter: CommandShellWorkspace | 'all'
  ribbonFilter: CommandRibbonGroup | 'all'
}

export function readRecentCommandIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    return j.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function writeRecentCommandIds(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
  } catch {
    /* ignore */
  }
}

export function pushRecentCommandId(id: string): void {
  const cur = readRecentCommandIds()
  const next = [id, ...cur.filter((x) => x !== id)].slice(0, MAX_RECENT)
  writeRecentCommandIds(next)
}

export function readPaletteFilters(): PaletteFilters {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) return defaultPaletteFilters()
    const j = JSON.parse(raw) as Partial<PaletteFilters>
    if (typeof j !== 'object' || j === null) return defaultPaletteFilters()
    return {
      implementedOnly: typeof j.implementedOnly === 'boolean' ? j.implementedOnly : true,
      workspaceFilter: isWorkspaceFilter(j.workspaceFilter) ? j.workspaceFilter : 'all',
      ribbonFilter: isRibbonFilter(j.ribbonFilter) ? j.ribbonFilter : 'all'
    }
  } catch {
    return defaultPaletteFilters()
  }
}

export function writePaletteFilters(f: PaletteFilters): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(f))
  } catch {
    /* ignore */
  }
}

function defaultPaletteFilters(): PaletteFilters {
  return { implementedOnly: true, workspaceFilter: 'all', ribbonFilter: 'all' }
}

function isWorkspaceFilter(v: unknown): v is CommandShellWorkspace | 'all' {
  return (
    v === 'all' || v === 'design' || v === 'assemble' || v === 'manufacture' || v === 'utilities'
  )
}

function isRibbonFilter(v: unknown): v is CommandRibbonGroup | 'all' {
  return typeof v === 'string' && VALID_RIBBON.has(v as CommandRibbonGroup | 'all')
}
