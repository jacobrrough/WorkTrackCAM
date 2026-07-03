/**
 * Stack B v1 — adaptive clearing engine validation gate (Safety Rule 5 +
 * gcode-safety skill checklist).
 *
 * Covers BOTH halves of the build brief, in the cam-pocket-offset-islands
 * test pattern:
 *
 *  1. ENGINE GEOMETRY (pure, no I/O) — the load-bearing real-fixture proofs:
 *     (a) open 60x40 rectangle: steady-state engagement == stepover, ZERO
 *         trochoids, output tracks the plain offset spiral (same level count,
 *         identical loop rapids);
 *     (b) concave L-pocket: the narrow arm (reachable by level 1 but not
 *         level 2) triggers trochoidal relief at the inside corner, and a
 *         geometric engagement AUDIT over the emitted path proves NO measured
 *         segment exceeds maxEngagementMm — while the SAME geometry through
 *         the plain offset spiral audits at >10x the cap (the hazard the
 *         relief fixes);
 *     (c) 8 mm channel with a 6 mm tool: cleared ENTIRELY trochoidally,
 *         every cut point inside the channel's tool-center walls;
 *     (d) islands respected with the wall-stock margin, including every
 *         trochoid chord;
 *     (e) collapse/degenerate inputs -> empty result, no throw;
 *     (f) determinism (two identical calls, byte-equal);
 *     (g) bounds: a pathological comb region stays at the trochoid-circle
 *         cap with an honest truncation hint.
 *
 *     ENGAGEMENT AUDIT METRIC (tool-center curve frontier): walk the emitted
 *     cut segments in order, maintaining the set of previously-cut segments
 *     (the cleared frontier). For each new segment, sample it every 0.2 mm
 *     and measure the max distance to the frontier — the distance the tool
 *     advances into uncleared territory. The very first segment seeds the
 *     frontier; loops marked `; adaptive entry slot loop` are skip-measured
 *     (they are the documented fully-buried entry passes — the engine's ONE
 *     engagement exception) but still join the frontier. If a tool-center
 *     point is within d of previously-swept path, the uncut radial bite at
 *     that point is <= d (disc-overlap argument), so this metric IS the
 *     radial engagement bound the engine claims.
 *
 *  2. POSTED G-CODE through the REAL posts:
 *     - vcarve_mach3.hbs + resources/machines/laguna-swift-5x10.json:
 *       % tape markers, G21 -> G90 -> G17 (never G20), spindle warm-up
 *       M3 + G4 P2.0, cool-down M5 -> G4 P3.0, M30 (NEVER M2), no M4, no XY
 *       rapid at cut depth anywhere, stock depth hard cap, plus a NEW posted
 *       snapshot (existing snapshots untouched — new op family, new snapshot).
 *     - carvera_3axis.hbs + makera-carvera-3axis.json: G21 -> G90 -> G17,
 *       ATC M6 T1 + G43 H1, spindle dwell G4 P2, footer M5 -> G49 -> M9 ->
 *       M2 (NEVER M30 — Smoothieware may delete the SD file), no A-axis
 *       words, feeds inside the 2400 mm/min Carvera ceiling.
 *
 * The dispatcher/schema/UI wiring is the Wire phase — these tests post the
 * generator's lines through `renderPost` exactly as `dispatch2dStrategy`
 * does, so the wiring change cannot alter the posted bytes.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import type { CamPoint2d } from './cam-local'
import {
  computeOffsetSpiralLevels,
  generatePocketOffsetSpiralLines
} from './cam-pocket-offset'
import {
  ADAPTIVE_DEFAULT_ENGAGEMENT_FRACTION,
  ADAPTIVE_MAX_TROCHOID_CIRCLES,
  generateAdaptiveClearing2dLines,
  type AdaptiveClearing2dParams
} from './cam-adaptive-clearing'
import { renderPost } from './post-process'

// -- Fixtures ------------------------------------------------------------------

const RESOURCES_ROOT = join(process.cwd(), 'resources')

/** (a) Plain open rectangle — no concavity, no narrow features. */
const RECT_60X40: CamPoint2d[] = [
  [0, 0],
  [60, 0],
  [60, 40],
  [0, 40]
]

/**
 * (b) Concave L-pocket (tool-center geometry): 40x40 body + a 6 mm-wide,
 * 40 mm-long arm. With wallStock 0.5 and stepover 1.5 the arm is reached by
 * level 1 (inset 2.0 < arm half-width 3) but NOT level 2 (inset 3.5), so the
 * level-1 finger into the arm has no cleared neighbour — the engagement
 * spike at the inside corner the brief names as the classic burn spot.
 */
const L_POCKET: CamPoint2d[] = [
  [0, 0],
  [40, 0],
  [40, 17],
  [80, 17],
  [80, 23],
  [40, 23],
  [40, 40],
  [0, 40]
]

/**
 * (c) Narrow channel: physical walls 8 mm apart (y 16..24, x 2..58); with a
 * 6 mm tool (radius 3) the TOOL-CENTER region — what the engine receives —
 * is the 2 mm strip below. Tool-center containment in the strip ⇔ the tool
 * body stays inside the 8 mm channel walls. Rule check: 8 < 2·3 + 2.5.
 */
const CHANNEL_STRIP: CamPoint2d[] = [
  [5, 19],
  [55, 19],
  [55, 21],
  [5, 21]
]

/** (d) Island fixture (same shapes as the Wave-3i islands suite). */
const ISLAND_15X10: CamPoint2d[] = [
  [20, 15],
  [35, 15],
  [35, 25],
  [20, 25]
]

/** Small L for the posted Laguna snapshot (relief present, bounded size). */
const SMALL_L: CamPoint2d[] = [
  [0, 0],
  [24, 0],
  [24, 9.5],
  [36, 9.5],
  [36, 14.5],
  [24, 14.5],
  [24, 24],
  [0, 24]
]

/** (g) Pathological comb: 1.8 mm bar + 20 narrow teeth (1.6 x 40 mm). */
function combRegion(): CamPoint2d[] {
  const pts: CamPoint2d[] = []
  pts.push([0, 0], [100, 0], [100, 1.8])
  for (let i = 19; i >= 0; i--) {
    const x0 = 2 + i * 5
    pts.push([x0 + 1.6, 1.8], [x0 + 1.6, 41.8], [x0, 41.8], [x0, 1.8])
  }
  pts.push([0, 1.8])
  return pts
}

