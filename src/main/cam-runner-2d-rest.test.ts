/**
 * Stack C v1 WIRE phase -- `dispatch2dStrategy` rest-machining contract
 * (`restPrevToolDiameterMm` on the pocket family), in the
 * cam-runner-2d-contract test pattern.
 *
 * The SOLVER fixture truth (corner-lobe geometry, area + coverage audits,
 * generator composition) lives in `cam-rest-region.test.ts`. THIS file pins
 * the DISPATCH wiring through the REAL posts + bundled machine profiles:
 *
 *  - cnc_pocket routes rest mode for BOTH clearing strategies: the posted
 *    Laguna Swift corner-lobe program cuts ONLY near the 4 corners, never in
 *    the open center, never re-traces the pocket wall (rest finish rule), and
 *    walks every Laguna invariant (% tape markers, G21 -> G90 -> G17, M3 +
 *    G4 P2.0 warm-up, M5 -> G4 P3.0 cool-down, M30 NEVER M2, no XY rapid at
 *    cut depth, no Z below the commanded depth). NEW posted snapshot.
 *  - the Carvera 3-axis SHARED dispatch posts the same rest op through
 *    carvera_3axis.hbs (ATC M6 T1 + G43, M2 NEVER M30, no A-axis words,
 *    feeds inside the 2400 mm/min ceiling). NEW posted snapshot.
 *  - cnc_adaptive routes rest mode: the channel fixture cuts (confined to the
 *    channel) while plain-rect cusped corner lobes yield the HONEST empty
 *    error pointing at cnc_pocket; cnc_trochoidal_hsm shares the branch.
 *  - degenerate validation: prev <= current tool, non-numeric, <= 0 -> honest
 *    ok:false validation errors; a round pocket the previous tool fully
 *    reached -> the honest "left nothing this tool can reach" error.
 *  - identity: ops WITHOUT the param keep the normal full-region path (cuts
 *    in the open center + the wall finish trace + zero rest hints), and rest
 *    output is deterministic. BYTE identity for no-param ops is additionally
 *    pinned by the untouched existing snapshot suites
 *    (post-process-gcode-snapshot, post-process-snapshots, cam-local-vcarve,
 *    cam-nested-rings) -- the rest branch is unreachable without the param by
 *    construction.
 */
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { dispatch2dStrategy } from './cam-runner-2d'
import { REST_SKIP_WALL_FINISH_HINT } from './cam-rest-region'
import type { CamJobConfig } from './cam-runner'

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

async function loadMachine(
  filename: 'laguna-swift-5x10.json' | 'makera-carvera-3axis.json'
): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `wt3d-cam-2d-rest-${label}-${tmpCounter}-${Date.now()}.nc`)
}

const PASS_THROUGH_GUARD_HINT = ' [test-guard]'
function envelopeHint(machine: MachineProfile, _gcode: string): string {
  return ` [test-envelope:${machine.id}]`
}

function buildJob(
  overrides: Partial<CamJobConfig> & {
    machine: MachineProfile
    outputGcodePath: string
  }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-2d-rest.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -3,
    stepoverMm: 2.4,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 6,
    toolDiameterMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_pocket',
    ...overrides
  }
}

// -- Fixtures (cam-rest-region.test.ts canon) ---------------------------------

/** The brief's canonical fixture: an open 60 x 40 mm rectangular pocket. */
const RECT_60X40: [number, number][] = [
  [0, 0],
  [60, 0],
  [60, 40],
  [0, 40]
]

const CORNERS_60X40: [number, number][] = [
  [0, 0],
  [60, 0],
  [60, 40],
  [0, 40]
]

const PREV_DIA = 12
const PREV_R = PREV_DIA / 2

/** Island leaving an 8 mm channel below it -- the 12 mm prev tool cannot enter. */
const ISLAND_CHANNEL: [number, number][] = [
  [20, 8],
  [35, 8],
  [35, 18],
  [20, 18]
]

/** 64-gon "circle" r 20 -- its opening by prevR 6 leaves only sub-floor dust. */
function circle64(): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2
    pts.push([30 + 20 * Math.cos(t), 20 + 20 * Math.sin(t)])
  }
  return pts
}

// -- Posted-G-code walkers ----------------------------------------------------

