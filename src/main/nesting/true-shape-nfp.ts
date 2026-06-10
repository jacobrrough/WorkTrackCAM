/**
 * True-shape nesting v2 — polygon No-Fit-Polygon (NFP) bottom-left-fill with
 * multi-sheet overflow for the Laguna Swift 5x10 full-sheet workflow.
 *
 * This is the "v2 upgrade path" promised at the end of ./true-shape-v1.ts
 * (docs/plans/catalog/vcarve-laguna.md — Nesting rows: "bounding-box BLF, not
 * polygon NFP" P1 + "Multi-sheet nesting" P2). v1 stays untouched as the
 * fallback + comparison baseline; this module is a parallel engine with a
 * SUPERSET result contract (see {@link NfpNestResult}).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Algorithm (sequential bottom-left-fill on true polygon geometry)
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Parts are sorted by descending polygon area (ties broken by input order —
 *     deterministic).
 *  2. Each part polygon is INFLATED by `partMarginMm / 2` with a Clipper round
 *     offset BEFORE any collision geometry is built, so the inter-part
 *     clearance is geometric (true-shape), not bounding-box.
 *  3. For each candidate orientation (default rotations 0/90/180/270, or a
 *     caller list / `rotationStepDeg` for finer steps, e.g. 45/30/15):
 *       a. The sheet's inner-fit RECTANGLE for the inflated polygon is the set
 *          of translations keeping it inside the margin-shrunk sheet.
 *       b. The forbidden region is the union of NO-FIT POLYGONS of every
 *          already-placed part P against the candidate C:
 *              NFP(P, C) = MinkowskiSum(P, -C)
 *          (-C = C with every vertex negated). Clipper's `MinkowskiSum` is
 *          called with the NEGATED CANDIDATE as `pattern` and the placed
 *          polygon wrapped in an array — ONLY that Paths overload adds the
 *          `TranslatePath(path, pattern[0])` fill that closes the spurious
 *          interior hole of the swept quad band (verified against the
 *          clipper.js 6.4.2 source). A translation t is overlap-free exactly
 *          when t is NOT in the interior of any NFP.
 *       c. Candidate translations are the classic BLF set: inner-fit-rectangle
 *          corners, NFP-union vertices inside the rectangle, and NFP-edge ×
 *          rectangle-edge crossings (computed directly so the degenerate case
 *          of a part exactly as wide as the sheet still enumerates positions).
 *          They are scanned in (y, then x) order — bottom-left first.
 *  4. SAFETY GATE (load-bearing): a candidate position is committed ONLY after
 *     an exact Clipper intersection test against every placed part returns
 *     ZERO area on the spacing-inflated polygons. Nothing reaches
 *     `placements[]` on the strength of NFP math alone — the same pairwise
 *     zero-overlap property the tests assert is enforced by construction, so
 *     a bad nest can never scrap a 5x10 sheet.
 *  5. The best orientation is the one whose placed part lands bottom-left-most
 *     (min final y, then min final x, then lowest rotation index).
 *  6. Parts that fit on no existing sheet open a NEW sheet (first-fit, capped
 *     at `maxSheets`, default 8). Only parts no sheet accepts are `unplaced`.
 *
 * Coordinate / placement contract — IDENTICAL to v1 so the renderer's
 * `applyNestingPlacements` (scalar `placementXMm` / `placementYMm` /
 * `placementRotationDeg` params) works unchanged:
 *   - `rotationDeg` is a CCW rotation of the input points about their local
 *     origin; `(xMm, yMm)` is where the ROTATED part's axis-aligned
 *     bounding-box min-corner lands on the sheet. (This convention is
 *     rotation-center invariant — rotating about any other pivot then moving
 *     the bbox min-corner to (xMm, yMm) yields the same final geometry.)
 *   - Output coordinates sit on the 0.1 µm Clipper integer grid (multiples of
 *     1/CLIPPER_SCALE mm), so converting back with Math.round(v * 1e4)
 *     reproduces the EXACT integer geometry the engine validated.
 *
 * Geometry conventions: mm → Clipper integers via {@link CLIPPER_SCALE} (1e4,
 * 0.1 µm; Laguna's 3048 mm bed = 3.048e7 units, far inside Clipper's safe
 * range) and CCW-normalised input winding — both shared with
 * `src/shared/sketch-boolean-offset.ts`.
 *
 * Documented divergences from v1 (each on the SAFE side):
 *   - The inflated polygon is used for sheet containment too, so parts also
 *     keep `partMarginMm / 2` of clearance from the sheet-margin band (v1 let
 *     the raw bbox touch it). Costs ≤ 1.5 mm of edge band at the default
 *     3 mm spacing on a 1524 × 3048 mm sheet; protects the kerf at the edge.
 *   - Degenerate parts (< 3 distinct vertices or ~zero area) are reported
 *     `unplaced` instead of being "placed" as empty boxes.
 *   - Non-finite input coordinates throw instead of poisoning the layout.
 *
 * License hygiene: written from scratch by the WorkTrack3D project on top of
 * the already-bundled `clipper-lib` (Angus Johnson's Clipper 6.4.2, Boost
 * Software License — see docs/SECURITY.md dependency policy). No Deepnest /
 * SVGnest / nfp-polygon source is copied or ported; Clipper's `MinkowskiSum`
 * primitive is called through the typed surface in
 * `src/shared/clipper-lib.d.ts`.
 *
 * Safety Rule 1 (G-code is sacred): like v1, this module produces PLACEMENTS
 * only — (xMm, yMm, rotationDeg, sheetIndex) tuples. It emits no G-code and no
 * machine motion; toolpaths regenerate through the existing gcode-safe
 * pipeline downstream.
 */
