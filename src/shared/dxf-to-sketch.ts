/**
 * DXF → sketch (DesignFileV2) converter — the data-path bridge that makes the
 * `dxf:import` IPC reachable for the Laguna 2.5D wood loop (Wave-3d INTEGRATE).
 *
 * `parseDxf` (src/shared/dxf-parser.ts) yields flat geometric primitives; the
 * `dxf:import` main handler additionally `convertDxfToMm`s them, so the entities
 * that arrive here are already millimetre-space. This module folds those
 * primitives into a {@link DesignFileV2} sketch model — the SAME model
 * `cam-2d-derive.ts` reads (`listContourCandidatesFromDesign` /
 * `deriveContourPointsFromDesign` / `deriveDrillPointsFromDesign`). Once a DXF is
 * imported and saved via `design:save`, the existing "Derive geometry from
 * sketch" path in the Manufacture op editor can feed contour / pocket / V-carve /
 * drill ops — no canvas required (data path only, per the wave brief).
 *
 * It is intentionally **pure** (no React, no IPC, no `window`) so it unit-tests
 * in the `node` vitest env and can be called from either the renderer host or a
 * future main-side importer.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * G-CODE SAFETY
 * ──────────────────────────────────────────────────────────────────────────
 * This converter produces *sketch geometry only* — it never emits, mutates, or
 * posts a toolpath. The Laguna RichAuto/Mach3 invariants (`%` tape markers,
 * `G21/G90/G17`, `M3` warm-up `G4 P2`, `M5`+`G4 P3` cool-down, dust `M7/M9`,
 * pre-cut safe-Z, `M30` terminator) and the V-carve depth cap to stock thickness
 * all live downstream in cam-local → cam-runner-2d → vcarve_mach3.hbs and are
 * untouched here.
 *
 * ── Mapping (DXF primitive → DesignFileV2 entity) ──
 *   - LINE              → polyline (2 point-ids, open). Two endpoints.
 *   - LWPOLYLINE/POLYLINE → polyline (point-ids, `closed` preserved). The closed
 *                          flag is what V-carve / pocket / contour derive needs —
 *                          a closed loop yields a machinable boundary. Bulge arcs
 *                          (group-42 curvature) are tessellated into intermediate
 *                          points (chord deviation ≤ BULGE_CHORD_TOLERANCE_MM,
 *                          ≤ BULGE_MAX_SEGMENTS per arc) so sign-lettering curves
 *                          survive the import; b == 0 stays a straight segment.
 *   - CIRCLE            → circle entity (cx, cy, r). Feeds BOTH the contour
 *                          candidates (closed loop) AND the drill-point derive
 *                          (`deriveDrillPointsFromDesign` maps circles → points).
 *   - ARC               → polyline sampled along the sweep (open). A DXF arc is a
 *                          partial circle (never closed), so it lands as an open
 *                          polyline; it becomes a contour candidate only if it
 *                          happens to be tessellated into ≥3 points AND closed,
 *                          which an open arc is not — included for fidelity.
 *
 * Degenerate primitives (zero-radius circles/arcs, <2-point polylines, coincident
 * line endpoints) are dropped with a warning rather than emitted, so the derive
 * path never sees an un-machinable artefact.
 */
