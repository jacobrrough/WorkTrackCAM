/**
 * Tool Library Utilities — search, filter, sort, and CRUD helpers for CNC tool records.
 *
 * Pure functions with zero side-effects. The UI component (ToolLibraryPanel) calls
 * these to transform tool arrays; persistence is handled by Electron IPC.
 */
import { z } from 'zod'
import { toolRecordSchema } from '../../shared/tool-schema'
import type { ToolRecord } from '../../shared/tool-schema'
import {
  materialCategoryEnum,
  MATERIAL_CATEGORY_LABELS,
  type MaterialCategory
} from '../../shared/material-schema'

// ── Tool type metadata ───────────────────────────────────────────────────────

/** Human-readable label for every canonical tool type. */
export const TOOL_TYPE_LABELS: Record<ToolRecord['type'], string> = {
  endmill: 'Flat Endmill',
  ball: 'Ball Nose',
  vbit: 'V-Bit',
  drill: 'Drill',
  face: 'Face Mill',
  chamfer: 'Chamfer',
  thread_mill: 'Thread Mill',
  o_flute: 'O-Flute',
  corn: 'Corn Cob',
  other: 'Other'
}

/** Canonical tool type keys (useful for dropdowns / filter chips). */
export const TOOL_TYPES = Object.keys(TOOL_TYPE_LABELS) as ToolRecord['type'][]

/** Emoji icon per tool type — rendered beside the tool name in lists. */
export const TOOL_TYPE_ICONS: Record<ToolRecord['type'], string> = {
  endmill: '\u2316',   // position indicator (resembles endmill profile)
  ball: '\u25CF',       // filled circle
  vbit: '\u25BD',       // down triangle
  drill: '\u25C9',      // fisheye / bullseye
  face: '\u25A3',       // square with round inside
  chamfer: '\u25E2',    // lower right triangle
  thread_mill: '\u2261', // triple bar
  o_flute: '\u25CB',    // circle
  corn: '\u2593',       // medium shade block
  other: '\u2726'       // four-pointed star
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Fuzzy-ish search across multiple tool fields.
 * Matches any tool whose name, type label, diameter string, material, or
 * note text contains every whitespace-separated token in `query`.
 * Returns the original array reference when query is blank.
 */
export function searchTools(tools: readonly ToolRecord[], query: string): ToolRecord[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '') return tools as ToolRecord[]

  const tokens = trimmed.split(/\s+/)

  return tools.filter(t => {
    const haystack = [
      t.name,
      TOOL_TYPE_LABELS[t.type] ?? t.type,
      String(t.diameterMm),
      t.material ?? '',
      t.notes ?? '',
      t.fluteCount != null ? `${t.fluteCount}f` : ''
    ].join(' ').toLowerCase()

    return tokens.every(tok => haystack.includes(tok))
  })
}

// ── Filter ───────────────────────────────────────────────────────────────────

export interface ToolFilters {
  /** Only keep tools of these types. Empty / undefined = no type filtering. */
  types?: ToolRecord['type'][]
  /** Minimum cutting diameter (mm), inclusive. */
  diameterMin?: number
  /** Maximum cutting diameter (mm), inclusive. */
  diameterMax?: number
  /** Exact flute count. undefined = no filter. */
  fluteCount?: number
  /** Case-insensitive substring match on tool material field. */
  material?: string
  /**
   * Only keep tools that carry at least one enabled material preset whose
   * `materialType` belongs to one of these high-level categories. Tools
   * with no presets are excluded. Empty / undefined = no filtering on
   * material presets. Used by the Fusion-style "Material preset" chip
   * picker on the tool library panel.
   */
  materialPresetCategories?: MaterialCategory[]
}

/**
 * Apply structured filters to a tool array.
 * Each filter field is AND-combined. Omitted / undefined fields are ignored.
 */
