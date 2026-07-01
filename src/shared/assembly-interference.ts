/**
 * Assembly **interference detection** (pure, bbox-level).
 *
 * Given the assembly's positioned parts — each carrying a **local** axis-aligned
 * bounding box (AABB) plus its placement transform — this module reports which
 * pairs of parts **clash**. It is the data-layer half of the Assembly
 * interference feature; the renderer consumes {@link detectInterferences} to
 * paint a clash list / highlight the offending parts.
 *
 * ## Fidelity (honesty contract — read this before trusting a result)
 *
 * This is a **bounding-box** (AABB) interference check, NOT a mesh- or B-rep-level
 * solid intersection:
 *
 *   1. Each part's **local** AABB is transformed into world space by mapping its
 *      eight corners through the part's 6-DOF transform (Euler-ZYX rotation —
 *      identical convention to `assembly-solver-core` / `assembly-viewport-math`)
 *      and taking the min/max of the rotated corners. A rotated box therefore
 *      yields a **conservative, axis-aligned world box** that is generally LARGER
 *      than the true rotated extent.
 *   2. Two parts clash iff their world AABBs **overlap with positive volume** on
 *      all three axes. Boxes that merely **touch** (share a face/edge/corner with
 *      zero overlap) do NOT clash — a press-fit flush mate is not an interference.
 *
 * Consequences the caller MUST surface honestly:
 *   - **False positives** are expected: two L-shaped parts can have overlapping
 *     bounding boxes while their actual solids are nested without touching.
 *   - **No false negatives at the bbox level**: if the world AABBs do not overlap,
 *     the solids cannot intersect, so a "clear" result is reliable as a coarse
 *     filter. A true solid-intersection (mesh / OCC boolean) pass is a documented
 *     follow-up — treat a reported clash as "worth a look", not "certified
 *     collision".
 *
 * ## Broad-phase / narrow-phase delegation (optional)
 *
 * The bbox test is a perfect **broad phase**: it is cheap and never misses a real
 * clash, but it over-reports. A caller that owns true geometry (e.g. the Electron
 * main process, which loads each part's binary STL and runs the spatial-grid +
 * triangle–triangle SAT in `src/main/assembly-mesh-interference.ts`) can pass a
 * {@link NarrowPhaseDelegate} to {@link detectInterferences}. Then:
 *   1. bbox overlap is the pre-filter — only overlapping pairs reach the delegate;
 *   2. the delegate returns `true` only for a confirmed narrow-phase hit;
 *   3. pairs the delegate clears are dropped, **eliminating the bbox false
 *      positives**, and the report's `fidelity` becomes `'bbox+narrow'`.
 * With NO delegate the result is byte-identical to the pure bbox path
 * (`fidelity: 'bbox'`). This module never imports the mesh code itself — it stays
 * pure and the geometry-owning layer injects the narrow phase. The narrow phase is
 * gated on real per-part geometry that this module does not (yet) carry: an
 * `InterferencePart` exposes only a `localBox`, so the dims/mesh threading needed to
 * run narrow phase *inside* the shared layer is an upstream input, owned elsewhere.
 *
 * This module is **pure**: no React, no DOM, no IPC, no `Date.now` / `crypto`.
 * Deterministic — inputs are sorted by id, and the output pair order is stable.
 */

