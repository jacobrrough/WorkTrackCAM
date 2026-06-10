/**
 * Wave 3k — placement-aware 2D CAM emission: `dispatch2dStrategy` consumes
 * the nesting placement params (`placementXMm` / `placementYMm` /
 * `placementRotationDeg`) via `applyPlacementToOperationParams2d`
 * (src/shared/cam-placement-transform.ts) — the ONE authoritative transform
 * spot in the emit chain.
 *
 * What this file proves (G-code is sacred):
 *  (a) IDENTITY PIN — ops without placement params (and ops with partial /
 *      overflow-sheet placements) post BYTE-IDENTICAL output; a
 *      self-placement (own bbox-min, rot 0) is also a bit-exact no-op.
 *  (b) CONTRACT PARITY — the shared helper agrees with the nesting engine's
 *      own `placedRawPointsMm` (true-shape-nfp.ts) bit-near-exactly, for
 *      hand placements AND for placements produced by a real
 *      `nestPolygonsNfp` run. Two independent implementations, one contract.
 *  (c) RIGID-BODY THROUGH THE DISPATCHER — a placed pocket (outer + island)
 *      and a placed drill pattern post byte-identical to the same op whose
 *      geometry was pre-transformed by the exact contract, proving ONE rigid
 *      transform is applied uniformly to every geometry array.
 *  (d) POSTED PARITY + LAGUNA INVARIANTS — a translate-only placement shifts
 *      every cut line by EXACTLY (dx, dy), never touches Z, and the placed
 *      program still satisfies every Laguna Swift / RichAuto invariant
 *      (%, G21→G90→G17→G94, M3 + G4 P2.0, M5 + G4 P3.0, G0 Z203, M30-not-M2).
 *  (e) BED BOUNDS — through the REAL `runCamPipeline`, a placement that
 *      pushes the toolpath past the 1524×3048 Laguna bed surfaces the
 *      existing machine-envelope warning; an in-bed placement does not.
 *
 * Machines covered: Laguna Swift 5x10 (mach3/RichAuto — primary nesting
 * target) and Makera Carvera 3-axis (smoothieware — shares the 2D dispatch).
 */
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  applyPlacementToPoints,
  applyRigidTransform2d,
  rigidTransformForPlacement,
  type CamPlacement2d
} from '../shared/cam-placement-transform'
import { dispatch2dStrategy } from './cam-runner-2d'
import { runCamPipeline } from './cam-runner'
import type { CamJobConfig } from './cam-runner'
import { nestPolygonsNfp, placedRawPointsMm } from './nesting/true-shape-nfp'
import type { Polygon } from './nesting/true-shape-v1'

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
  return join(tmpdir(), `wt3d-cam-2d-place-${label}-${tmpCounter}-${Date.now()}.nc`)
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
    stlPath: join(tmpdir(), 'unused-2d-place.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -1,
    stepoverMm: 2,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 5,
    pythonPath: 'python',
    operationKind: 'cnc_contour',
    ...overrides
  }
}

/** Post one 2D op through the real dispatcher + real post templates. */
async function postOp(
  machine: MachineProfile,
  label: string,
  overrides: Partial<CamJobConfig>
): Promise<string> {
  const out = tmpGcodePath(label)
  const r = await dispatch2dStrategy(
    buildJob({ machine, outputGcodePath: out, ...overrides }),
    PASS_THROUGH_GUARD_HINT,
    envelopeHint
  )
  await unlink(out).catch(() => {})
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(`postOp(${label}) failed: ${r.error}`)
  return r.gcode
}

/** CCW square, bbox min (10, 20) — the base contour fixture. */
const CONTOUR: [number, number][] = [
  [10, 20],
  [30, 20],
  [30, 40],
  [10, 40]
]

