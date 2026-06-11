/**
 * Stack C v1 — rest-region solver validation gate (Safety Rule 5 + the
 * gcode-safety skill checklist), in the cam-adaptive-clearing test pattern.
 *
 * Covers all halves of the build brief:
 *
 *  1. SOLVER GEOMETRY (pure, no I/O) — the load-bearing real-fixture proofs on
 *     the canonical 60x40 rectangle with prevTool 12 mm / current 6 mm:
 *     (a) rest regions exist ONLY near the 4 corners — every vertex within
 *         prevR of a corner (ball-convexity makes the vertex bound rigorous);
 *     (b) AREA AUDIT — each corner lobe ≈ (1 − π/4)·prevR², total ≈ 4 lobes,
 *         and a clipper sweep audit proves the composed spiral toolpath covers
 *         the rest region to ≈ 0 leftover;
 *     (c) NOTHING in the open center (the previous tool cleared it);
 *     (d) islands respected — wide gaps add no rest, a too-narrow channel
 *         under an island becomes rest, rest never enters the island, and the
 *         prev-tool-cannot-enter case decomposes holes into islandRings;
 *     (e) degenerate honesty — prevR <= currentR / empty rest / sliver dust →
 *         empty + the brief's hints, never a throw;
 *     (f) determinism — identical calls, deep-equal results, canonical order.
 *
 *  2. COMPOSITION into the EXISTING generators (no reinvention):
 *     cam-pocket-offset `generatePocketOffsetSpiralLines` and the Stack-B
 *     `generateAdaptiveClearing2dLines` consume the rest regions as-is; the
 *     adaptive result keeps its `adaptiveClearedToWalls` finish-gate contract.
 *     Rest mode adds NO outer-wall finish trace (the previous tool already
 *     finished the wall) — pinned via the exported hint + a total-cut-length
 *     budget that a full-perimeter re-trace would blow.
 *
 *  3. POSTED G-CODE through the REAL posts + bundled machine profiles:
 *     - vcarve_mach3.hbs + laguna-swift-5x10.json: % tape markers, G21 ->
 *       G90 -> G17 (never G20), M3 + G4 P2.0 warm-up, M5 -> G4 P3.0
 *       cool-down, M30 (NEVER M2), no M4, no XY rapid at cut depth, every
 *       cut confined to the corner zones, NEW posted snapshot.
 *     - carvera_3axis.hbs + makera-carvera-3axis.json: ATC M6 T1 + G43 H1,
 *       G4 P2 spindle dwell, footer M5 -> G49 -> M9 -> M2 (NEVER M30), no
 *       A-axis words, feeds inside the 2400 mm/min ceiling, NEW snapshot.
 *
 * Ops WITHOUT restPrevToolDiameterMm are untouched by construction (this
 * module is additive; dispatch wiring is the Wire phase) — the existing
 * pocket/adaptive suites + snapshots pin that identity.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ClipperLib, { type IntPoint } from 'clipper-lib'
import { CLIPPER_SCALE } from '../shared/sketch-boolean-offset'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { generatePocket2dLines, type CamPoint2d } from './cam-local'
import {
  computeOffsetSpiralLevels,
  generatePocketOffsetSpiralLines
} from './cam-pocket-offset'
import { generateAdaptiveClearing2dLines } from './cam-adaptive-clearing'
import { renderPost } from './post-process'
import {
  REST_MIN_AREA_MM2,
  REST_SKIP_WALL_FINISH_HINT,
  solveRestRegion,
  type RestRegion
} from './cam-rest-region'

// -- Fixtures ------------------------------------------------------------------

const RESOURCES_ROOT = join(process.cwd(), 'resources')

/** The brief's canonical fixture: an open 60 x 40 mm rectangular pocket. */
const RECT_60X40: CamPoint2d[] = [
  [0, 0],
  [60, 0],
  [60, 40],
  [0, 40]
]

/** Canonical-order corners (solver sorts regions bbox minX, then minY). */
const CORNERS_60X40: CamPoint2d[] = [
  [0, 0],
  [0, 40],
  [60, 0],
  [60, 40]
]

const PREV_DIA = 12
const PREV_R = PREV_DIA / 2
const CURRENT_DIA = 6

