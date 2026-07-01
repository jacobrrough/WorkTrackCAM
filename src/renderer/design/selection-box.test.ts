/**
 * WINDOW/BOX SELECT — pure-helper pins (Phase 2, Fusion parity).
 *
 * Runs in the `node` vitest environment. Three.js is imported for REAL
 * camera math (an `OrthographicCamera` and a `PerspectiveCamera` with
 * updated matrices) — no R3F, no DOM, no WebGL.
 *
 * Pinned contracts:
 *   - `rectFromPoints` normalizes corners given in ANY order.
 *   - the drag-state transitions are immutable and `isBoxDragClick` treats
 *     sub-slop travel on BOTH axes as a click (release changes nothing).
 *   - `computeBoxSelectedFaceIds` implements CROSSING semantics (ANY
 *     projected triangle vertex inside the rect selects the face) through
 *     the ACTIVE camera — identical behavior in orthographic AND
 *     perspective projections; vertices behind a perspective camera can
 *     never fabricate a hit; degenerate rects select nothing; results are
 *     sorted + deduped.
 *   - the Viewport3D / DesignWorkspace wiring source-pins at the bottom
 *     stand in for the drag flow the node pool cannot mount (the R3F
 *     Canvas needs WebGL); the interactive half lives in
 *     `__tests__/BoxSelect.dom.spec.tsx`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  BOX_SELECT_MIN_DRAG_PX,
  beginBoxDrag,
  boxDragRect,
  computeBoxSelectedFaceIds,
  isBoxDragClick,
  rectFromPoints,
  updateBoxDrag,
} from './selection-box'

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Two separated quads (2 triangles each) on the z=0 plane, indexed, with the
 * per-triangle parallel `faceIds` array `[0, 0, 1, 1]`:
 *   - face 0: x ∈ [-40, -20], y ∈ [-10, 10]
 *   - face 1: x ∈ [ 20,  40], y ∈ [-10, 10]
 * Matches the flat-positions + index shape `cad.tessellate_with_ids` emits.
 */
function makeTwoQuadGeometry(): { geometry: THREE.BufferGeometry; faceIds: number[] } {
  const g = new THREE.BufferGeometry()
  const positions = new Float32Array([
    // face 0 quad
    -40, -10, 0, // 0
    -20, -10, 0, // 1
    -20, 10, 0, // 2
    -40, 10, 0, // 3
    // face 1 quad
    20, -10, 0, // 4
    40, -10, 0, // 5
    40, 10, 0, // 6
    20, 10, 0, // 7
  ])
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return { geometry: g, faceIds: [0, 0, 1, 1] }
}

/**
 * Orthographic camera at z=+100 looking at the origin, frustum ±50 on both
 * axes → with a 100×100 px viewport the screen mapping is the affine
 * `sx = worldX + 50`, `sy = 50 - worldY` (easy to reason about in the pins).
 */
function makeOrthoCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
  cam.position.set(0, 0, 100)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/** Perspective camera (fov 45, aspect 1) at z=+100 looking at the origin. */
function makePerspectiveCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 1, 0.5, 8000)
  cam.position.set(0, 0, 100)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

const VIEWPORT = { width: 100, height: 100 }

// ── rectFromPoints ──────────────────────────────────────────────────────────

describe('rectFromPoints — corner normalization', () => {
  it('normalizes corners given in any order', () => {
    const expected = { minX: 1, minY: 2, maxX: 5, maxY: 9 }
    expect(rectFromPoints({ x: 1, y: 2 }, { x: 5, y: 9 })).toEqual(expected)
    expect(rectFromPoints({ x: 5, y: 9 }, { x: 1, y: 2 })).toEqual(expected)
    expect(rectFromPoints({ x: 5, y: 2 }, { x: 1, y: 9 })).toEqual(expected)
    expect(rectFromPoints({ x: 1, y: 9 }, { x: 5, y: 2 })).toEqual(expected)
  })
})

