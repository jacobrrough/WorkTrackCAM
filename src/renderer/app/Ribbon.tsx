/**
 * FG-4a · The shell Ribbon — a Fusion-style contextual command ribbon that
 * sits directly below the {@link TopBar}.
 *
 * It is the visible face of the FG-1 Context Engine: it reads the unified
 * {@link useCommandContext} (workspace ∪ machineKind ∪ selection ∪ sketch mode)
 * and the {@link useResolvedCommands} join (catalog × registered handlers ×
 * computed enablement, grouped by `CommandRibbonGroup`), then renders, for the
 * active **(workspace × machineKind)**:
 *
 *   - a **tab strip** of the ribbon groups valid for the context (the
 *     tool-catalog §2 taxonomy: Design = Sketch / Solid / Construct / Inspect /
 *     Assemble / Drawing; Manufacture is machine-contextual — FDM = Prepare /
 *     Arrange / Supports / Process / Preview / Device, Router = Setup / Vectors /
 *     2D / V-Carve / Nesting / Simulate / Send, Mill-4 = Setup / 2D / 3D /
 *     Rotary / Probing / Simulate / Send);
 *   - the **panels** of the active tab — one panel per underlying
 *     `CommandRibbonGroup`, each a cluster of command buttons;
 *   - **buttons** that dispatch `runCommand(id, ctx)` through the shared
 *     registry. A button with no registered handler, or whose `enabled(ctx)`
 *     predicate is false, renders greyed + `disabled` with an honest tooltip —
 *     no silent no-ops (the FG-1 honesty contract).
 *
 * The component is **presentational**: it owns no engine state. It is split into
 *   - {@link RibbonView} — a pure view taking `ctx` + `groups` + an `onRun`
 *     callback (no hooks, no providers) so it unit-tests in the node-env vitest
 *     with `renderToStaticMarkup`; and
 *   - {@link Ribbon} — the thin connected wrapper that pulls `ctx`/`groups`/`run`
 *     from the Context Engine hooks. AppShell mounts `<Ribbon />`; the Integrate
 *     phase wires it below the TopBar (this cycle does NOT edit AppShell).
 *
 * Every button carries an explicit `type="button"` (the app/ shell pin) and
 * every color comes from the themed tokens (`themes.css`), so the ribbon reskins
 * with the theme picker exactly like the rest of the `.wt-*` shell.
 */

import { useCallback, type ReactElement } from 'react'
import type { WorkspaceId } from './useWorkspaceRouter'
import {
  type CommandContext,
  type MachineKind,
  type ResolvedCommand,
  type ResolvedCommandGroup,
  useCommandContext,
  useCommandEngine,
  useResolvedCommands
} from '../commands'
import type { CommandRibbonGroup } from '../../shared/fusion-style-command-catalog'

// ── Tab taxonomy (tool-catalog §2) ──────────────────────────────────────────

/**
 * A ribbon tab: an operator-facing label plus the ordered set of underlying
 * `CommandRibbonGroup` panels it surfaces. Several Fusion-shaped tabs collapse
 * more than one catalog group (e.g. the Design **Solid** tab shows both the
 * `solid_create` / `solid_modify` and the `solid_pattern` panels), so a tab is a
 * 1-to-many label→groups mapping, not a 1-to-1 rename of `CommandRibbonGroup`.
 */
interface RibbonTabDef {
  /** Stable id (used as the React key + the `data-ribbon-tab` test hook). */
  readonly id: string
  /** Operator-facing tab label (tool-catalog §2 taxonomy). */
  readonly label: string
  /** The catalog ribbon groups whose commands render under this tab. */
  readonly groups: readonly CommandRibbonGroup[]
}

/**
 * Design workspace tabs — machine-independent (tool-catalog §2.1). Sketch is the
 * contextual green tab, surfaced only in sketch mode (see {@link tabsForContext}).
 *
 * Note: the §2.1 taxonomy lists Assemble + Drawing as Design ribbon tabs, but
 * the FG-1 engine gates commands by `workspace`: the catalog files Assemble
 * commands under the `assemble` workspace (reached via the dedicated Assemble
 * route, which has its own Assemble tab below) while Drawing commands are filed
 * under `utilities`, so they ARE reachable from the Design route. The Design
 * ribbon therefore surfaces Sketch / Solid / Construct / Inspect / Drawing;
 * Assemble is the Assemble workspace's ribbon. Tabs that resolve to zero
 * commands in a context are dropped by {@link tabsForContext} regardless.
 */
