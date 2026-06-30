/**
 * Tier-1 · Rectangular Pattern property dialog.
 *
 * The CadQuery kernel's `pattern_rectangular` op (a member of
 * `kernelPostSolidOpSchema`, built by `engines/occt/build_part.py`) duplicates
 * the IMPLICIT current solid across a grid: `countX` copies stepping `spacingXMm`
 * along +X and `countY` copies stepping `spacingYMm` along +Y. The first
 * instance stays at the original position; every other cell is an offset copy.
 *
 * This is a PURE params dialog — it needs NO geometry selection. Unlike
 * Fillet/Chamfer/Shell (which target picked edges/faces) or Hole (which needs a
 * `profileIndex`), the rectangular pattern operates on whatever solid the
 * timeline has built so far and is fully described by its four scalar params.
 * So there is no honest capability gap to flag and no disabled placeholder: every
 * param the schema exposes is driven here. The live selection is read only for
 * the context banner (it is never required to apply).
 *
 * What the operator controls:
 *   - **Count X / Count Y** → integer copies per axis, clamped to the schema's
 *     `[1, 32]`. The schema's refine requires `countX > 1 || countY > 1` (a 1×1
 *     "pattern" is a no-op), so Apply is gated until at least one axis has > 1.
 *   - **Spacing X / Spacing Y** → signed centre-to-centre step in mm. Signed
 *     (matches the schema's `mm = z.number().finite()`): a negative spacing lays
 *     the copies out in the −axis direction. 0 is allowed by the schema but only
 *     meaningful when that axis' count is 1, so we keep the parse permissive and
 *     let the count gate carry correctness.
 *
 * Emits `{ target: 'kernelOp', op }` through the EXISTING `appendKernelOp` path
 * (the host wiring is a LATER phase); it never fabricates a sink or a param the
 * kernel can't consume.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parseClampedInt,
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Inclusive bounds the schema enforces on `countX` / `countY`. */
export const PATTERN_COUNT_MIN = 1
export const PATTERN_COUNT_MAX = 32

export interface RectangularPatternDialogParams {
  /** Initial number of columns (+X copies). Defaults to 2. */
  readonly countX?: number
  /** Initial number of rows (+Y copies). Defaults to 1. */
  readonly countY?: number
  /** Initial column step in mm (signed). Defaults to 20. */
  readonly spacingXMm?: number
  /** Initial row step in mm (signed). Defaults to 20. */
  readonly spacingYMm?: number
}

export interface RectangularPatternDialogProps extends FeatureDialogBaseProps {
  readonly params: RectangularPatternDialogParams
}

/**
 * Build the `pattern_rectangular` {@link KernelPostSolidOp} for the given params.
 * Exported pure so the op-builder test can round-trip the result through the REAL
 * `kernelPostSolidOpSchema` without rendering.
 *
 * The caller is responsible for having already validated the inputs (the dialog
 * gates Apply on parse + the `countX > 1 || countY > 1` refine), so this is a
 * straight, total mapping with no clamping or fallbacks — the emitted shape is
 * exactly the canonical op the schema accepts.
 */
export function buildRectangularPatternOp(params: {
  readonly countX: number
  readonly countY: number
  readonly spacingXMm: number
  readonly spacingYMm: number
}): KernelPostSolidOp {
  return {
    kind: 'pattern_rectangular',
    countX: params.countX,
    countY: params.countY,
    spacingXMm: params.spacingXMm,
    spacingYMm: params.spacingYMm
  }
}

export function RectangularPatternDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: RectangularPatternDialogProps): JSX.Element {
  const [countXRaw, setCountXRaw] = useState(String(params.countX ?? 2))
  const [countYRaw, setCountYRaw] = useState(String(params.countY ?? 1))
  const [spacingXRaw, setSpacingXRaw] = useState(String(params.spacingXMm ?? 20))
  const [spacingYRaw, setSpacingYRaw] = useState(String(params.spacingYMm ?? 20))

  const countX = parseClampedInt(countXRaw, PATTERN_COUNT_MIN, PATTERN_COUNT_MAX)
  const countY = parseClampedInt(countYRaw, PATTERN_COUNT_MIN, PATTERN_COUNT_MAX)
  const spacingX = parseFiniteMm(spacingXRaw)
  const spacingY = parseFiniteMm(spacingYRaw)

  const allParsed =
    countX !== null && countY !== null && spacingX !== null && spacingY !== null
  // The schema's refine: a 1×1 grid is a no-op the kernel rejects.
  const hasMultiple = (countX ?? 1) > 1 || (countY ?? 1) > 1
  const canApply = allParsed && hasMultiple && disabled !== true

  const handleApply = (): void => {
    if (countX === null || countY === null || spacingX === null || spacingY === null) return
    if (!(countX > 1 || countY > 1)) return
    onApply({
      target: 'kernelOp',
      op: buildRectangularPatternOp({
        countX,
        countY,
        spacingXMm: spacingX,
        spacingYMm: spacingY
      })
    })
  }

  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : !allParsed
        ? 'Enter whole counts (1–32) and a spacing in millimetres for each axis.'
        : !hasMultiple
          ? 'A pattern needs more than one copy — set Count X or Count Y above 1.'
          : undefined

  return (
    <FeatureDialogCard title="Rectangular Pattern" testId="fd-pattern_rectangular">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Patterns the whole current body across a grid — no selection needed."
        note="Each cell is a copy of the body built so far; the first cell stays in place."
        testId="fd-pattern_rectangular-selection"
      />
      <DialogNumberField
        label="Count X"
        value={countXRaw}
        onChange={setCountXRaw}
        testId="fd-pattern_rectangular-countX"
        step="1"
        min={PATTERN_COUNT_MIN}
        disabled={disabled}
      />
      <DialogNumberField
        label="Spacing X"
        value={spacingXRaw}
        onChange={setSpacingXRaw}
        testId="fd-pattern_rectangular-spacingX"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Count Y"
        value={countYRaw}
        onChange={setCountYRaw}
        testId="fd-pattern_rectangular-countY"
        step="1"
        min={PATTERN_COUNT_MIN}
        disabled={disabled}
      />
      <DialogNumberField
        label="Spacing Y"
        value={spacingYRaw}
        onChange={setSpacingYRaw}
        testId="fd-pattern_rectangular-spacingY"
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-pattern_rectangular-note">
        Copies the current body in a grid: <code>Count X</code> columns stepping{' '}
        <code>Spacing X</code> along +X, <code>Count Y</code> rows stepping{' '}
        <code>Spacing Y</code> along +Y. A negative spacing lays copies out in the
        opposite direction.
      </p>
      <DialogApplyRow
        label="Add pattern"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-pattern_rectangular-apply"
      />
    </FeatureDialogCard>
  )
}

export default RectangularPatternDialog
