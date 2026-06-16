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
  buildPickIndex,
  coerceKernelPickFile,
  edgeSignaturesEqual,
  faceSignaturesEqual,
  pickLostMessage,
  resolvePickedId,
  resolvePickedIdAgainstTessellation,
  type KernelPickFile,
  type KernelPickPlacement,
  type StoredPick
} from './kernel-pick-file'
import type {
  CadEdgeSignature,
  CadFaceSignature,
  CadTessellateWithIdsResult
} from './sidecar-protocol'

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

// ── Tier-2 tiered picked-id resolver ────────────────────────────────────────
//
// The HARD topological-naming case (bounded): a persisted pick (an edge/face id
// + its geometry-invariant signature) must still resolve after an upstream
// parametric MOVE / UNIFORM RESIZE — where the absolute-hash id changes. Tier 1
// (exact id) → Tier 2 (unique signature) → honest loss. We simulate a move/resize
// by giving the "current" build DIFFERENT ids (hashes changed) but the SAME
// signatures (rank/class/octant are move/scale invariant).

const FACE_SIG: CadFaceSignature = {
  kind: 'plane',
  adjacentFaceCount: 4,
  normalClass: '+0,+0,+1',
  areaRank: 0,
  centroidOctant: 7
}

const EDGE_SIG: CadEdgeSignature = {
  kind: 'line',
  lengthRank: 0,
  midpointOctant: 3,
  incidentFaceKinds: 'plane|plane'
}

/** A tessellation whose faceMap/edgeMap carry stable ids + optional signatures. */
function tessWith(
  faces: Array<{ occtId: string; signature?: CadFaceSignature }>,
  edges: Array<{ occtId: string; signature?: CadEdgeSignature }>
): CadTessellateWithIdsResult {
  const faceMap: CadTessellateWithIdsResult['faceMap'] = {}
  faces.forEach((f, i) => {
    faceMap[String(i)] = { kind: 'face', occtHash: 0, occtId: f.occtId, area: 1, signature: f.signature }
  })
  const edgeMap: CadTessellateWithIdsResult['edgeMap'] = {}
  for (const e of edges) {
    edgeMap[e.occtId] = { kind: 'edge', occtId: e.occtId, occtHash: 0, length: 1, signature: e.signature }
  }
  return {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    faceIds: [0],
    triangleCount: 1,
    bbox: { min: [0, 0, 0], max: [1, 1, 0] },
    faceMap,
    edgeMap,
    edges: []
  }
}

describe('buildPickIndex — current-build entity index', () => {
  it('keys faces by occtId and edges by their stable id, carrying signatures', () => {
    const idx = buildPickIndex(
      tessWith(
        [{ occtId: 'f:1', signature: FACE_SIG }, { occtId: 'f:2' }],
        [{ occtId: 'e:1', signature: EDGE_SIG }]
      )
    )
    expect([...idx.faces.keys()].sort()).toEqual(['f:1', 'f:2'])
    expect(idx.faces.get('f:1')).toEqual(FACE_SIG)
    expect(idx.faces.get('f:2')).toBeUndefined() // present (Tier-1 hits) but no signature
    expect(idx.edges.get('e:1')).toEqual(EDGE_SIG)
  })

  it('skips faces with no stable occtId (failed-tessellation faces)', () => {
    const tess = tessWith([{ occtId: 'f:1' }], [])
    // Corrupt one entry to have no occtId (mimics a face that failed mid-tess).
    ;(tess.faceMap as Record<string, unknown>)['9'] = { kind: 'face', occtHash: 0, area: 0 }
    const idx = buildPickIndex(tess)
    expect([...idx.faces.keys()]).toEqual(['f:1'])
  })

  it('returns an empty index for a null / malformed tessellation', () => {
    expect(buildPickIndex(null).faces.size).toBe(0)
    expect(buildPickIndex(undefined).edges.size).toBe(0)
  })

  it('reads signatures straight off a coerced kernel pick file (build_part pickTessellation path)', () => {
    // A KernelPickFile from build_part's pickTessellation carries signatures
    // inside faceMap/edgeMap entries; coerceKernelPickFile passes them through, so
    // buildPickIndex sees them — proving the cross-path (build_part → renderer)
    // Tier-2 wiring, and that a pre-Tier-2 file (no signatures) still parses.
    const raw = {
      tessellation: tessWith([{ occtId: 'f:1', signature: FACE_SIG }], [{ occtId: 'e:1', signature: EDGE_SIG }]),
      placement: null
    }
    const pick = coerceKernelPickFile(raw)
    expect(pick).not.toBeNull()
    const idx = buildPickIndex(pick!.tessellation)
    expect(idx.faces.get('f:1')).toEqual(FACE_SIG)
    expect(idx.edges.get('e:1')).toEqual(EDGE_SIG)
  })
})

