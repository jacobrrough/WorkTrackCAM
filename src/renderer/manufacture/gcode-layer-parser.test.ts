/**
 * gcode-layer-parser.test.ts — unit tests for the FDM layer parser.
 *
 * Covers the OrcaSlicer K2 Plus dialect (the only FDM machine in My-
 * Shop scope per CLAUDE.md), plus legacy PrusaSlicer / Slic3r forms so
 * an unusual slicer config can't silently regress the Preview stage.
 */
import { describe, expect, it } from 'vitest'
import {
  formatDurationShort,
  formatFilamentMm,
  parseDurationToSeconds,
  parseLayers,
  parseTotalEstimates
} from './gcode-layer-parser'

// ─── Empty / degenerate input ────────────────────────────────────────────────
describe('parseLayers — empty / degenerate input', () => {
  it('returns [] for the empty string', () => {
    expect(parseLayers('')).toEqual([])
  })

  it('returns [] for whitespace-only input', () => {
    expect(parseLayers('   \n  \r\n  ')).toEqual([])
  })

  it('returns [] when no layer markers are present (CNC G-code)', () => {
    const cnc = ['G21', 'G90', 'G0 X0 Y0 Z5', 'G1 Z-1 F300', 'G1 X10', 'M30'].join('\n')
    expect(parseLayers(cnc)).toEqual([])
  })

  it('returns [] for comment-only headers without layer markers', () => {
    const header = ['; estimated printing time = 1h 23m', '; total filament used [mm] = 1234'].join(
      '\n'
    )
    expect(parseLayers(header)).toEqual([])
  })
})

// ─── OrcaSlicer K2 Plus dialect ─────────────────────────────────────────────
describe('parseLayers — OrcaSlicer K2 Plus dialect', () => {
  it('parses the K2 Plus BEFORE_LAYER_CHANGE form', () => {
    const text = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0 Y0',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      'G1 X10 Y10',
      ';BEFORE_LAYER_CHANGE',
      ';0.60'
    ].join('\n')
    const layers = parseLayers(text)
    expect(layers.length).toBe(3)
    expect(layers[0]).toMatchObject({ index: 1, zMm: 0.2 })
    expect(layers[1]).toMatchObject({ index: 2, zMm: 0.4 })
    expect(layers[2]).toMatchObject({ index: 3, zMm: 0.6 })
  })

  it('parses the K2 Plus AFTER_LAYER_CHANGE form', () => {
    const text = [
      ';AFTER_LAYER_CHANGE',
      ';0.20',
      'G1 X0 Y0',
      ';AFTER_LAYER_CHANGE',
      ';0.40'
    ].join('\n')
    expect(parseLayers(text).map((l) => l.zMm)).toEqual([0.2, 0.4])
  })

  it('deduplicates Z values when both BEFORE and AFTER markers fire', () => {
    const text = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0',
      ';AFTER_LAYER_CHANGE',
      ';0.20',
      ';BEFORE_LAYER_CHANGE',
      ';0.40'
    ].join('\n')
    const layers = parseLayers(text)
    expect(layers.length).toBe(2)
    expect(layers.map((l) => l.zMm)).toEqual([0.2, 0.4])
  })

  it('sorts layers by Z even when the slicer emits them out of order', () => {
    const text = [
      ';BEFORE_LAYER_CHANGE',
      ';0.60',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';BEFORE_LAYER_CHANGE',
      ';0.40'
    ].join('\n')
    expect(parseLayers(text).map((l) => l.zMm)).toEqual([0.2, 0.4, 0.6])
  })
})

// ─── Legacy slicer dialects ─────────────────────────────────────────────────
describe('parseLayers — legacy PrusaSlicer / Slic3r dialects', () => {
  it('parses the PrusaSlicer LAYER_CHANGE + Z: form', () => {
    const text = [
      ';LAYER_CHANGE',
      ';Z:0.20',
      'G1 X0',
      ';LAYER_CHANGE',
      ';Z:0.40',
      'G1 X1'
    ].join('\n')
    expect(parseLayers(text).map((l) => l.zMm)).toEqual([0.2, 0.4])
  })

  it('parses the Cura-style ;LAYER: form when followed by a Z height', () => {
    const text = [';LAYER:0', ';0.20', ';LAYER:1', ';0.40'].join('\n')
    expect(parseLayers(text).map((l) => l.zMm)).toEqual([0.2, 0.4])
  })

  it('parses the legacy Slic3r single-line "; layer 1, Z = 0.20" form', () => {
    const text = ['; layer 1, Z = 0.20', 'G1 X0', '; layer 2, Z = 0.40', 'G1 X1'].join('\n')
    expect(parseLayers(text).map((l) => l.zMm)).toEqual([0.2, 0.4])
  })
})

