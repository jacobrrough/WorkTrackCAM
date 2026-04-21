import { describe, expect, it, vi } from 'vitest'

vi.mock('./post-process', () => ({
  renderPost: vi.fn().mockResolvedValue({ gcode: 'G21\nM30', warnings: [] })
}))

import { runPostDomain } from './post-domain'

describe('runPostDomain', () => {
  it('delegates post generation through the post domain facade', async () => {
    const result = await runPostDomain({
      resourcesRoot: '/resources',
      machine: {
        id: 'm1',
        name: 'Test',
        kind: 'cnc',
        workAreaMm: { x: 100, y: 100, z: 100 },
        maxFeedMmMin: 1000,
        postTemplate: 'cnc_generic_mm.hbs',
        dialect: 'generic_mm'
      },
      toolpathLines: ['G0 X0 Y0', 'G1 X10 Y0 F500']
    })
    expect(result.gcode).toContain('M30')
  })
})
