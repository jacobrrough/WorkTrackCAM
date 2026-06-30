/**
 * Intersect Box property dialog.
 *
 * The CadQuery kernel's `boolean_intersect_box` op keeps ONLY the volume of the
 * current solid that lies inside an axis-aligned box, given as six world-mm
 * bounds (`xMin/xMax`, `yMin/yMax`, `zMin/zMax`). It is a member of
 * `kernelPostSolidOpSchema`, so this dialog emits a {@link KernelPostSolidOp}
 * through the EXISTING `appendKernelOp` path (`target: 'kernelOp'`).
 *
 * Honest scope: this op operates on the IMPLICIT current solid using only the
 * six numeric bounds — there is no profile / path / face input it could take, so
 * NO geometry selection is required and NO disabled placeholder is needed. Every
 * parameter the op accepts is driveable here. The selection context is read only
 * to show the operator what they have picked (the box still clips the whole
 * solid regardless of pick), never to fabricate a capability the kernel lacks.
 *
 * Validation mirrors the schema's refine exactly: each axis must be strictly
 * increasing (max > min). Bounds are SIGNED (a box can sit at negative world
 * coordinates), so each field parses with `parseFiniteMm`, not `parsePositiveMm`.
 * Apply is gated until all six parse AND every axis is strictly increasing, so
 * the dialog never emits an op the schema would reject.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import { parseFiniteMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

export interface IntersectBoxDialogParams {
  /** Initial lower X bound (mm). */
  readonly xMinMm: number
  /** Initial upper X bound (mm). */
  readonly xMaxMm: number
  /** Initial lower Y bound (mm). */
  readonly yMinMm: number
  /** Initial upper Y bound (mm). */
  readonly yMaxMm: number
  /** Initial lower Z bound (mm). */
  readonly zMinMm: number
  /** Initial upper Z bound (mm). */
  readonly zMaxMm: number
}

export interface IntersectBoxDialogProps extends FeatureDialogBaseProps {
  readonly params: IntersectBoxDialogParams
}

/** Six resolved (finite) box bounds, in the order the op stores them. */
export interface IntersectBoxBounds {
  readonly xMinMm: number
  readonly xMaxMm: number
  readonly yMinMm: number
  readonly yMaxMm: number
  readonly zMinMm: number
  readonly zMaxMm: number
}

/**
 * True when every axis is strictly increasing (max > min) — the exact condition
 * `booleanIntersectBoxSchema`'s `.refine(...)` enforces. Exported so the dialog
 * and the op-builder test agree on the gate.
 */
export function intersectBoxAxesValid(b: IntersectBoxBounds): boolean {
  return b.xMaxMm > b.xMinMm && b.yMaxMm > b.yMinMm && b.zMaxMm > b.zMinMm
}

/**
 * Build the `KernelPostSolidOp` for the dialog's current bounds. Exported pure so
 * the test can assert the emitted shape against `kernelPostSolidOpSchema` without
 * rendering. Returns the EXACT typed `boolean_intersect_box` op — no extra keys,
 * `suppressed` intentionally omitted (it defaults to absent on a freshly applied
 * op).
 */
export function buildIntersectBoxOp(b: IntersectBoxBounds): KernelPostSolidOp {
  return {
    kind: 'boolean_intersect_box',
    xMinMm: b.xMinMm,
    xMaxMm: b.xMaxMm,
    yMinMm: b.yMinMm,
    yMaxMm: b.yMaxMm,
    zMinMm: b.zMinMm,
    zMaxMm: b.zMaxMm
  }
}

export function IntersectBoxDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: IntersectBoxDialogProps): JSX.Element {
  const [xMinRaw, setXMinRaw] = useState(String(params.xMinMm))
  const [xMaxRaw, setXMaxRaw] = useState(String(params.xMaxMm))
  const [yMinRaw, setYMinRaw] = useState(String(params.yMinMm))
  const [yMaxRaw, setYMaxRaw] = useState(String(params.yMaxMm))
  const [zMinRaw, setZMinRaw] = useState(String(params.zMinMm))
  const [zMaxRaw, setZMaxRaw] = useState(String(params.zMaxMm))

  const xMin = parseFiniteMm(xMinRaw)
  const xMax = parseFiniteMm(xMaxRaw)
  const yMin = parseFiniteMm(yMinRaw)
  const yMax = parseFiniteMm(yMaxRaw)
  const zMin = parseFiniteMm(zMinRaw)
  const zMax = parseFiniteMm(zMaxRaw)

  const allFinite =
    xMin !== null &&
    xMax !== null &&
    yMin !== null &&
    yMax !== null &&
    zMin !== null &&
    zMax !== null

  // The resolved bounds, only when all six parse — used for both the axis gate
  // and the emitted op so the two never diverge.
  const bounds: IntersectBoxBounds | null = allFinite
    ? { xMinMm: xMin, xMaxMm: xMax, yMinMm: yMin, yMaxMm: yMax, zMinMm: zMin, zMaxMm: zMax }
    : null

  const axesValid = bounds !== null && intersectBoxAxesValid(bounds)
  const canApply = axesValid && disabled !== true

  const handleApply = (): void => {
    if (bounds === null || !intersectBoxAxesValid(bounds)) return
    onApply({ target: 'kernelOp', op: buildIntersectBoxOp(bounds) })
  }

  // Honest, schema-aligned hint for why Apply is gated.
  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : !allFinite
        ? 'Enter all six box bounds as finite millimetre values.'
        : !axesValid
          ? 'Each axis needs its max greater than its min (X, Y and Z).'
          : undefined

  return (
    <FeatureDialogCard title="Intersect Box" testId="fd-boolean_intersect_box">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="No selection needed — the box clips the whole solid by its world-mm bounds below."
        note="Keeps only the volume inside the box. Bounds are world coordinates and may be negative."
        testId="fd-boolean_intersect_box-selection"
      />
      <DialogNumberField
        label="X min"
        value={xMinRaw}
        onChange={setXMinRaw}
        testId="fd-boolean_intersect_box-x-min"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="X max"
        value={xMaxRaw}
        onChange={setXMaxRaw}
        testId="fd-boolean_intersect_box-x-max"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y min"
        value={yMinRaw}
        onChange={setYMinRaw}
        testId="fd-boolean_intersect_box-y-min"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y max"
        value={yMaxRaw}
        onChange={setYMaxRaw}
        testId="fd-boolean_intersect_box-y-max"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z min"
        value={zMinRaw}
        onChange={setZMinRaw}
        testId="fd-boolean_intersect_box-z-min"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z max"
        value={zMaxRaw}
        onChange={setZMaxRaw}
        testId="fd-boolean_intersect_box-z-max"
        suffix="mm"
        disabled={disabled}
      />
      <DialogApplyRow
        label="Apply intersect box"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-boolean_intersect_box-apply"
      />
    </FeatureDialogCard>
  )
}

export default IntersectBoxDialog
