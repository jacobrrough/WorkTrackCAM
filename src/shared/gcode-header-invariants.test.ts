import { describe, expect, it } from 'vitest'
import type { MachineProfile } from './machine-schema'
import {
  headerInvariantModeForMachine,
  validateGcodeHeaderInvariants
} from './gcode-header-invariants'

// Short-hand: a canonical good CNC header that satisfies all four invariants.
const GOOD_HEADER = ['G21', 'G90', 'G17', 'G54'].join('\n')
const GOOD_HEADER_WITH_MOTION = GOOD_HEADER + '\nG0 X0 Y0'

describe('validateGcodeHeaderInvariants -- happy paths [ID-0018]', () => {
  it('empty input returns zero issues', () => {
    expect(validateGcodeHeaderInvariants('', 'cnc')).toEqual([])
    expect(validateGcodeHeaderInvariants('   \n\n', 'cnc')).toEqual([])
  })

  it('fdm mode short-circuits regardless of content', () => {
    // This input would fail every CNC invariant -- but FDM skips them all.
    const sample = 'G1 X10 Y10 E0.5\nG1 X20 Y20 E1.0'
    expect(validateGcodeHeaderInvariants(sample, 'fdm')).toEqual([])
  })

  it('good header with all four declarations passes cnc mode', () => {
    expect(validateGcodeHeaderInvariants(GOOD_HEADER_WITH_MOTION, 'cnc')).toEqual([])
  })

  it('declarations combined on a single line satisfy every invariant', () => {
    // Hand-written headers sometimes combine declarations -- the validator
    // must not require one declaration per line.
    const combined = 'G21 G90 G17 G54\nG0 X0 Y0'
    expect(validateGcodeHeaderInvariants(combined, 'cnc')).toEqual([])
  })

  it('inch units (G20) satisfy the units invariant', () => {
    const gcode = 'G20\nG90\nG17\nG54\nG0 X0 Y0'
    expect(validateGcodeHeaderInvariants(gcode, 'cnc')).toEqual([])
  })

  it('G18 and G19 each satisfy the plane-select invariant', () => {
    const g18 = 'G21\nG90\nG18\nG54\nG0 X0 Y0'
    const g19 = 'G21\nG90\nG19\nG54\nG0 X0 Y0'
    expect(validateGcodeHeaderInvariants(g18, 'cnc')).toEqual([])
    expect(validateGcodeHeaderInvariants(g19, 'cnc')).toEqual([])
  })

  it('every WCS alternative (G54-G59, G54.1) satisfies the WCS invariant', () => {
    for (const wcs of ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G54.1']) {
      const gcode = `G21\nG90\nG17\n${wcs}\nG0 X0 Y0`
      expect(validateGcodeHeaderInvariants(gcode, 'cnc')).toEqual([])
    }
  })

  it('leading-zero variants (G01, G021) normalize to their canonical form', () => {
    // G021 should still count as G21 for the units check.
    const paddedUnits = 'G021\nG90\nG17\nG54\nG0 X0 Y0'
    expect(validateGcodeHeaderInvariants(paddedUnits, 'cnc')).toEqual([])
    // G01 is still a motion word for boundary purposes -- the declarations
    // must precede it, so add them before.  This asserts normalization
    // passes through the motion-word check too.
    const paddedMotion = 'G21\nG90\nG17\nG54\nG01 X0 Y0'
    expect(validateGcodeHeaderInvariants(paddedMotion, 'cnc')).toEqual([])
  })

  it('lowercase g-words are recognized', () => {
    // Smoothieware and some LinuxCNC pipelines permit lowercase.
    const lower = 'g21\ng90\ng17\ng54\ng0 x0 y0'
    expect(validateGcodeHeaderInvariants(lower, 'cnc')).toEqual([])
  })

  it('declarations inside semicolon comments do NOT count', () => {
    // A comment like "; G21 see docs/MACHINES.md" is advisory -- must not
    // substitute for a real declaration.
    const hostile = '; G21 G90 G17 G54 see docs/\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(hostile, 'cnc')
    expect(issues.map(i => i.code)).toEqual([
      'HEADER_NO_UNITS',
      'HEADER_NO_ABSOLUTE_MODE',
      'HEADER_NO_PLANE_SELECT',
      'HEADER_NO_WCS'
    ])
  })

  it('declarations inside parenthetical comments do NOT count', () => {
    const hostile = '(G21 G90 G17 G54 advisory header)\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(hostile, 'cnc')
    expect(issues.map(i => i.code)).toEqual([
      'HEADER_NO_UNITS',
      'HEADER_NO_ABSOLUTE_MODE',
      'HEADER_NO_PLANE_SELECT',
      'HEADER_NO_WCS'
    ])
  })
})

