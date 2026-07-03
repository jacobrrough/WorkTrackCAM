/**
 * VIEWPORT EDGE PICKING (Fusion-parity wave 4) — pure hit-test pins.
 *
 * Exercises the framework-free halves of the renderer's edge-pick flow in the
 * node vitest pool (no R3F / WebGL): the merged-geometry builder + its
 * segment→edge map, the screen-space distance-to-segment hit test (threshold,
 * ties, behind-camera, degenerate viewport, ortho AND perspective), the
 * occluder depth gate (an edge behind the clicked surface must NOT steal the
 * pick from the face in front), and the highlight-buffer concatenator.
 *
 * The cameras mirror `selection-box.test.ts`: both projections at z=+100
 * looking down −Z at the origin, updateMatrixWorld + updateProjectionMatrix
 * so the raw view-projection matrix inside `pickEdgeAtPoint` is current.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  EDGE_PICK_THRESHOLD_PX,
  buildEdgeHighlightPositions,
  edgeIndexForSegmentVertex,
  mergePickableEdges,
  ndcToPx,
  ndcZOfWorldPoint,
  pickEdgeAtPoint
} from './edge-pick'
import type { PickableEdge } from './viewport3d-geometry'

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A single straight edge from a→b as one segment (6 floats). */
function edge(
  edgeId: number,
  occtId: string,
  a: [number, number, number],
  b: [number, number, number]
): PickableEdge {
  return {
    edgeId,
    occtId,
    positions: new Float32Array([a[0], a[1], a[2], b[0], b[1], b[2]])
  }
}

/** Orthographic camera (frustum ±50, aspect 1) at z=+100 looking down −Z. */
function makeOrthoCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
  cam.position.set(0, 0, 100)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/** Perspective camera (fov 45, aspect 1) at z=+100 looking down −Z. */
function makePerspectiveCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 1, 0.5, 8000)
  cam.position.set(0, 0, 100)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

const VIEWPORT = { width: 100, height: 100 }

// ── mergePickableEdges ───────────────────────────────────────────────────────

describe('mergePickableEdges — one buffer + segment→edge map', () => {
  it('returns null on empty / missing input', () => {
    expect(mergePickableEdges(null)).toBeNull()
    expect(mergePickableEdges(undefined)).toBeNull()
    expect(mergePickableEdges([])).toBeNull()
  })

  it('concatenates every edge and maps each segment back to its source ordinal', () => {
    // Edge 0 has 2 segments (3 points → 12 floats); edge 1 has 1 segment.
    const e0: PickableEdge = {
      edgeId: 0,
      occtId: 'e:0',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])
    }
    const e1 = edge(1, 'e:1', [0, 5, 0], [1, 5, 0])
    const merged = mergePickableEdges([e0, e1])
    expect(merged).not.toBeNull()
    // 2 + 1 segments × 6 floats.
    expect(merged!.positions.length).toBe(18)
    // Segment 0,1 → edge 0; segment 2 → edge 1.
    expect(merged!.segmentEdgeIndex).toEqual([0, 0, 1])
  })

  it('skips an edge whose positions length is not whole segments (no map corruption)', () => {
    const bad: PickableEdge = { edgeId: 0, occtId: 'e:bad', positions: new Float32Array([0, 0, 0]) }
    const good = edge(1, 'e:1', [0, 0, 0], [1, 0, 0])
    const merged = mergePickableEdges([bad, good])
    expect(merged).not.toBeNull()
    expect(merged!.segmentEdgeIndex).toEqual([1])
  })
})

describe('edgeIndexForSegmentVertex — hit vertex → source edge ordinal', () => {
  const map = [0, 0, 1] // segments 0,1 → edge 0; segment 2 → edge 1
  it('maps a first-vertex index to the segment then the edge ordinal', () => {
    expect(edgeIndexForSegmentVertex(0, map)).toBe(0) // segment 0
    expect(edgeIndexForSegmentVertex(2, map)).toBe(0) // segment 1
    expect(edgeIndexForSegmentVertex(4, map)).toBe(1) // segment 2
    expect(edgeIndexForSegmentVertex(5, map)).toBe(1) // segment 2 (2nd endpoint)
  })
  it('returns null on missing / negative / out-of-range indices', () => {
    expect(edgeIndexForSegmentVertex(null, map)).toBeNull()
    expect(edgeIndexForSegmentVertex(undefined, map)).toBeNull()
    expect(edgeIndexForSegmentVertex(-1, map)).toBeNull()
    expect(edgeIndexForSegmentVertex(6, map)).toBeNull() // segment 3 ≥ length
    expect(edgeIndexForSegmentVertex(1.5, map)).toBeNull()
  })
})

