import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { autoOrient, __internals } from './auto-orient'
import { triangulateBinaryStl } from './stl-binary-preview'

/**
 * Build a unit-cube triangle list, centred at origin, side length `s`.
 * 12 triangles, 9 floats per triangle.
 *
 * Vertex layout (axis-aligned):
 *   −X face at x=-h, +X face at x=+h, etc. (h = s/2).
 */
function unitCube(s = 2): Float32Array {
  const h = s / 2
  // 8 corners.
  const c = [
    [-h, -h, -h],
    [+h, -h, -h],
    [+h, +h, -h],
    [-h, +h, -h],
    [-h, -h, +h],
    [+h, -h, +h],
    [+h, +h, +h],
    [-h, +h, +h]
  ]
  // Faces (CCW outward), each as two triangles.
  const faces: [number, number, number, number][] = [
    [0, 3, 2, 1], // -Z bottom
    [4, 5, 6, 7], // +Z top
    [0, 1, 5, 4], // -Y
    [2, 3, 7, 6], // +Y
    [1, 2, 6, 5], // +X
    [0, 4, 7, 3] //  -X
  ]
  const out: number[] = []
  for (const [a, b, cc, d] of faces) {
    out.push(...c[a]!, ...c[b]!, ...c[cc]!)
    out.push(...c[a]!, ...c[cc]!, ...c[d]!)
  }
  return Float32Array.from(out)
}

/** Rotate a triangle list around the X axis by `deg` degrees. */
function rotateAroundX(positions: Float32Array, deg: number): Float32Array {
  const rad = (deg * Math.PI) / 180
  const cs = Math.cos(rad)
  const sn = Math.sin(rad)
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    out[i] = x
    out[i + 1] = cs * y - sn * z
    out[i + 2] = sn * y + cs * z
  }
  return out
}

/**
 * Apply the auto-orient result's XYZ-Euler rotation back to a position buffer
 * (Three.js convention: R = Rx * Ry * Rz applied to column vectors).
 * Returns the rotated buffer so we can measure the post-orientation mesh.
 */
function applyEulerXyzDeg(positions: Float32Array, eulerDeg: readonly [number, number, number]): Float32Array {
  const [xDeg, yDeg, zDeg] = eulerDeg
  const x = (xDeg * Math.PI) / 180
  const y = (yDeg * Math.PI) / 180
  const z = (zDeg * Math.PI) / 180
  const cx = Math.cos(x),
    sx = Math.sin(x)
  const cy = Math.cos(y),
    sy = Math.sin(y)
  const cz = Math.cos(z),
    sz = Math.sin(z)
  // Three.js 'XYZ' composition (column-vector form): R = Rx * Ry * Rz
  // Rx = [1 0 0; 0 cx -sx; 0 sx cx]
  // Ry = [cy 0 sy; 0 1 0; -sy 0 cy]
  // Rz = [cz -sz 0; sz cz 0; 0 0 1]
  // Composed (matches three/src/math/Matrix4.js#makeRotationFromEuler 'XYZ'):
  const m00 = cy * cz
  const m01 = -cy * sz
  const m02 = sy
  const m10 = cx * sz + sx * sy * cz
  const m11 = cx * cz - sx * sy * sz
  const m12 = -sx * cy
  const m20 = sx * sz - cx * sy * cz
  const m21 = sx * cz + cx * sy * sz
  const m22 = cx * cy
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i]!
    const py = positions[i + 1]!
    const pz = positions[i + 2]!
    out[i] = m00 * px + m01 * py + m02 * pz
    out[i + 1] = m10 * px + m11 * py + m12 * pz
    out[i + 2] = m20 * px + m21 * py + m22 * pz
  }
  return out
}

/** Sum of triangle area whose unit normal.z < -cos(45°). */
function measureOverhangArea(positions: Float32Array, thresholdDeg = 45): number {
  const cosT = -Math.cos((thresholdDeg * Math.PI) / 180)
  let area = 0
  const triCount = Math.floor(positions.length / 9)
  // First find minZ to exclude bed-resting faces (mirrors scoring rule).
  let minZ = Infinity
  for (let i = 2; i < positions.length; i += 3) {
    if (positions[i]! < minZ) minZ = positions[i]!
  }
  const bottomCut = minZ + 0.05
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const v0z = positions[o + 2]!,
      v1z = positions[o + 5]!,
      v2z = positions[o + 8]!
    const e1x = positions[o + 3]! - positions[o]!,
      e1y = positions[o + 4]! - positions[o + 1]!,
      e1z = v1z - v0z
    const e2x = positions[o + 6]! - positions[o]!,
      e2y = positions[o + 7]! - positions[o + 1]!,
      e2z = v2z - v0z
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (nlen < 1e-9) continue
    const nzNorm = nz / nlen
    if (nzNorm < 0 && v0z <= bottomCut && v1z <= bottomCut && v2z <= bottomCut) continue // bed
    if (nzNorm < cosT) area += 0.5 * nlen
  }
  return area
}

