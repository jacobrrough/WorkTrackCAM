import { z } from 'zod'

/**
 * Persistence schema for 2D drawing annotations — dimensions, GD&T feature
 * control frames, notes, revisions, and a bill-of-materials table.
 *
 * ## Why this file exists
 *
 * Until now a placed dimension lived only in `DrawingView.tsx` React state
 * (`DrawingDimensionSpec`, never serialized) and the persisted sheet shape
 * (`drawingSheetSchema`) carried views + title-block strings ONLY. There was
 * no on-disk home for annotations, and a saved `{ x, y }` pair was inert
 * geometry — meaningless after the part regenerates.
 *
 * This schema fixes both:
 *
 *  1. **Persistence** — every annotation kind has a Zod shape so it can be
 *     written into `drawing.json` (via the additive `annotations` field on
 *     `drawingSheetSchema`) and read back unchanged.
 *  2. **Associativity** — each dimension endpoint carries a
 *     {@link drawingDimensionAnchorSchema} = `{ refId, cachedPoint }`. The
 *     `refId` is the stable id returned by the (forthcoming)
 *     `cad.extract_drawing_snap_points` sidecar method; `cachedPoint` is the
 *     last-known projected `{ x, y }` (SVG-mm space, matching CadQuery's
 *     `getSVG(width=800, height=600)` frame). On rebuild the consumer
 *     re-resolves `refId` to a fresh coordinate and refreshes `cachedPoint`;
 *     if the feature vanished, `cachedPoint` is the graceful fallback the
 *     renderer can still draw (flagged stale).
 *
 * ## Safety Rule 2 — additive only
 *
 * Nothing here bumps a schema version. The `drawingSheetSchema.annotations`
 * field is `.optional().default(...)` (mirroring `project-schema.ts`
 * `designModels`), so every existing `drawing.json` parses unchanged and gains
 * an empty annotations container in memory. No migration entry is needed.
 *
 * ## Safety Rule 1 — no G-code, no STL
 *
 * Annotations are documentation overlays. Nothing in this schema is ever read
 * by the CAM toolpath or post-processor pipeline. This file touches NO machine
 * profile, post template, or G-code emitter.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * A 2D point in SVG-mm sheet space (the same coordinate frame CadQuery's
 * `getSVG(width=800, height=600)` emits, which the drawing renderer and the
 * snap machinery in `drawing-snap.ts` both operate in). Both axes are finite
 * — `NaN`/`Infinity` would corrupt SVG layout math.
 */
export const drawingPoint2DSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
})

export type DrawingPoint2D = z.infer<typeof drawingPoint2DSchema>

/**
 * An associative anchor binding one dimension endpoint to a model feature.
 *
 *  * `refId` — opaque, stable id of the projected snap point / edge / vertex
 *    the operator snapped to (the `sourceId` from `drawing-snap.ts`
 *    `SnapPoint`). Survives a rebuild so the dimension can re-resolve.
 *  * `cachedPoint` — the resolved `{ x, y }` at the moment the dimension was
 *    placed (or last refreshed). Used to draw the dimension before a fresh
 *    projection arrives, and as the fallback when `refId` no longer resolves
 *    (orphaned anchor → render stale rather than drop the annotation).
 *
 * Storing BOTH is what makes the dimension simultaneously persistable and
 * associative: `cachedPoint` is the durable fallback, `refId` is the live link.
 */
export const drawingDimensionAnchorSchema = z.object({
  refId: z.string(),
  cachedPoint: drawingPoint2DSchema
})

export type DrawingDimensionAnchor = z.infer<typeof drawingDimensionAnchorSchema>

/**
 * Orientation for a `linear` dimension. `horizontal` / `vertical` lock the
 * dimension line to the X / Y axis; `aligned` runs it parallel to the line
 * between the two anchors (true-length measurement). Mirrors the standard
 * drafting linear-dimension flavours (Fusion/SolidWorks "Horizontal /
 * Vertical / Aligned").
 */
export const drawingLinearOrientationSchema = z.enum(['horizontal', 'vertical', 'aligned'])

export type DrawingLinearOrientation = z.infer<typeof drawingLinearOrientationSchema>

// ---------------------------------------------------------------------------
// Dimension discriminated union
// ---------------------------------------------------------------------------

