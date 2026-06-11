/**
 * Stack B v1 — ADAPTIVE CLEARING (capped radial engagement) for the 2D CNC
 * path (Laguna Swift primary; Carvera 3-axis shares the same 2D dispatch).
 *
 * Closes the docs/plans/catalog/vcarve-laguna.md row "Adaptive / trochoidal
 * clearing (HSM)" (P1): `cnc_adaptive` / `cnc_trochoidal_hsm` existed in the
 * schema with NO 2D engine. This module is the engine; dispatch/schema/UI
 * wiring is a separate Wire-phase change (this file is standalone until then).
 *
 * ---------------------------------------------------------------------------
 * WHAT "ADAPTIVE-LITE" HONESTLY MEANS HERE (v1 scope)
 * ---------------------------------------------------------------------------
 * This is NOT full HSM parity (no medial-axis spiral morphing, no G2/G3 arcs,
 * no engagement-controlled feed modulation). The defining property delivered:
 * a CAPPED RADIAL ENGAGEMENT over the Wave-3i offset-level region model:
 *
 *  1. BASE TOOLPATH — the same successive-inset levels as the offset spiral
 *     ({@link computeOffsetSpiralLevels}: outer − islands, eroded at
 *     `wallStockMm + k·stepoverMm`, jtRound, inside-out cut order). Absent any
 *     engagement spike the output traces the same loops as the 3i spiral
 *     (same level count, same loop geometry).
 *
 *  2. ENGAGEMENT ESTIMATOR — cutting inside-out, when a loop of level k is cut
 *     the loops of level k+1 (same sub-region, matched by containment) are
 *     already cleared, so the local radial bite at a point P on the loop is
 *     bounded by dist(P, level-(k+1) paths). In steady state that distance IS
 *     the stepover. It spikes where the deeper level locally does not exist:
 *     concave junctions onto narrow arms, channels, and region cores — the
 *     classic corner-burn / slot-breakage spots. (At a convex corner vertex
 *     the distance is ~1.41·stepover; that only triggers relief when it
 *     actually exceeds the cap.) Each loop is sampled along its perimeter and
 *     every sample's clearance is measured against the previous level's loops
 *     (pure segment distance on the clipper-derived polylines).
 *
 *  3. TROCHOIDAL RELIEF — sampled runs whose clearance exceeds
 *     `maxEngagementMm` (default 40% of tool diameter) are cut as trochoid
 *     loops: full circles of `trochoidRadiusMm` marching along the run at
 *     `trochoidStepMm`, approximated as fine chord polylines (G1 only — G2/G3
 *     output is explicitly OUT of v1 scope; chords are strictly INSIDE the
 *     true circle so containment bounds hold). Each circle advances the
 *     cleared frontier by at most the step, so the instantaneous radial bite
 *     stays <= the cap. Relief circles on a level-k loop are clamped to
 *     radius <= k·stepover, which by the erosion construction keeps them >=
 *     wallStockMm away from the outer wall AND every island.
 *
 *  4. NARROW REGIONS — a level-0 loop with no deeper level inside it is a
 *     region the offset progression cannot clear at capped engagement at all
 *     (tool-center width < one stepover ⇒ actual channel width <~ tool
 *     diameter + stepover: the "narrow channel" rule). It is cleared ENTIRELY
 *     trochoidally: a spine is found by binary-searching the deepest
 *     non-collapsing inset of that loop (<= trochoid radius), circles of
 *     radius == that inset march the spine (erosion geometry GUARANTEES the
 *     circles stay inside the loop — i.e. inside the channel walls), then a
 *     straight perimeter pass finishes the wall line.
 *
 * ---------------------------------------------------------------------------
 * HONEST LIMITS (documented, hinted, never silent)
 * ---------------------------------------------------------------------------
 *  - ENTRY SLOTS: the innermost loop(s) of each region core (loops at level
 *    k >= 1 with no deeper neighbour anywhere along them) are the entry pass
 *    and are cut straight — fully buried, exactly like the 3i offset spiral's
 *    innermost loop (and Vectric's default). v1 does not helix-spiral
 *    entries; use `entryMode: 'ramp'`. Every such loop gets an
 *    `; adaptive entry slot loop` comment and a result hint. This is the ONLY
 *    place a cut may exceed the engagement cap, by design.
 *  - LEVEL-0 SPIKE RUNS (narrow side-channels attached to a wider pocket):
 *    relief circles centered on the wall-level loop would gouge past the
 *    wall-stock boundary, so v1 SKIPS those runs (safe-Z lift over them,
 *    material left, loud hint) rather than ever slotting above the cap.
 *  - Unrelievably thin narrow regions (spine collapses below the trochoid
 *    radius floor) are skipped entirely with a hint — never slotted.
 *
 * ---------------------------------------------------------------------------
 * NEVER-VIOLATE INVARIANTS (tested in cam-adaptive-clearing.test.ts)
 * ---------------------------------------------------------------------------
 *  - EVERY loop/region transition lifts to safe Z before the XY rapid; skip
 *    runs lift too. No XY transit at cut depth, ever.
 *  - Depth is hard-capped to min(|zPassMm|, stockBoxZMm) when the caller
 *    provides the stock thickness (belt + braces: the dispatcher caps too).
 *  - Islands are never crossed (+ the wallStockMm margin): loop points sit
 *    wallStockMm + k·stepover from the region boundary by construction, and
 *    relief circles are clamped to k·stepover; narrow-region circles are
 *    contained by the spine-erosion construction.
 *  - Bounded work: inset levels capped (POCKET_OFFSET_MAX_LEVELS inherited
 *    from the 3i engine), trochoid circles capped at
 *    {@link ADAPTIVE_MAX_TROCHOID_CIRCLES} per depth pass (truncation =
 *    material left + hint), spine search runs a fixed bisection, loop
 *    sampling has a step floor and a per-loop sample cap.
 *  - Deterministic: pure function of params — no RNG, no clock, no I/O.
 *
 * Emits the same G-code body dialect as the other cam-local generators; the
 * Laguna post (vcarve_mach3.hbs) and Carvera post (carvera_3axis.hbs) wrap it
 * with their dialect headers/footers.
 */