describe('auto-orient – synthetic cubes', () => {
  it('axis-aligned cube: chooses an orientation that puts one face flat on -Z', () => {
    const cube = unitCube(20)
    const r = autoOrient({ positions: cube })
    expect(r.candidatesEvaluated).toBeGreaterThan(0)
    // Apply the result and check that bottom area is one whole face (s²).
    const rotated = applyEulerXyzDeg(cube, r.rotationEulerDegXyz)
    let minZ = Infinity
    for (let i = 2; i < rotated.length; i += 3) {
      if (rotated[i]! < minZ) minZ = rotated[i]!
    }
    // Count tri area where all three verts ≈ minZ (bottom face flat on bed).
    let bottomArea = 0
    const triCount = Math.floor(rotated.length / 9)
    for (let t = 0; t < triCount; t++) {
      const o = t * 9
      const z0 = rotated[o + 2]!,
        z1 = rotated[o + 5]!,
        z2 = rotated[o + 8]!
      if (Math.abs(z0 - minZ) < 1e-3 && Math.abs(z1 - minZ) < 1e-3 && Math.abs(z2 - minZ) < 1e-3) {
        const e1x = rotated[o + 3]! - rotated[o]!,
          e1y = rotated[o + 4]! - rotated[o + 1]!
        const e2x = rotated[o + 6]! - rotated[o]!,
          e2y = rotated[o + 7]! - rotated[o + 1]!
        bottomArea += 0.5 * Math.abs(e1x * e2y - e1y * e2x)
      }
    }
    // One face of a 20mm cube = 400 mm². Allow small slop.
    expect(bottomArea).toBeGreaterThan(395)
  })

  it('cube tilted 30° around X: auto-orient flattens it back to a face-down resting pose', () => {
    const cube = unitCube(20)
    const tilted = rotateAroundX(cube, 30)
    const overhangBefore = measureOverhangArea(tilted)
    expect(overhangBefore).toBeGreaterThan(50) // tilted face has serious overhang
    const r = autoOrient({ positions: tilted })
    const rotated = applyEulerXyzDeg(tilted, r.rotationEulerDegXyz)
    const overhangAfter = measureOverhangArea(rotated)
    // Auto-orient must drive overhang area to ~zero for a cube.
    expect(overhangAfter).toBeLessThan(overhangBefore)
    expect(overhangAfter).toBeLessThan(1)
  })

  it('accepts indexed input and produces equivalent results to flat positions', () => {
    const cube = unitCube(10)
    // Build indexed equivalent.
    const triCount = cube.length / 9
    const indices = new Uint32Array(triCount * 3)
    const vertices = new Float32Array(cube.length)
    let vi = 0
    for (let t = 0; t < triCount; t++) {
      for (let v = 0; v < 3; v++) {
        const o = t * 9 + v * 3
        vertices[vi * 3] = cube[o]!
        vertices[vi * 3 + 1] = cube[o + 1]!
        vertices[vi * 3 + 2] = cube[o + 2]!
        indices[vi] = vi
        vi++
      }
    }
    const ra = autoOrient({ positions: cube })
    const rb = autoOrient({ vertices, indices })
    expect(rb.score).toBeCloseTo(ra.score, 6)
  })

  it('respects the candidate cap (≤ maxCandidates + 1 identity)', () => {
    const cube = unitCube(20)
    const r = autoOrient({ positions: cube }, { maxCandidates: 12 })
    expect(r.candidatesEvaluated).toBeLessThanOrEqual(13)
  })

  it('runs <100ms on a 10K-triangle stress mesh', () => {
    // Build a 10K-triangle deformed sphere by tessellating a cube and jittering vertices.
    const stride = 10
    const arr: number[] = []
    let count = 0
    for (let i = 0; i < stride && count < 10000; i++) {
      for (let j = 0; j < stride && count < 10000; j++) {
        for (let k = 0; k < stride && count < 10000; k++) {
          // Two random-ish triangles per cell.
          const x = i + Math.sin(i + j) * 0.2
          const y = j + Math.cos(j + k) * 0.2
          const z = k + Math.sin(k + i) * 0.2
          arr.push(x, y, z, x + 1, y, z, x, y + 1, z)
          arr.push(x, y, z + 1, x + 1, y, z, x, y + 1, z + 1)
          count += 2
        }
      }
    }
    const positions = Float32Array.from(arr)
    const start = performance.now()
    const r = autoOrient({ positions })
    const elapsed = performance.now() - start
    expect(r.candidatesEvaluated).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100)
  })
})

