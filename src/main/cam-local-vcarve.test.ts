/**
 * Wave-3d (Laguna VCarve) -- TRUE V-carve toolpath engine + posted-G-code
 * Laguna-Swift contract (Safety Rule 5).
 *
 * This is the validation gate for the flagship `cnc_vcarve` op: the medial-axis
 * variable-depth carve that replaces the single-offset fixed-depth `cnc_chamfer`
 * bevel as the real Vectric-VCarve-Pro-style sign-lettering toolpath. It pins
 * BOTH halves the build brief requires:
 *
 *   1. ENGINE GEOMETRY (`solveVCarveRidge` / `generateVCarve2dLines`, pure):
 *      against REAL closed fixtures (a wide->narrow wedge, a letter-V outline, a
 *      diamond, and two disjoint squares) we assert the depth profile is correct:
 *        - the deepest carve sits in the WIDEST span of the shape,
 *        - depth is monotonic-with-width along the spine (deepest in the middle,
 *          running out to zero at narrow tips),
 *        - depth is HARD-CAPPED to min(maxDepthMm, stock) -- the V-bit never
 *          plunges past the cap,
 *        - disjoint branches are separated by a safe-Z lift (never a transit
 *          through stock between strokes / islands).
 *
 *   2. POSTED G-CODE (through the REAL `vcarve_mach3.hbs` post + the bundled
 *      `resources/machines/laguna-swift-5x10.json` profile via
 *      `dispatch2dStrategy`): the emitted program passes the Laguna / RichAuto
 *      (Mach3-superset) invariants -- `%` tape markers, `G21/G90/G17`, spindle
 *      warm-up `G4 P2.0` + cool-down `M5 -> G4 P3.0`, the **M30** terminator
 *      (NEVER Carvera's M2), and -- the load-bearing V-carve safety check --
 *      NO cut Z is deeper than the stock thickness (the V-bit is capped to the
 *      material). See `.claude/skills/gcode-safety/references/laguna-swift.md`.
 *
 * Companion to the per-machine contract pin (`post-process-laguna-swift-contract.test.ts`):
 * that file pins the post template's header/footer invariants on a generic
 * facing pass; THIS file pins that a real V-carve BODY flows through that post
 * unchanged AND that the body itself is safe (capped, safe-Z between branches).
 */

import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  generateVCarve2dLines,
  solveVCarveFlatRegion,
  solveVCarveRidge,
  vCarveDepthPerRadius,
  VCARVE_MAX_GRID_CELLS,
  type CamPoint2d,
  type VCarveRidgePoint
} from './cam-local'
import { dispatch2dStrategy } from './cam-runner-2d'
import type { CamJobConfig } from './cam-runner'

// ── Fixtures ────────────────────────────────────────────────────────────────

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

/**
 * A wide->narrow wedge: the left edge (x=0) is the full 40 mm span; the shape
 * tapers to a single point at (100, 20). The medial axis runs left->right; the
 * inscribed-clearance radius is largest near the wide (left) half and shrinks to
 * zero at the right tip -> deepest carve on the left, runout on the right.
 */
const WEDGE: CamPoint2d[] = [
  [0, 0],
  [0, 40],
  [100, 20]
]

/**
 * A letter-V outline (two strokes meeting at the bottom). The medial axis is the
 * centre-line of each stroke; the strokes are widest where they meet at the
 * bottom vertex, so the deepest carve is at the junction -- exactly what a sign
 * V-carve does.
 */
const LETTER_V: CamPoint2d[] = [
  [0, 40],
  [8, 40],
  [20, 8],
  [32, 40],
  [40, 40],
  [24, 0],
  [16, 0]
]

/** A diamond (square rotated 45 deg). Deepest at the centre, tapering to corners. */
const DIAMOND: CamPoint2d[] = [
  [0, 20],
  [20, 40],
  [40, 20],
  [20, 0]
]

async function loadLagunaProfile(): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json'), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-vcarve-${label}-${tmpCounter}-${Date.now()}.nc`)
}

const GUARD_HINT = ' [test-guard]'
function envelopeHint(machine: MachineProfile, _gcode: string): string {
  return ` [test-envelope:${machine.id}]`
}

function buildJob(
  overrides: Partial<CamJobConfig> & { machine: MachineProfile; outputGcodePath: string }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-vcarve.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -3,
    stepoverMm: 2,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_vcarve',
    ...overrides
  }
}

// ── G-code parsing helpers ──────────────────────────────────────────────────

/** Lowest (most negative) Z appearing on any move line. */
function deepestZ(lines: ReadonlyArray<string>): number {
  let z = 0
  for (const l of lines) {
    const m = l.match(/Z(-?\d+(?:\.\d+)?)/)
    if (m) z = Math.min(z, Number.parseFloat(m[1]!))
  }
  return z
}

