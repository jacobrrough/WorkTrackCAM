import { describe, expect, it, vi } from 'vitest'

vi.mock('./post-process', () => ({
  renderPost: vi.fn().mockResolvedValue({ gcode: 'G21\nM30', warnings: [] })
}))

import { renderPost } from './post-process'
import { runPostDomain } from './post-domain'
import type { LagunaVacuumZoneAllocation } from '../shared/laguna-vacuum-allocator'

const baseMachine = {
  id: 'm1',
  name: 'Test',
  kind: 'cnc' as const,
  workAreaMm: { x: 100, y: 100, z: 100 },
  maxFeedMmMin: 1000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'generic_mm' as const,
}

describe('runPostDomain', () => {
  it('delegates post generation through the post domain facade', async () => {
    const result = await runPostDomain({
      resourcesRoot: '/resources',
      machine: baseMachine,
      toolpathLines: ['G0 X0 Y0', 'G1 X10 Y0 F500']
    })
    expect(result.gcode).toContain('M30')
  })

  it('forwards Laguna vacuumZoneAllocation + vacuumOptions verbatim to renderPost [ID-0020-wire]', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    // Synthetic Laguna allocation: shape matches the real allocator.
    // The facade must not mutate or re-key any field; it is a strict
    // pass-through of the opts object.
    const allocation: LagunaVacuumZoneAllocation = {
      engaged: ['X0Y0', 'X1Y0'],
      idle: ['X0Y1', 'X0Y2', 'X1Y1', 'X1Y2'],
      engagedCount: 2,
      totalOverlapMm2: 1000,
      bedCoverageFraction: 0.16,
      fullBedEngaged: false,
      outsideEnvelope: false,
      zones: [],
    }
    await runPostDomain({
      resourcesRoot: '/resources',
      machine: baseMachine,
      toolpathLines: ['G0 X0 Y0', 'G1 X10 Y0 F500'],
      opts: {
        vacuumZoneAllocation: allocation,
        vacuumOptions: { enableMach3DigitalOutputs: true },
      },
    })
    expect(renderPostMock).toHaveBeenCalledTimes(1)
    const passedOpts = renderPostMock.mock.calls[0]?.[3]
    expect(passedOpts?.vacuumZoneAllocation).toBe(allocation)
    expect(passedOpts?.vacuumOptions).toEqual({ enableMach3DigitalOutputs: true })
  })

  it('omits vacuum opts when caller omits them (no implicit default)', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    await runPostDomain({
      resourcesRoot: '/resources',
      machine: baseMachine,
      toolpathLines: ['G0 X0 Y0', 'G1 X10 Y0 F500'],
      opts: { spindleRpm: 12000 },
    })
    expect(renderPostMock).toHaveBeenCalledTimes(1)
    const passedOpts = renderPostMock.mock.calls[0]?.[3]
    expect(passedOpts?.vacuumZoneAllocation).toBeUndefined()
    expect(passedOpts?.vacuumOptions).toBeUndefined()
    // Sanity: the unrelated opt still passes through.
    expect(passedOpts?.spindleRpm).toBe(12000)
  })
})
