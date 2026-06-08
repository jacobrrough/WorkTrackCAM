/**
 * FG-5b · Chamfer property dialog.
 *
 * Same three real paths as {@link FilletDialog}, all exposed here:
 *   - `chamfer_all`    — bevel EVERY edge by `lengthMm`.
 *   - `chamfer_select` by **axis bucket** (`edgeDirection`) — bevel the edges
 *     parallel to that world axis.
 *   - `chamfer_select` by **picked edge** (FG-5b) — when the operator has an edge
 *     picked carrying a STABLE `"e:<hex>"` id (`selection.occtHash`), the dialog
 *     emits `pickedEdgeIds: [id]` and the kernel bevels exactly that edge
 *     (falling back to the axis bucket if it no longer resolves).
 *
 * Emits the matching `KernelPostSolidOp` through the existing `appendKernelOp`
 * path. Same honest boundary as Fillet: the face-tessellated raycast cannot yet
 * originate a single edge id, so a stable-id EdgeSelection arrives only from a
 * surface that already holds one; absent that, the axis bucket applies and no
 * picked id is faked.
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
  pickedOcctIdFor,
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

/**
 * Build the emitted `KernelPostSolidOp` for the dialog state (pure, testable).
 * Mirrors {@link buildFilletOp}: `'select'` mode layers `pickedEdgeIds` onto
 * `chamfer_select` when `pickedEdgeId` is a non-empty stable `"e:<hex>"` id,
 * with the axis bucket as the documented fallback; an empty / null id omits the
 * field (the schema rejects an empty array).
 */
export function buildChamferOp(
  lengthMm: number,
  mode: ChamferMode,
  edgeDirection: EdgeDirection,
  pickedEdgeId?: string | null
): KernelPostSolidOp {
  if (mode === 'all') return { kind: 'chamfer_all', lengthMm }
  return pickedEdgeId
    ? { kind: 'chamfer_select', lengthMm, edgeDirection, pickedEdgeIds: [pickedEdgeId] }
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

  // FG-5b: an edge pick carrying a stable "e:<hex>" id drives chamfer_select by id.
  const pickedEdgeId = pickedOcctIdFor(selectionInfo.selection, 'edge')

  const handleApply = (): void => {
    if (length === null) return
    onApply({
      target: 'kernelOp',
      op: buildChamferOp(length, mode, edgeDirection, mode === 'select' ? pickedEdgeId : null)
    })
  }

  const selectionNote =
    selectionInfo.selection === null
      ? undefined
      : pickedEdgeId !== null
        ? mode === 'select'
          ? 'Chamfering the picked edge — the kernel resolves it at build (falls back to the axis bucket if it no longer matches).'
          : 'Switch Edges to “By axis bucket” to chamfer the picked edge by id; “All edges” bevels everything.'
        : selectionInfo.selection.kind === 'edge'
          ? 'This edge has no stable id yet (re-run the build to refresh), so the axis bucket below applies.'
          : 'Pick an edge to chamfer it by id; this selection drives the axis bucket below instead.'

  return (
    <FeatureDialogCard title="Chamfer" testId="fd-chamfer">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Pick an edge to chamfer, or bevel all edges / an axis bucket below."
        note={selectionNote}
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
