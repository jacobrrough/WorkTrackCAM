/**
 * Laguna Swift 5×10 — 6-zone vacuum allocator ([ID-0014b]).
 *
 * Companions `src/shared/laguna-full-sheet-stock.ts` (Cycle 97
 * [ID-0014] slice 1 of 2: full-sheet stock preset). This module
 * supplies slice 2 of 2: a deterministic mapping from a sheet placement
 * (origin + size) to which of the bed\u2019s six vacuum zones the operator
 * must engage so the stock is held down across its full footprint.
 *
 * Bed layout (CLAUDE.md USER CONTEXT §2):
 *   workAreaMm = { x: 1524, y: 3048, z: 203 }  (5 ft × 10 ft × ~8 in)
 *
 * The 6-zone vacuum table is the typical Laguna IQ / Swift sheet-bed
 * configuration: a 2 × 3 grid of independently-controlled vacuum
 * zones. The split is uniform across the bed (no asymmetry) so:
 *
 *   X axis (short, 1524 mm) → 2 columns of 762 mm each
 *   Y axis (long,  3048 mm) → 3 rows    of 1016 mm each
 *
 *   ┌──────────┬──────────┐  Y = 3048
 *   │  X0Y2    │  X1Y2    │
 *   ├──────────┼──────────┤  Y = 2032
 *   │  X0Y1    │  X1Y1    │
 *   ├──────────┼──────────┤  Y = 1016
 *   │  X0Y0    │  X1Y0    │
 *   └──────────┴──────────┘  Y =    0
 *  X = 0     X = 762     X = 1524
 *
 * Convention: machine zero is the back-left corner of the bed; +X
 * advances toward the back, +Y advances toward the right (matches
 * `lagunaFixtureAwareSheetOriginMm` in the sibling module).
 *
 * Engagement rule: a zone is ENGAGED iff the stock rectangle has a
 * STRICTLY POSITIVE area overlap with the zone rectangle. Edge-only
 * touching (zero area) does NOT engage — the operator\u2019s vacuum
 * sealing strips need real coverage, not a knife-edge contact, to
 * pull the sheet flat. This is intentionally conservative: false
 * negatives (a zone refused for an edge-touch alignment) are safe
 * (operator can still cap the zone manually); false positives
 * (engaging a zone with no stock above it) waste vacuum and can suck
 * dust through the table.
 *
 * Safety Rule 1 (G-code is sacred): UNTOUCHED — this module emits
 * NO G-code, touches NO post template, and does not load any machine
 * profile. The allocation is metadata for the operator\u2019s vacuum
 * panel; the cam-engine consumes it via a future UI integration.
 *
 * Safety Rule 2 (schema migrations): ADDITIVE module — no existing
 * project shape changes. The result type is new; consumers opt in by
 * importing.
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5×10 (the only target machine with a
 *   6-zone vacuum bed; the K2 Plus has a magnetic flexible build
 *   plate and the Carvera 4-axis has T-slot hold-down).
 *   UNAFFECTED = Creality K2 Plus, Makera Carvera + 4th Axis.
 */
import {
  LAGUNA_SWIFT_WORK_AREA_MM,
  buildLagunaSheetBoxStock,
  fitsLagunaEnvelope,
  getLagunaSheetPlanform,
  lagunaFixtureAwareSheetOriginMm
} from './laguna-full-sheet-stock'
import type {
  LagunaSheetFitResult,
  LagunaSheetOriginMm,
  LagunaSheetBoxStock
} from './laguna-full-sheet-stock'

/** Number of vacuum zones on the standard Laguna Swift 5×10 sheet bed. */
export const LAGUNA_VACUUM_ZONE_COUNT = 6

/** Number of zone columns along the X (short) axis. */
export const LAGUNA_VACUUM_ZONE_COLUMNS = 2

/** Number of zone rows along the Y (long) axis. */
export const LAGUNA_VACUUM_ZONE_ROWS = 3

