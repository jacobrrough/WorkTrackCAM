/**
 * Regression test: CAM tool path must adhere to the model geometry.
 *
 * Bug history:
 *   Before this test, both the `cnc_parallel` default path and the OCL-fallback
 *   path for `cnc_waterline` / `cnc_adaptive` / `cnc_pencil` used
 *   `generateParallelFinishLines` — a single-Z bounds-only raster that produced
 *   flat rectangular sweeps over the STL bounding box at one Z height. This
 *   meant the tool path never followed the model surface, and users reported
 *   "the tool path does not adhere to the model".
 *
 * This test feeds a pyramid-shaped binary STL through `runCamPipeline` with
 * no Python and no OCL available, and asserts that the emitted feed moves have:
 *   1. More than one distinct Z value (the path is not flat)
 *   2. Z values that span a meaningful fraction of the mesh's actual Z extent
 *   3. Higher Z values near the apex than near the base corners
 *      (proves the path samples the mesh, not the bounding box)
 */
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { runCamPipeline } from './cam-runner'
import { extractToolpathSegmentsFromGcode } from '../shared/cam-gcode-toolpath'

const testMill: MachineProfile = {
  id: 'test-mill',
  name: 'Test mill',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

/**
 * Build a square-pyramid binary STL, base at Z=0 (20x20 square centered on
 * origin) and apex at (0, 0, 10). Six triangles: 4 slanted faces + 2 base
 * triangles.
 */
function buildPyramidBinaryStl(): Buffer {
  const verts: [number, number, number][][] = [
    // Four slanted faces (apex on top, CCW when viewed from outside)
    [[-10, -10, 0], [10, -10, 0], [0, 0, 10]], // south face
    [[10, -10, 0], [10, 10, 0], [0, 0, 10]],   // east face
    [[10, 10, 0], [-10, 10, 0], [0, 0, 10]],   // north face
    [[-10, 10, 0], [-10, -10, 0], [0, 0, 10]], // west face
    // Two base triangles (pointing down so the upper envelope is the apex, not the base)
    [[10, -10, 0], [-10, -10, 0], [-10, 10, 0]],
    [[10, -10, 0], [-10, 10, 0], [10, 10, 0]]
  ]
  const header = Buffer.alloc(80, 0)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(verts.length, 0)
  const tris = Buffer.alloc(50 * verts.length)
  let o = 0
  for (const tri of verts) {
    // Normal (zeros — parsers recompute from vertices anyway)
    for (let i = 0; i < 3; i++) {
      tris.writeFloatLE(0, o)
      o += 4
    }
    for (const [x, y, z] of tri) {
      tris.writeFloatLE(x, o); o += 4
      tris.writeFloatLE(y, o); o += 4
      tris.writeFloatLE(z, o); o += 4
    }
    tris.writeUInt16LE(0, o)
    o += 2
  }
  return Buffer.concat([header, count, tris])
}

describe('CAM model-adherence regression', () => {
  it('default Desert Sentinel asset: cnc_parallel produces a model-following tool path', async () => {
    // End-to-end check against the asset shipped as the default Manufacture
    // input — this is exactly the file the user sees when they click
    // Generate CAM on a fresh project, so if the fix regresses here, the
    // user's "doesn't adhere to the model" complaint is back.
    const stlPath = join(
      process.cwd(),
      'default',
      'assets',
      'Meshy_AI_Desert_Sentinel_0311134458_texture.stl'
    )
    const out = join(tmpdir(), `ufs-cam-desert-${process.pid}.nc`)
    try {
      const r = await runCamPipeline({
        stlPath,
        outputGcodePath: out,
        machine: testMill,
        resourcesRoot: join(process.cwd(), 'resources'),
        appRoot: process.cwd(),
        zPassMm: -2,
        stepoverMm: 3,
        feedMmMin: 800,
        plungeMmMin: 300,
        safeZMm: 20,
        pythonPath: '/no/such/python',
        operationKind: 'cnc_parallel'
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return

      const MIN_XY_MM = 0.1
      const xyFeeds = extractToolpathSegmentsFromGcode(r.gcode).filter((s) => {
        if (s.kind !== 'feed') return false
        return Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > MIN_XY_MM
      })
      const endZ = xyFeeds.map((s) => s.z1)
      const distinctZ = new Set(endZ.map((z) => z.toFixed(3)))
      const zMin = Math.min(...endZ)
      const zMax = Math.max(...endZ)
      // The Desert Sentinel is a statue-like mesh; expect a meaningful number
      // of cuts and many distinct cut heights with a real Z range. A flat
      // bounds-only raster would yield distinctZ.size === 1.
      expect(xyFeeds.length).toBeGreaterThan(30)
      expect(distinctZ.size).toBeGreaterThan(20)
      expect(zMax - zMin).toBeGreaterThan(5)
      // Informational: log a few stats so a developer eyeballing CI output
      // can confirm the shape is right without re-running the dev server.
      // eslint-disable-next-line no-console
      console.info(
        `[model-adherence] Desert Sentinel cnc_parallel — ${xyFeeds.length} XY feed moves, ` +
          `${distinctZ.size} distinct Z, range [${zMin.toFixed(2)} .. ${zMax.toFixed(2)}]`
      )
    } finally {
      const { unlink } = await import('node:fs/promises')
      await unlink(out).catch(() => {})
    }
  })

  it('cnc_parallel emits feed moves whose Z varies with the mesh surface', async () => {
    const p = join(tmpdir(), `ufs-cam-model-adh-${process.pid}.stl`)
    const out = join(tmpdir(), `ufs-cam-model-adh-${process.pid}.nc`)
    await writeFile(p, buildPyramidBinaryStl())
    try {
      const r = await runCamPipeline({
        stlPath: p,
        outputGcodePath: out,
        machine: testMill,
        resourcesRoot: join(process.cwd(), 'resources'),
        appRoot: process.cwd(),
        zPassMm: -2,
        stepoverMm: 2,
        feedMmMin: 800,
        plungeMmMin: 300,
        safeZMm: 20,
        // Deliberately bogus Python path so the advanced engine cannot run.
        // This forces the pipeline to use the built-in mesh-aware fallback,
        // which is exactly the path users hit on machines without Python.
        pythonPath: '/no/such/python/ufscam-test',
        operationKind: 'cnc_parallel'
      })

      expect(r.ok).toBe(true)
      if (!r.ok) return

      // Restrict to *XY cutting moves* (feed segments with meaningful XY
      // motion). Plunges (pure-Z feed) would carry the safe-Z start point and
      // pollute the Z range, so we exclude them here.
      const MIN_XY_MM = 0.1
      const xyFeeds = extractToolpathSegmentsFromGcode(r.gcode).filter((s) => {
        if (s.kind !== 'feed') return false
        return Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > MIN_XY_MM
      })
      expect(xyFeeds.length).toBeGreaterThan(10)

      // Collect endpoint Z values (z1 is the destination of each cutting move).
      const endZ = xyFeeds.map((s) => Number(s.z1.toFixed(3)))
      const distinctZ = new Set(endZ)
      // (1) The toolpath must not be flat — bounds-only raster would yield 1
      // distinct Z; a surface-following raster should yield many.
      expect(distinctZ.size).toBeGreaterThan(3)

      const zMin = Math.min(...endZ)
      const zMax = Math.max(...endZ)
      // (2) The Z range of the toolpath must cover at least half the mesh's
      // Z extent (0..10). Flat sweeps would give range ≈ 0.
      expect(zMax - zMin).toBeGreaterThan(5)

      // (3) The path must dip/rise with the mesh: cuts near the apex (0, 0)
      // should end at a higher Z than cuts near a base corner.
      const near = (cx: number, cy: number, radius: number): number[] => {
        const hits: number[] = []
        for (const s of xyFeeds) {
          if (Math.hypot(s.x1 - cx, s.y1 - cy) < radius) hits.push(s.z1)
        }
        return hits
      }
      const apexSamples = near(0, 0, 2)
      const cornerSamples = near(-9.5, -9.5, 2.5)
      expect(apexSamples.length).toBeGreaterThan(0)
      expect(cornerSamples.length).toBeGreaterThan(0)

      const maxAtApex = Math.max(...apexSamples)
      const maxAtCorner = Math.max(...cornerSamples)
      // The apex of a pyramid is higher than any corner. If the path follows
      // the mesh, the sampled Z near (0,0) must exceed the sampled Z near a
      // corner. A bounds-only raster would tie them (both equal to zPassMm).
      expect(maxAtApex).toBeGreaterThan(maxAtCorner + 2)
    } finally {
      await unlink(p).catch(() => {})
      await unlink(out).catch(() => {})
    }
  })
})
