/**
 * Plastic Boss (`plastic_boss`) property dialog — the Fusion-style front end for
 * the CadQuery kernel op that grows a cylindrical mounting boss (with an optional
 * concentric bore) on the IMPLICIT current solid.
 *
 * The op is a member of {@link KernelPostSolidOp}: it unions a draftable cylinder
 * onto whatever solid the timeline has built so far, positioned and sized from
 * NUMBERS alone (`centerXMm` / `centerYMm` / `zBaseMm`, `outerRadiusMm`,
 * `heightMm`, optional `holeRadiusMm`, `draftDeg`). There is no face / profile /
 * path pick to make, so this is a pure-params `kernelOp` dialog — no geometry
 * selection is required and there is NO honest-placeholder field: every schema
 * param is driveable from this form. It emits the op through the EXISTING
 * `appendKernelOp` path via `onApply({ target: 'kernelOp', op })`.
 *
 * Faithful field → schema mapping (`plasticBossSchema` in part-features-schema.ts):
 *   - `centerXMm` / `centerYMm` / `zBaseMm` → `mm`     (finite signed)  → parseFiniteMm
 *   - `outerRadiusMm` / `heightMm`         → `mmPos`   (finite > 0)     → parsePositiveMm
 *   - `holeRadiusMm`                       → `mmPos.optional()`         → parsePositiveMm, blank = omitted
 *   - `draftDeg`                           → finite, 0–8, default 1     → parseFiniteMm then clamp to [0, 8]
 *
 * Two honest dialog-level gates (mirroring what the KERNEL actually does in
 * `engines/occt/build_part.py` `_op_plastic_boss`, NOT a fake schema refine —
 * the bare schema accepts these, but the kernel would silently produce something
 * other than the operator asked for, so we block Apply and say why):
 *   1. `outerRadiusMm` and `heightMm` must be > 0 (the kernel skips the whole
 *      boss on a non-positive dimension — line `if outer <= 0 or height <= 0`).
 *   2. WHEN a hole radius is given, it must be `> 0` AND strictly `< outerRadiusMm`
 *      (the kernel only drills the bore when `0 < hole_f < outer`; otherwise the
 *      counterbore the operator typed is silently dropped). Leaving the hole blank
 *      is fine — that is a SOLID boss with no bore.
 *
 * `draftDeg` is a FLOAT in [0, 8] (not an integer), so it is parsed with
 * `parseFiniteMm` (finite) and clamped to the schema's [0, 8] bound here — that
 * keeps the emitted value schema-valid without a fake integer round-trip.
 */

