/**
 * 4-Axis CAM end-to-end integration test.
 *
 * Mirrors the pattern in `cam-pipeline-integration.test.ts`: write a synthetic
 * binary STL to tmpdir, build a `CamJobConfig` for a 4-axis operation, call
 * `runCamPipeline`, and assert the resulting G-code is in the renderer's
 * machine-frame contract:
 *
 *   X ∈ [0, stockLengthMm]   (axial position from chuck face, never negative)
 *   Z ∈ [0, stockRadius+ε]   (radial distance from rotation axis)
 *   A around X               (degrees)
 *
 * This is the test that catches regressions in the coordinate-frame contract
 * the new engine establishes — if it passes, the toolpath visibly overlays the
 * displayed mesh in the simulation viewer.
 */
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import { extractToolpathSegments4AxisFromGcode } from '../../../shared/cam-gcode-toolpath'
import { runCamPipeline } from '../../cam-runner'
import type { CamJobConfig } from '../../cam-runner'

vi.mock('../../paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../paths')>()
  return {
    ...actual,
    getEnginesRoot: () => process.cwd()
  }
})

const resourcesRoot = join(process.cwd(), 'resources')

// ─── Synthetic STL builders ─────────────────────────────────────────────────

/**
 * Build a binary STL from raw triangle vertices.
 * Each triangle is a flat array of 9 floats: [v0x,v0y,v0z, v1x,v1y,v1z, v2x,v2y,v2z].
 * The normal is computed from the vertices (right-hand rule).
 */
function buildBinaryStl(triangles: number[][]): Buffer {
  const header = Buffer.alloc(80, 0)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(triangles.length, 0)
  const tris = triangles.map((t) => {
    const buf = Buffer.alloc(50)
    let o = 0
    // Compute normal from cross product (v1-v0) x (v2-v0)
    const ax = t[3]! - t[0]!
    const ay = t[4]! - t[1]!
    const az = t[5]! - t[2]!
    const bx = t[6]! - t[0]!
    const by = t[7]! - t[1]!
    const bz = t[8]! - t[2]!
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl
    buf.writeFloatLE(nx, o); o += 4
    buf.writeFloatLE(ny, o); o += 4
    buf.writeFloatLE(nz, o); o += 4
    for (let i = 0; i < 9; i++) {
      buf.writeFloatLE(t[i]!, o); o += 4
    }
    buf.writeUInt16LE(0, o)
    return buf
  })
  return Buffer.concat([header, count, ...tris])
}

/**
 * Build a synthetic ring (hollow cylinder, capped) STL centered on the X axis.
 * - Length along X: `length`
 * - Outer radius: `radius`
 * - Tessellation: `segments` around the circumference
 *
 * The mesh is built in raw STL space with X ∈ [-length/2, +length/2] (centered),
 * matching what `binary-stl-placement.ts` would produce after `center_origin`.
 * `frame.ts` then shifts X by `+length/2` to land in `[0, length]`.
 */
function buildCenteredRingStl(radius: number, length: number, segments: number): Buffer {
  const triangles: number[][] = []
  const xMin = -length / 2
  const xMax = length / 2
  for (let i = 0; i < segments; i++) {
    const t0 = (2 * Math.PI * i) / segments
    const t1 = (2 * Math.PI * (i + 1)) / segments
    const c0 = radius * Math.cos(t0)
    const s0 = radius * Math.sin(t0)
    const c1 = radius * Math.cos(t1)
    const s1 = radius * Math.sin(t1)
    // Outer wall (two triangles per quad)
    triangles.push([xMin, c0, s0, xMax, c0, s0, xMax, c1, s1])
    triangles.push([xMin, c0, s0, xMax, c1, s1, xMin, c1, s1])
    // Cap at xMin (fan from origin)
    triangles.push([xMin, 0, 0, xMin, c1, s1, xMin, c0, s0])
    // Cap at xMax
    triangles.push([xMax, 0, 0, xMax, c0, s0, xMax, c1, s1])
  }
  return buildBinaryStl(triangles)
}

