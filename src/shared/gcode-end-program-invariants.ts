// ---------------------------------------------------------------------------
// G-code end-program invariant validator  [ID-0108]
// ---------------------------------------------------------------------------
// Post-pipeline safety check. Sibling module to gcode-header-invariants.ts
// (Cycle 28 / [ID-0018] header-invariants landed the pre-motion checks; this
// module covers the post-motion / program-end checks that were called out as
// the residual scope of [ID-0018] in the Cycle 28 improvement-log entry).
//
// This validator covers three UNIVERSAL post-program safety invariants from
// .claude/skills/gcode-safety/SKILL.md that every CNC post must satisfy:
//
//   1. A program-end command (M2 or M30) is emitted.  Controllers may not
//      stop cleanly without an explicit terminator -- the spindle and
//      coolant state at program end becomes undefined.
//   2. If the spindle was started (M3 clockwise or M4 counter-clockwise),
//      an M5 (spindle off) MUST be emitted after the last M3/M4 and before
//      the program end.  A program that ends with the spindle on is a
//      tool-crash hazard -- the operator may load the machine thinking the
//      job has stopped while the chuck is still spinning.
//   3. The program-end command matches the machine's dialect convention:
//        - mach3 / mach3_4axis (RichAuto A-series, Mach3, Laguna Swift) ->
//          M30 is preferred.  Mach3 expects M30 for "program end + rewind";
//          M2 halts the program but may skip the rewind side-effect the
//          controller relies on for multi-pass jobs.
//        - grbl / grbl_4axis (Smoothieware, Makera Carvera 3/4-axis) ->
//          M2 is preferred.  Smoothieware interprets M30 as "program end
//          + delete file from SD card" on some firmware builds, which
//          silently destroys the uploaded program at the moment the
//          operator most wants to re-run it.  This is documented in the
//          in-template comments of resources/posts/carvera_3axis.hbs and
//          carvera_4axis.hbs.
//      Other dialects (fanuc, siemens, heidenhain, generic_mm) accept
//      either form per the RS274NGC spec -- no preference is enforced.
//      The three dialects above are the ONLY dialects this module flags
//      for mismatch because they are the three in our shop's target set.
//
// FDM mode skips all three checks -- slicer-generated G-code handles end-
// of-print differently (Klipper macros, filament-cooling ramps, etc.) and
// the FDM passthrough template is intentionally minimal.  See
// resources/posts/fdm_passthrough.hbs.
//
// Hook point: renderPost() in src/main/post-process.ts already runs
// validateDialectCompliance() and validateGcodeHeaderInvariants() and
// pushes issues into its warnings[].  The intent is to hook this validator
// in beside them, using the same "[CODE] <message> (line N)" wire format
// so downstream renderers parse all three validator sources the same way.
//
// Pure function -- no I/O, no state, no throws on any input.  Parses
// comments (parenthetical and `;`-tail) the same way gcode-header-
// invariants.ts does to keep the two validators in lockstep.

import type { MachineProfile } from './machine-schema'

/**
 * Severity level for an end-program invariant issue.
 *
 * - `error`: the post output is missing a terminator or leaves the
 *   spindle running across program end -- the machine will either not
 *   stop cleanly or will stop with the tool still spinning.
 * - `warning`: the post output uses a program-end command that is
 *   accepted by the controller but not the dialect convention.  The
 *   dialect-mismatch warning is advisory; override by editing the post
 *   template if the controller is configured for the non-preferred form.
 */
export type EndProgramInvariantLevel = 'error' | 'warning'

/**
 * A single end-program invariant issue.
 */
export type EndProgramInvariantIssue = {
  level: EndProgramInvariantLevel
  /**
   * Stable machine-readable code.  One of:
   *   - END_NO_PROGRAM_END       : no M2 or M30 anywhere in the file
   *   - END_NO_SPINDLE_OFF       : M3/M4 emitted without a trailing M5
   *   - END_SPINDLE_OFF_AFTER_END: M5 appears AFTER the last M2/M30
   *   - END_DIALECT_MISMATCH     : program-end command doesn't match
   *                                the dialect's preferred terminator
   */
  code: string
  /** Human-readable description of the issue. */
  message: string
  /**
   * 1-based line number anchor.  For END_NO_PROGRAM_END this is the
   * total line count of the input (the validator's "where a terminator
   * should have been").  For the other three codes this is the line of
   * the offending M-word (last M3/M4 for END_NO_SPINDLE_OFF, the stray
   * M5 for END_SPINDLE_OFF_AFTER_END, the mismatched terminator for
   * END_DIALECT_MISMATCH).
   */
  line: number
}

