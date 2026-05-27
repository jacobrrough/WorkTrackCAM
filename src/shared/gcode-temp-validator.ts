/**
 * Pre-upload G-code temperature validator for FDM jobs.
 *
 * Purpose
 * -------
 * The Creality K2 Plus (and any Klipper/Moonraker printer) enforces its own
 * firmware ceilings on nozzle and bed temperatures. When a sliced G-code
 * file requests a target above those ceilings, the printer will refuse to
 * reach the target, but only AFTER the operator has started the job. That
 * wastes heat-up time and leaves a half-warmed-up printer staring at an
 * error.
 *
 * This module extracts every M104 / M109 / M140 / M190 / M141 / M191
 * target from the top of a sliced G-code file, plus Klipper-extended
 * `SET_HEATER_TEMPERATURE HEATER=chamber TARGET=<n>` macro calls, and
 * cross-checks each against the active machine profile's
 * `maxNozzleTempC` / `maxBedTempC` / `chamberTempC`. M191 is Marlin's
 * "wait for chamber temperature" blocking analog of M141 -- most
 * slicers targeting a heated-chamber printer emit BOTH (M141 sets the
 * target early so the chamber can heat while other moves proceed; M191
 * later blocks until the target is reached). Treating M191 the same as
 * M141 means an operator who hand-edits a gcode header to bump only the
 * M141 target without updating the M191 still gets caught by the
 * higher of the two (see [ID-0079]). The Moonraker push
 * path (`src/main/moonraker-push.ts`) can call `validateGcodeFileTemps`
 * before the multipart upload to short-circuit a doomed job and surface
 * a clear error to the renderer.
 *
 * Safety Rule 1 (G-code is sacred): this module is READ-ONLY with respect
 * to G-code. It parses existing files and reports violations; it never
 * mutates the file, and it never emits new G-code.
 *
 * Safety Rule 2 (schema migrations): `FdmCapabilityFields` is the same
 * structural subset already exported from `cura-slice-defaults.ts` (see
 * [ID-0012] / [ID-0068]). Callers that pass `null` / `undefined` caps or
 * caps with unset ceilings get a pass-through "no violations" result --
 * existing callers that do not yet thread `machineCapabilities` through
 * the upload path see byte-identical behavior.
 *
 * Roadmap: [ID-0070] (initial M104/M109/M140/M190 + nozzle/bed), [ID-0071]
 * (M141 + Klipper SET_HEATER_TEMPERATURE HEATER=chamber + chamberTempC),
 * [ID-0079] (M191 wait-for-chamber, shares the chamber-kind routing and
 * `chamberTempC` ceiling with M141 -- see the Cycle 17 entry in
 * `.claude/improvement-log.md`), [ID-0077] (Klipper HEATER=extruder /
 * HEATER=extruder<N> / HEATER=heater_bed broadening, Cycle 24 -- see
 * the Cycle 24 entry in `.claude/improvement-log.md`).
 */

/**
 * Structural subset of an FDM machine profile's firmware-ceiling fields.
 * Inlined here after the cura-slice-defaults.ts module was deleted in the
 * 2026-05-27 OrcaSlicer pivot; this validator is slicer-agnostic and only
 * needs the temperature ceilings.
 */
export type FdmCapabilityFields = {
  /** Firmware-enforced nozzle temperature ceiling in deg C. K2 Plus: 350. */
  maxNozzleTempC?: number
  /** Firmware-enforced bed temperature ceiling in deg C. K2 Plus: 120. */
  maxBedTempC?: number
  /**
   * Heated-build-chamber target in deg C. Absent means "no heated chamber".
   */
  chamberTempC?: number
}

/** One heat-target command parsed from the gcode stream. */
export type GcodeTempSample = {
  /** 1-based line number in the source G-code. */
  lineNumber: number
  /**
   * The source command extracted (uppercase). The M-commands use an
   * S-word payload; `SET_HEATER_TEMPERATURE` is the Klipper extended
   * macro form `HEATER=<name> TARGET=<celsius>` (see [ID-0071] for
   * chamber, [ID-0077] for extruder / extruder<N> / heater_bed).
   */
  command: 'M104' | 'M109' | 'M140' | 'M190' | 'M141' | 'M191' | 'SET_HEATER_TEMPERATURE'
  /**
   * Whether the command targets a nozzle (M104/M109 or Klipper
   * `HEATER=extruder` / `HEATER=extruder<N>`), the bed (M140/M190 or
   * Klipper `HEATER=heater_bed`), or the heated chamber (M141 set-target
   * + M191 wait-for-chamber from PrusaSlicer/Orca/Marlin, or the Klipper
   * `SET_HEATER_TEMPERATURE HEATER=chamber` macro). M141 and M191 share
   * the chamber-kind routing (see [ID-0079]). Klipper canonical heater
   * names are recognized exactly (case-folded); custom
   * `[heater_generic <name>]` sections and substring near-matches like
   * `chamber_fan` / `extruder_fan` / `heater_bed_x` are intentionally
   * skipped (see [ID-0077] substring-defense tests).
   */
  kind: 'nozzle' | 'bed' | 'chamber'
  /** Target temperature in deg C (the S-word value, or TARGET= value). */
  targetC: number
  /**
   * Tool index from an optional T-word (M104/M109) or from the digit
   * suffix of `HEATER=extruder<N>` ([ID-0077]). Bare `HEATER=extruder`
   * emits no `tool` field to mirror `M104 S210` (no T-word) semantics.
   * Undefined when absent.
   */
  tool?: number
  /**
   * Original (trimmed, comment-stripped) source line, preserved so callers
   * can surface it verbatim in an operator-facing error message.
   */
  raw: string
}

