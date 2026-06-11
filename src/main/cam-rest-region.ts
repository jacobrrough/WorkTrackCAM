/**
 * Stack C v1 — REST-MACHINING REGION SOLVER for the 2D CNC path (Laguna Swift
 * primary; Carvera 3-axis shares the same 2D dispatch).
 *
 * Closes the audit row "Rest machining (2nd tool): missing for 2D": when an op
 * carries `restPrevToolDiameterMm` (a PREVIOUS, larger tool that already
 * roughed the pocket), the engine must clear ONLY the REST REGION — the
 * material the previous tool provably could not reach (square corners, narrow
 * channels, tight features) — instead of re-cutting the whole pocket with the
 * small tool.
 *
 * ---------------------------------------------------------------------------
 * THE MATH (pure clipper, the conventions of src/shared/sketch-boolean-offset)
 * ---------------------------------------------------------------------------
 * Let R = the pocket region: (outerRing − islandRings), inset by wallStockMm.
 *
 *   reachable_prev = morphological OPENING of R by the previous TOOL RADIUS
 *                  = dilate( erode(R, prevR), prevR )
 *     erode  : ClipperOffset −prevR, ROUND joins → the set of valid previous-
 *              tool CENTER positions inside R;
 *     dilate : ClipperOffset +prevR, ROUND joins → the area those centers
 *              actually SWEPT (round joins so a corner sweep is the true arc).
 *
 *   rest = R − reachable_prev   (clipper NonZero difference)
 *
 * A square pocket corner is the canonical case: a tool of radius prevR cannot
 * reach into it, leaving an unreachable corner lobe of area (1 − π/4)·prevR²
 * (-ish; exact for a square corner with leg length ≥ prevR). If the previous
 * tool could not enter R ANYWHERE (erosion collapses), the entire region is
 * rest material — returned whole, with a loud hint.
 *
 * ---------------------------------------------------------------------------
 * DOWNSTREAM CONTRACT (compose, do not reinvent)
 * ---------------------------------------------------------------------------
 * Each rest polygon is decomposed into the region model the EXISTING 2.5D
 * generators consume (`generatePocket2dLines` raster, the cam-pocket-offset
 * `offset_spiral`, the Stack-B `generateAdaptiveClearing2dLines`): the rest
 * polygon's outer ring becomes a region `outerRing`; its holes become
 * `islandRings`. The consuming generator is fed one region per rest polygon.
 *
 *  - The rest polygons are NOT inset by the CURRENT tool here. The 2.5D region
 *    model is tool-center geometry — the consuming generator's own stepover /
 *    wallStock progression IS its tool-geometry handling on whatever region it
 *    is given. Eroding/dilating by the current radius is NOT the v1 model.
 *  - `wallStockMm` is applied HERE (R is inset by it before the opening), so
 *    the returned boundaries already sit on the wall-stock line where they
 *    touch real walls. Pass `wallStockMm: 0` to the consuming generator —
 *    re-applying it would double-inset, and most of a rest boundary is the
 *    previous tool's swept arc (AIR on the far side), not a wall.
 *  - Composing into `cnc_adaptive` preserves its result contract untouched:
 *    `adaptiveClearedToWalls` still gates the dispatcher's finish pass per
 *    region (this solver only supplies geometry; it never overrides that
 *    flag). HONESTY NOTE (verified): corner-lobe rest regions are CUSPED
 *    (they taper to zero width at the wall tangent points), which Stack-B v1
 *    classifies as a narrow region beyond spine coverage — it SKIPS them with
 *    a hint and without `adaptiveClearedToWalls: true`, so the finish gate
 *    stays closed. The cnc_pocket strategies (raster / offset_spiral) are the
 *    natural rest consumers; the offset spiral provably covers the lobes.
 *  - REST-MODE FINISH PASS: NO outer-wall finish trace. The pocket wall was
 *    already finished by the previous (larger) tool's op; re-tracing it with
 *    the small tool is wasted air / wall burnishing at best, and at worst a
 *    full-perimeter pass the operator did not ask for. The solver pushes
 *    {@link REST_SKIP_WALL_FINISH_HINT} whenever it returns regions so the
 *    operator (and the Wire-phase dispatcher) see the rule.
 *
 * ---------------------------------------------------------------------------
 * EDGE HANDLING (honest, never throws)
 * ---------------------------------------------------------------------------
 *  - Invalid `prevToolDiameterMm` (NaN / ≤ 0) → empty + hint.
 *  - `toolDiameterMm` (current tool, optional) provided and
 *    `prevToolDiameterMm <= toolDiameterMm` → rest machining requires a larger
 *    previous tool: empty + hint (an equal/smaller previous tool left nothing
 *    only this tool can reach).
 *  - Degenerate region (no closed outer, islands consume it, wall stock
 *    consumes it) → empty + hint.
 *  - Rest polygons with NET area below {@link REST_MIN_AREA_MM2}, OR thinner
 *    than {@link REST_MIN_FEATURE_WIDTH_MM} everywhere (they vanish when
 *    eroded by half that width), are dropped with a hint — un-machinable
 *    dust. Both floors are needed: chord-approximation specks along the
 *    previous tool's swept arcs can CHAIN through integer-precision hairline
 *    corridors into long boundary strips whose total area beats the area
 *    floor while remaining ~0.01 mm thin (observed on a 64-gon circle
 *    fixture) — the width floor catches those.
 *  - Previous tool reached everything (opening covers R) → empty + the
 *    "previous tool left nothing this tool can reach" hint.
 *  - DETERMINISTIC: pure function of params (no RNG/clock/I-O); regions are
 *    canonically ordered (bbox min-X, then min-Y, then descending area).
 *
 * Wiring this solver into `dispatch2dStrategy` / `manufacture-schema` / the op
 * editor is the Wire phase — this module is standalone until then.
 */
