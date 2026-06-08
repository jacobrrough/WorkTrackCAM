/**
 * FG-5b · Chamfer property dialog.
 *
 * Same capability boundary as {@link FilletDialog}: the kernel chamfer is
 * axis-bucket, not picked-edge. `kernelPostSolidOpSchema` offers:
 *   - `chamfer_all`    — bevel EVERY edge by `lengthMm`.
 *   - `chamfer_select` — bevel the edges in an axis bucket (`edgeDirection`).
 *
 * The dialog exposes those two working modes, shows the operator's live pick as
 * context, and clearly flags (note + gap report) that picked-edge chamfer needs
 * new sidecar/kernel support. Emits the matching `KernelPostSolidOp` through the
 * existing `appendKernelOp` path.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  EdgeDirectionPicker,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parsePositiveMm,
  type EdgeDirection,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

type ChamferMode = 'all' | 'select'

export interface ChamferDialogParams {
  /** Initial chamfer length / setback (mm). */
  readonly lengthMm: number
  /** Initial mode — bevel all edges, or one axis bucket. Defaults to `'all'`. */
  readonly mode?: ChamferMode
  /** Initial axis bucket when mode is `'select'`. Defaults to `'+Z'`. */
  readonly edgeDirection?: EdgeDirection
}

export interface ChamferDialogProps extends FeatureDialogBaseProps {
  readonly params: ChamferDialogParams
}

/** Build the emitted `KernelPostSolidOp` for the dialog state (pure, testable). */
export function buildChamferOp(
  lengthMm: number,
  mode: ChamferMode,
  edgeDirection: EdgeDirection
): KernelPostSolidOp {
  return mode === 'all'
    ? { kind: 'chamfer_all', lengthMm }
    : { kind: 'chamfer_select', lengthMm, edgeDirection }
}

export function ChamferDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: ChamferDialogProps): JSX.Element {
  const [lengthRaw, setLengthRaw] = useState(String(params.lengthMm))
  const [mode, setMode] = useState<ChamferMode>(params.mode ?? 'all')
  const [edgeDirection, setEdgeDirection] = useState<EdgeDirection>(
    params.edgeDirection ?? '+Z'
  )

  const length = parsePositiveMm(lengthRaw)
  const canApply = length !== null && disabled !== true

  const handleApply = (): void => {
    if (length === null) return
    onApply({ target: 'kernelOp', op: buildChamferOp(length, mode, edgeDirection) })
  }

  const pickedEdgeNote =
    selectionInfo.selection !== null
      ? 'Picked-edge chamfer is not supported by the kernel yet — applying by axis bucket below. (Gap: needs new sidecar edge-id targeting.)'
      : undefined

  return (
    <FeatureDialogCard title="Chamfer" testId="fd-chamfer">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Pick an edge to chamfer, or bevel all edges / an axis bucket below."
        note={pickedEdgeNote}
        testId="fd-chamfer-selection"
      />
      <DialogNumberField
        label="Length"
        value={lengthRaw}
        onChange={setLengthRaw}
        testId="fd-chamfer-length"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField<ChamferMode>
        label="Edges"
        value={mode}
        options={[
          { value: 'all', label: 'All edges' },
          { value: 'select', label: 'By axis bucket' }
        ]}
        onChange={setMode}
        testId="fd-chamfer-mode"
        disabled={disabled}
      />
      {mode === 'select' && (
        <EdgeDirectionPicker
          value={edgeDirection}
          onChange={setEdgeDirection}
          testId="fd-chamfer-dir"
          disabled={disabled}
        />
      )}
      <DialogApplyRow
        label="Add chamfer"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : length === null
              ? 'Enter a positive length in millimetres.'
              : undefined
        }
        testId="fd-chamfer-apply"
      />
    </FeatureDialogCard>
  )
}

export default ChamferDialog
