/**
 * Tool Library Utilities — search, filter, sort, and CRUD helpers for CNC tool records.
 *
 * Pure functions with zero side-effects. The UI component (ToolLibraryPanel) calls
 * these to transform tool arrays; persistence is handled by Electron IPC.
 */
import { z } from 'zod'
import { toolRecordSchema } from '../../shared/tool-schema'
import type { ToolRecord } from '../../shared/tool-schema'

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
    return true
  })
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
