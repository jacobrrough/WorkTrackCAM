/**
 * viewport3d-geometry — FG-2 pure-builder pin.
 *
 * Guards the conversion from the sidecar's selection-grade tessellation
 * (`cad.tessellate_with_ids`) into the `THREE.BufferGeometry` that
 * `DesignWorkspace` hands to the now-mounted `Viewport3D`.
 */

import { describe, expect, it } from 'vitest'
import {
  buildFaceOcctIds,
  buildFaceSignatures,
  buildKernelPickGeometry,
  buildPickableEdges,
  buildViewportGeometry,
  readGeometryPickableEdges,
  sanitizeFaceIds,
} from './viewport3d-geometry'
import type { KernelPickFile } from '../../shared/kernel-pick-file'
import {
  readGeometryFaceIds,
  readGeometryFaceOcctIds,
  readGeometryFaceSignatures,
} from './Viewport3D'
import type {
  CadEdgePolyline,
  CadEdgeSignature,
  CadFaceSignature,
  CadTessellateWithIdsResult,
} from '../../shared/sidecar-protocol'

/** Build a minimal faceMap whose entries carry a stable `"f:<hex>"` occtId. */
function faceMapWithOcctIds(
  ids: Record<string, string>,
): CadTessellateWithIdsResult['faceMap'] {
  const out: CadTessellateWithIdsResult['faceMap'] = {}
  for (const [faceId, occtId] of Object.entries(ids)) {
    out[faceId] = { kind: 'face', occtHash: 0, occtId, area: 1 }
  }
  return out
}

function oneTriangle(
  over: Partial<CadTessellateWithIdsResult> = {},
): CadTessellateWithIdsResult {
  return {
    vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    indices: [0, 1, 2],
    faceIds: [0],
    triangleCount: 1,
    bbox: { min: [0, 0, 0], max: [10, 10, 0] },
    faceMap: {},
    edgeMap: {},
    edges: [],
    ...over,
  }
}

describe('sanitizeFaceIds', () => {
  it('returns a copy when every entry is a finite integer and length matches', () => {
    const out = sanitizeFaceIds([0, 1, 1, 2], 4)
    expect(out).toEqual([0, 1, 1, 2])
  })

  it('returns null when the length does not match the triangle count', () => {
    expect(sanitizeFaceIds([0, 1], 3)).toBeNull()
  })

  it('returns null on a non-array', () => {
    expect(sanitizeFaceIds(undefined, 1)).toBeNull()
    expect(sanitizeFaceIds(null, 1)).toBeNull()
  })

  it('returns null when any entry is non-finite or non-integer', () => {
    expect(sanitizeFaceIds([0, Number.NaN], 2)).toBeNull()
    expect(sanitizeFaceIds([0, 1.5], 2)).toBeNull()
    expect(sanitizeFaceIds([0, Infinity], 2)).toBeNull()
  })

  it('does not return the same array reference (defensive copy)', () => {
    const src = [0, 1]
    const out = sanitizeFaceIds(src, 2)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
  })
})

describe('buildViewportGeometry', () => {
  it('returns null for a null / undefined payload', () => {
    expect(buildViewportGeometry(null)).toBeNull()
    expect(buildViewportGeometry(undefined)).toBeNull()
  })

  it('returns null when vertices are empty or not divisible by 3', () => {
    expect(buildViewportGeometry(oneTriangle({ vertices: [] }))).toBeNull()
    expect(buildViewportGeometry(oneTriangle({ vertices: [0, 0, 0, 1, 1] }))).toBeNull()
  })

  it('returns null when indices are empty or not divisible by 3', () => {
    expect(buildViewportGeometry(oneTriangle({ indices: [] }))).toBeNull()
    expect(buildViewportGeometry(oneTriangle({ indices: [0, 1] }))).toBeNull()
  })

  it('builds an indexed geometry with a position attribute for a valid payload', () => {
    const g = buildViewportGeometry(oneTriangle())
    expect(g).not.toBeNull()
    const pos = g!.getAttribute('position')
    expect(pos).toBeDefined()
    expect(pos.count).toBe(3)
    expect(g!.index).not.toBeNull()
    expect(g!.index!.count).toBe(3)
  })

  it('computes vertex normals (shaded material lights correctly)', () => {
    const g = buildViewportGeometry(oneTriangle())
    expect(g!.getAttribute('normal')).toBeDefined()
  })

  it('stashes a well-formed faceIds array on userData (round-trips via readGeometryFaceIds)', () => {
    const g = buildViewportGeometry(
      oneTriangle({
        vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0],
        indices: [0, 1, 2, 1, 3, 2],
        faceIds: [0, 1],
        triangleCount: 2,
      }),
    )
    expect(g).not.toBeNull()
    expect(readGeometryFaceIds(g)).toEqual([0, 1])
  })

  it('omits faceIds when the array length does not match the triangle count', () => {
    const g = buildViewportGeometry(
      oneTriangle({
        indices: [0, 1, 2, 0, 1, 2],
        faceIds: [0],
        triangleCount: 2,
      }),
    )
    expect(g).not.toBeNull()
    expect(readGeometryFaceIds(g)).toBeNull()
  })

  it('omits faceIds when an entry is malformed', () => {
    const g = buildViewportGeometry(oneTriangle({ faceIds: [Number.NaN] }))
    expect(g).not.toBeNull()
    expect(readGeometryFaceIds(g)).toBeNull()
  })

  it('FG-5b: stashes parallel faceOcctIds when every face id has an occtId', () => {
    const g = buildViewportGeometry(
      oneTriangle({
        vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0],
        indices: [0, 1, 2, 1, 3, 2],
        faceIds: [0, 1],
        triangleCount: 2,
        faceMap: faceMapWithOcctIds({ '0': 'f:top', '1': 'f:side' }),
      }),
    )
    expect(readGeometryFaceIds(g)).toEqual([0, 1])
    expect(readGeometryFaceOcctIds(g)).toEqual(['f:top', 'f:side'])
  })

  it('FG-5b: omits faceOcctIds when the faceMap is empty (legacy / id-only)', () => {
    const g = buildViewportGeometry(oneTriangle()) // faceMap: {} by default
    expect(readGeometryFaceIds(g)).toEqual([0])
    expect(readGeometryFaceOcctIds(g)).toBeNull()
  })
})