/** Count of safe-Z lift lines `G0 Z<safe>` in the body. */
function countSafeZLifts(lines: ReadonlyArray<string>, safeZ: number): number {
  const needle = `G0 Z${safeZ.toFixed(3)}`
  return lines.filter((l) => l.trim() === needle).length
}

/** The ridge point with the greatest carve depth. */
function deepestPoint(points: ReadonlyArray<VCarveRidgePoint>): VCarveRidgePoint {
  let best = points[0]!
  for (const p of points) if (p.depthMm > best.depthMm) best = p
  return best
}

// ── 1. Depth-per-radius math ────────────────────────────────────────────────

describe('vCarveDepthPerRadius -- V-bit angle -> depth/clearance factor', () => {
  it('a 90 deg full-included V-bit gives depth == radius (factor 1)', () => {
    expect(vCarveDepthPerRadius(90)).toBeCloseTo(1, 6)
  })

  it('a 60 deg V-bit cuts deeper for the same clearance (factor ~1.732)', () => {
    expect(vCarveDepthPerRadius(60)).toBeCloseTo(Math.tan((60 * Math.PI) / 180), 6)
    expect(vCarveDepthPerRadius(60)).toBeGreaterThan(vCarveDepthPerRadius(90))
  })

  it('a 120 deg V-bit cuts shallower (factor < 1)', () => {
    expect(vCarveDepthPerRadius(120)).toBeLessThan(1)
  })

  it('a degenerate angle is clamped (no divide-by-~0 blowup)', () => {
    expect(Number.isFinite(vCarveDepthPerRadius(0))).toBe(true)
    expect(Number.isFinite(vCarveDepthPerRadius(180))).toBe(true)
    expect(Number.isFinite(vCarveDepthPerRadius(Number.NaN))).toBe(true)
  })
})

// ── 2. solveVCarveRidge -- depth profile is correct ─────────────────────────

