import Handlebars from 'handlebars'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fitArcsToLinearPath } from '../shared/arc-fitting'
import type { GCodeSegment, Point3D } from '../shared/arc-fitting'
import type { MachineProfile } from '../shared/machine-schema'
import { validateDialectCompliance } from '../shared/gcode-dialect-compliance'
import { resolveDialectSnippets, resolveWorkOffsetLine } from './post-process-dialects'

/** Configuration for G-code line numbering (N-words). */
export type LineNumberingConfig = {
  enabled: boolean
  /** Starting line number (e.g. 10). */
  start: number
  /** Increment between line numbers (e.g. 10 for N10, N20, N30...). */
  increment: number
}

/**
 * Subroutine dialect describes how subroutines are called and defined
 * on a given controller.
 */
export type SubroutineDialect = 'fanuc' | 'siemens' | 'mach3'

export type PostContext = {
  machine: MachineProfile
  /** One G-code block per line, no header/footer */
  toolpathLines: string[]
  spindleOn: string
  spindleOff: string
  units: 'G21' | 'G20'
  /** e.g. G54…G59 when workCoordinateIndex 1–6 was supplied to the post. */
  wcsLine?: string
  /** Optional human-readable operation label injected as a comment near the top of the file. */
  operationLabel?: string
  /** Warning message when spindle RPM was clamped to machine limits. */
  spindleWarning?: string
  /** ATC tool number (1–6) for M6 T<n> and G43 H<n> commands in templates. */
  toolNumber?: number
  /**
   * Height offset register for G43 H<n>.
   * When set, templates can emit `G43 H{{toolWearOffsetH}}` for wear-adjusted
   * tool length compensation instead of using the tool slot number.
   */
  toolWearOffsetH?: number
  /**
   * Diameter offset register for G41/G42 D<n>.
   * When set, templates can emit `G41 D{{toolWearOffsetD}}` for wear-adjusted
   * cutter compensation.
   */
  toolWearOffsetD?: number
  /**
   * When true, G93 inverse-time feed mode is active.
   * Templates should emit G93 before toolpath and G94 after (to restore normal feed mode).
   * In G93 mode, the F-word specifies 1/time (inverse minutes) rather than units/minute.
   * Typically used for continuous 4-axis/5-axis operations where the rotary axis is moving.
   */
  inverseTimeFeed?: boolean
  /**
   * When true, detect repeated patterns in toolpath lines and wrap them
   * in subroutines. Requires `subroutineDialect` to determine call syntax.
   */
  enableSubroutines?: boolean
  /** Controller dialect for subroutine syntax. Required when enableSubroutines is true. */
  subroutineDialect?: SubroutineDialect
  /**
   * Optional line numbering configuration.
   * When enabled, N-words are prepended to every non-blank, non-comment line
   * in the final G-code output.
   */
  lineNumbering?: LineNumberingConfig
  /**
   * When true, run arc fitting on the toolpath lines to convert sequences of
   * G1 moves into G2/G3 circular arcs where possible. Reduces file size and
   * improves surface finish on controllers with arc look-ahead.
   */
  enableArcFitting?: boolean
  /**
   * Maximum deviation (mm) from a fitted circle for a point to be included
   * in an arc segment. Default: 0.005 mm. Only used when enableArcFitting is true.
   */
  arcTolerance?: number
  /**
   * Cutter compensation mode. When 'left' or 'right', G41/G42 is emitted
   * before contour moves and G40 (cancel) is emitted after.
   *   'none'  — no cutter compensation (default)
   *   'left'  — G41 (tool left of programmed path, climb milling)
   *   'right' — G42 (tool right of programmed path, conventional milling)
   */
  cutterCompensation?: 'none' | 'left' | 'right'
  /**
   * D-register number for cutter compensation (G41 D<n> / G42 D<n>).
   * When omitted, the D-word is not emitted (controller uses active tool's
   * stored diameter). Typical range: 1–99.
   */
  cutterCompDRegister?: number
}

/**
 * Clamp a spindle RPM to the machine's min/max limits.
 * Returns the (possibly clamped) RPM and an optional warning string
 * describing any adjustment that was made.
 */
