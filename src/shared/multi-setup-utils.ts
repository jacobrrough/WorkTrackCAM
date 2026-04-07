/**
 * Multi-Setup Automation Utilities
 *
 * Automates common multi-setup CNC workflows:
 * - WCS offset assignment (G54–G59)
 * - Setup sequence validation (conflict detection)
 * - Stock transfer computation between setups (bounding-box reduction)
 * - Flip setup generation (180° rotation with next available WCS)
 */

import type { ManufactureSetup } from './manufacture-schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WCS code strings corresponding to workCoordinateIndex 1–6. */
export const WCS_CODES = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'] as const
export type WcsCode = (typeof WCS_CODES)[number]

/** Maximum number of WCS offsets supported (G54–G59). */
export const MAX_WCS_OFFSETS = 6

/** Axis-aligned bounding box representing remaining stock. */
export interface StockBoundingBox {
  /** Stock extent along X (mm). */
  x: number
  /** Stock extent along Y (mm). */
  y: number
  /** Stock extent along Z (mm). */
  z: number
}

/** A validation issue found in a setup sequence. */
export interface SetupSequenceIssue {
  severity: 'error' | 'warning'
  setupId: string
  message: string
}

/** Result of setup sequence validation. */
export interface SetupSequenceValidation {
  valid: boolean
  issues: SetupSequenceIssue[]
}

/** A suggested flip setup generated from an existing setup. */
export interface FlipSetupSuggestion {
  /** Proposed setup (caller assigns final id). */
  setup: ManufactureSetup
  /** Which axis the flip was generated around. */
  flipAxis: 'X' | 'Y'
  /** Human-readable note about the flip. */
  note: string
}

// ---------------------------------------------------------------------------
// WCS Offset Assignment
// ---------------------------------------------------------------------------

/**
 * Automatically assign G54–G59 (workCoordinateIndex 1–6) to setups in order.
 *
 * Returns a new array of setups with `workCoordinateIndex` filled in.
 * Setups that already have a `workCoordinateIndex` keep their value;
 * unassigned setups receive the next available offset.
 *
 * Throws if more than 6 setups need offsets.
 */
export function autoAssignWcsOffsets(setups: readonly ManufactureSetup[]): ManufactureSetup[] {
  if (setups.length === 0) return []

  // Collect already-used indices
  const usedIndices = new Set<number>()
  for (const s of setups) {
    if (s.workCoordinateIndex !== undefined) {
      usedIndices.add(s.workCoordinateIndex)
    }
  }

  // Build pool of available indices (1–6 not already taken)
  const available: number[] = []
  for (let i = 1; i <= MAX_WCS_OFFSETS; i++) {
    if (!usedIndices.has(i)) available.push(i)
  }

  let poolIdx = 0
  const result: ManufactureSetup[] = []

  for (const s of setups) {
    if (s.workCoordinateIndex !== undefined) {
      result.push({ ...s })
    } else {
      if (poolIdx >= available.length) {
        throw new Error(
          `Cannot assign WCS offset to setup "${s.id}": all ${MAX_WCS_OFFSETS} offsets (G54–G59) are in use`
        )
      }
      result.push({ ...s, workCoordinateIndex: available[poolIdx]! })
      poolIdx++
    }
  }

  return result
}

/**
 * Convert a workCoordinateIndex (1–6) to its G-code string (G54–G59).
 * Returns undefined for out-of-range values.
 */
export function wcsIndexToCode(index: number): WcsCode | undefined {
  if (index < 1 || index > MAX_WCS_OFFSETS || !Number.isInteger(index)) return undefined
  return WCS_CODES[index - 1]
}

// ---------------------------------------------------------------------------
// Setup Sequence Validation
// ---------------------------------------------------------------------------

/**
 * Validate an ordered sequence of setups for common issues:
 * - Duplicate WCS offsets across setups
 * - Setups without any stock definition
 * - Setups exceeding G54–G59 range
 * - Consecutive setups that may need stock transfer info
 */
export function validateSetupSequence(setups: readonly ManufactureSetup[]): SetupSequenceValidation {
  const issues: SetupSequenceIssue[] = []

  if (setups.length === 0) {
    return { valid: true, issues: [] }
  }

  // Check for WCS conflicts (duplicate workCoordinateIndex)
  const wcsMap = new Map<number, string>() // index -> first setup id using it
  for (const s of setups) {
    if (s.workCoordinateIndex !== undefined) {
      const existing = wcsMap.get(s.workCoordinateIndex)
      if (existing) {
        issues.push({
          severity: 'error',
          setupId: s.id,
          message: `Duplicate WCS offset G${53 + s.workCoordinateIndex} — also used by setup "${existing}"`
        })
      } else {
        wcsMap.set(s.workCoordinateIndex, s.id)
      }
    }
  }

  // Check for missing stock definitions
  for (const s of setups) {
    if (!s.stock) {
      issues.push({
        severity: 'warning',
        setupId: s.id,
        message: 'No stock definition — CAM may not generate correct toolpaths'
      })
    }
  }

  // Check for setups beyond G54–G59 limit
  if (setups.length > MAX_WCS_OFFSETS) {
    issues.push({
      severity: 'error',
      setupId: setups[MAX_WCS_OFFSETS]!.id,
      message: `More than ${MAX_WCS_OFFSETS} setups — standard controllers only support G54–G59`
    })
  }

  // Check for consecutive setups that lack stock transfer context
  for (let i = 1; i < setups.length; i++) {
    const prev = setups[i - 1]!
    const curr = setups[i]!
    // If both have stock and machine IDs match, they're likely a multi-setup sequence
    // that needs stock transfer consideration
    if (prev.stock && curr.stock && prev.machineId === curr.machineId) {
      if (!curr.wcsNote && !curr.fixtureNote) {
        issues.push({
          severity: 'warning',
          setupId: curr.id,
          message: `Follows setup "${prev.id}" on same machine — consider adding WCS/fixture notes for the operator`
        })
      }
    }
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues
  }
}

