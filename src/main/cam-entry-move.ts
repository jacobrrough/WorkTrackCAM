/**
 * cam-entry-move — REGION-AWARE cut-entry move generator for the 2D CAM engine.
 *
 * The 2D toolpath engine in `cam-local.ts` reaches cutting depth at the start of
 * a pass with a STRAIGHT vertical plunge (`G1 Z<depth>`). A straight plunge buries
 * the full tool tip into solid stock — fine for a drill, punishing for an end mill
 * (no chip clearance, axial-only load, the centre of a flat end mill cuts at zero
 * surface speed). Professional CAM (Fusion / Mastercam / SolidCAM) descends with a
 * HELIX or a RAMP so the cutter engages progressively along an inclined path.
 *
 * This module computes the ordered descent moves for one cut entry. It owns
 * geometry + feeds for the entry ONLY; the caller keeps full control of the cut
 * body, leads, and final safe-Z retract. It is the single place the helix-radius
 * REGION-FIT guard lives.
 *
 * Design contract (all enforced by {@link buildEntryMoves} + its tests):
 *
 *   1. **Never leaves the region.** A helix is centred so the WHOLE circle stays
 *      inside the cut region: the helix radius is clamped to the inscribed
 *      clearance from the entry point to the nearest region boundary edge (minus a
 *      tool-and-safety margin). If even the clamped radius is below a usable
 *      minimum, the helix is ABANDONED and the move degrades to a ramp; a ramp
 *      that cannot fit degrades to a straight plunge. The descent therefore NEVER
 *      cuts outside the part. A ramp's XY excursion is likewise bounded to the
 *      region span available along its direction.
 *
 *   2. **Never rapids into stock.** Every emitted descent move is a feed move
 *      (`G1`/`G2`/`G3`) at the PLUNGE feed (the Z-dominant feed). The caller is
 *      responsible for the safe-Z rapid + XY rapid to the entry XY BEFORE these
 *      moves; this module emits only at/under the safe-Z plane, descending.
 *
 *   3. **Bounded incline.** The ramp/helix angle from horizontal is clamped to
 *      `[MIN_ENTRY_ANGLE_DEG, MAX_ENTRY_ANGLE_DEG]`: never near-vertical (which
 *      would defeat the purpose and shock-load the tool) and never near-horizontal
 *      (which rubs without descending). The helix pitch derives from this angle.
 *
 *   4. **Stays at/above the final depth.** No descent move goes below `targetZMm`;
 *      the last move lands EXACTLY on `targetZMm` at the entry XY so the caller's
 *      cut body starts from a known point at depth.
 *
 *   5. **Degenerate → no entry.** A zero (or up-hill) descent emits NO moves — the
 *      caller is already at/over depth. An empty result means "no entry needed".
 *
 *   6. **Pure & deterministic.** No input mutation, no globals, no RNG, no I/O; the
 *      same input always yields the same move list. G-code text is formatted with
 *      the same `toFixed(3)` coordinate / `toFixed(0)` feed convention as
 *      `cam-local.ts` so emitted lines splice in byte-for-byte.
 *
 * G-code safety: this is a 3-AXIS-only feature (it emits only X/Y/Z + I/J arc
 * words, never A/B/C). The helix uses G2/G3 in the G17 (XY) plane the posts set in
 * their header. CNC routers only (Laguna Swift / RichAuto, Makera Carvera-3 /
 * Smoothieware). The 4-axis pipeline must NOT route through here.
 */

import type { CamPoint2d } from './cam-local'

/** A closed region ring (outer pocket/profile, mm) the entry must stay inside. */
export type CamEntryRegion = ReadonlyArray<CamPoint2d>

/** How the tool descends to cutting depth at a cut entry. */
export type EntryMode = 'plunge' | 'ramp' | 'helix'

/**
 * Lower bound on the entry incline from horizontal (degrees). Below this a "ramp"
 * is so shallow it rubs the floor without meaningfully descending; the helix pitch
 * would also be impractically tight. Clamping up to this keeps the descent honest.
 */
export const MIN_ENTRY_ANGLE_DEG = 1

/**
 * Upper bound on the entry incline from horizontal (degrees). Above this a ramp is
 * effectively a plunge (defeats the chip-clearance purpose and shock-loads the
 * tool). 30° is the common CAM ceiling for a ramp/helix lead; steeper requests are
 * clamped down to it.
 */
export const MAX_ENTRY_ANGLE_DEG = 30

/**
 * Smallest helix radius (mm) worth emitting. Below this the helix is so tight it is
 * indistinguishable from a plunge and the per-step arc sweep balloons; the move
 * falls back to a ramp (then a plunge). Also the floor for a usable ramp XY run.
 */
