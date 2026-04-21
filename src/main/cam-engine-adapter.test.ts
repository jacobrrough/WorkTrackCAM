import { describe, expect, it } from 'vitest'
import { normalizeCamRunToEngineResult } from './cam-engine-adapter'

describe('normalizeCamRunToEngineResult', () => {
  it('maps successful CAM output to canonical engine success shape', () => {
    const normalized = normalizeCamRunToEngineResult({
      ok: true,
      gcode: 'G21\nM30',
      usedEngine: 'advanced',
      engine: {
        requestedEngine: 'advanced',
        usedEngine: 'advanced',
        fallbackApplied: false
      },
      warnings: ['spindle clamped']
    })
    expect(normalized.ok).toBe(true)
    if (normalized.ok) {
      expect(normalized.engineId).toBe('advanced')
      expect(normalized.postedGcode).toContain('M30')
      expect(normalized.warnings).toHaveLength(1)
    }
  })

  it('maps failed CAM output to canonical engine failure shape', () => {
    const normalized = normalizeCamRunToEngineResult({
      ok: false,
      error: 'invalid mesh',
      hint: 'binary STL required'
    })
    expect(normalized.ok).toBe(false)
    if (!normalized.ok) {
      expect(normalized.failure.code).toBe('cam_run_failed')
      expect(normalized.failure.message).toContain('invalid mesh')
      expect(normalized.failure.detail).toContain('binary STL')
    }
  })
})
