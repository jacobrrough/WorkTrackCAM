/**
 * Lightweight G0/G1/G2/G3 parser for CAM preview (absolute XYZ, mm-style numbers).
 * Ignores canned cycles and non-motion blocks — use for toolpath / 2.5D proxy only.
 */

export type ToolpathMotionKind = 'rapid' | 'feed'

export type ToolpathSegment3 = {
  kind: ToolpathMotionKind
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

function readAxis(line: string, axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'I' | 'J'): number | null {
  // Strip inline parenthetical comments before matching — avoids false hits like
  // "G1 X10 (move Y-5 to ref) Y20" returning Y=-5 from inside the comment.
  const clean = line.replace(/\([^)]*\)/g, '')
  // Allow an explicit leading '+' in addition to '-' — Fanuc/Heidenhain posts often emit X+10.5.
  const m = clean.match(new RegExp(`${axis}([+-]?\\d+(?:\\.\\d+)?)`))
  if (!m) return null
  const n = Number.parseFloat(m[1] ?? '')
  return Number.isFinite(n) ? n : null
}

/** Number of line segments used to approximate a G2/G3 arc. */
const ARC_INTERPOLATION_SEGMENTS = 16

/**
 * Interpolate a G2/G3 arc (XY plane, I/J center offsets) into line segments.
 * Returns an array of feed-kind ToolpathSegment3 approximating the arc.
 *
 * @param cw  true for G2 (clockwise), false for G3 (counter-clockwise)
 * @param x0  start X
 * @param y0  start Y
 * @param z0  start Z
 * @param x1  end X
 * @param y1  end Y
 * @param z1  end Z
 * @param i   center offset in X from start
 * @param j   center offset in Y from start
 */
function interpolateArc(
  cw: boolean,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  i: number, j: number
): ToolpathSegment3[] {
  const cx = x0 + i
  const cy = y0 + j

  let startAngle = Math.atan2(y0 - cy, x0 - cx)
  let endAngle = Math.atan2(y1 - cy, x1 - cx)
  const r = Math.hypot(x0 - cx, y0 - cy)

  // Compute sweep angle based on direction
  let sweep = endAngle - startAngle
  if (cw) {
    // Clockwise: sweep must be negative
    if (sweep >= 0) sweep -= 2 * Math.PI
  } else {
    // Counter-clockwise: sweep must be positive
    if (sweep <= 0) sweep += 2 * Math.PI
  }

  const n = ARC_INTERPOLATION_SEGMENTS
  const segs: ToolpathSegment3[] = []

  for (let s = 0; s < n; s++) {
    const t0 = s / n
    const t1 = (s + 1) / n
    const a0 = startAngle + sweep * t0
    const a1 = startAngle + sweep * t1

    const sx0 = cx + r * Math.cos(a0)
    const sy0 = cy + r * Math.sin(a0)
    const sz0 = z0 + (z1 - z0) * t0
    // Use exact endpoint for the last sub-segment to avoid floating-point drift
    const sx1 = s === n - 1 ? x1 : cx + r * Math.cos(a1)
    const sy1 = s === n - 1 ? y1 : cy + r * Math.sin(a1)
    const sz1 = z0 + (z1 - z0) * t1

    segs.push({
      kind: 'feed',
      x0: sx0, y0: sy0, z0: sz0,
      x1: sx1, y1: sy1, z1: sz1
    })
  }

  return segs
}

