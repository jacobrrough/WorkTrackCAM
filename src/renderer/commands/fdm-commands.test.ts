import { describe, expect, it, vi } from 'vitest'
import {
  type CommandContext,
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT
} from './command-engine'
import {
  type FdmCommandActions,
  type FdmCommandKind,
  FDM_ARRANGE_COMMAND_ID,
  FDM_DEVICE_COMMAND_ID,
  FDM_IMPORT_COMMAND_ID,
  FDM_JOB_CANCEL_COMMAND_ID,
  FDM_JOB_PAUSE_COMMAND_ID,
  FDM_JOB_RESUME_COMMAND_ID,
  FDM_ORIENT_COMMAND_ID,
  FDM_PREVIEW_COMMAND_ID,
  FDM_PROCESS_COMMAND_ID,
  FDM_SLICE_ALL_COMMAND_ID,
  FDM_SLICE_PLATE_COMMAND_ID,
  FDM_SUPPORTS_COMMAND_ID,
  buildFdmCommands,
  classifyFdmCommand,
  fdmCommandEnabled,
  fdmCommandIds,
  registerFdmCommands
} from './fdm-commands'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'

/** A context helper so tests don't spell out every field. */
function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { ...DEFAULT_COMMAND_CONTEXT, ...overrides }
}

/** A spy action bag that records the name of every call. */
function makeActions(): FdmCommandActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    importModel: () => calls.push('importModel'),
    arrange: () => calls.push('arrange'),
    autoOrient: () => calls.push('autoOrient'),
    openSupports: () => calls.push('openSupports'),
    openProcess: () => calls.push('openProcess'),
    openPreview: () => calls.push('openPreview'),
    openDevice: () => calls.push('openDevice'),
    slicePlate: () => calls.push('slicePlate'),
    sliceAll: () => calls.push('sliceAll'),
    jobPause: () => calls.push('jobPause'),
    jobResume: () => calls.push('jobResume'),
    jobCancel: () => calls.push('jobCancel')
  }
}

/** Manufacture context with the K2 FDM printer active (FDM commands enabled). */
function fdm(overrides: Partial<CommandContext> = {}): CommandContext {
  return ctx({ workspace: 'manufacture', machineKind: 'fdm', ...overrides })
}

/** Every FDM command kind, for exhaustive-gating loops. */
const ALL_KINDS: readonly FdmCommandKind[] = [
  'import',
  'arrange',
  'orient',
  'supports',
  'process',
  'preview',
  'device',
  'slice_plate',
  'slice_all',
  'job_pause',
  'job_resume',
  'job_cancel'
]

describe('classifyFdmCommand', () => {
  it('classifies each synthetic Prepare/Arrange id', () => {
    expect(classifyFdmCommand(FDM_IMPORT_COMMAND_ID)).toBe('import')
    expect(classifyFdmCommand(FDM_ARRANGE_COMMAND_ID)).toBe('arrange')
    expect(classifyFdmCommand(FDM_ORIENT_COMMAND_ID)).toBe('orient')
  })

  it('classifies the Supports / Process / Preview / Device editor ids', () => {
    expect(classifyFdmCommand(FDM_SUPPORTS_COMMAND_ID)).toBe('supports')
    expect(classifyFdmCommand(FDM_PROCESS_COMMAND_ID)).toBe('process')
    expect(classifyFdmCommand(FDM_PREVIEW_COMMAND_ID)).toBe('preview')
    expect(classifyFdmCommand(FDM_DEVICE_COMMAND_ID)).toBe('device')
  })

  it('classifies the slice + job-control ids', () => {
    expect(classifyFdmCommand(FDM_SLICE_PLATE_COMMAND_ID)).toBe('slice_plate')
    expect(classifyFdmCommand(FDM_SLICE_ALL_COMMAND_ID)).toBe('slice_all')
    expect(classifyFdmCommand(FDM_JOB_PAUSE_COMMAND_ID)).toBe('job_pause')
    expect(classifyFdmCommand(FDM_JOB_RESUME_COMMAND_ID)).toBe('job_resume')
    expect(classifyFdmCommand(FDM_JOB_CANCEL_COMMAND_ID)).toBe('job_cancel')
  })

  it('routes the FDM-flavored catalog Slice rows to slice_plate', () => {
    expect(classifyFdmCommand('ut_slice')).toBe('slice_plate')
    expect(classifyFdmCommand('mf_additive')).toBe('slice_plate')
  })

  it('returns null for CAM-owned manufacture ids (cam-commands owns them)', () => {
    expect(classifyFdmCommand('mf_setup')).toBeNull()
    expect(classifyFdmCommand('mf_op_2d_pocket')).toBeNull()
    expect(classifyFdmCommand('mf_op_parallel')).toBeNull()
    expect(classifyFdmCommand('mf_simulate')).toBeNull()
    expect(classifyFdmCommand('ut_cam')).toBeNull()
    expect(classifyFdmCommand('ut_tools')).toBeNull()
  })

  it('returns null for design tools and unknown ids', () => {
    expect(classifyFdmCommand('sk_line')).toBeNull()
    expect(classifyFdmCommand('so_extrude')).toBeNull()
    expect(classifyFdmCommand('totally_unknown')).toBeNull()
  })
})

