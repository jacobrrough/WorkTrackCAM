/**
 * DrawingView associative-dimension model — unit pin.
 *
 * The renderer test environment is `node` (no jsdom, no @testing-library), so
 * the interactive click→persist→re-resolve path in `DrawingView.tsx` cannot be
 * driven through a rendered component. All of that logic lives in the pure
 * `drawing-annotation-model.ts` module (the orchestration target), which IS
 * unit-testable. This suite pins the associativity contract that `DrawingView`
 * relies on:
 *
 *   1. Snap-resolved PERSISTENCE — a two-click placement that lands on snap
 *      points mints an anchored `DrawingDimension` whose endpoint `refId`s are
 *      the snapped features' `sourceId`s and whose `cachedPoint`s are the
 *      resolved coordinates. The result parses against the persistence schema
 *      (so it can be written into `sheet.annotations.dimensions`).
 *   2. The DANGLING flag — on re-projection, an anchor whose `refId` is gone
 *      flags its dimension `dangling` (drawn from the stale cachedPoint
 *      fallback); a resolved anchor refreshes its cachedPoint; a free anchor
 *      never dangles.
 *   3. The ordinate / baseline / chain expanders.
 *
 * Safety Rule 1: documentation overlays only — no G-code / STL touched.
 */

import { describe, expect, it } from 'vitest'
import {
  anchorFromClick,
  buildAngularDimension,
  buildDiameterDimension,
  buildLinearDimension,
  buildOrdinateDimension,
  buildRadialDimension,
  buildSnapIndex,
  expandBaselineSet,
  expandChainSet,
  expandOrdinateSet,
  isAssociativeAnchor,
  FREE_ANCHOR_REF_ID,
  reanchorDimension,
  reanchorDimensions,
  resolveAnchor,
  type FreshSnapPoint,
  type ResolvedClick,
} from '../drawing-annotation-model'
import {
  drawingSheetAnnotationsSchema,
  type DrawingDimension,
  type DrawingDimensionAnchor,
} from '../../../shared/drawing-annotation-schema'

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A click that snapped to a feature with the given sourceId. */
function snapClick(sourceId: string, x: number, y: number): ResolvedClick {
  return { sourceId, point: { x, y } }
}

/** A free (un-snapped) click at the given coordinate. */
function freeClick(x: number, y: number): ResolvedClick {
  return { sourceId: null, point: { x, y } }
}

function snapPoint(
  id: string,
  sourceId: string,
  x: number,
  y: number
): FreshSnapPoint {
  return { id, sourceId, x, y }
}

// ── (A) anchorFromClick + associativity classification ───────────────────────

describe('anchorFromClick', () => {
  it('carries the snapped sourceId as the anchor refId (the live link)', () => {
    const a = anchorFromClick(snapClick('e:edge-7', 12, 34))
    expect(a.refId).toBe('e:edge-7')
    expect(a.cachedPoint).toEqual({ x: 12, y: 34 })
    expect(isAssociativeAnchor(a)).toBe(true)
  })

  it('encodes a free click with the empty refId sentinel (non-associative)', () => {
    const a = anchorFromClick(freeClick(5, 6))
    expect(a.refId).toBe(FREE_ANCHOR_REF_ID)
    expect(a.cachedPoint).toEqual({ x: 5, y: 6 })
    expect(isAssociativeAnchor(a)).toBe(false)
  })
})

// ── (B) Snap-resolved persistence (two-click placement → DrawingDimension) ────

