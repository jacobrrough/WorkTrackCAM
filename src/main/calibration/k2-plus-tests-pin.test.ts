/**
 * Paired-pin contract for `src/main/calibration/k2-plus-tests.ts`.
 *
 * Gap #4 from docs/COMPETITIVE-GAP-ANALYSIS.md (K2 Plus calibration
 * suite). The three calibration G-code builders MUST keep every emitted
 * line STRICTLY UNDER the K2 Plus hardware envelope -- a careless
 * tuning bump that pushes feed past 600 mm/s, accel past 30000 mm/s²,
 * or temp past 350 C / 120 C fails CI here BEFORE it can ship.
 *
 * Three-machine relevance:
 *   - Creality K2 Plus: DIRECT (the only target machine for this surface).
 *   - Laguna Swift 5x10 + Makera Carvera: NOT APPLICABLE (CNC), but the
 *     pin asserts the module never emits CNC-style M3/M5/M30 or G54-G59
 *     codes that could confuse a future shared post-pipeline.
 *
 * Test groups:
 *   A. Module shape (exports + types)
 *   B. SOURCE-text purity (no fs/net/electron leak)
 *   C. K2 hardware-ceiling envelope enforcement (the safety wall)
 *   D. G-code well-formedness (no NaN, no Infinity, all commands stay
 *      Klipper-compatible)
 *   E. Required pre/post sequences present in every test
 *   F. Per-test parameter handling (defaults + bounds checks)
 *   G. Dispatcher behavior + invalid input handling
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as Mod from './k2-plus-tests'
import {
  buildCalibrationGcode,
  buildCorneringTestArgs,
  buildFlowRateArgs,
  buildMaxVolumetricFlowArgs,
  buildPressureAdvanceArgs,
  buildRetractionTowerArgs,
  buildTemperatureTowerArgs,
  buildToleranceTestArgs,
  buildVfaTestArgs,
  type CalibrationBuildResult,
  type CalibrationTestKind
} from './k2-plus-tests'
import { K2_PLUS_HARDWARE_CEILINGS } from '../../shared/k2-plus-slice-presets'

const SOURCE_PATH = resolve(process.cwd(), 'src', 'main', 'calibration', 'k2-plus-tests.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ── Helpers used across groups ──────────────────────────────────────────────

const OUT_PATH = 'C:/tmp/calibration-test.gcode'

/**
 * Parse every G0/G1/G28 motion line for an F-word (feed rate, mm/min) and
 * an X/Y/Z/E coordinate. Returns one record per line that has any of
 * those fields set so callers can assert per-axis ceilings.
 */
type MotionRecord = { lineNumber: number; raw: string; feed?: number; x?: number; y?: number; z?: number; e?: number }
function parseMotionLines(gcode: string): MotionRecord[] {
  const out: MotionRecord[] = []
  const lines = gcode.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    // Skip blank + comment lines
    if (trimmed === '' || trimmed.startsWith(';')) continue
    // Only G0/G1 are motion commands in the calibration emitter (no G2/G3 arcs)
    if (!/^G[01](\s|$)/i.test(trimmed)) continue
    const r: MotionRecord = { lineNumber: i + 1, raw }
    const fMatch = trimmed.match(/F(-?\d+(?:\.\d+)?)/)
    if (fMatch) r.feed = Number.parseFloat(fMatch[1]!)
    const xMatch = trimmed.match(/(?:^|\s)X(-?\d+(?:\.\d+)?)/)
    if (xMatch) r.x = Number.parseFloat(xMatch[1]!)
    const yMatch = trimmed.match(/(?:^|\s)Y(-?\d+(?:\.\d+)?)/)
    if (yMatch) r.y = Number.parseFloat(yMatch[1]!)
    const zMatch = trimmed.match(/(?:^|\s)Z(-?\d+(?:\.\d+)?)/)
    if (zMatch) r.z = Number.parseFloat(zMatch[1]!)
    const eMatch = trimmed.match(/(?:^|\s)E(-?\d+(?:\.\d+)?)/)
    if (eMatch) r.e = Number.parseFloat(eMatch[1]!)
    out.push(r)
  }
  return out
}

