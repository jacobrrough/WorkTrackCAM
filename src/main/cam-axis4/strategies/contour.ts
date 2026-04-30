/**
 * 4-Axis Contour Wrapping
 *
 * Wraps a 2D contour (X, Y_mm) onto the cylinder surface as X / A moves.
 * Y is converted to A degrees: A = (Y / (pi * D)) * 360.
 * X is clamped to the machinable axial span.
 *
 * Full-wrap handling (roadmap [ID-0010]):
 *   The emitter's `cutTo` uses `shortestAngularPath(from, to)` to decide
 *   whether to emit an A-word. For a segment whose Y delta equals a full
 *   circumference (raw delta-A = 360 deg), shortestAngularPath collapses
 *   0 and 360 to a zero delta and the A-word is dropped -- the groove
 *   never rotates. A 270 deg raw request would be mapped to the short-way
 *   -90 deg, which is also wrong for a linear Y->A mapping.
 *
 *   Fix: before calling `cutTo`, subdivide any segment whose raw |delta-A|
 *   exceeds `FULL_WRAP_SPLIT_DEG` (170 deg -- comfortably below the
 *   +/-180 deg shortest-path aliasing edge, so every sub-move is
 *   unambiguous) into ceil(|delta-A| / FULL_WRAP_SPLIT_DEG) equal-length
 *   sub-segments. X is interpolated linearly, which matches the linear
 *   Y->A mapping used by contour wrapping. A cumulative full wrap is
 *   preserved because each sub-move advances A by <= 170 deg and the
 *   emitter always passes the absolute target angle to the controller.
 */
import { Emitter } from '../emit'

/**
 * Maximum raw |delta-A| per single `cutTo` call, in degrees. Segments
 * with a raw delta-A above this threshold are subdivided to avoid the
 * +/-180 deg shortest-path aliasing trap in `Emitter.cutTo`. Kept
 * strictly below 180 so every sub-move's shortest-path decision is
 * unambiguous.
 */
export const FULL_WRAP_SPLIT_DEG = 170

export type ContourParams = {
  contourPoints: ReadonlyArray<readonly [number, number]>
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  /** Depth levels (negative; relative to stock surface). */
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  toolDiameterMm: number
  maxZMm?: number
  maxRotaryRpm?: number
}

export type ContourResult = {
  lines: string[]
  warnings: string[]
}

export function generateContour(p: ContourParams): ContourResult {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const circumference = Math.PI * p.cylinderDiameterMm

  const emit = new Emitter({
    stockRadius: stockR,
    safeZMm: p.safeZMm,
    maxZMm: p.maxZMm,
    feedMmMin: p.feedMmMin,
    plungeMmMin: p.plungeMmMin,
    stockDiameterMm: p.cylinderDiameterMm,
    maxRotaryRpm: p.maxRotaryRpm,
    toolDiameterMm: p.toolDiameterMm
  })

  emit.comment(
    `4-axis contour wrapping - D=${p.cylinderDiameterMm.toFixed(1)}mm, ` +
      `${p.contourPoints.length} pts, X clamp [${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}], ` +
      `Z levels=${p.zDepthsMm.length}`
  )
  emit.retractToClear(true)

  if (p.contourPoints.length === 0) {
    emit.returnHome()
    return { lines: emit.lines(), warnings: emit.warnings() }
  }

  const linearToA = (yMm: number): number => {
    if (circumference <= 0) return 0
    return (yMm / circumference) * 360
  }

  const clampX = (x: number): number => {
    return Math.max(p.machXStartMm, Math.min(p.machXEndMm, x))
  }

  for (const zd of p.zDepthsMm) {
    const cutZ = stockR + zd
    if (cutZ < 0.05) continue
    emit.comment(`--- contour at Z_pass=${zd.toFixed(3)} ---`)

    const [firstX, firstY] = p.contourPoints[0]!
    const cx0 = clampX(firstX)
    const a0 = linearToA(firstY)

    // Retract before re-positioning to a new depth's start.
    emit.rapidZ(emit.clearZ)
    emit.rotateA(a0, emit.clearZ)
    emit.rapidX(cx0)
    emit.plungeZ(cutZ)

    // Track the previous (clamped X, raw Y) so we can measure the raw
    // angular delta (unmodded by shortest-path) and subdivide full or
    // multi-wrap moves before handing them to the emitter. Using the
    // clamped X ensures the interpolated sub-segments also stay inside
    // the machinable span.
    let prevX = cx0
    let prevY = firstY
    for (let i = 1; i < p.contourPoints.length; i++) {
      const [xMm, yMm] = p.contourPoints[i]!
      const cx = clampX(xMm)
      const dyRaw = yMm - prevY
      // Raw angular delta for this segment (NOT modded -- this is what
      // the caller asked for, regardless of how shortestAngularPath
      // would alias it). Positive/negative sign preserved so reverse-
      // winding grooves subdivide the same way.
      const dARaw = circumference > 0 ? (dyRaw / circumference) * 360 : 0
      const absDA = Math.abs(dARaw)
      const segments =
        absDA > FULL_WRAP_SPLIT_DEG
          ? Math.max(2, Math.ceil(absDA / FULL_WRAP_SPLIT_DEG))
          : 1
      for (let s = 1; s <= segments; s++) {
        const t = s / segments
        // Linear interp of the clamped X (so sub-segments stay inside
        // span), linear interp of raw Y (so the cumulative A sweep lands
        // exactly on the caller-requested final angle).
        const subX = prevX + (cx - prevX) * t
        const subY = prevY + dyRaw * t
        emit.cutTo(subX, cutZ, linearToA(subY))
      }
      prevX = cx
      prevY = yMm
    }
  }

  emit.returnHome()
  return { lines: emit.lines(), warnings: emit.warnings() }
}
