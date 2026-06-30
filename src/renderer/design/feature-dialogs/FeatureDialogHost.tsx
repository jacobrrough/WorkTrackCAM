/**
 * FG-5b · Feature-dialog host — selects the active dialog and routes its emit
 * to the EXISTING kernel paths.
 *
 * This is the single seam between the presentational dialogs and the live
 * Design plumbing. It takes:
 *   - which feature dialog to show (`kind`),
 *   - the current selection context (forwarded straight through),
 *   - and the two sinks the host already owns:
 *       • `onAppendKernelOp(op)`   — `DesignSessionContext.appendKernelOp`
 *         (persists to `part/features.json` `kernelOps[]`; Build STEP replays).
 *       • `onScriptParams(patch)`  — `DesignWorkspace.handleParamsChange`
 *         (re-runs `cad.execute({ buildParameters })`).
 *
 * It switches on the dialog's `FeatureDialogChange.target` to fan a single
 * `onApply` out to the right sink, so each dialog stays sink-agnostic and the
 * host stays the only place that knows how the change is persisted. No `any`;
 * the union is exhaustively switched.
 *
 * This component is still presentational in the sense that it owns NO IPC — it
 * just calls the two callbacks the parent supplies. The parent
 * (`DesignWorkspace` / `DesignWorkspaceHost`) supplies the real session methods.
 */

import type { JSX } from 'react'
import { ExtrudeDialog, type ExtrudeDialogParams } from './ExtrudeDialog'
import { RevolveDialog, type RevolveDialogParams } from './RevolveDialog'
import { FilletDialog, type FilletDialogParams } from './FilletDialog'
import { ChamferDialog, type ChamferDialogParams } from './ChamferDialog'
import { ShellDialog, type ShellDialogParams } from './ShellDialog'
import { HoleDialog, type HoleDialogParams } from './HoleDialog'
import { DatumPlaneDialog, type DatumPlaneDialogParams } from './DatumPlaneDialog'
import { DatumAxisDialog, type DatumAxisDialogParams } from './DatumAxisDialog'
import { DatumPointDialog, type DatumPointDialogParams } from './DatumPointDialog'
import { MoveCopyDialog, type MoveCopyDialogParams } from './MoveCopyDialog'
import { MirrorDialog, type MirrorDialogParams } from './MirrorDialog'
import { SplitBodyDialog, type SplitBodyDialogParams } from './SplitBodyDialog'
import { RectangularPatternDialog, type RectangularPatternDialogParams } from './RectangularPatternDialog'
import { CircularPatternDialog, type CircularPatternDialogParams } from './CircularPatternDialog'
import { LinearPatternDialog, type LinearPatternDialogParams } from './LinearPatternDialog'
import { AddBoxDialog, type AddBoxDialogParams } from './AddBoxDialog'
import { CutBoxDialog, type CutBoxDialogParams } from './CutBoxDialog'
import { IntersectBoxDialog, type IntersectBoxDialogParams } from './IntersectBoxDialog'
import { CutCylinderDialog, type CutCylinderDialogParams } from './CutCylinderDialog'
import { ThreadDialog, type ThreadDialogParams } from './ThreadDialog'
import { ThickenDialog, type ThickenDialogParams } from './ThickenDialog'
import { CoilDialog, type CoilDialogParams } from './CoilDialog'
import { PlasticRuleFilletDialog, type PlasticRuleFilletDialogParams } from './PlasticRuleFilletDialog'
import { PlasticBossDialog, type PlasticBossDialogParams } from './PlasticBossDialog'
import { PlasticLipGrooveDialog, type PlasticLipGrooveDialogParams } from './PlasticLipGrooveDialog'
import { PressPullProfileDialog, type PressPullProfileDialogParams } from './PressPullProfileDialog'
import { CombineProfileDialog, type CombineProfileDialogParams } from './CombineProfileDialog'
import { PipeDialog, type PipeDialogParams } from './PipeDialog'
import { PatternPathDialog, type PatternPathDialogParams } from './PatternPathDialog'
import { SweepDialog, type SweepDialogParams } from './SweepDialog'
import type { PathOption, ProfileOption } from './profile-path-options'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'
import type { CadScriptParamValue } from '../../../shared/sidecar-protocol'
import {
  type FeatureDialogChange,
  type FeatureDialogKind,
  type FeatureDialogSelectionInfo
} from './feature-dialog-types'

/**
 * Per-kind initial params the host seeds the active dialog with. A discriminated
 * union keyed by `kind` so the host can only pass params that match the dialog
 * it asked for (no `extrude` params reaching the Fillet dialog).
 */