/** Exact unreachable corner-lobe area for a square corner: (1 - π/4)·prevR². */
const LOBE_AREA = (1 - Math.PI / 4) * PREV_R * PREV_R // ≈ 7.7256 mm²

/** Island with wide gaps (≥ 15 mm > prev tool 12) — adds NO rest material. */
const ISLAND_WIDE: CamPoint2d[] = [
  [20, 15],
  [35, 15],
  [35, 25],
  [20, 25]
]

/** Island leaving an 8 mm channel below it — the 12 mm prev tool cannot enter. */
const ISLAND_CHANNEL: CamPoint2d[] = [
  [20, 8],
  [35, 8],
  [35, 18],
  [20, 18]
]

/** 64-gon "circle" r 20 — its opening by prevR 6 leaves only sub-floor dust. */
function circle64(): CamPoint2d[] {
  const pts: CamPoint2d[] = []
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2
    pts.push([30 + 20 * Math.cos(t), 20 + 20 * Math.sin(t)])
  }
  return pts
}

async function loadMachine(
  filename: 'laguna-swift-5x10.json' | 'makera-carvera-3axis.json'
): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

// -- Test-local geometry helpers ------------------------------------------------

/** Signed shoelace area (mm²) of an implicitly-closed ring. */
function ringAreaMm2(ring: ReadonlyArray<CamPoint2d>): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** NET material area of a rest region (outer minus holes), mm². */
function regionNetAreaMm2(region: RestRegion): number {
  return (
    Math.abs(ringAreaMm2(region.outerRing)) -
    region.islandRings.reduce((s, r) => s + Math.abs(ringAreaMm2(r)), 0)
  )
}

function dist(a: CamPoint2d, b: CamPoint2d): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Max distance from any region vertex (outer + islands) to `corner`. */
function maxVertexDistance(region: RestRegion, corner: CamPoint2d): number {
  let max = 0
  for (const p of region.outerRing) max = Math.max(max, dist(p, corner))
  for (const ring of region.islandRings) for (const p of ring) max = Math.max(max, dist(p, corner))
  return max
}

/** Min over the fixture corners of the max vertex distance — "nearest corner" fit. */
function nearestCornerMaxDistance(region: RestRegion, corners: ReadonlyArray<CamPoint2d>): number {
  return Math.min(...corners.map((c) => maxVertexDistance(region, c)))
}

