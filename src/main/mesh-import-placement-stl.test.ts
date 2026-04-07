import { describe, expect, it } from 'vitest'
import { parseBinaryStl } from './stl'
import { transformBinaryStlWithPlacement } from './binary-stl-placement'

function buildOneTriangleBinaryStl(): Buffer {
  const header = Buffer.alloc(80, 0)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(1, 0)
  const tri = Buffer.alloc(50)
  let o = 0
  tri.writeFloatLE(0, o)
  o += 4
  tri.writeFloatLE(0, o)
  o += 4
  tri.writeFloatLE(1, o)
  o += 4
  const verts: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ]
  for (const [x, y, z] of verts) {
    tri.writeFloatLE(x, o)
    o += 4
    tri.writeFloatLE(y, o)
    o += 4
    tri.writeFloatLE(z, o)
    o += 4
  }
  tri.writeUInt16LE(0, o)
  return Buffer.concat([header, count, tri])
}

describe('transformBinaryStlWithPlacement', () => {
  it('centers triangle centroid at origin for center_origin', () => {
    const buf = buildOneTriangleBinaryStl()
    const r = transformBinaryStlWithPlacement(buf, 'center_origin', 'y_up')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const b = parseBinaryStl(r.buffer)
    const cx = (b.min[0] + b.max[0]) / 2
    const cy = (b.min[1] + b.max[1]) / 2
    const cz = (b.min[2] + b.max[2]) / 2
    expect(cx).toBeCloseTo(0, 5)
    expect(cy).toBeCloseTo(0, 5)
    expect(cz).toBeCloseTo(0, 5)
  })

  it('places minimum Z on ground for center_xy_ground_z', () => {
    const buf = buildOneTriangleBinaryStl()
    const r = transformBinaryStlWithPlacement(buf, 'center_xy_ground_z', 'y_up')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const b = parseBinaryStl(r.buffer)
    expect(b.min[2]).toBeCloseTo(0, 5)
    const cx = (b.min[0] + b.max[0]) / 2
    const cy = (b.min[1] + b.max[1]) / 2
    expect(cx).toBeCloseTo(0, 5)
    expect(cy).toBeCloseTo(0, 5)
  })

  it('handles ASCII STL (empty → returns error)', () => {
    // An ASCII STL with no triangles should fail gracefully
    const buf = Buffer.alloc(120, 0x20)
    buf.write('solid x\n', 0)
    buf.write('endsolid\n', 80)
    const r = transformBinaryStlWithPlacement(buf, 'center_origin', 'y_up')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('empty_stl')
  })

  it('handles ASCII STL with triangles', () => {
    const ascii = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 5 10 0
    endloop
  endfacet
endsolid test`
    const buf = Buffer.from(ascii, 'utf-8')
    const r = transformBinaryStlWithPlacement(buf, 'as_is', 'y_up', {
      translateMm: [5, 0, 0]
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The output should be a valid binary STL with the translation applied
    const b = parseBinaryStl(r.buffer)
    expect(b.min[0]).toBeCloseTo(5, 3)  // translated by +5 in X
    expect(b.max[0]).toBeCloseTo(15, 3)
  })
})
