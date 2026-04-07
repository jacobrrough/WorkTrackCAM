import { randomUUID } from 'node:crypto'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { toolLibraryFileSchema, toolRecordSchema, type ToolLibraryFile, type ToolRecord } from '../shared/tool-schema'

/** Split one CSV line with optional double-quote fields (Fusion exports). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') {
      if (quote && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      quote = !quote
      continue
    }
    if (c === ',' && !quote) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur.trim())
  return out
}

/**
 * Fusion / Manufacture **library export CSV** (wide header row, quoted cells).
 * Assumes diameters are **mm** (Fusion library set to metric). Best-effort column match.
 */
export function parseFusionToolsCsv(content: string): ToolRecord[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headerCells = splitCsvLine(lines[0]!).map((c) => c.toLowerCase())
  const idxDia = headerCells.findIndex(
    (h) => h.includes('diameter') || /\bdiam\b/.test(h) || h.includes('ø')
  )
  if (idxDia < 0) return []
  const idxName = headerCells.findIndex(
    (h) => /\bname\b/.test(h) || h.includes('description') || h.includes('tool name')
  )
  const idxFlutes = headerCells.findIndex((h) => h.includes('flute'))
  const idxStickout = headerCells.findIndex(
    (h) => /\bstick/.test(h) || h.includes('protrusion') || h.includes('gage') || h.includes('ga[u]ge')
  )
  const idxLength = headerCells.findIndex(
    (h) =>
      (h.includes('overall') && h.includes('length')) ||
      /\boal\b/.test(h) ||
      (h.includes('tool') && h.includes('length') && !h.includes('flute'))
  )
  const idxMaterial = headerCells.findIndex((h) => h.includes('material') || h.includes('coating'))
  const tools: ToolRecord[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!)
    const diaRaw = cells[idxDia]?.replace(/,/g, '.').replace(/[^\d.-]/g, '') ?? ''
    const dia = Number(diaRaw)
    if (!Number.isFinite(dia) || dia <= 0) continue
    const name =
      idxName >= 0 && cells[idxName]?.length
        ? cells[idxName]!.replace(/^"|"$/g, '')
        : `Tool Ø${dia}`
    const flutes = idxFlutes >= 0 ? Number(cells[idxFlutes]) : undefined
    const stickoutRaw = idxStickout >= 0 ? cells[idxStickout]?.replace(/,/g, '.').replace(/[^\d.-]/g, '') : ''
    const stickoutMm = Number(stickoutRaw)
    const lenRaw = idxLength >= 0 ? cells[idxLength]?.replace(/,/g, '.').replace(/[^\d.-]/g, '') : ''
    const lengthMm = Number(lenRaw)
    const material =
      idxMaterial >= 0 && cells[idxMaterial]?.trim().length ? cells[idxMaterial]!.replace(/^"|"$/g, '') : undefined
    tools.push(
      toolRecordSchema.parse({
        id: randomUUID(),
        name,
        type: 'endmill',
        diameterMm: dia,
        fluteCount: Number.isFinite(flutes) ? flutes : undefined,
        stickoutMm: Number.isFinite(stickoutMm) && stickoutMm > 0 ? stickoutMm : undefined,
        lengthMm: Number.isFinite(lengthMm) && lengthMm > 0 ? lengthMm : undefined,
        material: material?.trim() ? material.trim() : undefined,
        source: 'fusion'
      })
    )
  }
  return tools
}

export function parseToolsCsv(content: string): ToolRecord[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const header = lines[0].toLowerCase()
  const hasHeader = header.includes('diameter') || header.includes('name')
  const start = hasHeader ? 1 : 0
  const tools: ToolRecord[] = []
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.trim())
    const name = parts[0] ?? 'tool'
    const diameter = Number(parts[1])
    if (!Number.isFinite(diameter) || diameter <= 0) continue
    const flutes = parts[2] ? Number(parts[2]) : undefined
    const typeRaw = (parts[3] ?? 'endmill').toLowerCase()
    const type = (
      ['endmill', 'ball', 'vbit', 'drill', 'face', 'other'].includes(typeRaw) ? typeRaw : 'endmill'
    ) as ToolRecord['type']
    tools.push(
      toolRecordSchema.parse({
        id: randomUUID(),
        name,
        type,
        diameterMm: diameter,
        fluteCount: Number.isFinite(flutes) ? flutes : undefined,
        source: 'csv'
      })
    )
  }
  return tools
}

