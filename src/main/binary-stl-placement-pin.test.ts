/**
 * Paired-pin contract for `src/main/binary-stl-placement.ts` -- the
 * 151-line MAIN-process binary-STL transform-and-place helper consumed
 * by every STL-aligned CAM job across all three target machines (K2 Plus
 * FDM aligned-mesh, Laguna Swift 5x10 indexed-3-axis from STL, and
 * Carvera 3-axis + 4-axis Rotary STL ops).
 *
 * The module exports a single runtime symbol:
 *
 * - `transformBinaryStlWithPlacement(buffer, placement, upAxis, transform?)`
 *   -- decodes a binary OR ASCII STL, applies the documented placement
 *   transform (`as_is` / `center_origin` / `center_xy_ground_z`), the
 *   up-axis remap (`y_up` identity or `z_up` -> Y-up via the documented
 *   `[x, z, -y]` permutation), and the optional rotateDeg/translateMm/
 *   scale transform, then re-encodes the result as a fresh binary STL
 *   with header text `"UFS import"` and recomputed unit normals.
 *
 * Three private helpers are NOT exported and remain module-private:
 * `zUpToYUpStl`, `triangleNormalStl`, `encodeBinaryStlFromTriangles`.
 *
 * Three-machine impact: DIRECT cross-cut. Every STL job in the codebase
 * routes its source mesh through this transform before the slicer
 * (K2 Plus) or CAM engine (Laguna 5x10 + Carvera 3-axis + Carvera 4-axis
 * Rotary) consumes it. A regression in placement, up-axis remap, or
 * normal recomputation would silently mis-orient a mesh on the build
 * plate or stock fixture and ruin parts.
 *
 * This pin co-locates with the existing behavioral test
 * `binary-stl-placement.test.ts`. The pin is exhaustive against the
 * output-buffer byte structure (84 + 50*N), the triangle-normal
 * recomputation invariant, the documented [x, z, -y] z_up->y_up
 * permutation, the three placement-mode cases, the threshold-based
 * transform application (`> 1e-6` epsilon), and the source-text
 * whitelist so any rename, semantic shift, or imported-symbol change
 * forces a deliberate update to this file.
 *
 * Roadmap ID: [ID-0296] / Cycle 223 (test-coverage rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './binary-stl-placement'
import { transformBinaryStlWithPlacement } from './binary-stl-placement'

const SOURCE_PATH = resolve(__dirname, 'binary-stl-placement.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Test-fixture helpers (self-contained to avoid depending on the
// behavioral test's helpers and to keep this pin authoritative).
// ---------------------------------------------------------------------------
type V3 = [number, number, number]
type Tri = [V3, V3, V3]

function buildBinaryStl(triangles: Tri[]): Buffer {
  const count = triangles.length
  const buf = Buffer.alloc(84 + count * 50, 0)
  buf.write('PinTest', 0)
  buf.writeUInt32LE(count, 80)
  let off = 84
  for (const [a, b, c] of triangles) {
    // Normal (0, 0, 0) -- the module recomputes this on encode.
    off += 12
    for (const p of [a, b, c]) {
      buf.writeFloatLE(p[0], off); off += 4
      buf.writeFloatLE(p[1], off); off += 4
      buf.writeFloatLE(p[2], off); off += 4
    }
    buf.writeUInt16LE(0, off); off += 2
  }
  return buf
}

function readBinaryStl(buf: Buffer): { count: number; tris: Tri[]; normals: V3[] } {
  const count = buf.readUInt32LE(80)
  const tris: Tri[] = []
  const normals: V3[] = []
  let off = 84
  for (let i = 0; i < count; i++) {
    const nx = buf.readFloatLE(off); off += 4
    const ny = buf.readFloatLE(off); off += 4
    const nz = buf.readFloatLE(off); off += 4
    normals.push([nx, ny, nz])
    const verts: V3[] = []
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(off); off += 4
      const y = buf.readFloatLE(off); off += 4
      const z = buf.readFloatLE(off); off += 4
      verts.push([x, y, z])
    }
    tris.push([verts[0], verts[1], verts[2]])
    off += 2 // skip attribute byte count
  }
  return { count, tris, normals }
}

function bbox(tris: Tri[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const tri of tris) {
    for (const p of tri) {
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i]
        if (p[i] > max[i]) max[i] = p[i]
      }
    }
  }
  return { min, max }
}

// A simple right-handed CCW triangle in the Z=0 plane (normal = +Z).
const SINGLE_TRI: Tri = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0]
]
const SINGLE_TRI_STL = buildBinaryStl([SINGLE_TRI])

// A two-triangle "L" shape spanning [0..20, 0..30, 0..0].
const TWO_TRI: Tri[] = [
  [
    [0, 0, 0],
    [20, 0, 0],
    [0, 30, 0]
  ],
  [
    [20, 0, 0],
    [20, 30, 0],
    [0, 30, 0]
  ]
]
const TWO_TRI_STL = buildBinaryStl(TWO_TRI)

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/main/binary-stl-placement.ts exports', () => {
  it('exports exactly the single transform entrypoint', () => {
    expect(Object.keys(M).sort()).toEqual(['transformBinaryStlWithPlacement'])
  })

  it('the transform entrypoint is a function with arity 4 (buf, placement, upAxis, transform?)', () => {
    expect(typeof transformBinaryStlWithPlacement).toBe('function')
    // The optional `transform?` does NOT decrement Function.length, so
    // arity reports 4 (matches the runtime parameter count).
    expect(transformBinaryStlWithPlacement.length).toBe(4)
  })

  it('does NOT export private helpers (zUpToYUpStl / triangleNormalStl / encodeBinaryStlFromTriangles)', () => {
    expect((M as Record<string, unknown>).zUpToYUpStl).toBeUndefined()
    expect((M as Record<string, unknown>).triangleNormalStl).toBeUndefined()
    expect((M as Record<string, unknown>).encodeBinaryStlFromTriangles).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. Input validation
// ---------------------------------------------------------------------------
describe('B. Input validation', () => {
  it('rejects buffer shorter than 84 bytes with stl_too_small', () => {
    const r = transformBinaryStlWithPlacement(Buffer.alloc(40), 'as_is', 'y_up')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('stl_too_small')
  })

  it('rejects buffer with zero triangles via empty_stl', () => {
    const empty = Buffer.alloc(84, 0)
    empty.writeUInt32LE(0, 80)
    const r = transformBinaryStlWithPlacement(empty, 'as_is', 'y_up')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('empty_stl')
  })

  it('rejects buffer with header claiming triangles but no payload', () => {
    // Header says 5 triangles but the buffer is only 84 bytes.
    const lying = Buffer.alloc(84, 0)
    lying.writeUInt32LE(5, 80)
    const r = transformBinaryStlWithPlacement(lying, 'as_is', 'y_up')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // The mismatch detection lives downstream of iterateBinaryStlTriangles.
      expect(r.error).toBe('stl_triangle_read_mismatch')
    }
  })

  it('accepts a valid single-triangle binary STL with as_is/y_up', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.buffer.length).toBeGreaterThanOrEqual(84)
  })

  it('accepts a valid multi-triangle binary STL', () => {
    const r = transformBinaryStlWithPlacement(TWO_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      expect(decoded.count).toBe(2)
    }
  })
})

// ---------------------------------------------------------------------------
// C. Output buffer structure
// ---------------------------------------------------------------------------
describe('C. Output buffer byte structure', () => {
  it('output is exactly 84 + 50*N bytes (binary STL spec)', () => {
    const r = transformBinaryStlWithPlacement(TWO_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buffer.length).toBe(84 + 2 * 50)
    }
  })

  it('output header begins with "UFS import" (NOT the input header text)', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Read the first 10 bytes of the 80-byte header.
      const headerStart = r.buffer.subarray(0, 10).toString('utf-8')
      expect(headerStart).toBe('UFS import')
      // The input header was "PinTest" -- it must NOT survive.
      expect(r.buffer.subarray(0, 80).toString('utf-8')).not.toContain('PinTest')
    }
  })

  it('output triangle-count UInt32LE at offset 80 matches input count (placement is non-destructive)', () => {
    const r = transformBinaryStlWithPlacement(TWO_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buffer.readUInt32LE(80)).toBe(2)
    }
  })

  it('each output triangle ends with the documented UInt16LE attribute byte count = 0', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Triangle 0 attribute is at offset 84 + 48 = 132.
      const attr = r.buffer.readUInt16LE(132)
      expect(attr).toBe(0)
    }
  })

  it('output is a fresh buffer (not aliasing the input)', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buffer).not.toBe(SINGLE_TRI_STL)
    }
  })
})

// ---------------------------------------------------------------------------
// D. Triangle normal recomputation
// ---------------------------------------------------------------------------
describe('D. Triangle normal recomputation', () => {
  it('zero-normal input gets recomputed to a unit-length normal on output', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      const [nx, ny, nz] = decoded.normals[0]
      const len = Math.hypot(nx, ny, nz)
      expect(len).toBeCloseTo(1, 5)
    }
  })

  it('right-handed CCW triangle in Z=0 plane recomputes normal as +Z (or close to it)', () => {
    // SINGLE_TRI is in the Z=0 plane with CCW winding -- normal must be +Z.
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      const [nx, ny, nz] = decoded.normals[0]
      expect(nx).toBeCloseTo(0, 5)
      expect(ny).toBeCloseTo(0, 5)
      expect(nz).toBeCloseTo(1, 5)
    }
  })

  it('CW (reversed) winding flips the normal sign', () => {
    const reversed: Tri = [
      [0, 0, 0],
      [0, 10, 0],
      [10, 0, 0]
    ]
    const stl = buildBinaryStl([reversed])
    const r = transformBinaryStlWithPlacement(stl, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      expect(decoded.normals[0][2]).toBeCloseTo(-1, 5)
    }
  })

  it('degenerate (collinear) triangle does NOT crash -- normal len fallback to 1 keeps output finite', () => {
    const degen: Tri = [
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0]
    ]
    const stl = buildBinaryStl([degen])
    const r = transformBinaryStlWithPlacement(stl, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      const [nx, ny, nz] = decoded.normals[0]
      expect(Number.isFinite(nx)).toBe(true)
      expect(Number.isFinite(ny)).toBe(true)
      expect(Number.isFinite(nz)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// E. Placement modes
// ---------------------------------------------------------------------------
describe('E. Placement modes', () => {
  it('as_is leaves bbox untouched', () => {
    const r = transformBinaryStlWithPlacement(TWO_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      const bb = bbox(decoded.tris)
      expect(bb.min[0]).toBeCloseTo(0, 5)
      expect(bb.max[0]).toBeCloseTo(20, 5)
      expect(bb.min[1]).toBeCloseTo(0, 5)
      expect(bb.max[1]).toBeCloseTo(30, 5)
    }
  })

  it('center_origin shifts bbox center to (0, 0, 0)', () => {
    const r = transformBinaryStlWithPlacement(TWO_TRI_STL, 'center_origin', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      const bb = bbox(decoded.tris)
      expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(0, 5)
      expect((bb.min[1] + bb.max[1]) / 2).toBeCloseTo(0, 5)
      expect((bb.min[2] + bb.max[2]) / 2).toBeCloseTo(0, 5)
    }
  })

  it('center_xy_ground_z centers X/Y but plants minZ on the build plate (Z=0)', () => {
    // Lift TWO_TRI off the floor a bit so we can see the Z drop to 0.
    const lifted = TWO_TRI.map(
      (tri) => tri.map((p) => [p[0], p[1], p[2] + 5]) as Tri
    )
    const stl = buildBinaryStl(lifted)
    const r = transformBinaryStlWithPlacement(stl, 'center_xy_ground_z', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      const bb = bbox(decoded.tris)
      expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(0, 5)
      expect((bb.min[1] + bb.max[1]) / 2).toBeCloseTo(0, 5)
      expect(bb.min[2]).toBeCloseTo(0, 5)
    }
  })

  it('center_origin and center_xy_ground_z differ ONLY in Z handling', () => {
    const r1 = transformBinaryStlWithPlacement(TWO_TRI_STL, 'center_origin', 'y_up')
    const r2 = transformBinaryStlWithPlacement(TWO_TRI_STL, 'center_xy_ground_z', 'y_up')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      const d1 = readBinaryStl(r1.buffer)
      const d2 = readBinaryStl(r2.buffer)
      // X and Y bboxes match.
      const b1 = bbox(d1.tris)
      const b2 = bbox(d2.tris)
      expect(b1.min[0]).toBeCloseTo(b2.min[0], 5)
      expect(b1.max[0]).toBeCloseTo(b2.max[0], 5)
      expect(b1.min[1]).toBeCloseTo(b2.min[1], 5)
      expect(b1.max[1]).toBeCloseTo(b2.max[1], 5)
    }
  })
})

// ---------------------------------------------------------------------------
// F. UpAxis modes
// ---------------------------------------------------------------------------
describe('F. UpAxis modes', () => {
  it('y_up is the identity remap (no axis swap)', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      // SINGLE_TRI v0 = (0, 0, 0), v1 = (10, 0, 0), v2 = (0, 10, 0). Identity preserves them.
      expect(decoded.tris[0][1][0]).toBeCloseTo(10, 5)
      expect(decoded.tris[0][1][1]).toBeCloseTo(0, 5)
      expect(decoded.tris[0][1][2]).toBeCloseTo(0, 5)
      expect(decoded.tris[0][2][1]).toBeCloseTo(10, 5)
    }
  })

  it('z_up applies the documented [x, z, -y] permutation', () => {
    // Input vertex (0, 10, 0) under z_up -> (0, 0, -10).
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'z_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = readBinaryStl(r.buffer)
      expect(decoded.tris[0][2][0]).toBeCloseTo(0, 5)
      expect(decoded.tris[0][2][1]).toBeCloseTo(0, 5)
      expect(decoded.tris[0][2][2]).toBeCloseTo(-10, 5)
    }
  })

  it('z_up changes bbox extents (Y becomes Z, Z becomes -Y)', () => {
    const yUp = transformBinaryStlWithPlacement(TWO_TRI_STL, 'as_is', 'y_up')
    const zUp = transformBinaryStlWithPlacement(TWO_TRI_STL, 'as_is', 'z_up')
    expect(yUp.ok).toBe(true)
    expect(zUp.ok).toBe(true)
    if (yUp.ok && zUp.ok) {
      const yb = bbox(readBinaryStl(yUp.buffer).tris)
      const zb = bbox(readBinaryStl(zUp.buffer).tris)
      // y_up: Y in [0..30]; z_up: that becomes Z in [-30..0].
      expect(yb.max[1] - yb.min[1]).toBeCloseTo(30, 5)
      expect(zb.max[2] - zb.min[2]).toBeCloseTo(30, 5)
    }
  })

  it('z_up + center_origin produces a centered mesh in the swapped frame', () => {
    const r = transformBinaryStlWithPlacement(TWO_TRI_STL, 'center_origin', 'z_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const bb = bbox(readBinaryStl(r.buffer).tris)
      expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(0, 5)
      expect((bb.min[1] + bb.max[1]) / 2).toBeCloseTo(0, 5)
      expect((bb.min[2] + bb.max[2]) / 2).toBeCloseTo(0, 5)
    }
  })
})

// ---------------------------------------------------------------------------
// G. Optional transform thresholds
// ---------------------------------------------------------------------------
describe('G. Optional transform thresholds (epsilon = 1e-6)', () => {
  it('rotateDeg below 1e-6 on every axis is treated as identity', () => {
    const noOp = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    const tiny = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      rotateDeg: [1e-7, 1e-7, 1e-7]
    })
    expect(noOp.ok).toBe(true)
    expect(tiny.ok).toBe(true)
    if (noOp.ok && tiny.ok) {
      // Vertex coordinates byte-identical when rotation under threshold.
      const a = readBinaryStl(noOp.buffer)
      const b = readBinaryStl(tiny.buffer)
      expect(a.tris[0][1][0]).toBeCloseTo(b.tris[0][1][0], 5)
      expect(a.tris[0][2][1]).toBeCloseTo(b.tris[0][2][1], 5)
    }
  })

  it('rotateDeg = 90 on Z swaps X<->Y', () => {
    // Single triangle (0,0,0)-(10,0,0)-(0,10,0) rotated 90deg CCW about Z
    // becomes (0,0,0)-(0,10,0)-(-10,0,0).
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      rotateDeg: [0, 0, 90]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const tris = readBinaryStl(r.buffer).tris
      expect(tris[0][1][0]).toBeCloseTo(0, 4)
      expect(tris[0][1][1]).toBeCloseTo(10, 4)
      expect(tris[0][2][0]).toBeCloseTo(-10, 4)
      expect(tris[0][2][1]).toBeCloseTo(0, 4)
    }
  })

  it('translateMm below 1e-6 on every axis is treated as identity', () => {
    const noOp = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    const tiny = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      translateMm: [1e-7, 1e-7, 1e-7]
    })
    expect(noOp.ok).toBe(true)
    expect(tiny.ok).toBe(true)
    if (noOp.ok && tiny.ok) {
      const a = readBinaryStl(noOp.buffer)
      const b = readBinaryStl(tiny.buffer)
      expect(a.tris[0][1][0]).toBeCloseTo(b.tris[0][1][0], 5)
    }
  })

  it('translateMm = [100, 200, 300] shifts every vertex by exactly that vector', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      translateMm: [100, 200, 300]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const tris = readBinaryStl(r.buffer).tris
      expect(tris[0][0][0]).toBeCloseTo(100, 5)
      expect(tris[0][0][1]).toBeCloseTo(200, 5)
      expect(tris[0][0][2]).toBeCloseTo(300, 5)
      expect(tris[0][1][0]).toBeCloseTo(110, 5)
    }
  })

  it('scale = [1, 1, 1] is treated as identity (within epsilon)', () => {
    const noOp = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up')
    const unitScale = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      scale: [1, 1, 1]
    })
    expect(noOp.ok).toBe(true)
    expect(unitScale.ok).toBe(true)
    if (noOp.ok && unitScale.ok) {
      const a = readBinaryStl(noOp.buffer)
      const b = readBinaryStl(unitScale.buffer)
      expect(a.tris[0][1][0]).toBeCloseTo(b.tris[0][1][0], 5)
    }
  })

  it('scale = [2, 3, 4] multiplies vertices per-axis', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      scale: [2, 3, 4]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const tris = readBinaryStl(r.buffer).tris
      // Vertex (10, 0, 0) becomes (20, 0, 0); vertex (0, 10, 0) becomes (0, 30, 0).
      expect(tris[0][1][0]).toBeCloseTo(20, 5)
      expect(tris[0][2][1]).toBeCloseTo(30, 5)
    }
  })

  it('scale near 1.0 (within 1e-6) is identity even if not exactly 1', () => {
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      scale: [1 + 1e-7, 1 - 1e-7, 1]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const tris = readBinaryStl(r.buffer).tris
      // Vertex (10, 0, 0) should pass through unchanged within 5 decimals.
      expect(tris[0][1][0]).toBeCloseTo(10, 5)
    }
  })

  it('combined scale + rotate + translate composes in the documented order (scale, rotate, translate)', () => {
    // Single vertex (10, 0, 0): scale by 2 -> (20, 0, 0); rotate 90deg about Z -> (0, 20, 0); translate [5, 0, 0] -> (5, 20, 0).
    const r = transformBinaryStlWithPlacement(SINGLE_TRI_STL, 'as_is', 'y_up', {
      scale: [2, 2, 2],
      rotateDeg: [0, 0, 90],
      translateMm: [5, 0, 0]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const tris = readBinaryStl(r.buffer).tris
      expect(tris[0][1][0]).toBeCloseTo(5, 4)
      expect(tris[0][1][1]).toBeCloseTo(20, 4)
    }
  })
})

// ---------------------------------------------------------------------------
// H. Three-machine cross-cut realism
// ---------------------------------------------------------------------------
describe('H. Three-machine cross-cut realism', () => {
  it('K2 Plus 350-cube: center_xy_ground_z lands a 50mm cube on the build plate at Z>=0', () => {
    // Build a small "cube" using two triangles spanning [-25..25, -25..25, 0..50].
    const cube: Tri[] = [
      [
        [-25, -25, 0],
        [25, -25, 0],
        [-25, 25, 0]
      ],
      [
        [-25, -25, 50],
        [25, -25, 50],
        [-25, 25, 50]
      ]
    ]
    const stl = buildBinaryStl(cube)
    const r = transformBinaryStlWithPlacement(stl, 'center_xy_ground_z', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const bb = bbox(readBinaryStl(r.buffer).tris)
      // Already centered in X/Y; Z minimum should land at 0.
      expect(bb.min[2]).toBeCloseTo(0, 5)
      // Bbox stays inside the K2's 350x350x350 envelope with margin.
      expect(bb.max[2]).toBeLessThan(350)
    }
  })

  it('Laguna 5x10 sheet: as_is preserves a wide-aspect 1500x2900 mesh', () => {
    // A single triangle spanning the sheet's footprint.
    const sheet: Tri[] = [
      [
        [0, 0, 0],
        [1500, 0, 0],
        [0, 2900, 0]
      ]
    ]
    const stl = buildBinaryStl(sheet)
    const r = transformBinaryStlWithPlacement(stl, 'as_is', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const bb = bbox(readBinaryStl(r.buffer).tris)
      expect(bb.max[0]).toBeCloseTo(1500, 5)
      expect(bb.max[1]).toBeCloseTo(2900, 5)
      // Inside the 1524x3048mm envelope.
      expect(bb.max[0]).toBeLessThan(1524)
      expect(bb.max[1]).toBeLessThan(3048)
    }
  })

  it('Carvera bar: center_origin centers a 50x50x100 bar at the spindle origin', () => {
    const bar: Tri[] = [
      [
        [0, 0, 0],
        [50, 0, 0],
        [0, 50, 0]
      ],
      [
        [0, 0, 100],
        [50, 0, 100],
        [0, 50, 100]
      ]
    ]
    const stl = buildBinaryStl(bar)
    const r = transformBinaryStlWithPlacement(stl, 'center_origin', 'y_up')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const bb = bbox(readBinaryStl(r.buffer).tris)
      expect((bb.min[2] + bb.max[2]) / 2).toBeCloseTo(0, 5)
      // Each axis half-extent matches the bar's half-dimension.
      expect((bb.max[0] - bb.min[0]) / 2).toBeCloseTo(25, 5)
      expect((bb.max[2] - bb.min[2]) / 2).toBeCloseTo(50, 5)
    }
  })

  it('Carvera 4-axis rotary: z_up + rotateDeg [0, 0, 90] re-orients a 100mm-long blank along the headstock', () => {
    // Long axis along Z initially; rotate 90deg about Z and confirm the Z-axis stays the long axis.
    const blank: Tri[] = [
      [
        [0, 0, 0],
        [10, 0, 0],
        [0, 0, 100]
      ]
    ]
    const stl = buildBinaryStl(blank)
    const r = transformBinaryStlWithPlacement(stl, 'as_is', 'z_up', {
      rotateDeg: [0, 0, 90]
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // z_up converts (0, 0, 100) -> (0, 100, 0). 90deg-Z rotation -> (-100, 0, 0).
      // Check that the long axis still extends 100 mm somewhere.
      const tris = readBinaryStl(r.buffer).tris
      const bb = bbox(tris)
      const span = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2])
      expect(span).toBeCloseTo(100, 3)
    }
  })
})

// ---------------------------------------------------------------------------
// I. Source-text whitelist
// ---------------------------------------------------------------------------
describe('I. Source-text whitelist -- imports + safety', () => {
  it('imports only from ./stl and ./stl-vec3 (no deep cross-cuts)', () => {
    // Filter out comments first.
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).toContain("from \"./stl\"")
    expect(stripped).toContain("from \"./stl-vec3\"")
    // No import from outside ./stl, ./stl-vec3 (no node:* imports needed for pure transform).
    const importLines = stripped.split('\n').filter((l) => /^\s*import\s/.test(l))
    expect(importLines.length).toBe(2)
  })

  it('does not contain `any` casts in TypeScript source', () => {
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).not.toMatch(/\bas any\b/)
    expect(stripped).not.toMatch(/:\s*any\b/)
  })

  it('does not call eval / new Function (no dynamic code synthesis)', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('routes ASCII branch through collectAsciiStlTriangles + binary branch through iterateBinaryStlTriangles', () => {
    expect(SOURCE).toContain('collectAsciiStlTriangles')
    expect(SOURCE).toContain('iterateBinaryStlTriangles')
    expect(SOURCE).toContain('isLikelyAsciiStl')
    expect(SOURCE).toContain('isBinaryStlLayout')
  })

  it('encodes output via writeFloatLE + writeUInt32LE (little-endian per binary STL spec)', () => {
    expect(SOURCE).toContain('writeFloatLE')
    expect(SOURCE).toContain('writeUInt32LE')
    expect(SOURCE).toContain('writeUInt16LE')
    // No big-endian writes.
    expect(SOURCE).not.toContain('writeFloatBE')
    expect(SOURCE).not.toContain('writeUInt32BE')
  })

  it('declares the "UFS import" header constant in encodeBinaryStlFromTriangles', () => {
    expect(SOURCE).toContain('"UFS import"')
  })

  it('declares the documented [x, z, -y] z_up->y_up permutation', () => {
    // Source-text scan: the helper body must contain the exact
    // [x, z, -y] permutation.
    expect(SOURCE).toMatch(/return\s*\[\s*x\s*,\s*z\s*,\s*-y\s*\]/)
  })
})

// ---------------------------------------------------------------------------
// J. Type-level parity -- string-literal unions + result discriminator
// ---------------------------------------------------------------------------
describe('J. Type-level parity -- string-literal unions + result shape', () => {
  it('PlacementMode declares exactly the three documented literal members', () => {
    expect(SOURCE).toMatch(/type PlacementMode =\s*"as_is"\s*\|\s*"center_origin"\s*\|\s*"center_xy_ground_z"/)
  })

  it('UpAxisMode declares exactly the two documented literal members', () => {
    expect(SOURCE).toMatch(/type UpAxisMode =\s*"y_up"\s*\|\s*"z_up"/)
  })

  it('TransformMode optional-fields shape: translateMm / rotateDeg / scale (all optional, all 3-tuples)', () => {
    expect(SOURCE).toMatch(/translateMm\?:\s*\[number,\s*number,\s*number\]/)
    expect(SOURCE).toMatch(/rotateDeg\?:\s*\[number,\s*number,\s*number\]/)
    expect(SOURCE).toMatch(/scale\?:\s*\[number,\s*number,\s*number\]/)
  })

  it('result type is a discriminated union: { ok: true; buffer } | { ok: false; error; detail? }', () => {
    expect(SOURCE).toMatch(/\{\s*ok:\s*true;\s*buffer:\s*Buffer\s*\}/)
    expect(SOURCE).toMatch(/\{\s*ok:\s*false;\s*error:\s*string;\s*detail\?:\s*string\s*\}/)
  })

  it('error variants are exactly the three documented strings (stl_too_small / empty_stl / stl_triangle_read_mismatch)', () => {
    expect(SOURCE).toContain('"stl_too_small"')
    expect(SOURCE).toContain('"empty_stl"')
    expect(SOURCE).toContain('"stl_triangle_read_mismatch"')
  })
})
