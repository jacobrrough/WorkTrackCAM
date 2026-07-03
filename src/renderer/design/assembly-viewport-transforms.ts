/**
 * assembly-viewport-transforms — PURE per-part render-state math for the
 * {@link AssemblyViewport3D} R3F scene.
 *
 * The 3D viewport draws one mesh (or, when a part's live geometry is not
 * available, an honest labelled bounding BOX) per non-suppressed part, placed by
 * the part's 6-DOF pose. This module answers, without any React / Three-Fiber /
 * DOM / WebGL, "where does each part sit, what colour role does it carry, and is
 * it grounded / selected / clashing?" so every branch is deterministically pinned
 * in the node-env vitest pool (the R3F Canvas itself never mounts there — mirror
 * of `Viewport3D.test.ts`, which unit-tests only the pure exports).
 *
 * Load-bearing contracts consumed by the scene:
 *   - PLAYBACK OVERRIDE PRECEDENCE — when a motion-study playback overlay carries
 *     a pose for a part, that pose OVERRIDES the part's own transform (the
 *     wave-2 overlay contract: `playbackOverlay: ReadonlyMap<partId, pose>` is the
 *     viewport's transform source while a study is scrubbing/playing). The overlay
 *     is view-layer only — nothing here writes back into the parts list.
 *   - EXPLODE — a view-only factor (0..1) separates parts along the configured
 *     axis by `activeRowIndex * stepMm * factor`, reusing the shared
 *     {@link explodeOffsetMm} so the offset math lives in ONE place (the same
 *     helper the durable `explodeView` metadata drives). The index is the part's
 *     position among the ACTIVE (rendered) parts, so a suppressed part never
 *     leaves a gap in the spread.
 *   - INTERFERENCE TINT — the ids in the interference report's clashing pairs are
 *     tinted with the error role so the bbox clash check finally becomes VISIBLE
 *     in 3D (mirrors the parts-list `--clash` row highlight).
 *
 * ── Per-part geometry tiers (wave-7 "real meshes") ────────────────────────────
 * The renderer's `AssemblyPart` still carries only a transform. The REAL geometry
 * for a part is threaded in separately, keyed by part id, as an optional
 * {@link PartGeometryDescriptor} map (the caller — the AssemblyView host — builds
 * it; this module never reaches for IPC). Each part resolves to one of THREE tiers,
 * honestly reported on its render state (`renderTier`):
 *
 *   (a) `'mesh'`  — an actual triangle mesh (positions + optional indices) captured
 *                   for a same-session part. Rendered as a real BufferGeometry.
 *   (b) `'bbox'`  — a true axis-aligned bounding box (half-extents + optional center
 *                   offset) recovered from the part's stored geometry bbox. The box
 *                   at least has REAL proportions and sits where the geometry sits.
 *   (c) `'nominal'`— no descriptor: the honest last-resort {@link FALLBACK_BOX_HALF_EXTENT_MM}
 *                   cube, the SAME stand-in `assembly-render-seam` uses for the bbox
 *                   interference check (a visible overlap lines up with a reported clash).
 *
 * PERFORMANCE GUARD — a total triangle budget ({@link DEFAULT_TRIANGLE_BUDGET})
 * caps how many mesh-tier triangles the scene draws. Parts whose triangles would
 * push the running total past the budget DEGRADE to their bbox tier (never a silent
 * cap — the degraded parts count toward the HUD's honest "N of M parts schematic").
 *
 * TIER-INDEPENDENT TRANSFORM — the placement `matrix` (pose ∘ explode) is computed
 * IDENTICALLY for every tier; the tier only changes WHAT is drawn at that matrix,
 * never WHERE. A bbox/mesh's own center offset rides the render state's geometry
 * (local space), not the placement matrix, so explode / playback / interference /
 * selection behave the same across tiers (pinned in the tests).
 */

import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

import type { MotionPoseTransform } from './assembly-motion-playback'
import { explodeOffsetMm } from '../../shared/assembly-viewport-math'
import type { AssemblyExplodeViewMetadata } from '../../shared/assembly-schema'

