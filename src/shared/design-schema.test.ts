import { describe, expect, it } from 'vitest'
import {
  designFileSchemaV2,
  designParametersExportSchema,
  emptyDesign,
  mergeParametersIntoDesign,
  normalizeDesign
} from './design-schema'

describe('design-schema round-trip', () => {
  it('mergeParametersIntoDesign overlays keys', () => {
    const d = emptyDesign()
    d.parameters = { d1: 1, d2: 2 }
    const m = mergeParametersIntoDesign(d, { d2: 99, d3: 3 })
    expect(m.parameters).toEqual({ d1: 1, d2: 99, d3: 3 })
  })

  it('designParametersExportSchema accepts export wrapper fields', () => {
    const p = designParametersExportSchema.parse({ parameters: { a: 1 }, exportedAt: 'x' })
    expect(p.parameters.a).toBe(1)
  })

  it('emptyDesign serializes and parses as v2', () => {
    const d = emptyDesign()
    const raw = JSON.stringify(d)
    const again = designFileSchemaV2.parse(JSON.parse(raw) as unknown)
    expect(again.version).toBe(2)
    expect(again.entities).toEqual([])
    expect(again.constraints).toEqual([])
  })

  it('normalizeDesign accepts v2 payload', () => {
    const d = emptyDesign()
    d.entities.push({ id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 })
    const n = normalizeDesign(JSON.parse(JSON.stringify(d)))
    expect(n.version).toBe(2)
    expect(n.entities).toHaveLength(1)
  })

  it('rejects non-finite extrudeDepthMm (kernel / JSON safety)', () => {
    const raw = {
      version: 2,
      extrudeDepthMm: Number.POSITIVE_INFINITY,
      solidKind: 'extrude',
      loftSeparationMm: 20,
      revolve: { angleDeg: 360, axisX: 0 },
      parameters: {},
      points: {},
      entities: [],
      constraints: [],
      dimensions: []
    }
    expect(() => designFileSchemaV2.parse(raw)).toThrow()
  })

  it('fills default sketchPlane when missing from JSON', () => {
    const raw = JSON.stringify({
      version: 2,
      extrudeDepthMm: 10,
      solidKind: 'extrude',
      loftSeparationMm: 20,
      revolve: { angleDeg: 360, axisX: 0 },
      parameters: {},
      points: {},
      entities: [],
      constraints: [],
      dimensions: []
    })
    const again = designFileSchemaV2.parse(JSON.parse(raw) as unknown)
    expect(again.sketchPlane).toEqual({ kind: 'datum', datum: 'XY' })
  })

  it('parses face sketchPlane payload', () => {
    const d = emptyDesign()
    d.sketchPlane = {
      kind: 'face',
      origin: [10, 20, 30],
      normal: [0, 1, 0],
      xAxis: [1, 0, 0]
    }
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)) as unknown)
    expect(again.sketchPlane.kind).toBe('face')
  })

  it('parses sketch dimensions array', () => {
    const d = emptyDesign()
    d.points = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    d.dimensions = [
      { id: 'dm1', kind: 'linear', aId: 'a', bId: 'b' },
      { id: 'dm1a', kind: 'aligned', aId: 'a', bId: 'b' }
    ]
    const raw = JSON.stringify(d)
    const again = designFileSchemaV2.parse(JSON.parse(raw) as unknown)
    expect(again.dimensions).toHaveLength(2)
    expect(again.dimensions[0]!.kind).toBe('linear')
    expect(again.dimensions[1]!.kind).toBe('aligned')
  })

  it('parses slot sketch entity', () => {
    const d = emptyDesign()
    d.entities = [{ id: 'sl', kind: 'slot', cx: 1, cy: 2, length: 10, width: 4, rotation: 0.5 }]
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)) as unknown)
    expect(again.entities[0]).toMatchObject({
      kind: 'slot',
      length: 10,
      width: 4,
      rotation: 0.5
    })
  })

  it('preserves orphan sketch points in v2 round-trip', () => {
    const d = emptyDesign()
    d.points = { orphan: { x: 3.5, y: -2 } }
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)) as unknown)
    expect(again.points.orphan).toEqual({ x: 3.5, y: -2 })
  })

  it('round-trips coincident constraint on spline_fit knot point ids', () => {
    const d = emptyDesign()
    d.points = {
      k0: { x: 0, y: 0 },
      k1: { x: 10, y: 0 },
      k2: { x: 10, y: 10 },
      ext: { x: 0, y: 0 }
    }
    d.entities = [
      {
        id: 'sp1',
        kind: 'spline_fit',
        pointIds: ['k0', 'k1', 'k2'],
        closed: false
      }
    ]
    d.constraints = [{ id: 'c1', type: 'coincident', a: { pointId: 'k0' }, b: { pointId: 'ext' } }]
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)) as unknown)
    expect(again.entities[0]?.kind).toBe('spline_fit')
    expect(again.constraints[0]?.type).toBe('coincident')
    if (again.constraints[0]?.type === 'coincident') {
      expect(again.constraints[0].a.pointId).toBe('k0')
      expect(again.constraints[0].b.pointId).toBe('ext')
    }
  })

  it('parses radial/diameter dimensions and entity constraints', () => {
    const d = emptyDesign()
    d.entities = [
      { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 10 },
      { id: 'c2', kind: 'circle', cx: 5, cy: 0, r: 12 }
    ]
    d.parameters = { d1: 10, d2: 24 }
    d.constraints = [
      { id: 'k1', type: 'concentric', entityAId: 'c1', entityBId: 'c2' },
      { id: 'k2', type: 'radius', entityId: 'c1', parameterKey: 'd1' },
      { id: 'k3', type: 'diameter', entityId: 'c2', parameterKey: 'd2' }
    ]
    d.dimensions = [
      { id: 'dm2', kind: 'radial', entityId: 'c1' },
      { id: 'dm3', kind: 'diameter', entityId: 'c2' },
      { id: 'dm4', kind: 'angular', a1Id: 'p1', b1Id: 'p2', a2Id: 'p3', b2Id: 'p4' }
    ]
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)) as unknown)
    expect(again.constraints).toHaveLength(3)
    expect(again.dimensions).toHaveLength(3)
  })
})
