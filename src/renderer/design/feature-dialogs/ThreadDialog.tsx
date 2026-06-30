/**
 * Tier-1 parity · Thread (`thread_wizard`) property dialog.
 *
 * The CadQuery kernel's thread wizard is a fully PARAM-DRIVEN post-solid op — it
 * cuts (or marks) a helical thread on the IMPLICIT current solid from numbers
 * alone. There is no face / profile / path pick to make: the helix is positioned
 * by `centerXMm` / `centerYMm` / `zStartMm`, sized by `majorRadiusMm` / `pitchMm`
 * / `lengthMm` / `depthMm`, and shaped by `hand` / `mode` / `starts`. So this
 * dialog drives EVERY schema field and emits a `KernelPostSolidOp` through the
 * EXISTING `appendKernelOp` path — no geometry selection required.
 *
 * Two real kernel paths (the schema's `mode` enum), both honest:
 *   - `modeled`   — a real helical cut around the +Z axis.
 *   - `cosmetic`  — a no-geometry marker row for UI / history parity (the kernel
 *                   emits no cut; the op still records the thread spec).
 *
 * The categorical thread-spec identifiers (`standard` / `designation` / `class`)
 * are `z.string().min(1)` in the schema. The kit has no free-text field, so the
 * dialog surfaces them as SELECTs seeded with the schema defaults plus the common
 * real-world choices (ISO/UTS · M/UNC/UNF/NPT · 6g/2A/…). Every option is a
 * non-empty string, so the emitted op is always schema-valid; a later cycle that
 * adds a text field to the kit can widen these without reshaping the dialog.
 *
 * Honesty note (CLAUDE.md "do not fake capability"): no field here is a dead
 * placeholder — the op consumes all of them. The selection banner is omitted on
 * purpose: this op takes no pick, and showing a "pick a face" prompt would imply
 * a capability the kernel does not use.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parseClampedInt,
  parseFiniteMm,
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

/** Thread cut direction — mirrors the schema's `threadHandSchema`. */
export type ThreadHand = 'right' | 'left'
/** Modeled helical cut vs. a cosmetic marker — mirrors `threadModeSchema`. */
export type ThreadMode = 'modeled' | 'cosmetic'

/** `starts` is an integer in `[1, 8]` (schema bound). */
export const THREAD_STARTS_MIN = 1
export const THREAD_STARTS_MAX = 8

/**
 * Categorical thread-spec option sets. Each value is a non-empty string so the
 * emitted op satisfies the schema's `z.string().min(1)`. The first entry of each
 * is the schema default, so a freshly-opened dialog round-trips the defaults.
 */
export const THREAD_STANDARD_OPTIONS = ['ISO', 'UTS', 'BSP', 'NPT'] as const
export const THREAD_DESIGNATION_OPTIONS = ['M', 'UNC', 'UNF', 'NPT', 'G'] as const
export const THREAD_CLASS_OPTIONS = ['6g', '6H', '4g6g', '2A', '2B', '3A', '3B'] as const

export interface ThreadDialogParams {
  /** Helix center X (mm, signed). */
  readonly centerXMm: number
  /** Helix center Y (mm, signed). */
  readonly centerYMm: number
  /** Major radius (mm, positive). */
  readonly majorRadiusMm: number
  /** Thread pitch (mm, positive). */
  readonly pitchMm: number
  /** Threaded length along +Z (mm, positive). */
  readonly lengthMm: number
  /** Cut depth / thread height (mm, positive). */
  readonly depthMm: number
  /** Z start of the threaded run (mm, signed). Defaults to 0. */
  readonly zStartMm?: number
  /** Cut hand. Defaults to `'right'`. */
  readonly hand?: ThreadHand
  /** Modeled vs. cosmetic. Defaults to `'modeled'`. */
  readonly mode?: ThreadMode
  /** Thread standard. Defaults to `'ISO'`. */
  readonly standard?: string
  /** Thread designation. Defaults to `'M'`. */
  readonly designation?: string
  /** Tolerance class. Defaults to `'6g'`. */
  readonly class?: string
  /** Number of starts (integer 1–8). Defaults to 1. */
  readonly starts?: number
}

