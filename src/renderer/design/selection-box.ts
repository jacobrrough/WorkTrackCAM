/**
 * WINDOW/BOX SELECT — pure screen-space helpers (Phase 2, Fusion parity).
 *
 * The #1 batch-operation friction vs Fusion 360: selecting 30 faces took 30
 * clicks. This module holds the framework-free halves of the SHIFT+left-drag
 * box gesture so they unit-test in the node vitest pool without R3F:
 *
 *   1. **Drag-gesture state** ({@link BoxDragState} + transitions). The
 *      component layer (`Viewport3D`) stores one of these in a `useState`
 *      cell and renders the dashed rectangle from {@link boxDragRect}; the
 *      pointer handlers are thin wrappers over `begin/update`. A release
 *      whose travel never left the {@link BOX_SELECT_MIN_DRAG_PX} slop on
 *      EITHER axis is a CLICK, not a box ({@link isBoxDragClick}) — it must
 *      change nothing.
 *
 *   2. **The face hit-test** ({@link computeBoxSelectedFaceIds}). Projects
 *      every triangle vertex through the ACTIVE camera (perspective OR
 *      orthographic — the math is the raw view-projection matrix, so both
 *      work identically) into viewport CSS px and applies CROSSING semantics:
 *      a face is hit when ANY of its triangles' projected vertices falls
 *      inside the rect. Runs ONCE on release, never per-frame — a linear
 *      pass over moderate tessellated-CAD vertex counts is well inside
 *      budget.
 *
 * HONEST V1 LIMITATIONS (stated, not hidden):
 *   - CROSSING only — window-vs-crossing by drag direction (the AutoCAD /
 *     Fusion left-vs-right convention) is a follow-up.
 *   - Vertex-based: a face whose triangle merely OVERLAPS the rect without
 *     any vertex inside it (e.g. a huge triangle spanning a small rect) is
 *     missed. Tessellated CAD faces are dense enough that this is rare.
 *   - No occlusion test: faces on the far side of the solid select too
 *     (select-through), matching the common crossing-select behavior.
 *
 * Consumed by `Viewport3D` (gesture + release) and the box-select tests.
 */

import * as THREE from 'three'

// ── Screen-space rectangle ─────────────────────────────────────────────────

/** An axis-aligned rect in viewport-local CSS px (min/max normalized). */
export interface SelectionRectPx {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** Normalize two drag corners (ANY order) into a min/max rect. */
export function rectFromPoints(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number }
): SelectionRectPx {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  }
}

// ── Drag-gesture state (pure — the component just stores + renders it) ──────

/** One in-flight SHIFT+left-drag, in viewport-local CSS px. */
export interface BoxDragState {
  /** The captured pointer — moves/releases from other pointers are ignored. */
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly currentX: number
  readonly currentY: number
}

/** Start a drag at the pointerdown position (current == start). */
export function beginBoxDrag(pointerId: number, x: number, y: number): BoxDragState {
  return { pointerId, startX: x, startY: y, currentX: x, currentY: y }
}

/** Advance the drag to a new pointer position (immutable update). */
export function updateBoxDrag(state: BoxDragState, x: number, y: number): BoxDragState {
  return { ...state, currentX: x, currentY: y }
}

/** The drag's normalized rect (corners in any order). */
export function boxDragRect(state: BoxDragState): SelectionRectPx {
  return rectFromPoints(
    { x: state.startX, y: state.startY },
    { x: state.currentX, y: state.currentY }
  )
}

/**
 * Click-vs-drag slop (CSS px, per axis). Below this on BOTH axes the gesture
 * is a shift+CLICK, not a box — the release changes nothing. Matches the
 * 5-px context-menu travel gate's intent but tighter: 3 px keeps a tiny
 * deliberate box usable while still absorbing hand tremor.
 */
export const BOX_SELECT_MIN_DRAG_PX = 3

/** `true` when the travel stayed inside the click slop on BOTH axes. */
export function isBoxDragClick(
  state: BoxDragState,
  minDragPx: number = BOX_SELECT_MIN_DRAG_PX
): boolean {
  return (
    Math.abs(state.currentX - state.startX) < minDragPx &&
    Math.abs(state.currentY - state.startY) < minDragPx
  )
}

// ── The face hit-test (runs once, on release) ────────────────────────────

/**
 * Which face ids does the drag rect select? CROSSING semantics: a face is
 * hit when ANY of its triangles' vertices, projected through `camera` into
 * viewport CSS px, falls inside `rect` (inclusive bounds).
 *
 * Works for BOTH projections — the test is the raw view-projection matrix
 * (`camera.projectionMatrix × camera.matrixWorld⁻¹`), so a perspective and an
 * orthographic camera go through the identical path. Vertices behind the
 * camera (clip w <= 0) and outside the near/far NDC range are excluded so a
 * perspective wrap-around can never fabricate a hit.
 *
 * Contract details:
 *   - `faceIds` is the per-triangle parallel array (`userData.faceIds`); a
 *     triangle beyond its length, or with a non-finite entry, never selects.
 *   - `camera.matrixWorld` must be current (the R3F render loop keeps it so
 *     at runtime; tests call `updateMatrixWorld()`); the inverse is computed
 *     locally so a stale `matrixWorldInverse` cannot lie.
 *   - a degenerate rect (zero width OR height) selects nothing — the caller
 *     already gates on {@link isBoxDragClick}, this is defense in depth.
 *   - returns face ids sorted ascending (deterministic for callers + tests).
 *
 * Pure aside from reading the inputs — no Three.js scene access, no DOM.
 */
export function computeBoxSelectedFaceIds(
  geometry: THREE.BufferGeometry,
  faceIds: readonly number[],
  camera: THREE.Camera,
  rect: SelectionRectPx,
  viewportPx: { readonly width: number; readonly height: number }
): readonly number[] {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position || faceIds.length === 0) return []
  if (!(viewportPx.width > 0) || !(viewportPx.height > 0)) return []
  if (!(rect.maxX > rect.minX) || !(rect.maxY > rect.minY)) return []

  const index = geometry.index
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
  const limit = Math.min(triangleCount, faceIds.length)

  const viewMatrix = new THREE.Matrix4().copy(camera.matrixWorld).invert()
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, viewMatrix)
  const e = vp.elements

  const vertexInsideRect = (vi: number): boolean => {
    const x = position.getX(vi)
    const y = position.getY(vi)
    const z = position.getZ(vi)
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
    if (cw <= 0) return false // behind the camera (perspective)
    const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
    const ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
    const ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw
    if (ndcZ < -1 || ndcZ > 1) return false // outside the near/far clip range
    const sx = (ndcX + 1) * 0.5 * viewportPx.width
    const sy = (1 - ndcY) * 0.5 * viewportPx.height
    return sx >= rect.minX && sx <= rect.maxX && sy >= rect.minY && sy <= rect.maxY
  }

  const selected = new Set<number>()
  for (let t = 0; t < limit; t++) {
    const faceId = faceIds[t]
    if (typeof faceId !== 'number' || !Number.isFinite(faceId) || !Number.isInteger(faceId)) {
      continue
    }
    if (selected.has(faceId)) continue
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    if (vertexInsideRect(i0) || vertexInsideRect(i1) || vertexInsideRect(i2)) {
      selected.add(faceId)
    }
  }
  return [...selected].sort((a, b) => a - b)
}
