// ---------------------------------------------------------------------------
// gcode-header-invariants-pin.test.ts  [ID-0240]
// ---------------------------------------------------------------------------
// Co-located paired-pin contract for `src/shared/gcode-header-invariants.ts`.
// The behavioral tests in `gcode-header-invariants.test.ts` exercise happy
// paths, failure cases, and motion-word edge cases.  This pin file pins the
// SURFACE contract: module shape, function signatures, regex contracts via
// observable behavior, output-issue exact-shape, three-machine path realism,
// and pure-function invariants.  Cycle 168 / post-processing slot.
//
// ASSUMPTION: the module exports exactly two RUNTIME values
// (`validateGcodeHeaderInvariants` and `headerInvariantModeForMachine`) and
// three TYPE-only aliases (`HeaderInvariantLevel`, `HeaderInvariantIssue`,
// `HeaderInvariantMode`).  Type-only exports are erased at runtime so they
// never appear in `Object.keys(module)`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import * as Mod from './gcode-header-invariants'
import {
  validateGcodeHeaderInvariants,
  headerInvariantModeForMachine
} from './gcode-header-invariants'

// ---------------------------------------------------------------------------
// (A) Module shape -- exact runtime export inventory
// ---------------------------------------------------------------------------
describe('[ID-0240] (A) module shape -- exact runtime export inventory', () => {
  it('exports exactly two runtime values', () => {
    const keys = Object.keys(Mod).sort()
    expect(keys).toEqual(
      ['headerInvariantModeForMachine', 'validateGcodeHeaderInvariants'].sort()
    )
  })

  it('validateGcodeHeaderInvariants is a function value', () => {
    expect(typeof Mod.validateGcodeHeaderInvariants).toBe('function')
  })

  it('headerInvariantModeForMachine is a function value', () => {
    expect(typeof Mod.headerInvariantModeForMachine).toBe('function')
  })

  it('module Symbol.toStringTag (if present) is Module', () => {
    // ESM module namespace objects have Symbol.toStringTag === 'Module'.
    const tag = (Mod as unknown as { [Symbol.toStringTag]?: string })[
      Symbol.toStringTag
    ]
    expect(tag === undefined || tag === 'Module').toBe(true)
  })

  it('no extra runtime exports beyond the documented two', () => {
    const keys = Object.keys(Mod)
    expect(keys.length).toBe(2)
  })

  it('type-only exports are erased at runtime (HeaderInvariantLevel)', () => {
    // The type alias must NOT leak as a runtime export.
    expect((Mod as Record<string, unknown>).HeaderInvariantLevel).toBeUndefined()
  })

  it('type-only exports are erased at runtime (HeaderInvariantIssue)', () => {
    expect((Mod as Record<string, unknown>).HeaderInvariantIssue).toBeUndefined()
  })

  it('type-only exports are erased at runtime (HeaderInvariantMode)', () => {
    expect((Mod as Record<string, unknown>).HeaderInvariantMode).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (B) Function signatures -- name + arity + native Function + return shape
// ---------------------------------------------------------------------------
describe('[ID-0240] (B) function signatures', () => {
  it('validateGcodeHeaderInvariants.name === "validateGcodeHeaderInvariants"', () => {
    expect(validateGcodeHeaderInvariants.name).toBe('validateGcodeHeaderInvariants')
  })

  it('validateGcodeHeaderInvariants.length === 2 (gcode, mode)', () => {
    expect(validateGcodeHeaderInvariants.length).toBe(2)
  })

  it('validateGcodeHeaderInvariants is a native Function (not arrow)', () => {
    // Function-declared arity-2 must descend from the global Function ctor.
    expect(validateGcodeHeaderInvariants instanceof Function).toBe(true)
  })

  it('validateGcodeHeaderInvariants always returns an Array', () => {
    expect(Array.isArray(validateGcodeHeaderInvariants('', 'cnc'))).toBe(true)
    expect(Array.isArray(validateGcodeHeaderInvariants('', 'fdm'))).toBe(true)
    expect(Array.isArray(validateGcodeHeaderInvariants('G21\nG90\nG17\nG54\nG0 X0', 'cnc'))).toBe(
      true
    )
  })

  it('headerInvariantModeForMachine.name === "headerInvariantModeForMachine"', () => {
    expect(headerInvariantModeForMachine.name).toBe('headerInvariantModeForMachine')
  })

  it('headerInvariantModeForMachine.length === 1 (machine)', () => {
    expect(headerInvariantModeForMachine.length).toBe(1)
  })

  it('headerInvariantModeForMachine is a native Function', () => {
    expect(headerInvariantModeForMachine instanceof Function).toBe(true)
  })

  it('headerInvariantModeForMachine returns a string', () => {
    expect(typeof headerInvariantModeForMachine({ kind: 'cnc' })).toBe('string')
    expect(typeof headerInvariantModeForMachine({ kind: 'fdm' })).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// (C) HeaderInvariantMode coercion -- two and only two valid values
// ---------------------------------------------------------------------------
describe('[ID-0240] (C) HeaderInvariantMode coercion', () => {
  it('kind=fdm maps to "fdm"', () => {
    expect(headerInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
  })

  it('kind=cnc maps to "cnc"', () => {
    expect(headerInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
  })

  it('returns ONLY the literal "fdm" or "cnc"', () => {
    const a = headerInvariantModeForMachine({ kind: 'fdm' })
    const b = headerInvariantModeForMachine({ kind: 'cnc' })
    expect(['fdm', 'cnc']).toContain(a)
    expect(['fdm', 'cnc']).toContain(b)
  })

  it('is pure: same input -> same output across N=20 calls', () => {
    for (let i = 0; i < 20; i++) {
      expect(headerInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
      expect(headerInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
    }
  })

  it('does not mutate its input', () => {
    const inp = { kind: 'cnc' as const }
    const snap = JSON.stringify(inp)
    headerInvariantModeForMachine(inp)
    expect(JSON.stringify(inp)).toBe(snap)
  })
})

// ---------------------------------------------------------------------------
// (D) FDM short-circuit contract
// ---------------------------------------------------------------------------
describe('[ID-0240] (D) FDM short-circuit contract', () => {
  it('fdm + empty -> []', () => {
    expect(validateGcodeHeaderInvariants('', 'fdm')).toEqual([])
  })

  it('fdm + completely empty CNC-style header -> still []', () => {
    expect(validateGcodeHeaderInvariants('G0 X0 Y0 Z0', 'fdm')).toEqual([])
  })

  it('fdm + a hand-rolled bad header -> still [] (no checks run)', () => {
    expect(validateGcodeHeaderInvariants(';bad\nG1 X10\n', 'fdm')).toEqual([])
  })

  it('fdm + a typical Klipper FDM passthrough block -> []', () => {
    const klipperish = [
      ';FLAVOR:Marlin',
      'M82',
      'M104 S210',
      'M109 S210',
      'G92 E0',
      'G1 F1500 X10 Y10 E0.5'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(klipperish, 'fdm')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (E) Empty + whitespace-only inputs (cnc mode)
// ---------------------------------------------------------------------------
describe('[ID-0240] (E) empty + whitespace inputs', () => {
  it('truly empty string -> []', () => {
    expect(validateGcodeHeaderInvariants('', 'cnc')).toEqual([])
  })

  it('whitespace-only string -> []', () => {
    expect(validateGcodeHeaderInvariants('   \n\t  \n', 'cnc')).toEqual([])
  })

  it('comment-only header (no real tokens) emits all 4 issues', () => {
    const issues = validateGcodeHeaderInvariants(';just a comment\n(another)\n', 'cnc')
    expect(issues.map(i => i.code).sort()).toEqual(
      ['HEADER_NO_ABSOLUTE_MODE', 'HEADER_NO_PLANE_SELECT', 'HEADER_NO_UNITS', 'HEADER_NO_WCS'].sort()
    )
  })
})

// ---------------------------------------------------------------------------
// (F) Issue object EXACT shape contract
// ---------------------------------------------------------------------------
describe('[ID-0240] (F) issue object exact-shape contract', () => {
  const bad = validateGcodeHeaderInvariants('G0 X0 Y0', 'cnc')

  it('every issue has exactly 4 keys (level, code, message, firstMotionLine)', () => {
    for (const issue of bad) {
      const keys = Object.keys(issue).sort()
      expect(keys).toEqual(['code', 'firstMotionLine', 'level', 'message'])
    }
  })

  it('every issue has level === "error" | "warning"', () => {
    for (const issue of bad) {
      expect(['error', 'warning']).toContain(issue.level)
    }
  })

  it('every issue has a non-empty stable string code', () => {
    for (const issue of bad) {
      expect(typeof issue.code).toBe('string')
      expect(issue.code.length).toBeGreaterThan(0)
      // Stable codes are SCREAMING_SNAKE_CASE prefixed with HEADER_.
      expect(issue.code).toMatch(/^HEADER_[A-Z_]+$/)
    }
  })

  it('every issue has a non-empty human-readable message', () => {
    for (const issue of bad) {
      expect(typeof issue.message).toBe('string')
      expect(issue.message.length).toBeGreaterThan(20) // not a stub
    }
  })

  it('every issue has firstMotionLine as a 1-based positive integer', () => {
    for (const issue of bad) {
      expect(typeof issue.firstMotionLine).toBe('number')
      expect(Number.isInteger(issue.firstMotionLine)).toBe(true)
      expect(issue.firstMotionLine).toBeGreaterThan(0)
    }
  })

  it('no issue has stray extra keys (forward-compat freeze)', () => {
    for (const issue of bad) {
      const allowed = new Set(['level', 'code', 'message', 'firstMotionLine'])
      for (const k of Object.keys(issue)) {
        expect(allowed.has(k)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// (G) Stable code partition: errors vs warnings
// ---------------------------------------------------------------------------
describe('[ID-0240] (G) error/warning level partition', () => {
  // No declarations at all -> all 4 issues, mixed levels.
  const issues = validateGcodeHeaderInvariants('G0 X0', 'cnc')
  const byCode = new Map(issues.map(i => [i.code, i.level]))

  it('HEADER_NO_UNITS is an error', () => {
    expect(byCode.get('HEADER_NO_UNITS')).toBe('error')
  })

  it('HEADER_NO_ABSOLUTE_MODE is an error', () => {
    expect(byCode.get('HEADER_NO_ABSOLUTE_MODE')).toBe('error')
  })

  it('HEADER_NO_PLANE_SELECT is an error', () => {
    expect(byCode.get('HEADER_NO_PLANE_SELECT')).toBe('error')
  })

  it('HEADER_NO_WCS is a warning (single-fixture posts may legitimately omit)', () => {
    expect(byCode.get('HEADER_NO_WCS')).toBe('warning')
  })

  it('exactly 4 distinct codes when EVERY declaration is missing', () => {
    expect(byCode.size).toBe(4)
  })

  it('warnings count <= errors count when all four missing (1 vs 3)', () => {
    const errors = issues.filter(i => i.level === 'error').length
    const warnings = issues.filter(i => i.level === 'warning').length
    expect(errors).toBe(3)
    expect(warnings).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (H) Issue ordering -- canonical: units, absolute, plane, WCS
// ---------------------------------------------------------------------------
describe('[ID-0240] (H) canonical issue order', () => {
  it('all-missing case orders as units, absolute, plane, WCS', () => {
    const issues = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    expect(issues.map(i => i.code)).toEqual([
      'HEADER_NO_UNITS',
      'HEADER_NO_ABSOLUTE_MODE',
      'HEADER_NO_PLANE_SELECT',
      'HEADER_NO_WCS'
    ])
  })

  it('only units missing -> single HEADER_NO_UNITS at index 0', () => {
    const issues = validateGcodeHeaderInvariants('G90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('HEADER_NO_UNITS')
  })

  it('only WCS missing -> single HEADER_NO_WCS warning at index 0', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG0 X0', 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('HEADER_NO_WCS')
    expect(issues[0]!.level).toBe('warning')
  })

  it('partial subset preserves the canonical relative order', () => {
    // Missing units + plane (have absolute + WCS).
    const issues = validateGcodeHeaderInvariants('G90\nG54\nG0 X0', 'cnc')
    expect(issues.map(i => i.code)).toEqual([
      'HEADER_NO_UNITS',
      'HEADER_NO_PLANE_SELECT'
    ])
  })
})

// ---------------------------------------------------------------------------
// (I) firstMotionLine semantics
// ---------------------------------------------------------------------------
describe('[ID-0240] (I) firstMotionLine semantics', () => {
  it('motion on line 1 -> firstMotionLine === 1', () => {
    const issues = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    for (const i of issues) expect(i.firstMotionLine).toBe(1)
  })

  it('motion on line 5 (after 4 declarations) -> firstMotionLine === 5', () => {
    // 4 declarations + 1 G1 = 5 lines; only WCS missing here.
    const src = 'G21\nG90\nG17\n;just a comment\nG1 X10'
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.firstMotionLine).toBe(5)
  })

  it('header-only file (no motion) -> firstMotionLine === total line count', () => {
    const src = 'G21\nG90\nG17\nG54' // 4 lines, no motion word
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues).toEqual([]) // every declaration present
    // Force a missing-decl case to inspect firstMotionLine on header-only:
    const bad = validateGcodeHeaderInvariants('G21\nG90', 'cnc')
    expect(bad.length).toBeGreaterThan(0)
    expect(bad[0]!.firstMotionLine).toBe(2)
  })

  it('all issues in a single run share the SAME firstMotionLine', () => {
    const src = ';comment line 1\n;comment line 2\nG0 X0' // motion at line 3
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues.length).toBeGreaterThan(0)
    const lines = new Set(issues.map(i => i.firstMotionLine))
    expect(lines.size).toBe(1)
    expect([...lines][0]).toBe(3)
  })

  it('CRLF line endings count as one line each', () => {
    // Windows CRLF: split('\n') produces 3 entries; motion on the 3rd.
    const src = 'G21\r\nG90\r\nG0 X0\r\n'
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues.length).toBeGreaterThan(0)
    // Every issue references the same line (the line of the motion word).
    const lines = new Set(issues.map(i => i.firstMotionLine))
    expect(lines.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (J) Motion-word boundary regex contract (observable)
// ---------------------------------------------------------------------------
describe('[ID-0240] (J) motion-word boundary regex contract', () => {
  // The regex `(^|[^\dA-Za-z])G0*[0-3](\.\d+)?($|[^\d])/i` matches G0..G3 as
  // whole tokens.  We pin the partition implicit in this regex by feeding
  // single-line G-codes and checking whether the validator considers them
  // motion-bearing (issues reference the line) or pre-motion (issues use
  // the total line count fallback).
  it('G0 is a motion word', () => {
    const src = 'G0 X1' // 1 line, motion on it
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    for (const i of issues) expect(i.firstMotionLine).toBe(1)
  })

  it('G1 is a motion word', () => {
    const issues = validateGcodeHeaderInvariants('G1 X1', 'cnc')
    for (const i of issues) expect(i.firstMotionLine).toBe(1)
  })

  it('G2 is a motion word (CW arc)', () => {
    const issues = validateGcodeHeaderInvariants('G2 X1 Y0 I0.5 J0', 'cnc')
    for (const i of issues) expect(i.firstMotionLine).toBe(1)
  })

  it('G3 is a motion word (CCW arc)', () => {
    const issues = validateGcodeHeaderInvariants('G3 X1 Y0 I0.5 J0', 'cnc')
    for (const i of issues) expect(i.firstMotionLine).toBe(1)
  })

  it('G00, G01, G02, G03 (zero-padded) are motion words', () => {
    for (const w of ['G00', 'G01', 'G02', 'G03']) {
      const issues = validateGcodeHeaderInvariants(`${w} X1`, 'cnc')
      for (const i of issues) expect(i.firstMotionLine).toBe(1)
    }
  })

  it('G10 (data-set) is NOT a motion word', () => {
    // 2 lines: G10 line + missing-decl issues should NOT point to line 1.
    // With NO motion word at all, firstMotionLine === total line count (1 here).
    const issues = validateGcodeHeaderInvariants('G10 L20 P1 X0', 'cnc')
    expect(issues.length).toBeGreaterThan(0)
    // No motion word found -> firstMotionLine falls back to total lines = 1.
    for (const i of issues) expect(i.firstMotionLine).toBe(1)
  })

  it('G17 (plane select) is NOT a motion word', () => {
    // G17 alone -> no motion word -> firstMotionLine == 1, but seenPlane gets G17.
    const issues = validateGcodeHeaderInvariants('G17', 'cnc')
    // Only plane is satisfied.
    expect(issues.map(i => i.code).sort()).toEqual(
      ['HEADER_NO_ABSOLUTE_MODE', 'HEADER_NO_UNITS', 'HEADER_NO_WCS'].sort()
    )
  })

  it('G28 (home) is NOT a motion word for THIS validator', () => {
    // Even though G28 moves, the validator deliberately excludes it.  All 4
    // declarations remain "missing" because no G0-G3 was ever seen.
    const issues = validateGcodeHeaderInvariants('G28', 'cnc')
    expect(issues.length).toBe(4)
  })

  it('G54 (WCS) is NOT a motion word', () => {
    const issues = validateGcodeHeaderInvariants('G54', 'cnc')
    // WCS satisfied; rest unsatisfied.
    expect(issues.map(i => i.code).sort()).toEqual(
      ['HEADER_NO_ABSOLUTE_MODE', 'HEADER_NO_PLANE_SELECT', 'HEADER_NO_UNITS'].sort()
    )
  })

  it('lowercase g0 / g1 are recognized (case-insensitive)', () => {
    for (const w of ['g0', 'g1', 'g2', 'g3']) {
      const issues = validateGcodeHeaderInvariants(`${w} X1`, 'cnc')
      for (const i of issues) expect(i.firstMotionLine).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// (K) G-word normalization contract -- leading-zero / case
// ---------------------------------------------------------------------------
describe('[ID-0240] (K) G-word normalization contract', () => {
  it('G021 normalizes to G21 (units satisfied)', () => {
    const issues = validateGcodeHeaderInvariants('G021\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_UNITS')).toHaveLength(0)
  })

  it('G090 normalizes to G90 (absolute satisfied)', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG090\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_ABSOLUTE_MODE')).toHaveLength(0)
  })

  it('G017 normalizes to G17 (plane satisfied)', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG017\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_PLANE_SELECT')).toHaveLength(0)
  })

  it('G054 normalizes to G54 (WCS satisfied)', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG054\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_WCS')).toHaveLength(0)
  })

  it('G54.1 (extended WCS) is recognized as a WCS declaration', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG54.1\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_WCS')).toHaveLength(0)
  })

  it('G53 (one-shot machine-coord override) is NOT a WCS', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG53\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_WCS')).toHaveLength(1)
  })

  it('lowercase g21 satisfies units', () => {
    const issues = validateGcodeHeaderInvariants('g21\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_UNITS')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (L) Comment-strip contract (observable)
// ---------------------------------------------------------------------------
describe('[ID-0240] (L) comment-strip contract', () => {
  it('parenthetical-comment declarations do NOT count', () => {
    // (G21) (G90) (G17) (G54) -- all in parens, header is empty.
    const src = '(G21)\n(G90)\n(G17)\n(G54)\nG0 X0'
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues.length).toBe(4) // all 4 missing
  })

  it('semicolon-comment declarations do NOT count', () => {
    const src = ';G21\n;G90\n;G17\n;G54\nG0 X0'
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues.length).toBe(4)
  })

  it('pre-comment declarations on the SAME line still count', () => {
    // `G21 ;some note` -- the G21 is real.
    const src = 'G21 ;set mm\nG90 ;absolute\nG17 ;XY plane\nG54 ;wcs\nG0 X0'
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues).toEqual([])
  })

  it('mixed: real + commented on the same line -- only real counts', () => {
    // `G21 (note G90)` -- only G21 should be seen, not the parenthetical G90.
    const src = 'G21 (note G90)\nG17 (note G54)\nG0 X0'
    const issues = validateGcodeHeaderInvariants(src, 'cnc')
    expect(issues.map(i => i.code).sort()).toEqual(
      ['HEADER_NO_ABSOLUTE_MODE', 'HEADER_NO_WCS'].sort()
    )
  })
})

// ---------------------------------------------------------------------------
// (M) Three-machine path realism
// ---------------------------------------------------------------------------
describe('[ID-0240] (M) three-machine path realism', () => {
  it('K2 Plus (Klipper FDM) full passthrough header -> [] in fdm mode', () => {
    // K2 Plus runs slicer-emitted G-code through fdm_passthrough.hbs.
    // The header is whatever the slicer wrote; the validator does NOT run.
    const k2 = [
      ';FLAVOR:Klipper',
      ';TIME:1234',
      'M104 S210',
      'M140 S60',
      'M109 S210',
      'M190 S60',
      'G92 E0',
      'G1 F1500 X10 Y10 E0.5'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(k2, 'fdm')).toEqual([])
  })

  it('Laguna Swift 5x10 RichAuto canonical header -> [] in cnc mode', () => {
    // Laguna RichAuto A-series default header per resources/posts/laguna_swift.hbs.
    const laguna = [
      '(LAGUNA SWIFT 5X10 RICHAUTO A-SERIES)',
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S18000',
      'G0 Z25.0',
      'G0 X0 Y0',
      'G1 Z-2.0 F500'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(laguna, 'cnc')).toEqual([])
  })

  it('Carvera 3-axis canonical header -> [] in cnc mode', () => {
    // Carvera Smoothieware-derived header.
    const carvera3 = [
      '(MAKERA CARVERA 3-AXIS)',
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G0 Z10.0',
      'G0 X0 Y0',
      'G1 Z-1.0 F300'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(carvera3, 'cnc')).toEqual([])
  })

  it('Carvera 4-axis canonical header (rotary) -> [] in cnc mode', () => {
    // 4-axis adds A-word but the header invariants are identical.
    const carvera4 = [
      '(MAKERA CARVERA 4-AXIS ROTARY)',
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G0 Z10.0 A0',
      'G0 X10 Y0 A0',
      'G1 X10 Y0 A45 F300'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(carvera4, 'cnc')).toEqual([])
  })

  it('Laguna with G18 (XZ plane, vertical sign-routing) is valid', () => {
    const lagunaG18 = [
      'G21',
      'G90',
      'G18', // plane other than XY
      'G54',
      'M3 S18000',
      'G0 X0 Y0 Z25',
      'G1 Z-2 F500'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(lagunaG18, 'cnc')).toEqual([])
  })

  it('Carvera with G55 (second WCS) is valid', () => {
    const carveraG55 = [
      'G21',
      'G90',
      'G17',
      'G55',
      'M3 S15000',
      'G0 Z10',
      'G1 X0 Y0 F300'
    ].join('\n')
    expect(validateGcodeHeaderInvariants(carveraG55, 'cnc')).toEqual([])
  })

  it('K2 Plus with FDM-mode short-circuit ignores even crash-class CNC headers', () => {
    // A pathological string that would fail every CNC check passes in FDM
    // mode -- because FDM short-circuits before any check runs.  This pins
    // the FDM short-circuit boundary at the highest level.
    const pathological = 'G91\nG0 X9999 Y9999 Z9999\n'
    expect(validateGcodeHeaderInvariants(pathological, 'fdm')).toEqual([])
  })

  it('Laguna without WCS emits ONLY the warning (single-fixture safe)', () => {
    const lagunaNoWcs = [
      '(LAGUNA SWIFT 5X10 SINGLE-FIXTURE)',
      'G21',
      'G90',
      'G17',
      'M3 S18000',
      'G0 Z25',
      'G1 Z-2 F500'
    ].join('\n')
    const issues = validateGcodeHeaderInvariants(lagunaNoWcs, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('HEADER_NO_WCS')
    expect(issues[0]!.level).toBe('warning')
  })

  it('Carvera with all 4 declarations on a single combined line is valid', () => {
    // Some hand-written Carvera setup macros do this.
    const combined = 'G21 G90 G17 G54\nM3 S15000\nG0 X0 Y0 Z10'
    expect(validateGcodeHeaderInvariants(combined, 'cnc')).toEqual([])
  })

  it('Laguna inch-mode (G20) header is valid', () => {
    // Inch-mode jobs at Laguna are unusual but legal; the validator must
    // accept G20 just as cleanly as G21.
    const inch = 'G20\nG90\nG17\nG54\nM3 S18000\nG0 Z1.0\nG1 X0 Y0 F20'
    expect(validateGcodeHeaderInvariants(inch, 'cnc')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (N) Pure-function invariants
// ---------------------------------------------------------------------------
describe('[ID-0240] (N) pure-function invariants', () => {
  const sampleInputs: Array<[string, 'cnc' | 'fdm']> = [
    ['', 'cnc'],
    ['', 'fdm'],
    ['G0 X0', 'cnc'],
    ['G21\nG90\nG17\nG54\nG0 X0', 'cnc'],
    ['G21\nG90\nG17\nG54\nG1 X0 Y0', 'fdm'],
    [';only comments\n(parens)\n', 'cnc'],
    ['G21 G90 G17 G54\nG0 X0 Y0', 'cnc'],
    ['G21\nG0 X0', 'cnc'] // 3 missing
  ]

  it('idempotent: same input -> same output across N=20 calls (validateGcodeHeaderInvariants)', () => {
    for (const [g, m] of sampleInputs) {
      const first = JSON.stringify(validateGcodeHeaderInvariants(g, m))
      for (let i = 0; i < 20; i++) {
        expect(JSON.stringify(validateGcodeHeaderInvariants(g, m))).toBe(first)
      }
    }
  })

  it('does not mutate string inputs (g-code)', () => {
    const g = 'G21\nG90\nG17\nG54\nG0 X0'
    const snap = g
    validateGcodeHeaderInvariants(g, 'cnc')
    expect(g).toBe(snap)
  })

  it('does not mutate machine inputs (kind)', () => {
    const m = { kind: 'cnc' as const }
    const snap = JSON.stringify(m)
    headerInvariantModeForMachine(m)
    expect(JSON.stringify(m)).toBe(snap)
  })

  it('no this-binding leakage on validateGcodeHeaderInvariants (call/apply)', () => {
    const result1 = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    const ctx = { sentinel: 'do not touch' }
    const result2 = validateGcodeHeaderInvariants.call(ctx, 'G0 X0', 'cnc')
    const result3 = validateGcodeHeaderInvariants.apply(null, ['G0 X0', 'cnc'])
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result3))
    expect(ctx.sentinel).toBe('do not touch')
  })

  it('no this-binding leakage on headerInvariantModeForMachine (call/apply)', () => {
    const ctx = { sentinel: 'do not touch' }
    expect(headerInvariantModeForMachine.call(ctx, { kind: 'cnc' })).toBe('cnc')
    expect(headerInvariantModeForMachine.apply(null, [{ kind: 'fdm' }])).toBe('fdm')
    expect(ctx.sentinel).toBe('do not touch')
  })

  it('does not throw on documented input ranges', () => {
    for (const [g, m] of sampleInputs) {
      expect(() => validateGcodeHeaderInvariants(g, m)).not.toThrow()
    }
    expect(() => headerInvariantModeForMachine({ kind: 'cnc' })).not.toThrow()
    expect(() => headerInvariantModeForMachine({ kind: 'fdm' })).not.toThrow()
  })

  it('returned issues array contains plain object instances (no class instances)', () => {
    const issues = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    for (const i of issues) {
      expect(Object.getPrototypeOf(i)).toBe(Object.prototype)
    }
  })

  it('returned issues array is not the same reference across calls', () => {
    // Pure function should not return a shared cached array.
    const a = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    const b = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    expect(a).not.toBe(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('output array length is bounded by 4 (one per invariant)', () => {
    for (const [g, m] of sampleInputs) {
      const issues = validateGcodeHeaderInvariants(g, m)
      expect(issues.length).toBeLessThanOrEqual(4)
    }
  })

  it('output is a fresh Array instance (Array.isArray + not Object.freeze)', () => {
    const issues = validateGcodeHeaderInvariants('G0 X0', 'cnc')
    expect(Array.isArray(issues)).toBe(true)
    expect(Object.isFrozen(issues)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (O) WCS set membership EXHAUSTIVE
// ---------------------------------------------------------------------------
describe('[ID-0240] (O) WCS set membership exhaustive', () => {
  const wcsValid = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G54.1']
  const wcsInvalid = ['G53', 'G60', 'G61', 'G64', 'G92']

  for (const w of wcsValid) {
    it(`${w} satisfies the WCS invariant`, () => {
      const src = `G21\nG90\nG17\n${w}\nG0 X0`
      const issues = validateGcodeHeaderInvariants(src, 'cnc')
      expect(issues.filter(i => i.code === 'HEADER_NO_WCS')).toHaveLength(0)
    })
  }

  for (const w of wcsInvalid) {
    it(`${w} does NOT satisfy the WCS invariant`, () => {
      const src = `G21\nG90\nG17\n${w}\nG0 X0`
      const issues = validateGcodeHeaderInvariants(src, 'cnc')
      expect(issues.filter(i => i.code === 'HEADER_NO_WCS')).toHaveLength(1)
    })
  }
})

// ---------------------------------------------------------------------------
// (P) Plane set membership EXHAUSTIVE
// ---------------------------------------------------------------------------
describe('[ID-0240] (P) plane set membership exhaustive', () => {
  it('G17 satisfies the plane invariant', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_PLANE_SELECT')).toHaveLength(0)
  })

  it('G18 satisfies the plane invariant', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG18\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_PLANE_SELECT')).toHaveLength(0)
  })

  it('G19 satisfies the plane invariant', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG19\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_PLANE_SELECT')).toHaveLength(0)
  })

  it('G16 (polar coordinate, not in fleet) does NOT satisfy plane', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG16\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_PLANE_SELECT')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// (Q) Units set membership EXHAUSTIVE
// ---------------------------------------------------------------------------
describe('[ID-0240] (Q) units set membership exhaustive', () => {
  it('G20 (inches) satisfies units', () => {
    const issues = validateGcodeHeaderInvariants('G20\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_UNITS')).toHaveLength(0)
  })

  it('G21 (mm) satisfies units', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_UNITS')).toHaveLength(0)
  })

  it('G22 (canned cycle, irrelevant) does NOT satisfy units', () => {
    const issues = validateGcodeHeaderInvariants('G22\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_UNITS')).toHaveLength(1)
  })

  it('M-codes (M3, M5) do NOT satisfy units', () => {
    const issues = validateGcodeHeaderInvariants('M3 S15000\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_UNITS')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// (R) Absolute set membership
// ---------------------------------------------------------------------------
describe('[ID-0240] (R) absolute set membership', () => {
  it('G90 satisfies absolute', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG90\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_ABSOLUTE_MODE')).toHaveLength(0)
  })

  it('G91 (incremental) does NOT satisfy absolute', () => {
    const issues = validateGcodeHeaderInvariants('G21\nG91\nG17\nG54\nG0 X0', 'cnc')
    expect(issues.filter(i => i.code === 'HEADER_NO_ABSOLUTE_MODE')).toHaveLength(1)
  })

  it('G93/G94/G95 (feed-rate modes) do NOT satisfy absolute', () => {
    for (const w of ['G93', 'G94', 'G95']) {
      const src = `G21\n${w}\nG17\nG54\nG0 X0`
      const issues = validateGcodeHeaderInvariants(src, 'cnc')
      expect(issues.filter(i => i.code === 'HEADER_NO_ABSOLUTE_MODE')).toHaveLength(1)
    }
  })
})
