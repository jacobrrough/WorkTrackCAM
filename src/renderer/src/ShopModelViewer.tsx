/**
 * ShopModelViewer – Three.js STL viewer with:
 *  • Binary/ASCII STL loading via IPC (no file:// restrictions)
 *  • Transparent stock bounding box overlay
 *  • Model transform (position, rotation, scale) applied live
 *  • Orbit (left-drag), Pan (right/middle-drag), Zoom (scroll)
 *  • Interactive 3-axis gizmo: Translate / Rotate / Scale
 *  • Full-size: fills parent via position:absolute + ResizeObserver
 *  • 4-axis mode: Makera Carvera 4th-axis rig visualization
 *  • G-code toolpath preview overlay (colored rapid/cutting/plunge lines)
 *  • 3-axis: with G-code present, prefers `*.cam-aligned.stl` (same bake as CAM) so toolpath matches the mesh
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { parseGcodeToolpath, type ToolpathGeometry } from './gcode-toolpath-parse'
import { extractToolpathSegments4AxisFromGcode } from '../../shared/cam-gcode-toolpath'
import { buildCylindricalHeightFieldFromSegments, type CylindricalHeightField } from '../../shared/cam-heightfield-cylindrical'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelTransform {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }  // degrees
  scale:    { x: number; y: number; z: number }
}

export function defaultTransform(): ModelTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale:    { x: 1, y: 1, z: 1 }
  }
}

export interface StockDimensions { x: number; y: number; z: number }

export type GizmoMode = 'translate' | 'rotate' | 'scale' | null

// ── Axis colours ──────────────────────────────────────────────────────────────
const AX_COLOR = { x: 0xe74c3c, y: 0x2ecc71, z: 0x3d7eff } as const
const AX_HOVER  = 0xffff00
// Three.js Y = model Z (up), Three.js Z = model Y (depth)
const THREEJS_TO_MODEL = { x: 'x', y: 'z', z: 'y' } as const

/**
 * Sibling path written by main-process `stl:transformForCam` (see ipc-fabrication).
 * Preserves directory and `.stl` extension casing.
 *
 * Strips any existing `.cam-aligned` segments from the stem so that re-running
 * CAM on a previously-aligned file does not accumulate suffixes
 * (e.g. `model.cam-aligned.cam-aligned.stl`).
 */
export function siblingCamAlignedStlPath(rawStlPath: string): string {
  const m = rawStlPath.match(/\.stl$/i)
  if (!m) {
    const cleaned = rawStlPath.replace(/(\.cam-aligned)+$/i, '')
    return `${cleaned}.cam-aligned.stl`
  }
  const ext = m[0]
  const stem = rawStlPath.slice(0, -ext.length).replace(/(\.cam-aligned)+$/i, '')
  return `${stem}.cam-aligned${ext}`
}

/** Match 3-axis toolpath mapping in `gcode-toolpath-parse` (G-code Y,Z → Three.js Z,Y). */
function permuteStlGeometryModelCamToThreeView(geo: THREE.BufferGeometry): void {
  const attr = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!attr) return
  const a = attr.array as Float32Array
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i]
    const y = a[i + 1]
    const z = a[i + 2]
    a[i] = x
    a[i + 1] = z
    a[i + 2] = y
  }
  attr.needsUpdate = true
  geo.deleteAttribute('normal')
  geo.computeVertexNormals()
}

// ── STL parsers ───────────────────────────────────────────────────────────────
function parseStlBuffer(buf: ArrayBuffer): THREE.BufferGeometry {
  const txt = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf, 0, 256))
  return txt.trimStart().startsWith('solid') ? parseAscii(new TextDecoder().decode(buf)) : parseBinary(buf)
}
function parseBinary(buf: ArrayBuffer): THREE.BufferGeometry {
  const v = new DataView(buf)
  const n = v.getUint32(80, true)
  const pos: number[] = [], nrm: number[] = []
  let off = 84
  for (let i = 0; i < n; i++) {
    const nx = v.getFloat32(off, true), ny = v.getFloat32(off+4, true), nz = v.getFloat32(off+8, true)
    off += 12
    for (let j = 0; j < 3; j++) {
      pos.push(v.getFloat32(off, true), v.getFloat32(off+4, true), v.getFloat32(off+8, true))
      nrm.push(nx, ny, nz); off += 12
    }
    off += 2
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nrm, 3))
  return g
}
function parseAscii(txt: string): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = []
  const vRe = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const nRe = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const ns: RegExpExecArray[] = []; let m: RegExpExecArray | null
  while ((m = nRe.exec(txt)) !== null) ns.push(m)
  let ni = 0, tc = 0
  while ((m = vRe.exec(txt)) !== null) {
    const fn = ns[Math.floor(tc/3)] ?? ns[ni] ?? null
    nrm.push(fn ? +fn[1] : 0, fn ? +fn[2] : 1, fn ? +fn[3] : 0)
    pos.push(+m[1], +m[2], +m[3]); tc++
    if (tc % 3 === 0) ni++
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nrm, 3))
  return g
}
function deg(d: number): number { return d * Math.PI / 180 }

function buildToolpathGroup(geo: ToolpathGeometry): THREE.Group {
  const root = new THREE.Group(); root.name = 'toolpath'
  const add = (g: THREE.BufferGeometry, color: number, opacity: number): void => {
    if (g.getAttribute('position')?.count === 0) return
    const m = new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1, depthTest: true, linewidth: 1 })
    root.add(new THREE.LineSegments(g, m))
  }
  add(geo.rapids,  0xfbbf24, 0.45)   // amber — rapid moves
  add(geo.plunges, 0xe879f9, 0.80)   // magenta — plunge moves
  add(geo.cuts,    0x22d3ee, 0.85)   // cyan — cutting moves
  return root
}

/**
 * Build a Three.js mesh from a CylindricalHeightField showing material removal
 * on the stock cylinder.  Coordinate mapping (origin-centered):
 *   X = axial (centered at -halfLen..+halfLen)
 *   Y = axisY + radius * cos(angle)
 *   Z = axisZ + radius * sin(angle)
 */
