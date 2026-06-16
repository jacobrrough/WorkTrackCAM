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
import {
  applyPickPlacementToTessellation,
  type KernelPickFile,
} from '../../shared/kernel-pick-file'
import type {
  CadEdgePolyline,
  CadEdgeSignature,
  CadFaceSignature,
  CadTessellateWithIdsResult,
} from '../../shared/sidecar-protocol'

/**
 * FG-5 · A renderer-ready pickable edge: the stable edge id + handle plus a flat
 * `Float32Array` of segment endpoints (`[x0,y0,z0, x1,y1,z1, ...]`) ready to feed
 * a `THREE.LineSegments` geometry. {@link Viewport3D} renders one selectable line
 * object per entry and raycasts a near-edge click back to `edgeId` / `occtId`.
 *
 * `edgeId` is the 0-based ordinal in the source `edges` list (the `EdgeSelection`
 * numeric `faceId`); `occtId` is the STABLE `"e:<hex>"` handle the Fillet /
 * Chamfer dialogs forward to the kernel as `pickedEdgeIds`.
 *
 * Tier-2 · `signature` is the OPTIONAL geometry-invariant edge signature
 * (`edgeMap[occtId].signature`) carried alongside the stable id so an edge pick
 * can be recovered by `resolvePickedId` after a parametric MOVE / UNIFORM RESIZE
 * (when the absolute-hash `occtId` no longer matches). Absent on legacy /
 * pre-Tier-2 tessellations — the pick then resolves at Tier 1 only. This mirrors
 * the FACE path, which already threads `faceMap[id].signature` per triangle.
 */
export type PickableEdge = {
  readonly edgeId: number
  readonly occtId: string
  readonly positions: Float32Array
  readonly signature?: CadEdgeSignature
}

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
 * Tier-2 · Build the per-triangle geometry-invariant FACE signature array from a
 * sanitized numeric `faceIds` array + the sidecar's `faceMap`. `out[i]` is the
 * `signature` of triangle `i`'s face (`faceMap[String(faceIds[i])].signature`),
 * or `undefined` when that face carries none (back-compat / failed face).
 *
 * Returns `null` (no stash) when NO triangle has a signature — so a pre-Tier-2
 * tessellation never carries an all-`undefined` array. Unlike
 * {@link buildFaceOcctIds} this is NOT all-or-nothing: a partial map is fine
 * because a face pick that lands on a signature-less triangle simply captures no
 * signature (the resolver then has only Tier-1 for that pick). Pure; exported
 * for the focused unit test.
 */
export function buildFaceSignatures(
  faceIds: readonly number[],
  faceMap: CadTessellateWithIdsResult['faceMap'] | undefined,
): Array<CadFaceSignature | undefined> | null {
  if (!faceMap || typeof faceMap !== 'object') return null
  const out: Array<CadFaceSignature | undefined> = new Array(faceIds.length)
  let any = false
  for (let i = 0; i < faceIds.length; i++) {
    const sig = faceMap[String(faceIds[i])]?.signature
    out[i] = sig
    if (sig !== undefined) any = true
  }
  return any ? out : null
}

/**
 * FG-5 · Turn the sidecar's per-edge polylines into {@link PickableEdge}s the
 * viewport can render + raycast. Each polyline becomes a flat segment-endpoint
 * buffer (`p0→p1, p1→p2, …`) so a single `THREE.LineSegments` traces the whole
 * edge. The `edgeId` is the polyline's ordinal (the `EdgeSelection.faceId`); the
 * `occtId` is its stable `"e:<hex>"` handle (forwarded to the kernel as
 * `pickedEdgeIds`).
 *
 * Tier-2 · When the parallel `edgeMap` is supplied, the polyline's stable id is
 * looked up in it (`edgeMap[occtId].signature`) and the geometry-invariant edge
 * signature is attached to the {@link PickableEdge}, so an edge pick captures the
 * value `resolvePickedId` recovers a moved/resized pick with. Best-effort: a
 * polyline with no matching map entry (or a map entry with no signature) simply
 * carries no signature — the pick then resolves at Tier 1 only (back-compat).
 *
 * Defensive: drops any polyline with fewer than 2 well-formed `[x,y,z]` points so
 * a malformed entry can't produce a degenerate (un-pickable) line. Returns `[]`
 * when there are no usable edges. Pure; exported for the focused unit test.
 */
