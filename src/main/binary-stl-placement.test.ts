import { describe, expect, it } from 'vitest'
import { transformBinaryStlWithPlacement } from './binary-stl-placement'

/** Build a minimal valid binary STL buffer with the given triangles. */
function buildBinaryStl(triangles: Array<[[number, number, number], [number, number, number], [number, number, number]]>): Buffer {
  const count = triangles.length
  const buf = Buffer.alloc(84 + count * 50, 0)
  buf.write('TestSTL', 0)
  buf.writeUInt32LE(count, 80)
  let offset = 84
  for (const [a, b, c] of triangles) {
    // Normal (0,0,0) — will be recalculated by transform
    offset += 12
    for (const [x, y, z] of [a, b, c]) {
      buf.writeFloatLE(x, offset); offset += 4
      buf.writeFloatLE(y, offset); offset += 4
      buf.writeFloatLE(z, offset); offset += 4
    }
    buf.writeUInt16LE(0, offset); offset += 2
  }
  return buf
}

const singleTriangleStl = buildBinaryStl([
  [[0, 0, 0], [10, 0, 0], [5, 10, 0]]
])

describe('transformBinaryStlWithPlacement', () => {
  describe('input validation', () => {
    it('rejects buffer shorter than 84 bytes', () => {
      const tiny = Buffer.alloc(40)
      const result = transformBinaryStlWithPlacement(tiny, 'as_is', 'y_up')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('stl_too_small')
      }
    })

    it('rejects STL with zero triangles', () => {
      const empty = Buffer.alloc(84, 0)
      empty.writeUInt32LE(0, 80) // 0 triangles
      const result = transformBinaryStlWithPlacement(empty, 'as_is', 'y_up')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('empty_stl')
      }
    })
  })

  describe('as_is placement', () => {
    it('returns ok with valid single-triangle STL', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up')
      expect(result.ok).toBe(true)
    })

    it('output buffer is a valid binary STL', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.buffer.length).toBeGreaterThanOrEqual(84)
        const triCount = result.buffer.readUInt32LE(80)
        expect(triCount).toBe(1)
      }
    })
  })

  describe('center_origin placement', () => {
    it('centers geometry at origin', () => {
      // Triangle from (0,0,0) to (10,10,0) should be centered
      const tri = buildBinaryStl([
        [[0, 0, 0], [10, 0, 0], [10, 10, 0]]
      ])
      const result = transformBinaryStlWithPlacement(tri, 'center_origin', 'y_up')
      expect(result.ok).toBe(true)
      if (result.ok) {
        // Read back the vertices to check centering
        const buf = result.buffer
        const v0x = buf.readFloatLE(84 + 12)      // first vertex X after normal
        const v0y = buf.readFloatLE(84 + 16)      // first vertex Y
        // Center of 0..10 is 5, so translated by -5
        expect(v0x).toBeCloseTo(-5, 1)
        expect(v0y).toBeCloseTo(-5, 1)
      }
    })
  })

  describe('center_xy_ground_z placement', () => {
    it('centers XY and grounds Z at zero', () => {
      // Triangle at Z=5 to Z=15
      const tri = buildBinaryStl([
        [[0, 0, 5], [10, 0, 5], [5, 10, 15]]
      ])
      const result = transformBinaryStlWithPlacement(tri, 'center_xy_ground_z', 'y_up')
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        const v0z = buf.readFloatLE(84 + 20) // first vertex Z after normal+X+Y
        // Min Z was 5, so Z offset = -5, new Z = 5 + (-5) = 0
        expect(v0z).toBeCloseTo(0, 1)
      }
    })
  })

  describe('z_up axis mode', () => {
    it('converts Z-up to Y-up coordinate system', () => {
      // A vertex at (1, 2, 3) in Z-up becomes (1, 3, -2) in Y-up
      const tri = buildBinaryStl([
        [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
      ])
      const result = transformBinaryStlWithPlacement(tri, 'as_is', 'z_up')
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        const v0x = buf.readFloatLE(84 + 12)
        const v0y = buf.readFloatLE(84 + 16)
        const v0z = buf.readFloatLE(84 + 20)
        expect(v0x).toBeCloseTo(1, 3)
        expect(v0y).toBeCloseTo(3, 3)   // Z becomes Y
        expect(v0z).toBeCloseTo(-2, 3)  // -Y becomes Z
      }
    })
  })

  describe('transforms (rotate, translate, scale)', () => {
    it('applies scale transform', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up', {
        scale: [2, 2, 2]
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        // Second vertex was (10, 0, 0), scaled 2x should be (20, 0, 0)
        const v1x = buf.readFloatLE(84 + 12 + 12) // skip normal + first vertex
        expect(v1x).toBeCloseTo(20, 1)
      }
    })

    it('applies translation transform', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up', {
        translateMm: [100, 200, 300]
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        // First vertex was (0,0,0), translated to (100,200,300)
        const v0x = buf.readFloatLE(84 + 12)
        const v0y = buf.readFloatLE(84 + 16)
        const v0z = buf.readFloatLE(84 + 20)
        expect(v0x).toBeCloseTo(100, 1)
        expect(v0y).toBeCloseTo(200, 1)
        expect(v0z).toBeCloseTo(300, 1)
      }
    })

    it('applies rotation transform', () => {
      // Rotate 90 degrees around Z axis: (10,0,0) becomes (0,10,0)
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up', {
        rotateDeg: [0, 0, 90]
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        // Second vertex was (10, 0, 0)
        const v1x = buf.readFloatLE(84 + 12 + 12)
        const v1y = buf.readFloatLE(84 + 12 + 16)
        expect(v1x).toBeCloseTo(0, 1)
        expect(v1y).toBeCloseTo(10, 1)
      }
    })

    it('applies combined scale, rotate, and translate', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up', {
        scale: [2, 1, 1],
        rotateDeg: [0, 0, 0],
        translateMm: [50, 0, 0]
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        // First vertex: (0,0,0) scaled by 2 in X = (0,0,0), then translated = (50,0,0)
        const v0x = buf.readFloatLE(84 + 12)
        expect(v0x).toBeCloseTo(50, 1)
        // Second vertex: (10,0,0) scaled by 2 in X = (20,0,0), then translated = (70,0,0)
        const v1x = buf.readFloatLE(84 + 12 + 12)
        expect(v1x).toBeCloseTo(70, 1)
      }
    })

    it('identity transform leaves vertices unchanged', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up', {
        scale: [1, 1, 1],
        rotateDeg: [0, 0, 0],
        translateMm: [0, 0, 0]
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const buf = result.buffer
        const v0x = buf.readFloatLE(84 + 12)
        const v0y = buf.readFloatLE(84 + 16)
        const v0z = buf.readFloatLE(84 + 20)
        expect(v0x).toBeCloseTo(0, 3)
        expect(v0y).toBeCloseTo(0, 3)
        expect(v0z).toBeCloseTo(0, 3)
      }
    })
  })

  describe('multi-triangle STL', () => {
    it('handles STL with multiple triangles', () => {
      const multiTri = buildBinaryStl([
        [[0, 0, 0], [10, 0, 0], [5, 10, 0]],
        [[10, 0, 0], [20, 0, 0], [15, 10, 0]],
        [[0, 0, 0], [5, 10, 0], [0, 10, 0]]
      ])
      const result = transformBinaryStlWithPlacement(multiTri, 'center_origin', 'y_up')
      expect(result.ok).toBe(true)
      if (result.ok) {
        const triCount = result.buffer.readUInt32LE(80)
        expect(triCount).toBe(3)
      }
    })
  })

  describe('output format', () => {
    it('output starts with header and has correct structure', () => {
      const result = transformBinaryStlWithPlacement(singleTriangleStl, 'as_is', 'y_up')
      expect(result.ok).toBe(true)
      if (result.ok) {
        // 80 bytes header + 4 bytes count + N * 50 bytes per triangle
        expect(result.buffer.length).toBe(84 + 1 * 50)
        // Header contains "UFS import"
        const headerText = result.buffer.toString('ascii', 0, 10)
        expect(headerText).toBe('UFS import')
      }
    })
  })
})