function pointInRing(ring: ReadonlyArray<CamPoint2d>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// -- Test-local clipper audit helpers --------------------------------------------

function toIntPath(pts: ReadonlyArray<CamPoint2d>): IntPoint[] {
  return pts.map((p) => ({ X: Math.round(p[0] * CLIPPER_SCALE), Y: Math.round(p[1] * CLIPPER_SCALE) }))
}

/** A rest region as clipper paths (outer − islands, NonZero difference). */
function regionPathsInt(region: RestRegion): IntPoint[][] {
  const clipper = new ClipperLib.Clipper()
  clipper.AddPath(toIntPath(region.outerRing), ClipperLib.PolyType.ptSubject, true)
  if (region.islandRings.length > 0) {
    clipper.AddPaths(region.islandRings.map(toIntPath), ClipperLib.PolyType.ptClip, true)
  }
  const sol: IntPoint[][] = []
  const fill = ClipperLib.PolyFillType.pftNonZero
  clipper.Execute(ClipperLib.ClipType.ctDifference, sol, fill, fill)
  return sol
}

/**
 * COVERAGE AUDIT (the brief's clipper area audit): material left in `region`
 * after sweeping a cutter of radius `sweepRadiusMm` along every closed
 * tool-center loop — region MINUS union(loop bands) net area in mm².
 */
function uncoveredAreaMm2(
  region: RestRegion,
  loops: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
  sweepRadiusMm: number
): number {
  const bands: IntPoint[][] = []
  for (const loop of loops) {
    const co = new ClipperLib.ClipperOffset(2, 0.01 * CLIPPER_SCALE)
    co.AddPath(toIntPath(loop), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedLine)
    const sol: IntPoint[][] = []
    co.Execute(sol, sweepRadiusMm * CLIPPER_SCALE)
    bands.push(...sol)
  }
  const fill = ClipperLib.PolyFillType.pftNonZero
  let bandUnion: IntPoint[][] = []
  if (bands.length > 0) {
    const u = new ClipperLib.Clipper()
    u.AddPaths(bands, ClipperLib.PolyType.ptSubject, true)
    bandUnion = []
    u.Execute(ClipperLib.ClipType.ctUnion, bandUnion, fill, fill)
  }
  const d = new ClipperLib.Clipper()
  d.AddPaths(regionPathsInt(region), ClipperLib.PolyType.ptSubject, true)
  if (bandUnion.length > 0) d.AddPaths(bandUnion, ClipperLib.PolyType.ptClip, true)
  const leftover: IntPoint[][] = []
  d.Execute(ClipperLib.ClipType.ctDifference, leftover, fill, fill)
  let net = 0
  for (const p of leftover) net += ClipperLib.Clipper.Area(p)
  return net / (CLIPPER_SCALE * CLIPPER_SCALE)
}

// -- Test-local G-code walkers ----------------------------------------------------

/** Every XY coordinate appearing on a G0/G1 line. */
function collectMoveXY(lines: ReadonlyArray<string>): CamPoint2d[] {
  const out: CamPoint2d[] = []
  for (const raw of lines) {
    const l = raw.trim()
    if (!/^G[01]\b/.test(l)) continue
    const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
    const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
    if (mx && my) out.push([Number.parseFloat(mx[1]!), Number.parseFloat(my[1]!)])
  }
  return out
}

/** Total XY path length (mm) of all G1 feed moves, tracking modal position. */
function totalFeedLengthMm(lines: ReadonlyArray<string>): number {
  let x = 0
  let y = 0
  let started = false
  let total = 0
  for (const raw of lines) {
    const l = raw.trim()
    if (!/^G[01]\b/.test(l)) continue
    const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
    const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
    if (!mx && !my) continue
    const nx = mx ? Number.parseFloat(mx[1]!) : x
    const ny = my ? Number.parseFloat(my[1]!) : y
    if (l.startsWith('G1') && started) total += Math.hypot(nx - x, ny - y)
    x = nx
    y = ny
    started = true
  }
  return total
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
    if (/^G0\b/.test(l) && /[XY]-?\d/.test(l)) {
      expect(atDepth, `XY rapid at cut depth: ${l}`).toBe(false)
    }
  }
}

// -- 1(a)+(b)+(c). Canonical fixture: 60x40 rect, prev 12 mm, current 6 mm --------

describe('solveRestRegion -- corner lobes of the 60x40 rectangle (prev 12 mm)', () => {
  const solved = solveRestRegion({
    outerRing: RECT_60X40,
    prevToolDiameterMm: PREV_DIA,
    toolDiameterMm: CURRENT_DIA
  })

  it('returns exactly 4 hole-free regions in canonical (bbox minX, minY) order', () => {
    expect(solved.regions.length).toBe(4)
    for (const region of solved.regions) expect(region.islandRings).toEqual([])
  })

  it('(a) every region sits at its corner: all vertices within prevR of one corner', () => {
    // Canonical order pins region[i] to CORNERS_60X40[i].
    solved.regions.forEach((region, i) => {
      const corner = CORNERS_60X40[i]!
      // Ball-convexity: all vertices within prevR of the corner bounds the
      // whole polygon (the polygon is inside its vertices' convex hull).
      expect(maxVertexDistance(region, corner)).toBeLessThanOrEqual(PREV_R + 0.1)
    })
  })

  it('(a) the lobes are NOT inset by the current tool (legs reach the full prevR)', () => {
    // The lobe legs end exactly prevR from the corner. Had the solver eroded
    // by the current radius (3 mm) the max vertex distance would collapse.
    for (const region of solved.regions) {
      expect(nearestCornerMaxDistance(region, CORNERS_60X40)).toBeGreaterThanOrEqual(PREV_R - 0.05)
    }
  })

  it('(b) AREA AUDIT: each lobe ≈ (1 − π/4)·prevR², total ≈ 4 lobes', () => {
    let total = 0
    for (const region of solved.regions) {
      const area = regionNetAreaMm2(region)
      expect(Math.abs(area - LOBE_AREA)).toBeLessThanOrEqual(0.15)
      total += area
    }
    expect(Math.abs(total - 4 * LOBE_AREA)).toBeLessThanOrEqual(0.45)
  })

  it('(c) the open center is EMPTY: no rest geometry anywhere near it', () => {
    for (const region of solved.regions) {
      for (const p of region.outerRing) {
        const inCenter = p[0] > 8 && p[0] < 52 && p[1] > 8 && p[1] < 32
        expect(inCenter, `rest vertex ${p[0]},${p[1]} in the open center`).toBe(false)
      }
    }
  })

  it('pushes the rest-mode finish-pass rule (no outer-wall re-trace) as a hint', () => {
    expect(solved.hints).toContain(REST_SKIP_WALL_FINISH_HINT)
    expect(REST_SKIP_WALL_FINISH_HINT).toMatch(/no outer-wall finish trace/)
  })

  it('honors wallStockMm: lobes anchor at the inset corners and stay off the walls', () => {
    const stocked = solveRestRegion({
      outerRing: RECT_60X40,
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA,
      wallStockMm: 1
    })
    expect(stocked.regions.length).toBe(4)
    const insetCorners: CamPoint2d[] = [
      [1, 1],
      [1, 39],
      [59, 1],
      [59, 39]
    ]
    stocked.regions.forEach((region, i) => {
      expect(maxVertexDistance(region, insetCorners[i]!)).toBeLessThanOrEqual(PREV_R + 0.1)
      expect(Math.abs(regionNetAreaMm2(region) - LOBE_AREA)).toBeLessThanOrEqual(0.15)
      for (const p of region.outerRing) {
        expect(p[0]).toBeGreaterThanOrEqual(1 - 1e-3)
        expect(p[0]).toBeLessThanOrEqual(59 + 1e-3)
        expect(p[1]).toBeGreaterThanOrEqual(1 - 1e-3)
        expect(p[1]).toBeLessThanOrEqual(39 + 1e-3)
      }
    })
  })
})

