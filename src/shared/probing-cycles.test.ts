import { describe, expect, it } from 'vitest'
import {
  generateProbeCycle,
  generateSingleSurfaceProbe,
  generateBoreCenterProbe,
  generateBossCenterProbe,
  generateCornerFindProbe,
  generateToolLengthProbe,
} from './probing-cycles'
import type {
  SingleSurfaceParams,
  BoreCenterParams,
  BossCenterParams,
  CornerFindParams,
  ToolLengthParams,
} from './probing-cycles'

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Find the last index matching a predicate (compatible with ES2020 target). */
function findLastIdx(arr: string[], predicate: (s: string) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i
  }
  return -1
}

/** Extract non-comment, non-blank G-code lines. */
function gcodeLines(output: string): string[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(';'))
}

/** Check that every G38.2 probe move is preceded by a retract (G91 G0 Z... / G90). */
function assertRetractBeforeEveryProbe(output: string): void {
  const lines = output.split('\n').map((l) => l.trim())
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('G38.2')) {
      // Walk backward past blank and comment lines to find the retract
      let j = i - 1
      while (j >= 0 && (lines[j]!.length === 0 || lines[j]!.startsWith(';'))) j--
      // Must find G90 (end of incremental retract) within the last few non-blank lines
      let foundRetract = false
      let k = j
      // Look back up to 4 non-blank code lines for the G91 G0 Z... / G90 pair
      let checked = 0
      while (k >= 0 && checked < 6) {
        const line = lines[k]!
        if (line.length > 0 && !line.startsWith(';')) {
          if (line === 'G90' || line.startsWith('G91 G0 Z')) {
            foundRetract = true
            break
          }
          checked++
        }
        k--
      }
      expect(foundRetract, `G38.2 on line ${i + 1} must be preceded by a safety retract`).toBe(true)
    }
  }
}

/** Check that G10 L2 P<n> appears with valid P value (1-6). */
function assertValidG10L2(output: string, expectedP: number): void {
  const pattern = new RegExp(`G10 L2 P${expectedP}`)
  expect(output).toMatch(pattern)
}

// ── Default params for testing ──────────────────────────────────────────────────

const singleSurfaceDefaults: SingleSurfaceParams = {
  axis: 'x',
  direction: -1,
  maxTravelMm: 25,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const boreCenterDefaults: BoreCenterParams = {
  approxDiameterMm: 50,
  probeDepthMm: 10,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const bossCenterDefaults: BossCenterParams = {
  approxWidthMm: 40,
  probeHeightMm: 5,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const cornerFindDefaults: CornerFindParams = {
  maxTravelXMm: 30,
  maxTravelYMm: 30,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const toolLengthDefaults: ToolLengthParams = {
  maxTravelMm: 100,
  probeFeedMmMin: 50,
  retractMm: 5,
  wcsIndex: 1,
}

// ── Single Surface Probe ────────────────────────────────────────────────────────

describe('generateSingleSurfaceProbe', () => {
  it('generates G38.2 probe move along the specified axis and direction', () => {
    const gcode = generateSingleSurfaceProbe(singleSurfaceDefaults)
    // axis=x, direction=-1, maxTravel=25 -> G38.2 X-25
    expect(gcode).toContain('G38.2 X-25 F100')
  })

  it('positive direction emits positive travel', () => {
    const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, axis: 'y', direction: 1, maxTravelMm: 15 })
    expect(gcode).toContain('G38.2 Y15 F100')
  })

  it('Z axis probe works correctly', () => {
    const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, axis: 'z', direction: -1, maxTravelMm: 50 })
    expect(gcode).toContain('G38.2 Z-50 F100')
  })

  it('sets WCS offset with G10 L2 for the correct axis and WCS index', () => {
    const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, wcsIndex: 3 })
    assertValidG10L2(gcode, 3)
    expect(gcode).toContain('X[#5061]')
  })

  it('Y axis uses #5062 variable', () => {
    const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, axis: 'y' })
    expect(gcode).toContain('Y[#5062]')
  })

  it('Z axis uses #5063 variable', () => {
    const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, axis: 'z' })
    expect(gcode).toContain('Z[#5063]')
  })

  it('includes safety retract before and after probe move', () => {
    const gcode = generateSingleSurfaceProbe(singleSurfaceDefaults)
    assertRetractBeforeEveryProbe(gcode)
    // Also check retract after the probe sequence
    const lines = gcode.split('\n')
    const lastRetractIdx = findLastIdx(lines, (l) => l.trim().startsWith('G91 G0 Z'))
    const probeIdx = findLastIdx(lines, (l) => l.trim().startsWith('G38.2'))
    expect(lastRetractIdx).toBeGreaterThan(probeIdx)
  })

  it('includes expected position in comment when provided', () => {
    const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, expectedPositionMm: 12.5 })
    expect(gcode).toContain('12.5')
  })

  it('WCS P1 through P6 are all valid', () => {
    for (let wcs = 1; wcs <= 6; wcs++) {
      const gcode = generateSingleSurfaceProbe({ ...singleSurfaceDefaults, wcsIndex: wcs })
      assertValidG10L2(gcode, wcs)
    }
  })
})

