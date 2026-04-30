import { describe, expect, it } from 'vitest'
import type { MachineProfile } from './machine-schema'
import {
  endProgramInvariantModeForMachine,
  preferredProgramEndForDialect,
  validateGcodeEndProgramInvariants
} from './gcode-end-program-invariants'

// Canonical mach3 (Laguna Swift / RichAuto) program end: spindle on + cut +
// spindle off + M30.
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

// Canonical grbl (Carvera / Smoothieware) program end: spindle on + cut +
// spindle off + M2 (NOT M30 -- Smoothieware file-delete hazard).
const GOOD_GRBL = [
  'G21',
  'G90',
  'G17',
  'G54',
  'M3 S12000',
  'G4 P2',
  'G0 X10 Y10',
  'G1 Z-2.0 F200',
  'M5',
  'G0 Z150',
  'M2'
].join('\n')

describe('[ID-0108] validateGcodeEndProgramInvariants -- happy paths', () => {
  it('empty input returns zero issues', () => {
    expect(validateGcodeEndProgramInvariants('', 'cnc', 'mach3')).toEqual([])
    expect(validateGcodeEndProgramInvariants('   \n\n', 'cnc', 'grbl')).toEqual([])
  })

  it('fdm mode short-circuits regardless of content', () => {
    // This input lacks every CNC invariant -- but FDM mode skips them all.
    const sample = 'G1 X10 Y10 E0.5\nG1 X20 Y20 E1.0'
    expect(validateGcodeEndProgramInvariants(sample, 'fdm', 'generic_mm')).toEqual([])
  })

  it('good mach3 program passes every invariant with M30 terminator', () => {
    expect(validateGcodeEndProgramInvariants(GOOD_MACH3, 'cnc', 'mach3')).toEqual([])
  })

  it('good grbl program passes every invariant with M2 terminator', () => {
    expect(validateGcodeEndProgramInvariants(GOOD_GRBL, 'cnc', 'grbl')).toEqual([])
  })

  it('good grbl_4axis program (M2 + M3/M5 pair) passes every invariant', () => {
    const rotary = GOOD_GRBL + '\nG0 A0\n'
    expect(
      validateGcodeEndProgramInvariants(rotary, 'cnc', 'grbl_4axis')
    ).toEqual([])
  })

  it('no-spindle program with M2/M30 alone passes (no M3/M4 emitted)', () => {
    // A pure-positioning program with no spindle word -- the spindle-off
    // invariant only fires when M3/M4 was observed.
    const gcode = 'G21\nG90\nG17\nG54\nG0 X0 Y0\nM2'
    expect(validateGcodeEndProgramInvariants(gcode, 'cnc', 'grbl')).toEqual([])
  })
})

describe('[ID-0108] END_NO_PROGRAM_END -- missing terminator', () => {
  it('mach3 program without M2 or M30 surfaces an error', () => {
    const missing = GOOD_MACH3.replace(/\nM30$/, '')
    const issues = validateGcodeEndProgramInvariants(missing, 'cnc', 'mach3')
    const endless = issues.filter(i => i.code === 'END_NO_PROGRAM_END')
    expect(endless).toHaveLength(1)
    expect(endless[0]!.level).toBe('error')
    expect(endless[0]!.message).toMatch(/M2 or M30/)
  })

  it('grbl program without M2 or M30 surfaces an error', () => {
    const missing = GOOD_GRBL.replace(/\nM2$/, '')
    const issues = validateGcodeEndProgramInvariants(missing, 'cnc', 'grbl')
    const endless = issues.filter(i => i.code === 'END_NO_PROGRAM_END')
    expect(endless).toHaveLength(1)
  })

  it('END_NO_PROGRAM_END line anchor is total line count of input', () => {
    const missing = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM5'
    const issues = validateGcodeEndProgramInvariants(missing, 'cnc', 'mach3')
    const endless = issues.find(i => i.code === 'END_NO_PROGRAM_END')
    expect(endless).toBeDefined()
    expect(endless!.line).toBe(7)
  })

  it('M-code inside a ; comment does NOT count as a terminator', () => {
    // Commented-out M30 should still trigger END_NO_PROGRAM_END.
    const gcode = 'G21\nG90\nG17\nG54\nM3\nG0 X0\nM5\n; M30 is commented out'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_PROGRAM_END')).toBe(true)
  })

  it('M-code inside a (...) comment does NOT count as a terminator', () => {
    const gcode = 'G21\nG90\nG17\nG54\nM3\nG0 X0\nM5\n(M30 parenthetical)'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_PROGRAM_END')).toBe(true)
  })
})

