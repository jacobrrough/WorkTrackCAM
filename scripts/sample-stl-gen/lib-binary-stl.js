/**
 * Binary STL writer (zero-dependency).
 *
 * Binary STL layout (per the ASTM 60-byte header + uint32 triangle count
 * + 50 bytes per triangle convention used by Slic3r / Cura / OrcaSlicer
 * / FreeCAD / Carvera Controller):
 *
 *   - 80-byte header (ASCII, must NOT begin with "solid")
 *   - 4-byte little-endian uint32 triangle count
 *   - per triangle (50 bytes):
 *       - 12 bytes  -- normal (3 × float32 LE)
 *       - 36 bytes  -- 3 vertices (9 × float32 LE)
 *       -  2 bytes  -- uint16 attribute byte count (always 0)
 *
 * The normal is recomputed from the vertices via the right-hand rule so
 * downstream slicers don't have to guess orientation.
 *
 * No emojis -- this file is committed to the repo (CLAUDE.md rule).
 */
'use strict'

const HEADER_BYTES = 80
const TRI_BYTES = 50

/** @typedef {[number, number, number]} V3 */
/** @typedef {{ a: V3; b: V3; c: V3 }} Tri */

/**
 * Right-hand-rule normal of (b-a) x (c-a), normalized.
 * @param {V3} a
 * @param {V3} b
 * @param {V3} c
 * @returns {V3}
 */
function computeNormal(a, b, c) {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

/**
 * Serialize an array of triangles to a binary STL Buffer.
 * @param {Tri[]} triangles
 * @param {string} [headerText]  ASCII header (truncated to 80 bytes).
 * @returns {Buffer}
 */
function trianglesToBinaryStl(triangles, headerText = 'WorkTrack3D sample STL') {
  const buf = Buffer.alloc(HEADER_BYTES + 4 + TRI_BYTES * triangles.length)
  // Header -- intentionally avoid leading "solid" so strict parsers
  // don't mis-detect as ASCII STL.
  const headerBytes = Buffer.from(headerText.padEnd(HEADER_BYTES, ' '), 'ascii')
  headerBytes.copy(buf, 0, 0, HEADER_BYTES)
  buf.writeUInt32LE(triangles.length, HEADER_BYTES)
  let off = HEADER_BYTES + 4
  for (const t of triangles) {
    const n = computeNormal(t.a, t.b, t.c)
    buf.writeFloatLE(n[0], off); off += 4
    buf.writeFloatLE(n[1], off); off += 4
    buf.writeFloatLE(n[2], off); off += 4
    for (const v of [t.a, t.b, t.c]) {
      buf.writeFloatLE(v[0], off); off += 4
      buf.writeFloatLE(v[1], off); off += 4
      buf.writeFloatLE(v[2], off); off += 4
    }
    buf.writeUInt16LE(0, off); off += 2
  }
  return buf
}

/**
 * Helper: emit 2 triangles for a quad given 4 vertices in CCW winding
 * (right-hand normal points "out" of the surface).
 * @param {V3} v0
 * @param {V3} v1
 * @param {V3} v2
 * @param {V3} v3
 * @returns {Tri[]}
 */
function quad(v0, v1, v2, v3) {
  return [
    { a: v0, b: v1, c: v2 },
    { a: v0, b: v2, c: v3 }
  ]
}

module.exports = { trianglesToBinaryStl, computeNormal, quad }
