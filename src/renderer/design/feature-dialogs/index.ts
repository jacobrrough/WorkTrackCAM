/**
 * FG-5b · Per-feature property dialogs — public barrel.
 *
 * Consumers (DesignWorkspace, the Solid ribbon, the command engine's
 * deep-link arming) import from `design/feature-dialogs` rather than reaching
 * into individual files. Every dialog is presentational + props-driven and
 * emits a {@link FeatureDialogChange} the {@link FeatureDialogHost} routes to
 * the existing kernel/script sinks.
 */

// Shared contract + helpers.
export {
  type FeatureDialogKind,
  type FeatureDialogChange,
  type FeatureDialogSelectionInfo,
  type FeatureDialogBaseProps,
  type EdgeDirection,
  FEATURE_DIALOG_COMMAND_ID,
  EDGE_DIRECTION_OPTIONS,
  EDGE_DIRECTION_LABELS,
  parsePositiveMm,
  parseFiniteMm,
  parseClampedInt
} from './feature-dialog-types'

// Shared presentational kit (exported for reuse + targeted tests).
export {
  FeatureDialogCard,
  DialogNumberField,
  DialogSelectField,
  EdgeDirectionPicker,
  SelectionContextBanner,
  DialogApplyRow
} from './FeatureDialogKit'

// The six dialogs + their pure op-builders.
export {
  ExtrudeDialog,
  DEFAULT_EXTRUDE_DEPTH_PARAM,
  type ExtrudeDialogParams,
  type ExtrudeDialogProps
} from './ExtrudeDialog'
export {
  RevolveDialog,
  DEFAULT_REVOLVE_ANGLE_PARAM,
  type RevolveDialogParams,
  type RevolveDialogProps
} from './RevolveDialog'
export {
  FilletDialog,
  buildFilletOp,
  type FilletDialogParams,
  type FilletDialogProps
} from './FilletDialog'
export {
  ChamferDialog,
  buildChamferOp,
  type ChamferDialogParams,
  type ChamferDialogProps
} from './ChamferDialog'
export {
  ShellDialog,
  buildShellOp,
  type ShellDialogParams,
  type ShellDialogProps
} from './ShellDialog'
export {
  HoleDialog,
  buildHoleOp,
  type HoleDialogParams,
  type HoleDialogProps
} from './HoleDialog'

// The host that selects + routes a dialog.
export {
  FeatureDialogHost,
  FEATURE_DIALOG_HOST_TESTID,
  type FeatureDialogSpec,
  type FeatureDialogHostProps
} from './FeatureDialogHost'
