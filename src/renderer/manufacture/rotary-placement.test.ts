/**
 * rotary-placement.test.ts — pins the pure orientation math that feeds the
 * Carvera 4-axis engine `placement`. This is CAM: a wrong placement cuts the
 * wrong topology, so the quick-sets are asserted to emit ONLY clean
 * axis-quadrant rotations / axial-only translations, and the radial estimate is
 * asserted to agree with the engine's own frame transform (`frame.ts`).
 *
 * Runs in the `node` vitest env (the helper is framework-free).
 */
import { describe, expect, it } from 'vitest'
import {
  type PartBounds,
  type Placement,
  IDENTITY_PLACEMENT,
  applyPlacementToPoint,
  boundsSize,
  buildPlacement,
  estimateRadialMax,
  identityPlacement,
  longestAxis,
  placementCenterOnChuck,
  placementForQuickSet,
  placementLayFlat,
  placementXIsRotationAxis,
  shortestAxis,
  withRotation,
  withRotationAxis
} from './rotary-placement'
import { meshToMachineFrame, type Triangle } from '../../main/cam-axis4/frame'

// A long-along-X bar: X∈[-50,50] (len 100), Y∈[-5,5], Z∈[-3,3].
const X_LONG: PartBounds = { min: { x: -50, y: -5, z: -3 }, max: { x: 50, y: 5, z: 3 } }
// A long-along-Y bar: Y is the longest dimension.
const Y_LONG: PartBounds = { min: { x: -5, y: -50, z: -3 }, max: { x: 5, y: 50, z: 3 } }
// A long-along-Z bar: Z is the longest dimension.
const Z_LONG: PartBounds = { min: { x: -5, y: -3, z: -50 }, max: { x: 5, y: 3, z: 50 } }
// A flat slab: X longest (80), Y medium (40), Z shortest (4).
const SLAB: PartBounds = { min: { x: -40, y: -20, z: -2 }, max: { x: 40, y: 20, z: 2 } }

/**
 * Post-placement axis-aligned extent of a bounds, re-centering the bbox first
 * (matching frame.ts step 1) and applying the SAME transform the engine uses.
 * Returns the X/Y/Z span of the 8 transformed corners. Lets the orientation
 * tests assert "the long axis now lies along X" in engine-space terms.
 */
function transformedExtent(p: Placement, b: PartBounds): { x: number; y: number; z: number } {
  const cx = (b.min.x + b.max.x) / 2
  const cy = (b.min.y + b.max.y) / 2
  const cz = (b.min.z + b.max.z) / 2
  const corners: Array<[number, number, number]> = [
    [b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z],
    [b.min.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.min.z],
    [b.min.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.max.z],
    [b.min.x, b.max.y, b.max.z], [b.max.x, b.max.y, b.max.z]
  ]
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const c of corners) {
    const t = applyPlacementToPoint(p, { x: c[0] - cx, y: c[1] - cy, z: c[2] - cz })
    if (t.x < minX) minX = t.x
    if (t.y < minY) minY = t.y
    if (t.z < minZ) minZ = t.z
    if (t.x > maxX) maxX = t.x
    if (t.y > maxY) maxY = t.y
    if (t.z > maxZ) maxZ = t.z
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
}

function isFinitePlacement(p: Placement): boolean {
  const all = [
    p.position.x, p.position.y, p.position.z,
    p.rotation.x, p.rotation.y, p.rotation.z,
    p.scale.x, p.scale.y, p.scale.z
  ]
  return all.every((n) => Number.isFinite(n))
}

/** Every rotation component is a multiple of 90 (an axis-quadrant rotation). */
function isAxisQuadrantRotation(p: Placement): boolean {
  return [p.rotation.x, p.rotation.y, p.rotation.z].every((d) => Number.isInteger(d / 90))
}