export function parseToolsJson(content: string): ToolLibraryFile {
  const data = JSON.parse(content) as unknown
  if (Array.isArray(data)) {
    const tools = data.map((t) => toolRecordSchema.parse({ ...t, id: (t as { id?: string }).id ?? randomUUID() }))
    return toolLibraryFileSchema.parse({ version: 1, tools })
  }
  return toolLibraryFileSchema.parse(data)
}

/** Gzip magic; HSM / Fusion sometimes ship libraries gzipped. */
/**
 * Extract the first text entry from a ZIP buffer that matches `targetName`.
 * Handles both STORED (method=0) and DEFLATE (method=8) entries.
 * Returns null if the file is not a ZIP or the target entry isn't found.
 */
function extractZipEntry(buf: Buffer, targetName: string): string | null {
  const SIG = 0x04034b50 // local file header
  let pos = 0
  while (pos + 30 <= buf.length) {
    if (buf.readUInt32LE(pos) !== SIG) break
    const method    = buf.readUInt16LE(pos + 8)
    const cmpSize   = buf.readUInt32LE(pos + 18)
    const fnLen     = buf.readUInt16LE(pos + 26)
    const exLen     = buf.readUInt16LE(pos + 28)
    const dataStart = pos + 30 + fnLen + exLen
    const entryName = buf.slice(pos + 30, pos + 30 + fnLen).toString('utf-8')
    if (entryName === targetName) {
      const compressed = buf.slice(dataStart, dataStart + cmpSize)
      if (method === 0) return compressed.toString('utf-8')            // stored
      if (method === 8) return inflateRawSync(compressed).toString('utf-8') // deflate
      return null // unsupported compression
    }
    pos = dataStart + cmpSize
  }
  return null
}

export function bufferToUtf8ToolXml(buf: Buffer): string {
  // ZIP archive (magic PK\x03\x04) — Fusion 360 .tools files are ZIPs containing tools.json
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const json = extractZipEntry(buf, 'tools.json') ?? extractZipEntry(buf, 'Tools.json')
    if (json) return json
    // Scan all entries for any .json file
    const SIG = 0x04034b50
    let pos = 0
    while (pos + 30 <= buf.length) {
      if (buf.readUInt32LE(pos) !== SIG) break
      const method    = buf.readUInt16LE(pos + 8)
      const cmpSize   = buf.readUInt32LE(pos + 18)
      const fnLen     = buf.readUInt16LE(pos + 26)
      const exLen     = buf.readUInt16LE(pos + 28)
      const dataStart = pos + 30 + fnLen + exLen
      const entryName = buf.slice(pos + 30, pos + 30 + fnLen).toString('utf-8')
      if (entryName.endsWith('.json')) {
        const compressed = buf.slice(dataStart, dataStart + cmpSize)
        try {
          if (method === 0) return compressed.toString('utf-8')
          if (method === 8) return inflateRawSync(compressed).toString('utf-8')
        } catch { /* skip */ }
      }
      pos = dataStart + cmpSize
    }
  }
  // Gzip
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf).toString('utf-8')
    } catch {
      /* fall through */
    }
  }
  return buf.toString('utf-8')
}

function xmlTextContent(tag: string, block: string): string | undefined {
  const re = new RegExp(`<(?:[\\w.]+:)?${tag}\\b[^>]*>([^<]*)</(?:[\\w.]+:)?${tag}>`, 'i')
  const m = block.match(re)
  return m?.[1]?.trim()
}

function parseLocalizedNumber(s: string): number {
  return Number(s.replace(/,/g, '.').replace(/[^\d.-]/g, ''))
}