import ClipperLib, { type IntPoint } from 'clipper-lib'
import { CLIPPER_SCALE } from '../shared/sketch-boolean-offset'
import type { CamPoint2d } from './cam-local'

// ---------------------------------------------------------------------------
// Public types / constants
// ---------------------------------------------------------------------------

/** One clearable rest region in the 2.5D generators' region model. */
export type RestRegion = {
  /** Closed outer boundary of the rest polygon (mm, CCW; implicitly closed). */
  outerRing: CamPoint2d[]
  /**
   * Holes of the rest polygon as island keep-outs (mm, CCW solids — the
   * generators winding-normalise their `islandRings` input anyway).
   */
  islandRings: CamPoint2d[][]
}

export type SolveRestRegionParams = {
  /** Closed outer pocket boundary in setup WCS (mm, the generators' ring space). */
  outerRing: ReadonlyArray<CamPoint2d>
  /** Optional interior island rings (keep-out polygons inside the pocket). */
  islandRings?: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  /** Optional radial stock to leave on ALL walls — applied HERE (module doc). */
  wallStockMm?: number
  /** Diameter (mm) of the PREVIOUS, larger tool that already roughed the pocket. */
  prevToolDiameterMm: number
  /**
   * Optional CURRENT tool diameter (mm) for the honesty gate: when provided
   * and `prevToolDiameterMm <= toolDiameterMm`, rest machining is degenerate
   * (nothing only the smaller tool could reach) → empty result + hint.
   */
  toolDiameterMm?: number
}

export type SolveRestRegionResult = {
  /** Rest polygons, one region per polygon, canonically ordered. Possibly empty. */
  regions: RestRegion[]
  /** User-facing CAM notes (degenerate inputs, dropped slivers, finish-pass rule). */
  hints: string[]
}

/**
 * NET-area floor (mm²) below which a rest polygon is dropped as un-machinable
 * dust. 0.01 mm² ≈ a 0.1 × 0.1 mm patch — far below the engagement of any
 * real cutter on the target machines, and an order of magnitude above the
 * chord-approximation slivers (sagitta ≤ 0.01 mm) the round-join offsets can
 * shed along the previous tool's swept arcs.
 */
export const REST_MIN_AREA_MM2 = 0.01

