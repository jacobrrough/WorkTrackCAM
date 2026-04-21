import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

/**
 * End-to-end 4-axis post validation tests.
 *
 * These tests feed realistic 4-axis toolpath lines (with X/Y/Z/A/F words)
 * through the supported 4-axis post template and validate:
 * - Common safety structure (header, footer, spindle, retract)
 * - Toolpath ordering and completeness
 * - GRBL/Carvera-specific conventions
 *
 * The non-GRBL 4-axis post templates were removed in the April 2026 4-axis
 * subsystem rewrite — only `cnc_4axis_grbl.hbs` is exercised here now.
 */

const resourcesRoot = join(process.cwd(), 'resources')

/** Realistic 4-axis toolpath lines simulating roughing + finishing passes */
const REALISTIC_4AXIS_TOOLPATH = [
  '; --- Roughing: depth -2.000mm ---',
  'G0 X10.000 Y0 Z25.000 A0',
  'G1 X10.000 Y0 Z23.000 F800',
  'G1 X15.000 Y0 Z23.000 A0.000 F1200',
  'G1 X20.000 Y0 Z23.000 A10.000 F1200',
  'G1 X25.000 Y0 Z23.000 A20.000 F1200',
  'G1 X30.000 Y0 Z23.000 A30.000 F1200',
  'G0 Z25.000',
  '; --- Roughing: depth -4.000mm ---',
  'G0 X10.000 A40.000',
  'G1 X10.000 Y0 Z21.000 F800',
  'G1 X15.000 Y0 Z21.000 A50.000 F1200',
  'G1 X20.000 Y0 Z21.000 A60.000 F1200',
  'G0 Z25.000',
  '; --- Finishing pass ---',
  'G0 X10.000 A0.000',
  'G1 X10.000 Y0 Z22.500 F600',
  'G1 X12.000 Y0 Z22.300 A5.000 F600',
  'G1 X14.000 Y0 Z22.100 A10.000 F600',
  'G1 X16.000 Y0 Z21.800 A15.000 F600',
  'G1 X18.000 Y0 Z21.500 A20.000 F600',
  'G1 X20.000 Y0 Z21.200 A25.000 F600',
  'G0 Z25.000',
  'G0 A0.000',
  'G0 X0 Y0'
]

const baseMachine: MachineProfile = {
  id: 'test-4axis',
  name: 'Test 4-Axis Mill',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_4axis_grbl.hbs',
  dialect: 'grbl_4axis',
  axisCount: 4,
  aAxisRangeDeg: 360,
  aAxisOrientation: 'x',
  maxRotaryRpm: 20
}

type DialectConfig = {
  dialect: MachineProfile['dialect']
  postTemplate: string
  label: string
  spindleOn: string
  commentStyle: 'semicolon' | 'parentheses'
  programEnd: 'M30' | 'M2'
}

const DIALECTS: DialectConfig[] = [
  { dialect: 'grbl_4axis', postTemplate: 'cnc_4axis_grbl.hbs', label: 'GRBL 4-axis', spindleOn: 'M3 S12000', commentStyle: 'semicolon', programEnd: 'M30' }
]

// ─── Common safety structure tests (all 6 dialects) ──────────────────────────