// ---------------------------------------------------------------------------
// Stock Transfer Computation
// ---------------------------------------------------------------------------

/**
 * Extract a bounding box from a setup's stock definition.
 * Returns null if the setup has no stock or missing dimensions.
 */
export function extractStockBounds(setup: ManufactureSetup): StockBoundingBox | null {
  const stock = setup.stock
  if (!stock) return null

  switch (stock.kind) {
    case 'box':
    case 'fromExtents':
      if (stock.x != null && stock.y != null && stock.z != null) {
        return { x: stock.x, y: stock.y, z: stock.z }
      }
      return null
    case 'cylinder':
      // Represent cylinder as its enclosing box: length x diameter x diameter
      if (stock.x != null && stock.z != null) {
        return { x: stock.x, y: stock.z, z: stock.z }
      }
      return null
    default:
      return null
  }
}

/**
 * Compute the remaining stock bounding box after the previous setup's operations.
 *
 * Uses a simple heuristic: the previous setup's operations remove material from
 * the top (positive Z) face of the stock. The `maxCutDepthMm` parameter indicates
 * the deepest cut in the previous setup. The resulting stock has its Z reduced
 * by that depth.
 *
 * If no cut depth is provided, assumes the previous setup removed its full stock
 * Z extent (conservative estimate for planning only).
 *
 * The X and Y dimensions are preserved (bounding-box simplification — actual
 * remaining stock geometry would require full Boolean simulation).
 */
export function computeStockTransfer(
  prevSetup: ManufactureSetup,
  _nextSetup: ManufactureSetup,
  maxCutDepthMm?: number
): StockBoundingBox | null {
  const prevBounds = extractStockBounds(prevSetup)
  if (!prevBounds) return null

  const cutDepth = maxCutDepthMm ?? prevBounds.z * 0.5 // default: assume half-depth removal
  const remainingZ = Math.max(0, prevBounds.z - cutDepth)

  return {
    x: prevBounds.x,
    y: prevBounds.y,
    z: remainingZ
  }
}

// ---------------------------------------------------------------------------
// Flip Setup Suggestion
// ---------------------------------------------------------------------------

/**
 * Generate a suggested flip setup from the current setup.
 *
 * Flips the part 180° around the specified axis (default: X) to machine
 * the opposite face. Assigns the next available WCS offset.
 *
 * @param currentSetup - The setup to flip from
 * @param existingSetups - All current setups (for WCS offset assignment)
 * @param flipAxis - Axis to rotate around ('X' or 'Y', default 'X')
 */
export function suggestFlipSetup(
  currentSetup: ManufactureSetup,
  existingSetups: readonly ManufactureSetup[] = [],
  flipAxis: 'X' | 'Y' = 'X'
): FlipSetupSuggestion {
  // Find next available WCS index
  const usedIndices = new Set<number>()
  for (const s of existingSetups) {
    if (s.workCoordinateIndex !== undefined) {
      usedIndices.add(s.workCoordinateIndex)
    }
  }
  if (currentSetup.workCoordinateIndex !== undefined) {
    usedIndices.add(currentSetup.workCoordinateIndex)
  }

  let nextWcs: number | undefined
  for (let i = 1; i <= MAX_WCS_OFFSETS; i++) {
    if (!usedIndices.has(i)) {
      nextWcs = i
      break
    }
  }

  const flipLabel = `${currentSetup.label} (Flip ${flipAxis})`
  const flipId = `${currentSetup.id}-flip-${flipAxis.toLowerCase()}`

  // Build the flipped stock: for a 180° flip, the stock dimensions stay the same
  // but the WCS origin point changes (top → bottom reference)
  const flippedSetup: ManufactureSetup = {
    id: flipId,
    label: flipLabel,
    machineId: currentSetup.machineId,
    workCoordinateIndex: nextWcs,
    stock: currentSetup.stock ? { ...currentSetup.stock } : undefined,
    wcsOriginPoint: currentSetup.wcsOriginPoint === 'bottom-center' ? 'top-center' : 'bottom-center',
    wcsNote: `Flipped 180° around ${flipAxis} axis from "${currentSetup.label}"`,
    fixtureNote: currentSetup.fixtureNote,
    axisMode: currentSetup.axisMode
  }

  const wcsCode = nextWcs !== undefined ? wcsIndexToCode(nextWcs) : 'none available'
  const note = `Flip 180° around ${flipAxis}: WCS origin moved to ${flippedSetup.wcsOriginPoint ?? 'default'}, offset ${wcsCode}`

  return {
    setup: flippedSetup,
    flipAxis,
    note
  }
}
