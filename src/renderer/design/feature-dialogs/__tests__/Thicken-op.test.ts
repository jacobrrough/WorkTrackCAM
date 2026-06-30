/**
 * Pure op-builder test: `buildThickenOp(...)` must NEVER emit a `thicken_offset`
 * op that the REAL `kernelPostSolidOpSchema` would reject — the op is persisted
 * into `part/features.json` `kernelOps[]` and replayed by a Build STEP
 * (CLAUDE.md Safety Rule 1). Round-trips every builder output through the schema.
 *
 * Pure functions (no React, no DOM) → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildThickenOp, THICKEN_SIDE_OPTIONS } from '../ThickenDialog'

describe('buildThickenOp emits a schema-valid thicken_offset op', () => {
  it('builds the exact typed op for an outward offset', () => {
    const op = buildThickenOp(2.5, 'outward')
    expect(op).toEqual({ kind: 'thicken_offset', distanceMm: 2.5, side: 'outward' })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts every side enum the schema declares', () => {
    for (const { value } of THICKEN_SIDE_OPTIONS) {
      const op = buildThickenOp(1, value)
      expect(op).toEqual({ kind: 'thicken_offset', distanceMm: 1, side: value })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    }
  })

  it('does NOT set the internal suppressed flag (optional ordering field)', () => {
    expect(buildThickenOp(3, 'both')).not.toHaveProperty('suppressed')
  })

  it('round-trips through the schema preserving the op unchanged', () => {
    const op = buildThickenOp(4.2, 'inward')
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toEqual(op)
  })

  it('the schema still rejects a zero distance (refine guard intact)', () => {
    // Not a path the dialog can reach (Apply is gated on a positive value), but
    // pins the schema invariant the builder relies on for honesty.
    expect(() =>
      kernelPostSolidOpSchema.parse({ kind: 'thicken_offset', distanceMm: 0, side: 'outward' })
    ).toThrow()
  })
})
