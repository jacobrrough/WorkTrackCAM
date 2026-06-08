/**
 * viewport3d-geometry — pure builder that turns the sidecar's
 * selection-grade tessellation (`cad.tessellate_with_ids`) into a
 * Three.js `BufferGeometry` ready to hand to {@link Viewport3D}.
 *
 * Why a dedicated module (FG-2, mount the real Viewport3D):
 *   - `DesignWorkspace` holds the `CadTessellateWithIdsResult` in
 *     `selectionTessellation` (flat `vertices` / `indices` / `faceIds`
 *     arrays — see `sidecar-protocol.ts`). The viewport's `geometry`
 *     prop wants a `THREE.BufferGeometry` whose `userData.faceIds`
 *     parallel array drives face-pick (`Viewport3D.readGeometryFaceIds`).
 *   - Keeping the heavy/validating conversion in a pure, framework-light
 *     helper means it is unit-testable in the project's `node` vitest
 *     environment (no jsdom / WebGL) and keeps the 1.1k-line
 *     `DesignWorkspace.tsx` focused on orchestration.
 *
 * Contract:
 *   - Returns `null` when there is no usable triangle data (missing
 *     result, empty vertices, vertices length not divisible by 3, or no
 *     indices) so the caller can fall back to the empty-state surface
 *     instead of mounting an empty WebGL canvas.
 *   - Stashes a sanitized `faceIds` array on `geometry.userData.faceIds`
 *     ONLY when every entry is a finite integer AND the array length
 *     matches the triangle count (`indices.length / 3`). This mirrors
 *     the defensive read in `Viewport3D.readGeometryFaceIds` — a
 *     malformed / mismatched array silently disables face-pick rather
 *     than throwing.
 *   - Computes vertex normals so the shaded material lights correctly
 *     (the sidecar ships positions + indices only).
 *
 * No `any` types; the only Three.js objects created are the
 * `BufferGeometry` + its attributes.
 */

import * as THREE from 'three'
import type { CadTessellateWithIdsResult } from '../../shared/sidecar-protocol'

/**
 * Validate a candidate `faceIds` array against the triangle count.
 * Returns the array as a plain `number[]` when every entry is a finite
 * integer AND its length equals `triangleCount`; otherwise `null`.
 *
 * Pure — exported for the focused unit test.
 */
export function sanitizeFaceIds(
  faceIds: readonly number[] | null | undefined,
  triangleCount: number,
): number[] | null {
  if (!Array.isArray(faceIds)) return null
  if (faceIds.length !== triangleCount) return null
  for (const id of faceIds) {
    if (typeof id !== 'number' || !Number.isFinite(id) || !Number.isInteger(id)) {
      return null
    }
  }
  return faceIds.slice()
}

/**
 * Build a `THREE.BufferGeometry` from a selection-grade tessellation, or
 * `null` when the payload carries no usable triangle data.
 *
 * The returned geometry:
 *   - has an indexed `position` attribute (`Float32`),
 *   - has computed vertex normals,
 *   - carries a sanitized `userData.faceIds` array when the sidecar
 *     provided a valid one (enables {@link Viewport3D} face-pick).
 */
export function buildViewportGeometry(
  tess: CadTessellateWithIdsResult | null | undefined,
): THREE.BufferGeometry | null {
  if (!tess) return null
  const { vertices, indices } = tess
  if (!Array.isArray(vertices) || vertices.length < 9) return null
  if (vertices.length % 3 !== 0) return null
  if (!Array.isArray(indices) || indices.length < 3) return null
  if (indices.length % 3 !== 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(vertices), 3),
  )
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const triangleCount = indices.length / 3
  const sanitized = sanitizeFaceIds(tess.faceIds, triangleCount)
  if (sanitized) {
    geometry.userData = { ...geometry.userData, faceIds: sanitized }
  }

  return geometry
}
