/**
 * cam-placement-siblings.ts — Wave 3l: nesting placement stamp planner.
 *
 * Wave 3j wrote nesting placements ONLY onto the `cnc_contour` op whose
 * outline polygon the nest actually placed (partId === op.id — one op per
 * nested polygon). Wave 3k made the 2D CAM dispatcher consume those params.
 * That left every COMPANION op of the same physical part — the pocket,
 * v-carve, chamfer, and drill ops whose 2D geometry lives inside the same
 * part outline in the same sketch frame — cutting at the UN-NESTED origin
 * while the part outline moved to its nested position: a scrapped sheet.
 *
 * This module plans the COMPLETE stamp set for one "Apply layout" pass.
 * The executor (`applyNestingPlacements` in ManufactureWorkspace.tsx) stays
 * a thin pinned loop; every association decision lives here, pure and
 * unit-tested (cam-placement-siblings.test.ts).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASSOCIATION RULE (the documented Wave 3l contract)
 *
 * A companion op C is stamped with the placement of nested contour op A iff
 * ALL of the following hold:
 *
 *   1. KIND — C.kind ∈ {cnc_pocket, cnc_vcarve, cnc_chamfer, cnc_drill}:
 *      the 2D kinds whose geometry params share the part's sketch frame.
 *      PCB kinds are excluded (boards are not nested on the Laguna sheet
 *      flow), as is cnc_contour (a second closed outline nests as its OWN
 *      polygon today — it is a direct placement, never a companion).
 *   2. NOT ITSELF NESTED — C has no direct placement of its own. The nest
 *      only places cnc_contour outlines; a placement keyed to a non-contour
 *      op id is ignored entirely (mirrors the executor's kind guard).
 *   3. SAME SETUP — C and A resolve the same `params.setupId` (trimmed;
 *      blank/missing both count as the "(Unassigned)" group), matching the
 *      operation tree's setup association (`getOpSetupId`,
 *      ManufactureOperationList.tsx).
 *   4. GEOMETRIC CONTAINMENT — EVERY parseable 2D point of C
 *      (`contourPoints` + every `islandRings` ring + `drillPoints`, parsed
 *      with the dispatcher's exact point semantics) lies inside-or-on A's
 *      outer polygon (A's valid `contourPoints`) in the SHARED un-nested
 *      sketch frame. This is the honest test of "same part outline /
 *      coordinate frame": 2D ops in this app derive from one shared sketch
 *      frame, so geometry inside the placed outline IS that part's
 *      machining. On-edge counts (a chamfer op traces the very outline
 *      polygon the nest placed).
 *   5. UNIQUENESS — exactly ONE nested contour op satisfies 3+4. If the
 *      points fit inside two nested outlines (e.g. two sketches drawn
 *      overlapping around the same origin, or a cutout outline nested
 *      inside its parent outline), the planner refuses to guess and stamps
 *      nothing: the op keeps cutting at the un-nested origin exactly as it
 *      did before Wave 3l, and never moves to the WRONG part's position.
 *
 * Ops with no parseable 2D geometry are never stamped (rule 4 would be
 * unprovable). A drill op whose points span TWO parts fails rule 4 for
 * both anchors and is skipped — one rigid transform cannot place holes on
 * two independently-nested parts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PLAN CARRIES AN ANCHOR (placementAnchorMinXMm / placementAnchorMinYMm)
 *
 * The dispatcher transform (`applyPlacementToOperationParams2d`) translates
 * by "rotated bbox min-corner of the op's OWN outer geometry → (xMm, yMm)".
 * Stamping A's (xMm, yMm, rotationDeg) alone onto C would therefore park
 * C's OWN bbox corner at the PART's corner position — the pocket would cut
 * at the part outline's corner instead of its true offset inside the part.
 * The companion stamp instead carries the rotated bbox min of A's outline
 * (computed here with the SAME `rotatePointCcwDeg` kernel the dispatcher
 * uses, so cardinal rotations stay bit-identical), and the dispatcher
 * derives the translation from that anchor. Net effect: companion ops get
 * the EXACT same rigid transform as their part outline — rotation about the
 * shared local origin plus the shared translation — so the part's internal
 * layout survives nesting. See cam-placement-transform.ts (Wave 3l note).
 *
 * SAFETY (G-code is sacred): this module emits NO motion and never mutates
 * its inputs. Refusing to stamp always degrades to the pre-Wave-3l
 * behavior (op cuts at the un-nested origin) — never to a guessed position.
 */