const TOOL_DIA = 6
const CAP_DEFAULT = ADAPTIVE_DEFAULT_ENGAGEMENT_FRACTION * TOOL_DIA // 2.4

function baseParams(overrides: Partial<AdaptiveClearing2dParams>): AdaptiveClearing2dParams {
  return {
    outerRing: RECT_60X40,
    toolDiameterMm: TOOL_DIA,
    stepoverMm: 1.5,
    zPassMm: -2,
    feedMmMin: 600,
    plungeMmMin: 200,
    safeZMm: 5,
    wallStockMm: 1,
    ...overrides
  }
}

async function loadMachine(
  filename: 'laguna-swift-5x10.json' | 'makera-carvera-3axis.json'
): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

// -- Test-local geometry helpers ------------------------------------------------

function pointInRing(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function distToRing(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!
    const [bx, by] = ring[(i + 1) % ring.length]!
    best = Math.min(best, distToSegment(x, y, ax, ay, bx, by))
  }
  return best
}

// -- Test-local G-code walkers (ARC-AWARE) -----------------------------------------
//
// Phase-6 Change 1 made the trochoid relief loops NATIVE G2/G3 arcs. Every audit
// below is a geometric SAFETY proof (engagement cap, island/channel containment,
// wall clearance). If they only parsed G1 lines they would see NO trochoid moves
// and pass VACUOUSLY -- the safety net would silently stop covering the relief.
// So the collectors INTERPOLATE each G2/G3 arc into fine straight sub-segments
// (faithful port of `interpolateArc` in cam-gcode-toolpath.ts, the exact routine
// the preview parser + guardrail auditor use) and then run the same per-segment /
// per-point checks over the arc sample points. Result: the audits now enforce the
// invariants on the TRUE arc, at LEAST as strictly as they did on the old chords
// (16 sub-segments per <=180deg arc == 32 samples per circle, finer than the old
// 20 chords). If interpolation were wrong or the arcs escaped containment, these
// proofs fail -- they are genuinely load-bearing, not vacuous.

/** Sub-segments per G2/G3 arc (matches ARC_INTERPOLATION_SEGMENTS in cam-gcode-toolpath.ts). */
const ARC_SAMPLES = 16

type CutSegment = { x0: number; y0: number; x1: number; y1: number }

/**
 * Interpolate a G2/G3 arc (XY plane, I/J centre offsets) into ARC_SAMPLES straight
 * sub-segments from (x0,y0) to (x1,y1). Faithful port of `interpolateArc`
 * (cam-gcode-toolpath.ts): centre = start + (I,J); sweep sign forced by direction
 * (G2/cw => negative, G3/ccw => positive); exact endpoint on the last sub-segment.
 */
function interpolateArcSubSegments(
  cw: boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  i: number,
  j: number
): CutSegment[] {
  const cx = x0 + i
  const cy = y0 + j
  const startAngle = Math.atan2(y0 - cy, x0 - cx)
  const endAngle = Math.atan2(y1 - cy, x1 - cx)
  const r = Math.hypot(x0 - cx, y0 - cy)
  let sweep = endAngle - startAngle
  if (cw) {
    if (sweep >= 0) sweep -= 2 * Math.PI
  } else {
    if (sweep <= 0) sweep += 2 * Math.PI
  }
  const segs: CutSegment[] = []
  let px = x0
  let py = y0
  for (let s = 0; s < ARC_SAMPLES; s++) {
    const t1 = (s + 1) / ARC_SAMPLES
    const a1 = startAngle + sweep * t1
    const qx = s === ARC_SAMPLES - 1 ? x1 : cx + r * Math.cos(a1)
    const qy = s === ARC_SAMPLES - 1 ? y1 : cy + r * Math.sin(a1)
    segs.push({ x0: px, y0: py, x1: qx, y1: qy })
    px = qx
    py = qy
  }
  return segs
}

/**
 * Expand ONE motion line into its cut sub-segments from the current point. A G1
 * yields at most one segment; a G2/G3 yields ARC_SAMPLES arc-interpolated
 * sub-segments (all feed, constant Z => they inherit the modal cut Z). Returns the
 * sub-segments plus the new modal (x,y,z). Non-cut / non-motion lines return none.
 */
function expandMotionLine(
  l: string,
  x: number,
  y: number,
  z: number
): { segs: CutSegment[]; isFeedCut: boolean; nx: number; ny: number; nz: number } {
  const isArc = /^G[23]\b/.test(l)
  const isLin = /^G[01]\b/.test(l)
  if (!isArc && !isLin) return { segs: [], isFeedCut: false, nx: x, ny: y, nz: z }
  const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
  const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
  const mz = l.match(/Z(-?\d+(?:\.\d+)?)/)
  const nx = mx ? Number.parseFloat(mx[1]!) : x
  const ny = my ? Number.parseFloat(my[1]!) : y
  const nz = mz ? Number.parseFloat(mz[1]!) : z
  // A move is a CUT when it is a feed (G1/G2/G3) at or entering negative Z.
  const atDepth = nz < -1e-9 || z < -1e-9
  if (isArc) {
    // G2/G3 are always feed moves; interpolate the arc into sub-segments.
    const cw = /^G2\b/.test(l)
    const mi = l.match(/I(-?\d+(?:\.\d+)?)/)
    const mj = l.match(/J(-?\d+(?:\.\d+)?)/)
    const ci = mi ? Number.parseFloat(mi[1]!) : 0
    const cj = mj ? Number.parseFloat(mj[1]!) : 0
    const arc = interpolateArcSubSegments(cw, x, y, nx, ny, ci, cj)
    return { segs: atDepth ? arc : [], isFeedCut: atDepth, nx, ny, nz }
  }
  const isG1 = l.startsWith('G1')
  const moved = nx !== x || ny !== y
  if (isG1 && atDepth && moved) {
    return { segs: [{ x0: x, y0: y, x1: nx, y1: ny }], isFeedCut: true, nx, ny, nz }
  }
  return { segs: [], isFeedCut: false, nx, ny, nz }
}