function buildCylindricalRemovalMesh(
  hf: CylindricalHeightField,
  stockLenMm: number,
  axisY = 0,
  axisZ = 0
): THREE.Mesh {
  const { originX, cellMm, cellDeg, cols, rows, radii, stockRadius } = hf
  const halfLen = Math.max(stockLenMm, 1) * 0.5
  const vx = cols + 1
  const vy = rows + 1
  const positions = new Float32Array(vx * vy * 3)

  const sample = (ci: number, ai: number): number => {
    const ii = Math.max(0, Math.min(cols - 1, ci))
    const jj = ((ai % rows) + rows) % rows
    return radii[jj * cols + ii]!
  }

  for (let aj = 0; aj < vy; aj++) {
    for (let xi = 0; xi < vx; xi++) {
      const rAvg =
        0.25 *
        (sample(xi - 1, ((aj - 1) % rows + rows) % rows) +
          sample(xi, ((aj - 1) % rows + rows) % rows) +
          sample(xi - 1, aj % rows) +
          sample(xi, aj % rows))

      const axialPos = originX + xi * cellMm - halfLen
      const angleRad = (aj * cellDeg * Math.PI) / 180

      // Match mapGcodeToThreeEndpoints 4-axis mapping:
      //   Y = axisY + r * cos(angle)
      //   Z = axisZ + r * sin(angle)
      const o = (aj * vx + xi) * 3
      positions[o]     = axialPos
      positions[o + 1] = axisY + rAvg * Math.cos(angleRad)
      positions[o + 2] = axisZ + rAvg * Math.sin(angleRad)
    }
  }

  const indices: number[] = []
  for (let aj = 0; aj < rows; aj++) {
    for (let xi = 0; xi < cols; xi++) {
      const a = aj * vx + xi
      const b = aj * vx + xi + 1
      const c = (aj + 1) * vx + xi
      const d = (aj + 1) * vx + xi + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()

  // Depth-mapped vertex colors (teal→green gradient)
  let minRadius = Infinity
  for (let i = 0; i < radii.length; i++) minRadius = Math.min(minRadius, radii[i]!)

  const colors = new Float32Array(vx * vy * 3)
  const denom = Math.max(1e-6, stockRadius - minRadius)
  for (let aj = 0; aj < vy; aj++) {
    for (let xi = 0; xi < vx; xi++) {
      const rAvg =
        0.25 *
        (sample(xi - 1, ((aj - 1) % rows + rows) % rows) +
          sample(xi, ((aj - 1) % rows + rows) % rows) +
          sample(xi - 1, aj % rows) +
          sample(xi, aj % rows))
      const o = (aj * vx + xi) * 3
      const t = Math.min(1, Math.max(0, (stockRadius - rAvg) / denom))
      const c = new THREE.Color().setHSL(0.55 - t * 0.45, 0.65, 0.45)
      colors[o] = c.r
      colors[o + 1] = c.g
      colors[o + 2] = c.b
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.88,
    depthWrite: true,
  })
  return new THREE.Mesh(geo, mat)
}

// ── Stock wireframe ───────────────────────────────────────────────────────────
function buildStockBox(s: StockDimensions): THREE.LineSegments {
  const ls = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x, s.z, s.y)),
    new THREE.LineBasicMaterial({ color: 0xf59e0b, opacity: 0.7, transparent: true })
  )
  ls.position.set(0, s.z / 2, 0)
  return ls
}

// ── 4th-axis rotary stock visualization ──────────────────────────────────────
//
// Coordinate system (matches Fusion 360 / Mastercam rotary preview):
//   Three.js X  = machine X (axial — along rotation axis)
//   Three.js Y  = radial · cos(A)   (vertical component)
//   Three.js Z  = radial · sin(A)   (depth component)
//   Rotation axis = Three.js X at Y = 0, Z = 0 (origin-centered)
//
// Carvera 4th-axis specifics (from Makera wiki / community profiles):
//   - A-axis rotates around X (ISO 841 convention)
//   - Headstock (motor + chuck) on the left (−X side)
//   - Tailstock (live center) on the right (+X side)
//   - Spindle/tool approaches from above (+Z in machine → +Y in Three.js)
//   - Y = 0 at rotation axis center; Z = 0 at rotation axis center
//   - G-code: X = axial, Z = radial from axis, A = degrees, Y = 0
//
// ── 4-axis post config (mirrors PostConfig in ShopApp) ──
interface PostConfig4Axis {
  count: number            // 1 = single centre post; 2 or 4 = offset posts
  diameterMm: number       // post diameter (mm)
  offsetRadiusMm: number   // radial offset from rotation axis; 0 = centre
}

/**
 * Build a clean 4th-axis stock visualization centered at the origin.
 * Supports cylinder (round bar) and square (square bar) cross-sections.
 * Zone markings, axis line, and optional support posts.
 */
