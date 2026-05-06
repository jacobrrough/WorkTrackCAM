/**
 * Laguna Swift 5×10 — full-sheet stock preset registry ([ID-0014]).
 *
 * Captures industry-standard sheet dimensions (48 × 96 in plywood/MDF)
 * plus common thicknesses, and exposes helpers that convert a preset
 * into a `BoxStock`-shaped object plus a fixture-aware origin helper.
 * Pure data — zero React/Three.js/Electron imports; safe to consume
 * from main, renderer, and the cam-engine adapter alike.
 *
 * Machine envelope (CLAUDE.md USER CONTEXT §2):
 *   workAreaMm = { x: 1524, y: 3048, z: 203 }  (5 ft × 10 ft × ~8 in)
 *
 * A standard 48 × 96 in sheet is 1219.2 × 2438.4 mm (X × Y), which fits
 * within the envelope with 304.8 mm slack on X and 609.6 mm slack on Y.
 * The 90° rotated orientation (Y = 48 in, X = 96 in) does NOT fit
 * because 96 in = 2438.4 mm > X envelope 1524 mm — registry consumers
 * must call `fitsLagunaEnvelope` to detect this before placing stock.
 *
 * Safety Rule 2 (schema migrations): ADDITIVE module — no existing
 * project shape changes. Helpers return new plain objects whose `kind`
 * matches the existing `stockBoxSchema` discriminator; callers opt in
 * by importing.
 *
 * NEXT-UP follow-up [ID-0014b] tracks the 6-zone vacuum allocator
 * piece; this module intentionally scopes to the full-sheet planform
 * + thickness + fixture-aware origin slice so a single cycle stays
 * focused.
 */
import type { StockMaterialType } from './manufacture-schema'

/** Inch→mm conversion factor (exact per the international yard, 1959). */
export const LAGUNA_INCH_TO_MM = 25.4

/**
 * Bundled Laguna Swift 5×10 work envelope (mm). Mirrors the values in
 * `resources/machines/laguna-swift-5x10.json`. Pinned by tests so any
 * silent drift in the shipping JSON profile fails fast.
 */
export const LAGUNA_SWIFT_WORK_AREA_MM = {
  x: 1524,
  y: 3048,
  z: 203
} as const

/**
 * One entry in the sheet-planform registry. The (X, Y) pair is the
 * industry sheet size in mm with X mapped to the SHORT axis of the bed
 * and Y mapped to the LONG axis (matching the Laguna's 5 × 10 layout).
 *
 * The id is a stable string used as the React `key` on preset buttons
 * and as a telemetry tag; the label is the human-readable display
 * string (kept under ~24 chars so it fits a sidebar button).
 */
export interface LagunaSheetPlanform {
  readonly id: string
  readonly label: string
  /** X dimension in mm — along the SHORT (5 ft) axis of the bed. */
  readonly xMm: number
  /** Y dimension in mm — along the LONG (10 ft) axis of the bed. */
  readonly yMm: number
}

/**
 * One entry in the sheet-thickness registry. Common North-American
 * plywood / MDF thicknesses are listed in 1/4 in increments from 1/4 in
 * to 1 in. Metric users can override the Z by editing the resulting
 * `BoxStock` directly — the registry is a convenience, not a gate.
 */
export interface LagunaSheetThickness {
  readonly id: string
  readonly label: string
  readonly mm: number
}

/**
 * One entry in the sheet-material registry. Restricted to the two
 * materials operators actually buy in 4 × 8 ft sheets (plywood + MDF);
 * the broader `STOCK_MATERIAL_TYPES` enum still applies elsewhere.
 */
export interface LagunaSheetMaterial {
  readonly id: string
  readonly label: string
  readonly materialType: StockMaterialType
}

/**
 * The three planforms covered by the registry. Order matches the
 * preset-button display order on the Laguna My-Shop card (full sheet
 * first as the headline preset).
 */
export const LAGUNA_SHEET_PLANFORMS: readonly LagunaSheetPlanform[] = [
  {
    id: 'full-sheet-48x96',
    label: 'Full sheet (48 × 96 in)',
    xMm: 48 * LAGUNA_INCH_TO_MM,
    yMm: 96 * LAGUNA_INCH_TO_MM
  },
  {
    id: 'half-sheet-48x48',
    label: 'Half sheet (48 × 48 in)',
    xMm: 48 * LAGUNA_INCH_TO_MM,
    yMm: 48 * LAGUNA_INCH_TO_MM
  },
  {
    id: 'quarter-sheet-24x48',
    label: 'Quarter sheet (24 × 48 in)',
    xMm: 24 * LAGUNA_INCH_TO_MM,
    yMm: 48 * LAGUNA_INCH_TO_MM
  }
] as const

