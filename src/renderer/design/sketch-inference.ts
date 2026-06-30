/**
 * Live sketch constraint INFERENCE — the Fusion-style "as you draw, the sketcher guesses the
 * relation" core (Phase A of the sketch interaction rebuild).
 *
 * Pure + framework-agnostic on purpose: given the segment currently being rubber-banded
 * (`anchor` → raw `cursor`), the nearby snap points, and the directions of neighbouring edges, it
 * returns the cursor SNAPPED to the strongest inference plus the inferred relation. The canvas
 * renders a glyph per hint while drawing and, on commit, records the inferred constraints so the
 * existing 2D solver (`solveSketchToTolerance`) maintains them — exactly the loop that makes Fusion
 * sketching feel alive. Decoupled from the design model so it is unit-testable in node-env, matching
 * the sketcher's pure-core convention (e.g. `resolveHudTargetPoint`).
 *
 * Priority (strongest wins): coincident endpoint snap → directional lock (horizontal / vertical /
 * parallel / perpendicular, nearest angle). Tangent / equal / symmetric layer on next.
 */

/** Inference kinds this core detects today (each maps 1:1 to a real sketch constraint kind). */
export type InferredConstraintKind =
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'coincident'

export type SketchInferenceResult = {
  /** Cursor point after snapping to the strongest inference (sketch-plane mm). */
  readonly point: [number, number]
  /** Inferred relations to glyph while drawing + auto-apply on commit (strongest first). */
  readonly hints: readonly InferredConstraintKind[]
  /** Index of the snap point a `coincident` hint locked onto, or -1 when none fired. */
  readonly coincidentIndex: number
  /** Index into `referenceAnglesRad` a `parallel`/`perpendicular` hint locked onto, or -1. */
  readonly referenceIndex: number
}

export type SketchInferenceOptions = {
  /** Half-cone (degrees) within which a segment snaps to a candidate direction. Default 2°. */
  readonly axisToleranceDeg?: number
  /**
   * Radius (mm) within which the cursor locks onto a snap point as coincident. Default 2 mm.
   * INDEPENDENT of `axisToleranceDeg` — the angle and point tolerances are separate knobs.
   */
  readonly coincidentToleranceMm?: number
}

const DEFAULT_AXIS_TOL_DEG = 2
const DEFAULT_COINCIDENT_TOL_MM = 2
const HALF_PI = Math.PI / 2

/** Acute angle (0..π/2) between two LINES (direction-agnostic — a ray and its reverse are equal). */
function lineAngleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI
  if (d > HALF_PI) d = Math.PI - d
  return d
}

/** Project `p` onto the line through `anchor` at angle `theta` (keeps the cursor's side + extent). */
function projectOntoDirection(
  anchor: readonly [number, number],
  p: readonly [number, number],
  theta: number
): [number, number] {
  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  const t = (p[0] - anchor[0]) * dx + (p[1] - anchor[1]) * dy
  return [anchor[0] + t * dx, anchor[1] + t * dy]
}

/**
 * Infer the constraints for the point being placed.
 * - `anchor`: the segment's start (previous vertex / first click), or `null` when no segment is in
 *   flight (only coincident snapping applies then).
 * - `snapPoints`: candidate endpoints/midpoints/centers from the osnap pass (sketch-plane mm).
 * - `referenceAnglesRad`: directions of neighbouring edges (e.g. the previous segment). Each is
 *   tested for `parallel`, and its perpendicular for `perpendicular`.
 */
export function inferDrawConstraints(
  anchor: readonly [number, number] | null,
  cursor: readonly [number, number],
  snapPoints: ReadonlyArray<readonly [number, number]>,
  options: SketchInferenceOptions = {},
  referenceAnglesRad: readonly number[] = []
): SketchInferenceResult {
  const axisTol = ((options.axisToleranceDeg ?? DEFAULT_AXIS_TOL_DEG) * Math.PI) / 180
  // Independent point tolerance — the angle cone and the point radius are separate knobs.
  const coincTol = options.coincidentToleranceMm ?? DEFAULT_COINCIDENT_TOL_MM

  // 1) Coincident snap wins: lock onto the nearest snap point within tolerance.
  let bestIdx = -1
  let bestDist = coincTol
  for (let i = 0; i < snapPoints.length; i++) {
    const p = snapPoints[i]!
    const d = Math.hypot(p[0] - cursor[0], p[1] - cursor[1])
    if (d <= bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  if (bestIdx >= 0) {
    const p = snapPoints[bestIdx]!
    return { point: [p[0], p[1]], hints: ['coincident'], coincidentIndex: bestIdx, referenceIndex: -1 }
  }

  // 2) Directional lock: horizontal / vertical, plus parallel + perpendicular to each reference edge.
  if (anchor) {
    const dx = cursor[0] - anchor[0]
    const dy = cursor[1] - anchor[1]
    if (dx !== 0 || dy !== 0) {
      const cursorAngle = Math.atan2(dy, dx)
      type Candidate = { angle: number; kind: InferredConstraintKind; refIndex: number }
      const candidates: Candidate[] = [
        { angle: 0, kind: 'horizontal', refIndex: -1 },
        { angle: HALF_PI, kind: 'vertical', refIndex: -1 }
      ]
      for (let i = 0; i < referenceAnglesRad.length; i++) {
        const ref = referenceAnglesRad[i]!
        candidates.push({ angle: ref, kind: 'parallel', refIndex: i })
        candidates.push({ angle: ref + HALF_PI, kind: 'perpendicular', refIndex: i })
      }
      // Strict `<` so a tie prefers the earlier candidate: horizontal/vertical win over a
      // parallel/perpendicular that lands on the same angle (a vertical line reads "vertical",
      // not "perpendicular to that horizontal edge").
      let pick: Candidate | null = null
      let pickDiff = axisTol
      for (const c of candidates) {
        const diff = lineAngleDiff(cursorAngle, c.angle)
        if (diff < pickDiff) {
          pickDiff = diff
          pick = c
        }
      }
      if (pick) {
        // Horizontal/vertical lock to an EXACT axis coordinate (clean geometry, no float dust from
        // cos/sin); parallel/perpendicular project onto the reference direction.
        const point: [number, number] =
          pick.kind === 'horizontal'
            ? [cursor[0], anchor[1]]
            : pick.kind === 'vertical'
              ? [anchor[0], cursor[1]]
              : projectOntoDirection(anchor, cursor, pick.angle)
        return { point, hints: [pick.kind], coincidentIndex: -1, referenceIndex: pick.refIndex }
      }
    }
  }

  return { point: [cursor[0], cursor[1]], hints: [], coincidentIndex: -1, referenceIndex: -1 }
}
