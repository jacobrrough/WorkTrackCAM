import { describe, expect, it, vi } from 'vitest'
import {
  type CommandContext,
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT
} from './command-engine'
import {
  type DesignCommandActions,
  SKETCH_PLANE_COMMAND_ID,
  SKETCH_TEXT_COMMAND_ID,
  buildDesignCommands,
  classifyDesignCommand,
  designCommandEnabled,
  designCommandIds,
  registerDesignCommands
} from './design-commands'
import {
  DESIGN_CONSTRAINT_COMMAND_TO_TYPE,
  DESIGN_SKETCH_COMMAND_TO_TOOL
} from '../design/design-command-map'
import {
  DESIGN_RIBBON_COMMAND_IDS,
  FUSION_STYLE_COMMAND_CATALOG
} from '../../shared/fusion-style-command-catalog'

/** A context helper so tests don't spell out every field. */
function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { ...DEFAULT_COMMAND_CONTEXT, ...overrides }
}

/** A spy action bag that records the (method, arg) of every call. */
function makeActions(): DesignCommandActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    armSketchMode: () => calls.push('armSketchMode'),
    armSketchPlane: () => calls.push('armSketchPlane'),
    disarmSketchMode: () => calls.push('disarmSketchMode'),
    armSketchTool: (toolId) => calls.push(`armSketchTool:${toolId}`),
    openFeatureDialog: (kind) => calls.push(`openFeatureDialog:${kind}`),
    runInspect: (kind) => calls.push(`runInspect:${kind}`)
  }
}

describe('classifyDesignCommand', () => {
  it('routes sk_choose_plane to sketch_enter (before the draw-tool map)', () => {
    expect(classifyDesignCommand(SKETCH_PLANE_COMMAND_ID)).toBe('sketch_enter')
  })

  it('classifies every draw-tool id as sketch_tool', () => {
    for (const id of Object.keys(DESIGN_SKETCH_COMMAND_TO_TOOL)) {
      expect(classifyDesignCommand(id)).toBe('sketch_tool')
    }
  })

  it('classifies constraint ids as sketch_constraint and dimension ids as sketch_dimension', () => {
    for (const id of Object.keys(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)) {
      expect(classifyDesignCommand(id)).toBe('sketch_constraint')
    }
    expect(classifyDesignCommand('dim_linear')).toBe('sketch_dimension')
    expect(classifyDesignCommand('dim_radial')).toBe('sketch_dimension')
    expect(classifyDesignCommand('dim_angular')).toBe('sketch_dimension')
  })

  it('classifies inspect + manage ids', () => {
    expect(classifyDesignCommand('ut_measure')).toBe('inspect')
    expect(classifyDesignCommand('ut_section')).toBe('inspect')
    expect(classifyDesignCommand('ut_parameters')).toBe('manage')
  })

  it('classifies Solid / construct catalog rows as feature_dialog (by ribbon group)', () => {
    expect(classifyDesignCommand('so_extrude')).toBe('feature_dialog')
    expect(classifyDesignCommand('so_revolve')).toBe('feature_dialog')
    expect(classifyDesignCommand('so_fillet')).toBe('feature_dialog')
    expect(classifyDesignCommand('so_pattern_rect')).toBe('feature_dialog')
  })

  it('routes sk_text to sketch_text (it opens the Text dialog, has no draw tool)', () => {
    expect(classifyDesignCommand(SKETCH_TEXT_COMMAND_ID)).toBe('sketch_text')
    // It is NOT in the draw-tool map (no SketchTool), so it must not be sketch_tool.
    expect(SKETCH_TEXT_COMMAND_ID in DESIGN_SKETCH_COMMAND_TO_TOOL).toBe(false)
  })

  it('returns null for non-Design-ribbon ids (CAM ops, unknowns)', () => {
    expect(classifyDesignCommand('mf_op_2d_pocket')).toBeNull()
    expect(classifyDesignCommand('totally_unknown')).toBeNull()
    // A Manufacture-workspace command is never a Design feature dialog.
    expect(classifyDesignCommand('mf_op_parallel')).toBeNull()
  })
})