describe('4-axis post-process integration — common safety structure', () => {
  for (const dc of DIALECTS) {
    describe(dc.label, () => {
      const machine: MachineProfile = { ...baseMachine, dialect: dc.dialect, postTemplate: dc.postTemplate }

      it('all toolpath lines appear in output', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        for (const line of REALISTIC_4AXIS_TOOLPATH) {
          expect(g).toContain(line)
        }
      })

      it('toolpath lines appear in correct order', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        let lastIdx = -1
        for (const line of REALISTIC_4AXIS_TOOLPATH) {
          const idx = g.indexOf(line, lastIdx + 1)
          expect(idx).toBeGreaterThan(lastIdx)
          lastIdx = idx
        }
      })

      it('spindle on appears before first toolpath line', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        const spindleIdx = g.indexOf(dc.spindleOn)
        const firstLine = g.indexOf(REALISTIC_4AXIS_TOOLPATH[0]!)
        expect(spindleIdx).toBeGreaterThan(-1)
        expect(firstLine).toBeGreaterThan(spindleIdx)
      })

      it('spindle off (M5) appears after last unique toolpath line', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        // Use a unique G1 line that only appears in toolpath, not in template header/footer
        const uniqueLine = 'G1 X20.000 Y0 Z21.200 A25.000 F600'
        const lastUnique = g.indexOf(uniqueLine)
        expect(lastUnique).toBeGreaterThan(-1)
        const m5Idx = g.indexOf('M5', lastUnique)
        expect(m5Idx).toBeGreaterThan(lastUnique)
      })

      it('emits program end code after last unique toolpath line', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        const uniqueLine = 'G1 X20.000 Y0 Z21.200 A25.000 F600'
        const lastUnique = g.indexOf(uniqueLine)
        expect(lastUnique).toBeGreaterThan(-1)
        const endIdx = g.indexOf(dc.programEnd, lastUnique)
        expect(endIdx).toBeGreaterThan(lastUnique)
      })

      it('emits G90 absolute mode in header', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        const g90Idx = g.indexOf('G90')
        const firstLine = g.indexOf(REALISTIC_4AXIS_TOOLPATH[0]!)
        expect(g90Idx).toBeGreaterThan(-1)
        expect(g90Idx).toBeLessThan(firstLine)
      })

      it('emits G21 metric units in header', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        const g21Idx = g.indexOf('G21')
        const firstLine = g.indexOf(REALISTIC_4AXIS_TOOLPATH[0]!)
        expect(g21Idx).toBeGreaterThan(-1)
        expect(g21Idx).toBeLessThan(firstLine)
      })

      it('emits safe Z retract using machine max Z', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        expect(g).toContain(`Z${machine.workAreaMm.z}`)
      })

      it('emits 4-AXIS identifier somewhere in the output', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        expect(g.toUpperCase()).toContain('4-AXIS')
      })

      it('emits UNVERIFIED warning', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
        expect(g.toUpperCase()).toContain('UNVERIFIED')
      })

      it('injects aAxisRangeDeg when provided', async () => {
        const m = { ...machine, aAxisRangeDeg: 360 }
        const { gcode: g } = await renderPost(resourcesRoot, m, REALISTIC_4AXIS_TOOLPATH)
        expect(g).toContain('360')
      })

      it('injects WCS offset when workCoordinateIndex set', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH, { workCoordinateIndex: 2 })
        expect(g).toContain('G55')
      })

      it('injects operation label', async () => {
        const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH, { operationLabel: '4-Axis Roughing' })
        expect(g).toContain('4-Axis Roughing')
      })
    })
  }
})

// ─── Dialect-specific convention tests ───────────────────────────────────────

describe('4-axis post-process integration — dialect-specific conventions', () => {
  it('GRBL does not emit tool change (no M6 support)', async () => {
    const machine: MachineProfile = { ...baseMachine, dialect: 'grbl_4axis', postTemplate: 'cnc_4axis_grbl.hbs' }
    const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
    // GRBL typically doesn't support M6 tool changes
    expect(g).not.toContain('M6')
  })
})

// ─── A-axis content in posted output ─────────────────────────────────────────

describe('4-axis post-process integration — A-axis content preservation', () => {
  for (const dc of DIALECTS) {
    it(`${dc.label}: preserves A-word values exactly`, async () => {
      const machine: MachineProfile = { ...baseMachine, dialect: dc.dialect, postTemplate: dc.postTemplate }
      const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
      // Verify key A values from the toolpath
      expect(g).toContain('A0.000')
      expect(g).toContain('A10.000')
      expect(g).toContain('A30.000')
      expect(g).toContain('A60.000')
    })

    it(`${dc.label}: preserves feed rate values`, async () => {
      const machine: MachineProfile = { ...baseMachine, dialect: dc.dialect, postTemplate: dc.postTemplate }
      const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
      expect(g).toContain('F800')
      expect(g).toContain('F1200')
      expect(g).toContain('F600')
    })

    it(`${dc.label}: preserves roughing/finishing pass comments`, async () => {
      const machine: MachineProfile = { ...baseMachine, dialect: dc.dialect, postTemplate: dc.postTemplate }
      const { gcode: g } = await renderPost(resourcesRoot, machine, REALISTIC_4AXIS_TOOLPATH)
      expect(g).toContain('Roughing: depth -2.000mm')
      expect(g).toContain('--- Finishing pass ---')
    })
  }
})
