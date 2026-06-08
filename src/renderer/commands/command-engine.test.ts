import { describe, expect, it, vi } from 'vitest'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'
import {
  type CommandContext,
  type CommandHandler,
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT,
  deriveMachineKind,
  designArmRequest,
  groupResolvedCommands,
  isCommandEnabled,
  isDesignArmCommand,
  resolveCommandGroups,
  resolveCommands,
  workspacesForRoute
} from './command-engine'
import {
  SHELL_COMMAND_IDS,
  SHELL_COMMANDS,
  buildStarterCommands,
  gotoCommandId,
  registerStarterCommands,
  themeCommandId,
  type ShellCommandActions
} from './starter-commands'

/** A context helper so tests don't spell out every field. */
function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { ...DEFAULT_COMMAND_CONTEXT, ...overrides }
}

describe('CommandRegistry — register / get / run', () => {
  it('registers a handler, looks it up, and runs it against the context', () => {
    const reg = new CommandRegistry()
    const run = vi.fn()
    const handler: CommandHandler = { id: 'test_cmd', run }
    reg.register(handler)

    expect(reg.has('test_cmd')).toBe(true)
    expect(reg.get('test_cmd')).toBe(handler)

    const c = ctx({ workspace: 'manufacture' })
    const ran = reg.run('test_cmd', c)
    expect(ran).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(c)
  })

  it('run() no-ops gracefully (returns false, dev-warns) for an unregistered id', () => {
    const reg = new CommandRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ran = reg.run('nope_not_registered', ctx())
    expect(ran).toBe(false)
    // Dev warning is emitted under the vitest (Vite DEV) environment.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('the disposer removes exactly its own registration', () => {
    const reg = new CommandRegistry()
    const dispose = reg.register({ id: 'disposable', run: () => {} })
    expect(reg.has('disposable')).toBe(true)
    dispose()
    expect(reg.has('disposable')).toBe(false)
    expect(reg.size).toBe(0)
  })

  it('disposer is a no-op once the id was re-registered by someone else', () => {
    const reg = new CommandRegistry()
    const first: CommandHandler = { id: 'shared', run: () => {} }
    const second: CommandHandler = { id: 'shared', run: () => {} }
    const disposeFirst = reg.register(first)
    reg.register(second) // replaces first
    disposeFirst() // must NOT remove second
    expect(reg.get('shared')).toBe(second)
  })
})

