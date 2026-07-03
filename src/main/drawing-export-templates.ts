/** Pure title-block HTML + real DXF for drawing export (mesh projection + persisted annotations). */

import type { DrawingSheetAnnotations } from '../shared/drawing-annotation-schema'
import {
  assembleDxfDocument,
  computeEntitiesExtents,
  DXF_LAYERS,
  formatDxfNumber,
  type DxfEntity,
  type DxfLayer,
  type DxfPoint
} from './dxf-entities'

export type ProjectedSegment = { x1: number; y1: number; x2: number; y2: number }

export type ProjectedModelViewForExport = {
  id: string
  label: string
  axis: string
  segments: ProjectedSegment[]
  layout?: {
    originXMM?: number
    originYMM?: number
    widthMM?: number
    heightMM?: number
  }
}

function bboxFromSegments(segments: ProjectedSegment[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} | null {
  if (segments.length === 0) return null
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2)
    maxX = Math.max(maxX, s.x1, s.x2)
    minY = Math.min(minY, s.y1, s.y2)
    maxY = Math.max(maxY, s.y1, s.y2)
  }
  if (!Number.isFinite(minX) || minX === maxX || minY === maxY) return null
  return { minX, maxX, minY, maxY }
}

function defaultViewBoxMm(index: number): { x: number; y: number; w: number; h: number } {
  const SLOT_W = 78
  const SLOT_H = 52
  const GAP_X = 10
  const GAP_Y = 12
  const COLS = 2
  const baseX = 10
  const baseY = 12
  const row = Math.floor(index / COLS)
  const col = index % COLS
  return {
    x: baseX + col * (SLOT_W + GAP_X),
    y: baseY + row * (SLOT_H + GAP_Y),
    w: SLOT_W,
    h: SLOT_H
  }
}

