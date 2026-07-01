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

// Construct datums (reference geometry — marker ops; no solid change).
export {
  DatumPlaneDialog,
  DatumLabelField,
  buildDatumPlaneOp,
  DATUM_BASE_PLANE_OPTIONS,
  type DatumBasePlane,
  type DatumPlaneDialogParams,
  type DatumPlaneDialogProps
} from './DatumPlaneDialog'
export {
  DatumAxisDialog,
  buildDatumAxisOp,
  DATUM_AXIS_OPTIONS,
  type DatumAxis,
  type DatumAxisDialogParams,
  type DatumAxisDialogProps
} from './DatumAxisDialog'
export {
  DatumPointDialog,
  buildDatumPointOp,
  type DatumPointDialogParams,
  type DatumPointDialogProps
} from './DatumPointDialog'

// The host that selects + routes a dialog.
export {
  FeatureDialogHost,
  FEATURE_DIALOG_HOST_TESTID,
  type FeatureDialogSpec,
  type FeatureDialogHostProps
} from './FeatureDialogHost'

// FEATURE RE-EDIT — edit a timeline op in place: the op→spec pre-fill mapper,
// the generic fallback editor, and the edit host that routes Apply to
// `updateKernelOpAt` instead of append.
export { featureDialogSpecForOp } from './kernel-op-edit'
export {
  GenericOpEditor,
  genericFieldsForOp,
  buildGenericOpCandidate,
  type GenericOpField,
  type GenericOpFieldKind,
  type GenericOpEditorProps
} from './GenericOpEditor'
export {
  EditKernelOpDialog,
  EDIT_KERNEL_OP_DIALOG_TESTID,
  type EditKernelOpDialogProps
} from './EditKernelOpDialog'

// Wave 3f — Text → machinable sketch vectors dialog (own surface dialog, not
// routed through FeatureDialogHost since it merges into the sketch model, not a
// kernel op / script param).
export {
  TextDialog,
  DEFAULT_TEXT_SIZE_MM,
  DEFAULT_TEXT_LETTER_SPACING_MM,
  loadBundledFontBufferViaFab,
  type FontBufferLoader,
  type TextDialogProps
} from './TextDialog'