export function clampSpindleRpm(
  rpm: number,
  machine: MachineProfile
): { rpm: number; warning?: string } {
  if (machine.maxSpindleRpm != null && rpm > machine.maxSpindleRpm) {
    return {
      rpm: machine.maxSpindleRpm,
      warning: `Spindle RPM ${rpm} exceeds machine maximum ${machine.maxSpindleRpm}; clamped to ${machine.maxSpindleRpm}`
    }
  }
  if (machine.minSpindleRpm != null && rpm < machine.minSpindleRpm) {
    return {
      rpm: machine.minSpindleRpm,
      warning: `Spindle RPM ${rpm} is below machine minimum ${machine.minSpindleRpm}; clamped to ${machine.minSpindleRpm}`
    }
  }
  return { rpm }
}

/**
 * Apply a custom spindle RPM to the dialect's default `on` string.
 * - If the string contains an S-word (e.g. `M3 S12000`), replace its value.
 * - If no S-word is present (e.g. Mach3's bare `M3`), append it.
 */
function applySpindleRpm(onString: string, rpm: number): string {
  const sWordPattern = /S\d+/
  if (sWordPattern.test(onString)) {
    return onString.replace(sWordPattern, `S${rpm}`)
  }
  return `${onString} S${rpm}`
}

export type RenderPostResult = { gcode: string; warnings: string[] }

/**
 * A single operation's posted G-code along with its tool slot.
 * Used by `sequenceMultiToolJob` to merge multiple operations
 * with automatic M6 tool change insertions between them.
 */
export type ToolOperationBlock = {
  /** ATC tool slot number (1–6). */
  toolSlot: number
  /** Already-posted G-code for this operation (complete with header/footer). */
  gcode: string
  /** Optional human-readable label for the operation. */
  label?: string
}

/**
 * Merge multiple posted G-code operations into a single program with
 * M6 tool change commands inserted between operations when the tool slot changes.
 *
 * Each operation block's G-code is emitted as-is (it already has its own
 * safety header/footer from `renderPost`). Between operations with different
 * tool slots, this function inserts:
 *   1. Spindle stop (M5)
 *   2. Safe Z retract (G0 Z<max>)
 *   3. Tool change (M6 T<n>)
 *   4. A comment indicating the new operation
 *
 * When consecutive operations use the same tool slot, no tool change is inserted.
 *
 * @param blocks  Ordered array of tool operation blocks.
 * @param safeZMm  Safe Z retract height for tool changes.
 * @param commentPrefix  Comment prefix for the machine dialect (default "; ").
 */
export function sequenceMultiToolJob(
  blocks: ToolOperationBlock[],
  safeZMm: number,
  commentPrefix = '; ',
  opts?: { supportsToolChange?: boolean }
): string {
  if (blocks.length === 0) return ''
  if (blocks.length === 1) return blocks[0]!.gcode

  const parts: string[] = []
  let lastToolSlot: number | undefined
  const supportsToolChange = opts?.supportsToolChange !== false

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (i > 0 && block.toolSlot !== lastToolSlot) {
      // Insert tool change sequence between operations
      parts.push('')
      parts.push(`${commentPrefix}--- TOOL CHANGE: T${block.toolSlot}${block.label ? ` — ${block.label}` : ''} ---`)
      parts.push('M5')
      parts.push(`G0 Z${safeZMm}`)
      if (supportsToolChange) {
        parts.push(`T${block.toolSlot} M6`)
      } else {
        parts.push(`${commentPrefix}Manual tool change required: load T${block.toolSlot} before continuing`)
      }
      parts.push('')
    } else if (i > 0) {
      // Same tool, just add a separator comment
      parts.push('')
      parts.push(`${commentPrefix}--- NEXT OPERATION${block.label ? `: ${block.label}` : ''} (same tool T${block.toolSlot}) ---`)
      parts.push('')
    }
    parts.push(block.gcode)
    lastToolSlot = block.toolSlot
  }

  return parts.join('\n')
}

/**
 * Default arc fitting tolerance in mm.
 * Typical CNC machines can handle 0.005 mm deviation without visible artifacts.
 */
const DEFAULT_ARC_TOLERANCE_MM = 0.005

