// ---------------------------------------------------------------------------
// G-code safe-Z retract invariant validator  [ID-0018-safez]
// ---------------------------------------------------------------------------
// Post-pipeline safety check. Sibling module to gcode-end-program-invariants.ts
// (Cycle 32 / [ID-0108]) and gcode-header-invariants.ts (Cycle 28 / [ID-0018]).
// This module covers the SAFE-Z RETRACT invariants from
// .claude/skills/gcode-safety/SKILL.md "Safe retract" checklist:
//
//   "every non-cut move is at or above the configured clearance plane.
//    Z always rises before XY moves between operations. Check for toolpath
//    segments that rapid in XY at cut depth."
//
// Three invariants are checked, mirroring the three classic safe-Z failure
// modes that crash spindles or ruin stock:
//
//   1. RETRACT_NO_PRE_CUT_RETRACT
//      Before the FIRST cut move (G1/G2/G3) the post must emit at least one
//      G0 Z rapid that lifts Z to the safe clearance. Without this the very
//      first cut may begin from whatever Z the controller booted into --
//      almost always Z=0 = the table = a broken bit at best, a wrecked
//      spoilboard at worst. This is the classic "rapid into stock from
//      power-on" anti-pattern.
//
//   2. RETRACT_NO_END_RETRACT
//      After the LAST cut move (G1/G2/G3) and before the program-end
//      command (M2/M30) the post must emit at least one G0 Z rapid back
//      to the safe clearance. Without this the spindle stops at whatever
//      Z it last cut at -- typically deep inside the stock -- and the
//      operator has to back the bit out manually. Carvera ATC tool changes
//      and Laguna fixture swaps both assume the bit is parked above the
//      stock; this invariant pins that assumption.
//
//   3. RETRACT_XY_RAPID_AT_CUT_DEPTH
//      Any G0 (rapid) move that changes X or Y while the modal Z is below
//      the safe clearance is flagged as a per-occurrence error. The
//      validator tracks the modal Z across the program and emits one
//      issue per offending line. This is the "rapid in XY at cut depth"
//      anti-pattern from the SKILL.md checklist -- typically caused by an
//      operation-to-operation transition that forgot a Z lift.
//
// Safe-clearance threshold:
//   - Caller passes a numeric `safeClearanceMm`. The recommended source is
//     `resolveSafeZClearanceMm(machine)` which prefers the optional
//     `machine.safeRetractZMm` field added in [ID-0005] and falls back to
//     `machine.workAreaMm.z` (the conservative full-envelope retract every
//     bundled post template uses today).
//   - When `safeClearanceMm` is `null`, the validator falls back to the
//     "Z must be strictly positive" rule -- i.e., any G0 Z>0 counts as a
//     safe retract and any modal Z<=0 is treated as cut depth. This is
//     the universal repo convention (stock top is at Z=0; positive Z is
//     above the workpiece).
//
// FDM mode skips all three checks -- slicer-generated G-code handles
// retraction differently (filament E-axis retraction has nothing to do
// with toolhead Z, and Klipper's print-end macro emits Z lifts via custom
// macros that vary by printer).  See resources/posts/fdm_passthrough.hbs.
//
// Hook point: renderPost() in src/main/post-process.ts already runs three
// validators (validateDialectCompliance, validateGcodeHeaderInvariants,
// validateGcodeEndProgramInvariants) and pushes their issues into
// `warnings[]`. The intent is to hook this validator in beside them in a
// follow-up cycle, using the same "[CODE] <message> (line N)" wire format
// so downstream renderers parse all four validator sources the same way.
//
// Pure function -- no I/O, no state, no throws on any input. Parses G-code
// the same way the sibling validators do (strip `;` and `(...)` comments,
// case-insensitive G/M/X/Y/Z words) so the four validators stay in lockstep.

import type { MachineProfile } from './machine-schema'

/**
 * Severity level for a safe-Z retract invariant issue.
 *
 * - `error`: the post output either omits a required safe-Z lift or
 *   performs an XY rapid below the safe clearance -- both are crash-class
 *   failure modes the operator cannot recover from after the fact.
 *
 * No `warning` level is emitted today; the three tracked invariants are
 * all errors. Reserved for future per-axis or per-strategy heuristics.
 */
export type SafeZInvariantLevel = 'error' | 'warning'

/**
 * A single safe-Z retract invariant issue.
 */
