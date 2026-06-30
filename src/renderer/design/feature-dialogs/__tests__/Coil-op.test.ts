/**
 * Pure op-builder test for `buildCoilOp`.
 *
 * The contract that matters most: a dialog must NEVER emit a kernel op the schema
 * would reject, because the op is persisted into `part/features.json`
 * `kernelOps[]` and replayed by a Build STEP (CLAUDE.md Safety Rule 1 — a bad
 * kernel op ruins parts). So the builder's output is round-tripped through the
 * REAL `kernelPostSolidOpSchema` here. Pure function, no React/DOM → runs in the
 * node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildCoilOp, COIL_MAX_TURNS } from '../CoilDialog'

const validParams = {
  centerXMm: 3,
  centerYMm: -4,
  majorRadiusMm: 12.5,
  pitchMm: 2.5,
  turns: 8,
  depthMm: 1.5,
  zStartMm: 6
} as const

describe('buildCoilOp emits a schema-valid coil_cut op', () => {
  it('builds the exact typed coil_cut op for the given params', () => {
    const op = buildCoilOp(validParams)
    expect(op).toEqual({
      kind: 'coil_cut',
      centerXMm: 3,
      centerYMm: -4,
      majorRadiusMm: 12.5,
      pitchMm: 2.5,
      turns: 8,
      depthMm: 1.5,
      zStartMm: 6
    })
  })

  it('round-trips through the real kernelPostSolidOpSchema', () => {
    const op = buildCoilOp(validParams)
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    // The parsed value is identical (no coercion / defaults rewrote our fields).
    expect(kernelPostSolidOpSchema.parse(op)).toEqual(op)
  })

  it('accepts a zero / negative centre and a zero Z start (signed mm params)', () => {
    const op = buildCoilOp({ ...validParams, centerXMm: 0, centerYMm: -10, zStartMm: 0 })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts the maximum allowed turn count (schema cap = 100)', () => {
    const op = buildCoilOp({ ...validParams, turns: COIL_MAX_TURNS })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('the schema REJECTS turns above the cap (proves the dialog must gate it)', () => {
    const op = buildCoilOp({ ...validParams, turns: COIL_MAX_TURNS + 1 })
    expect(() => kernelPostSolidOpSchema.parse(op)).toThrow()
  })

  it('the schema REJECTS a non-positive major radius (proves the dialog must gate it)', () => {
    const op = buildCoilOp({ ...validParams, majorRadiusMm: 0 })
    expect(() => kernelPostSolidOpSchema.parse(op)).toThrow()
  })
})
