/**
 * Sketch ARRAY (pattern) engine — rectangular grid + circular copy arrays of the
 * selected 2D sketch geometry.
 *
 * "Rectangular + circular copy arrays" is a P1 daily-use Vectric/Carveco editing
 * op that is flagged `missing` in docs/plans/catalog/vcarve-laguna.md
 * ("Vectors — Transform & Edit · Array / Copy (grid, circular)") and
 * docs/plans/catalog/cad-design.md ("Sketch · Pattern"). This module turns a
 * selection of {@link SketchEntity} into transformed COPIES (translate /
 * rotate-about-center) that fold straight into the live {@link DesignFileV2}
 * sketch model — the SAME model the live `SketchSurface` edits and
 * `cam-2d-derive.ts` reads to derive contour / pocket / V-carve / drill
 * toolpaths. An arrayed bolt-circle of holes or a row of slots is then just more
 * sketch geometry like any other profile.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PURE — no I/O, no `window`, no React
 * ──────────────────────────────────────────────────────────────────────────
 * The functions never read a file or hit the network and never mutate their
 * inputs. This keeps the module unit-testable in the `node` vitest env and
 * callable from either the renderer host or a future main-side importer —
 * exactly like its siblings {@link ./dxf-to-sketch} and
 * {@link ./text-to-vectors}. The merge is ADDITIVE by default (mirroring those
 * two): the original entities/points are preserved and the copies are appended,
 * so an array can't clobber existing CAD geometry.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * COUNT CONVENTION (matches Vectric / the existing `sk_pattern_sk` kernel)
 * ──────────────────────────────────────────────────────────────────────────
 * `cols`/`rows`/`count` are the TOTAL instance count INCLUDING the original
 * (the Vectric "Copy Array" convention, and the same divisor the catalog's
 * `sk_pattern_sk` documents: "Circular … step = total° ÷ Pat #"). Because the
 * original is preserved in place (cell (0,0) of a grid, angle 0 of a circle),
 * this engine emits only the OTHER instances as fresh copies:
 *   - rectangularArray(cols, rows): emits `cols·rows − 1` copies (every grid
 *     cell except (0,0)); the merged design holds `cols·rows` instances total.
 *   - circularArray(count): emits `count − 1` copies at angles
 *     `k · (totalAngleDeg / count)` for k = 1…count−1; the merged design holds
 *     `count` instances total. So count=4 over 360° lands instances at
 *     0/90/180/270 (0 = the preserved original).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DETERMINISTIC IDS (reproducible diffs / snapshots — no clock, no RNG)
 * ──────────────────────────────────────────────────────────────────────────
 * Every copied entity/point id is derived from the SOURCE id + the copy index
 * (e.g. `a1#r1` / `a1_p3#c2`), never from `Date.now()` or `crypto.randomUUID()`.
 * Re-running an array on the same input yields byte-identical ids, which the
 * snapshot/engine tests and stable project diffs depend on. An optional
 * `idSeparator` lets a caller pick a separator that can't collide with their own
 * id scheme. Within one copy the source→copy point-id remap is shared, so a
 * polyline's `pointIds` and its `arc`'s `startId/viaId/endId` keep referencing
 * the right copied points.
 *
 * ── Per-kind transform ──
 * Two rigid-body transforms are applied to a copy:
 *   - TRANSLATE (rectangular cells; circular when `rotateCopies` is false): every
 *     coordinate shifts by (dx, dy). Center-based entities shift `cx`/`cy`;
 *     point-based entities (polyline/arc/spline) shift each referenced point;
 *     `rotation`/radii/dims are untouched (a pure slide).
 *   - ROTATE-ABOUT-CENTER (circular placement, plus `rotateCopies` for the grid):
 *     every coordinate rotates by θ about the pivot. Entities that carry a
 *     `rotation` field (rect / slot / ellipse) ALSO add θ to that field so the
 *     whole shape spins with the array (not just its center); `circle` has no
 *     orientation so only its center moves. `rotateCopies: false` keeps every
 *     copy axis-aligned (translated to the orbit position but not spun).
 */