describe('validateGcodeHeaderInvariants -- missing-declaration failure cases [ID-0018]', () => {
  it('missing units emits HEADER_NO_UNITS error', () => {
    const gcode = 'G90\nG17\nG54\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!).toMatchObject({
      level: 'error',
      code: 'HEADER_NO_UNITS',
      firstMotionLine: 4
    })
    expect(issues[0]!.message).toMatch(/G20 inches or G21 millimeters/)
  })

  it('missing absolute mode emits HEADER_NO_ABSOLUTE_MODE error', () => {
    const gcode = 'G21\nG17\nG54\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!).toMatchObject({
      level: 'error',
      code: 'HEADER_NO_ABSOLUTE_MODE',
      firstMotionLine: 4
    })
  })

  it('missing plane select emits HEADER_NO_PLANE_SELECT error', () => {
    const gcode = 'G21\nG90\nG54\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!).toMatchObject({
      level: 'error',
      code: 'HEADER_NO_PLANE_SELECT',
      firstMotionLine: 4
    })
  })

  it('missing WCS emits HEADER_NO_WCS warning (not error)', () => {
    const gcode = 'G21\nG90\nG17\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!).toMatchObject({
      level: 'warning',
      code: 'HEADER_NO_WCS',
      firstMotionLine: 4
    })
  })

  it('no declarations at all emits all four issues in canonical order', () => {
    // Three errors + one warning, ordered units -> absolute -> plane -> WCS.
    const gcode = 'G0 X0 Y0\nG1 X10 Y10 F500'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(4)
    expect(issues.map(i => i.code)).toEqual([
      'HEADER_NO_UNITS',
      'HEADER_NO_ABSOLUTE_MODE',
      'HEADER_NO_PLANE_SELECT',
      'HEADER_NO_WCS'
    ])
    expect(issues.map(i => i.level)).toEqual(['error', 'error', 'error', 'warning'])
    // firstMotionLine points at the FIRST motion word (line 1, not the second).
    expect(issues.every(i => i.firstMotionLine === 1)).toBe(true)
  })

  it('declarations AFTER the first motion word do NOT count', () => {
    // A post that tries to set units after it's already started moving is
    // a bug: the pre-motion block already executed with whatever default
    // the controller had.
    const gcode = 'G0 X0 Y0\nG21\nG90\nG17\nG54'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues.map(i => i.code)).toEqual([
      'HEADER_NO_UNITS',
      'HEADER_NO_ABSOLUTE_MODE',
      'HEADER_NO_PLANE_SELECT',
      'HEADER_NO_WCS'
    ])
    expect(issues.every(i => i.firstMotionLine === 1)).toBe(true)
  })

  it('header-only file (no motion word) still runs every check', () => {
    // Pure-header fragment -- validator still classifies it; firstMotionLine
    // falls back to the total line count.
    const gcode = 'G21\nG90\nG17\n' // trailing newline => 4 lines
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!).toMatchObject({
      level: 'warning',
      code: 'HEADER_NO_WCS',
      firstMotionLine: 4
    })
  })

  it('G53 (one-shot machine-coord override) does NOT satisfy the WCS check', () => {
    // G53 is a non-modal machine-coord rapid; it is NOT a WCS declaration.
    // Treating it as WCS is a known operator trap.
    const gcode = 'G21\nG90\nG17\nG53\nG0 X0 Y0'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.code).toBe('HEADER_NO_WCS')
  })
})

describe('validateGcodeHeaderInvariants -- motion-word boundary edge cases [ID-0018]', () => {
  it('G10 (data-set) does NOT count as a motion word', () => {
    // G10 L20 P1 etc. -- data input, not motion.  If we mistake G10 for G1
    // the validator will stop scanning the header too early.
    const gcode = 'G21\nG90\nG17\nG10 L20 P1 X0 Y0 Z0\nG54\nG0 X0 Y0'
    expect(validateGcodeHeaderInvariants(gcode, 'cnc')).toEqual([])
  })

  it('G17 (plane) does NOT count as a motion word', () => {
    // G17 starts with G1 but is not G1.  Prefix-safety required.
    const gcode = 'G21\nG90\nG17\nG54\nG1 X10 Y10 F500'
    expect(validateGcodeHeaderInvariants(gcode, 'cnc')).toEqual([])
  })

  it('G28 (home) does NOT count as a motion word for this validator', () => {
    // G28 is motion-like on most controllers but it runs a stored move
    // that is outside the post-processor's control.  Consistent with the
    // SKILL.md invariant list (which names G0/G1/G2/G3 explicitly).
    const gcode = 'G28 Z0\nG21\nG90\nG17\nG54\nG0 X0 Y0'
    expect(validateGcodeHeaderInvariants(gcode, 'cnc')).toEqual([])
  })

  it('G2 / G3 arcs count as motion words', () => {
    // An arc before any plane-select is a known trap on Fanuc.
    const gcode = 'G21\nG90\nG2 X10 Y10 I5 J5 F500'
    const issues = validateGcodeHeaderInvariants(gcode, 'cnc')
    // Missing plane-select AND WCS -- both flagged.
    expect(issues.map(i => i.code)).toEqual(['HEADER_NO_PLANE_SELECT', 'HEADER_NO_WCS'])
    expect(issues.every(i => i.firstMotionLine === 3)).toBe(true)
  })

  it('firstMotionLine correctly reports the 1-based line number of the motion word', () => {
    const gcode = ['; comment', 'G21', 'G90', 'G17', 'G54', 'G0 X0 Y0'].join('\n')
    // Pass case -- no issues returned.  Add a failing input to verify the
    // line-number convention with a known bad shape:
    const missing = ['; comment', 'G21', 'G90', 'G17', 'G0 X0 Y0'].join('\n')
    const issues = validateGcodeHeaderInvariants(missing, 'cnc')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.firstMotionLine).toBe(5)
    expect(validateGcodeHeaderInvariants(gcode, 'cnc')).toEqual([])
  })
})

describe('headerInvariantModeForMachine [ID-0018]', () => {
  it('returns "fdm" for MachineProfile with kind=fdm', () => {
    const fdm: Pick<MachineProfile, 'kind'> = { kind: 'fdm' }
    expect(headerInvariantModeForMachine(fdm)).toBe('fdm')
  })

  it('returns "cnc" for MachineProfile with kind=cnc', () => {
    const cnc: Pick<MachineProfile, 'kind'> = { kind: 'cnc' }
    expect(headerInvariantModeForMachine(cnc)).toBe('cnc')
  })
})
