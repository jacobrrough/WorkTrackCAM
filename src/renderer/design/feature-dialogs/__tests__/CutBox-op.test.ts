/**
 * Pure op-builder test for the Cut Box dialog.
 *
 * The contract that matters: `buildCutBoxOp` must NEVER emit a kernel op the
 * schema would reject, because that op gets persisted into `part/features.json`
 * `kernelOps[]` and replayed by a Build STEP (CLAUDE.md Safety Rule 1). So the
 * builder's output is round-tripped through the REAL `kernelPostSolidOpSchema`
 * here. Pure function (no React/DOM) — runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildCutBoxOp } from '../CutBoxDialog'

describe('buildCutBoxOp emits a schema-valid boolean_subtract_box op', () => {
  it('builds the exact boolean_subtract_box op from six extents', () => {
    const op = buildCutBoxOp({
      xMinMm: 2,
      xMaxMm: 8,
      yMinMm: -5,
      yMaxMm: 5,
      zMinMm: 0,
      zMaxMm: 3.5
    })
    expect(op).toEqual({
      kind: 'boolean_subtract_box',
      xMinMm: 2,
      xMaxMm: 8,
      yMinMm: -5,
      yMaxMm: 5,
      zMinMm: 0,
      zMaxMm: 3.5
    })
    // No optional fields leak in (the dialog never sets `suppressed`).
    expect(op).not.toHaveProperty('suppressed')
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('round-trips through the schema with negative extents (any finite mm)', () => {
    const op = buildCutBoxOp({
      xMinMm: -10,
      xMaxMm: -1,
      yMinMm: -10,
      yMaxMm: -1,
      zMinMm: -10,
      zMaxMm: -1
    })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toEqual(op)
  })

  it('the schema REJECTS a non-increasing axis (proves the gate is real)', () => {
    // The dialog gates this out before calling the builder, but assert the schema
    // would reject it so the dialog's validity gate is provably necessary.
    const bad = buildCutBoxOp({
      xMinMm: 4,
      xMaxMm: 4, // equal → refine fails
      yMinMm: 0,
      yMaxMm: 10,
      zMinMm: 0,
      zMaxMm: 10
    })
    expect(() => kernelPostSolidOpSchema.parse(bad)).toThrow()
  })
})
