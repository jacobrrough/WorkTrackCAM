/**
 * Rotary Fixture Collision Detection
 *
 * Checks 4-axis toolpath segments for collision with the rotary chuck body and
 * (optionally) a tailstock. Both fixtures are modeled as solid cylinders coaxial
 * with the A-axis (machine X).
 *
 * In the 4-axis G-code frame:
 *   X = axial position along the rotation axis
 *   Y = 0           (tool centered on rotation axis)
 *   Z = radial distance from the rotation axis (stock center)
 *   A = rotation angle in degrees
 *
 * Because Y is always 0, the tool tip lies directly above the rotation axis,
 * and a 3D clearance check collapses to a planar (X, Z) check against cylinders
 * of radius `chuckOuterRadiusMm` / `tailstockOuterRadiusMm`.
 *
 * A collision is flagged when, anywhere along a segment, the tool (radius =
 * toolDiameterMm/2) would overlap a fixture's solid cylinder, with a user-
 * supplied safety margin added to both axial and radial tests:
 *
 *   Chuck:      x < chuckDepthMm + toolR + margin  AND  z < chuckROuter + toolR + margin
 *   Tailstock:  x > tailstockStartXMm − toolR − margin AND  z < tailstockROuter + toolR + margin
 *
 * The check samples each segment (default 8 samples) so diagonal moves that
 * dip into the forbidden zone mid-segment are caught, not just endpoints.
 *
 * Scope note: this module is pre-schema — it takes explicit fixture parameters
 * rather than reading a chuck-radius field that doesn't yet exist on
 * `CamJobConfig`. Callers supply the chuck outer dimensions from the machine
 * profile or user setup. The default chuck radius is intentionally not hard-
 * coded here; the caller must provide it to opt in to the check.
 */
import type { ToolpathSegment4 } from './cam-gcode-toolpath'

/**
 * Fixture geometry for the rotary collision sweep. Chuck fields are required;
 * tailstock fields are optional — omit them to skip the tailstock check.
 */
export type RotaryFixtureConfig = {
  /** Chuck body axial extent (mm): chuck occupies X in [0, chuckDepthMm]. */
  chuckDepthMm: number
  /**
   * Outer radius of the chuck body (mm), typically larger than the stock
   * radius. On a 3-jaw chuck, this is the radius of the jaw front face.
   */
  chuckOuterRadiusMm: number
  /**
   * Axial position where the tailstock body begins (mm). Tailstock occupies
   * X ≥ tailstockStartXMm. Omit (or set `undefined`) to disable tailstock check.
   */
  tailstockStartXMm?: number
  /** Outer radius of the tailstock body (mm). Required iff `tailstockStartXMm` set. */
  tailstockOuterRadiusMm?: number
}

export type RotaryCollisionOpts = {
  /** Cutter diameter (mm). The tool is modeled as a cylinder of this diameter. */
  toolDiameterMm: number
  /**
   * Radial + axial safety margin (mm) added to both fixture tests. Default 0.5 mm.
   * Raise for fragile fixtures (optical tailstocks) or unfamiliar setups.
   */
  safetyMarginMm?: number
  /**
   * Number of samples along each segment used for the sweep. Default 8.
   * Increase if segments are long and diagonal relative to (x, z).
   * Minimum 2 (endpoints only).
   */
  sampleCount?: number
  /**
   * When `true` (default), skip segments until the program has commanded an
   * explicit axial X position. Before the first X word the tool's actual X
   * on the machine is undefined (it's wherever the machine parked after the
   * previous program), so the extractor's default `x = 0` is meaningless and
   * would otherwise trigger spurious chuck collisions on initial Z approaches.
   * The establishing segment itself (first non-zero X1) is sampled only at
   * its endpoint. Set to `false` to check every segment from index 0.
   */
  skipInitialUnknownX?: boolean
}

/** A single collision event detected against a fixture. */
export type RotaryCollisionEvent = {
  /** 0-based segment index in the input array. */
  segmentIndex: number
  /** Which fixture was contacted. */
  fixture: 'chuck' | 'tailstock'
  /** Tool tip X at the sampled collision point (mm). */
  x: number
  /** Tool tip Z (radial distance from rotation axis) at the sampled collision point (mm). */
  z: number
  /** Rapid vs feed — feed collisions are near-certain machine crashes. */
  kind: 'rapid' | 'feed'
  /**
   * Signed radial clearance (mm). Negative = penetration depth into the
   * fixture cylinder; positive impossibility — collisions only populate when
   * the signed clearance is negative.
   */
  clearance: number
}

export type RotaryCollisionResult = {
  /** True when no collisions were detected. */
  safe: boolean
  collisions: RotaryCollisionEvent[]
}