import ClipperLib, { type IntPoint, type Path, type Paths } from 'clipper-lib'
import { CLIPPER_SCALE } from '../../shared/sketch-boolean-offset'
import type { Polygon, SheetSpec } from './true-shape-v1'

/** Nesting options for the NFP engine (superset of v1's NestOptions intent). */
export interface NfpNestOptions {
  /**
   * Inter-part clearance in mm, applied GEOMETRICALLY: every polygon is
   * inflated by half this value (Clipper round join) before NFP construction,
   * so two placed parts always keep ≥ `partMarginMm` of true-shape clearance
   * (minus ≤ 2 × {@link NFP_INFLATE_ARC_TOLERANCE_MM} of arc-chord undercut at
   * convex corners). Default 3 mm — same default as v1.
   */
  partMarginMm?: number
  /**
   * Explicit allowed rotations in degrees (any finite values; normalised to
   * [0, 360) and de-duplicated, order preserved). Takes precedence over
   * `rotationStepDeg`. Default [0, 90, 180, 270].
   */
  allowedRotations?: ReadonlyArray<number>
  /**
   * Alternative to `allowedRotations`: generate candidate rotations
   * 0, step, 2·step, … < 360. E.g. 45 → 8 orientations, 30 → 12, 15 → 24.
   * Must be ≥ 1 and ≤ 360.
   */
  rotationStepDeg?: number
  /**
   * Maximum number of sheets the nest may open (multi-sheet overflow).
   * Default 8; hard cap 16. Must be an integer ≥ 1.
   */
  maxSheets?: number
}

/** A placement of a single part. Superset of v1's Placement (adds sheetIndex). */
export interface NfpPlacement {
  /** Polygon id from the input. */
  partId: string
  /** Where the rotated part's bbox min-corner lands (mm, 0.1 µm grid). */
  xMm: number
  /** Where the rotated part's bbox min-corner lands (mm, 0.1 µm grid). */
  yMm: number
  /** CCW rotation in degrees (one of the resolved candidate rotations). */
  rotationDeg: number
  /**
   * 0-based index of the sheet this part landed on. Always set by this
   * engine; planned as an OPTIONAL additive field on the IPC wire result so
   * existing consumers of the v1 shape keep parsing (Wire phase).
   */
  sheetIndex: number
}

/**
 * Result of an NFP nest run. Field-for-field superset of v1's NestResult:
 * `placements` / `unplaced` / `utilizationPct` / `sheetUsedAreaMm2` /
 * `totalPartAreaMm2` keep their v1 names; `sheetsUsed` + `nestVersion` are the
 * additive extensions (multi-sheet + the `nestVersion` marker v1's "v2 upgrade
 * path" note called for).
 */
export interface NfpNestResult {
  /** Placements in the order parts were placed (largest area first). */
  placements: NfpPlacement[]
  /** IDs of parts no sheet accepted under any allowed rotation. */
  unplaced: string[]
  /** Material utilization (0..100): placed-part-area / (sheet area × sheetsUsed) × 100. */
  utilizationPct: number
  /** Total sheet area consumed in mm² (width × height × sheetsUsed). */
  sheetUsedAreaMm2: number
  /** Total mm² of the placed parts (area inside their polygon outer rings). */
  totalPartAreaMm2: number
  /** Number of sheets that received at least one part (0 when nothing placed). */
  sheetsUsed: number
  /** Engine marker so callers can diff v1 vs NFP layouts during rollout. */
  nestVersion: 'nfp-v2'
}

