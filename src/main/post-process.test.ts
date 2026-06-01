import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  deriveAtcCapability,
  machineSupportsAtc
} from '../shared/post-process-atc-capability'
import {
  applyArcFitting,
  applyCutterCompensation,
  buildCutterCompLines,
  renderPost,
  sequenceMultiToolJob,
  __resetPostTemplateCache
} from './post-process'

const machine: MachineProfile = {
  id: 'test-mill',
  name: 'Test mill',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

const resourcesRoot = join(process.cwd(), 'resources')

describe('renderPost', () => {
  it('injects G54–G59 when workCoordinateIndex is set', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'], { workCoordinateIndex: 2 })
    expect(g).toContain('G55')
    expect(g).toMatch(/Active work offset/)
  })

  it('omits WCS line when index absent', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'])
    expect(g).not.toContain('Active work offset')
  })

  it('workCoordinateIndex=1 injects G54, index=6 injects G59', async () => {
    const { gcode: g1 } = await renderPost(resourcesRoot, machine, [], { workCoordinateIndex: 1 })
    expect(g1).toContain('G54')
    const { gcode: g6 } = await renderPost(resourcesRoot, machine, [], { workCoordinateIndex: 6 })
    expect(g6).toContain('G59')
  })

  it('workCoordinateIndex=0 and index=7 are out of range and omit WCS line', async () => {
    const { gcode: g0 } = await renderPost(resourcesRoot, machine, [], { workCoordinateIndex: 0 })
    expect(g0).not.toContain('Active work offset')
    const { gcode: g7 } = await renderPost(resourcesRoot, machine, [], { workCoordinateIndex: 7 })
    expect(g7).not.toContain('Active work offset')
  })

  it('grbl_4axis dialect emits Carvera-safe spindle RPM (S12000)', async () => {
    const m4: MachineProfile = { ...machine, dialect: 'grbl_4axis' }
    const { gcode: g } = await renderPost(resourcesRoot, m4, [])
    expect(g).toContain('M3 S12000')
  })

  it('fanuc dialect emits M3 S10000 spindle on', async () => {
    const mFanuc: MachineProfile = { ...machine, dialect: 'fanuc' }
    const { gcode: g } = await renderPost(resourcesRoot, mFanuc, [])
    expect(g).toContain('M3 S10000')
  })

  it('toolpath lines are emitted in order', async () => {
    const lines = ['G0 X0 Y0', 'G1 X10 F800', 'G0 X0 Y0']
    const { gcode: g } = await renderPost(resourcesRoot, machine, lines)
    const idx0 = g.indexOf('G0 X0 Y0')
    const idx1 = g.indexOf('G1 X10 F800')
    expect(idx0).toBeGreaterThan(-1)
    expect(idx1).toBeGreaterThan(idx0)
  })

  it('grbl dialect emits M3 S12000 spindle on', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [])
    // grbl is distinct from other dialects: S12000 vs S10000 (fanuc/siemens/etc.)
    expect(g).toContain('M3 S12000')
  })

  it('mach3 dialect emits M3 without RPM value (no S parameter)', async () => {
    const mMach3: MachineProfile = { ...machine, dialect: 'mach3' }
    const { gcode: g } = await renderPost(resourcesRoot, mMach3, [])
    // mach3 uses plain M3 (RPM set externally) — distinct from all S-value dialects
    expect(g).toContain('M3')
    expect(g).not.toContain('M3 S')
  })

  it('siemens dialect emits M3 S10000 spindle on', async () => {
    const mSiemens: MachineProfile = { ...machine, dialect: 'siemens' }
    const { gcode: g } = await renderPost(resourcesRoot, mSiemens, [])
    expect(g).toContain('M3 S10000')
  })

  it('heidenhain dialect emits M3 S10000 spindle on', async () => {
    const mHeid: MachineProfile = { ...machine, dialect: 'heidenhain' }
    const { gcode: g } = await renderPost(resourcesRoot, mHeid, [])
    expect(g).toContain('M3 S10000')
  })
})

// ─── cnc_generic_mm.hbs safety structure ──────────────────────────────────────
describe('renderPost — cnc_generic_mm.hbs safety structure', () => {
  it('emits M30 program end', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [])
    expect(g).toContain('M30')
  })

  it('emits safe Z retract using machine workAreaMm.z before M30', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [])
    expect(g).toContain(`G0 Z${machine.workAreaMm.z}`)
    const zRetractIdx = g.indexOf(`G0 Z${machine.workAreaMm.z}`)
    const m30Idx = g.lastIndexOf('M30')
    expect(zRetractIdx).toBeLessThan(m30Idx)
  })

  it('emits park XY (G0 X0 Y0) before M30', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [])
    expect(g).toContain('G0 X0 Y0')
    const parkIdx = g.indexOf('G0 X0 Y0')
    const m30Idx = g.lastIndexOf('M30')
    expect(parkIdx).toBeLessThan(m30Idx)
  })

  it('safe Z retract appears after spindle off (M5)', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [])
    const m5Idx = g.lastIndexOf('M5')
    const zRetractIdx = g.indexOf(`G0 Z${machine.workAreaMm.z}`)
    expect(m5Idx).toBeGreaterThan(-1)
    expect(zRetractIdx).toBeGreaterThan(m5Idx)
  })
})

