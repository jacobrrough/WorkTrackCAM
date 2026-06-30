/**
 * Pure op-builder unit test: `buildIntersectBoxOp(...)` must return an op that the real
 * `kernelPostSolidOpSchema` accepts (and that the box op's own `.refine(...)` passes). This proves
 * the dialog emits a schema-valid `boolean_intersect_box` without rendering. See `wire-feature-dialog`.
 */

import { describe, expect, it } from 'vitest'
import {
  buildIntersectBoxOp,
  intersectBoxAxesValid,
  type IntersectBoxBounds
} from '../IntersectBoxDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

describe('buildIntersectBoxOp', () => {
  it('returns the exact typed boolean_intersect_box op', () => {
    const bounds: IntersectBoxBounds = {
      xMinMm: -5,
      xMaxMm: 15,
      yMinMm: -7.5,
      yMaxMm: 7.5,
      zMinMm: 0,
      zMaxMm: 12
    }
    expect(buildIntersectBoxOp(bounds)).toEqual({
      kind: 'boolean_intersect_box',
      xMinMm: -5,
      xMaxMm: 15,
      yMinMm: -7.5,
      yMaxMm: 7.5,
      zMinMm: 0,
      zMaxMm: 12
    })
  })

  it('produces an op kernelPostSolidOpSchema accepts (incl. the strictly-increasing refine)', () => {
    const op = buildIntersectBoxOp({
      xMinMm: -10,
      xMaxMm: 10,
      yMinMm: -10,
      yMaxMm: 10,
      zMinMm: 0,
      zMaxMm: 20
    })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toMatchObject({ kind: 'boolean_intersect_box' })
  })

  it('accepts negative-world boxes (signed bounds round-trip through the schema)', () => {
    const op = buildIntersectBoxOp({
      xMinMm: -50,
      xMaxMm: -10,
      yMinMm: -50,
      yMaxMm: -10,
      zMinMm: -30,
      zMaxMm: -5
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('emits an op the schema REJECTS when an axis is not strictly increasing', () => {
    // The dialog gates this case (intersectBoxAxesValid is false), but if the
    // builder were handed it directly the schema's refine must still reject it.
    const badBounds: IntersectBoxBounds = {
      xMinMm: 20,
      xMaxMm: 5, // max <= min on X
      yMinMm: -10,
      yMaxMm: 10,
      zMinMm: 0,
      zMaxMm: 20
    }
    expect(intersectBoxAxesValid(badBounds)).toBe(false)
    expect(() => kernelPostSolidOpSchema.parse(buildIntersectBoxOp(badBounds))).toThrow()
  })
})
