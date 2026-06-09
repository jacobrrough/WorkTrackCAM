/**
 * Wave-3 (Carvera-first) · Manufacture-ribbon command handlers.
 *
 * The Wave-1 Context Engine ({@link command-engine}) gave us a registry every
 * surface (ribbon, palette, marking menu) dispatches through. {@link
 * design-commands} then wired the *Design* ribbon — a catalog `command.id` → the
 * Design workspace's sketch / feature surfaces. This module is the CAM mirror of
 * that: it registers the **Manufacture ribbon** handlers — the bridge between a
 * catalog `command.id` and the Manufacture workspace's setup / toolpath /
 * probing / simulate / send surfaces.
 *
 * It mirrors `design-commands.ts` exactly:
 *   - a pure factory ({@link buildCamCommands}) that turns a host-action bag into
 *     {@link CommandHandler}s, plus
 *   - a register wrapper ({@link registerCamCommands}) that mounts them on a
 *     registry (defaults to the shared {@link commandRegistry}) and returns a
 *     disposer.
 * It is intentionally **pure** (no React, no DOM, no `window`) so it unit-tests
 * in the `node` vitest env, exactly like the engine + Design handlers it sits
 * beside.
 *
 * G-code safety note: these handlers do **not** generate, mutate, or post any
 * toolpath — they only *open* the relevant authoring surface (a Setup dialog, an
 * op editor seeded with an op kind, the Probing panel, the simulator, the Send
 * panel). The actual toolpath generation + the `carvera_4axis.hbs` post contract
 * live downstream in `src/main/cam-axis4/**` + `resources/posts/**` and are
 * untouched. The honesty contract lives in the {@link CamCommandActions} bag: a
 * command with no real host action wired is still registered (so it is
 * discoverable + greyed honestly per `enabled`) but its `run` calls the
 * (possibly no-op) action — no pretend behavior here.
 *
 * Enablement (`enabled(ctx)`) gates honestly by context:
 *   - Every CAM command requires `ctx.workspace === 'manufacture'`.
 *   - Rotary ops additionally require the 4-axis mill (`ctx.machineKind ===
 *     'mill4'`) — you cannot wrap a toolpath around an A axis the active machine
 *     does not have. This is the load-bearing safety gate: it keeps rotary
 *     strategies off the Laguna router and the K2 FDM printer entirely.
 *   - 2D / 3D milling ops require a *subtractive* machine (router or mill — not
 *     the FDM printer). The FDM printer only offers the slice/send (`send`) path.
 *   - Setup / probing / simulate / inspect / send / tool-library are valid on the
 *     Manufacture route for any selected machine.
 */

import {
  type CommandContext,
  type CommandHandler,
  type CommandRegistry,
  type MachineKind,
  commandRegistry
} from './command-engine'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'

// ── Host action contract ─────────────────────────────────────────────────────

/**
 * The callbacks the Manufacture ribbon handlers dispatch into. Supplied once by
 * the Manufacture workspace host (the *Integrate* phase — `ManufactureWorkspace`
 * is **not** edited here; it adopts this bag in a follow-up). Every method is
 * intentionally `void`-returning and side-effecting — the engine's `run(ctx)` is
 * fire-and-forget; the host owns the actual state transition + re-render.
 *
 * The seam is deliberately small (mirrors `DesignCommandActions`): the handlers
 * classify a catalog id into a behavioral kind and route it here; the host
 * decides what each entry point means (which dialog/panel/stage to open, and —
 * for `newOperation` — which op editor to seed for the given op `kind`).
 */
export interface CamCommandActions {
  /** Open the Setup dialog (machine + WCS + stock + rotary fixture). */
  readonly openSetup: () => void
  /**
   * Begin a new operation of the given op `kind`. `kind` is the **runtime CAM op
   * kind** (`'cnc_contour'`, `'cnc_pocket'`, `'cnc_drill'`, `'cnc_parallel'`,
   * `'cnc_4axis_roughing'`, …) the catalog id maps to — NOT the catalog id
   * itself — so the host seeds the right op editor directly. The mapping lives in
   * {@link CAM_COMMAND_OP_KIND}.
   */
  readonly newOperation: (kind: string) => void
  /** Open the Probing panel (single-surface / bore / boss / corner / A-zero). */
  readonly openProbing: () => void
  /** Open the toolpath Simulation / verification surface. */
  readonly openSimulate: () => void
  /** Open the Send / post-to-machine surface (upload, post options, setup sheet). */
  readonly openSend: () => void
  /** Open the Multi-setup / double-sided (A+180) wizard. */
  readonly openMultiSetup: () => void
  /** Open the tool library. */
  readonly openToolLibrary: () => void
}