/**
 * Run the rotary collision check over a list of toolpath segments.
 *
 * @param segments Parsed 4-axis toolpath segments (typically from
 *                 `extractToolpathSegments4AxisFromGcode`).
 * @param fixture  Chuck + optional tailstock geometry.
 * @param opts     Tool + sampling + safety margin options.
 * @returns        A result containing every collision event found. The array
 *                 may include multiple events for different segments, but only
 *                 one event per segment (the first sample point that fails).
 */
export function checkRotaryFixtureCollision(
  segments: readonly ToolpathSegment4[],
  fixture: RotaryFixtureConfig,
  opts: RotaryCollisionOpts
): RotaryCollisionResult {
  const toolR = Math.max(0, opts.toolDiameterMm / 2)
  const margin = opts.safetyMarginMm ?? 0.5
  const samples = Math.max(2, opts.sampleCount ?? 8)
  const skipInitialUnknownX = opts.skipInitialUnknownX ?? true
  const hasTail =
    fixture.tailstockStartXMm != null && fixture.tailstockOuterRadiusMm != null

  const collisions: RotaryCollisionEvent[] = []

  // Track whether the program has issued an explicit X command yet. Before
  // then, `seg.x0`/`seg.x1` are the extractor's default 0 — meaningless as
  // real machine positions.
  let xEstablished = !skipInitialUnknownX

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!

    // ── Initial-approach handling ─────────────────────────────────────────
    // If X has not been established yet, a segment with x0 == x1 == 0 is
    // pre-approach modal noise — skip entirely. The first segment where
    // either endpoint is non-zero becomes the "establishing" move: its start
    // point is still ambiguous (the real machine start X is unknown), so we
    // sample only its endpoint.
    let startSample = 0
    if (!xEstablished) {
      if (seg.x0 === 0 && seg.x1 === 0) continue
      xEstablished = true
      startSample = samples // endpoint only
    }

    let flagged = false
    for (let s = startSample; s <= samples && !flagged; s++) {
      const t = s / samples
      const x = seg.x0 + (seg.x1 - seg.x0) * t
      const z = seg.z0 + (seg.z1 - seg.z0) * t

      // ── Chuck: occupies x ∈ [0, chuckDepth], radius = chuckOuterRadius
      if (x < fixture.chuckDepthMm + toolR + margin) {
        const requiredZ = fixture.chuckOuterRadiusMm + toolR + margin
        if (z < requiredZ) {
          collisions.push({
            segmentIndex: i,
            fixture: 'chuck',
            x,
            z,
            kind: seg.kind as 'rapid' | 'feed',
            clearance: z - requiredZ
          })
          flagged = true
          continue
        }
      }

      // ── Tailstock: occupies x ≥ tailstockStartX, radius = tailstockOuterRadius
      if (hasTail) {
        const tailX = fixture.tailstockStartXMm!
        const tailR = fixture.tailstockOuterRadiusMm!
        if (x > tailX - toolR - margin) {
          const requiredZ = tailR + toolR + margin
          if (z < requiredZ) {
            collisions.push({
              segmentIndex: i,
              fixture: 'tailstock',
              x,
              z,
              kind: seg.kind as 'rapid' | 'feed',
              clearance: z - requiredZ
            })
            flagged = true
            continue
          }
        }
      }
    }
  }

  return { safe: collisions.length === 0, collisions }
}

/**
 * Format a collision result as a short list of operator-readable warning
 * strings, suitable for inclusion in a CAM result's `warnings` array.
 *
 * Groups by fixture and severity (feed vs rapid) so a program with many
 * collisions against the same fixture produces one or two lines, not dozens.
 */
export function formatRotaryCollisionWarnings(
  result: RotaryCollisionResult
): string[] {
  if (result.safe) return []
  const byKey = new Map<string, { count: number; worst: number }>()
  for (const c of result.collisions) {
    const key = `${c.fixture}:${c.kind}`
    const prev = byKey.get(key)
    if (prev == null) {
      byKey.set(key, { count: 1, worst: c.clearance })
    } else {
      prev.count += 1
      if (c.clearance < prev.worst) prev.worst = c.clearance
    }
  }
  const out: string[] = []
  for (const [key, { count, worst }] of byKey) {
    const [fixture, kind] = key.split(':') as ['chuck' | 'tailstock', 'rapid' | 'feed']
    const severity = kind === 'feed' ? 'collision' : 'near-miss'
    out.push(
      `Rotary ${fixture} ${severity}: ${count} ${kind} move${count === 1 ? '' : 's'} ` +
        `would penetrate the ${fixture} body (worst clearance ${worst.toFixed(2)} mm). ` +
        `Review the toolpath before running.`
    )
  }
  return out
}
