import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DesignFileV2, SketchEntity } from '../../shared/design-schema'
import {
  arcSamplePositions,
  ellipseLoopWorld,
  ELLIPSE_PROFILE_SEGMENTS,
  KERNEL_PROFILE_ARC_SEGMENTS,
  polylinePositions,
  slotCapsuleLoopWorld,
  SLOT_PROFILE_CAP_SEGMENTS,
  splineCpPolylineFromEntity,
  splineFitPolylineFromEntity,
  worldCornersFromRectParams
} from '../../shared/sketch-profile'

export function shapesFromEntities(entities: SketchEntity[], pointsMap: Record<string, { x: number; y: number }>): THREE.Shape[] {
  const shapes: THREE.Shape[] = []
  for (const e of entities) {
    if (e.kind === 'polyline') {
      const pts = polylinePositions(e, pointsMap)
      if (!e.closed || pts.length < 3) continue
      const s = new THREE.Shape()
      const [x0, y0] = pts[0]!
      s.moveTo(x0, y0)
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!
        s.lineTo(p[0], p[1])
      }
      s.closePath()
      shapes.push(s)
    } else if (e.kind === 'rect') {
      const corners = worldCornersFromRectParams({
        cx: e.cx,
        cy: e.cy,
        w: e.w,
        h: e.h,
        rotation: e.rotation
      })
      const s = new THREE.Shape()
      s.moveTo(corners[0]![0], corners[0]![1])
      for (let i = 1; i < 4; i++) {
        s.lineTo(corners[i]![0], corners[i]![1])
      }
      s.closePath()
      shapes.push(s)
    } else if (e.kind === 'circle') {
      const s = new THREE.Shape()
      s.absarc(e.cx, e.cy, e.r, 0, Math.PI * 2, false)
      shapes.push(s)
    } else if (e.kind === 'slot') {
      const loop = slotCapsuleLoopWorld(
        e.cx,
        e.cy,
        e.length,
        e.width,
        e.rotation,
        SLOT_PROFILE_CAP_SEGMENTS
      )
      if (loop.length >= 3) {
        const s = new THREE.Shape()
        const p0 = loop[0]!
        s.moveTo(p0[0], p0[1])
        for (let i = 1; i < loop.length; i++) {
          const p = loop[i]!
          s.lineTo(p[0], p[1])
        }
        s.closePath()
        shapes.push(s)
      }
    } else if (e.kind === 'arc' && e.closed) {
      const apt = arcSamplePositions(e, pointsMap, KERNEL_PROFILE_ARC_SEGMENTS)
      if (apt.length >= 3) {
        const s = new THREE.Shape()
        const p0 = apt[0]!
        s.moveTo(p0[0], p0[1])
        for (let i = 1; i < apt.length; i++) {
          const p = apt[i]!
          s.lineTo(p[0], p[1])
        }
        s.closePath()
        shapes.push(s)
      }
    } else if (e.kind === 'ellipse') {
      const loop = ellipseLoopWorld(e.cx, e.cy, e.rx, e.ry, e.rotation, ELLIPSE_PROFILE_SEGMENTS)
      if (loop.length >= 3) {
        const s = new THREE.Shape()
        const p0 = loop[0]!
        s.moveTo(p0[0], p0[1])
        for (let i = 1; i < loop.length; i++) {
          const p = loop[i]!
          s.lineTo(p[0], p[1])
        }
        s.closePath()
        shapes.push(s)
      }
    } else if (e.kind === 'spline_fit' && e.closed) {
      const loop = splineFitPolylineFromEntity(e, pointsMap)
      if (loop && loop.length >= 3) {
        const s = new THREE.Shape()
        const p0 = loop[0]!
        s.moveTo(p0[0], p0[1])
        for (let i = 1; i < loop.length; i++) {
          const p = loop[i]!
          s.lineTo(p[0], p[1])
        }
        s.closePath()
        shapes.push(s)
      }
    } else if (e.kind === 'spline_cp' && e.closed) {
      const loop = splineCpPolylineFromEntity(e, pointsMap)
      if (loop && loop.length >= 3) {
        const s = new THREE.Shape()
        const p0 = loop[0]!
        s.moveTo(p0[0], p0[1])
        for (let i = 1; i < loop.length; i++) {
          const p = loop[i]!
          s.lineTo(p[0], p[1])
        }
        s.closePath()
        shapes.push(s)
      }
    }
  }
  return shapes
}