/** Every XY position reached by a G1 feed move while the modal Z is below 0. */
function collectDepthCutXY(gcode: string): [number, number][] {
  const out: [number, number][] = []
  let x = 0
  let y = 0
  let z = 100
  for (const raw of gcode.split('\n')) {
    const code = raw.split(';')[0]!.trim()
    if (!/^G[01]\b/.test(code)) continue
    const mx = code.match(/X(-?\d+(?:\.\d+)?)/)
    const my = code.match(/Y(-?\d+(?:\.\d+)?)/)
    const mz = code.match(/Z(-?\d+(?:\.\d+)?)/)
    if (mx) x = Number.parseFloat(mx[1]!)
    if (my) y = Number.parseFloat(my[1]!)
    if (mz) z = Number.parseFloat(mz[1]!)
    if (code.startsWith('G1') && z < -1e-9 && (mx || my)) out.push([x, y])
  }
  return out
}

/** Asserts no G0 with XY words ever executes while the modal Z is below 0. */
function expectNoXYRapidAtDepth(gcode: string): void {
  let z = 100
  for (const raw of gcode.split('\n')) {
    const code = raw.split(';')[0]!.trim()
    if (!/^G[01]\b/.test(code)) continue
    if (/^G0\b/.test(code) && /[XY]-?\d/.test(code)) {
      expect(z, `XY rapid at cut depth: ${code}`).toBeGreaterThanOrEqual(-1e-9)
    }
    const mz = code.match(/Z(-?\d+(?:\.\d+)?)/)
    if (mz) z = Number.parseFloat(mz[1]!)
  }
}

/** The deepest Z word in the program (mm). */
function minZWordMm(gcode: string): number {
  let min = Number.POSITIVE_INFINITY
  for (const raw of gcode.split('\n')) {
    const code = raw.split(';')[0]!.trim()
    if (!/^G[0-9]/.test(code)) continue
    const mz = code.match(/Z(-?\d+(?:\.\d+)?)/)
    if (mz) min = Math.min(min, Number.parseFloat(mz[1]!))
  }
  return min
}

/** Longest single at-depth G1 feed segment (mm) -- modal XY/Z tracked. */
function maxDepthFeedSegmentMm(gcode: string): number {
  let x = 0
  let y = 0
  let z = 100
  let started = false
  let max = 0
  for (const raw of gcode.split('\n')) {
    const code = raw.split(';')[0]!.trim()
    if (!/^G[01]\b/.test(code)) continue
    const mx = code.match(/X(-?\d+(?:\.\d+)?)/)
    const my = code.match(/Y(-?\d+(?:\.\d+)?)/)
    const mz = code.match(/Z(-?\d+(?:\.\d+)?)/)
    const nx = mx ? Number.parseFloat(mx[1]!) : x
    const ny = my ? Number.parseFloat(my[1]!) : y
    if (code.startsWith('G1') && z < -1e-9 && started && (mx || my)) {
      max = Math.max(max, Math.hypot(nx - x, ny - y))
    }
    x = nx
    y = ny
    if (mz) z = Number.parseFloat(mz[1]!)
    started = true
  }
  return max
}

function nearestCornerDistance(x: number, y: number): number {
  return Math.min(...CORNERS_60X40.map(([cx, cy]) => Math.hypot(x - cx, y - cy)))
}

// -- 1. cnc_pocket rest mode posted on Laguna Swift 5x10 (RichAuto / mach3) ----

