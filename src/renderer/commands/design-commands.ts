/**
 * FG-3 / FG-5 prep · Design-ribbon command handlers.
 *
 * The Wave-1 Context Engine ({@link command-engine}) gave us a registry every
 * surface (ribbon, palette, marking menu) dispatches through, plus a deep-link
 * router so a command can `navigate(design) + arm(tool)`. What it deliberately
 * did NOT do is wire any CAD *tool* — every `FUSION_STYLE_COMMAND_CATALOG` row
 * stayed metadata-only, so it showed in the ribbon/palette but was honestly
 * greyed because no handler was registered (see `starter-commands.ts`).
 *
 * This module registers the **Design ribbon** handlers — the bridge between a
 * catalog `command.id` and the Design workspace's sketch/feature surfaces. It
 * mirrors `starter-commands.ts`: a pure factory ({@link buildDesignCommands})
 * that turns a host-action bag into {@link CommandHandler}s, plus a register
 * wrapper ({@link registerDesignCommands}) that mounts them and returns a
 * disposer. It is intentionally **pure** (no React, no DOM) so it unit-tests in
 * the `node` vitest env, exactly like the engine it feeds.
 *
 * The handlers do NOT themselves draw lines or solve sketches — they call into
 * an {@link DesignCommandActions} bag the host (the Design workspace) supplies.
 * That is the seam the *Integrate* phase fills with the real implementations:
 *   - `armSketchMode()` / `disarmSketchMode()` — enter / leave the contextual
 *     sketch stage (the green Sketch ribbon tab).
 *   - `armSketchTool(toolId)` — select a named sketch tool / constraint / dim
 *     picker. `toolId` is the **catalog id** (e.g. `'sk_line'`, `'co_tangent'`,
 *     `'dim_radial'`); the Design layer resolves it through the existing
 *     `design-command-map.ts` (`sketchToolForDesignCommand` /
 *     `constraintTypeForDesignCommand`). Arming a sketch tool implies sketch
 *     mode, so the integration `armSketchTool` is expected to enter sketch mode
 *     if it is not already active.
 *   - `openFeatureDialog(kind)` — open the property dialog for a solid /
 *     construct feature (Extrude, Revolve, Fillet, Hole, Offset-plane, …) or
 *     the Parameters manager. `kind` is the catalog id (e.g. `'so_extrude'`).
 *   - `runInspect(kind)` — run an Inspect tool (Measure / Section) against the
 *     mounted viewport.
 *
 * Enablement (`enabled(ctx)`) gates honestly by context:
 *   - Sketch tools + constraints + dimensions require `ctx.sketchMode` (you
 *     cannot trim a sketch you are not in). Exception: the sketch-*entry*
 *     commands (`sk_choose_plane`, and arming a Create tool) are valid from the
 *     Design workspace even before sketch mode, since they *start* a sketch.
 *   - Solid / construct / inspect / manage commands require the Design (or
 *     Drawings) workspace but not sketch mode.
 * No fakery: a command with no host action wired is still registered (so it is
 * discoverable) but its `run` calls the (possibly no-op) action — the honesty
 * contract lives in the action bag, not in pretend behavior here.
 */

import {
  type CommandContext,
  type CommandHandler,
  type CommandRegistry,
  commandRegistry
} from './command-engine'
import {
  DESIGN_CONSTRAINT_COMMAND_TO_TYPE,
  DESIGN_SKETCH_COMMAND_TO_TOOL
} from '../design/design-command-map'
import {
  DESIGN_RIBBON_COMMAND_IDS,
  FUSION_STYLE_COMMAND_CATALOG
} from '../../shared/fusion-style-command-catalog'

// ── Host action contract ─────────────────────────────────────────────────────

/**
 * The callbacks the Design ribbon handlers dispatch into. Supplied once by the
 * Design workspace host (the *Integrate* phase). Every method is intentionally
 * `void`-returning and side-effecting — the engine's `run(ctx)` is fire-and-
 * forget; the host owns the actual state transition + re-render.
 */
export interface DesignCommandActions {
  /** Enter the contextual sketch stage (no specific tool armed yet). */
  readonly armSketchMode: () => void
  /** Leave sketch mode (finish / cancel the active sketch). */
  readonly disarmSketchMode: () => void
  /**
   * Arm a named sketch tool, constraint, or dimension picker. `toolId` is the
   * **catalog id** (`'sk_line'`, `'co_parallel'`, `'dim_angular'`, …); the host
   * maps it to a concrete `SketchTool` / constraint type via
   * `design-command-map.ts`. Arming implies entering sketch mode.
   */
  readonly armSketchTool: (toolId: string) => void
  /**
   * Open the per-feature property dialog (or the Parameters manager). `kind` is
   * the catalog id (`'so_extrude'`, `'so_fillet'`, `'co_offset_plane'`,
   * `'ut_parameters'`, …). The host decides which dialog that id maps to.
   */
  readonly openFeatureDialog: (kind: string) => void
  /** Run an Inspect tool (`'ut_measure'` | `'ut_section'`) on the viewport. */
  readonly runInspect: (kind: string) => void
}

