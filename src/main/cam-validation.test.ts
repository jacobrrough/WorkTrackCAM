/**
 * CAM pre-flight validation tests.
 *
 * Tests operation parameter validation against machine capabilities, tool
 * constraints, feed/speed limits, and work envelope bounds BEFORE toolpath
 * generation. These checks are the safety net between user config and G-code.
 */
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import type { CamJobConfig } from './cam-runner'
import {
  applyCamToolpathGuardrails,
  clampFeedAndPlungeToMachineMax,
  clampFeedPlungeSafeZ,
  clampStepoverMm,
  clampToolDiameterMm,
  warnBallEndMillZPass,
  warnDocExceedsFluteLength,
  CAM_GUARDRAIL_FEED_MIN_MM_MIN,
  CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN,
  CAM_GUARDRAIL_SAFE_Z_MIN_MM,
  CAM_GUARDRAIL_STEPOVER_MIN_MM,
  CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL,
  CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL,
  CAM_GUARDRAIL_TOOL_DIAM_MIN_MM,
  CAM_GUARDRAIL_TOOL_DIAM_MAX_MM
} from './cam-toolpath-guardrails'
import { clampSpindleRpm } from './post-process'
import { validate2dOperationGeometry, extractPostProcessingOpts } from './cam-runner'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseMachine: MachineProfile = {
  id: 'validation-mill',
  name: 'Validation Test Mill',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl',
  maxSpindleRpm: 24000,
  minSpindleRpm: 6000
}