/**
 * Optional override label, e.g. a tolerance call-out like "30 ±0.05" that
 * replaces the auto-computed measurement text. Trimmed to a sane drafting
 * length so a runaway string can't blow out the SVG.
 */
const dimensionLabelSchema = z.string().max(120).optional()

/**
 * Discriminated union of every persistable dimension kind. The discriminant is
 * `kind`. Each variant carries:
 *
 *  * its feature anchors ({@link drawingDimensionAnchorSchema} per endpoint —
 *    this is what makes it associative),
 *  * a numeric `value` (the resolved measurement at placement time — mm for
 *    linear/radial/diameter/ordinate, degrees for angular), persisted so a
 *    reopened sheet shows the number without a sidecar round-trip, and
 *  * a `placement` point ({@link drawingPoint2DSchema}) — where the dimension
 *    text / dimension line sits in sheet space.
 *
 * Kinds:
 *  * `linear`   — distance between two anchors, with `orientation`.
 *  * `radial`   — radius of an arc (`center` + a point `on` the arc).
 *  * `diameter` — diameter of a circle (`center` + a point `on` the circle).
 *  * `angular`  — angle at `vertex` between two arms (`arm1`, `arm2`).
 *  * `ordinate` — single coordinate read-out from an `origin` datum to a
 *    `feature` anchor along one `axis`.
 *  * `baseline` — a member of a baseline (datum) dimension set: every member
 *    shares the same `origin` datum; `setId` groups members of one set.
 *  * `chain`    — a member of a continuous (chained) dimension run between two
 *    adjacent anchors; `setId` groups the run.
 */
export const drawingDimensionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('linear'),
    id: z.string(),
    orientation: drawingLinearOrientationSchema,
    start: drawingDimensionAnchorSchema,
    end: drawingDimensionAnchorSchema,
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  }),
  z.object({
    kind: z.literal('radial'),
    id: z.string(),
    center: drawingDimensionAnchorSchema,
    on: drawingDimensionAnchorSchema,
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  }),
  z.object({
    kind: z.literal('diameter'),
    id: z.string(),
    center: drawingDimensionAnchorSchema,
    on: drawingDimensionAnchorSchema,
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  }),
  z.object({
    kind: z.literal('angular'),
    id: z.string(),
    vertex: drawingDimensionAnchorSchema,
    arm1: drawingDimensionAnchorSchema,
    arm2: drawingDimensionAnchorSchema,
    /** Measured angle in degrees at placement time. */
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  }),
  z.object({
    kind: z.literal('ordinate'),
    id: z.string(),
    /** Datum the read-out is measured from (the "0" of the ordinate set). */
    origin: drawingDimensionAnchorSchema,
    feature: drawingDimensionAnchorSchema,
    /** Which axis the coordinate is read along. */
    axis: z.enum(['x', 'y']),
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  }),
  z.object({
    kind: z.literal('baseline'),
    id: z.string(),
    /** Shared datum for every member of the baseline set. */
    origin: drawingDimensionAnchorSchema,
    feature: drawingDimensionAnchorSchema,
    /** Groups members of one baseline (datum) dimension set. */
    setId: z.string(),
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  }),
  z.object({
    kind: z.literal('chain'),
    id: z.string(),
    start: drawingDimensionAnchorSchema,
    end: drawingDimensionAnchorSchema,
    /** Groups members of one continuous (chained) dimension run. */
    setId: z.string(),
    value: z.number().finite(),
    placement: drawingPoint2DSchema,
    label: dimensionLabelSchema
  })
])

export type DrawingDimension = z.infer<typeof drawingDimensionSchema>
export type DrawingDimensionKind = DrawingDimension['kind']

// ---------------------------------------------------------------------------
// GD&T feature control frame
// ---------------------------------------------------------------------------

/**
 * Geometric characteristic symbols (ASME Y14.5 / ISO 1101) addressable in a
 * feature control frame. Stored as stable string ids; the renderer maps each
 * to its drafting glyph.
 */
export const gdtCharacteristicSchema = z.enum([
  'straightness',
  'flatness',
  'circularity',
  'cylindricity',
  'profile_of_a_line',
  'profile_of_a_surface',
  'perpendicularity',
  'angularity',
  'parallelism',
  'position',
  'concentricity',
  'symmetry',
  'circular_runout',
  'total_runout'
])