// ── Command classification ───────────────────────────────────────────────────

/**
 * The five behavioral classes a Design ribbon command falls into. Drives both
 * which host action a handler calls and which `enabled(ctx)` predicate it gets.
 * Exported so the unit test can assert the classification of every catalog id
 * without re-deriving the mapping.
 */
export type DesignCommandKind =
  /** Arm a draw tool (`sk_line`, `sk_circle_center`, …). Implies sketch mode. */
  | 'sketch_tool'
  /** Arm a constraint picker (`co_*`). Requires sketch mode. */
  | 'sketch_constraint'
  /** Arm a dimension picker (`dim_*`). Requires sketch mode. */
  | 'sketch_dimension'
  /** Enter sketch mode / pick a sketch plane (`sk_choose_plane`). */
  | 'sketch_enter'
  /** Open a solid / construct feature dialog (`so_*`, construct planes, …). */
  | 'feature_dialog'
  /** Run an Inspect tool (`ut_measure`, `ut_section`). */
  | 'inspect'
  /** Open the Parameters manager (`ut_parameters`). */
  | 'manage'

/** Catalog id for the sketch-on-plane / create-sketch entry command. */
export const SKETCH_PLANE_COMMAND_ID = 'sk_choose_plane'

/** Inspect command ids handled here (Measure / Section). */
const INSPECT_COMMAND_IDS: ReadonlySet<string> = new Set(['ut_measure', 'ut_section'])

/** Manage command ids handled here (Parameters). */
const MANAGE_COMMAND_IDS: ReadonlySet<string> = new Set(['ut_parameters'])

/**
 * Catalog ribbon groups whose rows open a per-feature property dialog (FG-5):
 * Solid Create/Modify/Pattern + Surface + Sheet-metal + Plastic. These rows are
 * not in `DESIGN_RIBBON_COMMAND_IDS` (that set is sketch/inspect-only), so the
 * classifier resolves them via their catalog `ribbon` group instead of by id.
 */
const FEATURE_DIALOG_RIBBON_GROUPS: ReadonlySet<string> = new Set([
  'solid_create',
  'solid_modify',
  'solid_pattern',
  'surface',
  'sheet_metal',
  'plastic'
])

/**
 * Catalog id → ribbon group, for the catalog rows (so the classifier can route
 * solid/construct rows to a feature dialog by group). Built once at module load.
 */
const CATALOG_RIBBON_BY_ID: ReadonlyMap<string, string> = new Map(
  FUSION_STYLE_COMMAND_CATALOG.filter((cmd) => cmd.workspace === 'design').map((cmd) => [
    cmd.id,
    cmd.ribbon
  ])
)

/**
 * Classify a catalog id into its {@link DesignCommandKind}, or `null` when the
 * id is not a Design-ribbon command this module owns. Pure + total over the ids
 * this module registers — it is the single source of truth shared by
 * {@link designCommandIds} and {@link buildDesignCommands} so all three agree.
 *
 * Order matters: the sketch-*entry* command is checked before the generic
 * sketch-tool map so `sk_choose_plane` (which has no draw-tool mapping) routes
 * to `sketch_enter`, not to a missing tool. The feature-dialog *group* check is
 * last so a sketch/constraint/dim/inspect id is never mis-routed to a dialog.
 */
export function classifyDesignCommand(id: string): DesignCommandKind | null {
  if (id === SKETCH_PLANE_COMMAND_ID) return 'sketch_enter'
  if (id in DESIGN_SKETCH_COMMAND_TO_TOOL) return 'sketch_tool'
  if (id in DESIGN_CONSTRAINT_COMMAND_TO_TYPE) return 'sketch_constraint'
  if (id.startsWith('dim_')) return 'sketch_dimension'
  if (INSPECT_COMMAND_IDS.has(id)) return 'inspect'
  if (MANAGE_COMMAND_IDS.has(id)) return 'manage'
  // Solid CREATE/MODIFY/PATTERN + Surface + Sheet-metal + Plastic catalog rows
  // resolve to a feature dialog, matched by their catalog ribbon group.
  const ribbon = CATALOG_RIBBON_BY_ID.get(id)
  if (ribbon !== undefined && FEATURE_DIALOG_RIBBON_GROUPS.has(ribbon)) return 'feature_dialog'
  return null
}

