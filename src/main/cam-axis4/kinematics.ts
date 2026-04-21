/**
 * 4-Axis A-axis kinematics — pre-emission, not post-hoc.
 *
 * Replaces the old `cam-4axis-feed-check.ts` post-hoc analysis with helpers
 * that the emitter calls BEFORE writing each G1. The principle: if a move
 * would exceed the rotary table's max RPM at the requested feed, throttle
 * the feed in-place (and surface a warning) rather than emitting unsafe
 * G-code and warning the user later.
 *
 * Provides:
 *   - `shortestAngularPath(from, to)`        → delta in [-180, 180]
 *   - `arcLengthMm(deltaDeg, radius)`        → mm of surface arc
 *   - `adaptFeedForAngularVelocity(...)`     → throttled feed + warning
 */

const DEG_TO_RAD = Math.PI / 180

/**
 * Shortest signed angular delta from `from` to `to`, in degrees, in (-180, 180].
 *
 * Examples (correctness is the whole point — the old engine had no helper
 * for this and emitted "go all the way around" in some cases):
 *   shortestAngularPath(  0, 350) →  -10
 *   shortestAngularPath(350,  10) →  +20
 *   shortestAngularPath(  0, 180) →  180
 *   shortestAngularPath( 90,  90) →    0
 */
export function shortestAngularPath(fromDeg: number, toDeg: number): number {
  let d = ((toDeg - fromDeg) % 360 + 540) % 360 - 180
  // Map -180 → 180 so the helper never returns the inclusive lower bound,
  // matching the doc comment "in (-180, 180]".
  if (d === -180) d = 180
  return d
}

/**
 * Surface arc length (mm) for an angular delta on a cylinder of given radius.
 *
 *     arcLength = |Δθ| × radius   (Δθ in radians)
 */
export function arcLengthMm(deltaDeg: number, radiusMm: number): number {
  return Math.abs(deltaDeg) * DEG_TO_RAD * Math.max(0, radiusMm)
}

export type FeedAdaptResult = {
  /** The (possibly throttled) feed in mm/min. */
  feedMmMin: number
  /** True iff the feed was reduced from the requested value. */
  throttled: boolean
  /** Human-readable warning string, present only when `throttled` is true. */
  warning?: string
}

/**
 * Cap the feed rate so the resulting A-axis angular velocity stays within
 * the machine's max RPM, accounting for the linear XYZ component of a combined
 * move.
 *
 * Two cases:
 *   1. Pure rotation (linearDistMm ≈ 0): F is interpreted as surface speed at
 *      the stock OD. Capping F directly caps angular velocity:
 *        angVel = F × 360 / (π × stockDia)
 *   2. Combined XYZ + A: F is the linear feed along the XYZ vector.
 *        time = linearDist / F   (minutes)
 *        angVel = |Δθ| / time = |Δθ| × F / linearDist
 */
export function adaptFeedForAngularVelocity(opts: {
  requestedFeedMmMin: number
  deltaADeg: number
  linearDistMm: number
  stockDiameterMm: number
  maxRotaryRpm: number
}): FeedAdaptResult {
  const {
    requestedFeedMmMin,
    deltaADeg,
    linearDistMm,
    stockDiameterMm,
    maxRotaryRpm
  } = opts
  const requested = Math.max(0, requestedFeedMmMin)
  const dA = Math.abs(deltaADeg)
  if (dA < 1e-6 || requested <= 0 || maxRotaryRpm <= 0) {
    return { feedMmMin: requested, throttled: false }
  }
  const maxDegPerMin = maxRotaryRpm * 360

  let cap: number
  if (linearDistMm < 1e-6) {
    // Pure rotation: time = arc / F where arc = dA * π * D / 360.
    // angVel = dA / time = F * 360 / (π * D). Cap angVel ≤ maxDegPerMin:
    //   F ≤ maxDegPerMin * π * D / 360
    if (stockDiameterMm <= 1e-6) return { feedMmMin: requested, throttled: false }
    cap = (maxDegPerMin * Math.PI * stockDiameterMm) / 360
  } else {
    // Combined: time = linearDist / F. angVel = dA / time = dA * F / linearDist.
    // Cap angVel ≤ maxDegPerMin:
    //   F ≤ maxDegPerMin * linearDist / dA
    cap = (maxDegPerMin * linearDistMm) / dA
  }

  if (requested <= cap + 1e-9) return { feedMmMin: requested, throttled: false }
  const adapted = Math.max(1, Math.floor(cap))
  return {
    feedMmMin: adapted,
    throttled: true,
    warning: `4-axis feed reduced from ${requested.toFixed(0)} to ${adapted.toFixed(0)} mm/min to stay within ${maxRotaryRpm.toFixed(1)} RPM rotary limit (ΔA=${deltaADeg.toFixed(2)}°, linear=${linearDistMm.toFixed(2)} mm)`
  }
}
