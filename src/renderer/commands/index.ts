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

// Manufacture (CAM) ribbon handlers — host-action contract + register wiring
// (Wave-3 Carvera-first; mirrors design-commands).
export {
  type CamCommandActions,
  type CamCommandKind,
  CAM_COMMAND_OP_KIND,
  MULTI_SETUP_COMMAND_ID,
  PROBING_COMMAND_ID,
  SEND_COMMAND_ID,
  classifyCamCommand,
  camCommandEnabled,
  camCommandIds,
  buildCamCommands,
  registerCamCommands
} from './cam-commands'

// Manufacture (FDM / K2 Plus slicer) ribbon handlers — host-action contract +
// register wiring (Wave-3b; mirrors cam-commands). Prepare / Arrange / Supports /
// Process / Preview / Device + slice + live job controls; FDM-only enablement.
export {
  type FdmCommandActions,
  type FdmCommandKind,
  FDM_IMPORT_COMMAND_ID,
  FDM_ARRANGE_COMMAND_ID,
  FDM_ORIENT_COMMAND_ID,
  FDM_SUPPORTS_COMMAND_ID,
  FDM_PROCESS_COMMAND_ID,
  FDM_PREVIEW_COMMAND_ID,
  FDM_DEVICE_COMMAND_ID,
  FDM_SLICE_PLATE_COMMAND_ID,
  FDM_SLICE_ALL_COMMAND_ID,
  FDM_JOB_PAUSE_COMMAND_ID,
  FDM_JOB_RESUME_COMMAND_ID,
  FDM_JOB_CANCEL_COMMAND_ID,
  classifyFdmCommand,
  fdmCommandEnabled,
  fdmCommandIds,
  buildFdmCommands,
  registerFdmCommands
} from './fdm-commands'
