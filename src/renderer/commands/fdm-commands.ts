/**
 * Wave-3b (K2-Plus FDM) · Manufacture-ribbon command handlers (slicer loop).
 *
 * The Wave-1 Context Engine ({@link command-engine}) gave us a registry every
 * surface (ribbon, palette, marking menu) dispatches through. {@link
 * design-commands} wired the *Design* ribbon and {@link cam-commands} wired the
 * subtractive *Manufacture* ribbon (Setup / 2D / 3D / Rotary / Probing /
 * Simulate / Send for the Laguna router + Carvera 4-axis mill). This module is
 * the **FDM mirror** of `cam-commands`: it registers the **Creality K2 Plus
 * slicer ribbon** — the bridge between a catalog `command.id` and the FDM
 * Prepare / Arrange / Supports / Process / Preview / Device surfaces of the
 * Manufacture workspace (tool-catalog §2.2).
 *
 * It mirrors `cam-commands.ts` exactly:
 *   - a pure factory ({@link buildFdmCommands}) that turns a host-action bag into
 *     {@link CommandHandler}s, plus
 *   - a register wrapper ({@link registerFdmCommands}) that mounts them on a
 *     registry (defaults to the shared {@link commandRegistry}) and returns a
 *     disposer.
 * It is intentionally **pure** (no React, no DOM, no `window`) so it unit-tests
 * in the `node` vitest env, exactly like the engine + Design + CAM handlers it
 * sits beside.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * G-CODE SAFETY (read this before changing anything here)
 * ──────────────────────────────────────────────────────────────────────────
 * These handlers do **not** slice, generate, mutate, or upload any G-code — they
 * only *open* the relevant slicer surface (the Prepare transform tools, the
 * Arrange/auto-orient actions, the Supports / Process editors, the Preview
 * viewport, the Device panel) or *request* a slice/job action the host performs
 * downstream. In particular:
 *   - **Temperature ceilings are NOT this module's concern and are never set
 *     here.** The K2 Plus firmware ceilings (nozzle ≤ 350 °C, bed ≤ 120 °C) are
 *     enforced by the pre-upload validator (`src/shared/gcode-temp-validator.ts`
 *     `validateGcodeFileTemps`), which `src/main/moonraker-push.ts` runs BEFORE
 *     the multipart upload crosses the network. This module adds no path that
 *     bypasses, weakens, or front-runs that gate.
 *   - **Real heater commands stay real.** `slicePlate` / `sliceAll` route to the
 *     host's existing OrcaSlicer slice path (which emits genuine `M104`/`M140`
 *     etc. — never comment-encoded pseudo-commands); this module emits no G-code
 *     of its own, so it cannot down-grade a real `M104` into a comment.
 *   - The actual slice + Moonraker push (and the temperature gate in front of
 *     it) live in `orca-wrapper.ts` / `moonraker-push.ts` and are untouched.
 * The honesty contract lives in the {@link FdmCommandActions} bag: a command with
 * no real host action wired is still registered (so it is discoverable + greyed
 * honestly per `enabled`) but its `run` calls the (possibly no-op) action — no
 * pretend behavior here.
 *
 * Enablement (`enabled(ctx)`) gates honestly by context: **every** FDM command
 * requires both the Manufacture route (`ctx.workspace === 'manufacture'`) AND the
 * FDM printer (`ctx.machineKind === 'fdm'`). This is the load-bearing safety gate
 * — the symmetric counterpart to `cam-commands`'s subtractive/rotary gating — and
 * it keeps the slicer loop off the Laguna router and the Carvera mill entirely
 * (just as those machines' milling/rotary ops are kept off the K2).
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
 * The callbacks the FDM slicer ribbon handlers dispatch into. Supplied once by
 * the Manufacture workspace host (the *Integrate* phase — `ManufactureWorkspace`
 * is **not** edited here; a follow-up host adopts this bag exactly as
 * `ManufactureHost` adopted {@link CamCommandActions}). Every method is
 * intentionally `void`-returning and side-effecting — the engine's `run(ctx)` is
 * fire-and-forget; the host owns the actual state transition + re-render.
 *
 * The seam is deliberately small (mirrors `CamCommandActions`): the handlers
 * classify a catalog/synthetic id into a behavioral kind and route it here; the
 * host decides what each entry point means (which Prepare tool to arm, which
 * editor/panel/stage to open, which slice or job-control IPC to fire).
 *
 * SAFETY: none of these actions emit G-code or set heater targets. `slicePlate`
 * / `sliceAll` defer to the host's proven OrcaSlicer path, behind which the
 * pre-upload temperature-ceiling gate still runs at send time; the job-control
 * actions (`jobPause` / `jobResume` / `jobCancel`) call the existing
 * `moonraker:pause|resume|cancel` IPC, which moves no temperature targets.
 */