export function buildPickableEdges(
  edges: readonly CadEdgePolyline[] | null | undefined,
  edgeMap?: CadTessellateWithIdsResult['edgeMap'] | null,
): PickableEdge[] {
  if (!Array.isArray(edges) || edges.length === 0) return []
  const map = edgeMap && typeof edgeMap === 'object' ? edgeMap : null
  const out: PickableEdge[] = []
  for (let edgeId = 0; edgeId < edges.length; edgeId++) {
    const poly = edges[edgeId]
    if (!poly || typeof poly.id !== 'string' || poly.id.length === 0) continue
    const pts = poly.points
    if (!Array.isArray(pts) || pts.length < 2) continue
    // Validate every point is a finite [x,y,z] triple before building the buffer.
    let ok = true
    for (const p of pts) {
      if (
        !Array.isArray(p) ||
        p.length !== 3 ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        !Number.isFinite(p[2])
      ) {
        ok = false
        break
      }
    }
    if (!ok) continue
    // (pts.length - 1) segments × 2 endpoints × 3 floats.
    const positions = new Float32Array((pts.length - 1) * 6)
    let cursor = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      positions[cursor++] = a[0]; positions[cursor++] = a[1]; positions[cursor++] = a[2]
      positions[cursor++] = b[0]; positions[cursor++] = b[1]; positions[cursor++] = b[2]
    }
    // Tier-2: attach the edge's geometry-invariant signature when the map carries
    // one (keyed by the same stable id). Build up so we never carry an
    // `undefined` key on the entry (matches the makeFaceSelection no-stray-key
    // contract). The edgeMap is keyed by the stable id; prefer the entry's own
    // occtId but the key equals it by contract.
    const sig = map ? map[poly.id]?.signature : undefined
    const base: PickableEdge = { edgeId, occtId: poly.id, positions }
    out.push(sig !== undefined ? { ...base, signature: sig } : base)
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
 *   - FG-5: carries a `userData.pickableEdges` array (from
 *     {@link buildPickableEdges}) when the sidecar emitted edge polylines, so
 *     the viewport can render + raycast selectable edges for fillet/chamfer.
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
      // Tier-2: stash the parallel geometry-invariant signatures so a face pick
      // captures the value `resolvePickedId` recovers a moved/resized pick with.
      // Best-effort (partial map ok) — only stashed alongside the occtId stash
      // (a signature without a stable id has no Tier-1 anchor to fall back from).
      const faceSignatures = buildFaceSignatures(sanitized, tess.faceMap)
      if (faceSignatures) {
        geometry.userData = { ...geometry.userData, faceSignatures }
      }
    }
  }

  // FG-5: stash the pickable edge polylines so the viewport can render +
  // raycast selectable edges (edge-mode fillet/chamfer). Independent of the
  // faceIds stash above — edges are emitted even when face-pick is degraded.
  // Tier-2: pass the edgeMap so each pickable edge carries its geometry-invariant
  // signature (for move/resize recovery), mirroring the per-triangle face stash.
  const pickableEdges = buildPickableEdges(tess.edges, tess.edgeMap)
  if (pickableEdges.length > 0) {
    geometry.userData = { ...geometry.userData, pickableEdges }
  }

  return geometry
}

/**
 * task_f76b39b3 · Build a PICKABLE viewport geometry for the NO-CODE body from
 * the persisted kernel pick file (`output/kernel-part.pick.json`).
 *
 * The tessellation's stable ids were hashed on build_part.py's PRE-placement
 * body — the exact space its `fillet_select`/`chamfer_select`/`shell_inward`
 * ops resolve `picked*Ids` against — so a pick taken from this geometry
 * round-trips to the same OCCT edge/face at the next build. The DISPLAYED
 * vertices/edge polylines are moved into world space (where the exported STL
 * lives) by the recorded placement basis; the ids stay pre-placement.
 *
 * Returns `null` for an unusable file — the caller falls back to the untagged
 * STL parse (display works; picking stays honestly off).
 */
export function buildKernelPickGeometry(
  pick: KernelPickFile | null | undefined,
): THREE.BufferGeometry | null {
  if (!pick) return null
  return buildViewportGeometry(
    applyPickPlacementToTessellation(pick.tessellation, pick.placement),
  )
}

/**
 * FG-5 · Read the `pickableEdges` stash off a geometry's `userData`, or `null`
 * when absent (legacy / no-edge tessellation). Defensive — mirrors
 * {@link readGeometryFaceIds} so the viewport short-circuits cleanly when no
 * edges are present. Pure; exported for the focused unit test.
 */
export function readGeometryPickableEdges(
  geometry: THREE.BufferGeometry | null | undefined,
): readonly PickableEdge[] | null {
  if (!geometry || !geometry.userData) return null
  const candidate = (geometry.userData as Record<string, unknown>).pickableEdges
  if (!Array.isArray(candidate) || candidate.length === 0) return null
  return candidate as readonly PickableEdge[]
}
