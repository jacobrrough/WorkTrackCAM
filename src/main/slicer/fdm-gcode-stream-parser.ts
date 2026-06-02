/**
 * fdm-gcode-stream-parser.ts — streaming main-process parser that turns a
 * sliced K2 Plus G-code file into a TRUE per-layer breakdown (CAD V1.5).
 *
 * ── Why streaming ────────────────────────────────────────────────────────
 *
 * A tall 0.2 mm K2 print is 1,500+ layers / 5–30 MB of G-code. The renderer
 * never needs the raw text for the Preview scrubber — it only needs the
 * compact per-layer array. So we scan the file line-by-line via
 * `node:readline` + `createReadStream` (constant memory) and return a
 * `FdmLayerBreakdownResult` (typically 100–2000 entries, ~200 KB JSON —
 * trivial over IPC). We never `readFile(p, 'utf-8')` the whole file.
 *
 * ── Markers parsed ───────────────────────────────────────────────────────
 *
 * OrcaSlicer for the Creality K2 Plus emits, per layer
 * (`resources/orca-slicer/profiles/machines/creality-k2-plus.json` ->
 * `before_layer_change_gcode: ";BEFORE_LAYER_CHANGE\n;[layer_z]\n..."`):
 *
 *     ;BEFORE_LAYER_CHANGE
 *     ;0.20                     <- bare layer Z (mm)
 *     ...motion...
 *
 * When the process profile enables per-layer comments
 * (`gcode_comments: "1"` — see `resources/orca-slicer/profiles/process/
 * {standard,high_speed}.json`) some Orca/Prusa builds additionally emit:
 *
 *     ;LAYER_TIME:12.34         <- this layer's print time (seconds)
 *     ;LAYER_FILAMENT:543.2     <- this layer's filament (mm)
 *     ;TYPE:Outer wall          <- feature type for the moves that follow
 *
 * IMPORTANT (graceful degradation): the K2/Bambu Orca fork does NOT
 * guarantee `;LAYER_TIME:` / `;LAYER_FILAMENT:` even with gcode_comments=1
 * (open question Q1 in docs/plans/cad-v15-per-layer-slicer-breakdowns.md —
 * unconfirmed against a real slice as of 2026-06-02). This parser therefore
 * ALWAYS falls back to distributing the header totals uniformly across the
 * layer count when per-layer comments are absent. Result: never worse than
 * the legacy renderer-side `gcode-layer-parser.ts` uniform distribution.
 *
 * Header totals (top of file, same forms as the legacy parser):
 *     ; estimated printing time (normal mode) = 1h 23m 4s
 *     ; total filament used [mm] = 1234.5
 *
 * ── Attribution state machine ────────────────────────────────────────────
 *
 * `;BEFORE_LAYER_CHANGE` arms an "expecting Z" latch; the next bare-`;<z>`
 * comment opens a new layer. Per-layer comments (`;LAYER_TIME:` etc.) and
 * `;TYPE:` + motion lines are attributed to the most-recently-opened layer.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 *
 * Safety Rule 1 (G-code is sacred): READ-ONLY. Never writes, mutates, or
 * re-emits G-code. The IPC handler that calls this guards the path against
 * null-byte injection (mirrors the `slice:orca` handler).
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  EMPTY_FDM_LAYER_BREAKDOWN_RESULT,
  type FdmLayerBreakdown,
  type FdmLayerBreakdownResult,
  type FdmLineType,
  type FdmLineTypeCounts
} from '../../shared/fdm-gcode-layer-breakdown'

/**
 * Map a raw `;TYPE:<body>` body (case-insensitive, trimmed) to a canonical
 * {@link FdmLineType}. Unknown bodies bucket under `'Other'` so an
 * unfamiliar slicer build still produces a usable breakdown.
 *
 * OrcaSlicer / PrusaSlicer emit the long human names ("Outer wall",
 * "Internal infill", "Top solid infill", ...); we normalise the common
 * synonyms PrusaSlicer uses ("Perimeter" -> Inner wall, "External
 * perimeter" -> Outer wall, "Solid infill" -> Internal solid infill, etc.)
 * so both forks land on the same buckets.
 */