/**
 * Width (X span) of a single vacuum zone in mm — derived from the bed
 * envelope and the column count so the constants stay in lock-step.
 *
 * 1524 / 2 = 762 mm.
 */
export const LAGUNA_VACUUM_ZONE_WIDTH_MM =
  LAGUNA_SWIFT_WORK_AREA_MM.x / LAGUNA_VACUUM_ZONE_COLUMNS

/**
 * Length (Y span) of a single vacuum zone in mm — derived from the bed
 * envelope and the row count so the constants stay in lock-step.
 *
 * 3048 / 3 = 1016 mm.
 */
export const LAGUNA_VACUUM_ZONE_LENGTH_MM =
  LAGUNA_SWIFT_WORK_AREA_MM.y / LAGUNA_VACUUM_ZONE_ROWS

/** Footprint area (mm²) of a single vacuum zone. */
export const LAGUNA_VACUUM_ZONE_AREA_MM2 =
  LAGUNA_VACUUM_ZONE_WIDTH_MM * LAGUNA_VACUUM_ZONE_LENGTH_MM

/**
 * One entry in the vacuum-zone registry. Bounds are CLOSED on the
 * minimum side and OPEN on the maximum side to avoid double-counting
 * the splits at X = 762 and Y = 1016 / 2032 — the helper math uses
 * strict positive-area overlap so the open/closed convention only
 * matters for documentation purposes.
 */
export interface LagunaVacuumZone {
  /** Stable zone id, e.g. \'X0Y0\'. */
  readonly id: string
  /** Operator-friendly label, e.g. \'Zone X0/Y0 (back-left)\'. */
  readonly label: string
  /** Column index along the X (short) axis: 0 = back, 1 = front. */
  readonly column: 0 | 1
  /** Row index along the Y (long) axis: 0 = left, 1 = mid, 2 = right. */
  readonly row: 0 | 1 | 2
  /** Inclusive minimum X bound (mm) of the zone footprint. */
  readonly xMinMm: number
  /** Exclusive maximum X bound (mm) of the zone footprint. */
  readonly xMaxMm: number
  /** Inclusive minimum Y bound (mm) of the zone footprint. */
  readonly yMinMm: number
  /** Exclusive maximum Y bound (mm) of the zone footprint. */
  readonly yMaxMm: number
}

/**
 * Friendly label for the (column, row) pair. Lifted out so the registry
 * builder is single-statement per zone and the labels stay in lock-step
 * across both axes.
 */
function zoneCornerLabel(column: 0 | 1, row: 0 | 1 | 2): string {
  const xLabel = column === 0 ? 'back' : 'front'
  const yLabel = row === 0 ? 'left' : row === 1 ? 'mid' : 'right'
  return `${xLabel}-${yLabel}`
}

/**
 * The six vacuum zones, ordered column-major (X0Y0, X0Y1, X0Y2, X1Y0,
 * X1Y1, X1Y2). The order is stable so callers can rely on index-based
 * iteration for UI rendering.
 */
export const LAGUNA_VACUUM_ZONES: readonly LagunaVacuumZone[] = (() => {
  const zones: LagunaVacuumZone[] = []
  for (let column = 0; column < LAGUNA_VACUUM_ZONE_COLUMNS; column += 1) {
    for (let row = 0; row < LAGUNA_VACUUM_ZONE_ROWS; row += 1) {
      const col = column as 0 | 1
      const r = row as 0 | 1 | 2
      const xMinMm = col * LAGUNA_VACUUM_ZONE_WIDTH_MM
      const yMinMm = r * LAGUNA_VACUUM_ZONE_LENGTH_MM
      zones.push({
        id: `X${col}Y${r}`,
        label: `Zone X${col}/Y${r} (${zoneCornerLabel(col, r)})`,
        column: col,
        row: r,
        xMinMm,
        xMaxMm: xMinMm + LAGUNA_VACUUM_ZONE_WIDTH_MM,
        yMinMm,
        yMaxMm: yMinMm + LAGUNA_VACUUM_ZONE_LENGTH_MM
      })
    }
  }
  return zones
})()

