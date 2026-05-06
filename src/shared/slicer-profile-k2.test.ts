/**
 * Creality K2 Plus slicer profile ↔ machine profile cross-check.
 *
 * Historically, `resources/slicer/creality_k2_plus.def.json` shipped with
 * `machine_width/depth/height = 500`, but the physical K2 Plus build volume
 * is 350×350×350 mm (CLAUDE.md "USER CONTEXT — TARGET MACHINES" §1, and
 * `resources/machines/creality-k2-plus.json`'s `workAreaMm`). Slicing with
 * a 500 mm bed on a 350 mm printer drives the gantry ~150 mm past the X/Y
 * hard stops on the first print — a machine-crash regression.
 *
 * These tests lock the slicer def's `machine_width/depth/height` overrides
 * to the machine profile's `workAreaMm` values so future drifts are caught
 * at CI time instead of during a live print.
 *
 * Roadmap: [ID-0006]. Related discovery: [ID-0061] / [ID-0050].
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type CuraProfileOverride = { default_value: number | string }
type CuraSlicerProfile = {
  name: string
  inherits?: string
  overrides: {
    machine_width?: CuraProfileOverride
    machine_depth?: CuraProfileOverride
    machine_height?: CuraProfileOverride
    [k: string]: CuraProfileOverride | undefined
  }
}

type K2MachineProfile = {
  id: string
  kind: 'fdm' | 'cnc'
  workAreaMm: { x: number; y: number; z: number }
}

const resourcesRoot = join(process.cwd(), 'resources')

function loadSlicerProfile(): CuraSlicerProfile {
  const path = join(resourcesRoot, 'slicer', 'creality_k2_plus.def.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as CuraSlicerProfile
}

function loadMachineProfile(): K2MachineProfile {
  const path = join(resourcesRoot, 'machines', 'creality-k2-plus.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as K2MachineProfile
}

describe('Creality K2 Plus slicer profile — bed-size safety', () => {
  it('machine profile documents the verified 350×350×350 build volume', () => {
    const m = loadMachineProfile()
    expect(m.id).toBe('creality-k2-plus')
    expect(m.kind).toBe('fdm')
    expect(m.workAreaMm).toEqual({ x: 350, y: 350, z: 350 })
  })

  it('slicer def `machine_width` matches the machine profile workAreaMm.x', () => {
    const slicer = loadSlicerProfile()
    const machine = loadMachineProfile()
    expect(slicer.overrides.machine_width).toBeDefined()
    expect(slicer.overrides.machine_width!.default_value).toBe(machine.workAreaMm.x)
    // Hard-assert the value too, so a coordinated drift in both files still fails.
    expect(slicer.overrides.machine_width!.default_value).toBe(350)
  })

  it('slicer def `machine_depth` matches the machine profile workAreaMm.y', () => {
    const slicer = loadSlicerProfile()
    const machine = loadMachineProfile()
    expect(slicer.overrides.machine_depth).toBeDefined()
    expect(slicer.overrides.machine_depth!.default_value).toBe(machine.workAreaMm.y)
    expect(slicer.overrides.machine_depth!.default_value).toBe(350)
  })

  it('slicer def `machine_height` matches the machine profile workAreaMm.z', () => {
    const slicer = loadSlicerProfile()
    const machine = loadMachineProfile()
    expect(slicer.overrides.machine_height).toBeDefined()
    expect(slicer.overrides.machine_height!.default_value).toBe(machine.workAreaMm.z)
    expect(slicer.overrides.machine_height!.default_value).toBe(350)
  })

  it('slicer def does NOT ship the historical 500 mm values that would crash the gantry', () => {
    const slicer = loadSlicerProfile()
    expect(slicer.overrides.machine_width!.default_value).not.toBe(500)
    expect(slicer.overrides.machine_depth!.default_value).not.toBe(500)
    expect(slicer.overrides.machine_height!.default_value).not.toBe(500)
  })

  it('slicer def machine_name still identifies the K2 Plus', () => {
    const slicer = loadSlicerProfile()
    expect(slicer.name).toBe('Creality K2 Plus')
    expect(slicer.overrides.machine_name).toBeDefined()
    expect(slicer.overrides.machine_name!.default_value).toBe('Creality K2 Plus')
  })
})