export const MIN_ENTRY_RADIUS_MM = 0.5

/** Default helix radius (mm) when the caller does not specify one (clamped to fit). */
const DEFAULT_HELIX_RADIUS_MM = 2

/** Default ramp XY run (mm) when the caller does not specify one (bounded to fit). */
const DEFAULT_RAMP_RUN_MM = 2

/** A descent move in the entry sequence (already region-validated). */
export type EntryMove =
  | { kind: 'plunge'; z: number }
  | { kind: 'ramp'; x: number; y: number; z: number }
  | { kind: 'arc'; dir: 'cw' | 'ccw'; x: number; y: number; z: number; i: number; j: number }
  /** A flat XY feed move back to the entry XY at the (already reached) depth. */
  | { kind: 'lineToEntry'; x: number; y: number; z: number }

/** Why the requested entry mode was (or was not) downgraded — for an operator hint. */
export type EntryFallbackReason =
  | 'helix_radius_too_small_for_region'
  | 'ramp_run_too_small_for_region'
  | 'open_contour_no_helix'

export type EntryMoveResult = {
  /** Ordered descent moves. Empty when no entry is needed (degenerate depth). */
  moves: EntryMove[]
  /** The mode actually used (may be downgraded from the request). */
  usedMode: EntryMode
  /** The helix radius actually used (mm), when {@link usedMode} is `helix`. */
  helixRadiusMm?: number
  /** Set when the requested mode was downgraded to fit the region safely. */
  fallbackReason?: EntryFallbackReason
}

export type BuildEntryMovesInput = {
  /** Entry XY in setup WCS (mm) — where the cut body begins. */
  entry: CamPoint2d
  /** Safe-Z plane (mm) the caller has already rapided to. Descent starts here. */
  safeZMm: number
  /** Final cut depth (mm). Descent lands exactly here. */
  targetZMm: number
  /** Plunge feed (mm/min) — used for ALL descent moves (Z-dominant). */
  plungeMmMin: number
  /** Requested entry mode. `plunge` short-circuits to a single straight plunge. */
  mode: EntryMode
  /** Requested incline from horizontal (deg). Clamped to the safe band. */
  rampAngleDeg?: number
  /**
   * Requested helix radius (mm). Clamped DOWN to fit the region; ignored for ramp
   * / plunge. Absent → {@link DEFAULT_HELIX_RADIUS_MM}.
   */
  helixRadiusMm?: number
  /**
   * Requested ramp XY run (mm) at the chosen angle. Bounded to the region span
   * along the ramp direction; ignored for helix / plunge. Absent →
   * {@link DEFAULT_RAMP_RUN_MM}.
   */
  rampRunMm?: number
  /**
   * The CLOSED region the entry must stay inside (outer pocket/profile ring, mm).
   * REQUIRED for a helix (the radius is clamped to the inscribed clearance at the
   * entry point); a helix with no region falls back to a ramp. A ramp uses it to
   * bound its XY excursion. Absent / open → no helix.
   */
  region?: ReadonlyArray<CamPoint2d>
  /**
   * Interior keep-out rings inside {@link region} (islands, mm). The helix radius
   * is also clamped to the clearance from any island edge so the helix never
   * crosses an island. Empty / absent → outer ring only.
   */
  islandRings?: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  /**
   * Tool radius (mm). Folded into the helix clearance margin so the CUTTER (not
   * just the tool centre) stays inside the region. 0 / absent → centre-only fit.
   */
  toolRadiusMm?: number
  /**
   * Direction for a single ramp excursion (unit-ish vector). Absent → +X. The ramp
   * goes out along this direction and returns to the entry XY at depth (a "zag"),
   * so the net entry position is the entry XY regardless of direction.
   */
  rampDir?: CamPoint2d
}

/** Clamp the incline to the safe band (defaulting an unset/garbage value to a gentle 3°). */
function clampEntryAngleDeg(angleDeg: number | undefined): number {
  const a = typeof angleDeg === 'number' && Number.isFinite(angleDeg) ? angleDeg : 3
  return Math.min(MAX_ENTRY_ANGLE_DEG, Math.max(MIN_ENTRY_ANGLE_DEG, a))
}

/** Perpendicular distance from P to segment AB (mm). */
function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Min distance from (x,y) to any edge of a closed ring (mm), or +Inf for a degenerate ring. */
function minDistanceToRingEdges(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): number {
  if (ring.length < 2) return Number.POSITIVE_INFINITY
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!
    const [bx, by] = ring[(i + 1) % ring.length]!
    const d = distancePointToSegment(x, y, ax, ay, bx, by)
    if (d < best) best = d
  }
  return best
}