describe('fdmCommandIds — the registered id set', () => {
  it('includes the forward-looking synthetic FDM ids that have no catalog row', () => {
    const ids = new Set(fdmCommandIds())
    for (const id of [
      FDM_IMPORT_COMMAND_ID,
      FDM_ARRANGE_COMMAND_ID,
      FDM_ORIENT_COMMAND_ID,
      FDM_SUPPORTS_COMMAND_ID,
      FDM_PROCESS_COMMAND_ID,
      FDM_PREVIEW_COMMAND_ID,
      FDM_DEVICE_COMMAND_ID,
      FDM_SLICE_PLATE_COMMAND_ID,
      FDM_SLICE_ALL_COMMAND_ID,
      FDM_JOB_PAUSE_COMMAND_ID,
      FDM_JOB_RESUME_COMMAND_ID,
      FDM_JOB_CANCEL_COMMAND_ID
    ]) {
      expect(ids.has(id)).toBe(true)
      // Confirm the premise: genuinely absent from the shipped catalog.
      expect(FUSION_STYLE_COMMAND_CATALOG.some((c) => c.id === id)).toBe(false)
    }
  })

  it('includes the live catalog FDM-flavored Slice rows', () => {
    const ids = new Set(fdmCommandIds())
    expect(ids.has('ut_slice')).toBe(true)
    expect(ids.has('mf_additive')).toBe(true)
    // Premise: these ARE shipped catalog rows on the manufacture workspace.
    for (const id of ['ut_slice', 'mf_additive']) {
      expect(
        FUSION_STYLE_COMMAND_CATALOG.some((c) => c.id === id && c.workspace === 'manufacture')
      ).toBe(true)
    }
  })

  it('does not include CAM-owned manufacture rows (disjoint from cam-commands)', () => {
    const ids = new Set(fdmCommandIds())
    for (const id of ['mf_setup', 'mf_op_2d_pocket', 'mf_op_parallel', 'mf_simulate', 'ut_cam', 'ut_tools']) {
      expect(ids.has(id)).toBe(false)
    }
  })

  it('does not include design or synthetic shell commands', () => {
    const ids = new Set(fdmCommandIds())
    expect(ids.has('sk_line')).toBe(false)
    expect(ids.has('so_extrude')).toBe(false)
    expect(ids.has('goto_manufacture')).toBe(false)
  })

  it('every id classifies to a non-null kind', () => {
    for (const id of fdmCommandIds()) {
      expect(classifyFdmCommand(id)).not.toBeNull()
    }
  })

  it('every id is unique (no duplicate registrations)', () => {
    const arr = fdmCommandIds()
    expect(new Set(arr).size).toBe(arr.length)
  })
})

describe('fdmCommandEnabled — context gating', () => {
  it('every FDM command requires the Manufacture route', () => {
    for (const kind of ALL_KINDS) {
      expect(fdmCommandEnabled(kind, ctx({ workspace: 'design', machineKind: 'fdm' }))).toBe(false)
      expect(fdmCommandEnabled(kind, ctx({ workspace: 'workshop', machineKind: 'fdm' }))).toBe(false)
      expect(fdmCommandEnabled(kind, ctx({ workspace: 'utilities', machineKind: 'fdm' }))).toBe(false)
    }
  })

  it('every FDM command requires the FDM printer — never router or mill', () => {
    for (const kind of ALL_KINDS) {
      expect(fdmCommandEnabled(kind, fdm())).toBe(true)
      expect(fdmCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'router' }))).toBe(
        false
      )
      expect(fdmCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: 'mill4' }))).toBe(
        false
      )
      // No machine selected → disabled (honestly empty FDM ribbon).
      expect(fdmCommandEnabled(kind, ctx({ workspace: 'manufacture', machineKind: null }))).toBe(
        false
      )
    }
  })
})

describe('buildFdmCommands — handler shape', () => {
  it('builds exactly one handler per fdmCommandIds entry', () => {
    const handlers = buildFdmCommands(makeActions())
    const handlerIds = handlers.map((h) => h.id).sort()
    expect(handlerIds).toEqual([...fdmCommandIds()].sort())
  })

  it('every handler carries an enabled predicate', () => {
    const handlers = buildFdmCommands(makeActions())
    for (const h of handlers) {
      expect(typeof h.enabled).toBe('function')
    }
  })
})