export function mapGcodeLineType(rawBody: string): FdmLineType {
  const t = rawBody.trim().toLowerCase()
  switch (t) {
    case 'outer wall':
    case 'external perimeter':
      return 'Outer wall'
    case 'inner wall':
    case 'perimeter':
    case 'overhang wall':
    case 'overhang perimeter':
      return 'Inner wall'
    case 'sparse infill':
    case 'internal infill':
    case 'infill':
      return 'Sparse infill'
    case 'internal solid infill':
    case 'solid infill':
      return 'Internal solid infill'
    case 'top surface':
    case 'top solid infill':
      return 'Top surface'
    case 'bottom surface':
      return 'Bottom surface'
    case 'bridge':
    case 'bridge infill':
    case 'internal bridge':
    case 'overhang':
      return 'Bridge'
    case 'support':
    case 'support material':
      return 'Support'
    case 'support interface':
    case 'support material interface':
      return 'Support interface'
    case 'skirt':
    case 'skirt/brim':
      return 'Skirt'
    case 'brim':
      return 'Brim'
    case 'custom':
      return 'Custom'
    default:
      return 'Other'
  }
}

/**
 * Parse a human-readable duration string ("1h 23m 4s" / "82m" / "300s" /
 * "1234" seconds) into total seconds. Returns null when unparseable.
 * Mirrors `gcode-layer-parser.parseDurationToSeconds` so both code paths
 * accept the same header forms.
 */