function buildFourAxisRig(
  stockLen: number,
  stockDia: number,
  chuckDepthMm: number,
  clampOffsetMm: number,
  posts: PostConfig4Axis | null,
  _scene: THREE.Scene,
  stockProfile: 'cylinder' | 'square' = 'cylinder'
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'fourAxisRig'

  const halfLen = stockLen / 2
  const stockR  = stockDia / 2
  const isSquare = stockProfile === 'square'
  const ROT     = new THREE.Euler(0, 0, Math.PI / 2)  // align CylinderGeometry (Y-up) with X

  // ── Materials ─────────────────────────────────────────────────────────────
  const stockMat = new THREE.MeshPhongMaterial({
    color: 0xd4a55a, opacity: 0.32, transparent: true,
    side: THREE.DoubleSide, depthWrite: false
  })
  const clampMat = new THREE.MeshPhongMaterial({
    color: 0xcc4040, opacity: 0.32, transparent: true,
    side: THREE.DoubleSide, depthWrite: false
  })
  const offsetMat = new THREE.MeshPhongMaterial({
    color: 0xe67e22, opacity: 0.32, transparent: true,
    side: THREE.DoubleSide, depthWrite: false
  })
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b, opacity: 0.65, transparent: true
  })
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xf59e0b, opacity: 0.55, transparent: true
  })

  // ── Stock zones (centered at origin along X) ─────────────────────────────
  const clampLen  = Math.max(0, Math.min(chuckDepthMm, stockLen * 0.6))
  const offsetLen = Math.max(0, Math.min(clampOffsetMm, stockLen - clampLen - 1))
  const machLen   = stockLen - clampLen - offsetLen

  function addCylinder(len: number, mat: THREE.Material, centerX: number): void {
    if (len < 0.1) return
    const geo  = new THREE.CylinderGeometry(stockR, stockR, len, 32, 1, true)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(centerX, 0, 0)
    mesh.rotation.copy(ROT)
    root.add(mesh)
  }

  function addSquareSection(len: number, mat: THREE.Material, centerX: number): void {
    if (len < 0.1) return
    const geo  = new THREE.BoxGeometry(len, stockDia, stockDia)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(centerX, 0, 0)
    root.add(mesh)
    // Add wireframe edges for visibility
    const edges = new THREE.EdgesGeometry(geo)
    const line  = new THREE.LineSegments(edges, edgeMat)
    line.position.set(centerX, 0, 0)
    root.add(line)
  }

  const addSection = isSquare ? addSquareSection : addCylinder

  // Clamped zone (red) — left end, inside chuck
  addSection(clampLen, clampMat, -halfLen + clampLen / 2)
  // Offset zone (orange) — safety buffer after clamp
  addSection(offsetLen, offsetMat, -halfLen + clampLen + offsetLen / 2)
  // Machinable zone (amber) — where cutting happens
  addSection(Math.max(0.1, machLen), stockMat, -halfLen + clampLen + offsetLen + machLen / 2)

  // ── End-cap markers ───────────────────────────────────────────────────────
  if (isSquare) {
    // Square end-cap wireframe rings
    const capSize = stockDia + 1.6
    for (const xPos of [-halfLen, +halfLen]) {
      const capGeo = new THREE.BoxGeometry(0.01, capSize, capSize)
      const capEdges = new THREE.EdgesGeometry(capGeo)
      const cap = new THREE.LineSegments(capEdges, ringMat)
      cap.position.set(xPos, 0, 0)
      root.add(cap)
    }
  } else {
    const torusGeo = new THREE.TorusGeometry(stockR, 0.8, 8, 48)
    for (const xPos of [-halfLen, +halfLen]) {
      const ring = new THREE.Mesh(torusGeo, ringMat)
      ring.position.set(xPos, 0, 0)
      ring.rotation.set(0, Math.PI / 2, 0)
      root.add(ring)
    }
  }

  // ── Zone boundary markers ─────────────────────────────────────────────────
  if (clampLen > 0.1) {
    if (isSquare) {
      const bndSize = stockDia + 2.4
      const bndGeo = new THREE.BoxGeometry(0.01, bndSize, bndSize)
      const bndEdges = new THREE.EdgesGeometry(bndGeo)
      const cr = new THREE.LineSegments(bndEdges, new THREE.LineBasicMaterial({ color: 0xff4444, opacity: 0.8, transparent: true }))
      cr.position.set(-halfLen + clampLen, 0, 0)
      root.add(cr)
    } else {
      const boundGeo = new THREE.TorusGeometry(stockR + 1.2, 0.9, 8, 48)
      const cr = new THREE.Mesh(boundGeo, new THREE.MeshBasicMaterial({ color: 0xff4444, opacity: 0.8, transparent: true }))
      cr.position.set(-halfLen + clampLen, 0, 0)
      cr.rotation.set(0, Math.PI / 2, 0)
      root.add(cr)
    }
  }
  if (offsetLen > 0.1) {
    if (isSquare) {
      const bndSize = stockDia + 2.4
      const bndGeo = new THREE.BoxGeometry(0.01, bndSize, bndSize)
      const bndEdges = new THREE.EdgesGeometry(bndGeo)
      const or = new THREE.LineSegments(bndEdges, new THREE.LineBasicMaterial({ color: 0xe67e22, opacity: 0.8, transparent: true }))
      or.position.set(-halfLen + clampLen + offsetLen, 0, 0)
      root.add(or)
    } else {
      const boundGeo = new THREE.TorusGeometry(stockR + 1.2, 0.9, 8, 48)
      const or = new THREE.Mesh(boundGeo, new THREE.MeshBasicMaterial({ color: 0xe67e22, opacity: 0.8, transparent: true }))
      or.position.set(-halfLen + clampLen + offsetLen, 0, 0)
      or.rotation.set(0, Math.PI / 2, 0)
      root.add(or)
    }
  }

  // ── Ghost inscribed cylinder (shown only for square stock) ────────────────
  if (isSquare) {
    const ghostMat = new THREE.MeshPhongMaterial({
      color: 0x88ccff, opacity: 0.08, transparent: true,
      side: THREE.DoubleSide, depthWrite: false
    })
    const ghostGeo = new THREE.CylinderGeometry(stockR, stockR, stockLen, 32, 1, true)
    const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat)
    ghostMesh.rotation.copy(ROT)
    root.add(ghostMesh)
  }

  // ── Rotation axis line ────────────────────────────────────────────────────
  const ext = 30 // extend beyond stock ends
  const axisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-(halfLen + ext), 0, 0),
    new THREE.Vector3(+(halfLen + ext), 0, 0),
  ])
  root.add(new THREE.Line(axisGeo,
    new THREE.LineBasicMaterial({ color: 0xff6600, opacity: 0.45, transparent: true })))

  // ── Headstock / tailstock indicators ──────────────────────────────────────
  const bracketMat = new THREE.MeshPhongMaterial({
    color: 0x8090a0, opacity: 0.5, transparent: true
  })
  if (isSquare) {
    // Square plate indicators
    const hsGeo = new THREE.BoxGeometry(2, stockDia + 8, stockDia + 8)
    const hs = new THREE.Mesh(hsGeo, bracketMat)
    hs.position.set(-halfLen - 1, 0, 0)
    root.add(hs)
    const tsGeo = new THREE.BoxGeometry(1.5, stockDia + 4, stockDia + 4)
    const ts = new THREE.Mesh(tsGeo, bracketMat)
    ts.position.set(halfLen + 0.75, 0, 0)
    root.add(ts)
  } else {
    // Disc indicators
    const hsDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(stockR + 4, stockR + 4, 2, 32),
      bracketMat
    )
    hsDisc.position.set(-halfLen - 1, 0, 0)
    hsDisc.rotation.copy(ROT)
    root.add(hsDisc)
    const tsDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(stockR + 2, stockR + 2, 1.5, 32),
      bracketMat
    )
    tsDisc.position.set(halfLen + 0.75, 0, 0)
    tsDisc.rotation.copy(ROT)
    root.add(tsDisc)
  }

  // ── Support posts ─────────────────────────────────────────────────────────
  if (posts && posts.count > 0 && posts.diameterMm > 0.1) {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e, roughness: 0.35, metalness: 0.15,
      opacity: 0.6, transparent: true
    })
    const postR = Math.max(0.5, posts.diameterMm / 2)
    const offR  = posts.offsetRadiusMm ?? 0
    for (let i = 0; i < posts.count; i++) {
      const angle = (i / posts.count) * Math.PI * 2
      const py    = offR * Math.cos(angle)
      const pz    = offR * Math.sin(angle)
      const pGeo  = new THREE.CylinderGeometry(postR, postR, stockLen, 16)
      const pMesh = new THREE.Mesh(pGeo, postMat)
      pMesh.position.set(0, py, pz)
      pMesh.rotation.copy(ROT)
      root.add(pMesh)
    }
  }

  return root
}