describe('designCommandIds — the registered id set', () => {
  it('includes sk_choose_plane (the Construct sketch-on-face entry)', () => {
    const ids = new Set(designCommandIds())
    expect(ids.has(SKETCH_PLANE_COMMAND_ID)).toBe(true)
    // It now ships a catalog row in the Construct group (so it appears as a
    // ribbon button + in the palette) but STILL classifies as sketch_enter
    // (checked before the feature-dialog group match), not a feature dialog.
    const row = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === SKETCH_PLANE_COMMAND_ID)
    expect(row?.ribbon).toBe('construct')
    expect(classifyDesignCommand(SKETCH_PLANE_COMMAND_ID)).toBe('sketch_enter')
  })

  it('routes the Construct datum rows (co_offset_plane / axis / point) to feature dialogs', () => {
    const ids = new Set(designCommandIds())
    for (const id of ['co_offset_plane', 'co_datum_axis', 'co_datum_point']) {
      expect(classifyDesignCommand(id)).toBe('feature_dialog')
      expect(ids.has(id)).toBe(true)
    }
  })

  it('covers every classifiable DESIGN_RIBBON_COMMAND_IDS entry', () => {
    const ids = new Set(designCommandIds())
    for (const id of DESIGN_RIBBON_COMMAND_IDS) {
      if (classifyDesignCommand(id) !== null) {
        expect(ids.has(id)).toBe(true)
      }
    }
  })

  it('pulls Solid / Construct feature-dialog rows from the catalog', () => {
    const ids = new Set(designCommandIds())
    // Representative solid create/modify/pattern rows.
    expect(ids.has('so_extrude')).toBe(true)
    expect(ids.has('so_revolve')).toBe(true)
    expect(ids.has('so_fillet')).toBe(true)
    expect(ids.has('so_hole')).toBe(true)
    expect(ids.has('so_pattern_rect')).toBe(true)
  })

  it('does not include shell or CAM commands', () => {
    const ids = new Set(designCommandIds())
    expect(ids.has('mf_op_2d_pocket')).toBe(false)
    expect(ids.has('goto_design')).toBe(false)
  })

  it('every id is unique (no duplicate registrations)', () => {
    const arr = designCommandIds()
    expect(new Set(arr).size).toBe(arr.length)
  })
})

describe('designCommandEnabled — context gating', () => {
  it('sketch tools/constraints/dimensions require Design route AND sketch mode', () => {
    for (const kind of ['sketch_tool', 'sketch_constraint', 'sketch_dimension'] as const) {
      expect(designCommandEnabled(kind, ctx({ workspace: 'design', sketchMode: true }))).toBe(true)
      // No sketch mode → disabled.
      expect(designCommandEnabled(kind, ctx({ workspace: 'design', sketchMode: false }))).toBe(false)
      // Wrong workspace → disabled even with sketch mode.
      expect(designCommandEnabled(kind, ctx({ workspace: 'manufacture', sketchMode: true }))).toBe(
        false
      )
    }
  })

  it('sketch entry / text / feature / inspect / manage require only the Design route', () => {
    for (const kind of ['sketch_enter', 'sketch_text', 'feature_dialog', 'inspect', 'manage'] as const) {
      // Enabled on design even without sketch mode (these START a sketch / open a dialog).
      expect(designCommandEnabled(kind, ctx({ workspace: 'design', sketchMode: false }))).toBe(true)
      // Drawings is a Design-flavored route.
      expect(designCommandEnabled(kind, ctx({ workspace: 'drawings' }))).toBe(true)
      // Off-route → disabled.
      expect(designCommandEnabled(kind, ctx({ workspace: 'manufacture' }))).toBe(false)
      expect(designCommandEnabled(kind, ctx({ workspace: 'workshop' }))).toBe(false)
    }
  })
})

describe('buildDesignCommands — handler shape', () => {
  it('builds exactly one handler per designCommandIds entry', () => {
    const handlers = buildDesignCommands(makeActions())
    const handlerIds = handlers.map((h) => h.id).sort()
    expect(handlerIds).toEqual([...designCommandIds()].sort())
  })

  it('every handler carries an enabled predicate', () => {
    const handlers = buildDesignCommands(makeActions())
    for (const h of handlers) {
      expect(typeof h.enabled).toBe('function')
    }
  })
})

