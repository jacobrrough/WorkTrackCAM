/**
 * Text / TrueType → machinable sketch vectors.
 *
 * "Sign work is impossible without machinable text vectors" (see
 * docs/plans/catalog/vcarve-laguna.md, Text/Clipart rows; cad-design.md gap #7).
 * This module turns a string + a parsed font into CLOSED contours that drop
 * straight into the {@link DesignFileV2} sketch model — the SAME model the live
 * `SketchSurface` edits and `cam-2d-derive.ts` reads to derive contour / pocket /
 * V-carve toolpaths. A V-carved or profiled letter is then just a closed loop (or
 * loops, for letters with counters) like any other sketch profile.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PURE — no I/O, no `window`, no React
 * ──────────────────────────────────────────────────────────────────────────
 * The function never reads a file or hits the network. It takes an already-parsed
 * `opentype.Font` (renderer path: parse the bundled `resources/fonts/*.ttf` once
 * and pass the handle) OR a raw font buffer (which it parses in-process via
 * `opentype.parse`). The bundled font ships with the app, so there is NO network
 * at runtime. This keeps the module unit-testable in the `node` vitest env and
 * callable from either the renderer host or a future main-side importer — exactly
 * like its sibling {@link ./dxf-to-sketch}.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WINDING / HOLES (machinability contract)
 * ──────────────────────────────────────────────────────────────────────────
 * A glyph like O / A / e / R / 8 has an OUTER boundary plus one or more inner
 * COUNTERS (the holes). For the cut to be correct the counter must be a hole, not
 * a second solid island. Fonts disagree on raw contour winding (TrueType vs CFF
 * differ, and authoring tools are inconsistent), so this module does NOT trust the
 * font's stored direction. Instead it classifies every contour by EVEN-ODD
 * containment nesting (point-in-polygon ray cast): a contour nested inside an odd
 * number of others is a hole; depth-0 / even-depth contours are solid. It then
 * normalises winding so the emitted geometry satisfies BOTH common fill rules:
 *   - OUTER (solid) contours are oriented CCW (positive shoelace area);
 *   - HOLE contours are oriented CW (negative shoelace area).
 * That is the standard "polygon with holes" representation `generateContour2dLines`
 * (cam-local.ts) already reverses to the requested climb/conventional side, and it
 * makes the nested-ring even-odd derivation in cam-2d-derive unambiguous. Each
 * emitted contour ALSO carries an explicit `isHole` flag so a consumer can use the
 * flag instead of re-deriving winding.
 *
 * ── Geometry ──
 *   - opentype path commands: M (move = new contour), L (line), Q (quadratic
 *     bezier), C (cubic bezier), Z (close). Many fonts (e.g. Roboto) emit NO Z and
 *     delimit contours purely by M — so a contour is every run of draw commands
 *     between two M markers (or M → end), and is always treated as CLOSED.
 *   - Q and C curves are flattened by adaptive recursive subdivision to a chord
 *     tolerance ({@link DEFAULT_CHORD_TOLERANCE_MM}), so a letter's curve survives
 *     as a fine polyline rather than a faceted approximation.
 *   - Font em units have +Y UP with the baseline at y=0 and ascenders positive.
 *     Sketch space is also +Y up, so glyphs are emitted baseline-on-y=0 with the
 *     cap rising into +Y (no vertical flip needed). Each new text line steps DOWN
 *     by `lineSpacingMm` (default = `sizeMm`).
 *   - Pen advances by each glyph's own advance width (scaled) plus `letterSpacing`,
 *     so total run width scales linearly with `sizeMm`.
 */
// opentype.js 2.0's ESM build has NO default export (named-only: parse/Font/Glyph/…).
// tsc's synthetic-default interop hides this, but Rollup (electron-vite build) rejects a
// default import — so use a namespace import for the value + a type-only import for the types.
import * as opentype from 'opentype.js'
import type { Font, Glyph, PathCommand } from 'opentype.js'
import type { DesignFileV2, SketchEntity, SketchPoint } from './design-schema'
import { emptyDesign } from './design-schema'

