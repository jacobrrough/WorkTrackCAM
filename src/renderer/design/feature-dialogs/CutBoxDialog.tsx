/**
 * Cut Box property dialog — surfaces the `boolean_subtract_box` kernel op.
 *
 * The op (see `boolean_subtract_box` in `part-features-schema.ts`) subtracts an
 * axis-aligned box, expressed as six world-mm extents (`xMinMm…zMaxMm`, the same
 * world frame as the sketch extrude: XY plane, +Z up), from the IMPLICIT current
 * solid. It is a member of `kernelPostSolidOpSchema`, so this dialog emits
 * `{ target: 'kernelOp', op }` and the host appends it via `appendKernelOp`
 * (replayed by Build STEP through `resolveTimeline`) — the same existing path the
 * Fillet/Chamfer/Shell/Hole dialogs use.
 *
 * No geometry selection is needed: every parameter is a world-mm scalar the
 * operator types directly, so there is no picked face/edge/profile to resolve.
 * The live 3D selection is therefore accepted but unused (a box subtract is
 * fully param-driven), and there is NO disabled placeholder here — every
 * parameter the kernel op accepts is exposed and drivable. The selection prop is
 * read only so the dialog matches the shared `FeatureDialogBaseProps` contract.
 *
 * Validity gate (mirrors the schema's `.refine`): the op REQUIRES strictly
 * increasing min/max on each axis (`xMaxMm > xMinMm`, etc.). Apply stays disabled
 * — with an honest hint — until all six fields parse to finite mm AND each axis
 * has max > min, so the dialog can never emit a box the schema would reject
 * (CLAUDE.md Safety Rule 1 — a bad kernel op gets persisted + replayed).
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard
} from './FeatureDialogKit'
import { parseFiniteMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

export interface CutBoxDialogParams {
  /** Box min/max extent on each world axis (mm) shown when the dialog opens. */
  readonly xMinMm: number
  readonly xMaxMm: number
  readonly yMinMm: number
  readonly yMaxMm: number
  readonly zMinMm: number
  readonly zMaxMm: number
}

export interface CutBoxDialogProps extends FeatureDialogBaseProps {
  readonly params: CutBoxDialogParams
}

/**
 * Build the `boolean_subtract_box` op from six finite-mm extents. Exported pure
 * so the op-builder test can round-trip the result through the REAL
 * `kernelPostSolidOpSchema` without rendering.
 *
 * The caller (the dialog) only invokes this once each axis satisfies max > min,
 * so the returned op always passes the schema's `.refine`; this builder does NOT
 * re-validate (it is a pure typed-shape constructor) — the gate lives in the
 * dialog's `canApply`.
 */
export function buildCutBoxOp(params: CutBoxDialogParams): KernelPostSolidOp {
  return {
    kind: 'boolean_subtract_box',
    xMinMm: params.xMinMm,
    xMaxMm: params.xMaxMm,
    yMinMm: params.yMinMm,
    yMaxMm: params.yMaxMm,
    zMinMm: params.zMinMm,
    zMaxMm: params.zMaxMm
  }
}

export function CutBoxDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: CutBoxDialogProps): JSX.Element {
  void _selectionInfo // a box subtract is fully param-driven; no pick to resolve.

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

  const allParsed =
    xMin !== null &&
    xMax !== null &&
    yMin !== null &&
    yMax !== null &&
    zMin !== null &&
    zMax !== null

  // Mirror the schema's refine: strictly increasing min/max on each axis.
  const axesValid =
    allParsed && xMax > xMin && yMax > yMin && zMax > zMin

  const canApply = axesValid && disabled !== true

  const handleApply = (): void => {
    if (
      xMin === null ||
      xMax === null ||
      yMin === null ||
      yMax === null ||
      zMin === null ||
      zMax === null ||
      !(xMax > xMin) ||
      !(yMax > yMin) ||
      !(zMax > zMin)
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildCutBoxOp({
        xMinMm: xMin,
        xMaxMm: xMax,
        yMinMm: yMin,
        yMaxMm: yMax,
        zMinMm: zMin,
        zMaxMm: zMax
      })
    })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : !allParsed
        ? 'Enter a finite millimetre value in every field.'
        : !axesValid
          ? 'Each axis needs max greater than min (X, Y and Z).'
          : undefined

  return (
    <FeatureDialogCard title="Cut Box" testId="fd-boolean_subtract_box">
      <DialogNumberField
        label="X min"
        value={xMinRaw}
        onChange={setXMinRaw}
        testId="fd-boolean_subtract_box-xMin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="X max"
        value={xMaxRaw}
        onChange={setXMaxRaw}
        testId="fd-boolean_subtract_box-xMax"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y min"
        value={yMinRaw}
        onChange={setYMinRaw}
        testId="fd-boolean_subtract_box-yMin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y max"
        value={yMaxRaw}
        onChange={setYMaxRaw}
        testId="fd-boolean_subtract_box-yMax"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z min"
        value={zMinRaw}
        onChange={setZMinRaw}
        testId="fd-boolean_subtract_box-zMin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z max"
        value={zMaxRaw}
        onChange={setZMaxRaw}
        testId="fd-boolean_subtract_box-zMax"
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-boolean_subtract_box-note">
        Subtracts an axis-aligned box (world mm, +Z up) from the current solid and
        rebuilds. Each axis needs max greater than min.
      </p>
      <DialogApplyRow
        label="Cut box"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-boolean_subtract_box-apply"
      />
    </FeatureDialogCard>
  )
}

export default CutBoxDialog
