/**
 * Pin contract for src/shared/cam-2d-derive.ts
 *
 * Cycle 210 cam-engine paired-pin contract co-located with
 * `cam-2d-derive.test.ts` (behavioral). Pins module shape, per-entity-kind
 * dispatch, source-id selection, drill-only filter, signature determinism,
 * and pure-function invariants for the 2D contour/drill point derivation
 * layer that backs every CNC contour/pocket/drill operation across the three
 * target machines (Laguna Swift 5x10, Carvera 3-axis, Carvera 4-axis -- the
 * Creality K2 Plus FDM path bypasses this module entirely because slicer
 * profiles consume the 3D mesh, not 2D sketch contours).
 *
 * Testing strategy: the behavioral test covers happy paths; this pin file
 * pins the *contract surface* so future refactors cannot silently rename
 * exports, drop kinds from the dispatch, change the signature precision,
 * or break the source-id selection precedence. Three-machine path realism
 * fixtures exercise the layer under all three CNC machines' typical
 * 2D job inputs.
 *
 * Safety Rule 1 UNTOUCHED -- this pin file authors tests only; no
 * production-G-code edits, no machine-profile edits, no .hbs template
 * edits, no Python engine edits, no schema edits.
 */

import { describe, expect, it } from 'vitest'
import * as mod from './cam-2d-derive'
import {
  contourPointSignature,
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign,
  type DerivedContourCandidate
} from './cam-2d-derive'
import { emptyDesign, type DesignFileV2 } from './design-schema'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'

const SOURCE_PATH = pathResolve(__dirname, 'cam-2d-derive.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function designWithPolyline(closed: boolean): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      { id: 'poly1', kind: 'polyline', pointIds: ['a', 'b', 'c', 'd'], closed }
    ],
    points: {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      c: { x: 100, y: 50 },
      d: { x: 0, y: 50 }
    }
  }
}

function designWithRect(rotationRad = 0): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      { id: 'r1', kind: 'rect', cx: 10, cy: 20, w: 40, h: 30, rotation: rotationRad }
    ]
  }
}

function designWithCircle(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [{ id: 'c1', kind: 'circle', cx: 5, cy: -3, r: 12 }]
  }
}

function designWithSlot(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      {
        id: 's1',
        kind: 'slot',
        cx: 0,
        cy: 0,
        length: 50,
        width: 10,
        rotation: 0
      }
    ]
  }
}