describe('buildPlacement', () => {
  it('fills missing parts with identity (0 translate/rotate, 1 scale)', () => {
    expect(buildPlacement({})).toEqual(IDENTITY_PLACEMENT)
  })

  it('collapses non-finite inputs to safe identity per axis', () => {
    const p = buildPlacement({
      position: { x: Number.NaN, y: 5, z: Number.POSITIVE_INFINITY },
      rotation: { x: 90, y: Number.NaN, z: -45 },
      scale: { x: 0, y: Number.NaN, z: 2 }
    })
    expect(p.position).toEqual({ x: 0, y: 5, z: 0 })
    expect(p.rotation).toEqual({ x: 90, y: 0, z: -45 })
    // scale 0 / NaN → 1 (never degenerate the mesh); explicit 2 preserved.
    expect(p.scale).toEqual({ x: 1, y: 1, z: 2 })
  })

  it('always yields a fully-finite placement', () => {
    expect(isFinitePlacement(buildPlacement({ rotation: { x: Number.NaN } }))).toBe(true)
  })
})

describe('withRotation / withRotationAxis', () => {
  it('replaces rotation while preserving position + scale', () => {
    const base = buildPlacement({ position: { x: 7 }, scale: { y: 3 } })
    const next = withRotation(base, { x: 90, z: 180 })
    expect(next.position.x).toBe(7)
    expect(next.scale.y).toBe(3)
    expect(next.rotation).toEqual({ x: 90, y: 0, z: 180 })
  })

  it('withRotationAxis sets exactly one axis', () => {
    const next = withRotationAxis(identityPlacement(), 'y', -90)
    expect(next.rotation).toEqual({ x: 0, y: -90, z: 0 })
  })
})

describe('bounds helpers', () => {
  it('boundsSize returns absolute extents', () => {
    expect(boundsSize(X_LONG)).toEqual({ x: 100, y: 10, z: 6 })
  })
  it('longestAxis / shortestAxis pick the right axis', () => {
    expect(longestAxis(X_LONG)).toBe('x')
    expect(longestAxis(Y_LONG)).toBe('y')
    expect(longestAxis(Z_LONG)).toBe('z')
    expect(shortestAxis(X_LONG)).toBe('z')
    expect(shortestAxis(SLAB)).toBe('z')
  })
})

describe('placementXIsRotationAxis', () => {
  it('is identity when the long axis is already X', () => {
    expect(placementXIsRotationAxis(X_LONG)).toEqual(IDENTITY_PLACEMENT)
  })

  it('uses engine-verified rotations (Y-long → Y90, Z-long → Z90, per the frame.ts Y↔Z swap)', () => {
    // NOTE: these are NOT the naive viewer-space rotations — frame.ts swaps
    // Y↔Z when mapping the gizmo Euler into rotateXYZDeg, so a Y-long part needs
    // a gizmo *Y* rotation (not Z) to land on the engine rotation axis. Verified
    // empirically against meshToMachineFrame (see the frame.ts-parity block).
    expect(placementXIsRotationAxis(Y_LONG).rotation).toEqual({ x: 0, y: 90, z: 0 })
    expect(placementXIsRotationAxis(Z_LONG).rotation).toEqual({ x: 0, y: 0, z: 90 })
  })

  it('degrades to identity (safe no-op) without bounds — never guesses', () => {
    expect(placementXIsRotationAxis(undefined)).toEqual(IDENTITY_PLACEMENT)
  })

  it('only ever emits axis-quadrant rotations', () => {
    for (const b of [X_LONG, Y_LONG, Z_LONG, SLAB]) {
      expect(isAxisQuadrantRotation(placementXIsRotationAxis(b))).toBe(true)
    }
  })

  it('actually brings the longest extent onto the rotation axis (X)', () => {
    // After the placement, the part's longest dimension must have the largest
    // post-transform X extent — i.e. it lies along the rotation axis.
    for (const b of [Y_LONG, Z_LONG]) {
      const p = placementXIsRotationAxis(b)
      const ext = transformedExtent(p, b)
      expect(ext.x).toBeGreaterThan(ext.y)
      expect(ext.x).toBeGreaterThan(ext.z)
      expect(ext.x).toBeCloseTo(boundsSize(b)[longestAxis(b)], 6)
    }
  })
})

