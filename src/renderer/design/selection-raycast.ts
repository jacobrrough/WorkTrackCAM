/**
 * Pure raycast → face ID mapping helper (CAD V1, Workflow H).
 *
 * Why a separate module from `Viewport3D.tsx`?
 *
 *   The component layer is `node`-environment-hostile: `@react-three/fiber`'s
 *   `Canvas` reaches for `window`, `requestAnimationFrame`, and a WebGL
 *   context the JSDOM-free vitest pool cannot provide. By isolating the
 *   triangle-index → faceId lookup into a tiny pure function, the test
 *   pin can validate the mapping without spinning up Three.js / R3F.
 *
 * Contract:
 *   - Input: a triangle index (Three.js `Intersection.faceIndex`) and a
 *     parallel array of face IDs, one per triangle in the BufferGeometry.
 *   - Output: the face ID at that triangle index, or `null` when:
 *       (a) the triangle index is out of range,
 *       (b) the faceIds array is missing,
 *       (c) the value at that index is not a finite integer.
 *
 * Why "one face ID per triangle" instead of one per face?
 *   - The CadQuery tessellator emits a flat triangle stream. Multiple
 *     triangles belong to the same face — the parallel array maps each
 *     triangle to its parent face. The renderer asks "given the triangle
 *     I clicked, which CadQuery face does it belong to?"
 *   - Future optimization: a run-length-encoded faceIds array (since
 *     consecutive triangles often share a face). For now, the flat
 *     array matches what the sidecar's `tessellate_with_ids` handler
 *     will emit.
 */

/**
 * Map a Three.js `Intersection.faceIndex` (triangle index) to the
 * CadQuery face ID. Returns `null` when the mapping is undefined.
 *
 * Pure — no DOM, no Three.js, no React. Safe to call in any environment.
 */
export function triangleToFaceId(
  triangleIndex: number | undefined | null,
  faceIds: readonly number[] | null | undefined,
): number | null {
  if (typeof triangleIndex !== 'number' || !Number.isFinite(triangleIndex)) {
    return null
  }
  if (triangleIndex < 0 || !Number.isInteger(triangleIndex)) {
    return null
  }
  if (!faceIds || !Array.isArray(faceIds)) {
    return null
  }
  if (triangleIndex >= faceIds.length) {
    return null
  }
  const candidate = faceIds[triangleIndex]
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || !Number.isInteger(candidate)) {
    return null
  }
  return candidate
}

/**
 * Build a set of triangle indices that belong to a given face ID.
 *
 * Used by `Viewport3D` to construct the wire-outline overlay: once we
 * know which face the user clicked, we need every triangle of that face
 * so the overlay can render edges along the face boundary.
 *
 * Returns an empty array when:
 *   - the faceIds array is missing,
 *   - the requested faceId never appears in the array.
 */
export function trianglesForFace(
  faceId: number,
  faceIds: readonly number[] | null | undefined,
): readonly number[] {
  if (!faceIds || !Array.isArray(faceIds)) return []
  if (typeof faceId !== 'number' || !Number.isFinite(faceId)) return []
  const out: number[] = []
  for (let i = 0; i < faceIds.length; i++) {
    if (faceIds[i] === faceId) out.push(i)
  }
  return out
}

/**
 * WINDOW/BOX SELECT (Phase 2) — build the triangle-index list for a SET of
 * face ids in ONE linear pass over the parallel array (vs. N calls to
 * `trianglesForFace`), preserving ascending triangle order so the highlight
 * overlay's buffer layout matches the single-face path exactly.
 *
 * Returns an empty array when:
 *   - the faceIds stash is missing (legacy tessellation),
 *   - the wanted list is empty or holds no finite ids,
 *   - no wanted face appears in the stash.
 *
 * Pure — no Three.js, no DOM. Safe in any environment.
 */
export function trianglesForFaces(
  faceIdsWanted: readonly number[],
  faceIds: readonly number[] | null | undefined,
): readonly number[] {
  if (!faceIds || !Array.isArray(faceIds)) return []
  if (!Array.isArray(faceIdsWanted) || faceIdsWanted.length === 0) return []
  const wanted = new Set<number>()
  for (const id of faceIdsWanted) {
    if (typeof id === 'number' && Number.isFinite(id)) wanted.add(id)
  }
  if (wanted.size === 0) return []
  const out: number[] = []
  for (let i = 0; i < faceIds.length; i++) {
    if (wanted.has(faceIds[i])) out.push(i)
  }
  return out
}