describe('anchored dimension builders — snap-resolved persistence', () => {
  it('buildLinearDimension records both anchors and the resolved distance', () => {
    const dim = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    expect(dim.kind).toBe('linear')
    expect(dim.start.refId).toBe('v:a')
    expect(dim.end.refId).toBe('v:b')
    expect(dim.start.cachedPoint).toEqual({ x: 0, y: 0 })
    expect(dim.end.cachedPoint).toEqual({ x: 30, y: 0 })
    expect(dim.value).toBeCloseTo(30)
    expect(dim.orientation).toBe('aligned')
    expect(typeof dim.id).toBe('string')
    expect(dim.id.length).toBeGreaterThan(0)
  })

  it('buildRadialDimension value is the center→on radius', () => {
    const dim = buildRadialDimension(snapClick('v:c', 10, 10), snapClick('v:r', 10, 25))
    expect(dim.kind).toBe('radial')
    expect(dim.center.refId).toBe('v:c')
    expect(dim.on.refId).toBe('v:r')
    expect(dim.value).toBeCloseTo(15)
  })

  it('buildDiameterDimension value is twice the center→on radius', () => {
    const dim = buildDiameterDimension(snapClick('v:c', 0, 0), snapClick('v:e', 8, 0))
    expect(dim.kind).toBe('diameter')
    expect(dim.value).toBeCloseTo(16)
  })

  it('buildAngularDimension records vertex/arms and the interior angle', () => {
    const dim = buildAngularDimension(
      snapClick('v:v', 0, 0),
      snapClick('v:a1', 10, 0),
      snapClick('v:a2', 0, 10)
    )
    expect(dim.kind).toBe('angular')
    expect(dim.vertex.refId).toBe('v:v')
    expect(dim.arm1.refId).toBe('v:a1')
    expect(dim.arm2.refId).toBe('v:a2')
    expect(dim.value).toBeCloseTo(90)
  })

  it('buildOrdinateDimension reads the signed coordinate delta along the axis', () => {
    const dimX = buildOrdinateDimension(snapClick('v:o', 5, 5), snapClick('v:f', 40, 100), 'x')
    expect(dimX.axis).toBe('x')
    expect(dimX.value).toBeCloseTo(35)
    const dimY = buildOrdinateDimension(snapClick('v:o', 5, 5), snapClick('v:f', 40, 100), 'y')
    expect(dimY.value).toBeCloseTo(95)
  })

  it('a placed dimension carrying snap anchors persists into the sheet annotations schema', () => {
    const dim = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    // The persisted shape must parse into sheet.annotations.dimensions byte-faithfully.
    const parsed = drawingSheetAnnotationsSchema.parse({ dimensions: [dim] })
    expect(parsed.dimensions).toHaveLength(1)
    const round = parsed.dimensions[0]
    expect(round).toEqual(dim)
    // And the associative link survived the round-trip.
    if (round.kind === 'linear') {
      expect(round.start.refId).toBe('v:a')
      expect(round.end.refId).toBe('v:b')
    }
  })

  it('a free-cursor placement persists too (non-associative anchors)', () => {
    const dim = buildLinearDimension(freeClick(1, 1), freeClick(2, 2))
    const parsed = drawingSheetAnnotationsSchema.parse({ dimensions: [dim] })
    expect(parsed.dimensions[0]).toEqual(dim)
    if (parsed.dimensions[0].kind === 'linear') {
      expect(parsed.dimensions[0].start.refId).toBe(FREE_ANCHOR_REF_ID)
    }
  })
})

// ── (C) Set expanders (ordinate / baseline / chain) ──────────────────────────