/**
 * Parse a G1 toolpath line into a 3D point (X, Y, Z).
 * Returns null if the line is not a G1 move or doesn't have coordinates.
 */
function parseG1Point(line: string): Point3D | null {
  const trimmed = line.trim()
  if (!/^G0?1(?:\s|[A-Z]|$)/i.test(trimmed)) return null

  const xm = trimmed.match(/X([+-]?\d+(?:\.\d+)?)/)
  const ym = trimmed.match(/Y([+-]?\d+(?:\.\d+)?)/)
  const zm = trimmed.match(/Z([+-]?\d+(?:\.\d+)?)/)

  // Need at least one coordinate
  if (!xm && !ym && !zm) return null

  return {
    x: xm ? Number.parseFloat(xm[1]!) : 0,
    y: ym ? Number.parseFloat(ym[1]!) : 0,
    z: zm ? Number.parseFloat(zm[1]!) : 0
  }
}

/**
 * Extract feed rate from a G1 line, if present.
 */
function extractFeedRate(line: string): string | null {
  const m = line.match(/F(\d+(?:\.\d+)?)/)
  return m ? `F${m[1]}` : null
}

/**
 * Format a number for G-code output: up to 4 decimal places, no trailing zeros.
 */
function gFmt(n: number): string {
  return Number.parseFloat(n.toFixed(4)).toString()
}

/**
 * Convert a GCodeSegment to a G-code line string.
 */
function segmentToGcodeLine(seg: GCodeSegment, feedRate: string | null): string {
  if (seg.type === 'G1') {
    const parts = [`G1 X${gFmt(seg.x)} Y${gFmt(seg.y)} Z${gFmt(seg.z)}`]
    if (feedRate) parts.push(feedRate)
    return parts.join(' ')
  }
  // G2/G3 arc
  const planePart = seg.plane !== 'G17' ? `${seg.plane} ` : ''
  const parts = [
    `${planePart}${seg.type} X${gFmt(seg.x)} Y${gFmt(seg.y)} Z${gFmt(seg.z)}`,
    `I${gFmt(seg.i)} J${gFmt(seg.j)}`
  ]
  // Only include K for non-G17 planes where K is meaningful
  if (seg.plane === 'G18' || seg.plane === 'G19') {
    parts.push(`K${gFmt(seg.k)}`)
  }
  if (feedRate) parts.push(feedRate)
  return parts.join(' ')
}

/**
 * Run arc fitting on toolpath lines, converting consecutive G1 moves that lie
 * on a circular arc into G2/G3 commands. Non-G1 lines (G0 rapids, comments,
 * M-codes, etc.) are passed through unchanged.
 *
 * @param lines     Raw toolpath lines (G0/G1 mix).
 * @param tolerance Maximum deviation (mm) for arc fitting.
 * @returns New array of toolpath lines with arcs inserted where applicable.
 */
export function applyArcFitting(lines: string[], tolerance: number): string[] {
  const result: string[] = []
  let g1Buffer: { point: Point3D; feedRate: string | null; originalLine: string }[] = []

  function flushG1Buffer(): void {
    if (g1Buffer.length === 0) return

    if (g1Buffer.length < 3) {
      // Not enough points for arc fitting — emit as-is
      for (const entry of g1Buffer) {
        result.push(entry.originalLine)
      }
      g1Buffer = []
      return
    }

    // Build point array (first point is the implicit start from previous move)
    // For arc fitting we need the points including the starting position.
    // Since we only have G1 endpoints, the first point is the destination of the
    // move before this buffer. We use the first G1 point as a segment starting
    // "from" somewhere — the arc fitter works on vertices, not segments.
    const points: Point3D[] = g1Buffer.map(e => e.point)

    // Use the feed rate from the last G1 in the buffer (most recently seen F-word)
    let lastFeed: string | null = null
    for (const entry of g1Buffer) {
      if (entry.feedRate) lastFeed = entry.feedRate
    }

    const segments = fitArcsToLinearPath(points, tolerance)

    for (const seg of segments) {
      result.push(segmentToGcodeLine(seg, lastFeed))
    }

    g1Buffer = []
  }

  for (const line of lines) {
    const pt = parseG1Point(line)
    if (pt) {
      g1Buffer.push({ point: pt, feedRate: extractFeedRate(line), originalLine: line })
    } else {
      // Non-G1 line: flush any accumulated G1 buffer first, then pass through
      flushG1Buffer()
      result.push(line)
    }
  }

  // Flush any remaining G1 buffer at the end
  flushG1Buffer()

  return result
}