/**
 * XY-moving FEED segments at (or entering) cut depth, tracking modal X/Y/Z.
 * ARC-AWARE: G2/G3 relief arcs are interpolated into fine sub-segments so every
 * downstream containment / clearance check sees the TRUE arc path, not a gap.
 */
function collectCutSegments(lines: ReadonlyArray<string>): CutSegment[] {
  let x = 0
  let y = 0
  let z = 100
  const segs: CutSegment[] = []
  for (const raw of lines) {
    const l = raw.trim()
    const r = expandMotionLine(l, x, y, z)
    segs.push(...r.segs)
    x = r.nx
    y = r.ny
    z = r.nz
  }
  return segs
}

/** Walks the program asserting NO XY rapid ever happens at cut depth. */
function expectNoRapidAtDepth(lines: ReadonlyArray<string>): void {
  let atDepth = false
  for (const raw of lines) {
    const l = raw.trim()
    const liftMatch = l.match(/^G0 Z(-?\d+(?:\.\d+)?)/)
    if (liftMatch && Number.parseFloat(liftMatch[1]!) > 0) {
      atDepth = false
      continue
    }
    if (/^G1\b/.test(l)) {
      const mz = l.match(/Z(-?\d+(?:\.\d+)?)/)
      if (mz && Number.parseFloat(mz[1]!) < 0) atDepth = true
      continue
    }
    if (/^G0 X/.test(l)) {
      expect(atDepth, `XY rapid at cut depth: ${l}`).toBe(false)
    }
  }
}

/** Sampled island-clearance assertion over every cut segment. */
function expectIslandClearance(
  lines: ReadonlyArray<string>,
  island: ReadonlyArray<CamPoint2d>,
  marginMm: number,
  tolMm: number
): void {
  const segs = collectCutSegments(lines)
  expect(segs.length).toBeGreaterThan(0)
  for (const s of segs) {
    for (let k = 0; k <= 16; k++) {
      const t = k / 16
      const px = s.x0 + t * (s.x1 - s.x0)
      const py = s.y0 + t * (s.y1 - s.y0)
      const d = distToRing(island, px, py)
      const inside = pointInRing(island, px, py)
      if (inside && d > tolMm) {
        throw new Error(`toolpath point (${px.toFixed(3)}, ${py.toFixed(3)}) is INSIDE the island`)
      }
      if (d + tolMm < marginMm) {
        throw new Error(
          `toolpath point (${px.toFixed(3)}, ${py.toFixed(3)}) is ${d.toFixed(4)} mm from the island (< margin ${marginMm})`
        )
      }
    }
  }
}

// -- Engagement audit (the brief's load-bearing proof) ---------------------------

type AuditSegment = CutSegment & { skipMeasure: boolean }

/**
 * Cut segments in program order with entry-slot marking: a loop is
 * skip-measured iff the `; adaptive entry slot loop` comment immediately
 * preceded its safe-Z lift. Skip-measured segments still join the frontier.
 */
function collectAuditSegments(lines: ReadonlyArray<string>, safeZ: number): AuditSegment[] {
  let x = 0
  let y = 0
  let z = 100
  let entryArm = false
  let inEntry = false
  const segs: AuditSegment[] = []
  for (const raw of lines) {
    const l = raw.trim()
    if (l.startsWith('; adaptive entry slot loop')) {
      entryArm = true
      continue
    }
    const lift = l.match(/^G0 Z(-?\d+(?:\.\d+)?)/)
    if (lift && Number.parseFloat(lift[1]!) >= safeZ - 1e-6) {
      // A safe-Z lift starts a new loop: it is the entry loop iff the arm
      // comment immediately preceded it. Any other lift ends entry mode.
      inEntry = entryArm
      entryArm = false
      z = Number.parseFloat(lift[1]!)
      continue
    }
    // ARC-AWARE: expandMotionLine emits one segment for a G1 cut and
    // ARC_SAMPLES interpolated sub-segments for a G2/G3 relief arc, so every
    // trochoid arc sample point joins the engagement-audit frontier exactly as
    // the old chord endpoints did (finer, so stricter). Each sub-segment
    // inherits the loop's entry-slot skip flag.
    const r = expandMotionLine(l, x, y, z)
    for (const s of r.segs) segs.push({ ...s, skipMeasure: inEntry })
    x = r.nx
    y = r.ny
    z = r.nz
  }
  return segs
}

/**
 * Max frontier advance over all measured segments — the per-segment radial
 * engagement bound (see the module header for the disc-overlap argument).
 */
function auditMaxAdvance(lines: ReadonlyArray<string>, safeZ: number): number {
  const segs = collectAuditSegments(lines, safeZ)
  const frontier: AuditSegment[] = []
  let maxAdv = 0
  for (const seg of segs) {
    if (frontier.length === 0 || seg.skipMeasure) {
      frontier.push(seg)
      continue
    }
    const len = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0)
    const steps = Math.max(1, Math.ceil(len / 0.2))
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const px = seg.x0 + t * (seg.x1 - seg.x0)
      const py = seg.y0 + t * (seg.y1 - seg.y0)
      let best = Number.POSITIVE_INFINITY
      for (const f of frontier) {
        const d = distToSegment(px, py, f.x0, f.y0, f.x1, f.y1)
        if (d < best) best = d
        if (best <= 1e-3) break
      }
      if (best > maxAdv) maxAdv = best
    }
    frontier.push(seg)
  }
  return maxAdv
}

// -- 1(a). Offset-spiral parity on an open rectangle ------------------------------

