/**
 * Wave 3k — pure-helper tests for `cam-placement-transform.ts`.
 *
 * The PLACEMENT CONTRACT under test (Wave-3j nesting convention; see the
 * module header of cam-placement-transform.ts and true-shape-nfp.ts:49-59):
 * rotate the geometry CCW by `placementRotationDeg` about the LOCAL ORIGIN,
 * then translate so the ROTATED geometry's bbox min-corner lands at
 * `(placementXMm, placementYMm)`. ONE rigid transform per op, derived from
 * the OUTER contour, applied uniformly to contour + islands + drills.
 *
 * Cross-validation against the nesting engine's own `placedRawPointsMm`
 * lives in `src/main/cam-runner-2d-placement.test.ts` (next to the engine).
 */
import { describe, expect, it } from 'vitest'
import {
  applyPlacementToOperationParams2d,
  applyPlacementToPoints,
  applyRigidTransform2d,
  resolveCamPlacement2dFromParams,
  rigidTransformForPlacement,
  rotatePointCcwDeg,
  type CamPlacement2d
} from './cam-placement-transform'

/** CCW unit square-ish rectangle used across the contract tests. */
const SQ: [number, number][] = [
  [10, 20],
  [30, 20],
  [30, 40],
  [10, 40]
]

describe('resolveCamPlacement2dFromParams — identity guard', () => {
  it('returns null for undefined / empty params', () => {
    expect(resolveCamPlacement2dFromParams(undefined)).toBeNull()
    expect(resolveCamPlacement2dFromParams({})).toBeNull()
  })

  it('PARTIAL placements are identity — never a half-transform', () => {
    expect(resolveCamPlacement2dFromParams({ placementXMm: 5 })).toBeNull()
    expect(resolveCamPlacement2dFromParams({ placementXMm: 5, placementYMm: 7 })).toBeNull()
    expect(resolveCamPlacement2dFromParams({ placementRotationDeg: 90 })).toBeNull()
    expect(
      resolveCamPlacement2dFromParams({ placementYMm: 7, placementRotationDeg: 90 })
    ).toBeNull()
  })

  it('non-finite / non-number components are identity', () => {
    expect(
      resolveCamPlacement2dFromParams({
        placementXMm: Number.NaN,
        placementYMm: 7,
        placementRotationDeg: 0
      })
    ).toBeNull()
    expect(
      resolveCamPlacement2dFromParams({
        placementXMm: 5,
        placementYMm: Number.POSITIVE_INFINITY,
        placementRotationDeg: 0
      })
    ).toBeNull()
    expect(
      resolveCamPlacement2dFromParams({
        placementXMm: 5,
        placementYMm: 7,
        placementRotationDeg: '90'
      })
    ).toBeNull()
  })

  it('complete placement resolves; sheetIndex 0 / absent both accepted', () => {
    const full = { placementXMm: 5, placementYMm: 7, placementRotationDeg: 90 }
    expect(resolveCamPlacement2dFromParams(full)).toEqual({ xMm: 5, yMm: 7, rotationDeg: 90 })
    expect(
      resolveCamPlacement2dFromParams({ ...full, placementSheetIndex: 0 })
    ).toEqual({ xMm: 5, yMm: 7, rotationDeg: 90 })
  })

  it('multi-sheet honesty: placementSheetIndex other than 0 is identity', () => {
    const full = { placementXMm: 5, placementYMm: 7, placementRotationDeg: 0 }
    expect(resolveCamPlacement2dFromParams({ ...full, placementSheetIndex: 1 })).toBeNull()
    expect(resolveCamPlacement2dFromParams({ ...full, placementSheetIndex: 2 })).toBeNull()
  })
})

describe('rotatePointCcwDeg — exact cardinal branches (bit-parity with the NFP engine)', () => {
  it('matches the true-shape-nfp rotatePointsDeg mapping for cardinals', () => {
    expect(rotatePointCcwDeg(3, 5, 0)).toEqual([3, 5])
    expect(rotatePointCcwDeg(3, 5, 90)).toEqual([-5, 3])
    expect(rotatePointCcwDeg(3, 5, 180)).toEqual([-3, -5])
    expect(rotatePointCcwDeg(3, 5, 270)).toEqual([5, -3])
    // Normalisation into [0, 360): -90 ≡ 270, 450 ≡ 90.
    expect(rotatePointCcwDeg(3, 5, -90)).toEqual([5, -3])
    expect(rotatePointCcwDeg(3, 5, 450)).toEqual([-5, 3])
  })

  it('is CCW for the general branch (45° moves +X toward +Y)', () => {
    const [x, y] = rotatePointCcwDeg(1, 0, 45)
    expect(x).toBeCloseTo(Math.SQRT1_2, 12)
    expect(y).toBeCloseTo(Math.SQRT1_2, 12)
  })
})

