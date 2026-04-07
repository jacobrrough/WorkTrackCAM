import { describe, expect, it } from 'vitest'
import {
  apply4AxisCylindricalTransform,
  apply4AxisRadialZToMillPreviewSegments,
  buildContiguousPathChains,
  buildToolpathLengthSampler,
  extractToolpathSegments4AxisFromGcode,
  extractToolpathSegments5AxisFromGcode,
  extractToolpathSegmentsFromGcode,
  isManufactureKind4AxisForPreview,
  isManufactureKind5AxisForPreview,
  resolve4AxisCylinderDiameterMm,
  totalToolpathLengthMm
} from './cam-gcode-toolpath'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

describe('extractToolpathSegmentsFromGcode', () => {
  it('tracks modal XYZ on G0/G1', () => {
    const g = ['G0 Z5', 'G0 X1 Y2', 'G1 Z-1 F200', 'G1 X10'].join('\n')
    const s = extractToolpathSegmentsFromGcode(g)
    expect(s.length).toBe(4)
    expect(s[0]!.kind).toBe('rapid')
    expect(s[2]!.z1).toBe(-1)
    expect(s[3]!.x1).toBe(10)
    expect(s[3]!.y1).toBe(2)
    expect(s[3]!.z1).toBe(-1)
  })

  it('ignores comments-only and drill cycles', () => {
    const g = ['; comment', 'G81 X1 Y2 Z-3 R2', 'G0 X0 Y0'].join('\n')
    const s = extractToolpathSegmentsFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.kind).toBe('rapid')
  })

  it('interpolates G2 clockwise arc into multiple feed sub-segments', () => {
    // Quarter-circle CW: start (10,0), center (0,0) via I=-10 J=0, end (0,10)
    const g = 'G0 X10 Y0 Z0\nG2 X0 Y10 Z0 I-10 J0 F400'
    const s = extractToolpathSegmentsFromGcode(g)
    // G0 produces 1 rapid; G2 produces ARC_INTERPOLATION_SEGMENTS (16) feed sub-segments
    expect(s.length).toBe(17)
    const arcSegs = s.slice(1)
    expect(arcSegs.every((seg) => seg.kind === 'feed')).toBe(true)
    // Each arc sub-segment endpoint should lie on a circle of radius 10
    for (const seg of arcSegs) {
      expect(Math.hypot(seg.x1, seg.y1)).toBeCloseTo(10, 1)
    }
    // Final endpoint should reach the G2 target (0, 10)
    const last = arcSegs[arcSegs.length - 1]!
    expect(last.x1).toBeCloseTo(0, 3)
    expect(last.y1).toBeCloseTo(10, 3)
  })

  it('interpolates G3 counter-clockwise arc and updates modal state', () => {
    // After G3 arc, subsequent G1 should start from arc endpoint
    const g = 'G0 X10 Y0 Z0\nG3 X0 Y10 Z0 I-10 J0 F400\nG1 X5 Y5 F400'
    const s = extractToolpathSegmentsFromGcode(g)
    // G0 + 16 arc segs + G1 = 18
    expect(s.length).toBe(18)
    // The G1 segment after the arc should start from the arc endpoint (0,10,0)
    const g1Seg = s[s.length - 1]!
    expect(g1Seg.x0).toBeCloseTo(0, 3)
    expect(g1Seg.y0).toBeCloseTo(10, 3)
    expect(g1Seg.kind).toBe('feed')
  })

  it('parses compact G0X10Y20 (no spaces) as a rapid', () => {
    // Compact format used by some post-processors — no spaces between G-code and axis words.
    // Previously the \\b word-boundary check silently skipped these lines.
    const s = extractToolpathSegmentsFromGcode('G0X10Y20Z5')
    expect(s.length).toBe(1)
    expect(s[0]!.kind).toBe('rapid')
    expect(s[0]!.x1).toBe(10)
    expect(s[0]!.y1).toBe(20)
    expect(s[0]!.z1).toBe(5)
  })

  it('parses compact G1X5Y3Z-2F400 (no spaces) as a feed', () => {
    const s = extractToolpathSegmentsFromGcode('G1X5Y3Z-2F400')
    expect(s.length).toBe(1)
    expect(s[0]!.kind).toBe('feed')
    expect(s[0]!.x1).toBe(5)
    expect(s[0]!.z1).toBe(-2)
  })

  it('parses explicit positive axis sign X+10.5 Y+5 (Fanuc/Heidenhain posts)', () => {
    const g = 'G0 X+10.5 Y+5 Z+2'
    const s = extractToolpathSegmentsFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.kind).toBe('rapid')
    expect(s[0]!.x1).toBeCloseTo(10.5, 5)
    expect(s[0]!.y1).toBeCloseTo(5, 5)
    expect(s[0]!.z1).toBeCloseTo(2, 5)
  })

  it('ignores axis values inside parenthetical comments — G1 X10 (Y-5 ref) Y20', () => {
    // Without comment stripping, the Y regex would match Y-5 from the comment.
    const g = 'G1 X10 (Y-5 ref) Y20 F400'
    const s = extractToolpathSegmentsFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.x1).toBeCloseTo(10, 5)
    expect(s[0]!.y1).toBeCloseTo(20, 5)  // must be 20, NOT -5 from the comment
  })

  it('handles multiple parenthetical comments in one line', () => {
    const g = 'G1 (op start) X5 (end at X) Y10 (not Z) Z-3 F800'
    const s = extractToolpathSegmentsFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.x1).toBeCloseTo(5, 5)
    expect(s[0]!.y1).toBeCloseTo(10, 5)
    expect(s[0]!.z1).toBeCloseTo(-3, 5)
  })

  it('parses compact G2X0Y10I-10J0 arc without spaces', () => {
    // G2 arc with no spaces: G2X0Y10I-10J0
    const s = extractToolpathSegmentsFromGcode('G0X10Y0Z0\nG2X0Y10I-10J0F400')
    // G0 + 16 arc sub-segments
    expect(s.length).toBe(17)
    expect(s.slice(1).every((seg) => seg.kind === 'feed')).toBe(true)
    // Endpoints should lie on radius-10 circle
    for (const seg of s.slice(1)) {
      expect(Math.hypot(seg.x1, seg.y1)).toBeCloseTo(10, 1)
    }
  })
})