/** World axis the explode spread runs along (matches the schema's `explodeView.axis`). */
export type AssemblyExplodeAxis = AssemblyExplodeViewMetadata['axis']

/**
 * Half-extent (mm) of the stand-in box drawn for a part whose real geometry is
 * unavailable renderer-side. Deliberately equal to `assembly-render-seam`'s
 * `NOMINAL_HALF_EXTENT_MM` so the DRAWN box and the bbox-interference stand-in
 * are the same size (a visible clash lines up with a reported one). Kept as a
 * local const rather than an import so this pure module has no dependency on the
 * seam's engine chain.
 */
export const FALLBACK_BOX_HALF_EXTENT_MM = 10

/**
 * Default cap (triangles) on the total mesh-tier geometry the scene draws before
 * parts DEGRADE to their bbox tier. A conservative budget that keeps orbit
 * interactive on integrated GPUs; the caller may override via
 * `computePartRenderStates`'s `triangleBudget`. Degradation is never silent — a
 * degraded part is reported as bbox-tier and counted in the HUD's schematic count.
 */
export const DEFAULT_TRIANGLE_BUDGET = 200_000

/**
 * The render tier a part resolved to, in preference order. Reported on every
 * {@link PartRenderState} so the scene draws the right primitive and the HUD can
 * honestly count how many parts are schematic (bbox + nominal) vs. real meshes.
 *   - `'mesh'`    — a real triangle mesh (tier a).
 *   - `'bbox'`    — a true-proportion bounding box (tier b).
 *   - `'nominal'` — the last-resort nominal cube (tier c).
 */
export type PartRenderTier = 'mesh' | 'bbox' | 'nominal'

/**
 * A captured triangle mesh for a same-session part (tier a). `positions` is a flat
 * XYZ array (length divisible by 3); `indices`, when present, is a flat triangle
 * index buffer (length divisible by 3). `triangleCount` is authoritative for the
 * budget accounting (indexed: `indices.length / 3`; non-indexed: `positions.length / 9`).
 * `halfExtentsMm` + `centerOffsetMm` describe the mesh's own AABB (local space) so
 * the tier-b degrade path and the interference stand-in agree on proportions.
 */
export type PartMeshGeometry = {
  readonly kind: 'mesh'
  readonly positions: ArrayLike<number>
  readonly indices?: ArrayLike<number>
  /** Optional flat vertex-normal array (parallel to `positions`); computed when absent. */
  readonly normals?: ArrayLike<number>
  readonly triangleCount: number
  /** Half-extents (mm) of the mesh AABB — for the tier-b degrade + HUD proportions. */
  readonly halfExtentsMm: readonly [number, number, number]
  /** Center of the mesh AABB in the part's LOCAL frame (mm); origin when absent. */
  readonly centerOffsetMm?: readonly [number, number, number]
}

/**
 * A true axis-aligned bounding box for a part (tier b), recovered from the part's
 * stored geometry bbox. Gives the drawn box REAL proportions (and its real center
 * offset from the placement origin) without any mesh data.
 */
export type PartBboxGeometry = {
  readonly kind: 'bbox'
  readonly halfExtentsMm: readonly [number, number, number]
  /** Center of the bbox in the part's LOCAL frame (mm); origin when absent. */
  readonly centerOffsetMm?: readonly [number, number, number]
}

/** Per-part geometry descriptor: a real mesh (tier a) or a true bbox (tier b). */
export type PartGeometryDescriptor = PartMeshGeometry | PartBboxGeometry

/**
 * The geometry a part's render state carries after tier resolution. Either a real
 * mesh reference (drawn as a BufferGeometry) or a box (drawn as the shared unit
 * box scaled to `halfExtentsMm`). `centerOffsetMm` is the geometry's own center in
 * LOCAL space — applied inside the drawn primitive, NOT the placement matrix, so
 * the transform pipeline stays tier-independent.
 */
export type ResolvedPartGeometry =
  | {
      readonly tier: 'mesh'
      readonly mesh: PartMeshGeometry
      readonly halfExtentsMm: readonly [number, number, number]
      readonly centerOffsetMm: readonly [number, number, number]
    }
  | {
      readonly tier: 'bbox' | 'nominal'
      readonly halfExtentsMm: readonly [number, number, number]
      readonly centerOffsetMm: readonly [number, number, number]
    }

