/** buildPatternPathOp emits a schema-valid pattern_path op (round-trips kernelPostSolidOpSchema). */
import { describe, expect, it } from 'vitest'
import { buildPatternPathOp } from '../PatternPathDialog'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'

describe('buildPatternPathOp', () => {
  it('returns the exact path op and the schema accepts it', () => {
    const op = buildPatternPathOp(6, [[0, 0], [20, 0], [20, 20], [0, 20]], true, true)
    expect(op).toEqual({
      kind: 'pattern_path',
      count: 6,
      pathPoints: [[0, 0], [20, 0], [20, 20], [0, 20]],
      closedPath: true,
      alignToPathTangent: true
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('omits the optional flags when false and the schema still accepts it', () => {
    const op = buildPatternPathOp(2, [[0, 0], [40, 0]], false, false)
    expect(op).toEqual({ kind: 'pattern_path', count: 2, pathPoints: [[0, 0], [40, 0]] })
    expect('closedPath' in op).toBe(false)
    expect('alignToPathTangent' in op).toBe(false)
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })
})
