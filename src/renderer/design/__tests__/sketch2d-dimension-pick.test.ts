/**
 * Sketch S4 -- pure unit tests for the dimension label-pick geometry module.
 *
 * These are the load-bearing resolvers behind the dimension TOOL (entity/point
 * picks) and the SELECT-mode inline value edit (clicking a value label). Pure +
 * DOM-free, so they run under the repo's node env exactly like
 * `sketch2d-hit-test.test.ts` and the osnap/marquee unit suites.
 *
 * The render/source contracts for the canvas + surface live in
 * `Sketch2DCanvas.dimension.test.tsx` and the SketchSurface S4 pins.
 */

import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2, type SketchDimension } from '../../../shared/design-schema'
import {
  angularLinePointIds,
  DIMENSION_LABEL_PICK_PX,
  dimensionCurrentValue,
  dimensionLabelAnchorWorld,
  dimensionLabelPickToleranceMm,
  hitTestDimensionLabel,
  measuredDimensionValue,
  nearestPointIdWithin
} from '../sketch2d-dimension-pick'

/** A rect + a circle + a polyline with named vertices, plus a few dimensions. */
function fixture(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      a: { x: 0, y: 0 },
      b: { x: 40, y: 0 },
      c: { x: 40, y: 30 }
    },
    entities: [
      { id: 'circ', kind: 'circle', cx: 100, cy: 0, r: 12 },
      { id: 'pl', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false }
    ]
  }
}

describe('dimensionLabelAnchorWorld', () => {
  it('aligned/linear anchor = segment midpoint offset along the +normal by 5 mm', () => {
    const design = fixture()
    // a=(0,0) b=(40,0): midpoint (20,0); normal of +X is +Y, so anchor (20, +5).
    const dm: SketchDimension = { id: 'd1', kind: 'aligned', aId: 'a', bId: 'b' }
    const anchor = dimensionLabelAnchorWorld(dm, design)
    expect(anchor).not.toBeNull()
    expect(anchor![0]).toBeCloseTo(20, 6)
    expect(anchor![1]).toBeCloseTo(5, 6)
  })

  it('radial/diameter anchor = circle center + radius on +X (the rim text spot)', () => {
    const design = fixture()
    const dm: SketchDimension = { id: 'd2', kind: 'radial', entityId: 'circ' }
    const anchor = dimensionLabelAnchorWorld(dm, design)
    expect(anchor).not.toBeNull()
    expect(anchor![0]).toBeCloseTo(112, 6) // cx 100 + r 12
    expect(anchor![1]).toBeCloseTo(0, 6)
  })

  it('returns null when an endpoint is missing (deleted point)', () => {
    const design = fixture()
    const dm: SketchDimension = { id: 'd3', kind: 'aligned', aId: 'a', bId: 'gone' }
    expect(dimensionLabelAnchorWorld(dm, design)).toBeNull()
  })

  it('returns null for a zero-length linear dimension', () => {
    const design: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }
    }
    const dm: SketchDimension = { id: 'd4', kind: 'linear', aId: 'a', bId: 'b' }
    expect(dimensionLabelAnchorWorld(dm, design)).toBeNull()
  })
})

describe('hitTestDimensionLabel', () => {
  it('resolves a click within tolerance of a label anchor to that dimension id', () => {
    const design: DesignFileV2 = {
      ...fixture(),
      dimensions: [{ id: 'dimA', kind: 'aligned', aId: 'a', bId: 'b' }]
    }
    // anchor is (20, 5); click 1 mm away should hit at a 6 mm tolerance.
    const hit = hitTestDimensionLabel(design, [20.5, 5.5], 6)
    expect(hit?.dimId).toBe('dimA')
    expect(hit?.anchorWorld[0]).toBeCloseTo(20, 6)
  })

  it('misses when the click is outside tolerance of every label', () => {
    const design: DesignFileV2 = {
      ...fixture(),
      dimensions: [{ id: 'dimA', kind: 'aligned', aId: 'a', bId: 'b' }]
    }
    expect(hitTestDimensionLabel(design, [200, 200], 6)).toBeNull()
  })

  it('prefers the topmost (later) dimension on an exact anchor tie', () => {
    const design: DesignFileV2 = {
      ...fixture(),
      dimensions: [
        { id: 'under', kind: 'aligned', aId: 'a', bId: 'b' },
        { id: 'over', kind: 'aligned', aId: 'a', bId: 'b' }
      ]
    }
    const hit = hitTestDimensionLabel(design, [20, 5], 6)
    expect(hit?.dimId).toBe('over')
  })

  it('skips dimensions whose geometry no longer resolves', () => {
    const design: DesignFileV2 = {
      ...fixture(),
      dimensions: [{ id: 'stale', kind: 'aligned', aId: 'a', bId: 'gone' }]
    }
    expect(hitTestDimensionLabel(design, [20, 5], 6)).toBeNull()
  })

  it('label pick tolerance converts px to mm at the current zoom', () => {
    // 16 px / 4 px-per-mm = 4 mm.
    expect(dimensionLabelPickToleranceMm(4)).toBeCloseTo(DIMENSION_LABEL_PICK_PX / 4, 6)
    // clamps tiny scales so it never divides by ~0.
    expect(Number.isFinite(dimensionLabelPickToleranceMm(0))).toBe(true)
  })
})

