/**
 * fdm-gcode-layer-breakdown.ts — session-only types + Zod schemas for the
 * TRUE per-layer slicer breakdown surfaced in the K2 Plus FDM Preview stage.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `src/renderer/manufacture/gcode-layer-parser.ts` spreads the slicer's
 * *total* time + filament UNIFORMLY across every layer — a coarse estimate
 * (CAD V1.5 plan: docs/plans/cad-v15-per-layer-slicer-breakdowns.md). This
 * module is the contract for the richer result produced by the streaming
 * main-process parser `src/main/slicer/fdm-gcode-stream-parser.ts`, which
 * reports REAL per-layer values when the sliced G-code carries per-layer
 * comments (`;LAYER_TIME:`, `;LAYER_FILAMENT:`, `;TYPE:`) and falls back to
 * the uniform distribution otherwise (never worse than today).
 *
 * ── Persistence ──────────────────────────────────────────────────────────
 *
 * SESSION-ONLY. The per-layer breakdown is ephemeral preview data derived
 * from the most-recent slice. It is NEVER written to disk and is NOT part of
 * the persisted project file — there is intentionally no migration. A fresh
 * slice always re-derives it.
 *
 * ── Purity ───────────────────────────────────────────────────────────────
 *
 * Pure types + schemas only. No `fs`, no `electron`, no `react` imports.
 */
import { z } from 'zod'

/**
 * Extrusion line-type as emitted by OrcaSlicer / PrusaSlicer `;TYPE:<type>`
 * comments. The slicer uses a small, stable vocabulary of feature kinds; we
 * map each recognised `;TYPE:` body to one of these members and bucket the
 * rest under `'Other'` so an unfamiliar slicer build still produces a usable
 * (if coarse) breakdown rather than dropping data.
 *
 * Members mirror the OrcaSlicer feature names verbatim (see the
 * `;TYPE:Outer wall` etc. lines in K2 Plus output) so the renderer can echo
 * them without a second translation table.
 */
export type FdmLineType =
  | 'Outer wall'
  | 'Inner wall'
  | 'Sparse infill'
  | 'Internal solid infill'
  | 'Top surface'
  | 'Bottom surface'
  | 'Bridge'
  | 'Support'
  | 'Support interface'
  | 'Skirt'
  | 'Brim'
  | 'Custom'
  | 'Other'

/**
 * Closed enum of every {@link FdmLineType} member. Exported so the parser and
 * its tests can reference the canonical vocabulary without re-declaring it.
 */
export const FDM_LINE_TYPES: readonly FdmLineType[] = [
  'Outer wall',
  'Inner wall',
  'Sparse infill',
  'Internal solid infill',
  'Top surface',
  'Bottom surface',
  'Bridge',
  'Support',
  'Support interface',
  'Skirt',
  'Brim',
  'Custom',
  'Other'
] as const

/** Zod schema for a single {@link FdmLineType}. */
export const fdmLineTypeSchema: z.ZodType<FdmLineType> = z.enum([
  'Outer wall',
  'Inner wall',
  'Sparse infill',
  'Internal solid infill',
  'Top surface',
  'Bottom surface',
  'Bridge',
  'Support',
  'Support interface',
  'Skirt',
  'Brim',
  'Custom',
  'Other'
])

/**
 * Per-layer line-type extrusion-move counts. A `Partial<Record<...>>`: only
 * the line types that actually appeared on the layer are present. `null` when
 * the slice carried no `;TYPE:` annotations at all (the default — the K2
 * process profiles ship with `gcode_label_objects: "0"`).
 */
export type FdmLineTypeCounts = Partial<Record<FdmLineType, number>>

/** Zod schema for {@link FdmLineTypeCounts}. */
export const fdmLineTypeCountsSchema: z.ZodType<FdmLineTypeCounts> = z.record(
  fdmLineTypeSchema,
  z.number().int().nonnegative()
)

/**
 * One parsed layer of the slice.
 *
 * `index` is the 1-based layer ordinal in the order the parser opened the
 * layer (after the preceding `;BEFORE_LAYER_CHANGE`). `zMm` is the layer Z
 * height in millimetres. The three `…|null` fields are real per-layer values
 * when the slicer emitted per-layer comments, the uniform-distribution
 * fallback when it only emitted header totals, or `null` when neither source
 * is available.
 */
export interface FdmLayerBreakdown {
  /** 1-based layer ordinal in emission order. */
  readonly index: number
  /** Layer Z height in millimetres. */
  readonly zMm: number
  /** Estimated layer time (seconds). Null when unknown. */
  readonly estTimeSec: number | null
  /** Estimated layer filament length (mm). Null when unknown. */
  readonly estFilamentMm: number | null
  /**
   * Per-line-type extrusion-move counts for this layer, or null when the
   * slice carried no `;TYPE:` annotations.
   */
  readonly lineTypeCounts: FdmLineTypeCounts | null
  /**
   * Peak commanded feed-rate on this layer (mm/min), or null when no feed
   * was observed. Parsed from `F<value>` words on the layer's motion lines.
   */
  readonly maxSpeedMmMin: number | null
}

/** Zod schema for {@link FdmLayerBreakdown}. */
export const fdmLayerBreakdownSchema: z.ZodType<FdmLayerBreakdown> = z.object({
  index: z.number().int().positive(),
  zMm: z.number().nonnegative(),
  estTimeSec: z.number().nonnegative().nullable(),
  estFilamentMm: z.number().nonnegative().nullable(),
  lineTypeCounts: fdmLineTypeCountsSchema.nullable(),
  maxSpeedMmMin: z.number().nonnegative().nullable()
})

/**
 * Full per-layer breakdown result returned over the `slice:layerBreakdown`
 * IPC channel. `layers` is ordered by emission (bottom-up for a normal FDM
 * print). The three aggregate fields echo the slicer header totals (or are
 * derived/null) so the UI can show a job-level summary alongside the table.
 */
export interface FdmLayerBreakdownResult {
  /** Ordered per-layer breakdown (one entry per opened layer). */
  readonly layers: readonly FdmLayerBreakdown[]
  /** Total job time in seconds from the slicer header, or null. */
  readonly totalTimeSec: number | null
  /** Total filament length in mm from the slicer header, or null. */
  readonly totalFilamentMm: number | null
  /** Number of layers parsed (mirrors `layers.length`). */
  readonly layerCount: number
}

/** Zod schema for {@link FdmLayerBreakdownResult}. */
export const fdmLayerBreakdownResultSchema: z.ZodType<FdmLayerBreakdownResult> = z.object({
  layers: z.array(fdmLayerBreakdownSchema),
  totalTimeSec: z.number().nonnegative().nullable(),
  totalFilamentMm: z.number().nonnegative().nullable(),
  layerCount: z.number().int().nonnegative()
})

/**
 * Empty result — zero layers, null totals. Returned by the parser for an
 * empty / marker-less file so callers always get a well-formed shape.
 */
export const EMPTY_FDM_LAYER_BREAKDOWN_RESULT: FdmLayerBreakdownResult = {
  layers: [],
  totalTimeSec: null,
  totalFilamentMm: null,
  layerCount: 0
}
