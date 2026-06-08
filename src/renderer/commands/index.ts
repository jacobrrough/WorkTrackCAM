/**
 * FG-1 · Context Engine public API barrel.
 *
 * Consumer agents (the ribbon, the reconciled palette, context menus) import
 * from `renderer/commands` rather than reaching into individual files. The pure
 * engine, the React provider/hooks, and the starter-command wiring are all
 * re-exported here.
 */

// Pure engine (no React) — types, registry, resolution, deep-link helpers.
export {
  type MachineKind,
  type CommandContext,
  type CommandHandler,
  type ResolvedCommand,
  type ResolvedCommandGroup,
  type ResolveCommandsOptions,
  type DeepLinkRequest,
  type DeepLinkRouter,
  CommandRegistry,
  commandRegistry,
  DEFAULT_COMMAND_CONTEXT,
  deriveMachineKind,
  registerCommand,
  getHandler,
  runCommand,
  isCommandEnabled,
  resolveCommands,
  resolveCommandGroups,
  groupResolvedCommands,
  workspacesForRoute,
  isDesignArmCommand,
  designArmRequest
} from './command-engine'

// React layer — provider + hooks.
export {
  type CommandSurfaceState,
  type CommandContextProviderProps,
  CommandContextProvider,
  useCommandContext,
  useCommandEngine,
  useCommandSurface,
  useOptionalCommandSurface,
  useResolvedCommands
} from './CommandContextProvider'

// Starter handlers — shell-level commands + host-action contract.
export {
  type ShellCommandActions,
  type ShellCommandMeta,
  SHELL_COMMAND_IDS,
  SHELL_COMMANDS,
  gotoCommandId,
  themeCommandId,
  buildStarterCommands,
  registerStarterCommands
} from './starter-commands'

// Palette row model — pure join of shell + resolved-catalog commands (FG-4b).
export {
  type PaletteRow,
  type PaletteRowGroup,
  type BuildPaletteRowsInput,
  buildPaletteRows,
  groupPaletteRows,
  shellRow,
  catalogRow,
  ribbonGroupLabel
} from './command-palette-rows'

// Design ribbon handlers — host-action contract + register wiring (FG-3/FG-5).
export {
  type DesignCommandActions,
  type DesignCommandKind,
  SKETCH_PLANE_COMMAND_ID,
  classifyDesignCommand,
  designCommandEnabled,
  designCommandIds,
  buildDesignCommands,
  registerDesignCommands
} from './design-commands'
