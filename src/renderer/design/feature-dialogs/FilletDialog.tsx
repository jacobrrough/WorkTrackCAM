/**
 * FG-5b · Fillet property dialog.
 *
 * The CadQuery kernel's fillet has three real paths, all exposed here:
 *   - `fillet_all`    — round EVERY edge by `radiusMm`.
 *   - `fillet_select` by **axis bucket** (`edgeDirection: ±X/±Y/±Z`) — round the
 *     edges whose tangent is parallel to that world axis.
 *   - `fillet_select` by **picked edge** (FG-5b) — when the operator has an edge
 *     picked in the viewport AND it carries a STABLE `"e:<hex>"` id
 *     (`selection.occtHash`), the dialog emits `pickedEdgeIds: [id]` and the
 *     kernel rounds exactly that edge (resolving the id against the rebuilt
 *     solid; falls back to the axis bucket if it no longer resolves —
 *     topological-naming limit).
 *
 * So this dialog:
 *   1. Lets the operator round **all edges** or a **single axis bucket**, and
 *      emits the matching `KernelPostSolidOp` through the EXISTING
 *      `appendKernelOp` path.
 *   2. When a picked edge carries a stable id, layers `pickedEdgeIds` onto the
 *      `fillet_select` op so the pick drives the kernel for real.
 *   3. Reads the operator's live pick (`selectionInfo`) and shows it as context.
 *
 * Honest boundary: the viewport's face-tessellated raycast cannot yet originate
 * a single edge id from a triangle hit (the sidecar emits no per-triangle edge
 * array — see `Viewport3D.resolveSelectionFromPick`), so in practice an
 * EdgeSelection with a stable id arrives only from a surface that already holds
 * one. When no stable edge id is present the dialog uses the axis bucket and
 * never fakes a picked id reaching the kernel.
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
  resolvePickedEdgeIds,
  type EdgeDirection,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import { parsePositiveMm } from './feature-dialog-types'
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
 * Normalize the picked-edge-id argument (a single id, an id array, or null)
 * into a clean, deduped, non-empty `string[]` — or `null` when nothing usable
 * remains. Accepting BOTH a single id and an array keeps every pre-multi caller
 * (and its tests) working while the wave-4 multi-edge path passes an array.
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
 * Build the `KernelPostSolidOp` for the current dialog state. Exported pure so
 * the test can assert the emitted shape against `kernelPostSolidOpSchema`
 * without rendering.
 *
 * `mode: 'all'` always emits `fillet_all` (a picked id is meaningless there).
 * `mode: 'select'` emits `fillet_select` carrying the axis bucket; when
 * `pickedEdgeIds` resolves to one or more non-empty stable `"e:<hex>"` ids it
 * ALSO carries `pickedEdgeIds` (the kernel prefers them, with the bucket as the
 * documented fallback). MULTI-EDGE (wave 4): the arg accepts a single id OR an
 * array (Ctrl/Cmd-accumulated picks) — the schema's `pickedEdgeIds` is an array
 * of up to 256, so several picked edges drive ONE fillet. An empty / null id
 * omits the field (the schema rejects an empty `pickedEdgeIds` array — absence
 * means "use the axis bucket").
 */
export function buildFilletOp(
  radiusMm: number,
  mode: FilletMode,
  edgeDirection: EdgeDirection,
  pickedEdgeIds?: string | readonly string[] | null
): KernelPostSolidOp {
  if (mode === 'all') return { kind: 'fillet_all', radiusMm }
  const ids = normalizePickedEdgeIds(pickedEdgeIds)
  return ids
    ? { kind: 'fillet_select', radiusMm, edgeDirection, pickedEdgeIds: ids }
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

  // FG-5b + Tier-2 + wave-4 MULTI-EDGE: resolve EVERY accumulated edge pick
  // (Ctrl/Cmd-click) through the tiered resolver. A pick that MOVED / UNIFORMLY
  // RESIZED upstream recovers to its CURRENT stable id (Tier 2); an honest loss
  // drops from the set (counted for the read-out). Only meaningful in 'select'
  // mode ('all' rounds everything). A single pick is the one-id subset of this.
  const pickRes = resolvePickedEdgeIds(selectionInfo.selection, selectionInfo.currentPickIndex)
  const pickedEdgeIds = pickRes.ids
  const pickedCount = pickedEdgeIds.length

  const handleApply = (): void => {
    if (radius === null) return
    onApply({
      target: 'kernelOp',
      op: buildFilletOp(radius, mode, edgeDirection, mode === 'select' ? pickedEdgeIds : null)
    })
  }

  // Honest read-out tied to the operator's action AND the resolution tier:
  //   - one or more resolved edge picks (Tier 1 exact OR Tier 2 recovered) WILL
  //     drive the fillet in select mode (Tier 2 / lost counts are called out);
  //   - a pick honestly LOST after an edit explains why the axis bucket applies;
  //   - a non-edge pick / no stable id is context only (axis bucket applies).
  const edgeWord = pickedCount === 1 ? 'edge' : 'edges'
  const lostSuffix = pickRes.lostCount > 0 ? ` (${pickRes.lostCount} earlier pick${pickRes.lostCount === 1 ? '' : 's'} could not be re-matched after an edit and were dropped)` : ''
  const selectionNote =
    selectionInfo.selection === null
      ? undefined
      : pickedCount > 0
        ? mode === 'select'
          ? pickRes.tier2Count > 0
            ? `Filleting ${pickedCount} picked ${edgeWord} — ${pickRes.tier2Count} moved/resized upstream and ${pickRes.tier2Count === 1 ? 'was' : 'were'} re-identified by geometry signature (falls back to the axis bucket if one can’t be matched).${lostSuffix}`
            : `Filleting ${pickedCount} picked ${edgeWord} — the kernel resolves ${pickedCount === 1 ? 'it' : 'them'} at build (falls back to the axis bucket if one no longer matches).${lostSuffix}`
          : `Switch Edges to “By axis bucket” to fillet the picked ${edgeWord} by id; “All edges” rounds everything.`
        : pickRes.lostCount > 0
          ? `The picked ${pickRes.lostCount === 1 ? 'edge' : 'edges'} could not be re-matched after an edit, so the axis bucket below applies.`
          : selectionInfo.selection.kind === 'edge'
            ? 'This edge has no stable id yet (re-run the build to refresh), so the axis bucket below applies.'
            : 'Pick an edge to fillet it by id; this selection drives the axis bucket below instead.'

  return (
    <FeatureDialogCard title="Fillet" testId="fd-fillet">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Pick an edge to fillet, or round all edges / an axis bucket below."
        note={selectionNote}
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