/** SVG group: segments scaled into width×height mm box (model Y up in viewBox). */
function projectedViewSvgFragment(view: ProjectedModelViewForExport, index: number): string {
  const box = view.layout
  const px = box?.originXMM ?? defaultViewBoxMm(index).x
  const py = box?.originYMM ?? defaultViewBoxMm(index).y
  const pw = box?.widthMM ?? defaultViewBoxMm(index).w
  const ph = box?.heightMM ?? defaultViewBoxMm(index).h

  const bb = bboxFromSegments(view.segments)
  if (!bb) {
    return `<g transform="translate(${px},${py})"><text x="2" y="${ph / 2}" font-size="3mm" fill="#666">No edges — ${escapeHtml(
      view.label
    )}</text></g>`
  }
  const pad = Math.max(0.5, Math.min(pw, ph) * 0.04)
  const bw = bb.maxX - bb.minX + 2 * pad
  const bh = bb.maxY - bb.minY + 2 * pad
  const sx = pw / bw
  const sy = ph / bh
  const sc = Math.min(sx, sy)
  const ox = px + (pw - bw * sc) / 2
  const oy = py + (ph - bh * sc) / 2
  const tx = -bb.minX + pad
  const ty = -bb.minY + pad

  const lines = view.segments
    .map((s) => {
      const x1 = ox + (s.x1 + tx) * sc
      const y1 = oy + (ph - (s.y1 + ty) * sc)
      const x2 = ox + (s.x2 + tx) * sc
      const y2 = oy + (ph - (s.y2 + ty) * sc)
      return `<line x1="${x1.toFixed(4)}" y1="${y1.toFixed(4)}" x2="${x2.toFixed(4)}" y2="${y2.toFixed(4)}" stroke="#111" stroke-width="0.15"/>`
    })
    .join('')

  const cap = escapeHtml(`${view.label || view.id} · ${view.axis}`)
  return `<g>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="none" stroke="#999" stroke-dasharray="2 2" stroke-width="0.12"/>
    ${lines}
    <text x="${px + 1}" y="${py + ph + 4}" font-size="2.8mm" fill="#333">${cap}</text>
  </g>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeFileStem(name: string): string {
  const t = name.trim() || 'drawing'
  return t.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 120)
}

export function buildTitleBlockHtml(opts: {
  projectTitle: string
  generatedAtIso: string
  appLabel?: string
  /** First sheet name from `drawing/drawing.json` when present */
  sheetTitle?: string
  sheetScale?: string
  /** Manifest view slots — labels + optional preview detail lines */
  viewPlaceholders?: { kind: string; label: string; detailLine?: string }[]
  /** Tier A projected edges from kernel STL (when Python pipeline succeeds). */
  projectedModelViews?: ProjectedModelViewForExport[]
}): string {
  const title = escapeHtml(opts.projectTitle)
  const when = escapeHtml(opts.generatedAtIso)
  const app = escapeHtml(opts.appLabel ?? 'WorkTrack3D')
  const sheetLine =
    opts.sheetTitle != null && opts.sheetTitle.trim() !== ''
      ? escapeHtml(opts.sheetTitle.trim()) + (opts.sheetScale?.trim() ? ` · scale ${escapeHtml(opts.sheetScale.trim())}` : '')
      : ''
  const proj = opts.projectedModelViews && opts.projectedModelViews.length > 0
  const viewList =
    opts.viewPlaceholders && opts.viewPlaceholders.length > 0
      ? `<ul style="text-align:left;margin:0.5em 0 0;padding-left:1.25em;max-width:36em;">${opts.viewPlaceholders
          .map((v) => {
            const detail = v.detailLine?.trim()
              ? `<div style="font-size:9pt;color:#555;margin-top:0.2em;">${escapeHtml(v.detailLine.trim())}</div>`
              : ''
            return `<li>${escapeHtml(v.kind)}${v.label.trim() ? ` — ${escapeHtml(v.label.trim())}` : ''}${proj ? '' : ' <span style="color:#666">(metadata)</span>'}${detail}</li>`
          })
          .join('')}</ul>`
      : ''
  const projectionSvg = proj
    ? `<svg width="100%" height="128mm" viewBox="0 0 190 128" preserveAspectRatio="xMidYMid meet" style="display:block;margin:0 auto;">
${opts.projectedModelViews!.map((v, i) => projectedViewSvgFragment(v, i)).join('\n')}
</svg>
<p style="margin:0.4em 0 0;font-size:9pt;color:#444;">Projected edges: <strong>Tier A</strong> mesh silhouette (no hidden-line removal). Rebuild kernel STL to refresh.</p>`
    : ''
  const viewportInner = proj
    ? `${projectionSvg}${viewList}`
    : viewList
      ? `${viewList}<p style="margin-top:0.75em;font-size:10pt;color:#444;">No projected linework — add view slots and ensure <code>output/kernel-part.stl</code> exists (Build STEP).</p>`
      : `Model views are not wired yet.<br/>
      Use this PDF as a documentation shell or print blank title block.`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, Segoe UI, Roboto, sans-serif;
    margin: 0;
    padding: 0;
    color: #111;
    background: #fff;
  }
  .sheet {
    width: 190mm;
    min-height: 277mm;
    margin: 0 auto;
    border: 1px solid #333;
    padding: 10mm 12mm;
    position: relative;
  }
  h1 { font-size: 18pt; margin: 0 0 4mm; }
  .meta { font-size: 9pt; color: #444; margin-bottom: 8mm; }
  .viewport {
    border: 1px dashed #888;
    height: 140mm;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 11pt;
    text-align: center;
    padding: 8mm;
  }
  .block {
    position: absolute;
    right: 12mm;
    bottom: 10mm;
    width: 85mm;
    border: 1px solid #333;
    font-size: 8pt;
    padding: 3mm 4mm;
    line-height: 1.35;
  }
  .block strong { display: block; font-size: 9pt; margin-bottom: 2mm; }
</style>
</head>
<body>
  <div class="sheet">
    <h1>Drawing — ${title}</h1>
    <div class="meta">${app} · generated ${when}${sheetLine ? ` · sheet: ${sheetLine}` : ''}</div>
    <div class="viewport">
      ${viewportInner}
    </div>
    <div class="block">
      <strong>Notes</strong>
      Export STL/STEP from Design or G-code from Manufacture for shop packages.
      ${proj ? '2D views: mesh edge projection (documentation only, not certified drawing). ' : '2D projection is optional — enable with kernel STL + drawing view slots. '}
    </div>
  </div>
</body>
</html>`
}

/**
 * Map one projected view's segments into DXF LINE entities, using the SAME
 * layout-box transform (scale-to-fit + Y-flip) the SVG fragment / PDF path use,
 * so the DXF projection linework lands in the same coherent title-block model
 * space. All projection segments are VISIBLE edges today (the mesh projector
 * carries no hidden-line flag), so they route to the PROJECTION layer; the
 * HIDDEN layer + linetype exist for when hidden-line removal lands.
 */