import {
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from './design-schema'

/** A rigid-body transform applied to one array copy (rotate about pivot, then translate). */
interface CopyTransform {
  /** Rotation about {@link pivotX},{@link pivotY} in radians (0 = pure translation). */
  readonly rotationRad: number
  readonly pivotX: number
  readonly pivotY: number
  /** Translation applied AFTER the rotation (mm). */
  readonly dx: number
  readonly dy: number
  /**
   * When false, an entity's own `rotation` field (rect/slot/ellipse) is NOT
   * advanced by {@link rotationRad} — the copy is moved to the orbit position but
   * stays axis-aligned. Always true for the angular placement of a circular array
   * unless the caller opts out via `rotateCopies: false`.
   */
  readonly spinGeometry: boolean
}

/** Result of an array merge — the new design plus how many copies were produced. */
export interface SketchArrayResult {
  /** The merged design with the array copies appended (or replacing, per options). */
  readonly design: DesignFileV2
  /** How many transformed copies were emitted (excludes the preserved original). */
  readonly copyCount: number
  /** Human-facing notes (skipped/degenerate selections, clamped counts). */
  readonly notes: string[]
}

/** Shared options for both array kinds. */
export interface SketchArrayCommonOptions {
  /** Entity ids (from `design.entities`) to pattern. Unknown ids are ignored with a note. */
  readonly sourceIds: readonly string[]
  /**
   * When `true`, the array copies REPLACE the design's entities/points with just
   * the original sources + their copies (a clean rebuild). When `false` (default)
   * the copies are ADDED to whatever the base design already holds — additive, so
   * an array can't clobber other geometry.
   */
  readonly replace?: boolean
  /**
   * Separator between a source id and the copy suffix in generated ids. Defaults
   * to `'#'`. Pick a character your ids never contain to guarantee no collision.
   */
  readonly idSeparator?: string
}

/** Either an explicit entity list or a whole design to read the sources from. */
export type SketchArraySource =
  | { readonly design: DesignFileV2; readonly entities?: undefined }
  | { readonly entities: readonly SketchEntity[]; readonly design?: undefined }

/** Options for {@link rectangularArray}. */
export type RectangularArrayOptions = SketchArraySource &
  SketchArrayCommonOptions & {
    /** Total columns INCLUDING the original (≥1). col 0 = the original position. */
    readonly cols: number
    /** Total rows INCLUDING the original (≥1). row 0 = the original position. */
    readonly rows: number
    /** Column spacing (mm) along +X — distance between adjacent columns. */
    readonly dxMm: number
    /** Row spacing (mm) along +Y — distance between adjacent rows. */
    readonly dyMm: number
  }

/** Options for {@link circularArray}. */
export type CircularArrayOptions = SketchArraySource &
  SketchArrayCommonOptions & {
    /** Total instance count INCLUDING the original (≥1). Instance 0 = the original. */
    readonly count: number
    /** Pivot the copies orbit, as `[x, y]` in sketch mm. */
    readonly centerXY: readonly [number, number]
    /**
     * Total sweep across all instances in degrees (default 360). Per-instance
     * step = `totalAngleDeg / count` (matches the `sk_pattern_sk` kernel), so a
     * full 360° wraps without the last copy landing back on the original.
     */
    readonly totalAngleDeg?: number
    /**
     * When `true` (default) each copy's geometry is rotated by its placement angle
     * (the shape spins to follow the orbit, like Vectric "Rotate copies"). When
     * `false` each copy is translated to the orbit position but kept axis-aligned.
     */
    readonly rotateCopies?: boolean
  }

/** Resolve the source entities (explicit list, else the design's `entities`). */
function resolveSourceEntities(src: SketchArraySource): readonly SketchEntity[] {
  if (src.design) return src.design.entities
  return src.entities ?? []
}

/** Resolve the base design the copies merge into (the passed design, else empty). */
function resolveBaseDesign(src: SketchArraySource): DesignFileV2 {
  return src.design ?? emptyDesign()
}

/** Rotate (x,y) about (px,py) by `t.rotationRad`, then translate by (dx,dy). */
function placePoint(x: number, y: number, t: CopyTransform): { x: number; y: number } {
  if (t.rotationRad === 0) {
    return { x: x + t.dx, y: y + t.dy }
  }
  const cos = Math.cos(t.rotationRad)
  const sin = Math.sin(t.rotationRad)
  const rx = x - t.pivotX
  const ry = y - t.pivotY
  return {
    x: t.pivotX + rx * cos - ry * sin + t.dx,
    y: t.pivotY + rx * sin + ry * cos + t.dy
  }
}

/** The angle added to an entity's own `rotation` field for this copy. */
function spinDelta(t: CopyTransform): number {
  return t.spinGeometry ? t.rotationRad : 0
}

/**
 * The transform to apply to a point-based entity's VERTICES, given the entity's
 * `anchor` (its centroid).
 *
 * When the copy spins (default circular array), the placement transform `t` is
 * used directly — every vertex rotates about the pivot, so the local shape turns
 * to follow the orbit. When the copy does NOT spin (`rotateCopies: false`, and
 * always for a rectangular grid where `rotationRad` is 0), the vertices get a
 * PURE TRANSLATION equal to `place(anchor) − anchor`: the entity's centroid lands
 * on its orbit position but the local shape stays axis-aligned (it is moved, not
 * rotated). For a center-based entity the same idea is expressed by placing `cx`
 * /`cy` with {@link placePoint} and advancing `rotation` only via
 * {@link spinDelta}.
 */
function vertexTransformFor(t: CopyTransform, anchor: { x: number; y: number }): CopyTransform {
  if (t.spinGeometry || t.rotationRad === 0) return t
  const placed = placePoint(anchor.x, anchor.y, t)
  return {
    rotationRad: 0,
    pivotX: 0,
    pivotY: 0,
    dx: placed.x - anchor.x,
    dy: placed.y - anchor.y,
    spinGeometry: false
  }
}

/** Centroid (mean) of resolvable referenced points; `null` if any id is missing. */
function centroidOfPointIds(
  pointIds: readonly string[],
  srcPoints: Record<string, SketchPoint>
): { x: number; y: number } | null {
  if (pointIds.length === 0) return null
  let sx = 0
  let sy = 0
  for (const id of pointIds) {
    const p = srcPoints[id]
    if (!p) return null
    sx += p.x
    sy += p.y
  }
  return { x: sx / pointIds.length, y: sy / pointIds.length }
}

/** Centroid (mean) of an inline coordinate list. */
function centroidOfCoords(pts: ReadonlyArray<readonly [number, number]>): { x: number; y: number } {
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p[0]
    sy += p[1]
  }
  return { x: sx / pts.length, y: sy / pts.length }
}