describe('generateAdaptiveClearing2dLines -- (a) open rectangle: steady state == offset spiral', () => {
  const params = baseParams({})

  it('matches the plain offset-spiral level count and inserts ZERO trochoids', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const spiral = computeOffsetSpiralLevels({
      outerRing: RECT_60X40,
      stepoverMm: params.stepoverMm,
      wallStockMm: params.wallStockMm
    })
    const totalLoops = spiral.levels.reduce((n, l) => n + l.loops.length, 0)
    expect(r.lines[0]).toMatch(
      new RegExp(
        `^; Adaptive clearing -- ${spiral.levels.length} inset level\\(s\\), ${totalLoops} loop\\(s\\), 0 trochoid circle\\(s\\)`
      )
    )
    expect(r.lines.some((l) => l.includes('trochoid relief'))).toBe(false)
    expect(r.lines.some((l) => l.includes('narrow region'))).toBe(false)
    expect(r.lines.some((l) => l.includes('adaptive skip'))).toBe(false)
  })

  it('traces the SAME loops as the offset spiral (identical loop-start rapids)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const spiral = generatePocketOffsetSpiralLines({
      outerRing: RECT_60X40,
      stepoverMm: params.stepoverMm,
      zPassMm: params.zPassMm,
      feedMmMin: params.feedMmMin,
      plungeMmMin: params.plungeMmMin,
      safeZMm: params.safeZMm,
      wallStockMm: params.wallStockMm
    })
    const rapids = (lines: ReadonlyArray<string>): string[] => lines.filter((l) => /^G0 X/.test(l))
    expect(rapids(r.lines)).toEqual(rapids(spiral.lines))
  })

  it('EVERY loop transition is a safe-Z lift (loops + 1 lifts, no rapid at depth)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    expectNoRapidAtDepth(r.lines)
    const lifts = r.lines.filter((l) => l.trim() === 'G0 Z5.000').length
    const loops = r.lines.filter((l) => /^G0 X/.test(l)).length
    expect(lifts).toBe(loops + 1)
  })

  it('AUDIT: steady-state engagement equals the stepover; max stays under the cap', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const max = auditMaxAdvance(r.lines, params.safeZMm)
    // Steady state IS the stepover; the only excursion is the convex-corner
    // diagonal sqrt(2)*stepover = 2.1213 -- under the 2.4 mm cap, so no
    // relief is needed (and none was inserted).
    expect(max).toBeGreaterThanOrEqual(params.stepoverMm - 0.01)
    expect(max).toBeLessThanOrEqual(Math.SQRT2 * params.stepoverMm + 0.05)
    expect(max).toBeLessThanOrEqual(CAP_DEFAULT + 0.05)
  })

  it('hints the single fully-buried entry slot loop (3i-parity honesty)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    expect(r.hints.some((h) => /1 region-entry slot loop/.test(h))).toBe(true)
    expect(r.lines.filter((l) => l.startsWith('; adaptive entry slot loop')).length).toBe(1)
  })
})

// -- 1(b). Concave L-pocket: relief + the engagement audit ------------------------

describe('generateAdaptiveClearing2dLines -- (b) concave L-pocket relief', () => {
  const params = baseParams({ outerRing: L_POCKET, wallStockMm: 0.5 })

  it('the inside-corner arm triggers trochoidal relief at level 1', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const relief = r.lines.filter((l) => l.startsWith('; adaptive trochoid relief'))
    expect(relief.length).toBeGreaterThan(0)
    expect(relief.some((l) => /level 1 inset 2\.000 mm/.test(l))).toBe(true)
    // Phase-6 Change 1: the relief is now NATIVE G2/G3 arcs, not a 20-chord G1
    // polyline. Walk the burst and assert (a) it is made of native arcs (two
    // <=180deg G3 arcs per relief circle, NOT 50+ straight chords -- a native
    // arc is 1-2 moves, the whole burst is arcs interleaved with short G1 chain
    // feeds), and (b) it reaches into the arm (x > 45; arm spans x 40..80, body
    // ends at x = 40). maxX is measured over BOTH G1 chain feeds and the arc
    // endpoints so the reach proof is not fooled by the arc split point.
    const reliefIdx = r.lines.findIndex((l) => l.startsWith('; adaptive trochoid relief'))
    let maxX = Number.NEGATIVE_INFINITY
    let arcMoves = 0
    let straightMoves = 0
    for (let i = reliefIdx + 1; i < r.lines.length; i++) {
      const l = r.lines[i]!
      if (l.startsWith(';') || /^G0 Z/.test(l)) break
      const arc = l.match(/^G[23] X(-?\d+\.\d+) Y/)
      const lin = l.match(/^G1 X(-?\d+\.\d+) Y/)
      if (arc) {
        arcMoves++
        // Native arc: G17 plane, I/J centre-offset (NEVER an R-word), correct
        // direction. A CCW trochoid sweep is emitted as G3.
        expect(l).toMatch(/^G3 X-?\d+\.\d+ Y-?\d+\.\d+ I-?\d+\.\d+ J-?\d+\.\d+ F\d+$/)
        expect(l).not.toMatch(/\bR-?\d/) // I/J centre-offset form, never R-word
        maxX = Math.max(maxX, Number.parseFloat(arc[1]!))
      } else if (lin) {
        straightMoves++
        maxX = Math.max(maxX, Number.parseFloat(lin[1]!))
      }
    }
    // Native arcs present, and NOT a 50+-chord polyline masquerading as a circle
    // (that was the old behaviour this change replaced). Two arcs per circle, so
    // arcMoves is even and > 0; the straight feeds are the short chain hops.
    expect(arcMoves).toBeGreaterThan(0)
    expect(arcMoves % 2).toBe(0)
    expect(maxX).toBeGreaterThan(45)
  })

  it('AUDIT: no measured segment advances past maxEngagementMm', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const max = auditMaxAdvance(r.lines, params.safeZMm)
    expect(max).toBeLessThanOrEqual(CAP_DEFAULT + 0.05)
  })

  it('AUDIT CONTROL: the plain offset spiral on the same L blows the cap (the fixed hazard)', () => {
    const spiral = generatePocketOffsetSpiralLines({
      outerRing: L_POCKET,
      stepoverMm: params.stepoverMm,
      zPassMm: params.zPassMm,
      feedMmMin: params.feedMmMin,
      plungeMmMin: params.plungeMmMin,
      safeZMm: params.safeZMm,
      wallStockMm: 0.5
    })
    const max = auditMaxAdvance(spiral.lines, params.safeZMm)
    expect(max).toBeGreaterThan(10) // the arm is slotted ~38 mm from any cleared path
  })

  it('exactly one entry slot loop (the body core); no wall-level skips needed', () => {
    const r = generateAdaptiveClearing2dLines(params)
    expect(r.lines.filter((l) => l.startsWith('; adaptive entry slot loop')).length).toBe(1)
    expect(r.lines.some((l) => l.includes('adaptive skip'))).toBe(false)
    expectNoRapidAtDepth(r.lines)
  })
})