describe('applyPlacementToPoints — the exact contract, hand-computed', () => {
  it('rot 90 about the LOCAL ORIGIN, then rotated-bbox-min to (xMm, yMm)', () => {
    // Rotate SQ 90° CCW about (0,0): (x,y) → (-y,x)
    //   (10,20)→(-20,10)  (30,20)→(-20,30)  (30,40)→(-40,30)  (10,40)→(-40,10)
    // Rotated bbox min = (-40, 10). Placement (5, 7) ⇒ translate (+45, -3).
    const out = applyPlacementToPoints(SQ, { xMm: 5, yMm: 7, rotationDeg: 90 })
    expect(out).toEqual([
      [25, 7],
      [25, 27],
      [5, 27],
      [5, 7]
    ])
  })

  it('rot 0 is a pure translate by (xMm - bboxMinX, yMm - bboxMinY)', () => {
    const out = applyPlacementToPoints(SQ, { xMm: 60.5, yMm: 120.25, rotationDeg: 0 })
    expect(out).toEqual([
      [60.5, 120.25],
      [80.5, 120.25],
      [80.5, 140.25],
      [60.5, 140.25]
    ])
  })

  it('rot 180: rotated bbox-min convention is rotation-centre invariant', () => {
    // (x,y) → (-x,-y); rotated bbox min = (-30,-40); placement (0,0) ⇒ +(30,40).
    const out = applyPlacementToPoints(SQ, { xMm: 0, yMm: 0, rotationDeg: 180 })
    expect(out).toEqual([
      [20, 20],
      [0, 20],
      [0, 0],
      [20, 0]
    ])
  })

  it('non-cardinal 45°: result bbox-min lands exactly at (xMm, yMm) and lengths are preserved (rigid)', () => {
    const placement: CamPlacement2d = { xMm: 100, yMm: 250, rotationDeg: 45 }
    const out = applyPlacementToPoints(SQ, placement)
    const minX = Math.min(...out.map((p) => p[0]))
    const minY = Math.min(...out.map((p) => p[1]))
    expect(minX).toBeCloseTo(100, 9)
    expect(minY).toBeCloseTo(250, 9)
    // Rigid: edge lengths survive (20 × 20 rectangle edges).
    const d = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1])
    expect(d(out[0]!, out[1]!)).toBeCloseTo(20, 9)
    expect(d(out[1]!, out[2]!)).toBeCloseTo(20, 9)
  })

  it('empty input yields empty output (no transform derivable)', () => {
    expect(applyPlacementToPoints([], { xMm: 5, yMm: 7, rotationDeg: 90 })).toEqual([])
  })

  it('a self-placement (xMm,yMm = own bbox min, rot 0) is a bit-exact no-op', () => {
    const out = applyPlacementToPoints(SQ, { xMm: 10, yMm: 20, rotationDeg: 0 })
    expect(out).toEqual(SQ)
  })
})

