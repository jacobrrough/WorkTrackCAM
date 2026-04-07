/**
 * Standard machining reference data for material preset auditing.
 *
 * Values sourced from:
 * - Machinery's Handbook (31st edition) — SFM ranges for carbide tooling
 * - Manufacturer recommendations (Harvey Tool, Kennametal, Niagara Cutter)
 * - CNC hobbyist community consensus for router-class machines
 *
 * All surface speeds are in m/min (metric). Chip loads are in mm/tooth
 * for the stated diameter range.
 *
 * Each material has a min/max range — values within ±30% of this range
 * are acceptable given machine rigidity and coating variation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurfaceSpeedRange {
  /** Minimum recommended surface speed in m/min for carbide tooling. */
  minMMin: number
  /** Maximum recommended surface speed in m/min for carbide tooling. */
  maxMMin: number
}

export interface ChipLoadRange {
  /** Minimum recommended chipload in mm/tooth for the given tool type + diameter range. */
  minMm: number
  /** Maximum recommended chipload in mm/tooth for the given tool type + diameter range. */
  maxMm: number
}

export type AuditToolType = 'endmill_2f' | 'endmill_4f' | 'ball' | 'drill'

/**
 * Mapping from material category to surface speed reference range.
 * Categories align with `MaterialCategory` from material-schema.ts.
 */
export type MaterialSfmReference = Record<string, SurfaceSpeedRange>

/**
 * Chip load reference for a specific tool type.
 * Assumes 3–12 mm diameter range (typical CNC router / small mill).
 */
export type MaterialChipLoadReference = Record<string, Record<AuditToolType, ChipLoadRange>>

// ---------------------------------------------------------------------------
// Surface speed reference data (m/min, carbide tooling)
// ---------------------------------------------------------------------------

/**
 * Standard surface speed ranges in m/min for carbide tooling.
 *
 * Ranges are intentionally broad to cover uncoated, TiAlN, and ZrN coatings
 * across rigidity tiers from desktop CNC to VMC.
 */
export const SURFACE_SPEED_REFERENCE: MaterialSfmReference = {
  // --- Metals ---
  aluminum_6061:  { minMMin: 100, maxMMin: 300 },
  aluminum_cast:  { minMMin: 60,  maxMMin: 200 },
  steel_mild:     { minMMin: 20,  maxMMin: 60 },
  steel_tool:     { minMMin: 15,  maxMMin: 40 },
  stainless:      { minMMin: 12,  maxMMin: 35 },
  brass:          { minMMin: 60,  maxMMin: 150 },
  copper:         { minMMin: 50,  maxMMin: 120 },
  // Using "cast_iron" as a loose alias for any grey/ductile cast iron
  cast_iron:      { minMMin: 40,  maxMMin: 100 },
  titanium:       { minMMin: 30,  maxMMin: 60 },

  // --- Plastics ---
  acrylic:        { minMMin: 100, maxMMin: 300 },
  hdpe:           { minMMin: 100, maxMMin: 300 },
  delrin:         { minMMin: 100, maxMMin: 300 },
  pvc:            { minMMin: 80,  maxMMin: 250 },

  // --- Wood & composites ---
  softwood:       { minMMin: 150, maxMMin: 400 },
  hardwood:       { minMMin: 100, maxMMin: 300 },
  mdf:            { minMMin: 120, maxMMin: 350 },
  plywood:        { minMMin: 120, maxMMin: 350 },
  foam:           { minMMin: 200, maxMMin: 600 },
  carbon_fiber:   { minMMin: 50,  maxMMin: 150 }
}

// ---------------------------------------------------------------------------
// Chip load reference data (mm/tooth, 3–12 mm dia range)
// ---------------------------------------------------------------------------

/**
 * Standard chip load ranges in mm/tooth for common tool types.
 * Assumes 3–12 mm diameter carbide tooling.
 *
 * For smaller tooling (< 3 mm) divide by ~2; for larger (> 12 mm) multiply by ~1.5.
 */