/** Axis-aligned bounds in Clipper integer units. */
export interface IntBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Oriented (rotated + scaled + inflated) integer geometry for one part. */
export interface OrientedPartGeometryInt {
  /** Rotated, CCW-normalised, integer-scaled outline (UN-inflated). */
  rawPath: Path
  /** Bounds of `rawPath` — the bbox the (xMm, yMm) placement convention uses. */
  rawBounds: IntBounds
  /** Spacing-inflated collision body (≥ 1 ring; equals [rawPath] at spacing 0). */
  inflatedPaths: Paths
  /** Bounds of the inflated body — drives sheet inner-fit containment. */
  inflatedBounds: IntBounds
}

const DEFAULT_PART_MARGIN_MM = 3
const DEFAULT_ROTATIONS_DEG: ReadonlyArray<number> = [0, 90, 180, 270]
const DEFAULT_MAX_SHEETS = 8
const MAX_SHEETS_HARD_CAP = 16
const MIN_ROTATION_STEP_DEG = 1
const MIN_RING_VERTICES = 3
/** Parts with less polygon area than this (mm²) are degenerate → unplaced. */
const MIN_PART_AREA_MM2 = 1e-9

/**
 * Arc-chord tolerance (mm) for the round-join spacing inflation. Coarse on
 * purpose: it caps offset vertex counts so MinkowskiSum quad counts stay small
 * (the NFP cost is |P|·|C| quads), while the ≤ 0.02 mm corner undercut is far
 * below router kerf. cam-local.ts uses the same ClipperOffset arc-tolerance
 * pattern for the v-carve flat-bottom rims.
 */
export const NFP_INFLATE_ARC_TOLERANCE_MM = 0.02

type Pt = readonly [number, number]

// ─── Pure mm-space helpers (shoelace math stays in mm: |coords| ≤ 3048 keeps ──
// ─── every product far inside double precision; int-space shoelace could not) ─

/** Signed shoelace area ×2 in mm². Positive = CCW. */
function signedArea2Mm(points: ReadonlyArray<Pt>): number {
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

/** Absolute polygon area in mm². */
function polygonAreaAbsMm2(points: ReadonlyArray<Pt>): number {
  return Math.abs(signedArea2Mm(points)) / 2
}

/** Rotate points CCW by `deg` about the local origin. Exact for 90° multiples. */
function rotatePointsDeg(points: ReadonlyArray<Pt>, deg: number): Pt[] {
  const d = ((deg % 360) + 360) % 360
  if (d === 0) return points.map((p): Pt => [p[0], p[1]])
  if (d === 90) return points.map((p): Pt => [-p[1], p[0]])
  if (d === 180) return points.map((p): Pt => [-p[0], -p[1]])
  if (d === 270) return points.map((p): Pt => [p[1], -p[0]])
  const rad = (d * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return points.map((p): Pt => [p[0] * c - p[1] * s, p[0] * s + p[1] * c])
}

/** Drop consecutive coincident points + any closing duplicate (mm space). */
function cleanLoopMm(pts: ReadonlyArray<Pt>): Pt[] {
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

/** Force CCW winding (positive shoelace) — shared convention with sketch-boolean-offset. */
function toCCWMm(pts: ReadonlyArray<Pt>): Pt[] {
  return signedArea2Mm(pts) >= 0 ? [...pts] : [...pts].reverse()
}

// ─── Clipper integer-space helpers ───────────────────────────────────────────

/** mm loop → Clipper integer path (rounded onto the 0.1 µm grid). */
function toIntPath(pts: ReadonlyArray<Pt>): Path {
  return pts.map((p) => ({ X: Math.round(p[0] * CLIPPER_SCALE), Y: Math.round(p[1] * CLIPPER_SCALE) }))
}

/** Drop consecutive identical integer points + any closing duplicate. */
function cleanIntPath(path: Path): Path {
  const out: Path = []
  for (const p of path) {
    const last = out[out.length - 1]
    if (last && last.X === p.X && last.Y === p.Y) continue
    out.push(p)
  }
  while (out.length >= 2) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if (a.X === b.X && a.Y === b.Y) out.pop()
    else break
  }
  return out
}

/** Bounds of a set of integer paths. Caller guarantees ≥ 1 vertex. */
function intBoundsOf(paths: Paths): IntBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const p of path) {
      if (p.X < minX) minX = p.X
      if (p.Y < minY) minY = p.Y
      if (p.X > maxX) maxX = p.X
      if (p.Y > maxY) maxY = p.Y
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Fresh translated copy of an integer path (never mutates inputs/caches). */
function translatePath(path: Path, dx: number, dy: number): Path {
  return path.map((p) => ({ X: p.X + dx, Y: p.Y + dy }))
}

/** -C: every vertex negated (winding reverses implicitly; Minkowski re-orients). */
function negatePath(path: Path): Path {
  return path.map((p) => ({ X: -p.X, Y: -p.Y }))
}

/** NonZero union of a bag of rings into clean polygon-with-holes Paths. */
function unionPaths(rings: Paths): Paths {
  if (rings.length === 0) return []
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(rings, ClipperLib.PolyType.ptSubject, true)
  const solution: Paths = []
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  )
  return solution
}

/**
 * Total absolute intersection area between two closed-path sets, in Clipper
 * integer units² (NonZero fill). 0 ⇔ the interiors are disjoint (touching
 * boundaries report 0). This is the engine's commit gate AND the quantity the
 * safety tests assert on.
 */
export function intersectionAreaIntUnits2(a: Paths, b: Paths): number {
  if (a.length === 0 || b.length === 0) return 0
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(a, ClipperLib.PolyType.ptSubject, true)
  clipper.AddPaths(b, ClipperLib.PolyType.ptClip, true)
  const solution: Paths = []
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  )
  let area = 0
  for (const ring of solution) area += Math.abs(ClipperLib.Clipper.Area(ring))
  return area
}

