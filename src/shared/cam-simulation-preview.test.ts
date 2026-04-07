import { describe, expect, it } from 'vitest'
import { buildCamSimulationPreview } from './cam-simulation-preview'

describe('buildCamSimulationPreview', () => {
  it('extracts motion/cutting counts and bounds from basic gcode', () => {
    const gcode = [
      'G0 Z5.000',
      'G0 X0.000 Y0.000',
      'G1 Z-1.000 F200',
      'G1 X10.000 Y0.000 F400',
      'G1 X10.000 Y5.000 F400',
      'G0 Z5.000'
    ].join('\n')

    const preview = buildCamSimulationPreview(gcode)
    expect(preview.motionLines).toBe(6)
    expect(preview.cuttingMoves).toBe(3)
    expect(preview.xyBounds).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 5 })
    expect(preview.zRange).toEqual({ topZ: 5, bottomZ: -1 })
    expect(preview.cues.length).toBeGreaterThan(0)
  })

  it('reports traverse-only preview when no cutting moves are present', () => {
    const gcode = ['G0 Z10.000', 'G0 X2.000 Y3.000', 'G1 Z2.000 F200'].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.cuttingMoves).toBe(0)
    expect(preview.cues[0]?.message).toContain('No below-Z0 cutting moves detected')
  })

  it('returns null bounds and zRange for empty gcode', () => {
    const preview = buildCamSimulationPreview('')
    expect(preview.totalLines).toBe(0)
    expect(preview.motionLines).toBe(0)
    expect(preview.cuttingMoves).toBe(0)
    expect(preview.xyBounds).toBeNull()
    expect(preview.zRange).toBeNull()
    expect(preview.cues).toHaveLength(0)
  })

  it('strips semicolon comments from totalLines count', () => {
    const gcode = ['; program start', '; tool: 6mm', 'G0 Z5', 'G1 X10 Z-1 F400'].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    // Comments and blank lines are excluded from totalLines
    expect(preview.totalLines).toBe(2)
    expect(preview.motionLines).toBe(2)
  })

  it('includes disclaimer text in every result', () => {
    const preview = buildCamSimulationPreview('G0 Z5')
    expect(preview.disclaimer).toBeTruthy()
    expect(preview.disclaimer.length).toBeGreaterThan(20)
  })

  it('produces exactly one cue when cueCount=1', () => {
    const gcode = [
      'G0 Z5', 'G1 Z-1 F200', 'G1 X5 F400', 'G1 X10 F400', 'G0 Z5'
    ].join('\n')
    const preview = buildCamSimulationPreview(gcode, 1)
    // cueCount=1: samples=min(1, cuttingMoves) → only first/last (same index)
    expect(preview.cues.length).toBe(1)
  })

  it('first cue message indicates tool entry', () => {
    const gcode = ['G0 Z5', 'G1 Z-2 F200', 'G1 X10 F400', 'G0 Z5'].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.cues[0]?.message).toMatch(/enters stock|first detected/i)
  })

  it('last cue message indicates final pass', () => {
    // Enough cutting moves to get a distinct last cue
    const lines = ['G0 Z5']
    for (let i = 0; i < 10; i++) lines.push(`G1 X${i} Z-1 F400`)
    lines.push('G0 Z5')
    const preview = buildCamSimulationPreview(lines.join('\n'), 5)
    const lastCue = preview.cues[preview.cues.length - 1]!
    expect(lastCue.message).toMatch(/final|last/i)
  })

  it('zRange.topZ is the highest Z seen (including rapids)', () => {
    const gcode = ['G0 Z15', 'G1 Z-3 F200', 'G0 Z15'].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.zRange?.topZ).toBe(15)
    expect(preview.zRange?.bottomZ).toBe(-3)
  })

  it('cueCount=0 is clamped to 1 via Math.max guard — produces exactly 1 cue', () => {
    // Math.max(1, Math.min(0, n)) = 1 regardless of cutting moves
    const gcode = ['G0 Z5', 'G1 Z-1 F200', 'G1 X5 F400', 'G0 Z5'].join('\n')
    const preview = buildCamSimulationPreview(gcode, 0)
    expect(preview.cues.length).toBe(1)
  })

  it('middle cue message references a line number', () => {
    // Need >= 3 cuts and cueCount >= 3 to trigger the middle cue branch (i>0, i<samples-1)
    const lines = ['G0 Z5']
    for (let i = 0; i < 6; i++) lines.push(`G1 X${i * 5} Z-1 F400`)
    lines.push('G0 Z5')
    const preview = buildCamSimulationPreview(lines.join('\n'), 3)
    // 3 cues: first (entry), middle (sample), last (final)
    expect(preview.cues.length).toBe(3)
    const middleCue = preview.cues[1]!
    expect(middleCue.message).toContain('line')
    expect(middleCue.message).toContain('pass sample')
  })

  it('no motion lines → empty cues and null bounds even with comment-only gcode', () => {
    const gcode = ['; only comments', '; no motion'].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.motionLines).toBe(0)
    expect(preview.cuttingMoves).toBe(0)
    expect(preview.cues).toHaveLength(0)
    expect(preview.xyBounds).toBeNull()
    expect(preview.zRange).toBeNull()
    // totalLines is also 0 because comments are stripped
    expect(preview.totalLines).toBe(0)
  })

  it('XY bounds reflect modal state tracking (X and Y on separate lines)', () => {
    // X is set on one line; Y on a subsequent line — bounds must include both
    const gcode = ['G0 X20', 'G1 Y15 Z-2 F400', 'G0 Z5'].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.xyBounds?.maxX).toBe(20)
    expect(preview.xyBounds?.maxY).toBe(15)
    expect(preview.cuttingMoves).toBe(1)
  })

  it('parses explicit positive axis sign X+10.5 Y+5 (Fanuc/Heidenhain posts)', () => {
    // Regression: readAxis must handle the '+' prefix emitted by Fanuc/Heidenhain post-processors.
    // Without the [+-]? fix, X+10.5 would return null and XY bounds would not be updated.
    const gcode = 'G0 X+10.5 Y+5 Z+2\nG1 X+20 Y+15 Z-1 F400'
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.motionLines).toBe(2)
    expect(preview.xyBounds?.maxX).toBeCloseTo(20, 5)
    expect(preview.xyBounds?.maxY).toBeCloseTo(15, 5)
    expect(preview.xyBounds?.minX).toBeCloseTo(10.5, 5)
    expect(preview.zRange?.topZ).toBeCloseTo(2, 5)
    expect(preview.zRange?.bottomZ).toBeCloseTo(-1, 5)
  })

  it('ignores axis values inside parenthetical comments (Fanuc inline comments)', () => {
    // Regression: "G1 X10 (Y-5 ref) Y20 F400" must give Y=20, not Y=-5 from the comment.
    // Without comment stripping, the regex would match Y-5 from inside the parenthetical.
    const gcode = 'G1 X10 (Y-5 ref) Y20 F400'
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.xyBounds?.maxY).toBeCloseTo(20, 5)
    expect(preview.xyBounds?.minY).toBeCloseTo(20, 5)
    expect(preview.xyBounds?.maxX).toBeCloseTo(10, 5)
  })

  it('handles multiple parenthetical comments in one line', () => {
    const gcode = 'G1 (op start) X5 (end at X) Y10 (not Z) Z-3 F800'
    const preview = buildCamSimulationPreview(gcode)
    expect(preview.xyBounds?.maxX).toBeCloseTo(5, 5)
    expect(preview.xyBounds?.maxY).toBeCloseTo(10, 5)
    expect(preview.zRange?.bottomZ).toBeCloseTo(-3, 5)
  })

  it('non-comment non-motion lines (M-codes, T-codes) are skipped without affecting counts', () => {
    // Lines like "T1 M6", "M3 S8000" pass the comment filter but are not G0/G1 moves.
    // The `!/^(G0|G1)\b/.test(line)) continue` branch must skip them silently.
    const gcode = [
      'T1 M6',         // tool change — not a motion line
      'M3 S8000',      // spindle on — not a motion line
      'G0 Z5',         // rapid
      'G1 Z-1 F200',   // cutting move
      'G1 X10 F400',   // cutting move
      'M5',            // spindle off — not a motion line
      'G0 Z5'          // rapid
    ].join('\n')
    const preview = buildCamSimulationPreview(gcode)
    // totalLines counts non-comment lines (including M/T codes): 7
    expect(preview.totalLines).toBe(7)
    // Only G0/G1 lines contribute to motionLines
    expect(preview.motionLines).toBe(4)
    // Cutting moves are G1 lines with Z < 0: 2
    expect(preview.cuttingMoves).toBe(2)
  })
})
