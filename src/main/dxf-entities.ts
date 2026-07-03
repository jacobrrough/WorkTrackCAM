/**
 * Pure R12-compatible ASCII DXF entity emitter.
 *
 * ## Why this module exists
 *
 * The drawing DXF export (`drawing-export-templates.ts` → `buildRealDxf`) used
 * to emit only a frame + a title + mesh-silhouette LINE soup. A shop feeding
 * that DXF to a laser / plasma / other CAM gets a useless wireframe — no
 * dimensions, no notes, no center marks. This module is the honest, testable
 * entity layer that composes the drawing's REAL annotation content into a DXF
 * a downstream CAD/CAM tool can open.
 *
 * ## Scope: pure entity + document assembly, NO annotation knowledge
 *
 * This file knows about DXF group codes ONLY. It exposes small builders — one
 * per entity kind (LINE / LWPOLYLINE / TEXT) — plus a document assembler that
 * stitches the fixed HEADER / TABLES (LAYER + LTYPE) / BLOCKS / ENTITIES / EOF
 * skeleton around a caller-supplied entity list. The mapping FROM a persisted
 * `DrawingSheetAnnotations` (dimensions exploded to primitives, GD&T frames,
 * notes, center marks) INTO these entities lives in
 * `drawing-export-templates.ts`, which owns the coordinate transform.
 *
 * ## R12 (AC1009) target
 *
 * R12 is the lowest-common-denominator DXF every CAD/CAM importer reads. It has
 * no true associative DIMENSION explode support that round-trips cleanly across
 * tools, so the export templates render dimensions as their PRIMITIVES
 * (extension lines, dimension line, ticks, value TEXT) — this module only needs
 * LINE / LWPOLYLINE / TEXT plus the standard layer + linetype tables. Every
 * emitted value is a group-code pair; the assembler guarantees section order,
 * a single trailing EOF, and `$INSUNITS = 4` (millimetres).
 *
 * ## Safety
 *
 *  * Safety Rule 1 — documentation only. Nothing here is read by the CAM
 *    toolpath / post-processor pipeline. A DXF drawing export is inert to
 *    G-code.
 *  * Safety Rule 3 — no `any`. Every entity is a typed discriminated-union
 *    member.
 *  * Safety Rule 4 — TEXT control codes are escaped ({@link escapeDxfText}):
 *    a `\n` / `^`-style control sequence in operator free-text can never break
 *    the group-code stream, and non-ASCII is degraded honestly to `?` so a
 *    stray multi-byte glyph cannot corrupt an ASCII-only R12 reader.
 */

// ---------------------------------------------------------------------------
// Layer + linetype vocabulary
// ---------------------------------------------------------------------------

/**
 * The fixed layer set every drawing DXF carries. `0` is the mandatory DXF
 * default layer; the rest segregate the annotation kinds so a downstream tool
 * can freeze / recolor / re-purpose each independently (e.g. send PROJECTION to
 * the cutter and leave DIMENSIONS as reference).
 */
export const DXF_LAYERS = {
  /** DXF-mandatory default layer (never removed). */
  DEFAULT: '0',
  /** Visible projected model linework (outer silhouette / visible edges). */
  PROJECTION: 'PROJECTION',
  /** Hidden-line projected linework (drawn with the HIDDEN linetype). */
  HIDDEN: 'HIDDEN',
  /** Exploded dimension primitives (extension/dimension lines, ticks, value text). */
  DIMENSIONS: 'DIMENSIONS',
  /** GD&T frames, surface finishes, notes, tap call-outs. */
  ANNOTATIONS: 'ANNOTATIONS',
  /** Center marks + centerlines (drawn with the CENTER linetype). */
  CENTERLINES: 'CENTERLINES',
  /** Sheet frame + title text. */
  TITLE: 'TITLE'
} as const

export type DxfLayer = (typeof DXF_LAYERS)[keyof typeof DXF_LAYERS]

/**
 * The three standard linetypes referenced by the layers above. R12 wants each
 * linetype defined in the LTYPE table with a dash pattern (group 40 = total
 * pattern length, 73 = element count, 49 = each element: +draw / -gap). The
 * dash lengths below are in drawing units (mm) and match common ISO/ANSI
 * conventions closely enough for shop reference linework.
 */
export interface DxfLinetypeDef {
  readonly name: string
  readonly description: string
  /** Dash pattern elements (mm): positive = dash, negative = gap, 0 = dot. Empty = solid. */
  readonly pattern: readonly number[]
}