// -- 1(c). Narrow channel: fully trochoidal, contained ----------------------------

describe('generateAdaptiveClearing2dLines -- (c) 8mm channel / 6mm tool fully trochoidal', () => {
  const params = baseParams({
    outerRing: CHANNEL_STRIP,
    stepoverMm: 2.5,
    wallStockMm: 0.25,
    maxEngagementMm: 2.6
  })

  it('clears the channel entirely trochoidally (narrow-region spine + perimeter)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    expect(r.lines.some((l) => l.startsWith('; adaptive narrow region -- trochoidal spine'))).toBe(true)
    expect(r.lines.some((l) => l.startsWith('; adaptive narrow region perimeter pass'))).toBe(true)
    expect(r.hints.some((h) => /1 narrow region\(s\) cleared fully trochoidally/.test(h))).toBe(true)
    // No straight slot entry, no plain rings: the region has exactly one
    // inset level and it is cleared by circles + the wall pass.
    expect(r.lines.some((l) => l.startsWith('; adaptive entry slot loop'))).toBe(false)
    const m = r.lines[0]!.match(/(\d+) trochoid circle\(s\)/)
    expect(m).not.toBeNull()
    expect(Number.parseInt(m![1]!, 10)).toBeGreaterThan(50)
  })

  it('every cut point stays inside the channel tool-center walls (tool inside the 8mm channel)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    // Legal tool-center area = strip inset by wallStock 0.25. ARC-AWARE: the
    // spine is cleared by NATIVE G2/G3 arcs, so scan every arc-interpolated
    // sub-segment endpoint (collectCutSegments expands the arcs), NOT just the
    // G1 lines -- otherwise the containment proof would skip the arc bodies and
    // pass vacuously. The arc bulges OUTWARD from its chord toward the walls, so
    // sampling the true arc is the strict check.
    const tol = 0.02
    const segs = collectCutSegments(r.lines)
    expect(segs.length).toBeGreaterThan(50)
    const check = (x: number, y: number): void => {
      expect(x).toBeGreaterThanOrEqual(5.25 - tol)
      expect(x).toBeLessThanOrEqual(54.75 + tol)
      expect(y).toBeGreaterThanOrEqual(19.25 - tol)
      expect(y).toBeLessThanOrEqual(20.75 + tol)
    }
    for (const s of segs) {
      check(s.x0, s.y0)
      check(s.x1, s.y1)
    }
  })

  it('AUDIT: the trochoid march never advances past the cap', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const max = auditMaxAdvance(r.lines, params.safeZMm)
    expect(max).toBeLessThanOrEqual(2.6 + 0.05)
    expectNoRapidAtDepth(r.lines)
  })
})

// -- 1(d). Islands respected (+ margin) -------------------------------------------

describe('generateAdaptiveClearing2dLines -- (d) islands never crossed (+ wall-stock margin)', () => {
  // wallStockMm models toolRadius (1.5) + finish stock (1.0) = 2.5 mm margin
  // (same modelling as the Wave-3i islands suite).
  const params = baseParams({
    islandRings: [ISLAND_15X10],
    stepoverMm: 2,
    wallStockMm: 2.5
  })

  it('keeps the margin off the island for EVERY cut segment, trochoid chords included', () => {
    const r = generateAdaptiveClearing2dLines(params)
    expect(r.lines.length).toBeGreaterThan(10)
    expectIslandClearance(r.lines, ISLAND_15X10, 2.5, 0.03)
  })

  it('keeps the same margin off the outer wall', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const segs = collectCutSegments(r.lines)
    for (const s of segs) {
      for (const [px, py] of [
        [s.x0, s.y0],
        [s.x1, s.y1]
      ] as const) {
        expect(distToRing(RECT_60X40, px, py)).toBeGreaterThanOrEqual(2.5 - 0.03)
      }
    }
  })

  it('AUDIT holds with islands; wall-level pinch runs are skipped honestly (hinted)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    expect(auditMaxAdvance(r.lines, params.safeZMm)).toBeLessThanOrEqual(CAP_DEFAULT + 0.05)
    // The corner pinches between island margin and wall margin cannot be
    // relieved at level 0 in v1 -- the engine lifts over them and says so.
    expect(r.hints.some((h) => /wall-level engagement spike run\(s\) skipped/.test(h))).toBe(true)
    expectNoRapidAtDepth(r.lines)
  })
})

// -- 1(e). Collapse / degenerate --------------------------------------------------

describe('generateAdaptiveClearing2dLines -- (e) collapse and degenerate inputs', () => {
  it('empty outer ring -> empty result, no throw', () => {
    const r = generateAdaptiveClearing2dLines(baseParams({ outerRing: [] }))
    expect(r).toEqual({ lines: [], hints: [] })
  })

  it('two-point ring -> empty result, no throw', () => {
    const r = generateAdaptiveClearing2dLines(
      baseParams({
        outerRing: [
          [0, 0],
          [10, 0]
        ]
      })
    )
    expect(r).toEqual({ lines: [], hints: [] })
  })

  it('collapse (wall stock > half-width) -> empty result, no throw', () => {
    const r = generateAdaptiveClearing2dLines(baseParams({ wallStockMm: 25 }))
    expect(r).toEqual({ lines: [], hints: [] })
  })

  it('invalid stepover / tool diameter -> empty result, no throw', () => {
    expect(generateAdaptiveClearing2dLines(baseParams({ stepoverMm: 0 }))).toEqual({
      lines: [],
      hints: []
    })
    expect(generateAdaptiveClearing2dLines(baseParams({ stepoverMm: Number.NaN }))).toEqual({
      lines: [],
      hints: []
    })
    expect(generateAdaptiveClearing2dLines(baseParams({ toolDiameterMm: 0 }))).toEqual({
      lines: [],
      hints: []
    })
    expect(
      generateAdaptiveClearing2dLines(baseParams({ toolDiameterMm: Number.POSITIVE_INFINITY }))
    ).toEqual({ lines: [], hints: [] })
  })
})

