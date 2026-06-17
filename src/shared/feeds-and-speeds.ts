/**
 * Feeds & speeds CALCULATOR — recommends spindle RPM + cutting/plunge feed for a
 * material + tool + machine, from the standard reference data already shipped for
 * the material-preset audit (`material-reference-data.ts`). Pure + deterministic.
 *
 * This is the operator-facing complement to `material-audit.ts`: the audit checks
 * whether a stored preset's numbers are sane; THIS computes fresh numbers a
 * machinist can apply to an op. Both read the SAME reference tables so they never
 * drift.
 *
 * Formulae (carbide, metric):
 *   - Surface speed SS (m/min) relates to spindle speed by  SS = π·D(mm)·RPM / 1000
 *     → **RPM = SS·1000 / (π·D)**.
 *   - Cutting feed  = RPM · flutes · chipLoad(mm/tooth).
 *   - Plunge feed   = cutting feed · plungeFactor (default 0.4).
 *
 * Safety posture: the result is ADVISORY — it never emits G-code. But because a
 * machinist may apply these numbers to a real op, every value is **clamped to the
 * machine's own spindle/feed limits** (`minSpindleRpm`/`maxSpindleRpm`/`maxFeedMmMin`
 * from the machine profile), and any clamp is surfaced in `notes` so the operator
 * knows the ideal target was unreachable. When a clamp moves RPM, the feed is
 * recomputed from the ACHIEVED RPM so the chip load the cut actually sees stays
 * correct (rather than silently over/under-feeding).
 */

import {
  SURFACE_SPEED_REFERENCE,
  CHIP_LOAD_REFERENCE,
  type AuditToolType
} from './material-reference-data'

export type FeedsSpeedsAggressiveness = 'conservative' | 'nominal' | 'aggressive'

/** Machine envelope the recommendation is clamped against (subset of MachineProfile). */
export interface FeedsSpeedsMachineLimits {
  /** Maximum feed rate (mm/min). Required. */
  maxFeedMmMin: number
  /** Spindle floor (RPM). Optional — when set, low recommendations clamp UP to it. */
  minSpindleRpm?: number
  /** Spindle ceiling (RPM). Optional — when set, high recommendations clamp DOWN to it. */
  maxSpindleRpm?: number
}

export interface FeedsSpeedsInput {
  /** Reference key (e.g. 'aluminum_6061', 'plywood', 'mdf'). See SURFACE_SPEED_REFERENCE. */
  materialKey: string
  /** Audit tool type. Use `mapToolTypeToAudit(rawKey)` from material-reference-data to derive it. */
  toolType: AuditToolType
  /** Cutter diameter (mm, > 0). */
  toolDiameterMm: number
  /** Machine spindle + feed limits to clamp against. */
  machine: FeedsSpeedsMachineLimits
  /** conservative=range-min · nominal=range-mid · aggressive=range-max. Default 'nominal'. */
  aggressiveness?: FeedsSpeedsAggressiveness
  /** Plunge feed as a fraction of cutting feed. Default 0.4; clamped to [0.05, 1]. */
  plungeFactor?: number
}

export type FeedsSpeedsResult =
  | {
      ok: true
      /** Recommended spindle speed (RPM), rounded, clamped to the machine spindle range. */
      spindleRpm: number
      /** Recommended cutting feed (mm/min), rounded, clamped to the machine max. */
      feedMmMin: number
      /** Recommended plunge feed (mm/min) = feed · plungeFactor, rounded. */
      plungeMmMin: number
      /** Tooth/flute count used (derived from toolType). */
      fluteCount: number
      /** Surface speed actually achieved at the (possibly clamped) RPM (m/min, 1 dp). */
      surfaceSpeedMMin: number
      /** Chip load used (mm/tooth, after diameter scaling). */
      chipLoadMm: number
      /** Whether/which way RPM was clamped to the spindle range. */
      rpmClamp: 'none' | 'raised_to_min' | 'lowered_to_max'
      /** True when the cutting feed hit the machine's max-feed ceiling. */
      feedClampedToMax: boolean
      /** Operator-facing advisories (clamps, diameter scaling, etc.). */
      notes: string[]
    }
  | { ok: false; reason: 'no_surface_speed_ref' | 'no_chip_load_ref' | 'invalid_input'; notes: string[] }

/** Effective tooth count per audit tool type (endmill flute count is in the name). */
const FLUTES: Record<AuditToolType, number> = {
  endmill_2f: 2,
  endmill_4f: 4,
  ball: 2,
  drill: 2
}

function pickRange(min: number, max: number, aggr: FeedsSpeedsAggressiveness): number {
  if (aggr === 'conservative') return min
  if (aggr === 'aggressive') return max
  return (min + max) / 2
}

