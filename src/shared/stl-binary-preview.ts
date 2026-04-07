/**
 * Browser-safe binary STL helpers for Manufacture / preview (DataView, no Node Buffer).
 * Same triangle layout as `src/main/stl.ts` (80-byte header, 50 bytes/triangle).
 */

export type StlAxisAlignedBounds = {
  min: [number, number, number]
  max: [number, number, number]
}

const SOLID = new TextEncoder().encode('solid')

export function isLikelyAsciiStlU8(u8: Uint8Array): boolean {
  if (u8.length < 5) return false
  for (let i = 0; i < 5; i++) {
    if (u8[i] !== SOLID[i]) return false
  }
  return true
}

/** Full-file axis-aligned bounds (mm, STL/model space). */
export function computeBinaryStlBoundingBox(u8: Uint8Array): StlAxisAlignedBounds | null {
  if (u8.length < 84 || isLikelyAsciiStlU8(u8)) return null
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const triangleCount = view.getUint32(80, true)
  const expected = 84 + triangleCount * 50
  if (triangleCount < 1 || u8.length < expected) return null
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  let o = 84
  for (let i = 0; i < triangleCount; i++) {
    o += 12
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(o, true)
      o += 4
      const y = view.getFloat32(o, true)
      o += 4
      const z = view.getFloat32(o, true)
      o += 4
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
    o += 2
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ]
  }
}

export type TriangulateBinaryStlResult = {
  positions: Float32Array
  bbox: StlAxisAlignedBounds
  triangleCount: number
  truncated: boolean
}

/**
 * Non-indexed triangle list: 9 floats per triangle (v0,v1,v2 × XYZ), model/mm space.
 */
export function triangulateBinaryStl(
  u8: Uint8Array,
  maxTriangles: number = 120_000
): TriangulateBinaryStlResult | { error: string } {
  if (u8.length < 84) return { error: 'stl_too_small' }
  if (isLikelyAsciiStlU8(u8)) return { error: 'ascii_stl_not_supported' }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const fileTriangleCount = view.getUint32(80, true)
  const expected = 84 + fileTriangleCount * 50
  if (fileTriangleCount < 1 || u8.length < expected) return { error: 'stl_corrupt' }
  const useCount = Math.min(fileTriangleCount, maxTriangles)
  const positions = new Float32Array(useCount * 9)
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  let o = 84
  let pi = 0
  for (let i = 0; i < useCount; i++) {
    o += 12
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(o, true)
      o += 4
      const y = view.getFloat32(o, true)
      o += 4
      const z = view.getFloat32(o, true)
      o += 4
      positions[pi++] = x
      positions[pi++] = y
      positions[pi++] = z
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
    o += 2
  }
  return {
    positions,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    },
    triangleCount: fileTriangleCount,
    truncated: fileTriangleCount > useCount
  }
}

/** Stock box dimensions (mm) from part AABB + uniform padding on each axis (mm). */
export function stockBoxDimensionsFromPartBounds(
  bbox: StlAxisAlignedBounds,
  paddingMm: number
): { x: number; y: number; z: number } {
  const p = Math.max(0, paddingMm)
  const dx = bbox.max[0] - bbox.min[0] + 2 * p
  const dy = bbox.max[1] - bbox.min[1] + 2 * p
  const dz = bbox.max[2] - bbox.min[2] + 2 * p
  return {
    x: Math.max(1e-3, dx),
    y: Math.max(1e-3, dy),
    z: Math.max(1e-3, dz)
  }
}
