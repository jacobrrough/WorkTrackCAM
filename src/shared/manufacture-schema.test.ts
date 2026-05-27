import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createDefaultPlate,
  DEFAULT_PLATE_ID,
  emptyManufacture,
  isManufactureCncOperationKind,
  jsonSafeValueSchema,
  manufactureFileSchema,
  manufactureOperationSchema,
  parseManufactureFile,
  plateSchema,
  stockSchema,
  upgradeManufactureV1toV2,
  type ManufactureOperationKind
} from './manufacture-schema'

describe('manufactureFileSchema', () => {
  it('parses legacy v1 files without new setup fields', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [{ id: 'a', label: 'S1', machineId: 'm1' }],
      operations: []
    })
    expect(m.setups[0]!.workCoordinateIndex).toBeUndefined()
  })

  it('trims setup id, label, machineId', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [{ id: '  a  ', label: '  S1  ', machineId: '  m1  ' }],
      operations: []
    })
    expect(m.setups[0]).toMatchObject({ id: 'a', label: 'S1', machineId: 'm1' })
  })

  it('rejects empty setup id, label, or machineId', () => {
    expect(() =>
      manufactureFileSchema.parse({
        version: 1,
        setups: [{ id: '', label: 'S', machineId: 'm' }],
        operations: []
      })
    ).toThrow()
    expect(() =>
      manufactureFileSchema.parse({
        version: 1,
        setups: [{ id: 'a', label: '  ', machineId: 'm' }],
        operations: []
      })
    ).toThrow()
  })

  it('trims operation id and label', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [{ id: '  o1  ', kind: 'cnc_parallel', label: '  Rough  ' }]
    })
    expect(m.operations[0]).toMatchObject({ id: 'o1', label: 'Rough' })
  })

  it('rejects empty operation id or label', () => {
    expect(() =>
      manufactureFileSchema.parse({
        version: 1,
        setups: [],
        operations: [{ id: '', kind: 'cnc_parallel', label: 'L' }]
      })
    ).toThrow()
  })

  it('accepts cnc_adaptive and stock allowance', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [
        {
          id: 'a',
          label: 'S1',
          machineId: 'm1',
          workCoordinateIndex: 2,
          stock: { kind: 'box', x: 100, y: 100, z: 20, allowanceMm: 0.5 }
        }
      ],
      operations: [{ id: 'o1', kind: 'cnc_adaptive', label: 'Rough' }]
    })
    expect(m.operations[0]!.kind).toBe('cnc_adaptive')
    expect(m.setups[0]!.stock?.allowanceMm).toBe(0.5)
  })

  it('accepts fixture note and cnc_waterline op kind', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [{ id: 'a', label: 'S1', machineId: 'm1', fixtureNote: 'Soft jaws' }],
      operations: [{ id: 'o1', kind: 'cnc_waterline', label: 'WL' }]
    })
    expect(m.operations[0]!.kind).toBe('cnc_waterline')
    expect(m.setups[0]!.fixtureNote).toBe('Soft jaws')
  })

  it('accepts cnc_raster op kind', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [{ id: 'o1', kind: 'cnc_raster', label: 'Raster' }]
    })
    expect(m.operations[0]!.kind).toBe('cnc_raster')
  })

  it('accepts every manufacture operation kind in one file', () => {
    const kinds = [
      'fdm_slice',
      'cnc_parallel',
      'cnc_contour',
      'cnc_pocket',
      'cnc_drill',
      'cnc_adaptive',
      'cnc_waterline',
      'cnc_raster',
      'cnc_pencil',
      'cnc_lathe_turn',
      'export_stl'
    ] as const satisfies readonly ManufactureOperationKind[]
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: kinds.map((kind, i) => ({ id: `o${i}`, kind, label: kind }))
    })
    expect(m.operations.map((o) => o.kind)).toEqual([...kinds])
  })
})

