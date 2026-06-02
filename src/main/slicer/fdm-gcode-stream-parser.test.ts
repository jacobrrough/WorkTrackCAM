/**
 * fdm-gcode-stream-parser.test.ts — behavior tests for the streaming
 * per-layer slicer-breakdown parser (CAD V1.5).
 *
 * Per CLAUDE.md Safety Rule 6 ("Python engine changes need validation —
 * test with real meshes"), and more generally the project convention for
 * filesystem-touching helpers, each fixture writes a synthetic G-code
 * STRING to a real temp file (via `mkdtempSync` under the OS temp dir) and
 * runs the parser against that on-disk file. Temp dirs are cleaned up in
 * afterAll.
 *
 * Cases (mirrors the plan's test-strategy list):
 *   - empty file -> EMPTY result (zeros / nulls)
 *   - 3 layers BEFORE_LAYER_CHANGE only -> uniform fallback from header
 *   - header totals populate estTimeSec / estFilamentMm
 *   - ;LAYER_TIME: present -> REAL per-layer values (NOT uniform)
 *   - ;TYPE: present -> lineTypeCounts populated
 *   - CRLF line endings tolerated
 *   - ~1000-layer synthetic completes and counts correctly
 *   - bad path (ENOENT) rejects; null-byte path rejects cleanly
 *   - mixed real + missing per-layer time -> per-layer real kept, gaps
 *     backfilled from uniform share
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mapGcodeLineType,
  parseFdmGcodeLayersFromFile
} from './fdm-gcode-stream-parser'

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'wtc-fdm-breakdown-'))
let fileCounter = 0

/** Write `content` to a fresh temp .gcode file and return its absolute path. */
function writeGcode(content: string): string {
  const p = join(TMP_ROOT, `slice-${fileCounter++}.gcode`)
  writeFileSync(p, content, 'utf-8')
  return p
}

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true })
})

describe('mapGcodeLineType', () => {
  it('maps OrcaSlicer feature names to canonical FdmLineType', () => {
    expect(mapGcodeLineType('Outer wall')).toBe('Outer wall')
    expect(mapGcodeLineType('Inner wall')).toBe('Inner wall')
    expect(mapGcodeLineType('Sparse infill')).toBe('Sparse infill')
    expect(mapGcodeLineType('Internal solid infill')).toBe('Internal solid infill')
    expect(mapGcodeLineType('Support')).toBe('Support')
  })

  it('normalises PrusaSlicer synonyms', () => {
    expect(mapGcodeLineType('External perimeter')).toBe('Outer wall')
    expect(mapGcodeLineType('Perimeter')).toBe('Inner wall')
    expect(mapGcodeLineType('Solid infill')).toBe('Internal solid infill')
    expect(mapGcodeLineType('Top solid infill')).toBe('Top surface')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(mapGcodeLineType('  OUTER WALL  ')).toBe('Outer wall')
  })

  it('buckets unknown feature names under Other', () => {
    expect(mapGcodeLineType('Quux')).toBe('Other')
    expect(mapGcodeLineType('')).toBe('Other')
  })
})

describe('parseFdmGcodeLayersFromFile — empty / marker-less', () => {
  it('empty file -> zero layers, null totals', async () => {
    const result = await parseFdmGcodeLayersFromFile(writeGcode(''))
    expect(result.layers).toEqual([])
    expect(result.layerCount).toBe(0)
    expect(result.totalTimeSec).toBeNull()
    expect(result.totalFilamentMm).toBeNull()
  })

  it('whitespace-only file -> empty result', async () => {
    const result = await parseFdmGcodeLayersFromFile(writeGcode('\n  \n\t\n'))
    expect(result.layerCount).toBe(0)
  })

  it('CNC-ish G-code with no layer markers -> empty result', async () => {
    const gcode = ['G21 G90', 'G0 X10 Y10 Z5', 'G1 Z-1 F300', 'M30'].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(0)
  })
})

