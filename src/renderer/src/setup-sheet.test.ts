import { describe, expect, it } from 'vitest'
import {
  parseGcodeStats,
  buildSetupSheetJobFromManufacture,
  generateSetupSheet,
  type SetupSheetJob
} from './setup-sheet'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'

/**
 * Cycle 92 test-coverage paired-pin contract set for src/renderer/src/setup-sheet.ts
 * (renderer setup-sheet generator: parseGcodeStats + buildSetupSheetJobFromManufacture
 * + generateSetupSheet).
 *
 * Machines covered: all three (CLAUDE.md "USER CONTEXT -- TARGET MACHINES"):
 *   1. Creality K2 Plus (FDM, Klipper/Moonraker) -- via FDM-style G-code samples below
 *   2. Laguna Swift 5x10 (CNC router, RichAuto A-series) -- via 3-axis cutting samples
 *   3. Makera Carvera + 4th Axis Rotary -- via rotary-setup detection in
 *      buildSetupSheetJobFromManufacture
 *
 * Pure additive: zero production-code edits. The contract pins:
 *   - parseGcodeStats: line-count, motion-vs-cutting classification, XY/Z bounds,
 *     feed-rate-derived time estimate, robustness to comments/blanks/case.
 *   - buildSetupSheetJobFromManufacture: stock-default fallback, axisMode-driven
 *     rotary-setup synthesis, operation pass-through.
 *   - generateSetupSheet: HTML-shape essentials (DOCTYPE, page wrapper, machine
 *     badge fallback, escape semantics on job name, optional rotary section).
 */

describe('parseGcodeStats -- empty / degenerate input', () => {
  it('handles empty string with zero motion + null bounds', () => {
    const s = parseGcodeStats('')
    expect(s.totalLines).toBe(1) // ''.split(/\r?\n/) === ['']
    expect(s.motionLines).toBe(0)
    expect(s.cuttingMoves).toBe(0)
    expect(s.xyBounds).toBeNull()
    expect(s.zRange).toBeNull()
    // Implementation: totalFeedDist=0, totalFeedRate default=1200 -> 0/1200*60 = 0 (not undefined).
    expect(s.estimatedTimeSec).toBe(0)
  })

  it('treats comment-only / blank lines as non-motion', () => {
    const s = parseGcodeStats(['; header', '', '   ', '; another comment', ''].join('\n'))
    expect(s.motionLines).toBe(0)
    expect(s.cuttingMoves).toBe(0)
    expect(s.xyBounds).toBeNull()
    expect(s.zRange).toBeNull()
  })

  it('ignores non-G0/G1 motion (G2/G3/Mxx do not increment counts)', () => {
    const s = parseGcodeStats(['G2 X10 Y10 I5 J0', 'M3 S10000', 'G4 P1.0'].join('\n'))
    expect(s.motionLines).toBe(0)
    expect(s.cuttingMoves).toBe(0)
  })
})

describe('parseGcodeStats -- motion + cutting classification', () => {
  it('counts G0 as motion but not cutting', () => {
    const s = parseGcodeStats(['G0 Z5', 'G0 X0 Y0', 'G0 Z-1'].join('\n'))
    expect(s.motionLines).toBe(3)
    expect(s.cuttingMoves).toBe(0) // G0 never counts as cutting
  })

  it('counts G1 below Z=0 as cutting; above Z=0 as motion-only', () => {
    // First line: cutting (z=-1 < 0). Second: above zero (z=2 > 0) -> motion only.
    const text = ['G0 X0 Y0 Z5', 'G1 Z-1 F300', 'G1 X10 Y0 F600', 'G1 Z2 F300'].join('\n')
    const s = parseGcodeStats(text)
    expect(s.motionLines).toBe(4) // G0 + 3 G1
    expect(s.cuttingMoves).toBe(2) // G1 Z-1 (z<0) + G1 X10 Y0 (current z still -1<0); G1 Z2 above 0
  })

  it('accepts G00 / G01 long forms identically to G0 / G1', () => {
    const s = parseGcodeStats(['G00 Z5', 'G01 X10 Z-1 F1000'].join('\n'))
    expect(s.motionLines).toBe(2)
    expect(s.cuttingMoves).toBe(1)
  })

  it('case-insensitive: lowercase g1 still counted', () => {
    const s = parseGcodeStats(['g0 z5', 'g1 x10 z-1 f1000'].join('\n'))
    expect(s.motionLines).toBe(2)
    expect(s.cuttingMoves).toBe(1)
  })

  it('trailing inline comments after `;` are stripped before motion parse', () => {
    const s = parseGcodeStats(['G1 X10 Z-1 F500 ; cutting move'].join('\n'))
    expect(s.motionLines).toBe(1)
    expect(s.cuttingMoves).toBe(1)
    // Implementation tracks ENDPOINT positions only -- the implicit (0,0,0) origin
    // is never added to bounds. A single segment to (10,0,0) yields minX=maxX=10.
    expect(s.xyBounds).toEqual({ minX: 10, maxX: 10, minY: 0, maxY: 0 })
  })
})