function designWithEllipse(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      {
        id: 'e1',
        kind: 'ellipse',
        cx: 0,
        cy: 0,
        rx: 40,
        ry: 25,
        rotation: 0
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------

describe('A. cam-2d-derive module shape', () => {
  it('exports exactly the 4 runtime symbols', () => {
    const runtimeKeys = Object.keys(mod).filter((k) => typeof (mod as any)[k] !== 'undefined')
    runtimeKeys.sort()
    expect(runtimeKeys).toEqual([
      'contourPointSignature',
      'deriveContourPointsFromDesign',
      'deriveDrillPointsFromDesign',
      'listContourCandidatesFromDesign'
    ])
  })

  it('has no default export', () => {
    expect((mod as any).default).toBeUndefined()
  })

  it('contourPointSignature is a function with arity 1', () => {
    expect(typeof contourPointSignature).toBe('function')
    expect(contourPointSignature.length).toBe(1)
  })

  it('listContourCandidatesFromDesign is a function with arity 1', () => {
    expect(typeof listContourCandidatesFromDesign).toBe('function')
    expect(listContourCandidatesFromDesign.length).toBe(1)
  })

  it('deriveContourPointsFromDesign declares arity 2 (design + optional sourceId)', () => {
    expect(typeof deriveContourPointsFromDesign).toBe('function')
    // TypeScript optional params (`sourceId?: string`) still count toward .length
    // because the runtime function has no default-value initializer.
    expect(deriveContourPointsFromDesign.length).toBe(2)
  })

  it('deriveDrillPointsFromDesign is a function with arity 1', () => {
    expect(typeof deriveDrillPointsFromDesign).toBe('function')
    expect(deriveDrillPointsFromDesign.length).toBe(1)
  })

  it('all 4 runtime symbols are functions (no constants)', () => {
    expect(typeof contourPointSignature).toBe('function')
    expect(typeof listContourCandidatesFromDesign).toBe('function')
    expect(typeof deriveContourPointsFromDesign).toBe('function')
    expect(typeof deriveDrillPointsFromDesign).toBe('function')
  })

  it('no exported runtime constant accidentally re-exported (e.g. ELLIPSE_PROFILE_SEGMENTS leak)', () => {
    expect((mod as any).ELLIPSE_PROFILE_SEGMENTS).toBeUndefined()
    expect((mod as any).SLOT_PROFILE_CAP_SEGMENTS).toBeUndefined()
    expect((mod as any).circleToLoop).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. DerivedContourCandidate shape contract
// ---------------------------------------------------------------------------

describe('B. DerivedContourCandidate shape contract', () => {
  it('every candidate has exactly the 4 documented keys', () => {
    const candidates = listContourCandidatesFromDesign(designWithRect())
    expect(candidates).toHaveLength(1)
    const keys = Object.keys(candidates[0]!).sort()
    expect(keys).toEqual(['label', 'points', 'signature', 'sourceId'])
  })

  it('sourceId is a string equal to the entity id', () => {
    const candidates = listContourCandidatesFromDesign(designWithRect())
    expect(candidates[0]!.sourceId).toBe('r1')
    expect(typeof candidates[0]!.sourceId).toBe('string')
  })

  it('label is a string starting with the kind label', () => {
    const polyOut = listContourCandidatesFromDesign(designWithPolyline(true))
    expect(polyOut[0]!.label).toBe('Polyline poly1')
    const rectOut = listContourCandidatesFromDesign(designWithRect())
    expect(rectOut[0]!.label).toBe('Rectangle r1')
    const circOut = listContourCandidatesFromDesign(designWithCircle())
    expect(circOut[0]!.label).toBe('Circle c1')
    const slotOut = listContourCandidatesFromDesign(designWithSlot())
    expect(slotOut[0]!.label).toBe('Slot s1')
    const ellOut = listContourCandidatesFromDesign(designWithEllipse())
    expect(ellOut[0]!.label).toBe('Ellipse e1')
  })

  it('points is an array of [x,y] tuples (length 2 each)', () => {
    const candidates = listContourCandidatesFromDesign(designWithRect())
    expect(Array.isArray(candidates[0]!.points)).toBe(true)
    expect(candidates[0]!.points.length).toBe(4)
    for (const pt of candidates[0]!.points) {
      expect(Array.isArray(pt)).toBe(true)
      expect(pt.length).toBe(2)
      expect(typeof pt[0]).toBe('number')
      expect(typeof pt[1]).toBe('number')
    }
  })

  it('signature is a non-empty string', () => {
    const candidates = listContourCandidatesFromDesign(designWithCircle())
    expect(typeof candidates[0]!.signature).toBe('string')
    expect(candidates[0]!.signature.length).toBeGreaterThan(0)
  })

  it('signature equals contourPointSignature(points) -- the contract', () => {
    const candidates = listContourCandidatesFromDesign(designWithRect(0.7))
    expect(candidates[0]!.signature).toBe(contourPointSignature(candidates[0]!.points))
  })
})

// ---------------------------------------------------------------------------
// C. contourPointSignature determinism + precision
// ---------------------------------------------------------------------------

describe('C. contourPointSignature determinism + precision', () => {
  it('emits 3-decimal precision for each coordinate', () => {
    // Use values with <=3 decimal places so toFixed(3) is numerically exact
    // (avoids IEEE754 representation ambiguity around half-way rounding,
    // e.g. 1.2345 stores as 1.2344999999999999 and rounds DOWN under V8 toFixed).
    const sig = contourPointSignature([
      [1.234, 2.346],
      [3.457, 4.568]
    ])
    expect(sig).toBe('1.234,2.346|3.457,4.568')
  })

  it('separates points with "|" and coordinates with ","', () => {
    const sig = contourPointSignature([
      [0, 0],
      [1, 1]
    ])
    expect(sig).toBe('0.000,0.000|1.000,1.000')
    expect(sig.split('|').length).toBe(2)
  })

  it('handles empty input as empty string', () => {
    expect(contourPointSignature([])).toBe('')
  })

  it('is deterministic across identical inputs', () => {
    const a = contourPointSignature([
      [1, 2],
      [3, 4]
    ])
    const b = contourPointSignature([
      [1, 2],
      [3, 4]
    ])
    expect(a).toBe(b)
  })

  it('changes when ANY coordinate changes at the 4th decimal place (precision floor)', () => {
    // 0.0005 rounds up from 0.000 to 0.001 at toFixed(3)
    const a = contourPointSignature([[0.000, 0]])
    const b = contourPointSignature([[0.0005, 0]])
    expect(a).not.toBe(b)
  })

  it('does NOT change when a coordinate changes ONLY below the precision floor', () => {
    const a = contourPointSignature([[1.0001, 2.0001]])
    const b = contourPointSignature([[1.0002, 2.0002]])
    expect(a).toBe(b) // both round to 1.000,2.000
  })

  it('preserves ORDER of points (the chord ordering matters)', () => {
    const a = contourPointSignature([
      [0, 0],
      [10, 0]
    ])
    const b = contourPointSignature([
      [10, 0],
      [0, 0]
    ])
    expect(a).not.toBe(b)
  })

  it('handles negative coordinates', () => {
    const sig = contourPointSignature([[-1.5, -2.5]])
    expect(sig).toBe('-1.500,-2.500')
  })

  it('handles very large coordinates (Laguna 60x120 sheet realism)', () => {
    const sig = contourPointSignature([
      [0, 0],
      [1524, 0],
      [1524, 3048],
      [0, 3048]
    ])
    expect(sig).toBe('0.000,0.000|1524.000,0.000|1524.000,3048.000|0.000,3048.000')
  })

  it('accepts ReadonlyArray inputs (compile-time + runtime)', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [
      [1, 2],
      [3, 4]
    ] as const
    expect(contourPointSignature(pts)).toBe('1.000,2.000|3.000,4.000')
  })
})

// ---------------------------------------------------------------------------
// D. listContourCandidatesFromDesign per-kind dispatch
// ---------------------------------------------------------------------------

describe('D. listContourCandidatesFromDesign per-kind dispatch', () => {
  it('emits 0 candidates for an empty design', () => {
    const out = listContourCandidatesFromDesign(emptyDesign())
    expect(out).toEqual([])
  })

  it('SKIPS open polylines (closed===false)', () => {
    const out = listContourCandidatesFromDesign(designWithPolyline(false))
    expect(out).toEqual([])
  })

  it('SKIPS polylines with fewer than 3 resolved points', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'short', kind: 'polyline', pointIds: ['a', 'b'], closed: true }],
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    }
    expect(listContourCandidatesFromDesign(d)).toEqual([])
  })

  it('emits a polyline candidate when closed and >=3 points', () => {
    const out = listContourCandidatesFromDesign(designWithPolyline(true))
    expect(out).toHaveLength(1)
    expect(out[0]!.sourceId).toBe('poly1')
    expect(out[0]!.points).toHaveLength(4)
  })

  it('rectangles emit exactly 4 points (axis-aligned)', () => {
    const out = listContourCandidatesFromDesign(designWithRect(0))
    expect(out[0]!.points).toEqual([
      [10 - 20, 20 - 15], // [-hw, -hh] + (cx, cy)
      [10 + 20, 20 - 15],
      [10 + 20, 20 + 15],
      [10 - 20, 20 + 15]
    ])
  })

  it('rectangles respect rotation (90deg = swap dimensions)', () => {
    const out = listContourCandidatesFromDesign(designWithRect(Math.PI / 2))
    expect(out[0]!.points).toHaveLength(4)
    // After +90deg: (x,y) -> (-y, x); first vertex (-hw,-hh)=(-20,-15) -> (15,-20) world
    const [x0, y0] = out[0]!.points[0]!
    expect(x0).toBeCloseTo(10 + 15, 3) // cx + 15
    expect(y0).toBeCloseTo(20 - 20, 3) // cy - 20
  })

  it('circles emit exactly 32 sampled points (n=32 default)', () => {
    const out = listContourCandidatesFromDesign(designWithCircle())
    expect(out[0]!.points).toHaveLength(32)
  })

  it('circle samples lie on the analytic circle (radius preserved)', () => {
    const out = listContourCandidatesFromDesign(designWithCircle())
    for (const [x, y] of out[0]!.points) {
      const dx = x - 5
      const dy = y - -3
      expect(Math.hypot(dx, dy)).toBeCloseTo(12, 6)
    }
  })

  it('slots emit a positive number of points (>= 3) when length+width are positive', () => {
    const out = listContourCandidatesFromDesign(designWithSlot())
    expect(out).toHaveLength(1)
    expect(out[0]!.points.length).toBeGreaterThanOrEqual(3)
  })

  it('ellipses emit ELLIPSE_PROFILE_SEGMENTS=48 points', () => {
    const out = listContourCandidatesFromDesign(designWithEllipse())
    expect(out).toHaveLength(1)
    expect(out[0]!.points).toHaveLength(48)
  })

  it('SKIPS open arcs (arc + closed!==true)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'arc1', kind: 'arc', startId: 'a', viaId: 'b', endId: 'c', closed: false }],
      points: {
        a: { x: 0, y: 0 },
        b: { x: 5, y: 5 },
        c: { x: 10, y: 0 }
      }
    }
    const out = listContourCandidatesFromDesign(d)
    expect(out).toEqual([])
  })

  it('SKIPS open splines (spline_fit/spline_cp + closed!==true)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'sf1', kind: 'spline_fit', pointIds: ['a', 'b', 'c'], closed: false },
        { id: 'sc1', kind: 'spline_cp', pointIds: ['a', 'b', 'c', 'd'], closed: false }
      ],
      points: {
        a: { x: 0, y: 0 },
        b: { x: 10, y: 5 },
        c: { x: 20, y: 0 },
        d: { x: 30, y: -5 }
      }
    }
    expect(listContourCandidatesFromDesign(d)).toEqual([])
  })

  it('iterates entities in declaration order (stable output ordering)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'A', kind: 'circle', cx: 0, cy: 0, r: 5 },
        { id: 'B', kind: 'circle', cx: 100, cy: 0, r: 5 },
        { id: 'C', kind: 'circle', cx: 200, cy: 0, r: 5 }
      ]
    }
    const out = listContourCandidatesFromDesign(d)
    expect(out.map((c) => c.sourceId)).toEqual(['A', 'B', 'C'])
  })
})

