/**
 * Combine Profile property dialog — surfaces the `boolean_combine_profile` kernel op.
 *
 * The op builds a SECOND body from a sketch PROFILE (referenced by index into the auto-detected
 * profile list) linearly extruded `extrudeDepthMm` along +Z (default) or −Z from `zStartMm`, then
 * combines it with the implicit CURRENT solid by `mode` (union adds, subtract cuts, intersect keeps
 * the overlap). It is a member of `kernelPostSolidOpSchema`, so this dialog emits
 * `{ target: 'kernelOp', op }` and the host appends it via `appendKernelOp` (the same path as
 * Fillet/Hole/Press-Pull).
 *
 * Picker: the profile is chosen from a real labelled dropdown of the sketch's closed profiles
 * (`ProfileSelectField`, fed `profiles` from `profileOptions(sketchDesign)`) — never a blind numeric
 * index. When the sketch has no closed profile the field renders an honest empty-state and Apply
 * stays disabled, so the dialog can never emit a `profileIndex` that doesn't exist. The op has NO
 * path input (it extrudes a profile, it does not sweep), so there is intentionally no PathSelectField.
 *
 * Honesty (CLAUDE.md "never fake capability"): `extrudeDirection` is OPTIONAL in the schema — absence
 * means the kernel's default +Z. The direction selector therefore offers a real "(default +Z)" choice
 * that OMITS the field from the emitted op, instead of always writing `+Z` and pretending the operator
 * made that call. Every other param the op needs is fully driven here; nothing is left unexposed.
 */

import { useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, DialogSelectField, FeatureDialogCard } from './FeatureDialogKit'
import { ProfileSelectField } from './ProfilePathFields'
import { parseFiniteMm, parsePositiveMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { ProfileOption } from './profile-path-options'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

const TEST_PREFIX = 'fd-boolean_combine_profile'

/** The combine mode the op stores (matches the schema enum exactly). */
export type CombineMode = 'union' | 'subtract' | 'intersect'

const MODE_OPTIONS: ReadonlyArray<{ readonly value: CombineMode; readonly label: string }> = [
  { value: 'union', label: 'Union (add the tool body)' },
  { value: 'subtract', label: 'Subtract (cut the tool body)' },
  { value: 'intersect', label: 'Intersect (keep the overlap)' }
]

/** The explicit extrude direction, plus the sentinel that OMITS the optional field (kernel default +Z). */
type DirectionChoice = 'default' | '+Z' | '-Z'

const DIRECTION_OPTIONS: ReadonlyArray<{ readonly value: DirectionChoice; readonly label: string }> = [
  { value: 'default', label: '(default +Z)' },
  { value: '+Z', label: '+Z (up from Z start)' },
  { value: '-Z', label: '−Z (down from Z start)' }
]

export interface CombineProfileDialogParams {
  /** Initial combine mode. Defaults to `union`. */
  readonly mode?: CombineMode
  /** Initial selected profile index. */
  readonly profileIndex?: number
  /** Initial extrude depth (mm, > 0) of the tool body. */
  readonly extrudeDepthMm?: number
  /** Initial Z-start (mm) the tool body extrudes from. */
  readonly zStartMm?: number
  /** Initial extrude direction; omit (or `undefined`) to use the kernel default (+Z). */
  readonly extrudeDirection?: '+Z' | '-Z'
}

export interface CombineProfileDialogProps extends FeatureDialogBaseProps {
  readonly params: CombineProfileDialogParams
  /** Closed-profile options derived from the live sketch (`profileOptions`). */
  readonly profiles: readonly ProfileOption[]
}

/**
 * Build the emitted `boolean_combine_profile` op. Exported pure for the op-builder test.
 *
 * Callers MUST pass an already-validated positive `extrudeDepthMm` and a finite `zStartMm`; this
 * builder just shapes the canonical op. `extrudeDirection` is included ONLY when explicitly chosen
 * (`+Z`/`-Z`) — passing `undefined` leaves it off entirely so the kernel applies its default, and the
 * builder never invents a `suppressed` flag (absent means "active", matching the schema default).
 */
export function buildCombineProfileOp(params: {
  readonly mode: CombineMode
  readonly profileIndex: number
  readonly extrudeDepthMm: number
  readonly zStartMm: number
  readonly extrudeDirection?: '+Z' | '-Z'
}): KernelPostSolidOp {
  return {
    kind: 'boolean_combine_profile',
    mode: params.mode,
    profileIndex: params.profileIndex,
    extrudeDepthMm: params.extrudeDepthMm,
    zStartMm: params.zStartMm,
    ...(params.extrudeDirection !== undefined ? { extrudeDirection: params.extrudeDirection } : {})
  }
}

export function CombineProfileDialog({
  params,
  profiles,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: CombineProfileDialogProps): JSX.Element {
  void _selectionInfo // combine is profile + params driven; no face pick to resolve.
  const [mode, setMode] = useState<CombineMode>(params.mode ?? 'union')
  const [profileIndex, setProfileIndex] = useState<number>(params.profileIndex ?? 0)
  const [depthRaw, setDepthRaw] = useState(String(params.extrudeDepthMm ?? 5))
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))
  const [direction, setDirection] = useState<DirectionChoice>(params.extrudeDirection ?? 'default')

  const depth = parsePositiveMm(depthRaw)
  const zStart = parseFiniteMm(zStartRaw)
  const hasProfiles = profiles.length > 0
  const canApply = hasProfiles && depth !== null && zStart !== null && disabled !== true

  const handleApply = (): void => {
    if (!hasProfiles || depth === null || zStart === null) return
    onApply({
      target: 'kernelOp',
      op: buildCombineProfileOp({
        mode,
        profileIndex,
        extrudeDepthMm: depth,
        zStartMm: zStart,
        extrudeDirection: direction === 'default' ? undefined : direction
      })
    })
  }

  return (
    <FeatureDialogCard title="Combine Profile" testId={TEST_PREFIX}>
      <DialogSelectField
        label="Mode"
        value={mode}
        options={MODE_OPTIONS}
        onChange={setMode}
        testId={`${TEST_PREFIX}-mode`}
        disabled={disabled}
      />
      <ProfileSelectField
        options={profiles}
        value={profileIndex}
        onChange={setProfileIndex}
        testId={`${TEST_PREFIX}-profile`}
        disabled={disabled}
      />
      <DialogNumberField
        label="Extrude depth"
        value={depthRaw}
        onChange={setDepthRaw}
        testId={`${TEST_PREFIX}-depth`}
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId={`${TEST_PREFIX}-zstart`}
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField
        label="Extrude direction"
        value={direction}
        options={DIRECTION_OPTIONS}
        onChange={setDirection}
        testId={`${TEST_PREFIX}-direction`}
        disabled={disabled}
      />
      <p className="fd-note" data-testid={`${TEST_PREFIX}-note`}>
        Extrudes the chosen sketch profile into a tool body and combines it with the current solid by
        the selected mode, then rebuilds.
      </p>
      <DialogApplyRow
        label="Apply combine"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !hasProfiles
              ? 'Draw a closed sketch profile first.'
              : depth === null
                ? 'Enter a positive extrude depth in millimetres.'
                : zStart === null
                  ? 'Enter a finite Z-start in millimetres.'
                  : undefined
        }
        testId={`${TEST_PREFIX}-apply`}
      />
    </FeatureDialogCard>
  )
}

export default CombineProfileDialog