import {
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from './design-schema'
import type {
  DxfArc,
  DxfCircle,
  DxfEntity,
  DxfLine,
  DxfParseResult,
  DxfPolyline,
  Point2D
} from './dxf-parser'

/** Result of folding a DXF parse into a sketch — the new design plus human notes. */
export interface DxfToSketchResult {
  /** The merged (or replaced) design with the DXF geometry added. */
  readonly design: DesignFileV2
  /** How many DXF entities became a sketch entity. */
  readonly importedCount: number
  /** How many DXF entities were dropped as degenerate / unusable. */
  readonly skippedCount: number
  /** Human-facing notes (degenerate drops, linearised bulges, unit fallbacks). */
  readonly notes: string[]
}

/** Options controlling the merge. */
export interface DxfToSketchOptions {
  /**
   * When `true`, the DXF geometry REPLACES the base design's entities/points
   * (a clean re-import). When `false` (default) it is ADDED to whatever the base
   * design already holds — additive so a DXF import can't clobber CAD geometry.
   */
  readonly replace?: boolean
  /**
   * Id prefix for the generated entities/points. A stable, collision-resistant
   * prefix keeps repeated imports from colliding with prior ids. Defaults to a
   * timestamp-seeded `dxf` tag.
   */
  readonly idPrefix?: string
}

/** Minimum squared distance for two points to be considered distinct (mm²). */
const COINCIDENT_EPS_SQ = 1e-12

/** How many straight segments approximate one full revolution of a DXF arc. */
const ARC_SAMPLE_SEGMENTS_PER_TURN = 64

/**
 * Max chord-to-arc deviation (sagitta of one tessellation segment) allowed before
 * another segment is added, in mm. 0.05 mm is well below a router/V-bit's practical
 * surface fidelity, so a bulge arc round-trips as "curved" rather than faceted.
 */
const BULGE_CHORD_TOLERANCE_MM = 0.05

/** Hard cap on segments emitted for a single bulge arc (keeps point counts bounded). */
const BULGE_MAX_SEGMENTS = 64

/** Below this |bulge| a segment is treated as straight (matches the parser's epsilon). */
const BULGE_STRAIGHT_EPS = 1e-9

/** Squared planar distance between two points. */
function distSq(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Tessellate one DXF bulge arc into intermediate points.
 *
 * A DXF bulge `b` on the segment from `p0`→`p1` encodes a circular arc whose
 * included (signed) sweep is `θ = 4·atan(b)` — `b > 0` sweeps CCW, `b < 0` CW.
 * `b == 0` is a straight segment (caller handles that and never calls this).
 *
 * Geometry (robust, derived from the bulge directly — no chord/radius division
 * that blows up for half-circles):
 *   - chord midpoint `m = (p0 + p1) / 2`
 *   - the arc apex (its midpoint) sits a sagitta `s = b · (|chord| / 2)` off `m`
 *     along the chord normal; the circle through p0, apex, p1 gives center+radius.
 *
 * Returns ONLY the interior points (p0 and p1 are emitted by the caller as the
 * polyline's own vertices, so this never duplicates an endpoint). The segment
 * count comes from the {@link BULGE_CHORD_TOLERANCE_MM} chord-deviation budget,
 * floored at 1 segment (→ 0 interior points) and hard-capped at
 * {@link BULGE_MAX_SEGMENTS}.
 */
export function tessellateBulgeArc(p0: Point2D, p1: Point2D, bulge: number): Point2D[] {
  if (Math.abs(bulge) <= BULGE_STRAIGHT_EPS) return []
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const chord = Math.hypot(dx, dy)
  if (!(chord > 0)) return [] // coincident endpoints → no arc to sample

  // Included sweep angle (signed). |θ| ∈ (0, 2π); sign carries CCW/CW.
  const theta = 4 * Math.atan(bulge)
  // Radius from the half-angle: r = (chord/2) / sin(θ/2). |sin(θ/2)| > 0 here
  // because |bulge| > eps ⇒ |θ| > 0.
  const halfTheta = theta / 2
  const sinHalf = Math.sin(halfTheta)
  const radius = chord / 2 / Math.abs(sinHalf)

  // Center: from the chord midpoint, step along the chord-normal by the apothem
  // distance `d = (chord/2) / tan(θ/2)`. The normal direction is chosen so the
  // bulge sign yields the correct arc side (left of p0→p1 for b > 0).
  const mx = (p0.x + p1.x) / 2
  const my = (p0.y + p1.y) / 2
  // Unit normal to the chord (left-hand: rotate chord dir +90°).
  const nx = -dy / chord
  const ny = dx / chord
  const apothem = chord / 2 / Math.tan(halfTheta) // signed with θ
  const cx = mx + nx * apothem
  const cy = my + ny * apothem

  // Segment count from chord-deviation tolerance. The max segment sagitta is
  // r·(1 − cos(Δ/2)) for per-segment sweep Δ = |θ|/n; solve n so sagitta ≤ tol.
  const absTheta = Math.abs(theta)
  let n = 1
  const tol = BULGE_CHORD_TOLERANCE_MM
  if (radius > tol) {
    const maxDelta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / radius)))
    if (maxDelta > 0) n = Math.ceil(absTheta / maxDelta)
  }
  n = Math.max(1, Math.min(BULGE_MAX_SEGMENTS, n))
  if (n <= 1) return []

  // Sample interior points by sweeping the start-angle toward the end-angle.
  const startAngle = Math.atan2(p0.y - cy, p0.x - cx)
  const out: Point2D[] = []
  for (let i = 1; i < n; i++) {
    const a = startAngle + (theta * i) / n
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
  }
  return out
}

