/**
 * kernel-pick-file — the cross-path picked-edge/face bridge (task_f76b39b3).
 *
 * Pins the two pure halves the no-code viewport-picking loop rides on:
 *   1. `coerceKernelPickFile` — structural gate for `output/kernel-part.pick.json`
 *      (reject anything that can't safely drive the viewport; a PRESENT-but-
 *      malformed placement rejects the whole file so the mesh is never shown in
 *      the wrong space).
 *   2. `applyPickPlacementToTessellation` — the canonical→world display
 *      transform `world = u·x + v·y + n·z + origin`. For the datum-XY basis
 *      build_part.py emits (u=(1,0,0), v=(0,0,−1), n=(0,1,0)) this maps
 *      (x, y, z) → (x, z, −y) — the SAME fingerprint pinned by the
 *      placement-parity test on the Python side. Stable ids stay untouched
 *      (they are pre-placement, what the build resolver hashes).
 */
import { describe, expect, it } from 'vitest'
import {
  applyPickPlacementToTessellation,
  coerceKernelPickFile,
  type KernelPickFile,
  type KernelPickPlacement
} from './kernel-pick-file'
import type { CadTessellateWithIdsResult } from './sidecar-protocol'

/** The exact datum-XY basis `build_part._placement_basis` emits. */
const DATUM_XY: KernelPickPlacement = {
  u: [1, 0, 0],
  v: [0, 0, -1],
  n: [0, 1, 0],
  origin: [0, 0, 0]
}

function minimalTess(): CadTessellateWithIdsResult {
  return {
    vertices: [0, 0, 0, 10, 0, 0, 0, 5, 0],
    indices: [0, 1, 2],
    faceIds: [0],
    triangleCount: 1,
    bbox: { min: [0, 0, 0], max: [10, 5, 0] },
    faceMap: { '0': { kind: 'face', occtHash: 0, occtId: 'f:abc', area: 25 } },
    edgeMap: { 'e:001': { kind: 'edge', occtId: 'e:001', occtHash: 0, length: 10 } },
    edges: [
      {
        id: 'e:001',
        points: [
          [0, 0, 0],
          [10, 0, 0]
        ]
      }
    ]
  }
}

function minimalRawFile(): Record<string, unknown> {
  return { tessellation: minimalTess(), placement: DATUM_XY }
}

describe('coerceKernelPickFile — structural gate', () => {
  it('accepts a minimal valid file (tessellation + placement)', () => {
    const pick = coerceKernelPickFile(minimalRawFile())
    expect(pick).not.toBeNull()
    expect(pick!.tessellation.triangleCount).toBe(1)
    expect(pick!.tessellation.edges).toHaveLength(1)
    expect(pick!.placement).toEqual(DATUM_XY)
  })

  it('accepts a null/absent placement (identity — canonical == world)', () => {
    const pick = coerceKernelPickFile({ tessellation: minimalTess() })
    expect(pick).not.toBeNull()
    expect(pick!.placement).toBeNull()
  })

  it('REJECTS the whole file when a placement is present but malformed', () => {
    // Displaying the mesh in the wrong space would be worse than the
    // untagged-STL fallback — the placement gate is all-or-nothing.
    expect(
      coerceKernelPickFile({ tessellation: minimalTess(), placement: { u: [1, 0], v: 'x' } })
    ).toBeNull()
    expect(
      coerceKernelPickFile({
        tessellation: minimalTess(),
        placement: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], origin: [0, 0, Number.NaN] }
      })
    ).toBeNull()
  })

  it('rejects garbage roots and unusable triangle data', () => {
    expect(coerceKernelPickFile(null)).toBeNull()
    expect(coerceKernelPickFile('nope')).toBeNull()
    expect(coerceKernelPickFile({})).toBeNull()
    expect(coerceKernelPickFile({ tessellation: { vertices: [1, 2], indices: [0, 1, 2] } })).toBeNull()
    expect(
      coerceKernelPickFile({ tessellation: { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1] } })
    ).toBeNull()
  })

  it('drops malformed edge polylines but keeps the rest', () => {
    const raw = minimalRawFile()
    ;(raw.tessellation as Record<string, unknown>).edges = [
      { id: 'e:ok', points: [[0, 0, 0], [1, 1, 1]] },
      { id: '', points: [[0, 0, 0], [1, 1, 1]] }, // empty id → dropped
      { id: 'e:short', points: [[0, 0, 0]] }, // <2 points → dropped
      { id: 'e:bad', points: [[0, 0, 'x']] } // non-finite → dropped
    ]
    const pick = coerceKernelPickFile(raw)
    expect(pick).not.toBeNull()
    expect(pick!.tessellation.edges.map((e) => e.id)).toEqual(['e:ok'])
  })

  it('mismatched faceIds length degrades to empty (face-pick off, file still usable)', () => {
    const raw = minimalRawFile()
    ;(raw.tessellation as Record<string, unknown>).faceIds = [0, 1, 2] // 3 ids for 1 triangle
    const pick = coerceKernelPickFile(raw)
    expect(pick).not.toBeNull()
    expect(pick!.tessellation.faceIds).toEqual([])
  })
})

describe('applyPickPlacementToTessellation — canonical→world display transform', () => {
  it('datum-XY basis maps (x, y, z) → (x, z, −y) on vertices AND edge polylines', () => {
    const out = applyPickPlacementToTessellation(minimalTess(), DATUM_XY)
    // (0,0,0)→(0,0,0); (10,0,0)→(10,0,0); (0,5,0)→(0,0,−5)
    expect(out.vertices).toEqual([0, 0, 0, 10, 0, 0, 0, 0, -5])
    expect(out.edges[0]!.points).toEqual([
      [0, 0, 0],
      [10, 0, 0]
    ])
    // Stable ids untouched — they live in the PRE-placement hash space.
    expect(out.edges[0]!.id).toBe('e:001')
    expect(Object.keys(out.edgeMap)).toEqual(['e:001'])
    expect(out.faceMap['0']!.occtId).toBe('f:abc')
  })

  it('recomputes the bbox as the AABB of the transformed corners', () => {
    const out = applyPickPlacementToTessellation(minimalTess(), DATUM_XY)
    // canonical min(0,0,0)/max(10,5,0) → world x[0,10], y(=z)[0,0], z(=−y)[−5,0]
    expect(out.bbox.min).toEqual([0, 0, -5])
    expect(out.bbox.max).toEqual([10, 0, 0])
  })

  it('identity passthrough (same reference) when placement is null', () => {
    const tess = minimalTess()
    expect(applyPickPlacementToTessellation(tess, null)).toBe(tess)
  })

  it('applies a translation origin', () => {
    const placed: KernelPickPlacement = { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], origin: [100, -2, 7] }
    const out = applyPickPlacementToTessellation(minimalTess(), placed)
    expect(out.vertices.slice(0, 3)).toEqual([100, -2, 7])
    expect(out.vertices.slice(3, 6)).toEqual([110, -2, 7])
  })
})

describe('KernelPickFile round-trip (what build-kernel-part.ts persists)', () => {
  it('JSON round-trips through coerce unchanged', () => {
    const pick: KernelPickFile = { tessellation: minimalTess(), placement: DATUM_XY }
    const back = coerceKernelPickFile(JSON.parse(JSON.stringify(pick)) as unknown)
    expect(back).toEqual(pick)
  })
})
