import { describe, expect, it } from 'vitest'
import type { ToolRecord } from '../../shared/tool-schema'
import {
  searchTools,
  filterTools,
  sortTools,
  createDefaultTool,
  validateTool,
  duplicateTool,
  TOOL_TYPE_LABELS,
  TOOL_TYPE_ICONS,
  TOOL_TYPES,
  type ToolFilters
} from './tool-library-utils'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTool(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: `tool_${Math.random().toString(36).slice(2)}`,
    name: 'Test Endmill',
    type: 'endmill',
    diameterMm: 6,
    fluteCount: 2,
    lengthMm: 50,
    material: 'Carbide',
    source: 'manual',
    ...overrides
  }
}

const SAMPLE_TOOLS: ToolRecord[] = [
  makeTool({ id: 't1', name: '1/4 Flat Endmill', type: 'endmill', diameterMm: 6.35, fluteCount: 2, material: 'Carbide' }),
  makeTool({ id: 't2', name: '1/8 Ball Nose', type: 'ball', diameterMm: 3.175, fluteCount: 2, material: 'Carbide' }),
  makeTool({ id: 't3', name: 'V-Bit 60 deg', type: 'vbit', diameterMm: 6, fluteCount: 2, material: 'HSS' }),
  makeTool({ id: 't4', name: '3mm Drill', type: 'drill', diameterMm: 3, fluteCount: 2, material: 'HSS' }),
  makeTool({ id: 't5', name: '50mm Face Mill', type: 'face', diameterMm: 50, fluteCount: 4, material: 'Carbide' }),
  makeTool({ id: 't6', name: 'O-Flute Upcut', type: 'o_flute', diameterMm: 3.175, fluteCount: 1, material: 'Carbide' }),
  makeTool({ id: 't7', name: 'Corn Cob Rougher', type: 'corn', diameterMm: 6, fluteCount: 4, material: 'Carbide', notes: 'Great for foam and wood' }),
]

// ── Search tests ─────────────────────────────────────────────────────────────