export function filterTools(tools: readonly ToolRecord[], filters: ToolFilters): ToolRecord[] {
  return tools.filter(t => {
    if (filters.types && filters.types.length > 0 && !filters.types.includes(t.type)) return false
    if (filters.diameterMin != null && t.diameterMm < filters.diameterMin) return false
    if (filters.diameterMax != null && t.diameterMm > filters.diameterMax) return false
    if (filters.fluteCount != null && t.fluteCount !== filters.fluteCount) return false
    if (filters.material && !(t.material ?? '').toLowerCase().includes(filters.material.toLowerCase())) return false
    if (filters.materialPresetCategories && filters.materialPresetCategories.length > 0) {
      const cats = filters.materialPresetCategories
      const presets = t.materialPresets ?? []
      const matches = presets.some(p => {
        if (p.enabled === false) return false
        const cat = resolvePresetCategory(p.materialType)
        return cat != null && cats.includes(cat)
      })
      if (!matches) return false
    }
    return true
  })
}

// ── Material-preset category resolution ──────────────────────────────────────

/**
 * Coarse family grouping used by the tool-library "Material preset" chip
 * picker. Maps every `MaterialCategory` to one of five user-facing buckets
 * so users can filter by "Aluminum" without ticking every aluminum sub-
 * category individually.
 */
export type MaterialFamily = 'aluminum' | 'steel' | 'wood' | 'plastic' | 'other'

export const MATERIAL_FAMILIES: MaterialFamily[] = ['aluminum', 'steel', 'wood', 'plastic', 'other']

export const MATERIAL_FAMILY_LABELS: Record<MaterialFamily, string> = {
  aluminum: 'Aluminum',
  steel:    'Steel',
  wood:     'Wood',
  plastic:  'Plastic',
  other:    'Other'
}

/** Maps every canonical material category onto its coarse family bucket. */
export const MATERIAL_CATEGORY_TO_FAMILY: Record<MaterialCategory, MaterialFamily> = {
  softwood:      'wood',
  hardwood:      'wood',
  mdf:           'wood',
  plywood:       'wood',
  aluminum_6061: 'aluminum',
  aluminum_cast: 'aluminum',
  steel_mild:    'steel',
  steel_tool:    'steel',
  stainless:     'steel',
  brass:         'other',
  copper:        'other',
  acrylic:       'plastic',
  hdpe:          'plastic',
  pvc:           'plastic',
  delrin:        'plastic',
  foam:          'other',
  carbon_fiber:  'other',
  other:         'other'
}

const VALID_CATEGORIES = new Set<string>(materialCategoryEnum.options)

/**
 * Best-effort resolution of a preset `materialType` string to a canonical
 * MaterialCategory. Exact match first (presets stored with category keys
 * land here); otherwise a substring sniff so legacy free-text presets like
 * "Aluminum 6061-T6" or "Hardwood (Oak)" still bucket correctly. Returns
 * undefined when the string can't be classified.
 */
export function resolvePresetCategory(materialType: string): MaterialCategory | undefined {
  const trimmed = materialType.trim().toLowerCase()
  if (trimmed === '') return undefined
  // Exact canonical key (e.g. "aluminum_6061")
  if (VALID_CATEGORIES.has(trimmed)) return trimmed as MaterialCategory
  // Substring sniff over the user-facing labels
  for (const cat of materialCategoryEnum.options) {
    const label = MATERIAL_CATEGORY_LABELS[cat].toLowerCase()
    if (trimmed.includes(label) || label.includes(trimmed)) return cat
  }
  // Heuristic family keywords for free-text legacy values
  if (trimmed.includes('alum')) return 'aluminum_6061'
  if (trimmed.includes('steel')) return 'steel_mild'
  if (trimmed.includes('wood')) return 'hardwood'
  if (trimmed.includes('plastic')) return 'acrylic'
  return undefined
}

/**
 * Resolve a preset `materialType` string straight to its coarse family
 * bucket. Returns undefined when the input can't be classified — callers
 * should treat that as "unknown family" rather than coercing to 'other'.
 */
export function resolvePresetFamily(materialType: string): MaterialFamily | undefined {
  const cat = resolvePresetCategory(materialType)
  return cat != null ? MATERIAL_CATEGORY_TO_FAMILY[cat] : undefined
}

// ── Diameter bins ────────────────────────────────────────────────────────────

/**
 * A single diameter chip bin. `min` is inclusive, `max` is exclusive
 * except for the final bin which is inclusive on both ends so the largest
 * fixture diameter still lands in a bin.
 */
