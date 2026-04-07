/**
 * 4-axis A-axis angular velocity validation for posted G-code.
 *
 * On a G1 move with both XYZ and A, the feed rate F is the *linear* feed
 * in mm/min along the resultant XYZ vector. The angular velocity depends on:
 * - The A angle change (degrees)
 * - The linear distance of the XYZ component
 * - The F feed rate
 *
 * For a combined move the time = linearDistMm / F (minutes).
 * The angular velocity = deltaA / time (deg/min).
 *
 * For pure rotation (XYZ unchanged, only A changes) we treat the arc length
 * on the stock surface as the "distance" for the F word:
 *   arcLengthMm = |deltaA| * PI * stockDiameterMm / 360
 *   time = arcLengthMm / F
 *   angularVelocity = |deltaA| / time = F * 360 / (PI * stockDiameterMm)
 *
 * Most rotary tables max out at 10-30 RPM (3600-10800 deg/min).
 */

/** A single warning about excessive A-axis angular velocity on a G1 line. */
export type AngularVelocityWarning = {
  lineIndex: number
  angularVelocityDegPerMin: number
  maxAllowed: number
  line: string
}

/**
 * Check 4-axis G-code for excessive A-axis angular velocity.
 *
 * Parses G1 lines that contain an A word, tracks modal X/Y/Z/A/F state,
 * and flags moves where the resulting angular velocity exceeds the limit.
 *
 * Only checks G1 (feed) moves, not G0 (rapid) -- rapids have their own
 * machine-specific acceleration/velocity limits.
 *
 * @returns Array of warnings for moves where A-axis velocity exceeds the limit.
 */
export function check4AxisAngularVelocity(
  gcodeLines: string[],
  opts: {
    maxRotaryRpm?: number       // default 20 RPM (7200 deg/min)
    stockDiameterMm?: number    // for pure-rotation surface speed; default 50
  } = {}
): AngularVelocityWarning[] {
  const maxRpm = opts.maxRotaryRpm ?? 20
  const stockDia = opts.stockDiameterMm ?? 50
  const maxDegPerMin = maxRpm * 360

  const warnings: AngularVelocityWarning[] = []

  // Modal state
  let curX = 0
  let curY = 0
  let curZ = 0
  let curA = 0
  let curF = 0 // mm/min

  for (let i = 0; i < gcodeLines.length; i++) {
    const raw = gcodeLines[i]!
    const line = raw.trim()

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith(';')) continue

    // Only process G1 / G01 feed moves
    if (!/^(G01|G1)(?=\s|[A-Z]|$)/i.test(line)) {
      // Still track position for G0 rapids so state stays correct
      if (/^(G00|G0)(?=\s|[A-Z]|$)/i.test(line)) {
        curX = readWord(line, 'X') ?? curX
        curY = readWord(line, 'Y') ?? curY
        curZ = readWord(line, 'Z') ?? curZ
        curA = readWord(line, 'A') ?? curA
        curF = readWord(line, 'F') ?? curF
      }
      continue
    }

    // Parse axis words from G1 line
    const nx = readWord(line, 'X') ?? curX
    const ny = readWord(line, 'Y') ?? curY
    const nz = readWord(line, 'Z') ?? curZ
    const na = readWord(line, 'A') ?? curA
    const nf = readWord(line, 'F') ?? curF

    const deltaA = Math.abs(na - curA)

    // Only check moves that actually rotate the A axis
    if (deltaA > 1e-6 && nf > 0) {
      const dx = nx - curX
      const dy = ny - curY
      const dz = nz - curZ
      const linearDist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      let angularVelocity: number

      if (linearDist < 1e-6) {
        // Pure rotation -- F applies to surface speed on the stock circumference.
        // arcLength = deltaA * PI * stockDia / 360
        // time = arcLength / F
        // angVel = deltaA / time = F * 360 / (PI * stockDia)
        if (stockDia > 1e-6) {
          angularVelocity = (nf * 360) / (Math.PI * stockDia)
        } else {
          // Degenerate: zero-diameter stock, angular velocity is effectively infinite
          angularVelocity = Infinity
        }
      } else {
        // Combined XYZ + A move -- F is the linear feed rate.
        // time = linearDist / F (minutes)
        // angVel = deltaA / time = deltaA * F / linearDist
        angularVelocity = (deltaA * nf) / linearDist
      }

      if (angularVelocity > maxDegPerMin) {
        warnings.push({
          lineIndex: i,
          angularVelocityDegPerMin: angularVelocity,
          maxAllowed: maxDegPerMin,
          line: raw
        })
      }
    }

    // Update modal state
    curX = nx
    curY = ny
    curZ = nz
    curA = na
    curF = nf
  }

  return warnings
}