describe('buildFaceOcctIds', () => {
  it('maps each triangle face id to its stable occtId', () => {
    const map = faceMapWithOcctIds({ '0': 'f:a', '1': 'f:b' })
    expect(buildFaceOcctIds([0, 1, 1, 0], map)).toEqual(['f:a', 'f:b', 'f:b', 'f:a'])
  })

  it('returns null (all-or-nothing) when a face id has no occtId entry', () => {
    const map = faceMapWithOcctIds({ '0': 'f:a' }) // face 1 missing
    expect(buildFaceOcctIds([0, 1], map)).toBeNull()
  })

  it('returns null when the faceMap is absent', () => {
    expect(buildFaceOcctIds([0], undefined)).toBeNull()
  })

  it('returns null when an entry occtId is empty', () => {
    const map = faceMapWithOcctIds({ '0': '' })
    expect(buildFaceOcctIds([0], map)).toBeNull()
  })
})

// ── FG-5: pickable edge polylines ──────────────────────────────────────────

/** A straight edge polyline (2 endpoints) with a stable id. */
function straightEdge(id: string): CadEdgePolyline {
  return { id, points: [[0, 0, 0], [10, 0, 0]] }
}

/** A representative Tier-2 edge signature (one box edge). */
const EDGE_SIG: CadEdgeSignature = {
  kind: 'line',
  lengthRank: 0,
  midpointOctant: 22,
  incidentFaceKinds: 'plane|plane',
}