import type { ManufactureOperation } from './manufacture-schema'
import { rotatePointCcwDeg } from './cam-placement-transform'

/** One placement row as produced by the nesting engines / nesting panel. */
export interface NestedPlacementInput {
  /** The nested polygon id — by Wave 3j convention, the contour op id. */
  partId: string
  /** Sheet X (mm) where the rotated part outline's bbox min-corner lands. */
  xMm: number
  /** Sheet Y (mm) where the rotated part outline's bbox min-corner lands. */
  yMm: number
  /** CCW rotation in degrees about the part's local origin. */
  rotationDeg: number
  /** Sheet the part landed on; absent = sheet 0. >0 ⇒ the executor strips. */
  sheetIndex?: number
}

/** One planned stamp for one op id. */
export interface PlacementStampEntry {
  /** The placement to stamp (sheetIndex > 0 ⇒ the executor strips instead). */
  placement: NestedPlacementInput
  /** True when inherited from the part's contour op via the association rule. */
  viaSibling: boolean
  /**
   * Companion stamps only: rotated-bbox-min X (mm) of the part outline (the
   * contour op's valid contourPoints rotated CCW by placement.rotationDeg
   * about the local origin). Written to `placementAnchorMinXMm` so
   * `applyPlacementToOperationParams2d` gives the companion the part's
   * exact rigid transform instead of an own-bbox translation.
   */
  anchorMinXMm?: number
  /** Companion stamps only: rotated-bbox-min Y (mm) of the part outline. */
  anchorMinYMm?: number
}

/** 2D op kinds eligible for companion stamping (association rule 1). */
export const COMPANION_2D_OP_KINDS: ReadonlyArray<ManufactureOperation['kind']> = [
  'cnc_pocket',
  'cnc_vcarve',
  'cnc_chamfer',
  'cnc_drill'
]

const COMPANION_KIND_SET: ReadonlySet<ManufactureOperation['kind']> = new Set(
  COMPANION_2D_OP_KINDS
)

/**
 * On-edge tolerance (mm) for containment rule 4. Large enough to absorb
 * float noise on shared vertices (a chamfer op carrying the exact outline
 * polygon), orders of magnitude below any machinable feature.
 */
const ON_EDGE_EPS_MM = 1e-6

/**
 * Parse one raw param entry as a 2D point with EXACTLY the dispatcher's
 * `point2d` semantics (cam-runner-2d.ts / cam-placement-transform.ts):
 * array of length >= 2, Number() coercion on the first two slots, both
 * finite. Duplicated here because the transform module keeps its parser
 * private — the semantics MUST stay in lockstep with the dispatcher so the
 * anchor bbox below equals the bbox the dispatcher derives for the contour
 * op itself.
 */
function parsePoint2dLikeDispatcher(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const x = Number(v[0])
  const y = Number(v[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

/** All dispatcher-parseable points of one raw point-array param. */
function validPoints(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return []
  const out: [number, number][] = []
  for (const entry of v) {
    const p = parsePoint2dLikeDispatcher(entry)
    if (p) out.push(p)
  }
  return out
}

/**
 * Setup association, mirroring `getOpSetupId` (ManufactureOperationList.tsx):
 * `params.setupId` as a trimmed non-empty string, else undefined (the
 * synthetic "(Unassigned)" group). Re-implemented here because shared
 * modules must not import renderer code.
 */
function opSetupId(op: ManufactureOperation): string | undefined {
  const raw = op.params?.['setupId']
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Inside-or-on containment test (association rule 4). On-segment within
 * ON_EDGE_EPS_MM counts as inside; otherwise an even-odd ray cast decides.
 */
function pointInOrOnPolygon(
  px: number,
  py: number,
  polygon: ReadonlyArray<readonly [number, number]>
): boolean {
  const n = polygon.length
  if (n < 3) return false
  // On-edge first: companion geometry frequently SHARES outline vertices
  // (cnc_chamfer traces the nested polygon itself) and a pure ray cast is
  // ambiguous exactly on the boundary.
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % n]!
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const apx = px - a[0]
    const apy = py - a[1]
    const len2 = abx * abx + aby * aby
    const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2)) : 0
    const dx = apx - t * abx
    const dy = apy - t * aby
    if (dx * dx + dy * dy <= ON_EDGE_EPS_MM * ON_EDGE_EPS_MM) return true
  }
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]![0]
    const yi = polygon[i]![1]
    const xj = polygon[j]![0]
    const yj = polygon[j]![1]
    const crosses = yi > py !== yj > py
    if (crosses) {
      const xCross = ((xj - xi) * (py - yi)) / (yj - yi) + xi
      if (px < xCross) inside = !inside
    }
  }
  return inside
}

