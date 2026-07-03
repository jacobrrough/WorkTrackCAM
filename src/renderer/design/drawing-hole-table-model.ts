/**
 * Pure hole-table model + SVG emitters for the DrawingView (Phase-5 — drawings).
 *
 * Sibling of `drawing-annotation-model.ts` (notes / center marks / dimension
 * runs). Keeps every hole-table concern OFF the 4000-line `DrawingView.tsx`
 * component: minting a persisted table from a `cad.hole_table` scan, rendering
 * the table block + the per-hole tag markers as pure `<g>` overlays, splicing
 * them into a projection SVG, and the pure remove helper. All deterministic and
 * node-testable — the component only calls these; it owns no hole-table markup.
 *
 * Why client-side SVG (not a sidecar stamp like the BOM table)?
 * ------------------------------------------------------------
 * The hole rows are already computed by the sidecar scan and persisted on the
 * sheet; rendering them is pure string composition with no geometry left to
 * resolve. Composing client-side (like notes / center marks / surface finishes)
 * keeps a table-placement edit from re-firing the async projection pipeline and
 * matches the "documentation overlay only" Safety Rule 1 (no sidecar / G-code
 * touch on render). The scan itself IS the sidecar round-trip — this module runs
 * afterward on the returned rows.
 *
 * Safety Rule 4 (stored-XSS): the base SVG is dropped into
 * `dangerouslySetInnerHTML`, so every string that reaches a `<text>` node here
 * is entity-escaped via {@link escapeSvgText}. Hole `tag`s are scanner-minted
 * `A<n>` (no operator free-text), but they are escaped defensively all the same;
 * the table id / view are escaped where they land in attributes.
 */

import { escapeSvgText } from './drawing-annotation-model'
import type {
  DrawingHoleTable,
  DrawingHoleTableRow,
  DrawingHoleTableView
} from '../../shared/drawing-annotation-schema'

// ── Layout constants (SVG-mm) ─────────────────────────────────────────────
//
// The table block is a compact drafting table: a header row + one row per hole,
// four columns (Tag · Ø · Depth · X,Y). Sizes are in SVG-mm (the projection's
// own coordinate space) so the table scales with the drawing.

/** Row height of the table (header + each data row), SVG-mm. */
export const HOLE_TABLE_ROW_H = 6
/** Column widths [Tag, Ø, Depth, Position], SVG-mm. Sum = table width. */
export const HOLE_TABLE_COL_W: readonly [number, number, number, number] = [12, 18, 22, 30]
/** Text baseline inset from the top of a row, SVG-mm. */
const HOLE_TABLE_TEXT_DY = 4.2
/** Left text pad inside a cell, SVG-mm. */
const HOLE_TABLE_TEXT_PAD = 1.5
/** Font size for the table cells, SVG-mm. */
const HOLE_TABLE_FONT = 3.2
/** Tag-marker circle radius drawn at each hole centre, SVG-mm. */
export const HOLE_TAG_MARKER_R = 3
/** Font size for the tag-marker label, SVG-mm. */
const HOLE_TAG_FONT = 3

/** Header labels, in column order. */
const HOLE_TABLE_HEADERS: readonly [string, string, string, string] = [
  'Tag',
  'Dia',
  'Depth',
  'Pos X,Y'
]

/** Total table width (sum of the column widths), SVG-mm. */
export function holeTableWidth(): number {
  return HOLE_TABLE_COL_W.reduce((a, b) => a + b, 0)
}

/**
 * Format a finite number for markup with bounded precision (2 dp, trailing zeros
 * trimmed). `NaN` / `Infinity` collapse to `0` so the emitted geometry is always
 * valid. Local sibling of the annotation module's private `svgNum` (2 dp here —
 * a hole table is a coarser read-out than dimension geometry).
 */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(2)).toString()
}

/**
 * Human depth cell for a hole row. A through hole reads "THRU" (drawing
 * convention); a blind hole reads its depth prefixed with the drafting depth
 * glyph. Pure; exported for the render-pin test.
 */
export function formatHoleDepth(row: DrawingHoleTableRow): string {
  if (row.through) return 'THRU'
  if (row.depthMm === null) return 'THRU'
  return `↧ ${num(row.depthMm)}` // ↧ downward arrow to bar = "depth"
}