describe('solveVCarveRidge -- medial-axis depth profile (Safety Rule 5)', () => {
  it('WEDGE: deepest carve is in the wide (left) half, runout at the narrow tip', () => {
    const { points, capMm } = solveVCarveRidge({
      rings: [WEDGE],
      vBitAngleDeg: 90,
      maxDepthMm: 50, // high cap so geometry (not the cap) sets the deepest point
      stepoverMm: 1
    })
    expect(points.length).toBeGreaterThan(20)
    const deep = deepestPoint(points)
    // Widest span is at the left edge; the inscribed-circle medial node sits in
    // the left HALF of the 0..100 x-range. Assert deepest is left-of-centre.
    expect(deep.x).toBeLessThan(50)
    // Some ridge node near the narrow tip must be much shallower than the deepest.
    const tip = points.reduce((a, b) => (b.x > a.x ? b : a), points[0]!)
    expect(tip.depthMm).toBeLessThan(deep.depthMm * 0.5)
    // And depth tracks clearance radius (90 deg bit: depth == r until capped).
    for (const p of points) {
      if (p.depthMm < capMm - 1e-6) expect(p.depthMm).toBeCloseTo(p.r, 3)
    }
  })

  it('WEDGE: depth is monotonic-with-width from the widest inscribed circle to the tip', () => {
    const { points } = solveVCarveRidge({ rings: [WEDGE], vBitAngleDeg: 90, maxDepthMm: 50, stepoverMm: 1 })
    // The largest inscribed circle of a wedge sits slightly INBOARD of the wide
    // base (not on the edge), so depth peaks at some x = xPeak and then decays
    // monotonically toward the tip. That decaying tail is the physically
    // meaningful "deepest in the middle, runs out at the tip" claim. Build the
    // spine as the max clearance radius per integer-x bucket, find the peak, and
    // assert the spine is essentially non-increasing FROM the peak onward.
    const byX = new Map<number, number>()
    for (const p of points) {
      const k = Math.round(p.x)
      byX.set(k, Math.max(byX.get(k) ?? 0, p.r))
    }
    const xs = [...byX.keys()].sort((a, b) => a - b)
    const peakX = xs.reduce((best, k) => (byX.get(k)! > byX.get(best)! ? k : best), xs[0]!)
    let violations = 0
    let prev = Number.POSITIVE_INFINITY
    for (const k of xs) {
      if (k < peakX) continue // only the runout tail toward the tip
      const r = byX.get(k)!
      if (r > prev + 0.7) violations += 1 // 0.7 mm grid-noise tolerance at step=1
      prev = r
    }
    // The runout tail is monotone (at most a single grid-noise wobble).
    expect(violations).toBeLessThanOrEqual(1)
    // And the peak is genuinely in the wide half (sanity on "deepest at widest").
    expect(peakX).toBeLessThan(50)
  })

  it('LETTER-V: deepest carve is at the bottom stroke junction', () => {
    const { points } = solveVCarveRidge({ rings: [LETTER_V], vBitAngleDeg: 60, maxDepthMm: 50, stepoverMm: 0.8 })
    expect(points.length).toBeGreaterThan(10)
    const deep = deepestPoint(points)
    // The two strokes meet near x in [16,24], y near the bottom (< 12).
    expect(deep.x).toBeGreaterThan(12)
    expect(deep.x).toBeLessThan(28)
    expect(deep.y).toBeLessThan(14)
  })

  it('DIAMOND: deepest carve is at the centre', () => {
    const { points } = solveVCarveRidge({ rings: [DIAMOND], vBitAngleDeg: 90, maxDepthMm: 50, stepoverMm: 0.8 })
    const deep = deepestPoint(points)
    expect(deep.x).toBeCloseTo(20, 0)
    expect(deep.y).toBeCloseTo(20, 0)
  })

  it('depth is HARD-CAPPED: a low cap clamps every ridge depth to the cap', () => {
    const cap = 2.5
    const { points } = solveVCarveRidge({ rings: [WEDGE], vBitAngleDeg: 90, maxDepthMm: cap, stepoverMm: 1 })
    for (const p of points) expect(p.depthMm).toBeLessThanOrEqual(cap + 1e-9)
    // The wide end WOULD carve deeper than the cap (r is large there), so the cap
    // must actually bind -- at least one node is pinned exactly at the cap.
    expect(points.some((p) => Math.abs(p.depthMm - cap) < 1e-6)).toBe(true)
  })

  it('a 60 deg bit carves deeper than a 90 deg bit for the same shape + cap headroom', () => {
    const a = solveVCarveRidge({ rings: [DIAMOND], vBitAngleDeg: 90, maxDepthMm: 50, stepoverMm: 1 })
    const b = solveVCarveRidge({ rings: [DIAMOND], vBitAngleDeg: 60, maxDepthMm: 50, stepoverMm: 1 })
    expect(deepestPoint(b.points).depthMm).toBeGreaterThan(deepestPoint(a.points).depthMm)
  })

  it('open / degenerate / empty input yields no ridge (no crash)', () => {
    expect(solveVCarveRidge({ rings: [], vBitAngleDeg: 90, maxDepthMm: 5 }).points).toEqual([])
    expect(solveVCarveRidge({ rings: [[[0, 0], [10, 0]]], vBitAngleDeg: 90, maxDepthMm: 5 }).points).toEqual([])
    expect(
      solveVCarveRidge({ rings: [[[0, 0], [0, 0], [0, 0]]], vBitAngleDeg: 90, maxDepthMm: 5 }).points
    ).toEqual([])
    expect(solveVCarveRidge({ rings: [WEDGE], vBitAngleDeg: 90, maxDepthMm: 0 }).points).toEqual([])
  })

  it('resolution is clamped for a full-sheet-scale shape (grid stays under the cell budget)', () => {
    // A 1500 x 3000 mm sheet outline at a 0.2 mm step would be ~112 million cells;
    // the solver must coarsen the step so the grid stays under the cap.
    const sheet: CamPoint2d[] = [
      [0, 0],
      [1500, 0],
      [1500, 3000],
      [0, 3000]
    ]
    const res = solveVCarveRidge({ rings: [sheet], vBitAngleDeg: 90, maxDepthMm: 6, stepoverMm: 0.2 })
    expect(res.clampedResolution).toBe(true)
    const cols = Math.ceil(1500 / res.stepMm) + 1
    const rows = Math.ceil(3000 / res.stepMm) + 1
    expect(cols * rows).toBeLessThanOrEqual(VCARVE_MAX_GRID_CELLS)
  })
})

// ── 3. generateVCarve2dLines -- emitted body shape + safe-Z ──────────────────