export const DXF_LINETYPES: readonly DxfLinetypeDef[] = [
  { name: 'CONTINUOUS', description: 'Solid line', pattern: [] },
  { name: 'HIDDEN', description: 'Hidden __ __ __ __ __ __ __ __ __', pattern: [2.5, -1.25] },
  {
    name: 'CENTER',
    description: 'Center ____ _ ____ _ ____ _ ____ _ ____',
    pattern: [12.0, -2.0, 2.0, -2.0]
  }
] as const

/**
 * One layer-table row: which linetype the layer defaults to and its ACI color
 * index (group 62). Colors are cosmetic reference only.
 */
interface DxfLayerDef {
  readonly name: string
  readonly linetype: string
  /** AutoCAD Color Index (1=red … 7=white/black). */
  readonly color: number
}

/**
 * The layer table rows, in a stable order. Colors chosen for legibility in a
 * dark/light CAD viewer; the linetype binds each annotation layer to its dash
 * convention (HIDDEN → dashed, CENTERLINES → chain).
 */
const DXF_LAYER_DEFS: readonly DxfLayerDef[] = [
  { name: DXF_LAYERS.DEFAULT, linetype: 'CONTINUOUS', color: 7 },
  { name: DXF_LAYERS.PROJECTION, linetype: 'CONTINUOUS', color: 7 },
  { name: DXF_LAYERS.HIDDEN, linetype: 'HIDDEN', color: 8 },
  { name: DXF_LAYERS.DIMENSIONS, linetype: 'CONTINUOUS', color: 3 },
  { name: DXF_LAYERS.ANNOTATIONS, linetype: 'CONTINUOUS', color: 5 },
  { name: DXF_LAYERS.CENTERLINES, linetype: 'CENTER', color: 1 },
  { name: DXF_LAYERS.TITLE, linetype: 'CONTINUOUS', color: 7 }
] as const

// ---------------------------------------------------------------------------
// Entity discriminated union
// ---------------------------------------------------------------------------

/** A 2D point in DXF model space (millimetres, Y-up). */
export interface DxfPoint {
  readonly x: number
  readonly y: number
}

/** A straight LINE segment. */
export interface DxfLineEntity {
  readonly type: 'line'
  readonly layer: DxfLayer
  readonly start: DxfPoint
  readonly end: DxfPoint
  /** Optional explicit linetype override (else the layer default is used). */
  readonly linetype?: string
}

/** A lightweight polyline (LWPOLYLINE) — one 70-flag + N vertices. */
export interface DxfPolylineEntity {
  readonly type: 'polyline'
  readonly layer: DxfLayer
  readonly points: readonly DxfPoint[]
  readonly closed: boolean
  readonly linetype?: string
}

/** Horizontal text justification (DXF group 72). */
export type DxfTextHAlign = 'left' | 'center' | 'right'

/** A single-line TEXT entity. */
export interface DxfTextEntity {
  readonly type: 'text'
  readonly layer: DxfLayer
  /** Insertion point (group 10/20 — the left baseline unless aligned). */
  readonly at: DxfPoint
  /** Text height in drawing units (group 40). */
  readonly height: number
  /** The string to render (escaped by the emitter). */
  readonly value: string
  /** Rotation in degrees CCW (group 50). Default 0. */
  readonly rotationDeg?: number
  /** Horizontal justification (group 72). Default 'left'. */
  readonly hAlign?: DxfTextHAlign
}

/** Any emittable DXF entity. */
export type DxfEntity = DxfLineEntity | DxfPolylineEntity | DxfTextEntity

// ---------------------------------------------------------------------------
// Numeric + text formatting
// ---------------------------------------------------------------------------

/**
 * Format a finite number for a DXF real-value group code. Non-finite input
 * (`NaN` / `±Infinity`) collapses to `0` so the emitted stream is always a
 * valid group-code pair — a downstream reader must never choke on `nan`. Trims
 * to 6 decimals (well within R12 real precision) and strips a trailing `.0` so
 * integers stay integers (byte-stable output).
 */
export function formatDxfNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  // toFixed(6) then trim trailing zeros / dot for stable, compact reals.
  const fixed = value.toFixed(6)
  const trimmed = fixed.replace(/\.?0+$/, '')
  // A value like "-0" (from -0.0000001.toFixed) normalises to "0".
  return trimmed === '-0' || trimmed === '' ? '0' : trimmed
}

