/** Minimal binary STL parser (returns bounds + triangle count). */

export type StlBounds = {
  min: [number, number, number]
  max: [number, number, number]
  triangleCount: number
}

/** First triangle vertex floats (after 12-byte normal) look like real geometry, not ASCII text as floats. */
function stlBinaryTriangleFloatsPlausible(buffer: Buffer): boolean {
  if (buffer.length < 84 + 50) return false
  let o = 84 + 12
  for (let i = 0; i < 9; i++) {
    const f = buffer.readFloatLE(o)
    o += 4
    if (!Number.isFinite(f) || Math.abs(f) > 1e6) return false
  }
  return true
}

/**
 * How many complete 50-byte triangles exist after the 84-byte header, capped by the uint32 at offset 80.
 * If the header says 0 triangles, all complete records in the file are used (some exporters write 0).
 */
export function effectiveBinaryStlTriangleCount(buffer: Buffer): number {
  if (buffer.length < 84) return 0
  const maxFit = Math.floor((buffer.length - 84) / 50)
  if (maxFit < 1) return 0
  const declared = buffer.readUInt32LE(80)
  if (!Number.isFinite(declared) || declared < 0 || declared > 50_000_000) return 0
  if (declared === 0) return maxFit
  return Math.min(declared, maxFit)
}

