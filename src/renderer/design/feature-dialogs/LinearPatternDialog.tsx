/**
 * Linear Pattern property dialog.
 *
 * The CadQuery kernel's `pattern_linear_3d` op (a member of
 * `kernelPostSolidOpSchema`) translates copies of the CURRENT solid along a
 * world-space step vector `(dxMm, dyMm, dzMm)` per instance — the first
 * instance is the unchanged original, then `count - 1` further copies are laid
 * out at multiples of the step. There is no profile / path / face input: the op
 * is fully driven by params, so this dialog needs NO geometry selection — it
 * just collects the count + step vector and emits the typed kernelOp through the
 * EXISTING `appendKernelOp` path (`{ target: 'kernelOp', op }`).
 *
 * Honest boundary (CLAUDE.md "do not fake capability"): every param the schema
 * exposes is driven here. The schema requires a NON-ZERO step (at least one of
 * dx/dy/dz must be non-zero) and a count in [2, 32]; the dialog gates Apply on
 * exactly those rules so it can never emit an op the kernel would reject. No
 * placeholder is needed — the op carries no input this dialog can't supply.
 *
 * The shared `SelectionContextBanner` is intentionally omitted: a linear
 * pattern operates on the whole current solid, so a face/edge pick would be
 * misleading context. Showing it would imply the pick scopes the pattern, which
 * it does not.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parseClampedInt,
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Schema bounds for the instance count (mirrors `patternLinear3dSchema`). */
const COUNT_MIN = 2
const COUNT_MAX = 32

export interface LinearPatternDialogParams {
  /** Initial instance count (includes the original). Clamped to [2, 32]. */
  readonly count: number
  /** Initial X step per instance (mm, signed). */
  readonly dxMm: number
  /** Initial Y step per instance (mm, signed). */
  readonly dyMm: number
  /** Initial Z step per instance (mm, signed). */
  readonly dzMm: number
}

export interface LinearPatternDialogProps extends FeatureDialogBaseProps {
  readonly params: LinearPatternDialogParams
}

/**
 * Build the `pattern_linear_3d` `KernelPostSolidOp` for the given params.
 * Exported pure so the op-builder test can assert the emitted shape against
 * `kernelPostSolidOpSchema` without rendering. The caller is responsible for
 * gating on validity (count in range, non-zero step) — this is a pure mapper.
 */
export function buildLinearPatternOp(
  count: number,
  dxMm: number,
  dyMm: number,
  dzMm: number
): KernelPostSolidOp {
  return { kind: 'pattern_linear_3d', count, dxMm, dyMm, dzMm }
}

export function LinearPatternDialog({
  params,
  onApply,
  busy,
  disabled
}: LinearPatternDialogProps): JSX.Element {
  const [countRaw, setCountRaw] = useState(String(params.count))
  const [dxRaw, setDxRaw] = useState(String(params.dxMm))
  const [dyRaw, setDyRaw] = useState(String(params.dyMm))
  const [dzRaw, setDzRaw] = useState(String(params.dzMm))

  const count = parseClampedInt(countRaw, COUNT_MIN, COUNT_MAX)
  const dx = parseFiniteMm(dxRaw)
  const dy = parseFiniteMm(dyRaw)
  const dz = parseFiniteMm(dzRaw)

  // The schema rejects an all-zero step; gate Apply on the same rule the kernel
  // enforces so we never emit an op it would reject.
  const stepIsNonZero = dx !== null && dy !== null && dz !== null && (dx !== 0 || dy !== 0 || dz !== 0)
  const canApply = count !== null && stepIsNonZero && disabled !== true

  const handleApply = (): void => {
    if (count === null || dx === null || dy === null || dz === null) return
    if (dx === 0 && dy === 0 && dz === 0) return
    onApply({ target: 'kernelOp', op: buildLinearPatternOp(count, dx, dy, dz) })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : count === null
        ? `Enter an instance count between ${COUNT_MIN} and ${COUNT_MAX}.`
        : dx === null || dy === null || dz === null
          ? 'Enter a finite step for X, Y and Z (mm).'
          : !stepIsNonZero
            ? 'The step can’t be zero — set a non-zero X, Y or Z distance.'
            : undefined

  return (
    <FeatureDialogCard title="Linear Pattern" testId="fd-pattern_linear_3d">
      <DialogNumberField
        label="Count"
        value={countRaw}
        onChange={setCountRaw}
        testId="fd-pattern_linear_3d-count"
        step="1"
        min={COUNT_MIN}
        disabled={disabled}
      />
      <DialogNumberField
        label="X step"
        value={dxRaw}
        onChange={setDxRaw}
        testId="fd-pattern_linear_3d-dx"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Y step"
        value={dyRaw}
        onChange={setDyRaw}
        testId="fd-pattern_linear_3d-dy"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z step"
        value={dzRaw}
        onChange={setDzRaw}
        testId="fd-pattern_linear_3d-dz"
        suffix="mm"
        disabled={disabled}
      />
      <DialogApplyRow
        label="Add linear pattern"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-pattern_linear_3d-apply"
      />
    </FeatureDialogCard>
  )
}

export default LinearPatternDialog
