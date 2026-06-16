/**
 * cam-arc-fit — TRUE-ARC fitting for the 2D CAM engine (CNC routers only).
 *
 * The 2D toolpath engine in `cam-local.ts` linearizes every curved loop into a
 * dense chain of short G1 segments (a circular pocket boundary becomes dozens of
 * straight chords). On controllers that support G2/G3 (Laguna Swift / RichAuto,
 * Makera Carvera-3 / Smoothieware) those chords are wasteful and leave faceting
 * marks. This module detects runs of consecutive polyline points that lie on a
 * common circle within a tight chord tolerance and reports them as a single arc
 * so the caller can emit ONE G2/G3 instead of the G1 chain.
 *
 * Design contract (all enforced by `fitArcsFromPolyline` + its tests):
 *
 *   1. **Tolerance-gated, never-degrade.** A run becomes an arc ONLY when EVERY
 *      point in the run is within `chordTolMm` of the fitted circle AND the run
 *      sweeps at least `minArcSweepDeg`. When no arc fits, the points come back
 *      as plain `line` segments — byte-for-byte the same moves the caller would
 *      have emitted from the raw polyline. Worst case == current output.
 *
 *   2. **Every emitted arc is geometrically VALID.** The arc `center` is the
 *      least-squares circle centre of the run and `radius` is the mean point
 *      radius, but the emitted arc's endpoints (`to`, and the run's start which
 *      the caller already holds) are ACTUAL input points. The acceptance gate
 *      requires |start − center| and |end − center| to each equal `radius`
 *      within `chordTolMm`, so the IJK form the caller derives (I,J = centre −
 *      start) describes a circle the controller can actually execute. This is
 *      the direct guard against the Cycle-261 malformed-arc lesson
 *      (`cam-local.ts:1013/1066`) where centre==endpoint produced |end−C|==0.
 *
 *   3. **Collinear / near-straight runs are NOT arcs.** A run whose points are
 *      (nearly) collinear has a radius → ∞; the fit is rejected by an explicit
 *      sagitta/curvature guard so a straight edge is never emitted as a
 *      pathologically huge-radius arc.
 *
 *   4. **Pure & deterministic.** No input mutation, no globals, no RNG; the same
 *      input always yields the same segment list.
 *
 * This module owns geometry only. It does NOT format G-code, choose feeds, or
 * touch Z — the caller (`generateContour2dLines`) keeps full control of those.
 */

/** A 2D point in setup WCS (mm). Matches `CamPoint2d` in `cam-local.ts`. */
export type ArcFitPoint = readonly [number, number]

/** Arc winding direction. `cw` posts as G2, `ccw` posts as G3 (G17 / XY plane). */
export type ArcDir = 'cw' | 'ccw'

/**
 * One fitted segment. `line` is a straight move to `to`; `arc` is a circular
 * move to `to` about `center` with the given `radius` and winding `dir`. The
 * implicit start of each segment is the previous segment's `to` (or the
 * polyline's first point for the first segment) — exactly the modal-position
 * model G-code uses.
 */
export type ArcFitSegment =
  | { kind: 'line'; to: ArcFitPoint }
  | { kind: 'arc'; to: ArcFitPoint; center: ArcFitPoint; radius: number; dir: ArcDir }

/** Tuning for {@link fitArcsFromPolyline}. */
export type ArcFitOptions = {
  /**
   * Max deviation (mm) between any point in a candidate run and the fitted
   * circle. Also the slack used by the validity gate on |start−C| and |end−C|.
   * Must be > 0; a non-positive value disables arc fitting (all lines).
   */
  chordTolMm: number
  /**
   * Minimum total sweep angle (degrees) a run must subtend at the fitted centre
   * to be worth an arc. Guards against emitting an arc for a tiny near-straight
   * nub. Default 5°.
   */
  minArcSweepDeg?: number
  /**
   * Minimum number of points (INCLUDING both endpoints) in a run before it can
   * be an arc. A circle fit needs 3; default 4 so a single rounded corner of a
   * coarse polygon doesn't masquerade as an arc. Clamped to >= 3.
   */
  minPoints?: number
  /**
   * Max angle (degrees) any SINGLE consecutive-point step may subtend at the
   * fitted centre. This is the discriminator between a densely-sampled true arc
   * and a coarse polygon whose vertices merely happen to be co-circular: a
   * rectangle's four corners lie on their circumscribed circle, but each step
   * subtends 90° — far coarser than any real arc tessellation. The toolpath
   * between two vertices is a straight chord, so a large per-step angle means
   * the chord deviates from the circle by more than the chord tolerance over the
   * cut and MUST stay a line. Default 30°. (A point at the chord midpoint of a
   * step subtending θ departs the circle by r·(1−cos(θ/2)); at 30° that is
   * ~3.4% of r, already a visible facet — runs above this are rejected.)
   */
  maxStepDeg?: number
}

const DEFAULT_MIN_ARC_SWEEP_DEG = 5
const DEFAULT_MIN_POINTS = 4
const DEFAULT_MAX_STEP_DEG = 30

