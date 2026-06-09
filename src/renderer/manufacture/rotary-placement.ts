/**
 * rotary-placement.ts — pure, framework-agnostic helpers that build the
 * `Placement` a Carvera 4-axis CAM run feeds to the engine (`fab().camRun`'s
 * `placement` field, consumed by `src/main/cam-axis4/frame.ts`).
 *
 * WHY THIS EXISTS
 * ---------------
 * Today `run-cam-for-op.ts` hard-codes an identity placement, so every rotary
 * job silently assumes the STL was authored in rotary WCS (viewer X = the
 * rotation axis, part centered on that axis). Real-world models rarely are.
 * `RotaryOrientGizmo.tsx` is the UI that produces a real `Placement`; this
 * module is its math core, kept pure so it unit-tests in the `node` vitest env
 * (same tenet as `selection-state.ts` / `design-commands.ts`).
 *
 * G-CODE SAFETY (this is CAM — placement decides which topology gets cut)
 * ----------------------------------------------------------------------
 * The engine frame contract (`frame.ts` header) is the single source of truth:
 *   - Viewer **X** = axial position ALONG the rotation axis (chuck face at X=0).
 *   - Radial distance of any vertex = √(Y² + Z²); the engine HARD-REJECTS a job
 *     when `meshRadialMax > stockRadius` (`validation.ts`).
 *   - `frame.ts` step 1 re-centers the raw bbox to the origin BEFORE applying
 *     this placement's rotation/translation, and step 5 adds `stockLength/2` so
 *     the result spans `[0, stockLength]`.
 *
 * Consequences this module honors so it can NEVER mis-orient a part:
 *   1. The rotation we emit is in viewer-space Euler degrees, in the SAME
 *      XYZ-intrinsic order `frame.ts` applies (it maps our `{x,y,z}` →
 *      `rotateXYZDeg([x, z, y])` after the documented Y↔Z swap). We therefore
 *      only ever emit axis-quadrant rotations (0 / ±90 / 180) for the quick-sets
 *      so the mapping stays exact and reversible — no fractional drift that
 *      could push a vertex past the stock radius.
 *   2. "Center on chuck" emits ONLY an axial (X) translation. Because `frame.ts`
 *      already re-centers in Y and Z, we never translate radially here — doing
 *      so would move the part off the rotation axis and inflate `meshRadialMax`.
 *
 * The helpers are deliberately conservative: an unknown/absent part-bounds prop
 * degrades to identity (a no-op placement === today's behavior), never to a
 * guessed transform.
 */

// ── Placement type (structurally identical to frame.ts `Placement` and the
//    renderer `ModelTransform`, so it assigns to `camRun.placement` directly). ─

/** A 3-component vector (millimetres for position, degrees for rotation). */
export interface Vec3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * Three.js viewer-space placement of the mesh. Mirrors `frame.ts` `Placement`
 * and `ShopModelViewer` `ModelTransform`:
 *   - `position` — translation in mm (only the X/axial component is meaningful
 *     for rotary; see module header).
 *   - `rotation` — intrinsic XYZ Euler angles in DEGREES.
 *   - `scale`    — per-axis scale factor (1 = unscaled).
 */
export interface Placement {
  readonly position: Vec3Like
  readonly rotation: Vec3Like
  readonly scale: Vec3Like
}

/**
 * Axis-aligned bounding box of the raw (un-placed) part, in the SAME viewer
 * space the gizmo rotation is expressed in. Supplied by the host when known so
 * the quick-sets can pick the right axis to spin onto X. Optional — when absent
 * the long-axis / lay-flat quick-sets fall back to identity rather than guess.
 */
export interface PartBounds {
  readonly min: Vec3Like
  readonly max: Vec3Like
}

/** The three principal viewer axes. */
export type Axis = 'x' | 'y' | 'z'

/** Quick-set identifiers offered by the gizmo. */
export type RotaryQuickSet = 'x_is_rotation_axis' | 'lay_flat' | 'center_on_chuck'

const EPS = 1e-9

// ── Constructors / constants ─────────────────────────────────────────────────

/** The identity placement (no transform). Equivalent to today's hard-coded value. */
export const IDENTITY_PLACEMENT: Placement = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
}