describe('CommandRegistry — enabled predicate', () => {
  it('run() skips a disabled command and returns false', () => {
    const reg = new CommandRegistry()
    const run = vi.fn()
    reg.register({
      id: 'needs_selection',
      run,
      enabled: (c) => c.hasSelection
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run('needs_selection', ctx({ hasSelection: false }))).toBe(false)
    expect(run).not.toHaveBeenCalled()

    expect(reg.run('needs_selection', ctx({ hasSelection: true }))).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('isCommandEnabled: no handler ⇒ false; handler w/o predicate ⇒ true; predicate honored', () => {
    expect(isCommandEnabled(undefined, ctx())).toBe(false)
    expect(isCommandEnabled({ id: 'a', run: () => {} }, ctx())).toBe(true)
    const gated: CommandHandler = { id: 'b', run: () => {}, enabled: (c) => c.machineKind === 'mill4' }
    expect(isCommandEnabled(gated, ctx({ machineKind: 'mill4' }))).toBe(true)
    expect(isCommandEnabled(gated, ctx({ machineKind: 'fdm' }))).toBe(false)
  })
})

describe('deriveMachineKind — env → ribbon kind', () => {
  it('maps each shop environment to the right ribbon kind, null → null', () => {
    expect(deriveMachineKind('creality_print')).toBe('fdm')
    expect(deriveMachineKind('vcarve_pro')).toBe('router')
    expect(deriveMachineKind('makera_cam')).toBe('mill4')
    expect(deriveMachineKind(null)).toBeNull()
  })
})

describe('CommandContext — aggregation shape', () => {
  it('DEFAULT_COMMAND_CONTEXT is design / no-machine / no-selection', () => {
    expect(DEFAULT_COMMAND_CONTEXT).toEqual({
      workspace: 'design',
      machineKind: null,
      hasSelection: false
    })
  })

  it('carries an optional selectionKind + sketchMode without widening required keys', () => {
    const c = ctx({ hasSelection: true, selectionKind: 'face', sketchMode: true })
    expect(c.hasSelection).toBe(true)
    expect(c.selectionKind).toBe('face')
    expect(c.sketchMode).toBe(true)
  })
})

describe('workspacesForRoute — route → catalog buckets', () => {
  it('design route exposes design + utilities; manufacture exposes manufacture + utilities', () => {
    expect([...workspacesForRoute('design')].sort()).toEqual(['design', 'utilities'])
    expect([...workspacesForRoute('manufacture')].sort()).toEqual(['manufacture', 'utilities'])
    expect([...workspacesForRoute('assemble')].sort()).toEqual(['assemble', 'utilities'])
    // workshop only sees global utilities
    expect([...workspacesForRoute('workshop')]).toEqual(['utilities'])
  })
})

describe('resolveCommands — catalog × handlers × enablement, filtered by context', () => {
  it('filters to the active workspace and reports handler-less catalog rows as disabled', () => {
    const reg = new CommandRegistry()
    // Wire one real Design command so we can prove enabled flips on.
    reg.register({ id: 'sk_line', run: () => {} })

    const resolved = resolveCommands(ctx({ workspace: 'design' }), { registry: reg })
    // Every resolved row must be a design- or utilities-bucket command.
    for (const r of resolved) {
      expect(['design', 'utilities']).toContain(r.command.workspace)
    }
    // The wired command is enabled + hasHandler; an arbitrary unwired design
    // command is shown but disabled (honest greyed-out).
    const line = resolved.find((r) => r.command.id === 'sk_line')
    expect(line?.hasHandler).toBe(true)
    expect(line?.enabled).toBe(true)

    const unwired = resolved.find((r) => r.command.id === 'so_extrude')
    expect(unwired).toBeDefined()
    expect(unwired?.hasHandler).toBe(false)
    expect(unwired?.enabled).toBe(false)
  })

  it('manufacture commands are excluded until a machine is selected', () => {
    const reg = new CommandRegistry()
    const noMachine = resolveCommands(ctx({ workspace: 'manufacture', machineKind: null }), {
      registry: reg
    })
    expect(noMachine.some((r) => r.command.workspace === 'manufacture')).toBe(false)

    const withMill = resolveCommands(ctx({ workspace: 'manufacture', machineKind: 'mill4' }), {
      registry: reg
    })
    expect(withMill.some((r) => r.command.workspace === 'manufacture')).toBe(true)
  })

  it('filterByWorkspace:false resolves the whole catalog regardless of route', () => {
    const reg = new CommandRegistry()
    const all = resolveCommands(ctx({ workspace: 'workshop' }), {
      registry: reg,
      filterByWorkspace: false
    })
    expect(all.length).toBe(FUSION_STYLE_COMMAND_CATALOG.length)
  })
})

describe('grouping — ribbon panels', () => {
  it('groupResolvedCommands leads with the first catalog group and is loss-less', () => {
    const reg = new CommandRegistry()
    const groups = resolveCommandGroups(ctx({ workspace: 'design' }), { registry: reg })
    // Sketch · Create is the first group in the catalog, so it leads.
    expect(groups[0]?.group).toBe('sketch_create')
    // Grouping is loss-less: the same set of ids comes out, just reordered into
    // contiguous ribbon groups (catalog order interleaves groups, so this is a
    // set comparison, not an order comparison).
    const flat = resolveCommands(ctx({ workspace: 'design' }), { registry: reg })
    const flatIds = flat.map((r) => r.command.id).sort()
    const groupedIds = groups.flatMap((g) => g.commands.map((r) => r.command.id)).sort()
    expect(groupedIds).toEqual(flatIds)
  })

  it('each ribbon group appears exactly once (groups are contiguous)', () => {
    const groups = groupResolvedCommands(
      resolveCommands(ctx({ workspace: 'design' }), { registry: new CommandRegistry() })
    )
    const seen = groups.map((g) => g.group)
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('deep-link routing', () => {
  it('isDesignArmCommand + designArmRequest map catalog ids to a navigate+arm intent', () => {
    expect(isDesignArmCommand('sk_line')).toBe(true)
    expect(designArmRequest('sk_line')).toEqual({ workspace: 'design', armToolId: 'sk_line' })
    // A non-arm id (e.g. a CAM op) returns null.
    expect(isDesignArmCommand('mf_op_2d_pocket')).toBe(false)
    expect(designArmRequest('mf_op_2d_pocket')).toBeNull()
  })
})

describe('starter commands', () => {
  function makeActions(): ShellCommandActions & { calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      navigate: (w) => calls.push(`navigate:${w}`),
      openSettings: () => calls.push('settings'),
      openHelp: () => calls.push('help'),
      openCommandPalette: () => calls.push('palette'),
      applyTheme: (t) => calls.push(`theme:${t}`)
    }
  }

  it('builds handlers for the 6 nav commands + Settings/Help/Palette + every theme', () => {
    const actions = makeActions()
    const handlers = buildStarterCommands(actions)
    const ids = new Set(handlers.map((h) => h.id))
    // 6 navigation commands.
    for (const w of ['design', 'assemble', 'manufacture', 'drawings', 'workshop', 'utilities']) {
      expect(ids.has(gotoCommandId(w as never))).toBe(true)
    }
    // App actions.
    expect(ids.has(SHELL_COMMAND_IDS.openSettings)).toBe(true)
    expect(ids.has(SHELL_COMMAND_IDS.openHelp)).toBe(true)
    expect(ids.has(SHELL_COMMAND_IDS.openCommandPalette)).toBe(true)
    // Theme rows: one per shell command theme entry.
    const themeRows = SHELL_COMMANDS.filter((c) => c.group === 'Theme')
    expect(themeRows.length).toBeGreaterThan(0)
    for (const t of themeRows) expect(ids.has(t.id)).toBe(true)
    // Total = SHELL_COMMANDS rows (nav + app + themes).
    expect(handlers.length).toBe(SHELL_COMMANDS.length)
  })

  it('registers onto a registry and the handlers dispatch to the host actions', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    const dispose = registerStarterCommands(actions, reg)

    expect(reg.run(gotoCommandId('manufacture'), ctx())).toBe(true)
    expect(reg.run(SHELL_COMMAND_IDS.openSettings, ctx())).toBe(true)
    expect(reg.run(themeCommandId('blueprint'), ctx())).toBe(true)
    expect(actions.calls).toEqual(['navigate:manufacture', 'settings', 'theme:blueprint'])

    // Disposer cleans up every registration.
    dispose()
    expect(reg.size).toBe(0)
  })

  it('SHELL_COMMANDS ids are disjoint from the tool catalog ids (synthetic shell commands)', () => {
    const catalogIds = new Set(FUSION_STYLE_COMMAND_CATALOG.map((c) => c.id))
    for (const shell of SHELL_COMMANDS) {
      expect(catalogIds.has(shell.id)).toBe(false)
    }
  })
})
