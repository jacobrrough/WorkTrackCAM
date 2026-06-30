/**
 * Pattern Along Path property dialog — surfaces the `pattern_path` kernel op.
 *
 * The op lays out `count` copies of the CURRENT solid along a polyline PATH in sketch/world XY:
 * each copy is translated to a point sampled at equal arc-length along the path (the first copy is
 * the unchanged original at the path start). Optional `closedPath` adds a closing segment from the
 * last point back to the first when computing arc length; optional `alignToPathTangent` rotates each
 * copy about +Z so its local +X follows the path tangent at the sample. It is a member of
 * `kernelPostSolidOpSchema`, so this dialog emits `{ target: 'kernelOp', op }` and the host appends
 * it via `appendKernelOp` (the same path as Linear Pattern / Press-Pull).
 *
 * Picker: the path is chosen from a real labelled dropdown of the sketch's OPEN polylines
 * (`PathSelectField`, fed `paths` from `pathOptions(sketchDesign)`), holding the source ENTITY ID.
 * On Apply the dialog looks the id back up and emits the resolved `pathPoints` — so the op always
 * carries real points, never a dangling id. When the sketch has no open polyline the field renders
 * an honest empty-state and Apply stays disabled. There is no profile input: `pattern_path` operates
 * on the whole current solid and is path-only (see `patternPathSchema`), so showing a profile picker
 * would be dishonest.
 *
 * Honest boundary (CLAUDE.md "do not fake capability"): the schema requires a count in [2, 32], at
 * least one non-zero path segment, and — when `closedPath` is on — at least 3 path points. The
 * dialog gates Apply on the count, the path's point count under `closedPath`, and the same non-zero
 * segment rule the kernel enforces, so it can never emit an op the kernel would reject.
 */

import { useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, FeatureDialogCard } from './FeatureDialogKit'
import { PathSelectField } from './ProfilePathFields'
import { parseClampedInt, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { PathOption } from './profile-path-options'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Schema bounds for the instance count (mirrors `patternPathSchema`). */
const COUNT_MIN = 2
const COUNT_MAX = 32

export interface PatternPathDialogParams {
  /** Initial instance count (includes the original at the path start). Clamped to [2, 32]. */
  readonly count?: number
  /** Initial closing-segment toggle (arc length wraps last→first). */
  readonly closedPath?: boolean
  /** Initial tangent-alignment toggle (rotate each copy to follow the path). */
  readonly alignToPathTangent?: boolean
}

export interface PatternPathDialogProps extends FeatureDialogBaseProps {
  readonly params: PatternPathDialogParams
  /** Open-polyline path options derived from the live sketch (`pathOptions`). */
  readonly paths: readonly PathOption[]
}

/** True when at least one consecutive path segment is non-zero (mirrors the schema refine). */
function hasNonZeroSegment(points: readonly [number, number][]): boolean {
  return points.some(([x, y], i) => {
    if (i === 0) return false
    const [px, py] = points[i - 1]!
    return x !== px || y !== py
  })
}

/**
 * Build the emitted `pattern_path` op. The optional `closedPath` / `alignToPathTangent` flags are
 * omitted when false so the op stays minimal (the schema marks both `.optional()`). Exported pure
 * for the op-builder test; the caller gates on validity (count range, point count, non-zero segment).
 */
export function buildPatternPathOp(
  count: number,
  pathPoints: [number, number][],
  closedPath: boolean,
  alignToPathTangent: boolean
): KernelPostSolidOp {
  return {
    kind: 'pattern_path',
    count,
    pathPoints,
    ...(closedPath ? { closedPath: true } : {}),
    ...(alignToPathTangent ? { alignToPathTangent: true } : {})
  }
}

export function PatternPathDialog({
  params,
  paths,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: PatternPathDialogProps): JSX.Element {
  void _selectionInfo // pattern-along-path operates on the whole solid; no face/edge pick to resolve.
  const [countRaw, setCountRaw] = useState(String(params.count ?? 4))
  // Selected path ENTITY ID. `null` means "fall back to the first option" (see `selectedId`).
  const [pathId, setPathId] = useState<string | null>(null)
  const [closedPath, setClosedPath] = useState<boolean>(params.closedPath ?? false)
  const [alignToPathTangent, setAlignToPathTangent] = useState<boolean>(
    params.alignToPathTangent ?? false
  )

  const count = parseClampedInt(countRaw, COUNT_MIN, COUNT_MAX)
  const hasPaths = paths.length > 0
  const selectedId = pathId ?? paths[0]?.id ?? null
  const selected = selectedId !== null ? paths.find((p) => p.id === selectedId) : undefined
  const points = selected?.points
  // closedPath needs ≥3 points (the schema rejects a closed 2-point path).
  const closedOk = !closedPath || (points !== undefined && points.length >= 3)
  const segmentOk = points !== undefined && hasNonZeroSegment(points)
  const canApply =
    hasPaths &&
    count !== null &&
    points !== undefined &&
    closedOk &&
    segmentOk &&
    disabled !== true

  const handleApply = (): void => {
    if (count === null || selectedId === null) return
    const sel = paths.find((p) => p.id === selectedId)
    if (!sel) return
    if (closedPath && sel.points.length < 3) return
    if (!hasNonZeroSegment(sel.points)) return
    onApply({
      target: 'kernelOp',
      op: buildPatternPathOp(count, sel.points, closedPath, alignToPathTangent)
    })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : !hasPaths
        ? 'Draw an open sketch polyline to use as the path first.'
        : count === null
          ? `Enter an instance count between ${COUNT_MIN} and ${COUNT_MAX}.`
          : !segmentOk
            ? 'The chosen path has no length — pick a polyline with a non-zero segment.'
            : !closedOk
              ? 'A closed path needs at least 3 points — turn off “closed” or pick a longer path.'
              : undefined

  return (
    <FeatureDialogCard title="Pattern Along Path" testId="fd-pattern_path">
      <DialogNumberField
        label="Count"
        value={countRaw}
        onChange={setCountRaw}
        testId="fd-pattern_path-count"
        step="1"
        min={COUNT_MIN}
        disabled={disabled}
      />
      <PathSelectField
        options={paths}
        value={selectedId}
        onChange={setPathId}
        testId="fd-pattern_path-path"
        disabled={disabled}
      />
      <label className="fd-field fd-pattern_path__toggle" data-testid="fd-pattern_path-closed-field">
        <input
          type="checkbox"
          data-testid="fd-pattern_path-closed"
          checked={closedPath}
          disabled={disabled}
          onChange={(e) => setClosedPath(e.target.checked)}
        />
        Closed path (wrap arc length from last point to first)
      </label>
      <label className="fd-field fd-pattern_path__toggle" data-testid="fd-pattern_path-align-field">
        <input
          type="checkbox"
          data-testid="fd-pattern_path-align"
          checked={alignToPathTangent}
          disabled={disabled}
          onChange={(e) => setAlignToPathTangent(e.target.checked)}
        />
        Align copies to the path tangent
      </label>
      <p className="fd-note" data-testid="fd-pattern_path-note">
        Lays out the chosen count of copies of the current solid at equal arc-length samples along
        the selected sketch polyline, then rebuilds.
      </p>
      <DialogApplyRow
        label="Add path pattern"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-pattern_path-apply"
      />
    </FeatureDialogCard>
  )
}

export default PatternPathDialog