export interface DiameterBin {
  /** Stable id used as the chip's React key. */
  id: string
  /** Short human label, e.g. "0-3 mm". */
  label: string
  /** Inclusive lower bound, mm. */
  min: number
  /** Inclusive upper bound, mm (matches `filterTools` semantics). */
  max: number
}

/**
 * Default diameter chip bins covering the cutter ranges across all three
 * target machines (Carvera ER-11 micro-tooling up to Laguna ER-20 face
 * mills). Tuned to the typical Carvera + Laguna fixture catalog.
 */
export const DEFAULT_DIAMETER_BINS: DiameterBin[] = [
  { id: 'bin-micro',  label: '0–3 mm',    min: 0,    max: 3    },
  { id: 'bin-small',  label: '3–6 mm',    min: 3.01, max: 6    },
  { id: 'bin-medium', label: '6–12 mm',   min: 6.01, max: 12   },
  { id: 'bin-large',  label: '12–25 mm',  min: 12.01, max: 25  },
  { id: 'bin-face',   label: '25+ mm',    min: 25.01, max: 1000 }
]

/**
 * Find the bin whose [min, max] range contains the given diameter. Returns
 * undefined when the diameter sits outside every bin (shouldn't happen for
 * the default set since the final bin runs to 1000 mm).
 */
export function findDiameterBin(
  diameterMm: number,
  bins: readonly DiameterBin[] = DEFAULT_DIAMETER_BINS
): DiameterBin | undefined {
  return bins.find(b => diameterMm >= b.min && diameterMm <= b.max)
}

// ── Sort ─────────────────────────────────────────────────────────────────────

export type ToolSortKey = 'name' | 'diameter' | 'type' | 'fluteCount'
export type SortDirection = 'asc' | 'desc'

/**
 * Sort tools by a given key. Returns a new sorted array (no mutation).
 * String comparisons are locale-aware; numbers use numeric comparison.
 */
export function sortTools(
  tools: readonly ToolRecord[],
  sortBy: ToolSortKey,
  direction: SortDirection = 'asc'
): ToolRecord[] {
  const dir = direction === 'asc' ? 1 : -1
  return [...tools].sort((a, b) => {
    let cmp: number
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        break
      case 'diameter':
        cmp = a.diameterMm - b.diameterMm
        break
      case 'type':
        cmp = (TOOL_TYPE_LABELS[a.type] ?? a.type).localeCompare(
          TOOL_TYPE_LABELS[b.type] ?? b.type,
          undefined,
          { sensitivity: 'base' }
        )
        break
      case 'fluteCount':
        cmp = (a.fluteCount ?? 0) - (b.fluteCount ?? 0)
        break
      default:
        cmp = 0
    }
    return cmp * dir
  })
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

/** Sensible defaults keyed by tool type. */
const DEFAULT_TOOL_VALUES: Record<ToolRecord['type'], Partial<ToolRecord>> = {
  endmill:     { diameterMm: 6, fluteCount: 2, lengthMm: 50, material: 'Carbide' },
  ball:        { diameterMm: 6, fluteCount: 2, lengthMm: 50, material: 'Carbide' },
  vbit:        { diameterMm: 6, fluteCount: 2, lengthMm: 40, material: 'Carbide' },
  drill:       { diameterMm: 3, fluteCount: 2, lengthMm: 60, material: 'HSS' },
  face:        { diameterMm: 50, fluteCount: 4, lengthMm: 40, material: 'Carbide' },
  chamfer:     { diameterMm: 6, fluteCount: 2, lengthMm: 40, material: 'Carbide' },
  thread_mill: { diameterMm: 6, fluteCount: 3, lengthMm: 50, material: 'Carbide' },
  o_flute:     { diameterMm: 3.175, fluteCount: 1, lengthMm: 38, material: 'Carbide' },
  corn:        { diameterMm: 3.175, fluteCount: 4, lengthMm: 25, material: 'Carbide' },
  other:       { diameterMm: 6, fluteCount: 2, lengthMm: 50, material: 'Carbide' }
}