// ── Command classification ───────────────────────────────────────────────────

/**
 * The behavioral classes a Manufacture-ribbon command falls into. Drives both
 * which host action a handler calls and which `enabled(ctx)` predicate it gets.
 * Exported so the unit test can assert the classification of every catalog id
 * without re-deriving the mapping.
 */
export type CamCommandKind =
  /** Open the Setup dialog (`mf_setup`). */
  | 'setup'
  /** Open the Multi-setup / A+180 wizard (`mf_multi_setup`). */
  | 'multi_setup'
  /** Seed a new **2D / 2.5D** milling op (`mf_op_2d_*`). Subtractive machines. */
  | '2d_op'
  /** Seed a new **3D** milling op (`mf_op_parallel|waterline|raster|…`). */
  | '3d_op'
  /** Seed a new **4-axis rotary** op (`mf_op_4axis_*`). Requires `mill4`. */
  | 'rotary_op'
  /** Open the Probing panel (`mf_probe*`). */
  | 'probing'
  /** Open the Simulation surface (`mf_simulate`). */
  | 'simulate'
  /** Open the Send / post surface (`mf_send*`, `ut_cam`). */
  | 'send'
  /** Open the tool library (`ut_tools`). */
  | 'tool_library'

/**
 * Catalog id → runtime CAM op kind, for the op-seeding commands (`2d_op` /
 * `3d_op` / `rotary_op`). The catalog `mf_*` ids are UI labels; the host needs
 * the concrete `cnc_*` op `kind` (the `ManufactureOperation['kind']` union in
 * `manufacture-schema.ts`) to open the matching op editor. Kept as one explicit
 * table so the mapping is auditable and the test can pin it — there is no clever
 * derivation that could silently route an op to the wrong topology.
 *
 * The forward-looking rotary entries (`mf_op_4axis_*`) have **no** catalog row
 * yet (the Carvera rotary ribbon rows land with the Wave-3 build); they are
 * included here — exactly as `design-commands` includes `sk_choose_plane` — so a
 * handler exists the moment the host dispatches them. See {@link camCommandIds}.
 */
export const CAM_COMMAND_OP_KIND: Readonly<Record<string, string>> = {
  // —— 2D / 2.5D (router + mill) ——
  mf_op_2d_face: 'cnc_contour',
  mf_op_2d_contour: 'cnc_contour',
  mf_op_2d_pocket: 'cnc_pocket',
  mf_op_2d_drill: 'cnc_drill',
  mf_op_2d_chamfer: 'cnc_chamfer',
  // —— 3D (planar 3-axis) ——
  mf_op_parallel: 'cnc_parallel',
  mf_op_waterline: 'cnc_waterline',
  mf_op_raster: 'cnc_raster',
  mf_op_contour: 'cnc_contour',
  mf_op_pocket_3d: 'cnc_pocket',
  mf_op_adaptive: 'cnc_adaptive',
  mf_op_pencil: 'cnc_pencil',
  // —— 4-axis rotary (Carvera; no catalog row yet — dispatched directly) ——
  mf_op_4axis_roughing: 'cnc_4axis_roughing',
  mf_op_4axis_finishing: 'cnc_4axis_finishing',
  mf_op_4axis_continuous: 'cnc_4axis_continuous',
  mf_op_4axis_indexed: 'cnc_4axis_indexed',
  mf_op_4axis_contour: 'cnc_4axis_contour'
}

/** Catalog id for the multi-setup / A+180 double-sided wizard (no catalog row). */
export const MULTI_SETUP_COMMAND_ID = 'mf_multi_setup'

/** Catalog id for the probing-cycle panel entry (no catalog row yet). */
export const PROBING_COMMAND_ID = 'mf_probe'

/** Catalog id for the Send / post-to-machine surface (no catalog row yet). */
export const SEND_COMMAND_ID = 'mf_send'

/** The op-kind prefix for the 4-axis rotary commands (drives `rotary_op`). */
const ROTARY_OP_ID_PREFIX = 'mf_op_4axis_'

