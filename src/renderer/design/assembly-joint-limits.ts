/**
 * assembly-joint-limits — PURE authoring model for per-joint hard limits
 * (`AssemblyComponent.jointLimits`, `src/shared/assembly-schema.ts`).
 *
 * The schema + solver side of joint limits is DONE (schema fields with legacy
 * auto-migration; solver clamps in `assembly-solver-core.ts`; the
 * `assembly:simulate` sweep reads `jointLimits?.scalarMinDeg/…` per component).
 * What was missing is authoring: this module is the framework-free core of the
 * AssemblyView "Limits" row editor — which joint kinds have limitable DOF,
 * which `AssemblyJointLimits` keys each DOF uses, draft-string parsing +
 * validation, and the compact summary label. No React, no DOM, no IPC — the
 * node-env suite pins every branch with plain strings/objects.
 *
 * Field map (mirrors `inferJointLimitsFromLegacy` in assembly-schema.ts — the
 * one place the schema states which limits belong to which joint kind):
 *
 *   revolute    → scalarMinDeg / scalarMaxDeg              (1 rotational DOF)
 *   slider      → scalarMinMm  / scalarMaxMm               (1 translational DOF)
 *   cylindrical → slideMinMm/slideMaxMm + spinMinDeg/spinMaxDeg
 *   planar      → uMinMm/uMaxMm + vMinMm/vMaxMm
 *   universal   → angle1MinDeg/angle1MaxDeg + angle2MinDeg/angle2MaxDeg
 *   ball        → rxMinDeg/rxMaxDeg + ryMinDeg/ryMaxDeg + rzMinDeg/rzMaxDeg
 *   rigid / no joint → (no limitable DOF; the editor is hidden)
 *
 * Clear-to-unlimited: an all-blank draft parses to `limits: undefined`; the
 * editor pushes that as an EXPLICIT clear (empty `{}` on the row) so a
 * re-persist replaces any prior on-disk limits instead of silently keeping
 * them (`persistParts` preserves fields the view omits).
 */

import type { AssemblyComponent, AssemblyJointLimits } from '../../shared/assembly-schema'

/** The persisted joint kind on a part row (`AssemblyComponent.joint`). */
export type AssemblyJointKind = NonNullable<AssemblyComponent['joint']>

/**
 * One field name of the limits object. The schema exports `AssemblyJointLimits`
 * as the *optional* inferred type (`{…} | undefined`, since the Zod schema is
 * `.optional()`), so `keyof AssemblyJointLimits` collapses to `never`
 * (`keyof (T | undefined)` = `keyof T & keyof undefined` = `never`). Strip the
 * `undefined` arm first so the key union is the real 22 bound names — this is a
 * local, non-schema-touching fix (`assembly-schema.ts` is hands-off here).
 */
export type AssemblyJointLimitsKey = keyof NonNullable<AssemblyJointLimits>

/** Unit of one limitable DOF — phrases the input suffix + validation caps. */
export type LimitUnit = 'deg' | 'mm'

/** One limitable DOF of a joint kind: display label + the two schema keys. */
export type JointLimitField = {
  /** Short DOF label for the editor row (e.g. "Angle", "Slide", "Spin"). */
  readonly label: string
  readonly unit: LimitUnit
  /** `AssemblyJointLimits` key holding the lower bound. */
  readonly minKey: AssemblyJointLimitsKey
  /** `AssemblyJointLimits` key holding the upper bound. */
  readonly maxKey: AssemblyJointLimitsKey
}

/**
 * Sensible authoring caps. ±3600° allows ten full turns either way (enough for
 * any hinge/spin the shop's assemblies model) while catching unit mistakes
 * (e.g. typing mm-scale values into a degree field). ±10 000 mm (10 m) covers
 * the largest machine envelope in the shop (Laguna Swift 5x10 is ~3 m) with
 * headroom, while rejecting garbage magnitudes.
 */
export const LIMIT_MAX_ABS_DEG = 3600
export const LIMIT_MAX_ABS_MM = 10000

