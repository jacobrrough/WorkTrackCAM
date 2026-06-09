/**
 * Construct · Construction-axis datum dialog.
 *
 * Emits a `datum_axis { axis, originXMm, originYMm, originZMm, label? }`
 * CONSTRUCTION-geometry marker op through the existing `appendKernelOp` path.
 * A reference axis (useful for revolve / circular-pattern axes) anchors later
 * geometry but NEVER alters the solid — the kernel records it as a manifest
 * marker (see `build_part.py::_op_datum_axis`).
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import { DatumLabelField } from './DatumPlaneDialog'
import {
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Canonical axis directions a construction axis can align with. */
export const DATUM_AXIS_OPTIONS = ['X', 'Y', 'Z'] as const
export type DatumAxis = (typeof DATUM_AXIS_OPTIONS)[number]

export interface DatumAxisDialogParams {
  /** Initial axis direction. Defaults to `'Z'` (the common revolve axis). */
  readonly axis?: DatumAxis
  /** Initial origin (mm). Defaults to the world origin. */
  readonly originXMm?: number
  readonly originYMm?: number
  readonly originZMm?: number
}

export interface DatumAxisDialogProps extends FeatureDialogBaseProps {
  readonly params: DatumAxisDialogParams
}

const AXIS_SELECT_OPTIONS: ReadonlyArray<{ value: DatumAxis; label: string }> = [
  { value: 'X', label: 'X' },
  { value: 'Y', label: 'Y' },
  { value: 'Z', label: 'Z' }
]

/**
 * Build the emitted `datum_axis` op (pure, testable against the schema). A
 * non-empty trimmed `label` is included; an empty one is omitted.
 */
export function buildDatumAxisOp(
  axis: DatumAxis,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  label?: string
): KernelPostSolidOp {
  const trimmed = label?.trim()
  const base = {
    kind: 'datum_axis' as const,
    axis,
    originXMm: origin.x,
    originYMm: origin.y,
    originZMm: origin.z
  }
  return trimmed ? { ...base, label: trimmed } : base
}

export function DatumAxisDialog({
  params,
  onApply,
  busy,
  disabled
}: DatumAxisDialogProps): JSX.Element {
  const [axis, setAxis] = useState<DatumAxis>(params.axis ?? 'Z')
  const [xRaw, setXRaw] = useState(String(params.originXMm ?? 0))
  const [yRaw, setYRaw] = useState(String(params.originYMm ?? 0))
  const [zRaw, setZRaw] = useState(String(params.originZMm ?? 0))
  const [label, setLabel] = useState('')

  const x = parseFiniteMm(xRaw)
  const y = parseFiniteMm(yRaw)
  const z = parseFiniteMm(zRaw)
  const originValid = x !== null && y !== null && z !== null
  const canApply = originValid && disabled !== true

  const handleApply = (): void => {
    if (x === null || y === null || z === null) return
    onApply({ target: 'kernelOp', op: buildDatumAxisOp(axis, { x, y, z }, label) })
  }

  return (
    <FeatureDialogCard title="Construction axis" testId="fd-datum-axis">
      <p className="fd-note" data-testid="fd-datum-axis-note">
        A reference axis through the origin point, aligned with the chosen axis.
        Reference geometry only — it does not change the model.
      </p>
      <DialogSelectField
        label="Direction"
        value={axis}
        options={AXIS_SELECT_OPTIONS}
        onChange={setAxis}
        testId="fd-datum-axis-dir"
        disabled={disabled}
      />
      <DialogNumberField label="Origin X" value={xRaw} onChange={setXRaw} testId="fd-datum-axis-x" suffix="mm" disabled={disabled} />
      <DialogNumberField label="Origin Y" value={yRaw} onChange={setYRaw} testId="fd-datum-axis-y" suffix="mm" disabled={disabled} />
      <DialogNumberField label="Origin Z" value={zRaw} onChange={setZRaw} testId="fd-datum-axis-z" suffix="mm" disabled={disabled} />
      <DatumLabelField value={label} onChange={setLabel} testId="fd-datum-axis-label" disabled={disabled} />
      <DialogApplyRow
        label="Add axis"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !originValid
              ? 'Enter finite X / Y / Z origin coordinates in millimetres.'
              : undefined
        }
        testId="fd-datum-axis-apply"
      />
    </FeatureDialogCard>
  )
}

export default DatumAxisDialog