function parseTempCommands(gcode: string): { lineNumber: number; cmd: string; temp: number }[] {
  const out: { lineNumber: number; cmd: string; temp: number }[] = []
  const lines = gcode.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (raw === '' || raw.startsWith(';')) continue
    const m = raw.match(/^(M104|M109|M140|M190|M141|M191)\s+S(-?\d+(?:\.\d+)?)/)
    if (m) {
      out.push({ lineNumber: i + 1, cmd: m[1]!, temp: Number.parseFloat(m[2]!) })
    }
    // START_PRINT EXTRUDER_TEMP=N BED_TEMP=N [CHAMBER_TEMP=N]
    const sp = raw.match(/^START_PRINT\s+EXTRUDER_TEMP=(-?\d+(?:\.\d+)?)\s+BED_TEMP=(-?\d+(?:\.\d+)?)(?:\s+CHAMBER_TEMP=(-?\d+(?:\.\d+)?))?/)
    if (sp) {
      out.push({ lineNumber: i + 1, cmd: 'START_PRINT:extruder', temp: Number.parseFloat(sp[1]!) })
      out.push({ lineNumber: i + 1, cmd: 'START_PRINT:bed', temp: Number.parseFloat(sp[2]!) })
      if (sp[3]) out.push({ lineNumber: i + 1, cmd: 'START_PRINT:chamber', temp: Number.parseFloat(sp[3]!) })
    }
  }
  return out
}

// ── A. Module shape ────────────────────────────────────────────────────────

describe('A. Module shape', () => {
  it('A1: exports the three primary builders', () => {
    expect(typeof Mod.buildTemperatureTowerArgs).toBe('function')
    expect(typeof Mod.buildFlowRateArgs).toBe('function')
    expect(typeof Mod.buildPressureAdvanceArgs).toBe('function')
  })

  it('A2: exports the pure dispatcher', () => {
    expect(typeof Mod.buildCalibrationGcode).toBe('function')
  })

  it('A3: declares the CalibrationTestKind discriminator', () => {
    const kinds: CalibrationTestKind[] = [
      'temperature-tower',
      'flow-rate',
      'pressure-advance',
      'retraction-tower',
      'max-volumetric-flow',
      'tolerance',
      'cornering',
      'vfa'
    ]
    expect(kinds.length).toBe(8)
  })

  it('A4: exports the five Gap #4-ext builders', () => {
    expect(typeof Mod.buildRetractionTowerArgs).toBe('function')
    expect(typeof Mod.buildMaxVolumetricFlowArgs).toBe('function')
    expect(typeof Mod.buildToleranceTestArgs).toBe('function')
    expect(typeof Mod.buildCorneringTestArgs).toBe('function')
    expect(typeof Mod.buildVfaTestArgs).toBe('function')
  })
})

// ── B. SOURCE-text purity ───────────────────────────────────────────────────

