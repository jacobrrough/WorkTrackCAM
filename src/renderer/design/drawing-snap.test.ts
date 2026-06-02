/**
 * Behavioral tests for `src/renderer/design/drawing-snap.ts`.
 *
 * All tests are pure-function / no-DOM (except the clientToSvgCoord section, which
 * constructs a minimal mock SVGSVGElement inline). No React, no IPC, no sidecar.
 *
 * Test matrix:
 *   resolveSnap — zero points, single in-tolerance, single out-of-tolerance,
 *                 boundary exact match, boundary +ε null, tie-break by kind,
 *                 tie-break by stable index, override=true, multiple points
 *                 nearest-wins, nearest-out-but-second-in → second.
 *   clientToSvgCoord — identity CTM, scale CTM, null CTM fallback.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SNAP_TOLERANCE_PX,
  SNAP_KIND_PRIORITY,
  clientToSvgCoord,
  resolveSnap
} from './drawing-snap'
import type { SnapPoint, SnapResult } from './drawing-snap'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pt(x: number, y: number, kind: SnapPoint['kind'], sourceId?: string): SnapPoint {
  return sourceId !== undefined ? { x, y, kind, sourceId } : { x, y, kind }
}

/**
 * Create a minimal SVGSVGElement mock whose getScreenCTM() returns a DOMMatrix-like
 * object with the supplied affine entries (a, b, c, d, e, f).
 *
 * The mock's inverse() returns a DOMMatrix-like with the analytic 2D inverse so
 * that clientToSvgCoord can call ctm.inverse() without a real browser.
 *
 * For identity: a=1,b=0,c=0,d=1,e=0,f=0  → inverse is itself.
 * For translation e/f: inverse shifts by -e, -f.
 */
function makeMockSvgEl(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  nullCtm = false
): SVGSVGElement {
  if (nullCtm) {
    return {
      getScreenCTM: () => null
    } as unknown as SVGSVGElement
  }

  // 2D affine inverse:
  //   det = a*d - b*c
  //   inv = [d/det, -b/det, -c/det, a/det, (c*f - d*e)/det, (b*e - a*f)/det]
  function makeInverse(ma: number, mb: number, mc: number, md: number, me: number, mf: number) {
    const det = ma * md - mb * mc
    const ia = md / det
    const ib = -mb / det
    const ic = -mc / det
    const id = ma / det
    const ie = (mc * mf - md * me) / det
    const if_ = (mb * me - ma * mf) / det
    return {
      a: ia,
      b: ib,
      c: ic,
      d: id,
      e: ie,
      f: if_,
      inverse: () => ({ a: ma, b: mb, c: mc, d: md, e: me, f: mf })
    }
  }

  const matrix = {
    a,
    b,
    c,
    d,
    e,
    f,
    inverse: () => makeInverse(a, b, c, d, e, f)
  }

  return {
    getScreenCTM: () => matrix
  } as unknown as SVGSVGElement
}

// ---------------------------------------------------------------------------
// resolveSnap
// ---------------------------------------------------------------------------

describe('resolveSnap — zero points', () => {
  it('returns null when snapPoints is empty', () => {
    const result = resolveSnap({ x: 10, y: 10 }, [], DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result).toBeNull()
  })
})

describe('resolveSnap — single in-tolerance point', () => {
  it('returns the point when cursor is within tolerance', () => {
    const points = [pt(10, 10, 'vertex')]
    const result = resolveSnap({ x: 12, y: 10 }, points, DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result).not.toBeNull()
    expect(result!.x).toBe(10)
    expect(result!.y).toBe(10)
    expect(result!.kind).toBe('vertex')
  })

  it('distanceSvgUnits equals the actual Euclidean distance', () => {
    const points = [pt(0, 0, 'vertex')]
    const result = resolveSnap({ x: 3, y: 4 }, points, DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result).not.toBeNull()
    expect(result!.distanceSvgUnits).toBeCloseTo(5, 10)
  })

  it('preserves sourceId on the result', () => {
    const points = [pt(5, 5, 'endpoint', 'edge-42')]
    const result = resolveSnap({ x: 5, y: 5 }, points, DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result!.sourceId).toBe('edge-42')
  })
})

describe('resolveSnap — single out-of-tolerance point', () => {
  it('returns null when cursor is beyond tolerance', () => {
    const points = [pt(100, 100, 'vertex')]
    const result = resolveSnap({ x: 0, y: 0 }, points, DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result).toBeNull()
  })
})