/**
 * A small id minter — deterministic given the prefix, so a converter run is
 * reproducible (important for the snapshot/engine tests and stable project
 * diffs). Point ids and entity ids share the counter space but carry distinct
 * suffixes so they never collide.
 */
class IdMinter {
  private n = 0
  constructor(private readonly prefix: string) {}
  point(): string {
    return `${this.prefix}_p${this.n++}`
  }
  entity(tag: string): string {
    return `${this.prefix}_${tag}${this.n++}`
  }
}

/** Push a sketch point into the registry and return its id. */
function addPoint(points: Record<string, SketchPoint>, ids: IdMinter, p: Point2D): string {
  const id = ids.point()
  points[id] = { x: p.x, y: p.y }
  return id
}

/** Sample a DXF arc (degrees, CCW from start→end) into ordered planar points. */
function sampleArcPoints(arc: DxfArc): Point2D[] {
  const start = arc.startAngleDeg
  // DXF arcs sweep CCW from start to end; normalise the positive sweep span.
  let sweep = arc.endAngleDeg - start
  while (sweep <= 0) sweep += 360
  while (sweep > 360) sweep -= 360
  const segCount = Math.max(2, Math.ceil((sweep / 360) * ARC_SAMPLE_SEGMENTS_PER_TURN))
  const pts: Point2D[] = []
  for (let i = 0; i <= segCount; i++) {
    const a = ((start + (sweep * i) / segCount) * Math.PI) / 180
    pts.push({ x: arc.center.x + arc.radius * Math.cos(a), y: arc.center.y + arc.radius * Math.sin(a) })
  }
  return pts
}

/** Collapse consecutive coincident points (DXF authoring tools sometimes emit dupes). */
function dedupeConsecutive(pts: Point2D[]): Point2D[] {
  const out: Point2D[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && distSq(last, p) <= COINCIDENT_EPS_SQ) continue
    out.push(p)
  }
  return out
}

interface ConvertedEntity {
  entity: SketchEntity
  /** Points to register, keyed by the ids the entity references. */
  newPoints: Array<{ id: string; point: SketchPoint }>
}

/** LINE → 2-point open polyline (or null when the endpoints coincide). */
function convertLine(line: DxfLine, points: Record<string, SketchPoint>, ids: IdMinter): ConvertedEntity | null {
  const [a, b] = line.points
  if (distSq(a, b) <= COINCIDENT_EPS_SQ) return null
  const idA = addPoint(points, ids, a)
  const idB = addPoint(points, ids, b)
  return {
    entity: { id: ids.entity('line'), kind: 'polyline', pointIds: [idA, idB], closed: false },
    newPoints: []
  }
}

/** CIRCLE → circle entity (or null when the radius is non-positive). */
function convertCircle(circle: DxfCircle, ids: IdMinter): ConvertedEntity | null {
  if (!(circle.radius > 0)) return null
  return {
    entity: { id: ids.entity('circle'), kind: 'circle', cx: circle.center.x, cy: circle.center.y, r: circle.radius },
    newPoints: []
  }
}

