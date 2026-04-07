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

// ─── clampSpindleRpm ─────────────────────────────────────────────────────────
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

// ─── renderPost with spindleRpm ──────────────────────────────────────────────
describe('renderPost with spindleRpm', () => {
  it('default behavior without spindleRpm unchanged', async () => {
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'])
    // grbl dialect default: M3 S12000
    expect(g).toContain('M3 S12000')
    expect(warnings).toEqual([])
  })

  it('with spindleRpm, the S-word in output matches the provided RPM', async () => {
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'], { spindleRpm: 8000 })
    expect(g).toContain('M3 S8000')
    expect(g).not.toContain('S12000')
    expect(warnings).toEqual([])
  })

  it('with spindleRpm exceeding machine max, output uses clamped RPM and returns warning', async () => {
    const machineWithMax: MachineProfile = { ...machine, maxSpindleRpm: 15000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineWithMax, ['G0 X1 Y1'], { spindleRpm: 20000 })
    expect(g).toContain('M3 S15000')
    expect(g).not.toContain('S20000')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('15000')
  })

  it('with spindleRpm below machine min, output uses clamped RPM and returns warning', async () => {
    const machineWithMin: MachineProfile = { ...machine, minSpindleRpm: 6000 }
    const { gcode: g, warnings } = await renderPost(resourcesRoot, machineWithMin, ['G0 X1 Y1'], { spindleRpm: 3000 })
    expect(g).toContain('M3 S6000')
    expect(g).not.toContain('S3000')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('6000')
  })
})