export type GdtCharacteristic = z.infer<typeof gdtCharacteristicSchema>

/**
 * A single GD&T feature control frame: characteristic + tolerance zone +
 * up to three datum references (primary / secondary / tertiary), anchored to a
 * model feature so it stays attached on rebuild. `toleranceMm` is the zone
 * size in mm. `datums` is capped at 3 (a feature control frame references at
 * most primary/secondary/tertiary datums).
 */
export const gdtFeatureControlFrameSchema = z.object({
  id: z.string(),
  characteristic: gdtCharacteristicSchema,
  /** Tolerance-zone size in mm. */
  toleranceMm: z.number().finite().nonnegative(),
  /** Ordered datum reference letters, primary first. At most 3. */
  datums: z.array(z.string().min(1)).max(3).default([]),
  /** Feature this frame is attached to (associative). */
  anchor: drawingDimensionAnchorSchema,
  /** Where the frame box sits in sheet space. */
  placement: drawingPoint2DSchema
})

export type GdtFeatureControlFrame = z.infer<typeof gdtFeatureControlFrameSchema>

// ---------------------------------------------------------------------------
// Surface-finish symbol (ISO 1302 / ASME Y14.36 surface texture)
// ---------------------------------------------------------------------------

/**
 * Material-removal disposition of a surface-texture symbol (ISO 1302 / ASME
 * Y14.36). Determines the BASIC glyph variant the renderer draws:
 *
 *  * `any`        — the bare check-mark (√): surface may be produced by ANY
 *    process; no statement about material removal.
 *  * `required`   — the check-mark with a horizontal bar across the top of the
 *    long leg: material removal (machining) IS required.
 *  * `prohibited` — the check-mark with a small circle in the vee: material
 *    removal is PROHIBITED (surface left as-cast / as-forged).
 *
 * Stored as a stable string id; the renderer maps each to its drafting glyph.
 */
export const surfaceFinishMaterialSchema = z.enum(['any', 'required', 'prohibited'])

export type SurfaceFinishMaterial = z.infer<typeof surfaceFinishMaterialSchema>

/**
 * Lay direction symbol (the texture's dominant pattern relative to the surface),
 * placed to the right of the long leg of the symbol (ISO 1302 §"lay"). Optional;
 * `undefined` means no lay is specified. The renderer maps each id to its glyph
 * character:
 *
 *  * `parallel` (`=`)        — lay parallel to the plane of projection.
 *  * `perpendicular` (`⊥`)   — lay perpendicular to the plane of projection.
 *  * `crossed` (`X`)         — lay angular in both directions (crossed).
 *  * `multidirectional` (`M`)— lay multidirectional.
 *  * `circular` (`C`)        — approximately circular relative to the centre.
 *  * `radial` (`R`)          — approximately radial relative to the centre.
 *  * `particulate` (`P`)     — particulate, non-directional / protuberant.
 */
export const surfaceFinishLaySchema = z.enum([
  'parallel',
  'perpendicular',
  'crossed',
  'multidirectional',
  'circular',
  'radial',
  'particulate'
])

export type SurfaceFinishLay = z.infer<typeof surfaceFinishLaySchema>

/**
 * A single surface-finish (surface-texture) symbol, anchored to a model feature
 * so it stays attached on rebuild — the exact persistence + associativity
 * pattern as {@link gdtFeatureControlFrameSchema}.
 *
 *  * `material` — the basic glyph variant (any / required / prohibited).
 *  * `ra`       — primary roughness value (Ra) in micrometres (µm). Optional:
 *    a bare symbol with no Ra is valid (states only the removal disposition).
 *    Finite + non-negative when present.
 *  * `machiningAllowanceMm` — optional machining-allowance value (mm) drawn to
 *    the left of the long leg (ISO 1302). Finite + non-negative when present.
 *  * `lay`      — optional lay-direction symbol drawn to the right of the leg.
 *  * `anchor`   — the feature this symbol is attached to (associative).
 *  * `placement`— where the symbol sits in sheet space.
 *
 * Additive + frozen: a v1 symbol carries Ra + a removal flag (+ optional
 * allowance / lay). Like GD&T datums, NO free-text reaches markup here — every
 * field is a number or a closed enum, so there is no Safety-Rule-4 escaping
 * surface on this annotation.
 */
