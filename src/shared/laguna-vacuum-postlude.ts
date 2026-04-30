/**
 * Laguna Swift 5x10 -- vacuum-zone post preamble / postamble emission
 * ([ID-0020-followup]).
 *
 * Companions `src/shared/laguna-vacuum-allocator.ts` (Cycle 98
 * [ID-0014b] -- 6-zone allocator) and
 * `src/renderer/src/laguna-vacuum-allocator-ui.ts` (Cycle 100
 * [ID-0020] -- renderer UI helpers). This module supplies the post
 * surface deferred by Cycle 100 per Safety Rule 1: it produces
 * deterministic operator-readable G-code preamble + postamble line
 * arrays that a future post-template wiring can splice into
 * `toolpathLines` BEFORE `renderPost` runs.
 *
 * Design choice -- pure helper, NOT a post-template edit:
 * The Cycle 100 close-out explicitly deferred direct edits to
 * `resources/posts/vcarve_mach3.hbs` because changing the template
 * implicitly mutates every Laguna G-code byte and would require
 * coordinated `PostContext` schema changes + cam-runner wiring +
 * golden-snapshot regeneration in a single cycle. Returning a
 * `string[]` lets the caller decide whether to inject the lines
 * (Safety Rule 1: G-code is sacred -- the toolpath bytes themselves
 * are still produced by the existing pipeline; this module only adds
 * documentation lines + optional digital-output M-codes around the
 * existing toolpath, never inside it).
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5x10 (the only target machine with a
 *   6-zone vacuum sheet bed). UNAFFECTED = Creality K2 Plus,
 *   Makera Carvera + 4th Axis (neither has a sheet-vacuum bed).
 *
 * Mach3 digital-output convention (RichAuto A-series compatible):
 * Mach3 honors `M64 P<n>` (immediate digital output ON) and
 * `M65 P<n>` (immediate digital output OFF) where `n` is the
 * digital-output index 0..N-1. The Laguna Swift 5x10 RichAuto
 * A-series controller accepts these as part of the Mach3-compatible
 * superset already documented in `resources/posts/vcarve_mach3.hbs`.
 *
 * **Digital-output P-number map** (column-major, mirrors the zone
 * registry order in `LAGUNA_VACUUM_ZONES`):
 *   X0Y0 -> P0   X0Y1 -> P1   X0Y2 -> P2
 *   X1Y0 -> P3   X1Y1 -> P4   X1Y2 -> P5
 *
 * SAFETY: digital-output emission is OFF by default. Wrong wiring
 * (the digital output is wired to a spindle relay, dust collector,
 * tool-change solenoid, etc. instead of a vacuum-zone valve) will
 * fire that device when the M-code runs -- a Safety Rule 1 hazard.
 * Operators must explicitly opt in via
 * `enableMach3DigitalOutputs: true` AFTER confirming the wiring
 * with a multimeter / control-panel walkthrough.
 *
 * Safety Rule 1 (G-code is sacred): UNTOUCHED -- this module emits
 * NO toolpath G-code; the lines it produces wrap the toolpath, never
 * mutate it. Off-by-default M-code emission keeps unwired
 * controllers safe (the always-on portion is semicolon comments
 * only, which Mach3 / RichAuto strips during parsing).
 *
 * Safety Rule 2 (schema migrations): ADDITIVE module -- no existing
 * project shape changes. Existing saved projects do not reference
 * any symbol from this file.
 */
import type { LagunaVacuumZoneAllocation } from './laguna-vacuum-allocator'
import { LAGUNA_VACUUM_ZONES } from './laguna-vacuum-allocator'

/** Stable open marker for the operator-facing preamble block. */
export const LAGUNA_VACUUM_PREAMBLE_OPEN =
  '; --- Laguna Swift 5x10 vacuum zone allocation ---'

/** Stable close marker for the operator-facing preamble block. */
export const LAGUNA_VACUUM_PREAMBLE_CLOSE =
  '; --- end vacuum zone allocation ---'

/** Stable open marker for the post-toolpath release block. */
export const LAGUNA_VACUUM_POSTAMBLE_OPEN =
  '; --- Laguna Swift 5x10 vacuum zone release ---'

/** Stable close marker for the post-toolpath release block. */
export const LAGUNA_VACUUM_POSTAMBLE_CLOSE =
  '; --- end vacuum zone release ---'

/**
 * Comment line warning the operator that the M64 / M65 lines below
 * fire Mach3 immediate digital outputs. ALWAYS emitted before any
 * M-code -- never silently absent.
 */
export const LAGUNA_VACUUM_MCODE_WARNING =
  '; OPERATOR: confirm wiring before running -- M64/M65 fire digital outputs'

/**
 * Operator hint emitted when `outsideEnvelope` is true on the
 * allocation -- the placed sheet hangs off the bed.
 */
export const LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING =
  '; WARNING: stock extends past bed envelope -- verify clamps before cycle start'

/**
 * Column-major P-number map -- index === insertion index in
 * `LAGUNA_VACUUM_ZONES`. Frozen so callers cannot mutate it.
 */
export const LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP: Readonly<
  Record<string, number>
> = Object.freeze(
  LAGUNA_VACUUM_ZONES.reduce<Record<string, number>>((acc, zone, index) => {
    acc[zone.id] = index
    return acc
  }, {})
)

/** Options passed into the preamble / postamble builders. */
export interface LagunaVacuumPostludeOptions {
  /**
   * When true, append `M64 P<n>` lines (preamble) and `M65 P<n>`
   * lines (postamble) for every engaged zone, in column-major order.
   * Default: false (semicolon comments only).
   */
  readonly enableMach3DigitalOutputs?: boolean
}