/**
 * Diameter cell for a hole row, prefixed with the diameter glyph Ø. Pure.
 */
export function formatHoleDiameter(row: DrawingHoleTableRow): string {
  return `Ø${num(row.diameterMm)}`
}

/** Position cell "x,y" (2 dp). Pure. */
function formatHolePosition(row: DrawingHoleTableRow): string {
  return `${num(row.x)},${num(row.y)}`
}

// ── Mint a persisted table from a scan ────────────────────────────────────

/**
 * Build a persisted {@link DrawingHoleTable} from a `cad.hole_table` scan.
 * `rows` are the scan rows (already validated by the caller against
 * `isCadHoleTableRow`); `view` is the scanned view; `placement` is where the
 * table block's top-left corner sits in sheet space. The id defaults to a
 * timestamp-seeded value unless the caller supplies one (tests pass a fixed id).
 * Pure aside from the default-id clock read.
 */
export function buildHoleTable(args: {
  readonly rows: readonly DrawingHoleTableRow[]
  readonly view: DrawingHoleTableView
  readonly placement: { readonly x: number; readonly y: number }
  readonly id?: string
}): DrawingHoleTable {
  return {
    id: args.id ?? `holetable-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    view: args.view,
    rows: [...args.rows],
    placement: { x: args.placement.x, y: args.placement.y }
  }
}

// ── Table-block SVG ───────────────────────────────────────────────────────

/**
 * Render one hole table as a `<g class="drawing-hole-table">` block anchored at
 * its `placement` (top-left). Draws a bordered grid: a header row then one row
 * per hole (Tag · Ø · Depth · Position). An EMPTY table (no rows) still renders
 * the header plus a single "No holes found" spanning row — the honest empty
 * state, so the placed annotation is never invisible. Pure.
 */
export function holeTableToSvg(table: DrawingHoleTable): string {
  const x0 = table.placement.x
  const y0 = table.placement.y
  const w = holeTableWidth()
  const cols = HOLE_TABLE_COL_W
  // Column left edges (cumulative).
  const colX: number[] = []
  let acc = x0
  for (const cw of cols) {
    colX.push(acc)
    acc += cw
  }
  const rowCount = table.rows.length
  const totalRows = 1 + Math.max(rowCount, 1) // header + data (>=1 for empty msg)
  const h = totalRows * HOLE_TABLE_ROW_H

  const parts: string[] = []

  // Outer border + horizontal row separators.
  parts.push(
    `<rect x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}" fill="#ffffff" stroke="currentColor" stroke-width="0.25" />`
  )
  for (let r = 1; r < totalRows; r++) {
    const ry = y0 + r * HOLE_TABLE_ROW_H
    parts.push(
      `<line x1="${num(x0)}" y1="${num(ry)}" x2="${num(x0 + w)}" y2="${num(ry)}" stroke="currentColor" stroke-width="0.15" />`
    )
  }
  // Vertical column separators (skip the outer left/right, drawn by the rect).
  for (let c = 1; c < cols.length; c++) {
    parts.push(
      `<line x1="${num(colX[c])}" y1="${num(y0)}" x2="${num(colX[c])}" y2="${num(y0 + h)}" stroke="currentColor" stroke-width="0.15" />`
    )
  }

  const textCommon =
    `font-family="sans-serif" font-size="${num(HOLE_TABLE_FONT)}" fill="currentColor" stroke="none"`

  // Header row.
  const headerY = y0 + HOLE_TABLE_TEXT_DY
  for (let c = 0; c < HOLE_TABLE_HEADERS.length; c++) {
    parts.push(
      `<text ${textCommon} font-weight="bold" x="${num(colX[c] + HOLE_TABLE_TEXT_PAD)}" y="${num(headerY)}">${escapeSvgText(HOLE_TABLE_HEADERS[c])}</text>`
    )
  }

  if (rowCount === 0) {
    // Honest empty state: one spanning "No holes found" data row.
    const emptyY = y0 + HOLE_TABLE_ROW_H + HOLE_TABLE_TEXT_DY
    parts.push(
      `<text ${textCommon} x="${num(x0 + HOLE_TABLE_TEXT_PAD)}" y="${num(emptyY)}">${escapeSvgText('No holes found')}</text>`
    )
  } else {
    for (let i = 0; i < rowCount; i++) {
      const row = table.rows[i]
      const ty = y0 + (i + 1) * HOLE_TABLE_ROW_H + HOLE_TABLE_TEXT_DY
      const cells = [
        row.tag,
        formatHoleDiameter(row),
        formatHoleDepth(row),
        formatHolePosition(row)
      ]
      for (let c = 0; c < cells.length; c++) {
        parts.push(
          `<text ${textCommon} x="${num(colX[c] + HOLE_TABLE_TEXT_PAD)}" y="${num(ty)}">${escapeSvgText(cells[c])}</text>`
        )
      }
    }
  }

  return `<g class="drawing-hole-table" data-hole-table-id="${escapeSvgText(table.id)}" data-hole-table-view="${escapeSvgText(table.view)}">${parts.join('')}</g>`
}

