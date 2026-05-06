// ---------------------------------------------------------------------------
// G-code header-invariant validator  [ID-0018]
// ---------------------------------------------------------------------------
// Post-pipeline safety check. Runs AFTER a post template renders and AFTER
// dialect-compliance (gcode-dialect-compliance.ts) has classified controller-
// specific faults. This validator covers the UNIVERSAL safety invariants from
// .claude/skills/gcode-safety/SKILL.md that every CNC post must satisfy:
//
//   1. Explicit units declared (G20 inches OR G21 millimeters) before any
//      motion word (G0/G1/G2/G3).  Controllers boot into different defaults
//      across firmware versions; relying on the default is how operators
//      discover their machine mid-program after a firmware update.
//   2. Absolute mode (G90) declared before any motion word.  The alternative
//      (G91 incremental) reinterprets every X/Y/Z/A as a delta -- catastrophic
//      for a toolpath built on absolute coordinates.
//   3. Plane select (G17/G18/G19) declared before any motion word.  G2/G3
//      arcs are interpreted in the active plane; default-plane-XY is not
//      universal across controllers (Smoothieware defaults to XY but Fanuc
//      historically defaults to whatever was last active).
//   4. Work-coordinate system declared (G54-G59 OR G54.1).  Trusting a
//      controller to retain the last WCS across power cycles is how stock
//      gets machined into the fixture.  This is a WARNING (not an error)
//      because some single-fixture posts legitimately omit it and rely on
//      the controller's configured default.
//
// FDM mode skips all four checks -- slicer-generated G-code and Klipper's
// firmware defaults handle these invariants differently (M82/M83 for
// extruder coordinate mode, G92 for position reset, etc.).  Nothing in the
// FDM pipeline today emits a post-processed CNC-style header; the FDM
// passthrough template is intentionally minimal (see resources/posts/
// fdm_passthrough.hbs) and a future cycle can add FDM-specific invariants.
//
// Hook point: renderPost() in src/main/post-process.ts already runs
// validateDialectCompliance() and pushes issues into its warnings[].  The
// intent is to hook this validator in beside it.  Pure function -- no I/O,
// no state, no throws.

import type { MachineProfile } from './machine-schema'

/**
 * Severity level for a header-invariant issue.
 *
 * - `error`: the post output is missing a declaration that every CNC
 *   controller in our fleet requires (or whose absence has a known
 *   crash-class failure mode).
 * - `warning`: the post output is missing a declaration that is
 *   strongly recommended but whose absence can be safe in specific
 *   configurations (e.g., WCS declaration on a single-fixture post).
 */
export type HeaderInvariantLevel = 'error' | 'warning'

/**
 * A single header-invariant issue.
 */
export type HeaderInvariantIssue = {
  level: HeaderInvariantLevel
  /** Stable machine-readable code, e.g. `HEADER_NO_UNITS`. */
  code: string
  /** Human-readable description of the issue. */
  message: string
  /**
   * 1-based line number in the G-code where the first motion word was
   * observed (i.e., where "header time" ends).  If no motion word is
   * found, this is the total line count of the input.
   */
  firstMotionLine: number
}

/**
 * Validator mode.
 *
 * - `cnc`: run every header invariant (units, absolute, plane, WCS).
 * - `fdm`: skip header invariants.  Returns an empty array.
 *
 * Derived from `MachineProfile.kind` in the integration hook, but exposed
 * as a standalone parameter so callers can validate synthetic G-code
 * without constructing a full MachineProfile.
 */
export type HeaderInvariantMode = 'cnc' | 'fdm'

/**
 * Helper: strip inline comments and whitespace from a G-code line.
 *
 * Matches the implementation in gcode-dialect-compliance.ts so the two
 * validators treat the same lines the same way.  Drops `(...)`
 * parenthetical comments and everything after a `;` semicolon comment.
 */
function stripComments(line: string): string {
  let result = line.replace(/\([^)]*\)/g, '')
  const semiIdx = result.indexOf(';')
  if (semiIdx >= 0) result = result.substring(0, semiIdx)
  return result.trim()
}

/**
 * Helper: does this stripped line contain a motion word?
 *
 * We look for G0/G1/G2/G3 as standalone tokens -- prefix-defense against
 * matching `G10` (tool/data offset) or `G17` (plane) etc.  The regex
 * anchors on non-digit boundaries on both sides.  Case-insensitive.
 */
function hasMotionWord(stripped: string): boolean {
  // Token-boundary match for G0..G3 as whole words (not G10, G17, G28, etc.)
  return /(^|[^\dA-Za-z])G0*[0-3](\.\d+)?($|[^\d])/i.test(stripped)
}

/**
 * Helper: extract all G-words from a stripped line (e.g. ['G21', 'G90']).
 *
 * Returns uppercase canonical forms; `g17` becomes `G17`.  Leading zeros
 * on the number are preserved as-written -- `G01` and `G1` are both valid
 * and do mean the same thing, so callers that want normalization should
 * parse the numeric part themselves.
 */
function extractGWords(stripped: string): string[] {
  const matches = stripped.match(/G\d+(\.\d+)?/gi)
  return matches ? matches.map(m => m.toUpperCase()) : []
}