/**
 * Deterministic per-copy id minter. Entity ids become `"<srcId><sep><tag>"`;
 * point ids reuse the SAME suffix so a copy's points stay grouped with — and
 * referenced by — that copy's entity. The `tag` encodes the copy index (e.g.
 * `r1c2` for a grid cell, `n3` for a circular instance) so ids are unique per
 * copy and stable across re-runs.
 */
class CopyIdMinter {
  constructor(
    private readonly tag: string,
    private readonly sep: string
  ) {}
  /** Copy id for a source entity id. */
  entity(srcId: string): string {
    return `${srcId}${this.sep}${this.tag}`
  }
  /** Copy id for a source point id (same suffix → grouped with the entity copy). */
  point(srcPointId: string): string {
    return `${srcPointId}${this.sep}${this.tag}`
  }
}

/**
 * Copy one entity under `t`, registering any new (transformed) points into
 * `outPoints`. Returns the copied entity (with a fresh, deterministic id) or
 * `null` when a referenced point is missing from `srcPoints` (a corrupt
 * selection — skipped with a note by the caller).
 *
 * Point-based kinds (polyline-by-ids, arc, spline) remap each referenced source
 * point id to a copied point id via {@link ids} and transform its coordinates.
 * Center-based kinds (rect, circle, slot, ellipse) transform `cx`/`cy` and, when
 * spinning, advance their `rotation`. Legacy inline-point polylines transform
 * their embedded coordinate list in place.
 */