describe('generateVCarve2dLines -- emitted toolpath body', () => {
  it('emits XYZ feed moves at z = -depth and never plunges past the cap', () => {
    const cap = 4
    const { lines } = generateVCarve2dLines({
      rings: [WEDGE],
      vBitAngleDeg: 90,
      maxDepthMm: cap,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: 6
    })
    expect(lines.length).toBeGreaterThan(5)
    // There is real cutting (a Z below 0 appears).
    expect(deepestZ(lines)).toBeLessThan(0)
    // The deepest Z never goes past -cap (the V-bit is capped to the material).
    expect(deepestZ(lines)).toBeGreaterThanOrEqual(-cap - 1e-6)
    // Every feed/rapid move references a finite coordinate (no NaN leaked).
    for (const l of lines) {
      if (l.startsWith('G0') || l.startsWith('G1')) expect(l).not.toMatch(/NaN/)
    }
  })

  it('the FIRST cut (deepest seed) leads -- the maximum plunge happens early in the body', () => {
    const { lines } = generateVCarve2dLines({
      rings: [WEDGE],
      vBitAngleDeg: 90,
      maxDepthMm: 50,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: 6
    })
    const global = deepestZ(lines)
    // The deepest move occurs within the first 25% of the program (seed ordering
    // is depth-desc, so the heaviest cut leads).
    const firstQuarter = lines.slice(0, Math.ceil(lines.length / 4))
    expect(deepestZ(firstQuarter)).toBeCloseTo(global, 3)
  })

  it('TWO DISJOINT shapes are separated by a safe-Z lift before the second branch', () => {
    const safeZ = 6
    const sqA: CamPoint2d[] = [[0, 0], [12, 0], [12, 12], [0, 12]]
    const sqB: CamPoint2d[] = [[40, 0], [52, 0], [52, 12], [40, 12]]
    const { lines } = generateVCarve2dLines({
      rings: [sqA, sqB],
      vBitAngleDeg: 90,
      maxDepthMm: 6,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: safeZ
    })
    // Disjoint geometry forces multiple branches; each branch begins with a
    // safe-Z lift, so there must be >= 2 lifts (plus the final retract).
    expect(countSafeZLifts(lines, safeZ)).toBeGreaterThanOrEqual(2)
    // Every plunge (G1 Z- with no XY) is preceded by a safe-Z lift + a rapid:
    // walk the body and assert no G0 XY rapid happens while at cut depth.
    let atDepth = false
    for (const l of lines) {
      const t = l.trim()
      if (t === `G0 Z${safeZ.toFixed(3)}`) atDepth = false
      else if (/^G1 Z-?\d/.test(t)) atDepth = true // plunge to depth
      else if (/^G0 X-?\d/.test(t)) {
        // A bare XY rapid must only happen above stock (not at cut depth).
        expect(atDepth).toBe(false)
      }
    }
  })

  it('the body starts and ends at safe-Z (post cool-down/retract begins from clearance)', () => {
    const safeZ = 6
    const { lines } = generateVCarve2dLines({
      rings: [DIAMOND],
      vBitAngleDeg: 90,
      maxDepthMm: 6,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: safeZ
    })
    // First executable move is a safe-Z lift; last line is a safe-Z lift.
    const exec = lines.filter((l) => !l.trim().startsWith(';'))
    expect(exec[0]!.trim()).toBe(`G0 Z${safeZ.toFixed(3)}`)
    expect(exec[exec.length - 1]!.trim()).toBe(`G0 Z${safeZ.toFixed(3)}`)
  })

  it('empty / open input yields an empty body (caller surfaces the geometry error)', () => {
    expect(
      generateVCarve2dLines({
        rings: [[[0, 0], [10, 0]]],
        vBitAngleDeg: 90,
        maxDepthMm: 5,
        feedMmMin: 1000,
        plungeMmMin: 300,
        safeZMm: 6
      }).lines
    ).toEqual([])
  })

  it('flatBottomClearance emits a real flat-bottom clearance pass when the cap binds (hint surfaces it)', () => {
    const { lines, hints } = generateVCarve2dLines({
      rings: [DIAMOND],
      vBitAngleDeg: 90,
      maxDepthMm: 6,
      feedMmMin: 1000,
      plungeMmMin: 300,
      safeZMm: 6,
      flatBottomClearance: 0.5
    })
    // DIAMOND's inscribed radius (~14.1 mm) far exceeds the 6 mm cap, so a flat
    // floor exists and the second chained section must be emitted.
    expect(lines.some((l) => l.startsWith('; V-carve flat-bottom'))).toBe(true)
    expect(hints.some((h) => /flat-bottom clearance pass emitted/.test(h))).toBe(true)
    expect(hints.some((h) => /flatBottomClearance/.test(h))).toBe(true)
  })
})

// ── 4. Posted G-code -- Laguna Swift / RichAuto (Mach3) invariants ──────────

