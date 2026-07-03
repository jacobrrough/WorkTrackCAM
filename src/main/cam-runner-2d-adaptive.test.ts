/**
 * Stack B v1 WIRE-phase gate — `cnc_adaptive` / `cnc_trochoidal_hsm` routed
 * through the 2D dispatch to `generateAdaptiveClearing2dLines`.
 *
 * The ENGINE math (engagement audit, trochoid containment, narrow-region
 * spine, bounds, determinism) is proven in `cam-adaptive-clearing.test.ts`.
 * THIS file proves the WIRING, in the cam-pocket-offset-islands pattern:
 *
 *  1. ROUTING GATE (`runCamPipeline`): the two kinds reach the 2D dispatch
 *     ONLY when the op carries `contourPoints`; a mesh job without contour
 *     geometry keeps the legacy OCL AdaptiveWaterline -> parallel-finish
 *     chain (no behavior change for existing jobs).
 *  2. DISPATCH CONTRACT (`dispatch2dStrategy`): param plumbing (stepover from
 *     the job, islandRings, wallStockMm, zStepMm multi-depth), the per-kind
 *     engagement-cap defaults (40% of tool dia for `cnc_adaptive`, 20% for
 *     `cnc_trochoidal_hsm`, explicit `maxEngagementMm` always wins), the
 *     stock depth HARD-CAP + operator hint, the cheap finish-contour reuse
 *     (outer wall + island walls; gated on a non-empty clearing body), the
 *     geometry-validation pass-through, the Wave-3k placement transform, and
 *     builtin engine bookkeeping.
 *  3. POSTED INVARIANTS through the REAL posts (gcode-safety skill checklist):
 *     - vcarve_mach3.hbs + laguna-swift-5x10.json: % tape markers x2,
 *       G21 -> G90 -> G17 (never G20), M3 + G4 P2.0 warm-up, M5 -> G4 P3.0
 *       cool-down, M30 (NEVER M2), no M4, no XY rapid at cut depth, island
 *       + wall-stock clearance on the posted body, depth cap.
 *     - carvera_3axis.hbs + makera-carvera-3axis.json: G21 -> G90 -> G17,
 *       ATC M6 T1 -> G43 H1, M3 -> G4 P2 dwell, footer M5 -> G49 -> M9 -> M2
 *       (NEVER M30 — Smoothieware may delete the SD file), no `%` markers,
 *       no A-axis words, feeds inside the 2400 mm/min Carvera ceiling.
 *  4. A NEW posted snapshot for the dispatch path (engine snapshot is
 *     separate; existing snapshots untouched — new op family, new snapshot).
 */
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import type { CamPoint2d } from './cam-local'
import { dispatch2dStrategy } from './cam-runner-2d'
import { runCamPipeline, type CamJobConfig } from './cam-runner'

// -- Fixtures ----------------------------------------------------------------

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

/** Canonical 60x40 pocket (same as the Wave-3i islands suite). */
const OUTER_60X40: CamPoint2d[] = [
  [0, 0],
  [60, 0],
  [60, 40],
  [0, 40]
]

/** ... with a 15x10 island in the middle. */
const ISLAND_15X10: CamPoint2d[] = [
  [20, 15],
  [35, 15],
  [35, 25],
  [20, 25]
]

/**
 * Small L with a 5 mm-wide arm (tool-center geometry): with stepover 1.5 and
 * wallStock 0.5 the arm is reached by level 1 but not level 2 — engagement
 * spike at the inside corner — so the dispatched body must carry trochoidal
 * relief (proves the ADAPTIVE engine answered, not the pocket spiral).
 */
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