describe('placementLayFlat', () => {
  it('keeps the long axis on X and puts the short extent radial-up (Z)', () => {
    // SLAB: X long (80), Y med (40), Z short (4). Lay-flat must keep X as the
    // largest post-transform extent and make Z (radial-up) the SMALLEST.
    const p = placementLayFlat(SLAB)
    expect(isAxisQuadrantRotation(p)).toBe(true)
    const ext = transformedExtent(p, SLAB)
    expect(ext.x).toBeCloseTo(80, 6) // long axis still axial
    expect(ext.z).toBeCloseTo(4, 6) // short axis radial-up
    expect(ext.z).toBeLessThan(ext.y)
  })

  it('degrades to identity without bounds', () => {
    expect(placementLayFlat(undefined)).toEqual(IDENTITY_PLACEMENT)
  })
})

describe('placementCenterOnChuck', () => {
  it('emits an axial (X) translation only — never radial Y/Z', () => {
    const p = placementCenterOnChuck(X_LONG)
    expect(p.position.y).toBe(0)
    expect(p.position.z).toBe(0)
    // halfX of a 100mm-long part = 50.
    expect(p.position.x).toBeCloseTo(50, 6)
  })

  it('preserves the orientation it composes after', () => {
    const oriented = placementXIsRotationAxis(Y_LONG) // rotates +90° about Z
    const centered = placementCenterOnChuck(Y_LONG, oriented)
    expect(centered.rotation).toEqual(oriented.rotation)
    // Y_LONG long axis is Y (extent 100) → axial half = 50.
    expect(centered.position.x).toBeCloseTo(50, 6)
  })

  it('degrades to a no-op axial shift without bounds', () => {
    expect(placementCenterOnChuck(undefined).position.x).toBe(0)
  })
})

describe('placementForQuickSet dispatch', () => {
  it('routes each id to its helper', () => {
    expect(placementForQuickSet('x_is_rotation_axis', identityPlacement(), Y_LONG)).toEqual(
      placementXIsRotationAxis(Y_LONG)
    )
    expect(placementForQuickSet('lay_flat', identityPlacement(), SLAB)).toEqual(placementLayFlat(SLAB))
    const cur = placementXIsRotationAxis(Y_LONG)
    expect(placementForQuickSet('center_on_chuck', cur, Y_LONG)).toEqual(
      placementCenterOnChuck(Y_LONG, cur)
    )
  })
})

describe('estimateRadialMax', () => {
  it('returns null without bounds', () => {
    expect(estimateRadialMax(identityPlacement(), undefined)).toBeNull()
  })

  it('for an X-long bar at identity, radial = √(maxY² + maxZ²) of the centered bbox', () => {
    // X_LONG centered: Y∈[-5,5], Z∈[-3,3] → max radial = √(5²+3²)=√34.
    const r = estimateRadialMax(identityPlacement(), X_LONG)
    expect(r).not.toBeNull()
    expect(r as number).toBeCloseTo(Math.hypot(5, 3), 6)
  })

  it('drops the radial extent after laying a Z-long part onto X', () => {
    // Z_LONG at identity presents Z=50 as radial → huge. After X-is-axis it
    // becomes axial, so radial shrinks dramatically.
    const before = estimateRadialMax(identityPlacement(), Z_LONG) as number
    const after = estimateRadialMax(placementXIsRotationAxis(Z_LONG), Z_LONG) as number
    expect(after).toBeLessThan(before)
    expect(after).toBeCloseTo(Math.hypot(5, 3), 6) // now only X-section radius
  })
})