/**
 * Format angular velocity warnings as a human-readable hint string
 * for the cam-runner post-processing result.
 */
export function formatAngularVelocityHint(
  warnings: AngularVelocityWarning[]
): string {
  if (warnings.length === 0) return ''
  const maxVel = Math.max(...warnings.map((w) => w.angularVelocityDegPerMin))
  const maxAllowed = warnings[0]!.maxAllowed
  const maxRpm = maxAllowed / 360
  const peakRpm = maxVel / 360
  return (
    ` A-axis angular velocity warning: ${warnings.length} move(s) exceed rotary limit` +
    ` (~${peakRpm.toFixed(1)} RPM peak vs ${maxRpm.toFixed(0)} RPM max).` +
    ` Reduce feed rate or increase stepover on 4-axis passes to stay within rotary table limits.`
  )
}

// ── A-axis travel limit validation ────────────────────────────────────────

/** A single warning about an A-axis position exceeding the machine's travel range. */
export type AxisTravelWarning = {
  lineIndex: number
  aPosition: number
  minAllowed: number
  maxAllowed: number
  line: string
}

/**
 * Check 4-axis G-code for A-axis positions that exceed the machine's rotary
 * travel limits (aAxisRangeDeg). Checks both G0 (rapid) and G1 (feed) moves.
 *
 * For a machine with aAxisRangeDeg=360, valid range is [-360, 360].
 * For aAxisRangeDeg=180, valid range is [-180, 180].
 * The range is symmetric around zero since most rotary tables support
 * bidirectional travel.
 *
 * @returns Array of warnings for moves where A value exceeds travel limits.
 */
export function check4AxisTravelLimits(
  gcodeLines: string[],
  opts: {
    aAxisRangeDeg?: number   // default 360
  } = {}
): AxisTravelWarning[] {
  const range = opts.aAxisRangeDeg ?? 360
  const maxA = range
  const minA = -range

  const warnings: AxisTravelWarning[] = []

  for (let i = 0; i < gcodeLines.length; i++) {
    const raw = gcodeLines[i]!
    const line = raw.trim()

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith(';')) continue
    // Skip parenthetical-only comment lines
    if (/^\([^)]*\)\s*$/.test(line)) continue

    // Check G0 and G1 lines for A word
    if (!/^(G0[01]?|G1)(?=\s|[A-Z]|$)/i.test(line)) continue

    const aVal = readWord(line, 'A')
    if (aVal == null) continue

    if (aVal > maxA || aVal < minA) {
      warnings.push({
        lineIndex: i,
        aPosition: aVal,
        minAllowed: minA,
        maxAllowed: maxA,
        line: raw
      })
    }
  }

  return warnings
}

/**
 * Format A-axis travel limit warnings as a human-readable hint string.
 */
export function formatTravelLimitHint(
  warnings: AxisTravelWarning[]
): string {
  if (warnings.length === 0) return ''
  const extremes = warnings.map((w) => w.aPosition)
  const minSeen = Math.min(...extremes)
  const maxSeen = Math.max(...extremes)
  const allowed = warnings[0]!
  return (
    ` A-axis travel limit warning: ${warnings.length} move(s) exceed rotary range` +
    ` (A positions ${minSeen.toFixed(1)}° to ${maxSeen.toFixed(1)}° vs limit ±${allowed.maxAllowed.toFixed(0)}°).` +
    ` Check that your rotary table supports the required travel range or enable wrapping (modulo) in your controller.`
  )
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Read a single-letter axis word value from a G-code line.
 * Strips inline parenthetical comments before matching.
 */
function readWord(line: string, axis: string): number | null {
  const clean = line.replace(/\([^)]*\)/g, '')
  const m = clean.match(new RegExp(`${axis}([+-]?\\d+(?:\\.\\d+)?)`, 'i'))
  if (!m) return null
  const n = Number.parseFloat(m[1] ?? '')
  return Number.isFinite(n) ? n : null
}
