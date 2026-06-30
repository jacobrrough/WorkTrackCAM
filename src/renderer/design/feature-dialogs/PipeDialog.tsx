/**
 * Pipe property dialog — surfaces the `pipe_path` kernel op.
 *
 * The op sweeps a CIRCULAR section of `outerRadiusMm` along an OPEN sketch polyline (its world-mm
 * points become `pathPoints`), optionally hollowed to a tube by `wallThicknessMm`. It is a member of
 * `kernelPostSolidOpSchema`, so this dialog emits `{ target: 'kernelOp', op }` and the host appends
 * it via `appendKernelOp` (the same path as Fillet / Hole / Press-Pull).
 *
 * Picker: the path is chosen from a real labelled dropdown of the sketch's OPEN polylines
 * (`PathSelectField`, fed `paths` from `pathOptions(sketchDesign)`), not a blind point list. The
 * dialog holds the selected ENTITY ID (a string); on Apply it resolves that id back to the polyline's
 * `points` and stores them as `pathPoints`. When the sketch has no open polyline the field renders an
 * honest empty-state and Apply stays disabled — the dialog can never emit a path that doesn't exist.
 *
 * Honesty note (CLAUDE.md "do not fake capability"): `pipe_path` offers a `fixed_normal` orientation
 * mode that REQUIRES a `fixedNormal [x,y,z]` vector (schema refinement). This dialog does NOT expose a
 * fixed-normal vector input, so it offers only the two orientation modes that are valid without one —
 * `frenet` and `path_tangent_lock` — rather than letting the operator pick a mode the dialog can't
 * honour.
 */

import { useMemo, useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, DialogSelectField, FeatureDialogCard } from './FeatureDialogKit'
import { PathSelectField } from './ProfilePathFields'
import { parseFiniteMm, parsePositiveMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { PathOption } from './profile-path-options'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Orientation modes this dialog can honour (the `fixed_normal` mode needs a vector input we omit). */
export type PipeOrientationMode = 'frenet' | 'path_tangent_lock'

const ORIENTATION_OPTIONS: ReadonlyArray<{ readonly value: PipeOrientationMode; readonly label: string }> = [
  { value: 'frenet', label: 'Frenet (follow curve)' },
  { value: 'path_tangent_lock', label: 'Path tangent lock' }
]

export interface PipeDialogParams {
  /** Initial selected path entity id. */
  readonly pathId?: string
  /** Initial outer radius (mm, > 0). */
  readonly outerRadiusMm?: number
  /** Initial wall thickness (mm, > 0) — empty/absent means a solid rod (no hollow). */
  readonly wallThicknessMm?: number
  /** Initial Z-start (mm) of the path. */
  readonly zStartMm?: number
  /** Initial orientation-follow mode. */
  readonly orientationMode?: PipeOrientationMode
}

export interface PipeDialogProps extends FeatureDialogBaseProps {
  readonly params: PipeDialogParams
  /** Open-polyline options derived from the live sketch (`pathOptions`). */
  readonly paths: readonly PathOption[]
}

/**
 * Build the emitted `pipe_path` op. Exported pure for the op-builder test. `wallThicknessMm` is only
 * included when a positive value is supplied (a solid rod omits the key entirely).
 */
export function buildPipeOp(
  pathPoints: [number, number][],
  outerRadiusMm: number,
  zStartMm: number,
  orientationMode: PipeOrientationMode,
  wallThicknessMm: number | null
): KernelPostSolidOp {
  const op: KernelPostSolidOp = {
    kind: 'pipe_path',
    pathPoints,
    outerRadiusMm,
    zStartMm,
    orientationMode
  }
  if (wallThicknessMm !== null) {
    return { ...op, wallThicknessMm }
  }
  return op
}

export function PipeDialog({
  params,
  paths,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: PipeDialogProps): JSX.Element {
  void _selectionInfo // pipe is path + params driven; no face pick to resolve.
  const [pathId, setPathId] = useState<string | null>(params.pathId ?? paths[0]?.id ?? null)
  const [outerRaw, setOuterRaw] = useState(String(params.outerRadiusMm ?? 5))
  const [wallRaw, setWallRaw] = useState(params.wallThicknessMm != null ? String(params.wallThicknessMm) : '')
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))
  const [orientationMode, setOrientationMode] = useState<PipeOrientationMode>(
    params.orientationMode ?? 'frenet'
  )

  const selectedPath = useMemo(
    () => paths.find((p) => p.id === pathId) ?? paths[0] ?? null,
    [paths, pathId]
  )
  const outer = parsePositiveMm(outerRaw)
  const zStart = parseFiniteMm(zStartRaw)
  // Wall thickness is OPTIONAL: empty string = solid rod (valid). A non-empty value must parse to a
  // positive mm strictly LESS than the outer radius (schema refinement) to be acceptable.
  const wallEmpty = wallRaw.trim() === ''
  const wall = wallEmpty ? null : parsePositiveMm(wallRaw)
  const wallValid = wallEmpty || (wall !== null && outer !== null && wall < outer)

  const hasPaths = paths.length > 0
  const canApply =
    hasPaths &&
    selectedPath !== null &&
    outer !== null &&
    zStart !== null &&
    wallValid &&
    disabled !== true

  const handleApply = (): void => {
    if (!hasPaths || selectedPath === null || outer === null || zStart === null || !wallValid) return
    onApply({
      target: 'kernelOp',
      op: buildPipeOp(selectedPath.points, outer, zStart, orientationMode, wall)
    })
  }

  return (
    <FeatureDialogCard title="Pipe" testId="fd-pipe_path">
      <PathSelectField
        options={paths}
        value={pathId}
        onChange={setPathId}
        testId="fd-pipe_path-path"
        disabled={disabled}
      />
      <DialogNumberField
        label="Outer radius"
        value={outerRaw}
        onChange={setOuterRaw}
        testId="fd-pipe_path-outer"
        suffix="mm"
        step="any"
        min={0}
        disabled={disabled}
      />
      <DialogNumberField
        label="Wall thickness (optional)"
        value={wallRaw}
        onChange={setWallRaw}
        testId="fd-pipe_path-wall"
        suffix="mm"
        step="any"
        min={0}
        disabled={disabled}
      />
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-pipe_path-zstart"
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField
        label="Orientation"
        value={orientationMode}
        options={ORIENTATION_OPTIONS}
        onChange={setOrientationMode}
        testId="fd-pipe_path-orientation"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-pipe_path-note">
        Sweeps a circular section of the outer radius along the chosen open path. Leave wall thickness
        blank for a solid rod, or set it (less than the outer radius) for a hollow tube.
      </p>
      <DialogApplyRow
        label="Apply pipe"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !hasPaths
              ? 'Draw an open sketch polyline to use as the path first.'
              : outer === null
                ? 'Enter a positive outer radius in millimetres.'
                : !wallValid
                  ? 'Wall thickness must be a positive value less than the outer radius.'
                  : zStart === null
                    ? 'Enter a finite Z-start in millimetres.'
                    : undefined
        }
        testId="fd-pipe_path-apply"
      />
    </FeatureDialogCard>
  )
}

export default PipeDialog