export type SafeZInvariantIssue = {
  level: SafeZInvariantLevel
  /**
   * Stable machine-readable code. One of:
   *   - RETRACT_NO_PRE_CUT_RETRACT      : no G0 Z>=safe before the first cut
   *   - RETRACT_NO_END_RETRACT          : no G0 Z>=safe after the last cut
   *                                       and before the program-end command
   *   - RETRACT_XY_RAPID_AT_CUT_DEPTH   : G0 X/Y emitted while modal Z is
   *                                       below the safe clearance
   */
  code: string
  /** Human-readable description of the issue. */
  message: string
  /**
   * 1-based line number anchor.
   *
   *   - RETRACT_NO_PRE_CUT_RETRACT: line of the first cut move (G1/G2/G3)
   *     that fired without a prior safe-Z lift.
   *   - RETRACT_NO_END_RETRACT: line of the last cut move (or the program-
   *     end command, whichever is later) so the operator sees where the
   *     missing retract should have been.
   *   - RETRACT_XY_RAPID_AT_CUT_DEPTH: line of the offending G0 X/Y move.
   */
  line: number
}

/**
 * Validator mode.
 *
 * - `cnc`: run every safe-Z retract invariant.
 * - `fdm`: skip safe-Z invariants. Returns an empty array.
 *
 * Derived from `MachineProfile.kind` in the integration hook but exposed
 * as a standalone parameter so callers can validate synthetic G-code
 * without constructing a full MachineProfile.
 */
export type SafeZInvariantMode = 'cnc' | 'fdm'

/**
 * Derive the validator mode from a MachineProfile.
 *
 * One-line shim around `MachineProfile.kind` -- kept as a helper so any
 * future expansion (e.g., a `laser` kind) only touches this function.
 */
export function safeZInvariantModeForMachine(
  machine: Pick<MachineProfile, 'kind'>
): SafeZInvariantMode {
  return machine.kind === 'fdm' ? 'fdm' : 'cnc'
}

/**
 * Resolve the safe-Z clearance threshold from a machine profile.
 *
 * Preference order:
 *   1. `machine.safeRetractZMm` (the [ID-0005] optional field) when present
 *      and strictly positive. This is the explicit operator-tuned safe-Z
 *      that lives below the full envelope (e.g., Laguna ships with 25 mm).
 *   2. `machine.workAreaMm.z` when present and strictly positive. This is
 *      the conservative full-envelope retract every bundled post template
 *      uses as the safe-Z fallback today (`G0 Z{{machine.workAreaMm.z}}`).
 *   3. `null` when neither is positive/finite. Caller may still validate
 *      with `null`; the validator then falls back to the universal "Z must
 *      be strictly positive" rule.
 */
export function resolveSafeZClearanceMm(
  machine: Pick<MachineProfile, 'safeRetractZMm' | 'workAreaMm'>
): number | null {
  const explicit = machine.safeRetractZMm
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  const envelopeZ = machine.workAreaMm?.z
  if (typeof envelopeZ === 'number' && Number.isFinite(envelopeZ) && envelopeZ > 0) {
    return envelopeZ
  }
  return null
}

/**
 * Helper: strip inline comments and whitespace from a G-code line.
 *
 * Matches gcode-end-program-invariants.ts and gcode-header-invariants.ts
 * exactly so all three validators treat the same lines the same way.
 * Drops `(...)` parenthetical comments and everything after a `;`
 * semicolon comment.
 */
function stripComments(line: string): string {
  let result = line.replace(/\([^)]*\)/g, '')
  const semiIdx = result.indexOf(';')
  if (semiIdx >= 0) result = result.substring(0, semiIdx)
  return result.trim()
}

/**
 * Helper: extract a numeric word value (X, Y, Z, etc.) from a stripped
 * line. Returns `null` if the letter is not present or the numeric part
 * is not finite.
 *
 * Token-boundary anchored on the left so X10 is not matched as part of
 * GX10 (no such word exists, but defensive against token soup); a number
 * may carry a leading minus and an optional decimal.
 */
function extractWord(line: string, letter: string): number | null {
  const re = new RegExp(`(?:^|[^A-Za-z0-9.])${letter}(-?\\d+(?:\\.\\d+)?)`, 'i')
  const m = line.match(re)
  if (!m) return null
  const v = Number.parseFloat(m[1]!)
  return Number.isFinite(v) ? v : null
}

/**
 * Helper: extract the motion mode word from a stripped line as a numeric
 * 0/1/2/3, or `null` if no motion mode word is present.
 *
 * Matches G0, G1, G2, G3 (with optional leading zeros: G00, G01, G02,
 * G03). Token-boundary anchored on both sides so G10 (offset) and G17
 * (plane) are NOT matched as G1.
 */
