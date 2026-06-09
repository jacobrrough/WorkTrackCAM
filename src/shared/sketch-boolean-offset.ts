/**
 * Offset + Boolean sketch-geometry engine for WorkTrack3D.
 *
 * Closes the "Vectors · Edit → Offset / Boolean (weld)" daily-use gap in
 * docs/plans/catalog/vcarve-laguna.md (both marked `missing`, P1) for the Laguna
 * Swift sign / cabinet workflow. Offset (inset/outset by a signed distance) and
 * Boolean (union / difference / intersection of closed loops) are the two CAD-prep
 * operations a VCarve user reaches for constantly — e.g. outset a letter outline to
 * make a keep-out, or subtract one closed shape from another before profiling.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PURE — no I/O, no `window`, no React
 * ──────────────────────────────────────────────────────────────────────────
 * Mirrors its sibling pure model folders {@link ./text-to-vectors} and
 * {@link ./dxf-to-sketch}: it takes a {@link DesignFileV2} (or a raw entity list)
 * and returns a NEW design with the result loops merged in ADDITIVELY via an
 * {@link IdMinter}. It NEVER mutates the base design. The output is closed
 * `polyline` {@link SketchEntity} loops that drop straight into the same model the
 * live `SketchSurface` edits and that `cam-2d-derive.ts`
 * (`listContourCandidatesFromDesign`) reads to derive contour / pocket / V-carve
 * toolpaths — so an offset or boolean result is just another machinable profile.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CLIPPER + THE INTEGER SCALE FACTOR
 * ──────────────────────────────────────────────────────────────────────────
 * Geometry runs on Angus Johnson's Clipper (`clipper-lib`, Boost Software
 * License — the CAM-standard polygon boolean+offset library; it does BOTH the
 * boolean ops and `ClipperOffset`). Clipper operates on INTEGER coordinates, so
 * every sketch-mm coordinate is multiplied by {@link CLIPPER_SCALE} = 1e4 (→ 0.1
 * micron resolution) and rounded to the nearest integer on the way in, then
 * divided back out on the way out. Even the largest target machine — the Laguna's
 * 3048 mm bed — maps to 3.048e7 integer units, far inside Clipper's ~4.5e15 safe
 * space, so there is no overflow risk at this scale.
 *
 * Import shape (Wave-3f build lesson): `clipper-lib` is a CommonJS module
 * (`module.exports = ClipperLib`), so the namespace object lands on `.default`
 * under both Node ESM interop and the electron-vite (Rollup) production build —
 * hence a **default** import (`import ClipperLib from 'clipper-lib'`), NOT the
 * `import * as` namespace form opentype.js (an ESM, named-only package) required.
 * See `src/shared/clipper-lib.d.ts` for the typed surface + the empirical proof.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WINDING / HOLES (machinability contract — matches text-to-vectors + cam-2d-derive)
 * ──────────────────────────────────────────────────────────────────────────
 * Clipper returns each result ring with a signed area whose sign encodes
 * winding. We normalise the emitted geometry to the standard "polygon with holes"
 * representation that {@link ./cam-2d-derive} consumes via even-odd nesting:
 *   - OUTER (solid) rings → oriented CCW (positive shoelace area);
 *   - HOLE rings → oriented CW (negative shoelace area).
 * INPUT loops are first normalised to CCW (solid) and combined with Clipper's
 * NonZero fill rule, so every picked closed entity is treated as a filled region
 * (a sign-maker's mental model: "these closed shapes are my material"). A
 * difference that punches a hole through the middle of a shape therefore comes
 * back as an outer CCW ring plus an inner CW hole ring — exactly what the
 * downstream even-odd derivation expects.
 */
