/**
 * Generate the Laguna Swift 5x10 sample:
 *   - 200 x 100 mm rectangular sign-board plaque (outer cut)
 *   - One round mounting hole, 12 mm diameter, centered 25 mm from
 *     the left edge and on the Y midline (i.e. (25, 50) absolute)
 *   - One rounded-rectangle cutout, 60 x 30 mm with 5 mm corner
 *     radius, centered at (130, 50) absolute
 *
 * Origin = bottom-left corner of the plaque (X=0, Y=0). All entities
 * are closed polylines / circles / line+arc primitives so the Laguna
 * router's standard "outside profile + interior pockets" CAM strategy
 * can pick them up without ambiguity.
 *
 * Output: AutoCAD DXF R12 (AC1009) ASCII -- the most portable, most
 * widely supported flavor. No splines, no hatches, no dimensions, no
 * blocks -- just LINE, CIRCLE, ARC, and POLYLINE entities.
 *
 * Output path: resources/samples/laguna-swift-5x10/sign-board-sample.dxf
 *
 * Run with:  node scripts/sample-stl-gen/gen-sign-board-dxf.js
 *
 * Authored from scratch.
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')

// Plaque dimensions
const W = 200
const H = 100

// Mounting hole
const HOLE_CX = 25
const HOLE_CY = 50
const HOLE_R = 6 // 12 mm diameter

// Rounded-rect cutout
const RR_CX = 130       // center X
const RR_CY = 50        // center Y
const RR_W = 60         // width
const RR_H = 30         // height
const RR_R = 5          // corner radius

// DXF spec recommends CRLF, but every modern reader (FreeCAD, LibreCAD,
// Fusion 360 import, RichAuto Importer) accepts LF too -- and the repo's
// .gitattributes enforces LF on every text file (see top-level comment
// there about byte-precise pin tests). Use LF so the on-disk SHA matches
// across Windows / macOS / Linux checkouts.
const NL = '\n'

/**
 * DXF group-code + value pair, formatted with code right-aligned to 3
 * chars per AutoCAD convention.
 */
function pair(code, value) {
  // Right-align to 3 chars (with leading spaces) to match the canonical
  // AutoCAD DXF formatter.
  const codeStr = String(code).padStart(3, ' ')
  return `${codeStr}${NL}${value}${NL}`
}

function header() {
  return [
    pair(0, 'SECTION'),
    pair(2, 'HEADER'),
    // ACADVER = AC1009 (DXF R12 -- the most portable flavor).
    pair(9, '$ACADVER'),
    pair(1, 'AC1009'),
    // Drawing units = millimeters (4)
    pair(9, '$INSUNITS'),
    pair(70, '4'),
    // Drawing extents -- helps CAM importers fit-to-view.
    pair(9, '$EXTMIN'),
    pair(10, '0.0'),
    pair(20, '0.0'),
    pair(9, '$EXTMAX'),
    pair(10, W.toFixed(1)),
    pair(20, H.toFixed(1)),
    pair(0, 'ENDSEC')
  ].join('')
}

function tablesSection() {
  // Minimal TABLES section with a single LAYER ("0") so strict DXF
  // readers (Fusion, FreeCAD CAM) don't choke on missing tables.
  return [
    pair(0, 'SECTION'),
    pair(2, 'TABLES'),
    pair(0, 'TABLE'),
    pair(2, 'LAYER'),
    pair(70, '1'),
    pair(0, 'LAYER'),
    pair(2, '0'),
    pair(70, '0'),
    pair(62, '7'),     // color
    pair(6, 'CONTINUOUS'),
    pair(0, 'ENDTAB'),
    pair(0, 'ENDSEC')
  ].join('')
}

/**
 * Closed POLYLINE entity for the outer rectangle.
 *   - flag 70 = 1   -> closed
 *   - 4 vertices (CCW) + SEQEND
 */