describe('parseGcodeStats -- bounds + feed rate', () => {
  it('tracks min/max XY across all motion (G0 and G1)', () => {
    const text = [
      'G0 X-10 Y-5 Z5',
      'G1 X20 Y15 Z-1 F500',
      'G1 X0 Y30 F500'
    ].join('\n')
    const s = parseGcodeStats(text)
    expect(s.xyBounds).toEqual({ minX: -10, maxX: 20, minY: -5, maxY: 30 })
  })

  it('tracks Z range top/bottom across motion', () => {
    const text = ['G0 Z10', 'G1 Z-5 F300', 'G1 Z-12 F300', 'G0 Z2'].join('\n')
    const s = parseGcodeStats(text)
    expect(s.zRange).toEqual({ topZ: 10, bottomZ: -12 })
  })

  it('derives estimatedTimeSec from cutting feed distance / last-seen F (mm/min -> sec)', () => {
    // Single cutting segment of length 10mm at F=600 mm/min -> 10/600 min = 1 sec
    const text = ['G0 X0 Y0 Z-1', 'G1 X10 Y0 F600'].join('\n')
    const s = parseGcodeStats(text)
    expect(s.estimatedTimeSec).toBeDefined()
    if (s.estimatedTimeSec !== undefined) {
      expect(s.estimatedTimeSec).toBeCloseTo(1.0, 5)
    }
  })

  it('cutting distance excludes G0 and Z>=0 segments', () => {
    // G0 5mm + G1 above zero 5mm + G1 cutting 10mm @ F=600 = 1 sec
    const text = [
      'G0 X0 Y0 Z5',
      'G0 X5 Y0 Z5',
      'G1 X5 Y5 Z2 F600', // z=2 above zero -- not counted as cutting
      'G1 X5 Y5 Z-1 F600', // plunge -- distance counted (Z transitions to <0)
      'G1 X15 Y5 Z-1 F600' // 10mm cutting at z=-1
    ].join('\n')
    const s = parseGcodeStats(text)
    expect(s.cuttingMoves).toBeGreaterThanOrEqual(2)
    // Cutting feed distance >= 10 (the long horizontal cut) but capped by the
    // feed at last F (600 mm/min). The plunge adds 3mm distance (z 2 -> -1).
    // Exact total: sqrt(0+0+9) + sqrt(100+0+0) = 3 + 10 = 13 mm at F=600
    // -> 13/600*60 = 1.3 s
    expect(s.estimatedTimeSec).toBeCloseTo(1.3, 5)
  })
})

