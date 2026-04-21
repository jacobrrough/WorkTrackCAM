import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { applyArcFitting, applyCutterCompensation, buildCutterCompLines, renderPost, sequenceMultiToolJob } from './post-process'

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
    const m4ax: MachineProfile = { ...machine, postTemplate: 'cnc_4axis_grbl.hbs', dialect: 'grbl_4axis', axisCount: 4 }
    const { gcode: g } = await renderPost(resourcesRoot, m4ax, [], { operationLabel: 'Rotary Contour' })
    expect(g).toContain('; Operation: Rotary Contour')
  })

  it('injects operation label comment in 5-axis Fanuc template', async () => {
    const m5f: MachineProfile = { ...machine, postTemplate: 'cnc_5axis_fanuc.hbs', dialect: 'fanuc', axisCount: 5 }
    const { gcode: g } = await renderPost(resourcesRoot, m5f, [], { operationLabel: '5-Axis Finish' })
    expect(g).toContain('; Operation: 5-Axis Finish')
  })

  it('injects operation label comment in 5-axis Siemens template', async () => {
    const m5s: MachineProfile = { ...machine, postTemplate: 'cnc_5axis_siemens.hbs', dialect: 'siemens', axisCount: 5 }
    const { gcode: g } = await renderPost(resourcesRoot, m5s, [], { operationLabel: 'TRAORI Contour' })
    expect(g).toContain('; Operation: TRAORI Contour')
  })

  it('operation label appears before toolpath lines', async () => {
    const lines = ['G0 X10 Y10 Z5', 'G1 X20 F800']
    const { gcode: g } = await renderPost(resourcesRoot, machine, lines, { operationLabel: 'Test Op' })
    const labelIdx = g.indexOf('; Operation: Test Op')
    const lineIdx = g.indexOf('G0 X10 Y10 Z5')
    expect(labelIdx).toBeGreaterThan(-1)
    expect(labelIdx).toBeLessThan(lineIdx)
  })
})

// ─── 4-axis template (cnc_4axis_grbl.hbs) ─────────────────────────────────────
describe('renderPost — cnc_4axis_grbl.hbs safety structure', () => {
  const machine4ax: MachineProfile = {
    ...machine,
    postTemplate: 'cnc_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4
  }

  it('emits M30 program end', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine4ax, [])
    expect(g).toContain('M30')
  })

  it('emits safe Z retract using machine workAreaMm.z before M30', async () => {
    // cnc_4axis_grbl.hbs uses {{machine.workAreaMm.z}} for the clearance retract
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
// only `cnc_4axis_grbl.hbs` is exercised. CPS imports for those dialects now
// repoint at GRBL.

// ─── 5-axis Fanuc template (cnc_5axis_fanuc.hbs) ──────────────────────────────
describe('renderPost — cnc_5axis_fanuc.hbs safety structure', () => {
  const machine5axFanuc: MachineProfile = {
    ...machine,
    postTemplate: 'cnc_5axis_fanuc.hbs',
    dialect: 'fanuc',
    axisCount: 5,
    fiveAxisType: 'table-head'
  }

  it('emits G43.4 RTCP activation in header', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('G43.4')
  })

  it('emits G49 to cancel RTCP/tool length compensation before retract', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('G49')
  })

  it('emits G0 A0 B0 to return rotary axes to zero before park', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('G0 A0 B0')
  })

  it('emits M30 program end', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('M30')
  })

  it('emits G40 G49 G80 safety reset in header', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    // Cancel cutter comp, tool length comp, canned cycles
    expect(g).toContain('G40')
    expect(g).toContain('G80')
  })

  it('emits 5-AXIS and Fanuc identifiers in header comment', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('5-AXIS')
    expect(g).toContain('Fanuc')
  })

  it('G49 appears after toolpath and before M30 (cancel RTCP before program end)', async () => {
    const lines = ['G1 X10 Y5 Z-1 A30 B15 F800']
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, lines)
    const lineIdx = g.indexOf('G1 X10 Y5 Z-1 A30 B15 F800')
    const g49Idx = g.lastIndexOf('G49')
    const m30Idx = g.lastIndexOf('M30')
    expect(lineIdx).toBeGreaterThan(-1)
    expect(g49Idx).toBeGreaterThan(lineIdx)
    expect(m30Idx).toBeGreaterThan(g49Idx)
  })

  it('emits kinematic type comment when fiveAxisType is set', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('table-head')
  })

  it('emits spindle on (fanuc M3 S10000) and spindle off (M5)', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axFanuc, [])
    expect(g).toContain('M3 S10000')
    expect(g).toContain('M5')
  })
})

// ─── 5-axis Siemens template (cnc_5axis_siemens.hbs) ─────────────────────────
describe('renderPost — cnc_5axis_siemens.hbs safety structure', () => {
  const machine5axSiemens: MachineProfile = {
    ...machine,
    postTemplate: 'cnc_5axis_siemens.hbs',
    dialect: 'siemens',
    axisCount: 5
  }

  it('emits TRAORI to activate 5-axis orientation transformation', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, [])
    expect(g).toContain('TRAORI')
  })

  it('emits TRAFOOF to deactivate transformation before retract', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, [])
    expect(g).toContain('TRAFOOF')
  })

  it('TRAFOOF appears after toolpath and before M30', async () => {
    const lines = ['G1 X10 Y5 Z-1 A30 B15 F800']
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, lines)
    const lineIdx = g.indexOf('G1 X10 Y5 Z-1 A30 B15 F800')
    const trafoodIdx = g.indexOf('TRAFOOF')
    const m30Idx = g.lastIndexOf('M30')
    expect(lineIdx).toBeGreaterThan(-1)
    expect(trafoodIdx).toBeGreaterThan(lineIdx)
    expect(m30Idx).toBeGreaterThan(trafoodIdx)
  })

  it('TRAORI appears before toolpath lines', async () => {
    const lines = ['G1 X10 Y5 Z-1 A30 B15 F800']
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, lines)
    const traoriIdx = g.indexOf('TRAORI')
    const lineIdx = g.indexOf('G1 X10 Y5 Z-1 A30 B15 F800')
    expect(traoriIdx).toBeGreaterThan(-1)
    expect(traoriIdx).toBeLessThan(lineIdx)
  })

  it('emits G0 A0 B0 to return rotary axes to zero', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, [])
    expect(g).toContain('G0 A0 B0')
  })

  it('emits M30 program end', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, [])
    expect(g).toContain('M30')
  })

  it('emits Siemens identifier in header comment', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, [])
    expect(g).toContain('Siemens')
  })

  it('emits spindle on (siemens M3 S10000) and spindle off (M5)', async () => {
    const { gcode: g } = await renderPost(resourcesRoot, machine5axSiemens, [])
    expect(g).toContain('M3 S10000')
    expect(g).toContain('M5')
  })
})

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

  it('5-axis Fanuc: emits correct H number in G43.4 when toolNumber provided', async () => {
    const fanuc5Machine: MachineProfile = { ...machine, postTemplate: 'cnc_5axis_fanuc.hbs', dialect: 'fanuc', axisCount: 5, fiveAxisType: 'table-head' }
    const { gcode: g } = await renderPost(resourcesRoot, fanuc5Machine, [], { toolNumber: 2 })
    expect(g).toContain('G43.4 H2')
    expect(g).not.toContain('G43.4 H1')
  })

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
    postTemplate: 'cnc_4axis_grbl.hbs',
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
