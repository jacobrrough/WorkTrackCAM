/**
 * Press / Pull property dialog — surfaces the `press_pull_profile` kernel op.
 *
 * The op extrudes a sketch PROFILE (referenced by index into the auto-detected profile list) by a
 * SIGNED distance: positive presses/adds (union), negative pulls/cuts (subtract). It is a member of
 * `kernelPostSolidOpSchema`, so this dialog emits `{ target: 'kernelOp', op }` and the host appends
 * it via `appendKernelOp` (the same path as Fillet/Hole).
 *
 * Picker: the profile is chosen from a real labelled dropdown of the sketch's closed profiles
 * (`ProfileSelectField`, fed `profiles` from `profileOptions(sketchDesign)`), not a blind numeric
 * index. When the sketch has no closed profile the field renders an honest empty-state and Apply
 * stays disabled — the dialog can never emit a profileIndex that doesn't exist.
 */

import { useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, FeatureDialogCard } from './FeatureDialogKit'
import { ProfileSelectField } from './ProfilePathFields'
import { parseFiniteMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { ProfileOption } from './profile-path-options'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

export interface PressPullProfileDialogParams {
  /** Initial selected profile index. */
  readonly profileIndex?: number
  /** Initial signed distance (mm). */
  readonly deltaMm?: number
  /** Initial Z-start (mm) of the profile. */
  readonly zStartMm?: number
}

export interface PressPullProfileDialogProps extends FeatureDialogBaseProps {
  readonly params: PressPullProfileDialogParams
  /** Closed-profile options derived from the live sketch (`profileOptions`). */
  readonly profiles: readonly ProfileOption[]
}

/** Build the emitted `press_pull_profile` op. Exported pure for the op-builder test. */
export function buildPressPullOp(
  profileIndex: number,
  deltaMm: number,
  zStartMm: number
): KernelPostSolidOp {
  return { kind: 'press_pull_profile', profileIndex, deltaMm, zStartMm }
}

export function PressPullProfileDialog({
  params,
  profiles,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: PressPullProfileDialogProps): JSX.Element {
  void _selectionInfo // press/pull is profile + params driven; no face pick to resolve.
  const [profileIndex, setProfileIndex] = useState<number>(params.profileIndex ?? 0)
  const [deltaRaw, setDeltaRaw] = useState(String(params.deltaMm ?? 5))
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))

  const delta = parseFiniteMm(deltaRaw)
  const zStart = parseFiniteMm(zStartRaw)
  const hasProfiles = profiles.length > 0
  const canApply =
    hasProfiles && delta !== null && delta !== 0 && zStart !== null && disabled !== true

  const handleApply = (): void => {
    if (!hasProfiles || delta === null || delta === 0 || zStart === null) return
    onApply({ target: 'kernelOp', op: buildPressPullOp(profileIndex, delta, zStart) })
  }

  return (
    <FeatureDialogCard title="Press / Pull" testId="fd-press_pull_profile">
      <ProfileSelectField
        options={profiles}
        value={profileIndex}
        onChange={setProfileIndex}
        testId="fd-press_pull_profile-profile"
        disabled={disabled}
      />
      <DialogNumberField
        label="Distance (Δ)"
        value={deltaRaw}
        onChange={setDeltaRaw}
        testId="fd-press_pull_profile-delta"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-press_pull_profile-zstart"
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-press_pull_profile-note">
        Extrudes the chosen sketch profile by the signed distance — positive adds (press), negative
        cuts (pull) — and rebuilds.
      </p>
      <DialogApplyRow
        label="Apply press / pull"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !hasProfiles
              ? 'Draw a closed sketch profile first.'
              : delta === null || delta === 0
                ? 'Enter a non-zero distance in millimetres.'
                : zStart === null
                  ? 'Enter a finite Z-start in millimetres.'
                  : undefined
        }
        testId="fd-press_pull_profile-apply"
      />
    </FeatureDialogCard>
  )
}

export default PressPullProfileDialog
