/** buildPipeOp emits a schema-valid pipe_path op (round-trips kernelPostSolidOpSchema). */
import { describe, expect, it } from 'vitest'
import { buildPipeOp } from '../PipeDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

const PATH: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10]
]

describe('buildPipeOp', () => {
  it('returns the exact solid-rod op (no wall) and the schema accepts it', () => {
    const op = buildPipeOp(PATH, 5, 2, 'frenet', null)
    expect(op).toEqual({
      kind: 'pipe_path',
      pathPoints: PATH,
      outerRadiusMm: 5,
      zStartMm: 2,
      orientationMode: 'frenet'
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('includes wallThicknessMm for a hollow tube and round-trips the schema', () => {
    const op = buildPipeOp(PATH, 5, 0, 'path_tangent_lock', 1.5)
    expect(op).toEqual({
      kind: 'pipe_path',
      pathPoints: PATH,
      outerRadiusMm: 5,
      zStartMm: 0,
      orientationMode: 'path_tangent_lock',
      wallThicknessMm: 1.5
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('produces a value the schema parses back to the same shape', () => {
    const parsed = kernelPostSolidOpSchema.parse(buildPipeOp(PATH, 8, 0, 'frenet', null))
    expect(parsed).toMatchObject({ kind: 'pipe_path', outerRadiusMm: 8, orientationMode: 'frenet' })
  })
})