function minimalJob(over: Partial<CamJobConfig>): CamJobConfig {
  return {
    stlPath: '/tmp/x.stl',
    outputGcodePath: '/tmp/x.gcode',
    machine: baseMachine,
    resourcesRoot: '/r',
    appRoot: '/a',
    zPassMm: -3,
    stepoverMm: 2,
    feedMmMin: 1000,
    plungeMmMin: 400,
    safeZMm: 10,
    pythonPath: 'python',
    ...over
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool diameter validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: tool diameter clamping', () => {
  it('accepts normal tool diameter without clamping', () => {
    const r = clampToolDiameterMm(6, 6)
    expect(r.value).toBe(6)
    expect(r.note).toBeUndefined()
  })

  it('clamps sub-minimum tool diameter to floor', () => {
    const r = clampToolDiameterMm(0.001, 6)
    expect(r.value).toBe(CAM_GUARDRAIL_TOOL_DIAM_MIN_MM)
    expect(r.note).toBeDefined()
    expect(r.note).toMatch(/clamp/i)
  })

  it('clamps oversized tool diameter to ceiling', () => {
    const r = clampToolDiameterMm(999, 6)
    expect(r.value).toBe(CAM_GUARDRAIL_TOOL_DIAM_MAX_MM)
    expect(r.note).toBeDefined()
  })

  it('uses fallback when tool diameter is undefined', () => {
    const r = clampToolDiameterMm(undefined, 8)
    expect(r.value).toBe(8)
    expect(r.note).toBeUndefined()
  })

  it('uses fallback when tool diameter is NaN', () => {
    const r = clampToolDiameterMm(NaN, 6)
    expect(r.value).toBe(6)
  })

  it('uses fallback when tool diameter is negative', () => {
    const r = clampToolDiameterMm(-3, 6)
    expect(r.value).toBe(6)
  })

  it('uses fallback when tool diameter is zero', () => {
    const r = clampToolDiameterMm(0, 6)
    expect(r.value).toBe(6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Stepover vs tool diameter constraints
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: stepover vs tool diameter', () => {
  it('accepts stepover within valid range for tool', () => {
    // Tool Ø 6mm, stepover 3mm = 50% engagement — normal
    const r = clampStepoverMm(3, 6)
    expect(r.value).toBe(3)
    expect(r.note).toBeUndefined()
  })

  it('clamps stepover that exceeds tool diameter fraction', () => {
    // Stepover 6mm on a 6mm tool = 100% — exceeds max fraction
    const r = clampStepoverMm(6, 6)
    const maxAllowed = 6 * CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL
    expect(r.value).toBeCloseTo(maxAllowed, 4)
    expect(r.note).toBeDefined()
  })

  it('clamps near-zero stepover to minimum fraction of tool', () => {
    const r = clampStepoverMm(0.001, 6)
    const minAllowed = Math.max(CAM_GUARDRAIL_STEPOVER_MIN_MM, 6 * CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL)
    expect(r.value).toBeCloseTo(minAllowed, 4)
    expect(r.note).toBeDefined()
  })

  it('clamps NaN stepover to minimum', () => {
    const r = clampStepoverMm(NaN, 6)
    expect(Number.isFinite(r.value)).toBe(true)
    expect(r.value).toBeGreaterThanOrEqual(CAM_GUARDRAIL_STEPOVER_MIN_MM)
    expect(r.note).toBeDefined()
  })

  it('handles very small tool with proportionally small stepover', () => {
    // 0.1mm engraving tool, 0.02mm stepover — should be fine
    const r = clampStepoverMm(0.02, 0.1)
    expect(r.value).toBeGreaterThan(0)
  })

  it('handles large tool with appropriate stepover', () => {
    // 50mm face mill, 30mm stepover = 60%
    const r = clampStepoverMm(30, 50)
    expect(r.value).toBe(30)
    expect(r.note).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Feed/speed limits vs machine maximums
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: feed/plunge floor clamping', () => {
  it('accepts valid feed and plunge rates', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1000, plungeMmMin: 400, safeZMm: 10 })
    expect(r.feedMmMin).toBe(1000)
    expect(r.plungeMmMin).toBe(400)
    expect(r.safeZMm).toBe(10)
    expect(r.notes).toHaveLength(0)
  })

  it('raises sub-floor feed to minimum', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 0.001, plungeMmMin: 400, safeZMm: 10 })
    expect(r.feedMmMin).toBe(CAM_GUARDRAIL_FEED_MIN_MM_MIN)
    expect(r.notes.some(n => n.includes('feed'))).toBe(true)
  })

  it('raises sub-floor plunge to minimum', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1000, plungeMmMin: 0.001, safeZMm: 10 })
    expect(r.plungeMmMin).toBe(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
    expect(r.notes.some(n => n.includes('plunge'))).toBe(true)
  })

  it('raises sub-floor safe Z to minimum', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1000, plungeMmMin: 400, safeZMm: 0.001 })
    expect(r.safeZMm).toBe(CAM_GUARDRAIL_SAFE_Z_MIN_MM)
    expect(r.notes.some(n => n.includes('safe Z'))).toBe(true)
  })

  it('handles all NaN inputs without crashing', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: NaN, plungeMmMin: NaN, safeZMm: NaN })
    expect(Number.isFinite(r.feedMmMin)).toBe(true)
    expect(Number.isFinite(r.plungeMmMin)).toBe(true)
    expect(Number.isFinite(r.safeZMm)).toBe(true)
    expect(r.notes.length).toBeGreaterThan(0)
  })
})