/** Evenly spaced samples on a closed `Shape` (parameter-space; avoids `getPoints` using resolution 1 per line segment). */
function sampleClosedShape(shape: THREE.Shape, n: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = []
  for (let i = 0; i < n; i++) {
    out.push(shape.getPoint(i / n))
  }
  return out
}

function signedArea2D(pts: THREE.Vector2[]): number {
  if (pts.length < 3) return 0
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return 0.5 * a
}

export function buildExtrudedGeometry(design: DesignFileV2): THREE.BufferGeometry | null {
  if (design.solidKind === 'revolve') {
    return buildRevolvedGeometry(design)
  }
  if (design.solidKind === 'loft') {
    return buildLoftedGeometry(design)
  }
  const shapes = shapesFromEntities(design.entities, design.points)
  if (shapes.length === 0) return null
  const opts: THREE.ExtrudeGeometryOptions = {
    depth: design.extrudeDepthMm,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 32
  }
  const geos = shapes.map((s) => new THREE.ExtrudeGeometry(s, opts))
  if (geos.length === 1) {
    const g = geos[0]!
    g.computeVertexNormals()
    return g
  }
  const merged = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())
  merged?.computeVertexNormals()
  return merged
}

/** One ruled loft strip between two closed 2D rings at `zBottom` / `zTop` (+Z up). */
function ruledLoftStrip(
  bottom: THREE.Vector2[],
  top: THREE.Vector2[],
  zBottom: number,
  zTop: number
): THREE.BufferGeometry | null {
  const n = bottom.length
  if (n < 3 || top.length !== n) return null
  const verts: number[] = []
  const idx: number[] = []
  for (const p of bottom) {
    verts.push(p.x, p.y, zBottom)
  }
  for (const p of top) {
    verts.push(p.x, p.y, zTop)
  }
  const fan = (base: number, rev: boolean) => {
    for (let i = 1; i < n - 1; i++) {
      const a = base
      const b = base + (rev ? i + 1 : i)
      const c = base + (rev ? i : i + 1)
      idx.push(a, b, c)
    }
  }
  fan(0, false)
  fan(n, true)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const bi = i
    const bj = j
    const ti = n + i
    const tj = n + j
    idx.push(bi, bj, tj, bi, tj, ti)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** Ruled mesh: consecutive closed profiles, uniform `loftSeparationMm` between each (entity order). */
export function buildLoftedGeometry(design: DesignFileV2): THREE.BufferGeometry | null {
  const shapes = shapesFromEntities(design.entities, design.points)
  if (shapes.length < 2) return null
  const h = design.loftSeparationMm
  const n = 48
  const parts: THREE.BufferGeometry[] = []
  for (let s = 0; s < shapes.length - 1; s++) {
    let bottom = sampleClosedShape(shapes[s]!, n)
    let top = sampleClosedShape(shapes[s + 1]!, n)
    if (bottom.length < 3 || top.length < 3) return null
    if (signedArea2D(bottom) * signedArea2D(top) < 0) {
      top.reverse()
    }
    const z0 = s * h
    const z1 = (s + 1) * h
    const g = ruledLoftStrip(bottom, top, z0, z1)
    if (!g) return null
    parts.push(g)
  }
  if (parts.length === 1) {
    return parts[0]!
  }
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  if (!merged) return null
  merged.computeVertexNormals()
  return merged
}

/**
 * Single profile revolve: uses first closed polyline or rect projected in X–Y; axis is vertical line x = axisX.
 * Profile points must lie on one side of the axis (x > axisX recommended).
 */
export function buildRevolvedGeometry(design: DesignFileV2): THREE.BufferGeometry | null {
  const shapes = shapesFromEntities(design.entities, design.points)
  if (shapes.length === 0) return null
  const shape = shapes[0]!
  const axisX = design.revolve.axisX
  const segs = Math.max(8, Math.min(128, Math.ceil((design.revolve.angleDeg / 360) * 64)))
  const pts = shape.getPoints(64)
  const vec: THREE.Vector2[] = []
  for (const p of pts) {
    const x = p.x - axisX
    if (x <= 0.01) continue
    vec.push(new THREE.Vector2(x, p.y))
  }
  if (vec.length < 3) return null
  const angle = (design.revolve.angleDeg * Math.PI) / 180
  const geo = new THREE.LatheGeometry(vec, segs, 0, angle)
  geo.computeVertexNormals()
  const m = new THREE.Matrix4().makeTranslation(axisX, 0, 0)
  geo.applyMatrix4(m)
  return geo
}