describe('[ID-0108] END_NO_SPINDLE_OFF -- spindle left running', () => {
  it('M3 with no M5 before terminator surfaces an error', () => {
    const missing = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM30'
    const issues = validateGcodeEndProgramInvariants(missing, 'cnc', 'mach3')
    const off = issues.filter(i => i.code === 'END_NO_SPINDLE_OFF')
    expect(off).toHaveLength(1)
    expect(off[0]!.level).toBe('error')
    expect(off[0]!.message).toMatch(/tool-crash/)
    expect(off[0]!.line).toBe(5) // line of M3
  })

  it('M4 (CCW) with no M5 before terminator surfaces an error', () => {
    const missing = 'G21\nG90\nG17\nG54\nM4 S8000\nG0 X0\nM30'
    const issues = validateGcodeEndProgramInvariants(missing, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(true)
  })

  it('M5 BEFORE the last M3/M4 still surfaces an error (wrong order)', () => {
    // Early M5 + re-start M3 without a trailing M5 -- the sighting that
    // matters is the LAST M3/M4 and whether an M5 appears after it.
    const gcode =
      'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM5\nM3 S14000\nG0 X10\nM30'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(true)
  })

  it('multiple M3/M5 pairs with a final M5 before terminator pass', () => {
    const gcode =
      'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM5\nM3 S14000\nG0 X10\nM5\nM30'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(false)
  })

  it('M5 inside a comment does NOT count as spindle-off', () => {
    const gcode = 'G21\nG90\nG17\nG54\nM3\nG0 X0\n; M5 is commented out\nM30'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(true)
  })

  it('no spindle-off check when program has no M3/M4 at all', () => {
    // Pure positioning program with only M2 terminator -- END_NO_SPINDLE_OFF
    // must NOT fire because there is no spindle-on sighting.
    const gcode = 'G21\nG90\nG17\nG54\nG0 X0 Y0\nG1 Z-2 F200\nG0 Z10\nM2'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'grbl')
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(false)
  })
})

describe('[ID-0108] END_SPINDLE_OFF_AFTER_END -- M5 after terminator', () => {
  it('M5 emitted AFTER M30 surfaces an error', () => {
    // Intentional misorder: terminator first, M5 second.
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM30\nM5'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const stray = issues.filter(i => i.code === 'END_SPINDLE_OFF_AFTER_END')
    expect(stray).toHaveLength(1)
    expect(stray[0]!.level).toBe('error')
    expect(stray[0]!.line).toBe(8) // line of the stray M5
  })

  it('M5 emitted AFTER M2 on grbl also surfaces the error', () => {
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM2\nM5'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'grbl')
    expect(
      issues.some(i => i.code === 'END_SPINDLE_OFF_AFTER_END')
    ).toBe(true)
  })

  it('END_NO_SPINDLE_OFF and END_SPINDLE_OFF_AFTER_END are mutually exclusive', () => {
    // When M5 exists but AFTER the terminator, we should see
    // END_SPINDLE_OFF_AFTER_END (not END_NO_SPINDLE_OFF -- an M5 did
    // appear after the M3, just in the wrong place relative to M30).
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM30\nM5'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const codes = issues.map(i => i.code)
    expect(codes).toContain('END_SPINDLE_OFF_AFTER_END')
    expect(codes).not.toContain('END_NO_SPINDLE_OFF')
  })
})

