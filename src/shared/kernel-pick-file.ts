/**
 * Kernel pick-tessellation file — the cross-path picked-edge/face bridge
 * (task_f76b39b3).
 *
 * `engines/occt/build_part.py` emits `pickTessellation` (a face-tagged
 * tessellation of the PRE-placement no-code body — the exact coordinate space
 * its `fillet_select` / `chamfer_select` / `shell_inward` ops resolve picked
 * stable ids against) plus `pickPlacement` (the canonical→world basis the
 * exported STL was moved by). `build-kernel-part.ts` persists the pair to
 * `output/kernel-part.pick.json` so the renderer can rebuild a PICKABLE
 * viewport mesh for the no-code body on any later project open — a pick taken
 * from it round-trips to the exact OCCT edge/face at the next build because
 * the ids were hashed on the very body the ops re-resolve against.
 *
 * The DISPLAYED mesh must land in WORLD space (where the exported STL lives),
 * so {@link applyPickPlacementToTessellation} maps the pre-placement vertices /
 * edge polylines through the basis: `world = u·x + v·y + n·z + origin`
 * (column-basis multiply — mirrors `_placement_basis` in build_part.py and
 * `sketchPreviewPlacementMatrix` in the renderer preview; datum XY maps
 * canonical (x, y, z) → world (x, z, −y)). The STABLE ids are deliberately NOT
 * transformed — they stay pre-placement, exactly what the build resolver hashes.
 *
 * Pure module: no THREE, no fs, no IPC — usable from main (write-side
 * validation) and renderer (read side) and node-env tests alike.
 */
import type {
  CadEdgePolyline,
  CadEdgeSignature,
  CadFaceSignature,
  CadTessellateWithIdsResult,
} from './sidecar-protocol'

/** Canonical→world placement basis as emitted by build_part.py (`pickPlacement`). */
export interface KernelPickPlacement {
  readonly u: readonly [number, number, number]
  readonly v: readonly [number, number, number]
  readonly n: readonly [number, number, number]
  readonly origin: readonly [number, number, number]
}

/** On-disk shape of `output/kernel-part.pick.json`. */
export interface KernelPickFile {
  readonly tessellation: CadTessellateWithIdsResult
  /** `null` when build_part applied no placement (canonical == world). */
  readonly placement: KernelPickPlacement | null
}

function isFiniteTriple(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => typeof c === 'number' && Number.isFinite(c))
  )
}

function coercePlacement(raw: unknown): KernelPickPlacement | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isFiniteTriple(o.u) || !isFiniteTriple(o.v) || !isFiniteTriple(o.n) || !isFiniteTriple(o.origin)) {
    return null
  }
  return { u: o.u, v: o.v, n: o.n, origin: o.origin }
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'number' && Number.isFinite(x))
}

function coerceEdges(raw: unknown): CadEdgePolyline[] {
  if (!Array.isArray(raw)) return []
  const out: CadEdgePolyline[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id.length === 0) continue
    const pts = e.points
    if (!Array.isArray(pts) || pts.length < 2) continue
    let ok = true
    for (const p of pts) {
      if (!isFiniteNumberArray(p) || p.length !== 3) {
        ok = false
        break
      }
    }
    if (!ok) continue
    out.push({ id: e.id, points: pts as Array<[number, number, number]> })
  }
  return out
}

/**
 * Structurally validate a parsed `kernel-part.pick.json` (or the raw
 * `{ pickTessellation, pickPlacement }` pair off the build_part result).
 * Returns `null` for anything that can't safely drive the viewport — the
 * caller then falls back to the untagged STL (display still works; picking
 * stays honestly off). Deep numeric re-validation of vertices/faceIds happens
 * again in `buildViewportGeometry`; this gate covers shape + finiteness of the
 * load-bearing arrays.
 */