import ClipperLib, { type IntPoint } from 'clipper-lib'
import { CLIPPER_SCALE } from '../shared/sketch-boolean-offset'
import {
  computeNegativeZDepthPasses,
  minRampRunForMaxAngleMm,
  type CamPoint2d,
  type Pocket2dGenerateResult
} from './cam-local'
import {
  computeOffsetSpiralLevels,
  POCKET_OFFSET_MAX_LEVELS,
  type PocketOffsetLevel,
  type PocketOffsetLoop
} from './cam-pocket-offset'

// ---------------------------------------------------------------------------
// Public params / constants
// ---------------------------------------------------------------------------

export type AdaptiveClearing2dParams = {
  /** Closed outer pocket boundary in setup WCS (mm, TOOL-CENTER geometry). */
  outerRing: ReadonlyArray<CamPoint2d>
  /** Optional interior island rings (keep-out polygons inside the pocket). */
  islandRings?: ReadonlyArray<ReadonlyArray<CamPoint2d>>
  /** Tool diameter (mm) — sets the default engagement cap (40% of it). */
  toolDiameterMm: number
  /** Radial distance between successive inset loops (mm). */
  stepoverMm: number
  /**
   * Radial engagement cap (mm). Default 40% of `toolDiameterMm`. Cut segments
   * whose local clearance to the previous inset level exceeds this get
   * trochoidal relief; narrow regions are cleared fully trochoidally.
   */
  maxEngagementMm?: number
  /** Trochoid relief circle radius (mm). Default cap/2; clamped to 0.8·cap. */
  trochoidRadiusMm?: number
  /** Forward advance per trochoid circle (mm). Default cap/4; clamped to R. */
  trochoidStepMm?: number
  zPassMm: number
  /** Optional step-down increment (mm); default single depth at zPassMm. */
  zStepMm?: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Optional radial stock to leave on ALL walls (outer + islands). */
  wallStockMm?: number
  /** Per-loop entry mode (same semantics as the 3i pocket generators). */
  entryMode?: 'plunge' | 'ramp'
  /** Ramp run length in XY (mm) when `entryMode` is `ramp`. */
  rampMm?: number
  /** Max ramp angle from horizontal (degrees). Default 45 (3i contract). */
  rampMaxAngleDeg?: number
  /**
   * Optional stock thickness (mm, WCS Z0 = stock top). When provided, the cut
   * depth is hard-capped to it (belt + braces with the dispatcher's cap).
   */
  stockBoxZMm?: number
}

/**
 * Hard cap on trochoid relief circles planned per depth pass, so a
 * pathological region (e.g. a metre-long comb of narrow teeth) cannot hang
 * the main process or emit an unbounded program. When hit, the remaining
 * spike/narrow geometry is SKIPPED (material left) and a truncation hint is
 * returned — the engine never silently slots above the cap.
 */
export const ADAPTIVE_MAX_TROCHOID_CIRCLES = 2000

/** Default engagement cap as a fraction of tool diameter (the classic ~40%). */
export const ADAPTIVE_DEFAULT_ENGAGEMENT_FRACTION = 0.4

/** Chords per trochoid circle (G1 polyline approximation of the arc). */
const TROCHOID_CIRCLE_SEGMENTS = 20

/** Below this relief radius a trochoid cannot meaningfully relieve — skip. */
const MIN_TROCHOID_RADIUS_MM = 0.1

/** Floor for the trochoid forward step (work bound). */
const MIN_TROCHOID_STEP_MM = 0.05

/** Relief radius is clamped to this fraction of the cap (audit headroom). */
const TROCHOID_RADIUS_CAP_FRACTION = 0.8

/** Spike threshold = max(cap, stepover + this margin) — steady state never trips. */
const SPIKE_THRESHOLD_MARGIN_MM = 0.02

/** Loop perimeter sampling step bounds (clearance estimator resolution). */
const SAMPLE_STEP_MIN_MM = 0.25
const SAMPLE_STEP_MAX_MM = 2.0
/** Per-loop sample cap (the step grows to respect it — work bound). */
const MAX_SAMPLES_PER_LOOP = 20_000

/** Fixed bisection iterations for the narrow-region spine search (work bound). */
const SPINE_SEARCH_ITERATIONS = 10

/** Round-join chord tolerance for spine erosion (matches cam-pocket-offset). */
const OFFSET_ARC_TOLERANCE_MM = 0.01

/** Floor for the radial step between successive insets (3i parity). */
const MIN_OFFSET_STEP_MM = 0.05

const MIN_RING_VERTICES = 3

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

type Bbox = { minX: number; minY: number; maxX: number; maxY: number }

function loopBbox(points: ReadonlyArray<CamPoint2d>): Bbox {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Distance from a point to an axis-aligned box (0 when inside). */
function bboxDistance(x: number, y: number, b: Bbox): number {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0
  const dy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0
  return Math.hypot(dx, dy)
}

function distPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Distance from a point to a CLOSED loop polyline. */
function distPointLoop(px: number, py: number, loop: ReadonlyArray<CamPoint2d>): number {
  let best = Number.POSITIVE_INFINITY
  const n = loop.length
  for (let i = 0; i < n; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % n]!
    const d = distPointSegment(px, py, a[0], a[1], b[0], b[1])
    if (d < best) best = d
  }
  return best
}

