import { z } from 'zod'
import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from './cam-numeric-floors'

/**
 * CNC cut parameters for a given material.
 * Feed/speed auto-calculation formula:
 *   RPM = (surfaceSpeedMMin * 1000) / (π × toolDiamMm)
 *   FeedMmMin = RPM × fluteCount × chiploadMm
 *   PlungeMmMin = FeedMmMin × plungeFactor
 *   StepoverMm = toolDiamMm × stepoverFactor
 *   ZPassMm = -(toolDiamMm × docFactor)
 */
export const materialCutParamsSchema = z.object({
  /** Recommended surface speed in m/min for carbide tooling */
  surfaceSpeedMMin: z.number().positive(),
  /** Chipload per tooth in mm */
  chiploadMm: z.number().positive(),
  /** Depth-of-cut as fraction of tool diameter (e.g. 0.5 = half-diameter DOC) */
  docFactor: z.number().positive(),
  /** Stepover as fraction of tool diameter (e.g. 0.45 = 45% WOC) */
  stepoverFactor: z.number().positive(),
  /** Plunge feed as fraction of horizontal feed (e.g. 0.3 = 30%) */
  plungeFactor: z.number().positive().default(0.3),
  /** Optional spindle RPM override (ignores surfaceSpeedMMin) */
  rpmOverride: z.number().positive().optional(),
  /** Optional hard feed override in mm/min (ignores all calculated values) */
  feedOverrideMmMin: z.number().positive().optional()
})

export type MaterialCutParams = z.infer<typeof materialCutParamsSchema>

export const materialCategoryEnum = z.enum([
  'softwood',
  'hardwood',
  'mdf',
  'plywood',
  'aluminum_6061',
  'aluminum_cast',
  'steel_mild',
  'steel_tool',
  'stainless',
  'brass',
  'copper',
  'acrylic',
  'hdpe',
  'pvc',
  'delrin',
  'foam',
  'carbon_fiber',
  'other'
])
export type MaterialCategory = z.infer<typeof materialCategoryEnum>

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  softwood:      'Softwood (Pine, Cedar)',
  hardwood:      'Hardwood (Oak, Maple)',
  mdf:           'MDF',
  plywood:       'Plywood',
  aluminum_6061: 'Aluminum 6061',
  aluminum_cast: 'Aluminum (Cast)',
  steel_mild:    'Steel (Mild / A36)',
  steel_tool:    'Steel (Tool / O1)',
  stainless:     'Stainless Steel',
  brass:         'Brass',
  copper:        'Copper',
  acrylic:       'Acrylic (PMMA)',
  hdpe:          'HDPE',
  pvc:           'PVC',
  delrin:        'Delrin (POM / Acetal)',
  foam:          'Foam / Tooling Board',
  carbon_fiber:  'Carbon Fiber',
  other:         'Other'
}

export const materialRecordSchema = z.object({
  id: z.string().trim().min(1).describe('Unique material record identifier'),
  name: z.string().trim().min(1).describe('Human-readable material name'),
  category: materialCategoryEnum.describe('Material category for cut param lookup'),
  notes: z.string().optional().describe('Free-text notes about the material'),
  source: z.enum(['bundled', 'user']).optional().describe('Material origin: bundled with app or user-created'),
  /** Cut params keyed by a rough tool-type label: 'endmill', 'ball', 'vbit', 'drill', 'default' */
  cutParams: z.record(z.string(), materialCutParamsSchema)
}).superRefine((data, ctx) => {
  // calcCutParams falls back to cutParams['default'] when the specific tool type is not found.
  // An entirely empty cutParams object is always a bug — it silently returns hardcoded fallback
  // values (18000 RPM, 1000 mm/min) with no error. Catch this at parse time.
  if (Object.keys(data.cutParams).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cutParams'],
      message:
        'cutParams must have at least one entry. Add a "default" key as a universal fallback (e.g. { default: { surfaceSpeedMMin, chiploadMm, docFactor, stepoverFactor } }).'
    })
  }
})

export type MaterialRecord = z.infer<typeof materialRecordSchema>

export const materialLibrarySchema = z.object({
  version: z.literal(1).describe('Material library schema version'),
  materials: z.array(materialRecordSchema).describe('List of material records with cut parameters')
})

export type MaterialLibrary = z.infer<typeof materialLibrarySchema>

/**
 * Calculate CNC cut parameters for a given material + tool combination.
 * Returns absolute mm/min values ready to plug into operation params.
 */
export function calcCutParams(
  mat: MaterialRecord,
  toolDiamMm: number,
  fluteCount: number = 2,
  toolType: string = 'default'
): {
  feedMmMin: number
  plungeMmMin: number
  stepoverMm: number
  zPassMm: number
  rpm: number
  /** Chipload formula before {@link CAM_FEED_PLUNGE_FLOOR_MM_MIN} clamp (mm/min). */
  recommendedFeedMmMin: number
  /** True when feed was raised to the shared CAM floor. */
  feedClampedToFloor: boolean
} {
  const cp = mat.cutParams[toolType] ?? mat.cutParams['default']
  if (!cp) {
    // bare fallback — shouldn't happen with good data
    return {
      feedMmMin: 1000,
      plungeMmMin: 300,
      stepoverMm: toolDiamMm * 0.4,
      zPassMm: -(toolDiamMm * 0.5),
      rpm: 18000,
      recommendedFeedMmMin: 1000,
      feedClampedToFloor: false
    }
  }

  const rpm = cp.rpmOverride ?? Math.round((cp.surfaceSpeedMMin * 1000) / (Math.PI * toolDiamMm))
  const recommendedFeedMmMin = cp.feedOverrideMmMin ?? Math.round(rpm * fluteCount * cp.chiploadMm)
  const feedMmMin = Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, recommendedFeedMmMin)
  const feedClampedToFloor = recommendedFeedMmMin < CAM_FEED_PLUNGE_FLOOR_MM_MIN
  const plungeMmMin = Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, Math.round(feedMmMin * cp.plungeFactor))
  const stepoverMm = Math.round(toolDiamMm * cp.stepoverFactor * 10) / 10
  const zPassMm = -(Math.round(toolDiamMm * cp.docFactor * 10) / 10)

  return { feedMmMin, plungeMmMin, stepoverMm, zPassMm, rpm, recommendedFeedMmMin, feedClampedToFloor }
}
