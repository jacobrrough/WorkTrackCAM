/**
 * Add Box property dialog — the Fusion-style front end for the CadQuery kernel
 * op `boolean_union_box`.
 *
 * The op is a member of {@link KernelPostSolidOp} (it unions an axis-aligned box
 * into the IMPLICIT current solid), so this is a pure-params `kernelOp` dialog —
 * NO geometry selection is required. Every parameter the schema declares is
 * driveable from numbers alone (`xMin/xMax`, `yMin/yMax`, `zMin/zMax` in world
 * mm, XY sketch plane, +Z up), so there is no honest-placeholder field here: the
 * dialog exposes the full op. It emits the box through the EXISTING
 * `appendKernelOp` path via `onApply({ target: 'kernelOp', op })`.
 *
 * Faithful mapping: the dialog surfaces the SAME six min/max values the schema
 * stores (no center/size re-parameterisation that would have to be inverted),
 * so the emitted op is exactly what the operator typed. The schema's refine
 * (`xMax > xMin && yMax > yMin && zMax > zMin`) is mirrored in {@link boxIsValid}
 * so Apply is gated on a degenerate/inverted box BEFORE anything reaches the
 * kernel (CLAUDE.md Safety Rule 1 — a persisted kernelOp is replayed by Build
 * STEP; never emit one the schema would reject).
 */

import { useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, FeatureDialogCard } from './FeatureDialogKit'
import { parseFiniteMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Opening values for the six box bounds (world mm). */
export interface AddBoxDialogParams {
  readonly xMinMm: number
  readonly xMaxMm: number
  readonly yMinMm: number
  readonly yMaxMm: number
  readonly zMinMm: number
  readonly zMaxMm: number
}

export interface AddBoxDialogProps extends FeatureDialogBaseProps {
  readonly params: AddBoxDialogParams
}

/** The six resolved bounds — all finite mm — once every field parses. */
interface ResolvedBounds {
  readonly xMinMm: number
  readonly xMaxMm: number
  readonly yMinMm: number
  readonly yMaxMm: number
  readonly zMinMm: number
  readonly zMaxMm: number
}

/**
 * The schema's box validity rule, in one place: every axis must be strictly
 * increasing (a zero-or-negative extent is a degenerate solid the kernel can't
 * union). Mirrors `booleanUnionBoxSchema.refine(...)` so the dialog gates Apply
 * with the same condition the schema enforces.
 */
export function boxIsValid(b: ResolvedBounds): boolean {
  return b.xMaxMm > b.xMinMm && b.yMaxMm > b.yMinMm && b.zMaxMm > b.zMinMm
}

/**
 * Build the EXACT typed `boolean_union_box` op from the resolved bounds.
 * Exported pure so the op-builder test can round-trip the result through the
 * REAL `kernelPostSolidOpSchema` without rendering. The returned object is the
 * canonical op (no extra fields — `suppressed` is omitted; it is set later by
 * the timeline, not the dialog).
 */
export function buildAddBoxOp(b: ResolvedBounds): KernelPostSolidOp {
  return {
    kind: 'boolean_union_box',
    xMinMm: b.xMinMm,
    xMaxMm: b.xMaxMm,
    yMinMm: b.yMinMm,
    yMaxMm: b.yMaxMm,
    zMinMm: b.zMinMm,
    zMaxMm: b.zMaxMm
  }
}

export function AddBoxDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: AddBoxDialogProps): JSX.Element {
  void _selectionInfo // pure-params op — no pick is consumed

  const [xMinRaw, setXMinRaw] = useState(String(params.xMinMm))
  const [xMaxRaw, setXMaxRaw] = useState(String(params.xMaxMm))
  const [yMinRaw, setYMinRaw] = useState(String(params.yMinMm))
  const [yMaxRaw, setYMaxRaw] = useState(String(params.yMaxMm))
  const [zMinRaw, setZMinRaw] = useState(String(params.zMinMm))
  const [zMaxRaw, setZMaxRaw] = useState(String(params.zMaxMm))

  // Each bound is any finite signed mm value (the schema's `mm` scalar).
  const xMin = parseFiniteMm(xMinRaw)
  const xMax = parseFiniteMm(xMaxRaw)
  const yMin = parseFiniteMm(yMinRaw)
  const yMax = parseFiniteMm(yMaxRaw)
  const zMin = parseFiniteMm(zMinRaw)
  const zMax = parseFiniteMm(zMaxRaw)

  const bounds: ResolvedBounds | null =
    xMin !== null &&
    xMax !== null &&
    yMin !== null &&
    yMax !== null &&
    zMin !== null &&
    zMax !== null
      ? { xMinMm: xMin, xMaxMm: xMax, yMinMm: yMin, yMaxMm: yMax, zMinMm: zMin, zMaxMm: zMax }
      : null

  const boundsValid = bounds !== null && boxIsValid(bounds)
  const canApply = boundsValid && disabled !== true

  const handleApply = (): void => {
    if (bounds === null || !boxIsValid(bounds)) return
    onApply({ target: 'kernelOp', op: buildAddBoxOp(bounds) })
  }

  // Honest disabled-reason for the Apply hint: distinguish "no project" from
  // "a field is blank/non-numeric" from "the box is inverted/degenerate".
  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : bounds === null
        ? 'Enter a finite millimetre value in every box bound.'
        : !boundsValid
          ? 'Each max must be greater than its min (X, Y and Z).'
          : undefined

  return (
    <FeatureDialogCard title="Add Box" testId="fd-boolean_union_box">
      <DialogNumberField
        label="X min"
        value={xMinRaw}
        onChange={setXMinRaw}
        testId="fd-boolean_union_box-xmin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="X max"
        value={xMaxRaw}
        onChange={setXMaxRaw}
        testId="fd-boolean_union_box-xmax"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y min"
        value={yMinRaw}
        onChange={setYMinRaw}
        testId="fd-boolean_union_box-ymin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y max"
        value={yMaxRaw}
        onChange={setYMaxRaw}
        testId="fd-boolean_union_box-ymax"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z min"
        value={zMinRaw}
        onChange={setZMinRaw}
        testId="fd-boolean_union_box-zmin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z max"
        value={zMaxRaw}
        onChange={setZMaxRaw}
        testId="fd-boolean_union_box-zmax"
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-boolean_union_box-note">
        Unions an axis-aligned box into the current solid (world mm — XY sketch
        plane, +Z up). Each axis must be strictly increasing.
      </p>
      <DialogApplyRow
        label="Add Box"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-boolean_union_box-apply"
      />
    </FeatureDialogCard>
  )
}

export default AddBoxDialog
