import { describe, expect, it } from 'vitest'
import {
  generateCarveraAAxisZero,
  generateCarveraWcsZero,
  generateCarveraZProbe,
  generateCarvera4AxisSetup,
  generateCarveraPreflightCheck,
  validateSpindleRpm,
  getCarveraPreflightChecklist
} from './carvera-zeroing'

// ─── generateCarveraAAxisZero ────────────────────────────────────────────────
describe('generateCarveraAAxisZero', () => {
  it('output contains G28.3 A0', () => {
    const gcode = generateCarveraAAxisZero()
    expect(gcode).toContain('G28.3 A0')
  })

  it('output contains G21 (mm)', () => {
    const gcode = generateCarveraAAxisZero()
    expect(gcode).toContain('G21')
  })

  it('output contains G90 (absolute)', () => {
    const gcode = generateCarveraAAxisZero()
    expect(gcode).toContain('G90')
  })

  it('output ends with M2 (not M30)', () => {
    const gcode = generateCarveraAAxisZero()
    const lines = gcode.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith(';'))
    expect(lines[lines.length - 1].trim()).toBe('M2')
    expect(gcode).not.toContain('M30')
  })

  it('output contains descriptive comments', () => {
    const gcode = generateCarveraAAxisZero()
    expect(gcode).toContain('; ')
    expect(gcode).toContain('A-Axis Zero')
    expect(gcode).toContain('Smoothieware')
  })
})

// ─── generateCarveraWcsZero ──────────────────────────────────────────────────
describe('generateCarveraWcsZero', () => {
  it('zero single axis (X only)', () => {
    const gcode = generateCarveraWcsZero({ axes: ['x'] })
    expect(gcode).toContain('X0')
    expect(gcode).not.toMatch(/G10 L20 P\d+ .*Y0/)
    expect(gcode).not.toMatch(/G10 L20 P\d+ .*Z0/)
  })

  it('zero multiple axes (X, Y, Z)', () => {
    const gcode = generateCarveraWcsZero({ axes: ['x', 'y', 'z'] })
    expect(gcode).toContain('X0')
    expect(gcode).toContain('Y0')
    expect(gcode).toContain('Z0')
  })

  it('zero all axes including A', () => {
    const gcode = generateCarveraWcsZero({ axes: ['x', 'y', 'z', 'a'] })
    expect(gcode).toContain('X0')
    expect(gcode).toContain('Y0')
    expect(gcode).toContain('Z0')
    expect(gcode).toContain('A0')
  })

  it('custom WCS index (P2 = G55)', () => {
    const gcode = generateCarveraWcsZero({ axes: ['x'], wcsIndex: 2 })
    expect(gcode).toContain('G10 L20 P2')
    expect(gcode).toContain('G55')
  })

  it('default WCS index (P1 = G54)', () => {
    const gcode = generateCarveraWcsZero({ axes: ['x'] })
    expect(gcode).toContain('G10 L20 P1')
    expect(gcode).toContain('G54')
  })

  it('output ends with M2', () => {
    const gcode = generateCarveraWcsZero({ axes: ['x'] })
    const lines = gcode.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith(';'))
    expect(lines[lines.length - 1].trim()).toBe('M2')
    expect(gcode).not.toContain('M30')
  })

  it('output contains G10 L20', () => {
    const gcode = generateCarveraWcsZero({ axes: ['y'] })
    expect(gcode).toContain('G10 L20')
  })
})

