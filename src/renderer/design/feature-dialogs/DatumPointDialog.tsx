/**
 * Construct · Construction-point datum dialog.
 *
 * Emits a `datum_point { xMm, yMm, zMm, label? }` CONSTRUCTION-geometry marker
 * op through the existing `appendKernelOp` path. A reference point anchors later
 * geometry but NEVER alters the solid — the kernel records it as a manifest
 * marker (see `build_part.py::_op_datum_point`).
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard
} from './FeatureDialogKit'
import { DatumLabelField } from './DatumPlaneDialog'
import {
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

export interface DatumPointDialogParams {
  /** Initial coordinates (mm). Default to the world origin. */
  readonly xMm?: number
  readonly yMm?: number
  readonly zMm?: number
}

export interface DatumPointDialogProps extends FeatureDialogBaseProps {
  readonly params: DatumPointDialogParams
}

/**
 * Build the emitted `datum_point` op (pure, testable against the schema). A
 * non-empty trimmed `label` is included; an empty one is omitted.
 */
export function buildDatumPointOp(
  point: { readonly x: number; readonly y: number; readonly z: number },
  label?: string
): KernelPostSolidOp {
  const trimmed = label?.trim()
  const base = { kind: 'datum_point' as const, xMm: point.x, yMm: point.y, zMm: point.z }
  return trimmed ? { ...base, label: trimmed } : base
}

export function DatumPointDialog({
  params,
  onApply,
  busy,
  disabled
}: DatumPointDialogProps): JSX.Element {
  const [xRaw, setXRaw] = useState(String(params.xMm ?? 0))
  const [yRaw, setYRaw] = useState(String(params.yMm ?? 0))
  const [zRaw, setZRaw] = useState(String(params.zMm ?? 0))
  const [label, setLabel] = useState('')

  const x = parseFiniteMm(xRaw)
  const y = parseFiniteMm(yRaw)
  const z = parseFiniteMm(zRaw)
  const pointValid = x !== null && y !== null && z !== null
  const canApply = pointValid && disabled !== true

  const handleApply = (): void => {
    if (x === null || y === null || z === null) return
    onApply({ target: 'kernelOp', op: buildDatumPointOp({ x, y, z }, label) })
  }

  return (
    <FeatureDialogCard title="Construction point" testId="fd-datum-point">
      <p className="fd-note" data-testid="fd-datum-point-note">
        A reference point at the given coordinates. Reference geometry only — it
        does not change the model.
      </p>
      <DialogNumberField label="X" value={xRaw} onChange={setXRaw} testId="fd-datum-point-x" suffix="mm" disabled={disabled} />
      <DialogNumberField label="Y" value={yRaw} onChange={setYRaw} testId="fd-datum-point-y" suffix="mm" disabled={disabled} />
      <DialogNumberField label="Z" value={zRaw} onChange={setZRaw} testId="fd-datum-point-z" suffix="mm" disabled={disabled} />
      <DatumLabelField value={label} onChange={setLabel} testId="fd-datum-point-label" disabled={disabled} />
      <DialogApplyRow
        label="Add point"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !pointValid
              ? 'Enter finite X / Y / Z coordinates in millimetres.'
              : undefined
        }
        testId="fd-datum-point-apply"
      />
    </FeatureDialogCard>
  )
}

export default DatumPointDialog
