import type { MachineProfile } from '../../shared/machine-schema'
import { validateDialectCompliance } from '../../shared/gcode-dialect-compliance'

export type GcodeExportSafetyAssessment = {
  blockingErrors: string[]
  warnings: string[]
}

/**
 * Assess whether posted G-code is safe enough to allow export/send actions.
 * Dialect parser errors block immediately; non-fatal safety issues are warnings.
 */
export function assessGcodeForExportSafety(input: {
  gcode: string
  dialect: MachineProfile['dialect']
  safeRetractZMm: number
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

  return { blockingErrors, warnings }
}
