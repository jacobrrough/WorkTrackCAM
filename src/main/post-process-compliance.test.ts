import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

const baseMachine: MachineProfile = {
  id: 'test-mill',
  name: 'Compliance Test Mill',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 300, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

const sampleToolpath = ['G0 X10 Y10', 'G1 Z-2.000 F200', 'G1 X50 Y30 F800', 'G0 Z10.000']

// ── Each dialect + template combo produces compliant output ────────────────

describe('renderPost dialect compliance — existing templates', () => {
  const dialectTemplates: Array<{ dialect: MachineProfile['dialect']; template: string; label: string }> = [
    { dialect: 'grbl', template: 'cnc_generic_mm.hbs', label: 'GRBL + generic_mm' },
    { dialect: 'grbl_4axis', template: 'cnc_4axis_grbl.hbs', label: 'GRBL 4-axis' },
    { dialect: 'fanuc_4axis', template: 'cnc_4axis_fanuc.hbs', label: 'Fanuc 4-axis' },
    { dialect: 'mach3_4axis', template: 'cnc_4axis_mach3.hbs', label: 'Mach3 4-axis' },
    { dialect: 'linuxcnc_4axis', template: 'cnc_4axis_linuxcnc.hbs', label: 'LinuxCNC 4-axis' },
    { dialect: 'siemens_4axis', template: 'cnc_4axis_siemens.hbs', label: 'Siemens 4-axis' },
    { dialect: 'heidenhain_4axis', template: 'cnc_4axis_heidenhain.hbs', label: 'Heidenhain 4-axis' },
    { dialect: 'grbl', template: 'carvera_3axis.hbs', label: 'Carvera 3-axis (GRBL)' },
    { dialect: 'grbl_4axis', template: 'carvera_4axis.hbs', label: 'Carvera 4-axis (GRBL)' },
    { dialect: 'fanuc', template: 'cnc_generic_mm.hbs', label: 'Fanuc + generic_mm' },
    { dialect: 'siemens', template: 'cnc_generic_mm.hbs', label: 'Siemens + generic_mm' },
    { dialect: 'heidenhain', template: 'cnc_generic_mm.hbs', label: 'Heidenhain + generic_mm' },
    { dialect: 'mach3', template: 'cnc_generic_mm.hbs', label: 'Mach3 + generic_mm' },
    { dialect: 'generic_mm', template: 'cnc_generic_mm.hbs', label: 'Generic MM' }
  ]

  for (const { dialect, template, label } of dialectTemplates) {
    it(`${label}: zero compliance errors`, async () => {
      const machine: MachineProfile = {
        ...baseMachine,
        dialect,
        postTemplate: template,
        ...(dialect.includes('4axis') ? { axisCount: 4, aAxisRangeDeg: 360 } : {})
      }
      const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
      // Filter to only compliance warnings (those with bracketed codes)
      const complianceWarnings = warnings.filter(w => /^\[/.test(w))
      // Compliance errors (level=error) should not exist for matching template+dialect
      const complianceErrors = complianceWarnings.filter(w =>
        w.includes('GRBL_NO_G28') || w.includes('SIEMENS_NO_G28')
      )
      expect(complianceErrors).toEqual([])
    })
  }
})

// ── Cross-dialect contamination detection ──────────────────────────────────

describe('renderPost dialect compliance — cross-dialect detection', () => {
  it('Fanuc template validated as GRBL catches G28', async () => {
    // Use Fanuc template with GRBL dialect — should catch G28
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'grbl',
      postTemplate: 'cnc_4axis_fanuc.hbs',
      axisCount: 4,
      aAxisRangeDeg: 360
    }
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const complianceWarnings = warnings.filter(w => /^\[GRBL_NO_G28\]/.test(w))
    expect(complianceWarnings.length).toBeGreaterThan(0)
  })

  it('Fanuc template validated as Siemens catches G28', async () => {
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'siemens',
      postTemplate: 'cnc_4axis_fanuc.hbs',
      axisCount: 4,
      aAxisRangeDeg: 360
    }
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const complianceWarnings = warnings.filter(w => /^\[SIEMENS_NO_G28\]/.test(w))
    expect(complianceWarnings.length).toBeGreaterThan(0)
  })

  it('Generic template validated as Mach3 warns on missing % markers', async () => {
    // Generic template has no % markers, but Mach3 expects them
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'mach3',
      postTemplate: 'cnc_generic_mm.hbs'
    }
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const tapeWarnings = warnings.filter(w => /MACH3_NO_TAPE/.test(w))
    expect(tapeWarnings.length).toBeGreaterThan(0)
  })

  it('Generic template validated as LinuxCNC warns on missing % markers', async () => {
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'linuxcnc_4axis',
      postTemplate: 'cnc_generic_mm.hbs'
    }
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const tapeWarnings = warnings.filter(w => /LINUXCNC_NO_TAPE/.test(w))
    expect(tapeWarnings.length).toBeGreaterThan(0)
  })
})

// ── Compliance warnings propagate through renderPost ───────────────────────

describe('renderPost compliance warning propagation', () => {
  it('spindle warning + compliance warnings coexist', async () => {
    // Use a machine with spindle limits to trigger spindle warning,
    // plus a cross-dialect mismatch to trigger compliance warning
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'mach3',
      postTemplate: 'cnc_generic_mm.hbs', // no % markers
      maxSpindleRpm: 5000
    }
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      spindleRpm: 12000 // exceeds max — triggers spindle warning
    })
    // Should have both spindle clamping warning and compliance warnings
    const spindleWarnings = warnings.filter(w => w.includes('Spindle RPM'))
    const complianceWarnings = warnings.filter(w => /^\[/.test(w))
    expect(spindleWarnings.length).toBe(1)
    expect(complianceWarnings.length).toBeGreaterThan(0)
  })

  it('no compliance warnings for generic_mm dialect', async () => {
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'generic_mm',
      postTemplate: 'cnc_generic_mm.hbs'
    }
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const complianceWarnings = warnings.filter(w => /^\[/.test(w))
    expect(complianceWarnings).toEqual([])
  })

  it('empty toolpath produces no compliance errors for GRBL', async () => {
    const machine: MachineProfile = {
      ...baseMachine,
      dialect: 'grbl',
      postTemplate: 'cnc_generic_mm.hbs'
    }
    const { warnings } = await renderPost(resourcesRoot, machine, [])
    const complianceErrors = warnings.filter(w =>
      /GRBL_NO_G28|SIEMENS_NO_G28/.test(w)
    )
    expect(complianceErrors).toEqual([])
  })
})