function projectedViewToEntities(view: ProjectedModelViewForExport, index: number): DxfEntity[] {
  const box = view.layout
  const px = box?.originXMM ?? defaultViewBoxMm(index).x
  const py = box?.originYMM ?? defaultViewBoxMm(index).y
  const pw = box?.widthMM ?? defaultViewBoxMm(index).w
  const ph = box?.heightMM ?? defaultViewBoxMm(index).h
  const bb = bboxFromSegments(view.segments)
  if (!bb) return []
  const pad = Math.max(0.5, Math.min(pw, ph) * 0.04)
  const bw = bb.maxX - bb.minX + 2 * pad
  const bh = bb.maxY - bb.minY + 2 * pad
  const sc = Math.min(pw / bw, ph / bh)
  const ox = px + (pw - bw * sc) / 2
  const oy = py + (ph - bh * sc) / 2
  const tx = -bb.minX + pad
  const ty = -bb.minY + pad

  const entities: DxfEntity[] = []
  for (const s of view.segments) {
    entities.push({
      type: 'line',
      layer: DXF_LAYERS.PROJECTION,
      start: { x: ox + (s.x1 + tx) * sc, y: oy + ph - (s.y1 + ty) * sc },
      end: { x: ox + (s.x2 + tx) * sc, y: oy + ph - (s.y2 + ty) * sc }
    })
  }
  return entities
}

// ---------------------------------------------------------------------------
// Annotation → DXF coordinate mapping
// ---------------------------------------------------------------------------
//
// Persisted annotations (dimensions, GD&T frames, surface finishes, notes,
// center marks, centerlines) store coordinates in SVG-mm SHEET space — the
// CadQuery `getSVG(width=800, height=600)` frame the drawing renderer and
// `drawing-snap.ts` operate in (Y-DOWN, origin top-left). DXF model space is
// Y-UP. Annotations therefore map into DXF with a SINGLE Y-flip about the SVG
// sheet height so text reads upright and geometry is never mirrored:
//
//     dxfX = svgX
//     dxfY = SVG_SHEET_HEIGHT_MM - svgY
//
// This is a DIFFERENT frame from the per-view projection boxes above (which are
// laid out in title-block mm): the annotations were authored against the live
// drawing SVG, not against the export's title-block layout, so honestly they
// occupy the SVG sheet frame. The two coexist in one DXF model space; a shop
// reads projection linework from the PROJECTION layer and annotations from
// their dedicated layers, each internally coherent. Documented in the return
// report as "annotations in the 800x600 SVG sheet frame, Y-flipped".

/** SVG sheet height (mm) — the `getSVG(width=800, height=600)` frame Y-extent. */
export const SVG_SHEET_HEIGHT_MM = 600

/** Map one SVG-mm annotation point into DXF model space (single Y-flip). */
function annPoint(p: { x: number; y: number }): DxfPoint {
  return { x: p.x, y: SVG_SHEET_HEIGHT_MM - p.y }
}

/** Annotation text height (mm) for dimension read-outs / notes / GD&T text. */
const ANN_TEXT_HEIGHT = 3
/** Arrow/oblique-tick half-length (mm) at dimension-line ends. */
const ANN_TICK_MM = 1.2
/** Extension-line gap past the dimension line (mm). */
const ANN_EXT_MM = 1.5

type Pt = { x: number; y: number }

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y }
}
function len(v: Pt): number {
  return Math.hypot(v.x, v.y)
}
function unit(v: Pt): Pt {
  const l = len(v)
  return l === 0 ? { x: 1, y: 0 } : { x: v.x / l, y: v.y / l }
}
function perp(v: Pt): Pt {
  return { x: -v.y, y: v.x }
}
function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y }
}
function scale(v: Pt, s: number): Pt {
  return { x: v.x * s, y: v.y * s }
}

/** Human-readable read-out for a dimension: label override, else formatted value. */
function dimensionReadout(value: number, label: string | undefined): string {
  if (label !== undefined && label.trim() !== '') return label
  return formatDxfNumber(value)
}

/**
 * Explode ONE persisted dimension into DXF primitives on the DIMENSIONS layer.
 * R12 has no portable associative DIMENSION explode, so each dimension renders
 * as its rendered geometry: extension lines from the measured points out to the
 * dimension line, the dimension line itself, oblique ticks at both ends, and a
 * TEXT read-out — exactly what `drawing-annotation-model.ts` paints in SVG,
 * honestly de-associated for the DXF. Angular/radial/diameter reduce to a leader
 * line from the reference point to the value text. Points are pre-flipped SVG-mm.
 */