describe('resolveSnap — boundary conditions', () => {
  it('matches when distance equals tolerance exactly', () => {
    // Cursor at (12, 0), point at (0, 0) → distance = 12 = DEFAULT_SNAP_TOLERANCE_PX.
    const points = [pt(0, 0, 'vertex')]
    const result = resolveSnap(
      { x: DEFAULT_SNAP_TOLERANCE_PX, y: 0 },
      points,
      DEFAULT_SNAP_TOLERANCE_PX,
      false
    )
    expect(result).not.toBeNull()
    expect(result!.distanceSvgUnits).toBeCloseTo(DEFAULT_SNAP_TOLERANCE_PX, 10)
  })

  it('returns null when distance is tolerance + tiny epsilon', () => {
    const tol = DEFAULT_SNAP_TOLERANCE_PX
    const epsilon = 1e-9
    const points = [pt(0, 0, 'vertex')]
    const result = resolveSnap({ x: tol + epsilon, y: 0 }, points, tol, false)
    expect(result).toBeNull()
  })
})

describe('resolveSnap — tie-break by kind (vertex beats midpoint at equal distance)', () => {
  it('prefers vertex over midpoint when equidistant from cursor', () => {
    // Both points at distance 5 from origin.
    const points: SnapPoint[] = [pt(5, 0, 'midpoint'), pt(0, 5, 'vertex')]
    const result = resolveSnap({ x: 0, y: 0 }, points, DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('vertex')
    expect(result!.x).toBe(0)
    expect(result!.y).toBe(5)
  })

  it('prefers vertex over endpoint over center over midpoint at same distance', () => {
    const dist = 5
    const midpt = pt(dist, 0, 'midpoint')
    const center = pt(0, dist, 'center')
    const endpoint = pt(-dist, 0, 'endpoint')
    const vertex = pt(0, -dist, 'vertex')
    const result = resolveSnap({ x: 0, y: 0 }, [midpt, center, endpoint, vertex], 20, false)
    expect(result!.kind).toBe('vertex')
  })

  it('prefers endpoint over center when equidistant', () => {
    const dist = 5
    const points: SnapPoint[] = [pt(0, dist, 'center'), pt(dist, 0, 'endpoint')]
    const result = resolveSnap({ x: 0, y: 0 }, points, 20, false)
    expect(result!.kind).toBe('endpoint')
  })

  it('prefers center over midpoint when equidistant', () => {
    const dist = 5
    const points: SnapPoint[] = [pt(dist, 0, 'midpoint'), pt(0, dist, 'center')]
    const result = resolveSnap({ x: 0, y: 0 }, points, 20, false)
    expect(result!.kind).toBe('center')
  })
})

describe('resolveSnap — tie-break by stable array index', () => {
  it('returns the first point when kind and distance are identical', () => {
    const points: SnapPoint[] = [
      pt(3, 4, 'vertex', 'first'),
      pt(5, 0, 'vertex', 'second'), // distance = 5 from origin, same as above
      pt(4, 3, 'vertex', 'third') // distance = 5 from origin, same as above
    ]
    const result = resolveSnap({ x: 0, y: 0 }, points, 20, false)
    // All three are at distance 5, same kind → first in array wins.
    expect(result!.sourceId).toBe('first')
  })
})

describe('resolveSnap — override=true', () => {
  it('returns null regardless of cursor position when override is true', () => {
    const points = [pt(0, 0, 'vertex')]
    const result = resolveSnap({ x: 0, y: 0 }, points, DEFAULT_SNAP_TOLERANCE_PX, true)
    expect(result).toBeNull()
  })

  it('returns null even with no points when override is true', () => {
    const result = resolveSnap({ x: 5, y: 5 }, [], DEFAULT_SNAP_TOLERANCE_PX, true)
    expect(result).toBeNull()
  })
})

describe('resolveSnap — multiple points nearest-wins', () => {
  it('picks the nearest in-tolerance point', () => {
    const points: SnapPoint[] = [
      pt(10, 0, 'vertex', 'far'), // distance 10 from origin
      pt(3, 4, 'vertex', 'near') // distance 5 from origin
    ]
    const result = resolveSnap({ x: 0, y: 0 }, points, DEFAULT_SNAP_TOLERANCE_PX, false)
    expect(result!.sourceId).toBe('near')
  })
})

describe('resolveSnap — nearest out-of-tolerance but second in-tolerance', () => {
  it('returns the second point when nearest exceeds tolerance', () => {
    const tol = 8
    // Point 1 at distance 6 from origin (in tolerance)
    // Point 2 at distance 2 from origin BUT we will swap them so nearest is outside tolerance.
    // Actually: nearest-out means nearest candidate is outside tolerance;
    // we need: candidate A (distance > tol), candidate B (distance < tol) → return B.
    const pointOutside = pt(tol + 1, 0, 'vertex', 'outside') // distance 9 > tol=8
    const pointInside = pt(0, 5, 'endpoint', 'inside') // distance 5 < tol=8
    const result = resolveSnap({ x: 0, y: 0 }, [pointOutside, pointInside], tol, false)
    expect(result).not.toBeNull()
    expect(result!.sourceId).toBe('inside')
  })

  it('returns closest in-tolerance point when multiple points span boundary', () => {
    const tol = 10
    // A is nearest overall (distance 3) but outside tolerance — can't happen; adjust test to:
    // A at distance 9 (in), B at distance 11 (out), C at distance 7 (in, nearest in-tolerance).
    const a = pt(9, 0, 'midpoint', 'a') // distance 9
    const b = pt(11, 0, 'midpoint', 'b') // distance 11, out
    const c = pt(7, 0, 'vertex', 'c') // distance 7
    const result = resolveSnap({ x: 0, y: 0 }, [a, b, c], tol, false)
    // c is nearest in-tolerance and has higher priority kind
    expect(result!.sourceId).toBe('c')
  })
})

describe('resolveSnap — distanceSvgUnits precision', () => {
  it('returns exact zero distance when cursor is on the snap point', () => {
    const result = resolveSnap({ x: 7, y: 13 }, [pt(7, 13, 'center')], 1, false) as SnapResult
    expect(result.distanceSvgUnits).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// clientToSvgCoord
// ---------------------------------------------------------------------------

describe('clientToSvgCoord — identity CTM', () => {
  it('returns client coords unchanged with identity matrix', () => {
    const svgEl = makeMockSvgEl(1, 0, 0, 1, 0, 0)
    const result = clientToSvgCoord(100, 200, svgEl)
    expect(result.x).toBeCloseTo(100, 5)
    expect(result.y).toBeCloseTo(200, 5)
  })

  it('handles origin (0, 0) with identity matrix', () => {
    const svgEl = makeMockSvgEl(1, 0, 0, 1, 0, 0)
    const result = clientToSvgCoord(0, 0, svgEl)
    expect(result.x).toBeCloseTo(0, 5)
    expect(result.y).toBeCloseTo(0, 5)
  })
})

describe('clientToSvgCoord — translation CTM', () => {
  it('subtracts translation when SVG is offset on screen', () => {
    // Screen CTM has translation e=50, f=100 (SVG origin is at screen (50,100)).
    // The inverse should subtract the translation:
    //   SVG x = clientX - 50, SVG y = clientY - 100.
    const svgEl = makeMockSvgEl(1, 0, 0, 1, 50, 100)
    const result = clientToSvgCoord(150, 200, svgEl)
    expect(result.x).toBeCloseTo(100, 5)
    expect(result.y).toBeCloseTo(100, 5)
  })
})

describe('clientToSvgCoord — null CTM fallback', () => {
  it('returns { x: clientX, y: clientY } when getScreenCTM() returns null', () => {
    const svgEl = makeMockSvgEl(1, 0, 0, 1, 0, 0, /* nullCtm */ true)
    const result = clientToSvgCoord(77, 88, svgEl)
    expect(result.x).toBe(77)
    expect(result.y).toBe(88)
  })
})

describe('clientToSvgCoord — scale CTM', () => {
  it('handles a 2× uniform scale (SVG scaled up 2× on screen)', () => {
    // If the SVG is scaled 2× on screen, the screen CTM a=2, d=2 (with e=f=0).
    // inverse: a=0.5, d=0.5 → SVG coord = clientCoord / 2.
    const svgEl = makeMockSvgEl(2, 0, 0, 2, 0, 0)
    const result = clientToSvgCoord(200, 400, svgEl)
    expect(result.x).toBeCloseTo(100, 5)
    expect(result.y).toBeCloseTo(200, 5)
  })
})
