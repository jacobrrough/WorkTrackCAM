import type { MachineProfile } from '../../shared/machine-schema'
import { validateDialectCompliance } from '../../shared/gcode-dialect-compliance'
import { extractToolpathSegmentsFromGcode } from '../../shared/cam-gcode-toolpath'
import { computeToolpathBoundsFromSegments } from '../../shared/cam-machine-envelope'

export type GcodeExportSafetyAssessment = {
  blockingErrors: string[]
  warnings: string[]
}

/**
 * Wave 3l — machine work-area HARD GATE.
 *
 * Parses the posted program's X/Y extents with the SAME shared helpers the
 * in-app advisory uses (`extractToolpathSegmentsFromGcode` →
 * `computeToolpathBoundsFromSegments`, see formatMachineEnvelopeHintForPostedGcode
 * in src/shared/cam-machine-envelope.ts) and returns BLOCKING errors when
 * the toolpath provably cannot fit the machine's X/Y travel. The advisory
 * hint stays for in-app preview; this is the send/export backstop.
 *
 * NEVER A FALSE BLOCK — the gate only fires on provable impossibility:
 *   - Blocks on `requiredTravel = max - min(min, 0) > workArea` per axis.
 *     With the work-origin (G54...) anywhere on the table at machine
 *     coordinate >= 0, a program needs `max` mm of travel past the origin
 *     plus `-min` mm before it; if that sum exceeds the axis travel, NO
 *     work-origin placement can reach every move. A merely-negative min
 *     within travel (operator zeroed mid-sheet) is NOT blocked — the
 *     existing advisory already flags below-origin extents as a warning.
 *   - Z is deliberately EXCLUDED: posted Z is WCS-relative (cut depths are
 *     negative below stock top), so a [0, workAreaZ] comparison cannot be
 *     made hard without modeling stock + WCS. Z stays advisory-only.
 *   - Skipped entirely (degrades to the pre-Wave-3l behavior) when the
 *     program never declares G90 — the shared segment parser assumes
 *     absolute coordinates, and every bundled post emits G90; without it
 *     the parsed extents are not trustworthy enough to hard-block on.
 *   - Skipped per-axis when the supplied work-area dimension is not a
 *     positive finite number, and entirely when the caller has no machine
 *     dims (optional input) or the program parses to no motion.
 */
function machineEnvelopeBlockingErrors(
  gcode: string,
  workAreaMm: MachineProfile['workAreaMm']
): string[] {
  if (!gcode.trim()) return []
  if (!/\bG90\b/.test(gcode)) return []
  const bounds = computeToolpathBoundsFromSegments(extractToolpathSegmentsFromGcode(gcode))
  if (!bounds) return []
  const errors: string[] = []
  const axes: Array<{ axis: 'X' | 'Y'; minMm: number; maxMm: number; travelMm: number }> = [
    { axis: 'X', minMm: bounds.minX, maxMm: bounds.maxX, travelMm: workAreaMm.x },
    { axis: 'Y', minMm: bounds.minY, maxMm: bounds.maxY, travelMm: workAreaMm.y }
  ]
  for (const a of axes) {
    if (!Number.isFinite(a.travelMm) || a.travelMm <= 0) continue
    const requiredTravelMm = a.maxMm - Math.min(a.minMm, 0)
    if (requiredTravelMm <= a.travelMm) continue
    const overshootMm = requiredTravelMm - a.travelMm
    errors.push(
      a.minMm >= 0
        ? `Toolpath exceeds the machine ${a.axis} work area: cuts reach ${a.axis}${a.maxMm.toFixed(1)} mm but the machine ${a.axis} travel is ${a.travelMm} mm — ${overshootMm.toFixed(1)} mm past the limit. Re-nest or move the layout inside the bed before sending.`
        : `Toolpath exceeds the machine ${a.axis} work area: cuts span ${requiredTravelMm.toFixed(1)} mm (${a.axis}${a.minMm.toFixed(1)} to ${a.axis}${a.maxMm.toFixed(1)} mm) but the machine ${a.axis} travel is ${a.travelMm} mm — ${overshootMm.toFixed(1)} mm more than the axis can move. No work-origin shift can make this fit.`
    )
  }
  return errors
}

/**
 * Assess whether posted G-code is safe enough to allow export/send actions.
 * Dialect parser errors block immediately; non-fatal safety issues are warnings.
 *
 * Wave 3l (intended drift): the input additively accepts the machine
 * profile's `workAreaMm`. When provided, posted X/Y extents that provably
 * exceed the machine travel become BLOCKING errors (appended after the
 * spindle/program-end checks) with the axis + overshoot named for the
 * operator. When absent, behavior is byte-identical to the previous
 * contract — callers without machine dims can never be false-blocked.
 */
export function assessGcodeForExportSafety(input: {
  gcode: string
  dialect: MachineProfile['dialect']
  safeRetractZMm: number
  workAreaMm?: MachineProfile['workAreaMm']
}): GcodeExportSafetyAssessment {
  const compliance = validateDialectCompliance(input.gcode, input.dialect)
  const blockingErrors = compliance
    .filter((issue) => issue.level === 'error')
    .map((issue) => `[${issue.code}] ${issue.message}`)
  const warnings = compliance
    .filter((issue) => issue.level === 'warning')
    .map((issue) => `[${issue.code}] ${issue.message}`)

  if (!/\bM5\b/.test(input.gcode)) {
    blockingErrors.push('Missing spindle stop (M5).')
  }
  if (!/\bM(?:2|30)\b/.test(input.gcode)) {
    blockingErrors.push('Missing program end (M2/M30).')
  }
  if (!/\bG90\b/.test(input.gcode)) {
    warnings.push('Absolute distance mode (G90) is not present in the posted file.')
  }
  if (!/\bG21\b|\bG20\b/.test(input.gcode)) {
    warnings.push('Units mode (G20/G21) is not explicitly set.')
  }
  const safeRetractRegex = new RegExp(`\\bG0\\s+Z${input.safeRetractZMm}(?:\\.0+)?\\b`)
  if (!safeRetractRegex.test(input.gcode)) {
    warnings.push(`Safe retract to machine max Z (G0 Z${input.safeRetractZMm}) not found.`)
  }
  if (input.workAreaMm) {
    blockingErrors.push(...machineEnvelopeBlockingErrors(input.gcode, input.workAreaMm))
  }

  return { blockingErrors, warnings }
}
