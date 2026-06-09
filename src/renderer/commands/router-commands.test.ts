import { describe, expect, it, vi } from 'vitest'
import {
  type CommandContext,
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT
} from './command-engine'
import {
  type RouterCommandActions,
  type RouterCommandKind,
  ROUTER_COMMAND_OP_KIND,
  ROUTER_IMPORT_DXF_COMMAND_ID,
  ROUTER_NEST_COMMAND_ID,
  ROUTER_OP_DRILL_COMMAND_ID,
  ROUTER_OP_POCKET_COMMAND_ID,
  ROUTER_OP_PROFILE_COMMAND_ID,
  ROUTER_OP_VCARVE_COMMAND_ID,
  ROUTER_POST_COMMAND_ID,
  ROUTER_SIMULATE_COMMAND_ID,
  buildRouterCommands,
  classifyRouterCommand,
  registerRouterCommands,
  routerCommandEnabled,
  routerCommandIds
} from './router-commands'
import { classifyCamCommand } from './cam-commands'
import { classifyFdmCommand } from './fdm-commands'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'

/** A context helper so tests don't spell out every field. */
function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { ...DEFAULT_COMMAND_CONTEXT, ...overrides }
}

/** A spy action bag that records the name of every call. */
function makeActions(): RouterCommandActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    importVectorsDxf: () => calls.push('importVectorsDxf'),
    opProfile: () => calls.push('opProfile'),
    opPocket: () => calls.push('opPocket'),
    opVcarve: () => calls.push('opVcarve'),
    opDrill: () => calls.push('opDrill'),
    nest: () => calls.push('nest'),
    simulate: () => calls.push('simulate'),
    post: () => calls.push('post')
  }
}

/** Manufacture context with the Laguna router active (router commands enabled). */
function router(overrides: Partial<CommandContext> = {}): CommandContext {
  return ctx({ workspace: 'manufacture', machineKind: 'router', ...overrides })
}

/** Every router command kind, for exhaustive-gating loops. */
const ALL_KINDS: readonly RouterCommandKind[] = [
  'import_dxf',
  'profile_op',
  'pocket_op',
  'vcarve_op',
  'drill_op',
  'nest',
  'simulate',
  'post'
]

describe('classifyRouterCommand', () => {
  it('classifies the DXF import + nesting catalog rows', () => {
    expect(classifyRouterCommand(ROUTER_IMPORT_DXF_COMMAND_ID)).toBe('import_dxf')
    expect(classifyRouterCommand(ROUTER_NEST_COMMAND_ID)).toBe('nest')
  })

  it('classifies each 2D / V-carve op row to its own kind', () => {
    expect(classifyRouterCommand(ROUTER_OP_PROFILE_COMMAND_ID)).toBe('profile_op')
    expect(classifyRouterCommand(ROUTER_OP_POCKET_COMMAND_ID)).toBe('pocket_op')
    expect(classifyRouterCommand(ROUTER_OP_VCARVE_COMMAND_ID)).toBe('vcarve_op')
    expect(classifyRouterCommand(ROUTER_OP_DRILL_COMMAND_ID)).toBe('drill_op')
  })

  it('classifies the synthetic simulate / send ids', () => {
    expect(classifyRouterCommand(ROUTER_SIMULATE_COMMAND_ID)).toBe('simulate')
    expect(classifyRouterCommand(ROUTER_POST_COMMAND_ID)).toBe('post')
  })

  it('returns null for CAM-owned manufacture ids (cam-commands owns them)', () => {
    expect(classifyRouterCommand('mf_setup')).toBeNull()
    expect(classifyRouterCommand('mf_op_2d_pocket')).toBeNull()
    expect(classifyRouterCommand('mf_op_parallel')).toBeNull()
    expect(classifyRouterCommand('mf_simulate')).toBeNull()
    expect(classifyRouterCommand('ut_cam')).toBeNull()
    expect(classifyRouterCommand('ut_tools')).toBeNull()
  })

  it('returns null for FDM, design tools, and unknown ids', () => {
    expect(classifyRouterCommand('fdm_slice_plate')).toBeNull()
    expect(classifyRouterCommand('ut_slice')).toBeNull()
    expect(classifyRouterCommand('mf_additive')).toBeNull()
    expect(classifyRouterCommand('sk_line')).toBeNull()
    expect(classifyRouterCommand('so_extrude')).toBeNull()
    expect(classifyRouterCommand('totally_unknown')).toBeNull()
  })
})