/** A local-frame axis-aligned bounding box (mm), `min` ≤ `max` per axis. */
export type LocalAabb = {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

/** A world axis-aligned bounding box (mm) — the rotated/translated local box's extent. */
export type WorldAabb = {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

/**
 * 6-DOF placement (position mm + Euler-ZYX rotation degrees). Structurally
 * compatible with `assembly-viewport-math`'s `AssemblyTransform6` and the schema
 * component `transform`, declared here so this module imports neither.
 */
export type InterferenceTransform = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly rxDeg: number
  readonly ryDeg: number
  readonly rzDeg: number
}

/** A positioned part the detector evaluates. */
export type InterferencePart = {
  /** Stable instance id (mirrors `AssemblyComponent.id`). */
  readonly id: string
  /** This part's body extent in its OWN local frame (before placement). */
  readonly localBox: LocalAabb
  /** Placement transform. Omit for identity (origin, no rotation). */
  readonly transform?: InterferenceTransform
  /** When true, the part is excluded from the check (mirrors `suppressed`). */
  readonly suppressed?: boolean
}

/** One detected clash: an unordered pair of part ids whose world AABBs overlap. */
export type InterferencePair = {
  /** Lexicographically-smaller id (deterministic ordering within the pair). */
  readonly aId: string
  /** Lexicographically-larger id. */
  readonly bId: string
}

/**
 * Fidelity of an {@link InterferenceReport}:
 *   - `'bbox'` — pure broad-phase AABB overlap; clashes are conservative (possible
 *     false positives). This is the value whenever no narrow-phase delegate ran.
 *   - `'bbox+narrow'` — a {@link NarrowPhaseDelegate} confirmed each reported clash
 *     against true geometry; bbox-only false positives were dropped.
 */
export type InterferenceFidelity = 'bbox' | 'bbox+narrow'

/**
 * Optional narrow-phase confirmer injected by a geometry-owning caller. Invoked
 * **only** for unordered pairs whose world AABBs already overlap (broad phase). The
 * pair is passed canonically (`aId < bId`).
 *
 * Return:
 *   - `true`  → confirmed clash (kept in `clashingPairs`);
 *   - `false` → no true intersection (dropped — a bbox false positive);
 *   - `'indeterminate'` → the narrow phase could not decide (e.g. missing mesh,
 *     budget exceeded). Such a pair is KEPT (conservative — never silently drop a
 *     possible clash) and listed in {@link InterferenceReport.indeterminatePairs}.
 */
export type NarrowPhaseDelegate = (aId: string, bId: string) => boolean | 'indeterminate'

/** Result of {@link detectInterferences}. */
export type InterferenceReport = {
  /**
   * Reported clashes. At `fidelity: 'bbox'` these are conservative broad-phase
   * overlaps (see the honesty caveats above). At `fidelity: 'bbox+narrow'` each was
   * confirmed (or left indeterminate) by the narrow-phase delegate. Deterministic
   * order: sorted by `aId` then `bId`.
   */
  readonly clashingPairs: InterferencePair[]
  /** Number of parts actually evaluated (non-suppressed, with a valid box). */
  readonly evaluatedCount: number
  /**
   * Ids skipped because they were suppressed or carried a malformed box
   * (non-finite numbers, or `min > max` on any axis). Deterministic order.
   */
  readonly skippedIds: string[]
  /**
   * Fidelity tag — `'bbox'` when no narrow-phase delegate ran (conservative), or
   * `'bbox+narrow'` when one did. Lets consumers label results honestly without
   * inspecting the algorithm.
   */
  readonly fidelity: InterferenceFidelity
  /**
   * Present only at `fidelity: 'bbox+narrow'`: broad-phase pairs the delegate
   * returned `'indeterminate'` for (kept in `clashingPairs` conservatively). Lets
   * the UI mark them "could not verify" instead of "confirmed". Omitted when empty
   * or when no delegate ran.
   */
  readonly indeterminatePairs?: InterferencePair[]
  /**
   * Present only at `fidelity: 'bbox+narrow'`: broad-phase overlaps the delegate
   * CLEARED (true `false`) — i.e. bbox false positives that were dropped. Useful for
   * diagnostics / telemetry. Omitted when empty or when no delegate ran.
   */
  readonly narrowPhaseClearedPairs?: InterferencePair[]
}

const DEG2RAD = Math.PI / 180

/** A finite `[number, number, number]` tuple? */
function isFiniteVec3(v: readonly [number, number, number] | undefined): v is readonly [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  )
}

/** A structurally-valid local box (finite corners, min ≤ max on every axis)? */
function isValidBox(box: LocalAabb | undefined): box is LocalAabb {
  if (box == null) return false
  if (!isFiniteVec3(box.min) || !isFiniteVec3(box.max)) return false
  return box.min[0] <= box.max[0] && box.min[1] <= box.max[1] && box.min[2] <= box.max[2]
}

/**
 * Rotate a local vector by an Euler-ZYX transform (R = Rz·Ry·Rx applied to the
 * vector), then translate. Matches `assembly-solver-core.worldFeaturePoint` /
 * `assembly-viewport-math` exactly so a positioned part lands where the solver
 * and viewport place it.
 */
