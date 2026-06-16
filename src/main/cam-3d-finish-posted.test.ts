/**
 * 3D FINISH (mesh-height raster) — POSTED G-code gcode-safety contract (Laguna + Carvera-3).
 *
 * The 3D surface-finish path that ACTUALLY runs on a shop machine is the built-in
 * mesh-height-field raster (`generateMeshHeightRasterLines`), reached whenever
 * OpenCAMLib is not installed (the common case on a fresh box). It follows the STL
 * upper envelope as an XY zigzag. `cam-runner-model-adherence.test.ts` proves it
 * FOLLOWS the surface; THIS file proves the EMITTED program is machine-SAFE once
 * posted through the real router posts:
 *   - Laguna Swift 5x10   -> vcarve_mach3.hbs   (Mach3/RichAuto: M30, `%` markers)
 *   - Makera Carvera 3ax  -> carvera_3axis.hbs  (Smoothieware: M2, no `%`, NEVER M30)
 *
 * Invariants asserted on the posted 3D-finish program (gcode-safety skill, Step 3):
 *   1. Explicit units + absolute mode + WCS in the header (G21, G90, G54).
 *   2. Spindle on (M3) with a post-on dwell (G4) before cutting; spindle off (M5) at end.
 *   3. NEVER rapids into stock: every G0 carrying a Z word is at/above safe-Z — the
 *      tool only descends under feed (G1). Each scanline lifts to safe-Z first.
 *   4. The path FOLLOWS the surface (apex Z > base-corner Z) — not a flat sweep.
 *   5. Body stays within the machine work envelope.
 *   6. Correct terminator per controller: M30 (Laguna) / M2-never-M30 (Carvera
 *      SD-card-delete gotcha); `%` tape markers for Laguna, none for Carvera.
 *   7. Stable snapshot of a small posted program.
 *
 * The built-in path is forced via a bogus `pythonPath` (mirrors
 * `cam-runner-model-adherence.test.ts`) so the OCL / advanced engines cannot run —
 * exactly the path users hit without OpenCAMLib installed. K2 FDM is excluded
 * (no CNC milling finish).
 *
 * See `.claude/skills/gcode-safety/references/laguna-swift.md` +
 * `.claude/skills/gcode-safety/references/carvera-3axis.md`.
 */

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { runCamPipeline } from './cam-runner'
import { extractToolpathSegmentsFromGcode } from '../shared/cam-gcode-toolpath'

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()
// A path that cannot resolve to a Python 3 interpreter — forces the OCL/advanced
// engines to fail so the pipeline falls back to the built-in mesh-height raster,
// which is the 3D-finish path real shop machines hit without OpenCAMLib.
const NO_PYTHON = '/no/such/python/ufscam-3dfinish-test'

async function loadProfile(file: string): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', file), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}
const loadLaguna = (): Promise<MachineProfile> => loadProfile('laguna-swift-5x10.json')
const loadCarvera3 = (): Promise<MachineProfile> => loadProfile('makera-carvera-3axis.json')