describe('parseGcodeStats -- per-machine sample shapes', () => {
  it('Creality K2 Plus (FDM) sample: counts extrusion travel as G1 motion', () => {
    // K2 Klipper FDM: typical print line uses G1 X.. Y.. E.. F<feed>
    // The Z stays positive -- nothing counts as "cutting" -- but motion + bounds populate.
    const text = [
      ';TYPE:WALL-INNER',
      'G1 F2400 E-0.8',
      'G1 Z0.2',
      'G1 X10 Y10 E0.5 F3000',
      'G1 X20 Y20 E1.0',
      'G1 X20 Y10 E1.5'
    ].join('\n')
    const s = parseGcodeStats(text)
    expect(s.motionLines).toBe(5)
    expect(s.cuttingMoves).toBe(0) // FDM never goes below Z=0
    expect(s.xyBounds).toEqual({ minX: 0, maxX: 20, minY: 0, maxY: 20 })
    expect(s.zRange).toEqual({ topZ: 0.2, bottomZ: 0 })
  })

  it('Laguna Swift 5x10 (RichAuto A-series) sample: counts subtractive cuts', () => {
    // Full-sheet plywood pocket: G21 G90 preamble + cutting at z=-3 mm.
    const text = [
      'G21',
      'G90',
      'G17',
      'M3 S18000',
      'G0 X0 Y0 Z10',
      'G0 Z2',
      'G1 Z-3 F300',
      'G1 X1219 Y0 F4500', // 4 ft along X
      'G1 X1219 Y2438 F4500', // 8 ft up
      'G1 X0 Y2438 F4500',
      'G1 X0 Y0 F4500',
      'G0 Z10',
      'M5',
      'M30'
    ].join('\n')
    const s = parseGcodeStats(text)
    expect(s.motionLines).toBe(8) // 2x G0 preamble + plunge + 4 cutting + final retract
    expect(s.cuttingMoves).toBeGreaterThanOrEqual(4) // perimeter
    expect(s.xyBounds).toEqual({ minX: 0, maxX: 1219, minY: 0, maxY: 2438 })
    expect(s.zRange).toEqual({ topZ: 10, bottomZ: -3 })
    // Distance: plunge 5 (z2->-3) + 1219 + 2438 + 1219 + 2438 = 7319 mm at F=4500
    // -> 7319 / 4500 * 60 = 97.59 sec
    expect(s.estimatedTimeSec).toBeDefined()
    if (s.estimatedTimeSec !== undefined) {
      expect(s.estimatedTimeSec).toBeGreaterThan(90)
      expect(s.estimatedTimeSec).toBeLessThan(110)
    }
  })

  it('Makera Carvera + 4th Axis sample: counts XY+Z motion (A-axis ignored by 3-axis stats)', () => {
    // 4-axis rotary path. The parser is XYZ-only; A-words are ignored, which is
    // the documented behavior (see GcodeStats type -- no rotary axis field).
    const text = [
      'G21',
      'G90',
      'M3 S15000',
      'G0 X0 Y0 Z5',
      'G1 Z-0.5 F100',
      'G1 X20 A45 F600', // 4-axis simultaneous: motion + rotary
      'G1 X40 A90 F600',
      'G0 Z5',
      'M5'
    ].join('\n')
    const s = parseGcodeStats(text)
    expect(s.motionLines).toBe(5)
    expect(s.cuttingMoves).toBe(3) // plunge + 2 horizontal cuts at z=-0.5
    expect(s.xyBounds).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 0 })
    expect(s.zRange).toEqual({ topZ: 5, bottomZ: -0.5 })
  })
})