// -- 1(d). Islands respected -------------------------------------------------------

describe('solveRestRegion -- (d) islands', () => {
  it('wide-gap island adds NO rest (convex island corners are fully sweepable)', () => {
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      islandRings: [ISLAND_WIDE],
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA
    })
    // Only the 4 outer corner lobes — nothing near the island.
    expect(solved.regions.length).toBe(4)
    for (const region of solved.regions) {
      expect(region.islandRings).toEqual([])
      expect(nearestCornerMaxDistance(region, CORNERS_60X40)).toBeLessThanOrEqual(PREV_R + 0.1)
    }
  })

  it('a too-narrow channel under an island becomes rest; rest never enters the island', () => {
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      islandRings: [ISLAND_CHANNEL],
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA
    })
    // 4 outer corner lobes + the unreachable 8 mm channel under the island.
    expect(solved.regions.length).toBe(5)
    const channel = solved.regions.filter(
      (r) => r.outerRing.some((p) => p[0] > 18 && p[0] < 37 && p[1] < 8.5)
    )
    expect(channel.length).toBe(1)
    // The channel region spans under the island's center.
    expect(pointInRing(channel[0]!.outerRing, 27.5, 4)).toBe(true)
    // Rest NEVER enters the island (vertices may touch the wall, not cross it).
    for (const region of solved.regions) {
      for (const p of region.outerRing) {
        const strictlyInIsland = p[0] > 20.05 && p[0] < 34.95 && p[1] > 8.05 && p[1] < 17.95
        expect(strictlyInIsland, `rest vertex ${p[0]},${p[1]} inside the island`).toBe(false)
      }
      // ... and stays inside the pocket outer.
      for (const p of region.outerRing) {
        expect(p[0]).toBeGreaterThanOrEqual(-1e-3)
        expect(p[0]).toBeLessThanOrEqual(60 + 1e-3)
        expect(p[1]).toBeGreaterThanOrEqual(-1e-3)
        expect(p[1]).toBeLessThanOrEqual(40 + 1e-3)
      }
    }
  })

  it('prev tool cannot enter at all -> the WHOLE region is rest, holes become islandRings', () => {
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      islandRings: [ISLAND_WIDE],
      prevToolDiameterMm: 200,
      toolDiameterMm: CURRENT_DIA
    })
    expect(solved.regions.length).toBe(1)
    const region = solved.regions[0]!
    expect(region.islandRings.length).toBe(1)
    // Net area = full pocket region: 60·40 − 15·10 = 2250 mm².
    expect(Math.abs(regionNetAreaMm2(region) - 2250)).toBeLessThanOrEqual(0.5)
    expect(solved.hints.some((h) => /could not enter this region anywhere/.test(h))).toBe(true)
    // The hole ring is the island, decomposed into the region model.
    const island = region.islandRings[0]!
    expect(Math.abs(Math.abs(ringAreaMm2(island)) - 150)).toBeLessThanOrEqual(0.1)
    for (const p of island) {
      expect(p[0]).toBeGreaterThanOrEqual(20 - 1e-3)
      expect(p[0]).toBeLessThanOrEqual(35 + 1e-3)
      expect(p[1]).toBeGreaterThanOrEqual(15 - 1e-3)
      expect(p[1]).toBeLessThanOrEqual(25 + 1e-3)
    }
  })
})