// ─── generateCarveraZProbe ───────────────────────────────────────────────────
describe('generateCarveraZProbe', () => {
  it('default parameters produce correct G-code', () => {
    const gcode = generateCarveraZProbe()
    expect(gcode).toContain('G38.2 Z-50 F100')
    expect(gcode).toContain('G0 Z5')
  })

  it('custom probe distance', () => {
    const gcode = generateCarveraZProbe({ probeDistMm: 30 })
    expect(gcode).toContain('G38.2 Z-30')
  })

  it('custom probe feed', () => {
    const gcode = generateCarveraZProbe({ probeFeedMmMin: 50 })
    expect(gcode).toContain('F50')
  })

  it('custom retract height', () => {
    const gcode = generateCarveraZProbe({ retractMm: 10 })
    expect(gcode).toContain('G0 Z10')
  })

  it('contains M6 T0 (wireless probe)', () => {
    const gcode = generateCarveraZProbe()
    expect(gcode).toContain('M6 T0')
  })

  it('contains G38.2 (probe command)', () => {
    const gcode = generateCarveraZProbe()
    expect(gcode).toContain('G38.2')
  })

  it('contains G10 L20 P1 Z0', () => {
    const gcode = generateCarveraZProbe()
    expect(gcode).toContain('G10 L20 P1 Z0')
  })

  it('ends with M2', () => {
    const gcode = generateCarveraZProbe()
    const lines = gcode.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith(';'))
    expect(lines[lines.length - 1].trim()).toBe('M2')
    expect(gcode).not.toContain('M30')
  })
})

// ─── generateCarvera4AxisSetup ───────────────────────────────────────────────
describe('generateCarvera4AxisSetup', () => {
  it('contains both G28.3 A0 and G38.2', () => {
    const gcode = generateCarvera4AxisSetup()
    expect(gcode).toContain('G28.3 A0')
    expect(gcode).toContain('G38.2')
  })

  it('contains M6 T0', () => {
    const gcode = generateCarvera4AxisSetup()
    expect(gcode).toContain('M6 T0')
  })

  it('contains G10 L20 P1 A0', () => {
    const gcode = generateCarvera4AxisSetup()
    expect(gcode).toContain('G10 L20 P1 A0')
  })

  it('contains warning about Z=0 at rotation axis', () => {
    const gcode = generateCarvera4AxisSetup()
    expect(gcode).toMatch(/ROTATION AXIS/i)
  })

  it('ends with M2', () => {
    const gcode = generateCarvera4AxisSetup()
    const lines = gcode.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith(';'))
    expect(lines[lines.length - 1].trim()).toBe('M2')
    expect(gcode).not.toContain('M30')
  })
})

// ─── generateCarveraPreflightCheck ───────────────────────────────────────────
describe('generateCarveraPreflightCheck', () => {
  it('default values produce valid G-code', () => {
    const gcode = generateCarveraPreflightCheck({})
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('S6000')
  })

  it('spindle speed set but M3 NOT present as a G-code command', () => {
    const gcode = generateCarveraPreflightCheck({ spindleRpm: 12000 })
    expect(gcode).toContain('S12000')
    // M3 may appear inside comments (e.g. "no M3"), but must not appear as an
    // actual G-code command on a non-comment line.
    const codeLines = gcode.split('\n').filter((l) => !l.trim().startsWith(';') && l.trim().length > 0)
    for (const line of codeLines) {
      expect(line).not.toMatch(/\bM3\b/)
    }
  })

  it('contains dry-run feed (10% of specified)', () => {
    const gcode = generateCarveraPreflightCheck({ feedMmMin: 2000 })
    // 10% of 2000 = 200
    expect(gcode).toContain('F200')
  })

  it('ends with M2', () => {
    const gcode = generateCarveraPreflightCheck({})
    const lines = gcode.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith(';'))
    expect(lines[lines.length - 1].trim()).toBe('M2')
    expect(gcode).not.toContain('M30')
  })
})

