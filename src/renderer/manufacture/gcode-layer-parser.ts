/**
 * gcode-layer-parser.ts — pure helper for the FDM "Preview" stage body.
 *
 * Parses G-code produced by **OrcaSlicer** for the Creality K2 Plus (the
 * only FDM machine in the My-Shop scope — CLAUDE.md USER CONTEXT). The
 * Preview stage in `ManufactureWorkspace.LayerPreviewBody` uses this to
 * surface a vertical layer scrubber + per-layer summary readouts (layer
 * number, Z height, estimated layer time, estimated layer filament).
 *
 * ── Scope ────────────────────────────────────────────────────────────
 *
 * This module is pure and side-effect free:
 *   - No `window.fab` access.
 *   - No DOM access.
 *   - Inputs are strings (G-code text + optional total-job estimates from
 *     the slicer's `;TIME:` / `;Filament used:` headers).
 *   - Outputs are immutable, sorted arrays of `LayerInfo`.
 *
 * ── Layer-marker dialects ────────────────────────────────────────────
 *
 * OrcaSlicer 2.x emits two recognisable layer markers per layer:
 *
 *     ;BEFORE_LAYER_CHANGE
 *     ;0.20
 *     ;AFTER_LAYER_CHANGE
 *     ;0.20
 *
 * The numeric line is the **layer Z height (mm)** as emitted by the
 * `;[layer_z]` placeholder in `before_layer_change_gcode` (see
 * `resources/orca-slicer/profiles/machines/creality-k2-plus.json`).
 *
 * Older OrcaSlicer + PrusaSlicer also emit a `;LAYER_CHANGE` marker plus
 * a `;Z:0.20` shorthand. Some installs emit the legacy Slic3r
 * `; layer 1, Z = 0.20` form. All three are tolerated here so a slice
 * produced on a different K2 firmware/profile still surfaces a usable
 * layer index.
 *
 * Layer numbers are **NOT** trusted from the slicer (some dialects emit
 * `;LAYER:0` indexed from zero, others from one, some omit it entirely).
 * Instead, layers are numbered 1..N in the order they appear in the
 * G-code, after sorting by Z. That gives the operator a stable contract
 * regardless of slicer version.
 *
 * ── Total-job estimates ──────────────────────────────────────────────
 *
 * Slicers usually emit total-job time + filament-length headers near the
 * top of the file ("; estimated printing time (normal mode) = 1h 23m"
 * and "; total filament used [g] = 14.5"). `parseTotalEstimates` reads
 * those once per file. The per-layer breakdown then distributes total
 * time/filament uniformly across the layer count as a coarse fallback
 * — the MVP does not need exact per-layer numbers, just operator-
 * useful magnitudes ("layer 17 of 80, ~30 s of 40 min").
 */

/**
 * Single layer parsed from G-code.
 */
export interface LayerInfo {
  /** 1-based layer index after sorting by Z. */
  readonly index: number
  /** Z height in millimetres. */
  readonly zMm: number
  /** Rough estimated layer time (seconds). Null when total time unknown. */
  readonly estTimeSec: number | null
  /** Rough estimated layer filament (mm). Null when total filament unknown. */
  readonly estFilamentMm: number | null
}

/**
 * Aggregate total-job estimates parsed from the OrcaSlicer header.
 *
 * OrcaSlicer emits several header lines describing the total job; we
 * accept whichever forms we recognise and ignore the rest.
 */
export interface TotalEstimates {
  /** Total estimated time (seconds), or null when not present. */
  readonly totalTimeSec: number | null
  /** Total filament used (mm), or null when not present. */
  readonly totalFilamentMm: number | null
  /** Total filament used (g), or null when not present. */
  readonly totalFilamentG: number | null
}

const EMPTY_TOTALS: TotalEstimates = {
  totalTimeSec: null,
  totalFilamentMm: null,
  totalFilamentG: null
}

/**
 * Parse a human-readable duration string ("1h 23m 4s" / "82m" / "300s")
 * into total seconds. Returns null when the input is empty or
 * unparseable. The slicer is tolerant about spacing ("1h23m") and unit
 * casing ("1H 23M") so we are too.
 *
 * Exported only for the unit tests; consumers should use the
 * `parseLayers` / `parseTotalEstimates` entry points.
 */