/**
 * Least-squares circle fit (Kåsa method) over `pts[start..end]` inclusive.
 * Solves the linear system for centre (cx,cy) minimising algebraic distance,
 * then takes the radius as the mean geometric distance to that centre. Returns
 * null when the normal equations are singular (all points coincident or exactly
 * collinear → radius would be infinite).
 */
function fitCircleLeastSquares(
  pts: ReadonlyArray<ArcFitPoint>,
  start: number,
  end: number
): { cx: number; cy: number; r: number } | null {
  const n = end - start + 1
  if (n < 3) return null

  // Centre the data for numerical conditioning (subtract the run centroid).
  let mx = 0
  let my = 0
  for (let i = start; i <= end; i++) {
    mx += pts[i]![0]
    my += pts[i]![1]
  }
  mx /= n
  my /= n

  // Kåsa: minimise sum( (u^2+v^2) - (A u + B v + C) )^2 over u=x-mx, v=y-my.
  let suu = 0
  let suv = 0
  let svv = 0
  let suuu = 0
  let svvv = 0
  let suvv = 0
  let svuu = 0
  for (let i = start; i <= end; i++) {
    const u = pts[i]![0] - mx
    const v = pts[i]![1] - my
    const uu = u * u
    const vv = v * v
    suu += uu
    svv += vv
    suv += u * v
    suuu += uu * u
    svvv += vv * v
    suvv += u * vv
    svuu += v * uu
  }

  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-12) return null // collinear / coincident → singular

  const c1 = 0.5 * (suuu + suvv)
  const c2 = 0.5 * (svvv + svuu)
  // Solve [suu suv; suv svv] [uc; vc] = [c1; c2].
  const uc = (c1 * svv - c2 * suv) / det
  const vc = (suu * c2 - suv * c1) / det

  const cx = uc + mx
  const cy = vc + my

  let r = 0
  for (let i = start; i <= end; i++) {
    r += Math.hypot(pts[i]![0] - cx, pts[i]![1] - cy)
  }
  r /= n
  if (!Number.isFinite(r) || r <= 0) return null
  return { cx, cy, r }
}

/**
 * Total signed sweep (radians) walking `pts[start..end]` around centre (cx,cy).
 * Sums the signed delta-angle between consecutive points (each in (−π,π]) so the
 * magnitude is the true subtended sweep and the sign is the winding (positive =
 * CCW). Robust to runs that exceed a semicircle (no atan2-endpoint aliasing).
 */
function signedSweepRad(
  pts: ReadonlyArray<ArcFitPoint>,
  start: number,
  end: number,
  cx: number,
  cy: number
): number {
  let total = 0
  let prev = Math.atan2(pts[start]![1] - cy, pts[start]![0] - cx)
  for (let i = start + 1; i <= end; i++) {
    const a = Math.atan2(pts[i]![1] - cy, pts[i]![0] - cx)
    let d = a - prev
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    total += d
    prev = a
  }
  return total
}

/**
 * Decide whether `pts[start..end]` is a genuine, machinable circular arc on the
 * fitted circle (cx,cy,r). THREE independent gates, all must pass:
 *
 *  1. **Radial validity** — every point (both endpoints included) sits within
 *     `tol` of the circle. This is simultaneously the |start−C|==r and
 *     |end−C|==r controller-executable-arc check (contract item 2).
 *
 *  2. **Per-step coarseness** — NO consecutive-point step subtends more than
 *     `maxStepRad` at the centre. This is the decisive guard against a COARSE
 *     POLYGON whose vertices merely happen to be co-circular (a rectangle's four
 *     corners lie on their circumscribed circle, each step 90°). The actual
 *     toolpath between two vertices is a straight chord; if the step is coarse
 *     the chord bows away from the circle by far more than `tol` over the cut, so
 *     the run is NOT a faithful arc and must stay lines. A real CAM
 *     tessellation samples every few degrees and passes easily.
 *
 *  3. **Real curvature (sagitta)** — the max perpendicular departure of the
 *     intermediate points from the start→end chord must exceed `tol`, so a
 *     dead-straight run (least-squares still returns a huge-radius circle for it)
 *     is rejected as a line (radius → ∞ guard, contract item 3). Skipped for a
 *     (near-)closed run (chord ≈ 0, e.g. a full loop) where gates 1+2 plus the
 *     caller's sweep gate already establish a genuine arc.
 */