export type FeatureDialogSpec =
  | { readonly kind: 'extrude'; readonly params: ExtrudeDialogParams }
  | { readonly kind: 'revolve'; readonly params: RevolveDialogParams }
  | { readonly kind: 'fillet'; readonly params: FilletDialogParams }
  | { readonly kind: 'chamfer'; readonly params: ChamferDialogParams }
  | { readonly kind: 'shell'; readonly params: ShellDialogParams }
  | { readonly kind: 'hole'; readonly params: HoleDialogParams }
  | { readonly kind: 'datum_plane'; readonly params: DatumPlaneDialogParams }
  | { readonly kind: 'datum_axis'; readonly params: DatumAxisDialogParams }
  | { readonly kind: 'datum_point'; readonly params: DatumPointDialogParams }
  | { readonly kind: 'transform_translate'; readonly params: MoveCopyDialogParams }
  | { readonly kind: 'mirror_union_plane'; readonly params: MirrorDialogParams }
  | { readonly kind: 'split_keep_halfspace'; readonly params: SplitBodyDialogParams }
  | { readonly kind: 'pattern_rectangular'; readonly params: RectangularPatternDialogParams }
  | { readonly kind: 'pattern_circular'; readonly params: CircularPatternDialogParams }
  | { readonly kind: 'pattern_linear_3d'; readonly params: LinearPatternDialogParams }
  | { readonly kind: 'boolean_union_box'; readonly params: AddBoxDialogParams }
  | { readonly kind: 'boolean_subtract_box'; readonly params: CutBoxDialogParams }
  | { readonly kind: 'boolean_intersect_box'; readonly params: IntersectBoxDialogParams }
  | { readonly kind: 'boolean_subtract_cylinder'; readonly params: CutCylinderDialogParams }
  | { readonly kind: 'thread_wizard'; readonly params: ThreadDialogParams }
  | { readonly kind: 'thicken_offset'; readonly params: ThickenDialogParams }
  | { readonly kind: 'coil_cut'; readonly params: CoilDialogParams }
  | { readonly kind: 'plastic_rule_fillet'; readonly params: PlasticRuleFilletDialogParams }
  | { readonly kind: 'plastic_boss'; readonly params: PlasticBossDialogParams }
  | { readonly kind: 'plastic_lip_groove'; readonly params: PlasticLipGrooveDialogParams }
  | { readonly kind: 'press_pull_profile'; readonly params: PressPullProfileDialogParams }
  | { readonly kind: 'boolean_combine_profile'; readonly params: CombineProfileDialogParams }
  | { readonly kind: 'pipe_path'; readonly params: PipeDialogParams }
  | { readonly kind: 'pattern_path'; readonly params: PatternPathDialogParams }
  | { readonly kind: 'sweep_profile_path_true'; readonly params: SweepDialogParams }

export interface FeatureDialogHostProps {
  /** Which dialog to render + its seed params. */
  readonly spec: FeatureDialogSpec
  /** Live selection context (face/edge pick + label). */
  readonly selectionInfo: FeatureDialogSelectionInfo
  /** Sink for Fillet/Chamfer/Shell/Hole — appends a kernel op. */
  readonly onAppendKernelOp: (op: KernelPostSolidOp) => void
  /** Sink for Extrude/Revolve — re-runs the script with a parameter patch. */
  readonly onScriptParams: (patch: Readonly<Record<string, CadScriptParamValue>>) => void
  /** In-flight flag forwarded to the dialog's Apply button. */
  readonly busy?: boolean
  /** No-project / no-model flag forwarded to the dialog. */
  readonly disabled?: boolean
  /** Closed-profile options from the live sketch — fed to profile-picking dialogs (Press/Pull, …). */
  readonly sketchProfiles?: readonly ProfileOption[]
  /** Open-polyline path options from the live sketch — fed to path-picking dialogs (Pipe, Sweep, …). */
  readonly sketchPaths?: readonly PathOption[]
}

/** Map the dialog kind to its catalog/testid handle (used by the wrapper). */
export const FEATURE_DIALOG_HOST_TESTID = 'fd-host'