/**
 * Escape / sanitise operator free-text for a DXF TEXT group-1 value (Safety
 * Rule 4). DXF group values are newline-terminated in the group-code stream, so
 * ANY embedded newline / carriage-return would split one logical value into two
 * and desync every following group code. This:
 *
 *   1. Replaces CR / LF / TAB with a single space (a TEXT entity is one line;
 *      multi-line callers must emit multiple TEXT entities).
 *   2. Degrades every non-ASCII (code point > 126) or non-printable
 *      (< 32) character to `?` — R12 ASCII DXF has no reliable unicode path, so
 *      an honest `?` beats a corrupt byte. (`Ø`, `µ`, emoji → `?`.)
 *   3. Leaves the DXF-special `^` and `\` alone as ordinary characters — R12
 *      TEXT does not interpret MTEXT-style control codes, so they render
 *      literally and cannot break the stream (only newlines can, and those are
 *      gone).
 *
 * Pure: same input → byte-identical output.
 */
export function escapeDxfText(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += ' '
    } else if (code < 32 || code > 126) {
      out += '?'
    } else {
      out += ch
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Per-entity emitters (group-code pair lists)
// ---------------------------------------------------------------------------

/** Map a horizontal-justify enum to its DXF group-72 code. */
function hAlignCode(align: DxfTextHAlign | undefined): string {
  switch (align) {
    case 'center':
      return '1'
    case 'right':
      return '2'
    default:
      return '0'
  }
}

/**
 * Emit one entity as a flat list of group-code strings (code, value, code,
 * value, …). Pure. The caller (`assembleDxfDocument`) concatenates these into
 * the ENTITIES section.
 */
export function emitEntity(entity: DxfEntity): string[] {
  switch (entity.type) {
    case 'line':
      return emitLine(entity)
    case 'polyline':
      return emitPolyline(entity)
    case 'text':
      return emitText(entity)
  }
}

function emitLine(e: DxfLineEntity): string[] {
  const out = ['0', 'LINE', '8', e.layer]
  if (e.linetype !== undefined) out.push('6', e.linetype)
  out.push(
    '10',
    formatDxfNumber(e.start.x),
    '20',
    formatDxfNumber(e.start.y),
    '30',
    '0',
    '11',
    formatDxfNumber(e.end.x),
    '21',
    formatDxfNumber(e.end.y),
    '31',
    '0'
  )
  return out
}

function emitPolyline(e: DxfPolylineEntity): string[] {
  const out = ['0', 'LWPOLYLINE', '8', e.layer]
  if (e.linetype !== undefined) out.push('6', e.linetype)
  out.push(
    '90',
    String(e.points.length),
    '70',
    e.closed ? '1' : '0'
  )
  for (const p of e.points) {
    out.push('10', formatDxfNumber(p.x), '20', formatDxfNumber(p.y))
  }
  return out
}

function emitText(e: DxfTextEntity): string[] {
  const out = ['0', 'TEXT', '8', e.layer]
  out.push(
    '10',
    formatDxfNumber(e.at.x),
    '20',
    formatDxfNumber(e.at.y),
    '30',
    '0',
    '40',
    formatDxfNumber(e.height),
    '1',
    escapeDxfText(e.value)
  )
  if (e.rotationDeg !== undefined && e.rotationDeg !== 0) {
    out.push('50', formatDxfNumber(e.rotationDeg))
  }
  const code72 = hAlignCode(e.hAlign)
  if (code72 !== '0') {
    // Group 72 needs an alignment point (group 11/21) to take effect. R12 uses
    // the second alignment point as the justified position; mirror the
    // insertion point so the text lands where the caller placed it.
    out.push(
      '72',
      code72,
      '11',
      formatDxfNumber(e.at.x),
      '21',
      formatDxfNumber(e.at.y),
      '31',
      '0'
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Table emitters (LAYER + LTYPE)
// ---------------------------------------------------------------------------

/**
 * Emit the LTYPE (linetype) table. Only the linetypes actually referenced by a
 * used layer are strictly needed, but R12 readers tolerate the full set and a
 * fixed table keeps output byte-stable. Each non-continuous linetype carries
 * its group-40 total length + group-73 element count + one group-49 per dash.
 */
function emitLinetypeTable(): string[] {
  const out: string[] = ['0', 'TABLE', '2', 'LTYPE', '70', String(DXF_LINETYPES.length)]
  for (const lt of DXF_LINETYPES) {
    out.push('0', 'LTYPE', '2', lt.name, '70', '0', '3', lt.description, '72', '65')
    if (lt.pattern.length === 0) {
      // Continuous: 0 dash elements, 0 total length.
      out.push('73', '0', '40', '0')
    } else {
      const total = lt.pattern.reduce((s, d) => s + Math.abs(d), 0)
      out.push('73', String(lt.pattern.length), '40', formatDxfNumber(total))
      for (const d of lt.pattern) {
        out.push('49', formatDxfNumber(d))
      }
    }
  }
  out.push('0', 'ENDTAB')
  return out
}

/** Emit the LAYER table with the fixed drawing-DXF layer set. */
function emitLayerTable(): string[] {
  const out: string[] = ['0', 'TABLE', '2', 'LAYER', '70', String(DXF_LAYER_DEFS.length)]
  for (const layer of DXF_LAYER_DEFS) {
    out.push(
      '0',
      'LAYER',
      '2',
      layer.name,
      '70',
      '0',
      '62',
      String(layer.color),
      '6',
      layer.linetype
    )
  }
  out.push('0', 'ENDTAB')
  return out
}

// ---------------------------------------------------------------------------
// Document assembler
// ---------------------------------------------------------------------------

/** Options for {@link assembleDxfDocument}. */
export interface DxfDocumentOptions {
  /** The drawing extents (group $EXTMIN / $EXTMAX in the header). Optional. */
  readonly extents?: { readonly min: DxfPoint; readonly max: DxfPoint }
}

/**
 * Assemble a complete R12 ASCII DXF from an ordered entity list. Emits, in
 * order: HEADER (with `$ACADVER = AC1009`, `$INSUNITS = 4` millimetres, and
 * optional `$EXTMIN`/`$EXTMAX`), TABLES (LTYPE then LAYER), an empty BLOCKS
 * section, ENTITIES (the caller's list, in order), and a single EOF.
 *
 * Empty sections are still emitted with their SECTION/ENDSEC wrapper (a valid
 * R12 file always has HEADER + TABLES + ENTITIES); an EMPTY entity list yields
 * a well-formed drawing with zero entities (not a truncated file). The line
 * separator is CRLF (`\r\n`) to match the existing DXF templates and the DXF
 * spec's canonical form.
 *
 * Pure: same entities + options → byte-identical output.
 */
export function assembleDxfDocument(
  entities: readonly DxfEntity[],
  options?: DxfDocumentOptions
): string {
  const lines: string[] = []
  const push = (...xs: string[]): void => {
    for (const x of xs) lines.push(x)
  }

  // ---- HEADER ----
  push('0', 'SECTION', '2', 'HEADER')
  push('9', '$ACADVER', '1', 'AC1009')
  push('9', '$INSUNITS', '70', '4') // 4 = millimetres
  push('9', '$MEASUREMENT', '70', '1') // 1 = metric
  if (options?.extents) {
    push(
      '9',
      '$EXTMIN',
      '10',
      formatDxfNumber(options.extents.min.x),
      '20',
      formatDxfNumber(options.extents.min.y),
      '30',
      '0'
    )
    push(
      '9',
      '$EXTMAX',
      '10',
      formatDxfNumber(options.extents.max.x),
      '20',
      formatDxfNumber(options.extents.max.y),
      '30',
      '0'
    )
  }
  push('0', 'ENDSEC')

  // ---- TABLES (LTYPE, then LAYER — LTYPE must precede LAYER since layers reference it) ----
  push('0', 'SECTION', '2', 'TABLES')
  push(...emitLinetypeTable())
  push(...emitLayerTable())
  push('0', 'ENDSEC')

  // ---- BLOCKS (empty but present) ----
  push('0', 'SECTION', '2', 'BLOCKS')
  push('0', 'ENDSEC')

  // ---- ENTITIES ----
  push('0', 'SECTION', '2', 'ENTITIES')
  for (const entity of entities) {
    push(...emitEntity(entity))
  }
  push('0', 'ENDSEC')

  // ---- EOF ----
  push('0', 'EOF')

  return lines.join('\r\n')
}

// ---------------------------------------------------------------------------
// Extents helper
// ---------------------------------------------------------------------------

/**
 * Compute the bounding box of every point across an entity list, for the
 * header `$EXTMIN`/`$EXTMAX`. Returns `null` when there are no points (an empty
 * drawing has no extents). Pure.
 */
export function computeEntitiesExtents(
  entities: readonly DxfEntity[]
): { min: DxfPoint; max: DxfPoint } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const consider = (p: DxfPoint): void => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  for (const e of entities) {
    switch (e.type) {
      case 'line':
        consider(e.start)
        consider(e.end)
        break
      case 'polyline':
        for (const p of e.points) consider(p)
        break
      case 'text':
        consider(e.at)
        break
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}
