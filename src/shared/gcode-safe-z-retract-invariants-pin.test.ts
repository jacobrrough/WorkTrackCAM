// ---------------------------------------------------------------------------
// gcode-safe-z-retract-invariants-pin.test.ts  [ID-0274]
// ---------------------------------------------------------------------------
// Co-located paired-pin contract for `src/shared/gcode-safe-z-retract-
// invariants.ts` (421-line / ~16 KB SHARED post-pipeline safe-Z retract
// invariant validator [ID-0018-safez] from Cycle 36; sibling-module pattern
// to `gcode-end-program-invariants.ts` pinned in Cycle 175 / [ID-0245] and
// `gcode-header-invariants.ts` pinned in Cycle 168 / [ID-0240]).
//
// Three exported runtime values:
//   - `validateGcodeSafeZRetractInvariants(gcode, mode, safeClearanceMm)`
//     -- arity 3, returns an issue array (RETRACT_NO_PRE_CUT_RETRACT,
//     RETRACT_NO_END_RETRACT, RETRACT_XY_RAPID_AT_CUT_DEPTH; all errors).
//   - `safeZInvariantModeForMachine(machine)` -- arity 1, returns 'fdm' or
//     'cnc'.
//   - `resolveSafeZClearanceMm(machine)` -- arity 1, returns the explicit
//     `safeRetractZMm` if positive-finite, else `workAreaMm.z` if positive-
//     finite, else null.
//
// Production hook: ready for `src/main/post-process.ts` integration beside
// the three sibling validators.
//
// Existing behavioral coverage in `gcode-safe-z-retract-invariants.test.ts`
// (1102 lines) covers happy paths, failure cases, and edge-case G-code
// shapes. This pin file extends to lock the SURFACE contract: module shape,
// function signatures, mode coercion, clearance resolution preference,
// FDM short-circuit, empty-input boundary, issue object EXACT 4-key shape,
// canonical issue order (NO_PRE_CUT_RETRACT -> NO_END_RETRACT -> XY_RAPID_
// AT_CUT_DEPTH per-occurrence in line order), the three-invariant code set
// EXHAUSTIVE, comment-strip contract (paren + semicolon + mixed), modal
// motion preservation, modal Z preservation, program-end M-word stop
// behavior, three-machine path realism (K2 Plus FDM short-circuit / Laguna
// 25 mm safe-Z / Carvera 3-axis 140 mm fallback / Carvera 4-axis 46 mm
// fallback), source-text whitelist on each canonical message, and pure-
// function invariants (idempotent N=20, no input mutation, no this-binding
// leak, fresh Array each call, plain-Array prototype, output bounded by
// 2 + occurrences).
//
// ASSUMPTION: the module exports exactly THREE RUNTIME values
// (`validateGcodeSafeZRetractInvariants`, `safeZInvariantModeForMachine`,
// `resolveSafeZClearanceMm`) and THREE TYPE-only aliases
// (`SafeZInvariantLevel`, `SafeZInvariantIssue`, `SafeZInvariantMode`).
// Type-only exports are erased at runtime so they never appear in
// `Object.keys(module)`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import * as Mod from './gcode-safe-z-retract-invariants'
import {
  resolveSafeZClearanceMm,
  safeZInvariantModeForMachine,
  validateGcodeSafeZRetractInvariants
} from './gcode-safe-z-retract-invariants'
import type {
  SafeZInvariantIssue,
  SafeZInvariantLevel,
  SafeZInvariantMode
} from './gcode-safe-z-retract-invariants'
import type { MachineProfile } from './machine-schema'

// ---------------------------------------------------------------------------
// Test helpers / canonical samples
// ---------------------------------------------------------------------------

/** Good Mach3 program -- pre-cut retract, end retract, no XY-at-depth rapid. */
const GOOD_MACH3_25 = [
  'G21',
  'G90',
  'G17',
  'G54',
  'G0 Z25',
  'M3 S12000',
  'G4 P2.0',
  'G0 X10 Y10',
  'G1 Z-2.0 F200',
  'G1 X20 Y10',
  'G0 Z25',
  'M5',
  'M30'
].join('\n')

/** Good GRBL-style program with safeClearance=null fallback (Z>0 = safe). */
const GOOD_NULL_CLEARANCE = [
  'G21',
  'G90',
  'G0 Z5',
  'M3 S20000',
  'G0 X1 Y1',
  'G1 Z-1 F100',
  'G1 X2',
  'G0 Z5',
  'M5',
  'M2'
].join('\n')

/** Program with NO pre-cut safe retract (first cut at Z=-1 from boot). */
const NO_PRE_CUT_RETRACT = [
  'G21',
  'G90',
  'M3 S12000',
  'G1 Z-1 F200',
  'G1 X10',
  'G0 Z25',
  'M30'
].join('\n')

/** Program with NO end retract -- ends with M30 from cut depth. */
const NO_END_RETRACT = [
  'G21',
  'G90',
  'G0 Z25',
  'M3 S12000',
  'G1 Z-1 F200',
  'G1 X10',
  'M30'
].join('\n')

/** Pure XY rapid at cut depth (modal Z=-2 transit). */
const XY_RAPID_AT_DEPTH = [
  'G21',
  'G90',
  'G0 Z25',
  'M3 S12000',
  'G1 Z-2 F200',
  'G1 X5',
  'G0 X20 Y20',
  'G0 Z25',
  'M30'
].join('\n')