// -- 1(e). Degenerate honesty -------------------------------------------------------

describe('solveRestRegion -- (e) degenerate inputs are honest (empty + hint, no throw)', () => {
  it('prevR <= currentR -> empty + "rest machining requires a larger previous tool"', () => {
    for (const prev of [6, 5, 3]) {
      const solved = solveRestRegion({
        outerRing: RECT_60X40,
        prevToolDiameterMm: prev,
        toolDiameterMm: 6
      })
      expect(solved.regions).toEqual([])
      expect(solved.hints.some((h) => /rest machining requires a larger previous tool/i.test(h))).toBe(true)
    }
  })

  it('invalid previous diameter (NaN / 0 / negative) -> empty + hint', () => {
    for (const prev of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY]) {
      const solved = solveRestRegion({ outerRing: RECT_60X40, prevToolDiameterMm: prev })
      expect(solved.regions).toEqual([])
      expect(solved.hints.some((h) => /positive, finite tool diameter/.test(h))).toBe(true)
    }
  })

  it('degenerate region (empty / 2-point outer, islands consuming it) -> empty + hint', () => {
    const cases = [
      solveRestRegion({ outerRing: [], prevToolDiameterMm: PREV_DIA }),
      solveRestRegion({
        outerRing: [
          [0, 0],
          [10, 0]
        ],
        prevToolDiameterMm: PREV_DIA
      }),
      solveRestRegion({
        outerRing: RECT_60X40,
        islandRings: [RECT_60X40],
        prevToolDiameterMm: PREV_DIA
      })
    ]
    for (const solved of cases) {
      expect(solved.regions).toEqual([])
      expect(solved.hints.some((h) => /empty or degenerate/.test(h))).toBe(true)
    }
  })

  it('wall stock consuming the region -> empty + hint', () => {
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      prevToolDiameterMm: PREV_DIA,
      wallStockMm: 25
    })
    expect(solved.regions).toEqual([])
    expect(solved.hints.some((h) => /wallStockMm 25\.000 consumed the entire region/.test(h))).toBe(true)
  })

  it('empty rest (round region, only sub-floor dust) -> "left nothing this tool can reach"', () => {
    // The opening of a 64-gon circle by prevR 6 leaves 64 corner slivers of
    // ~0.004 mm² each — all under the REST_MIN_AREA_MM2 floor (0.01 mm²).
    expect(REST_MIN_AREA_MM2).toBe(0.01)
    const solved = solveRestRegion({
      outerRing: circle64(),
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA
    })
    expect(solved.regions).toEqual([])
    expect(solved.hints.some((h) => /dropped \d+ sliver region\(s\)/.test(h))).toBe(true)
    expect(solved.hints.some((h) => /left nothing this tool can reach/.test(h))).toBe(true)
    // No finish-pass hint when there is nothing to cut.
    expect(solved.hints).not.toContain(REST_SKIP_WALL_FINISH_HINT)
  })
})

// -- 1(f). Determinism ---------------------------------------------------------------

describe('solveRestRegion -- (f) deterministic output', () => {
  it('two identical calls produce deep-equal regions and hints (canonical order)', () => {
    const params = {
      outerRing: RECT_60X40,
      islandRings: [ISLAND_CHANNEL],
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA,
      wallStockMm: 0.5
    }
    const a = solveRestRegion(params)
    const b = solveRestRegion(params)
    expect(a).toEqual(b)
  })
})

// -- 2. COMPOSITION into the existing generators -------------------------------------