// Dispose of all geometries and materials in a Group recursively
function disposeGroup(group: THREE.Group): void {
  group.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
      else obj.material.dispose()
    }
    if (obj instanceof THREE.Line) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
      else (obj.material as THREE.Material).dispose()
    }
  })
}

// ── Gizmo builders ────────────────────────────────────────────────────────────
function mat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity })
}

function buildTranslateGizmo(): THREE.Group {
  const root = new THREE.Group(); root.name = 'gizmo'
  for (const [ax, col] of Object.entries(AX_COLOR) as [keyof typeof AX_COLOR, number][]) {
    const g = new THREE.Group(); g.userData.axis = ax
    // shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 35, 6), mat(col))
    shaft.position.y = 17.5; shaft.userData.axis = ax; shaft.renderOrder = 999
    // arrowhead cone
    const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 14, 8), mat(col))
    cone.position.y = 42; cone.userData.axis = ax; cone.renderOrder = 999
    g.add(shaft, cone)
    if (ax === 'x') g.rotation.z = -Math.PI / 2
    if (ax === 'z') g.rotation.x =  Math.PI / 2
    root.add(g)
  }
  // center handle
  const center = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), mat(0xffffff, 0.9))
  center.userData.axis = 'xyz'; center.renderOrder = 999
  root.add(center)
  return root
}

function buildRotateGizmo(): THREE.Group {
  const root = new THREE.Group(); root.name = 'gizmo'
  const R = 44, tube = 2
  for (const [ax, col] of Object.entries(AX_COLOR) as [keyof typeof AX_COLOR, number][]) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(R, tube, 6, 40),
      mat(col, 0.85)
    )
    torus.userData.axis = ax; torus.renderOrder = 999
    if (ax === 'x') torus.rotation.y = Math.PI / 2
    if (ax === 'z') torus.rotation.x = Math.PI / 2
    root.add(torus)
  }
  // center sphere
  const center = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), mat(0xffffff, 0.7))
  center.userData.axis = 'xyz'; center.renderOrder = 999
  root.add(center)
  return root
}

function buildScaleGizmo(): THREE.Group {
  const root = new THREE.Group(); root.name = 'gizmo'
  for (const [ax, col] of Object.entries(AX_COLOR) as [keyof typeof AX_COLOR, number][]) {
    const g = new THREE.Group(); g.userData.axis = ax
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 35, 6), mat(col))
    shaft.position.y = 17.5; shaft.userData.axis = ax; shaft.renderOrder = 999
    const cube = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat(col))
    cube.position.y = 42; cube.userData.axis = ax; cube.renderOrder = 999
    g.add(shaft, cube)
    if (ax === 'x') g.rotation.z = -Math.PI / 2
    if (ax === 'z') g.rotation.x =  Math.PI / 2
    root.add(g)
  }
  const center = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat(0xffffff, 0.9))
  center.userData.axis = 'xyz'; center.renderOrder = 999
  root.add(center)
  return root
}

function applyTransform(mesh: THREE.Mesh, t: ModelTransform): void {
  mesh.position.set(t.position.x, t.position.z, t.position.y)
  mesh.rotation.set(deg(t.rotation.x), deg(t.rotation.z), deg(t.rotation.y))
  mesh.scale.set(t.scale.x, t.scale.z, t.scale.y)
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  stlPath: string | null
  stock: StockDimensions
  /** Cross-section shape for 4-axis rotary stock. Default: 'cylinder'. */
  stockProfile?: 'cylinder' | 'square'
  transform: ModelTransform
  transformMode: GizmoMode
  mode?: string
  gcodeOut?: string | null
  /** Bumped after each successful generation to force toolpath re-read. */
  gcodeGeneration?: number
  /** How many mm of stock are clamped inside the chuck (5 or 10). Default 5. */
  chuckDepthMm?: number
  /** Safety buffer between clamped zone and model, shown as orange (mm). Default 0. */
  clampOffsetMm?: number
  /** Support post(s) — cylinder(s) running axially through the workpiece centre. */
  posts?: PostConfig4Axis | null
  onTransformChange?: (t: ModelTransform) => void
  onModelLoaded?: (sx: number, sy: number, sz: number) => void
}