/**
 * Default chord-deviation budget (mm) for flattening a glyph curve. 0.05 mm is far
 * below a router / V-bit's practical surface fidelity, mirroring the DXF bulge
 * tolerance in {@link ./dxf-to-sketch} so text and imported curves share a feel.
 */
export const DEFAULT_CHORD_TOLERANCE_MM = 0.05

/** Hard cap on subdivision recursion depth per bezier segment (bounds point count). */
const MAX_BEZIER_RECURSION = 12

/** Collapse points closer than this (mm) — removes near-duplicate samples on tight curves. */
const COINCIDENT_EPS_MM = 1e-4
const COINCIDENT_EPS_SQ = COINCIDENT_EPS_MM * COINCIDENT_EPS_MM

/** A flattened, closed glyph contour in sketch mm (CCW = solid, CW = hole). */
export interface TextContour {
  /** Ordered loop vertices (mm). First and last are NOT duplicated (loop is implicitly closed). */
  readonly points: ReadonlyArray<readonly [number, number]>
  /** True when this contour is an inner counter (a machinable hole), false for a solid boundary. */
  readonly isHole: boolean
  /** Even-odd nesting depth (0 = outermost). Even = solid, odd = hole. */
  readonly depth: number
  /** Index of the source glyph in the run (0-based), for grouping a letter's loops. */
  readonly glyphIndex: number
  /** The character that produced this contour (best-effort; empty for unmapped glyphs). */
  readonly char: string
}

/** Options for {@link textToSketchVectors}. Provide exactly one of `font` / `fontBuffer`. */
export interface TextToVectorsOptions {
  /** The text to vectorise. Newlines split lines; each line starts a new baseline. */
  readonly text: string
  /** A pre-parsed opentype font (renderer path: parse the bundled ttf once, reuse). */
  readonly font?: Font
  /** Raw font bytes (ArrayBuffer / typed-array / Node Buffer); parsed in-process. */
  readonly fontBuffer?: ArrayBuffer | ArrayBufferView
  /** Cap height target in mm — the glyph em square maps to this many mm. */
  readonly sizeMm: number
  /** Extra gap (mm) added between glyph advances. Default 0. May be negative (tracking-in). */
  readonly letterSpacingMm?: number
  /** Baseline-to-baseline step (mm) for multi-line text. Default = `sizeMm`. */
  readonly lineSpacingMm?: number
  /**
   * Chord-deviation budget (mm) for curve flattening. Default
   * {@link DEFAULT_CHORD_TOLERANCE_MM}. Smaller = finer polylines = more points.
   */
  readonly chordToleranceMm?: number
  /**
   * Id prefix for the generated entities/points (stable, collision-resistant).
   * Defaults to a timestamp-seeded `txt` tag so repeated inserts do not collide.
   */
  readonly idPrefix?: string
}

/** Result of vectorising text: the classified contours plus the sketch-model fragment. */
export interface TextToVectorsResult {
  /** Every closed contour, outer + holes, with winding normalised and `isHole` set. */
  readonly contours: TextContour[]
  /** Closed-polyline sketch entities (one per contour) ready to merge into a design. */
  readonly entities: SketchEntity[]
  /** Point records referenced by {@link entities} (keyed by the ids the entities use). */
  readonly points: Record<string, SketchPoint>
  /** Tight bounding box of all emitted geometry (mm); zero-size when empty. */
  readonly bbox: { minX: number; minY: number; maxX: number; maxY: number }
  /** Total advance width of the widest line (mm) — the pen's furthest +X reach. */
  readonly advanceWidthMm: number
  /** Count of glyphs that had no drawable outline (spaces, unmapped chars). */
  readonly emptyGlyphCount: number
}

type Pt = readonly [number, number]

