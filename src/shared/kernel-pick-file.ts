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
import type { CadEdgePolyline, CadTessellateWithIdsResult } from './sidecar-protocol'

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
