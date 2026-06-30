/**
 * Lip / Groove property dialog — surfaces the `plastic_lip_groove` kernel op.
 *
 * The plastic "lip / groove" is a post-solid mating feature (Fusion's Plastic
 * Lip/Groove): along the top of an axis-aligned rectangular footprint it either
 * ADDS a raised lip (`mode: 'lip'`) or CUTS a recessed groove (`mode: 'groove'`)
 * so two enclosure halves nest. The kernel op (see `plastic_lip_groove` in
 * `part-features-schema.ts`) operates on the IMPLICIT current solid and is fully
 * PARAM-driven — the footprint is six world-mm scalars, not a picked face/edge/
 * profile:
 *   - **Mode**   → `mode` (`'lip'` | `'groove'`) — add a lip or cut a groove.
 *   - **X / Y min/max** → `xMinMm…yMaxMm` (signed world mm, XY plane, +Z up) — the
 *     rectangular footprint the lip/groove runs along.
 *   - **Z base** → `zBaseMm` (signed mm) — the height the feature starts from.
 *   - **Depth**  → `depthMm` (strictly positive mm) — how tall the lip / how deep
 *     the groove.
 *
 * `plastic_lip_groove` IS a member of `kernelPostSolidOpSchema`, so this dialog
 * emits `{ target: 'kernelOp', op }` and the host appends it via `appendKernelOp`
 * (replayed by Build STEP through `resolveTimeline`) — the same existing path the
 * Fillet/Chamfer/Shell/Hole/CutBox dialogs use. No new IPC, no new kernel call.
 *
 * Honesty note (CLAUDE.md "do not fake capability"): every operator-driveable
 * param the schema defines is exposed and driven for real (`suppressed` is a
 * timeline flag, not a design input, so it is never an opening default). There is
 * therefore NO disabled placeholder — the op needs no geometry the params can't
 * supply, so the live 3D selection is accepted but unused.
 *
 * Validity gate: the `plastic_lip_groove` schema itself only requires finite mm
 * on the footprint/`zBaseMm` and a strictly-positive `depthMm` — it carries no
 * `.refine` ordering the footprint corners. But a footprint with `xMax <= xMin`
 * (or `yMax <= yMin`) is a zero/negative-area region the kernel can't build a
 * lip/groove along, so Apply stays disabled — with an honest hint — until both
 * axes are strictly increasing AND a positive depth parses. That keeps the dialog
 * from emitting a geometrically degenerate (if schema-legal) op.
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
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Which mating feature the dialog will emit — a raised lip or a recessed groove. */
export type LipGrooveMode = 'lip' | 'groove'

export interface PlasticLipGrooveDialogParams {
  /** Add a lip or cut a groove. No schema default — the dialog seeds `'lip'`. */
  readonly mode: LipGrooveMode
  /** Rectangular footprint min/max on X and Y (signed world mm). */
  readonly xMinMm: number
  readonly xMaxMm: number
  readonly yMinMm: number
  readonly yMaxMm: number
  /** Height the lip/groove starts from (signed mm). */
  readonly zBaseMm: number
  /** Lip height / groove depth (strictly positive mm). */
  readonly depthMm: number
}

export interface PlasticLipGrooveDialogProps extends FeatureDialogBaseProps {
  readonly params: PlasticLipGrooveDialogParams
}

/**
 * Build the EXACT typed `plastic_lip_groove` kernel op from the given params.
 * Exported pure so the op-builder test can round-trip the result through the
 * REAL `kernelPostSolidOpSchema` without rendering.
 *
 * The caller (the dialog) only invokes this once both axes are strictly
 * increasing and `depthMm` parses positive, so the returned op is always
 * schema-valid; this builder does NOT re-validate (it is a pure typed-shape
 * constructor) — the gate lives in the dialog's `canApply`. The op carries only
 * the schema's design params — the `suppressed` flag is a timeline concern set
 * elsewhere, never an opening default this dialog fabricates.
 */
export function buildPlasticLipGrooveOp(
  params: PlasticLipGrooveDialogParams
): KernelPostSolidOp {
  return {
    kind: 'plastic_lip_groove',
    mode: params.mode,
    xMinMm: params.xMinMm,
    xMaxMm: params.xMaxMm,
    yMinMm: params.yMinMm,
    yMaxMm: params.yMaxMm,
    zBaseMm: params.zBaseMm,
    depthMm: params.depthMm
  }
}

