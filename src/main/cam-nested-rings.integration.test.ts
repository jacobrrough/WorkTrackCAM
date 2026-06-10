/**
 * Wave 3i INTEGRATE — nested rings reach the ops (Safety Rule 5 + G-code safety).
 *
 * End-to-end chain for the sign-with-a-hole case (outer rect plate + inner
 * circle, the catalog's "Islands / pocket-with-holes" P1 row):
 *
 *   DesignFileV2  →  listContourCandidatesFromDesign / deriveContourRingGroupFromDesign
 *                 →  operationParams { contourPoints, islandRings }   (what the
 *                    ManufactureWorkspace "Derive from sketch" button now writes)
 *                 →  dispatch2dStrategy (cnc_pocket raster + offset_spiral, cnc_vcarve)
 *                 →  the REAL `vcarve_mach3.hbs` post + the bundled
 *                    `resources/machines/laguna-swift-5x10.json` profile.
 *
 * Pins, per the gcode-safety Laguna checklist:
 *   - the pocket CLEARING never cuts inside the hole (true segment-distance walk,
 *     not just endpoint sampling), for BOTH clearing strategies;
 *   - the V-carve ridge respects the hole: deepest carve sits in the band BETWEEN
 *     rect edge and circle (NOT at the rect centre, which is inside the hole);
 *   - posted programs keep every Laguna/RichAuto invariant: two `%` tape markers,
 *     G21→G90→G17 order, M3 + G4 P2.0 warm-up, M5 + G4 P3.0 cool-down, M30 and
 *     NEVER M2/M4, depth hard-capped, island transitions via safe-Z lifts;
 *   - degenerate islandRings entries are DROPPED (byte-identical to no-island);
 *   - a NEW posted snapshot for the nested-ring V-carve (existing snapshots untouched).
 */
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { deriveContourPointsFromDesign } from '../shared/cam-2d-derive'
import { deriveContourRingGroupFromDesign } from '../shared/cam-2d-nesting'
import { emptyDesign, type DesignFileV2 } from '../shared/design-schema'
import { solveVCarveRidge, type CamPoint2d } from './cam-local'
import { dispatch2dStrategy } from './cam-runner-2d'
import type { CamJobConfig } from './cam-runner'

// ── Fixture: a 60×40 mm plate with an r=8 mm hole, both centred at (30,20) ──

const PLATE_CENTER: CamPoint2d = [30, 20]
const HOLE_RADIUS = 8

function plateWithHoleDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      { id: 'plate', kind: 'rect', cx: 30, cy: 20, w: 60, h: 40, rotation: 0 },
      { id: 'hole', kind: 'circle', cx: 30, cy: 20, r: HOLE_RADIUS }
    ]
  }
}

/** The exact params the ManufactureWorkspace nested-ring derive writes for this design. */
function derivedRingParams(): { contourPoints: [number, number][]; islandRings: [number, number][][] } {
  const d = plateWithHoleDesign()
  const group = deriveContourRingGroupFromDesign(d)
  expect(group).not.toBeNull()
  expect(group!.outer.sourceId).toBe('plate')
  expect(group!.holes.map((h) => h.sourceId)).toEqual(['hole'])
  // Selection mirror: the grouped outer IS what the points-derive returns.
  expect(group!.outer.points).toEqual(deriveContourPointsFromDesign(d))
  return { contourPoints: group!.outer.points, islandRings: group!.holes.map((h) => h.points) }
}

// ── Laguna harness (cam-local-vcarve.test.ts pattern) ───────────────────────

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

async function loadLagunaProfile(): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json'), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-nested-rings-${label}-${tmpCounter}-${Date.now()}.nc`)
}

const GUARD_HINT = ' [test-guard]'
function envelopeHint(machine: MachineProfile, _gcode: string): string {
  return ` [test-envelope:${machine.id}]`
}

function buildJob(
  overrides: Partial<CamJobConfig> & { machine: MachineProfile; outputGcodePath: string }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-nested-rings.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -3,
    stepoverMm: 2,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_pocket',
    ...overrides
  }
}

// ── G-code walk helpers ──────────────────────────────────────────────────────

/** Min distance from point C to segment AB (mm). */
function distPointToSegment(cx: number, cy: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0
  return Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy))
}

/**
 * Walk the posted program tracking XY/Z and return the minimum distance from
 * `center` to ANY at-depth cut segment (a G1 with XY motion whose start AND end
 * Z are below the stock top). This is the true "never cuts inside the hole"
 * check: a segment PASSING THROUGH the hole is caught even when both endpoints
 * are outside it.
 */