// ── Bore Center Probe ───────────────────────────────────────────────────────────

describe('generateBoreCenterProbe', () => {
  it('generates 4 G38.2 probe moves (4 walls: +X, -X, +Y, -Y)', () => {
    const gcode = generateBoreCenterProbe(boreCenterDefaults)
    const probeLines = gcodeLines(gcode).filter((l) => l.startsWith('G38.2'))
    expect(probeLines.length).toBe(4)
  })

  it('probes X and Y axes using half-diameter travel', () => {
    const gcode = generateBoreCenterProbe(boreCenterDefaults)
    // approxDiameterMm=50 -> half=25
    expect(gcode).toContain('G38.2 X25')
    expect(gcode).toContain('G38.2 X-25')
    expect(gcode).toContain('G38.2 Y25')
    expect(gcode).toContain('G38.2 Y-25')
  })

  it('computes center from 4 wall contacts and sets WCS XY', () => {
    const gcode = generateBoreCenterProbe(boreCenterDefaults)
    // Stores in #100-#103, computes center in #104, #105
    expect(gcode).toContain('#100 = #5061')
    expect(gcode).toContain('#101 = #5061')
    expect(gcode).toContain('#102 = #5062')
    expect(gcode).toContain('#103 = #5062')
    expect(gcode).toContain('#104 = [#100 + #101] / 2')
    expect(gcode).toContain('#105 = [#102 + #103] / 2')
  })

  it('sets WCS XY offset with G10 L2', () => {
    const gcode = generateBoreCenterProbe(boreCenterDefaults)
    assertValidG10L2(gcode, 1)
    expect(gcode).toContain('X[#104] Y[#105]')
  })

  it('safety retract before every probe move', () => {
    const gcode = generateBoreCenterProbe(boreCenterDefaults)
    assertRetractBeforeEveryProbe(gcode)
  })

  it('descends to probe depth before probing', () => {
    const gcode = generateBoreCenterProbe({ ...boreCenterDefaults, probeDepthMm: 15 })
    expect(gcode).toContain('G91 G0 Z-15')
  })

  it('retracts out of bore at the end', () => {
    const gcode = generateBoreCenterProbe(boreCenterDefaults)
    // probeDepthMm=10, retractMm=3 -> retract 13mm
    expect(gcode).toContain('G91 G0 Z13')
  })

  it('custom WCS index P2-P6 works', () => {
    const gcode = generateBoreCenterProbe({ ...boreCenterDefaults, wcsIndex: 4 })
    assertValidG10L2(gcode, 4)
  })
})

// ── Boss Center Probe ───────────────────────────────────────────────────────────