export function PlasticLipGrooveDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: PlasticLipGrooveDialogProps): JSX.Element {
  void _selectionInfo // a lip/groove is fully param-driven; no pick to resolve.

  const [mode, setMode] = useState<LipGrooveMode>(params.mode)
  const [xMinRaw, setXMinRaw] = useState(String(params.xMinMm))
  const [xMaxRaw, setXMaxRaw] = useState(String(params.xMaxMm))
  const [yMinRaw, setYMinRaw] = useState(String(params.yMinMm))
  const [yMaxRaw, setYMaxRaw] = useState(String(params.yMaxMm))
  const [zBaseRaw, setZBaseRaw] = useState(String(params.zBaseMm))
  const [depthRaw, setDepthRaw] = useState(String(params.depthMm))

  const xMin = parseFiniteMm(xMinRaw)
  const xMax = parseFiniteMm(xMaxRaw)
  const yMin = parseFiniteMm(yMinRaw)
  const yMax = parseFiniteMm(yMaxRaw)
  const zBase = parseFiniteMm(zBaseRaw)
  const depth = parsePositiveMm(depthRaw)

  const allParsed =
    xMin !== null &&
    xMax !== null &&
    yMin !== null &&
    yMax !== null &&
    zBase !== null &&
    depth !== null

  // Footprint must be a real (strictly increasing) rectangle on both axes — a
  // zero/negative-area region can't carry a lip/groove. (The schema permits any
  // finite mm here; this is the dialog's geometric-sanity gate.)
  const footprintValid = allParsed && xMax > xMin && yMax > yMin

  const canApply = footprintValid && disabled !== true

  const handleApply = (): void => {
    if (
      xMin === null ||
      xMax === null ||
      yMin === null ||
      yMax === null ||
      zBase === null ||
      depth === null ||
      !(xMax > xMin) ||
      !(yMax > yMin)
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildPlasticLipGrooveOp({
        mode,
        xMinMm: xMin,
        xMaxMm: xMax,
        yMinMm: yMin,
        yMaxMm: yMax,
        zBaseMm: zBase,
        depthMm: depth
      })
    })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : depth === null
        ? 'Enter a positive depth (lip height / groove depth) in millimetres.'
        : !allParsed
          ? 'Enter a finite millimetre value in every field.'
          : !footprintValid
            ? 'The footprint needs X max greater than X min and Y max greater than Y min.'
            : undefined

  return (
    <FeatureDialogCard title="Lip / Groove" testId="fd-plastic_lip_groove">
      <DialogSelectField<LipGrooveMode>
        label="Mode"
        value={mode}
        options={[
          { value: 'lip', label: 'Lip (raised)' },
          { value: 'groove', label: 'Groove (recessed)' }
        ]}
        onChange={setMode}
        testId="fd-plastic_lip_groove-mode"
        disabled={disabled}
      />
      <DialogNumberField
        label="X min"
        value={xMinRaw}
        onChange={setXMinRaw}
        testId="fd-plastic_lip_groove-xMin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="X max"
        value={xMaxRaw}
        onChange={setXMaxRaw}
        testId="fd-plastic_lip_groove-xMax"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y min"
        value={yMinRaw}
        onChange={setYMinRaw}
        testId="fd-plastic_lip_groove-yMin"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y max"
        value={yMaxRaw}
        onChange={setYMaxRaw}
        testId="fd-plastic_lip_groove-yMax"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z base"
        value={zBaseRaw}
        onChange={setZBaseRaw}
        testId="fd-plastic_lip_groove-zBase"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Depth"
        value={depthRaw}
        onChange={setDepthRaw}
        testId="fd-plastic_lip_groove-depth"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-plastic_lip_groove-note">
        Adds a raised lip or cuts a recessed groove along the top of an
        axis-aligned footprint (world mm, +Z up) so two halves nest, then
        rebuilds. The footprint needs max greater than min on X and Y.
      </p>
      <DialogApplyRow
        label={mode === 'groove' ? 'Cut groove' : 'Add lip'}
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-plastic_lip_groove-apply"
      />
    </FeatureDialogCard>
  )
}

export default PlasticLipGrooveDialog
