import { describe, expect, it } from 'vitest'
import type { ToolRecord } from './tool-schema'
import {
  accumulateCutTime,
  checkToolLife,
  formatWearStatus,
  generateToolChangeReminder
} from './tool-wear-utils'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid tool record for testing. */
function makeTool(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: 'em-6',
    name: '6mm 2-flute endmill',
    type: 'endmill',
    diameterMm: 6,
    ...overrides
  }
}

// ── checkToolLife ────────────────────────────────────────────────────────────

describe('checkToolLife', () => {
  it('returns ok with remainingPercent -1 when toolLifeMinutes is not set', () => {
    const result = checkToolLife(makeTool())
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(-1)
    expect(result.message).toContain('not configured')
  })

  it('returns ok with remainingPercent -1 when toolLifeMinutes is 0', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 0 }))
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(-1)
  })

  it('returns ok for a brand-new tool (0 used minutes)', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 0 }))
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(100)
    expect(result.message).toContain('100.0 min remaining')
  })

  it('returns ok at 50% usage', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 50 }))
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(50)
  })

  it('returns warn when remaining drops to 20%', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 80 }))
    expect(result.status).toBe('warn')
    expect(result.remainingPercent).toBe(20)
    expect(result.message).toContain('nearing end of life')
  })

  it('returns warn when remaining is between 1% and 20%', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 90 }))
    expect(result.status).toBe('warn')
    expect(result.remainingPercent).toBe(10)
  })

  it('returns expired when used equals total life', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 100 }))
    expect(result.status).toBe('expired')
    expect(result.remainingPercent).toBe(0)
    expect(result.message).toContain('expired')
  })

  it('returns expired when used exceeds total life', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 150 }))
    expect(result.status).toBe('expired')
    expect(result.remainingPercent).toBe(0)
  })

  it('treats undefined toolLifeUsedMinutes as 0', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 60 }))
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(100)
  })

  it('clamps negative toolLifeUsedMinutes to 0', () => {
    const result = checkToolLife(
      makeTool({ toolLifeMinutes: 60, toolLifeUsedMinutes: -10 })
    )
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(100)
  })

  it('returns ok with -1 for negative toolLifeMinutes', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: -5 }))
    expect(result.status).toBe('ok')
    expect(result.remainingPercent).toBe(-1)
  })

  it('handles fractional minutes correctly', () => {
    const result = checkToolLife(makeTool({ toolLifeMinutes: 30, toolLifeUsedMinutes: 25.5 }))
    expect(result.status).toBe('warn')
    expect(result.remainingPercent).toBe(15)
    expect(result.message).toContain('4.5 min remaining')
  })
})

// ── accumulateCutTime ────────────────────────────────────────────────────────

describe('accumulateCutTime', () => {
  it('adds operation time to existing used minutes', () => {
    const tool = makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 30 })
    const updated = accumulateCutTime(tool, 15)
    expect(updated.toolLifeUsedMinutes).toBe(45)
  })

  it('starts from 0 when toolLifeUsedMinutes is undefined', () => {
    const tool = makeTool({ toolLifeMinutes: 100 })
    const updated = accumulateCutTime(tool, 10)
    expect(updated.toolLifeUsedMinutes).toBe(10)
  })

  it('does not mutate the original tool record', () => {
    const tool = makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 20 })
    const updated = accumulateCutTime(tool, 5)
    expect(tool.toolLifeUsedMinutes).toBe(20) // original unchanged
    expect(updated.toolLifeUsedMinutes).toBe(25) // new value
  })

  it('clamps negative operation time to 0', () => {
    const tool = makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 30 })
    const updated = accumulateCutTime(tool, -10)
    expect(updated.toolLifeUsedMinutes).toBe(30) // no change
  })

  it('handles zero operation time', () => {
    const tool = makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 30 })
    const updated = accumulateCutTime(tool, 0)
    expect(updated.toolLifeUsedMinutes).toBe(30)
  })

  it('accumulates beyond total life (does not cap)', () => {
    const tool = makeTool({ toolLifeMinutes: 60, toolLifeUsedMinutes: 55 })
    const updated = accumulateCutTime(tool, 20)
    expect(updated.toolLifeUsedMinutes).toBe(75) // over life — that's valid
  })

  it('preserves all other tool fields', () => {
    const tool = makeTool({
      toolLifeMinutes: 100,
      toolLifeUsedMinutes: 10,
      fluteCount: 4,
      material: 'carbide',
      wearOffsetH: 3
    })
    const updated = accumulateCutTime(tool, 5)
    expect(updated.id).toBe('em-6')
    expect(updated.fluteCount).toBe(4)
    expect(updated.material).toBe('carbide')
    expect(updated.wearOffsetH).toBe(3)
  })
})

