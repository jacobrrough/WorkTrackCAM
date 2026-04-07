import { describe, expect, it } from 'vitest'
import {
  applyCamToolpathGuardrails,
  clampFeedAndPlungeToMachineMax,
  clampFeedPlungeSafeZ,
  clampStepoverMm,
  clampToolDiameterMm,
  detectRapidsBelowStockSurface,
  formatRapidBelowStockHintForPostedGcode,
  warnBallEndMillZPass,
  warnDocExceedsFluteLength,
  CAM_GUARDRAIL_FEED_MIN_MM_MIN,
  CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN,
  CAM_GUARDRAIL_SAFE_Z_MIN_MM,
  CAM_GUARDRAIL_STEPOVER_MIN_MM,
  CAM_GUARDRAIL_TOOL_DIAM_MAX_MM,
  CAM_GUARDRAIL_TOOL_DIAM_MIN_MM
} from './cam-toolpath-guardrails'
import type { CamJobConfig } from './cam-runner'

function minimalJob(over: Partial<CamJobConfig>): CamJobConfig {
  return {
    stlPath: '/tmp/x.stl',
    outputGcodePath: '/tmp/x.gcode',
    machine: {
      id: 'm',
      name: 'M',
      kind: 'cnc',
      workAreaMm: { x: 100, y: 100, z: 50 },
      maxFeedMmMin: 5000,
      postTemplate: 'cnc_generic_mm.hbs',
      dialect: 'grbl'
    },
    resourcesRoot: '/r',
    appRoot: '/a',
    zPassMm: -1,
    stepoverMm: 2,
    feedMmMin: 1000,
    plungeMmMin: 400,
    safeZMm: 5,
    pythonPath: 'python',
    ...over
  }
}

describe('warnBallEndMillZPass', () => {
  it('returns null when DOC is within tool radius', () => {
    // tool Ø 6mm → radius 3mm; DOC 2mm is fine
    expect(warnBallEndMillZPass(-2, 6)).toBeNull()
    expect(warnBallEndMillZPass(2, 6)).toBeNull()
  })

  it('returns null when DOC exactly equals tool radius', () => {
    expect(warnBallEndMillZPass(-3, 6)).toBeNull()
    expect(warnBallEndMillZPass(3, 6)).toBeNull()
  })

  it('returns a warning string when |zPassMm| > toolRadius', () => {
    const msg = warnBallEndMillZPass(-4, 6)
    expect(msg).not.toBeNull()
    expect(msg).toContain('ball end mill')
    expect(msg).toContain('3.000 mm')
  })

  it('handles positive zPassMm (same absolute depth)', () => {
    const msg = warnBallEndMillZPass(5, 8) // 5 > 4
    expect(msg).not.toBeNull()
    expect(msg).toContain('4.000 mm')
  })

  it('returns null for non-finite inputs', () => {
    expect(warnBallEndMillZPass(NaN, 6)).toBeNull()
    expect(warnBallEndMillZPass(-3, NaN)).toBeNull()
    expect(warnBallEndMillZPass(Infinity, 6)).toBeNull()
  })
})

describe('clampToolDiameterMm', () => {
  it('clamps huge values', () => {
    const r = clampToolDiameterMm(9000, 6)
    expect(r.value).toBe(CAM_GUARDRAIL_TOOL_DIAM_MAX_MM)
    expect(r.note).toBeDefined()
  })

  it('uses fallback for undefined input', () => {
    const r = clampToolDiameterMm(undefined, 6)
    expect(r.value).toBe(6)
    expect(r.note).toBeUndefined()
  })

  it('uses fallback for zero input', () => {
    const r = clampToolDiameterMm(0, 6)
    expect(r.value).toBe(6)
  })

  it('uses fallback for negative input', () => {
    const r = clampToolDiameterMm(-5, 6)
    expect(r.value).toBe(6)
  })

  it('clamps tiny positive value to minimum', () => {
    const r = clampToolDiameterMm(0.001, 6)
    expect(r.value).toBe(CAM_GUARDRAIL_TOOL_DIAM_MIN_MM)
    expect(r.note).toBeDefined()
  })
})