function copyEntity(
  e: SketchEntity,
  t: CopyTransform,
  ids: CopyIdMinter,
  srcPoints: Record<string, SketchPoint>,
  outPoints: Record<string, SketchPoint>
): SketchEntity | null {
  /**
   * Remap + transform a referenced source point id under the given VERTEX
   * transform (`vt`, anchor-corrected for the non-spin case); null if the point
   * is missing. The copied point id is `ids.point(srcId)`, deduped in `outPoints`.
   */
  const remap = (srcId: string, vt: CopyTransform): string | null => {
    const p = srcPoints[srcId]
    if (!p) return null
    const copyId = ids.point(srcId)
    if (!outPoints[copyId]) {
      const moved = placePoint(p.x, p.y, vt)
      outPoints[copyId] = { x: moved.x, y: moved.y, ...(p.fixed ? { fixed: p.fixed } : {}) }
    }
    return copyId
  }

  switch (e.kind) {
    case 'polyline': {
      if ('pointIds' in e && e.pointIds) {
        const anchor = centroidOfPointIds(e.pointIds, srcPoints)
        if (!anchor) return null
        const vt = vertexTransformFor(t, anchor)
        const ids2: string[] = []
        for (const pid of e.pointIds) {
          const np = remap(pid, vt)
          if (!np) return null
          ids2.push(np)
        }
        return { id: ids.entity(e.id), kind: 'polyline', pointIds: ids2, closed: e.closed }
      }
      if ('points' in e && e.points) {
        const vt = vertexTransformFor(t, centroidOfCoords(e.points))
        const pts = e.points.map((p) => {
          const m = placePoint(p[0], p[1], vt)
          return [m.x, m.y] as [number, number]
        })
        return { id: ids.entity(e.id), kind: 'polyline', points: pts, closed: e.closed }
      }
      return null
    }
    case 'rect': {
      const c = placePoint(e.cx, e.cy, t)
      return {
        id: ids.entity(e.id),
        kind: 'rect',
        cx: c.x,
        cy: c.y,
        w: e.w,
        h: e.h,
        rotation: e.rotation + spinDelta(t)
      }
    }
    case 'circle': {
      const c = placePoint(e.cx, e.cy, t)
      // A circle has no orientation, so only its center moves under a spin.
      return { id: ids.entity(e.id), kind: 'circle', cx: c.x, cy: c.y, r: e.r }
    }
    case 'slot': {
      const c = placePoint(e.cx, e.cy, t)
      return {
        id: ids.entity(e.id),
        kind: 'slot',
        cx: c.x,
        cy: c.y,
        length: e.length,
        width: e.width,
        rotation: e.rotation + spinDelta(t)
      }
    }
    case 'ellipse': {
      const c = placePoint(e.cx, e.cy, t)
      return {
        id: ids.entity(e.id),
        kind: 'ellipse',
        cx: c.x,
        cy: c.y,
        rx: e.rx,
        ry: e.ry,
        rotation: e.rotation + spinDelta(t)
      }
    }
    case 'arc': {
      const anchor = centroidOfPointIds([e.startId, e.viaId, e.endId], srcPoints)
      if (!anchor) return null
      const vt = vertexTransformFor(t, anchor)
      const s = remap(e.startId, vt)
      const v = remap(e.viaId, vt)
      const en = remap(e.endId, vt)
      if (!s || !v || !en) return null
      return {
        id: ids.entity(e.id),
        kind: 'arc',
        startId: s,
        viaId: v,
        endId: en,
        ...(e.closed === undefined ? {} : { closed: e.closed })
      }
    }
    case 'spline_fit': {
      const anchor = centroidOfPointIds(e.pointIds, srcPoints)
      if (!anchor) return null
      const vt = vertexTransformFor(t, anchor)
      const pids: string[] = []
      for (const pid of e.pointIds) {
        const np = remap(pid, vt)
        if (!np) return null
        pids.push(np)
      }
      return {
        id: ids.entity(e.id),
        kind: 'spline_fit',
        pointIds: pids,
        ...(e.closed === undefined ? {} : { closed: e.closed })
      }
    }
    case 'spline_cp': {
      const anchor = centroidOfPointIds(e.pointIds, srcPoints)
      if (!anchor) return null
      const vt = vertexTransformFor(t, anchor)
      const pids: string[] = []
      for (const pid of e.pointIds) {
        const np = remap(pid, vt)
        if (!np) return null
        pids.push(np)
      }
      return {
        id: ids.entity(e.id),
        kind: 'spline_cp',
        pointIds: pids,
        ...(e.closed === undefined ? {} : { closed: e.closed })
      }
    }
    default: {
      // Exhaustive over SketchEntity — a new kind would surface here at compile time.
      const _never: never = e
      void _never
      return null
    }
  }
}