/** Combined-XYZ rapid that drops below safe clearance (plunge rapid). */
const COMBINED_XYZ_RAPID_BELOW_SAFE = [
  'G21',
  'G90',
  'G0 Z25',
  'M3 S12000',
  'G0 X10 Y10 Z-2',
  'G1 X20 F200',
  'G0 Z25',
  'M30'
].join('\n')

// ---------------------------------------------------------------------------
// (A) Module shape -- exact runtime export inventory
// ---------------------------------------------------------------------------
describe('[ID-0274] (A) module shape -- exact runtime export inventory', () => {
  it('exports exactly three runtime values', () => {
    const keys = Object.keys(Mod).sort()
    expect(keys).toEqual(
      [
        'resolveSafeZClearanceMm',
        'safeZInvariantModeForMachine',
        'validateGcodeSafeZRetractInvariants'
      ].sort()
    )
  })

  it('validateGcodeSafeZRetractInvariants is a function value', () => {
    expect(typeof Mod.validateGcodeSafeZRetractInvariants).toBe('function')
  })

  it('safeZInvariantModeForMachine is a function value', () => {
    expect(typeof Mod.safeZInvariantModeForMachine).toBe('function')
  })

  it('resolveSafeZClearanceMm is a function value', () => {
    expect(typeof Mod.resolveSafeZClearanceMm).toBe('function')
  })

  it('module Symbol.toStringTag (if present) is Module', () => {
    const tag = (Mod as unknown as { [Symbol.toStringTag]?: string })[
      Symbol.toStringTag
    ]
    expect(tag === undefined || tag === 'Module').toBe(true)
  })

  it('no extra runtime exports beyond the documented three', () => {
    expect(Object.keys(Mod).length).toBe(3)
  })

  it('does NOT leak the private stripComments helper', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).stripComments
    ).toBeUndefined()
  })

  it('does NOT leak the private extractWord helper', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).extractWord
    ).toBeUndefined()
  })

  it('does NOT leak the private extractMotionMode helper', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).extractMotionMode
    ).toBeUndefined()
  })

  it('does NOT leak the private extractMWords helper', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).extractMWords
    ).toBeUndefined()
  })

  it('does NOT leak the private isSafeZ / isCutDepthZ helpers', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).isSafeZ
    ).toBeUndefined()
    expect(
      (Mod as unknown as Record<string, unknown>).isCutDepthZ
    ).toBeUndefined()
  })

  it('does NOT leak the private PROGRAM_END_M_WORDS constant', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).PROGRAM_END_M_WORDS
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (B) Function signatures
// ---------------------------------------------------------------------------
describe('[ID-0274] (B) function signatures', () => {
  it('validateGcodeSafeZRetractInvariants.length === 3 (arity 3)', () => {
    expect(validateGcodeSafeZRetractInvariants.length).toBe(3)
  })

  it('safeZInvariantModeForMachine.length === 1 (arity 1)', () => {
    expect(safeZInvariantModeForMachine.length).toBe(1)
  })

  it('resolveSafeZClearanceMm.length === 1 (arity 1)', () => {
    expect(resolveSafeZClearanceMm.length).toBe(1)
  })

  it('validateGcodeSafeZRetractInvariants returns an Array', () => {
    expect(
      Array.isArray(validateGcodeSafeZRetractInvariants('', 'cnc', 25))
    ).toBe(true)
  })

  it('safeZInvariantModeForMachine returns a string literal', () => {
    expect(typeof safeZInvariantModeForMachine({ kind: 'cnc' })).toBe('string')
  })

  it('resolveSafeZClearanceMm returns number-or-null', () => {
    const n = resolveSafeZClearanceMm({
      safeRetractZMm: 25,
      workAreaMm: { x: 100, y: 100, z: 50 }
    })
    expect(typeof n === 'number' || n === null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (C) safeZInvariantModeForMachine -- mode coercion
// ---------------------------------------------------------------------------
describe('[ID-0274] (C) safeZInvariantModeForMachine mode coercion', () => {
  it("returns 'fdm' for kind:'fdm'", () => {
    expect(safeZInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
  })

  it("returns 'cnc' for kind:'cnc'", () => {
    expect(safeZInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
  })

  it('return type is the SafeZInvariantMode union (fdm | cnc)', () => {
    const m: SafeZInvariantMode = safeZInvariantModeForMachine({ kind: 'cnc' })
    expect(m === 'cnc' || m === 'fdm').toBe(true)
  })

  it('does not throw on the minimal Pick<MachineProfile,kind> shape', () => {
    expect(() => safeZInvariantModeForMachine({ kind: 'fdm' })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// (D) resolveSafeZClearanceMm -- preference order + edge cases
// ---------------------------------------------------------------------------
describe('[ID-0274] (D) resolveSafeZClearanceMm preference order', () => {
  it('PREFERS positive safeRetractZMm over workAreaMm.z', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: 25,
        workAreaMm: { x: 1, y: 1, z: 350 }
      })
    ).toBe(25)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is undefined', () => {
    expect(
      resolveSafeZClearanceMm({
        workAreaMm: { x: 1, y: 1, z: 140 }
      })
    ).toBe(140)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is zero (NOT positive)', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: 0,
        workAreaMm: { x: 1, y: 1, z: 140 }
      })
    ).toBe(140)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is negative', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: -5,
        workAreaMm: { x: 1, y: 1, z: 140 }
      })
    ).toBe(140)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is NaN', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: Number.NaN,
        workAreaMm: { x: 1, y: 1, z: 140 }
      })
    ).toBe(140)
  })

  it('falls back to workAreaMm.z when safeRetractZMm is +Infinity', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: Number.POSITIVE_INFINITY,
        workAreaMm: { x: 1, y: 1, z: 140 }
      })
    ).toBe(140)
  })

  it('returns null when neither field is positive-finite', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: 0,
        workAreaMm: { x: 100, y: 100, z: 0 }
      })
    ).toBeNull()
  })

  it('returns null when both fields are missing', () => {
    expect(
      resolveSafeZClearanceMm({
        workAreaMm: undefined as unknown as MachineProfile['workAreaMm']
      })
    ).toBeNull()
  })

  it('returns null when workAreaMm.z is negative', () => {
    expect(
      resolveSafeZClearanceMm({
        workAreaMm: { x: 100, y: 100, z: -10 }
      })
    ).toBeNull()
  })

  it('returns null when workAreaMm.z is NaN', () => {
    expect(
      resolveSafeZClearanceMm({
        workAreaMm: { x: 100, y: 100, z: Number.NaN }
      })
    ).toBeNull()
  })

  it('returns the EXACT numeric value -- no rounding (25.5 stays 25.5)', () => {
    expect(
      resolveSafeZClearanceMm({
        safeRetractZMm: 25.5,
        workAreaMm: { x: 1, y: 1, z: 50 }
      })
    ).toBe(25.5)
  })
})