function minCutSegmentDistance(lines: ReadonlyArray<string>, center: CamPoint2d): number {
  let x = Number.NaN
  let y = Number.NaN
  let z = Number.NaN
  let best = Number.POSITIVE_INFINITY
  for (const raw of lines) {
    const l = raw.trim()
    if (!/^G0?[01]\b/.test(l)) continue
    const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
    const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
    const mz = l.match(/Z(-?\d+(?:\.\d+)?)/)
    const nx = mx ? Number.parseFloat(mx[1]!) : x
    const ny = my ? Number.parseFloat(my[1]!) : y
    const nz = mz ? Number.parseFloat(mz[1]!) : z
    const isCut = /^G0?1\b/.test(l)
    const xyMotion = (mx !== null || my !== null) && Number.isFinite(x) && Number.isFinite(y)
    if (isCut && xyMotion && z < -1e-6 && nz < -1e-6) {
      best = Math.min(best, distPointToSegment(center[0], center[1], x, y, nx, ny))
    }
    x = nx
    y = ny
    z = nz
  }
  return best
}

/** Lowest (most negative) Z appearing on any move line. */
function deepestZ(lines: ReadonlyArray<string>): number {
  let z = 0
  for (const l of lines) {
    const m = l.match(/Z(-?\d+(?:\.\d+)?)/)
    if (m) z = Math.min(z, Number.parseFloat(m[1]!))
  }
  return z
}

/** Count of body safe-Z lift lines `G0 Z<safe>`. */
function countSafeZLifts(lines: ReadonlyArray<string>, safeZ: number): number {
  const needle = `G0 Z${safeZ.toFixed(3)}`
  return lines.filter((l) => l.trim() === needle).length
}

/** Assert the Laguna/RichAuto posted-program invariants (gcode-safety checklist). */
function expectLagunaInvariants(gcode: string): void {
  const lines = gcode.split('\n')
  // % tape markers, leading + trailing.
  expect(lines.map((l) => l.trim()).filter((l) => l === '%').length).toBe(2)
  // G21 -> G90 -> G17 header order; never inches.
  const g21 = gcode.indexOf('G21')
  const g90 = gcode.indexOf('G90')
  const g17 = gcode.indexOf('G17')
  expect(g21).toBeGreaterThan(-1)
  expect(g90).toBeGreaterThan(g21)
  expect(g17).toBeGreaterThan(g90)
  expect(gcode).not.toMatch(/^G20\b/m)
  // Spindle warm-up M3 -> G4 P2.0, cool-down M5 -> G4 P3.0; M3-only wood router.
  const m3 = gcode.search(/^M3\b/m)
  const warm = gcode.indexOf('G4 P2.0')
  const m5 = gcode.search(/^M5\b/m)
  const cool = gcode.indexOf('G4 P3.0')
  expect(m3).toBeGreaterThan(-1)
  expect(warm).toBeGreaterThan(m3)
  expect(m5).toBeGreaterThan(warm)
  expect(cool).toBeGreaterThan(m5)
  expect(gcode).not.toMatch(/^M4\b/m)
  // M30 terminator, never Carvera's M2.
  expect(gcode).toMatch(/^M30\b/m)
  expect(gcode).not.toMatch(/^M2\b/m)
  // The hole-avoidance walker below assumes linear moves only.
  expect(gcode).not.toMatch(/^G0?[23]\b/m)
}

// ── 1. Pocket clears AROUND the hole (raster + offset spiral) ────────────────

