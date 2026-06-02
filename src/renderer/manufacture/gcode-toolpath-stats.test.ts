/**
 * gcode-toolpath-stats.test.ts — unit tests for the CNC toolpath
 * statistics parser used by the workflow Simulate stage.
 *
 * Covers all three My-Shop CNC dialects (CLAUDE.md USER CONTEXT):
 *   - Laguna Swift 5x10 / RichAuto A-series (G0/G1, M3/M5, no ATC)
 *   - Makera Carvera 3-axis (G0/G1/G2/G3, M3/M5, M6 tool change)
 *   - Makera Carvera 4-axis (adds A-axis, but the stats parser
 *     ignores rotary words by design — chord distance only)
 */
import { describe, expect, it } from 'vitest'
import { formatDistanceMm, parseToolpathStats } from './gcode-toolpath-stats'

// ─── Empty / degenerate input ────────────────────────────────────────────────
describe('parseToolpathStats — empty / degenerate input', () => {
  it('returns the zero-stats record for the empty string', () => {
    const s = parseToolpathStats('')
    expect(s.totalLines).toBe(0)
    expect(s.motionLines).toBe(0)
    expect(s.rapidCount).toBe(0)
    expect(s.cutCount).toBe(0)
    expect(s.arcCount).toBe(0)
    expect(s.rapidDistanceMm).toBe(0)
    expect(s.cutDistanceMm).toBe(0)
    expect(s.toolChangeCount).toBe(0)
    expect(s.spindleStartCount).toBe(0)
  })

  it('returns zero motion stats for a comment-only file', () => {
    const text = ['; just a comment', '; (Carvera post header)', '; nothing here'].join('\n')
    const s = parseToolpathStats(text)
    expect(s.totalLines).toBe(3)
    expect(s.motionLines).toBe(0)
    expect(s.cutCount).toBe(0)
  })

  it('returns zero motion stats for whitespace-only input', () => {
    expect(parseToolpathStats('   \n  \r\n   ').motionLines).toBe(0)
  })
})

// ─── Rapid (G0) vs cut (G1) classification ──────────────────────────────────
describe('parseToolpathStats — rapid vs cut classification', () => {
  it('counts explicit G0 moves as rapid', () => {
    const s = parseToolpathStats(['G0 X10 Y0', 'G0 X20 Y0'].join('\n'))
    expect(s.rapidCount).toBe(2)
    expect(s.cutCount).toBe(0)
  })

  it('counts explicit G1 moves as cut', () => {
    const s = parseToolpathStats(['G1 X10 Y0 F500', 'G1 X20 Y0'].join('\n'))
    expect(s.rapidCount).toBe(0)
    expect(s.cutCount).toBe(2)
  })

  it('treats G00 and G01 as G0 and G1 respectively', () => {
    const s = parseToolpathStats(['G00 X5', 'G01 X10 F300'].join('\n'))
    expect(s.rapidCount).toBe(1)
    expect(s.cutCount).toBe(1)
  })

  it('inherits the modal motion for bare X/Y/Z continuation lines', () => {
    const s = parseToolpathStats(
      [
        'G1 X10 Y0 F500', // cut #1
        'X20 Y0', // cut #2 (modal G1)
        'X30 Y0' // cut #3 (modal G1)
      ].join('\n')
    )
    expect(s.cutCount).toBe(3)
    expect(s.rapidCount).toBe(0)
  })
})