// ── generateToolChangeReminder ───────────────────────────────────────────────

describe('generateToolChangeReminder', () => {
  it('returns empty array when all tools are ok', () => {
    const tools = [
      makeTool({ id: 't1', toolLifeMinutes: 100, toolLifeUsedMinutes: 10 }),
      makeTool({ id: 't2', toolLifeMinutes: 100, toolLifeUsedMinutes: 50 })
    ]
    expect(generateToolChangeReminder(tools)).toEqual([])
  })

  it('returns empty array when no tools have life tracking', () => {
    const tools = [makeTool({ id: 't1' }), makeTool({ id: 't2' })]
    expect(generateToolChangeReminder(tools)).toEqual([])
  })

  it('returns empty array for an empty tool list', () => {
    expect(generateToolChangeReminder([])).toEqual([])
  })

  it('includes tools in warn state', () => {
    const tools = [
      makeTool({ id: 't1', name: 'Endmill A', toolLifeMinutes: 100, toolLifeUsedMinutes: 85 })
    ]
    const reminders = generateToolChangeReminder(tools)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.toolId).toBe('t1')
    expect(reminders[0]!.status).toBe('warn')
  })

  it('includes tools in expired state', () => {
    const tools = [
      makeTool({ id: 't1', name: 'Endmill A', toolLifeMinutes: 100, toolLifeUsedMinutes: 100 })
    ]
    const reminders = generateToolChangeReminder(tools)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.status).toBe('expired')
  })

  it('sorts expired before warn', () => {
    const tools = [
      makeTool({ id: 'warn1', name: 'Warn', toolLifeMinutes: 100, toolLifeUsedMinutes: 85 }),
      makeTool({ id: 'exp1', name: 'Expired', toolLifeMinutes: 100, toolLifeUsedMinutes: 100 })
    ]
    const reminders = generateToolChangeReminder(tools)
    expect(reminders).toHaveLength(2)
    expect(reminders[0]!.toolId).toBe('exp1')
    expect(reminders[1]!.toolId).toBe('warn1')
  })

  it('sorts by remaining percent within the same status group', () => {
    const tools = [
      makeTool({ id: 'warn-15', name: 'A', toolLifeMinutes: 100, toolLifeUsedMinutes: 85 }),
      makeTool({ id: 'warn-5', name: 'B', toolLifeMinutes: 100, toolLifeUsedMinutes: 95 })
    ]
    const reminders = generateToolChangeReminder(tools)
    expect(reminders).toHaveLength(2)
    expect(reminders[0]!.toolId).toBe('warn-5') // lower remaining first
    expect(reminders[1]!.toolId).toBe('warn-15')
  })

  it('excludes tools without life tracking from reminders', () => {
    const tools = [
      makeTool({ id: 'no-tracking' }), // no toolLifeMinutes
      makeTool({ id: 'exp', name: 'Expired', toolLifeMinutes: 50, toolLifeUsedMinutes: 55 })
    ]
    const reminders = generateToolChangeReminder(tools)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.toolId).toBe('exp')
  })
})

// ── formatWearStatus ─────────────────────────────────────────────────────────

describe('formatWearStatus', () => {
  it('formats "not configured" when life tracking is absent', () => {
    const result = formatWearStatus(makeTool())
    expect(result).toBe('6mm 2-flute endmill — life tracking not configured')
  })

  it('formats OK status with percentage', () => {
    const result = formatWearStatus(
      makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 25 })
    )
    expect(result).toBe('6mm 2-flute endmill — OK (75% life remaining)')
  })

  it('formats WARNING status with percentage', () => {
    const result = formatWearStatus(
      makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 85 })
    )
    expect(result).toBe('6mm 2-flute endmill — WARNING: 15% life remaining')
  })

  it('formats EXPIRED status', () => {
    const result = formatWearStatus(
      makeTool({ toolLifeMinutes: 100, toolLifeUsedMinutes: 100 })
    )
    expect(result).toBe('6mm 2-flute endmill — EXPIRED (0% life remaining)')
  })

  it('uses the tool name in the prefix', () => {
    const result = formatWearStatus(
      makeTool({ name: '3mm Ball Nose', toolLifeMinutes: 60, toolLifeUsedMinutes: 30 })
    )
    expect(result).toContain('3mm Ball Nose')
  })
})
