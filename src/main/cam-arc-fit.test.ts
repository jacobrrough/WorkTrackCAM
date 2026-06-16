import { describe, expect, it } from 'vitest'
import { fitArcsFromPolyline, type ArcFitPoint, type ArcFitSegment } from './cam-arc-fit'

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Sample `n+1` points on a circular arc (closed full circle when sweep=2π). */
function arcPoints(
  cx: number,
  cy: number,
  r: number,
  n: number,
  startAngle = 0,
  sweep = 2 * Math.PI
): ArcFitPoint[] {
  const pts: ArcFitPoint[] = []
  for (let i = 0; i <= n; i++) {
    const a = startAngle + (sweep * i) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

const arcs = (segs: ArcFitSegment[]): Extract<ArcFitSegment, { kind: 'arc' }>[] =>
  segs.filter((s): s is Extract<ArcFitSegment, { kind: 'arc' }> => s.kind === 'arc')
const linesOf = (segs: ArcFitSegment[]): Extract<ArcFitSegment, { kind: 'line' }>[] =>
  segs.filter((s): s is Extract<ArcFitSegment, { kind: 'line' }> => s.kind === 'line')

/** Re-walk segments from `start` and assert every vertex is reproduced exactly. */
function walkReproduces(start: ArcFitPoint, segs: ArcFitSegment[], expectedLast: ArcFitPoint): void {
  let cur = start
  for (const s of segs) cur = s.to
  expect(cur[0]).toBeCloseTo(expectedLast[0], 9)
  expect(cur[1]).toBeCloseTo(expectedLast[1], 9)
}

// ──────────────────────────────────────────────────────────────────────────
// Perfect circle → arc(s)
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — perfect circle', () => {
  it('fits a full CCW circle into 1–4 arcs covering it (no lines)', () => {
    const pts = arcPoints(0, 0, 10, 48) // CCW, 48 chords
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    const a = arcs(segs)
    expect(a.length).toBeGreaterThanOrEqual(1)
    expect(a.length).toBeLessThanOrEqual(4)
    // Greedy maximal: a clean circle should NOT decompose into many segments.
    expect(segs.length).toBeLessThanOrEqual(4)
    // Every fitted arc is a valid circle centred near origin, radius ≈ 10.
    for (const arc of a) {
      expect(arc.center[0]).toBeCloseTo(0, 3)
      expect(arc.center[1]).toBeCloseTo(0, 3)
      expect(arc.radius).toBeCloseTo(10, 3)
      expect(arc.dir).toBe('ccw')
    }
  })

  it('fits a full CW circle and reports dir = cw (posts as G2)', () => {
    const pts = arcPoints(0, 0, 10, 48, 0, -2 * Math.PI) // CW
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    const a = arcs(segs)
    expect(a.length).toBeGreaterThanOrEqual(1)
    for (const arc of a) expect(arc.dir).toBe('cw')
  })

  it('fits a CCW semicircle into a single arc ending at the right point', () => {
    const pts = arcPoints(0, 0, 10, 24, 0, Math.PI) // start (10,0) → end (-10,0)
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    const a = arcs(segs)
    expect(a.length).toBe(1)
    expect(a[0]!.dir).toBe('ccw')
    expect(a[0]!.to[0]).toBeCloseTo(-10, 6)
    expect(a[0]!.to[1]).toBeCloseTo(0, 6)
    expect(a[0]!.radius).toBeCloseTo(10, 6)
  })

  it('fits a quarter arc (CCW)', () => {
    const pts = arcPoints(5, 5, 4, 16, 0, Math.PI / 2)
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    const a = arcs(segs)
    expect(a.length).toBe(1)
    expect(a[0]!.center[0]).toBeCloseTo(5, 4)
    expect(a[0]!.center[1]).toBeCloseTo(5, 4)
    expect(a[0]!.radius).toBeCloseTo(4, 4)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Validity invariant: |start − C| == |end − C| == radius
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — arc validity (the malformed-arc guard)', () => {
  it('every emitted arc has |start−C| == |end−C| == radius within tolerance', () => {
    const tol = 0.01
    const pts = arcPoints(2, -3, 7, 40, 0.3, 1.7 * Math.PI)
    const segs = fitArcsFromPolyline(pts, { chordTolMm: tol })
    let start: ArcFitPoint = pts[0]!
    for (const s of segs) {
      if (s.kind === 'arc') {
        const rStart = Math.hypot(start[0] - s.center[0], start[1] - s.center[1])
        const rEnd = Math.hypot(s.to[0] - s.center[0], s.to[1] - s.center[1])
        expect(Math.abs(rStart - s.radius)).toBeLessThanOrEqual(tol)
        expect(Math.abs(rEnd - s.radius)).toBeLessThanOrEqual(tol)
        // Equal radii to each other too — the controller-executable contract.
        expect(Math.abs(rStart - rEnd)).toBeLessThanOrEqual(2 * tol)
      }
      start = s.to
    }
    expect(arcs(segs).length).toBeGreaterThanOrEqual(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Straight line → all lines (no arc), and the tolerance GATE
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — straight & near-straight stay lines', () => {
  it('a straight polyline emits only line segments (radius→∞ guard)', () => {
    const pts: ArcFitPoint[] = []
    for (let i = 0; i <= 20; i++) pts.push([i, 2 * i]) // perfectly collinear
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    expect(arcs(segs).length).toBe(0)
    expect(linesOf(segs).length).toBe(20)
  })

  it('a run that bulges JUST OUTSIDE chordTol stays lines (the gate)', () => {
    // A shallow arc whose sagitta exceeds tol would fit; choose a deviation that
    // is just over the tolerance so the radial gate rejects it.
    const tol = 0.02
    // Near-straight points with a deliberate mid bump of 0.05 mm (> tol) that is
    // NOT a circular profile — a single spike breaks any circle fit.
    const pts: ArcFitPoint[] = [
      [0, 0],
      [2, 0.0],
      [4, 0.05], // spike off any circle through neighbours by > tol
      [6, 0.0],
      [8, 0.0],
      [10, 0.0]
    ]
    const segs = fitArcsFromPolyline(pts, { chordTolMm: tol })
    expect(arcs(segs).length).toBe(0)
  })

  it('the SAME circle that fits at a loose tol becomes lines at a tight tol', () => {
    // Sample a real arc but perturb every other point by 0.03 mm radially.
    const cx = 0
    const cy = 0
    const r = 20
    const n = 30
    const pts: ArcFitPoint[] = []
    for (let i = 0; i <= n; i++) {
      const ang = (Math.PI * i) / n // semicircle
      const rr = r + (i % 2 === 0 ? 0.03 : -0.03)
      pts.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)])
    }
    // Loose tolerance accepts the noisy arc.
    expect(arcs(fitArcsFromPolyline(pts, { chordTolMm: 0.1 })).length).toBeGreaterThanOrEqual(1)
    // Tight tolerance (< the 0.03 noise) rejects it → all lines.
    expect(arcs(fitArcsFromPolyline(pts, { chordTolMm: 0.005 })).length).toBe(0)
  })

  it('non-positive tolerance disables fitting (pure linear passthrough)', () => {
    const pts = arcPoints(0, 0, 10, 40)
    expect(arcs(fitArcsFromPolyline(pts, { chordTolMm: 0 })).length).toBe(0)
    expect(arcs(fitArcsFromPolyline(pts, { chordTolMm: -1 })).length).toBe(0)
    expect(linesOf(fitArcsFromPolyline(pts, { chordTolMm: 0 })).length).toBe(40)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Mixed line + arc + line
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — mixed geometry', () => {
  it('line + arc + line: straight lead-in, semicircle, straight lead-out', () => {
    const pts: ArcFitPoint[] = []
    // straight run into the arc start
    pts.push([-30, 0])
    pts.push([-20, 0])
    pts.push([-10, 0]) // arc start (radius 10 about origin, angle π)
    // semicircle from angle π → 0 (lower half, CW), centre origin r=10
    const semi = arcPoints(0, 0, 10, 24, Math.PI, -Math.PI)
    for (let i = 1; i < semi.length; i++) pts.push(semi[i]!) // skip dup start
    // straight run out from (10,0)
    pts.push([20, 0])
    pts.push([30, 0])

    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    expect(arcs(segs).length).toBe(1)
    expect(linesOf(segs).length).toBeGreaterThanOrEqual(4) // 2 in + 2 out
    // The single arc must be the middle semicircle.
    const arc = arcs(segs)[0]!
    expect(arc.radius).toBeCloseTo(10, 3)
    expect(arc.dir).toBe('cw')
    // Walk reproduces the final vertex exactly.
    walkReproduces(pts[0]!, segs, [30, 0])
  })

  it('two separated arcs joined by a straight run stay two arcs', () => {
    const pts: ArcFitPoint[] = []
    const a1 = arcPoints(0, 0, 8, 20, 0, Math.PI) // CCW semicircle (8,0)→(-8,0)
    pts.push(...a1)
    pts.push([-8, -10]) // straight segment down
    pts.push([-8, -20])
    const a2 = arcPoints(-8, -28, 8, 20, Math.PI / 2, Math.PI) // second arc
    for (let i = 1; i < a2.length; i++) pts.push(a2[i]!)
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    expect(arcs(segs).length).toBe(2)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Direction correctness (CW vs CCW)
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — winding direction', () => {
  it('CCW sampling → ccw; CW sampling → cw (same geometry)', () => {
    const ccw = fitArcsFromPolyline(arcPoints(1, 1, 5, 24, 0, Math.PI), { chordTolMm: 0.01 })
    const cw = fitArcsFromPolyline(arcPoints(1, 1, 5, 24, 0, -Math.PI), { chordTolMm: 0.01 })
    expect(arcs(ccw)[0]!.dir).toBe('ccw')
    expect(arcs(cw)[0]!.dir).toBe('cw')
    // Same centre + radius, opposite winding.
    expect(arcs(ccw)[0]!.radius).toBeCloseTo(arcs(cw)[0]!.radius, 6)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Radius guards (tiny / huge) and point-count guards
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — radius & count guards', () => {
  it('a huge-radius shallow run is treated as a line, not an arc', () => {
    // radius 100000, tiny sweep → sagitta below tol over a short run → lines.
    const pts = arcPoints(0, 100000, 100000, 12, -Math.PI / 2 - 0.0005, 0.001)
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    expect(arcs(segs).length).toBe(0)
  })

  it('a tiny but real circle (r=0.6 mm) still fits as an arc', () => {
    const pts = arcPoints(0, 0, 0.6, 32) // full small circle
    const segs = fitArcsFromPolyline(pts, { chordTolMm: 0.002 })
    expect(arcs(segs).length).toBeGreaterThanOrEqual(1)
    for (const arc of arcs(segs)) expect(arc.radius).toBeCloseTo(0.6, 2)
  })

  it('a 2-point run is a single line (cannot form an arc)', () => {
    const segs = fitArcsFromPolyline([[0, 0], [10, 0]], { chordTolMm: 0.01 })
    expect(arcs(segs).length).toBe(0)
    expect(linesOf(segs).length).toBe(1)
  })

  it('< 2 points yields an empty segment list', () => {
    expect(fitArcsFromPolyline([], { chordTolMm: 0.01 })).toEqual([])
    expect(fitArcsFromPolyline([[1, 1]], { chordTolMm: 0.01 })).toEqual([])
  })

  it('minPoints raises the bar: a 3-point run is a line when minPoints=4, an arc at minPoints=3', () => {
    // Exactly 3 points on a circle (the minimum for a fit). Keep each step well
    // within the per-step coarseness guard (here ~10° steps) so ONLY the
    // minPoints gate is under test. Default minPoints (4) → too short → lines;
    // minPoints=3 → a single arc.
    const pts = arcPoints(0, 0, 10, 2, 0, (20 * Math.PI) / 180) // 3 points, 10° steps
    expect(arcs(fitArcsFromPolyline(pts, { chordTolMm: 0.01 })).length).toBe(0)
    expect(
      arcs(fitArcsFromPolyline(pts, { chordTolMm: 0.01, minPoints: 3, minArcSweepDeg: 1 })).length
    ).toBe(1)
  })

  it('maxStepDeg rejects a coarse co-circular polygon (rectangle corners on their circumcircle)', () => {
    // A rectangle's 4 corners lie on a common circle, but each step subtends 90°.
    // The toolpath between corners is a straight chord, NOT an arc — must be lines.
    const rect: ArcFitPoint[] = [
      [0, 0],
      [40, 0],
      [40, 25],
      [0, 25],
      [0, 0] // closed
    ]
    expect(arcs(fitArcsFromPolyline(rect, { chordTolMm: 0.05, minPoints: 3 })).length).toBe(0)
    // A regular octagon (45° steps) is still too coarse at the default 30° gate.
    const oct = arcPoints(0, 0, 10, 8) // 8 segments → 45° steps (last==first)
    expect(arcs(fitArcsFromPolyline(oct, { chordTolMm: 0.05, minPoints: 3 })).length).toBe(0)
    // Loosen the per-step gate above 45° and the octagon's vertices fit a circle.
    expect(
      arcs(fitArcsFromPolyline(oct, { chordTolMm: 0.05, minPoints: 3, maxStepDeg: 60 })).length
    ).toBeGreaterThanOrEqual(1)
  })

  it('minArcSweepDeg gates small sweeps below the default 5° gate', () => {
    // A genuine circle with a 3° sweep — below the 5° default gate, but with a
    // big enough radius/sweep that the curvature (sagitta) guard is satisfied at
    // a fine tolerance, so ONLY the sweep gate is under test here.
    const pts = arcPoints(0, 0, 50, 12, 0, (3 * Math.PI) / 180)
    // Default sweep gate (5°) rejects the 3° run → all lines.
    expect(arcs(fitArcsFromPolyline(pts, { chordTolMm: 0.0005 })).length).toBe(0)
    // Lower the sweep gate below 3° and the genuine arc is recognised.
    expect(
      arcs(fitArcsFromPolyline(pts, { chordTolMm: 0.0005, minArcSweepDeg: 1 })).length
    ).toBeGreaterThanOrEqual(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Determinism & purity
// ──────────────────────────────────────────────────────────────────────────

describe('fitArcsFromPolyline — determinism & purity', () => {
  it('is deterministic (same input → identical output)', () => {
    const pts = arcPoints(3, 4, 12, 50, 0.2, 1.3 * Math.PI)
    const a = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    const b = fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    expect(a).toEqual(b)
  })

  it('does not mutate the input array', () => {
    const pts = arcPoints(0, 0, 10, 24)
    const snapshot = pts.map((p) => [p[0], p[1]] as ArcFitPoint)
    fitArcsFromPolyline(pts, { chordTolMm: 0.01 })
    expect(pts).toEqual(snapshot)
  })
})