/** Common North-American sheet thicknesses, ascending. */
export const LAGUNA_SHEET_THICKNESSES: readonly LagunaSheetThickness[] = [
  { id: '1-4', label: '1/4 in (6.35 mm)', mm: 0.25 * LAGUNA_INCH_TO_MM },
  { id: '1-2', label: '1/2 in (12.7 mm)', mm: 0.5 * LAGUNA_INCH_TO_MM },
  { id: '3-4', label: '3/4 in (19.05 mm)', mm: 0.75 * LAGUNA_INCH_TO_MM },
  { id: '1', label: '1 in (25.4 mm)', mm: 1.0 * LAGUNA_INCH_TO_MM }
] as const

/** Plywood + MDF — the only sheet-stock materials the registry covers. */
export const LAGUNA_SHEET_MATERIALS: readonly LagunaSheetMaterial[] = [
  { id: 'plywood', label: 'Plywood', materialType: 'plywood' },
  { id: 'mdf', label: 'MDF', materialType: 'mdf' }
] as const

/** Result of a fit check against the Laguna envelope. */
export interface LagunaSheetFitResult {
  readonly fits: boolean
  /** Headroom on X in mm — negative means oversize. */
  readonly xSlackMm: number
  /** Headroom on Y in mm — negative means oversize. */
  readonly ySlackMm: number
  /** Headroom on Z in mm — negative means oversize. */
  readonly zSlackMm: number
  /**
   * Reason summary when fits=false; empty string when fits. Suitable
   * for direct display to the operator (no further interpolation).
   */
  readonly reason: string
}

/**
 * BoxStock-shaped result of `buildLagunaSheetBoxStock`. The `kind`
 * literal aligns with `stockBoxSchema` so the result drops into a
 * `ManufactureSetup.stock` field unchanged.
 */
export interface LagunaSheetBoxStock {
  readonly kind: 'box'
  readonly x: number
  readonly y: number
  readonly z: number
  readonly materialType?: StockMaterialType
}

/**
 * Origin offset (mm) returned by the fixture-aware origin helper. The
 * coordinates name the bottom-front-left corner of the stock in
 * machine coordinates; Z is always 0 because the Laguna's bed is the
 * Z = 0 datum.
 */
export interface LagunaSheetOriginMm {
  readonly xMm: number
  readonly yMm: number
  readonly zMm: 0
}

/**
 * Lookup helper — returns the planform with the given id, or undefined
 * when unknown. Defensive against IPC drift / stale UI state.
 */
export function getLagunaSheetPlanform(
  planformId: string
): LagunaSheetPlanform | undefined {
  return LAGUNA_SHEET_PLANFORMS.find((p) => p.id === planformId)
}

/** Lookup helper for thicknesses — same contract as the planform lookup. */
export function getLagunaSheetThickness(
  thicknessId: string
): LagunaSheetThickness | undefined {
  return LAGUNA_SHEET_THICKNESSES.find((t) => t.id === thicknessId)
}

/** Lookup helper for materials — same contract as the planform lookup. */
export function getLagunaSheetMaterial(
  materialId: string
): LagunaSheetMaterial | undefined {
  return LAGUNA_SHEET_MATERIALS.find((m) => m.id === materialId)
}

/**
 * Check whether a sheet of (xMm × yMm × zMm) plus a `marginMm` clamp
 * margin on each lateral axis fits within the bundled Laguna envelope.
 *
 * The clamp margin doubles each lateral axis — a single 25 mm clamp on
 * the front of the bed means the stock must end 25 mm shy of both the
 * front fence and (defensively) the back fence so the dust collection
 * gantry has space to traverse without striking. Operators with
 * single-side fixturing can pass marginMm = 0 to disable the doubling.
 *
 * Returns slack on each axis; positive slack = headroom, zero = exact
 * fit, negative slack = oversize. A negative slack on ANY axis sets
 * fits=false and produces a non-empty `reason`.
 *
 * Defensive: NaN / negative inputs collapse to 0 on the corresponding
 * axis; an oversize result is preferred over a silent NaN propagation.
 */
export function fitsLagunaEnvelope(
  xMm: number,
  yMm: number,
  zMm: number,
  marginMm: number = 0
): LagunaSheetFitResult {
  const safeX = Number.isFinite(xMm) && xMm > 0 ? xMm : 0
  const safeY = Number.isFinite(yMm) && yMm > 0 ? yMm : 0
  const safeZ = Number.isFinite(zMm) && zMm > 0 ? zMm : 0
  const safeMargin =
    Number.isFinite(marginMm) && marginMm > 0 ? marginMm : 0
  const xSlackMm = LAGUNA_SWIFT_WORK_AREA_MM.x - (safeX + 2 * safeMargin)
  const ySlackMm = LAGUNA_SWIFT_WORK_AREA_MM.y - (safeY + 2 * safeMargin)
  const zSlackMm = LAGUNA_SWIFT_WORK_AREA_MM.z - safeZ
  const reasons: string[] = []
  if (xSlackMm < 0) {
    reasons.push(
      `X oversize by ${(-xSlackMm).toFixed(1)} mm (envelope ${LAGUNA_SWIFT_WORK_AREA_MM.x} mm, stock ${(safeX + 2 * safeMargin).toFixed(1)} mm)`
    )
  }
  if (ySlackMm < 0) {
    reasons.push(
      `Y oversize by ${(-ySlackMm).toFixed(1)} mm (envelope ${LAGUNA_SWIFT_WORK_AREA_MM.y} mm, stock ${(safeY + 2 * safeMargin).toFixed(1)} mm)`
    )
  }
  if (zSlackMm < 0) {
    reasons.push(
      `Z oversize by ${(-zSlackMm).toFixed(1)} mm (envelope ${LAGUNA_SWIFT_WORK_AREA_MM.z} mm, stock ${safeZ.toFixed(1)} mm)`
    )
  }
  return {
    fits: reasons.length === 0,
    xSlackMm,
    ySlackMm,
    zSlackMm,
    reason: reasons.join('; ')
  }
}