/** Resolve the input options to a usable opentype Font (parse the buffer if needed). */
function resolveFont(opts: TextToVectorsOptions): Font {
  if (opts.font) return opts.font
  if (opts.fontBuffer) {
    const ab = toArrayBuffer(opts.fontBuffer)
    return opentype.parse(ab)
  }
  throw new Error('textToSketchVectors: provide either `font` or `fontBuffer`.')
}

/** Normalise any byte source to a plain ArrayBuffer (what opentype.parse wants). */
function toArrayBuffer(src: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (src instanceof ArrayBuffer) return src
  // Typed array / DataView / Node Buffer — copy the exact backing region into a
  // fresh ArrayBuffer (also normalises a SharedArrayBuffer-backed view to a plain
  // ArrayBuffer, which opentype.parse expects).
  const view = new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
  const out = new ArrayBuffer(view.byteLength)
  new Uint8Array(out).set(view)
  return out
}

/** Squared planar distance. */
function distSq(a: Pt, b: Pt): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

/** Signed shoelace area (×2). Positive = CCW, negative = CW. */
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
 * Even-odd point-in-polygon ray cast (horizontal ray to +X). Robust for the
 * non-self-intersecting glyph loops produced by font outlines.
 */
function pointInPolygon(p: Pt, poly: ReadonlyArray<Pt>): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i]![0]
    const yi = poly[i]![1]
    const xj = poly[j]![0]
    const yj = poly[j]![1]
    const intersects =
      yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** Flatten one quadratic bezier (P0,C,P1) into interior points (excludes P0, includes P1). */
function flattenQuadratic(
  p0: Pt,
  c: Pt,
  p1: Pt,
  tolSq: number,
  out: Pt[],
  depth: number
): void {
  // Distance² from control point to the chord midpoint approximates flatness.
  if (depth >= MAX_BEZIER_RECURSION) {
    out.push(p1)
    return
  }
  const mx = (p0[0] + p1[0]) / 2
  const my = (p0[1] + p1[1]) / 2
  const dx = c[0] - mx
  const dy = c[1] - my
  if (dx * dx + dy * dy <= tolSq) {
    out.push(p1)
    return
  }
  // Subdivide at t = 0.5 (de Casteljau).
  const c0: Pt = [(p0[0] + c[0]) / 2, (p0[1] + c[1]) / 2]
  const c1: Pt = [(c[0] + p1[0]) / 2, (c[1] + p1[1]) / 2]
  const mid: Pt = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2]
  flattenQuadratic(p0, c0, mid, tolSq, out, depth + 1)
  flattenQuadratic(mid, c1, p1, tolSq, out, depth + 1)
}

/** Flatten one cubic bezier (P0,C1,C2,P1) into interior points (excludes P0, includes P1). */
function flattenCubic(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p1: Pt,
  tolSq: number,
  out: Pt[],
  depth: number
): void {
  if (depth >= MAX_BEZIER_RECURSION) {
    out.push(p1)
    return
  }
  // Flatness: max distance² of the two control points from the chord.
  const d1 = distToSegSq(c1, p0, p1)
  const d2 = distToSegSq(c2, p0, p1)
  if (Math.max(d1, d2) <= tolSq) {
    out.push(p1)
    return
  }
  // de Casteljau split at t = 0.5.
  const p01: Pt = [(p0[0] + c1[0]) / 2, (p0[1] + c1[1]) / 2]
  const p12: Pt = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2]
  const p23: Pt = [(c2[0] + p1[0]) / 2, (c2[1] + p1[1]) / 2]
  const p012: Pt = [(p01[0] + p12[0]) / 2, (p01[1] + p12[1]) / 2]
  const p123: Pt = [(p12[0] + p23[0]) / 2, (p12[1] + p23[1]) / 2]
  const mid: Pt = [(p012[0] + p123[0]) / 2, (p012[1] + p123[1]) / 2]
  flattenCubic(p0, p01, p012, mid, tolSq, out, depth + 1)
  flattenCubic(mid, p123, p23, p1, tolSq, out, depth + 1)
}

