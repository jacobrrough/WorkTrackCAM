import type { ToolRecord } from './tool-schema'

/**
 * Rough milling feed estimate (mm/min) from surface speed, chipload, flutes, and tool diameter.
 * Returns undefined if inputs are incomplete.
 */
export function estimateFeedMmMinFromTool(rec: ToolRecord): number | undefined {
  const d = rec.diameterMm
  const ss = rec.surfaceSpeedMMin
  const cl = rec.chiploadMm
  const fl = rec.fluteCount != null && rec.fluteCount > 0 ? rec.fluteCount : 1
  if (ss == null || cl == null || !Number.isFinite(d) || d <= 0) return undefined
  const rpm = (ss * 1000) / (Math.PI * d)
  if (!Number.isFinite(rpm) || rpm <= 0) return undefined
  const v = rpm * fl * cl
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : undefined
}