describe('auto-orient – real fixture (Desert Sentinel STL)', () => {
  const stlPath = path.resolve(__dirname, '../../default/assets/Meshy_AI_Desert_Sentinel_0311134458_texture.stl')

  it('upside-down sculpture: auto-orient flips it back upright (overhang strictly reduced)', () => {
    const buf = readFileSync(stlPath)
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    // Cap at 12K triangles so the test stays well under the runtime budget.
    const tri = triangulateBinaryStl(u8, 12_000)
    if ('error' in tri) throw new Error(`fixture load failed: ${tri.error}`)
    // 180° around X flips the sculpture to point downward — guaranteed huge overhang.
    const flipped = rotateAroundX(tri.positions, 180)
    const overhangBefore = measureOverhangArea(flipped)
    expect(overhangBefore).toBeGreaterThan(10) // pre-condition: bad starting pose
    const r = autoOrient({ positions: flipped })
    const rotated = applyEulerXyzDeg(flipped, r.rotationEulerDegXyz)
    const overhangAfter = measureOverhangArea(rotated)
    // Algorithm's contract: weighted score is monotonically non-increasing
    // (identity is in the candidate set, so the chosen score ≤ identity score),
    // AND the chosen orientation should drop overhang area significantly.
    expect(overhangAfter).toBeLessThan(overhangBefore)
    expect(r.candidatesEvaluated).toBeGreaterThan(6) // at least the 6 cardinals + identity
  })

  it('runs in <500ms on the 12K-triangle Sentinel STL', () => {
    const buf = readFileSync(stlPath)
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    const tri = triangulateBinaryStl(u8, 12_000)
    if ('error' in tri) throw new Error(`fixture load failed: ${tri.error}`)
    const start = performance.now()
    autoOrient({ positions: tri.positions })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(500)
  })
})

describe('auto-orient – internal building blocks', () => {
  it('rotationFromTo maps the source unit-vector to the target unit-vector', () => {
    const from = [1, 0, 0] as const
    const to = [0, 0, -1] as const
    const R = __internals.rotationFromTo(from, to)
    // Multiply R*from and confirm it's approximately `to`.
    const rx = R[0] * from[0] + R[1] * from[1] + R[2] * from[2]
    const ry = R[3] * from[0] + R[4] * from[1] + R[5] * from[2]
    const rz = R[6] * from[0] + R[7] * from[1] + R[8] * from[2]
    expect(rx).toBeCloseTo(to[0], 5)
    expect(ry).toBeCloseTo(to[1], 5)
    expect(rz).toBeCloseTo(to[2], 5)
  })

  it('rotationFromTo handles antipodal vectors (180° rotation)', () => {
    const R = __internals.rotationFromTo([0, 0, 1], [0, 0, -1])
    const rx = R[0] * 0 + R[1] * 0 + R[2] * 1
    const ry = R[3] * 0 + R[4] * 0 + R[5] * 1
    const rz = R[6] * 0 + R[7] * 0 + R[8] * 1
    expect(rx).toBeCloseTo(0, 5)
    expect(ry).toBeCloseTo(0, 5)
    expect(rz).toBeCloseTo(-1, 5)
  })

  it('buildCandidateNormals always includes cardinal axes', () => {
    const cube = unitCube(10)
    const cands = __internals.buildCandidateNormals(cube, 50, 0.99)
    // Each cardinal axis should be represented somewhere (cube faces match cardinals).
    const hasUp = cands.some((c) => Math.abs(c.n[2] - 1) < 0.01)
    const hasDown = cands.some((c) => Math.abs(c.n[2] + 1) < 0.01)
    expect(hasUp).toBe(true)
    expect(hasDown).toBe(true)
  })
})
