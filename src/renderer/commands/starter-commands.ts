/**
 * FG-1 · Starter command handlers — the proof the engine is live.
 *
 * Registers the *shell-level* commands (workspace navigation, Settings, Help,
 * Command palette, theme switching) against the shared {@link commandRegistry}.
 * These are exactly the ~17 actions that `app/NewShellCommandPalette.tsx`
 * hand-listed (6 nav + Settings + Help + 11 themes) plus an explicit
 * "open command palette" entry — now expressed once, as registered handlers, so
 * the ribbon, the palette, and any menu dispatch the same `command.id`.
 *
 * These ids are **synthetic shell commands** — they are *not* in
 * `FUSION_STYLE_COMMAND_CATALOG` (that catalog inventories CAD/CAM *tools*).
 * Every CAD/CAM catalog id remains metadata-only with no handler this cycle, so
 * it shows in the ribbon/palette but is honestly greyed/disabled until its tool
 * is wired. The catalog rows that *should* deep-link into Design
 * (`DESIGN_RIBBON_COMMAND_IDS`) already have a ready mechanism
 * (`designArmRequest` + `DeepLinkRouter.navigateAndArm`); arming them is Wave 2.
 *
 * The host wires its real callbacks once (in `AppShell`) by calling
 * {@link registerStarterCommands} with an {@link ShellCommandActions} bag. The
 * function returns a disposer that unregisters every handler it added.
 */

import type { WorkspaceId } from '../app/useWorkspaceRouter'
import { THEMES, type ThemeId } from '../theme/theme-registry'
import {
  type CommandContext,
  type CommandHandler,
  type CommandRegistry,
  commandRegistry
} from './command-engine'

/** The six workspace routes, in nav-rail order. */
const WORKSPACE_ORDER: readonly WorkspaceId[] = [
  'design',
  'assemble',
  'manufacture',
  'drawings',
  'workshop',
  'utilities'
]

/** Human-readable label per workspace (mirrors `WorkspaceNav` / palette labels). */
const WORKSPACE_LABELS: Readonly<Record<WorkspaceId, string>> = {
  design: 'Design',
  assemble: 'Assemble',
  manufacture: 'Make',
  drawings: 'Drawings',
  workshop: 'Workshop',
  utilities: 'Utilities'
}

/** Synthetic shell command id for "go to <workspace>". */
export function gotoCommandId(workspace: WorkspaceId): string {
  return `goto_${workspace}`
}

/** Synthetic shell command id for "switch theme: <theme>". */
export function themeCommandId(theme: ThemeId): string {
  return `theme_${theme}`
}

/** Synthetic shell command ids that are not part of the tool catalog. */
export const SHELL_COMMAND_IDS = {
  openSettings: 'shell_open_settings',
  openHelp: 'shell_open_help',
  openCommandPalette: 'shell_open_command_palette'
} as const

/**
 * The host callbacks the starter handlers need. Supplied once by `AppShell`,
 * which already owns these actions (the workspace router, the Settings/Help
 * drawers, the palette open-state, and `applyTheme`).
 */
export interface ShellCommandActions {
  /** Switch the active shell workspace. */
  readonly navigate: (workspace: WorkspaceId) => void
  /** Open the Settings drawer. */
  readonly openSettings: () => void
  /** Open the Help panel. */
  readonly openHelp: () => void
  /** Open the command palette. */
  readonly openCommandPalette: () => void
  /** Apply a theme by id. */
  readonly applyTheme: (theme: ThemeId) => void
}

/**
 * A renderable description of a synthetic shell command — the metadata the
 * palette needs to *show* the row (the catalog has no entry for these ids).
 * Mirrors the engine's resolution shape so the palette can render shell rows
 * and resolved catalog rows through one code path.
 */
export interface ShellCommandMeta {
  readonly id: string
  /** Section label in the palette (`'Navigate' | 'App' | 'Theme'`). */
  readonly group: string
  readonly label: string
  /** Optional leading glyph (matches the legacy palette's icon column). */
  readonly icon?: string
}

/**
 * Stable list of the shell command rows the palette renders (navigation, app
 * actions, themes). Pure data — does not touch the registry. Order matches the
 * legacy `NewShellCommandPalette` so the palette UX is unchanged.
 */
export const SHELL_COMMANDS: readonly ShellCommandMeta[] = [
  ...WORKSPACE_ORDER.map((id) => ({
    id: gotoCommandId(id),
    group: 'Navigate',
    label: `Go to ${WORKSPACE_LABELS[id]}`,
    icon: '\u{1F9ED}' // compass
  })),
  { id: SHELL_COMMAND_IDS.openSettings, group: 'App', label: 'Open Settings', icon: '⚙' },
  { id: SHELL_COMMAND_IDS.openHelp, group: 'App', label: 'Open Help', icon: '❓' },
  {
    id: SHELL_COMMAND_IDS.openCommandPalette,
    group: 'App',
    label: 'Open Command palette',
    icon: '⌘'
  },
  ...THEMES.map((theme) => ({
    id: themeCommandId(theme.id),
    group: 'Theme',
    label: `Switch theme: ${theme.label}`,
    icon: '\u{1F3A8}' // palette
  }))
]

/**
 * Build (but do not register) the starter handler list from the host actions.
 * Exported so tests can assert the handler set without mutating a shared
 * registry. `run` ignores the context for shell actions (they are
 * context-independent); they carry no `enabled` predicate, so they are always
 * available.
 */
export function buildStarterCommands(actions: ShellCommandActions): CommandHandler[] {
  const handlers: CommandHandler[] = []

  // 1) The six workspace-navigation commands.
  for (const workspace of WORKSPACE_ORDER) {
    handlers.push({
      id: gotoCommandId(workspace),
      run: (_ctx: CommandContext) => actions.navigate(workspace)
    })
  }

  // 2) Open Settings / Help / Command palette.
  handlers.push({ id: SHELL_COMMAND_IDS.openSettings, run: () => actions.openSettings() })
  handlers.push({ id: SHELL_COMMAND_IDS.openHelp, run: () => actions.openHelp() })
  handlers.push({
    id: SHELL_COMMAND_IDS.openCommandPalette,
    run: () => actions.openCommandPalette(),
    keybinding: 'Ctrl+K'
  })

  // 3) Theme switching — one handler per registered theme (migrated from the
  //    private list in NewShellCommandPalette).
  for (const theme of THEMES) {
    handlers.push({
      id: themeCommandId(theme.id),
      run: () => actions.applyTheme(theme.id)
    })
  }

  return handlers
}

/**
 * Register the starter handlers on a registry (defaults to the shared one).
 * Returns a disposer that unregisters every handler this call added — call it
 * from a React effect cleanup so re-mounts don't double-register.
 */
export function registerStarterCommands(
  actions: ShellCommandActions,
  registry: CommandRegistry = commandRegistry
): () => void {
  const disposers = buildStarterCommands(actions).map((h) => registry.register(h))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
