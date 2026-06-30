/** buildSweepOp emits a schema-valid sweep_profile_path_true op (round-trips kernelPostSolidOpSchema). */
import { describe, expect, it } from 'vitest'
import { buildSweepOp } from '../SweepDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

const PATH: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10]
]

describe('buildSweepOp', () => {
  it('returns the exact frenet sweep op (no fixedNormal) and the schema accepts it', () => {
    const op = buildSweepOp({
      profileIndex: 1,
      pathPoints: PATH,
      zStartMm: 2,
      orientationMode: 'frenet'
    })
    expect(op).toEqual({
      kind: 'sweep_profile_path_true',
      profileIndex: 1,
      pathPoints: PATH,
      zStartMm: 2,
      orientationMode: 'frenet'
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('includes fixedNormal in fixed_normal mode and round-trips the schema', () => {
    const op = buildSweepOp({
      profileIndex: 0,
      pathPoints: PATH,
      zStartMm: 0,
      orientationMode: 'fixed_normal',
      fixedNormal: [1, 0, 0]
    })
    expect(op).toEqual({
      kind: 'sweep_profile_path_true',
      profileIndex: 0,
      pathPoints: PATH,
      zStartMm: 0,
      orientationMode: 'fixed_normal',
      fixedNormal: [1, 0, 0]
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('omits fixedNormal when the mode is not fixed_normal even if a vector is passed', () => {
    const op = buildSweepOp({
      profileIndex: 0,
      pathPoints: PATH,
      zStartMm: 0,
      orientationMode: 'path_tangent_lock',
      fixedNormal: [1, 0, 0]
    })
    expect(op).not.toHaveProperty('fixedNormal')
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('produces a value the schema parses back to the same shape', () => {
    const parsed = kernelPostSolidOpSchema.parse(
      buildSweepOp({ profileIndex: 3, pathPoints: PATH, zStartMm: 0, orientationMode: 'frenet' })
    )
    expect(parsed).toMatchObject({
      kind: 'sweep_profile_path_true',
      profileIndex: 3,
      orientationMode: 'frenet'
    })
  })
})
