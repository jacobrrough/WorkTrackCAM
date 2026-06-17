import { describe, it, expect } from 'vitest'
import { computeFeedsAndSpeeds, chipLoadDiameterScale, type FeedsSpeedsMachineLimits } from './feeds-and-speeds'

// Machine envelopes mirroring the real shop profiles.
const LAGUNA: FeedsSpeedsMachineLimits = { maxFeedMmMin: 15000, minSpindleRpm: 6000, maxSpindleRpm: 24000 }
const CARVERA: FeedsSpeedsMachineLimits = { maxFeedMmMin: 2400, minSpindleRpm: 13000, maxSpindleRpm: 15000 }

describe('chipLoadDiameterScale', () => {
  it('halves below 3 mm, holds 3–12 mm, raises 1.5x above 12 mm', () => {
    expect(chipLoadDiameterScale(2)).toBe(0.5)
    expect(chipLoadDiameterScale(3)).toBe(1)
    expect(chipLoadDiameterScale(6)).toBe(1)
    expect(chipLoadDiameterScale(12)).toBe(1)
    expect(chipLoadDiameterScale(15)).toBe(1.5)
  })
})

describe('computeFeedsAndSpeeds — nominal, no clamp', () => {
  it('plywood + 6mm 2-flute on the Laguna lands a sane in-range RPM and feed', () => {
    const r = computeFeedsAndSpeeds({
      materialKey: 'plywood',
      toolType: 'endmill_2f',
      toolDiameterMm: 6,
      machine: LAGUNA
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // SS mid (120..350)=235 m/min → RPM = 235000/(π·6) ≈ 12467, inside 6000..24000.
    expect(r.spindleRpm).toBeGreaterThan(12000)
    expect(r.spindleRpm).toBeLessThan(13000)
    expect(r.rpmClamp).toBe('none')
    // feed = RPM · 2 flutes · chipload(mid 0.0625) ≈ 1558 mm/min, under the 15000 max.
    expect(r.feedMmMin).toBeGreaterThan(1450)
    expect(r.feedMmMin).toBeLessThan(1700)
    expect(r.feedClampedToMax).toBe(false)
    expect(r.fluteCount).toBe(2)
    expect(r.plungeMmMin).toBe(Math.round(r.feedMmMin * 0.4))
    expect(r.notes).toEqual([]) // no clamp, no diameter scaling
  })
})

describe('computeFeedsAndSpeeds — RPM clamps', () => {
  it('clamps DOWN to the Carvera spindle ceiling for a fast material + small tool', () => {
    const r = computeFeedsAndSpeeds({
      materialKey: 'aluminum_6061',
      toolType: 'endmill_2f',
      toolDiameterMm: 3,
      machine: CARVERA
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Ideal RPM ≈ 21220 >> 15000 ceiling.
    expect(r.rpmClamp).toBe('lowered_to_max')
    expect(r.spindleRpm).toBe(15000)
    // feed recomputed from the clamped RPM: 15000·2·0.05 = 1500, under the 2400 max.
    expect(r.feedMmMin).toBe(1500)
    expect(r.feedClampedToMax).toBe(false)
    expect(r.notes.join(' ')).toMatch(/exceeds the spindle max/)
  })

  it('clamps UP to the spindle floor for a slow material + large tool', () => {
    const r = computeFeedsAndSpeeds({
      materialKey: 'steel_mild',
      toolType: 'endmill_2f',
      toolDiameterMm: 12,
      machine: LAGUNA
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Ideal RPM ≈ 1061 < 6000 floor.
    expect(r.rpmClamp).toBe('raised_to_min')
    expect(r.spindleRpm).toBe(6000)
    // feed = 6000·2·0.025 = 300.
    expect(r.feedMmMin).toBe(300)
    expect(r.notes.join(' ')).toMatch(/below the spindle min/)
  })
})

describe('computeFeedsAndSpeeds — feed clamp', () => {
  it('clamps the cutting feed to the machine max and flags it', () => {
    const tinyFeed: FeedsSpeedsMachineLimits = { maxFeedMmMin: 200, minSpindleRpm: 6000, maxSpindleRpm: 24000 }
    const r = computeFeedsAndSpeeds({
      materialKey: 'aluminum_6061',
      toolType: 'endmill_4f',
      toolDiameterMm: 6,
      machine: tinyFeed,
      aggressiveness: 'aggressive'
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.feedClampedToMax).toBe(true)
    expect(r.feedMmMin).toBe(200)
    expect(r.plungeMmMin).toBe(80) // 200 · 0.4
    expect(r.notes.join(' ')).toMatch(/feed clamped to the machine max/i)
  })
})

describe('computeFeedsAndSpeeds — diameter scaling notes', () => {
  it('halves chip load + notes it for a sub-3mm tool', () => {
    const big = computeFeedsAndSpeeds({ materialKey: 'aluminum_6061', toolType: 'endmill_2f', toolDiameterMm: 6, machine: LAGUNA })
    const small = computeFeedsAndSpeeds({ materialKey: 'aluminum_6061', toolType: 'endmill_2f', toolDiameterMm: 1.5, machine: LAGUNA })
    expect(big.ok && small.ok).toBe(true)
    if (!big.ok || !small.ok) return
    expect(small.chipLoadMm).toBeCloseTo(big.chipLoadMm * 0.5, 6)
    expect(small.notes.join(' ')).toMatch(/×0\.5/)
  })

  it('raises chip load + notes it for an over-12mm tool', () => {
    const r = computeFeedsAndSpeeds({ materialKey: 'mdf', toolType: 'endmill_2f', toolDiameterMm: 15, machine: LAGUNA })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.notes.join(' ')).toMatch(/×1\.5/)
  })
})

describe('computeFeedsAndSpeeds — aggressiveness ordering', () => {
  it('conservative < nominal < aggressive for RPM and feed (unclamped)', () => {
    const mk = (a: 'conservative' | 'nominal' | 'aggressive') =>
      computeFeedsAndSpeeds({ materialKey: 'plywood', toolType: 'endmill_2f', toolDiameterMm: 6, machine: LAGUNA, aggressiveness: a })
    const c = mk('conservative')
    const n = mk('nominal')
    const a = mk('aggressive')
    expect(c.ok && n.ok && a.ok).toBe(true)
    if (!c.ok || !n.ok || !a.ok) return
    expect(c.spindleRpm).toBeLessThan(n.spindleRpm)
    expect(n.spindleRpm).toBeLessThan(a.spindleRpm)
    expect(c.feedMmMin).toBeLessThan(n.feedMmMin)
    expect(n.feedMmMin).toBeLessThan(a.feedMmMin)
  })
})

describe('computeFeedsAndSpeeds — plunge factor', () => {
  it('honors a custom plunge factor (clamped to [0.05,1])', () => {
    const base = { materialKey: 'plywood', toolType: 'endmill_2f' as const, toolDiameterMm: 6, machine: LAGUNA }
    const half = computeFeedsAndSpeeds({ ...base, plungeFactor: 0.5 })
    const overshoot = computeFeedsAndSpeeds({ ...base, plungeFactor: 5 })
    expect(half.ok && overshoot.ok).toBe(true)
    if (!half.ok || !overshoot.ok) return
    expect(half.plungeMmMin).toBe(Math.round(half.feedMmMin * 0.5))
    expect(overshoot.plungeMmMin).toBe(overshoot.feedMmMin) // factor clamped to 1
  })
})

describe('computeFeedsAndSpeeds — failure modes', () => {
  it('rejects a non-positive tool diameter', () => {
    const r = computeFeedsAndSpeeds({ materialKey: 'plywood', toolType: 'endmill_2f', toolDiameterMm: 0, machine: LAGUNA })
    expect(r).toEqual({ ok: false, reason: 'invalid_input', notes: expect.any(Array) })
  })

  it('rejects a non-positive machine max feed', () => {
    const r = computeFeedsAndSpeeds({ materialKey: 'plywood', toolType: 'endmill_2f', toolDiameterMm: 6, machine: { maxFeedMmMin: 0 } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid_input')
  })

  it('returns no_surface_speed_ref for an unknown material', () => {
    const r = computeFeedsAndSpeeds({ materialKey: 'unobtanium', toolType: 'endmill_2f', toolDiameterMm: 6, machine: LAGUNA })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no_surface_speed_ref')
  })
})