export function extractToolpathSegmentsFromGcode(gcode: string): ToolpathSegment3[] {
  const lines = gcode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';'))

  const state = { x: 0, y: 0, z: 0 }
  const segs: ToolpathSegment3[] = []

  for (const line of lines) {
    // Allow compact forms (no space between G-code and axis word, e.g. G2X10I5J0).
    // The \b word boundary fails when a letter immediately follows the digit, so use
    // a lookahead for whitespace, an axis letter, or end-of-string instead.
    const isArc = /^(G0?2|G0?3)(?=\s|[A-Z]|$)/i.test(line)
    if (!isArc && !/^(G00|G0|G01|G1)(?=\s|[A-Z]|$)/i.test(line)) continue

    if (isArc) {
      const isCW = /^(G0?2)(?=\s|[A-Z]|$)/i.test(line)
      const nx = readAxis(line, 'X') ?? state.x
      const ny = readAxis(line, 'Y') ?? state.y
      const nz = readAxis(line, 'Z') ?? state.z
      const ci = readAxis(line, 'I') ?? 0
      const cj = readAxis(line, 'J') ?? 0
      const arcSegs = interpolateArc(isCW, state.x, state.y, state.z, nx, ny, nz, ci, cj)
      segs.push(...arcSegs)
      state.x = nx
      state.y = ny
      state.z = nz
    } else {
      const isRapid = /^(G00|G0)(?=\s|[A-Z]|$)/i.test(line)
      const nx = readAxis(line, 'X') ?? state.x
      const ny = readAxis(line, 'Y') ?? state.y
      const nz = readAxis(line, 'Z') ?? state.z
      segs.push({
        kind: isRapid ? 'rapid' : 'feed',
        x0: state.x,
        y0: state.y,
        z0: state.z,
        x1: nx,
        y1: ny,
        z1: nz
      })
      state.x = nx
      state.y = ny
      state.z = nz
    }
  }

  return segs
}

/**
 * 4-axis–aware segment with A-axis angle (degrees) for cylindrical preview.
 * Also carries an optional modal B-axis value when present in G-code.
 */
export type ToolpathSegment4 = ToolpathSegment3 & {
  a0: number
  a1: number
  b0: number
  b1: number
}

/**
 * Parse G-code that contains A-axis words (4th axis rotary).
 * Returns segments with full (X, Y, Z, A, B) state tracking.
 * B is modal — its last-seen value carries forward across lines.
 */
export function extractToolpathSegments4AxisFromGcode(gcode: string): ToolpathSegment4[] {
  const lines = gcode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';'))

  const state = { x: 0, y: 0, z: 0, a: 0, b: 0 }
  const segs: ToolpathSegment4[] = []

  for (const line of lines) {
    // Allow compact forms like G0A45, G1Z-3F800 (no space between G-code and axis word).
    // The \b word boundary fails when an axis letter (A-Z) immediately follows a digit,
    // so use a lookahead for whitespace, an axis letter, or end-of-string instead.
    const isRapid = /^(G00|G0)(?=\s|[A-Z]|$)/i.test(line)
    const isFeed = /^(G01|G1)(?=\s|[A-Z]|$)/i.test(line)
    if (!isRapid && !isFeed) continue
    const nx = readAxis(line, 'X') ?? state.x
    const ny = readAxis(line, 'Y') ?? state.y
    const nz = readAxis(line, 'Z') ?? state.z
    const na = readAxis(line, 'A') ?? state.a
    const nb = readAxis(line, 'B') ?? state.b
    segs.push({
      kind: isRapid ? 'rapid' : 'feed',
      x0: state.x, y0: state.y, z0: state.z, a0: state.a, b0: state.b,
      x1: nx, y1: ny, z1: nz, a1: na, b1: nb
    })
    state.x = nx
    state.y = ny
    state.z = nz
    state.a = na
    state.b = nb
  }

  return segs
}

/**
 * Convert 4-axis cylindrical toolpath segments to 3D Cartesian for preview.
 *
 * In 4-axis G-code:
 *   X = axial position along rotation axis
 *   Z = radial distance from rotation axis center
 *   A = rotation angle in degrees
 *
 * Converts to Cartesian:
 *   x' = X  (unchanged)
 *   y' = Z · cos(A)   (Y in Cartesian — vertical component)
 *   z' = Z · sin(A)   (Z in Cartesian — depth component)
 *
 * Large A-axis changes are arc-interpolated into small sub-segments so the
 * preview follows the cylinder surface instead of cutting straight through it.
 */
