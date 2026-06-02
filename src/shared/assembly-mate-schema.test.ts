import { describe, expect, it } from 'vitest'
import {
  assemblyMateAxisEnum,
  assemblyMateConstraintSchema,
  assemblyMateConstraintsSchema,
  assemblyMateFeatureSchema,
  assemblyMateKindEnum,
  type AssemblyMateConstraint,
  type AssemblyMateKind
} from './assembly-mate-schema'

describe('assemblyMateKindEnum', () => {
  it('enumerates the six foundation mate kinds', () => {
    expect(assemblyMateKindEnum.options).toEqual([
      'coincident',
      'concentric',
      'distance',
      'angle',
      'flush',
      'tangent'
    ])
  })

  it('rejects an unknown kind', () => {
    expect(() => assemblyMateKindEnum.parse('weld')).toThrow()
  })
})

describe('assemblyMateAxisEnum', () => {
  it('enumerates x/y/z', () => {
    expect(assemblyMateAxisEnum.options).toEqual(['x', 'y', 'z'])
  })
})

describe('assemblyMateFeatureSchema', () => {
  it('accepts a point-only feature', () => {
    const f = assemblyMateFeatureSchema.parse({ x: 1, y: 2, z: 3 })
    expect(f.x).toBe(1)
    expect(f.axis).toBeUndefined()
  })

  it('accepts an axis-only feature', () => {
    const f = assemblyMateFeatureSchema.parse({ axis: 'z' })
    expect(f.axis).toBe('z')
    expect(f.x).toBeUndefined()
  })

  it('accepts a combined point + axis feature', () => {
    const f = assemblyMateFeatureSchema.parse({ x: 0, axis: 'x' })
    expect(f.x).toBe(0)
    expect(f.axis).toBe('x')
  })

  it('rejects an empty feature (no point and no axis)', () => {
    expect(() => assemblyMateFeatureSchema.parse({})).toThrow()
  })

  it('rejects non-finite point coordinates', () => {
    expect(() => assemblyMateFeatureSchema.parse({ x: Number.POSITIVE_INFINITY })).toThrow()
    expect(() => assemblyMateFeatureSchema.parse({ y: Number.NaN })).toThrow()
  })

  it('rejects an unknown axis label', () => {
    expect(() => assemblyMateFeatureSchema.parse({ axis: 'w' })).toThrow()
  })
})

describe('assemblyMateConstraintSchema', () => {
  it('parses a minimal coincident constraint without optional fields', () => {
    const c = assemblyMateConstraintSchema.parse({
      id: 'm1',
      kind: 'coincident',
      part1Id: 'a',
      feature1: { x: 0, y: 0, z: 0 },
      part2Id: 'b',
      feature2: { x: 5, y: 0, z: 0 }
    })
    expect(c.id).toBe('m1')
    expect(c.kind).toBe('coincident')
    expect(c.value).toBeUndefined()
    expect(c.suppress).toBeUndefined()
  })

  it('parses optional value and suppress fields', () => {
    const c = assemblyMateConstraintSchema.parse({
      id: 'd1',
      kind: 'distance',
      part1Id: 'a',
      feature1: { x: 0, y: 0, z: 0 },
      part2Id: 'b',
      feature2: { x: 0, y: 0, z: 0 },
      value: 12.5,
      suppress: true
    })
    expect(c.value).toBe(12.5)
    expect(c.suppress).toBe(true)
  })

  it('trims and requires non-empty id and part ids', () => {
    const c = assemblyMateConstraintSchema.parse({
      id: '  m2  ',
      kind: 'angle',
      part1Id: '  a  ',
      feature1: { axis: 'z' },
      part2Id: '  b  ',
      feature2: { axis: 'x' },
      value: 90
    })
    expect(c.id).toBe('m2')
    expect(c.part1Id).toBe('a')
    expect(c.part2Id).toBe('b')
  })

  it('rejects an empty id, part1Id, or part2Id', () => {
    const base = {
      kind: 'coincident' as const,
      feature1: { x: 0 },
      feature2: { x: 0 }
    }
    expect(() =>
      assemblyMateConstraintSchema.parse({ ...base, id: '', part1Id: 'a', part2Id: 'b' })
    ).toThrow()
    expect(() =>
      assemblyMateConstraintSchema.parse({ ...base, id: 'm', part1Id: '   ', part2Id: 'b' })
    ).toThrow()
    expect(() =>
      assemblyMateConstraintSchema.parse({ ...base, id: 'm', part1Id: 'a', part2Id: '' })
    ).toThrow()
  })

  it('rejects a non-finite value', () => {
    expect(() =>
      assemblyMateConstraintSchema.parse({
        id: 'm',
        kind: 'distance',
        part1Id: 'a',
        feature1: { x: 0 },
        part2Id: 'b',
        feature2: { x: 0 },
        value: Number.NaN
      })
    ).toThrow()
  })
})

describe('assemblyMateConstraintsSchema', () => {
  it('defaults to an empty array when the field is absent (backward compat)', () => {
    expect(assemblyMateConstraintsSchema.parse(undefined)).toEqual([])
  })

  it('parses an array of constraints', () => {
    const arr = assemblyMateConstraintsSchema.parse([
      {
        id: 'm1',
        kind: 'coincident',
        part1Id: 'a',
        feature1: { x: 0 },
        part2Id: 'b',
        feature2: { x: 1 }
      },
      {
        id: 'm2',
        kind: 'concentric',
        part1Id: 'a',
        feature1: { axis: 'z' },
        part2Id: 'c',
        feature2: { axis: 'z' }
      }
    ])
    expect(arr).toHaveLength(2)
    expect(arr[1]!.kind).toBe('concentric')
  })
})

describe('type exports', () => {
  it('AssemblyMateKind and AssemblyMateConstraint are usable as types (no any)', () => {
    const kind: AssemblyMateKind = 'tangent'
    const constraint: AssemblyMateConstraint = {
      id: 'x',
      kind,
      part1Id: 'p1',
      feature1: { axis: 'x' },
      part2Id: 'p2',
      feature2: { axis: 'y' }
    }
    expect(constraint.kind).toBe('tangent')
  })
})
