/**
 * setup-sheet.ts — HTML Setup Sheet generator
 *
 * Generates a printable, self-contained HTML document for a CNC job,
 * including: machine info, stock dimensions, operations table with tool
 * data and cut parameters, G-code stats (if gcode exists), and a
 * disclaimer. Saves to a .html file and opens in the system browser.
 */

import { resolveManufactureSetupForCam } from '../../shared/cam-cut-params'
import type { MachineProfile } from '../../shared/machine-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import type { ToolRecord } from '../../shared/tool-schema'

// ── Types (mirrors ShopApp.tsx local types to keep this file standalone) ─────
export interface SetupSheetJob {
  name: string
  stlPath: string | null
  machineId: string | null
  materialId: string | null
  stock: { x: number; y: number; z: number }
  /** When set (Shop 4-/5-axis session), cylinder stock along rotation axis + chuck context. */
  rotarySetup?: {
    cylinderDiameterMm: number
    cylinderLengthMm: number
    chuckDepthMm: number
    clampOffsetMm: number
  }
  operations: Array<{
    id: string
    kind: string
    label: string
    params?: Record<string, unknown>
  }>
  gcodeOut: string | null
}

export interface GcodeStats {
  totalLines: number
  motionLines: number
  cuttingMoves: number
  xyBounds: { minX: number; maxX: number; minY: number; maxY: number } | null
  zRange: { topZ: number; bottomZ: number } | null
  estimatedTimeSec?: number   // rough estimate: cutting moves / feed rate * mm-per-move
}

// ── Rough cycle-time estimate from G-code text ────────────────────────────────
export function parseGcodeStats(text: string): GcodeStats {
  const lines = text.split(/\r?\n/)
  let x = 0, y = 0, z = 0
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let topZ = -Infinity, bottomZ = Infinity
  let motionLines = 0, cuttingMoves = 0
  let totalFeedDist = 0, totalFeedRate = 1200

  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trim().toUpperCase()
    if (!line) continue
    const isG0 = /^G0\b|^G00\b/.test(line)
    const isG1 = /^G1\b|^G01\b/.test(line)
    if (!isG0 && !isG1) continue
    motionLines++
    const px = x, py = y, pz = z
    const xm = line.match(/X(-?[\d.]+)/); if (xm) x = +xm[1]
    const ym = line.match(/Y(-?[\d.]+)/); if (ym) y = +ym[1]
    const zm = line.match(/Z(-?[\d.]+)/); if (zm) z = +zm[1]
    const fm = line.match(/F(-?[\d.]+)/); if (fm && isG1) totalFeedRate = +fm[1]
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    topZ = Math.max(topZ, z); bottomZ = Math.min(bottomZ, z)
    if (isG1 && z < 0) {
      cuttingMoves++
      const dist = Math.sqrt((x-px)**2 + (y-py)**2 + (z-pz)**2)
      totalFeedDist += dist
    }
  }

  const estimatedTimeSec = totalFeedRate > 0 ? (totalFeedDist / totalFeedRate) * 60 : undefined

  return {
    totalLines: lines.length,
    motionLines,
    cuttingMoves,
    xyBounds: isFinite(minX) ? { minX, maxX, minY, maxY } : null,
    zRange: isFinite(topZ) ? { topZ, bottomZ } : null,
    estimatedTimeSec
  }
}

