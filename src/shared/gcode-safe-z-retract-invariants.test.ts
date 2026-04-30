// Tests for src/shared/gcode-safe-z-retract-invariants.ts  [ID-0018-safez]
//
// Pure-function validator from Cycle 36. Sibling-module pattern to
// gcode-end-program-invariants.test.ts (Cycle 32 [ID-0108]) and
// gcode-header-invariants.test.ts (Cycle 28 [ID-0018]).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  resolveSafeZClearanceMm,
  safeZInvariantModeForMachine,
  validateGcodeSafeZRetractInvariants,
  type SafeZInvariantIssue
} from './gcode-safe-z-retract-invariants'
import { machineProfileSchema } from './machine-schema'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

function loadProfile(filename: string) {
  const raw = readFileSync(
    path.join(PROJECT_ROOT, 'resources', 'machines', filename),
    'utf-8'
  )
  return machineProfileSchema.parse(JSON.parse(raw))
}

describe('safeZInvariantModeForMachine', () => {
  it('returns "fdm" for fdm machines', () => {
    expect(safeZInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
  })
  it('returns "cnc" for cnc machines', () => {
    expect(safeZInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
  })
})

describe('resolveSafeZClearanceMm', () => {
  it('prefers safeRetractZMm when present and positive', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: 25,
        workAreaMm: { x: 100, y: 100, z: 200 }
      })
    ).toBe(25)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is undefined', () => {
    expect(
      resolveSafeZClearanceMm({
        workAreaMm: { x: 100, y: 100, z: 350 }
      })
    ).toBe(350)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is zero or negative', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: 0,
        workAreaMm: { x: 100, y: 100, z: 350 }
      })
    ).toBe(350)
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: -10,
        workAreaMm: { x: 100, y: 100, z: 350 }
      })
    ).toBe(350)
  })

  it('returns null when neither safeRetractZMm nor workAreaMm.z is positive', () => {
    // The runtime validator must defend against malformed callers, so
    // we cast through unknown to bypass the schema's positive-Z guard
    // for the null-branch test.
    expect(
      resolveSafeZClearanceMm({
        workAreaMm: { x: 100, y: 100, z: 0 } as unknown as {
          x: number
          y: number
          z: number
        }
      })
    ).toBeNull()
  })

  it('rejects non-finite safeRetractZMm and falls back', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: Number.NaN,
        workAreaMm: { x: 100, y: 100, z: 200 }
      })
    ).toBe(200)
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: Number.POSITIVE_INFINITY,
        workAreaMm: { x: 100, y: 100, z: 200 }
      })
    ).toBe(200)
  })
})

describe('validateGcodeSafeZRetractInvariants -- mode + degenerate inputs', () => {
  it('returns [] for fdm mode regardless of content', () => {
    const fdmGcode =
      'G21\nG90\nG1 X10 Y10 Z-5 F600\nM104 S210\n'
    expect(validateGcodeSafeZRetractInvariants(fdmGcode, 'fdm', 25)).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(validateGcodeSafeZRetractInvariants('', 'cnc', 25)).toEqual([])
    expect(validateGcodeSafeZRetractInvariants('   \n   ', 'cnc', 25)).toEqual([])
  })

  it('returns [] for header-only input with no cut moves', () => {
    const gcode = 'G21\nG90\nG17\nG54\nM5\nM30\n'
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })
})