/** Shared core: copy `sources` under each transform and fold into the base design. */
function buildArray(
  src: SketchArraySource,
  common: SketchArrayCommonOptions,
  transforms: { tag: string; t: CopyTransform }[]
): SketchArrayResult {
  const base = resolveBaseDesign(src)
  const allEntities = resolveSourceEntities(src)
  const sep = common.idSeparator ?? '#'
  const notes: string[] = []

  // Resolve the requested source ids to entities (preserve `sourceIds` order;
  // drop unknown ids with a note so a stale selection can't crash the array).
  const byId = new Map(allEntities.map((e) => [e.id, e]))
  const sources: SketchEntity[] = []
  const missingIds: string[] = []
  for (const id of common.sourceIds) {
    const e = byId.get(id)
    if (e) sources.push(e)
    else missingIds.push(id)
  }
  if (missingIds.length > 0) {
    notes.push(
      `${missingIds.length} selected id${missingIds.length === 1 ? '' : 's'} not found in the design and ${missingIds.length === 1 ? 'was' : 'were'} skipped.`
    )
  }

  // The point registry the copies read from is the base design's points.
  const srcPoints = base.points

  const newEntities: SketchEntity[] = []
  const newPoints: Record<string, SketchPoint> = {}
  let skippedCopies = 0

  for (const { tag, t } of transforms) {
    const ids = new CopyIdMinter(tag, sep)
    for (const e of sources) {
      const copy = copyEntity(e, t, ids, srcPoints, newPoints)
      if (copy) newEntities.push(copy)
      else skippedCopies++
    }
  }
  if (skippedCopies > 0) {
    notes.push(
      `${skippedCopies} cop${skippedCopies === 1 ? 'y' : 'ies'} of selected geometry referenced missing points and ${skippedCopies === 1 ? 'was' : 'were'} skipped.`
    )
  }

  // Additive (default): keep base entities/points + appended copies. Replace:
  // just the original sources + their copies (clean rebuild).
  const design: DesignFileV2 = common.replace
    ? {
        ...base,
        points: { ...collectSourcePoints(sources, srcPoints), ...newPoints },
        entities: [...sources, ...newEntities]
      }
    : {
        ...base,
        points: { ...base.points, ...newPoints },
        entities: [...base.entities, ...newEntities]
      }

  return { design, copyCount: newEntities.length, notes }
}