function transformPoint(
  t: InterferenceTransform,
  local: readonly [number, number, number]
): [number, number, number] {
  const [lx, ly, lz] = local
  const cz = Math.cos(t.rzDeg * DEG2RAD)
  const sz = Math.sin(t.rzDeg * DEG2RAD)
  const cy = Math.cos(t.ryDeg * DEG2RAD)
  const sy = Math.sin(t.ryDeg * DEG2RAD)
  const cx = Math.cos(t.rxDeg * DEG2RAD)
  const sx = Math.sin(t.rxDeg * DEG2RAD)
  // Rx
  const x1 = lx
  const y1 = cx * ly - sx * lz
  const z1 = sx * ly + cx * lz
  // Ry
  const x2 = cy * x1 + sy * z1
  const y2 = y1
  const z2 = -sy * x1 + cy * z1
  // Rz
  const x3 = cz * x2 - sz * y2
  const y3 = sz * x2 + cz * y2
  const z3 = z2
  return [x3 + t.x, y3 + t.y, z3 + t.z]
}

const IDENTITY_TRANSFORM: InterferenceTransform = { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }

/**
 * Compute the **world** axis-aligned bounding box of a local box under a
 * transform, by mapping all eight corners and taking their min/max. For a rotated
 * box this is the conservative axis-aligned hull (≥ the true rotated extent).
 * Exported so the renderer can reuse the exact same world-extent math (e.g. to
 * frame the viewport on a clash).
 */