/**
 * Chip-load diameter scale per the reference-data note: the tables assume a
 * 3–12 mm tool; below 3 mm halve the chip load, above 12 mm raise it ~1.5×.
 */
export function chipLoadDiameterScale(toolDiameterMm: number): number {
  if (toolDiameterMm < 3) return 0.5
  if (toolDiameterMm > 12) return 1.5
  return 1
}

export function computeFeedsAndSpeeds(input: FeedsSpeedsInput): FeedsSpeedsResult {
  const { materialKey, toolType, toolDiameterMm, machine } = input
  const aggr = input.aggressiveness ?? 'nominal'

  if (!Number.isFinite(toolDiameterMm) || toolDiameterMm <= 0) {
    return { ok: false, reason: 'invalid_input', notes: ['Tool diameter must be a positive number of mm.'] }
  }
  if (!Number.isFinite(machine.maxFeedMmMin) || machine.maxFeedMmMin <= 0) {
    return { ok: false, reason: 'invalid_input', notes: ['Machine maxFeedMmMin must be a positive number.'] }
  }

  const ss = SURFACE_SPEED_REFERENCE[materialKey]
  if (!ss) {
    return {
      ok: false,
      reason: 'no_surface_speed_ref',
      notes: [`No surface-speed reference for material "${materialKey}". Pick a known material or add it to the reference table.`]
    }
  }
  const clRef = CHIP_LOAD_REFERENCE[materialKey]?.[toolType]
  if (!clRef) {
    return {
      ok: false,
      reason: 'no_chip_load_ref',
      notes: [`No chip-load reference for material "${materialKey}" + tool type "${toolType}".`]
    }
  }

  const notes: string[] = []

  // Surface speed → ideal RPM.
  const surfaceSpeedTarget = pickRange(ss.minMMin, ss.maxMMin, aggr) // m/min
  let rpm = (surfaceSpeedTarget * 1000) / (Math.PI * toolDiameterMm)

  let rpmClamp: 'none' | 'raised_to_min' | 'lowered_to_max' = 'none'
  const { minSpindleRpm: minR, maxSpindleRpm: maxR } = machine
  if (typeof maxR === 'number' && rpm > maxR) {
    rpm = maxR
    rpmClamp = 'lowered_to_max'
    notes.push(
      `Ideal RPM (${Math.round((surfaceSpeedTarget * 1000) / (Math.PI * toolDiameterMm))}) exceeds the spindle max (${maxR}); clamped down — surface speed will run below ideal. Feed recomputed from the actual RPM to hold chip load.`
    )
  } else if (typeof minR === 'number' && rpm < minR) {
    rpm = minR
    rpmClamp = 'raised_to_min'
    notes.push(
      `Ideal RPM (${Math.round((surfaceSpeedTarget * 1000) / (Math.PI * toolDiameterMm))}) is below the spindle min (${minR}); clamped up — surface speed will run above ideal, watch heat and finish.`
    )
  }
  rpm = Math.round(rpm)

  // Chip load (diameter-scaled) → feed from the ACHIEVED rpm.
  const scale = chipLoadDiameterScale(toolDiameterMm)
  if (scale !== 1) {
    notes.push(`Chip load scaled ×${scale} for the ${toolDiameterMm} mm tool (reference assumes a 3–12 mm cutter).`)
  }
  const chipLoad = pickRange(clRef.minMm, clRef.maxMm, aggr) * scale // mm/tooth
  const fluteCount = FLUTES[toolType]

  let feed = rpm * fluteCount * chipLoad
  let feedClampedToMax = false
  if (feed > machine.maxFeedMmMin) {
    feed = machine.maxFeedMmMin
    feedClampedToMax = true
    notes.push(
      `Cutting feed clamped to the machine max (${machine.maxFeedMmMin} mm/min); the effective chip load will be below target — consider fewer flutes or a higher max feed.`
    )
  }
  feed = Math.round(feed)

  const plungeFactor = Math.min(1, Math.max(0.05, input.plungeFactor ?? 0.4))
  const plungeMmMin = Math.round(feed * plungeFactor)

  const surfaceSpeedAchieved = (Math.PI * toolDiameterMm * rpm) / 1000 // m/min

  return {
    ok: true,
    spindleRpm: rpm,
    feedMmMin: feed,
    plungeMmMin,
    fluteCount,
    surfaceSpeedMMin: Math.round(surfaceSpeedAchieved * 10) / 10,
    chipLoadMm: Math.round(chipLoad * 1_000_000) / 1_000_000,
    rpmClamp,
    feedClampedToMax,
    notes
  }
}