export interface ThreadDialogProps extends FeatureDialogBaseProps {
  readonly params: ThreadDialogParams
}

/**
 * Build the EXACT typed `thread_wizard` `KernelPostSolidOp` from fully-parsed
 * values. Exported pure so the op-builder test can round-trip the result through
 * the REAL `kernelPostSolidOpSchema` without rendering. Every field is always
 * present (the op carries no optionals beyond `suppressed`, which the dialog does
 * not set), so this is a total mapping with no conditional keys.
 */
export function buildThreadOp(params: {
  readonly centerXMm: number
  readonly centerYMm: number
  readonly majorRadiusMm: number
  readonly pitchMm: number
  readonly lengthMm: number
  readonly depthMm: number
  readonly zStartMm: number
  readonly hand: ThreadHand
  readonly mode: ThreadMode
  readonly standard: string
  readonly designation: string
  readonly class: string
  readonly starts: number
}): KernelPostSolidOp {
  return {
    kind: 'thread_wizard',
    centerXMm: params.centerXMm,
    centerYMm: params.centerYMm,
    majorRadiusMm: params.majorRadiusMm,
    pitchMm: params.pitchMm,
    lengthMm: params.lengthMm,
    depthMm: params.depthMm,
    zStartMm: params.zStartMm,
    hand: params.hand,
    mode: params.mode,
    standard: params.standard,
    designation: params.designation,
    class: params.class,
    starts: params.starts
  }
}

