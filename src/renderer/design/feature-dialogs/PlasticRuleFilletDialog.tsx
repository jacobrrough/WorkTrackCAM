/**
 * Rule Fillet property dialog (`plastic_rule_fillet`).
 *
 * The plastic "rule fillet" is a one-shot post-solid op: it rounds the model's
 * edges to a single design radius (the injection-moulding "rule of thumb" — no
 * sharp internal corners), the way Fusion's Plastic Rule Fillet does. The kernel
 * op operates on the IMPLICIT current solid and takes a single PARAM — there is
 * no profile / path / face to pick — so this dialog is a pure params dialog with
 * one driveable field:
 *   - **Radius** → `plastic_rule_fillet.radiusMm` (finite, strictly positive).
 *
 * `plastic_rule_fillet` IS a member of `kernelPostSolidOpSchema`, so the dialog
 * emits a {@link KernelPostSolidOp} via the EXISTING `appendKernelOp` path
 * (`onApply({ target: 'kernelOp', op })`) — no new IPC, no new kernel call.
 *
 * Honesty note (CLAUDE.md "do not fake capability"): the schema exposes exactly
 * one operator-driveable param (`radiusMm`; `suppressed` is a timeline flag, not
 * a design input). There is therefore NO disabled placeholder here — every param
 * this op can consume is driven for real. Unlike Fillet there is no axis-bucket /
 * picked-edge targeting in the schema, so the dialog does not pretend to offer
 * one; it rounds per the kernel's rule-fillet behaviour.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

export interface PlasticRuleFilletDialogParams {
  /** Initial rule-fillet radius (mm) shown when the dialog opens. */
  readonly radiusMm: number
}

export interface PlasticRuleFilletDialogProps extends FeatureDialogBaseProps {
  readonly params: PlasticRuleFilletDialogParams
}

/**
 * Build the EXACT typed `plastic_rule_fillet` kernel op for the given radius.
 * Exported pure so the op-builder test can round-trip the result through the
 * REAL `kernelPostSolidOpSchema` without rendering. The op carries only
 * `kind` + `radiusMm` — the schema's `suppressed` flag is a timeline concern set
 * elsewhere, never an opening default this dialog fabricates.
 */
export function buildPlasticRuleFilletOp(radiusMm: number): KernelPostSolidOp {
  return { kind: 'plastic_rule_fillet', radiusMm }
}

export function PlasticRuleFilletDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: PlasticRuleFilletDialogProps): JSX.Element {
  void _selectionInfo // rule fillet operates on the whole solid — no pick needed
  const [radiusRaw, setRadiusRaw] = useState(String(params.radiusMm))

  const radius = parsePositiveMm(radiusRaw)
  const canApply = radius !== null && disabled !== true

  const handleApply = (): void => {
    if (radius === null) return
    onApply({ target: 'kernelOp', op: buildPlasticRuleFilletOp(radius) })
  }

  return (
    <FeatureDialogCard title="Rule Fillet" testId="fd-plastic_rule_fillet">
      <DialogNumberField
        label="Radius"
        value={radiusRaw}
        onChange={setRadiusRaw}
        testId="fd-plastic_rule_fillet-radius"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-plastic_rule_fillet-note">
        Rounds the part’s edges to a single design radius (injection-moulding rule
        fillet). Applies to the whole solid — no edge selection required.
      </p>
      <DialogApplyRow
        label="Add rule fillet"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : radius === null
              ? 'Enter a positive radius in millimetres.'
              : undefined
        }
        testId="fd-plastic_rule_fillet-apply"
      />
    </FeatureDialogCard>
  )
}

export default PlasticRuleFilletDialog