describe('validateGcodeSafeZRetractInvariants -- happy path', () => {
  it('passes a canonical Laguna safe-Z retract sequence', () => {
    // Mirrors resources/posts/vcarve_mach3.hbs sequence: header -> spindle on
    // -> safe-Z retract -> rapid to start -> cuts -> safe-Z retract -> end.
    const gcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G4 P2.0',
      'G0 Z25',           // pre-cut safe-Z retract (>= 25)
      'G0 X10 Y10',       // XY rapid at safe Z -- modal Z=25, OK
      'G1 Z-5 F600',      // plunge to cut depth
      'G1 X100 Y100',     // cutting move
      'G0 Z25',           // end-cut safe-Z retract
      'G0 X0 Y0',         // park
      'M5',
      'G4 P3.0',
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  it('passes when safe-Z is exactly the threshold (equality counts as safe)', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',           // exactly at threshold
      'G1 Z-2 F100',
      'G1 X10',
      'G0 Z25',           // exactly at threshold again
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  it('passes when safeClearanceMm is null and Z>0 covers the lifts', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z5',            // > 0 -- safe under null-threshold rule
      'G1 Z-1 F100',
      'G1 X10',
      'G0 Z5',            // > 0 -- safe
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', null)).toEqual([])
  })

  it('passes when no cut moves are present (header-only / empty toolpath)', () => {
    const gcode = 'G21\nG90\nG0 Z5\nM5\nM2\n'
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })
})

describe('validateGcodeSafeZRetractInvariants -- RETRACT_NO_PRE_CUT_RETRACT', () => {
  it('flags a cut move with no prior G0 Z lift', () => {
    const gcode = [
      'G21',
      'G90',
      'G1 X10 Y10 F600',  // first cut, no safe-Z first
      'G0 Z25',           // late retract -- still missing pre-cut
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')).toBe(true)
    const issue = issues.find(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')!
    expect(issue.level).toBe('error')
    expect(issue.line).toBe(3) // first cut line
  })

  it('flags when the only pre-cut Z is below safe clearance', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z10',           // below threshold of 25
      'G1 X10 Y10 F600',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')).toBe(true)
  })

  it('does NOT flag when safe-Z lift comes BEFORE the first cut', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 X10 F600',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')).toBe(false)
  })

  it('treats G2/G3 arcs as cut moves for the pre-cut check', () => {
    const gcode = [
      'G21',
      'G90',
      'G17',
      'G2 X10 Y0 I5 J0 F600', // first motion is an arc; no prior retract
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')).toBe(true)
  })
})

describe('validateGcodeSafeZRetractInvariants -- RETRACT_NO_END_RETRACT', () => {
  it('flags when no safe-Z retract follows the last cut before M30', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-2 F100',
      'G1 X10 Y10',       // last cut
      'M5',
      'M30'               // no end-retract before this
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(true)
    const issue = issues.find(i => i.code === 'RETRACT_NO_END_RETRACT')!
    expect(issue.level).toBe('error')
    expect(issue.line).toBe(7) // M30 line
  })

  it('flags when end-retract is below the safe threshold', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 X10 Y10 F600',
      'G0 Z10',           // partial retract, below threshold
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(true)
  })

  it('does NOT flag when a G0 Z>=safe lift appears between last cut and M2/M30', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 X10 Y10 F600',
      'G0 Z25',           // end-retract OK
      'G0 X0 Y0',         // park (XY at safe Z)
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(false)
  })

  it('end-retract requirement re-arms after a new cut sequence', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 X10 F600',
      'G0 Z25',           // retract between op 1 and op 2
      'G0 X20 Y20',       // XY transit at safe Z
      'G1 Z-2',
      'G1 X30',           // op 2 cuts
      'M30'               // missing post-op-2 retract
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(true)
  })
})

describe('validateGcodeSafeZRetractInvariants -- RETRACT_XY_RAPID_AT_CUT_DEPTH', () => {
  it('flags a pure XY rapid while modal Z is below safe clearance', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',           // pre-cut retract (so we do not fire NO_PRE_CUT)
      'G1 Z-5 F100',
      'G1 X10 Y10',
      'G0 X50 Y50',       // OFFENDER: rapid in XY, modal Z=-5
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xy = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xy).toHaveLength(1)
    expect(xy[0]!.level).toBe('error')
    expect(xy[0]!.line).toBe(6)
  })

  it('flags a combined XYZ rapid when Z drops below safe clearance', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-2 F100',
      'G1 X10',
      'G0 X20 Y20 Z-3',   // OFFENDER: combined rapid plunging to Z=-3
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xy = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xy).toHaveLength(1)
    expect(xy[0]!.line).toBe(6)
  })

  it('does NOT flag a G0 Z lift (no XY, going up)', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-2 F100',
      'G1 X10',
      'G0 Z25',           // pure Z lift -- NOT an XY rapid
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(
      issues.some(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBe(false)
  })

  it('does NOT flag a G1 cut transit (cut moves are allowed at depth)', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-2 F100',
      'G1 X10 Y10',       // cut, not a rapid
      'G1 X20 Y20',       // cut, not a rapid -- OK even though Z is deep
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(
      issues.some(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBe(false)
  })

  it('emits one issue per offending line, in line order', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-5 F100',
      'G1 X10',
      'G0 X20 Y20',       // OFFENDER 1
      'G1 X30',
      'G0 X40 Y40',       // OFFENDER 2
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xy = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xy).toHaveLength(2)
    expect(xy[0]!.line).toBe(6)
    expect(xy[1]!.line).toBe(8)
  })

  it('uses null-threshold (Z>0) when safeClearanceMm is null', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z5',
      'G1 Z-1 F100',
      'G1 X10',
      'G0 X20 Y20',       // OFFENDER under null rule -- modal Z = -1 <= 0
      'G0 Z5',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', null)
    expect(
      issues.some(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBe(true)
  })

  it('honors modal motion -- a bare X/Y line after G0 inherits rapid mode', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-3 F100',
      'G1 X10',
      'G0 X20',           // explicit G0 -- OFFENDER, modal Z=-3
      'X30 Y30',          // modal G0 inherited from prior line -- OFFENDER
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xy = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xy.length).toBeGreaterThanOrEqual(2)
  })
})