// -- 1(f). Determinism -------------------------------------------------------------

describe('generateAdaptiveClearing2dLines -- (f) deterministic output', () => {
  it('two identical calls produce byte-identical lines and hints', () => {
    const params = baseParams({ outerRing: L_POCKET, wallStockMm: 0.5 })
    const a = generateAdaptiveClearing2dLines(params)
    const b = generateAdaptiveClearing2dLines(params)
    expect(a.lines).toEqual(b.lines)
    expect(a.hints).toEqual(b.hints)
  })
})

// -- 1(g). Bounds: pathological comb stays under the caps ---------------------------

describe('generateAdaptiveClearing2dLines -- (g) bounded work on a pathological comb', () => {
  const params = baseParams({ outerRing: combRegion(), stepoverMm: 2.5, wallStockMm: 0.25 })

  it('caps trochoid circles at ADAPTIVE_MAX_TROCHOID_CIRCLES with an honest truncation hint', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const m = r.lines[0]!.match(/(\d+) trochoid circle\(s\)/)
    expect(m).not.toBeNull()
    expect(Number.parseInt(m![1]!, 10)).toBe(ADAPTIVE_MAX_TROCHOID_CIRCLES)
    expect(
      r.hints.some((h) =>
        h.includes(
          `trochoid relief was truncated at the ${ADAPTIVE_MAX_TROCHOID_CIRCLES.toLocaleString()}-circle bound`
        )
      )
    ).toBe(true)
    // Bounded output: the budget bounds the program size.
    expect(r.lines.length).toBeLessThan(60_000)
    expectNoRapidAtDepth(r.lines)
  })
})

// -- 1(h). Arc-equivalence: native G2/G3 == the old chord circle -------------------
//
// Phase-6 Change 1 replaced each 20-chord G1 trochoid circle with TWO native
// <=180deg arcs. This proves the emitted arc cuts the SAME geometry as the old
// chords -- same centre, same radius, same direction (CCW => G3) -- so the cut is
// identical, just fewer moves. The proof reconstructs the exact 20-chord path the
// old code produced for each parsed circle and shows the interpolated arc path
// tracks it within the combined chord/arc sagitta tolerance.

/** Reconstruct the OLD 20-chord CCW circle path (start angle 0), as the pre-arc code did. */
function oldChordCircle(cx: number, cy: number, r: number): Array<[number, number]> {
  const SEGMENTS = 20
  const pts: Array<[number, number]> = []
  const startAngle = 0 // the old code always started at angle 0 (the +X point)
  for (let s = 0; s <= SEGMENTS; s++) {
    const ang = startAngle + (s / SEGMENTS) * Math.PI * 2
    pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)])
  }
  return pts
}

/** Min distance from a point to a polyline (open) -- for Hausdorff-style comparison. */
function distPointToPolyline(px: number, py: number, poly: ReadonlyArray<[number, number]>): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < poly.length; i++) {
    const d = distToSegment(px, py, poly[i]![0], poly[i]![1], poly[i + 1]![0], poly[i + 1]![1])
    if (d < best) best = d
  }
  return best
}

