/**
 * Per-part **geometry dimensions** for an assembly part.
 *
 * Background: the assembly interference detector (`assembly-interference.ts`) runs
 * a conservative bounding-box **broad phase** and exposes an injectable
 * **narrow-phase** seam, but the narrow phase needs real per-part geometry to
 * refine a broad-phase overlap. Until now an `AssemblyComponent`
 * (`assembly-schema.ts`) carried only a placement `transform` and an optional
 * `meshPath` — no inline dimensions — so the narrow phase had nothing to consume
 * inside the shared (pure) layer.
 *
 * This module adds a small, **additive + optional** schema fragment that captures
 * a part's tight axis-aligned bounding box in its OWN local frame
 * (`geometryDimensions`). It is intentionally:
 *   - **optional** — legacy saved projects (no `geometryDimensions` on a row) still
 *     parse unchanged (Safety Rule 2: schema changes must not break old projects);
 *   - **decoupled** — declared here, not bolted onto `assemblyComponentSchema`, so
 *     this wave does not touch the (separately-owned) persisted component schema.
 *     A follow-up cycle can `.merge()` / spread this fragment into the component
 *     schema once the hydration path that fills it (sidecar tessellation → dims) is
 *     wired (that bridge is owned elsewhere this wave — see the seam note below).
 *
 * The box is stored as `aabbMin` / `aabbMax` tuples (mm), matching the
 * `LocalAabb` shape consumed by `assembly-interference.ts`'s `worldAabbOf`.
 *
 * ## Seam left for a follow-up
 * Nothing in this wave POPULATES `geometryDimensions` from real geometry — the
 * sidecar `tessellate_with_ids` → per-part dims hydration is owned by another
 * agent. Consumers that already hold dims (e.g. a hydrated assembly model) can feed
 * them into the narrow phase today via {@link assemblyPartLocalAabb} +
 * `detectInterferencesWithDims` in `assembly-interference.ts`. When no dims are
 * present the interference result stays byte-identical to the pure bbox path.
 *
 * Pure module: no React, no DOM, no IPC. Just zod + types.
 */

import { z } from 'zod'

/** A finite `[x, y, z]` coordinate tuple (mm). */
const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

/**
 * Per-part geometry dimensions: a tight **local-frame** axis-aligned bounding box
 * (mm), `aabbMin` ≤ `aabbMax` on every axis. This is the part's true body extent
 * BEFORE placement — the narrow phase rotates/translates it by the part's transform
 * exactly like `assembly-interference.ts` does for the coarse box.
 *
 * `.refine` enforces `min ≤ max` per axis so a malformed box is rejected at parse
 * time rather than silently corrupting an interference result downstream.
 */
export const assemblyPartGeometryDimensionsSchema = z
  .object({
    /** Local-frame minimum corner (mm). */
    aabbMin: vec3Schema,
    /** Local-frame maximum corner (mm). */
    aabbMax: vec3Schema
  })
  .refine(
    (d) => d.aabbMin[0] <= d.aabbMax[0] && d.aabbMin[1] <= d.aabbMax[1] && d.aabbMin[2] <= d.aabbMax[2],
    { message: 'geometryDimensions: aabbMin must be ≤ aabbMax on every axis.' }
  )

export type AssemblyPartGeometryDimensions = z.infer<typeof assemblyPartGeometryDimensionsSchema>

/**
 * Minimal **assembly part** fragment carrying the optional per-part dimensions.
 *
 * Deliberately tiny: this wave only threads `geometryDimensions` onto a part. The
 * full persisted part shape lives in `assemblyComponentSchema`
 * (`assembly-schema.ts`); this fragment is mergeable into it in a later cycle
 * without a migration because the field is optional. Keeping it standalone here
 * avoids editing the separately-owned component schema this wave.
 */
export const assemblyPartDimensionsFragmentSchema = z.object({
  /**
   * Optional tight per-part bounding box in the part's local frame. Omit for rows
   * whose geometry has not been measured yet — interference detection then falls
   * back to its conservative broad-phase box (no regression).
   */
  geometryDimensions: assemblyPartGeometryDimensionsSchema.optional()
})

export type AssemblyPartDimensionsFragment = z.infer<typeof assemblyPartDimensionsFragmentSchema>

/**
 * Anything that may carry per-part dimensions. Structural (not the full component)
 * so callers can pass a hydrated row, a plain `{ geometryDimensions }`, or a
 * component spread — without importing the heavy component schema here.
 */
export type WithGeometryDimensions = {
  readonly geometryDimensions?: AssemblyPartGeometryDimensions
}

/**
 * Project a part's `geometryDimensions` into the `{ min, max }` `LocalAabb` shape
 * that `assembly-interference.ts` consumes. Returns `undefined` when the part has
 * no dimensions (the caller then keeps the conservative broad-phase box).
 *
 * Pure and total: never throws. A malformed inline box (min > max on any axis) is
 * treated as "no usable dims" → `undefined`, so a bad hydration cannot make the
 * narrow phase *more* aggressive than the broad phase (fail-safe, never a false
 * negative).
 */
export function assemblyPartLocalAabb(
  part: WithGeometryDimensions
): { min: readonly [number, number, number]; max: readonly [number, number, number] } | undefined {
  const d = part.geometryDimensions
  if (d == null) return undefined
  const { aabbMin, aabbMax } = d
  if (
    !Number.isFinite(aabbMin[0]) ||
    !Number.isFinite(aabbMin[1]) ||
    !Number.isFinite(aabbMin[2]) ||
    !Number.isFinite(aabbMax[0]) ||
    !Number.isFinite(aabbMax[1]) ||
    !Number.isFinite(aabbMax[2])
  ) {
    return undefined
  }
  if (aabbMin[0] > aabbMax[0] || aabbMin[1] > aabbMax[1] || aabbMin[2] > aabbMax[2]) {
    return undefined
  }
  return { min: aabbMin, max: aabbMax }
}