function extractMotionMode(line: string): 0 | 1 | 2 | 3 | null {
  const m = line.match(/(?:^|[^A-Za-z0-9.])G0*([0-3])(?:[^0-9.]|$)/i)
  if (!m) return null
  const code = Number.parseInt(m[1]!, 10)
  if (code === 0 || code === 1 || code === 2 || code === 3) return code
  return null
}

/**
 * Helper: extract all M-words from a stripped line as canonical tokens.
 *
 * Returns uppercased matches with leading zeros stripped from the integer
 * part, e.g. `M02` -> `M2`, `M030` -> `M30`. Used to detect program-end
 * (M2 / M30) so the validator stops walking once the program terminates.
 */
function extractMWords(line: string): string[] {
  const matches = line.match(/M\d+(\.\d+)?/gi)
  if (!matches) return []
  const out: string[] = []
  for (const raw of matches) {
    const up = raw.toUpperCase()
    const m = up.match(/^M(\d+)(\.\d+)?$/)
    if (!m) continue
    out.push(`M${Number.parseInt(m[1]!, 10)}${m[2] ?? ''}`)
  }
  return out
}

const PROGRAM_END_M_WORDS: ReadonlySet<string> = new Set(['M2', 'M30'])

/**
 * Decide whether a Z value is "at or above" the safe clearance.
 *
 * When `safeClearanceMm` is `null` the rule degrades to "strictly positive"
 * per the universal repo convention (stock top at Z=0). When numeric, the
 * Z must be >= the threshold; equality at the threshold counts as safe
 * (post templates emit `G0 Z{{machine.workAreaMm.z}}` exactly at the
 * envelope ceiling and that has to pass).
 */
function isSafeZ(z: number, safeClearanceMm: number | null): boolean {
  if (safeClearanceMm === null) return z > 0
  return z >= safeClearanceMm
}

/**
 * Decide whether a modal Z value is "below" the safe clearance, i.e.,
 * a position where an XY rapid would constitute a cut-depth transit.
 *
 * Inverse of `isSafeZ`. When `safeClearanceMm` is `null` the rule
 * degrades to "<=0" (negative or at-stock-top); when numeric, the Z must
 * be strictly less than the threshold.
 */
function isCutDepthZ(z: number, safeClearanceMm: number | null): boolean {
  if (safeClearanceMm === null) return z <= 0
  return z < safeClearanceMm
}

/**
 * Validate the safe-Z retract invariants of a rendered G-code string.
 *
 * Pure function. Returns an empty array when the input either (a) is FDM
 * mode, (b) is empty, or (c) passes every invariant. Otherwise the
 * returned issues are ordered:
 *   1. RETRACT_NO_PRE_CUT_RETRACT (if applicable; one issue total)
 *   2. RETRACT_NO_END_RETRACT     (if applicable; one issue total)
 *   3. RETRACT_XY_RAPID_AT_CUT_DEPTH (per-occurrence, in line order)
 *
 * `safeClearanceMm` is the threshold below which a position is considered
 * "cut depth"; pass `resolveSafeZClearanceMm(machine)` for the canonical
 * value, or `null` to degrade to the "Z>0 = safe" universal convention.
 */
