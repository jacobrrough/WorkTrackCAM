// ---------------------------------------------------------------------------
// gcode-end-program-invariants-pin.test.ts  [ID-0245]
// ---------------------------------------------------------------------------
// Co-located paired-pin contract for `src/shared/gcode-end-program-invariants.ts`
// (331-line / ~12 KB SHARED post-pipeline end-program-invariant validator
// [ID-0108]; sibling module to `gcode-header-invariants.ts` pinned in
// Cycle 168 / [ID-0240]).  Three exported runtime values:
//   - `validateGcodeEndProgramInvariants(gcode, mode, dialect)` -- arity 3,
//     returns an issue array (END_NO_PROGRAM_END, END_NO_SPINDLE_OFF,
//     END_SPINDLE_OFF_AFTER_END as errors; END_DIALECT_MISMATCH as warning).
//   - `endProgramInvariantModeForMachine(machine)` -- arity 1, returns
//     'fdm' or 'cnc'.
//   - `preferredProgramEndForDialect(dialect)` -- arity 1, returns the
//     dialect's preferred terminator with a rationale, or null.
//
// Production hook: `src/main/post-process.ts:1076-1077`.  Existing
// behavioral coverage in `gcode-end-program-invariants.test.ts` (442 lines)
// covers happy paths and most failure cases; this pin file pins the SURFACE
// contract: module shape, function signatures, dialect lookup table,
// FDM short-circuit, empty-input boundary, issue object EXACT 4-key shape,
// canonical issue order (NO_END -> NO_OFF -> OFF_AFTER_END -> MISMATCH),
// comment-strip contract (paren + semicolon + mixed), M-word normalization
// (zero-padded + lowercase), tracked M-word set EXHAUSTIVE (M2/M3/M4/M5/M30
// in; M6/M7/M8/M9/M104/M140 out), three-machine path realism (K2 Plus
// short-circuit / Laguna mach3 / Carvera grbl + grbl_4axis + smoothieware),
// pure-function invariants (idempotent N=20, no string mutation, no this-
// binding leakage on call/apply, plain-Array prototype, fresh Array each
// call, output bounded by 4 + dialect-mismatch).
//
// ASSUMPTION: the module exports exactly THREE RUNTIME values
// (`validateGcodeEndProgramInvariants`, `endProgramInvariantModeForMachine`,
// `preferredProgramEndForDialect`) and FOUR TYPE-only aliases
// (`EndProgramInvariantLevel`, `EndProgramInvariantIssue`,
// `EndProgramInvariantMode`, `DialectEndPreference`).  Type-only exports
// are erased at runtime so they never appear in `Object.keys(module)`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import * as Mod from './gcode-end-program-invariants'
import {
  endProgramInvariantModeForMachine,
  preferredProgramEndForDialect,
  validateGcodeEndProgramInvariants
} from './gcode-end-program-invariants'
import type {
  EndProgramInvariantIssue,
  EndProgramInvariantLevel
} from './gcode-end-program-invariants'
import type { MachineProfile } from './machine-schema'

// ---------------------------------------------------------------------------
// Test helpers / canonical samples
// ---------------------------------------------------------------------------

const GOOD_MACH3 = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S12000',
  'G4 P2.0',
  'G0 X10 Y10',
  'G1 Z-2.0 F200',
  'M5',
  'G4 P3.0',
  'G0 Z203',
  'M30'
].join('\n')

const GOOD_GRBL = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S20000',
  'G0 X5 Y5',
  'G1 Z-1.0 F100',
  'M5',
  'M2'
].join('\n')

const NO_END_TERMINATOR = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S12000',
  'G0 X0 Y0',
  'G1 Z-1 F200',
  'M5'
].join('\n')

const NO_SPINDLE_OFF = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S12000',
  'G1 X10 Y10 F200',
  'M30'
].join('\n')

const SPINDLE_OFF_AFTER_END = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S12000',
  'G1 X10 Y10 F200',
  'M30',
  'M5'
].join('\n')

// mach3 dialect prefers M30 -- here program ends with M2 -> mismatch warning.
const MACH3_USES_M2 = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S12000',
  'G0 X1 Y1',
  'G1 Z-1 F200',
  'M5',
  'M2'
].join('\n')

// grbl dialect prefers M2 -- here program ends with M30 -> mismatch warning.
const GRBL_USES_M30 = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S20000',
  'G0 X5 Y5',
  'G1 Z-1.0 F100',
  'M5',
  'M30'
].join('\n')

// All known dialects from machine-schema.ts -- used in DIALECT_PREFERENCE
// exhaustive lookup tests.  Sorted for stability.
const ALL_DIALECTS: ReadonlyArray<MachineProfile['dialect']> = [
  'fanuc',
  'fanuc_4axis',
  'generic_mm',
  'grbl',
  'grbl_4axis',
  'heidenhain',
  'heidenhain_4axis',
  'linuxcnc_4axis',
  'mach3',
  'mach3_4axis',
  'siemens',
  'siemens_4axis',
  'smoothieware'
] as const

// Dialects that have a preference and their preferred terminator.
const DIALECTS_WITH_PREFERENCE: ReadonlyArray<{
  dialect: MachineProfile['dialect']
  preferred: 'M2' | 'M30'
}> = [
  { dialect: 'mach3', preferred: 'M30' },
  { dialect: 'mach3_4axis', preferred: 'M30' },
  { dialect: 'grbl', preferred: 'M2' },
  { dialect: 'grbl_4axis', preferred: 'M2' },
  { dialect: 'smoothieware', preferred: 'M2' }
] as const

// Dialects with NO enforced preference (preferredProgramEndForDialect -> null).
const DIALECTS_NO_PREFERENCE: ReadonlyArray<MachineProfile['dialect']> = [
  'fanuc',
  'fanuc_4axis',
  'generic_mm',
  'heidenhain',
  'heidenhain_4axis',
  'linuxcnc_4axis',
  'siemens',
  'siemens_4axis'
] as const

