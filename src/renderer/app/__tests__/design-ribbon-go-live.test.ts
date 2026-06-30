/**
 * FG-3 / FG-5 (Wave 2 Integrate) — "go-live the ribbon" wiring pin.
 *
 * The Design ribbon's buttons dispatch catalog `command.id`s through the shared
 * registry; `DesignWorkspaceHost` registers the real {@link DesignCommandActions}
 * that turn those dispatches into cockpit state changes. This pin proves the
 * action seam end-to-end at the unit level (node-env, no React) by:
 *
 *   1. building an action bag with the SAME behavior the host installs
 *      (armSketchMode/armSketchTool flip a sketch flag + record the tool;
 *      openFeatureDialog maps a catalog id → a FeatureDialogKind or honestly
 *      reports "no dialog"; runInspect reports the inspect tool), then
 *   2. registering it via `registerDesignCommands` on a fresh isolated registry
 *      (exactly what the host does on `commandRegistry`), then
 *   3. dispatching representative ids the way the ribbon does (`registry.run`)
 *      and asserting the resulting state matches.
 *
 * It also pins the host's reverse `so_*` → dialog-kind map (the bit that decides
 * which dialog a Solid ribbon button opens) so a catalog rename can't silently
 * desync the ribbon from the Properties pane.
 */

import { describe, expect, it } from 'vitest'
import {
  type CommandContext,
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT
} from '../../commands/command-engine'
import {
  type DesignCommandActions,
  registerDesignCommands
} from '../../commands/design-commands'
import {
  FEATURE_DIALOG_COMMAND_ID,
  type FeatureDialogKind
} from '../../design/feature-dialogs'

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { ...DEFAULT_COMMAND_CONTEXT, ...overrides }
}

/** The host's reverse map (catalog id → dialog kind), reproduced for the pin. */
const KIND_BY_COMMAND = new Map(
  (Object.entries(FEATURE_DIALOG_COMMAND_ID) as Array<[FeatureDialogKind, string]>).map(
    ([kind, id]) => [id, kind]
  )
)

/**
 * A host-shaped action bag + the cockpit state it drives, so the test can assert
 * the post-dispatch state the way the running host would render it.
 */
function makeHostActions(): {
  actions: DesignCommandActions
  state: {
    sketchActive: boolean
    sketchPlaneArmed: boolean
    armedTool: string | null
    openedDialog: FeatureDialogKind | null
    toasts: string[]
  }
} {
  const state = {
    sketchActive: false,
    sketchPlaneArmed: false,
    armedTool: null as string | null,
    openedDialog: null as FeatureDialogKind | null,
    toasts: [] as string[]
  }
  const actions: DesignCommandActions = {
    armSketchMode: () => {
      state.sketchActive = true
    },
    armSketchPlane: () => {
      state.sketchPlaneArmed = true
    },
    disarmSketchMode: () => {
      state.sketchActive = false
      state.sketchPlaneArmed = false
      state.armedTool = null
    },
    armSketchTool: (toolId) => {
      state.sketchActive = true
      state.armedTool = toolId
    },
    openFeatureDialog: (catalogId) => {
      const kind = KIND_BY_COMMAND.get(catalogId)
      if (kind) {
        state.openedDialog = kind
        return
      }
      state.toasts.push(`no-dialog:${catalogId}`)
    },
    runInspect: (kind) => {
      state.toasts.push(`inspect:${kind}`)
    }
  }
  return { actions, state }
}

describe('Design ribbon go-live — action dispatch through the registry', () => {
  it('arming a sketch tool enters sketch mode AND records the tool id', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    // Sketch tools require sketch mode to be enabled — emulate the operator
    // having entered sketch mode first (the cockpit stage tab / armSketchMode).
    reg.run('sk_line', ctx({ workspace: 'design', sketchMode: true }))
    expect(state.sketchActive).toBe(true)
    expect(state.armedTool).toBe('sk_line')
  })

  it('opening a Solid command maps so_* → the matching dialog kind', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    reg.run('so_fillet', ctx({ workspace: 'design' }))
    expect(state.openedDialog).toBe('fillet')

    reg.run('so_extrude', ctx({ workspace: 'design' }))
    expect(state.openedDialog).toBe('extrude')
  })

  it('a Solid command with no dialog yet reports honestly (no fake dialog)', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    // so_loft is a BASE-SOLID mode (set at base build from the sketch profiles), not a post-op
    // kernel dialog, so the ribbon honestly reports it has no per-feature dialog rather than faking
    // one. (so_sweep now HAS a dialog — see the selection-heavy profile/path wave.)
    reg.run('so_loft', ctx({ workspace: 'design' }))
    expect(state.openedDialog).toBeNull()
    expect(state.toasts).toContain('no-dialog:so_loft')
  })

  it('an Inspect command routes to runInspect', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    reg.run('ut_measure', ctx({ workspace: 'design' }))
    expect(state.toasts).toContain('inspect:ut_measure')
  })

  it('sk_choose_plane arms face-pick for the sketch plane (Construct entry)', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    // Valid from the Design route even before sketch mode (it STARTS a sketch).
    const ran = reg.run('sk_choose_plane', ctx({ workspace: 'design', sketchMode: false }))
    expect(ran).toBe(true)
    expect(state.sketchPlaneArmed).toBe(true)
    // It does NOT jump straight into sketch mode — that happens once a face is picked.
    expect(state.sketchActive).toBe(false)
  })

  it('the Construct datum rows open their datum dialogs (co_* → datum_* kinds)', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    for (const [id, kind] of [
      ['co_offset_plane', 'datum_plane'],
      ['co_datum_axis', 'datum_axis'],
      ['co_datum_point', 'datum_point']
    ] as const) {
      state.openedDialog = null
      const ran = reg.run(id, ctx({ workspace: 'design' }))
      expect(ran, `expected handler for ${id}`).toBe(true)
      expect(state.openedDialog).toBe(kind)
    }
  })

  it('sketch tools stay DISABLED (no dispatch) when not in sketch mode', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)

    // No sketchMode in ctx → enabled(ctx) is false → registry.run no-ops.
    const ran = reg.run('sk_line', ctx({ workspace: 'design', sketchMode: false }))
    expect(ran).toBe(false)
    expect(state.armedTool).toBeNull()
  })

  it('every feature-dialog kind has a registered Solid handler the host can open', () => {
    const reg = new CommandRegistry()
    const { actions, state } = makeHostActions()
    registerDesignCommands(actions, reg)
    for (const [kind, id] of Object.entries(FEATURE_DIALOG_COMMAND_ID) as Array<
      [FeatureDialogKind, string]
    >) {
      state.openedDialog = null
      const ran = reg.run(id, ctx({ workspace: 'design' }))
      expect(ran, `expected handler for ${id}`).toBe(true)
      expect(state.openedDialog).toBe(kind)
    }
  })
})
