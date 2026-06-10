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

describe('assessGcodeForExportSafety - Wave 3l machine work-area hard gate', () => {
  /** Real Laguna Swift 5x10 profile dims (resources/machines/laguna-swift-5x10.json). */
  const LAGUNA_WORK_AREA = { x: 1524, y: 3048, z: 203 }

  function lagunaProgram(cutMoves: string[]): string {
    return [
      'G21',
      'G90',
      'G17',
      'M3 S18000',
      'G0 Z25',
      ...cutMoves,
      'G0 Z25',
      'M5',
      'G0 Z25',
      'M30'
    ].join('\n')
  }

  it('BLOCKS a posted program that runs past the Laguna 3048 mm Y travel, naming axis + overshoot', () => {
    const result = assessGcodeForExportSafety({
      gcode: lagunaProgram(['G1 X100 Y3100 Z-3 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 25,
      workAreaMm: LAGUNA_WORK_AREA
    })
    const envelopeError = result.blockingErrors.find((entry) =>
      entry.includes('machine Y work area')
    )
    expect(envelopeError).toBeDefined()
    expect(envelopeError).toContain('Y3100.0 mm')
    expect(envelopeError).toContain('3048 mm')
    expect(envelopeError).toContain('52.0 mm past the limit')
  })

  it('BLOCKS a program past the Laguna 1524 mm X travel', () => {
    const result = assessGcodeForExportSafety({
      gcode: lagunaProgram(['G1 X1600 Y100 Z-3 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 25,
      workAreaMm: LAGUNA_WORK_AREA
    })
    expect(
      result.blockingErrors.some(
        (entry) => entry.includes('machine X work area') && entry.includes('76.0 mm past the limit')
      )
    ).toBe(true)
  })

  it('passes a full-sheet program inside the 1524x3048 bed (zero blockers)', () => {
    const result = assessGcodeForExportSafety({
      gcode: lagunaProgram(['G1 X1500 Y3000 Z-3 F2000', 'G1 X10 Y10 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 25,
      workAreaMm: LAGUNA_WORK_AREA
    })
    expect(result.blockingErrors).toEqual([])
  })

  it('degrades to the previous behavior when no machine dims are available (never a false block)', () => {
    const overBed = lagunaProgram(['G1 X9000 Y9000 Z-3 F2000'])
    const withoutDims = assessGcodeForExportSafety({
      gcode: overBed,
      dialect: 'mach3',
      safeRetractZMm: 25
    })
    expect(withoutDims.blockingErrors.some((entry) => entry.includes('work area'))).toBe(false)
    expect(withoutDims.blockingErrors).toEqual([])
  })

  it('deep Z cuts never trip the hard gate (Z stays advisory-only)', () => {
    const result = assessGcodeForExportSafety({
      gcode: lagunaProgram(['G1 X100 Y100 Z-50 F600']),
      dialect: 'mach3',
      safeRetractZMm: 25,
      workAreaMm: LAGUNA_WORK_AREA
    })
    expect(result.blockingErrors).toEqual([])
  })
})
