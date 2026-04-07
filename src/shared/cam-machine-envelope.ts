import { extractToolpathSegmentsFromGcode, type ToolpathSegment3 } from './cam-gcode-toolpath'

export type MachineEnvelopeBoundsGcode = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export type MachineEnvelopeViolation = {
  axis: 'x' | 'y' | 'z'
  kind: 'below_min' | 'above_max'
  /** Positive distance outside the allowed range (mm). */
  excessMm: number
}

export type MachineEnvelopeCheck = {
  withinEnvelope: boolean
  bounds: MachineEnvelopeBoundsGcode | null
  violations: MachineEnvelopeViolation[]
}

/**
 * Axis extents of all segment endpoints in G-code coordinates (mm).
 */
export function computeToolpathBoundsFromSegments(segments: ToolpathSegment3[]): MachineEnvelopeBoundsGcode | null {
  if (segments.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const consider = (x: number, y: number, z: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  for (const s of segments) {
    consider(s.x0, s.y0, s.z0)
    consider(s.x1, s.y1, s.z1)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

/**
 * Compare parsed toolpath bounds to machine profile work volume [0, wx] × [0, wy] × [0, wz] in the same G-code space.
 * Does not model fixtures, WCS offsets, or rotary axes — profile-based orientation only.
 */
export function compareToolpathToMachineEnvelope(
  segments: ToolpathSegment3[],
  workAreaMm: { x: number; y: number; z: number }
): MachineEnvelopeCheck {
  const bounds = computeToolpathBoundsFromSegments(segments)
  if (!bounds) {
    return { withinEnvelope: true, bounds: null, violations: [] }
  }

  const violations: MachineEnvelopeViolation[] = []
  const { x: wx, y: wy, z: wz } = workAreaMm

  if (bounds.minX < 0) violations.push({ axis: 'x', kind: 'below_min', excessMm: -bounds.minX })
  if (bounds.maxX > wx) violations.push({ axis: 'x', kind: 'above_max', excessMm: bounds.maxX - wx })
  if (bounds.minY < 0) violations.push({ axis: 'y', kind: 'below_min', excessMm: -bounds.minY })
  if (bounds.maxY > wy) violations.push({ axis: 'y', kind: 'above_max', excessMm: bounds.maxY - wy })
  if (bounds.minZ < 0) violations.push({ axis: 'z', kind: 'below_min', excessMm: -bounds.minZ })
  if (bounds.maxZ > wz) violations.push({ axis: 'z', kind: 'above_max', excessMm: bounds.maxZ - wz })

  return {
    withinEnvelope: violations.length === 0,
    bounds,
    violations
  }
}

/**
 * After posting, parse emitted G-code and warn if XYZ extents exceed the machine profile
 * work volume [0, wx]×[0, wy]×[0, wz] (same assumptions as {@link compareToolpathToMachineEnvelope}).
 */
export function formatMachineEnvelopeHintForPostedGcode(
  gcode: string,
  workAreaMm: { x: number; y: number; z: number }
): string {
  if (!gcode.trim()) return ''
  const segs = extractToolpathSegmentsFromGcode(gcode)
  const ch = compareToolpathToMachineEnvelope(segs, workAreaMm)
  if (ch.withinEnvelope || ch.violations.length === 0) return ''
  const parts = ch.violations.map((v) => {
    const ax = v.axis.toUpperCase()
    if (v.kind === 'below_min') {
      return `${ax} below machine origin (~${v.excessMm.toFixed(1)} mm outside)`
    }
    return `${ax} past work volume max (~${v.excessMm.toFixed(1)} mm outside)`
  })
  return ` Machine work volume warning: ${parts.join('; ')}. Confirm WCS vs profile workAreaMm — docs/MACHINES.md.`
}

/**
 * Max distance from the X axis in the YZ plane (mm) over segment endpoints — for 4-axis radial sanity vs nominal stock Ø.
 */
export function maxRadialExtentYZFromSegments(segments: ToolpathSegment3[]): number {
  let m = 0
  for (const s of segments) {
    m = Math.max(m, Math.hypot(s.y0, s.z0), Math.hypot(s.y1, s.z1))
  }
  return m
}

/** Soft warning when parsed YZ extent exceeds nominal cylinder radius (same WCS as posted G-code). */
export function formatRotaryRadialHintForPostedGcode(gcode: string, stockCylinderDiameterMm: number): string {
  if (!gcode.trim() || !(stockCylinderDiameterMm > 0)) return ''
  const segs = extractToolpathSegmentsFromGcode(gcode)
  const R = stockCylinderDiameterMm * 0.5
  const maxR = maxRadialExtentYZFromSegments(segs)
  if (maxR <= R + 0.5) return ''
  return ` Rotary radial hint: YZ toolpath reach ~${maxR.toFixed(1)} mm vs nominal stock radius ${R.toFixed(1)} mm (Ø${stockCylinderDiameterMm.toFixed(1)}). Confirm stock diameter and WCS — docs/MACHINES.md.`
}
