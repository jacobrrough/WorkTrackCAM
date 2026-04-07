import { describe, expect, it } from 'vitest'
import {
  aabbSchema,
  clampingPositionSchema,
  COMMON_FIXTURES,
  defaultFixtureLibrary,
  emptyFixtureLibrary,
  FIXTURE_TYPE_LABELS,
  FIXTURE_TYPES,
  fixtureLibrarySchema,
  fixtureRecordSchema,
  parseFixtureLibrary,
  point3DSchema,
  TSLOT_PLATE,
  VACUUM_TABLE,
  VISE_4IN,
  VISE_6IN,
  type FixtureRecord
} from './fixture-schema'

// ---------------------------------------------------------------------------
// point3DSchema
// ---------------------------------------------------------------------------

describe('point3DSchema', () => {
  it('parses valid 3D point', () => {
    const pt = point3DSchema.parse({ x: 1.5, y: -2.3, z: 0 })
    expect(pt).toEqual({ x: 1.5, y: -2.3, z: 0 })
  })

  it('rejects missing coordinates', () => {
    expect(() => point3DSchema.parse({ x: 1, y: 2 })).toThrow()
  })

  it('rejects non-numeric values', () => {
    expect(() => point3DSchema.parse({ x: 'a', y: 0, z: 0 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// aabbSchema
// ---------------------------------------------------------------------------

describe('aabbSchema', () => {
  it('parses valid AABB', () => {
    const bb = aabbSchema.parse({ minX: -10, maxX: 10, minY: -5, maxY: 5, minZ: 0, maxZ: 20 })
    expect(bb.minX).toBe(-10)
    expect(bb.maxZ).toBe(20)
  })

  it('allows inverted min/max (schema does not enforce ordering)', () => {
    // Schema only validates types, not semantic ordering
    const bb = aabbSchema.parse({ minX: 10, maxX: -10, minY: 5, maxY: -5, minZ: 20, maxZ: 0 })
    expect(bb.minX).toBe(10)
  })

  it('rejects missing fields', () => {
    expect(() => aabbSchema.parse({ minX: 0, maxX: 10 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// clampingPositionSchema
// ---------------------------------------------------------------------------

describe('clampingPositionSchema', () => {
  it('parses clamping position with force direction', () => {
    const cp = clampingPositionSchema.parse({
      label: 'Fixed jaw',
      position: { x: 0, y: 0, z: 10 },
      forceDirection: { x: 1, y: 0, z: 0 }
    })
    expect(cp.label).toBe('Fixed jaw')
    expect(cp.forceDirection).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('parses clamping position without force direction', () => {
    const cp = clampingPositionSchema.parse({
      label: 'Slot',
      position: { x: 0, y: 0, z: 5 }
    })
    expect(cp.forceDirection).toBeUndefined()
  })

  it('trims and rejects empty label', () => {
    expect(() =>
      clampingPositionSchema.parse({
        label: '  ',
        position: { x: 0, y: 0, z: 0 }
      })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// fixtureRecordSchema
// ---------------------------------------------------------------------------

describe('fixtureRecordSchema', () => {
  const minimalFixture: FixtureRecord = {
    id: 'test-1',
    name: 'Test Fixture',
    type: 'vise',
    geometry: [{ minX: -10, maxX: 10, minY: -5, maxY: 5, minZ: 0, maxZ: 20 }],
    clampingPositions: []
  }

  it('parses minimal fixture record', () => {
    const f = fixtureRecordSchema.parse(minimalFixture)
    expect(f.id).toBe('test-1')
    expect(f.type).toBe('vise')
    expect(f.geometry).toHaveLength(1)
  })

  it('parses fixture with all optional fields', () => {
    const f = fixtureRecordSchema.parse({
      ...minimalFixture,
      jawOpeningMm: { minMm: 0, maxMm: 100 },
      meshRef: 'fixtures/vise.stl',
      notes: 'Custom vise'
    })
    expect(f.jawOpeningMm!.maxMm).toBe(100)
    expect(f.meshRef).toBe('fixtures/vise.stl')
  })

  it('rejects fixture with empty geometry array', () => {
    expect(() =>
      fixtureRecordSchema.parse({ ...minimalFixture, geometry: [] })
    ).toThrow()
  })

  it('rejects invalid fixture type', () => {
    expect(() =>
      fixtureRecordSchema.parse({ ...minimalFixture, type: 'robot' })
    ).toThrow()
  })

  it('trims id and name', () => {
    const f = fixtureRecordSchema.parse({ ...minimalFixture, id: '  v1  ', name: '  My Vise  ' })
    expect(f.id).toBe('v1')
    expect(f.name).toBe('My Vise')
  })

  it('defaults clampingPositions to empty array', () => {
    const raw = { id: 'x', name: 'X', type: 'clamp', geometry: [{ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }] }
    const f = fixtureRecordSchema.parse(raw)
    expect(f.clampingPositions).toEqual([])
  })

  it('accepts all valid fixture types', () => {
    for (const ft of FIXTURE_TYPES) {
      const f = fixtureRecordSchema.parse({ ...minimalFixture, type: ft })
      expect(f.type).toBe(ft)
    }
  })
})

// ---------------------------------------------------------------------------
// fixtureLibrarySchema
// ---------------------------------------------------------------------------

describe('fixtureLibrarySchema', () => {
  it('parses empty library', () => {
    const lib = fixtureLibrarySchema.parse({ version: 1 })
    expect(lib.version).toBe(1)
    expect(lib.fixtures).toEqual([])
  })

  it('parses library with fixtures', () => {
    const lib = fixtureLibrarySchema.parse({
      version: 1,
      fixtures: [
        {
          id: 'f1',
          name: 'F1',
          type: 'clamp',
          geometry: [{ minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 5 }]
        }
      ]
    })
    expect(lib.fixtures).toHaveLength(1)
  })

  it('rejects invalid version', () => {
    expect(() => fixtureLibrarySchema.parse({ version: 2 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('emptyFixtureLibrary', () => {
  it('returns v1 library with no fixtures', () => {
    const lib = emptyFixtureLibrary()
    expect(lib.version).toBe(1)
    expect(lib.fixtures).toHaveLength(0)
  })
})

describe('defaultFixtureLibrary', () => {
  it('returns library with all common presets', () => {
    const lib = defaultFixtureLibrary()
    expect(lib.version).toBe(1)
    expect(lib.fixtures).toHaveLength(COMMON_FIXTURES.length)
    expect(lib.fixtures.map((f) => f.id)).toContain('vise-4in')
    expect(lib.fixtures.map((f) => f.id)).toContain('vise-6in')
    expect(lib.fixtures.map((f) => f.id)).toContain('tslot-plate')
    expect(lib.fixtures.map((f) => f.id)).toContain('vacuum-table')
  })
})

describe('parseFixtureLibrary', () => {
  it('parses valid payload', () => {
    const lib = parseFixtureLibrary({ version: 1, fixtures: [] })
    expect(lib.version).toBe(1)
  })

  it('throws on invalid payload', () => {
    expect(() => parseFixtureLibrary({ version: 99 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Common Fixtures Presets
// ---------------------------------------------------------------------------

describe('common fixture presets', () => {
  it('VISE_4IN validates against schema', () => {
    expect(() => fixtureRecordSchema.parse(VISE_4IN)).not.toThrow()
    expect(VISE_4IN.type).toBe('vise')
    expect(VISE_4IN.jawOpeningMm).toBeDefined()
    expect(VISE_4IN.geometry.length).toBeGreaterThanOrEqual(1)
  })

  it('VISE_6IN validates against schema', () => {
    expect(() => fixtureRecordSchema.parse(VISE_6IN)).not.toThrow()
    expect(VISE_6IN.type).toBe('vise')
    expect(VISE_6IN.jawOpeningMm!.maxMm).toBe(150)
  })

  it('TSLOT_PLATE validates against schema', () => {
    expect(() => fixtureRecordSchema.parse(TSLOT_PLATE)).not.toThrow()
    expect(TSLOT_PLATE.type).toBe('plate')
    expect(TSLOT_PLATE.clampingPositions.length).toBeGreaterThan(0)
  })

  it('VACUUM_TABLE validates against schema', () => {
    expect(() => fixtureRecordSchema.parse(VACUUM_TABLE)).not.toThrow()
    expect(VACUUM_TABLE.type).toBe('plate')
  })

  it('all common fixtures have unique IDs', () => {
    const ids = COMMON_FIXTURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all fixture types have labels', () => {
    for (const ft of FIXTURE_TYPES) {
      expect(FIXTURE_TYPE_LABELS[ft]).toBeTruthy()
    }
  })
})
