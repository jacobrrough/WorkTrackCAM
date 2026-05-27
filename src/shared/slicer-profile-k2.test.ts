/**
 * Creality K2 Plus machine profile — bed-size safety.
 *
 * Task #10 (2026-05-27 pivot): the original cross-check between the bundled
 * CuraEngine def.json and the machine profile is dead — `resources/slicer/`
 * was deleted when we pivoted to OrcaSlicer. The surviving live pin is the
 * machine profile itself: the build volume MUST match the CLAUDE.md
 * "USER CONTEXT — TARGET MACHINES" §1 spec of 350×350×350 mm. A drift here
 * still risks the gantry on the first print.
 *
 * Roadmap: [ID-0006]. Related discovery: [ID-0061] / [ID-0050].
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type K2MachineProfile = {
  id: string
  kind: 'fdm' | 'cnc'
  workAreaMm: { x: number; y: number; z: number }
}

const resourcesRoot = join(process.cwd(), 'resources')

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
})