describe('buildContiguousPathChains', () => {
  it('merges continuous feed moves into one chain', () => {
    const g = ['G0 Z5', 'G1 Z0 F200', 'G1 X1 Y0'].join('\n')
    const segs = extractToolpathSegmentsFromGcode(g)
    const chains = buildContiguousPathChains(segs)
    expect(chains.length).toBe(2)
    const feed = chains.find((c) => c.kind === 'feed')
    expect(feed?.points.length).toBe(3)
    expect(feed?.points[0]).toEqual({ x: 0, y: 0, z: 5 })
    expect(feed?.points[2]).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('starts a new chain on kind change', () => {
    const g = ['G0 X0 Y0 Z5', 'G1 X1 Y0 Z0'].join('\n')
    const segs = extractToolpathSegmentsFromGcode(g)
    const chains = buildContiguousPathChains(segs)
    expect(chains.length).toBe(2)
  })

  it('starts a new chain for same-kind segments with a gap (non-contiguous)', () => {
    // Two feed moves that don't connect: first ends at (1,0,0), second starts at (5,0,0).
    // Both are feeds but they're not contiguous — each must be its own chain.
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 1, y1: 0, z1: 0 },
      { kind: 'feed', x0: 5, y0: 0, z0: 0, x1: 6, y1: 0, z1: 0 }
    ]
    const chains = buildContiguousPathChains(segs)
    expect(chains.length).toBe(2)
    expect(chains[0]!.kind).toBe('feed')
    expect(chains[1]!.kind).toBe('feed')
    expect(chains[0]!.points[chains[0]!.points.length - 1]).toEqual({ x: 1, y: 0, z: 0 })
    expect(chains[1]!.points[0]).toEqual({ x: 5, y: 0, z: 0 })
  })
})