describe('buildSetupSheetJobFromManufacture -- defaults + setup resolution', () => {
  it('falls back to default 100x100x20 stock when setups are empty', () => {
    const mfg: ManufactureFile = { version: 1, setups: [], operations: [] }
    const job = buildSetupSheetJobFromManufacture({
      projectName: 'Test Project',
      mfg,
      camMachineId: undefined,
      gcodePath: null,
      sourceStlPath: null
    })
    expect(job.name).toBe('Test Project')
    expect(job.machineId).toBeNull()
    expect(job.stock).toEqual({ x: 100, y: 100, z: 20 })
    expect(job.rotarySetup).toBeUndefined()
    expect(job.operations).toEqual([])
  })

  it('resolves stock from box-shaped setup when valid', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'main',
          machineId: 'laguna_swift_5x10',
          stock: { kind: 'box', x: 1219, y: 2438, z: 19 }
        }
      ],
      operations: []
    }
    const job = buildSetupSheetJobFromManufacture({
      projectName: 'Sheet Job',
      mfg,
      camMachineId: 'laguna_swift_5x10',
      gcodePath: null,
      sourceStlPath: null
    })
    expect(job.machineId).toBe('laguna_swift_5x10')
    expect(job.stock).toEqual({ x: 1219, y: 2438, z: 19 })
    expect(job.rotarySetup).toBeUndefined() // 3-axis -- no rotary
  })

  it('synthesizes rotarySetup when axisMode === 4axis with positive X+Y', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'rotary',
          machineId: 'makera_carvera_4axis',
          axisMode: '4axis',
          stock: { kind: 'cylinder', x: 200, y: 50, z: 50 }
        }
      ],
      operations: []
    }
    const job = buildSetupSheetJobFromManufacture({
      projectName: 'Rotary Job',
      mfg,
      camMachineId: 'makera_carvera_4axis',
      gcodePath: null,
      sourceStlPath: null
    })
    expect(job.machineId).toBe('makera_carvera_4axis')
    expect(job.rotarySetup).toBeDefined()
    expect(job.rotarySetup?.cylinderLengthMm).toBe(200)
    expect(job.rotarySetup?.cylinderDiameterMm).toBe(50)
    expect(job.rotarySetup?.chuckDepthMm).toBe(5) // hardcoded default per impl
    expect(job.rotarySetup?.clampOffsetMm).toBe(0)
  })

  it('omits rotarySetup when axisMode === 4axis but stock dims are missing/zero', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'rotary',
          machineId: 'makera_carvera_4axis',
          axisMode: '4axis',
          // No stock at all -> no rotary synthesis
        }
      ],
      operations: []
    }
    const job = buildSetupSheetJobFromManufacture({
      projectName: 'Rotary Job',
      mfg,
      camMachineId: 'makera_carvera_4axis',
      gcodePath: null,
      sourceStlPath: null
    })
    expect(job.rotarySetup).toBeUndefined()
  })

  it('passes through operations preserving id/kind/label/params', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'main',
          machineId: 'makera_carvera_4axis',
          stock: { kind: 'box', x: 100, y: 100, z: 20 }
        }
      ],
      operations: [
        {
          id: 'op1',
          kind: 'cnc_pocket',
          label: 'Pocket',
          params: { toolDiameterMm: 6, feedMmMin: 1500, zPassMm: -2 }
        },
        {
          id: 'op2',
          kind: 'cnc_4axis_finishing',
          label: 'Rotary finish',
          params: { finishStepoverDeg: 1, toolDiameterMm: 3 }
        }
      ]
    }
    const job = buildSetupSheetJobFromManufacture({
      projectName: 'Multi-op',
      mfg,
      camMachineId: 'makera_carvera_4axis',
      gcodePath: '/tmp/cam.nc',
      sourceStlPath: '/tmp/part.stl'
    })
    expect(job.gcodeOut).toBe('/tmp/cam.nc')
    expect(job.stlPath).toBe('/tmp/part.stl')
    expect(job.operations).toHaveLength(2)
    expect(job.operations[0]).toEqual({
      id: 'op1',
      kind: 'cnc_pocket',
      label: 'Pocket',
      params: { toolDiameterMm: 6, feedMmMin: 1500, zPassMm: -2 }
    })
    expect(job.operations[1]?.kind).toBe('cnc_4axis_finishing')
  })

  it('falls back to first setup when camMachineId does not match any setup', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'first',
          machineId: 'k2_plus',
          stock: { kind: 'box', x: 350, y: 350, z: 350 }
        },
        {
          id: 's2',
          label: 'second',
          machineId: 'laguna_swift_5x10',
          stock: { kind: 'box', x: 1219, y: 2438, z: 19 }
        }
      ],
      operations: []
    }
    const job = buildSetupSheetJobFromManufacture({
      projectName: 'No-match',
      mfg,
      camMachineId: 'unknown_machine',
      gcodePath: null,
      sourceStlPath: null
    })
    // Per resolveManufactureSetupForCam: when no match, returns first setup.
    expect(job.machineId).toBe('k2_plus')
    expect(job.stock).toEqual({ x: 350, y: 350, z: 350 })
  })
})