describe('applyPlacementToOperationParams2d — ONE rigid transform per op', () => {
  const OUTER: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 30],
    [0, 30]
  ]
  const ISLAND: [number, number][] = [
    [10, 10],
    [15, 10],
    [15, 15],
    [10, 15]
  ]
  const DRILLS: [number, number][] = [
    [20, 15],
    [35, 25]
  ]

  function placedParams(rotationDeg: number): Record<string, unknown> {
    return {
      contourPoints: OUTER.map((p) => [...p]),
      islandRings: [ISLAND.map((p) => [...p])],
      drillPoints: DRILLS.map((p) => [...p]),
      toolDiameterMm: 6,
      placementXMm: 100,
      placementYMm: 50,
      placementRotationDeg: rotationDeg,
      placementNestVersion: 'nfp-v2',
      placementSheetIndex: 0
    }
  }

  function pointsOf(v: unknown): [number, number][] {
    expect(Array.isArray(v)).toBe(true)
    return (v as unknown[]).map((e) => {
      expect(Array.isArray(e)).toBe(true)
      const a = e as number[]
      return [a[0]!, a[1]!]
    })
  }

  it.each([45, 90, 180])(
    'rotation %d°: islands + drills keep their relative offsets inside the rotated outer (rigid body)',
    (rot) => {
      const out = applyPlacementToOperationParams2d(placedParams(rot))
      expect(out).toBeDefined()
      const oc = pointsOf(out!['contourPoints'])
      const rings = out!['islandRings'] as unknown[]
      const oi = pointsOf(rings[0])
      const od = pointsOf(out!['drillPoints'])

      // The OUTER's rotated bbox-min lands exactly at (100, 50): the
      // translation is derived from the OUTER ring, not any interior array.
      const minX = Math.min(...oc.map((p) => p[0]))
      const minY = Math.min(...oc.map((p) => p[1]))
      expect(minX).toBeCloseTo(100, 9)
      expect(minY).toBeCloseTo(50, 9)

      // Rigid body: for the shared transform T, T(p) - T(q) = R(p - q).
      // Anchor on outer vertex 0 and check every island vertex + drill point.
      const anchorBefore = OUTER[0]!
      const anchorAfter = oc[0]!
      const checkRelative = (before: [number, number], after: [number, number]): void => {
        const [ex, ey] = rotatePointCcwDeg(before[0] - anchorBefore[0], before[1] - anchorBefore[1], rot)
        expect(after[0] - anchorAfter[0]).toBeCloseTo(ex, 9)
        expect(after[1] - anchorAfter[1]).toBeCloseTo(ey, 9)
      }
      ISLAND.forEach((p, i) => checkRelative(p, oi[i]!))
      DRILLS.forEach((p, i) => checkRelative(p, od[i]!))
    }
  )

  it('returns the SAME object reference when no placement params are present (identity pin)', () => {
    const params: Record<string, unknown> = {
      contourPoints: OUTER.map((p) => [...p]),
      islandRings: [ISLAND.map((p) => [...p])],
      drillPoints: DRILLS.map((p) => [...p]),
      toolDiameterMm: 6
    }
    expect(applyPlacementToOperationParams2d(params)).toBe(params)
    expect(applyPlacementToOperationParams2d(undefined)).toBeUndefined()
  })

  it('returns the SAME reference for partial placement and for overflow sheetIndex', () => {
    const partial: Record<string, unknown> = {
      contourPoints: OUTER.map((p) => [...p]),
      placementXMm: 500
    }
    expect(applyPlacementToOperationParams2d(partial)).toBe(partial)

    const overflow: Record<string, unknown> = {
      contourPoints: OUTER.map((p) => [...p]),
      placementXMm: 500,
      placementYMm: 700,
      placementRotationDeg: 0,
      placementSheetIndex: 1
    }
    expect(applyPlacementToOperationParams2d(overflow)).toBe(overflow)
  })

  it('returns the SAME reference when there is no transformable geometry at all', () => {
    const noGeometry: Record<string, unknown> = {
      placementXMm: 5,
      placementYMm: 7,
      placementRotationDeg: 0,
      spindleRpm: 12000
    }
    expect(applyPlacementToOperationParams2d(noGeometry)).toBe(noGeometry)
  })

  it('does not mutate the input params object and carries non-geometry params through', () => {
    const params = placedParams(90)
    const snapshot = JSON.parse(JSON.stringify(params)) as Record<string, unknown>
    const out = applyPlacementToOperationParams2d(params)
    expect(params).toEqual(snapshot) // input untouched
    expect(out).not.toBe(params)
    expect(out!['toolDiameterMm']).toBe(6)
    expect(out!['placementNestVersion']).toBe('nfp-v2')
    expect(out!['placementXMm']).toBe(100) // bookkeeping preserved for honesty
  })

  it('drill-only ops (no contour) derive the bbox from the drill pattern itself', () => {
    const params: Record<string, unknown> = {
      drillPoints: DRILLS.map((p) => [...p]),
      placementXMm: 200,
      placementYMm: 300,
      placementRotationDeg: 0
    }
    const out = applyPlacementToOperationParams2d(params)
    const od = pointsOf(out!['drillPoints'])
    // Drill bbox min = (20, 15) ⇒ translate (+180, +285).
    expect(od).toEqual([
      [200, 300],
      [215, 310]
    ])
  })

  it('mirrors the dispatcher parse exactly: invalid entries preserved verbatim, coercible entries transformed', () => {
    const bad = ['x', 5]
    const params: Record<string, unknown> = {
      contourPoints: [[0, 0], [10, 0], ['7', '8'], bad, [10, 10, 99]],
      placementXMm: 100,
      placementYMm: 200,
      placementRotationDeg: 0
    }
    const out = applyPlacementToOperationParams2d(params)
    const raw = out!['contourPoints'] as unknown[]
    expect(raw).toHaveLength(5) // raw count unchanged — validation behavior identical
    // Valid bbox source = (0,0),(10,0),(7,8),(10,10) ⇒ bbox min (0,0) ⇒ +(100,200).
    expect(raw[0]).toEqual([100, 200])
    expect(raw[1]).toEqual([110, 200])
    expect(raw[2]).toEqual([107, 208]) // Number('7')/Number('8') coercion, like point2d
    expect(raw[3]).toBe(bad) // rejected by point2d ⇒ preserved by reference
    expect(raw[4]).toEqual([110, 210]) // extras beyond [x,y] dropped, same as point2d
  })
})

describe('rigidTransformForPlacement / applyRigidTransform2d — composition sanity', () => {
  it('composes to the same result as applyPlacementToPoints on the outer ring', () => {
    const placement: CamPlacement2d = { xMm: 12.5, yMm: 30.25, rotationDeg: 270 }
    const t = rigidTransformForPlacement(SQ, placement)
    expect(t).not.toBeNull()
    const viaTransform = SQ.map((p) => applyRigidTransform2d(p, t!))
    expect(viaTransform).toEqual(applyPlacementToPoints(SQ, placement))
  })

  it('returns null for an empty outer ring', () => {
    expect(rigidTransformForPlacement([], { xMm: 0, yMm: 0, rotationDeg: 0 })).toBeNull()
  })
})
