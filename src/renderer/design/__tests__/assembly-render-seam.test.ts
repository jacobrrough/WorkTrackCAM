/**
 * assembly-render-seam — pure unit tests for the renderer adapter over the
 * shared interference + BOM cores. No React, no DOM, no IPC — plain
 * `AssemblyPart` objects exercise each branch (mirrors `assembly-mate-form.test.ts`).
 *
 * The math itself (AABB overlap, source-keyed roll-up) is exhaustively pinned in
 * the engine's `assembly-interference.test.ts` / `assembly-bom.test.ts`; this
 * file pins the ADAPTER contract: that renderer part rows map onto the engine
 * cores correctly (placement → world clash; geometrySource → BOM source).
 */

import { describe, expect, it } from 'vitest'
import {
  NOMINAL_HALF_EXTENT_MM,
  bomForParts,
  bomRowSourceLabel,
  clashingPartIds,
  interferencesForParts,
} from '../assembly-render-seam'
import type { AssemblyPart } from '../AssemblyView'

const part = (over: Partial<AssemblyPart> & { id: string; name: string }): AssemblyPart => ({
  handle: `script:${over.id}`,
  ...over,
})

// ── Interference adapter ─────────────────────────────────────────────────────

describe('interferencesForParts', () => {
  it('reports no clash for parts spaced beyond the nominal box', () => {
    // Two parts 3× the box apart on x cannot overlap their nominal AABBs.
    const far = 3 * NOMINAL_HALF_EXTENT_MM
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] } }),
      part({ id: 'b', name: 'B', transform: { position: [far * 2, 0, 0] } }),
    ]
    const report = interferencesForParts(parts)
    expect(report.fidelity).toBe('bbox')
    expect(report.clashingPairs).toHaveLength(0)
    expect(report.evaluatedCount).toBe(2)
  })

  it('reports a clash for two parts at the same placement (the dominant mistake)', () => {
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] } }),
      part({ id: 'b', name: 'B', transform: { position: [0, 0, 0] } }),
    ]
    const report = interferencesForParts(parts)
    expect(report.clashingPairs).toHaveLength(1)
    expect(report.clashingPairs[0]).toEqual({ aId: 'a', bId: 'b' })
  })

  it('reports a clash for parts that partially overlap within the nominal box', () => {
    // Centres NOMINAL_HALF_EXTENT_MM apart → the [-h,h] boxes overlap by h on x.
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] } }),
      part({ id: 'b', name: 'B', transform: { position: [NOMINAL_HALF_EXTENT_MM, 0, 0] } }),
    ]
    expect(interferencesForParts(parts).clashingPairs).toHaveLength(1)
  })

  it('treats a missing transform as the origin (identity placement)', () => {
    const parts = [
      part({ id: 'a', name: 'A' }), // no transform → origin
      part({ id: 'b', name: 'B', transform: { position: [0, 0, 0] } }),
    ]
    expect(interferencesForParts(parts).clashingPairs).toHaveLength(1)
  })

  it('returns an empty report for fewer than two parts', () => {
    expect(interferencesForParts([]).clashingPairs).toHaveLength(0)
    expect(interferencesForParts([part({ id: 'solo', name: 'Solo' })]).clashingPairs).toHaveLength(0)
  })
})

describe('clashingPartIds', () => {
  it('collects both ids from every clashing pair', () => {
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] } }),
      part({ id: 'b', name: 'B', transform: { position: [0, 0, 0] } }),
      part({ id: 'c', name: 'C', transform: { position: [500, 0, 0] } }),
    ]
    const ids = clashingPartIds(interferencesForParts(parts))
    expect(ids.has('a')).toBe(true)
    expect(ids.has('b')).toBe(true)
    // c is far away — not in any clash.
    expect(ids.has('c')).toBe(false)
  })

  it('is empty when there are no clashes', () => {
    const ids = clashingPartIds(interferencesForParts([part({ id: 'a', name: 'A' })]))
    expect(ids.size).toBe(0)
  })
})

// ── BOM adapter ──────────────────────────────────────────────────────────────

describe('bomForParts', () => {
  it('produces one line per distinct source, summing quantities for duplicates', () => {
    // Two instances of the same body (same geometrySource) collapse to qty 2.
    const parts = [
      part({ id: 'i1', name: 'Bolt', geometrySource: 'design/bolt.step' }),
      part({ id: 'i2', name: 'Bolt', geometrySource: 'design/bolt.step' }),
      part({ id: 'i3', name: 'Plate', geometrySource: 'design/plate.step' }),
    ]
    const result = bomForParts(parts)
    expect(result.lineCount).toBe(2)
    const boltRow = result.rows.find((r) => r.name === 'Bolt')
    expect(boltRow?.qty).toBe(2)
    expect(boltRow?.instanceIds).toEqual(['i1', 'i2'])
    const plateRow = result.rows.find((r) => r.name === 'Plate')
    expect(plateRow?.qty).toBe(1)
    expect(result.totalQuantity).toBe(3)
  })

  it('keeps distinct lines for parts with different sources (even same name)', () => {
    const parts = [
      part({ id: 'i1', name: 'Spacer', geometrySource: 'a.step' }),
      part({ id: 'i2', name: 'Spacer', geometrySource: 'b.step' }),
    ]
    expect(bomForParts(parts).lineCount).toBe(2)
  })

  it('falls back to the synthesized partPath source for a row with no geometrySource', () => {
    // A hydrated/blank-handle row with no source still becomes a BOM line (keyed
    // on its partPath), never silently dropped.
    const parts = [part({ id: 'only', name: 'Mystery', handle: '' })]
    const result = bomForParts(parts)
    expect(result.lineCount).toBe(1)
    expect(result.rows[0]!.name).toBe('Mystery')
    expect(result.rows[0]!.qty).toBe(1)
  })

  it('returns an empty roll-up for no parts', () => {
    const result = bomForParts([])
    expect(result.lineCount).toBe(0)
    expect(result.rows).toHaveLength(0)
    expect(result.totalQuantity).toBe(0)
  })
})

describe('bomRowSourceLabel', () => {
  it('renders "kind: ref" for a row', () => {
    const [row] = bomForParts([part({ id: 'i1', name: 'X', geometrySource: 'design/x.step' })]).rows
    const label = bomRowSourceLabel(row!)
    // geometrySource maps onto the engine's handle ref kind via partToView.
    expect(label).toMatch(/^(handle|relPath|partPath|designModel): /)
    expect(label).toContain('design/x.step')
  })

  it('tail-truncates a very long ref', () => {
    const longRef = 'design/' + 'a'.repeat(80) + '.step'
    const [row] = bomForParts([part({ id: 'i1', name: 'X', geometrySource: longRef })]).rows
    const label = bomRowSourceLabel(row!)
    expect(label).toContain('…')
    expect(label.length).toBeLessThan(longRef.length + 12)
  })
})