export function validateGcodeSafeZRetractInvariants(
  gcode: string,
  mode: SafeZInvariantMode,
  safeClearanceMm: number | null
): SafeZInvariantIssue[] {
  if (mode === 'fdm') return []
  if (!gcode.trim()) return []

  const lines = gcode.split('\n')

  // Modal state -- updated as we walk the program.
  let modalMotion: 0 | 1 | 2 | 3 | null = null
  let modalZ: number | null = null

  // Tracking state for the program-wide invariants.
  let firstCutLine: number | null = null
  let lastCutLine: number | null = null
  let preCutSafeRetractSeen = false
  let endRetractAfterCut = false
  let programEndLine: number | null = null

  // Per-occurrence buffer for RETRACT_XY_RAPID_AT_CUT_DEPTH so we can
  // emit it AFTER the program-wide issues (per the documented ordering).
  const xyRapidIssues: SafeZInvariantIssue[] = []

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComments(lines[i]!)
    if (stripped === '') continue
    const lineNo = i + 1

    // Detect program-end M-words FIRST -- once M2/M30 fires, anything
    // after it does not execute on the controller, so we stop walking.
    const mWords = extractMWords(stripped)
    if (mWords.some(m => PROGRAM_END_M_WORDS.has(m))) {
      programEndLine = lineNo
      break
    }

    // Update modal motion if this line carries a G0/G1/G2/G3 word.
    const motion = extractMotionMode(stripped)
    if (motion !== null) modalMotion = motion

    const x = extractWord(stripped, 'X')
    const y = extractWord(stripped, 'Y')
    const z = extractWord(stripped, 'Z')

    // No motion classification available yet -- skip motion logic but
    // still update modal Z if a Z word was emitted (some posts emit a
    // bare `Z25` to set modal Z without committing a G-mode; treat it
    // as if it were a G0).
    if (modalMotion === null) {
      if (z !== null) modalZ = z
      continue
    }

    // Update modal Z if this line carries a Z word.
    if (z !== null) modalZ = z

    if (modalMotion === 0) {
      // Rapid move. Three sub-cases:
      //   (a) Z lift: a G0 with Z>=safe counts toward the pre-cut and
      //       end-cut retract requirements.
      //   (b) Combined XYZ: classify by the new Z (the move ends at Z).
      //   (c) Pure XY rapid: check the modal Z (we have not changed Z
      //       this line, so the previous modal Z is the cut depth).
      if (z !== null) {
        if (isSafeZ(z, safeClearanceMm)) {
          if (firstCutLine === null) preCutSafeRetractSeen = true
          if (firstCutLine !== null) endRetractAfterCut = true
        } else if ((x !== null || y !== null) && isCutDepthZ(z, safeClearanceMm)) {
          // Combined XYZ rapid where Z drops below safe clearance AT
          // the same time as XY motion -- this is a plunge-style rapid
          // and is also a cut-depth transit.
          xyRapidIssues.push({
            level: 'error',
            code: 'RETRACT_XY_RAPID_AT_CUT_DEPTH',
            message:
              `G0 rapid moves X/Y while Z=${z} is below the safe clearance ` +
              `(${safeClearanceMm === null ? '> 0' : `>= ${safeClearanceMm}`}). ` +
              'Combined-XYZ rapids that drop below safe clearance are a cut-' +
              'depth transit -- the bit may strike stock or fixturing.',
            line: lineNo
          })
        }
      } else if (x !== null || y !== null) {
        // Pure XY rapid -- the prior modal Z is the depth being transited.
        if (modalZ !== null && isCutDepthZ(modalZ, safeClearanceMm)) {
          xyRapidIssues.push({
            level: 'error',
            code: 'RETRACT_XY_RAPID_AT_CUT_DEPTH',
            message:
              `G0 rapid moves X/Y while modal Z=${modalZ} is below the safe ` +
              `clearance (${safeClearanceMm === null ? '> 0' : `>= ${safeClearanceMm}`}). ` +
              'Z must rise to the safe clearance before any XY rapid between ' +
              'operations -- otherwise the bit transits at cut depth.',
            line: lineNo
          })
        }
      }
    } else {
      // Cut move (G1/G2/G3). Mark the program as having entered cut
      // territory; reset endRetractAfterCut because any cut after a
      // retract re-arms the end-retract requirement.
      if (firstCutLine === null) firstCutLine = lineNo
      lastCutLine = lineNo
      endRetractAfterCut = false
    }
  }

  const issues: SafeZInvariantIssue[] = []

  // --- Invariant 1: RETRACT_NO_PRE_CUT_RETRACT --------------------------
  if (firstCutLine !== null && !preCutSafeRetractSeen) {
    issues.push({
      level: 'error',
      code: 'RETRACT_NO_PRE_CUT_RETRACT',
      message:
        'No safe-Z lift (G0 Z' +
        (safeClearanceMm === null ? '>0' : `>=${safeClearanceMm}`) +
        ') was emitted before the first cut move (G1/G2/G3). The first cut ' +
        'may begin from whatever Z the controller booted into -- typically ' +
        'Z=0 = the table = a broken bit.',
      line: firstCutLine
    })
  }

  // --- Invariant 2: RETRACT_NO_END_RETRACT ------------------------------
  if (firstCutLine !== null && !endRetractAfterCut) {
    issues.push({
      level: 'error',
      code: 'RETRACT_NO_END_RETRACT',
      message:
        'No safe-Z lift (G0 Z' +
        (safeClearanceMm === null ? '>0' : `>=${safeClearanceMm}`) +
        ') was emitted after the last cut move (G1/G2/G3) and before the ' +
        'program-end command (M2/M30). The spindle stops at the last cut ' +
        'depth; tool change and fixture swaps assume the bit is parked ' +
        'above the stock.',
      line: programEndLine ?? lastCutLine ?? firstCutLine
    })
  }

  // --- Invariant 3: RETRACT_XY_RAPID_AT_CUT_DEPTH (per-occurrence) -----
  for (const issue of xyRapidIssues) issues.push(issue)

  return issues
}
