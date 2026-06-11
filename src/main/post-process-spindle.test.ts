import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { clampSpindleRpm, renderPost } from './post-process'

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

// --- clampSpindleRpm --------------------------------------------------------
describe('clampSpindleRpm', () => {
  it('no limits returns input unchanged, no warning', () => {
    const machineNoLimits: MachineProfile = { ...machine }
    const result = clampSpindleRpm(12000, machineNoLimits)
    expect(result.rpm).toBe(12000)
    expect(result.warning).toBeUndefined()
  })

  it('RPM above max returns max, warning', () => {
    const machineMax: MachineProfile = { ...machine, maxSpindleRpm: 15000 }
    const result = clampSpindleRpm(20000, machineMax)
    expect(result.rpm).toBe(15000)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('15000')
  })

  it('RPM below min returns min, warning', () => {
    const machineMin: MachineProfile = { ...machine, minSpindleRpm: 6000 }
    const result = clampSpindleRpm(3000, machineMin)
    expect(result.rpm).toBe(6000)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('6000')
  })

  it('RPM within range returns input unchanged, no warning', () => {
    const machineBoth: MachineProfile = { ...machine, minSpindleRpm: 6000, maxSpindleRpm: 15000 }
    const result = clampSpindleRpm(10000, machineBoth)
    expect(result.rpm).toBe(10000)
    expect(result.warning).toBeUndefined()
  })

  it('only maxSpindleRpm set (no min) clamps to max only', () => {
    const machineMaxOnly: MachineProfile = { ...machine, maxSpindleRpm: 15000 }
    // Below-range RPM passes through when no min is set
    const resultLow = clampSpindleRpm(1000, machineMaxOnly)
    expect(resultLow.rpm).toBe(1000)
    expect(resultLow.warning).toBeUndefined()
    // Above-range RPM gets clamped
    const resultHigh = clampSpindleRpm(20000, machineMaxOnly)
    expect(resultHigh.rpm).toBe(15000)
    expect(resultHigh.warning).toBeDefined()
  })

  it('only minSpindleRpm set (no max) clamps to min only', () => {
    const machineMinOnly: MachineProfile = { ...machine, minSpindleRpm: 6000 }
    // Above any hypothetical max passes through when no max is set
    const resultHigh = clampSpindleRpm(99999, machineMinOnly)
    expect(resultHigh.rpm).toBe(99999)
    expect(resultHigh.warning).toBeUndefined()
    // Below min gets clamped
    const resultLow = clampSpindleRpm(2000, machineMinOnly)
    expect(resultLow.rpm).toBe(6000)
    expect(resultLow.warning).toBeDefined()
  })
})