describe('cnc_pocket with derived islandRings posted on Laguna Swift 5x10', () => {
  async function postPocket(
    params: Record<string, unknown>,
    overrides: Partial<CamJobConfig> = {}
  ): Promise<{ gcode: string; hint: string; out: string }> {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('pocket')
    const r = await dispatch2dStrategy(
      buildJob({ machine, outputGcodePath: out, operationKind: 'cnc_pocket', operationParams: params, ...overrides }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, hint: r.hint ?? '', out }
  }

  it('RASTER: no cut segment enters the hole (wallStock clearance held through the post)', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const { gcode, out } = await postPocket({
      contourPoints,
      islandRings,
      wallStockMm: 1,
      finishPass: false
    })
    expectLagunaInvariants(gcode)
    // 1 mm wall stock off the island polygon; the 32-gon inscribes the true
    // circle by ~0.04 mm, allow a small numeric margin on top.
    expect(minCutSegmentDistance(gcode.split('\n'), PLATE_CENTER)).toBeGreaterThanOrEqual(HOLE_RADIUS + 1 - 0.15)
    expect(deepestZ(gcode.split('\n'))).toBeGreaterThanOrEqual(-3 - 1e-6)
    await unlink(out).catch(() => {})
  })

  it('RASTER: the island splits scanline rows -> strictly more safe-Z lifts than the same pocket without the hole', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const withIsland = await postPocket({ contourPoints, islandRings, finishPass: false })
    const without = await postPocket({ contourPoints, finishPass: false })
    expect(countSafeZLifts(withIsland.gcode.split('\n'), 6)).toBeGreaterThan(
      countSafeZLifts(without.gcode.split('\n'), 6)
    )
    await unlink(withIsland.out).catch(() => {})
    await unlink(without.out).catch(() => {})
  })

  it('RASTER + finishPass: the island WALL gets its finish contour (a trace at the island ring, still never inside it)', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const { gcode, out } = await postPocket({ contourPoints, islandRings, wallStockMm: 1, finishPass: true })
    const minDist = minCutSegmentDistance(gcode.split('\n'), PLATE_CENTER)
    // The island wall finish rides the ring itself (32-gon edges dip ~0.04 mm
    // inside the true circle) -- nothing may go deeper into the hole than that.
    expect(minDist).toBeLessThanOrEqual(HOLE_RADIUS + 0.05)
    expect(minDist).toBeGreaterThanOrEqual(HOLE_RADIUS - 0.1)
    await unlink(out).catch(() => {})
  })

  it('OFFSET SPIRAL: pocketStrategy offset_spiral clears around the hole with the same guarantees', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const { gcode, out } = await postPocket({
      contourPoints,
      islandRings,
      pocketStrategy: 'offset_spiral',
      wallStockMm: 1,
      finishPass: false
    })
    expectLagunaInvariants(gcode)
    expect(gcode).toContain('; Pocket offset-spiral')
    expect(minCutSegmentDistance(gcode.split('\n'), PLATE_CENTER)).toBeGreaterThanOrEqual(HOLE_RADIUS + 1 - 0.15)
    expect(deepestZ(gcode.split('\n'))).toBeGreaterThanOrEqual(-3 - 1e-6)
    await unlink(out).catch(() => {})
  })
})

// ── 2. V-carve ridge respects the hole ───────────────────────────────────────

describe('cnc_vcarve with derived hole rings — engine geometry', () => {
  it('no ridge point falls inside the hole', () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const ridge = solveVCarveRidge({
      rings: [contourPoints, ...islandRings],
      vBitAngleDeg: 90,
      maxDepthMm: 30
    })
    expect(ridge.points.length).toBeGreaterThan(0)
    for (const p of ridge.points) {
      expect(Math.hypot(p.x - PLATE_CENTER[0], p.y - PLATE_CENTER[1])).toBeGreaterThanOrEqual(HOLE_RADIUS - 0.1)
    }
  })

  it('deepest carve sits BETWEEN rect edge and circle (clearance ~11 mm), NOT at the rect centre', () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const withHole = solveVCarveRidge({ rings: [contourPoints, ...islandRings], vBitAngleDeg: 90, maxDepthMm: 30 })
    let deepest = withHole.points[0]!
    for (const p of withHole.points) if (p.depthMm > deepest.depthMm) deepest = p
    // Band between circle edge (r=8) and the rect's short side: max inscribed
    // radius ~11 mm at (49,20)/(11,20). 90 deg bit -> depth == clearance.
    expect(deepest.r).toBeGreaterThanOrEqual(9.5)
    expect(deepest.r).toBeLessThanOrEqual(12.5)
    expect(Math.hypot(deepest.x - PLATE_CENTER[0], deepest.y - PLATE_CENTER[1])).toBeGreaterThan(HOLE_RADIUS)

    // Control: WITHOUT the hole ring the medial spine (y=20, x in [20,40])
    // carries the full half-height clearance of 20 mm THROUGH the centre --
    // the hole ring must collapse that to the ~11 mm band max, proving it
    // actually reshaped the carve (the 20 mm-deep central cut is gone).
    const noHole = solveVCarveRidge({ rings: [contourPoints], vBitAngleDeg: 90, maxDepthMm: 30 })
    let deepestNoHole = noHole.points[0]!
    for (const p of noHole.points) if (p.depthMm > deepestNoHole.depthMm) deepestNoHole = p
    expect(deepestNoHole.r).toBeGreaterThanOrEqual(18)
    expect(deepest.r).toBeLessThan(deepestNoHole.r - 5)
    // And the no-hole spine really does carve at the centre, where the
    // hole-ring solve has nothing at all.
    const centreSpine = noHole.points.find(
      (p) => Math.hypot(p.x - PLATE_CENTER[0], p.y - PLATE_CENTER[1]) < 0.26 && p.r >= 18
    )
    expect(centreSpine).toBeDefined()
  })

  it('the depth cap still binds with hole rings present', () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const ridge = solveVCarveRidge({ rings: [contourPoints, ...islandRings], vBitAngleDeg: 90, maxDepthMm: 5 })
    for (const p of ridge.points) expect(p.depthMm).toBeLessThanOrEqual(5 + 1e-9)
  })
})

