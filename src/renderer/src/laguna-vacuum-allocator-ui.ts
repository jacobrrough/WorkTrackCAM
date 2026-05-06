/**
 * laguna-vacuum-allocator-ui -- pure label / layout / clipboard helpers
 * for the Laguna Swift 5x10 6-zone vacuum allocator renderer surface
 * ([ID-0020]).
 *
 * Cycle 100 ui-polish. Closes the [ID-0014] arc end-to-end:
 *   slice 1 of 3 -- Cycle 97 [ID-0014] full-sheet stock preset registry
 *   slice 2 of 3 -- Cycle 98 [ID-0014b] 6-zone vacuum allocator data + helpers
 *   slice 3 of 3 -- Cycle 100 [ID-0020] renderer-side UI helpers (this file)
 *
 * Pure module: no React, no I/O, no `electron` import. The helpers turn
 * a `LagunaVacuumZoneAllocation` (returned by the shared allocator) into
 * the byte-stable strings + dimensionless coordinates a React surface
 * needs to render the vacuum-panel hint card. Mirrors the
 * `brand-bar-machine-badge` ui-polish pattern landed in Cycle 61.
 *
 * What this module does NOT do:
 *   1. It does NOT emit G-code or vacuum M-codes. The post template
 *      remains untouched per Safety Rule 1; the operator engages the
 *      zones manually on the Laguna control panel. Future post-side
 *      M-code work is tracked separately under the parent [ID-0020]
 *      root-cause path and is intentionally OUT OF SCOPE here.
 *   2. It does NOT consume `LAGUNA_SWIFT_WORK_AREA_MM` directly -- the
 *      coordinate helpers project zone bounds onto a 0..1 unit square
 *      so the renderer can scale to its own SVG / canvas viewport
 *      without re-importing the bed envelope on every frame.
 *   3. It does NOT mutate any input. All helpers return new objects.
 *
 * Pinned contract surface (see `laguna-vacuum-allocator-ui.test.ts`):
 *   1. `formatLagunaZoneTileLabel`     -> per-zone tile text (engaged %).
 *   2. `formatLagunaZoneTileTitle`     -> per-zone tooltip (operator hint).
 *   3. `formatLagunaZoneTileAriaLabel` -> per-zone screen-reader label.
 *   4. `formatLagunaVacuumPanelHeadline` -> "4 of 6 zones engaged".
 *   5. `formatLagunaBedCoverageSummary`  -> "53.3% of bed covered".
 *   6. `formatLagunaOutsideEnvelopeWarning` -> banner text or null.
 *   7. `formatLagunaEngagedZoneList`     -> "X0Y0, X0Y1, X1Y0, X1Y1".
 *   8. `formatLagunaOperatorClipboard`   -> paste-able instruction sheet.
 *   9. `lagunaZoneUnitSquareLayout`      -> 0..1 (col, row, w, h) per zone.
 *  10. `LAGUNA_VACUUM_ZONE_TILE_STATUS_*` -> stable status string consts.
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5x10 (the only target machine with a 6-zone
 *   vacuum bed). UNAFFECTED = K2 Plus, Carvera + 4th Axis.
 */

import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_COLUMNS,
  LAGUNA_VACUUM_ZONE_COUNT,
  LAGUNA_VACUUM_ZONE_ROWS,
  type LagunaVacuumZone,
  type LagunaVacuumZoneAllocation,
  type LagunaVacuumZoneOverlap
} from '../../shared/laguna-vacuum-allocator'

/**
 * Stable status string for an ENGAGED zone tile. Pinned so CSS class
 * selectors (`[data-status="engaged"]`) and snapshot tests stay in
 * lock-step across the renderer.
 */
export const LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED = 'engaged'

/**
 * Stable status string for an IDLE zone tile. The operator does NOT
 * activate idle zones (would waste vacuum and risk sucking dust through
 * the table per the engagement rule documented in the shared module).
 */
export const LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE = 'idle'

/**
 * Banner copy when the placed stock rectangle extends past the bed
 * envelope. Operator-facing (not screen-reader-only) so the wording
 * mirrors the existing Laguna sheet-stock UI tone: direct, no jargon.
 */
export const LAGUNA_OUTSIDE_ENVELOPE_BANNER =
  'Sheet hangs off the bed -- the engaged-zone preview reflects the in-bounds portion only.'

/**
 * Pinned headline template fragments. Lifted out so the test surface
 * can pin the byte-identical wording without duplicating the literal
 * string, and so a future i18n pass can swap the formatters without
 * touching every helper.
 */
export const LAGUNA_VACUUM_PANEL_NOUN = 'zones'
export const LAGUNA_VACUUM_PANEL_VERB = 'engaged'