/** Full placement param set as `applyNestingPlacements` writes it. */
function placementParams(xMm: number, yMm: number, rotationDeg: number): Record<string, unknown> {
  return {
    placementXMm: xMm,
    placementYMm: yMm,
    placementRotationDeg: rotationDeg,
    placementNestVersion: 'nfp-v2',
    placementSheetIndex: 0
  }
}

const numWord = (line: string, axis: 'X' | 'Y'): number | null => {
  const m = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`).exec(line)
  return m ? Number.parseFloat(m[1]!) : null
}

const allZWords = (gcode: string): number[] => {
  const out: number[] = []
  const re = /Z(-?\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(gcode)) !== null) out.push(Number.parseFloat(m[1]!))
  return out.sort((a, b) => a - b)
}

// ─── (a) Identity pins — no placement ⇒ byte-identical output ───────────────

describe('placement identity pins — un-nested ops post byte-identically', () => {
  it('self-placement (own bbox min, rot 0) posts BYTE-IDENTICAL to no placement', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const base = await postOp(machine, 'id-base', {
      operationParams: { contourPoints: CONTOUR }
    })
    const selfPlaced = await postOp(machine, 'id-self', {
      operationParams: { contourPoints: CONTOUR, ...placementParams(10, 20, 0) }
    })
    expect(selfPlaced).toBe(base)
  })

  it('PARTIAL placement (only placementXMm) is identity — byte-identical', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const base = await postOp(machine, 'part-base', {
      operationParams: { contourPoints: CONTOUR }
    })
    const partial = await postOp(machine, 'part-x', {
      operationParams: { contourPoints: CONTOUR, placementXMm: 500 }
    })
    expect(partial).toBe(base)
  })

  it('overflow-sheet placement (placementSheetIndex 1) is identity — byte-identical', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const base = await postOp(machine, 'ovf-base', {
      operationParams: { contourPoints: CONTOUR }
    })
    const overflow = await postOp(machine, 'ovf-s1', {
      operationParams: {
        contourPoints: CONTOUR,
        ...placementParams(500, 700, 90),
        placementSheetIndex: 1
      }
    })
    expect(overflow).toBe(base)
  })
})

// ─── (b) Contract parity vs the nesting engine's own implementation ─────────

describe('contract parity — applyPlacementToPoints vs nesting placedRawPointsMm', () => {
  // CCW L-shape, integer mm, no closing duplicate (so the NFP module's
  // clean/CCW-normalise steps preserve index order 1:1).
  const L: Polygon = {
    id: 'L',
    points: [
      [0, 0],
      [30, 0],
      [30, 10],
      [10, 10],
      [10, 20],
      [0, 20]
    ]
  }

  it.each([
    [12.5, 30.25, 0],
    [100.0625, 7.125, 90],
    [40.5, 60.0625, 180],
    [3.125, 9.375, 270]
  ])(
    'cardinal placement (%f, %f, %d°): both implementations agree to 1e-9',
    (xMm, yMm, rotationDeg) => {
      const mine = applyPlacementToPoints(L.points, { xMm, yMm, rotationDeg })
      const theirs = placedRawPointsMm(L, { xMm, yMm, rotationDeg })
      expect(theirs).not.toBeNull()
      expect(mine).toHaveLength(theirs!.length)
      mine.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(theirs![i]![0], 9)
        expect(p[1]).toBeCloseTo(theirs![i]![1], 9)
      })
    }
  )

  it('non-cardinal 45° agrees within the NFP 0.1 µm integer-grid quantisation', () => {
    const placement: CamPlacement2d = { xMm: 55.5, yMm: 77.25, rotationDeg: 45 }
    const mine = applyPlacementToPoints(L.points, placement)
    const theirs = placedRawPointsMm(L, placement)
    expect(theirs).not.toBeNull()
    expect(mine).toHaveLength(theirs!.length)
    mine.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(theirs![i]![0], 3)
      expect(p[1]).toBeCloseTo(theirs![i]![1], 3)
    })
  })

  it('REAL nest run: every placement the NFP engine returns reproduces placedRawPointsMm', () => {
    const rectA: Polygon = {
      id: 'a',
      points: [
        [0, 0],
        [400, 0],
        [400, 300],
        [0, 300]
      ]
    }
    const rectB: Polygon = {
      id: 'b',
      points: [
        [0, 0],
        [350, 0],
        [350, 220],
        [0, 220]
      ]
    }
    const result = nestPolygonsNfp([rectA, rectB], {
      widthMm: 1524,
      heightMm: 3048,
      marginMm: 10
    })
    expect(result.unplaced).toEqual([])
    expect(result.placements.length).toBe(2)
    for (const pl of result.placements) {
      const part = pl.partId === 'a' ? rectA : rectB
      const mine = applyPlacementToPoints(part.points, {
        xMm: pl.xMm,
        yMm: pl.yMm,
        rotationDeg: pl.rotationDeg
      })
      const theirs = placedRawPointsMm(part, pl)
      expect(theirs).not.toBeNull()
      expect(mine).toHaveLength(theirs!.length)
      mine.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(theirs![i]![0], 9)
        expect(p[1]).toBeCloseTo(theirs![i]![1], 9)
      })
    }
  })
})

// ─── (c) Rigid-body through the dispatcher — byte parity vs pre-transformed ─

describe('dispatcher applies ONE rigid transform to ALL geometry arrays', () => {
  const OUTER: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 30],
    [0, 30]
  ]
  const ISLAND: [number, number][] = [
    [10, 10],
    [16, 10],
    [16, 16],
    [10, 16]
  ]

  it('placed pocket (outer + island, rot 90) posts BYTE-IDENTICAL to the pre-transformed op', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const placement: CamPlacement2d = { xMm: 100.5, yMm: 50.25, rotationDeg: 90 }
    // Pre-transform with the EXACT contract: one transform from the OUTER
    // ring applied to outer AND island (the island does NOT get its own bbox).
    const t = rigidTransformForPlacement(OUTER, placement)
    expect(t).not.toBeNull()
    const preOuter = OUTER.map((p) => applyRigidTransform2d(p, t!))
    const preIsland = ISLAND.map((p) => applyRigidTransform2d(p, t!))

    const placed = await postOp(machine, 'pkt-placed', {
      operationKind: 'cnc_pocket',
      zPassMm: -3,
      operationParams: {
        contourPoints: OUTER,
        islandRings: [ISLAND],
        zStepMm: 1.5,
        ...placementParams(placement.xMm, placement.yMm, placement.rotationDeg)
      }
    })
    const preTransformed = await postOp(machine, 'pkt-pre', {
      operationKind: 'cnc_pocket',
      zPassMm: -3,
      operationParams: {
        contourPoints: preOuter,
        islandRings: [preIsland],
        zStepMm: 1.5
      }
    })
    expect(placed).toBe(preTransformed)
  })

  it('placed drill pattern (rot 90) on Carvera posts BYTE-IDENTICAL to pre-transformed points', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const drills: [number, number][] = [
      [5, 5],
      [25, 5],
      [25, 15]
    ]
    const placement: CamPlacement2d = { xMm: 200.125, yMm: 100.5, rotationDeg: 90 }
    // Drill-only op: the drill pattern IS the outline the nest measured, so
    // the single-array contract form applies directly.
    const preDrills = applyPlacementToPoints(drills, placement)

    const placed = await postOp(machine, 'drl-placed', {
      operationKind: 'cnc_drill',
      zPassMm: -3,
      operationParams: {
        drillPoints: drills,
        ...placementParams(placement.xMm, placement.yMm, placement.rotationDeg)
      }
    })
    const preTransformed = await postOp(machine, 'drl-pre', {
      operationKind: 'cnc_drill',
      zPassMm: -3,
      operationParams: { drillPoints: preDrills }
    })
    expect(placed).toBe(preTransformed)

    // Carvera dialect invariants hold on the PLACED program: M2 terminator
    // (NOT M30 — SD-card delete gotcha), G49 TLC cancel, no Mach3 % markers.
    // Command-line anchors (^...m) — template COMMENTS may mention the other
    // terminator ("NOT M30"), so whole-text word search would false-positive.
    expect(/^M2\b/m.test(placed)).toBe(true)
    expect(/^M30\b/m.test(placed)).toBe(false)
    expect(placed).toContain('G49')
    expect(placed.startsWith('%')).toBe(false)
  })
})

// ─── (d) Posted parity (translate-only) + Laguna invariants on placed output ─

describe('posted G-code parity — Laguna Swift 5x10', () => {
  it('translate-only placement shifts every differing line by EXACTLY (dx, dy) and never touches Z', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    // CONTOUR bbox min (10, 20); placement (60.5, 120.25, 0) ⇒ dx 50.5, dy 100.25.
    const dx = 50.5
    const dy = 100.25
    const base = await postOp(machine, 'par-base', {
      operationParams: { contourPoints: CONTOUR }
    })
    const placed = await postOp(machine, 'par-placed', {
      operationParams: { contourPoints: CONTOUR, ...placementParams(60.5, 120.25, 0) }
    })

    const baseLines = base.split('\n')
    const placedLines = placed.split('\n')
    expect(placedLines.length).toBe(baseLines.length)

    const stripXY = (s: string): string =>
      s.replace(/X-?\d+(?:\.\d+)?/g, 'X*').replace(/Y-?\d+(?:\.\d+)?/g, 'Y*')

    let shiftedLines = 0
    for (let i = 0; i < baseLines.length; i++) {
      const a = baseLines[i]!
      const b = placedLines[i]!
      if (a === b) continue // header/footer/Z-only lines must be untouched
      // A differing line may differ ONLY in its X/Y words…
      expect(stripXY(a)).toBe(stripXY(b))
      // …and those words differ by EXACTLY the contract translation.
      const ax = numWord(a, 'X')
      const bx = numWord(b, 'X')
      const ay = numWord(a, 'Y')
      const by = numWord(b, 'Y')
      expect(ax !== null || ay !== null).toBe(true)
      if (ax !== null) {
        expect(bx).not.toBeNull()
        expect(bx! - ax).toBeCloseTo(dx, 9)
      }
      if (ay !== null) {
        expect(by).not.toBeNull()
        expect(by! - ay).toBeCloseTo(dy, 9)
      }
      shiftedLines += 1
    }
    expect(shiftedLines).toBeGreaterThan(0)

    // Placement is strictly an XY transform: the Z-word multiset is identical.
    expect(allZWords(placed)).toEqual(allZWords(base))
  })

  it('placed (rot 90) program holds EVERY Laguna/RichAuto invariant and cuts at the placed coordinates', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const g = await postOp(machine, 'inv-rot90', {
      operationParams: { contourPoints: CONTOUR, ...placementParams(100.5, 50.25, 90) }
    })

    // Tape markers.
    expect(g.startsWith('%')).toBe(true)
    expect(g.trimEnd().endsWith('%')).toBe(true)

    // Header order: G21 → G90 → G17 → G94 → M3 → G4 P2.0 → pre-cut safe-Z.
    const iG21 = g.indexOf('G21')
    const iG90 = g.indexOf('G90')
    const iG17 = g.indexOf('G17')
    const iG94 = g.indexOf('G94')
    const iM3 = g.search(/\bM3\b/)
    const iDwellUp = g.indexOf('G4 P2.0')
    const iSafeZ = g.indexOf('G0 Z203')
    for (const idx of [iG21, iG90, iG17, iG94, iM3, iDwellUp, iSafeZ]) {
      expect(idx).toBeGreaterThanOrEqual(0)
    }
    expect(iG21).toBeLessThan(iG90)
    expect(iG90).toBeLessThan(iG17)
    expect(iG17).toBeLessThan(iG94)
    expect(iG94).toBeLessThan(iM3)
    expect(iM3).toBeLessThan(iDwellUp)
    expect(iDwellUp).toBeLessThan(iSafeZ)

    // Footer order: M5 → G4 P3.0 → safe-Z retract → park → M30. Never M2.
    // M2/M30 are asserted as COMMAND lines (^...m anchors): the template's
    // operator comment "(Mach3 expects M30, not M2)" would false-positive a
    // whole-text word search.
    const iM5 = g.search(/\bM5\b/)
    const iDwellDown = g.indexOf('G4 P3.0')
    const iPark = g.indexOf('G0 X0 Y0')
    const iM30 = g.search(/^M30\b/m)
    for (const idx of [iM5, iDwellDown, iPark, iM30]) {
      expect(idx).toBeGreaterThanOrEqual(0)
    }
    expect(iM5).toBeLessThan(iDwellDown)
    expect(iDwellDown).toBeLessThan(iPark)
    expect(iPark).toBeLessThan(iM30)
    expect(/^M2\b/m.test(g)).toBe(false)

    // Placed coordinates: rotate CONTOUR 90° about origin → bbox min (-40, 10);
    // translate to (100.5, 50.25) ⇒ corners (120.5, 50.25), (120.5, 70.25),
    // (100.5, 70.25), (100.5, 50.25).
    expect(g).toContain('X120.500')
    expect(g).toContain('Y70.250')
    expect(g).toContain('X100.500')
    // The un-placed origin coordinates must be gone from the cut body.
    expect(g).not.toContain('X10.000')
    expect(g).not.toContain('Y40.000')

    // Per-branch safe-Z: the body still lifts to the job safe-Z before rapids.
    expect(g).toContain('G0 Z5.000')
  })
})

// ─── (e) Bed bounds through the REAL pipeline (real envelope hint) ───────────

describe('bed-envelope validation still applies AFTER placement (runCamPipeline)', () => {
  const SQUARE100: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100]
  ]

  async function runPipeline(
    machine: MachineProfile,
    label: string,
    operationParams: Record<string, unknown>
  ): Promise<{ ok: boolean; gcode?: string; hint?: string; error?: string }> {
    const out = tmpGcodePath(label)
    const r = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-2d-place.stl'),
      outputGcodePath: out,
      machine,
      resourcesRoot: RESOURCES_ROOT,
      appRoot: APP_ROOT,
      zPassMm: -1,
      stepoverMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 400,
      safeZMm: 5,
      pythonPath: 'python',
      operationKind: 'cnc_contour',
      operationParams
    })
    await unlink(out).catch(() => {})
    return r
  }

  it('a placement pushing the toolpath past 1524 mm X is caught with the honest envelope warning', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    // 100 mm part placed at X=1500 ⇒ cuts reach X=1600 > 1524 (Laguna X max).
    const r = await runPipeline(machine, 'bed-out', {
      contourPoints: SQUARE100,
      ...placementParams(1500, 200, 0)
    })
    expect(r.ok).toBe(true)
    expect(r.hint).toBeDefined()
    expect(r.hint).toContain('Machine work volume warning')
    expect(r.hint).toMatch(/X past work volume max/)
    // And the program really does carry the out-of-bed coordinate.
    expect(r.gcode).toContain('X1600.000')
  })

  it('an in-bed placement raises NO X/Y envelope warning', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    // Same part placed at X=1400 ⇒ cuts reach X=1500 ≤ 1524. Stays inside.
    const r = await runPipeline(machine, 'bed-in', {
      contourPoints: SQUARE100,
      ...placementParams(1400, 200, 0)
    })
    expect(r.ok).toBe(true)
    expect(r.hint).toBeDefined()
    expect(r.hint).not.toMatch(/X (past work volume max|below machine origin)/)
    expect(r.hint).not.toMatch(/Y (past work volume max|below machine origin)/)
    expect(r.gcode).toContain('X1500.000')
  })
})
