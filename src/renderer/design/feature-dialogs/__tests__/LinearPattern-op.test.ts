/**
 * Op-builder unit test (node env): proves `buildLinearPatternOp(...)` returns a
 * `pattern_linear_3d` op that `kernelPostSolidOpSchema.parse(...)` accepts, so
 * the dialog can only ever emit a kernel-valid op. Pure — no rendering.
 */

import { describe, expect, it } from 'vitest'
import { buildLinearPatternOp } from '../LinearPatternDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

describe('buildLinearPatternOp', () => {
  it('builds the exact typed pattern_linear_3d op', () => {
    expect(buildLinearPatternOp(5, 20, 12.5, 0)).toEqual({
      kind: 'pattern_linear_3d',
      count: 5,
      dxMm: 20,
      dyMm: 12.5,
      dzMm: 0
    })
  })

  it('emits an op the kernel schema accepts', () => {
    const op = buildLinearPatternOp(4, 0, 0, 8)
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toMatchObject({
      kind: 'pattern_linear_3d',
      count: 4,
      dxMm: 0,
      dyMm: 0,
      dzMm: 8
    })
  })

  it('accepts the boundary count values (2 and 32)', () => {
    expect(() => kernelPostSolidOpSchema.parse(buildLinearPatternOp(2, 5, 0, 0))).not.toThrow()
    expect(() => kernelPostSolidOpSchema.parse(buildLinearPatternOp(32, 0, 5, 0))).not.toThrow()
  })

  it('produces an op the schema rejects for an all-zero step (refinement holds)', () => {
    // The dialog gates this case before emit; this asserts the schema itself
    // enforces the non-zero-step refinement, so the build pairs correctly with it.
    expect(() => kernelPostSolidOpSchema.parse(buildLinearPatternOp(3, 0, 0, 0))).toThrow()
  })
})
