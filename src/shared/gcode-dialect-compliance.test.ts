import { describe, it, expect } from 'vitest'
import { validateDialectCompliance, type ComplianceIssue } from './gcode-dialect-compliance'

// Helper to find issues by code
function findByCode(issues: ComplianceIssue[], code: string): ComplianceIssue[] {
  return issues.filter(i => i.code === code)
}

// ── GRBL dialect ───────────────────────────────────────────────────────────

describe('GRBL compliance', () => {
  const VALID_GRBL = [
    '; Makera Carvera — 3-Axis G-code',
    'G21',
    'G90',
    'G17',
    'M3 S12000',
    'G0 Z10.000',
    'G1 X50.000 Y30.000 F800',
    'G1 Z-2.000 F200',
    'G1 X100.000 Y60.000 F800',
    'M5',
    'G0 Z50.000',
    'G0 X0 Y0',
    'M30'
  ].join('\n')

  it('passes valid GRBL G-code with zero issues', () => {
    expect(validateDialectCompliance(VALID_GRBL, 'grbl')).toEqual([])
  })

  it('passes valid GRBL 4-axis G-code', () => {
    expect(validateDialectCompliance(VALID_GRBL, 'grbl_4axis')).toEqual([])
  })

  it('detects G28 as error', () => {
    const gcode = 'G21\nG90\nG91 G28 Z0\nG90\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    const g28 = findByCode(issues, 'GRBL_NO_G28')
    expect(g28.length).toBe(1)
    expect(g28[0].level).toBe('error')
    expect(g28[0].line).toBe(3)
  })

  it('detects G30 as error', () => {
    const gcode = 'G21\nG30 Z0\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    expect(findByCode(issues, 'GRBL_NO_G28').length).toBe(1)
    expect(findByCode(issues, 'GRBL_NO_G28')[0].message).toContain('G30')
  })

  it('detects G43 as warning', () => {
    const gcode = 'G21\nG43 H1\nG1 X10 F100\nG49\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    const tlc = findByCode(issues, 'GRBL_NO_TLC')
    expect(tlc.length).toBe(2) // G43 and G49
    expect(tlc[0].level).toBe('warning')
  })

  it('warns on parenthetical comments in non-comment lines', () => {
    const gcode = 'G21\nG1 X10 (move to start) F100\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    expect(findByCode(issues, 'GRBL_PAREN_COMMENT').length).toBe(1)
  })

  it('does not warn on pure parenthetical comment lines', () => {
    const gcode = '(This is a comment)\nG21\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    // Pure comment lines are skipped by isCommentLine, but the line has G-code content check
    // Actually, the parenthetical comment check runs on all non-comment lines
    // A pure "(comment)" line IS a comment line, so it's skipped
    expect(findByCode(issues, 'GRBL_PAREN_COMMENT').length).toBe(0)
  })

  it('warns on lines exceeding 256 characters', () => {
    const longLine = 'G1 X' + '1'.repeat(260) + ' F100'
    const gcode = `G21\n${longLine}\nM30`
    const issues = validateDialectCompliance(gcode, 'grbl')
    expect(findByCode(issues, 'GRBL_LINE_LENGTH').length).toBe(1)
  })

  it('returns empty for empty input', () => {
    expect(validateDialectCompliance('', 'grbl')).toEqual([])
    expect(validateDialectCompliance('   ', 'grbl')).toEqual([])
  })

  it('handles G28 inside a comment without flagging', () => {
    // G28 in a comment should not trigger — stripComments removes it
    const gcode = 'G21\n; G28 reference return not used\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    expect(findByCode(issues, 'GRBL_NO_G28').length).toBe(0)
  })
})

// ── Smoothieware dialect ───────────────────────────────────────────────────
// [ID-0160] Cycle 68 — Smoothieware-family controllers (Makera Carvera 3-axis)
// share the GRBL-flavored heritage but support tool-length compensation
// (G43/G49) and richer feed/coolant control. The validator MUST NOT emit
// GRBL_NO_TLC false-positives on legitimate Smoothieware ATC G-code.

