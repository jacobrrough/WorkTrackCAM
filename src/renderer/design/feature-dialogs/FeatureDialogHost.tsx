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
}

/** Map the dialog kind to its catalog/testid handle (used by the wrapper). */
export const FEATURE_DIALOG_HOST_TESTID = 'fd-host'

export function FeatureDialogHost({
  spec,
  selectionInfo,
  onAppendKernelOp,
  onScriptParams,
  busy,
  disabled
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
      {renderDialog(spec, common)}
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