describe('buildToolpathLengthSampler', () => {
  it('interpolates along segment lengths', () => {
    const g = ['G0 X0 Y0 Z0', 'G1 X3 Y4 Z0 F200'].join('\n')
    const segs = extractToolpathSegmentsFromGcode(g)
    expect(totalToolpathLengthMm(segs)).toBeCloseTo(5, 5)
    const s = buildToolpathLengthSampler(segs)
    expect(s.totalMm).toBeCloseTo(5, 5)
    const mid = s.atUnit(0.5)
    expect(mid.x).toBeCloseTo(1.5, 5)
    expect(mid.y).toBeCloseTo(2, 5)
    expect(mid.z).toBeCloseTo(0, 5)
    const end = s.atUnit(1)
    expect(end.x).toBe(3)
    expect(end.y).toBe(4)
  })

  it('handles empty segments', () => {
    const s = buildToolpathLengthSampler([])
    expect(s.totalMm).toBe(0)
    expect(s.atUnit(0.5)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('handles single segment correctly', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X10 Y0 Z0 F200')
    expect(segs.length).toBe(1)
    const s = buildToolpathLengthSampler(segs)
    expect(s.totalMm).toBeCloseTo(10, 5)
    expect(s.atUnit(0)).toEqual({ x: 0, y: 0, z: 0 })
    const mid = s.atUnit(0.5)
    expect(mid.x).toBeCloseTo(5, 5)
    const end = s.atUnit(1)
    expect(end.x).toBeCloseTo(10, 5)
  })

  it('handles zero-length (collinear) segment without NaN', () => {
    // Both segments start and end at origin (state starts at 0,0,0 — no movement)
    const segs = extractToolpathSegmentsFromGcode('G1 X0 Y0 Z0 F200\nG1 X0 Y0 Z0 F200')
    const s = buildToolpathLengthSampler(segs)
    expect(s.totalMm).toBe(0)
    const pos = s.atUnit(0.5)
    expect(Number.isFinite(pos.x)).toBe(true)
    expect(Number.isFinite(pos.y)).toBe(true)
    expect(Number.isFinite(pos.z)).toBe(true)
  })

  it('segmentIndexAtUnit returns correct segment index across multi-segment path', () => {
    // Three equal-length feed segments of 5mm each (no initial G0 so no zero-len seg)
    // seg 0: 0→5, seg 1: 5→10, seg 2: 10→15 → total 15mm
    const g = ['G1 X5 Y0 Z0 F200', 'G1 X10 Y0 Z0 F200', 'G1 X15 Y0 Z0 F200'].join('\n')
    const segs = extractToolpathSegmentsFromGcode(g)
    expect(segs.length).toBe(3)
    const s = buildToolpathLengthSampler(segs)
    expect(s.totalMm).toBeCloseTo(15, 5)
    // u=0.1 → 1.5mm → inside seg 0 (0–5mm)
    expect(s.segmentIndexAtUnit(0.1)).toBe(0)
    // u=0.4 → 6mm → inside seg 1 (5–10mm)
    expect(s.segmentIndexAtUnit(0.4)).toBe(1)
    // u=0.8 → 12mm → inside seg 2 (10–15mm)
    expect(s.segmentIndexAtUnit(0.8)).toBe(2)
    // u=1 → last segment
    expect(s.segmentIndexAtUnit(1)).toBe(segs.length - 1)
  })

  it('atUnit clamps u outside [0,1] to endpoints', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X10 Y0 Z0 F200')
    const s = buildToolpathLengthSampler(segs)
    expect(s.atUnit(-1)).toEqual(s.atUnit(0))
    expect(s.atUnit(2)).toEqual(s.atUnit(1))
  })

  it('atUnit(0) handles a zero-length leading segment without NaN (L < 1e-12 guard)', () => {
    // G0 to the current position (0,0,0) produces a zero-length segment followed by a 5mm feed.
    // Querying atUnit(0) must walk past the zero-length segment via the L < 1e-12 early return
    // and produce a finite result at the segment endpoint.
    const segs = extractToolpathSegmentsFromGcode(['G0 X0 Y0 Z0', 'G1 X5 Y0 Z0 F200'].join('\n'))
    expect(segs.length).toBe(2)
    expect(segs[0]!.x1 - segs[0]!.x0).toBe(0) // confirm zero-length first segment
    const s = buildToolpathLengthSampler(segs)
    expect(s.totalMm).toBeCloseTo(5, 5)
    const pos = s.atUnit(0)
    expect(Number.isFinite(pos.x)).toBe(true)
    expect(Number.isFinite(pos.y)).toBe(true)
    expect(Number.isFinite(pos.z)).toBe(true)
    expect(pos.x).toBeCloseTo(0, 5)
  })
})

describe('extractToolpathSegments4AxisFromGcode', () => {
  it('tracks A-axis state across G0/G1 moves', () => {
    const g = ['G0 Z25 A0', 'G1 X10 Z13 A45 F800', 'G1 X20 A90'].join('\n')
    const s = extractToolpathSegments4AxisFromGcode(g)
    expect(s.length).toBe(3)
    // First move: A goes 0→0
    expect(s[0]!.a0).toBe(0)
    expect(s[0]!.a1).toBe(0)
    // Second move: A goes 0→45
    expect(s[1]!.a0).toBe(0)
    expect(s[1]!.a1).toBe(45)
    expect(s[1]!.z1).toBe(13)
    // Third move: A goes 45→90, Z modal at 13
    expect(s[2]!.a0).toBe(45)
    expect(s[2]!.a1).toBe(90)
    expect(s[2]!.z1).toBe(13)
  })

  it('parses compact G0A45 (no space between G-code and A word) as a rapid', () => {
    // Compact form produced by some controllers: G0A45 without a separating space.
    // Previously the \b word-boundary check silently skipped such lines.
    const g = 'G0A45'
    const s = extractToolpathSegments4AxisFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.kind).toBe('rapid')
    expect(s[0]!.a1).toBe(45)
  })

  it('parses compact G1Z-3A90F800 (all axis words fused) as a feed', () => {
    const g = 'G1Z-3A90F800'
    const s = extractToolpathSegments4AxisFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.kind).toBe('feed')
    expect(s[0]!.z1).toBe(-3)
    expect(s[0]!.a1).toBe(90)
  })

  it('parses explicit positive A+45 (Fanuc post with signed rotary axis)', () => {
    const g = 'G1 X+10 Z+13 A+45 F800'
    const s = extractToolpathSegments4AxisFromGcode(g)
    expect(s.length).toBe(1)
    expect(s[0]!.x1).toBeCloseTo(10, 5)
    expect(s[0]!.z1).toBeCloseTo(13, 5)
    expect(s[0]!.a1).toBeCloseTo(45, 5)
  })

  it('correctly classifies compact G00Z30 as rapid and G01X10 as feed', () => {
    const g = ['G00Z30', 'G01X10F400'].join('\n')
    const s = extractToolpathSegments4AxisFromGcode(g)
    expect(s.length).toBe(2)
    expect(s[0]!.kind).toBe('rapid')
    expect(s[0]!.z1).toBe(30)
    expect(s[1]!.kind).toBe('feed')
    expect(s[1]!.x1).toBe(10)
  })
})