function fmt(n: number | undefined | null, dec = 1): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toFixed(dec)
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── HTML generator ─────────────────────────────────────────────────────────────
export function generateSetupSheet(opts: {
  job: SetupSheetJob
  machine: MachineProfile | null
  material: MaterialRecord | null
  tools: ToolRecord[]
  gcodeStats: GcodeStats | null
  /** When set, first lines are shown as an excerpt (not full program). */
  gcodeText?: string | null
  generatedAt?: Date
}): string {
  const { job, machine, material, tools, gcodeStats, gcodeText } = opts
  const now = (opts.generatedAt ?? new Date()).toLocaleString()
  const modelFile = job.stlPath ? job.stlPath.split(/[\\/]/).pop() : '—'
  const gcodeFile = job.gcodeOut ? job.gcodeOut.split(/[\\/]/).pop() : 'Not generated'

  const TOOL_TYPES: Record<string, string> = {
    endmill: 'Flat Endmill', ball: 'Ball Nose', vbit: 'V-Bit',
    drill: 'Drill', face: 'Face Mill', other: 'Other'
  }

  // Build ops rows
  const opRows = job.operations.map((op, i) => {
    const p = (op.params ?? {}) as Record<string, unknown>
    const toolDiam = p['toolDiameterMm'] != null ? `Ø${p['toolDiameterMm']}mm` : '—'
    const toolId = typeof p['toolId'] === 'string' ? p['toolId'] : null
    const libTool = toolId ? tools.find(t => t.id === toolId) : null
    const toolName = libTool
      ? `${libTool.diameterMm}mm ${TOOL_TYPES[libTool.type] ?? libTool.type}${libTool.name ? ` — ${libTool.name}` : ''}`
      : toolDiam

    const feed    = p['feedMmMin']    != null ? `${p['feedMmMin']} mm/min`    : '—'
    const plunge  = p['plungeMmMin']  != null ? `${p['plungeMmMin']} mm/min`  : '—'
    const doc     = p['zPassMm']      != null ? `${Math.abs(+(p['zPassMm'] as number))} mm`     : '—'
    const stepover = p['stepoverMm'] != null ? `${p['stepoverMm']} mm`       : '—'
    const safeZ   = p['safeZMm']     != null ? `${p['safeZMm']} mm`          : '—'

    const extraBits: string[] = []
    const fs = p['finishScallopMm']
    if (typeof fs === 'number' && Number.isFinite(fs) && fs > 0) extraBits.push(`finish scallop ${fs} mm`)
    const fsm = p['finishScallopMode']
    if (typeof fsm === 'string' && fsm.trim()) extraBits.push(`scallop mode: ${fsm}`)
    const rs = p['rasterRestStockMm']
    if (typeof rs === 'number' && Number.isFinite(rs) && rs > 0) extraBits.push(`raster rest +${rs} mm`)
    const extraLine =
      extraBits.length > 0
        ? `<br><span style="font-size:10px;color:#6b7280">${extraBits.join(' · ')}</span>`
        : ''

    return `
      <tr>
        <td style="color:#8899aa;font-family:monospace;font-size:12px">${i+1}</td>
        <td><strong>${op.label}</strong><br><span style="font-size:11px;color:#8899aa">${op.kind}</span>${extraLine}</td>
        <td>${toolName}</td>
        <td>${feed}</td>
        <td>${plunge}</td>
        <td>${doc}</td>
        <td>${stepover}</td>
        <td>${safeZ}</td>
      </tr>`
  }).join('\n')

  // Tool summary (unique tools used)
  const usedToolIds = new Set(
    job.operations
      .map(op => (op.params as Record<string, unknown> | undefined)?.['toolId'])
      .filter((id): id is string => typeof id === 'string')
  )
  const usedTools = tools.filter(t => usedToolIds.has(t.id))
  const toolListRows = usedTools.map(t => `
      <tr>
        <td>T${tools.indexOf(t)+1}</td>
        <td>${t.diameterMm}mm</td>
        <td>${TOOL_TYPES[t.type] ?? t.type}</td>
        <td>${t.fluteCount ?? '—'}</td>
        <td>${t.stickoutMm ? `${t.stickoutMm}mm` : '—'}</td>
        <td style="color:#8899aa">${t.name ?? ''}</td>
      </tr>`).join('\n')

  const statsSection = gcodeStats ? `
    <section>
      <h2>G-code Statistics</h2>
      <table class="stats-table">
        <tr><td>Total lines</td><td>${gcodeStats.totalLines.toLocaleString()}</td></tr>
        <tr><td>Motion lines</td><td>${gcodeStats.motionLines.toLocaleString()}</td></tr>
        <tr><td>Cutting moves (G1 below Z0)</td><td>${gcodeStats.cuttingMoves.toLocaleString()}</td></tr>
        ${gcodeStats.xyBounds ? `
        <tr><td>XY extents</td><td>
          X: ${fmt(gcodeStats.xyBounds.minX)} → ${fmt(gcodeStats.xyBounds.maxX)} mm &nbsp;|&nbsp;
          Y: ${fmt(gcodeStats.xyBounds.minY)} → ${fmt(gcodeStats.xyBounds.maxY)} mm
        </td></tr>` : ''}
        ${gcodeStats.zRange ? `
        <tr><td>Z range</td><td>${fmt(gcodeStats.zRange.bottomZ)} → ${fmt(gcodeStats.zRange.topZ)} mm</td></tr>` : ''}
        ${gcodeStats.estimatedTimeSec != null ? `
        <tr><td>Est. cutting time <span class="note">(rough lower bound)</span></td>
            <td><strong>${fmtTime(gcodeStats.estimatedTimeSec)}</strong></td></tr>` : ''}
      </table>
      <p class="disclaimer">G-code stats are text-only (no stock removal or collision simulation).
        Verify post-processor output, units, work offsets, and clearances before running.</p>
    </section>` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup Sheet — ${job.name}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px; line-height: 1.5; color: #1a1a2e;
    background: #f8f9fa; padding: 0;
  }
  .page { max-width: 960px; margin: 0 auto; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff; padding: 24px 32px; display: flex; align-items: flex-start; gap: 24px;
  }
  header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  header .meta { font-size: 11px; opacity: 0.65; margin-top: 4px; }
  header .badge {
    background: rgba(61,126,255,0.25); border: 1px solid rgba(61,126,255,0.4);
    color: #7cb8ff; border-radius: 5px; padding: 3px 10px; font-size: 11px; white-space: nowrap;
  }
  section { padding: 20px 32px; border-bottom: 1px solid #e8eaee; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280;
       margin-bottom: 12px; padding-bottom: 5px; border-bottom: 1px solid #e8eaee; }
  .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .info-card {
    background: #f8f9fa; border: 1px solid #e8eaee; border-radius: 6px;
    padding: 10px 14px;
  }
  .info-card .label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
  .info-card .value { font-size: 14px; font-weight: 600; color: #111827; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
       color: #6b7280; border-bottom: 2px solid #e8eaee; padding: 6px 10px; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f2f5; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #fafafa; }
  .stats-table td:first-child { color: #6b7280; width: 260px; }
  .stats-table td:last-child { font-weight: 500; }
  .disclaimer { font-size: 10px; color: #9ca3af; margin-top: 10px; font-style: italic; }
  .note { font-size: 10px; color: #9ca3af; font-weight: 400; }
  footer { padding: 16px 32px; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; max-width: 100%; }
    section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <div style="flex:1">
      <h1>Setup Sheet — ${job.name}</h1>
      <div class="meta">Generated ${now}</div>
    </div>
    <div class="badge">${machine?.name ?? 'Unknown Machine'}</div>
  </header>

  <section>
    <h2>Job Overview</h2>
    <div class="info-grid">
      <div class="info-card">
        <div class="label">Model File</div>
        <div class="value" style="font-size:12px;word-break:break-all">${modelFile}</div>
      </div>
      <div class="info-card">
        <div class="label">Material</div>
        <div class="value">${material?.name ?? job.materialId ?? '—'}</div>
      </div>
      <div class="info-card">
        <div class="label">Stock (X)</div>
        <div class="value">${job.stock.x} mm</div>
      </div>
      <div class="info-card">
        <div class="label">Stock (Y)</div>
        <div class="value">${job.stock.y} mm</div>
      </div>
      <div class="info-card">
        <div class="label">Stock (Z / Height)</div>
        <div class="value">${job.stock.z} mm</div>
      </div>
      <div class="info-card">
        <div class="label">G-code File</div>
        <div class="value" style="font-size:11px;word-break:break-all">${gcodeFile}</div>
      </div>
      ${machine ? `
      <div class="info-card">
        <div class="label">Machine</div>
        <div class="value" style="font-size:12px">${machine.name}</div>
      </div>
      <div class="info-card">
        <div class="label">Post Processor</div>
        <div class="value" style="font-size:12px">${machine.postTemplate ?? '—'}</div>
      </div>` : ''}
    </div>
  </section>

  ${job.rotarySetup ? `
  <section>
    <h2>Rotary stock (session)</h2>
    <div class="info-grid">
      <div class="info-card">
        <div class="label">Cylinder Ø (stock Y)</div>
        <div class="value">${fmt(job.rotarySetup.cylinderDiameterMm, 2)} mm</div>
      </div>
      <div class="info-card">
        <div class="label">Cylinder length (stock X)</div>
        <div class="value">${fmt(job.rotarySetup.cylinderLengthMm, 2)} mm</div>
      </div>
      <div class="info-card">
        <div class="label">Chuck depth</div>
        <div class="value">${job.rotarySetup.chuckDepthMm} mm</div>
      </div>
      <div class="info-card">
        <div class="label">Clamp offset</div>
        <div class="value">${fmt(job.rotarySetup.clampOffsetMm, 2)} mm</div>
      </div>
    </div>
    <p class="disclaimer" style="margin-top:10px">4-axis posts are unverified until you confirm A-axis WCS, cylinder diameter, and clearance — see docs/MACHINES.md.</p>
  </section>` : ''}

  <section>
    <h2>CAM guardrails & verification</h2>
    <p style="font-size:12px;color:#374151;max-width:52rem">
      Feeds, plunge, stepover, and depth are copied from the job as entered. The app may clamp values to safe minimums and append
      <strong>machine work-volume hints</strong> after posting when parsed G-code exceeds the profile <code>workAreaMm</code> (WCS must match your fixture).
      G-code remains <strong>unverified</strong> for any real machine until you air-cut, check the post, and follow <strong>docs/MACHINES.md</strong> in the project.
    </p>
  </section>

  <section>
    <h2>Operation sequence (${job.operations.length})</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Operation</th>
          <th>Tool</th>
          <th>Feed</th>
          <th>Plunge</th>
          <th>DOC</th>
          <th>Stepover</th>
          <th>Safe Z</th>
        </tr>
      </thead>
      <tbody>${opRows}</tbody>
    </table>
  </section>

  ${usedTools.length > 0 ? `
  <section>
    <h2>Tool List (${usedTools.length} from library)</h2>
    <table>
      <thead>
        <tr>
          <th>Pocket</th>
          <th>Diameter</th>
          <th>Type</th>
          <th>Flutes</th>
          <th>Stickout</th>
          <th>Name / Notes</th>
        </tr>
      </thead>
      <tbody>${toolListRows}</tbody>
    </table>
  </section>` : ''}

  ${statsSection}

  ${
    gcodeText && gcodeText.trim().length > 0
      ? `<section>
    <h2>G-code excerpt <span class="note">(first 50 lines)</span></h2>
    <pre style="font-size:10px;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:6px;overflow:auto;max-height:280px;white-space:pre-wrap;word-break:break-all">${escapeHtml(
      gcodeText.split(/\r?\n/).slice(0, 50).join('\n')
    )}</pre>
    <p class="disclaimer">Excerpt only — open the full <code>cam.nc</code> (or project output) for the complete program.</p>
  </section>`
      : ''
  }

  <footer>
    Unified Fab Studio — Setup Sheet &nbsp;|&nbsp; ${job.name} &nbsp;|&nbsp; ${now}
    <br>Always verify G-code, work offsets, and tool lengths before running. The operator is responsible for machine safety.
  </footer>
</div>
</body>
</html>`

  return html
}

/** Build a setup sheet job from `manufacture.json` + resolved CAM setup (Make / Plan tab). */
export function buildSetupSheetJobFromManufacture(input: {
  projectName: string
  mfg: ManufactureFile
  camMachineId: string | undefined
  gcodePath: string | null
  sourceStlPath: string | null
}): SetupSheetJob {
  const setup = resolveManufactureSetupForCam(input.mfg, input.camMachineId)
  const st = setup?.stock
  let stock = { x: 100, y: 100, z: 20 }
  if (st && (st.kind === 'box' || st.kind === 'cylinder')) {
    const sx = typeof st.x === 'number' && st.x > 0 ? st.x : stock.x
    const sy = typeof st.y === 'number' && st.y > 0 ? st.y : stock.y
    const sz = typeof st.z === 'number' && st.z > 0 ? st.z : stock.z
    stock = { x: sx, y: sy, z: sz }
  }
  let rotarySetup: SetupSheetJob['rotarySetup']
  if (setup?.axisMode === '4axis' && st && (st.kind === 'box' || st.kind === 'cylinder')) {
    const lx = typeof st.x === 'number' && st.x > 0 ? st.x : 0
    const dia = typeof st.y === 'number' && st.y > 0 ? st.y : 0
    if (lx > 0 && dia > 0) {
      rotarySetup = {
        cylinderLengthMm: lx,
        cylinderDiameterMm: dia,
        chuckDepthMm: 5,
        clampOffsetMm: 0
      }
    }
  }
  return {
    name: input.projectName,
    stlPath: input.sourceStlPath,
    machineId: setup?.machineId ?? null,
    materialId: null,
    stock,
    ...(rotarySetup ? { rotarySetup } : {}),
    operations: input.mfg.operations.map((op) => ({
      id: op.id,
      kind: op.kind,
      label: op.label,
      params: (op.params ?? {}) as Record<string, unknown>
    })),
    gcodeOut: input.gcodePath
  }
}
