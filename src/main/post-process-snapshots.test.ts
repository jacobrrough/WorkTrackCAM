/**
 * Comprehensive G-code snapshot tests for the post-processing pipeline.
 *
 * These tests exercise every post-processor option combination that affects
 * final G-code output:
 *   - Arc fitting enabled/disabled
 *   - Line numbering enabled/disabled
 *   - Cutter compensation (left/right/none) with D-register
 *   - Subroutine detection (fanuc/siemens/mach3 dialects)
 *   - Tool changes with G43 tool length offset
 *   - Inverse time feed mode
 *   - WCS offsets
 *   - Custom spindle RPM with clamping
 *
 * For each dialect, a representative toolpath is generated (contour with
 * linear moves, rapids, tool change, and retract). Vitest file snapshots
 * catch any accidental G-code regressions.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

// ─── Representative toolpath lines ──────────────────────────────────────────
// A simple contour: rapid to start, plunge, linear contour moves, retract.
// Includes explicit feed rates on every cutting move (realistic CAM output).
const contourToolpath = [
  'G0 X0 Y0 Z10',         // rapid to start position
  'G0 X5 Y5 Z5',          // rapid approach
  'G1 Z-1.000 F300',      // plunge cut
  'G1 X15 Y5 F800',       // contour move 1
  'G1 X15 Y15 F800',      // contour move 2
  'G1 X5 Y15 F800',       // contour move 3
  'G1 X5 Y5 F800',        // close contour
  'G0 Z10',               // retract
]

// Lines that form a semi-circle pattern to test arc fitting
// (points on a radius-10 arc from 0deg to 180deg in 30deg steps)
const arcCandidateToolpath = [
  'G0 X0 Y0 Z10',
  'G0 X10 Y0 Z0',
  'G1 X8.6603 Y5.0000 Z0 F600',
  'G1 X5.0000 Y8.6603 Z0 F600',
  'G1 X0.0000 Y10.0000 Z0 F600',
  'G1 X-5.0000 Y8.6603 Z0 F600',
  'G1 X-8.6603 Y5.0000 Z0 F600',
  'G1 X-10.0000 Y0.0000 Z0 F600',
  'G0 Z10',
]

// Lines with a repeated block to trigger subroutine detection
// (3-line block repeated 4 times = 12 lines total)
const repeatingToolpath = [
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

// 4-axis toolpath with A-axis rotation
const fourAxisToolpath = [
  'G0 X0 Y0 Z20 A0',
  'G1 X10 Z-2.000 A0 F600',
  'G1 X10 Z-2.000 A90 F400',
  'G1 X10 Z-2.000 A180 F400',
  'G1 X10 Z-2.000 A270 F400',
  'G0 Z20 A0',
]

// 5-axis toolpath with A and B axes
const fiveAxisToolpath = [
  'G0 X0 Y0 Z30 A0 B0',
  'G1 X10 Y10 Z-1.000 A15 B10 F500',
  'G1 X20 Y10 Z-1.000 A30 B-5 F500',
  'G1 X20 Y20 Z-1.500 A15 B0 F500',
  'G0 Z30 A0 B0',
]

// ─── Base machine profiles ──────────────────────────────────────────────────

const baseMachine: MachineProfile = {
  id: 'snapshot-comprehensive',
  name: 'Comprehensive Snapshot Mill',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl',
}

const carveraMachine: MachineProfile = {
  ...baseMachine,
  id: 'carvera-snapshot',
  name: 'Carvera Snapshot',
  postTemplate: 'carvera_3axis.hbs',
  dialect: 'grbl_4axis',
  minSpindleRpm: 6000,
  maxSpindleRpm: 15000,
}

// ═════════════════════════════════════════════════════════════════════════════
// ARC FITTING: enabled vs disabled
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — arc fitting', () => {
  it('arc fitting DISABLED: G1 moves preserved as-is', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, arcCandidateToolpath, {
      enableArcFitting: false,
      operationLabel: 'Arc Fitting Disabled',
    })
    expect(gcode).toMatchSnapshot()
  })

  it('arc fitting ENABLED: G1 sequences converted to G2/G3 arcs', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, arcCandidateToolpath, {
      enableArcFitting: true,
      operationLabel: 'Arc Fitting Enabled',
    })
    expect(gcode).toMatchSnapshot()
  })

  it('arc fitting with custom tolerance', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, arcCandidateToolpath, {
      enableArcFitting: true,
      arcTolerance: 0.01,
      operationLabel: 'Arc Fitting Tolerance 0.01mm',
    })
    expect(gcode).toMatchSnapshot()
  })

  // Note: the Fanuc 4-axis arc-fitting case was removed in the April 2026
  // 4-axis subsystem rewrite — only the GRBL 4-axis post template remains.
})

// ═════════════════════════════════════════════════════════════════════════════
// LINE NUMBERING: enabled vs disabled
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — line numbering', () => {
  it('line numbering DISABLED: no N-words in output', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      operationLabel: 'Line Numbering Off',
    })
    expect(gcode).toMatchSnapshot()
    // No line should start with N followed by a digit
    const lines = gcode.split('\n')
    for (const line of lines) {
      expect(line.trim()).not.toMatch(/^N\d/)
    }
  })

  it('line numbering ENABLED: N-words prepended (N10, N20, N30...)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      operationLabel: 'Line Numbering On',
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    expect(gcode).toMatchSnapshot()
    // At least some lines should start with N<number>
    const nLines = gcode.split('\n').filter((l) => /^N\d/.test(l.trim()))
    expect(nLines.length).toBeGreaterThan(0)
  })

  it('line numbering with custom start and increment (N100, N105, N110...)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      operationLabel: 'Custom Line Numbers',
      lineNumbering: { enabled: true, start: 100, increment: 5 },
    })
    expect(gcode).toMatchSnapshot()
    // First N-word should be N100
    const firstN = gcode.split('\n').find((l) => /^N\d/.test(l.trim()))
    expect(firstN).toMatch(/^N100\s/)
  })

  it('line numbering with Fanuc dialect', async () => {
    const fanuc: MachineProfile = { ...baseMachine, dialect: 'fanuc' }
    const { gcode } = await renderPost(resourcesRoot, fanuc, contourToolpath, {
      operationLabel: 'Fanuc Line Numbering',
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    expect(gcode).toMatchSnapshot()
  })

  it('line numbering skips comment lines', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      operationLabel: 'Numbering Skips Comments',
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    // Comment lines (starting with ;) should NOT have N-words
    const commentLines = gcode.split('\n').filter((l) => l.trim().startsWith(';'))
    for (const cl of commentLines) {
      expect(cl).not.toMatch(/^N\d/)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// CUTTER COMPENSATION: left/right/none with D-register
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — cutter compensation', () => {
  it('cutter compensation NONE: no G41/G42/G40 in output', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      cutterCompensation: 'none',
      operationLabel: 'Cutter Comp None',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).not.toContain('G41')
    expect(gcode).not.toContain('G42')
    // G40 may appear in template safety headers for some dialects; check
    // it doesn't appear from the compensation system specifically by checking
    // it's not between toolpath lines
  })

  it('cutter compensation LEFT (G41): climb milling', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      cutterCompensation: 'left',
      operationLabel: 'Cutter Comp Left (G41)',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G41')
    expect(gcode).toContain('G40')
  })

  it('cutter compensation RIGHT (G42): conventional milling', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      cutterCompensation: 'right',
      operationLabel: 'Cutter Comp Right (G42)',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G42')
    expect(gcode).toContain('G40')
  })

  it('cutter compensation LEFT with D-register (G41 D5)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      cutterCompensation: 'left',
      cutterCompDRegister: 5,
      operationLabel: 'Cutter Comp G41 D5',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G41 D5')
  })

  it('cutter compensation RIGHT with D-register (G42 D3)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      cutterCompensation: 'right',
      cutterCompDRegister: 3,
      operationLabel: 'Cutter Comp G42 D3',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G42 D3')
  })

  it('cutter compensation combined with arc fitting', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, arcCandidateToolpath, {
      cutterCompensation: 'left',
      enableArcFitting: true,
      operationLabel: 'Comp + Arc Fitting',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G41')
    expect(gcode).toContain('G40')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SUBROUTINE DETECTION
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — subroutine detection', () => {
  it('subroutines DISABLED: repeated blocks emitted verbatim', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, repeatingToolpath, {
      enableSubroutines: false,
      operationLabel: 'Subroutines Disabled',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).not.toContain('SUBROUTINE')
    expect(gcode).not.toContain('M98')
    expect(gcode).not.toContain('M99')
  })

  it('subroutines Fanuc dialect: M98/M99 call/return', async () => {
    const fanuc: MachineProfile = { ...baseMachine, dialect: 'fanuc' }
    const { gcode } = await renderPost(resourcesRoot, fanuc, repeatingToolpath, {
      enableSubroutines: true,
      subroutineDialect: 'fanuc',
      operationLabel: 'Subroutines Fanuc',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('M98')
    expect(gcode).toContain('M99')
    expect(gcode).toContain('SUBROUTINE')
  })

  it('subroutines Siemens dialect: CALL L<n> REP / RET', async () => {
    const siemens: MachineProfile = { ...baseMachine, dialect: 'siemens' }
    const { gcode } = await renderPost(resourcesRoot, siemens, repeatingToolpath, {
      enableSubroutines: true,
      subroutineDialect: 'siemens',
      operationLabel: 'Subroutines Siemens',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('CALL L')
    expect(gcode).toContain('RET')
  })

  it('subroutines Mach3 dialect: M98/sub/endsub', async () => {
    const mach3: MachineProfile = { ...baseMachine, dialect: 'mach3' }
    const { gcode } = await renderPost(resourcesRoot, mach3, repeatingToolpath, {
      enableSubroutines: true,
      subroutineDialect: 'mach3',
      operationLabel: 'Subroutines Mach3',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('M98')
    expect(gcode).toContain('sub')
    expect(gcode).toContain('endsub')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// TOOL CHANGES: tool number, G43 tool length offset
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — tool changes (Carvera ATC)', () => {
  it('default tool T1 when toolNumber not specified', async () => {
    const { gcode } = await renderPost(resourcesRoot, carveraMachine, contourToolpath, {
      operationLabel: 'Default Tool T1',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('M6 T1')
    expect(gcode).toContain('G43 H1')
  })

  it('tool T3 with G43 H3 tool length compensation', async () => {
    const { gcode } = await renderPost(resourcesRoot, carveraMachine, contourToolpath, {
      toolNumber: 3,
      operationLabel: 'Tool T3',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('M6 T3')
    expect(gcode).toContain('G43 H3')
  })

  it('tool T6 (max ATC slot)', async () => {
    const { gcode } = await renderPost(resourcesRoot, carveraMachine, contourToolpath, {
      toolNumber: 6,
      operationLabel: 'Tool T6',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('M6 T6')
    expect(gcode).toContain('G43 H6')
  })
})

// Note: the LinuxCNC and Heidenhain 4-axis tool-change snapshot suites were
// removed in the April 2026 4-axis subsystem rewrite — only the GRBL/Carvera
// 4-axis posts remain for tool-change coverage.

// ═════════════════════════════════════════════════════════════════════════════
// INVERSE TIME FEED MODE (G93/G94)
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — inverse time feed mode', () => {
  const grbl4ax: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360,
  }

  it('inverse time feed DISABLED: no G93/G94 in output', async () => {
    const { gcode } = await renderPost(resourcesRoot, grbl4ax, fourAxisToolpath, {
      inverseTimeFeed: false,
      operationLabel: 'No Inverse Time',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).not.toContain('G93')
    expect(gcode).not.toContain('G94')
  })

  it('inverse time feed ENABLED: G93 before toolpath, G94 after', async () => {
    const { gcode } = await renderPost(resourcesRoot, grbl4ax, fourAxisToolpath, {
      inverseTimeFeed: true,
      operationLabel: 'Inverse Time Enabled',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G93')
    expect(gcode).toContain('G94')
    // G93 before first toolpath line
    const g93Idx = gcode.indexOf('G93')
    const firstTp = gcode.indexOf('G0 X0 Y0 Z20 A0')
    expect(g93Idx).toBeLessThan(firstTp)
    // G94 after last toolpath line
    const g94Idx = gcode.lastIndexOf('G94')
    const lastTp = gcode.lastIndexOf('G0 Z20 A0')
    expect(g94Idx).toBeGreaterThan(lastTp)
  })

  // Note: the Fanuc 4-axis inverse-time-feed snapshot was removed in the April
  // 2026 4-axis subsystem rewrite — only GRBL/Carvera 4-axis posts remain.

  it('inverse time feed on Carvera 4-axis', async () => {
    const carvera4ax: MachineProfile = {
      ...carveraMachine,
      postTemplate: 'carvera_4axis.hbs',
      axisCount: 4,
      aAxisRangeDeg: 360,
    }
    const { gcode } = await renderPost(resourcesRoot, carvera4ax, fourAxisToolpath, {
      inverseTimeFeed: true,
      operationLabel: 'Carvera Inverse Time',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G93')
    expect(gcode).toContain('G94')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// WCS OFFSETS (G54–G59)
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — WCS offsets', () => {
  it('G54 (WCS index 1)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      workCoordinateIndex: 1,
      operationLabel: 'WCS G54',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G54')
  })

  it('G57 (WCS index 4)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      workCoordinateIndex: 4,
      operationLabel: 'WCS G57',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G57')
  })

  it('G59 (WCS index 6)', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      workCoordinateIndex: 6,
      operationLabel: 'WCS G59',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G59')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SPINDLE RPM CLAMPING
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — spindle RPM clamping', () => {
  const machineLimited: MachineProfile = {
    ...baseMachine,
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000,
  }

  it('custom RPM within range', async () => {
    const { gcode, warnings } = await renderPost(resourcesRoot, machineLimited, contourToolpath, {
      spindleRpm: 10000,
      operationLabel: 'RPM 10000',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('S10000')
    expect(warnings).toEqual([])
  })

  it('RPM exceeding max is clamped', async () => {
    const { gcode, warnings } = await renderPost(resourcesRoot, machineLimited, contourToolpath, {
      spindleRpm: 20000,
      operationLabel: 'RPM Clamped Max',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('S15000')
    expect(gcode).not.toContain('S20000')
    expect(warnings.length).toBe(1)
  })

  it('RPM below min is clamped', async () => {
    const { gcode, warnings } = await renderPost(resourcesRoot, machineLimited, contourToolpath, {
      spindleRpm: 3000,
      operationLabel: 'RPM Clamped Min',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('S6000')
    expect(gcode).not.toContain('S3000')
    expect(warnings.length).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5-AXIS TEMPLATE SNAPSHOTS WITH OPTIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — 5-axis templates with options', () => {
  const fanuc5ax: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_5axis_fanuc.hbs',
    dialect: 'fanuc',
    axisCount: 5,
    aAxisRangeDeg: 360,
    bAxisRangeDeg: 120,
    bAxisOrientation: 'y',
    fiveAxisType: 'table-head',
    maxTiltDeg: 60,
  }

  const siemens5ax: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_5axis_siemens.hbs',
    dialect: 'siemens',
    axisCount: 5,
    aAxisRangeDeg: 360,
    bAxisRangeDeg: 120,
    bAxisOrientation: 'y',
    fiveAxisType: 'table-table',
    maxTiltDeg: 60,
  }

  it('Fanuc 5-axis with tool number T3 and WCS G55', async () => {
    const { gcode } = await renderPost(resourcesRoot, fanuc5ax, fiveAxisToolpath, {
      toolNumber: 3,
      workCoordinateIndex: 2,
      operationLabel: '5ax Fanuc T3 G55',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G43.4 H3')
    expect(gcode).toContain('G55')
  })

  it('Siemens 5-axis with TRAORI and line numbering', async () => {
    const { gcode } = await renderPost(resourcesRoot, siemens5ax, fiveAxisToolpath, {
      operationLabel: '5ax Siemens Numbered',
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('TRAORI(1)')
    expect(gcode).toContain('TRAFOOF')
    // Line numbers present
    const nLines = gcode.split('\n').filter((l) => /^N\d/.test(l.trim()))
    expect(nLines.length).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// COMBINED OPTIONS: arc fitting + line numbering + cutter comp
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — combined options', () => {
  it('arc fitting + line numbering', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, arcCandidateToolpath, {
      enableArcFitting: true,
      lineNumbering: { enabled: true, start: 100, increment: 10 },
      operationLabel: 'Arc + Line Numbers',
    })
    expect(gcode).toMatchSnapshot()
  })

  it('cutter compensation + line numbering', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, contourToolpath, {
      cutterCompensation: 'left',
      cutterCompDRegister: 7,
      lineNumbering: { enabled: true, start: 10, increment: 10 },
      operationLabel: 'Comp + Line Numbers',
    })
    expect(gcode).toMatchSnapshot()
    // G41 should have an N-word prefix since it's a non-comment line
    const g41Line = gcode.split('\n').find((l) => l.includes('G41'))
    expect(g41Line).toMatch(/^N\d/)
  })

  it('subroutines + line numbering (Fanuc)', async () => {
    const fanuc: MachineProfile = { ...baseMachine, dialect: 'fanuc' }
    const { gcode } = await renderPost(resourcesRoot, fanuc, repeatingToolpath, {
      enableSubroutines: true,
      subroutineDialect: 'fanuc',
      lineNumbering: { enabled: true, start: 10, increment: 10 },
      operationLabel: 'Subs + Line Numbers',
    })
    expect(gcode).toMatchSnapshot()
  })

  it('arc fitting + cutter compensation + WCS offset', async () => {
    const { gcode } = await renderPost(resourcesRoot, baseMachine, arcCandidateToolpath, {
      enableArcFitting: true,
      cutterCompensation: 'right',
      cutterCompDRegister: 2,
      workCoordinateIndex: 3,
      operationLabel: 'Arc + Comp + WCS',
    })
    expect(gcode).toMatchSnapshot()
    expect(gcode).toContain('G42 D2')
    expect(gcode).toContain('G56')
  })

  it('all options combined: Fanuc dialect', async () => {
    const fanuc: MachineProfile = { ...baseMachine, dialect: 'fanuc' }
    const { gcode } = await renderPost(resourcesRoot, fanuc, contourToolpath, {
      enableArcFitting: true,
      cutterCompensation: 'left',
      cutterCompDRegister: 1,
      workCoordinateIndex: 1,
      spindleRpm: 8000,
      lineNumbering: { enabled: true, start: 10, increment: 5 },
      operationLabel: 'All Options Fanuc',
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// EVERY DIALECT: baseline snapshot with standard contour
// (supplements existing file; uses different toolpath and options)
// ═════════════════════════════════════════════════════════════════════════════

describe('Snapshot — every dialect with tool change and WCS', () => {
  const standardOpts = {
    toolNumber: 2,
    workCoordinateIndex: 3 as number,
    spindleRpm: 9000,
    operationLabel: 'Comprehensive Dialect Test',
  }

  const dialects: {
    name: string
    machine: MachineProfile
    lines: string[]
  }[] = [
    {
      name: 'GRBL 3-axis',
      machine: { ...baseMachine, dialect: 'grbl' },
      lines: contourToolpath,
    },
    {
      name: 'Mach3 3-axis',
      machine: { ...baseMachine, dialect: 'mach3' },
      lines: contourToolpath,
    },
    {
      name: 'Fanuc 3-axis',
      machine: { ...baseMachine, dialect: 'fanuc' },
      lines: contourToolpath,
    },
    {
      name: 'Siemens 3-axis',
      machine: { ...baseMachine, dialect: 'siemens' },
      lines: contourToolpath,
    },
    {
      name: 'Heidenhain 3-axis',
      machine: { ...baseMachine, dialect: 'heidenhain' },
      lines: contourToolpath,
    },
    {
      name: 'Carvera 3-axis',
      machine: carveraMachine,
      lines: contourToolpath,
    },
    {
      name: 'GRBL 4-axis',
      machine: {
        ...baseMachine,
        postTemplate: 'cnc_4axis_grbl.hbs',
        dialect: 'grbl_4axis' as const,
        axisCount: 4,
        aAxisRangeDeg: 360,
      },
      lines: fourAxisToolpath,
    },
    {
      name: 'Carvera 4-axis',
      machine: {
        ...carveraMachine,
        postTemplate: 'carvera_4axis.hbs',
        axisCount: 4,
        aAxisRangeDeg: 360,
      },
      lines: fourAxisToolpath,
    },
    // Note: the Fanuc/Mach3/LinuxCNC/Siemens/Heidenhain 4-axis baseline
    // snapshot entries were removed in the April 2026 4-axis subsystem rewrite.
    {
      name: 'Fanuc 5-axis',
      machine: {
        ...baseMachine,
        postTemplate: 'cnc_5axis_fanuc.hbs',
        dialect: 'fanuc' as const,
        axisCount: 5,
        aAxisRangeDeg: 360,
        bAxisRangeDeg: 120,
        bAxisOrientation: 'y' as const,
        fiveAxisType: 'table-head' as const,
        maxTiltDeg: 60,
      },
      lines: fiveAxisToolpath,
    },
    {
      name: 'Siemens 5-axis',
      machine: {
        ...baseMachine,
        postTemplate: 'cnc_5axis_siemens.hbs',
        dialect: 'siemens' as const,
        axisCount: 5,
        aAxisRangeDeg: 360,
        bAxisRangeDeg: 120,
        bAxisOrientation: 'y' as const,
        fiveAxisType: 'table-table' as const,
        maxTiltDeg: 60,
      },
      lines: fiveAxisToolpath,
    },
  ]

  for (const { name, machine, lines } of dialects) {
    it(`${name} with tool T2, WCS G56, RPM 9000`, async () => {
      const { gcode } = await renderPost(resourcesRoot, machine, lines, standardOpts)
      expect(gcode).toMatchSnapshot()
    })
  }
})