export const CHIP_LOAD_REFERENCE: MaterialChipLoadReference = {
  // --- Metals ---
  aluminum_6061: {
    endmill_2f: { minMm: 0.02,  maxMm: 0.08  },
    endmill_4f: { minMm: 0.015, maxMm: 0.05  },
    ball:       { minMm: 0.01,  maxMm: 0.04  },
    drill:      { minMm: 0.03,  maxMm: 0.10  }
  },
  aluminum_cast: {
    endmill_2f: { minMm: 0.015, maxMm: 0.06  },
    endmill_4f: { minMm: 0.01,  maxMm: 0.04  },
    ball:       { minMm: 0.008, maxMm: 0.03  },
    drill:      { minMm: 0.02,  maxMm: 0.08  }
  },
  steel_mild: {
    endmill_2f: { minMm: 0.01,  maxMm: 0.04  },
    endmill_4f: { minMm: 0.008, maxMm: 0.03  },
    ball:       { minMm: 0.005, maxMm: 0.02  },
    drill:      { minMm: 0.015, maxMm: 0.06  }
  },
  steel_tool: {
    endmill_2f: { minMm: 0.008, maxMm: 0.03  },
    endmill_4f: { minMm: 0.005, maxMm: 0.02  },
    ball:       { minMm: 0.004, maxMm: 0.015 },
    drill:      { minMm: 0.01,  maxMm: 0.04  }
  },
  stainless: {
    endmill_2f: { minMm: 0.008, maxMm: 0.025 },
    endmill_4f: { minMm: 0.005, maxMm: 0.02  },
    ball:       { minMm: 0.004, maxMm: 0.012 },
    drill:      { minMm: 0.01,  maxMm: 0.04  }
  },
  brass: {
    endmill_2f: { minMm: 0.015, maxMm: 0.06  },
    endmill_4f: { minMm: 0.01,  maxMm: 0.04  },
    ball:       { minMm: 0.008, maxMm: 0.03  },
    drill:      { minMm: 0.02,  maxMm: 0.08  }
  },
  copper: {
    endmill_2f: { minMm: 0.015, maxMm: 0.05  },
    endmill_4f: { minMm: 0.01,  maxMm: 0.035 },
    ball:       { minMm: 0.008, maxMm: 0.025 },
    drill:      { minMm: 0.02,  maxMm: 0.06  }
  },
  cast_iron: {
    endmill_2f: { minMm: 0.01,  maxMm: 0.04  },
    endmill_4f: { minMm: 0.008, maxMm: 0.03  },
    ball:       { minMm: 0.005, maxMm: 0.02  },
    drill:      { minMm: 0.015, maxMm: 0.05  }
  },
  titanium: {
    endmill_2f: { minMm: 0.008, maxMm: 0.03  },
    endmill_4f: { minMm: 0.005, maxMm: 0.02  },
    ball:       { minMm: 0.004, maxMm: 0.015 },
    drill:      { minMm: 0.01,  maxMm: 0.04  }
  },

  // --- Plastics ---
  acrylic: {
    endmill_2f: { minMm: 0.03,  maxMm: 0.12  },
    endmill_4f: { minMm: 0.02,  maxMm: 0.08  },
    ball:       { minMm: 0.015, maxMm: 0.06  },
    drill:      { minMm: 0.04,  maxMm: 0.15  }
  },
  hdpe: {
    endmill_2f: { minMm: 0.04,  maxMm: 0.15  },
    endmill_4f: { minMm: 0.03,  maxMm: 0.10  },
    ball:       { minMm: 0.02,  maxMm: 0.08  },
    drill:      { minMm: 0.05,  maxMm: 0.18  }
  },
  delrin: {
    endmill_2f: { minMm: 0.03,  maxMm: 0.12  },
    endmill_4f: { minMm: 0.02,  maxMm: 0.08  },
    ball:       { minMm: 0.015, maxMm: 0.06  },
    drill:      { minMm: 0.04,  maxMm: 0.15  }
  },
  pvc: {
    endmill_2f: { minMm: 0.03,  maxMm: 0.10  },
    endmill_4f: { minMm: 0.02,  maxMm: 0.07  },
    ball:       { minMm: 0.015, maxMm: 0.05  },
    drill:      { minMm: 0.04,  maxMm: 0.12  }
  },

  // --- Wood & composites ---
  softwood: {
    endmill_2f: { minMm: 0.03,  maxMm: 0.12  },
    endmill_4f: { minMm: 0.02,  maxMm: 0.08  },
    ball:       { minMm: 0.02,  maxMm: 0.06  },
    drill:      { minMm: 0.05,  maxMm: 0.15  }
  },
  hardwood: {
    endmill_2f: { minMm: 0.025, maxMm: 0.08  },
    endmill_4f: { minMm: 0.015, maxMm: 0.06  },
    ball:       { minMm: 0.015, maxMm: 0.05  },
    drill:      { minMm: 0.04,  maxMm: 0.10  }
  },
  mdf: {
    endmill_2f: { minMm: 0.03,  maxMm: 0.10  },
    endmill_4f: { minMm: 0.02,  maxMm: 0.07  },
    ball:       { minMm: 0.02,  maxMm: 0.06  },
    drill:      { minMm: 0.04,  maxMm: 0.12  }
  },
  plywood: {
    endmill_2f: { minMm: 0.025, maxMm: 0.10  },
    endmill_4f: { minMm: 0.015, maxMm: 0.07  },
    ball:       { minMm: 0.015, maxMm: 0.05  },
    drill:      { minMm: 0.03,  maxMm: 0.12  }
  },
  foam: {
    endmill_2f: { minMm: 0.08,  maxMm: 0.25  },
    endmill_4f: { minMm: 0.06,  maxMm: 0.18  },
    ball:       { minMm: 0.04,  maxMm: 0.12  },
    drill:      { minMm: 0.10,  maxMm: 0.30  }
  },
  carbon_fiber: {
    endmill_2f: { minMm: 0.01,  maxMm: 0.04  },
    endmill_4f: { minMm: 0.008, maxMm: 0.03  },
    ball:       { minMm: 0.005, maxMm: 0.02  },
    drill:      { minMm: 0.015, maxMm: 0.05  }
  }
}

// ---------------------------------------------------------------------------
// Helpers for audit code
// ---------------------------------------------------------------------------

/**
 * Map from the cut-params tool-type key used in `default-materials.json`
 * to the audit reference tool type.
 *
 * 'default' and 'endmill' map to endmill_2f (conservative 2-flute assumption).
 * 'ball' → ball, 'drill' → drill, 'vbit' → endmill_2f (closest match).
 */
export function mapToolTypeToAudit(toolTypeKey: string): AuditToolType {
  switch (toolTypeKey) {
    case 'endmill':
    case 'default':
    case 'vbit':
    case 'o_flute':
    case 'face':
    case 'chamfer':
      return 'endmill_2f'
    case 'ball':
      return 'ball'
    case 'drill':
      return 'drill'
    default:
      return 'endmill_2f'
  }
}