/** Squared distance from point P to segment A–B (for cubic flatness). */
function distToSegSq(p: Pt, a: Pt, b: Pt): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return apx * apx + apy * apy
  let t = (apx * abx + apy * aby) / ab2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = a[0] + t * abx
  const cy = a[1] + t * aby
  const ex = p[0] - cx
  const ey = p[1] - cy
  return ex * ex + ey * ey
}

/** Drop consecutive coincident points and any duplicate closing point. */
function cleanLoop(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && distSq(last, p) <= COINCIDENT_EPS_SQ) continue
    out.push(p)
  }
  // Remove a trailing point coincident with the first (loop is implicitly closed).
  while (out.length >= 2 && distSq(out[0]!, out[out.length - 1]!) <= COINCIDENT_EPS_SQ) {
    out.pop()
  }
  return out
}

/** A glyph's flattened contours (pre-classification), already offset + scaled to sketch mm. */
interface RawGlyphContour {
  points: Pt[]
  glyphIndex: number
  char: string
}

/**
 * Walk one glyph's opentype path commands into flattened, closed contours.
 *
 * The path is already positioned (penX/penY baseline) and scaled to sketch mm by
 * opentype's `getPath(x, y, fontSizeMm)` — BUT opentype's screen-Y points DOWN
 * (it bakes a vertical flip for canvas rendering). We want sketch +Y UP with the
 * baseline at y=0, so the caller passes the RAW em-unit path and we apply the
 * scale + Y-up mapping here, which keeps the math explicit and testable.
 */
function glyphPathToContours(
  glyph: Glyph,
  penXMm: number,
  baselineYMm: number,
  scale: number,
  tolSq: number,
  glyphIndex: number,
  char: string
): RawGlyphContour[] {
  // Em-unit outline straight off the glyph. `glyph.path.commands` is in FONT
  // units with +Y UP (baseline at 0, cap height positive) — unlike
  // `font.getPath(x,y,size)`, which bakes a canvas-style vertical flip. So we map
  // em-Y DIRECTLY (no negation): sketch space is also +Y up with the baseline on
  // y=0 and the cap rising into +Y. `baselineYMm` steps DOWN (−Y) per text line.
  const cmds: PathCommand[] = glyph.path.commands
  const map = (ex: number, ey: number): Pt => [penXMm + ex * scale, baselineYMm + ey * scale]

  const contours: RawGlyphContour[] = []
  let current: Pt[] = []
  let start: Pt | null = null
  let cursor: Pt | null = null

  const finish = (): void => {
    if (current.length >= 3) {
      const cleaned = cleanLoop(current)
      if (cleaned.length >= 3) contours.push({ points: cleaned, glyphIndex, char })
    }
    current = []
  }

  for (const cmd of cmds) {
    switch (cmd.type) {
      case 'M': {
        finish()
        const p = map(cmd.x, cmd.y)
        start = p
        cursor = p
        current = [p]
        break
      }
      case 'L': {
        const p = map(cmd.x, cmd.y)
        current.push(p)
        cursor = p
        break
      }
      case 'Q': {
        if (cursor) {
          const ctrl = map(cmd.x1, cmd.y1)
          const end = map(cmd.x, cmd.y)
          flattenQuadratic(cursor, ctrl, end, tolSq, current, 0)
          cursor = end
        }
        break
      }
      case 'C': {
        if (cursor) {
          const ctrl1 = map(cmd.x1, cmd.y1)
          const ctrl2 = map(cmd.x2, cmd.y2)
          const end = map(cmd.x, cmd.y)
          flattenCubic(cursor, ctrl1, ctrl2, end, tolSq, current, 0)
          cursor = end
        }
        break
      }
      case 'Z': {
        // Explicit close — connect back to start (cleanLoop drops the dupe).
        if (start) current.push(start)
        finish()
        start = null
        cursor = null
        break
      }
    }
  }
  finish()
  return contours
}

