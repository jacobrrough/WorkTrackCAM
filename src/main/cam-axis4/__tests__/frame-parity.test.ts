/**
 * frame-parity.test.ts — CRITICAL invariant test
 *
 * Asserts that `meshToMachineFrame(rawTris, placement, stock)` produces the
 * same triangles as `transformBinaryStlWithPlacement(rawStlBuf, 'center_origin',
 * 'y_up', { rotateDeg: [rx, rz, ry], translateMm: [tx, tz, ty], scale: [sx, sz, sy] })`
 * — modulo the +halfLen X shift that the new engine applies on top.
 *
 * This is the CONTRACT between the new engine and the existing renderer:
 *   - The renderer's display path goes through `ipc-fabrication.ts` →
 *     `transformBinaryStlWithPlacement` → `.cam-aligned.stl` → ShopModelViewer.
 *   - The new engine's CAM path goes through `meshToMachineFrame`.
 *
 * If these two paths disagree on triangle positions, the displayed mesh and
 * the generated toolpath will be in different places — which IS THE BUG we're
 * fixing. Do NOT relax this test; if you need to change one path, change both
 * and update this test in the same commit.
 */
import { describe, expect, it } from 'vitest'
import { transformBinaryStlWithPlacement } from '../../binary-stl-placement'
import {
  collectBinaryStlTriangles,
  effectiveBinaryStlTriangleCount,
  iterateBinaryStlTriangles,
  type Vec3
} from '../../stl'
import { meshToMachineFrame, type Placement, type Triangle } from '../frame'

const STOCK = { lengthMm: 100, diameterMm: 40 }

// ─── Synthetic STL builder ──────────────────────────────────────────────────
// Build a tiny binary STL buffer in memory so we can feed both code paths
// and compare them. This avoids any disk I/O and keeps the test deterministic.

function encodeBinaryStl(triangles: Triangle[]): Buffer {
  const out = Buffer.alloc(84 + triangles.length * 50, 0)
  out.write('TEST', 0)
  out.writeUInt32LE(triangles.length, 80)
  let o = 84
  for (const tri of triangles) {
    // normal — placeholder; binary-stl-placement.ts recomputes on encode
    out.writeFloatLE(0, o)
    o += 4
    out.writeFloatLE(0, o)
    o += 4
    out.writeFloatLE(1, o)
    o += 4
    for (const v of tri) {
      out.writeFloatLE(v[0], o)
      o += 4
      out.writeFloatLE(v[1], o)
      o += 4
      out.writeFloatLE(v[2], o)
      o += 4
    }
    out.writeUInt16LE(0, o)
    o += 2
  }
  return out
}

function decodeBinaryStlTriangles(buf: Buffer): Triangle[] {
  const n = effectiveBinaryStlTriangleCount(buf)
  const out: Triangle[] = []
  iterateBinaryStlTriangles(buf, n, (v0, v1, v2) => {
    out.push([v0, v1, v2])
  })
  return out
}

/** Compose a placement → bake call args, mirroring `ipc-fabrication.ts:135-140`. */
function bakeViaIpcFabrication(
  rawBuf: Buffer,
  placement: Placement
): Triangle[] {
  const r = transformBinaryStlWithPlacement(rawBuf, 'center_origin', 'y_up', {
    rotateDeg: [placement.rotation.x, placement.rotation.z, placement.rotation.y],
    translateMm: [placement.position.x, placement.position.z, placement.position.y],
    scale: [placement.scale.x, placement.scale.z, placement.scale.y]
  })
  if (!r.ok) throw new Error(`bake failed: ${r.error}`)
  return decodeBinaryStlTriangles(r.buffer)
}

function tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]): Triangle {
  return [a, b, c]
}

function syntheticBox(): Triangle[] {
  // 10 × 6 × 8 box centered at (0, 0, 0)
  return [
    tri([-5, -3, -4], [5, -3, -4], [5, 3, -4]),
    tri([-5, -3, -4], [5, 3, -4], [-5, 3, -4]),
    tri([-5, -3, 4], [5, 3, 4], [5, -3, 4]),
    tri([-5, -3, 4], [-5, 3, 4], [5, 3, 4]),
    tri([-5, -3, -4], [-5, 3, -4], [-5, 3, 4]),
    tri([-5, -3, -4], [-5, 3, 4], [-5, -3, 4]),
    tri([5, -3, -4], [5, 3, 4], [5, 3, -4]),
    tri([5, -3, -4], [5, -3, 4], [5, 3, 4]),
    tri([-5, -3, -4], [5, -3, 4], [5, -3, -4]),
    tri([-5, -3, -4], [-5, -3, 4], [5, -3, 4]),
    tri([-5, 3, -4], [5, 3, -4], [5, 3, 4]),
    tri([-5, 3, -4], [5, 3, 4], [-5, 3, 4])
  ]
}