const FIELDS_BY_KIND: Readonly<Record<AssemblyJointKind, readonly JointLimitField[]>> = {
  rigid: [],
  revolute: [{ label: 'Angle', unit: 'deg', minKey: 'scalarMinDeg', maxKey: 'scalarMaxDeg' }],
  slider: [{ label: 'Travel', unit: 'mm', minKey: 'scalarMinMm', maxKey: 'scalarMaxMm' }],
  cylindrical: [
    { label: 'Slide', unit: 'mm', minKey: 'slideMinMm', maxKey: 'slideMaxMm' },
    { label: 'Spin', unit: 'deg', minKey: 'spinMinDeg', maxKey: 'spinMaxDeg' }
  ],
  planar: [
    { label: 'U', unit: 'mm', minKey: 'uMinMm', maxKey: 'uMaxMm' },
    { label: 'V', unit: 'mm', minKey: 'vMinMm', maxKey: 'vMaxMm' }
  ],
  universal: [
    { label: 'Angle 1', unit: 'deg', minKey: 'angle1MinDeg', maxKey: 'angle1MaxDeg' },
    { label: 'Angle 2', unit: 'deg', minKey: 'angle2MinDeg', maxKey: 'angle2MaxDeg' }
  ],
  ball: [
    { label: 'Rx', unit: 'deg', minKey: 'rxMinDeg', maxKey: 'rxMaxDeg' },
    { label: 'Ry', unit: 'deg', minKey: 'ryMinDeg', maxKey: 'ryMaxDeg' },
    { label: 'Rz', unit: 'deg', minKey: 'rzMinDeg', maxKey: 'rzMaxDeg' }
  ]
}

/**
 * The limitable DOF descriptors for a joint kind (declaration order = editor
 * row order). `[]` for `rigid` and for a row with no joint — those have no
 * free DOF to bound, so the Limits editor never renders for them.
 */
export function limitFieldsForJointKind(
  kind: AssemblyComponent['joint'] | undefined
): readonly JointLimitField[] {
  if (kind === undefined) return []
  return FIELDS_BY_KIND[kind] ?? []
}

/** Whether the Limits editor applies to this joint kind at all. */
export function jointKindHasLimits(kind: AssemblyComponent['joint'] | undefined): boolean {
  return limitFieldsForJointKind(kind).length > 0
}

/** Unit suffix as the operator reads it ("°" / "mm"). */
export function limitUnitSuffix(unit: LimitUnit): string {
  return unit === 'deg' ? '°' : 'mm'
}

/** The editor's draft: raw `<input type=number>` strings keyed by schema key. */
export type JointLimitsDraft = Readonly<Partial<Record<AssemblyJointLimitsKey, string>>>

/** Discriminated parse result of {@link parseJointLimitsDraft}. */
export type JointLimitsParse =
  | {
      readonly ok: true
      /** The authored limits, or `undefined` when every cell is blank (= unlimited). */
      readonly limits: AssemblyJointLimits | undefined
    }
  | { readonly ok: false; readonly error: string }

function capFor(unit: LimitUnit): number {
  return unit === 'deg' ? LIMIT_MAX_ABS_DEG : LIMIT_MAX_ABS_MM
}

/**
 * Parse one draft cell: blank/whitespace → `undefined` (that side unlimited);
 * otherwise a finite number within ±cap for the unit. Returns an error string
 * (naming the DOF + bound) instead of throwing.
 */