describe('[ID-0108] END_DIALECT_MISMATCH -- terminator wrong for dialect', () => {
  it('mach3 dialect with M2 terminator surfaces a warning', () => {
    const bad = GOOD_MACH3.replace(/\nM30$/, '\nM2')
    const issues = validateGcodeEndProgramInvariants(bad, 'cnc', 'mach3')
    const mismatch = issues.filter(i => i.code === 'END_DIALECT_MISMATCH')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0]!.level).toBe('warning')
    expect(mismatch[0]!.message).toMatch(/prefers M30/)
    expect(mismatch[0]!.message).toMatch(/rewind/)
  })

  it('mach3_4axis dialect with M2 terminator surfaces a warning', () => {
    const bad = GOOD_MACH3.replace(/\nM30$/, '\nM2')
    const issues = validateGcodeEndProgramInvariants(bad, 'cnc', 'mach3_4axis')
    expect(issues.some(i => i.code === 'END_DIALECT_MISMATCH')).toBe(true)
  })

  it('grbl dialect with M30 terminator surfaces a warning', () => {
    const bad = GOOD_GRBL.replace(/\nM2$/, '\nM30')
    const issues = validateGcodeEndProgramInvariants(bad, 'cnc', 'grbl')
    const mismatch = issues.filter(i => i.code === 'END_DIALECT_MISMATCH')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0]!.level).toBe('warning')
    expect(mismatch[0]!.message).toMatch(/prefers M2/)
    expect(mismatch[0]!.message).toMatch(/delete file/)
  })

  it('grbl_4axis dialect with M30 terminator surfaces a warning', () => {
    const bad = GOOD_GRBL.replace(/\nM2$/, '\nM30')
    const issues = validateGcodeEndProgramInvariants(bad, 'cnc', 'grbl_4axis')
    expect(issues.some(i => i.code === 'END_DIALECT_MISMATCH')).toBe(true)
  })

  it('fanuc/siemens/heidenhain/generic_mm accept either terminator', () => {
    const dialects: MachineProfile['dialect'][] = [
      'fanuc',
      'siemens',
      'heidenhain',
      'generic_mm',
      'fanuc_4axis',
      'siemens_4axis',
      'heidenhain_4axis',
      'linuxcnc_4axis'
    ]
    for (const d of dialects) {
      const issuesM2 = validateGcodeEndProgramInvariants(
        GOOD_GRBL.replace(/M3 S12000/, 'M3 S10000'),
        'cnc',
        d
      )
      expect(issuesM2.some(i => i.code === 'END_DIALECT_MISMATCH')).toBe(false)

      const issuesM30 = validateGcodeEndProgramInvariants(
        GOOD_MACH3.replace(/M3 S12000/, 'M3 S10000'),
        'cnc',
        d
      )
      expect(issuesM30.some(i => i.code === 'END_DIALECT_MISMATCH')).toBe(false)
    }
  })

  it('mismatch warning anchors on the LAST terminator line (M30 at line 12)', () => {
    const bad = GOOD_MACH3.replace(/\nM30$/, '\nM2')
    const issues = validateGcodeEndProgramInvariants(bad, 'cnc', 'mach3')
    const mismatch = issues.find(i => i.code === 'END_DIALECT_MISMATCH')
    expect(mismatch).toBeDefined()
    expect(mismatch!.line).toBe(12)
  })
})