describe('generateSetupSheet -- HTML shape essentials', () => {
  const baseJob: SetupSheetJob = {
    name: 'Demo Job',
    stlPath: '/parts/demo.stl',
    machineId: 'laguna_swift_5x10',
    materialId: null,
    stock: { x: 1219, y: 2438, z: 19 },
    operations: [
      {
        id: 'op1',
        kind: 'cnc_pocket',
        label: 'Pocket cut',
        params: {
          toolDiameterMm: 6,
          feedMmMin: 4500,
          plungeMmMin: 800,
          zPassMm: -3,
          stepoverMm: 3,
          safeZMm: 12
        }
      }
    ],
    gcodeOut: '/parts/demo.nc'
  }

  it('emits a valid HTML document skeleton with DOCTYPE + page wrapper', () => {
    const html = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      generatedAt: new Date('2026-04-26T12:00:00Z')
    })
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<div class="page">')
    expect(html).toContain('</html>')
  })

  it('falls back to "Unknown Machine" badge when machine is null', () => {
    const html = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Unknown Machine')
  })

  it('renders machine name in badge when machine is provided', () => {
    // Minimal valid MachineProfile per src/shared/machine-schema.ts: requires
    // id, name, kind ('fdm'|'cnc'), workAreaMm, maxFeedMmMin, postTemplate, dialect.
    const machine: MachineProfile = {
      id: 'laguna_swift_5x10',
      name: 'Laguna Swift 5x10',
      kind: 'cnc',
      workAreaMm: { x: 1524, y: 3048, z: 200 },
      maxFeedMmMin: 18000,
      postTemplate: 'vcarve_mach3.hbs',
      dialect: 'mach3'
    }
    const html = generateSetupSheet({
      job: baseJob,
      machine,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Laguna Swift 5x10')
    expect(html).toContain('vcarve_mach3.hbs')
  })

  it('renders rotary stock section only when job.rotarySetup is defined', () => {
    const withRotary: SetupSheetJob = {
      ...baseJob,
      rotarySetup: {
        cylinderDiameterMm: 50,
        cylinderLengthMm: 200,
        chuckDepthMm: 5,
        clampOffsetMm: 2
      }
    }
    const htmlWith = generateSetupSheet({
      job: withRotary,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(htmlWith).toContain('Rotary stock (session)')
    expect(htmlWith).toContain('Cylinder Ø')

    const htmlWithout = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(htmlWithout).not.toContain('Rotary stock (session)')
  })

  it('escapes HTML metacharacters in the gcode excerpt', () => {
    const dangerous = '<script>alert("xss")</script>\nG0 Z5'
    const html = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: dangerous
    })
    // The excerpt section appears
    expect(html).toContain('G-code excerpt')
    // The script tag is escaped, not raw
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
  })

  it('omits gcode excerpt section when gcodeText is null/undefined/empty', () => {
    const htmlNull = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: null
    })
    expect(htmlNull).not.toContain('G-code excerpt')

    const htmlEmpty = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: '   \n  '
    })
    expect(htmlEmpty).not.toContain('G-code excerpt')
  })

  it('emits stats section only when gcodeStats is non-null and includes rough-time disclaimer', () => {
    const html = generateSetupSheet({
      job: baseJob,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: {
        totalLines: 1234,
        motionLines: 800,
        cuttingMoves: 600,
        xyBounds: { minX: 0, maxX: 1000, minY: 0, maxY: 500 },
        zRange: { topZ: 10, bottomZ: -5 },
        estimatedTimeSec: 600
      }
    })
    expect(html).toContain('G-code Statistics')
    expect(html).toContain('1,234') // totalLines locale-formatted
    expect(html).toContain('rough lower bound')
    expect(html).toContain('10m 0s') // 600 sec -> "10m 0s"
  })
})