describe('isManufactureCncOperationKind', () => {
  const cncKinds: ManufactureOperationKind[] = [
    'cnc_parallel',
    'cnc_contour',
    'cnc_pocket',
    'cnc_drill',
    'cnc_adaptive',
    'cnc_waterline',
    'cnc_raster',
    'cnc_pencil',
    'cnc_4axis_roughing',
    'cnc_4axis_finishing',
    'cnc_4axis_contour',
    'cnc_4axis_indexed',
    'cnc_lathe_turn'
  ]

  it('is true for every cnc_* manufacture kind', () => {
    for (const k of cncKinds) {
      expect(isManufactureCncOperationKind(k)).toBe(true)
    }
  })

  it('is false for FDM and export kinds', () => {
    expect(isManufactureCncOperationKind('fdm_slice')).toBe(false)
    expect(isManufactureCncOperationKind('export_stl')).toBe(false)
  })
})

describe('4-axis operation kinds', () => {
  it('parses cnc_4axis_roughing operation', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [
        {
          id: 'rotary-1',
          kind: 'cnc_4axis_roughing',
          label: 'Rotary roughing',
          params: {
            cylinderDiameterMm: 50,
            cylinderLengthMm: 80,
            zPassMm: -3,
            zStepMm: 1,
            stepoverDeg: 5,
            feedMmMin: 600
          }
        }
      ]
    })
    expect(m.operations[0]!.kind).toBe('cnc_4axis_roughing')
    expect(m.operations[0]!.params!['cylinderDiameterMm']).toBe(50)
  })

  it('parses cnc_4axis_indexed operation', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [
        {
          id: 'indexed-1',
          kind: 'cnc_4axis_indexed',
          label: 'Hex flats — 6 faces',
          params: {
            indexAnglesDeg: [0, 60, 120, 180, 240, 300],
            cylinderDiameterMm: 30,
            zPassMm: -2
          }
        }
      ]
    })
    expect(m.operations[0]!.kind).toBe('cnc_4axis_indexed')
    expect(m.operations[0]!.params!['indexAnglesDeg']).toEqual([0, 60, 120, 180, 240, 300])
  })
})

describe('manufacture schema pocket param docs', () => {
  it('keeps pocket param text aligned with policy-facing behavior', () => {
    const source = readFileSync(join(__dirname, 'manufacture-schema.ts'), 'utf-8')
    expect(source).toContain('zStepMm')
    expect(source).toContain("entryMode")
    expect(source).toContain('rampMm')
    expect(source).toContain('rampMaxAngleDeg')
    expect(source).toContain('wallStockMm')
    expect(source).toContain('finishPass')
    expect(source).toContain('finishEachDepth')
  })
})

describe('v4.0 Python toolpath engine operation kinds', () => {
  const v4Kinds = [
    'cnc_spiral_finish',
    'cnc_morphing_finish',
    'cnc_trochoidal_hsm',
    'cnc_steep_shallow',
    'cnc_scallop_finish',
    'cnc_4axis_continuous',
    'cnc_auto_select'
  ] as const satisfies readonly ManufactureOperationKind[]

  it('parses every v4.0 Python engine kind', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: v4Kinds.map((kind, i) => ({ id: `o${i}`, kind, label: kind }))
    })
    expect(m.operations.map((o) => o.kind)).toEqual([...v4Kinds])
  })

  it('all v4.0 kinds start with cnc_ so isManufactureCncOperationKind returns true', () => {
    for (const kind of v4Kinds) {
      expect(isManufactureCncOperationKind(kind)).toBe(true)
    }
  })

  it('parses cnc_4axis_continuous with cylinder params', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [
        {
          id: 'axis4c-1',
          kind: 'cnc_4axis_continuous',
          label: '4-axis continuous roughing',
          params: {
            cylinderDiameterMm: 60,
            cylinderLengthMm: 100,
            toolDiameterMm: 6,
            stepoverMm: 1.5,
            feedMmMin: 800,
            plungeMmMin: 300,
            safeZMm: 10
          }
        }
      ]
    })
    expect(m.operations[0]!.kind).toBe('cnc_4axis_continuous')
    expect(m.operations[0]!.params!['cylinderDiameterMm']).toBe(60)
  })

  it('parses cnc_scallop_finish with surfaceFinishRaUm', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [
        {
          id: 'scallop-1',
          kind: 'cnc_scallop_finish',
          label: 'Scallop Ra 1.6',
          params: {
            toolDiameterMm: 6,
            stepoverMm: 0.5,
            feedMmMin: 1200,
            surfaceFinishRaUm: 1.6
          }
        }
      ]
    })
    expect(m.operations[0]!.kind).toBe('cnc_scallop_finish')
    expect(m.operations[0]!.params!['surfaceFinishRaUm']).toBe(1.6)
  })
})