function asymmetricMesh(): Triangle[] {
  // Off-center mesh: bbox X∈[2, 18], Y∈[-3, 5], Z∈[1, 9]
  const base = syntheticBox()
  return base.map(([a, b, c]): Triangle => [
    [a[0] + 10, a[1] + 1, a[2] + 5],
    [b[0] + 10, b[1] + 1, b[2] + 5],
    [c[0] + 10, c[1] + 1, c[2] + 5]
  ])
}

/** Compare two triangle arrays component-wise modulo a constant X offset. */
function expectTrianglesMatchWithXOffset(
  a: Triangle[],
  b: Triangle[],
  xOffset: number,
  tol = 1e-3
): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) {
    const ta = a[i]!
    const tb = b[i]!
    for (let v = 0; v < 3; v++) {
      const va = ta[v]!
      const vb = tb[v]!
      expect(va[0]).toBeCloseTo(vb[0] + xOffset, 3)
      expect(va[1]).toBeCloseTo(vb[1], 3)
      expect(va[2]).toBeCloseTo(vb[2], 3)
    }
  }
}

// ─── Parity battery ─────────────────────────────────────────────────────────

const PLACEMENTS: Array<{ name: string; placement: Placement }> = [
  {
    name: 'identity',
    placement: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'translate-X',
    placement: {
      position: { x: 7, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'translate-Y',
    placement: {
      position: { x: 0, y: 4, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'translate-Z',
    placement: {
      position: { x: 0, y: 0, z: 6 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'rotate-X-30',
    placement: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 30, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'rotate-Y-45',
    placement: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'rotate-Z-60',
    placement: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 60 },
      scale: { x: 1, y: 1, z: 1 }
    }
  },
  {
    name: 'scale-uniform',
    placement: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.5, y: 1.5, z: 1.5 }
    }
  },
  {
    name: 'scale-non-uniform',
    placement: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.5, z: 1.25 }
    }
  },
  {
    name: 'combined-translate-rotate-scale',
    placement: {
      position: { x: 5, y: 2, z: -3 },
      rotation: { x: 15, y: 25, z: 35 },
      scale: { x: 1.2, y: 0.8, z: 1.1 }
    }
  }
]

const MESHES: Array<{ name: string; tris: Triangle[] }> = [
  { name: 'symmetric-box', tris: syntheticBox() },
  { name: 'asymmetric-offcenter', tris: asymmetricMesh() }
]

describe('frame-parity — meshToMachineFrame ≡ binary-stl-placement ∘ Y↔Z swap + halfLen X shift', () => {
  for (const mesh of MESHES) {
    for (const { name, placement } of PLACEMENTS) {
      it(`${mesh.name} × ${name}`, () => {
        const buf = encodeBinaryStl(mesh.tris)
        const baked = bakeViaIpcFabrication(buf, placement)
        // Sanity: bake roundtrip should preserve triangle count.
        expect(baked.length).toBe(mesh.tris.length)
        // Run the new path (which decodes from buffer-equivalent input).
        const decoded = collectBinaryStlTriangles(buf, 10_000).triangles
        const framed = meshToMachineFrame(decoded as unknown as Triangle[], placement, STOCK)
        // The new path adds halfLen on X; bake does not.
        expectTrianglesMatchWithXOffset(framed.triangles, baked, STOCK.lengthMm / 2)
      })
    }
  }
})

describe('frame-parity — invariants the bake guarantees', () => {
  it('the new path centers the raw bbox the same way as the bake', () => {
    // Off-center raw mesh: identity placement should yield the same shape
    // as the bake. Specifically, both should center the bbox at (0, 0, 0)
    // before applying the user transform, then we add halfLen.
    const offset: Triangle[] = asymmetricMesh()
    const buf = encodeBinaryStl(offset)
    const placement: Placement = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const baked = bakeViaIpcFabrication(buf, placement)
    const framed = meshToMachineFrame(offset, placement, STOCK)
    // The bake centers at origin → bbox center should be (0, 0, 0)
    let bxc = 0, byc = 0, bzc = 0
    let n = 0
    for (const t of baked) for (const v of t) {
      bxc += v[0]
      byc += v[1]
      bzc += v[2]
      n++
    }
    expect(bxc / n).toBeCloseTo(0, 3)
    expect(byc / n).toBeCloseTo(0, 3)
    expect(bzc / n).toBeCloseTo(0, 3)
    // The framed result should be centered at (halfLen, 0, 0)
    let fxc = 0, fyc = 0, fzc = 0
    let m = 0
    for (const t of framed.triangles) for (const v of t) {
      fxc += v[0]
      fyc += v[1]
      fzc += v[2]
      m++
    }
    expect(fxc / m).toBeCloseTo(STOCK.lengthMm / 2, 3)
    expect(fyc / m).toBeCloseTo(0, 3)
    expect(fzc / m).toBeCloseTo(0, 3)
  })
})

// Suppress unused import warning for Vec3 — kept for documentation.
void ({} as Vec3 | undefined)