/** Half-extents (mm) of the nominal fallback cube — all three axes equal. */
const NOMINAL_HALF_EXTENTS: readonly [number, number, number] = [
  FALLBACK_BOX_HALF_EXTENT_MM,
  FALLBACK_BOX_HALF_EXTENT_MM,
  FALLBACK_BOX_HALF_EXTENT_MM
]

const ZERO_OFFSET: readonly [number, number, number] = [0, 0, 0]

/** Non-negative finite triangle count, or 0 when the descriptor's count is bad. */
function triCount(mesh: PartMeshGeometry): number {
  const n = mesh.triangleCount
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.floor(n)
  // Derive from the buffers when the count is missing/bad: indexed → indices/3,
  // else positions/9. Defensive — a real descriptor always carries triangleCount.
  const idx = mesh.indices?.length
  if (typeof idx === 'number' && idx >= 3) return Math.floor(idx / 3)
  const pos = mesh.positions?.length
  if (typeof pos === 'number' && pos >= 9) return Math.floor(pos / 9)
  return 0
}

/** Sanitize a half-extents triple: each axis finite + strictly positive, else the nominal. */
function sanitizeHalfExtents(
  h: readonly [number, number, number] | undefined
): readonly [number, number, number] {
  if (!h) return NOMINAL_HALF_EXTENTS
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const v = h[i]
    out[i] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : FALLBACK_BOX_HALF_EXTENT_MM
  }
  return out
}

/** Sanitize a center-offset triple: each axis finite, else 0. */
function sanitizeOffset(
  c: readonly [number, number, number] | undefined
): readonly [number, number, number] {
  if (!c) return ZERO_OFFSET
  return [finite(c[0]), finite(c[1]), finite(c[2])]
}

/**
 * The subset of the renderer's `AssemblyPart` this module needs. Declared locally
 * (structurally compatible with `AssemblyView`'s `AssemblyPart`) so the pure math
 * imports neither the component nor its heavy type graph. A row with a blank
 * `handle` (hydrated-from-disk, geometry not in memory) still renders — as the
 * fallback box — so a reloaded assembly is never a silent blank.
 */
export type AssemblyViewportPart = {
  readonly id: string
  readonly name: string
  readonly handle?: string
  readonly grounded?: boolean
  readonly transform?: {
    readonly position?: readonly [number, number, number]
    readonly rotation?: readonly [number, number, number]
  }
}

/** Explode configuration for the viewport (view-only; never persisted from here). */
export type ExplodeConfig = {
  readonly axis: AssemblyExplodeAxis
  readonly stepMm: number
  /** 0 = assembled (no separation), 1 = fully separated. Clamped internally. */
  readonly factor: number
}

/**
 * The colour ROLE a part's box carries, resolved by precedence. The component
 * maps each role to a concrete design token so the palette lives in ONE place
 * (the component) while the precedence lives here (pure + testable).
 *
 * Precedence (highest first): clash > selected > grounded > default. A clash is
 * the most urgent signal (a real geometry mistake), so it wins even over
 * selection; selection wins over the subtle grounded tint.
 */
export type PartColorRole = 'clash' | 'selected' | 'grounded' | 'default'

