import { z } from 'zod'

// ── Reusable refinements ─────────────────────────────────────────────────────

/** Positive finite number (> 0, finite). Returns `undefined` for invalid. */
const positiveFinite = z.number().positive().finite()

/** Non-negative finite number (>= 0, finite). Returns `undefined` for invalid. */
const nonNegativeFinite = z.number().nonnegative().finite()

/** Finite number (any sign, finite). */
const finiteNum = z.number().finite()

// ── 4-axis operation param schemas ───────────────────────────────────────────

/**
 * Raw 4-axis operation params extracted from `Record<string, unknown>`.
 *
 * All fields are optional — callers apply defaults after parsing.
 * Uses `.safeParse()` so invalid values become `undefined` rather than throwing.
 */
export const axis4RawParamsSchema = z.object({
  // Cylinder geometry
  cylinderDiameterMm: positiveFinite.optional(),
  cylinderLengthMm: positiveFinite.optional(),

  // Angular / surface stepover
  stepoverDeg: positiveFinite.optional(),
  surfaceStepoverMm: positiveFinite.optional(),

  // Radial Z step
  zStepMm: positiveFinite.optional(),

  // Chuck / clamp
  chuckDepthMm: nonNegativeFinite.optional(),
  clampOffsetMm: nonNegativeFinite.optional(),

  // Wrap axis orientation
  wrapAxis: z.string().optional(),

  // Axial band count (integer >= 1, clamped to [1, 24])
  axialBandCount: positiveFinite.optional(),

  // Cylindrical raster max cells (>= 100, clamped to 200_000)
  cylindricalRasterMaxCells: z.number().finite().min(100).optional(),

  // Finish allowance (finite, clamped >= 0)
  rotaryFinishAllowanceMm: finiteNum.optional(),

  // Overcut (>= 0)
  overcutMm: nonNegativeFinite.optional(),

  // Finish stepover (degrees, > 0)
  finishStepoverDeg: positiveFinite.optional(),

  // Boolean flags
  useMeshMachinableXClamp: z.boolean().optional(),
  useMeshRadialZBands: z.boolean().optional(),
  adaptiveRefinement: z.boolean().optional(),

  // Contour-specific: array of [x, y] points
  contourPoints: z
    .array(z.tuple([finiteNum, finiteNum]))
    .optional(),

  // Indexed-specific: array of angle degrees
  indexAnglesDeg: z
    .array(finiteNum)
    .optional(),
})

export type Axis4RawParams = z.infer<typeof axis4RawParamsSchema>

// ── Parsed result type ───────────────────────────────────────────────────────

/**
 * Typed result from parsing 4-axis operation params.
 * Invalid fields are `undefined`; callers apply operation-specific defaults.
 */
export type Axis4ParsedParams = {
  cylinderDiameterMm: number | undefined
  cylinderLengthMm: number | undefined
  stepoverDeg: number | undefined
  surfaceStepoverMm: number | undefined
  zStepMm: number | undefined
  chuckDepthMm: number | undefined
  clampOffsetMm: number | undefined
  wrapAxis: string | undefined
  axialBandCount: number | undefined
  cylindricalRasterMaxCells: number | undefined
  rotaryFinishAllowanceMm: number | undefined
  overcutMm: number | undefined
  finishStepoverDeg: number | undefined
  useMeshMachinableXClamp: boolean | undefined
  useMeshRadialZBands: boolean | undefined
  adaptiveRefinement: boolean | undefined
  contourPoints: [number, number][] | undefined
  indexAnglesDeg: number[] | undefined
}

// ── Parse function ───────────────────────────────────────────────────────────

/**
 * Safely extract typed 4-axis operation params from an untyped record.
 *
 * Uses per-field `.safeParse()` so that one invalid field does not
 * invalidate other fields. Invalid values silently become `undefined`.
 *
 * This is intentionally field-by-field rather than a single `.safeParse()`
 * on the whole object, because the original code treats each param
 * independently — a bad `overcutMm` should not discard a valid
 * `cylinderDiameterMm`.
 */
export function parse4AxisParams(raw: Record<string, unknown>): Axis4ParsedParams {
  return {
    cylinderDiameterMm: safeParseField(positiveFinite, raw['cylinderDiameterMm']),
    cylinderLengthMm: safeParseField(positiveFinite, raw['cylinderLengthMm']),
    stepoverDeg: safeParseField(positiveFinite, raw['stepoverDeg']),
    surfaceStepoverMm: safeParseField(positiveFinite, raw['surfaceStepoverMm']),
    zStepMm: safeParseField(positiveFinite, raw['zStepMm']),
    chuckDepthMm: safeParseField(nonNegativeFinite, raw['chuckDepthMm']),
    clampOffsetMm: safeParseField(nonNegativeFinite, raw['clampOffsetMm']),
    wrapAxis: safeParseField(z.string(), raw['wrapAxis']),
    axialBandCount: safeParseField(positiveFinite, raw['axialBandCount']),
    cylindricalRasterMaxCells: safeParseField(z.number().finite().min(100), raw['cylindricalRasterMaxCells']),
    rotaryFinishAllowanceMm: safeParseField(finiteNum, raw['rotaryFinishAllowanceMm']),
    overcutMm: safeParseField(nonNegativeFinite, raw['overcutMm']),
    finishStepoverDeg: safeParseField(positiveFinite, raw['finishStepoverDeg']),
    useMeshMachinableXClamp: safeParseField(z.boolean(), raw['useMeshMachinableXClamp']),
    useMeshRadialZBands: safeParseField(z.boolean(), raw['useMeshRadialZBands']),
    adaptiveRefinement: safeParseField(z.boolean(), raw['adaptiveRefinement']),
    contourPoints: safeParseContourPoints(raw['contourPoints']),
    indexAnglesDeg: safeParseIndexAngles(raw['indexAnglesDeg']),
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function safeParseField<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined
  const result = schema.safeParse(value)
  return result.success ? result.data : undefined
}

/**
 * Parse contourPoints: each element must be a 2-element array of finite numbers.
 * Mirrors the original `point2dList()` behavior — skips invalid entries rather
 * than rejecting the whole array.
 */
function safeParseContourPoints(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value)) return undefined
  const pointSchema = z.tuple([finiteNum, finiteNum])
  const out: [number, number][] = []
  for (const item of value) {
    const r = pointSchema.safeParse(item)
    if (r.success) out.push(r.data)
  }
  return out.length > 0 ? out : undefined
}

/**
 * Parse indexAnglesDeg: array of finite numbers.
 * Mirrors the original filter behavior — skips non-finite entries.
 */
function safeParseIndexAngles(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: number[] = []
  for (const item of value) {
    const r = finiteNum.safeParse(item)
    if (r.success) out.push(r.data)
  }
  return out.length > 0 ? out : undefined
}
