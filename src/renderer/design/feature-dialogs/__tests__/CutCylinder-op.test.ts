/**
 * Pure op-builder test for `buildCutCylinderOp`.
 *
 * The load-bearing contract (CLAUDE.md Safety Rule 1): a dialog must NEVER emit a
 * kernel op the schema would reject — the op is persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP. So the
 * builder's output is round-tripped through the REAL `kernelPostSolidOpSchema`
 * here. Pure function, no React/DOM → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildCutCylinderOp } from '../CutCylinderDialog'

describe('buildCutCylinderOp emits a schema-valid boolean_subtract_cylinder op', () => {
  it('builds the exact canonical op from valid params', () => {
    const op = buildCutCylinderOp({
      centerXMm: 12.5,
      centerYMm: -4,
      radiusMm: 3.25,
      zMinMm: 1,
      zMaxMm: 8
    })
    expect(op).toEqual({
      kind: 'boolean_subtract_cylinder',
      centerXMm: 12.5,
      centerYMm: -4,
      radiusMm: 3.25,
      zMinMm: 1,
      zMaxMm: 8
    })
    // Never invents a suppressed flag — absence means "active".
    expect(op).not.toHaveProperty('suppressed')
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('round-trips through the real schema (parse returns the same op)', () => {
    const op = buildCutCylinderOp({
      centerXMm: 0,
      centerYMm: 0,
      radiusMm: 5,
      zMinMm: 0,
      zMaxMm: 10
    })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toEqual(op)
  })

  it('accepts signed centers and a signed Z span as long as zMax > zMin', () => {
    const op = buildCutCylinderOp({
      centerXMm: -150,
      centerYMm: 75,
      radiusMm: 2,
      zMinMm: -10,
      zMaxMm: -2
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('produces an op the schema REJECTS when the span is non-increasing (refine guard)', () => {
    // The builder shapes whatever it is given; the dialog gates this case before
    // calling it. Asserting the schema catches it proves the gate is the right one.
    const bad = buildCutCylinderOp({
      centerXMm: 0,
      centerYMm: 0,
      radiusMm: 5,
      zMinMm: 10,
      zMaxMm: 10
    })
    expect(() => kernelPostSolidOpSchema.parse(bad)).toThrow()
  })

  it('produces an op the schema REJECTS for a non-positive radius', () => {
    const bad = buildCutCylinderOp({
      centerXMm: 0,
      centerYMm: 0,
      radiusMm: 0,
      zMinMm: 0,
      zMaxMm: 10
    })
    expect(() => kernelPostSolidOpSchema.parse(bad)).toThrow()
  })
})
