/**
 * [ID-0190] Cycle 108 -- ui-polish paired-pin contract for the two pure
 * helpers exported from `sketch-preview-placement.ts`. The module is
 * load-bearing in two ways:
 *
 *   1. `DesignSessionContext.tsx` (line 223) reads
 *      `sketchPreviewPlacementMatrix(design.sketchPlane)` and uses the
 *      returned matrix to place the **preview mesh** in world space for
 *      every Three.js render in the Design tab (XY top, XZ front, YZ
 *      right datums + face-anchored sketches).
 *
 *   2. The kernel-side payload writer (`src/shared/sketch-profile.ts`
 *      line 511) declares: "`sketchPlane`: matches renderer
 *      `sketchPreviewPlacementMatrix`; `build_part.py` applies it after
 *      post-ops so STEP/STL align with preview." Drift in this matrix
 *      silently desynchronizes the on-screen preview from the kernel
 *      STEP/STL output -- the operator would dial a part in 3D, click
 *      kernel-build, and the produced solid would land in a different
 *      world frame from what they laid out.
 *
 * Because the renderer + kernel must agree on this transform across all
 * three target machines (Creality K2 Plus FDM print-bed sketches, Laguna
 * Swift 5x10 large-format sheet sketches, Makera Carvera + 4-axis indexed
 * sketches), this pin freezes the *exact* numerical contract of every
 * datum branch and the inverse-round-trip for `worldPointToSketchMm`.
 *
 * Pinned facts (any production drift WILL break a test here):
 *   - Datum XY: u=(1,0,0), v=(0,0,-1), n=(0,1,0). sketch-x -> world+X,
 *     sketch-y -> world-Z, extrude (+local Z) -> world+Y.
 *   - Datum XZ: ALIASED to XY (current historical preview behavior).
 *   - Datum YZ: u=(0,1,0), v=(0,0,1), n=(1,0,0). sketch-x -> world+Y,
 *     sketch-y -> world+Z, extrude -> world+X.
 *   - Face plane: orthonormal basis (u, v, n), v=n x u with handedness
 *     fixup, translation = origin. xAxis-zero / xAxis-parallel-to-normal
 *     fallbacks must yield a finite orthonormal basis.
 *   - Round-trip: `worldPointToSketchMm(plane, M*localXY)` returns the
 *     original (x, y) for every datum branch and for face planes.
 *
 * Mirrors the [ID-0186] Cycle 104 sketch2d-canvas-coords paired-pin
 * convention.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  sketchPreviewPlacementMatrix,
  worldPointToSketchMm
} from './sketch-preview-placement'
import type { SketchPlane } from '../../shared/design-schema'

const TOL = 1e-9

function basisOf(M: THREE.Matrix4): {
  u: THREE.Vector3
  v: THREE.Vector3
  n: THREE.Vector3
  t: THREE.Vector3
} {
  const e = M.elements // column-major
  return {
    u: new THREE.Vector3(e[0], e[1], e[2]),
    v: new THREE.Vector3(e[4], e[5], e[6]),
    n: new THREE.Vector3(e[8], e[9], e[10]),
    t: new THREE.Vector3(e[12], e[13], e[14])
  }
}

function applyM(M: THREE.Matrix4, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(M)
}

describe('[ID-0190] sketch-preview-placement -- datum XY', () => {
  const plane: SketchPlane = { kind: 'datum', datum: 'XY' }
  const M = sketchPreviewPlacementMatrix(plane)
  const { u, v, n, t } = basisOf(M)

  it('basis u = (1, 0, 0) (sketch X -> world +X)', () => {
    expect(u.x).toBe(1)
    expect(u.y).toBe(0)
    expect(u.z).toBe(0)
  })

  it('basis v = (0, 0, -1) (sketch Y -> world -Z, historical preview)', () => {
    expect(v.x).toBe(0)
    expect(v.y).toBe(0)
    expect(v.z).toBe(-1)
  })

  it('basis n = (0, 1, 0) (extrude +local Z -> world +Y)', () => {
    expect(n.x).toBe(0)
    expect(n.y).toBe(1)
    expect(n.z).toBe(0)
  })

  it('translation = (0, 0, 0) for datum planes', () => {
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
    expect(t.z).toBe(0)
  })

  it('orthonormal: u . v = 0, u . n = 0, v . n = 0; |u|=|v|=|n|=1', () => {
    expect(Math.abs(u.dot(v))).toBeLessThan(TOL)
    expect(Math.abs(u.dot(n))).toBeLessThan(TOL)
    expect(Math.abs(v.dot(n))).toBeLessThan(TOL)
    expect(Math.abs(u.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(v.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(n.length() - 1)).toBeLessThan(TOL)
  })

  it('right-handed: u x v = n', () => {
    const cross = new THREE.Vector3().crossVectors(u, v)
    expect(Math.abs(cross.x - n.x)).toBeLessThan(TOL)
    expect(Math.abs(cross.y - n.y)).toBeLessThan(TOL)
    expect(Math.abs(cross.z - n.z)).toBeLessThan(TOL)
  })

  it('local (10, 20, 0) -> world (10, 0, -20)', () => {
    const w = applyM(M, 10, 20, 0)
    expect(w.x).toBeCloseTo(10, 9)
    expect(w.y).toBeCloseTo(0, 9)
    expect(w.z).toBeCloseTo(-20, 9)
  })

  it('local (0, 0, 5) extrude -> world (0, 5, 0) (+Y)', () => {
    const w = applyM(M, 0, 0, 5)
    expect(w.x).toBeCloseTo(0, 9)
    expect(w.y).toBeCloseTo(5, 9)
    expect(w.z).toBeCloseTo(0, 9)
  })
})

describe('[ID-0190] sketch-preview-placement -- datum XZ (aliased to XY)', () => {
  const planeXY: SketchPlane = { kind: 'datum', datum: 'XY' }
  const planeXZ: SketchPlane = { kind: 'datum', datum: 'XZ' }
  const Mxy = sketchPreviewPlacementMatrix(planeXY)
  const Mxz = sketchPreviewPlacementMatrix(planeXZ)

  it('XZ matrix elements equal XY matrix elements (current alias behavior)', () => {
    for (let i = 0; i < 16; i++) {
      expect(Mxz.elements[i]).toBe(Mxy.elements[i])
    }
  })

  it('XZ basis is identical to XY basis', () => {
    const a = basisOf(Mxz)
    const b = basisOf(Mxy)
    expect(a.u.equals(b.u)).toBe(true)
    expect(a.v.equals(b.v)).toBe(true)
    expect(a.n.equals(b.n)).toBe(true)
  })
})

describe('[ID-0190] sketch-preview-placement -- datum YZ', () => {
  const plane: SketchPlane = { kind: 'datum', datum: 'YZ' }
  const M = sketchPreviewPlacementMatrix(plane)
  const { u, v, n, t } = basisOf(M)

  it('basis u = (0, 1, 0) (sketch X -> world +Y)', () => {
    expect(u.x).toBe(0)
    expect(u.y).toBe(1)
    expect(u.z).toBe(0)
  })

  it('basis v = (0, 0, 1) (sketch Y -> world +Z)', () => {
    expect(v.x).toBe(0)
    expect(v.y).toBe(0)
    expect(v.z).toBe(1)
  })

  it('basis n = (1, 0, 0) (extrude -> world +X)', () => {
    expect(n.x).toBe(1)
    expect(n.y).toBe(0)
    expect(n.z).toBe(0)
  })

  it('translation = (0, 0, 0)', () => {
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
    expect(t.z).toBe(0)
  })

  it('orthonormal + right-handed (u x v = n)', () => {
    expect(Math.abs(u.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(v.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(n.length() - 1)).toBeLessThan(TOL)
    const cross = new THREE.Vector3().crossVectors(u, v)
    expect(cross.distanceTo(n)).toBeLessThan(TOL)
  })

  it('local (3, 7, 0) -> world (0, 3, 7)', () => {
    const w = applyM(M, 3, 7, 0)
    expect(w.x).toBeCloseTo(0, 9)
    expect(w.y).toBeCloseTo(3, 9)
    expect(w.z).toBeCloseTo(7, 9)
  })

  it('local (0, 0, 11) extrude -> world (11, 0, 0) (+X)', () => {
    const w = applyM(M, 0, 0, 11)
    expect(w.x).toBeCloseTo(11, 9)
    expect(w.y).toBeCloseTo(0, 9)
    expect(w.z).toBeCloseTo(0, 9)
  })
})

describe('[ID-0190] sketch-preview-placement -- face plane (canonical orientation)', () => {
  const plane: SketchPlane = {
    kind: 'face',
    origin: [10, 20, 30],
    normal: [0, 0, 1],
    xAxis: [1, 0, 0]
  }
  const M = sketchPreviewPlacementMatrix(plane)
  const { u, v, n, t } = basisOf(M)

  it('translation = origin', () => {
    expect(t.x).toBe(10)
    expect(t.y).toBe(20)
    expect(t.z).toBe(30)
  })

  it('basis u = xAxis = (1, 0, 0)', () => {
    expect(u.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(TOL)
  })

  it('basis n = normal = (0, 0, 1)', () => {
    expect(n.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(TOL)
  })

  it('basis v = n x u = (0, 1, 0) (right-handed)', () => {
    expect(v.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(TOL)
  })

  it('orthonormal basis', () => {
    expect(Math.abs(u.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(v.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(n.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(u.dot(v))).toBeLessThan(TOL)
    expect(Math.abs(u.dot(n))).toBeLessThan(TOL)
    expect(Math.abs(v.dot(n))).toBeLessThan(TOL)
  })

  it('local (0, 0, 0) -> world = origin (10, 20, 30)', () => {
    const w = applyM(M, 0, 0, 0)
    expect(w.x).toBeCloseTo(10, 9)
    expect(w.y).toBeCloseTo(20, 9)
    expect(w.z).toBeCloseTo(30, 9)
  })
})

describe('[ID-0190] sketch-preview-placement -- face plane (xAxis sanitization)', () => {
  it('xAxis = (0, 0, 0) falls back to a finite orthonormal basis', () => {
    const plane: SketchPlane = {
      kind: 'face',
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      xAxis: [0, 0, 0]
    }
    const M = sketchPreviewPlacementMatrix(plane)
    const { u, v, n } = basisOf(M)
    // every component must be finite
    for (const vec of [u, v, n]) {
      expect(Number.isFinite(vec.x)).toBe(true)
      expect(Number.isFinite(vec.y)).toBe(true)
      expect(Number.isFinite(vec.z)).toBe(true)
      expect(Math.abs(vec.length() - 1)).toBeLessThan(TOL)
    }
    // basis must be orthogonal
    expect(Math.abs(u.dot(v))).toBeLessThan(TOL)
    expect(Math.abs(u.dot(n))).toBeLessThan(TOL)
    expect(Math.abs(v.dot(n))).toBeLessThan(TOL)
    // n must still equal the input normal
    expect(n.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(TOL)
  })

  it('xAxis parallel to normal projects out and falls back', () => {
    const plane: SketchPlane = {
      kind: 'face',
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      xAxis: [0, 0, 1]
    }
    const M = sketchPreviewPlacementMatrix(plane)
    const { u, v, n } = basisOf(M)
    // u must be perpendicular to n (the offending xAxis is fully projected out)
    expect(Math.abs(u.dot(n))).toBeLessThan(TOL)
    // basis still orthonormal
    expect(Math.abs(u.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(v.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(n.length() - 1)).toBeLessThan(TOL)
    expect(Math.abs(u.dot(v))).toBeLessThan(TOL)
  })

  it('non-unit normal is normalized (preserves direction)', () => {
    const plane: SketchPlane = {
      kind: 'face',
      origin: [0, 0, 0],
      normal: [0, 0, 7], // 7x along +Z
      xAxis: [1, 0, 0]
    }
    const M = sketchPreviewPlacementMatrix(plane)
    const { n } = basisOf(M)
    expect(Math.abs(n.length() - 1)).toBeLessThan(TOL)
    expect(n.z).toBeCloseTo(1, 9)
  })

  it('right-handed correction: cross(u, v) . n >= 0 (handedness fixup)', () => {
    // pick a tilted plane with a tilted xAxis and verify handedness
    const plane: SketchPlane = {
      kind: 'face',
      origin: [5, -3, 2],
      normal: [1, 1, 0],
      xAxis: [1, -1, 0]
    }
    const M = sketchPreviewPlacementMatrix(plane)
    const { u, v, n } = basisOf(M)
    const cross = new THREE.Vector3().crossVectors(u, v)
    expect(cross.dot(n)).toBeGreaterThan(0.999)
  })
})

describe('[ID-0190] sketch-preview-placement -- worldPointToSketchMm round-trip', () => {
  // Pick a small grid of sketch points and verify M^-1 * (M * p) == p
  // for every datum branch and a representative face plane. This is the
  // contract that makes click-to-sketch (3D pick -> 2D sketch coords)
  // exactly invertible across the renderer / build_part.py boundary.

  const samples: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [0, 25],
    [-12.5, 7.25],
    [123.456, -78.9],
    [1e-3, -1e-3]
  ]

  function runRoundTripForPlane(plane: SketchPlane, label: string): void {
    describe(label, () => {
      const M = sketchPreviewPlacementMatrix(plane)
      for (const [x, y] of samples) {
        it(`(${x}, ${y}) -> world -> sketch is identity`, () => {
          const world = new THREE.Vector3(x, y, 0).applyMatrix4(M)
          const back = worldPointToSketchMm(plane, world)
          expect(back.x).toBeCloseTo(x, 6)
          expect(back.y).toBeCloseTo(y, 6)
        })
      }
    })
  }

  runRoundTripForPlane({ kind: 'datum', datum: 'XY' }, 'datum XY')
  runRoundTripForPlane({ kind: 'datum', datum: 'XZ' }, 'datum XZ')
  runRoundTripForPlane({ kind: 'datum', datum: 'YZ' }, 'datum YZ')
  runRoundTripForPlane(
    {
      kind: 'face',
      origin: [10, 20, 30],
      normal: [0, 0, 1],
      xAxis: [1, 0, 0]
    },
    'face plane (canonical)'
  )
  runRoundTripForPlane(
    {
      kind: 'face',
      origin: [-5, 7, -3],
      normal: [1, 1, 0],
      xAxis: [1, -1, 0]
    },
    'face plane (tilted)'
  )
})

describe('[ID-0190] sketch-preview-placement -- kernel alignment fingerprint', () => {
  // The pin claims `build_part.py` applies the same transform after
  // post-ops. The renderer-side fingerprint is captured by the matrix
  // basis-vector triples for each datum branch. If a future cycle
  // changes one of these triples without updating the kernel-side
  // payload writer (`src/shared/sketch-profile.ts` line ~511) and the
  // build_part.py path, the preview will desync from the produced
  // STEP/STL. This fingerprint test fails *first*, before a user ever
  // sees the regression on disk.

  it('XY fingerprint: u=(1,0,0) v=(0,0,-1) n=(0,1,0)', () => {
    const M = sketchPreviewPlacementMatrix({ kind: 'datum', datum: 'XY' })
    const { u, v, n } = basisOf(M)
    expect([u.x, u.y, u.z, v.x, v.y, v.z, n.x, n.y, n.z]).toEqual([
      1, 0, 0,
      0, 0, -1,
      0, 1, 0
    ])
  })

  it('XZ fingerprint: aliased to XY', () => {
    const M = sketchPreviewPlacementMatrix({ kind: 'datum', datum: 'XZ' })
    const { u, v, n } = basisOf(M)
    expect([u.x, u.y, u.z, v.x, v.y, v.z, n.x, n.y, n.z]).toEqual([
      1, 0, 0,
      0, 0, -1,
      0, 1, 0
    ])
  })

  it('YZ fingerprint: u=(0,1,0) v=(0,0,1) n=(1,0,0)', () => {
    const M = sketchPreviewPlacementMatrix({ kind: 'datum', datum: 'YZ' })
    const { u, v, n } = basisOf(M)
    expect([u.x, u.y, u.z, v.x, v.y, v.z, n.x, n.y, n.z]).toEqual([
      0, 1, 0,
      0, 0, 1,
      1, 0, 0
    ])
  })
})
