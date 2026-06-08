/**
 * Render-pin for the CAD V1 Workflow H highlight overlay helpers
 * exported by `Viewport3D.tsx`.
 *
 * Why a `.ts` test (not `.tsx`)? The actual `Solid` mesh component
 * lives inside `@react-three/fiber`'s reconciler, which the `node`
 * vitest environment cannot drive. The pieces that DO need pinning are
 * the pure helpers — `readGeometryFaceIds` and `buildFaceHighlightSegments` —
 * which the component uses to decide whether to render the overlay and
 * what positions to draw. Validating these in isolation gives us full
 * coverage of the selection visual without dragging Three.js into the
 * renderer-side reconciler.
 *
 * Pinned contracts:
 *   - `readGeometryFaceIds` returns the stashed array verbatim when
 *     present, and `null` on every defensive path (no userData, no
 *     `faceIds` key, non-array value). The renderer's click handler
 *     relies on the null return to short-circuit cleanly.
 *   - `buildFaceHighlightSegments` produces a `Float32Array` of length
 *     `triangleCount * 18` (3 edges × 2 endpoints × 3 floats), with
 *     each segment tracing one triangle edge of the source geometry.
 *     The wire-outline overlay relies on this layout: changing the
 *     ordering would scramble the visual feedback.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildFaceHighlightSegments,
  readGeometryEdgeIds,
  readGeometryFaceIds,
  readGeometryFaceOcctIds,
  readGeometryVertexIds,
  resolveSelectionFromPick,
} from './Viewport3D'

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Build a tiny indexed `BufferGeometry` with two triangles sharing one
 * edge so the highlight overlay has a non-trivial input. Matches the
 * shape the sidecar's `cad.tessellate_with_ids` emits (flat positions
 * + index buffer).
 */
function makeTwoTriangleGeometry(faceIds: readonly number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // Four vertices forming a quad (two right triangles).
  const positions = new Float32Array([
    0, 0, 0, // 0
    1, 0, 0, // 1
    1, 1, 0, // 2
    0, 1, 0, // 3
  ])
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // Two triangles: (0, 1, 2) and (0, 2, 3).
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.userData = { faceIds: [...faceIds] }
  return g
}

// ── readGeometryFaceIds ────────────────────────────────────────────────────

describe('readGeometryFaceIds — stash accessor', () => {
  it('returns the stashed faceIds array when present', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    expect(readGeometryFaceIds(g)).toEqual([0, 1])
  })

  it('returns null when geometry is null', () => {
    expect(readGeometryFaceIds(null)).toBeNull()
    expect(readGeometryFaceIds(undefined)).toBeNull()
  })

  it('returns null when userData has no faceIds key', () => {
    const g = new THREE.BufferGeometry()
    expect(readGeometryFaceIds(g)).toBeNull()
  })

  it('returns null when faceIds is not an array (defensive)', () => {
    const g = new THREE.BufferGeometry()
    g.userData = { faceIds: 'not-an-array' as unknown as number[] }
    expect(readGeometryFaceIds(g)).toBeNull()
  })
})

// ── buildFaceHighlightSegments ─────────────────────────────────────────────

describe('buildFaceHighlightSegments — wire-outline overlay', () => {
  it('returns an empty Float32Array when no triangles are passed', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    expect(buildFaceHighlightSegments(g, [])).toEqual(new Float32Array(0))
  })

  it('returns an empty Float32Array when the geometry has no position attribute', () => {
    const g = new THREE.BufferGeometry()
    expect(buildFaceHighlightSegments(g, [0])).toEqual(new Float32Array(0))
  })

  it('emits exactly 18 floats per triangle (3 edges × 2 endpoints × 3 floats)', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    const segments = buildFaceHighlightSegments(g, [0])
    expect(segments.length).toBe(18)
    // Two triangles → 36 floats.
    const both = buildFaceHighlightSegments(g, [0, 1])
    expect(both.length).toBe(36)
  })

  it('traces the three edges of the requested triangle in (0→1, 1→2, 2→0) order', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    // Triangle 0 uses vertices (0,0,0), (1,0,0), (1,1,0).
    const seg = buildFaceHighlightSegments(g, [0])
    // edge 0 → 1: (0,0,0) -> (1,0,0)
    expect(Array.from(seg.slice(0, 6))).toEqual([0, 0, 0, 1, 0, 0])
    // edge 1 → 2: (1,0,0) -> (1,1,0)
    expect(Array.from(seg.slice(6, 12))).toEqual([1, 0, 0, 1, 1, 0])
    // edge 2 → 0: (1,1,0) -> (0,0,0)
    expect(Array.from(seg.slice(12, 18))).toEqual([1, 1, 0, 0, 0, 0])
  })

  it('handles unindexed geometry by treating each triangle as 3 consecutive vertices', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
        3,
      ),
    )
    g.userData = { faceIds: [0] }
    const seg = buildFaceHighlightSegments(g, [0])
    expect(seg.length).toBe(18)
    // edge 0 → 1: (0,0,0) -> (2,0,0)
    expect(Array.from(seg.slice(0, 6))).toEqual([0, 0, 0, 2, 0, 0])
  })
})

// ── readGeometryEdgeIds / readGeometryVertexIds (honest seam) ──────────────