describe('apply4AxisCylindricalTransform', () => {
  it('converts (X, Z_radial, A_deg) to Cartesian (X, Y, Z)', () => {
    // At A=0°: Y=Z_radial*cos(0)=Z_radial, Z=Z_radial*sin(0)=0
    const g = ['G0 Z15 A0', 'G1 Z13 A90'].join('\n')
    const segs4 = extractToolpathSegments4AxisFromGcode(g)
    const cart = apply4AxisCylindricalTransform(segs4)
    // First segment: A stays 0 → no arc interpolation, single segment
    expect(cart[0]!.y1).toBeCloseTo(15, 5)
    expect(cart[0]!.z1).toBeCloseTo(0, 5)

    // Second segment: A=0→90° (90° change) → arc-interpolated into multiple sub-segments
    // Last sub-segment end should be at A=90°, Z_radial=13 → Y≈0, Z=13
    const last = cart[cart.length - 1]!
    expect(last.y1).toBeCloseTo(0, 3)
    expect(last.z1).toBeCloseTo(13, 3)
    // Should produce multiple sub-segments (ceil(90/5)=18)
    expect(cart.length).toBeGreaterThan(2)
  })

  it('wraps toolpath around cylinder for full 360°', () => {
    const g = [
      'G0 Z15 A0',
      'G1 Z15 A90',
      'G1 Z15 A180',
      'G1 Z15 A270'
    ].join('\n')
    const segs4 = extractToolpathSegments4AxisFromGcode(g)
    const cart = apply4AxisCylindricalTransform(segs4)
    // Arc interpolation produces many sub-segments; verify endpoints of the
    // full arc by checking the LAST sub-segment of each original move.
    // Each 90° G1 feed move → ceil(90/5)=18 sub-segments.
    // G0 rapid also 90° from 0→0 (no A change): 1 segment.
    // Total: 1 + 18 + 18 + 18 = 55 segments.
    expect(cart.length).toBeGreaterThan(4)

    // Final sub-segment end should be at A=270°, Z=15 → Y≈0, Z=-15
    const last = cart[cart.length - 1]!
    expect(last.y1).toBeCloseTo(0, 2)
    expect(last.z1).toBeCloseTo(-15, 3)

    // All FEED sub-segments should have endpoints ON the cylinder surface (radius ≈ 15)
    // (skip the initial rapid from Z=0 which starts at the origin)
    for (const s of cart) {
      if (s.kind !== 'feed') continue
      const r0 = Math.hypot(s.y0, s.z0)
      const r1 = Math.hypot(s.y1, s.z1)
      expect(r0).toBeCloseTo(15, 1)
      expect(r1).toBeCloseTo(15, 1)
    }
  })

  it('arc-interpolated sub-segments stay on cylinder surface (no chord through interior)', () => {
    // A single 90° feed move — with arc interpolation, every sub-segment endpoint
    // should be at radius 15 from the axis, not cutting through the cylinder interior.
    const g = ['G0 Z15 A0', 'G1 Z15 A90'].join('\n')
    const cart = apply4AxisCylindricalTransform(extractToolpathSegments4AxisFromGcode(g))
    // Should have many sub-segments for the 90° move (1 rapid + 18 feed)
    expect(cart.length).toBeGreaterThan(10)
    // Check only feed sub-segments (initial rapid starts from Z=0 origin)
    const feedSegs = cart.filter(s => s.kind === 'feed')
    expect(feedSegs.length).toBe(18) // ceil(90/5)
    for (const s of feedSegs) {
      const r0 = Math.hypot(s.y0, s.z0)
      const r1 = Math.hypot(s.y1, s.z1)
      expect(r0).toBeCloseTo(15, 3)
      expect(r1).toBeCloseTo(15, 3)
    }
  })

  it('small A changes (≤5°) are not arc-interpolated for feed moves', () => {
    const g = ['G0 Z15 A0', 'G1 Z15 A3'].join('\n')
    const cart = apply4AxisCylindricalTransform(extractToolpathSegments4AxisFromGcode(g))
    // G0 A=0→0: 1 segment, G1 A=0→3 (≤5°): 1 segment → total 2
    expect(cart.length).toBe(2)
  })

  it('varying Z_radial at same angle shows different radii', () => {
    // Two cuts at A=0°: one at R=15 (stock surface), one at R=10 (deeper)
    const g = ['G0 Z15 A0', 'G1 Z10 A0'].join('\n')
    const cart = apply4AxisCylindricalTransform(extractToolpathSegments4AxisFromGcode(g))
    // No A change → no interpolation → 2 segments
    expect(cart.length).toBe(2)
    // Start: R=15, A=0 → Y=15
    expect(cart[1]!.y0).toBeCloseTo(15, 5)
    // End: R=10, A=0 → Y=10
    expect(cart[1]!.y1).toBeCloseTo(10, 5)
  })

  it('multi-revolution path (720°) stays on cylinder and ends at same angle as start', () => {
    // Two full revolutions at constant Z=15 (A: 0→360→720)
    // Uses separate G1 segments (A increments of 90° each).
    const g = [
      'G0 Z15 A0',
      'G1 Z15 A90',
      'G1 Z15 A180',
      'G1 Z15 A270',
      'G1 Z15 A360',
      'G1 Z15 A450',
      'G1 Z15 A540',
      'G1 Z15 A630',
      'G1 Z15 A720'
    ].join('\n')
    const segs4 = extractToolpathSegments4AxisFromGcode(g)
    const cart = apply4AxisCylindricalTransform(segs4)

    // All feed sub-segments must stay on the cylinder surface (radius = 15)
    for (const s of cart) {
      if (s.kind !== 'feed') continue
      expect(Math.hypot(s.y0, s.z0)).toBeCloseTo(15, 1)
      expect(Math.hypot(s.y1, s.z1)).toBeCloseTo(15, 1)
    }

    // A=720° is equivalent to A=0°: final endpoint should be Y≈15, Z≈0
    const last = cart[cart.length - 1]!
    expect(last.y1).toBeCloseTo(15, 2)
    expect(last.z1).toBeCloseTo(0, 2)

    // Should produce many more sub-segments than the 8 original G1 moves
    expect(cart.length).toBeGreaterThan(8 * Math.ceil(90 / 5))
  })
})