const DESIGN_TABS: readonly RibbonTabDef[] = [
  { id: 'sketch', label: 'Sketch', groups: ['sketch_create', 'sketch_modify', 'sketch_constraint', 'sketch_dimension'] },
  { id: 'solid', label: 'Solid', groups: ['solid_create', 'solid_modify', 'solid_pattern'] },
  { id: 'construct', label: 'Construct', groups: ['surface', 'sheet_metal', 'plastic'] },
  { id: 'inspect', label: 'Inspect', groups: ['inspect'] },
  { id: 'drawing', label: 'Drawing', groups: ['drawing'] }
]

/** Assemble workspace tabs (the catalog's assemble buckets). */
const ASSEMBLE_TABS: readonly RibbonTabDef[] = [
  { id: 'assemble', label: 'Assemble', groups: ['assemble', 'assemble_joint'] },
  { id: 'inspect', label: 'Inspect', groups: ['inspect'] },
  { id: 'manage', label: 'Manage', groups: ['manage'] }
]

/** Drawings workspace — the standalone Drawing ribbon (tool-catalog §2.5). */
const DRAWING_TABS: readonly RibbonTabDef[] = [
  { id: 'drawing', label: 'Drawing', groups: ['drawing'] },
  { id: 'inspect', label: 'Inspect', groups: ['inspect'] }
]

/** Utilities workspace — File / Commands / Inspect live in the `manage` bucket. */
const UTILITIES_TABS: readonly RibbonTabDef[] = [
  { id: 'manage', label: 'Manage', groups: ['manage'] },
  { id: 'inspect', label: 'Inspect', groups: ['inspect'] }
]

/**
 * Manufacture tabs are machine-contextual (tool-catalog §2.2–2.4). Every CAM
 * `CommandRibbonGroup` the catalog ships is one of `manufacture_setup`,
 * `manufacture_2d`, `manufacture_3d`, or `inspect` (Simulation). The Fusion-shaped
 * stage labels per machine map onto those four groups; tabs whose groups resolve
 * to no commands in the current context are dropped (see {@link tabsForContext}),
 * so the honest set shows even though the catalog is coarser than the taxonomy.
 */
const FDM_TABS: readonly RibbonTabDef[] = [
  { id: 'prepare', label: 'Prepare', groups: ['manufacture_setup'] },
  { id: 'process', label: 'Process', groups: ['manufacture_3d'] },
  { id: 'preview', label: 'Preview', groups: ['inspect'] },
  { id: 'device', label: 'Device', groups: ['manufacture_2d'] }
]

const ROUTER_TABS: readonly RibbonTabDef[] = [
  { id: 'setup', label: 'Setup', groups: ['manufacture_setup'] },
  { id: '2d', label: '2D Toolpaths', groups: ['manufacture_2d'] },
  { id: 'vcarve', label: 'V-Carve', groups: ['manufacture_3d'] },
  { id: 'simulate', label: 'Simulate', groups: ['inspect'] }
]

const MILL4_TABS: readonly RibbonTabDef[] = [
  { id: 'setup', label: 'Setup', groups: ['manufacture_setup'] },
  { id: '2d', label: '2D', groups: ['manufacture_2d'] },
  { id: '3d', label: '3D / Rotary', groups: ['manufacture_3d'] },
  { id: 'simulate', label: 'Simulate', groups: ['inspect'] }
]

/** Pick the Manufacture tab set for the active machine kind. */
function manufactureTabs(kind: MachineKind | null): readonly RibbonTabDef[] {
  switch (kind) {
    case 'fdm':
      return FDM_TABS
    case 'router':
      return ROUTER_TABS
    case 'mill4':
      return MILL4_TABS
    case null:
      return []
    default: {
      const _never: never = kind
      void _never
      return []
    }
  }
}