// ── Drag-gesture state ──────────────────────────────────────────────────────

describe('box drag state — begin / update / rect / click-slop', () => {
  it('beginBoxDrag starts with current == start', () => {
    expect(beginBoxDrag(7, 10, 20)).toEqual({
      pointerId: 7,
      startX: 10,
      startY: 20,
      currentX: 10,
      currentY: 20,
    })
  })

  it('updateBoxDrag is immutable and only moves the current corner', () => {
    const start = beginBoxDrag(1, 10, 20)
    const moved = updateBoxDrag(start, 40, 5)
    expect(moved).not.toBe(start)
    expect(start.currentX).toBe(10)
    expect(moved).toEqual({ pointerId: 1, startX: 10, startY: 20, currentX: 40, currentY: 5 })
  })

  it('boxDragRect normalizes a drag in any direction', () => {
    const upLeft = updateBoxDrag(beginBoxDrag(1, 50, 60), 10, 20)
    expect(boxDragRect(upLeft)).toEqual({ minX: 10, minY: 20, maxX: 50, maxY: 60 })
  })

  it('isBoxDragClick — sub-slop travel on BOTH axes is a click', () => {
    const still = beginBoxDrag(1, 10, 10)
    expect(isBoxDragClick(still)).toBe(true)
    expect(isBoxDragClick(updateBoxDrag(still, 12.9, 10))).toBe(true)
    // Crossing the slop on EITHER axis makes it a drag.
    expect(isBoxDragClick(updateBoxDrag(still, 13, 10))).toBe(false)
    expect(isBoxDragClick(updateBoxDrag(still, 10, 13))).toBe(false)
    expect(BOX_SELECT_MIN_DRAG_PX).toBe(3)
  })

  it('isBoxDragClick honors a custom slop', () => {
    const s = updateBoxDrag(beginBoxDrag(1, 0, 0), 5, 0)
    expect(isBoxDragClick(s, 10)).toBe(true)
    expect(isBoxDragClick(s, 5)).toBe(false)
  })
})

// ── computeBoxSelectedFaceIds — ORTHOGRAPHIC ───────────────────────────────

describe('computeBoxSelectedFaceIds — orthographic camera', () => {
  // Screen mapping: face 0 covers sx ∈ [10, 30], sy ∈ [40, 60];
  //                 face 1 covers sx ∈ [70, 90], sy ∈ [40, 60].
  it('selects only the face whose vertices are CONTAINED by the rect', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const rect = { minX: 0, minY: 30, maxX: 40, maxY: 70 }
    expect(computeBoxSelectedFaceIds(geometry, faceIds, makeOrthoCamera(), rect, VIEWPORT)).toEqual([0])
  })

  it('selects both faces when the rect spans the viewport (sorted ascending)', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(computeBoxSelectedFaceIds(geometry, faceIds, makeOrthoCamera(), rect, VIEWPORT)).toEqual([0, 1])
  })

  it('selects nothing when the rect lands between the faces', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const rect = { minX: 45, minY: 45, maxX: 55, maxY: 55 }
    expect(computeBoxSelectedFaceIds(geometry, faceIds, makeOrthoCamera(), rect, VIEWPORT)).toEqual([])
  })

  it('CROSSING semantics — ONE vertex inside the rect selects the whole face', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    // Face 1's corner (20, 10, 0) projects to (70, 40); this rect contains
    // ONLY that corner — none of the other three.
    const rect = { minX: 65, minY: 35, maxX: 75, maxY: 45 }
    expect(computeBoxSelectedFaceIds(geometry, faceIds, makeOrthoCamera(), rect, VIEWPORT)).toEqual([1])
  })

  it('a degenerate rect (zero width or height) selects nothing', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const cam = makeOrthoCamera()
    expect(
      computeBoxSelectedFaceIds(geometry, faceIds, cam, { minX: 20, minY: 0, maxX: 20, maxY: 100 }, VIEWPORT)
    ).toEqual([])
    expect(
      computeBoxSelectedFaceIds(geometry, faceIds, cam, { minX: 0, minY: 50, maxX: 100, maxY: 50 }, VIEWPORT)
    ).toEqual([])
  })

  it('an empty faceIds stash or zero-size viewport selects nothing', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const cam = makeOrthoCamera()
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(computeBoxSelectedFaceIds(geometry, [], cam, rect, VIEWPORT)).toEqual([])
    expect(computeBoxSelectedFaceIds(geometry, faceIds, cam, rect, { width: 0, height: 0 })).toEqual([])
  })

  it('triangles beyond the faceIds length never select (short-stash guard)', () => {
    const { geometry } = makeTwoQuadGeometry()
    // Only the first two triangles (face 0) are mapped; face 1 is unmapped.
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(computeBoxSelectedFaceIds(geometry, [0, 0], makeOrthoCamera(), rect, VIEWPORT)).toEqual([0])
  })

  it('non-finite faceIds entries are skipped (never fabricates an id)', () => {
    const { geometry } = makeTwoQuadGeometry()
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(
      computeBoxSelectedFaceIds(geometry, [Number.NaN, Number.NaN, 1, 1], makeOrthoCamera(), rect, VIEWPORT)
    ).toEqual([1])
  })

  it('supports unindexed geometry (3 consecutive vertices per triangle)', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-10, -10, 0, 10, -10, 0, 0, 10, 0]), 3)
    )
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(computeBoxSelectedFaceIds(g, [5], makeOrthoCamera(), rect, VIEWPORT)).toEqual([5])
  })
})

