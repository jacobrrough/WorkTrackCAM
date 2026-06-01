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
  readGeometryFaceIds,
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