import { useState, type JSX } from 'react'
import { DialogApplyRow, DialogNumberField, FeatureDialogCard } from './FeatureDialogKit'
import {
  parseFiniteMm,
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** `draftDeg` schema bound: a finite float in [0, 8]. */
export const PLASTIC_BOSS_DRAFT_MIN = 0
export const PLASTIC_BOSS_DRAFT_MAX = 8

/** Opening values for the boss. `holeRadiusMm`/`draftDeg` are optional (defaults applied). */
export interface PlasticBossDialogParams {
  /** Boss center X (mm, signed). */
  readonly centerXMm: number
  /** Boss center Y (mm, signed). */
  readonly centerYMm: number
  /** Z of the boss base (mm, signed). */
  readonly zBaseMm: number
  /** Outer radius (mm, > 0). */
  readonly outerRadiusMm: number
  /** Boss height along +Z (mm, > 0). */
  readonly heightMm: number
  /** Optional concentric bore radius (mm, > 0 and < outer). Blank ⇒ solid boss. */
  readonly holeRadiusMm?: number
  /** Wall draft angle (degrees, 0–8). Defaults to 1 (the schema default). */
  readonly draftDeg?: number
}

export interface PlasticBossDialogProps extends FeatureDialogBaseProps {
  readonly params: PlasticBossDialogParams
}

/** The fully-resolved boss inputs once every required field parses. */
export interface ResolvedBoss {
  readonly centerXMm: number
  readonly centerYMm: number
  readonly zBaseMm: number
  readonly outerRadiusMm: number
  readonly heightMm: number
  /** `null` ⇒ no bore (solid boss); a positive value ⇒ drill the concentric bore. */
  readonly holeRadiusMm: number | null
  readonly draftDeg: number
}

/**
 * Clamp a parsed draft angle into the schema's [0, 8] degree band. Pure +
 * exported so the op-builder test can pin the clamp without rendering.
 */
export function clampDraftDeg(deg: number): number {
  return Math.max(PLASTIC_BOSS_DRAFT_MIN, Math.min(PLASTIC_BOSS_DRAFT_MAX, deg))
}

/**
 * The kernel's own validity rule, in one place: a non-positive outer radius or
 * height is skipped outright, and a supplied bore must sit strictly inside the
 * boss (`0 < hole < outer`) or the kernel drops it. Mirrors `_op_plastic_boss`
 * so the dialog gates Apply with the same condition the geometry honours, rather
 * than emitting an op that silently builds the wrong thing. Returns `true` only
 * when the boss will build exactly as typed.
 */
export function bossIsValid(b: ResolvedBoss): boolean {
  if (b.outerRadiusMm <= 0 || b.heightMm <= 0) return false
  if (b.holeRadiusMm !== null && !(b.holeRadiusMm > 0 && b.holeRadiusMm < b.outerRadiusMm)) {
    return false
  }
  return true
}

/**
 * Build the EXACT typed `plastic_boss` op from the resolved inputs. Exported pure
 * so the op-builder test can round-trip the result through the REAL
 * `kernelPostSolidOpSchema` without rendering. `holeRadiusMm` is OMITTED when no
 * bore is requested (the schema's `mmPos.optional()` — absence means "solid
 * boss"); `suppressed` is never set here (the timeline owns it, not the dialog).
 */
export function buildPlasticBossOp(b: ResolvedBoss): KernelPostSolidOp {
  const base = {
    kind: 'plastic_boss',
    centerXMm: b.centerXMm,
    centerYMm: b.centerYMm,
    zBaseMm: b.zBaseMm,
    outerRadiusMm: b.outerRadiusMm,
    heightMm: b.heightMm,
    draftDeg: b.draftDeg
  } as const
  return b.holeRadiusMm !== null ? { ...base, holeRadiusMm: b.holeRadiusMm } : base
}

export function PlasticBossDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: PlasticBossDialogProps): JSX.Element {
  void _selectionInfo // plastic_boss is fully param-driven — it takes no pick

  const [centerXRaw, setCenterXRaw] = useState(String(params.centerXMm))
  const [centerYRaw, setCenterYRaw] = useState(String(params.centerYMm))
  const [zBaseRaw, setZBaseRaw] = useState(String(params.zBaseMm))
  const [outerRadiusRaw, setOuterRadiusRaw] = useState(String(params.outerRadiusMm))
  const [heightRaw, setHeightRaw] = useState(String(params.heightMm))
  // Optional bore — blank string means "no bore" (solid boss), so seed from the
  // optional param without coercing an absent value to a number.
  const [holeRadiusRaw, setHoleRadiusRaw] = useState(
    params.holeRadiusMm !== undefined ? String(params.holeRadiusMm) : ''
  )
  const [draftRaw, setDraftRaw] = useState(String(params.draftDeg ?? 1))

  // Signed (finite) positions; strictly-positive sizes; draft is a finite float
  // clamped to [0, 8]. A null on any REQUIRED field gates Apply (no emit).
  const centerX = parseFiniteMm(centerXRaw)
  const centerY = parseFiniteMm(centerYRaw)
  const zBase = parseFiniteMm(zBaseRaw)
  const outerRadius = parsePositiveMm(outerRadiusRaw)
  const height = parsePositiveMm(heightRaw)
  const draftParsed = parseFiniteMm(draftRaw)

  // The hole is OPTIONAL: a blank field is a valid "solid boss" (hole = null).
  // A non-blank field must parse to a positive number; an unparseable/non-positive
  // entry is treated as "invalid hole" so Apply gates rather than silently
  // dropping the operator's bore.
  const holeBlank = holeRadiusRaw.trim() === ''
  const holeParsed = holeBlank ? null : parsePositiveMm(holeRadiusRaw)
  const holeInvalid = !holeBlank && holeParsed === null

  const resolved: ResolvedBoss | null =
    centerX !== null &&
    centerY !== null &&
    zBase !== null &&
    outerRadius !== null &&
    height !== null &&
    draftParsed !== null &&
    !holeInvalid
      ? {
          centerXMm: centerX,
          centerYMm: centerY,
          zBaseMm: zBase,
          outerRadiusMm: outerRadius,
          heightMm: height,
          holeRadiusMm: holeParsed,
          draftDeg: clampDraftDeg(draftParsed)
        }
      : null

  const bossValid = resolved !== null && bossIsValid(resolved)
  const canApply = bossValid && disabled !== true

  const handleApply = (): void => {
    if (resolved === null || !bossIsValid(resolved)) return
    onApply({ target: 'kernelOp', op: buildPlasticBossOp(resolved) })
  }

  // Honest disabled-reason: distinguish "no project" from "a required field is
  // blank/non-numeric" from "the bore is not strictly inside the boss".
  const hint =
    disabled === true
      ? 'Open a project and build a model first.'
      : resolved === null
        ? 'Enter finite center/Z values, a positive outer radius, height, and draft; leave the hole blank or enter a positive bore.'
        : !bossValid
          ? 'The hole radius must be greater than 0 and smaller than the outer radius (or leave it blank for a solid boss).'
          : undefined

  return (
    <FeatureDialogCard title="Boss" testId="fd-plastic_boss">
      <DialogNumberField
        label="Center X"
        value={centerXRaw}
        onChange={setCenterXRaw}
        testId="fd-plastic_boss-centerX"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Center Y"
        value={centerYRaw}
        onChange={setCenterYRaw}
        testId="fd-plastic_boss-centerY"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Base Z"
        value={zBaseRaw}
        onChange={setZBaseRaw}
        testId="fd-plastic_boss-zBase"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Outer radius"
        value={outerRadiusRaw}
        onChange={setOuterRadiusRaw}
        testId="fd-plastic_boss-outerRadius"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Height"
        value={heightRaw}
        onChange={setHeightRaw}
        testId="fd-plastic_boss-height"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Hole radius (optional)"
        value={holeRadiusRaw}
        onChange={setHoleRadiusRaw}
        testId="fd-plastic_boss-holeRadius"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Draft angle"
        value={draftRaw}
        onChange={setDraftRaw}
        testId="fd-plastic_boss-draftDeg"
        step="0.5"
        min={PLASTIC_BOSS_DRAFT_MIN}
        suffix="°"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-plastic_boss-note">
        Grows a draftable cylindrical boss on the current solid (world mm — XY
        sketch plane, +Z up). Leave the hole blank for a solid boss; a bore is
        only drilled when its radius is between 0 and the outer radius. Draft is
        clamped to 0–8°.
      </p>
      <DialogApplyRow
        label="Add boss"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={hint}
        testId="fd-plastic_boss-apply"
      />
    </FeatureDialogCard>
  )
}

export default PlasticBossDialog
