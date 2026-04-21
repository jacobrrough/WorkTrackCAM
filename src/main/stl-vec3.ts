/**
 * Vec3 transform helpers shared by the STL placement pipeline and the 4-axis
 * CAM engine.
 *
 * `frame.ts` (in `cam-axis4/`) must replicate `binary-stl-placement.ts`'s
 * transform order exactly — the `frame-parity.test.ts` invariant enforces it.
 * Keeping these three functions in a standalone module means both callers
 * share the same implementation without the 4-axis engine pulling all of
 * `binary-stl-placement.ts` into its chunk.
 */
import type { Vec3 } from './stl'

export function addVecStl(a: Vec3, t: readonly [number, number, number]): Vec3 {
  return [a[0] + t[0], a[1] + t[1], a[2] + t[2]]
}

export function mulVecStl(a: Vec3, s: readonly [number, number, number]): Vec3 {
  return [a[0] * s[0], a[1] * s[1], a[2] * s[2]]
}

export function rotateXYZDeg(v: Vec3, d: readonly [number, number, number]): Vec3 {
  const [x, y, z] = v
  const rx = (d[0] * Math.PI) / 180
  const ry = (d[1] * Math.PI) / 180
  const rz = (d[2] * Math.PI) / 180
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const y1 = y * cx - z * sx
  const z1 = y * sx + z * cx
  const x2 = x * cy + z1 * sy
  const z2 = -x * sy + z1 * cy
  const x3 = x2 * cz - y1 * sz
  const y3 = x2 * sz + y1 * cz
  return [x3, y3, z2]
}