describe('resolvePickedId — TIER 1 (exact id)', () => {
  it('resolves to the stored id when present in the current build (face)', () => {
    const idx = buildPickIndex(tessWith([{ occtId: 'f:1' }, { occtId: 'f:2' }], []))
    const res = resolvePickedId({ kind: 'face', id: 'f:2' }, idx)
    expect(res).toEqual({ ok: true, tier: 1, id: 'f:2' })
  })

  it('resolves to the stored id for an edge', () => {
    const idx = buildPickIndex(tessWith([], [{ occtId: 'e:7' }]))
    expect(resolvePickedId({ kind: 'edge', id: 'e:7' }, idx)).toEqual({ ok: true, tier: 1, id: 'e:7' })
  })

  it('Tier 1 hits even when the entity has no signature (id presence is enough)', () => {
    const idx = buildPickIndex(tessWith([{ occtId: 'f:bare' }], []))
    const res = resolvePickedId({ kind: 'face', id: 'f:bare', signature: FACE_SIG }, idx)
    expect(res).toEqual({ ok: true, tier: 1, id: 'f:bare' })
  })
})

describe('resolvePickedId — TIER 2 (signature recovery after move/resize)', () => {
  it('recovers a face whose id CHANGED but signature is unchanged → returns the CURRENT id', () => {
    // Simulate a move/resize: the build now has id "f:moved" (hash changed) with
    // the SAME signature the stored pick carries. Tier 1 misses "f:old"; Tier 2
    // recovers the unique signature match and returns the build's current id.
    const idx = buildPickIndex(tessWith([{ occtId: 'f:moved', signature: FACE_SIG }], []))
    const res = resolvePickedId({ kind: 'face', id: 'f:old', signature: FACE_SIG }, idx)
    expect(res).toEqual({ ok: true, tier: 2, id: 'f:moved' })
  })

  it('recovers an edge by signature after its id changed', () => {
    const idx = buildPickIndex(tessWith([], [{ occtId: 'e:new', signature: EDGE_SIG }]))
    const res = resolvePickedId({ kind: 'edge', id: 'e:gone', signature: EDGE_SIG }, idx)
    expect(res).toEqual({ ok: true, tier: 2, id: 'e:new' })
  })

  it('picks the UNIQUE signature match when other faces differ', () => {
    const other: CadFaceSignature = { ...FACE_SIG, areaRank: 1, centroidOctant: 0 }
    const idx = buildPickIndex(
      tessWith([{ occtId: 'f:a', signature: other }, { occtId: 'f:b', signature: FACE_SIG }], [])
    )
    const res = resolvePickedId({ kind: 'face', id: 'f:old', signature: FACE_SIG }, idx)
    expect(res).toEqual({ ok: true, tier: 2, id: 'f:b' })
  })
})

