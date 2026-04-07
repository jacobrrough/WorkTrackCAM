import { describe, expect, it } from 'vitest'
import {
  check4AxisAngularVelocity,
  check4AxisTravelLimits,
  formatAngularVelocityHint,
  formatTravelLimitHint
} from './cam-4axis-feed-check'

describe('check4AxisAngularVelocity', () => {
  it('returns no warnings for pure XYZ moves (no A word)', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z5 F1000',
      'G1 X20 Y10 Z5 F1000'
    ]
    expect(check4AxisAngularVelocity(lines)).toEqual([])
  })

  it('returns no warnings for small A change at low feed rate', () => {
    // Move 10mm in X, 5 deg in A, at F=200mm/min
    // time = 10/200 = 0.05 min
    // angVel = 5/0.05 = 100 deg/min = 0.28 RPM (well under 20 RPM)
    const lines = [
      'G1 X10 A5 F200'
    ]
    expect(check4AxisAngularVelocity(lines)).toEqual([])
  })

  it('flags large A change with high feed rate', () => {
    // Move 1mm in X, 90 deg in A, at F=5000mm/min
    // time = 1/5000 = 0.0002 min
    // angVel = 90/0.0002 = 450000 deg/min = 1250 RPM -- way over 20 RPM
    const lines = [
      'G1 X1 A90 F5000'
    ]
    const w = check4AxisAngularVelocity(lines)
    expect(w).toHaveLength(1)
    expect(w[0]!.lineIndex).toBe(0)
    expect(w[0]!.angularVelocityDegPerMin).toBeGreaterThan(7200)
    expect(w[0]!.maxAllowed).toBe(7200) // default 20 RPM * 360
    expect(w[0]!.line).toBe('G1 X1 A90 F5000')
  })

  it('correctly calculates angular velocity for pure A rotation (no XYZ change)', () => {
    // Pure rotation: F applies to surface speed on stock circumference.
    // stockDia=50, F=1000
    // angVel = F * 360 / (PI * stockDia) = 1000 * 360 / (PI * 50) = 2291.8 deg/min = 6.37 RPM
    // Default max = 7200 deg/min (20 RPM), so no warning expected
    const lines = [
      'G1 A90 F1000'
    ]
    expect(check4AxisAngularVelocity(lines, { stockDiameterMm: 50 })).toEqual([])

    // Now with higher feed: F=15000
    // angVel = 15000 * 360 / (PI * 50) = 34377.5 deg/min = 95.5 RPM -> warning
    const lines2 = [
      'G1 A90 F15000'
    ]
    const w = check4AxisAngularVelocity(lines2, { stockDiameterMm: 50 })
    expect(w).toHaveLength(1)
    expect(w[0]!.angularVelocityDegPerMin).toBeCloseTo(15000 * 360 / (Math.PI * 50), 0)
  })

  it('detects multiple warnings across a program', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 A0 F500',        // safe: no A change
      'G1 X11 A180 F5000',     // BAD: 1mm XYZ, 180 deg A, very high angular velocity
      'G1 X12 A181 F500',      // safe: 1 deg, 1mm, low feed
      'G1 X13 A360 F5000',     // BAD: 1mm XYZ, 179 deg A
      'G1 X100 A361 F1000'     // safe: 87mm XYZ, 1 deg A
    ]
    const w = check4AxisAngularVelocity(lines)
    expect(w).toHaveLength(2)
    expect(w[0]!.lineIndex).toBe(2) // "G1 X11 A180 F5000"
    expect(w[1]!.lineIndex).toBe(4) // "G1 X13 A360 F5000"
  })

  it('ignores G0 rapids', () => {
    // G0 rapid with large A change should not trigger warning
    const lines = [
      'G0 X0 Y0 Z5 A0',
      'G0 X10 A180',  // rapid, not checked
      'G1 X20 A181 F500' // small A change, should be fine
    ]
    expect(check4AxisAngularVelocity(lines)).toEqual([])
  })

  it('uses default maxRotaryRpm of 20 RPM (7200 deg/min)', () => {
    // Exactly at the limit: angVel = 7200 deg/min
    // Combined move: deltaA * F / linearDist = 7200
    // deltaA=36, F=1000, linearDist = 36*1000/7200 = 5mm
    const lines = [
      'G1 X5 A36 F1000'
    ]
    const w = check4AxisAngularVelocity(lines)
    // angVel = 36 * 1000 / 5 = 7200 -- exactly at limit, no warning
    expect(w).toEqual([])

    // Just over: deltaA=37, same F and distance
    // angVel = 37 * 1000 / 5 = 7400 > 7200
    const lines2 = [
      'G1 X5 A37 F1000'
    ]
    const w2 = check4AxisAngularVelocity(lines2)
    expect(w2).toHaveLength(1)
    expect(w2[0]!.maxAllowed).toBe(7200)
  })

  it('respects custom maxRotaryRpm', () => {
    // With 10 RPM max = 3600 deg/min
    // Move: deltaA=36, F=1000, linearDist=5 => angVel=7200 -- over 3600
    const lines = [
      'G1 X5 A36 F1000'
    ]
    const w = check4AxisAngularVelocity(lines, { maxRotaryRpm: 10 })
    expect(w).toHaveLength(1)
    expect(w[0]!.maxAllowed).toBe(3600)

    // With 30 RPM max = 10800 deg/min -- should be fine
    const w2 = check4AxisAngularVelocity(lines, { maxRotaryRpm: 30 })
    expect(w2).toEqual([])
  })

  it('uses last modal F when line has no F word', () => {
    const lines = [
      'G1 X10 F5000',       // sets F=5000
      'G1 X11 A180'         // no F, uses modal F=5000; 1mm, 180deg => high angVel
    ]
    const w = check4AxisAngularVelocity(lines)
    expect(w).toHaveLength(1)
    expect(w[0]!.lineIndex).toBe(1)
  })

  it('tracks position through G0 rapids for correct delta calculation', () => {
    const lines = [
      'G0 X50 A90',          // rapid to X50 A90
      'G1 X51 A91 F500'      // 1mm, 1deg -- safe
    ]
    const w = check4AxisAngularVelocity(lines)
    expect(w).toEqual([])
  })

  it('handles G01 long form code', () => {
    const lines = [
      'G01 X1 A90 F5000'
    ]
    const w = check4AxisAngularVelocity(lines)
    expect(w).toHaveLength(1)
  })

  it('skips comment lines', () => {
    const lines = [
      '; This is a comment',
      'G1 X10 A5 F200'
    ]
    expect(check4AxisAngularVelocity(lines)).toEqual([])
  })

  it('handles inline parenthetical comments', () => {
    // A value inside a comment should not be read
    const lines = [
      'G1 X10 (move A90 ref) A5 F200'
    ]
    const w = check4AxisAngularVelocity(lines)
    // A=5 not A=90, so should be safe
    expect(w).toEqual([])
  })

  it('returns empty for no lines', () => {
    expect(check4AxisAngularVelocity([])).toEqual([])
  })

  it('returns empty when F is zero (no motion)', () => {
    const lines = [
      'G1 X10 A180 F0'
    ]
    // F=0 means no motion, skip
    expect(check4AxisAngularVelocity(lines)).toEqual([])
  })
})

