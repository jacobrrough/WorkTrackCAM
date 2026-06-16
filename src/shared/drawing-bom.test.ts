/**
 * Drawings BOM derivation tests (pure node-env).
 *
 * Covers the four input cases of `deriveDrawingBom`:
 *   - assembly  → reuses the assembly rollup (N instances → one line, qty N);
 *   - designModels → one row per CAD model (qty 1);
 *   - singlePart → a single stub row;
 *   - empty     → no rows.
 * Plus the renderer stamp adapter `toBomTableRows`.
 *
 * No React, no DOM, no IPC: plain objects exercise every branch.
 */

import { describe, expect, it } from 'vitest'
import { parseAssemblyFile, type AssemblyComponent, type AssemblyFile } from './assembly-schema'
import type { DesignModel } from './project-schema'
import { drawingBomRowSchema } from './drawing-annotation-schema'
import { deriveDrawingBom, toBomTableRows } from './drawing-bom'

/** Build a parsed assembly from partial component rows (schema fills defaults). */
function asm(components: Array<Partial<AssemblyComponent> & { id: string; name: string }>): AssemblyFile {
  return parseAssemblyFile({
    version: 2,
    name: 'Drawing BOM assy',
    components: components.map((c) => ({
      partPath: `parts/${c.id}.json`,
      transform: { x: 0, y: 0, z: 0 },
      ...c
    }))
  })
}

function model(id: string, name: string): DesignModel {
  return {
    id,
    name,
    scriptText: '# cq',
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z'
  }
}

// ── Assembly path ──────────────────────────────────────────────────────────────

describe('deriveDrawingBom — assembly', () => {
  it('rolls N instances of one body into one line with qty N', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i2', name: 'Bolt', geometrySource: { designModelId: 'bolt-m6' } },
      { id: 'i3', name: 'Plate', geometrySource: { designModelId: 'plate-1' } }
    ])
    const rows = deriveDrawingBom({ kind: 'assembly', assembly: a })
    expect(rows).toHaveLength(2)
    const bolt = rows.find((r) => r.description === 'Bolt')!
    expect(bolt.qty).toBe(2)
    const plate = rows.find((r) => r.description === 'Plate')!
    expect(plate.qty).toBe(1)
    // 1-based find numbers, contiguous.
    expect(rows.map((r) => r.item).sort()).toEqual([1, 2])
  })

  it('sums bomQuantity (one component standing for several physical instances)', () => {
    const a = asm([{ id: 'i1', name: 'Washer', geometrySource: { designModelId: 'w' }, bomQuantity: 8 }])
    const rows = deriveDrawingBom({ kind: 'assembly', assembly: a })
    expect(rows[0]!.qty).toBe(8)
  })

  it('prefers an explicit component partNumber for the line partNumber', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt', partNumber: 'M6x20-SHCS', geometrySource: { designModelId: 'b' } }
    ])
    const rows = deriveDrawingBom({ kind: 'assembly', assembly: a })
    expect(rows[0]!.partNumber).toBe('M6x20-SHCS')
  })

  it('falls back to the source ref for partNumber when none is set', () => {
    const a = asm([{ id: 'i1', name: 'Bracket', geometrySource: { designModelId: 'dm-99' } }])
    const rows = deriveDrawingBom({ kind: 'assembly', assembly: a })
    expect(rows[0]!.partNumber).toBe('dm-99')
  })

  it('excludes suppressed components (inherited from deriveBom)', () => {
    const a = asm([
      { id: 'i1', name: 'Keep', geometrySource: { designModelId: 'k' } },
      { id: 'i2', name: 'Drop', geometrySource: { designModelId: 'd' }, suppressed: true }
    ])
    const rows = deriveDrawingBom({ kind: 'assembly', assembly: a })
    expect(rows.map((r) => r.description)).toEqual(['Keep'])
  })

  it('an empty assembly yields no rows', () => {
    expect(deriveDrawingBom({ kind: 'assembly', assembly: asm([]) })).toEqual([])
  })
})

// ── Design-models path ─────────────────────────────────────────────────────────

describe('deriveDrawingBom — designModels', () => {
  it('emits one row per design model, qty 1, in input order', () => {
    const rows = deriveDrawingBom({
      kind: 'designModels',
      designModels: [model('a', 'Base Plate'), model('b', 'Cover')]
    })
    expect(rows).toEqual([
      { item: 1, qty: 1, partNumber: 'Base Plate', description: 'Base Plate' },
      { item: 2, qty: 1, partNumber: 'Cover', description: 'Cover' }
    ])
  })

  it('an empty design-model list yields no rows', () => {
    expect(deriveDrawingBom({ kind: 'designModels', designModels: [] })).toEqual([])
  })
})

// ── Single-part + empty ─────────────────────────────────────────────────────────

describe('deriveDrawingBom — singlePart / empty', () => {
  it('emits one stub row for a bare part name', () => {
    expect(deriveDrawingBom({ kind: 'singlePart', name: 'Sign Panel' })).toEqual([
      { item: 1, qty: 1, partNumber: 'Sign Panel', description: 'Sign Panel' }
    ])
  })

  it('uses an explicit partNumber when supplied', () => {
    const rows = deriveDrawingBom({ kind: 'singlePart', name: 'Sign Panel', partNumber: 'SP-001' })
    expect(rows[0]!.partNumber).toBe('SP-001')
    expect(rows[0]!.description).toBe('Sign Panel')
  })

  it('falls back to a sane default for a blank name', () => {
    expect(deriveDrawingBom({ kind: 'singlePart', name: '   ' })[0]).toMatchObject({
      description: 'Part'
    })
  })

  it('empty input yields no rows', () => {
    expect(deriveDrawingBom({ kind: 'empty' })).toEqual([])
  })
})

// ── Persistability ──────────────────────────────────────────────────────────────

describe('deriveDrawingBom — output is sheet-persistable', () => {
  it('every derived row validates against drawingBomRowSchema', () => {
    const a = asm([
      { id: 'i1', name: 'Bolt', geometrySource: { designModelId: 'b' }, bomQuantity: 4 },
      { id: 'i2', name: 'Nut', geometrySource: { designModelId: 'n' } }
    ])
    for (const r of deriveDrawingBom({ kind: 'assembly', assembly: a })) {
      expect(() => drawingBomRowSchema.parse(r)).not.toThrow()
    }
  })
})

// ── Renderer stamp adapter ──────────────────────────────────────────────────────

describe('toBomTableRows', () => {
  it('maps persisted rows into the stamp shape (string item + quantity)', () => {
    const rows = deriveDrawingBom({
      kind: 'designModels',
      designModels: [model('a', 'Base Plate')]
    })
    expect(toBomTableRows(rows)).toEqual([{ item: '1', partName: 'Base Plate', quantity: 1 }])
  })

  it('carries partNumber through only when it differs from the description', () => {
    const same = toBomTableRows([{ item: 1, qty: 1, partNumber: 'X', description: 'X' }])
    expect(same[0]).not.toHaveProperty('partNumber')
    const diff = toBomTableRows([{ item: 2, qty: 3, partNumber: 'PN-2', description: 'Widget' }])
    expect(diff[0]).toEqual({ item: '2', partName: 'Widget', quantity: 3, partNumber: 'PN-2' })
  })
})