/** ARC → sampled open polyline (or null when degenerate). */
function convertArc(arc: DxfArc, points: Record<string, SketchPoint>, ids: IdMinter): ConvertedEntity | null {
  if (!(arc.radius > 0)) return null
  const sampled = dedupeConsecutive(sampleArcPoints(arc))
  if (sampled.length < 2) return null
  const pointIds = sampled.map((p) => addPoint(points, ids, p))
  return {
    entity: { id: ids.entity('arc'), kind: 'polyline', pointIds, closed: false },
    newPoints: []
  }
}

/**
 * Collapse consecutive coincident (vertex, bulge) pairs in lock-step.
 *
 * `bulges[i]` describes the segment LEAVING vertex `i`; when a duplicate vertex is
 * dropped we keep the *surviving* vertex's outgoing bulge (the dropped vertex had a
 * zero-length outgoing segment, so its bulge is meaningless). Mirrors
 * {@link dedupeConsecutive} but threads the parallel bulge array.
 */
function dedupeVertsAndBulges(
  pts: ReadonlyArray<Point2D>,
  bulges: ReadonlyArray<number>
): { verts: Point2D[]; bulges: number[] } {
  const outV: Point2D[] = []
  const outB: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const last = outV[outV.length - 1]
    if (last && distSq(last, p) <= COINCIDENT_EPS_SQ) continue
    outV.push(p)
    outB.push(bulges[i] ?? 0)
  }
  return { verts: outV, bulges: outB }
}

/**
 * LWPOLYLINE / POLYLINE → polyline entity (point-ids), `closed` preserved.
 *
 * Each segment that carries a non-zero `bulge` is tessellated into a circular arc
 * (see {@link tessellateBulgeArc}); the interior arc points are inserted between
 * the two vertices so the emitted path follows the curve within
 * {@link BULGE_CHORD_TOLERANCE_MM}. A `bulge == 0` segment stays a straight chord.
 * For a closed polyline the closing segment (last vertex → first vertex) is
 * tessellated too when it bulges, so rounded-rectangle loops stay closed AND
 * curved (machinable boundary). Straight-only polylines are byte-for-byte
 * unchanged from the prior behaviour.
 *
 * Returns null when fewer than 2 distinct vertices remain after de-duping.
 * `hadBulge` is reported so the caller can surface a "bulge tessellated" note.
 */
function convertPolyline(
  poly: DxfPolyline,
  points: Record<string, SketchPoint>,
  ids: IdMinter
): { converted: ConvertedEntity | null; hadBulge: boolean } {
  const hadBulge = poly.bulges.some((b) => Math.abs(b) > BULGE_STRAIGHT_EPS)
  let { verts, bulges } = dedupeVertsAndBulges(poly.points, poly.bulges)
  // A closed polyline that repeats its first point as the last vertex would
  // create a zero-length closing segment — drop the trailing dupe (and its bulge).
  if (poly.closed && verts.length >= 2 && distSq(verts[0]!, verts[verts.length - 1]!) <= COINCIDENT_EPS_SQ) {
    verts = verts.slice(0, -1)
    bulges = bulges.slice(0, -1)
  }
  if (verts.length < 2) return { converted: null, hadBulge }

  // Walk the vertices in order, emitting each vertex then any interior arc points
  // for the bulge on the segment leaving it. The closing segment (closed only) is
  // appended last; its end vertex (verts[0]) is NOT re-emitted (already first).
  const path: Point2D[] = []
  const lastIdx = verts.length - 1
  for (let i = 0; i < verts.length; i++) {
    path.push(verts[i]!)
    const next = i < lastIdx ? verts[i + 1]! : poly.closed ? verts[0]! : undefined
    if (next) {
      const b = bulges[i] ?? 0
      if (Math.abs(b) > BULGE_STRAIGHT_EPS) {
        for (const ip of tessellateBulgeArc(verts[i]!, next, b)) path.push(ip)
      }
    }
  }

  const pointIds = path.map((p) => addPoint(points, ids, p))
  return {
    converted: {
      entity: { id: ids.entity('poly'), kind: 'polyline', pointIds, closed: poly.closed },
      newPoints: []
    },
    hadBulge
  }
}