export function FeatureDialogHost({
  spec,
  selectionInfo,
  onAppendKernelOp,
  onScriptParams,
  busy,
  disabled,
  sketchProfiles = [],
  sketchPaths = []
}: FeatureDialogHostProps): JSX.Element {
  // Fan a dialog's single emit out to the matching existing sink.
  const handleApply = (change: FeatureDialogChange): void => {
    switch (change.target) {
      case 'kernelOp':
        onAppendKernelOp(change.op)
        return
      case 'scriptParams':
        onScriptParams(change.params)
        return
      default: {
        // Exhaustiveness guard — a new emit target must extend this switch.
        const _never: never = change
        void _never
      }
    }
  }

  const common = { selectionInfo, onApply: handleApply, busy, disabled } as const

  return (
    <div className="fd-host" data-testid={FEATURE_DIALOG_HOST_TESTID} data-fd-kind={spec.kind}>
      {renderDialog(spec, common, { profiles: sketchProfiles, paths: sketchPaths })}
    </div>
  )
}

/**
 * Render the dialog for a spec. Pulled out so the `kind` switch is exhaustive
 * and the typed params flow to exactly the matching dialog. The `common` bag
 * carries the shared base props.
 */
function renderDialog(
  spec: FeatureDialogSpec,
  common: {
    readonly selectionInfo: FeatureDialogSelectionInfo
    readonly onApply: (change: FeatureDialogChange) => void
    readonly busy?: boolean
    readonly disabled?: boolean
  },
  pickers: {
    readonly profiles: readonly ProfileOption[]
    readonly paths: readonly PathOption[]
  }
): JSX.Element {
  switch (spec.kind) {
    case 'extrude':
      return <ExtrudeDialog params={spec.params} {...common} />
    case 'revolve':
      return <RevolveDialog params={spec.params} {...common} />
    case 'fillet':
      return <FilletDialog params={spec.params} {...common} />
    case 'chamfer':
      return <ChamferDialog params={spec.params} {...common} />
    case 'shell':
      return <ShellDialog params={spec.params} {...common} />
    case 'hole':
      return <HoleDialog params={spec.params} {...common} />
    case 'datum_plane':
      return <DatumPlaneDialog params={spec.params} {...common} />
    case 'datum_axis':
      return <DatumAxisDialog params={spec.params} {...common} />
    case 'datum_point':
      return <DatumPointDialog params={spec.params} {...common} />
    case 'transform_translate':
      return <MoveCopyDialog params={spec.params} {...common} />
    case 'mirror_union_plane':
      return <MirrorDialog params={spec.params} {...common} />
    case 'split_keep_halfspace':
      return <SplitBodyDialog params={spec.params} {...common} />
    case 'pattern_rectangular':
      return <RectangularPatternDialog params={spec.params} {...common} />
    case 'pattern_circular':
      return <CircularPatternDialog params={spec.params} {...common} />
    case 'pattern_linear_3d':
      return <LinearPatternDialog params={spec.params} {...common} />
    case 'boolean_union_box':
      return <AddBoxDialog params={spec.params} {...common} />
    case 'boolean_subtract_box':
      return <CutBoxDialog params={spec.params} {...common} />
    case 'boolean_intersect_box':
      return <IntersectBoxDialog params={spec.params} {...common} />
    case 'boolean_subtract_cylinder':
      return <CutCylinderDialog params={spec.params} {...common} />
    case 'thread_wizard':
      return <ThreadDialog params={spec.params} {...common} />
    case 'thicken_offset':
      return <ThickenDialog params={spec.params} {...common} />
    case 'coil_cut':
      return <CoilDialog params={spec.params} {...common} />
    case 'plastic_rule_fillet':
      return <PlasticRuleFilletDialog params={spec.params} {...common} />
    case 'plastic_boss':
      return <PlasticBossDialog params={spec.params} {...common} />
    case 'plastic_lip_groove':
      return <PlasticLipGrooveDialog params={spec.params} {...common} />
    case 'press_pull_profile':
      return <PressPullProfileDialog params={spec.params} profiles={pickers.profiles} {...common} />
    case 'boolean_combine_profile':
      return <CombineProfileDialog params={spec.params} profiles={pickers.profiles} {...common} />
    case 'pipe_path':
      return <PipeDialog params={spec.params} paths={pickers.paths} {...common} />
    case 'pattern_path':
      return <PatternPathDialog params={spec.params} paths={pickers.paths} {...common} />
    case 'sweep_profile_path_true':
      return (
        <SweepDialog params={spec.params} profiles={pickers.profiles} paths={pickers.paths} {...common} />
      )
    default: {
      const _never: never = spec
      void _never
      return <></>
    }
  }
}

/** Re-export the kind type for hosts that pick a dialog dynamically. */
export type { FeatureDialogKind }

export default FeatureDialogHost