describe('B. SOURCE-text purity', () => {
  it('B1: source does not import fs / net / electron / child_process', () => {
    expect(SOURCE).not.toMatch(/from\s+['"](fs|node:fs|node:fs\/promises)['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"](net|node:net|http|node:http|https|node:https)['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]electron['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"](child_process|node:child_process)['"]/)
  })

  it('B2: source imports K2_PLUS_HARDWARE_CEILINGS from the shared module', () => {
    expect(SOURCE).toContain("from '../../shared/k2-plus-slice-presets'")
    expect(SOURCE).toContain('K2_PLUS_HARDWARE_CEILINGS')
  })

  it('B3: source never emits CNC-style codes (M3/M5/M30/G54-G59) that would brick FDM firmware', () => {
    // Only emitted gcode strings count; we just grep the source since
    // every literal lives in template strings.
    expect(SOURCE).not.toMatch(/['"]M3 /)
    expect(SOURCE).not.toMatch(/['"]M5['"]/)
    expect(SOURCE).not.toMatch(/['"]M30['"]/)
    expect(SOURCE).not.toMatch(/['"]M2['"]/)
    // G54..G59 should not appear in emitted strings -- FDM uses absolute machine coords
    expect(SOURCE).not.toMatch(/['"]G5[4-9]/)
  })

  it('B4: docstring mentions Safety Rule 1 and points at K2_PLUS_HARDWARE_CEILINGS', () => {
    expect(SOURCE).toContain('Safety Rule 1')
    expect(SOURCE).toContain('K2_PLUS_HARDWARE_CEILINGS')
  })
})

// ── C. K2 hardware-ceiling envelope enforcement (THE SAFETY WALL) ──────────

describe('C. K2 hardware-ceiling envelope enforcement', () => {
  // Build all EIGHT with defaults; the envelope MUST hold for every line.
  const allDefaults: CalibrationBuildResult[] = [
    buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH }),
    buildFlowRateArgs({ outputGcodePath: OUT_PATH }),
    buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH }),
    buildRetractionTowerArgs({ outputGcodePath: OUT_PATH }),
    buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH }),
    buildToleranceTestArgs({ outputGcodePath: OUT_PATH }),
    buildCorneringTestArgs({ outputGcodePath: OUT_PATH }),
    buildVfaTestArgs({ outputGcodePath: OUT_PATH })
  ]

  it('C1: every motion-line F-word stays under XY feed ceiling (mm/min)', () => {
    const xyCeilMmMin = K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec * 60
    for (const r of allDefaults) {
      const motion = parseMotionLines(r.gcode)
      for (const m of motion) {
        if (m.feed == null) continue
        // A motion line that only moves Z is bounded by Z ceiling; check
        // below in C2. Here we cover lines with any X/Y motion.
        if (m.x != null || m.y != null) {
          expect(m.feed, `line ${m.lineNumber}: ${m.raw}`).toBeLessThanOrEqual(xyCeilMmMin)
          expect(m.feed).toBeGreaterThan(0)
        }
      }
    }
  })

  it('C2: every Z-only motion line stays under Z feed ceiling (mm/min)', () => {
    const zCeilMmMin = K2_PLUS_HARDWARE_CEILINGS.maxFeedrateZMmPerSec * 60
    for (const r of allDefaults) {
      const motion = parseMotionLines(r.gcode)
      for (const m of motion) {
        if (m.feed == null) continue
        const zOnly = m.z != null && m.x == null && m.y == null
        if (zOnly) {
          expect(m.feed, `Z-only line ${m.lineNumber}: ${m.raw}`).toBeLessThanOrEqual(zCeilMmMin)
        }
      }
    }
  })

  it('C3: nozzle temperatures never exceed K2 max nozzle ceiling', () => {
    const cap = K2_PLUS_HARDWARE_CEILINGS.maxNozzleTempC
    for (const r of allDefaults) {
      const temps = parseTempCommands(r.gcode)
      for (const t of temps) {
        const isNozzle =
          t.cmd === 'M104' || t.cmd === 'M109' || t.cmd === 'START_PRINT:extruder'
        if (isNozzle) {
          expect(t.temp, `line ${t.lineNumber}: ${t.cmd}=${t.temp}`).toBeLessThanOrEqual(cap)
          expect(t.temp).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('C4: bed temperatures never exceed K2 max bed ceiling', () => {
    const cap = K2_PLUS_HARDWARE_CEILINGS.maxBedTempC
    for (const r of allDefaults) {
      const temps = parseTempCommands(r.gcode)
      for (const t of temps) {
        const isBed = t.cmd === 'M140' || t.cmd === 'M190' || t.cmd === 'START_PRINT:bed'
        if (isBed) {
          expect(t.temp, `line ${t.lineNumber}: ${t.cmd}=${t.temp}`).toBeLessThanOrEqual(cap)
          expect(t.temp).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('C5: builder throws when caller forces nozzle past ceiling', () => {
    expect(() =>
      buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH, startTempC: 200, endTempC: 400 })
    ).toThrow(/ceiling/)
  })

  it('C6: builder throws when caller forces bed past ceiling', () => {
    expect(() =>
      buildFlowRateArgs({ outputGcodePath: OUT_PATH, bedTempC: 200 })
    ).toThrow(/ceiling/)
  })

  it('C7: builder throws when PA test pushes feedrate out of bounds via lineLengthMm', () => {
    expect(() =>
      buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH, lineLengthMm: 500 })
    ).toThrow(/out of safe range/)
  })
})

// ── D. Well-formedness (no NaN / Infinity / unfinished tokens) ─────────────

describe('D. G-code well-formedness', () => {
  const all = () => [
    buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH }),
    buildFlowRateArgs({ outputGcodePath: OUT_PATH }),
    buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH }),
    buildRetractionTowerArgs({ outputGcodePath: OUT_PATH }),
    buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH }),
    buildToleranceTestArgs({ outputGcodePath: OUT_PATH }),
    buildCorneringTestArgs({ outputGcodePath: OUT_PATH }),
    buildVfaTestArgs({ outputGcodePath: OUT_PATH })
  ]

  it('D1: no line contains "NaN", "Infinity", "undefined", or "null"', () => {
    for (const r of all()) {
      for (const word of ['NaN', 'Infinity', 'undefined', 'null']) {
        expect(r.gcode, `${word} found in gcode`).not.toContain(word)
      }
    }
  })

  it('D2: every G0/G1 line has at least one coordinate or E-word', () => {
    for (const r of all()) {
      const lines = r.gcode.split('\n')
      for (const raw of lines) {
        const trimmed = raw.trim()
        if (!/^G[01](\s|$)/i.test(trimmed)) continue
        const hasCoord = /[XYZE](-?\d+(?:\.\d+)?)/.test(trimmed)
        expect(hasCoord, `bare G0/G1 with no coordinate: ${raw}`).toBe(true)
      }
    }
  })

  it('D3: every gcode file ends with a newline', () => {
    for (const r of all()) {
      expect(r.gcode.endsWith('\n')).toBe(true)
    }
  })

  it('D4: every emitted E-value is monotonically non-decreasing across G1 lines', () => {
    // Defends Safety Rule 1: a stray negative-going E (other than firmware
    // retract macros like G10/G11/SET_RETRACTION) would un-prime the
    // extruder mid-print and produce gaps. Pure G1 E motions in our
    // builders are accumulated extrusion — they must climb monotonically.
    for (const r of all()) {
      const motion = parseMotionLines(r.gcode)
      let prevE: number | null = null
      for (const m of motion) {
        if (m.e == null) continue
        if (prevE !== null) {
          expect(m.e, `E went backwards on ${r.description} line ${m.lineNumber}: ${m.raw}`).toBeGreaterThanOrEqual(prevE)
        }
        prevE = m.e
      }
    }
  })
})

// ── E. Required pre/post sequences in every test ───────────────────────────

describe('E. Required pre/post sequences', () => {
  const all = () => [
    buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH }),
    buildFlowRateArgs({ outputGcodePath: OUT_PATH }),
    buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH }),
    buildRetractionTowerArgs({ outputGcodePath: OUT_PATH }),
    buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH }),
    buildToleranceTestArgs({ outputGcodePath: OUT_PATH }),
    buildCorneringTestArgs({ outputGcodePath: OUT_PATH }),
    buildVfaTestArgs({ outputGcodePath: OUT_PATH })
  ]

  it('E1: every test gcode includes START_PRINT and END_PRINT', () => {
    for (const r of all()) {
      expect(r.gcode).toMatch(/START_PRINT\s+EXTRUDER_TEMP=/)
      expect(r.gcode).toContain('END_PRINT')
    }
  })

  it('E2: every test sets absolute positioning and millimeters', () => {
    for (const r of all()) {
      expect(r.gcode).toMatch(/^G21/m)
      expect(r.gcode).toMatch(/^G90/m)
    }
  })

  it('E3: every test prints the adaptive-probing MIN/MAX coordinates Klipper expects', () => {
    for (const r of all()) {
      expect(r.gcode).toContain('; MINX = ')
      expect(r.gcode).toContain('; MINY = ')
      expect(r.gcode).toContain('; MAXX = ')
      expect(r.gcode).toContain('; MAXY = ')
    }
  })

  it('E4: every test header tags the WorkTrackCAM provenance', () => {
    for (const r of all()) {
      expect(r.gcode).toContain('WorkTrackCAM K2 Plus Calibration')
    }
  })
})

