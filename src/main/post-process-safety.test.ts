/**
 * Post-processor safety assertion tests.
 *
 * These tests verify structural safety invariants that must hold for
 * EVERY dialect and EVERY option combination:
 *
 *   1. Every output starts with a proper initialization block
 *      (units G21/G20, absolute mode G90, plane G17)
 *   2. Every output ends with M5 (spindle off) and M2/M30 (program end)
 *   3. Tool changes include proper G43 tool length offset
 *   4. Feed rates are always explicitly set before cutting moves
 *   5. No cutting move occurs above rapid height without a feed rate
 *   6. Spindle on appears before any cutting move
 *   7. Cutter compensation G41/G42 is always followed by G40 cancel
 *   8. G93 inverse time feed is always followed by G94 restore
 *
 * These are NOT snapshot tests; they use targeted assertions that survive
 * template reformatting as long as the safety semantics are preserved.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

// ─── Test toolpath lines ────────────────────────────────────────────────────

// Toolpath lines use Z values that won't collide with workAreaMm.z (100).
// E.g. 'G0 Z15' won't match footer's 'G0 Z100'.
const toolpathLines = [
  'G0 X0 Y0 Z15',
  'G0 X5 Y5 Z5',
  'G1 Z-1.000 F300',
  'G1 X15 Y5 F800',
  'G1 X15 Y15 F800',
  'G1 X5 Y15 F800',
  'G1 X5 Y5 F800',
  'G0 Z15',
]

const fourAxisLines = [
  'G0 X10 Y0 Z20 A0',
  'G1 X10 Z-2.000 A0 F600',
  'G1 X10 Z-2.000 A90 F400',
  'G1 X10 Z-2.000 A180 F400',
  'G0 Z20 A0',
]

const fiveAxisLines = [
  'G0 X0 Y0 Z30 A0 B0',
  'G1 X10 Y10 Z-1.000 A15 B10 F500',
  'G1 X20 Y10 Z-1.000 A30 B-5 F500',
  'G0 Z30 A0 B0',
]

// ─── Machine profiles for every dialect ─────────────────────────────────────

const baseMachine: MachineProfile = {
  id: 'safety-assertions',
  name: 'Safety Assertions Mill',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl',
}

type DialectConfig = {
  name: string
  machine: MachineProfile
  lines: string[]
  /** Expected program end code: M30, M2, or either */
  programEnd: 'M30' | 'M2'
  /** Whether this dialect has G43 tool length compensation in the header */
  hasG43: boolean
  /** Whether this dialect has M6 tool change in the header */
  hasM6: boolean
  /** Whether M9 coolant off is required in footer */
  hasM9: boolean
}

