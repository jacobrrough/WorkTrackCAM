/**
 * Snapshot tests for G-code output from each post-processor template/dialect.
 *
 * For each template + dialect combination, generate G-code from a known operation
 * config and snapshot the output. Future changes that alter G-code output will be
 * caught as snapshot diffs, preventing accidental regressions.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

/** Shared toolpath lines used across all snapshot tests for consistency. */
const standardToolpathLines = [
  'G0 X0 Y0 Z10',
  'G0 X5 Y5 Z5',
  'G1 Z-1.000 F300',
  'G1 X15 Y5 F800',
  'G1 X15 Y15',
  'G1 X5 Y15',
  'G1 X5 Y5',
  'G0 Z10'
]

/** 4-axis toolpath lines with A-axis rotation words. */
const fourAxisToolpathLines = [
  'G0 X0 Y0 Z20 A0',
  'G1 X10 Z-2.000 A0 F600',
  'G1 X10 Z-2.000 A90 F400',
  'G1 X10 Z-2.000 A180 F400',
  'G1 X10 Z-2.000 A270 F400',
  'G0 Z20 A0'
]

/** 5-axis toolpath lines with A-axis and B-axis words. */
const fiveAxisToolpathLines = [
  'G0 X0 Y0 Z30 A0 B0',
  'G1 X10 Y10 Z-1.000 A15 B10 F500',
  'G1 X20 Y10 Z-1.000 A30 B-5 F500',
  'G1 X20 Y20 Z-1.500 A15 B0 F500',
  'G0 Z30 A0 B0'
]

// ─── Base machine used across tests ──────────────────────────────────────────