// ── Engine-parity: the helper's transform must match frame.ts byte-for-byte ──
describe('frame.ts parity', () => {
  // Build a single-triangle "mesh" from three points so meshToMachineFrame runs.
  function triFrom(a: [number, number, number], b: [number, number, number], c: [number, number, number]): Triangle[] {
    return [[a, b, c]]
  }

  it('applyPlacementToPoint reproduces meshToMachineFrame (sans centering + axial X shift)', () => {
    const placement: Placement = buildPlacement({
      position: { x: 4, y: -2, z: 7 },
      rotation: { x: 30, y: -15, z: 90 },
      scale: { x: 1.5, y: 1, z: 0.5 }
    })
    // The triangle's bbox must be CENTERED AT THE ORIGIN so frame.ts's step-1
    // re-center is a no-op — only then does the helper (which intentionally does
    // not re-center) reproduce frame.ts's scale→rotate→translate math directly.
    // These three points have bbox min=[-10,-8,-6], max=[10,8,6] ⇒ center (0,0,0).
    const pts: Array<[number, number, number]> = [
      [-10, -8, -6],
      [10, 8, 6],
      [10, -8, 6]
    ]
    const stock = { lengthMm: 200, diameterMm: 80 }
    const baked = meshToMachineFrame(triFrom(pts[0]!, pts[1]!, pts[2]!), placement, stock)
    const halfLen = stock.lengthMm / 2
    for (let v = 0; v < 3; v++) {
      const mine = applyPlacementToPoint(placement, { x: pts[v]![0], y: pts[v]![1], z: pts[v]![2] })
      const theirs = baked.triangles[0]![v]!
      // frame.ts adds the axial half-length to X; subtract it to compare.
      expect(mine.x).toBeCloseTo(theirs[0] - halfLen, 9)
      expect(mine.y).toBeCloseTo(theirs[1], 9)
      expect(mine.z).toBeCloseTo(theirs[2], 9)
    }
  })

  it('END-TO-END: "X = rotation axis" run through frame.ts collapses radial extent below stock radius', () => {
    // A Z-long bar (50mm half-length along Z) presents a 50mm radial extent at
    // identity — it would NOT fit a Ø60 (r=30) stock and the engine validator
    // would reject it. After the quick-set it must lie axially and fit.
    const halfX = 5
    const halfY = 3
    const halfZ = 50
    const mesh: Triangle[] = [
      [
        [-halfX, -halfY, -halfZ],
        [halfX, halfY, halfZ],
        [halfX, -halfY, halfZ]
      ],
      [
        [-halfX, -halfY, -halfZ],
        [-halfX, halfY, -halfZ],
        [halfX, halfY, halfZ]
      ]
    ]
    const bounds: PartBounds = { min: { x: -halfX, y: -halfY, z: -halfZ }, max: { x: halfX, y: halfY, z: halfZ } }
    const stock = { lengthMm: 400, diameterMm: 60 }
    const stockRadius = stock.diameterMm / 2

    const atIdentity = meshToMachineFrame(mesh, identityPlacement(), stock)
    expect(atIdentity.meshRadialMax).toBeGreaterThan(stockRadius) // would be rejected

    const oriented = placementXIsRotationAxis(bounds)
    const afterQuickSet = meshToMachineFrame(mesh, oriented, stock)
    expect(afterQuickSet.meshRadialMax).toBeLessThan(atIdentity.meshRadialMax)
    expect(afterQuickSet.meshRadialMax).toBeLessThanOrEqual(stockRadius) // now fits
  })

  it("estimateRadialMax matches frame.ts meshRadialMax for an oriented part", () => {
    // Use a single triangle spanning the SLAB corners; orient with lay-flat.
    const placement = placementLayFlat(SLAB)
    const corners: Array<[number, number, number]> = [
      [SLAB.min.x, SLAB.min.y, SLAB.min.z],
      [SLAB.max.x, SLAB.max.y, SLAB.min.z],
      [SLAB.max.x, SLAB.min.y, SLAB.max.z]
    ]
    const stock = { lengthMm: 300, diameterMm: 120 }
    const baked = meshToMachineFrame([[corners[0]!, corners[1]!, corners[2]!]], placement, stock)
    // estimateRadialMax over the FULL bounds is an upper bound on any subset of
    // its corners, so it must be >= the engine's radial for these three corners.
    const est = estimateRadialMax(placement, SLAB) as number
    expect(est).toBeGreaterThanOrEqual(baked.meshRadialMax - 1e-6)
  })
})