/**
 * Convert one DXF entity. Returns the converted sketch entity (registering any
 * new points into `points`) or null when the primitive is unusable. The
 * `notes`/counters are threaded by the caller.
 */
function convertEntity(
  e: DxfEntity,
  points: Record<string, SketchPoint>,
  ids: IdMinter
): { converted: ConvertedEntity | null; bulgeTessellated: boolean } {
  switch (e.type) {
    case 'line':
      return { converted: convertLine(e, points, ids), bulgeTessellated: false }
    case 'circle':
      return { converted: convertCircle(e, ids), bulgeTessellated: false }
    case 'arc':
      return { converted: convertArc(e, points, ids), bulgeTessellated: false }
    case 'polyline': {
      const { converted, hadBulge } = convertPolyline(e, points, ids)
      return { converted, bulgeTessellated: hadBulge && converted !== null }
    }
    default: {
      // Exhaustive over DxfEntity — a new primitive type would surface here.
      const _never: never = e
      void _never
      return { converted: null, bulgeTessellated: false }
    }
  }
}

/**
 * Fold a parsed DXF into a sketch design. Pure; does not mutate `base`.
 *
 * The returned design's `entities`/`points` either REPLACE the base's (when
 * `options.replace`) or are appended to them (default — additive). Every other
 * field of `base` (parameters, constraints, dimensions, extrude settings, sketch
 * plane) is preserved untouched.
 *
 * Callers should ensure the DXF was already unit-normalised to mm (the
 * `dxf:import` IPC does this via `convertDxfToMm`); if `parse.units` is still
 * `'inches'` a note is added so the operator can re-check scale.
 */
export function dxfToSketch(
  parse: DxfParseResult,
  base: DesignFileV2 = emptyDesign(),
  options: DxfToSketchOptions = {}
): DxfToSketchResult {
  const notes: string[] = []
  const prefix = options.idPrefix ?? `dxf${Date.now().toString(36)}`
  const ids = new IdMinter(prefix)

  // Start from a copy so `base` is never mutated.
  const points: Record<string, SketchPoint> = options.replace ? {} : { ...base.points }
  const baseEntities: SketchEntity[] = options.replace ? [] : [...base.entities]
  const newEntities: SketchEntity[] = []

  let imported = 0
  let skipped = 0
  let bulgeCount = 0

  for (const e of parse.entities) {
    const { converted, bulgeTessellated } = convertEntity(e, points, ids)
    if (!converted) {
      skipped++
      continue
    }
    for (const np of converted.newPoints) points[np.id] = np.point
    newEntities.push(converted.entity)
    imported++
    if (bulgeTessellated) bulgeCount++
  }

  if (parse.units === 'inches') {
    notes.push(
      'DXF declared inch units but was not converted to mm — verify scale (the dxf:import IPC normally converts).'
    )
  } else if (parse.units === 'unknown') {
    notes.push('DXF units were not declared; coordinates were imported as-is (assumed mm).')
  }
  if (bulgeCount > 0) {
    notes.push(
      `${bulgeCount} polyline${bulgeCount === 1 ? '' : 's'} had bulge arcs that were tessellated into curve segments (within ${BULGE_CHORD_TOLERANCE_MM} mm).`
    )
  }
  if (skipped > 0) {
    notes.push(`${skipped} degenerate DXF entit${skipped === 1 ? 'y was' : 'ies were'} skipped (zero size / coincident points).`)
  }
  // Surface parser-level warnings (unsupported entity types, spline approximations)
  // so the operator sees them in the same place as the conversion notes.
  for (const w of parse.warnings) notes.push(w.message)

  const design: DesignFileV2 = {
    ...base,
    points,
    entities: [...baseEntities, ...newEntities]
  }

  return { design, importedCount: imported, skippedCount: skipped, notes }
}