describe('set expanders', () => {
  it('expandBaselineSet dimensions every feature from the shared origin datum', () => {
    const members = expandBaselineSet(snapClick('v:0', 0, 0), [
      snapClick('v:1', 10, 0),
      snapClick('v:2', 25, 0),
    ])
    expect(members).toHaveLength(2)
    // All members share one setId and the same origin refId.
    const setIds = new Set(members.map((m) => m.setId))
    expect(setIds.size).toBe(1)
    expect(members.every((m) => m.origin.refId === 'v:0')).toBe(true)
    expect(members[0].feature.refId).toBe('v:1')
    expect(members[0].value).toBeCloseTo(10)
    expect(members[1].value).toBeCloseTo(25)
    // Member ids are unique.
    expect(new Set(members.map((m) => m.id)).size).toBe(2)
  })

  it('expandBaselineSet returns [] for no features', () => {
    expect(expandBaselineSet(snapClick('v:0', 0, 0), [])).toEqual([])
  })

  it('expandChainSet dimensions consecutive segments p_i → p_{i+1}', () => {
    const run = expandChainSet([
      snapClick('v:a', 0, 0),
      snapClick('v:b', 10, 0),
      snapClick('v:c', 30, 0),
    ])
    expect(run).toHaveLength(2)
    expect(new Set(run.map((m) => m.setId)).size).toBe(1)
    expect(run[0].start.refId).toBe('v:a')
    expect(run[0].end.refId).toBe('v:b')
    expect(run[0].value).toBeCloseTo(10)
    expect(run[1].start.refId).toBe('v:b')
    expect(run[1].end.refId).toBe('v:c')
    expect(run[1].value).toBeCloseTo(20)
  })

  it('expandChainSet needs at least two clicks', () => {
    expect(expandChainSet([])).toEqual([])
    expect(expandChainSet([snapClick('v:a', 0, 0)])).toEqual([])
  })

  it('expandOrdinateSet reads every feature from the origin along one axis', () => {
    const set = expandOrdinateSet(
      snapClick('v:o', 0, 0),
      [snapClick('v:1', 10, 5), snapClick('v:2', 20, 7)],
      'x'
    )
    expect(set).toHaveLength(2)
    expect(set.every((m) => m.axis === 'x')).toBe(true)
    expect(set[0].value).toBeCloseTo(10)
    expect(set[1].value).toBeCloseTo(20)
  })

  it('every expanded member parses into the persistence schema', () => {
    const dims: DrawingDimension[] = [
      ...expandBaselineSet(snapClick('v:0', 0, 0), [snapClick('v:1', 10, 0)]),
      ...expandChainSet([snapClick('v:a', 0, 0), snapClick('v:b', 5, 0)]),
      ...expandOrdinateSet(snapClick('v:o', 0, 0), [snapClick('v:f', 12, 0)], 'x'),
    ]
    const parsed = drawingSheetAnnotationsSchema.parse({ dimensions: dims })
    expect(parsed.dimensions).toHaveLength(3)
  })
})

// ── (D) resolveAnchor — single anchor re-resolution ──────────────────────────

describe('resolveAnchor', () => {
  const index = buildSnapIndex([snapPoint('s:1', 'v:a', 100, 200)])

  it('refreshes the cachedPoint when the refId resolves', () => {
    const stale: DrawingDimensionAnchor = { refId: 'v:a', cachedPoint: { x: 0, y: 0 } }
    const out = resolveAnchor(stale, index)
    expect(out.status).toBe('resolved')
    expect(out.anchor.cachedPoint).toEqual({ x: 100, y: 200 })
    expect(out.anchor.refId).toBe('v:a')
  })

  it('also resolves an anchor that recorded the snap-point id directly', () => {
    const stale: DrawingDimensionAnchor = { refId: 's:1', cachedPoint: { x: 0, y: 0 } }
    const out = resolveAnchor(stale, index)
    expect(out.status).toBe('resolved')
    expect(out.anchor.cachedPoint).toEqual({ x: 100, y: 200 })
  })

  it('flags dangling and KEEPS the stale cachedPoint when the refId is gone', () => {
    const stale: DrawingDimensionAnchor = { refId: 'v:GONE', cachedPoint: { x: 7, y: 9 } }
    const out = resolveAnchor(stale, index)
    expect(out.status).toBe('dangling')
    expect(out.anchor.cachedPoint).toEqual({ x: 7, y: 9 }) // graceful fallback
  })

  it('treats a free anchor as never dangling', () => {
    const free: DrawingDimensionAnchor = {
      refId: FREE_ANCHOR_REF_ID,
      cachedPoint: { x: 3, y: 4 },
    }
    const out = resolveAnchor(free, index)
    expect(out.status).toBe('free')
    expect(out.anchor.cachedPoint).toEqual({ x: 3, y: 4 })
  })
})