export function worldAabbOf(box: LocalAabb, transform?: InterferenceTransform): WorldAabb {
  const t = transform ?? IDENTITY_TRANSFORM
  const xs = [box.min[0], box.max[0]]
  const ys = [box.min[1], box.max[1]]
  const zs = [box.min[2], box.max[2]]
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const cx of xs) {
    for (const cy of ys) {
      for (const cz of zs) {
        const [wx, wy, wz] = transformPoint(t, [cx, cy, cz])
        if (wx < minX) minX = wx
        if (wy < minY) minY = wy
        if (wz < minZ) minZ = wz
        if (wx > maxX) maxX = wx
        if (wy > maxY) maxY = wy
        if (wz > maxZ) maxZ = wz
      }
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

/**
 * Do two world AABBs overlap with **positive volume** on all three axes? Touching
 * (zero overlap on any axis — a shared face/edge/corner) returns `false`: a flush
 * contact is not an interference. The comparison is strict (`<`) per axis.
 */
export function worldAabbsOverlap(a: WorldAabb, b: WorldAabb): boolean {
  return (
    a.min[0] < b.max[0] &&
    b.min[0] < a.max[0] &&
    a.min[1] < b.max[1] &&
    b.min[1] < a.max[1] &&
    a.min[2] < b.max[2] &&
    b.min[2] < a.max[2]
  )
}

/**
 * The two pieces of true per-part geometry the OBB narrow phase needs: the part's
 * tight LOCAL axis-aligned box plus its placement transform. Structurally
 * compatible with an {@link InterferencePart} (which already carries both), and
 * with a part hydrated from `assembly-part.ts`'s `geometryDimensions`.
 */
export type NarrowPhaseGeometry = {
  /** Tight local-frame AABB (mm) — the part's true body extent before placement. */
  readonly localBox: LocalAabb
  /** Placement transform; omit for identity. */
  readonly transform?: InterferenceTransform
}

const AXIS_X: readonly [number, number, number] = [1, 0, 0]
const AXIS_Y: readonly [number, number, number] = [0, 1, 0]
const AXIS_Z: readonly [number, number, number] = [0, 0, 1]

/** Rotate a local DIRECTION (no translation) by an Euler-ZYX transform. */
function rotateDir(
  t: InterferenceTransform,
  v: readonly [number, number, number]
): [number, number, number] {
  const origin = transformPoint(t, [0, 0, 0])
  const tip = transformPoint(t, v)
  return [tip[0] - origin[0], tip[1] - origin[1], tip[2] - origin[2]]
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** An oriented bounding box: world center, three orthonormal axes, per-axis half-extents. */
type Obb = {
  center: [number, number, number]
  axes: [
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ]
  half: [number, number, number]
}

/** Build the world-space oriented box of a local AABB under a transform. */
function obbOf(box: LocalAabb, transform?: InterferenceTransform): Obb {
  const t = transform ?? IDENTITY_TRANSFORM
  const localCenter: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2
  ]
  return {
    center: transformPoint(t, localCenter),
    axes: [rotateDir(t, AXIS_X), rotateDir(t, AXIS_Y), rotateDir(t, AXIS_Z)],
    half: [
      (box.max[0] - box.min[0]) / 2,
      (box.max[1] - box.min[1]) / 2,
      (box.max[2] - box.min[2]) / 2
    ]
  }
}

/**
 * Separating-Axis-Theorem overlap test for two oriented bounding boxes.
 *
 * Tests the 15 candidate separating axes (3 face normals of A, 3 of B, 9 edge
 * cross-products). Returns `true` only if the boxes overlap with **positive
 * penetration** — boxes that merely touch (projection gap exactly 0) return
 * `false`, matching the strict-`<` semantics of {@link worldAabbsOverlap}.
 *
 * `epsilon` guards against the degenerate cross-product axes (near-parallel
 * edges) producing a spuriously-tiny zero vector; such axes are skipped.
 */
function obbsOverlap(a: Obb, b: Obb, epsilon = 1e-9): boolean {
  const T: [number, number, number] = [
    b.center[0] - a.center[0],
    b.center[1] - a.center[1],
    b.center[2] - a.center[2]
  ]
  const candidates: Array<readonly [number, number, number]> = [
    a.axes[0],
    a.axes[1],
    a.axes[2],
    b.axes[0],
    b.axes[1],
    b.axes[2]
  ]
  for (const ea of a.axes) {
    for (const eb of b.axes) {
      candidates.push(cross3(ea, eb))
    }
  }
  for (const axisRaw of candidates) {
    const len = Math.sqrt(dot3(axisRaw, axisRaw))
    if (len < epsilon) continue // degenerate (parallel edges) — not a usable separating axis
    const axis: [number, number, number] = [axisRaw[0] / len, axisRaw[1] / len, axisRaw[2] / len]
    const ra =
      a.half[0] * Math.abs(dot3(axis, a.axes[0])) +
      a.half[1] * Math.abs(dot3(axis, a.axes[1])) +
      a.half[2] * Math.abs(dot3(axis, a.axes[2]))
    const rb =
      b.half[0] * Math.abs(dot3(axis, b.axes[0])) +
      b.half[1] * Math.abs(dot3(axis, b.axes[1])) +
      b.half[2] * Math.abs(dot3(axis, b.axes[2]))
    const separation = Math.abs(dot3(T, axis))
    if (separation >= ra + rb) return false // a separating axis exists → no overlap
  }
  return true
}

/**
 * Build a {@link NarrowPhaseDelegate} that refines broad-phase overlaps with a true
 * **oriented bounding box (OBB) SAT** test using each part's real per-part geometry.
 *
 * The broad phase ({@link detectInterferences}) overlaps the **axis-aligned hulls**
 * of rotated boxes — conservative and over-reporting for rotated parts. This
 * delegate re-tests the same per-part dims as ORIENTED boxes, so a pair whose
 * world AABBs overlap only because rotation inflated their hulls is **cleared**
 * (false positive killed). A pair whose oriented boxes truly intersect is
 * **confirmed**.
 *
 * Resolution rule per pair:
 *   - both parts have usable dims (via `geometryById`) → run OBB SAT:
 *       `true` (confirmed) or `false` (cleared);
 *   - **either** part lacks dims → return `'indeterminate'` so the pair is KEPT
 *     conservatively (the delegate must never silently drop an unverifiable clash).
 *
 * @param geometryById maps part id → its {@link NarrowPhaseGeometry}. A part absent
 *   from the map (or present with a malformed box) is treated as "no dims".
 */
export function makeAabbNarrowPhase(
  geometryById: ReadonlyMap<string, NarrowPhaseGeometry>
): NarrowPhaseDelegate {
  return (aId, bId) => {
    const ga = geometryById.get(aId)
    const gb = geometryById.get(bId)
    if (ga == null || gb == null) return 'indeterminate'
    if (!isValidBox(ga.localBox) || !isValidBox(gb.localBox)) return 'indeterminate'
    return obbsOverlap(obbOf(ga.localBox, ga.transform), obbOf(gb.localBox, gb.transform))
  }
}

/**
 * Convenience wrapper: detect interferences, refining the broad phase with the OBB
 * narrow phase **only when** per-part geometry is supplied.
 *
 * - `geometryById` omitted, `undefined`, or **empty** → delegates to
 *   {@link detectInterferences} with NO narrow phase. The result is therefore
 *   **byte-identical** to the pure conservative broad-phase path
 *   (`fidelity: 'bbox'`) — zero regression for assemblies whose parts carry no
 *   `geometryDimensions`.
 * - non-empty map → installs {@link makeAabbNarrowPhase}; pairs with dims on both
 *   parts are confirmed/cleared, pairs missing dims are kept as `'indeterminate'`,
 *   and `fidelity` becomes `'bbox+narrow'`.
 *
 * The per-part geometry is sourced from the parts themselves: every
 * {@link InterferencePart} already carries `localBox` + `transform`, so a hydrated
 * assembly that filled `geometryDimensions` (see `assembly-part.ts`) into each
 * part's `localBox` gets the refinement for free.
 */
export function detectInterferencesWithDims(
  parts: readonly InterferencePart[],
  geometryById?: ReadonlyMap<string, NarrowPhaseGeometry>
): InterferenceReport {
  if (geometryById == null || geometryById.size === 0) {
    return detectInterferences(parts)
  }
  return detectInterferences(parts, { narrowPhase: makeAabbNarrowPhase(geometryById) })
}

/** Options for {@link detectInterferences}. */
export type DetectInterferencesOptions = {
  /**
   * Optional narrow-phase confirmer. When provided, bbox overlap becomes the broad
   * phase and only overlapping pairs are handed to this delegate; cleared pairs are
   * dropped and the report fidelity becomes `'bbox+narrow'`. See
   * {@link NarrowPhaseDelegate}. Omit for the pure conservative bbox result.
   */
  readonly narrowPhase?: NarrowPhaseDelegate
}

/**
 * Detect interferences among positioned parts.
 *
 * Suppressed parts and parts with a malformed `localBox` are excluded (and listed
 * in {@link InterferenceReport.skippedIds}). Every remaining unordered pair is
 * tested for world-AABB overlap (the **broad phase**).
 *
 * - With no `narrowPhase` delegate, overlapping pairs are returned directly
 *   (`fidelity: 'bbox'`) — conservative, possible false positives.
 * - With a `narrowPhase` delegate, each overlapping pair is confirmed against true
 *   geometry: `true` keeps it, `false` drops it (a bbox false positive),
 *   `'indeterminate'` keeps it but flags it. Fidelity becomes `'bbox+narrow'`.
 *
 * Output pair order is deterministic (sorted by `aId` then `bId`); the delegate is
 * invoked in that same canonical order so an impure delegate still yields a stable
 * report.
 *
 * @param parts the assembly's positioned parts (any order; sorted by id internally)
 * @param options optional narrow-phase delegation
 */
export function detectInterferences(
  parts: readonly InterferencePart[],
  options?: DetectInterferencesOptions
): InterferenceReport {
  // Deterministic input ordering.
  const sorted = [...parts].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))

  const evaluated: { id: string; world: WorldAabb }[] = []
  const skippedIds: string[] = []
  for (const part of sorted) {
    if (part.suppressed === true || !isValidBox(part.localBox)) {
      skippedIds.push(part.id)
      continue
    }
    evaluated.push({ id: part.id, world: worldAabbOf(part.localBox, part.transform) })
  }

  // Broad phase: every world-AABB overlap, in canonical (aId < bId) order.
  const broadPhasePairs: InterferencePair[] = []
  for (let i = 0; i < evaluated.length; i++) {
    for (let j = i + 1; j < evaluated.length; j++) {
      const a = evaluated[i]!
      const b = evaluated[j]!
      if (worldAabbsOverlap(a.world, b.world)) {
        // a.id < b.id by construction (sorted), so the pair is already canonical.
        broadPhasePairs.push({ aId: a.id, bId: b.id })
      }
    }
  }

  const narrowPhase = options?.narrowPhase
  if (narrowPhase == null) {
    // Pure broad-phase result — byte-identical to the historical bbox-only path.
    return {
      clashingPairs: broadPhasePairs,
      evaluatedCount: evaluated.length,
      skippedIds,
      fidelity: 'bbox'
    }
  }

  // Narrow phase: confirm / clear / flag each broad-phase pair against true geometry.
  const clashingPairs: InterferencePair[] = []
  const indeterminatePairs: InterferencePair[] = []
  const narrowPhaseClearedPairs: InterferencePair[] = []
  for (const pair of broadPhasePairs) {
    const verdict = narrowPhase(pair.aId, pair.bId)
    if (verdict === false) {
      narrowPhaseClearedPairs.push(pair)
      continue
    }
    // true OR 'indeterminate' → keep the pair (conservative). Flag indeterminate ones.
    clashingPairs.push(pair)
    if (verdict === 'indeterminate') indeterminatePairs.push(pair)
  }

  return {
    clashingPairs,
    evaluatedCount: evaluated.length,
    skippedIds,
    fidelity: 'bbox+narrow',
    ...(indeterminatePairs.length > 0 ? { indeterminatePairs } : {}),
    ...(narrowPhaseClearedPairs.length > 0 ? { narrowPhaseClearedPairs } : {})
  }
}