/** Even-odd point-in-ring test (used to scope levels to their sub-region). */
function pointInRing(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

type IndexedLoop = { points: ReadonlyArray<CamPoint2d>; bbox: Bbox }

/** Min distance from a point to a set of loops (bbox-pruned). +Inf when empty. */
function minDistToLoops(px: number, py: number, loops: ReadonlyArray<IndexedLoop>): number {
  let best = Number.POSITIVE_INFINITY
  for (const l of loops) {
    if (bboxDistance(px, py, l.bbox) >= best) continue
    const d = distPointLoop(px, py, l.points)
    if (d < best) best = d
  }
  return best
}

// ---------------------------------------------------------------------------
// Loop sampling + spike classification
// ---------------------------------------------------------------------------

type LoopSample = { x: number; y: number; isVertex: boolean }

/**
 * Sample a closed loop's perimeter: every original vertex plus subdivision
 * points so consecutive samples are <= `stepMm` apart. The step grows to
 * respect {@link MAX_SAMPLES_PER_LOOP} (work bound).
 */
function sampleLoopPerimeter(points: ReadonlyArray<CamPoint2d>, stepMm: number): LoopSample[] {
  const n = points.length
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  let step = Math.max(stepMm, perimeter / MAX_SAMPLES_PER_LOOP)
  if (!(step > 0) || !Number.isFinite(step)) step = SAMPLE_STEP_MIN_MM
  const out: LoopSample[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    out.push({ x: a[0], y: a[1], isVertex: true })
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const cuts = Math.floor(len / step)
    for (let c = 1; c <= cuts; c++) {
      const t = c / (cuts + 1)
      out.push({ x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]), isVertex: false })
    }
  }
  return out
}

/** Contiguous spike run over the (rotated) sample cycle. Inclusive indices. */
type SpikeRun = { a: number; b: number }

/**
 * Build maximal spike runs (with a one-sample safety extension each side,
 * merged when overlapping). Sample 0 is assumed non-spike (caller rotates).
 */
