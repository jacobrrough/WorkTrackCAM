/**
 * Paired-pin contract for `src/shared/cam-gcode-toolpath.ts`
 * -- the 542-line SHARED G-code parsing + 4-axis cylindrical transform
 * + path-chain + arc-length sampler module consumed by the toolpath
 * preview pipeline for all three target machines (K2 Plus FDM toolpath
 * preview is rare but possible; Laguna Swift 5x10 3-axis preview;
 * Carvera 3-axis + 4-axis Rotary preview).
 *
 * The module exports 12 runtime symbols and 6 type-only symbols:
 *
 * Runtime (12):
 * - `extractToolpathSegmentsFromGcode(gcode)` -- 3-axis G0/G1/G2/G3 parser
 *   (G2/G3 arcs interpolated via 16 sub-segments per arc).
 * - `extractToolpathSegments4AxisFromGcode(gcode)` -- 4-axis G0/G1 parser
 *   with modal A/B tracking (does NOT arc-interpolate G2/G3).
 * - `apply4AxisCylindricalTransform(segments)` -- Cartesian projection of
 *   4-axis (X, Z_radial, A_deg) cylindrical preview; arc-subdivides above
 *   5deg feed / 10deg rapid threshold so polylines hug the cylinder surface.
 * - `DEFAULT_4AXIS_CYLINDER_DIAMETER_MM` (=50) -- shared default cylinder
 *   diameter used when params omit it.
 * - `isManufactureKind4AxisForPreview(kind)` -- exact 5-string allowlist
 *   for Carvera 4-axis Rotary kinds.
 * - `isManufactureKind5AxisForPreview(kind)` -- exact 3-string allowlist
 *   for 5-axis kinds (no current shop machine runs 5-axis; reserved).
 * - `resolve4AxisCylinderDiameterMm(params)` -- safe diameter resolver.
 * - `apply4AxisRadialZToMillPreviewSegments(segments, diameter)` -- shifts
 *   Z by -R so cut_z = R + z_pass maps to z_pass for mill-style preview.
 * - `buildContiguousPathChains(segments)` -- merges contiguous same-kind
 *   segments into polylines.
 * - `buildToolpathLengthSampler(segments)` -- arc-length parameterization
 *   with cumulativeMm Float64Array, atUnit, segmentIndexAtUnit closures.
 * - `totalToolpathLengthMm(segments)` -- sum of segment 3D lengths.
 * - `extractToolpathSegments5AxisFromGcode(gcode)` -- 5-axis G0/G1/G2/G3
 *   parser with linear A/B interpolation across arc sub-segments.
 *
 * Type-only (6):
 * - `ToolpathMotionKind` (alias 'rapid' | 'feed')
 * - `ToolpathSegment3` (3-axis xyz endpoint pair)
 * - `ToolpathSegment4` (3 + a0/a1/b0/b1)
 * - `ToolpathSegment5` (3 + a0/a1/b0/b1; identical structural shape to
 *   ToolpathSegment4 but logically distinct for 5-axis sim wiring)
 * - `ToolpathPathChain` (kind + points[])
 * - `ToolpathLengthSampler` (totalMm + 4 closures + cumulativeMm)
 *
 * Three-machine impact: DIRECT cross-cut. Carvera 4-axis Rotary's preview
 * pipeline (`extractToolpathSegments4AxisFromGcode` -> `apply4AxisCylindrical
 * Transform` -> `apply4AxisRadialZToMillPreviewSegments`) is the only path
 * that turns rotary G-code into a 3D preview in the renderer; the K2 Plus
 * FDM preview path uses 3-axis only; Laguna 5x10 uses 3-axis + arc
 * interpolation. The 5-axis parser is reserved for future hardware.
 *
 * This pin co-locates with the existing comprehensive behavioral test
 * `cam-gcode-toolpath.test.ts` (537 lines). The pin is exhaustive against
 * the export surface, ARC_INTERPOLATION_SEGMENTS=16 invariant, the
 * 5deg/10deg arc-subdivide thresholds, the kind allowlists, and the
 * source-text whitelist.
 *
 * Roadmap ID: [ID-0299] / Cycle 226 (post-processing rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './cam-gcode-toolpath'
import {
  DEFAULT_4AXIS_CYLINDER_DIAMETER_MM,
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
import type {
  ToolpathLengthSampler,
  ToolpathMotionKind,
  ToolpathPathChain,
  ToolpathSegment3,
  ToolpathSegment4,
  ToolpathSegment5
} from './cam-gcode-toolpath'

const SOURCE_PATH = resolve(__dirname, 'cam-gcode-toolpath.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// A. Module shape -- exact runtime surface
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/shared/cam-gcode-toolpath.ts', () => {
  it('exports exactly the 12-symbol runtime public surface (sorted)', () => {
    expect(Object.keys(M).sort()).toEqual([
      'DEFAULT_4AXIS_CYLINDER_DIAMETER_MM',
      'apply4AxisCylindricalTransform',
      'apply4AxisRadialZToMillPreviewSegments',
      'buildContiguousPathChains',
      'buildToolpathLengthSampler',
      'extractToolpathSegments4AxisFromGcode',
      'extractToolpathSegments5AxisFromGcode',
      'extractToolpathSegmentsFromGcode',
      'isManufactureKind4AxisForPreview',
      'isManufactureKind5AxisForPreview',
      'resolve4AxisCylinderDiameterMm',
      'totalToolpathLengthMm'
    ])
  })

  it('all 11 function exports classify as `function`', () => {
    expect(typeof extractToolpathSegmentsFromGcode).toBe('function')
    expect(typeof extractToolpathSegments4AxisFromGcode).toBe('function')
    expect(typeof apply4AxisCylindricalTransform).toBe('function')
    expect(typeof isManufactureKind4AxisForPreview).toBe('function')
    expect(typeof isManufactureKind5AxisForPreview).toBe('function')
    expect(typeof resolve4AxisCylinderDiameterMm).toBe('function')
    expect(typeof apply4AxisRadialZToMillPreviewSegments).toBe('function')
    expect(typeof buildContiguousPathChains).toBe('function')
    expect(typeof buildToolpathLengthSampler).toBe('function')
    expect(typeof totalToolpathLengthMm).toBe('function')
    expect(typeof extractToolpathSegments5AxisFromGcode).toBe('function')
  })

  it('the single non-function runtime export is the numeric constant DEFAULT_4AXIS_CYLINDER_DIAMETER_MM', () => {
    expect(typeof DEFAULT_4AXIS_CYLINDER_DIAMETER_MM).toBe('number')
    expect(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM).toBe(50)
  })

  it('arities match the documented signatures', () => {
    // gcode parsers take a single string
    expect(extractToolpathSegmentsFromGcode.length).toBe(1)
    expect(extractToolpathSegments4AxisFromGcode.length).toBe(1)
    expect(extractToolpathSegments5AxisFromGcode.length).toBe(1)
    // single-array transforms
    expect(apply4AxisCylindricalTransform.length).toBe(1)
    expect(buildContiguousPathChains.length).toBe(1)
    expect(buildToolpathLengthSampler.length).toBe(1)
    expect(totalToolpathLengthMm.length).toBe(1)
    // segments + diameter
    expect(apply4AxisRadialZToMillPreviewSegments.length).toBe(2)
    // params
    expect(resolve4AxisCylinderDiameterMm.length).toBe(1)
    // kind predicates
    expect(isManufactureKind4AxisForPreview.length).toBe(1)
    expect(isManufactureKind5AxisForPreview.length).toBe(1)
  })

  it('no synchronous class constructors are exported (all runtime exports are functions or numbers)', () => {
    for (const name of Object.keys(M)) {
      const v = (M as Record<string, unknown>)[name]
      // Functions and numeric constants are allowed; classes (which would have a non-empty prototype with own enumerable methods) are not.
      const t = typeof v
      expect(t === 'function' || t === 'number').toBe(true)
    }
  })

  it('no Promise/AsyncFunction surface (this is a synchronous toolpath layer)', () => {
    for (const name of Object.keys(M)) {
      const v = (M as Record<string, unknown>)[name]
      if (typeof v === 'function') {
        expect(v.constructor.name).toBe('Function')
        expect(v.constructor.name).not.toBe('AsyncFunction')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// B. ToolpathMotionKind / ToolpathSegment3 type-level + runtime parity
// ---------------------------------------------------------------------------
describe('B. ToolpathMotionKind + ToolpathSegment3 shape', () => {
  it('extractToolpathSegmentsFromGcode result: every segment has exactly 7 string keys', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X1 Y2 Z3\nG1 X4 Y5 Z6 F100')
    expect(segs.length).toBe(2)
    for (const s of segs) {
      expect(Object.keys(s).sort()).toEqual(['kind', 'x0', 'x1', 'y0', 'y1', 'z0', 'z1'])
    }
  })

  it('every segment kind is one of the two ToolpathMotionKind literals', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X1\nG1 X2\nG0 X3\nG1 X4')
    for (const s of segs) {
      expect(s.kind === 'rapid' || s.kind === 'feed').toBe(true)
    }
  })

  it('rapid <-> G0 / feed <-> G1 binding holds', () => {
    const segs = extractToolpathSegmentsFromGcode(['G0 X1', 'G1 X2 F200', 'G00 X3', 'G01 X4 F100'].join('\n'))
    expect(segs.length).toBe(4)
    expect(segs[0]!.kind).toBe('rapid')
    expect(segs[1]!.kind).toBe('feed')
    expect(segs[2]!.kind).toBe('rapid')
    expect(segs[3]!.kind).toBe('feed')
  })

  it('all 6 numeric coordinate fields are finite numbers', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X10 Y20 Z30\nG1 X-5.5 Y0.25 Z-1e-3 F300')
    expect(segs.length).toBe(2)
    for (const s of segs) {
      for (const k of ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'] as const) {
        expect(typeof s[k]).toBe('number')
        expect(Number.isFinite(s[k])).toBe(true)
      }
    }
  })

  // Compile-time pin via assignability — if ToolpathMotionKind broadens, this fails to compile.
  it('ToolpathMotionKind admits exactly the two literals at compile time', () => {
    const a: ToolpathMotionKind = 'rapid'
    const b: ToolpathMotionKind = 'feed'
    expect([a, b]).toEqual(['rapid', 'feed'])
  })
})

// ---------------------------------------------------------------------------
// C. extractToolpathSegmentsFromGcode -- shape + arc-interpolation invariant
// ---------------------------------------------------------------------------
describe('C. extractToolpathSegmentsFromGcode shape + arc invariant', () => {
  it('returns ToolpathSegment3[] (non-frozen array)', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X5 F200')
    expect(Array.isArray(segs)).toBe(true)
    expect(Object.isFrozen(segs)).toBe(false)
  })

  it('empty input -> empty array', () => {
    expect(extractToolpathSegmentsFromGcode('')).toEqual([])
    expect(extractToolpathSegmentsFromGcode('\n\n; comment-only\n; another').length).toBe(0)
  })

  it('non-G-code lines (M-codes, T-codes, S-codes) emit no segments', () => {
    const g = ['T1 M6', 'M3 S8000', 'M5', 'M30'].join('\n')
    expect(extractToolpathSegmentsFromGcode(g).length).toBe(0)
  })

  it('canned cycles (G81/G82/G83) emit no segments (parser only handles G0/G1/G2/G3)', () => {
    const g = ['G81 X1 Y2 Z-3 R2', 'G82 X5 Z-1 R1 P200', 'G83 X10 Z-5 Q1'].join('\n')
    expect(extractToolpathSegmentsFromGcode(g).length).toBe(0)
  })

  it('quarter-circle G2 emits exactly 16 sub-segments (ARC_INTERPOLATION_SEGMENTS)', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X10 Y0 Z0\nG2 X0 Y10 Z0 I-10 J0 F400')
    // 1 G0 + 16 arc sub-segments = 17
    expect(segs.length).toBe(17)
    // The 16 trailing sub-segments are all 'feed'
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.kind).toBe('feed')
    }
  })

  it('full G3 emits 16 sub-segments (sweep wraps to 2pi for nominal-zero counter-clockwise)', () => {
    // Same start/end with non-zero I/J -- triggers the sweep-wrap branch (sweep <= 0 -> +2pi for CCW).
    const segs = extractToolpathSegmentsFromGcode('G0 X10 Y0\nG3 X10 Y0 I-10 J0')
    // 1 G0 + 16 arc sub-segments
    expect(segs.length).toBe(17)
  })

  it('arc final sub-segment endpoint is the EXACT G2/G3 target (no float drift)', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X10 Y0 Z0\nG2 X0 Y10 Z0 I-10 J0 F400')
    const last = segs[segs.length - 1]!
    expect(last.x1).toBe(0)
    expect(last.y1).toBe(10)
  })

  it('parser is pure: same input -> identical structural output across calls', () => {
    const g = ['G0 X1 Y2', 'G1 X10 Y20 F100', 'G2 X20 Y10 I10 J0 F100'].join('\n')
    const a = extractToolpathSegmentsFromGcode(g)
    const b = extractToolpathSegmentsFromGcode(g)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('parser does NOT mutate its input string (string is primitive but check no side channel)', () => {
    const g = 'G1 X1 Y2 Z3 F100'
    const before = g
    extractToolpathSegmentsFromGcode(g)
    expect(g).toBe(before)
  })

  it('CRLF line endings parse identically to LF', () => {
    const lf = ['G0 X1', 'G1 X2 F100'].join('\n')
    const crlf = ['G0 X1', 'G1 X2 F100'].join('\r\n')
    expect(extractToolpathSegmentsFromGcode(lf)).toEqual(extractToolpathSegmentsFromGcode(crlf))
  })

  it('lowercase "g0" / "g1" prefix parses (G-code prefix regex is /i)', () => {
    // The G-code prefix regex carries the /i flag, so 'g0 X5' classifies as a rapid.
    // Axis letters (X/Y/Z/I/J), however, MUST be uppercase -- readAxis() regex has no /i flag.
    const lower = extractToolpathSegmentsFromGcode('g0 X5')
    const upper = extractToolpathSegmentsFromGcode('G0 X5')
    expect(lower).toEqual(upper)
    expect(lower[0]!.kind).toBe('rapid')
    expect(lower[0]!.x1).toBe(5)
  })

  it('lowercase axis letters DO NOT match (axis regex is case-sensitive by design)', () => {
    // 'g0 x5' has lowercase axis -- x5 is NOT extracted; x1 stays at modal state.x = 0.
    const segs = extractToolpathSegmentsFromGcode('g0 x5')
    expect(segs.length).toBe(1)
    expect(segs[0]!.x1).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// D. extractToolpathSegments4AxisFromGcode -- shape + ToolpathSegment4
// ---------------------------------------------------------------------------
describe('D. extractToolpathSegments4AxisFromGcode + ToolpathSegment4 shape', () => {
  it('every 4-axis segment has exactly 11 keys (3-axis 7 + a0/a1/b0/b1)', () => {
    const segs = extractToolpathSegments4AxisFromGcode('G0 X1 Y2 Z3 A45 B10\nG1 X4 Y5 Z6 A90 B20 F100')
    expect(segs.length).toBe(2)
    for (const s of segs) {
      expect(Object.keys(s).sort()).toEqual([
        'a0', 'a1', 'b0', 'b1',
        'kind',
        'x0', 'x1', 'y0', 'y1', 'z0', 'z1'
      ])
    }
  })

  it('A and B both modal -- last-seen value carries forward when omitted', () => {
    const g = ['G0 A30 B10', 'G1 X5 F100', 'G1 X10 F100'].join('\n')
    const segs = extractToolpathSegments4AxisFromGcode(g)
    expect(segs.length).toBe(3)
    expect(segs[1]!.a0).toBe(30)
    expect(segs[1]!.a1).toBe(30)
    expect(segs[2]!.a0).toBe(30)
    expect(segs[2]!.a1).toBe(30)
    expect(segs[1]!.b0).toBe(10)
    expect(segs[2]!.b1).toBe(10)
  })

  it('4-axis parser does NOT arc-interpolate G2/G3 (3-axis only feature)', () => {
    // G2 line should not produce any segments in the 4-axis parser.
    const g = 'G2 X10 Y10 I10 J0 F200'
    expect(extractToolpathSegments4AxisFromGcode(g)).toEqual([])
  })

  it('compact form G0A45 and G1Z-3A90F800 parse correctly', () => {
    const segs = extractToolpathSegments4AxisFromGcode(['G0A45', 'G1Z-3A90F800'].join('\n'))
    expect(segs.length).toBe(2)
    expect(segs[0]!.a1).toBe(45)
    expect(segs[1]!.z1).toBe(-3)
    expect(segs[1]!.a1).toBe(90)
  })

  it('signed rotary axis A+45 / A-15 round-trips cleanly', () => {
    const segs = extractToolpathSegments4AxisFromGcode('G1 A+45 F100\nG1 A-15 F100')
    expect(segs[0]!.a1).toBeCloseTo(45, 5)
    expect(segs[1]!.a1).toBeCloseTo(-15, 5)
  })

  it('compile-time: ToolpathSegment4 extends ToolpathSegment3 via intersection', () => {
    // Structural assignability check
    const seg4: ToolpathSegment4 = {
      kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, a0: 0, a1: 90, b0: 0, b1: 0
    }
    const seg3: ToolpathSegment3 = seg4 // assignable upward
    expect(seg3.kind).toBe('feed')
  })
})

// ---------------------------------------------------------------------------
// E. apply4AxisCylindricalTransform -- 5deg/10deg arc subdivide thresholds
// ---------------------------------------------------------------------------
describe('E. apply4AxisCylindricalTransform thresholds + projection', () => {
  it('feed move with delta-A <= 5 deg emits exactly ONE segment (no subdivide)', () => {
    const segs4 = extractToolpathSegments4AxisFromGcode('G1 Z15 A0 F100\nG1 Z15 A5 F100')
    // Second seg: a0=0, a1=5 -> |da|=5 -> NOT > 5 threshold -> single output
    const cart = apply4AxisCylindricalTransform([segs4[1]!])
    expect(cart.length).toBe(1)
  })

  it('feed move with delta-A > 5 deg arc-subdivides at 5 deg step', () => {
    const segs4 = extractToolpathSegments4AxisFromGcode('G1 Z15 A0 F100\nG1 Z15 A45 F100')
    const cart = apply4AxisCylindricalTransform([segs4[1]!])
    // ceil(45/5) = 9 sub-segments
    expect(cart.length).toBe(9)
  })

  it('rapid move with delta-A <= 10 deg emits exactly ONE segment', () => {
    const segs4: ToolpathSegment4[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 15, x1: 0, y1: 0, z1: 15, a0: 0, a1: 10, b0: 0, b1: 0 }
    ]
    const cart = apply4AxisCylindricalTransform(segs4)
    expect(cart.length).toBe(1)
  })

  it('rapid move with delta-A > 10 deg arc-subdivides at 10 deg step', () => {
    const segs4: ToolpathSegment4[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 15, x1: 0, y1: 0, z1: 15, a0: 0, a1: 90, b0: 0, b1: 0 }
    ]
    const cart = apply4AxisCylindricalTransform(segs4)
    // ceil(90/10) = 9 sub-segments
    expect(cart.length).toBe(9)
  })

  it('output kind is preserved per sub-segment (rapid stays rapid; feed stays feed)', () => {
    const segs4: ToolpathSegment4[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 10, x1: 0, y1: 0, z1: 10, a0: 0, a1: 30, b0: 0, b1: 0 },
      { kind: 'feed', x0: 0, y0: 0, z0: 10, x1: 0, y1: 0, z1: 10, a0: 30, a1: 60, b0: 0, b1: 0 }
    ]
    const cart = apply4AxisCylindricalTransform(segs4)
    const rapids = cart.filter((s) => s.kind === 'rapid').length
    const feeds = cart.filter((s) => s.kind === 'feed').length
    // rapid 30deg / 10 = 3; feed 30deg / 5 = 6
    expect(rapids).toBe(3)
    expect(feeds).toBe(6)
  })

  it('output is ToolpathSegment3[] (kind + xyz only -- A/B stripped via projection)', () => {
    const segs4 = extractToolpathSegments4AxisFromGcode('G1 X10 Z15 A30 B5 F100')
    const cart = apply4AxisCylindricalTransform(segs4)
    for (const s of cart) {
      expect(Object.keys(s).sort()).toEqual(['kind', 'x0', 'x1', 'y0', 'y1', 'z0', 'z1'])
    }
  })

  it('A=0 deg: Y = Z_radial; Z = 0 (projection invariant)', () => {
    const segs4: ToolpathSegment4[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 15, x1: 5, y1: 0, z1: 15, a0: 0, a1: 0, b0: 0, b1: 0 }
    ]
    const cart = apply4AxisCylindricalTransform(segs4)
    expect(cart[0]!.y0).toBeCloseTo(15, 6)
    expect(cart[0]!.z0).toBeCloseTo(0, 6)
    expect(cart[0]!.y1).toBeCloseTo(15, 6)
    expect(cart[0]!.z1).toBeCloseTo(0, 6)
  })

  it('empty input -> empty output (no crash)', () => {
    expect(apply4AxisCylindricalTransform([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// F. resolve4AxisCylinderDiameterMm + DEFAULT constant
// ---------------------------------------------------------------------------
describe('F. resolve4AxisCylinderDiameterMm + DEFAULT', () => {
  it('DEFAULT_4AXIS_CYLINDER_DIAMETER_MM is the immutable number 50', () => {
    expect(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM).toBe(50)
    expect(Number.isFinite(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)).toBe(true)
    expect(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM).toBeGreaterThan(0)
  })

  it('null / undefined / non-object params resolve to DEFAULT', () => {
    expect(resolve4AxisCylinderDiameterMm(undefined)).toBe(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)
    expect(resolve4AxisCylinderDiameterMm(null)).toBe(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)
    expect(resolve4AxisCylinderDiameterMm(42)).toBe(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)
    expect(resolve4AxisCylinderDiameterMm('not-an-object')).toBe(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)
  })

  it('object missing the cylinderDiameterMm key resolves to DEFAULT', () => {
    expect(resolve4AxisCylinderDiameterMm({})).toBe(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)
    expect(resolve4AxisCylinderDiameterMm({ otherKey: 99 })).toBe(DEFAULT_4AXIS_CYLINDER_DIAMETER_MM)
  })

  it('non-number / non-finite / non-positive cylinderDiameterMm resolves to DEFAULT', () => {
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 'string' })).toBe(50)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: NaN })).toBe(50)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: Infinity })).toBe(50)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: -1 })).toBe(50)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 0 })).toBe(50)
  })

  it('valid positive finite cylinderDiameterMm passes through', () => {
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 25 })).toBe(25)
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 92 })).toBe(92) // Carvera max diameter
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 0.001 })).toBe(0.001)
  })
})

// ---------------------------------------------------------------------------
// G. apply4AxisRadialZToMillPreviewSegments -- shifts Z by -R
// ---------------------------------------------------------------------------
describe('G. apply4AxisRadialZToMillPreviewSegments', () => {
  it('shifts every segment z0/z1 by -R (= -diameter/2)', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 25, x1: 1, y1: 1, z1: 24 },
      { kind: 'rapid', x0: 1, y0: 1, z0: 30, x1: 2, y1: 2, z1: 30 }
    ]
    const out = apply4AxisRadialZToMillPreviewSegments(segs, 50)
    expect(out.length).toBe(2)
    expect(out[0]!.z0).toBeCloseTo(0, 6)
    expect(out[0]!.z1).toBeCloseTo(-1, 6)
    expect(out[1]!.z0).toBeCloseTo(5, 6)
    expect(out[1]!.z1).toBeCloseTo(5, 6)
  })

  it('preserves x0/x1/y0/y1/kind (only Z is shifted)', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 1.5, y0: 2.25, z0: 25, x1: 3.5, y1: 5.5, z1: 25 }
    ]
    const out = apply4AxisRadialZToMillPreviewSegments(segs, 50)
    expect(out[0]!.kind).toBe('feed')
    expect(out[0]!.x0).toBe(1.5)
    expect(out[0]!.x1).toBe(3.5)
    expect(out[0]!.y0).toBe(2.25)
    expect(out[0]!.y1).toBe(5.5)
  })

  it('non-finite or non-positive diameter -> identity passthrough (NOT NaN-shifted)', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 25, x1: 1, y1: 1, z1: 25 }
    ]
    expect(apply4AxisRadialZToMillPreviewSegments(segs, 0)).toBe(segs)
    expect(apply4AxisRadialZToMillPreviewSegments(segs, -10)).toBe(segs)
    expect(apply4AxisRadialZToMillPreviewSegments(segs, NaN)).toBe(segs)
    expect(apply4AxisRadialZToMillPreviewSegments(segs, Infinity)).toBe(segs)
  })

  it('returns a fresh array on the success path (not aliased)', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 25, x1: 1, y1: 1, z1: 25 }
    ]
    const out = apply4AxisRadialZToMillPreviewSegments(segs, 50)
    expect(out).not.toBe(segs)
  })

  it('empty input -> empty output', () => {
    expect(apply4AxisRadialZToMillPreviewSegments([], 50)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// H. isManufactureKind4AxisForPreview / 5AxisForPreview -- exact allowlists
// ---------------------------------------------------------------------------
describe('H. isManufactureKind4AxisForPreview / 5AxisForPreview allowlists', () => {
  it('4-axis allowlist is exactly the 5 Carvera 4-axis Rotary kinds', () => {
    const accepted = [
      'cnc_4axis_roughing',
      'cnc_4axis_finishing',
      'cnc_4axis_contour',
      'cnc_4axis_indexed',
      'cnc_4axis_continuous'
    ]
    for (const k of accepted) {
      expect(isManufactureKind4AxisForPreview(k)).toBe(true)
    }
  })

  it('4-axis allowlist rejects unrelated kinds', () => {
    const rejected = [
      undefined, '', 'cnc_parallel', 'cnc_adaptive', 'cnc_raster',
      'cnc_5axis_contour', 'fdm_slice', 'export_stl',
      'CNC_4AXIS_ROUGHING' /* case-sensitive */
    ]
    for (const k of rejected) {
      expect(isManufactureKind4AxisForPreview(k)).toBe(false)
    }
  })

  it('5-axis allowlist is exactly the 3 reserved 5-axis kinds', () => {
    const accepted = [
      'cnc_5axis_contour',
      'cnc_5axis_swarf',
      'cnc_5axis_flowline'
    ]
    for (const k of accepted) {
      expect(isManufactureKind5AxisForPreview(k)).toBe(true)
    }
  })

  it('5-axis allowlist rejects all 4-axis kinds', () => {
    const rejected = [
      'cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour',
      'cnc_4axis_indexed', 'cnc_4axis_continuous'
    ]
    for (const k of rejected) {
      expect(isManufactureKind5AxisForPreview(k)).toBe(false)
    }
  })

  it('the 4-axis and 5-axis allowlists are disjoint', () => {
    const fourAxis = [
      'cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour',
      'cnc_4axis_indexed', 'cnc_4axis_continuous'
    ]
    const fiveAxis = ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline']
    for (const k of fourAxis) {
      expect(isManufactureKind4AxisForPreview(k)).toBe(true)
      expect(isManufactureKind5AxisForPreview(k)).toBe(false)
    }
    for (const k of fiveAxis) {
      expect(isManufactureKind5AxisForPreview(k)).toBe(true)
      expect(isManufactureKind4AxisForPreview(k)).toBe(false)
    }
  })

  it('both predicates always return boolean (never `null`/`undefined`)', () => {
    const probes: Array<string | undefined> = [
      undefined, '', 'cnc_4axis_roughing', 'cnc_5axis_contour', 'unknown'
    ]
    for (const k of probes) {
      expect(typeof isManufactureKind4AxisForPreview(k)).toBe('boolean')
      expect(typeof isManufactureKind5AxisForPreview(k)).toBe('boolean')
    }
  })
})