describe('cnc_vcarve posted through vcarve_mach3.hbs on Laguna Swift 5x10', () => {
  async function postVCarve(
    overrides: Partial<CamJobConfig> = {},
    params: Record<string, unknown> = {}
  ): Promise<{ gcode: string; out: string }> {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('post')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_vcarve',
        operationParams: { contourPoints: WEDGE, vBitAngleDeg: 90, maxDepthMm: 4, ...params },
        ...overrides
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, out }
  }

  it('emits a non-empty program and reports the builtin engine (no Python fallback)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('engine')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: { contourPoints: WEDGE, vBitAngleDeg: 90, maxDepthMm: 4 }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.usedEngine).toBe('builtin')
      expect(r.engine.fallbackApplied).toBe(false)
      expect(r.gcode.length).toBeGreaterThan(200)
      const onDisk = await readFile(out, 'utf-8')
      expect(onDisk).toBe(r.gcode)
    }
    await unlink(out).catch(() => {})
  })

  it('wraps the body in % tape markers (leading + trailing) -- RichAuto convention', async () => {
    const { gcode, out } = await postVCarve()
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
    await unlink(out).catch(() => {})
  })

  it('emits the metric/absolute/plane header G21 -> G90 -> G17 in order', async () => {
    const { gcode, out } = await postVCarve()
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).not.toMatch(/^G20\b/m) // never inches by default
    await unlink(out).catch(() => {})
  })

  it('warms the spindle (M3 -> G4 P2.0) and cools it down (M5 -> G4 P3.0) around the carve', async () => {
    const { gcode, out } = await postVCarve()
    const m3 = gcode.search(/^M3\b/m)
    const warm = gcode.indexOf('G4 P2.0')
    const m5 = gcode.search(/^M5\b/m)
    const cool = gcode.indexOf('G4 P3.0')
    expect(m3).toBeGreaterThan(-1)
    expect(warm).toBeGreaterThan(m3)
    expect(m5).toBeGreaterThan(warm)
    expect(cool).toBeGreaterThan(m5)
    // Wood router is M3-only -- M4 (reverse) must never appear as a live line.
    expect(gcode).not.toMatch(/^M4\b/m)
    await unlink(out).catch(() => {})
  })

  it('ends with M30 (Mach3 terminator) and NEVER M2 (Carvera terminator)', async () => {
    const { gcode, out } = await postVCarve()
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    await unlink(out).catch(() => {})
  })

  it('emits a pre-cut safe-Z lift to the work-area Z (203 mm) before the carve body', async () => {
    const { gcode, out } = await postVCarve()
    const safe = gcode.indexOf('G0 Z203')
    const firstCarveComment = gcode.indexOf('; V-carve')
    expect(safe).toBeGreaterThan(-1)
    expect(safe).toBeLessThan(firstCarveComment)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: no cut Z is deeper than the requested depth cap (V-bit capped to the carve)', async () => {
    const cap = 4
    const { gcode, out } = await postVCarve({}, { maxDepthMm: cap })
    const bodyLines = gcode.split('\n')
    expect(deepestZ(bodyLines)).toBeGreaterThanOrEqual(-cap - 1e-6)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: the depth cap is reduced to the STOCK THICKNESS so the V-bit cannot plunge past the material', async () => {
    // Request a 10 mm carve but only 3 mm of stock -> the cap binds at 3 mm.
    const { gcode, out } = await postVCarve({ stockBoxZMm: 3 }, { maxDepthMm: 10 })
    const bodyLines = gcode.split('\n')
    // No emitted Z is deeper than the 3 mm stock.
    expect(deepestZ(bodyLines)).toBeGreaterThanOrEqual(-3 - 1e-6)
    await unlink(out).catch(() => {})
  })

  it('reports the stock-cap reduction as an operator hint', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('hint')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        stockBoxZMm: 3,
        operationParams: { contourPoints: WEDGE, vBitAngleDeg: 90, maxDepthMm: 10 }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint).toMatch(/depth cap reduced from 10\.000 mm to the 3\.000 mm stock thickness/)
      expect(r.hint).toContain('[test-guard]')
    }
    await unlink(out).catch(() => {})
  })

  it('a missing/degenerate contour returns a geometry error (no empty program slips through)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('bad')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: { vBitAngleDeg: 90, maxDepthMm: 4 } // no contourPoints
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Contour geometry missing/)
    await unlink(out).catch(() => {})
  })

  it('every X/Y coordinate stays inside the Laguna 1524 x 3048 mm bed for the fixture', async () => {
    const { gcode, out } = await postVCarve()
    const xs: number[] = []
    const ys: number[] = []
    for (const l of gcode.split('\n')) {
      const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
      const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
      if (mx) xs.push(Number.parseFloat(mx[1]!))
      if (my) ys.push(Number.parseFloat(my[1]!))
    }
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0)
    for (const x of xs) expect(x).toBeLessThanOrEqual(1524)
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(0)
    for (const y of ys) expect(y).toBeLessThanOrEqual(3048)
    await unlink(out).catch(() => {})
  })

  it('posted program contains the VCarve Pro header banner with the machine name', async () => {
    const { gcode, out } = await postVCarve()
    expect(
      gcode.split('\n').some((l) => l.includes('VCarve Pro post') && l.includes('Laguna Swift'))
    ).toBe(true)
    await unlink(out).catch(() => {})
  })
})

// ── 5. Posted G-code snapshot (normalized) ──────────────────────────────────

describe('cnc_vcarve posted snapshot (Laguna Swift, deterministic small wedge)', () => {
  it('matches the normalized posted-program snapshot', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('snap')
    // A tiny wedge with a coarse explicit resolution keeps the snapshot small +
    // deterministic across runs.
    const tinyWedge: CamPoint2d[] = [
      [0, 0],
      [0, 12],
      [24, 6]
    ]
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        feedMmMin: 1500,
        plungeMmMin: 400,
        safeZMm: 6,
        operationParams: {
          contourPoints: tinyWedge,
          vBitAngleDeg: 90,
          maxDepthMm: 3,
          stepoverMm: 1.5
        }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Normalize the operator-visible banner line that carries the machine id
      // (stable) but strip nothing else -- the toolpath body is deterministic.
      expect(r.gcode).toMatchSnapshot()
    }
    await unlink(out).catch(() => {})
  })
})

