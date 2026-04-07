import type { DesignFileV2 } from './design-schema'
import {
  arcSamplePositions,
  ellipseLoopWorld,
  ELLIPSE_PROFILE_SEGMENTS,
  polylinePositions,
  slotCapsuleLoopWorld,
  SLOT_PROFILE_CAP_SEGMENTS,
  splineCpPolylineFromEntity,
  splineFitPolylineFromEntity
} from './sketch-profile'

export type DerivedContourCandidate = {
  sourceId: string
  label: string
  points: [number, number][]
  signature: string
}

function circleToLoop(cx: number, cy: number, r: number, n = 32): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
  }
  return pts
}

export function contourPointSignature(points: ReadonlyArray<readonly [number, number]>): string {
  // Stable, small precision to detect meaningful profile edits.
  return points.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join('|')
}

export function listContourCandidatesFromDesign(design: DesignFileV2): DerivedContourCandidate[] {
  const out: DerivedContourCandidate[] = []
  for (const e of design.entities) {
    if (e.kind === 'polyline') {
      const pts = polylinePositions(e, design.points)
      if (!e.closed || pts.length < 3) continue
      out.push({ sourceId: e.id, label: `Polyline ${e.id}`, points: pts, signature: contourPointSignature(pts) })
      continue
    }
    if (e.kind === 'rect') {
      const hw = e.w / 2
      const hh = e.h / 2
      const cos = Math.cos(e.rotation)
      const sin = Math.sin(e.rotation)
      const points: [number, number][] = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh]
      ].map(([x, y]) => [e.cx + x * cos - y * sin, e.cy + x * sin + y * cos] as [number, number])
      out.push({ sourceId: e.id, label: `Rectangle ${e.id}`, points, signature: contourPointSignature(points) })
      continue
    }
    if (e.kind === 'circle') {
      const points = circleToLoop(e.cx, e.cy, e.r)
      out.push({ sourceId: e.id, label: `Circle ${e.id}`, points, signature: contourPointSignature(points) })
      continue
    }
    if (e.kind === 'slot') {
      const points = slotCapsuleLoopWorld(
        e.cx,
        e.cy,
        e.length,
        e.width,
        e.rotation,
        SLOT_PROFILE_CAP_SEGMENTS
      )
      if (points.length >= 3) {
        out.push({ sourceId: e.id, label: `Slot ${e.id}`, points, signature: contourPointSignature(points) })
      }
      continue
    }
    if (e.kind === 'arc' && e.closed) {
      const points = arcSamplePositions(e, design.points, 32)
      if (points.length >= 3) {
        out.push({ sourceId: e.id, label: `Closed arc ${e.id}`, points, signature: contourPointSignature(points) })
      }
      continue
    }
    if (e.kind === 'ellipse') {
      const points = ellipseLoopWorld(e.cx, e.cy, e.rx, e.ry, e.rotation, ELLIPSE_PROFILE_SEGMENTS)
      if (points.length >= 3) {
        out.push({ sourceId: e.id, label: `Ellipse ${e.id}`, points, signature: contourPointSignature(points) })
      }
      continue
    }
    if ((e.kind === 'spline_fit' || e.kind === 'spline_cp') && e.closed) {
      const points =
        e.kind === 'spline_fit' ? splineFitPolylineFromEntity(e, design.points) : splineCpPolylineFromEntity(e, design.points)
      if (points && points.length >= 3) {
        out.push({
          sourceId: e.id,
          label: `${e.kind} ${e.id}`,
          points,
          signature: contourPointSignature(points)
        })
      }
    }
  }
  return out
}

export function deriveContourPointsFromDesign(design: DesignFileV2, sourceId?: string): [number, number][] {
  const candidates = listContourCandidatesFromDesign(design)
  if (candidates.length === 0) return []
  if (sourceId) {
    const picked = candidates.find((c) => c.sourceId === sourceId)
    if (picked) return picked.points
  }
  return candidates[0]!.points
}

export function deriveDrillPointsFromDesign(design: DesignFileV2): [number, number][] {
  const out: [number, number][] = []
  for (const e of design.entities) {
    if (e.kind === 'circle') out.push([e.cx, e.cy])
  }
  return out
}