function dimensionToEntities(
  dim: DrawingSheetAnnotations['dimensions'][number]
): DxfEntity[] {
  const layer: DxfLayer = DXF_LAYERS.DIMENSIONS
  const text = dimensionReadout(dim.value, dim.label)
  const out: DxfEntity[] = []

  // A linear span (a→b) drawn on the dimension-line row through `placement`.
  const linearSpan = (aRaw: Pt, bRaw: Pt, placementRaw: Pt): void => {
    const a = aRaw
    const b = bRaw
    const dir = unit(sub(b, a))
    const n = perp(dir)
    // Signed offset from the a→b line to placement along the normal.
    const d = (placementRaw.x - a.x) * n.x + (placementRaw.y - a.y) * n.y
    const a2 = add(a, scale(n, d))
    const b2 = add(b, scale(n, d))
    // Extension lines (from the measured points, past the dim line by ANN_EXT_MM).
    const extA = add(a2, scale(n, d >= 0 ? ANN_EXT_MM : -ANN_EXT_MM))
    const extB = add(b2, scale(n, d >= 0 ? ANN_EXT_MM : -ANN_EXT_MM))
    out.push({ type: 'line', layer, start: annPoint(a), end: annPoint(extA) })
    out.push({ type: 'line', layer, start: annPoint(b), end: annPoint(extB) })
    // Dimension line.
    out.push({ type: 'line', layer, start: annPoint(a2), end: annPoint(b2) })
    // Oblique 45° ticks at both ends.
    const tick = scale(unit(add(dir, n)), ANN_TICK_MM)
    out.push({
      type: 'line',
      layer,
      start: annPoint(sub(a2, tick)),
      end: annPoint(add(a2, tick))
    })
    out.push({
      type: 'line',
      layer,
      start: annPoint(sub(b2, tick)),
      end: annPoint(add(b2, tick))
    })
    // Read-out text centred just off the dimension line, on the placement side.
    const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }
    const textPt = add(mid, scale(n, (d >= 0 ? 1 : -1) * 1.5))
    out.push({
      type: 'text',
      layer,
      at: annPoint(textPt),
      height: ANN_TEXT_HEIGHT,
      value: text,
      hAlign: 'center'
    })
  }

  switch (dim.kind) {
    case 'linear':
      linearSpan(dim.start.cachedPoint, dim.end.cachedPoint, dim.placement)
      break
    case 'baseline':
      linearSpan(dim.origin.cachedPoint, dim.feature.cachedPoint, dim.placement)
      break
    case 'chain':
      linearSpan(dim.start.cachedPoint, dim.end.cachedPoint, dim.placement)
      break
    case 'ordinate': {
      // Leader from the feature to the placement, plus the coordinate text.
      out.push({
        type: 'line',
        layer,
        start: annPoint(dim.feature.cachedPoint),
        end: annPoint(dim.placement)
      })
      out.push({
        type: 'text',
        layer,
        at: annPoint({ x: dim.placement.x, y: dim.placement.y - 1 }),
        height: ANN_TEXT_HEIGHT,
        value: text,
        hAlign: 'center'
      })
      break
    }
    case 'radial':
    case 'diameter': {
      // Leader from center to the on-curve point, value text at the placement.
      out.push({
        type: 'line',
        layer,
        start: annPoint(dim.center.cachedPoint),
        end: annPoint(dim.on.cachedPoint)
      })
      const prefix = dim.kind === 'radial' ? 'R' : 'D'
      out.push({
        type: 'text',
        layer,
        at: annPoint(dim.placement),
        height: ANN_TEXT_HEIGHT,
        value: `${prefix}${text}`,
        hAlign: 'center'
      })
      break
    }
    case 'angular': {
      // Two arms from the vertex, value text at the placement.
      out.push({
        type: 'line',
        layer,
        start: annPoint(dim.vertex.cachedPoint),
        end: annPoint(dim.arm1.cachedPoint)
      })
      out.push({
        type: 'line',
        layer,
        start: annPoint(dim.vertex.cachedPoint),
        end: annPoint(dim.arm2.cachedPoint)
      })
      out.push({
        type: 'text',
        layer,
        at: annPoint(dim.placement),
        height: ANN_TEXT_HEIGHT,
        value: `${text}°`,
        hAlign: 'center'
      })
      break
    }
  }
  return out
}

/** Short human abbreviation for a GD&T geometric characteristic (DXF has no glyph). */
const GDT_CHAR_ABBREV: Record<
  DrawingSheetAnnotations['featureControlFrames'][number]['characteristic'],
  string