describe('[ID-0108] M-word normalization + boundary defense', () => {
  it('leading-zero M03 is recognized as M3 (spindle on)', () => {
    const missing = 'G21\nG90\nG17\nG54\nM03 S12000\nG0 X0\nM30'
    const issues = validateGcodeEndProgramInvariants(missing, 'cnc', 'mach3')
    // No M5 after M03 -> END_NO_SPINDLE_OFF should fire.
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(true)
  })

  it('leading-zero M030 is recognized as M30 (terminator)', () => {
    const gcode = 'G21\nG90\nG17\nG54\nM3\nG0 X0\nM5\nM030'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_PROGRAM_END')).toBe(false)
  })

  it('M02 (leading-zero M2) is recognized as M2', () => {
    const gcode = 'G21\nG90\nG17\nG54\nM3\nG0 X0\nM5\nM02'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'grbl')
    expect(issues.some(i => i.code === 'END_NO_PROGRAM_END')).toBe(false)
    expect(issues.some(i => i.code === 'END_DIALECT_MISMATCH')).toBe(false)
  })

  it('lowercase m3 / m5 / m30 are recognized the same as uppercase', () => {
    const lower = 'G21\nG90\nG17\nG54\nm3 s12000\ng0 x0\nm5\nm30'
    const issues = validateGcodeEndProgramInvariants(lower, 'cnc', 'mach3')
    expect(issues).toEqual([])
  })

  it('M-words embedded in other tokens do NOT match (M100, M20, M21)', () => {
    // M21 and M20 are SD-card file ops, M100 is a Marlin debug print.
    // None of them are in our tracked set.  The validator must not
    // mistake them for M2/M30.
    const gcode = 'G21\nG90\nG17\nG54\nM3\nM20\nM21\nM100\nG0 X0\nM5\nM30'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues).toEqual([])
  })
})

describe('[ID-0108] preferredProgramEndForDialect -- dialect lookup', () => {
  it('mach3 and mach3_4axis prefer M30', () => {
    expect(preferredProgramEndForDialect('mach3')!.preferred).toBe('M30')
    expect(preferredProgramEndForDialect('mach3_4axis')!.preferred).toBe('M30')
  })

  it('grbl and grbl_4axis prefer M2', () => {
    expect(preferredProgramEndForDialect('grbl')!.preferred).toBe('M2')
    expect(preferredProgramEndForDialect('grbl_4axis')!.preferred).toBe('M2')
  })

  it('fanuc / siemens / heidenhain / generic_mm have no preference', () => {
    expect(preferredProgramEndForDialect('fanuc')).toBeNull()
    expect(preferredProgramEndForDialect('siemens')).toBeNull()
    expect(preferredProgramEndForDialect('heidenhain')).toBeNull()
    expect(preferredProgramEndForDialect('generic_mm')).toBeNull()
    expect(preferredProgramEndForDialect('fanuc_4axis')).toBeNull()
    expect(preferredProgramEndForDialect('siemens_4axis')).toBeNull()
    expect(preferredProgramEndForDialect('heidenhain_4axis')).toBeNull()
    expect(preferredProgramEndForDialect('linuxcnc_4axis')).toBeNull()
  })

  it('mach3 rationale cites rewind side-effect', () => {
    expect(preferredProgramEndForDialect('mach3')!.rationale).toMatch(/rewind/)
  })

  it('grbl rationale cites Smoothieware file-delete hazard', () => {
    expect(preferredProgramEndForDialect('grbl')!.rationale).toMatch(/Smoothieware/)
    expect(preferredProgramEndForDialect('grbl')!.rationale).toMatch(/delete/)
  })

  // [ID-0160] Cycle 68 — explicit Smoothieware dialect carved out from the
  // 'grbl' misnomer. The new dialect MUST share the M2 preference and the
  // SD-card-delete rationale, otherwise the validator's operator-facing
  // warning would say "this dialect has no terminator preference" for
  // exactly the controllers that have the strongest preference.
  it('[ID-0160] smoothieware prefers M2 (same as grbl/grbl_4axis)', () => {
    expect(preferredProgramEndForDialect('smoothieware')!.preferred).toBe('M2')
  })

  it('[ID-0160] smoothieware rationale cites Smoothieware file-delete hazard explicitly', () => {
    const r = preferredProgramEndForDialect('smoothieware')!.rationale
    expect(r).toMatch(/Smoothieware/)
    expect(r).toMatch(/delete/)
    expect(r).toMatch(/M2/)
  })

  it('[ID-0160] smoothieware rationale mentions Carvera (operator context)', () => {
    // Operator-facing warning text should name a real machine the user
    // recognizes — Cycle 67 [ID-0155] already pinned the same shape for
    // the post-process contract test, so the validator-side rationale
    // must stay in lockstep.
    const r = preferredProgramEndForDialect('smoothieware')!.rationale
    expect(r).toMatch(/Carvera/)
  })
})