describe('resolvePickedId — TIER 3 (honest loss, never guess)', () => {
  it('AMBIGUOUS: two current faces share the signature → lost, no guess', () => {
    const idx = buildPickIndex(
      tessWith([{ occtId: 'f:a', signature: FACE_SIG }, { occtId: 'f:b', signature: FACE_SIG }], [])
    )
    const res = resolvePickedId({ kind: 'face', id: 'f:old', signature: FACE_SIG }, idx)
    expect(res).toEqual({ ok: false, reason: 'ambiguous-signature' })
  })

  it('NO MATCH: the signature matches nothing in the current build', () => {
    const idx = buildPickIndex(tessWith([{ occtId: 'f:a', signature: FACE_SIG }], []))
    const wanted: CadFaceSignature = { ...FACE_SIG, kind: 'cylinder' }
    const res = resolvePickedId({ kind: 'face', id: 'f:old', signature: wanted }, idx)
    expect(res).toEqual({ ok: false, reason: 'no-signature-match' })
  })

  it('BACK-COMPAT: Tier 1 misses and the stored pick carries NO signature', () => {
    const idx = buildPickIndex(tessWith([{ occtId: 'f:a', signature: FACE_SIG }], []))
    const res = resolvePickedId({ kind: 'face', id: 'f:old' }, idx)
    expect(res).toEqual({ ok: false, reason: 'no-tier1-no-signature' })
  })

  it('NO CURRENT GEOMETRY: an empty index reports the geometry reason', () => {
    const idx = buildPickIndex(null)
    const res = resolvePickedId({ kind: 'face', id: 'f:any', signature: FACE_SIG }, idx)
    expect(res).toEqual({ ok: false, reason: 'no-current-geometry' })
  })

  it('a current entity whose signature is UNDEFINED cannot satisfy a Tier-2 match', () => {
    // The id changed (Tier 1 misses) and the only candidate carries no signature
    // → Tier 2 can't compare → honest no-match (never a blind id swap).
    const idx = buildPickIndex(tessWith([{ occtId: 'f:moved' }], []))
    const res = resolvePickedId({ kind: 'face', id: 'f:old', signature: FACE_SIG }, idx)
    expect(res).toEqual({ ok: false, reason: 'no-signature-match' })
  })
})

describe('resolvePickedId — kind isolation', () => {
  it('a face pick never resolves against the edge pool (and vice versa)', () => {
    const idx = buildPickIndex(
      tessWith([{ occtId: 'f:1', signature: FACE_SIG }], [{ occtId: 'e:1', signature: EDGE_SIG }])
    )
    // A face whose id == an edge id must NOT Tier-1 hit the edge pool.
    expect(resolvePickedId({ kind: 'face', id: 'e:1' }, idx)).toEqual({
      ok: false,
      reason: 'no-tier1-no-signature'
    })
  })
})

describe('resolvePickedIdAgainstTessellation — one-shot convenience', () => {
  it('builds the index internally and resolves Tier 1', () => {
    const tess = tessWith([{ occtId: 'f:1' }], [])
    expect(resolvePickedIdAgainstTessellation({ kind: 'face', id: 'f:1' }, tess)).toEqual({
      ok: true,
      tier: 1,
      id: 'f:1'
    })
  })

  it('reports no-current-geometry on a null tessellation', () => {
    const stored: StoredPick = { kind: 'edge', id: 'e:1', signature: EDGE_SIG }
    expect(resolvePickedIdAgainstTessellation(stored, null)).toEqual({
      ok: false,
      reason: 'no-current-geometry'
    })
  })
})

