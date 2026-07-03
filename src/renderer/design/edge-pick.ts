/**
 * VIEWPORT EDGE PICKING (Fusion-parity wave 4) — pure screen-space helpers.
 *
 * The engine half (wave 3) already ships per-edge sampled POLYLINES with
 * stable `"e:<hex>"` ids (`cad.tessellate_with_ids` → `edges` + `edgeMap`),
 * turned into renderer-ready {@link PickableEdge}s by
 * `viewport3d-geometry.buildPickableEdges`. This module holds the
 * framework-free halves of the renderer's edge-pick flow so they unit-test in
 * the node vitest pool without R3F:
 *
 *   1. **One merged geometry for ALL edges** ({@link mergePickableEdges}).
 *      `Viewport3D` renders a single `THREE.LineSegments` from the merged
 *      positions (rebuilt only when the mesh rebuilds — never per-frame) and
 *      maps a Three.js Line raycast hit back to its source polyline via the
 *      per-segment parallel {@link MergedEdgeGeometry.segmentEdgeIndex}
 *      ({@link edgeIndexForSegmentVertex}).
 *
 *   2. **The screen-space hit test** ({@link pickEdgeAtPoint}). Projects every
 *      polyline segment through the ACTIVE camera (perspective OR orthographic
 *      — the math is the raw view-projection matrix, exactly like
 *      `selection-box.computeBoxSelectedFaceIds`) into viewport CSS px and
 *      returns the NEAREST edge whose point-to-segment distance is within a
 *      few-px threshold. PRECEDENCE contract: the caller (the solid's click
 *      handler) runs this BEFORE the face resolution — an edge within the
 *      threshold wins over the face behind it; a miss leaves face picking
 *      exactly as before.
 *
 *   3. **Occlusion honesty.** A body click knows the face raycast hit's depth;
 *      passing it as `occluderNdcZ` (via {@link ndcZOfWorldPoint}) rejects
 *      edges that are BEHIND the clicked surface (a hidden back edge must
 *      never steal the pick from the face in front of it). A small NDC epsilon
 *      keeps front edges — which lie ON the clicked surface — pickable.
 *
 *   4. **Highlight buffers** ({@link buildEdgeHighlightPositions}) — the
 *      segment positions of a SET of edges (hover / selected), concatenated so
 *      one overlay `LineSegments` draws them all.
 *
 * HONEST LIMITATIONS (stated, not hidden):
 *   - The depth compare interpolates NDC z linearly along the segment — exact
 *     for ortho, approximate under perspective; fine at pick-epsilon scale.
 *   - `lineBasicMaterial` renders 1-px lines on Windows/ANGLE regardless of
 *     `linewidth`, so "selected = thicker" is approximated with the bright
 *     accent color + depth-test-off overlay instead of true width.
 *
 * Consumed by `Viewport3D` (render + click/hover) and the edge-pick tests.
 */

import * as THREE from 'three'
import type { PickableEdge } from './viewport3d-geometry'

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Screen-space grab band (CSS px). A click whose distance to the nearest
 * edge's projected segments is within this many px picks the EDGE (precedence
 * over the face behind it); beyond it, face picking behaves exactly as before.
 * A few px — forgiving enough to grab a 1-px line, tight enough that face
 * picks away from edges are untouched.
 */
export const EDGE_PICK_THRESHOLD_PX = 6

/**
 * NDC-z tolerance for the occluder test. Edges lie exactly ON the solid's
 * surface, so a front edge's depth ≈ the clicked face's depth — the epsilon
 * keeps those pickable while still rejecting genuinely hidden back edges
 * (whose NDC z is substantially farther).
 */
export const EDGE_PICK_DEPTH_EPS_NDC = 0.02

// ── Merged geometry (one LineSegments for every edge) ───────────────────────

/**
 * All pickable edges merged into ONE segment-endpoint buffer + the parallel
 * per-SEGMENT map back to the source polyline. `segmentEdgeIndex[s]` is the
 * index into the source `edges` array of the polyline that contributed
 * segment `s` (segment `s` = vertices `2s` and `2s+1`).
 */
export interface MergedEdgeGeometry {
  /** Flat `[x0,y0,z0, x1,y1,z1, ...]` — 6 floats per segment. */
  readonly positions: Float32Array
  /** Per-segment index into the source `edges` array. */
  readonly segmentEdgeIndex: readonly number[]
}

/**
 * Merge every {@link PickableEdge}'s pre-built segment buffer into one
 * geometry-ready buffer (see {@link MergedEdgeGeometry}). Returns `null` when
 * there are no usable edges so the caller can skip mounting the overlay.
 * Defensive: an edge whose `positions` length is not a multiple of 6 (not
 * whole segments) is skipped rather than corrupting the segment map. Pure.
 */
