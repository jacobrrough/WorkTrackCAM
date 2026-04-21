import { describe, expect, it } from 'vitest'
import { camRunPayloadSchema, camRunResultSchema } from './cam-ipc-contract'

describe('cam-ipc-contract', () => {
  it('accepts a valid cam:run payload', () => {
    const parsed = camRunPayloadSchema.safeParse({
      stlPath: '/tmp/in.stl',
      outPath: '/tmp/out.nc',
      machineId: 'machine-1',
      zPassMm: 1,
      stepoverMm: 0.5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 10,
      pythonPath: '/usr/bin/python'
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an invalid workCoordinateIndex', () => {
    const parsed = camRunPayloadSchema.safeParse({
      stlPath: '/tmp/in.stl',
      outPath: '/tmp/out.nc',
      machineId: 'machine-1',
      zPassMm: 1,
      stepoverMm: 0.5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 10,
      pythonPath: '/usr/bin/python',
      workCoordinateIndex: 9
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts success and failure result shapes', () => {
    const ok = camRunResultSchema.safeParse({
      ok: true,
      gcode: 'G21\nM30',
      usedEngine: 'ocl',
      engine: {
        requestedEngine: 'ocl',
        usedEngine: 'ocl',
        fallbackApplied: false
      }
    })
    const fail = camRunResultSchema.safeParse({
      ok: false,
      error: 'bad input'
    })
    expect(ok.success).toBe(true)
    expect(fail.success).toBe(true)
  })
})