function parseDiameterMm(block: string): number | null {
  const mAttr = block.match(
    /<(?:[\w.]+:)?Diameter\b[^>]*\bunit\s*=\s*["']([^"']*)["'][^>]*>\s*([^<]+)\s*</i
  )
  const mPlain = block.match(/<(?:[\w.]+:)?Diameter\b[^>]*>\s*([^<]+)\s*</i)
  const raw = (mAttr?.[2] ?? mPlain?.[1])?.trim()
  if (!raw) return null
  const n = parseLocalizedNumber(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = (mAttr?.[1] ?? 'mm').toLowerCase()
  if (unit.includes('inch') || unit === 'in' || unit === '"') return n * 25.4
  return n
}

function parseFlutes(block: string): number | undefined {
  for (const t of ['NumberOfFlutes', 'FluteCount', 'Flutes']) {
    const v = xmlTextContent(t, block)
    if (v?.length) {
      const n = Number(v.replace(/\D/g, ''))
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  return undefined
}

function parseToolName(block: string, fallbackDia: number): string {
  for (const t of ['Description', 'Name', 'Title', 'ProductID', 'ProductId', 'ToolNumber']) {
    const v = xmlTextContent(t, block)
    if (v?.length) return v
  }
  return `Tool Ø${fallbackDia}`
}

function parsePositiveMmFromTags(block: string, tagNames: string[]): number | undefined {
  for (const t of tagNames) {
    const v = xmlTextContent(t, block)
    if (!v?.length) continue
    const n = parseLocalizedNumber(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function mapHsmToolType(block: string): ToolRecord['type'] {
  const raw = (xmlTextContent('ToolType', block) ?? xmlTextContent('Type', block) ?? '').toLowerCase()
  if (/\bball\b|ballnose|ball_nose/.test(raw)) return 'ball'
  if (/\bdrill\b|\bspot\b|\bcenter\b/.test(raw)) return 'drill'
  if (/\bface\b|\bshell\b|\bfacemill\b/.test(raw)) return 'face'
  if (/\bv-?bit\b|\bchamfer\b|\bvbit\b/.test(raw)) return 'vbit'
  return 'endmill'
}

/**
 * Best-effort **HSM / hsmlib-style** XML: repeated `Tool` elements with `Diameter` (+ optional `Description`).
 * Not a full schema; tolerates XML namespaces on tags.
 */
export function parseHsmToolLibraryXml(xml: string): ToolRecord[] {
  const re = /<(?:[\w.]+:)?Tool\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?Tool>/gi
  const tools: ToolRecord[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]!
    const dia = parseDiameterMm(block)
    if (dia == null) continue
    const name = parseToolName(block, dia)
    const fluteCount = parseFlutes(block)
    const stickoutMm = parsePositiveMmFromTags(block, ['Stickout', 'StickOut', 'Protrusion', 'GaugeLength'])
    const lengthMm = parsePositiveMmFromTags(block, ['OverallLength', 'OAL', 'ToolLength', 'Length'])
    const material = xmlTextContent('Material', block)?.trim() || xmlTextContent('Grade', block)?.trim()
    const key = `${name}:${dia}`
    if (seen.has(key)) continue
    seen.add(key)
    tools.push(
      toolRecordSchema.parse({
        id: randomUUID(),
        name,
        type: mapHsmToolType(block),
        diameterMm: dia,
        fluteCount,
        stickoutMm,
        lengthMm,
        material: material?.length ? material : undefined,
        source: 'hsm'
      })
    )
  }
  return tools
}

/**
 * Fusion 360 `.tools` JSON format.
 * Structure: { data: { tools: [ { type, description, NFLUTES, geometry: { DC, OAL, LCF } } ] } }
 * DC = diameter (mm), OAL = overall length, LCF = cutting length / stickout.
 */
export function parseFusionToolsFile(content: string): ToolRecord[] {
  let data: unknown
  try { data = JSON.parse(content) } catch { return [] }

  // Locate the tools array wherever it lives in the structure
  const findTools = (obj: unknown): unknown[] | null => {
    if (!obj || typeof obj !== 'object') return null
    if (Array.isArray(obj)) return obj
    const rec = obj as Record<string, unknown>
    if (Array.isArray(rec.tools)) return rec.tools as unknown[]
    for (const v of Object.values(rec)) {
      const found = findTools(v)
      if (found) return found
    }
    return null
  }

  const toolsArr = findTools(data)
  if (!toolsArr) return []

  const out: ToolRecord[] = []
  for (const raw of toolsArr) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    const geo = (t.geometry ?? {}) as Record<string, unknown>

    const dia = Number(geo['DC'] ?? geo['diameter'] ?? geo['Diameter'] ?? 0)
    if (!Number.isFinite(dia) || dia <= 0) continue

    const name = String(t.description ?? t.name ?? t['product-id'] ?? `Tool Ø${dia}`)
    const fluteCount = t['NFLUTES'] != null ? Number(t['NFLUTES']) :
      t['numberOfFlutes'] != null ? Number(t['numberOfFlutes']) : undefined
    const oal = Number(geo['OAL'] ?? geo['overall-length'] ?? 0)
    const lcf = Number(geo['LCF'] ?? geo['flute-length'] ?? geo['SHOULDER-LEN'] ?? 0)

    const rawType = String(t.type ?? '').toLowerCase()
    const type: ToolRecord['type'] =
      rawType.includes('ball') ? 'ball' :
      rawType.includes('drill') || rawType.includes('spot') ? 'drill' :
      rawType.includes('face') ? 'face' :
      rawType.includes('chamfer') || rawType.includes('vbit') || rawType.includes('v-bit') ? 'vbit' :
      'endmill'

    out.push(toolRecordSchema.parse({
      id: randomUUID(),
      name: name.trim() || `Tool Ø${dia}`,
      type,
      diameterMm: dia,
      fluteCount: Number.isFinite(fluteCount) && (fluteCount ?? 0) > 0 ? fluteCount : undefined,
      stickoutMm: Number.isFinite(lcf) && lcf > 0 ? lcf : undefined,
      lengthMm: Number.isFinite(oal) && oal > 0 ? oal : undefined,
      source: 'fusion'
    }))
  }
  return out
}

/**
 * Load tool rows from a library **file** (CSV, JSON, Fusion `.tools`, gzipped XML `.hsmlib` / `.tpgz`, `.tp.xml`, `.xml`).
 */
export function inferToolRecordsFromFileBuffer(fileName: string, buf: Buffer): ToolRecord[] {
  const lower = fileName.toLowerCase()
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  if (ext === 'json') {
    const txt = buf.toString('utf-8')
    try {
      return parseToolsJson(txt).tools
    } catch {
      return parseFusionToolExport(txt)
    }
  }

  if (ext === 'csv') {
    const txt = buf.toString('utf-8')
    let t = parseToolsCsv(txt)
    if (t.length === 0) t = parseFusionToolsCsv(txt)
    return t
  }

  // Fusion 360 .tools files — JSON with nested data.tools array (often gzip-wrapped; header may name tools.json)
  if (ext === 'tools') {
    const txt = bufferToUtf8ToolXml(buf)
    // Try the Fusion .tools JSON format first
    const fromFusion = parseFusionToolsFile(txt)
    if (fromFusion.length > 0) return fromFusion
    // Fallback: try as a plain JSON tool library
    try {
      const lib = parseToolsJson(txt)
      if (lib.tools.length > 0) return lib.tools
    } catch { /* */ }
    // Last resort: treat as XML (some older exports)
    return parseHsmToolLibraryXml(txt)
  }

  const xmlByName =
    lower.endsWith('.hsmlib') ||
    lower.endsWith('.tpgz') ||
    lower.endsWith('.tp.xml') ||
    (ext === 'xml' && (lower.includes('tool') || lower.includes('library') || lower.includes('hsm')))

  if (xmlByName) {
    return parseHsmToolLibraryXml(bufferToUtf8ToolXml(buf))
  }

  const decoded = bufferToUtf8ToolXml(buf)
  if (/<[a-z0-9]*:?Tool\b/i.test(decoded)) {
    return parseHsmToolLibraryXml(decoded)
  }

  return []
}

/** Fusion-style JSON array export (loose keys). */
export function parseFusionToolExport(content: string): ToolRecord[] {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: ToolRecord[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const name = String(r.name ?? r.description ?? 'Fusion tool')
    const dia = Number(r.diameter ?? r.Diameter ?? r['diameter'])
    if (!Number.isFinite(dia) || dia <= 0) continue
    out.push(
      toolRecordSchema.parse({
        id: randomUUID(),
        name,
        type: 'endmill',
        diameterMm: dia,
        fluteCount: r.fluteCount != null ? Number(r.fluteCount) : undefined,
        source: 'fusion'
      })
    )
  }
  return out
}

/** Vectric / generic SQLite tool DB — optional path handled in IPC with better-sqlite3 omitted; use CSV export from Vectric instead. */
export function mergeToolLibraries(base: ToolLibraryFile, extra: ToolRecord[]): ToolLibraryFile {
  const seen = new Set(base.tools.map((t) => `${t.name}:${t.diameterMm}`))
  const tools = [...base.tools]
  for (const t of extra) {
    const key = `${t.name}:${t.diameterMm}`
    if (seen.has(key)) continue
    seen.add(key)
    tools.push(t)
  }
  return toolLibraryFileSchema.parse({ ...base, tools })
}