const baseMachine: MachineProfile = {
  id: 'snapshot-mill',
  name: 'Snapshot Mill',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

// ─── 3-axis generic template snapshots ───────────────────────────────────────

describe('G-code snapshot — cnc_generic_mm.hbs', () => {
  it('GRBL dialect', async () => {
    const m: MachineProfile = { ...baseMachine, dialect: 'grbl' }
    const { gcode } = await renderPost(resourcesRoot, m, standardToolpathLines, {
      operationLabel: 'Snapshot Test — GRBL'
    })
    expect(gcode).toMatchSnapshot()
  })

  it('Mach3 dialect', async () => {
    const m: MachineProfile = { ...baseMachine, dialect: 'mach3' }
    const { gcode } = await renderPost(resourcesRoot, m, standardToolpathLines, {
      operationLabel: 'Snapshot Test — Mach3'
    })
    expect(gcode).toMatchSnapshot()
  })

  it('Fanuc dialect', async () => {
    const m: MachineProfile = { ...baseMachine, dialect: 'fanuc' }
    const { gcode } = await renderPost(resourcesRoot, m, standardToolpathLines, {
      operationLabel: 'Snapshot Test — Fanuc'
    })
    expect(gcode).toMatchSnapshot()
  })

  it('Siemens dialect', async () => {
    const m: MachineProfile = { ...baseMachine, dialect: 'siemens' }
    const { gcode } = await renderPost(resourcesRoot, m, standardToolpathLines, {
      operationLabel: 'Snapshot Test — Siemens'
    })
    expect(gcode).toMatchSnapshot()
  })

  it('Heidenhain dialect', async () => {
    const m: MachineProfile = { ...baseMachine, dialect: 'heidenhain' }
    const { gcode } = await renderPost(resourcesRoot, m, standardToolpathLines, {
      operationLabel: 'Snapshot Test — Heidenhain'
    })
    expect(gcode).toMatchSnapshot()
  })

  it('GRBL dialect with WCS offset', async () => {
    const m: MachineProfile = { ...baseMachine, dialect: 'grbl' }
    const { gcode } = await renderPost(resourcesRoot, m, standardToolpathLines, {
      workCoordinateIndex: 3,
      operationLabel: 'Snapshot WCS — G56'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 4-axis GRBL (Carvera) template snapshot ─────────────────────────────────

describe('G-code snapshot — cnc_4axis_grbl.hbs', () => {
  const machine4axGrbl: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_grbl.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('grbl_4axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine4axGrbl, fourAxisToolpathLines, {
      operationLabel: 'Snapshot 4-Axis GRBL'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 4-axis Fanuc template snapshot ──────────────────────────────────────────

describe('G-code snapshot — cnc_4axis_fanuc.hbs', () => {
  const machine4axFanuc: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_fanuc.hbs',
    dialect: 'fanuc_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('fanuc_4axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine4axFanuc, fourAxisToolpathLines, {
      operationLabel: 'Snapshot 4-Axis Fanuc'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 4-axis Mach3 template snapshot ──────────────────────────────────────────

describe('G-code snapshot — cnc_4axis_mach3.hbs', () => {
  const machine4axMach3: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_mach3.hbs',
    dialect: 'mach3_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('mach3_4axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine4axMach3, fourAxisToolpathLines, {
      operationLabel: 'Snapshot 4-Axis Mach3'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 4-axis LinuxCNC template snapshot ───────────────────────────────────────

describe('G-code snapshot — cnc_4axis_linuxcnc.hbs', () => {
  const machine4axLinux: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_linuxcnc.hbs',
    dialect: 'linuxcnc_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('linuxcnc_4axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine4axLinux, fourAxisToolpathLines, {
      operationLabel: 'Snapshot 4-Axis LinuxCNC'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 4-axis Siemens template snapshot ────────────────────────────────────────

describe('G-code snapshot — cnc_4axis_siemens.hbs', () => {
  const machine4axSiemens: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_siemens.hbs',
    dialect: 'siemens_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('siemens_4axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine4axSiemens, fourAxisToolpathLines, {
      operationLabel: 'Snapshot 4-Axis Siemens'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 4-axis Heidenhain template snapshot ─────────────────────────────────────

describe('G-code snapshot — cnc_4axis_heidenhain.hbs', () => {
  const machine4axHeid: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_4axis_heidenhain.hbs',
    dialect: 'heidenhain_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360
  }

  it('heidenhain_4axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine4axHeid, fourAxisToolpathLines, {
      operationLabel: 'Snapshot 4-Axis Heidenhain'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── Carvera 3-axis template snapshot ────────────────────────────────────────

describe('G-code snapshot — carvera_3axis.hbs', () => {
  const carvera3ax: MachineProfile = {
    ...baseMachine,
    id: 'carvera-3ax',
    name: 'Makera Carvera',
    postTemplate: 'carvera_3axis.hbs',
    dialect: 'grbl_4axis',
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000
  }

  it('carvera 3-axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, carvera3ax, standardToolpathLines, {
      operationLabel: 'Snapshot Carvera 3-Axis'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── Carvera 4-axis template snapshot ────────────────────────────────────────

describe('G-code snapshot — carvera_4axis.hbs', () => {
  const carvera4ax: MachineProfile = {
    ...baseMachine,
    id: 'carvera-4ax',
    name: 'Makera Carvera 4-Axis',
    postTemplate: 'carvera_4axis.hbs',
    dialect: 'grbl_4axis',
    axisCount: 4,
    aAxisRangeDeg: 360,
    minSpindleRpm: 6000,
    maxSpindleRpm: 15000
  }

  it('carvera 4-axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, carvera4ax, fourAxisToolpathLines, {
      operationLabel: 'Snapshot Carvera 4-Axis'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 5-axis Fanuc template snapshot ──────────────────────────────────────────

describe('G-code snapshot — cnc_5axis_fanuc.hbs', () => {
  const machine5axFanuc: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_5axis_fanuc.hbs',
    dialect: 'fanuc',
    axisCount: 5,
    aAxisRangeDeg: 360,
    bAxisRangeDeg: 120,
    bAxisOrientation: 'y',
    fiveAxisType: 'table-head',
    maxTiltDeg: 60
  }

  it('fanuc 5-axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine5axFanuc, fiveAxisToolpathLines, {
      operationLabel: 'Snapshot 5-Axis Fanuc'
    })
    expect(gcode).toMatchSnapshot()
  })
})

// ─── 5-axis Siemens template snapshot ────────────────────────────────────────

describe('G-code snapshot — cnc_5axis_siemens.hbs', () => {
  const machine5axSiemens: MachineProfile = {
    ...baseMachine,
    postTemplate: 'cnc_5axis_siemens.hbs',
    dialect: 'siemens',
    axisCount: 5,
    aAxisRangeDeg: 360,
    bAxisRangeDeg: 120,
    bAxisOrientation: 'y',
    fiveAxisType: 'table-table',
    maxTiltDeg: 60
  }

  it('siemens 5-axis dialect', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine5axSiemens, fiveAxisToolpathLines, {
      operationLabel: 'Snapshot 5-Axis Siemens'
    })
    expect(gcode).toMatchSnapshot()
  })
})