/**
 * Classify contours into solid / hole by even-odd nesting and normalise winding.
 *
 * For each contour we count how many OTHER contours contain it (testing a point
 * guaranteed to lie inside the contour's OWN solid band — see
 * {@link interiorPoint}; a centroid would be wrong for ring-shaped outer
 * contours, whose centroid sits in the counter/hole). That count is the nesting
 * depth: even → solid (oriented CCW), odd → hole (oriented CW). Glyph contours do
 * not self-intersect, so even-odd nesting is exact.
 */
function classifyAndOrient(raw: RawGlyphContour[]): TextContour[] {
  const probes = raw.map((c) => interiorPoint(c.points))
  const out: TextContour[] = []
  for (let i = 0; i < raw.length; i++) {
    const ci = raw[i]!
    const probe = probes[i]!
    let depth = 0
    for (let j = 0; j < raw.length; j++) {
      if (j === i) continue
      if (pointInPolygon(probe, raw[j]!.points)) depth++
    }
    const isHole = depth % 2 === 1
    const area = signedArea2(ci.points)
    // Outer (solid) → CCW (area > 0); hole → CW (area < 0).
    const wantCCW = !isHole
    const points = (area >= 0) === wantCCW ? ci.points : [...ci.points].reverse()
    out.push({ points, isHole, depth, glyphIndex: ci.glyphIndex, char: ci.char })
  }
  return out
}

/**
 * A point GUARANTEED to lie strictly inside a simple (non-self-intersecting)
 * polygon — robust for ring-shaped contours where the centroid falls in the hole.
 *
 * Method: find a STRICTLY CONVEX vertex `v` (relative to the polygon's own
 * winding); the triangle (prev, v, next) then lies inside the polygon near `v`, so
 * the centroid of that ear triangle is an interior point. If no qualifying ear
 * shrinks the triangle (degenerate), fall back to the first-edge midpoint nudged
 * along the inward normal, validated by {@link pointInPolygon}.
 */
function interiorPoint(pts: ReadonlyArray<Pt>): Pt {
  const n = pts.length
  if (n < 3) return pts[0] ?? [0, 0]
  // Winding sign: +1 for CCW, -1 for CW.
  const wind = signedArea2(pts) >= 0 ? 1 : -1
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!
    const v = pts[i]!
    const next = pts[(i + 1) % n]!
    const ax = v[0] - prev[0]
    const ay = v[1] - prev[1]
    const bx = next[0] - v[0]
    const by = next[1] - v[1]
    const cross = ax * by - ay * bx
    // Strictly convex vertex for this winding → ear triangle is inside.
    if (cross * wind > 1e-9) {
      const cand: Pt = [(prev[0] + v[0] + next[0]) / 3, (prev[1] + v[1] + next[1]) / 3]
      if (pointInPolygon(cand, pts)) return cand
    }
  }
  // Fallback: nudge the first-edge midpoint along its inward normal.
  const a = pts[0]!
  const b = pts[1]!
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const len = Math.hypot(ex, ey) || 1
  // Left normal for CCW points into the interior; flip for CW.
  const nx = (-ey / len) * wind
  const ny = (ex / len) * wind
  for (const step of [1e-3, 1e-2, 0.1, 1]) {
    const cand: Pt = [mx + nx * step, my + ny * step]
    if (pointInPolygon(cand, pts)) return cand
  }
  return [mx, my]
}

/** Minimal id minter — deterministic given the prefix (reproducible diffs / snapshots). */
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

/**
 * Vectorise `text` into CLOSED machinable contours + a {@link DesignFileV2} sketch
 * fragment. Pure: no file/network I/O, no DOM. See the module header for the
 * winding / hole contract and the geometry notes.
 *
 * @throws if neither `font` nor `fontBuffer` is supplied, or `sizeMm` is not a
 * positive finite number.
 */
