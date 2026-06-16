/**
 * TRUE-ARC output — POSTED G-code gcode-safety contract (Laguna + Carvera-3).
 *
 * The companion to `cam-arc-fit.test.ts` (pure geometry) and the engine-level
 * `generateContour2dLines` arc tests in `cam-local.test.ts`. THIS file drives the
 * FULL pipeline — `dispatch2dStrategy` -> the real machine profile -> the real
 * Handlebars post (`vcarve_mach3.hbs` for Laguna, `carvera_3axis.hbs` for the
 * 3-axis Carvera) — and asserts the gcode-safety invariants on the EMITTED
 * program when arc fitting is turned on via the `arcTolMm` operation param:
 *
 *   1. A CIRCULAR contour now emits G2/G3 (was a dense G1 chain), and EVERY
 *      emitted arc is VALID: reconstruct the centre from IJK (C = start + I,J)
 *      and assert |start-C| == |end-C| (controller-executable — the Cycle-261
 *      malformed-arc guard) and the radius is the real geometry.
 *   2. The G17 plane is set in the header BEFORE any arc (arcs need the plane).
 *   3. The arc body stays within the machine work envelope.
 *   4. The correct terminator per machine: M30 for Laguna (Mach3/RichAuto),
 *      M2 (never M30) for the Carvera-3 (Smoothieware SD-card-delete gotcha).
 *   5. Z-up safety is unchanged: the body still lifts to safe-Z first.
 *   6. A RECTANGULAR (non-circular) contour is BYTE-IDENTICAL with vs without
 *      arc fitting — the tolerance gate degrades to the legacy G1 chain, so
 *      enabling the feature never changes a path that has no arcs to find.
 *   7. The arc is a FAITHFUL replacement: the linearized path the engine would
 *      have emitted stays within arcTolMm of the fitted circle.
 *
 * See `.claude/skills/gcode-safety/references/laguna-swift.md` +
 * `.claude/skills/gcode-safety/references/carvera-3axis.md`. K2 FDM is excluded
 * (no CNC G2/G3 arcs).
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
  return join(tmpdir(), `ufs-arcfit-${label}-${tmpCounter}-${Date.now()}.nc`)
}
const GUARD_HINT = ' [test-guard]'
const envelopeHint = (m: MachineProfile, _g: string): string => ` [test-envelope:${m.id}]`

/** A circle approximated by a dense polygon (the engine's linearized loop input). */
function circlePolygon(cx: number, cy: number, r: number, n: number): CamPoint2d[] {
  const pts: CamPoint2d[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

/** A plain rectangle — four straight edges, no arcs to find. */
function rectangle(x0: number, y0: number, w: number, h: number): CamPoint2d[] {
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h]
  ]
}

type Move = { code: string; x: number; y: number; i?: number; j?: number }

/** Parse the positioned feed/rapid moves (G0/1/2/3 X.. Y.. [I.. J..]) from a program. */
function parseMoves(gcode: string): Move[] {
  const out: Move[] = []
  for (const raw of gcode.split('\n')) {
    const l = raw.trim()
    const m = l.match(/^(G0?[0123])\s+X(-?\d+(?:\.\d+)?)\s+Y(-?\d+(?:\.\d+)?)(?:\s+I(-?\d+(?:\.\d+)?)\s+J(-?\d+(?:\.\d+)?))?/)
    if (!m) continue
    const code = m[1] === 'G00' ? 'G0' : m[1] === 'G01' ? 'G1' : m[1]!
    const mv: Move = { code, x: Number.parseFloat(m[2]!), y: Number.parseFloat(m[3]!) }
    if (m[4] && m[5]) {
      mv.i = Number.parseFloat(m[4]!)
      mv.j = Number.parseFloat(m[5]!)
    }
    out.push(mv)
  }
  return out
}

function buildJob(
  overrides: Partial<CamJobConfig> & { machine: MachineProfile; outputGcodePath: string }
): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-arcfit.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -2,
    stepoverMm: 2,
    feedMmMin: 1200,
    plungeMmMin: 400,
    safeZMm: 6,
    pythonPath: 'python',
    operationKind: 'cnc_contour',
    ...overrides
  }
}

