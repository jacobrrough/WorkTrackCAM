/**
 * gcode-toolpath-stats.ts — pure helper for the CNC "Simulate" stage body.
 *
 * Parses CNC G-code emitted by the Handlebars post-processors in
 * `resources/posts/` (RichAuto A-series for Laguna Swift 5x10; Makera
 * Controller for Carvera 3-axis + 4-axis — CLAUDE.md USER CONTEXT)
 * into a high-level statistics readout for the workflow Simulate
 * stage:
 *
 *   - Rapid count (G0)
 *   - Cut count (G1)
 *   - Arc count (G2 + G3)
 *   - Total rapid distance (mm)
 *   - Total cut distance (mm, including arc chord-length fallback)
 *   - Tool changes (M6)
 *   - Spindle starts (M3 / M4)
 *
 * ── Scope ────────────────────────────────────────────────────────────
 *
 * Pure module:
 *   - No `window.fab` access
 *   - No DOM access
 *   - Input is a string of G-code
 *   - Output is an immutable `ToolpathStats` value
 *
 * ── Safety ───────────────────────────────────────────────────────────
 *
 * CLAUDE.md Safety Rule 1: this module DOES NOT mutate, emit, or
 * re-serialize G-code. It produces a read-only summary. The G-code
 * itself never round-trips through this parser. This guarantees we
 * cannot accidentally introduce a post-processor regression by adding
 * a new statistic.
 *
 * ── Motion-line classification ───────────────────────────────────────
 *
 * The parser recognises the standard G-code motion words:
 *   - `G0`  / `G00` -> rapid
 *   - `G1`  / `G01` -> linear feed (cut)
 *   - `G2`  / `G02` -> CW arc (cut, chord-length distance)
 *   - `G3`  / `G03` -> CCW arc (cut, chord-length distance)
 *
 * Modal motion is supported: a bare `X.. Y..` line after a `G1` is
 * treated as another G1 move. The modal state resets on `G0` / `G1` /
 * `G2` / `G3`. Tool-change and spindle commands do NOT reset it.
 *
 * Arc move distance uses the chord length between the start and end
 * point, not the true arc length. This is a deliberate simplification
 * — the Simulate stage statistics are meant to give the operator an
 * order-of-magnitude "is this a 5-minute job or a 5-hour job?" signal,
 * not a precise cycle-time estimate (use the Setup Sheet for that).
 * Chord-length is exact for short arcs and conservative (underestimate)
 * for long ones.
 */

/**
 * Aggregate statistics for a CNC G-code program. All counts and
 * distances are zero when the parser finds no recognisable motion.
 */
export interface ToolpathStats {
  /** Total raw lines (including blanks + comments). */
  readonly totalLines: number
  /** Lines containing recognised motion (G0/G1/G2/G3 or modal continuation). */
  readonly motionLines: number
  /** Count of explicit rapid moves (G0). */
  readonly rapidCount: number
  /** Count of explicit linear-feed (cut) moves (G1). */
  readonly cutCount: number
  /** Count of arc moves (G2 + G3). */
  readonly arcCount: number
  /** Total distance traversed in rapid mode (mm). */
  readonly rapidDistanceMm: number
  /** Total distance traversed under feed (G1 + G2 + G3, chord-length for arcs) in mm. */
  readonly cutDistanceMm: number
  /** Count of M6 tool-change commands. */
  readonly toolChangeCount: number
  /** Count of M3 / M4 spindle-start commands. */
  readonly spindleStartCount: number
}

const EMPTY_STATS: ToolpathStats = {
  totalLines: 0,
  motionLines: 0,
  rapidCount: 0,
  cutCount: 0,
  arcCount: 0,
  rapidDistanceMm: 0,
  cutDistanceMm: 0,
  toolChangeCount: 0,
  spindleStartCount: 0
}

/**
 * Strip a trailing inline G-code comment from a line. Recognises both
 * the standard ";comment" form and the parenthesised "(comment)" form
 * used by some controllers. Returns the trimmed payload (without the
 * comment) — the input string is never mutated.
 */
function stripComment(line: string): string {
  let s = line
  const semi = s.indexOf(';')
  if (semi >= 0) s = s.slice(0, semi)
  // Strip balanced parentheses comments — only the outermost.
  const open = s.indexOf('(')
  if (open >= 0) {
    const close = s.indexOf(')', open + 1)
    if (close > open) {
      s = s.slice(0, open) + s.slice(close + 1)
    } else {
      s = s.slice(0, open)
    }
  }
  return s.trim()
}

/**
 * Parse a numeric value following a single-letter word (X, Y, Z, I,
 * J, F, etc.) in a G-code line. Returns null when the word is absent
 * or the value is not a finite number.
 */
function readWord(line: string, letter: string): number | null {
  // Letter must be at start-of-line OR preceded by whitespace to avoid
  // matching mid-token (e.g. don't match `M5` when looking for `X`).
  const re = new RegExp(`(?:^|\\s)${letter}(-?[\\d.]+)`, 'i')
  const m = line.match(re)
  if (!m) return null
  const v = Number.parseFloat(m[1]!)
  return Number.isFinite(v) ? v : null
}

