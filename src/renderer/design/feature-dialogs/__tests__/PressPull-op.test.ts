/** buildPressPullOp emits a schema-valid press_pull_profile op (round-trips kernelPostSolidOpSchema). */
import { describe, expect, it } from 'vitest'
import { buildPressPullOp } from '../PressPullProfileDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

describe('buildPressPullOp', () => {
  it('returns the exact signed-delta op and the schema accepts it', () => {
    const op = buildPressPullOp(2, -4, 1)
    expect(op).toEqual({ kind: 'press_pull_profile', profileIndex: 2, deltaMm: -4, zStartMm: 1 })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts a positive (press) delta too', () => {
    expect(() => kernelPostSolidOpSchema.parse(buildPressPullOp(0, 8, 0))).not.toThrow()
  })
})