/** Dimensionless 0..1 layout descriptor for a single zone tile. */
export interface LagunaZoneUnitSquareCell {
  /** Zone id mirrored from the registry, e.g. "X0Y0". */
  readonly id: string
  /** Column index (0..1) along the X / SHORT bed axis. */
  readonly column: 0 | 1
  /** Row index (0..2) along the Y / LONG bed axis. */
  readonly row: 0 | 1 | 2
  /** Left edge of the tile in unit-square coordinates (0..1). */
  readonly xUnit: number
  /** Top edge of the tile in unit-square coordinates (0..1). */
  readonly yUnit: number
  /** Tile width in unit-square coordinates (always 1 / columns). */
  readonly widthUnit: number
  /** Tile height in unit-square coordinates (always 1 / rows). */
  readonly heightUnit: number
}

/**
 * Project the registry onto a 0..1 unit square so the renderer can scale
 * to its own SVG / canvas viewport. The unit square is oriented so that
 * X = 0 is the LEFT edge of the SVG and Y = 0 is the TOP edge -- this
 * matches the SVG / CSS coordinate convention rather than the Laguna
 * machine convention (where +Y advances toward the right).
 *
 * Concretely, this means the row index 0 (Y = 0..1016 mm on the bed)
 * lands at the BOTTOM of the SVG (yUnit = 2/3 .. 1) and row index 2
 * (Y = 2032..3048 mm on the bed) lands at the TOP (yUnit = 0 .. 1/3).
 * Without that flip the back-left machine corner would render at the
 * top-left of the SVG, which contradicts the operator's standing
 * orientation when looking at the bed (the back of the bed is FAR from
 * them, i.e. visually at the top of a top-down preview).
 *
 * The result preserves the registry order so callers can `.map()`
 * directly into React keyed children with `key={cell.id}`.
 */
export function lagunaZoneUnitSquareLayout(): readonly LagunaZoneUnitSquareCell[] {
  const widthUnit = 1 / LAGUNA_VACUUM_ZONE_COLUMNS
  const heightUnit = 1 / LAGUNA_VACUUM_ZONE_ROWS
  return LAGUNA_VACUUM_ZONES.map((zone: LagunaVacuumZone) => {
    const xUnit = zone.column * widthUnit
    // Flip Y so row 0 (machine-back) lands at the bottom of the SVG.
    // The top of the SVG corresponds to row index = ROWS - 1.
    const flippedRow = LAGUNA_VACUUM_ZONE_ROWS - 1 - zone.row
    const yUnit = flippedRow * heightUnit
    return {
      id: zone.id,
      column: zone.column,
      row: zone.row,
      xUnit,
      yUnit,
      widthUnit,
      heightUnit
    }
  })
}

/**
 * Format the engagement percentage for a single zone tile. Engaged
 * zones display the integer percent of zone footprint covered (e.g.
 * "100%", "50%"); idle zones display an em-dash glyph so the cell
 * height is stable in the grid layout.
 *
 * Edge cases: an engaged zone with overlap < 1% (numerically possible
 * when stock just barely crosses the boundary) rounds to "1%" so the
 * label never reads "0%" while `engaged === true` -- otherwise the SR
 * label would say "engaged at 0% coverage" which is confusing.
 */
export function formatLagunaZoneTileLabel(
  overlap: LagunaVacuumZoneOverlap
): string {
  if (!overlap.engaged) return '—'
  const fraction = overlap.zoneCoverageFraction
  if (!Number.isFinite(fraction) || fraction <= 0) return '1%'
  if (fraction >= 1) return '100%'
  const rounded = Math.round(fraction * 100)
  if (rounded <= 0) return '1%'
  if (rounded >= 100) return '100%'
  return `${rounded}%`
}

/**
 * Tooltip surfaced on hover over a zone tile. Includes the registry id
 * + corner label + engagement + coverage. Pinned so a future zone-grid
 * refactor cannot silently change the hover text.
 */
export function formatLagunaZoneTileTitle(
  zone: LagunaVacuumZone,
  overlap: LagunaVacuumZoneOverlap
): string {
  const status = overlap.engaged ? 'engage' : 'leave idle'
  return `${zone.label} -- ${status} (${formatLagunaZoneTileLabel(overlap)} of zone covered)`
}

/**
 * Screen-reader label for a zone tile. The visible cell is decorative
 * (ARIA-hidden in the rendered span); this string is what SR users
 * actually hear.
 *
 * Format rules:
 *   - Engaged: "Vacuum zone X0Y0 back-left -- engage, 80 percent of zone covered".
 *   - Idle:    "Vacuum zone X0Y0 back-left -- leave idle, no stock above zone".
 */
