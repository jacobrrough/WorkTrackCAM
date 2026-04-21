/**
 * Rasterization helpers for the cylindrical heightmap: per-angle X extents
 * (first/last cell with material, plus overcut padding and gap-fill),
 * angular curvature score for adaptive refinement, adaptive pass-list
 * construction, non-grid angular sampling, and surface-step ↔ degrees
 * conversion.
 */
import { NO_HIT, type CylindricalHeightmap } from './heightmap'

// ─── Per-angle X extents with overcut + gap fill ────────────────────────────

export function computePerAngleXExtents(
  hm: CylindricalHeightmap,
  overcutCells: number
): Array<[number, number]> {
  const { nx, na, radii } = hm
  const extents: Array<[number, number]> = []
  for (let ia = 0; ia < na; ia++) {
    let first = -1
    let last = -1
    for (let ix = 0; ix < nx; ix++) {
      if (radii[ix * na + ia]! > 0) {
        if (first === -1) first = ix
        last = ix
      }
    }
    if (first === -1) {
      extents.push([-1, -1])
    } else {
      const extStart = Math.max(0, first - overcutCells)
      const extEnd = Math.min(nx - 1, last + overcutCells)
      extents.push([extStart, extEnd])
    }
  }

  // Fill gaps from neighboring angles to avoid skipped passes near the
  // boundary of part / no-part regions.
  for (let ia = 0; ia < na; ia++) {
    if (extents[ia]![0] !== -1) continue
    const prev = (ia - 1 + na) % na
    const next = (ia + 1) % na
    if (extents[prev]![0] !== -1 && extents[next]![0] !== -1) {
      extents[ia] = [
        Math.min(extents[prev]![0], extents[next]![0]),
        Math.max(extents[prev]![1], extents[next]![1])
      ]
    } else if (extents[prev]![0] !== -1) {
      extents[ia] = [...extents[prev]!]
    } else if (extents[next]![0] !== -1) {
      extents[ia] = [...extents[next]!]
    }
  }

  return extents
}

// ─── Angular curvature score ─────────────────────────────────────────────────

/**
 * Per-angle absolute second derivative of radius in the angular direction.
 * High values indicate sharp surface transitions where finer angular
 * resolution improves surface quality.
 */
export function computeAngularCurvature(hm: CylindricalHeightmap): Float32Array {
  const scores = new Float32Array(hm.na)
  const daRad = (hm.daDeg * Math.PI) / 180
  for (let ia = 0; ia < hm.na; ia++) {
    let totalCurvature = 0
    let count = 0
    for (let ix = 0; ix < hm.nx; ix++) {
      const r = hm.radii[ix * hm.na + ia]!
      if (r <= 0) continue
      const iaPrev = (ia - 1 + hm.na) % hm.na
      const iaNext = (ia + 1) % hm.na
      const rPrev = hm.radii[ix * hm.na + iaPrev]!
      const rNext = hm.radii[ix * hm.na + iaNext]!
      if (rPrev <= 0 || rNext <= 0) continue
      const d2r = Math.abs(rPrev + rNext - 2 * r) / (daRad * daRad)
      totalCurvature += d2r
      count++
    }
    scores[ia] = count > 0 ? totalCurvature / count : 0
  }
  return scores
}

// ─── Adaptive angular pass list ──────────────────────────────────────────────

/**
 * Build a refined angular pass list — insert midpoint passes in high-curvature
 * regions, up to `maxExtraPasses` budget.
 */
export function buildAdaptiveAngles(
  baseDeg: number,
  na: number,
  curvature: Float32Array,
  maxExtraPasses: number
): number[] {
  const nonZero = Array.from(curvature)
    .filter((c) => c > 0)
    .sort((a, b) => a - b)
  if (nonZero.length === 0) {
    return Array.from({ length: na }, (_, i) => i * baseDeg)
  }
  const threshold = nonZero[Math.floor(nonZero.length * 0.75)] || 0

  const angles: number[] = []
  let extraBudget = maxExtraPasses
  for (let ia = 0; ia < na; ia++) {
    const baseAngle = ia * baseDeg
    angles.push(baseAngle)
    if (curvature[ia]! > threshold && extraBudget > 0) {
      const midAngle = baseAngle + baseDeg / 2
      if (midAngle < 360) {
        angles.push(midAngle)
        extraBudget--
      }
    }
  }
  angles.sort((a, b) => a - b)
  return angles
}

// ─── Heightmap sampling at non-grid angles ──────────────────────────────────

/**
 * Sample the compensated heightmap at an arbitrary angular position using
 * linear interpolation between the two nearest grid angles.
 */
export function sampleHeightmapAtAngle(
  hm: CylindricalHeightmap,
  comp: Float32Array,
  ix: number,
  aDeg: number
): number {
  const iaFloat = aDeg / hm.daDeg
  const ia0 = Math.floor(iaFloat) % hm.na
  const ia1 = (ia0 + 1) % hm.na
  const frac = iaFloat - Math.floor(iaFloat)
  const r0 = comp[ix * hm.na + ia0]!
  const r1 = comp[ix * hm.na + ia1]!
  if (r0 <= 0 && r1 <= 0) return NO_HIT
  if (r0 <= 0) return r1
  if (r1 <= 0) return r0
  return r0 + frac * (r1 - r0)
}

// ─── Stepover conversion ────────────────────────────────────────────────────

/**
 * Convert a desired surface arc-step (mm) at the stock outer radius to
 * angular degrees. Uses θ (rad) = arcLengthMm / stockRadiusMm. Clamped to
 * [0.1°, 180°].
 */
export function surfaceStepoverDegFromMm(
  stockRadiusMm: number,
  targetSurfaceStepoverMm: number
): number {
  const r = Math.max(1e-6, stockRadiusMm)
  const s = Math.max(1e-6, targetSurfaceStepoverMm)
  const deg = (s / r) * (180 / Math.PI)
  return Math.min(180, Math.max(0.1, deg))
}
