/**
 * gcode-temp-validator-pin.test.ts -- [ID-0278] Cycle 206 post-processing paired-pin
 *
 * Pins the contract of `src/shared/gcode-temp-validator.ts` -- the
 * pre-upload G-code temperature validator that gates Moonraker uploads
 * for the Creality K2 Plus FDM target machine. Every job pushed to the
 * K2 Plus over the Klipper/Moonraker bridge passes through this layer
 * BEFORE the multipart upload so out-of-envelope nozzle / bed / chamber
 * targets are caught operator-side instead of silently capping firmware-
 * side mid-print.
 *
 * Production call-sites (verified at landing):
 *   - `src/main/moonraker-push.ts:27` -- Moonraker upload bridge imports
 *     `validateGcodeFileTemps` + `summarizeTempViolations` and short-
 *     circuits the multipart push when the validation fails. THIS is
 *     the load-bearing K2 Plus integration; the pin file protects it
 *     against silent regressions.
 *   - `src/main/ipc-fabrication.ts:27` -- IPC pipe surfaces
 *     `GcodeTempSample` to the renderer.
 *   - `src/preload/index.ts:14` -- preload bridge re-exports
 *     `GcodeTempSample`.
 *   - `src/renderer/src/moonraker-push-payload.ts:34` -- payload builder
 *     consumes `GcodeTempSample`.
 *   - `src/renderer/src/MoonrakerPreviewBanner.tsx:35` -- preview banner
 *     consumes `GcodeTempSample`.
 *   - `src/renderer/src/ShopApp.tsx:32` -- ShopApp consumes
 *     `GcodeTempSample`.
 *   - `src/shared/fdm-temp-preview.ts:35` -- FDM temp preview consumes
 *     `GcodeTempSample`.
 *
 * Companion behavioral file: `gcode-temp-validator.test.ts` (1273 lines).
 * This pin file extends coverage to lock the CONTRACT surface the
 * call-sites depend on -- module shape, exports, signature shapes, the
 * sample-type discriminated union (M104/M109/M140/M190/M141/M191 +
 * SET_HEATER_TEMPERATURE), the kind routing (nozzle/bed/chamber), the
 * substring-defense invariant (no false-positive on `chamber_fan` /
 * `extruder_fan` / `heater_bed_x`), the line-number 1-based invariant,
 * the comment-strip contract (`;` and `(...)`), the "no ceiling => no
 * violation" pass-through, the equality-passes-ceiling invariant, and
 * the pure-function (non-mutating) invariant on the input samples
 * array.
 *
 * Three-machine relevance:
 *   - **Creality K2 Plus** (DIRECT): every Moonraker push validates
 *     against `maxNozzleTempC` (350 C K2 Plus spec ceiling),
 *     `maxBedTempC` (120 C K2 Plus spec), and `chamberTempC` (the
 *     enclosure heater target derived from the slicer profile via
 *     `[ID-0071]` chamber routing, also gating M191
 *     wait-for-chamber per `[ID-0079]`).
 *   - **Laguna Swift 5x10**, **Makera Carvera 3-axis / 4-axis Rotary**
 *     (INDIRECT): CNC machines do not push G-code through Moonraker and
 *     the validator is short-circuited by `caps == null` (no FDM caps).
 *     The pin asserts this short-circuit so a future CNC-side mis-wiring
 *     does not start emitting "violation" noise on RichAuto / Makera
 *     Controller G-code that legitimately omits temperature commands.
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file
 * authors tests only. The validator itself is read-only with respect to
 * G-code; this pin asserts that read-only invariant. No production-G-
 * code edits, no machine-profile edits, no .hbs template edits, no
 * Python engine edits, no schema edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './gcode-temp-validator'
import {
  parseGcodeTempCommands,
  validateGcodeTemps,
  validateGcodeFileTemps,
  summarizeTempViolations,
  type GcodeTempSample,
  type GcodeTempViolation,
  type GcodeTempValidationResult,
  type FdmCapabilityFields
} from './gcode-temp-validator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read source for whitelist pins. */
const SRC_PATH = resolvePath(__dirname, 'gcode-temp-validator.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/** K2 Plus spec ceilings per CLAUDE.md USER CONTEXT. */
const K2_CAPS: FdmCapabilityFields = {
  maxNozzleTempC: 350,
  maxBedTempC: 120,
  chamberTempC: 60
}

const SAMPLE_KEYS = ['lineNumber', 'command', 'kind', 'targetC', 'raw'] as const
const VIOLATION_KEYS = ['sample', 'ceilingC', 'kind', 'message'] as const
const RESULT_KEYS = ['ok', 'violations', 'samples'] as const

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. gcode-temp-validator -- module shape', () => {
  it('exports parseGcodeTempCommands as a function', () => {
    expect(typeof Mod.parseGcodeTempCommands).toBe('function')
  })

  it('exports validateGcodeTemps as a function', () => {
    expect(typeof Mod.validateGcodeTemps).toBe('function')
  })

  it('exports validateGcodeFileTemps as a function', () => {
    expect(typeof Mod.validateGcodeFileTemps).toBe('function')
  })

  it('exports summarizeTempViolations as a function', () => {
    expect(typeof Mod.summarizeTempViolations).toBe('function')
  })

  it('does not export a default', () => {
    expect((Mod as Record<string, unknown>)['default']).toBeUndefined()
  })

  it('exposes exactly 4 runtime exports (functions only)', () => {
    const valueExports = Object.keys(Mod).filter(
      (k) => typeof (Mod as Record<string, unknown>)[k] !== 'undefined'
    )
    expect(valueExports).toHaveLength(4)
    expect(new Set(valueExports)).toEqual(
      new Set([
        'parseGcodeTempCommands',
        'validateGcodeTemps',
        'validateGcodeFileTemps',
        'summarizeTempViolations'
      ])
    )
  })

  it('parseGcodeTempCommands signature: arity 1', () => {
    expect(parseGcodeTempCommands.length).toBe(1)
  })

  it('validateGcodeTemps signature: arity 2', () => {
    expect(validateGcodeTemps.length).toBe(2)
  })

  it('validateGcodeFileTemps signature: arity 2', () => {
    expect(validateGcodeFileTemps.length).toBe(2)
  })

  it('summarizeTempViolations signature: arity 1', () => {
    expect(summarizeTempViolations.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// B. parseGcodeTempCommands -- input degeneracy
// ---------------------------------------------------------------------------
describe('B. parseGcodeTempCommands -- input degeneracy', () => {
  it('returns [] for empty string', () => {
    expect(parseGcodeTempCommands('')).toEqual([])
  })

  it('returns [] for non-string input (defensive guard)', () => {
    // Production code path is type-safe but the runtime guard exists.
    expect(parseGcodeTempCommands(undefined as unknown as string)).toEqual([])
    expect(parseGcodeTempCommands(null as unknown as string)).toEqual([])
    expect(parseGcodeTempCommands(123 as unknown as string)).toEqual([])
  })

  it('returns [] for whitespace-only input', () => {
    expect(parseGcodeTempCommands('   \n\n  \r\n  ')).toEqual([])
  })

  it('returns [] for a stream of comments and blanks', () => {
    expect(parseGcodeTempCommands(';only a comment\n;another\n(parens)\n')).toEqual([])
  })

  it('returns [] for unrelated G-code (G0/G1/M3/M5/M30)', () => {
    expect(
      parseGcodeTempCommands(
        ['G21', 'G90', 'G0 Z5', 'G1 X10 Y10 F1500', 'M3 S18000', 'M5', 'M30'].join('\n')
      )
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// C. parseGcodeTempCommands -- M-command parsing
// ---------------------------------------------------------------------------
describe('C. parseGcodeTempCommands -- M-command parsing', () => {
  it('parses M104 nozzle target', () => {
    const out = parseGcodeTempCommands('M104 S210')
    expect(out).toHaveLength(1)
    expect(out[0].command).toBe('M104')
    expect(out[0].kind).toBe('nozzle')
    expect(out[0].targetC).toBe(210)
    expect(out[0].lineNumber).toBe(1)
  })

  it('parses M109 nozzle target (wait)', () => {
    expect(parseGcodeTempCommands('M109 S225')[0].command).toBe('M109')
  })

  it('parses M140 bed target', () => {
    const s = parseGcodeTempCommands('M140 S60')[0]
    expect(s.command).toBe('M140')
    expect(s.kind).toBe('bed')
    expect(s.targetC).toBe(60)
  })

  it('parses M190 bed target (wait)', () => {
    expect(parseGcodeTempCommands('M190 S60')[0].command).toBe('M190')
  })

  it('parses M141 chamber target', () => {
    const s = parseGcodeTempCommands('M141 S55')[0]
    expect(s.kind).toBe('chamber')
    expect(s.command).toBe('M141')
  })

  it('parses M191 chamber wait (shares kind=chamber per [ID-0079])', () => {
    const s = parseGcodeTempCommands('M191 S55')[0]
    expect(s.kind).toBe('chamber')
    expect(s.command).toBe('M191')
  })

  it('honors T-word on nozzle commands', () => {
    const s = parseGcodeTempCommands('M104 S210 T1')[0]
    expect(s.tool).toBe(1)
  })

  it('omits tool field when T-word is absent on nozzle command', () => {
    const s = parseGcodeTempCommands('M104 S210')[0]
    expect(s.tool).toBeUndefined()
  })

  it('omits tool field on bed/chamber commands even if T-word present', () => {
    const s = parseGcodeTempCommands('M140 S60 T0')[0]
    expect(s.tool).toBeUndefined()
  })

  it('accepts lowercase M-commands', () => {
    expect(parseGcodeTempCommands('m104 s210')[0].command).toBe('M104')
  })

  it('strips inline `;` comments before parsing', () => {
    const s = parseGcodeTempCommands('M104 S210 ; warm up nozzle')[0]
    expect(s.targetC).toBe(210)
    expect(s.raw).not.toContain(';')
  })

  it('strips parenthetical `(...)` comments before parsing', () => {
    const s = parseGcodeTempCommands('M140 (heat bed) S60')[0]
    expect(s.targetC).toBe(60)
    expect(s.raw).not.toContain('(')
  })

  it('skips M-commands missing an S-word (query form)', () => {
    expect(parseGcodeTempCommands('M104')).toEqual([])
    expect(parseGcodeTempCommands('M109')).toEqual([])
  })

  it('preserves 1-based line numbers across blank lines and comments', () => {
    const gcode = [';c1', '', 'M104 S210', ';c4', 'M140 S60', '', 'M141 S55'].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples.map((s) => s.lineNumber)).toEqual([3, 5, 7])
  })

  it('parses decimal target temperatures', () => {
    expect(parseGcodeTempCommands('M104 S210.5')[0].targetC).toBe(210.5)
  })

  it('does not parse M105 (report-temp), M106 (fan), M107', () => {
    expect(parseGcodeTempCommands('M105')).toEqual([])
    expect(parseGcodeTempCommands('M106 S255')).toEqual([])
    expect(parseGcodeTempCommands('M107')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D. parseGcodeTempCommands -- Klipper SET_HEATER_TEMPERATURE
// ---------------------------------------------------------------------------
describe('D. parseGcodeTempCommands -- Klipper macro', () => {
  it('parses HEATER=chamber TARGET=60 as kind=chamber', () => {
    const s = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60')[0]
    expect(s.command).toBe('SET_HEATER_TEMPERATURE')
    expect(s.kind).toBe('chamber')
    expect(s.targetC).toBe(60)
  })

  it('parses HEATER=heater_bed TARGET=80 as kind=bed', () => {
    const s = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=80')[0]
    expect(s.kind).toBe('bed')
    expect(s.targetC).toBe(80)
  })

  it('parses HEATER=extruder TARGET=210 as kind=nozzle (no tool field)', () => {
    const s = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210')[0]
    expect(s.kind).toBe('nozzle')
    expect(s.tool).toBeUndefined()
  })

  it('parses HEATER=extruder1 as kind=nozzle with tool=1', () => {
    const s = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=215')[0]
    expect(s.kind).toBe('nozzle')
    expect(s.tool).toBe(1)
  })

  it('parses HEATER=extruder0 as kind=nozzle with tool=0 (multi-digit allowed)', () => {
    const s = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder0 TARGET=215')[0]
    expect(s.kind).toBe('nozzle')
    expect(s.tool).toBe(0)
  })

  it('case-folds HEATER value (heater_bed / Heater_Bed / HEATER_BED)', () => {
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=Heater_Bed TARGET=80')[0].kind
    ).toBe('bed')
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE heater=HEATER_BED target=80')[0].kind
    ).toBe('bed')
  })

  it('substring defense: HEATER=chamber_fan is silently skipped', () => {
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber_fan TARGET=60')
    ).toEqual([])
  })

  it('substring defense: HEATER=extruder_fan is silently skipped', () => {
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder_fan TARGET=210')
    ).toEqual([])
  })

  it('substring defense: HEATER=heater_bed_x is silently skipped', () => {
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed_x TARGET=80')
    ).toEqual([])
  })

  it('substring defense: HEATER=extruder_x is silently skipped (not extruder<digits>)', () => {
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder_x TARGET=215')
    ).toEqual([])
  })

  it('skips Klipper macro missing HEATER=', () => {
    expect(parseGcodeTempCommands('SET_HEATER_TEMPERATURE TARGET=60')).toEqual([])
  })

  it('skips Klipper macro missing TARGET=', () => {
    expect(parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber')).toEqual([])
  })

  it('skips non-numeric TARGET=', () => {
    expect(
      parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=abc')
    ).toEqual([])
  })

  it('Klipper macro must be at line-start (after whitespace) -- mid-line occurrences ignored', () => {
    expect(
      parseGcodeTempCommands('; do not SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60')
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// E. parseGcodeTempCommands -- mixed streams (realistic K2 slicer output)
// ---------------------------------------------------------------------------
describe('E. parseGcodeTempCommands -- realistic slicer streams', () => {
  it('parses a typical PrusaSlicer header for K2 (M104+M140+M141+M191+M109+M190)', () => {
    const gcode = [
      ';TYPE: Custom',
      'M104 S205 ; nozzle pre-warm',
      'M140 S60 ; bed pre-warm',
      'M141 S55 ; chamber set',
      'M191 S55 ; chamber wait',
      'M109 S205 ; nozzle wait',
      'M190 S60 ; bed wait'
    ].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples.map((s) => s.command)).toEqual(['M104', 'M140', 'M141', 'M191', 'M109', 'M190'])
    expect(samples.map((s) => s.kind)).toEqual(['nozzle', 'bed', 'chamber', 'chamber', 'nozzle', 'bed'])
  })

  it('parses a Klipper-native K2 stream (SET_HEATER_TEMPERATURE family)', () => {
    const gcode = [
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=205',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=55'
    ].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(3)
    expect(samples.map((s) => s.kind)).toEqual(['nozzle', 'bed', 'chamber'])
    expect(samples.map((s) => s.targetC)).toEqual([205, 60, 55])
  })

  it('preserves source-order across mixed M-command + Klipper macro stream', () => {
    const gcode = [
      'M104 S210',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60',
      'M141 S55'
    ].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples.map((s) => s.lineNumber)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// F. validateGcodeTemps -- result shape & null caps short-circuit
// ---------------------------------------------------------------------------
describe('F. validateGcodeTemps -- shape & null caps', () => {
  it('returns the exact 3-key result shape', () => {
    const r = validateGcodeTemps([], K2_CAPS)
    expect(Object.keys(r).sort()).toEqual([...RESULT_KEYS].sort())
  })

  it('null caps short-circuits to ok=true / no violations', () => {
    const samples = parseGcodeTempCommands('M104 S999')
    expect(samples).toHaveLength(1)
    const r = validateGcodeTemps(samples, null)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.samples).toEqual(samples)
  })

  it('undefined caps short-circuits to ok=true / no violations (CNC integration safety)', () => {
    const samples = parseGcodeTempCommands('M104 S999')
    const r = validateGcodeTemps(samples, undefined)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('caps with all-undefined ceilings short-circuits to ok=true', () => {
    const r = validateGcodeTemps(parseGcodeTempCommands('M104 S999'), {})
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('caps with non-finite or non-positive ceilings are treated as unset', () => {
    const r1 = validateGcodeTemps(parseGcodeTempCommands('M104 S999'), {
      maxNozzleTempC: NaN,
      maxBedTempC: -50,
      chamberTempC: 0
    })
    expect(r1.ok).toBe(true)
    expect(r1.violations).toEqual([])
  })

  it('non-array samples input returns ok=true with samples=[]', () => {
    const r = validateGcodeTemps(undefined as unknown as GcodeTempSample[], K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.samples).toEqual([])
  })

  it('result.samples is a fresh copy of the input (defensive against external mutation)', () => {
    const samples = parseGcodeTempCommands('M104 S210')
    const r = validateGcodeTemps(samples, K2_CAPS)
    expect(r.samples).not.toBe(samples)
    expect(r.samples).toEqual(samples)
  })
})

// ---------------------------------------------------------------------------
// G. validateGcodeTemps -- ceiling enforcement
// ---------------------------------------------------------------------------
describe('G. validateGcodeTemps -- ceiling enforcement', () => {
  it('flags M104 S360 against K2 350 C nozzle ceiling', () => {
    const r = validateGcodeFileTemps('M104 S360', K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('nozzle')
    expect(r.violations[0].ceilingC).toBe(350)
  })

  it('flags M140 S130 against K2 120 C bed ceiling', () => {
    const r = validateGcodeFileTemps('M140 S130', K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations[0].kind).toBe('bed')
    expect(r.violations[0].ceilingC).toBe(120)
  })

  it('flags M141 S70 against K2 60 C chamber ceiling', () => {
    const r = validateGcodeFileTemps('M141 S70', K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].ceilingC).toBe(60)
  })

  it('flags M191 S70 against K2 60 C chamber ceiling (shared with M141 per [ID-0079])', () => {
    const r = validateGcodeFileTemps('M191 S70', K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations[0].kind).toBe('chamber')
  })

  it('passes a sample exactly at the ceiling (firmware allows equality)', () => {
    const r = validateGcodeFileTemps('M104 S350\nM140 S120\nM141 S60', K2_CAPS)
    expect(r.ok).toBe(true)
  })

  it('passes a sample just below the ceiling', () => {
    const r = validateGcodeFileTemps('M104 S349.99', K2_CAPS)
    expect(r.ok).toBe(true)
  })

  it('reports violations in source-order', () => {
    const gcode = ['M104 S360', 'M140 S130', 'M141 S70'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.violations).toHaveLength(3)
    expect(r.violations.map((v) => v.kind)).toEqual(['nozzle', 'bed', 'chamber'])
  })

  it('violation message includes line number, command, target, kind, ceiling', () => {
    const r = validateGcodeFileTemps('M104 S360', K2_CAPS)
    const m = r.violations[0].message
    expect(m).toContain('Line 1')
    expect(m).toContain('M104')
    expect(m).toContain('360')
    expect(m).toContain('nozzle')
    expect(m).toContain('350')
  })

  it('violation message annotates T-word as " (T<n>)" when present', () => {
    const r = validateGcodeFileTemps('M104 S360 T1', K2_CAPS)
    expect(r.violations[0].message).toContain('(T1)')
  })

  it('violation message omits T-annotation when tool absent', () => {
    const r = validateGcodeFileTemps('M104 S360', K2_CAPS)
    expect(r.violations[0].message).not.toMatch(/\(T\d+\)/)
  })

  it('Klipper SET_HEATER_TEMPERATURE HEATER=extruder TARGET=360 is flagged at the same nozzle ceiling', () => {
    const r = validateGcodeFileTemps(
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=360',
      K2_CAPS
    )
    expect(r.ok).toBe(false)
    expect(r.violations[0].kind).toBe('nozzle')
  })

  it('only the violating kind triggers when its ceiling is set; others pass through', () => {
    const r = validateGcodeFileTemps('M104 S360\nM140 S60\nM141 S55', {
      maxNozzleTempC: 350
    })
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('nozzle')
  })
})

// ---------------------------------------------------------------------------
// H. validateGcodeFileTemps -- convenience wrapper
// ---------------------------------------------------------------------------
describe('H. validateGcodeFileTemps -- convenience wrapper', () => {
  it('is equivalent to validateGcodeTemps(parseGcodeTempCommands(gcode), caps)', () => {
    const gcode = 'M104 S360\nM140 S130'
    const a = validateGcodeFileTemps(gcode, K2_CAPS)
    const b = validateGcodeTemps(parseGcodeTempCommands(gcode), K2_CAPS)
    expect(a).toEqual(b)
  })

  it('handles empty gcode -> ok=true / empty violations / empty samples', () => {
    const r = validateGcodeFileTemps('', K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.samples).toEqual([])
  })

  it('handles null caps short-circuit even with violating gcode', () => {
    const r = validateGcodeFileTemps('M104 S999', null)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// I. summarizeTempViolations -- operator-facing message
// ---------------------------------------------------------------------------
describe('I. summarizeTempViolations -- operator message', () => {
  it('returns null when ok=true', () => {
    expect(summarizeTempViolations({ ok: true, violations: [], samples: [] })).toBeNull()
  })

  it('returns null when violations is empty even if ok is mistakenly false', () => {
    expect(summarizeTempViolations({ ok: false, violations: [], samples: [] })).toBeNull()
  })

  it('returns the first violation message verbatim when n=1', () => {
    const r = validateGcodeFileTemps('M104 S360', K2_CAPS)
    expect(summarizeTempViolations(r)).toBe(r.violations[0].message)
  })

  it('appends "(+N more violations)" when n>=2', () => {
    const r = validateGcodeFileTemps('M104 S360\nM140 S130\nM141 S70', K2_CAPS)
    expect(summarizeTempViolations(r)).toContain('(+2 more violations)')
  })

  it('appends "(+1 more violation)" (singular) when n=2', () => {
    const r = validateGcodeFileTemps('M104 S360\nM140 S130', K2_CAPS)
    expect(summarizeTempViolations(r)).toContain('(+1 more violation)')
    expect(summarizeTempViolations(r)).not.toContain('(+1 more violations)')
  })
})

// ---------------------------------------------------------------------------
// J. Pure-function invariants
// ---------------------------------------------------------------------------
describe('J. pure-function invariants', () => {
  it('parseGcodeTempCommands is deterministic for identical input', () => {
    const g = 'M104 S210\nM140 S60'
    expect(parseGcodeTempCommands(g)).toEqual(parseGcodeTempCommands(g))
  })

  it('validateGcodeTemps does not mutate the samples array passed in', () => {
    const samples = parseGcodeTempCommands('M104 S360')
    const before = JSON.stringify(samples)
    validateGcodeTemps(samples, K2_CAPS)
    expect(JSON.stringify(samples)).toBe(before)
  })

  it('validateGcodeTemps does not mutate the caps object passed in', () => {
    const caps = { ...K2_CAPS }
    const before = JSON.stringify(caps)
    validateGcodeTemps(parseGcodeTempCommands('M104 S360'), caps)
    expect(JSON.stringify(caps)).toBe(before)
  })

  it('repeated calls return equal-but-distinct result objects', () => {
    const g = 'M104 S360'
    const a = validateGcodeFileTemps(g, K2_CAPS)
    const b = validateGcodeFileTemps(g, K2_CAPS)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('result.samples does not reference the same array as input samples (defensive copy)', () => {
    const samples = parseGcodeTempCommands('M104 S210')
    const r = validateGcodeTemps(samples, K2_CAPS)
    expect(r.samples).not.toBe(samples)
  })

  it('result.violations is always an Array (never null/undefined)', () => {
    expect(Array.isArray(validateGcodeFileTemps('', K2_CAPS).violations)).toBe(true)
    expect(Array.isArray(validateGcodeFileTemps('M104 S360', K2_CAPS).violations)).toBe(true)
    expect(Array.isArray(validateGcodeFileTemps('M104 S210', K2_CAPS).violations)).toBe(true)
  })

  it('summarizeTempViolations does not mutate the result', () => {
    const r = validateGcodeFileTemps('M104 S360', K2_CAPS)
    const before = JSON.stringify(r)
    summarizeTempViolations(r)
    expect(JSON.stringify(r)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// K. Three-machine path realism
// ---------------------------------------------------------------------------
describe('K. three-machine path realism', () => {
  it('K2 Plus realistic PETG profile (245/85/55) passes all three ceilings', () => {
    const gcode = ['M104 S245', 'M140 S85', 'M141 S55', 'M191 S55', 'M109 S245', 'M190 S85'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.samples).toHaveLength(6)
  })

  it('K2 Plus realistic PEEK profile (380 nozzle / 130 bed) trips both ceilings', () => {
    const r = validateGcodeFileTemps('M104 S380\nM140 S130', K2_CAPS)
    expect(r.violations).toHaveLength(2)
    expect(r.violations.map((v) => v.kind).sort()).toEqual(['bed', 'nozzle'])
  })

  it('Laguna Swift 5x10 CNC G-code (no temp commands) -> ok=true / empty samples', () => {
    const gcode = [
      '%',
      '(LAGUNA SWIFT 5X10)',
      'G21 G17 G90 G54',
      'M3 S18000',
      'G0 Z25',
      'G1 X100 F4500',
      'M5',
      'M30',
      '%'
    ].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.samples).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('Carvera 3-axis G-code (no temp commands) -> ok=true / empty samples', () => {
    const gcode = ['G21 G90 G17', 'M6 T1', 'G43 H1 Z25', 'M3 S15000', 'G1 X10 F800', 'M5', 'M30'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.samples).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('Carvera 4-axis rotary G-code (G0 A180 etc.) is also correctly empty', () => {
    const gcode = ['G21 G90 G17', 'G0 A180', 'G1 X10 A45 F500', 'M5', 'M30'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.samples).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('CNC machine with caps=null (no FDM ceilings declared) -> always ok regardless of accidental temp commands', () => {
    // Belt-and-braces guard: even if a CNC profile somehow leaked through with stray temp commands.
    const r = validateGcodeFileTemps('M104 S999\nM141 S999', null)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// L. Source-text whitelist
// ---------------------------------------------------------------------------
describe('L. gcode-temp-validator.ts source-text whitelist', () => {
  it('defines FdmCapabilityFields type inline (post-pivot, cura-slice-defaults removed)', () => {
    expect(SRC).toContain('export type FdmCapabilityFields = {')
  })

  it('declares the 4 documented exported function names', () => {
    for (const fn of [
      'parseGcodeTempCommands',
      'validateGcodeTemps',
      'validateGcodeFileTemps',
      'summarizeTempViolations'
    ]) {
      expect(SRC).toContain(`export function ${fn}`)
    }
  })

  it('declares the 3 documented exported types', () => {
    for (const t of ['GcodeTempSample', 'GcodeTempViolation', 'GcodeTempValidationResult']) {
      expect(SRC).toContain(`export type ${t}`)
    }
  })

  it('M-command regex covers exactly 104/109/140/141/190/191', () => {
    expect(SRC).toContain('M(104|109|140|141|190|191)')
  })

  it('chamber routing covers BOTH 141 and 191 per [ID-0079]', () => {
    expect(SRC).toContain("num === '141' || num === '191'")
  })

  it('Klipper macro routing covers chamber + heater_bed + extruder + extruder<digits>', () => {
    expect(SRC).toContain("heaterLower === 'chamber'")
    expect(SRC).toContain("heaterLower === 'heater_bed'")
    expect(SRC).toContain("heaterLower === 'extruder'")
    expect(SRC).toContain('^extruder(\\d+)$')
  })

  it('Klipper macro is anchored at line-start (no mid-line matches)', () => {
    expect(SRC).toContain('^\\s*SET_HEATER_TEMPERATURE\\b')
  })

  it('comment strip removes both `;` and `(...)`', () => {
    expect(SRC).toContain("result.indexOf(';')")
    expect(SRC).toContain('replace(/\\([^)]*\\)/g')
  })

  it('cites [ID-0070] [ID-0071] [ID-0077] [ID-0079] in module docstring', () => {
    expect(SRC).toContain('[ID-0070]')
    expect(SRC).toContain('[ID-0071]')
    expect(SRC).toContain('[ID-0077]')
    expect(SRC).toContain('[ID-0079]')
  })

  it('ceilings treated as unset when non-finite or non-positive', () => {
    expect(SRC).toContain('Number.isFinite(caps.maxNozzleTempC) && caps.maxNozzleTempC > 0')
    expect(SRC).toContain('Number.isFinite(caps.maxBedTempC) && caps.maxBedTempC > 0')
    expect(SRC).toContain('Number.isFinite(caps.chamberTempC) && caps.chamberTempC > 0')
  })

  it('equality-passes-ceiling: violation guard uses `<=` (not `<`)', () => {
    expect(SRC).toContain('s.targetC <= ceiling')
  })

  it('null/undefined caps short-circuits BEFORE ceiling extraction', () => {
    expect(SRC).toContain('if (caps == null) return { ok: true, violations: [], samples: outSamples }')
  })

  it('does NOT contain TODO / FIXME / XXX / HACK markers', () => {
    expect(SRC).not.toMatch(/\bTODO\b/)
    expect(SRC).not.toMatch(/\bFIXME\b/)
    expect(SRC).not.toMatch(/\bXXX\b/)
    expect(SRC).not.toMatch(/\bHACK\b/)
  })

  it('does NOT use `: any` or `as any`', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
  })

  it('docs Safety Rule 1 (G-code is sacred) read-only invariant', () => {
    expect(SRC).toContain('Safety Rule 1')
    expect(SRC).toContain('READ-ONLY')
  })
})

// ---------------------------------------------------------------------------
// M. Type-level parity (compile-time)
// ---------------------------------------------------------------------------
describe('M. type-level parity (compile-time)', () => {
  it('GcodeTempSample has the expected 5 declared keys (lineNumber, command, kind, targetC, raw)', () => {
    const s: GcodeTempSample = {
      lineNumber: 1,
      command: 'M104',
      kind: 'nozzle',
      targetC: 210,
      raw: 'M104 S210'
    }
    for (const k of SAMPLE_KEYS) {
      expect(k in s).toBe(true)
    }
  })

  it('GcodeTempSample.command is the exact 7-member union', () => {
    const valid: GcodeTempSample['command'][] = [
      'M104',
      'M109',
      'M140',
      'M190',
      'M141',
      'M191',
      'SET_HEATER_TEMPERATURE'
    ]
    expect(valid).toHaveLength(7)
  })

  it('GcodeTempSample.kind is the 3-member union nozzle|bed|chamber', () => {
    const valid: GcodeTempSample['kind'][] = ['nozzle', 'bed', 'chamber']
    expect(valid).toHaveLength(3)
  })

  it('GcodeTempViolation has the expected 4 keys (sample, ceilingC, kind, message)', () => {
    const v: GcodeTempViolation = {
      sample: { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 360, raw: 'M104 S360' },
      ceilingC: 350,
      kind: 'nozzle',
      message: 'x'
    }
    for (const k of VIOLATION_KEYS) {
      expect(k in v).toBe(true)
    }
  })

  it('GcodeTempValidationResult has exactly 3 keys (ok, violations, samples)', () => {
    const r: GcodeTempValidationResult = { ok: true, violations: [], samples: [] }
    for (const k of RESULT_KEYS) {
      expect(k in r).toBe(true)
    }
  })

  it('parseGcodeTempCommands return type is assignable to GcodeTempSample[]', () => {
    const out: GcodeTempSample[] = parseGcodeTempCommands('M104 S210')
    expect(out).toBeTruthy()
  })

  it('validateGcodeTemps return type is assignable to GcodeTempValidationResult', () => {
    const out: GcodeTempValidationResult = validateGcodeTemps([], K2_CAPS)
    expect(out).toBeTruthy()
  })
})