export function ShopModelViewer({
  stlPath, stock, stockProfile = 'cylinder', transform, transformMode, mode, gcodeOut,
  gcodeGeneration = 0,
  chuckDepthMm = 5, clampOffsetMm = 0, posts = null,
  onTransformChange, onModelLoaded
}: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)

  // Store everything mutable in a ref so effects don't capture stale values
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera
    mesh: THREE.Mesh | null; stockBox: THREE.LineSegments | null
    fourAxisRig: THREE.Group | null
    toolpathGrp: THREE.Group | null
    removalMesh: THREE.Mesh | null
    gizmo: THREE.Group | null; gizmoMode: GizmoMode
    animId: number
    // orbit
    isDragging: boolean; isPanning: boolean
    lastMouse: { x: number; y: number }
    phi: number; theta: number; radius: number; target: THREE.Vector3
    // gizmo drag
    draggingAxis: string | null
    dragStartMouse: { x: number; y: number }
    dragStartTransform: ModelTransform | null
    hoveredAxis: string | null
    // live refs so callbacks always see fresh values
    transformRef: ModelTransform
    onTransformRef: ((t: ModelTransform) => void) | undefined
  } | null>(null)

  // Keep live refs so mouse handlers always see the latest props
  useEffect(() => {
    if (stateRef.current) {
      stateRef.current.transformRef    = transform
      stateRef.current.onTransformRef  = onTransformChange
    }
  })

  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [modelSize,      setModelSize]      = useState('')
  const [showToolpath,   setShowToolpath]   = useState(false)
  const [toolpathStats,  setToolpathStats]  = useState<{ rapids: number; cuts: number; plunges: number } | null>(null)
  const [toolpathLoading, setToolpathLoading] = useState(false)
  /** When true, mesh vertices are CAM-baked + axis-mapped; gizmo transform is not applied until reload. */
  const [meshUsesCamAligned, setMeshUsesCamAligned] = useState(false)

  const is4Axis = mode === 'cnc_4axis' || mode === 'cnc_5axis'

  /** Same bake as `fab().stlTransformForCam` (3-axis preview only). Rotary keeps raw mesh + transform. */
  const preferCamAlignedMesh =
    Boolean(stlPath && gcodeOut?.trim() && /\.stl$/i.test(stlPath)) &&
    !is4Axis &&
    mode !== 'fdm'

  // ── Load / clear toolpath ─────────────────────────────────────────────────
  const loadToolpath = useCallback(async (path: string) => {
    const s = stateRef.current
    if (!s) return
    // Remove existing toolpath and removal mesh
    if (s.toolpathGrp) {
      disposeGroup(s.toolpathGrp)
      s.scene.remove(s.toolpathGrp)
      s.toolpathGrp = null
    }
    if (s.removalMesh) {
      s.removalMesh.geometry.dispose()
      ;(s.removalMesh.material as THREE.Material).dispose()
      s.scene.remove(s.removalMesh)
      s.removalMesh = null
    }
    setToolpathLoading(true)
    try {
      const b64 = await (window as Window & { fab: { fsReadBase64:(p:string)=>Promise<string> } }).fab.fsReadBase64(path)
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const geo = parseGcodeToolpath(text, {
        fourAxis: is4Axis,
        stockLenMm: stock.x,
        // Center toolpath at origin to match the rig and model
        axisYMm: 0,
        axisZMm: 0
      })
      const grp = buildToolpathGroup(geo)
      s.scene.add(grp)
      s.toolpathGrp = grp
      setToolpathStats(geo.stats)

      // ── 4-axis: build cylindrical material removal mesh ────────────────
      if (is4Axis) {
        try {
          const segs4 = extractToolpathSegments4AxisFromGcode(text)
          if (segs4.length > 0) {
            let xMin = Infinity, xMax = -Infinity
            for (const seg of segs4) {
              xMin = Math.min(xMin, seg.x0, seg.x1)
              xMax = Math.max(xMax, seg.x0, seg.x1)
            }
            // Extract tool diameter from G-code comment or default to 6mm
            const toolDiaMatch = text.match(/;\s*tool\s+.*?(\d+(?:\.\d+)?)mm/i)
            const toolDia = toolDiaMatch ? parseFloat(toolDiaMatch[1]!) : 6
            const cylDia = Math.max(1, stock.y)
            const hf = buildCylindricalHeightFieldFromSegments(segs4, {
              toolRadiusMm: toolDia * 0.5,
              cylinderDiameterMm: cylDia,
              stockXMin: xMin,
              stockXMax: xMax,
              maxCols: 96,
              maxRows: 120,
            })
            if (hf) {
              // Removal mesh wraps around the rotation axis at origin
              const rmMesh = buildCylindricalRemovalMesh(hf, stock.x)
              s.scene.add(rmMesh)
              s.removalMesh = rmMesh
            }
          }
        } catch (e) {
          console.warn('4-axis removal mesh build failed:', e)
        }
      }
    } catch (e) {
      console.warn('Toolpath load failed:', e)
    } finally {
      setToolpathLoading(false)
    }
  }, [is4Axis, stock.x, stock.y])

  const clearToolpath = useCallback(() => {
    const s = stateRef.current
    if (!s) return
    if (s.toolpathGrp) {
      disposeGroup(s.toolpathGrp)
      s.scene.remove(s.toolpathGrp)
      s.toolpathGrp = null
    }
    if (s.removalMesh) {
      s.removalMesh.geometry.dispose()
      ;(s.removalMesh.material as THREE.Material).dispose()
      s.scene.remove(s.removalMesh)
      s.removalMesh = null
    }
    setToolpathStats(null)
  }, [])

  useEffect(() => {
    if (showToolpath && gcodeOut) {
      void loadToolpath(gcodeOut)
    } else {
      clearToolpath()
    }
  // gcodeGeneration forces a re-read when the file is regenerated at the same path
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToolpath, gcodeOut, gcodeGeneration, loadToolpath, clearToolpath])

  // ── Init Three.js ────────────────────────────────────────────────────────────
  useEffect(() => {
    const c0 = canvasRef.current
    const w0 = wrapRef.current
    if (!c0 || !w0) return
    const canvasEl: HTMLCanvasElement = c0
    const wrapEl: HTMLDivElement = w0

    const W = wrapEl.clientWidth  || 800
    const H = wrapEl.clientHeight || 600
    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    renderer.setClearColor(0x0d0e10)

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))
    const d1 = new THREE.DirectionalLight(0xffffff, 0.9); d1.position.set(1, 2, 3); scene.add(d1)
    const d2 = new THREE.DirectionalLight(0x8899ff, 0.3); d2.position.set(-2,-1,-2); scene.add(d2)
    scene.add(new THREE.GridHelper(400, 20, 0x2e3140, 0x1c1e22))
    scene.add(new THREE.AxesHelper(20))

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 10000)
    camera.position.set(0, 120, 200)

    const raycaster = new THREE.Raycaster()

    const s = {
      renderer, scene, camera,
      mesh: null as THREE.Mesh | null, stockBox: null as THREE.LineSegments | null,
      fourAxisRig: null as THREE.Group | null,
      toolpathGrp: null as THREE.Group | null,
      removalMesh: null as THREE.Mesh | null,
      gizmo: null as THREE.Group | null, gizmoMode: null as GizmoMode,
      animId: 0,
      isDragging: false, isPanning: false,
      lastMouse: { x: 0, y: 0 },
      phi: Math.PI / 3, theta: Math.PI / 4, radius: 250, target: new THREE.Vector3(),
      draggingAxis: null as string | null,
      dragStartMouse: { x: 0, y: 0 },
      dragStartTransform: null as ModelTransform | null,
      hoveredAxis: null as string | null,
      transformRef: transform,
      onTransformRef: onTransformChange
    }
    stateRef.current = s

    // ── Render loop ──────────────────────────────────────────────────────────
    function render(): void {
      s.animId = requestAnimationFrame(render)
      // Update orbit camera
      const cx = s.radius * Math.sin(s.phi) * Math.cos(s.theta) + s.target.x
      const cy = s.radius * Math.cos(s.phi)                      + s.target.y
      const cz = s.radius * Math.sin(s.phi) * Math.sin(s.theta)  + s.target.z
      s.camera.position.set(cx, cy, cz)
      s.camera.lookAt(s.target)
      // Resize gizmo to stay constant screen-size
      if (s.gizmo && s.mesh) {
        s.gizmo.position.copy(s.mesh.position)
        s.gizmo.scale.setScalar(s.radius * 0.20 / 50)
      }
      s.renderer.render(s.scene, s.camera)
    }
    render()

    // ── Helpers ───────────────────────────────────────────────────────────────
    function ndcOf(e: { clientX: number; clientY: number }): THREE.Vector2 {
      const r = canvasEl.getBoundingClientRect()
      return new THREE.Vector2(
        (e.clientX - r.left) / r.width  *  2 - 1,
       -(e.clientY - r.top)  / r.height *  2 + 1
      )
    }

    function gizmoAxisAt(e: MouseEvent): string | null {
      if (!s.gizmo) return null
      raycaster.setFromCamera(ndcOf(e), s.camera)
      const hits = raycaster.intersectObjects(s.gizmo.children, true)
      return hits.length > 0 ? (hits[0].object.userData.axis as string ?? null) : null
    }

    function setHover(axis: string | null): void {
      if (axis === s.hoveredAxis) return
      s.hoveredAxis = axis
      if (!s.gizmo) return
      s.gizmo.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return
        const m = obj.material as THREE.MeshBasicMaterial
        const ax = obj.userData.axis as string
        if (!ax) return
        const base = AX_COLOR[ax as keyof typeof AX_COLOR] ?? 0xffffff
        m.color.setHex(axis && (ax === axis || ax === 'xyz') ? AX_HOVER : base)
      })
    }

    // Project a world-axis direction to a normalised 2D screen direction
    function screenDir(worldAxis: THREE.Vector3): THREE.Vector2 {
      const origin = s.gizmo?.position.clone() ?? new THREE.Vector3()
      const tip = origin.clone().add(worldAxis.clone().multiplyScalar(50))
      const p0 = origin.clone().project(s.camera)
      const p1 = tip.clone().project(s.camera)
      const d = new THREE.Vector2(p1.x - p0.x, p1.y - p0.y)
      return d.length() < 0.0001 ? new THREE.Vector2(1, 0) : d.normalize()
    }

    function axisVec(ax: string): THREE.Vector3 {
      if (ax === 'x') return new THREE.Vector3(1, 0, 0)
      if (ax === 'y') return new THREE.Vector3(0, 1, 0)
      if (ax === 'z') return new THREE.Vector3(0, 0, 1)
      return new THREE.Vector3()
    }

    // ── Mouse handlers ────────────────────────────────────────────────────────
    function onDown(e: MouseEvent): void {
      const ax = gizmoAxisAt(e)
      if (ax && s.gizmoMode) {
        s.draggingAxis = ax
        s.dragStartMouse = { x: e.clientX, y: e.clientY }
        s.dragStartTransform = JSON.parse(JSON.stringify(s.transformRef)) as ModelTransform
        canvasEl.style.cursor = 'none'
        return
      }
      if (e.button === 2 || e.button === 1) s.isPanning = true
      else s.isDragging = true
      s.lastMouse = { x: e.clientX, y: e.clientY }
    }

    function onMove(e: MouseEvent): void {
      const dx = e.clientX - s.lastMouse.x
      const dy = e.clientY - s.lastMouse.y

      // ── Gizmo drag ────────────────────────────────────────────────────────
      if (s.draggingAxis && s.dragStartTransform && s.onTransformRef) {
        const totalDx = e.clientX - s.dragStartMouse.x
        const totalDy = e.clientY - s.dragStartMouse.y
        const t = JSON.parse(JSON.stringify(s.dragStartTransform)) as ModelTransform

        if (s.gizmoMode === 'translate') {
          if (s.draggingAxis === 'xyz') {
            // Free XY move in camera plane
            const right = new THREE.Vector3()
            const up = new THREE.Vector3(0, 1, 0)
            right.crossVectors(s.camera.position.clone().sub(s.target).normalize(), up).normalize()
            const scale = s.radius * 0.0015
            t.position.x += right.x * totalDx * scale
            t.position.z += right.z * totalDx * scale
            t.position.z -= totalDy * scale
          } else {
            const av = axisVec(s.draggingAxis)
            const sd = screenDir(av)
            const rect = canvasEl.getBoundingClientRect()
            const ndcDx = totalDx / rect.width
            const ndcDy = -totalDy / rect.height
            const proj = ndcDx * sd.x + ndcDy * sd.y
            const worldDelta = proj * s.radius * 1.8
            const modelAx = THREEJS_TO_MODEL[s.draggingAxis as keyof typeof THREEJS_TO_MODEL]
            if (modelAx) (t.position as Record<string, number>)[modelAx] = (s.dragStartTransform.position as Record<string, number>)[modelAx] + worldDelta
          }
        }

        if (s.gizmoMode === 'rotate') {
          const DEG_PER_PX = 0.5
          if (s.draggingAxis === 'x') t.rotation.x = s.dragStartTransform.rotation.x - totalDy * DEG_PER_PX
          if (s.draggingAxis === 'y') t.rotation.z = s.dragStartTransform.rotation.z + totalDx * DEG_PER_PX
          if (s.draggingAxis === 'z') t.rotation.y = s.dragStartTransform.rotation.y + totalDx * DEG_PER_PX
          if (s.draggingAxis === 'xyz') {
            t.rotation.z = s.dragStartTransform.rotation.z + totalDx * DEG_PER_PX
            t.rotation.x = s.dragStartTransform.rotation.x - totalDy * DEG_PER_PX
          }
        }

        if (s.gizmoMode === 'scale') {
          const SCALE_PER_PX = 0.005
          const delta = totalDx * SCALE_PER_PX
          if (s.draggingAxis === 'xyz') {
            t.scale.x = Math.max(0.01, s.dragStartTransform.scale.x + delta)
            t.scale.y = Math.max(0.01, s.dragStartTransform.scale.y + delta)
            t.scale.z = Math.max(0.01, s.dragStartTransform.scale.z + delta)
          } else {
            const modelAx = THREEJS_TO_MODEL[s.draggingAxis as keyof typeof THREEJS_TO_MODEL]
            if (modelAx) (t.scale as Record<string, number>)[modelAx] = Math.max(0.01, (s.dragStartTransform.scale as Record<string, number>)[modelAx] + delta)
          }
        }

        s.onTransformRef(t)
        s.lastMouse = { x: e.clientX, y: e.clientY }
        return
      }

      // ── Orbit / pan ───────────────────────────────────────────────────────
      if (s.isDragging) {
        s.theta -= dx * 0.008
        s.phi = Math.max(0.05, Math.min(Math.PI - 0.05, s.phi + dy * 0.008))
      } else if (s.isPanning) {
        const right = new THREE.Vector3()
        right.crossVectors(s.camera.position.clone().sub(s.target).normalize(), new THREE.Vector3(0,1,0)).normalize()
        const sc = s.radius * 0.001
        s.target.addScaledVector(right, -dx * sc)
        s.target.y += dy * sc
      } else {
        // hover gizmo highlight
        setHover(gizmoAxisAt(e))
      }
      s.lastMouse = { x: e.clientX, y: e.clientY }
    }

    function onUp(): void {
      s.draggingAxis = null
      s.dragStartTransform = null
      s.isDragging = false
      s.isPanning = false
      canvasEl.style.cursor = ''
    }
    function onWheel(e: WheelEvent): void {
      s.radius = Math.max(10, Math.min(3000, s.radius + e.deltaY * 0.4))
    }

    canvasEl.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvasEl.addEventListener('wheel', onWheel, { passive: true })
    canvasEl.addEventListener('contextmenu', e => e.preventDefault())

    // ── ResizeObserver ────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = wrapEl.clientWidth, nh = wrapEl.clientHeight
      if (!nw || !nh) return
      s.renderer.setSize(nw, nh)
      s.camera.aspect = nw / nh
      s.camera.updateProjectionMatrix()
    })
    ro.observe(wrapEl)

    return () => {
      ro.disconnect()
      cancelAnimationFrame(s.animId)
      renderer.dispose()
      canvasEl.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvasEl.removeEventListener('wheel', onWheel)
      stateRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Rebuild gizmo when mode changes ──────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    // Remove old gizmo
    if (s.gizmo) { s.scene.remove(s.gizmo); s.gizmo = null }
    s.gizmoMode = transformMode
    if (!transformMode || meshUsesCamAligned) return
    const g = transformMode === 'translate' ? buildTranslateGizmo()
             : transformMode === 'rotate'    ? buildRotateGizmo()
             :                                 buildScaleGizmo()
    if (s.mesh) g.position.copy(s.mesh.position)
    s.scene.add(g)
    s.gizmo = g
  }, [transformMode, meshUsesCamAligned])

  // ── Rebuild stock box or 4-axis rig ───────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Always remove the old flat stock box
    if (s.stockBox) { s.scene.remove(s.stockBox); s.stockBox = null }

    // Always remove old rig
    if (s.fourAxisRig) {
      disposeGroup(s.fourAxisRig)
      s.scene.remove(s.fourAxisRig)
      s.fourAxisRig = null
    }

    if (is4Axis) {
      // 4-axis mode: show rig + cylinder stock, hide flat box
      // Use stock.x as cylinder length, stock.y as diameter (matches 4-axis cylinderDiameterMm concept)
      const cylLen = Math.max(20, stock.x)
      const cylDia = Math.max(10, stock.y)
      const rig = buildFourAxisRig(cylLen, cylDia, chuckDepthMm, clampOffsetMm, posts, s.scene, stockProfile)
      s.scene.add(rig)
      s.fourAxisRig = rig
      // Camera looks at the origin (rotation axis center)
      if (!stlPath) {
        s.target.set(0, 0, 0)
        s.radius = Math.max(s.radius, cylLen * 1.8 + 200)
        s.phi = Math.PI / 3.5
        s.theta = -Math.PI / 5
      }
    } else {
      // Normal mode: show flat stock box
      const b = buildStockBox(stock); s.scene.add(b); s.stockBox = b
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // posts is an object — serialize primitives into deps to avoid infinite loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock.x, stock.y, stock.z, is4Axis, chuckDepthMm, clampOffsetMm,
    posts?.count, posts?.diameterMm, posts?.offsetRadiusMm, stockProfile])

  // ── Load STL ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (s.mesh) { s.scene.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); s.mesh = null }
    if (!stlPath) {
      setModelSize('')
      setMeshUsesCamAligned(false)
      return
    }
    const fab = (window as Window & { fab: { fsReadBase64: (p: string) => Promise<string> } }).fab
    const pathsToTry = preferCamAlignedMesh ? [siblingCamAlignedStlPath(stlPath), stlPath] : [stlPath]

    setLoading(true); setError(null)
    setMeshUsesCamAligned(false)
    ;(async () => {
      let lastErr: unknown = null
      for (let pi = 0; pi < pathsToTry.length; pi++) {
        const path = pathsToTry[pi]
        const isCamAlignedMesh = preferCamAlignedMesh && pi === 0
        try {
          const b64 = await fab.fsReadBase64(path)
          const bin = atob(b64); const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const geo = parseStlBuffer(bytes.buffer)

          if (isCamAlignedMesh) {
            permuteStlGeometryModelCamToThreeView(geo)
            geo.computeBoundingBox()
          } else {
            geo.computeBoundingBox()
            const bb0 = geo.boundingBox!
            const c = new THREE.Vector3(); bb0.getCenter(c); geo.translate(-c.x, -c.y, -c.z)
          }

          const bb = geo.boundingBox!
          const sz = new THREE.Vector3(); bb.getSize(sz)
          setModelSize(`${sz.x.toFixed(1)} × ${sz.y.toFixed(1)} × ${sz.z.toFixed(1)} mm`)
          onModelLoaded?.(sz.x, sz.y, sz.z)
          const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
            color: 0x3d7eff, emissive: 0x0a1840, specular: 0x224488, shininess: 40, side: THREE.DoubleSide
          }))
          if (isCamAlignedMesh) {
            mesh.position.set(0, 0, 0)
            mesh.rotation.set(0, 0, 0)
            mesh.scale.set(1, 1, 1)
            setMeshUsesCamAligned(true)
          } else {
            setMeshUsesCamAligned(false)
            applyTransform(mesh, transform)
          }
          s.scene.add(mesh); s.mesh = mesh
          const md = Math.max(sz.x, sz.y, sz.z)
          s.radius = md * 2.2; s.phi = Math.PI / 3; s.theta = Math.PI / 4
          if (is4Axis) {
            s.target.set(0, 0, 0)
            s.radius = Math.max(s.radius, md * 2.5)
          } else {
            const tc = new THREE.Vector3(); bb.getCenter(tc)
            if (isCamAlignedMesh) {
              s.target.copy(tc)
            } else {
              s.target.set(transform.position.x, transform.position.z * 0.5, transform.position.y)
            }
          }
          setLoading(false)
          setError(null)
          return
        } catch (e) {
          lastErr = e
        }
      }
      setLoading(false)
      setMeshUsesCamAligned(false)
      setError(lastErr instanceof Error ? lastErr.message : String(lastErr))
    })()
  // Only tie G-code to STL reload when we read *.cam-aligned.stl (3-axis). Otherwise rotary would reload
  // and reset the camera on every generation without changing mesh source.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stlPath,
    is4Axis,
    mode,
    preferCamAlignedMesh,
    preferCamAlignedMesh ? (gcodeOut ?? '') : '',
    preferCamAlignedMesh ? gcodeGeneration : 0
  ])

  // ── Apply transform live ──────────────────────────────────────────────────────
  useEffect(() => {
    const s = stateRef.current
    if (!s?.mesh || meshUsesCamAligned) return
    applyTransform(s.mesh, transform)
  }, [meshUsesCamAligned, transform.position.x, transform.position.y, transform.position.z,
      transform.rotation.x, transform.rotation.y, transform.rotation.z,
      transform.scale.x, transform.scale.y, transform.scale.z])

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} className="viewer-wrap" role="region" aria-label="3D shop model viewer">
      <canvas ref={canvasRef} className="viewer-canvas" aria-label="3D model canvas" />

      {loading && (
        <div role="status" aria-label="Loading model" className="viewer-overlay">
          <span className="viewer-overlay__icon" aria-hidden="true">⟳</span>
          <span className="viewer-overlay__text">Loading model…</span>
        </div>
      )}
      {error && !loading && (
        <div role="alert" className="viewer-overlay viewer-overlay--error">
          <span className="viewer-overlay__icon" aria-hidden="true">⚠</span>
          <span className="viewer-overlay__text">{error}</span>
        </div>
      )}
      {modelSize && !loading && !error && (
        <div role="status" aria-label="Model dimensions" className="viewer-badge viewer-badge--bl">
          Model: {modelSize}
          {meshUsesCamAligned && (
            <span title="Mesh matches the CAM bake and G-code. Adjust placement and regenerate toolpaths to change orientation.">
              {' '}
              · G-code aligned
            </span>
          )}
        </div>
      )}
      {!loading && !error && (
        <div role="group" aria-label="Viewport color legend" className="viewer-badge viewer-badge--br">
          {is4Axis ? (
            <>
              <span><span className="legend-swatch--clamped">■</span> Clamped ({chuckDepthMm}mm)</span>
              {(clampOffsetMm ?? 0) > 0 && (
                <span><span className="legend-swatch--offset">■</span> Offset ({clampOffsetMm}mm)</span>
              )}
              <span><span className="legend-swatch--machinable">■</span> Machinable</span>
              {posts && posts.count > 0 && (
                <span><span className="legend-swatch--post">■</span> Post{posts.count > 1 ? `s ×${posts.count}` : ` Ø${posts.diameterMm}mm`}</span>
              )}
              <span><span className="legend-swatch--model">■</span> Model</span>
            </>
          ) : (
            <>
              <span><span className="legend-swatch--stock">■</span> Stock</span>
              <span><span className="legend-swatch--model">■</span> Model</span>
            </>
          )}
        </div>
      )}
      {is4Axis && !loading && !error && (
        <div role="status" aria-label="4th axis configuration" className="viewer-badge viewer-badge--tl">
          <span className="viewer-badge--tl__icon" aria-hidden="true">↻</span>
          <span>Makera Carvera · 4th Axis · Ø{stock.y}×{stock.x} mm &nbsp;|&nbsp; Chuck {chuckDepthMm}mm{(clampOffsetMm ?? 0) > 0 ? ` + ${clampOffsetMm}mm offset` : ''}{posts && posts.count > 0 ? ` · ${posts.count > 1 ? `${posts.count}×` : ''}Ø${posts.diameterMm}mm post` : ''}</span>
        </div>
      )}

      {/* Toolpath toggle button — top-right */}
      {gcodeOut && !loading && !error && (
        <div className="viewer-tp-group">
          <button
            type="button"
            onClick={() => setShowToolpath(v => !v)}
            aria-label={`Toggle toolpath visibility, currently ${showToolpath ? 'on' : 'off'}`}
            aria-pressed={showToolpath}
            className={`viewer-tp-btn ${showToolpath ? 'viewer-tp-btn--on' : 'viewer-tp-btn--off'}`}
          >
            <span aria-hidden="true">{toolpathLoading ? '⏳' : '🗺'}</span> Toolpath {showToolpath ? 'ON' : 'OFF'}
          </button>
          {showToolpath && toolpathStats && (
            <div role="group" aria-label="Toolpath statistics" className="viewer-tp-stats">
              <span><span className="legend-swatch--rapids">▬</span> Rapids: {toolpathStats.rapids.toLocaleString()}</span>
              <span><span className="legend-swatch--plunges">▬</span> Plunges: {toolpathStats.plunges.toLocaleString()}</span>
              <span><span className="legend-swatch--cuts">▬</span> Cuts: {toolpathStats.cuts.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ShopModelViewer