/**
 * The full set of catalog ids this module registers handlers for: every
 * `DESIGN_RIBBON_COMMAND_IDS` entry that this module can classify, the
 * Solid/Construct feature-dialog rows (matched by ribbon group), plus the
 * create-sketch entry id.
 *
 * `sk_choose_plane` is deliberately included even though it has **no**
 * `FUSION_STYLE_COMMAND_CATALOG` row (it lives only in the deep-link intent set)
 * — it is the create-sketch entry point and the Design workspace dispatches it
 * directly, so a handler must exist for it. See the honest gap note in the
 * module-level docs.
 */
export function designCommandIds(): string[] {
  const ids = new Set<string>()
  // 1) sk_choose_plane — entry command with no catalog row, dispatched directly.
  ids.add(SKETCH_PLANE_COMMAND_ID)
  // 2) Every DESIGN_RIBBON_COMMAND_IDS entry this module can classify.
  for (const id of DESIGN_RIBBON_COMMAND_IDS) {
    if (classifyDesignCommand(id) !== null) ids.add(id)
  }
  // 3) Solid / construct feature-dialog rows from the catalog.
  for (const command of FUSION_STYLE_COMMAND_CATALOG) {
    if (command.workspace === 'design' && FEATURE_DIALOG_RIBBON_GROUPS.has(command.ribbon)) {
      ids.add(command.id)
    }
  }
  return [...ids]
}

// ── Enablement predicates ────────────────────────────────────────────────────

/** True when the shell is on a Design-flavored route (Design or Drawings). */
function isDesignRoute(ctx: CommandContext): boolean {
  return ctx.workspace === 'design' || ctx.workspace === 'drawings'
}

/**
 * The `enabled(ctx)` predicate for a command kind. Pure + exported so the test
 * can assert the gating without constructing handlers.
 *   - sketch tools/constraints/dimensions ⇒ Design route AND sketch mode.
 *   - sketch *entry* (`sketch_enter`) ⇒ Design route (it *starts* sketch mode).
 *   - feature dialog / inspect / manage ⇒ Design route (no sketch mode needed).
 */
export function designCommandEnabled(kind: DesignCommandKind, ctx: CommandContext): boolean {
  switch (kind) {
    case 'sketch_tool':
    case 'sketch_constraint':
    case 'sketch_dimension':
      return isDesignRoute(ctx) && ctx.sketchMode === true
    case 'sketch_enter':
    case 'feature_dialog':
    case 'inspect':
    case 'manage':
      return isDesignRoute(ctx)
    default: {
      const _never: never = kind
      void _never
      return false
    }
  }
}

// ── Handler construction ─────────────────────────────────────────────────────

/**
 * Build the `run` for a classified command — the single place a kind maps onto
 * a host action. Kept separate from `enabled` so both are independently
 * testable.
 */
function runForKind(
  id: string,
  kind: DesignCommandKind,
  actions: DesignCommandActions
): (ctx: CommandContext) => void {
  switch (kind) {
    case 'sketch_enter':
      // sk_choose_plane: arm sketch mode (plane pick happens on the viewport).
      return () => actions.armSketchMode()
    case 'sketch_tool':
    case 'sketch_constraint':
    case 'sketch_dimension':
      // Arm the named tool/constraint/dimension by its catalog id.
      return () => actions.armSketchTool(id)
    case 'feature_dialog':
      return () => actions.openFeatureDialog(id)
    case 'inspect':
      return () => actions.runInspect(id)
    case 'manage':
      return () => actions.openFeatureDialog(id)
    default: {
      const _never: never = kind
      void _never
      return () => {}
    }
  }
}

/**
 * Build (but do not register) the Design ribbon handler list from the host
 * actions. Exported so tests can assert the handler set + dispatch behavior
 * without mutating a shared registry (mirrors `buildStarterCommands`).
 *
 * Every id from {@link designCommandIds} gets exactly one handler, with a
 * `run` that calls the matching action and an `enabled` gated per kind.
 */
export function buildDesignCommands(actions: DesignCommandActions): CommandHandler[] {
  const handlers: CommandHandler[] = []
  for (const id of designCommandIds()) {
    const kind = classifyDesignCommand(id)
    if (kind === null) continue
    handlers.push({
      id,
      run: runForKind(id, kind, actions),
      enabled: (ctx: CommandContext) => designCommandEnabled(kind, ctx)
    })
  }
  return handlers
}

/**
 * Register the Design ribbon handlers on a registry (defaults to the shared
 * one). Returns a disposer that unregisters every handler this call added —
 * call it from a React effect cleanup so re-mounts don't double-register
 * (mirrors `registerStarterCommands`).
 */
export function registerDesignCommands(
  actions: DesignCommandActions,
  registry: CommandRegistry = commandRegistry
): () => void {
  const disposers = buildDesignCommands(actions).map((h) => registry.register(h))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