describe('generateBossCenterProbe', () => {
  it('generates 4 G38.2 probe moves (4 faces)', () => {
    const gcode = generateBossCenterProbe(bossCenterDefaults)
    const probeLines = gcodeLines(gcode).filter((l) => l.startsWith('G38.2'))
    expect(probeLines.length).toBe(4)
  })

  it('probes inward from each direction with travel beyond half-width', () => {
    const gcode = generateBossCenterProbe(bossCenterDefaults)
    // approxWidthMm=40 -> halfWidth=20, travelDist=30
    expect(gcode).toContain('G38.2 X-30')
    expect(gcode).toContain('G38.2 X30')
    expect(gcode).toContain('G38.2 Y-30')
    expect(gcode).toContain('G38.2 Y30')
  })

  it('computes boss center from 4 face contacts and sets WCS XY', () => {
    const gcode = generateBossCenterProbe(bossCenterDefaults)
    expect(gcode).toContain('#100 = #5061')
    expect(gcode).toContain('#101 = #5061')
    expect(gcode).toContain('#102 = #5062')
    expect(gcode).toContain('#103 = #5062')
    expect(gcode).toContain('#104 = [#100 + #101] / 2')
    expect(gcode).toContain('#105 = [#102 + #103] / 2')
  })

  it('sets WCS XY offset with G10 L2', () => {
    const gcode = generateBossCenterProbe(bossCenterDefaults)
    assertValidG10L2(gcode, 1)
    expect(gcode).toContain('X[#104] Y[#105]')
  })

  it('safety retract before every probe move', () => {
    const gcode = generateBossCenterProbe(bossCenterDefaults)
    assertRetractBeforeEveryProbe(gcode)
  })

  it('descends to probe height at each face', () => {
    const gcode = generateBossCenterProbe({ ...bossCenterDefaults, probeHeightMm: 8 })
    expect(gcode).toContain('G91 G0 Z-8')
  })
})

// ── Corner Find Probe ───────────────────────────────────────────────────────────

describe('generateCornerFindProbe', () => {
  it('generates 2 G38.2 probe moves (X face + Y face)', () => {
    const gcode = generateCornerFindProbe(cornerFindDefaults)
    const probeLines = gcodeLines(gcode).filter((l) => l.startsWith('G38.2'))
    expect(probeLines.length).toBe(2)
  })

  it('probes X face with correct travel distance', () => {
    const gcode = generateCornerFindProbe(cornerFindDefaults)
    expect(gcode).toContain('G38.2 X-30')
  })

  it('probes Y face with correct travel distance', () => {
    const gcode = generateCornerFindProbe(cornerFindDefaults)
    expect(gcode).toContain('G38.2 Y-30')
  })

  it('sets both X and Y WCS offsets separately using G10 L2', () => {
    const gcode = generateCornerFindProbe(cornerFindDefaults)
    expect(gcode).toContain('G10 L2 P1 X[#5061]')
    expect(gcode).toContain('G10 L2 P1 Y[#5062]')
  })

  it('safety retract before every probe move', () => {
    const gcode = generateCornerFindProbe(cornerFindDefaults)
    assertRetractBeforeEveryProbe(gcode)
  })

  it('custom WCS index works', () => {
    const gcode = generateCornerFindProbe({ ...cornerFindDefaults, wcsIndex: 5 })
    expect(gcode).toContain('G10 L2 P5 X[#5061]')
    expect(gcode).toContain('G10 L2 P5 Y[#5062]')
  })

  it('asymmetric X/Y travel distances', () => {
    const gcode = generateCornerFindProbe({ ...cornerFindDefaults, maxTravelXMm: 20, maxTravelYMm: 40 })
    expect(gcode).toContain('G38.2 X-20')
    expect(gcode).toContain('G38.2 Y-40')
  })
})

// ── Tool Length Probe ───────────────────────────────────────────────────────────