describe('rest regions composed into generatePocketOffsetSpiralLines (cnc_pocket)', () => {
  const solved = solveRestRegion({
    outerRing: RECT_60X40,
    prevToolDiameterMm: PREV_DIA,
    toolDiameterMm: CURRENT_DIA
  })

  function spiralFor(region: RestRegion): string[] {
    const r = generatePocketOffsetSpiralLines({
      outerRing: region.outerRing,
      islandRings: region.islandRings,
      stepoverMm: 2.4,
      zPassMm: -3,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: 6,
      // Wall stock is already applied by the solver — never re-applied here.
      wallStockMm: 0
    })
    return r.lines
  }

  it('every region clears (non-empty body); ALL move coords stay within prevR of a corner', () => {
    for (const region of solved.regions) {
      const lines = spiralFor(region)
      expect(lines.length).toBeGreaterThan(0)
      for (const [x, y] of collectMoveXY(lines)) {
        const near = CORNERS_60X40.some((c) => Math.hypot(x - c[0], y - c[1]) <= PREV_R + 0.1)
        expect(near, `cut point ${x},${y} outside every corner zone`).toBe(true)
      }
      expectNoRapidAtDepth(lines)
    }
  })

  it('emits NOTHING in the open center (the previous tool cleared it)', () => {
    for (const region of solved.regions) {
      for (const [x, y] of collectMoveXY(spiralFor(region))) {
        const inCenter = x > 8 && x < 52 && y > 8 && y < 32
        expect(inCenter, `cut point ${x},${y} in the open center`).toBe(false)
      }
    }
  })

  it('(b) COVERAGE AUDIT: rest region minus the swept toolpath coverage ≈ 0', () => {
    // Sweep the CURRENT tool (radius 3) along the offset-spiral tool-center
    // loops; stepover 2.4 < radius 3 makes full coverage a theorem — the
    // clipper audit proves the emitted loops actually deliver it.
    for (const region of solved.regions) {
      const { levels } = computeOffsetSpiralLevels({
        outerRing: region.outerRing,
        islandRings: region.islandRings,
        stepoverMm: 2.4,
        wallStockMm: 0
      })
      const loops: CamPoint2d[][] = []
      for (const level of levels) for (const loop of level.loops) loops.push([...loop.points])
      expect(loops.length).toBeGreaterThan(0)
      const leftover = uncoveredAreaMm2(region, loops, CURRENT_DIA / 2)
      expect(leftover).toBeLessThanOrEqual(0.02)
    }
  })

  it('NO outer-wall re-trace: total composed cut length is corner-lobe sized', () => {
    // 4 lobes ≈ 21.4 mm of boundary each (~86 mm). A full-pocket clearing or a
    // 60x40 perimeter finish trace (200 mm) would blow this budget.
    let total = 0
    for (const region of solved.regions) total += totalFeedLengthMm(spiralFor(region))
    expect(total).toBeGreaterThan(40)
    expect(total).toBeLessThan(150)
  })

  it('composes into the cam-local raster pocket too (rows confined to the corner zones)', () => {
    for (const region of solved.regions) {
      const r = generatePocket2dLines({
        contourPoints: region.outerRing,
        islandRings: region.islandRings,
        stepoverMm: 2.4,
        zPassMm: -3,
        feedMmMin: 1500,
        plungeMmMin: 400,
        safeZMm: 6,
        wallStockMm: 0
      })
      expect(r.lines.length).toBeGreaterThan(0)
      for (const [x, y] of collectMoveXY(r.lines)) {
        const near = CORNERS_60X40.some((c) => Math.hypot(x - c[0], y - c[1]) <= PREV_R + 0.1)
        expect(near, `raster cut point ${x},${y} outside every corner zone`).toBe(true)
      }
      expectNoRapidAtDepth(r.lines)
    }
  })
})