describe('dispatch — handlers call the right action', () => {
  it('Prepare / Arrange commands call their actions', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)

    expect(reg.run(FDM_IMPORT_COMMAND_ID, fdm())).toBe(true)
    expect(reg.run(FDM_ARRANGE_COMMAND_ID, fdm())).toBe(true)
    expect(reg.run(FDM_ORIENT_COMMAND_ID, fdm())).toBe(true)
    expect(actions.calls).toEqual(['importModel', 'arrange', 'autoOrient'])
  })

  it('Supports / Process / Preview / Device open their surfaces', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)

    const at = fdm()
    expect(reg.run(FDM_SUPPORTS_COMMAND_ID, at)).toBe(true)
    expect(reg.run(FDM_PROCESS_COMMAND_ID, at)).toBe(true)
    expect(reg.run(FDM_PREVIEW_COMMAND_ID, at)).toBe(true)
    expect(reg.run(FDM_DEVICE_COMMAND_ID, at)).toBe(true)
    expect(actions.calls).toEqual(['openSupports', 'openProcess', 'openPreview', 'openDevice'])
  })

  it('slice this-plate / all-plates call the matching slice action', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)

    expect(reg.run(FDM_SLICE_PLATE_COMMAND_ID, fdm())).toBe(true)
    expect(reg.run(FDM_SLICE_ALL_COMMAND_ID, fdm())).toBe(true)
    expect(actions.calls).toEqual(['slicePlate', 'sliceAll'])
  })

  it('the catalog Slice rows (ut_slice / mf_additive) route to slicePlate', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)

    expect(reg.run('ut_slice', fdm())).toBe(true)
    expect(reg.run('mf_additive', fdm())).toBe(true)
    expect(actions.calls).toEqual(['slicePlate', 'slicePlate'])
  })

  it('job pause / resume / cancel call the matching job-control action', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)

    expect(reg.run(FDM_JOB_PAUSE_COMMAND_ID, fdm())).toBe(true)
    expect(reg.run(FDM_JOB_RESUME_COMMAND_ID, fdm())).toBe(true)
    expect(reg.run(FDM_JOB_CANCEL_COMMAND_ID, fdm())).toBe(true)
    expect(actions.calls).toEqual(['jobPause', 'jobResume', 'jobCancel'])
  })

  it('an FDM command is skipped (no action) on the router or mill', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run(FDM_SLICE_PLATE_COMMAND_ID, ctx({ workspace: 'manufacture', machineKind: 'router' }))).toBe(
      false
    )
    expect(reg.run(FDM_PROCESS_COMMAND_ID, ctx({ workspace: 'manufacture', machineKind: 'mill4' }))).toBe(
      false
    )
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })

  it('an FDM command is skipped off the Manufacture route', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerFdmCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run(FDM_IMPORT_COMMAND_ID, ctx({ workspace: 'design', machineKind: 'fdm' }))).toBe(false)
    expect(reg.run(FDM_SLICE_PLATE_COMMAND_ID, ctx({ workspace: 'design', machineKind: 'fdm' }))).toBe(
      false
    )
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })
})

describe('registerFdmCommands — registration + disposal', () => {
  it('registers onto a registry and the disposer removes every handler', () => {
    const reg = new CommandRegistry()
    const dispose = registerFdmCommands(makeActions(), reg)
    expect(reg.size).toBe(fdmCommandIds().length)

    // A representative id is present...
    expect(reg.has(FDM_SLICE_PLATE_COMMAND_ID)).toBe(true)
    expect(reg.has('ut_slice')).toBe(true)
    dispose()
    // ...and gone after disposal.
    expect(reg.size).toBe(0)
    expect(reg.has(FDM_SLICE_PLATE_COMMAND_ID)).toBe(false)
  })

  it('FDM command ids are disjoint from the synthetic shell command ids', () => {
    for (const id of fdmCommandIds()) {
      expect(id.startsWith('goto_')).toBe(false)
      expect(id.startsWith('theme_')).toBe(false)
      expect(id.startsWith('shell_')).toBe(false)
    }
  })

  it('FDM command ids are disjoint from the Design ribbon ids (sketch/solid)', () => {
    for (const id of fdmCommandIds()) {
      expect(id.startsWith('sk_')).toBe(false)
      expect(id.startsWith('so_')).toBe(false)
      expect(id.startsWith('co_')).toBe(false)
      expect(id.startsWith('dim_')).toBe(false)
    }
  })
})
