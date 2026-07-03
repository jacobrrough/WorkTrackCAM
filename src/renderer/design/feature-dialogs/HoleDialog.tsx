/**
 * FG-5b · Hole property dialog — HOLE WIZARD (Phase-3).
 *
 * The kernel op is `hole_from_profile { profileIndex, mode, depthMm?, zStartMm,
 * holeType, cbore/csink dims, tapDesignation? }`. It cuts a hole from an existing
 * sketch **profile** (typically a circle, referenced by its index in the payload
 * `profiles` array) either to a depth or through-all, and — new in Phase-3 —
 * adds a Fusion-style **counterbore** or **countersink** recess at the hole's
 * entry face.
 *
 * This dialog drives:
 *   - **Profile index** → which sketch profile to bore.
 *   - **Mode** → to-depth or through-all.
 *   - **Depth** (mm, only in depth mode) and **Z start** (mm).
 *   - **Hole type** → simple / counterbore / countersink (Fusion parity).
 *   - **Counterbore** → recess diameter + depth (must exceed the hole diameter).
 *   - **Countersink** → mouth diameter + included angle (82/90/100/120 typical).
 *   - **Tap designation** → METADATA ONLY (e.g. `M5x0.8`) recorded for drawings /
 *     CAM. It does NOT model a thread — a real modeled thread stays the Thread
 *     wizard's job (the note states this).
 *
 * Placing a hole on a picked face is still not supported — the hole comes from a
 * sketch profile index; that gap is flagged honestly. Emits `hole_from_profile`
 * through the existing `appendKernelOp` path.
 */