export function parseDurationToSeconds(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase()
  if (!cleaned) return null

  // Pure numeric string -> seconds.
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
 * Extract a numeric value from the right-hand side of an OrcaSlicer
 * header comment (e.g. "; total filament used [mm] = 1234.5" returns
 * 1234.5). Returns null when no numeric value can be parsed.
 */
function parseHeaderNumber(line: string): number | null {
  const eq = line.indexOf('=')
  if (eq < 0) return null
  const rhs = line.slice(eq + 1).trim()
  const m = rhs.match(/-?[\d.]+/)
  if (!m) return null
  const n = Number.parseFloat(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Parse OrcaSlicer (and PrusaSlicer / SuperSlicer) total-job estimates
 * from the comment headers. Accepts every header form documented in
 * `creality-k2-plus.json`'s `printer_notes`. Unrecognised inputs
 * produce nulls — never throws.
 */
export function parseTotalEstimates(text: string): TotalEstimates {
  if (!text) return EMPTY_TOTALS
  let totalTimeSec: number | null = null
  let totalFilamentMm: number | null = null
  let totalFilamentG: number | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith(';')) continue
    const lower = line.toLowerCase()

    // OrcaSlicer / PrusaSlicer total-time forms.
    //   "; estimated printing time (normal mode) = 1h 23m 4s"
    //   "; estimated printing time = 1h 23m 4s"
    //   ";TIME:1234"      (Cura-style, seconds)
    if (totalTimeSec == null) {
      if (lower.includes('estimated printing time')) {
        const eq = line.indexOf('=')
        if (eq >= 0) {
          totalTimeSec = parseDurationToSeconds(line.slice(eq + 1))
        }
      } else if (lower.startsWith(';time:')) {
        const v = Number.parseFloat(line.slice(';time:'.length).trim())
        if (Number.isFinite(v) && v >= 0) totalTimeSec = v
      } else if (lower.startsWith('; total estimated time:')) {
        totalTimeSec = parseDurationToSeconds(line.slice(line.indexOf(':') + 1))
      }
    }

    // Filament-mm forms.
    //   "; total filament used [mm] = 1234.5"
    //   "; filament used [mm] = 1234.5"
    //   ";Filament used: 1.234m"   (Cura)
    if (totalFilamentMm == null) {
      if (lower.includes('filament used [mm]')) {
        totalFilamentMm = parseHeaderNumber(line)
      } else if (lower.startsWith(';filament used:')) {
        const rhs = line.slice(line.indexOf(':') + 1).trim().toLowerCase()
        const m = rhs.match(/-?[\d.]+/)
        if (m) {
          const v = Number.parseFloat(m[0])
          if (Number.isFinite(v)) {
            totalFilamentMm = rhs.includes('m') && !rhs.includes('mm') ? v * 1000 : v
          }
        }
      }
    }

    // Filament-grams forms.
    //   "; total filament used [g] = 14.5"
    //   "; filament used [g] = 14.5"
    if (totalFilamentG == null && lower.includes('filament used [g]')) {
      totalFilamentG = parseHeaderNumber(line)
    }
  }

  return { totalTimeSec, totalFilamentMm, totalFilamentG }
}

/**
 * Parse a single layer-Z value from a comment line that follows a
 * `;BEFORE_LAYER_CHANGE` / `;AFTER_LAYER_CHANGE` marker. Returns null
 * when the line is not a bare numeric Z.
 *
 * Examples that match:
 *     ";0.20"
 *     "; 0.40"
 *     ";Z:0.60"
 *     ";Z=0.80"
 */
function parseLayerZComment(line: string): number | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(';')) return null
  const body = trimmed.slice(1).trim()
  if (!body) return null

  // "Z:0.20" / "Z=0.20" / "Z 0.20"
  const zMatch = body.match(/^z\s*[:= ]\s*(-?[\d.]+)\s*(?:mm)?$/i)
  if (zMatch) {
    const v = Number.parseFloat(zMatch[1]!)
    return Number.isFinite(v) ? v : null
  }

  // Bare number "0.20" / "1.40"
  if (/^-?[\d.]+$/.test(body)) {
    const v = Number.parseFloat(body)
    return Number.isFinite(v) ? v : null
  }

  return null
}

/**
 * Parse a Slic3r-style legacy "; layer 1, Z = 0.20" comment into its
 * Z value. Returns null when the line does not match.
 */
function parseLegacyLayerComment(line: string): number | null {
  const m = line.match(/^\s*;\s*layer\s+\d+[^z]*z\s*[:= ]\s*(-?[\d.]+)/i)
  if (!m) return null
  const v = Number.parseFloat(m[1]!)
  return Number.isFinite(v) ? v : null
}

