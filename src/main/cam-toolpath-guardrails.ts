import { extractToolpathSegmentsFromGcode } from '../shared/cam-gcode-toolpath'
import type { ToolpathSegment3 } from '../shared/cam-gcode-toolpath'
import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from '../shared/cam-numeric-floors'

/**
 * CAM toolpath guardrails — numeric sanity and milling heuristics.
 *
 * Context (industry / HSM practice, summarized):
 * - **Radial engagement (stepover)** strongly affects cutting force and tool life; very small
 *   stepovers improve finish but explode path length; stepover larger than tool Ø skips stock.
 * - **Axial DOC** is strategy- and machine-specific; we do not override zPassMm here (sign
 *   differs by op: 2D vs waterline vs 4-axis radial).
 * - **Feeds** must be finite and positive to avoid invalid or stationary G1.
 *
 * These clamps prevent degenerate configs (zero stepover, absurd tool size) and reduce
 * runaway G-code size when stepover is far too small vs part span (see parallel-finish cap
 * in `cam-local.ts`).
 */

export const CAM_GUARDRAIL_TOOL_DIAM_MIN_MM = 0.05
export const CAM_GUARDRAIL_TOOL_DIAM_MAX_MM = 500

/** Minimum stepover (mm) — below this, passes become unstable / enormous file size. */
export const CAM_GUARDRAIL_STEPOVER_MIN_MM = 0.01

/**
 * Stepover must stay below tool Ø so adjacent passes overlap the stock envelope
 * (flat endmill; ignores corner-radius tools).
 */
export const CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL = 0.98

/** Floor as fraction of tool Ø — avoids near-zero stepover when user enters tiny values. */
export const CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL = 0.02

export const CAM_GUARDRAIL_FEED_MIN_MM_MIN = CAM_FEED_PLUNGE_FLOOR_MM_MIN
export const CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN = CAM_FEED_PLUNGE_FLOOR_MM_MIN
export const CAM_GUARDRAIL_SAFE_Z_MIN_MM = 0.05

/** Numeric slice of `CamJobConfig` (`cam-runner.ts`) that guardrails adjust. */
export type CamGuardrailJob = {
  toolDiameterMm?: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
}

export type CamToolpathGuardrailsResult<J extends CamGuardrailJob = CamGuardrailJob> = {
  job: J
  /** Non-empty when any field was clamped or coerced. */
  notes: string[]
}