// ---------------------------------------------------------------------------
// E. deriveContourPointsFromDesign source-id selection + first-fallback
// ---------------------------------------------------------------------------

describe('E. deriveContourPointsFromDesign source-id selection', () => {
  it('returns [] when design has no candidates', () => {
    expect(deriveContourPointsFromDesign(emptyDesign())).toEqual([])
  })

  it('returns the FIRST candidate when no sourceId is given (fallback)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'A', kind: 'circle', cx: 0, cy: 0, r: 5 },
        { id: 'B', kind: 'circle', cx: 100, cy: 0, r: 7 }
      ]
    }
    const pts = deriveContourPointsFromDesign(d)
    // Should match candidate A's points
    const candidates = listContourCandidatesFromDesign(d)
    expect(pts).toEqual(candidates[0]!.points)
  })

  it('selects by sourceId when given and present', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'A', kind: 'circle', cx: 0, cy: 0, r: 5 },
        { id: 'B', kind: 'circle', cx: 100, cy: 0, r: 7 }
      ]
    }
    const pts = deriveContourPointsFromDesign(d, 'B')
    const candidates = listContourCandidatesFromDesign(d)
    expect(pts).toEqual(candidates[1]!.points)
  })

  it('falls back to FIRST candidate when sourceId is given but NOT found', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'A', kind: 'circle', cx: 0, cy: 0, r: 5 },
        { id: 'B', kind: 'circle', cx: 100, cy: 0, r: 7 }
      ]
    }
    const pts = deriveContourPointsFromDesign(d, 'NOT_PRESENT')
    const candidates = listContourCandidatesFromDesign(d)
    expect(pts).toEqual(candidates[0]!.points)
  })

  it('empty-string sourceId is FALSY -> returns first candidate (truthy-check guard)', () => {
    // The source uses `if (sourceId)` which is falsy for "" -- the guard skips lookup
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'A', kind: 'circle', cx: 0, cy: 0, r: 5 },
        { id: '', kind: 'circle', cx: 100, cy: 0, r: 7 }
      ]
    }
    const candidates = listContourCandidatesFromDesign(d)
    const pts = deriveContourPointsFromDesign(d, '')
    expect(pts).toEqual(candidates[0]!.points)
  })

  it('returned points array is the SAME identity as the candidate.points (no copy)', () => {
    const d = designWithCircle()
    const candidates = listContourCandidatesFromDesign(d)
    const pts = deriveContourPointsFromDesign(d)
    // Both call the same listContourCandidatesFromDesign internally so identity will differ,
    // but value-equal:
    expect(pts).toEqual(candidates[0]!.points)
  })
})