/**
 * Build cutter compensation G-code lines.
 *
 * @param mode  'left' for G41 (climb), 'right' for G42 (conventional), 'none' for no compensation.
 * @param dRegister  Optional D-register number for wear offset selection.
 * @returns Object with `engage` line (G41/G42) and `cancel` line (G40), or null if mode is 'none'.
 */
export function buildCutterCompLines(
  mode: 'none' | 'left' | 'right',
  dRegister?: number
): { engage: string; cancel: string } | null {
  if (mode === 'none') return null

  const gCode = mode === 'left' ? 'G41' : 'G42'
  const dPart = dRegister != null ? ` D${dRegister}` : ''
  return {
    engage: `${gCode}${dPart}`,
    cancel: 'G40'
  }
}

/**
 * Apply cutter compensation to toolpath lines by inserting G41/G42 before
 * the first feed move and G40 after the last feed move.
 *
 * @param lines  Toolpath lines (G0/G1/G2/G3 mix).
 * @param mode   Compensation mode.
 * @param dRegister  Optional D-register number.
 * @returns New array of toolpath lines with compensation commands inserted.
 */
export function applyCutterCompensation(
  lines: string[],
  mode: 'none' | 'left' | 'right',
  dRegister?: number
): string[] {
  const comp = buildCutterCompLines(mode, dRegister)
  if (!comp) return lines

  // Find the first feed move (G1/G2/G3) and insert G41/G42 before it
  // Find the last feed move and insert G40 after it
  let firstFeedIdx = -1
  let lastFeedIdx = -1
  const feedPattern = /^G0?[123](?:\s|[A-Z]|$)/i

  for (let i = 0; i < lines.length; i++) {
    if (feedPattern.test(lines[i]!.trim())) {
      if (firstFeedIdx === -1) firstFeedIdx = i
      lastFeedIdx = i
    }
  }

  if (firstFeedIdx === -1) return lines // No feed moves found

  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i === firstFeedIdx) {
      result.push(comp.engage)
    }
    result.push(lines[i]!)
    if (i === lastFeedIdx) {
      result.push(comp.cancel)
    }
  }

  return result
}

// ── Subroutine Detection & Wrapping ─────────────────────────────────────────

/**
 * A detected repeating pattern in toolpath lines.
 * `lines` are the repeated block, `count` is how many consecutive times it repeats,
 * and `startIndex` is where the first occurrence begins in the original array.
 */
export type RepeatPattern = {
  lines: string[]
  count: number
  startIndex: number
}

/**
 * Detect consecutive repeated blocks of G-code lines.
 *
 * Scans the input for sequences of N lines (block) that repeat
 * consecutively >= `minRepeats` times. Tries block sizes from largest
 * feasible down to `minBlockSize`, and returns the first (longest) match
 * found at each position.
 *
 * Only examines exact textual repeats (after whitespace normalization).
 */
export function detectRepeatPatterns(
  lines: string[],
  minRepeats = 3,
  minBlockSize = 2
): RepeatPattern[] {
  const patterns: RepeatPattern[] = []
  const consumed = new Set<number>()

  // Normalize a line for comparison: trim whitespace, collapse multiple spaces
  const norm = (l: string): string => l.trim().replace(/\s+/g, ' ')

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue

    // Try block sizes from largest feasible down to minimum
    const maxBlock = Math.floor((lines.length - i) / minRepeats)
    for (let blockSize = Math.min(maxBlock, 20); blockSize >= minBlockSize; blockSize--) {
      const block = lines.slice(i, i + blockSize)

      // Count how many consecutive times this block repeats
      let repeats = 1
      let j = i + blockSize
      while (j + blockSize <= lines.length) {
        let matches = true
        for (let k = 0; k < blockSize; k++) {
          if (norm(lines[j + k]!) !== norm(block[k]!)) {
            matches = false
            break
          }
        }
        if (!matches) break
        repeats++
        j += blockSize
      }

      if (repeats >= minRepeats) {
        patterns.push({ lines: block, count: repeats, startIndex: i })
        // Mark all repeated lines as consumed
        for (let idx = i; idx < i + blockSize * repeats; idx++) {
          consumed.add(idx)
        }
        break // Found a pattern at this position, move on
      }
    }
  }

  return patterns
}

