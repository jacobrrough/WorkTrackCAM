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
 * The renderer's `AssemblyPart` carries NO real geometry size (only a transform),
 * so the scene draws each part as a fixed nominal cube — the SAME stand-in
 * `assembly-render-seam` uses for the bbox interference check, keeping the drawn
 * box and the clash heuristic consistent. {@link FALLBACK_BOX_HALF_EXTENT_MM}
 * mirrors that module's `NOMINAL_HALF_EXTENT_MM`.
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
  /** Half-extents (mm) of the drawn box — always the nominal cube today. */
  readonly halfExtentsMm: readonly [number, number, number]
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
 */
export function computePartRenderStates(
  parts: readonly AssemblyViewportPart[],
  opts: {
    readonly playbackOverlay?: ReadonlyMap<string, MotionPoseTransform> | null
    readonly explode?: ExplodeConfig | null
    readonly clashIds?: ReadonlySet<string> | null
    readonly selectedId?: string | null
  }
): PartRenderState[] {
  const clashIds = opts.clashIds ?? new Set<string>()
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
    out.push({
      id: part.id,
      name: part.name,
      matrix: poseToMatrix(position, pose.rotationDeg),
      colorRole: resolveColorRole({ clashing, selected, grounded }),
      grounded,
      clashing,
      selected,
      fromPlayback: pose.fromPlayback,
      halfExtentsMm: [
        FALLBACK_BOX_HALF_EXTENT_MM,
        FALLBACK_BOX_HALF_EXTENT_MM,
        FALLBACK_BOX_HALF_EXTENT_MM
      ]
    })
  })
  return out
}