function buildSpikeRuns(spikes: ReadonlyArray<boolean>): SpikeRun[] {
  const n = spikes.length
  const raw: SpikeRun[] = []
  let i = 1
  while (i < n) {
    if (spikes[i]!) {
      let j = i
      while (j + 1 < n && spikes[j + 1]!) j++
      raw.push({ a: i, b: j })
      i = j + 1
    } else {
      i++
    }
  }
  // Extend by one sample each side (clamped: sample 0 stays the loop start).
  const extended = raw.map((r) => ({ a: Math.max(1, r.a - 1), b: Math.min(n - 1, r.b + 1) }))
  // Merge overlapping/adjacent runs.
  const merged: SpikeRun[] = []
  for (const r of extended) {
    const last = merged[merged.length - 1]
    if (last && r.a <= last.b + 1) {
      if (r.b > last.b) last.b = r.b
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Trochoid planning
// ---------------------------------------------------------------------------

type TrochoidChainResult = {
  /** G1 targets covering the chain with relief circles interleaved. */
  targets: CamPoint2d[]
  circles: number
  /** True when the circle budget ran out before the chain end. */
  truncated: boolean
}

/**
 * March trochoid circles of radius `r` along a polyline chain, one circle per
 * `step` mm of advance, chords only (strictly inside the true circle). The
 * chain itself is fed between circles so the run's own line is fully cut.
 * Consumes from a shared circle budget; stops (truncated) when it runs out.
 */
function planTrochoidChain(
  chain: ReadonlyArray<CamPoint2d>,
  r: number,
  step: number,
  budget: { remaining: number }
): TrochoidChainResult {
  const targets: CamPoint2d[] = []
  let circles = 0
  let cur: CamPoint2d = chain[0]!
  const pushTarget = (p: CamPoint2d): void => {
    if ((p[0] - cur[0]) ** 2 + (p[1] - cur[1]) ** 2 <= 1e-18) return
    targets.push(p)
    cur = p
  }
  let sinceCircle = step // place the first circle right at the run start
  for (let i = 1; i < chain.length; i++) {
    const next = chain[i]!
    let segLen = Math.hypot(next[0] - cur[0], next[1] - cur[1])
    while (sinceCircle + segLen >= step) {
      const adv = step - sinceCircle
      const t = segLen > 1e-12 ? adv / segLen : 0
      const cx = cur[0] + t * (next[0] - cur[0])
      const cy = cur[1] + t * (next[1] - cur[1])
      if (budget.remaining <= 0) {
        return { targets, circles, truncated: true }
      }
      budget.remaining--
      circles++
      // Feed to the circle centre point on the chain, then trace the circle.
      pushTarget([cx, cy])
      const startAngle = Math.atan2(cur[1] - cy, cur[0] - cx)
      for (let s = 0; s <= TROCHOID_CIRCLE_SEGMENTS; s++) {
        const ang = startAngle + (s / TROCHOID_CIRCLE_SEGMENTS) * Math.PI * 2
        pushTarget([cx + r * Math.cos(ang), cy + r * Math.sin(ang)])
      }
      // Tool is back at the circle start point; rejoin the chain at the centre.
      pushTarget([cx, cy])
      segLen = Math.hypot(next[0] - cur[0], next[1] - cur[1])
      sinceCircle = 0
      if (segLen <= 1e-12) break
    }
    sinceCircle += Math.hypot(next[0] - cur[0], next[1] - cur[1])
    pushTarget([next[0], next[1]])
  }
  return { targets, circles, truncated: false }
}

// ---------------------------------------------------------------------------
// Narrow-region spine search (binary erosion)
// ---------------------------------------------------------------------------

function toClipperPath(pts: ReadonlyArray<CamPoint2d>): IntPoint[] {
  return pts.map((p) => ({ X: Math.round(p[0] * CLIPPER_SCALE), Y: Math.round(p[1] * CLIPPER_SCALE) }))
}

function fromClipperPath(path: ReadonlyArray<IntPoint>): CamPoint2d[] {
  const out: CamPoint2d[] = []
  for (const ip of path) {
    const p: CamPoint2d = [ip.X / CLIPPER_SCALE, ip.Y / CLIPPER_SCALE]
    const last = out[out.length - 1]
    if (last && (last[0] - p[0]) ** 2 + (last[1] - p[1]) ** 2 <= 1e-12) continue
    out.push(p)
  }
  while (out.length >= 2) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= 1e-12) out.pop()
    else break
  }
  return out
}

/** Erode a polygon-with-holes by `deltaMm`; [] when it collapses. */
function erodeGroup(paths: ReadonlyArray<IntPoint[]>, deltaMm: number): CamPoint2d[][] {
  const co = new ClipperLib.ClipperOffset(2, OFFSET_ARC_TOLERANCE_MM * CLIPPER_SCALE)
  co.AddPaths([...paths] as IntPoint[][], ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const solution: IntPoint[][] = []
  co.Execute(solution, -deltaMm * CLIPPER_SCALE)
  const loops: CamPoint2d[][] = []
  for (const path of solution) {
    const pts = fromClipperPath(path)
    if (pts.length >= MIN_RING_VERTICES) loops.push(pts)
  }
  return loops
}

type SpineResult = { deltaMm: number; loops: CamPoint2d[][] }

/** Coverage slack on top of 2·delta (corner diagonals reach sqrt(2)·delta). */
const SPINE_COVERAGE_SLACK_MM = 0.1

/** Wall sampling step floor for the coverage predicate (work bound). */
const SPINE_COVERAGE_SAMPLE_STEP_MM = 1.0

/** Per-probe coverage work cap: samples × spine segments (work bound). */
const SPINE_COVERAGE_MAX_OPS = 5_000_000

/**
 * Does the eroded spine COVER the region? Every wall sample must be within
 * 2·delta (+slack) of a spine loop — i.e. the trochoid corridor (circle
 * radius == delta marching the spine) reaches the wall everywhere the
 * perimeter pass will later cut. Without this check a varying-width region
 * (e.g. a comb) erodes to disconnected dots at its widest spots and the
 * perimeter pass would slot the uncovered arms at full burial.
 */
function spineCoversWalls(
  wallSamples: ReadonlyArray<LoopSample>,
  spineLoops: ReadonlyArray<CamPoint2d[]>,
  deltaMm: number
): boolean {
  let spineSegs = 0
  for (const l of spineLoops) spineSegs += l.length
  if (spineSegs === 0) return false
  // Respect the ops cap by striding the wall samples (deterministic).
  const stride = Math.max(1, Math.ceil((wallSamples.length * spineSegs) / SPINE_COVERAGE_MAX_OPS))
  const indexed: IndexedLoop[] = spineLoops.map((l) => ({ points: l, bbox: loopBbox(l) }))
  const reach = 2 * deltaMm + SPINE_COVERAGE_SLACK_MM
  for (let i = 0; i < wallSamples.length; i += stride) {
    const s = wallSamples[i]!
    if (minDistToLoops(s.x, s.y, indexed) > reach) return false
  }
  return true
}

/**
 * Largest covering inset of a narrow region (outer loop + its hole loops),
 * capped at `maxRadiusMm`: the deepest erosion whose loops still COVER every
 * wall sample ({@link spineCoversWalls}). Erosion geometry guarantees circles
 * of radius <= deltaMm centered on the returned loops stay INSIDE the region.
 * Returns null when even the {@link MIN_TROCHOID_RADIUS_MM} inset collapses
 * or cannot cover the walls (region too thin / shaped beyond v1 coverage).
 */
function findNarrowSpine(
  outer: ReadonlyArray<CamPoint2d>,
  holes: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  maxRadiusMm: number,
  wallSamples: ReadonlyArray<LoopSample>
): SpineResult | null {
  const paths: IntPoint[][] = [toClipperPath(outer), ...holes.map((h) => toClipperPath(h))]
  const probe = (deltaMm: number): CamPoint2d[][] | null => {
    const loops = erodeGroup(paths, deltaMm)
    if (loops.length === 0) return null
    return spineCoversWalls(wallSamples, loops, deltaMm) ? loops : null
  }
  const atMax = probe(maxRadiusMm)
  if (atMax) return { deltaMm: maxRadiusMm, loops: atMax }
  const atFloor = probe(MIN_TROCHOID_RADIUS_MM)
  if (atFloor === null) return null
  let lo = MIN_TROCHOID_RADIUS_MM
  let loLoops = atFloor
  let hi = maxRadiusMm
  for (let i = 0; i < SPINE_SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    const loops = probe(mid)
    if (loops) {
      lo = mid
      loLoops = loops
    } else {
      hi = mid
    }
  }
  return { deltaMm: lo, loops: loLoops }
}

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

type PlannedMove =
  | { kind: 'note'; text: string }
  | { kind: 'feed'; targets: CamPoint2d[] }
  | { kind: 'skip'; resume: CamPoint2d }

type LoopPlan = {
  preComments: string[]
  start: CamPoint2d
  moves: PlannedMove[]
  closeToStart: boolean
}

type AdaptivePlan = {
  loopPlans: LoopPlan[]
  levelCount: number
  loopCount: number
  circleCount: number
  entrySlotCount: number
  narrowRegionCount: number
  unrelievableNarrowCount: number
  skippedWallRunCount: number
  truncatedByBudget: boolean
  cappedLevels: boolean
}

/** First feed target list of a plan (for ramp-entry direction), if any. */
function firstFeedTargets(plan: LoopPlan): CamPoint2d[] | null {
  for (const m of plan.moves) {
    if (m.kind === 'feed' && m.targets.length > 0) return m.targets
  }
  return null
}

/** Plain closed-loop trace plan (original vertices; closing move at emit). */
function straightLoopPlan(points: ReadonlyArray<CamPoint2d>, preComments: string[]): LoopPlan {
  const start = points[0]!
  const targets: CamPoint2d[] = []
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    targets.push([p[0], p[1]])
  }
  return {
    preComments,
    start: [start[0], start[1]],
    moves: [{ kind: 'feed', targets }],
    closeToStart: true
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

type ResolvedPlanParams = {
  trochoidRadiusMm: number
  trochoidStepMm: number
  stepMm: number
  spikeThresholdMm: number
  sampleStepMm: number
}

/** Per-loop spike classification (samples + flags) for one level. */
type ClassifiedLoop = {
  loop: PocketOffsetLoop
  samples: LoopSample[]
  spikes: boolean[]
  allSpike: boolean
  anySpike: boolean
}

function planAdaptiveClearing(
  levels: ReadonlyArray<PocketOffsetLevel>,
  resolved: ResolvedPlanParams,
  cappedLevels: boolean
): AdaptivePlan {
  const { trochoidRadiusMm, trochoidStepMm, stepMm, spikeThresholdMm, sampleStepMm } = resolved
  const plan: AdaptivePlan = {
    loopPlans: [],
    levelCount: levels.length,
    loopCount: 0,
    circleCount: 0,
    entrySlotCount: 0,
    narrowRegionCount: 0,
    unrelievableNarrowCount: 0,
    skippedWallRunCount: 0,
    truncatedByBudget: false,
    cappedLevels
  }
  const budget = { remaining: ADAPTIVE_MAX_TROCHOID_CIRCLES }

  // Pre-index every level's loops for distance queries.
  const indexed: IndexedLoop[][] = levels.map((level) =>
    level.loops.map((l) => ({ points: l.points, bbox: loopBbox(l.points) }))
  )

  // INSIDE-OUT: deepest inset level first (3i climb convention).
  for (let k = levels.length - 1; k >= 0; k--) {
    const level = levels[k]!
    const nextLevel: ReadonlyArray<IndexedLoop> = k + 1 < levels.length ? indexed[k + 1]! : []

    // Scope the previous (deeper) level to each sub-region: a deeper loop
    // "belongs" to the level-k outer loop that contains its first vertex.
    // Hole loops (grown islands) measure against their containing outer's
    // set, so an island that split the deeper level still reads ~stepover.
    const outers: { idx: number; ring: ReadonlyArray<CamPoint2d> }[] = []
    level.loops.forEach((l, idx) => {
      if (!l.isHole) outers.push({ idx, ring: l.points })
    })
    const prevByOuter = new Map<number, IndexedLoop[]>()
    for (const o of outers) prevByOuter.set(o.idx, [])
    for (const deep of nextLevel) {
      const p0 = deep.points[0]
      if (!p0) continue
      for (const o of outers) {
        if (pointInRing(o.ring, p0[0], p0[1])) {
          prevByOuter.get(o.idx)!.push(deep)
          break
        }
      }
    }
    const prevForLoop = (idx: number, l: PocketOffsetLoop): ReadonlyArray<IndexedLoop> => {
      if (!l.isHole) return prevByOuter.get(idx) ?? []
      const p0 = l.points[0]
      if (p0) {
        for (const o of outers) {
          if (pointInRing(o.ring, p0[0], p0[1])) return prevByOuter.get(o.idx) ?? []
        }
      }
      return []
    }

    // Classify every loop of this level first (narrow grouping needs both
    // the outer and its holes before any of them is planned).
    const classified: ClassifiedLoop[] = level.loops.map((loop, idx) => {
      const samples = sampleLoopPerimeter(loop.points, sampleStepMm)
      const prev = prevForLoop(idx, loop)
      const spikes: boolean[] =
        prev.length === 0
          ? samples.map(() => true)
          : samples.map((s) => minDistToLoops(s.x, s.y, prev) > spikeThresholdMm)
      const allSpike = spikes.length > 0 && spikes.every(Boolean)
      const anySpike = spikes.some(Boolean)
      return { loop, samples, spikes, allSpike, anySpike }
    })

    const consumed = new Set<number>()

    // NARROW REGIONS first (level 0, all-spike outer loops): they consume
    // their interior hole loops so those are not planned twice.
    if (k === 0) {
      classified.forEach((c, idx) => {
        if (consumed.has(idx) || c.loop.isHole || !c.allSpike) return
        if (c.samples.length < MIN_RING_VERTICES) return
        const holeIdxs: number[] = []
        classified.forEach((h, hIdx) => {
          if (hIdx === idx || !h.loop.isHole || consumed.has(hIdx)) return
          const p0 = h.loop.points[0]
          if (p0 && pointInRing(c.loop.points, p0[0], p0[1])) holeIdxs.push(hIdx)
        })
        planNarrowRegion(
          c.loop,
          holeIdxs.map((i) => classified[i]!.loop),
          level,
          plan,
          budget,
          trochoidRadiusMm,
          trochoidStepMm
        )
        consumed.add(idx)
        for (const i of holeIdxs) consumed.add(i)
      })
    }

    classified.forEach((c, idx) => {
      if (consumed.has(idx)) return
      if (c.samples.length < MIN_RING_VERTICES) return
      if (!c.anySpike) {
        // Steady state everywhere — plain closed trace (offset-spiral parity).
        plan.loopPlans.push(straightLoopPlan(c.loop.points, []))
        plan.loopCount++
        return
      }
      if (c.allSpike) {
        if (k >= 1) {
          // Region core — the entry slot pass (documented v1 exception).
          plan.entrySlotCount++
          plan.loopPlans.push(
            straightLoopPlan(c.loop.points, [
              `; adaptive entry slot loop -- level ${k} inset ${level.insetMm.toFixed(3)} mm (region core; fully buried entry pass)`
            ])
          )
          plan.loopCount++
        } else {
          // Wall-level loop in an over-tight spot that narrow grouping did
          // not absorb (stray hole ring): leave the material — never slot.
          plan.skippedWallRunCount++
        }
        return
      }
      // Partial spike runs.
      const rotation = c.spikes.findIndex((s) => !s)
      const rot = rotation < 0 ? 0 : rotation
      const rotSamples = c.samples.slice(rot).concat(c.samples.slice(0, rot))
      const rotSpikes = c.spikes.slice(rot).concat(c.spikes.slice(0, rot))
      const runs = buildSpikeRuns(rotSpikes)
      const reliefRadius = Math.min(trochoidRadiusMm, k * stepMm)
      const canRelieve = k >= 1 && reliefRadius >= MIN_TROCHOID_RADIUS_MM
      plan.loopPlans.push(
        spikeRunLoopPlan(rotSamples, runs, {
          canRelieve,
          reliefRadius,
          trochoidStepMm,
          levelIndex: k,
          insetMm: level.insetMm,
          budget,
          plan
        })
      )
      plan.loopCount++
    })
  }
  return plan
}

/**
 * Plan a loop with spike runs: straight stretches feed the original vertices;
 * runs become trochoid chains (k >= 1) or safe-Z skip-overs (k == 0 / budget).
 */
function spikeRunLoopPlan(
  rotSamples: ReadonlyArray<LoopSample>,
  runs: ReadonlyArray<SpikeRun>,
  opts: {
    canRelieve: boolean
    reliefRadius: number
    trochoidStepMm: number
    levelIndex: number
    insetMm: number
    budget: { remaining: number }
    plan: AdaptivePlan
  }
): LoopPlan {
  const n = rotSamples.length
  const start: CamPoint2d = [rotSamples[0]!.x, rotSamples[0]!.y]
  const moves: PlannedMove[] = []
  let cursor = 0 // index of the sample the tool currently stands on

  const pushStraight = (fromExclusive: number, toInclusive: number): void => {
    const targets: CamPoint2d[] = []
    for (let i = fromExclusive + 1; i <= toInclusive; i++) {
      const s = rotSamples[i]!
      // Keep the G-code lean: only original vertices plus stretch boundaries.
      if (s.isVertex || i === toInclusive) targets.push([s.x, s.y])
    }
    if (targets.length > 0) moves.push({ kind: 'feed', targets })
  }

  for (const run of runs) {
    if (run.a - 1 > cursor) pushStraight(cursor, run.a - 1)
    const chainStart = Math.max(cursor, run.a - 1)
    const chain: CamPoint2d[] = []
    for (let i = chainStart; i <= run.b; i++) {
      const s = rotSamples[i]!
      chain.push([s.x, s.y])
    }
    const runEnd: CamPoint2d = [rotSamples[run.b]!.x, rotSamples[run.b]!.y]
    if (!opts.canRelieve) {
      // v1: no level-0 relief — lift over the run, leave the material, hint.
      moves.push({
        kind: 'note',
        text: `; adaptive skip -- engagement spike at wall level left uncut (no level-0 relief in v1)`
      })
      moves.push({ kind: 'skip', resume: runEnd })
      opts.plan.skippedWallRunCount++
    } else {
      const res = planTrochoidChain(chain, opts.reliefRadius, opts.trochoidStepMm, opts.budget)
      if (res.circles > 0) {
        moves.push({
          kind: 'note',
          text: `; adaptive trochoid relief -- level ${opts.levelIndex} inset ${opts.insetMm.toFixed(3)} mm, ${res.circles} circle(s), R ${opts.reliefRadius.toFixed(3)} mm`
        })
        moves.push({ kind: 'feed', targets: res.targets })
        opts.plan.circleCount += res.circles
      }
      if (res.truncated) {
        opts.plan.truncatedByBudget = true
        moves.push({
          kind: 'note',
          text: `; adaptive skip -- trochoid budget exhausted; spike run left uncut`
        })
        moves.push({ kind: 'skip', resume: runEnd })
      }
    }
    cursor = run.b
  }
  if (cursor < n - 1) pushStraight(cursor, n - 1)
  return { preComments: [], start, moves, closeToStart: true }
}

/**
 * Fully-trochoidal clearing of a narrow level-0 region: circles march the
 * deepest non-collapsing inset (spine) of the loop (+ its hole loops), then a
 * straight perimeter pass finishes the wall line. Containment is guaranteed
 * by the erosion construction (circle radius == spine inset).
 */
function planNarrowRegion(
  loop: PocketOffsetLoop,
  holes: ReadonlyArray<PocketOffsetLoop>,
  level: PocketOffsetLevel,
  plan: AdaptivePlan,
  budget: { remaining: number },
  trochoidRadiusMm: number,
  trochoidStepMm: number
): void {
  // Wall samples for the spine-coverage predicate: the loop AND its holes.
  const wallSamples: LoopSample[] = sampleLoopPerimeter(loop.points, SPINE_COVERAGE_SAMPLE_STEP_MM)
  for (const h of holes) {
    wallSamples.push(...sampleLoopPerimeter(h.points, SPINE_COVERAGE_SAMPLE_STEP_MM))
  }
  const spine = findNarrowSpine(
    loop.points,
    holes.map((h) => h.points),
    trochoidRadiusMm,
    wallSamples
  )
  if (spine === null) {
    // Too thin for the trochoid floor OR shaped beyond v1 spine coverage:
    // leave the material (never slot above the cap).
    plan.unrelievableNarrowCount++
    return
  }
  plan.narrowRegionCount++
  let truncated = false
  let totalCircles = 0
  const spinePlans: LoopPlan[] = []
  for (const spineLoop of spine.loops) {
    if (truncated) break
    const chain: CamPoint2d[] = spineLoop.map((p) => [p[0], p[1]])
    chain.push([spineLoop[0]![0], spineLoop[0]![1]]) // close the spine ring
    const res = planTrochoidChain(chain, spine.deltaMm, trochoidStepMm, budget)
    totalCircles += res.circles
    plan.circleCount += res.circles
    if (res.truncated) {
      truncated = true
      plan.truncatedByBudget = true
    }
    if (res.targets.length > 0) {
      spinePlans.push({
        preComments: [],
        start: chain[0]!,
        moves: [{ kind: 'feed', targets: res.targets }],
        closeToStart: false
      })
    }
  }
  if (spinePlans.length > 0) {
    spinePlans[0]!.preComments = [
      `; adaptive narrow region -- trochoidal spine clearing, R ${spine.deltaMm.toFixed(3)} mm, step ${trochoidStepMm.toFixed(3)} mm, ${totalCircles} circle(s)`
    ]
    plan.loopPlans.push(...spinePlans)
    plan.loopCount += spinePlans.length
  }
  if (!truncated) {
    // Perimeter wall pass (the level-0 loop itself) after the spine clearing.
    plan.loopPlans.push(
      straightLoopPlan(loop.points, [
        `; adaptive narrow region perimeter pass -- inset ${level.insetMm.toFixed(3)} mm`
      ])
    )
    plan.loopCount++
    for (const hole of holes) {
      plan.loopPlans.push(
        straightLoopPlan(hole.points, [
          `; adaptive narrow region perimeter pass (island) -- inset ${level.insetMm.toFixed(3)} mm`
        ])
      )
      plan.loopCount++
    }
  }
  // When truncated, the perimeter pass is withheld on purpose: un-relieved
  // walls would be cut at full burial. The truncation hint covers it.
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

/**
 * Adaptive clearing body generator. See the module doc for the engagement
 * model, the relief rules, the honest v1 limits, and the safety invariants.
 *
 * Collapse and degenerate input yield an EMPTY result (`lines: []`) and never
 * throw — same contract as the 3i `generatePocketOffsetSpiralLines`.
 */
export function generateAdaptiveClearing2dLines(
  params: AdaptiveClearing2dParams
): Pocket2dGenerateResult {
  if (
    !(params.stepoverMm > 0) ||
    !Number.isFinite(params.stepoverMm) ||
    !(params.toolDiameterMm > 0) ||
    !Number.isFinite(params.toolDiameterMm)
  ) {
    return { lines: [], hints: [] }
  }

  const stockMm = Math.max(0, params.wallStockMm ?? 0)
  const stepMm = Math.max(MIN_OFFSET_STEP_MM, params.stepoverMm)
  const capMm =
    typeof params.maxEngagementMm === 'number' &&
    Number.isFinite(params.maxEngagementMm) &&
    params.maxEngagementMm > 0
      ? params.maxEngagementMm
      : ADAPTIVE_DEFAULT_ENGAGEMENT_FRACTION * params.toolDiameterMm

  const radiusRequested =
    typeof params.trochoidRadiusMm === 'number' &&
    Number.isFinite(params.trochoidRadiusMm) &&
    params.trochoidRadiusMm > 0
      ? params.trochoidRadiusMm
      : capMm / 2
  const radiusClampMax = TROCHOID_RADIUS_CAP_FRACTION * capMm
  const trochoidRadiusMm = Math.max(
    MIN_TROCHOID_RADIUS_MM,
    Math.min(radiusRequested, radiusClampMax)
  )
  const radiusWasClamped =
    typeof params.trochoidRadiusMm === 'number' && params.trochoidRadiusMm > radiusClampMax

  const stepRequested =
    typeof params.trochoidStepMm === 'number' &&
    Number.isFinite(params.trochoidStepMm) &&
    params.trochoidStepMm > 0
      ? params.trochoidStepMm
      : capMm / 4
  const trochoidStepMm = Math.max(MIN_TROCHOID_STEP_MM, Math.min(stepRequested, trochoidRadiusMm))
  const stepWasClamped =
    typeof params.trochoidStepMm === 'number' && params.trochoidStepMm > trochoidRadiusMm

  // Depth: belt + braces stock cap (the dispatcher also caps when wired).
  const stockThickness =
    typeof params.stockBoxZMm === 'number' &&
    Number.isFinite(params.stockBoxZMm) &&
    params.stockBoxZMm > 0
      ? params.stockBoxZMm
      : undefined
  const depthCapped = stockThickness != null && params.zPassMm < -stockThickness
  const zPassMm = depthCapped && stockThickness != null ? -stockThickness : params.zPassMm

  const { levels, cappedLevels } = computeOffsetSpiralLevels({
    outerRing: params.outerRing,
    islandRings: params.islandRings ?? [],
    stepoverMm: params.stepoverMm,
    wallStockMm: stockMm
  })
  if (levels.length === 0) return { lines: [], hints: [] }

  const spikeThresholdMm = Math.max(capMm, stepMm + SPIKE_THRESHOLD_MARGIN_MM)
  const sampleStepMm = Math.min(SAMPLE_STEP_MAX_MM, Math.max(SAMPLE_STEP_MIN_MM, stepMm / 2))

  const plan = planAdaptiveClearing(
    levels,
    { trochoidRadiusMm, trochoidStepMm, stepMm, spikeThresholdMm, sampleStepMm },
    cappedLevels
  )

  // ---- hints (honesty channel) ----
  const hints: string[] = []
  if (depthCapped && stockThickness != null) {
    hints.push(
      `Adaptive clearing: depth cap reduced from ${Math.abs(params.zPassMm).toFixed(3)} mm to the ${stockThickness.toFixed(3)} mm stock thickness so the cutter does not plunge past the material.`
    )
  }
  if (plan.cappedLevels) {
    hints.push(
      `Adaptive clearing: inset levels were capped at ${POCKET_OFFSET_MAX_LEVELS.toLocaleString()} for this region size -- increase stepoverMm for full coverage.`
    )
  }
  if (stepMm > capMm) {
    hints.push(
      `Adaptive clearing: stepoverMm (${stepMm.toFixed(3)} mm) exceeds maxEngagementMm (${capMm.toFixed(3)} mm) -- steady-state engagement equals the stepover; reduce stepover or raise the cap.`
    )
  }
  if (radiusWasClamped) {
    hints.push(
      `Adaptive clearing: trochoidRadiusMm clamped to ${trochoidRadiusMm.toFixed(3)} mm (${(TROCHOID_RADIUS_CAP_FRACTION * 100).toFixed(0)}% of the engagement cap) so relief passes stay under the cap.`
    )
  }
  if (stepWasClamped) {
    hints.push(
      `Adaptive clearing: trochoidStepMm clamped to the trochoid radius (${trochoidRadiusMm.toFixed(3)} mm).`
    )
  }
  if (plan.entrySlotCount > 0) {
    hints.push(
      `Adaptive clearing: ${plan.entrySlotCount} region-entry slot loop(s) cut fully buried (same as the offset-spiral innermost pass) -- prefer entryMode 'ramp' for them.`
    )
  }
  if (plan.narrowRegionCount > 0) {
    hints.push(
      `Adaptive clearing: ${plan.narrowRegionCount} narrow region(s) cleared fully trochoidally (channel narrower than one stepover at the wall level).`
    )
  }
  if (plan.unrelievableNarrowCount > 0) {
    hints.push(
      `Adaptive clearing: ${plan.unrelievableNarrowCount} narrow region(s) skipped -- thinner than the ${MIN_TROCHOID_RADIUS_MM.toFixed(1)} mm trochoid floor or shaped beyond v1 spine coverage; material left (use a smaller tool or split the region).`
    )
  }
  if (plan.skippedWallRunCount > 0) {
    hints.push(
      `Adaptive clearing: ${plan.skippedWallRunCount} wall-level engagement spike run(s) skipped (v1 cannot relieve at the wall-stock boundary); material left -- clear those channels with a smaller tool or a dedicated pass.`
    )
  }
  if (plan.truncatedByBudget) {
    hints.push(
      `Adaptive clearing: trochoid relief was truncated at the ${ADAPTIVE_MAX_TROCHOID_CIRCLES.toLocaleString()}-circle bound; remaining spike geometry was skipped (material left). Increase trochoidStepMm or stepoverMm, or split the region.`
    )
  }

  if (plan.loopPlans.length === 0) return { lines: [], hints }

  // ---- emission ----
  const stepDown = Math.max(0.01, Math.abs(params.zStepMm ?? zPassMm))
  const depths = computeNegativeZDepthPasses(zPassMm, stepDown)
  const entryMode = params.entryMode === 'ramp' ? 'ramp' : 'plunge'
  const rampMm = Math.max(0.01, params.rampMm ?? 2)
  const rampMaxAngleDeg =
    typeof params.rampMaxAngleDeg === 'number' && Number.isFinite(params.rampMaxAngleDeg)
      ? params.rampMaxAngleDeg
      : 45
  let rampExtendedForAngle = false
  let rampSteepDespiteSpan = false

  const lines: string[] = []
  lines.push(
    `; Adaptive clearing -- ${plan.levelCount} inset level(s), ${plan.loopCount} loop(s), ${plan.circleCount} trochoid circle(s) per depth pass, stepover ${stepMm.toFixed(3)} mm, engagement cap ${capMm.toFixed(3)} mm, wall stock ${stockMm.toFixed(3)} mm`
  )

  const feed = params.feedMmMin.toFixed(0)
  const plunge = params.plungeMmMin.toFixed(0)
  const safe = params.safeZMm.toFixed(3)

  for (const z of depths) {
    const zDrop = Math.abs(params.safeZMm - z)
    const minRunForAngle = minRampRunForMaxAngleMm(zDrop, rampMaxAngleDeg)
    for (const lp of plan.loopPlans) {
      lines.push(...lp.preComments)
      const [x0, y0] = lp.start
      // EVERY loop transition is a safe-Z lift before the XY rapid.
      lines.push(`G0 Z${safe}`)
      lines.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)}`)
      const ff = firstFeedTargets(lp)
      if (entryMode === 'ramp' && ff && ff.length > 0) {
        const [x1, y1] = ff[0]!
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
        // Ramp out along the first segment, then feed back to the start.
        lines.push(
          `G1 X${(x0 + ux * run).toFixed(3)} Y${(y0 + uy * run).toFixed(3)} Z${z.toFixed(3)} F${plunge}`
        )
        lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${feed}`)
      } else {
        lines.push(`G1 Z${z.toFixed(3)} F${plunge}`)
      }
      for (const move of lp.moves) {
        if (move.kind === 'note') {
          lines.push(move.text)
        } else if (move.kind === 'feed') {
          for (const [x, y] of move.targets) {
            lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feed}`)
          }
        } else {
          // Safe-Z skip over uncut material: lift, rapid, plunge re-entry.
          lines.push(`G0 Z${safe}`)
          lines.push(`G0 X${move.resume[0].toFixed(3)} Y${move.resume[1].toFixed(3)}`)
          lines.push(`G1 Z${z.toFixed(3)} F${plunge}`)
        }
      }
      if (lp.closeToStart) {
        lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${feed}`)
      }
    }
  }
  lines.push(`G0 Z${safe}`)

  if (entryMode === 'ramp') {
    if (rampExtendedForAngle) {
      hints.push(
        `Adaptive clearing ramp: XY run was lengthened (within each loop's first segment) to stay within rampMaxAngleDeg (${rampMaxAngleDeg.toFixed(0)} deg) versus safe-Z to cut depth.`
      )
    }
    if (rampSteepDespiteSpan) {
      hints.push(
        `Adaptive clearing ramp: some loop first-segments are shorter than the horizontal run needed for rampMaxAngleDeg (${rampMaxAngleDeg.toFixed(0)} deg); those entries may be steeper than the limit.`
      )
    }
  }
  // Walls are fully cleared only when NOTHING was skipped or truncated -- the
  // dispatcher's finish pass keys off this (a wall trace over skipped geometry
  // would slot full-burial into uncleared stock).
  const adaptiveClearedToWalls =
    plan.skippedWallRunCount === 0 &&
    plan.unrelievableNarrowCount === 0 &&
    !plan.truncatedByBudget
  return { lines, hints, adaptiveClearedToWalls }
}