export interface FdmCommandActions {
  // —— Prepare (import + per-object transform) ——
  /** Import a model (STL/OBJ/3MF/STEP) onto the active plate. */
  readonly importModel: () => void
  // —— Arrange ——
  /** Auto-arrange (nest) every object on the active plate with spacing. */
  readonly arrange: () => void
  /** Auto-orient the selected/active object (overhang/area-minimizing). */
  readonly autoOrient: () => void
  // —— Supports ——
  /** Open the Supports editor (enable + type / placement / threshold / paint). */
  readonly openSupports: () => void
  // —— Process ——
  /** Open the Process editor (quality / layer height / walls / infill / speeds). */
  readonly openProcess: () => void
  // —— Preview ——
  /** Open the layer/toolpath Preview surface. */
  readonly openPreview: () => void
  // —— Device ——
  /** Open the Device panel (send / status / job controls / calibration). */
  readonly openDevice: () => void
  // —— Slice (split-button: this plate vs all plates) ——
  /** Slice the active plate via the host OrcaSlicer path. */
  readonly slicePlate: () => void
  /** Slice every plate via the host OrcaSlicer path. */
  readonly sliceAll: () => void
  // —— Live job controls (Moonraker / Klipper) ——
  /** Pause the running print (`moonraker:pause`). */
  readonly jobPause: () => void
  /** Resume the paused print (`moonraker:resume`). */
  readonly jobResume: () => void
  /** Cancel the running print (`moonraker:cancel`). */
  readonly jobCancel: () => void
}

// ── Command classification ───────────────────────────────────────────────────

/**
 * The behavioral classes an FDM-ribbon command falls into. Drives which host
 * action a handler calls. Exported so the unit test can assert the
 * classification of every id without re-deriving the mapping. The classes map
 * 1:1 onto the FDM ribbon tab groups in tool-catalog §2.2 (Prepare · Arrange ·
 * Supports · Process · Preview · Device), with the slice + job-control actions
 * split out so each gets its own honest handler.
 */
export type FdmCommandKind =
  /** Import a model onto the plate (`fdm_import`). Prepare group. */
  | 'import'
  /** Auto-arrange the plate (`fdm_arrange`). Arrange group. */
  | 'arrange'
  /** Auto-orient the object (`fdm_orient`). Arrange group. */
  | 'orient'
  /** Open the Supports editor (`fdm_supports`). Supports group. */
  | 'supports'
  /** Open the Process editor (`fdm_process`). Process group. */
  | 'process'
  /** Open the Preview surface (`fdm_preview`). Preview group. */
  | 'preview'
  /** Open the Device panel (`fdm_device`). Device group. */
  | 'device'
  /** Slice the active plate (`fdm_slice_plate`, `ut_slice`, `mf_additive`). */
  | 'slice_plate'
  /** Slice every plate (`fdm_slice_all`). */
  | 'slice_all'
  /** Pause the running print (`fdm_job_pause`). Device group. */
  | 'job_pause'
  /** Resume the paused print (`fdm_job_resume`). Device group. */
  | 'job_resume'
  /** Cancel the running print (`fdm_job_cancel`). Device group. */
  | 'job_cancel'

// —— Synthetic FDM command ids (no catalog row yet — dispatched directly) ——
// These are the Wave-3b K2 entry points. They are deliberately NOT in
// FUSION_STYLE_COMMAND_CATALOG yet (the FDM ribbon rows land with the plate-edit
// build), exactly as `cam-commands` predeclares the Carvera `mf_op_4axis_*` /
// multi-setup / probing / send ids. A handler must exist for them so the
// Manufacture workspace can dispatch by id today. See {@link fdmCommandIds}.

/** Catalog id for "import model onto plate" (Prepare → Import). */
export const FDM_IMPORT_COMMAND_ID = 'fdm_import'
/** Catalog id for "auto-arrange plate" (Arrange). */
export const FDM_ARRANGE_COMMAND_ID = 'fdm_arrange'
/** Catalog id for "auto-orient object" (Arrange). */
export const FDM_ORIENT_COMMAND_ID = 'fdm_orient'
/** Catalog id for the Supports editor (Supports). */
export const FDM_SUPPORTS_COMMAND_ID = 'fdm_supports'
/** Catalog id for the Process editor (Process). */
export const FDM_PROCESS_COMMAND_ID = 'fdm_process'
/** Catalog id for the Preview surface (Preview). */
export const FDM_PREVIEW_COMMAND_ID = 'fdm_preview'
/** Catalog id for the Device panel (Device). */
export const FDM_DEVICE_COMMAND_ID = 'fdm_device'
/** Catalog id for "slice this plate" (Device / plate split-button primary). */
export const FDM_SLICE_PLATE_COMMAND_ID = 'fdm_slice_plate'
/** Catalog id for "slice all plates" (plate split-button dropdown). */
export const FDM_SLICE_ALL_COMMAND_ID = 'fdm_slice_all'
/** Catalog id for "pause print" (Device job controls). */
export const FDM_JOB_PAUSE_COMMAND_ID = 'fdm_job_pause'
/** Catalog id for "resume print" (Device job controls). */
export const FDM_JOB_RESUME_COMMAND_ID = 'fdm_job_resume'
/** Catalog id for "cancel print" (Device job controls). */
export const FDM_JOB_CANCEL_COMMAND_ID = 'fdm_job_cancel'