describe('5-axis operation kinds', () => {
  const fiveAxisKinds = ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline'] as const satisfies readonly ManufactureOperationKind[]

  it('parses every 5-axis kind', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: fiveAxisKinds.map((kind, i) => ({ id: `o${i}`, kind, label: kind }))
    })
    expect(m.operations.map((o) => o.kind)).toEqual([...fiveAxisKinds])
  })

  it('all 5-axis kinds satisfy isManufactureCncOperationKind', () => {
    for (const kind of fiveAxisKinds) {
      expect(isManufactureCncOperationKind(kind)).toBe(true)
    }
  })
})

describe('parseManufactureFile', () => {
  it('parses valid v1 data (migrated to v2 with one Default plate)', () => {
    // Gap #7 v1: parseManufactureFile now auto-migrates v1 inputs to v2 by
    // wrapping the legacy top-level setups + operations into plates[0].
    const result = parseManufactureFile({
      version: 1,
      setups: [{ id: 's1', label: 'Setup 1', machineId: 'mill-1' }],
      operations: [
        { id: 'op1', kind: 'cnc_parallel', label: 'Rough pass' },
        { id: 'op2', kind: 'cnc_contour', label: 'Finish contour' }
      ]
    })
    expect(result.version).toBe(2)
    expect(result.plates).toHaveLength(1)
    expect(result.plates![0]!.label).toBe('Default plate')
    expect(result.plates![0]!.setups).toHaveLength(1)
    expect(result.plates![0]!.operations).toHaveLength(2)
    expect(result.plates![0]!.setups[0]!.id).toBe('s1')
    expect(result.plates![0]!.operations[0]!.kind).toBe('cnc_parallel')
    expect(result.plates![0]!.operations[1]!.kind).toBe('cnc_contour')
    // Top-level cleared on migration (back-compat fields)
    expect(result.setups).toEqual([])
    expect(result.operations).toEqual([])
  })

  it('rejects invalid data (missing required fields)', () => {
    // Missing version
    expect(() => parseManufactureFile({ setups: [], operations: [] })).toThrow()
    // Wrong version
    expect(() =>
      parseManufactureFile({ version: 99, setups: [], operations: [] })
    ).toThrow()
    // Missing operation kind
    expect(() =>
      parseManufactureFile({
        version: 1,
        setups: [],
        operations: [{ id: 'op1', label: 'Bad op' }]
      })
    ).toThrow()
    // Missing operation id
    expect(() =>
      parseManufactureFile({
        version: 1,
        setups: [],
        operations: [{ kind: 'cnc_drill', label: 'No ID' }]
      })
    ).toThrow()
  })

  it('preserves all operation kinds', () => {
    const allKinds: ManufactureOperationKind[] = [
      'fdm_slice',
      'cnc_parallel',
      'cnc_contour',
      'cnc_pocket',
      'cnc_drill',
      'cnc_adaptive',
      'cnc_waterline',
      'cnc_raster',
      'cnc_pencil',
      'cnc_4axis_roughing',
      'cnc_4axis_finishing',
      'cnc_4axis_contour',
      'cnc_4axis_indexed',
      'cnc_3d_rough',
      'cnc_3d_finish',
      'cnc_chamfer',
      'cnc_thread_mill',
      'cnc_laser',
      'cnc_pcb_isolation',
      'cnc_pcb_drill',
      'cnc_pcb_contour',
      'cnc_spiral_finish',
      'cnc_morphing_finish',
      'cnc_trochoidal_hsm',
      'cnc_steep_shallow',
      'cnc_scallop_finish',
      'cnc_4axis_continuous',
      'cnc_5axis_contour',
      'cnc_5axis_swarf',
      'cnc_5axis_flowline',
      'cnc_auto_select',
      'cnc_lathe_turn',
      'export_stl'
    ]
    const result = parseManufactureFile({
      version: 1,
      setups: [],
      operations: allKinds.map((kind, i) => ({ id: `op${i}`, kind, label: `Op ${kind}` }))
    })
    // Gap #7 v1: v1 inputs migrate to v2 with operations under plates[0]
    expect(result.plates![0]!.operations.map((o) => o.kind)).toEqual(allKinds)
  })

  it('handles extra unknown fields gracefully (strips them, then migrates to v2)', () => {
    const result = parseManufactureFile({
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'Setup 1',
          machineId: 'mill-1',
          unknownFieldOnSetup: 'should be stripped'
        }
      ],
      operations: [
        {
          id: 'op1',
          kind: 'cnc_parallel',
          label: 'Op 1',
          unknownFieldOnOp: 42
        }
      ],
      extraTopLevel: true
    })
    // Gap #7 v1: v1 inputs migrate to v2; the migrated content lives in plates[0]
    expect(result.version).toBe(2)
    expect(result.plates).toHaveLength(1)
    expect(result.plates![0]!.setups).toHaveLength(1)
    expect(result.plates![0]!.operations).toHaveLength(1)
    // Unknown fields should be stripped by Zod's default behavior
    expect('unknownFieldOnSetup' in result.plates![0]!.setups[0]!).toBe(false)
    expect('unknownFieldOnOp' in result.plates![0]!.operations[0]!).toBe(false)
    expect('extraTopLevel' in result).toBe(false)
  })
})