> = {
  straightness: 'STR',
  flatness: 'FLAT',
  circularity: 'CIRC',
  cylindricity: 'CYL',
  profile_of_a_line: 'PROFL',
  profile_of_a_surface: 'PROFS',
  perpendicularity: 'PERP',
  angularity: 'ANG',
  parallelism: 'PARA',
  position: 'POS',
  concentricity: 'CONC',
  symmetry: 'SYM',
  circular_runout: 'RUNO',
  total_runout: 'TRUNO'
}

/**
 * Map one GD&T feature control frame into a box outline + a single TEXT row on
 * the ANNOTATIONS layer: `CHAR | tol | A B C`. DXF R12 has no drafting glyphs,
 * so the characteristic is spelled with a stable abbreviation ({@link
 * GDT_CHAR_ABBREV}) — an honest, readable de-glyphing. Placement is the frame
 * box top-left in SVG-mm (Y-flipped to DXF).
 */
function gdtFrameToEntities(
  frame: DrawingSheetAnnotations['featureControlFrames'][number]
): DxfEntity[] {
  const layer: DxfLayer = DXF_LAYERS.ANNOTATIONS
  const abbrev = GDT_CHAR_ABBREV[frame.characteristic]
  const tol = formatDxfNumber(frame.toleranceMm)
  const datums = frame.datums.length > 0 ? ` ${frame.datums.join(' ')}` : ''
  const value = `${abbrev} ${tol}${datums}`
  // Approximate box: height = text + padding; width scales with content length.
  const boxH = ANN_TEXT_HEIGHT + 2
  const boxW = Math.max(12, value.length * ANN_TEXT_HEIGHT * 0.65 + 2)
  const x = frame.placement.x
  const y = frame.placement.y
  // Box corners in SVG-mm (top-left origin, +y down); flipped by annPoint.
  const tl = { x, y }
  const tr = { x: x + boxW, y }
  const br = { x: x + boxW, y: y + boxH }
  const bl = { x, y: y + boxH }
  return [
    {
      type: 'polyline',
      layer,
      closed: true,
      points: [annPoint(tl), annPoint(tr), annPoint(br), annPoint(bl)]
    },
    {
      type: 'text',
      layer,
      at: annPoint({ x: x + 1, y: y + boxH - 1 }),
      height: ANN_TEXT_HEIGHT,
      value,
      hAlign: 'left'
    }
  ]
}

/** Map one free-text note into TEXT entities on the ANNOTATIONS layer (one per line). */
function noteToEntities(note: DrawingSheetAnnotations['notes'][number]): DxfEntity[] {
  const layer: DxfLayer = DXF_LAYERS.ANNOTATIONS
  const out: DxfEntity[] = []
  // Leader line to the anchored feature, when present.
  if (note.leader !== undefined) {
    out.push({
      type: 'line',
      layer,
      start: annPoint(note.placement),
      end: annPoint(note.leader.cachedPoint)
    })
  }
  const lineHeight = ANN_TEXT_HEIGHT * 1.35
  const lines = note.text.replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((line, i) => {
    // Note placement is the text-block TOP-LEFT in SVG-mm (+y down), so each
    // subsequent line steps DOWN in SVG-mm (larger y).
    out.push({
      type: 'text',
      layer,
      at: annPoint({ x: note.placement.x, y: note.placement.y + (i + 1) * lineHeight }),
      height: ANN_TEXT_HEIGHT,
      value: line,
      hAlign: 'left'
    })
  })
  return out
}

/** Map one center mark into two crossed LINE entities on the CENTERLINES layer. */
function centerMarkToEntities(
  mark: DrawingSheetAnnotations['centerMarks'][number]
): DxfEntity[] {
  const layer: DxfLayer = DXF_LAYERS.CENTERLINES
  const c = mark.anchor.cachedPoint
  const s = mark.sizeMm
  return [
    {
      type: 'line',
      layer,
      linetype: 'CENTER',
      start: annPoint({ x: c.x - s, y: c.y }),
      end: annPoint({ x: c.x + s, y: c.y })
    },
    {
      type: 'line',
      layer,
      linetype: 'CENTER',
      start: annPoint({ x: c.x, y: c.y - s }),
      end: annPoint({ x: c.x, y: c.y + s })
    }
  ]
}

/**
 * Map one centerline into a single LINE entity on the CENTERLINES layer,
 * extended past both anchors (the drafting overshoot), with the CENTER linetype.
 */