describe('formatAngularVelocityHint', () => {
  it('returns empty string for no warnings', () => {
    expect(formatAngularVelocityHint([])).toBe('')
  })

  it('formats a single warning', () => {
    const warnings = [
      { lineIndex: 5, angularVelocityDegPerMin: 14400, maxAllowed: 7200, line: 'G1 X1 A90 F5000' }
    ]
    const h = formatAngularVelocityHint(warnings)
    expect(h).toContain('A-axis angular velocity warning')
    expect(h).toContain('1 move(s)')
    expect(h).toContain('40.0 RPM peak')
    expect(h).toContain('20 RPM max')
    expect(h).toContain('Reduce feed rate')
  })

  it('formats multiple warnings with peak velocity', () => {
    const warnings = [
      { lineIndex: 2, angularVelocityDegPerMin: 10000, maxAllowed: 7200, line: 'G1 X11 A180 F5000' },
      { lineIndex: 4, angularVelocityDegPerMin: 20000, maxAllowed: 7200, line: 'G1 X13 A360 F5000' }
    ]
    const h = formatAngularVelocityHint(warnings)
    expect(h).toContain('2 move(s)')
    // Peak should be 20000/360 = 55.6 RPM
    expect(h).toContain('55.6 RPM peak')
  })
})

// ─── A-axis travel limit validation ──────────────────────────────────────────