describe('stockSchema discriminated union', () => {
  it('parses box stock with all dimensions', () => {
    const stock = stockSchema.parse({ kind: 'box', x: 200, y: 150, z: 25 })
    expect(stock.kind).toBe('box')
    expect(stock.x).toBe(200)
    expect(stock.y).toBe(150)
    expect(stock.z).toBe(25)
  })

  it('parses box stock with optional dimensions (backward compat)', () => {
    const stock = stockSchema.parse({ kind: 'box' })
    expect(stock.kind).toBe('box')
    expect(stock.x).toBeUndefined()
    expect(stock.y).toBeUndefined()
    expect(stock.z).toBeUndefined()
  })

  it('parses cylinder stock', () => {
    const stock = stockSchema.parse({ kind: 'cylinder', x: 100, z: 50 })
    expect(stock.kind).toBe('cylinder')
    expect(stock.x).toBe(100)
    expect(stock.z).toBe(50)
  })

  it('parses fromExtents stock', () => {
    const stock = stockSchema.parse({ kind: 'fromExtents' })
    expect(stock.kind).toBe('fromExtents')
  })

  it('parses fromExtents with override dimensions', () => {
    const stock = stockSchema.parse({ kind: 'fromExtents', x: 150, y: 100, z: 30 })
    expect(stock.kind).toBe('fromExtents')
    expect(stock.x).toBe(150)
  })

  it('accepts allowanceMm and materialType on all kinds', () => {
    for (const kind of ['box', 'cylinder', 'fromExtents'] as const) {
      const stock = stockSchema.parse({ kind, allowanceMm: 0.5, materialType: 'aluminum' })
      expect(stock.allowanceMm).toBe(0.5)
      expect(stock.materialType).toBe('aluminum')
    }
  })

  it('rejects invalid stock kind', () => {
    expect(() => stockSchema.parse({ kind: 'sphere' })).toThrow()
  })

  it('rejects negative dimensions', () => {
    expect(() => stockSchema.parse({ kind: 'box', x: -10 })).toThrow()
  })

  it('rejects zero dimensions', () => {
    expect(() => stockSchema.parse({ kind: 'box', x: 0 })).toThrow()
  })

  it('discriminates correctly between kinds (TypeScript narrowing works)', () => {
    const box = stockSchema.parse({ kind: 'box', x: 100, y: 80, z: 20 })
    if (box.kind === 'box') {
      // TypeScript narrows to stockBoxSchema inferred type
      expect(box.x).toBe(100)
      expect(box.y).toBe(80)
      expect(box.z).toBe(20)
    }
  })

  it('works inside setupSchema / manufactureFileSchema', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [{
        id: 'a',
        label: 'Setup 1',
        machineId: 'mill-1',
        stock: { kind: 'cylinder', x: 80, z: 30, materialType: 'brass' }
      }],
      operations: []
    })
    expect(m.setups[0]!.stock?.kind).toBe('cylinder')
    expect(m.setups[0]!.stock?.materialType).toBe('brass')
  })
})