// ── computeBoxSelectedFaceIds — PERSPECTIVE ────────────────────────────────

describe('computeBoxSelectedFaceIds — perspective camera', () => {
  // fov 45 / aspect 1 at distance 100 → half-extent = 100·tan(22.5°) ≈ 41.42
  // world units. Face 0 (x ∈ [-40,-20]) lands at sx ≈ [1.7, 25.9]; face 1
  // mirrors at sx ≈ [74.1, 98.3]; both at sy ≈ [37.9, 62.1].
  it('selects only the boxed face (left half of the screen)', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const rect = { minX: 0, minY: 30, maxX: 30, maxY: 70 }
    expect(
      computeBoxSelectedFaceIds(geometry, faceIds, makePerspectiveCamera(), rect, VIEWPORT)
    ).toEqual([0])
  })

  it('selects both faces with a full-viewport rect', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(
      computeBoxSelectedFaceIds(geometry, faceIds, makePerspectiveCamera(), rect, VIEWPORT)
    ).toEqual([0, 1])
  })

  it('CROSSING semantics hold in perspective too (single-corner rect)', () => {
    const { geometry, faceIds } = makeTwoQuadGeometry()
    // Face 0's corner (-20, 10, 0) projects to ≈ (25.9, 37.9): box just it.
    const rect = { minX: 24, minY: 36, maxX: 28, maxY: 40 }
    expect(
      computeBoxSelectedFaceIds(geometry, faceIds, makePerspectiveCamera(), rect, VIEWPORT)
    ).toEqual([0])
  })

  it('vertices BEHIND the camera can never fabricate a hit (w <= 0 guard)', () => {
    const g = new THREE.BufferGeometry()
    // A triangle at z=150 — behind the camera sitting at z=100 looking at -z.
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-10, -10, 150, 10, -10, 150, 0, 10, 150]), 3)
    )
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(computeBoxSelectedFaceIds(g, [0], makePerspectiveCamera(), rect, VIEWPORT)).toEqual([])
  })
})

// ── Wiring source-pins (the drag flow the node pool cannot mount) ──────────
//
// The R3F Canvas needs WebGL, so the node suite cannot drive the real
// pointer flow — the interactive half is covered by the happy-dom harness in
// `__tests__/BoxSelect.dom.spec.tsx` (which mirrors the wiring 1:1), and
// these pins prove the REAL component carries that exact wiring.

