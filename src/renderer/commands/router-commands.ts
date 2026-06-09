/**
 * Wave-3d (Laguna router) · Manufacture-ribbon command handlers (2.5D wood loop).
 *
 * The Wave-1 Context Engine ({@link command-engine}) gave us a registry every
 * surface (ribbon, palette, marking menu) dispatches through. {@link
 * design-commands} wired the *Design* ribbon, {@link cam-commands} wired the
 * subtractive *Manufacture* ribbon (Setup / 2D / 3D / Rotary / Probing /
 * Simulate / Send for the Carvera 4-axis mill + the shared Laguna/Carvera 2D
 * rows), and {@link fdm-commands} wired the Creality K2 slicer loop. This module
 * is the **Laguna router mirror**: it registers the **VCarve / 2.5D ribbon**
 * (tool-catalog §2.3) — the bridge between a catalog `command.id` and the
 * Laguna-specific Vectors / 2D Toolpaths / V-Carve / Nesting / Simulate / Send
 * surfaces of the Manufacture workspace.
 *
 * It mirrors `cam-commands.ts` / `fdm-commands.ts` exactly:
 *   - a pure factory ({@link buildRouterCommands}) that turns a host-action bag
 *     into {@link CommandHandler}s, plus
 *   - a register wrapper ({@link registerRouterCommands}) that mounts them on a
 *     registry (defaults to the shared {@link commandRegistry}) and returns a
 *     disposer.
 * It is intentionally **pure** (no React, no DOM, no `window`) so it unit-tests
 * in the `node` vitest env, exactly like the engine + Design + CAM + FDM
 * handlers it sits beside.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * G-CODE SAFETY (read this before changing anything here)
 * ──────────────────────────────────────────────────────────────────────────
 * These handlers do **not** generate, mutate, or post any toolpath — they only
 * *open* the relevant authoring surface (the DXF vector importer, an op editor
 * seeded with an op kind, the nesting panel, the simulator, the Send/post
 * panel). The actual Laguna 2.5D toolpath generation + the `vcarve_mach3.hbs`
 * post contract live downstream in `src/main/cam-local.ts` →
 * `src/main/cam-runner-2d.ts` → `resources/posts/vcarve_mach3.hbs` and are
 * untouched by this seam. In particular the RichAuto/Mach3 invariants that make
 * Laguna output safe — `%` tape markers, `G21/G90/G17/G94`, `M3`-only spindle
 * with a `G4 P2` warm-up, `M5` + `G4 P3` cool-down before the safe-Z retract,
 * dust-collection `M7`/`M9` gated on the `dustCollection` flag, the pre-cut
 * safe-Z lift, and the **`M30`** program terminator (NOT Carvera's `M2`) — are
 * all enforced by the post template + its contract tests
 * (`post-process-laguna-*.test.ts`), none of which this module can reach. The V
 * -carve depth cap to stock thickness / Z envelope likewise lives in the
 * toolpath engine, not here. This seam emits no G-code, so it cannot weaken any
 * of those guards.
 *
 * The honesty contract lives in the {@link RouterCommandActions} bag: a command
 * with no real host action wired is still registered (so it is discoverable +
 * greyed honestly per `enabled`) but its `run` calls the (possibly no-op)
 * action — no pretend behavior here.
 *
 * Enablement (`enabled(ctx)`) gates honestly by context: **every** router
 * command requires both the Manufacture route (`ctx.workspace ===
 * 'manufacture'`) AND the Laguna router (`ctx.machineKind === 'router'`). This
 * is the load-bearing safety gate — the symmetric counterpart to
 * `cam-commands`'s rotary/subtractive gating and `fdm-commands`'s FDM-only gate
 * — and it keeps the wood-routing loop off the Carvera mill and the K2 FDM
 * printer entirely (just as the rotary ops are kept off the router and the
 * slicer loop is kept off both CNC machines). The router-only gate is
 * deliberately *stricter* than `cam-commands`'s shared `2d_op` gate (which
 * allows router OR mill): these `ro_*` ids are the Laguna-flavored VCarve ribbon
 * rows (DXF import, V-carve, true-shape nesting) that are meaningful only with
 * the router active, so they never light up on the Carvera.
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
 * The callbacks the Laguna router ribbon handlers dispatch into. Supplied once
 * by the Manufacture workspace host (the *Wire* phase — `ManufactureWorkspace` /
 * `ManufactureHost` is **not** edited here; a follow-up host adopts this bag
 * exactly as `ManufactureHost` adopted {@link CamCommandActions}). Every method
 * is intentionally `void`-returning and side-effecting — the engine's `run(ctx)`
 * is fire-and-forget; the host owns the actual state transition + re-render.
 *
 * The seam is deliberately small (mirrors `CamCommandActions` /
 * `FdmCommandActions`): the handlers classify a catalog/synthetic id into a
 * behavioral kind and route it here; the host decides what each entry point
 * means (which importer/panel/stage to open, and — for the op-seeding entries —
 * which op editor to seed for the given op `kind`).
 *
 * SAFETY: none of these actions emit G-code or post a toolpath. `opVcarve`
 * opens the V-carve op editor; the medial-axis depth solve + the cap to stock
 * thickness happen in the downstream toolpath engine, behind which the
 * `vcarve_mach3.hbs` RichAuto/Mach3 invariants still run at post time.
 */
