/**
 * cam-placement-transform.ts — Wave 3k: placement-aware 2D CAM emission.
 *
 * Pure rigid-transform helpers that let the 2D CAM dispatcher consume the
 * nesting placements `applyNestingPlacements` (ManufactureWorkspace.tsx)
 * writes onto cnc op params (`placementXMm` / `placementYMm` /
 * `placementRotationDeg`, plus the bookkeeping `placementNestVersion` /
 * `placementSheetIndex`). Before this module, the placements were write-only:
 * toolpaths emitted at the un-nested origin and a nest never moved the cuts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACEMENT CONTRACT (Wave 3j convention — MUST match the nesting engines
 * `src/main/nesting/true-shape-v1.ts` + `true-shape-nfp.ts` EXACTLY):
 *
 *   1. Rotate the part's 2D geometry CCW by `placementRotationDeg` about the
 *      LOCAL ORIGIN (0,0) — NOT the centroid, NOT the bbox centre.
 *   2. Translate so the ROTATED geometry's axis-aligned bbox MIN-CORNER lands
 *      at `(placementXMm, placementYMm)` in sheet coordinates.
 *
 * The nesting engine guarantees zero part overlap UNDER THIS EXACT TRANSFORM.
 * Any deviation — rotation about the centroid, translating by the
 * PRE-rotation bbox, CW rotation — silently re-introduces overlap on a real
 * Laguna 5x10 sheet. (The convention is rotation-centre invariant: rotating
 * about any pivot and then moving the rotated bbox min-corner to (xMm, yMm)
 * lands the same final geometry — see the contract note in true-shape-nfp.ts.)
 *
 * ONE RIGID TRANSFORM PER OP: the nesting engine placed the op's OUTER
 * polygon (the part outline = `contourPoints`). Islands and drill targets are
 * INTERIOR to that outline, so the translation is computed from the OUTER
 * contour's rotated bbox and the SAME (rotation, translation) pair is applied
 * uniformly to `contourPoints`, every `islandRings` ring, and `drillPoints`.
 * Deriving a per-array bbox instead would shear islands/drills out of the
 * part. Pocket/v-carve internals (rasters, medial axis, offset spirals)
 * derive from these inputs downstream, so they inherit the placement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE AUTHORITATIVE TRANSFORM SPOT is `dispatch2dStrategy`
 * (src/main/cam-runner-2d.ts), which calls `applyPlacementToOperationParams2d`
 * exactly once before parsing any geometry. Why there and nowhere else:
 *   - Every 2D op kind (cnc_contour, cnc_pocket, cnc_chamfer, cnc_vcarve,
 *     cnc_pcb_isolation, cnc_pcb_contour, cnc_drill, cnc_pcb_drill) passes
 *     through that single function exactly once, and ALL transformable
 *     geometry params are read from `job.operationParams` there.
 *   - The renderer (`run-cam-for-op.ts`) forwards op params VERBATIM over
 *     `cam:run`, so main-side placement covers every caller with no IPC or
 *     schema change. Applying the transform renderer-side as well would
 *     DOUBLE-TRANSFORM — never do both.
 *   - The posted-G-code machine-envelope check (`postedGcodeEnvelopeHint` →
 *     formatMachineEnvelopeHintForPostedGcode) parses the EMITTED program, so
 *     a placement that pushes the toolpath past the bed (1524×3048 Laguna) is
 *     still caught after the transform with the existing honest warning.
 *
 * SAFETY (G-code is sacred):
 *   - Ops WITHOUT placement params take the identity path: the EXACT SAME
 *     params object reference is returned, so generator inputs — and the
 *     posted bytes — are untouched (pinned by tests).
 *   - Missing/partial/non-finite placement params ⇒ identity. A half-written
 *     placement must never half-move a toolpath.
 *   - `placementSheetIndex` other than 0/absent ⇒ identity (multi-sheet
 *     honesty: overflow-sheet coordinates must not be cut into sheet 1;
 *     `applyNestingPlacements` strips those params, this guard is the
 *     belt-and-braces backstop).
 *   - Entry parsing mirrors the dispatcher's `point2d` reader exactly
 *     (length ≥ 2, Number() coercion, finite check); entries the dispatcher
 *     would reject are preserved VERBATIM so validation messages and
 *     drop-invalid behavior are unchanged by placement.
 *
 * Wave 3l — COMPANION-OP ANCHOR OVERRIDE (placementAnchorMinXMm / ...YMm):
 *   A nested part is usually cut by SEVERAL ops (contour + pocket + v-carve
 *   + chamfer + drill). The nest places only the part OUTLINE (the contour
 *   op), so a companion op stamped with the same (xMm, yMm, rotationDeg)
 *   must NOT derive its translation from its OWN bbox — that would park the
 *   pocket at the part's corner position. The stamp planner
 *   (cam-placement-siblings.ts) therefore also writes
 *   `placementAnchorMinXMm` / `placementAnchorMinYMm` — the PART outline's
 *   rotated-bbox min-corner — and this module derives the translation from
 *   that anchor instead, giving every member op of the part the IDENTICAL
 *   rigid transform. Anchor params present but not BOTH finite numbers ⇒
 *   identity (a half-written anchor must never park geometry at a wrong
 *   corner). Both absent ⇒ the pre-Wave-3l own-bbox behavior, byte-for-byte.
 */