describe('validateGcodeSafeZRetractInvariants -- comments + parsing edge cases', () => {
  it('strips ;-comments before checking motion', () => {
    const gcode = [
      'G21',
      'G90',
      '; G1 X10 Y10  -- this is a comment, not a cut move',
      'G0 Z25',
      'G1 X5 F100',       // first real cut
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    // The commented G1 must NOT count as the first cut, so the pre-cut
    // retract on line 4 satisfies the invariant for line 5.
    expect(
      issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBe(false)
  })

  it('strips parenthetical comments before checking motion', () => {
    const gcode = [
      'G21',
      'G90',
      '(G1 X10 Y10 -- parenthetical comment, not a cut)',
      'G0 Z25',
      'G1 X5 F100',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(
      issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBe(false)
  })

  it('handles CRLF line endings', () => {
    const gcode =
      'G21\r\nG90\r\nG0 Z25\r\nG1 X10 F100\r\nG0 Z25\r\nM30\r\n'
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('parses leading-zero G-codes (G00, G01) the same as G0/G1', () => {
    const gcode = [
      'G21',
      'G90',
      'G00 Z25',          // G00 = G0
      'G01 X10 F100',     // G01 = G1
      'G00 Z25',
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  it('does NOT match G10 (offset) or G17 (plane) as G1 motion', () => {
    const gcode = [
      'G21',
      'G90',
      'G17',              // plane select -- NOT a cut
      'G10 L20 P1 X0 Y0 Z0', // tool offset -- NOT a cut
      'G0 Z25',
      'G1 X5 F100',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    // If G17 were misread as G1, it would be the first cut and fire
    // RETRACT_NO_PRE_CUT_RETRACT. It must not.
    expect(
      issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBe(false)
  })

  it('parses negative Z values correctly', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G1 Z-12.5 F100',
      'G1 X10',
      'G0 X20 Y20',       // modal Z=-12.5 -- below threshold
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(
      issues.some(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBe(true)
  })
})

describe('validateGcodeSafeZRetractInvariants -- issue ordering', () => {
  it('orders issues: NO_PRE_CUT, NO_END, then XY_RAPID per-occurrence', () => {
    const gcode = [
      'G21',
      'G90',
      // NO pre-cut retract.
      'G1 Z-2 F100',
      'G1 X10',
      'G0 X20 Y20',       // XY rapid at depth -- offender 1
      'G0 X30 Y30',       // XY rapid at depth -- offender 2
      // NO end-cut retract.
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.map(i => i.code)).toEqual([
      'RETRACT_NO_PRE_CUT_RETRACT',
      'RETRACT_NO_END_RETRACT',
      'RETRACT_XY_RAPID_AT_CUT_DEPTH',
      'RETRACT_XY_RAPID_AT_CUT_DEPTH'
    ])
  })

  it('omits NO_PRE_CUT when satisfied but still emits NO_END + XY rapids', () => {
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',           // pre-cut retract OK
      'G1 Z-2 F100',
      'G1 X10',
      'G0 X20 Y20',       // XY rapid at depth -- offender
      'M30'               // missing end-retract
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.map(i => i.code)).toEqual([
      'RETRACT_NO_END_RETRACT',
      'RETRACT_XY_RAPID_AT_CUT_DEPTH'
    ])
  })
})

describe('validateGcodeSafeZRetractInvariants -- bundled machine profiles', () => {
  it('Laguna Swift 5x10 -- safeRetractZMm = 25 resolves correctly', () => {
    const machine = loadProfile('laguna-swift-5x10.json')
    expect(safeZInvariantModeForMachine(machine)).toBe('cnc')
    const clearance = resolveSafeZClearanceMm(machine)
    expect(clearance).toBe(25)
  })

  it('Makera Carvera 4-axis -- falls back to workAreaMm.z', () => {
    const machine = loadProfile('makera-carvera-4axis.json')
    expect(safeZInvariantModeForMachine(machine)).toBe('cnc')
    const clearance = resolveSafeZClearanceMm(machine)
    expect(clearance).toBe(machine.workAreaMm.z)
    expect(clearance).toBeGreaterThan(0)
  })

  it('Creality K2 Plus -- fdm short-circuits to []', () => {
    const machine = loadProfile('creality-k2-plus.json')
    expect(safeZInvariantModeForMachine(machine)).toBe('fdm')
    const mode = safeZInvariantModeForMachine(machine)
    const synthGcode = 'G1 X10 Y10 Z-5 F600\n'
    expect(
      validateGcodeSafeZRetractInvariants(synthGcode, mode, 350)
    ).toEqual([])
  })

  it('end-to-end: realistic Laguna G-code with the bundled profile passes', () => {
    const machine = loadProfile('laguna-swift-5x10.json')
    const mode = safeZInvariantModeForMachine(machine)
    const clearance = resolveSafeZClearanceMm(machine)
    const gcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G4 P2.0',
      'G0 Z25',
      'G0 X10 Y10',
      'G1 Z-2 F600',
      'G1 X100 Y100',
      'G1 X100 Y200',
      'G0 Z25',
      'G0 X0 Y0',
      'M5',
      'G4 P3.0',
      'M30'
    ].join('\n')
    expect(
      validateGcodeSafeZRetractInvariants(gcode, mode, clearance)
    ).toEqual([])
  })

  it('end-to-end: synthetic Laguna G-code with cut-depth XY rapid is flagged', () => {
    const machine = loadProfile('laguna-swift-5x10.json')
    const mode = safeZInvariantModeForMachine(machine)
    const clearance = resolveSafeZClearanceMm(machine)
    const gcode = [
      'G21',
      'G90',
      'G54',
      'G0 Z25',
      'G1 Z-3 F600',
      'G1 X50 Y50',
      'G0 X120 Y200',     // OFFENDER -- rapid at Z=-3 (below 25mm safeRetract)
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues: SafeZInvariantIssue[] = validateGcodeSafeZRetractInvariants(
      gcode,
      mode,
      clearance
    )
    expect(
      issues.some(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBe(true)
  })
})

describe('validateGcodeSafeZRetractInvariants -- modal-state edge cases (DISCOVERED-2026-04-25 [ID-0109b])', () => {
  // The validator does NOT track G90/G91 (absolute vs incremental positioning)
  // nor G92 (origin reset) modal state today. Z values are read literally as
  // if every program is in absolute mode (G90). These tests pin the CURRENT
  // behavior so any future incremental-aware revision is a deliberate change
  // and not a silent regression.

  it('G91 incremental: G0 Z25 still counts as a pre-cut safe-Z (absolute interpretation)', () => {
    // Real Klipper / RichAuto interpretation: `G91 / G0 Z25` raises Z by 25mm
    // FROM CURRENT, not to absolute Z=25. Validator treats Z=25 as absolute
    // and (with safeClearance=25) accepts it as a safe pre-cut retract. This
    // is a known limitation -- tracked here so any behavior change is loud.
    const gcode = ['G91', 'G0 Z25', 'G1 X10 F500', 'M30'].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')).toBe(false)
    // End-retract still missing (no Z lift between G1 X10 and M30) -- pinned.
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(true)
  })

  it('G91 incremental: G0 Z-25 is treated as below-safe (absolute interpretation)', () => {
    // Real interpretation: `G91 / G0 Z-25` lowers Z by 25mm. From an unknown
    // start that could be anywhere. Validator reads literal Z=-25 < safe=25
    // and so the first G1 cut fires NO_PRE_CUT_RETRACT. Pins the literal
    // reading -- any future incremental-aware revision should change this.
    const gcode = ['G91', 'G0 Z-25', 'G1 X10 F500', 'G0 Z25', 'M30'].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')).toBe(true)
  })

  it('G92 Z0 origin reset overwrites modal Z without an actual move', () => {
    // Real interpretation: `G92 Z0` declares the current Z to be the new
    // logical zero -- the bit does not move. Validator parses the Z0 word
    // and updates modalZ=0 as if the toolhead moved. Any subsequent G0 X/Y
    // is then flagged as a cut-depth transit, even though physically the
    // toolhead is still at the prior safe height. Pin the literal behavior.
    const gcode = [
      'G0 Z25',           // safe pre-cut retract
      'G1 X5 Z-2 F500',   // first cut
      'G92 Z0',           // origin reset -- validator sees modalZ := 0
      'G0 X20',           // pure XY rapid; modalZ=0 < safe=25 -> FLAG
      'G0 Z25',           // end retract
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xyRapids = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xyRapids).toHaveLength(1)
    expect(xyRapids[0]!.line).toBe(4) // G0 X20 line
  })

  it('G92 X0 Y0 origin reset (no Z word) does not perturb modal Z tracking', () => {
    // G92 X0 Y0 has no Z word; modalZ must NOT get clobbered. Pin that the
    // validator's extractWord('Z') correctly returns null and modalZ persists.
    const gcode = [
      'G0 Z25',           // safe pre-cut
      'G1 X5 Z-2 F500',   // first cut
      'G92 X0 Y0',        // XY origin reset; no Z word
      'G0 Z25',           // end retract -- modalZ rises back to safe
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')).toHaveLength(0)
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(false)
  })

  it('modal G0 bleeds across an M-code: bare X/Y after M3 still classifies as rapid', () => {
    // After `M3 S12000` (spindle on, no motion change) a bare `X20 Y20` line
    // must inherit the prior G0 modal. With the prior modalZ at safe, this
    // is a safe XY rapid above clearance -- no flag.
    const gcode = [
      'G0 Z25',           // safe; modalMotion=0, modalZ=25
      'G0 X10 Y10',       // safe XY rapid above clearance
      'M3 S12000',        // spindle on -- no motion change
      'X20 Y20',          // BARE XY -- inherits G0 modal; modalZ=25 -> safe
      'G1 Z-2 F500',      // first cut
      'G0 Z25',           // end retract
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues).toHaveLength(0)
  })

  it('modal G0 bleeds across M3: G0 X/Y after M3 at cut depth IS flagged', () => {
    // Sister test to the above. After a cut, a G0 X/Y issued *across* an M3
    // line (spindle on between operations) must still be flagged because the
    // modal Z is still at cut depth.
    const gcode = [
      'G0 Z25',           // safe pre-cut
      'G1 X5 Z-2 F500',   // first cut; modalZ=-2
      'M3 S12000',        // M-code in between -- modalZ unchanged
      'G0 X10 Y10',       // rapid at cut depth (modalZ=-2) -> FLAG
      'G0 Z25',           // end retract
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xyRapids = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xyRapids).toHaveLength(1)
    expect(xyRapids[0]!.line).toBe(4) // G0 X10 Y10 line
  })

  it('modal G1 bleeds across M-code: bare X/Y after M5 inherits cut, not rapid', () => {
    // After a G1 cut and an M5 spindle-off, a bare `X10 Y10` line must inherit
    // the G1 modal -- it is a CUT, not a rapid. The validator treats it as a
    // cut move (lastCutLine update, end-retract requirement re-armed). When
    // the trailing G0 Z25 follows, end-retract is satisfied.
    const gcode = [
      'G0 Z25',           // safe pre-cut
      'G1 X5 Y5 Z-2 F500',// first cut; modalMotion=1, modalZ=-2
      'M5',               // spindle off -- no motion change
      'X10 Y10',          // BARE XY -- inherits G1 modal (cut, not rapid)
      'G0 Z25',           // end retract -- satisfies endRetractAfterCut
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    // Bare X10 Y10 is treated as a cut, so it is NOT flagged as an XY rapid.
    expect(issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')).toHaveLength(0)
    // End retract is satisfied by the trailing G0 Z25.
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(false)
    expect(issues).toHaveLength(0)
  })

  it('M3 + S word alone does not reset modal motion or modal Z', () => {
    // Pin that no M-code (other than M2/M30) interrupts modal state. M-words
    // appear between motion blocks in every real CNC program; the validator
    // must not treat them as a "barrier" that resets modal tracking.
    const gcode = [
      'G0 Z25',
      'M3 S12000',        // spindle on
      'M8',               // coolant on (Laguna often uses this)
      'M7',               // mist on (Laguna dust collection alias)
      'G1 X5 Z-2 F500',   // first cut -- modal G0 from line 1 was overwritten
      'M9',               // coolant off
      'G0 Z25',           // end retract
      'M5',               // spindle off
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues).toHaveLength(0)
  })

  it('program-end M2/M30 always halts the walk -- subsequent lines are ignored', () => {
    // Pin that any text after M30 is ignored, even if it would otherwise
    // trigger flags. This is the documented "stop walking once the program
    // terminates" rule and matters because real .nc files often carry
    // human-readable trailers ("; end of program") after M30.
    const gcode = [
      'G0 Z25',
      'G1 X5 Z-2 F500',   // first cut
      'G0 Z25',           // end retract
      'M30',              // program end
      'G0 X10 Y10',       // post-end -- must be IGNORED
      'G1 Z-50 F100'      // post-end -- must be IGNORED
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues).toHaveLength(0)
  })
})

describe('validateGcodeSafeZRetractInvariants -- rotary 4-axis + multi-pass + tokenization edge cases (DISCOVERED-2026-04-25 [ID-0109c])', () => {
  // Cycle 43 follow-up to the Cycle 36 [ID-0109] validator + Cycle 38
  // [ID-0109b] modal-state edge cases. Pins behavior the validator already
  // exhibits but no test pinned: rotary 4th-axis non-interference (Carvera),
  // multi-pass roughing happy paths, tool-change-mid-program patterns, and
  // tokenization edge cases (tab-separated, equality at threshold, end-to-end
  // bundled Carvera profile). Pure test-only -- production code unchanged.

  // ----------------------------------------------------------------------
  // Rotary 4-axis (Carvera) non-interference
  // ----------------------------------------------------------------------

  it('rotary: pure A-only G0 rotation does NOT fire XY rapid (no X/Y motion)', () => {
    // The Carvera 4-axis post emits G0 A-only rotations between indexed
    // passes (e.g. between contour wrap segments). The validator must not
    // mistake an A-only rapid for an XY rapid.
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',           // pre-cut safe-Z
      'G0 X10 Y0',
      'G1 Z-2 F500',
      'G1 X20 Y0',        // first cut
      'G0 Z25',           // end retract (covers end-retract too)
      'G0 A180',          // PURE A rotation -- modal Z back at 25, but...
      'G0 A270',          // PURE A again -- still at safe Z, no flag.
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('rotary: A-only G0 while modalZ is BELOW safe does NOT fire XY rapid (A is not X or Y)', () => {
    // Even when the rotary rapid happens at cut depth, it is rotary motion
    // not XY transit -- the validator must NOT flag it. (The cut-depth
    // rotary case is real on the Carvera: indexed strategy parks at depth
    // and indexes A between passes inside a single multi-stepdown pass.)
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G0 X10 Y0',
      'G1 Z-2 F500',      // modalZ now -2 (below safe 25)
      'G0 A90',           // A-only rapid AT CUT DEPTH -- must NOT flag.
      'G1 X20 Y0 F500',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH'))
      .toEqual([])
  })

  it('rotary: combined A+X rapid at cut depth IS flagged (X moves, A is incidental)', () => {
    // If a G0 rapids X *and* A together at cut depth, the X transit is
    // still a cut-depth XY rapid -- the A-word does not shield it.
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G0 X10 Y0',
      'G1 Z-2 F500',
      'G0 X50 A90',       // OFFENDER -- X transits at modal Z=-2.
      'G1 X60 Y0 F500',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    expect(issues.some(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH'))
      .toBe(true)
  })

  // ----------------------------------------------------------------------
  // Multi-pass roughing happy path
  // ----------------------------------------------------------------------

  it('multi-pass roughing: three cut/lift/reposition cycles all green', () => {
    // Realistic adaptive-clear pattern: lift, plunge, cut, lift, repo,
    // plunge, cut, lift, repo, plunge, cut, lift, end. Validator must not
    // flag any of the between-pass rapids because every reposition is at
    // safe Z.
    const gcode = [
      'G21',
      'G90',
      'G17',
      'G0 Z25',           // pre-cut safe lift
      'G0 X10 Y10',
      'G1 Z-1 F300',
      'G1 X90 Y10 F800',  // pass 1
      'G0 Z25',
      'G0 X10 Y20',       // repo at safe Z
      'G1 Z-1 F300',
      'G1 X90 Y20 F800',  // pass 2
      'G0 Z25',
      'G0 X10 Y30',       // repo at safe Z
      'G1 Z-1 F300',
      'G1 X90 Y30 F800',  // pass 3
      'G0 Z25',           // final end retract
      'M5',
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  it('multi-pass roughing: a single missing mid-program lift IS flagged', () => {
    // Same shape as above but pass-2 reposition forgot the lift. One
    // RETRACT_XY_RAPID_AT_CUT_DEPTH expected, anchored to the offending
    // line. End-retract still satisfied by the final G0 Z25.
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',
      'G0 X10 Y10',
      'G1 Z-1 F300',
      'G1 X90 Y10 F800',  // pass 1, modalZ now -1
      // MISSING: G0 Z25 here -- reposition below safe.
      'G0 X10 Y20',       // OFFENDER (line 7)
      'G1 Z-1 F300',
      'G1 X90 Y20 F800',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const xy = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xy).toHaveLength(1)
    expect(xy[0]!.line).toBe(7)
  })

  // ----------------------------------------------------------------------
  // Tool-change-mid-program pattern
  // ----------------------------------------------------------------------

  it('tool change: lift -> M6 T2 -> plunge -> cut -> lift is green end-to-end', () => {
    // Carvera ATC tool-change sequence pattern. M6/T-words are non-motion;
    // they must not perturb modal state. Validator only sees motion + the
    // M2/M30 program-end, so M6 is invisible.
    const gcode = [
      'G21',
      'G90',
      'G0 Z25',           // pre-cut safe lift
      'G0 X10 Y10',
      'G1 Z-1 F300',
      'G1 X50 Y10 F800',  // tool 1 cut
      'G0 Z25',           // lift before tool change
      'M5',
      'T2 M6',            // tool change
      'M3 S15000',
      'G0 X20 Y20',       // reposition at safe Z (still at 25)
      'G1 Z-1 F300',
      'G1 X80 Y20 F800',  // tool 2 cut
      'G0 Z25',           // end retract
      'M5',
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  // ----------------------------------------------------------------------
  // Equality-at-threshold for combined rapids
  // ----------------------------------------------------------------------

  it('combined XYZ rapid at Z exactly equal to safe clearance counts as safe', () => {
    // The validator's `isSafeZ` rule is `z >= safeClearanceMm`. Pin that
    // a combined-axis rapid landing EXACTLY at the threshold passes both
    // the pre-cut and end-retract checks. Bundled posts emit
    // `G0 Z{{machine.workAreaMm.z}}` -- exactly at the envelope ceiling.
    const gcode = [
      'G21',
      'G90',
      'G0 X10 Y10 Z25',   // combined pre-cut lift -- Z exactly at 25.
      'G1 Z-2 F500',
      'G1 X20 Y10 F500',
      'G0 X100 Y100 Z25', // combined end retract -- Z exactly at 25.
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  it('combined XYZ rapid at Z just below safe (Z=24.999) flags pre-cut + xy-rapid', () => {
    // Off-by-tiny pin -- the threshold is strict (`>=`). A combined rapid
    // landing at 24.999 with safe=25 fails to count, AND its X/Y motion
    // at sub-safe Z fires the cut-depth XY rapid invariant.
    const gcode = [
      'G21',
      'G90',
      'G0 X10 Y10 Z24.999',  // combined XYZ rapid below safe -- offender.
      'G1 Z-2 F500',
      'G1 X20 Y10 F500',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)
    const codes = issues.map(i => i.code)
    expect(codes).toContain('RETRACT_NO_PRE_CUT_RETRACT')
    expect(codes).toContain('RETRACT_XY_RAPID_AT_CUT_DEPTH')
  })

  // ----------------------------------------------------------------------
  // Tokenization robustness
  // ----------------------------------------------------------------------

  it('tab-separated tokens parsed correctly (G0\\tX10\\tY10\\tZ25)', () => {
    // Some posts emit tabs between words instead of spaces. The validator's
    // word-extraction regex must handle either separator.
    const gcode = [
      'G21',
      'G90',
      'G0\tZ25',
      'G0\tX10\tY10',
      'G1\tZ-2\tF500',
      'G1\tX20\tY10\tF500',
      'G0\tZ25',
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  it('blank lines + comment-only lines do not perturb modal state', () => {
    // Realistic .nc file shape with blank-line groupings + ;-comment
    // headers. Validator must skip them transparently.
    const gcode = [
      '; --- header ---',
      'G21',
      'G90',
      '',
      '; pre-cut lift',
      'G0 Z25',
      '',
      '; first pass',
      'G0 X10 Y10',
      'G1 Z-2 F500',
      'G1 X20 Y10 F500',
      '',
      '; end retract',
      'G0 Z25',
      'M30',
      '',
      '; --- end of program ---'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(gcode, 'cnc', 25)).toEqual([])
  })

  // ----------------------------------------------------------------------
  // End-to-end with the bundled Carvera 4-axis profile
  // ----------------------------------------------------------------------

  it('end-to-end: realistic Carvera 4-axis G-code with the bundled profile passes', () => {
    // Pin that a realistic indexed-rotary program -- cuts at four index
    // angles A=0/90/180/270 -- is green when the bundled Carvera profile
    // resolves the safe clearance (workAreaMm.z = 46 mm fallback).
    const machine = loadProfile('makera-carvera-4axis.json')
    const mode = safeZInvariantModeForMachine(machine)
    const clearance = resolveSafeZClearanceMm(machine)
    expect(clearance).toBe(46)
    const gcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S13000',
      'G0 Z46',           // pre-cut safe-Z (= workAreaMm.z fallback)
      'G0 A0',
      'G0 X10 Y0',
      'G1 Z-1 F500',
      'G1 X20 Y0 F800',
      'G0 Z46',           // lift before A index
      'G0 A90',
      'G0 X10 Y0',
      'G1 Z-1 F500',
      'G1 X20 Y0 F800',
      'G0 Z46',
      'G0 A180',
      'G0 X10 Y0',
      'G1 Z-1 F500',
      'G1 X20 Y0 F800',
      'G0 Z46',
      'G0 A270',
      'G0 X10 Y0',
      'G1 Z-1 F500',
      'G1 X20 Y0 F800',
      'G0 Z46',           // end retract
      'M5',
      'M30'
    ].join('\n')
    expect(
      validateGcodeSafeZRetractInvariants(gcode, mode, clearance)
    ).toEqual([])
  })

  it('end-to-end: synthetic Carvera 4-axis G-code missing an inter-index lift fires xy-rapid + end-retract', () => {
    // Same indexed-rotary pattern but the lift before A=180 was forgotten.
    // The G0 X10 Y0 reposition at modal Z=-1 is a cut-depth XY transit;
    // the missing lift means modal Z stays sub-safe through subsequent
    // moves until the next G0 Z46. End-retract is still emitted at the
    // bottom (so NO_END_RETRACT does NOT fire), but XY rapid does.
    const machine = loadProfile('makera-carvera-4axis.json')
    const mode = safeZInvariantModeForMachine(machine)
    const clearance = resolveSafeZClearanceMm(machine)
    const gcode = [
      'G21',
      'G90',
      'G54',
      'G0 Z46',
      'G0 X10 Y0',
      'G1 Z-1 F500',
      'G1 X20 Y0 F800',   // first cut, modalZ -1
      // MISSING: G0 Z46 here.
      'G0 A180',          // A-only -- not flagged.
      'G0 X10 Y0',        // OFFENDER -- XY rapid at modal Z=-1.
      'G1 X20 Y0 F800',
      'G0 Z46',           // end retract -- satisfies NO_END_RETRACT.
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(gcode, mode, clearance)
    const xy = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xy.length).toBeGreaterThanOrEqual(1)
    expect(issues.some(i => i.code === 'RETRACT_NO_END_RETRACT')).toBe(false)
  })
})