describe('readGeometryEdgeIds / readGeometryVertexIds — honest seam', () => {
  it('returns null for a geometry the sidecar produces today (no edgeIds stash)', () => {
    // The running kernel emits ONLY faceIds; edge/vertex stashes never
    // exist, so the readers must report null (no fabricated ids).
    const g = makeTwoTriangleGeometry([0, 1])
    expect(readGeometryEdgeIds(g)).toBeNull()
    expect(readGeometryVertexIds(g)).toBeNull()
  })

  it('returns null for a null/undefined geometry', () => {
    expect(readGeometryEdgeIds(null)).toBeNull()
    expect(readGeometryVertexIds(undefined)).toBeNull()
  })

  it('reads an edgeIds stash when a future surface provides one', () => {
    // Forward-compat: prove the seam lights up the moment the data lands.
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).edgeIds = [7, 7]
    expect(readGeometryEdgeIds(g)).toEqual([7, 7])
  })

  it('reads a vertexIds stash when provided', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).vertexIds = [3, 4]
    expect(readGeometryVertexIds(g)).toEqual([3, 4])
  })
})

// ── resolveSelectionFromPick (mode branching + honesty boundary) ──────

describe('resolveSelectionFromPick — pick mode branching', () => {
  it('face mode resolves the clicked triangle to a face Selection', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    expect(resolveSelectionFromPick('face', g, 0)).toEqual({ kind: 'face', faceId: 0 })
    expect(resolveSelectionFromPick('face', g, 1)).toEqual({ kind: 'face', faceId: 1 })
  })

  it('face mode returns null when the triangle index is out of range', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    expect(resolveSelectionFromPick('face', g, 99)).toBeNull()
    expect(resolveSelectionFromPick('face', g, undefined)).toBeNull()
  })

  it('face mode returns null on a legacy geometry with no faceIds stash', () => {
    const g = new THREE.BufferGeometry()
    expect(resolveSelectionFromPick('face', g, 0)).toBeNull()
  })

  it('edge mode returns null today (sidecar emits no edge ids — no fabrication)', () => {
    // THE honesty boundary: a face-tagged mesh must NOT yield an edge
    // selection just because the triangle resolves to a face.
    const g = makeTwoTriangleGeometry([0, 1])
    expect(resolveSelectionFromPick('edge', g, 0)).toBeNull()
  })

  it('vertex mode returns null today (no kernel vertex ids)', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    expect(resolveSelectionFromPick('vertex', g, 0)).toBeNull()
  })

  it('edge mode resolves an EdgeSelection once an edgeIds stash exists', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).edgeIds = [5, 9]
    expect(resolveSelectionFromPick('edge', g, 0)).toEqual({ kind: 'edge', faceId: 5 })
    expect(resolveSelectionFromPick('edge', g, 1)).toEqual({ kind: 'edge', faceId: 9 })
  })

  it('vertex mode resolves a VertexSelection once a vertexIds stash exists', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).vertexIds = [2, 6]
    expect(resolveSelectionFromPick('vertex', g, 1)).toEqual({ kind: 'vertex', faceId: 6 })
  })
})

// ── FG-5b: stable occt-id stash (faceOcctIds) + pass-through ────────────────

describe('readGeometryFaceOcctIds — stable face-id stash accessor', () => {
  it('returns the stashed faceOcctIds string array when present', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).faceOcctIds = ['f:aaa', 'f:bbb']
    expect(readGeometryFaceOcctIds(g)).toEqual(['f:aaa', 'f:bbb'])
  })

  it('returns null when the stash is absent or null geometry', () => {
    expect(readGeometryFaceOcctIds(makeTwoTriangleGeometry([0, 1]))).toBeNull()
    expect(readGeometryFaceOcctIds(null)).toBeNull()
    expect(readGeometryFaceOcctIds(undefined)).toBeNull()
  })
})

describe('resolveSelectionFromPick — FG-5b stable occtId pass-through', () => {
  it('face pick carries the stable "f:<hex>" id as occtHash when faceOcctIds is stashed', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).faceOcctIds = ['f:top', 'f:side']
    expect(resolveSelectionFromPick('face', g, 0)).toEqual({
      kind: 'face',
      faceId: 0,
      occtHash: 'f:top',
    })
    expect(resolveSelectionFromPick('face', g, 1)).toEqual({
      kind: 'face',
      faceId: 1,
      occtHash: 'f:side',
    })
  })

  it('face pick omits occtHash when there is no faceOcctIds stash (degrades to id-only)', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    const sel = resolveSelectionFromPick('face', g, 0)
    expect(sel).toEqual({ kind: 'face', faceId: 0 })
    expect(sel).not.toHaveProperty('occtHash')
  })

  it('edge pick carries the stable "e:<hex>" id when both edgeIds + edgeOcctIds are stashed', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    ;(g.userData as Record<string, unknown>).edgeIds = [5, 9]
    ;(g.userData as Record<string, unknown>).edgeOcctIds = ['e:five', 'e:nine']
    expect(resolveSelectionFromPick('edge', g, 0)).toEqual({
      kind: 'edge',
      faceId: 5,
      occtHash: 'e:five',
    })
  })

  it('out-of-range / short occtId stash never fabricates an id (omits occtHash)', () => {
    const g = makeTwoTriangleGeometry([0, 1])
    // faceOcctIds shorter than the triangle index → no stable id for triangle 1.
    ;(g.userData as Record<string, unknown>).faceOcctIds = ['f:only']
    expect(resolveSelectionFromPick('face', g, 1)).toEqual({ kind: 'face', faceId: 1 })
  })
})