/**
 * Look up the Mach3 P-number for the given zone id. Returns null
 * for unknown zone ids so callers can defensively skip rather than
 * silently emitting `M64 PNaN`.
 */
export function lagunaVacuumZonePNumber(zoneId: string): number | null {
  if (typeof zoneId !== 'string' || zoneId.length === 0) return null
  const p = LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[zoneId]
  return typeof p === 'number' ? p : null
}

/**
 * Format the bed-coverage percentage as a 1-decimal string (clamped
 * to 0..100). Pure helper -- the operator-facing summary always uses
 * exactly one decimal place so the byte width is stable across
 * runs.
 */
function formatBedCoveragePercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0.0'
  const clamped = Math.max(0, Math.min(1, fraction))
  return (clamped * 100).toFixed(1)
}

/**
 * Build the operator-facing preamble line array. Always non-empty
 * (the open / close markers + the engagement summary are guaranteed
 * to appear); the body lines are deterministic in registry order.
 *
 * Line ordering (always identical, byte-stable for the same
 * allocation):
 *   1. open marker
 *   2. engagement summary -- "N of 6 zones engaged (X.X% bed coverage)"
 *   3. engaged-zones line (or "(none)" sentinel when 0 engaged)
 *   4. idle-zones line (or "(none)" sentinel when 0 idle)
 *   5. outside-envelope warning (only when allocation.outsideEnvelope === true)
 *   6. operator-confirm hint
 *   7. (optional) M-code warning + M64 P<n> lines per engaged zone
 *   8. close marker
 */
export function buildLagunaVacuumPreambleLines(
  allocation: LagunaVacuumZoneAllocation,
  options: LagunaVacuumPostludeOptions = {}
): string[] {
  const lines: string[] = []
  lines.push(LAGUNA_VACUUM_PREAMBLE_OPEN)
  const coverage = formatBedCoveragePercent(allocation.bedCoverageFraction)
  lines.push(
    `; ${allocation.engagedCount} of 6 zones engaged (${coverage}% bed coverage)`
  )
  const engagedList =
    allocation.engaged.length > 0 ? allocation.engaged.join(', ') : '(none)'
  lines.push(`; Engaged zones: ${engagedList}`)
  const idleList =
    allocation.idle.length > 0 ? allocation.idle.join(', ') : '(none)'
  lines.push(`; Idle zones:    ${idleList}`)
  if (allocation.outsideEnvelope) {
    lines.push(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)
  }
  lines.push(
    '; OPERATOR: confirm vacuum zones engaged on panel before cycle start'
  )
  if (options.enableMach3DigitalOutputs && allocation.engaged.length > 0) {
    lines.push(LAGUNA_VACUUM_MCODE_WARNING)
    for (const zoneId of allocation.engaged) {
      const p = lagunaVacuumZonePNumber(zoneId)
      if (p === null) continue
      lines.push(`M64 P${p}              ; engage ${zoneId}`)
    }
  }
  lines.push(LAGUNA_VACUUM_PREAMBLE_CLOSE)
  return lines
}

/**
 * Build the post-toolpath release line array. Mirrors the preamble
 * shape but emits M65 (immediate output OFF) when digital outputs
 * are enabled. Always non-empty.
 *
 * Line ordering (always identical, byte-stable for the same
 * allocation):
 *   1. open marker
 *   2. release summary -- "Releasing N zones"
 *   3. (optional) M-code warning + M65 P<n> lines per engaged zone
 *   4. close marker
 */
export function buildLagunaVacuumPostambleLines(
  allocation: LagunaVacuumZoneAllocation,
  options: LagunaVacuumPostludeOptions = {}
): string[] {
  const lines: string[] = []
  lines.push(LAGUNA_VACUUM_POSTAMBLE_OPEN)
  lines.push(`; Releasing ${allocation.engagedCount} zone(s)`)
  if (options.enableMach3DigitalOutputs && allocation.engaged.length > 0) {
    lines.push(LAGUNA_VACUUM_MCODE_WARNING)
    for (const zoneId of allocation.engaged) {
      const p = lagunaVacuumZonePNumber(zoneId)
      if (p === null) continue
      lines.push(`M65 P${p}              ; release ${zoneId}`)
    }
  }
  lines.push(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
  return lines
}

/**
 * Wrap an existing `toolpathLines` array with a vacuum-allocation
 * preamble + release postamble. The original lines are returned
 * unchanged in the middle slice -- Safety Rule 1: G-code is sacred,
 * so the toolpath bytes themselves are NEVER mutated by this helper.
 *
 * Caller pattern (for a future cam-runner wiring cycle):
 *
 *   const wrapped = wrapLagunaToolpathWithVacuumBlocks(
 *     toolpathLines,
 *     allocation,
 *     { enableMach3DigitalOutputs: false } // safe default
 *   )
 *   await renderPost(resourcesRoot, machine, wrapped, postOpts)
 */
export function wrapLagunaToolpathWithVacuumBlocks(
  toolpathLines: readonly string[],
  allocation: LagunaVacuumZoneAllocation,
  options: LagunaVacuumPostludeOptions = {}
): string[] {
  const preamble = buildLagunaVacuumPreambleLines(allocation, options)
  const postamble = buildLagunaVacuumPostambleLines(allocation, options)
  return [...preamble, ...toolpathLines, ...postamble]
}