describe('jsonSafeValueSchema (replaces z.unknown in params)', () => {
  it('accepts numbers', () => {
    expect(jsonSafeValueSchema.parse(42)).toBe(42)
    expect(jsonSafeValueSchema.parse(-3.14)).toBe(-3.14)
    expect(jsonSafeValueSchema.parse(0)).toBe(0)
  })

  it('accepts strings', () => {
    expect(jsonSafeValueSchema.parse('hello')).toBe('hello')
    expect(jsonSafeValueSchema.parse('')).toBe('')
  })

  it('accepts booleans', () => {
    expect(jsonSafeValueSchema.parse(true)).toBe(true)
    expect(jsonSafeValueSchema.parse(false)).toBe(false)
  })

  it('accepts null', () => {
    expect(jsonSafeValueSchema.parse(null)).toBeNull()
  })

  it('accepts arrays of primitives', () => {
    expect(jsonSafeValueSchema.parse([1, 2, 3])).toEqual([1, 2, 3])
    expect(jsonSafeValueSchema.parse(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('accepts nested arrays (contour points)', () => {
    const contour = [[10, 20], [30, 40], [50, 60]]
    expect(jsonSafeValueSchema.parse(contour)).toEqual(contour)
  })

  it('accepts mixed-type arrays', () => {
    expect(jsonSafeValueSchema.parse([1, 'two', true, null])).toEqual([1, 'two', true, null])
  })

  it('rejects undefined', () => {
    expect(() => jsonSafeValueSchema.parse(undefined)).toThrow()
  })

  it('rejects plain objects (params record values must be primitives/arrays)', () => {
    expect(() => jsonSafeValueSchema.parse({ key: 'value' })).toThrow()
  })

  it('works in operation params context', () => {
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [],
      operations: [{
        id: 'op1',
        kind: 'cnc_drill',
        label: 'Drill holes',
        params: {
          drillPoints: [[10, 20], [30, 40]],
          zPassMm: -5,
          retractMm: 3,
          peckMm: 1.5,
          dwellMs: 200,
          drillCycle: 'g83',
          usePeck: true
        }
      }]
    })
    expect(m.operations[0]!.params!['drillPoints']).toEqual([[10, 20], [30, 40]])
    expect(m.operations[0]!.params!['zPassMm']).toBe(-5)
    expect(m.operations[0]!.params!['drillCycle']).toBe('g83')
    expect(m.operations[0]!.params!['usePeck']).toBe(true)
  })
})

describe('schema .describe() introspection', () => {
  it('stockSchema kind has a description', () => {
    // Discriminated union shape — check one variant
    const boxOption = stockSchema.options.find(
      (o) => (o.shape as Record<string, { description?: string }>).kind?.description !== undefined
    )
    expect(boxOption).toBeDefined()
  })

  it('manufactureFileSchema version field has a description', () => {
    const desc = manufactureFileSchema.shape.version.description
    expect(desc).toContain('version')
  })

  it('manufactureOperationSchema kind field has a description', () => {
    const kindField = manufactureOperationSchema.shape.kind
    expect(kindField.description).toBeDefined()
    expect(kindField.description).toContain('strategy')
  })
})

// --- Gap #7 v1: multi-plate / multi-job project ---

describe('plateSchema (Gap #7 v1)', () => {
  it('parses a minimal plate (id + label only -- setups/operations default to [])', () => {
    const p = plateSchema.parse({ id: 'p1', label: 'My plate' })
    expect(p.id).toBe('p1')
    expect(p.label).toBe('My plate')
    expect(p.setups).toEqual([])
    expect(p.operations).toEqual([])
  })

  it('parses a plate with setups + operations', () => {
    const p = plateSchema.parse({
      id: 'p1',
      label: 'K2 calib 1',
      setups: [{ id: 's1', label: 'S1', machineId: 'creality-k2-plus' }],
      operations: [{ id: 'op1', kind: 'fdm_slice', label: 'Slice' }]
    })
    expect(p.setups).toHaveLength(1)
    expect(p.operations).toHaveLength(1)
  })

  it('trims id and label, rejects empty', () => {
    const p = plateSchema.parse({ id: '  p1  ', label: '  Plate  ' })
    expect(p.id).toBe('p1')
    expect(p.label).toBe('Plate')
    expect(() => plateSchema.parse({ id: '', label: 'L' })).toThrow()
    expect(() => plateSchema.parse({ id: 'p1', label: '   ' })).toThrow()
  })

  it('accepts optional createdAt timestamp', () => {
    const ts = '2026-05-27T12:00:00.000Z'
    const p = plateSchema.parse({ id: 'p1', label: 'P', createdAt: ts })
    expect(p.createdAt).toBe(ts)
  })
})

describe('manufactureFileSchema v2 plates field (Gap #7 v1)', () => {
  it('parses a v2 file with one plate', () => {
    const m = manufactureFileSchema.parse({
      version: 2,
      setups: [],
      operations: [],
      plates: [
        {
          id: 'plate-default',
          label: 'Default plate',
          setups: [{ id: 's1', label: 'S1', machineId: 'creality-k2-plus' }],
          operations: [{ id: 'op1', kind: 'fdm_slice', label: 'Slice K2' }]
        }
      ]
    })
    expect(m.version).toBe(2)
    expect(m.plates).toBeDefined()
    expect(m.plates).toHaveLength(1)
    expect(m.plates![0]!.id).toBe('plate-default')
    expect(m.plates![0]!.setups).toHaveLength(1)
    expect(m.plates![0]!.operations).toHaveLength(1)
  })

  it('parses a v2 file with multiple plates (calibration batch)', () => {
    const m = manufactureFileSchema.parse({
      version: 2,
      setups: [],
      operations: [],
      plates: Array.from({ length: 5 }, (_, i) => ({
        id: `plate-${i}`,
        label: `Calib ${i + 1}`,
        setups: [],
        operations: []
      }))
    })
    expect(m.plates).toHaveLength(5)
  })

  it('parses a v2 file WITHOUT plates (optional -- schema additivity)', () => {
    // Additivity: a v2 file with only top-level setups/operations and no
    // plates array must parse so existing savers (pre-plate UI) still work.
    const m = manufactureFileSchema.parse({ version: 2, setups: [], operations: [] })
    expect(m.version).toBe(2)
    expect(m.plates).toBeUndefined()
  })

  it('still parses a legacy v1 file unchanged (no plates field, no migration here)', () => {
    // Additivity: the v1 shape is still accepted at the raw schema level --
    // callers that do not go through parseManufactureFile keep working.
    const m = manufactureFileSchema.parse({
      version: 1,
      setups: [{ id: 's1', label: 'S1', machineId: 'mill-1' }],
      operations: [{ id: 'op1', kind: 'cnc_parallel', label: 'Op' }]
    })
    expect(m.version).toBe(1)
    expect(m.plates).toBeUndefined()
  })
})

describe('createDefaultPlate / DEFAULT_PLATE_ID (Gap #7 v1)', () => {
  it('emits a stable default plate id', () => {
    expect(DEFAULT_PLATE_ID).toBe('plate-default')
    const p = createDefaultPlate()
    expect(p.id).toBe(DEFAULT_PLATE_ID)
    expect(p.label).toBe('Default plate')
    expect(p.setups).toEqual([])
    expect(p.operations).toEqual([])
  })
})

describe('emptyManufacture v2 default (Gap #7 v1)', () => {
  it('returns a v2 file with exactly one default plate', () => {
    const m = emptyManufacture()
    expect(m.version).toBe(2)
    expect(m.setups).toEqual([])
    expect(m.operations).toEqual([])
    expect(m.plates).toHaveLength(1)
    expect(m.plates![0]!.id).toBe(DEFAULT_PLATE_ID)
    expect(m.plates![0]!.label).toBe('Default plate')
  })

  it('round-trips through manufactureFileSchema.parse', () => {
    const m = emptyManufacture()
    const reparsed = manufactureFileSchema.parse(JSON.parse(JSON.stringify(m)))
    expect(reparsed.version).toBe(2)
    expect(reparsed.plates).toHaveLength(1)
  })
})

describe('parseManufactureFile v1 -> v2 inline migration (Gap #7 v1)', () => {
  it('migrates a v1 file with legacy setups+operations into plates[0]', () => {
    const v1Payload = {
      version: 1,
      setups: [{ id: 's1', label: 'S1', machineId: 'creality-k2-plus' }],
      operations: [{ id: 'op1', kind: 'fdm_slice', label: 'Slice' }]
    }
    const result = parseManufactureFile(v1Payload)
    expect(result.version).toBe(2)
    // Legacy content lives in plates[0]
    expect(result.plates).toHaveLength(1)
    expect(result.plates![0]!.label).toBe('Default plate')
    expect(result.plates![0]!.setups).toHaveLength(1)
    expect(result.plates![0]!.setups[0]!.id).toBe('s1')
    expect(result.plates![0]!.operations).toHaveLength(1)
    expect(result.plates![0]!.operations[0]!.kind).toBe('fdm_slice')
    // Top-level cleared
    expect(result.setups).toEqual([])
    expect(result.operations).toEqual([])
  })

  it('passes a v2 file through unchanged', () => {
    const v2Payload = {
      version: 2 as const,
      setups: [],
      operations: [],
      plates: [
        {
          id: 'plate-a',
          label: 'A',
          setups: [{ id: 's-a', label: 'S A', machineId: 'laguna-swift-5x10' }],
          operations: [{ id: 'op-a', kind: 'cnc_contour', label: 'Outline' }]
        }
      ]
    }
    const result = parseManufactureFile(v2Payload)
    expect(result.version).toBe(2)
    expect(result.plates).toHaveLength(1)
    expect(result.plates![0]!.id).toBe('plate-a')
    expect(result.plates![0]!.setups[0]!.machineId).toBe('laguna-swift-5x10')
  })

  it('migrates an empty v1 file into a single empty default plate', () => {
    const result = parseManufactureFile({ version: 1, setups: [], operations: [] })
    expect(result.version).toBe(2)
    expect(result.plates).toHaveLength(1)
    expect(result.plates![0]!.id).toBe('plate-default')
    expect(result.plates![0]!.setups).toEqual([])
    expect(result.plates![0]!.operations).toEqual([])
  })
})

describe('upgradeManufactureV1toV2 (Gap #7 v1)', () => {
  it('produces the same v2 shape as parseManufactureFile for v1 input', () => {
    const v1 = manufactureFileSchema.parse({
      version: 1,
      setups: [{ id: 's1', label: 'S1', machineId: 'm1' }],
      operations: [{ id: 'op1', kind: 'cnc_parallel', label: 'O1' }]
    })
    const v2 = upgradeManufactureV1toV2(v1)
    expect(v2.version).toBe(2)
    expect(v2.plates).toHaveLength(1)
    expect(v2.plates![0]!.setups).toHaveLength(1)
    expect(v2.plates![0]!.operations).toHaveLength(1)
  })

  it('is identity for an already-v2 file', () => {
    const v2 = emptyManufacture()
    const result = upgradeManufactureV1toV2(v2)
    expect(result).toBe(v2)
  })
})