/** A fresh, mutable-free identity placement (so callers never share one ref). */
export function identityPlacement(): Placement {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

/**
 * Build a `Placement` from loose numeric parts, normalizing each axis with a
 * safe fallback. Non-finite inputs (NaN/Infinity, e.g. a half-typed `-` in a
 * number field) collapse to the identity value for that axis so the emitted
 * placement is ALWAYS a clean, finite transform the engine can trust.
 *
 * Scale defaults to 1 (not 0) per axis — a 0 scale would degenerate the mesh
 * and is never what an orientation gizmo intends.
 */
export function buildPlacement(parts: {
  readonly position?: Partial<Vec3Like>
  readonly rotation?: Partial<Vec3Like>
  readonly scale?: Partial<Vec3Like>
}): Placement {
  return {
    position: {
      x: finiteOr(parts.position?.x, 0),
      y: finiteOr(parts.position?.y, 0),
      z: finiteOr(parts.position?.z, 0)
    },
    rotation: {
      x: finiteOr(parts.rotation?.x, 0),
      y: finiteOr(parts.rotation?.y, 0),
      z: finiteOr(parts.rotation?.z, 0)
    },
    scale: {
      x: nonZeroFiniteOr(parts.scale?.x, 1),
      y: nonZeroFiniteOr(parts.scale?.y, 1),
      z: nonZeroFiniteOr(parts.scale?.z, 1)
    }
  }
}

/**
 * Return a copy of `base` with `rotation` replaced. Used by the gizmo when a
 * numeric rotation field changes — position/scale are preserved.
 */
export function withRotation(base: Placement, rotation: Partial<Vec3Like>): Placement {
  return buildPlacement({
    position: base.position,
    rotation: { x: rotation.x ?? base.rotation.x, y: rotation.y ?? base.rotation.y, z: rotation.z ?? base.rotation.z },
    scale: base.scale
  })
}

/** Return a copy of `base` with a single rotation axis set (degrees). */
export function withRotationAxis(base: Placement, axis: Axis, deg: number): Placement {
  return withRotation(base, { [axis]: deg } as Partial<Vec3Like>)
}

// ── Bounds helpers ───────────────────────────────────────────────────────────

/** Size (extent) of a bounds along each axis. Never negative. */
export function boundsSize(bounds: PartBounds): Vec3Like {
  return {
    x: Math.abs(bounds.max.x - bounds.min.x),
    y: Math.abs(bounds.max.y - bounds.min.y),
    z: Math.abs(bounds.max.z - bounds.min.z)
  }
}

/** The axis with the LARGEST extent (ties resolve x → y → z). */
export function longestAxis(bounds: PartBounds): Axis {
  const s = boundsSize(bounds)
  if (s.x >= s.y && s.x >= s.z) return 'x'
  if (s.y >= s.z) return 'y'
  return 'z'
}

/** The axis with the SMALLEST extent (ties resolve x → y → z). */
export function shortestAxis(bounds: PartBounds): Axis {
  const s = boundsSize(bounds)
  if (s.x <= s.y && s.x <= s.z) return 'x'
  if (s.y <= s.z) return 'y'
  return 'z'
}

// ── Quick-sets ───────────────────────────────────────────────────────────────

/**
 * Engine-correct rotation (gizmo Euler degrees) that brings each STL bounding
 * axis onto the engine's rotation axis (engine X). DERIVED EMPIRICALLY against
 * `frame.ts` (which applies the documented Y↔Z swap: gizmo `{x,y,z}` →
 * `rotateXYZDeg([x, z, y])`), so these are NOT the naive viewer-space rotations
 * — e.g. a Y-long part needs a gizmo Y-rotation (not Z) to land on engine X.
 *
 * Verified mapping (long STL axis → gizmo rotation → engine-X extent maximal,
 * radialMax minimal):
 *   long = x → (0, 0, 0)
 *   long = y → (0, 90, 0)
 *   long = z → (0, 0, 90)
 */
const X_IS_AXIS_ROTATION: Readonly<Record<Axis, Vec3Like>> = {
  x: { x: 0, y: 0, z: 0 },
  y: { x: 0, y: 90, z: 0 },
  z: { x: 0, y: 0, z: 90 }
}

/**
 * Engine-correct "lay flat" rotation keyed by `(longAxis, shortAxis)`: brings
 * the long STL axis onto engine X (rotation axis) AND the short STL axis onto
 * engine Z (the renderer's "A=0 radial up"), so a slab seats thin-side-up and
 * `meshRadialMax` is minimized. DERIVED EMPIRICALLY against `frame.ts` — the
 * exhaustive axis-quadrant search picked the minimal-angle rotation per shape.
 *
 * Verified table:
 *   (x, z) → (0,  0,  0)     (x, y) → (90, 0,  0)
 *   (y, z) → (0,  90, 0)     (y, x) → (0,  90, 90)
 *   (z, y) → (90, 90, 0)     (z, x) → (0,  0,  90)
 */
const LAY_FLAT_ROTATION: ReadonlyMap<string, Vec3Like> = new Map<string, Vec3Like>([
  ['x|z', { x: 0, y: 0, z: 0 }],
  ['x|y', { x: 90, y: 0, z: 0 }],
  ['y|z', { x: 0, y: 90, z: 0 }],
  ['y|x', { x: 0, y: 90, z: 90 }],
  ['z|y', { x: 90, y: 90, z: 0 }],
  ['z|x', { x: 0, y: 0, z: 90 }]
])

/**
 * "X = rotation axis" — orient the part so its LONGEST dimension lies along the
 * engine's rotation axis (engine X). Emits a pure axis-quadrant rotation from
 * the engine-verified {@link X_IS_AXIS_ROTATION} table; position/scale are reset
 * to identity (`frame.ts` re-centers the bbox anyway, so a rotation-only
 * placement is correct and trivial to verify). Identity (safe no-op === today's
 * assume-authored-in-WCS behavior) when bounds are unknown — never a guess.
 */
export function placementXIsRotationAxis(bounds?: PartBounds): Placement {
  if (!bounds) return identityPlacement()
  return buildPlacement({ rotation: X_IS_AXIS_ROTATION[longestAxis(bounds)] })
}

/**
 * "Lay flat" — keep the part axial (long axis on engine X) AND spin its SHORTEST
 * dimension onto engine Z (radial up). Uses the engine-verified
 * {@link LAY_FLAT_ROTATION} table keyed by `(long, short)`. For a near-cube the
 * long/short collapse and it degrades to the X-is-axis rotation. Emits only
 * axis-quadrant rotations. Identity when bounds are unknown.
 */
export function placementLayFlat(bounds?: PartBounds): Placement {
  if (!bounds) return identityPlacement()
  const long = longestAxis(bounds)
  const short = shortestAxis(bounds)
  // Degenerate (cube-ish) case: long === short means no distinct short axis to
  // seat — fall back to just putting the long axis on X.
  if (long === short) return placementXIsRotationAxis(bounds)
  const rot = LAY_FLAT_ROTATION.get(`${long}|${short}`)
  if (!rot) return placementXIsRotationAxis(bounds) // unreachable; defensive
  return buildPlacement({ rotation: rot })
}

/**
 * "Center on chuck" — translate the part along the engine axial direction
 * (engine X) so its near face sits at the chuck face (engine X=0). Because
 * `frame.ts` re-centers the bbox to the origin first, the part center is at
 * engine X=0 after step 1; shifting by +halfAxialExtent puts the near face at
 * the origin (chuck face) and the part fully in +X (the machinable span).
 *
 * The axial extent is measured in ENGINE space by transforming the bounds
 * corners through `base`'s rotation/scale — so this stays correct after an
 * orient quick-set that rotated the part (the engine-X extent is then the long
 * STL dimension, not the STL-X dimension). Emits ONLY an engine-X translation —
 * never radial Y/Z (that would push the part off the rotation axis and trip the
 * radial guard). Rotation/scale are preserved from `base` (default identity).
 * Identity translation when bounds are unknown.
 */
export function placementCenterOnChuck(bounds?: PartBounds, base: Placement = identityPlacement()): Placement {
  if (!bounds) {
    return buildPlacement({ position: { x: 0, y: 0, z: 0 }, rotation: base.rotation, scale: base.scale })
  }
  // Measure the post-rotation engine-X extent over the centered bounds corners.
  const cx = (bounds.min.x + bounds.max.x) / 2
  const cy = (bounds.min.y + bounds.max.y) / 2
  const cz = (bounds.min.z + bounds.max.z) / 2
  let minEngX = Infinity
  let maxEngX = -Infinity
  for (const c of boundsCorners(bounds)) {
    const p = applyPlacementToPoint(
      // Use base rotation/scale but ZERO translation to measure pure extent.
      buildPlacement({ rotation: base.rotation, scale: base.scale }),
      { x: c.x - cx, y: c.y - cy, z: c.z - cz }
    )
    if (p.x < minEngX) minEngX = p.x
    if (p.x > maxEngX) maxEngX = p.x
  }
  const halfAxial = (maxEngX - minEngX) / 2
  return buildPlacement({
    position: { x: halfAxial, y: 0, z: 0 },
    rotation: base.rotation,
    scale: base.scale
  })
}

/**
 * Resolve a {@link RotaryQuickSet} id to a concrete placement, given the current
 * placement (so "center on chuck" can preserve the active orientation) and the
 * optional part bounds. Single dispatch the component and tests share.
 */
export function placementForQuickSet(
  quickSet: RotaryQuickSet,
  current: Placement,
  bounds?: PartBounds
): Placement {
  switch (quickSet) {
    case 'x_is_rotation_axis':
      return placementXIsRotationAxis(bounds)
    case 'lay_flat':
      return placementLayFlat(bounds)
    case 'center_on_chuck':
      return placementCenterOnChuck(bounds, current)
    default: {
      const _never: never = quickSet
      void _never
      return current
    }
  }
}

// ── Derived read-outs (for the numeric display + radial safety hint) ──────────

/**
 * Maximum radial extent √(Y² + Z²) the part would present to the rotation axis
 * AFTER `placement`, computed from the bounds' eight corners. Mirrors the value
 * `frame.ts`/`validation.ts` compute (`meshRadialMax`) closely enough to drive
 * an at-a-glance "fits in Ø" hint in the gizmo — the authoritative check still
 * runs in the engine pre-gen validator. Returns `null` when bounds are unknown.
 *
 * NOTE: this intentionally ignores the axial X shift (`stockLength/2`) and the
 * bbox re-centering, because radial distance is invariant to an axial shift and
 * to centering — only rotation changes which extents map to Y/Z.
 */
export function estimateRadialMax(placement: Placement, bounds?: PartBounds): number | null {
  if (!bounds) return null
  const corners = boundsCorners(bounds)
  // Center the corners (frame.ts re-centers before rotating).
  const cx = (bounds.min.x + bounds.max.x) / 2
  const cy = (bounds.min.y + bounds.max.y) / 2
  const cz = (bounds.min.z + bounds.max.z) / 2
  let radialMax = 0
  for (const c of corners) {
    const p = applyPlacementToPoint(placement, { x: c.x - cx, y: c.y - cy, z: c.z - cz })
    const r = Math.hypot(p.y, p.z)
    if (r > radialMax) radialMax = r
  }
  return radialMax
}

/**
 * Apply a placement to a single point in the gizmo's viewer space, replicating
 * `frame.ts`'s scale → rotate → translate order WITH the documented Y↔Z swap so
 * the radial estimate matches the engine. Exported for tests + the radial hint;
 * it is the same transform the engine bakes (minus centering + axial shift,
 * which `estimateRadialMax` handles).
 */
export function applyPlacementToPoint(placement: Placement, point: Vec3Like): Vec3Like {
  // Y↔Z swap (frame.ts: STL Y ← gizmo Z, STL Z ← gizmo Y).
  const sclX = placement.scale.x
  const sclY = placement.scale.z
  const sclZ = placement.scale.y
  const rot: [number, number, number] = [placement.rotation.x, placement.rotation.z, placement.rotation.y]
  const trnX = placement.position.x
  const trnY = placement.position.z
  const trnZ = placement.position.y

  let x = point.x * sclX
  let y = point.y * sclY
  let z = point.z * sclZ
  const r = rotateXYZDegLocal([x, y, z], rot)
  x = r[0] + trnX
  y = r[1] + trnY
  z = r[2] + trnZ
  return { x, y, z }
}

// ── Internal math ────────────────────────────────────────────────────────────

/** Eight corners of an AABB. */
function boundsCorners(b: PartBounds): Vec3Like[] {
  return [
    { x: b.min.x, y: b.min.y, z: b.min.z },
    { x: b.max.x, y: b.min.y, z: b.min.z },
    { x: b.min.x, y: b.max.y, z: b.min.z },
    { x: b.max.x, y: b.max.y, z: b.min.z },
    { x: b.min.x, y: b.min.y, z: b.max.z },
    { x: b.max.x, y: b.min.y, z: b.max.z },
    { x: b.min.x, y: b.max.y, z: b.max.z },
    { x: b.max.x, y: b.max.y, z: b.max.z }
  ]
}

/**
 * Local copy of the intrinsic-XYZ rotation `src/main/stl-vec3.ts` uses, so this
 * renderer-side helper does not import from `src/main`. Kept byte-identical to
 * `rotateXYZDeg` (verified by a parity assertion in the test) so the radial
 * estimate matches the engine bake.
 */
function rotateXYZDegLocal(v: readonly [number, number, number], d: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = v
  const rx = (d[0] * Math.PI) / 180
  const ry = (d[1] * Math.PI) / 180
  const rz = (d[2] * Math.PI) / 180
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const y1 = y * cx - z * sx
  const z1 = y * sx + z * cx
  const x2 = x * cy + z1 * sy
  const z2 = -x * sy + z1 * cy
  const x3 = x2 * cz - y1 * sz
  const y3 = x2 * sz + y1 * cz
  return [x3, y3, z2]
}

function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function nonZeroFiniteOr(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.abs(v) < EPS ? fallback : v
}
