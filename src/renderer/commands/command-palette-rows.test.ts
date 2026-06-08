/**
 * FG-4b · Tests for the pure palette-row join (`command-palette-rows.ts`).
 *
 * These exercise the shell+catalog merge, the greyed/disabled contract for
 * unhandled ids, query filtering, recency promotion, the implemented-only gate,
 * and grouping — all in the existing `node` vitest env (no React).
 */
import { describe, expect, it } from 'vitest'
import {
  FUSION_STYLE_COMMAND_CATALOG,
  type FusionStyleCommand
} from '../../shared/fusion-style-command-catalog'
import {
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT,
  resolveCommands,
  type ResolvedCommand
} from './command-engine'
import { SHELL_COMMANDS, SHELL_COMMAND_IDS } from './starter-commands'
import {
  buildPaletteRows,
  catalogRow,
  groupPaletteRows,
  ribbonGroupLabel,
  shellRow,
  type PaletteRow
} from './command-palette-rows'

/** A resolved-command fixture without needing a registry. */
function resolved(
  cmd: Partial<FusionStyleCommand> & Pick<FusionStyleCommand, 'id' | 'label'>,
  over: Partial<ResolvedCommand> = {}
): ResolvedCommand {
  const command: FusionStyleCommand = {
    ribbon: 'solid_create',
    workspace: 'design',
    status: 'implemented',
    ...cmd
  }
  return {
    command,
    handler: over.handler,
    enabled: over.enabled ?? false,
    hasHandler: over.hasHandler ?? over.handler !== undefined
  }
}

describe('shellRow / catalogRow projection', () => {
  it('shellRow maps metadata to an always-enabled, handler-backed row', () => {
    const meta = SHELL_COMMANDS[0]
    const row = shellRow(meta)
    expect(row.id).toBe(meta.id)
    expect(row.label).toBe(meta.label)
    expect(row.group).toBe(meta.group)
    expect(row.enabled).toBe(true)
    expect(row.hasHandler).toBe(true)
    // Shell rows carry no parity status badge.
    expect(row.status).toBeUndefined()
  })

  it('catalogRow carries status, ribbon-group label, workspace meta and enabled state', () => {
    const r = catalogRow(
      resolved(
        { id: 'sk_line', label: 'Line', ribbon: 'sketch_create', workspace: 'design', fusionRibbon: 'CREATE' },
        { enabled: true, hasHandler: true }
      )
    )
    expect(r.id).toBe('sk_line')
    expect(r.status).toBe('implemented')
    expect(r.group).toBe(ribbonGroupLabel('sketch_create')) // 'Sketch · Create'
    expect(r.meta).toBe('design · CREATE')
    expect(r.enabled).toBe(true)
    expect(r.hasHandler).toBe(true)
  })

  it('catalogRow with no fusionRibbon falls back to just the workspace in meta', () => {
    const r = catalogRow(resolved({ id: 'x_only', label: 'X', workspace: 'manufacture' }))
    expect(r.meta).toBe('manufacture')
  })
})

describe('buildPaletteRows — merge + greying', () => {
  const baseInput = {
    shell: SHELL_COMMANDS,
    query: '',
    recentIds: [] as string[],
    implementedOnly: false
  }

  it('includes both shell rows and catalog rows', () => {
    const catalog = [
      resolved({ id: 'sk_line', label: 'Line' }, { enabled: true, hasHandler: true })
    ]
    const rows = buildPaletteRows({ ...baseInput, catalog })
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(SHELL_COMMANDS[0].id)
    expect(ids).toContain('sk_line')
  })

  it('marks catalog rows with no handler as disabled (greyed) but still lists them', () => {
    const catalog = [resolved({ id: 'unwired_cmd', label: 'Unwired' })] // no handler ⇒ enabled:false
    const rows = buildPaletteRows({ ...baseInput, catalog })
    const row = rows.find((r) => r.id === 'unwired_cmd')
    expect(row).toBeDefined()
    expect(row?.enabled).toBe(false)
    expect(row?.hasHandler).toBe(false)
  })

  it('shell rows are always enabled even when no catalog handlers exist', () => {
    const rows = buildPaletteRows({ ...baseInput, catalog: [] })
    expect(rows.every((r) => r.enabled)).toBe(true)
    expect(rows.length).toBe(SHELL_COMMANDS.length)
  })

  it('implementedOnly drops non-implemented catalog rows but keeps shell rows', () => {
    const catalog = [
      resolved({ id: 'done_cmd', label: 'Done', status: 'implemented' }, { enabled: true }),
      resolved({ id: 'planned_cmd', label: 'Planned', status: 'planned' }),
      resolved({ id: 'partial_cmd', label: 'Partial', status: 'partial' })
    ]
    const rows = buildPaletteRows({ ...baseInput, catalog, implementedOnly: true })
    const ids = rows.map((r) => r.id)
    expect(ids).toContain('done_cmd')
    expect(ids).not.toContain('planned_cmd')
    expect(ids).not.toContain('partial_cmd')
    // Shell rows are exempt from the implemented gate.
    expect(ids).toContain(SHELL_COMMANDS[0].id)
  })
})

