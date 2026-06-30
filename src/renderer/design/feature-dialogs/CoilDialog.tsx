/**
 * Coil property dialog (Tier-1 parity · kernel op `coil_cut`).
 *
 * The CadQuery kernel's `coil_cut` (a member of `kernelPostSolidOpSchema`, built
 * by `_op_coil_cut` in `engines/occt/build_part.py`) carves a simplified helical
 * coil into the IMPLICIT current solid: a stack of ring cuts marching up +Z. It
 * is **fully param-driven** — it takes a centre, a major radius, a pitch, a turn
 * count, a radial cut depth, and a Z start. There is no profile, path, or picked
 * face to supply: every input is a scalar the operator types here, so this dialog
 * exposes ALL of them and needs no selection.
 *
 * Honest scope (CLAUDE.md "do not fake capability"):
 *   - This is the kernel's *simplified* coil — stacked ring cuts, NOT a true swept
 *     section (the kernel comment + schema say so). The dialog states that in its
 *     note rather than implying a Fusion-grade swept coil.
 *   - Every field maps 1:1 onto a real `coil_cut` param; nothing is a placeholder.
 *   - `turns` is capped at 100 (the schema's `mmPos.max(100)`), so the dialog
 *     gates Apply when the typed turn count exceeds that — it never emits an op
 *     the schema would reject.
 *
 * The dialog emits a `KernelPostSolidOp` through the EXISTING `appendKernelOp`
 * path (`{ target: 'kernelOp', op }`), exactly like Fillet/Chamfer/Shell/Hole.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parseFiniteMm,
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Schema-enforced upper bound on `turns` (`mmPos.max(100)` in the schema). */
export const COIL_MAX_TURNS = 100

/** Opening values shown when the dialog mounts. */
export interface CoilDialogParams {
  /** Coil-axis centre X (mm, signed). */
  readonly centerXMm: number
  /** Coil-axis centre Y (mm, signed). */
  readonly centerYMm: number
  /** Helix major radius (mm, positive). */
  readonly majorRadiusMm: number
  /** Rise per turn (mm, positive). */
  readonly pitchMm: number
  /** Number of turns (positive, ≤ {@link COIL_MAX_TURNS}). */
  readonly turns: number
  /** Radial cut depth into the wall (mm, positive). */
  readonly depthMm: number
  /** Z height the coil starts at (mm, signed). Defaults to 0. */
  readonly zStartMm?: number
}

export interface CoilDialogProps extends FeatureDialogBaseProps {
  readonly params: CoilDialogParams
}

/**
 * Build the EXACT typed `coil_cut` op for the supplied params. Exported pure so
 * the op-builder test can round-trip the result through the REAL
 * `kernelPostSolidOpSchema` without rendering.
 *
 * `zStartMm` always emitted (the schema defaults it to 0, but emitting it keeps
 * the persisted op canonical and explicit — the operator's typed value, or the
 * 0 the dialog opened with). All callers parse their inputs first; this function
 * does no validation — it is the pure shape constructor the dialog and test share.
 */
export function buildCoilOp(params: {
  readonly centerXMm: number
  readonly centerYMm: number
  readonly majorRadiusMm: number
  readonly pitchMm: number
  readonly turns: number
  readonly depthMm: number
  readonly zStartMm: number
}): KernelPostSolidOp {
  return {
    kind: 'coil_cut',
    centerXMm: params.centerXMm,
    centerYMm: params.centerYMm,
    majorRadiusMm: params.majorRadiusMm,
    pitchMm: params.pitchMm,
    turns: params.turns,
    depthMm: params.depthMm,
    zStartMm: params.zStartMm
  }
}