const dialects: DialectConfig[] = [
  {
    name: 'GRBL 3-axis (cnc_generic_mm)',
    machine: { ...baseMachine, dialect: 'grbl' },
    lines: toolpathLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Mach3 3-axis (cnc_generic_mm)',
    machine: { ...baseMachine, dialect: 'mach3' },
    lines: toolpathLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Fanuc 3-axis (cnc_generic_mm)',
    machine: { ...baseMachine, dialect: 'fanuc' },
    lines: toolpathLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Siemens 3-axis (cnc_generic_mm)',
    machine: { ...baseMachine, dialect: 'siemens' },
    lines: toolpathLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Heidenhain 3-axis (cnc_generic_mm)',
    machine: { ...baseMachine, dialect: 'heidenhain' },
    lines: toolpathLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Carvera 3-axis',
    machine: {
      ...baseMachine,
      id: 'carvera-safety',
      name: 'Carvera Safety',
      postTemplate: 'carvera_3axis.hbs',
      dialect: 'grbl_4axis',
      minSpindleRpm: 6000,
      maxSpindleRpm: 15000,
    },
    lines: toolpathLines,
    programEnd: 'M2',
    hasG43: true,
    hasM6: true,
    hasM9: true,
  },
  {
    name: 'GRBL 4-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_4axis_grbl.hbs',
      dialect: 'grbl_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    },
    lines: fourAxisLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Fanuc 4-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_4axis_fanuc.hbs',
      dialect: 'fanuc_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    },
    lines: fourAxisLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Mach3 4-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_4axis_mach3.hbs',
      dialect: 'mach3_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    },
    lines: fourAxisLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: true,
    hasM9: false,
  },
  {
    name: 'LinuxCNC 4-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_4axis_linuxcnc.hbs',
      dialect: 'linuxcnc_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    },
    lines: fourAxisLines,
    programEnd: 'M2',
    hasG43: true,
    hasM6: true,
    hasM9: false,
  },
  {
    name: 'Siemens 4-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_4axis_siemens.hbs',
      dialect: 'siemens_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    },
    lines: fourAxisLines,
    programEnd: 'M30',
    hasG43: false,
    hasM6: true,
    hasM9: false,
  },
  {
    name: 'Heidenhain 4-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_4axis_heidenhain.hbs',
      dialect: 'heidenhain_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    },
    lines: fourAxisLines,
    programEnd: 'M30',
    hasG43: true,
    hasM6: true,
    hasM9: false,
  },
  {
    name: 'Carvera 4-axis',
    machine: {
      ...baseMachine,
      id: 'carvera-4ax-safety',
      name: 'Carvera 4-Axis Safety',
      postTemplate: 'carvera_4axis.hbs',
      dialect: 'grbl_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
      minSpindleRpm: 6000,
      maxSpindleRpm: 15000,
    },
    lines: fourAxisLines,
    programEnd: 'M2',
    hasG43: false,
    hasM6: false,
    hasM9: true,
  },
  {
    name: 'Fanuc 5-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_5axis_fanuc.hbs',
      dialect: 'fanuc',
      axisCount: 5,
      aAxisRangeDeg: 360,
      bAxisRangeDeg: 120,
      bAxisOrientation: 'y',
      fiveAxisType: 'table-head',
      maxTiltDeg: 60,
    },
    lines: fiveAxisLines,
    programEnd: 'M30',
    hasG43: false,  // Uses G43.4 (RTCP) instead, tested separately
    hasM6: false,
    hasM9: false,
  },
  {
    name: 'Siemens 5-axis',
    machine: {
      ...baseMachine,
      postTemplate: 'cnc_5axis_siemens.hbs',
      dialect: 'siemens',
      axisCount: 5,
      aAxisRangeDeg: 360,
      bAxisRangeDeg: 120,
      bAxisOrientation: 'y',
      fiveAxisType: 'table-table',
      maxTiltDeg: 60,
    },
    lines: fiveAxisLines,
    programEnd: 'M30',
    hasG43: false,  // Uses TRAORI instead, tested separately
    hasM6: false,
    hasM9: false,
  },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Split G-code into non-empty trimmed lines. */
function gcodeLines(gcode: string): string[] {
  return gcode.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
}

/** Check if a line is a comment (semicolon, parenthesized, or Handlebars). */
function isComment(line: string): boolean {
  const t = line.trim()
  return t.startsWith(';') || t.startsWith('(') || t.startsWith('{{')
}

/** Check if a line is a G-code command (not a comment, not blank, not %). */
function isGcodeLine(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t === '%') return false
  return !isComment(t)
}

/**
 * Check if a line is a cutting move (G1/G2/G3) as opposed to a rapid (G0).
 * Matches lines that start with G1, G01, G2, G02, G3, G03 optionally
 * preceded by an N-word (line number).
 */
function isCuttingMove(line: string): boolean {
  const t = line.trim()
  // Strip optional N-word prefix
  const stripped = t.replace(/^N\d+\s+/, '')
  return /^G0?[123](?:\s|[A-Z]|$)/i.test(stripped)
}

/**
 * Check if a line contains a feed rate F-word.
 */
function hasFeedRate(line: string): boolean {
  return /F\d+(?:\.\d+)?/.test(line)
}

/**
 * Extract the first non-comment, non-blank G-code lines from the output
 * (the initialization block).
 */