export function coerceKernelPickFile(raw: unknown): KernelPickFile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const t = o.tessellation
  if (!t || typeof t !== 'object') return null
  const tess = t as Record<string, unknown>
  if (!isFiniteNumberArray(tess.vertices) || tess.vertices.length < 9 || tess.vertices.length % 3 !== 0) {
    return null
  }
  if (!isFiniteNumberArray(tess.indices) || tess.indices.length < 3 || tess.indices.length % 3 !== 0) {
    return null
  }
  const triangleCount = tess.indices.length / 3
  const faceIds = isFiniteNumberArray(tess.faceIds) && tess.faceIds.length === triangleCount ? tess.faceIds : []
  const faceMap = tess.faceMap && typeof tess.faceMap === 'object' ? (tess.faceMap as CadTessellateWithIdsResult['faceMap']) : {}
  const edgeMap = tess.edgeMap && typeof tess.edgeMap === 'object' ? (tess.edgeMap as CadTessellateWithIdsResult['edgeMap']) : {}
  const bboxRaw = tess.bbox as { min?: unknown; max?: unknown } | undefined
  const bbox: { min: [number, number, number]; max: [number, number, number] } =
    bboxRaw && isFiniteTriple(bboxRaw.min) && isFiniteTriple(bboxRaw.max)
      ? { min: [...bboxRaw.min], max: [...bboxRaw.max] }
      : { min: [0, 0, 0], max: [0, 0, 0] }
  // A MISSING/null placement is legitimate (canonical == world, identity). A
  // placement that is PRESENT but malformed rejects the whole file — displaying
  // the mesh in the wrong space would be worse than the untagged-STL fallback.
  const placementRaw = o.placement ?? null
  let placement: KernelPickPlacement | null = null
  if (placementRaw !== null) {
    placement = coercePlacement(placementRaw)
    if (!placement) return null
  }
  return {
    tessellation: {
      vertices: tess.vertices,
      indices: tess.indices,
      faceIds,
      triangleCount,
      bbox,
      faceMap,
      edgeMap,
      edges: coerceEdges(tess.edges)
    },
    placement
  }
}

function transformPoint(
  p: readonly [number, number, number],
  m: KernelPickPlacement
): [number, number, number] {
  const [x, y, z] = p
  return [
    m.u[0] * x + m.v[0] * y + m.n[0] * z + m.origin[0],
    m.u[1] * x + m.v[1] * y + m.n[1] * z + m.origin[1],
    m.u[2] * x + m.v[2] * y + m.n[2] * z + m.origin[2]
  ]
}

/**
 * Move a pre-placement pick tessellation into world space (where build_part's
 * exported STL lives) so the renderer can DISPLAY it in the right place while
 * its stable ids stay pre-placement (what the build resolver hashes).
 * Identity (same reference) when `placement` is `null`. Pure — never mutates.
 */
export function applyPickPlacementToTessellation(
  tess: CadTessellateWithIdsResult,
  placement: KernelPickPlacement | null
): CadTessellateWithIdsResult {
  if (!placement) return tess
  const vertices: number[] = new Array(tess.vertices.length)
  for (let i = 0; i + 2 < tess.vertices.length; i += 3) {
    const [wx, wy, wz] = transformPoint(
      [tess.vertices[i]!, tess.vertices[i + 1]!, tess.vertices[i + 2]!],
      placement
    )
    vertices[i] = wx
    vertices[i + 1] = wy
    vertices[i + 2] = wz
  }
  const edges = tess.edges.map((e) => ({
    id: e.id,
    points: e.points.map((p) => transformPoint(p, placement))
  }))
  // Transform all 8 bbox corners and re-take the axis-aligned min/max (a
  // rotated box's AABB is not the rotation of the original min/max pair).
  const [x0, y0, z0] = tess.bbox.min
  const [x1, y1, z1] = tess.bbox.max
  const corners: Array<[number, number, number]> = []
  for (const cx of [x0!, x1!]) {
    for (const cy of [y0!, y1!]) {
      for (const cz of [z0!, z1!]) {
        corners.push(transformPoint([cx, cy, cz], placement))
      }
    }
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const c of corners) {
    for (let a = 0 as 0 | 1 | 2; a < 3; a++) {
      if (c[a] < min[a]) min[a] = c[a]
      if (c[a] > max[a]) max[a] = c[a]
    }
  }
  return { ...tess, vertices, edges, bbox: { min, max } }
}