/**
 * Per-zone overlap descriptor returned by `allocateLagunaVacuumZones`.
 * `overlapAreaMm2` is the literal intersection area in mm²; engaged
 * zones have `overlapAreaMm2 > 0` strictly.
 */
export interface LagunaVacuumZoneOverlap {
  readonly id: string
  readonly engaged: boolean
  readonly overlapAreaMm2: number
  /** Fraction (0..1) of the zone\'s footprint covered by stock. */
  readonly zoneCoverageFraction: number
}

/** Allocator result describing which zones to engage / leave idle. */
export interface LagunaVacuumZoneAllocation {
  /** Engaged zone ids (positive-area overlap), preserving registry order. */
  readonly engaged: readonly string[]
  /** Idle zone ids (zero overlap), preserving registry order. */
  readonly idle: readonly string[]
  /** `engaged.length` for caller convenience (always 0..6). */
  readonly engagedCount: number
  /**
   * Total stock-over-bed area in mm² — the sum of every zone\'s
   * overlap area. Clipped to the bed envelope so out-of-bounds stock
   * does not inflate the count.
   */
  readonly totalOverlapMm2: number
  /**
   * Total bed area covered by the stock as a fraction (0..1) of the
   * full bed footprint (sum of all six zone areas). Useful for the UI
   * to display "X% of bed covered" without recomputing from raw mm².
   */
  readonly bedCoverageFraction: number
  /**
   * True iff every zone is engaged (full bed coverage). For a 48×96 in
   * sheet placed at (0, 0) on a 60×120 in bed this is true even though
   * the stock only covers ~80% of the bed — the sheet still touches
   * every zone.
   */
  readonly fullBedEngaged: boolean
  /**
   * True iff any portion of the stock rectangle extends past the bed
   * envelope. Engagement is computed against the CLIPPED stock so this
   * flag is the operator\'s "your sheet is hanging off the table"
   * warning, not an error.
   */
  readonly outsideEnvelope: boolean
  /** Per-zone overlap descriptors in registry order. */
  readonly zones: readonly LagunaVacuumZoneOverlap[]
}

/** Strict-positive-area overlap of two 1-D intervals; clamped to 0. */
function overlap1d(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number
): number {
  const lo = Math.max(aMin, bMin)
  const hi = Math.min(aMax, bMax)
  return hi > lo ? hi - lo : 0
}

/**
 * Compute the vacuum-zone allocation for a sheet placed at
 * `(originXMm, originYMm)` with footprint `(sizeXMm × sizeYMm)`.
 *
 * Inputs are defensive against NaN / Infinity / negative values:
 * - NaN / Infinity / negative origin collapses to 0 on that axis.
 * - NaN / Infinity / non-positive size collapses to 0 on that axis;
 *   a zero-size stock engages NO zones (no overlap area).
 *
 * The result preserves the registry ordering of zones in both
 * `engaged` and `idle`, and the per-zone `zones` array is exactly the
 * same length as `LAGUNA_VACUUM_ZONES`.
 *
 * Safety Rule 6 reminder: this helper does NOT touch the post template
 * or emit any G-code; it returns metadata only.
 */