describe('buildPickableEdges', () => {
  it('returns [] for null / undefined / empty input', () => {
    expect(buildPickableEdges(null)).toEqual([])
    expect(buildPickableEdges(undefined)).toEqual([])
    expect(buildPickableEdges([])).toEqual([])
  })

  it('builds one segment-endpoint buffer per polyline, carrying ordinal + stable id', () => {
    const out = buildPickableEdges([straightEdge('e:aaa'), straightEdge('e:bbb')])
    expect(out).toHaveLength(2)
    expect(out[0].edgeId).toBe(0)
    expect(out[0].occtId).toBe('e:aaa')
    expect(out[1].edgeId).toBe(1)
    expect(out[1].occtId).toBe('e:bbb')
    // A 2-point edge → 1 segment → 6 floats (two endpoints × 3).
    expect(Array.from(out[0].positions)).toEqual([0, 0, 0, 10, 0, 0])
  })

  it('emits (n-1) segments × 6 floats for a multi-point (curved) polyline', () => {
    const curved: CadEdgePolyline = {
      id: 'e:curve',
      points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]],
    }
    const out = buildPickableEdges([curved])
    // 3 points → 2 segments → 12 floats, tracing p0→p1, p1→p2.
    expect(out[0].positions.length).toBe(12)
    expect(Array.from(out[0].positions)).toEqual([0, 0, 0, 1, 1, 0, 1, 1, 0, 2, 0, 0])
  })

  it('drops polylines with < 2 points, a missing id, or a malformed point', () => {
    const out = buildPickableEdges([
      { id: 'e:ok', points: [[0, 0, 0], [1, 0, 0]] },
      { id: '', points: [[0, 0, 0], [1, 0, 0]] }, // empty id → drop
      { id: 'e:short', points: [[0, 0, 0]] }, // < 2 points → drop
      { id: 'e:nan', points: [[0, 0, 0], [Number.NaN, 0, 0]] }, // non-finite → drop
    ])
    expect(out).toHaveLength(1)
    expect(out[0].occtId).toBe('e:ok')
  })

  it('carries no signature when no edgeMap is supplied (Tier-1-only, back-compat)', () => {
    const out = buildPickableEdges([straightEdge('e:aaa')])
    expect(out).toHaveLength(1)
    expect(out[0].signature).toBeUndefined()
    // The no-stray-key contract: the entry must NOT carry a `signature` key at all.
    expect('signature' in out[0]).toBe(false)
  })

  it('Tier-2: attaches edgeMap[id].signature to the matching pickable edge', () => {
    const edgeMap: CadTessellateWithIdsResult['edgeMap'] = {
      'e:aaa': { kind: 'edge', occtId: 'e:aaa', occtHash: 0, length: 10, signature: EDGE_SIG },
      'e:bbb': { kind: 'edge', occtId: 'e:bbb', occtHash: 0, length: 5 }, // no signature
    }
    const out = buildPickableEdges([straightEdge('e:aaa'), straightEdge('e:bbb')], edgeMap)
    expect(out).toHaveLength(2)
    expect(out[0].occtId).toBe('e:aaa')
    expect(out[0].signature).toEqual(EDGE_SIG)
    // An entry whose map row carries no signature stays Tier-1-only (no stray key).
    expect(out[1].occtId).toBe('e:bbb')
    expect(out[1].signature).toBeUndefined()
    expect('signature' in out[1]).toBe(false)
  })

  it('Tier-2: a polyline with no matching edgeMap row carries no signature', () => {
    const edgeMap: CadTessellateWithIdsResult['edgeMap'] = {
      'e:other': { kind: 'edge', occtId: 'e:other', occtHash: 0, length: 1, signature: EDGE_SIG },
    }
    const out = buildPickableEdges([straightEdge('e:aaa')], edgeMap)
    expect(out[0].signature).toBeUndefined()
  })
})

describe('readGeometryPickableEdges', () => {
  it('round-trips the stash that buildViewportGeometry writes', () => {
    const g = buildViewportGeometry(
      oneTriangle({ edges: [straightEdge('e:one'), straightEdge('e:two')] }),
    )
    const edges = readGeometryPickableEdges(g)
    expect(edges).not.toBeNull()
    expect(edges).toHaveLength(2)
    expect(edges![0].occtId).toBe('e:one')
  })

  it('Tier-2: round-trips the edge signature through buildViewportGeometry (edgeMap → stash)', () => {
    const g = buildViewportGeometry(
      oneTriangle({
        edges: [straightEdge('e:one')],
        edgeMap: {
          'e:one': { kind: 'edge', occtId: 'e:one', occtHash: 0, length: 10, signature: EDGE_SIG },
        },
      }),
    )
    const edges = readGeometryPickableEdges(g)
    expect(edges).not.toBeNull()
    expect(edges![0]!.occtId).toBe('e:one')
    expect(edges![0]!.signature).toEqual(EDGE_SIG)
  })

  it('returns null when the geometry has no edge polylines (legacy / no edges)', () => {
    const g = buildViewportGeometry(oneTriangle()) // edges: [] by default
    expect(readGeometryPickableEdges(g)).toBeNull()
  })

  it('returns null for a null / undefined geometry', () => {
    expect(readGeometryPickableEdges(null)).toBeNull()
    expect(readGeometryPickableEdges(undefined)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// task_f76b39b3 — buildKernelPickGeometry: the no-code pick bridge. A geometry
// built from the persisted kernel pick file must (a) display in WORLD space
// (vertices moved by the placement basis) while (b) carrying the PRE-placement
// stable ids in userData — exactly what build_part's op resolver re-hashes.
// ─────────────────────────────────────────────────────────────────────────────

function kernelPickFixture(): KernelPickFile {
  return {
    tessellation: {
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
            [0, 5, 0],
          ],
        },
      ],
    },
    // The datum-XY basis build_part emits: (x, y, z) → (x, z, −y).
    placement: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], origin: [0, 0, 0] },
  }
}