/**
 * Create a new tool record with sensible defaults for the given type.
 * Returns a fully valid ToolRecord ready for editing.
 */
export function createDefaultTool(type: ToolRecord['type'] = 'endmill'): ToolRecord {
  const defaults = DEFAULT_TOOL_VALUES[type]
  return {
    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `New ${TOOL_TYPE_LABELS[type]}`,
    type,
    diameterMm: defaults.diameterMm ?? 6,
    fluteCount: defaults.fluteCount ?? 2,
    lengthMm: defaults.lengthMm ?? 50,
    material: defaults.material ?? 'Carbide',
    source: 'manual'
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ToolValidationResult {
  success: boolean
  /** Only present when success is false. Array of human-readable messages. */
  errors?: string[]
}

/** User-friendly field labels for Zod path segments. */
const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  name: 'Name',
  type: 'Type',
  diameterMm: 'Diameter',
  fluteCount: 'Flute count',
  stickoutMm: 'Stickout',
  lengthMm: 'Length',
  material: 'Material',
  surfaceSpeedMMin: 'Surface speed',
  chiploadMm: 'Chipload',
  notes: 'Notes',
  source: 'Source',
  toolSlot: 'ATC slot'
}

/**
 * Validate a tool record against the Zod schema and return user-friendly errors.
 */
export function validateTool(tool: unknown): ToolValidationResult {
  const result = toolRecordSchema.safeParse(tool)
  if (result.success) return { success: true }

  const errors = result.error.issues.map(issue => {
    const field = issue.path.map(p => FIELD_LABELS[String(p)] ?? String(p)).join(' > ')
    return `${field}: ${issue.message}`
  })

  return { success: false, errors }
}

// ── Duplicate ────────────────────────────────────────────────────────────────

// ── Carvera ATC support ──────────────────────────────────────────────────────

/**
 * Returns true when the given machine id is one of the Makera Carvera
 * profiles bundled in `resources/machines/`. Used by the tool library UI
 * to gate the ATC slot grid on the only ATC-equipped machine in the
 * My-Shop-Only cohort.
 *
 * Per CLAUDE.md §3: Carvera 3-axis has 6 ATC slots; Carvera 4-axis has
 * NO ATC (the rotary attachment occupies the bay) — but the slot grid
 * still surfaces tool→slot assignments stored on the records so users
 * can pre-stage assignments for a future 3-axis swap.
 */
export function isCarveraMachineId(machineId: string | null | undefined): boolean {
  if (typeof machineId !== 'string') return false
  return machineId === 'makera-carvera-3axis' || machineId === 'makera-carvera-4axis'
}

/**
 * Build the slot-to-tool map for an ATC slot grid. Each output entry
 * carries the slot number (1..slotCount) and the tool currently assigned
 * to that slot (or undefined for empty slots). When two tools claim the
 * same slot — should never happen because `handleSlotChange` clears
 * conflicts — the first tool wins.
 */
export interface AtcSlotEntry {
  slot: number
  tool: ToolRecord | undefined
}

export function buildAtcSlotMap(
  tools: readonly ToolRecord[],
  slotCount: number
): AtcSlotEntry[] {
  const map = new Map<number, ToolRecord>()
  for (const t of tools) {
    if (typeof t.toolSlot === 'number' && t.toolSlot >= 1 && t.toolSlot <= slotCount) {
      if (!map.has(t.toolSlot)) map.set(t.toolSlot, t)
    }
  }
  const entries: AtcSlotEntry[] = []
  for (let s = 1; s <= slotCount; s++) entries.push({ slot: s, tool: map.get(s) })
  return entries
}

/**
 * Deep-clone a tool record, assigning a fresh ID and prefixing the name.
 * Material presets are cloned by value so edits to the copy don't mutate the original.
 */
export function duplicateTool(tool: ToolRecord): ToolRecord {
  const clone: ToolRecord = {
    ...tool,
    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: tool.name.startsWith('Copy of ') ? tool.name : `Copy of ${tool.name}`,
    materialPresets: tool.materialPresets
      ? tool.materialPresets.map(p => ({ ...p }))
      : undefined
  }
  return clone
}