import ClipperLib, { type IntPoint } from 'clipper-lib'
import {
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from './design-schema'
import {
  arcSamplePositions,
  ellipseLoopWorld,
  ELLIPSE_PROFILE_SEGMENTS,
  polylinePositions,
  slotCapsuleLoopWorld,
  SLOT_PROFILE_CAP_SEGMENTS,
  splineCpPolylineFromEntity,
  splineFitPolylineFromEntity,
  worldCornersFromRectParams,
  KERNEL_PROFILE_ARC_SEGMENTS
} from './sketch-profile'

/**
 * mm → Clipper integer scale. 1e4 gives 0.1-micron resolution; the largest target
 * bed (Laguna 3048 mm) maps to 3.048e7 units, far within Clipper's safe integer
 * range. Documented + pinned by the engine tests.
 */
export const CLIPPER_SCALE = 1e4

/** Circle tessellation segment count for offset/boolean (matches cam-2d-derive's circleToLoop). */
const CIRCLE_LOOP_SEGMENTS = 64

/** Default miter limit for offsets (Clipper default is 2; we expose an override). */
const DEFAULT_MITER_LIMIT = 2

/** Drop result rings with fewer than this many vertices (degenerate slivers). */
const MIN_RESULT_RING_VERTICES = 3

type Pt = readonly [number, number]
type ClipperPath = IntPoint[]

/** Corner-join style for {@link offsetSketchEntities}. */
export type OffsetJoinType = 'miter' | 'round' | 'square'

/** Boolean operation for {@link booleanSketchEntities}. */
export type SketchBooleanOp = 'union' | 'difference' | 'intersection'

/** A result loop in sketch mm, already winding-normalised + classified. */
export interface ResultLoop {
  /** Ordered loop vertices (mm). First/last NOT duplicated (loop is implicitly closed). */
  readonly points: Pt[]
  /** True when this ring is an inner hole (CW), false for a solid outer boundary (CCW). */
  readonly isHole: boolean
}

/** Common shape for the additive sketch-model fragment both ops emit. */
export interface SketchOpResult {
  /** The merged design with the result loops added (base never mutated). */
  readonly design: DesignFileV2
  /** Every result ring (outer + holes), winding-normalised with `isHole` set. */
  readonly loops: ResultLoop[]
  /** Closed-polyline entities created (one per result ring), in `design.entities`. */
  readonly entities: SketchEntity[]
  /** Point records the new entities reference (keyed by the ids the entities use). */
  readonly points: Record<string, SketchPoint>
  /** True when the operation produced no geometry (e.g. an inset that collapsed). */
  readonly empty: boolean
}

/**
 * Minimal id minter — deterministic given the prefix (reproducible diffs /
 * snapshots), mirroring {@link ./text-to-vectors} + {@link ./dxf-to-sketch}.
 */
class IdMinter {
  private n = 0
  constructor(private readonly prefix: string) {}
  point(): string {
    return `${this.prefix}_p${this.n++}`
  }
  entity(): string {
    return `${this.prefix}_c${this.n++}`
  }
}

/** Signed shoelace area (×2) in mm². Positive = CCW, negative = CW. */
function signedArea2(points: ReadonlyArray<Pt>): number {
  const n = points.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s
}

/**
 * Closed world-mm loop(s) for ONE sketch entity, matching exactly how
 * `cam-2d-derive` / `extractKernelProfiles` tessellate each closed primitive so an
 * offset/boolean input is byte-for-byte the same profile CAM would derive. Returns
 * an empty array for open or degenerate entities (they cannot bound a region).
 */
export function closedLoopForEntity(
  e: SketchEntity,
  points: Record<string, SketchPoint>
): Pt[] {
  switch (e.kind) {
    case 'polyline': {
      if (!e.closed) return []
      const pts = polylinePositions(e, points)
      return pts.length >= 3 ? pts : []
    }
    case 'rect':
      return worldCornersFromRectParams({ cx: e.cx, cy: e.cy, w: e.w, h: e.h, rotation: e.rotation })
    case 'circle': {
      const out: Pt[] = []
      for (let i = 0; i < CIRCLE_LOOP_SEGMENTS; i++) {
        const t = (i / CIRCLE_LOOP_SEGMENTS) * Math.PI * 2
        out.push([e.cx + e.r * Math.cos(t), e.cy + e.r * Math.sin(t)])
      }
      return out
    }
    case 'slot': {
      const loop = slotCapsuleLoopWorld(e.cx, e.cy, e.length, e.width, e.rotation, SLOT_PROFILE_CAP_SEGMENTS)
      return loop.length >= 3 ? loop : []
    }
    case 'arc': {
      if (!e.closed) return []
      const loop = arcSamplePositions(e, points, KERNEL_PROFILE_ARC_SEGMENTS)
      return loop.length >= 3 ? loop : []
    }
    case 'ellipse': {
      const loop = ellipseLoopWorld(e.cx, e.cy, e.rx, e.ry, e.rotation, ELLIPSE_PROFILE_SEGMENTS)
      return loop.length >= 3 ? loop : []
    }
    case 'spline_fit': {
      if (!e.closed) return []
      const loop = splineFitPolylineFromEntity(e, points)
      return loop && loop.length >= 3 ? loop : []
    }
    case 'spline_cp': {
      if (!e.closed) return []
      const loop = splineCpPolylineFromEntity(e, points)
      return loop && loop.length >= 3 ? loop : []
    }
    default: {
      // Exhaustive over SketchEntity — a new kind would surface here at compile time.
      const _never: never = e
      void _never
      return []
    }
  }
}

/**
 * The ids of every entity in `design` that bounds a CLOSED loop — i.e. every
 * entity {@link closedLoopForEntity} can turn into a ≥3-vertex ring. These are
 * exactly the entities the offset / boolean / array surface lets the operator
 * pick as a subject (an open polyline or a stray point can't bound a region, so
 * it is omitted). Order matches `design.entities` so the selection UI is stable.
 *
 * Pure + side-effect free; shared by the live `SketchSurface` (to list pickable
 * loops) and any future importer, so the "what counts as a closed loop" rule
 * lives in ONE place next to the geometry that consumes it.
 */
export function closedLoopEntityIds(design: DesignFileV2): string[] {
  const out: string[] = []
  for (const e of design.entities) {
    const loop = closedLoopForEntity(e, design.points)
    if (loop.length >= MIN_RESULT_RING_VERTICES) out.push(e.id)
  }
  return out
}

/** Drop consecutive coincident points + any closing duplicate (loop implicitly closed). */
function cleanLoop(pts: ReadonlyArray<Pt>): Pt[] {
  const out: Pt[] = []
  const epsSq = 1e-12
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && (last[0] - p[0]) ** 2 + (last[1] - p[1]) ** 2 <= epsSq) continue
    out.push([p[0], p[1]])
  }
  while (out.length >= 2) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= epsSq) out.pop()
    else break
  }
  return out
}