// ─── Time + filament estimates ──────────────────────────────────────────────
describe('parseLayers — per-layer estimates', () => {
  it('distributes total printing time uniformly across layers', () => {
    const text = [
      '; estimated printing time (normal mode) = 1h 0m 0s',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';BEFORE_LAYER_CHANGE',
      ';0.40'
    ].join('\n')
    const layers = parseLayers(text)
    expect(layers.length).toBe(2)
    // 3600s / 2 = 1800s per layer
    expect(layers[0]!.estTimeSec).toBeCloseTo(1800, 1)
    expect(layers[1]!.estTimeSec).toBeCloseTo(1800, 1)
  })

  it('distributes total filament uniformly across layers', () => {
    const text = [
      '; total filament used [mm] = 1000',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      ';BEFORE_LAYER_CHANGE',
      ';0.60',
      ';BEFORE_LAYER_CHANGE',
      ';0.80'
    ].join('\n')
    const layers = parseLayers(text)
    expect(layers.length).toBe(4)
    expect(layers[0]!.estFilamentMm).toBeCloseTo(250, 1)
    expect(layers[3]!.estFilamentMm).toBeCloseTo(250, 1)
  })

  it('returns null estimates when no header info is present', () => {
    const text = [';BEFORE_LAYER_CHANGE', ';0.20', ';BEFORE_LAYER_CHANGE', ';0.40'].join('\n')
    const layers = parseLayers(text)
    expect(layers[0]!.estTimeSec).toBeNull()
    expect(layers[0]!.estFilamentMm).toBeNull()
  })
})

// ─── parseTotalEstimates standalone ─────────────────────────────────────────
describe('parseTotalEstimates', () => {
  it('returns nulls for empty input', () => {
    expect(parseTotalEstimates('')).toEqual({
      totalTimeSec: null,
      totalFilamentMm: null,
      totalFilamentG: null
    })
  })

  it('parses OrcaSlicer combined headers', () => {
    const text = [
      '; estimated printing time (normal mode) = 1h 23m 4s',
      '; total filament used [mm] = 1234.5',
      '; total filament used [g] = 14.5'
    ].join('\n')
    const t = parseTotalEstimates(text)
    expect(t.totalTimeSec).toBeCloseTo(3600 + 23 * 60 + 4, 0)
    expect(t.totalFilamentMm).toBeCloseTo(1234.5, 2)
    expect(t.totalFilamentG).toBeCloseTo(14.5, 2)
  })

  it('falls back to ;TIME: when no estimated-printing-time header is present', () => {
    expect(parseTotalEstimates(';TIME:1500').totalTimeSec).toBe(1500)
  })

  it('parses the Cura-style ";Filament used: 1.234m" header as mm', () => {
    const t = parseTotalEstimates(';Filament used: 1.234m')
    expect(t.totalFilamentMm).toBeCloseTo(1234, 1)
  })
})

// ─── parseDurationToSeconds ─────────────────────────────────────────────────
describe('parseDurationToSeconds', () => {
  it('parses "1h 23m 4s" forms', () => {
    expect(parseDurationToSeconds('1h 23m 4s')).toBe(3600 + 23 * 60 + 4)
  })

  it('parses unspaced "1h23m4s" forms', () => {
    expect(parseDurationToSeconds('1h23m4s')).toBe(3600 + 23 * 60 + 4)
  })

  it('parses a bare numeric string as seconds', () => {
    expect(parseDurationToSeconds('300')).toBe(300)
    expect(parseDurationToSeconds('1500.5')).toBe(1500.5)
  })

  it('returns null for empty / garbage input', () => {
    expect(parseDurationToSeconds('')).toBeNull()
    expect(parseDurationToSeconds('abc')).toBeNull()
    expect(parseDurationToSeconds('  ')).toBeNull()
  })
})

// ─── Formatters ─────────────────────────────────────────────────────────────
describe('formatDurationShort', () => {
  it('formats null / negative / NaN as em-dash', () => {
    expect(formatDurationShort(null)).toBe('—')
    expect(formatDurationShort(-1)).toBe('—')
    expect(formatDurationShort(Number.NaN)).toBe('—')
  })

  it('formats < 1m as "Ns"', () => {
    expect(formatDurationShort(0)).toBe('0s')
    expect(formatDurationShort(30)).toBe('30s')
  })

  it('formats >= 1m as "Nm Ns"', () => {
    expect(formatDurationShort(90)).toBe('1m 30s')
  })

  it('formats >= 1h as "Nh Nm"', () => {
    expect(formatDurationShort(3660)).toBe('1h 1m')
  })
})

describe('formatFilamentMm', () => {
  it('formats null / negative as em-dash', () => {
    expect(formatFilamentMm(null)).toBe('—')
    expect(formatFilamentMm(-1)).toBe('—')
  })

  it('formats sub-metre as "N.N mm"', () => {
    expect(formatFilamentMm(123.45)).toBe('123.5 mm')
  })

  it('formats metre+ as "N.NN m"', () => {
    expect(formatFilamentMm(1234.5)).toBe('1.23 m')
  })
})

// ─── Layer-count contract ───────────────────────────────────────────────────
describe('parseLayers — layer-count contract', () => {
  it('handles a 100-layer K2 Plus slice without slowdown', () => {
    const layers: string[] = []
    layers.push('; estimated printing time (normal mode) = 50m')
    layers.push('; total filament used [mm] = 5000')
    for (let i = 1; i <= 100; i++) {
      layers.push(';BEFORE_LAYER_CHANGE')
      layers.push(`;${(i * 0.2).toFixed(2)}`)
      layers.push(`G1 X${i} Y${i}`)
    }
    const result = parseLayers(layers.join('\n'))
    expect(result.length).toBe(100)
    expect(result[0]!.index).toBe(1)
    expect(result[99]!.index).toBe(100)
    expect(result[99]!.zMm).toBeCloseTo(20, 1)
    // Per-layer time should be 30s (3000s / 100)
    expect(result[0]!.estTimeSec).toBeCloseTo(30, 1)
  })
})