export function apply4AxisCylindricalTransform(
  segments: ToolpathSegment4[]
): ToolpathSegment3[] {
  const out: ToolpathSegment3[] = []

  for (const s of segments) {
    const da = s.a1 - s.a0
    // Arc-interpolation thresholds: 5° for feed (cutting) moves, 10° for rapids
    const threshold = s.kind === 'rapid' ? 10 : 5
    const stepSize = s.kind === 'rapid' ? 10 : 5

    if (Math.abs(da) > threshold) {
      // Subdivide into arc segments so lines follow cylinder surface
      const steps = Math.max(2, Math.ceil(Math.abs(da) / stepSize))
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps
        const t1 = (i + 1) / steps
        const ax0 = s.x0 + (s.x1 - s.x0) * t0
        const ay0 = s.y0 + (s.y1 - s.y0) * t0
        const az0 = s.z0 + (s.z1 - s.z0) * t0
        const aa0 = s.a0 + da * t0
        const ax1 = s.x0 + (s.x1 - s.x0) * t1
        const ay1 = s.y0 + (s.y1 - s.y0) * t1
        const az1 = s.z0 + (s.z1 - s.z0) * t1
        const aa1 = s.a0 + da * t1
        const r0 = (aa0 * Math.PI) / 180
        const r1 = (aa1 * Math.PI) / 180
        out.push({
          kind: s.kind,
          x0: ax0,
          y0: az0 * Math.cos(r0),
          z0: az0 * Math.sin(r0),
          x1: ax1,
          y1: az1 * Math.cos(r1),
          z1: az1 * Math.sin(r1)
        })
      }
    } else {
      const a0r = (s.a0 * Math.PI) / 180
      const a1r = (s.a1 * Math.PI) / 180
      out.push({
        kind: s.kind,
        x0: s.x0,
        y0: s.z0 * Math.cos(a0r),
        z0: s.z0 * Math.sin(a0r),
        x1: s.x1,
        y1: s.z1 * Math.cos(a1r),
        z1: s.z1 * Math.sin(a1r)
      })
    }
  }

  return out
}

/** Default cylinder diameter (mm) for 4-axis preview when params omit it — matches `cam-runner` TS engine. */
export const DEFAULT_4AXIS_CYLINDER_DIAMETER_MM = 50

export function isManufactureKind4AxisForPreview(kind: string | undefined): boolean {
  return kind === 'cnc_4axis_roughing' || kind === 'cnc_4axis_finishing' || kind === 'cnc_4axis_contour' || kind === 'cnc_4axis_indexed' || kind === 'cnc_4axis_continuous'
}

export function isManufactureKind5AxisForPreview(kind: string | undefined): boolean {
  return kind === 'cnc_5axis_contour' || kind === 'cnc_5axis_swarf' || kind === 'cnc_5axis_flowline'
}

export function resolve4AxisCylinderDiameterMm(params: unknown): number {
  if (!params || typeof params !== 'object') return DEFAULT_4AXIS_CYLINDER_DIAMETER_MM
  const d = (params as Record<string, unknown>).cylinderDiameterMm
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return d
  return DEFAULT_4AXIS_CYLINDER_DIAMETER_MM
}

/**
 * Map 4-axis engine radial Z (distance from rotation axis) to mill-style Z for preview
 * (stock top ≈ 0, cuts negative). Does not change emitted G-code.
 */
export function apply4AxisRadialZToMillPreviewSegments(
  segments: ToolpathSegment3[],
  cylinderDiameterMm: number
): ToolpathSegment3[] {
  const r = cylinderDiameterMm * 0.5
  if (!(r > 0) || !Number.isFinite(r)) return segments
  return segments.map((s) => ({
    ...s,
    z0: s.z0 - r,
    z1: s.z1 - r
  }))
}