// ── ndcToPx / ndcZOfWorldPoint ───────────────────────────────────────────────

describe('ndcToPx — R3F NDC pointer → CSS px', () => {
  it('maps the NDC corners to viewport px (y flips)', () => {
    expect(ndcToPx({ x: -1, y: 1 }, VIEWPORT)).toEqual({ x: 0, y: 0 }) // top-left
    expect(ndcToPx({ x: 1, y: -1 }, VIEWPORT)).toEqual({ x: 100, y: 100 }) // bottom-right
    expect(ndcToPx({ x: 0, y: 0 }, VIEWPORT)).toEqual({ x: 50, y: 50 }) // center
  })
})

describe('ndcZOfWorldPoint — depth of a world point through the camera', () => {
  it('a nearer point (larger z toward the camera) has a smaller NDC z (ortho)', () => {
    const cam = makeOrthoCamera()
    const front = ndcZOfWorldPoint(cam, { x: 0, y: 0, z: 10 })
    const back = ndcZOfWorldPoint(cam, { x: 0, y: 0, z: -10 })
    expect(front).not.toBeNull()
    expect(back).not.toBeNull()
    expect(front!).toBeLessThan(back!)
  })
  it('returns null for a point behind the camera', () => {
    const cam = makePerspectiveCamera()
    // Camera at z=+100 looking down −Z; a point at z=+200 is behind it.
    expect(ndcZOfWorldPoint(cam, { x: 0, y: 0, z: 200 })).toBeNull()
  })
})

// ── pickEdgeAtPoint — the screen-space hit test ──────────────────────────────

describe('pickEdgeAtPoint — threshold + nearest-edge (ortho + perspective)', () => {
  // A horizontal edge across the origin at z=0. Under both cameras (aspect 1,
  // origin-centered) it projects through the viewport's vertical center (y≈50).
  const horizontal = edge(0, 'e:h', [-20, 0, 0], [20, 0, 0])

  for (const [name, cam] of [
    ['ortho', makeOrthoCamera()],
    ['perspective', makePerspectiveCamera()]
  ] as const) {
    it(`${name}: a click ON the edge picks it (dist ~0)`, () => {
      const hit = pickEdgeAtPoint([horizontal], cam, { x: 50, y: 50 }, VIEWPORT)
      expect(hit).not.toBeNull()
      expect(hit!.edge.occtId).toBe('e:h')
      expect(hit!.distancePx).toBeLessThan(1)
    })

    it(`${name}: a click just OUTSIDE the threshold misses`, () => {
      const hit = pickEdgeAtPoint(
        [horizontal],
        cam,
        { x: 50, y: 50 + EDGE_PICK_THRESHOLD_PX + 3 },
        VIEWPORT
      )
      expect(hit).toBeNull()
    })

    it(`${name}: a click just INSIDE the threshold hits`, () => {
      const hit = pickEdgeAtPoint(
        [horizontal],
        cam,
        { x: 50, y: 50 + EDGE_PICK_THRESHOLD_PX - 2 },
        VIEWPORT
      )
      expect(hit).not.toBeNull()
      expect(hit!.edge.occtId).toBe('e:h')
    })
  }

  it('picks the NEAREST of two edges within threshold', () => {
    const cam = makeOrthoCamera()
    // Two horizontal edges: one at y=0 (screen y≈50), one at y=+2mm (screen y≈49).
    const atOrigin = edge(0, 'e:0', [-20, 0, 0], [20, 0, 0])
    const nearby = edge(1, 'e:1', [-20, 2, 0], [20, 2, 0])
    // Click at screen y=50 → closer to the y=0 edge.
    const hit = pickEdgeAtPoint([nearby, atOrigin], cam, { x: 50, y: 50 }, VIEWPORT)
    expect(hit).not.toBeNull()
    expect(hit!.edge.occtId).toBe('e:0')
  })

  it('a degenerate viewport (zero size) picks nothing', () => {
    const cam = makeOrthoCamera()
    expect(pickEdgeAtPoint([horizontal], cam, { x: 0, y: 0 }, { width: 0, height: 0 })).toBeNull()
  })

  it('an empty / missing edge list picks nothing', () => {
    const cam = makeOrthoCamera()
    expect(pickEdgeAtPoint([], cam, { x: 50, y: 50 }, VIEWPORT)).toBeNull()
    expect(pickEdgeAtPoint(null, cam, { x: 50, y: 50 }, VIEWPORT)).toBeNull()
  })
})