/** Round to 3 decimal places (reporting only — placements stay on the int grid). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ─── Oriented geometry construction ──────────────────────────────────────────

/**
 * Build the oriented integer geometry for one part at one rotation:
 * rotate (mm) → clean → CCW-normalise → scale to ints → optionally inflate by
 * `partMarginMm / 2` (round join, {@link NFP_INFLATE_ARC_TOLERANCE_MM}).
 * Returns null for degenerate outlines. Exported so the safety tests can
 * reproduce the EXACT collision geometry the engine validated.
 */
export function orientedPartGeometryInt(
  points: ReadonlyArray<Pt>,
  rotationDeg: number,
  partMarginMm: number
): OrientedPartGeometryInt | null {
  const rotated = cleanLoopMm(rotatePointsDeg(points, rotationDeg))
  if (rotated.length < MIN_RING_VERTICES) return null
  const rawPath = cleanIntPath(toIntPath(toCCWMm(rotated)))
  if (rawPath.length < MIN_RING_VERTICES) return null

  const deltaInt = Math.round(Math.max(0, partMarginMm) * 0.5 * CLIPPER_SCALE)
  let inflatedPaths: Paths
  if (deltaInt > 0) {
    const co = new ClipperLib.ClipperOffset(2, NFP_INFLATE_ARC_TOLERANCE_MM * CLIPPER_SCALE)
    co.AddPath(rawPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
    const solution: Paths = []
    co.Execute(solution, deltaInt)
    inflatedPaths = solution.filter((ring) => ring.length >= MIN_RING_VERTICES)
    if (inflatedPaths.length === 0) return null
  } else {
    inflatedPaths = [rawPath]
  }

  return {
    rawPath,
    rawBounds: intBoundsOf([rawPath]),
    inflatedPaths,
    inflatedBounds: intBoundsOf(inflatedPaths)
  }
}

/**
 * The spacing-inflated collision body of `part` at its placed transform, in
 * Clipper integer units. Because placements sit on the 0.1 µm integer grid,
 * this reproduces BIT-EXACTLY the geometry the engine's commit gate
 * intersected — the safety tests assert pairwise zero area on these paths.
 * Returns null for degenerate parts (which the engine never places).
 */
export function placedInflatedPathsInt(
  part: Polygon,
  placement: Pick<NfpPlacement, 'xMm' | 'yMm' | 'rotationDeg'>,
  partMarginMm: number
): Paths | null {
  const geom = orientedPartGeometryInt(part.points, placement.rotationDeg, partMarginMm)
  if (!geom) return null
  const tx = Math.round(placement.xMm * CLIPPER_SCALE) - geom.rawBounds.minX
  const ty = Math.round(placement.yMm * CLIPPER_SCALE) - geom.rawBounds.minY
  return geom.inflatedPaths.map((ring) => translatePath(ring, tx, ty))
}

/**
 * The UN-inflated part outline at its placed transform, back in mm — for
 * sheet-containment assertions and renderer previews.
 */
export function placedRawPointsMm(
  part: Polygon,
  placement: Pick<NfpPlacement, 'xMm' | 'yMm' | 'rotationDeg'>
): Pt[] | null {
  const geom = orientedPartGeometryInt(part.points, placement.rotationDeg, 0)
  if (!geom) return null
  const tx = Math.round(placement.xMm * CLIPPER_SCALE) - geom.rawBounds.minX
  const ty = Math.round(placement.yMm * CLIPPER_SCALE) - geom.rawBounds.minY
  return geom.rawPath.map((p): Pt => [(p.X + tx) / CLIPPER_SCALE, (p.Y + ty) / CLIPPER_SCALE])
}

// ─── Option resolution ───────────────────────────────────────────────────────

/** Normalise a rotation to [0, 360). */
function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function resolveRotations(opts: NfpNestOptions): number[] {
  if (opts.allowedRotations && opts.allowedRotations.length > 0) {
    const out: number[] = []
    for (const r of opts.allowedRotations) {
      if (!Number.isFinite(r)) {
        throw new Error(`Invalid rotation ${r}; rotations must be finite degrees`)
      }
      const norm = normalizeDeg(r)
      if (!out.includes(norm)) out.push(norm)
    }
    return out
  }
  if (opts.rotationStepDeg !== undefined) {
    const step = opts.rotationStepDeg
    if (!Number.isFinite(step) || step < MIN_ROTATION_STEP_DEG || step > 360) {
      throw new Error(
        `Invalid rotationStepDeg ${step}; must be a finite value in [${MIN_ROTATION_STEP_DEG}, 360]`
      )
    }
    const out: number[] = []
    for (let i = 0; i * step < 360 - 1e-9; i++) {
      const norm = normalizeDeg(i * step)
      if (!out.includes(norm)) out.push(norm)
    }
    return out
  }
  return [...DEFAULT_ROTATIONS_DEG]
}

function resolveMaxSheets(opts: NfpNestOptions): number {
  const raw = opts.maxSheets ?? DEFAULT_MAX_SHEETS
  if (!Number.isInteger(raw) || raw < 1) {
    throw new Error(`Invalid maxSheets ${raw}; must be an integer >= 1`)
  }
  return Math.min(raw, MAX_SHEETS_HARD_CAP)
}

// ─── Internal nesting state ──────────────────────────────────────────────────

/** Sheet envelope in integer units. */
interface SheetEnvInt {
  widthInt: number
  heightInt: number
  marginInt: number
}

/** One already-committed part on a sheet. */
interface PlacedPart {
  shapeId: number
  rotIdx: number
  /** Spacing-inflated collision body at the placed transform. */
  translatedInflated: Paths
  translatedBounds: IntBounds
  /** Committed translation (int units) of the oriented local geometry. */
  tx: number
  ty: number
}

interface SheetState {
  placed: PlacedPart[]
}

/** Oriented geometry + its rotation bookkeeping for the BLF sweep. */
interface OrientationCandidate {
  rotIdx: number
  rotationDeg: number
  geom: OrientedPartGeometryInt
}

/** Per-run caches: oriented geometry + pairwise NFPs, keyed by shape identity. */
interface RunCaches {
  /** Serialized input points → stable shape id (parts repeat on sheet jobs). */
  readonly shapeIds: Map<string, number>
  /** `${shapeId}|${rotIdx}` → oriented geometry (or null when degenerate). */
  readonly oriented: Map<string, OrientedPartGeometryInt | null>
  /** `${placedShape}|${placedRot}>>${candShape}|${candRot}` → untranslated NFP. */
  readonly nfps: Map<string, Paths>
}

function shapeIdFor(caches: RunCaches, part: Polygon): number {
  const key = JSON.stringify(part.points)
  const existing = caches.shapeIds.get(key)
  if (existing !== undefined) return existing
  const id = caches.shapeIds.size
  caches.shapeIds.set(key, id)
  return id
}

/**
 * NFP of a placed shape-orientation vs a candidate shape-orientation, both in
 * their LOCAL (untranslated) frames. NFP(P + u, C) = NFP(P, C) + u, so one
 * cache entry serves every instance of the same shape pair — translation is
 * applied at lookup time. The candidate is negated and passed as `pattern`;
 * the placed polygon rides in the Paths slot so Clipper adds the
 * hole-closing fill (see module header).
 */
function nfpFor(
  caches: RunCaches,
  placedShapeId: number,
  placedRotIdx: number,
  placedRing: Path,
  candShapeId: number,
  candRotIdx: number,
  candRing: Path
): Paths {
  const key = `${placedShapeId}|${placedRotIdx}>>${candShapeId}|${candRotIdx}`
  const cached = caches.nfps.get(key)
  if (cached) return cached
  const nfp = ClipperLib.Clipper.MinkowskiSum(negatePath(candRing), [placedRing], true)
  caches.nfps.set(key, nfp)
  return nfp
}

/** Largest-|area| ring of an inflated body — the canonical NFP operand. */
function mainRingOf(paths: Paths): Path {
  let main = paths[0]!
  let best = Math.abs(ClipperLib.Clipper.Area(main))
  for (let i = 1; i < paths.length; i++) {
    const a = Math.abs(ClipperLib.Clipper.Area(paths[i]!))
    if (a > best) {
      best = a
      main = paths[i]!
    }
  }
  return main
}

/**
 * Exact zero-overlap gate: does the candidate body at translation (tx, ty)
 * keep ZERO intersection area against every placed part? Bbox pre-filter,
 * then true Clipper intersection. This is what makes a committed placement
 * safe by construction.
 */
function placementCollides(
  geom: OrientedPartGeometryInt,
  tx: number,
  ty: number,
  sheet: SheetState
): boolean {
  const minX = geom.inflatedBounds.minX + tx
  const minY = geom.inflatedBounds.minY + ty
  const maxX = geom.inflatedBounds.maxX + tx
  const maxY = geom.inflatedBounds.maxY + ty
  let translated: Paths | null = null
  for (const p of sheet.placed) {
    if (
      maxX <= p.translatedBounds.minX ||
      minX >= p.translatedBounds.maxX ||
      maxY <= p.translatedBounds.minY ||
      minY >= p.translatedBounds.maxY
    ) {
      continue // bboxes disjoint (or merely touching) — zero overlap area is guaranteed
    }
    if (!translated) {
      translated = geom.inflatedPaths.map((ring) => translatePath(ring, tx, ty))
    }
    if (intersectionAreaIntUnits2(translated, p.translatedInflated) > 0) return true
  }
  return false
}

/**
 * Push the crossings of every forbidden-region edge with the four inner-fit
 * rectangle boundary LINES. Computed directly (exact 64-bit-safe integer
 * cross-multiplication, ≤ 3.6e15 < 2^53) instead of via a Clipper clip so the
 * degenerate rectangle case — a part exactly as wide as the sheet, where the
 * inner-fit region collapses to a line — still yields slide-in candidates.
 */
function pushRectCrossings(
  forbidden: Paths,
  txMin: number,
  txMax: number,
  tyMin: number,
  tyMax: number,
  push: (x: number, y: number) => void
): void {
  const xLines = txMin === txMax ? [txMin] : [txMin, txMax]
  const yLines = tyMin === tyMax ? [tyMin] : [tyMin, tyMax]
  for (const ring of forbidden) {
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % n]!
      for (const lx of xLines) {
        const da = a.X - lx
        const db = b.X - lx
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const y = Math.round(a.Y + ((b.Y - a.Y) * (lx - a.X)) / (b.X - a.X))
          push(lx, y)
        }
      }
      for (const ly of yLines) {
        const da = a.Y - ly
        const db = b.Y - ly
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const x = Math.round(a.X + ((b.X - a.X) * (ly - a.Y)) / (b.Y - a.Y))
          push(x, ly)
        }
      }
    }
  }
}