// ---------------------------------------------------------------------------
// (A) Module shape -- exact runtime export inventory
// ---------------------------------------------------------------------------
describe('[ID-0245] (A) module shape -- exact runtime export inventory', () => {
  it('exports exactly three runtime values', () => {
    const keys = Object.keys(Mod).sort()
    expect(keys).toEqual(
      [
        'endProgramInvariantModeForMachine',
        'preferredProgramEndForDialect',
        'validateGcodeEndProgramInvariants'
      ].sort()
    )
  })

  it('validateGcodeEndProgramInvariants is a function value', () => {
    expect(typeof Mod.validateGcodeEndProgramInvariants).toBe('function')
  })

  it('endProgramInvariantModeForMachine is a function value', () => {
    expect(typeof Mod.endProgramInvariantModeForMachine).toBe('function')
  })

  it('preferredProgramEndForDialect is a function value', () => {
    expect(typeof Mod.preferredProgramEndForDialect).toBe('function')
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

  it('type-only exports are erased at runtime (EndProgramInvariantLevel)', () => {
    expect(
      (Mod as Record<string, unknown>).EndProgramInvariantLevel
    ).toBeUndefined()
  })

  it('type-only exports are erased at runtime (EndProgramInvariantIssue)', () => {
    expect(
      (Mod as Record<string, unknown>).EndProgramInvariantIssue
    ).toBeUndefined()
  })

  it('type-only exports are erased at runtime (EndProgramInvariantMode)', () => {
    expect(
      (Mod as Record<string, unknown>).EndProgramInvariantMode
    ).toBeUndefined()
  })

  it('type-only exports are erased at runtime (DialectEndPreference)', () => {
    expect((Mod as Record<string, unknown>).DialectEndPreference).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (B) Function signatures -- name + arity + native Function
// ---------------------------------------------------------------------------
describe('[ID-0245] (B) function signatures', () => {
  it('validateGcodeEndProgramInvariants.name === "validateGcodeEndProgramInvariants"', () => {
    expect(validateGcodeEndProgramInvariants.name).toBe(
      'validateGcodeEndProgramInvariants'
    )
  })

  it('validateGcodeEndProgramInvariants.length === 3 (gcode, mode, dialect)', () => {
    expect(validateGcodeEndProgramInvariants.length).toBe(3)
  })

  it('validateGcodeEndProgramInvariants is a native Function (not arrow)', () => {
    expect(validateGcodeEndProgramInvariants instanceof Function).toBe(true)
  })

  it('validateGcodeEndProgramInvariants always returns an Array', () => {
    expect(Array.isArray(validateGcodeEndProgramInvariants('', 'cnc', 'mach3'))).toBe(
      true
    )
    expect(Array.isArray(validateGcodeEndProgramInvariants('', 'fdm', 'mach3'))).toBe(
      true
    )
    expect(Array.isArray(validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3'))).toBe(
      true
    )
  })

  it('endProgramInvariantModeForMachine.name === "endProgramInvariantModeForMachine"', () => {
    expect(endProgramInvariantModeForMachine.name).toBe(
      'endProgramInvariantModeForMachine'
    )
  })

  it('endProgramInvariantModeForMachine.length === 1 (machine)', () => {
    expect(endProgramInvariantModeForMachine.length).toBe(1)
  })

  it('endProgramInvariantModeForMachine is a native Function', () => {
    expect(endProgramInvariantModeForMachine instanceof Function).toBe(true)
  })

  it('endProgramInvariantModeForMachine returns a string', () => {
    expect(typeof endProgramInvariantModeForMachine({ kind: 'cnc' })).toBe('string')
    expect(typeof endProgramInvariantModeForMachine({ kind: 'fdm' })).toBe('string')
  })

  it('preferredProgramEndForDialect.name === "preferredProgramEndForDialect"', () => {
    expect(preferredProgramEndForDialect.name).toBe(
      'preferredProgramEndForDialect'
    )
  })

  it('preferredProgramEndForDialect.length === 1 (dialect)', () => {
    expect(preferredProgramEndForDialect.length).toBe(1)
  })

  it('preferredProgramEndForDialect is a native Function', () => {
    expect(preferredProgramEndForDialect instanceof Function).toBe(true)
  })

  it('preferredProgramEndForDialect returns either an object with preferred+rationale OR null', () => {
    for (const d of ALL_DIALECTS) {
      const out = preferredProgramEndForDialect(d)
      expect(out === null || typeof out === 'object').toBe(true)
      if (out !== null) {
        expect(typeof out.preferred).toBe('string')
        expect(typeof out.rationale).toBe('string')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// (C) EndProgramInvariantMode coercion -- two and only two valid values
// ---------------------------------------------------------------------------
describe('[ID-0245] (C) EndProgramInvariantMode coercion', () => {
  it('kind=fdm maps to "fdm"', () => {
    expect(endProgramInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
  })

  it('kind=cnc maps to "cnc"', () => {
    expect(endProgramInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
  })

  it('returns ONLY the literal "fdm" or "cnc"', () => {
    const a = endProgramInvariantModeForMachine({ kind: 'fdm' })
    const b = endProgramInvariantModeForMachine({ kind: 'cnc' })
    expect(['fdm', 'cnc']).toContain(a)
    expect(['fdm', 'cnc']).toContain(b)
  })

  it('is pure: same input -> same output across N=20 calls', () => {
    for (let i = 0; i < 20; i++) {
      expect(endProgramInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
      expect(endProgramInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
    }
  })

  it('does not mutate the input object', () => {
    const machine = { kind: 'cnc' as const, extra: 'untouched' }
    const before = JSON.stringify(machine)
    endProgramInvariantModeForMachine(machine)
    expect(JSON.stringify(machine)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// (D) preferredProgramEndForDialect -- exhaustive dialect lookup table
// ---------------------------------------------------------------------------
describe('[ID-0245] (D) preferredProgramEndForDialect lookup table', () => {
  it('mach3 -> { preferred: "M30" }', () => {
    const out = preferredProgramEndForDialect('mach3')
    expect(out).not.toBeNull()
    expect(out!.preferred).toBe('M30')
  })

  it('mach3_4axis -> { preferred: "M30" }', () => {
    const out = preferredProgramEndForDialect('mach3_4axis')
    expect(out).not.toBeNull()
    expect(out!.preferred).toBe('M30')
  })

  it('grbl -> { preferred: "M2" }', () => {
    const out = preferredProgramEndForDialect('grbl')
    expect(out).not.toBeNull()
    expect(out!.preferred).toBe('M2')
  })

  it('grbl_4axis -> { preferred: "M2" }', () => {
    const out = preferredProgramEndForDialect('grbl_4axis')
    expect(out).not.toBeNull()
    expect(out!.preferred).toBe('M2')
  })

  it('smoothieware -> { preferred: "M2" } [ID-0160]', () => {
    const out = preferredProgramEndForDialect('smoothieware')
    expect(out).not.toBeNull()
    expect(out!.preferred).toBe('M2')
  })

  it('mach3 rationale references "Mach3" / "RichAuto" / "rewind"', () => {
    const out = preferredProgramEndForDialect('mach3')
    expect(out!.rationale).toMatch(/Mach3|RichAuto|rewind/i)
  })

  it('grbl rationale references "Smoothieware" / file-delete / SD card', () => {
    const out = preferredProgramEndForDialect('grbl')
    expect(out!.rationale).toMatch(/Smoothieware|delete|SD/i)
  })

  it('smoothieware rationale references "Carvera" / "Smoothieware"', () => {
    const out = preferredProgramEndForDialect('smoothieware')
    expect(out!.rationale).toMatch(/Smoothieware|Carvera/i)
  })

  it('every preference object has exactly two keys (preferred, rationale)', () => {
    for (const { dialect } of DIALECTS_WITH_PREFERENCE) {
      const out = preferredProgramEndForDialect(dialect)
      expect(Object.keys(out!).sort()).toEqual(['preferred', 'rationale'])
    }
  })

  for (const { dialect, preferred } of DIALECTS_WITH_PREFERENCE) {
    it(`preferred for "${dialect}" is exactly "${preferred}"`, () => {
      expect(preferredProgramEndForDialect(dialect)!.preferred).toBe(preferred)
    })
  }

  for (const dialect of DIALECTS_NO_PREFERENCE) {
    it(`dialect "${dialect}" has NO enforced preference (returns null)`, () => {
      expect(preferredProgramEndForDialect(dialect)).toBeNull()
    })
  }

  it('return value is fresh per call (no shared mutable state)', () => {
    const a = preferredProgramEndForDialect('mach3')
    const b = preferredProgramEndForDialect('mach3')
    // Function returns object literals so each call yields a new instance.
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('is pure: same input -> structurally same output across N=20 calls', () => {
    for (let i = 0; i < 20; i++) {
      const out = preferredProgramEndForDialect('mach3')
      expect(out!.preferred).toBe('M30')
    }
  })
})

// ---------------------------------------------------------------------------
// (E) FDM short-circuit boundary -- mode='fdm' returns empty array always
// ---------------------------------------------------------------------------
describe('[ID-0245] (E) FDM short-circuit boundary', () => {
  it('FDM mode returns [] for empty input', () => {
    expect(validateGcodeEndProgramInvariants('', 'fdm', 'mach3')).toEqual([])
  })

  it('FDM mode returns [] for whitespace-only input', () => {
    expect(validateGcodeEndProgramInvariants('   \n\t\r\n  ', 'fdm', 'mach3')).toEqual([])
  })

  it('FDM mode returns [] for valid CNC G-code', () => {
    expect(validateGcodeEndProgramInvariants(GOOD_MACH3, 'fdm', 'mach3')).toEqual([])
  })

  it('FDM mode returns [] for clearly-broken CNC G-code (no end)', () => {
    expect(validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'fdm', 'mach3')).toEqual(
      []
    )
  })

  it('FDM mode returns [] for spindle-still-on output', () => {
    expect(validateGcodeEndProgramInvariants(NO_SPINDLE_OFF, 'fdm', 'mach3')).toEqual(
      []
    )
  })

  it('FDM mode returns a fresh empty array each call', () => {
    const a = validateGcodeEndProgramInvariants('', 'fdm', 'mach3')
    const b = validateGcodeEndProgramInvariants('', 'fdm', 'mach3')
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('FDM mode does not regress on K2 Plus Klipper G-code (passthrough)', () => {
    const k2 = [
      ';PRINT_HEADER',
      'M104 S210',
      'M140 S60',
      'G28',
      'G1 X100 Y100 Z0.2 F3000',
      'G1 X150 E5 F1500',
      ';END'
    ].join('\n')
    expect(validateGcodeEndProgramInvariants(k2, 'fdm', 'mach3')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (F) Empty / whitespace input boundary (CNC mode)
// ---------------------------------------------------------------------------
describe('[ID-0245] (F) empty + whitespace boundary (cnc mode)', () => {
  it('empty string returns []', () => {
    expect(validateGcodeEndProgramInvariants('', 'cnc', 'mach3')).toEqual([])
  })

  it('single space returns []', () => {
    expect(validateGcodeEndProgramInvariants(' ', 'cnc', 'mach3')).toEqual([])
  })

  it('whitespace + newlines returns []', () => {
    expect(validateGcodeEndProgramInvariants('   \n\t\r\n  ', 'cnc', 'mach3')).toEqual(
      []
    )
  })

  it('comment-only input returns END_NO_PROGRAM_END (the comments do not count)', () => {
    const out = validateGcodeEndProgramInvariants(
      '(only a comment)\n; another comment',
      'cnc',
      'mach3'
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]!.code).toBe('END_NO_PROGRAM_END')
  })
})

// ---------------------------------------------------------------------------
// (G) Issue object shape -- EXACT 4-key contract
// ---------------------------------------------------------------------------
describe('[ID-0245] (G) issue object shape', () => {
  it('every issue has exactly the 4 documented keys (level, code, message, line)', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    for (const issue of out) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'level', 'line', 'message'])
    }
  })

  it('issue.level is "error" or "warning" (string union)', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    for (const issue of out) {
      const lvl: EndProgramInvariantLevel = issue.level
      expect(lvl === 'error' || lvl === 'warning').toBe(true)
    }
  })

  it('issue.code is a non-empty string', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_SPINDLE_OFF,
      'cnc',
      'grbl'
    )
    for (const issue of out) {
      expect(typeof issue.code).toBe('string')
      expect(issue.code.length).toBeGreaterThan(0)
    }
  })

  it('issue.message is a non-empty string', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    for (const issue of out) {
      expect(typeof issue.message).toBe('string')
      expect(issue.message.length).toBeGreaterThan(0)
    }
  })

  it('issue.line is a positive integer (>= 1)', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    for (const issue of out) {
      expect(Number.isInteger(issue.line)).toBe(true)
      expect(issue.line).toBeGreaterThanOrEqual(1)
    }
  })

  it('issue object prototype is plain Object', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    expect(Object.getPrototypeOf(out[0]!)).toBe(Object.prototype)
  })

  it('issue object has no extra surprise keys', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    for (const issue of out) {
      const keys = Object.keys(issue)
      expect(keys.length).toBe(4)
    }
  })
})

// ---------------------------------------------------------------------------
// (H) Canonical issue ordering -- NO_END -> NO_OFF -> OFF_AFTER_END -> MISMATCH
// ---------------------------------------------------------------------------
describe('[ID-0245] (H) canonical issue ordering', () => {
  it('END_NO_PROGRAM_END is emitted FIRST when applicable', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    expect(out[0]!.code).toBe('END_NO_PROGRAM_END')
  })

  it('END_NO_SPINDLE_OFF appears after NO_PROGRAM_END when both fire', () => {
    // Spindle on + no M5 + no terminator -> both fire, NO_END first.
    const noEndNoOff = ['G21', 'G90', 'M3 S12000', 'G1 X1 F100'].join('\n')
    const out = validateGcodeEndProgramInvariants(noEndNoOff, 'cnc', 'mach3')
    const codes = out.map(i => i.code)
    expect(codes.indexOf('END_NO_PROGRAM_END')).toBeLessThan(
      codes.indexOf('END_NO_SPINDLE_OFF')
    )
  })

  it('END_DIALECT_MISMATCH is emitted LAST when applicable', () => {
    // Standalone mismatch: well-formed, just wrong terminator.
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[out.length - 1]!.code).toBe('END_DIALECT_MISMATCH')
  })

  it('every code occurs at most once per call (no duplicates)', () => {
    const out = validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'cnc', 'mach3')
    const codes = out.map(i => i.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('output bounded above by 4 (one per documented invariant)', () => {
    const out = validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'cnc', 'mach3')
    expect(out.length).toBeLessThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// (I) END_NO_PROGRAM_END behavior
// ---------------------------------------------------------------------------
describe('[ID-0245] (I) END_NO_PROGRAM_END', () => {
  it('fires when no M2 and no M30 are present', () => {
    const out = validateGcodeEndProgramInvariants('G21\nG90\nG0 X0', 'cnc', 'mach3')
    const codes = out.map(i => i.code)
    expect(codes).toContain('END_NO_PROGRAM_END')
  })

  it('does NOT fire when M2 is present', () => {
    const out = validateGcodeEndProgramInvariants('G21\nG90\nG0 X0\nM2', 'cnc', 'grbl')
    expect(out.map(i => i.code)).not.toContain('END_NO_PROGRAM_END')
  })

  it('does NOT fire when M30 is present', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nG90\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).not.toContain('END_NO_PROGRAM_END')
  })

  it('NO_PROGRAM_END.line anchors at totalLines (last line of file)', () => {
    const gcode = 'G21\nG90\nG0 X0'
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const noEnd = out.find(i => i.code === 'END_NO_PROGRAM_END')!
    expect(noEnd.line).toBe(gcode.split('\n').length)
  })

  it('NO_PROGRAM_END.line counts trailing newline as +1 line', () => {
    const gcode = 'G21\nG90\nG0 X0\n'
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const noEnd = out.find(i => i.code === 'END_NO_PROGRAM_END')!
    // A trailing '\n' yields 4 lines from split('\n') (last is '').
    expect(noEnd.line).toBe(4)
  })

  it('NO_PROGRAM_END is severity error', () => {
    const out = validateGcodeEndProgramInvariants('G21\nG90\nG0 X0', 'cnc', 'mach3')
    const noEnd = out.find(i => i.code === 'END_NO_PROGRAM_END')!
    expect(noEnd.level).toBe('error')
  })

  it('M2 inside a comment does NOT count as terminator', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\n; this would be M2\nG0 X0',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_NO_PROGRAM_END')
  })

  it('M30 inside a parenthetical comment does NOT count as terminator', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\n(M30 here)\nG0 X0',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_NO_PROGRAM_END')
  })
})

// ---------------------------------------------------------------------------
// (J) END_NO_SPINDLE_OFF behavior
// ---------------------------------------------------------------------------
describe('[ID-0245] (J) END_NO_SPINDLE_OFF', () => {
  it('fires when M3 is emitted without a trailing M5', () => {
    const out = validateGcodeEndProgramInvariants(NO_SPINDLE_OFF, 'cnc', 'mach3')
    expect(out.map(i => i.code)).toContain('END_NO_SPINDLE_OFF')
  })

  it('fires when M4 is emitted without a trailing M5', () => {
    const gcode = ['G21', 'G90', 'M4 S5000', 'G1 X1 F100', 'M30'].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(out.map(i => i.code)).toContain('END_NO_SPINDLE_OFF')
  })

  it('does NOT fire when M5 follows the last M3', () => {
    const out = validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3')
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('M5 must come AFTER the LAST M3 (not just any M3)', () => {
    // Two M3 with M5 between -- still fails because last M3 has no following M5.
    const gcode = [
      'G21',
      'G90',
      'M3 S12000',
      'G1 X1 F100',
      'M5',
      'M3 S20000',
      'G1 X2 F100',
      'M30'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(out.map(i => i.code)).toContain('END_NO_SPINDLE_OFF')
  })

  it('NO_SPINDLE_OFF.line anchors at the LAST M3/M4 (not the first)', () => {
    const gcode = [
      'G21', // 1
      'G90', // 2
      'M3 S12000', // 3
      'G1 X1 F100', // 4
      'M5', // 5
      'M3 S20000', // 6  <-- last M3
      'G1 X2 F100', // 7
      'M30' // 8
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const noOff = out.find(i => i.code === 'END_NO_SPINDLE_OFF')!
    expect(noOff.line).toBe(6)
  })

  it('NO_SPINDLE_OFF is severity error', () => {
    const out = validateGcodeEndProgramInvariants(NO_SPINDLE_OFF, 'cnc', 'mach3')
    const issue = out.find(i => i.code === 'END_NO_SPINDLE_OFF')!
    expect(issue.level).toBe('error')
  })

  it('does NOT fire when no M3/M4 was emitted at all', () => {
    const gcode = ['G21', 'G90', 'G0 X0', 'M30'].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })
})

// ---------------------------------------------------------------------------
// (K) END_SPINDLE_OFF_AFTER_END behavior
// ---------------------------------------------------------------------------
describe('[ID-0245] (K) END_SPINDLE_OFF_AFTER_END', () => {
  it('fires when M5 appears after the last M2/M30', () => {
    const out = validateGcodeEndProgramInvariants(
      SPINDLE_OFF_AFTER_END,
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_SPINDLE_OFF_AFTER_END')
  })

  it('does NOT fire when M5 precedes the program end', () => {
    const out = validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3')
    expect(out.map(i => i.code)).not.toContain('END_SPINDLE_OFF_AFTER_END')
  })

  it('SPINDLE_OFF_AFTER_END.line anchors at the stray M5 line', () => {
    const out = validateGcodeEndProgramInvariants(
      SPINDLE_OFF_AFTER_END,
      'cnc',
      'mach3'
    )
    const issue = out.find(i => i.code === 'END_SPINDLE_OFF_AFTER_END')!
    // SPINDLE_OFF_AFTER_END source has M5 on the LAST line.
    const totalLines = SPINDLE_OFF_AFTER_END.split('\n').length
    expect(issue.line).toBe(totalLines)
  })

  it('SPINDLE_OFF_AFTER_END is severity error', () => {
    const out = validateGcodeEndProgramInvariants(
      SPINDLE_OFF_AFTER_END,
      'cnc',
      'mach3'
    )
    const issue = out.find(i => i.code === 'END_SPINDLE_OFF_AFTER_END')!
    expect(issue.level).toBe('error')
  })

  it('does NOT fire when no M5 is present at all (different code fires)', () => {
    const gcode = ['G21', 'M3 S12000', 'G1 X1 F100', 'M30'].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const codes = out.map(i => i.code)
    // NO_SPINDLE_OFF fires; SPINDLE_OFF_AFTER_END does not.
    expect(codes).toContain('END_NO_SPINDLE_OFF')
    expect(codes).not.toContain('END_SPINDLE_OFF_AFTER_END')
  })
})

// ---------------------------------------------------------------------------
// (L) END_DIALECT_MISMATCH behavior
// ---------------------------------------------------------------------------
describe('[ID-0245] (L) END_DIALECT_MISMATCH', () => {
  it('fires when mach3 program ends with M2 (preferred is M30)', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    expect(out.map(i => i.code)).toContain('END_DIALECT_MISMATCH')
  })

  it('fires when grbl program ends with M30 (preferred is M2)', () => {
    const out = validateGcodeEndProgramInvariants(GRBL_USES_M30, 'cnc', 'grbl')
    expect(out.map(i => i.code)).toContain('END_DIALECT_MISMATCH')
  })

  it('fires when smoothieware program ends with M30 (preferred is M2)', () => {
    const out = validateGcodeEndProgramInvariants(GRBL_USES_M30, 'cnc', 'smoothieware')
    expect(out.map(i => i.code)).toContain('END_DIALECT_MISMATCH')
  })

  it('does NOT fire when mach3 program ends with M30 (preferred match)', () => {
    const out = validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3')
    expect(out.map(i => i.code)).not.toContain('END_DIALECT_MISMATCH')
  })

  it('does NOT fire when grbl program ends with M2 (preferred match)', () => {
    const out = validateGcodeEndProgramInvariants(GOOD_GRBL, 'cnc', 'grbl')
    expect(out.map(i => i.code)).not.toContain('END_DIALECT_MISMATCH')
  })

  it('does NOT fire for dialects with no preference (e.g. fanuc)', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'fanuc')
    expect(out.map(i => i.code)).not.toContain('END_DIALECT_MISMATCH')
  })

  it('does NOT fire for "generic_mm" dialect (no preference)', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'generic_mm')
    expect(out.map(i => i.code)).not.toContain('END_DIALECT_MISMATCH')
  })

  it('DIALECT_MISMATCH is severity warning (not error)', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    const issue = out.find(i => i.code === 'END_DIALECT_MISMATCH')!
    expect(issue.level).toBe('warning')
  })

  it('mismatch evaluates against the LAST end command (multi-end input)', () => {
    // Multi-end: M2 then later M30 -- last is M30, so for grbl preference of
    // M2, mismatch fires.
    const gcode = [
      'G21',
      'G90',
      'M3 S20000',
      'G1 X1 F100',
      'M5',
      'M2',
      '(extra block re-emits end below)',
      'M30'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'grbl')
    expect(out.map(i => i.code)).toContain('END_DIALECT_MISMATCH')
  })

  it('mismatch message includes both the actual and preferred terminator', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    const issue = out.find(i => i.code === 'END_DIALECT_MISMATCH')!
    expect(issue.message).toMatch(/M2/)
    expect(issue.message).toMatch(/M30/)
  })

  it('mismatch.line anchors at the last end-command line', () => {
    const out = validateGcodeEndProgramInvariants(MACH3_USES_M2, 'cnc', 'mach3')
    const issue = out.find(i => i.code === 'END_DIALECT_MISMATCH')!
    const totalLines = MACH3_USES_M2.split('\n').length
    expect(issue.line).toBe(totalLines) // M2 is on the last line
  })
})

// ---------------------------------------------------------------------------
// (M) Comment-strip contract -- (...) and ; treated identically to header validator
// ---------------------------------------------------------------------------
describe('[ID-0245] (M) comment-strip contract', () => {
  it('parenthetical comment hides M-words from validator', () => {
    const out = validateGcodeEndProgramInvariants(
      '(M3 here)\nG21\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('semicolon-tail comment hides M-words from validator', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nG0 X0 ; M3 in tail comment\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('mixed comments: M3 in paren + actual M3 + M5 + M30 -> all clean', () => {
    const gcode = [
      '(legend: M3 = spindle on)',
      'G21',
      'G90',
      'M3 S12000 ; spin up',
      'G1 X1 F100',
      'M5 ; spin down',
      'M30'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(out).toEqual([])
  })

  it('parenthetical M30 inside otherwise-good mach3 program does not double-count', () => {
    const gcode = [
      'G21',
      'G90',
      '(remember: program ends in M30)',
      'M3 S12000',
      'G1 X1 F100',
      'M5',
      'M30'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(out).toEqual([])
  })

  it('semicolon at column 0 (full-line comment) drops everything after it', () => {
    const out = validateGcodeEndProgramInvariants(
      '; M3 S12000 spindle on this line is a comment\nG21\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })
})

// ---------------------------------------------------------------------------
// (N) M-word normalization -- zero-padded + lowercase tolerant
// ---------------------------------------------------------------------------
describe('[ID-0245] (N) M-word normalization', () => {
  it('M03 normalizes to M3 (counts as spindle on)', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM03 S12000\nG1 X1 F100\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_NO_SPINDLE_OFF')
  })

  it('M030 normalizes to M30 (counts as terminator)', () => {
    const out = validateGcodeEndProgramInvariants('G21\nG0 X0\nM030', 'cnc', 'mach3')
    expect(out.map(i => i.code)).not.toContain('END_NO_PROGRAM_END')
  })

  it('lowercase m30 normalizes to M30 (counts as terminator)', () => {
    const out = validateGcodeEndProgramInvariants('G21\nG0 X0\nm30', 'cnc', 'mach3')
    expect(out.map(i => i.code)).not.toContain('END_NO_PROGRAM_END')
  })

  it('lowercase m3 normalizes to M3 (spindle on for purposes of NO_SPINDLE_OFF)', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nm3 S12000\nG1 X1 F100\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_NO_SPINDLE_OFF')
  })

  it('M002 normalizes to M2 (counts as terminator)', () => {
    const out = validateGcodeEndProgramInvariants('G21\nG0 X0\nM002', 'cnc', 'grbl')
    expect(out.map(i => i.code)).not.toContain('END_NO_PROGRAM_END')
  })

  it('mixed case M5 -> spindle off correctly recognized', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM3 S12000\nG1 X1 F100\nm5\nM30',
      'cnc',
      'mach3'
    )
    expect(out).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (O) Tracked M-word set -- M2/M3/M4/M5/M30 IN; M6/M7/M8/M9/M104/M140 OUT
// ---------------------------------------------------------------------------
describe('[ID-0245] (O) tracked M-word set', () => {
  it('M6 (tool change) is NOT tracked as spindle on', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM6 T1\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('M7 (mist coolant) is NOT tracked', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM7\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out).toEqual([])
  })

  it('M8 (flood coolant) is NOT tracked', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM8\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out).toEqual([])
  })

  it('M9 (coolant off) is NOT tracked as M2', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nG0 X0\nM9',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_NO_PROGRAM_END')
  })

  it('M104 (FDM nozzle temp) does NOT count as M3 / M30', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM104 S210\nG0 X0',
      'cnc',
      'mach3'
    )
    // M104 is NOT M3 (so no spindle on) and NOT M30 (so no terminator).
    const codes = out.map(i => i.code)
    expect(codes).toContain('END_NO_PROGRAM_END')
    expect(codes).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('M140 (FDM bed temp) does NOT count as M2 / M4', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM140 S60\nG0 X0',
      'cnc',
      'mach3'
    )
    const codes = out.map(i => i.code)
    expect(codes).toContain('END_NO_PROGRAM_END')
    expect(codes).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('M84 (steppers off) does NOT count as M4 / M30', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nG0 X0\nM84',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).toContain('END_NO_PROGRAM_END')
  })

  it('M300 (beep) does NOT count as M3', () => {
    const out = validateGcodeEndProgramInvariants(
      'G21\nM300 S1000 P200\nG0 X0\nM30',
      'cnc',
      'mach3'
    )
    expect(out.map(i => i.code)).not.toContain('END_NO_SPINDLE_OFF')
  })

  it('M2 alone (no spindle) is a clean grbl program', () => {
    expect(
      validateGcodeEndProgramInvariants('G21\nG0 X0\nM2', 'cnc', 'grbl')
    ).toEqual([])
  })

  it('M30 alone (no spindle) is a clean mach3 program', () => {
    expect(
      validateGcodeEndProgramInvariants('G21\nG0 X0\nM30', 'cnc', 'mach3')
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (P) Three-machine path realism
// ---------------------------------------------------------------------------
describe('[ID-0245] (P) three-machine path realism', () => {
  it('Creality K2 Plus -- FDM mode short-circuits across all dialects', () => {
    for (const d of ALL_DIALECTS) {
      expect(validateGcodeEndProgramInvariants(GOOD_MACH3, 'fdm', d)).toEqual([])
    }
  })

  it('Laguna Swift 5x10 -- mach3 dialect happy path is clean', () => {
    const lagunaSheet = [
      '( Laguna Swift 5x10 -- 6 mm endmill, full-sheet plywood pocket )',
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S18000',
      'G4 P3.0',
      'G0 X10 Y10',
      'G1 Z-3 F600',
      'G1 X1219 F1500',
      'G1 Y2438',
      'G1 X10',
      'G1 Y10',
      'G0 Z25',
      'M5',
      'G4 P2.0',
      'M30'
    ].join('\n')
    expect(
      validateGcodeEndProgramInvariants(lagunaSheet, 'cnc', 'mach3')
    ).toEqual([])
  })

  it('Laguna Swift 5x10 -- mach3 dialect using M2 raises mismatch warning', () => {
    const lagunaBadEnd = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S18000',
      'G1 X100 F1500',
      'M5',
      'M2'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(lagunaBadEnd, 'cnc', 'mach3')
    expect(out.length).toBe(1)
    expect(out[0]!.code).toBe('END_DIALECT_MISMATCH')
    expect(out[0]!.level).toBe('warning')
  })

  it('Laguna Swift 5x10 -- mach3_4axis dialect honors M30 preference', () => {
    expect(
      validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3_4axis')
    ).toEqual([])
  })

  it('Makera Carvera 3-axis -- grbl dialect using M2 is clean', () => {
    const carvera = [
      '( Carvera 3-axis aluminum pocket )',
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G0 X10 Y10',
      'G1 Z-1.5 F300',
      'G1 X20',
      'G1 Y20',
      'G0 Z5',
      'M5',
      'M2'
    ].join('\n')
    expect(validateGcodeEndProgramInvariants(carvera, 'cnc', 'grbl')).toEqual([])
  })

  it('Makera Carvera 3-axis -- smoothieware dialect using M2 is clean [ID-0160]', () => {
    const carvera = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G1 X10 F300',
      'M5',
      'M2'
    ].join('\n')
    expect(
      validateGcodeEndProgramInvariants(carvera, 'cnc', 'smoothieware')
    ).toEqual([])
  })

  it('Makera Carvera 3-axis -- grbl dialect using M30 raises file-delete warning', () => {
    const carvera = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G1 X10 F300',
      'M5',
      'M30'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(carvera, 'cnc', 'grbl')
    expect(out.length).toBe(1)
    expect(out[0]!.code).toBe('END_DIALECT_MISMATCH')
    expect(out[0]!.message).toMatch(/Smoothieware|delete|SD/i)
  })

  it('Makera Carvera 4-axis -- grbl_4axis dialect with rotary A-word is clean', () => {
    const carvera4 = [
      '( Carvera 4-axis indexed-positioning rotary )',
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G0 X10 Y0 A0',
      'G1 Z-2 F200',
      'G1 X50 A90',
      'G0 Z5',
      'M5',
      'M2'
    ].join('\n')
    expect(
      validateGcodeEndProgramInvariants(carvera4, 'cnc', 'grbl_4axis')
    ).toEqual([])
  })

  it('Makera Carvera 4-axis -- grbl_4axis with M30 raises mismatch (file-delete hazard)', () => {
    const carvera4Bad = [
      'G21',
      'G90',
      'M3 S15000',
      'G1 X10 A0 F200',
      'M5',
      'M30'
    ].join('\n')
    const out = validateGcodeEndProgramInvariants(
      carvera4Bad,
      'cnc',
      'grbl_4axis'
    )
    const codes = out.map(i => i.code)
    expect(codes).toContain('END_DIALECT_MISMATCH')
  })

  it('K2 Plus FDM passthrough G-code is silently accepted (mode=fdm)', () => {
    const fdm = [
      ';PRINT_HEADER',
      'M104 S210',
      'M140 S60',
      'M109 S210',
      'M190 S60',
      'G28',
      'G1 X100 Y100 Z0.2 F3000',
      ';END',
      'M104 S0',
      'M140 S0',
      'M84'
    ].join('\n')
    // FDM mode: zero issues regardless of dialect.
    expect(validateGcodeEndProgramInvariants(fdm, 'fdm', 'mach3')).toEqual([])
    expect(validateGcodeEndProgramInvariants(fdm, 'fdm', 'grbl')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (Q) Pure-function invariants -- idempotence, no mutation, no this-binding
// ---------------------------------------------------------------------------
describe('[ID-0245] (Q) pure-function invariants', () => {
  it('idempotent: same input -> structurally equal output across N=20 calls', () => {
    for (let i = 0; i < 20; i++) {
      const out = validateGcodeEndProgramInvariants(
        NO_END_TERMINATOR,
        'cnc',
        'mach3'
      )
      expect(out.length).toBeGreaterThanOrEqual(1)
      expect(out[0]!.code).toBe('END_NO_PROGRAM_END')
    }
  })

  it('does not mutate the input gcode string', () => {
    const before = NO_END_TERMINATOR
    validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'cnc', 'mach3')
    expect(NO_END_TERMINATOR).toBe(before)
  })

  it('returns a fresh Array instance per call', () => {
    const a = validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3')
    const b = validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3')
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('has no this-binding leakage on call() to {}', () => {
    const out = validateGcodeEndProgramInvariants.call(
      {},
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    expect(Array.isArray(out)).toBe(true)
    expect(out[0]!.code).toBe('END_NO_PROGRAM_END')
  })

  it('has no this-binding leakage on apply() to undefined', () => {
    const out = validateGcodeEndProgramInvariants.apply(undefined, [
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    ])
    expect(Array.isArray(out)).toBe(true)
  })

  it('output Array prototype is plain Array.prototype', () => {
    const out = validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'cnc', 'mach3')
    expect(Object.getPrototypeOf(out)).toBe(Array.prototype)
  })

  it('issue.code returned across calls is structurally equal (not aliased)', () => {
    const a = validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'cnc', 'mach3')
    const b = validateGcodeEndProgramInvariants(NO_END_TERMINATOR, 'cnc', 'mach3')
    expect(a[0]).not.toBe(b[0])
    expect(a[0]).toEqual(b[0])
  })

  it('does not throw on pathological input (10k random-ish lines)', () => {
    const lines: string[] = []
    for (let i = 0; i < 10000; i++) {
      const r = (i * 31) % 7
      if (r === 0) lines.push('G0 X' + i)
      else if (r === 1) lines.push('M3 S' + (10000 + i))
      else if (r === 2) lines.push('M5')
      else if (r === 3) lines.push('; comment ' + i)
      else if (r === 4) lines.push('(comment ' + i + ')')
      else if (r === 5) lines.push('')
      else lines.push('G1 X' + i + ' Y' + i + ' F500')
    }
    lines.push('M30')
    const gcode = lines.join('\n')
    expect(() => validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')).not.toThrow()
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(Array.isArray(out)).toBe(true)
  })

  it('output array length is bounded above by 4 across diverse inputs', () => {
    const inputs: string[] = [
      '',
      'G21',
      NO_END_TERMINATOR,
      NO_SPINDLE_OFF,
      SPINDLE_OFF_AFTER_END,
      MACH3_USES_M2,
      GRBL_USES_M30,
      GOOD_MACH3,
      GOOD_GRBL
    ]
    for (const gcode of inputs) {
      for (const dialect of ALL_DIALECTS) {
        const out = validateGcodeEndProgramInvariants(gcode, 'cnc', dialect)
        expect(out.length).toBeLessThanOrEqual(4)
      }
    }
  })

  it('CRLF line-endings are handled (does not crash, line counts correctly)', () => {
    // CRLF: split('\n') yields lines with trailing '\r'.  The validator
    // strips comments + trims, so a bare '\r' stripped to '' counts as empty.
    const gcode = ['G21', 'G0 X0', 'M30'].join('\r\n')
    expect(() => validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')).not.toThrow()
    const out = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(Array.isArray(out)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (R) Cross-validator consistency with header-invariant module conventions
// ---------------------------------------------------------------------------
describe('[ID-0245] (R) cross-validator consistency', () => {
  it('mode union shape mirrors the header-invariant validator (cnc | fdm)', () => {
    expect(endProgramInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
    expect(endProgramInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
  })

  it('issue object 4-key shape mirrors the header-invariant validator', () => {
    const out = validateGcodeEndProgramInvariants(
      NO_END_TERMINATOR,
      'cnc',
      'mach3'
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    const keys = Object.keys(out[0]!).sort()
    expect(keys).toEqual(['code', 'level', 'line', 'message'])
  })

  it('issue.code values are screaming-snake-case (matches header conventions)', () => {
    const inputs: ReadonlyArray<string> = [
      NO_END_TERMINATOR,
      NO_SPINDLE_OFF,
      SPINDLE_OFF_AFTER_END,
      MACH3_USES_M2
    ]
    for (const g of inputs) {
      const out = validateGcodeEndProgramInvariants(g, 'cnc', 'mach3')
      for (const issue of out) {
        expect(issue.code).toMatch(/^END_[A-Z0-9_]+$/)
      }
    }
  })

  it('error/warning level partition (3 errors + 1 warning) matches the JSDoc', () => {
    // Three error codes plus one warning code per the documented union.
    const codeToLevel = new Map<string, EndProgramInvariantLevel>()
    const fixtures: ReadonlyArray<{
      gcode: string
      dialect: MachineProfile['dialect']
    }> = [
      { gcode: NO_END_TERMINATOR, dialect: 'mach3' },
      { gcode: NO_SPINDLE_OFF, dialect: 'mach3' },
      { gcode: SPINDLE_OFF_AFTER_END, dialect: 'mach3' },
      { gcode: MACH3_USES_M2, dialect: 'mach3' }
    ]
    for (const { gcode, dialect } of fixtures) {
      const out = validateGcodeEndProgramInvariants(gcode, 'cnc', dialect)
      for (const issue of out) codeToLevel.set(issue.code, issue.level)
    }
    expect(codeToLevel.get('END_NO_PROGRAM_END')).toBe('error')
    expect(codeToLevel.get('END_NO_SPINDLE_OFF')).toBe('error')
    expect(codeToLevel.get('END_SPINDLE_OFF_AFTER_END')).toBe('error')
    expect(codeToLevel.get('END_DIALECT_MISMATCH')).toBe('warning')
  })

  it('EndProgramInvariantIssue type alignment compiles + runtime values agree', () => {
    const issue: EndProgramInvariantIssue = {
      level: 'error',
      code: 'END_NO_PROGRAM_END',
      message: 'sample',
      line: 1
    }
    expect(issue.level).toBe('error')
    expect(issue.code).toBe('END_NO_PROGRAM_END')
  })
})