/**
 * Min-corner of the polygon's bbox AFTER rotating CCW by `rotationDeg`
 * about the local origin — the same quantity `rigidTransformForPlacement`
 * derives for the contour op, computed with the same rotation kernel so
 * cardinal rotations stay bit-identical.
 */
function rotatedBboxMin(
  points: ReadonlyArray<readonly [number, number]>,
  rotationDeg: number
): [number, number] {
  let minX = Infinity
  let minY = Infinity
  for (const [x, y] of points) {
    const [rx, ry] = rotatePointCcwDeg(x, y, rotationDeg)
    if (rx < minX) minX = rx
    if (ry < minY) minY = ry
  }
  return [minX, minY]
}

/** Every dispatcher-parseable 2D point the op's geometry params carry. */
function companionGeometryPoints(op: ManufactureOperation): [number, number][] {
  const params = op.params ?? {}
  const points: [number, number][] = validPoints(params['contourPoints'])
  const rings = params['islandRings']
  if (Array.isArray(rings)) {
    for (const ring of rings) {
      points.push(...validPoints(ring))
    }
  }
  points.push(...validPoints(params['drillPoints']))
  return points
}

/**
 * Plan the COMPLETE placement-stamp set for one "Apply layout" pass.
 *
 * Returns a map opId → stamp entry covering:
 *   - DIRECT stamps: every cnc_contour op whose id matches a placement
 *     partId (`viaSibling: false`, no anchor — the contour op's own outline
 *     IS the transform anchor downstream).
 *   - COMPANION stamps: every op the ASSOCIATION RULE (module header) ties
 *     to exactly one nested contour op (`viaSibling: true`, with the part
 *     outline's rotated-bbox-min anchor).
 *
 * Ops absent from the map are NOT touched by the apply pass — neither
 * stamped nor stripped. Overflow parts (sheetIndex > 0) DO get entries
 * (direct and companion) so the executor can strip their stale placement
 * params; the sheet branch is the executor's job, not the planner's.
 *
 * Pure: never mutates `operations` or `placements`.
 */
export function planNestingPlacementStamps(
  operations: ReadonlyArray<ManufactureOperation>,
  placements: ReadonlyArray<NestedPlacementInput>
): Map<string, PlacementStampEntry> {
  const plan = new Map<string, PlacementStampEntry>()
  if (placements.length === 0) return plan
  const placementByPartId = new Map(placements.map((pl) => [pl.partId, pl] as const))

  interface AnchorRecord {
    setupId: string | undefined
    polygon: [number, number][]
    placement: NestedPlacementInput
  }
  const anchors: AnchorRecord[] = []

  for (const op of operations) {
    const direct = placementByPartId.get(op.id)
    if (!direct) continue
    // The nest only places cnc_contour outlines (LagunaNestingPanel
    // nestableParts); a placement keyed to any other kind is ignored —
    // mirroring the executor's `op.kind !== 'cnc_contour'` guard.
    if (op.kind !== 'cnc_contour') continue
    plan.set(op.id, { placement: direct, viaSibling: false })
    const polygon = validPoints(op.params?.['contourPoints'])
    if (polygon.length >= 3) {
      anchors.push({ setupId: opSetupId(op), polygon, placement: direct })
    }
  }

  if (anchors.length === 0) return plan

  for (const op of operations) {
    if (plan.has(op.id) || placementByPartId.has(op.id)) continue
    if (!COMPANION_KIND_SET.has(op.kind)) continue
    const points = companionGeometryPoints(op)
    if (points.length === 0) continue // rule 4 unprovable — nothing to verify
    const setupId = opSetupId(op)
    const containing = anchors.filter(
      (anchor) =>
        anchor.setupId === setupId &&
        points.every((p) => pointInOrOnPolygon(p[0], p[1], anchor.polygon))
    )
    // 0 containing: another part's geometry. 2+: ambiguous (overlapping
    // outlines in the shared sketch frame). Either way — never guess.
    if (containing.length !== 1) continue
    const anchor = containing[0]!
    const [anchorMinXMm, anchorMinYMm] = rotatedBboxMin(
      anchor.polygon,
      anchor.placement.rotationDeg
    )
    plan.set(op.id, {
      placement: anchor.placement,
      viaSibling: true,
      anchorMinXMm,
      anchorMinYMm
    })
  }

  return plan
}
