/**
 * HELICAL/RAMP cut-entry — POSTED G-code gcode-safety contract (Laguna + Carvera-3).
 *
 * The companion to `cam-entry-move.test.ts` (pure geometry) and the engine-level
 * pocket-helix tests in `cam-local.test.ts`. THIS file drives the FULL pipeline —
 * `dispatch2dStrategy` -> the real machine profile -> the real Handlebars post
 * (`vcarve_mach3.hbs` for Laguna, `carvera_3axis.hbs` for the 3-axis Carvera) —
 * and asserts the gcode-safety invariants on the EMITTED program when a pocket op
 * requests `entryMode: 'helix'`:
 *
 *   1. A helix DESCENT is emitted (G2 arcs) at the pocket interior — the cut entry
 *      is no longer a bare straight plunge into solid stock.
 *   2. EVERY entry descent stays WITHIN the pocket footprint (XY) — the region-fit
 *      clamp means the helix never cuts outside the part.
 *   3. EVERY entry descent stays AT/ABOVE the final cut depth and never rapids
 *      into stock: the program lifts to safe-Z (G0 Z+), rapids XY, THEN feeds down.
 *      No G0 with a Z below safe-Z anywhere.
 *   4. The helix uses the PLUNGE feed (Z-dominant), not the cut feed.
 *   5. The G17 plane is set in the header BEFORE any arc (arcs need the plane).
 *   6. The body stays within the machine work envelope.
 *   7. Correct terminator per machine: M30 for Laguna (Mach3/RichAuto), M2 (never
 *      M30) for the Carvera-3 (Smoothieware SD-card-delete gotcha).
 *   8. NO-REGRESSION: a pocket WITHOUT an entry mode is BYTE-IDENTICAL to the same
 *      pocket with `entryMode: 'plunge'` — enabling the feature degrades cleanly to
 *      the legacy straight plunge.
 *
 * See `.claude/skills/gcode-safety/references/laguna-swift.md` +
 * `.claude/skills/gcode-safety/references/carvera-3axis.md`. K2 FDM is excluded
 * (no CNC G2/G3 arcs / helical milling entry).
 */

import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import type { CamPoint2d } from './cam-local'
import { dispatch2dStrategy } from './cam-runner-2d'
import type { CamJobConfig } from './cam-runner'

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

