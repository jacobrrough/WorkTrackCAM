import { describe, expect, it } from 'vitest'
import { camEngineRequestSchema, camEngineResultSchema } from './cam-engine-contract'

describe('cam-engine-contract', () => {
  it('accepts valid engine requests', () => {
    const parsed = camEngineRequestSchema.safeParse({
      stlPath: '/tmp/model.stl',
      operationKind: 'cnc_adaptive',
      toolDiameterMm: 6,
      feedMmMin: 1200,
      plungeMmMin: 400,
      stepoverMm: 1.5,
      zPassMm: 1.2
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects invalid numeric request fields', () => {
    const parsed = camEngineRequestSchema.safeParse({
      stlPath: '/tmp/model.stl',
      feedMmMin: -10,
      plungeMmMin: 400,
      stepoverMm: 1.5,
      zPassMm: 1.2
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts both success and failure result unions', () => {
    const ok = camEngineResultSchema.safeParse({
      ok: true,
      engineId: 'ocl',
      postedGcode: 'G21\nM30'
    })
    const fail = camEngineResultSchema.safeParse({
      ok: false,
      engineId: 'builtin',
      failure: {
        code: 'bad_stl',
        message: 'Could not parse STL'
      }
    })
    expect(ok.success).toBe(true)
    expect(fail.success).toBe(true)
  })
})