/**
 * Width floor (mm) for the dust test: a rest polygon that VANISHES when
 * eroded by half this width is thinner than 0.05 mm everywhere — cosmetic
 * fuzz no cutter in the shop can pick up. Needed in addition to the area
 * floor because integer-precision hairline corridors can chain sub-area-floor
 * specks along the previous tool's swept arcs into long thin strips whose
 * TOTAL area beats {@link REST_MIN_AREA_MM2} (observed: the opening of a
 * 64-gon circle leaves ~0.01 mm-thin boundary strips).
 */
export const REST_MIN_FEATURE_WIDTH_MM = 0.05

/**
 * Standing rest-mode rule, pushed whenever rest regions are returned and
 * exported for the Wire-phase dispatcher to gate on: rest ops must NOT trace
 * the outer pocket wall as a finish pass — the previous (larger) tool's op
 * already finished that wall, so a re-trace with the small tool is wasted air
 * / burnishing at best.
 */
export const REST_SKIP_WALL_FINISH_HINT =
  'Rest pass: no outer-wall finish trace — the pocket wall was already finished by the previous (larger) tool, so re-tracing it with this tool is wasted air/burnishing. Only the rest regions are cleared.'

/** Round-join chord tolerance (mm) for the opening offsets (3i engine parity). */
const OFFSET_ARC_TOLERANCE_MM = 0.01

/** Drop rings with fewer than this many vertices (degenerate slivers). */
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
// Clipper plumbing (int-space pipeline; convert to mm only at decomposition)
// ---------------------------------------------------------------------------

/**
 * The pocket region (outer - islands) as Clipper integer paths
 * (polygon-with-holes: outers positive, holes negative under NonZero) — the
 * exact construction the 3i offset-spiral engine uses. Empty when the outer is
 * degenerate or the islands consume the whole region.
 */
function computeRegionPaths(
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

/** Offset a polygon-with-holes path set by `deltaMm` (ROUND joins, closed polys). */
function offsetPathsMm(paths: ReadonlyArray<IntPoint[]>, deltaMm: number): IntPoint[][] {
  const co = new ClipperLib.ClipperOffset(2, OFFSET_ARC_TOLERANCE_MM * CLIPPER_SCALE)
  co.AddPaths([...paths], ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const solution: IntPoint[][] = []
  co.Execute(solution, deltaMm * CLIPPER_SCALE)
  return solution
}

/**
 * NonZero boolean difference of two polygon-with-holes path sets.
 *
 * STRICTLY SIMPLE (load-bearing): `rest = region − reachable` shares its
 * boundary with `region` along every real wall (the previous tool sweeps
 * exactly up to the wall line), and Clipper's default output happily returns
 * two corner lobes JOINED through a zero-width corridor running along that
 * shared wall — one self-touching path instead of two separate polygons.
 * `StrictlySimple` makes Clipper split those into simple rings, so each rest
 * polygon decomposes into its own region (verified empirically: the 60x40 /
 * prev-Ø12 fixture returns 4 separate ~7.79 mm² corner lobes instead of 2
 * wall-spanning double-lobes).
 */
function differencePaths(
  subject: ReadonlyArray<IntPoint[]>,
  clip: ReadonlyArray<IntPoint[]>
): IntPoint[][] {
  const clipper = new ClipperLib.Clipper()
  clipper.StrictlySimple = true
  clipper.AddPaths([...subject], ClipperLib.PolyType.ptSubject, true)
  if (clip.length > 0) clipper.AddPaths([...clip], ClipperLib.PolyType.ptClip, true)
  const solution: IntPoint[][] = []
  const fill = ClipperLib.PolyFillType.pftNonZero
  clipper.Execute(ClipperLib.ClipType.ctDifference, solution, fill, fill)
  return solution
}

/** Even-odd point-in-ring test in Clipper integer space. */
function pointInIntRing(ring: ReadonlyArray<IntPoint>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a.Y > y !== b.Y > y && x < ((b.X - a.X) * (y - a.Y)) / (b.Y - a.Y) + a.X) inside = !inside
  }
  return inside
}