// ---------------------------------------------------------------------------
// (E) FDM short-circuit boundary
// ---------------------------------------------------------------------------
describe('[ID-0274] (E) FDM short-circuit boundary', () => {
  it('returns [] for empty input in FDM mode', () => {
    expect(validateGcodeSafeZRetractInvariants('', 'fdm', 25)).toEqual([])
  })

  it('returns [] for a program with NO pre-cut retract in FDM mode', () => {
    expect(
      validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'fdm', 25)
    ).toEqual([])
  })

  it('returns [] for a program with NO end retract in FDM mode', () => {
    expect(
      validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'fdm', 25)
    ).toEqual([])
  })

  it('returns [] for an XY-rapid-at-depth program in FDM mode', () => {
    expect(
      validateGcodeSafeZRetractInvariants(XY_RAPID_AT_DEPTH, 'fdm', 25)
    ).toEqual([])
  })

  it('FDM short-circuit ignores safeClearanceMm completely', () => {
    expect(
      validateGcodeSafeZRetractInvariants('G1 Z-100', 'fdm', null)
    ).toEqual([])
    expect(
      validateGcodeSafeZRetractInvariants('G1 Z-100', 'fdm', 0)
    ).toEqual([])
    expect(
      validateGcodeSafeZRetractInvariants('G1 Z-100', 'fdm', 350)
    ).toEqual([])
  })

  it('FDM short-circuit returns a fresh empty Array', () => {
    const a = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'fdm', 25)
    const b = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'fdm', 25)
    expect(a).not.toBe(b)
    expect(a).toEqual([])
    expect(b).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (F) Empty + whitespace boundary (cnc mode)
