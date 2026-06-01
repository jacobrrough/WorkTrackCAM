/**
 * Post-processor dialect diff tests — safety headers and footers.
 *
 * For each dialect template, generate G-code and verify line-by-line that safety
 * headers (units, absolute mode, WCS, tool call) and footers (spindle off, coolant
 * off, safe Z, program end) are present and correct.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

const toolpathLines = ['G0 X10 Y10 Z5', 'G1 X20 Y20 Z-2 F600']
const fourAxisLines = ['G0 X10 Y0 Z5 A0', 'G1 X10 Z-2 A90 F400']
// fiveAxisLines (5-axis test toolpath) was removed alongside the speculative
// 5-axis Fanuc / Siemens post templates in the June 2026 My-Shop-Only
// cleanup — no surviving describe block exercises 5-axis output.

const baseMachine: MachineProfile = {
  id: 'safety-test',
  name: 'Safety Test Mill',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: split G-code into non-empty trimmed lines
// ─────────────────────────────────────────────────────────────────────────────

function gcodeLines(gcode: string): string[] {
  return gcode.split('\n').map(l => l.trim()).filter(l => l.length > 0)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3-axis generic template — all 3-axis dialects share this template
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dialect safety — cnc_generic_mm.hbs (GRBL)', () => {
  const machine: MachineProfile = { ...baseMachine, dialect: 'grbl' }

  it('header: G21 (metric), G90 (absolute), G17 (XY plane)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('G17')
  })

  it('header: UNVERIFIED safety disclaimer present', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('UNVERIFIED')
  })

  it('header: spindle on with GRBL S12000', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M3 S12000')
  })

  it('footer: spindle off (M5)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    const lines = gcodeLines(gcode)
    const m5Line = lines.find(l => l.startsWith('M5'))
    expect(m5Line).toBeDefined()
  })

  it('footer: safe Z retract to machine workAreaMm.z', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain(`G0 Z${machine.workAreaMm.z}`)
  })

  it('footer: park XY (G0 X0 Y0)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('G0 X0 Y0')
  })

  it('footer: program end M30', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M30')
  })

  it('ordering: G21 before G90 before spindle on before toolpath before M5 before M30', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const spindleOn = gcode.indexOf('M3 S12000')
    const firstToolpath = gcode.indexOf('G0 X10 Y10 Z5')
    const m5 = gcode.lastIndexOf('M5')
    const m30 = gcode.lastIndexOf('M30')
    expect(g21).toBeLessThan(g90)
    expect(g90).toBeLessThan(spindleOn)
    expect(spindleOn).toBeLessThan(firstToolpath)
    expect(firstToolpath).toBeLessThan(m5)
    expect(m5).toBeLessThan(m30)
  })
})

describe('Dialect safety — cnc_generic_mm.hbs (Mach3)', () => {
  const machine: MachineProfile = { ...baseMachine, dialect: 'mach3' }

  it('header: spindle on with bare M3 (no S parameter)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M3')
    expect(gcode).not.toContain('M3 S')
  })

  it('footer: M5 spindle off present', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M5')
  })

  it('footer: M30 program end', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M30')
  })
})

describe('Dialect safety — cnc_generic_mm.hbs (Fanuc)', () => {
  const machine: MachineProfile = { ...baseMachine, dialect: 'fanuc' }

  it('header: spindle on with Fanuc S10000', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M3 S10000')
  })

  it('footer: M5 and M30', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')
  })
})

describe('Dialect safety — cnc_generic_mm.hbs (Siemens)', () => {
  const machine: MachineProfile = { ...baseMachine, dialect: 'siemens' }

  it('header: spindle on with Siemens S10000', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M3 S10000')
  })

  it('footer: M5 and M30', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')
  })
})

describe('Dialect safety — cnc_generic_mm.hbs (Heidenhain)', () => {
  const machine: MachineProfile = { ...baseMachine, dialect: 'heidenhain' }

  it('header: spindle on with Heidenhain S10000', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M3 S10000')
  })

  it('footer: M5 and M30', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4-axis GRBL (Carvera rotary)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dialect safety — cnc_4axis_grbl.hbs', () => {
  const machine: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('header: G21, G90, G17 safety codes', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('G17')
  })

  it('header: 4-AXIS identifier', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('4-AXIS')
  })

  it('header: spindle on with S12000 (Carvera)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('M3 S12000')
  })

  it('footer: spindle off M5', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('M5')
  })


  it('footer: safe Z retract', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain(`G0 Z${machine.workAreaMm.z}`)
  })

  it('footer: M30 program end', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('M30')
  })
})

// Note: the Fanuc/Mach3/LinuxCNC/Siemens/Heidenhain 4-axis post templates were
// removed in the April 2026 4-axis subsystem rewrite — only `cnc_4axis_grbl.hbs`
// is exercised. CPS imports for those dialects now repoint at GRBL.

// ═══════════════════════════════════════════════════════════════════════════════
// Carvera 3-axis
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dialect safety — carvera_3axis.hbs', () => {
  const machine: MachineProfile = {
    ...baseMachine,
    id: 'carvera-safety',
    name: 'Carvera Safety',
    postTemplate: 'carvera_3axis.hbs',
    dialect: 'grbl_4axis',
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000
  }

  it('header: G21, G90, G17 safety codes', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('G17')
  })

  it('header: M6 tool change with ATC', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M6 T1')
  })

  it('header: G43 tool length compensation', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('G43 H1')
  })

  it('header: spindle dwell (G4 P2)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('G4 P2')
  })

  it('footer: spindle off M5', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M5')
  })

  it('footer: G49 cancel tool length comp', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('G49')
  })

  it('footer: safe Z retract', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain(`G0 Z${machine.workAreaMm.z}`)
  })

  it('footer: M9 coolant/vacuum off', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M9')
  })

  it('footer: M2 program end (NOT M30 for Smoothieware)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, toolpathLines)
    expect(gcode).toContain('M2')
    // Carvera must NOT use M30 (deletes file on SD card)
    const lines = gcodeLines(gcode)
    const lastLine = lines[lines.length - 1]
    expect(lastLine).not.toMatch(/^M30/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Carvera 4-axis
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dialect safety — carvera_4axis.hbs', () => {
  const machine: MachineProfile = {
    ...baseMachine,
    id: 'carvera-4ax-safety',
    name: 'Carvera 4-Axis Safety',
    postTemplate: 'carvera_4axis.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360,
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000
  }

  it('header: G21, G90, G17 safety codes', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('G17')
  })

  it('header: spindle dwell (G4 P2)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('G4 P2')
  })

  it('footer: spindle off M5', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('M5')
  })

  it('footer: safe Z retract', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain(`G0 Z${machine.workAreaMm.z}`)
  })

  it('footer: A0 return to zero', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('G0 A0')
  })

  it('footer: M9 coolant/vacuum off', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('M9')
  })

  it('footer: M2 program end (NOT M30 for Smoothieware)', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, fourAxisLines)
    expect(gcode).toContain('M2')
    const lines = gcodeLines(gcode)
    const lastLine = lines[lines.length - 1]
    expect(lastLine).not.toMatch(/^M30/)
  })
})

// Note: the 5-axis Fanuc and 5-axis Siemens dialect-safety describe blocks
// were removed in the June 2026 My-Shop-Only cleanup — the speculative
// 5-axis post templates were deleted because none of the three target
// shops own a 5-axis machine.