/** Fully-resolved render state for one part's box in the scene. */
export type PartRenderState = {
  readonly id: string
  readonly name: string
  /** Column-major 4×4 world matrix (position ∘ rotation ∘ explode-offset). */
  readonly matrix: Matrix4
  /** Colour role after precedence resolution. */
  readonly colorRole: PartColorRole
  /** True when the part is grounded (fixed in space) — the subtle distinct tint. */
  readonly grounded: boolean
  /** True when the part participates in a reported interference pair. */
  readonly clashing: boolean
  /** True when the part is the selected row (row ↔ viewport highlight sync). */
  readonly selected: boolean
  /**
   * True when the box came from the playback overlay's pose (a motion study is
   * scrubbing/playing this part) rather than the part's own transform. Lets the
   * scene optionally annotate animated parts; the box position is identical
   * either way.
   */
  readonly fromPlayback: boolean
  /**
   * Half-extents (mm) of the drawn box. For a bbox / nominal tier this is the box
   * itself; for a mesh tier it is the mesh's AABB half-extents (kept for callers
   * that still reason about extents, e.g. framing). The nominal cube uses
   * {@link FALLBACK_BOX_HALF_EXTENT_MM} on all three axes.
   */
  readonly halfExtentsMm: readonly [number, number, number]
  /**
   * The render tier this part resolved to: `'mesh'` (real triangles), `'bbox'`
   * (true-proportion box), or `'nominal'` (last-resort cube). The scene draws the
   * matching primitive; the HUD counts `'bbox'` + `'nominal'` as schematic.
   */
  readonly renderTier: PartRenderTier
  /**
   * The resolved geometry to draw at {@link matrix}: a mesh ref (tier a) or a box
   * (tiers b/c). `centerOffsetMm` is the geometry's own center in LOCAL space —
   * applied INSIDE the drawn primitive, never folded into `matrix`, so the pose /
   * explode / playback pipeline is identical across tiers.
   */
  readonly geometry: ResolvedPartGeometry
}

/** Aggregate tier counts across a render-state list — the HUD's honest schematic tally. */
export type RenderTierSummary = {
  readonly total: number
  readonly mesh: number
  readonly bbox: number
  readonly nominal: number
  /** `bbox + nominal` — the parts drawn as boxes, not real meshes. */
  readonly schematic: number
}

/**
 * Tally the tiers across resolved render states. `schematic = bbox + nominal` is
 * the count the HUD surfaces as "N of M parts schematic" (honest degradation
 * reporting — a budget-degraded mesh part lands in `bbox`, so it is counted).
 */
export function summarizeRenderTiers(
  states: readonly PartRenderState[]
): RenderTierSummary {
  let mesh = 0
  let bbox = 0
  let nominal = 0
  for (const s of states) {
    if (s.renderTier === 'mesh') mesh++
    else if (s.renderTier === 'bbox') bbox++
    else nominal++
  }
  return { total: states.length, mesh, bbox, nominal, schematic: bbox + nominal }
}