/**
 * Bottom-left-fill position for ONE orientation on ONE sheet, or null when the
 * orientation fits nowhere. Returns the committed-candidate translation in
 * integer units.
 */
function findBlfPosition(
  cand: OrientationCandidate,
  env: SheetEnvInt,
  sheet: SheetState,
  caches: RunCaches,
  candShapeId: number
): { tx: number; ty: number } | null {
  const geom = cand.geom
  const txMin = env.marginInt - geom.inflatedBounds.minX
  const txMax = env.widthInt - env.marginInt - geom.inflatedBounds.maxX
  const tyMin = env.marginInt - geom.inflatedBounds.minY
  const tyMax = env.heightInt - env.marginInt - geom.inflatedBounds.maxY
  if (txMin > txMax || tyMin > tyMax) return null

  // Empty sheet: the bottom-left corner of the inner-fit rectangle is optimal
  // and trivially collision-free.
  if (sheet.placed.length === 0) return { tx: txMin, ty: tyMin }

  // Forbidden region: union of every placed part's NFP vs this candidate,
  // each translated to its placement. The union's vertices include the
  // NFP × NFP boundary crossings between different placed parts.
  const candRing = mainRingOf(geom.inflatedPaths)
  const rings: Paths = []
  for (const p of sheet.placed) {
    const orientedKey = `${p.shapeId}|${p.rotIdx}`
    const placedGeom = caches.oriented.get(orientedKey)
    if (!placedGeom) continue // unreachable: placed parts always have geometry
    const nfp = nfpFor(
      caches,
      p.shapeId,
      p.rotIdx,
      mainRingOf(placedGeom.inflatedPaths),
      candShapeId,
      cand.rotIdx,
      candRing
    )
    for (const ring of nfp) rings.push(translatePath(ring, p.tx, p.ty))
  }
  const forbidden = unionPaths(rings)

  // Candidate translations: rectangle corners + forbidden-region vertices in
  // the rectangle + forbidden-edge × rectangle-line crossings. Every entry is
  // STRICTLY validated before commit, so this set only bounds optimality,
  // never safety.
  const seen = new Set<string>()
  const candidates: IntPoint[] = []
  const push = (x: number, y: number): void => {
    if (x < txMin || x > txMax || y < tyMin || y > tyMax) return
    const key = `${x},${y}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ X: x, Y: y })
  }
  push(txMin, tyMin)
  push(txMax, tyMin)
  push(txMin, tyMax)
  push(txMax, tyMax)
  for (const ring of forbidden) {
    for (const v of ring) push(v.X, v.Y)
  }
  pushRectCrossings(forbidden, txMin, txMax, tyMin, tyMax, push)

  candidates.sort((a, b) => a.Y - b.Y || a.X - b.X)

  for (const c of candidates) {
    if (placementCollides(geom, c.X, c.Y, sheet)) continue
    return { tx: c.X, ty: c.Y }
  }
  return null
}

interface SheetWin {
  tx: number
  ty: number
  cand: OrientationCandidate
  /** Final placed raw-bbox min corner (int units) — the BLF comparison key. */
  px: number
  py: number
}

/** Best (bottom-left-most) orientation for this part on this sheet, or null. */
function tryPlaceOnSheet(
  orientations: ReadonlyArray<OrientationCandidate>,
  env: SheetEnvInt,
  sheet: SheetState,
  caches: RunCaches,
  candShapeId: number
): SheetWin | null {
  let best: SheetWin | null = null
  for (const cand of orientations) {
    const pos = findBlfPosition(cand, env, sheet, caches, candShapeId)
    if (!pos) continue
    const px = cand.geom.rawBounds.minX + pos.tx
    const py = cand.geom.rawBounds.minY + pos.ty
    if (!best || py < best.py || (py === best.py && px < best.px)) {
      best = { tx: pos.tx, ty: pos.ty, cand, px, py }
    }
    // Ties keep the earlier rotation index (orientations iterate in rotation
    // order and the comparison is strict) — deterministic.
  }
  return best
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Nest the given polygons onto one or more sheets using true-shape NFP
 * bottom-left-fill. See the module header for the algorithm, the placement
 * coordinate contract (identical to v1), and the safety gate.
 *
 * Deterministic: same input ⇒ identical result. No RNG, no clock, no
 * iteration-order dependence (all orders are explicit total orders).
 */
export function nestPolygonsNfp(
  parts: ReadonlyArray<Polygon>,
  sheet: SheetSpec,
  opts: NfpNestOptions = {}
): NfpNestResult {
  if (sheet.widthMm <= 0 || sheet.heightMm <= 0) {
    throw new Error(`SheetSpec must have positive dimensions; got ${sheet.widthMm} x ${sheet.heightMm}`)
  }
  const marginMm = Math.max(0, sheet.marginMm ?? 0)
  const spacingMm = Math.max(0, opts.partMarginMm ?? DEFAULT_PART_MARGIN_MM)
  const rotations = resolveRotations(opts)
  const maxSheets = resolveMaxSheets(opts)

  const env: SheetEnvInt = {
    widthInt: Math.round(sheet.widthMm * CLIPPER_SCALE),
    heightInt: Math.round(sheet.heightMm * CLIPPER_SCALE),
    marginInt: Math.round(marginMm * CLIPPER_SCALE)
  }

  const caches: RunCaches = {
    shapeIds: new Map<string, number>(),
    oriented: new Map<string, OrientedPartGeometryInt | null>(),
    nfps: new Map<string, Paths>()
  }

  // Validate + measure parts, then sort largest-area-first (input order breaks ties).
  interface PartCandidate {
    id: string
    points: ReadonlyArray<Pt>
    areaMm2: number
    shapeId: number
    inputIdx: number
  }
  const candidates: PartCandidate[] = parts.map((p, inputIdx) => {
    for (const [x, y] of p.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Invalid part "${p.id}": non-finite coordinate`)
      }
    }
    return {
      id: p.id,
      points: p.points,
      areaMm2: polygonAreaAbsMm2(p.points),
      shapeId: shapeIdFor(caches, p),
      inputIdx
    }
  })
  candidates.sort((a, b) => b.areaMm2 - a.areaMm2 || a.inputIdx - b.inputIdx)

  const orientationFor = (shapeId: number, points: ReadonlyArray<Pt>, rotIdx: number): OrientedPartGeometryInt | null => {
    const key = `${shapeId}|${rotIdx}`
    const cached = caches.oriented.get(key)
    if (cached !== undefined) return cached
    const geom = orientedPartGeometryInt(points, rotations[rotIdx]!, spacingMm)
    caches.oriented.set(key, geom)
    return geom
  }

  const sheets: SheetState[] = []
  const placements: NfpPlacement[] = []
  const unplaced: string[] = []
  let totalPartAreaMm2 = 0

  for (const part of candidates) {
    if (part.areaMm2 < MIN_PART_AREA_MM2) {
      unplaced.push(part.id)
      continue
    }
    const orientations: OrientationCandidate[] = []
    for (let rotIdx = 0; rotIdx < rotations.length; rotIdx++) {
      const geom = orientationFor(part.shapeId, part.points, rotIdx)
      if (geom) orientations.push({ rotIdx, rotationDeg: rotations[rotIdx]!, geom })
    }
    if (orientations.length === 0) {
      unplaced.push(part.id)
      continue
    }

    let win: SheetWin | null = null
    let winSheetIdx = -1
    for (let s = 0; s < sheets.length && !win; s++) {
      win = tryPlaceOnSheet(orientations, env, sheets[s]!, caches, part.shapeId)
      if (win) winSheetIdx = s
    }
    if (!win && sheets.length < maxSheets) {
      const fresh: SheetState = { placed: [] }
      win = tryPlaceOnSheet(orientations, env, fresh, caches, part.shapeId)
      if (win) {
        sheets.push(fresh)
        winSheetIdx = sheets.length - 1
      }
    }
    if (!win) {
      unplaced.push(part.id)
      continue
    }

    const geom = win.cand.geom
    const { tx, ty } = win
    sheets[winSheetIdx]!.placed.push({
      shapeId: part.shapeId,
      rotIdx: win.cand.rotIdx,
      translatedInflated: geom.inflatedPaths.map((ring) => translatePath(ring, tx, ty)),
      translatedBounds: {
        minX: geom.inflatedBounds.minX + tx,
        minY: geom.inflatedBounds.minY + ty,
        maxX: geom.inflatedBounds.maxX + tx,
        maxY: geom.inflatedBounds.maxY + ty
      },
      tx,
      ty
    })
    placements.push({
      partId: part.id,
      xMm: win.px / CLIPPER_SCALE,
      yMm: win.py / CLIPPER_SCALE,
      rotationDeg: win.cand.rotationDeg,
      sheetIndex: winSheetIdx
    })
    totalPartAreaMm2 += part.areaMm2
  }

  const sheetsUsed = sheets.length
  const sheetUsedAreaMm2 = round3(sheet.widthMm * sheet.heightMm * sheetsUsed)
  const utilizationPct =
    sheetUsedAreaMm2 > 0 ? round3((totalPartAreaMm2 / sheetUsedAreaMm2) * 100) : 0

  return {
    placements,
    unplaced,
    utilizationPct,
    sheetUsedAreaMm2,
    totalPartAreaMm2: round3(totalPartAreaMm2),
    sheetsUsed,
    nestVersion: 'nfp-v2'
  }
}
