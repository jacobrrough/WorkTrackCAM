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
 *   - FG-5b: ALSO stashes a parallel `faceOcctIds` string array
 *     (`geometry.userData.faceOcctIds[i]` is the STABLE `"f:<hex>"`
 *     handle of triangle `i`, looked up from `tess.faceMap[faceId].occtId`).
 *     This is the value a face pick carries up as `FaceSelection.occtHash`
 *     and the value `shell_inward.pickedFaceIds` resolves at build. Only
 *     stashed when the numeric `faceIds` stash succeeded AND every face id
 *     has an `occtId` in the `faceMap` — a partial map disables the stable
 *     id path (the pick degrades to id-only, exactly like before FG-5b).
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
 * FG-5b · Build the per-triangle STABLE face-id array from a sanitized numeric
 * `faceIds` array + the sidecar's `faceMap`. `out[i]` is the `"f:<hex>"` handle
 * of triangle `i` (looked up via `faceMap[String(faceIds[i])].occtId`).
 *
 * Returns `null` when ANY triangle's face id has no `occtId` in the map (e.g.
 * a face that failed mid-tessellation carries no `occtId`, or the assembly
 * faceMap path that doesn't emit it yet) — an all-or-nothing contract so the
 * viewport never carries a half-populated stable-id stash that would silently
 * drop the picked-id path for some faces. Pure; exported for the focused unit
 * test.
 */
export function buildFaceOcctIds(
  faceIds: readonly number[],
  faceMap: CadTessellateWithIdsResult['faceMap'] | undefined,
): string[] | null {
  if (!faceMap || typeof faceMap !== 'object') return null
  const out: string[] = new Array(faceIds.length)
  for (let i = 0; i < faceIds.length; i++) {
    const entry = faceMap[String(faceIds[i])]
    const occtId = entry?.occtId
    if (typeof occtId !== 'string' || occtId.length === 0) return null
    out[i] = occtId
  }
  return out
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
    // FG-5b: stash the parallel STABLE `"f:<hex>"` ids so a face pick can
    // carry the value `shell_inward.pickedFaceIds` resolves at build. Only
    // when EVERY face id maps to an occtId (all-or-nothing — see helper).
    const faceOcctIds = buildFaceOcctIds(sanitized, tess.faceMap)
    if (faceOcctIds) {
      geometry.userData = { ...geometry.userData, faceOcctIds }
    }
  }

  return geometry
}