describe('rest regions composed into generateAdaptiveClearing2dLines (cnc_adaptive)', () => {
  function adaptiveOn(region: RestRegion): ReturnType<typeof generateAdaptiveClearing2dLines> {
    return generateAdaptiveClearing2dLines({
      outerRing: region.outerRing,
      islandRings: region.islandRings,
      toolDiameterMm: CURRENT_DIA,
      stepoverMm: 2.4,
      zPassMm: -2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      wallStockMm: 0
    })
  }

  it('HONESTY: cusped corner lobes are SKIPPED with a hint — and the finish gate stays closed', () => {
    // A corner lobe tapers to zero width at the wall tangent points; Stack-B
    // v1 classifies it as a narrow region beyond spine coverage and refuses
    // to slot it. The result must keep the dispatcher's finish gate closed
    // (`adaptiveClearedToWalls !== true`) exactly as cam-runner-2d keys it.
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA
    })
    for (const region of solved.regions) {
      const r = adaptiveOn(region)
      expect(r.lines).toEqual([])
      expect(r.adaptiveClearedToWalls).not.toBe(true)
      expect(r.hints.some((h) => /narrow region\(s\) skipped/.test(h))).toBe(true)
    }
  })

  it('keeps the Stack-B contract on a cuttable rest region (channel): flag gates the finish', () => {
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      islandRings: [ISLAND_CHANNEL],
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA
    })
    const channel = solved.regions.find(
      (r) => r.outerRing.some((p) => p[0] > 18 && p[0] < 37 && p[1] < 8.5)
    )
    expect(channel).toBeDefined()
    const r = adaptiveOn(channel!)
    // The 8 mm channel IS cuttable — adaptive emits a body...
    expect(r.lines.length).toBeGreaterThan(0)
    // ...but v1 skips its wall-level spike runs, so the flag must be an
    // explicit `false` (NOT true) and the hints must say what was left:
    // the wire phase keys the rest finish suppression off `!== true`
    // exactly as the cnc_adaptive dispatcher does today.
    expect(r.adaptiveClearedToWalls).toBe(false)
    expect(r.hints.length).toBeGreaterThan(0)
    // Containment: every cut stays inside the channel rest region's bbox
    // (Stack-B erosion-containment guarantee carries over to rest geometry).
    for (const [x, y] of collectMoveXY(r.lines)) {
      expect(x).toBeGreaterThanOrEqual(14.2)
      expect(x).toBeLessThanOrEqual(40.8)
      expect(y).toBeGreaterThanOrEqual(-0.1)
      expect(y).toBeLessThanOrEqual(8.1)
    }
    expectNoRapidAtDepth(r.lines)
  })
})

// -- 3. POSTED G-code -- Laguna Swift / RichAuto (vcarve_mach3.hbs) -------------------

describe('rest machining posted through vcarve_mach3.hbs on Laguna Swift 5x10', () => {
  async function postLagunaRest(): Promise<string> {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const solved = solveRestRegion({
      outerRing: RECT_60X40,
      prevToolDiameterMm: PREV_DIA,
      toolDiameterMm: CURRENT_DIA
    })
    expect(solved.regions.length).toBe(4)
    const body: string[] = []
    for (const region of solved.regions) {
      const r = generatePocketOffsetSpiralLines({
        outerRing: region.outerRing,
        islandRings: region.islandRings,
        stepoverMm: 2.4,
        zPassMm: -3,
        feedMmMin: 1500,
        plungeMmMin: 400,
        safeZMm: 6,
        wallStockMm: 0
      })
      expect(r.lines.length).toBeGreaterThan(0)
      body.push(...r.lines)
    }
    const posted = await renderPost(RESOURCES_ROOT, machine, body, {
      operationLabel: 'Rest machining -- 60x40 corner lobes (prev 12 mm, tool 6 mm)'
    })
    return posted.gcode
  }

  it('emits a non-empty program wrapped in two % tape markers', async () => {
    const gcode = await postLagunaRest()
    expect(gcode.length).toBeGreaterThan(200)
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
  })

  it('emits G21 -> G90 -> G17 in order and never G20', async () => {
    const gcode = await postLagunaRest()
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).not.toMatch(/^G20\b/m)
  })

  it('warms the spindle (M3 -> G4 P2.0), cools down (M5 -> G4 P3.0), never reverses (no M4)', async () => {
    const gcode = await postLagunaRest()
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
    const gcode = await postLagunaRest()
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
  })

  it('SAFETY: no XY rapid at cut depth; every posted CUT stays in the corner zones', async () => {
    const gcode = await postLagunaRest()
    const lines = gcode.split('\n')
    expectNoRapidAtDepth(lines)
    for (const raw of lines) {
      const l = raw.split(';')[0]!.trim()
      if (!/^G1\b/.test(l)) continue
      const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
      const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
      if (!mx || !my) continue
      const x = Number.parseFloat(mx[1]!)
      const y = Number.parseFloat(my[1]!)
      const near = CORNERS_60X40.some((c) => Math.hypot(x - c[0], y - c[1]) <= PREV_R + 0.1)
      expect(near, `posted cut ${x},${y} outside every corner zone`).toBe(true)
    }
  })

  it('matches the posted-program snapshot (NEW snapshot for the new rest-op shape)', async () => {
    const gcode = await postLagunaRest()
    expect(gcode).toMatchSnapshot()
  })
})