describe('Smoothieware compliance', () => {
  // Representative Carvera 3-axis ATC block with TLC: this is the canonical
  // shape the Cycle 67 [ID-0155] paired pin captured as a false-positive
  // under dialect="grbl". Under dialect="smoothieware", the validator must
  // emit ZERO warnings for this exact shape.
  const VALID_SMOOTHIEWARE_ATC = [
    '; Makera Carvera — 3-Axis G-code',
    'G21',
    'G90',
    'G17',
    'M6 T1',
    'G43 H1',
    'M3 S12000',
    'G0 Z140',
    'G1 X50 Y30 F800',
    'G1 Z-2 F200',
    'M5',
    'G49',
    'G0 Z140',
    'G0 X0 Y0',
    'M9',
    'M2'
  ].join('\n')

  it('passes a canonical Carvera 3-axis ATC block (G43/G49) with ZERO issues', () => {
    // [ID-0160] flip-point — under dialect="grbl" this same input fired two
    // GRBL_NO_TLC warnings (one for G43, one for G49). Under "smoothieware"
    // the warnings disappear because Smoothieware DOES support TLC.
    expect(validateDialectCompliance(VALID_SMOOTHIEWARE_ATC, 'smoothieware')).toEqual([])
  })

  it('does NOT emit GRBL_NO_TLC for G43/G49 (the [ID-0160] regression guard)', () => {
    const gcode = 'G21\nG43 H1\nG1 X10 F100\nG49\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    expect(findByCode(issues, 'GRBL_NO_TLC').length).toBe(0)
  })

  it('emits a SOFT G28 warning (not an error) — Smoothieware can be configured to home', () => {
    // Smoothieware genuinely supports G28 when home_position is wired up,
    // so the conservative warning level (not error) lets the operator know
    // to verify the firmware config rather than blocking the export.
    const gcode = 'G21\nG90\nG91 G28 Z0\nG90\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    const g28 = findByCode(issues, 'SMOOTHIEWARE_G28_CHECK')
    expect(g28.length).toBe(1)
    expect(g28[0].level).toBe('warning')
    expect(g28[0].line).toBe(3)
    expect(g28[0].message).toContain('home_position')
  })

  it('emits SMOOTHIEWARE_G28_CHECK for G30 too', () => {
    const gcode = 'G21\nG30 Z0\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    const checks = findByCode(issues, 'SMOOTHIEWARE_G28_CHECK')
    expect(checks.length).toBe(1)
    expect(checks[0].message).toContain('G30')
  })

  it('warns on parenthetical comments in non-comment lines (consistency with GRBL)', () => {
    const gcode = 'G21\nG1 X10 (move to start) F100\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    expect(findByCode(issues, 'SMOOTHIEWARE_PAREN_COMMENT').length).toBe(1)
  })

  it('does not warn on pure parenthetical comment lines', () => {
    const gcode = '(This is a comment)\nG21\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    expect(findByCode(issues, 'SMOOTHIEWARE_PAREN_COMMENT').length).toBe(0)
  })

  it('warns on lines exceeding 256 characters', () => {
    const longLine = 'G1 X' + '1'.repeat(260) + ' F100'
    const gcode = `G21\n${longLine}\nM2`
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    expect(findByCode(issues, 'SMOOTHIEWARE_LINE_LENGTH').length).toBe(1)
  })

  it('returns empty for empty input', () => {
    expect(validateDialectCompliance('', 'smoothieware')).toEqual([])
    expect(validateDialectCompliance('   ', 'smoothieware')).toEqual([])
  })

  it('handles G28 inside a comment without flagging', () => {
    const gcode = 'G21\n; G28 reference return not used\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    expect(findByCode(issues, 'SMOOTHIEWARE_G28_CHECK').length).toBe(0)
  })

  it('does not share GRBL warning codes — codes are SMOOTHIEWARE_*-prefixed', () => {
    // Defense-in-depth: the new family MUST NOT emit codes prefixed with
    // GRBL_*. Operator-facing warnings should surface the real dialect name.
    const gcode = 'G21\nG43 H1\nG1 X10 (inline) F100\nG49\nG30 Z0\nM2'
    const issues = validateDialectCompliance(gcode, 'smoothieware')
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue.code.startsWith('GRBL_')).toBe(false)
    }
  })
})

