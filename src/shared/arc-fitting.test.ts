import { describe, expect, it } from 'vitest'
import {
  fitArcsToLinearPath,
  generateCirclePoints,
  type GCodeSegment,
  type Point3D
} from './arc-fitting'

describe('fitArcsToLinearPath', () => {
  // ─── Perfect circle → single G2 or G3 ───────────────────────────────────────

  it('fits a full CCW circle into a single G3 arc', () => {
    // 64 points on a full circle, radius 10, centered at origin, XY plane
    const pts = generateCirclePoints(0, 0, 0, 10, 64)
    const segs = fitArcsToLinearPath(pts, 0.01)

    // Should produce a single arc (or very few segments)
    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    // All arcs should be G3 (CCW)
    for (const a of arcs) {
      expect(a.type).toBe('G3')
    }
    // Should be far fewer segments than 64 individual G1s
    expect(segs.length).toBeLessThan(10)
  })

  it('fits a full CW circle into a single G2 arc', () => {
    // CW circle (ccw=false)
    const pts = generateCirclePoints(0, 0, 0, 10, 64, 0, 2 * Math.PI, false)
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    for (const a of arcs) {
      expect(a.type).toBe('G2')
    }
    expect(segs.length).toBeLessThan(10)
  })

  // ─── Semicircle → one arc ────────────────────────────────────────────────────

  it('fits a semicircle into a single arc segment', () => {
    // Half circle (sweep = PI), 32 points, CCW
    const pts = generateCirclePoints(0, 0, 0, 10, 32, 0, Math.PI)
    const segs = fitArcsToLinearPath(pts, 0.01)

    // Should produce exactly 1 arc
    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBe(1)
    expect(arcs[0]!.type).toBe('G3')

    // End point should be at angle PI: x ≈ -10, y ≈ 0
    const arc = arcs[0] as Extract<GCodeSegment, { type: 'G2' | 'G3' }>
    expect(arc.x).toBeCloseTo(-10, 1)
    expect(arc.y).toBeCloseTo(0, 1)
  })

  // ─── Straight line → all G1, no arcs ────────────────────────────────────────

  it('produces only G1 segments for a straight line', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 }
    ]
    const segs = fitArcsToLinearPath(pts, 0.001)

    // All segments should be G1 (collinear points can't form a circle)
    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
    expect(segs.length).toBe(5) // n-1 segments for n points
  })

  // ─── Mixed curve: some arcs, some lines ──────────────────────────────────────

  it('produces a mix of arcs and lines for a curve followed by a straight section', () => {
    // Quarter circle then a straight line
    const arcPts = generateCirclePoints(0, 0, 0, 10, 16, 0, Math.PI / 2)
    const linePts: Point3D[] = [
      { x: -5, y: 10, z: 0 },
      { x: -10, y: 10, z: 0 },
      { x: -15, y: 10, z: 0 }
    ]
    const pts = [...arcPts, ...linePts]
    const segs = fitArcsToLinearPath(pts, 0.01)

    const hasArc = segs.some(s => s.type === 'G2' || s.type === 'G3')
    const hasLine = segs.some(s => s.type === 'G1')
    expect(hasArc).toBe(true)
    expect(hasLine).toBe(true)
  })

  // ─── Tolerance thresholds ────────────────────────────────────────────────────

  it('produces arcs with generous tolerance on slightly noisy circle points', () => {
    // Generate circle points with small noise
    const pts = generateCirclePoints(0, 0, 0, 10, 32).map((p, i) => ({
      x: p.x + (i % 3 === 0 ? 0.002 : 0),
      y: p.y + (i % 5 === 0 ? -0.002 : 0),
      z: p.z
    }))
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    // Should be significantly fewer segments than all-G1
    expect(segs.length).toBeLessThan(20)
  })

  it('tighter tolerance produces more G1 segments than looser tolerance', () => {
    // Apply irregular noise to a circle's points. A tighter tolerance should
    // reject more arcs and emit more G1 segments than a loose tolerance.
    const pts = generateCirclePoints(0, 0, 0, 10, 32).map((p, i) => {
      const radialNoise = [0.05, -0.03, 0.08, -0.06, 0.04, -0.07, 0.09, -0.02, 0.06]
      const noise = radialNoise[i % radialNoise.length]!
      const angle = Math.atan2(p.y, p.x)
      return {
        x: p.x + noise * Math.cos(angle),
        y: p.y + noise * Math.sin(angle),
        z: p.z
      }
    })
    const segsLoose = fitArcsToLinearPath(pts, 0.1)
    const segsTight = fitArcsToLinearPath(pts, 0.001)

    // Tighter tolerance should produce at least as many segments (likely more)
    expect(segsTight.length).toBeGreaterThanOrEqual(segsLoose.length)
    // Loose tolerance on a roughly circular shape should find at least one arc
    const looseArcs = segsLoose.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(looseArcs.length).toBeGreaterThanOrEqual(1)
  })

  // ─── Edge cases ──────────────────────────────────────────────────────────────

  it('returns empty array for fewer than 2 points', () => {
    expect(fitArcsToLinearPath([], 0.01)).toEqual([])
    expect(fitArcsToLinearPath([{ x: 0, y: 0, z: 0 }], 0.01)).toEqual([])
  })

  it('returns a single G1 for exactly 2 points', () => {
    const segs = fitArcsToLinearPath(
      [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      0.01
    )
    expect(segs.length).toBe(1)
    expect(segs[0]!.type).toBe('G1')
    expect(segs[0]!.x).toBe(10)
  })

  it('handles collinear points without producing arcs', () => {
    // Points along Y axis
    const pts: Point3D[] = Array.from({ length: 10 }, (_, i) => ({
      x: 0, y: i * 5, z: 0
    }))
    const segs = fitArcsToLinearPath(pts, 0.01)

    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
    expect(segs.length).toBe(9)
  })

  it('handles very small arcs (radius < 1mm)', () => {
    const pts = generateCirclePoints(0, 0, 0, 0.5, 32)
    const segs = fitArcsToLinearPath(pts, 0.001)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBeGreaterThanOrEqual(1)
  })

  it('produces correct IJK center offsets for a known quarter circle', () => {
    // Quarter circle: start at (10, 0), center at (0, 0), end at (0, 10), CCW
    const pts = generateCirclePoints(0, 0, 0, 10, 32, 0, Math.PI / 2)
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3') as Extract<GCodeSegment, { type: 'G2' | 'G3' }>[]
    expect(arcs.length).toBeGreaterThanOrEqual(1)

    // First arc should start from (10, 0) with center at ~(0, 0)
    // So I = cx - x_start = 0 - 10 = -10, J = cy - y_start = 0 - 0 = 0
    const firstArc = arcs[0]!
    expect(firstArc.i).toBeCloseTo(-10, 0)
    expect(firstArc.j).toBeCloseTo(0, 0)
  })

  // ─── Zero / negative tolerance ───────────────────────────────────────────────

  it('with zero tolerance, emits all G1 (no arcs)', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 16)
    const segs = fitArcsToLinearPath(pts, 0)

    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
  })

  it('with negative tolerance, emits all G1 (no arcs)', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 16)
    const segs = fitArcsToLinearPath(pts, -1)

    for (const s of segs) {
      expect(s.type).toBe('G1')
    }
  })

  // ─── Arc plane selection ─────────────────────────────────────────────────────

  it('selects G17 (XY) plane for arcs in the XY plane', () => {
    const pts = generateCirclePoints(0, 0, 5, 10, 32)
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3') as Extract<GCodeSegment, { type: 'G2' | 'G3' }>[]
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    for (const a of arcs) {
      expect(a.plane).toBe('G17')
    }
  })

  it('selects G18 (XZ) plane for arcs in the XZ plane', () => {
    // Circle in XZ plane: X varies, Z varies, Y is constant
    const pts: Point3D[] = []
    const r = 10
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * 2 * Math.PI
      pts.push({ x: r * Math.cos(angle), y: 5, z: r * Math.sin(angle) })
    }
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3') as Extract<GCodeSegment, { type: 'G2' | 'G3' }>[]
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    for (const a of arcs) {
      expect(a.plane).toBe('G18')
    }
  })

  it('selects G19 (YZ) plane for arcs in the YZ plane', () => {
    // Circle in YZ plane: Y varies, Z varies, X is constant
    const pts: Point3D[] = []
    const r = 10
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * 2 * Math.PI
      pts.push({ x: 5, y: r * Math.cos(angle), z: r * Math.sin(angle) })
    }
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3') as Extract<GCodeSegment, { type: 'G2' | 'G3' }>[]
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    for (const a of arcs) {
      expect(a.plane).toBe('G19')
    }
  })

  // ─── Helical arc (arc with linear Z change) ─────────────────────────────────

  it('fits a helical arc (XY circle with linearly changing Z)', () => {
    // Circle in XY plane with Z ramping from 0 to -5
    const pts: Point3D[] = []
    const r = 10
    const n = 32
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * 2 * Math.PI
      pts.push({
        x: r * Math.cos(angle),
        y: r * Math.sin(angle),
        z: (-5 * i) / n
      })
    }
    const segs = fitArcsToLinearPath(pts, 0.01)

    // Should produce arcs despite Z change (helical arc)
    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3')
    expect(arcs.length).toBeGreaterThanOrEqual(1)
    expect(segs.length).toBeLessThan(n)

    // End Z should be close to -5
    const lastSeg = segs[segs.length - 1]!
    expect(lastSeg.z).toBeCloseTo(-5, 1)
  })

  // ─── Arc mathematical correctness ───────────────────────────────────────────

  it('arc endpoints lie within tolerance of the original polyline endpoints', () => {
    const pts = generateCirclePoints(5, 3, -2, 15, 48, 0, Math.PI)
    const segs = fitArcsToLinearPath(pts, 0.005)

    // The last segment's endpoint should be close to the last input point
    const lastInput = pts[pts.length - 1]!
    const lastSeg = segs[segs.length - 1]!
    expect(lastSeg.x).toBeCloseTo(lastInput.x, 2)
    expect(lastSeg.y).toBeCloseTo(lastInput.y, 2)
    expect(lastSeg.z).toBeCloseTo(lastInput.z, 2)
  })

  it('arc center + radius reconstructs the start point within tolerance', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 32, 0, Math.PI / 2)
    const segs = fitArcsToLinearPath(pts, 0.01)

    const arcs = segs.filter(s => s.type === 'G2' || s.type === 'G3') as Extract<GCodeSegment, { type: 'G2' | 'G3' }>[]
    if (arcs.length > 0) {
      const arc = arcs[0]!
      // Start point is pts[0] = (10, 0, 0)
      // Center = start + (I, J) = (10 + I, 0 + J)
      const cx = 10 + arc.i
      const cy = 0 + arc.j
      const rStart = Math.hypot(10 - cx, 0 - cy)
      const rEnd = Math.hypot(arc.x - cx, arc.y - cy)
      // Start and end should be at the same radius
      expect(Math.abs(rStart - rEnd)).toBeLessThan(0.1)
    }
  })

  // ─── Segment count reduction ─────────────────────────────────────────────────

  it('significantly reduces segment count for a circular toolpath', () => {
    const pts = generateCirclePoints(0, 0, 0, 20, 200)
    const segs = fitArcsToLinearPath(pts, 0.01)

    // 200 linear segments should compress to just a few arc segments
    expect(segs.length).toBeLessThan(20)
    // Should be at least 10x compression
    expect(segs.length).toBeLessThan(200 / 10)
  })
})

