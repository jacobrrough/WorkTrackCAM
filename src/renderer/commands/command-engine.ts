/**
 * FG-1 · Context Engine command registry (the keystone).
 *
 * `FUSION_STYLE_COMMAND_CATALOG` (152 entries) is **metadata only** — it has a
 * `label`, a `ribbon` group, a `workspace`, and a parity `status`, but no way to
 * actually *run* anything and no way to know whether a command is *applicable*
 * to the operator's current context. Nothing in the shell dispatches by
 * `command.id`: the live palette hand-lists ~17 actions, the ribbon does not
 * exist yet, and `CommandCatalogPanel` rows just print a status string.
 *
 * This module is the dispatch backbone every future surface (ribbon, palette,
 * marking menu, per-tool hotkeys) shares. It is intentionally **pure** — no
 * React, no DOM, no `window` — so it unit-tests in the existing `node` vitest
 * environment (same tenet as `selection-state.ts`). The React layer that feeds
 * it the live context lives in `CommandContextProvider.tsx`; the concrete
 * starter handlers live in `starter-commands.ts`.
 *
 * Three concepts:
 *   1. {@link CommandContext} — the unified "what is the operator doing right
 *      now" snapshot (workspace ∪ machineKind ∪ selection ∪ sketch mode),
 *      aggregated from today's three *separate* contexts.
 *   2. {@link CommandHandler} — `{ id, run(ctx), enabled?(ctx), keybinding? }`.
 *      Registered against a catalog `id`. A catalog entry with no registered
 *      handler is still discoverable (it shows in ribbon/palette) but is
 *      disabled/greyed — honest UX, no silent no-ops in the UI.
 *   3. The registry — `registerCommand` / `getHandler` / `runCommand`, plus
 *      {@link resolveCommands} which joins the catalog with handlers + computed
 *      `enabled` state, filtered to the active context and grouped by ribbon.
 */

import type { WorkspaceId } from '../app/useWorkspaceRouter'
import type { EnvironmentId } from '../src/environments/registry'
import {
  type CommandRibbonGroup,
  type CommandShellWorkspace,
  type FusionStyleCommand,
  FUSION_STYLE_COMMAND_CATALOG,
  DESIGN_RIBBON_COMMAND_IDS
} from '../../shared/fusion-style-command-catalog'

// ── Machine kind ────────────────────────────────────────────────────────────

/**
 * The ribbon-facing classification of the active machine. The shell's
 * Manufacture ribbon is machine-contextual (tool-catalog §2.2–2.4):
 *   - `'fdm'`    → Creality K2 Plus (slicer loop)
 *   - `'router'` → Laguna Swift 5×10 (3-axis router)
 *   - `'mill4'`  → Makera Carvera + 4th-axis (desktop 4-axis mill)
 *   - `null`     → no machine selected yet (CAD-first boot state)
 *
 * Distinct from `MachineProfile.kind` (`'fdm' | 'cnc'`) because a single `cnc`
 * value cannot tell a router from a mill, and the Laguna profile carries no
 * `axisCount`. The authoritative signal is the shop **environment** the active
 * machine belongs to; see {@link deriveMachineKind}.
 */
export type MachineKind = 'fdm' | 'router' | 'mill4'

/**
 * Map a shop {@link EnvironmentId} to the ribbon {@link MachineKind}. Pure and
 * total over the three environments so a new environment cannot silently fall
 * through to the wrong ribbon. `null` env → `null` kind (no machine yet).
 *
 * This is the single place the env→kind mapping lives; the provider does the
 * (React-coupled) machine→env lookup via `getEnvironmentForMachine` and hands
 * the result here.
 */
