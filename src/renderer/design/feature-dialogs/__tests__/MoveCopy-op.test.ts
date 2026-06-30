/**
 * Tier-1 · Pure op-builder test for `buildMoveCopyOp` (`transform_translate`).
 *
 * The load-bearing contract: a dialog must NEVER emit a kernel op the schema
 * would reject, because the op is persisted into `part/features.json`
 * `kernelOps[]` and replayed by a Build STEP (CLAUDE.md Safety Rule 1 — bad
 * kernel output ruins parts). So every builder output is round-tripped through
 * the REAL `kernelPostSolidOpSchema`. Pure function → runs in the node env with
 * no rendering.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildMoveCopyOp } from '../MoveCopyDialog'

describe('buildMoveCopyOp emits a schema-valid transform_translate op', () => {
  it('builds a MOVE op (keepOriginal:false) from a signed vector', () => {
    const op = buildMoveCopyOp(10, -5, 2.5, 'move')
    expect(op).toEqual({
      kind: 'transform_translate',
      dxMm: 10,
      dyMm: -5,
      dzMm: 2.5,
      keepOriginal: false
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('builds a COPY op (keepOriginal:true)', () => {
    const op = buildMoveCopyOp(0, 0, 12, 'copy')
    expect(op).toEqual({
      kind: 'transform_translate',
      dxMm: 0,
      dyMm: 0,
      dzMm: 12,
      keepOriginal: true
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts a zero vector (a legal no-op / in-place copy)', () => {
    const op = buildMoveCopyOp(0, 0, 0, 'copy')
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('round-trips negative components on every axis', () => {
    const op = buildMoveCopyOp(-3.1, -7, -0.25, 'move')
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toMatchObject({
      kind: 'transform_translate',
      dxMm: -3.1,
      dyMm: -7,
      dzMm: -0.25,
      keepOriginal: false
    })
  })
})