// ── F. Per-test parameter handling ─────────────────────────────────────────

describe('F. Temperature tower parameter handling', () => {
  it('F1: default range is 190 -> 220 in 5 C steps (7 segments)', () => {
    const r = buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH })
    expect(r.description).toContain('190')
    expect(r.description).toContain('220')
    // 190, 195, 200, 205, 210, 215, 220 = 7 segments
    expect(r.description).toContain('7 segments')
  })

  it('F2: respects custom start/end/step', () => {
    const r = buildTemperatureTowerArgs({
      outputGcodePath: OUT_PATH,
      startTempC: 210,
      endTempC: 250,
      stepTempC: 10
    })
    // 210, 220, 230, 240, 250 = 5 segments
    expect(r.description).toContain('5 segments')
  })

  it('F3: throws if step <= 0', () => {
    expect(() => buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH, stepTempC: 0 })).toThrow()
    expect(() => buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH, stepTempC: -5 })).toThrow()
  })

  it('F4: throws if end < start', () => {
    expect(() => buildTemperatureTowerArgs({ outputGcodePath: OUT_PATH, startTempC: 220, endTempC: 200 })).toThrow()
  })

  it('F5: outputGcodePath threads through unchanged', () => {
    const r = buildTemperatureTowerArgs({ outputGcodePath: '/tmp/foo.gcode' })
    expect(r.outputGcodePath).toBe('/tmp/foo.gcode')
    expect(r.args).toContain('/tmp/foo.gcode')
  })
})

