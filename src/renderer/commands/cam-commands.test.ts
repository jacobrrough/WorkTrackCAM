import { describe, expect, it, vi } from 'vitest'
import {
  type CommandContext,
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT
} from './command-engine'
import {
  type CamCommandActions,
  CAM_COMMAND_OP_KIND,
  MULTI_SETUP_COMMAND_ID,
  PROBING_COMMAND_ID,
  SEND_COMMAND_ID,
  buildCamCommands,
  camCommandEnabled,
  camCommandIds,
  classifyCamCommand,
  registerCamCommands
} from './cam-commands'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'

/** A context helper so tests don't spell out every field. */
function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { ...DEFAULT_COMMAND_CONTEXT, ...overrides }
}

/** A spy action bag that records the (method, arg) of every call. */
function makeActions(): CamCommandActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    openSetup: () => calls.push('openSetup'),
    newOperation: (kind) => calls.push(`newOperation:${kind}`),
    openProbing: () => calls.push('openProbing'),
    openSimulate: () => calls.push('openSimulate'),
    openSend: () => calls.push('openSend'),
    openMultiSetup: () => calls.push('openMultiSetup'),
    openToolLibrary: () => calls.push('openToolLibrary')
  }
}

/** Manufacture context with the 4-axis mill active (rotary ops enabled). */
function mill4(overrides: Partial<CommandContext> = {}): CommandContext {
  return ctx({ workspace: 'manufacture', machineKind: 'mill4', ...overrides })
}

describe('classifyCamCommand', () => {
  it('classifies the Setup row', () => {
    expect(classifyCamCommand('mf_setup')).toBe('setup')
  })

  it('classifies the multi-setup / probing / send entry ids', () => {
    expect(classifyCamCommand(MULTI_SETUP_COMMAND_ID)).toBe('multi_setup')
    expect(classifyCamCommand(PROBING_COMMAND_ID)).toBe('probing')
    expect(classifyCamCommand(SEND_COMMAND_ID)).toBe('send')
  })

  it('classifies 2D op rows', () => {
    expect(classifyCamCommand('mf_op_2d_face')).toBe('2d_op')
    expect(classifyCamCommand('mf_op_2d_pocket')).toBe('2d_op')
    expect(classifyCamCommand('mf_op_2d_drill')).toBe('2d_op')
  })

  it('classifies 3D op rows', () => {
    expect(classifyCamCommand('mf_op_parallel')).toBe('3d_op')
    expect(classifyCamCommand('mf_op_waterline')).toBe('3d_op')
    expect(classifyCamCommand('mf_op_raster')).toBe('3d_op')
    expect(classifyCamCommand('mf_op_contour')).toBe('3d_op')
    expect(classifyCamCommand('mf_op_pocket_3d')).toBe('3d_op')
    expect(classifyCamCommand('mf_op_adaptive')).toBe('3d_op')
    expect(classifyCamCommand('mf_op_pencil')).toBe('3d_op')
  })

  it('classifies every 4-axis rotary id as rotary_op', () => {
    for (const id of Object.keys(CAM_COMMAND_OP_KIND)) {
      if (id.startsWith('mf_op_4axis_')) {
        expect(classifyCamCommand(id)).toBe('rotary_op')
      }
    }
  })

  it('classifies simulate + tool-library + ut_cam (Generate CAM → send)', () => {
    expect(classifyCamCommand('mf_simulate')).toBe('simulate')
    expect(classifyCamCommand('ut_tools')).toBe('tool_library')
    expect(classifyCamCommand('ut_cam')).toBe('send')
  })

  it('returns null for non-CAM ids (design tools, unknowns)', () => {
    expect(classifyCamCommand('sk_line')).toBeNull()
    expect(classifyCamCommand('so_extrude')).toBeNull()
    expect(classifyCamCommand('totally_unknown')).toBeNull()
  })
})

describe('CAM_COMMAND_OP_KIND — op-kind mapping', () => {
  it('maps op-seeding ids to a cnc_* runtime op kind', () => {
    expect(CAM_COMMAND_OP_KIND['mf_op_2d_pocket']).toBe('cnc_pocket')
    expect(CAM_COMMAND_OP_KIND['mf_op_2d_drill']).toBe('cnc_drill')
    expect(CAM_COMMAND_OP_KIND['mf_op_parallel']).toBe('cnc_parallel')
    expect(CAM_COMMAND_OP_KIND['mf_op_4axis_roughing']).toBe('cnc_4axis_roughing')
    expect(CAM_COMMAND_OP_KIND['mf_op_4axis_indexed']).toBe('cnc_4axis_indexed')
  })

  it('every mapped value is a cnc_* op kind', () => {
    for (const opKind of Object.values(CAM_COMMAND_OP_KIND)) {
      expect(opKind.startsWith('cnc_')).toBe(true)
    }
  })

  it('every op-seeding command id has an op-kind entry', () => {
    for (const id of camCommandIds()) {
      const kind = classifyCamCommand(id)
      if (kind === '2d_op' || kind === '3d_op' || kind === 'rotary_op') {
        expect(CAM_COMMAND_OP_KIND[id]).toBeDefined()
      }
    }
  })
})