export interface RouterCommandActions {
  // —— Vectors (import the most common real-world Laguna input) ——
  /** Open the "Import Vectors (DXF)" surface and land entities into the sketch. */
  readonly importVectorsDxf: () => void
  // —— 2D Toolpaths ——
  /** Begin a new 2D **Profile / Contour** op (on / inside / outside, leads, tabs). */
  readonly opProfile: () => void
  /** Begin a new 2D **Pocket** op (area clearance, ramp, finish pass). */
  readonly opPocket: () => void
  // —— V-Carve (the headline Laguna gap; new `cnc_vcarve`) ——
  /** Begin a new **V-Carve** op (medial-axis variable-depth, depth-from-width). */
  readonly opVcarve: () => void
  // —— Drilling ——
  /** Begin a new **Drill** op (peck / dwell canned cycles at vector points). */
  readonly opDrill: () => void
  // —— Nesting ——
  /** Open the true-shape **Nesting** panel (sheet layout + apply placements). */
  readonly nest: () => void
  // —— Simulate ——
  /** Open the toolpath **Simulation** / verification surface. */
  readonly simulate: () => void
  // —— Send ——
  /** Open the **Send** / post-to-machine surface (`vcarve_mach3.hbs`, export .nc). */
  readonly post: () => void
}

// ── Command classification ───────────────────────────────────────────────────

/**
 * The behavioral classes a Laguna-router-ribbon command falls into. Drives which
 * host action a handler calls. Exported so the unit test can assert the
 * classification of every id without re-deriving the mapping. The classes map
 * onto the Laguna ribbon tab groups in tool-catalog §2.3 (Vectors · 2D Toolpaths
 * · V-Carve · Nesting · Simulate · Send), with each op-seeding kind kept
 * distinct so the host seeds the right op editor.
 */
export type RouterCommandKind =
  /** Import DXF vectors onto the sketch (`ro_import_dxf`). Vectors group. */
  | 'import_dxf'
  /** Seed a new 2D **Profile / Contour** op (`ro_op_profile`). 2D Toolpaths. */
  | 'profile_op'
  /** Seed a new 2D **Pocket** op (`ro_op_pocket`). 2D Toolpaths. */
  | 'pocket_op'
  /** Seed a new **V-Carve** op (`ro_op_vcarve`). V-Carve group. */
  | 'vcarve_op'
  /** Seed a new **Drill** op (`ro_op_drill`). 2D Toolpaths. */
  | 'drill_op'
  /** Open the **Nesting** panel (`ro_nest`). Nesting group. */
  | 'nest'
  /** Open the **Simulation** surface (`router_simulate`). Simulate group. */
  | 'simulate'
  /** Open the **Send** / post surface (`router_post`). Send group. */
  | 'post'