describe('dimensionCurrentValue / measuredDimensionValue', () => {
  it('measured aligned distance is the Euclidean length', () => {
    const design = fixture()
    const dm: SketchDimension = { id: 'd', kind: 'aligned', aId: 'a', bId: 'b' }
    expect(measuredDimensionValue(dm, design)).toBeCloseTo(40, 6)
  })

  it('measured radial = radius; diameter = 2*radius', () => {
    const design = fixture()
    expect(measuredDimensionValue({ id: 'r', kind: 'radial', entityId: 'circ' }, design)).toBeCloseTo(
      12,
      6
    )
    expect(
      measuredDimensionValue({ id: 'd', kind: 'diameter', entityId: 'circ' }, design)
    ).toBeCloseTo(24, 6)
  })

  it('current value prefers the driven parameter over the measured value', () => {
    const design: DesignFileV2 = {
      ...fixture(),
      parameters: { w1: 55 }
    }
    const dm: SketchDimension = { id: 'd', kind: 'aligned', aId: 'a', bId: 'b', parameterKey: 'w1' }
    // measured would be 40; driven param is 55 -> current shows 55.
    expect(dimensionCurrentValue(dm, design)).toBeCloseTo(55, 6)
  })

  it('current value falls back to measured when the dim is annotation-only', () => {
    const design = fixture()
    const dm: SketchDimension = { id: 'd', kind: 'aligned', aId: 'a', bId: 'b' }
    expect(dimensionCurrentValue(dm, design)).toBeCloseTo(40, 6)
  })
})

describe('nearestPointIdWithin', () => {
  it('returns the nearest existing vertex id within tolerance', () => {
    const design = fixture()
    expect(nearestPointIdWithin(design, [41, 1], 3)).toBe('b')
  })

  it('returns null when no vertex is within tolerance', () => {
    const design = fixture()
    expect(nearestPointIdWithin(design, [500, 500], 3)).toBeNull()
  })
})

describe('angularLinePointIds (Sketch S5)', () => {
  function angularFixture(): DesignFileV2 {
    return {
      ...emptyDesign(),
      points: {
        a: { x: 0, y: 0 },
        b: { x: 10, y: 0 },
        c: { x: 10, y: 10 },
        s: { x: 30, y: 0 },
        v: { x: 33, y: 3 },
        e: { x: 36, y: 0 }
      },
      entities: [
        { id: 'pl', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false },
        { id: 'plClosed', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true },
        { id: 'arc', kind: 'arc', startId: 's', viaId: 'v', endId: 'e' },
        { id: 'circ', kind: 'circle', cx: 100, cy: 0, r: 12 }
      ]
    }
  }

  it('polyline edge 0 → its first two vertices', () => {
    expect(angularLinePointIds(angularFixture(), 'pl', 0)).toEqual({ aId: 'a', bId: 'b' })
  })

  it('polyline edge 1 → its second + third vertices', () => {
    expect(angularLinePointIds(angularFixture(), 'pl', 1)).toEqual({ aId: 'b', bId: 'c' })
  })

  it('closed polyline closing edge wraps last → first', () => {
    // 3 vertices closed → edges 0,1,2; edge 2 is c→a.
    expect(angularLinePointIds(angularFixture(), 'plClosed', 2)).toEqual({ aId: 'c', bId: 'a' })
  })

  it('an out-of-range edge index → null', () => {
    // open 3-vertex polyline has only edges 0 and 1.
    expect(angularLinePointIds(angularFixture(), 'pl', 2)).toBeNull()
  })

  it('arc → its chord (start → end), regardless of edge index', () => {
    expect(angularLinePointIds(angularFixture(), 'arc', 0)).toEqual({ aId: 's', bId: 'e' })
  })

  it('a circle (no straight edge) → null', () => {
    expect(angularLinePointIds(angularFixture(), 'circ', 0)).toBeNull()
  })

  it('an unknown entity id → null', () => {
    expect(angularLinePointIds(angularFixture(), 'nope', 0)).toBeNull()
  })
})
