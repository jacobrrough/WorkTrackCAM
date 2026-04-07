/**
 * Material preset accuracy audit — cross-references WorkTrackCAM material
 * cut parameters against standard machining reference data.
 *
 * Checks surface speed, chip load, and plunge factor safety for each
 * material + tool-type combination.
 */

import type { MaterialRecord } from './material-schema'
import {
  CHIP_LOAD_REFERENCE,
  SURFACE_SPEED_REFERENCE,
  mapToolTypeToAudit
} from './material-reference-data'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditSeverity = 'ok' | 'warn' | 'danger'

export interface MaterialAuditFinding {
  /** Material ID from the preset. */
  materialId: string
  /** Material human-readable name. */
  materialName: string
  /** Tool type key from cutParams (e.g. 'endmill', 'ball', 'default'). */
  toolType: string
  /** Which field was checked. */
  field: 'surfaceSpeed' | 'chipLoad' | 'plungeFactor'
  /** Actual value from the preset. */
  value: number
  /** Expected range midpoint or boundary. */
  expected: number
  /** How far off the value is from the acceptable range, as a percentage. */
  deviationPercent: number
  /** Severity based on the deviation threshold. */
  severity: AuditSeverity
}

export interface MaterialAuditResult {
  /** Total number of material + tool-type combos audited. */
  totalChecks: number
  /** Findings that are 'warn' or 'danger'. */
  issues: MaterialAuditFinding[]
  /** All findings including 'ok'. */
  allFindings: MaterialAuditFinding[]
}

// ---------------------------------------------------------------------------
// Tolerance thresholds
// ---------------------------------------------------------------------------

/** Acceptable deviation from the reference range boundaries. */
const WARN_TOLERANCE = 0.30  // 30% — within manufacturing variability
const DANGER_TOLERANCE = 0.60 // 60% — likely incorrect or dangerous

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Determine severity based on how far a value is from an acceptable range.
 *
 * @param value     The actual value to check.
 * @param rangeMin  Lower bound of the acceptable range.
 * @param rangeMax  Upper bound of the acceptable range.
 * @returns Severity and signed deviation percentage from the nearest boundary.
 */
function checkRange(
  value: number,
  rangeMin: number,
  rangeMax: number
): { severity: AuditSeverity; deviationPercent: number; nearestBound: number } {
  if (value >= rangeMin && value <= rangeMax) {
    const mid = (rangeMin + rangeMax) / 2
    const dev = mid !== 0 ? ((value - mid) / mid) * 100 : 0
    return { severity: 'ok', deviationPercent: Math.round(dev * 10) / 10, nearestBound: mid }
  }

  // Below range
  if (value < rangeMin) {
    const dev = rangeMin !== 0 ? ((rangeMin - value) / rangeMin) * 100 : 0
    const severity = dev > DANGER_TOLERANCE * 100 ? 'danger' : dev > WARN_TOLERANCE * 100 ? 'danger' : 'warn'
    return {
      severity,
      deviationPercent: Math.round(-dev * 10) / 10,
      nearestBound: rangeMin
    }
  }

  // Above range
  const dev = rangeMax !== 0 ? ((value - rangeMax) / rangeMax) * 100 : 0
  const severity = dev > DANGER_TOLERANCE * 100 ? 'danger' : dev > WARN_TOLERANCE * 100 ? 'danger' : 'warn'
  return {
    severity,
    deviationPercent: Math.round(dev * 10) / 10,
    nearestBound: rangeMax
  }
}

/**
 * Audit a list of material presets against standard machining reference data.
 *
 * For each material + tool type combo, checks:
 * 1. Surface speed (m/min) is within the reference range ±30%
 * 2. Chip load per tooth (mm) is within the reference range ±30%
 * 3. Plunge factor does not exceed 1.0 (plunge should not exceed lateral feed)
 *
 * @param materials  Array of material records to audit.
 * @returns Audit result with all findings and filtered issues.
 */
export function auditMaterialPresets(materials: MaterialRecord[]): MaterialAuditResult {
  const allFindings: MaterialAuditFinding[] = []
  let totalChecks = 0

  for (const mat of materials) {
    const sfmRef = SURFACE_SPEED_REFERENCE[mat.category]
    const chipRef = CHIP_LOAD_REFERENCE[mat.category]

    for (const [toolKey, cp] of Object.entries(mat.cutParams)) {
      totalChecks++
      const auditToolType = mapToolTypeToAudit(toolKey)

      // --- Surface speed check ---
      if (sfmRef) {
        // Widen the acceptable range by the tolerance
        const minAcceptable = sfmRef.minMMin * (1 - WARN_TOLERANCE)
        const maxAcceptable = sfmRef.maxMMin * (1 + WARN_TOLERANCE)
        const result = checkRange(cp.surfaceSpeedMMin, minAcceptable, maxAcceptable)
        allFindings.push({
          materialId: mat.id,
          materialName: mat.name,
          toolType: toolKey,
          field: 'surfaceSpeed',
          value: cp.surfaceSpeedMMin,
          expected: result.nearestBound,
          deviationPercent: result.deviationPercent,
          severity: result.severity
        })
      }

      // --- Chip load check ---
      if (chipRef && chipRef[auditToolType]) {
        const clRef = chipRef[auditToolType]
        const minAcceptable = clRef.minMm * (1 - WARN_TOLERANCE)
        const maxAcceptable = clRef.maxMm * (1 + WARN_TOLERANCE)
        const result = checkRange(cp.chiploadMm, minAcceptable, maxAcceptable)
        allFindings.push({
          materialId: mat.id,
          materialName: mat.name,
          toolType: toolKey,
          field: 'chipLoad',
          value: cp.chiploadMm,
          expected: result.nearestBound,
          deviationPercent: result.deviationPercent,
          severity: result.severity
        })
      }

      // --- Plunge factor safety check ---
      // Plunge rate should not exceed lateral feed rate (factor > 1.0)
      const plungeFactor = cp.plungeFactor ?? 0.3
      if (plungeFactor > 1.0) {
        const deviation = ((plungeFactor - 1.0) / 1.0) * 100
        allFindings.push({
          materialId: mat.id,
          materialName: mat.name,
          toolType: toolKey,
          field: 'plungeFactor',
          value: plungeFactor,
          expected: 1.0,
          deviationPercent: Math.round(deviation * 10) / 10,
          severity: 'danger'
        })
      } else {
        allFindings.push({
          materialId: mat.id,
          materialName: mat.name,
          toolType: toolKey,
          field: 'plungeFactor',
          value: plungeFactor,
          expected: 1.0,
          deviationPercent: 0,
          severity: 'ok'
        })
      }
    }
  }

  return {
    totalChecks,
    issues: allFindings.filter((f) => f.severity !== 'ok'),
    allFindings
  }
}