describe('generateAdaptiveClearing2dLines -- (h) native arc equals the old chord circle', () => {
  const params = baseParams({ outerRing: L_POCKET, wallStockMm: 0.5 })

  it('every relief circle is TWO CCW G3 semicircles with matching centre + radius (I/J form, no R-word)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const arcs = r.lines.filter((l) => /^G[23] /.test(l))
    expect(arcs.length).toBeGreaterThan(0)
    // Every relief arc is G3 (the trochoid CCW sweep), I/J centre-offset, no R-word.
    for (const a of arcs) {
      expect(a).toMatch(/^G3 X-?\d+\.\d+ Y-?\d+\.\d+ I-?\d+\.\d+ J-?\d+\.\d+ F\d+$/)
      expect(a).not.toMatch(/\bR-?\d/)
    }
    // Two semicircles per circle: the arc count is even and equals 2 x circle count.
    const circles = Number.parseInt(r.lines[0]!.match(/(\d+) trochoid circle/)![1]!, 10)
    expect(arcs.length).toBe(2 * circles)
  })

  it('the interpolated arc path matches the OLD 20-chord circle within tolerance', () => {
    const r = generateAdaptiveClearing2dLines(params)
    // Walk the program, expanding arcs, and pair each G3-semicircle with its
    // reconstructed old-chord counterpart. The centre is start + (I,J); the
    // radius is |(I,J)|; the interpolated arc points come from the SAME routine
    // the preview/guardrail use (interpolateArcSubSegments).
    let x = 0
    let y = 0
    let checkedCircles = 0
    let maxDeviation = 0
    const lines = r.lines
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!.trim()
      const arc = l.match(/^G3 X(-?\d+\.\d+) Y(-?\d+\.\d+) I(-?\d+\.\d+) J(-?\d+\.\d+)/)
      if (!arc) {
        // track modal X/Y off any G0/G1 with coords
        const mx = l.match(/X(-?\d+\.\d+)/)
        const my = l.match(/Y(-?\d+\.\d+)/)
        if (mx) x = Number.parseFloat(mx[1]!)
        if (my) y = Number.parseFloat(my[1]!)
        continue
      }
      const x1 = Number.parseFloat(arc[1]!)
      const y1 = Number.parseFloat(arc[2]!)
      const ci = Number.parseFloat(arc[3]!)
      const cj = Number.parseFloat(arc[4]!)
      const cx = x + ci
      const cy = y + cj
      const radius = Math.hypot(ci, cj)
      // The next line should be the second semicircle closing the circle.
      const l2 = lines[i + 1]!.trim()
      const arc2 = l2.match(/^G3 X(-?\d+\.\d+) Y(-?\d+\.\d+) I(-?\d+\.\d+) J(-?\d+\.\d+)/)
      expect(arc2, `expected a second semicircle after ${l}`).not.toBeNull()
      const x2 = Number.parseFloat(arc2![1]!)
      const y2 = Number.parseFloat(arc2![2]!)
      const i2 = Number.parseFloat(arc2![3]!)
      const j2 = Number.parseFloat(arc2![4]!)
      const cx2 = x1 + i2
      const cy2 = y1 + j2
      // Both semicircles share the SAME centre + radius (the true circle).
      expect(Math.hypot(cx2 - cx, cy2 - cy)).toBeLessThanOrEqual(1e-3)
      expect(Math.abs(Math.hypot(i2, j2) - radius)).toBeLessThanOrEqual(1e-3)
      // Interpolate BOTH semicircles into fine points (the routine the preview uses).
      const seg1 = interpolateArcSubSegments(false, x, y, x1, y1, ci, cj)
      const seg2 = interpolateArcSubSegments(false, x1, y1, x2, y2, i2, j2)
      const arcPts: Array<[number, number]> = [[x, y]]
      for (const s of seg1) arcPts.push([s.x1, s.y1])
      for (const s of seg2) arcPts.push([s.x1, s.y1])
      // Reconstruct the OLD chord circle from the same centre + radius and
      // compare each interpolated arc point to it (Hausdorff, one direction).
      const oldPts = oldChordCircle(cx, cy, radius)
      for (const [px, py] of arcPts) {
        const d = distPointToPolyline(px, py, oldPts)
        if (d > maxDeviation) maxDeviation = d
      }
      // And every old chord vertex is close to the interpolated arc path.
      for (const [px, py] of oldPts) {
        const d = distPointToPolyline(px, py, arcPts)
        if (d > maxDeviation) maxDeviation = d
      }
      checkedCircles++
      x = x2
      y = y2
      i++ // consumed the paired semicircle
    }
    expect(checkedCircles).toBeGreaterThan(0)
    // Combined sagitta bound: the 20-chord polygon deviates from the true circle
    // by up to r(1-cos(pi/20)) ~= 0.0148 mm at R=1.2; the 16-sub interpolation is
    // finer. 0.02 mm admits both discretizations -- the cut is geometrically the
    // same circle.
    expect(maxDeviation).toBeLessThanOrEqual(0.02)
  })

  it('the arc sweeps the SAME direction the chords did (CCW: first step raises Y from the +X start)', () => {
    const r = generateAdaptiveClearing2dLines(params)
    const lines = r.lines
    let x = 0
    let y = 0
    for (const raw of lines) {
      const l = raw.trim()
      const arc = l.match(/^G3 X(-?\d+\.\d+) Y(-?\d+\.\d+) I(-?\d+\.\d+) J(-?\d+\.\d+)/)
      if (!arc) {
        const mx = l.match(/X(-?\d+\.\d+)/)
        const my = l.match(/Y(-?\d+\.\d+)/)
        if (mx) x = Number.parseFloat(mx[1]!)
        if (my) y = Number.parseFloat(my[1]!)
        continue
      }
      const x1 = Number.parseFloat(arc[1]!)
      const y1 = Number.parseFloat(arc[2]!)
      const ci = Number.parseFloat(arc[3]!)
      const cj = Number.parseFloat(arc[4]!)
      // First semicircle starts at the +X point of its circle (I = -r, J = 0), so
      // the CCW sweep first moves toward +Y: the old chords did exactly this
      // (24.476,11.364 -> 24.417,11.735 -- Y increases). Take the FIRST such arc.
      if (Math.abs(cj) < 1e-9 && ci < 0) {
        const seg = interpolateArcSubSegments(false, x, y, x1, y1, ci, cj)
        // The first interpolated sub-point must have Y > start Y (rising, CCW).
        expect(seg[0]!.y1).toBeGreaterThan(y)
        return
      }
      x = x1
      y = y1
    }
    throw new Error('no leading +X-start semicircle found to check direction')
  })
})

// -- 2. Engine-level safety params --------------------------------------------------

describe('generateAdaptiveClearing2dLines -- depth cap, multi-depth, ramp entry', () => {
  it('hard-caps depth to stockBoxZMm (belt + braces with the dispatcher)', () => {
    const r = generateAdaptiveClearing2dLines(baseParams({ zPassMm: -12, stockBoxZMm: 5 }))
    let deepest = 0
    for (const l of r.lines) {
      const m = l.match(/Z(-?\d+(?:\.\d+)?)/)
      if (m) deepest = Math.min(deepest, Number.parseFloat(m[1]!))
    }
    expect(deepest).toBeGreaterThanOrEqual(-5 - 1e-6)
    expect(r.hints.some((h) => /depth cap reduced from 12\.000 mm to the 5\.000 mm stock thickness/.test(h))).toBe(
      true
    )
  })

  it('steps down through depths via zStepMm', () => {
    const r = generateAdaptiveClearing2dLines(baseParams({ zPassMm: -4, zStepMm: 2 }))
    const text = r.lines.join('\n')
    expect(text).toMatch(/G1 Z-2\.000 F200/)
    expect(text).toMatch(/G1 Z-4\.000 F200/)
  })

  it('supports ramp entry per loop and lengthens the run for rampMaxAngleDeg (3i parity)', () => {
    const r = generateAdaptiveClearing2dLines(
      baseParams({ entryMode: 'ramp', rampMm: 1.5, rampMaxAngleDeg: 45 })
    )
    expect(r.lines.some((l) => /^G1 X-?\d+\.\d+ Y-?\d+\.\d+ Z-2\.000 F200$/.test(l))).toBe(true)
    expect(r.lines.some((l) => /^G1 Z-2\.000 F200$/.test(l.trim()))).toBe(false)
    expect(r.hints.some((h) => /lengthened/i.test(h))).toBe(true)
  })

  it('leads with the body comment and starts/ends at safe Z', () => {
    const r = generateAdaptiveClearing2dLines(baseParams({}))
    expect(r.lines[0]).toMatch(/^; Adaptive clearing -- /)
    const exec = r.lines.filter((l) => !l.trim().startsWith(';'))
    expect(exec[0]!.trim()).toBe('G0 Z5.000')
    expect(exec[exec.length - 1]!.trim()).toBe('G0 Z5.000')
  })
})

// -- 3. Posted G-code -- Laguna Swift / RichAuto (vcarve_mach3.hbs) -----------------