// ─── operationLabel injection (all templates) ─────────────────────────────────
describe('renderPost — operationLabel injection', () => {
  it('injects operation label comment in generic template when provided', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [], { operationLabel: 'Rough Pass 1 — 8mm flat' })
    expect(g).toContain('; Operation: Rough Pass 1 — 8mm flat')
  })

  it('omits operation label comment in generic template when not provided', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [])
    expect(g).not.toContain('; Operation:')
  })

  it('injects operation label comment in 4-axis template', async () => {
    const m4ax: MachineProfile = { ...machine, postTemplate: 'carvera_4axis_grbl.hbs', dialect: 'grbl_4axis', axisCount: 4 }
    const { gcode: g } = await renderPost(resourcesRoot, m4ax, [], { operationLabel: 'Rotary Contour' })
    expect(g).toContain('; Operation: Rotary Contour')
  })

  // Note: the 5-axis Fanuc and 5-axis Siemens operationLabel injection tests
  // were removed in the June 2026 My-Shop-Only cleanup — the speculative
  // 5-axis Fanuc / Siemens post templates were deleted.

  it('operation label appears before toolpath lines', async () => {
    const lines = ['G0 X10 Y10 Z5', 'G1 X20 F800']
    const { gcode: g } = await renderPost(resourcesRoot, machine, lines, { operationLabel: 'Test Op' })
    const labelIdx = g.indexOf('; Operation: Test Op')
    const lineIdx = g.indexOf('G0 X10 Y10 Z5')
    expect(labelIdx).toBeGreaterThan(-1)
    expect(labelIdx).toBeLessThan(lineIdx)
  })
})

// ─── 4-axis template (carvera_4axis_grbl.hbs) ─────────────────────────────────
describe('renderPost — carvera_4axis_grbl.hbs safety structure', () => {
  const machine4ax: MachineProfile = {
    ...machine,
    postTemplate: 'carvera_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4
  }

  it('emits M30 program end', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, [])
    expect(g).toContain('M30')
  })

  it('emits safe Z retract using machine workAreaMm.z before M30', async () => {
    // carvera_4axis_grbl.hbs uses {{machine.workAreaMm.z}} for the clearance retract
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, [])
    expect(g).toContain(`G0 Z${machine4ax.workAreaMm.z}`)
  })

  it('emits spindle on (grbl_4axis S12000) and spindle off (M5)', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, [])
    expect(g).toContain('M3 S12000')
    expect(g).toContain('M5')
  })

  it('emits 4-AXIS identifier in header comment', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, [])
    expect(g).toContain('4-AXIS')
  })

  it('toolpath lines appear after spindle on and before M30', async () => {
    const lines = ['G0 X10 Y0 A0', 'G1 X10 Y10 A45 F800']
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, lines)
    const spindleOnIdx = g.indexOf('M3 S12000')
    const line1Idx = g.indexOf('G0 X10 Y0 A0')
    const m30Idx = g.lastIndexOf('M30')
    expect(spindleOnIdx).toBeGreaterThan(-1)
    expect(line1Idx).toBeGreaterThan(spindleOnIdx)
    expect(m30Idx).toBeGreaterThan(line1Idx)
  })

  it('injects WCS offset line when workCoordinateIndex is set', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, [], { workCoordinateIndex: 3 })
    expect(g).toContain('G56')
  })

  it('emits aAxisRangeDeg value in comment when provided', async () => {
    const m4axWithRange: MachineProfile = { ...machine4ax, aAxisRangeDeg: 360 }
    const { gcode: g } = await renderPost(resourcesRoot, m4axWithRange, [])
    expect(g).toContain('360')
  })
})

// Note: the Fanuc/Mach3/LinuxCNC/Siemens/Heidenhain 4-axis safety/structure
// describe blocks were removed in the April 2026 4-axis subsystem rewrite —
// only `carvera_4axis_grbl.hbs` (renamed from `cnc_4axis_grbl.hbs` in the
// pre-launch rank-16 cleanup) is exercised. CPS imports for those dialects
// now repoint at GRBL.

// Note: the 5-axis Fanuc and 5-axis Siemens safety-structure describe
// blocks were removed in the June 2026 My-Shop-Only cleanup — the
// speculative 5-axis post templates were deleted because none of the
// three target shops own a 5-axis machine.

// ─── toolNumber passthrough (ATC support) ───────────────────────────────────
describe('renderPost — toolNumber (ATC tool slot)', () => {
  const carveraMachine: MachineProfile = {
    ...machine,
    id: 'carvera-test',
    name: 'Carvera Test',
    postTemplate: 'carvera_3axis.hbs',
    dialect: 'grbl',
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000
  }

  it('Carvera 3-axis: defaults to T1 and H1 when toolNumber is not provided', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, carveraMachine, ['G0 X1 Y1'])
    expect(g).toContain('M6 T1')
    expect(g).toContain('G43 H1')
  })

  it('Carvera 3-axis: emits correct T and H numbers when toolNumber is provided', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, carveraMachine, ['G0 X1 Y1'], { toolNumber: 3 })
    expect(g).toContain('M6 T3')
    expect(g).toContain('G43 H3')
    expect(g).not.toContain('M6 T1')
    expect(g).not.toContain('G43 H1')
  })

  it('Carvera 3-axis: emits T6 for max ATC slot', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, carveraMachine, [], { toolNumber: 6 })
    expect(g).toContain('M6 T6')
    expect(g).toContain('G43 H6')
  })

  // Note: the Mach3/LinuxCNC/Heidenhain/Siemens 4-axis toolNumber tests were
  // removed in the April 2026 4-axis subsystem rewrite — only the GRBL/Carvera
  // templates remain for 4-axis output.

  // Note: the 5-axis Fanuc toolNumber test was removed in the June 2026
  // My-Shop-Only cleanup — the speculative 5-axis Fanuc post template was
  // deleted.

  it('generic template: no executable tool change lines affected by toolNumber', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine, [], { toolNumber: 3 })
    // Generic template mentions M6 only in guidance comments — no T3 M6 or M6 T3 executable lines
    expect(g).not.toContain('T3 M6')
    expect(g).not.toContain('M6 T3')
    expect(g).not.toContain('G43 H3')
  })
})