function parseCell(
  raw: string | undefined,
  field: JointLimitField,
  side: 'min' | 'max'
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const text = (raw ?? '').trim()
  if (text.length === 0) return { ok: true, value: undefined }
  const n = Number(text)
  const suffix = limitUnitSuffix(field.unit)
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${field.label} ${side} must be a number (${suffix}).` }
  }
  const cap = capFor(field.unit)
  if (Math.abs(n) > cap) {
    return { ok: false, error: `${field.label} ${side} must be within ±${cap}${suffix}.` }
  }
  return { ok: true, value: n }
}

/**
 * Parse + validate a full editor draft for a joint kind. Per DOF: each side is
 * optional (one-sided bounds are legal — the schema and the solver's
 * `resolveHandleBounds` both model them), but when BOTH sides are present the
 * min must be strictly below the max. An all-blank draft is a valid
 * "unlimited" authoring (`limits: undefined`) — the caller turns that into an
 * explicit clear. A kind with no limitable DOF parses to unlimited.
 */
export function parseJointLimitsDraft(
  kind: AssemblyComponent['joint'] | undefined,
  draft: JointLimitsDraft
): JointLimitsParse {
  const fields = limitFieldsForJointKind(kind)
  const out: Record<string, number> = {}
  for (const field of fields) {
    const min = parseCell(draft[field.minKey], field, 'min')
    if (!min.ok) return { ok: false, error: min.error }
    const max = parseCell(draft[field.maxKey], field, 'max')
    if (!max.ok) return { ok: false, error: max.error }
    if (min.value !== undefined && max.value !== undefined && min.value >= max.value) {
      const suffix = limitUnitSuffix(field.unit)
      return {
        ok: false,
        error: `${field.label}: min (${min.value}${suffix}) must be below max (${max.value}${suffix}).`
      }
    }
    if (min.value !== undefined) out[field.minKey] = min.value
    if (max.value !== undefined) out[field.maxKey] = max.value
  }
  const keys = Object.keys(out)
  if (keys.length === 0) return { ok: true, limits: undefined }
  return { ok: true, limits: out as AssemblyJointLimits }
}

/**
 * Seed an editor draft from a row's current limits: every key of the kind's
 * descriptors becomes a string cell ('' when unset) so controlled inputs never
 * flip between undefined/defined.
 */
export function jointLimitsToDraft(
  kind: AssemblyComponent['joint'] | undefined,
  limits: AssemblyJointLimits | undefined
): JointLimitsDraft {
  const draft: Partial<Record<AssemblyJointLimitsKey, string>> = {}
  for (const field of limitFieldsForJointKind(kind)) {
    const min = limits?.[field.minKey]
    const max = limits?.[field.maxKey]
    draft[field.minKey] = typeof min === 'number' && Number.isFinite(min) ? String(min) : ''
    draft[field.maxKey] = typeof max === 'number' && Number.isFinite(max) ? String(max) : ''
  }
  return draft
}

/**
 * Compact one-line summary of a row's authored limits in the kind's own units
 * — e.g. `"-90..90°"`, `"Slide 0..50mm · Spin -180..180°"`, or `"unlimited"`
 * when nothing is bounded. One-sided bounds render the open side as `∞`.
 * Single-DOF kinds omit the label (the unit already says which DOF it is).
 */
export function formatJointLimitsSummary(
  kind: AssemblyComponent['joint'] | undefined,
  limits: AssemblyJointLimits | undefined
): string {
  const fields = limitFieldsForJointKind(kind)
  const bits: string[] = []
  for (const field of fields) {
    const min = limits?.[field.minKey]
    const max = limits?.[field.maxKey]
    if (min === undefined && max === undefined) continue
    const lo = min !== undefined ? String(min) : '-∞'
    const hi = max !== undefined ? String(max) : '∞'
    const range = `${lo}..${hi}${limitUnitSuffix(field.unit)}`
    bits.push(fields.length > 1 ? `${field.label} ${range}` : range)
  }
  return bits.length > 0 ? bits.join(' · ') : 'unlimited'
}

/** True when the row carries at least one authored bound (drives the row chip). */
export function hasAuthoredLimits(
  kind: AssemblyComponent['joint'] | undefined,
  limits: AssemblyJointLimits | undefined
): boolean {
  if (limits === undefined) return false
  for (const field of limitFieldsForJointKind(kind)) {
    if (limits[field.minKey] !== undefined || limits[field.maxKey] !== undefined) return true
  }
  return false
}
