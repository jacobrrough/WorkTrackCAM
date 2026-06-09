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
 *                          are linearised to their straight vertices (the parser
 *                          already drops bulge curvature; a warning is surfaced).
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

/** Squared planar distance between two points. */
function distSq(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
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
 * LWPOLYLINE / POLYLINE → polyline entity (point-ids), `closed` preserved.
 * Returns null when fewer than 2 distinct vertices remain after de-duping.
 * `hadBulge` is reported so the caller can surface a "bulge linearised" note.
 */
function convertPolyline(
  poly: DxfPolyline,
  points: Record<string, SketchPoint>,
  ids: IdMinter
): { converted: ConvertedEntity | null; hadBulge: boolean } {
  const hadBulge = poly.bulges.some((b) => Math.abs(b) > 1e-9)
  let verts = dedupeConsecutive(poly.points)
  // A closed polyline that repeats its first point as the last vertex would
  // create a zero-length closing segment — drop the trailing dupe.
  if (poly.closed && verts.length >= 2 && distSq(verts[0]!, verts[verts.length - 1]!) <= COINCIDENT_EPS_SQ) {
    verts = verts.slice(0, -1)
  }
  if (verts.length < 2) return { converted: null, hadBulge }
  const pointIds = verts.map((p) => addPoint(points, ids, p))
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
): { converted: ConvertedEntity | null; bulgeLinearised: boolean } {
  switch (e.type) {
    case 'line':
      return { converted: convertLine(e, points, ids), bulgeLinearised: false }
    case 'circle':
      return { converted: convertCircle(e, ids), bulgeLinearised: false }
    case 'arc':
      return { converted: convertArc(e, points, ids), bulgeLinearised: false }
    case 'polyline': {
      const { converted, hadBulge } = convertPolyline(e, points, ids)
      return { converted, bulgeLinearised: hadBulge && converted !== null }
    }
    default: {
      // Exhaustive over DxfEntity — a new primitive type would surface here.
      const _never: never = e
      void _never
      return { converted: null, bulgeLinearised: false }
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
    const { converted, bulgeLinearised } = convertEntity(e, points, ids)
    if (!converted) {
      skipped++
      continue
    }
    for (const np of converted.newPoints) points[np.id] = np.point
    newEntities.push(converted.entity)
    imported++
    if (bulgeLinearised) bulgeCount++
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
      `${bulgeCount} polyline${bulgeCount === 1 ? '' : 's'} had bulge arcs that were linearised to straight segments.`
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
