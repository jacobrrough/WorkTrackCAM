/**
 * FG-5b · Hole property dialog.
 *
 * The kernel op is `hole_from_profile { profileIndex, mode, depthMm?, zStartMm }`.
 * It cuts a hole from an existing sketch **profile** (typically a circle,
 * referenced by its index in the payload `profiles` array) either to a depth or
 * through-all. The full hole wizard (counterbore / countersink / tapped /
 * diameter-from-thread) is explicitly "still planned" in the audit, and there is
 * no face-pick "place a new hole here" — the hole must come from a profile the
 * sketch already contains.
 *
 * So this dialog drives the working profile-based path:
 *   - **Profile index** → which sketch profile to bore.
 *   - **Mode** → to-depth or through-all.
 *   - **Depth** (mm, only in depth mode) and **Z start** (mm).
 * It flags the missing counterbore/countersink/tapped wizard and the missing
 * face-pick placement as gaps rather than faking either. Emits
 * `hole_from_profile` through the existing `appendKernelOp` path.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parseClampedInt,
  parsePositiveMm,
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

type HoleMode = 'depth' | 'through_all'

export interface HoleDialogParams {
  /** Initial profile index to bore (0-based; range-checked vs payload profiles by the kernel). */
  readonly profileIndex: number
  /** Initial mode. Defaults to `'through_all'`. */
  readonly mode?: HoleMode
  /** Initial depth (mm) when mode is `'depth'`. Defaults to 10. */
  readonly depthMm?: number
  /** Initial Z-start (mm) of the bore. Defaults to 0. */
  readonly zStartMm?: number
}

export interface HoleDialogProps extends FeatureDialogBaseProps {
  readonly params: HoleDialogParams
}

/**
 * Build the emitted `hole_from_profile` op. Exported pure so the test can assert
 * the emitted shape (and its depth/through-all branch) against the schema.
 * `depthMm` is included only in depth mode (the schema's refine requires a
 * positive depth there and ignores it for through-all).
 */
export function buildHoleOp(
  profileIndex: number,
  mode: HoleMode,
  depthMm: number,
  zStartMm: number
): KernelPostSolidOp {
  if (mode === 'depth') {
    return { kind: 'hole_from_profile', profileIndex, mode: 'depth', depthMm, zStartMm }
  }
  return { kind: 'hole_from_profile', profileIndex, mode: 'through_all', zStartMm }
}

export function HoleDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: HoleDialogProps): JSX.Element {
  const [profileRaw, setProfileRaw] = useState(String(params.profileIndex))
  const [mode, setMode] = useState<HoleMode>(params.mode ?? 'through_all')
  const [depthRaw, setDepthRaw] = useState(String(params.depthMm ?? 10))
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))

  const profileIndex = parseClampedInt(profileRaw, 0, 255)
  const depth = parsePositiveMm(depthRaw)
  const zStart = parseFiniteMm(zStartRaw)

  const depthValid = mode !== 'depth' || depth !== null
  const canApply =
    profileIndex !== null && zStart !== null && depthValid && disabled !== true

  const handleApply = (): void => {
    if (profileIndex === null || zStart === null) return
    if (mode === 'depth' && depth === null) return
    onApply({
      target: 'kernelOp',
      op: buildHoleOp(profileIndex, mode, depth ?? 0, zStart)
    })
  }

  return (
    <FeatureDialogCard title="Hole" testId="fd-hole">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Holes are bored from an existing sketch profile (choose its index below)."
        note={
          selectionInfo.selection !== null
            ? 'Placing a hole on the picked face is not supported yet — bore from a sketch profile index below. (Gap: needs face-pick hole placement.)'
            : undefined
        }
        testId="fd-hole-selection"
      />
      <DialogNumberField
        label="Profile index"
        value={profileRaw}
        onChange={setProfileRaw}
        testId="fd-hole-profile"
        step="1"
        min={0}
        disabled={disabled}
      />
      <DialogSelectField<HoleMode>
        label="Depth mode"
        value={mode}
        options={[
          { value: 'through_all', label: 'Through all' },
          { value: 'depth', label: 'To depth' }
        ]}
        onChange={setMode}
        testId="fd-hole-mode"
        disabled={disabled}
      />
      {mode === 'depth' && (
        <DialogNumberField
          label="Depth"
          value={depthRaw}
          onChange={setDepthRaw}
          testId="fd-hole-depth"
          min={0}
          suffix="mm"
          disabled={disabled}
        />
      )}
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-hole-zstart"
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-hole-note">
        Bores the selected sketch profile. Counterbore / countersink / tapped
        and diameter-from-thread are not yet built — this is a straight bore.
      </p>
      <DialogApplyRow
        label="Add hole"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : profileIndex === null
              ? 'Enter a profile index (0 or greater).'
              : mode === 'depth' && depth === null
                ? 'Enter a positive depth in millimetres.'
                : zStart === null
                  ? 'Enter a finite Z-start in millimetres.'
                  : undefined
        }
        testId="fd-hole-apply"
      />
    </FeatureDialogCard>
  )
}

export default HoleDialog