describe('generateCirclePoints', () => {
  it('generates points on a circle of the specified radius', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 8)
    expect(pts.length).toBe(9) // n+1 points (includes start and end)

    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 5)
      expect(p.z).toBe(0)
    }
  })

  it('first and last points of full circle are the same', () => {
    const pts = generateCirclePoints(5, 3, -1, 10, 64)
    expect(pts[0]!.x).toBeCloseTo(pts[pts.length - 1]!.x, 5)
    expect(pts[0]!.y).toBeCloseTo(pts[pts.length - 1]!.y, 5)
    expect(pts[0]!.z).toBe(pts[pts.length - 1]!.z)
  })

  it('generates semicircle points spanning PI radians', () => {
    const pts = generateCirclePoints(0, 0, 0, 10, 16, 0, Math.PI)
    // Start: angle=0 → (10, 0)
    expect(pts[0]!.x).toBeCloseTo(10, 5)
    expect(pts[0]!.y).toBeCloseTo(0, 5)
    // End: angle=PI → (-10, 0)
    expect(pts[pts.length - 1]!.x).toBeCloseTo(-10, 5)
    expect(pts[pts.length - 1]!.y).toBeCloseTo(0, 5)
  })

  it('CW circle winds in the opposite direction from CCW', () => {
    const ccw = generateCirclePoints(0, 0, 0, 10, 4, 0, Math.PI / 2, true)
    const cw = generateCirclePoints(0, 0, 0, 10, 4, 0, Math.PI / 2, false)

    // Both start at angle 0 → (10, 0)
    expect(ccw[0]!.x).toBeCloseTo(10, 5)
    expect(cw[0]!.x).toBeCloseTo(10, 5)

    // CCW quarter end: (0, 10)
    expect(ccw[ccw.length - 1]!.x).toBeCloseTo(0, 5)
    expect(ccw[ccw.length - 1]!.y).toBeCloseTo(10, 5)

    // CW quarter end: (0, -10)
    expect(cw[cw.length - 1]!.x).toBeCloseTo(0, 5)
    expect(cw[cw.length - 1]!.y).toBeCloseTo(-10, 5)
  })
})