/** Majority-of-vertices containment (robust against boundary-touching vertices). */
function ringInsideRing(inner: ReadonlyArray<IntPoint>, outer: ReadonlyArray<IntPoint>): boolean {
  let inside = 0
  for (const p of inner) {
    if (pointInIntRing(outer, p.X, p.Y)) inside++
  }
  return inside * 2 > inner.length
}

// ---------------------------------------------------------------------------
// Decomposition: rest paths -> Array<{ outerRing, islandRings }>
// ---------------------------------------------------------------------------

type IndexedRing = {
  path: IntPoint[]
  /** Signed area in mm² (positive = outer/solid, negative = hole). */
  areaMm2: number
  bboxMinX: number
  bboxMinY: number
}

function indexRing(path: IntPoint[]): IndexedRing {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const p of path) {
    if (p.X < minX) minX = p.X
    if (p.Y < minY) minY = p.Y
  }
  return {
    path,
    areaMm2: ClipperLib.Clipper.Area(path) / (CLIPPER_SCALE * CLIPPER_SCALE),
    bboxMinX: minX / CLIPPER_SCALE,
    bboxMinY: minY / CLIPPER_SCALE
  }
}

/**
 * Decompose a Clipper polygon-with-holes solution into per-polygon regions:
 * each positive (outer) ring becomes a region; each negative (hole) ring is
 * assigned to the SMALLEST positive ring that contains it (correct under
 * arbitrary nesting depth — a solid nested inside a hole is its own region).
 * Dust is dropped with a counted hint: regions whose NET area (outer − holes)
 * is below `minAreaMm2`, and regions thinner than
 * {@link REST_MIN_FEATURE_WIDTH_MM} everywhere (they vanish under erosion by
 * half that width).
 */
