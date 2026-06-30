/**
 * Tier-1 · Pure op-builder test for `buildRectangularPatternOp`.
 *
 * The contract this carries: the builder must NEVER emit an op the REAL
 * `kernelPostSolidOpSchema` would reject, because that op is persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP (CLAUDE.md
 * Safety Rule 1 — bad kernel ops ruin parts). So every builder output is
 * round-tripped through the actual schema here.
 *
 * Pure function (no React, no DOM) → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildRectangularPatternOp } from '../RectangularPatternDialog'

describe('buildRectangularPatternOp emits a schema-valid pattern_rectangular op', () => {
  it('builds the exact canonical op for a 2D grid', () => {
    const op = buildRectangularPatternOp({
      countX: 3,
      countY: 4,
      spacingXMm: 12.5,
      spacingYMm: 8
    })
    expect(op).toEqual({
      kind: 'pattern_rectangular',
      countX: 3,
      countY: 4,
      spacingXMm: 12.5,
      spacingYMm: 8
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts a single-axis pattern (countY = 1) — the refine needs only one axis > 1', () => {
    const op = buildRectangularPatternOp({
      countX: 5,
      countY: 1,
      spacingXMm: 20,
      spacingYMm: 20
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts a signed (negative) spacing — mm is finite, not positive', () => {
    const op = buildRectangularPatternOp({
      countX: 4,
      countY: 1,
      spacingXMm: -15,
      spacingYMm: 0
    })
    expect(op.kind).toBe('pattern_rectangular')
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts the schema bounds (count up to 32)', () => {
    const op = buildRectangularPatternOp({
      countX: 32,
      countY: 32,
      spacingXMm: 1,
      spacingYMm: 1
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('round-trips through the schema preserving every field', () => {
    const op = buildRectangularPatternOp({
      countX: 2,
      countY: 3,
      spacingXMm: 10,
      spacingYMm: 25
    })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toEqual(op)
  })

  it('produces an op the schema REJECTS when it is a 1×1 no-op (refine guard)', () => {
    // The dialog gates this out before calling the builder, but proving the
    // schema rejects 1×1 documents WHY that gate exists.
    const op = buildRectangularPatternOp({
      countX: 1,
      countY: 1,
      spacingXMm: 20,
      spacingYMm: 20
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).toThrow()
  })
})