describe('clampStepoverMm', () => {
  it('caps stepover below tool diameter', () => {
    const r = clampStepoverMm(10, 6)
    expect(r.value).toBeLessThanOrEqual(6 * 0.98 + 1e-6)
  })
  it('raises tiny stepover relative to tool', () => {
    const r = clampStepoverMm(0.001, 10)
    expect(r.value).toBeGreaterThanOrEqual(0.01)
  })
  it('clamps NaN to minimum', () => {
    const r = clampStepoverMm(NaN, 6)
    expect(Number.isFinite(r.value)).toBe(true)
    expect(r.value).toBeGreaterThanOrEqual(CAM_GUARDRAIL_STEPOVER_MIN_MM)
    expect(r.note).toBeDefined()
  })
  it('clamps Infinity to upper bound', () => {
    const r = clampStepoverMm(Infinity, 6)
    expect(r.value).toBeLessThanOrEqual(6 * 0.98 + 1e-6)
    expect(r.note).toBeDefined()
  })
})

describe('clampFeedPlungeSafeZ', () => {
  it('raises sub-floor feed, plunge, and safe-Z independently', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 0, plungeMmMin: 0, safeZMm: 0 })
    expect(r.feedMmMin).toBe(CAM_GUARDRAIL_FEED_MIN_MM_MIN)
    expect(r.plungeMmMin).toBe(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
    expect(r.safeZMm).toBe(CAM_GUARDRAIL_SAFE_Z_MIN_MM)
    expect(r.notes.length).toBe(3)
  })

  it('raises NaN feed and plunge', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: NaN, plungeMmMin: NaN, safeZMm: 5 })
    expect(r.feedMmMin).toBe(CAM_GUARDRAIL_FEED_MIN_MM_MIN)
    expect(r.plungeMmMin).toBe(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
    expect(r.safeZMm).toBe(5)
    expect(r.notes.length).toBe(2)
  })

  it('raises NaN safe-Z', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1000, plungeMmMin: 400, safeZMm: NaN })
    expect(r.safeZMm).toBe(CAM_GUARDRAIL_SAFE_Z_MIN_MM)
    expect(r.notes.length).toBe(1)
  })

  it('passes through sane values without notes', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 800, plungeMmMin: 300, safeZMm: 10 })
    expect(r.feedMmMin).toBe(800)
    expect(r.plungeMmMin).toBe(300)
    expect(r.safeZMm).toBe(10)
    expect(r.notes.length).toBe(0)
  })
})

describe('clampFeedAndPlungeToMachineMax', () => {
  it('clamps feed above machine max and notes the change', () => {
    const r = clampFeedAndPlungeToMachineMax(12000, 400, 8000)
    expect(r.feedMmMin).toBe(8000)
    expect(r.plungeMmMin).toBe(400)
    expect(r.notes.some((n) => n.includes('feed clamped'))).toBe(true)
    expect(r.notes.some((n) => n.includes('machine max'))).toBe(true)
  })

  it('clamps plunge above machine max and notes the change', () => {
    const r = clampFeedAndPlungeToMachineMax(1000, 10000, 5000)
    expect(r.plungeMmMin).toBe(5000)
    expect(r.feedMmMin).toBe(1000)
    expect(r.notes.some((n) => n.includes('plunge clamped'))).toBe(true)
  })

  it('clamps both when both exceed machine max', () => {
    const r = clampFeedAndPlungeToMachineMax(9000, 7000, 6000)
    expect(r.feedMmMin).toBe(6000)
    expect(r.plungeMmMin).toBe(6000)
    expect(r.notes.length).toBe(2)
  })

  it('passes through values at or below machine max without notes', () => {
    const r = clampFeedAndPlungeToMachineMax(1200, 400, 5000)
    expect(r.feedMmMin).toBe(1200)
    expect(r.plungeMmMin).toBe(400)
    expect(r.notes.length).toBe(0)
  })

  it('does not clamp non-finite feed (floor already handles that)', () => {
    const r = clampFeedAndPlungeToMachineMax(NaN, 400, 5000)
    expect(Number.isNaN(r.feedMmMin)).toBe(true)
    expect(r.notes.length).toBe(0)
  })

  it('treats zero or negative machine max as floor (no over-clamping)', () => {
    const r = clampFeedAndPlungeToMachineMax(1200, 400, 0)
    expect(r.feedMmMin).toBe(1200)
    expect(r.plungeMmMin).toBe(400)
    expect(r.notes.length).toBe(0)
  })
})

