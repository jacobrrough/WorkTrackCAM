/**
 * FG-5b · Shell property dialog.
 *
 * The kernel op is `shell_inward { thicknessMm, openDirection?, pickedFaceIds? }`.
 * It hollows the body to a wall thickness after removing ONE planar cap. The cap
 * is chosen one of two ways:
 *   1. **Picked face** (FG-5b) — when the operator has a face picked in the
 *      viewport AND it carries a STABLE `"f:<hex>"` id (`selection.occtHash`),
 *      the dialog emits `pickedFaceIds: [id]` and the kernel opens exactly that
 *      cap (resolving the id against the rebuilt solid; falls back to the axis
 *      bucket if it no longer resolves — topological-naming limit).
 *   2. **Axis bucket** — the always-available default (`openDirection`, default
 *      `+Z`); the kernel tries the opposite cap if OCC rejects the first.
 *
 * Emits `shell_inward` through the existing `appendKernelOp` path.
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
  resolvePickedSelectionId,
  type EdgeDirection,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import { pickLostMessage } from '../../../shared/kernel-pick-file'
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

/**
 * Build the emitted `shell_inward` op (pure, testable against the schema).
 *
 * When `pickedFaceId` is a non-empty stable `"f:<hex>"` id, the op carries
 * `pickedFaceIds: [pickedFaceId]` so the kernel opens that exact cap; the
 * `openDirection` axis bucket is always present as the documented fallback.
 * A `null` / empty `pickedFaceId` omits the field entirely (the schema rejects
 * an empty `pickedFaceIds` array — absence means "use the axis bucket").
 */
export function buildShellOp(
  thicknessMm: number,
  openDirection: EdgeDirection,
  pickedFaceId?: string | null
): KernelPostSolidOp {
  return pickedFaceId
    ? { kind: 'shell_inward', thicknessMm, openDirection, pickedFaceIds: [pickedFaceId] }
    : { kind: 'shell_inward', thicknessMm, openDirection }
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

  // FG-5b + Tier-2: route the live face pick through the tiered resolver so a
  // face that MOVED / UNIFORMLY RESIZED upstream recovers to its current stable
  // id (Tier 2); an honest loss falls back to the axis-bucket cap.
  const pickRes = resolvePickedSelectionId(
    selectionInfo.selection,
    'face',
    selectionInfo.currentPickIndex
  )
  const pickedFaceId = pickRes.id

  const handleApply = (): void => {
    if (thickness === null) return
    onApply({ target: 'kernelOp', op: buildShellOp(thickness, openDirection, pickedFaceId) })
  }

  // Honest read-out: the picked face DRIVES the open cap when it resolves (Tier 1
  // exact OR Tier 2 recovered); a pick honestly lost after an edit explains the
  // axis-bucket fallback; a picked-but-unstable face is context only.
  const selectionNote =
    selectionInfo.selection !== null
      ? pickedFaceId !== null
        ? pickRes.tier === 2
          ? 'Opening the picked face — it moved/resized upstream and was re-identified by its geometry signature (falls back to the axis bucket if it can’t be matched).'
          : 'Opening the picked face — the kernel resolves it at build (falls back to the axis bucket if it no longer matches).'
        : pickRes.reason !== undefined
          ? pickLostMessage(pickRes.reason)
          : 'This pick has no stable id yet (re-run the build to refresh), so the cap is chosen by the axis bucket below.'
      : undefined

  return (
    <FeatureDialogCard title="Shell" testId="fd-shell">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Pick the face to leave open, or choose an axis bucket below."
        note={selectionNote}
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
        {pickedFaceId !== null
          ? 'Hollows the body to the wall thickness, opening the picked face. The axis bucket below is the fallback if the picked face cannot be resolved.'
          : 'Hollows the body to the wall thickness and opens the cap on the chosen axis. The kernel tries the opposite cap if the first is rejected.'}
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