describe('searchTools', () => {
  it('returns all tools when query is empty', () => {
    const result = searchTools(SAMPLE_TOOLS, '')
    expect(result).toHaveLength(SAMPLE_TOOLS.length)
  })

  it('returns all tools when query is whitespace', () => {
    const result = searchTools(SAMPLE_TOOLS, '   ')
    expect(result).toHaveLength(SAMPLE_TOOLS.length)
  })

  it('finds exact name match', () => {
    const result = searchTools(SAMPLE_TOOLS, '3mm Drill')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t4')
  })

  it('finds partial name match', () => {
    const result = searchTools(SAMPLE_TOOLS, 'Ball')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })

  it('is case insensitive', () => {
    const result = searchTools(SAMPLE_TOOLS, 'ENDMILL')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some(t => t.id === 't1')).toBe(true)
  })

  it('matches by diameter string', () => {
    const result = searchTools(SAMPLE_TOOLS, '3.175')
    expect(result).toHaveLength(2) // ball nose + o-flute
  })

  it('matches by tool type label', () => {
    const result = searchTools(SAMPLE_TOOLS, 'Ball Nose')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })

  it('matches by material', () => {
    const result = searchTools(SAMPLE_TOOLS, 'HSS')
    expect(result).toHaveLength(2) // vbit + drill
  })

  it('matches by notes content', () => {
    const result = searchTools(SAMPLE_TOOLS, 'foam')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t7')
  })

  it('supports multi-token search (AND logic)', () => {
    const result = searchTools(SAMPLE_TOOLS, 'carbide 6.35')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('returns empty array for no results', () => {
    const result = searchTools(SAMPLE_TOOLS, 'nonexistent-tool-xyz')
    expect(result).toHaveLength(0)
  })

  it('matches flute count shorthand (e.g. "1f")', () => {
    const result = searchTools(SAMPLE_TOOLS, '1f')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t6')
  })
})

// ── Filter tests ─────────────────────────────────────────────────────────────

describe('filterTools', () => {
  it('returns all tools when no filters are set', () => {
    const result = filterTools(SAMPLE_TOOLS, {})
    expect(result).toHaveLength(SAMPLE_TOOLS.length)
  })

  it('filters by single type', () => {
    const result = filterTools(SAMPLE_TOOLS, { types: ['endmill'] })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('filters by multiple types', () => {
    const result = filterTools(SAMPLE_TOOLS, { types: ['endmill', 'ball'] })
    expect(result).toHaveLength(2)
  })

  it('filters by diameter min', () => {
    const result = filterTools(SAMPLE_TOOLS, { diameterMin: 6 })
    expect(result.every(t => t.diameterMm >= 6)).toBe(true)
  })

  it('filters by diameter max', () => {
    const result = filterTools(SAMPLE_TOOLS, { diameterMax: 6 })
    expect(result.every(t => t.diameterMm <= 6)).toBe(true)
  })

  it('filters by diameter range', () => {
    const result = filterTools(SAMPLE_TOOLS, { diameterMin: 3, diameterMax: 6 })
    expect(result.every(t => t.diameterMm >= 3 && t.diameterMm <= 6)).toBe(true)
    // Should not include the 50mm face mill
    expect(result.some(t => t.id === 't5')).toBe(false)
  })

  it('filters by flute count', () => {
    const result = filterTools(SAMPLE_TOOLS, { fluteCount: 4 })
    expect(result).toHaveLength(2) // face mill + corn cob
  })

  it('filters by material (case insensitive)', () => {
    const result = filterTools(SAMPLE_TOOLS, { material: 'hss' })
    expect(result).toHaveLength(2)
    expect(result.every(t => (t.material ?? '').toLowerCase().includes('hss'))).toBe(true)
  })

  it('applies combined filters (AND logic)', () => {
    const result = filterTools(SAMPLE_TOOLS, {
      types: ['endmill', 'ball', 'vbit'],
      material: 'carbide'
    })
    // endmill (carbide) + ball nose (carbide); vbit is HSS so excluded
    expect(result).toHaveLength(2)
  })

  it('returns empty when no tools match combined filters', () => {
    const result = filterTools(SAMPLE_TOOLS, {
      types: ['drill'],
      material: 'Carbide'
    })
    // drill is HSS, not Carbide
    expect(result).toHaveLength(0)
  })

  it('ignores empty types array', () => {
    const result = filterTools(SAMPLE_TOOLS, { types: [] })
    expect(result).toHaveLength(SAMPLE_TOOLS.length)
  })
})

// ── Sort tests ───────────────────────────────────────────────────────────────

describe('sortTools', () => {
  it('sorts by name ascending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'name', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i].name.localeCompare(result[i - 1].name, undefined, { sensitivity: 'base' }))
        .toBeGreaterThanOrEqual(0)
    }
  })

  it('sorts by name descending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'name', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i].name.localeCompare(result[i - 1].name, undefined, { sensitivity: 'base' }))
        .toBeLessThanOrEqual(0)
    }
  })

  it('sorts by diameter ascending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'diameter', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i].diameterMm).toBeGreaterThanOrEqual(result[i - 1].diameterMm)
    }
  })

  it('sorts by diameter descending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'diameter', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect(result[i].diameterMm).toBeLessThanOrEqual(result[i - 1].diameterMm)
    }
  })

  it('sorts by type ascending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'type', 'asc')
    for (let i = 1; i < result.length; i++) {
      const label = (TOOL_TYPE_LABELS as Record<string, string>)[result[i].type] ?? result[i].type
      const prevLabel = (TOOL_TYPE_LABELS as Record<string, string>)[result[i - 1].type] ?? result[i - 1].type
      expect(label.localeCompare(prevLabel, undefined, { sensitivity: 'base' }))
        .toBeGreaterThanOrEqual(0)
    }
  })

  it('sorts by fluteCount ascending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'fluteCount', 'asc')
    for (let i = 1; i < result.length; i++) {
      expect((result[i].fluteCount ?? 0)).toBeGreaterThanOrEqual((result[i - 1].fluteCount ?? 0))
    }
  })

  it('sorts by fluteCount descending', () => {
    const result = sortTools(SAMPLE_TOOLS, 'fluteCount', 'desc')
    for (let i = 1; i < result.length; i++) {
      expect((result[i].fluteCount ?? 0)).toBeLessThanOrEqual((result[i - 1].fluteCount ?? 0))
    }
  })

  it('does not mutate the original array', () => {
    const original = [...SAMPLE_TOOLS]
    sortTools(SAMPLE_TOOLS, 'diameter', 'desc')
    expect(SAMPLE_TOOLS.map(t => t.id)).toEqual(original.map(t => t.id))
  })

  it('defaults to ascending when direction omitted', () => {
    const result = sortTools(SAMPLE_TOOLS, 'diameter')
    for (let i = 1; i < result.length; i++) {
      expect(result[i].diameterMm).toBeGreaterThanOrEqual(result[i - 1].diameterMm)
    }
  })
})