describe('ROUTER_COMMAND_OP_KIND — op-kind mapping', () => {
  it('maps op-seeding ids to a cnc_* runtime op kind', () => {
    expect(ROUTER_COMMAND_OP_KIND[ROUTER_OP_PROFILE_COMMAND_ID]).toBe('cnc_contour')
    expect(ROUTER_COMMAND_OP_KIND[ROUTER_OP_POCKET_COMMAND_ID]).toBe('cnc_pocket')
    expect(ROUTER_COMMAND_OP_KIND[ROUTER_OP_DRILL_COMMAND_ID]).toBe('cnc_drill')
  })

  it('routes V-carve to the new cnc_vcarve op — NOT cnc_chamfer (the gap-audit bug)', () => {
    expect(ROUTER_COMMAND_OP_KIND[ROUTER_OP_VCARVE_COMMAND_ID]).toBe('cnc_vcarve')
    expect(ROUTER_COMMAND_OP_KIND[ROUTER_OP_VCARVE_COMMAND_ID]).not.toBe('cnc_chamfer')
  })

  it('every mapped value is a cnc_* op kind', () => {
    for (const opKind of Object.values(ROUTER_COMMAND_OP_KIND)) {
      expect(opKind.startsWith('cnc_')).toBe(true)
    }
  })

  it('every op-seeding command id has an op-kind entry', () => {
    for (const id of routerCommandIds()) {
      const kind = classifyRouterCommand(id)
      if (kind === 'profile_op' || kind === 'pocket_op' || kind === 'vcarve_op' || kind === 'drill_op') {
        expect(ROUTER_COMMAND_OP_KIND[id]).toBeDefined()
      }
    }
  })
})

describe('routerCommandIds — the registered id set', () => {
  it('includes the six ro_* catalog rows (shipped on the manufacture workspace)', () => {
    const ids = new Set(routerCommandIds())
    for (const id of [
      ROUTER_IMPORT_DXF_COMMAND_ID,
      ROUTER_OP_PROFILE_COMMAND_ID,
      ROUTER_OP_POCKET_COMMAND_ID,
      ROUTER_OP_VCARVE_COMMAND_ID,
      ROUTER_OP_DRILL_COMMAND_ID,
      ROUTER_NEST_COMMAND_ID
    ]) {
      expect(ids.has(id)).toBe(true)
      // Premise: these ARE shipped catalog rows on the manufacture workspace.
      expect(
        FUSION_STYLE_COMMAND_CATALOG.some((c) => c.id === id && c.workspace === 'manufacture')
      ).toBe(true)
    }
  })

  it('includes the forward-looking synthetic simulate / send ids (no catalog row)', () => {
    const ids = new Set(routerCommandIds())
    for (const id of [ROUTER_SIMULATE_COMMAND_ID, ROUTER_POST_COMMAND_ID]) {
      expect(ids.has(id)).toBe(true)
      // Confirm the premise: genuinely absent from the shipped catalog.
      expect(FUSION_STYLE_COMMAND_CATALOG.some((c) => c.id === id)).toBe(false)
    }
  })

  it('covers every router-classifiable manufacture-workspace catalog row', () => {
    const ids = new Set(routerCommandIds())
    for (const command of FUSION_STYLE_COMMAND_CATALOG) {
      if (command.workspace === 'manufacture' && classifyRouterCommand(command.id) !== null) {
        expect(ids.has(command.id)).toBe(true)
      }
    }
  })

  it('does not include CAM-owned manufacture rows (disjoint from cam-commands)', () => {
    const ids = new Set(routerCommandIds())
    for (const id of ['mf_setup', 'mf_op_2d_pocket', 'mf_op_parallel', 'mf_simulate', 'ut_cam', 'ut_tools']) {
      expect(ids.has(id)).toBe(false)
    }
  })

  it('does not include FDM-owned slice rows (disjoint from fdm-commands)', () => {
    const ids = new Set(routerCommandIds())
    for (const id of ['ut_slice', 'mf_additive', 'fdm_slice_plate', 'fdm_process']) {
      expect(ids.has(id)).toBe(false)
    }
  })

  it('does not include design or synthetic shell commands', () => {
    const ids = new Set(routerCommandIds())
    expect(ids.has('sk_line')).toBe(false)
    expect(ids.has('so_extrude')).toBe(false)
    expect(ids.has('goto_manufacture')).toBe(false)
  })

  it('every id classifies to a non-null kind', () => {
    for (const id of routerCommandIds()) {
      expect(classifyRouterCommand(id)).not.toBeNull()
    }
  })

  it('every id is unique (no duplicate registrations)', () => {
    const arr = routerCommandIds()
    expect(new Set(arr).size).toBe(arr.length)
  })
})