function runFitsCircle(
  pts: ReadonlyArray<ArcFitPoint>,
  start: number,
  end: number,
  cx: number,
  cy: number,
  r: number,
  tol: number,
  maxStepRad: number
): boolean {
  // Gate 1 — radial deviation for EVERY point (endpoint validity included).
  for (let i = start; i <= end; i++) {
    const d = Math.hypot(pts[i]![0] - cx, pts[i]![1] - cy)
    if (Math.abs(d - r) > tol) return false
  }
  // Gate 2 — per-step subtended angle (the coarse-polygon discriminator).
  let prevA = Math.atan2(pts[start]![1] - cy, pts[start]![0] - cx)
  for (let i = start + 1; i <= end; i++) {
    const a = Math.atan2(pts[i]![1] - cy, pts[i]![0] - cx)
    let d = a - prevA
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    if (Math.abs(d) > maxStepRad) return false
    prevA = a
  }
  // Gate 3 — real curvature (sagitta vs the start→end chord).
  const ax = pts[start]![0]
  const ay = pts[start]![1]
  const bx = pts[end]![0]
  const by = pts[end]![1]
  const chordX = bx - ax
  const chordY = by - ay
  const chordLen = Math.hypot(chordX, chordY)
  if (chordLen < 1e-9) {
    // (Near-)closed run: chord degenerate; gates 1+2 + the caller's sweep gate
    // already establish a genuine arc (a full loop is legitimate).
    return true
  }
  let maxSagitta = 0
  for (let i = start + 1; i < end; i++) {
    const cross = Math.abs((pts[i]![0] - ax) * chordY - (pts[i]![1] - ay) * chordX)
    const perp = cross / chordLen
    if (perp > maxSagitta) maxSagitta = perp
  }
  return maxSagitta > tol
}

/**
 * Greedily fit maximal circular-arc runs over an ordered polyline, returning an
 * ordered list of `line` / `arc` segments that, walked from `points[0]`,
 * reproduce the polyline. See the module header for the full contract.
 *
 * The walk is left-to-right and greedy-maximal: from each anchor it extends the
 * run as far as the circle keeps fitting (every point within `chordTolMm`), then
 * commits the longest run that ALSO clears the sweep + min-point gates as one
 * arc; otherwise it emits a single `line` step and advances by one. This is
 * O(n · run) and deterministic.
 *
 * @param points Ordered polyline vertices (>= 1). For a CLOSED loop pass the
 *   ring with the first point repeated as the last so the closing segment is
 *   considered for fitting too. With < 2 points the result is empty.
 */
export function fitArcsFromPolyline(
  points: ReadonlyArray<ArcFitPoint>,
  options: ArcFitOptions
): ArcFitSegment[] {
  const out: ArcFitSegment[] = []
  if (points.length < 2) return out

  const tol = options.chordTolMm
  const minSweepDeg = options.minArcSweepDeg ?? DEFAULT_MIN_ARC_SWEEP_DEG
  const minPoints = Math.max(3, Math.floor(options.minPoints ?? DEFAULT_MIN_POINTS))
  const minSweepRad = (Math.max(0, minSweepDeg) * Math.PI) / 180
  const maxStepRad = (Math.max(1, options.maxStepDeg ?? DEFAULT_MAX_STEP_DEG) * Math.PI) / 180

  // Tolerance gate disabled → pure linear passthrough (worst-case == today).
  if (!(tol > 0) || !Number.isFinite(tol)) {
    return emitAllLines(points)
  }

  let i = 0
  const lastIdx = points.length - 1
  while (i < lastIdx) {
    // Try to grow the longest fitting arc run anchored at i. Need minPoints
    // points, i.e. end index >= i + (minPoints - 1).
    let bestEnd = -1
    let bestCircle: { cx: number; cy: number; r: number } | null = null

    if (i + (minPoints - 1) <= lastIdx) {
      // Extend the window one point at a time; keep the largest end that fits.
      for (let end = i + (minPoints - 1); end <= lastIdx; end++) {
        const circle = fitCircleLeastSquares(points, i, end)
        if (!circle) break // became singular (collinear) — stop growing
        if (!runFitsCircle(points, i, end, circle.cx, circle.cy, circle.r, tol, maxStepRad)) {
          // This end doesn't fit. Once a window fails we stop: extending further
          // only adds more points to an already-broken fit. (Greedy-maximal.)
          break
        }
        bestEnd = end
        bestCircle = circle
      }
    }

    if (bestEnd >= 0 && bestCircle) {
      // Confirm the sweep gate on the committed run before accepting the arc.
      const sweep = signedSweepRad(points, i, bestEnd, bestCircle.cx, bestCircle.cy)
      if (Math.abs(sweep) >= minSweepRad) {
        out.push({
          kind: 'arc',
          to: points[bestEnd]!,
          center: [bestCircle.cx, bestCircle.cy],
          radius: bestCircle.r,
          // Positive signed sweep is CCW (G3); negative is CW (G2).
          dir: sweep >= 0 ? 'ccw' : 'cw'
        })
        i = bestEnd
        continue
      }
    }

    // No acceptable arc from i → emit a single straight step and advance.
    out.push({ kind: 'line', to: points[i + 1]! })
    i += 1
  }

  return out
}

/** All points as straight `line` segments (the no-fit / disabled-tolerance path). */
function emitAllLines(points: ReadonlyArray<ArcFitPoint>): ArcFitSegment[] {
  const out: ArcFitSegment[] = []
  for (let i = 1; i < points.length; i++) out.push({ kind: 'line', to: points[i]! })
  return out
}