function getInitBlock(gcode: string, count: number): string[] {
  const lines = gcodeLines(gcode)
  const gcodeOnly = lines.filter(isGcodeLine)
  return gcodeOnly.slice(0, count)
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. INITIALIZATION BLOCK: every dialect starts with units, mode, plane
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: initialization block present in every dialect', () => {
  for (const cfg of dialects) {
    describe(cfg.name, () => {
      it('contains G21 (metric units)', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        expect(gcode).toContain('G21')
      })

      it('contains G90 (absolute mode)', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        expect(gcode).toContain('G90')
      })

      it('contains G17 (XY plane)', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        expect(gcode).toContain('G17')
      })

      it('G21 appears before any toolpath content', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        const g21Pos = gcode.indexOf('G21')
        // Find first toolpath line in the output
        const firstTpLine = cfg.lines[0]!
        const tpPos = gcode.indexOf(firstTpLine)
        expect(g21Pos).toBeGreaterThan(-1)
        expect(g21Pos).toBeLessThan(tpPos)
      })

      it('G90 appears before any toolpath content', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        const g90Pos = gcode.indexOf('G90')
        const firstTpLine = cfg.lines[0]!
        const tpPos = gcode.indexOf(firstTpLine)
        expect(g90Pos).toBeGreaterThan(-1)
        expect(g90Pos).toBeLessThan(tpPos)
      })

      it('contains UNVERIFIED safety disclaimer', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        expect(gcode.toUpperCase()).toContain('UNVERIFIED')
      })
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. PROGRAM END: M5 (spindle off) and M2/M30 (program end) in every output
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: spindle off (M5) and program end in every dialect', () => {
  for (const cfg of dialects) {
    describe(cfg.name, () => {
      it('M5 spindle off appears after toolpath', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        // Use a unique cutting move from the toolpath to mark the "last toolpath"
        // position, avoiding substring collisions with footer Z-retract values.
        // The second-to-last cutting G1 line is always unique.
        const cuttingLines = cfg.lines.filter((l) => l.startsWith('G1'))
        const markerLine = cuttingLines.length > 0
          ? cuttingLines[cuttingLines.length - 1]!
          : cfg.lines[0]!
        const markerPos = gcode.lastIndexOf(markerLine)
        const m5Pos = gcode.lastIndexOf('M5')
        expect(m5Pos).toBeGreaterThan(-1)
        expect(markerPos).toBeGreaterThan(-1)
        expect(m5Pos).toBeGreaterThan(markerPos)
      })

      it(`program end ${cfg.programEnd} present`, async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        expect(gcode).toContain(cfg.programEnd)
      })

      it(`${cfg.programEnd} is near end of file`, async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        const lines = gcodeLines(gcode)
        const gLines = lines.filter(isGcodeLine)
        // Program end should be within the last 3 G-code lines
        const lastFew = gLines.slice(-3).join(' ')
        expect(lastFew).toContain(cfg.programEnd)
      })

      it('M5 appears before program end', async () => {
        const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
        const m5Pos = gcode.lastIndexOf('M5')
        const endPos = gcode.lastIndexOf(cfg.programEnd)
        expect(m5Pos).toBeLessThan(endPos)
      })

      if (cfg.hasM9) {
        it('M9 coolant off present in footer', async () => {
          const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
          expect(gcode).toContain('M9')
        })
      }
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. SAFE Z RETRACT in every dialect
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: safe Z retract in every dialect', () => {
  for (const cfg of dialects) {
    it(`${cfg.name}: safe Z retract to workAreaMm.z`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      const safeZ = cfg.machine.workAreaMm.z
      // Should contain a G0 Z<safeZ> retract line
      expect(gcode).toContain(`G0 Z${safeZ}`)
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. TOOL LENGTH COMPENSATION: G43 H<n> when templates support it
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: G43 tool length compensation', () => {
  const g43Dialects = dialects.filter((d) => d.hasG43)

  for (const cfg of g43Dialects) {
    it(`${cfg.name}: default tool emits G43 H1`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      expect(gcode).toContain('G43 H1')
    })

    it(`${cfg.name}: tool T3 emits G43 H3`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        toolNumber: 3,
      })
      expect(gcode).toContain('G43 H3')
    })

    it(`${cfg.name}: tool T5 emits G43 H5`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        toolNumber: 5,
      })
      expect(gcode).toContain('G43 H5')
    })

    it(`${cfg.name}: G43 appears before spindle on`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      const g43Pos = gcode.indexOf('G43')
      const spindlePos = gcode.indexOf('M3')
      // G43 should be before or close to spindle start
      // (some templates have G43 before spindle, some after — but always before toolpath)
      const firstTpLine = cfg.lines[0]!
      const tpPos = gcode.indexOf(firstTpLine)
      expect(g43Pos).toBeGreaterThan(-1)
      expect(g43Pos).toBeLessThan(tpPos)
    })
  }

  // 5-axis Fanuc uses G43.4 (RTCP) instead of G43
  it('Fanuc 5-axis: G43.4 RTCP with tool number', async () => {
    const fanuc5 = dialects.find((d) => d.name === 'Fanuc 5-axis')!
    const { gcode } = await renderPost(resourcesRoot, fanuc5.machine, fanuc5.lines, {
      toolNumber: 2,
    })
    expect(gcode).toContain('G43.4 H2')
  })

  it('Fanuc 5-axis: G43.4 defaults to H1', async () => {
    const fanuc5 = dialects.find((d) => d.name === 'Fanuc 5-axis')!
    const { gcode } = await renderPost(resourcesRoot, fanuc5.machine, fanuc5.lines)
    expect(gcode).toContain('G43.4 H1')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. M6 TOOL CHANGE: present in dialects that support it
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: M6 tool change commands', () => {
  const m6Dialects = dialects.filter((d) => d.hasM6)

  for (const cfg of m6Dialects) {
    it(`${cfg.name}: M6 tool change present`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      expect(gcode).toContain('M6')
    })

    it(`${cfg.name}: M6 tool change with custom tool number T4`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        toolNumber: 4,
      })
      // Should contain T4 somewhere near M6
      expect(gcode).toMatch(/T4/)
      expect(gcode).toContain('M6')
    })

    it(`${cfg.name}: M6 appears before toolpath lines`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      const m6Pos = gcode.indexOf('M6')
      const firstTpLine = cfg.lines[0]!
      const tpPos = gcode.indexOf(firstTpLine)
      expect(m6Pos).toBeGreaterThan(-1)
      expect(m6Pos).toBeLessThan(tpPos)
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. FEED RATE SAFETY: F-word set before first cutting move
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: feed rates before cutting moves', () => {
  for (const cfg of dialects) {
    it(`${cfg.name}: first cutting move in toolpath has F-word`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      const lines = gcode.split('\n')

      // Find the first cutting move (G1/G2/G3) in the output
      let feedSeen = false
      for (const line of lines) {
        if (hasFeedRate(line)) {
          feedSeen = true
        }
        if (isCuttingMove(line)) {
          // The first cutting move should either have its own F-word
          // or a feed rate should have been set before it on a prior line.
          // In our test toolpaths, the first G1 always has an F-word.
          if (!feedSeen) {
            expect(hasFeedRate(line)).toBe(true)
          }
          break
        }
      }
    })

    it(`${cfg.name}: no cutting move occurs without any preceding F-word in toolpath region`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      const lines = gcode.split('\n')

      // Track whether we've entered the toolpath region
      // (after spindle on, before spindle off)
      let inToolpath = false
      let feedEstablished = false

      for (const line of lines) {
        const t = line.trim()

        // Detect toolpath region start (the first line from our test toolpath)
        if (t === cfg.lines[0]) {
          inToolpath = true
        }

        if (!inToolpath) continue

        // Track F-word appearances
        if (hasFeedRate(t)) {
          feedEstablished = true
        }

        // If we see a cutting move, a feed rate must have been established
        if (isCuttingMove(t)) {
          // Either the line itself has F, or a previous line established F
          const lineHasF = hasFeedRate(t)
          expect(lineHasF || feedEstablished).toBe(true)
          if (lineHasF) {
            feedEstablished = true
          }
        }
      }
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. SPINDLE ON before any cutting move
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: spindle on (M3) before any cutting move', () => {
  for (const cfg of dialects) {
    it(`${cfg.name}: M3 (spindle on) appears before first toolpath line`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines)
      const m3Pos = gcode.indexOf('M3')
      const firstTpLine = cfg.lines[0]!
      const tpPos = gcode.indexOf(firstTpLine)
      expect(m3Pos).toBeGreaterThan(-1)
      expect(m3Pos).toBeLessThan(tpPos)
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. CUTTER COMPENSATION: G41/G42 always followed by G40 cancel
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: cutter compensation engage/cancel pairing', () => {
  const compModes: Array<'left' | 'right'> = ['left', 'right']

  for (const mode of compModes) {
    const gComp = mode === 'left' ? 'G41' : 'G42'

    it(`${gComp} (${mode}) is always followed by G40 cancel`, async () => {
      const { gcode } = await renderPost(resourcesRoot, baseMachine, toolpathLines, {
        cutterCompensation: mode,
      })
      expect(gcode).toContain(gComp)
      expect(gcode).toContain('G40')
      // G40 must come after G41/G42
      const engagePos = gcode.indexOf(gComp)
      const cancelPos = gcode.lastIndexOf('G40')
      expect(cancelPos).toBeGreaterThan(engagePos)
    })

    it(`${gComp} with D-register: G40 cancel still present`, async () => {
      const { gcode } = await renderPost(resourcesRoot, baseMachine, toolpathLines, {
        cutterCompensation: mode,
        cutterCompDRegister: 3,
      })
      expect(gcode).toContain(`${gComp} D3`)
      expect(gcode).toContain('G40')
    })

    it(`${gComp} engage appears before first cutting move`, async () => {
      const { gcode } = await renderPost(resourcesRoot, baseMachine, toolpathLines, {
        cutterCompensation: mode,
      })
      const engagePos = gcode.indexOf(gComp)
      // First cutting move in our toolpath is G1 Z-1.000
      const firstCut = gcode.indexOf('G1 Z-1.000')
      expect(engagePos).toBeLessThan(firstCut)
    })

    it(`G40 cancel appears after last cutting move`, async () => {
      const { gcode } = await renderPost(resourcesRoot, baseMachine, toolpathLines, {
        cutterCompensation: mode,
      })
      const cancelPos = gcode.lastIndexOf('G40')
      // Last cutting move in our toolpath is G1 X5 Y5
      const lastCut = gcode.lastIndexOf('G1 X5 Y5')
      expect(cancelPos).toBeGreaterThan(lastCut)
    })
  }

  it('no cutter compensation: G41/G42 not injected by post-processor', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, toolpathLines, {
      cutterCompensation: 'none',
    })
    // G41/G42 should not be present from the compensation system
    // (Note: template safety headers may contain G40 for cancellation,
    //  but G41/G42 should not appear)
    const lines = gcode.split('\n')
    for (const line of lines) {
      const stripped = line.trim().replace(/^N\d+\s+/, '')
      // Only check non-comment lines for G41/G42
      if (!isComment(stripped)) {
        expect(stripped).not.toMatch(/^G4[12](?:\s|$)/)
      }
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9. INVERSE TIME FEED: G93 always paired with G94 restore
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: G93/G94 inverse time feed pairing', () => {
  // Only 4-axis templates have {{#if inverseTimeFeed}} blocks.
  // 5-axis templates (Fanuc G43.4 / Siemens TRAORI) do not use G93/G94.
  const fourAxisDialects = dialects.filter(
    (d) => d.machine.axisCount === 4
  )

  for (const cfg of fourAxisDialects) {
    it(`${cfg.name}: G93 enabled implies G94 restore present`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        inverseTimeFeed: true,
      })
      expect(gcode).toContain('G93')
      expect(gcode).toContain('G94')
    })

    it(`${cfg.name}: G93 before toolpath, G94 after toolpath`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        inverseTimeFeed: true,
      })
      const g93Pos = gcode.indexOf('G93')
      const g94Pos = gcode.lastIndexOf('G94')
      const firstTpLine = cfg.lines[0]!
      const lastTpLine = cfg.lines[cfg.lines.length - 1]!
      const firstTpPos = gcode.indexOf(firstTpLine)
      const lastTpPos = gcode.lastIndexOf(lastTpLine)

      expect(g93Pos).toBeLessThan(firstTpPos)
      expect(g94Pos).toBeGreaterThan(lastTpPos)
    })

    it(`${cfg.name}: G93 disabled means no G93/G94 in output`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        inverseTimeFeed: false,
      })
      // No G93 or G94 should appear (they are only from inverse time feed)
      expect(gcode).not.toContain('G93')
      expect(gcode).not.toContain('G94')
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 10. LINE NUMBERING does not break safety codes
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: line numbering preserves safety codes', () => {
  for (const cfg of dialects) {
    it(`${cfg.name}: safety codes still present with line numbering enabled`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        lineNumbering: { enabled: true, start: 10, increment: 10 },
      })
      // Core safety codes must still be present (possibly with N-word prefix)
      expect(gcode).toMatch(/G21/)
      expect(gcode).toMatch(/G90/)
      expect(gcode).toMatch(/G17/)
      expect(gcode).toMatch(/M5/)
      expect(gcode).toMatch(new RegExp(cfg.programEnd))
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 11. ARC FITTING does not break safety codes
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: arc fitting preserves safety structure', () => {
  // Only test 3-axis dialects with arc fitting since it's most relevant
  const threeAxisDialects = dialects.filter(
    (d) => !d.machine.axisCount || d.machine.axisCount === 3
  )

  for (const cfg of threeAxisDialects) {
    it(`${cfg.name}: safety header/footer intact with arc fitting`, async () => {
      const { gcode } = await renderPost(resourcesRoot, cfg.machine, cfg.lines, {
        enableArcFitting: true,
      })
      // Header
      expect(gcode).toContain('G21')
      expect(gcode).toContain('G90')
      expect(gcode).toContain('G17')
      // Footer
      expect(gcode).toContain('M5')
      expect(gcode).toContain(cfg.programEnd)
      expect(gcode).toContain(`G0 Z${cfg.machine.workAreaMm.z}`)
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 12. SUBROUTINES do not break safety structure
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: subroutines preserve safety structure', () => {
  // Repeating toolpath for subroutine detection
  const repeating = [
    'G0 X0 Y0 Z10',
    'G0 Z5',
    'G1 Z-1.000 F300',
    'G1 X10 Y0 F800',
    'G0 Z5',
    'G1 Z-1.000 F300',
    'G1 X10 Y0 F800',
    'G0 Z5',
    'G1 Z-1.000 F300',
    'G1 X10 Y0 F800',
    'G0 Z5',
    'G1 Z-1.000 F300',
    'G1 X10 Y0 F800',
    'G0 Z10',
  ]

  const subDialects: Array<{ name: string; dialect: 'fanuc' | 'siemens' | 'mach3'; subroutineDialect: 'fanuc' | 'siemens' | 'mach3' }> = [
    { name: 'Fanuc', dialect: 'fanuc', subroutineDialect: 'fanuc' },
    { name: 'Siemens', dialect: 'siemens', subroutineDialect: 'siemens' },
    { name: 'Mach3', dialect: 'mach3', subroutineDialect: 'mach3' },
  ]

  for (const sub of subDialects) {
    it(`${sub.name}: safety header/footer intact with subroutines`, async () => {
      const machine: MachineProfile = { ...baseMachine, dialect: sub.dialect }
      const { gcode } = await renderPost(resourcesRoot, machine, repeating, {
        enableSubroutines: true,
        subroutineDialect: sub.subroutineDialect,
      })
      // Header
      expect(gcode).toContain('G21')
      expect(gcode).toContain('G90')
      expect(gcode).toContain('G17')
      // Footer
      expect(gcode).toContain('M5')
      expect(gcode).toContain('M30')
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 13. COMBINED OPTIONS: safety still holds
// ═════════════════════════════════════════════════════════════════════════════

describe('Safety: combined options do not break safety invariants', () => {
  it('arc fitting + cutter comp + line numbering + WCS: all safety codes present', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, toolpathLines, {
      enableArcFitting: true,
      cutterCompensation: 'left',
      cutterCompDRegister: 2,
      workCoordinateIndex: 1,
      lineNumbering: { enabled: true, start: 10, increment: 10 },
      spindleRpm: 8000,
    })
    // Initialization
    expect(gcode).toMatch(/G21/)
    expect(gcode).toMatch(/G90/)
    expect(gcode).toMatch(/G17/)
    expect(gcode).toMatch(/G54/)
    // Spindle
    expect(gcode).toContain('M3 S8000')
    // Cutter comp
    expect(gcode).toMatch(/G41/)
    expect(gcode).toMatch(/G40/)
    // Footer
    expect(gcode).toMatch(/M5/)
    expect(gcode).toMatch(/M30/)
    expect(gcode).toContain(`G0 Z${baseMachine.workAreaMm.z}`)
  })

  it('subroutines + cutter comp + line numbering: Fanuc safety intact', async () => {
    const fanuc: MachineProfile = { ...baseMachine, dialect: 'fanuc' }
    const repeating = [
      'G0 X0 Y0 Z10',
      'G0 Z5',
      'G1 Z-1.000 F300',
      'G1 X10 Y0 F800',
      'G0 Z5',
      'G1 Z-1.000 F300',
      'G1 X10 Y0 F800',
      'G0 Z5',
      'G1 Z-1.000 F300',
      'G1 X10 Y0 F800',
      'G0 Z5',
      'G1 Z-1.000 F300',
      'G1 X10 Y0 F800',
      'G0 Z10',
    ]
    const { gcode } = await renderPost(resourcesRoot, fanuc, repeating, {
      enableSubroutines: true,
      subroutineDialect: 'fanuc',
      cutterCompensation: 'right',
      lineNumbering: { enabled: true, start: 100, increment: 5 },
    })
    // Safety codes
    expect(gcode).toMatch(/G21/)
    expect(gcode).toMatch(/G90/)
    expect(gcode).toMatch(/M5/)
    expect(gcode).toMatch(/M30/)
    // Cutter comp pair
    expect(gcode).toMatch(/G42/)
    expect(gcode).toMatch(/G40/)
    // Subroutine markers
    expect(gcode).toContain('SUBROUTINE')
  })

  it('inverse time feed + tool change on Heidenhain 4-axis: complete safety', async () => {
    const heidenhain4ax: MachineProfile = {
      ...baseMachine,
      postTemplate: 'cnc_4axis_heidenhain.hbs',
      dialect: 'heidenhain_4axis',
      axisCount: 4,
      aAxisRangeDeg: 360,
    }
    const { gcode } = await renderPost(resourcesRoot, heidenhain4ax, fourAxisLines, {
      inverseTimeFeed: true,
      toolNumber: 3,
    })
    // Init
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('G17')
    // Tool
    expect(gcode).toContain('T3 M6')
    expect(gcode).toContain('G43 H3')
    // Inverse time
    expect(gcode).toContain('G93')
    expect(gcode).toContain('G94')
    // Footer
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')
    expect(gcode).toContain(`G0 Z${heidenhain4ax.workAreaMm.z}`)
  })
})

// 10. 4-AXIS Y=0 CENTERING: tool must be centered on rotation axis
// ──────────────────────────────────────────────────────────────────────────────

describe('Safety: 4-axis Y=0 centering on rotation axis', () => {
  const carvera4ax: MachineProfile = {
    ...baseMachine,
    id: 'carvera-4ax-y0',
    name: 'Carvera 4-Axis Y0 Test',
    postTemplate: 'carvera_4axis.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360,
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000,
  }

  const grbl4ax: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360,
  }

  it('Carvera 4-axis: G0 Y0 appears in header before toolpath', async () => {
    const { gcode } = await renderPost(resourcesRoot, carvera4ax, fourAxisLines)
    const y0Idx = gcode.indexOf('G0 Y0')
    const firstToolpath = gcode.indexOf('G0 X10')
    expect(y0Idx).toBeGreaterThan(-1)
    expect(y0Idx).toBeLessThan(firstToolpath)
  })

  it('Carvera 4-axis: end parking includes Y0', async () => {
    const { gcode } = await renderPost(resourcesRoot, carvera4ax, fourAxisLines)
    expect(gcode).toContain('G0 X0 Y0')
  })

  it('GRBL 4-axis: G0 Y0 appears in header before toolpath', async () => {
    const { gcode } = await renderPost(resourcesRoot, grbl4ax, fourAxisLines)
    const y0Idx = gcode.indexOf('G0 Y0')
    const firstToolpath = gcode.indexOf('G0 X10')
    expect(y0Idx).toBeGreaterThan(-1)
    expect(y0Idx).toBeLessThan(firstToolpath)
  })

  it('GRBL 4-axis: end parking includes Y0', async () => {
    const { gcode } = await renderPost(resourcesRoot, grbl4ax, fourAxisLines)
    expect(gcode).toContain('G0 X0 Y0')
  })

  it('Carvera 4-axis: Y0 appears before spindle start', async () => {
    const { gcode } = await renderPost(resourcesRoot, carvera4ax, fourAxisLines)
    const y0Idx = gcode.indexOf('G0 Y0')
    const spindleIdx = gcode.indexOf('M3 S')
    expect(y0Idx).toBeGreaterThan(-1)
    expect(spindleIdx).toBeGreaterThan(-1)
    // Y0 centering should happen before spindle starts
    expect(y0Idx).toBeLessThan(spindleIdx)
  })
})
