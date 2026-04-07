import { describe, expect, it } from 'vitest'
import type { ManufactureOperation } from './manufacture-schema'
import type { ToolLibraryFile } from './tool-schema'
import { resolveCamToolDiameterMm, resolveCamToolStickoutMm, resolveCamToolType } from './cam-tool-resolve'

const lib: ToolLibraryFile = {
  version: 1,
  tools: [
    { id: 'a', name: 'Probe', type: 'other', diameterMm: 6 },
    { id: 'b', name: 'EM 3', type: 'endmill', diameterMm: 3.175 },
    { id: 'c', name: 'Ball 6', type: 'ball', diameterMm: 6 },
    { id: 'd', name: 'EM 6 stickout', type: 'endmill', diameterMm: 6, stickoutMm: 22 }
  ]
}

describe('resolveCamToolDiameterMm', () => {
  it('uses explicit toolDiameterMm', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_waterline',
      label: 'x',
      params: { toolDiameterMm: 8 }
    }
    expect(resolveCamToolDiameterMm({ operation: op, tools: lib })).toBe(8)
  })

  it('resolves toolId from library', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'b' }
    }
    expect(resolveCamToolDiameterMm({ operation: op, tools: lib })).toBe(3.175)
  })

  it('prefers toolDiameterMm over toolId', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'b', toolDiameterMm: 10 }
    }
    expect(resolveCamToolDiameterMm({ operation: op, tools: lib })).toBe(10)
  })

  it('falls back to first tool by type priority (endmill before other)', () => {
    const op: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolDiameterMm({ operation: op, tools: lib })).toBe(3.175)
  })

  it('returns undefined without library or params', () => {
    const op: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolDiameterMm({ operation: op, tools: null })).toBeUndefined()
  })

  it('parses string toolDiameterMm (positiveNumberFromString path)', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolDiameterMm: '6.35' }
    }
    expect(resolveCamToolDiameterMm({ operation: op, tools: lib })).toBeCloseTo(6.35, 5)
  })

  it('invalid string toolDiameterMm falls through to toolId lookup', () => {
    // "abc" → parseFloat → NaN → positiveNumber → undefined → falls to toolId then library
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolDiameterMm: 'abc', toolId: 'b' }
    }
    expect(resolveCamToolDiameterMm({ operation: op, tools: lib })).toBe(3.175)
  })

  it('returns undefined for undefined operation', () => {
    expect(resolveCamToolDiameterMm({ operation: undefined, tools: lib })).toBe(3.175)
  })

  it('returns undefined when tools list is empty and no direct param', () => {
    const emptyLib: ToolLibraryFile = { version: 1, tools: [] }
    const op: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolDiameterMm({ operation: op, tools: emptyLib })).toBeUndefined()
  })
})

describe('resolveCamToolType', () => {
  it('resolves tool type from toolId', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'c' }
    }
    expect(resolveCamToolType({ operation: op, tools: lib })).toBe('ball')
  })

  it('returns endmill type for endmill tool', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'b' }
    }
    expect(resolveCamToolType({ operation: op, tools: lib })).toBe('endmill')
  })

  it('returns undefined when toolId not in library', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'missing' }
    }
    expect(resolveCamToolType({ operation: op, tools: lib })).toBeUndefined()
  })

  it('returns undefined when no params', () => {
    const op: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolType({ operation: op, tools: lib })).toBeUndefined()
  })

  it('returns undefined when no tools library', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'b' }
    }
    expect(resolveCamToolType({ operation: op, tools: null })).toBeUndefined()
  })

  it('returns undefined for undefined operation', () => {
    expect(resolveCamToolType({ operation: undefined, tools: lib })).toBeUndefined()
  })
})

describe('resolveCamToolStickoutMm', () => {
  it('returns stickoutMm from the matched tool record', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'd' }
    }
    expect(resolveCamToolStickoutMm({ operation: op, tools: lib })).toBe(22)
  })

  it('returns undefined when tool has no stickoutMm', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'b' }
    }
    expect(resolveCamToolStickoutMm({ operation: op, tools: lib })).toBeUndefined()
  })

  it('returns undefined when toolId is not in library', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'missing' }
    }
    expect(resolveCamToolStickoutMm({ operation: op, tools: lib })).toBeUndefined()
  })

  it('returns undefined when tools library is null', () => {
    const op: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: { toolId: 'd' }
    }
    expect(resolveCamToolStickoutMm({ operation: op, tools: null })).toBeUndefined()
  })

  it('returns undefined when no params', () => {
    const op: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolStickoutMm({ operation: op, tools: lib })).toBeUndefined()
  })

  it('returns undefined for undefined operation', () => {
    expect(resolveCamToolStickoutMm({ operation: undefined, tools: lib })).toBeUndefined()
  })
})