// ── Tiered picked-id resolution (topological-naming robustness) ─────────────
//
// THE PROBLEM. A persisted pick (a filleted edge, a shelled face) carries the
// Tier-1 stable id (``"e:<hex>"`` / ``"f:<hex>"``) — an ABSOLUTE-geometry FNV
// hash. That hash is byte-identical for a same-geometry rebuild, so the pick
// round-trips perfectly when nothing changed. But the instant an UPSTREAM
// parametric edit MOVES or UNIFORMLY RESIZES the body, the absolute coordinates
// change → the edge/face hashes to a NEW id → the stored id matches nothing →
// the kernel silently drops the pick to the axis-bucket fallback (and the
// operator's carefully-picked fillet jumps to "all +Z edges"). This resolver is
// the additive layer that recovers that pick.
//
// THE TIERS (this mirrors the Python build-side resolver so a pick resolves the
// same way whether the renderer previews it or the kernel rebuilds it):
//   * TIER 1 — exact ``occtId`` hit. Unchanged, zero-cost, byte-identical to
//              today. A same-geometry rebuild always resolves here.
//   * TIER 2 — geometry-INVARIANT signature match. When Tier 1 misses, compare
//              the stored {@link CadFaceSignature}/{@link CadEdgeSignature}
//              against every candidate of the same entity-kind in the CURRENT
//              build. Pick the entity whose signature is EXACTLY equal — but
//              ONLY when that match is UNIQUE. A tie (two candidates with the
//              same signature) or no match fails to Tier 3; we never guess the
//              wrong topology (the kernel is sacred — Safety Rule 1/5).
//   * TIER 3 — honest miss. The caller falls back to the axis bucket exactly as
//              before and surfaces the loss honestly (the existing
//              ``pickableGeometryActive`` / honest-off pattern).
//
// HONEST SCOPE. Tier 2 recovers a uniform MOVE / UNIFORM RESIZE only — the
// signature is rank/class/octant based relative to the body principal frame, so
// those transforms leave it invariant. A topology-changing edit (face
// split/merge, an added feature renumbering neighbours), a non-uniform / partial
// resize, or anything needing real OCC lineage tracking is OUT OF SCOPE and
// resolves honestly to Tier 3, not a wrong guess.

/** The entity kind a stored pick targets. */
export type PickEntityKind = 'face' | 'edge'

/**
 * A persisted pick to resolve against a fresh build: the Tier-1 stable id that
 * was stored on the op (``pickedEdgeIds`` / ``pickedFaceIds``) plus the optional
 * Tier-2 signature captured at pick time. ``signature`` is optional because a
 * pick recorded before the Tier-2 layer existed carries only the id — such a
 * pick still resolves at Tier 1 and degrades honestly past it (back-compat).
 */
export type StoredPick =
  | { readonly kind: 'face'; readonly id: string; readonly signature?: CadFaceSignature }
  | { readonly kind: 'edge'; readonly id: string; readonly signature?: CadEdgeSignature }

/**
 * Outcome of {@link resolvePickedId}. ``tier`` records HOW the pick resolved so
 * the UI can be honest about it (an exact hit vs a recovered-by-signature hit vs
 * a genuine loss):
 *   * ``{ ok: true, tier: 1, id }`` — exact Tier-1 id hit (resolved id == stored id).
 *   * ``{ ok: true, tier: 2, id }`` — unique Tier-2 signature recovery; ``id`` is
 *     the CURRENT build's id for that entity (which DIFFERS from the stored id —
 *     this is the value the caller should now target / re-persist).
 *   * ``{ ok: false, reason }``     — Tier-3 honest miss (no exact id, and the
 *     signature match was absent / not unique).
 */
export type PickResolution =
  | { readonly ok: true; readonly tier: 1 | 2; readonly id: string }
  | { readonly ok: false; readonly reason: PickLostReason }

/** Why a pick failed to resolve (drives the honest UI copy). */
export type PickLostReason =
  | 'no-current-geometry' // the current build exposes no pickable id index
  | 'no-tier1-no-signature' // Tier 1 missed and the stored pick carried no signature
  | 'no-signature-match' // Tier 1 missed; the signature matched nothing in the build
  | 'ambiguous-signature' // Tier 1 missed; the signature matched 2+ candidates (tie → no guess)