describe('camCommandIds — the registered id set', () => {
  it('includes the forward-looking Carvera ids that have no catalog row', () => {
    const ids = new Set(camCommandIds())
    for (const id of [
      MULTI_SETUP_COMMAND_ID,
      PROBING_COMMAND_ID,
      SEND_COMMAND_ID,
      'mf_op_4axis_roughing',
      'mf_op_4axis_finishing',
      'mf_op_4axis_indexed'
    ]) {
      expect(ids.has(id)).toBe(true)
      // Confirm the premise: genuinely absent from the shipped catalog.
      expect(FUSION_STYLE_COMMAND_CATALOG.some((c) => c.id === id)).toBe(false)
    }
  })

  it('covers every classifiable manufacture-workspace catalog row', () => {
    const ids = new Set(camCommandIds())
    for (const command of FUSION_STYLE_COMMAND_CATALOG) {
      if (command.workspace === 'manufacture' && classifyCamCommand(command.id) !== null) {
        expect(ids.has(command.id)).toBe(true)
      }
    }
  })

  it('includes the live catalog Setup / 2D / 3D / simulate / send / tools rows', () => {
    const ids = new Set(camCommandIds())
    expect(ids.has('mf_setup')).toBe(true)
    expect(ids.has('mf_op_2d_pocket')).toBe(true)
    expect(ids.has('mf_op_parallel')).toBe(true)
    expect(ids.has('mf_simulate')).toBe(true)
    expect(ids.has('ut_cam')).toBe(true)
    expect(ids.has('ut_tools')).toBe(true)
  })

  it('does not include design or synthetic shell commands', () => {
    const ids = new Set(camCommandIds())
    expect(ids.has('sk_line')).toBe(false)
    expect(ids.has('so_extrude')).toBe(false)
    expect(ids.has('goto_manufacture')).toBe(false)
  })

  it('every id is unique (no duplicate registrations)', () => {
    const arr = camCommandIds()
    expect(new Set(arr).size).toBe(arr.length)
  })
})

describe('camCommandEnabled — context gating', () => {
  it('every CAM command requires the Manufacture route', () => {
    for (const kind of [
      'setup',
      'multi_setup',
      '2d_op',
      '3d_op',
      'rotary_op',
      'probing',
      'simulate',
      'send',
      'tool_library'
    ] as const) {
      // Off the manufacture route → disabled regardless of machine.
      expect(camCommandEnabled(kind, ctx({ workspace: 'design', machineKind: 'mill4' }))).toBe(false)
      expect(camCommandEnabled(kind, ctx({ workspace: 'workshop', machineKind: 'mill4' }))).toBe(
        false
      )
    }
  })

  it('rotary ops require the 4-axis mill — never the router or FDM', () => {
    expect(camCommandEnabled('rotary_op', mill4())).toBe(true)
    expect(camCommandEnabled('rotary_op', ctx({ workspace: 'manufacture', machineKind: 'router' }))).toBe(
      false
    )
    expect(camCommandEnabled('rotary_op', ctx({ workspace: 'manufacture', machineKind: 'fdm' }))).toBe(
      false
    )
    expect(camCommandEnabled('rotary_op', ctx({ workspace: 'manufacture', machineKind: null }))).toBe(
      false
    )
  })

  it('2D / 3D milling ops require a subtractive machine (router or mill, not FDM)', () => {
    for (const kind of ['2d_op', '3d_op'] as const) {
      expect(camCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'router' }))).toBe(
        true
      )
      expect(camCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'mill4' }))).toBe(
        true
      )
      // FDM printer offers no milling ops.
      expect(camCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'fdm' }))).toBe(
        false
      )
      // No machine selected.
      expect(camCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: null }))).toBe(
        false
      )
    }
  })

  it('setup / probing / simulate / send / tools need a machine but are machine-agnostic', () => {
    for (const kind of [
      'setup',
      'multi_setup',
      'probing',
      'simulate',
      'send',
      'tool_library'
    ] as const) {
      for (const machineKind of ['fdm', 'router', 'mill4'] as const) {
        expect(camCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind }))).toBe(true)
      }
      // No machine selected → disabled (honestly empty Manufacture ribbon).
      expect(camCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: null }))).toBe(
        false
      )
    }
  })
})

