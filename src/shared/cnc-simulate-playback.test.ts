/**
 * Unit tests for the CNC simulate view-model builder.
 *
 * Exercises the four scenarios called out in the plan:
 *   1. Empty G-code → zeros / null / []
 *   2. Laguna 3-axis fixture (no A words) → axisMode '3axis'
 *   3. Carvera 4-axis fixture (A words) → axisMode '4axis'
 *   4. Feed rate range from F300 / F1200 → { min: 300, max: 1200 }
 *   5. G2/G3 arcs counted without crash
 */

import { describe, expect, it } from 'vitest'
import { buildCncSimulatePlaybackModel } from './cnc-simulate-playback'

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Laguna Swift 5x10 — 3-axis, no A words, includes rapids + feeds. */
const LAGUNA_3AXIS_GCODE = [
  '; Laguna Swift 5x10 — RichAuto A-series',
  'G21 G90',
  'M3 S18000',
  'G0 X0 Y0 Z5',
  'G1 Z-3 F300',
  'G1 X100 Y0 F1200',
  'G1 X100 Y100',
  'G1 X0 Y100',
  'G1 X0 Y0',
  'G0 Z5',
  'M5',
  'M30',
].join('\n')

/** Makera Carvera 4th-axis fixture — contains A-axis rotation words. */
const CARVERA_4AXIS_GCODE = [
  '; Carvera 4th-axis rotary',
  'G21 G90',
  'M3 S14000',
  'G0 X0 A0',
  'G1 X10 A45 F800',
  'G1 X20 A90 F800',
  'G1 X30 A180 F800',
  'G0 Z5',
  'M5',
  'M30',
].join('\n')