// ─── G93 inverse-time feed mode ──────────────────────────────────────────────
describe('renderPost — G93 inverse-time feed mode', () => {
  // The April 2026 4-axis subsystem rewrite removed the non-GRBL 4-axis
  // templates, so the inverse-time feed coverage now lives entirely on the
  // GRBL 4-axis post.
  const machine4axGrbl: MachineProfile = {
    ...machine,
    postTemplate: 'carvera_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4
  }

  it('GRBL 4-axis: emits G93 before toolpath when inverseTimeFeed=true', async () => {
    const lines = ['G1 X10 Y0 Z-1 A45 F2.5']
    const { gcode: g } = await renderPost(resourcesRoot, machine4axGrbl, lines, { inverseTimeFeed: true })
    const g93Idx = g.indexOf('G93')
    const lineIdx = g.indexOf('G1 X10 Y0 Z-1 A45 F2.5')
    expect(g93Idx).toBeGreaterThan(-1)
    expect(g93Idx).toBeLessThan(lineIdx)
  })

  it('GRBL 4-axis: emits G94 after toolpath when inverseTimeFeed=true', async () => {
    const lines = ['G1 X10 Y0 Z-1 A45 F2.5']
    const { gcode: g } = await renderPost(resourcesRoot, machine4axGrbl, lines, { inverseTimeFeed: true })
    const lineIdx = g.indexOf('G1 X10 Y0 Z-1 A45 F2.5')
    const g94Idx = g.indexOf('G94', lineIdx)
    expect(g94Idx).toBeGreaterThan(lineIdx)
  })

  it('GRBL 4-axis: does NOT emit G93 when inverseTimeFeed is absent', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4axGrbl, ['G1 X10 F800'])
    expect(g).not.toContain('G93')
    expect(g).not.toContain('inverse-time')
  })

  it('GRBL 4-axis: does NOT emit G94 restore when inverseTimeFeed is absent', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4axGrbl, ['G1 X10 F800'])
    expect(g).not.toContain('G94')
  })

  it('G93 comment mentions inverse-time feed mode', async () => {
    const lines = ['G1 X10 A45 F2.5']
    const { gcode: g } = await renderPost(resourcesRoot, machine4axGrbl, lines, { inverseTimeFeed: true })
    expect(g.toLowerCase()).toContain('inverse-time')
  })
})

// ─── sequenceMultiToolJob ───────────────────────────────────────────────────
describe('sequenceMultiToolJob', () => {
  it('returns empty string for empty blocks array', () => {
    expect(sequenceMultiToolJob([], 100)).toBe('')
  })

  it('returns single block unchanged', () => {
    const gcode = 'G0 X0\nG1 X10 F800\nM30'
    const result = sequenceMultiToolJob([{ toolSlot: 1, gcode }], 100)
    expect(result).toBe(gcode)
  })

  it('inserts M6 tool change between blocks with different tool slots', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'G1 X10 F800' },
      { toolSlot: 2, gcode: 'G1 X20 F600' }
    ], 50)
    expect(result).toContain('T2 M6')
    expect(result).toContain('M5')
    expect(result).toContain('G0 Z50')
  })

  it('M5 spindle stop appears before tool change', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'G1 X10 F800' },
      { toolSlot: 3, gcode: 'G1 X20 F600' }
    ], 80)
    const m5Idx = result.indexOf('M5')
    const t3Idx = result.indexOf('T3 M6')
    expect(m5Idx).toBeGreaterThan(-1)
    expect(t3Idx).toBeGreaterThan(m5Idx)
  })

  it('safe Z retract appears before tool change command', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'G1 X10 F800' },
      { toolSlot: 2, gcode: 'G1 X20 F600' }
    ], 75)
    const zRetractIdx = result.indexOf('G0 Z75')
    const toolChangeIdx = result.indexOf('T2 M6')
    expect(zRetractIdx).toBeGreaterThan(-1)
    expect(zRetractIdx).toBeLessThan(toolChangeIdx)
  })

  it('does NOT insert M6 when consecutive blocks use the same tool', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'G1 X10 F800' },
      { toolSlot: 1, gcode: 'G1 X20 F600' }
    ], 50)
    expect(result).not.toContain('M6')
    expect(result).toContain('same tool T1')
  })

  it('handles three blocks with alternating tools', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'OP1' },
      { toolSlot: 2, gcode: 'OP2' },
      { toolSlot: 1, gcode: 'OP3' }
    ], 100)
    expect(result).toContain('T2 M6')
    expect(result).toContain('T1 M6')
    // Both OP2 and OP3 should follow their respective tool changes
    const t2Idx = result.indexOf('T2 M6')
    const op2Idx = result.indexOf('OP2')
    expect(op2Idx).toBeGreaterThan(t2Idx)
  })

  it('includes operation label in tool change comment when provided', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'OP1' },
      { toolSlot: 2, gcode: 'OP2', label: 'Finishing Pass' }
    ], 50)
    expect(result).toContain('Finishing Pass')
  })

  it('uses custom comment prefix', () => {
    const result = sequenceMultiToolJob([
      { toolSlot: 1, gcode: 'OP1' },
      { toolSlot: 2, gcode: 'OP2' }
    ], 50, '( ')
    expect(result).toContain('( --- TOOL CHANGE')
  })

  it('omits M6 when tool changes are disabled (manual-change workflow)', () => {
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: 'OP1' },
        { toolSlot: 2, gcode: 'OP2' }
      ],
      50,
      '; ',
      { supportsToolChange: false }
    )
    expect(result).not.toContain('M6')
    expect(result).toContain('Manual tool change required')
  })
})