describe('adaptive clearing posted through vcarve_mach3.hbs on Laguna Swift 5x10', () => {
  async function postLaguna(
    params: AdaptiveClearing2dParams
  ): Promise<{ gcode: string; hints: string[] }> {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const body = generateAdaptiveClearing2dLines(params)
    expect(body.lines.length).toBeGreaterThan(0)
    const posted = await renderPost(RESOURCES_ROOT, machine, body.lines, {
      operationLabel: 'Adaptive clearing -- L pocket'
    })
    return { gcode: posted.gcode, hints: body.hints }
  }

  const lagunaParams: AdaptiveClearing2dParams = {
    outerRing: SMALL_L,
    toolDiameterMm: 6,
    stepoverMm: 1.5,
    zPassMm: -3,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    wallStockMm: 0.5
  }

  it('emits a non-empty program wrapped in two % tape markers', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    expect(gcode.length).toBeGreaterThan(200)
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
  })

  it('emits G21 -> G90 -> G17 in order and never G20', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).not.toMatch(/^G20\b/m)
  })

  it('warms the spindle (M3 -> G4 P2.0), cools it down (M5 -> G4 P3.0), and never reverses (no M4)', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    const m3 = gcode.search(/^M3\b/m)
    const warm = gcode.indexOf('G4 P2.0')
    const m5 = gcode.search(/^M5\b/m)
    const cool = gcode.indexOf('G4 P3.0')
    expect(m3).toBeGreaterThan(-1)
    expect(warm).toBeGreaterThan(m3)
    expect(m5).toBeGreaterThan(warm)
    expect(cool).toBeGreaterThan(m5)
    expect(gcode).not.toMatch(/^M4\b/m)
  })

  it('ends with M30 (Mach3/RichAuto terminator) and NEVER M2', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
  })

  it('SAFETY: no XY rapid happens at cut depth anywhere in the posted program', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    expectNoRapidAtDepth(gcode.split('\n'))
  })

  it('SAFETY: posted depth never exceeds the stock thickness cap', async () => {
    const { gcode, hints } = await postLaguna({ ...lagunaParams, zPassMm: -12, stockBoxZMm: 5 })
    let deepest = 0
    for (const l of gcode.split('\n')) {
      const m = l.match(/Z(-?\d+(?:\.\d+)?)/)
      if (m) deepest = Math.min(deepest, Number.parseFloat(m[1]!))
    }
    expect(deepest).toBeGreaterThanOrEqual(-5 - 1e-6)
    expect(hints.some((h) => /depth cap reduced from 12\.000 mm to the 5\.000 mm stock thickness/.test(h))).toBe(
      true
    )
  })

  it('the posted body carries the relief (trochoid comment + circles survive the post)', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    expect(gcode).toMatch(/; adaptive trochoid relief -- level 1/)
  })

  it('matches the posted-program snapshot (NEW snapshot for the new op family)', async () => {
    const { gcode } = await postLaguna(lagunaParams)
    expect(gcode).toMatchSnapshot()
  })
})

// -- 4. Posted G-code -- Makera Carvera 3-axis (carvera_3axis.hbs) ------------------

describe('adaptive clearing posted through carvera_3axis.hbs on Makera Carvera 3-axis', () => {
  // Carvera-scale fixture: a 40x30 pocket, feeds INSIDE the 2400 mm/min
  // Carvera ceiling (never copy Laguna feeds onto the 200 W spindle).
  const carveraParams: AdaptiveClearing2dParams = {
    outerRing: [
      [0, 0],
      [40, 0],
      [40, 30],
      [0, 30]
    ],
    toolDiameterMm: 6,
    stepoverMm: 1.5,
    zPassMm: -2,
    feedMmMin: 1200,
    plungeMmMin: 300,
    safeZMm: 5,
    wallStockMm: 0.5
  }

  async function postCarvera(): Promise<string> {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const body = generateAdaptiveClearing2dLines(carveraParams)
    expect(body.lines.length).toBeGreaterThan(0)
    const posted = await renderPost(RESOURCES_ROOT, machine, body.lines, {
      operationLabel: 'Adaptive clearing -- Carvera pocket'
    })
    return posted.gcode
  }

  it('emits G21 -> G90 -> G17 and the ATC block (M6 T1 then G43 H1)', async () => {
    const gcode = await postCarvera()
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    const m6 = gcode.search(/^M6 T1\b/m)
    const g43 = gcode.search(/^G43 H1\b/m)
    expect(m6).toBeGreaterThan(-1)
    expect(g43).toBeGreaterThan(m6)
    expect(gcode).not.toMatch(/^G20\b/m)
  })

  it('dwells after spindle start (M3 -> G4 P2) so the 200W spindle reaches RPM', async () => {
    const gcode = await postCarvera()
    const m3 = gcode.search(/^M3\b/m)
    const dwell = gcode.search(/^G4 P2\b/m)
    expect(m3).toBeGreaterThan(-1)
    expect(dwell).toBeGreaterThan(m3)
  })

  it('ends M5 -> G49 -> M9 -> M2 and NEVER M30 (Smoothieware may delete the SD file)', async () => {
    const gcode = await postCarvera()
    const m5 = gcode.search(/^M5\b/m)
    const g49 = gcode.search(/^G49\b/m)
    const m9 = gcode.search(/^M9\b/m)
    const m2 = gcode.search(/^M2\b/m)
    expect(m5).toBeGreaterThan(-1)
    expect(g49).toBeGreaterThan(m5)
    expect(m9).toBeGreaterThan(g49)
    expect(m2).toBeGreaterThan(m9)
    expect(gcode).not.toMatch(/^M30\b/m)
  })

  it('pure 3-axis output: no A-axis words anywhere', async () => {
    const gcode = await postCarvera()
    for (const raw of gcode.split('\n')) {
      const code = raw.split(';')[0]!
      expect(code).not.toMatch(/\bA-?\d/)
    }
  })

  it('SAFETY: no XY rapid at cut depth; every feed inside the 2400 mm/min Carvera ceiling', async () => {
    const gcode = await postCarvera()
    expectNoRapidAtDepth(gcode.split('\n'))
    for (const raw of gcode.split('\n')) {
      const m = raw.split(';')[0]!.match(/F(\d+(?:\.\d+)?)/)
      if (m) expect(Number.parseFloat(m[1]!)).toBeLessThanOrEqual(2400)
    }
  })
})