describe('apply4AxisRadialZToMillPreviewSegments', () => {
  it('subtracts radius so cut_z = R + z_pass maps to z_pass (mill-style)', () => {
    const D = 50
    const R = D / 2
    const zPass = -1
    const cutZ = R + zPass
    const g = `G1 Z${cutZ.toFixed(3)} F300`
    const raw = extractToolpathSegmentsFromGcode(g)
    const adj = apply4AxisRadialZToMillPreviewSegments(raw, D)
    expect(adj.length).toBe(1)
    expect(adj[0]!.z1).toBeCloseTo(zPass, 5)
    expect(adj[0]!.z0).toBeCloseTo(-R, 5)
  })

  it('resolve4AxisCylinderDiameterMm reads params or defaults to 50', () => {
    expect(resolve4AxisCylinderDiameterMm(undefined)).toBe(50)
    expect(resolve4AxisCylinderDiameterMm({})).toBe(50)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 40 })).toBe(40)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: -1 })).toBe(50)
  })
})

describe('isManufactureKind4AxisForPreview', () => {
  it('returns true for all 4-axis kinds', () => {
    expect(isManufactureKind4AxisForPreview('cnc_4axis_roughing')).toBe(true)
    expect(isManufactureKind4AxisForPreview('cnc_4axis_finishing')).toBe(true)
    expect(isManufactureKind4AxisForPreview('cnc_4axis_contour')).toBe(true)
    expect(isManufactureKind4AxisForPreview('cnc_4axis_indexed')).toBe(true)
    expect(isManufactureKind4AxisForPreview('cnc_4axis_continuous')).toBe(true)
  })

  it('returns false for non-4-axis kinds', () => {
    expect(isManufactureKind4AxisForPreview('cnc_raster')).toBe(false)
    expect(isManufactureKind4AxisForPreview('cnc_5axis_contour')).toBe(false)
    expect(isManufactureKind4AxisForPreview(undefined)).toBe(false)
    expect(isManufactureKind4AxisForPreview('')).toBe(false)
  })
})

