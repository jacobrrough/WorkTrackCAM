/**
 * Assembly BOM derivation tests (pure node-env).
 *
 * Covers the rollup contract:
 *   - components sharing a geometry source aggregate into one line with summed qty;
 *   - distinct sources → distinct lines;
 *   - the durability preference order (designModelId > relPath > handle > partPath);
 *   - suppressed components excluded;
 *   - bomQuantity > 1 contributes its full count;
 *   - deterministic, source-key-sorted rows.
 *
 * No React, no DOM, no IPC: plain objects exercise every branch.
 */

import { describe, expect, it } from 'vitest'
import { parseAssemblyFile, type AssemblyComponent, type AssemblyFile } from './assembly-schema'
import { bomSourceFor, deriveBom } from './assembly-bom'

/** Build a parsed assembly from partial component rows (schema fills defaults). */
function asm(components: Array<Partial<AssemblyComponent> & { id: string; name: string }>): AssemblyFile {
  return parseAssemblyFile({
    version: 2,
    name: 'BOM assy',
    components: components.map((c) => ({
      partPath: `parts/${c.id}.json`,
      transform: { x: 0, y: 0, z: 0 },
      ...c
    }))
  })
}

describe('bomSourceFor — durability preference', () => {
  it('prefers designModelId over relPath / handle', () => {
    const c = asm([
      { id: 'c1', name: 'A', geometrySource: { designModelId: 'dm-1', relPath: 'x.stl', handle: 'h1' } }
    ]).components[0]!
    expect(bomSourceFor(c)).toEqual({ kind: 'designModel', ref: 'dm-1', key: 'designModel:dm-1' })
  })

  it('falls back to relPath when no designModelId', () => {
    const c = asm([{ id: 'c1', name: 'A', geometrySource: { relPath: 'bodies/x.stl', handle: 'h1' } }])
      .components[0]!
    expect(bomSourceFor(c)).toEqual({ kind: 'relPath', ref: 'bodies/x.stl', key: 'relPath:bodies/x.stl' })
  })

  it('falls back to handle when only a handle exists', () => {
    const c = asm([{ id: 'c1', name: 'A', geometrySource: { handle: 'session-7' } }]).components[0]!
    expect(bomSourceFor(c)).toEqual({ kind: 'handle', ref: 'session-7', key: 'handle:session-7' })
  })

  it('falls back to partPath when there is NO geometrySource (legacy row)', () => {
    const c = asm([{ id: 'c1', name: 'A' }]).components[0]!
    expect(bomSourceFor(c)).toEqual({ kind: 'partPath', ref: 'parts/c1.json', key: 'partPath:parts/c1.json' })
  })
})

describe('deriveBom — rollup', () => {
  it('aggregates N instances of one designModel into a single line with qty N', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i2', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i3', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } }
    ])
    const r = deriveBom(a)
    expect(r.lineCount).toBe(1)
    expect(r.rows[0]).toMatchObject({
      name: 'Bolt',
      qty: 3,
      source: { kind: 'designModel', ref: 'bolt-m6' }
    })
    expect(r.rows[0]!.instanceIds).toEqual(['i1', 'i2', 'i3'])
    expect(r.rows[0]!.partId).toBe('i1') // representative = first in id order
    expect(r.totalQuantity).toBe(3)
    expect(r.contributingComponentCount).toBe(3)
  })

  it('keeps distinct sources as separate lines', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i2', name: 'Nut', geometrySource: { designModelId: 'nut-m6' } }
    ])
    const r = deriveBom(a)
    expect(r.lineCount).toBe(2)
    expect(r.rows.map((row) => row.source.ref).sort()).toEqual(['bolt-m6', 'nut-m6'])
  })

  it('sums bomQuantity (a single row can stand for multiple physical parts)', () => {
    const a = asm([
      { id: 'i1', name: 'Washer', geometrySource: { designModelId: 'wash' }, bomQuantity: 4 },
      { id: 'i2', name: 'Washer', geometrySource: { designModelId: 'wash' }, bomQuantity: 6 }
    ])
    const r = deriveBom(a)
    expect(r.lineCount).toBe(1)
    expect(r.rows[0]!.qty).toBe(10)
    expect(r.totalQuantity).toBe(10)
  })

  it('excludes suppressed components from the rollup', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i2', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' }, suppressed: true }
    ])
    const r = deriveBom(a)
    expect(r.rows[0]!.qty).toBe(1)
    expect(r.rows[0]!.instanceIds).toEqual(['i1'])
    expect(r.contributingComponentCount).toBe(1)
  })

  it('does NOT merge two rows pointing at the same body via different ref kinds (honest limit)', () => {
    // One row references a designModel, the other only an ephemeral handle for (conceptually)
    // the same body. Geometry-blind: we cannot prove sameness, so they stay separate.
    const a = asm([
      { id: 'i1', name: 'Plate', geometrySource: { designModelId: 'plate-1' } },
      { id: 'i2', name: 'Plate', geometrySource: { handle: 'plate-1' } }
    ])
    const r = deriveBom(a)
    expect(r.lineCount).toBe(2)
  })

  it('flags nameVaries when contributing rows disagree on name', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt M6', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i2', name: 'M6 Bolt', geometrySource: { designModelId: 'bolt-m6' } }
    ])
    const r = deriveBom(a)
    expect(r.lineCount).toBe(1)
    expect(r.rows[0]!.nameVaries).toBe(true)
    // Representative name is the first in id order.
    expect(r.rows[0]!.name).toBe('Bolt M6')
  })

  it('returns rows in deterministic source-key order', () => {
    const a = asm([
      { id: 'zz', name: 'Z', geometrySource: { designModelId: 'z-body' } },
      { id: 'aa', name: 'A', geometrySource: { designModelId: 'a-body' } },
      { id: 'mm', name: 'M', geometrySource: { relPath: 'm.stl' } }
    ])
    const r1 = deriveBom(a)
    const r2 = deriveBom(asm([...a.components].reverse()))
    expect(r1.rows.map((row) => row.source.key)).toEqual(r2.rows.map((row) => row.source.key))
    // designModel:* sorts before relPath:* lexicographically.
    expect(r1.rows.map((row) => row.source.key)).toEqual([
      'designModel:a-body',
      'designModel:z-body',
      'relPath:m.stl'
    ])
  })

  it('an empty assembly yields no rows', () => {
    const r = deriveBom(asm([]))
    expect(r.rows).toEqual([])
    expect(r.lineCount).toBe(0)
    expect(r.totalQuantity).toBe(0)
  })
})
