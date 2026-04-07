import * as THREE from 'three'
import type { SketchPlane } from '../../shared/design-schema'

/**
 * Maps canonical preview mesh space (profile in XY, extrusion +Z) into world mm for Three.js.
 * Canonical matches `ExtrudeGeometry` / loft/revolve builders in `sketch-mesh.ts`.
 *
 * **Datum XY** reproduces the historical preview: sketch X→world X, sketch Y→world −Z, extrude →world +Y.
 * **`build_part.py`** applies the same transform (from payload `sketchPlane`) after post-ops so kernel STEP/STL match this preview.
 */
export function sketchPreviewPlacementMatrix(plane: SketchPlane): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  if (plane.kind === 'face') {
    const o = new THREE.Vector3(plane.origin[0], plane.origin[1], plane.origin[2])
    const n = new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]).normalize()
    let u = new THREE.Vector3(plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]).normalize()
    if (u.lengthSq() < 1e-10) u.set(1, 0, 0)
    u.addScaledVector(n, -u.dot(n)).normalize()
    if (u.lengthSq() < 1e-10) {
      u.set(0, 1, 0).addScaledVector(n, -n.y).normalize()
    }
    if (u.lengthSq() < 1e-10) u.set(0, 0, 1)
    const vUse = new THREE.Vector3().crossVectors(n, u).normalize()
    const chk = new THREE.Vector3().crossVectors(u, vUse)
    if (chk.dot(n) < 0) vUse.negate()
    m.makeBasis(u, vUse, n)
    m.setPosition(o)
    return m
  }
  if (plane.datum === 'XY') {
    m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0))
    return m
  }
  if (plane.datum === 'XZ') {
    // Sketch on XZ, extrude +local Z → world +Y; u×v = n
    m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0))
    return m
  }
  m.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
  return m
}

/** Map a world-space point (mm) to sketch **x,y** (mm) on the active sketch plane (inverse of `sketchPreviewPlacementMatrix`). */
export function worldPointToSketchMm(plane: SketchPlane, world: THREE.Vector3): { x: number; y: number } {
  const M = sketchPreviewPlacementMatrix(plane)
  const inv = new THREE.Matrix4().copy(M).invert()
  const local = new THREE.Vector3(world.x, world.y, world.z).applyMatrix4(inv)
  return { x: local.x, y: local.y }
}