// ── 6. Flat-bottom (prism) clearance pass — Wave 3i ─────────────────────────

/**
 * A WIDE bar (40 × 16 mm): with a 90° bit and a 2 mm cap the inscribed radius
 * (up to 8 mm) far exceeds the 2 mm rim inset, so the cap BINDS and the floor
 * at z = -2 is the bar inset by 2 mm on every side — [2..38] × [2..14].
 */
const WIDE_BAR: CamPoint2d[] = [
  [0, 0],
  [40, 0],
  [40, 16],
  [0, 16]
]

/** A NARROW bar (30 × 3 mm): max clearance 1.5 mm < the 2 mm inset — no flat floor. */
const NARROW_BAR: CamPoint2d[] = [
  [0, 0],
  [30, 0],
  [30, 3],
  [0, 3]
]

describe('solveVCarveFlatRegion — floor region where the V cut saturates the cap', () => {
  it('90° bit: rim inset equals the depth cap and the floor is the bar inset by it', () => {
    const flat = solveVCarveFlatRegion({ rings: [WIDE_BAR], vBitAngleDeg: 90, maxDepthMm: 2 })
    expect(flat.insetMm).toBeCloseTo(2, 6)
    expect(flat.rings.length).toBe(1)
    const xs = flat.rings[0]!.map((p) => p[0])
    const ys = flat.rings[0]!.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(2, 3)
    expect(Math.max(...xs)).toBeCloseTo(38, 3)
    expect(Math.min(...ys)).toBeCloseTo(2, 3)
    expect(Math.max(...ys)).toBeCloseTo(14, 3)
  })

  it('60° bit: rim inset is cap·tan(30°) — a pointier bit leaves a wider flat floor', () => {
    const inset60 = 2 * Math.tan((30 * Math.PI) / 180)
    const flat = solveVCarveFlatRegion({ rings: [WIDE_BAR], vBitAngleDeg: 60, maxDepthMm: 2 })
    expect(flat.insetMm).toBeCloseTo(inset60, 6)
    expect(flat.rings.length).toBe(1)
    const xs = flat.rings[0]!.map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(inset60, 3)
    expect(Math.max(...xs)).toBeCloseTo(40 - inset60, 3)
  })

  it('NARROW shape that never reaches the cap has NO flat floor', () => {
    const flat = solveVCarveFlatRegion({ rings: [NARROW_BAR], vBitAngleDeg: 90, maxDepthMm: 2 })
    expect(flat.rings).toEqual([])
  })

  it('even-odd island: the floor is the outer inset PLUS the island grown by the inset', () => {
    const outer: CamPoint2d[] = [[0, 0], [40, 0], [40, 40], [0, 40]]
    const island: CamPoint2d[] = [[16, 16], [24, 16], [24, 24], [16, 24]]
    const flat = solveVCarveFlatRegion({ rings: [outer, island], vBitAngleDeg: 90, maxDepthMm: 2 })
    expect(flat.rings.length).toBe(2)
    const all = flat.rings.flat()
    // Outer eroded to [2..38]; hole grown to [14..26] (island ± the 2 mm inset).
    expect(all.some((p) => Math.abs(p[0] - 2) < 0.01)).toBe(true)
    expect(all.some((p) => Math.abs(p[0] - 14) < 0.01)).toBe(true)
    expect(all.some((p) => Math.abs(p[0] - 26) < 0.01)).toBe(true)
    expect(all.some((p) => Math.abs(p[0] - 38) < 0.01)).toBe(true)
  })

  it('degenerate input yields no region (no crash)', () => {
    expect(solveVCarveFlatRegion({ rings: [], vBitAngleDeg: 90, maxDepthMm: 2 }).rings).toEqual([])
    expect(solveVCarveFlatRegion({ rings: [WIDE_BAR], vBitAngleDeg: 90, maxDepthMm: 0 }).rings).toEqual([])
    expect(
      solveVCarveFlatRegion({ rings: [[[0, 0], [10, 0]]], vBitAngleDeg: 90, maxDepthMm: 2 }).rings
    ).toEqual([])
  })
})