/**
 * Validator mode.
 *
 * - `cnc`: run every end-program invariant.
 * - `fdm`: skip end-program invariants.  Returns an empty array.
 *
 * Derived from `MachineProfile.kind` in the integration hook but exposed
 * as a standalone parameter so callers can validate synthetic G-code
 * without constructing a full MachineProfile.
 */
export type EndProgramInvariantMode = 'cnc' | 'fdm'

/**
 * Derive the validator mode from a MachineProfile.
 *
 * One-line shim around `MachineProfile.kind` -- kept as a helper so any
 * future expansion (e.g., a `laser` kind) only touches this function.
 */
export function endProgramInvariantModeForMachine(
  machine: Pick<MachineProfile, 'kind'>
): EndProgramInvariantMode {
  return machine.kind === 'fdm' ? 'fdm' : 'cnc'
}

/**
 * Dialect preference lookup.
 *
 * Returns the dialect's preferred program-end terminator and a short
 * rationale for the warning message.  Returns `null` when the dialect
 * has no enforced preference (either terminator is accepted).
 */
export type DialectEndPreference = {
  preferred: 'M2' | 'M30'
  rationale: string
}

export function preferredProgramEndForDialect(
  dialect: MachineProfile['dialect']
): DialectEndPreference | null {
  switch (dialect) {
    case 'mach3':
    case 'mach3_4axis':
      return {
        preferred: 'M30',
        rationale:
          'Mach3/RichAuto A-series controllers expect M30 for program end ' +
          'and rewind; M2 halts but may skip the rewind side-effect.'
      }
    case 'grbl':
    case 'grbl_4axis':
      return {
        preferred: 'M2',
        rationale:
          'Smoothieware-based controllers (Makera Carvera) may interpret ' +
          'M30 as "program end and delete file from SD card"; use M2.'
      }
    case 'smoothieware':
      // [ID-0160] Cycle 68 — explicit Smoothieware dialect carved out from
      // the 'grbl' misnomer. Same M2 preference (and same rationale) as
      // the grbl/grbl_4axis cases above; this case exists so the validator
      // surfaces the Smoothieware-specific dialect string in operator-
      // facing warnings instead of the misleading "grbl" label.
      return {
        preferred: 'M2',
        rationale:
          'Smoothieware controllers (Makera Carvera 3-axis) interpret M30 ' +
          'as "program end and delete file from SD card"; use M2 instead.'
      }
    default:
      return null
  }
}

/**
 * Helper: strip inline comments and whitespace from a G-code line.
 *
 * Matches gcode-header-invariants.ts exactly so the two validators treat
 * the same lines the same way.  Drops `(...)` parenthetical comments and
 * everything after a `;` semicolon comment.
 */
function stripComments(line: string): string {
  let result = line.replace(/\([^)]*\)/g, '')
  const semiIdx = result.indexOf(';')
  if (semiIdx >= 0) result = result.substring(0, semiIdx)
  return result.trim()
}

/**
 * Helper: extract all M-words from a stripped line as canonical tokens.
 *
 * Returns uppercased matches with leading zeros stripped from the integer
 * part, e.g. `M03` -> `M3`, `M030` -> `M30`.  Decimals are preserved
 * (though none of the M-codes we track have decimal variants).
 */
function extractMWords(stripped: string): string[] {
  const matches = stripped.match(/M\d+(\.\d+)?/gi)
  if (!matches) return []
  const out: string[] = []
  for (const raw of matches) {
    const up = raw.toUpperCase()
    const m = up.match(/^M(\d+)(\.\d+)?$/)
    if (!m) continue
    const intPart = String(Number.parseInt(m[1]!, 10))
    out.push(`M${intPart}${m[2] ?? ''}`)
  }
  return out
}

/** The M-codes this validator tracks. */
type TrackedMWord = 'M2' | 'M3' | 'M4' | 'M5' | 'M30'
const TRACKED: ReadonlySet<TrackedMWord> = new Set<TrackedMWord>([
  'M2',
  'M3',
  'M4',
  'M5',
  'M30'
])

