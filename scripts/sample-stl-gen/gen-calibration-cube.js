/**
 * Generate the K2 Plus sample: 20 mm calibration cube, solid, centered on
 * X/Y at the origin with Z=0 at the bottom face (so OrcaSlicer places it
 * directly on the build plate).
 *
 * Geometry:
 *   - axis-aligned box from (-10, -10, 0) to (10, 10, 20) mm
 *   - 12 triangles (2 per face x 6 faces)
 *   - all outward normals computed via right-hand rule in lib-binary-stl
 *
 * Output: resources/samples/creality-k2-plus/calibration-cube-20mm.stl
 *
 * Run with:  node scripts/sample-stl-gen/gen-calibration-cube.js
 *
 * Authored from scratch -- pure axis-aligned box, no third-party geometry.
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { trianglesToBinaryStl, quad } = require('./lib-binary-stl')

const SIZE = 20 // mm; classic FDM calibration cube edge.

function buildCube() {
  const x0 = -SIZE / 2, x1 = SIZE / 2
  const y0 = -SIZE / 2, y1 = SIZE / 2
  const z0 = 0,         z1 = SIZE

  // 8 corners
  /** @type {[number,number,number][]} */
  const c = [
    [x0, y0, z0], // 0  bottom front-left
    [x1, y0, z0], // 1  bottom front-right
    [x1, y1, z0], // 2  bottom back-right
    [x0, y1, z0], // 3  bottom back-left
    [x0, y0, z1], // 4  top front-left
    [x1, y0, z1], // 5  top front-right
    [x1, y1, z1], // 6  top back-right
    [x0, y1, z1]  // 7  top back-left
  ]
  // 6 faces, each given as 4 verts in CCW order viewed from outside.
  return [
    ...quad(c[1], c[0], c[3], c[2]), // bottom (-Z)
    ...quad(c[4], c[5], c[6], c[7]), // top    (+Z)
    ...quad(c[0], c[1], c[5], c[4]), // front  (-Y)
    ...quad(c[2], c[3], c[7], c[6]), // back   (+Y)
    ...quad(c[3], c[0], c[4], c[7]), // left   (-X)
    ...quad(c[1], c[2], c[6], c[5])  // right  (+X)
  ]
}

function main() {
  const tris = buildCube()
  if (tris.length !== 12) {
    throw new Error(`Expected 12 triangles for a cube; got ${tris.length}`)
  }
  const buf = trianglesToBinaryStl(tris, 'WorkTrackCAM K2 Plus 20mm calibration cube')
  const outDir = path.resolve(__dirname, '..', '..', 'resources', 'samples', 'creality-k2-plus')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'calibration-cube-20mm.stl')
  fs.writeFileSync(outPath, buf)
  console.log(`Wrote ${outPath} (${buf.length} bytes, ${tris.length} triangles)`)
}

main()