// -- 4. POSTED G-code -- Makera Carvera 3-axis (carvera_3axis.hbs) --------------------

describe('rest machining posted through carvera_3axis.hbs on Makera Carvera 3-axis', () => {
  // Carvera-scale fixture: 40x30 pocket, prev tool 10 mm, current 4 mm; feeds
  // INSIDE the 2400 mm/min ceiling (never copy Laguna feeds onto 200 W).
  const CARVERA_RECT: CamPoint2d[] = [
    [0, 0],
    [40, 0],
    [40, 30],
    [0, 30]
  ]
  const CARVERA_CORNERS: CamPoint2d[] = [
    [0, 0],
    [0, 30],
    [40, 0],
    [40, 30]
  ]

  async function postCarveraRest(): Promise<string> {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const solved = solveRestRegion({
      outerRing: CARVERA_RECT,
      prevToolDiameterMm: 10,
      toolDiameterMm: 4
    })
    expect(solved.regions.length).toBe(4)
    const body: string[] = []
    for (const region of solved.regions) {
      const r = generatePocketOffsetSpiralLines({
        outerRing: region.outerRing,
        islandRings: region.islandRings,
        stepoverMm: 1.6,
        zPassMm: -2,
        feedMmMin: 1200,
        plungeMmMin: 300,
        safeZMm: 5,
        wallStockMm: 0
      })
      expect(r.lines.length).toBeGreaterThan(0)
      body.push(...r.lines)
    }
    const posted = await renderPost(RESOURCES_ROOT, machine, body, {
      operationLabel: 'Rest machining -- Carvera corner lobes (prev 10 mm, tool 4 mm)'
    })
    return posted.gcode
  }

  it('emits G21 -> G90 -> G17 and the ATC block (M6 T1 then G43 H1)', async () => {
    const gcode = await postCarveraRest()
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
    const gcode = await postCarveraRest()
    const m3 = gcode.search(/^M3\b/m)
    const dwell = gcode.search(/^G4 P2\b/m)
    expect(m3).toBeGreaterThan(-1)
    expect(dwell).toBeGreaterThan(m3)
  })

  it('ends M5 -> G49 -> M9 -> M2 and NEVER M30 (Smoothieware may delete the SD file)', async () => {
    const gcode = await postCarveraRest()
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
    const gcode = await postCarveraRest()
    for (const raw of gcode.split('\n')) {
      const code = raw.split(';')[0]!
      expect(code).not.toMatch(/\bA-?\d/)
    }
  })

  it('SAFETY: no XY rapid at cut depth; feeds inside the 2400 mm/min ceiling; cuts in corner zones', async () => {
    const gcode = await postCarveraRest()
    const lines = gcode.split('\n')
    expectNoRapidAtDepth(lines)
    for (const raw of lines) {
      const code = raw.split(';')[0]!
      const f = code.match(/F(\d+(?:\.\d+)?)/)
      if (f) expect(Number.parseFloat(f[1]!)).toBeLessThanOrEqual(2400)
      const l = code.trim()
      if (!/^G1\b/.test(l)) continue
      const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
      const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
      if (!mx || !my) continue
      const x = Number.parseFloat(mx[1]!)
      const y = Number.parseFloat(my[1]!)
      const near = CARVERA_CORNERS.some((c) => Math.hypot(x - c[0], y - c[1]) <= 5 + 0.1)
      expect(near, `posted cut ${x},${y} outside every corner zone`).toBe(true)
    }
  })

  it('matches the posted-program snapshot (NEW snapshot for the new rest-op shape)', async () => {
    const gcode = await postCarveraRest()
    expect(gcode).toMatchSnapshot()
  })
})