// —— Catalog router command ids (live FUSION_STYLE_COMMAND_CATALOG rows) ——
// These six DO ship as catalog rows (added in the manufacture ribbon group,
// router-gated) so the contextual ribbon + the 152-entry palette discover them.

/** Catalog id for "Import Vectors (DXF)" (Vectors → Import). */
export const ROUTER_IMPORT_DXF_COMMAND_ID = 'ro_import_dxf'
/** Catalog id for the 2D Profile / Contour op (2D Toolpaths). */
export const ROUTER_OP_PROFILE_COMMAND_ID = 'ro_op_profile'
/** Catalog id for the 2D Pocket op (2D Toolpaths). */
export const ROUTER_OP_POCKET_COMMAND_ID = 'ro_op_pocket'
/** Catalog id for the V-Carve op (V-Carve). */
export const ROUTER_OP_VCARVE_COMMAND_ID = 'ro_op_vcarve'
/** Catalog id for the Drill op (2D Toolpaths). */
export const ROUTER_OP_DRILL_COMMAND_ID = 'ro_op_drill'
/** Catalog id for the true-shape Nesting panel (Nesting). */
export const ROUTER_NEST_COMMAND_ID = 'ro_nest'

// —— Synthetic router command ids (no catalog row yet — dispatched directly) ——
// Simulate + Send have catalog-agnostic surfaces shared with the rest of the
// Manufacture workspace; they are predeclared here exactly as `cam-commands`
// predeclares the Carvera `mf_op_4axis_*` / probing / send ids and `fdm-commands`
// predeclares the `fdm_*` ids. A handler must exist for them so the workspace can
// dispatch the Laguna Simulate / Send actions by id today. See {@link
// routerCommandIds}.

/** Synthetic id for the Laguna toolpath Simulation surface (Simulate group). */
export const ROUTER_SIMULATE_COMMAND_ID = 'router_simulate'
/** Synthetic id for the Laguna Send / post-to-machine surface (Send group). */
export const ROUTER_POST_COMMAND_ID = 'router_post'

/**
 * Catalog id → runtime CAM op kind, for the op-seeding router commands
 * (`profile_op` / `pocket_op` / `vcarve_op` / `drill_op`). The `ro_op_*` ids are
 * UI labels; the host needs the concrete `cnc_*` op `kind` (the
 * `ManufactureOperation['kind']` union in `manufacture-schema.ts`) to open the
 * matching op editor. Kept as one explicit table so the mapping is auditable and
 * the test can pin it — there is no clever derivation that could silently route
 * an op to the wrong topology.
 *
 * Note `ro_op_vcarve` maps to the **new `cnc_vcarve`** op kind (the medial-axis
 * variable-depth carve — the headline Laguna gap), NOT to `cnc_chamfer` (a
 * single-offset fixed-depth bevel). Routing the V-carve ribbon row to
 * `cnc_chamfer` is exactly the bug the VCarve gap audit flagged
 * (`docs/plans/catalog/vcarve-laguna.md`); this table keeps them distinct.
 */
export const ROUTER_COMMAND_OP_KIND: Readonly<Record<string, string>> = {
  [ROUTER_OP_PROFILE_COMMAND_ID]: 'cnc_contour',
  [ROUTER_OP_POCKET_COMMAND_ID]: 'cnc_pocket',
  [ROUTER_OP_VCARVE_COMMAND_ID]: 'cnc_vcarve',
  [ROUTER_OP_DRILL_COMMAND_ID]: 'cnc_drill'
}

