import { describe, expect, it } from 'vitest'
import {
  meshImportPlacementSchema,
  meshImportUpAxisSchema,
  MESH_IMPORT_PLACEMENT_DEFAULTS,
  parseMeshImportPlacementPayload
} from './mesh-import-placement'

describe('meshImportPlacementSchema', () => {
  it('accepts all three placement values', () => {
    expect(meshImportPlacementSchema.parse('as_is')).toBe('as_is')
    expect(meshImportPlacementSchema.parse('center_origin')).toBe('center_origin')
    expect(meshImportPlacementSchema.parse('center_xy_ground_z')).toBe('center_xy_ground_z')
  })

  it('rejects unknown placement value', () => {
    expect(() => meshImportPlacementSchema.parse('floor')).toThrow()
  })
})

describe('meshImportUpAxisSchema', () => {
  it('accepts y_up and z_up', () => {
    expect(meshImportUpAxisSchema.parse('y_up')).toBe('y_up')
    expect(meshImportUpAxisSchema.parse('z_up')).toBe('z_up')
  })

  it('rejects unknown axis value', () => {
    expect(() => meshImportUpAxisSchema.parse('x_up')).toThrow()
  })
})

describe('MESH_IMPORT_PLACEMENT_DEFAULTS', () => {
  it('has as_is placement, y_up axis, and zero transform', () => {
    expect(MESH_IMPORT_PLACEMENT_DEFAULTS.placement).toBe('as_is')
    expect(MESH_IMPORT_PLACEMENT_DEFAULTS.upAxis).toBe('y_up')
    expect(MESH_IMPORT_PLACEMENT_DEFAULTS.transform.translateMm).toEqual([0, 0, 0])
    expect(MESH_IMPORT_PLACEMENT_DEFAULTS.transform.rotateDeg).toEqual([0, 0, 0])
  })
})

describe('parseMeshImportPlacementPayload', () => {
  it('returns empty object for null', () => {
    expect(parseMeshImportPlacementPayload(null)).toEqual({})
  })

  it('returns empty object for undefined', () => {
    expect(parseMeshImportPlacementPayload(undefined)).toEqual({})
  })

  it('returns empty object for a string', () => {
    expect(parseMeshImportPlacementPayload('center_origin')).toEqual({})
  })

  it('returns empty object for an empty object', () => {
    expect(parseMeshImportPlacementPayload({})).toEqual({})
  })

  it('parses valid placement field', () => {
    const r = parseMeshImportPlacementPayload({ placement: 'center_origin' })
    expect(r.placement).toBe('center_origin')
    expect(r.upAxis).toBeUndefined()
  })

  it('parses all three placement values', () => {
    for (const placement of ['as_is', 'center_origin', 'center_xy_ground_z'] as const) {
      const r = parseMeshImportPlacementPayload({ placement })
      expect(r.placement).toBe(placement)
    }
  })

  it('ignores invalid placement value', () => {
    const r = parseMeshImportPlacementPayload({ placement: 'bad_value' })
    expect(r.placement).toBeUndefined()
  })

  it('parses valid upAxis field', () => {
    expect(parseMeshImportPlacementPayload({ upAxis: 'z_up' }).upAxis).toBe('z_up')
    expect(parseMeshImportPlacementPayload({ upAxis: 'y_up' }).upAxis).toBe('y_up')
  })

  it('ignores invalid upAxis value', () => {
    const r = parseMeshImportPlacementPayload({ upAxis: 'x_up' })
    expect(r.upAxis).toBeUndefined()
  })

  it('parses translateMm into transform with default rotateDeg', () => {
    const r = parseMeshImportPlacementPayload({ translateMm: [10, 20, 30] })
    expect(r.transform?.translateMm).toEqual([10, 20, 30])
    expect(r.transform?.rotateDeg).toEqual([0, 0, 0])
  })

  it('parses rotateDeg into transform with default translateMm', () => {
    const r = parseMeshImportPlacementPayload({ rotateDeg: [90, 0, 45] })
    expect(r.transform?.rotateDeg).toEqual([90, 0, 45])
    expect(r.transform?.translateMm).toEqual([0, 0, 0])
  })

  it('parses both translateMm and rotateDeg together', () => {
    const r = parseMeshImportPlacementPayload({ translateMm: [5, 0, -3], rotateDeg: [0, 180, 0] })
    expect(r.transform?.translateMm).toEqual([5, 0, -3])
    expect(r.transform?.rotateDeg).toEqual([0, 180, 0])
  })

  it('ignores translateMm that is not a 3-element array', () => {
    const r = parseMeshImportPlacementPayload({ translateMm: [1, 2] })
    expect(r.transform).toBeUndefined()
  })

  it('ignores translateMm containing non-finite values', () => {
    const r = parseMeshImportPlacementPayload({ translateMm: [1, NaN, 3] })
    expect(r.transform).toBeUndefined()
  })

  it('parses a full payload with all fields', () => {
    const r = parseMeshImportPlacementPayload({
      placement: 'center_xy_ground_z',
      upAxis: 'z_up',
      translateMm: [0, 0, 5],
      rotateDeg: [0, 0, 90]
    })
    expect(r.placement).toBe('center_xy_ground_z')
    expect(r.upAxis).toBe('z_up')
    expect(r.transform?.translateMm).toEqual([0, 0, 5])
    expect(r.transform?.rotateDeg).toEqual([0, 0, 90])
  })

  it('ignores unknown extra fields', () => {
    const r = parseMeshImportPlacementPayload({ placement: 'as_is', unknown: 'value' })
    expect(r.placement).toBe('as_is')
    expect((r as Record<string, unknown>).unknown).toBeUndefined()
  })
})
