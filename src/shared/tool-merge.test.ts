import { describe, expect, it } from 'vitest'
import { mergeMachineFirstProjectTools } from './tool-merge'

describe('mergeMachineFirstProjectTools', () => {
  it('prefers machine ids and appends project-only', () => {
    const m = mergeMachineFirstProjectTools(
      { version: 1, tools: [{ id: 'a', name: 'A', type: 'endmill', diameterMm: 6 }] },
      { version: 1, tools: [{ id: 'a', name: 'Dup', type: 'endmill', diameterMm: 6 }, { id: 'b', name: 'B', type: 'drill', diameterMm: 3 }] }
    )
    expect(m.tools.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('returns machine tools unchanged when project lib is empty', () => {
    const m = mergeMachineFirstProjectTools(
      { version: 1, tools: [{ id: 'x', name: 'X', type: 'endmill', diameterMm: 3 }] },
      { version: 1, tools: [] }
    )
    expect(m.tools.map((t) => t.id)).toEqual(['x'])
  })

  it('includes all project tools when machine lib is empty', () => {
    const m = mergeMachineFirstProjectTools(
      { version: 1, tools: [] },
      { version: 1, tools: [{ id: 'p', name: 'P', type: 'drill', diameterMm: 2 }] }
    )
    expect(m.tools.map((t) => t.id)).toEqual(['p'])
  })

  it('returns empty tools when both libs are empty', () => {
    const m = mergeMachineFirstProjectTools(
      { version: 1, tools: [] },
      { version: 1, tools: [] }
    )
    expect(m.tools).toEqual([])
  })

  it('appends all non-overlapping project tools after machine tools', () => {
    const machine = {
      version: 1 as const,
      tools: [
        { id: 'm1', name: 'M1', type: 'endmill' as const, diameterMm: 6 },
        { id: 'm2', name: 'M2', type: 'drill' as const, diameterMm: 3 }
      ]
    }
    const project = {
      version: 1 as const,
      tools: [
        { id: 'm2', name: 'Dup', type: 'drill' as const, diameterMm: 3 }, // duplicate — skipped
        { id: 'p1', name: 'P1', type: 'endmill' as const, diameterMm: 4 },
        { id: 'p2', name: 'P2', type: 'endmill' as const, diameterMm: 8 }
      ]
    }
    const m = mergeMachineFirstProjectTools(machine, project)
    expect(m.tools.map((t) => t.id)).toEqual(['m1', 'm2', 'p1', 'p2'])
    // Machine copy of 'm2' preserved (not overwritten by project duplicate)
    expect(m.tools.find((t) => t.id === 'm2')?.name).toBe('M2')
  })

  it('always returns version 1', () => {
    const m = mergeMachineFirstProjectTools(
      { version: 1, tools: [] },
      { version: 1, tools: [] }
    )
    expect(m.version).toBe(1)
  })
})
