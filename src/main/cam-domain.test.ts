import { describe, expect, it, vi } from 'vitest'

vi.mock('./cam-runner', () => ({
  runCamPipeline: vi.fn()
}))

import { runCamPipeline } from './cam-runner'
import { runCamDomain } from './cam-domain'

describe('runCamDomain', () => {
  it('returns successful pipeline results that match the IPC contract', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue({
      ok: true,
      gcode: 'G21\nM30',
      usedEngine: 'builtin',
      engine: {
        requestedEngine: 'builtin',
        usedEngine: 'builtin',
        fallbackApplied: false
      }
    })
    const result = await runCamDomain({
      stlPath: '/tmp/in.stl',
      outputGcodePath: '/tmp/out.nc',
      machine: {
        id: 'm1',
        name: 'Test',
        kind: 'cnc',
        workAreaMm: { x: 100, y: 100, z: 100 },
        maxFeedMmMin: 1000,
        postTemplate: 'cnc_generic_mm.hbs',
        dialect: 'generic_mm'
      },
      resourcesRoot: '/resources',
      appRoot: '/app',
      zPassMm: 1,
      stepoverMm: 0.5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5,
      pythonPath: 'python'
    })
    expect(result.ok).toBe(true)
  })

  it('converts contract-violating output into a failure result', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue({
      ok: true,
      gcode: 'G21\nM30',
      usedEngine: 'builtin',
      // Intentional bad shape for engine to prove boundary protection.
      engine: {} as never
    })
    const result = await runCamDomain({
      stlPath: '/tmp/in.stl',
      outputGcodePath: '/tmp/out.nc',
      machine: {
        id: 'm1',
        name: 'Test',
        kind: 'cnc',
        workAreaMm: { x: 100, y: 100, z: 100 },
        maxFeedMmMin: 1000,
        postTemplate: 'cnc_generic_mm.hbs',
        dialect: 'generic_mm'
      },
      resourcesRoot: '/resources',
      appRoot: '/app',
      zPassMm: 1,
      stepoverMm: 0.5,
      feedMmMin: 800,
      plungeMmMin: 200,
      safeZMm: 5,
      pythonPath: 'python'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('CAM engine adapter contract violation.')
    }
  })
})