// ── (E) reanchorDimension / reanchorDimensions — the dangling flag ────────────

describe('reanchorDimension — per-dimension re-resolution', () => {
  it('refreshes a fully-resolved dimension and reports dangling=false', () => {
    const dim = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    // Part regenerated: same features, new projected coordinates.
    const fresh = [snapPoint('s:1', 'v:a', 5, 5), snapPoint('s:2', 'v:b', 45, 5)]
    const index = buildSnapIndex(fresh)
    const { dimension, dangling } = reanchorDimension(dim, index)
    expect(dangling).toBe(false)
    if (dimension.kind === 'linear') {
      expect(dimension.start.cachedPoint).toEqual({ x: 5, y: 5 })
      expect(dimension.end.cachedPoint).toEqual({ x: 45, y: 5 })
    }
    // Input is never mutated.
    expect(dim.start.cachedPoint).toEqual({ x: 0, y: 0 })
  })

  it('flags dangling when ONE anchor lost its feature, keeping that anchor stale', () => {
    const dim = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    // Only v:a survived the rebuild; v:b is gone.
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 5, 5)])
    const { dimension, dangling } = reanchorDimension(dim, index)
    expect(dangling).toBe(true)
    if (dimension.kind === 'linear') {
      expect(dimension.start.cachedPoint).toEqual({ x: 5, y: 5 }) // refreshed
      expect(dimension.end.cachedPoint).toEqual({ x: 30, y: 0 }) // stale fallback
    }
  })

  it('an angular dimension with a free synthesized arm does not dangle on that arm', () => {
    // Mirrors DrawingView's two-click angle: arm1 is a FREE synthetic point.
    const dim = buildAngularDimension(
      snapClick('v:v', 0, 0),
      freeClick(10, 0),
      snapClick('v:a2', 0, 10)
    )
    // Both real features survive; the free arm never dangles.
    const index = buildSnapIndex([
      snapPoint('s:1', 'v:v', 1, 1),
      snapPoint('s:2', 'v:a2', 1, 11),
    ])
    const { dangling } = reanchorDimension(dim, index)
    expect(dangling).toBe(false)
  })
})

describe('reanchorDimensions — list-level dangling set', () => {
  it('collects the ids of every dimension that lost an anchor', () => {
    const kept = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    const lost = buildRadialDimension(snapClick('v:c', 0, 0), snapClick('v:GONE', 0, 10))
    const persisted = [kept, lost]

    // Fresh geometry: v:a / v:b / v:c survive; v:GONE does not.
    const fresh = [
      snapPoint('s:1', 'v:a', 0, 0),
      snapPoint('s:2', 'v:b', 30, 0),
      snapPoint('s:3', 'v:c', 0, 0),
    ]
    const { dimensions, danglingIds } = reanchorDimensions(persisted, fresh)
    expect(dimensions).toHaveLength(2)
    expect(danglingIds.has(lost.id)).toBe(true)
    expect(danglingIds.has(kept.id)).toBe(false)
    expect(danglingIds.size).toBe(1)
  })

  it('with NO fresh snap points (failed/empty projection) every associative dim dangles', () => {
    const a = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    const b = buildLinearDimension(freeClick(0, 0), freeClick(1, 1)) // free → never dangles
    const { danglingIds } = reanchorDimensions([a, b], [])
    expect(danglingIds.has(a.id)).toBe(true)
    expect(danglingIds.has(b.id)).toBe(false)
  })

  it('re-resolved dimensions still parse into the persistence schema', () => {
    const dim = buildLinearDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0))
    const fresh = [snapPoint('s:1', 'v:a', 2, 2), snapPoint('s:2', 'v:b', 32, 2)]
    const { dimensions } = reanchorDimensions([dim], fresh)
    const parsed = drawingSheetAnnotationsSchema.parse({ dimensions })
    expect(parsed.dimensions[0].kind).toBe('linear')
  })
})