async function loadMachine(
  filename: 'laguna-swift-5x10.json' | 'makera-carvera-3axis.json'
): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-adaptive-2d-${label}-${tmpCounter}-${Date.now()}.nc`)
}

const GUARD_HINT = ' [test-guard]'
function envelopeHint(machine: MachineProfile, _gcode: string): string {
  return ` [test-envelope:${machine.id}]`
}

function buildJob(
  overrides: Partial<CamJobConfig> & { machine: MachineProfile; outputGcodePath: string }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-adaptive-2d.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -3,
    stepoverMm: 1.5,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_adaptive',
    ...overrides
  }
}

/** One-triangle binary STL (84-byte header + 1 facet) for mesh-path probes. */
function buildOneTriangleBinaryStl(): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.write('worktrack adaptive routing probe', 0, 'ascii')
  buf.writeUInt32LE(1, 80)
  const o = 84
  buf.writeFloatLE(0, o)
  buf.writeFloatLE(0, o + 4)
  buf.writeFloatLE(1, o + 8)
  buf.writeFloatLE(0, o + 12)
  buf.writeFloatLE(0, o + 16)
  buf.writeFloatLE(0, o + 20)
  buf.writeFloatLE(20, o + 24)
  buf.writeFloatLE(0, o + 28)
  buf.writeFloatLE(0, o + 32)
  buf.writeFloatLE(0, o + 36)
  buf.writeFloatLE(20, o + 40)
  buf.writeFloatLE(0, o + 44)
  return buf
}

// -- Test-local G-code walkers (islands-suite pattern, ARC-AWARE) -----------------
//
// Phase-6 Change 1 made the dispatched trochoid relief NATIVE G2/G3 arcs. The
// island-clearance SAFETY proof below runs collectCutSegments over the POSTED
// program; if it only parsed G1 lines it would skip every relief arc and pass
// vacuously (the island-clearance fixture emits hundreds of G3 arcs). So the
// collector interpolates each G2/G3 arc into fine sub-segments (faithful port of
// interpolateArc in cam-gcode-toolpath.ts) so the island-margin check samples the
// TRUE arc path, not a gap. The rigid-placement test compares expanded segments
// on both sides, so arc expansion is transform-invariant there.

/** Sub-segments per G2/G3 arc (matches ARC_INTERPOLATION_SEGMENTS in cam-gcode-toolpath.ts). */
const ARC_SAMPLES = 16

type CutSegment = { x0: number; y0: number; x1: number; y1: number }

/**
 * Interpolate a G2/G3 arc (XY plane, I/J centre offsets) into ARC_SAMPLES straight
 * sub-segments. Faithful port of `interpolateArc` (cam-gcode-toolpath.ts): centre
 * = start + (I,J); sweep sign forced by direction (cw => negative, ccw =>
 * positive); exact endpoint on the last sub-segment.
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
 * XY-moving FEED segments at (or entering) cut depth, tracking modal X/Y/Z.
 * ARC-AWARE: G2/G3 relief arcs are interpolated into fine sub-segments so every
 * downstream clearance check sees the TRUE arc path.
 */
function collectCutSegments(lines: ReadonlyArray<string>): CutSegment[] {
  let x = 0
  let y = 0
  let z = 100
  const segs: CutSegment[] = []
  for (const raw of lines) {
    const l = raw.trim()
    const isArc = /^G[23]\b/.test(l)
    const isLin = /^G[01]\b/.test(l)
    if (!isArc && !isLin) continue
    const mx = l.match(/X(-?\d+(?:\.\d+)?)/)
    const my = l.match(/Y(-?\d+(?:\.\d+)?)/)
    const mz = l.match(/Z(-?\d+(?:\.\d+)?)/)
    const nx = mx ? Number.parseFloat(mx[1]!) : x
    const ny = my ? Number.parseFloat(my[1]!) : y
    const nz = mz ? Number.parseFloat(mz[1]!) : z
    const atDepth = nz < -1e-9 || z < -1e-9
    if (isArc && atDepth) {
      const cw = /^G2\b/.test(l)
      const mi = l.match(/I(-?\d+(?:\.\d+)?)/)
      const mj = l.match(/J(-?\d+(?:\.\d+)?)/)
      const ci = mi ? Number.parseFloat(mi[1]!) : 0
      const cj = mj ? Number.parseFloat(mj[1]!) : 0
      segs.push(...interpolateArcSubSegments(cw, x, y, nx, ny, ci, cj))
    } else if (isLin && l.startsWith('G1') && atDepth && (nx !== x || ny !== y)) {
      segs.push({ x0: x, y0: y, x1: nx, y1: ny })
    }
    x = nx
    y = ny
    z = nz
  }
  return segs
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
      if (pointInRing(island, px, py) && d > tolMm) {
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
  let z = 100
  for (const raw of lines) {
    const l = raw.trim()
    if (!/^G[01]\b/.test(l)) continue
    const mz = l.match(/Z(-?\d+(?:\.\d+)?)/)
    const hasXY = /X-?\d/.test(l) || /Y-?\d/.test(l)
    const nz = mz ? Number.parseFloat(mz[1]!) : z
    if (l.startsWith('G0') && hasXY && (z < -1e-9 || nz < -1e-9)) {
      throw new Error(`XY rapid at cut depth: "${l}" (modal Z ${z})`)
    }
    z = nz
  }
}

// -- 1. runCamPipeline routing gate ---------------------------------------------

describe('runCamPipeline — cnc_adaptive / cnc_trochoidal_hsm routing gate', () => {
  it('cnc_adaptive WITH contourPoints routes to the 2D adaptive engine (builtin, no Python)', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('pipe-2d')
    const r = await runCamPipeline(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: { contourPoints: OUTER_60X40, wallStockMm: 1 }
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.usedEngine).toBe('builtin')
      expect(r.gcode).toMatch(/; Adaptive clearing -- /)
      expect(r.gcode).toMatch(/engagement cap 2\.400 mm/) // 40% of the default 6 mm tool
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_trochoidal_hsm WITH contourPoints aliases to the same engine with the 20% cap', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('pipe-troch')
    const r = await runCamPipeline(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_trochoidal_hsm',
        operationParams: { contourPoints: OUTER_60X40, wallStockMm: 1 }
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.usedEngine).toBe('builtin')
      expect(r.gcode).toMatch(/; Adaptive clearing -- /)
      expect(r.gcode).toMatch(/engagement cap 1\.200 mm/) // 20% of the default 6 mm tool
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_adaptive WITHOUT contourPoints keeps the legacy mesh chain (no 2D adaptive body)', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const stlPath = join(tmpdir(), `ufs-adaptive-mesh-probe-${Date.now()}.stl`)
    const out = tmpGcodePath('pipe-mesh')
    await writeFile(stlPath, buildOneTriangleBinaryStl())
    try {
      const r = await runCamPipeline(
        buildJob({
          machine,
          outputGcodePath: out,
          stlPath,
          zPassMm: -1.5,
          stepoverMm: 2,
          operationParams: { stockAllowanceMm: 0.25 }
        })
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        // Legacy OCL -> parallel-finish chain: never the 2D adaptive body.
        expect(r.gcode).not.toMatch(/; Adaptive clearing -- /)
        expect(['advanced', 'ocl', 'builtin']).toContain(r.usedEngine)
      }
    } finally {
      await unlink(stlPath).catch(() => {})
      await unlink(out).catch(() => {})
    }
  }, 90_000)
})

// -- 2. dispatch2dStrategy contract ----------------------------------------------

describe('dispatch2dStrategy — cnc_adaptive param plumbing + safety contract', () => {
  async function postAdaptive(
    overrides: Partial<CamJobConfig> = {},
    params: Record<string, unknown> = {}
  ): Promise<{ gcode: string; out: string; hint: string }> {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('disp')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: {
          contourPoints: OUTER_60X40,
          islandRings: [ISLAND_15X10],
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
    expect(r.usedEngine).toBe('builtin')
    return { gcode: r.gcode, out, hint: r.hint ?? '' }
  }

  it('explicit maxEngagementMm overrides the per-kind default (both kinds)', async () => {
    const a = await postAdaptive({}, { maxEngagementMm: 1.8 })
    expect(a.gcode).toMatch(/engagement cap 1\.800 mm/)
    await unlink(a.out).catch(() => {})
    const t = await postAdaptive({ operationKind: 'cnc_trochoidal_hsm' }, { maxEngagementMm: 1.8 })
    expect(t.gcode).toMatch(/engagement cap 1\.800 mm/)
    await unlink(t.out).catch(() => {})
  })

  it('job.toolDiameterMm drives the default cap (40% of 8 mm = 3.2 mm)', async () => {
    const { gcode, out } = await postAdaptive({ toolDiameterMm: 8 })
    expect(gcode).toMatch(/engagement cap 3\.200 mm/)
    await unlink(out).catch(() => {})
  })

  it('multi-depth via zStepMm posts both stepped depths', async () => {
    const { gcode, out } = await postAdaptive({}, { zStepMm: 1.5 })
    expect(gcode).toMatch(/Z-1\.500/)
    expect(gcode).toMatch(/Z-3\.000/)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: depth is HARD-CAPPED to stock thickness with the operator hint', async () => {
    const { gcode, out, hint } = await postAdaptive({ stockBoxZMm: 5, zPassMm: -12 })
    let deepest = 0
    for (const l of gcode.split('\n')) {
      const m = l.match(/Z(-?\d+(?:\.\d+)?)/)
      if (m) deepest = Math.min(deepest, Number.parseFloat(m[1]!))
    }
    expect(deepest).toBeGreaterThanOrEqual(-5 - 1e-6)
    expect(hint).toMatch(
      /Adaptive clearing: depth cap reduced from 12\.000 mm to the 5\.000 mm stock thickness/
    )
    await unlink(out).catch(() => {})
  })

  it('SAFETY: no posted clearing point enters the island + wall-stock margin (finishPass off)', async () => {
    const { gcode, out } = await postAdaptive({ stepoverMm: 2 }, { finishPass: false, wallStockMm: 2.5 })
    expectIslandClearance(gcode.split('\n'), ISLAND_15X10, 2.5, 0.02)
    await unlink(out).catch(() => {})
  })

  it('finishPass (default on) appends the outer wall AND island wall contours', async () => {
    const { gcode, out } = await postAdaptive()
    // Island finish traces the island ring itself -> its corners appear.
    expect(gcode).toMatch(/X20\.000 Y15\.000/)
    expect(gcode).toMatch(/X35\.000 Y25\.000/)
    // Outer wall finish traces the raw 60x40 loop corners.
    expect(gcode).toMatch(/X60\.000 Y40\.000/)
    await unlink(out).catch(() => {})
  })

  it('finishPass: false leaves the wall-stock body only (no island-corner trace)', async () => {
    const { gcode, out } = await postAdaptive({}, { finishPass: false })
    expect(gcode).not.toMatch(/X20\.000 Y15\.000/)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: finishPass is SUPPRESSED (with the hint) when the engine skipped geometry', async () => {
    // stepover 2 + wallStock 2.5 makes the engine skip level-0 corner spike
    // runs at the island (material deliberately left) — the same fixture the
    // adversarial probe measured a 4.29 mm full-burial finish advance on
    // before the gate. With adaptiveClearedToWalls false, the wall finish
    // must NOT trace (no island-corner finish coordinates) and the operator
    // must be told why.
    const { gcode, out, hint } = await postAdaptive({ stepoverMm: 2 }, { wallStockMm: 2.5 })
    expect(gcode).not.toMatch(/X20\.000 Y15\.000/) // island finish trace absent
    expect(hint).toMatch(/Finish pass suppressed: adaptive clearing left material/)
    await unlink(out).catch(() => {})
  })

  it('the clean default fixture finishes WITHOUT the suppression hint (flag plumbed true)', async () => {
    const { out, hint } = await postAdaptive()
    expect(hint ?? '').not.toMatch(/Finish pass suppressed/)
    await unlink(out).catch(() => {})
  })

  it('geometry validation: 2-point contour fails with the contour-family error', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('degen')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: { contourPoints: [[0, 0], [10, 0]] }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Contour geometry invalid or incomplete.')
    await unlink(out).catch(() => {})
  })

  it('region collapse (wall stock eats the pocket) returns the adaptive empty error', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('collapse')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: { contourPoints: OUTER_60X40, wallStockMm: 25, finishPass: false }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Adaptive clearing toolpath is empty.')
    await unlink(out).catch(() => {})
  })

  it('Wave-3k placement params rigidly translate the whole posted toolpath', async () => {
    const base = await postAdaptive({}, { finishPass: false })
    const placed = await postAdaptive(
      {},
      { finishPass: false, placementXMm: 100, placementYMm: 50, placementRotationDeg: 0 }
    )
    const segsBase = collectCutSegments(base.gcode.split('\n'))
    const segsPlaced = collectCutSegments(placed.gcode.split('\n'))
    expect(segsPlaced.length).toBe(segsBase.length)
    expect(segsBase.length).toBeGreaterThan(10)
    // OUTER_60X40 bbox-min is (0,0), rotation 0 -> pure translation (+100,+50).
    // Tolerance: the transform runs BEFORE the clipper insets, so offset
    // vertices re-quantize on the CLIPPER_SCALE integer grid; with 3-decimal
    // G-code formatting a coordinate can land one 0.001 ulp away from the
    // exact shift. 2e-3 admits that quantization while still proving rigidity.
    const TOL = 2e-3
    for (let i = 0; i < segsBase.length; i++) {
      expect(Math.abs(segsPlaced[i]!.x0 - (segsBase[i]!.x0 + 100))).toBeLessThanOrEqual(TOL)
      expect(Math.abs(segsPlaced[i]!.y0 - (segsBase[i]!.y0 + 50))).toBeLessThanOrEqual(TOL)
      expect(Math.abs(segsPlaced[i]!.x1 - (segsBase[i]!.x1 + 100))).toBeLessThanOrEqual(TOL)
      expect(Math.abs(segsPlaced[i]!.y1 - (segsBase[i]!.y1 + 50))).toBeLessThanOrEqual(TOL)
    }
    await unlink(base.out).catch(() => {})
    await unlink(placed.out).catch(() => {})
  })

  it('result hint carries the 2D base hint + envelope + guard suffixes (post-flow parity)', async () => {
    const { hint, out } = await postAdaptive()
    expect(hint).toMatch(/2D path posted from operation geometry params/)
    expect(hint).toContain('[test-envelope:laguna-swift-5x10]')
    expect(hint).toContain(GUARD_HINT.trim())
    await unlink(out).catch(() => {})
  })
})

// -- 3. Posted invariants — Laguna Swift (vcarve_mach3.hbs), relief present -------

describe('cnc_adaptive dispatched + posted through vcarve_mach3.hbs on Laguna Swift 5x10', () => {
  async function postSmallL(): Promise<{ gcode: string; out: string }> {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('laguna-L')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationParams: { contourPoints: SMALL_L, wallStockMm: 0.5 }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, out }
  }

  it('emits a non-empty program wrapped in two % tape markers', async () => {
    const { gcode, out } = await postSmallL()
    expect(gcode.length).toBeGreaterThan(200)
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
    await unlink(out).catch(() => {})
  })

  it('emits G21 -> G90 -> G17 in order and never G20', async () => {
    const { gcode, out } = await postSmallL()
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).not.toMatch(/^G20\b/m)
    await unlink(out).catch(() => {})
  })

  it('warms the spindle (M3 -> G4 P2.0), cools down (M5 -> G4 P3.0), never reverses (no M4)', async () => {
    const { gcode, out } = await postSmallL()
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
    const { gcode, out } = await postSmallL()
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: no XY rapid happens at cut depth anywhere in the posted program', async () => {
    const { gcode, out } = await postSmallL()
    expectNoRapidAtDepth(gcode.split('\n'))
    await unlink(out).catch(() => {})
  })

  it('the dispatched body carries trochoidal relief (proves the adaptive engine answered)', async () => {
    const { gcode, out } = await postSmallL()
    expect(gcode).toMatch(/; adaptive trochoid relief -- level 1/)
    await unlink(out).catch(() => {})
  })

  it('matches the posted-program snapshot (NEW snapshot for the dispatch path)', async () => {
    const { gcode, out } = await postSmallL()
    expect(gcode).toMatchSnapshot()
    await unlink(out).catch(() => {})
  })
})

// -- 4. Posted invariants — Makera Carvera 3-axis (carvera_3axis.hbs) -------------

describe('cnc_adaptive dispatched + posted through carvera_3axis.hbs on Makera Carvera 3-axis', () => {
  // Carvera-scale fixture + feeds INSIDE the 2400 mm/min ceiling (never copy
  // Laguna feeds onto the 200 W spindle).
  async function postCarvera(): Promise<{ gcode: string; out: string }> {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('carvera')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        zPassMm: -2,
        feedMmMin: 1200,
        plungeMmMin: 300,
        safeZMm: 5,
        operationParams: {
          contourPoints: [
            [0, 0],
            [40, 0],
            [40, 30],
            [0, 30]
          ],
          wallStockMm: 0.5
        }
      }),
      GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, out }
  }

  it('emits G21 -> G90 -> G17 and the ATC block (M6 T1 then G43 H1), no % markers', async () => {
    const { gcode, out } = await postCarvera()
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
    expect(gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%').length).toBe(0)
    await unlink(out).catch(() => {})
  })

  it('dwells after spindle start (M3 -> G4 P2) and ends M5 -> G49 -> M9 -> M2, NEVER M30', async () => {
    const { gcode, out } = await postCarvera()
    const m3 = gcode.search(/^M3\b/m)
    const dwell = gcode.search(/^G4 P2\b/m)
    expect(m3).toBeGreaterThan(-1)
    expect(dwell).toBeGreaterThan(m3)
    const m5 = gcode.search(/^M5\b/m)
    const g49 = gcode.search(/^G49\b/m)
    const m9 = gcode.search(/^M9\b/m)
    const m2 = gcode.search(/^M2\b/m)
    expect(m5).toBeGreaterThan(-1)
    expect(g49).toBeGreaterThan(m5)
    expect(m9).toBeGreaterThan(g49)
    expect(m2).toBeGreaterThan(m9)
    expect(gcode).not.toMatch(/^M30\b/m)
    await unlink(out).catch(() => {})
  })

  it('SAFETY: pure 3-axis output (no A-words), no rapid at depth, feeds inside 2400 mm/min', async () => {
    const { gcode, out } = await postCarvera()
    expectNoRapidAtDepth(gcode.split('\n'))
    for (const raw of gcode.split('\n')) {
      const code = raw.split(';')[0]!
      expect(code).not.toMatch(/\bA-?\d/)
      const m = code.match(/F(\d+(?:\.\d+)?)/)
      if (m) expect(Number.parseFloat(m[1]!)).toBeLessThanOrEqual(2400)
    }
    await unlink(out).catch(() => {})
  })
})
