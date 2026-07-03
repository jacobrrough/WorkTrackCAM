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
  resolvePickedEdgeIds,
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
 * Normalize the picked-edge-id argument (a single id, an id array, or null)
 * into a clean, deduped, non-empty `string[]` — or `null`. Mirrors
 * {@link buildFilletOp}'s helper so both dialogs accept a single id (pre-multi
 * callers + tests) OR an array (wave-4 multi-edge accumulation).
 */
function normalizePickedEdgeIds(
  pickedEdgeIds: string | readonly string[] | null | undefined
): string[] | null {
  if (pickedEdgeIds === null || pickedEdgeIds === undefined) return null
  const raw = typeof pickedEdgeIds === 'string' ? [pickedEdgeIds] : pickedEdgeIds
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out.length > 0 ? out : null
}

/**
 * Build the emitted `KernelPostSolidOp` for the dialog state (pure, testable).
 * Mirrors {@link buildFilletOp}: `'select'` mode layers `pickedEdgeIds` onto
 * `chamfer_select` when the arg resolves to one or more non-empty stable
 * `"e:<hex>"` ids, with the axis bucket as the documented fallback. MULTI-EDGE
 * (wave 4): the arg accepts a single id OR an array (Ctrl/Cmd-accumulated
 * picks); an empty / null id omits the field (the schema rejects an empty array).
 */
export function buildChamferOp(
  lengthMm: number,
  mode: ChamferMode,
  edgeDirection: EdgeDirection,
  pickedEdgeIds?: string | readonly string[] | null
): KernelPostSolidOp {
  if (mode === 'all') return { kind: 'chamfer_all', lengthMm }
  const ids = normalizePickedEdgeIds(pickedEdgeIds)
  return ids
    ? { kind: 'chamfer_select', lengthMm, edgeDirection, pickedEdgeIds: ids }
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

  // FG-5b + Tier-2 + wave-4 MULTI-EDGE: resolve EVERY accumulated edge pick
  // through the tiered resolver (see FilletDialog). Moved/resized picks recover
  // to their current id (Tier 2); honest losses drop from the set (counted).
  const pickRes = resolvePickedEdgeIds(selectionInfo.selection, selectionInfo.currentPickIndex)
  const pickedEdgeIds = pickRes.ids
  const pickedCount = pickedEdgeIds.length

  const handleApply = (): void => {
    if (length === null) return
    onApply({
      target: 'kernelOp',
      op: buildChamferOp(length, mode, edgeDirection, mode === 'select' ? pickedEdgeIds : null)
    })
  }

  const edgeWord = pickedCount === 1 ? 'edge' : 'edges'
  const lostSuffix = pickRes.lostCount > 0 ? ` (${pickRes.lostCount} earlier pick${pickRes.lostCount === 1 ? '' : 's'} could not be re-matched after an edit and were dropped)` : ''
  const selectionNote =
    selectionInfo.selection === null
      ? undefined
      : pickedCount > 0
        ? mode === 'select'
          ? pickRes.tier2Count > 0
            ? `Chamfering ${pickedCount} picked ${edgeWord} — ${pickRes.tier2Count} moved/resized upstream and ${pickRes.tier2Count === 1 ? 'was' : 'were'} re-identified by geometry signature (falls back to the axis bucket if one can’t be matched).${lostSuffix}`
            : `Chamfering ${pickedCount} picked ${edgeWord} — the kernel resolves ${pickedCount === 1 ? 'it' : 'them'} at build (falls back to the axis bucket if one no longer matches).${lostSuffix}`
          : `Switch Edges to “By axis bucket” to chamfer the picked ${edgeWord} by id; “All edges” bevels everything.`
        : pickRes.lostCount > 0
          ? `The picked ${pickRes.lostCount === 1 ? 'edge' : 'edges'} could not be re-matched after an edit, so the axis bucket below applies.`
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
