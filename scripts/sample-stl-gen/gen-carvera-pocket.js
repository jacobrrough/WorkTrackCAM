/**
 * Generate the Makera Carvera 3-axis sample:
 *   - Outer block: 50 x 40 x 10 mm  (X x Y x Z)
 *   - Top-face pocket: 20 x 15 x 5 mm, centered on top face
 *
 * Centered on X/Y at origin; Z=0 is the bottom of the block; the pocket
 * is cut 5 mm down from the top face (Z=10 -> Z=5 in the pocket).
 *
 * The mesh is a closed 2-manifold (every edge shared by exactly two
 * triangles) -- the top face is decomposed as a 3x3 grid with the
 * central cell being the pocket opening, and the 4 outer side faces +
 * bottom face are pre-split at the pocket-rim X/Y projection lines so
 * all edges meet evenly (no T-junctions). OpenCAMLib and OrcaSlicer
 * both require closed manifolds, so this matters.
 *
 * Geometry (outward normals):
 *   - bottom face split into a 3x3 grid that
 *     matches the side / top splits              (9 x 2 tris)   = 18
 *   - 4 outer side faces, each pre-split into
 *     3 vertical strips at the pocket rim
 *     (so top edges share verts with the top
 *     face grid)                                 (4 x 6 tris)   = 24
 *   - top face split into 8 cells around the
 *     central hole, 2 tris per cell              (8 x 2 tris)   = 16
 *   - 4 pocket inner walls (2 tris each)         (4 x 2 tris)   =  8
 *   - pocket floor                                                =  2
 *   ----------------------------------------------------------------
 *   total                                                          68
 *
 * Output: resources/samples/makera-carvera-3axis/carvera-pocket-sample.stl
 *
 * Run with:  node scripts/sample-stl-gen/gen-carvera-pocket.js
 *
 * Authored from scratch -- pure axis-aligned constructive geometry.
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { trianglesToBinaryStl, quad } = require('./lib-binary-stl')

const BLOCK_X = 50
const BLOCK_Y = 40
const BLOCK_Z = 10
const POCKET_X = 20
const POCKET_Y = 15
const POCKET_DEPTH = 5

function build() {
  const bx0 = -BLOCK_X / 2, bx1 = BLOCK_X / 2
  const by0 = -BLOCK_Y / 2, by1 = BLOCK_Y / 2
  const bz0 = 0,            bz1 = BLOCK_Z

  const px0 = -POCKET_X / 2, px1 = POCKET_X / 2
  const py0 = -POCKET_Y / 2, py1 = POCKET_Y / 2
  const pz_floor = BLOCK_Z - POCKET_DEPTH

  // Pocket-rim corners (on top face, Z = bz1)
  const P = {
    fl: [px0, py0, bz1], fr: [px1, py0, bz1],
    br: [px1, py1, bz1], bl: [px0, py1, bz1]
  }
  // Pocket-floor corners (Z = pz_floor)
  const F = {
    fl: [px0, py0, pz_floor], fr: [px1, py0, pz_floor],
    br: [px1, py1, pz_floor], bl: [px0, py1, pz_floor]
  }

  /** @type {{a:[number,number,number],b:[number,number,number],c:[number,number,number]}[]} */
  const tris = []

  // Bottom face (-Z). Split into a 3x3 grid using the same X/Y
  // breakpoints (bx0, px0, px1, bx1 and by0, py0, py1, by1) so its
  // perimeter edges match the split outer side walls.
  /** @param {number} xi @param {number} yi @returns {[number,number,number]} */
  const bg = (xi, yi) => {
    const xs = [bx0, px0, px1, bx1]
    const ys = [by0, py0, py1, by1]
    return [xs[xi], ys[yi], bz0]
  }
  for (let yi = 0; yi < 3; yi++) {
    for (let xi = 0; xi < 3; xi++) {
      // CCW viewed from -Z -> reverse winding from the top
      const v0 = bg(xi + 1, yi)
      const v1 = bg(xi,     yi)
      const v2 = bg(xi,     yi + 1)
      const v3 = bg(xi + 1, yi + 1)
      tris.push(...quad(v0, v1, v2, v3))
    }
  }

  // Outer sides -- each split into 3 strips at the pocket-rim
  // projection lines so the top/bottom edges share vertices with the
  // top-face grid and bottom-face grid (no T-junctions).

  // -Y front face (y = by0), CCW viewed from -Y. Split at X = px0, px1.
  for (const [xa, xb] of [[bx0, px0], [px0, px1], [px1, bx1]]) {
    tris.push(...quad(
      [xa, by0, bz0],
      [xb, by0, bz0],
      [xb, by0, bz1],
      [xa, by0, bz1]
    ))
  }
  // +Y back face (y = by1), CCW viewed from +Y is opposite winding.
  for (const [xa, xb] of [[bx0, px0], [px0, px1], [px1, bx1]]) {
    tris.push(...quad(
      [xb, by1, bz0],
      [xa, by1, bz0],
      [xa, by1, bz1],
      [xb, by1, bz1]
    ))
  }
  // -X left face (x = bx0), CCW viewed from -X. Split at Y = py0, py1.
  for (const [ya, yb] of [[by0, py0], [py0, py1], [py1, by1]]) {
    tris.push(...quad(
      [bx0, yb, bz0],
      [bx0, ya, bz0],
      [bx0, ya, bz1],
      [bx0, yb, bz1]
    ))
  }
  // +X right face (x = bx1), CCW viewed from +X.
  for (const [ya, yb] of [[by0, py0], [py0, py1], [py1, by1]]) {
    tris.push(...quad(
      [bx1, ya, bz0],
      [bx1, yb, bz0],
      [bx1, yb, bz1],
      [bx1, ya, bz1]
    ))
  }

  // Top face -- 3x3 grid of cells with the central cell being the
  // pocket opening. Edges between adjacent cells match exactly -- no
  // T-junctions, no open edges.
  /** @param {number} xi @param {number} yi @returns {[number,number,number]} */
  const tg = (xi, yi) => {
    const xs = [bx0, px0, px1, bx1]
    const ys = [by0, py0, py1, by1]
    return [xs[xi], ys[yi], bz1]
  }
  for (let yi = 0; yi < 3; yi++) {
    for (let xi = 0; xi < 3; xi++) {
      if (xi === 1 && yi === 1) continue // pocket opening
      const v0 = tg(xi,     yi)
      const v1 = tg(xi + 1, yi)
      const v2 = tg(xi + 1, yi + 1)
      const v3 = tg(xi,     yi + 1)
      // CCW viewed from +Z -> outward normal is +Z
      tris.push(...quad(v0, v1, v2, v3))
    }
  }

  // Pocket walls -- normals point INTO the pocket (i.e. inward toward
  // pocket center). Each wall is a quad from the rim down to the floor.
  // -Y wall (rim front -> floor front): rim is P.fl/P.fr, floor is F.fl/F.fr
  tris.push(...quad(P.fr, P.fl, F.fl, F.fr))
  // +Y wall (rim back -> floor back)
  tris.push(...quad(P.bl, P.br, F.br, F.bl))
  // -X wall
  tris.push(...quad(P.fl, P.bl, F.bl, F.fl))
  // +X wall
  tris.push(...quad(P.br, P.fr, F.fr, F.br))

  // Pocket floor -- normal points +Z (out of the solid into the air gap)
  tris.push(...quad(F.fl, F.fr, F.br, F.bl))

  return tris
}

function main() {
  const tris = build()
  const buf = trianglesToBinaryStl(tris, 'WorkTrack3D Carvera 3-axis pocket sample')
  const outDir = path.resolve(__dirname, '..', '..', 'resources', 'samples', 'makera-carvera-3axis')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'carvera-pocket-sample.stl')
  fs.writeFileSync(outPath, buf)
  console.log(`Wrote ${outPath} (${buf.length} bytes, ${tris.length} triangles)`)
}

main()
