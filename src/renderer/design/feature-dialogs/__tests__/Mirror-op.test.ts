/**
 * Pure op-builder test for the Mirror dialog.
 *
 * The contract that matters most: `buildMirrorOp` must NEVER emit a kernel op
 * the schema would reject, because it gets persisted into `part/features.json`
 * `kernelOps[]` and replayed by a Build STEP (CLAUDE.md Safety Rule 1 — bad
 * kernel ops ruin parts). So every output is round-tripped through the REAL
 * `kernelPostSolidOpSchema`. Pure function → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildMirrorOp, type MirrorPlane } from '../MirrorDialog'

const PLANES: readonly MirrorPlane[] = ['YZ', 'XZ', 'XY']

describe('buildMirrorOp emits a schema-valid mirror_union_plane op', () => {
  it('builds the exact op for the chosen plane + all three origins', () => {
    const op = buildMirrorOp('YZ', 5, -12.5, 0)
    expect(op).toEqual({
      kind: 'mirror_union_plane',
      plane: 'YZ',
      originXMm: 5,
      originYMm: -12.5,
      originZMm: 0
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('accepts every mirror plane', () => {
    for (const plane of PLANES) {
      const op = buildMirrorOp(plane, 0, 0, 0)
      expect(op.kind).toBe('mirror_union_plane')
      expect(op).toMatchObject({ plane })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    }
  })

  it('accepts zero and negative origins (signed mm coordinates)', () => {
    const op = buildMirrorOp('XY', -7.25, 0, -0.5)
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    // The schema round-trip preserves the exact origins the dialog emitted.
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toMatchObject({
      kind: 'mirror_union_plane',
      plane: 'XY',
      originXMm: -7.25,
      originYMm: 0,
      originZMm: -0.5
    })
  })
})