/**
 * The synthetic / non-op router ids → {@link RouterCommandKind} table for the
 * ids that do not seed an op. Kept as one explicit map so the classifier is
 * total over them without a brittle prefix guess, and so the test can pin the
 * mapping.
 *   - `ro_import_dxf` / `ro_nest` are **catalog rows** but open a non-op surface.
 *   - `router_simulate` / `router_post` are **synthetic** (no catalog row) — the
 *     forward-looking Simulate / Send entry points.
 */
const ROUTER_NON_OP_COMMAND_KIND: Readonly<Record<string, RouterCommandKind>> = {
  [ROUTER_IMPORT_DXF_COMMAND_ID]: 'import_dxf',
  [ROUTER_NEST_COMMAND_ID]: 'nest',
  [ROUTER_SIMULATE_COMMAND_ID]: 'simulate',
  [ROUTER_POST_COMMAND_ID]: 'post'
}

/**
 * Classify an id into its {@link RouterCommandKind}, or `null` when the id is not
 * a router-ribbon command this module owns. Pure + total over the ids this
 * module registers — the single source of truth shared by {@link
 * routerCommandIds} and {@link buildRouterCommands} so they always agree.
 *
 * Order: the op-seeding `ro_op_*` ids (via {@link ROUTER_COMMAND_OP_KIND}) are
 * matched first, then the non-op `ro_*` / `router_*` table. There is no overlap
 * between the two maps, so the order only documents intent. A CAM-owned id (e.g.
 * `mf_op_2d_pocket`, `mf_simulate`) and every FDM/Design id is in neither map and
 * returns `null` — so router-commands never double-claims an id another module
 * already owns.
 */
export function classifyRouterCommand(id: string): RouterCommandKind | null {
  if (id in ROUTER_COMMAND_OP_KIND) {
    if (id === ROUTER_OP_PROFILE_COMMAND_ID) return 'profile_op'
    if (id === ROUTER_OP_POCKET_COMMAND_ID) return 'pocket_op'
    if (id === ROUTER_OP_VCARVE_COMMAND_ID) return 'vcarve_op'
    if (id === ROUTER_OP_DRILL_COMMAND_ID) return 'drill_op'
  }
  const nonOp = ROUTER_NON_OP_COMMAND_KIND[id]
  if (nonOp !== undefined) return nonOp
  return null
}

/**
 * The full set of ids this module registers handlers for: every catalog `ro_*`
 * row plus the two forward-looking synthetic `router_*` ids.
 *
 * The synthetic ids are deliberately included even though they have **no**
 * `FUSION_STYLE_COMMAND_CATALOG` entry — exactly like `cam-commands` includes the
 * Carvera `mf_op_4axis_*` ids and `fdm-commands` includes the `fdm_*` ids. They
 * are the Laguna Simulate / Send entry points; a handler must exist for them so
 * the workspace can dispatch by id today. See the honest gap note in the
 * module-level docs.
 */
export function routerCommandIds(): string[] {
  const ids = new Set<string>()
  // 1) Forward-looking synthetic router ids with no catalog row, dispatched
  //    directly (Simulate / Send), plus the catalog-row non-op ids.
  for (const id of Object.keys(ROUTER_NON_OP_COMMAND_KIND)) ids.add(id)
  // 2) The op-seeding `ro_op_*` catalog rows.
  for (const id of Object.keys(ROUTER_COMMAND_OP_KIND)) ids.add(id)
  // 3) Re-confirm against the live catalog: every router-classifiable
  //    manufacture-workspace row is included (defends against a catalog row that
  //    classifies but was somehow missed by the explicit maps above).
  for (const command of FUSION_STYLE_COMMAND_CATALOG) {
    if (command.workspace !== 'manufacture') continue
    if (classifyRouterCommand(command.id) !== null) ids.add(command.id)
  }
  return [...ids]
}

// ── Enablement predicates ────────────────────────────────────────────────────

/** True when the shell is on the Manufacture route. */
function isManufactureRoute(ctx: CommandContext): boolean {
  return ctx.workspace === 'manufacture'
}

