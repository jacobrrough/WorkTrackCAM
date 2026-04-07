import { describe, expect, it } from 'vitest'
import { roundTripLevelSchema } from './project-schema'
import { ROUND_TRIP_HELP, ROUND_TRIP_SHORT } from './import-history-display'

describe('import-history-display', () => {
  it('covers every roundTripLevel enum value', () => {
    const levels = roundTripLevelSchema.options
    for (const level of levels) {
      expect(ROUND_TRIP_SHORT[level].length).toBeGreaterThan(0)
      expect(ROUND_TRIP_HELP[level].length).toBeGreaterThan(0)
    }
    expect(Object.keys(ROUND_TRIP_SHORT)).toHaveLength(levels.length)
  })
})