// ── createDefaultTool tests ──────────────────────────────────────────────────

describe('createDefaultTool', () => {
  it('creates an endmill with sensible defaults', () => {
    const tool = createDefaultTool('endmill')
    expect(tool.type).toBe('endmill')
    expect(tool.name).toContain('Flat Endmill')
    expect(tool.diameterMm).toBeGreaterThan(0)
    expect(tool.fluteCount).toBeGreaterThan(0)
    expect(tool.id).toBeTruthy()
    expect(tool.source).toBe('manual')
  })

  it('creates tools with different defaults per type', () => {
    const drill = createDefaultTool('drill')
    const face = createDefaultTool('face')
    expect(drill.diameterMm).toBeLessThan(face.diameterMm)
    expect(drill.material).toBe('HSS')
    expect(face.fluteCount).toBe(4)
  })

  it('generates unique IDs', () => {
    const a = createDefaultTool('endmill')
    const b = createDefaultTool('endmill')
    expect(a.id).not.toBe(b.id)
  })

  it('defaults to endmill when no type given', () => {
    const tool = createDefaultTool()
    expect(tool.type).toBe('endmill')
  })

  it('creates a valid ToolRecord per schema', () => {
    for (const type of TOOL_TYPES) {
      const tool = createDefaultTool(type)
      const result = validateTool(tool)
      expect(result.success).toBe(true)
    }
  })

  it('o_flute has 1 flute by default', () => {
    const tool = createDefaultTool('o_flute')
    expect(tool.fluteCount).toBe(1)
  })
})

// ── validateTool tests ───────────────────────────────────────────────────────