/** The full (pre-filter) tab set for a workspace. */
function tabsForWorkspace(workspace: WorkspaceId, kind: MachineKind | null): readonly RibbonTabDef[] {
  switch (workspace) {
    case 'design':
      return DESIGN_TABS
    case 'assemble':
      return ASSEMBLE_TABS
    case 'manufacture':
      return manufactureTabs(kind)
    case 'drawings':
      return DRAWING_TABS
    case 'workshop':
      // Workshop is machine dashboards — no command ribbon (only global utilities).
      return []
    case 'utilities':
      return UTILITIES_TABS
    default: {
      const _never: never = workspace
      void _never
      return []
    }
  }
}

// ── Context → resolved tabs ─────────────────────────────────────────────────

/** A ribbon tab paired with the resolved-command panels it should render. */
export interface RibbonTab {
  readonly id: string
  readonly label: string
  /** True for the contextual Sketch tab (rendered with the green accent). */
  readonly contextual: boolean
  /** One panel per non-empty underlying ribbon group, in taxonomy order. */
  readonly panels: ResolvedCommandGroup[]
}

/**
 * Join the static tab taxonomy for the context's workspace/machine with the
 * resolved groups, dropping:
 *   - the contextual **Sketch** tab unless `ctx.sketchMode` is set; and
 *   - any tab whose groups resolve to zero commands in this context (so e.g. the
 *     Manufacture tabs that have no catalog rows yet are honestly hidden rather
 *     than shown empty).
 *
 * Pure (no hooks) so the view + tests can call it directly.
 */
export function tabsForContext(ctx: CommandContext, groups: readonly ResolvedCommandGroup[]): RibbonTab[] {
  const byGroup = new Map<CommandRibbonGroup, ResolvedCommandGroup>()
  for (const g of groups) byGroup.set(g.group, g)

  const defs = tabsForWorkspace(ctx.workspace, ctx.machineKind)
  const out: RibbonTab[] = []
  for (const def of defs) {
    const contextual = def.id === 'sketch'
    // The contextual Sketch tab only appears while sketching.
    if (contextual && !ctx.sketchMode) continue
    const panels: ResolvedCommandGroup[] = []
    for (const groupId of def.groups) {
      const resolved = byGroup.get(groupId)
      if (resolved && resolved.commands.length > 0) panels.push(resolved)
    }
    if (panels.length === 0) continue
    out.push({ id: def.id, label: def.label, contextual, panels })
  }
  return out
}

/** Human-readable panel heading for a `CommandRibbonGroup` (Fusion CREATE/MODIFY-style). */
const PANEL_LABELS: Readonly<Record<CommandRibbonGroup, string>> = {
  sketch_create: 'Create',
  sketch_modify: 'Modify',
  sketch_constraint: 'Constrain',
  sketch_dimension: 'Dimension',
  solid_create: 'Create',
  solid_modify: 'Modify',
  solid_pattern: 'Pattern',
  surface: 'Surface',
  sheet_metal: 'Sheet Metal',
  plastic: 'Plastic',
  assemble: 'Assemble',
  assemble_joint: 'Joints',
  manufacture_setup: 'Setup',
  manufacture_2d: '2D',
  manufacture_3d: '3D',
  drawing: 'Drawing',
  inspect: 'Inspect',
  manage: 'Manage'
}

// ── Button ──────────────────────────────────────────────────────────────────

/**
 * One ribbon command button. Greyed + `disabled` when the command has no
 * handler or its `enabled(ctx)` is false; the tooltip explains why (the honest
 * "planned / not available here" UX). A live button dispatches via `onRun`.
 */
function RibbonButton({
  resolved,
  onRun
}: {
  resolved: ResolvedCommand
  onRun: (id: string) => void
}): ReactElement {
  const { command, handler, enabled, hasHandler } = resolved
  const keybinding = handler?.keybinding
  const title = enabled
    ? keybinding
      ? `${command.label} (${keybinding})`
      : command.label
    : hasHandler
      ? `${command.label} — not available in this context`
      : `${command.label} — not wired yet (planned)`

  return (
    <button
      type="button"
      className={`wt-ribbon__btn${enabled ? '' : ' wt-ribbon__btn--disabled'}`}
      data-command-id={command.id}
      data-enabled={enabled ? 'true' : 'false'}
      disabled={!enabled}
      aria-disabled={enabled ? undefined : true}
      title={title}
      onClick={enabled ? () => onRun(command.id) : undefined}
    >
      <span className="wt-ribbon__btn-label">{command.label}</span>
    </button>
  )
}