function decomposeRestPaths(
  paths: IntPoint[][],
  minAreaMm2: number
): { regions: RestRegion[]; droppedSlivers: number } {
  const outers: IndexedRing[] = []
  const holes: IndexedRing[] = []
  for (const path of paths) {
    if (path.length < MIN_RING_VERTICES) continue
    const ring = indexRing(path)
    if (Math.abs(ring.areaMm2) <= 0) continue
    if (ring.areaMm2 > 0) outers.push(ring)
    else holes.push(ring)
  }

  const holesByOuter = new Map<IndexedRing, IndexedRing[]>()
  for (const hole of holes) {
    let best: IndexedRing | null = null
    for (const outer of outers) {
      // The container must be bigger than the hole and actually contain it.
      if (outer.areaMm2 < Math.abs(hole.areaMm2)) continue
      if (!ringInsideRing(hole.path, outer.path)) continue
      if (best === null || outer.areaMm2 < best.areaMm2) best = outer
    }
    if (best) {
      const list = holesByOuter.get(best)
      if (list) list.push(hole)
      else holesByOuter.set(best, [hole])
    }
    // An orphan hole (no containing outer) cannot occur in a well-formed
    // NonZero solution; if clipper ever produced one it bounds no material,
    // so it is dropped.
  }

  const kept: Array<{ outer: IndexedRing; holes: IndexedRing[]; netAreaMm2: number }> = []
  let droppedSlivers = 0
  for (const outer of outers) {
    const assigned = holesByOuter.get(outer) ?? []
    const netAreaMm2 = outer.areaMm2 - assigned.reduce((s, h) => s + Math.abs(h.areaMm2), 0)
    if (netAreaMm2 < minAreaMm2) {
      droppedSlivers++
      continue
    }
    // Width-floor dust test: thinner than REST_MIN_FEATURE_WIDTH_MM everywhere
    // ⇔ erosion by half that width annihilates the polygon.
    const widthProbe = offsetPathsMm([outer.path, ...assigned.map((h) => h.path)], -REST_MIN_FEATURE_WIDTH_MM / 2)
    if (widthProbe.length === 0) {
      droppedSlivers++
      continue
    }
    kept.push({ outer, holes: assigned, netAreaMm2 })
  }

  // Canonical, deterministic ordering: bbox min-X, then min-Y, then big-first.
  kept.sort((a, b) => {
    if (a.outer.bboxMinX !== b.outer.bboxMinX) return a.outer.bboxMinX - b.outer.bboxMinX
    if (a.outer.bboxMinY !== b.outer.bboxMinY) return a.outer.bboxMinY - b.outer.bboxMinY
    return b.netAreaMm2 - a.netAreaMm2
  })

  const regions: RestRegion[] = []
  for (const k of kept) {
    const outerRing = toCCW(fromClipperPath(k.outer.path))
    if (outerRing.length < MIN_RING_VERTICES) {
      droppedSlivers++
      continue
    }
    const islandRings: CamPoint2d[][] = []
    for (const h of k.holes) {
      const ring = toCCW(fromClipperPath(h.path))
      if (ring.length >= MIN_RING_VERTICES) islandRings.push(ring)
    }
    regions.push({ outerRing, islandRings })
  }
  return { regions, droppedSlivers }
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

/**
 * Solve the 2D rest region left by a previous, larger tool. See the module doc
 * for the math, the downstream generator contract, and the edge handling.
 * Never throws on degenerate input — every empty result carries an honest hint.
 */
export function solveRestRegion(params: SolveRestRegionParams): SolveRestRegionResult {
  const hints: string[] = []
  const prevD = params.prevToolDiameterMm

  if (!(prevD > 0) || !Number.isFinite(prevD)) {
    return {
      regions: [],
      hints: [
        `Rest machining: restPrevToolDiameterMm must be a positive, finite tool diameter (got ${String(prevD)}) — no rest regions solved.`
      ]
    }
  }

  const currentD = params.toolDiameterMm
  if (typeof currentD === 'number' && Number.isFinite(currentD) && currentD > 0 && prevD <= currentD) {
    return {
      regions: [],
      hints: [
        `Rest machining requires a larger previous tool: previous Ø${prevD.toFixed(3)} mm <= current Ø${currentD.toFixed(3)} mm leaves nothing only this tool could reach. Run a normal (non-rest) pass instead.`
      ]
    }
  }

  const regionPaths = computeRegionPaths(params.outerRing, params.islandRings ?? [])
  if (regionPaths.length === 0) {
    return {
      regions: [],
      hints: [
        'Rest machining: the pocket region is empty or degenerate (no closed outer boundary, or the islands consume it) — nothing to solve.'
      ]
    }
  }

  const stock = Math.max(0, params.wallStockMm ?? 0)
  let region = regionPaths
  if (stock > 0) {
    region = offsetPathsMm(region, -stock)
    if (region.length === 0) {
      return {
        regions: [],
        hints: [
          `Rest machining: wallStockMm ${stock.toFixed(3)} consumed the entire region — nothing to solve.`
        ]
      }
    }
  }

  // Morphological OPENING by the previous tool radius (erode then dilate,
  // round joins) = the area the previous tool's cutter provably swept.
  const prevR = prevD / 2
  const eroded = offsetPathsMm(region, -prevR)
  let restPaths: IntPoint[][]
  if (eroded.length === 0) {
    // The previous tool could not enter the region at all: nothing was swept,
    // so the ENTIRE region is rest material. Honest + loud — the op will
    // re-clear everything (the previous op removed nothing here).
    restPaths = region
    hints.push(
      `Rest machining: the previous tool (Ø${prevD.toFixed(3)} mm) could not enter this region anywhere — the entire region is rest material and will be cleared by this op.`
    )
  } else {
    const reachable = offsetPathsMm(eroded, prevR)
    restPaths = differencePaths(region, reachable)
  }

  const { regions, droppedSlivers } = decomposeRestPaths(restPaths, REST_MIN_AREA_MM2)
  if (droppedSlivers > 0) {
    hints.push(
      `Rest machining: dropped ${droppedSlivers} sliver region(s) — under the ${REST_MIN_AREA_MM2} mm² area floor or thinner than ${REST_MIN_FEATURE_WIDTH_MM} mm (un-machinable dust).`
    )
  }

  if (regions.length === 0) {
    hints.push(
      `Rest machining: the previous tool (Ø${prevD.toFixed(3)} mm) left nothing this tool can reach in this region — rest region is empty, no toolpath needed.`
    )
    return { regions, hints }
  }

  hints.push(REST_SKIP_WALL_FINISH_HINT)
  return { regions, hints }
}