// ── Fanuc dialect ──────────────────────────────────────────────────────────

describe('Fanuc compliance', () => {
  const VALID_FANUC = [
    '(MACHINE NAME — ID)',
    '(4-AXIS A-ROTARY G-CODE — FANUC DIALECT)',
    'G21',
    'G90',
    'G17',
    'G40 G49 G80',
    'G0 Z100.000',
    'M3 S10000',
    'G1 X50.000 Y30.000 F800',
    'G1 Z-2.000 F200',
    'M5',
    'G91 G28 Z0',
    'G90',
    'M30'
  ].join('\n')

  it('passes valid Fanuc G-code', () => {
    const issues = validateDialectCompliance(VALID_FANUC, 'fanuc')
    // G40 G49 G80 are from different modal groups, should not trigger
    expect(findByCode(issues, 'FANUC_MODAL_GROUP').length).toBe(0)
  })

  it('passes valid Fanuc 4-axis G-code', () => {
    const issues = validateDialectCompliance(VALID_FANUC, 'fanuc_4axis')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP').length).toBe(0)
  })

  it('detects modal group 1 conflict (G0 + G1 on same line)', () => {
    const gcode = 'G21\nG0 G1 X10 F100\nM30'
    const issues = validateDialectCompliance(gcode, 'fanuc')
    const conflict = findByCode(issues, 'FANUC_MODAL_GROUP')
    expect(conflict.length).toBe(1)
    expect(conflict[0].line).toBe(2)
    expect(conflict[0].message).toContain('G0')
    expect(conflict[0].message).toContain('G1')
  })

  it('detects modal group 3 conflict (G90 + G91 on same line)', () => {
    // Note: G91 G28 Z0 is a valid Fanuc idiom (G91 is group 3, G28 is group 0),
    // but G90 G91 together would be a conflict
    const gcode = 'G21\nG90 G91 X10\nM30'
    const issues = validateDialectCompliance(gcode, 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP').length).toBe(1)
  })

  it('allows G40 G49 G80 on same line (different modal groups)', () => {
    const gcode = 'G21\nG40 G49 G80\nM30'
    const issues = validateDialectCompliance(gcode, 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP').length).toBe(0)
  })

  it('allows G91 G28 on same line (different modal groups)', () => {
    // G91 = modal group 3, G28 = modal group 0 — no conflict
    const gcode = 'G21\nG91 G28 Z0\nM30'
    const issues = validateDialectCompliance(gcode, 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP').length).toBe(0)
  })
})

// ── Mach3 dialect ──────────────────────────────────────────────────────────

describe('Mach3 compliance', () => {
  it('passes valid Mach3 G-code with % markers', () => {
    const gcode = '%\n; Program\nG21\nG90\nG1 X10 F100\nM30\n%'
    const issues = validateDialectCompliance(gcode, 'mach3')
    expect(findByCode(issues, 'MACH3_NO_TAPE_START').length).toBe(0)
    expect(findByCode(issues, 'MACH3_NO_TAPE_END').length).toBe(0)
  })

  it('passes valid Mach3 4-axis G-code', () => {
    const gcode = '%\nG21\nM30\n%'
    const issues = validateDialectCompliance(gcode, 'mach3_4axis')
    expect(issues.length).toBe(0)
  })

  it('warns on missing % start marker', () => {
    const gcode = '; Program\nG21\nG1 X10 F100\nM30\n%'
    const issues = validateDialectCompliance(gcode, 'mach3')
    expect(findByCode(issues, 'MACH3_NO_TAPE_START').length).toBe(1)
  })

  it('warns on missing % end marker', () => {
    const gcode = '%\nG21\nG1 X10 F100\nM30'
    const issues = validateDialectCompliance(gcode, 'mach3')
    expect(findByCode(issues, 'MACH3_NO_TAPE_END').length).toBe(1)
  })

  it('warns on missing both % markers', () => {
    const gcode = 'G21\nG1 X10 F100\nM30'
    const issues = validateDialectCompliance(gcode, 'mach3')
    expect(findByCode(issues, 'MACH3_NO_TAPE_START').length).toBe(1)
    expect(findByCode(issues, 'MACH3_NO_TAPE_END').length).toBe(1)
  })
})

// ── LinuxCNC dialect ───────────────────────────────────────────────────────

describe('LinuxCNC compliance', () => {
  it('passes valid LinuxCNC G-code with % markers and M2', () => {
    const gcode = '%\nG21\nG90\nG1 X10 F100\nM2\n%'
    const issues = validateDialectCompliance(gcode, 'linuxcnc_4axis')
    expect(issues.length).toBe(0)
  })

  it('warns on missing % start marker', () => {
    const gcode = 'G21\nG1 X10 F100\nM2\n%'
    const issues = validateDialectCompliance(gcode, 'linuxcnc_4axis')
    expect(findByCode(issues, 'LINUXCNC_NO_TAPE_START').length).toBe(1)
  })

  it('warns on missing % end marker', () => {
    const gcode = '%\nG21\nG1 X10 F100\nM2'
    const issues = validateDialectCompliance(gcode, 'linuxcnc_4axis')
    expect(findByCode(issues, 'LINUXCNC_NO_TAPE_END').length).toBe(1)
  })

  it('warns on M30 (prefer M2)', () => {
    const gcode = '%\nG21\nG1 X10 F100\nM30\n%'
    const issues = validateDialectCompliance(gcode, 'linuxcnc_4axis')
    const m30 = findByCode(issues, 'LINUXCNC_PREFER_M2')
    expect(m30.length).toBe(1)
    expect(m30[0].level).toBe('warning')
  })

  it('does not warn on M30 in a comment', () => {
    const gcode = '%\nG21\n; M30 is not used here\nM2\n%'
    const issues = validateDialectCompliance(gcode, 'linuxcnc_4axis')
    expect(findByCode(issues, 'LINUXCNC_PREFER_M2').length).toBe(0)
  })
})

// ── Siemens dialect ────────────────────────────────────────────────────────

describe('Siemens compliance', () => {
  const VALID_SIEMENS = [
    '; Siemens CNC',
    'G21',
    'G90',
    'G17',
    'G40',
    'G49',
    'G80',
    'T1 D1',
    'M6',
    'G0 Z100.000',
    'M3 S10000',
    'G1 X50.000 Y30.000 F800',
    'M5',
    'G0 Z100.000',
    'G0 A0',
    'G0 X0 Y0',
    'M30'
  ].join('\n')

  it('passes valid Siemens G-code', () => {
    const issues = validateDialectCompliance(VALID_SIEMENS, 'siemens')
    expect(issues.length).toBe(0)
  })

  it('passes valid Siemens 4-axis G-code', () => {
    const issues = validateDialectCompliance(VALID_SIEMENS, 'siemens_4axis')
    expect(issues.length).toBe(0)
  })

  it('detects G28 as error', () => {
    const gcode = 'G21\nG91 G28 Z0\nM30'
    const issues = validateDialectCompliance(gcode, 'siemens')
    const g28 = findByCode(issues, 'SIEMENS_NO_G28')
    expect(g28.length).toBe(1)
    expect(g28[0].level).toBe('error')
  })

  it('detects G30 as error', () => {
    const gcode = 'G21\nG30 Z0\nM30'
    const issues = validateDialectCompliance(gcode, 'siemens_4axis')
    expect(findByCode(issues, 'SIEMENS_NO_G28').length).toBe(1)
  })

  it('does not flag G28 in comments', () => {
    const gcode = 'G21\n; G28 not used on Siemens\nM30'
    const issues = validateDialectCompliance(gcode, 'siemens')
    expect(findByCode(issues, 'SIEMENS_NO_G28').length).toBe(0)
  })
})

// ── Heidenhain dialect ─────────────────────────────────────────────────────

describe('Heidenhain compliance', () => {
  it('passes valid Heidenhain DIN/ISO G-code', () => {
    const gcode = '; Heidenhain TNC\nG21\nG90\nG17\nG1 X10 F100\nM30'
    const issues = validateDialectCompliance(gcode, 'heidenhain')
    expect(issues.length).toBe(0)
  })

  it('passes valid Heidenhain 4-axis G-code', () => {
    const gcode = '; Heidenhain TNC\nG21\nG90\nG1 X10 A45 F100\nM30'
    const issues = validateDialectCompliance(gcode, 'heidenhain_4axis')
    expect(issues.length).toBe(0)
  })
})

// ── Generic dialect ────────────────────────────────────────────────────────

describe('generic_mm compliance', () => {
  it('returns no issues for generic dialect', () => {
    const gcode = 'G21\nG90\nG1 X10 F100\nM30'
    const issues = validateDialectCompliance(gcode, 'generic_mm')
    expect(issues.length).toBe(0)
  })

  it('returns no issues for empty input', () => {
    expect(validateDialectCompliance('', 'generic_mm')).toEqual([])
  })
})

// ── Cross-dialect scenarios ────────────────────────────────────────────────

describe('cross-dialect validation', () => {
  it('Fanuc G-code flagged when validated as GRBL', () => {
    // Fanuc template output with G28 and parenthetical comments
    const fanucGcode = [
      '(MACHINE NAME)',
      'G21',
      'G90',
      'G40 G49 G80',
      'M3 S10000',
      'G1 X50 F800',
      'M5',
      'G91 G28 Z0',
      'M30'
    ].join('\n')
    const issues = validateDialectCompliance(fanucGcode, 'grbl')
    // Should catch: G28 (error), G49 (warning), parenthetical comment on G40 line (no, that's not a paren comment)
    expect(findByCode(issues, 'GRBL_NO_G28').length).toBe(1)
    expect(findByCode(issues, 'GRBL_NO_TLC').length).toBe(1) // G49
  })

  it('GRBL G-code validated as Siemens catches nothing extra', () => {
    const grblGcode = '; GRBL\nG21\nG90\nG1 X10 F100\nM5\nG0 Z50\nM30'
    const issues = validateDialectCompliance(grblGcode, 'siemens')
    expect(issues.length).toBe(0)
  })

  it('Mach3 G-code without % markers validated as LinuxCNC warns on both', () => {
    const gcode = 'G21\nG1 X10 F100\nM2'
    const issues = validateDialectCompliance(gcode, 'linuxcnc_4axis')
    expect(findByCode(issues, 'LINUXCNC_NO_TAPE_START').length).toBe(1)
    expect(findByCode(issues, 'LINUXCNC_NO_TAPE_END').length).toBe(1)
  })
})

// ── Issue structure ────────────────────────────────────────────────────────

describe('issue structure', () => {
  it('issues have all required fields', () => {
    const gcode = 'G21\nG91 G28 Z0\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue).toHaveProperty('level')
      expect(issue).toHaveProperty('line')
      expect(issue).toHaveProperty('code')
      expect(issue).toHaveProperty('message')
      expect(issue).toHaveProperty('content')
      expect(typeof issue.line).toBe('number')
      expect(issue.line).toBeGreaterThan(0)
      expect(['error', 'warning']).toContain(issue.level)
    }
  })
})