/** Sketch-mm loop → Clipper integer path (rounded). */
function toClipperPath(pts: ReadonlyArray<Pt>): ClipperPath {
  return pts.map((p) => ({ X: Math.round(p[0] * CLIPPER_SCALE), Y: Math.round(p[1] * CLIPPER_SCALE) }))
}

/** Clipper integer path → sketch-mm loop (cleaned). */
function fromClipperPath(path: ClipperPath): Pt[] {
  const pts: Pt[] = path.map((ip) => [ip.X / CLIPPER_SCALE, ip.Y / CLIPPER_SCALE])
  return cleanLoop(pts)
}

/** Force a loop CCW (positive shoelace) — used to normalise INPUT loops to solids. */
function toCCW(pts: ReadonlyArray<Pt>): Pt[] {
  return signedArea2(pts) >= 0 ? [...pts] : [...pts].reverse()
}

/**
 * Classify Clipper result rings into solid / hole by SIGNED AREA and orient to the
 * cam-2d-derive contract (outer CCW, hole CW). Clipper with NonZero/positive fill
 * returns outer boundaries with positive area and holes with negative area, so the
 * sign IS the classification — no even-odd ray cast needed here.
 */
function classifyResultRings(rings: ReadonlyArray<ReadonlyArray<Pt>>): ResultLoop[] {
  const out: ResultLoop[] = []
  for (const ring of rings) {
    const cleaned = cleanLoop(ring)
    if (cleaned.length < MIN_RESULT_RING_VERTICES) continue
    const area = signedArea2(cleaned)
    const isHole = area < 0
    // Outer → CCW (area > 0); hole → CW (area < 0). Already matches when the
    // sign is consistent; reverse only if Clipper handed back the opposite winding.
    const wantCCW = !isHole
    const points = (area >= 0) === wantCCW ? cleaned : [...cleaned].reverse()
    out.push({ points, isHole })
  }
  return out
}

/** Build the additive sketch-model fragment + merged design from result loops. */
function buildResult(
  loops: ResultLoop[],
  base: DesignFileV2,
  idPrefix: string,
  replace: boolean
): SketchOpResult {
  const ids = new IdMinter(idPrefix)
  const newPoints: Record<string, SketchPoint> = {}
  const newEntities: SketchEntity[] = []

  for (const loop of loops) {
    const pointIds: string[] = []
    for (const [x, y] of loop.points) {
      const id = ids.point()
      newPoints[id] = { x, y }
      pointIds.push(id)
    }
    newEntities.push({ id: ids.entity(), kind: 'polyline', pointIds, closed: true })
  }

  const points: Record<string, SketchPoint> = replace
    ? { ...newPoints }
    : { ...base.points, ...newPoints }
  const entities: SketchEntity[] = replace ? [...newEntities] : [...base.entities, ...newEntities]
  const design: DesignFileV2 = { ...base, points, entities }

  return { design, loops, entities: newEntities, points: newPoints, empty: loops.length === 0 }
}

