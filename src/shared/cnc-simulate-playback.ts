/**
 * Shared view-model for the CNC simulate workflow stage.
 *
 * `buildCncSimulatePlaybackModel` is a cheap, session-only pass over G-code
 * that extracts summary metrics for display and future full-vision features
 * (feed-rate heat-map, collision overlay, op-tree sync). It never re-emits
 * G-code and has no side effects.
 *
 * Delegates segment parsing to the battle-tested extractors in
 * `cam-gcode-toolpath.ts`; does NOT duplicate their logic.
 */

import { z } from 'zod'
import {
  extractToolpathSegmentsFromGcode,
  extractToolpathSegments4AxisFromGcode,
  totalToolpathLengthMm
} from './cam-gcode-toolpath'

// ──────────────────────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────────────────────

export const cncSimulatePlaybackModelSchema = z.object({
  /** Whether the toolpath was parsed as 3-axis (no A words) or 4-axis (A words present). */
  axisMode: z.enum(['3axis', '4axis']),

  /** Total number of parsed segments (G0/G1 lines + arc sub-segments). */
  segmentCount: z.number().int().nonnegative(),

  /** Sum of all segment lengths in millimetres. */
  totalLengthMm: z.number().nonnegative(),

  /**
   * Minimum and maximum feed rates (mm/min) found in F-words on G1 lines.
   * Null when no F-word was found (e.g. rapid-only toolpath or empty G-code).
   */
  feedRateRangeMmMin: z
    .object({ min: z.number(), max: z.number() })
    .nullable(),

  /**
   * Segment indices flagged for collision with the rotary fixture.
   * Empty array for the foundation slice; populated by the full-vision
   * collision overlay (see `rotary-collision.ts`).
   */
  collisionSegmentIndices: z.array(z.number().int()).readonly(),
})

export type CncSimulatePlaybackModel = z.infer<typeof cncSimulatePlaybackModelSchema>

// ──────────────────────────────────────────────────────────────────────────────
// Feed-rate extraction helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Scan G-code lines for F-word feed rates on G1 move lines.
 * Returns { min, max } or null if none found.
 */
function extractFeedRateRange(gcode: string): { min: number; max: number } | null {
  const lines = gcode.split(/\r?\n/)
  let min = Infinity
  let max = -Infinity
  let found = false

  for (const raw of lines) {
    const line = raw.trim()
    // Only consider G1 / G01 feed lines — rapids (G0/G00) do not carry a
    // meaningful programmed feed rate.
    if (!/^(G01|G1)(?=\s|[A-Z]|$)/i.test(line)) continue

    // Strip inline comments before matching F-words.
    const clean = line.replace(/\([^)]*\)/g, '')
    const m = clean.match(/F([+-]?\d+(?:\.\d+)?)/i)
    if (!m) continue
    const f = Number.parseFloat(m[1] ?? '')
    if (!Number.isFinite(f) || f <= 0) continue
    if (f < min) min = f
    if (f > max) max = f
    found = true
  }

  return found ? { min, max } : null
}

// ──────────────────────────────────────────────────────────────────────────────
// 4-axis detection helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the G-code contains any A-axis word on a motion line.
 * A single `A<number>` word is sufficient to classify the toolpath as 4-axis.
 */
function hasAAxisWords(gcode: string): boolean {
  const lines = gcode.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!/^(G00|G0|G01|G1)(?=\s|[A-Z]|$)/i.test(line)) continue
    const clean = line.replace(/\([^)]*\)/g, '')
    if (/A[+-]?\d/.test(clean)) return true
  }
  return false
}

// ──────────────────────────────────────────────────────────────────────────────
// Builder — public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the CNC simulate view-model from raw G-code output.
 *
 * @param gcode     Raw G-code string from `cam:run` (may be empty).
 * @param axisMode  Axis mode hint — overridden by A-word detection when the
 *                  caller passes `'3axis'` but the G-code contains A words.
 */
export function buildCncSimulatePlaybackModel(
  gcode: string,
  axisMode: '3axis' | '4axis'
): CncSimulatePlaybackModel {
  const trimmed = gcode.trim()

  if (trimmed.length === 0) {
    return {
      axisMode,
      segmentCount: 0,
      totalLengthMm: 0,
      feedRateRangeMmMin: null,
      collisionSegmentIndices: [],
    }
  }

  // Auto-upgrade to 4axis when A words are present.
  const resolvedMode: '3axis' | '4axis' =
    axisMode === '4axis' || hasAAxisWords(trimmed) ? '4axis' : '3axis'

  if (resolvedMode === '4axis') {
    const segs = extractToolpathSegments4AxisFromGcode(trimmed)
    return {
      axisMode: '4axis',
      segmentCount: segs.length,
      totalLengthMm: totalToolpathLengthMm(segs),
      feedRateRangeMmMin: extractFeedRateRange(trimmed),
      collisionSegmentIndices: [],
    }
  }

  // 3-axis (includes arc sub-segments from G2/G3 interpolation)
  const segs = extractToolpathSegmentsFromGcode(trimmed)
  return {
    axisMode: '3axis',
    segmentCount: segs.length,
    totalLengthMm: totalToolpathLengthMm(segs),
    feedRateRangeMmMin: extractFeedRateRange(trimmed),
    collisionSegmentIndices: [],
  }
}