describe('Pre-flight: feed/plunge vs machine maximum', () => {
  it('does not clamp when feed is within machine max', () => {
    const r = clampFeedAndPlungeToMachineMax(3000, 1500, 5000)
    expect(r.feedMmMin).toBe(3000)
    expect(r.plungeMmMin).toBe(1500)
    expect(r.notes).toHaveLength(0)
  })

  it('clamps feed to machine max when exceeded', () => {
    const r = clampFeedAndPlungeToMachineMax(8000, 1500, 5000)
    expect(r.feedMmMin).toBe(5000)
    expect(r.notes.some(n => n.includes('feed clamped'))).toBe(true)
  })

  it('clamps plunge to machine max when exceeded', () => {
    const r = clampFeedAndPlungeToMachineMax(3000, 7000, 5000)
    expect(r.plungeMmMin).toBe(5000)
    expect(r.notes.some(n => n.includes('plunge clamped'))).toBe(true)
  })

  it('clamps both feed and plunge when both exceed machine max', () => {
    const r = clampFeedAndPlungeToMachineMax(9000, 8000, 5000)
    expect(r.feedMmMin).toBe(5000)
    expect(r.plungeMmMin).toBe(5000)
    expect(r.notes.length).toBe(2)
  })

  it('handles invalid (zero/negative) machine max gracefully', () => {
    const r = clampFeedAndPlungeToMachineMax(3000, 1500, 0)
    expect(r.feedMmMin).toBe(3000)
    expect(r.plungeMmMin).toBe(1500)
    expect(r.notes).toHaveLength(0)
  })

  it('handles NaN machine max gracefully', () => {
    const r = clampFeedAndPlungeToMachineMax(3000, 1500, NaN)
    expect(r.feedMmMin).toBe(3000)
    expect(r.plungeMmMin).toBe(1500)
    expect(r.notes).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Spindle RPM vs machine limits
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: spindle RPM vs machine limits', () => {
  it('passes through RPM within machine range', () => {
    const r = clampSpindleRpm(12000, baseMachine)
    expect(r.rpm).toBe(12000)
    expect(r.warning).toBeUndefined()
  })

  it('clamps RPM above machine max', () => {
    const r = clampSpindleRpm(30000, baseMachine)
    expect(r.rpm).toBe(24000)
    expect(r.warning).toBeDefined()
    expect(r.warning).toMatch(/exceeds.*maximum/i)
  })

  it('clamps RPM below machine min', () => {
    const r = clampSpindleRpm(3000, baseMachine)
    expect(r.rpm).toBe(6000)
    expect(r.warning).toBeDefined()
    expect(r.warning).toMatch(/below.*minimum/i)
  })

  it('passes through when machine has no spindle limits', () => {
    const noLimits: MachineProfile = { ...baseMachine, maxSpindleRpm: undefined, minSpindleRpm: undefined }
    const r = clampSpindleRpm(50000, noLimits)
    expect(r.rpm).toBe(50000)
    expect(r.warning).toBeUndefined()
  })

  it('clamps to max but not min when only max is set', () => {
    const maxOnly: MachineProfile = { ...baseMachine, maxSpindleRpm: 20000, minSpindleRpm: undefined }
    const above = clampSpindleRpm(25000, maxOnly)
    expect(above.rpm).toBe(20000)
    expect(above.warning).toBeDefined()

    const below = clampSpindleRpm(1000, maxOnly)
    expect(below.rpm).toBe(1000)
    expect(below.warning).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Ball end mill DOC warning
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: ball end mill DOC warning', () => {
  it('returns null when DOC is within ball radius', () => {
    // Tool Ø 6mm = radius 3mm, DOC 2mm — safe
    expect(warnBallEndMillZPass(-2, 6)).toBeNull()
  })

  it('returns null when DOC equals ball radius exactly', () => {
    expect(warnBallEndMillZPass(-3, 6)).toBeNull()
  })

  it('warns when DOC exceeds ball radius', () => {
    // Tool Ø 6mm = radius 3mm, DOC 5mm — too deep
    const w = warnBallEndMillZPass(-5, 6)
    expect(w).not.toBeNull()
    expect(w).toMatch(/exceeds.*radius/i)
  })

  it('handles NaN inputs gracefully', () => {
    expect(warnBallEndMillZPass(NaN, 6)).toBeNull()
    expect(warnBallEndMillZPass(-3, NaN)).toBeNull()
  })

  it('handles zero tool diameter gracefully', () => {
    expect(warnBallEndMillZPass(-1, 0)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Flute length DOC warning
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: flute length DOC warning', () => {
  it('returns null when DOC is within half flute length', () => {
    // Flute 20mm, DOC 8mm — safe (limit = 10mm)
    expect(warnDocExceedsFluteLength(-8, 20)).toBeNull()
  })

  it('warns when DOC exceeds half flute length', () => {
    // Flute 20mm, DOC 12mm — exceeds 10mm limit
    const w = warnDocExceedsFluteLength(-12, 20)
    expect(w).not.toBeNull()
    expect(w).toMatch(/flute length/i)
  })

  it('handles NaN inputs gracefully', () => {
    expect(warnDocExceedsFluteLength(NaN, 20)).toBeNull()
    expect(warnDocExceedsFluteLength(-5, NaN)).toBeNull()
  })

  it('handles zero flute length gracefully', () => {
    expect(warnDocExceedsFluteLength(-1, 0)).toBeNull()
  })

  it('handles negative flute length gracefully', () => {
    expect(warnDocExceedsFluteLength(-1, -10)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Full guardrail pipeline: applyCamToolpathGuardrails integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: applyCamToolpathGuardrails — full pipeline', () => {
  it('passes through valid job config unchanged', () => {
    const job = minimalJob({ toolDiameterMm: 6, stepoverMm: 3, feedMmMin: 1000, plungeMmMin: 400, safeZMm: 10 })
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.toolDiameterMm).toBe(6)
    expect(r.job.stepoverMm).toBe(3)
    expect(r.job.feedMmMin).toBe(1000)
    expect(r.job.plungeMmMin).toBe(400)
    expect(r.job.safeZMm).toBe(10)
    expect(r.notes).toHaveLength(0)
  })

  it('clamps all degenerate values and reports notes', () => {
    const job = minimalJob({
      toolDiameterMm: 0,
      stepoverMm: 0,
      feedMmMin: 0,
      plungeMmMin: 0,
      safeZMm: 0
    })
    const r = applyCamToolpathGuardrails(job)
    expect(Number.isFinite(r.job.stepoverMm)).toBe(true)
    expect(r.job.stepoverMm).toBeGreaterThan(0)
    expect(Number.isFinite(r.job.feedMmMin)).toBe(true)
    expect(r.job.feedMmMin).toBeGreaterThanOrEqual(CAM_GUARDRAIL_FEED_MIN_MM_MIN)
    expect(Number.isFinite(r.job.plungeMmMin)).toBe(true)
    expect(r.job.plungeMmMin).toBeGreaterThanOrEqual(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
    expect(Number.isFinite(r.job.safeZMm)).toBe(true)
    expect(r.job.safeZMm).toBeGreaterThanOrEqual(CAM_GUARDRAIL_SAFE_Z_MIN_MM)
    expect(r.notes.length).toBeGreaterThan(0)
  })

  it('clamps stepover that exceeds tool diameter', () => {
    const job = minimalJob({ toolDiameterMm: 6, stepoverMm: 10 })
    const r = applyCamToolpathGuardrails(job)
    // Stepover should be clamped to max fraction of tool Ø
    expect(r.job.stepoverMm).toBeLessThanOrEqual(6 * CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL + 0.001)
    expect(r.notes.some(n => n.includes('stepover'))).toBe(true)
  })

  it('preserves non-guardrail fields from original job', () => {
    const job = minimalJob({
      operationKind: 'cnc_contour',
      operationLabel: 'Test Label',
      workCoordinateIndex: 3
    })
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.operationKind).toBe('cnc_contour')
    expect(r.job.operationLabel).toBe('Test Label')
    expect(r.job.workCoordinateIndex).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// extractPostProcessingOpts — option extraction from operation params
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: extractPostProcessingOpts', () => {
  it('returns empty object for undefined params', () => {
    const opts = extractPostProcessingOpts(undefined)
    expect(Object.keys(opts)).toHaveLength(0)
  })

  it('returns empty object for params with no post-processing flags', () => {
    const opts = extractPostProcessingOpts({ feedMmMin: 1000, zPassMm: -3 })
    expect(opts.enableArcFitting).toBeUndefined()
    expect(opts.cutterCompensation).toBeUndefined()
    expect(opts.enableSubroutines).toBeUndefined()
    expect(opts.lineNumbering).toBeUndefined()
    expect(opts.inverseTimeFeed).toBeUndefined()
  })

  it('extracts arc fitting options', () => {
    const opts = extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: 0.01 })
    expect(opts.enableArcFitting).toBe(true)
    expect(opts.arcTolerance).toBe(0.01)
  })

  it('ignores arc tolerance when arc fitting is disabled', () => {
    const opts = extractPostProcessingOpts({ enableArcFitting: false, arcTolerance: 0.01 })
    expect(opts.enableArcFitting).toBeUndefined()
    expect(opts.arcTolerance).toBeUndefined()
  })

  it('extracts cutter compensation options', () => {
    const opts = extractPostProcessingOpts({ cutterCompensation: 'left', cutterCompDRegister: 5 })
    expect(opts.cutterCompensation).toBe('left')
    expect(opts.cutterCompDRegister).toBe(5)
  })

  it('extracts right cutter compensation', () => {
    const opts = extractPostProcessingOpts({ cutterCompensation: 'right' })
    expect(opts.cutterCompensation).toBe('right')
  })

  it('ignores invalid cutter compensation values', () => {
    const opts = extractPostProcessingOpts({ cutterCompensation: 'invalid' })
    expect(opts.cutterCompensation).toBeUndefined()
  })

  it('extracts subroutine options with default dialect', () => {
    const opts = extractPostProcessingOpts({ enableSubroutines: true })
    expect(opts.enableSubroutines).toBe(true)
    expect(opts.subroutineDialect).toBe('fanuc') // default
  })

  it('extracts subroutine options with explicit dialect', () => {
    const opts = extractPostProcessingOpts({ enableSubroutines: true, subroutineDialect: 'siemens' })
    expect(opts.enableSubroutines).toBe(true)
    expect(opts.subroutineDialect).toBe('siemens')
  })

  it('extracts line numbering options', () => {
    const opts = extractPostProcessingOpts({
      lineNumberingEnabled: true,
      lineNumberingStart: 100,
      lineNumberingIncrement: 5
    })
    expect(opts.lineNumbering).toBeDefined()
    expect(opts.lineNumbering!.enabled).toBe(true)
    expect(opts.lineNumbering!.start).toBe(100)
    expect(opts.lineNumbering!.increment).toBe(5)
  })

  it('uses default line numbering values when not specified', () => {
    const opts = extractPostProcessingOpts({ lineNumberingEnabled: true })
    expect(opts.lineNumbering).toBeDefined()
    expect(opts.lineNumbering!.start).toBe(10) // default
    expect(opts.lineNumbering!.increment).toBe(10) // default
  })

  it('extracts inverse time feed', () => {
    const opts = extractPostProcessingOpts({ inverseTimeFeed: true })
    expect(opts.inverseTimeFeed).toBe(true)
  })

  it('does not set inverse time feed when false', () => {
    const opts = extractPostProcessingOpts({ inverseTimeFeed: false })
    expect(opts.inverseTimeFeed).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2D operation geometry validation — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flight: validate2dOperationGeometry edge cases', () => {
  it('rejects chamfer with only 2 contour points', () => {
    const v = validate2dOperationGeometry('cnc_chamfer', {
      contourPoints: [[0, 0], [10, 10]]
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/[Cc]ontour/i)
    }
  })

  it('rejects PCB contour with missing contourPoints', () => {
    const v = validate2dOperationGeometry('cnc_pcb_contour', {})
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/missing/i)
    }
  })

  it('handles contourPoints that are not arrays gracefully', () => {
    const v = validate2dOperationGeometry('cnc_contour', {
      contourPoints: 'not an array'
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/missing/i)
    }
  })

  it('handles drillPoints that are not arrays gracefully', () => {
    const v = validate2dOperationGeometry('cnc_drill', {
      drillPoints: 42
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/missing/i)
    }
  })

  it('accepts pocket with exactly 3 contour points (triangle)', () => {
    const v = validate2dOperationGeometry('cnc_pocket', {
      contourPoints: [[0, 0], [10, 0], [5, 10]]
    })
    expect(v.ok).toBe(true)
  })

  it('handles undefined operationParams', () => {
    const v = validate2dOperationGeometry('cnc_contour', undefined)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/missing/i)
    }
  })

  it('handles null-like values in contour points array', () => {
    const v = validate2dOperationGeometry('cnc_contour', {
      contourPoints: [null, undefined, [0, 0], [10, 0], [10, 10]]
    })
    // Should still have 3 valid points
    expect(v.ok).toBe(true)
  })

  it('distinguishes between empty array and missing key for drill', () => {
    // Empty array = count 0 = missing
    const empty = validate2dOperationGeometry('cnc_drill', { drillPoints: [] })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toMatch(/missing/i)

    // Key absent = missing
    const absent = validate2dOperationGeometry('cnc_drill', {})
    expect(absent.ok).toBe(false)
    if (!absent.ok) expect(absent.error).toMatch(/missing/i)
  })
})
