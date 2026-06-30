/**
 * Thicken property dialog (`thicken_offset` kernel op).
 *
 * The CadQuery kernel's `thicken_offset` is a true OCC offset of the implicit
 * CURRENT solid by a distance, in one of three senses:
 *   - `outward` — grow the body outward by `distanceMm`.
 *   - `inward`  — shrink the body inward by `distanceMm` (hollow toward center).
 *   - `both`    — offset symmetrically both ways.
 *
 * Every schema param is driven from PARAMS alone — the op needs no profile,
 * path, or face selection (it offsets the whole current solid), so unlike
 * Fillet/Shell there is NO picked-id path and no axis bucket. The two real
 * params are exposed directly:
 *   - **Distance** → `distanceMm` (a numeric mm field).
 *   - **Side**     → `side` ('outward' | 'inward' | 'both').
 *
 * Honest scope: the schema's `distanceMm` is `z.number().finite()` with a
 * `.refine(distanceMm !== 0)`, i.e. any non-zero magnitude — the SIGN is carried
 * by `side`, not by a negative number. So the dialog takes a strictly POSITIVE
 * thickness (`parsePositiveMm`) and lets `side` choose the direction; that maps
 * 1:1 onto what the kernel consumes without exposing a confusing signed field.
 * The internal `suppressed` ordering flag is not a user input and is left unset
 * (the schema makes it optional). There is no disabled placeholder here because
 * there is no capability the params can't reach — every field drives the kernel.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Which offset sense the thicken applies — mirrors the schema `side` enum. */
export type ThickenSide = 'outward' | 'inward' | 'both'

/** The `side` options the schema's `z.enum(['outward','inward','both'])` accepts. */
export const THICKEN_SIDE_OPTIONS: ReadonlyArray<{
  readonly value: ThickenSide
  readonly label: string
}> = [
  { value: 'outward', label: 'Outward (grow)' },
  { value: 'inward', label: 'Inward (hollow)' },
  { value: 'both', label: 'Both (symmetric)' }
]

export interface ThickenDialogParams {
  /** Initial offset distance (mm). */
  readonly distanceMm: number
  /** Initial offset sense. Defaults to `'outward'` (matches the schema default). */
  readonly side?: ThickenSide
}

export interface ThickenDialogProps extends FeatureDialogBaseProps {
  readonly params: ThickenDialogParams
}

/**
 * Build the EXACT typed `thicken_offset` op for the current dialog state.
 * Exported pure so the op-builder test can round-trip it through the REAL
 * `kernelPostSolidOpSchema` without rendering.
 *
 * Emits `distanceMm` (the schema rejects 0 — the caller gates on a positive
 * value before reaching here) and `side`. `suppressed` is intentionally omitted
 * (internal ordering flag, optional in the schema).
 */
export function buildThickenOp(distanceMm: number, side: ThickenSide): KernelPostSolidOp {
  return { kind: 'thicken_offset', distanceMm, side }
}

export function ThickenDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: ThickenDialogProps): JSX.Element {
  void _selectionInfo // thicken_offset operates on the whole current solid — no pick needed
  const [distanceRaw, setDistanceRaw] = useState(String(params.distanceMm))
  const [side, setSide] = useState<ThickenSide>(params.side ?? 'outward')

  const distance = parsePositiveMm(distanceRaw)
  const canApply = distance !== null && disabled !== true

  const handleApply = (): void => {
    if (distance === null) return
    onApply({ target: 'kernelOp', op: buildThickenOp(distance, side) })
  }

  return (
    <FeatureDialogCard title="Thicken" testId="fd-thicken_offset">
      <DialogNumberField
        label="Distance"
        value={distanceRaw}
        onChange={setDistanceRaw}
        testId="fd-thicken_offset-distance"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField<ThickenSide>
        label="Side"
        value={side}
        options={THICKEN_SIDE_OPTIONS}
        onChange={setSide}
        testId="fd-thicken_offset-side"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-thicken_offset-note">
        Offsets the whole current solid by a true OCC offset — no face selection
        needed. The direction is set by <strong>Side</strong>; enter a positive
        distance (the sign is carried by the side, not the number).
      </p>
      <DialogApplyRow
        label="Apply thicken"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : distance === null
              ? 'Enter a positive distance in millimetres.'
              : undefined
        }
        testId="fd-thicken_offset-apply"
      />
    </FeatureDialogCard>
  )
}

export default ThickenDialog
