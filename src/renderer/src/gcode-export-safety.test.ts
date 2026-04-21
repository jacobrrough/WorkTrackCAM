import { describe, expect, it } from 'vitest'
import { assessGcodeForExportSafety } from './gcode-export-safety'

describe('assessGcodeForExportSafety', () => {
  it('returns no blocking errors for compliant GRBL output', () => {
    const gcode = [
      '; test',
      'G21',
      'G90',
      'G17',
      'M3 S12000',
      'G0 X0 Y0 Z10',
      'G1 X10 Y10 Z-1 F500',
      'M5',
      'M9',
      'G0 Z100',
      'M30'
    ].join('\n')
    const result = assessGcodeForExportSafety({
      gcode,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(result.blockingErrors).toEqual([])
  })

  it('blocks files that contain dialect errors', () => {
    const gcode = ['G21', 'G91 G28 Z0', 'M30'].join('\n')
    const result = assessGcodeForExportSafety({
      gcode,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(result.blockingErrors.some((entry) => entry.includes('GRBL_NO_G28'))).toBe(true)
  })

  it('blocks files that miss critical shutdown commands', () => {
    const gcode = ['G21', 'G90', 'G1 X10 Y10 F500'].join('\n')
    const result = assessGcodeForExportSafety({
      gcode,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(result.blockingErrors).toContain('Missing spindle stop (M5).')
    expect(result.blockingErrors).toContain('Missing program end (M2/M30).')
  })
})
