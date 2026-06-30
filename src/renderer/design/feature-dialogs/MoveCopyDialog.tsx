/**
 * Tier-1 · Move / Copy property dialog (kernel op `transform_translate`).
 *
 * Maps the Fusion "Move/Copy" command onto the kernel's `transform_translate`
 * post-solid op, which the `build_part.py` dispatch already implements: it
 * translates the IMPLICIT CURRENT SOLID by `(dxMm, dyMm, dzMm)` and, when
 * `keepOriginal` is true, unions the translated duplicate back onto the original
 * (a "Copy" instead of a "Move"). The op is a member of
 * {@link KernelPostSolidOp}, so the dialog emits `{ target: 'kernelOp', op }`
 * and the host appends it through the EXISTING `appendKernelOp` path — no new
 * IPC, no geometry pick.
 *
 * What the operator controls — ALL of the op's params are driveable from here:
 *   - **ΔX / ΔY / ΔZ** → the signed translation vector (mm). Any finite value,
 *     including 0 and negatives (the schema uses `z.number()`, not a positive
 *     constraint), so a single-axis move just leaves the other two at 0.
 *   - **Result** → `keepOriginal`: "Move body" (false) relocates the solid;
 *     "Copy body" (true) keeps the original and unions the moved duplicate.
 *
 * Honest scope (CLAUDE.md "do not fake capability"): `transform_translate`
 * operates on the whole current solid with PARAMS ONLY — there is no per-face /
 * per-edge selection, no rotation, and no copy-count in the kernel op. So this
 * dialog needs no 3D selection (the `selectionInfo` prop is accepted but
 * unused, like {@link ExtrudeDialog}) and renders no selection banner. Rotation
 * and multi-copy are deliberately NOT shown as dead placeholders — they aren't
 * part of this op's contract, so claiming them would be dishonest; a later
 * cycle that lands a `transform_rotate` / multi-instance op gets its own dialog.
 *
 * The gate is "all three deltas are finite numbers" (signed, zero allowed) AND
 * the host has an open/built model (`disabled !== true`). A zero vector is a
 * legal no-op translate the schema accepts, so it is not blocked — the operator
 * may intentionally Copy in place.
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

/** Result mode the dialog maps onto the op's `keepOriginal` boolean. */
export type MoveCopyMode = 'move' | 'copy'

export interface MoveCopyDialogParams {
  /** Initial ΔX (mm, signed). Defaults to 0. */
  readonly dxMm?: number
  /** Initial ΔY (mm, signed). Defaults to 0. */
  readonly dyMm?: number
  /** Initial ΔZ (mm, signed). Defaults to 0. */
  readonly dzMm?: number
  /**
   * Initial result mode. `'move'` → `keepOriginal: false` (relocate);
   * `'copy'` → `keepOriginal: true` (keep original + union the moved duplicate).
   * Defaults to `'move'`.
   */
  readonly mode?: MoveCopyMode
}

export interface MoveCopyDialogProps extends FeatureDialogBaseProps {
  readonly params: MoveCopyDialogParams
}

/**
 * Build the `transform_translate` {@link KernelPostSolidOp} for the dialog's
 * current state. Exported pure so the op-builder test can round-trip the result
 * through the REAL `kernelPostSolidOpSchema` without rendering.
 *
 * `mode: 'copy'` sets `keepOriginal: true`; `mode: 'move'` always emits the
 * field as `false` (canonical — the schema defaults it to `false`, but emitting
 * it explicitly keeps the persisted op unambiguous and the test exact).
 */
export function buildMoveCopyOp(
  dxMm: number,
  dyMm: number,
  dzMm: number,
  mode: MoveCopyMode
): KernelPostSolidOp {
  return {
    kind: 'transform_translate',
    dxMm,
    dyMm,
    dzMm,
    keepOriginal: mode === 'copy'
  }
}

export function MoveCopyDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: MoveCopyDialogProps): JSX.Element {
  void _selectionInfo // transform_translate moves the whole solid — no pick needed
  const [dxRaw, setDxRaw] = useState(String(params.dxMm ?? 0))
  const [dyRaw, setDyRaw] = useState(String(params.dyMm ?? 0))
  const [dzRaw, setDzRaw] = useState(String(params.dzMm ?? 0))
  const [mode, setMode] = useState<MoveCopyMode>(params.mode ?? 'move')

  // Signed/finite parse: 0 and negatives are valid translation components, so
  // parseFiniteMm (not parsePositiveMm) is the right gate. Apply needs all three.
  const dx = parseFiniteMm(dxRaw)
  const dy = parseFiniteMm(dyRaw)
  const dz = parseFiniteMm(dzRaw)
  const vectorValid = dx !== null && dy !== null && dz !== null
  const canApply = vectorValid && disabled !== true

  const handleApply = (): void => {
    if (dx === null || dy === null || dz === null) return
    onApply({ target: 'kernelOp', op: buildMoveCopyOp(dx, dy, dz, mode) })
  }

  return (
    <FeatureDialogCard title="Move / Copy" testId="fd-transform_translate">
      <DialogNumberField
        label="ΔX"
        value={dxRaw}
        onChange={setDxRaw}
        testId="fd-transform_translate-dx"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="ΔY"
        value={dyRaw}
        onChange={setDyRaw}
        testId="fd-transform_translate-dy"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="ΔZ"
        value={dzRaw}
        onChange={setDzRaw}
        testId="fd-transform_translate-dz"
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField<MoveCopyMode>
        label="Result"
        value={mode}
        options={[
          { value: 'move', label: 'Move body' },
          { value: 'copy', label: 'Copy body (keep original)' }
        ]}
        onChange={setMode}
        testId="fd-transform_translate-mode"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-transform_translate-note">
        Translates the current solid by (ΔX, ΔY, ΔZ).{' '}
        <strong>Copy body</strong> keeps the original and unions the moved
        duplicate. Rotation and multi-instance copies aren’t part of this op —
        use a pattern op for arrays.
      </p>
      <DialogApplyRow
        label={mode === 'copy' ? 'Apply copy' : 'Apply move'}
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : !vectorValid
              ? 'Enter finite ΔX, ΔY and ΔZ values in millimetres.'
              : undefined
        }
        testId="fd-transform_translate-apply"
      />
    </FeatureDialogCard>
  )
}

export default MoveCopyDialog