/** The three scalar placement params the nesting flow writes onto op params. */
export interface CamPlacement2d {
  /** Sheet X (mm) where the rotated outer contour's bbox min-corner lands. */
  xMm: number
  /** Sheet Y (mm) where the rotated outer contour's bbox min-corner lands. */
  yMm: number
  /** CCW rotation in degrees about the part's local origin. */
  rotationDeg: number
}

/** A resolved rigid transform: rotate CCW about origin, then translate. */
export interface Rigid2dTransform {
  /** CCW rotation in degrees about the local origin (applied FIRST). */
  rotationDeg: number
  /** Translation X (mm) applied AFTER the rotation. */
  dxMm: number
  /** Translation Y (mm) applied AFTER the rotation. */
  dyMm: number
}

type Point2 = readonly [number, number]

/**
 * Parse one raw param entry as a 2D point with EXACTLY the dispatcher's
 * `point2d` semantics (cam-runner-2d.ts): array of length ≥ 2, Number()
 * coercion on the first two slots, both finite. Returns null otherwise.
 */
function parsePoint2dLikeDispatcher(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const x = Number(v[0])
  const y = Number(v[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

/**
 * Rotate (x, y) CCW by `deg` about the local origin. Cardinal rotations
 * (0/90/180/270 after normalisation into [0, 360)) use exact branches so
 * they are bit-identical to the nesting engine's `rotatePointsDeg`
 * (true-shape-nfp.ts) — no cos/sin noise on the dominant sheet rotations.
 */
export function rotatePointCcwDeg(x: number, y: number, deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360
  if (d === 0) return [x, y]
  if (d === 90) return [-y, x]
  if (d === 180) return [-x, -y]
  if (d === 270) return [y, -x]
  const rad = (d * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x * c - y * s, x * s + y * c]
}

/**
 * Resolve a complete, finite placement from raw op params, or null (identity).
 *
 * Guard rules (all must hold, else identity):
 *   - `placementXMm`, `placementYMm`, `placementRotationDeg` are ALL present
 *     and finite numbers — a PARTIAL placement is treated as identity, never
 *     as a half-transform.
 *   - `placementSheetIndex`, when present, must be 0 (sheet-1 coordinates).
 *     Overflow-sheet placements are never cut into this program.
 */
export function resolveCamPlacement2dFromParams(
  params: Record<string, unknown> | undefined
): CamPlacement2d | null {
  if (!params) return null
  const x = params['placementXMm']
  const y = params['placementYMm']
  const rot = params['placementRotationDeg']
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null
  if (typeof rot !== 'number' || !Number.isFinite(rot)) return null
  const sheetIndex = params['placementSheetIndex']
  if (sheetIndex !== undefined && sheetIndex !== null && sheetIndex !== 0) return null
  return { xMm: x, yMm: y, rotationDeg: rot }
}

/** Wave 3l anchor-override resolution states (see the module header). */
type PlacementAnchorMinResolution =
  | { kind: 'absent' }
  | { kind: 'valid'; minXMm: number; minYMm: number }
  | { kind: 'invalid' }

/**
 * Resolve the optional companion-op anchor override
 * (`placementAnchorMinXMm` / `placementAnchorMinYMm`, written by
 * planNestingPlacementStamps).
 *
 *   - `absent`  — neither param present (undefined/null): legacy own-bbox
 *     path, byte-identical to Wave 3k.
 *   - `valid`   — BOTH params are finite numbers: translate from the part
 *     outline's rotated bbox min instead of this op's own geometry.
 *   - `invalid` — half-written or non-finite pair: the caller returns
 *     IDENTITY, mirroring the placement triple's "never a half-transform"
 *     guard. A wrong-anchor translation would cut inside a NEIGHBORING
 *     nested part, so refusing to move is the only safe degrade.
 */
function resolvePlacementAnchorMin(params: Record<string, unknown>): PlacementAnchorMinResolution {
  const x = params['placementAnchorMinXMm']
  const y = params['placementAnchorMinYMm']
  const xAbsent = x === undefined || x === null
  const yAbsent = y === undefined || y === null
  if (xAbsent && yAbsent) return { kind: 'absent' }
  if (typeof x !== 'number' || !Number.isFinite(x)) return { kind: 'invalid' }
  if (typeof y !== 'number' || !Number.isFinite(y)) return { kind: 'invalid' }
  return { kind: 'valid', minXMm: x, minYMm: y }
}

/**
 * Derive the op's single rigid transform from its OUTER contour: rotate the
 * outer points CCW about the local origin, take the rotated bbox min-corner,
 * and translate it onto (placement.xMm, placement.yMm). Returns null when
 * `outerPoints` is empty (no bbox ⇒ no transform ⇒ caller stays identity).
 */
export function rigidTransformForPlacement(
  outerPoints: ReadonlyArray<Point2>,
  placement: CamPlacement2d
): Rigid2dTransform | null {
  if (outerPoints.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  for (const [x, y] of outerPoints) {
    const [rx, ry] = rotatePointCcwDeg(x, y, placement.rotationDeg)
    if (rx < minX) minX = rx
    if (ry < minY) minY = ry
  }
  return {
    rotationDeg: placement.rotationDeg,
    dxMm: placement.xMm - minX,
    dyMm: placement.yMm - minY
  }
}

/** Apply a resolved rigid transform to one point (rotate, then translate). */
export function applyRigidTransform2d(point: Point2, t: Rigid2dTransform): [number, number] {
  const [rx, ry] = rotatePointCcwDeg(point[0], point[1], t.rotationDeg)
  return [rx + t.dxMm, ry + t.dyMm]
}

/**
 * Convenience single-array form of the contract: rotate `points` CCW by
 * `placement.rotationDeg` about the local origin, then translate so THIS
 * array's rotated bbox min-corner lands at (xMm, yMm).
 *
 * Use ONLY when the array IS the part outline (e.g. cross-validating against
 * the nesting engine's `placedRawPointsMm`). For a full op, derive ONE
 * transform from the outer contour via {@link rigidTransformForPlacement}
 * and apply it to every array — see {@link applyPlacementToOperationParams2d}.
 */
export function applyPlacementToPoints(
  points: ReadonlyArray<Point2>,
  placement: CamPlacement2d
): [number, number][] {
  const t = rigidTransformForPlacement(points, placement)
  if (!t) return []
  return points.map((p) => applyRigidTransform2d(p, t))
}

/**
 * Transform one raw geometry param array entry-wise. Entries the dispatcher
 * would parse as points are replaced with the transformed [x, y]; entries it
 * would reject are preserved verbatim (so raw counts, validation messages,
 * and drop-invalid behavior are placement-independent).
 */
function transformRawPointArray(raw: ReadonlyArray<unknown>, t: Rigid2dTransform): unknown[] {
  return raw.map((entry) => {
    const p = parsePoint2dLikeDispatcher(entry)
    return p ? applyRigidTransform2d(p, t) : entry
  })
}

/**
 * THE wiring entry point — called exactly once per 2D op by
 * `dispatch2dStrategy` (the single authoritative transform spot; see the
 * module header). Resolves the placement from `params`, derives ONE rigid
 * transform from the OUTER contour (`contourPoints`; drill-only ops fall back
 * to `drillPoints` — the only geometry the nest could have placed for them),
 * and applies it uniformly to `contourPoints`, every ring of `islandRings`,
 * and `drillPoints`.
 *
 * IDENTITY GUARANTEE: when no complete placement is present (or there is no
 * transformable geometry), the ORIGINAL `params` reference is returned
 * unchanged — generator inputs are byte-identical to the pre-Wave-3k
 * pipeline. Non-geometry params are carried through untouched either way.
 */
export function applyPlacementToOperationParams2d(
  params: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!params) return params
  const placement = resolveCamPlacement2dFromParams(params)
  if (!placement) return params
  const anchorMin = resolvePlacementAnchorMin(params)
  if (anchorMin.kind === 'invalid') return params // half-written anchor: identity, never a wrong-corner move

  const rawContour = params['contourPoints']
  const rawIslands = params['islandRings']
  const rawDrills = params['drillPoints']

  const contourValid: Point2[] = Array.isArray(rawContour)
    ? rawContour.map(parsePoint2dLikeDispatcher).filter((p): p is [number, number] => p !== null)
    : []
  const drillValid: Point2[] = Array.isArray(rawDrills)
    ? rawDrills.map(parsePoint2dLikeDispatcher).filter((p): p is [number, number] => p !== null)
    : []

  // OUTER bbox source: the part outline. Drill-only ops (no contour at all)
  // fall back to the drill pattern's own bbox — the only outline the nesting
  // engine could have measured for them.
  const bboxSource = contourValid.length > 0 ? contourValid : drillValid
  // Wave 3l: companion ops translate from the PART outline's rotated bbox
  // (the stamped anchor) so they share the contour op's exact transform —
  // see the module header. No valid outer geometry stays identity on BOTH
  // paths (an islands-only op never transforms, anchored or not).
  const t: Rigid2dTransform | null =
    anchorMin.kind === 'valid' && bboxSource.length > 0
      ? {
          rotationDeg: placement.rotationDeg,
          dxMm: placement.xMm - anchorMin.minXMm,
          dyMm: placement.yMm - anchorMin.minYMm
        }
      : rigidTransformForPlacement(bboxSource, placement)
  if (!t) return params // no transformable geometry — identity

  const out: Record<string, unknown> = { ...params }
  if (Array.isArray(rawContour)) {
    out['contourPoints'] = transformRawPointArray(rawContour, t)
  }
  if (Array.isArray(rawIslands)) {
    out['islandRings'] = rawIslands.map((ring) =>
      Array.isArray(ring) ? transformRawPointArray(ring, t) : ring
    )
  }
  if (Array.isArray(rawDrills)) {
    out['drillPoints'] = transformRawPointArray(rawDrills, t)
  }
  return out
}