function parseDurationToSeconds(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase()
  if (!cleaned) return null
  if (/^[\d.]+$/.test(cleaned)) {
    const n = Number.parseFloat(cleaned)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  let total = 0
  let matched = false
  const unitRegex = /(\d+(?:\.\d+)?)\s*(h|m|s)/g
  let m: RegExpExecArray | null
  while ((m = unitRegex.exec(cleaned)) !== null) {
    const value = Number.parseFloat(m[1]!)
    if (!Number.isFinite(value)) continue
    const unit = m[2]!
    if (unit === 'h') total += value * 3600
    else if (unit === 'm') total += value * 60
    else if (unit === 's') total += value
    matched = true
  }
  return matched ? total : null
}

/**
 * Extract a numeric value from the right-hand side of a `key = value`
 * header comment (e.g. "; total filament used [mm] = 1234.5" -> 1234.5).
 */
function parseHeaderEqualsNumber(line: string): number | null {
  const eq = line.indexOf('=')
  if (eq < 0) return null
  const rhs = line.slice(eq + 1).trim()
  const m = rhs.match(/-?[\d.]+/)
  if (!m) return null
  const n = Number.parseFloat(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a bare layer-Z value from a comment line that follows a
 * `;BEFORE_LAYER_CHANGE` marker. Accepts "; 0.20", ";Z:0.20", ";Z=0.40".
 * Returns null when the line is not a recognisable bare Z.
 */
function parseLayerZComment(line: string): number | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(';')) return null
  const body = trimmed.slice(1).trim()
  if (!body) return null
  const zMatch = body.match(/^z\s*[:= ]\s*(-?[\d.]+)\s*(?:mm)?$/i)
  if (zMatch) {
    const v = Number.parseFloat(zMatch[1]!)
    return Number.isFinite(v) ? v : null
  }
  if (/^-?[\d.]+$/.test(body)) {
    const v = Number.parseFloat(body)
    return Number.isFinite(v) ? v : null
  }
  return null
}

/**
 * Extract the commanded feed-rate (mm/min) from a motion line's `F<value>`
 * word, or null when absent. `F` may appear anywhere on the line.
 */
function parseFeedRate(upperLine: string): number | null {
  const m = upperLine.match(/\bF(-?[\d.]+)/)
  if (!m) return null
  const v = Number.parseFloat(m[1]!)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Mutable accumulator for a single in-progress layer. */
interface LayerAccumulator {
  zMm: number
  /** Real per-layer time (s) from ;LAYER_TIME:, or null. */
  layerTimeSec: number | null
  /** Real per-layer filament (mm) from ;LAYER_FILAMENT:, or null. */
  layerFilamentMm: number | null
  /** Per-line-type motion-move counts (only when ;TYPE: seen). */
  lineTypeCounts: Map<FdmLineType, number> | null
  /** Peak F word (mm/min) seen on this layer, or null. */
  maxSpeedMmMin: number | null
}

function newLayerAccumulator(zMm: number): LayerAccumulator {
  return {
    zMm,
    layerTimeSec: null,
    layerFilamentMm: null,
    lineTypeCounts: null,
    maxSpeedMmMin: null
  }
}

/**
 * Streaming entry point. Parses the G-code at `gcodePath` into a
 * {@link FdmLayerBreakdownResult}.
 *
 * - Returns {@link EMPTY_FDM_LAYER_BREAKDOWN_RESULT} for an empty file or a
 *   file with no recognisable layer markers.
 * - Per-layer values are REAL when `;LAYER_TIME:` / `;LAYER_FILAMENT:` are
 *   present; otherwise the header totals are distributed UNIFORMLY across
 *   the layer count (graceful degradation — never worse than the legacy
 *   uniform parser). Mixed files are honoured per-layer: a layer that has a
 *   real value keeps it; layers without one are backfilled from the uniform
 *   share so the column is never half-empty.
 * - Rejects (rethrows) the underlying `fs` error (ENOENT, EACCES, ...) and
 *   throws on a null-byte path so the caller can fold it into a clean IPC
 *   envelope. The caller (IPC handler) is responsible for the null-byte
 *   guard too; this is defense-in-depth.
 */
export async function parseFdmGcodeLayersFromFile(
  gcodePath: string
): Promise<FdmLayerBreakdownResult> {
  if (typeof gcodePath !== 'string' || gcodePath.length === 0) {
    throw new Error('parseFdmGcodeLayersFromFile: gcodePath must be a non-empty string')
  }
  // Defense-in-depth null-byte rejection — mirrors the `slice:orca` handler.
  if (gcodePath.includes('\0')) {
    throw new Error('parseFdmGcodeLayersFromFile: gcodePath contains a null byte')
  }

  const layers: LayerAccumulator[] = []
  let current: LayerAccumulator | null = null
  let expectingZ = false
  let activeLineType: FdmLineType | null = null

  let totalTimeSec: number | null = null
  let totalFilamentMm: number | null = null

  // createReadStream + readline gives constant-memory line iteration.
  // crlfDelay: Infinity makes readline treat \r\n as a single break (CRLF
  // tolerance) and strip the trailing \r so downstream regexes see bare LF.
  const stream = createReadStream(gcodePath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const rawLine of rl) {
      // readline already stripped the line terminator; trim leftover space.
      const line = rawLine.trim()
      if (line.length === 0) continue

      if (line.startsWith(';')) {
        const upper = line.toUpperCase()

        // ── Header totals (only set once, first match wins) ──────────────
        if (totalTimeSec == null && upper.includes('ESTIMATED PRINTING TIME')) {
          const eq = line.indexOf('=')
          if (eq >= 0) totalTimeSec = parseDurationToSeconds(line.slice(eq + 1))
          continue
        }
        if (totalFilamentMm == null && upper.includes('FILAMENT USED [MM]')) {
          totalFilamentMm = parseHeaderEqualsNumber(line)
          continue
        }

        // ── Per-layer time / filament comments ───────────────────────────
        if (upper.startsWith(';LAYER_TIME:')) {
          if (current) {
            const v = Number.parseFloat(line.slice(';LAYER_TIME:'.length).trim())
            if (Number.isFinite(v) && v >= 0) current.layerTimeSec = v
          }
          continue
        }
        if (upper.startsWith(';LAYER_FILAMENT:')) {
          if (current) {
            const v = Number.parseFloat(line.slice(';LAYER_FILAMENT:'.length).trim())
            if (Number.isFinite(v) && v >= 0) current.layerFilamentMm = v
          }
          continue
        }

        // ── Line-type marker ─────────────────────────────────────────────
        if (upper.startsWith(';TYPE:')) {
          activeLineType = mapGcodeLineType(line.slice(';TYPE:'.length))
          continue
        }

        // ── New-layer trigger ────────────────────────────────────────────
        if (upper.startsWith(';BEFORE_LAYER_CHANGE')) {
          expectingZ = true
          continue
        }

        // The bare-Z line right after ;BEFORE_LAYER_CHANGE opens the layer.
        if (expectingZ) {
          const z = parseLayerZComment(line)
          expectingZ = false
          if (z != null && z >= 0) {
            current = newLayerAccumulator(z)
            layers.push(current)
            // A new layer resets the active feature type; the slicer re-emits
            // ;TYPE: at the start of each layer's first feature.
            activeLineType = null
          }
          continue
        }

        // Any other comment — ignore.
        continue
      }

      // ── Non-comment (motion / command) line ──────────────────────────────
      // Clear the expecting-Z latch so a stray numeric comment later cannot
      // be mis-attributed as a layer Z.
      expectingZ = false
      if (!current) continue

      const upper = line.toUpperCase()
      const isMotion = upper.startsWith('G0 ') || upper.startsWith('G1 ') || upper === 'G0' || upper === 'G1'
      if (!isMotion) continue

      // Peak feed-rate (mm/min) for this layer.
      const f = parseFeedRate(upper)
      if (f != null) {
        current.maxSpeedMmMin =
          current.maxSpeedMmMin == null ? f : Math.max(current.maxSpeedMmMin, f)
      }

      // Line-type move count: only when the slice emitted ;TYPE: markers.
      if (activeLineType != null) {
        if (current.lineTypeCounts == null) current.lineTypeCounts = new Map()
        current.lineTypeCounts.set(
          activeLineType,
          (current.lineTypeCounts.get(activeLineType) ?? 0) + 1
        )
      }
    }
  } finally {
    rl.close()
    stream.close()
  }

  if (layers.length === 0) return EMPTY_FDM_LAYER_BREAKDOWN_RESULT

  return finalizeLayers(layers, totalTimeSec, totalFilamentMm)
}

/**
 * Turn the mutable accumulators into the immutable result, applying the
 * uniform-distribution fallback for any layer that lacks a real per-layer
 * value. Internal — the public entry point is
 * {@link parseFdmGcodeLayersFromFile}; the fallback is exercised end-to-end
 * via synthetic G-code fixtures in the test.
 *
 * Fallback rule (per field, independent):
 *   - If at least one layer reported a real value, layers WITHOUT one are
 *     backfilled from `header_total / layerCount` (so the column is never
 *     half-blank). Layers WITH a real value keep it.
 *   - If NO layer reported a real value, every layer gets the uniform share
 *     `header_total / layerCount` (legacy behavior) — or null when the
 *     header total itself is absent.
 */
function finalizeLayers(
  accumulators: readonly LayerAccumulator[],
  totalTimeSec: number | null,
  totalFilamentMm: number | null
): FdmLayerBreakdownResult {
  const layerCount = accumulators.length
  if (layerCount === 0) return EMPTY_FDM_LAYER_BREAKDOWN_RESULT

  const uniformTime =
    totalTimeSec != null && layerCount > 0 ? totalTimeSec / layerCount : null
  const uniformFilament =
    totalFilamentMm != null && layerCount > 0 ? totalFilamentMm / layerCount : null

  const layers: FdmLayerBreakdown[] = accumulators.map((acc, i) => {
    const lineTypeCounts: FdmLineTypeCounts | null =
      acc.lineTypeCounts && acc.lineTypeCounts.size > 0
        ? Object.fromEntries(acc.lineTypeCounts)
        : null
    return {
      index: i + 1,
      zMm: acc.zMm,
      estTimeSec: acc.layerTimeSec != null ? acc.layerTimeSec : uniformTime,
      estFilamentMm: acc.layerFilamentMm != null ? acc.layerFilamentMm : uniformFilament,
      lineTypeCounts,
      maxSpeedMmMin: acc.maxSpeedMmMin
    }
  })

  return {
    layers,
    totalTimeSec,
    totalFilamentMm,
    layerCount
  }
}