function centerlineToEntities(
  line: DrawingSheetAnnotations['centerlines'][number]
): DxfEntity[] {
  const a = line.start.cachedPoint
  const b = line.end.cachedPoint
  const dir = unit(sub(b, a))
  const ext = 3
  const p1 = { x: a.x - dir.x * ext, y: a.y - dir.y * ext }
  const p2 = { x: b.x + dir.x * ext, y: b.y + dir.y * ext }
  return [
    {
      type: 'line',
      layer: DXF_LAYERS.CENTERLINES,
      linetype: 'CENTER',
      start: annPoint(p1),
      end: annPoint(p2)
    }
  ]
}

// ---------------------------------------------------------------------------
// Surface-finish (ISO 1302 / ASME Y14.36) → DXF composite
// ---------------------------------------------------------------------------
//
// R12 DXF has no ISO 1302 surface-texture symbol primitive, so the on-screen
// check-mark glyph (drawn as an SVG <polyline> + optional bar / circle / Ra
// text by `drawing-surface-finish-model.ts`) is re-composed here as a FAITHFUL
// GEOMETRIC COMPOSITE of R12 primitives — the tick + long-leg as LINE segments,
// the "machining required" bar as a LINE, the "machining prohibited" circle as
// a real CIRCLE entity, plus a TEXT read-out for the Ra value + lay code. This
// is an honest drawing of the symbol, not a mislabeled box (the wave-7 GD&T
// de-glyphing box was the fallback for a symbol with NO geometric form; the
// surface-finish check-mark DOES have one, so we draw it).
//
// Glyph metrics mirror `surfaceFinishToSvg` EXACTLY so the DXF looks like the
// screen symbol. The SVG model works in SVG-mm (Y-DOWN, glyph points UP =
// smaller y); `annPoint` applies the same single Y-flip every other annotation
// uses, so the check-mark reads upright in DXF model space (Y-UP).

/** Vee-to-short-leg X delta (SVG-mm) — matches `surfaceFinishToSvg`. */
const SF_SHORT_DX = -3.5
/** Vee-to-short-leg Y delta (SVG-mm, up = negative). */
const SF_SHORT_DY = -6
/** Vee-to-long-leg X delta (SVG-mm). */
const SF_LONG_DX = 7
/** Vee-to-long-leg Y delta (SVG-mm, up = negative). */
const SF_LONG_DY = -12
/** "Machining required" bar length past the long-leg top (SVG-mm). */
const SF_BAR_DX = 9
/** "Machining prohibited" circle radius (SVG-mm) — matches the SVG r=1.6. */
const SF_CIRCLE_R = 1.6

/**
 * ASCII lay-direction codes for the DXF TEXT read-out. R12 ASCII DXF cannot
 * carry the `⟂` (perpendicular) glyph the SVG model uses, so lay is spelled
 * with a stable single-character ASCII code per ISO 1302 convention (`=` `_|_`
 * → here just the ASCII letter/symbol shops read): a faithful de-glyphing that
 * survives an ASCII-only importer. Keyed by the closed `lay` enum, so no
 * free-text ever reaches the stream.
 */
const SF_LAY_DXF_CODE: Record<NonNullable<DrawingSheetAnnotations['surfaceFinishes'][number]['lay']>, string> = {
  parallel: '=',
  perpendicular: 'PERP',
  crossed: 'X',
  multidirectional: 'M',
  circular: 'C',
  radial: 'R',
  particulate: 'P'
}

/**
 * Map one persisted surface-finish symbol into a DXF composite on the
 * ANNOTATIONS layer: the check-mark as two LINE legs, the material-disposition
 * modifier (required → a bar LINE; prohibited → a CIRCLE), and a single TEXT
 * read-out carrying the Ra value + optional allowance + optional lay code. The
 * bare `any` disposition draws just the check-mark. Points are SVG-mm, flipped
 * to DXF model space via `annPoint` (the wave-7 transform). Empty-omit is
 * handled by the caller (a symbol always emits at least the check-mark legs).
 */
