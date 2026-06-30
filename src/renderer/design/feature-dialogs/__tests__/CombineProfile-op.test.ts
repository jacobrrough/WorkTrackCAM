/**
 * Pure op-builder test for `buildCombineProfileOp`.
 *
 * The load-bearing contract (CLAUDE.md Safety Rule 1): a dialog must NEVER emit a kernel op the
 * schema would reject — the op is persisted into `part/features.json` `kernelOps[]` and replayed by a
 * Build STEP. So the builder's output is round-tripped through the REAL `kernelPostSolidOpSchema`
 * here. Pure function, no React/DOM → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildCombineProfileOp } from '../CombineProfileDialog'

describe('buildCombineProfileOp emits a schema-valid boolean_combine_profile op', () => {
  it('builds the exact canonical op and OMITS extrudeDirection when not chosen', () => {
    const op = buildCombineProfileOp({
      mode: 'subtract',
      profileIndex: 1,
      extrudeDepthMm: 8,
      zStartMm: 2
    })
    expect(op).toEqual({
      kind: 'boolean_combine_profile',
      mode: 'subtract',
      profileIndex: 1,
      extrudeDepthMm: 8,
      zStartMm: 2
    })
    // Never invents the optional direction or a suppressed flag — absence is meaningful.
    expect(op).not.toHaveProperty('extrudeDirection')
    expect(op).not.toHaveProperty('suppressed')
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('round-trips through the real schema (parse returns the same op)', () => {
    const op = buildCombineProfileOp({
      mode: 'union',
      profileIndex: 0,
      extrudeDepthMm: 5,
      zStartMm: 0
    })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toEqual(op)
  })

  it('includes extrudeDirection (+Z / −Z) when explicitly chosen', () => {
    const up = buildCombineProfileOp({
      mode: 'intersect',
      profileIndex: 2,
      extrudeDepthMm: 3.5,
      zStartMm: -1,
      extrudeDirection: '+Z'
    })
    expect(up).toEqual({
      kind: 'boolean_combine_profile',
      mode: 'intersect',
      profileIndex: 2,
      extrudeDepthMm: 3.5,
      zStartMm: -1,
      extrudeDirection: '+Z'
    })
    expect(() => kernelPostSolidOpSchema.parse(up)).not.toThrow()

    const down = buildCombineProfileOp({
      mode: 'union',
      profileIndex: 0,
      extrudeDepthMm: 10,
      zStartMm: 0,
      extrudeDirection: '-Z'
    })
    expect(down.kind === 'boolean_combine_profile' && down.extrudeDirection).toBe('-Z')
    expect(() => kernelPostSolidOpSchema.parse(down)).not.toThrow()
  })

  it('accepts every mode the schema enum allows', () => {
    for (const mode of ['union', 'subtract', 'intersect'] as const) {
      const op = buildCombineProfileOp({ mode, profileIndex: 0, extrudeDepthMm: 4, zStartMm: 0 })
      expect(op.kind === 'boolean_combine_profile' && op.mode).toBe(mode)
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    }
  })

  it('produces an op the schema REJECTS for a non-positive extrude depth (mmPos guard)', () => {
    // The builder shapes whatever it is given; the dialog gates this before calling it.
    // Asserting the schema catches it proves the dialog's gate is the right one.
    const bad = buildCombineProfileOp({ mode: 'union', profileIndex: 0, extrudeDepthMm: 0, zStartMm: 0 })
    expect(() => kernelPostSolidOpSchema.parse(bad)).toThrow()
  })

  it('produces an op the schema REJECTS for an out-of-range profileIndex', () => {
    const bad = buildCombineProfileOp({ mode: 'union', profileIndex: 256, extrudeDepthMm: 4, zStartMm: 0 })
    expect(() => kernelPostSolidOpSchema.parse(bad)).toThrow()
  })
})