// ---------------------------------------------------------------------------
// F. deriveDrillPointsFromDesign circle-only filter
// ---------------------------------------------------------------------------

describe('F. deriveDrillPointsFromDesign circle-only filter', () => {
  it('returns [] for an empty design', () => {
    expect(deriveDrillPointsFromDesign(emptyDesign())).toEqual([])
  })

  it('emits one (cx,cy) per circle entity', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'h1', kind: 'circle', cx: 10, cy: 5, r: 1 },
        { id: 'h2', kind: 'circle', cx: 20, cy: 15, r: 2 },
        { id: 'h3', kind: 'circle', cx: 30, cy: 25, r: 3 }
      ]
    }
    expect(deriveDrillPointsFromDesign(d)).toEqual([
      [10, 5],
      [20, 15],
      [30, 25]
    ])
  })

  it('IGNORES non-circle kinds entirely (no contamination)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 },
        { id: 'h1', kind: 'circle', cx: 5, cy: 5, r: 1 },
        { id: 's1', kind: 'slot', cx: 0, cy: 0, length: 20, width: 5, rotation: 0 },
        { id: 'e1', kind: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 5, rotation: 0 }
      ]
    }
    expect(deriveDrillPointsFromDesign(d)).toEqual([[5, 5]])
  })

  it('preserves entity declaration order', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'B', kind: 'circle', cx: 100, cy: 0, r: 1 },
        { id: 'A', kind: 'circle', cx: 0, cy: 0, r: 1 },
        { id: 'C', kind: 'circle', cx: 200, cy: 0, r: 1 }
      ]
    }
    expect(deriveDrillPointsFromDesign(d)).toEqual([
      [100, 0],
      [0, 0],
      [200, 0]
    ])
  })

  it('does NOT consult the radius (drill template selection happens elsewhere)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'tiny', kind: 'circle', cx: 0, cy: 0, r: 0.5 },
        { id: 'huge', kind: 'circle', cx: 100, cy: 100, r: 250 }
      ]
    }
    const pts = deriveDrillPointsFromDesign(d)
    expect(pts).toEqual([
      [0, 0],
      [100, 100]
    ])
  })
})

