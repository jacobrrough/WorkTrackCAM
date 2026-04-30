/**
 * arc-fitting-pin.test.ts -- [ID-0303] Cycle 230 post-processing paired-pin
 *
 * Pins the contract of `src/shared/arc-fitting.ts` -- the SHARED 336-line
 * arc-fitting module that converts a sequence of linear toolpath vertices
 * (G1 polyline) into a mixed `GCodeSegment[]` of G1 (linear) and G2/G3 (arc)
 * commands. Used DIRECTLY by `src/main/post-process.ts` (line 4 import) when
 * the active machine profile opts into arc fitting via `arcFitting.enabled`
 * and the operation is NOT one of the 4-axis rotary kinds (the Cycle 85
 * 4-axis bypass guarded by `post-process-arc-fitting-4axis-safety-contract`).
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): arc fitting MUST NOT
 *     apply to FDM pass-through. Today the FDM passthrough post template
 *     (`resources/posts/fdm_passthrough.hbs`) emits the slicer body
 *     verbatim and `post-process-k2-capabilities.test.ts` lines 243-... pin
 *     the "toolpath body survives unaltered (no arc-fitting / cutter-comp
 *     on pure passthrough)" invariant. THIS pin defends the pure-function
 *     contract that the upstream call-site relies on.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series, Mach3 superset):
 *     RichAuto natively understands G17 + G2/G3 with I/J center offsets.
 *     Group D pins that a CCW XY circle round-trips to a single `G3` with
 *     plane=`G17` and IJK offsets RELATIVE to the arc start point (NOT
 *     absolute), and that the arc end x/y match the polyline endpoint to
 *     numeric precision -- a regression class that would silently drive a
 *     full sheet of plywood off the rails on the 5x10 bed.
 *   - **Makera Carvera 3-axis** (Makera Controller): arc fitting reduces
 *     program size on the desktop ATC's slower controller pipeline. Group H
 *     pins the 1000x chord-length rejection rule that prevents pseudo-line
 *     polylines from ever being mis-fit as huge-radius arcs (a Carvera
 *     pendant lookahead would briefly stall on a 30-meter-radius arc -- the
 *     rejection rule keeps fits useful and short).
 *   - **Makera Carvera + 4-axis Rotary**: arc fitting is BYPASSED for all 5
 *     rotary kinds (cnc_4axis_roughing/finishing/contour/indexed/continuous)
 *     per Cycle 85 [ID-0064] safety. THIS pin file guards the SHARED-side
 *     pure-function contract; the bypass itself is pinned separately in
 *     `src/main/post-process-arc-fitting-4axis-safety-contract.test.ts` and
 *     `src/main/cam-axis4/runner-shims-pin.test.ts` (Cycle 228 [ID-0301]).
 *
 * The existing behavioral test (`arc-fitting.test.ts`, 374 lines) covers the
 * happy paths (full circle, semicircle, straight line, mixed). THIS pin file
 * additionally pins:
 *   (A) module shape -- exact 2 runtime exports + 2 type exports, function
 *       arities, types are exported with `export type` (not value),
 *   (B) `Point3D` shape -- 3 numeric fields x/y/z, no extras,
 *   (C) `GCodeSegment` discriminated union -- G1 has 4 fields, G2/G3 have 8
 *       fields including plane: 'G17' | 'G18' | 'G19',
 *   (D) `fitArcsToLinearPath` edge inputs -- empty/1-point returns [], zero
 *       and negative tolerance falls back to all-G1, 2-point returns 1 G1,
 *   (E) `fitArcsToLinearPath` arc directionality -- CCW XY -> G3, CW XY ->
 *       G2, IJK is INCREMENTAL (relative to arc start), arc end matches
 *       polyline endpoint to numeric precision,
 *   (F) plane detection -- XZ-only sweep -> G18, YZ-only sweep -> G19,
 *       XY-only sweep -> G17,
 *   (G) `generateCirclePoints` -- N+1 length (closed loop), CW vs CCW
 *       direction flag, default 2*PI sweep, helical Z is constant per call,
 *       full-circle endpoint matches start within numeric tolerance,
 *   (H) source-text whitelist -- ZERO imports, no `:any`/`as any`, no eval,
 *       no node:fs/path/child_process, key numeric constants present
 *       (1e-12 denom guard, 1e-6 radius floor, 1000x chord rule, 20-point
 *       lookahead window, i+2 minimum-arc gate),
 *   (I) three-machine cross-cut realism -- Laguna 5x10 contour radius,
 *       Carvera 3-axis bore radius, K2 Plus arc fitting NOT used on FDM
 *       passthrough body (covered by post-process-k2-capabilities), 4-axis
 *       rotary bypass guard reference,
 *   (J) type-level parity -- compile-time pin via TS expressions only.
 *
 * ZERO production-code edits. Pure additive paired-pin (mirrors Cycles 132 /
 * 199 / 215 / 228 / 229).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './arc-fitting'
import {
  fitArcsToLinearPath,
  generateCirclePoints,
  type GCodeSegment,
  type Point3D
} from './arc-fitting'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'arc-fitting.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// ──────────────────────────────────────────────────────────────────────────
// A. Module shape — exact runtime + type surface
// ──────────────────────────────────────────────────────────────────────────

describe('A. arc-fitting module shape', () => {
  it('exports exactly 2 runtime symbols (fitArcsToLinearPath + generateCirclePoints)', () => {
    const runtimeKeys = Object.keys(M).filter((k) => typeof (M as any)[k] !== 'undefined')
    runtimeKeys.sort()
    expect(runtimeKeys).toEqual(['fitArcsToLinearPath', 'generateCirclePoints'])
  })

  it('fitArcsToLinearPath is a function with arity 2 (points, tolerance)', () => {
    expect(typeof fitArcsToLinearPath).toBe('function')
    expect(fitArcsToLinearPath.length).toBe(2)
  })

  it('generateCirclePoints is a function with arity 5 (cx, cy, z, r, n; rest defaulted)', () => {
    // .length counts only the params before the first one with a default value.
    // Signature: (cx, cy, z, r, n, startAngle = 0, sweepAngle = 2*PI, ccw = true)
    // -> .length === 5
    expect(typeof generateCirclePoints).toBe('function')
    expect(generateCirclePoints.length).toBe(5)
  })

  it('Point3D and GCodeSegment are exported as TYPES only (not values)', () => {
    // Compile-time pin: if these flipped to value exports they'd land in
    // Object.keys(M) (caught by the 2-runtime-export pin above) and the
    // source-text would lose `export type ... =`.
    expect(SRC).toMatch(/export type Point3D =/)
    expect(SRC).toMatch(/export type GCodeSegment =/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// B. Point3D shape
// ──────────────────────────────────────────────────────────────────────────

describe('B. Point3D shape', () => {
  it('Point3D source declares exactly x, y, z numeric fields', () => {
    // The block between `export type Point3D = {` and the closing `}` must
    // contain x: number, y: number, z: number — no extras.
    const m = SRC.match(/export type Point3D = \{([^}]+)\}/)
    expect(m).not.toBeNull()
    const body = m![1]!
    expect(body).toMatch(/x:\s*number/)
    expect(body).toMatch(/y:\s*number/)
    expect(body).toMatch(/z:\s*number/)
    // No extra fields slipping in (e.g., w, t, label).
    const fieldLines = body.split('\n').filter((l) => /^\s*\w+:\s*number/.test(l))
    expect(fieldLines.length).toBe(3)
  })

  it('a literal Point3D round-trips through generateCirclePoints output', () => {
    const pts = generateCirclePoints(0, 0, 5, 1, 4)
    expect(pts.length).toBeGreaterThan(0)
    const p = pts[0]!
    expect(typeof p.x).toBe('number')
    expect(typeof p.y).toBe('number')
    expect(typeof p.z).toBe('number')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// C. GCodeSegment discriminated union shape
// ──────────────────────────────────────────────────────────────────────────

describe('C. GCodeSegment discriminated union', () => {
  it('source declares G1 variant with x/y/z only (no IJK, no plane)', () => {
    expect(SRC).toMatch(
      /\|\s*\{\s*type:\s*'G1';\s*x:\s*number;\s*y:\s*number;\s*z:\s*number\s*\}/
    )
  })

  it('source declares G2|G3 variant with x/y/z + i/j/k + plane', () => {
    expect(SRC).toMatch(
      /\|\s*\{\s*type:\s*'G2'\s*\|\s*'G3';\s*x:\s*number;\s*y:\s*number;\s*z:\s*number;\s*i:\s*number;\s*j:\s*number;\s*k:\s*number;\s*plane:\s*'G17'\s*\|\s*'G18'\s*\|\s*'G19'\s*\}/
    )
  })

  it('emitted G1 segment has exactly 4 fields (type, x, y, z)', () => {
    // Two collinear points -> exactly one G1 segment.
    const segs = fitArcsToLinearPath(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      0.01
    )
    expect(segs.length).toBe(1)
    const s = segs[0]!
    expect(s.type).toBe('G1')
    expect(Object.keys(s).sort()).toEqual(['type', 'x', 'y', 'z'])
  })

  it('emitted G2/G3 segment has exactly 8 fields (type, x, y, z, i, j, k, plane)', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 64)
    const segs = fitArcsToLinearPath(pts, 0.01)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(Object.keys(arc!).sort()).toEqual(['i', 'j', 'k', 'plane', 'type', 'x', 'y', 'z'])
    expect(arc!.plane === 'G17' || arc!.plane === 'G18' || arc!.plane === 'G19').toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// D. fitArcsToLinearPath edge inputs
// ──────────────────────────────────────────────────────────────────────────

describe('D. fitArcsToLinearPath edge inputs', () => {
  it('empty input returns []', () => {
    expect(fitArcsToLinearPath([], 0.01)).toEqual([])
  })

  it('1-point input returns []', () => {
    expect(fitArcsToLinearPath([{ x: 0, y: 0, z: 0 }], 0.01)).toEqual([])
  })

  it('2-point input returns exactly 1 G1 segment to the second point', () => {
    const segs = fitArcsToLinearPath(
      [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 }
      ],
      0.01
    )
    expect(segs.length).toBe(1)
    expect(segs[0]!.type).toBe('G1')
    expect((segs[0] as { x: number }).x).toBe(5)
  })

  it('zero tolerance falls back to all-G1 emission (no arc fitting)', () => {
    // Even a perfect circle is emitted as G1s when tolerance <= 0.
    const pts = generateCirclePoints(0, 0, 0, 10, 16)
    const segs = fitArcsToLinearPath(pts, 0)
    expect(segs.length).toBe(pts.length - 1)
    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
  })

  it('negative tolerance falls back to all-G1 emission (defensive guard)', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 16)
    const segs = fitArcsToLinearPath(pts, -1)
    expect(segs.length).toBe(pts.length - 1)
    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
  })

  it('does NOT mutate the input array', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    ]
    const before = JSON.stringify(pts)
    fitArcsToLinearPath(pts, 0.01)
    expect(JSON.stringify(pts)).toBe(before)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// E. fitArcsToLinearPath arc directionality + IJK semantics
// ──────────────────────────────────────────────────────────────────────────

describe('E. arc directionality + IJK semantics', () => {
  it('a CCW full XY circle fits as G3 with plane=G17', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 64) // ccw=true default
    const segs = fitArcsToLinearPath(pts, 0.01)
    const arcs = segs.filter((s) => s.type === 'G2' || s.type === 'G3') as Extract<
      GCodeSegment,
      { type: 'G2' | 'G3' }
    >[]
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    for (const a of arcs) {
      expect(a.type).toBe('G3')
      expect(a.plane).toBe('G17')
    }
  })

  it('a CW full XY circle fits as G2 with plane=G17', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 64, 0, 2 * Math.PI, false) // ccw=false
    const segs = fitArcsToLinearPath(pts, 0.01)
    const arcs = segs.filter((s) => s.type === 'G2' || s.type === 'G3') as Extract<
      GCodeSegment,
      { type: 'G2' | 'G3' }
    >[]
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    for (const a of arcs) {
      expect(a.type).toBe('G2')
      expect(a.plane).toBe('G17')
    }
  })

  it('IJK in G17 are INCREMENTAL offsets from arc start to circle center', () => {
    // Arc spans 0..PI of a unit-radius circle centered at (5, 0). Start at
    // (6, 0). I should be (cx - sx) = 5 - 6 = -1, J should be (cy - sy) = 0,
    // K = 0 (G17).
    const pts = generateCirclePoints(5, 0, 0, 1, 32, 0, Math.PI, true)
    const segs = fitArcsToLinearPath(pts, 0.001)
    const arcs = segs.filter((s) => s.type === 'G2' || s.type === 'G3') as Extract<
      GCodeSegment,
      { type: 'G2' | 'G3' }
    >[]
    expect(arcs.length).toBe(1)
    const arc = arcs[0]!
    expect(arc.plane).toBe('G17')
    expect(arc.i).toBeCloseTo(-1, 3)
    expect(arc.j).toBeCloseTo(0, 3)
    expect(arc.k).toBe(0)
  })

  it('arc end (x, y, z) matches polyline endpoint to within tolerance', () => {
    const pts = generateCirclePoints(0, 0, 7.5, 10, 32, 0, Math.PI, true)
    const segs = fitArcsToLinearPath(pts, 0.001)
    const arcs = segs.filter((s) => s.type === 'G2' || s.type === 'G3') as Extract<
      GCodeSegment,
      { type: 'G2' | 'G3' }
    >[]
    expect(arcs.length).toBe(1)
    const last = pts[pts.length - 1]!
    expect(arcs[0]!.x).toBeCloseTo(last.x, 5)
    expect(arcs[0]!.y).toBeCloseTo(last.y, 5)
    expect(arcs[0]!.z).toBeCloseTo(last.z, 5)
  })

  it('returns a fresh array (not aliased to any internal state)', () => {
    const pts = generateCirclePoints(0, 0, 0, 5, 16)
    const a = fitArcsToLinearPath(pts, 0.01)
    const b = fitArcsToLinearPath(pts, 0.01)
    expect(a).not.toBe(b)
    expect(a).toEqual(b) // structurally equal but different array refs
  })
})

// ──────────────────────────────────────────────────────────────────────────
// F. Plane detection (XY/XZ/YZ)
// ──────────────────────────────────────────────────────────────────────────

describe('F. plane detection', () => {
  // Helper: rotate a flat XY circle into XZ or YZ for planar-detection tests.
  function rotateCircleToXZ(pts: Point3D[]): Point3D[] {
    return pts.map((p) => ({ x: p.x, y: 0, z: p.y })) // x stays, z becomes y, y flat
  }
  function rotateCircleToYZ(pts: Point3D[]): Point3D[] {
    return pts.map((p) => ({ x: 0, y: p.x, z: p.y })) // y becomes x, z becomes y, x flat
  }

  it('an XY-plane circle fits with plane=G17', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 32, 0, Math.PI)
    const segs = fitArcsToLinearPath(pts, 0.01)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as Extract<
      GCodeSegment,
      { type: 'G2' | 'G3' }
    >
    expect(arc.plane).toBe('G17')
  })

  it('an XZ-plane circle fits with plane=G18', () => {
    const flat = generateCirclePoints(0, 0, 0, 10, 32, 0, Math.PI)
    const pts = rotateCircleToXZ(flat)
    const segs = fitArcsToLinearPath(pts, 0.01)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(arc!.plane).toBe('G18')
  })

  it('a YZ-plane circle fits with plane=G19', () => {
    const flat = generateCirclePoints(0, 0, 0, 10, 32, 0, Math.PI)
    const pts = rotateCircleToYZ(flat)
    const segs = fitArcsToLinearPath(pts, 0.01)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(arc!.plane).toBe('G19')
  })

  it('G18 plane fit emits IJK with j=0 (out-of-plane axis is Y)', () => {
    const flat = generateCirclePoints(5, 0, 0, 1, 32, 0, Math.PI, true)
    const pts = rotateCircleToXZ(flat)
    const segs = fitArcsToLinearPath(pts, 0.001)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(arc!.plane).toBe('G18')
    expect(arc!.j).toBe(0)
  })

  it('G19 plane fit emits IJK with i=0 (out-of-plane axis is X)', () => {
    const flat = generateCirclePoints(5, 0, 0, 1, 32, 0, Math.PI, true)
    const pts = rotateCircleToYZ(flat)
    const segs = fitArcsToLinearPath(pts, 0.001)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(arc!.plane).toBe('G19')
    expect(arc!.i).toBe(0)
  })

  it('G17 plane fit emits IJK with k=0 (out-of-plane axis is Z)', () => {
    const pts = generateCirclePoints(5, 0, 0, 1, 32, 0, Math.PI, true)
    const segs = fitArcsToLinearPath(pts, 0.001)
    const arc = segs.find((s) => s.type === 'G2' || s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(arc!.plane).toBe('G17')
    expect(arc!.k).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// G. arc-vs-line behavior (collinear, mixed, near-line rejection)
// ──────────────────────────────────────────────────────────────────────────

describe('G. arc-vs-line behavior', () => {
  it('collinear points emit only G1 (no degenerate huge-radius arc)', () => {
    const pts: Point3D[] = []
    for (let i = 0; i <= 10; i++) pts.push({ x: i, y: 0, z: 0 })
    const segs = fitArcsToLinearPath(pts, 0.001)
    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
    expect(segs.length).toBe(pts.length - 1)
  })

  it('a polyline with a curved section followed by a straight section emits a mix', () => {
    // 16 points on a quarter circle, then 4 collinear points away.
    const arcPts = generateCirclePoints(0, 0, 0, 10, 16, 0, Math.PI / 2, true)
    const linePts: Point3D[] = []
    const lastArc = arcPts[arcPts.length - 1]!
    for (let i = 1; i <= 4; i++) {
      linePts.push({ x: lastArc.x - i, y: lastArc.y, z: 0 })
    }
    const segs = fitArcsToLinearPath([...arcPts, ...linePts], 0.001)
    const hasArc = segs.some((s) => s.type === 'G2' || s.type === 'G3')
    const hasLine = segs.some((s) => s.type === 'G1')
    expect(hasArc).toBe(true)
    expect(hasLine).toBe(true)
  })

  it('every emitted segment has finite numeric x/y/z', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 24)
    for (const s of fitArcsToLinearPath(pts, 0.005)) {
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.y)).toBe(true)
      expect(Number.isFinite(s.z)).toBe(true)
    }
  })

  it('helical arc (z varies linearly with arc parameter) within tolerance fits as a single arc', () => {
    // Generate 32 points on a CCW unit-radius circle in XY but with z = t.
    const pts: Point3D[] = []
    const n = 32
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const ang = t * Math.PI
      pts.push({ x: Math.cos(ang), y: Math.sin(ang), z: t })
    }
    const segs = fitArcsToLinearPath(pts, 0.001)
    const arcs = segs.filter((s) => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBeGreaterThanOrEqual(1)
  })

  it('helical arc with NON-linear Z perturbation FAILS the per-window linearity guard', () => {
    // Same XY arc as above but with z that wiggles outside tolerance.
    const pts: Point3D[] = []
    const n = 32
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const ang = t * Math.PI
      pts.push({
        x: Math.cos(ang),
        y: Math.sin(ang),
        z: i % 2 === 0 ? 0 : 0.5 // 0.5mm wiggle, well above 0.001 tolerance
      })
    }
    const segs = fitArcsToLinearPath(pts, 0.001)
    // The Z wiggle blows the linearity guard so each window collapses; the
    // result is dominated by G1s rather than a single arc.
    const arcs = segs.filter((s) => s.type === 'G2' || s.type === 'G3')
    const lines = segs.filter((s) => s.type === 'G1')
    expect(lines.length).toBeGreaterThan(arcs.length)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// H. generateCirclePoints
// ──────────────────────────────────────────────────────────────────────────

describe('H. generateCirclePoints', () => {
  it('emits exactly N+1 points (closed loop convention)', () => {
    expect(generateCirclePoints(0, 0, 0, 10, 4).length).toBe(5)
    expect(generateCirclePoints(0, 0, 0, 10, 64).length).toBe(65)
  })

  it('first and last points coincide to numeric tolerance for a full circle', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 64) // default 2*PI
    const first = pts[0]!
    const last = pts[pts.length - 1]!
    expect(last.x).toBeCloseTo(first.x, 9)
    expect(last.y).toBeCloseTo(first.y, 9)
    expect(last.z).toBe(first.z)
  })

  it('all points have the same constant Z (per-call planar; no helical via this helper)', () => {
    const pts = generateCirclePoints(0, 0, 7.25, 10, 16)
    for (const p of pts) {
      expect(p.z).toBe(7.25)
    }
  })

  it('CCW circle (default) starts at (cx + r, cy) for startAngle=0', () => {
    const pts = generateCirclePoints(2, 3, 0, 5, 32)
    expect(pts[0]!.x).toBeCloseTo(7, 6) // cx + r = 2 + 5
    expect(pts[0]!.y).toBeCloseTo(3, 6) // cy + r*sin(0) = cy
  })

  it('CW direction (ccw=false) sweeps in the opposite angular direction', () => {
    const ccw = generateCirclePoints(0, 0, 0, 10, 4, 0, 2 * Math.PI, true)
    const cw = generateCirclePoints(0, 0, 0, 10, 4, 0, 2 * Math.PI, false)
    // First quarter: CCW lands at (0, +10), CW lands at (0, -10).
    expect(ccw[1]!.y).toBeCloseTo(10, 6)
    expect(cw[1]!.y).toBeCloseTo(-10, 6)
  })

  it('startAngle offset shifts the entire ring', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 4, Math.PI / 2, 2 * Math.PI, true)
    expect(pts[0]!.x).toBeCloseTo(0, 6)
    expect(pts[0]!.y).toBeCloseTo(10, 6)
  })

  it('sweepAngle < 2*PI produces an arc (not a closed loop)', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 8, 0, Math.PI / 2, true)
    expect(pts.length).toBe(9)
    // End at (0, 10) for sweep PI/2 from start (10, 0).
    const last = pts[pts.length - 1]!
    expect(last.x).toBeCloseTo(0, 6)
    expect(last.y).toBeCloseTo(10, 6)
  })

  it('all output points lie on the requested circle within numerical noise', () => {
    const r = 12.5
    const cx = -3
    const cy = 7
    const pts = generateCirclePoints(cx, cy, 0, r, 24)
    for (const p of pts) {
      const d = Math.hypot(p.x - cx, p.y - cy)
      expect(d).toBeCloseTo(r, 9)
    }
  })

  it('returns a fresh array on every call (no shared aliasing)', () => {
    const a = generateCirclePoints(0, 0, 0, 5, 4)
    const b = generateCirclePoints(0, 0, 0, 5, 4)
    expect(a).not.toBe(b)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// I. Source-text whitelist + safety
// ──────────────────────────────────────────────────────────────────────────

describe('I. source-text whitelist', () => {
  it('declares ZERO imports (pure SHARED arc math, no node:* / electron / fs / path)', () => {
    // The module is intentionally dependency-free so the renderer + main
    // bundles can both pull it without dragging in node-only modules.
    expect(SRC).not.toMatch(/^import\s/m)
  })

  it('declares no `:any` and no `as any` (strict-typed throughout)', () => {
    // Allow `: any` ONLY if it appears inside a comment. The simpler check:
    // there is no `: any` outside of comment blocks.
    const stripped = SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).not.toMatch(/:\s*any\b/)
    expect(stripped).not.toMatch(/\bas\s+any\b/)
  })

  it('contains no eval / new Function / Function constructor', () => {
    expect(SRC).not.toMatch(/\beval\s*\(/)
    expect(SRC).not.toMatch(/new\s+Function\b/)
  })

  it('declares no node:fs / node:path / node:child_process / electron imports', () => {
    expect(SRC).not.toMatch(/from\s+['"]node:/)
    expect(SRC).not.toMatch(/from\s+['"]electron/)
    expect(SRC).not.toMatch(/from\s+['"]fs['"]/)
    expect(SRC).not.toMatch(/from\s+['"]path['"]/)
    expect(SRC).not.toMatch(/from\s+['"]child_process['"]/)
  })

  it('pins the 1e-12 collinearity guard literal', () => {
    expect(SRC).toMatch(/Math\.abs\(denom\)\s*<\s*1e-12/)
  })

  it('pins the 1e-6 degenerate-radius rejection literal', () => {
    expect(SRC).toMatch(/r\s*<\s*1e-6/)
  })

  it('pins the 1000x chord-length straight-line rejection literal', () => {
    expect(SRC).toMatch(/circle\.r\s*>\s*1000\s*\*\s*chordLen/)
  })

  it('pins the 20-point lookahead window for plane detection', () => {
    expect(SRC).toMatch(/Math\.min\(i\s*\+\s*20,\s*points\.length\)/)
  })

  it('pins the 3-point minimum arc gate (i + 2 < points.length and bestArcEnd >= i + 2)', () => {
    expect(SRC).toMatch(/i\s*\+\s*2\s*<\s*points\.length/)
    expect(SRC).toMatch(/bestArcEnd\s*>=\s*i\s*\+\s*2/)
  })

  it('pins the cross-product G2/G3 winding rule (cross >= 0 -> G3)', () => {
    expect(SRC).toMatch(/cross\s*>=\s*0\s*\?\s*'G3'\s*:\s*'G2'/)
  })

  it('pins the three planar-coordinate cases for G17/G18/G19 dispatch', () => {
    expect(SRC).toMatch(/case 'G17':\s*return \{ u: p\.x, v: p\.y, w: p\.z \}/)
    expect(SRC).toMatch(/case 'G18':\s*return \{ u: p\.x, v: p\.z, w: p\.y \}/)
    expect(SRC).toMatch(/case 'G19':\s*return \{ u: p\.y, v: p\.z, w: p\.x \}/)
  })

  it('pins the IJK builder cases (G17 i,j; G18 i,k; G19 j,k)', () => {
    expect(SRC).toMatch(/case 'G17':\s*return \{ i: du, j: dv, k: 0 \}/)
    expect(SRC).toMatch(/case 'G18':\s*return \{ i: du, j: 0, k: dv \}/)
    expect(SRC).toMatch(/case 'G19':\s*return \{ i: 0, j: du, k: dv \}/)
  })

  it('pins the tolerance <= 0 fallback to all-G1 emission', () => {
    expect(SRC).toMatch(/if \(tolerance <= 0\)/)
    expect(SRC).toMatch(/return emitAllLinear\(points\)/)
  })

  it('pins the points.length < 2 short-circuit', () => {
    expect(SRC).toMatch(/if \(points\.length < 2\) return \[\]/)
  })

  it('uses Number.isFinite + r < 1e-6 as the radius rejection pair', () => {
    expect(SRC).toMatch(/Number\.isFinite\(r\)/)
  })

  it('declares 2 export functions (fitArcsToLinearPath + generateCirclePoints) and 2 export types', () => {
    const exportFns = (SRC.match(/^export function /gm) || []).length
    const exportTypes = (SRC.match(/^export type /gm) || []).length
    expect(exportFns).toBe(2)
    expect(exportTypes).toBe(2)
  })

  it('contains no TODO / FIXME / HACK markers (clean module)', () => {
    expect(SRC).not.toMatch(/\bTODO\b/i)
    expect(SRC).not.toMatch(/\bFIXME\b/i)
    expect(SRC).not.toMatch(/\bHACK\b/i)
  })

  it('contains no G-code text in the source itself other than the literal G17/G18/G19/G1/G2/G3 type discriminators', () => {
    // A reasonable proxy: no M-codes anywhere (M3, M5, M6, M7, M9, M30...).
    // M-codes belong in the post-processor templates and post-process.ts,
    // never in this pure geometry layer.
    expect(SRC).not.toMatch(/\bM3\b/)
    expect(SRC).not.toMatch(/\bM5\b/)
    expect(SRC).not.toMatch(/\bM6\b/)
    expect(SRC).not.toMatch(/\bM7\b/)
    expect(SRC).not.toMatch(/\bM9\b/)
    expect(SRC).not.toMatch(/\bM30\b/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// J. Three-machine cross-cut realism
// ──────────────────────────────────────────────────────────────────────────

describe('J. three-machine cross-cut realism', () => {
  it('Laguna Swift 5x10 — half-sheet contour 762mm radius round-trips through arc fitting', () => {
    // Half the long edge of a Laguna 5x10 sheet (3048 / 2 / 2 = 762) used as
    // the radius of a generous decorative arc. RichAuto A-series emits G3
    // with I/J relative center offsets, plane G17, and our pin requires the
    // arc end to land within tolerance of the polyline endpoint.
    const r = 762
    const pts = generateCirclePoints(0, 0, 0, r, 64, 0, Math.PI / 2, true)
    const segs = fitArcsToLinearPath(pts, 0.05) // 0.05 mm tolerance — plywood
    const arc = segs.find((s) => s.type === 'G3') as
      | Extract<GCodeSegment, { type: 'G2' | 'G3' }>
      | undefined
    expect(arc).toBeDefined()
    expect(arc!.plane).toBe('G17')
    // End of a quarter circle from (r,0) sweeping CCW PI/2 lands at (0, r).
    expect(arc!.x).toBeCloseTo(0, 1)
    expect(arc!.y).toBeCloseTo(r, 1)
    // I/J are incremental from start (r, 0) to center (0, 0) -> i = -r, j = 0.
    expect(arc!.i).toBeCloseTo(-r, 1)
    expect(arc!.j).toBeCloseTo(0, 6)
    expect(arc!.k).toBe(0)
  })

  it('Makera Carvera 3-axis — 25mm bore counter-bores fit cleanly within the 360x240 envelope', () => {
    // A typical Carvera small-pocket bore. Make sure both CW and CCW roughs
    // emit a single arc each (or chain of arcs) within a tight 0.005 mm
    // tolerance — Carvera Controller looks ahead on G2/G3 and the reduced
    // segment count keeps the spindle from chattering on the interior.
    const r = 25
    const ccw = fitArcsToLinearPath(generateCirclePoints(0, 0, 0, r, 48, 0, 2 * Math.PI, true), 0.005)
    const cw = fitArcsToLinearPath(generateCirclePoints(0, 0, 0, r, 48, 0, 2 * Math.PI, false), 0.005)
    expect(ccw.some((s) => s.type === 'G3')).toBe(true)
    expect(cw.some((s) => s.type === 'G2')).toBe(true)
    // 360x240 bed envelope sanity: every emitted arc end stays within +-r.
    for (const s of [...ccw, ...cw]) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(r + 0.01)
      expect(Math.abs(s.y)).toBeLessThanOrEqual(r + 0.01)
    }
  })

  it('Creality K2 Plus FDM — module is dependency-free so the FDM passthrough does NOT pull arc fitting at runtime unless explicitly opted in', () => {
    // The K2 Plus FDM passthrough post template emits the slicer body
    // verbatim (pinned in post-process-k2-capabilities.test.ts line 243).
    // The contract here is structural: arc-fitting.ts is a SHARED pure
    // module with ZERO imports, so even loading it never reaches into
    // electron/main and never side-effects an FDM passthrough run.
    expect(SRC).not.toMatch(/^import\s/m)
    // Also: the module exports exactly 2 runtime values, both pure functions
    // — no side-effecting initializer that could perturb a passthrough run.
    const runtimeKeys = Object.keys(M).filter((k) => typeof (M as any)[k] !== 'undefined')
    expect(runtimeKeys.length).toBe(2)
    for (const k of runtimeKeys) {
      expect(typeof (M as any)[k]).toBe('function')
    }
  })

  it('Makera Carvera 4-axis Rotary — bypass guard reference is documented in the post layer', () => {
    // The Cycle 85 [ID-0064] safety bypass lives in
    // src/main/post-process-arc-fitting-4axis-safety-contract.test.ts and
    // src/main/cam-axis4/runner-shims-pin.test.ts. THIS pin file's job is
    // to confirm the SHARED-side contract is pure (no kind discriminator
    // baked into arc-fitting.ts itself — bypass is the post layer's
    // responsibility, not the geometry layer's). A `cnc_4axis` literal in
    // arc-fitting.ts source would be a layering violation.
    expect(SRC).not.toMatch(/cnc_4axis/)
    expect(SRC).not.toMatch(/manufactureKind/)
    expect(SRC).not.toMatch(/isManufactureKind/)
  })

  it('reproducibility — same input + tolerance produces byte-identical segment list across runs', () => {
    // All three target machines need deterministic G-code: regenerating a
    // job must produce the same line-by-line sequence so re-uploads via
    // Moonraker (K2), USB stick (Laguna RichAuto), or Carvera Controller
    // are byte-identical.
    const pts = generateCirclePoints(0, 0, 0, 50, 32, 0, Math.PI, true)
    const a = fitArcsToLinearPath(pts, 0.005)
    const b = fitArcsToLinearPath(pts, 0.005)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('full-circle round-trip: the output segments form a valid post-processor input (every field finite)', () => {
    const pts = generateCirclePoints(0, 0, 12.7, 6.35, 64) // 1/2" radius, 1/2" Z
    const segs = fitArcsToLinearPath(pts, 0.002)
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) {
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.y)).toBe(true)
      expect(Number.isFinite(s.z)).toBe(true)
      if (s.type === 'G2' || s.type === 'G3') {
        expect(Number.isFinite(s.i)).toBe(true)
        expect(Number.isFinite(s.j)).toBe(true)
        expect(Number.isFinite(s.k)).toBe(true)
        expect(['G17', 'G18', 'G19']).toContain(s.plane)
      }
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
// K. Type-level parity (compile-time pin)
// ──────────────────────────────────────────────────────────────────────────

describe('K. type-level parity', () => {
  it('Point3D accepts exactly { x, y, z } numbers (compile-time)', () => {
    const p: Point3D = { x: 0, y: 0, z: 0 }
    expect(p).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('GCodeSegment G1 variant accepts { type: "G1", x, y, z }', () => {
    const s: GCodeSegment = { type: 'G1', x: 1, y: 2, z: 3 }
    expect(s.type).toBe('G1')
  })

  it('GCodeSegment G2 variant accepts { type: "G2", x, y, z, i, j, k, plane }', () => {
    const s: GCodeSegment = {
      type: 'G2',
      x: 0,
      y: 0,
      z: 0,
      i: -1,
      j: 0,
      k: 0,
      plane: 'G17'
    }
    expect(s.type).toBe('G2')
    expect(s.plane).toBe('G17')
  })

  it('GCodeSegment G3 variant accepts plane "G18" or "G19"', () => {
    const a: GCodeSegment = { type: 'G3', x: 0, y: 0, z: 0, i: 0, j: 0, k: 0, plane: 'G18' }
    const b: GCodeSegment = { type: 'G3', x: 0, y: 0, z: 0, i: 0, j: 0, k: 0, plane: 'G19' }
    expect(a.plane).toBe('G18')
    expect(b.plane).toBe('G19')
  })

  it('fitArcsToLinearPath return type is GCodeSegment[]', () => {
    const segs: GCodeSegment[] = fitArcsToLinearPath([{ x: 0, y: 0, z: 0 }], 0.01)
    expect(Array.isArray(segs)).toBe(true)
  })

  it('generateCirclePoints return type is Point3D[]', () => {
    const pts: Point3D[] = generateCirclePoints(0, 0, 0, 1, 4)
    expect(Array.isArray(pts)).toBe(true)
    expect(pts.length).toBe(5)
  })
})
