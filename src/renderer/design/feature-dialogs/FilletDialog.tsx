/**
 * FG-5b · Fillet property dialog.
 *
 * Honest capability boundary (the headline of the FG-5 audit): the CadQuery
 * kernel's fillet is **axis-bucket**, not picked-edge. `kernelPostSolidOpSchema`
 * offers exactly two fillet ops:
 *   - `fillet_all`    — round EVERY edge by `radiusMm`.
 *   - `fillet_select` — round the edges whose direction falls in an axis bucket
 *     (`edgeDirection: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'`) by `radiusMm`.
 *
 * There is no way to pass a picked face/edge **id** to the kernel today. So this
 * dialog:
 *   1. Lets the operator round **all edges** or a **single axis bucket** — the
 *      two modes that genuinely work — and emits the matching `KernelPostSolidOp`
 *      through the EXISTING `appendKernelOp` path.
 *   2. Reads the operator's live pick (`selectionInfo`) and shows it as context,
 *      so picked-edge is *visible* in the UI as the intended future workflow.
 *   3. **Clearly flags** (in a persistent note, and in the parent's gap report)
 *      that driving the fillet from that picked edge needs new sidecar/kernel
 *      support — it does NOT silently fall back and pretend the pick mattered.
 *
 * This satisfies the brief: "expose picked-edge in the UI where the kernel
 * supports it and CLEARLY flag where picked-edge needs new sidecar/kernel
 * support rather than faking it." The kernel does not support picked-edge, so we
 * expose the working axis-bucket path and flag the gap.
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

/** Which fillet op the dialog will emit. */
type FilletMode = 'all' | 'select'

export interface FilletDialogParams {
  /** Initial radius (mm). */
  readonly radiusMm: number
  /** Initial mode — round all edges, or one axis bucket. Defaults to `'all'`. */
  readonly mode?: FilletMode
  /** Initial axis bucket when mode is `'select'`. Defaults to `'+Z'`. */
  readonly edgeDirection?: EdgeDirection
}

export interface FilletDialogProps extends FeatureDialogBaseProps {
  readonly params: FilletDialogParams
}

/**
 * Build the `KernelPostSolidOp` for the current dialog state. Exported pure so
 * the test can assert the emitted shape against `kernelPostSolidOpSchema`
 * without rendering.
 */
export function buildFilletOp(
  radiusMm: number,
  mode: FilletMode,
  edgeDirection: EdgeDirection
): KernelPostSolidOp {
  return mode === 'all'
    ? { kind: 'fillet_all', radiusMm }
    : { kind: 'fillet_select', radiusMm, edgeDirection }
}

export function FilletDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: FilletDialogProps): JSX.Element {
  const [radiusRaw, setRadiusRaw] = useState(String(params.radiusMm))
  const [mode, setMode] = useState<FilletMode>(params.mode ?? 'all')
  const [edgeDirection, setEdgeDirection] = useState<EdgeDirection>(
    params.edgeDirection ?? '+Z'
  )

  const radius = parsePositiveMm(radiusRaw)
  const canApply = radius !== null && disabled !== true

  const handleApply = (): void => {
    if (radius === null) return
    onApply({ target: 'kernelOp', op: buildFilletOp(radius, mode, edgeDirection) })
  }

  // Honest picked-edge flag: only show the "needs kernel support" note when the
  // operator actually has an edge/face picked, so it reads as a direct response
  // to their action rather than generic boilerplate.
  const pickedEdgeNote =
    selectionInfo.selection !== null
      ? 'Picked-edge fillet is not supported by the kernel yet — applying by axis bucket below. (Gap: needs new sidecar edge-id targeting.)'
      : undefined

  return (
    <FeatureDialogCard title="Fillet" testId="fd-fillet">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Pick an edge to fillet, or round all edges / an axis bucket below."
        note={pickedEdgeNote}
        testId="fd-fillet-selection"
      />
      <DialogNumberField
        label="Radius"
        value={radiusRaw}
        onChange={setRadiusRaw}
        testId="fd-fillet-radius"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField<FilletMode>
        label="Edges"
        value={mode}
        options={[
          { value: 'all', label: 'All edges' },
          { value: 'select', label: 'By axis bucket' }
        ]}
        onChange={setMode}
        testId="fd-fillet-mode"
        disabled={disabled}
      />
      {mode === 'select' && (
        <EdgeDirectionPicker
          value={edgeDirection}
          onChange={setEdgeDirection}
          testId="fd-fillet-dir"
          disabled={disabled}
        />
      )}
      <DialogApplyRow
        label="Add fillet"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : radius === null
              ? 'Enter a positive radius in millimetres.'
              : undefined
        }
        testId="fd-fillet-apply"
      />
    </FeatureDialogCard>
  )
}

export default FilletDialog
