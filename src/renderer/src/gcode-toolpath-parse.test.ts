import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  AXIS_Y_VIEW,
  extractFourAxisToolpathSection,
  gcodeLooksLikeRotaryFourAxis,
  mapGcodeToThreeEndpoints,
  parseGcodeToolpath,
  stripLeadingLineNumber
} from './gcode-toolpath-parse'

describe('stripLeadingLineNumber', () => {
  it('removes N-prefixed line numbers', () => {
    expect(stripLeadingLineNumber('N120 G0 A45')).toBe('G0 A45')
    expect(stripLeadingLineNumber('  N10  G1 X1')).toBe('G1 X1')
  })
})

describe('gcodeLooksLikeRotaryFourAxis', () => {
  it('detects A= in axis4 engine comments', () => {
    expect(gcodeLooksLikeRotaryFourAxis('; Pass 3  A=15.00°')).toBe(true)
  })
})

describe('extractFourAxisToolpathSection', () => {
  it('returns only the marked block when present', () => {
    const full = `G0 Z999
; --- 4-axis toolpath moves begin (X Y Z A words) ---
G0 Z30
G0 A45
; --- end toolpath ---
G0 X0`
    const s = extractFourAxisToolpathSection(full)
    expect(s).toContain('G0 Z30')
    expect(s).toContain('G0 A45')
    expect(s).not.toContain('Z999')
    expect(s).not.toContain('G0 X0')
  })

  it('returns full text when markers missing', () => {
    const t = 'G90\nG0 X1'
    expect(extractFourAxisToolpathSection(t)).toBe(t)
  })
})

describe('mapGcodeToThreeEndpoints', () => {
  it('rotates radial Z around X by A (contour-style X+A move)', () => {
    const stockLenMm = 100
    const { a: p0, b: p1 } = mapGcodeToThreeEndpoints(
      true,
      true,
      stockLenMm,
      0,
      0,
      25,
      0,
      10,
      0,
      25,
      90
    )
    expect(p0.x).toBeCloseTo(-50)
    expect(p0.y).toBeCloseTo(AXIS_Y_VIEW + 25)
    expect(p0.z).toBeCloseTo(0)
    expect(p1.x).toBeCloseTo(-40)
    expect(p1.y).toBeCloseTo(AXIS_Y_VIEW)
    expect(p1.z).toBeCloseTo(25)
  })
})

describe('parseGcodeToolpath', () => {
  it('emits a segment for A-only motion after Z is set', () => {
    const g = `G90
G0 Z30
G0 A45`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    expect(geo.stats.rapids).toBeGreaterThanOrEqual(2)
  })

  it('parses compact G0A45 (no space before A)', () => {
    const g = `G90
G0 Z30
G0A45`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    expect(geo.stats.rapids).toBeGreaterThanOrEqual(2)
  })

  it('auto-detects rotary from A words when fourAxis UI flag is false', () => {
    const g = `G90
G0 Z30
G0 A45`
    const geo = parseGcodeToolpath(g, { fourAxis: false, stockLenMm: 100 })
    expect(geo.stats.rapids).toBeGreaterThanOrEqual(2)
  })

  it('parses N-prefixed motion lines so modal A applies to following G1', () => {
    const g = `G90
N10 G0 Z30
N20 G0 A90
N30 G1 X50 Z30 F600`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    expect(geo.stats.cuts).toBe(1)
    const pos = geo.cuts.getAttribute('position') as THREE.BufferAttribute
    // A=90°, r=30 → Three Y = AXIS_Y_VIEW + 30*cos(90°) = 55 (not 85 at A=0)
    expect(pos.getY(0)).toBeCloseTo(AXIS_Y_VIEW)
    expect(pos.getY(0)).not.toBeCloseTo(AXIS_Y_VIEW + 30)
  })

  it('emits arc-interpolated segments for G0 A when A changes from zero on second line', () => {
    const g = `G90
G0 A0
G0 A45`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    // 45° change is > 10° threshold → interpolated into ceil(45/10)=5 arc segments
    expect(geo.stats.rapids).toBeGreaterThanOrEqual(5)
  })

  it('places G1 X+A cut off the meridian with arc interpolation (varying Three Z)', () => {
    const g = `G90
G0 X0 Z25 A0
G1 X10 Z25 A90 F800`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    // 90° A change → interpolated into ceil(90/5)=18 arc segments for smooth cylinder visualization
    expect(geo.stats.cuts).toBeGreaterThanOrEqual(18)
    const pos = geo.cuts.getAttribute('position')
    expect(pos).toBeInstanceOf(THREE.BufferAttribute)
    // Arc-interpolated segments should span the full Three.js Z range (cylinder wrapping)
    const zValues: number[] = []
    for (let i = 0; i < pos!.count; i++) {
      zValues.push((pos as THREE.BufferAttribute).getZ(i))
    }
    const zRange = Math.max(...zValues) - Math.min(...zValues)
    expect(zRange).toBeGreaterThan(1)
  })

  it('ignores centering offset comment and uses AXIS_Y_VIEW for axis position', () => {
    // The centering comment contains the mesh centering shift (how much the
    // mesh was moved to center it on the rotation axis).  These are small
    // STL-space values and must NOT be used as the Three.js axis position.
    // The axis must stay at AXIS_Y_VIEW (55mm) to match the 4-axis rig.
    const g = `; 4-axis cylindrical MESH raster
; Auto-centered mesh: offset Y=0.50 Z=-2.30, mesh radial range=5.00..12.50mm
G90
G0 Z25 A0
G1 X10 Z25 A0 F800`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    expect(geo.stats.cuts).toBe(1)
    const pos = geo.cuts.getAttribute('position') as THREE.BufferAttribute
    // At A=0, Three.js Y = AXIS_Y_VIEW + r*cos(0) = 55 + 25 = 80
    // If the bug were present, it would be 0.50 + 25 = 25.50
    expect(pos.getY(0)).toBeCloseTo(AXIS_Y_VIEW + 25)
    expect(pos.getY(1)).toBeCloseTo(AXIS_Y_VIEW + 25)
    // Three.js Z = axisZ + r*sin(0) = 0 + 0 = 0 (not -2.30)
    expect(pos.getZ(0)).toBeCloseTo(0)
  })

  it('does not use rotary cylindrical map without A words (flat 4-axis preview)', () => {
    const g = `G90
G0 X0 Z30
G1 X50 Z30 F600`
    const geo = parseGcodeToolpath(g, { fourAxis: true, stockLenMm: 100 })
    const pos = geo.cuts.getAttribute('position')
    expect(pos).toBeInstanceOf(THREE.BufferAttribute)
    if ((pos as THREE.BufferAttribute).count >= 2) {
      const z0 = (pos as THREE.BufferAttribute).getZ(0)
      const z1 = (pos as THREE.BufferAttribute).getZ(1)
      expect(z0).toBeCloseTo(z1)
    }
  })
})