describe('check4AxisTravelLimits', () => {
  it('returns no warnings when all A values within range', () => {
    const lines = [
      'G0 X10 A0',
      'G1 X20 A90 F1000',
      'G1 X30 A180 F1000',
      'G1 X40 A350 F1000',
      'G0 A0'
    ]
    expect(check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })).toEqual([])
  })

  it('flags A value exceeding positive limit', () => {
    const lines = [
      'G0 X10 A0',
      'G1 X20 A400 F1000'
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })
    expect(w).toHaveLength(1)
    expect(w[0]!.aPosition).toBe(400)
    expect(w[0]!.maxAllowed).toBe(360)
    expect(w[0]!.lineIndex).toBe(1)
  })

  it('flags A value exceeding negative limit', () => {
    const lines = [
      'G0 A-400'
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })
    expect(w).toHaveLength(1)
    expect(w[0]!.aPosition).toBe(-400)
    expect(w[0]!.minAllowed).toBe(-360)
  })

  it('exactly at the limit does not warn', () => {
    const lines = [
      'G1 X10 A360 F1000',
      'G1 X20 A-360 F1000'
    ]
    expect(check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })).toEqual([])
  })

  it('respects custom aAxisRangeDeg (e.g. 180°)', () => {
    const lines = [
      'G1 X10 A90 F1000',   // OK (within ±180)
      'G1 X20 A181 F1000'   // exceeds +180
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 180 })
    expect(w).toHaveLength(1)
    expect(w[0]!.aPosition).toBe(181)
    expect(w[0]!.maxAllowed).toBe(180)
  })

  it('defaults to 360° range when no option provided', () => {
    const lines = [
      'G1 X10 A350 F1000'  // within ±360 default
    ]
    expect(check4AxisTravelLimits(lines)).toEqual([])
  })

  it('checks both G0 and G1 lines', () => {
    const lines = [
      'G0 A500',      // rapid exceeding limit
      'G1 A400 F1000' // feed exceeding limit
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })
    expect(w).toHaveLength(2)
    expect(w[0]!.aPosition).toBe(500)
    expect(w[1]!.aPosition).toBe(400)
  })

  it('skips lines without A word', () => {
    const lines = [
      'G1 X100 Y100 Z-5 F1000',  // no A word
      'G0 X0 Y0'                  // no A word
    ]
    expect(check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })).toEqual([])
  })

  it('skips comment lines', () => {
    const lines = [
      '; comment about A500',
      '(A500 reference comment)',
      'G1 X10 A90 F1000'
    ]
    expect(check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })).toEqual([])
  })

  it('reports correct line indices for multiple violations', () => {
    const lines = [
      'G0 X10 A0',           // 0: OK
      'G1 X20 A350 F1000',   // 1: OK
      'G1 X30 A400 F1000',   // 2: exceeds
      'G1 X40 A100 F1000',   // 3: OK
      'G1 X50 A500 F1000'    // 4: exceeds
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })
    expect(w).toHaveLength(2)
    expect(w[0]!.lineIndex).toBe(2)
    expect(w[1]!.lineIndex).toBe(4)
  })

  it('handles G01 long form', () => {
    const lines = [
      'G01 X10 A400 F1000'
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })
    expect(w).toHaveLength(1)
  })

  it('handles G00 long form', () => {
    const lines = [
      'G00 A500'
    ]
    const w = check4AxisTravelLimits(lines, { aAxisRangeDeg: 360 })
    expect(w).toHaveLength(1)
  })

  it('returns empty for no lines', () => {
    expect(check4AxisTravelLimits([])).toEqual([])
  })
})

describe('formatTravelLimitHint', () => {
  it('returns empty string for no warnings', () => {
    expect(formatTravelLimitHint([])).toBe('')
  })

  it('formats a single warning', () => {
    const warnings = [
      { lineIndex: 5, aPosition: 400, minAllowed: -360, maxAllowed: 360, line: 'G1 X10 A400 F1000' }
    ]
    const h = formatTravelLimitHint(warnings)
    expect(h).toContain('A-axis travel limit warning')
    expect(h).toContain('1 move(s)')
    expect(h).toContain('±360°')
    expect(h).toContain('wrapping')
  })

  it('formats multiple warnings with min/max extremes', () => {
    const warnings = [
      { lineIndex: 2, aPosition: 400, minAllowed: -360, maxAllowed: 360, line: 'G1 A400' },
      { lineIndex: 4, aPosition: -500, minAllowed: -360, maxAllowed: 360, line: 'G0 A-500' }
    ]
    const h = formatTravelLimitHint(warnings)
    expect(h).toContain('2 move(s)')
    expect(h).toContain('-500.0°')
    expect(h).toContain('400.0°')
  })
})