describe('parseFdmGcodeLayersFromFile — layer detection (BEFORE_LAYER_CHANGE)', () => {
  it('3 layers, no header -> three layers with null time/filament', async () => {
    const gcode = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0 Y0 E5',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      'G1 X10 Y10 E10',
      ';BEFORE_LAYER_CHANGE',
      ';0.60',
      'G1 X20 Y20 E15'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(3)
    expect(result.layers.map((l) => l.index)).toEqual([1, 2, 3])
    expect(result.layers.map((l) => l.zMm)).toEqual([0.2, 0.4, 0.6])
    // No header -> no per-layer time/filament.
    for (const l of result.layers) {
      expect(l.estTimeSec).toBeNull()
      expect(l.estFilamentMm).toBeNull()
      expect(l.lineTypeCounts).toBeNull()
    }
  })

  it('parses Z from the ;Z:<n> comment form too', async () => {
    const gcode = [';BEFORE_LAYER_CHANGE', ';Z:0.30', 'G1 X1 Y1 E1'].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(1)
    expect(result.layers[0]!.zMm).toBe(0.3)
  })

  it('handles the exact K2 before_layer_change_gcode sequence (;BEFORE_LAYER_CHANGE / ;[z] / G92 E0)', async () => {
    // Mirrors resources/orca-slicer/profiles/machines/creality-k2-plus.json
    // before_layer_change_gcode: ";BEFORE_LAYER_CHANGE\n;[layer_z]\nG92 E0\n".
    // The G92 E0 line must NOT be mis-counted as a motion move.
    const gcode = [
      ';BEFORE_LAYER_CHANGE',
      ';0.28',
      'G92 E0',
      ';TYPE:Outer wall',
      'G1 X0 Y0 E1 F9000',
      ';BEFORE_LAYER_CHANGE',
      ';0.48',
      'G92 E0',
      ';TYPE:Inner wall',
      'G1 X1 Y0 E1 F9000'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(2)
    expect(result.layers.map((l) => l.zMm)).toEqual([0.28, 0.48])
    // Only the G1 moves count — G92 is excluded.
    expect(result.layers[0]!.lineTypeCounts).toEqual({ 'Outer wall': 1 })
    expect(result.layers[1]!.lineTypeCounts).toEqual({ 'Inner wall': 1 })
  })
})

describe('parseFdmGcodeLayersFromFile — uniform fallback from header totals', () => {
  it('header time + filament distribute uniformly when no per-layer comments', async () => {
    const gcode = [
      '; estimated printing time (normal mode) = 30m',
      '; total filament used [mm] = 3000',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0 Y0 E5',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      'G1 X10 Y10 E10',
      ';BEFORE_LAYER_CHANGE',
      ';0.60',
      'G1 X20 Y20 E15'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(3)
    expect(result.totalTimeSec).toBe(1800) // 30m
    expect(result.totalFilamentMm).toBe(3000)
    // 1800s / 3 layers = 600s ; 3000mm / 3 = 1000mm — uniform on every layer.
    for (const l of result.layers) {
      expect(l.estTimeSec).toBe(600)
      expect(l.estFilamentMm).toBe(1000)
    }
  })

  it('parses an "1h 23m 4s" duration header', async () => {
    const gcode = [
      '; estimated printing time (normal mode) = 1h 23m 4s',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0 E1'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.totalTimeSec).toBe(3600 + 23 * 60 + 4)
    expect(result.layers[0]!.estTimeSec).toBe(3600 + 23 * 60 + 4) // 1 layer => all of it
  })
})

describe('parseFdmGcodeLayersFromFile — REAL per-layer values (;LAYER_TIME / ;LAYER_FILAMENT)', () => {
  it(';LAYER_TIME: produces real per-layer time, NOT the uniform share', async () => {
    const gcode = [
      '; estimated printing time (normal mode) = 30m',
      '; total filament used [mm] = 3000',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';LAYER_TIME:100',
      ';LAYER_FILAMENT:200',
      'G1 X0 Y0 E5',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      ';LAYER_TIME:700',
      ';LAYER_FILAMENT:2800',
      'G1 X10 Y10 E10'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(2)
    // Real per-layer values — uniform would be 900s/1500mm each.
    expect(result.layers[0]!.estTimeSec).toBe(100)
    expect(result.layers[0]!.estFilamentMm).toBe(200)
    expect(result.layers[1]!.estTimeSec).toBe(700)
    expect(result.layers[1]!.estFilamentMm).toBe(2800)
  })

  it('mixed real + missing per-layer time: real kept, gaps backfilled from uniform share', async () => {
    // 2 layers, header total 1000s. Layer 1 declares a real 100s; layer 2
    // has none -> backfilled to 1000/2 = 500s.
    const gcode = [
      '; estimated printing time (normal mode) = 1000s',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';LAYER_TIME:100',
      'G1 X0 E1',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      'G1 X1 E1'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layers[0]!.estTimeSec).toBe(100) // real
    expect(result.layers[1]!.estTimeSec).toBe(500) // 1000/2 uniform backfill
  })
})

describe('parseFdmGcodeLayersFromFile — line-type counts (;TYPE:)', () => {
  it('counts motion moves per active ;TYPE:', async () => {
    const gcode = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';TYPE:Outer wall',
      'G1 X0 Y0 E1',
      'G1 X1 Y0 E1',
      ';TYPE:Sparse infill',
      'G1 X2 Y0 E1',
      'G0 X3 Y0',
      'G1 X4 Y0 E1'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(1)
    const counts = result.layers[0]!.lineTypeCounts
    expect(counts).not.toBeNull()
    expect(counts!['Outer wall']).toBe(2)
    // Sparse infill: 2 G1 + 1 G0 = 3 motion moves while that type is active.
    expect(counts!['Sparse infill']).toBe(3)
  })

  it('lineTypeCounts stays null on layers with no ;TYPE: markers', async () => {
    const gcode = [';BEFORE_LAYER_CHANGE', ';0.20', 'G1 X0 E1'].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layers[0]!.lineTypeCounts).toBeNull()
  })

  it('active ;TYPE: resets at each new layer', async () => {
    const gcode = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';TYPE:Outer wall',
      'G1 X0 E1',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      // No ;TYPE: on layer 2 -> moves are NOT attributed to "Outer wall".
      'G1 X1 E1'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layers[0]!.lineTypeCounts).toEqual({ 'Outer wall': 1 })
    expect(result.layers[1]!.lineTypeCounts).toBeNull()
  })
})

describe('parseFdmGcodeLayersFromFile — peak feed-rate', () => {
  it('captures the max F word per layer (mm/min)', async () => {
    const gcode = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0 Y0 E1 F9000',
      'G1 X1 Y0 E1 F12000',
      'G1 X2 Y0 E1 F6000'
    ].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layers[0]!.maxSpeedMmMin).toBe(12000)
  })

  it('maxSpeedMmMin is null when no F word appears', async () => {
    const gcode = [';BEFORE_LAYER_CHANGE', ';0.20', 'G1 X0 E1'].join('\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layers[0]!.maxSpeedMmMin).toBeNull()
  })
})

describe('parseFdmGcodeLayersFromFile — line-ending tolerance', () => {
  it('handles CRLF (Windows-saved G-code)', async () => {
    const gcode = [
      '; estimated printing time (normal mode) = 10m',
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      'G1 X0 E1',
      ';BEFORE_LAYER_CHANGE',
      ';0.40',
      'G1 X1 E1'
    ].join('\r\n')
    const result = await parseFdmGcodeLayersFromFile(writeGcode(gcode))
    expect(result.layerCount).toBe(2)
    expect(result.layers.map((l) => l.zMm)).toEqual([0.2, 0.4])
    expect(result.totalTimeSec).toBe(600)
  })
})

describe('parseFdmGcodeLayersFromFile — scale', () => {
  it('~1000-layer synthetic completes and counts correctly', async () => {
    const lines: string[] = ['; estimated printing time (normal mode) = 1000s']
    const N = 1000
    for (let i = 0; i < N; i++) {
      const z = ((i + 1) * 0.2).toFixed(2)
      lines.push(';BEFORE_LAYER_CHANGE', `;${z}`, `G1 X${i % 50} Y0 E1 F9000`)
    }
    const result = await parseFdmGcodeLayersFromFile(writeGcode(lines.join('\n')))
    expect(result.layerCount).toBe(N)
    expect(result.layers[0]!.index).toBe(1)
    expect(result.layers[N - 1]!.index).toBe(N)
    // Uniform fallback: 1000s / 1000 layers = 1s each.
    expect(result.layers[0]!.estTimeSec).toBe(1)
    expect(result.layers[N - 1]!.maxSpeedMmMin).toBe(9000)
  })
})

describe('parseFdmGcodeLayersFromFile — error paths', () => {
  it('rejects a non-existent path (ENOENT)', async () => {
    const missing = join(TMP_ROOT, 'does-not-exist.gcode')
    await expect(parseFdmGcodeLayersFromFile(missing)).rejects.toThrow()
  })

  it('rejects a null-byte path cleanly (before any fs access)', async () => {
    await expect(parseFdmGcodeLayersFromFile('/tmp/evil\0.gcode')).rejects.toThrow(/null byte/i)
  })

  it('rejects an empty-string path', async () => {
    await expect(parseFdmGcodeLayersFromFile('')).rejects.toThrow(/non-empty/i)
  })
})