describe('dispatch2dStrategy -- cnc_pocket rest mode on Laguna Swift 5x10 (offset_spiral)', () => {
  async function postLagunaRestPocket(): Promise<{ gcode: string; hint: string }> {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('pkt-rest-laguna')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pocket',
        operationParams: {
          contourPoints: RECT_60X40,
          pocketStrategy: 'offset_spiral',
          restPrevToolDiameterMm: PREV_DIA
        },
        operationLabel: 'Rest pass -- 60x40 corner lobes (prev 12 mm, tool 6 mm)'
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return { gcode: r.gcode, hint: r.hint ?? '' }
  }

  it('returns ok and surfaces the rest finish-suppression rule as a hint', async () => {
    const { hint } = await postLagunaRestPocket()
    expect(hint).toContain(REST_SKIP_WALL_FINISH_HINT)
  })

  it('cuts ONLY near the 4 corners: every at-depth cut within prevR + 0.25 mm of a corner', async () => {
    const { gcode } = await postLagunaRestPocket()
    const cuts = collectDepthCutXY(gcode)
    expect(cuts.length).toBeGreaterThan(0)
    for (const [x, y] of cuts) {
      expect(
        nearestCornerDistance(x, y),
        `cut at (${x}, ${y}) is outside every corner zone`
      ).toBeLessThanOrEqual(PREV_R + 0.25)
    }
  })

  it('emits NOTHING in the open center (the previous tool cleared it)', async () => {
    const { gcode } = await postLagunaRestPocket()
    for (const [x, y] of collectDepthCutXY(gcode)) {
      expect(Math.hypot(x - 30, y - 20)).toBeGreaterThan(8)
    }
  })

  it('suppresses the outer-wall finish trace: no at-depth cut near any wall midpoint', async () => {
    const { gcode } = await postLagunaRestPocket()
    const wallMidpoints: [number, number][] = [
      [30, 0],
      [30, 40],
      [0, 20],
      [60, 20]
    ]
    for (const [x, y] of collectDepthCutXY(gcode)) {
      for (const [wx, wy] of wallMidpoints) {
        expect(
          Math.hypot(x - wx, y - wy),
          `cut at (${x}, ${y}) sits on the pocket wall midpoint -- finish trace leaked into rest mode`
        ).toBeGreaterThan(2)
      }
    }
    // No full-wall trace anywhere: the longest at-depth feed segment stays
    // lobe-sized (a wall finish pass would run the 40/60 mm rectangle edges).
    expect(maxDepthFeedSegmentMm(gcode)).toBeLessThanOrEqual(10)
  })

  it('stamps each rest region with an operator-readable comment (1/4 .. 4/4)', async () => {
    const { gcode } = await postLagunaRestPocket()
    expect(gcode).toContain('; Rest region 1/4 (previous tool 12.000 mm)')
    expect(gcode).toContain('; Rest region 4/4 (previous tool 12.000 mm)')
  })

  it('walks every Laguna invariant: tape markers, G21->G90->G17, dwells, M30 not M2, depth cap, no rapid at depth', async () => {
    const { gcode } = await postLagunaRestPocket()
    const tape = gcode.split('\n').map((l) => l.trim()).filter((l) => l === '%')
    expect(tape.length).toBe(2)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).not.toMatch(/^G20\b/m)
    const m3 = gcode.search(/^M3\b/m)
    const warm = gcode.indexOf('G4 P2.0')
    const m5 = gcode.search(/^M5\b/m)
    const cool = gcode.indexOf('G4 P3.0')
    expect(m3).toBeGreaterThan(-1)
    expect(warm).toBeGreaterThan(m3)
    expect(m5).toBeGreaterThan(warm)
    expect(cool).toBeGreaterThan(m5)
    expect(gcode).not.toMatch(/^M4\b/m)
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    // Depth never exceeds the commanded -3 mm pass.
    expect(minZWordMm(gcode)).toBeGreaterThanOrEqual(-3.0005)
    expectNoXYRapidAtDepth(gcode)
  })

  it('matches the NEW posted-program snapshot (rest-op shape)', async () => {
    const { gcode } = await postLagunaRestPocket()
    expect(gcode).toMatchSnapshot()
  })
})

describe('dispatch2dStrategy -- cnc_pocket rest mode with the default raster strategy', () => {
  it('routes rest mode too: ok, rest hint, cuts confined to the corner zones', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('pkt-rest-raster')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pocket',
        stepoverMm: 1.2,
        operationParams: {
          contourPoints: RECT_60X40,
          restPrevToolDiameterMm: PREV_DIA
        }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint).toContain(REST_SKIP_WALL_FINISH_HINT)
      const cuts = collectDepthCutXY(r.gcode)
      expect(cuts.length).toBeGreaterThan(0)
      for (const [x, y] of cuts) {
        expect(nearestCornerDistance(x, y)).toBeLessThanOrEqual(PREV_R + 0.25)
      }
      expectNoXYRapidAtDepth(r.gcode)
    }
  })
})
// -- 2. Carvera 3-axis shares the same 2D dispatch ---------------------------