// ─── Distance accumulation ──────────────────────────────────────────────────
describe('parseToolpathStats — distance accumulation', () => {
  it('accumulates rapid distance correctly', () => {
    const s = parseToolpathStats(['G0 X10 Y0 Z0', 'G0 X10 Y10 Z0'].join('\n'))
    // (0,0,0) -> (10,0,0) = 10mm; (10,0,0) -> (10,10,0) = 10mm.
    expect(s.rapidDistanceMm).toBeCloseTo(20, 3)
  })

  it('accumulates cut distance correctly', () => {
    const s = parseToolpathStats(['G1 X3 Y4 F300'].join('\n'))
    // (0,0,0) -> (3,4,0) = 5mm
    expect(s.cutDistanceMm).toBeCloseTo(5, 3)
  })

  it('handles 3D moves (XYZ Pythagoras)', () => {
    const s = parseToolpathStats(['G1 X2 Y3 Z6 F300'].join('\n'))
    // sqrt(4+9+36) = 7
    expect(s.cutDistanceMm).toBeCloseTo(7, 3)
  })

  it('keeps rapid + cut distances on separate counters', () => {
    const s = parseToolpathStats(['G0 X5', 'G1 X10 F300'].join('\n'))
    expect(s.rapidDistanceMm).toBeCloseTo(5, 3)
    expect(s.cutDistanceMm).toBeCloseTo(5, 3)
  })
})

// ─── Arc moves (G2 / G3) ────────────────────────────────────────────────────
describe('parseToolpathStats — arc moves (G2 / G3)', () => {
  it('counts G2 and G3 in arcCount', () => {
    const s = parseToolpathStats(
      ['G0 X0 Y0', 'G2 X10 Y0 I5 J0 F300', 'G3 X20 Y0 I5 J0'].join('\n')
    )
    expect(s.arcCount).toBe(2)
  })

  it('arc distance is added to cut distance (chord length)', () => {
    // Quarter-circle CW from (0,0) ending at (10,10), radius 10, I=10 J=0.
    // Chord distance = sqrt(10^2 + 10^2) = 14.142..
    const s = parseToolpathStats(['G0 X0 Y0', 'G2 X10 Y10 I10 J0 F300'].join('\n'))
    expect(s.cutDistanceMm).toBeCloseTo(Math.sqrt(200), 3)
    expect(s.arcCount).toBe(1)
    expect(s.cutCount).toBe(0)
  })

  it('treats G02 / G03 as G2 / G3', () => {
    const s = parseToolpathStats(['G02 X1 Y1 I0 J1', 'G03 X2 Y2 I0 J1'].join('\n'))
    expect(s.arcCount).toBe(2)
  })
})

// ─── M-code detection ───────────────────────────────────────────────────────
describe('parseToolpathStats — M-code detection', () => {
  it('counts M6 tool changes', () => {
    const s = parseToolpathStats(['M6 T1', 'M6 T2', 'M6 T3'].join('\n'))
    expect(s.toolChangeCount).toBe(3)
  })

  it('counts M3 and M4 spindle starts (not M5)', () => {
    const s = parseToolpathStats(['M3 S12000', 'M5', 'M4 S8000', 'M5'].join('\n'))
    expect(s.spindleStartCount).toBe(2)
  })

  it('ignores M-codes inside comments', () => {
    const s = parseToolpathStats([
      '; M6 commented-out tool change',
      '(M3 inside parens)',
      'G1 X10'
    ].join('\n'))
    expect(s.toolChangeCount).toBe(0)
    expect(s.spindleStartCount).toBe(0)
  })
})

// ─── Comment stripping ──────────────────────────────────────────────────────
describe('parseToolpathStats — comment handling', () => {
  it('strips trailing semicolon comments before classification', () => {
    const s = parseToolpathStats(['G1 X10 ; trailing'].join('\n'))
    expect(s.cutCount).toBe(1)
    expect(s.cutDistanceMm).toBeCloseTo(10, 3)
  })

  it('strips parenthesised inline comments', () => {
    const s = parseToolpathStats(['G1 (rapid?) X10'].join('\n'))
    expect(s.cutCount).toBe(1)
  })

  it('ignores lines that are pure comments', () => {
    const s = parseToolpathStats(['; G1 X10', '(M3 S12000)'].join('\n'))
    expect(s.cutCount).toBe(0)
    expect(s.spindleStartCount).toBe(0)
  })
})