/** True when the active machine is the Laguna router (the only 2.5D wood target). */
function isRouterMachine(kind: MachineKind | null): boolean {
  return kind === 'router'
}

/**
 * The `enabled(ctx)` predicate for a router command kind. Pure + exported so the
 * test can assert the gating without constructing handlers.
 *
 * **Every** router command requires the Manufacture route AND the Laguna router
 * (`ctx.machineKind === 'router'`). There is no kind-specific relaxation: the
 * entire VCarve loop (DXF import / 2D toolpaths / V-carve / nesting / simulate /
 * send) is the Laguna-flavored ribbon, and the router-only gate is the
 * load-bearing safety boundary that keeps these commands off the Carvera mill and
 * the K2 FDM printer (and absent when no machine is selected). The `kind`
 * parameter is accepted for symmetry with `camCommandEnabled` /
 * `fdmCommandEnabled` and to keep the door open for a future per-kind relaxation,
 * but is exhaustively switched so an added kind cannot silently fall through.
 */
export function routerCommandEnabled(kind: RouterCommandKind, ctx: CommandContext): boolean {
  if (!isManufactureRoute(ctx)) return false
  switch (kind) {
    case 'import_dxf':
    case 'profile_op':
    case 'pocket_op':
    case 'vcarve_op':
    case 'drill_op':
    case 'nest':
    case 'simulate':
    case 'post':
      return isRouterMachine(ctx.machineKind)
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
 * Every branch dispatches exactly one {@link RouterCommandActions} method; none
 * emit G-code or post a toolpath (see the module-level G-CODE SAFETY note). The
 * op-seeding kinds (`profile_op` / `pocket_op` / `vcarve_op` / `drill_op`) call
 * the matching op action; the host seeds the op editor with the corresponding
 * {@link ROUTER_COMMAND_OP_KIND} runtime kind.
 */
function runForKind(kind: RouterCommandKind, actions: RouterCommandActions): (ctx: CommandContext) => void {
  switch (kind) {
    case 'import_dxf':
      return () => actions.importVectorsDxf()
    case 'profile_op':
      return () => actions.opProfile()
    case 'pocket_op':
      return () => actions.opPocket()
    case 'vcarve_op':
      return () => actions.opVcarve()
    case 'drill_op':
      return () => actions.opDrill()
    case 'nest':
      return () => actions.nest()
    case 'simulate':
      return () => actions.simulate()
    case 'post':
      return () => actions.post()
    default: {
      const _never: never = kind
      void _never
      return () => {}
    }
  }
}

/**
 * Build (but do not register) the Laguna router ribbon handler list from the host
 * actions. Exported so tests can assert the handler set + dispatch behavior
 * without mutating a shared registry (mirrors `buildCamCommands` /
 * `buildFdmCommands`).
 *
 * Every id from {@link routerCommandIds} gets exactly one handler, with a `run`
 * that calls the matching action and an `enabled` gated per kind (Manufacture
 * route + router).
 */
export function buildRouterCommands(actions: RouterCommandActions): CommandHandler[] {
  const handlers: CommandHandler[] = []
  for (const id of routerCommandIds()) {
    const kind = classifyRouterCommand(id)
    if (kind === null) continue
    handlers.push({
      id,
      run: runForKind(kind, actions),
      enabled: (ctx: CommandContext) => routerCommandEnabled(kind, ctx)
    })
  }
  return handlers
}

/**
 * Register the Laguna router ribbon handlers on a registry (defaults to the
 * shared one). Returns a disposer that unregisters every handler this call added
 * — call it from a React effect cleanup so re-mounts don't double-register
 * (mirrors `registerCamCommands` / `registerFdmCommands`).
 */
export function registerRouterCommands(
  actions: RouterCommandActions,
  registry: CommandRegistry = commandRegistry
): () => void {
  const disposers = buildRouterCommands(actions).map((h) => registry.register(h))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