describe('classifier disjointness — router vs cam vs fdm own disjoint id sets', () => {
  it('no router id is also a CAM or FDM id', () => {
    for (const id of routerCommandIds()) {
      expect(classifyCamCommand(id)).toBeNull()
      expect(classifyFdmCommand(id)).toBeNull()
    }
  })

  it('router does not claim any CAM-owned id and vice versa', () => {
    // The shared 2D mill rows belong to cam-commands; router uses its own ro_* ids.
    for (const id of ['mf_op_2d_face', 'mf_op_2d_pocket', 'mf_op_2d_drill']) {
      expect(classifyCamCommand(id)).not.toBeNull()
      expect(classifyRouterCommand(id)).toBeNull()
    }
  })

  it('router does not claim any FDM-owned id and vice versa', () => {
    for (const id of ['ut_slice', 'mf_additive', 'fdm_slice_plate', 'fdm_arrange']) {
      expect(classifyFdmCommand(id)).not.toBeNull()
      expect(classifyRouterCommand(id)).toBeNull()
    }
  })
})

describe('routerCommandEnabled — context gating', () => {
  it('every router command requires the Manufacture route', () => {
    for (const kind of ALL_KINDS) {
      expect(routerCommandEnabled(kind, ctx({ workspace: 'design', machineKind: 'router' }))).toBe(false)
      expect(routerCommandEnabled(kind, ctx({ workspace: 'workshop', machineKind: 'router' }))).toBe(
        false
      )
      expect(routerCommandEnabled(kind, ctx({ workspace: 'utilities', machineKind: 'router' }))).toBe(
        false
      )
    }
  })

  it('every router command requires the Laguna router — never mill or FDM', () => {
    for (const kind of ALL_KINDS) {
      expect(routerCommandEnabled(kind, router())).toBe(true)
      // The Carvera 4-axis mill must NOT light up the VCarve ribbon — this is the
      // load-bearing gate: ro_* rows are stricter than cam-commands' shared 2d_op
      // (which allows router OR mill).
      expect(routerCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'mill4' }))).toBe(
        false
      )
      // FDM printer offers no wood-routing ops.
      expect(routerCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'fdm' }))).toBe(
        false
      )
      // No machine selected → disabled (honestly empty router ribbon).
      expect(routerCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: null }))).toBe(
        false
      )
    }
  })
})

