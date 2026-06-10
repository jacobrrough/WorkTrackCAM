/**
 * Offset-spiral (concentric) pocket clearing + island-aware pocket region math
 * for the Laguna Swift 2.5D path.
 *
 * Closes the two top pocketing gaps in docs/plans/catalog/vcarve-laguna.md:
 *   - Toolpaths-Pocket "Pocket (offset / raster)" -- raster zig-zag only, no
 *     spiral/offset clearing (P0): `pocketStrategy: 'offset_spiral'` lands here.
 *   - Toolpaths-Pocket "Islands / pocket-with-holes" (P1): the region model is
 *     `{ outerRing, islandRings? }`; islands are subtracted from the clearable
 *     area (the raster splits scanline spans around them over in `cam-local.ts`).
 *
 * ---------------------------------------------------------------------------
 * REGION MODEL (tool-CENTER geometry -- no cutter compensation)
 * ---------------------------------------------------------------------------
 * A pocket region is `{ outerRing, islandRings? }` in setup WCS mm. Like every
 * other 2.5D generator in this engine (`generatePocket2dLines`,
 * `generateContour2dLines`) the rings are interpreted as TOOL-CENTER
 * boundaries: callers fold cutter radius into the rings (or into
 * `wallStockMm`) themselves. The clearable region is the boolean difference
 * (outer - islands), computed with clipper-lib under the exact conventions
 * established by `src/shared/sketch-boolean-offset.ts`: every input ring is
 * normalised to a CCW solid, combined with Clipper's NonZero fill rule, and
 * mm coordinates are scaled by {@link CLIPPER_SCALE} (1e4 -> 0.1 micron
 * integer resolution; even the Laguna's full 3048 mm bed stays far inside
 * Clipper's safe integer space). Result rings keep the cam-2d-derive contract:
 * outer boundaries CCW (positive area), island holes CW (negative area).
 *
 * ---------------------------------------------------------------------------
 * OFFSET-SPIRAL STRATEGY (a.k.a. concentric / offset clearing)
 * ---------------------------------------------------------------------------
 * Successive ClipperOffset insets of the region at `wallStockMm + k * stepover`
 * (k = 0, 1, 2, ...) until the inset collapses to nothing. Each inset level is
 * a set of closed loops -- outer boundaries shrink inward while island holes
 * grow outward -- and every loop is traced as one closed cut at feed.
 *
 * ORDERING -- INSIDE-OUT (deepest inset first), the conventional order for
 * climb-milled pocket clearing:
 *   - the innermost loop is the only fully-buried (slotting) cut and it is the
 *     shortest one;
 *   - every later loop steps outward by one stepover with its inner side
 *     already cleared, keeping radial engagement at about one stepover;
 *   - the final pass runs along the wall-stock boundary, so the wall sees a
 *     light, consistent last cut before any finish pass;
 *   - chips evacuate into the already-cleared centre.
 *
 * SAFETY -- EVERY loop-to-loop transition lifts to safe Z before the XY rapid
 * (never a bare XY rapid at cut depth). An island can split an inset level
 * into several disjoint loops, and matching loops across levels into connected
 * sub-regions is ambiguous in general, so v1 deliberately links ALL loops via
 * a safe-Z retract (this is also Vectric VCarve's default no-stay-down
 * behaviour). A future enhancement may feed-link concentric loops of a
 * proven-same sub-region to save retracts.
 *
 * PURE -- no I/O, no Electron. Emits the same G-code body dialect as the other
 * `cam-local.ts` generators; the Laguna post (`vcarve_mach3.hbs`) wraps it with
 * `%` markers, G21/G90/G17, spindle warm-up/cool-down, dust M7/M9 and M30.
 */
import ClipperLib, { type IntPoint } from 'clipper-lib'
import { CLIPPER_SCALE } from '../shared/sketch-boolean-offset'
import {
  computeNegativeZDepthPasses,
  generateContour2dLines,
  minRampRunForMaxAngleMm,
  type CamPoint2d,
  type Pocket2dGenerateResult
} from './cam-local'

/** One closed toolpath loop of an inset level (loop is implicitly closed). */
export type PocketOffsetLoop = {
  /** Ordered loop vertices (mm). First/last NOT duplicated. */
  points: ReadonlyArray<CamPoint2d>
  /** True when the loop traces around a (grown) island rather than a shrunken outer boundary. */
  isHole: boolean
}