function surfaceFinishToEntities(
  sf: DrawingSheetAnnotations['surfaceFinishes'][number]
): DxfEntity[] {
  const layer: DxfLayer = DXF_LAYERS.ANNOTATIONS
  const p = sf.placement
  // Vee + leg endpoints in SVG-mm (matching surfaceFinishToSvg).
  const vee: Pt = { x: p.x, y: p.y }
  const shortEnd: Pt = { x: p.x + SF_SHORT_DX, y: p.y + SF_SHORT_DY }
  const longEnd: Pt = { x: p.x + SF_LONG_DX, y: p.y + SF_LONG_DY }

  const out: DxfEntity[] = []
  // The check-mark: short leg → vee, then vee → long leg (two LINE segments,
  // the R12 form of the SVG <polyline> tick).
  out.push({ type: 'line', layer, start: annPoint(shortEnd), end: annPoint(vee) })
  out.push({ type: 'line', layer, start: annPoint(vee), end: annPoint(longEnd) })

  if (sf.material === 'required') {
    // Horizontal bar across the top of the long leg (material removal required).
    const barEnd: Pt = { x: longEnd.x + SF_BAR_DX, y: longEnd.y }
    out.push({ type: 'line', layer, start: annPoint(longEnd), end: annPoint(barEnd) })
  } else if (sf.material === 'prohibited') {
    // Small circle seated in the vee (material removal prohibited). Centre
    // matches surfaceFinishToSvg: veeX + (shortDX+longDX)/4, veeY + (shortDY+longDY)/4.
    const cx = vee.x + (SF_SHORT_DX + SF_LONG_DX) / 4
    const cy = vee.y + (SF_SHORT_DY + SF_LONG_DY) / 4
    out.push({ type: 'circle', layer, center: annPoint({ x: cx, y: cy }), radius: SF_CIRCLE_R })
  }

  // Read-out text: Ra value + optional allowance + optional lay code, drawn
  // above the long leg (matching the SVG Ra placement). Every fragment is a
  // formatted number or a closed lay code — no operator free-text — but the
  // TEXT emitter escapes it regardless (Safety Rule 4).
  const bits: string[] = []
  if (sf.ra !== undefined) bits.push(`Ra ${formatDxfNumber(sf.ra)}`)
  if (sf.machiningAllowanceMm !== undefined) bits.push(`+${formatDxfNumber(sf.machiningAllowanceMm)}`)
  if (sf.lay !== undefined) bits.push(SF_LAY_DXF_CODE[sf.lay])
  if (bits.length > 0) {
    out.push({
      type: 'text',
      layer,
      at: annPoint({ x: longEnd.x + 1, y: longEnd.y - 1.5 }),
      height: ANN_TEXT_HEIGHT,
      value: bits.join(' '),
      hAlign: 'left'
    })
  }
  return out
}

/**
 * Compose EVERY persisted annotation into a flat DXF entity list, in a stable
 * order (dimensions → GD&T frames → surface finishes → notes → center marks →
 * centerlines). Pure.
 *
 * Surface finishes are rendered as a REAL geometric composite (check-mark LINE
 * legs + a material-disposition modifier + a Ra/lay TEXT read-out) on the
 * ANNOTATIONS layer — see {@link surfaceFinishToEntities}. (The wave-7 honest
 * omission is now closed: the ISO 1302 check-mark, unlike a GD&T glyph, has a
 * faithful R12 primitive form.) When the sheet has no surface finishes, nothing
 * is emitted for them and the rest of the document is byte-identical.
 */
export function annotationsToDxfEntities(annotations: DrawingSheetAnnotations): DxfEntity[] {
  const out: DxfEntity[] = []
  for (const dim of annotations.dimensions) out.push(...dimensionToEntities(dim))
  for (const frame of annotations.featureControlFrames) out.push(...gdtFrameToEntities(frame))
  for (const sf of annotations.surfaceFinishes) out.push(...surfaceFinishToEntities(sf))
  for (const note of annotations.notes) out.push(...noteToEntities(note))
  for (const mark of annotations.centerMarks) out.push(...centerMarkToEntities(mark))
  for (const line of annotations.centerlines) out.push(...centerlineToEntities(line))
  return out
}

/**
 * Build the REAL drawing DXF: mesh projection linework (PROJECTION layer) +
 * every persisted annotation exploded to primitives on its dedicated layer,
 * plus a sheet frame + title/sub-title on the TITLE layer. R12-compatible ASCII
 * DXF that opens in any CAD/CAM importer.
 *
 * The exported name stays `buildPlaceholderDxf` so the export-service call seam
 * is unchanged; the body no longer emits a placeholder. Pure: same input →
 * byte-identical output.
 */