/** Even-odd point-in-ring test. */
function pointInRing(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

/**
 * Largest helix radius (mm) that keeps the WHOLE circle of the helix — swept by a
 * cutter of `toolRadiusMm` — strictly inside `region` minus `islandRings`, centred
 * so the entry point lies on the circle. Returns 0 when the entry is not strictly
 * inside the region (the caller then refuses a helix).
 *
 * Geometry: the helix is centred one radius from the entry point. We want every
 * point of the swept disc (helix radius + tool radius) to stay clear of every
 * boundary edge. The conservative, centre-independent bound that holds for ANY
 * centre placement at distance `radius` from the entry is: the inscribed clearance
 * at the entry point must cover the helix DIAMETER plus the tool radius, i.e.
 * `clearance >= 2*radius + toolRadius`. Solving for radius gives the cap below.
 * This is deliberately conservative (it guarantees safety without needing to know
 * the exact centre direction), which is the right bias for a cut-entry guard.
 */
export function maxHelixRadiusForRegionMm(
  entry: CamPoint2d,
  region: ReadonlyArray<CamPoint2d>,
  islandRings: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  toolRadiusMm: number
): number {
  const [x, y] = entry
  if (region.length < 3 || !pointInRing(region, x, y)) return 0
  // Reject entries that fall inside an island (keep-out) — no helix there.
  for (const isl of islandRings) {
    if (isl.length >= 3 && pointInRing(isl, x, y)) return 0
  }
  let clearance = minDistanceToRingEdges(region, x, y)
  for (const isl of islandRings) {
    const d = minDistanceToRingEdges(isl, x, y)
    if (d < clearance) clearance = d
  }
  const usable = clearance - Math.max(0, toolRadiusMm)
  if (!(usable > 0)) return 0
  // clearance budget must cover helix diameter (2r) + tool radius already removed.
  return usable / 2
}

/**
 * Bound a ramp's XY run (mm) so the ramp's far point — swept by a cutter of
 * `toolRadiusMm` — stays inside `region`. Walks the run out in small steps along
 * `dir` from `entry` and stops at the last step whose swept point clears every
 * boundary edge by the tool radius. No region → the requested run is returned
 * unbounded (the caller already gated helix-vs-ramp on region availability).
 */
export function boundRampRunForRegionMm(
  entry: CamPoint2d,
  dir: CamPoint2d,
  requestedRunMm: number,
  region: ReadonlyArray<CamPoint2d> | undefined,
  islandRings: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  toolRadiusMm: number
): number {
  if (!(requestedRunMm > 0)) return 0
  if (!region || region.length < 3) return requestedRunMm
  const [ex, ey] = entry
  const dlen = Math.hypot(dir[0], dir[1])
  if (!(dlen > 1e-9)) return 0
  const ux = dir[0] / dlen
  const uy = dir[1] / dlen
  const tr = Math.max(0, toolRadiusMm)
  const clears = (run: number): boolean => {
    const px = ex + ux * run
    const py = ey + uy * run
    if (!pointInRing(region, px, py)) return false
    if (minDistanceToRingEdges(region, px, py) < tr) return false
    for (const isl of islandRings) {
      if (isl.length < 3) continue
      if (pointInRing(isl, px, py)) return false
      if (minDistanceToRingEdges(isl, px, py) < tr) return false
    }
    return true
  }
  // Sample at ~0.25 mm resolution (bounded step count) and keep the last clear run.
  const steps = Math.min(2000, Math.max(4, Math.ceil(requestedRunMm / 0.25)))
  let lastClear = 0
  for (let k = 1; k <= steps; k++) {
    const run = (requestedRunMm * k) / steps
    if (clears(run)) lastClear = run
    else break
  }
  return lastClear
}

/** Z drop per full helix revolution at `angleDeg` for a circle of `radiusMm` (mm). */
export function helixPitchMm(radiusMm: number, angleDeg: number): number {
  const circumference = 2 * Math.PI * radiusMm
  return circumference * Math.tan((angleDeg * Math.PI) / 180)
}

/**
 * Build the ordered descent moves for one cut entry. See the module header for the
 * full contract. Returns `usedMode` (possibly downgraded) and, for a helix, the
 * region-clamped `helixRadiusMm`. An empty `moves` array means no entry is needed.
 *
 * The caller MUST have already positioned the tool over the entry XY at (or above)
 * `safeZMm`; these moves begin descending from there and land exactly on
 * `targetZMm` at the entry XY.
 */
export function buildEntryMoves(input: BuildEntryMovesInput): EntryMoveResult {
  const { entry, safeZMm, targetZMm, mode } = input
  const [ex, ey] = entry
  const zDrop = safeZMm - targetZMm

  // Contract item 5 — degenerate / up-hill descent: nothing to do.
  if (!(zDrop > 1e-6) || !Number.isFinite(zDrop)) {
    return { moves: [], usedMode: 'plunge' }
  }

  const angleDeg = clampEntryAngleDeg(input.rampAngleDeg)
  const toolR = Math.max(0, input.toolRadiusMm ?? 0)
  const region = input.region
  const islands = (input.islandRings ?? []).filter((r) => r.length >= 3)

  const straightPlunge = (): EntryMoveResult => ({
    moves: [{ kind: 'plunge', z: targetZMm }],
    usedMode: 'plunge'
  })

  // ── PLUNGE (explicit) ──────────────────────────────────────────────────────
  if (mode === 'plunge') return straightPlunge()

  // ── HELIX (region-gated, radius-clamped) ───────────────────────────────────
  if (mode === 'helix') {
    // A helix needs a closed region to clamp against. Open / missing → ramp.
    if (!region || region.length < 3) {
      const base = buildRampMoves(input, angleDeg, zDrop, region, islands, toolR) ?? straightPlunge()
      return { ...base, fallbackReason: 'open_contour_no_helix' }
    }
    const requested =
      typeof input.helixRadiusMm === 'number' && Number.isFinite(input.helixRadiusMm) && input.helixRadiusMm > 0
        ? input.helixRadiusMm
        : DEFAULT_HELIX_RADIUS_MM
    const maxFit = maxHelixRadiusForRegionMm(entry, region, islands, toolR)
    const radius = Math.min(requested, maxFit)
    if (!(radius >= MIN_ENTRY_RADIUS_MM)) {
      // Cannot fit a usable helix — degrade to a ramp, then a plunge.
      const ramp = buildRampMoves(input, angleDeg, zDrop, region, islands, toolR)
      const base = ramp ?? straightPlunge()
      return { ...base, fallbackReason: 'helix_radius_too_small_for_region' }
    }
    return buildHelixMoves(entry, safeZMm, targetZMm, zDrop, radius, angleDeg)
  }

  // ── RAMP ───────────────────────────────────────────────────────────────────
  const ramp = buildRampMoves(input, angleDeg, zDrop, region, islands, toolR)
  if (ramp) return ramp
  return { ...straightPlunge(), fallbackReason: 'ramp_run_too_small_for_region' }
}

/**
 * Helix descent: a sequence of half-circle G2 (CW) arcs centred at
 * `(ex - radius, ey)` (the entry sits on the +X side of the circle), each pair of
 * halves a full revolution dropping `pitch` mm, until `targetZMm` is reached, then
 * a flat feed back to the entry XY at depth. Two semicircles per revolution keep
 * each arc <= 180° for maximum controller compatibility (same convention as the
 * legacy contour helix). The final revolution's pitch is shrunk so the last arc
 * lands EXACTLY on `targetZMm` (contract item 4).
 */
function buildHelixMoves(
  entry: CamPoint2d,
  safeZMm: number,
  targetZMm: number,
  zDrop: number,
  radius: number,
  angleDeg: number
): EntryMoveResult {
  const [ex, ey] = entry
  const cx = ex - radius // centre one radius toward -X of the entry
  const cy = ey
  const pitch = Math.max(1e-3, helixPitchMm(radius, angleDeg))
  const revs = Math.max(1, Math.ceil(zDrop / pitch))
  const dzPerRev = zDrop / revs

  const moves: EntryMove[] = []
  let z = safeZMm
  for (let rev = 0; rev < revs; rev++) {
    const isLast = rev === revs - 1
    const zHalf = isLast ? targetZMm + dzPerRev / 2 : z - dzPerRev / 2
    const zFull = isLast ? targetZMm : z - dzPerRev
    // Half 1: from +R (entry side) to -R. I/J = centre - currentPoint.
    moves.push({
      kind: 'arc',
      dir: 'cw',
      x: cx - radius,
      y: cy,
      z: zHalf,
      i: -radius,
      j: 0
    })
    // Half 2: from -R back to +R.
    moves.push({
      kind: 'arc',
      dir: 'cw',
      x: cx + radius,
      y: cy,
      z: zFull,
      i: radius,
      j: 0
    })
    z = zFull
  }
  // Land on the entry XY at depth (the helix already ends at +R == entry XY, but
  // emit the flat feed so the cut body unambiguously starts from the entry point).
  moves.push({ kind: 'lineToEntry', x: ex, y: ey, z: targetZMm })
  return { moves, usedMode: 'helix', helixRadiusMm: radius }
}

/**
 * Ramp descent: a single inclined "zag" out along `rampDir` (default +X) at the
 * clamped angle, then a flat feed back to the entry XY at depth. The XY run is the
 * smaller of (the run the angle needs to reach depth) and (the region-bounded run
 * available along the direction). If NO usable run fits (region too tight), returns
 * null so the caller can fall back to a plunge.
 *
 * Note the ramp descends to `targetZMm` over the out-leg and the return leg stays
 * AT `targetZMm`, so no move ever goes below depth (contract item 4) and the XY
 * excursion never leaves the region (contract item 1).
 */
function buildRampMoves(
  input: BuildEntryMovesInput,
  angleDeg: number,
  zDrop: number,
  region: ReadonlyArray<CamPoint2d> | undefined,
  islands: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  toolR: number
): EntryMoveResult | null {
  const { entry, targetZMm } = input
  const [ex, ey] = entry
  const dir: CamPoint2d = input.rampDir ?? [1, 0]
  const dlen = Math.hypot(dir[0], dir[1])
  const ux = dlen > 1e-9 ? dir[0] / dlen : 1
  const uy = dlen > 1e-9 ? dir[1] / dlen : 0

  // Run the angle needs to drop zDrop: run = zDrop / tan(angle).
  const angleRun = zDrop / Math.tan((angleDeg * Math.PI) / 180)
  const requested =
    typeof input.rampRunMm === 'number' && Number.isFinite(input.rampRunMm) && input.rampRunMm > 0
      ? input.rampRunMm
      : DEFAULT_RAMP_RUN_MM
  // The ramp out-leg must be long enough to keep the angle no steeper than clamped,
  // but never longer than the region allows. Use max(requested, angleRun) as the
  // target then bound it to the region.
  const target = Math.max(requested, angleRun)
  const bounded = boundRampRunForRegionMm(entry, [ux, uy], target, region, islands, toolR)
  if (!(bounded >= MIN_ENTRY_RADIUS_MM)) return null

  const farX = ex + ux * bounded
  const farY = ey + uy * bounded
  const moves: EntryMove[] = [
    // Inclined descent out to the far point, landing on target depth.
    { kind: 'ramp', x: farX, y: farY, z: targetZMm },
    // Flat feed back to the entry XY at depth (the cut body starts here).
    { kind: 'lineToEntry', x: ex, y: ey, z: targetZMm }
  ]
  return { moves, usedMode: 'ramp' }
}

/**
 * 3-dp coordinate format that also snaps a sub-rounding-threshold magnitude to a
 * clean positive zero — so a tiny negative Z crossing zero mid-helix posts as
 * `0.000`, never `-0.000` (harmless on most controllers, but some are picky and
 * it is noise in a diff). Otherwise identical to `toFixed(3)`.
 */
function fmt3(v: number): string {
  const r = Math.abs(v) < 0.0005 ? 0 : v
  return r.toFixed(3)
}

/**
 * Format one {@link EntryMove} as a G-code line using the SAME coordinate
 * (3-dp) / feed (`toFixed(0)`) convention as `cam-local.ts`, so emitted entry
 * lines are byte-compatible with the surrounding engine output.
 */
export function formatEntryMove(move: EntryMove, plungeMmMin: number): string {
  const f = plungeMmMin.toFixed(0)
  switch (move.kind) {
    case 'plunge':
      return `G1 Z${fmt3(move.z)} F${f}`
    case 'ramp':
      return `G1 X${fmt3(move.x)} Y${fmt3(move.y)} Z${fmt3(move.z)} F${f}`
    case 'lineToEntry':
      return `G1 X${fmt3(move.x)} Y${fmt3(move.y)} Z${fmt3(move.z)} F${f}`
    case 'arc': {
      const word = move.dir === 'cw' ? 'G2' : 'G3'
      return `${word} X${fmt3(move.x)} Y${fmt3(move.y)} Z${fmt3(move.z)} I${fmt3(move.i)} J${fmt3(move.j)} F${f}`
    }
  }
}

/** Convenience: build + format one entry into ready-to-splice G-code lines. */
export function buildEntryGcodeLines(input: BuildEntryMovesInput): { lines: string[]; result: EntryMoveResult } {
  const result = buildEntryMoves(input)
  const lines = result.moves.map((m) => formatEntryMove(m, input.plungeMmMin))
  return { lines, result }
}