describe('dispatch — handlers call the right action', () => {
  it('a sketch-tool command arms the tool by its catalog id', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    const sketching = ctx({ workspace: 'design', sketchMode: true })
    expect(reg.run('sk_line', sketching)).toBe(true)
    expect(reg.run('sk_circle_center', sketching)).toBe(true)
    expect(actions.calls).toEqual(['armSketchTool:sk_line', 'armSketchTool:sk_circle_center'])
  })

  it('a constraint command arms the picker by its catalog id', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    expect(reg.run('co_tangent', ctx({ workspace: 'design', sketchMode: true }))).toBe(true)
    expect(actions.calls).toEqual(['armSketchTool:co_tangent'])
  })

  it('a dimension command arms the picker by its catalog id', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    expect(reg.run('dim_radial', ctx({ workspace: 'design', sketchMode: true }))).toBe(true)
    expect(actions.calls).toEqual(['armSketchTool:dim_radial'])
  })

  it('sk_choose_plane arms face-pick for the sketch plane (the create-sketch entry)', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    // Valid from the Design route even before sketch mode.
    expect(reg.run(SKETCH_PLANE_COMMAND_ID, ctx({ workspace: 'design', sketchMode: false }))).toBe(
      true
    )
    expect(actions.calls).toEqual(['armSketchPlane'])
  })

  it('sk_text arms the Text command (which the surface turns into the Text dialog)', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    // Valid from the Design route even before sketch mode (it starts a sketch).
    expect(reg.run(SKETCH_TEXT_COMMAND_ID, ctx({ workspace: 'design', sketchMode: false }))).toBe(
      true
    )
    // Arming Text flips sketch mode + records the catalog id; the mounted
    // SketchSurface opens the Text dialog when `sk_text` is the armed tool.
    expect(actions.calls).toEqual([`armSketchTool:${SKETCH_TEXT_COMMAND_ID}`])
  })

  it('a solid command opens its feature dialog by catalog id', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    expect(reg.run('so_extrude', ctx({ workspace: 'design' }))).toBe(true)
    expect(reg.run('so_fillet', ctx({ workspace: 'design' }))).toBe(true)
    expect(actions.calls).toEqual(['openFeatureDialog:so_extrude', 'openFeatureDialog:so_fillet'])
  })

  it('inspect commands run the matching inspect tool; parameters opens the manager', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)

    const design = ctx({ workspace: 'design' })
    expect(reg.run('ut_measure', design)).toBe(true)
    expect(reg.run('ut_section', design)).toBe(true)
    expect(reg.run('ut_parameters', design)).toBe(true)
    expect(actions.calls).toEqual([
      'runInspect:ut_measure',
      'runInspect:ut_section',
      'openFeatureDialog:ut_parameters'
    ])
  })

  it('a sketch tool is skipped (no action) when not in sketch mode', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // sketchMode false → disabled → run() returns false, action not called.
    expect(reg.run('sk_line', ctx({ workspace: 'design', sketchMode: false }))).toBe(false)
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })

  it('a Design command is skipped off the Design route', () => {
    const reg = new CommandRegistry()
    const actions = makeActions()
    registerDesignCommands(actions, reg)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(reg.run('so_extrude', ctx({ workspace: 'manufacture' }))).toBe(false)
    expect(reg.run('ut_measure', ctx({ workspace: 'workshop' }))).toBe(false)
    expect(actions.calls).toEqual([])
    warn.mockRestore()
  })
})

describe('registerDesignCommands — registration + disposal', () => {
  it('registers onto a registry and the disposer removes every handler', () => {
    const reg = new CommandRegistry()
    const dispose = registerDesignCommands(makeActions(), reg)
    expect(reg.size).toBe(designCommandIds().length)

    // A representative id is present...
    expect(reg.has('sk_line')).toBe(true)
    dispose()
    // ...and gone after disposal.
    expect(reg.size).toBe(0)
    expect(reg.has('sk_line')).toBe(false)
  })

  it('Design command ids are disjoint from the synthetic shell command ids', () => {
    // No handler id should collide with a goto_/theme_/shell_ synthetic id.
    for (const id of designCommandIds()) {
      expect(id.startsWith('goto_')).toBe(false)
      expect(id.startsWith('theme_')).toBe(false)
      expect(id.startsWith('shell_')).toBe(false)
    }
  })
})