// ─── Per-machine sample fixtures ────────────────────────────────────────────
describe('parseToolpathStats — per-machine sample fixtures', () => {
  it('handles a Laguna Swift RichAuto A-series sample', () => {
    // Synthetic but representative: no M6 (no ATC), G0/G1 only, M3 startup.
    const text = [
      '; LAGUNA SWIFT 5X10 — RichAuto A-series',
      'G21',
      'G90',
      'M3 S18000',
      'G0 X0 Y0 Z5',
      'G1 Z-3 F600',
      'G1 X100 Y0',
      'G1 X100 Y100',
      'G1 X0 Y100',
      'G1 X0 Y0',
      'G0 Z25',
      'M5',
      'M30'
    ].join('\n')
    const s = parseToolpathStats(text)
    expect(s.spindleStartCount).toBe(1)
    expect(s.toolChangeCount).toBe(0)
    expect(s.rapidCount).toBe(2)
    expect(s.cutCount).toBe(5)
    expect(s.arcCount).toBe(0)
  })

  it('handles a Carvera 3-axis ATC sample (multi-tool M6)', () => {
    const text = [
      '; CARVERA 3-AXIS — Makera Controller',
      'G21 G90',
      'M6 T1',
      'M3 S15000',
      'G0 X10 Y10',
      'G1 Z-1 F300',
      'G2 X20 Y10 I5 J0',
      'G0 Z5',
      'M6 T2',
      'M3 S12000',
      'G0 X30 Y10',
      'G1 Z-2 F300',
      'M5',
      'M30'
    ].join('\n')
    const s = parseToolpathStats(text)
    expect(s.toolChangeCount).toBe(2)
    expect(s.spindleStartCount).toBe(2)
    expect(s.arcCount).toBe(1)
    expect(s.cutCount).toBeGreaterThanOrEqual(2)
    expect(s.rapidCount).toBeGreaterThanOrEqual(2)
  })

  it('handles a Carvera 4-axis rotary sample (A-word present, chord distance)', () => {
    const text = [
      '; CARVERA 4-AXIS — A-axis wrap',
      'G21 G90',
      'M3 S12000',
      'G0 X0 Y0 Z5 A0',
      'G1 Z-0.5 F200',
      'G1 X10 A90',
      'G1 X20 A180',
      'M5'
    ].join('\n')
    const s = parseToolpathStats(text)
    expect(s.cutCount).toBe(3)
    expect(s.rapidCount).toBe(1)
    expect(s.spindleStartCount).toBe(1)
    // A-word is ignored — XYZ distance is what we measure.
    expect(s.cutDistanceMm).toBeGreaterThan(0)
  })
})

// ─── Total-lines contract ───────────────────────────────────────────────────
describe('parseToolpathStats — totalLines counter', () => {
  it('counts every line including blanks + comments', () => {
    const s = parseToolpathStats(['; header', '', 'G1 X10', 'G0 Z5', ''].join('\n'))
    expect(s.totalLines).toBe(5)
  })
})

// ─── formatDistanceMm ───────────────────────────────────────────────────────
describe('formatDistanceMm', () => {
  it('formats null / negative / NaN as em-dash', () => {
    expect(formatDistanceMm(null)).toBe('—')
    expect(formatDistanceMm(undefined)).toBe('—')
    expect(formatDistanceMm(-1)).toBe('—')
    expect(formatDistanceMm(Number.NaN)).toBe('—')
  })

  it('formats sub-metre as "N.N mm"', () => {
    expect(formatDistanceMm(0)).toBe('0.0 mm')
    expect(formatDistanceMm(123.45)).toBe('123.5 mm')
    expect(formatDistanceMm(999.9)).toBe('999.9 mm')
  })

  it('formats >= 1000 mm as "N.NN m"', () => {
    expect(formatDistanceMm(1234.5)).toBe('1.23 m')
    expect(formatDistanceMm(12345)).toBe('12.35 m')
  })
})