// ─── Arc fitting integration (applyArcFitting) ──────────────────────────────
describe('applyArcFitting', () => {
  it('passes through non-G1 lines unchanged', () => {
    const lines = ['G0 X0 Y0 Z5', 'M3 S10000', '; comment']
    const result = applyArcFitting(lines, 0.01)
    expect(result).toEqual(lines)
  })

  it('passes through G1 lines when fewer than 3', () => {
    const lines = ['G1 X1 Y0 Z0 F800', 'G1 X2 Y0 Z0 F800']
    const result = applyArcFitting(lines, 0.01)
    expect(result).toEqual(lines)
  })

  it('converts circular G1 sequences to G2/G3 arcs', () => {
    // Generate a quarter circle of G1 moves
    const r = 10
    const n = 16
    const lines: string[] = []
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * (Math.PI / 2)
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z0 F800`)
    }
    const result = applyArcFitting(lines, 0.01)

    // Should contain at least one G2 or G3 arc
    const hasArc = result.some(l => l.startsWith('G2') || l.startsWith('G3'))
    expect(hasArc).toBe(true)

    // Should be fewer lines than original (arcs compress multiple G1s)
    expect(result.length).toBeLessThan(lines.length)
  })

  it('preserves non-G1 lines between arc sections', () => {
    // G1 arc section, then a G0 rapid, then more G1s
    const lines = [
      'G1 X10 Y0 Z0 F800',
      'G1 X7.07 Y7.07 Z0 F800',
      'G1 X0 Y10 Z0 F800',
      'G0 X20 Y20 Z5',
      'G1 X30 Y20 Z0 F800'
    ]
    const result = applyArcFitting(lines, 0.5)

    // G0 rapid should still be present
    expect(result.some(l => l.startsWith('G0'))).toBe(true)
  })

  it('produces G-code lines with correct I/J center offsets', () => {
    // Well-defined semicircle: center at (0,0), radius 10, from (10,0) to (-10,0)
    const r = 10
    const n = 32
    const lines: string[] = []
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * Math.PI
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z0 F800`)
    }
    const result = applyArcFitting(lines, 0.01)

    // Find the arc line
    const arcLine = result.find(l => /^G[23]\s/.test(l))
    expect(arcLine).toBeDefined()

    // Arc should contain I and J offset values
    expect(arcLine).toMatch(/I[+-]?\d/)
    expect(arcLine).toMatch(/J[+-]?\d/)
  })

  it('straight-line G1 sequences are not converted to arcs', () => {
    const lines = [
      'G1 X0 Y0 Z0 F800',
      'G1 X10 Y0 Z0 F800',
      'G1 X20 Y0 Z0 F800',
      'G1 X30 Y0 Z0 F800'
    ]
    const result = applyArcFitting(lines, 0.01)

    // All should still be G1
    for (const line of result) {
      expect(line).toMatch(/^G1\s/)
    }
  })
})

// ─── Arc fitting via renderPost integration ──────────────────────────────────
describe('renderPost — arc fitting integration', () => {
  it('applies arc fitting when enableArcFitting is true', async () => {
    // Generate a quarter circle of G1 moves
    const r = 10
    const n = 16
    const lines: string[] = []
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * (Math.PI / 2)
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z0 F800`)
    }

    const { gcode } = await renderPost(resourcesRoot, machine, lines, { enableArcFitting: true, arcTolerance: 0.01 })

    // Should contain G2 or G3 arc commands
    expect(gcode).toMatch(/G[23]\s+X/)
  })

  it('does not apply arc fitting when enableArcFitting is false/absent', async () => {
    const r = 10
    const n = 16
    const lines: string[] = []
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * (Math.PI / 2)
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z0 F800`)
    }

    const { gcode } = await renderPost(resourcesRoot, machine, lines)

    // Original G1 lines should be present unchanged
    expect(gcode).toContain('G1 X10.0000')
    // Should NOT contain G2/G3 since arc fitting is off
    expect(gcode).not.toMatch(/^G[23]\s+X/m)
  })
})

// ─── Cutter compensation (G41/G42/G40) ──────────────────────────────────────
describe('buildCutterCompLines', () => {
  it('returns null for mode "none"', () => {
    expect(buildCutterCompLines('none')).toBeNull()
  })

  it('returns G41 for left compensation', () => {
    const result = buildCutterCompLines('left')
    expect(result).not.toBeNull()
    expect(result!.engage).toBe('G41')
    expect(result!.cancel).toBe('G40')
  })

  it('returns G42 for right compensation', () => {
    const result = buildCutterCompLines('right')
    expect(result).not.toBeNull()
    expect(result!.engage).toBe('G42')
    expect(result!.cancel).toBe('G40')
  })

  it('includes D register when provided', () => {
    const result = buildCutterCompLines('left', 3)
    expect(result!.engage).toBe('G41 D3')
  })

  it('includes D register for right compensation', () => {
    const result = buildCutterCompLines('right', 15)
    expect(result!.engage).toBe('G42 D15')
  })
})

describe('applyCutterCompensation', () => {
  it('returns lines unchanged for mode "none"', () => {
    const lines = ['G0 X0 Y0', 'G1 X10 F800', 'G1 X20 F800']
    const result = applyCutterCompensation(lines, 'none')
    expect(result).toEqual(lines)
  })

  it('inserts G41 before first feed move and G40 after last feed move', () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y0 Z0 F800', 'G1 X20 Y10 Z0 F800']
    const result = applyCutterCompensation(lines, 'left')

    // G41 should appear before the first G1
    const g41Idx = result.indexOf('G41')
    const firstG1Idx = result.findIndex(l => l.startsWith('G1'))
    expect(g41Idx).toBeGreaterThan(-1)
    expect(g41Idx).toBeLessThan(firstG1Idx)

    // G40 should appear after the last G1
    const g40Idx = result.lastIndexOf('G40')
    const lastG1Idx = result.length - 1 - [...result].reverse().findIndex(l => l.startsWith('G1'))
    expect(g40Idx).toBeGreaterThan(lastG1Idx)
  })

  it('inserts G42 for right compensation', () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 F800']
    const result = applyCutterCompensation(lines, 'right')
    expect(result).toContain('G42')
    expect(result).toContain('G40')
  })

  it('includes D register in G41/G42', () => {
    const lines = ['G1 X10 F800', 'G1 X20 F800']
    const result = applyCutterCompensation(lines, 'left', 5)
    expect(result).toContain('G41 D5')
    expect(result).toContain('G40')
  })

  it('returns lines unchanged when no feed moves present', () => {
    const lines = ['G0 X0 Y0 Z5', 'G0 X10 Y10 Z5']
    const result = applyCutterCompensation(lines, 'left')
    expect(result).toEqual(lines)
  })

  it('handles G2/G3 arcs as feed moves for compensation placement', () => {
    const lines = ['G0 X0 Y0 Z5', 'G2 X10 Y10 I5 J0 F800', 'G1 X20 Y10 F800']
    const result = applyCutterCompensation(lines, 'right', 2)

    // G42 should appear before the first feed move (G2)
    const g42Idx = result.indexOf('G42 D2')
    const g2Idx = result.findIndex(l => l.startsWith('G2'))
    expect(g42Idx).toBeGreaterThan(-1)
    expect(g42Idx).toBeLessThan(g2Idx)

    // G40 should appear after the last feed move (G1)
    expect(result).toContain('G40')
  })
})