describe('cnc_vcarve with derived islandRings posted on Laguna Swift 5x10', () => {
  async function postVCarve(
    params: Record<string, unknown>,
    overrides: Partial<CamJobConfig> = {}
  ): Promise<{ gcode: string; hint: string; out: string }> {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('vcarve')
    const r = await dispatch2dStrategy(
      buildJob({ machine, outputGcodePath: out, operationKind: 'cnc_vcarve', operationParams: params, ...overrides }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, hint: r.hint ?? '', out }
  }

  it('passes the Laguna invariants, stays out of the hole, and caps depth to maxDepthMm', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const { gcode, out } = await postVCarve({ contourPoints, islandRings, vBitAngleDeg: 90, maxDepthMm: 4 })
    expectLagunaInvariants(gcode)
    const lines = gcode.split('\n')
    expect(deepestZ(lines)).toBeGreaterThanOrEqual(-4 - 1e-6)
    expect(minCutSegmentDistance(lines, PLATE_CENTER)).toBeGreaterThanOrEqual(HOLE_RADIUS - 0.1)
    // The annulus splits into disjoint medial strokes -> every one starts from safe-Z.
    expect(countSafeZLifts(lines, 6)).toBeGreaterThanOrEqual(1)
    await unlink(out).catch(() => {})
  })

  it('surfaces the hole rings as an operator hint through the runner result', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const { hint, out } = await postVCarve({ contourPoints, islandRings, vBitAngleDeg: 90, maxDepthMm: 4 })
    expect(hint).toMatch(/1 interior hole ring\(s\) carved around/)
    expect(hint).toContain('[test-guard]')
    expect(hint).toContain('[test-envelope:laguna-swift-5x10]')
    await unlink(out).catch(() => {})
  })

  it('stock thinner than maxDepth still re-caps the carve with hole rings present', async () => {
    const { contourPoints, islandRings } = derivedRingParams()
    const { gcode, hint, out } = await postVCarve(
      { contourPoints, islandRings, vBitAngleDeg: 90, maxDepthMm: 10 },
      { stockBoxZMm: 3 }
    )
    expect(deepestZ(gcode.split('\n'))).toBeGreaterThanOrEqual(-3 - 1e-6)
    expect(hint).toMatch(/depth cap reduced from 10\.000 mm to the 3\.000 mm stock thickness/)
    await unlink(out).catch(() => {})
  })

  it('degenerate islandRings entries are dropped: output is byte-identical to the no-island carve', async () => {
    const { contourPoints } = derivedRingParams()
    const clean = await postVCarve({ contourPoints, vBitAngleDeg: 90, maxDepthMm: 4 })
    const degenerate = await postVCarve({
      contourPoints,
      // 2-point "ring" + non-array entries are all invalid -> filtered out.
      islandRings: [[[1, 1], [2, 2]], 'nope', 42],
      vBitAngleDeg: 90,
      maxDepthMm: 4
    })
    expect(degenerate.gcode).toBe(clean.gcode)
    expect(degenerate.hint).not.toMatch(/interior hole ring/)
    await unlink(clean.out).catch(() => {})
    await unlink(degenerate.out).catch(() => {})
  })
})

// ── 3. NEW posted snapshot (small deterministic plate-with-hole carve) ───────

describe('cnc_vcarve nested-ring posted snapshot (Laguna Swift, plate with hole)', () => {
  it('matches the nested-ring posted-program snapshot (NEW snapshot; existing wedge/flat snapshots untouched)', async () => {
    const machine = await loadLagunaProfile()
    const out = tmpGcodePath('snap')
    // Small 24x16 plate with an r=3 hole, coarse explicit resolution -> a
    // compact deterministic program.
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'plate', kind: 'rect', cx: 12, cy: 8, w: 24, h: 16, rotation: 0 },
        { id: 'hole', kind: 'circle', cx: 12, cy: 8, r: 3 }
      ]
    }
    const group = deriveContourRingGroupFromDesign(d)
    expect(group!.holes).toHaveLength(1)
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_vcarve',
        operationParams: {
          contourPoints: group!.outer.points,
          islandRings: group!.holes.map((h) => h.points),
          vBitAngleDeg: 90,
          maxDepthMm: 2,
          stepoverMm: 1.5
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