export function CoilDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: CoilDialogProps): JSX.Element {
  void _selectionInfo // coil_cut is fully param-driven — no selection required

  const [centerXRaw, setCenterXRaw] = useState(String(params.centerXMm))
  const [centerYRaw, setCenterYRaw] = useState(String(params.centerYMm))
  const [majorRadiusRaw, setMajorRadiusRaw] = useState(String(params.majorRadiusMm))
  const [pitchRaw, setPitchRaw] = useState(String(params.pitchMm))
  const [turnsRaw, setTurnsRaw] = useState(String(params.turns))
  const [depthRaw, setDepthRaw] = useState(String(params.depthMm))
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))

  // Signed-finite params accept 0 / negatives; the radius/pitch/depth/turns must
  // be strictly positive (schema `mmPos`); turns is additionally capped at 100.
  const centerX = parseFiniteMm(centerXRaw)
  const centerY = parseFiniteMm(centerYRaw)
  const majorRadius = parsePositiveMm(majorRadiusRaw)
  const pitch = parsePositiveMm(pitchRaw)
  const turnsParsed = parsePositiveMm(turnsRaw)
  const turns = turnsParsed !== null && turnsParsed <= COIL_MAX_TURNS ? turnsParsed : null
  const depth = parsePositiveMm(depthRaw)
  const zStart = parseFiniteMm(zStartRaw)

  const allValid =
    centerX !== null &&
    centerY !== null &&
    majorRadius !== null &&
    pitch !== null &&
    turns !== null &&
    depth !== null &&
    zStart !== null

  const canApply = allValid && disabled !== true

  const handleApply = (): void => {
    if (
      centerX === null ||
      centerY === null ||
      majorRadius === null ||
      pitch === null ||
      turns === null ||
      depth === null ||
      zStart === null
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildCoilOp({
        centerXMm: centerX,
        centerYMm: centerY,
        majorRadiusMm: majorRadius,
        pitchMm: pitch,
        turns,
        depthMm: depth,
        zStartMm: zStart
      })
    })
  }

  // Honest, specific reason the Apply button is disabled (mirrors the other
  // dialogs' hint pattern — the operator is never left guessing).
  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : majorRadius === null
        ? 'Enter a positive major radius in millimetres.'
        : pitch === null
          ? 'Enter a positive pitch in millimetres.'
          : turnsParsed === null
            ? 'Enter a positive number of turns.'
            : turns === null
              ? `Turns must be ${COIL_MAX_TURNS} or fewer.`
              : depth === null
                ? 'Enter a positive cut depth in millimetres.'
                : centerX === null || centerY === null || zStart === null
                  ? 'Enter finite centre and Z-start values.'
                  : undefined

  return (
    <FeatureDialogCard title="Coil" testId="fd-coil_cut">
      <DialogNumberField
        label="Center X"
        value={centerXRaw}
        onChange={setCenterXRaw}
        testId="fd-coil_cut-centerX"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Center Y"
        value={centerYRaw}
        onChange={setCenterYRaw}
        testId="fd-coil_cut-centerY"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Major radius"
        value={majorRadiusRaw}
        onChange={setMajorRadiusRaw}
        testId="fd-coil_cut-majorRadius"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Pitch"
        value={pitchRaw}
        onChange={setPitchRaw}
        testId="fd-coil_cut-pitch"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Turns"
        value={turnsRaw}
        onChange={setTurnsRaw}
        testId="fd-coil_cut-turns"
        min={0}
        disabled={disabled}
      />
      <DialogNumberField
        label="Cut depth"
        value={depthRaw}
        onChange={setDepthRaw}
        testId="fd-coil_cut-depth"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-coil_cut-zStart"
        suffix="mm"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-coil_cut-note">
        Cuts a simplified coil — a stack of ring cuts marching up{' '}
        <code>+Z</code> from <code>Z start</code>, not a true swept section. The
        kernel caps the coil at {COIL_MAX_TURNS} turns. Applies to the current
        solid via the kernel timeline.
      </p>
      <DialogApplyRow
        label="Add coil"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-coil_cut-apply"
      />
    </FeatureDialogCard>
  )
}

export default CoilDialog