/**
 * Detect which motion mode (if any) this line declares. Returns:
 *   - 0 for G0
 *   - 1 for G1
 *   - 2 for G2
 *   - 3 for G3
 *   - null when the line declares no new motion mode.
 *
 * A single line may contain multiple G-words (`G90 G1 X5`); the motion
 * word wins regardless of order, and any non-motion G-word is ignored.
 */
function detectMotionMode(line: string): 0 | 1 | 2 | 3 | null {
  // Match G followed by 1-2 digits at word boundary.
  const re = /(?:^|\s)G(\d{1,2})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const n = Number.parseInt(m[1]!, 10)
    if (n === 0) return 0
    if (n === 1) return 1
    if (n === 2) return 2
    if (n === 3) return 3
  }
  return null
}

/**
 * Detect an M-code (tool change, spindle, etc.) on a line. Returns the
 * integer M-number or null when no M-word is present.
 *
 * Lines may contain multiple M-codes (e.g. `M5 M9` on shutdown); the
 * first one wins. For the high-level stage stats this is sufficient
 * — both M5 and M9 are non-counted commands.
 */
function detectMCode(line: string): number | null {
  const re = /(?:^|\s)M(\d{1,3})\b/i
  const m = line.match(re)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse CNC G-code text into a `ToolpathStats` aggregate.
 *
 * Empty or whitespace-only input returns `EMPTY_STATS`. Inputs with no
 * recognised motion (e.g. a comment-only file) return a stats object
 * with `totalLines > 0` but all motion counts at 0.
 *
 * Time complexity is O(N) in lines.
 */
export function parseToolpathStats(text: string): ToolpathStats {
  if (!text) return EMPTY_STATS

  const lines = text.split(/\r?\n/)
  let totalLines = 0
  let motionLines = 0
  let rapidCount = 0
  let cutCount = 0
  let arcCount = 0
  let rapidDistanceMm = 0
  let cutDistanceMm = 0
  let toolChangeCount = 0
  let spindleStartCount = 0

  // Modal motion state. Starts as null so a pre-G0/G1 X/Y line at the
  // top of the file doesn't get mis-counted before any motion has been
  // explicitly declared. CNC controllers default to G0 at power-on, but
  // post-processors should always emit a leading G0 anyway; we follow
  // the conservative interpretation.
  let modalMode: 0 | 1 | 2 | 3 | null = null

  // Current XYZ position. Defaults to (0,0,0) — this is the standard
  // assumption when the program starts at the WCS origin.
  let cx = 0
  let cy = 0
  let cz = 0

  for (let i = 0; i < lines.length; i++) {
    totalLines++
    const raw = lines[i]!
    const stripped = stripComment(raw)
    if (!stripped) continue

    // Count M-codes that the operator wants visible. Use the trimmed
    // (no-comment) form so a comment "M6 follow-up" doesn't trip the
    // detector.
    const mcode = detectMCode(stripped)
    if (mcode === 6) toolChangeCount++
    if (mcode === 3 || mcode === 4) spindleStartCount++

    // Motion classification. A new G-word updates the modal state; a
    // bare X/Y/Z line inherits the previous modal motion.
    const explicit = detectMotionMode(stripped)
    let effectiveMode: 0 | 1 | 2 | 3 | null = explicit
    if (effectiveMode == null) {
      // Bare-coordinate continuation. Only counts when at least one
      // X / Y / Z word is present AND we have an established modal
      // mode.
      const hasCoord =
        readWord(stripped, 'X') != null ||
        readWord(stripped, 'Y') != null ||
        readWord(stripped, 'Z') != null
      if (hasCoord && modalMode != null) effectiveMode = modalMode
    } else {
      modalMode = effectiveMode
    }

    if (effectiveMode == null) continue

    motionLines++
    const nx = readWord(stripped, 'X')
    const ny = readWord(stripped, 'Y')
    const nz = readWord(stripped, 'Z')
    const tx = nx ?? cx
    const ty = ny ?? cy
    const tz = nz ?? cz
    const dx = tx - cx
    const dy = ty - cy
    const dz = tz - cz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (effectiveMode === 0) {
      rapidCount++
      rapidDistanceMm += dist
    } else if (effectiveMode === 1) {
      cutCount++
      cutDistanceMm += dist
    } else {
      // Arc move (G2 / G3). Chord-length is a conservative
      // approximation — see the file-level doc comment.
      arcCount++
      cutDistanceMm += dist
    }

    cx = tx
    cy = ty
    cz = tz
  }

  return {
    totalLines,
    motionLines,
    rapidCount,
    cutCount,
    arcCount,
    rapidDistanceMm,
    cutDistanceMm,
    toolChangeCount,
    spindleStartCount
  }
}

/**
 * Format a distance (mm) for the Simulate stage readout. Sub-metre
 * values keep "mm"; longer values fall through to metres for
 * readability. Returns "—" for null / negative / NaN.
 */
export function formatDistanceMm(mm: number | null | undefined): string {
  if (mm == null || !Number.isFinite(mm) || mm < 0) return '—'
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  return `${mm.toFixed(1)} mm`
}