/** A finite number, or `0` when the value is missing / NaN / ±Infinity. */
function finite(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Compose a world matrix from a position (mm) + Euler rotation (degrees, applied
 * ZYX to match the solver / interference / viewport-math convention everywhere
 * else in the assembly stack). Pure — a fresh {@link Matrix4} each call.
 *
 * `THREE.Euler`'s `'ZYX'` order composes R = Rz·Ry·Rx (intrinsic), the same
 * rotation `assembly-interference.transformPoint` and `assembly-solver-core`
 * apply, so a part drawn here lands exactly where a clash / solve places it.
 */
export function poseToMatrix(
  position: readonly [number, number, number],
  rotationDeg: readonly [number, number, number]
): Matrix4 {
  const pos = new Vector3(finite(position[0]), finite(position[1]), finite(position[2]))
  const euler = new Euler(
    (finite(rotationDeg[0]) * Math.PI) / 180,
    (finite(rotationDeg[1]) * Math.PI) / 180,
    (finite(rotationDeg[2]) * Math.PI) / 180,
    'ZYX'
  )
  const quat = new Quaternion().setFromEuler(euler)
  const scale = new Vector3(1, 1, 1)
  return new Matrix4().compose(pos, quat, scale)
}

/**
 * The pose a part renders at, applying the playback-override contract: when the
 * overlay carries a pose for this id it WINS over the part's own transform;
 * otherwise the part's stored transform (identity when absent) is used.
 * Returns the position + Euler-degrees plus whether the overlay supplied it.
 */
export function resolvePartPose(
  part: AssemblyViewportPart,
  playbackOverlay: ReadonlyMap<string, MotionPoseTransform> | null | undefined
): {
  position: [number, number, number]
  rotationDeg: [number, number, number]
  fromPlayback: boolean
} {
  const override = playbackOverlay?.get(part.id)
  if (override) {
    return {
      position: [finite(override.x), finite(override.y), finite(override.z)],
      rotationDeg: [finite(override.rxDeg), finite(override.ryDeg), finite(override.rzDeg)],
      fromPlayback: true
    }
  }
  const pos = part.transform?.position
  const rot = part.transform?.rotation
  return {
    position: [finite(pos?.[0]), finite(pos?.[1]), finite(pos?.[2])],
    rotationDeg: [finite(rot?.[0]), finite(rot?.[1]), finite(rot?.[2])],
    fromPlayback: false
  }
}

/**
 * The additive explode translation (mm) for the part at `activeRowIndex` among
 * the rendered parts. Thin wrapper over the shared {@link explodeOffsetMm} so the
 * offset formula (`index * stepMm * clamp01(factor)`) lives once. A zero / absent
 * factor yields `[0,0,0]` (assembled), so explode is inert until the operator
 * drives the slider.
 */
export function explodeTranslationMm(
  explode: ExplodeConfig | null | undefined,
  activeRowIndex: number
): [number, number, number] {
  if (!explode) return [0, 0, 0]
  const step = finite(explode.stepMm)
  if (step <= 0) return [0, 0, 0]
  return explodeOffsetMm(explode.axis, step, activeRowIndex, finite(explode.factor))
}

/**
 * The set of part ids that participate in at least one clashing pair — the ids
 * whose boxes get the error tint. Accepts the report shape structurally (only
 * `clashingPairs` with `aId` / `bId`) so it works with the seam's
 * `InterferenceReport` without importing it.
 */
export function interferenceTintIds(
  report:
    | { readonly clashingPairs: ReadonlyArray<{ readonly aId: string; readonly bId: string }> }
    | null
    | undefined
): ReadonlySet<string> {
  const ids = new Set<string>()
  if (!report) return ids
  for (const pair of report.clashingPairs) {
    ids.add(pair.aId)
    ids.add(pair.bId)
  }
  return ids
}

/**
 * Resolve the colour role for a part by the documented precedence:
 * clash > selected > grounded > default.
 */
export function resolveColorRole(opts: {
  clashing: boolean
  selected: boolean
  grounded: boolean
}): PartColorRole {
  if (opts.clashing) return 'clash'
  if (opts.selected) return 'selected'
  if (opts.grounded) return 'grounded'
  return 'default'
}

/**
 * Resolve one part's render geometry by tier, honoring a triangle budget.
 *
 * Tier order of preference: mesh (a) → bbox (b) → nominal (c). A mesh-tier
 * descriptor is accepted ONLY when its triangles fit in the remaining budget;
 * otherwise it DEGRADES to its own bbox proportions (tier b) — never silently
 * dropped, never silently capped. A bbox descriptor is tier b directly; no
 * descriptor is the nominal cube (tier c).
 *
 * `remainingBudget` is the triangles still available; the return's `consumed` is
 * how many this part used (0 for box tiers) so the caller can decrement the budget.
 * Pure — no allocation of GPU geometry here (that is the component's job); this
 * only decides WHAT tier + WHICH extents/offset to draw.
 */
export function resolvePartGeometry(
  descriptor: PartGeometryDescriptor | null | undefined,
  remainingBudget: number
): { geometry: ResolvedPartGeometry; consumed: number } {
  if (descriptor && descriptor.kind === 'mesh') {
    const tris = triCount(descriptor)
    const half = sanitizeHalfExtents(descriptor.halfExtentsMm)
    const center = sanitizeOffset(descriptor.centerOffsetMm)
    // Accept the mesh only when it fits the remaining budget. A single mesh that
    // ALONE exceeds the whole budget still degrades (honest) rather than blowing
    // the guard — the part then draws as its true-proportion bbox.
    if (tris > 0 && tris <= remainingBudget) {
      return {
        geometry: { tier: 'mesh', mesh: descriptor, halfExtentsMm: half, centerOffsetMm: center },
        consumed: tris
      }
    }
    // Budget exceeded (or a degenerate 0-triangle mesh) → degrade to bbox tier.
    return { geometry: { tier: 'bbox', halfExtentsMm: half, centerOffsetMm: center }, consumed: 0 }
  }
  if (descriptor && descriptor.kind === 'bbox') {
    return {
      geometry: {
        tier: 'bbox',
        halfExtentsMm: sanitizeHalfExtents(descriptor.halfExtentsMm),
        centerOffsetMm: sanitizeOffset(descriptor.centerOffsetMm)
      },
      consumed: 0
    }
  }
  // No descriptor → the honest last-resort nominal cube.
  return {
    geometry: { tier: 'nominal', halfExtentsMm: NOMINAL_HALF_EXTENTS, centerOffsetMm: ZERO_OFFSET },
    consumed: 0
  }
}

/**
 * Build the fully-resolved render state for every part the scene should draw.
 *
 * Ordering + indexing: the input order is preserved; the explode `activeRowIndex`
 * is the part's position in THIS list (the rendered parts), so the spread is even
 * and gap-free. Callers pass only the parts that should render (suppressed parts
 * filtered out upstream) — this keeps the index honest.
 *
 * Precedence recap per part: the box pose is the playback override when present
 * else the part transform; the explode offset is ADDED to that pose's position
 * (explode separates the assembled/animated layout, it does not replace it); the
 * colour role is clash > selected > grounded > default.
 *
 * GEOMETRY TIER — when `opts.descriptors` carries a descriptor for a part id, the
 * part resolves to its mesh (a) or bbox (b) tier via {@link resolvePartGeometry};
 * a triangle budget (`opts.triangleBudget`, default {@link DEFAULT_TRIANGLE_BUDGET})
 * degrades mesh parts to bbox once the running total would overflow. Parts are
 * consumed IN ORDER, so the budget is deterministic. The `matrix` is computed
 * IDENTICALLY regardless of tier — the tier only sets `geometry` + `renderTier`.
 */
export function computePartRenderStates(
  parts: readonly AssemblyViewportPart[],
  opts: {
    readonly playbackOverlay?: ReadonlyMap<string, MotionPoseTransform> | null
    readonly explode?: ExplodeConfig | null
    readonly clashIds?: ReadonlySet<string> | null
    readonly selectedId?: string | null
    /** Per-part real geometry descriptors, keyed by part id. Omit → all nominal. */
    readonly descriptors?: ReadonlyMap<string, PartGeometryDescriptor> | null
    /** Total mesh-tier triangle budget before parts degrade to bbox. Default 200k. */
    readonly triangleBudget?: number
  }
): PartRenderState[] {
  const clashIds = opts.clashIds ?? new Set<string>()
  const descriptors = opts.descriptors ?? null
  const budgetRaw = opts.triangleBudget
  let remainingBudget =
    typeof budgetRaw === 'number' && Number.isFinite(budgetRaw) && budgetRaw >= 0
      ? Math.floor(budgetRaw)
      : DEFAULT_TRIANGLE_BUDGET
  const out: PartRenderState[] = []
  parts.forEach((part, index) => {
    const pose = resolvePartPose(part, opts.playbackOverlay)
    const [ex, ey, ez] = explodeTranslationMm(opts.explode, index)
    const position: [number, number, number] = [
      pose.position[0] + ex,
      pose.position[1] + ey,
      pose.position[2] + ez
    ]
    const grounded = part.grounded === true
    const clashing = clashIds.has(part.id)
    const selected = opts.selectedId != null && opts.selectedId === part.id
    const descriptor = descriptors?.get(part.id) ?? null
    const resolved = resolvePartGeometry(descriptor, remainingBudget)
    remainingBudget -= resolved.consumed
    out.push({
      id: part.id,
      name: part.name,
      matrix: poseToMatrix(position, pose.rotationDeg),
      colorRole: resolveColorRole({ clashing, selected, grounded }),
      grounded,
      clashing,
      selected,
      fromPlayback: pose.fromPlayback,
      halfExtentsMm: resolved.geometry.halfExtentsMm,
      renderTier: resolved.geometry.tier,
      geometry: resolved.geometry
    })
  })
  return out
}
