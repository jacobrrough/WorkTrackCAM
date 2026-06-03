/**
 * Generate the Makera Carvera 4-axis sample:
 *   - Cylindrical pen blank, ~20 mm diameter x 80 mm long
 *   - Axis along +X (rotary chuck convention: A rotates about X)
 *   - X=0 sits at the chuck face; the blank extends from X=0 to X=80
 *
 * Closed manifold:
 *   - 16-facet tessellated side wall  -> 32 triangles (2 per facet)
 *   - Front cap (X=0, normal -X)       -> 16 triangles (triangle fan)
 *   - Back cap  (X=80, normal +X)      -> 16 triangles (triangle fan)
 *   ----------------------------------------------------------------
 *   total                                  64 triangles
 *
 * Output: resources/samples/makera-carvera-4axis/carvera-rotary-pen-sample.stl
 *
 * Run with:  node scripts/sample-stl-gen/gen-carvera-rotary-pen.js
 *
 * Authored from scratch -- procedural tessellation, no external mesh.
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { trianglesToBinaryStl } = require('./lib-binary-stl')

const RADIUS = 10           // mm (20 mm diameter)
const LENGTH = 80           // mm along +X
const FACETS = 16           // around the X axis

function build() {
  /** @type {{a:[number,number,number],b:[number,number,number],c:[number,number,number]}[]} */
  const tris = []

  // Ring vertices at X=0 (front) and X=LENGTH (back).
  // Theta sweeps CCW when viewed from +X.
  /** @type {[number,number,number][]} */
  const ringFront = []
  /** @type {[number,number,number][]} */
  const ringBack = []
  for (let i = 0; i < FACETS; i++) {
    const t = (i / FACETS) * 2 * Math.PI
    const y = RADIUS * Math.cos(t)
    const z = RADIUS * Math.sin(t)
    ringFront.push([0,      y, z])
    ringBack.push( [LENGTH, y, z])
  }

  // Side quads -- each (i, i+1) facet around the cylinder.
  // CCW order viewed from outside: front_i, back_i, back_(i+1), front_(i+1)
  // yields normal pointing radially outward.
  for (let i = 0; i < FACETS; i++) {
    const j = (i + 1) % FACETS
    const fA = ringFront[i]
    const fB = ringFront[j]
    const bA = ringBack[i]
    const bB = ringBack[j]
    tris.push({ a: fA, b: bA, c: bB })
    tris.push({ a: fA, b: bB, c: fB })
  }

  // Front cap (X=0). Outward normal is -X, so triangle winding when
  // looking from -X must be CCW. The front ring goes CCW when viewed
  // from +X, which is CW from -X -- so we use REVERSE order for the fan.
  /** @type {[number,number,number]} */
  const frontCenter = [0, 0, 0]
  for (let i = 0; i < FACETS; i++) {
    const j = (i + 1) % FACETS
    tris.push({ a: frontCenter, b: ringFront[j], c: ringFront[i] })
  }

  // Back cap (X=LENGTH). Outward normal is +X. Looking from +X, the
  // back ring goes CCW already (same parameterization), so straight fan.
  /** @type {[number,number,number]} */
  const backCenter = [LENGTH, 0, 0]
  for (let i = 0; i < FACETS; i++) {
    const j = (i + 1) % FACETS
    tris.push({ a: backCenter, b: ringBack[i], c: ringBack[j] })
  }

  return tris
}

function main() {
  const tris = build()
  const buf = trianglesToBinaryStl(tris, 'WorkTrack3D Carvera 4-axis rotary pen blank')
  const outDir = path.resolve(__dirname, '..', '..', 'resources', 'samples', 'makera-carvera-4axis')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'carvera-rotary-pen-sample.stl')
  fs.writeFileSync(outPath, buf)
  console.log(`Wrote ${outPath} (${buf.length} bytes, ${tris.length} triangles)`)
}

main()