export function formatLagunaZoneTileAriaLabel(
  zone: LagunaVacuumZone,
  overlap: LagunaVacuumZoneOverlap
): string {
  // Reuse the registry corner label suffix without the parenthesis.
  // zone.label format: "Zone X0/Y0 (back-left)".
  const cornerStart = zone.label.indexOf('(')
  const cornerEnd = zone.label.indexOf(')')
  const corner = cornerStart >= 0 && cornerEnd > cornerStart
    ? zone.label.slice(cornerStart + 1, cornerEnd)
    : ''
  const idStripped = zone.id // "X0Y0"
  if (!overlap.engaged) {
    return `Vacuum zone ${idStripped} ${corner} -- leave idle, no stock above zone`
  }
  const pct = formatLagunaZoneTileLabel(overlap).replace('%', '')
  return `Vacuum zone ${idStripped} ${corner} -- engage, ${pct} percent of zone covered`
}

/**
 * Headline text: "N of 6 zones engaged". Pinned wording matches the
 * existing Laguna sheet-stock UI register (no abbreviations, no Title
 * Case shouting). The number is rendered as a literal int even when
 * `engagedCount` is fractional (defensive against allocator drift).
 */
export function formatLagunaVacuumPanelHeadline(
  allocation: LagunaVacuumZoneAllocation
): string {
  const safe = Number.isFinite(allocation.engagedCount)
    ? Math.max(0, Math.min(LAGUNA_VACUUM_ZONE_COUNT, Math.round(allocation.engagedCount)))
    : 0
  return `${safe} of ${LAGUNA_VACUUM_ZONE_COUNT} ${LAGUNA_VACUUM_PANEL_NOUN} ${LAGUNA_VACUUM_PANEL_VERB}`
}

/**
 * Bed-coverage summary: "53.3% of bed covered". Renders the fraction at
 * 1-decimal precision (operator does not need 0.01% resolution and the
 * extra digits make the panel feel cluttered). Defensive against NaN
 * and out-of-range fractions.
 */
export function formatLagunaBedCoverageSummary(
  allocation: LagunaVacuumZoneAllocation
): string {
  const raw = allocation.bedCoverageFraction
  const safe = Number.isFinite(raw)
    ? Math.max(0, Math.min(1, raw))
    : 0
  const pct = safe * 100
  // Round to 1 decimal, then strip a trailing ".0" so "100.0%" -> "100%"
  // and "50.0%" -> "50%" while "53.3%" stays as "53.3%".
  const rounded = Math.round(pct * 10) / 10
  const text = Number.isInteger(rounded) ? `${rounded.toFixed(0)}` : `${rounded.toFixed(1)}`
  return `${text}% of bed covered`
}

/**
 * Banner text for the outside-envelope warning, or `null` when the
 * stock fits within the bed. Operators handle the warning by re-placing
 * the sheet or trimming -- the renderer just surfaces the alert.
 */
export function formatLagunaOutsideEnvelopeWarning(
  allocation: LagunaVacuumZoneAllocation
): string | null {
  return allocation.outsideEnvelope ? LAGUNA_OUTSIDE_ENVELOPE_BANNER : null
}

/**
 * Comma-separated list of engaged zone ids in registry order, e.g.
 * "X0Y0, X0Y1, X1Y0, X1Y1". Returns the literal string "(none)" when
 * no zones are engaged so the panel never renders an empty inline span
 * (which collapses the layout).
 */
export function formatLagunaEngagedZoneList(
  allocation: LagunaVacuumZoneAllocation
): string {
  if (allocation.engaged.length === 0) return '(none)'
  return allocation.engaged.join(', ')
}

/**
 * Paste-able operator instruction sheet. Returned as a single string
 * with `\n`-separated lines so the renderer can drop it directly into
 * a `navigator.clipboard.writeText` call (or a `<pre>` block).
 *
 * Lines:
 *   1. "Laguna Swift 5x10 vacuum panel -- N of 6 zones engaged"
 *   2. "Engage: X0Y0, X0Y1, X1Y0, X1Y1"
 *   3. "Leave idle: X0Y2, X1Y2"  (omitted when idle list is empty)
 *   4. "Bed coverage: 53.3%"
 *   5. (Optional) "WARNING: <outside-envelope banner>"
 */
export function formatLagunaOperatorClipboard(
  allocation: LagunaVacuumZoneAllocation
): string {
  const lines: string[] = []
  lines.push(`Laguna Swift 5x10 vacuum panel -- ${formatLagunaVacuumPanelHeadline(allocation)}`)
  lines.push(`Engage: ${formatLagunaEngagedZoneList(allocation)}`)
  if (allocation.idle.length > 0) {
    lines.push(`Leave idle: ${allocation.idle.join(', ')}`)
  }
  lines.push(`Bed coverage: ${formatLagunaBedCoverageSummary(allocation).replace(' of bed covered', '')}`)
  const warning = formatLagunaOutsideEnvelopeWarning(allocation)
  if (warning !== null) {
    lines.push(`WARNING: ${warning}`)
  }
  return lines.join('\n')
}