/**
 * Build a `BoxStock`-shaped object from a planform + thickness ID. When
 * either ID is unknown, returns `null` so the caller can show a
 * recoverable error rather than throw across an IPC boundary.
 *
 * The optional `materialId` selects from `LAGUNA_SHEET_MATERIALS`; when
 * omitted, no `materialType` is set so the cam-engine fall-back logic
 * (defaults to material-agnostic feeds & speeds) kicks in.
 */
export function buildLagunaSheetBoxStock(
  planformId: string,
  thicknessId: string,
  materialId?: string
): LagunaSheetBoxStock | null {
  const planform = getLagunaSheetPlanform(planformId)
  const thickness = getLagunaSheetThickness(thicknessId)
  if (!planform || !thickness) return null
  const material = materialId ? getLagunaSheetMaterial(materialId) : undefined
  if (materialId && !material) return null
  const stock: LagunaSheetBoxStock = material
    ? {
        kind: 'box',
        x: planform.xMm,
        y: planform.yMm,
        z: thickness.mm,
        materialType: material.materialType
      }
    : {
        kind: 'box',
        x: planform.xMm,
        y: planform.yMm,
        z: thickness.mm
      }
  return stock
}

/**
 * Fixture-aware origin helper: maps a sheet of (sheetXMm × sheetYMm)
 * plus a `fixtureMarginMm` clamp/vacuum-pod margin to the bottom-
 * front-left corner of the stock in machine coordinates.
 *
 * Convention: the Laguna's machine zero is the back-left corner of the
 * bed; positive X advances toward the back, positive Y advances toward
 * the right. The operator clamps stock to the back-left fence with a
 * `fixtureMarginMm` standoff (typically 25 mm for a 1 in T-slot dog;
 * 0 for vacuum hold-down where the sheet sits flush with the corner).
 *
 * "Fixture-aware" means: the caller supplies the standoff; the helper
 * does not decide the margin for the operator. The returned offsets
 * are non-negative regardless of input signs (negative inputs collapse
 * to 0 — a margin can never push the origin off the bed).
 *
 * Z is always 0 because the Laguna's bed is the Z = 0 datum and the
 * stock sits ON the bed.
 */
export function lagunaFixtureAwareSheetOriginMm(
  sheetXMm: number,
  sheetYMm: number,
  fixtureMarginMm: number = 0
): LagunaSheetOriginMm {
  const safeMargin =
    Number.isFinite(fixtureMarginMm) && fixtureMarginMm > 0
      ? fixtureMarginMm
      : 0
  // The actual sheet size only matters for the fit check upstream; the
  // origin is the standoff regardless of stock dimensions. Suppress the
  // unused-args lint by reading into a dead variable so the public
  // signature stays self-documenting.
  void sheetXMm
  void sheetYMm
  return { xMm: safeMargin, yMm: safeMargin, zMm: 0 }
}

/**
 * One-shot helper: build the box stock + fit check + origin in a
 * single call. Returns `null` when the IDs are unknown (matches
 * `buildLagunaSheetBoxStock`).
 */
export interface LagunaFullSheetResolved {
  readonly stock: LagunaSheetBoxStock
  readonly fit: LagunaSheetFitResult
  readonly originMm: LagunaSheetOriginMm
}

export function resolveLagunaFullSheet(
  planformId: string,
  thicknessId: string,
  options: {
    readonly materialId?: string
    readonly fixtureMarginMm?: number
  } = {}
): LagunaFullSheetResolved | null {
  const stock = buildLagunaSheetBoxStock(
    planformId,
    thicknessId,
    options.materialId
  )
  if (!stock) return null
  const margin = options.fixtureMarginMm ?? 0
  const fit = fitsLagunaEnvelope(stock.x, stock.y, stock.z, margin)
  const originMm = lagunaFixtureAwareSheetOriginMm(stock.x, stock.y, margin)
  return { stock, fit, originMm }
}
