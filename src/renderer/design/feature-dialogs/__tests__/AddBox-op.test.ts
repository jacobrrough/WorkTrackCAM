/**
 * Pure op-builder test for the Add Box dialog. The one contract that matters:
 * `buildAddBoxOp(...)` must NEVER produce a `boolean_union_box` op the REAL
 * `kernelPostSolidOpSchema` would reject — the op gets persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP (CLAUDE.md
 * Safety Rule 1). Pure function, no React/DOM → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { boxIsValid, buildAddBoxOp } from '../AddBoxDialog'

const validBounds = {
  xMinMm: -5,
  xMaxMm: 15,
  yMinMm: -2.5,
  yMaxMm: 7.5,
  zMinMm: 0,
  zMaxMm: 20
} as const

describe('buildAddBoxOp', () => {
  it('builds the exact boolean_union_box op for the given bounds', () => {
    const op = buildAddBoxOp(validBounds)
    expect(op).toEqual({
      kind: 'boolean_union_box',
      xMinMm: -5,
      xMaxMm: 15,
      yMinMm: -2.5,
      yMaxMm: 7.5,
      zMinMm: 0,
      zMaxMm: 20
    })
    // No stray fields — `suppressed` is set by the timeline, not the dialog.
    expect(op).not.toHaveProperty('suppressed')
  })

  it('emits an op the real kernelPostSolidOpSchema accepts', () => {
    const op = buildAddBoxOp(validBounds)
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    // The parsed value round-trips identically.
    expect(kernelPostSolidOpSchema.parse(op)).toEqual(op)
  })

  it('accepts a unit box at the origin', () => {
    const op = buildAddBoxOp({
      xMinMm: 0,
      xMaxMm: 1,
      yMinMm: 0,
      yMaxMm: 1,
      zMinMm: 0,
      zMaxMm: 1
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('produces an op the schema REJECTS for a degenerate axis (refine guard)', () => {
    // A zero-extent X axis: the dialog gates this out via boxIsValid before it
    // ever calls buildAddBoxOp, but the schema's refine is the backstop. Proven
    // here so the gate condition stays in lockstep with the schema.
    const degenerate = { ...validBounds, xMaxMm: validBounds.xMinMm }
    expect(boxIsValid(degenerate)).toBe(false)
    expect(() => kernelPostSolidOpSchema.parse(buildAddBoxOp(degenerate))).toThrow()
  })

  it('boxIsValid mirrors the strictly-increasing rule on every axis', () => {
    expect(boxIsValid(validBounds)).toBe(true)
    expect(boxIsValid({ ...validBounds, yMaxMm: validBounds.yMinMm })).toBe(false)
    expect(boxIsValid({ ...validBounds, zMaxMm: validBounds.zMinMm - 1 })).toBe(false)
  })
})