describe('[ID-0108] endProgramInvariantModeForMachine -- kind routing', () => {
  it('kind=fdm -> fdm mode', () => {
    expect(endProgramInvariantModeForMachine({ kind: 'fdm' })).toBe('fdm')
  })

  it('kind=cnc -> cnc mode', () => {
    expect(endProgramInvariantModeForMachine({ kind: 'cnc' })).toBe('cnc')
  })
})

describe('[ID-0108] edge-case + cross-cutting invariants -- DISCOVERED-2026-04-25', () => {
  // --- CRLF line endings -----------------------------------------------
  it('CRLF (\\r\\n) good mach3 program passes every invariant', () => {
    const crlf = GOOD_MACH3.replace(/\n/g, '\r\n')
    expect(validateGcodeEndProgramInvariants(crlf, 'cnc', 'mach3')).toEqual([])
  })

  it('CRLF program missing terminator still fires END_NO_PROGRAM_END', () => {
    const crlf = GOOD_MACH3.replace(/\nM30$/, '').replace(/\n/g, '\r\n')
    const issues = validateGcodeEndProgramInvariants(crlf, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_PROGRAM_END')).toBe(true)
  })

  it('CRLF leading-zero M030 still recognized as M30 terminator', () => {
    const gcode = 'G21\r\nG90\r\nG17\r\nG54\r\nM3\r\nG0 X0\r\nM5\r\nM030'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues).toEqual([])
  })

  // --- Multi-M-word single-line ----------------------------------------
  it('M5 + M30 on a single line both detected (multi-M-word match)', () => {
    // M5 and M30 share line 7; both must satisfy the validator.
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM5 M30'
    expect(validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')).toEqual([])
  })

  it('M3 + M30 on a single line (no M5) fires END_NO_SPINDLE_OFF', () => {
    // Same-line M3 + M30 -- no M5 -- fires the spindle-off error.
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000 M30\nG0 X0'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    expect(issues.some(i => i.code === 'END_NO_SPINDLE_OFF')).toBe(true)
  })

  // --- Documented issue-ordering invariant -----------------------------
  it('END_NO_PROGRAM_END precedes END_NO_SPINDLE_OFF in issue order', () => {
    // M3 + no M5 + no terminator -> both invariants 1 and 2 fire.
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0'
    const codes = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3').map(
      i => i.code
    )
    expect(codes).toEqual(['END_NO_PROGRAM_END', 'END_NO_SPINDLE_OFF'])
  })

  it('END_NO_SPINDLE_OFF precedes END_DIALECT_MISMATCH in issue order', () => {
    // M3 + no M5 + M2 on mach3 -> invariant 2 + invariant 4 fire in order.
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM2'
    const codes = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3').map(
      i => i.code
    )
    expect(codes).toEqual(['END_NO_SPINDLE_OFF', 'END_DIALECT_MISMATCH'])
  })

  it('END_SPINDLE_OFF_AFTER_END precedes END_DIALECT_MISMATCH on grbl', () => {
    // M3 + M30 + stray M5-after-M30 + grbl dialect -> invariants 3 + 4.
    const gcode = 'G21\nG90\nG17\nG54\nM3 S12000\nG0 X0\nM30\nM5'
    const codes = validateGcodeEndProgramInvariants(gcode, 'cnc', 'grbl').map(
      i => i.code
    )
    expect(codes).toEqual(['END_SPINDLE_OFF_AFTER_END', 'END_DIALECT_MISMATCH'])
  })

  // --- Sequential-terminator last-wins for dialect routing -------------
  it('mach3 with M2 then M30 (last) -> no dialect mismatch (last wins M30)', () => {
    const gcode = 'G21\nG90\nM2\nM30'
    expect(validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')).toEqual([])
  })

  it('mach3 with M30 then M2 (last) -> mismatch warning (last wins M2)', () => {
    const gcode = 'G21\nG90\nM30\nM2'
    const issues = validateGcodeEndProgramInvariants(gcode, 'cnc', 'mach3')
    const mismatch = issues.find(i => i.code === 'END_DIALECT_MISMATCH')
    expect(mismatch).toBeDefined()
  })
})
