/**
 * Wave-3i (Laguna 2.5D depth) -- offset-spiral + island-aware pocket engine
 * validation gate (Safety Rule 5).
 *
 * Covers BOTH halves of the build brief, in the cam-local-vcarve.test.ts
 * pattern:
 *
 *   1. ENGINE GEOMETRY (pure, no I/O):
 *      - `computeOffsetSpiralLevels`: the inset-count matches the stepover
 *        math (`wallStock + k * stepover` until collapse), islands become
 *        grown hole-loops, an island spanning the region splits a level into
 *        disjoint loops, collapse yields an empty result without throwing.
 *      - `generatePocketOffsetSpiralLines`: inside-out ordering (innermost
 *        loop first), EVERY loop transition is a safe-Z lift (never an XY
 *        rapid at cut depth), no toolpath point enters the island
 *        (tool-radius + wall-stock margin), multi-depth + ramp parity with
 *        the raster pocket.
 *      - `generatePocket2dLines` + `islandRings`: scanline rows crossing an
 *        island split into two cut segments (even-odd across all rings) with
 *        true geometric wall-stock clearance off island edges; absent/empty
 *        islandRings reproduce the legacy output EXACTLY (regression pin).
 *
 *   2. POSTED G-CODE through the REAL `vcarve_mach3.hbs` post + the bundled
 *      `resources/machines/laguna-swift-5x10.json` profile via
 *      `dispatch2dStrategy`: % tape markers, G21 -> G90 -> G17, spindle
 *      warm-up `G4 P2.0` + cool-down `M5 -> G4 P3.0`, M30 (NEVER M2), no M4,
 *      no XY rapid at cut depth anywhere in the program, pocket depth
 *      HARD-CAPPED to the stock thickness (clearing AND finish passes), and a
 *      NEW posted-program snapshot for the island + offset-spiral fixture
 *      (existing pocket snapshots are untouched -- new op shapes get new
 *      snapshots).
 */

import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { generatePocket2dLines, type CamPoint2d } from './cam-local'
import {
  computeOffsetSpiralLevels,
  generatePocketOffsetSpiralLines,
  POCKET_OFFSET_MAX_LEVELS
} from './cam-pocket-offset'
import { dispatch2dStrategy } from './cam-runner-2d'
import type { CamJobConfig } from './cam-runner'

// -- Fixtures ----------------------------------------------------------------

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

/** The brief's canonical fixture: a 60 x 40 mm pocket ... */
const OUTER_60X40: CamPoint2d[] = [
  [0, 0],
  [60, 0],
  [60, 40],
  [0, 40]
]

/** ... with a 15 x 10 mm island in the middle. */
const ISLAND_15X10: CamPoint2d[] = [
  [20, 15],
  [35, 15],
  [35, 25],
  [20, 25]
]

/** A tall island that SPLITS inset levels into disjoint left/right loops. */
const TALL_ISLAND: CamPoint2d[] = [
  [25, 2],
  [35, 2],
  [35, 38],
  [25, 38]
]

async function loadLagunaProfile(): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json'), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-pocket-island-${label}-${tmpCounter}-${Date.now()}.nc`)
}

const GUARD_HINT = ' [test-guard]'
function envelopeHint(machine: MachineProfile, _gcode: string): string {
  return ` [test-envelope:${machine.id}]`
}

function buildJob(
  overrides: Partial<CamJobConfig> & { machine: MachineProfile; outputGcodePath: string }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-pocket-island.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -3,
    stepoverMm: 3,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_pocket',
    ...overrides
  }
}

// -- Test-local geometry helpers ----------------------------------------------

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

