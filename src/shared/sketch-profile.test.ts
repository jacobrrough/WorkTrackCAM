import { describe, expect, it } from 'vitest'
import { emptyDesign } from './design-schema'
import {
  applySketchCornerChamfer,
  applySketchCornerFillet,
  arcViaForCenterStartEnd,
  attachKernelPostOpsToPayload,
  buildKernelBuildPayload,
  extendSketchEdge,
  circleFromDiameterEndpoints,
  circleThroughThreePoints,
  breakSketchEdge,
  closedArcProfileLoop,
  constraintPickPointIdEdges,
  extractKernelProfiles,
  intersectLines2d,
  kernelPayloadVersionForOps,
  pickNearestCircularEntityId,
  rectFromThreePoints,
  regularPolygonVertices,
  slotCapsuleLoopWorld,
  slotParamsFromCapCenters,
  slotParamsFromOverallTips,
  sampleArcThroughThreePoints,
  sampleCenterStartEndArc,
  splitSketchEdge,
  trimSketchEdge,
  trimSketchPolylineEdge,
  pickNearestSketchEdge,
  worldCornersFromRectParams
} from './sketch-profile'

describe('sketch-profile / kernel payload', () => {
  it('extracts rect profile', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }]
    const p = extractKernelProfiles(d)
    expect(p).not.toBeNull()
    const first = p![0]!
    expect(first.type).toBe('loop')
    if (first.type === 'loop') {
      expect(first.points.length).toBe(4)
    }
  })

  it('extractKernelProfiles returns null when only orphan sketch points exist', () => {
    const d = emptyDesign()
    d.points = { orphan: { x: 1, y: 2 } }
    expect(extractKernelProfiles(d)).toBeNull()
  })

  it('regularPolygonVertices places corners on the circumcircle', () => {
    const pts = regularPolygonVertices(0, 0, 10, 0, 6)
    expect(pts).toHaveLength(6)
    for (const [x, y] of pts) {
      expect(Math.hypot(x, y)).toBeCloseTo(10, 5)
    }
  })

  it('slotCapsuleLoopWorld has positive signed area (CCW)', () => {
    const loop = slotCapsuleLoopWorld(0, 0, 20, 8, 0, 12)
    expect(loop.length).toBeGreaterThanOrEqual(8)
    let a = 0
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i]!
      const q = loop[(i + 1) % loop.length]!
      a += p[0] * q[1] - q[0] * p[1]
    }
    expect(a).toBeGreaterThan(1)
  })

  it('extractKernelProfiles includes slot as tessellated loop', () => {
    const d = emptyDesign()
    d.entities = [{ id: 's1', kind: 'slot', cx: 0, cy: 0, length: 15, width: 6, rotation: 0 }]
    const p = extractKernelProfiles(d)
    expect(p).not.toBeNull()
    expect(p![0]!.type).toBe('loop')
    if (p![0]!.type === 'loop') expect(p![0]!.points.length).toBeGreaterThanOrEqual(8)
  })

  it('extractKernelProfiles includes ellipse as tessellated loop', () => {
    const d = emptyDesign()
    d.entities = [{ id: 'el1', kind: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 5, rotation: 0 }]
    const p = extractKernelProfiles(d)
    expect(p).not.toBeNull()
    expect(p![0]!.type).toBe('loop')
    if (p![0]!.type === 'loop') expect(p![0]!.points.length).toBeGreaterThanOrEqual(8)
  })

  it('slotParamsFromCapCenters matches axis midpoint and length', () => {
    const p = slotParamsFromCapCenters(-5, 0, 5, 0, 4)
    expect(p).not.toBeNull()
    expect(p!.cx).toBeCloseTo(0)
    expect(p!.cy).toBeCloseTo(0)
    expect(p!.length).toBeCloseTo(10)
    expect(p!.width).toBe(4)
    expect(p!.rotation).toBeCloseTo(0)
  })

  it('slotParamsFromOverallTips derives center-to-center length as overall − width', () => {
    const p = slotParamsFromOverallTips(-10, 0, 10, 0, 4)
    expect(p).not.toBeNull()
    expect(p!.length).toBeCloseTo(16)
    expect(p!.width).toBe(4)
    expect(p!.cx).toBeCloseTo(0)
    expect(p!.rotation).toBeCloseTo(0)
  })

  it('slotParamsFromOverallTips rejects width larger than overall', () => {
    expect(slotParamsFromOverallTips(0, 0, 5, 0, 6)).toBeNull()
  })

  it('buildKernelBuildPayload fails without closed profile', () => {
    const d = emptyDesign()
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(false)
  })

  it('buildKernelBuildPayload rejects non-finite extrude depth', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    d.solidKind = 'extrude'
    d.extrudeDepthMm = Number.POSITIVE_INFINITY as unknown as typeof d.extrudeDepthMm
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_extrude_depth_mm')
  })

  it('buildKernelBuildPayload extrude ok', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    d.solidKind = 'extrude'
    d.extrudeDepthMm = 5
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.version).toBe(1)
      expect(r.payload.solidKind).toBe('extrude')
      expect(r.payload.extrudeDepthMm).toBe(5)
      expect(r.payload.sketchPlane).toEqual({ kind: 'datum', datum: 'XY' })
    }
  })

  it('buildKernelBuildPayload includes sketchPlane for kernel placement', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    d.solidKind = 'extrude'
    d.sketchPlane = { kind: 'datum', datum: 'YZ' }
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.sketchPlane).toEqual({ kind: 'datum', datum: 'YZ' })
  })

  it('attachKernelPostOpsToPayload bumps version and adds ops', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const merged = attachKernelPostOpsToPayload(r.payload, [{ kind: 'fillet_all', radiusMm: 0.5 }])
    expect(merged.version).toBe(2)
    expect(merged.postSolidOps).toEqual([{ kind: 'fillet_all', radiusMm: 0.5 }])
  })

  it('attachKernelPostOpsToPayload skips suppressed ops and strips suppressed key', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const merged = attachKernelPostOpsToPayload(r.payload, [
      { kind: 'fillet_all', radiusMm: 0.5, suppressed: true },
      { kind: 'chamfer_all', lengthMm: 0.2 }
    ])
    expect(merged.postSolidOps).toEqual([{ kind: 'chamfer_all', lengthMm: 0.2 }])
  })

  it('attachKernelPostOpsToPayload leaves base payload when all ops suppressed', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const merged = attachKernelPostOpsToPayload(r.payload, [
      { kind: 'fillet_all', radiusMm: 0.5, suppressed: true }
    ])
    expect(merged.version).toBe(1)
    expect(merged.postSolidOps).toBeUndefined()
  })

  it('kernelPayloadVersionForOps uses v3 for pattern / boolean / sheet tab / shell openDirection', () => {
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'pattern_rectangular', countX: 2, countY: 1, spacingXMm: 30, spacingYMm: 0 }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        { kind: 'pattern_circular', count: 4, centerXMm: 0, centerYMm: 0, totalAngleDeg: 360, startAngleDeg: 0 }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'boolean_subtract_cylinder',
          centerXMm: 0,
          centerYMm: 0,
          radiusMm: 2,
          zMinMm: 1,
          zMaxMm: 8
        }
      ])
    ).toBe(3)
    expect(kernelPayloadVersionForOps(1, [{ kind: 'shell_inward', thicknessMm: 1, openDirection: '-Z' }])).toBe(3)
    expect(kernelPayloadVersionForOps(1, [{ kind: 'shell_inward', thicknessMm: 1, openDirection: '+X' }])).toBe(3)
    expect(kernelPayloadVersionForOps(1, [{ kind: 'shell_inward', thicknessMm: 1 }])).toBe(2)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'boolean_union_box',
          xMinMm: -2,
          xMaxMm: 2,
          yMinMm: -2,
          yMaxMm: 2,
          zMinMm: 5,
          zMaxMm: 8
        }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'boolean_subtract_box',
          xMinMm: -2,
          xMaxMm: 2,
          yMinMm: -2,
          yMaxMm: 2,
          zMinMm: 2,
          zMaxMm: 8
        }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'sheet_tab_union',
          centerXMm: 0,
          centerYMm: 0,
          zBaseMm: 2,
          lengthMm: 8,
          widthMm: 4,
          heightMm: 3
        }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'pattern_linear_3d', count: 3, dxMm: 1, dyMm: 0, dzMm: 0 }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'pattern_path', count: 4, pathPoints: [[0, 0], [5, 0], [5, 5]] }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'boolean_intersect_box',
          xMinMm: -1,
          xMaxMm: 1,
          yMinMm: -1,
          yMaxMm: 1,
          zMinMm: 0,
          zMaxMm: 2
        }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'mirror_union_plane', plane: 'YZ', originXMm: 0, originYMm: 0, originZMm: 0 }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        { kind: 'boolean_combine_profile', mode: 'subtract', profileIndex: 0, extrudeDepthMm: 8, zStartMm: 0 }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'split_keep_halfspace', axis: 'Z', offsetMm: 0, keep: 'positive' }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'hole_from_profile', profileIndex: 0, mode: 'through_all', zStartMm: 0 }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'thread_cosmetic',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.5,
          lengthMm: 8,
          depthMm: 0.4,
          zStartMm: 0
        }
      ])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'transform_translate', dxMm: 10, dyMm: 0, dzMm: 0, keepOriginal: false }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'press_pull_profile', profileIndex: 0, deltaMm: 2, zStartMm: 0 }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [{ kind: 'sweep_profile_path', profileIndex: 0, pathPoints: [[0, 0], [1, 0]], zStartMm: 0 }])
    ).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'pipe_path',
          pathPoints: [
            [0, 0],
            [1, 0]
          ],
          outerRadiusMm: 2,
          zStartMm: 0,
          orientationMode: 'frenet'
        }
      ])
    ).toBe(3)
    expect(kernelPayloadVersionForOps(1, [{ kind: 'thicken_scale', deltaMm: 1 }])).toBe(3)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'thread_wizard',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.25,
          lengthMm: 12,
          depthMm: 0.6,
          zStartMm: 0,
          mode: 'modeled',
          hand: 'right',
          standard: 'ISO',
          designation: 'M8x1.25',
          class: '6g',
          starts: 1
        }
      ])
    ).toBe(4)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'sweep_profile_path_true',
          profileIndex: 0,
          pathPoints: [[0, 0], [10, 0]],
          zStartMm: 0,
          orientationMode: 'frenet'
        }
      ])
    ).toBe(4)
    expect(kernelPayloadVersionForOps(1, [{ kind: 'thicken_offset', distanceMm: 1, side: 'both' }])).toBe(4)
    expect(
      kernelPayloadVersionForOps(1, [
        {
          kind: 'coil_cut',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 4,
          pitchMm: 1.5,
          turns: 4,
          depthMm: 0.4,
          zStartMm: 0
        }
      ])
    ).toBe(3)
  })

  it('circleThroughThreePoints for a right triangle arc', () => {
    const c = circleThroughThreePoints(1, 0, 0, 1, -1, 0)
    expect(c).not.toBeNull()
    if (!c) return
    expect(c.ox).toBeCloseTo(0, 5)
    expect(c.oy).toBeCloseTo(0, 5)
    expect(c.r).toBeCloseTo(1, 5)
  })

  it('circleFromDiameterEndpoints uses midpoint and half chord length', () => {
    const o = circleFromDiameterEndpoints(0, 0, 8, 6)
    expect(o).not.toBeNull()
    if (!o) return
    expect(o.cx).toBeCloseTo(4, 6)
    expect(o.cy).toBeCloseTo(3, 6)
    expect(o.r).toBeCloseTo(5, 6)
  })

  it('circleFromDiameterEndpoints returns null for coincident diameter points', () => {
    expect(circleFromDiameterEndpoints(1, -2, 1, -2)).toBeNull()
  })

  it('rectFromThreePoints builds axis-aligned rect from edge + third point', () => {
    const r = rectFromThreePoints(0, 0, 10, 0, 3, 5)
    expect(r).not.toBeNull()
    if (!r) return
    expect(r.cx).toBeCloseTo(5, 5)
    expect(r.cy).toBeCloseTo(2.5, 5)
    expect(r.w).toBeCloseTo(10, 5)
    expect(r.h).toBeCloseTo(5, 5)
    expect(r.rotation).toBeCloseTo(0, 5)
  })

  it('rectFromThreePoints returns null when third point is on line AB', () => {
    expect(rectFromThreePoints(0, 0, 10, 0, 4, 0)).toBeNull()
  })

  it('worldCornersFromRectParams matches corners for centered axis rect', () => {
    const corners = worldCornersFromRectParams({ cx: 5, cy: 2.5, w: 10, h: 5, rotation: 0 })
    expect(corners[0]![0]).toBeCloseTo(0, 5)
    expect(corners[0]![1]).toBeCloseTo(0, 5)
    expect(corners[2]![0]).toBeCloseTo(10, 5)
    expect(corners[2]![1]).toBeCloseTo(5, 5)
  })

  it('circleThroughThreePoints circumcircle for three rim points on unit circle', () => {
    const c = circleThroughThreePoints(1, 0, -1, 0, 0, 1)
    expect(c).not.toBeNull()
    if (!c) return
    expect(c.ox).toBeCloseTo(0, 5)
    expect(c.oy).toBeCloseTo(0, 5)
    expect(c.r).toBeCloseTo(1, 5)
  })

  it('circleThroughThreePoints returns null for collinear picks', () => {
    expect(circleThroughThreePoints(0, 0, 1, 0, 2, 0)).toBeNull()
  })

  it('sampleArcThroughThreePoints returns quarter-circle samples', () => {
    const s = Math.SQRT1_2
    const pts = sampleArcThroughThreePoints(1, 0, s, s, 0, 1, 16)
    expect(pts).not.toBeNull()
    if (!pts) return
    expect(pts.length).toBeGreaterThan(8)
    const [fx, fy] = pts[0]!
    const [lx, ly] = pts[pts.length - 1]!
    expect(fx).toBeCloseTo(1, 3)
    expect(fy).toBeCloseTo(0, 3)
    expect(lx).toBeCloseTo(0, 3)
    expect(ly).toBeCloseTo(1, 3)
  })

  it('arcViaForCenterStartEnd yields a point on the minor arc (quarter turn)', () => {
    const via = arcViaForCenterStartEnd(0, 0, 10, 0, 0, 12)
    expect(via).not.toBeNull()
    if (!via) return
    expect(Math.hypot(via[0], via[1])).toBeCloseTo(10, 5)
    const circ = circleThroughThreePoints(10, 0, via[0], via[1], 0, 10)
    expect(circ).not.toBeNull()
    if (!circ) return
    expect(circ.ox).toBeCloseTo(0, 4)
    expect(circ.oy).toBeCloseTo(0, 4)
    expect(circ.r).toBeCloseTo(10, 4)
  })

  it('sampleCenterStartEndArc matches three-point arc through computed via', () => {
    const cx = 2
    const cy = -1
    const sx = 5
    const sy = -1
    const ex = 4
    const ey = 2
    const via = arcViaForCenterStartEnd(cx, cy, sx, sy, ex, ey)
    expect(via).not.toBeNull()
    const alt = sampleCenterStartEndArc(cx, cy, sx, sy, ex, ey, 24)
    expect(alt).not.toBeNull()
    if (!via || !alt) return
    const r = Math.hypot(sx - cx, sy - cy)
    const vlen = Math.hypot(ex - cx, ey - cy)
    const px = cx + ((ex - cx) / vlen) * r
    const py = cy + ((ey - cy) / vlen) * r
    const ref = sampleArcThroughThreePoints(sx, sy, via[0], via[1], px, py, 24)
    expect(ref).not.toBeNull()
    if (!ref) return
    expect(alt!.length).toBe(ref.length)
    for (let i = 0; i < alt!.length; i++) {
      expect(alt![i]![0]).toBeCloseTo(ref[i]![0], 5)
      expect(alt![i]![1]).toBeCloseTo(ref[i]![1], 5)
    }
  })

  it('extractKernelProfiles includes closed arc as tessellated loop', () => {
    const d = emptyDesign()
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    d.points = {
      [s]: { x: 1, y: 0 },
      [v]: { x: 0.7, y: 0.7 },
      [e]: { x: 0, y: 1 }
    }
    d.entities = [{ id: 'a1', kind: 'arc', startId: s, viaId: v, endId: e, closed: true }]
    const p = extractKernelProfiles(d)
    expect(p).not.toBeNull()
    const loop = p!.find((x) => x.type === 'loop')
    expect(loop && loop.type === 'loop' && loop.points.length).toBeGreaterThanOrEqual(3)
    const arcEnt = d.entities[0]
    expect(arcEnt?.kind).toBe('arc')
    if (arcEnt?.kind !== 'arc') return
    const cl = closedArcProfileLoop(arcEnt, d.points)
    expect(cl).not.toBeNull()
    expect(cl!.length).toBe(loop && loop.type === 'loop' ? loop.points.length : 0)
  })

  it('intersectLines2d finds crossing of axis segments', () => {
    const h = intersectLines2d(0, 0, 10, 0, 5, -5, 5, 5)
    expect(h).not.toBeNull()
    expect(h!.x).toBeCloseTo(5, 5)
    expect(h!.y).toBeCloseTo(0, 5)
    expect(h!.tab).toBeCloseTo(0.5, 5)
  })

  it('applySketchCornerFillet replaces corner with arc chain on closed polyline', () => {
    const p0 = crypto.randomUUID()
    const p1 = crypto.randomUUID()
    const p2 = crypto.randomUUID()
    const p3 = crypto.randomUUID()
    const polyId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [p0]: { x: 0, y: 0 },
      [p1]: { x: 10, y: 0 },
      [p2]: { x: 10, y: 10 },
      [p3]: { x: 0, y: 10 }
    }
    d.entities = [{ id: polyId, kind: 'polyline', pointIds: [p0, p1, p2, p3], closed: true }]
    const res = applySketchCornerFillet(
      d,
      { entityId: polyId, edgeIndex: 0 },
      { entityId: polyId, edgeIndex: 1 },
      1,
      { arcSegments: 4 }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const poly = res.design.entities.find((e) => e.id === polyId)
    expect(poly?.kind).toBe('polyline')
    if (poly?.kind !== 'polyline' || !('pointIds' in poly)) return
    expect(poly.pointIds.length).toBe(4 - 1 + 5)
    expect(res.design.points[p1]).toBeUndefined()
    expect(extractKernelProfiles(res.design)).not.toBeNull()
  })

  it('applySketchCornerFillet supports arc-arc when arcs share an endpoint', () => {
    const s = crypto.randomUUID()
    const av = crypto.randomUUID()
    const ae = crypto.randomUUID()
    const bv = crypto.randomUUID()
    const be = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s]: { x: 10, y: 0 },
      [av]: { x: 7, y: 7 },
      [ae]: { x: 0, y: 10 },
      [bv]: { x: 13, y: -7 },
      [be]: { x: 20, y: -10 }
    }
    d.entities = [
      { id: 'a1', kind: 'arc', startId: s, viaId: av, endId: ae },
      { id: 'a2', kind: 'arc', startId: s, viaId: bv, endId: be }
    ]
    const res = applySketchCornerFillet(d, { entityId: 'a1', edgeIndex: 0 }, { entityId: 'a2', edgeIndex: 0 }, 1)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.design.points[s]).toBeUndefined()
    expect(res.design.entities.filter((e) => e.kind === 'arc').length).toBe(3)
  })

  it('applySketchCornerFillet supports arc-arc with near-coincident endpoints', () => {
    const s1 = crypto.randomUUID()
    const s2 = crypto.randomUUID()
    const av = crypto.randomUUID()
    const ae = crypto.randomUUID()
    const bv = crypto.randomUUID()
    const be = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s1]: { x: 10, y: 0 },
      [s2]: { x: 10.0005, y: 0.0003 },
      [av]: { x: 7, y: 7 },
      [ae]: { x: 0, y: 10 },
      [bv]: { x: 13, y: -7 },
      [be]: { x: 20, y: -10 }
    }
    d.entities = [
      { id: 'a1', kind: 'arc', startId: s1, viaId: av, endId: ae },
      { id: 'a2', kind: 'arc', startId: s2, viaId: bv, endId: be }
    ]
    const res = applySketchCornerFillet(d, { entityId: 'a1', edgeIndex: 0 }, { entityId: 'a2', edgeIndex: 0 }, 1)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.design.entities.filter((e) => e.kind === 'arc').length).toBe(3)
  })

  it('applySketchCornerChamfer replaces corner with one chamfer segment on closed polyline', () => {
    const p0 = crypto.randomUUID()
    const p1 = crypto.randomUUID()
    const p2 = crypto.randomUUID()
    const p3 = crypto.randomUUID()
    const polyId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [p0]: { x: 0, y: 0 },
      [p1]: { x: 10, y: 0 },
      [p2]: { x: 10, y: 10 },
      [p3]: { x: 0, y: 10 }
    }
    d.entities = [{ id: polyId, kind: 'polyline', pointIds: [p0, p1, p2, p3], closed: true }]
    const res = applySketchCornerChamfer(
      d,
      { entityId: polyId, edgeIndex: 0 },
      { entityId: polyId, edgeIndex: 1 },
      1
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const poly = res.design.entities.find((e) => e.id === polyId)
    expect(poly?.kind).toBe('polyline')
    if (poly?.kind !== 'polyline' || !('pointIds' in poly)) return
    expect(poly.pointIds.length).toBe(5)
    expect(res.design.points[p1]).toBeUndefined()
    expect(extractKernelProfiles(res.design)).not.toBeNull()
  })

  it('trimSketchPolylineEdge shortens target at line intersection', () => {
    const id0 = crypto.randomUUID()
    const id1 = crypto.randomUUID()
    const id2 = crypto.randomUUID()
    const id3 = crypto.randomUUID()
    const polyH = crypto.randomUUID()
    const polyV = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [id0]: { x: 0, y: 0 },
      [id1]: { x: 20, y: 0 },
      [id2]: { x: 10, y: -10 },
      [id3]: { x: 10, y: 10 }
    }
    d.entities = [
      { id: polyH, kind: 'polyline', pointIds: [id0, id1], closed: false },
      { id: polyV, kind: 'polyline', pointIds: [id2, id3], closed: false }
    ]
    const cutter = { entityId: polyV, edgeIndex: 0 }
    const target = { entityId: polyH, edgeIndex: 0 }
    const res = trimSketchPolylineEdge(d, cutter, target, [2, 0])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const poly = res.design.entities.find((e) => e.id === polyH)
    expect(poly?.kind).toBe('polyline')
    if (poly?.kind !== 'polyline' || !('pointIds' in poly)) return
    expect(poly.pointIds.length).toBe(2)
    const p0 = res.design.points[poly.pointIds[0]!]!
    const p1 = res.design.points[poly.pointIds[1]!]!
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(10, 0)
  })

  it('extractKernelProfiles keeps closed spline loops with robust point count', () => {
    const p0 = crypto.randomUUID()
    const p1 = crypto.randomUUID()
    const p2 = crypto.randomUUID()
    const p3 = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [p0]: { x: 0, y: 0 },
      [p1]: { x: 8, y: 8 },
      [p2]: { x: 16, y: 0 },
      [p3]: { x: 8, y: -8 }
    }
    d.entities = [{ id: 's1', kind: 'spline_fit', pointIds: [p0, p1, p2, p3], closed: true }]
    const prof = extractKernelProfiles(d)
    expect(prof).not.toBeNull()
    const loop = prof![0]
    expect(loop?.type).toBe('loop')
    if (loop?.type !== 'loop') return
    expect(loop.points.length).toBeGreaterThanOrEqual(12)
  })

  it('buildKernelBuildPayload loft requires two profiles', () => {
    const d = emptyDesign()
    d.entities = [{ id: '1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }]
    d.solidKind = 'loft'
    d.loftSeparationMm = 12
    expect(buildKernelBuildPayload(d).ok).toBe(false)
    d.entities.push({ id: '2', kind: 'rect', cx: 0, cy: 0, w: 6, h: 6, rotation: 0 })
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.solidKind).toBe('loft')
      expect(r.payload.loftSeparationMm).toBe(12)
      expect(r.payload.profiles).toHaveLength(2)
    }
  })

  it('buildKernelBuildPayload loft sends all profiles up to cap', () => {
    const d = emptyDesign()
    d.solidKind = 'loft'
    d.loftSeparationMm = 5
    d.entities = [
      { id: 'a', kind: 'rect', cx: 0, cy: 0, w: 20, h: 12, rotation: 0 },
      { id: 'b', kind: 'rect', cx: 0, cy: 0, w: 14, h: 8, rotation: 0 },
      { id: 'c', kind: 'rect', cx: 0, cy: 0, w: 8, h: 5, rotation: 0 }
    ]
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.profiles).toHaveLength(3)
    }
  })

  it('buildKernelBuildPayload loft rejects more than 16 profiles', () => {
    const d = emptyDesign()
    d.solidKind = 'loft'
    d.entities = Array.from({ length: 17 }, (_, i) => ({
      id: `r${i}`,
      kind: 'rect' as const,
      cx: 0,
      cy: 0,
      w: 10,
      h: 10,
      rotation: 0
    }))
    const r = buildKernelBuildPayload(d)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('loft_too_many_profiles')
  })

  it('trimSketchEdge trims polyline with arc (circle) cutter', () => {
    const p0 = crypto.randomUUID()
    const p1 = crypto.randomUUID()
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const polyId = crypto.randomUUID()
    const arcId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [p0]: { x: 0, y: 8 },
      [p1]: { x: 15, y: 8 },
      [s]: { x: 10, y: 0 },
      [v]: { x: 6, y: 8 },
      [e]: { x: 0, y: 10 }
    }
    d.entities = [
      { id: polyId, kind: 'polyline', pointIds: [p0, p1], closed: false },
      { id: arcId, kind: 'arc', startId: s, viaId: v, endId: e }
    ]
    const res = trimSketchEdge(d, { entityId: arcId, edgeIndex: 0 }, { entityId: polyId, edgeIndex: 0 }, [2, 8])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const poly = res.design.entities.find((x) => x.id === polyId)
    expect(poly?.kind).toBe('polyline')
    if (poly?.kind !== 'polyline' || !('pointIds' in poly)) return
    expect(poly.pointIds.length).toBe(2)
    const a = res.design.points[poly.pointIds[0]!]!
    const b = res.design.points[poly.pointIds[1]!]!
    expect(Math.abs(a.y - 8)).toBeLessThan(0.1)
    expect(Math.abs(b.y - 8)).toBeLessThan(0.1)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    expect(len).toBeCloseTo(9, 0)
  })

  it('trimSketchEdge trims arc target with polyline cutter', () => {
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const pa = crypto.randomUUID()
    const pb = crypto.randomUUID()
    const arcId = crypto.randomUUID()
    const lineId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s]: { x: 10, y: 0 },
      [v]: { x: 6, y: 8 },
      [e]: { x: 0, y: 10 },
      [pa]: { x: 5, y: -20 },
      [pb]: { x: 5, y: 20 }
    }
    d.entities = [
      { id: arcId, kind: 'arc', startId: s, viaId: v, endId: e },
      { id: lineId, kind: 'polyline', pointIds: [pa, pb], closed: false }
    ]
    const res = trimSketchEdge(d, { entityId: lineId, edgeIndex: 0 }, { entityId: arcId, edgeIndex: 0 }, [5, 2])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const ar = res.design.entities.find((x) => x.id === arcId)
    expect(ar?.kind).toBe('arc')
    if (ar?.kind !== 'arc') return
    const pS = res.design.points[ar.startId]!
    const pE = res.design.points[ar.endId]!
    expect(Math.hypot(pS.x - 5, pS.y - Math.sqrt(75))).toBeLessThan(0.15)
    expect(Math.hypot(pE.x - 0, pE.y - 10)).toBeLessThan(0.15)
  })

  it('trimSketchEdge trims ellipse target with polyline cutter to open polyline', () => {
    const lineId = crypto.randomUUID()
    const ellId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      pa: { x: 0, y: 0 },
      pb: { x: 1, y: 0 }
    }
    d.entities = [
      { id: lineId, kind: 'polyline', pointIds: ['pa', 'pb'], closed: false },
      { id: ellId, kind: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 10, rotation: 0 }
    ]
    const res = trimSketchEdge(d, { entityId: lineId, edgeIndex: 0 }, { entityId: ellId, edgeIndex: 0 }, [-15, 0])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const pl = res.design.entities.find((e) => e.id === ellId)
    expect(pl?.kind).toBe('polyline')
    if (pl?.kind !== 'polyline' || !('pointIds' in pl)) return
    expect(pl.pointIds.length).toBeGreaterThan(4)
    expect(pl.closed).toBe(false)
  })

  it('pickNearestSketchEdge prefers closer arc over farther polyline', () => {
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const p0 = crypto.randomUUID()
    const p1 = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s]: { x: 10, y: 0 },
      [v]: { x: 6, y: 8 },
      [e]: { x: 0, y: 10 },
      [p0]: { x: 0, y: 0 },
      [p1]: { x: 100, y: 0 }
    }
    d.entities = [
      { id: 'arc1', kind: 'arc', startId: s, viaId: v, endId: e },
      { id: 'pl1', kind: 'polyline', pointIds: [p0, p1], closed: false }
    ]
    const hit = pickNearestSketchEdge(d, 6, 8, 4)
    expect(hit).not.toBeNull()
    expect(hit!.entityId).toBe('arc1')
  })

  it('pickNearestSketchEdge hits ellipse boundary', () => {
    const d = emptyDesign()
    d.entities = [{ id: 'e1', kind: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 5, rotation: 0 }]
    const hit = pickNearestSketchEdge(d, 10, 0, 2)
    expect(hit).not.toBeNull()
    expect(hit!.entityId).toBe('e1')
  })

  it('splitSketchEdge inserts a point on polyline edge', () => {
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const polyId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [a]: { x: 0, y: 0 },
      [b]: { x: 10, y: 0 }
    }
    d.entities = [{ id: polyId, kind: 'polyline', pointIds: [a, b], closed: false }]
    const res = splitSketchEdge(d, { entityId: polyId, edgeIndex: 0 }, [4, 1])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const pl = res.design.entities.find((e) => e.id === polyId)
    expect(pl?.kind).toBe('polyline')
    if (!pl || pl.kind !== 'polyline' || !('pointIds' in pl)) return
    expect(pl.pointIds.length).toBe(3)
  })

  it('splitSketchEdge splits arc into two arc entities', () => {
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const arcId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s]: { x: 10, y: 0 },
      [v]: { x: 7, y: 7 },
      [e]: { x: 0, y: 10 }
    }
    d.entities = [{ id: arcId, kind: 'arc', startId: s, viaId: v, endId: e }]
    const res = splitSketchEdge(d, { entityId: arcId, edgeIndex: 0 }, [7.1, 7.1])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const arcs = res.design.entities.filter((x) => x.kind === 'arc')
    expect(arcs.length).toBe(2)
  })

  it('breakSketchEdge breaks open polyline into two entities', () => {
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const c = crypto.randomUUID()
    const polyId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [a]: { x: 0, y: 0 },
      [b]: { x: 10, y: 0 },
      [c]: { x: 20, y: 0 }
    }
    d.entities = [{ id: polyId, kind: 'polyline', pointIds: [a, b, c], closed: false }]
    const res = breakSketchEdge(d, { entityId: polyId, edgeIndex: 1 }, [15, 1])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const polys = res.design.entities.filter((e) => e.kind === 'polyline')
    expect(polys.length).toBe(2)
  })

  it('breakSketchEdge breaks arc into two arc entities', () => {
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const arcId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s]: { x: 10, y: 0 },
      [v]: { x: 7, y: 7 },
      [e]: { x: 0, y: 10 }
    }
    d.entities = [{ id: arcId, kind: 'arc', startId: s, viaId: v, endId: e }]
    const res = breakSketchEdge(d, { entityId: arcId, edgeIndex: 0 }, [7.1, 7.1])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const arcs = res.design.entities.filter((x) => x.kind === 'arc')
    expect(arcs.length).toBe(2)
  })

  it('extendSketchEdge extends polyline to line cutter', () => {
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const c0 = crypto.randomUUID()
    const c1 = crypto.randomUUID()
    const targetId = crypto.randomUUID()
    const cutterId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [a]: { x: 0, y: 0 },
      [b]: { x: 10, y: 0 },
      [c0]: { x: 15, y: -10 },
      [c1]: { x: 15, y: 10 }
    }
    d.entities = [
      { id: targetId, kind: 'polyline', pointIds: [a, b], closed: false },
      { id: cutterId, kind: 'polyline', pointIds: [c0, c1], closed: false }
    ]
    const res = extendSketchEdge(
      d,
      { entityId: cutterId, edgeIndex: 0 },
      { entityId: targetId, edgeIndex: 0 },
      [9, 0]
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const p = res.design.points[b]!
    expect(p.x).toBeCloseTo(15, 3)
    expect(p.y).toBeCloseTo(0, 3)
  })

  it('extendSketchEdge extends polyline to arc cutter circle', () => {
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const targetId = crypto.randomUUID()
    const cutterId = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [a]: { x: 0, y: 0 },
      [b]: { x: 3, y: 0 },
      [s]: { x: 10, y: 0 },
      [v]: { x: 8, y: 2 },
      [e]: { x: 6, y: 0 }
    }
    d.entities = [
      { id: targetId, kind: 'polyline', pointIds: [a, b], closed: false },
      { id: cutterId, kind: 'arc', startId: s, viaId: v, endId: e }
    ]
    const res = extendSketchEdge(
      d,
      { entityId: cutterId, edgeIndex: 0 },
      { entityId: targetId, edgeIndex: 0 },
      [2.8, 0]
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const p = res.design.points[b]!
    expect(p.x).toBeGreaterThan(5.5)
    expect(Math.abs(p.y)).toBeLessThan(1e-5)
  })

  it('constraintPickPointIdEdges lists polyline links and arc chords', () => {
    const d = emptyDesign()
    d.points = { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 0, y: 1 } }
    d.entities = [
      { id: 'pl', kind: 'polyline', pointIds: ['p0', 'p1'], closed: false },
      { id: 'ar', kind: 'arc', startId: 'p0', viaId: 'p1', endId: 'p2' }
    ]
    const edges = constraintPickPointIdEdges(d)
    expect(edges).toContainEqual({ a: 'p0', b: 'p1' })
    expect(edges).toContainEqual({ a: 'p1', b: 'p2' })
  })

  it('pickNearestCircularEntityId picks circle/arc entities only', () => {
    const s = crypto.randomUUID()
    const v = crypto.randomUUID()
    const e = crypto.randomUUID()
    const d = emptyDesign()
    d.points = {
      [s]: { x: 10, y: 0 },
      [v]: { x: 8, y: 2 },
      [e]: { x: 6, y: 0 },
      p0: { x: 0, y: 0 },
      p1: { x: 5, y: 0 }
    }
    d.entities = [
      { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 4 },
      { id: 'a1', kind: 'arc', startId: s, viaId: v, endId: e },
      { id: 'pl', kind: 'polyline', pointIds: ['p0', 'p1'], closed: false }
    ]
    expect(pickNearestCircularEntityId(d, 4, 0, 1.5)?.entityId).toBe('c1')
    expect(pickNearestCircularEntityId(d, 8, 2, 1.5)?.entityId).toBe('a1')
  })
})