// ─── Cutter compensation via renderPost integration ──────────────────────────
describe('renderPost — cutter compensation integration', () => {
  it('inserts G41 when cutterCompensation is "left"', async () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y0 Z0 F800', 'G1 X20 Y10 Z0 F800']
    const { gcode } = await renderPost(resourcesRoot, machine, lines, {
      cutterCompensation: 'left'
    })
    expect(gcode).toContain('G41')
    expect(gcode).toContain('G40')
  })

  it('inserts G42 with D register when cutterCompensation is "right"', async () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y0 Z0 F800']
    const { gcode } = await renderPost(resourcesRoot, machine, lines, {
      cutterCompensation: 'right',
      cutterCompDRegister: 7
    })
    expect(gcode).toContain('G42 D7')
    expect(gcode).toContain('G40')
  })

  it('does not insert compensation codes when cutterCompensation is "none"', async () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 F800']
    const { gcode } = await renderPost(resourcesRoot, machine, lines, {
      cutterCompensation: 'none'
    })
    expect(gcode).not.toMatch(/^G4[12]\b/m)
  })

  it('does not insert compensation codes when cutterCompensation is omitted', async () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 F800']
    const { gcode } = await renderPost(resourcesRoot, machine, lines)
    expect(gcode).not.toMatch(/^G4[12]\b/m)
  })

  it('G41/G42 appears before first feed move and G40 after last feed move in rendered output', async () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y0 Z0 F800', 'G1 X20 Y10 Z0 F800', 'G1 X30 Y10 Z0 F800']
    const { gcode } = await renderPost(resourcesRoot, machine, lines, {
      cutterCompensation: 'left',
      cutterCompDRegister: 3
    })

    const g41Idx = gcode.indexOf('G41 D3')
    const firstG1Idx = gcode.indexOf('G1 X10')
    const lastG1Idx = gcode.lastIndexOf('G1 X30')
    const g40Idx = gcode.indexOf('G40', lastG1Idx)

    expect(g41Idx).toBeGreaterThan(-1)
    expect(g41Idx).toBeLessThan(firstG1Idx)
    expect(g40Idx).toBeGreaterThan(lastG1Idx)
  })

  it('arc fitting and cutter compensation work together', async () => {
    // Generate a quarter circle + straight section
    const r = 10
    const n = 16
    const lines: string[] = []
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * (Math.PI / 2)
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z0 F800`)
    }
    lines.push('G1 X-5 Y10 Z0 F800')
    lines.push('G1 X-10 Y10 Z0 F800')

    const { gcode } = await renderPost(resourcesRoot, machine, lines, {
      enableArcFitting: true,
      arcTolerance: 0.01,
      cutterCompensation: 'right',
      cutterCompDRegister: 2
    })

    // Should have arcs from arc fitting
    expect(gcode).toMatch(/G[23]\s+X/)
    // Should have cutter compensation
    expect(gcode).toContain('G42 D2')
    expect(gcode).toContain('G40')
  })
})

// ─── [ID-0143] compiled-post-template cache ─────────────────────────────────

describe('renderPost -- [ID-0143] compiled-post-template cache', () => {
  // The cache is byte-identical to the uncached path: same compiled
  // Handlebars delegate, no runtime context mutation. These tests pin the
  // contract so a future refactor cannot silently regress snapshot stability
  // or warning-array isolation.

  it('returns identical gcode for back-to-back calls with the same machine', async () => {
    __resetPostTemplateCache()
    const { gcode: a } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1', 'G1 X2 Y2 F500'])
    const { gcode: b } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1', 'G1 X2 Y2 F500'])
    expect(a).toBe(b)
    // Cache hit MUST produce a non-empty result (regression guard against the
    // race where the cache stores an unresolved/rejected promise).
    expect(a.length).toBeGreaterThan(0)
    expect(a).toContain('G21')
  })

  it('produces identical output before and after a cache reset', async () => {
    const lines = ['G0 X3 Y3', 'G1 X5 Y5 F800']
    const { gcode: pre } = await renderPost(resourcesRoot, machine, lines)
    __resetPostTemplateCache()
    const { gcode: post } = await renderPost(resourcesRoot, machine, lines)
    expect(post).toBe(pre)
  })

  it('keeps warnings per-call (not cached) when render context differs', async () => {
    __resetPostTemplateCache()
    // Two back-to-back calls with different spindleRpm settings: the second
    // must NOT inherit the first call's spindleWarning.
    const lowMachine: MachineProfile = {
      ...machine,
      maxSpindleRpm: 8000
    }
    const { warnings: w1 } = await renderPost(
      resourcesRoot,
      lowMachine,
      ['G0 X0 Y0', 'G1 X1 Y1 F500'],
      { spindleRpm: 12000 } // exceeds maxSpindleRpm -> clamp warning
    )
    const { warnings: w2 } = await renderPost(
      resourcesRoot,
      lowMachine,
      ['G0 X0 Y0', 'G1 X1 Y1 F500'],
      { spindleRpm: 6000 } // within range -> no clamp warning
    )
    // First call MUST report the clamp; second MUST NOT carry it over.
    const w1HasClamp = w1.some((w) => /spindle/i.test(w) || /rpm/i.test(w) || /clamp/i.test(w))
    const w2HasClamp = w2.some((w) => /spindle/i.test(w) || /rpm/i.test(w) || /clamp/i.test(w))
    expect(w1HasClamp).toBe(true)
    expect(w2HasClamp).toBe(false)
  })

  it('serves multiple distinct templates from independent cache entries', async () => {
    __resetPostTemplateCache()
    const grblMachine = machine // grbl + cnc_generic_mm.hbs
    const carvera4: MachineProfile = {
      ...machine,
      id: 'carvera-4axis-cache-probe',
      postTemplate: 'carvera_4axis.hbs',
      dialect: 'grbl_4axis',
      axisCount: 4
    }
    const { gcode: g1 } = await renderPost(resourcesRoot, grblMachine, ['G0 X1 Y1'])
    const { gcode: g2 } = await renderPost(resourcesRoot, carvera4, ['G0 X1 Y0 Z5 A0'])
    // Distinct templates produce distinct headers (carvera_4axis.hbs has the
    // 4-axis toolpath markers; cnc_generic_mm.hbs does not).
    expect(g1).not.toBe(g2)
    expect(g1.length).toBeGreaterThan(0)
    expect(g2.length).toBeGreaterThan(0)
    // Re-running each call still returns identical output -> cache served both.
    const { gcode: g1b } = await renderPost(resourcesRoot, grblMachine, ['G0 X1 Y1'])
    const { gcode: g2b } = await renderPost(resourcesRoot, carvera4, ['G0 X1 Y0 Z5 A0'])
    expect(g1b).toBe(g1)
    expect(g2b).toBe(g2)
  })
})

// ─── sequenceMultiToolJob × deriveAtcCapability integration [ID-0151] ───────
//
// Cycle 57 -- Integration-layer test coverage wiring `deriveAtcCapability`
// (Cycle 55 [ID-0093]) through `sequenceMultiToolJob.opts.supportsToolChange`
// for every machine in the bundled fleet (CLAUDE.md USER CONTEXT three +
// Carvera 3-axis sibling). The helper is unit-pinned in
// `src/shared/post-process-atc-capability.test.ts`; the sequencer is
// unit-pinned in the `sequenceMultiToolJob` describe above. This block
// pins the *wiring contract*: the boolean produced by the helper drives
// the boolean consumed by the sequencer, and the resulting G-code shape
// matches each machine's CLAUDE.md USER CONTEXT (K2 Plus = FDM, no ATC;
// Laguna Swift 5×10 = manual ER-20, no ATC; Carvera 3-axis = T1-T6 + T0
// probe; Carvera 4-axis = rotary occupies the bay, no ATC).
describe('sequenceMultiToolJob × deriveAtcCapability integration [ID-0151]', () => {
  const profilesRoot = join(process.cwd(), 'resources', 'machines')

  function loadBundledProfile(filename: string): MachineProfile {
    return machineProfileSchema.parse(
      JSON.parse(readFileSync(join(profilesRoot, filename), 'utf-8'))
    )
  }

  // Two distinct tool blocks reused across the table so the byte-shape
  // comparisons across machines are isolated to the gate boolean.
  const blocks = [
    { toolSlot: 1, gcode: 'G1 X10 F800', label: 'Roughing' },
    { toolSlot: 2, gcode: 'G1 X20 F600', label: 'Finishing' }
  ] as const

  it('K2 Plus FDM: helper.supported=false (reason=fdm) AND sequencer omits M6', () => {
    const k2 = loadBundledProfile('creality-k2-plus.json')
    const cap = deriveAtcCapability(k2)
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('fdm')
    const result = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).not.toContain('M6')
    expect(result).toContain('Manual tool change required: load T2')
  })

  it('Laguna Swift 5×10: helper.supported=false (reason=no-atc-slots) AND sequencer omits M6', () => {
    const laguna = loadBundledProfile('laguna-swift-5x10.json')
    const cap = deriveAtcCapability(laguna)
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('no-atc-slots')
    const result = sequenceMultiToolJob([...blocks], 25, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).not.toContain('M6')
    expect(result).toContain('Manual tool change required: load T2')
  })

  it('Carvera 3-axis: helper.supported=true (slotCount=6, probeSlot=0) AND sequencer emits T2 M6', () => {
    const carvera3 = loadBundledProfile('makera-carvera-3axis.json')
    const cap = deriveAtcCapability(carvera3)
    expect(cap.supported).toBe(true)
    if (cap.supported) {
      expect(cap.slotCount).toBe(6)
      expect(cap.probeSlot).toBe(0)
    }
    const result = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).toContain('T2 M6')
    expect(result).not.toContain('Manual tool change required')
  })

  it('Carvera 4-axis: helper.supported=false (reason=no-atc-slots, rotary occupies bay) AND sequencer omits M6', () => {
    const carvera4 = loadBundledProfile('makera-carvera-4axis.json')
    const cap = deriveAtcCapability(carvera4)
    expect(cap.supported).toBe(false)
    // Carvera 4-axis intentionally omits atcSlotCount in the bundled
    // JSON (rotary chuck occupies the ATC bay); the helper must surface
    // this as no-atc-slots, NOT as fdm (the machine is still kind=cnc).
    if (!cap.supported) expect(cap.reason).toBe('no-atc-slots')
    const result = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).not.toContain('M6')
    expect(result).toContain('Manual tool change required: load T2')
  })

  it('wiring contract: machineSupportsAtc(profile) === deriveAtcCapability(profile).supported drives byte-identical sequencer output', () => {
    // The convenience predicate must produce the same gate boolean as
    // the discriminated-union helper, end-to-end through the sequencer.
    for (const filename of [
      'creality-k2-plus.json',
      'laguna-swift-5x10.json',
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json'
    ] as const) {
      const profile = loadBundledProfile(filename)
      const viaPredicate = sequenceMultiToolJob([...blocks], 50, '; ', {
        supportsToolChange: machineSupportsAtc(profile)
      })
      const viaUnion = sequenceMultiToolJob([...blocks], 50, '; ', {
        supportsToolChange: deriveAtcCapability(profile).supported
      })
      expect(viaPredicate).toBe(viaUnion)
    }
  })

  it('same-tool blocks short-circuit the gate (M6 omitted regardless of capability)', () => {
    // Regression pin: when consecutive blocks share a tool slot the
    // sequencer never emits ANY tool-change separator, so the ATC-
    // capability gate has no effect. Pinning this on the Carvera 3-axis
    // (the ONLY bundled machine where supportsToolChange flips to true)
    // protects against a future "always insert M6 when supported" bug.
    const carvera3 = loadBundledProfile('makera-carvera-3axis.json')
    const sameTool = [
      { toolSlot: 1, gcode: 'OP_A', label: 'Roughing' },
      { toolSlot: 1, gcode: 'OP_B', label: 'Spring pass' }
    ] as const
    const result = sequenceMultiToolJob([...sameTool], 50, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    expect(result).not.toContain('M6')
    expect(result).not.toContain('Manual tool change required')
    expect(result).toContain('same tool T1')
  })

  it('three-block alternating tools (T1→T2→T1) on Carvera 3-axis emits exactly two M6 sequences', () => {
    const carvera3 = loadBundledProfile('makera-carvera-3axis.json')
    const trio = [
      { toolSlot: 1, gcode: 'OP1' },
      { toolSlot: 2, gcode: 'OP2', label: 'Finishing' },
      { toolSlot: 1, gcode: 'OP3' }
    ]
    const result = sequenceMultiToolJob(trio, 50, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    expect(result).toContain('T2 M6')
    expect(result).toContain('T1 M6')
    // Exactly two `Tn M6` tool-change directives -- one per tool transition.
    const m6Count = (result.match(/T\d+ M6/g) ?? []).length
    expect(m6Count).toBe(2)
    // The "Manual tool change required" hint must NOT leak in when ATC
    // is supported, even with multiple transitions.
    expect(result).not.toContain('Manual tool change required')
  })

  it('bundled-fleet table: every supported=false machine emits manual-hint AND zero M6; every supported=true machine emits ≥1 M6 AND zero manual-hint', () => {
    const fleet = [
      'creality-k2-plus.json',
      'laguna-swift-5x10.json',
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json'
    ] as const
    let supportedCount = 0
    let unsupportedCount = 0
    for (const filename of fleet) {
      const profile = loadBundledProfile(filename)
      const cap = deriveAtcCapability(profile)
      const result = sequenceMultiToolJob([...blocks], 50, '; ', {
        supportsToolChange: cap.supported
      })
      if (cap.supported) {
        supportedCount += 1
        expect(result, `${filename} should emit M6`).toMatch(/T\d+ M6/)
        expect(result, `${filename} should NOT emit manual-hint`).not.toContain(
          'Manual tool change required'
        )
      } else {
        unsupportedCount += 1
        expect(result, `${filename} should NOT emit M6`).not.toContain('M6')
        expect(result, `${filename} should emit manual-hint`).toContain(
          'Manual tool change required'
        )
      }
    }
    // CLAUDE.md USER CONTEXT pinning: of the 4 bundled machines, exactly
    // ONE supports ATC (Carvera 3-axis) and THREE do not (K2 Plus FDM,
    // Laguna manual ER-20, Carvera 4-axis rotary-occupies-bay). Any
    // future bundled-profile addition that flips this count must be
    // accompanied by an intentional update to this assertion -- the
    // count is a CLAUDE.md fleet-shape invariant, not an implementation
    // detail.
    expect(supportedCount).toBe(1)
    expect(unsupportedCount).toBe(3)
  })
})

// ─── sequenceMultiToolJob × G43 H<n> tool-length comp [ID-0013-followup] ───
//
// Cycle 60 -- Post-processing follow-up to Cycle 59's discovery: the per-job
// preamble in `resources/posts/carvera_3axis.hbs` emits `G43 H<n>` after
// the initial `M6 T<n>` (template lines 48-49), but `sequenceMultiToolJob`
// did NOT emit G43 H<n> after each MID-job tool change. Without G43 H<n>
// re-apply, a longer tool inserted after a shorter one leaves the
// controller using the previous offset and the first feed move can drive
// Z below the programmed depth -- a Safety-Rule-1 crash on the Carvera
// ATC. This block pins the new `opts.emitToolLengthComp` flag.
//
// Default behavior (flag absent or false) is byte-identical to pre-Cycle-60
// (Safety Rule 2). When true AND `supportsToolChange !== false`, every
// `T<n> M6` is immediately followed by `G43 H<n>` with matching tool
// number. When `supportsToolChange === false`, neither M6 nor G43 H<n>
// is emitted -- the manual-change comment stands alone (no tool length
// register to reset, the operator handles offsets manually).
describe('sequenceMultiToolJob × G43 H<n> tool-length comp [ID-0013-followup]', () => {
  const profilesRoot = join(process.cwd(), 'resources', 'machines')

  function loadBundledProfile(filename: string): MachineProfile {
    return machineProfileSchema.parse(
      JSON.parse(readFileSync(join(profilesRoot, filename), 'utf-8'))
    )
  }

  const blocks = [
    { toolSlot: 1, gcode: 'G1 X10 F800', label: 'Roughing' },
    { toolSlot: 2, gcode: 'G1 X20 F600', label: 'Finishing' }
  ] as const

  it('Safety Rule 2: emitToolLengthComp omitted -> byte-identical to pre-Cycle-60 (no G43 H)', () => {
    const baseline = sequenceMultiToolJob([...blocks], 50, '; ', { supportsToolChange: true })
    const explicit = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: false
    })
    expect(baseline).toBe(explicit)
    expect(baseline).not.toMatch(/G43\s+H\d+/)
  })

  it('emitToolLengthComp=true emits `G43 H<n>` immediately after `T<n> M6` (ordering pin)', () => {
    const result = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: true
    })
    expect(result).toContain('T2 M6')
    expect(result).toContain('G43 H2')
    const t2Idx = result.indexOf('T2 M6')
    const g43Idx = result.indexOf('G43 H2')
    expect(g43Idx).toBeGreaterThan(t2Idx)
    // No intervening lines between M6 and G43 H<n> -- the controller must
    // re-apply the offset BEFORE the next operation's first feed move.
    const between = result.slice(t2Idx + 'T2 M6'.length, g43Idx)
    expect(between).toBe('\n')
  })

  it('G43 H<n> tool number matches M6 tool number across alternating blocks', () => {
    const trio = [
      { toolSlot: 1, gcode: 'OP1' },
      { toolSlot: 3, gcode: 'OP3', label: 'Drilling' },
      { toolSlot: 5, gcode: 'OP5', label: 'Chamfer' }
    ]
    const result = sequenceMultiToolJob(trio, 50, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: true
    })
    // Tool transitions: T1 -> T3, T3 -> T5. Two M6 lines, two matching G43 H.
    expect(result).toContain('T3 M6')
    expect(result).toContain('G43 H3')
    expect(result).toContain('T5 M6')
    expect(result).toContain('G43 H5')
    // No spurious G43 H1 (tool 1 was already loaded; preamble handled its offset).
    expect(result).not.toContain('G43 H1')
  })

  it('emitToolLengthComp=true + supportsToolChange=false: NEITHER M6 NOR G43 H emitted', () => {
    // Manual-change workflow: the operator sets length offsets at the
    // controller; emitting `G43 H<n>` against a missing M6 would assert
    // a length register that the operator has not configured.
    const result = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: false,
      emitToolLengthComp: true
    })
    expect(result).not.toContain('M6')
    expect(result).not.toMatch(/G43\s+H\d+/)
    expect(result).toContain('Manual tool change required: load T2')
  })

  it('same-tool consecutive blocks with emitToolLengthComp=true: NO G43 H (no offset change)', () => {
    const sameTool = [
      { toolSlot: 1, gcode: 'OP_A', label: 'Roughing' },
      { toolSlot: 1, gcode: 'OP_B', label: 'Spring pass' }
    ]
    const result = sequenceMultiToolJob(sameTool, 50, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: true
    })
    expect(result).not.toContain('M6')
    expect(result).not.toMatch(/G43\s+H\d+/)
    expect(result).toContain('same tool T1')
  })

  it('three-block alternating T1 → T2 → T1 emits exactly 2 G43 H lines (one per tool change)', () => {
    const trio = [
      { toolSlot: 1, gcode: 'OP1' },
      { toolSlot: 2, gcode: 'OP2', label: 'Finishing' },
      { toolSlot: 1, gcode: 'OP3' }
    ]
    const result = sequenceMultiToolJob(trio, 50, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: true
    })
    const m6Count = (result.match(/T\d+ M6/g) ?? []).length
    const g43Count = (result.match(/G43\s+H\d+/g) ?? []).length
    expect(m6Count).toBe(2)
    expect(g43Count).toBe(2)
    // Order pin: T2 M6 -> G43 H2 -> OP2 -> T1 M6 -> G43 H1 -> OP3
    const t2Idx = result.indexOf('T2 M6')
    const g43H2Idx = result.indexOf('G43 H2')
    const op2Idx = result.indexOf('OP2')
    const t1Idx = result.indexOf('T1 M6')
    const g43H1Idx = result.indexOf('G43 H1')
    const op3Idx = result.indexOf('OP3')
    expect(t2Idx).toBeLessThan(g43H2Idx)
    expect(g43H2Idx).toBeLessThan(op2Idx)
    expect(op2Idx).toBeLessThan(t1Idx)
    expect(t1Idx).toBeLessThan(g43H1Idx)
    expect(g43H1Idx).toBeLessThan(op3Idx)
  })

  it('Carvera 3-axis end-to-end: machineSupportsAtc + emitToolLengthComp=true wires G43 H<n> through the helper', () => {
    const carvera3 = loadBundledProfile('makera-carvera-3axis.json')
    const cap = deriveAtcCapability(carvera3)
    expect(cap.supported).toBe(true)
    const result = sequenceMultiToolJob([...blocks], 50, '; ', {
      supportsToolChange: cap.supported,
      emitToolLengthComp: cap.supported
    })
    expect(result).toContain('T2 M6')
    expect(result).toContain('G43 H2')
    // CLAUDE.md USER CONTEXT #3: T0 reserved as wireless probe; mid-job
    // changes use T1-T6. The helper.probeSlot pin in the [ID-0151] block
    // already guards probe-slot semantics; here we pin that the G43 H
    // number tracks the working-tool slot, never the probe slot.
    if (cap.supported) {
      expect(cap.probeSlot).toBe(0)
      expect(result).not.toContain('G43 H0')
    }
  })

  it('non-ATC machine via helper: emitToolLengthComp=true is suppressed by supportsToolChange=false', () => {
    // Defense-in-depth: even when the integration layer requests G43 H,
    // a non-ATC machine (Laguna, K2 Plus FDM, Carvera 4-axis rotary)
    // must NOT see G43 H emissions because there is no M6 to follow.
    for (const filename of [
      'creality-k2-plus.json',
      'laguna-swift-5x10.json',
      'makera-carvera-4axis.json'
    ] as const) {
      const profile = loadBundledProfile(filename)
      const cap = deriveAtcCapability(profile)
      expect(cap.supported).toBe(false)
      const result = sequenceMultiToolJob([...blocks], 50, '; ', {
        supportsToolChange: cap.supported,
        emitToolLengthComp: true
      })
      expect(result, `${filename} must not emit M6`).not.toContain('M6')
      expect(result, `${filename} must not emit G43 H`).not.toMatch(/G43\s+H\d+/)
    }
  })

  it('custom commentPrefix is preserved; G43 H is plain G-code (no prefix)', () => {
    // Mach3-style `( ` comment prefix should not bleed into the G43 line.
    const result = sequenceMultiToolJob([...blocks], 50, '( ', {
      supportsToolChange: true,
      emitToolLengthComp: true
    })
    expect(result).toContain('( --- TOOL CHANGE')
    expect(result).toContain('T2 M6')
    expect(result).toContain('G43 H2')
    // The G43 line is a real G-code command, not a comment.
    expect(result).not.toContain('( G43 H2')
  })
})
