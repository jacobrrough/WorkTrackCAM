/**
 * FG-5b · Shell property dialog.
 *
 * The kernel op is `shell_inward { thicknessMm, openDirection? }`. It hollows
 * the body to a wall thickness after removing ONE planar cap, where the cap is
 * chosen by an axis bucket (`openDirection: '+X' | '-X' | … | '-Z'`, default
 * `+Z`); the kernel tries the opposite cap if OCC rejects the first. As with
 * fillet/chamfer there is **no picked-face** targeting — you cannot hand the
 * kernel an arbitrary open face id.
 *
 * So the dialog exposes thickness + the axis-bucket open face (the working
 * path), reads the operator's live face pick as context, and flags that
 * picking the open face directly needs new kernel support. Emits `shell_inward`
 * through the existing `appendKernelOp` path.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
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

export interface ShellDialogParams {
  /** Initial wall thickness (mm). */
  readonly thicknessMm: number
  /** Initial open-face axis bucket. Defaults to `'+Z'` (matches kernel default). */
  readonly openDirection?: EdgeDirection
}

export interface ShellDialogProps extends FeatureDialogBaseProps {
  readonly params: ShellDialogParams
}

/** Build the emitted `shell_inward` op (pure, testable against the schema). */
export function buildShellOp(
  thicknessMm: number,
  openDirection: EdgeDirection
): KernelPostSolidOp {
  return { kind: 'shell_inward', thicknessMm, openDirection }
}

export function ShellDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: ShellDialogProps): JSX.Element {
  const [thicknessRaw, setThicknessRaw] = useState(String(params.thicknessMm))
  const [openDirection, setOpenDirection] = useState<EdgeDirection>(
    params.openDirection ?? '+Z'
  )

  const thickness = parsePositiveMm(thicknessRaw)
  const canApply = thickness !== null && disabled !== true

  const handleApply = (): void => {
    if (thickness === null) return
    onApply({ target: 'kernelOp', op: buildShellOp(thickness, openDirection) })
  }

  const pickedFaceNote =
    selectionInfo.selection !== null
      ? 'Picking the open face directly is not supported by the kernel yet — the cap is chosen by axis bucket below. (Gap: needs new sidecar face-id targeting.)'
      : undefined

  return (
    <FeatureDialogCard title="Shell" testId="fd-shell">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Pick the face to leave open, or choose an axis bucket below."
        note={pickedFaceNote}
        testId="fd-shell-selection"
      />
      <DialogNumberField
        label="Wall thickness"
        value={thicknessRaw}
        onChange={setThicknessRaw}
        testId="fd-shell-thickness"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <EdgeDirectionPicker
        value={openDirection}
        onChange={setOpenDirection}
        testId="fd-shell-dir"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-shell-note">
        Hollows the body to the wall thickness and opens the cap on the chosen
        axis. The kernel tries the opposite cap if the first is rejected.
      </p>
      <DialogApplyRow
        label="Add shell"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : thickness === null
              ? 'Enter a positive wall thickness in millimetres.'
              : undefined
        }
        testId="fd-shell-apply"
      />
    </FeatureDialogCard>
  )
}

export default ShellDialog