/** Points referenced by `sources` (used to keep `replace` from dropping their points). */
function collectSourcePoints(
  sources: readonly SketchEntity[],
  srcPoints: Record<string, SketchPoint>
): Record<string, SketchPoint> {
  const out: Record<string, SketchPoint> = {}
  const keep = (id: string): void => {
    const p = srcPoints[id]
    if (p) out[id] = p
  }
  for (const e of sources) {
    if (e.kind === 'polyline' && 'pointIds' in e && e.pointIds) {
      for (const id of e.pointIds) keep(id)
    } else if (e.kind === 'arc') {
      keep(e.startId)
      keep(e.viaId)
      keep(e.endId)
    } else if (e.kind === 'spline_fit' || e.kind === 'spline_cp') {
      for (const id of e.pointIds) keep(id)
    }
  }
  return out
}

/** Clamp a requested instance count to an integer ≥ 1 (a non-finite / <1 input → 1). */
function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.floor(n))
}

/**
 * Rectangular (grid) array: copy the selected entities into a `cols × rows`
 * grid spaced `dxMm` along +X and `dyMm` along +Y. `cols`/`rows` are the TOTAL
 * count INCLUDING the original at cell (0,0); that cell is the preserved
 * original, so this emits `cols·rows − 1` copies (the merged design holds
 * `cols·rows` instances). Pure; does not mutate the input.
 *
 * Spacing may be negative (grid grows toward −X / −Y) or zero (a degenerate
 * stack — copies overlap the original; allowed, the caller decides). Grid cells
 * are pure translations, so every copy stays axis-aligned regardless of the
 * source entity's own `rotation`.
 */
export function rectangularArray(opts: RectangularArrayOptions): SketchArrayResult {
  const cols = clampCount(opts.cols)
  const rows = clampCount(opts.rows)
  const dx = Number.isFinite(opts.dxMm) ? opts.dxMm : 0
  const dy = Number.isFinite(opts.dyMm) ? opts.dyMm : 0

  const transforms: { tag: string; t: CopyTransform }[] = []
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      if (r === 0 && cIdx === 0) continue // cell (0,0) is the preserved original
      transforms.push({
        tag: `r${r}c${cIdx}`,
        t: {
          rotationRad: 0,
          pivotX: 0,
          pivotY: 0,
          dx: cIdx * dx,
          dy: r * dy,
          spinGeometry: false
        }
      })
    }
  }

  return buildArray(opts, opts, transforms)
}

/**
 * Circular array: copy the selected entities `count` times around `centerXY`,
 * stepping `totalAngleDeg / count` degrees per instance. `count` is the TOTAL
 * INCLUDING the original at angle 0 (the preserved original), so this emits
 * `count − 1` copies at angles `k · step` for k = 1…count−1 (the merged design
 * holds `count` instances). Pure; does not mutate the input.
 *
 * `rotateCopies` (default true) spins each copy's geometry by its placement
 * angle so the shape follows the orbit (rect/slot/ellipse advance their own
 * `rotation`; point-based geometry is rotated about the pivot). When false, each
 * copy is translated to the orbit position but kept axis-aligned (the center
 * orbits, the shape does not turn).
 *
 * Example: count=4, totalAngleDeg=360 → step 90° → instances at 0/90/180/270
 * (0 = the preserved original; copies at 90/180/270).
 */
export function circularArray(opts: CircularArrayOptions): SketchArrayResult {
  const count = clampCount(opts.count)
  const total = Number.isFinite(opts.totalAngleDeg ?? 360) ? (opts.totalAngleDeg ?? 360) : 360
  const rotateCopies = opts.rotateCopies ?? true
  const [px, py] = opts.centerXY
  const stepRad = ((total / count) * Math.PI) / 180

  const transforms: { tag: string; t: CopyTransform }[] = []
  for (let k = 1; k < count; k++) {
    transforms.push({
      tag: `n${k}`,
      t: {
        rotationRad: k * stepRad,
        pivotX: px,
        pivotY: py,
        dx: 0,
        dy: 0,
        spinGeometry: rotateCopies
      }
    })
  }

  return buildArray(opts, opts, transforms)
}