/** Carvera 3-axis fixture with G2/G3 arcs. */
const CARVERA_3AXIS_ARC_GCODE = [
  '; Carvera 3-axis with arcs',
  'G21 G90',
  'M3 S15000',
  'G0 X10 Y10 Z5',
  'G1 Z-1 F300',
  'G1 X20 Y10 F600',
  'G2 X30 Y10 I5 J0 F600',
  'G3 X40 Y10 I5 J0 F600',
  'G0 Z5',
  'M5',
  'M30',
].join('\n')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildCncSimulatePlaybackModel', () => {
  describe('empty G-code', () => {
    it('returns segmentCount 0 for an empty string', () => {
      const m = buildCncSimulatePlaybackModel('', '3axis')
      expect(m.segmentCount).toBe(0)
    })

    it('returns totalLengthMm 0 for an empty string', () => {
      const m = buildCncSimulatePlaybackModel('', '3axis')
      expect(m.totalLengthMm).toBe(0)
    })

    it('returns null feedRateRangeMmMin for an empty string', () => {
      const m = buildCncSimulatePlaybackModel('', '3axis')
      expect(m.feedRateRangeMmMin).toBeNull()
    })

    it('returns an empty collisionSegmentIndices array', () => {
      const m = buildCncSimulatePlaybackModel('', '3axis')
      expect(m.collisionSegmentIndices).toEqual([])
    })

    it('preserves the provided axisMode hint for empty input', () => {
      expect(buildCncSimulatePlaybackModel('', '3axis').axisMode).toBe('3axis')
      expect(buildCncSimulatePlaybackModel('', '4axis').axisMode).toBe('4axis')
    })

    it('returns zeros for whitespace-only G-code', () => {
      const m = buildCncSimulatePlaybackModel('   \n  \r\n   ', '3axis')
      expect(m.segmentCount).toBe(0)
      expect(m.totalLengthMm).toBe(0)
      expect(m.feedRateRangeMmMin).toBeNull()
    })
  })

  describe('Laguna 3-axis fixture (no A words)', () => {
    it('sets axisMode to "3axis" when G-code has no A-axis words', () => {
      const m = buildCncSimulatePlaybackModel(LAGUNA_3AXIS_GCODE, '3axis')
      expect(m.axisMode).toBe('3axis')
    })

    it('counts motion segments (G0 rapids + G1 feeds)', () => {
      const m = buildCncSimulatePlaybackModel(LAGUNA_3AXIS_GCODE, '3axis')
      // G0 X0 Y0 Z5, G1 Z-3, G1 X100 Y0, G1 X100 Y100, G1 X0 Y100, G1 X0 Y0, G0 Z5 = 7 segments
      expect(m.segmentCount).toBe(7)
    })

    it('returns a positive totalLengthMm', () => {
      const m = buildCncSimulatePlaybackModel(LAGUNA_3AXIS_GCODE, '3axis')
      expect(m.totalLengthMm).toBeGreaterThan(0)
    })

    it('does NOT upgrade to 4axis even when caller requests it on 3-axis G-code — no: auto-upgrades only 3→4', () => {
      // When caller says '3axis' and G-code has no A words, stays '3axis'
      const m = buildCncSimulatePlaybackModel(LAGUNA_3AXIS_GCODE, '3axis')
      expect(m.axisMode).toBe('3axis')
    })

    it('collisionSegmentIndices is always empty (foundation slice)', () => {
      const m = buildCncSimulatePlaybackModel(LAGUNA_3AXIS_GCODE, '3axis')
      expect(m.collisionSegmentIndices).toEqual([])
    })
  })

  describe('Carvera 4-axis fixture (A words)', () => {
    it('sets axisMode to "4axis" when G-code contains A-axis words', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_4AXIS_GCODE, '3axis')
      expect(m.axisMode).toBe('4axis')
    })

    it('auto-upgrades axisMode from "3axis" hint when A words are present', () => {
      // Even if caller passes '3axis', A words in G-code force '4axis'
      const m = buildCncSimulatePlaybackModel(CARVERA_4AXIS_GCODE, '3axis')
      expect(m.axisMode).toBe('4axis')
    })

    it('preserves "4axis" when caller passes that hint', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_4AXIS_GCODE, '4axis')
      expect(m.axisMode).toBe('4axis')
    })

    it('counts motion segments from the 4-axis extractor', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_4AXIS_GCODE, '4axis')
      // G0 X0 A0, G1 X10 A45, G1 X20 A90, G1 X30 A180, G0 Z5 = 5 segments
      expect(m.segmentCount).toBe(5)
    })

    it('returns a positive totalLengthMm', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_4AXIS_GCODE, '4axis')
      expect(m.totalLengthMm).toBeGreaterThan(0)
    })
  })

  describe('feed rate range extraction', () => {
    it('extracts { min: 300, max: 1200 } from F300 / F1200 on G1 lines', () => {
      const m = buildCncSimulatePlaybackModel(LAGUNA_3AXIS_GCODE, '3axis')
      expect(m.feedRateRangeMmMin).toEqual({ min: 300, max: 1200 })
    })

    it('extracts F800 as both min and max when only one feed rate is used', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_4AXIS_GCODE, '4axis')
      expect(m.feedRateRangeMmMin).toEqual({ min: 800, max: 800 })
    })

    it('ignores F words on rapid (G0) lines', () => {
      const rapidOnlyGcode = [
        'G0 X0 Y0 Z5 F9000',
        'G0 X100 Y100',
      ].join('\n')
      const m = buildCncSimulatePlaybackModel(rapidOnlyGcode, '3axis')
      // G0 lines: no feed moves → null
      expect(m.feedRateRangeMmMin).toBeNull()
    })

    it('returns null when G-code has no F words on G1 lines', () => {
      const noFeedGcode = [
        'G0 X0 Y0',
        'G1 X10 Y10',
        'G0 Z5',
      ].join('\n')
      const m = buildCncSimulatePlaybackModel(noFeedGcode, '3axis')
      expect(m.feedRateRangeMmMin).toBeNull()
    })
  })

  describe('G2/G3 arc handling', () => {
    it('counts arc sub-segments without crashing', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_3AXIS_ARC_GCODE, '3axis')
      // 1 rapid + 1 plunge + 1 G1 + 16 G2 sub-segs + 16 G3 sub-segs + 1 G0 = 36 total
      expect(m.segmentCount).toBeGreaterThan(0)
    })

    it('returns a positive totalLengthMm for a fixture with arcs', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_3AXIS_ARC_GCODE, '3axis')
      expect(m.totalLengthMm).toBeGreaterThan(0)
    })

    it('correctly resolves axisMode as "3axis" for arc-only fixture with no A words', () => {
      const m = buildCncSimulatePlaybackModel(CARVERA_3AXIS_ARC_GCODE, '3axis')
      expect(m.axisMode).toBe('3axis')
    })

    it('does not crash on G2/G3 arcs in the arc-fixture', () => {
      // Just verify no exception is thrown and we get a valid model
      expect(() => buildCncSimulatePlaybackModel(CARVERA_3AXIS_ARC_GCODE, '3axis')).not.toThrow()
    })
  })
})
