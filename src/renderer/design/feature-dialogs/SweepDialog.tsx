/**
 * Sweep property dialog — surfaces the `sweep_profile_path_true` kernel op (a true sweep with
 * orientation-follow modes, as opposed to the simpler segment-wise `sweep_profile_path`).
 *
 * The op sweeps a sketch PROFILE (referenced by index into the auto-detected closed-profile list)
 * along an open sketch PATH (the world-mm point list of an open polyline) and unions the result into
 * the implicit current solid. It is a member of `kernelPostSolidOpSchema`, so this dialog emits
 * `{ target: 'kernelOp', op }` and the host appends it via `appendKernelOp` (the same path as
 * Fillet/Hole/Press-Pull).
 *
 * TWO real pickers, both fed from sketch-derived dropdowns (never blind indices):
 *   - {@link ProfileSelectField} — the closed profile, stored on the op as `profileIndex`.
 *   - {@link PathSelectField}    — the open path; the dialog holds the path ENTITY ID (a string),
 *     then resolves it to its `points` on Apply and emits them as `pathPoints`. Holding the id (not
 *     the points) keeps the selection stable across re-renders and means a stale id can never emit.
 *
 * `orientationMode` is the op's real enum (`frenet` default · `path_tangent_lock` · `fixed_normal`).
 * The schema REQUIRES a `fixedNormal` vec3 ONLY in `fixed_normal` mode, so this dialog reveals the
 * three normal fields exactly then and gates Apply until all three are finite — it can never emit a
 * `fixed_normal` op without its normal, nor attach a meaningless normal to the other modes.
 *
 * Honest gating (CLAUDE.md "do not fake capability"): when the sketch has no closed profile OR no
 * open path, the matching field renders an honest empty-state and Apply stays disabled — the dialog
 * never emits a `profileIndex` / `pathPoints` that doesn't exist.
 */

import { useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, DialogSelectField, FeatureDialogCard } from './FeatureDialogKit'
import { PathSelectField, ProfileSelectField } from './ProfilePathFields'
import { parseFiniteMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { PathOption, ProfileOption } from './profile-path-options'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/**
 * The orientation-follow modes of `sweep_profile_path_true` (mirrors the schema's
 * `sweepOrientationModeSchema = z.enum(['fixed_normal', 'frenet', 'path_tangent_lock'])`, which is
 * not exported from the schema module). `fixed_normal` additionally requires a `fixedNormal` vec3.
 */
export type SweepOrientationMode = 'fixed_normal' | 'frenet' | 'path_tangent_lock'

/** Human labels for the orientation-mode dropdown. */
const ORIENTATION_OPTIONS: ReadonlyArray<{ readonly value: SweepOrientationMode; readonly label: string }> = [
  { value: 'frenet', label: 'Frenet (follow curve)' },
  { value: 'path_tangent_lock', label: 'Path tangent (locked up)' },
  { value: 'fixed_normal', label: 'Fixed normal (vector)' }
]

export interface SweepDialogParams {
  /** Initial selected profile index. */
  readonly profileIndex?: number
  /** Initial selected path entity id (defaults to the first path option). */
  readonly pathId?: string
  /** Initial Z-start (mm) of the profile. Defaults to 0. */
  readonly zStartMm?: number
  /** Initial orientation-follow mode. Defaults to `frenet`. */
  readonly orientationMode?: SweepOrientationMode
  /** Initial fixed-normal vector (only used in `fixed_normal` mode). */
  readonly fixedNormal?: readonly [number, number, number]
}

export interface SweepDialogProps extends FeatureDialogBaseProps {
  readonly params: SweepDialogParams
  /** Closed-profile options derived from the live sketch (`profileOptions`). */
  readonly profiles: readonly ProfileOption[]
  /** Open-path options derived from the live sketch (`pathOptions`). */
  readonly paths: readonly PathOption[]
}

/**
 * Build the emitted `sweep_profile_path_true` op. Exported pure for the op-builder test so it can
 * round-trip the result through the REAL `kernelPostSolidOpSchema` without rendering.
 *
 * `fixedNormal` is included ONLY in `fixed_normal` mode (the schema refinement requires it there and
 * it is meaningless otherwise), so the caller passes the parsed vec3 only when that mode is active.
 */
export function buildSweepOp(args: {
  readonly profileIndex: number
  readonly pathPoints: [number, number][]
  readonly zStartMm: number
  readonly orientationMode: SweepOrientationMode
  readonly fixedNormal?: [number, number, number]
}): KernelPostSolidOp {
  const op = {
    kind: 'sweep_profile_path_true' as const,
    profileIndex: args.profileIndex,
    pathPoints: args.pathPoints,
    zStartMm: args.zStartMm,
    orientationMode: args.orientationMode
  }
  return args.orientationMode === 'fixed_normal' && args.fixedNormal !== undefined
    ? { ...op, fixedNormal: args.fixedNormal }
    : op
}

export function SweepDialog({
  params,
  profiles,
  paths,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: SweepDialogProps): JSX.Element {
  void _selectionInfo // sweep is profile + path + params driven; no face pick to resolve.

  const [profileIndex, setProfileIndex] = useState<number>(params.profileIndex ?? 0)
  const [pathId, setPathId] = useState<string | null>(params.pathId ?? paths[0]?.id ?? null)
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))
  const [orientationMode, setOrientationMode] = useState<SweepOrientationMode>(
    params.orientationMode ?? 'frenet'
  )
  const [nxRaw, setNxRaw] = useState(String(params.fixedNormal?.[0] ?? 0))
  const [nyRaw, setNyRaw] = useState(String(params.fixedNormal?.[1] ?? 0))
  const [nzRaw, setNzRaw] = useState(String(params.fixedNormal?.[2] ?? 1))

  const zStart = parseFiniteMm(zStartRaw)
  const nx = parseFiniteMm(nxRaw)
  const ny = parseFiniteMm(nyRaw)
  const nz = parseFiniteMm(nzRaw)

  const hasProfiles = profiles.length > 0
  const hasPaths = paths.length > 0
  const isFixedNormal = orientationMode === 'fixed_normal'
  const normalOk = !isFixedNormal || (nx !== null && ny !== null && nz !== null)

  const canApply =
    hasProfiles && hasPaths && zStart !== null && normalOk && disabled !== true

  const handleApply = (): void => {
    if (!hasProfiles || !hasPaths || zStart === null) return
    const sel = paths.find((p) => p.id === pathId)
    if (!sel) return
    if (isFixedNormal && (nx === null || ny === null || nz === null)) return
    onApply({
      target: 'kernelOp',
      op: buildSweepOp({
        profileIndex,
        pathPoints: sel.points,
        zStartMm: zStart,
        orientationMode,
        fixedNormal: isFixedNormal && nx !== null && ny !== null && nz !== null ? [nx, ny, nz] : undefined
      })
    })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : !hasProfiles
        ? 'Draw a closed sketch profile to sweep first.'
        : !hasPaths
          ? 'Draw an open sketch polyline to sweep along first.'
          : zStart === null
            ? 'Enter a finite Z-start in millimetres.'
            : isFixedNormal && !normalOk
              ? 'Enter a finite fixed-normal vector (X, Y, Z).'
              : undefined

  return (
    <FeatureDialogCard title="Sweep" testId="fd-sweep_profile_path_true">
      <ProfileSelectField
        options={profiles}
        value={profileIndex}
        onChange={setProfileIndex}
        testId="fd-sweep_profile_path_true-profile"
        disabled={disabled}
      />
      <PathSelectField
        options={paths}
        value={pathId}
        onChange={setPathId}
        testId="fd-sweep_profile_path_true-path"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-sweep_profile_path_true-zstart"
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField
        label="Orientation"
        value={orientationMode}
        options={ORIENTATION_OPTIONS}
        onChange={setOrientationMode}
        testId="fd-sweep_profile_path_true-orientation"
        disabled={disabled}
      />
      {isFixedNormal && (
        <>
          <DialogNumberField
            label="Normal X"
            value={nxRaw}
            onChange={setNxRaw}
            testId="fd-sweep_profile_path_true-nx"
            disabled={disabled}
          />
          <DialogNumberField
            label="Normal Y"
            value={nyRaw}
            onChange={setNyRaw}
            testId="fd-sweep_profile_path_true-ny"
            disabled={disabled}
          />
          <DialogNumberField
            label="Normal Z"
            value={nzRaw}
            onChange={setNzRaw}
            testId="fd-sweep_profile_path_true-nz"
            disabled={disabled}
          />
        </>
      )}
      <p className="fd-note" data-testid="fd-sweep_profile_path_true-note">
        Sweeps the chosen profile along the chosen open path and unions it into the current solid.
        Frenet follows the curve, path-tangent locks the up-vector, fixed-normal uses the entered
        vector. Rebuilds via the kernel timeline.
      </p>
      <DialogApplyRow
        label="Apply sweep"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-sweep_profile_path_true-apply"
      />
    </FeatureDialogCard>
  )
}

export default SweepDialog