/**
 * Wrap detected repeat patterns as subroutines in the appropriate dialect.
 *
 * - Fanuc: O<num> subroutine body M99, called via M98 P<num> L<count>
 * - Siemens: L<num>: subroutine body RET, called via CALL L<num> REP <count>
 * - Mach3: O<num> sub ... O<num> endsub, called via M98 P<num> L<count>
 *
 * Returns the transformed toolpath lines with inline repeat blocks replaced
 * by subroutine calls, plus the subroutine definitions to append at the end.
 */
export function wrapRepeatPatternsAsSubroutines(
  lines: string[],
  dialect: SubroutineDialect,
  startSubNumber = 1000
): { mainLines: string[]; subroutineDefs: string[] } {
  const patterns = detectRepeatPatterns(lines)

  if (patterns.length === 0) {
    return { mainLines: [...lines], subroutineDefs: [] }
  }

  // Sort patterns by startIndex descending so we can replace from the end
  // without shifting indices.
  const sorted = [...patterns].sort((a, b) => b.startIndex - a.startIndex)

  const mainLines = [...lines]
  const subroutineDefs: string[] = []
  let subNum = startSubNumber

  for (const pattern of sorted) {
    const { lines: block, count, startIndex } = pattern
    const totalLines = block.length * count
    const currentSubNum = subNum

    // Generate subroutine call based on dialect
    let callLine: string
    switch (dialect) {
      case 'fanuc':
        callLine = `M98 P${currentSubNum} L${count}`
        break
      case 'siemens':
        callLine = `CALL L${currentSubNum} REP ${count}`
        break
      case 'mach3':
        callLine = `M98 P${currentSubNum} L${count}`
        break
    }

    // Generate subroutine definition
    const defLines: string[] = []
    switch (dialect) {
      case 'fanuc':
        defLines.push(`O${currentSubNum} (SUBROUTINE ${currentSubNum})`)
        defLines.push(...block)
        defLines.push('M99')
        break
      case 'siemens':
        defLines.push(`; Subroutine L${currentSubNum}`)
        defLines.push(`L${currentSubNum}:`)
        defLines.push(...block)
        defLines.push('RET')
        break
      case 'mach3':
        defLines.push(`O${currentSubNum} sub`)
        defLines.push(...block)
        defLines.push(`O${currentSubNum} endsub`)
        break
    }

    subroutineDefs.push(...defLines, '')

    // Replace the repeated block in mainLines with the subroutine call
    mainLines.splice(startIndex, totalLines, `; --- Subroutine call (${count}x repeat) ---`, callLine)

    subNum += 1
  }

  return { mainLines, subroutineDefs }
}

// ── Line Numbering ──────────────────────────────────────────────────────────────

/**
 * Prepend N-word line numbers to every non-blank G-code line.
 * Comment lines (starting with ; or parenthesized comments) and blank lines
 * are left unnumbered to preserve readability.
 *
 * @param gcode  The complete G-code string.
 * @param config  Line numbering configuration (start, increment).
 * @returns The G-code string with N-words prepended.
 */
export function applyLineNumbering(gcode: string, config: LineNumberingConfig): string {
  if (!config.enabled) return gcode

  const lines = gcode.split('\n')
  let currentN = config.start
  const increment = config.increment

  const numbered = lines.map((line) => {
    const trimmed = line.trim()
    // Skip blank lines
    if (trimmed.length === 0) return line
    // Skip comment-only lines (semicolon or full parenthetical)
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) return line
    // Skip Handlebars-style template lines (should not appear in final output, but safety)
    if (trimmed.startsWith('{{')) return line

    const n = currentN
    currentN += increment
    return `N${n} ${line}`
  })

  return numbered.join('\n')
}