// ── Pure view ───────────────────────────────────────────────────────────────

export interface RibbonViewProps {
  /** The active command context (drives which tab set + which tab is shown). */
  readonly ctx: CommandContext
  /** Resolved + grouped commands for `ctx` (from the engine join). */
  readonly groups: readonly ResolvedCommandGroup[]
  /** Which tab is active. Falls back to the first available tab when unset/stale. */
  readonly activeTabId: string | null
  /** Select a tab by id. */
  readonly onSelectTab: (tabId: string) => void
  /** Dispatch a command id (the connected wrapper routes this to the registry). */
  readonly onRun: (id: string) => void
}

/**
 * The presentational ribbon. No hooks, no providers, no engine state — it takes
 * everything it renders as props, so it is trivially testable with
 * `renderToStaticMarkup`. Renders nothing (returns an empty toolbar) when the
 * context yields no tabs (e.g. Workshop, or Manufacture before a machine is
 * selected) so the shell layout stays stable.
 */
export function RibbonView({ ctx, groups, activeTabId, onSelectTab, onRun }: RibbonViewProps): ReactElement {
  const tabs = tabsForContext(ctx, groups)
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null

  return (
    <div className="wt-ribbon" role="toolbar" aria-label="Command ribbon" data-workspace={ctx.workspace}>
      {tabs.length === 0 ? (
        <div className="wt-ribbon__empty" aria-hidden="true" />
      ) : (
        <>
          <div className="wt-ribbon__tabs" role="tablist" aria-label="Ribbon tabs">
            {tabs.map((tab) => {
              const isActive = active?.id === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-ribbon-tab={tab.id}
                  className={
                    `wt-ribbon__tab${isActive ? ' wt-ribbon__tab--active' : ''}` +
                    `${tab.contextual ? ' wt-ribbon__tab--contextual' : ''}`
                  }
                  onClick={() => onSelectTab(tab.id)}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {active ? (
            <div className="wt-ribbon__panels" role="tabpanel" data-ribbon-panels={active.id}>
              {active.panels.map((panel) => (
                <section key={panel.group} className="wt-ribbon__panel" data-ribbon-panel={panel.group}>
                  <div className="wt-ribbon__panel-body">
                    {panel.commands.map((resolved) => (
                      <RibbonButton key={resolved.command.id} resolved={resolved} onRun={onRun} />
                    ))}
                  </div>
                  <div className="wt-ribbon__panel-title">{PANEL_LABELS[panel.group]}</div>
                </section>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

// ── Connected wrapper (mounted by AppShell) ─────────────────────────────────

/**
 * The connected ribbon AppShell mounts below the TopBar. Pulls the live context
 * + resolved groups + dispatcher from the Context Engine and feeds them to
 * {@link RibbonView}. The active-tab selection is intentionally derived (not
 * stored) this cycle: the view defaults to the first available tab, so the
 * ribbon always shows a populated tab for the current context without extra
 * state. A persisted per-workspace active-tab is a follow-up.
 *
 * Requires a {@link CommandContextProvider} ancestor (AppShell already wraps the
 * shell in one); see `RibbonView` for a provider-free, directly-testable view.
 */
export function Ribbon(): ReactElement {
  const ctx = useCommandContext()
  const groups = useResolvedCommands(ctx)
  const { run } = useCommandEngine()
  const onRun = useCallback((id: string) => void run(id), [run])
  // Active tab is derived in the view (first available). `onSelectTab` is a
  // no-op placeholder until the persisted-tab follow-up; passing it keeps the
  // view contract stable and the tabs keyboard-focusable.
  const noop = useCallback(() => {}, [])
  return <RibbonView ctx={ctx} groups={groups} activeTabId={null} onSelectTab={noop} onRun={onRun} />
}
