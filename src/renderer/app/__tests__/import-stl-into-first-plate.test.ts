/**
 * Pin: `importStlIntoFirstPlate` — the pure plate-mutation step of the
 * Design → Manufacture STL hand-off (Wave 3h).
 *
 * The hand-off's last step binds an imported, project-relative STL onto the
 * FIRST plate of the manufacture plan. These tests pin the contract the
 * `ManufactureHost` consume effect relies on:
 *   - existing first op: only `sourceMesh` moves (kind / params / id preserved),
 *   - empty first plate: a single op is seeded (fdm_slice for FDM, cnc_parallel
 *     for CNC) carrying the mesh,
 *   - the FIRST plate is targeted even when other plates exist,
 *   - input is never mutated, and the produced file still parses against the
 *     manufacture schema (Safety Rule 2 — additive, no schema break),
 *   - paths are normalized to project-relative POSIX form.
 */
import { describe, expect, it } from 'vitest'
import {
  importStlIntoFirstPlate,
  normalizeMeshRelPath,
  updateFirstPlate
} from '../import-stl-into-first-plate'
import {
  emptyManufacture,
  manufactureFileSchema,
  type ManufactureFile,
  type ManufactureOperation,
  type Plate
} from '../../../shared/manufacture-schema'

function op(over: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return { id: 'op-1', kind: 'cnc_pocket', label: 'Pocket 1', ...over }
}

function plate(over: Partial<Plate> = {}): Plate {
  return { id: 'plate-1', label: 'Plate 1', setups: [], operations: [], ...over }
}

describe('normalizeMeshRelPath', () => {
  it('converts backslashes to POSIX and strips a leading slash', () => {
    expect(normalizeMeshRelPath('assets\\sub\\part.stl')).toBe('assets/sub/part.stl')
    expect(normalizeMeshRelPath('/assets/part.stl')).toBe('assets/part.stl')
    expect(normalizeMeshRelPath('\\assets\\part.stl')).toBe('assets/part.stl')
    expect(normalizeMeshRelPath('assets/part.stl')).toBe('assets/part.stl')
  })
})

describe('importStlIntoFirstPlate — existing first op', () => {
  it('binds the mesh onto the first op, preserving its kind/label/id and other ops', () => {
    const mfg: ManufactureFile = {
      version: 2,
      setups: [],
      operations: [],
      plates: [
        plate({
          operations: [
            op({ id: 'a', kind: 'cnc_pocket', label: 'Pocket A' }),
            op({ id: 'b', kind: 'cnc_contour', label: 'Contour B', sourceMesh: 'assets/old.stl' })
          ]
        })
      ]
    }
    const next = importStlIntoFirstPlate(mfg, 'assets/new.stl', { env: 'cnc' })
    const ops = next.plates![0]!.operations
    // First op got the mesh; kind/label/id untouched.
    expect(ops[0]).toEqual({ id: 'a', kind: 'cnc_pocket', label: 'Pocket A', sourceMesh: 'assets/new.stl' })
    // Second op is completely untouched.
    expect(ops[1]).toEqual({ id: 'b', kind: 'cnc_contour', label: 'Contour B', sourceMesh: 'assets/old.stl' })
    // No new op was created.
    expect(ops).toHaveLength(2)
  })

  it('does NOT mutate the input file', () => {
    const mfg: ManufactureFile = {
      version: 2,
      setups: [],
      operations: [],
      plates: [plate({ operations: [op({ sourceMesh: 'assets/old.stl' })] })]
    }
    const snapshot = JSON.stringify(mfg)
    importStlIntoFirstPlate(mfg, 'assets/new.stl')
    expect(JSON.stringify(mfg)).toBe(snapshot)
  })
})