describe('signature equality helpers', () => {
  it('faceSignaturesEqual is strict on every field', () => {
    expect(faceSignaturesEqual(FACE_SIG, { ...FACE_SIG })).toBe(true)
    expect(faceSignaturesEqual(FACE_SIG, { ...FACE_SIG, areaRank: 1 })).toBe(false)
    expect(faceSignaturesEqual(FACE_SIG, { ...FACE_SIG, normalClass: '+0,+0,-1' })).toBe(false)
    expect(faceSignaturesEqual(FACE_SIG, { ...FACE_SIG, adjacentFaceCount: 5 })).toBe(false)
    expect(faceSignaturesEqual(FACE_SIG, { ...FACE_SIG, centroidOctant: 0 })).toBe(false)
    expect(faceSignaturesEqual(FACE_SIG, { ...FACE_SIG, kind: 'cone' })).toBe(false)
  })

  it('edgeSignaturesEqual is strict on every field', () => {
    expect(edgeSignaturesEqual(EDGE_SIG, { ...EDGE_SIG })).toBe(true)
    expect(edgeSignaturesEqual(EDGE_SIG, { ...EDGE_SIG, lengthRank: 2 })).toBe(false)
    expect(edgeSignaturesEqual(EDGE_SIG, { ...EDGE_SIG, midpointOctant: 5 })).toBe(false)
    expect(edgeSignaturesEqual(EDGE_SIG, { ...EDGE_SIG, incidentFaceKinds: 'cylinder|plane' })).toBe(false)
    expect(edgeSignaturesEqual(EDGE_SIG, { ...EDGE_SIG, kind: 'circle' })).toBe(false)
  })
})

describe('pickLostMessage — honest, non-overclaiming copy', () => {
  it('every reason maps to a non-empty operator string mentioning the fallback', () => {
    for (const reason of [
      'no-current-geometry',
      'no-tier1-no-signature',
      'no-signature-match',
      'ambiguous-signature'
    ] as const) {
      const msg = pickLostMessage(reason)
      expect(msg.length).toBeGreaterThan(0)
      expect(msg.toLowerCase()).toContain('axis bucket')
    }
  })
})

// ── CROSS-PATH proof against the REAL Python emitter output ──────────────────
//
// These literals are the ACTUAL `cad.tessellate_with_ids` output (cadquery 2.7.0
// venv) for the +Z top face of a 20×15×10 box vs the SAME box scaled 1.7x and
// translated by (100,−40,12.5) — i.e. a parametric MOVE + UNIFORM RESIZE. They
// are the wire shape this resolver consumes from the kernel agent's emitter
// (engines/cad/cadquery_script.py `compute_face_signature`). Capturing them as
// literals pins that the TS resolver and the Python emitter AGREE on the
// signature shape AND that a moved/resized pick recovers Tier-2 across the
// language boundary. (Regenerate via the venv if the emitter's hash ever changes;
// the invariance of the SIGNATURE — not the hashes — is the load-bearing fact,
// and that is also pinned in test_tier2_pick_signature_invariance.py.)
const REAL_BASE_TOP_ID = 'f:e470fe3c7b8df598'
const REAL_MOVED_TOP_ID = 'f:65f0a4dfd720f234'
const REAL_TOP_SIGNATURE: CadFaceSignature = {
  kind: 'plane',
  normalClass: '+0,+0,+1',
  centroidOctant: 14,
  areaRank: 0,
  adjacentFaceCount: 4
}

describe('resolvePickedId — cross-path against real CadQuery emitter output', () => {
  it('Tier-1 still misses across the move/resize (the real hashes differ)', () => {
    expect(REAL_BASE_TOP_ID).not.toBe(REAL_MOVED_TOP_ID)
  })

  it('recovers the moved + 1.7x-scaled +Z face by its real signature → the CURRENT id', () => {
    // Stored pick = the BASE top face (id + signature captured at pick time).
    const stored: StoredPick = {
      kind: 'face',
      id: REAL_BASE_TOP_ID,
      signature: REAL_TOP_SIGNATURE
    }
    // Current build = the MOVED+RESIZED body's faceMap, exactly as the emitter
    // serializes it (different occtId, identical invariant signature).
    const current = tessWith(
      [
        { occtId: REAL_MOVED_TOP_ID, signature: REAL_TOP_SIGNATURE },
        // a second, distinct face so the index isn't trivially singleton
        {
          occtId: 'f:other',
          signature: { ...REAL_TOP_SIGNATURE, normalClass: '+0,+0,-1', centroidOctant: 12 }
        }
      ],
      []
    )
    const res = resolvePickedId(stored, buildPickIndex(current))
    expect(res).toEqual({ ok: true, tier: 2, id: REAL_MOVED_TOP_ID })
  })
})