export function buildPlaceholderDxf(opts: {
  projectTitle: string
  generatedAtIso: string
  sheetTitle?: string
  sheetScale?: string
  viewPlaceholders?: { kind: string; label: string; detailLine?: string }[]
  projectedModelViews?: ProjectedModelViewForExport[]
  /** Persisted annotations for the sheet (dimensions, GD&T, notes, center marks). */
  annotations?: DrawingSheetAnnotations
}): string {
  const title = opts.projectTitle.slice(0, 80).replace(/\r|\n/g, ' ')
  const sheetBit =
    opts.sheetTitle != null && opts.sheetTitle.trim() !== ''
      ? ` · ${opts.sheetTitle.trim()}${opts.sheetScale?.trim() ? ` (${opts.sheetScale.trim()})` : ''}`
      : ''
  const viewBit =
    opts.viewPlaceholders && opts.viewPlaceholders.length > 0
      ? ` Views: ${opts.viewPlaceholders
          .map((v) => {
            const bits = [`${v.kind}${v.label.trim() ? ` ${v.label}` : ''}`]
            if (v.detailLine?.trim()) bits.push(v.detailLine.trim())
            return bits.join(' · ')
          })
          .join('; ')}.`
      : ''
  const hasProj = !!(opts.projectedModelViews && opts.projectedModelViews.length > 0)
  const note = `Generated ${opts.generatedAtIso} — ${hasProj ? 'mesh projection on PROJECTION layer' : 'no projected linework'}.${sheetBit}${viewBit}`.slice(
    0,
    250
  )

  const entities: DxfEntity[] = []

  // Sheet frame (A4-landscape-ish, mm) on the TITLE layer.
  const frameCorners: Pt[] = [
    { x: 0, y: 0 },
    { x: 297, y: 0 },
    { x: 297, y: 210 },
    { x: 0, y: 210 }
  ]
  entities.push({
    type: 'polyline',
    layer: DXF_LAYERS.TITLE,
    closed: true,
    points: frameCorners
  })

  // Title + sub-title (near the top of the frame, TITLE layer).
  entities.push({
    type: 'text',
    layer: DXF_LAYERS.TITLE,
    at: { x: 12, y: 198 },
    height: 4,
    value: title
  })
  entities.push({
    type: 'text',
    layer: DXF_LAYERS.TITLE,
    at: { x: 12, y: 188 },
    height: 2.5,
    value: note
  })

  // Projection linework.
  if (opts.projectedModelViews) {
    opts.projectedModelViews.forEach((view, i) => {
      entities.push(...projectedViewToEntities(view, i))
    })
  }

  // Persisted annotations, exploded to primitives.
  if (opts.annotations) {
    entities.push(...annotationsToDxfEntities(opts.annotations))
  }

  const extents = computeEntitiesExtents(entities)
  return assembleDxfDocument(entities, extents ? { extents } : undefined)
}

export function buildFlatPatternDxf(opts: {
  projectTitle: string
  generatedAtIso: string
  outlinePoints: Array<[number, number]>
  bendLines?: Array<[number, number, number, number]>
}): string {
  const title = opts.projectTitle.slice(0, 80).replace(/\r|\n/g, ' ')
  const pts =
    opts.outlinePoints.length >= 3 ? opts.outlinePoints : ([[-50, -30], [50, -30], [50, 30], [-50, 30]] as Array<[number, number]>)
  const bends = opts.bendLines ?? []
  const lines: string[] = []
  const push = (...xs: string[]) => {
    for (const x of xs) lines.push(x)
  }

  push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1012', '0', 'ENDSEC')
  push('0', 'SECTION', '2', 'TABLES')
  push('0', 'TABLE', '2', 'LAYER', '70', '2')
  push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS')
  push('0', 'LAYER', '2', 'BEND', '70', '0', '62', '1', '6', 'DASHED')
  push('0', 'ENDTAB', '0', 'ENDSEC')
  push('0', 'SECTION', '2', 'BLOCKS', '0', 'ENDSEC')
  push('0', 'SECTION', '2', 'ENTITIES')

  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[(i + 1) % pts.length]!
    push('0', 'LINE', '8', '0', '10', String(x1), '20', String(y1), '30', '0', '11', String(x2), '21', String(y2), '31', '0')
  }

  for (const [x1, y1, x2, y2] of bends) {
    push('0', 'LINE', '8', 'BEND', '10', String(x1), '20', String(y1), '30', '0', '11', String(x2), '21', String(y2), '31', '0')
  }

  push('0', 'TEXT', '8', '0', '10', String(pts[0]?.[0] ?? 0), '20', String((pts[0]?.[1] ?? 0) - 8), '30', '0', '40', '4', '1', title)
  push(
    '0',
    'TEXT',
    '8',
    '0',
    '10',
    String(pts[0]?.[0] ?? 0),
    '20',
    String((pts[0]?.[1] ?? 0) - 13),
    '30',
    '0',
    '40',
    '2.5',
    '1',
    `Flat pattern ${opts.generatedAtIso}`.slice(0, 120)
  )

  push('0', 'ENDSEC', '0', 'EOF')
  return lines.join('\r\n')
}