/** The op-kind prefix for the 2D / 2.5D commands (drives `2d_op`). */
const TWO_D_OP_ID_PREFIX = 'mf_op_2d_'

/**
 * Manufacture-workspace ids that this module owns but that are **not** op-seeding
 * commands — they open a non-op surface. Listed explicitly so the classifier is
 * total over them without leaning on a brittle id-prefix guess.
 */
const SETUP_COMMAND_IDS: ReadonlySet<string> = new Set(['mf_setup'])
const SIMULATE_COMMAND_IDS: ReadonlySet<string> = new Set(['mf_simulate'])
const TOOL_LIBRARY_COMMAND_IDS: ReadonlySet<string> = new Set(['ut_tools'])
/** `ut_cam` ("Generate CAM" → post + send) routes to the Send surface. */
const SEND_COMMAND_IDS: ReadonlySet<string> = new Set([SEND_COMMAND_ID, 'ut_cam'])

/**
 * Classify a catalog id into its {@link CamCommandKind}, or `null` when the id
 * is not a Manufacture-ribbon command this module owns. Pure + total over the
 * ids this module registers — the single source of truth shared by {@link
 * camCommandIds} and {@link buildCamCommands} so they always agree.
 *
 * Order matters:
 *   1. The explicit non-op surfaces (setup / multi-setup / probing / simulate /
 *      send / tool-library) are matched first so a `send`/`simulate`/… id is
 *      never mis-routed to an op.
 *   2. Rotary (`mf_op_4axis_*`) is checked before the generic op-kind map so the
 *      forward-looking rotary ids (which have no catalog row) classify even
 *      though the op-kind map also lists them.
 *   3. 2D (`mf_op_2d_*`) before the residual op-kind map (those remaining ids
 *      are the 3D family).
 */
export function classifyCamCommand(id: string): CamCommandKind | null {
  if (SETUP_COMMAND_IDS.has(id)) return 'setup'
  if (id === MULTI_SETUP_COMMAND_ID) return 'multi_setup'
  if (id === PROBING_COMMAND_ID) return 'probing'
  if (SIMULATE_COMMAND_IDS.has(id)) return 'simulate'
  if (SEND_COMMAND_IDS.has(id)) return 'send'
  if (TOOL_LIBRARY_COMMAND_IDS.has(id)) return 'tool_library'
  // Op-seeding commands. Rotary first (some share the op-kind map), then 2D,
  // then the residual entries in the op-kind map are the 3D family.
  if (id.startsWith(ROTARY_OP_ID_PREFIX)) return 'rotary_op'
  if (id.startsWith(TWO_D_OP_ID_PREFIX)) return '2d_op'
  if (id in CAM_COMMAND_OP_KIND) return '3d_op'
  return null
}

/**
 * The full set of catalog ids this module registers handlers for: every
 * Manufacture-workspace catalog row that this module can classify, plus the
 * forward-looking Carvera ids that have no catalog row yet (rotary ops,
 * multi-setup, probing, send) but that the Manufacture workspace dispatches
 * directly.
 *
 * The no-catalog-row ids are deliberately included even though they have **no**
 * `FUSION_STYLE_COMMAND_CATALOG` entry — exactly like `design-commands` includes
 * `sk_choose_plane`. They are the Wave-3 Carvera entry points; a handler must
 * exist for them so the workspace can dispatch by id today. See the honest gap
 * note in the module-level docs.
 */
export function camCommandIds(): string[] {
  const ids = new Set<string>()
  // 1) Forward-looking Carvera ids with no catalog row, dispatched directly.
  for (const id of Object.keys(CAM_COMMAND_OP_KIND)) {
    if (id.startsWith(ROTARY_OP_ID_PREFIX)) ids.add(id)
  }
  ids.add(MULTI_SETUP_COMMAND_ID)
  ids.add(PROBING_COMMAND_ID)
  ids.add(SEND_COMMAND_ID)
  // 2) Every Manufacture-workspace catalog row this module can classify.
  for (const command of FUSION_STYLE_COMMAND_CATALOG) {
    if (command.workspace !== 'manufacture') continue
    if (classifyCamCommand(command.id) !== null) ids.add(command.id)
  }
  return [...ids]
}

// ── Enablement predicates ────────────────────────────────────────────────────