export function mergePickableEdges(
  edges: readonly PickableEdge[] | null | undefined
): MergedEdgeGeometry | null {
  if (!Array.isArray(edges) || edges.length === 0) return null
  let totalFloats = 0
  for (const edge of edges) {
    const len = edge?.positions?.length ?? 0
    if (len >= 6 && len % 6 === 0) totalFloats += len
  }
  if (totalFloats === 0) return null
  const positions = new Float32Array(totalFloats)
  const segmentEdgeIndex: number[] = []
  let cursor = 0
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const len = edge?.positions?.length ?? 0
    if (len < 6 || len % 6 !== 0) continue
    positions.set(edge.positions, cursor)
    const segmentCount = len / 6
    for (let s = 0; s < segmentCount; s++) segmentEdgeIndex.push(i)
    cursor += len
  }
  return { positions, segmentEdgeIndex }
}

/**
 * Map a Three.js `LineSegments` raycast intersection `index` (the FIRST
 * vertex index of the hit segment) back to the source-edge index via the
 * merged geometry's per-segment map. Returns `null` on a missing / negative /
 * out-of-range index so a malformed hit can never fabricate an edge. Pure.
 */
export function edgeIndexForSegmentVertex(
  vertexIndex: number | null | undefined,
  segmentEdgeIndex: readonly number[]
): number | null {
  if (vertexIndex === null || vertexIndex === undefined) return null
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0) return null
  const segment = Math.floor(vertexIndex / 2)
  if (segment >= segmentEdgeIndex.length) return null
  const edgeIndex = segmentEdgeIndex[segment]
  return Number.isInteger(edgeIndex) && edgeIndex >= 0 ? edgeIndex : null
}

// ── Screen-space projection helpers ─────────────────────────────────────────

/** Convert an R3F NDC pointer (`event.pointer`, y-up) to viewport CSS px. */
export function ndcToPx(
  ndc: { readonly x: number; readonly y: number },
  viewportPx: { readonly width: number; readonly height: number }
): { x: number; y: number } {
  return {
    x: (ndc.x + 1) * 0.5 * viewportPx.width,
    y: (1 - ndc.y) * 0.5 * viewportPx.height
  }
}

/**
 * NDC z of a world-space point through `camera` (both projections), or `null`
 * when the point is behind the camera (clip w <= 0). Used to derive the
 * `occluderNdcZ` for {@link pickEdgeAtPoint} from the face raycast hit point.
 * `camera.matrixWorld` must be current (the R3F loop keeps it so; tests call
 * `updateMatrixWorld()`).
 */
export function ndcZOfWorldPoint(
  camera: THREE.Camera,
  point: { readonly x: number; readonly y: number; readonly z: number }
): number | null {
  const viewMatrix = new THREE.Matrix4().copy(camera.matrixWorld).invert()
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, viewMatrix)
  const e = vp.elements
  const { x, y, z } = point
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
  if (cw <= 0) return null
  return (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw
}

// ── The hit test ────────────────────────────────────────────────────────────

/** A successful screen-space edge pick. */
export interface EdgePickHit {
  /** The winning pickable edge (stable id + signature ride along). */
  readonly edge: PickableEdge
  /** Screen-space distance (CSS px) from the click to the edge. */
  readonly distancePx: number
}

export interface EdgePickOptions {
  /** Grab band in CSS px; defaults to {@link EDGE_PICK_THRESHOLD_PX}. */
  readonly thresholdPx?: number
  /**
   * NDC z of the clicked surface point (from {@link ndcZOfWorldPoint}). When
   * finite, candidate edges whose depth at the closest point exceeds
   * `occluderNdcZ + EDGE_PICK_DEPTH_EPS_NDC` are rejected — a hidden back
   * edge never steals the pick from the face in front of it. Omit / pass
   * `null` for off-body clicks (silhouette picks have no occluding face).
   */
  readonly occluderNdcZ?: number | null
}

/**
 * Which edge (if any) does a click at `pointPx` pick? Projects every segment
 * of every polyline through `camera` into viewport CSS px (perspective OR
 * orthographic — identical raw view-projection path) and returns the nearest
 * edge whose 2D point-to-segment distance is within the threshold, subject to
 * the occluder depth gate (see {@link EdgePickOptions.occluderNdcZ}).
 *
 * Contract details:
 *   - segments with an endpoint behind the camera (clip w <= 0) are skipped —
 *     a perspective wrap-around can never fabricate a hit;
 *   - the closest point's interpolated NDC z must be inside the near/far clip
 *     range `[-1, 1]`;
 *   - a degenerate viewport (zero width/height) picks nothing;
 *   - ties resolve to the smallest distance; equal distances keep the FIRST
 *     edge encountered (deterministic — source order).
 *
 * Runs once per CLICK (and per hover pointer-move over the edge overlay) over
 * the polylines' sampled segments — linear, bounded by the sidecar's total
 * edge-point budget, comfortably inside frame budget. Pure.
 */