describe('buildCamCommands — handler shape', () => {
  it('builds exactly one handler per camCommandIds entry', () => {
    const handlers = buildCamCommands(makeActions())
    const handlerIds = handlers.map((h) => h.id).sort()
    expect(handlerIds).toEqual([...camCommandIds()].sort())
  })

  it('every handler carries an enabled predicate', () => {
    const handlers = buildCamCommands(makeActions())
    for (const h of handlers) {
      expect(typeof h.enabled).toBe('function')
    }
  })
})

describe('dispatch — handlers call the right action', () => {
  it('a 2D op command seeds the matching op kind', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)

    expect(reg.run('mf_op_2d_pocket', mill4())).toBe(true)
    expect(reg.run('mf_op_2d_drill', mill4())).toBe(true)
    expect(actions.calls).toEqual(['newOperation:cnc_pocket', 'newOperation:cnc_drill'])
  })

  it('a 3D op command seeds the matching op kind', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)

    expect(reg.run('mf_op_parallel', mill4())).toBe(true)
    expect(reg.run('mf_op_waterline', mill4())).toBe(true)
    expect(actions.calls).toEqual(['newOperation:cnc_parallel', 'newOperation:cnc_waterline'])
  })

  it('a rotary op command seeds the matching 4-axis op kind (mill4 only)', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)

    expect(reg.run('mf_op_4axis_roughing', mill4())).toBe(true)
    expect(reg.run('mf_op_4axis_indexed', mill4())).toBe(true)
    expect(actions.calls).toEqual([
      'newOperation:cnc_4axis_roughing',
      'newOperation:cnc_4axis_indexed'
    ])
  })

  it('Setup / multi-setup / probing / simulate / send / tools open their surfaces', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)

    const at = mill4()
    expect(reg.run('mf_setup', at)).toBe(true)
    expect(reg.run(MULTI_SETUP_COMMAND_ID, at)).toBe(true)
    expect(reg.run(PROBING_COMMAND_ID, at)).toBe(true)
    expect(reg.run('mf_simulate', at)).toBe(true)
    expect(reg.run(SEND_COMMAND_ID, at)).toBe(true)
    expect(reg.run('ut_cam', at)).toBe(true)
    expect(reg.run('ut_tools', at)).toBe(true)
    expect(actions.calls).toEqual([
      'openSetup',
      'openMultiSetup',
      'openProbing',
      'openSimulate',
      'openSend',
      'openSend',
      'openToolLibrary'
    ])
  })

  it('a rotary op is skipped (no action) when the machine is not a 4-axis mill', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Router active → rotary disabled → run() false, action not called.
    expect(reg.run('mf_op_4axis_roughing', ctx({ workspace: 'manufacture', machineKind: 'router' }))).toBe(
      false
    )
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })

  it('a milling op is skipped on the FDM printer', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run('mf_op_2d_pocket', ctx({ workspace: 'manufacture', machineKind: 'fdm' }))).toBe(
      false
    )
    expect(reg.run('mf_op_parallel', ctx({ workspace: 'manufacture', machineKind: 'fdm' }))).toBe(
      false
    )
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })

  it('a CAM command is skipped off the Manufacture route', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerCamCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run('mf_setup', ctx({ workspace: 'design', machineKind: 'mill4' }))).toBe(false)
    expect(reg.run('mf_op_2d_pocket', ctx({ workspace: 'design', machineKind: 'mill4' }))).toBe(false)
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })
})

describe('registerCamCommands — registration + disposal', () => {
  it('registers onto a registry and the disposer removes every handler', () => {
    const reg = new CommandRegistry()
    const dispose = registerCamCommands(makeActions(), reg)
    expect(reg.size).toBe(camCommandIds().length)

    // A representative id is present...
    expect(reg.has('mf_setup')).toBe(true)
    expect(reg.has('mf_op_4axis_roughing')).toBe(true)
    dispose()
    // ...and gone after disposal.
    expect(reg.size).toBe(0)
    expect(reg.has('mf_setup')).toBe(false)
  })

  it('CAM command ids are disjoint from the synthetic shell command ids', () => {
    for (const id of camCommandIds()) {
      expect(id.startsWith('goto_')).toBe(false)
      expect(id.startsWith('theme_')).toBe(false)
      expect(id.startsWith('shell_')).toBe(false)
    }
  })

  it('CAM command ids are disjoint from the Design ribbon ids (sketch/solid)', () => {
    for (const id of camCommandIds()) {
      expect(id.startsWith('sk_')).toBe(false)
      expect(id.startsWith('so_')).toBe(false)
      expect(id.startsWith('co_')).toBe(false)
      expect(id.startsWith('dim_')).toBe(false)
    }
  })
})