export function deriveMachineKind(env: EnvironmentId | null): MachineKind | null {
  switch (env) {
    case 'creality_print':
      return 'fdm'
    case 'vcarve_pro':
      return 'router'
    case 'makera_cam':
      return 'mill4'
    case null:
      return null
    default: {
      // Exhaustiveness guard — a new EnvironmentId must extend the switch.
      const _never: never = env
      void _never
      return null
    }
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * The unified active-context the engine reads to decide visibility +
 * enablement. Aggregated from the three contexts that exist today as separate
 * islands:
 *   - `workspace`     ← `useWorkspaceRouter` (`app/useWorkspaceRouter.ts`)
 *   - `machineKind`   ← active machine → env → {@link deriveMachineKind}
 *                       (`contexts/MachineSessionContext` + env registry)
 *   - `hasSelection` / `selectionKind` ← `design/selection-state.ts`
 *   - `sketchMode`    ← the Design workspace's sketch stage
 */
export interface CommandContext {
  /** Top-level workspace the shell is showing. */
  readonly workspace: WorkspaceId
  /** Ribbon classification of the active machine, or `null` if none selected. */
  readonly machineKind: MachineKind | null
  /** True when a face / edge / vertex (or any pickable entity) is selected. */
  readonly hasSelection: boolean
  /** Discriminator of the current selection (`'face' | 'edge' | 'vertex'`…). */
  readonly selectionKind?: string
  /** True when the Design workspace is in its contextual sketch stage. */
  readonly sketchMode?: boolean
}

/**
 * A safe default context: Design workspace, no machine, nothing selected, not
 * sketching. Used as the provider seed and by tests so callers never have to
 * spell out every field.
 */
export const DEFAULT_COMMAND_CONTEXT: CommandContext = {
  workspace: 'design',
  machineKind: null,
  hasSelection: false
}

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * The runtime behavior bound to a catalog `id`. Separate from the catalog
 * *metadata* (`FusionStyleCommand`) so the catalog stays a pure inventory and
 * the engine owns dispatch.
 */
export interface CommandHandler {
  /** Must match a `FusionStyleCommand.id` (or a synthetic shell command id). */
  readonly id: string
  /** Execute the command against the current context. */
  readonly run: (ctx: CommandContext) => void
  /**
   * Optional enablement predicate. Returns `false` to grey the command out
   * (e.g. no selection, wrong workspace, wrong machine). Absent ⇒ always
   * enabled. A registered handler is the prerequisite for being enabled at
   * all — a catalog entry with no handler is reported as `enabled: false`.
   */
  readonly enabled?: (ctx: CommandContext) => boolean
  /**
   * Optional canonical keybinding hint (e.g. `'L'`, `'Ctrl+K'`). Display-only
   * for now — surfaced in the palette/ribbon; the actual key wiring still
   * lives in `app-keyboard-shortcuts.ts` until the hotkey layer (FG-7) reads
   * this field.
   */
  readonly keybinding?: string
}

// ── Registry ────────────────────────────────────────────────────────────────

/**
 * A command registry: an isolated `id → handler` map. The module exports a
 * shared default instance ({@link commandRegistry}) plus the free functions
 * that operate on it, but the class is exported so tests can spin up a fresh,
 * isolated registry without leaking handlers across files (important under the
 * single-worker vitest pool — see vitest.config.ts).
 */
export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>()

  /**
   * Register (or replace) the handler for `handler.id`. Returns a disposer that
   * removes exactly this registration (so a React effect can clean up on
   * unmount without clobbering a later re-registration of the same id).
   */
  register(handler: CommandHandler): () => void {
    if (import.meta.env?.DEV && this.handlers.has(handler.id)) {
      console.warn(
        `[command-engine] handler for "${handler.id}" is being replaced — ` +
          'each command id should be registered once.'
      )
    }
    this.handlers.set(handler.id, handler)
    return () => {
      // Only delete if the current registration is still ours.
      if (this.handlers.get(handler.id) === handler) {
        this.handlers.delete(handler.id)
      }
    }
  }

  /** Look up a handler by id, or `undefined` if nothing is registered. */
  get(id: string): CommandHandler | undefined {
    return this.handlers.get(id)
  }

  /** True when a handler is registered for `id`. */
  has(id: string): boolean {
    return this.handlers.has(id)
  }

  /**
   * Run the command for `id` against `ctx`. No-ops gracefully (with a dev
   * warning) when:
   *   - no handler is registered for `id` (catalog metadata exists but the
   *     tool is not wired yet — the honest "planned" path), or
   *   - the handler's `enabled(ctx)` predicate returns `false`.
   *
   * Returns `true` if the command actually ran, `false` otherwise — so callers
   * (palette/ribbon) can decide whether to show an honest "not available yet"
   * toast.
   */
  run(id: string, ctx: CommandContext): boolean {
    const handler = this.handlers.get(id)
    if (!handler) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[command-engine] no handler registered for "${id}" — ` +
            'command is catalog metadata only (planned). Skipping.'
        )
      }
      return false
    }
    if (handler.enabled && !handler.enabled(ctx)) {
      if (import.meta.env?.DEV) {
        console.warn(`[command-engine] "${id}" is disabled in the current context. Skipping.`)
      }
      return false
    }
    handler.run(ctx)
    return true
  }

  /** Number of registered handlers. Test/diagnostic helper. */
  get size(): number {
    return this.handlers.size
  }

  /** Remove every registration. Test helper — never call from app code. */
  clear(): void {
    this.handlers.clear()
  }
}

/** The shared registry the running shell dispatches through. */
export const commandRegistry = new CommandRegistry()

/** Register a handler on the shared registry. Returns a disposer. */
export function registerCommand(handler: CommandHandler): () => void {
  return commandRegistry.register(handler)
}

/** Look up a handler on the shared registry. */
export function getHandler(id: string): CommandHandler | undefined {
  return commandRegistry.get(id)
}

/**
 * Dispatch a command by id on the shared registry. No-ops gracefully for ids
 * that have catalog metadata but no registered handler (dev warning). Returns
 * whether the command ran.
 */
export function runCommand(id: string, ctx: CommandContext): boolean {
  return commandRegistry.run(id, ctx)
}

// ── Context filtering / resolution ──────────────────────────────────────────

/**
 * Workspace gate: which catalog `workspace` buckets are valid for the active
 * shell {@link WorkspaceId}. The catalog uses a coarser `CommandShellWorkspace`
 * vocabulary (`'design' | 'assemble' | 'manufacture' | 'utilities'`) than the
 * 6-item shell rail, so several shell routes map onto the same catalog bucket:
 *   - `design`      → Design tools (+ utilities, which are globally reachable)
 *   - `assemble`    → Assemble tools (+ utilities)
 *   - `manufacture` → Manufacture tools (+ utilities)
 *   - `drawings`    → the Drawing ribbon lives under `design`/`utilities`
 *   - `workshop`    → machine dashboards; only global utilities apply
 *   - `utilities`   → File/Library/Commands (the `utilities` bucket)
 *
 * `utilities` commands (Open/Save/Import/Export/Measure/Parameters/palette) are
 * cross-cutting, so they are included on every route — that mirrors how Fusion
 * keeps File/Inspect reachable from any workspace.
 */
export function workspacesForRoute(route: WorkspaceId): ReadonlySet<CommandShellWorkspace> {
  switch (route) {
    case 'design':
      return new Set<CommandShellWorkspace>(['design', 'utilities'])
    case 'assemble':
      return new Set<CommandShellWorkspace>(['assemble', 'utilities'])
    case 'manufacture':
      return new Set<CommandShellWorkspace>(['manufacture', 'utilities'])
    case 'drawings':
      // The drawing ribbon's commands are catalogued under design/utilities.
      return new Set<CommandShellWorkspace>(['design', 'utilities'])
    case 'workshop':
      return new Set<CommandShellWorkspace>(['utilities'])
    case 'utilities':
      return new Set<CommandShellWorkspace>(['utilities'])
    default: {
      const _never: never = route
      void _never
      return new Set<CommandShellWorkspace>(['utilities'])
    }
  }
}

/**
 * A catalog command joined with its registered handler + the computed
 * enablement for a specific context. This is the shape the ribbon and palette
 * render — they never re-derive `enabled` or re-look-up handlers themselves.
 */
export interface ResolvedCommand {
  /** The catalog metadata row (label / ribbon / workspace / status / notes). */
  readonly command: FusionStyleCommand
  /** The registered handler, or `undefined` when the tool is not wired yet. */
  readonly handler?: CommandHandler
  /** True when a handler exists AND its `enabled(ctx)` (if any) returns true. */
  readonly enabled: boolean
  /** Convenience: `true` when a handler is registered (regardless of enabled). */
  readonly hasHandler: boolean
}

/**
 * Compute whether a command is enabled in a context: it must have a registered
 * handler, and that handler's `enabled(ctx)` predicate (if present) must pass.
 * A bare metadata entry (no handler) is never enabled — that is what makes the
 * "shows but greyed" honesty contract work.
 */
export function isCommandEnabled(handler: CommandHandler | undefined, ctx: CommandContext): boolean {
  if (!handler) return false
  return handler.enabled ? handler.enabled(ctx) : true
}

/** Options for {@link resolveCommands}. */
export interface ResolveCommandsOptions {
  /** Catalog to resolve against. Defaults to the full shipped catalog. */
  readonly catalog?: readonly FusionStyleCommand[]
  /** Registry to look handlers up in. Defaults to the shared registry. */
  readonly registry?: CommandRegistry
  /**
   * When `true` (default), drop commands whose `workspace` is not valid for
   * `ctx.workspace`. Set `false` to resolve the whole catalog regardless of
   * route (e.g. the global palette, which searches everything).
   */
  readonly filterByWorkspace?: boolean
}

/**
 * Join the catalog with handlers + computed enablement for `ctx`, filtered to
 * the entries valid for `ctx.workspace` (and, for Manufacture, the active
 * `ctx.machineKind`). This is the single source the ribbon + (workspace-scoped)
 * palette render.
 *
 * Manufacture machine-awareness: when the route is `manufacture`, Manufacture
 * commands are only included if a machine is selected (`machineKind != null`).
 * Op-kind-level filtering (which 2D/3D/rotary ops a given machine offers) is a
 * Wave-3 concern handled by the per-machine ribbon; FG-1 gates at the coarse
 * "is there a machine at all" level so the Manufacture ribbon is honestly empty
 * before a machine is chosen.
 */
export function resolveCommands(ctx: CommandContext, opts: ResolveCommandsOptions = {}): ResolvedCommand[] {
  const catalog = opts.catalog ?? FUSION_STYLE_COMMAND_CATALOG
  const registry = opts.registry ?? commandRegistry
  const filterByWorkspace = opts.filterByWorkspace ?? true
  const allowed = workspacesForRoute(ctx.workspace)

  const out: ResolvedCommand[] = []
  for (const command of catalog) {
    if (filterByWorkspace) {
      if (!allowed.has(command.workspace)) continue
      // Manufacture commands need a machine selected to be contextually valid.
      if (command.workspace === 'manufacture' && ctx.machineKind === null) continue
    }
    const handler = registry.get(command.id)
    out.push({
      command,
      handler,
      enabled: isCommandEnabled(handler, ctx),
      hasHandler: handler !== undefined
    })
  }
  return out
}

/**
 * A ribbon group of resolved commands — the unit the ribbon renders as a panel.
 * `group` is the catalog's `CommandRibbonGroup`; `commands` preserves catalog
 * order within the group.
 */
export interface ResolvedCommandGroup {
  readonly group: CommandRibbonGroup
  readonly commands: ResolvedCommand[]
}

/**
 * Group resolved commands by their catalog `ribbon` group, preserving first-seen
 * group order and intra-group catalog order. This is exactly what the ribbon
 * consumes: tabs/panels keyed by `CommandRibbonGroup`, each holding its command
 * buttons.
 */
export function groupResolvedCommands(resolved: readonly ResolvedCommand[]): ResolvedCommandGroup[] {
  const order: CommandRibbonGroup[] = []
  const byGroup = new Map<CommandRibbonGroup, ResolvedCommand[]>()
  for (const r of resolved) {
    const g = r.command.ribbon
    let bucket = byGroup.get(g)
    if (!bucket) {
      bucket = []
      byGroup.set(g, bucket)
      order.push(g)
    }
    bucket.push(r)
  }
  return order.map((group) => ({ group, commands: byGroup.get(group) ?? [] }))
}

/**
 * Convenience: resolve + group in one call. The ribbon's primary entry point.
 */
export function resolveCommandGroups(
  ctx: CommandContext,
  opts: ResolveCommandsOptions = {}
): ResolvedCommandGroup[] {
  return groupResolvedCommands(resolveCommands(ctx, opts))
}

// ── Deep-link routing ───────────────────────────────────────────────────────

/**
 * A request to switch workspace and (optionally) arm a tool there — the
 * "navigate + arm" intent a command handler emits when its tool lives in a
 * different workspace than the one currently shown. Consumed by the provider's
 * {@link DeepLinkRouter} wiring (`navigateAndArm`), which actually flips the
 * `useWorkspaceRouter` route and forwards the `armToolId` to the target
 * workspace.
 */
export interface DeepLinkRequest {
  /** Workspace to switch to before arming. */
  readonly workspace: WorkspaceId
  /**
   * Catalog id of the tool to arm in the target workspace (e.g. `'sk_line'`).
   * Absent ⇒ just navigate. The target workspace decides what "arm" means
   * (sketch tool selection, constraint picker, op kind, …).
   */
  readonly armToolId?: string
}

/**
 * The host-supplied router a deep-linking handler calls. The provider builds a
 * concrete one from `useWorkspaceRouter.setActiveWorkspace` + a tool-arming
 * callback; tests can supply a spy.
 */
export interface DeepLinkRouter {
  readonly navigateAndArm: (request: DeepLinkRequest) => void
}

/**
 * True when `id` is a Design-ribbon command that should deep-link into the
 * Design workspace and arm a tool there. Reuses the catalog's
 * `DESIGN_RIBBON_COMMAND_IDS` enumeration of intent (which previously had no
 * consumer in the new shell).
 */
export function isDesignArmCommand(id: string): boolean {
  return DESIGN_RIBBON_COMMAND_IDS.has(id)
}

/**
 * Build a {@link DeepLinkRequest} for a Design-arm command id, or `null` when
 * the id is not a known Design-arm tool. Pure helper so the starter-command
 * factory and tests share one mapping.
 */
export function designArmRequest(id: string): DeepLinkRequest | null {
  if (!isDesignArmCommand(id)) return null
  return { workspace: 'design', armToolId: id }
}