function isTracked(word: string): word is TrackedMWord {
  return (TRACKED as ReadonlySet<string>).has(word)
}

type MSighting = { cmd: TrackedMWord; line: number }

/**
 * Walk every line of G-code and collect every tracked M-word with its
 * 1-based line number.  Comments are stripped before matching so an
 * M-code written inside a `;` or `(...)` comment does NOT count.
 */
function collectMSightings(gcode: string): MSighting[] {
  const lines = gcode.split('\n')
  const out: MSighting[] = []
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComments(lines[i]!)
    if (stripped === '') continue
    for (const word of extractMWords(stripped)) {
      if (isTracked(word)) {
        out.push({ cmd: word, line: i + 1 })
      }
    }
  }
  return out
}

/**
 * Validate the end-program invariants of a rendered G-code string.
 *
 * Pure function.  Returns an empty array when the input either (a) is
 * FDM mode, (b) is empty, or (c) passes every invariant.  Otherwise the
 * returned issues are ordered as documented on `EndProgramInvariantIssue`:
 *   1. END_NO_PROGRAM_END (if applicable)
 *   2. END_NO_SPINDLE_OFF (if applicable)
 *   3. END_SPINDLE_OFF_AFTER_END (if applicable)
 *   4. END_DIALECT_MISMATCH (if applicable)
 *
 * The first three are errors; the fourth is a warning.  Each issue's
 * `line` anchor points at a specific byte offset the operator can inspect.
 */
export function validateGcodeEndProgramInvariants(
  gcode: string,
  mode: EndProgramInvariantMode,
  dialect: MachineProfile['dialect']
): EndProgramInvariantIssue[] {
  if (mode === 'fdm') return []
  if (!gcode.trim()) return []

  const totalLines = gcode.split('\n').length
  const sightings = collectMSightings(gcode)
  const issues: EndProgramInvariantIssue[] = []

  const endSightings = sightings.filter(s => s.cmd === 'M2' || s.cmd === 'M30')
  const spindleOnSightings = sightings.filter(s => s.cmd === 'M3' || s.cmd === 'M4')
  const spindleOffSightings = sightings.filter(s => s.cmd === 'M5')

  // --- Invariant 1: END_NO_PROGRAM_END ---------------------------------
  if (endSightings.length === 0) {
    issues.push({
      level: 'error',
      code: 'END_NO_PROGRAM_END',
      message:
        'No program-end command (M2 or M30) was emitted. Controllers may ' +
        'not stop cleanly without an explicit terminator; the spindle and ' +
        'coolant state at program end is undefined.',
      line: totalLines
    })
  }

  // --- Invariants 2 + 3: spindle-off ordering --------------------------
  if (spindleOnSightings.length > 0) {
    const lastSpindleOn = spindleOnSightings[spindleOnSightings.length - 1]!
    const spindleOffAfterOn = spindleOffSightings.find(
      s => s.line > lastSpindleOn.line
    )
    if (!spindleOffAfterOn) {
      issues.push({
        level: 'error',
        code: 'END_NO_SPINDLE_OFF',
        message:
          'Spindle started (M3/M4) but no M5 was emitted to stop it before ' +
          'program end. Leaving the spindle running across program end is a ' +
          'tool-crash hazard.',
        line: lastSpindleOn.line
      })
    } else if (endSightings.length > 0) {
      const lastEnd = endSightings[endSightings.length - 1]!
      if (spindleOffAfterOn.line > lastEnd.line) {
        issues.push({
          level: 'error',
          code: 'END_SPINDLE_OFF_AFTER_END',
          message:
            'M5 (spindle off) appears after the program-end command (M2/M30). ' +
            'Controllers halt at program end; commands after it will not execute.',
          line: spindleOffAfterOn.line
        })
      }
    }
  }

  // --- Invariant 4: END_DIALECT_MISMATCH -------------------------------
  if (endSightings.length > 0) {
    const preference = preferredProgramEndForDialect(dialect)
    if (preference) {
      const lastEnd = endSightings[endSightings.length - 1]!
      if (lastEnd.cmd !== preference.preferred) {
        issues.push({
          level: 'warning',
          code: 'END_DIALECT_MISMATCH',
          message:
            `Program end is ${lastEnd.cmd} but dialect "${dialect}" prefers ` +
            `${preference.preferred}. ${preference.rationale}`,
          line: lastEnd.line
        })
      }
    }
  }

  return issues
}