/** One contiguous polyline in G-code space (mm), grouped by motion kind. */
export type ToolpathPathChain = {
  kind: ToolpathMotionKind
  points: { x: number; y: number; z: number }[]
}

function gcodePointsEqual(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): boolean {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz < 1e-10
}

/**
 * Merge consecutive G0/G1 segments that share an endpoint into polylines (same kind only).
 * Discontinuous jumps start a new chain.
 */
export function buildContiguousPathChains(segments: ToolpathSegment3[]): ToolpathPathChain[] {
  if (segments.length === 0) return []
  const chains: ToolpathPathChain[] = []
  for (const s of segments) {
    const a = { x: s.x0, y: s.y0, z: s.z0 }
    const b = { x: s.x1, y: s.y1, z: s.z1 }
    const last = chains[chains.length - 1]
    if (last && last.kind === s.kind) {
      const prev = last.points[last.points.length - 1]!
      if (gcodePointsEqual(prev, a)) {
        last.points.push(b)
      } else {
        chains.push({ kind: s.kind, points: [a, b] })
      }
    } else {
      chains.push({ kind: s.kind, points: [a, b] })
    }
  }
  return chains
}

function segmentLengthMm(s: ToolpathSegment3): number {
  const dx = s.x1 - s.x0
  const dy = s.y1 - s.y0
  const dz = s.z1 - s.z0
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export type ToolpathLengthSampler = {
  /** Total polyline length in mm (sum of segment lengths). */
  totalMm: number
  /** Position after travelling a distance `d` mm from the start of the first segment (clamped). */
  atDistanceMm: (d: number) => { x: number; y: number; z: number }
  /** Unit parameter u in [0,1] → position along path by arc length. */
  atUnit: (u: number) => { x: number; y: number; z: number }
  /** Unit parameter u in [0,1] → index of the segment being traversed (0-based). */
  segmentIndexAtUnit: (u: number) => number
  /** Cumulative arc lengths at the END of each segment (same length as input segments). */
  cumulativeMm: Float64Array
}

/**
 * Arc-length parameterization of the toolpath polyline (endpoints of each G0/G1 segment, in order).
 */
export function buildToolpathLengthSampler(segments: ToolpathSegment3[]): ToolpathLengthSampler {
  if (segments.length === 0) {
    const z = { x: 0, y: 0, z: 0 }
    return {
      totalMm: 0,
      atDistanceMm: () => z,
      atUnit: () => z,
      segmentIndexAtUnit: () => 0,
      cumulativeMm: new Float64Array(0)
    }
  }

  const points: { x: number; y: number; z: number }[] = []
  const first = segments[0]!
  points.push({ x: first.x0, y: first.y0, z: first.z0 })
  for (const s of segments) {
    points.push({ x: s.x1, y: s.y1, z: s.z1 })
  }

  const legLengths: number[] = []
  let totalMm = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    legLengths.push(len)
    totalMm += len
  }

  const cumulativeMm = new Float64Array(legLengths.length)
  let cum = 0
  for (let i = 0; i < legLengths.length; i++) {
    cum += legLengths[i]!
    cumulativeMm[i] = cum
  }

  const atDistanceMm = (d: number): { x: number; y: number; z: number } => {
    if (totalMm <= 0 || legLengths.length === 0) return { ...points[0]! }
    let dist = Math.max(0, Math.min(d, totalMm))
    let i = 0
    while (i < legLengths.length && dist > legLengths[i]! + 1e-9) {
      dist -= legLengths[i]!
      i++
    }
    if (i >= legLengths.length) {
      const last = points[points.length - 1]!
      return { x: last.x, y: last.y, z: last.z }
    }
    const a = points[i]!
    const b = points[i + 1]!
    const L = legLengths[i]!
    if (L < 1e-12) return { x: b.x, y: b.y, z: b.z }
    const t = dist / L
    return {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
      z: a.z + t * (b.z - a.z)
    }
  }

  const atUnit = (u: number): { x: number; y: number; z: number } => {
    const t = Math.max(0, Math.min(1, u))
    return atDistanceMm(t * totalMm)
  }

  const segmentIndexAtUnit = (u: number): number => {
    if (totalMm <= 0 || legLengths.length === 0) return 0
    const d = Math.max(0, Math.min(1, u)) * totalMm
    // Binary search on cumulativeMm
    let lo = 0
    let hi = cumulativeMm.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (cumulativeMm[mid]! < d - 1e-9) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  return { totalMm, atDistanceMm, atUnit, segmentIndexAtUnit, cumulativeMm }
}

/** Sum of G0/G1 segment lengths (mm). */
export function totalToolpathLengthMm(segments: ToolpathSegment3[]): number {
  let s = 0
  for (const seg of segments) s += segmentLengthMm(seg)
  return s
}

/**
 * 5-axis–aware segment with A-axis and B-axis angles (degrees) for visualization.
 */
export type ToolpathSegment5 = ToolpathSegment3 & {
  a0: number
  a1: number
  b0: number
  b1: number
}

/**
 * Parse G-code that contains A-axis and/or B-axis words (5-axis simultaneous).
 * Returns segments with full (X, Y, Z, A, B) state tracking.
 * Both A and B are modal — their last-seen value carries forward across lines.
 * Also supports G2/G3 arcs: arc sub-segments inherit the final A/B values
 * from that line (rotary axes are not interpolated along the arc).
 */
export function extractToolpathSegments5AxisFromGcode(gcode: string): ToolpathSegment5[] {
  const lines = gcode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';'))

  const state = { x: 0, y: 0, z: 0, a: 0, b: 0 }
  const segs: ToolpathSegment5[] = []

  for (const line of lines) {
    const isArc = /^(G0?2|G0?3)(?=\s|[A-Z]|$)/i.test(line)
    if (!isArc && !/^(G00|G0|G01|G1)(?=\s|[A-Z]|$)/i.test(line)) continue

    if (isArc) {
      const isCW = /^(G0?2)(?=\s|[A-Z]|$)/i.test(line)
      const nx = readAxis(line, 'X') ?? state.x
      const ny = readAxis(line, 'Y') ?? state.y
      const nz = readAxis(line, 'Z') ?? state.z
      const na = readAxis(line, 'A') ?? state.a
      const nb = readAxis(line, 'B') ?? state.b
      const ci = readAxis(line, 'I') ?? 0
      const cj = readAxis(line, 'J') ?? 0
      const arcSegs3 = interpolateArc(isCW, state.x, state.y, state.z, nx, ny, nz, ci, cj)

      // Linearly interpolate A and B across sub-segments
      const n = arcSegs3.length
      for (let s = 0; s < n; s++) {
        const t0 = s / n
        const t1 = (s + 1) / n
        segs.push({
          ...arcSegs3[s]!,
          a0: state.a + (na - state.a) * t0,
          a1: state.a + (na - state.a) * t1,
          b0: state.b + (nb - state.b) * t0,
          b1: state.b + (nb - state.b) * t1
        })
      }

      state.x = nx
      state.y = ny
      state.z = nz
      state.a = na
      state.b = nb
    } else {
      const isRapid = /^(G00|G0)(?=\s|[A-Z]|$)/i.test(line)
      const nx = readAxis(line, 'X') ?? state.x
      const ny = readAxis(line, 'Y') ?? state.y
      const nz = readAxis(line, 'Z') ?? state.z
      const na = readAxis(line, 'A') ?? state.a
      const nb = readAxis(line, 'B') ?? state.b
      segs.push({
        kind: isRapid ? 'rapid' : 'feed',
        x0: state.x, y0: state.y, z0: state.z, a0: state.a, b0: state.b,
        x1: nx, y1: ny, z1: nz, a1: na, b1: nb
      })
      state.x = nx
      state.y = ny
      state.z = nz
      state.a = na
      state.b = nb
    }
  }

  return segs
}