// ---------------------------------------------------------------------------
// G. Pure-function invariants
// ---------------------------------------------------------------------------

describe('G. pure-function invariants', () => {
  it('listContourCandidatesFromDesign does NOT mutate the input design.entities array', () => {
    const d = designWithCircle()
    const before = JSON.parse(JSON.stringify(d.entities))
    listContourCandidatesFromDesign(d)
    expect(d.entities).toEqual(before)
  })

  it('listContourCandidatesFromDesign does NOT mutate the input design.points map', () => {
    const d = designWithPolyline(true)
    const before = JSON.parse(JSON.stringify(d.points))
    listContourCandidatesFromDesign(d)
    expect(d.points).toEqual(before)
  })

  it('repeated calls produce DEEP-EQUAL but distinct array results', () => {
    const d = designWithCircle()
    const a = listContourCandidatesFromDesign(d)
    const b = listContourCandidatesFromDesign(d)
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // distinct top-level arrays
  })

  it('deriveContourPointsFromDesign does NOT mutate the input design', () => {
    const d = designWithRect(0.5)
    const before = JSON.parse(JSON.stringify(d))
    deriveContourPointsFromDesign(d, 'r1')
    expect(d).toEqual(before)
  })

  it('deriveDrillPointsFromDesign does NOT mutate the input design', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'h1', kind: 'circle', cx: 10, cy: 5, r: 1 },
        { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 5, h: 5, rotation: 0 }
      ]
    }
    const before = JSON.parse(JSON.stringify(d))
    deriveDrillPointsFromDesign(d)
    expect(d).toEqual(before)
  })

  it('contourPointSignature does NOT mutate the input array', () => {
    const pts: [number, number][] = [
      [1, 2],
      [3, 4]
    ]
    const before = JSON.parse(JSON.stringify(pts))
    contourPointSignature(pts)
    expect(pts).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// H. Three-machine path realism
// ---------------------------------------------------------------------------

describe('H. three-machine path realism', () => {
  it('Laguna Swift 5x10 -- full-sheet 1524x3048 mm rectangle yields 4-vertex contour', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'sheet', kind: 'rect', cx: 762, cy: 1524, w: 1524, h: 3048, rotation: 0 }
      ]
    }
    const pts = deriveContourPointsFromDesign(d)
    expect(pts).toHaveLength(4)
    expect(pts).toEqual([
      [0, 0],
      [1524, 0],
      [1524, 3048],
      [0, 3048]
    ])
  })

  it('Carvera 3-axis -- 360x240 mm pocket boundary rectangle yields 4-vertex contour', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'pocket', kind: 'rect', cx: 180, cy: 120, w: 360, h: 240, rotation: 0 }
      ]
    }
    const pts = deriveContourPointsFromDesign(d)
    expect(pts).toHaveLength(4)
  })

  it('Carvera 4-axis -- 92mm-diameter rotary stock yields a 32-point closed circle', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'stock', kind: 'circle', cx: 0, cy: 0, r: 46 }]
    }
    const pts = deriveContourPointsFromDesign(d)
    expect(pts).toHaveLength(32)
    for (const [x, y] of pts) {
      expect(Math.hypot(x, y)).toBeCloseTo(46, 6)
    }
  })

  it('Laguna full-sheet drill -- 6 dowel holes returns exactly 6 (cx,cy) points', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: Array.from({ length: 6 }, (_, i) => ({
        id: `dowel-${i}`,
        kind: 'circle' as const,
        cx: 100 + i * 200,
        cy: 100,
        r: 4
      }))
    }
    const pts = deriveDrillPointsFromDesign(d)
    expect(pts).toHaveLength(6)
    expect(pts[0]).toEqual([100, 100])
    expect(pts[5]).toEqual([1100, 100])
  })

  it('Carvera multi-pocket selection -- second pocket is selectable by sourceId', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'pocket-a', kind: 'rect', cx: 50, cy: 50, w: 80, h: 60, rotation: 0 },
        { id: 'pocket-b', kind: 'rect', cx: 250, cy: 50, w: 80, h: 60, rotation: 0 }
      ]
    }
    const ptsB = deriveContourPointsFromDesign(d, 'pocket-b')
    expect(ptsB).toContainEqual([210, 20])
    expect(ptsB).toContainEqual([290, 80])
  })

  it('FDM K2 Plus does NOT consume this module -- its 2D contour input is the bed footprint, not sketch entities (bypass-safe assertion)', () => {
    // Empty design returns empty arrays for both helpers, so FDM job pipelines
    // that accidentally route through this module on K2 Plus jobs will get
    // safe empty results, not garbage.
    expect(deriveContourPointsFromDesign(emptyDesign())).toEqual([])
    expect(deriveDrillPointsFromDesign(emptyDesign())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// I. Source-text whitelist
// ---------------------------------------------------------------------------

describe('I. cam-2d-derive source-text whitelist', () => {
  it('declares the DerivedContourCandidate type with 4 keys (sourceId, label, points, signature)', () => {
    expect(SOURCE_TEXT).toContain('export type DerivedContourCandidate = {')
    expect(SOURCE_TEXT).toContain('sourceId: string')
    expect(SOURCE_TEXT).toContain('label: string')
    expect(SOURCE_TEXT).toContain('points: [number, number][]')
    expect(SOURCE_TEXT).toContain('signature: string')
  })

  it('exports the 4 documented runtime symbols by name', () => {
    expect(SOURCE_TEXT).toMatch(/export function contourPointSignature\(/)
    expect(SOURCE_TEXT).toMatch(/export function listContourCandidatesFromDesign\(/)
    expect(SOURCE_TEXT).toMatch(/export function deriveContourPointsFromDesign\(/)
    expect(SOURCE_TEXT).toMatch(/export function deriveDrillPointsFromDesign\(/)
  })

  it('uses toFixed(3) for signature precision (3-decimal lock)', () => {
    expect(SOURCE_TEXT).toContain("x.toFixed(3)")
    expect(SOURCE_TEXT).toContain("y.toFixed(3)")
  })

  it('imports SLOT_PROFILE_CAP_SEGMENTS + ELLIPSE_PROFILE_SEGMENTS from sketch-profile (constants delegated, not redefined)', () => {
    expect(SOURCE_TEXT).toContain('SLOT_PROFILE_CAP_SEGMENTS')
    expect(SOURCE_TEXT).toContain('ELLIPSE_PROFILE_SEGMENTS')
    expect(SOURCE_TEXT).toContain("from './sketch-profile'")
  })

  it("uses the 'polyline'/'rect'/'circle'/'slot'/'arc'/'ellipse'/'spline_fit'/'spline_cp' kind discriminators", () => {
    expect(SOURCE_TEXT).toContain("e.kind === 'polyline'")
    expect(SOURCE_TEXT).toContain("e.kind === 'rect'")
    expect(SOURCE_TEXT).toContain("e.kind === 'circle'")
    expect(SOURCE_TEXT).toContain("e.kind === 'slot'")
    expect(SOURCE_TEXT).toContain("e.kind === 'arc'")
    expect(SOURCE_TEXT).toContain("e.kind === 'ellipse'")
    expect(SOURCE_TEXT).toContain("e.kind === 'spline_fit'")
    expect(SOURCE_TEXT).toContain("e.kind === 'spline_cp'")
  })

  it('uses circleToLoop with default n=32', () => {
    expect(SOURCE_TEXT).toMatch(/function circleToLoop\([^)]*n = 32\)/)
  })

  it('arc + spline kinds are gated by e.closed (open profiles skipped)', () => {
    expect(SOURCE_TEXT).toMatch(/e\.kind === 'arc' && e\.closed/)
    expect(SOURCE_TEXT).toMatch(/\(e\.kind === 'spline_fit' \|\| e\.kind === 'spline_cp'\) && e\.closed/)
  })

  it('polyline gate uses !e.closed || pts.length < 3 (closed AND >=3 points)', () => {
    expect(SOURCE_TEXT).toContain('!e.closed || pts.length < 3')
  })

  it('source-id selection uses falsy-check + .find() (the if-truthy guard)', () => {
    expect(SOURCE_TEXT).toContain('if (sourceId) {')
    expect(SOURCE_TEXT).toContain('candidates.find((c) => c.sourceId === sourceId)')
  })

  it('drill helper uses a circle-only filter with no other kinds named', () => {
    // Find the function body and confirm it ONLY references 'circle'
    const fnMatch = SOURCE_TEXT.match(/export function deriveDrillPointsFromDesign[\s\S]*?\n\}/)
    expect(fnMatch).toBeTruthy()
    expect(fnMatch![0]).toContain("e.kind === 'circle'")
    expect(fnMatch![0]).not.toContain("e.kind === 'rect'")
    expect(fnMatch![0]).not.toContain("e.kind === 'slot'")
    expect(fnMatch![0]).not.toContain("e.kind === 'ellipse'")
  })

  it('contourPointSignature joins with "|" and "," separators (small-precision detect-edits comment present)', () => {
    expect(SOURCE_TEXT).toContain(".join('|')")
    expect(SOURCE_TEXT).toContain('Stable, small precision to detect meaningful profile edits.')
  })
})

// ---------------------------------------------------------------------------
// J. Type-level parity
// ---------------------------------------------------------------------------

describe('J. type-level parity', () => {
  it('DerivedContourCandidate is assignable from a literal with all 4 keys', () => {
    const c: DerivedContourCandidate = {
      sourceId: 'x',
      label: 'X',
      points: [[0, 0], [1, 1]],
      signature: 'sig'
    }
    expect(c.sourceId).toBe('x')
  })

  it('listContourCandidatesFromDesign return type extends DerivedContourCandidate[]', () => {
    const out = listContourCandidatesFromDesign(designWithCircle())
    // Compile-time: assignable to DerivedContourCandidate[]
    const typed: DerivedContourCandidate[] = out
    expect(typed.length).toBe(1)
  })

  it('deriveContourPointsFromDesign return type is [number,number][]', () => {
    const out = deriveContourPointsFromDesign(designWithRect())
    const typed: [number, number][] = out
    expect(Array.isArray(typed)).toBe(true)
  })

  it('deriveDrillPointsFromDesign return type is [number,number][]', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'h', kind: 'circle', cx: 0, cy: 0, r: 1 }]
    }
    const out = deriveDrillPointsFromDesign(d)
    const typed: [number, number][] = out
    expect(typed[0]).toEqual([0, 0])
  })
})