import { useId, useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard,
  SelectionContextBanner
} from './FeatureDialogKit'
import {
  parseClampedInt,
  parsePositiveMm,
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

type HoleMode = 'depth' | 'through_all'

/**
 * A labelled free-TEXT input (the kit only ships numeric / select fields). Used
 * for the tap designation, which is an arbitrary string (`M5x0.8`, `1/4-20`).
 * Reuses the kit's `.fd-field` classes so it looks identical to the other rows;
 * no inline styles (themed tokens only).
 */
function HoleTextField({
  label,
  value,
  onChange,
  testId,
  placeholder,
  disabled
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (raw: string) => void
  readonly testId: string
  readonly placeholder?: string
  readonly disabled?: boolean
}): JSX.Element {
  const id = useId()
  return (
    <div className="fd-field" data-testid={`${testId}-field`}>
      <label className="fd-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="fd-field__control">
        <input
          id={id}
          className="fd-field__input"
          data-testid={testId}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
export type HoleType = 'simple' | 'counterbore' | 'countersink'

/** Sensible defaults when a field is first shown (Fusion-style; edited freely). */
export const HOLE_DEFAULT_CBORE_DIAMETER_MM = 10
export const HOLE_DEFAULT_CBORE_DEPTH_MM = 4
export const HOLE_DEFAULT_CSINK_DIAMETER_MM = 10
export const HOLE_DEFAULT_CSINK_ANGLE_DEG = 90

/** Typical countersink included angles (free numeric entry still allowed). */
export const HOLE_CSINK_ANGLE_PRESETS = [82, 90, 100, 120] as const

export interface HoleDialogParams {
  /** Initial profile index to bore (0-based; range-checked vs payload profiles by the kernel). */
  readonly profileIndex: number
  /** Initial mode. Defaults to `'through_all'`. */
  readonly mode?: HoleMode
  /** Initial depth (mm) when mode is `'depth'`. Defaults to 10. */
  readonly depthMm?: number
  /** Initial Z-start (mm) of the bore. Defaults to 0. */
  readonly zStartMm?: number
  /** Initial hole type. Defaults to `'simple'` (legacy straight bore). */
  readonly holeType?: HoleType
  /** Initial counterbore diameter (mm). */
  readonly cboreDiameterMm?: number
  /** Initial counterbore depth (mm). */
  readonly cboreDepthMm?: number
  /** Initial countersink mouth diameter (mm). */
  readonly csinkDiameterMm?: number
  /** Initial countersink included angle (deg). */
  readonly csinkAngleDeg?: number
  /** Initial tap designation metadata (e.g. `M5x0.8`). */
  readonly tapDesignation?: string
}

export interface HoleDialogProps extends FeatureDialogBaseProps {
  readonly params: HoleDialogParams
}

/** The extra fields a counterbore / countersink hole carries when emitted. */
export interface HoleWizardFields {
  readonly holeType: HoleType
  readonly cboreDiameterMm?: number
  readonly cboreDepthMm?: number
  readonly csinkDiameterMm?: number
  readonly csinkAngleDeg?: number
  readonly tapDesignation?: string
}

/**
 * Build the emitted `hole_from_profile` op. Exported pure so the test can assert
 * the emitted shape (and its depth/through-all + hole-type branches) against the
 * schema. `depthMm` is included only in depth mode; only the fields the chosen
 * `holeType` needs are attached (a `simple` hole carries no cbore/csink fields,
 * so the persisted op stays canonical and back-compatible). `tapDesignation` is
 * metadata-only and attached whenever the operator entered one, for ANY hole
 * type.
 */
export function buildHoleOp(
  profileIndex: number,
  mode: HoleMode,
  depthMm: number,
  zStartMm: number,
  wizard: HoleWizardFields
): KernelPostSolidOp {
  const base =
    mode === 'depth'
      ? { kind: 'hole_from_profile' as const, profileIndex, mode: 'depth' as const, depthMm, zStartMm }
      : { kind: 'hole_from_profile' as const, profileIndex, mode: 'through_all' as const, zStartMm }

  const tap =
    typeof wizard.tapDesignation === 'string' && wizard.tapDesignation.trim() !== ''
      ? { tapDesignation: wizard.tapDesignation.trim() }
      : {}

  if (wizard.holeType === 'counterbore') {
    return {
      ...base,
      holeType: 'counterbore',
      cboreDiameterMm: wizard.cboreDiameterMm ?? HOLE_DEFAULT_CBORE_DIAMETER_MM,
      cboreDepthMm: wizard.cboreDepthMm ?? HOLE_DEFAULT_CBORE_DEPTH_MM,
      ...tap
    }
  }
  if (wizard.holeType === 'countersink') {
    return {
      ...base,
      holeType: 'countersink',
      csinkDiameterMm: wizard.csinkDiameterMm ?? HOLE_DEFAULT_CSINK_DIAMETER_MM,
      csinkAngleDeg: wizard.csinkAngleDeg ?? HOLE_DEFAULT_CSINK_ANGLE_DEG,
      ...tap
    }
  }
  // simple: keep the op minimal (holeType omitted → schema default 'simple').
  return { ...base, ...tap }
}

export function HoleDialog({
  params,
  selectionInfo,
  onApply,
  busy,
  disabled
}: HoleDialogProps): JSX.Element {
  const [profileRaw, setProfileRaw] = useState(String(params.profileIndex))
  const [mode, setMode] = useState<HoleMode>(params.mode ?? 'through_all')
  const [depthRaw, setDepthRaw] = useState(String(params.depthMm ?? 10))
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))
  const [holeType, setHoleType] = useState<HoleType>(params.holeType ?? 'simple')
  const [cboreDiaRaw, setCboreDiaRaw] = useState(
    String(params.cboreDiameterMm ?? HOLE_DEFAULT_CBORE_DIAMETER_MM)
  )
  const [cboreDepthRaw, setCboreDepthRaw] = useState(
    String(params.cboreDepthMm ?? HOLE_DEFAULT_CBORE_DEPTH_MM)
  )
  const [csinkDiaRaw, setCsinkDiaRaw] = useState(
    String(params.csinkDiameterMm ?? HOLE_DEFAULT_CSINK_DIAMETER_MM)
  )
  const [csinkAngleRaw, setCsinkAngleRaw] = useState(
    String(params.csinkAngleDeg ?? HOLE_DEFAULT_CSINK_ANGLE_DEG)
  )
  const [tapRaw, setTapRaw] = useState(params.tapDesignation ?? '')

  const profileIndex = parseClampedInt(profileRaw, 0, 255)
  const depth = parsePositiveMm(depthRaw)
  const zStart = parseFiniteMm(zStartRaw)
  const cboreDia = parsePositiveMm(cboreDiaRaw)
  const cboreDepth = parsePositiveMm(cboreDepthRaw)
  const csinkDia = parsePositiveMm(csinkDiaRaw)
  const csinkAngle = parseFiniteMm(csinkAngleRaw)

  const depthValid = mode !== 'depth' || depth !== null
  // Counterbore / countersink numeric fields must parse (they are shown only for
  // that type). Angle must be in (0, 180) to match the schema.
  const cboreValid =
    holeType !== 'counterbore' || (cboreDia !== null && cboreDepth !== null)
  const csinkValid =
    holeType !== 'countersink' ||
    (csinkDia !== null && csinkAngle !== null && csinkAngle > 0 && csinkAngle < 180)

  const canApply =
    profileIndex !== null &&
    zStart !== null &&
    depthValid &&
    cboreValid &&
    csinkValid &&
    disabled !== true

  const handleApply = (): void => {
    if (profileIndex === null || zStart === null) return
    if (mode === 'depth' && depth === null) return
    if (holeType === 'counterbore' && (cboreDia === null || cboreDepth === null)) return
    if (
      holeType === 'countersink' &&
      (csinkDia === null || csinkAngle === null || csinkAngle <= 0 || csinkAngle >= 180)
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildHoleOp(profileIndex, mode, depth ?? 0, zStart, {
        holeType,
        cboreDiameterMm: cboreDia ?? undefined,
        cboreDepthMm: cboreDepth ?? undefined,
        csinkDiameterMm: csinkDia ?? undefined,
        csinkAngleDeg: csinkAngle ?? undefined,
        tapDesignation: tapRaw
      })
    })
  }

  const applyHint = ((): string | undefined => {
    if (disabled === true) return 'Open a project and build a model first.'
    if (profileIndex === null) return 'Enter a profile index (0 or greater).'
    if (mode === 'depth' && depth === null) return 'Enter a positive depth in millimetres.'
    if (zStart === null) return 'Enter a finite Z-start in millimetres.'
    if (holeType === 'counterbore' && (cboreDia === null || cboreDepth === null)) {
      return 'Enter a positive counterbore diameter and depth (diameter must exceed the hole).'
    }
    if (holeType === 'countersink' && (csinkDia === null || csinkAngle === null)) {
      return 'Enter a positive countersink diameter and angle.'
    }
    if (holeType === 'countersink' && csinkAngle !== null && (csinkAngle <= 0 || csinkAngle >= 180)) {
      return 'Countersink angle must be between 0 and 180 degrees.'
    }
    return undefined
  })()

  return (
    <FeatureDialogCard title="Hole" testId="fd-hole">
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Holes are bored from an existing sketch profile (choose its index below)."
        note={
          selectionInfo.selection !== null
            ? 'Placing a hole on the picked face is not supported yet — bore from a sketch profile index below. (Gap: needs face-pick hole placement.)'
            : undefined
        }
        testId="fd-hole-selection"
      />
      <DialogNumberField
        label="Profile index"
        value={profileRaw}
        onChange={setProfileRaw}
        testId="fd-hole-profile"
        step="1"
        min={0}
        disabled={disabled}
      />
      <DialogSelectField<HoleMode>
        label="Depth mode"
        value={mode}
        options={[
          { value: 'through_all', label: 'Through all' },
          { value: 'depth', label: 'To depth' }
        ]}
        onChange={setMode}
        testId="fd-hole-mode"
        disabled={disabled}
      />
      {mode === 'depth' && (
        <DialogNumberField
          label="Depth"
          value={depthRaw}
          onChange={setDepthRaw}
          testId="fd-hole-depth"
          min={0}
          suffix="mm"
          disabled={disabled}
        />
      )}
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-hole-zstart"
        suffix="mm"
        disabled={disabled}
      />
      <DialogSelectField<HoleType>
        label="Hole type"
        value={holeType}
        options={[
          { value: 'simple', label: 'Simple (straight bore)' },
          { value: 'counterbore', label: 'Counterbore' },
          { value: 'countersink', label: 'Countersink' }
        ]}
        onChange={setHoleType}
        testId="fd-hole-type"
        disabled={disabled}
      />
      {holeType === 'counterbore' && (
        <>
          <DialogNumberField
            label="Counterbore diameter"
            value={cboreDiaRaw}
            onChange={setCboreDiaRaw}
            testId="fd-hole-cbore-dia"
            min={0}
            suffix="mm"
            disabled={disabled}
          />
          <DialogNumberField
            label="Counterbore depth"
            value={cboreDepthRaw}
            onChange={setCboreDepthRaw}
            testId="fd-hole-cbore-depth"
            min={0}
            suffix="mm"
            disabled={disabled}
          />
        </>
      )}
      {holeType === 'countersink' && (
        <>
          <DialogNumberField
            label="Countersink diameter"
            value={csinkDiaRaw}
            onChange={setCsinkDiaRaw}
            testId="fd-hole-csink-dia"
            min={0}
            suffix="mm"
            disabled={disabled}
          />
          <DialogNumberField
            label="Countersink angle"
            value={csinkAngleRaw}
            onChange={setCsinkAngleRaw}
            testId="fd-hole-csink-angle"
            min={0}
            suffix="°"
            disabled={disabled}
          />
        </>
      )}
      <HoleTextField
        label="Tap designation (metadata)"
        value={tapRaw}
        onChange={setTapRaw}
        testId="fd-hole-tap"
        placeholder="e.g. M5x0.8 (optional)"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-hole-note">
        {holeType === 'counterbore'
          ? 'Counterbore adds a flat-bottom recess at the entry face; the diameter must exceed the hole diameter.'
          : holeType === 'countersink'
            ? 'Countersink adds a cone at the entry face (typical included angles 82 / 90 / 100 / 120°); the diameter must exceed the hole diameter.'
            : 'Bores the selected sketch profile as a straight hole.'}{' '}
        Tap designation is metadata only (recorded for drawings / CAM) — it does
        not model a thread. Use the Thread wizard for a modeled thread.
      </p>
      <DialogApplyRow
        label="Add hole"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={applyHint}
        testId="fd-hole-apply"
      />
    </FeatureDialogCard>
  )
}

export default HoleDialog