describe('importStlIntoFirstPlate — empty first plate seeds an op', () => {
  it('seeds an fdm_slice op for the FDM env with the mesh + a derived label', () => {
    const next = importStlIntoFirstPlate(emptyManufacture(), 'assets/widget.stl', { env: 'fdm' })
    const ops = next.plates![0]!.operations
    expect(ops).toHaveLength(1)
    expect(ops[0]!.kind).toBe('fdm_slice')
    expect(ops[0]!.sourceMesh).toBe('assets/widget.stl')
    expect(ops[0]!.label).toBe('widget')
    expect(ops[0]!.id.length).toBeGreaterThan(0)
  })

  it('seeds a cnc_parallel op for the CNC env (default) and honors an explicit opLabel', () => {
    const next = importStlIntoFirstPlate(emptyManufacture(), 'assets/part.stl', {
      env: 'cnc',
      opLabel: 'Bracket rev B'
    })
    const ops = next.plates![0]!.operations
    expect(ops).toHaveLength(1)
    expect(ops[0]!.kind).toBe('cnc_parallel')
    expect(ops[0]!.sourceMesh).toBe('assets/part.stl')
    expect(ops[0]!.label).toBe('Bracket rev B')
  })

  it('defaults to the CNC env when no env is supplied', () => {
    const next = importStlIntoFirstPlate(emptyManufacture(), 'assets/part.stl')
    expect(next.plates![0]!.operations[0]!.kind).toBe('cnc_parallel')
  })
})

describe('importStlIntoFirstPlate — first-plate targeting + schema safety', () => {
  it('always targets the FIRST plate even when later plates exist', () => {
    const mfg: ManufactureFile = {
      version: 2,
      setups: [],
      operations: [],
      plates: [
        plate({ id: 'first', operations: [op({ id: 'f1', sourceMesh: 'assets/old.stl' })] }),
        plate({ id: 'second', operations: [op({ id: 's1', sourceMesh: 'assets/keep.stl' })] })
      ]
    }
    const next = importStlIntoFirstPlate(mfg, 'assets/new.stl')
    expect(next.plates![0]!.operations[0]!.sourceMesh).toBe('assets/new.stl')
    // The second plate is untouched.
    expect(next.plates![1]!.operations[0]!.sourceMesh).toBe('assets/keep.stl')
  })

  it('normalizes a Windows-style / root-anchored path on the way into the op', () => {
    const next = importStlIntoFirstPlate(emptyManufacture(), '\\assets\\sub\\p.stl', { env: 'cnc' })
    expect(next.plates![0]!.operations[0]!.sourceMesh).toBe('assets/sub/p.stl')
  })

  it('produces a file that still parses against the manufacture schema', () => {
    const next = importStlIntoFirstPlate(emptyManufacture(), 'assets/part.stl', { env: 'fdm' })
    const parsed = manufactureFileSchema.safeParse(next)
    expect(parsed.success).toBe(true)
  })

  it('folds a v1-shaped (no plates) file into a synthesized first plate', () => {
    // A defensive v1 file (top-level ops, no `plates`) must still get the mesh —
    // getPlates synthesizes a default plate from the top-level arrays.
    const v1: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [op({ id: 'top', kind: 'cnc_pocket', label: 'Top op' })]
    }
    const next = importStlIntoFirstPlate(v1, 'assets/new.stl')
    expect(next.plates![0]!.operations[0]).toMatchObject({
      id: 'top',
      kind: 'cnc_pocket',
      sourceMesh: 'assets/new.stl'
    })
  })
})

describe('updateFirstPlate', () => {
  it('clears the deprecated top-level mirror and updates only plate index 0', () => {
    const mfg: ManufactureFile = {
      version: 2,
      setups: [{ id: 's', label: 'S', machineId: 'm', workCoordinateIndex: 1 }],
      operations: [op()],
      plates: [plate({ id: 'p0' }), plate({ id: 'p1' })]
    }
    const next = updateFirstPlate(mfg, (p) => ({ ...p, label: 'renamed' }))
    expect(next.setups).toEqual([])
    expect(next.operations).toEqual([])
    expect(next.plates![0]!.label).toBe('renamed')
    expect(next.plates![1]!.label).toBe('Plate 1')
  })
})