/** A single sample whose target exceeds the machine ceiling. */
export type GcodeTempViolation = {
  sample: GcodeTempSample
  /** The ceiling that was violated (in deg C). */
  ceilingC: number
  /** Which ceiling was violated. Matches `sample.kind`. */
  kind: 'nozzle' | 'bed' | 'chamber'
  /** Pre-formatted operator-facing message. */
  message: string
}

/** Result of validating a set of samples against a capability set. */
export type GcodeTempValidationResult = {
  /** True when there are zero violations. */
  ok: boolean
  /** Every violation in source-order. Empty when `ok`. */
  violations: GcodeTempViolation[]
  /**
   * Every parsed sample in source-order, regardless of whether it
   * violated a ceiling. Useful for diagnostics and pre-flight previews.
   */
  samples: GcodeTempSample[]
}

/**
 * Strip an inline `;` comment from a line and return the trimmed remainder.
 * Also trims a leading `%` tape marker's companion whitespace.
 *
 * Note: G-code parenthetical comments `(...)` are valid in FDM slicer output
 * too (PrusaSlicer / OrcaSlicer emit them), so we also strip those.
 */
function stripGcodeComment(line: string): string {
  let result = line.replace(/\([^)]*\)/g, '')
  const semi = result.indexOf(';')
  if (semi >= 0) result = result.substring(0, semi)
  return result.trim()
}

/**
 * Extract an `<Word><number>` value from a G-code line after comments have
 * been stripped. Accepts integer or decimal payloads; returns `undefined`
 * if the word is absent or the payload is non-numeric.
 *
 * Matches case-insensitively so lowercase slicers (e.g. `m104 s210`) parse
 * the same as uppercase. The word boundary guard prevents `S210` from
 * being picked up by a request for `X` etc.
 */
