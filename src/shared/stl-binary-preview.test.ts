import { describe, expect, it } from 'vitest'
import { computeBinaryStlBoundingBox, stockBoxDimensionsFromPartBounds, triangulateBinaryStl } from './stl-binary-preview'

/** Minimal binary STL: single triangle (84 + 50 bytes). */
function oneTriangleStl(): Uint8Array {
  const buf = new ArrayBuffer(134)
  const u8 = new Uint8Array(buf)
  const view = new DataView(buf)
  view.setUint32(80, 1, true)
  let o = 84
  o += 12
  const verts = [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0]
  ] as const
  for (const [x, y, z] of verts) {
    view.setFloat32(o, x, true)
    o += 4
    view.setFloat32(o, y, true)
    o += 4
    view.setFloat32(o, z, true)
    o += 4
  }
  view.setUint16(o, 0, true)
  return u8
}

describe('stl-binary-preview', () => {
  it('computeBinaryStlBoundingBox matches triangle extent', () => {
    const u8 = oneTriangleStl()
    const b = computeBinaryStlBoundingBox(u8)
    expect(b).not.toBeNull()
    expect(b!.min).toEqual([0, 0, 0])
    expect(b!.max[0]).toBe(10)
    expect(b!.max[1]).toBe(10)
    expect(b!.max[2]).toBe(0)
  })

  it('stockBoxDimensionsFromPartBounds adds padding', () => {
    const d = stockBoxDimensionsFromPartBounds(
      { min: [0, 0, 0], max: [10, 20, 5] },
      2
    )
    expect(d.x).toBe(14)
    expect(d.y).toBe(24)
    expect(d.z).toBe(9)
  })

  it('triangulateBinaryStl yields 9 floats', () => {
    const u8 = oneTriangleStl()
    const r = triangulateBinaryStl(u8, 10_000)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.positions.length).toBe(9)
    expect(r.truncated).toBe(false)
  })
})