/**
 * A pre-built, kind-separated index of the CURRENT build's pickable entities,
 * keyed by stable id → signature. Built ONCE from a
 * {@link CadTessellateWithIdsResult} ({@link buildPickIndex}) so resolving many
 * stored picks against the same build is cheap. A signature value of
 * ``undefined`` means the entity exists (Tier 1 can hit it) but the emitter did
 * not attach a Tier-2 signature (Tier 2 can't recover it) — kept distinct from
 * "id absent" so the resolver can be precise about WHY a pick was lost.
 */
export interface CurrentPickIndex {
  readonly faces: ReadonlyMap<string, CadFaceSignature | undefined>
  readonly edges: ReadonlyMap<string, CadEdgeSignature | undefined>
}

/**
 * Build a {@link CurrentPickIndex} from the current build's selection
 * tessellation. Reads ``faceMap`` (id = ``occtId``) + ``edgeMap`` (id = the map
 * key) and stashes each entity's optional ``signature``. Pure; tolerant of a
 * ``null`` / malformed tessellation (returns an empty index — the resolver then
 * reports ``no-current-geometry``).
 */
export function buildPickIndex(
  tess: CadTessellateWithIdsResult | null | undefined,
): CurrentPickIndex {
  const faces = new Map<string, CadFaceSignature | undefined>()
  const edges = new Map<string, CadEdgeSignature | undefined>()
  if (!tess || typeof tess !== 'object') return { faces, edges }

  const faceMap = tess.faceMap
  if (faceMap && typeof faceMap === 'object') {
    for (const entry of Object.values(faceMap)) {
      // A face's STABLE id is its ``occtId`` (NOT the numeric faceMap key, which
      // is a per-build ordinal). Skip entries that carry no stable id (e.g. a
      // face that failed mid-tessellation) — they were never pickable by id.
      const id = entry?.occtId
      if (typeof id !== 'string' || id.length === 0) continue
      // First write wins: a duplicate stable id (two coincident faces) keeps the
      // first signature, matching the build resolver applying to all matches.
      if (!faces.has(id)) faces.set(id, entry.signature)
    }
  }

  const edgeMap = tess.edgeMap
  if (edgeMap && typeof edgeMap === 'object') {
    for (const [key, entry] of Object.entries(edgeMap)) {
      // The edgeMap is keyed by the stable id; prefer the entry's own occtId but
      // fall back to the key (they are equal by contract).
      const id = typeof entry?.occtId === 'string' && entry.occtId.length > 0 ? entry.occtId : key
      if (typeof id !== 'string' || id.length === 0) continue
      if (!edges.has(id)) edges.set(id, entry?.signature)
    }
  }

  return { faces, edges }
}

/**
 * Two FACE signatures are equal when EVERY invariant field matches. Used for the
 * Tier-2 uniqueness test. Strict field equality (not a fuzzy distance) because
 * each field is already a discretized class/rank/octant — a fuzzy compare would
 * risk matching the wrong face, and a wrong cut is never acceptable.
 */
export function faceSignaturesEqual(a: CadFaceSignature, b: CadFaceSignature): boolean {
  return (
    a.kind === b.kind &&
    a.adjacentFaceCount === b.adjacentFaceCount &&
    a.normalClass === b.normalClass &&
    a.areaRank === b.areaRank &&
    a.centroidOctant === b.centroidOctant
  )
}

/** Two EDGE signatures are equal when every invariant field matches (see {@link faceSignaturesEqual}). */
export function edgeSignaturesEqual(a: CadEdgeSignature, b: CadEdgeSignature): boolean {
  return (
    a.kind === b.kind &&
    a.lengthRank === b.lengthRank &&
    a.midpointOctant === b.midpointOctant &&
    a.incidentFaceKinds === b.incidentFaceKinds
  )
}

/**
 * Find the UNIQUE id in ``candidates`` whose signature equals ``wanted``.
 * Returns the id on a unique match, ``'ambiguous'`` on a tie (2+ equal), or
 * ``null`` when nothing matched. Shared by the face/edge Tier-2 paths.
 */