describe('generateVCarve2dLines — flat-bottom clearance section (Safety Rule 5)', () => {
  const ENGINE_ARGS = {
    rings: [WIDE_BAR],
    vBitAngleDeg: 90,
    maxDepthMm: 2,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    stepoverMm: 2
  }

  it('WIDE bar with a binding cap: V-walls capped at -cap AND a flat section at exactly -cap', () => {
    const { lines } = generateVCarve2dLines({ ...ENGINE_ARGS, flatBottomClearance: 2 })
    const idx = lines.findIndex((l) => l.startsWith('; V-carve flat-bottom'))
    expect(idx).toBeGreaterThan(0)
    // (a) V-wall section: the cap binds on a 16 mm-wide bar — deepest Z == -cap.
    const wall = lines.slice(0, idx)
    expect(deepestZ(wall)).toBeCloseTo(-2, 6)
    // (b) Flat section: EVERY cutting Z is exactly -cap (the floor is truly flat).
    const flat = lines.slice(idx)
    let cutMoves = 0
    for (const l of flat) {
      const m = l.match(/Z(-\d+(?:\.\d+)?)/)
      if (m) {
        cutMoves += 1
        expect(Number.parseFloat(m[1]!)).toBeCloseTo(-2, 6)
      }
    }
    expect(cutMoves).toBeGreaterThan(4)
    // (c) A safe-Z lift separates the V-wall pass from the flat section.
    expect(flat[0]!.startsWith('; V-carve flat-bottom')).toBe(true)
    expect(flat[1]!.trim()).toBe('G0 Z6.000')
    // Floor coverage: cutting rows span the inset floor [2..14] at ≤ stepover gaps.
    const ys: number[] = []
    for (const l of flat) {
      const m = l.match(/^G1 X-?\d+(?:\.\d+)? Y(-?\d+(?:\.\d+)?) F/)
      if (m) ys.push(Number.parseFloat(m[1]!))
    }
    const sorted = [...new Set(ys)].sort((a, b) => a - b)
    expect(sorted[0]!).toBeCloseTo(2, 3)
    expect(sorted[sorted.length - 1]!).toBeCloseTo(14, 3)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeLessThanOrEqual(2 + 1e-6)
    }
    // (d) No bare XY rapid at cut depth anywhere in the WHOLE body.
    let atDepth = false
    for (const l of lines) {
      const t = l.trim()
      if (t === 'G0 Z6.000') atDepth = false
      else if (/^G1 Z-?\d/.test(t)) atDepth = true
      else if (/^G0 X-?\d/.test(t)) expect(atDepth).toBe(false)
    }
  })

  it('rim finish traces the inset boundary so the floor meets the V-walls with no sliver', () => {
    const { lines } = generateVCarve2dLines({ ...ENGINE_ARGS, flatBottomClearance: 2 })
    const idx = lines.findIndex((l) => l.startsWith('; V-carve flat-bottom'))
    const flat = lines.slice(idx)
    const feedXY = new Set(
      flat
        .map((l) => l.match(/^G1 X(-?\d+(?:\.\d+)?) Y(-?\d+(?:\.\d+)?) F/))
        .filter((m): m is RegExpMatchArray => m != null)
        .map((m) => Number.parseFloat(m[1]!).toFixed(3) + ',' + Number.parseFloat(m[2]!).toFixed(3))
    )
    // All four corners of the 2 mm-inset floor rect are feed targets: the V-bit
    // tip rides the rim at z = -cap, where its cone exactly meets the V-wall.
    for (const corner of ['2.000,2.000', '38.000,2.000', '2.000,14.000', '38.000,14.000']) {
      expect(feedXY.has(corner)).toBe(true)
    }
  })

  it('NARROW shape (cap never binds) emits NO flat-bottom section and says so honestly', () => {
    const { lines, hints } = generateVCarve2dLines({
      rings: [NARROW_BAR],
      vBitAngleDeg: 90,
      maxDepthMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: 6,
      stepoverMm: 1,
      flatBottomClearance: 1
    })
    expect(lines.some((l) => l.includes('flat-bottom'))).toBe(false)
    expect(hints.some((h) => /no flat floor exists/.test(h))).toBe(true)
  })

  it('flatBottomClearance ABSENT keeps the output byte-identical to the V-walls-only engine', () => {
    const without = generateVCarve2dLines(ENGINE_ARGS)
    const withFlat = generateVCarve2dLines({ ...ENGINE_ARGS, flatBottomClearance: 2 })
    // The with-flat body STARTS with the identical V-wall pass (sans final lift)…
    expect(withFlat.lines.slice(0, without.lines.length - 1)).toEqual(without.lines.slice(0, -1))
    // …then APPENDS the flat section and still ends at safe-Z.
    expect(withFlat.lines.length).toBeGreaterThan(without.lines.length)
    expect(withFlat.lines[withFlat.lines.length - 1]).toBe('G0 Z6.000')
    expect(without.lines.some((l) => l.includes('flat-bottom'))).toBe(false)
  })

  it('disjoint floor strokes around an ISLAND are each entered from safe-Z (no transit at depth)', () => {
    const outer: CamPoint2d[] = [[0, 0], [40, 0], [40, 40], [0, 40]]
    const island: CamPoint2d[] = [[16, 16], [24, 16], [24, 24], [16, 24]]
    const { lines } = generateVCarve2dLines({
      rings: [outer, island],
      vBitAngleDeg: 90,
      maxDepthMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: 6,
      stepoverMm: 2,
      flatBottomClearance: 2
    })
    const idx = lines.findIndex((l) => l.startsWith('; V-carve flat-bottom'))
    expect(idx).toBeGreaterThan(0)
    const flat = lines.slice(idx)
    // A raster row through the island band (y = 20) is split into TWO strokes
    // around the grown hole — each entered by its own rapid after a safe-Z lift.
    const rowStarts = flat.filter((l) => /^G0 X-?\d+(?:\.\d+)? Y20\.000$/.test(l.trim()))
    expect(rowStarts.length).toBe(2)
    // And the at-depth walk holds across the whole flat section.
    let atDepth = false
    for (const l of flat) {
      const t = l.trim()
      if (t === 'G0 Z6.000') atDepth = false
      else if (/^G1 Z-?\d/.test(t)) atDepth = true
      else if (/^G0 X-?\d/.test(t)) expect(atDepth).toBe(false)
    }
  })
})

