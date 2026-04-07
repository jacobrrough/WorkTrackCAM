import { describe, expect, it } from 'vitest'
import {
  constraintTypeForDesignCommand,
  DESIGN_CONSTRAINT_COMMAND_TO_TYPE,
  DESIGN_SKETCH_COMMAND_TO_TOOL,
  sketchToolForDesignCommand
} from './design-command-map'

describe('design-command-map', () => {
  it('maps known sketch commands', () => {
    expect(sketchToolForDesignCommand('sk_line')).toBe('line')
    expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_rect).toBe('rect')
  })

  it('maps known constraint commands', () => {
    expect(constraintTypeForDesignCommand('co_distance')).toBe('distance')
    expect(DESIGN_CONSTRAINT_COMMAND_TO_TYPE.co_tangent).toBe('tangent')
  })

  it('returns undefined for unknown ids', () => {
    expect(sketchToolForDesignCommand('unknown')).toBeUndefined()
    expect(constraintTypeForDesignCommand('unknown')).toBeUndefined()
  })
})