function clampFinite(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

export function clampToolDiameterMm(raw: number | undefined, fallbackMm: number): { value: number; note?: string } {
  const base = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallbackMm
  const v = clampFinite(base, CAM_GUARDRAIL_TOOL_DIAM_MIN_MM, CAM_GUARDRAIL_TOOL_DIAM_MAX_MM)
  if (Math.abs(v - base) > 1e-6) {
    return { value: v, note: `tool Ø clamped to ${v.toFixed(3)} mm` }
  }
  return { value: v }
}

export function clampStepoverMm(stepoverMm: number, toolDiameterMm: number): { value: number; note?: string } {
  const d = Math.max(CAM_GUARDRAIL_TOOL_DIAM_MIN_MM, toolDiameterMm)
  const lo = Math.max(CAM_GUARDRAIL_STEPOVER_MIN_MM, d * CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL)
  const hi = d * CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL
  const v = clampFinite(stepoverMm, lo, hi)
  if (!Number.isFinite(stepoverMm) || Math.abs(v - stepoverMm) > 1e-6) {
    return { value: v, note: `stepover clamped ${stepoverMm} → ${v.toFixed(3)} mm (tool Ø ${d.toFixed(3)} mm)` }
  }
  return { value: v }
}

export function clampFeedPlungeSafeZ(input: {
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
}): { feedMmMin: number; plungeMmMin: number; safeZMm: number; notes: string[] } {
  const notes: string[] = []
  let feedMmMin = input.feedMmMin
  let plungeMmMin = input.plungeMmMin
  let safeZMm = input.safeZMm

  if (!Number.isFinite(feedMmMin) || feedMmMin < CAM_GUARDRAIL_FEED_MIN_MM_MIN) {
    notes.push(`feed raised to ${CAM_GUARDRAIL_FEED_MIN_MM_MIN} mm/min`)
    feedMmMin = CAM_GUARDRAIL_FEED_MIN_MM_MIN
  }
  if (!Number.isFinite(plungeMmMin) || plungeMmMin < CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN) {
    notes.push(`plunge raised to ${CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN} mm/min`)
    plungeMmMin = CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN
  }
  if (!Number.isFinite(safeZMm) || safeZMm < CAM_GUARDRAIL_SAFE_Z_MIN_MM) {
    notes.push(`safe Z raised to ${CAM_GUARDRAIL_SAFE_Z_MIN_MM} mm`)
    safeZMm = CAM_GUARDRAIL_SAFE_Z_MIN_MM
  }

  return { feedMmMin, plungeMmMin, safeZMm, notes }
}

/**
 * Warn when axial DOC (|zPassMm|) exceeds ball end mill radius.
 *
 * A ball end mill has its cutting edges only on the hemisphere: cutting deeper than the radius
 * (half the diameter) engages the shank, not the flute tip, producing very poor finish and
 * high deflection. Returns a diagnostic string when the condition is met, otherwise null.
 */
export function warnBallEndMillZPass(zPassMm: number, toolDiameterMm: number): string | null {
  if (!Number.isFinite(zPassMm) || !Number.isFinite(toolDiameterMm)) return null
  const toolRadius = toolDiameterMm / 2
  if (toolRadius <= 0) return null
  const depth = Math.abs(zPassMm)
  if (depth > toolRadius + 1e-6) {
    return `ball end mill DOC ${depth.toFixed(3)} mm exceeds tool radius ${toolRadius.toFixed(3)} mm — reduce zPassMm to ≤ ${toolRadius.toFixed(3)} mm`
  }
  return null
}

/**
 * Warn when axial DOC exceeds half the tool's flute length.
 *
 * Cutting deeper than flute_length / 2 engages the shank above the fluted zone,
 * causing rubbing, poor chip evacuation, tool deflection, and potential breakage.
 * Returns a diagnostic string when the condition is met, otherwise null.
 */
export function warnDocExceedsFluteLength(zPassMm: number, fluteLengthMm: number): string | null {
  if (!Number.isFinite(zPassMm) || !Number.isFinite(fluteLengthMm)) return null
  if (fluteLengthMm <= 0) return null
  const depth = Math.abs(zPassMm)
  const safeLimit = fluteLengthMm * 0.5
  if (depth > safeLimit + 1e-6) {
    return `DOC ${depth.toFixed(3)} mm exceeds flute length × 0.5 (${safeLimit.toFixed(3)} mm) — reduce zPassMm or use a longer flute to avoid shank rubbing`
  }
  return null
}

/**
 * Clamp feed and plunge rates to the machine's rated maximum.
 *
 * Machines have a physical maximum traverse speed; requesting a higher feed
 * rate either saturates the machine silently (Grbl clamps internally) or
 * causes alarm/fault on some controllers. Either way the requested rate is
 * never achieved, so we log it and cap proactively.
 */
export function clampFeedAndPlungeToMachineMax(
  feedMmMin: number,
  plungeMmMin: number,
  machineMaxFeedMmMin: number
): { feedMmMin: number; plungeMmMin: number; notes: string[] } {
  const notes: string[] = []
  if (!Number.isFinite(machineMaxFeedMmMin) || machineMaxFeedMmMin <= 0) {
    return { feedMmMin, plungeMmMin, notes }
  }
  const cap = machineMaxFeedMmMin
  let f = feedMmMin
  let p = plungeMmMin
  if (Number.isFinite(f) && f > cap) {
    notes.push(`feed clamped ${f.toFixed(0)} → ${cap.toFixed(0)} mm/min (machine max)`)
    f = cap
  }
  if (Number.isFinite(p) && p > cap) {
    notes.push(`plunge clamped ${p.toFixed(0)} → ${cap.toFixed(0)} mm/min (machine max)`)
    p = cap
  }
  return { feedMmMin: f, plungeMmMin: p, notes }
}

/**
 * Scan posted-G-code toolpath segments for G0 rapid moves that descend below the stock top surface.
 *
 * In the standard WCS convention (Z0 = stock top, negative Z = into material), a G0 rapid
 * ending at Z < stockTopZ means the controller will traverse at full rapid speed into or through
 * the workpiece — a crash risk. Feed moves (G1) are expected to go below stockTopZ; only rapids
 * are flagged here.
 *
 * When `stockXYBounds` is provided, only rapids whose end-point XY falls inside the stock footprint
 * are flagged (rapids outside the stock envelope are repositioning moves in air).
 *
 * @param segments   Parsed toolpath segments (from `extractToolpathSegmentsFromGcode`).
 * @param stockTopZ  Z value of the stock top surface (mm). Defaults to 0.
 * @param stockXYBounds  Optional XY footprint of the stock for false-positive suppression.
 * @returns Count of violations and depth of the most-extreme one found.
 */
export function detectRapidsBelowStockSurface(
  segments: ToolpathSegment3[],
  stockTopZ = 0,
  stockXYBounds?: { minX: number; maxX: number; minY: number; maxY: number }
): { count: number; worstZMm: number | null } {
  let count = 0
  let worstZ: number | null = null
  for (const s of segments) {
    if (s.kind !== 'rapid') continue
    if (s.z1 >= stockTopZ - 1e-6) continue
    if (stockXYBounds != null) {
      const { minX, maxX, minY, maxY } = stockXYBounds
      // Only flag if the rapid endpoint is within the XY stock footprint
      if (s.x1 < minX - 1e-6 || s.x1 > maxX + 1e-6 || s.y1 < minY - 1e-6 || s.y1 > maxY + 1e-6) continue
    }
    count++
    if (worstZ === null || s.z1 < worstZ) worstZ = s.z1
  }
  return { count, worstZMm: worstZ }
}

/**
 * Apply tool/stepover/feed/safe-Z guardrails to a CAM job. Does **not** change `zPassMm`
 * (operation-specific sign and meaning).
 */
export function applyCamToolpathGuardrails<J extends CamGuardrailJob>(job: J): CamToolpathGuardrailsResult<J> {
  const notes: string[] = []
  const fallbackTool = job.toolDiameterMm ?? 6
  const td = clampToolDiameterMm(job.toolDiameterMm, fallbackTool)
  if (td.note) notes.push(td.note)

  const so = clampStepoverMm(job.stepoverMm, td.value)
  if (so.note) notes.push(so.note)

  const fps = clampFeedPlungeSafeZ({
    feedMmMin: job.feedMmMin,
    plungeMmMin: job.plungeMmMin,
    safeZMm: job.safeZMm
  })
  notes.push(...fps.notes)

  const next = {
    ...job,
    toolDiameterMm: td.value,
    stepoverMm: so.value,
    feedMmMin: fps.feedMmMin,
    plungeMmMin: fps.plungeMmMin,
    safeZMm: fps.safeZMm
  } as J

  return { job: next, notes }
}

/**
 * Parse posted G-code and return a warning hint if any G0 rapid move descends below the
 * stock top surface (Z < stockTopZ). Intended for appending to the cam-runner result hint.
 * Returns an empty string when no violations are found.
 */
export function formatRapidBelowStockHintForPostedGcode(
  gcode: string,
  stockTopZ = 0,
  stockXYBounds?: { minX: number; maxX: number; minY: number; maxY: number }
): string {
  if (!gcode.trim()) return ''
  const segs = extractToolpathSegmentsFromGcode(gcode)
  const { count, worstZMm } = detectRapidsBelowStockSurface(segs, stockTopZ, stockXYBounds)
  if (count === 0) return ''
  return ` Rapid-into-stock warning: ${count} G0 rapid move${count > 1 ? 's' : ''} descend${count === 1 ? 's' : ''} below stock surface (worst Z ${worstZMm!.toFixed(3)} mm). Confirm G0/G1 assignment in post-processor or WCS Z0 setup — docs/MACHINES.md.`
}