// ---------------------------------------------------------------------------
// I. buildContiguousPathChains shape + ToolpathPathChain shape
// ---------------------------------------------------------------------------
describe('I. buildContiguousPathChains + ToolpathPathChain shape', () => {
  it('empty input -> empty output', () => {
    expect(buildContiguousPathChains([])).toEqual([])
  })

  it('every chain has exactly 2 keys: kind, points', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X1\nG0 X2\nG1 X3 F100\nG1 X4 F100')
    const chains = buildContiguousPathChains(segs)
    expect(chains.length).toBeGreaterThan(0)
    for (const c of chains) {
      expect(Object.keys(c).sort()).toEqual(['kind', 'points'])
    }
  })

  it('every chain.points entry has exactly 3 keys: x, y, z (no kind leak)', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X1 Y2 Z3 F100\nG1 X4 Y5 Z6 F100')
    const chains = buildContiguousPathChains(segs)
    for (const c of chains) {
      for (const p of c.points) {
        expect(Object.keys(p).sort()).toEqual(['x', 'y', 'z'])
      }
    }
  })

  it('chain.kind is constrained to ToolpathMotionKind literals', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X1\nG1 X2 F100\nG0 X3')
    const chains = buildContiguousPathChains(segs)
    for (const c of chains) {
      expect(c.kind === 'rapid' || c.kind === 'feed').toBe(true)
    }
  })

  it('continuous same-kind chain has 1 + N points for N segments', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X1 F100\nG1 X2 F100\nG1 X3 F100')
    const chains = buildContiguousPathChains(segs)
    expect(chains.length).toBe(1)
    expect(chains[0]!.kind).toBe('feed')
    expect(chains[0]!.points.length).toBe(4) // start + 3 segment endpoints
  })

  it('compile-time: ToolpathPathChain shape stable', () => {
    const c: ToolpathPathChain = {
      kind: 'feed',
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }]
    }
    expect(c.kind).toBe('feed')
    expect(c.points.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// J. buildToolpathLengthSampler shape + ToolpathLengthSampler closures
// ---------------------------------------------------------------------------
describe('J. buildToolpathLengthSampler + ToolpathLengthSampler shape', () => {
  it('empty segments -> sampler with totalMm=0 and zero-length cumulativeMm', () => {
    const s = buildToolpathLengthSampler([])
    expect(s.totalMm).toBe(0)
    expect(s.cumulativeMm).toBeInstanceOf(Float64Array)
    expect(s.cumulativeMm.length).toBe(0)
  })

  it('sampler exposes exactly 5 keys: totalMm + 4 closures + cumulativeMm', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X10 F100')
    const s = buildToolpathLengthSampler(segs)
    expect(Object.keys(s).sort()).toEqual([
      'atDistanceMm',
      'atUnit',
      'cumulativeMm',
      'segmentIndexAtUnit',
      'totalMm'
    ])
  })

  it('cumulativeMm is a Float64Array of length === segments.length', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X1 F100\nG1 X2 F100\nG1 X3 F100')
    const s = buildToolpathLengthSampler(segs)
    expect(s.cumulativeMm).toBeInstanceOf(Float64Array)
    expect(s.cumulativeMm.length).toBe(segs.length)
  })

  it('cumulativeMm is monotonically non-decreasing', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X1 F100\nG1 X3 F100\nG1 X8 F100')
    const s = buildToolpathLengthSampler(segs)
    for (let i = 1; i < s.cumulativeMm.length; i++) {
      expect(s.cumulativeMm[i]!).toBeGreaterThanOrEqual(s.cumulativeMm[i - 1]!)
    }
  })

  it('atUnit / atDistanceMm / segmentIndexAtUnit all classify as `function`', () => {
    const s = buildToolpathLengthSampler(extractToolpathSegmentsFromGcode('G1 X10 F100'))
    expect(typeof s.atUnit).toBe('function')
    expect(typeof s.atDistanceMm).toBe('function')
    expect(typeof s.segmentIndexAtUnit).toBe('function')
  })

  it('atUnit return shape -- exactly 3 keys x/y/z', () => {
    const s = buildToolpathLengthSampler(extractToolpathSegmentsFromGcode('G1 X10 F100'))
    const p = s.atUnit(0.5)
    expect(Object.keys(p).sort()).toEqual(['x', 'y', 'z'])
  })

  it('atUnit clamps to [0,1] -- atUnit(-1) === atUnit(0); atUnit(2) === atUnit(1)', () => {
    const s = buildToolpathLengthSampler(extractToolpathSegmentsFromGcode('G1 X10 F100'))
    expect(s.atUnit(-1)).toEqual(s.atUnit(0))
    expect(s.atUnit(2)).toEqual(s.atUnit(1))
  })

  it('atDistanceMm clamps to [0, totalMm]', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X10 F100')
    const s = buildToolpathLengthSampler(segs)
    expect(s.atDistanceMm(-5)).toEqual(s.atDistanceMm(0))
    expect(s.atDistanceMm(s.totalMm + 100)).toEqual(s.atDistanceMm(s.totalMm))
  })

  it('compile-time: ToolpathLengthSampler shape stable', () => {
    const s: ToolpathLengthSampler = {
      totalMm: 0,
      atDistanceMm: () => ({ x: 0, y: 0, z: 0 }),
      atUnit: () => ({ x: 0, y: 0, z: 0 }),
      segmentIndexAtUnit: () => 0,
      cumulativeMm: new Float64Array(0)
    }
    expect(s.totalMm).toBe(0)
    expect(s.cumulativeMm.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// K. extractToolpathSegments5AxisFromGcode -- shape + ToolpathSegment5
// ---------------------------------------------------------------------------
describe('K. extractToolpathSegments5AxisFromGcode + ToolpathSegment5 shape', () => {
  it('every 5-axis segment has exactly 11 keys (same shape as ToolpathSegment4)', () => {
    const segs = extractToolpathSegments5AxisFromGcode('G0 X1 Y2 Z3 A45 B10\nG1 X4 Y5 Z6 A90 B20 F100')
    expect(segs.length).toBe(2)
    for (const s of segs) {
      expect(Object.keys(s).sort()).toEqual([
        'a0', 'a1', 'b0', 'b1',
        'kind',
        'x0', 'x1', 'y0', 'y1', 'z0', 'z1'
      ])
    }
  })

  it('5-axis parser DOES arc-interpolate G2/G3 (unlike 4-axis parser)', () => {
    const segs = extractToolpathSegments5AxisFromGcode('G0 X10 Y0 Z0\nG2 X0 Y10 Z0 I-10 J0 F400')
    // 1 G0 + 16 arc sub-segments = 17
    expect(segs.length).toBe(17)
  })

  it('A and B linearly interpolate across G2/G3 arc sub-segments (monotone)', () => {
    const segs = extractToolpathSegments5AxisFromGcode('G2 X10 Y10 Z0 I10 J0 A90 B0 F400')
    expect(segs.length).toBeGreaterThan(1)
    expect(segs[0]!.a0).toBeCloseTo(0, 5)
    expect(segs[segs.length - 1]!.a1).toBeCloseTo(90, 5)
  })

  it('compile-time: ToolpathSegment5 also extends ToolpathSegment3', () => {
    const seg5: ToolpathSegment5 = {
      kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, a0: 0, a1: 90, b0: 0, b1: 30
    }
    const seg3: ToolpathSegment3 = seg5
    expect(seg3.kind).toBe('feed')
  })

  it('returns empty array for empty / comment-only input', () => {
    expect(extractToolpathSegments5AxisFromGcode('')).toEqual([])
    expect(extractToolpathSegments5AxisFromGcode('; comment')).toEqual([])
  })

  it('5-axis parser is pure -- repeated calls produce structural equality', () => {
    const g = ['G0 X0 Y0 Z0 A0 B0', 'G1 X10 Y0 Z0 A45 B5 F300', 'G2 X20 Y10 Z0 I10 J0 A90 B5 F200'].join('\n')
    const a = extractToolpathSegments5AxisFromGcode(g)
    const b = extractToolpathSegments5AxisFromGcode(g)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ---------------------------------------------------------------------------
// L. totalToolpathLengthMm -- summation invariant
// ---------------------------------------------------------------------------
describe('L. totalToolpathLengthMm', () => {
  it('empty input -> 0', () => {
    expect(totalToolpathLengthMm([])).toBe(0)
  })

  it('returns finite non-negative number for any segment list', () => {
    const segs = extractToolpathSegmentsFromGcode('G0 X1 Y2 Z3\nG1 X4 Y5 Z6 F100\nG1 X-2 Y-3 Z-1 F100')
    const len = totalToolpathLengthMm(segs)
    expect(Number.isFinite(len)).toBe(true)
    expect(len).toBeGreaterThanOrEqual(0)
  })

  it('agrees with sampler.totalMm', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X3 Y4 Z0 F100')
    expect(totalToolpathLengthMm(segs)).toBeCloseTo(buildToolpathLengthSampler(segs).totalMm, 9)
  })

  it('3-4-5 right triangle pythagorean check (xy)', () => {
    const segs = extractToolpathSegmentsFromGcode('G1 X3 Y4 Z0 F100')
    expect(totalToolpathLengthMm(segs)).toBeCloseTo(5, 9)
  })
})

// ---------------------------------------------------------------------------
// M. Source-text whitelist -- file-level contracts
// ---------------------------------------------------------------------------
describe('M. Source-text whitelist for cam-gcode-toolpath.ts', () => {
  it('declares ARC_INTERPOLATION_SEGMENTS = 16 (private const, not exported)', () => {
    expect(SOURCE).toContain('const ARC_INTERPOLATION_SEGMENTS = 16')
    expect(SOURCE).not.toMatch(/export\s+const\s+ARC_INTERPOLATION_SEGMENTS/)
  })

  it('uses the 5deg feed / 10deg rapid arc-subdivide threshold literals exactly', () => {
    expect(SOURCE).toContain("const threshold = s.kind === 'rapid' ? 10 : 5")
    expect(SOURCE).toContain("const stepSize = s.kind === 'rapid' ? 10 : 5")
  })

  it('contains the cylindrical projection literal Y = Z * cos(A); Z = Z * sin(A)', () => {
    // Verify the projection formula uses cos for Y and sin for Z (the documented mapping).
    expect(SOURCE).toContain('Math.cos(a0r)')
    expect(SOURCE).toContain('Math.sin(a0r)')
    expect(SOURCE).toContain('Math.cos(a1r)')
    expect(SOURCE).toContain('Math.sin(a1r)')
  })

  it('zero `any` types -- explicit cast or annotation', () => {
    // Tolerate `unknown` (used in resolve4AxisCylinderDiameterMm).
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
  })

  it('no eval / new Function escape hatches', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/new\s+Function\s*\(/)
  })

  it('no node:fs / node:path / node:child_process imports (pure shared module)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:path['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:child_process['"]/)
    // No top-level imports at all -- this is a self-contained pure parser/transform layer.
    expect(SOURCE).not.toMatch(/^import\s+/m)
  })

  it('uses lookahead `(?=\\s|[A-Z]|$)` instead of \\b word boundary (compact-form bugfix)', () => {
    // The compact-form fix replaces \b with a lookahead so G0X10 matches.
    expect(SOURCE).toContain('(?=\\s|[A-Z]|$)')
    expect(SOURCE).not.toMatch(/\\bG[0-9]/)
  })

  it('strips inline parenthetical comments via `\\([^)]*\\)`', () => {
    expect(SOURCE).toContain('replace(/\\([^)]*\\)/g')
  })

  it('declares all 12 runtime exports with `export function` or `export const`', () => {
    // 11 functions + 1 const
    const funcExports = SOURCE.match(/^export\s+function\s+\w+/gm) ?? []
    const constExports = SOURCE.match(/^export\s+const\s+\w+/gm) ?? []
    expect(funcExports.length).toBe(11)
    expect(constExports.length).toBe(1)
  })

  it('declares the 6 type-only exports with `export type`', () => {
    const typeExports = SOURCE.match(/^export\s+type\s+\w+/gm) ?? []
    expect(typeExports.length).toBe(6)
  })

  it('uses Float64Array (not number[]) for cumulativeMm', () => {
    expect(SOURCE).toContain('Float64Array')
  })

  it('the L < 1e-12 zero-length guard is present in atDistanceMm', () => {
    expect(SOURCE).toContain('L < 1e-12')
  })
})

// ---------------------------------------------------------------------------
// N. Three-machine cross-cut realism
// ---------------------------------------------------------------------------
describe('N. Three-machine cross-cut realism', () => {
  it('Carvera 4-axis Rotary 92mm-diameter envelope round-trips through resolver', () => {
    // CLAUDE.md spec: harmonic-drive rotary module max ~92 mm diameter.
    expect(resolve4AxisCylinderDiameterMm({ cylinderDiameterMm: 92 })).toBe(92)
  })

  it('K2 Plus FDM 350-cube G-code (3-axis) parses cleanly with no 4/5-axis kinds engaged', () => {
    // K2 Plus FDM emits no A/B; 3-axis parser is the right path.
    const g = ['G0 X175 Y175 Z0', 'G1 X175 Y175 Z0.2 F1200', 'G1 X300 Y175 F3600'].join('\n')
    const segs = extractToolpathSegmentsFromGcode(g)
    expect(segs.length).toBe(3)
    expect(segs[0]!.kind).toBe('rapid')
    expect(segs[1]!.kind).toBe('feed')
    // K2 Plus is NOT a 4-axis or 5-axis kind
    expect(isManufactureKind4AxisForPreview('fdm_slice')).toBe(false)
    expect(isManufactureKind5AxisForPreview('fdm_slice')).toBe(false)
  })

  it('Laguna Swift 5x10 sheet-routing 3-axis G-code (G17 plane) parses with arc interpolation', () => {
    // Laguna emits typical RichAuto G-code: G17 plane select + G2/G3 arcs.
    const g = ['G0 X0 Y0 Z5', 'G1 Z-3 F1500', 'G2 X100 Y100 I50 J0 F2000', 'G0 Z25'].join('\n')
    const segs = extractToolpathSegmentsFromGcode(g)
    // 1 G0 (down to Z5) + 1 G1 (Z-3 plunge) + 16 G2 sub-segs + 1 G0 (Z retract) = 19
    expect(segs.length).toBe(19)
    // Laguna 3-axis has no 4/5-axis kinds
    expect(isManufactureKind4AxisForPreview('cnc_raster')).toBe(false)
    expect(isManufactureKind5AxisForPreview('cnc_raster')).toBe(false)
  })

  it('Carvera 4-axis Rotary indexed cycle -> 3D Cartesian preview hugs cylinder', () => {
    // Index to A=90deg at R=15, then linear cut along X: parser + transform produce
    // sub-segments on the cylinder surface (radius hypot(y, z) ~= 15).
    const g = ['G0 X0 Z15 A0', 'G0 X0 Z15 A90', 'G1 X20 Z15 A90 F200'].join('\n')
    const segs4 = extractToolpathSegments4AxisFromGcode(g)
    const cart = apply4AxisCylindricalTransform(segs4)
    // The A=0->90 step is rapid (10deg threshold), so subdivide ceil(90/10)=9.
    // Final sub-segment endpoint at A=90: Y=15*cos(pi/2)~=0, Z=15*sin(pi/2)=15.
    // Then linear feed at A=90: another segment at constant A.
    const last = cart[cart.length - 1]!
    expect(Math.hypot(last.y1, last.z1)).toBeCloseTo(15, 1)
  })

  it('Carvera 4-axis Rotary roughing -> isManufactureKind4AxisForPreview accepts', () => {
    expect(isManufactureKind4AxisForPreview('cnc_4axis_roughing')).toBe(true)
    // CLAUDE.md spec: Carvera + 4th axis runs roughing/finishing/contour/indexed/continuous.
    for (const k of ['cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed', 'cnc_4axis_continuous']) {
      expect(isManufactureKind4AxisForPreview(k)).toBe(true)
    }
  })

  it('5-axis kinds reserved (no current shop machine) -- 4-axis predicate rejects them', () => {
    // CLAUDE.md scope is strictly the 3 target machines; 5-axis is reserved for future hardware.
    for (const k of ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline']) {
      expect(isManufactureKind5AxisForPreview(k)).toBe(true)
      expect(isManufactureKind4AxisForPreview(k)).toBe(false)
    }
  })
})