function extractWord(stripped: string, word: 'S' | 'T'): number | undefined {
  // Word must be followed by an optional sign and a numeric payload, then a
  // word-break (space, end-of-string, or another letter). `\b` is sufficient
  // because the payload is digits/dot.
  const re = new RegExp(`(?:^|\\s)${word}(-?\\d+(?:\\.\\d+)?)(?=\\s|$|[A-Za-z])`, 'i')
  const m = stripped.match(re)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

/**
 * Extract a Klipper-style `KEY=VALUE` parameter from an extended command
 * line. Klipper macros like `SET_HEATER_TEMPERATURE` separate parameters
 * with whitespace and always use `KEY=VALUE` pairs (never bare words).
 *
 * The match is case-insensitive on the key so `HEATER=`, `heater=`, and
 * `Heater=` all work. Values are returned verbatim; the caller is
 * responsible for case-folding identifier values or numeric-parsing
 * numeric ones. Leading/trailing whitespace around the value is
 * impossible because Klipper tokenizes on whitespace, so the value is
 * everything from `=` to the next whitespace or end-of-line.
 *
 * Guarded against accidentally matching the `HEATER` inside
 * `SET_HEATER_TEMPERATURE` itself: the `(?:^|\s)` alternation requires
 * the key to follow whitespace or line-start, and the `=` after the key
 * is never present in the command name.
 */
function extractKlipperParam(stripped: string, key: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`, 'i')
  const m = stripped.match(re)
  return m ? m[1] : undefined
}

/**
 * Parse every M104/M109/M140/M190/M141/M191 sample and every
 * `SET_HEATER_TEMPERATURE HEATER=<name> TARGET=<n>` Klipper macro out of
 * a G-code string. M191 (wait-for-chamber, [ID-0079]) shares the chamber
 * kind and `chamberTempC` ceiling with M141 so a hand-edited gcode that
 * bumps one but not the other still trips the higher target. The parse
 * is deliberately tolerant: lowercase commands are accepted; leading
 * whitespace is ignored; inline `;` and `(...)` comments are stripped
 * before matching; lines missing an S-word (for M-commands) or a
 * TARGET= / HEATER= pair (for the Klipper macro) are silently skipped
 * (they are valid "query" forms on some firmwares and do not request a
 * new target). Line numbers are 1-based.
 *
 * [ID-0071]: original Klipper macro support recognized only
 * `HEATER=chamber` (case-insensitive match on the value); other heater
 * names (`extruder`, `heater_bed`, `extruder1`, ...) were intentionally
 * skipped so a future follow-up could broaden coverage without
 * re-shaping the sample type.
 *
 * [ID-0077]: that follow-up has now landed. The Klipper macro now also
 * recognizes `HEATER=extruder` (primary nozzle, T0 by Klipper
 * convention -- emitted with no `tool` field to mirror the bare
 * `M104 S210` semantics), `HEATER=extruder<N>` where `<N>` is one or
 * more digits (additional nozzles -- emitted with `tool=N`), and
 * `HEATER=heater_bed` (single heated bed -- emitted with `kind='bed'`
 * and no `tool` field). Anything else (custom `[heater_generic <name>]`
 * sections, `extruder_fan`, `heater_bed_x`, mis-spellings, ...) is
 * still skipped so substring-defense is preserved. See the Cycle 24
 * entry in `.claude/improvement-log.md` for the full rationale and the
 * bundled K2 Plus cross-check tests.
 */
export function parseGcodeTempCommands(gcode: string): GcodeTempSample[] {
  if (typeof gcode !== 'string' || gcode.length === 0) return []
  const samples: GcodeTempSample[] = []
  const lines = gcode.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const stripped = stripGcodeComment(raw)
    if (stripped.length === 0) continue

    // Branch 1: Klipper `SET_HEATER_TEMPERATURE HEATER=<name> TARGET=<n>`
    // extended macro. Anchored at line-start (after whitespace strip)
    // so a mid-line occurrence of the token never produces a sample.
    const klipperMatch = stripped.match(/^\s*SET_HEATER_TEMPERATURE\b/i)
    if (klipperMatch) {
      const heater = extractKlipperParam(stripped, 'HEATER')
      const targetStr = extractKlipperParam(stripped, 'TARGET')
      if (heater == null || targetStr == null) continue
      const target = Number(targetStr)
      if (!Number.isFinite(target)) continue
      // [ID-0071] / [ID-0077] heater-name routing. Case-fold on the
      // value (Klipper itself is case-sensitive on heater names defined
      // in printer.cfg but in practice chamber/extruder/heater_bed are
      // the canonical Klipper names; accept any case to be
      // operator-friendly). Substring defense: only EXACT matches on
      // the canonical names (or `extruder<digits>` for additional
      // tools) emit samples; `chamber_fan`, `extruder_fan`,
      // `heater_bed_x`, custom `[heater_generic <name>]` sections, etc.
      // are intentionally skipped.
      const heaterLower = heater.toLowerCase()
      let kind: 'nozzle' | 'bed' | 'chamber'
      let klipperTool: number | undefined
      if (heaterLower === 'chamber') {
        kind = 'chamber'
      } else if (heaterLower === 'heater_bed') {
        kind = 'bed'
      } else if (heaterLower === 'extruder') {
        // Bare `extruder` is Klipper's name for the primary nozzle. We
        // intentionally emit no `tool` field to mirror `M104 S210`
        // semantics: the absence of a T-word means "the active tool",
        // not "T0 explicitly". This keeps validator-side behavior
        // byte-identical between equivalent `M104 S210` and
        // `SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210` lines.
        kind = 'nozzle'
      } else {
        const extruderMatch = heaterLower.match(/^extruder(\d+)$/)
        if (!extruderMatch) continue
        kind = 'nozzle'
        const idx = Number(extruderMatch[1])
        if (Number.isInteger(idx) && idx >= 0) klipperTool = idx
      }
      const sample: GcodeTempSample = {
        lineNumber: i + 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind,
        targetC: target,
        raw: stripped,
      }
      if (klipperTool != null) sample.tool = klipperTool
      samples.push(sample)
      continue
    }

    // Branch 2: classic M-command with S-word payload. M141 sets a
    // chamber-temp TARGET (non-blocking) and M191 BLOCKS until the
    // chamber reaches the requested temp ([ID-0079]); both are emitted
    // by PrusaSlicer / Orca / Marlin for printers with a heated build
    // volume and both share the chamber kind + `chamberTempC` ceiling.
    // M104/M109 target the nozzle and M140/M190 target the bed.
    const cmdMatch = stripped.match(/^\s*M(104|109|140|141|190|191)\b/i)
    if (!cmdMatch) continue
    const targetC = extractWord(stripped, 'S')
    if (targetC == null) continue
    const num = cmdMatch[1] as '104' | '109' | '140' | '141' | '190' | '191'
    const command = (`M${num}` as GcodeTempSample['command'])
    let kind: 'nozzle' | 'bed' | 'chamber'
    if (num === '141' || num === '191') kind = 'chamber'
    else if (num === '140' || num === '190') kind = 'bed'
    else kind = 'nozzle'
    const tool = kind === 'nozzle' ? extractWord(stripped, 'T') : undefined
    const sample: GcodeTempSample = {
      lineNumber: i + 1,
      command,
      kind,
      targetC,
      raw: stripped,
    }
    if (tool != null && Number.isInteger(tool) && tool >= 0) sample.tool = tool
    samples.push(sample)
  }
  return samples
}

/**
 * Cross-check a parsed sample set against a machine profile's FDM
 * capability ceilings. Samples whose target temperature exceeds the
 * relevant ceiling are flagged as violations; samples AT the ceiling
 * pass (firmware allows equality). An unset ceiling -- or a non-finite /
 * non-positive one -- is treated as "no ceiling declared" and never
 * produces a violation.
 *
 * The validator is pure: it does no I/O and never throws on malformed
 * inputs (a non-array `samples` and a null / undefined `caps` both
 * return `{ ok: true, violations: [], samples: [] }`).
 */
export function validateGcodeTemps(
  samples: readonly GcodeTempSample[],
  caps: FdmCapabilityFields | null | undefined
): GcodeTempValidationResult {
  const outSamples = Array.isArray(samples) ? [...samples] : []
  if (caps == null) return { ok: true, violations: [], samples: outSamples }

  const nozzleCeiling =
    typeof caps.maxNozzleTempC === 'number' && Number.isFinite(caps.maxNozzleTempC) && caps.maxNozzleTempC > 0
      ? caps.maxNozzleTempC
      : undefined
  const bedCeiling =
    typeof caps.maxBedTempC === 'number' && Number.isFinite(caps.maxBedTempC) && caps.maxBedTempC > 0
      ? caps.maxBedTempC
      : undefined
  // [ID-0071]: chamberTempC on FdmCapabilityFields is the heated-chamber
  // TARGET (the temperature the operator wants the enclosure at during
  // the print), not a firmware ceiling. The K2 Plus firmware accepts
  // `M141 S<n>` up to the `max_temp` declared in its `[heater_generic
  // chamber]` Klipper section -- historically that's the same value
  // used for the print target, so treating `chamberTempC` as the
  // validator ceiling is a safe conservative default: a job that tries
  // to heat the enclosure past the configured print target is more
  // likely a bad slicer export than an operator intent, and equality
  // still passes (firmware allows temp at ceiling).
  const chamberCeiling =
    typeof caps.chamberTempC === 'number' && Number.isFinite(caps.chamberTempC) && caps.chamberTempC > 0
      ? caps.chamberTempC
      : undefined

  if (nozzleCeiling == null && bedCeiling == null && chamberCeiling == null) {
    return { ok: true, violations: [], samples: outSamples }
  }

  const violations: GcodeTempViolation[] = []
  for (const s of outSamples) {
    let ceiling: number | undefined
    if (s.kind === 'nozzle') ceiling = nozzleCeiling
    else if (s.kind === 'bed') ceiling = bedCeiling
    else if (s.kind === 'chamber') ceiling = chamberCeiling
    if (ceiling == null) continue
    if (s.targetC <= ceiling) continue
    const toolPart = s.tool != null ? ` (T${s.tool})` : ''
    const message =
      `Line ${s.lineNumber}: ${s.command}${toolPart} requests ${s.targetC} C, ` +
      `which exceeds the ${s.kind} ceiling of ${ceiling} C declared by the machine profile.`
    violations.push({ sample: s, ceilingC: ceiling, kind: s.kind, message })
  }
  return { ok: violations.length === 0, violations, samples: outSamples }
}

/**
 * Convenience wrapper: parse a G-code string and immediately validate it
 * against a capability set. Equivalent to
 * `validateGcodeTemps(parseGcodeTempCommands(gcode), caps)`.
 */
export function validateGcodeFileTemps(
  gcode: string,
  caps: FdmCapabilityFields | null | undefined
): GcodeTempValidationResult {
  const samples = parseGcodeTempCommands(gcode)
  return validateGcodeTemps(samples, caps)
}

/**
 * Summarize a validation result into a single operator-facing line. Used
 * by the Moonraker push path to populate the `error` / `detail` fields
 * of `MoonrakerPushResult` when pre-upload validation fails.
 *
 * When there are no violations, returns `null` so callers can test for
 * the "happy path" cheaply (`if (summary) fail(summary)`).
 */
export function summarizeTempViolations(result: GcodeTempValidationResult): string | null {
  if (result.ok || result.violations.length === 0) return null
  const n = result.violations.length
  const first = result.violations[0]
  if (n === 1) return first.message
  return `${first.message} (+${n - 1} more violation${n - 1 === 1 ? '' : 's'})`
}
