import { z } from 'zod'

/**
 * Per-material speed/feed preset — Makera CAM style.
 * Each tool can carry multiple material presets so selecting a stock
 * material type auto-populates spindle speed, feedrate, and cut depth.
 */
export const toolMaterialPresetSchema = z.object({
  /** Matches StockMaterialType from manufacture-schema (or any custom string). */
  materialType: z.string().trim().min(1),
  /** Spindle speed (RPM). */
  spindleRpm: z.number().positive().optional(),
  /** XY feed rate (mm/min). */
  feedMmMin: z.number().positive().optional(),
  /** Plunge / Z feed rate (mm/min). */
  plungeMmMin: z.number().positive().optional(),
  /** Radial stepover (mm). */
  stepoverMm: z.number().positive().optional(),
  /** Axial step-down per pass (mm). */
  stepDownMm: z.number().positive().optional(),
  /** Whether this preset is active/enabled for auto-selection. */
  enabled: z.boolean().optional()
})

export type ToolMaterialPreset = z.infer<typeof toolMaterialPresetSchema>

/** Canonical tool record for CNC (and optional FDM nozzle as future). */
export const toolRecordSchema = z.object({
  id: z.string().trim().min(1).describe('Unique tool record identifier'),
  name: z.string().trim().min(1).describe('Human-readable tool name'),
  type: z.enum(['endmill', 'ball', 'vbit', 'drill', 'face', 'chamfer', 'thread_mill', 'o_flute', 'corn', 'other']).describe('Cutter type classification'),
  diameterMm: z.number().positive().describe('Tool cutting diameter in mm'),
  fluteCount: z.number().int().nonnegative().optional(),
  stickoutMm: z.number().nonnegative().optional(),
  /** Overall length from holder reference */
  lengthMm: z.number().positive().optional(),
  material: z.string().optional(),
  /** Default surface speed m/min — optional */
  surfaceSpeedMMin: z.number().positive().optional(),
  /** Default chipload mm — optional */
  chiploadMm: z.number().positive().optional(),
  notes: z.string().optional(),
  source: z.enum(['manual', 'csv', 'json', 'fusion', 'hsm', 'vectric']).optional(),
  /**
   * ATC slot number (1–6) for machines with automatic tool changers.
   * Maps this tool to a physical ATC slot so posted G-code emits the correct
   * M6 T<n> and G43 H<n> commands. Optional — tools without a slot assignment
   * fall back to T1 in post templates.
   */
  toolSlot: z.number().int().min(1).max(6).optional(),
  /**
   * Makera CAM-style material presets — per-material speed/feed entries.
   * When a stock material type is selected, the matching enabled preset
   * auto-fills spindle RPM, feed rate, step-down, and stepover for the op.
   */
  materialPresets: z.array(toolMaterialPresetSchema).optional(),

  // ── Tool Wear Management ──────────────────────────────────────────────

  /**
   * Height offset register number for G43 H<n>.
   * On many controllers the H register matches the tool slot, but shops
   * that measure each insert individually may assign a dedicated register.
   */
  wearOffsetH: z.number().int().nonnegative().optional(),
  /**
   * Diameter / cutter-compensation offset register for G41/G42 D<n>.
   * Allows the controller to apply wear-adjusted cutter comp automatically.
   */
  wearOffsetD: z.number().int().nonnegative().optional(),
  /**
   * Estimated tool life in cutting minutes (from manufacturer or shop experience).
   * Used by `checkToolLife` to calculate remaining-life percentage.
   */
  toolLifeMinutes: z.number().nonnegative().optional(),
  /**
   * Accumulated cutting time in minutes across all operations since last replacement.
   * Updated by `accumulateCutTime` after each posted operation.
   */
  toolLifeUsedMinutes: z.number().nonnegative().optional(),
  /**
   * Maximum allowable wear in mm before the tool should be replaced.
   * Informational — the CAM engine does not compensate automatically.
   */
  wearLimitMm: z.number().nonnegative().optional(),
  /**
   * ISO-8601 date of the last tool replacement (e.g. "2026-04-07").
   * Helps operators track tool change intervals.
   */
  lastReplacedAt: z.string().optional()
})

export type ToolRecord = z.infer<typeof toolRecordSchema>

export const toolLibraryFileSchema = z.object({
  version: z.literal(1).describe('Tool library schema version'),
  // Default to empty array so parsing { version: 1 } succeeds — a fresh library with no tools
  // is valid (tools are added later). Matches the same robustness pattern as manufactureFileSchema.
  tools: z.array(toolRecordSchema).default([]).describe('Ordered list of tool records')
})

export type ToolLibraryFile = z.infer<typeof toolLibraryFileSchema>
