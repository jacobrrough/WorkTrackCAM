import { describe, expect, it } from 'vitest'
import { toolLibraryFileSchema, toolRecordSchema } from './tool-schema'

const minimalEndmill = {
  id: 'em-6',
  name: '6mm 2-flute endmill',
  type: 'endmill' as const,
  diameterMm: 6
}

describe('toolRecordSchema', () => {
  it('parses a minimal endmill tool record', () => {
    const t = toolRecordSchema.parse(minimalEndmill)
    expect(t.id).toBe('em-6')
    expect(t.type).toBe('endmill')
    expect(t.diameterMm).toBe(6)
  })

  it('trims id and name', () => {
    const t = toolRecordSchema.parse({ ...minimalEndmill, id: '  em-6  ', name: '  6mm endmill  ' })
    expect(t.id).toBe('em-6')
    expect(t.name).toBe('6mm endmill')
  })

  it('rejects non-positive diameterMm', () => {
    expect(() => toolRecordSchema.parse({ ...minimalEndmill, diameterMm: 0 })).toThrow()
    expect(() => toolRecordSchema.parse({ ...minimalEndmill, diameterMm: -1 })).toThrow()
  })

  it('rejects unknown tool type', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, type: 'tap' as never })
    ).toThrow()
  })

  it('accepts optional fields: fluteCount, stickoutMm, lengthMm, material, notes, source', () => {
    const t = toolRecordSchema.parse({
      ...minimalEndmill,
      fluteCount: 2,
      stickoutMm: 20,
      lengthMm: 50,
      material: 'carbide',
      notes: 'TiAlN coated',
      source: 'manual'
    })
    expect(t.fluteCount).toBe(2)
    expect(t.stickoutMm).toBe(20)
    expect(t.source).toBe('manual')
  })

  it('accepts toolSlot in valid range (1–6)', () => {
    const t = toolRecordSchema.parse({ ...minimalEndmill, toolSlot: 3 })
    expect(t.toolSlot).toBe(3)
  })

  it('rejects toolSlot below 1', () => {
    expect(() => toolRecordSchema.parse({ ...minimalEndmill, toolSlot: 0 })).toThrow()
  })

  it('rejects toolSlot above 6', () => {
    expect(() => toolRecordSchema.parse({ ...minimalEndmill, toolSlot: 7 })).toThrow()
  })

  it('rejects non-integer toolSlot', () => {
    expect(() => toolRecordSchema.parse({ ...minimalEndmill, toolSlot: 2.5 })).toThrow()
  })

  it('toolSlot is optional (omitted is valid)', () => {
    const t = toolRecordSchema.parse(minimalEndmill)
    expect(t.toolSlot).toBeUndefined()
  })

  // ── Tool Wear Fields ──────────────────────────────────────────────────

  it('accepts all tool wear tracking fields', () => {
    const t = toolRecordSchema.parse({
      ...minimalEndmill,
      wearOffsetH: 3,
      wearOffsetD: 5,
      toolLifeMinutes: 120,
      toolLifeUsedMinutes: 45.5,
      wearLimitMm: 0.05,
      lastReplacedAt: '2026-04-07'
    })
    expect(t.wearOffsetH).toBe(3)
    expect(t.wearOffsetD).toBe(5)
    expect(t.toolLifeMinutes).toBe(120)
    expect(t.toolLifeUsedMinutes).toBe(45.5)
    expect(t.wearLimitMm).toBe(0.05)
    expect(t.lastReplacedAt).toBe('2026-04-07')
  })

  it('wear fields are all optional (minimal tool still parses)', () => {
    const t = toolRecordSchema.parse(minimalEndmill)
    expect(t.wearOffsetH).toBeUndefined()
    expect(t.wearOffsetD).toBeUndefined()
    expect(t.toolLifeMinutes).toBeUndefined()
    expect(t.toolLifeUsedMinutes).toBeUndefined()
    expect(t.wearLimitMm).toBeUndefined()
    expect(t.lastReplacedAt).toBeUndefined()
  })

  it('rejects negative wearOffsetH', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, wearOffsetH: -1 })
    ).toThrow()
  })

  it('rejects non-integer wearOffsetH', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, wearOffsetH: 2.5 })
    ).toThrow()
  })

  it('accepts wearOffsetH of 0', () => {
    const t = toolRecordSchema.parse({ ...minimalEndmill, wearOffsetH: 0 })
    expect(t.wearOffsetH).toBe(0)
  })

  it('rejects negative wearOffsetD', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, wearOffsetD: -1 })
    ).toThrow()
  })

  it('rejects negative toolLifeMinutes', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, toolLifeMinutes: -5 })
    ).toThrow()
  })

  it('accepts toolLifeMinutes of 0', () => {
    const t = toolRecordSchema.parse({ ...minimalEndmill, toolLifeMinutes: 0 })
    expect(t.toolLifeMinutes).toBe(0)
  })

  it('rejects negative toolLifeUsedMinutes', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, toolLifeUsedMinutes: -1 })
    ).toThrow()
  })

  it('rejects negative wearLimitMm', () => {
    expect(() =>
      toolRecordSchema.parse({ ...minimalEndmill, wearLimitMm: -0.01 })
    ).toThrow()
  })

  it('accepts materialPresets array', () => {
    const t = toolRecordSchema.parse({
      ...minimalEndmill,
      materialPresets: [
        {
          materialType: 'aluminum',
          spindleRpm: 18000,
          feedMmMin: 1200,
          plungeMmMin: 400,
          stepoverMm: 2.5,
          stepDownMm: 2,
          enabled: true
        }
      ]
    })
    expect(t.materialPresets).toHaveLength(1)
    expect(t.materialPresets![0]!.materialType).toBe('aluminum')
  })
})

describe('toolLibraryFileSchema', () => {
  it('parses a minimal tool library', () => {
    const lib = toolLibraryFileSchema.parse({ version: 1, tools: [minimalEndmill] })
    expect(lib.version).toBe(1)
    expect(lib.tools).toHaveLength(1)
  })

  it('defaults tools to an empty array when omitted', () => {
    const lib = toolLibraryFileSchema.parse({ version: 1 })
    expect(lib.tools).toEqual([])
  })

  it('defaults tools to empty array when explicitly undefined', () => {
    const lib = toolLibraryFileSchema.parse({ version: 1, tools: undefined })
    expect(lib.tools).toEqual([])
  })

  it('rejects version other than 1', () => {
    expect(() => toolLibraryFileSchema.parse({ version: 2, tools: [] })).toThrow()
  })

  it('rejects tool records with invalid data inside the tools array', () => {
    expect(() =>
      toolLibraryFileSchema.parse({
        version: 1,
        tools: [{ id: '', name: 'bad', type: 'endmill', diameterMm: 6 }]
      })
    ).toThrow()
  })
})