describe('buildPaletteRows — query filtering', () => {
  const catalog = [
    resolved({ id: 'sk_line', label: 'Line', ribbon: 'sketch_create' }, { enabled: true }),
    resolved({ id: 'so_extrude', label: 'Extrude', ribbon: 'solid_create' }, { enabled: true })
  ]

  it('filters by label substring (case-insensitive)', () => {
    const rows = buildPaletteRows({
      shell: SHELL_COMMANDS,
      catalog,
      query: 'extru',
      recentIds: [],
      implementedOnly: false
    })
    const ids = rows.map((r) => r.id)
    expect(ids).toContain('so_extrude')
    expect(ids).not.toContain('sk_line')
  })

  it('matches a shell row by its label (e.g. "theme")', () => {
    const rows = buildPaletteRows({
      shell: SHELL_COMMANDS,
      catalog,
      query: 'theme',
      recentIds: [],
      implementedOnly: false
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.label.toLowerCase().includes('theme'))).toBe(true)
  })

  it('matches a catalog row by id token', () => {
    const rows = buildPaletteRows({
      shell: [],
      catalog,
      query: 'so_extrude',
      recentIds: [],
      implementedOnly: false
    })
    expect(rows.map((r) => r.id)).toEqual(['so_extrude'])
  })
})

describe('buildPaletteRows — recency', () => {
  it('promotes a recently-run id to the front when the query is empty', () => {
    const catalog = [
      resolved({ id: 'a_cmd', label: 'Alpha' }, { enabled: true }),
      resolved({ id: 'b_cmd', label: 'Bravo' }, { enabled: true })
    ]
    const rows = buildPaletteRows({
      shell: [],
      catalog,
      query: '',
      recentIds: ['b_cmd'],
      implementedOnly: false
    })
    expect(rows[0]?.id).toBe('b_cmd')
  })

  it('ignores recency when a query is present', () => {
    const catalog = [
      resolved({ id: 'a_cmd', label: 'Alpha match' }, { enabled: true }),
      resolved({ id: 'b_cmd', label: 'Bravo match' }, { enabled: true })
    ]
    const rows = buildPaletteRows({
      shell: [],
      catalog,
      query: 'match',
      recentIds: ['b_cmd'],
      implementedOnly: false
    })
    // Catalog order preserved (no recency reorder) when searching.
    expect(rows.map((r) => r.id)).toEqual(['a_cmd', 'b_cmd'])
  })
})

describe('groupPaletteRows', () => {
  it('buckets rows by group label, preserving first-seen order', () => {
    const rows: PaletteRow[] = [
      { id: '1', label: 'A', group: 'Navigate', enabled: true, hasHandler: true },
      { id: '2', label: 'B', group: 'Theme', enabled: true, hasHandler: true },
      { id: '3', label: 'C', group: 'Navigate', enabled: true, hasHandler: true }
    ]
    const groups = groupPaletteRows(rows)
    expect(groups.map((g) => g.group)).toEqual(['Navigate', 'Theme'])
    expect(groups[0].rows.map((r) => r.id)).toEqual(['1', '3'])
    expect(groups[1].rows.map((r) => r.id)).toEqual(['2'])
  })
})

describe('integration — full catalog through a real registry', () => {
  it('renders the entire catalog (greyed) plus shell rows when nothing is registered', () => {
    const reg = new CommandRegistry()
    const catalog = resolveCommands(DEFAULT_COMMAND_CONTEXT, {
      registry: reg,
      filterByWorkspace: false
    })
    expect(catalog.length).toBe(FUSION_STYLE_COMMAND_CATALOG.length)

    const shell = SHELL_COMMANDS.filter((c) => c.id !== SHELL_COMMAND_IDS.openCommandPalette)
    const rows = buildPaletteRows({
      shell,
      catalog,
      query: '',
      recentIds: [],
      implementedOnly: false
    })

    // Every catalog id is present (the palette no longer hides the inventory).
    const ids = new Set(rows.map((r) => r.id))
    for (const c of FUSION_STYLE_COMMAND_CATALOG) expect(ids.has(c.id)).toBe(true)
    // With no handlers registered, all catalog rows are greyed/disabled…
    const catalogRows = rows.filter((r) => r.status !== undefined)
    expect(catalogRows.length).toBe(FUSION_STYLE_COMMAND_CATALOG.length)
    expect(catalogRows.every((r) => r.enabled === false)).toBe(true)
    // …while every shell row stays enabled.
    const shellRows = rows.filter((r) => r.status === undefined)
    expect(shellRows.length).toBe(shell.length)
    expect(shellRows.every((r) => r.enabled)).toBe(true)
  })

  it('a registered + enabled handler flips its catalog row to enabled', () => {
    const reg = new CommandRegistry()
    const id = FUSION_STYLE_COMMAND_CATALOG[0].id
    reg.register({ id, run: () => {} })
    const catalog = resolveCommands(DEFAULT_COMMAND_CONTEXT, {
      registry: reg,
      filterByWorkspace: false
    })
    const rows = buildPaletteRows({
      shell: [],
      catalog,
      query: '',
      recentIds: [],
      implementedOnly: false
    })
    const row = rows.find((r) => r.id === id)
    expect(row?.enabled).toBe(true)
    expect(row?.hasHandler).toBe(true)
  })
})