/**
 * Parse layer info from OrcaSlicer / PrusaSlicer / Slic3r G-code text.
 *
 * Returns a stable, sorted array of `LayerInfo` (one per unique layer
 * Z), with 1-based indices. When `text` contains no recognisable layer
 * markers (e.g. CNC G-code by mistake, or pre-slice empty input), the
 * returned array is empty.
 *
 * - Duplicate Zs are deduplicated; the first occurrence wins. This
 *   matters when a slicer emits both `;BEFORE_LAYER_CHANGE` and
 *   `;AFTER_LAYER_CHANGE` (or `;LAYER_CHANGE` plus the bare Z).
 * - Negative Z is silently dropped — OrcaSlicer should never emit one
 *   for FDM, so it's almost certainly a stray comment.
 * - When total-time / total-filament estimates can be parsed from the
 *   header, per-layer values are uniformly distributed. Otherwise both
 *   fields are null on every layer.
 *
 * Time complexity is O(N) in the number of G-code lines; memory is
 * bounded by the layer count.
 */
export function parseLayers(text: string): readonly LayerInfo[] {
  if (!text) return []

  const lines = text.split(/\r?\n/)
  const seenZs = new Set<number>()
  const zsInOrder: number[] = []

  // State machine: when we see a `;BEFORE_LAYER_CHANGE` /
  // `;AFTER_LAYER_CHANGE` / `;LAYER_CHANGE` marker, the *next*
  // comment line that parses as a bare Z is the layer height. The
  // legacy Slic3r form is matched inline (single comment carries both
  // the layer number AND the Z value).
  let expectingZ = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Legacy single-line form takes priority.
    const legacyZ = parseLegacyLayerComment(trimmed)
    if (legacyZ != null) {
      if (legacyZ >= 0 && !seenZs.has(legacyZ)) {
        seenZs.add(legacyZ)
        zsInOrder.push(legacyZ)
      }
      expectingZ = false
      continue
    }

    if (!trimmed.startsWith(';')) {
      // Non-comment line — clear the "expecting Z" latch so a stray
      // numeric comment further down doesn't get mis-attributed.
      expectingZ = false
      continue
    }

    const upper = trimmed.toUpperCase()
    if (
      upper.startsWith(';BEFORE_LAYER_CHANGE') ||
      upper.startsWith(';AFTER_LAYER_CHANGE') ||
      upper.startsWith(';LAYER_CHANGE') ||
      upper.startsWith(';LAYER:')
    ) {
      expectingZ = true
      continue
    }

    if (expectingZ) {
      const z = parseLayerZComment(trimmed)
      if (z != null && z >= 0 && !seenZs.has(z)) {
        seenZs.add(z)
        zsInOrder.push(z)
      }
      // Whether we consumed a Z or not, the marker is satisfied — the
      // next layer needs its own ;LAYER_CHANGE/;BEFORE_LAYER_CHANGE.
      expectingZ = false
    }
  }

  if (zsInOrder.length === 0) return []

  // Sort by Z so the slider scrubs bottom-up regardless of how the
  // slicer emitted the markers.
  const sortedZs = [...zsInOrder].sort((a, b) => a - b)

  const totals = parseTotalEstimates(text)
  const layerCount = sortedZs.length
  const perLayerTimeSec =
    totals.totalTimeSec != null && layerCount > 0 ? totals.totalTimeSec / layerCount : null
  const perLayerFilamentMm =
    totals.totalFilamentMm != null && layerCount > 0 ? totals.totalFilamentMm / layerCount : null

  return sortedZs.map((z, i) => ({
    index: i + 1,
    zMm: z,
    estTimeSec: perLayerTimeSec,
    estFilamentMm: perLayerFilamentMm
  }))
}

/**
 * Format a seconds value as "Hh Mm Ss" / "Mm Ss" / "Ss" for the
 * per-layer readout. Returns "—" when the input is null / negative /
 * NaN. Exported for the LayerPreviewBody renderer + its unit tests.
 */
export function formatDurationShort(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—'
  if (sec === 0) return '0s'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Format a filament length (mm) as "X.XX m" or "X mm". Returns "—" when
 * the input is null. The Preview stage shows per-layer filament in mm
 * because typical K2 Plus layers consume 50–500 mm — sub-metre.
 */
export function formatFilamentMm(mm: number | null): string {
  if (mm == null || !Number.isFinite(mm) || mm < 0) return '—'
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  return `${mm.toFixed(1)} mm`
}
