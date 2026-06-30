/**
 * Cut Cylinder property dialog — surfaces the kernel's `boolean_subtract_cylinder`
 * post-solid op as a Fusion-style feature dialog.
 *
 * The kernel op (see `kernelPostSolidOpSchema` in `part-features-schema.ts`)
 * subtracts an axis-aligned (+Z) cylinder from the implicit CURRENT solid. It is
 * driven entirely by SCALAR mm params — center (X,Y), radius, and the Z span
 * (zMin..zMax) of the cut — with NO geometry selection:
 *   - `centerXMm` / `centerYMm` — finite signed mm (the cylinder axis in XY).
 *   - `radiusMm`               — finite POSITIVE mm.
 *   - `zMinMm` / `zMaxMm`      — finite signed mm; the schema's refine requires
 *                                `zMaxMm > zMinMm` (a zero/negative span is not a
 *                                solid to subtract).
 *
 * Because every param is a number the dialog can fully drive, there is NO
 * disabled placeholder here (CLAUDE.md "never fake capability" — nothing is
 * faked, and nothing the op needs is left unexposed). The operator's live 3D
 * pick is shown as CONTEXT only: the kernel cuts by params, not by a picked
 * face/edge, so the dialog never pretends a selection drives the cut.
 *
 * Emit path: a `KernelPostSolidOp` (`target: 'kernelOp'`) the host appends to
 * `part/features.json` `kernelOps[]` via the EXISTING `appendKernelOp` sink —
 * same wiring as Fillet/Chamfer/Shell/Hole.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parseFiniteMm,
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

const TEST_PREFIX = 'fd-boolean_subtract_cylinder'

export interface CutCylinderDialogParams {
  /** Initial cylinder-axis X (mm). */
  readonly centerXMm: number
  /** Initial cylinder-axis Y (mm). */
  readonly centerYMm: number
  /** Initial radius (mm, > 0). */
  readonly radiusMm: number
  /** Initial bottom of the cut span (mm). */
  readonly zMinMm: number
  /** Initial top of the cut span (mm); must end up > `zMinMm` to apply. */
  readonly zMaxMm: number
}

export interface CutCylinderDialogProps extends FeatureDialogBaseProps {
  readonly params: CutCylinderDialogParams
}

/**
 * Build the `boolean_subtract_cylinder` `KernelPostSolidOp` from validated
 * numerics. Exported pure so the op-builder test can round-trip the result
 * through the REAL `kernelPostSolidOpSchema` without rendering.
 *
 * Callers MUST pass already-validated numbers (positive radius, `zMaxMm >
 * zMinMm`); this builder just shapes the canonical op object and never invents
 * a `suppressed` flag (absent means "active", matching the schema default).
 */
export function buildCutCylinderOp(params: {
  readonly centerXMm: number
  readonly centerYMm: number
  readonly radiusMm: number
  readonly zMinMm: number
  readonly zMaxMm: number
}): KernelPostSolidOp {
  return {
    kind: 'boolean_subtract_cylinder',
    centerXMm: params.centerXMm,
    centerYMm: params.centerYMm,
    radiusMm: params.radiusMm,
    zMinMm: params.zMinMm,
    zMaxMm: params.zMaxMm
  }
}

export function CutCylinderDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: CutCylinderDialogProps): JSX.Element {
  const [centerXRaw, setCenterXRaw] = useState(String(params.centerXMm))
  const [centerYRaw, setCenterYRaw] = useState(String(params.centerYMm))
  const [radiusRaw, setRadiusRaw] = useState(String(params.radiusMm))
  const [zMinRaw, setZMinRaw] = useState(String(params.zMinMm))
  const [zMaxRaw, setZMaxRaw] = useState(String(params.zMaxMm))

  const centerX = parseFiniteMm(centerXRaw)
  const centerY = parseFiniteMm(centerYRaw)
  const radius = parsePositiveMm(radiusRaw)
  const zMin = parseFiniteMm(zMinRaw)
  const zMax = parseFiniteMm(zMaxRaw)

  // Mirror the schema refine: the cut span must be strictly increasing, else
  // there is no cylinder to subtract.
  const spanOk = zMin !== null && zMax !== null && zMax > zMin
  const valid =
    centerX !== null && centerY !== null && radius !== null && spanOk
  const canApply = valid && disabled !== true

  const handleApply = (): void => {
    if (
      centerX === null ||
      centerY === null ||
      radius === null ||
      zMin === null ||
      zMax === null ||
      zMax <= zMin
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildCutCylinderOp({
        centerXMm: centerX,
        centerYMm: centerY,
        radiusMm: radius,
        zMinMm: zMin,
        zMaxMm: zMax
      })
    })
  }

  // Honest hint for a gated Apply: name the SPECIFIC reason so the operator is
  // never left guessing why the button is dark.
  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : radius === null
        ? 'Enter a positive radius in millimetres.'
        : centerX === null || centerY === null
          ? 'Enter finite center X and Y in millimetres.'
          : zMin === null || zMax === null
            ? 'Enter finite Z min and Z max in millimetres.'
            : !spanOk
              ? 'Z max must be greater than Z min (the cut needs a positive height).'
              : undefined

  return (
    <FeatureDialogCard title="Cut Cylinder" testId={TEST_PREFIX}>
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Set the cylinder center, radius, and Z span below — the cut is driven by these values."
        note="This cut is defined by the parameters below; the current solid is cut directly (no face/edge pick needed)."
        testId={`${TEST_PREFIX}-selection`}
      />
      <DialogNumberField
        label="Center X"
        value={centerXRaw}
        onChange={setCenterXRaw}
        testId={`${TEST_PREFIX}-centerX`}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Center Y"
        value={centerYRaw}
        onChange={setCenterYRaw}
        testId={`${TEST_PREFIX}-centerY`}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Radius"
        value={radiusRaw}
        onChange={setRadiusRaw}
        testId={`${TEST_PREFIX}-radius`}
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z min"
        value={zMinRaw}
        onChange={setZMinRaw}
        testId={`${TEST_PREFIX}-zMin`}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z max"
        value={zMaxRaw}
        onChange={setZMaxRaw}
        testId={`${TEST_PREFIX}-zMax`}
        suffix="mm"
        disabled={disabled}
      />
      <DialogApplyRow
        label="Cut cylinder"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId={`${TEST_PREFIX}-apply`}
      />
    </FeatureDialogCard>
  )
}

export default CutCylinderDialog