/** Resolve a Clipper join-type enum from the public {@link OffsetJoinType}. */
function joinTypeEnum(join: OffsetJoinType): number {
  switch (join) {
    case 'round':
      return ClipperLib.JoinType.jtRound
    case 'square':
      return ClipperLib.JoinType.jtSquare
    case 'miter':
    default:
      return ClipperLib.JoinType.jtMiter
  }
}

/** Options for {@link offsetSketchEntities}. Provide exactly one of `design` / `entities`. */
export interface OffsetSketchOptions {
  /** Source design — its closed entities are offset; every other field is preserved. */
  readonly design?: DesignFileV2
  /** OR a bare entity list (a `points` map is then required to resolve point-id loops). */
  readonly entities?: SketchEntity[]
  /** Point registry when `entities` is supplied without a `design`. */
  readonly points?: Record<string, SketchPoint>
  /** Restrict the offset to these entity ids (default: every closed entity). */
  readonly entityIds?: ReadonlyArray<string>
  /** Signed offset distance in mm: `+` outsets (grows), `-` insets (shrinks). */
  readonly distanceMm: number
  /** Corner join style. Default `miter`. */
  readonly joinType?: OffsetJoinType
  /** Miter limit (only used for `miter` joins). Default 2. */
  readonly miterLimit?: number
  /** REPLACE the base entities/points instead of appending (default false = additive). */
  readonly replace?: boolean
  /** Deterministic id prefix for the new entities/points. Default a timestamp tag. */
  readonly idPrefix?: string
}

/**
 * Offset (inset / outset) every closed loop in the source by `distanceMm`.
 *
 * `+distanceMm` grows the loop outward; `-distanceMm` shrinks it inward. When an
 * inset is larger than half the feature's narrowest width the loop collapses and
 * Clipper returns nothing — this yields an EMPTY result (`empty: true`,
 * `entities: []`) and never throws, so the UI can simply report "offset removed
 * the geometry". Pure: `base` is never mutated.
 *
 * @throws only if neither `design` nor `entities` is supplied, or `distanceMm` is
 * not finite.
 */
export function offsetSketchEntities(opts: OffsetSketchOptions): SketchOpResult {
  if (!Number.isFinite(opts.distanceMm)) {
    throw new Error(`offsetSketchEntities: distanceMm must be finite (got ${opts.distanceMm}).`)
  }
  const { base, points, entities } = resolveSource(opts, 'offsetSketchEntities')
  const idPrefix = opts.idPrefix ?? `off${Date.now().toString(36)}`
  const wantIds = opts.entityIds ? new Set(opts.entityIds) : null

  const co = new ClipperLib.ClipperOffset(opts.miterLimit ?? DEFAULT_MITER_LIMIT, 0.25)
  const jt = joinTypeEnum(opts.joinType ?? 'miter')
  const et = ClipperLib.EndType.etClosedPolygon

  let added = 0
  for (const e of entities) {
    if (wantIds && !wantIds.has(e.id)) continue
    const loop = cleanLoop(closedLoopForEntity(e, points))
    if (loop.length < MIN_RESULT_RING_VERTICES) continue
    // Normalise to CCW so a +delta consistently grows (Clipper offsets by +delta on
    // the left side of the path direction; CCW makes "+" the outward normal).
    co.AddPath(toClipperPath(toCCW(loop)), jt, et)
    added++
  }

  if (added === 0) {
    return buildResult([], base, idPrefix, opts.replace ?? false)
  }

  const solution: IntPoint[][] = []
  co.Execute(solution, opts.distanceMm * CLIPPER_SCALE)
  const rings = solution.map(fromClipperPath)
  const loops = classifyResultRings(rings)
  return buildResult(loops, base, idPrefix, opts.replace ?? false)
}

