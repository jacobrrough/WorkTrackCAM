/** Pure title-block HTML + minimal DXF for drawing export (optional Tier A mesh projection). */

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
  const app = escapeHtml(opts.appLabel ?? 'Unified Fab Studio')
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

function dxfEmitProjectedLines(push: (...xs: string[]) => void, views: ProjectedModelViewForExport[]): void {
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi]!
    const box = view.layout
    const px = box?.originXMM ?? defaultViewBoxMm(vi).x
    const py = box?.originYMM ?? defaultViewBoxMm(vi).y
    const pw = box?.widthMM ?? defaultViewBoxMm(vi).w
    const ph = box?.heightMM ?? defaultViewBoxMm(vi).h
    const bb = bboxFromSegments(view.segments)
    if (!bb) continue
    const pad = Math.max(0.5, Math.min(pw, ph) * 0.04)
    const bw = bb.maxX - bb.minX + 2 * pad
    const bh = bb.maxY - bb.minY + 2 * pad
    const sc = Math.min(pw / bw, ph / bh)
    const ox = px + (pw - bw * sc) / 2
    const oy = py + (ph - bh * sc) / 2
    const tx = -bb.minX + pad
    const ty = -bb.minY + pad

    for (const s of view.segments) {
      const x1 = ox + (s.x1 + tx) * sc
      const y1 = oy + ph - (s.y1 + ty) * sc
      const x2 = ox + (s.x2 + tx) * sc
      const y2 = oy + ph - (s.y2 + ty) * sc
      push(
        '0',
        'LINE',
        '8',
        'PROJECTION',
        '10',
        String(x1),
        '20',
        String(y1),
        '30',
        '0',
        '11',
        String(x2),
        '21',
        String(y2),
        '31',
        '0'
      )
    }
  }
}

/** Minimal ASCII DXF (R12-style) with a frame and labels — opens in most CAD viewers. */
export function buildPlaceholderDxf(opts: {
  projectTitle: string
  generatedAtIso: string
  sheetTitle?: string
  sheetScale?: string
  viewPlaceholders?: { kind: string; label: string; detailLine?: string }[]
  projectedModelViews?: ProjectedModelViewForExport[]
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
  const note = `Generated ${opts.generatedAtIso} — ${hasProj ? 'Tier A mesh projection on PROJECTION layer' : 'placeholder sheet'}.${sheetBit}${viewBit}`.slice(
    0,
    250
  )

  const lines: string[] = []
  const push = (...xs: string[]) => {
    for (const x of xs) lines.push(x)
  }

  push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1012', '0', 'ENDSEC')
  push('0', 'SECTION', '2', 'TABLES')
  push('0', 'TABLE', '2', 'LAYER', '70', hasProj ? '2' : '1')
  push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS')
  if (hasProj) {
    push('0', 'LAYER', '2', 'PROJECTION', '70', '0', '62', '250', '6', 'CONTINUOUS')
  }
  push('0', 'ENDTAB', '0', 'ENDSEC')
  push('0', 'SECTION', '2', 'BLOCKS', '0', 'ENDSEC')
  push('0', 'SECTION', '2', 'ENTITIES')

  // Outer frame (mm-ish units)
  const frame = [
    [0, 0, 297, 0],
    [297, 0, 297, 210],
    [297, 210, 0, 210],
    [0, 210, 0, 0]
  ] as const
  for (const [x1, y1, x2, y2] of frame) {
    push('0', 'LINE', '8', '0', '62', '250', '10', String(x1), '20', String(y1), '30', '0', '11', String(x2), '21', String(y2), '31', '0')
  }

  push(
    '0',
    'TEXT',
    '8',
    '0',
    '62',
    '7',
    '10',
    '12',
    '20',
    '198',
    '30',
    '0',
    '40',
    '4',
    '1',
    title
  )
  push(
    '0',
    'TEXT',
    '8',
    '0',
    '62',
    '8',
    '10',
    '12',
    '20',
    '188',
    '30',
    '0',
    '40',
    '2.5',
    '1',
    note
  )

  if (hasProj) {
    dxfEmitProjectedLines(push, opts.projectedModelViews!)
  }

  push('0', 'ENDSEC', '0', 'EOF')
  return lines.join('\r\n')
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
