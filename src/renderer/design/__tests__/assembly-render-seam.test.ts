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
import * as THREE from 'three'
import {
  NOMINAL_HALF_EXTENT_MM,
  bomForParts,
  bomRowSourceLabel,
  clashingPartIds,
  interferencesForParts,
  localAabbFromGeometry,
} from '../assembly-render-seam'
import type { AssemblyPart } from '../AssemblyView'
import type { AssemblyPartGeometryDimensions } from '../../../shared/assembly-part'

const part = (over: Partial<AssemblyPart> & { id: string; name: string }): AssemblyPart => ({
  handle: `script:${over.id}`,
  ...over,
})

/** A thin bar's tight local AABB: 20 mm long on X, 2 mm on Y/Z. */
const BAR_DIMS: AssemblyPartGeometryDimensions = {
  aabbMin: [-10, -1, -1],
  aabbMax: [10, 1, 1],
}

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

// ── Local-AABB hydration from live geometry ──────────────────────────────────

describe('localAabbFromGeometry', () => {
  it('computes the local-frame AABB from a BufferGeometry (matches its bounding box)', () => {
    // A 2×4×6 box is centred at the origin → min [-1,-2,-3], max [1,2,3].
    const geom = new THREE.BoxGeometry(2, 4, 6)
    const dims = localAabbFromGeometry(geom)
    expect(dims).not.toBeNull()
    expect(dims!.aabbMin).toEqual([-1, -2, -3])
    expect(dims!.aabbMax).toEqual([1, 2, 3])
  })

  it('reuses an already-computed boundingBox without recomputing', () => {
    const geom = new THREE.BoxGeometry(2, 2, 2)
    geom.computeBoundingBox()
    // Tamper with the cached box to prove the helper reads it rather than recomputing.
    geom.boundingBox!.max.set(5, 5, 5)
    const dims = localAabbFromGeometry(geom)
    expect(dims!.aabbMax).toEqual([5, 5, 5])
  })

  it('returns null for a null / empty geometry (degrades to the nominal box)', () => {
    expect(localAabbFromGeometry(null)).toBeNull()
    expect(localAabbFromGeometry(undefined)).toBeNull()
    // An empty geometry has no position attribute → an empty (non-finite) box.
    expect(localAabbFromGeometry(new THREE.BufferGeometry())).toBeNull()
  })
})

// ── Narrow-phase activation (OBB) through the invocation seam ─────────────────

describe('interferencesForParts — narrow phase (geometryDimensions)', () => {
  it('populates the interference box from a part.geometryDimensions and flips fidelity to bbox+narrow', () => {
    // Two coincident bars → a true clash; dims on both parts activate the OBB pass.
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] }, geometryDimensions: BAR_DIMS }),
      part({ id: 'b', name: 'B', transform: { position: [0, 0, 0] }, geometryDimensions: BAR_DIMS }),
    ]
    const report = interferencesForParts(parts)
    expect(report.fidelity).toBe('bbox+narrow')
    expect(report.clashingPairs).toHaveLength(1)
  })

  it('clears a rotation-induced bbox false positive end-to-end (two parallel bars offset perpendicular)', () => {
    // Both bars rotated +45° about Z; B shifted perpendicular to the bar axis by
    // 3 mm. Their axis-aligned world hulls overlap (broad phase flags the pair),
    // but the true ORIENTED boxes do not touch — the OBB narrow phase clears it.
    const d = 3
    const px = -d / Math.SQRT2
    const py = d / Math.SQRT2
    const parts = [
      part({
        id: 'a',
        name: 'A',
        transform: { position: [0, 0, 0], rotation: [0, 0, 45] },
        geometryDimensions: BAR_DIMS,
      }),
      part({
        id: 'b',
        name: 'B',
        transform: { position: [px, py, 0], rotation: [0, 0, 45] },
        geometryDimensions: BAR_DIMS,
      }),
    ]

    // Sanity: with NO dims (nominal cubes) the SAME placements clash — proving the
    // pair truly reaches the broad phase, so the clear below is a real refinement.
    const nominal = interferencesForParts([
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0], rotation: [0, 0, 45] } }),
      part({ id: 'b', name: 'B', transform: { position: [px, py, 0], rotation: [0, 0, 45] } }),
    ])
    expect(nominal.fidelity).toBe('bbox')
    expect(nominal.clashingPairs).toHaveLength(1)

    const report = interferencesForParts(parts)
    expect(report.fidelity).toBe('bbox+narrow')
    expect(report.clashingPairs).toHaveLength(0)
    expect(report.narrowPhaseClearedPairs).toEqual([{ aId: 'a', bId: 'b' }])
    expect(clashingPartIds(report).size).toBe(0)
  })

  it('falls back to bbox behavior when parts carry no geometry (empty map → fidelity bbox)', () => {
    // No dims on either part → the narrow-phase map is empty → byte-identical to
    // the conservative broad-phase path (no regression, no crash).
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] } }),
      part({ id: 'b', name: 'B', transform: { position: [0, 0, 0] } }),
    ]
    const report = interferencesForParts(parts)
    expect(report.fidelity).toBe('bbox')
    expect(report.clashingPairs).toHaveLength(1)
    expect(report.narrowPhaseClearedPairs).toBeUndefined()
  })

  it('keeps a pair conservatively (indeterminate) when only ONE part has dims', () => {
    // Mixed hydration: A has real dims, B does not. The narrow phase cannot decide
    // (B has no geometry) so the pair is KEPT — never silently dropped.
    const parts = [
      part({ id: 'a', name: 'A', transform: { position: [0, 0, 0] }, geometryDimensions: BAR_DIMS }),
      part({ id: 'b', name: 'B', transform: { position: [0, 0, 0] } }),
    ]
    const report = interferencesForParts(parts)
    expect(report.fidelity).toBe('bbox+narrow')
    expect(report.clashingPairs).toHaveLength(1)
    expect(report.indeterminatePairs).toEqual([{ aId: 'a', bId: 'b' }])
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