describe('dispatch2dStrategy -- cnc_pocket rest mode on Makera Carvera 3-axis (shared dispatch)', () => {
  async function postCarveraRestPocket(): Promise<string> {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('pkt-rest-carvera')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pocket',
        operationParams: {
          contourPoints: RECT_60X40,
          pocketStrategy: 'offset_spiral',
          restPrevToolDiameterMm: PREV_DIA
        },
        operationLabel: 'Rest pass -- 60x40 corner lobes (prev 12 mm, tool 6 mm)'
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    return r.gcode
  }

  it('emits G21 -> G90 -> G17, the ATC block (M6 T1 then G43), and a G4 P2 spindle dwell', async () => {
    const gcode = await postCarveraRestPocket()
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(gcode).toMatch(/M6 T1\b/)
    expect(gcode).toMatch(/G43/)
    expect(gcode).toMatch(/G4 P2\b/)
  })

  it('ends with M2 and NEVER M30 (M30 may delete the SD file on Smoothieware builds)', async () => {
    const gcode = await postCarveraRestPocket()
    expect(gcode).toMatch(/^M2\b/m)
    expect(gcode).not.toMatch(/^M30\b/m)
  })

  it('pure 3-axis: no A-axis words; feeds inside the 2400 mm/min ceiling; corner-zone cuts only', async () => {
    const gcode = await postCarveraRestPocket()
    for (const raw of gcode.split('\n')) {
      const code = raw.split(';')[0]!
      expect(code).not.toMatch(/\bA-?\d/)
      const mf = code.match(/F(\d+(?:\.\d+)?)/)
      if (mf) expect(Number.parseFloat(mf[1]!)).toBeLessThanOrEqual(2400)
    }
    const cuts = collectDepthCutXY(gcode)
    expect(cuts.length).toBeGreaterThan(0)
    for (const [x, y] of cuts) {
      expect(nearestCornerDistance(x, y)).toBeLessThanOrEqual(PREV_R + 0.25)
    }
    expectNoXYRapidAtDepth(gcode)
  })

  it('matches the NEW posted-program snapshot (rest-op shape, Carvera dialect)', async () => {
    const gcode = await postCarveraRestPocket()
    expect(gcode).toMatchSnapshot()
  })
})

// -- 3. cnc_adaptive (+ cnc_trochoidal_hsm) rest routing ----------------------

describe('dispatch2dStrategy -- cnc_adaptive rest mode', () => {
  it('channel fixture: ok, cuts confined to the channel, rest + narrow-skip hints surfaced', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('adp-rest-channel')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_adaptive',
        operationParams: {
          contourPoints: RECT_60X40,
          islandRings: [ISLAND_CHANNEL],
          restPrevToolDiameterMm: PREV_DIA
        }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint).toContain(REST_SKIP_WALL_FINISH_HINT)
      // The 4 cusped pocket-corner lobes are SKIPPED by the Stack-B engine
      // (honesty hint), while the 8 mm channel under the island cuts.
      expect(r.hint).toMatch(/narrow region\(s\) skipped/)
      const cuts = collectDepthCutXY(r.gcode)
      expect(cuts.length).toBeGreaterThan(0)
      for (const [x, y] of cuts) {
        expect(x).toBeGreaterThanOrEqual(14.2)
        expect(x).toBeLessThanOrEqual(40.8)
        expect(y).toBeGreaterThanOrEqual(-0.1)
        expect(y).toBeLessThanOrEqual(8.1)
      }
      expectNoXYRapidAtDepth(r.gcode)
    }
  })

  it('plain rect: every corner lobe is cusped -> honest empty error pointing at cnc_pocket', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('adp-rest-cusped')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_adaptive',
        operationParams: {
          contourPoints: RECT_60X40,
          restPrevToolDiameterMm: PREV_DIA
        }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Adaptive clearing toolpath is empty.')
      expect(r.hint).toMatch(/Rest machining/)
      expect(r.hint).toMatch(/cnc_pocket/)
    }
  })

  it('cnc_trochoidal_hsm shares the rest branch (channel fixture cuts)', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('hsm-rest-channel')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_trochoidal_hsm',
        operationParams: {
          contourPoints: RECT_60X40,
          islandRings: [ISLAND_CHANNEL],
          restPrevToolDiameterMm: PREV_DIA
        }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint).toContain(REST_SKIP_WALL_FINISH_HINT)
      expect(collectDepthCutXY(r.gcode).length).toBeGreaterThan(0)
    }
  })
})
// -- 4. Degenerate validation + honest empty-rest ------------------------------