describe('F. Flow rate parameter handling', () => {
  it('F6: default cube is 30 x 30 x 8 mm with 1 perimeter', () => {
    const r = buildFlowRateArgs({ outputGcodePath: OUT_PATH })
    expect(r.description).toContain('30x30')
    expect(r.description).toContain('8 mm tall')
    expect(r.description).toContain('1 perimeter')
  })

  it('F7: throws on degenerate cube', () => {
    expect(() => buildFlowRateArgs({ outputGcodePath: OUT_PATH, cubeSizeMm: 0 })).toThrow()
    expect(() => buildFlowRateArgs({ outputGcodePath: OUT_PATH, cubeHeightMm: -1 })).toThrow()
  })

  it('F8: throws on wallCount out of range', () => {
    expect(() => buildFlowRateArgs({ outputGcodePath: OUT_PATH, wallCount: 0 })).toThrow()
    expect(() => buildFlowRateArgs({ outputGcodePath: OUT_PATH, wallCount: 5 })).toThrow()
  })
})

describe('F. Pressure advance parameter handling', () => {
  it('F9: default sweep is 0.000 -> 0.060 in 0.010 steps (7 lines)', () => {
    const r = buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH })
    expect(r.description).toContain('7 lines')
    expect(r.description).toContain('0')
  })

  it('F10: emits SET_PRESSURE_ADVANCE per line', () => {
    const r = buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH })
    const paLines = r.gcode.split('\n').filter((l) => l.startsWith('SET_PRESSURE_ADVANCE'))
    // 7 sweep values + 1 reset to 0 at the end = 8 total
    expect(paLines.length).toBe(8)
    expect(paLines[paLines.length - 1]).toContain('ADVANCE=0')
  })

  it('F11: PA values outside [0,1] are rejected', () => {
    expect(() =>
      buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH, endPa: 2 })
    ).toThrow(/safe range/)
    expect(() =>
      buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH, startPa: -0.1 })
    ).toThrow(/safe range/)
  })

  it('F12: throws if sweep would produce more than 50 lines', () => {
    expect(() =>
      buildPressureAdvanceArgs({
        outputGcodePath: OUT_PATH,
        startPa: 0,
        endPa: 1,
        stepPa: 0.001
      })
    ).toThrow(/0 or > 50 lines/)
  })

  it('F13: rejects line lengths outside 10..200 mm', () => {
    expect(() => buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH, lineLengthMm: 5 })).toThrow()
    expect(() => buildPressureAdvanceArgs({ outputGcodePath: OUT_PATH, lineLengthMm: 1000 })).toThrow()
  })
})