describe('buildKernelPickGeometry — pickable no-code kernel mesh', () => {
  it('builds a world-space geometry carrying pre-placement pick userData', () => {
    const geometry = buildKernelPickGeometry(kernelPickFixture())
    expect(geometry).not.toBeNull()

    // (a) DISPLAY is world-space: vertex (0,5,0) → (0,0,−5) under datum XY.
    const pos = geometry!.getAttribute('position')
    expect(pos.count).toBe(3)
    expect([pos.getX(2), pos.getY(2), pos.getZ(2)]).toEqual([0, 0, -5])

    // (b) PICK ids are the untouched pre-placement stable handles.
    const ud = geometry!.userData as Record<string, unknown>
    expect(ud.faceIds).toEqual([0])
    expect(ud.faceOcctIds).toEqual(['f:abc'])
    const edges = readGeometryPickableEdges(geometry)
    expect(edges).not.toBeNull()
    expect(edges![0]!.occtId).toBe('e:001')
    // The edge polyline is ALSO world-space: (0,5,0) → (0,0,−5).
    expect(Array.from(edges![0]!.positions.slice(3, 6))).toEqual([0, 0, -5])
  })

  it('identity placement (null) leaves coordinates canonical', () => {
    const pick = { ...kernelPickFixture(), placement: null }
    const geometry = buildKernelPickGeometry(pick)
    const pos = geometry!.getAttribute('position')
    expect([pos.getX(2), pos.getY(2), pos.getZ(2)]).toEqual([0, 5, 0])
  })

  it('returns null for a null pick file (caller falls back to the untagged STL)', () => {
    expect(buildKernelPickGeometry(null)).toBeNull()
    expect(buildKernelPickGeometry(undefined)).toBeNull()
  })
})

// ── Tier-2 · per-triangle face-signature stash ───────────────────────────────

const SIG_A: CadFaceSignature = {
  kind: 'plane',
  adjacentFaceCount: 4,
  normalClass: '+0,+0,+1',
  areaRank: 0,
  centroidOctant: 7,
}
const SIG_B: CadFaceSignature = {
  kind: 'cylinder',
  adjacentFaceCount: 2,
  normalClass: '+1,+0,+0',
  areaRank: 1,
  centroidOctant: 0,
}

describe('buildFaceSignatures', () => {
  it('maps each triangle to its face signature via faceMap[faceId].signature', () => {
    const faceMap: CadTessellateWithIdsResult['faceMap'] = {
      '0': { kind: 'face', occtHash: 0, occtId: 'f:0', area: 1, signature: SIG_A },
      '1': { kind: 'face', occtHash: 0, occtId: 'f:1', area: 1, signature: SIG_B },
    }
    expect(buildFaceSignatures([0, 1, 0], faceMap)).toEqual([SIG_A, SIG_B, SIG_A])
  })

  it('is NOT all-or-nothing: a face without a signature yields undefined for its triangles', () => {
    const faceMap: CadTessellateWithIdsResult['faceMap'] = {
      '0': { kind: 'face', occtHash: 0, occtId: 'f:0', area: 1, signature: SIG_A },
      '1': { kind: 'face', occtHash: 0, occtId: 'f:1', area: 1 }, // no signature
    }
    expect(buildFaceSignatures([0, 1], faceMap)).toEqual([SIG_A, undefined])
  })

  it('returns null (no stash) when NO face carries a signature (back-compat tessellation)', () => {
    const faceMap: CadTessellateWithIdsResult['faceMap'] = {
      '0': { kind: 'face', occtHash: 0, occtId: 'f:0', area: 1 },
    }
    expect(buildFaceSignatures([0], faceMap)).toBeNull()
    expect(buildFaceSignatures([0], undefined)).toBeNull()
  })
})

describe('buildViewportGeometry — faceSignatures stash + Viewport3D reader', () => {
  it('stashes faceSignatures (parallel to faceOcctIds) and the reader reads it back', () => {
    const tess = oneTriangle({
      faceMap: { '0': { kind: 'face', occtHash: 0, occtId: 'f:0', area: 1, signature: SIG_A } },
    })
    const geometry = buildViewportGeometry(tess)
    expect(geometry).not.toBeNull()
    // The occtId stash must be present (the signature stash rides alongside it).
    expect(readGeometryFaceOcctIds(geometry)).toEqual(['f:0'])
    expect(readGeometryFaceSignatures(geometry)).toEqual([SIG_A])
  })

  it('does NOT stash faceSignatures when the faceMap carries none (reader → null)', () => {
    const tess = oneTriangle({
      faceMap: { '0': { kind: 'face', occtHash: 0, occtId: 'f:0', area: 1 } },
    })
    const geometry = buildViewportGeometry(tess)
    expect(readGeometryFaceOcctIds(geometry)).toEqual(['f:0'])
    expect(readGeometryFaceSignatures(geometry)).toBeNull()
  })

  it('reader returns null for a geometry with no userData stash', () => {
    expect(readGeometryFaceSignatures(null)).toBeNull()
    const bare = buildViewportGeometry(oneTriangle())
    expect(readGeometryFaceSignatures(bare)).toBeNull()
  })
})