/** All loops produced by one inset distance of the (outer - islands) region. */
export type PocketOffsetLevel = {
  /** Inset distance from the region boundary for this level (mm). */
  insetMm: number
  loops: PocketOffsetLoop[]
}

/**
 * Hard cap on inset levels so a pathological stepover cannot hang the main
 * process. A full-sheet Laguna pocket (1524 mm narrow span) at the
 * {@link MIN_OFFSET_STEP_MM} floor needs ~15.2k levels, so 20k clears every
 * real job on the target machines while still bounding the loop.
 */
export const POCKET_OFFSET_MAX_LEVELS = 20_000

/**
 * Round-join chord tolerance (mm) for inset arcs. Round joins are used so the
 * offset of a corner is the true arc a cutter sweeps; chords approximate that
 * arc to within this sagitta, so a loop vertex can sit at most this far inside
 * the exact offset (i.e. island clearance is >= inset - 0.01 mm).
 */
const OFFSET_ARC_TOLERANCE_MM = 0.01

/** Floor for the radial step between successive insets (mm) -- main-process guard. */
const MIN_OFFSET_STEP_MM = 0.05

/** Drop result rings with fewer than this many vertices (degenerate slivers). */
const MIN_RING_VERTICES = 3

// ---------------------------------------------------------------------------
// mm <-> Clipper integer space (same conventions as sketch-boolean-offset.ts)
// ---------------------------------------------------------------------------

/** Signed shoelace area (x2) in mm^2. Positive = CCW, negative = CW. */
function signedArea2(points: ReadonlyArray<CamPoint2d>): number {
  const n = points.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s
}

/** Drop consecutive coincident points + any closing duplicate (loop implicitly closed). */
function cleanLoop(pts: ReadonlyArray<CamPoint2d>): CamPoint2d[] {
  const out: CamPoint2d[] = []
  const epsSq = 1e-12
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && (last[0] - p[0]) ** 2 + (last[1] - p[1]) ** 2 <= epsSq) continue
    out.push([p[0], p[1]])
  }
  while (out.length >= 2) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= epsSq) out.pop()
    else break
  }
  return out
}

/** Force a loop CCW (positive shoelace) -- inputs are normalised to solids. */
function toCCW(pts: ReadonlyArray<CamPoint2d>): CamPoint2d[] {
  return signedArea2(pts) >= 0 ? [...pts] : [...pts].reverse()
}

/** mm loop -> Clipper integer path (rounded). */
function toClipperPath(pts: ReadonlyArray<CamPoint2d>): IntPoint[] {
  return pts.map((p) => ({ X: Math.round(p[0] * CLIPPER_SCALE), Y: Math.round(p[1] * CLIPPER_SCALE) }))
}

/** Clipper integer path -> mm loop (cleaned). */
function fromClipperPath(path: ReadonlyArray<IntPoint>): CamPoint2d[] {
  const pts: CamPoint2d[] = path.map((ip) => [ip.X / CLIPPER_SCALE, ip.Y / CLIPPER_SCALE])
  return cleanLoop(pts)
}

// ---------------------------------------------------------------------------
// Region + inset levels
// ---------------------------------------------------------------------------

/**
 * The clearable pocket region (outer - islands) as Clipper integer paths
 * (polygon-with-holes: outer rings CCW, island holes CW per the NonZero
 * difference). Empty array when the outer is degenerate or the islands consume
 * the whole region.
 */
function computePocketRegionPaths(
  outerRing: ReadonlyArray<CamPoint2d>,
  islandRings: ReadonlyArray<ReadonlyArray<CamPoint2d>>
): IntPoint[][] {
  const outer = cleanLoop(outerRing)
  if (outer.length < MIN_RING_VERTICES) return []
  const islands: CamPoint2d[][] = []
  for (const ring of islandRings) {
    const c = cleanLoop(ring)
    if (c.length >= MIN_RING_VERTICES) islands.push(c)
  }
  const clipper = new ClipperLib.Clipper()
  clipper.AddPath(toClipperPath(toCCW(outer)), ClipperLib.PolyType.ptSubject, true)
  if (islands.length > 0) {
    clipper.AddPaths(
      islands.map((r) => toClipperPath(toCCW(r))),
      ClipperLib.PolyType.ptClip,
      true
    )
  }
  const solution: IntPoint[][] = []
  const fill = ClipperLib.PolyFillType.pftNonZero
  clipper.Execute(ClipperLib.ClipType.ctDifference, solution, fill, fill)
  return solution
}