function outerRectPolyline() {
  const verts = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H }
  ]
  const parts = [
    pair(0, 'POLYLINE'),
    pair(8, '0'),
    pair(66, '1'),     // entities follow flag
    pair(70, '1'),     // closed polyline
    pair(10, '0.0'),
    pair(20, '0.0'),
    pair(30, '0.0')
  ]
  for (const v of verts) {
    parts.push(
      pair(0, 'VERTEX'),
      pair(8, '0'),
      pair(10, v.x.toFixed(3)),
      pair(20, v.y.toFixed(3)),
      pair(30, '0.0')
    )
  }
  parts.push(pair(0, 'SEQEND'), pair(8, '0'))
  return parts.join('')
}

function mountingHoleCircle() {
  return [
    pair(0, 'CIRCLE'),
    pair(8, '0'),
    pair(10, HOLE_CX.toFixed(3)),
    pair(20, HOLE_CY.toFixed(3)),
    pair(30, '0.0'),
    pair(40, HOLE_R.toFixed(3))
  ].join('')
}

/**
 * Rounded rectangle cutout, built from 4 LINEs (the straight edges) +
 * 4 ARCs (the corner fillets). Each arc sweeps 90 degrees CCW.
 *
 * Going CCW around the rounded rect:
 *   bottom edge: x0+r,y0 -> x1-r,y0
 *   BR arc: 270 -> 360
 *   right edge:  x1,y0+r -> x1,y1-r
 *   TR arc: 0   -> 90
 *   top edge:   x1-r,y1 -> x0+r,y1
 *   TL arc: 90  -> 180
 *   left edge:  x0,y1-r -> x0,y0+r
 *   BL arc: 180 -> 270
 */
function roundedRectCutout() {
  const x0 = RR_CX - RR_W / 2
  const x1 = RR_CX + RR_W / 2
  const y0 = RR_CY - RR_H / 2
  const y1 = RR_CY + RR_H / 2
  const r = RR_R

  // Corner-arc centers (inset by r)
  const BL = { cx: x0 + r, cy: y0 + r } // start angle 180 -> 270 (CCW)
  const BR = { cx: x1 - r, cy: y0 + r } // 270 -> 360
  const TR = { cx: x1 - r, cy: y1 - r } // 0   -> 90
  const TL = { cx: x0 + r, cy: y1 - r } // 90  -> 180

  /** ARC entity (CCW from startAngleDeg to endAngleDeg, AutoCAD convention) */
  function arc(cx, cy, startDeg, endDeg) {
    return [
      pair(0, 'ARC'),
      pair(8, '0'),
      pair(10, cx.toFixed(3)),
      pair(20, cy.toFixed(3)),
      pair(30, '0.0'),
      pair(40, r.toFixed(3)),
      pair(50, startDeg.toFixed(3)),
      pair(51, endDeg.toFixed(3))
    ].join('')
  }

  /** LINE entity */
  function line(x1, y1, x2, y2) {
    return [
      pair(0, 'LINE'),
      pair(8, '0'),
      pair(10, x1.toFixed(3)),
      pair(20, y1.toFixed(3)),
      pair(30, '0.0'),
      pair(11, x2.toFixed(3)),
      pair(21, y2.toFixed(3)),
      pair(31, '0.0')
    ].join('')
  }

  return [
    line(x0 + r, y0, x1 - r, y0),
    arc(BR.cx, BR.cy, 270, 360),
    line(x1, y0 + r, x1, y1 - r),
    arc(TR.cx, TR.cy, 0, 90),
    line(x1 - r, y1, x0 + r, y1),
    arc(TL.cx, TL.cy, 90, 180),
    line(x0, y1 - r, x0, y0 + r),
    arc(BL.cx, BL.cy, 180, 270)
  ].join('')
}

function entitiesSection() {
  return [
    pair(0, 'SECTION'),
    pair(2, 'ENTITIES'),
    outerRectPolyline(),
    mountingHoleCircle(),
    roundedRectCutout(),
    pair(0, 'ENDSEC')
  ].join('')
}

function eof() {
  return pair(0, 'EOF')
}

function main() {
  const dxf = header() + tablesSection() + entitiesSection() + eof()
  const outDir = path.resolve(__dirname, '..', '..', 'resources', 'samples', 'laguna-swift-5x10')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'sign-board-sample.dxf')
  fs.writeFileSync(outPath, dxf, 'ascii')
  console.log(`Wrote ${outPath} (${dxf.length} bytes)`)
}

main()