// ─── validateSpindleRpm ──────────────────────────────────────────────────────
describe('validateSpindleRpm', () => {
  it('within range returns valid true, no warning', () => {
    const result = validateSpindleRpm(10000, {})
    expect(result.valid).toBe(true)
    expect(result.clampedRpm).toBe(10000)
    expect(result.warning).toBeUndefined()
  })

  it('above max returns clamped value + warning', () => {
    const result = validateSpindleRpm(20000, {})
    expect(result.valid).toBe(false)
    expect(result.clampedRpm).toBe(15000)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('15000')
  })

  it('below min returns clamped value + warning', () => {
    const result = validateSpindleRpm(3000, {})
    expect(result.valid).toBe(false)
    expect(result.clampedRpm).toBe(6000)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('6000')
  })

  it('NaN returns clamped to min + warning', () => {
    const result = validateSpindleRpm(NaN, {})
    expect(result.valid).toBe(false)
    expect(result.clampedRpm).toBe(6000)
    expect(result.warning).toBeDefined()
  })

  it('zero returns clamped to min + warning', () => {
    const result = validateSpindleRpm(0, {})
    expect(result.valid).toBe(false)
    expect(result.clampedRpm).toBe(6000)
    expect(result.warning).toBeDefined()
  })

  it('negative returns clamped to min + warning', () => {
    const result = validateSpindleRpm(-500, {})
    expect(result.valid).toBe(false)
    expect(result.clampedRpm).toBe(6000)
    expect(result.warning).toBeDefined()
  })

  it('custom machine limits (not Carvera defaults)', () => {
    const result = validateSpindleRpm(25000, { minSpindleRpm: 1000, maxSpindleRpm: 24000 })
    expect(result.valid).toBe(false)
    expect(result.clampedRpm).toBe(24000)
    expect(result.warning).toContain('24000')

    const resultLow = validateSpindleRpm(500, { minSpindleRpm: 1000, maxSpindleRpm: 24000 })
    expect(resultLow.valid).toBe(false)
    expect(resultLow.clampedRpm).toBe(1000)
    expect(resultLow.warning).toContain('1000')

    const resultOk = validateSpindleRpm(12000, { minSpindleRpm: 1000, maxSpindleRpm: 24000 })
    expect(resultOk.valid).toBe(true)
    expect(resultOk.clampedRpm).toBe(12000)
    expect(resultOk.warning).toBeUndefined()
  })
})

// ─── getCarveraPreflightChecklist ────────────────────────────────────────────
describe('getCarveraPreflightChecklist', () => {
  it('4-axis mode returns items including rotary, stock, tailstock, z-zero, a-zero', () => {
    const items = getCarveraPreflightChecklist({ is4Axis: true })
    const ids = items.map((i) => i.id)
    expect(ids).toContain('rotary_secured')
    expect(ids).toContain('stock_centered')
    expect(ids).toContain('tailstock_engaged')
    expect(ids).toContain('z_zero_at_center')
    expect(ids).toContain('a_zero_set')
  })

  it('3-axis mode returns items including workpiece clamped, WCS zeroed', () => {
    const items = getCarveraPreflightChecklist({ is4Axis: false })
    const ids = items.map((i) => i.id)
    expect(ids).toContain('workpiece_clamped')
    expect(ids).toContain('wcs_zeroed')
  })

  it('all items start unchecked', () => {
    const items4 = getCarveraPreflightChecklist({ is4Axis: true })
    const items3 = getCarveraPreflightChecklist({ is4Axis: false })
    for (const item of [...items4, ...items3]) {
      expect(item.checked).toBe(false)
    }
  })

  it('critical items are marked critical: true', () => {
    const items4 = getCarveraPreflightChecklist({ is4Axis: true })
    const criticalIds = ['enclosure_closed', 'correct_tool', 'rotary_secured', 'stock_centered', 'tailstock_engaged', 'z_zero_at_center', 'a_zero_set']
    for (const id of criticalIds) {
      const item = items4.find((i) => i.id === id)
      expect(item?.critical).toBe(true)
    }

    const items3 = getCarveraPreflightChecklist({ is4Axis: false })
    const critical3Ids = ['enclosure_closed', 'correct_tool', 'workpiece_clamped', 'wcs_zeroed']
    for (const id of critical3Ids) {
      const item = items3.find((i) => i.id === id)
      expect(item?.critical).toBe(true)
    }
  })

  it('common items (enclosure, tool, dust) appear in both modes', () => {
    const items4 = getCarveraPreflightChecklist({ is4Axis: true })
    const items3 = getCarveraPreflightChecklist({ is4Axis: false })
    const commonIds = ['enclosure_closed', 'correct_tool', 'dust_collection']
    for (const id of commonIds) {
      expect(items4.find((i) => i.id === id)).toBeDefined()
      expect(items3.find((i) => i.id === id)).toBeDefined()
    }
  })
})