/** True when the shell is on the Manufacture route. */
function isManufactureRoute(ctx: CommandContext): boolean {
  return ctx.workspace === 'manufacture'
}

/**
 * True when the active machine is *subtractive* (router or 4-axis mill) — the
 * machines that run milling toolpaths. The FDM printer (`'fdm'`) and the
 * no-machine state (`null`) are excluded. 2D/3D milling ops gate on this.
 */
function isSubtractiveMachine(kind: MachineKind | null): boolean {
  return kind === 'router' || kind === 'mill4'
}

/**
 * The `enabled(ctx)` predicate for a command kind. Pure + exported so the test
 * can assert the gating without constructing handlers.
 *   - Everything requires the Manufacture route.
 *   - `rotary_op` additionally requires the 4-axis mill (`mill4`) — the
 *     load-bearing safety gate that keeps A-axis strategies off the router/FDM.
 *   - `2d_op` / `3d_op` require a subtractive machine (router or mill), so they
 *     are correctly absent on the FDM printer.
 *   - setup / multi_setup / probing / simulate / send / tool_library require a
 *     machine to be selected (`machineKind != null`) but are otherwise
 *     machine-agnostic — every CAM machine needs setup, simulate, and send.
 */
export function camCommandEnabled(kind: CamCommandKind, ctx: CommandContext): boolean {
  if (!isManufactureRoute(ctx)) return false
  switch (kind) {
    case 'rotary_op':
      return ctx.machineKind === 'mill4'
    case '2d_op':
    case '3d_op':
      return isSubtractiveMachine(ctx.machineKind)
    case 'setup':
    case 'multi_setup':
    case 'probing':
    case 'simulate':
    case 'send':
    case 'tool_library':
      return ctx.machineKind !== null
    default: {
      const _never: never = kind
      void _never
      return false
    }
  }
}

// ── Handler construction ─────────────────────────────────────────────────────

/**
 * Build the `run` for a classified command — the single place a kind maps onto a
 * host action. Kept separate from `enabled` so both are independently testable.
 * For op-seeding kinds (`2d_op` / `3d_op` / `rotary_op`) the run resolves the
 * catalog id to its runtime op `kind` via {@link CAM_COMMAND_OP_KIND} and passes
 * that to `newOperation` — the host never sees the UI id, only the op kind.
 */
function runForKind(
  id: string,
  kind: CamCommandKind,
  actions: CamCommandActions
): (ctx: CommandContext) => void {
  switch (kind) {
    case 'setup':
      return () => actions.openSetup()
    case 'multi_setup':
      return () => actions.openMultiSetup()
    case '2d_op':
    case '3d_op':
    case 'rotary_op': {
      const opKind = CAM_COMMAND_OP_KIND[id]
      return () => actions.newOperation(opKind)
    }
    case 'probing':
      return () => actions.openProbing()
    case 'simulate':
      return () => actions.openSimulate()
    case 'send':
      return () => actions.openSend()
    case 'tool_library':
      return () => actions.openToolLibrary()
    default: {
      const _never: never = kind
      void _never
      return () => {}
    }
  }
}

/**
 * Build (but do not register) the Manufacture ribbon handler list from the host
 * actions. Exported so tests can assert the handler set + dispatch behavior
 * without mutating a shared registry (mirrors `buildDesignCommands`).
 *
 * Every id from {@link camCommandIds} gets exactly one handler, with a `run`
 * that calls the matching action and an `enabled` gated per kind.
 */
export function buildCamCommands(actions: CamCommandActions): CommandHandler[] {
  const handlers: CommandHandler[] = []
  for (const id of camCommandIds()) {
    const kind = classifyCamCommand(id)
    if (kind === null) continue
    handlers.push({
      id,
      run: runForKind(id, kind, actions),
      enabled: (ctx: CommandContext) => camCommandEnabled(kind, ctx)
    })
  }
  return handlers
}

/**
 * Register the Manufacture ribbon handlers on a registry (defaults to the shared
 * one). Returns a disposer that unregisters every handler this call added — call
 * it from a React effect cleanup so re-mounts don't double-register (mirrors
 * `registerDesignCommands`).
 */
export function registerCamCommands(
  actions: CamCommandActions,
  registry: CommandRegistry = commandRegistry
): () => void {
  const disposers = buildCamCommands(actions).map((h) => registry.register(h))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