describe('dispatch2dStrategy -- rest machining degenerate validation (honest errors)', () => {
  async function runPocketRest(
    params: Record<string, unknown>,
    overrides: Partial<CamJobConfig> = {}
  ): Promise<Awaited<ReturnType<typeof dispatch2dStrategy>>> {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('rest-degen')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pocket',
        operationParams: { contourPoints: RECT_60X40, ...params },
        ...overrides
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    return r
  }

  it('previous tool EQUAL to the current tool -> "requires a larger previous tool"', async () => {
    const r = await runPocketRest({ restPrevToolDiameterMm: 6 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Rest machining requires a larger previous tool.')
      expect(r.hint).toMatch(/6\.000/)
    }
  })

  it('previous tool SMALLER than the current tool on cnc_adaptive -> same honest error', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('adp-rest-smaller')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_adaptive',
        operationParams: { contourPoints: RECT_60X40, restPrevToolDiameterMm: 4 }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Rest machining requires a larger previous tool.')
      expect(r.hint).toMatch(/4\.000/)
    }
  })

  it('zero / negative / NaN / non-numeric values -> "parameter invalid"', async () => {
    for (const bad of [0, -3, Number.NaN, '12'] as const) {
      const r = await runPocketRest({ restPrevToolDiameterMm: bad })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe('Rest machining parameter invalid.')
        expect(r.hint).toMatch(/restPrevToolDiameterMm/)
      }
    }
  })

  it('round pocket the previous tool fully reached -> honest "left nothing this tool can reach"', async () => {
    const r = await runPocketRest({
      contourPoints: circle64(),
      pocketStrategy: 'offset_spiral',
      restPrevToolDiameterMm: PREV_DIA
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Rest machining: the previous tool left nothing this tool can reach.')
      expect(r.hint).toMatch(/left nothing this tool can reach/)
    }
  })
})

// -- 5. Identity: ops WITHOUT the param keep the normal full-region path -------

describe('dispatch2dStrategy -- ops WITHOUT restPrevToolDiameterMm are untouched', () => {
  it('a normal pocket still clears the open center, traces the wall finish, and carries zero rest hints', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('pkt-normal-identity')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pocket',
        operationParams: { contourPoints: RECT_60X40, pocketStrategy: 'offset_spiral' }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(out).catch(() => {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint ?? '').not.toMatch(/[Rr]est/)
      expect(r.gcode).not.toContain('; Rest region')
      const cuts = collectDepthCutXY(r.gcode)
      // Normal mode clears the deep interior the rest pass must never touch
      // (every rest-mode cut endpoint sits within prevR + 0.25 of a corner)...
      expect(cuts.some(([x, y]) => nearestCornerDistance(x, y) > 12)).toBe(true)
      // ...and the wall finish trace runs FULL wall edges at depth (a 40+ mm
      // feed segment along the short wall), which rest mode suppresses.
      expect(maxDepthFeedSegmentMm(r.gcode)).toBeGreaterThanOrEqual(39)
    }
  })

  it('rest output is deterministic: two identical runs post byte-identical programs', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const params = {
      contourPoints: RECT_60X40,
      pocketStrategy: 'offset_spiral',
      restPrevToolDiameterMm: PREV_DIA
    }
    const outA = tmpGcodePath('rest-det-a')
    const outB = tmpGcodePath('rest-det-b')
    const a = await dispatch2dStrategy(
      buildJob({ machine, outputGcodePath: outA, operationKind: 'cnc_pocket', operationParams: { ...params } }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    const b = await dispatch2dStrategy(
      buildJob({ machine, outputGcodePath: outB, operationKind: 'cnc_pocket', operationParams: { ...params } }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    await unlink(outA).catch(() => {})
    await unlink(outB).catch(() => {})
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.gcode).toBe(b.gcode)
    }
  })
})