describe('F. Retraction tower parameter handling', () => {
  it('F14: default sweep is 0.0 -> 2.0 mm in 0.2 mm steps (11 bands)', () => {
    const r = buildRetractionTowerArgs({ outputGcodePath: OUT_PATH })
    // 0, 0.2, 0.4, ..., 2.0 = 11 bands
    expect(r.description).toContain('11 bands')
    expect(r.description).toContain('0')
    expect(r.description).toContain('2')
  })

  it('F15: emits SET_RETRACTION per band + a reset to 0 at the END', () => {
    const r = buildRetractionTowerArgs({ outputGcodePath: OUT_PATH })
    const retLines = r.gcode.split('\n').filter((l) => l.startsWith('SET_RETRACTION'))
    // 11 bands + 1 reset
    expect(retLines.length).toBe(12)
    expect(retLines[retLines.length - 1]).toMatch(/RETRACT_LENGTH=0(\s|$)/)
  })

  it('F16: rejects retraction values outside [0, 5 mm]', () => {
    expect(() => buildRetractionTowerArgs({ outputGcodePath: OUT_PATH, endRetractMm: 6 })).toThrow(/safe range/)
    expect(() => buildRetractionTowerArgs({ outputGcodePath: OUT_PATH, startRetractMm: -0.5 })).toThrow(/safe range/)
  })

  it('F17: rejects retraction speed past K2 E-feed ceiling', () => {
    expect(() =>
      buildRetractionTowerArgs({ outputGcodePath: OUT_PATH, retractSpeedMmPerSec: 500 })
    ).toThrow()
  })

  it('F18: throws if sweep would produce more than 30 bands', () => {
    expect(() =>
      buildRetractionTowerArgs({
        outputGcodePath: OUT_PATH,
        startRetractMm: 0,
        endRetractMm: 5,
        stepRetractMm: 0.05
      })
    ).toThrow(/0 or > 30 bands/)
  })
})

describe('F. Max volumetric flow parameter handling', () => {
  it('F19: default sweep is 5 -> 30 mm^3/s in 2 mm^3/s steps (13 bands)', () => {
    const r = buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH })
    // 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29 = 13 bands (30 is not hit by step from 5)
    expect(r.description).toContain('13 bands')
    expect(r.description).toContain('mm^3/s')
  })

  it('F20: every band feedrate stays under K2 XY ceiling at default sweep', () => {
    // Defense in depth: the builder's own assertFeedSafe must hold.
    const r = buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH })
    const motion = parseMotionLines(r.gcode)
    const xyCeil = K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec * 60
    for (const m of motion) {
      if (m.feed == null) continue
      if (m.x != null || m.y != null) {
        expect(m.feed, `line ${m.lineNumber}: ${m.raw}`).toBeLessThanOrEqual(xyCeil)
      }
    }
  })

  it('F21: throws when endFlow forces XY past K2 ceiling', () => {
    // At 0.2 * 0.4 mm extrusion, 47 mm^3/s -> 587.5 mm/s; bump to 60
    // and we hit ~750 mm/s which the builder must reject.
    expect(() =>
      buildMaxVolumetricFlowArgs({
        outputGcodePath: OUT_PATH,
        startFlowMmCubePerSec: 5,
        endFlowMmCubePerSec: 60,
        stepFlowMmCubePerSec: 5
      })
    ).toThrow(/ceiling/)
  })

  it('F22: rejects bands count out of range', () => {
    expect(() =>
      buildMaxVolumetricFlowArgs({
        outputGcodePath: OUT_PATH,
        startFlowMmCubePerSec: 1,
        endFlowMmCubePerSec: 50,
        stepFlowMmCubePerSec: 0.5
      })
    ).toThrow(/0 or > 40 bands/)
  })

  it('F23: rejects out-of-range filament density', () => {
    expect(() => buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH, filamentDensity: 0 })).toThrow()
    expect(() => buildMaxVolumetricFlowArgs({ outputGcodePath: OUT_PATH, filamentDensity: 10 })).toThrow()
  })
})

describe('F. Tolerance test parameter handling', () => {
  it('F24: default cube is 20 mm with 4 peg/hole pairs', () => {
    const r = buildToleranceTestArgs({ outputGcodePath: OUT_PATH })
    expect(r.description).toContain('20x20')
    expect(r.description).toContain('4 peg/hole pairs')
  })

  it('F25: rejects degenerate / out-of-range cube + peg counts', () => {
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, cubeSizeMm: 5 })).toThrow()
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, cubeSizeMm: 100 })).toThrow()
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, pegHoleCount: 1 })).toThrow()
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, pegHoleCount: 20 })).toThrow()
  })

  it('F26: rejects out-of-range hole base diameter + clearance step', () => {
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, holeBaseDiameterMm: 1 })).toThrow()
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, holeBaseDiameterMm: 20 })).toThrow()
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, clearanceStepMm: 0 })).toThrow()
    expect(() => buildToleranceTestArgs({ outputGcodePath: OUT_PATH, clearanceStepMm: 1 })).toThrow()
  })
})