describe('buildRouterCommands — handler shape', () => {
  it('builds exactly one handler per routerCommandIds entry', () => {
    const handlers = buildRouterCommands(makeActions())
    const handlerIds = handlers.map((h) => h.id).sort()
    expect(handlerIds).toEqual([...routerCommandIds()].sort())
  })

  it('every handler carries an enabled predicate', () => {
    const handlers = buildRouterCommands(makeActions())
    for (const h of handlers) {
      expect(typeof h.enabled).toBe('function')
    }
  })
})

describe('dispatch — handlers call the right action', () => {
  it('the DXF import + nesting commands call their actions', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerRouterCommands(actions, reg)

    expect(reg.run(ROUTER_IMPORT_DXF_COMMAND_ID, router())).toBe(true)
    expect(reg.run(ROUTER_NEST_COMMAND_ID, router())).toBe(true)
    expect(actions.calls).toEqual(['importVectorsDxf', 'nest'])
  })

  it('each op-seeding command calls its matching op action', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerRouterCommands(actions, reg)

    expect(reg.run(ROUTER_OP_PROFILE_COMMAND_ID, router())).toBe(true)
    expect(reg.run(ROUTER_OP_POCKET_COMMAND_ID, router())).toBe(true)
    expect(reg.run(ROUTER_OP_VCARVE_COMMAND_ID, router())).toBe(true)
    expect(reg.run(ROUTER_OP_DRILL_COMMAND_ID, router())).toBe(true)
    expect(actions.calls).toEqual(['opProfile', 'opPocket', 'opVcarve', 'opDrill'])
  })

  it('simulate + send open their surfaces', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerRouterCommands(actions, reg)

    expect(reg.run(ROUTER_SIMULATE_COMMAND_ID, router())).toBe(true)
    expect(reg.run(ROUTER_POST_COMMAND_ID, router())).toBe(true)
    expect(actions.calls).toEqual(['simulate', 'post'])
  })

  it('a router command is skipped (no action) on the mill or FDM printer', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerRouterCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run(ROUTER_OP_VCARVE_COMMAND_ID, ctx({ workspace: 'manufacture', machineKind: 'mill4' }))).toBe(
      false
    )
    expect(reg.run(ROUTER_OP_PROFILE_COMMAND_ID, ctx({ workspace: 'manufacture', machineKind: 'fdm' }))).toBe(
      false
    )
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })

  it('a router command is skipped off the Manufacture route', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerRouterCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run(ROUTER_IMPORT_DXF_COMMAND_ID, ctx({ workspace: 'design', machineKind: 'router' }))).toBe(
      false
    )
    expect(reg.run(ROUTER_OP_VCARVE_COMMAND_ID, ctx({ workspace: 'design', machineKind: 'router' }))).toBe(
      false
    )
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })
})

describe('registerRouterCommands — registration + disposal', () => {
  it('registers onto a registry and the disposer removes every handler', () => {
    const reg = new CommandRegistry()
    const dispose = registerRouterCommands(makeActions(), reg)
    expect(reg.size).toBe(routerCommandIds().length)

    // A representative id is present...
    expect(reg.has(ROUTER_OP_VCARVE_COMMAND_ID)).toBe(true)
    expect(reg.has(ROUTER_IMPORT_DXF_COMMAND_ID)).toBe(true)
    dispose()
    // ...and gone after disposal.
    expect(reg.size).toBe(0)
    expect(reg.has(ROUTER_OP_VCARVE_COMMAND_ID)).toBe(false)
  })

  it('router command ids are disjoint from the synthetic shell command ids', () => {
    for (const id of routerCommandIds()) {
      expect(id.startsWith('goto_')).toBe(false)
      expect(id.startsWith('theme_')).toBe(false)
      expect(id.startsWith('shell_')).toBe(false)
    }
  })

  it('router command ids are disjoint from the Design ribbon ids (sketch/solid)', () => {
    for (const id of routerCommandIds()) {
      expect(id.startsWith('sk_')).toBe(false)
      expect(id.startsWith('so_')).toBe(false)
      expect(id.startsWith('co_')).toBe(false)
      expect(id.startsWith('dim_')).toBe(false)
    }
  })
})