export function textToSketchVectors(opts: TextToVectorsOptions): TextToVectorsResult {
  if (!Number.isFinite(opts.sizeMm) || opts.sizeMm <= 0) {
    throw new Error(`textToSketchVectors: sizeMm must be a positive number (got ${opts.sizeMm}).`)
  }
  const font = resolveFont(opts)
  const unitsPerEm = font.unitsPerEm || 1000
  const scale = opts.sizeMm / unitsPerEm
  const letterSpacing = opts.letterSpacingMm ?? 0
  const lineSpacing = opts.lineSpacingMm ?? opts.sizeMm
  const tol = opts.chordToleranceMm ?? DEFAULT_CHORD_TOLERANCE_MM
  const tolSq = tol * tol

  const lines = opts.text.split('\n')
  const rawContours: RawGlyphContour[] = []
  let emptyGlyphCount = 0
  let maxAdvanceMm = 0
  let runningGlyphIndex = 0

  lines.forEach((line, lineIdx) => {
    // Baseline steps DOWN for each subsequent line (sketch +Y up).
    const baselineYMm = -lineIdx * lineSpacing
    let penXMm = 0
    const glyphs: Glyph[] = font.stringToGlyphs(line)
    // Map each glyph back to its source character (best-effort, index-aligned).
    for (let gi = 0; gi < glyphs.length; gi++) {
      const glyph = glyphs[gi]!
      const char = line[gi] ?? ''
      const advanceEm = glyph.advanceWidth ?? 0
      const before = rawContours.length
      const cs = glyphPathToContours(
        glyph,
        penXMm,
        baselineYMm,
        scale,
        tolSq,
        runningGlyphIndex,
        char
      )
      for (const c of cs) rawContours.push(c)
      if (rawContours.length === before) emptyGlyphCount++
      penXMm += advanceEm * scale + letterSpacing
      runningGlyphIndex++
    }
    // Pen reach for this line excludes the trailing letterSpacing.
    const lineAdvance = penXMm - (glyphs.length > 0 ? letterSpacing : 0)
    if (lineAdvance > maxAdvanceMm) maxAdvanceMm = lineAdvance
  })

  const contours = classifyAndOrient(rawContours)

  // Build the sketch-model fragment (closed polyline per contour).
  const prefix = opts.idPrefix ?? `txt${Date.now().toString(36)}`
  const ids = new IdMinter(prefix)
  const points: Record<string, SketchPoint> = {}
  const entities: SketchEntity[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const c of contours) {
    const pointIds: string[] = []
    for (const [x, y] of c.points) {
      const id = ids.point()
      points[id] = { x, y }
      pointIds.push(id)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    entities.push({ id: ids.entity(), kind: 'polyline', pointIds, closed: true })
  }

  const bbox =
    entities.length > 0
      ? { minX, minY, maxX, maxY }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  return {
    contours,
    entities,
    points,
    bbox,
    advanceWidthMm: maxAdvanceMm,
    emptyGlyphCount
  }
}

/** Options for {@link mergeTextVectorsIntoDesign}. */
export interface MergeTextOptions extends TextToVectorsOptions {
  /** When true, REPLACE the base design's entities/points; default false (additive). */
  readonly replace?: boolean
}

/**
 * Convenience: vectorise text and fold the result into a {@link DesignFileV2}
 * (additive by default, like {@link ./dxf-to-sketch.dxfToSketch}). Pure; does not
 * mutate `base`. Every other field of `base` (parameters, constraints, dimensions,
 * extrude settings, sketch plane) is preserved untouched.
 */
export function mergeTextVectorsIntoDesign(
  opts: MergeTextOptions,
  base: DesignFileV2 = emptyDesign()
): { design: DesignFileV2; result: TextToVectorsResult } {
  const result = textToSketchVectors(opts)
  const points: Record<string, SketchPoint> = opts.replace
    ? { ...result.points }
    : { ...base.points, ...result.points }
  const entities: SketchEntity[] = opts.replace
    ? [...result.entities]
    : [...base.entities, ...result.entities]
  const design: DesignFileV2 = { ...base, points, entities }
  return { design, result }
}