// ── Tag-marker SVG (drawn at each hole centre) ─────────────────────────────

/**
 * Render one tag marker: a small circle at the hole centre (`row.x`, `row.y`)
 * carrying the hole `tag` (A1, A2 …). The circle radius matches the scan's tag
 * convention so the marker reads as a balloon on the projected hole. Pure.
 */
export function holeTagMarkerToSvg(row: DrawingHoleTableRow): string {
  const cx = row.x
  const cy = row.y
  return (
    `<g class="drawing-hole-tag" data-hole-tag="${escapeSvgText(row.tag)}">` +
    `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(HOLE_TAG_MARKER_R)}" fill="none" stroke="currentColor" stroke-width="0.25" />` +
    `<text font-family="sans-serif" font-size="${num(HOLE_TAG_FONT)}" fill="currentColor" stroke="none" text-anchor="middle" x="${num(cx)}" y="${num(cy + HOLE_TAG_FONT * 0.35)}">${escapeSvgText(row.tag)}</text>` +
    `</g>`
  )
}

/**
 * Render every tag marker for a table as one `<g class="drawing-hole-tag-layer">`
 * fragment (one balloon per hole row). Empty string when the table has no rows
 * (nothing to mark). Pure.
 */
export function holeTagMarkersLayerSvg(table: DrawingHoleTable): string {
  if (table.rows.length === 0) return ''
  const inner = table.rows.map((row) => holeTagMarkerToSvg(row)).join('')
  return `<g class="drawing-hole-tag-layer" data-testid="design-drawing-hole-tag-layer" data-hole-table-id="${escapeSvgText(table.id)}">${inner}</g>`
}

/**
 * Render one full hole table as its combined layer: the tag markers (drawn on
 * the view at each hole centre) FOLLOWED by the table block (at its placement).
 * Empty string only when there is genuinely nothing to draw (which never happens
 * — the table block always renders, even empty). Pure.
 */
export function holeTableLayerSvg(table: DrawingHoleTable): string {
  const markers = holeTagMarkersLayerSvg(table)
  const block = holeTableToSvg(table)
  return `<g class="drawing-hole-table-layer" data-testid="design-drawing-hole-table-layer" data-hole-table-id="${escapeSvgText(table.id)}">${markers}${block}</g>`
}

/**
 * Splice every hole table's combined layer into an existing projection SVG, just
 * before the closing `</svg>` (appended when the close tag is missing —
 * defensive). Unchanged input when there are no tables. Render order is
 * preserved (later tables draw on top). Pure. Mirrors `composeCenterMarksIntoSvg`.
 */
export function composeHoleTablesIntoSvg(
  svg: string,
  tables: readonly DrawingHoleTable[]
): string {
  if (tables.length === 0) return svg
  const layer = tables.map((t) => holeTableLayerSvg(t)).join('')
  if (layer === '') return svg
  const closeIdx = svg.lastIndexOf('</svg>')
  if (closeIdx === -1) return svg + layer
  return svg.slice(0, closeIdx) + layer + svg.slice(closeIdx)
}

// ── Pure delete ───────────────────────────────────────────────────────────

/** Remove the table with `id` (immutable; a no-op for an unknown id). Pure. */
export function removeHoleTable(
  tables: readonly DrawingHoleTable[],
  id: string
): DrawingHoleTable[] {
  return tables.filter((t) => t.id !== id)
}
