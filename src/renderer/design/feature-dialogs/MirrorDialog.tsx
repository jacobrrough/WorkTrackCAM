/**
 * Mirror property dialog (kernel op `mirror_union_plane`).
 *
 * The CadQuery kernel's mirror UNIONs the current solid with its reflection
 * across a world plane through a chosen origin:
 *   - **YZ** → flip X about x = originXMm,
 *   - **XZ** → flip Y about y = originYMm,
 *   - **XY** → flip Z about z = originZMm.
 *
 * It is a pure *post-base* op (a member of `kernelPostSolidOpSchema`) that runs
 * on the IMPLICIT current solid — there is no profile / path / face to pick, so
 * this dialog needs NO geometry selection. Every parameter the kernel consumes
 * (the mirror plane + the three origin coordinates) is driven from the fields
 * here, and `buildMirrorOp` emits the exact typed op through the EXISTING
 * `appendKernelOp` path (`onApply` → `{ target: 'kernelOp', op }`).
 *
 * Honest read-out (CLAUDE.md "do not fake capability"): only ONE origin axis is
 * meaningful for a given plane (YZ uses originXMm, XZ uses originYMm, XY uses
 * originZMm — see the schema). All three are still real, schema-valid fields, so
 * the dialog exposes all three and surfaces a note naming which one the chosen
 * plane actually mirrors about, instead of hiding capability or pretending the
 * other two move the seam. No part of this op requires geometry the params can't
 * supply, so there is no disabled placeholder here.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** The world mirror planes the kernel's `mirror_union_plane` op accepts. */
export type MirrorPlane = 'YZ' | 'XZ' | 'XY'

/** Which origin coordinate each plane actually mirrors about (schema contract). */
const ACTIVE_ORIGIN_AXIS: Readonly<Record<MirrorPlane, 'X' | 'Y' | 'Z'>> = {
  YZ: 'X',
  XZ: 'Y',
  XY: 'Z'
}

export interface MirrorDialogParams {
  /** Initial mirror plane. Defaults to `'YZ'` (flip X — the common left/right mirror). */
  readonly plane?: MirrorPlane
  /** Initial X-origin (mm) — the YZ-plane mirror coordinate. Defaults to 0. */
  readonly originXMm?: number
  /** Initial Y-origin (mm) — the XZ-plane mirror coordinate. Defaults to 0. */
  readonly originYMm?: number
  /** Initial Z-origin (mm) — the XY-plane mirror coordinate. Defaults to 0. */
  readonly originZMm?: number
}

export interface MirrorDialogProps extends FeatureDialogBaseProps {
  readonly params: MirrorDialogParams
}

/**
 * Build the `mirror_union_plane` `KernelPostSolidOp` for the current dialog
 * state. Exported pure so the test can assert the emitted shape against
 * `kernelPostSolidOpSchema` without rendering.
 *
 * All three origins are always emitted (the schema defaults each to 0 but they
 * are real signed-mm fields; the kernel ignores the two that don't match the
 * chosen plane). Origins are finite signed millimetres — 0 and negatives are
 * valid, so callers parse them with `parseFiniteMm`.
 */
export function buildMirrorOp(
  plane: MirrorPlane,
  originXMm: number,
  originYMm: number,
  originZMm: number
): KernelPostSolidOp {
  return { kind: 'mirror_union_plane', plane, originXMm, originYMm, originZMm }
}

export function MirrorDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: MirrorDialogProps): JSX.Element {
  const [plane, setPlane] = useState<MirrorPlane>(params.plane ?? 'YZ')
  const [originXRaw, setOriginXRaw] = useState(String(params.originXMm ?? 0))
  const [originYRaw, setOriginYRaw] = useState(String(params.originYMm ?? 0))
  const [originZRaw, setOriginZRaw] = useState(String(params.originZMm ?? 0))

  // Origins are signed mm: 0 and negatives are legal mirror coordinates.
  const originX = parseFiniteMm(originXRaw)
  const originY = parseFiniteMm(originYRaw)
  const originZ = parseFiniteMm(originZRaw)

  const originsValid = originX !== null && originY !== null && originZ !== null
  const canApply = originsValid && disabled !== true

  const handleApply = (): void => {
    if (originX === null || originY === null || originZ === null) return
    onApply({
      target: 'kernelOp',
      op: buildMirrorOp(plane, originX, originY, originZ)
    })
  }

  // Honest context: this op needs no pick, and only one origin axis is live for
  // the chosen plane. Name that axis so the operator knows which field moves the
  // mirror seam (the other two are valid but inert for this plane).
  const activeAxis = ACTIVE_ORIGIN_AXIS[plane]
  const planeNote = `Mirrors across the ${plane} plane — the seam is set by the ${activeAxis}-origin (mm) below; the other two origins are recorded but don’t move this plane. No selection needed: the op unions the current solid with its reflection.`

  return (
    <FeatureDialogCard title="Mirror" testId="fd-mirror_union_plane">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Mirror works on the whole current solid — no edge or face pick required."
        note={planeNote}
        testId="fd-mirror_union_plane-selection"
      />
      <DialogSelectField<MirrorPlane>
        label="Mirror plane"
        value={plane}
        options={[
          { value: 'YZ', label: 'YZ — flip X (left / right)' },
          { value: 'XZ', label: 'XZ — flip Y (front / back)' },
          { value: 'XY', label: 'XY — flip Z (top / bottom)' }
        ]}
        onChange={setPlane}
        testId="fd-mirror_union_plane-plane"
        disabled={disabled}
      />
      <DialogNumberField
        label="X origin"
        value={originXRaw}
        onChange={setOriginXRaw}
        testId="fd-mirror_union_plane-originX"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y origin"
        value={originYRaw}
        onChange={setOriginYRaw}
        testId="fd-mirror_union_plane-originY"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z origin"
        value={originZRaw}
        onChange={setOriginZRaw}
        testId="fd-mirror_union_plane-originZ"
        suffix="mm"
        disabled={disabled}
      />
      <DialogApplyRow
        label="Add mirror"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !originsValid
              ? 'Enter finite origin coordinates in millimetres (0 and negatives are allowed).'
              : undefined
        }
        testId="fd-mirror_union_plane-apply"
      />
    </FeatureDialogCard>
  )
}

export default MirrorDialog