describe('isManufactureKind5AxisForPreview', () => {
  it('returns true for all 5-axis kinds', () => {
    expect(isManufactureKind5AxisForPreview('cnc_5axis_contour')).toBe(true)
    expect(isManufactureKind5AxisForPreview('cnc_5axis_swarf')).toBe(true)
    expect(isManufactureKind5AxisForPreview('cnc_5axis_flowline')).toBe(true)
  })

  it('returns false for non-5-axis kinds', () => {
    expect(isManufactureKind5AxisForPreview('cnc_4axis_roughing')).toBe(false)
    expect(isManufactureKind5AxisForPreview('cnc_raster')).toBe(false)
    expect(isManufactureKind5AxisForPreview(undefined)).toBe(false)
  })
})

describe('extractToolpathSegments5AxisFromGcode', () => {
  it('tracks modal X/Y/Z/A/B state across G0 and G1 moves', () => {
    const g = ['G0 Z25 A0 B0', 'G1 X10 Z13 A45 B10 F800', 'G1 X20 A90'].join('\n')
    const s = extractToolpathSegments5AxisFromGcode(g)
    expect(s.length).toBe(3)
    // First move: A/B stay 0
    expect(s[0]!.a0).toBe(0)
    expect(s[0]!.a1).toBe(0)
    expect(s[0]!.b0).toBe(0)
    expect(s[0]!.b1).toBe(0)
    // Second move: A goes 0→45, B goes 0→10
    expect(s[1]!.a0).toBe(0)
    expect(s[1]!.a1).toBe(45)
    expect(s[1]!.b0).toBe(0)
    expect(s[1]!.b1).toBe(10)
    expect(s[1]!.z1).toBe(13)
    // Third move: A goes 45→90, B modal at 10, Z modal at 13
    expect(s[2]!.a0).toBe(45)
    expect(s[2]!.a1).toBe(90)
    expect(s[2]!.b0).toBe(10)
    expect(s[2]!.b1).toBe(10)
    expect(s[2]!.z1).toBe(13)
  })

  it('classifies G0 as rapid and G1 as feed', () => {
    const g = ['G0 X0 A0 B0', 'G1 X10 A30 B5 F400'].join('\n')
    const s = extractToolpathSegments5AxisFromGcode(g)
    expect(s[0]!.kind).toBe('rapid')
    expect(s[1]!.kind).toBe('feed')
  })

  it('ignores comment lines and non-motion blocks', () => {
    const g = ['; setup', 'T1 M6', 'G0 X0 Y0 Z5 A0 B0', 'M3 S8000', 'G1 Z-1 F200'].join('\n')
    const s = extractToolpathSegments5AxisFromGcode(g)
    expect(s.length).toBe(2)
  })

  it('returns empty array for empty gcode', () => {
    expect(extractToolpathSegments5AxisFromGcode('')).toEqual([])
    expect(extractToolpathSegments5AxisFromGcode('; comment only')).toEqual([])
  })

  it('interpolates A and B linearly across G2/G3 arc sub-segments', () => {
    // A quarter-circle arc from (0,0) to (10,10) center at (10,0) with A going 0→90
    const g = 'G2 X10 Y10 Z0 I10 J0 A90 B0 F400'
    const s = extractToolpathSegments5AxisFromGcode(g)
    expect(s.length).toBeGreaterThan(1)
    // First sub-segment: a0 should be 0 (start of interpolation)
    expect(s[0]!.a0).toBeCloseTo(0, 5)
    // Last sub-segment: a1 should be 90 (end of interpolation)
    expect(s[s.length - 1]!.a1).toBeCloseTo(90, 5)
    // All a values should be monotonically increasing (0→90)
    for (let i = 0; i < s.length - 1; i++) {
      expect(s[i]!.a1).toBeGreaterThanOrEqual(s[i]!.a0 - 1e-9)
    }
  })
})
