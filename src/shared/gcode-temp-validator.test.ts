/**
 * Tests for the pre-upload G-code temperature validator.
 * Roadmap: [ID-0070].
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseGcodeTempCommands,
  validateGcodeTemps,
  validateGcodeFileTemps,
  summarizeTempViolations,
  type GcodeTempSample,
  type GcodeTempValidationResult,
  type FdmCapabilityFields,
} from './gcode-temp-validator'
import { machineProfileSchema } from './machine-schema'

// Tight K2 Plus capability fixture used across the over-ceiling paths.
const K2_CAPS: FdmCapabilityFields = {
  maxNozzleTempC: 350,
  maxBedTempC: 120,
  chamberTempC: 60,
}

describe('parseGcodeTempCommands [ID-0070]', () => {
  it('returns an empty array for empty input', () => {
    expect(parseGcodeTempCommands('')).toEqual([])
  })

  it('returns an empty array for non-string input', () => {
    // `any` would violate CLAUDE.md rule 3; use a cast to `unknown` then
    // back to the expected type so the defensive branch in the parser is
    // exercised without introducing `any` in the test source.
    const bogus = null as unknown as string
    expect(parseGcodeTempCommands(bogus)).toEqual([])
  })

  it('returns an empty array for gcode with no temp commands', () => {
    const gcode = 'G21\nG90\nG28\nG1 X10 Y10 F3000\nM400\nM84\n'
    expect(parseGcodeTempCommands(gcode)).toEqual([])
  })

  it('parses M104 nozzle target with S word', () => {
    const gcode = 'M104 S210\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0]).toEqual<GcodeTempSample>({
      lineNumber: 1,
      command: 'M104',
      kind: 'nozzle',
      targetC: 210,
      raw: 'M104 S210',
    })
  })

  it('parses M109 with T tool index', () => {
    const gcode = ';header\nM109 T1 S245\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('M109')
    expect(samples[0].kind).toBe('nozzle')
    expect(samples[0].targetC).toBe(245)
    expect(samples[0].tool).toBe(1)
    expect(samples[0].lineNumber).toBe(2)
  })

  it('parses M140 / M190 as bed kind', () => {
    const gcode = 'M140 S65\nM190 S70\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(2)
    expect(samples[0].command).toBe('M140')
    expect(samples[0].kind).toBe('bed')
    expect(samples[0].targetC).toBe(65)
    expect(samples[1].command).toBe('M190')
    expect(samples[1].kind).toBe('bed')
    expect(samples[1].targetC).toBe(70)
    // Bed commands never carry a tool index.
    expect(samples[0].tool).toBeUndefined()
    expect(samples[1].tool).toBeUndefined()
  })

  it('accepts lowercase commands and mixed case', () => {
    const gcode = 'm104 s200\nM109 s220\nm140 S55\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples.map(s => s.command)).toEqual(['M104', 'M109', 'M140'])
    expect(samples.map(s => s.targetC)).toEqual([200, 220, 55])
  })

  it('strips `;` comments before matching and skips commented-out lines', () => {
    const gcode = '; M104 S500 this is a comment, not a command\nM104 S210 ; set hotend\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(210)
    expect(samples[0].lineNumber).toBe(2)
  })

  it('strips parenthetical comments before matching', () => {
    const gcode = 'M104 (pre-heat) S215\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(215)
  })

  it('skips M-commands that are not temperature setters', () => {
    const gcode = 'M106 S255\nM107\nM84\nM104 S200\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('M104')
  })

  it('skips temp commands without an S word (valid "query" form)', () => {
    const gcode = 'M104\nM109\nM104 S200\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(200)
    expect(samples[0].lineNumber).toBe(3)
  })

  it('accepts decimal S values', () => {
    const gcode = 'M140 S55.5\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBeCloseTo(55.5, 6)
  })

  it('accepts S0 (heater off) as a valid sample', () => {
    const gcode = 'M104 S0\nM140 S0\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(2)
    expect(samples.every(s => s.targetC === 0)).toBe(true)
  })

  it('handles CRLF line endings', () => {
    const gcode = 'M104 S210\r\nM140 S60\r\n'
    const samples = parseGcodeTempCommands(gcode)
    expect(samples.map(s => s.lineNumber)).toEqual([1, 2])
    expect(samples[0].targetC).toBe(210)
    expect(samples[1].targetC).toBe(60)
  })

  it('does not mis-parse XYZE words as S/T', () => {
    // `X210` should NOT yield targetC=210, `T7` on a G1 should NOT leak
    // as a tool index because the command isn't M104/M109.
    const gcode = 'G1 X210 Y30 E1.2 F3000\nG1 T7 X10\n'
    expect(parseGcodeTempCommands(gcode)).toEqual([])
  })
})

describe('validateGcodeTemps [ID-0070]', () => {
  const samples: GcodeTempSample[] = [
    { lineNumber: 5, command: 'M104', kind: 'nozzle', targetC: 210, raw: 'M104 S210' },
    { lineNumber: 6, command: 'M140', kind: 'bed', targetC: 60, raw: 'M140 S60' },
  ]

  it('returns ok with zero violations when all samples are under ceiling', () => {
    const r = validateGcodeTemps(samples, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.samples).toHaveLength(2)
  })

  it('accepts samples exactly AT the ceiling (equality passes)', () => {
    const atCeiling: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M109', kind: 'nozzle', targetC: 350, raw: 'M109 S350' },
      { lineNumber: 2, command: 'M190', kind: 'bed', targetC: 120, raw: 'M190 S120' },
    ]
    const r = validateGcodeTemps(atCeiling, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('flags samples ABOVE the ceiling and leaves the rest untouched', () => {
    const mixed: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 400, raw: 'M104 S400' },
      { lineNumber: 2, command: 'M140', kind: 'bed', targetC: 60, raw: 'M140 S60' },
      { lineNumber: 3, command: 'M190', kind: 'bed', targetC: 150, raw: 'M190 S150' },
    ]
    const r = validateGcodeTemps(mixed, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(2)
    expect(r.violations[0].sample.command).toBe('M104')
    expect(r.violations[0].kind).toBe('nozzle')
    expect(r.violations[0].ceilingC).toBe(350)
    expect(r.violations[0].message).toMatch(/exceeds the nozzle ceiling of 350/)
    expect(r.violations[1].sample.command).toBe('M190')
    expect(r.violations[1].kind).toBe('bed')
    expect(r.violations[1].ceilingC).toBe(120)
  })

  it('passes through when caps is null / undefined / empty', () => {
    expect(validateGcodeTemps(samples, null).ok).toBe(true)
    expect(validateGcodeTemps(samples, undefined).ok).toBe(true)
    expect(validateGcodeTemps(samples, {}).ok).toBe(true)
    // Preserves the sample list on pass-through so diagnostic callers
    // can still render "here is what I saw" even when no ceilings apply.
    expect(validateGcodeTemps(samples, null).samples).toHaveLength(2)
  })

  it('treats non-positive or non-finite ceilings as "not declared"', () => {
    const bad: FdmCapabilityFields = { maxNozzleTempC: 0, maxBedTempC: Number.NaN }
    const hot: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 9_999, raw: '' },
      { lineNumber: 2, command: 'M140', kind: 'bed', targetC: 9_999, raw: '' },
    ]
    const r = validateGcodeTemps(hot, bad)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('emits tool index in the violation message when present', () => {
    const withTool: GcodeTempSample[] = [
      { lineNumber: 7, command: 'M109', kind: 'nozzle', targetC: 360, tool: 1, raw: 'M109 T1 S360' },
    ]
    const r = validateGcodeTemps(withTool, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations[0].message).toMatch(/M109 \(T1\) requests 360 C/)
  })

  it('does not mutate the input array', () => {
    const input: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 400, raw: 'M104 S400' },
    ]
    const snapshot = JSON.stringify(input)
    validateGcodeTemps(input, K2_CAPS)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('validateGcodeFileTemps end-to-end [ID-0070]', () => {
  it('accepts a realistic K2 Plus PLA gcode header under ceiling', () => {
    const gcode = [
      ';FLAVOR:Marlin',
      ';TIME:7200',
      ';Generated with Cura_SteamEngine',
      'M140 S60 ; set bed',
      'M190 S60 ; wait for bed',
      'M104 S210 T0 ; set hotend',
      'M109 S210 T0 ; wait for hotend',
      'G28 ; home',
      'G1 X10 Y10 F3000',
    ].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.samples).toHaveLength(4)
    expect(r.samples.map(s => s.command)).toEqual(['M140', 'M190', 'M104', 'M109'])
  })

  it('rejects a gcode that asks for 400 C on a 350 C-ceiling K2', () => {
    const gcode = ['M140 S60', 'M104 S400 ; broken slicer export', 'G28'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].sample.lineNumber).toBe(2)
    expect(r.violations[0].ceilingC).toBe(350)
  })

  it('rejects a gcode that asks for 150 C bed on a 120 C-ceiling K2', () => {
    const gcode = ['M190 S150', 'M104 S210'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('bed')
    expect(r.violations[0].ceilingC).toBe(120)
  })

  it('passes through when caps is null', () => {
    const gcode = 'M104 S9999\n'
    const r = validateGcodeFileTemps(gcode, null)
    expect(r.ok).toBe(true)
    expect(r.samples).toHaveLength(1) // sample still parsed for diagnostics
  })
})

describe('summarizeTempViolations [ID-0070]', () => {
  it('returns null for a passing result', () => {
    const passing: GcodeTempValidationResult = { ok: true, violations: [], samples: [] }
    expect(summarizeTempViolations(passing)).toBeNull()
  })

  it('returns the single message when only one violation', () => {
    const r = validateGcodeFileTemps('M104 S400\n', K2_CAPS)
    const s = summarizeTempViolations(r)
    expect(s).not.toBeNull()
    expect(s!).toMatch(/M104 requests 400 C/)
    expect(s!).not.toMatch(/more violation/)
  })

  it('collapses multiple violations into "first + N more"', () => {
    const gcode = ['M104 S400', 'M190 S150', 'M109 S380'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    const s = summarizeTempViolations(r)
    expect(s).not.toBeNull()
    expect(s!).toMatch(/^Line 1: M104 requests 400 C/)
    expect(s!).toMatch(/\(\+2 more violations\)/)
  })
})

describe('bundled resources/machines/creality-k2-plus.json cross-check [ID-0070]', () => {
  // Load the REAL bundled K2 profile so a future edit to ceilings is
  // immediately reflected in this validator's behavior -- same defense as
  // Cycle 8's k2-meta test.
  const text = readFileSync(
    resolve(__dirname, '..', '..', 'resources', 'machines', 'creality-k2-plus.json'),
    'utf-8'
  )
  const profile = machineProfileSchema.parse(JSON.parse(text))
  const caps: FdmCapabilityFields = {
    maxNozzleTempC: profile.maxNozzleTempC,
    maxBedTempC: profile.maxBedTempC,
    chamberTempC: profile.chamberTempC,
  }

  it('accepts M191 at exactly profile.chamberTempC', () => {
    if (typeof caps.chamberTempC !== 'number' || caps.chamberTempC <= 0) {
      // If the bundled profile does not declare a chamberTempC, the cross-check
      // degenerates to a pass-through which is already covered above.
      return
    }
    const gcode = `M191 S${caps.chamberTempC}\n`
    const r = validateGcodeFileTemps(gcode, caps)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('rejects M191 above profile.chamberTempC with command/kind attribution + toast mentions M191', () => {
    if (typeof caps.chamberTempC !== 'number' || caps.chamberTempC <= 0) {
      return
    }
    const over = caps.chamberTempC + 30
    const gcode = `M191 S${over}\n`
    const r = validateGcodeFileTemps(gcode, caps)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].sample.command).toBe('M191')
    const summary = summarizeTempViolations(r)
    expect(summary).not.toBeNull()
    expect(summary).toContain('M191')
  })
})

describe('parseGcodeTempCommands -- chamber temp extensions [ID-0071]', () => {
  it('parses M141 S50 with chamber kind and no tool index', () => {
    const samples = parseGcodeTempCommands('M141 S50\n')
    expect(samples).toHaveLength(1)
    expect(samples[0]).toEqual<GcodeTempSample>({
      lineNumber: 1,
      command: 'M141',
      kind: 'chamber',
      targetC: 50,
      raw: 'M141 S50',
    })
    expect(samples[0].tool).toBeUndefined()
  })

  it('accepts lowercase m141 and decimal S value', () => {
    const samples = parseGcodeTempCommands('m141 s45.5\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('M141')
    expect(samples[0].kind).toBe('chamber')
    expect(samples[0].targetC).toBeCloseTo(45.5, 6)
  })

  it('accepts M141 S0 as valid heater-off sample', () => {
    const samples = parseGcodeTempCommands('M141 S0\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(0)
    expect(samples[0].kind).toBe('chamber')
  })

  it('skips bare M141 without S word (query form)', () => {
    const samples = parseGcodeTempCommands('M141\nM141 S60\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].lineNumber).toBe(2)
    expect(samples[0].targetC).toBe(60)
  })

  it('does NOT emit a tool index for M141 even when T-word present', () => {
    const samples = parseGcodeTempCommands('M141 T0 S50\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('M141')
    expect(samples[0].kind).toBe('chamber')
    expect(samples[0].tool).toBeUndefined()
  })

  it('strips `;` comment before matching M141', () => {
    const samples = parseGcodeTempCommands('M141 S55 ; wait for chamber\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(55)
    expect(samples[0].raw).toBe('M141 S55')
  })

  it('parses Klipper SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60 as chamber sample', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60\n')
    expect(samples).toHaveLength(1)
    expect(samples[0]).toEqual<GcodeTempSample>({
      lineNumber: 1,
      command: 'SET_HEATER_TEMPERATURE',
      kind: 'chamber',
      targetC: 60,
      raw: 'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60',
    })
  })

  it('accepts lowercase set_heater_temperature and decimal TARGET', () => {
    const samples = parseGcodeTempCommands('set_heater_temperature heater=chamber target=55.5\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('SET_HEATER_TEMPERATURE')
    expect(samples[0].kind).toBe('chamber')
    expect(samples[0].targetC).toBeCloseTo(55.5, 6)
  })

  it('accepts mixed-case HEATER=Chamber on Klipper macro', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=Chamber TARGET=50\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('chamber')
    expect(samples[0].targetC).toBe(50)
  })

  // [ID-0071] originally skipped HEATER=extruder / HEATER=heater_bed; [ID-0077]
  // (Cycle 24) broadens the Klipper macro to recognize them. The 2 tests below
  // now ASSERT the post-[ID-0077] routing instead of the legacy skip behavior.
  // The [ID-0077] describe block at the bottom of this file pins the new
  // routing in detail (extruder<N> tools, heater_bed kind, substring defenses).
  it('parses HEATER=extruder as nozzle sample with no tool field [ID-0077]', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210\n')
    expect(samples).toEqual([
      {
        lineNumber: 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'nozzle',
        targetC: 210,
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210',
      },
    ])
  })

  it('parses HEATER=heater_bed as bed sample with no tool field [ID-0077]', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=65\n')
    expect(samples).toEqual([
      {
        lineNumber: 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'bed',
        targetC: 65,
        raw: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=65',
      },
    ])
  })

  it('skips Klipper macro when TARGET is missing', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber\n')
    expect(samples).toEqual([])
  })

  it('skips Klipper macro when HEATER is missing', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE TARGET=60\n')
    expect(samples).toEqual([])
  })

  it('strips trailing `;` comment from SET_HEATER_TEMPERATURE line', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60 ; preheat chamber\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(60)
    expect(samples[0].raw).toBe('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60')
  })

  it('skips `;`-commented-out SET_HEATER_TEMPERATURE line', () => {
    const samples = parseGcodeTempCommands('; SET_HEATER_TEMPERATURE HEATER=chamber TARGET=90 commented\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=chamber_fan as non-chamber (substring defense)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=chamber_fan TARGET=40\n')
    expect(samples).toEqual([])
  })

  it('emits nothing for bare SET_HEATER_TEMPERATURE without params', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE\n')
    expect(samples).toEqual([])
  })

  it('parses mixed M141 + Klipper + M104 header in source order with correct kinds', () => {
    const gcode = [
      'M141 S50',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=55',
      'M104 S210',
    ].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(3)
    expect(samples.map(s => s.command)).toEqual(['M141', 'SET_HEATER_TEMPERATURE', 'M104'])
    expect(samples.map(s => s.kind)).toEqual(['chamber', 'chamber', 'nozzle'])
    expect(samples.map(s => s.lineNumber)).toEqual([1, 2, 3])
    expect(samples.map(s => s.targetC)).toEqual([50, 55, 210])
  })
})

describe('validateGcodeTemps -- chamber ceiling [ID-0071]', () => {
  it('accepts M141 exactly AT chamber ceiling (equality passes)', () => {
    const atCeiling: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M141', kind: 'chamber', targetC: 60, raw: 'M141 S60' },
    ]
    const r = validateGcodeTemps(atCeiling, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('flags M141 above chamber ceiling with chamber kind + message', () => {
    const over: GcodeTempSample[] = [
      { lineNumber: 2, command: 'M141', kind: 'chamber', targetC: 80, raw: 'M141 S80' },
    ]
    const r = validateGcodeTemps(over, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].ceilingC).toBe(60)
    expect(r.violations[0].sample.command).toBe('M141')
    expect(r.violations[0].message).toMatch(/exceeds the chamber ceiling of 60 C/)
  })

  it('flags SET_HEATER_TEMPERATURE above chamber ceiling with command attribution', () => {
    const over: GcodeTempSample[] = [
      {
        lineNumber: 3,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'chamber',
        targetC: 90,
        raw: 'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=90',
      },
    ]
    const r = validateGcodeTemps(over, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].sample.command).toBe('SET_HEATER_TEMPERATURE')
    expect(r.violations[0].message).toMatch(/SET_HEATER_TEMPERATURE requests 90 C/)
  })

  it('passes through when chamberTempC is unset even if nozzle/bed ceilings set', () => {
    const capsNoChamber: FdmCapabilityFields = { maxNozzleTempC: 350, maxBedTempC: 120 }
    const hot: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M141', kind: 'chamber', targetC: 500, raw: 'M141 S500' },
    ]
    const r = validateGcodeTemps(hot, capsNoChamber)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('treats non-positive chamberTempC as not declared', () => {
    const bad: FdmCapabilityFields = { chamberTempC: 0 }
    const hot: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M141', kind: 'chamber', targetC: 500, raw: 'M141 S500' },
    ]
    expect(validateGcodeTemps(hot, bad).ok).toBe(true)
  })

  it('treats non-finite chamberTempC as not declared', () => {
    const bad: FdmCapabilityFields = { chamberTempC: Number.NaN }
    const hot: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M141', kind: 'chamber', targetC: 500, raw: 'M141 S500' },
    ]
    expect(validateGcodeTemps(hot, bad).ok).toBe(true)
  })

  it('isolates per-kind routing (nozzle/bed do not use chamberCeiling and vice versa)', () => {
    // chamberTempC alone is set; a hot nozzle sample must NOT be flagged
    // against chamberCeiling, and a hot bed sample must NOT be flagged either.
    // Conversely a chamber sample under `chamberTempC` must not be flagged
    // by nozzleCeiling/bedCeiling routing.
    const chamberOnly: FdmCapabilityFields = { chamberTempC: 60 }
    const mixed: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 400, raw: 'M104 S400' },
      { lineNumber: 2, command: 'M140', kind: 'bed', targetC: 200, raw: 'M140 S200' },
      { lineNumber: 3, command: 'M141', kind: 'chamber', targetC: 90, raw: 'M141 S90' },
    ]
    const r = validateGcodeTemps(mixed, chamberOnly)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].sample.command).toBe('M141')
  })
})

describe('validateGcodeFileTemps -- chamber end-to-end [ID-0071]', () => {
  it('accepts realistic PrusaSlicer header with M141 + M140 + M104 + M109 under K2 ceilings', () => {
    const gcode = [
      ';FLAVOR:Marlin',
      'M141 S55 ; preheat chamber',
      'M140 S60',
      'M190 S60',
      'M104 S210 T0',
      'M109 S210 T0',
      'G28',
    ].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.samples).toHaveLength(5)
    expect(r.samples.map(s => s.command)).toEqual(['M141', 'M140', 'M190', 'M104', 'M109'])
  })

  it('rejects M141 S80 against 60 C chamber ceiling', () => {
    const gcode = 'M141 S80\n'
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].ceilingC).toBe(60)
    expect(r.violations[0].sample.command).toBe('M141')
  })

  it('rejects Klipper TARGET=90 against 60 C chamber ceiling with command attribution', () => {
    const gcode = 'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=90\n'
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].sample.command).toBe('SET_HEATER_TEMPERATURE')
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].ceilingC).toBe(60)
  })

  it('null-caps pass-through captures both chamber-sample forms for diagnostics', () => {
    const gcode = [
      'M141 S500',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=600',
    ].join('\n')
    const r = validateGcodeFileTemps(gcode, null)
    expect(r.ok).toBe(true)
    expect(r.samples).toHaveLength(2)
    expect(r.samples.map(s => s.kind)).toEqual(['chamber', 'chamber'])
    expect(r.samples.map(s => s.command)).toEqual(['M141', 'SET_HEATER_TEMPERATURE'])
  })

  it('multi-violation summary collapses nozzle + chamber double-violation', () => {
    const gcode = [
      'M104 S400',
      'M141 S90',
      'M109 S380',
    ].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations.length).toBeGreaterThanOrEqual(2)
    const summary = summarizeTempViolations(r)
    expect(summary).not.toBeNull()
    expect(summary!).toMatch(/^Line 1: M104 requests 400 C/)
    expect(summary!).toMatch(/\(\+\d+ more violation/)
  })
})

describe('bundled creality-k2-plus.json chamber cross-check [ID-0071]', () => {
  const text = readFileSync(
    resolve(__dirname, '..', '..', 'resources', 'machines', 'creality-k2-plus.json'),
    'utf-8'
  )
  const profile = machineProfileSchema.parse(JSON.parse(text))
  const caps: FdmCapabilityFields = {
    maxNozzleTempC: profile.maxNozzleTempC,
    maxBedTempC: profile.maxBedTempC,
    chamberTempC: profile.chamberTempC,
  }

  it('bundled K2 profile declares a positive chamberTempC consumed by the validator', () => {
    expect(typeof caps.chamberTempC).toBe('number')
    expect(caps.chamberTempC).toBeGreaterThan(0)
  })

  it('40 C M141 target passes against bundled chamber ceiling', () => {
    if (typeof caps.chamberTempC !== 'number' || caps.chamberTempC <= 0) return
    const gcode = 'M141 S40\n'
    const r = validateGcodeFileTemps(gcode, caps)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('90 C Klipper macro rejected against bundled chamber ceiling', () => {
    if (typeof caps.chamberTempC !== 'number' || caps.chamberTempC <= 0) return
    const over = caps.chamberTempC + 30
    const gcode = `SET_HEATER_TEMPERATURE HEATER=chamber TARGET=${over}\n`
    const r = validateGcodeFileTemps(gcode, caps)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].sample.command).toBe('SET_HEATER_TEMPERATURE')
  })
})

describe('parseGcodeTempCommands -- M191 wait-for-chamber [ID-0079]', () => {
  it('parses M191 S50 with chamber kind (wait-for-chamber)', () => {
    const samples = parseGcodeTempCommands('M191 S50\n')
    expect(samples).toHaveLength(1)
    expect(samples[0]).toEqual<GcodeTempSample>({
      lineNumber: 1,
      command: 'M191',
      kind: 'chamber',
      targetC: 50,
      raw: 'M191 S50',
    })
    expect(samples[0].tool).toBeUndefined()
  })

  it('accepts lowercase m191 s45.5 decimal value', () => {
    const samples = parseGcodeTempCommands('m191 s45.5\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('M191')
    expect(samples[0].kind).toBe('chamber')
    expect(samples[0].targetC).toBeCloseTo(45.5, 6)
  })

  it('accepts M191 S0 as valid wait-for-cooldown sample', () => {
    const samples = parseGcodeTempCommands('M191 S0\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(0)
    expect(samples[0].kind).toBe('chamber')
  })

  it('skips bare M191 without S word (query form)', () => {
    const samples = parseGcodeTempCommands('M191\nM191 S60\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].lineNumber).toBe(2)
  })

  it('does NOT emit a tool index for M191 even when T-word present', () => {
    const samples = parseGcodeTempCommands('M191 T0 S50\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].command).toBe('M191')
    expect(samples[0].kind).toBe('chamber')
    expect(samples[0].tool).toBeUndefined()
  })

  it('strips trailing `;` comment from M191 S55 line', () => {
    const samples = parseGcodeTempCommands('M191 S55 ; wait for chamber\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(55)
    expect(samples[0].raw).toBe('M191 S55')
  })

  it('skips `;`-commented-out M191 line', () => {
    const samples = parseGcodeTempCommands('; M191 S90 commented\n')
    expect(samples).toEqual([])
  })

  it('preserves source-order across mixed M141/M104/M191 stream', () => {
    const gcode = ['M141 S50', 'M104 S210', 'M191 S55'].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples.map(s => s.command)).toEqual(['M141', 'M104', 'M191'])
    expect(samples.map(s => s.lineNumber)).toEqual([1, 2, 3])
    expect(samples.map(s => s.kind)).toEqual(['chamber', 'nozzle', 'chamber'])
  })
})

describe('validateGcodeTemps -- M191 chamber ceiling [ID-0079]', () => {
  it('accepts M191 exactly AT chamber ceiling (equality passes)', () => {
    const atCeiling: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M191', kind: 'chamber', targetC: 60, raw: 'M191 S60' },
    ]
    const r = validateGcodeTemps(atCeiling, K2_CAPS)
    expect(r.ok).toBe(true)
  })

  it('flags M191 above chamber ceiling with chamber kind + M191 command', () => {
    const over: GcodeTempSample[] = [
      { lineNumber: 2, command: 'M191', kind: 'chamber', targetC: 75, raw: 'M191 S75' },
    ]
    const r = validateGcodeTemps(over, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].kind).toBe('chamber')
    expect(r.violations[0].sample.command).toBe('M191')
    expect(r.violations[0].message).toMatch(/chamber/)
    expect(r.violations[0].message).toMatch(/75/)
    expect(r.violations[0].message).toMatch(/60/)
  })

  it('passes through when chamberTempC is unset (only nozzle+bed set)', () => {
    const capsNoChamber: FdmCapabilityFields = { maxNozzleTempC: 350, maxBedTempC: 120 }
    const hot: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M191', kind: 'chamber', targetC: 200, raw: 'M191 S200' },
    ]
    const r = validateGcodeTemps(hot, capsNoChamber)
    expect(r.ok).toBe(true)
  })

  it('passes through when chamberTempC is non-positive', () => {
    const bad: FdmCapabilityFields = { chamberTempC: 0 }
    const hot: GcodeTempSample[] = [
      { lineNumber: 1, command: 'M191', kind: 'chamber', targetC: 60, raw: 'M191 S60' },
    ]
    expect(validateGcodeTemps(hot, bad).ok).toBe(true)
  })
})

describe('validateGcodeFileTemps -- M191 end-to-end [ID-0079]', () => {
  it('accepts realistic K2 PrusaSlicer header with M141+M140+M104+M190+M191+M109', () => {
    const gcode = [
      ';FLAVOR:Marlin',
      'M141 S60',
      'M140 S60',
      'M104 S210',
      'M190 S60',
      'M191 S60',
      'M109 S210',
      'G28',
    ].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(true)
    expect(r.samples.map(s => s.command)).toEqual([
      'M141', 'M140', 'M104', 'M190', 'M191', 'M109',
    ])
  })

  it('rejects hand-edit drift where M141 S50 passes but M191 S90 exceeds ceiling', () => {
    const gcode = ['M141 S50', 'M191 S90'].join('\n')
    const r = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(r.ok).toBe(false)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].sample.command).toBe('M191')
    expect(r.violations[0].kind).toBe('chamber')
  })

  it('null-caps pass-through preserves M191 sample for diagnostics', () => {
    const gcode = 'M191 S500\n'
    const r = validateGcodeFileTemps(gcode, null)
    expect(r.ok).toBe(true)
    expect(r.samples).toHaveLength(1)
    expect(r.samples[0].kind).toBe('chamber')
    expect(r.samples[0].command).toBe('M191')
  })
})

describe('bundled creality-k2-plus.json M191 cross-check [ID-0079]', () => {
  const text = readFileSync(
    resolve(__dirname, '..', '..', 'resources', 'machines', 'creality-k2-plus.json'),
    'utf-8'
  )
  const profile = machineProfileSchema.parse(JSON.parse(text))
  const caps: FdmCapabilityFields = {
    maxNozzleTempC: profile.maxNozzleTempC,
    maxBedTempC: profile.maxBedTempC,
    chamberTempC: profile.chamberTempC,
  }

  it('M191 at exactly profile.chamberTempC passes against bundled profile', () => {
    if (typeof caps.chamberTempC !== 'number' || caps.chamberTempC <= 0) return
    const gcode = `M191 S${caps.chamberTempC}\n`
    const r = validateGcodeFileTemps(gcode, caps)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('M191 above profile.chamberTempC rejects and summary surfaces M191', () => {
    if (typeof caps.chamberTempC !== 'number' || caps.chamberTempC <= 0) return
    const over = caps.chamberTempC + 30
    const gcode = `M191 S${over}\n`
    const r = validateGcodeFileTemps(gcode, caps)
    expect(r.ok).toBe(false)
    expect(r.violations[0].sample.command).toBe('M191')
    const summary = summarizeTempViolations(r)
    expect(summary).not.toBeNull()
    expect(summary).toContain('M191')
  })
})


// [ID-0077] Cycle 24 -- Klipper SET_HEATER_TEMPERATURE HEATER=extruder /
// HEATER=extruder<N> / HEATER=heater_bed broadening. The 4 describe blocks
// below pin the new routing in detail. Production: the SET_HEATER_TEMPERATURE
// branch in `parseGcodeTempCommands` now case-folds the HEATER= value and
// emits a sample with `kind='nozzle'` for `extruder` (no tool field) /
// `extruder<digits>` (tool=N), `kind='bed'` for `heater_bed` (no tool
// field), or skips otherwise. Substring-defense: only EXACT matches on the
// canonical Klipper names (or `extruder<digits>`) emit samples; `extruder_fan`,
// `heater_bed_x`, `chamber_fan`, custom `[heater_generic <name>]` sections
// etc. remain skipped. M-code paths and existing HEATER=chamber routing are
// unchanged (Safety Rule 2).

describe('parseGcodeTempCommands -- Klipper extruder/heater_bed broadening [ID-0077]', () => {
  it('parses HEATER=extruder1 as nozzle sample with tool=1', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=215\n')
    expect(samples).toEqual([
      {
        lineNumber: 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'nozzle',
        targetC: 215,
        tool: 1,
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=215',
      },
    ])
  })

  it('parses HEATER=extruder2 as nozzle sample with tool=2', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder2 TARGET=240\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('nozzle')
    expect(samples[0].tool).toBe(2)
    expect(samples[0].targetC).toBe(240)
  })

  it('parses HEATER=extruder0 as nozzle sample with tool=0 (regex matches \\d+ inclusive of zero)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder0 TARGET=200\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('nozzle')
    expect(samples[0].tool).toBe(0)
  })

  it('accepts mixed-case HEATER=Extruder as nozzle sample', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=Extruder TARGET=205\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('nozzle')
    expect(samples[0].tool).toBeUndefined()
  })

  it('accepts uppercase HEATER=EXTRUDER as nozzle sample', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=EXTRUDER TARGET=210\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('nozzle')
  })

  it('accepts mixed-case HEATER=Extruder3 with preserved tool index', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=Extruder3 TARGET=225\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('nozzle')
    expect(samples[0].tool).toBe(3)
  })

  it('accepts mixed-case HEATER=Heater_Bed as bed sample', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=Heater_Bed TARGET=80\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('bed')
    expect(samples[0].tool).toBeUndefined()
  })

  it('accepts uppercase HEATER=HEATER_BED as bed sample', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=HEATER_BED TARGET=70\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].kind).toBe('bed')
  })

  it('parses decimal TARGET on HEATER=extruder', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215.5\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(215.5)
  })

  it('parses TARGET=0 on HEATER=extruder as heater-off (still emits sample)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(0)
    expect(samples[0].kind).toBe('nozzle')
  })

  it('parses TARGET=0 on HEATER=heater_bed as bed-off (still emits sample)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0\n')
    expect(samples).toHaveLength(1)
    expect(samples[0].targetC).toBe(0)
    expect(samples[0].kind).toBe('bed')
  })

  it('skips HEATER=extruder when TARGET is missing', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder\n')
    expect(samples).toEqual([])
  })

  it('skips HEATER=heater_bed when TARGET is missing', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=extruder_fan as non-extruder (substring defense)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder_fan TARGET=40\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=extruder_a as non-extruder (regex `^extruder\\d+$` requires digits-only suffix)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extruder_a TARGET=210\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=extrude (typo / partial name) as non-extruder', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=extrude TARGET=210\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=heater_bed_x as non-heater_bed (substring defense)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed_x TARGET=70\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=heater_bed_left as non-heater_bed (multi-bed-zone substring defense)', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bed_left TARGET=80\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=heater_bedt (typo) as non-heater_bed', () => {
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=heater_bedt TARGET=70\n')
    expect(samples).toEqual([])
  })

  it('rejects HEATER=bed (Marlin-style short name) as non-heater_bed', () => {
    // Klipper canonical is `heater_bed`; bare `bed` is not a Klipper convention.
    const samples = parseGcodeTempCommands('SET_HEATER_TEMPERATURE HEATER=bed TARGET=70\n')
    expect(samples).toEqual([])
  })

  it('parses mixed M104 + Klipper extruder + Klipper heater_bed in one stream preserves source order', () => {
    const gcode = [
      'M104 S210',
      'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=220',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=70',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=55',
      'M140 S60',
    ].join('\n')
    const samples = parseGcodeTempCommands(gcode)
    expect(samples).toHaveLength(5)
    expect(samples.map((s) => s.command)).toEqual([
      'M104',
      'SET_HEATER_TEMPERATURE',
      'SET_HEATER_TEMPERATURE',
      'SET_HEATER_TEMPERATURE',
      'M140',
    ])
    expect(samples.map((s) => s.kind)).toEqual(['nozzle', 'nozzle', 'bed', 'chamber', 'bed'])
    expect(samples.map((s) => s.lineNumber)).toEqual([1, 2, 3, 4, 5])
    expect(samples[1].tool).toBe(1)
    expect(samples[2].tool).toBeUndefined()
    expect(samples[3].tool).toBeUndefined()
  })
})

describe('validateGcodeTemps -- Klipper extruder/heater_bed ceiling [ID-0077]', () => {
  it('rejects HEATER=extruder above nozzle ceiling with kind=nozzle', () => {
    const samples: GcodeTempSample[] = [
      {
        lineNumber: 7,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'nozzle',
        targetC: 380,
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=380',
      },
    ]
    const result = validateGcodeTemps(samples, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].kind).toBe('nozzle')
    expect(result.violations[0].ceilingC).toBe(350)
    expect(result.violations[0].message).toContain('SET_HEATER_TEMPERATURE')
    expect(result.violations[0].message).toContain('380')
    expect(result.violations[0].message).toContain('350')
    expect(result.violations[0].message).toContain('nozzle ceiling')
  })

  it('rejects HEATER=extruder1 above nozzle ceiling with T1 tool annotation', () => {
    const samples: GcodeTempSample[] = [
      {
        lineNumber: 12,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'nozzle',
        targetC: 400,
        tool: 1,
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=400',
      },
    ]
    const result = validateGcodeTemps(samples, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations[0].message).toContain('(T1)')
    expect(result.violations[0].message).toContain('400')
  })

  it('rejects HEATER=heater_bed above bed ceiling with kind=bed', () => {
    const samples: GcodeTempSample[] = [
      {
        lineNumber: 5,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'bed',
        targetC: 150,
        raw: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=150',
      },
    ]
    const result = validateGcodeTemps(samples, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations[0].kind).toBe('bed')
    expect(result.violations[0].ceilingC).toBe(120)
    expect(result.violations[0].message).toContain('SET_HEATER_TEMPERATURE')
    expect(result.violations[0].message).toContain('bed ceiling')
  })

  it('passes HEATER=extruder at exactly maxNozzleTempC', () => {
    const samples: GcodeTempSample[] = [
      {
        lineNumber: 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'nozzle',
        targetC: 350,
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=350',
      },
    ]
    const result = validateGcodeTemps(samples, K2_CAPS)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('passes HEATER=heater_bed at exactly maxBedTempC', () => {
    const samples: GcodeTempSample[] = [
      {
        lineNumber: 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'bed',
        targetC: 120,
        raw: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=120',
      },
    ]
    const result = validateGcodeTemps(samples, K2_CAPS)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('HEATER=extruder1 passes when caps has no nozzle ceiling', () => {
    const samples: GcodeTempSample[] = [
      {
        lineNumber: 1,
        command: 'SET_HEATER_TEMPERATURE',
        kind: 'nozzle',
        targetC: 400,
        tool: 1,
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=400',
      },
    ]
    const result = validateGcodeTemps(samples, { maxBedTempC: 120, chamberTempC: 60 })
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })
})

describe('validateGcodeFileTemps -- Klipper extruder/heater_bed end-to-end [ID-0077]', () => {
  it('Klipper-only header: extruder + extruder1 + heater_bed at safe targets all pass', () => {
    const gcode = [
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210',
      'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=220',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=80',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=50',
    ].join('\n')
    const result = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(result.ok).toBe(true)
    expect(result.samples).toHaveLength(4)
    expect(result.violations).toEqual([])
  })

  it('Klipper extruder TARGET above nozzle ceiling rejects with command attribution', () => {
    const gcode = 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=380\n'
    const result = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].sample.command).toBe('SET_HEATER_TEMPERATURE')
    expect(result.violations[0].kind).toBe('nozzle')
  })

  it('Klipper heater_bed TARGET above bed ceiling rejects with command attribution', () => {
    const gcode = 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=150\n'
    const result = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].sample.command).toBe('SET_HEATER_TEMPERATURE')
    expect(result.violations[0].kind).toBe('bed')
  })

  it('Klipper extruder + heater_bed both above ceilings -> 2 violations in source order', () => {
    const gcode = [
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=380',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=150',
    ].join('\n')
    const result = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(2)
    expect(result.violations[0].kind).toBe('nozzle')
    expect(result.violations[0].sample.lineNumber).toBe(1)
    expect(result.violations[1].kind).toBe('bed')
    expect(result.violations[1].sample.lineNumber).toBe(2)
  })

  it('summarizeTempViolations across mixed M-code + Klipper violations preserves first-violation message + tail count', () => {
    const gcode = [
      'M104 S400',
      'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=400',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=150',
    ].join('\n')
    const result = validateGcodeFileTemps(gcode, K2_CAPS)
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(3)
    const summary = summarizeTempViolations(result)
    expect(summary).not.toBeNull()
    expect(summary).toContain('M104')
    expect(summary).toContain('+2 more violations')
  })

  it('null-caps diagnostic pass-through still parses Klipper extruder + heater_bed samples', () => {
    const gcode = [
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=70',
    ].join('\n')
    const result = validateGcodeFileTemps(gcode, null)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.samples).toHaveLength(2)
    expect(result.samples[0].kind).toBe('nozzle')
    expect(result.samples[1].kind).toBe('bed')
  })
})

describe('bundled creality-k2-plus.json Klipper extruder/heater_bed cross-check [ID-0077]', () => {
  // Reuse the same bundled-profile load idiom from the [ID-0070] cross-check
  // describe block at the top of this file; keep the fixture local so the
  // [ID-0077] tests stay self-contained and a future delete of the [ID-0070]
  // block does not silently remove our cross-check coverage.
  const bundledPath = resolve(__dirname, '..', '..', 'resources', 'machines', 'creality-k2-plus.json')
  const bundledRaw = readFileSync(bundledPath, 'utf-8')
  const bundledProfile = machineProfileSchema.parse(JSON.parse(bundledRaw))
  const bundledCaps: FdmCapabilityFields = {
    maxNozzleTempC: bundledProfile.maxNozzleTempC,
    maxBedTempC: bundledProfile.maxBedTempC,
    chamberTempC: bundledProfile.chamberTempC,
  }

  it('bundled K2 maxNozzleTempC=350 -> HEATER=extruder TARGET=350 passes', () => {
    const result = validateGcodeFileTemps('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=350\n', bundledCaps)
    expect(result.ok).toBe(true)
  })

  it('bundled K2 -> HEATER=extruder TARGET=380 rejected with SET_HEATER_TEMPERATURE attribution', () => {
    const result = validateGcodeFileTemps('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=380\n', bundledCaps)
    expect(result.ok).toBe(false)
    const summary = summarizeTempViolations(result)
    expect(summary).not.toBeNull()
    expect(summary).toContain('SET_HEATER_TEMPERATURE')
    expect(summary).toContain('380')
    expect(summary).toContain('350')
    expect(summary).toContain('nozzle ceiling')
  })

  it('bundled K2 -> HEATER=extruder1 TARGET=380 rejected with T1 annotation', () => {
    const result = validateGcodeFileTemps('SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=380\n', bundledCaps)
    expect(result.ok).toBe(false)
    const summary = summarizeTempViolations(result)
    expect(summary).not.toBeNull()
    expect(summary).toContain('(T1)')
  })

  it('bundled K2 maxBedTempC=120 -> HEATER=heater_bed TARGET=120 passes', () => {
    const result = validateGcodeFileTemps('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=120\n', bundledCaps)
    expect(result.ok).toBe(true)
  })

  it('bundled K2 -> HEATER=heater_bed TARGET=150 rejected with SET_HEATER_TEMPERATURE attribution', () => {
    const result = validateGcodeFileTemps('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=150\n', bundledCaps)
    expect(result.ok).toBe(false)
    const summary = summarizeTempViolations(result)
    expect(summary).not.toBeNull()
    expect(summary).toContain('SET_HEATER_TEMPERATURE')
    expect(summary).toContain('bed ceiling')
    expect(summary).toContain('150')
    expect(summary).toContain('120')
  })

  it('bundled K2 chamber routing UNCHANGED: HEATER=chamber TARGET=60 passes (Safety Rule 2 anchor for [ID-0077])', () => {
    // Pin: [ID-0077] only EXTENDED the heater-name set; the chamber path
    // from [ID-0071] still resolves to the chamberTempC ceiling. If a
    // future cycle accidentally re-shapes the chamber branch, this test
    // catches it.
    const result = validateGcodeFileTemps('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=60\n', bundledCaps)
    expect(result.ok).toBe(true)
    expect(result.samples).toHaveLength(1)
    expect(result.samples[0].kind).toBe('chamber')
  })
})