export function parseBinaryStl(buffer: Buffer): StlBounds {
  if (buffer.length < 84) {
    throw new Error('STL too small')
  }
  const triangleCount = effectiveBinaryStlTriangleCount(buffer)
  if (triangleCount < 1) {
    throw new Error('STL corrupt: no complete triangles in file')
  }
  const expected = 84 + triangleCount * 50
  if (buffer.length < expected) {
    throw new Error(`STL corrupt: expected ${expected} bytes, got ${buffer.length}`)
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  let offset = 84
  for (let i = 0; i < triangleCount; i++) {
    offset += 12
    for (let v = 0; v < 3; v++) {
      const x = buffer.readFloatLE(offset)
      offset += 4
      const y = buffer.readFloatLE(offset)
      offset += 4
      const z = buffer.readFloatLE(offset)
      offset += 4
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
    offset += 2
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    triangleCount
  }
}

export type Vec3 = readonly [number, number, number]

/** Detects ASCII STL header (`solid` …); main parser is binary-only. */
export function isLikelyAsciiStl(buffer: Buffer): boolean {
  if (buffer.length < 5) return false
  const head = buffer.subarray(0, 5).toString('ascii').toLowerCase()
  return head === 'solid'
}

/**
 * True when we can read at least one complete binary STL triangle.
 * Prefer this over {@link isLikelyAsciiStl} alone: many **binary** STLs start with `solid` in the 80-byte header.
 * Also accepts files whose declared triangle count is **larger** than the bytes on disk (uses min(declared, fits)).
 */
export function isBinaryStlLayout(buffer: Buffer): boolean {
  const n = effectiveBinaryStlTriangleCount(buffer)
  if (n < 1 || buffer.length < 84 + n * 50) return false
  const declared = buffer.readUInt32LE(80)
  const strictHeader =
    Number.isFinite(declared) && declared > 0 && buffer.length >= 84 + declared * 50
  if (strictHeader) return true
  if (!isLikelyAsciiStl(buffer)) return true
  return stlBinaryTriangleFloatsPlausible(buffer)
}

/** First triangle vertices in STL model space (binary STL only). */
export function readStlFirstTriangleVertices(buffer: Buffer): [Vec3, Vec3, Vec3] | null {
  if (buffer.length < 84 || !isBinaryStlLayout(buffer)) return null
  const triangleCount = effectiveBinaryStlTriangleCount(buffer)
  if (triangleCount < 1) return null
  let o = 84 + 12
  const readV = (): Vec3 => {
    const x = buffer.readFloatLE(o)
    o += 4
    const y = buffer.readFloatLE(o)
    o += 4
    const z = buffer.readFloatLE(o)
    o += 4
    return [x, y, z]
  }
  const v0 = readV()
  const v1 = readV()
  const v2 = readV()
  return [v0, v1, v2]
}

export type StlTriangleIterateResult = { fileTriangleCount: number; yielded: number; truncated: boolean }

/**
 * Iterate binary STL triangles in file order. Stops after `maxYield` triangles (narrow-phase budget).
 */
export function iterateBinaryStlTriangles(
  buffer: Buffer,
  maxYield: number,
  fn: (v0: Vec3, v1: Vec3, v2: Vec3, fileIndex: number) => void
): StlTriangleIterateResult {
  if (buffer.length < 84 || !isBinaryStlLayout(buffer)) {
    return { fileTriangleCount: 0, yielded: 0, truncated: false }
  }
  const fileTriangleCount = effectiveBinaryStlTriangleCount(buffer)
  if (fileTriangleCount < 1) {
    return { fileTriangleCount: 0, yielded: 0, truncated: false }
  }
  let o = 84
  let yielded = 0
  for (let i = 0; i < fileTriangleCount; i++) {
    if (yielded >= maxYield) {
      return { fileTriangleCount, yielded, truncated: true }
    }
    o += 12
    const x0 = buffer.readFloatLE(o)
    o += 4
    const y0 = buffer.readFloatLE(o)
    o += 4
    const z0 = buffer.readFloatLE(o)
    o += 4
    const x1 = buffer.readFloatLE(o)
    o += 4
    const y1 = buffer.readFloatLE(o)
    o += 4
    const z1 = buffer.readFloatLE(o)
    o += 4
    const x2 = buffer.readFloatLE(o)
    o += 4
    const y2 = buffer.readFloatLE(o)
    o += 4
    const z2 = buffer.readFloatLE(o)
    o += 4
    o += 2
    fn([x0, y0, z0], [x1, y1, z1], [x2, y2, z2], i)
    yielded++
  }
  return { fileTriangleCount, yielded, truncated: false }
}

const DEFAULT_MAX_STL_TRIANGLES_CAM = 250_000

/** Collect binary STL triangles for CAM height queries (caps count for memory / perf). */
export function collectBinaryStlTriangles(
  buffer: Buffer,
  maxTriangles: number = DEFAULT_MAX_STL_TRIANGLES_CAM
): { triangles: Array<[Vec3, Vec3, Vec3]>; truncated: boolean; fileTriangleCount: number } {
  const out: Array<[Vec3, Vec3, Vec3]> = []
  const r = iterateBinaryStlTriangles(buffer, maxTriangles, (v0, v1, v2) => {
    out.push([v0, v1, v2])
  })
  return {
    triangles: out,
    truncated: r.truncated,
    fileTriangleCount: r.fileTriangleCount
  }
}

/**
 * Collect triangles from ASCII STL (`solid` … `endsolid`) for mesh sampling (e.g. 4-axis raster).
 * Caps triangle count like {@link collectBinaryStlTriangles}.
 */
export function collectAsciiStlTriangles(
  buffer: Buffer,
  maxTriangles: number = DEFAULT_MAX_STL_TRIANGLES_CAM
): { triangles: Array<[Vec3, Vec3, Vec3]>; truncated: boolean; fileTriangleCount: number } {
  const out: Array<[Vec3, Vec3, Vec3]> = []
  let facetCount = 0
  let truncated = false
  const lines = buffer.toString('utf8').split(/\r?\n/)
  let inLoop = false
  let verts: Array<[number, number, number]> = []
  for (const raw of lines) {
    const t = raw.trim()
    const low = t.toLowerCase()
    if (low.startsWith('outer loop')) {
      inLoop = true
      verts = []
      continue
    }
    if (low.startsWith('endloop')) {
      inLoop = false
      facetCount++
      if (verts.length >= 3) {
        if (out.length >= maxTriangles) {
          truncated = true
          break
        }
        const a = verts[0]!
        const b = verts[1]!
        const c = verts[2]!
        out.push([a, b, c])
      }
      continue
    }
    if (inLoop && low.startsWith('vertex')) {
      const rest = t.slice(low.indexOf('vertex') + 6).trim()
      const parts = rest.split(/\s+/).filter(Boolean)
      if (parts.length >= 3) {
        const x = Number.parseFloat(parts[0]!)
        const y = Number.parseFloat(parts[1]!)
        const z = Number.parseFloat(parts[2]!)
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          verts.push([x, y, z])
        }
      }
    }
  }
  return {
    triangles: out,
    truncated,
    fileTriangleCount: facetCount
  }
}