/**
 * Helper: normalize a G-word for set-membership comparison.
 *
 * `G01` -> `G1`, `G021` -> `G21`, `G54.1` stays `G54.1`.  Leading zeros
 * on the integer part are stripped so the set-lookup `checkUnits` etc.
 * don't need to enumerate every zero-padded variant.
 */
function normalizeGWord(word: string): string {
  const up = word.toUpperCase()
  // Strip leading zeros from the integer part while preserving any decimal.
  const m = up.match(/^G(\d+)(\.\d+)?$/)
  if (!m) return up
  const intPart = String(Number.parseInt(m[1], 10))
  return `G${intPart}${m[2] ?? ''}`
}

/**
 * The set of declaration G-words we track per header invariant.
 *
 * Each entry lists the alternatives that SATISFY the invariant.  Presence
 * of ANY one of them before the first motion word clears the check.
 */
const UNIT_WORDS = new Set(['G20', 'G21'])
const ABSOLUTE_WORDS = new Set(['G90'])
const PLANE_WORDS = new Set(['G17', 'G18', 'G19'])
// G54 through G59 plus the extended range G54.1 are the valid WCS
// declarations for every controller in the fleet.  G53 is NOT a WCS --
// it's a one-shot machine-coordinate override.
const WCS_WORDS = new Set(['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G54.1'])

/**
 * Validate the header invariants of a rendered G-code string.
 *
 * Pure function.  Returns an empty array when the input either (a) is
 * FDM mode, (b) is empty, or (c) passes every invariant.  Otherwise the
 * returned issues are ordered as written in the invariant list above.
 *
 * `firstMotionLine` on each issue points at the first motion word (1-based)
 * so the operator has a line to inspect when the post fails.  If the
 * input contains no motion word at all (pure header / pure comment
 * block / empty), `firstMotionLine` is the total line count; the
 * validator still runs every check because a header-only file is still
 * either valid (every declaration present) or invalid (anything missing).
 */
export function validateGcodeHeaderInvariants(
  gcode: string,
  mode: HeaderInvariantMode
): HeaderInvariantIssue[] {
  if (mode === 'fdm') return []
  if (!gcode.trim()) return []

  const lines = gcode.split('\n')

  // Walk lines.  Collect declarations until the first motion word, which
  // marks the end of "header time".
  let firstMotionLine = lines.length // 1-based; fall back to total if no motion word
  const seenUnit = new Set<string>()
  const seenAbsolute = new Set<string>()
  const seenPlane = new Set<string>()
  const seenWcs = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComments(lines[i]!)
    if (stripped === '') continue

    // Collect declarations on this line BEFORE checking for motion --
    // a hand-written header that combines declarations with a rapid move
    // like `G21 G90 G0 X0 Y0` still counts those declarations as
    // present (they execute in the same block on every controller we
    // target).  Real posts don't emit this shape; defensive handling.
    for (const raw of extractGWords(stripped)) {
      const w = normalizeGWord(raw)
      if (UNIT_WORDS.has(w)) seenUnit.add(w)
      if (ABSOLUTE_WORDS.has(w)) seenAbsolute.add(w)
      if (PLANE_WORDS.has(w)) seenPlane.add(w)
      if (WCS_WORDS.has(w)) seenWcs.add(w)
    }

    if (hasMotionWord(stripped)) {
      firstMotionLine = i + 1 // 1-based
      break
    }
  }

  const issues: HeaderInvariantIssue[] = []

  if (seenUnit.size === 0) {
    issues.push({
      level: 'error',
      code: 'HEADER_NO_UNITS',
      message:
        'No explicit units declaration (G20 inches or G21 millimeters) ' +
        'was emitted before the first motion word. Controllers boot into ' +
        'different defaults across firmware versions.',
      firstMotionLine
    })
  }
  if (seenAbsolute.size === 0) {
    issues.push({
      level: 'error',
      code: 'HEADER_NO_ABSOLUTE_MODE',
      message:
        'No absolute-mode declaration (G90) was emitted before the first ' +
        'motion word. Without G90 the controller may reinterpret toolpath ' +
        'coordinates as incremental (G91).',
      firstMotionLine
    })
  }
  if (seenPlane.size === 0) {
    issues.push({
      level: 'error',
      code: 'HEADER_NO_PLANE_SELECT',
      message:
        'No plane select (G17/G18/G19) was emitted before the first motion ' +
        'word. G2/G3 arc moves are interpreted in the active plane; ' +
        'relying on the controller default is not portable.',
      firstMotionLine
    })
  }
  if (seenWcs.size === 0) {
    issues.push({
      level: 'warning',
      code: 'HEADER_NO_WCS',
      message:
        'No work-coordinate system (G54-G59 or G54.1) was emitted before ' +
        'the first motion word. Trusting the controller to retain the ' +
        'last WCS across power cycles can machine into a fixture.',
      firstMotionLine
    })
  }

  return issues
}

/**
 * Derive the validator mode from a MachineProfile.
 *
 * Today this is a one-line shim around `MachineProfile.kind`.  Kept as a
 * helper so any future expansion (e.g., a 'laser' kind that has its own
 * invariants) only touches this function, not every call-site.
 */
export function headerInvariantModeForMachine(
  machine: Pick<MachineProfile, 'kind'>
): HeaderInvariantMode {
  return machine.kind === 'fdm' ? 'fdm' : 'cnc'
}