describe('generateToolLengthProbe', () => {
  it('generates G38.2 Z probe move', () => {
    const gcode = generateToolLengthProbe(toolLengthDefaults)
    expect(gcode).toContain('G38.2 Z-100 F50')
  })

  it('sets WCS Z offset with G10 L2 using #5063', () => {
    const gcode = generateToolLengthProbe(toolLengthDefaults)
    assertValidG10L2(gcode, 1)
    expect(gcode).toContain('Z[#5063]')
  })

  it('applies G43 tool length compensation', () => {
    const gcode = generateToolLengthProbe(toolLengthDefaults)
    expect(gcode).toContain('G43 H1')
  })

  it('safety retract before and after Z probe', () => {
    const gcode = generateToolLengthProbe(toolLengthDefaults)
    assertRetractBeforeEveryProbe(gcode)
    // Check retract after probe
    const lines = gcode.split('\n')
    const lastRetractIdx = findLastIdx(lines, (l) => l.trim().startsWith('G91 G0 Z'))
    const probeIdx = findLastIdx(lines, (l) => l.trim().startsWith('G38.2'))
    expect(lastRetractIdx).toBeGreaterThan(probeIdx)
  })

  it('includes tool setter height in comment when provided', () => {
    const gcode = generateToolLengthProbe({ ...toolLengthDefaults, toolSetterHeightMm: -50 })
    expect(gcode).toContain('-50')
  })

  it('custom WCS and feed rate', () => {
    const gcode = generateToolLengthProbe({ ...toolLengthDefaults, wcsIndex: 2, probeFeedMmMin: 75, maxTravelMm: 80 })
    assertValidG10L2(gcode, 2)
    expect(gcode).toContain('G38.2 Z-80 F75')
  })
})

// ── generateProbeCycle dispatcher ───────────────────────────────────────────────

describe('generateProbeCycle', () => {
  it('dispatches singleSurface to generateSingleSurfaceProbe', () => {
    const direct = generateSingleSurfaceProbe(singleSurfaceDefaults)
    const dispatched = generateProbeCycle('singleSurface', singleSurfaceDefaults)
    expect(dispatched).toBe(direct)
  })

  it('dispatches boreCenter to generateBoreCenterProbe', () => {
    const direct = generateBoreCenterProbe(boreCenterDefaults)
    const dispatched = generateProbeCycle('boreCenter', boreCenterDefaults)
    expect(dispatched).toBe(direct)
  })

  it('dispatches bossCenter to generateBossCenterProbe', () => {
    const direct = generateBossCenterProbe(bossCenterDefaults)
    const dispatched = generateProbeCycle('bossCenter', bossCenterDefaults)
    expect(dispatched).toBe(direct)
  })

  it('dispatches cornerFind to generateCornerFindProbe', () => {
    const direct = generateCornerFindProbe(cornerFindDefaults)
    const dispatched = generateProbeCycle('cornerFind', cornerFindDefaults)
    expect(dispatched).toBe(direct)
  })

  it('dispatches toolLength to generateToolLengthProbe', () => {
    const direct = generateToolLengthProbe(toolLengthDefaults)
    const dispatched = generateProbeCycle('toolLength', toolLengthDefaults)
    expect(dispatched).toBe(direct)
  })
})

// ── Cross-cutting safety checks ─────────────────────────────────────────────────

describe('probing safety — all cycle types', () => {
  const allCycles = [
    { name: 'singleSurface', gen: () => generateSingleSurfaceProbe(singleSurfaceDefaults) },
    { name: 'boreCenter', gen: () => generateBoreCenterProbe(boreCenterDefaults) },
    { name: 'bossCenter', gen: () => generateBossCenterProbe(bossCenterDefaults) },
    { name: 'cornerFind', gen: () => generateCornerFindProbe(cornerFindDefaults) },
    { name: 'toolLength', gen: () => generateToolLengthProbe(toolLengthDefaults) },
  ]

  for (const { name, gen } of allCycles) {
    it(`${name}: every G38.2 is preceded by a safety retract`, () => {
      assertRetractBeforeEveryProbe(gen())
    })

    it(`${name}: contains G10 L2 with valid P value (1-6)`, () => {
      const gcode = gen()
      expect(gcode).toMatch(/G10 L2 P[1-6]/)
    })

    it(`${name}: contains at least one G38.2 probe move`, () => {
      const gcode = gen()
      expect(gcode).toContain('G38.2')
    })

    it(`${name}: output is non-empty and contains header comment`, () => {
      const gcode = gen()
      expect(gcode.length).toBeGreaterThan(50)
      expect(gcode).toContain('Generated by WorkTrackCAM')
    })

    it(`${name}: contains probe feed rate (F word) on every G38.2 line`, () => {
      const gcode = gen()
      const probeLines = gcode.split('\n').filter((l) => l.trim().startsWith('G38.2'))
      for (const line of probeLines) {
        expect(line).toMatch(/F\d+/)
      }
    })
  }
})
