import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  collectAsciiStlTriangles,
  collectBinaryStlTriangles,
  effectiveBinaryStlTriangleCount,
  isBinaryStlLayout,
  isLikelyAsciiStl,
  iterateBinaryStlTriangles,
  parseBinaryStl,
  readStlFirstTriangleVertices
} from './stl'

function buildOneTriangleStl(): Buffer {
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

describe('parseBinaryStl', () => {
  it('computes axis-aligned bounds', () => {
    const b = parseBinaryStl(buildOneTriangleStl())
    expect(b.triangleCount).toBe(1)
    expect(b.min[0]).toBeCloseTo(0)
    expect(b.max[0]).toBeCloseTo(1)
    expect(b.max[1]).toBeCloseTo(1)
  })
})

describe('STL helpers', () => {
  it('detects ASCII STL header', () => {
    expect(isLikelyAsciiStl(Buffer.from('solid foo\n'))).toBe(true)
    expect(isLikelyAsciiStl(buildOneTriangleStl())).toBe(false)
  })

  it('treats binary STL with solid-prefixed 80-byte header as binary layout', () => {
    const tri = buildOneTriangleStl()
    const header = Buffer.alloc(80, 0)
    header.write('solid', 0, 5, 'latin1')
    const withSolid = Buffer.concat([header, tri.subarray(80)])
    expect(isLikelyAsciiStl(withSolid)).toBe(true)
    expect(isBinaryStlLayout(withSolid)).toBe(true)
    const r = collectBinaryStlTriangles(withSolid, 10)
    expect(r.triangles).toHaveLength(1)
    expect(readStlFirstTriangleVertices(withSolid)).not.toBeNull()
    const b = parseBinaryStl(withSolid)
    expect(b.triangleCount).toBe(1)
  })

  it('reads binary STL when declared triangle count exceeds bytes on disk (truncated / bad header)', () => {
    const tri = buildOneTriangleStl()
    const header = Buffer.alloc(80, 0)
    header.write('solid', 0, 5, 'latin1')
    const count = Buffer.alloc(4)
    count.writeUInt32LE(9_999_999, 0)
    const body = tri.subarray(84)
    const bloatedHeader = Buffer.concat([header, count, body])
    expect(effectiveBinaryStlTriangleCount(bloatedHeader)).toBe(1)
    expect(isBinaryStlLayout(bloatedHeader)).toBe(true)
    const r = collectBinaryStlTriangles(bloatedHeader, 10)
    expect(r.triangles).toHaveLength(1)
    const b = parseBinaryStl(bloatedHeader)
    expect(b.triangleCount).toBe(1)
  })

  it('reads first triangle vertices from binary STL', () => {
    const tri = readStlFirstTriangleVertices(buildOneTriangleStl())
    expect(tri).not.toBeNull()
    expect(tri![0]![0]).toBeCloseTo(0)
    expect(tri![1]![0]).toBeCloseTo(1)
  })

  it('collects triangles from ASCII STL', () => {
    const ascii = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid
`
    const r = collectAsciiStlTriangles(Buffer.from(ascii, 'utf8'), 100)
    expect(r.triangles).toHaveLength(1)
    expect(r.triangles[0]![0]![0]).toBeCloseTo(0)
    expect(r.triangles[0]![1]![0]).toBeCloseTo(1)
    expect(r.fileTriangleCount).toBe(1)
    expect(r.truncated).toBe(false)
  })

  it('iterates all triangles up to maxYield', () => {
    const header = Buffer.alloc(80, 0)
    const count = Buffer.alloc(4)
    count.writeUInt32LE(2, 0)
    const oneTriFile = buildOneTriangleStl()
    const tri50 = oneTriFile.subarray(84, 134)
    const buf = Buffer.concat([header, count, tri50, tri50])
    let n = 0
    const r = iterateBinaryStlTriangles(buf, 10, () => {
      n++
    })
    expect(r.fileTriangleCount).toBe(2)
    expect(r.yielded).toBe(2)
    expect(r.truncated).toBe(false)
    expect(n).toBe(2)
  })
})