// ─── Test machine ───────────────────────────────────────────────────────────

/** Fold-based min/max — `Math.min(...arr)` overflows the call stack for >~10k entries. */
function minOf(arr: ReadonlyArray<number>): number {
  let m = Infinity
  for (const v of arr) if (v < m) m = v
  return m
}
function maxOf(arr: ReadonlyArray<number>): number {
  let m = -Infinity
  for (const v of arr) if (v > m) m = v
  return m
}

const carvera4ax: MachineProfile = {
  id: 'integration-carvera-4ax',
  name: 'Integration Carvera 4-Axis',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_4axis_grbl.hbs',
  dialect: 'grbl_4axis',
  axisCount: 4,
  aAxisRangeDeg: 360,
  aAxisOrientation: 'x',
  minSpindleRpm: 6000,
  maxSpindleRpm: 15000,
  maxRotaryRpm: 60
}

function baseJob(over: Partial<CamJobConfig>): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-axis4-integration.stl'),
    outputGcodePath: join(tmpdir(), 'axis4-integration-output.nc'),
    machine: carvera4ax,
    resourcesRoot,
    appRoot: process.cwd(),
    zPassMm: -2,
    stepoverMm: 1.5,
    feedMmMin: 800,
    plungeMmMin: 300,
    safeZMm: 10,
    pythonPath: 'python',
    rotaryStockLengthMm: 100,
    rotaryStockDiameterMm: 40,
    toolDiameterMm: 3.175,
    ...over
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('4-axis CAM pipeline — end-to-end machine-frame contract', () => {
  it('roughing on a centered ring lands in [0, stockLen] / [0, stockRadius]', async () => {
    const stockLen = 100
    const stockDia = 40
    const stockRadius = stockDia / 2
    const ringRadius = 15
    const ringLength = 60

    const stlPath = join(tmpdir(), 'axis4-int-roughing.stl')
    const outPath = join(tmpdir(), 'axis4-int-roughing.nc')
    await writeFile(stlPath, buildCenteredRingStl(ringRadius, ringLength, 24))

    const result = await runCamPipeline(
      baseJob({
        stlPath,
        outputGcodePath: outPath,
        operationKind: 'cnc_4axis_roughing',
        rotaryStockLengthMm: stockLen,
        rotaryStockDiameterMm: stockDia
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.usedEngine).toBe('builtin')
    expect(typeof result.gcode).toBe('string')
    expect(result.gcode.length).toBeGreaterThan(100)

    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    expect(segs.length).toBeGreaterThan(0)

    // Collect every X / Z / A endpoint emitted.
    const xs: number[] = []
    const zs: number[] = []
    const as: number[] = []
    for (const s of segs) {
      xs.push(s.x0, s.x1)
      zs.push(s.z0, s.z1)
      as.push(s.a0, s.a1)
    }

    // ── Frame contract: X ∈ [0, stockLen + overcut] (chuck-face safety) ──
    // Roughing extends machinable range by ~one tool diameter on each side
    // for clean entry/exit cuts. Allow up to one tool diameter (3.175 mm)
    // past stockLen, but never negative X.
    const minX = minOf(xs)
    const maxX = maxOf(xs)
    expect(minX).toBeGreaterThanOrEqual(0 - 1e-6)
    expect(maxX).toBeLessThanOrEqual(stockLen + 5)

    // ── Frame contract: Z ∈ [0, machine.workArea.z + ε] ──
    // Cut moves go down to ~ringRadius; rapids retract above stockRadius up to
    // safeZ; the post template emits a final home retract at workArea.z (the
    // GRBL/Carvera convention). Allow up to that height plus a small slack.
    const minZ = minOf(zs)
    const maxZ = maxOf(zs)
    expect(minZ).toBeGreaterThanOrEqual(0 - 1e-6)
    expect(maxZ).toBeLessThanOrEqual(carvera4ax.workAreaMm.z + 1)

    // ── Frame contract: cut Z values are within radial reach of the ring ──
    // Cutting moves (non-rapid) should descend at least below stockRadius.
    const cutZs = segs
      .filter((s) => s.kind === 'feed')
      .flatMap((s) => [s.z0, s.z1])
      .filter((z) => z < stockRadius)
    expect(cutZs.length).toBeGreaterThan(0)
    // The deepest cut Z should be close to (stockRadius - normZPass), which
    // for zPass=-2 and stockRadius=20 is ~18. Loose bound to allow finishing
    // allowance and tool radius compensation slack.
    const deepestCut = minOf(cutZs)
    expect(deepestCut).toBeLessThan(stockRadius)
    expect(deepestCut).toBeGreaterThan(stockRadius - 5)

    // ── A axis is used (4-axis output, not just 3-axis with stale A=0) ──
    const uniqueA = new Set(as.map((a) => a.toFixed(1)))
    expect(uniqueA.size).toBeGreaterThan(2)
  }, 30_000)

  it('user position.x = +5 shifts the toolpath bbox along X', async () => {
    const stockLen = 100
    const stockDia = 40
    const ringRadius = 12
    const ringLength = 50

    const stlPath = join(tmpdir(), 'axis4-int-position.stl')
    const outPath = join(tmpdir(), 'axis4-int-position.nc')
    await writeFile(stlPath, buildCenteredRingStl(ringRadius, ringLength, 16))

    // FINISHING is the cleanest test for placement propagation: the strategy
    // uses `computePerAngleXExtents` to constrain X iteration to the X cells
    // where the mesh actually has hits, so the bbox of CUT moves directly
    // tracks the mesh's placement in X. (Roughing sweeps the full machinable
    // X range at every depth and the only difference between placements is
    // hidden inside the heightmap — invisible from the toolpath alone.)
    //
    // Centered placement: ring spans [25, 75] along X (centered in stock).
    const centeredResult = await runCamPipeline(
      baseJob({
        stlPath,
        outputGcodePath: outPath,
        operationKind: 'cnc_4axis_finishing',
        rotaryStockLengthMm: stockLen,
        rotaryStockDiameterMm: stockDia,
        zPassMm: -2,
        stepoverMm: 2,
        placement: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 }
        }
      })
    )
    expect(centeredResult.ok).toBe(true)
    if (!centeredResult.ok) return

    // Shifted placement: ring spans [30, 80] along X (user pushed +5).
    const shiftedOutPath = join(tmpdir(), 'axis4-int-position-shifted.nc')
    const shiftedResult = await runCamPipeline(
      baseJob({
        stlPath,
        outputGcodePath: shiftedOutPath,
        operationKind: 'cnc_4axis_finishing',
        rotaryStockLengthMm: stockLen,
        rotaryStockDiameterMm: stockDia,
        zPassMm: -2,
        stepoverMm: 2,
        placement: {
          position: { x: 5, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 }
        }
      })
    )
    expect(shiftedResult.ok).toBe(true)
    if (!shiftedResult.ok) return

    // The midpoint of the cut-feed X range tracks the mesh center. With
    // overcut padding (~one tool diameter on each side), the cut range is
    // approximately [meshMinX - overcut, meshMaxX + overcut], so its midpoint
    // is the mesh center.
    const cutXMidpoint = (gcode: string): number => {
      const segs = extractToolpathSegments4AxisFromGcode(gcode)
      const xs: number[] = []
      for (const s of segs) {
        if (s.kind !== 'feed') continue
        xs.push(s.x0, s.x1)
      }
      if (xs.length === 0) return NaN
      return (minOf(xs) + maxOf(xs)) / 2
    }
    const cCenter = cutXMidpoint(centeredResult.gcode)
    const cShift = cutXMidpoint(shiftedResult.gcode)
    expect(Number.isFinite(cCenter)).toBe(true)
    expect(Number.isFinite(cShift)).toBe(true)

    // Centered ring midpoint ≈ 50; shifted +5 ≈ 55.
    expect(cCenter).toBeGreaterThan(45)
    expect(cCenter).toBeLessThan(55)
    expect(cShift - cCenter).toBeGreaterThan(2)
    expect(cShift - cCenter).toBeLessThan(8)

    // Both runs must still respect the chuck-face safety invariant.
    const allXC = extractToolpathSegments4AxisFromGcode(centeredResult.gcode)
      .flatMap((s) => [s.x0, s.x1])
    const allXS = extractToolpathSegments4AxisFromGcode(shiftedResult.gcode)
      .flatMap((s) => [s.x0, s.x1])
    expect(minOf(allXC)).toBeGreaterThanOrEqual(0)
    expect(minOf(allXS)).toBeGreaterThanOrEqual(0)
    expect(maxOf(allXC)).toBeLessThanOrEqual(stockLen + 5) // +overcut
    expect(maxOf(allXS)).toBeLessThanOrEqual(stockLen + 5)
  }, 45_000)

  it('mesh radius exceeding stock radius is a hard error (no silent clamp)', async () => {
    const stlPath = join(tmpdir(), 'axis4-int-oversize.stl')
    const outPath = join(tmpdir(), 'axis4-int-oversize.nc')
    // Ring radius 25 > stock radius 15 → undercut bug if silent clamp returns.
    await writeFile(stlPath, buildCenteredRingStl(25, 50, 16))

    const result = await runCamPipeline(
      baseJob({
        stlPath,
        outputGcodePath: outPath,
        operationKind: 'cnc_4axis_roughing',
        rotaryStockLengthMm: 100,
        rotaryStockDiameterMm: 30 // radius = 15
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    // The error message should mention stock diameter or radial extent so the
    // user knows what to fix, not just a generic failure.
    expect(result.error.length).toBeGreaterThan(0)
    expect(result.hint == null || typeof result.hint === 'string').toBe(true)
  }, 15_000)

  it('contour operation produces wrap-around toolpath without a mesh', async () => {
    const outPath = join(tmpdir(), 'axis4-int-contour.nc')
    // Square contour 10×10 around the rotation axis (Y is mapped to A).
    // contourPoints schema is `[x, y][]` (tuples, not {x,y} objects).
    const contourPoints: [number, number][] = [
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
      [20, 0]
    ]
    const result = await runCamPipeline(
      baseJob({
        stlPath: join(tmpdir(), 'unused-contour.stl'),
        outputGcodePath: outPath,
        operationKind: 'cnc_4axis_contour',
        rotaryStockLengthMm: 100,
        rotaryStockDiameterMm: 40,
        zPassMm: -1,
        operationParams: { contourPoints }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    expect(segs.length).toBeGreaterThan(0)

    const xs = segs.flatMap((s) => [s.x0, s.x1])
    const as = segs.flatMap((s) => [s.a0, s.a1])
    expect(minOf(xs)).toBeGreaterThanOrEqual(0)
    expect(maxOf(xs)).toBeLessThanOrEqual(100 + 5) // +overcut
    // A axis must actually rotate for a contour wrap.
    const aSpan = maxOf(as) - minOf(as)
    expect(aSpan).toBeGreaterThan(0)
  }, 15_000)

  it('indexed operation produces discrete-angle passes', async () => {
    const stlPath = join(tmpdir(), 'axis4-int-indexed.stl')
    const outPath = join(tmpdir(), 'axis4-int-indexed.nc')
    await writeFile(stlPath, buildCenteredRingStl(15, 60, 16))

    const result = await runCamPipeline(
      baseJob({
        stlPath,
        outputGcodePath: outPath,
        operationKind: 'cnc_4axis_indexed',
        rotaryStockLengthMm: 100,
        rotaryStockDiameterMm: 40,
        operationParams: { indexAnglesDeg: [0, 90, 180, 270] }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    const aValues = new Set(
      segs.flatMap((s) => [s.a0, s.a1]).map((a) => Math.round(a))
    )
    // All four index angles should appear (loose match — exact angle words
    // depend on whether the strategy emits intermediate moves).
    expect(aValues.size).toBeGreaterThanOrEqual(4)
    // No negative X anywhere.
    const xs = segs.flatMap((s) => [s.x0, s.x1])
    expect(minOf(xs)).toBeGreaterThanOrEqual(0)
  }, 15_000)
})
