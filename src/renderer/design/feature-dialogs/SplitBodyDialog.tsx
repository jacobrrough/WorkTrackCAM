/**
 * Split Body property dialog (kernel op `split_keep_halfspace`).
 *
 * The CadQuery kernel cuts the implicit current solid with an axis-aligned plane
 * and keeps ONE half-space. The op is driven entirely by PARAMS — it needs no
 * geometry pick:
 *   - `axis`     — which world axis the cutting plane is perpendicular to (X/Y/Z).
 *   - `offsetMm` — where along that axis the plane sits (signed mm; 0 = origin).
 *   - `keep`     — which side to keep (`positive` = the +axis half, `negative` =
 *                  the −axis half).
 *
 * Every schema field is therefore exposed by a real control here — there is no
 * dishonest placeholder, because the op carries nothing a face/profile pick would
 * supply (CLAUDE.md "never fake capability"). `offsetMm` is a SIGNED finite mm
 * (the schema's `mm`, not `mmPos`), so the offset field accepts 0 and negatives
 * and is parsed with `parseFiniteMm`; only an empty / NaN / Infinity offset gates
 * Apply. The dialog emits a `kernelOp` change carrying the typed op, which the
 * host appends through the EXISTING `appendKernelOp` path (same as Fillet).
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import { parseFiniteMm, type FeatureDialogBaseProps } from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** World axis the cutting plane is perpendicular to. */
export type SplitAxis = 'X' | 'Y' | 'Z'
/** Which half-space the kernel keeps after the cut. */
export type SplitKeep = 'positive' | 'negative'

export interface SplitBodyDialogParams {
  /** Initial axis the cut plane is normal to. Defaults to `'Z'`. */
  readonly axis?: SplitAxis
  /** Initial signed plane offset along `axis` (mm). Defaults to `0`. */
  readonly offsetMm?: number
  /** Initial half-space to keep. Defaults to `'positive'`. */
  readonly keep?: SplitKeep
}

export interface SplitBodyDialogProps extends FeatureDialogBaseProps {
  readonly params: SplitBodyDialogParams
}

/**
 * Build the `split_keep_halfspace` `KernelPostSolidOp` for the current dialog
 * state. Exported pure so the test can assert the emitted shape against
 * `kernelPostSolidOpSchema` without rendering. The op carries exactly the four
 * canonical fields (`kind` + `axis` + `offsetMm` + `keep`); `suppressed` is a
 * persistence concern the dialog never sets.
 */
export function buildSplitBodyOp(
  axis: SplitAxis,
  offsetMm: number,
  keep: SplitKeep
): KernelPostSolidOp {
  return { kind: 'split_keep_halfspace', axis, offsetMm, keep }
}

export function SplitBodyDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: SplitBodyDialogProps): JSX.Element {
  void _selectionInfo // a half-space split is param-driven; no pick is required
  const [axis, setAxis] = useState<SplitAxis>(params.axis ?? 'Z')
  const [keep, setKeep] = useState<SplitKeep>(params.keep ?? 'positive')
  const [offsetRaw, setOffsetRaw] = useState(String(params.offsetMm ?? 0))

  // Signed finite mm: 0 and negatives are valid plane offsets, so the only
  // invalid input is empty / NaN / Infinity.
  const offset = parseFiniteMm(offsetRaw)
  const canApply = offset !== null && disabled !== true

  const handleApply = (): void => {
    if (offset === null) return
    onApply({ target: 'kernelOp', op: buildSplitBodyOp(axis, offset, keep) })
  }

  return (
    <FeatureDialogCard title="Split Body" testId="fd-split_keep_halfspace">
      <DialogSelectField<SplitAxis>
        label="Plane axis"
        value={axis}
        options={[
          { value: 'X', label: 'X (YZ plane)' },
          { value: 'Y', label: 'Y (XZ plane)' },
          { value: 'Z', label: 'Z (XY plane)' }
        ]}
        onChange={setAxis}
        testId="fd-split_keep_halfspace-axis"
        disabled={disabled}
      />
      <DialogNumberField
        label="Offset"
        value={offsetRaw}
        onChange={setOffsetRaw}
        testId="fd-split_keep_halfspace-offset"
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField<SplitKeep>
        label="Keep side"
        value={keep}
        options={[
          { value: 'positive', label: 'Positive (+axis half)' },
          { value: 'negative', label: 'Negative (−axis half)' }
        ]}
        onChange={setKeep}
        testId="fd-split_keep_halfspace-keep"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-split_keep_halfspace-note">
        Cuts the current solid with the axis-aligned plane at the offset and keeps
        the chosen half. Applies through the kernel op timeline — no selection
        needed.
      </p>
      <DialogApplyRow
        label="Split body"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : offset === null
              ? 'Enter a finite offset in millimetres (0 and negatives are allowed).'
              : undefined
        }
        testId="fd-split_keep_halfspace-apply"
      />
    </FeatureDialogCard>
  )
}

export default SplitBodyDialog