describe('validateTool', () => {
  it('accepts a valid tool record', () => {
    const tool = makeTool()
    const result = validateTool(tool)
    expect(result.success).toBe(true)
    expect(result.errors).toBeUndefined()
  })

  it('rejects tool with empty name', () => {
    const tool = makeTool({ name: '' })
    const result = validateTool(tool)
    expect(result.success).toBe(false)
    expect(result.errors).toBeDefined()
    expect(result.errors!.some(e => e.includes('Name'))).toBe(true)
  })

  it('rejects tool with zero diameter', () => {
    const tool = makeTool({ diameterMm: 0 })
    const result = validateTool(tool)
    expect(result.success).toBe(false)
    expect(result.errors!.some(e => e.includes('Diameter'))).toBe(true)
  })

  it('rejects tool with negative diameter', () => {
    const tool = makeTool({ diameterMm: -1 })
    const result = validateTool(tool)
    expect(result.success).toBe(false)
  })

  it('rejects tool with invalid type', () => {
    const tool = { ...makeTool(), type: 'laser' as ToolRecord['type'] }
    const result = validateTool(tool)
    expect(result.success).toBe(false)
    expect(result.errors!.some(e => e.includes('Type'))).toBe(true)
  })

  it('rejects completely invalid input', () => {
    const result = validateTool({ foo: 'bar' })
    expect(result.success).toBe(false)
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('accepts tool with optional fields omitted', () => {
    const tool: ToolRecord = {
      id: 'minimal',
      name: 'Minimal Tool',
      type: 'endmill',
      diameterMm: 6
    }
    const result = validateTool(tool)
    expect(result.success).toBe(true)
  })

  it('rejects tool with toolSlot out of range', () => {
    const tool = makeTool({ toolSlot: 7 })
    const result = validateTool(tool)
    expect(result.success).toBe(false)
    expect(result.errors!.some(e => e.includes('ATC slot'))).toBe(true)
  })

  it('accepts tool with toolSlot in valid range', () => {
    const tool = makeTool({ toolSlot: 3 })
    const result = validateTool(tool)
    expect(result.success).toBe(true)
  })

  it('produces human-readable field names in errors', () => {
    const result = validateTool({ id: '', name: '', type: 'bad', diameterMm: 0 })
    expect(result.success).toBe(false)
    // Should use friendly labels, not raw Zod paths
    const hasRawPath = result.errors!.some(e => /^\d+:/.test(e))
    expect(hasRawPath).toBe(false)
  })
})

// ── duplicateTool tests ──────────────────────────────────────────────────────

describe('duplicateTool', () => {
  it('creates a clone with a new ID', () => {
    const original = makeTool({ id: 'orig-1', name: 'My Endmill' })
    const clone = duplicateTool(original)
    expect(clone.id).not.toBe(original.id)
    expect(clone.id).toBeTruthy()
  })

  it('prefixes name with "Copy of"', () => {
    const original = makeTool({ name: 'My Endmill' })
    const clone = duplicateTool(original)
    expect(clone.name).toBe('Copy of My Endmill')
  })

  it('does not double-prefix "Copy of"', () => {
    const original = makeTool({ name: 'Copy of My Endmill' })
    const clone = duplicateTool(original)
    expect(clone.name).toBe('Copy of My Endmill')
    expect(clone.name).not.toBe('Copy of Copy of My Endmill')
  })

  it('deep-clones material presets', () => {
    const original = makeTool({
      materialPresets: [
        { materialType: 'aluminum', spindleRpm: 10000, feedMmMin: 500 }
      ]
    })
    const clone = duplicateTool(original)
    // Mutate clone preset — should not affect original
    clone.materialPresets![0].spindleRpm = 99999
    expect(original.materialPresets![0].spindleRpm).toBe(10000)
  })

  it('preserves all other fields', () => {
    const original = makeTool({
      type: 'ball',
      diameterMm: 12,
      fluteCount: 3,
      lengthMm: 75,
      material: 'HSS',
      toolSlot: 2,
      notes: 'Finishing only'
    })
    const clone = duplicateTool(original)
    expect(clone.type).toBe('ball')
    expect(clone.diameterMm).toBe(12)
    expect(clone.fluteCount).toBe(3)
    expect(clone.lengthMm).toBe(75)
    expect(clone.material).toBe('HSS')
    expect(clone.toolSlot).toBe(2)
    expect(clone.notes).toBe('Finishing only')
  })

  it('produces a valid tool per schema', () => {
    const original = makeTool()
    const clone = duplicateTool(original)
    const result = validateTool(clone)
    expect(result.success).toBe(true)
  })
})

// ── Metadata exports ─────────────────────────────────────────────────────────

describe('metadata exports', () => {
  it('TOOL_TYPE_LABELS has an entry for every type', () => {
    for (const t of TOOL_TYPES) {
      expect(TOOL_TYPE_LABELS[t]).toBeTruthy()
    }
  })

  it('TOOL_TYPE_ICONS has an entry for every type', () => {
    for (const t of TOOL_TYPES) {
      expect(TOOL_TYPE_ICONS[t]).toBeTruthy()
    }
  })

  it('TOOL_TYPES matches the canonical tool type enum', () => {
    expect(TOOL_TYPES).toContain('endmill')
    expect(TOOL_TYPES).toContain('ball')
    expect(TOOL_TYPES).toContain('vbit')
    expect(TOOL_TYPES).toContain('drill')
    expect(TOOL_TYPES).toContain('face')
    expect(TOOL_TYPES).toContain('chamfer')
    expect(TOOL_TYPES).toContain('thread_mill')
    expect(TOOL_TYPES).toContain('o_flute')
    expect(TOOL_TYPES).toContain('corn')
    expect(TOOL_TYPES).toContain('other')
    expect(TOOL_TYPES).toHaveLength(10)
  })
})