/**
 * The synthetic id → {@link FdmCommandKind} table for every forward-looking FDM
 * id that has no catalog row yet. Kept as one explicit map so the classifier is
 * total over them without a brittle prefix guess, and so the test can pin the
 * mapping. Order in {@link classifyFdmCommand} matches catalog ids first, then
 * this table.
 */
const FDM_SYNTHETIC_COMMAND_KIND: Readonly<Record<string, FdmCommandKind>> = {
  [FDM_IMPORT_COMMAND_ID]: 'import',
  [FDM_ARRANGE_COMMAND_ID]: 'arrange',
  [FDM_ORIENT_COMMAND_ID]: 'orient',
  [FDM_SUPPORTS_COMMAND_ID]: 'supports',
  [FDM_PROCESS_COMMAND_ID]: 'process',
  [FDM_PREVIEW_COMMAND_ID]: 'preview',
  [FDM_DEVICE_COMMAND_ID]: 'device',
  [FDM_SLICE_PLATE_COMMAND_ID]: 'slice_plate',
  [FDM_SLICE_ALL_COMMAND_ID]: 'slice_all',
  [FDM_JOB_PAUSE_COMMAND_ID]: 'job_pause',
  [FDM_JOB_RESUME_COMMAND_ID]: 'job_resume',
  [FDM_JOB_CANCEL_COMMAND_ID]: 'job_cancel'
}

/**
 * Existing FDM-flavored catalog rows this module owns. Both are
 * `manufacture`-workspace FDM/slice rows in `FUSION_STYLE_COMMAND_CATALOG`
 * (`ut_slice` "Slice (FDM)" + `mf_additive` "Additive / FDM"); they route to the
 * **slice-this-plate** behavior so the live catalog Slice rows dispatch through
 * this module's K2 slice path (behind which the pre-upload temperature gate still
 * runs). The CAM-owned `manufacture` rows (`mf_setup`, `mf_op_*`, `mf_simulate`,
 * `ut_cam`, `ut_tools`) are intentionally NOT claimed here — `cam-commands` owns
 * them, so this set is the only place an FDM-route catalog row is adopted and the
 * two modules never both register the same id.
 */
const SLICE_CATALOG_COMMAND_IDS: ReadonlySet<string> = new Set(['ut_slice', 'mf_additive'])

/**
 * Classify an id into its {@link FdmCommandKind}, or `null` when the id is not an
 * FDM-ribbon command this module owns. Pure + total over the ids this module
 * registers — the single source of truth shared by {@link fdmCommandIds} and
 * {@link buildFdmCommands} so they always agree.
 *
 * Order: the FDM-flavored catalog rows (`ut_slice` / `mf_additive` → slice) are
 * matched first, then the synthetic `fdm_*` table. There is no overlap between
 * the two, so the order only documents intent; a `cam-commands`-owned id (e.g.
 * `mf_op_2d_pocket`, `mf_simulate`) is in neither set and returns `null`.
 */
export function classifyFdmCommand(id: string): FdmCommandKind | null {
  if (SLICE_CATALOG_COMMAND_IDS.has(id)) return 'slice_plate'
  const synthetic = FDM_SYNTHETIC_COMMAND_KIND[id]
  if (synthetic !== undefined) return synthetic
  return null
}

/**
 * The full set of ids this module registers handlers for: every forward-looking
 * synthetic `fdm_*` id, plus the FDM-flavored catalog rows (`ut_slice` /
 * `mf_additive`).
 *
 * The synthetic ids are deliberately included even though they have **no**
 * `FUSION_STYLE_COMMAND_CATALOG` entry — exactly like `cam-commands` includes the
 * Carvera `mf_op_4axis_*` ids. They are the Wave-3b K2 entry points; a handler
 * must exist for them so the workspace can dispatch by id today. See the honest
 * gap note in the module-level docs.
 */