// ---------------------------------------------------------------------------
describe('[ID-0274] (F) empty + whitespace boundary (cnc mode)', () => {
  it('returns [] for empty string', () => {
    expect(validateGcodeSafeZRetractInvariants('', 'cnc', 25)).toEqual([])
  })

  it('returns [] for whitespace-only string', () => {
    expect(validateGcodeSafeZRetractInvariants('   \n\t\n  ', 'cnc', 25)).toEqual(
      []
    )
  })

  it('returns [] for comment-only string (paren comments)', () => {
    expect(
      validateGcodeSafeZRetractInvariants('(only comment)\n(more)', 'cnc', 25)
    ).toEqual([])
  })

  it('returns [] for comment-only string (semicolon comments)', () => {
    expect(
      validateGcodeSafeZRetractInvariants('; only comment\n; more', 'cnc', 25)
    ).toEqual([])
  })

  it('returns [] for a program with rapids but NO cuts', () => {
    const rapidsOnly = ['G21', 'G0 Z25', 'G0 X10 Y10', 'G0 Z25', 'M30'].join('\n')
    expect(validateGcodeSafeZRetractInvariants(rapidsOnly, 'cnc', 25)).toEqual([])
  })

  it('returns [] for a program with no motion words at all', () => {
    expect(
      validateGcodeSafeZRetractInvariants('G21\nG90\nG17\nG54', 'cnc', 25)
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (G) Issue object shape -- exactly 4 keys, level/code/message/line
// ---------------------------------------------------------------------------
describe('[ID-0274] (G) issue object shape', () => {
  it('every issue has exactly 4 own keys: level, code, message, line', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      NO_PRE_CUT_RETRACT,
      'cnc',
      25
    )
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      const keys = Object.keys(issue).sort()
      expect(keys).toEqual(['code', 'level', 'line', 'message'])
    }
  })

  it("level is 'error' for every emitted issue (no warnings today)", () => {
    const issues = validateGcodeSafeZRetractInvariants(
      [NO_PRE_CUT_RETRACT, NO_END_RETRACT, XY_RAPID_AT_DEPTH].join('\n'),
      'cnc',
      25
    )
    for (const issue of issues) expect(issue.level).toBe('error')
  })

  it('SafeZInvariantLevel union includes both error and warning at the type level', () => {
    const e: SafeZInvariantLevel = 'error'
    const w: SafeZInvariantLevel = 'warning'
    expect([e, w]).toEqual(['error', 'warning'])
  })

  it('every issue.line is a positive 1-based integer', () => {
    const issues = validateGcodeSafeZRetractInvariants(XY_RAPID_AT_DEPTH, 'cnc', 25)
    for (const issue of issues) {
      expect(Number.isInteger(issue.line)).toBe(true)
      expect(issue.line).toBeGreaterThan(0)
    }
  })

  it('every issue.message is a non-empty string', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      NO_PRE_CUT_RETRACT,
      'cnc',
      25
    )
    for (const issue of issues) {
      expect(typeof issue.message).toBe('string')
      expect(issue.message.length).toBeGreaterThan(0)
    }
  })

  it('every issue.code is one of the three documented codes', () => {
    const validCodes = new Set([
      'RETRACT_NO_PRE_CUT_RETRACT',
      'RETRACT_NO_END_RETRACT',
      'RETRACT_XY_RAPID_AT_CUT_DEPTH'
    ])
    const issues = validateGcodeSafeZRetractInvariants(
      [NO_PRE_CUT_RETRACT, NO_END_RETRACT, XY_RAPID_AT_DEPTH].join('\n'),
      'cnc',
      25
    )
    for (const issue of issues) expect(validCodes.has(issue.code)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (H) Canonical issue ordering
// ---------------------------------------------------------------------------
describe('[ID-0274] (H) canonical issue ordering', () => {
  it('NO_PRE_CUT_RETRACT precedes NO_END_RETRACT precedes XY_RAPID', () => {
    const program = [
      'G21',
      'G90',
      'M3 S12000',
      'G1 Z-2 F200',
      'G1 X10',
      'G0 X20 Y20',
      'G0 X30',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    const codes = issues.map((i) => i.code)
    const idx = (c: string) => codes.indexOf(c)
    expect(idx('RETRACT_NO_PRE_CUT_RETRACT')).toBeLessThan(
      idx('RETRACT_NO_END_RETRACT')
    )
    expect(idx('RETRACT_NO_END_RETRACT')).toBeLessThan(
      idx('RETRACT_XY_RAPID_AT_CUT_DEPTH')
    )
  })

  it('multiple XY_RAPID issues preserve line order', () => {
    const program = [
      'G21',
      'G90',
      'G0 Z25',
      'M3 S12000',
      'G1 Z-2 F200',
      'G1 X10',
      'G0 X20 Y20',
      'G0 X30 Y30',
      'G0 X40 Y40',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    const xyIssues = issues.filter(
      (i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH'
    )
    expect(xyIssues.length).toBe(3)
    expect(xyIssues[0]!.line).toBeLessThan(xyIssues[1]!.line)
    expect(xyIssues[1]!.line).toBeLessThan(xyIssues[2]!.line)
  })

  it('AT MOST one NO_PRE_CUT_RETRACT issue per program', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      NO_PRE_CUT_RETRACT,
      'cnc',
      25
    )
    expect(
      issues.filter((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT').length
    ).toBe(1)
  })

  it('AT MOST one NO_END_RETRACT issue per program', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'cnc', 25)
    expect(
      issues.filter((i) => i.code === 'RETRACT_NO_END_RETRACT').length
    ).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (I) RETRACT_NO_PRE_CUT_RETRACT
// ---------------------------------------------------------------------------
describe('[ID-0274] (I) RETRACT_NO_PRE_CUT_RETRACT', () => {
  it('fires when first cut occurs without prior G0 Z>=safe', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      NO_PRE_CUT_RETRACT,
      'cnc',
      25
    )
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeDefined()
  })

  it('issue.line anchors on the FIRST cut move', () => {
    const program = ['G21', 'G90', 'M3 S12000', 'G1 Z-1 F200', 'G1 X10', 'G0 Z25', 'M30'].join(
      '\n'
    )
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    // 1-based: line 4 is "G1 Z-1 F200".
    expect(issue?.line).toBe(4)
  })

  it('does NOT fire when a G0 Z>=safe lift precedes the first cut', () => {
    const issues = validateGcodeSafeZRetractInvariants(GOOD_MACH3_25, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeUndefined()
  })

  it('a G0 Z lift exactly AT the safe clearance counts (>=, not >)', () => {
    const program = ['G21', 'G0 Z25', 'M3', 'G1 Z-1 F200', 'G0 Z25', 'M30'].join(
      '\n'
    )
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeUndefined()
  })

  it('a G0 Z lift just BELOW safe (24.99 < 25) does NOT count', () => {
    const program = ['G21', 'G0 Z24.99', 'M3', 'G1 Z-1 F200', 'G0 Z25', 'M30'].join(
      '\n'
    )
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeDefined()
  })

  it('no cuts in the program -> no issue (vacuously satisfied)', () => {
    const program = ['G21', 'G0 X1', 'G0 X2', 'M30'].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (J) RETRACT_NO_END_RETRACT
// ---------------------------------------------------------------------------
describe('[ID-0274] (J) RETRACT_NO_END_RETRACT', () => {
  it('fires when last cut is not followed by a G0 Z>=safe before M2/M30', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    ).toBeDefined()
  })

  it("issue.line anchors on programEndLine when present", () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    // NO_END_RETRACT ends with M30 on line 7.
    expect(issue?.line).toBe(7)
  })

  it("issue.line falls back to lastCutLine when no program-end terminator", () => {
    // No M2/M30 -> programEndLine remains null -> falls back to lastCutLine.
    const program = ['G21', 'G0 Z25', 'M3', 'G1 Z-1 F200', 'G1 X10'].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    // 1-based: line 5 is the last cut "G1 X10".
    expect(issue?.line).toBe(5)
  })

  it('does NOT fire when last cut is followed by a G0 Z>=safe', () => {
    const issues = validateGcodeSafeZRetractInvariants(GOOD_MACH3_25, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    ).toBeUndefined()
  })

  it('a cut AFTER an end retract re-arms the requirement', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X10',
      'G0 Z25',
      'G1 Z-2 F200', // re-cut after retract; no further retract before M30
      'G1 X20',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    ).toBeDefined()
  })

  it('no cuts in the program -> no issue (vacuously satisfied)', () => {
    const program = ['G21', 'G0 Z25', 'G0 X1', 'M30'].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (K) RETRACT_XY_RAPID_AT_CUT_DEPTH
// ---------------------------------------------------------------------------
describe('[ID-0274] (K) RETRACT_XY_RAPID_AT_CUT_DEPTH', () => {
  it('fires for a pure XY rapid while modal Z is below safe clearance', () => {
    const issues = validateGcodeSafeZRetractInvariants(XY_RAPID_AT_DEPTH, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeDefined()
  })

  it('fires for a combined-XYZ rapid that lands below safe', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      COMBINED_XYZ_RAPID_BELOW_SAFE,
      'cnc',
      25
    )
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeDefined()
  })

  it('issue.line anchors on the offending G0 line', () => {
    const issues = validateGcodeSafeZRetractInvariants(XY_RAPID_AT_DEPTH, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    // 1-based: line 7 is "G0 X20 Y20" (after G1 Z-2 set modal Z=-2).
    expect(issue?.line).toBe(7)
  })

  it('does NOT fire when XY rapid is preceded by a Z lift to safe', () => {
    const issues = validateGcodeSafeZRetractInvariants(GOOD_MACH3_25, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeUndefined()
  })

  it('does NOT fire for a G1 (cut) feed move at depth -- only G0 rapids', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-2 F200',
      'G1 X20 Y20', // feed move at depth -- legitimate cut, NOT a rapid
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeUndefined()
  })

  it('combined-XYZ rapid that lands ABOVE safe does NOT fire', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-2 F200',
      'G1 X10',
      'G0 X20 Y20 Z30', // combined rapid ending above safe -- safe
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeUndefined()
  })

  it('emits a SEPARATE issue per offending line (per-occurrence)', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-2 F200',
      'G1 X1',
      'G0 X10 Y10',
      'G0 X20 Y20',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.filter((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH').length
    ).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// (L) safeClearanceMm null fallback (Z>0 = safe)
// ---------------------------------------------------------------------------
describe('[ID-0274] (L) safeClearanceMm null fallback', () => {
  it('null clearance treats Z>0 as safe', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      GOOD_NULL_CLEARANCE,
      'cnc',
      null
    )
    expect(issues).toEqual([])
  })

  it('null clearance treats modal Z<=0 as cut depth (XY rapid fires)', () => {
    const program = [
      'G21',
      'G0 Z5',
      'M3',
      'G1 Z-1 F100',
      'G1 X1',
      'G0 X10 Y10', // modal Z=-1 -> below "stock top" with null clearance
      'G0 Z5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', null)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeDefined()
  })

  it('null clearance treats modal Z=0 as cut depth (XY rapid fires)', () => {
    const program = [
      'G21',
      'G0 Z5',
      'M3',
      'G1 Z0 F100',
      'G1 X1',
      'G0 X10 Y10', // modal Z=0 -> at stock top, "cut depth" with null clearance
      'G0 Z5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', null)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeDefined()
  })

  it('null clearance: any G0 Z>0 satisfies pre-cut and end retracts', () => {
    const program = [
      'G21',
      'G0 Z0.001', // even fractionally positive counts
      'M3',
      'G1 Z-1 F100',
      'G1 X1',
      'G0 Z0.001',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', null)
    expect(issues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (M) Comment-strip contract
// ---------------------------------------------------------------------------
describe('[ID-0274] (M) comment-strip contract', () => {
  it('paren comments are stripped before parsing G/M words', () => {
    const program = [
      'G21',
      '(set spindle)',
      'M3',
      '(begin cut)',
      'G1 Z-1 F200',
      'G1 X10',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    // No pre-cut retract emitted; that issue should fire (and only that one).
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeDefined()
  })

  it('semicolon comments are stripped (everything after ; goes away)', () => {
    const program = [
      'G21 ; preamble',
      'G0 Z25 ; pre-cut lift',
      'M3 ; spindle on',
      'G1 Z-1 F200 ; first cut',
      'G1 X10',
      'G0 Z25 ; end retract',
      'M30 ; program end'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('a line that becomes empty after comment-strip is treated as blank', () => {
    const program = [
      'G21',
      'G0 Z25',
      '; only a comment',
      '(only paren comment)',
      'M3',
      'G1 Z-1 F200',
      'G1 X10',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('mixed comment styles on the same line are both stripped', () => {
    const program = [
      'G21 (units mm) ; trailing semicolon',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200 (cut) ; also',
      'G1 X10',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M-words inside paren comments are NOT counted as program-end', () => {
    // The paren-stripped line never sees M30 -- so the validator should
    // continue walking past this line.
    const program = [
      'G21',
      '(M30 mentioned in comment)',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X10',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M-words after a semicolon are NOT counted as program-end', () => {
    const program = [
      'G21',
      '; M30 here is a comment',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X10',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (N) Modal motion preservation across lines
// ---------------------------------------------------------------------------
describe('[ID-0274] (N) modal motion preservation', () => {
  it('G1 sets modalMotion=cut; subsequent bare X/Y line is treated as cut', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'X10', // bare X10 inherits G1 modal -> cut
      'X20',
      'G0 Z25',
      'M30'
    ].join('\n')
    // First cut anchored on the G1 Z-1 line (the explicit G1).
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([]) // pre-cut + end-retract both satisfied
  })

  it('G0 sets modalMotion=rapid; subsequent bare X/Y is treated as rapid', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-2 F200',
      'G1 X1',
      'G0 X10', // sets modal=0 (rapid)
      'X20', // bare X20 inherits rapid modal -> XY at depth fires
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.filter((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH').length
    ).toBe(2)
  })

  it('initial modalMotion null lines update modalZ but not motion classification', () => {
    // No G word ever set; bare Z25 just updates modal Z.
    const program = ['G21', 'Z25', 'M3', 'G1 Z-1 F200', 'G1 X10', 'G0 Z25', 'M30'].join(
      '\n'
    )
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    // Without a G0 Z>=safe BEFORE the first G1, pre-cut retract should fire.
    expect(
      issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    ).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// (O) Modal Z preservation across lines
// ---------------------------------------------------------------------------
describe('[ID-0274] (O) modal Z preservation', () => {
  it('modal Z carries forward across lines until next Z word', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-2 F200', // modal Z=-2
      'G1 X10', // still Z=-2
      'G1 X20', // still Z=-2
      'G0 X30 Y30', // pure XY rapid at modal Z=-2 -> fires
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeDefined()
  })

  it('a Z word without an X/Y on the same line still updates modal Z', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-2 F200',
      'G1 X1',
      'G0 Z25', // modal Z back to 25 (safe)
      'G0 X30 Y30', // now XY rapid at modal Z=25 -> NO fire
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeUndefined()
  })

  it('XY rapid before any Z word at all does NOT fire (modal Z null)', () => {
    const program = ['G21', 'G0 X10 Y10', 'M3', 'G0 Z25', 'G1 Z-1 F200', 'G0 Z25', 'M30'].join(
      '\n'
    )
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(
      issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (P) Program-end M-word stop behavior
// ---------------------------------------------------------------------------
describe('[ID-0274] (P) program-end M-word stop behavior', () => {
  it('M30 stops the walk -- subsequent lines are ignored', () => {
    // Without ignoring post-M30 lines, the trailing G1 X1 would re-arm
    // end-retract. With ignore behavior, end-retract is satisfied at G0 Z25.
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X1',
      'G0 Z25',
      'M30',
      'G1 X99' // ignored
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M2 also stops the walk (alongside M30)', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X1',
      'G0 Z25',
      'M2',
      'G1 X99' // ignored
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M5 (spindle off) does NOT stop the walk', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X1',
      'M5', // spindle off -- continue
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M02 (zero-padded) is recognized as program-end (M2)', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X1',
      'G0 Z25',
      'M02'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M030 (zero-padded) is recognized as program-end (M30)', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M3',
      'G1 Z-1 F200',
      'G1 X1',
      'G0 Z25',
      'M030'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('M6 (tool change) does NOT stop the walk', () => {
    const program = [
      'G21',
      'G0 Z25',
      'M6 T1',
      'M3',
      'G1 Z-1 F200',
      'G1 X1',
      'G0 Z25',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (Q) Three-machine path realism
// ---------------------------------------------------------------------------
describe('[ID-0274] (Q) three-machine path realism', () => {
  it('K2 Plus (kind:fdm, workArea 350x350x350) -> mode fdm -> short-circuit', () => {
    const k2: Pick<MachineProfile, 'kind'> = { kind: 'fdm' }
    expect(safeZInvariantModeForMachine(k2)).toBe('fdm')
    // Even a clearly broken CNC program returns [] under FDM mode.
    expect(
      validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'fdm', 350)
    ).toEqual([])
  })

  it('K2 Plus -> resolveSafeZClearanceMm falls back to workArea.z (350)', () => {
    const k2: Pick<MachineProfile, 'safeRetractZMm' | 'workAreaMm'> = {
      workAreaMm: { x: 350, y: 350, z: 350 }
    }
    expect(resolveSafeZClearanceMm(k2)).toBe(350)
  })

  it('Laguna Swift 5x10 -> mode cnc + safeRetractZMm 25 wins over workArea.z 203', () => {
    const laguna: Pick<MachineProfile, 'kind'> = { kind: 'cnc' }
    expect(safeZInvariantModeForMachine(laguna)).toBe('cnc')
    const profile: Pick<MachineProfile, 'safeRetractZMm' | 'workAreaMm'> = {
      safeRetractZMm: 25,
      workAreaMm: { x: 1524, y: 3048, z: 203 }
    }
    expect(resolveSafeZClearanceMm(profile)).toBe(25)
  })

  it('Laguna at 25 mm safe-Z -> a G0 Z25 lift counts (>=, not >)', () => {
    // Laguna ships with safeRetractZMm=25; verify boundary equality.
    const issues = validateGcodeSafeZRetractInvariants(GOOD_MACH3_25, 'cnc', 25)
    expect(issues).toEqual([])
  })

  it('Carvera 3-axis -> resolveSafeZClearanceMm falls back to 140 (workArea.z)', () => {
    const carvera3: Pick<MachineProfile, 'safeRetractZMm' | 'workAreaMm'> = {
      workAreaMm: { x: 360, y: 240, z: 140 }
    }
    expect(resolveSafeZClearanceMm(carvera3)).toBe(140)
  })

  it('Carvera 4-axis -> resolveSafeZClearanceMm falls back to 46 (workArea.z)', () => {
    const carvera4: Pick<MachineProfile, 'safeRetractZMm' | 'workAreaMm'> = {
      workAreaMm: { x: 240, y: 92, z: 46 }
    }
    expect(resolveSafeZClearanceMm(carvera4)).toBe(46)
  })

  it('Carvera 4-axis at 46 mm safe-Z accepts a G0 Z46 lift', () => {
    const program = [
      'G21',
      'G0 Z46',
      'M3 S15000',
      'G1 Z-1 F200',
      'G1 X1',
      'G0 Z46',
      'M2'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(program, 'cnc', 46)).toEqual([])
  })

  it('Carvera 3-axis ATC tool-change retract pattern (G53 G0 Z0 -> Z140) passes', () => {
    // Realistic Carvera multi-tool program: end retract before M30.
    const program = [
      'G21',
      'G90',
      'G0 Z140',
      'M6 T1',
      'M3 S12000',
      'G1 Z-1 F200',
      'G1 X10',
      'G0 Z140',
      'M5',
      'M30'
    ].join('\n')
    expect(validateGcodeSafeZRetractInvariants(program, 'cnc', 140)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (R) Pure-function invariants
// ---------------------------------------------------------------------------
describe('[ID-0274] (R) pure-function invariants', () => {
  it('idempotent: 20 calls on the same input produce structurally equal arrays', () => {
    const first = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    for (let i = 0; i < 20; i++) {
      const next = validateGcodeSafeZRetractInvariants(
        NO_PRE_CUT_RETRACT,
        'cnc',
        25
      )
      expect(next).toEqual(first)
    }
  })

  it('does not mutate the input gcode string (string immutability)', () => {
    const input = NO_PRE_CUT_RETRACT
    const before = input.length
    validateGcodeSafeZRetractInvariants(input, 'cnc', 25)
    expect(input.length).toBe(before)
    expect(input).toBe(NO_PRE_CUT_RETRACT)
  })

  it('returns a fresh Array instance each call (no shared singleton)', () => {
    const a = validateGcodeSafeZRetractInvariants(GOOD_MACH3_25, 'cnc', 25)
    const b = validateGcodeSafeZRetractInvariants(GOOD_MACH3_25, 'cnc', 25)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('no this-binding leak: detached function call works', () => {
    const detached = validateGcodeSafeZRetractInvariants
    expect(() => detached(GOOD_MACH3_25, 'cnc', 25)).not.toThrow()
  })

  it('safeZInvariantModeForMachine has no this-binding leak', () => {
    const detached = safeZInvariantModeForMachine
    expect(() => detached({ kind: 'cnc' })).not.toThrow()
  })

  it('resolveSafeZClearanceMm has no this-binding leak', () => {
    const detached = resolveSafeZClearanceMm
    expect(() =>
      detached({ workAreaMm: { x: 1, y: 1, z: 25 } })
    ).not.toThrow()
  })

  it('returned Array uses the standard Array prototype', () => {
    const out = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    expect(Object.getPrototypeOf(out)).toBe(Array.prototype)
  })

  it('output length is bounded by 2 + xy-rapid occurrences', () => {
    // Worst-case program: pre-cut missing + end-retract missing + 3 xy rapids.
    const program = [
      'G21',
      'M3',
      'G1 Z-2 F200',
      'G1 X1',
      'G0 X10 Y10',
      'G0 X20 Y20',
      'G0 X30 Y30',
      'M30'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', 25)
    expect(issues.length).toBeLessThanOrEqual(2 + 3)
  })

  it('two structurally identical inputs produce structurally identical outputs', () => {
    const a = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    const clone =
      NO_PRE_CUT_RETRACT.slice(0, 0) + NO_PRE_CUT_RETRACT.slice(0)
    const b = validateGcodeSafeZRetractInvariants(clone, 'cnc', 25)
    expect(a).toEqual(b)
  })

  it('issue object is a plain Object (Object.prototype, not class instance)', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    expect(issues.length).toBeGreaterThan(0)
    expect(Object.getPrototypeOf(issues[0]!)).toBe(Object.prototype)
  })
})

// ---------------------------------------------------------------------------
// (S) Source-text whitelist on canonical messages
// ---------------------------------------------------------------------------
describe('[ID-0274] (S) source-text whitelist on canonical messages', () => {
  it('NO_PRE_CUT_RETRACT message contains canonical "G1/G2/G3" reference', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    expect(issue?.message).toContain('G1/G2/G3')
  })

  it('NO_PRE_CUT_RETRACT message contains the safe-Z numeric threshold', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    expect(issue?.message).toContain('>=25')
  })

  it('NO_PRE_CUT_RETRACT message uses ">0" when clearance is null', () => {
    const program = ['G21', 'M3', 'G1 Z-1 F200', 'G1 X1', 'G0 Z5', 'M2'].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(program, 'cnc', null)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    expect(issue?.message).toContain('>0')
  })

  it('NO_PRE_CUT_RETRACT message warns about controller-boot Z=0 = table', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_PRE_CUT_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    expect(issue?.message).toContain('the table')
    expect(issue?.message).toContain('broken bit')
  })

  it('NO_END_RETRACT message contains the safe-Z numeric threshold', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    expect(issue?.message).toContain('>=25')
  })

  it('NO_END_RETRACT message references program-end command (M2/M30)', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    expect(issue?.message).toContain('M2/M30')
  })

  it('NO_END_RETRACT message references tool-change / fixture-swap context', () => {
    const issues = validateGcodeSafeZRetractInvariants(NO_END_RETRACT, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_NO_END_RETRACT')
    expect(issue?.message).toContain('tool change')
    expect(issue?.message).toContain('fixture swap')
  })

  it('XY_RAPID_AT_CUT_DEPTH (pure XY) message uses "modal Z="', () => {
    const issues = validateGcodeSafeZRetractInvariants(XY_RAPID_AT_DEPTH, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(issue?.message).toContain('modal Z=')
  })

  it('XY_RAPID_AT_CUT_DEPTH (combined-XYZ) message uses "Combined-XYZ"', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      COMBINED_XYZ_RAPID_BELOW_SAFE,
      'cnc',
      25
    )
    const issue = issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(issue?.message).toContain('Combined-XYZ')
  })

  it('XY_RAPID_AT_CUT_DEPTH (combined-XYZ) message warns about stock/fixturing strike', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      COMBINED_XYZ_RAPID_BELOW_SAFE,
      'cnc',
      25
    )
    const issue = issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(issue?.message).toContain('stock')
    expect(issue?.message).toContain('fixturing')
  })

  it('XY_RAPID (pure) message exhorts Z to rise BEFORE the rapid', () => {
    const issues = validateGcodeSafeZRetractInvariants(XY_RAPID_AT_DEPTH, 'cnc', 25)
    const issue = issues.find((i) => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(issue?.message).toContain('Z must rise')
    expect(issue?.message).toContain('between')
    expect(issue?.message).toContain('operations')
  })

  it('all messages use ASCII "--" separator (no em-dash)', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      [NO_PRE_CUT_RETRACT, NO_END_RETRACT, XY_RAPID_AT_DEPTH].join('\n'),
      'cnc',
      25
    )
    for (const issue of issues) {
      // U+2014 EM DASH should never appear in canonical messages.
      expect(issue.message.includes('—')).toBe(false)
    }
  })

  it('messages do not contain unsubstituted ${ template-literal markers', () => {
    const issues = validateGcodeSafeZRetractInvariants(
      [NO_PRE_CUT_RETRACT, NO_END_RETRACT, XY_RAPID_AT_DEPTH].join('\n'),
      'cnc',
      25
    )
    for (const issue of issues) {
      expect(issue.message.includes('${')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// (T) Type-level parity (runtime erasure of type-only exports)
// ---------------------------------------------------------------------------
describe('[ID-0274] (T) type-level parity', () => {
  it('SafeZInvariantLevel type-only export is erased at runtime', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).SafeZInvariantLevel
    ).toBeUndefined()
  })

  it('SafeZInvariantIssue type-only export is erased at runtime', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).SafeZInvariantIssue
    ).toBeUndefined()
  })

  it('SafeZInvariantMode type-only export is erased at runtime', () => {
    expect(
      (Mod as unknown as Record<string, unknown>).SafeZInvariantMode
    ).toBeUndefined()
  })

  it('SafeZInvariantIssue type accepts the canonical 4-key shape', () => {
    const probe: SafeZInvariantIssue = {
      level: 'error',
      code: 'RETRACT_NO_PRE_CUT_RETRACT',
      message: 'probe',
      line: 1
    }
    expect(probe.level).toBe('error')
    expect(probe.code).toBe('RETRACT_NO_PRE_CUT_RETRACT')
    expect(probe.message).toBe('probe')
    expect(probe.line).toBe(1)
  })

  it('SafeZInvariantMode type accepts both fdm and cnc literals', () => {
    const a: SafeZInvariantMode = 'fdm'
    const b: SafeZInvariantMode = 'cnc'
    expect([a, b]).toEqual(['fdm', 'cnc'])
  })
})
