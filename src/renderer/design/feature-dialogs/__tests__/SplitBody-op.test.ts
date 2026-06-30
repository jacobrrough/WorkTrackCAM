/**
 * Pure op-builder test for the Split Body dialog.
 *
 * The load-bearing contract (CLAUDE.md Safety Rule 1): a dialog must NEVER emit a
 * kernel op the schema would reject, because it is persisted into
 * `part/features.json` `kernelOps[]` and replayed by Build STEP. So
 * `buildSplitBodyOp(...)` is round-tripped through the REAL
 * `kernelPostSolidOpSchema`. Pure (no React/DOM) → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildSplitBodyOp } from '../SplitBodyDialog'

describe('buildSplitBodyOp', () => {
  it('builds the exact split_keep_halfspace op and the schema accepts it', () => {
    const op = buildSplitBodyOp('X', 12.5, 'negative')
    expect(op).toEqual({
      kind: 'split_keep_halfspace',
      axis: 'X',
      offsetMm: 12.5,
      keep: 'negative'
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts every axis × keep combination, including a zero offset', () => {
    for (const axis of ['X', 'Y', 'Z'] as const) {
      for (const keep of ['positive', 'negative'] as const) {
        const op = buildSplitBodyOp(axis, 0, keep)
        expect(op).toEqual({ kind: 'split_keep_halfspace', axis, offsetMm: 0, keep })
        expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      }
    }
  })

  it('accepts a negative offset (the plane offset is a signed finite mm)', () => {
    const op = buildSplitBodyOp('Z', -4.25, 'positive')
    expect(op).toMatchObject({ axis: 'Z', offsetMm: -4.25, keep: 'positive' })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('never sets the suppressed persistence flag', () => {
    expect(buildSplitBodyOp('Y', 3, 'negative')).not.toHaveProperty('suppressed')
  })
})