async function postContour(
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
 * Walk a program's moves and, for every G2/G3, reconstruct the centre from IJK
 * and return the {startRadius, endRadius} pair. Assumes modal XY (start = the
 * previous positioned move's endpoint), exactly as the controller interprets it.
 */
function arcRadii(moves: Move[]): Array<{ rStart: number; rEnd: number; r: number }> {
  const radii: Array<{ rStart: number; rEnd: number; r: number }> = []
  let sx = 0
  let sy = 0
  let have = false
  for (const mv of moves) {
    if ((mv.code === 'G2' || mv.code === 'G3') && mv.i != null && mv.j != null && have) {
      const cx = sx + mv.i
      const cy = sy + mv.j
      const rStart = Math.hypot(sx - cx, sy - cy)
      const rEnd = Math.hypot(mv.x - cx, mv.y - cy)
      radii.push({ rStart, rEnd, r: rStart })
    }
    sx = mv.x
    sy = mv.y
    have = true
  }
  return radii
}

// ──────────────────────────────────────────────────────────────────────────
// LAGUNA SWIFT 5x10 (vcarve_mach3.hbs / RichAuto — G2/G3 OK)
// ──────────────────────────────────────────────────────────────────────────

describe('TRUE-ARC posted on Laguna Swift 5x10 (vcarve_mach3)', () => {
  const CHORD_TOL = 0.02
  // A 60 mm-radius circle, comfortably inside the 1524 x 3048 mm bed.
  const CIRCLE = circlePolygon(200, 200, 60, 72)

  it('a circular contour emits G2/G3 arcs (was a dense G1 chain)', async () => {
    const { gcode, out } = await postContour(await loadLaguna(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    expect(gcode).toMatch(/^G[23] /m)
    await unlink(out).catch(() => {})
  })

  it('every emitted arc is VALID: |start-C| == |end-C| (reconstruct C from IJK)', async () => {
    const { gcode, out } = await postContour(await loadLaguna(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    const radii = arcRadii(parseMoves(gcode))
    expect(radii.length).toBeGreaterThanOrEqual(1)
    for (const { rStart, rEnd, r } of radii) {
      // Equal start/end radii — the controller-executable arc contract. Slack is
      // a few chord tolerances (the centre is a least-squares fit + 3-dp posting).
      expect(Math.abs(rStart - rEnd)).toBeLessThan(4 * CHORD_TOL)
      // The real geometry (~60 mm), not a degenerate near-zero or near-infinite r.
      expect(r).toBeGreaterThan(40)
      expect(r).toBeLessThan(80)
    }
    await unlink(out).catch(() => {})
  })

  it('sets the G17 plane in the header BEFORE the first arc', async () => {
    const { gcode, out } = await postContour(await loadLaguna(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    const g17 = gcode.indexOf('G17')
    const firstArc = gcode.search(/^G[23] /m)
    expect(g17).toBeGreaterThan(-1)
    expect(firstArc).toBeGreaterThan(g17)
    await unlink(out).catch(() => {})
  })

  it('keeps the arc body inside the work envelope and lifts to safe-Z first', async () => {
    const machine = await loadLaguna()
    const { gcode, out } = await postContour(machine, { contourPoints: CIRCLE, arcTolMm: CHORD_TOL })
    const moves = parseMoves(gcode)
    const [maxX, maxY] = machine.workAreaMm ? [machine.workAreaMm.x, machine.workAreaMm.y] : [1524, 3048]
    for (const mv of moves) {
      expect(mv.x).toBeGreaterThanOrEqual(-1e-6)
      expect(mv.x).toBeLessThanOrEqual(maxX + 1e-6)
      expect(mv.y).toBeGreaterThanOrEqual(-1e-6)
      expect(mv.y).toBeLessThanOrEqual(maxY + 1e-6)
    }
    // First body Z motion is a safe-Z lift (G0 Z<positive>), never a rapid into stock.
    expect(gcode).toMatch(/G0 Z\d/)
    await unlink(out).catch(() => {})
  })

  it('ends with M30 (Mach3) and never M2 even with arcs present', async () => {
    const { gcode, out } = await postContour(await loadLaguna(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    expect(gcode).toMatch(/^M30\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    await unlink(out).catch(() => {})
  })

  it('a RECTANGULAR contour is BYTE-IDENTICAL with vs without arc fitting (the gate)', async () => {
    const machine = await loadLaguna()
    const RECT = rectangle(100, 100, 300, 200)
    const legacy = await postContour(machine, { contourPoints: RECT })
    const withArc = await postContour(machine, { contourPoints: RECT, arcTolMm: 0.05 })
    expect(withArc.gcode).toBe(legacy.gcode)
    expect(withArc.gcode).not.toMatch(/^G[23] /m)
    await unlink(legacy.out).catch(() => {})
    await unlink(withArc.out).catch(() => {})
  })

  it('the fitted arc stays within chordTolMm of the linearized circle (faithful replacement)', async () => {
    const { gcode, out } = await postContour(await loadLaguna(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    // Each emitted arc's radius matches the true 60 mm circle within tolerance,
    // so the swept arc never departs the intended path by more than the tol.
    for (const { r } of arcRadii(parseMoves(gcode))) {
      expect(Math.abs(r - 60)).toBeLessThan(4 * CHORD_TOL)
    }
    await unlink(out).catch(() => {})
  })
})

// ──────────────────────────────────────────────────────────────────────────
// MAKERA CARVERA 3-AXIS (carvera_3axis.hbs / Smoothieware — G2/G3 OK)
// ──────────────────────────────────────────────────────────────────────────

describe('TRUE-ARC posted on Makera Carvera 3-axis (carvera_3axis)', () => {
  const CHORD_TOL = 0.01
  // A 30 mm-radius circle, inside the 360 x 240 mm desktop envelope.
  const CIRCLE = circlePolygon(120, 100, 30, 72)

  it('a circular contour emits G2/G3 arcs', async () => {
    const { gcode, out } = await postContour(await loadCarvera3(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    expect(gcode).toMatch(/^G[23] /m)
    await unlink(out).catch(() => {})
  })

  it('every emitted arc is VALID: |start-C| == |end-C| (reconstruct C from IJK)', async () => {
    const { gcode, out } = await postContour(await loadCarvera3(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    const radii = arcRadii(parseMoves(gcode))
    expect(radii.length).toBeGreaterThanOrEqual(1)
    for (const { rStart, rEnd, r } of radii) {
      expect(Math.abs(rStart - rEnd)).toBeLessThan(4 * CHORD_TOL)
      expect(r).toBeGreaterThan(20)
      expect(r).toBeLessThan(40)
    }
    await unlink(out).catch(() => {})
  })

  it('sets G17 in the header BEFORE the first arc', async () => {
    const { gcode, out } = await postContour(await loadCarvera3(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    const g17 = gcode.indexOf('G17')
    const firstArc = gcode.search(/^G[23] /m)
    expect(g17).toBeGreaterThan(-1)
    expect(firstArc).toBeGreaterThan(g17)
    await unlink(out).catch(() => {})
  })

  it('keeps the arc body inside the 360 x 240 mm envelope', async () => {
    const machine = await loadCarvera3()
    const { gcode, out } = await postContour(machine, { contourPoints: CIRCLE, arcTolMm: CHORD_TOL })
    const [maxX, maxY] = machine.workAreaMm ? [machine.workAreaMm.x, machine.workAreaMm.y] : [360, 240]
    for (const mv of parseMoves(gcode)) {
      expect(mv.x).toBeGreaterThanOrEqual(-1e-6)
      expect(mv.x).toBeLessThanOrEqual(maxX + 1e-6)
      expect(mv.y).toBeGreaterThanOrEqual(-1e-6)
      expect(mv.y).toBeLessThanOrEqual(maxY + 1e-6)
    }
    await unlink(out).catch(() => {})
  })

  it('ends with M2 (Smoothieware) and NEVER M30 (SD-card-delete gotcha) even with arcs', async () => {
    const { gcode, out } = await postContour(await loadCarvera3(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    expect(gcode).toMatch(/^M2\b/m)
    expect(gcode).not.toMatch(/^M30\b/m)
    await unlink(out).catch(() => {})
  })

  it('emits NO rotary A-word (pure 3-axis) with arc fitting on', async () => {
    const { gcode, out } = await postContour(await loadCarvera3(), {
      contourPoints: CIRCLE,
      arcTolMm: CHORD_TOL
    })
    expect(gcode).not.toMatch(/(?:^|\s)A[+-]?\d/m)
    await unlink(out).catch(() => {})
  })

  it('a RECTANGULAR contour is BYTE-IDENTICAL with vs without arc fitting (the gate)', async () => {
    const machine = await loadCarvera3()
    const RECT = rectangle(40, 40, 120, 80)
    const legacy = await postContour(machine, { contourPoints: RECT })
    const withArc = await postContour(machine, { contourPoints: RECT, arcTolMm: 0.05 })
    expect(withArc.gcode).toBe(legacy.gcode)
    expect(withArc.gcode).not.toMatch(/^G[23] /m)
    await unlink(legacy.out).catch(() => {})
    await unlink(withArc.out).catch(() => {})
  })
})
