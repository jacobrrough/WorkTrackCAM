import { describe, expect, it, vi } from 'vitest'
import { withCamStageTelemetry } from './cam-runtime-telemetry'

describe('withCamStageTelemetry', () => {
  it('emits successful stage events', async () => {
    const sink = vi.fn()
    const result = await withCamStageTelemetry('stage.a', async () => 42, sink)
    expect(result).toBe(42)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'stage.a',
        ok: true
      })
    )
  })

  it('emits failed stage events and rethrows', async () => {
    const sink = vi.fn()
    await expect(
      withCamStageTelemetry(
        'stage.b',
        async () => {
          throw new Error('boom')
        },
        sink
      )
    ).rejects.toThrow('boom')
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'stage.b',
        ok: false
      })
    )
  })
})