/**
 * Successive concentric insets of the (outer - islands) region at
 * `wallStockMm + k * stepover` until the inset collapses (Clipper returns no
 * loops). Exported so tests can assert the inset-count math and island
 * clearance directly without parsing G-code.
 *
 * Level loops carry `isHole` so callers can tell shrunken outer boundaries
 * (CCW) from grown island loops (CW). Both are cut loops.
 */
export function computeOffsetSpiralLevels(opts: {
  outerRing: ReadonlyArray<CamPoint2d>
  islandRings?: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  stepoverMm: number
  wallStockMm?: number
}): { levels: PocketOffsetLevel[]; cappedLevels: boolean } {
  if (!(opts.stepoverMm > 0) || !Number.isFinite(opts.stepoverMm)) {
    return { levels: [], cappedLevels: false }
  }
  const stock = Math.max(0, opts.wallStockMm ?? 0)
  const step = Math.max(MIN_OFFSET_STEP_MM, opts.stepoverMm)
  const regionPaths = computePocketRegionPaths(opts.outerRing, opts.islandRings ?? [])
  if (regionPaths.length === 0) return { levels: [], cappedLevels: false }

  const arcTol = OFFSET_ARC_TOLERANCE_MM * CLIPPER_SCALE
  const levels: PocketOffsetLevel[] = []
  let cappedLevels = false
  for (let k = 0; ; k++) {
    if (k >= POCKET_OFFSET_MAX_LEVELS) {
      cappedLevels = true
      break
    }
    const insetMm = stock + k * step
    const co = new ClipperLib.ClipperOffset(2, arcTol)
    co.AddPaths(regionPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
    const solution: IntPoint[][] = []
    co.Execute(solution, -insetMm * CLIPPER_SCALE)
    const loops: PocketOffsetLoop[] = []
    for (const path of solution) {
      const pts = fromClipperPath(path)
      if (pts.length < MIN_RING_VERTICES) continue
      loops.push({ points: pts, isHole: signedArea2(pts) < 0 })
    }
    if (loops.length === 0) break // inset collapsed -- region fully covered
    levels.push({ insetMm, loops })
  }
  return { levels, cappedLevels }
}

// ---------------------------------------------------------------------------
// G-code emission
// ---------------------------------------------------------------------------

export type PocketOffsetSpiral2dParams = {
  /** Closed outer pocket boundary in setup WCS (mm, tool-center geometry). */
  outerRing: ReadonlyArray<CamPoint2d>
  /** Optional interior island rings (keep-out polygons inside the pocket). */
  islandRings?: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  /** Radial distance between successive inset loops (mm). */
  stepoverMm: number
  zPassMm: number
  /** Optional step-down increment (mm); default single depth at zPassMm. */
  zStepMm?: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Optional radial stock to leave on ALL walls (outer + islands). */
  wallStockMm?: number
  /** Optional finish contour (outer ring) at each depth step. */
  finishEachDepth?: boolean
  /** Per-loop entry mode (same semantics as the raster pocket). */
  entryMode?: 'plunge' | 'ramp'
  /** Ramp run length in XY (mm) when `entryMode` is `ramp`. */
  rampMm?: number
  /**
   * Max ramp angle from horizontal (degrees). XY run is lengthened (up to the
   * loop's first-segment span) so atan2(|dZ|, run) <= this value when
   * possible. Default 45 (same contract as the raster pocket).
   */
  rampMaxAngleDeg?: number
}

/**
 * Offset-spiral pocket clearing body. See the module doc for the region model,
 * the inside-out ordering rationale and the per-loop safe-Z link invariant.
 *
 * Collapse (an inset larger than the region's half-width) and degenerate input
 * yield an EMPTY result (`lines: []`) and never throw -- the dispatcher
 * surfaces the geometry hint exactly as it does for an empty raster pocket.
 *
 * The caller passes `zPassMm` already capped to the stock thickness
 * (see `dispatch2dStrategy`) -- this generator never deepens it.
 */
export function generatePocketOffsetSpiralLines(params: PocketOffsetSpiral2dParams): Pocket2dGenerateResult {
  const hints: string[] = []
  const { levels, cappedLevels } = computeOffsetSpiralLevels({
    outerRing: params.outerRing,
    islandRings: params.islandRings ?? [],
    stepoverMm: params.stepoverMm,
    wallStockMm: params.wallStockMm ?? 0
  })
  if (levels.length === 0) return { lines: [], hints }
  if (cappedLevels) {
    hints.push(
      `Pocket offset-spiral: inset levels were capped at ${POCKET_OFFSET_MAX_LEVELS.toLocaleString()} for this region size -- increase stepoverMm for full coverage.`
    )
  }

  const stock = Math.max(0, params.wallStockMm ?? 0)
  const step = Math.max(MIN_OFFSET_STEP_MM, params.stepoverMm)
  const stepDown = Math.max(0.01, Math.abs(params.zStepMm ?? params.zPassMm))
  const depths = computeNegativeZDepthPasses(params.zPassMm, stepDown)
  const entryMode = params.entryMode === 'ramp' ? 'ramp' : 'plunge'
  const rampMm = Math.max(0.01, params.rampMm ?? 2)
  const rampMaxAngleDeg =
    typeof params.rampMaxAngleDeg === 'number' && Number.isFinite(params.rampMaxAngleDeg)
      ? params.rampMaxAngleDeg
      : 45
  let rampExtendedForAngle = false
  let rampSteepDespiteSpan = false

  const totalLoops = levels.reduce((n, l) => n + l.loops.length, 0)
  const lines: string[] = []
  lines.push(
    `; Pocket offset-spiral -- ${levels.length} inset level(s), ${totalLoops} loop(s), inside-out, stepover ${step.toFixed(3)} mm, wall stock ${stock.toFixed(3)} mm`
  )

  for (const z of depths) {
    const zDrop = Math.abs(params.safeZMm - z)
    const minRunForAngle = minRampRunForMaxAngleMm(zDrop, rampMaxAngleDeg)
    // INSIDE-OUT: deepest inset level first (climb convention -- module doc).
    for (let li = levels.length - 1; li >= 0; li--) {
      for (const loop of levels[li]!.loops) {
        const pts = loop.points
        const [x0, y0] = pts[0]!
        // EVERY loop transition is a safe-Z lift before the XY rapid -- an
        // island can split a level into disjoint loops, so no XY motion ever
        // happens at cut depth between loops.
        lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)
        lines.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)}`)
        if (entryMode === 'ramp' && pts.length >= 2) {
          const [x1, y1] = pts[1]!
          const span = Math.hypot(x1 - x0, y1 - y0)
          const requested = Math.min(rampMm, span)
          let run: number
          if (minRunForAngle > span + 1e-6) {
            run = span
            rampSteepDespiteSpan = true
          } else {
            run = Math.min(span, Math.max(requested, minRunForAngle))
            if (run > requested + 1e-3) rampExtendedForAngle = true
          }
          const ux = span > 1e-9 ? (x1 - x0) / span : 1
          const uy = span > 1e-9 ? (y1 - y0) / span : 0
          // Ramp out along the loop's first segment, then feed back to the
          // start at depth (the back-track recuts the ramp floor flat).
          lines.push(
            `G1 X${(x0 + ux * run).toFixed(3)} Y${(y0 + uy * run).toFixed(3)} Z${z.toFixed(3)} F${params.plungeMmMin.toFixed(0)}`
          )
          lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
        } else {
          lines.push(`G1 Z${z.toFixed(3)} F${params.plungeMmMin.toFixed(0)}`)
        }
        for (let i = 1; i < pts.length; i++) {
          const [x, y] = pts[i]!
          lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
        }
        // Close the loop.
        lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${params.feedMmMin.toFixed(0)}`)
      }
    }
    if (params.finishEachDepth === true) {
      lines.push(
        ...generateContour2dLines({
          contourPoints: params.outerRing,
          zPassMm: z,
          feedMmMin: params.feedMmMin,
          plungeMmMin: params.plungeMmMin,
          safeZMm: params.safeZMm
        })
      )
    }
  }
  lines.push(`G0 Z${params.safeZMm.toFixed(3)}`)

  if (entryMode === 'ramp') {
    if (rampExtendedForAngle) {
      hints.push(
        `Pocket ramp: XY run was lengthened (within each loop's first segment) to stay within rampMaxAngleDeg (${rampMaxAngleDeg.toFixed(0)} deg) versus safe-Z to cut depth.`
      )
    }
    if (rampSteepDespiteSpan) {
      hints.push(
        `Pocket ramp: some loop first-segments are shorter than the horizontal run needed for rampMaxAngleDeg (${rampMaxAngleDeg.toFixed(0)} deg); those entries may be steeper than the limit.`
      )
    }
  }
  return { lines, hints }
}