let tmpCounter = 0
function tmpPath(ext: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-3dfin-${process.pid}-${tmpCounter}.${ext}`)
}

/**
 * Square pyramid in the POSITIVE quadrant so every coordinate sits inside both
 * machine beds: base 20×20 from (10,10) to (30,30) at Z=0, apex (20,20,10).
 * Four slanted faces + two down-facing base triangles (so the upper envelope the
 * raster follows is the apex, not the base).
 */
function buildPyramidBinaryStl(): Buffer {
  const A: [number, number, number] = [10, 10, 0]
  const B: [number, number, number] = [30, 10, 0]
  const C: [number, number, number] = [30, 30, 0]
  const D: [number, number, number] = [10, 30, 0]
  const P: [number, number, number] = [20, 20, 10]
  const tris: [number, number, number][][] = [
    [A, B, P],
    [B, C, P],
    [C, D, P],
    [D, A, P],
    [B, A, D],
    [B, D, C]
  ]
  const header = Buffer.alloc(80, 0)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(tris.length, 0)
  const body = Buffer.alloc(50 * tris.length)
  let o = 0
  for (const tri of tris) {
    for (let i = 0; i < 3; i++) {
      body.writeFloatLE(0, o)
      o += 4
    }
    for (const [x, y, z] of tri) {
      body.writeFloatLE(x, o)
      o += 4
      body.writeFloatLE(y, o)
      o += 4
      body.writeFloatLE(z, o)
      o += 4
    }
    body.writeUInt16LE(0, o)
    o += 2
  }
  return Buffer.concat([header, count, body])
}

const SAFE_Z = 20

type PostedFinish = { gcode: string; cleanup: () => Promise<void> }

async function post3dFinish(
  machine: MachineProfile,
  opts: { operationKind?: string; stepoverMm?: number } = {}
): Promise<PostedFinish> {
  const stl = tmpPath('stl')
  const out = tmpPath('nc')
  await writeFile(stl, buildPyramidBinaryStl())
  const r = await runCamPipeline({
    stlPath: stl,
    outputGcodePath: out,
    machine,
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -2,
    stepoverMm: opts.stepoverMm ?? 2,
    feedMmMin: 800,
    plungeMmMin: 300,
    safeZMm: SAFE_Z,
    pythonPath: NO_PYTHON,
    operationKind: opts.operationKind ?? 'cnc_parallel',
    toolDiameterMm: 6
  })
  const cleanup = async (): Promise<void> => {
    await unlink(stl).catch(() => {})
    await unlink(out).catch(() => {})
  }
  if (!r.ok) {
    await cleanup()
    throw new Error(`3D-finish pipeline failed: ${r.error}`)
  }
  // The built-in mesh raster is the path under test — never the (absent) OCL engine.
  expect(r.usedEngine).toBe('builtin')
  return { gcode: r.gcode, cleanup }
}

type Move = { code: string; x?: number; y?: number; z?: number; f?: number }

function parseMoves(gcode: string): Move[] {
  const out: Move[] = []
  for (const raw of gcode.split('\n')) {
    const l = raw.trim()
    if (!/^G0?[0123]\b/.test(l)) continue
    const codeM = l.match(/^(G0?[0123])\b/)!
    const code = codeM[1] === 'G00' ? 'G0' : codeM[1] === 'G01' ? 'G1' : codeM[1]!
    const mv: Move = { code }
    const xm = l.match(/\bX(-?\d+(?:\.\d+)?)/)
    const ym = l.match(/\bY(-?\d+(?:\.\d+)?)/)
    const zm = l.match(/\bZ(-?\d+(?:\.\d+)?)/)
    const fm = l.match(/\bF(-?\d+(?:\.\d+)?)/)
    if (xm) mv.x = Number.parseFloat(xm[1]!)
    if (ym) mv.y = Number.parseFloat(ym[1]!)
    if (zm) mv.z = Number.parseFloat(zm[1]!)
    if (fm) mv.f = Number.parseFloat(fm[1]!)
    out.push(mv)
  }
  return out
}

/** Invariants every safe 3D-finish program must satisfy regardless of controller. */
function assertCommonFinishSafety(gcode: string, machine: MachineProfile): void {
  // (1) explicit units + absolute + WCS
  expect(gcode).toMatch(/\bG21\b/)
  expect(gcode).toMatch(/\bG90\b/)
  expect(gcode).toMatch(/\bG54\b/)
  // (2) spindle on with a dwell, and spindle off at the end
  expect(gcode).toMatch(/\bM3\b/)
  expect(gcode).toMatch(/\bM5\b/)
  expect(gcode).toMatch(/\bG4\b/)

  const moves = parseMoves(gcode)
  // (3) NEVER rapid into stock: every G0 that carries a Z word is at/above safe-Z.
  const rapidZ = moves.filter((m) => m.code === 'G0' && m.z != null)
  expect(rapidZ.length).toBeGreaterThan(0)
  for (const m of rapidZ) expect(m.z!).toBeGreaterThanOrEqual(SAFE_Z - 1e-6)

  // (4) surface-following: cuts near the apex (20,20) end higher than cuts near a
  // base corner (11,11) — proves Z tracks the mesh, not a flat bounds sweep.
  const feeds = extractToolpathSegmentsFromGcode(gcode).filter(
    (s) => s.kind === 'feed' && Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 0.1
  )
  expect(feeds.length).toBeGreaterThan(10)
  const near = (cx: number, cy: number, rad: number): number[] =>
    feeds.filter((s) => Math.hypot(s.x1 - cx, s.y1 - cy) < rad).map((s) => s.z1)
  const apex = near(20, 20, 2.5)
  const corner = near(11, 11, 2.5)
  expect(apex.length).toBeGreaterThan(0)
  expect(corner.length).toBeGreaterThan(0)
  expect(Math.max(...apex)).toBeGreaterThan(Math.max(...corner) + 2)

  // (5) body stays inside the work envelope (XY within the bed; the pyramid sits
  // at 10..30 mm so this is comfortably true and guards against a posting bug
  // that doubles or offsets coordinates off-bed).
  const cut = moves.filter((m) => m.x != null && m.y != null)
  for (const m of cut) {
    expect(m.x!).toBeGreaterThanOrEqual(0)
    expect(m.x!).toBeLessThanOrEqual(machine.workAreaMm.x)
    expect(m.y!).toBeGreaterThanOrEqual(0)
    expect(m.y!).toBeLessThanOrEqual(machine.workAreaMm.y)
  }
}

describe('3D finish (mesh-height raster) posted on Laguna Swift 5x10 (vcarve_mach3)', () => {
  it('emits a surface-following finish that satisfies every gcode-safety invariant', async () => {
    const machine = await loadLaguna()
    const { gcode, cleanup } = await post3dFinish(machine)
    try {
      assertCommonFinishSafety(gcode, machine)
      // Laguna / Mach3 / RichAuto specifics: M30 terminator + `%` tape markers.
      // Line-anchored \bM30\b / \bM2\b so the footer's "NOT M2" reminder comment
      // does not false-match.
      expect(/^\s*M30\b/m.test(gcode)).toBe(true)
      expect(/^\s*M2\b/m.test(gcode)).toBe(false)
      expect(/^\s*%\s*$/m.test(gcode)).toBe(true) // bare `%` tape-marker lines (RichAuto)
    } finally {
      await cleanup()
    }
  })

  it('cnc_3d_finish routes through the same safe mesh-raster fallback', async () => {
    const machine = await loadLaguna()
    const { gcode, cleanup } = await post3dFinish(machine, { operationKind: 'cnc_3d_finish' })
    try {
      assertCommonFinishSafety(gcode, machine)
      expect(/^\s*M30\b/m.test(gcode)).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('posted program is stable (snapshot, coarse stepover)', async () => {
    const machine = await loadLaguna()
    const { gcode, cleanup } = await post3dFinish(machine, { stepoverMm: 8 })
    try {
      expect(gcode).toMatchSnapshot()
    } finally {
      await cleanup()
    }
  })
})

describe('3D finish (mesh-height raster) posted on Makera Carvera 3-axis (carvera_3axis)', () => {
  it('emits a surface-following finish that satisfies every gcode-safety invariant', async () => {
    const machine = await loadCarvera3()
    const { gcode, cleanup } = await post3dFinish(machine)
    try {
      assertCommonFinishSafety(gcode, machine)
      // Carvera / Smoothieware specifics: M2 terminator, NEVER an M30 *command*
      // (SD-card delete). Line-anchored \bM2\b / \bM30\b so the post's own
      // "NOT M30" reminder comment + the trailing comment on the M2 line do not
      // false-match. No `%` tape markers.
      expect(/^\s*M2\b/m.test(gcode)).toBe(true)
      expect(/^\s*M30\b/m.test(gcode)).toBe(false)
      expect(/^\s*%\s*$/m.test(gcode)).toBe(false) // NO bare `%` tape-marker line (Smoothieware)
    } finally {
      await cleanup()
    }
  })

  it('cnc_3d_finish routes through the same safe mesh-raster fallback (M2, never M30)', async () => {
    const machine = await loadCarvera3()
    const { gcode, cleanup } = await post3dFinish(machine, { operationKind: 'cnc_3d_finish' })
    try {
      assertCommonFinishSafety(gcode, machine)
      expect(/^\s*M2\b/m.test(gcode)).toBe(true)
      expect(/^\s*M30\b/m.test(gcode)).toBe(false)
    } finally {
      await cleanup()
    }
  })

  it('cnc_waterline without OpenCAMLib degrades to a SAFE parallel finish (M2, surface-following)', async () => {
    // Real-world honesty: without OpenCAMLib installed there is no true Z-level
    // waterline engine, so the pipeline degrades cnc_waterline to the built-in
    // mesh-height parallel finish. That degraded path MUST still post safe,
    // surface-following, M2-terminated G-code (never silent garbage, never M30).
    const machine = await loadCarvera3()
    const { gcode, cleanup } = await post3dFinish(machine, { operationKind: 'cnc_waterline' })
    try {
      assertCommonFinishSafety(gcode, machine)
      expect(/^\s*M2\b/m.test(gcode)).toBe(true)
      expect(/^\s*M30\b/m.test(gcode)).toBe(false)
    } finally {
      await cleanup()
    }
  })
})