export function pickEdgeAtPoint(
  edges: readonly PickableEdge[] | null | undefined,
  camera: THREE.Camera,
  pointPx: { readonly x: number; readonly y: number },
  viewportPx: { readonly width: number; readonly height: number },
  options?: EdgePickOptions
): EdgePickHit | null {
  if (!Array.isArray(edges) || edges.length === 0) return null
  if (!(viewportPx.width > 0) || !(viewportPx.height > 0)) return null
  const thresholdPx = options?.thresholdPx ?? EDGE_PICK_THRESHOLD_PX
  if (!(thresholdPx > 0)) return null
  const occluderNdcZ =
    options?.occluderNdcZ !== null &&
    options?.occluderNdcZ !== undefined &&
    Number.isFinite(options.occluderNdcZ)
      ? options.occluderNdcZ
      : null

  const viewMatrix = new THREE.Matrix4().copy(camera.matrixWorld).invert()
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, viewMatrix)
  const e = vp.elements

  /** Project a world xyz to { sx, sy (CSS px), z (NDC) }, or null behind camera. */
  const project = (x: number, y: number, z: number): { sx: number; sy: number; z: number } | null => {
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
    if (cw <= 0) return null
    const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
    const ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
    const ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw
    return {
      sx: (ndcX + 1) * 0.5 * viewportPx.width,
      sy: (1 - ndcY) * 0.5 * viewportPx.height,
      z: ndcZ
    }
  }

  let best: EdgePickHit | null = null
  for (const edge of edges) {
    const pos = edge?.positions
    if (!pos || pos.length < 6 || pos.length % 6 !== 0) continue
    for (let i = 0; i + 5 < pos.length; i += 6) {
      const a = project(pos[i], pos[i + 1], pos[i + 2])
      if (a === null) continue
      const b = project(pos[i + 3], pos[i + 4], pos[i + 5])
      if (b === null) continue
      // 2D point-to-segment distance in CSS px.
      const dx = b.sx - a.sx
      const dy = b.sy - a.sy
      const lenSq = dx * dx + dy * dy
      const t =
        lenSq > 0
          ? Math.max(0, Math.min(1, ((pointPx.x - a.sx) * dx + (pointPx.y - a.sy) * dy) / lenSq))
          : 0
      const cx = a.sx + t * dx
      const cy = a.sy + t * dy
      const dist = Math.hypot(pointPx.x - cx, pointPx.y - cy)
      if (dist > thresholdPx) continue
      // Depth gates: inside the clip range, and not behind the occluding face.
      const zAtClosest = a.z + t * (b.z - a.z)
      if (zAtClosest < -1 || zAtClosest > 1) continue
      if (occluderNdcZ !== null && zAtClosest > occluderNdcZ + EDGE_PICK_DEPTH_EPS_NDC) continue
      if (best === null || dist < best.distancePx) {
        best = { edge, distancePx: dist }
      }
    }
  }
  return best
}

// ── Highlight buffers ───────────────────────────────────────────────────────

/**
 * Concatenate the segment positions of every pickable edge whose `edgeId` is
 * in `edgeIds` — the buffer behind the hover / selected overlay
 * `LineSegments`. Returns an empty array when nothing matches (the caller
 * skips mounting the overlay). Pure.
 */
export function buildEdgeHighlightPositions(
  edges: readonly PickableEdge[] | null | undefined,
  edgeIds: readonly number[] | null | undefined
): Float32Array {
  if (!Array.isArray(edges) || edges.length === 0) return new Float32Array(0)
  if (!Array.isArray(edgeIds) || edgeIds.length === 0) return new Float32Array(0)
  const wanted = new Set<number>()
  for (const id of edgeIds) {
    if (typeof id === 'number' && Number.isInteger(id) && id >= 0) wanted.add(id)
  }
  if (wanted.size === 0) return new Float32Array(0)
  let totalFloats = 0
  for (const edge of edges) {
    if (wanted.has(edge.edgeId) && edge.positions.length % 6 === 0) {
      totalFloats += edge.positions.length
    }
  }
  if (totalFloats === 0) return new Float32Array(0)
  const out = new Float32Array(totalFloats)
  let cursor = 0
  for (const edge of edges) {
    if (!wanted.has(edge.edgeId) || edge.positions.length % 6 !== 0) continue
    out.set(edge.positions, cursor)
    cursor += edge.positions.length
  }
  return out
}