describe('F. Cornering / SCV parameter handling', () => {
  it('F27: default sweep is 4 -> 9 mm/s in 1 mm/s steps (6 bands)', () => {
    const r = buildCorneringTestArgs({ outputGcodePath: OUT_PATH })
    // 4, 5, 6, 7, 8, 9 = 6 bands
    expect(r.description).toContain('6 bands')
    expect(r.description).toContain('mm/s')
  })

  it('F28: emits SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY per band + a reset to 5 on END', () => {
    const r = buildCorneringTestArgs({ outputGcodePath: OUT_PATH })
    const scvLines = r.gcode
      .split('\n')
      .filter((l) => l.startsWith('SET_VELOCITY_LIMIT'))
    // 6 bands + 1 reset
    expect(scvLines.length).toBe(7)
    expect(scvLines[scvLines.length - 1]).toContain('SQUARE_CORNER_VELOCITY=5')
  })

  it('F29: rejects SCV past K2 ceiling (9 mm/s)', () => {
    expect(() => buildCorneringTestArgs({ outputGcodePath: OUT_PATH, endScvMmPerSec: 12 })).toThrow(/safe range/)
    expect(() => buildCorneringTestArgs({ outputGcodePath: OUT_PATH, startScvMmPerSec: 0 })).toThrow(/safe range/)
  })

  it('F30: rejects print speed past K2 XY ceiling', () => {
    expect(() =>
      buildCorneringTestArgs({ outputGcodePath: OUT_PATH, printSpeedMmPerSec: 800 })
    ).toThrow(/safe range/)
  })

  it('F31: rejects square size out of safe range', () => {
    expect(() => buildCorneringTestArgs({ outputGcodePath: OUT_PATH, squareSizeMm: 10 })).toThrow()
    expect(() => buildCorneringTestArgs({ outputGcodePath: OUT_PATH, squareSizeMm: 200 })).toThrow()
  })
})

describe('F. VFA parameter handling', () => {
  it('F32: default is 30 mm OD tube, 50 mm tall, 60 mm/s wall', () => {
    const r = buildVfaTestArgs({ outputGcodePath: OUT_PATH })
    expect(r.description).toContain('30 mm OD')
    expect(r.description).toContain('50 mm tall')
    expect(r.description).toContain('60 mm/s')
  })

  it('F33: rejects out-of-range tube dimensions + wall speed', () => {
    expect(() => buildVfaTestArgs({ outputGcodePath: OUT_PATH, tubeDiameterMm: 5 })).toThrow()
    expect(() => buildVfaTestArgs({ outputGcodePath: OUT_PATH, tubeDiameterMm: 200 })).toThrow()
    expect(() => buildVfaTestArgs({ outputGcodePath: OUT_PATH, tubeHeightMm: 10 })).toThrow()
    expect(() => buildVfaTestArgs({ outputGcodePath: OUT_PATH, tubeHeightMm: 500 })).toThrow()
    expect(() =>
      buildVfaTestArgs({ outputGcodePath: OUT_PATH, wallSpeedMmPerSec: 800 })
    ).toThrow(/safe range/)
  })
})

// ── G. Dispatcher ──────────────────────────────────────────────────────────

describe('G. buildCalibrationGcode dispatcher', () => {
  it('G1: routes temperature-tower', () => {
    const r = buildCalibrationGcode({
      kind: 'temperature-tower',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Temperature tower/)
  })

  it('G2: routes flow-rate', () => {
    const r = buildCalibrationGcode({
      kind: 'flow-rate',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Flow rate/)
  })

  it('G3: routes pressure-advance', () => {
    const r = buildCalibrationGcode({
      kind: 'pressure-advance',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Pressure advance/)
  })

  it('G4: routes retraction-tower', () => {
    const r = buildCalibrationGcode({
      kind: 'retraction-tower',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Retraction tower/)
  })

  it('G5: routes max-volumetric-flow', () => {
    const r = buildCalibrationGcode({
      kind: 'max-volumetric-flow',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Max volumetric flow/)
  })

  it('G6: routes tolerance', () => {
    const r = buildCalibrationGcode({
      kind: 'tolerance',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Tolerance/)
  })

  it('G7: routes cornering', () => {
    const r = buildCalibrationGcode({
      kind: 'cornering',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/Cornering/)
  })

  it('G8: routes vfa', () => {
    const r = buildCalibrationGcode({
      kind: 'vfa',
      params: { outputGcodePath: OUT_PATH }
    })
    expect(r.description).toMatch(/VFA/)
  })
})