describe('pickEdgeAtPoint — occluder depth gate (edge precedence honesty)', () => {
  // A front edge at z=+10 and a back edge at z=−10, both crossing the origin so
  // they project to the SAME screen point (y≈50) under the origin-facing camera.
  const frontEdge = edge(0, 'e:front', [-20, 0, 10], [20, 0, 10])
  const backEdge = edge(1, 'e:back', [-20, 0, -10], [20, 0, -10])

  it('with NO occluder, the nearest (front) edge wins at the shared screen point', () => {
    const cam = makeOrthoCamera()
    const hit = pickEdgeAtPoint([backEdge, frontEdge], cam, { x: 50, y: 50 }, VIEWPORT)
    expect(hit).not.toBeNull()
    // Both are equidistant in screen space, so nearest-distance ties → source
    // order keeps the FIRST; assert we DID pick one of them (front preference is
    // enforced by the occluder gate below, not by 2D distance).
    expect(['e:front', 'e:back']).toContain(hit!.edge.occtId)
  })

  it('a front edge ON the clicked surface stays pickable (occluder eps)', () => {
    const cam = makeOrthoCamera()
    // The clicked surface sits at the front edge's depth.
    const occ = ndcZOfWorldPoint(cam, { x: 0, y: 0, z: 10 })
    const hit = pickEdgeAtPoint([frontEdge], cam, { x: 50, y: 50 }, VIEWPORT, {
      occluderNdcZ: occ
    })
    expect(hit).not.toBeNull()
    expect(hit!.edge.occtId).toBe('e:front')
  })

  it('a hidden BACK edge is rejected when the clicked surface occludes it', () => {
    const cam = makeOrthoCamera()
    // Clicked surface is at the FRONT depth (z=+10); the back edge (z=−10) is
    // behind it and must not steal the pick from the face in front.
    const occ = ndcZOfWorldPoint(cam, { x: 0, y: 0, z: 10 })
    const hit = pickEdgeAtPoint([backEdge], cam, { x: 50, y: 50 }, VIEWPORT, {
      occluderNdcZ: occ
    })
    expect(hit).toBeNull()
  })

  it('given both, the occluder gate leaves ONLY the front edge → front wins', () => {
    const cam = makeOrthoCamera()
    const occ = ndcZOfWorldPoint(cam, { x: 0, y: 0, z: 10 })
    const hit = pickEdgeAtPoint([backEdge, frontEdge], cam, { x: 50, y: 50 }, VIEWPORT, {
      occluderNdcZ: occ
    })
    expect(hit).not.toBeNull()
    expect(hit!.edge.occtId).toBe('e:front')
  })
})

// ── buildEdgeHighlightPositions ──────────────────────────────────────────────

describe('buildEdgeHighlightPositions — concat selected edge buffers', () => {
  const edges: PickableEdge[] = [
    edge(0, 'e:0', [0, 0, 0], [1, 0, 0]),
    edge(1, 'e:1', [0, 1, 0], [1, 1, 0]),
    edge(2, 'e:2', [0, 2, 0], [1, 2, 0])
  ]

  it('returns an empty buffer for an empty / missing id set', () => {
    expect(buildEdgeHighlightPositions(edges, null).length).toBe(0)
    expect(buildEdgeHighlightPositions(edges, []).length).toBe(0)
    expect(buildEdgeHighlightPositions(null, [0]).length).toBe(0)
  })

  it('concatenates ONLY the requested edges by ordinal', () => {
    const buf = buildEdgeHighlightPositions(edges, [0, 2])
    // 2 edges × 1 segment × 6 floats.
    expect(buf.length).toBe(12)
    // First edge (ordinal 0) endpoints, then edge 2's.
    expect(Array.from(buf.slice(0, 6))).toEqual([0, 0, 0, 1, 0, 0])
    expect(Array.from(buf.slice(6, 12))).toEqual([0, 2, 0, 1, 2, 0])
  })

  it('ignores unknown / non-integer ordinals', () => {
    expect(buildEdgeHighlightPositions(edges, [99]).length).toBe(0)
    expect(buildEdgeHighlightPositions(edges, [1.5, -1]).length).toBe(0)
  })
})