export async function renderPost(
  resourcesRoot: string,
  machine: MachineProfile,
  toolpathLines: string[],
  opts?: {
    workCoordinateIndex?: number
    operationLabel?: string
    spindleRpm?: number
    toolNumber?: number
    inverseTimeFeed?: boolean
    toolWearOffsetH?: number
    toolWearOffsetD?: number
    enableArcFitting?: boolean
    arcTolerance?: number
    cutterCompensation?: 'none' | 'left' | 'right'
    cutterCompDRegister?: number
    enableSubroutines?: boolean
    subroutineDialect?: SubroutineDialect
    lineNumbering?: LineNumberingConfig
  }
): Promise<RenderPostResult> {
  const tplPath = join(resourcesRoot, 'posts', machine.postTemplate)
  const source = await readFile(tplPath, 'utf-8')
  const { on, off, units } = resolveDialectSnippets(machine.dialect)
  const wcsLine = resolveWorkOffsetLine(opts?.workCoordinateIndex)

  let spindleOn = on
  let spindleWarning: string | undefined
  if (opts?.spindleRpm != null) {
    const clamped = clampSpindleRpm(opts.spindleRpm, machine)
    spindleOn = applySpindleRpm(on, clamped.rpm)
    spindleWarning = clamped.warning
  }

  // ── Arc fitting: convert G1 sequences to G2/G3 arcs where possible ──
  let processedLines = toolpathLines
  if (opts?.enableArcFitting) {
    const tol = opts.arcTolerance ?? DEFAULT_ARC_TOLERANCE_MM
    processedLines = applyArcFitting(processedLines, tol)
  }

  // ── Cutter compensation: insert G41/G42 and G40 around contour moves ──
  const compMode = opts?.cutterCompensation ?? 'none'
  if (compMode !== 'none') {
    processedLines = applyCutterCompensation(processedLines, compMode, opts?.cutterCompDRegister)
  }

  // ── Subroutine wrapping: detect repeated patterns and wrap in subroutines ──
  let subroutineDefs: string[] = []
  if (opts?.enableSubroutines && opts.subroutineDialect) {
    const subResult = wrapRepeatPatternsAsSubroutines(processedLines, opts.subroutineDialect)
    processedLines = subResult.mainLines
    subroutineDefs = subResult.subroutineDefs
  }

  const ctx: PostContext = {
    machine,
    toolpathLines: processedLines,
    spindleOn,
    spindleOff: off,
    units,
    ...(wcsLine ? { wcsLine } : {}),
    ...(opts?.operationLabel ? { operationLabel: opts.operationLabel } : {}),
    ...(spindleWarning ? { spindleWarning } : {}),
    ...(opts?.toolNumber != null ? { toolNumber: opts.toolNumber } : {}),
    ...(opts?.inverseTimeFeed ? { inverseTimeFeed: true } : {}),
    ...(opts?.toolWearOffsetH != null ? { toolWearOffsetH: opts.toolWearOffsetH } : {}),
    ...(opts?.toolWearOffsetD != null ? { toolWearOffsetD: opts.toolWearOffsetD } : {}),
    ...(opts?.enableArcFitting ? { enableArcFitting: true } : {}),
    ...(opts?.arcTolerance != null ? { arcTolerance: opts.arcTolerance } : {}),
    ...(compMode !== 'none' ? { cutterCompensation: compMode } : {}),
    ...(opts?.cutterCompDRegister != null ? { cutterCompDRegister: opts.cutterCompDRegister } : {})
  }
  const template = Handlebars.compile(source)
  let gcode = template(ctx)

  // Append subroutine definitions at the end if any were generated
  if (subroutineDefs.length > 0) {
    gcode = gcode.trimEnd() + '\n\n; --- SUBROUTINE DEFINITIONS ---\n' + subroutineDefs.join('\n')
  }

  // Apply line numbering as the final step (after all other transformations)
  if (opts?.lineNumbering?.enabled) {
    gcode = applyLineNumbering(gcode, opts.lineNumbering)
  }

  const warnings: string[] = spindleWarning ? [spindleWarning] : []
  const compliance = validateDialectCompliance(gcode, machine.dialect)
  for (const issue of compliance) {
    warnings.push(`[${issue.code}] ${issue.message} (line ${issue.line})`)
  }
  return { gcode, warnings }
}