function uniqueSignatureMatch<S>(
  candidates: ReadonlyMap<string, S | undefined>,
  wanted: S,
  equals: (a: S, b: S) => boolean,
): string | 'ambiguous' | null {
  let found: string | null = null
  for (const [id, sig] of candidates) {
    if (sig === undefined) continue
    if (!equals(sig, wanted)) continue
    if (found !== null) return 'ambiguous' // a second match → tie → refuse to guess
    found = id
  }
  return found
}

/**
 * THE TIERED RESOLVER. Resolve a {@link StoredPick} against a {@link CurrentPickIndex}
 * built from the current build (see {@link buildPickIndex}).
 *
 *   1. TIER 1 — if the stored id is present in the current build, return it
 *      ({@link PickResolution} ``tier: 1``). Byte-identical to today's behaviour
 *      for a same-geometry rebuild.
 *   2. TIER 2 — else, if the stored pick carries a signature, find the UNIQUE
 *      current-build entity (of the same kind) with an equal signature and
 *      return ITS id (``tier: 2``). A tie or no-match does NOT guess.
 *   3. TIER 3 — else return ``{ ok: false, reason }`` so the caller falls back to
 *      the axis bucket and surfaces the loss honestly.
 *
 * Pure; never throws. Note the Tier-2 id DIFFERS from the stored id (the entity
 * moved/resized), so a caller that re-persists should write the returned id.
 */
export function resolvePickedId(stored: StoredPick, current: CurrentPickIndex): PickResolution {
  const pool = stored.kind === 'face' ? current.faces : current.edges
  if (pool.size === 0) return { ok: false, reason: 'no-current-geometry' }

  // TIER 1 — exact stable-id hit. ``has`` (not the value) because a present id
  // with an undefined signature is still a valid Tier-1 resolution.
  if (typeof stored.id === 'string' && stored.id.length > 0 && pool.has(stored.id)) {
    return { ok: true, tier: 1, id: stored.id }
  }

  // TIER 2 — unique geometry-invariant signature recovery.
  if (stored.signature === undefined) {
    return { ok: false, reason: 'no-tier1-no-signature' }
  }
  const match =
    stored.kind === 'face'
      ? uniqueSignatureMatch(current.faces, stored.signature, faceSignaturesEqual)
      : uniqueSignatureMatch(current.edges, stored.signature, edgeSignaturesEqual)

  if (match === 'ambiguous') return { ok: false, reason: 'ambiguous-signature' }
  if (match === null) return { ok: false, reason: 'no-signature-match' }
  return { ok: true, tier: 2, id: match }
}

/**
 * Convenience: resolve a stored pick straight against a current build's
 * tessellation (builds the index internally). Prefer {@link buildPickIndex} +
 * {@link resolvePickedId} when resolving MANY picks against the SAME build (build
 * the index once); use this one-shot helper for a single pick. Pure.
 */
export function resolvePickedIdAgainstTessellation(
  stored: StoredPick,
  tess: CadTessellateWithIdsResult | null | undefined,
): PickResolution {
  return resolvePickedId(stored, buildPickIndex(tess))
}

/**
 * Honest one-line operator copy for a {@link PickLostReason}. Centralized so the
 * dialogs / status surfaces all describe a lost pick the same way (and so the
 * "topological-naming limit" framing stays consistent + non-overclaiming).
 */
export function pickLostMessage(reason: PickLostReason): string {
  switch (reason) {
    case 'no-current-geometry':
      return 'No rebuilt geometry to match the pick against yet — using the axis bucket.'
    case 'no-tier1-no-signature':
      return 'The picked entity moved or was resized and carries no recovery signature — falling back to the axis bucket.'
    case 'no-signature-match':
      return 'The picked entity could not be re-identified after the edit (topological-naming limit) — falling back to the axis bucket.'
    case 'ambiguous-signature':
      return 'The picked entity is ambiguous after the edit (two candidates match) — falling back to the axis bucket rather than risk the wrong one.'
  }
}
