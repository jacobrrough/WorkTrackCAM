import { describe, expect, it } from 'vitest'
import { estimateFeedMmMinFromTool } from './tool-feed-hint'

describe('estimateFeedMmMinFromTool', () => {
  it('returns undefined without surface speed', () => {
    expect(estimateFeedMmMinFromTool({ id: '1', name: 'x', type: 'endmill', diameterMm: 6 })).toBeUndefined()
  })

  it('returns undefined without chipload', () => {
    expect(
      estimateFeedMmMinFromTool({ id: '1', name: 'x', type: 'endmill', diameterMm: 6, surfaceSpeedMMin: 100 })
    ).toBeUndefined()
  })

  it('computes feed from typical inputs', () => {
    const v = estimateFeedMmMinFromTool({
      id: '1',
      name: 'x',
      type: 'endmill',
      diameterMm: 6,
      surfaceSpeedMMin: 100,
      chiploadMm: 0.05,
      fluteCount: 2
    })
    expect(v).toBeGreaterThan(100)
  })

  it('matches RPM × fluteCount × chipload formula', () => {
    // rpm = (100 * 1000) / (Math.PI * 6) ≈ 5305.16
    // feed = 5305.16 * 2 * 0.05 ≈ 530.5 → rounded to 1 decimal
    const v = estimateFeedMmMinFromTool({
      id: '1', name: 'x', type: 'endmill',
      diameterMm: 6, surfaceSpeedMMin: 100, chiploadMm: 0.05, fluteCount: 2
    })
    const rpm = (100 * 1000) / (Math.PI * 6)
    const expected = Math.round(rpm * 2 * 0.05 * 10) / 10
    expect(v).toBeCloseTo(expected, 1)
  })

  it('falls back to fluteCount=1 when fluteCount is 0 or missing', () => {
    const base = { id: '1', name: 'x', type: 'endmill' as const, diameterMm: 6, surfaceSpeedMMin: 100, chiploadMm: 0.05 }
    const with0 = estimateFeedMmMinFromTool({ ...base, fluteCount: 0 })
    const withMissing = estimateFeedMmMinFromTool(base)
    // Both should produce the same result (1-flute fallback)
    expect(with0).toBeDefined()
    expect(withMissing).toBeDefined()
    expect(with0).toBeCloseTo(withMissing!, 5)
    // 1-flute feed should be roughly half the 2-flute feed (both independently rounded)
    const with2 = estimateFeedMmMinFromTool({ ...base, fluteCount: 2 })!
    // Ratio should be close to 0.5 (within 1% rounding error from independent rounding)
    expect(with0! / with2).toBeCloseTo(0.5, 1)
  })

  it('returns undefined for non-positive diameter', () => {
    const base = { id: '1', name: 'x', type: 'endmill' as const, surfaceSpeedMMin: 100, chiploadMm: 0.05 }
    expect(estimateFeedMmMinFromTool({ ...base, diameterMm: 0 })).toBeUndefined()
    expect(estimateFeedMmMinFromTool({ ...base, diameterMm: -3 })).toBeUndefined()
  })

  it('returns undefined for non-finite diameter', () => {
    const base = { id: '1', name: 'x', type: 'endmill' as const, surfaceSpeedMMin: 100, chiploadMm: 0.05 }
    expect(estimateFeedMmMinFromTool({ ...base, diameterMm: NaN })).toBeUndefined()
    expect(estimateFeedMmMinFromTool({ ...base, diameterMm: Infinity })).toBeUndefined()
  })

  it('four-flute produces 2× the feed of two-flute (same other params)', () => {
    const base = { id: '1', name: 'x', type: 'endmill' as const, diameterMm: 6, surfaceSpeedMMin: 100, chiploadMm: 0.05 }
    const f2 = estimateFeedMmMinFromTool({ ...base, fluteCount: 2 })!
    const f4 = estimateFeedMmMinFromTool({ ...base, fluteCount: 4 })!
    expect(f4).toBeCloseTo(f2 * 2, 0)
  })
})