describe('cnc_vcarve flat-bottom posted through vcarve_mach3.hbs on Laguna Swift 5x10', () => {
  const FLAT_PARAMS = {
    contourPoints: WIDE_BAR,
    vBitAngleDeg: 90,
    maxDepthMm: 2,
    stepoverMm: 2,
    flatBottomClearance: 2
  }

  async function postFlat(
    overrides: Partial<CamJobConfig> = {},
    params: Record<string, unknown> = {}
  ): Promise<{ gcode: string; out: string }> {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('flat')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_vcarve',
        operationParams: { ...FLAT_PARAMS, ...params },
        ...overrides
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, out }
  }

  it('passes the Laguna/RichAuto invariants with the flat section present (tape, header order, warm-up/cool-down, M30 never M2/M4)', async () => {
    const { gcode, out } = await postFlat()
    expect(gcode).toContain('; V-carve flat-bottom')
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    const m3 = gcode.search(/^M3\b/m)
    const warm = gcode.indexOf('G4 P2.0')
    const m5 = gcode.search(/^M5\b/m)
    const cool = gcode.indexOf('G4 P3.0')
    expect(m3).toBeGreaterThan(-1)
    expect(warm).toBeGreaterThan(m3)
    expect(m5).toBeGreaterThan(warm)
    expect(cool).toBeGreaterThan(m5)
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    expect(gcode).not.toMatch(/^M4\b/m)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: deepest posted Z is exactly the cap — the flat floor never undercuts it', async () => {
    const { gcode, out } = await postFlat()
    const deepest = deepestZ(gcode.split('\n'))
    expect(deepest).toBeGreaterThanOrEqual(-2 - 1e-6)
    expect(deepest).toBeLessThanOrEqual(-2 + 1e-6)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: stock thinner than maxDepth re-caps the flat floor to the stock thickness', async () => {
    const { gcode, out } = await postFlat({ stockBoxZMm: 1.5 })
    expect(deepestZ(gcode.split('\n'))).toBeGreaterThanOrEqual(-1.5 - 1e-6)
    expect(gcode).toContain('; V-carve flat-bottom')
    expect(gcode).toContain('floor z -1.500 mm')
    expect(gcode).not.toContain('Z-2.000')
    await unlink(out).catch(() => {})
  })

  it('every X/Y in the flat-bottom program stays inside the Laguna 1524 x 3048 mm bed', async () => {
    const { gcode, out } = await postFlat()
    for (const l of gcode.split('\n')) {
      const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
      const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
      if (mx) {
        const x = Number.parseFloat(mx[1]!)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1524)
      }
      if (my) {
        const y = Number.parseFloat(my[1]!)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(3048)
      }
    }
    await unlink(out).catch(() => {})
  })

  it('the flat-bottom hint reaches the operator through the runner result', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('flathint')
    const r = await dispatch2dStrategy(
      buildJob({ machine, outputGcodePath: out, operationParams: { ...FLAT_PARAMS } }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint).toMatch(/flat-bottom clearance pass emitted/)
      expect(r.hint).toContain('[test-guard]')
    }
    await unlink(out).catch(() => {})
  })

  it('matches the flat-bottom posted-program snapshot (NEW snapshot; the wedge snapshot above is untouched)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('flatsnap')
    // A small bar + coarse resolutions keep the snapshot compact + deterministic.
    const smallBar: CamPoint2d[] = [
      [0, 0],
      [24, 0],
      [24, 10],
      [0, 10]
    ]
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: {
          contourPoints: smallBar,
          vBitAngleDeg: 90,
          maxDepthMm: 2,
          stepoverMm: 2,
          flatBottomClearance: 2.5
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