// --- renderPost with spindleRpm ---------------------------------------------
describe('renderPost with spindleRpm', () => {
  // [ID-0018] Filter to non-HEADER warnings so these spindle assertions
  // continue to test only spindle-clamp behavior. The header-invariant
  // validator runs on every CNC render and may emit HEADER_NO_WCS when
  // the test machine omits workCoordinateIndex; that's exercised in
  // post-process-header-invariants.test.ts.
  // [ID-0108] Also filter END_ warnings: the synthetic test machine
  // pairs dialect=grbl with vcarve_mach3.hbs (which emits M30), so the
  // end-program validator correctly surfaces END_DIALECT_MISMATCH.
  // End-program invariants are exercised in
  // post-process-end-program-invariants.test.ts.
  const spindleWarnings = (warnings: string[]): string[] =>
    warnings.filter(w => !/^\[(HEADER_|END_)/.test(w))

  it('default behavior without spindleRpm unchanged', async () => {
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'])
    // grbl dialect default: M3 S12000
    expect(g).toContain('M3 S12000')
    expect(spindleWarnings(warnings)).toEqual([])
  })

  it('with spindleRpm, the S-word in output matches the provided RPM', async () => {
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'], { spindleRpm: 8000 })
    expect(g).toContain('M3 S8000')
    expect(g).not.toContain('S12000')
    expect(spindleWarnings(warnings)).toEqual([])
  })

  it('with spindleRpm exceeding machine max, output uses clamped RPM and returns warning', async () => {
    const machineWithMax: MachineProfile = { ...machine, maxSpindleRpm: 15000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineWithMax, ['G0 X1 Y1'], { spindleRpm: 20000 })
    expect(g).toContain('M3 S15000')
    expect(g).not.toContain('S20000')
    const sw = spindleWarnings(warnings)
    expect(sw).toHaveLength(1)
    expect(sw[0]).toContain('15000')
  })

  it('with spindleRpm below machine min, output uses clamped RPM and returns warning', async () => {
    const machineWithMin: MachineProfile = { ...machine, minSpindleRpm: 6000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineWithMin, ['G0 X1 Y1'], { spindleRpm: 3000 })
    expect(g).toContain('M3 S6000')
    expect(g).not.toContain('S3000')
    const sw = spindleWarnings(warnings)
    expect(sw).toHaveLength(1)
    expect(sw[0]).toContain('6000')
  })
})

// --- default S-word resolution (no explicit spindleRpm) ----------------------
// task_feef69e0 / Cycle 245: the dialect's hard-coded default S-word used to
// bypass clampSpindleRpm entirely — the Smoothieware `M3 S12000` default ran
// the Carvera 3-axis 200 W spindle below its rated 13,000 RPM floor. With no
// explicit spindleRpm, renderPost now resolves the dialect default against the
// machine's [minSpindleRpm, maxSpindleRpm] window. SILENTLY: the system is
// choosing a correct default, not adjusting an operator input — no warning
// (an always-on warning would be the advisory-noise trap).
describe('renderPost default S-word resolution against the machine window', () => {
  const spindleWarnings = (warnings: string[]): string[] =>
    warnings.filter(w => !/^\[(HEADER_|END_)/.test(w))

  it('default below the machine floor is raised to minSpindleRpm — silently', async () => {
    const machineMin13k: MachineProfile = { ...machine, minSpindleRpm: 13000, maxSpindleRpm: 15000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineMin13k, ['G0 X1 Y1'])
    expect(g).toContain('M3 S13000')
    expect(g).not.toContain('S12000')
    expect(spindleWarnings(warnings)).toEqual([])
  })

  it('default inside the window is untouched (Carvera-4-axis-style 6000 floor)', async () => {
    const machineMin6k: MachineProfile = { ...machine, minSpindleRpm: 6000, maxSpindleRpm: 15000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineMin6k, ['G0 X1 Y1'])
    expect(g).toContain('M3 S12000')
    expect(spindleWarnings(warnings)).toEqual([])
  })

  it('default above the machine ceiling is lowered to maxSpindleRpm — silently', async () => {
    const machineMax10k: MachineProfile = { ...machine, maxSpindleRpm: 10000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineMax10k, ['G0 X1 Y1'])
    expect(g).toContain('M3 S10000')
    expect(g).not.toContain('S12000')
    expect(spindleWarnings(warnings)).toEqual([])
  })

  it('a bare-M3 dialect (mach3 — the Laguna pendant owns RPM) gains NO S-word', async () => {
    const lagunaStyle: MachineProfile = {
      ...machine,
      dialect: 'mach3',
      postTemplate: 'vcarve_mach3.hbs',
      minSpindleRpm: 6000,
      maxSpindleRpm: 24000
    }
    const { gcode: g } = await renderPost(resourcesRoot, lagunaStyle, ['G0 X1 Y1'])
    expect(g).toMatch(/^M3$/m)
    expect(g).not.toMatch(/^M3 S\d+/m)
  })

  it('an EXPLICIT below-floor RPM still clamps WITH the warning (operator input adjusted)', async () => {
    const machineMin13k: MachineProfile = { ...machine, minSpindleRpm: 13000, maxSpindleRpm: 15000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineMin13k, ['G0 X1 Y1'], { spindleRpm: 12000 })
    expect(g).toContain('M3 S13000')
    const sw = spindleWarnings(warnings)
    expect(sw).toHaveLength(1)
    expect(sw[0]).toContain('13000')
  })
})