export function allocateLagunaVacuumZones(
  originXMm: number,
  originYMm: number,
  sizeXMm: number,
  sizeYMm: number
): LagunaVacuumZoneAllocation {
  const safeOriginX =
    Number.isFinite(originXMm) && originXMm > 0 ? originXMm : 0
  const safeOriginY =
    Number.isFinite(originYMm) && originYMm > 0 ? originYMm : 0
  const safeSizeX =
    Number.isFinite(sizeXMm) && sizeXMm > 0 ? sizeXMm : 0
  const safeSizeY =
    Number.isFinite(sizeYMm) && sizeYMm > 0 ? sizeYMm : 0
  const stockXMin = safeOriginX
  const stockXMax = safeOriginX + safeSizeX
  const stockYMin = safeOriginY
  const stockYMax = safeOriginY + safeSizeY
  const outsideEnvelope =
    stockXMax > LAGUNA_SWIFT_WORK_AREA_MM.x ||
    stockYMax > LAGUNA_SWIFT_WORK_AREA_MM.y
  const engaged: string[] = []
  const idle: string[] = []
  const zones: LagunaVacuumZoneOverlap[] = []
  let totalOverlapMm2 = 0
  for (const zone of LAGUNA_VACUUM_ZONES) {
    const xOverlap = overlap1d(
      stockXMin,
      stockXMax,
      zone.xMinMm,
      zone.xMaxMm
    )
    const yOverlap = overlap1d(
      stockYMin,
      stockYMax,
      zone.yMinMm,
      zone.yMaxMm
    )
    const overlapAreaMm2 = xOverlap * yOverlap
    const isEngaged = overlapAreaMm2 > 0
    const zoneCoverageFraction = overlapAreaMm2 / LAGUNA_VACUUM_ZONE_AREA_MM2
    zones.push({
      id: zone.id,
      engaged: isEngaged,
      overlapAreaMm2,
      zoneCoverageFraction
    })
    totalOverlapMm2 += overlapAreaMm2
    if (isEngaged) engaged.push(zone.id)
    else idle.push(zone.id)
  }
  const bedAreaMm2 =
    LAGUNA_VACUUM_ZONE_AREA_MM2 * LAGUNA_VACUUM_ZONE_COUNT
  const bedCoverageFraction = totalOverlapMm2 / bedAreaMm2
  return {
    engaged,
    idle,
    engagedCount: engaged.length,
    totalOverlapMm2,
    bedCoverageFraction,
    fullBedEngaged: engaged.length === LAGUNA_VACUUM_ZONE_COUNT,
    outsideEnvelope,
    zones
  }
}

/** Return shape of `allocateLagunaVacuumZonesForSheet`. */
export interface LagunaSheetVacuumResolution {
  readonly stock: LagunaSheetBoxStock
  readonly fit: LagunaSheetFitResult
  readonly originMm: LagunaSheetOriginMm
  readonly allocation: LagunaVacuumZoneAllocation
}

/**
 * One-shot helper: from a planform id (and optional thickness/material/
 * fixture margin), compute the box stock + fit check + fixture-aware
 * origin + vacuum-zone allocation. Returns `null` when the planform or
 * thickness id is unknown (matches `buildLagunaSheetBoxStock`).
 *
 * Defaults `thicknessId` to `\'3-4\'` (3/4 in / 19.05 mm — the most
 * common sheet thickness in cabinet shops) so callers that only know
 * the planform can pass a single argument.
 */
export function allocateLagunaVacuumZonesForSheet(
  planformId: string,
  options: {
    readonly thicknessId?: string
    readonly materialId?: string
    readonly fixtureMarginMm?: number
  } = {}
): LagunaSheetVacuumResolution | null {
  const planform = getLagunaSheetPlanform(planformId)
  if (!planform) return null
  const thicknessId = options.thicknessId ?? '3-4'
  const stock = buildLagunaSheetBoxStock(
    planformId,
    thicknessId,
    options.materialId
  )
  if (!stock) return null
  const margin = options.fixtureMarginMm ?? 0
  const fit = fitsLagunaEnvelope(stock.x, stock.y, stock.z, margin)
  const originMm = lagunaFixtureAwareSheetOriginMm(stock.x, stock.y, margin)
  const allocation = allocateLagunaVacuumZones(
    originMm.xMm,
    originMm.yMm,
    stock.x,
    stock.y
  )
  return { stock, fit, originMm, allocation }
}