/** Options for {@link booleanSketchEntities}. Provide exactly one of `design` / `entities`. */
export interface BooleanSketchOptions {
  /** Source design — `subjectIds`/`clipIds` reference its closed entities. */
  readonly design?: DesignFileV2
  /** OR a bare entity list (a `points` map is then required). */
  readonly entities?: SketchEntity[]
  /** Point registry when `entities` is supplied without a `design`. */
  readonly points?: Record<string, SketchPoint>
  /** Subject entity ids (the base shapes). At least one closed subject is required. */
  readonly subjectIds: ReadonlyArray<string>
  /** Clip entity ids (the tool shapes). Empty is allowed (union of subjects only). */
  readonly clipIds: ReadonlyArray<string>
  /** Boolean operation. */
  readonly op: SketchBooleanOp
  /** REPLACE the base entities/points instead of appending (default false = additive). */
  readonly replace?: boolean
  /** Deterministic id prefix for the new entities/points. Default a timestamp tag. */
  readonly idPrefix?: string
}

/** Resolve a Clipper clip-type enum from the public {@link SketchBooleanOp}. */
function clipTypeEnum(op: SketchBooleanOp): number {
  switch (op) {
    case 'union':
      return ClipperLib.ClipType.ctUnion
    case 'difference':
      return ClipperLib.ClipType.ctDifference
    case 'intersection':
      return ClipperLib.ClipType.ctIntersection
    default: {
      const _never: never = op
      void _never
      return ClipperLib.ClipType.ctUnion
    }
  }
}

/**
 * Boolean combine (union / difference / intersection) of the subject loops against
 * the clip loops. Each picked closed entity is treated as a SOLID filled region
 * (every input loop normalised to CCW, combined with Clipper's NonZero fill), so
 * overlapping subjects merge and the op reflects the sign-maker's "these closed
 * shapes are my material" model. The result is emitted as closed loops with outer
 * boundaries CCW and any holes (e.g. a difference punching through the middle) CW —
 * the polygon-with-holes shape `cam-2d-derive` reads. Pure: `base` is never mutated.
 *
 * Edge cases (no throw): an empty/degenerate subject set → empty result;
 * `difference` that removes everything → empty; `intersection` of disjoint shapes →
 * empty; `clipIds` empty → union/clean-up of the subjects only.
 *
 * @throws only if neither `design` nor `entities` is supplied.
 */
export function booleanSketchEntities(opts: BooleanSketchOptions): SketchOpResult {
  const { base, points, entities } = resolveSource(opts, 'booleanSketchEntities')
  const idPrefix = opts.idPrefix ?? `bool${Date.now().toString(36)}`

  const byId = new Map<string, SketchEntity>()
  for (const e of entities) byId.set(e.id, e)

  const collect = (idList: ReadonlyArray<string>): ClipperPath[] => {
    const paths: ClipperPath[] = []
    for (const id of idList) {
      const e = byId.get(id)
      if (!e) continue
      const loop = cleanLoop(closedLoopForEntity(e, points))
      if (loop.length < MIN_RESULT_RING_VERTICES) continue
      paths.push(toClipperPath(toCCW(loop)))
    }
    return paths
  }

  const subjectPaths = collect(opts.subjectIds)
  const clipPaths = collect(opts.clipIds)

  // No usable subject → nothing to combine.
  if (subjectPaths.length === 0) {
    return buildResult([], base, idPrefix, opts.replace ?? false)
  }

  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true)
  if (clipPaths.length > 0) {
    clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true)
  }

  const solution: IntPoint[][] = []
  // NonZero fill: every CCW input loop is a solid; overlapping subjects merge.
  const fill = ClipperLib.PolyFillType.pftNonZero
  clipper.Execute(clipTypeEnum(opts.op), solution, fill, fill)

  const rings = solution.map(fromClipperPath)
  const loops = classifyResultRings(rings)
  return buildResult(loops, base, idPrefix, opts.replace ?? false)
}

/**
 * Normalise the `design | entities` input into the base design, point registry,
 * and entity list shared by both ops.
 */
function resolveSource(
  opts: { design?: DesignFileV2; entities?: SketchEntity[]; points?: Record<string, SketchPoint> },
  fnName: string
): { base: DesignFileV2; points: Record<string, SketchPoint>; entities: SketchEntity[] } {
  if (opts.design) {
    return { base: opts.design, points: opts.design.points, entities: opts.design.entities }
  }
  if (opts.entities) {
    const base: DesignFileV2 = { ...emptyDesign(), points: opts.points ?? {}, entities: opts.entities }
    return { base, points: opts.points ?? {}, entities: opts.entities }
  }
  throw new Error(`${fnName}: provide either \`design\` or \`entities\`.`)
}