export function ThreadDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: ThreadDialogProps): JSX.Element {
  void _selectionInfo // thread_wizard is fully param-driven — it takes no pick

  const [centerXRaw, setCenterXRaw] = useState(String(params.centerXMm))
  const [centerYRaw, setCenterYRaw] = useState(String(params.centerYMm))
  const [majorRadiusRaw, setMajorRadiusRaw] = useState(String(params.majorRadiusMm))
  const [pitchRaw, setPitchRaw] = useState(String(params.pitchMm))
  const [lengthRaw, setLengthRaw] = useState(String(params.lengthMm))
  const [depthRaw, setDepthRaw] = useState(String(params.depthMm))
  const [zStartRaw, setZStartRaw] = useState(String(params.zStartMm ?? 0))
  const [startsRaw, setStartsRaw] = useState(String(params.starts ?? THREAD_STARTS_MIN))
  const [hand, setHand] = useState<ThreadHand>(params.hand ?? 'right')
  const [mode, setMode] = useState<ThreadMode>(params.mode ?? 'modeled')
  const [standard, setStandard] = useState<string>(params.standard ?? THREAD_STANDARD_OPTIONS[0])
  const [designation, setDesignation] = useState<string>(
    params.designation ?? THREAD_DESIGNATION_OPTIONS[0]
  )
  const [threadClass, setThreadClass] = useState<string>(params.class ?? THREAD_CLASS_OPTIONS[0])

  // Signed (finite) for the positions; strictly-positive for the sizes; clamped
  // int for starts. A null on any required field gates Apply (no emit).
  const centerX = parseFiniteMm(centerXRaw)
  const centerY = parseFiniteMm(centerYRaw)
  const zStart = parseFiniteMm(zStartRaw)
  const majorRadius = parsePositiveMm(majorRadiusRaw)
  const pitch = parsePositiveMm(pitchRaw)
  const length = parsePositiveMm(lengthRaw)
  const depth = parsePositiveMm(depthRaw)
  const starts = parseClampedInt(startsRaw, THREAD_STARTS_MIN, THREAD_STARTS_MAX)

  const allValid =
    centerX !== null &&
    centerY !== null &&
    zStart !== null &&
    majorRadius !== null &&
    pitch !== null &&
    length !== null &&
    depth !== null &&
    starts !== null
  const canApply = allValid && disabled !== true

  const handleApply = (): void => {
    if (
      centerX === null ||
      centerY === null ||
      zStart === null ||
      majorRadius === null ||
      pitch === null ||
      length === null ||
      depth === null ||
      starts === null
    ) {
      return
    }
    onApply({
      target: 'kernelOp',
      op: buildThreadOp({
        centerXMm: centerX,
        centerYMm: centerY,
        majorRadiusMm: majorRadius,
        pitchMm: pitch,
        lengthMm: length,
        depthMm: depth,
        zStartMm: zStart,
        hand,
        mode,
        standard,
        designation,
        class: threadClass,
        starts
      })
    })
  }

  const applyHint =
    disabled === true
      ? 'Open a project and build a model first.'
      : !allValid
        ? 'Enter positive size values, finite positions, and a starts count of 1–8.'
        : undefined

  return (
    <FeatureDialogCard title="Thread" testId="fd-thread_wizard">
      <DialogNumberField
        label="Center X"
        value={centerXRaw}
        onChange={setCenterXRaw}
        testId="fd-thread_wizard-centerX"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Center Y"
        value={centerYRaw}
        onChange={setCenterYRaw}
        testId="fd-thread_wizard-centerY"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Major radius"
        value={majorRadiusRaw}
        onChange={setMajorRadiusRaw}
        testId="fd-thread_wizard-majorRadius"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Pitch"
        value={pitchRaw}
        onChange={setPitchRaw}
        testId="fd-thread_wizard-pitch"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Length"
        value={lengthRaw}
        onChange={setLengthRaw}
        testId="fd-thread_wizard-length"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Depth"
        value={depthRaw}
        onChange={setDepthRaw}
        testId="fd-thread_wizard-depth"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Z start"
        value={zStartRaw}
        onChange={setZStartRaw}
        testId="fd-thread_wizard-zStart"
        suffix="mm"
        disabled={disabled}
      />
      <DialogNumberField
        label="Starts"
        value={startsRaw}
        onChange={setStartsRaw}
        testId="fd-thread_wizard-starts"
        step="1"
        min={THREAD_STARTS_MIN}
        disabled={disabled}
      />
      <DialogSelectField<ThreadHand>
        label="Hand"
        value={hand}
        options={[
          { value: 'right', label: 'Right-hand' },
          { value: 'left', label: 'Left-hand' }
        ]}
        onChange={setHand}
        testId="fd-thread_wizard-hand"
        disabled={disabled}
      />
      <DialogSelectField<ThreadMode>
        label="Mode"
        value={mode}
        options={[
          { value: 'modeled', label: 'Modeled (helical cut)' },
          { value: 'cosmetic', label: 'Cosmetic (marker only)' }
        ]}
        onChange={setMode}
        testId="fd-thread_wizard-mode"
        disabled={disabled}
      />
      <DialogSelectField<string>
        label="Standard"
        value={standard}
        options={THREAD_STANDARD_OPTIONS.map((v) => ({ value: v, label: v }))}
        onChange={setStandard}
        testId="fd-thread_wizard-standard"
        disabled={disabled}
      />
      <DialogSelectField<string>
        label="Designation"
        value={designation}
        options={THREAD_DESIGNATION_OPTIONS.map((v) => ({ value: v, label: v }))}
        onChange={setDesignation}
        testId="fd-thread_wizard-designation"
        disabled={disabled}
      />
      <DialogSelectField<string>
        label="Class"
        value={threadClass}
        options={THREAD_CLASS_OPTIONS.map((v) => ({ value: v, label: v }))}
        onChange={setThreadClass}
        testId="fd-thread_wizard-class"
        disabled={disabled}
      />
      <p className="fd-note" data-testid="fd-thread_wizard-note">
        Cuts a helical thread on the current solid from these parameters (no face
        pick needed). <code>Cosmetic</code> mode records the thread spec as a
        history marker without cutting geometry.
      </p>
      <DialogApplyRow
        label="Add thread"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={applyHint}
        testId="fd-thread_wizard-apply"
      />
    </FeatureDialogCard>
  )
}

export default ThreadDialog
