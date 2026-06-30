/**
 * Op-builder unit test: proves `buildCircularPatternOp(...)` returns an op that
 * the real `kernelPostSolidOpSchema` accepts (so the dialog can never emit a
 * shape the kernel build path would reject). Pure — no rendering.
 */

import { describe, expect, it } from 'vitest'
import { buildCircularPatternOp } from '../CircularPatternDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

describe('buildCircularPatternOp', () => {
  it('builds a pattern_circular op the schema accepts', () => {
    const op = buildCircularPatternOp({
      count: 6,
      centerXMm: 12.5,
      centerYMm: -8,
      startAngleDeg: 15,
      totalAngleDeg: 270
    })

    expect(op).toEqual({
      kind: 'pattern_circular',
      count: 6,
      centerXMm: 12.5,
      centerYMm: -8,
      startAngleDeg: 15,
      totalAngleDeg: 270
    })

    // The schema parse is the real gate: it must accept the built op unchanged.
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toEqual(op)
  })

  it('accepts the boundary values (count 2 & 32, full 360 sweep, 0 centre/start)', () => {
    const low = buildCircularPatternOp({
      count: 2,
      centerXMm: 0,
      centerYMm: 0,
      startAngleDeg: 0,
      totalAngleDeg: 360
    })
    const high = buildCircularPatternOp({
      count: 32,
      centerXMm: -100.25,
      centerYMm: 100.25,
      startAngleDeg: 359,
      totalAngleDeg: 1
    })

    expect(() => kernelPostSolidOpSchema.parse(low)).not.toThrow()
    expect(() => kernelPostSolidOpSchema.parse(high)).not.toThrow()
  })

  it('produces a count > 32 the schema REJECTS (proves the bound is real, not faked)', () => {
    const tooMany = buildCircularPatternOp({
      count: 33,
      centerXMm: 0,
      centerYMm: 0,
      startAngleDeg: 0,
      totalAngleDeg: 360
    })
    expect(() => kernelPostSolidOpSchema.parse(tooMany)).toThrow()
  })
})