function loopBounds(points: ReadonlyArray<CamPoint2d>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

// -- Test-local G-code walkers -------------------------------------------------

type CutSegment = { x0: number; y0: number; x1: number; y1: number }

/**
 * XY-moving FEED segments at (or entering) cut depth, tracking modal X/Y/Z.
 * Ramp entries (G1 X.. Y.. Z-..) are included; safe-Z links are not.
 */
function collectCutSegments(lines: ReadonlyArray<string>): CutSegment[] {
  let x = 0
  let y = 0
  let z = 100
  const segs: CutSegment[] = []
  for (const raw of lines) {
    const l = raw.trim()
    if (!/^G[01]\b/.test(l)) continue
    const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
    const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
    const mz = l.match(/Z(-?\d+(?:\.\d+)?)/)
    const nx = mx ? Number.parseFloat(mx[1]!) : x
    const ny = my ? Number.parseFloat(my[1]!) : y
    const nz = mz ? Number.parseFloat(mz[1]!) : z
    if (l.startsWith('G1') && (nz < -1e-9 || z < -1e-9) && (nx !== x || ny !== y)) {
      segs.push({ x0: x, y0: y, x1: nx, y1: ny })
    }
    x = nx
    y = ny
    z = nz
  }
  return segs
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

// -- 1. computeOffsetSpiralLevels -- inset-count + island math ------------------

describe('computeOffsetSpiralLevels -- successive insets of (outer - islands)', () => {
  it('inset count matches the stepover math: wallStock + k*step until collapse', () => {
    const { levels, cappedLevels } = computeOffsetSpiralLevels({
      outerRing: OUTER_60X40,
      stepoverMm: 3,
      wallStockMm: 1
    })
    // 60x40 collapses when inset >= min(60,40)/2 = 20 -> insets 1,4,7,10,13,16,19.
    expect(levels.map((l) => l.insetMm)).toEqual([1, 4, 7, 10, 13, 16, 19])
    expect(cappedLevels).toBe(false)
    for (const level of levels) {
      expect(level.loops.length).toBe(1)
      expect(level.loops[0]!.isHole).toBe(false)
      const b = loopBounds(level.loops[0]!.points)
      // A rectangle inset is the exact smaller rectangle (round joins only affect
      // outward corner arcs) -- bbox pins the inset distance on all four walls.
      expect(b.minX).toBeCloseTo(level.insetMm, 2)
      expect(b.minY).toBeCloseTo(level.insetMm, 2)
      expect(b.maxX).toBeCloseTo(60 - level.insetMm, 2)
      expect(b.maxY).toBeCloseTo(40 - level.insetMm, 2)
    }
  })

  it('collapse (inset > half-width) yields an empty level list without throwing', () => {
    const { levels, cappedLevels } = computeOffsetSpiralLevels({
      outerRing: OUTER_60X40,
      stepoverMm: 3,
      wallStockMm: 25
    })
    expect(levels).toEqual([])
    expect(cappedLevels).toBe(false)
  })

  it('an island becomes a grown hole-loop kept >= inset away from the island walls', () => {
    const { levels } = computeOffsetSpiralLevels({
      outerRing: OUTER_60X40,
      islandRings: [ISLAND_15X10],
      stepoverMm: 3,
      wallStockMm: 1
    })
    expect(levels.length).toBe(4) // insets 1,4,7 keep the hole; 10 leaves a side sliver; 13 collapses
    const level0 = levels[0]!
    expect(level0.loops.length).toBe(2)
    const holes = level0.loops.filter((l) => l.isHole)
    const outers = level0.loops.filter((l) => !l.isHole)
    expect(holes.length).toBe(1)
    expect(outers.length).toBe(1)
    // Every vertex of the grown island loop sits ~1 mm off the island boundary
    // (round-join arcs at the corners), never inside it.
    for (const [x, y] of holes[0]!.points) {
      expect(pointInRing(ISLAND_15X10, x, y)).toBe(false)
      expect(Math.abs(distToRing(ISLAND_15X10, x, y) - 1)).toBeLessThanOrEqual(0.02)
    }
  })

  it('an island spanning the region height SPLITS a level into disjoint loops', () => {
    const { levels } = computeOffsetSpiralLevels({
      outerRing: OUTER_60X40,
      islandRings: [TALL_ISLAND],
      stepoverMm: 4,
      wallStockMm: 2
    })
    expect(levels.length).toBeGreaterThanOrEqual(1)
    const level0 = levels[0]!
    expect(level0.loops.length).toBe(2)
    expect(level0.loops.every((l) => !l.isHole)).toBe(true)
    const [a, b] = [loopBounds(level0.loops[0]!.points), loopBounds(level0.loops[1]!.points)]
    const left = a.minX < b.minX ? a : b
    const right = a.minX < b.minX ? b : a
    // Left region ends 2 mm short of the grown island edge (25 - 2 = 23);
    // right region starts at 35 + 2 = 37.
    expect(left.maxX).toBeCloseTo(23, 2)
    expect(right.minX).toBeCloseTo(37, 2)
  })

  it('enforces the 0.05 mm radial step floor (main-process guard)', () => {
    const { levels } = computeOffsetSpiralLevels({
      outerRing: OUTER_60X40,
      stepoverMm: 0.0001,
      wallStockMm: 0
    })
    expect(levels.length).toBeGreaterThan(2)
    expect(levels[1]!.insetMm - levels[0]!.insetMm).toBeGreaterThanOrEqual(0.05 - 1e-9)
  })

  it('level cap covers a full-sheet Laguna pocket at the step floor', () => {
    expect(POCKET_OFFSET_MAX_LEVELS).toBeGreaterThan(1524 / 2 / 0.05)
  })
})

// -- 2. generatePocketOffsetSpiralLines -- emitted body -------------------------

describe('generatePocketOffsetSpiralLines -- offset clearing body', () => {
  const base = {
    outerRing: OUTER_60X40,
    stepoverMm: 3,
    zPassMm: -2,
    feedMmMin: 600,
    plungeMmMin: 200,
    safeZMm: 5,
    wallStockMm: 1
  }

  it('clears INSIDE-OUT: first loop is the innermost inset, last is the wall-stock boundary', () => {
    const { lines } = generatePocketOffsetSpiralLines(base)
    const rapids = lines.filter((l) => /^G0 X/.test(l))
    expect(rapids.length).toBeGreaterThanOrEqual(7) // one per inset level
    const first = rapids[0]!.match(/^G0 X(-?\d+\.\d+) Y(-?\d+\.\d+)$/)
    const last = rapids[rapids.length - 1]!.match(/^G0 X(-?\d+\.\d+) Y(-?\d+\.\d+)$/)
    expect(first).not.toBeNull()
    expect(last).not.toBeNull()
    const fx = Number.parseFloat(first![1]!)
    const fy = Number.parseFloat(first![2]!)
    // Innermost ring at inset 19 -> [19,41] x [19,21].
    expect(fx).toBeGreaterThanOrEqual(19 - 0.02)
    expect(fx).toBeLessThanOrEqual(41 + 0.02)
    expect(fy).toBeGreaterThanOrEqual(19 - 0.02)
    expect(fy).toBeLessThanOrEqual(21 + 0.02)
    // Outermost ring at inset 1 -> a corner of [1,59] x [1,39].
    const lx = Number.parseFloat(last![1]!)
    const ly = Number.parseFloat(last![2]!)
    expect(Math.abs(lx - 1) < 0.02 || Math.abs(lx - 59) < 0.02).toBe(true)
    expect(Math.abs(ly - 1) < 0.02 || Math.abs(ly - 39) < 0.02).toBe(true)
  })

  it('keeps the tool-radius + wall-stock margin off the island (no point inside)', () => {
    // wallStockMm models toolRadius (1.5) + finish stock (1.0) = 2.5 mm margin.
    const { lines } = generatePocketOffsetSpiralLines({
      ...base,
      islandRings: [ISLAND_15X10],
      stepoverMm: 2,
      wallStockMm: 2.5
    })
    expect(lines.length).toBeGreaterThan(10)
    expectIslandClearance(lines, ISLAND_15X10, 2.5, 0.02)
    // The outer wall keeps the same margin.
    const segs = collectCutSegments(lines)
    for (const s of segs) {
      for (const [px, py] of [
        [s.x0, s.y0],
        [s.x1, s.y1]
      ] as const) {
        expect(distToRing(OUTER_60X40, px, py)).toBeGreaterThanOrEqual(2.5 - 0.02)
      }
    }
  })

  it('EVERY disjoint-loop transition is a safe-Z lift (never an XY rapid at depth)', () => {
    const { levels } = computeOffsetSpiralLevels({
      outerRing: OUTER_60X40,
      islandRings: [TALL_ISLAND],
      stepoverMm: 4,
      wallStockMm: 2
    })
    const totalLoops = levels.reduce((n, l) => n + l.loops.length, 0)
    expect(levels[0]!.loops.length).toBe(2) // the island splits the level
    const { lines } = generatePocketOffsetSpiralLines({
      ...base,
      islandRings: [TALL_ISLAND],
      stepoverMm: 4,
      wallStockMm: 2
    })
    expectNoRapidAtDepth(lines)
    const lifts = lines.filter((l) => l.trim() === 'G0 Z5.000').length
    // One lift per loop + the final retract.
    expect(lifts).toBe(totalLoops + 1)
  })

  it('collapse -> empty result, no throw', () => {
    const { lines, hints } = generatePocketOffsetSpiralLines({ ...base, wallStockMm: 25 })
    expect(lines).toEqual([])
    expect(hints).toEqual([])
  })

  it('steps down through depths via zStepMm', () => {
    const { lines } = generatePocketOffsetSpiralLines({ ...base, zPassMm: -4, zStepMm: 2 })
    const text = lines.join('\n')
    expect(text).toMatch(/G1 Z-2\.000 F200/)
    expect(text).toMatch(/G1 Z-4\.000 F200/)
  })

  it('supports ramp entry per loop and lengthens the run for rampMaxAngleDeg', () => {
    const { lines, hints } = generatePocketOffsetSpiralLines({
      ...base,
      entryMode: 'ramp',
      rampMm: 1.5,
      rampMaxAngleDeg: 45
    })
    // |safeZ - z| = 7 mm -> a 45 deg ramp needs >= 7 mm of XY run; 1.5 is extended.
    expect(lines.some((l) => /^G1 X-?\d+\.\d+ Y-?\d+\.\d+ Z-2\.000 F200$/.test(l))).toBe(true)
    // No bare vertical plunge remains.
    expect(lines.some((l) => /^G1 Z-2\.000 F200$/.test(l.trim()))).toBe(false)
    expect(hints.some((h) => /lengthened/i.test(h))).toBe(true)
  })

  it('leads with the body comment and starts/ends at safe Z', () => {
    const { lines } = generatePocketOffsetSpiralLines(base)
    expect(lines[0]).toMatch(/^; Pocket offset-spiral -- 7 inset level\(s\), 7 loop\(s\), inside-out/)
    const exec = lines.filter((l) => !l.trim().startsWith(';'))
    expect(exec[0]!.trim()).toBe('G0 Z5.000')
    expect(exec[exec.length - 1]!.trim()).toBe('G0 Z5.000')
  })
})

// -- 3. generatePocket2dLines + islandRings -- island-aware raster --------------

describe('generatePocket2dLines -- island-aware raster scanlines', () => {
  const base = {
    contourPoints: OUTER_60X40,
    stepoverMm: 5,
    zPassMm: -2,
    feedMmMin: 600,
    plungeMmMin: 200,
    safeZMm: 5,
    wallStockMm: 1
  }

  it('absent and empty islandRings reproduce the legacy single-ring output EXACTLY', () => {
    const legacy = generatePocket2dLines(base)
    const withEmpty = generatePocket2dLines({ ...base, islandRings: [] })
    const withDegenerate = generatePocket2dLines({ ...base, islandRings: [[[1, 1], [2, 2]]] })
    expect(withEmpty.lines).toEqual(legacy.lines)
    expect(withEmpty.hints).toEqual(legacy.hints)
    expect(withDegenerate.lines).toEqual(legacy.lines)
  })

  it('a scanline row crossing the island SPLITS into two cut segments (even-odd)', () => {
    const { lines } = generatePocket2dLines({ ...base, islandRings: [ISLAND_15X10] })
    // Row y=20 crosses the island (x 20..35, 1 mm wall stock) -> [1,19] + [36,59].
    const segs = collectCutSegments(lines).filter((s) => Math.abs(s.y0 - 20) < 1e-6 && Math.abs(s.y1 - 20) < 1e-6)
    expect(segs.length).toBe(2)
    const spans = segs
      .map((s) => [Math.min(s.x0, s.x1), Math.max(s.x0, s.x1)] as const)
      .sort((a, b) => a[0] - b[0])
    expect(spans[0]![0]).toBeCloseTo(1, 2)
    expect(spans[0]![1]).toBeCloseTo(19, 2)
    expect(spans[1]![0]).toBeCloseTo(36, 2)
    expect(spans[1]![1]).toBeCloseTo(59, 2)
    // No cut segment may bridge the island interior.
    for (const [a, b] of spans) {
      expect(b <= 19 + 1e-3 || a >= 36 - 1e-3).toBe(true)
    }
  })

  it('rows clear of the island stay a single full-width segment', () => {
    const { lines } = generatePocket2dLines({ ...base, islandRings: [ISLAND_15X10] })
    const segs = collectCutSegments(lines).filter((s) => Math.abs(s.y0 - 5) < 1e-6 && Math.abs(s.y1 - 5) < 1e-6)
    expect(segs.length).toBe(1)
    const span = [Math.min(segs[0]!.x0, segs[0]!.x1), Math.max(segs[0]!.x0, segs[0]!.x1)]
    expect(span[0]).toBeCloseTo(1, 2)
    expect(span[1]).toBeCloseTo(59, 2)
  })

  it('no raster point falls inside the island or within the wall-stock margin of it', () => {
    const { lines } = generatePocket2dLines({
      ...base,
      stepoverMm: 2,
      wallStockMm: 2.5,
      islandRings: [ISLAND_15X10]
    })
    expectIslandClearance(lines, ISLAND_15X10, 2.5, 2e-3)
  })

  it('multi-depth island raster splits the row at every depth', () => {
    const { lines } = generatePocket2dLines({
      ...base,
      zPassMm: -4,
      zStepMm: 2,
      islandRings: [ISLAND_15X10]
    })
    const segs = collectCutSegments(lines).filter((s) => Math.abs(s.y0 - 20) < 1e-6)
    expect(segs.length).toBe(4) // 2 segments x 2 depth passes
  })

  it('raster transitions between split segments are safe-Z lifts (existing invariant holds with islands)', () => {
    const { lines } = generatePocket2dLines({ ...base, islandRings: [ISLAND_15X10] })
    expectNoRapidAtDepth(lines)
  })
})

// -- 4. Posted G-code -- Laguna Swift / RichAuto (Mach3) invariants -------------

describe('cnc_pocket islands + offset_spiral posted through vcarve_mach3.hbs on Laguna Swift 5x10', () => {
  async function postPocket(
    overrides: Partial<CamJobConfig> = {},
    params: Record<string, unknown> = {}
  ): Promise<{ gcode: string; out: string; hint: string }> {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('post')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: {
          contourPoints: OUTER_60X40,
          islandRings: [ISLAND_15X10],
          pocketStrategy: 'offset_spiral',
          wallStockMm: 1,
          ...params
        },
        ...overrides
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, out, hint: r.hint ?? '' }
  }

  it('emits a non-empty builtin program wrapped in two % tape markers', async () => {
    const { gcode, out } = await postPocket()
    expect(gcode.length).toBeGreaterThan(200)
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
    await unlink(out).catch(() => {})
  })

  it('emits G21 -> G90 -> G17 in order and never G20', async () => {
    const { gcode, out } = await postPocket()
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).not.toMatch(/^G20\b/m)
    await unlink(out).catch(() => {})
  })

  it('warms the spindle (M3 -> G4 P2.0), cools it down (M5 -> G4 P3.0), and never reverses (no M4)', async () => {
    const { gcode, out } = await postPocket()
    const m3 = gcode.search(/^M3\b/m)
    const warm = gcode.indexOf('G4 P2.0')
    const m5 = gcode.search(/^M5\b/m)
    const cool = gcode.indexOf('G4 P3.0')
    expect(m3).toBeGreaterThan(-1)
    expect(warm).toBeGreaterThan(m3)
    expect(m5).toBeGreaterThan(warm)
    expect(cool).toBeGreaterThan(m5)
    expect(gcode).not.toMatch(/^M4\b/m)
    await unlink(out).catch(() => {})
  })

  it('ends with M30 (Mach3/RichAuto terminator) and NEVER M2', async () => {
    const { gcode, out } = await postPocket()
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: no XY rapid happens at cut depth anywhere in the posted program', async () => {
    const { gcode, out } = await postPocket()
    expectNoRapidAtDepth(gcode.split('\n'))
    await unlink(out).catch(() => {})
  })

  it('SAFETY: no posted toolpath point enters the island + wall-stock margin (rough body)', async () => {
    // finishPass off so the asserted body is purely the clearing passes (the
    // island wall finish legitimately traces the island ring itself).
    const { gcode, out } = await postPocket({}, { finishPass: false, wallStockMm: 2.5, stepoverMm: 2 })
    expectIslandClearance(gcode.split('\n'), ISLAND_15X10, 2.5, 0.02)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: pocket depth is HARD-CAPPED to the stock thickness (clearing AND finish passes)', async () => {
    const { gcode, out, hint } = await postPocket({ stockBoxZMm: 5, zPassMm: -12 })
    let deepest = 0
    for (const l of gcode.split('\n')) {
      const m = l.match(/Z(-?\d+(?:\.\d+)?)/)
      if (m) deepest = Math.min(deepest, Number.parseFloat(m[1]!))
    }
    expect(deepest).toBeGreaterThanOrEqual(-5 - 1e-6)
    expect(hint).toMatch(/depth cap reduced from 12\.000 mm to the 5\.000 mm stock thickness/)
    await unlink(out).catch(() => {})
  })

  it('finishPass appends the island WALL contour after the clearing body', async () => {
    const { gcode, out } = await postPocket()
    // The island finish pass traces the island ring itself -> its corners appear.
    expect(gcode).toMatch(/X20\.000 Y15\.000/)
    expect(gcode).toMatch(/X35\.000 Y25\.000/)
    await unlink(out).catch(() => {})
  })

  it('raster strategy with islands also posts clean (default pocketStrategy)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('raster')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: {
          contourPoints: OUTER_60X40,
          islandRings: [ISLAND_15X10],
          wallStockMm: 2.5,
          finishPass: false
        },
        stepoverMm: 2
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expectNoRapidAtDepth(r.gcode.split('\n'))
      expectIslandClearance(r.gcode.split('\n'), ISLAND_15X10, 2.5, 2e-3)
      expect(r.gcode).toMatch(/^M30\b/m)
    }
    await unlink(out).catch(() => {})
  })

  it('island collapse with finishPass=false returns the empty-pocket geometry error (no program)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('collapse')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: {
          contourPoints: OUTER_60X40,
          pocketStrategy: 'offset_spiral',
          wallStockMm: 25,
          finishPass: false
        }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Pocket toolpath is empty.')
    await unlink(out).catch(() => {})
  })

  it('malformed islandRings entries are dropped (still posts ok)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('malformed')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: {
          contourPoints: OUTER_60X40,
          islandRings: ['nonsense', [[1, 1], [2, 2]], 42],
          pocketStrategy: 'offset_spiral'
        }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    await unlink(out).catch(() => {})
  })
})

// -- 5. Posted G-code snapshot (new fixture -> NEW snapshot) --------------------

describe('cnc_pocket offset_spiral + island posted snapshot (Laguna Swift, deterministic)', () => {
  it('matches the posted-program snapshot', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('snap')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        zPassMm: -3,
        stepoverMm: 6,
        feedMmMin: 1500,
        plungeMmMin: 400,
        safeZMm: 6,
        operationParams: {
          contourPoints: OUTER_60X40,
          islandRings: [ISLAND_15X10],
          pocketStrategy: 'offset_spiral',
          wallStockMm: 1
        }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.gcode).toMatchSnapshot()
    }
    await unlink(out).catch(() => {})
  })
})
