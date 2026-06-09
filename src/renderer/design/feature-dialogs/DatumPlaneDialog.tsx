/**
 * Construct · Offset-plane datum dialog.
 *
 * Emits a `datum_plane { basePlane, offsetMm, label? }` CONSTRUCTION-geometry
 * marker op through the existing `appendKernelOp` path. A datum is reference
 * geometry — it anchors later sketches/features but NEVER alters the solid, so
 * the kernel records it as a manifest marker and carries the body forward
 * unchanged (see `build_part.py::_op_datum_plane`). Unlike the solid dialogs,
 * `offsetMm` may be 0 (a coincident reference plane is still useful), so the
 * field accepts any finite value, not strictly-positive.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Canonical base datum planes a constructed plane can offset from. */
export const DATUM_BASE_PLANE_OPTIONS = ['XY', 'XZ', 'YZ'] as const
export type DatumBasePlane = (typeof DATUM_BASE_PLANE_OPTIONS)[number]

export interface DatumPlaneDialogParams {
  /** Initial base datum plane. Defaults to `'XY'`. */
  readonly basePlane?: DatumBasePlane
  /** Initial signed offset (mm) along the base plane normal. Defaults to 0. */
  readonly offsetMm?: number
}

export interface DatumPlaneDialogProps extends FeatureDialogBaseProps {
  readonly params: DatumPlaneDialogParams
}

const BASE_PLANE_SELECT_OPTIONS: ReadonlyArray<{ value: DatumBasePlane; label: string }> = [
  { value: 'XY', label: 'XY (top)' },
  { value: 'XZ', label: 'XZ (front)' },
  { value: 'YZ', label: 'YZ (right)' }
]

/**
 * Build the emitted `datum_plane` op (pure, testable against the schema). A
 * non-empty trimmed `label` is included; an empty one is omitted (the schema
 * leaves it optional).
 */
export function buildDatumPlaneOp(
  basePlane: DatumBasePlane,
  offsetMm: number,
  label?: string
): KernelPostSolidOp {
  const trimmed = label?.trim()
  return trimmed
    ? { kind: 'datum_plane', basePlane, offsetMm, label: trimmed }
    : { kind: 'datum_plane', basePlane, offsetMm }
}

export function DatumPlaneDialog({
  params,
  onApply,
  busy,
  disabled
}: DatumPlaneDialogProps): JSX.Element {
  const [basePlane, setBasePlane] = useState<DatumBasePlane>(params.basePlane ?? 'XY')
  const [offsetRaw, setOffsetRaw] = useState(String(params.offsetMm ?? 0))
  const [label, setLabel] = useState('')

  const offset = parseFiniteMm(offsetRaw)
  const canApply = offset !== null && disabled !== true

  const handleApply = (): void => {
    if (offset === null) return
    onApply({ target: 'kernelOp', op: buildDatumPlaneOp(basePlane, offset, label) })
  }

  return (
    <FeatureDialogCard title="Offset plane" testId="fd-datum-plane">
      <p className="fd-note" data-testid="fd-datum-plane-note">
        A construction plane parallel to the base datum at the offset. Reference
        geometry only — it does not change the model.
      </p>
      <DialogSelectField
        label="Base plane"
        value={basePlane}
        options={BASE_PLANE_SELECT_OPTIONS}
        onChange={setBasePlane}
        testId="fd-datum-plane-base"
        disabled={disabled}
      />
      <DialogNumberField
        label="Offset"
        value={offsetRaw}
        onChange={setOffsetRaw}
        testId="fd-datum-plane-offset"
        suffix="mm"
        disabled={disabled}
      />
      <DatumLabelField value={label} onChange={setLabel} testId="fd-datum-plane-label" disabled={disabled} />
      <DialogApplyRow
        label="Add plane"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : offset === null
              ? 'Enter a finite offset in millimetres (0 is allowed).'
              : undefined
        }
        testId="fd-datum-plane-apply"
      />
    </FeatureDialogCard>
  )
}

/**
 * Shared optional-label input for the three datum dialogs. Kept here (not in the
 * kit) since only datums use a free-text label; a plain text input matching the
 * `.fd-field` shape. Operator text only — the kernel caps it at 80 chars.
 */
export function DatumLabelField({
  value,
  onChange,
  testId,
  disabled
}: {
  readonly value: string
  readonly onChange: (raw: string) => void
  readonly testId: string
  readonly disabled?: boolean
}): JSX.Element {
  return (
    <div className="fd-field" data-testid={`${testId}-field`}>
      <label className="fd-field__label" htmlFor={testId}>
        Label (optional)
      </label>
      <div className="fd-field__control">
        <input
          id={testId}
          className="fd-field__input"
          data-testid={testId}
          type="text"
          maxLength={80}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

export default DatumPlaneDialog
