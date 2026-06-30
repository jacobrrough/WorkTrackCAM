/**
 * Circular Pattern property dialog (kernel op `pattern_circular`).
 *
 * The CadQuery kernel rotates copies of the CURRENT solid around the world +Z
 * axis through the point (`centerXMm`, `centerYMm`, 0). Every parameter the op
 * accepts is a pure scalar driven from this dialog — the operation works on the
 * implicit current solid, so there is NO geometry pick to make (it patterns the
 * whole body, not a selected face/edge). The dialog therefore needs no
 * selection and exposes every param the schema can take:
 *   - `count`         — total instances including the original (2…32).
 *   - `centerXMm` /
 *     `centerYMm`     — the +Z rotation centre in world mm (signed/finite).
 *   - `startAngleDeg` — offset (deg) added to each copy after the first; the
 *                       first instance keeps the original orientation.
 *   - `totalAngleDeg` — total sweep (deg) divided evenly by `count` (1…360).
 *
 * Honest boundary (CLAUDE.md "do not fake capability"): the op has no profile /
 * path / face parameter — it consumes only these scalars — so this dialog drives
 * the kernel op in full with no disabled placeholder. The selection read-out is
 * shown purely as context and states plainly that the pattern applies to the
 * whole current solid regardless of what (if anything) is picked.
 *
 * Emits `{ target: 'kernelOp', op: buildCircularPatternOp(...) }` through the
 * EXISTING `appendKernelOp` host path — no new IPC, no new kernel call.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parseClampedInt,
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Inclusive `count` bounds — mirrors `patternCircularSchema` (`int [2,32]`). */
const MIN_COUNT = 2
const MAX_COUNT = 32
/** Inclusive `totalAngleDeg` bounds — mirrors the schema (`mm.min(1).max(360)`). */
const MIN_TOTAL_ANGLE = 1
const MAX_TOTAL_ANGLE = 360

export interface CircularPatternDialogParams {
  /** Initial instance count (including the original). Defaults to 4. */
  readonly count?: number
  /** Initial +Z rotation-centre X (mm). Defaults to 0. */
  readonly centerXMm?: number
  /** Initial +Z rotation-centre Y (mm). Defaults to 0. */
  readonly centerYMm?: number
  /** Initial per-copy start-angle offset (deg). Defaults to 0. */
  readonly startAngleDeg?: number
  /** Initial total sweep (deg). Defaults to 360 (full circle). */
  readonly totalAngleDeg?: number
}

export interface CircularPatternDialogProps extends FeatureDialogBaseProps {
  readonly params: CircularPatternDialogParams
}

/**
 * Build the `pattern_circular` {@link KernelPostSolidOp} for the given values.
 * Exported pure so the op-builder test can assert the emitted shape against
 * `kernelPostSolidOpSchema` without rendering.
 *
 * All four scalar params are always written explicitly (even though the schema
 * defaults `startAngleDeg`/`totalAngleDeg`): `KernelPostSolidOp` is the schema's
 * OUTPUT type, where those two fields are concrete `number`s, so the op carries
 * them as real values rather than relying on parse-time defaulting.
 */
export function buildCircularPatternOp(params: {
  readonly count: number
  readonly centerXMm: number
  readonly centerYMm: number
  readonly startAngleDeg: number
  readonly totalAngleDeg: number
}): KernelPostSolidOp {
  return {
    kind: 'pattern_circular',
    count: params.count,
    centerXMm: params.centerXMm,
    centerYMm: params.centerYMm,
    startAngleDeg: params.startAngleDeg,
    totalAngleDeg: params.totalAngleDeg
  }
}

export function CircularPatternDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: CircularPatternDialogProps): JSX.Element {
  const [countRaw, setCountRaw] = useState(String(params.count ?? 4))
  const [centerXRaw, setCenterXRaw] = useState(String(params.centerXMm ?? 0))
  const [centerYRaw, setCenterYRaw] = useState(String(params.centerYMm ?? 0))
  const [startAngleRaw, setStartAngleRaw] = useState(String(params.startAngleDeg ?? 0))
  const [totalAngleRaw, setTotalAngleRaw] = useState(String(params.totalAngleDeg ?? 360))

  // Parse every field with the schema's exact bounds. `count` clamps into
  // [2,32]; the two centres are signed finite mm; `startAngleDeg` is any finite
  // value; `totalAngleDeg` clamps into [1,360]. A null on any required field
  // gates Apply (no emit) so invalid input can never reach the kernel.
  const count = parseClampedInt(countRaw, MIN_COUNT, MAX_COUNT)
  const centerXMm = parseFiniteMm(centerXRaw)
  const centerYMm = parseFiniteMm(centerYRaw)
  const startAngleDeg = parseFiniteMm(startAngleRaw)
  const totalAngleDeg = parseClampedInt(totalAngleRaw, MIN_TOTAL_ANGLE, MAX_TOTAL_ANGLE)

  const valid =
    count !== null &&
    centerXMm !== null &&
    centerYMm !== null &&
    startAngleDeg !== null &&
    totalAngleDeg !== null
  const canApply = valid && disabled !== true

  const handleApply = (): void => {
    if (
      count === null ||
      centerXMm === null ||
      centerYMm === null ||
      startAngleDeg === null ||
      totalAngleDeg === null
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildCircularPatternOp({ count, centerXMm, centerYMm, startAngleDeg, totalAngleDeg })
    })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : count === null
        ? 'Enter an instance count between 2 and 32.'
        : centerXMm === null || centerYMm === null
          ? 'Enter a finite rotation-centre X and Y in millimetres.'
          : startAngleDeg === null
            ? 'Enter a finite start angle in degrees.'
            : totalAngleDeg === null
              ? 'Enter a total angle between 1 and 360 degrees.'
              : undefined

  return (
    <FeatureDialogCard title="Circular Pattern" testId="fd-pattern_circular">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Patterns the current solid around +Z — no selection required."
        note="The circular pattern rotates the whole current solid; the rotation centre and counts below drive it (no face/edge pick is used)."
        testId="fd-pattern_circular-selection"
      />
      <DialogNumberField
        label="Count"
        value={countRaw}
        onChange={setCountRaw}
        testId="fd-pattern_circular-count"
        step="1"
        min={MIN_COUNT}
        suffix="instances"
        disabled={disabled}
      />
      <DialogNumberField
        label="Center X"
        value={centerXRaw}
        onChange={setCenterXRaw}
        testId="fd-pattern_circular-centerX"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Center Y"
        value={centerYRaw}
        onChange={setCenterYRaw}
        testId="fd-pattern_circular-centerY"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Start angle"
        value={startAngleRaw}
        onChange={setStartAngleRaw}
        testId="fd-pattern_circular-startAngle"
        suffix="°"
        disabled={disabled}
      />
      <DialogNumberField
        label="Total angle"
        value={totalAngleRaw}
        onChange={setTotalAngleRaw}
        testId="fd-pattern_circular-totalAngle"
        min={MIN_TOTAL_ANGLE}
        suffix="°"
        disabled={disabled}
      />
      <DialogApplyRow
        label="Add circular pattern"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-pattern_circular-apply"
      />
    </FeatureDialogCard>
  )
}

export default CircularPatternDialog
