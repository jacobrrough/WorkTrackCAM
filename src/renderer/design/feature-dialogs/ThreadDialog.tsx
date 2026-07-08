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
 * Preset thread types (this cycle): a "Preset" select seeded with the standard
 * metric (ISO M3–M20) and imperial (UNC/UNF) sizes. Picking one fills the major
 * radius, pitch, depth, and the categorical spec (standard/designation/class)
 * from a canonical table so the operator doesn't hand-enter thread geometry;
 * editing any size afterwards drops the picker back to "Custom" (the value is
 * DERIVED from the live fields, never a stale label). See {@link THREAD_PRESETS}.
 *
 * Surface selection (this cycle): the dialog now surfaces the operator's live
 * pick in a {@link SelectionContextBanner} so "select a surface, then thread it"
 * reads honestly. Honesty note (CLAUDE.md "do not fake capability"): the kernel
 * `thread_wizard` op is PARAM-DRIVEN — it positions the helix by Center X/Y +
 * Z start, NOT by a face reference (a cylindrical face's centroid sits on the
 * surface, not the axis, and its radius isn't exposed — deriving center/radius
 * from the pick would emit wrong geometry). So the banner shows the pick for
 * CONTEXT with a note that the numbers below place the thread; it never fakes
 * face-driven placement. Every other field is consumed by the op — no dead
 * placeholders.
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

/**
 * A canonical thread preset: the geometry (major RADIUS = nominal diameter / 2,
 * pitch, and a modeled cut depth ≈ 0.6·pitch) plus the categorical spec. Every
 * value is exactly what the kernel op consumes, so picking a preset is just a
 * fast, correct fill — no new capability, no fake data.
 */
export interface ThreadPreset {
  readonly id: string
  readonly label: string
  readonly majorRadiusMm: number
  readonly pitchMm: number
  readonly depthMm: number
  readonly standard: string
  readonly designation: string
  readonly class: string
}

/** Sentinel value for the picker when the live fields match no preset. */
export const THREAD_PRESET_CUSTOM = 'custom'

const metric = (id: string, diaMm: number, pitchMm: number): ThreadPreset => ({
  id,
  label: `${id.toUpperCase()} × ${pitchMm}`,
  majorRadiusMm: diaMm / 2,
  pitchMm,
  depthMm: Math.round(0.6 * pitchMm * 1000) / 1000,
  standard: 'ISO',
  designation: 'M',
  class: '6g'
})

const imperial = (
  label: string,
  diaIn: number,
  tpi: number,
  designation: 'UNC' | 'UNF'
): ThreadPreset => {
  const pitchMm = Math.round((25.4 / tpi) * 1000) / 1000
  return {
    id: label.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
    label,
    majorRadiusMm: Math.round(((diaIn * 25.4) / 2) * 1000) / 1000,
    pitchMm,
    depthMm: Math.round(0.6 * pitchMm * 1000) / 1000,
    standard: 'UTS',
    designation,
    class: '2A'
  }
}

/**
 * Standard metric coarse (ISO M) + imperial (UNC/UNF) threads. Radius is half the
 * nominal major diameter; pitch is the coarse-series pitch (metric) or 25.4/TPI
 * (imperial). Kept small + common — the operator can still hand-tune any field.
 */
export const THREAD_PRESETS: readonly ThreadPreset[] = [
  metric('m3', 3, 0.5),
  metric('m4', 4, 0.7),
  metric('m5', 5, 0.8),
  metric('m6', 6, 1.0),
  metric('m8', 8, 1.25),
  metric('m10', 10, 1.5),
  metric('m12', 12, 1.75),
  metric('m16', 16, 2.0),
  metric('m20', 20, 2.5),
  imperial('1/4"-20 UNC', 0.25, 20, 'UNC'),
  imperial('5/16"-18 UNC', 0.3125, 18, 'UNC'),
  imperial('3/8"-16 UNC', 0.375, 16, 'UNC'),
  imperial('1/2"-13 UNC', 0.5, 13, 'UNC'),
  imperial('1/4"-28 UNF', 0.25, 28, 'UNF')
]

/**
 * DERIVE which preset (if any) the live major-radius + pitch match, so the picker
 * reflects the fields rather than a stale selection. Returns the preset id or
 * {@link THREAD_PRESET_CUSTOM}. Pure; exported for the unit test.
 */
export function matchThreadPreset(majorRadiusMm: number | null, pitchMm: number | null): string {
  if (majorRadiusMm === null || pitchMm === null) return THREAD_PRESET_CUSTOM
  const hit = THREAD_PRESETS.find(
    (p) => Math.abs(p.majorRadiusMm - majorRadiusMm) < 1e-3 && Math.abs(p.pitchMm - pitchMm) < 1e-3
  )
  return hit?.id ?? THREAD_PRESET_CUSTOM
}

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
  selectionInfo,
  onApply,
  busy,
  disabled
}: ThreadDialogProps): JSX.Element {
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

  // The picker reflects the LIVE size fields (derived), so hand-editing radius /
  // pitch drops it back to Custom automatically — never a stale label.
  const presetValue = matchThreadPreset(majorRadius, pitch)
  const applyPreset = (id: string): void => {
    if (id === THREAD_PRESET_CUSTOM) return
    const p = THREAD_PRESETS.find((x) => x.id === id)
    if (p === undefined) return
    setMajorRadiusRaw(String(p.majorRadiusMm))
    setPitchRaw(String(p.pitchMm))
    setDepthRaw(String(p.depthMm))
    setStandard(p.standard)
    setDesignation(p.designation)
    setThreadClass(p.class)
  }

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
      <SelectionContextBanner
        selectionInfo={selectionInfo}
        emptyPrompt="Optionally pick a cylindrical face first — the thread is placed by the values below."
        note="Positioned by Center X/Y + Z start (the kernel cuts a helix from these numbers, not from the pick)."
        testId="fd-thread_wizard-selection"
      />
      <DialogSelectField<string>
        label="Preset"
        value={presetValue}
        options={[
          { value: THREAD_PRESET_CUSTOM, label: '— Custom —' },
          ...THREAD_PRESETS.map((p) => ({ value: p.id, label: p.label }))
        ]}
        onChange={applyPreset}
        testId="fd-thread_wizard-preset"
        disabled={disabled}
      />
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