export const surfaceFinishSymbolSchema = z.object({
  id: z.string(),
  material: surfaceFinishMaterialSchema,
  /** Primary roughness value Ra in micrometres (µm). */
  ra: z.number().finite().nonnegative().optional(),
  /** Machining-allowance value in mm (drawn to the left of the long leg). */
  machiningAllowanceMm: z.number().finite().nonnegative().optional(),
  /** Lay-direction symbol drawn to the right of the long leg. */
  lay: surfaceFinishLaySchema.optional(),
  /** Feature this symbol is attached to (associative). */
  anchor: drawingDimensionAnchorSchema,
  /** Where the symbol sits in sheet space. */
  placement: drawingPoint2DSchema
})

export type SurfaceFinishSymbol = z.infer<typeof surfaceFinishSymbolSchema>

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * A free-text annotation (general note, flag note, leader note). Optional
 * `leader` anchors a leader line to a model feature; absent means a free-
 * floating note block.
 */
export const drawingNoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Where the note text block sits in sheet space. */
  placement: drawingPoint2DSchema,
  /** Optional leader-line attachment to a model feature (associative). */
  leader: drawingDimensionAnchorSchema.optional()
})

export type DrawingNote = z.infer<typeof drawingNoteSchema>

// ---------------------------------------------------------------------------
// Revision history
// ---------------------------------------------------------------------------

/**
 * One revision-block row. `rev` is the revision letter/number ("A", "B", "01"),
 * `date` a free-form date string (renderer picks the format), `desc` the change
 * description, and `author` the drafter who made the change.
 */
export const drawingRevisionSchema = z.object({
  rev: z.string().min(1),
  date: z.string(),
  desc: z.string(),
  author: z.string()
})

export type DrawingRevision = z.infer<typeof drawingRevisionSchema>

// ---------------------------------------------------------------------------
// Bill of materials
// ---------------------------------------------------------------------------

/**
 * One bill-of-materials row. `item` is the balloon / find-number, `qty` the
 * quantity (non-negative integer), `partNumber` the part identifier, and
 * `description` the human-readable part name.
 */
export const drawingBomRowSchema = z.object({
  item: z.number().int().nonnegative(),
  qty: z.number().int().nonnegative(),
  partNumber: z.string(),
  description: z.string()
})

export type DrawingBomRow = z.infer<typeof drawingBomRowSchema>

// ---------------------------------------------------------------------------
// Sheet annotations container
// ---------------------------------------------------------------------------

/**
 * The full annotation payload for one drawing sheet. Every array defaults to
 * empty so a sheet that has been annotated in only one dimension (say, just
 * notes) still produces a fully-shaped object, and so the container itself can
 * be attached to `drawingSheetSchema` with `.optional().default(...)` without
 * any field becoming required.
 *
 * `bom` is included alongside the four task-named arrays so a sheet can carry a
 * parts list; it defaults to empty and is harmless when unused.
 *
 * `surfaceFinishes` is the ISO 1302 / ASME Y14.36 surface-texture symbol layer,
 * added alongside `featureControlFrames` with the same `.default([])` so an
 * existing `drawing.json` (saved before surface-finish symbols existed) parses
 * unchanged and gains an empty surface-finish array in memory (Safety Rule 2 —
 * additive, no version bump, no migration).
 */
export const drawingSheetAnnotationsSchema = z.object({
  dimensions: z.array(drawingDimensionSchema).default([]),
  featureControlFrames: z.array(gdtFeatureControlFrameSchema).default([]),
  surfaceFinishes: z.array(surfaceFinishSymbolSchema).default([]),
  notes: z.array(drawingNoteSchema).default([]),
  revisions: z.array(drawingRevisionSchema).default([]),
  bom: z.array(drawingBomRowSchema).default([])
})

export type DrawingSheetAnnotations = z.infer<typeof drawingSheetAnnotationsSchema>

/**
 * A fully-defaulted empty annotations container. Handy for seeding new sheets
 * and for the `.optional().default(...)` attach point on `drawingSheetSchema`.
 */
export function emptyDrawingSheetAnnotations(): DrawingSheetAnnotations {
  return drawingSheetAnnotationsSchema.parse({})
}