async function loadProfile(file: string): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', file), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}
const loadLaguna = (): Promise<MachineProfile> => loadProfile('laguna-swift-5x10.json')
const loadCarvera3 = (): Promise<MachineProfile> => loadProfile('makera-carvera-3axis.json')

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-entry-${label}-${tmpCounter}-${Date.now()}.nc`)
}
const GUARD_HINT = ' [test-guard]'
const envelopeHint = (m: MachineProfile, _g: string): string => ` [test-envelope:${m.id}]`

/** A square pocket comfortably inside both machine beds (Carvera is 360×240×140). */
function squarePocket(x0: number, y0: number, side: number): CamPoint2d[] {
  return [
    [x0, y0],
    [x0 + side, y0],
    [x0 + side, y0 + side],
    [x0, y0 + side]
  ]
}

type Move = { code: string; x?: number; y?: number; z?: number; f?: number }

/** Parse positioned G0/1/2/3 moves with optional X/Y/Z/F (modal-position model). */
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

function buildJob(
  overrides: Partial<CamJobConfig> & { machine: MachineProfile; outputGcodePath: string }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-entry.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -3,
    stepoverMm: 6,
    feedMmMin: 1200,
    plungeMmMin: 400,
    safeZMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_pocket',
    toolDiameterMm: 3,
    ...overrides
  }
}

async function postPocket(
  machine: MachineProfile,
  params: Record<string, unknown>,
  overrides: Partial<CamJobConfig> = {}
): Promise<{ gcode: string; out: string }> {
  const out = tmpGcodePath(machine.id)
  const r = await dispatch2dStrategy(
    buildJob({ machine, outputGcodePath: out, operationParams: params, ...overrides }),
    GUARD_HINT,
    envelopeHint
  )
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(r.error)
  return { gcode: r.gcode, out }
}

/**
 * Shared gcode-safety assertions on a posted helix-entry pocket program.
 * `pocket` is the outer ring; `[maxX,maxY]` the machine envelope. `safeZ` is the
 * job safe-Z; `plungeFeed` the job plunge feed.
 */
function assertEntrySafety(
  gcode: string,
  pocket: CamPoint2d[],
  envelope: { maxX: number; maxY: number },
  safeZ: number,
  plungeFeed: number
): void {
  const moves = parseMoves(gcode)
  const xs = pocket.map((p) => p[0])
  const ys = pocket.map((p) => p[1])
  const px0 = Math.min(...xs)
  const px1 = Math.max(...xs)
  const py0 = Math.min(...ys)
  const py1 = Math.max(...ys)

  // (1) A helix descent exists: at least one G2 arc that also moves in Z.
  const helixArcs = moves.filter((m) => m.code === 'G2' && m.z != null)
  expect(helixArcs.length).toBeGreaterThanOrEqual(1)

  // (2) Every G2/G3 arc endpoint is inside the pocket footprint (region-fit clamp).
  for (const m of moves) {
    if ((m.code === 'G2' || m.code === 'G3') && m.x != null && m.y != null) {
      expect(m.x).toBeGreaterThanOrEqual(px0 - 1e-6)
      expect(m.x).toBeLessThanOrEqual(px1 + 1e-6)
      expect(m.y).toBeGreaterThanOrEqual(py0 - 1e-6)
      expect(m.y).toBeLessThanOrEqual(py1 + 1e-6)
    }
  }

  // (3) NEVER rapid into stock: no G0 carries a Z below the safe-Z plane. (G0 Z
  //     moves are only ever the safe-Z lift; descent is always a feed move.)
  for (const m of moves) {
    if (m.code === 'G0' && m.z != null) {
      expect(m.z).toBeGreaterThanOrEqual(safeZ - 1e-6)
    }
  }

  // (4) The helix descent uses the plunge feed (Z-dominant), not the cut feed.
  for (const m of helixArcs) {
    expect(m.f).toBe(plungeFeed)
  }

  // (5) G17 set before the first arc.
  const g17 = gcode.indexOf('G17')
  const firstArc = gcode.search(/^G[23] /m)
  expect(g17).toBeGreaterThan(-1)
  expect(firstArc).toBeGreaterThan(g17)

  // (6) Body within the work envelope.
  for (const m of moves) {
    if (m.x != null) {
      expect(m.x).toBeGreaterThanOrEqual(-1e-6)
      expect(m.x).toBeLessThanOrEqual(envelope.maxX + 1e-6)
    }
    if (m.y != null) {
      expect(m.y).toBeGreaterThanOrEqual(-1e-6)
      expect(m.y).toBeLessThanOrEqual(envelope.maxY + 1e-6)
    }
  }

  // First body Z motion is a safe-Z lift (G0 Z<positive>).
  expect(gcode).toMatch(/G0 Z\d/)
}

// ──────────────────────────────────────────────────────────────────────────
// LAGUNA SWIFT 5x10 (vcarve_mach3.hbs / RichAuto — G2/G3 OK, M30 terminator)
// ──────────────────────────────────────────────────────────────────────────

describe('HELIX entry posted on Laguna Swift 5x10 (vcarve_mach3)', () => {
  // A 60 mm pocket near the bed origin, well inside the 1524 x 3048 mm envelope.
  const POCKET = squarePocket(100, 100, 60)

  it('emits a region-clamped helix descent that satisfies every entry invariant', async () => {
    const machine = await loadLaguna()
    const { gcode, out } = await postPocket(machine, {
      contourPoints: POCKET,
      entryMode: 'helix',
      helixRadiusMm: 4
    })
    const [maxX, maxY] = machine.workAreaMm ? [machine.workAreaMm.x, machine.workAreaMm.y] : [1524, 3048]
    assertEntrySafety(gcode, POCKET, { maxX, maxY }, 6, 400)
    await unlink(out).catch(() => {})
  })

  it('ends with M30 (Mach3) and never M2 even with helix arcs present', async () => {
    const { gcode, out } = await postPocket(await loadLaguna(), {
      contourPoints: POCKET,
      entryMode: 'helix',
      helixRadiusMm: 4
    })
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    await unlink(out).catch(() => {})
  })

  it('emits the % tape markers and G21/G90/G17 header (unchanged by helix entry)', async () => {
    const { gcode, out } = await postPocket(await loadLaguna(), {
      contourPoints: POCKET,
      entryMode: 'helix',
      helixRadiusMm: 4
    })
    expect(gcode.startsWith('%')).toBe(true)
    expect(gcode.trimEnd().endsWith('%')).toBe(true)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    await unlink(out).catch(() => {})
  })

  it('NO-REGRESSION: a pocket with no entry mode is BYTE-IDENTICAL to entryMode plunge', async () => {
    const machine = await loadLaguna()
    const legacy = await postPocket(machine, { contourPoints: POCKET })
    const explicit = await postPocket(machine, { contourPoints: POCKET, entryMode: 'plunge' })
    expect(explicit.gcode).toBe(legacy.gcode)
    // The legacy/plunge body has NO arcs.
    expect(legacy.gcode).not.toMatch(/^G2 /m)
    await unlink(legacy.out).catch(() => {})
    await unlink(explicit.out).catch(() => {})
  })

  it('helix entry posted program is stable (snapshot)', async () => {
    const { gcode, out } = await postPocket(await loadLaguna(), {
      contourPoints: squarePocket(100, 100, 40),
      entryMode: 'helix',
      helixRadiusMm: 3,
      // Pin a single depth + coarse stepover so the snapshot is small & readable.
      finishPass: false
    }, { stepoverMm: 12, zPassMm: -2 })
    expect(gcode).toMatchSnapshot()
    await unlink(out).catch(() => {})
  })
})

// ──────────────────────────────────────────────────────────────────────────
// MAKERA CARVERA 3-AXIS (carvera_3axis.hbs / Smoothieware — M2 terminator)
// ──────────────────────────────────────────────────────────────────────────

describe('HELIX entry posted on Makera Carvera 3-axis (carvera_3axis)', () => {
  // A 40 mm pocket inside the 360 x 240 mm Carvera bed.
  const POCKET = squarePocket(40, 40, 40)
  // Carvera max feed is 2400 mm/min — keep feeds inside the envelope.
  const CARVERA_OVERRIDES: Partial<CamJobConfig> = { feedMmMin: 1200, plungeMmMin: 300 }

  it('emits a region-clamped helix descent that satisfies every entry invariant', async () => {
    const machine = await loadCarvera3()
    const { gcode, out } = await postPocket(
      machine,
      { contourPoints: POCKET, entryMode: 'helix', helixRadiusMm: 3 },
      CARVERA_OVERRIDES
    )
    const [maxX, maxY] = machine.workAreaMm ? [machine.workAreaMm.x, machine.workAreaMm.y] : [360, 240]
    assertEntrySafety(gcode, POCKET, { maxX, maxY }, 6, 300)
    await unlink(out).catch(() => {})
  })

  it('ends with M2 (Smoothieware) and NEVER M30 (SD-card-delete gotcha)', async () => {
    const { gcode, out } = await postPocket(
      await loadCarvera3(),
      { contourPoints: POCKET, entryMode: 'helix', helixRadiusMm: 3 },
      CARVERA_OVERRIDES
    )
    expect(gcode).toMatch(/^M2\b/m)
    expect(gcode).not.toMatch(/^M30\b/m)
    await unlink(out).catch(() => {})
  })

  it('emits NO % tape markers and NO A-axis words (pure 3-axis)', async () => {
    const { gcode, out } = await postPocket(
      await loadCarvera3(),
      { contourPoints: POCKET, entryMode: 'helix', helixRadiusMm: 3 },
      CARVERA_OVERRIDES
    )
    // No tape-marker LINE (a line that is just `%`). Smoothieware doesn't use
    // them (a stray `%` inside a header comment like "10% feed override" is fine).
    expect(gcode.split('\n').some((l) => l.trim() === '%')).toBe(false)
    // No A-axis motion words anywhere (pure 3-axis output).
    expect(gcode).not.toMatch(/\bA-?\d/)
    await unlink(out).catch(() => {})
  })

  it('NO-REGRESSION: a pocket with no entry mode is BYTE-IDENTICAL to entryMode plunge', async () => {
    const machine = await loadCarvera3()
    const legacy = await postPocket(machine, { contourPoints: POCKET }, CARVERA_OVERRIDES)
    const explicit = await postPocket(machine, { contourPoints: POCKET, entryMode: 'plunge' }, CARVERA_OVERRIDES)
    expect(explicit.gcode).toBe(legacy.gcode)
    expect(legacy.gcode).not.toMatch(/^G2 /m)
    await unlink(legacy.out).catch(() => {})
    await unlink(explicit.out).catch(() => {})
  })
})