export function fdmCommandIds(): string[] {
  const ids = new Set<string>()
  // 1) Forward-looking synthetic FDM ids with no catalog row, dispatched directly.
  for (const id of Object.keys(FDM_SYNTHETIC_COMMAND_KIND)) ids.add(id)
  // 2) Every FDM-flavored manufacture-workspace catalog row this module claims.
  for (const command of FUSION_STYLE_COMMAND_CATALOG) {
    if (command.workspace !== 'manufacture') continue
    if (SLICE_CATALOG_COMMAND_IDS.has(command.id)) ids.add(command.id)
  }
  return [...ids]
}

// ── Enablement predicates ────────────────────────────────────────────────────

/** True when the shell is on the Manufacture route. */
function isManufactureRoute(ctx: CommandContext): boolean {
  return ctx.workspace === 'manufacture'
}

/** True when the active machine is the FDM printer (the only slicer target). */
function isFdmMachine(kind: MachineKind | null): boolean {
  return kind === 'fdm'
}

/**
 * The `enabled(ctx)` predicate for an FDM command kind. Pure + exported so the
 * test can assert the gating without constructing handlers.
 *
 * **Every** FDM command requires the Manufacture route AND the FDM printer
 * (`ctx.machineKind === 'fdm'`). There is no kind-specific relaxation: the entire
 * slicer loop (Prepare / Arrange / Supports / Process / Preview / Device / slice
 * / job-controls) is meaningless without the K2 active, and the FDM-only gate is
 * the load-bearing safety boundary that keeps these commands off the Laguna
 * router and the Carvera mill (and absent when no machine is selected). The
 * `kind` parameter is accepted for symmetry with `camCommandEnabled` and to keep
 * the door open for a future per-kind relaxation, but is exhaustively switched so
 * an added kind cannot silently fall through.
 */
export function fdmCommandEnabled(kind: FdmCommandKind, ctx: CommandContext): boolean {
  if (!isManufactureRoute(ctx)) return false
  switch (kind) {
    case 'import':
    case 'arrange':
    case 'orient':
    case 'supports':
    case 'process':
    case 'preview':
    case 'device':
    case 'slice_plate':
    case 'slice_all':
    case 'job_pause':
    case 'job_resume':
    case 'job_cancel':
      return isFdmMachine(ctx.machineKind)
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
 * Every branch dispatches exactly one {@link FdmCommandActions} method; none emit
 * G-code or set heater targets (see the module-level G-CODE SAFETY note).
 */
function runForKind(kind: FdmCommandKind, actions: FdmCommandActions): (ctx: CommandContext) => void {
  switch (kind) {
    case 'import':
      return () => actions.importModel()
    case 'arrange':
      return () => actions.arrange()
    case 'orient':
      return () => actions.autoOrient()
    case 'supports':
      return () => actions.openSupports()
    case 'process':
      return () => actions.openProcess()
    case 'preview':
      return () => actions.openPreview()
    case 'device':
      return () => actions.openDevice()
    case 'slice_plate':
      return () => actions.slicePlate()
    case 'slice_all':
      return () => actions.sliceAll()
    case 'job_pause':
      return () => actions.jobPause()
    case 'job_resume':
      return () => actions.jobResume()
    case 'job_cancel':
      return () => actions.jobCancel()
    default: {
      const _never: never = kind
      void _never
      return () => {}
    }
  }
}

/**
 * Build (but do not register) the FDM slicer ribbon handler list from the host
 * actions. Exported so tests can assert the handler set + dispatch behavior
 * without mutating a shared registry (mirrors `buildCamCommands`).
 *
 * Every id from {@link fdmCommandIds} gets exactly one handler, with a `run` that
 * calls the matching action and an `enabled` gated per kind (FDM route + printer).
 */
export function buildFdmCommands(actions: FdmCommandActions): CommandHandler[] {
  const handlers: CommandHandler[] = []
  for (const id of fdmCommandIds()) {
    const kind = classifyFdmCommand(id)
    if (kind === null) continue
    handlers.push({
      id,
      run: runForKind(kind, actions),
      enabled: (ctx: CommandContext) => fdmCommandEnabled(kind, ctx)
    })
  }
  return handlers
}

/**
 * Register the FDM slicer ribbon handlers on a registry (defaults to the shared
 * one). Returns a disposer that unregisters every handler this call added — call
 * it from a React effect cleanup so re-mounts don't double-register (mirrors
 * `registerCamCommands`).
 */
export function registerFdmCommands(
  actions: FdmCommandActions,
  registry: CommandRegistry = commandRegistry
): () => void {
  const disposers = buildFdmCommands(actions).map((h) => registry.register(h))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
