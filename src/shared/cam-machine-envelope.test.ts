import { describe, expect, it } from 'vitest'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'
import {
  compareToolpathToMachineEnvelope,
  computeToolpathBoundsFromSegments,
  formatMachineEnvelopeHintForPostedGcode,
  formatRotaryRadialHintForPostedGcode,
  maxRadialExtentYZFromSegments
} from './cam-machine-envelope'

const box = { x: 100, y: 80, z: 50 }

describe('computeToolpathBoundsFromSegments', () => {
  it('returns null for empty segments', () => {
    expect(computeToolpathBoundsFromSegments([])).toBeNull()
  })

  it('bounds all endpoints', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 0, x1: 10, y1: 5, z1: -2 },
      { kind: 'feed', x0: 10, y0: 5, z0: -2, x1: 10, y1: 5, z1: -5 }
    ]
    expect(computeToolpathBoundsFromSegments(segs)).toEqual({
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 5,
      minZ: -5,
      maxZ: 0
    })
  })

  it('returns null when segment endpoints are non-finite (NaN coordinates)', () => {
    // Segments with NaN coordinates produce Infinity min / -Infinity max, which
    // are non-finite. The `if (!Number.isFinite(minX)) return null` guard must fire.
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: NaN, y0: NaN, z0: NaN, x1: NaN, y1: NaN, z1: NaN }
    ]
    expect(computeToolpathBoundsFromSegments(segs)).toBeNull()
  })
})

describe('compareToolpathToMachineEnvelope', () => {
  it('returns within=true and null bounds for empty segment list', () => {
    const r = compareToolpathToMachineEnvelope([], box)
    expect(r.withinEnvelope).toBe(true)
    expect(r.bounds).toBeNull()
    expect(r.violations).toHaveLength(0)
  })

  it('is within when path stays in box', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 10, x1: 50, y1: 40, z1: 10 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(true)
    expect(r.violations).toHaveLength(0)
    expect(r.bounds?.maxX).toBe(50)
  })

  it('flags X above max', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 0, x1: 120, y1: 10, z1: 10 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'x' && v.kind === 'above_max')).toBe(true)
    expect(r.violations.find((v) => v.axis === 'x' && v.kind === 'above_max')?.excessMm).toBeCloseTo(20)
  })

  it('flags negative Y', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 10, y0: 0, z0: 5, x1: 10, y1: -3, z1: 5 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'y' && v.kind === 'below_min')).toBe(true)
  })

  it('flags X below machine origin (negative X)', () => {
    // Move from X=10 to X=-5 — negative X is below machine origin (0)
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 10, y0: 5, z0: 5, x1: -5, y1: 5, z1: 5 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    const xViolation = r.violations.find((v) => v.axis === 'x' && v.kind === 'below_min')
    expect(xViolation).toBeDefined()
    expect(xViolation?.excessMm).toBeCloseTo(5, 5)
  })

  it('flags Y past work area max', () => {
    // box.y = 80; move to Y=90 exceeds max
    const segs: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 5, y0: 0, z0: 5, x1: 5, y1: 90, z1: 5 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    const yViolation = r.violations.find((v) => v.axis === 'y' && v.kind === 'above_max')
    expect(yViolation).toBeDefined()
    expect(yViolation?.excessMm).toBeCloseTo(10, 5)
  })
})

describe('compareToolpathToMachineEnvelope — Z axis', () => {
  it('flags Z below zero (below machine origin)', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 5, x1: 0, y1: 0, z1: -2 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'z' && v.kind === 'below_min')).toBe(true)
    expect(r.violations.find((v) => v.axis === 'z')?.excessMm).toBeCloseTo(2, 5)
  })

  it('flags Z above work area max', () => {
    // box.z = 50; move to Z=60 exceeds max
    const segs: ToolpathSegment3[] = [
      { kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 0, y1: 0, z1: 60 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'z' && v.kind === 'above_max')).toBe(true)
    expect(r.violations.find((v) => v.axis === 'z' && v.kind === 'above_max')?.excessMm).toBeCloseTo(10, 5)
  })

  it('accumulates violations from multiple axes simultaneously', () => {
    // X at 120 (>100), Y at -5 (<0), Z at -1 (<0)
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 5, x1: 120, y1: -5, z1: -1 }
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    const axes = r.violations.map((v) => v.axis)
    expect(axes).toContain('x')
    expect(axes).toContain('y')
    expect(axes).toContain('z')
    expect(r.violations.length).toBeGreaterThanOrEqual(3)
  })
})

describe('formatMachineEnvelopeHintForPostedGcode', () => {
  it('returns empty when within work volume', () => {
    const g = `G0 X0 Y0 Z5\nG1 X10 Y10 Z5 F1000`
    expect(formatMachineEnvelopeHintForPostedGcode(g, { x: 100, y: 100, z: 50 })).toBe('')
  })

  it('appends hint when X exceeds workAreaMm', () => {
    const g = `G0 X0 Y0 Z5\nG1 X150 Y10 Z5 F1000`
    const h = formatMachineEnvelopeHintForPostedGcode(g, { x: 100, y: 80, z: 50 })
    expect(h).toContain('Machine work volume warning')
    expect(h).toContain('X')
    expect(h).toContain('MACHINES')
  })

  it('returns empty string for empty gcode', () => {
    expect(formatMachineEnvelopeHintForPostedGcode('', { x: 100, y: 100, z: 50 })).toBe('')
    expect(formatMachineEnvelopeHintForPostedGcode('   ', { x: 100, y: 100, z: 50 })).toBe('')
  })

  it('reports Z violation in hint message', () => {
    // Z=60 in a 50mm-tall machine
    const g = `G0 X5 Y5 Z60`
    const h = formatMachineEnvelopeHintForPostedGcode(g, { x: 100, y: 80, z: 50 })
    expect(h).toContain('Machine work volume warning')
    expect(h).toContain('Z')
  })
})

describe('rotary radial YZ hints', () => {
  it('maxRadialExtentYZFromSegments uses hypot on endpoints', () => {
    const segs = [{ kind: 'feed' as const, x0: 0, y0: 30, z0: 40, x1: 0, y1: 30, z1: 40 }]
    expect(maxRadialExtentYZFromSegments(segs)).toBeCloseTo(50, 5)
  })

  it('maxRadialExtentYZFromSegments returns 0 for empty segments', () => {
    expect(maxRadialExtentYZFromSegments([])).toBe(0)
  })

  it('formatRotaryRadialHintForPostedGcode warns when YZ exceeds nominal radius', () => {
    const g = `G1 X0 Y30 Z40 F1000`
    const h = formatRotaryRadialHintForPostedGcode(g, 80)
    expect(h).toContain('Rotary radial')
    expect(h).toContain('MACHINES')
  })

  it('formatRotaryRadialHintForPostedGcode returns empty when within nominal radius', () => {
    // YZ radius ≈ 5, stock diameter 80 (radius 40) — well within
    const g = `G1 X0 Y3 Z4 F1000`
    expect(formatRotaryRadialHintForPostedGcode(g, 80)).toBe('')
  })

  it('formatRotaryRadialHintForPostedGcode returns empty for empty gcode', () => {
    expect(formatRotaryRadialHintForPostedGcode('', 80)).toBe('')
    expect(formatRotaryRadialHintForPostedGcode('   ', 80)).toBe('')
  })

  it('formatRotaryRadialHintForPostedGcode returns empty for zero diameter', () => {
    const g = `G1 X0 Y30 Z40 F1000`
    expect(formatRotaryRadialHintForPostedGcode(g, 0)).toBe('')
  })
})