describe('applyCamToolpathGuardrails', () => {
  it('raises sub-minimum feed', () => {
    const { job, notes } = applyCamToolpathGuardrails(minimalJob({ feedMmMin: 0.1 }))
    expect(job.feedMmMin).toBe(CAM_GUARDRAIL_FEED_MIN_MM_MIN)
    expect(notes.some((n) => n.includes('feed'))).toBe(true)
  })

  it('preserves sane jobs without notes', () => {
    const { job, notes } = applyCamToolpathGuardrails(minimalJob({}))
    expect(job.stepoverMm).toBe(2)
    expect(job.toolDiameterMm ?? 6).toBeLessThan(100)
    expect(notes.length).toBe(0)
  })

  it('raises NaN plunge to floor', () => {
    const { job, notes } = applyCamToolpathGuardrails(minimalJob({ plungeMmMin: NaN }))
    expect(job.plungeMmMin).toBe(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
    expect(notes.some((n) => n.includes('plunge'))).toBe(true)
  })

  it('clamps stepover when larger than tool diameter', () => {
    const { job, notes } = applyCamToolpathGuardrails(minimalJob({ stepoverMm: 999, toolDiameterMm: 6 }))
    expect(job.stepoverMm).toBeLessThan(6)
    expect(notes.some((n) => n.includes('stepover'))).toBe(true)
  })
})

describe('detectRapidsBelowStockSurface', () => {
  it('returns zero count when no segments provided', () => {
    const r = detectRapidsBelowStockSurface([])
    expect(r.count).toBe(0)
    expect(r.worstZMm).toBeNull()
  })

  it('returns zero count when all rapids are at or above stock surface (Z0)', () => {
    const r = detectRapidsBelowStockSurface([
      { kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 10, y1: 0, z1: 5 },
      { kind: 'rapid', x0: 10, y0: 0, z0: 5, x1: 10, y1: 10, z1: 0 }
    ])
    expect(r.count).toBe(0)
    expect(r.worstZMm).toBeNull()
  })

  it('detects a rapid descending below stock surface', () => {
    const r = detectRapidsBelowStockSurface([
      { kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 5, y1: 5, z1: -2 }
    ])
    expect(r.count).toBe(1)
    expect(r.worstZMm).toBeCloseTo(-2, 5)
  })

  it('does not flag G1 feed moves below stock surface (feeds are expected to cut)', () => {
    const r = detectRapidsBelowStockSurface([
      { kind: 'feed', x0: 5, y0: 5, z0: 0, x1: 5, y1: 5, z1: -5 }
    ])
    expect(r.count).toBe(0)
    expect(r.worstZMm).toBeNull()
  })

  it('reports worstZMm as the minimum (deepest) violated rapid endpoint', () => {
    const r = detectRapidsBelowStockSurface([
      { kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 1, y1: 0, z1: -1 },
      { kind: 'rapid', x0: 1, y0: 0, z0: -1, x1: 2, y1: 0, z1: -4 },
      { kind: 'rapid', x0: 2, y0: 0, z0: -4, x1: 3, y1: 0, z1: -0.5 }
    ])
    expect(r.count).toBe(3)
    expect(r.worstZMm).toBeCloseTo(-4, 5)
  })

  it('respects a non-zero stockTopZ', () => {
    // Stock top is at Z=10; rapid ending at Z=8 is below stock surface
    const r = detectRapidsBelowStockSurface(
      [{ kind: 'rapid', x0: 0, y0: 0, z0: 15, x1: 5, y1: 5, z1: 8 }],
      10
    )
    expect(r.count).toBe(1)
    expect(r.worstZMm).toBeCloseTo(8, 5)
  })

  it('suppresses violations outside stock XY bounds when bounds provided', () => {
    const bounds = { minX: 0, maxX: 20, minY: 0, maxY: 20 }
    // Rapid ending at X=50 (outside stock) — should not be flagged
    const r = detectRapidsBelowStockSurface(
      [{ kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 50, y1: 5, z1: -2 }],
      0,
      bounds
    )
    expect(r.count).toBe(0)
  })

  it('flags violations inside stock XY bounds when bounds provided', () => {
    const bounds = { minX: 0, maxX: 20, minY: 0, maxY: 20 }
    // Rapid ending at X=10 Y=10 (inside stock) and below stock surface
    const r = detectRapidsBelowStockSurface(
      [{ kind: 'rapid', x0: 0, y0: 0, z0: 5, x1: 10, y1: 10, z1: -3 }],
      0,
      bounds
    )
    expect(r.count).toBe(1)
    expect(r.worstZMm).toBeCloseTo(-3, 5)
  })
})

describe('formatRapidBelowStockHintForPostedGcode', () => {
  it('returns empty string when G-code has no rapids below stock', () => {
    const g = 'G0 Z5\nG0 X10 Y10 Z5\nG1 Z-2 F400\nG1 X20 F800\nG0 Z5'
    expect(formatRapidBelowStockHintForPostedGcode(g)).toBe('')
  })

  it('returns empty string for empty G-code', () => {
    expect(formatRapidBelowStockHintForPostedGcode('')).toBe('')
    expect(formatRapidBelowStockHintForPostedGcode('   ')).toBe('')
  })

  it('returns warning when G0 rapid descends below Z=0', () => {
    // G0 rapid goes to Z=-3 (below stock surface)
    const g = 'G0 Z5\nG0 X5 Y5 Z-3'
    const hint = formatRapidBelowStockHintForPostedGcode(g)
    expect(hint).not.toBe('')
    expect(hint).toContain('Rapid-into-stock warning')
    expect(hint).toContain('-3.000')
    expect(hint).toContain('MACHINES')
  })

  it('counts multiple rapids below stock surface', () => {
    const g = ['G0 Z5', 'G0 X5 Y5 Z-1', 'G0 X10 Y5 Z-2'].join('\n')
    const hint = formatRapidBelowStockHintForPostedGcode(g)
    expect(hint).toContain('2 G0 rapid moves')
    expect(hint).toContain('-2.000') // worst Z
  })

  it('uses singular form for a single violation', () => {
    const g = 'G0 Z5\nG0 X5 Y5 Z-1'
    const hint = formatRapidBelowStockHintForPostedGcode(g)
    expect(hint).toContain('1 G0 rapid move descends')
  })

  it('respects non-zero stockTopZ', () => {
    // Stock top at Z=10; G0 to Z=8 is below stock surface
    const g = 'G0 Z15\nG0 X5 Y5 Z8'
    const hint = formatRapidBelowStockHintForPostedGcode(g, 10)
    expect(hint).toContain('Rapid-into-stock warning')
    expect(hint).toContain('8.000')
  })
})

describe('warnDocExceedsFluteLength', () => {
  it('returns null when DOC is within flute length / 2', () => {
    // flute 20mm → safe limit 10mm; DOC 8mm is fine
    expect(warnDocExceedsFluteLength(-8, 20)).toBeNull()
    expect(warnDocExceedsFluteLength(8, 20)).toBeNull()
  })

  it('returns null when DOC exactly equals flute length / 2', () => {
    expect(warnDocExceedsFluteLength(-10, 20)).toBeNull()
    expect(warnDocExceedsFluteLength(10, 20)).toBeNull()
  })

  it('returns a warning string when |zPassMm| > fluteLength / 2', () => {
    const msg = warnDocExceedsFluteLength(-12, 20)
    expect(msg).not.toBeNull()
    expect(msg).toContain('flute')
    expect(msg).toContain('10.000')
    expect(msg).toContain('12.000')
  })

  it('handles positive zPassMm (same absolute depth)', () => {
    const msg = warnDocExceedsFluteLength(15, 20)
    expect(msg).not.toBeNull()
    expect(msg).toContain('10.000')
    expect(msg).toContain('15.000')
  })

  it('returns null for zero or negative flute length', () => {
    expect(warnDocExceedsFluteLength(-5, 0)).toBeNull()
    expect(warnDocExceedsFluteLength(-5, -10)).toBeNull()
  })

  it('returns null for non-finite inputs', () => {
    expect(warnDocExceedsFluteLength(NaN, 20)).toBeNull()
    expect(warnDocExceedsFluteLength(-5, NaN)).toBeNull()
    expect(warnDocExceedsFluteLength(Infinity, 20)).toBeNull()
    expect(warnDocExceedsFluteLength(-5, Infinity)).toBeNull()
  })
})