const viewport3dSrc = readFileSync(
  fileURLToPath(new URL('./Viewport3D.tsx', import.meta.url)),
  'utf-8'
)
const designWorkspaceSrc = readFileSync(
  fileURLToPath(new URL('./DesignWorkspace.tsx', import.meta.url)),
  'utf-8'
)
const workspaceCssSrc = readFileSync(
  fileURLToPath(new URL('../styles/workspace.css', import.meta.url)),
  'utf-8'
)

describe('Viewport3D — box-select wiring source-pins', () => {
  it('intercepts pointerdown in the CAPTURE phase (before OrbitControls)', () => {
    expect(viewport3dSrc).toContain('onPointerDownCapture={handleBoxPointerDownCapture}')
    expect(viewport3dSrc).toContain('e.stopPropagation()')
  })

  it('arms ONLY under SHIFT+left on the canvas in plain face mode', () => {
    expect(viewport3dSrc).toContain("if (e.button !== 0 || !e.shiftKey) return")
    expect(viewport3dSrc).toContain('if (!(e.target instanceof HTMLCanvasElement)) return')
    expect(viewport3dSrc).toContain("selectionMode === 'face' &&")
    expect(viewport3dSrc).toContain('!effectiveMeasureMode &&')
    expect(viewport3dSrc).toContain('readGeometryFaceIds(stable) !== null')
  })

  it('runs the hit-test ONCE on release and stays silent on an empty box', () => {
    expect(viewport3dSrc).toContain('computeBoxSelectedFaceIds(')
    expect(viewport3dSrc).toContain('if (isBoxDragClick(finalState)) return')
    expect(viewport3dSrc).toContain('if (hits.length > 0) onBoxSelectFaces(hits)')
  })

  it('renders the dashed rectangle overlay + threads the multi-face highlight', () => {
    expect(viewport3dSrc).toContain('className="viewport-3d__box-select"')
    expect(viewport3dSrc).toContain('data-testid="viewport-3d-box-select"')
    expect(viewport3dSrc).toContain('highlightedFaceIds={highlightedFaceIds}')
    expect(viewport3dSrc).toContain('trianglesForFaces(wanted, faceIds)')
  })

  it('forwards Ctrl/Cmd on a plain click as the toggle modifier', () => {
    expect(viewport3dSrc).toContain('onSelect(next, { toggle: e.ctrlKey || e.metaKey })')
  })
})

describe('DesignWorkspace — box-select wiring source-pins', () => {
  it('unions boxed faces via addFacesToSelection and toggles via toggleFaceInSelection', () => {
    expect(designWorkspaceSrc).toContain('addFacesToSelection(prev, faceIds)')
    expect(designWorkspaceSrc).toContain('toggleFaceInSelection(prev, next)')
  })

  it('wires onBoxSelectFaces with the same gating as onSelect', () => {
    expect(designWorkspaceSrc).toContain('onBoxSelectFaces={')
    expect(designWorkspaceSrc).toContain('? handleViewportBoxSelect')
  })

  it('shows the multi-face count in the selection chip and highlights the SET', () => {
    expect(designWorkspaceSrc).toContain('${ids.length} faces')
    expect(designWorkspaceSrc).toContain('highlightedFaceIds={')
    expect(designWorkspaceSrc).toContain('? selectedFaceIds(selection)')
  })
})

describe('workspace.css — box-select overlay style pin', () => {
  it('styles .viewport-3d__box-select with a dashed accent border, hit-through', () => {
    expect(workspaceCssSrc).toContain('.viewport-3d__box-select {')
    expect(workspaceCssSrc).toMatch(
      /\.viewport-3d__box-select \{[^}]*pointer-events: none;[^}]*border: 1px dashed var\(--accent\);/
    )
  })
})
