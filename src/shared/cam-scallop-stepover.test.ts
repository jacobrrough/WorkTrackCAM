import { describe, expect, it } from 'vitest'
import { resolve3dFinishStepoverMm, stepoverFromScallopMm } from './cam-scallop-stepover'

describe('stepoverFromScallopMm', () => {
  it('increases stepover for larger scallop (6mm tool)', () => {
    const a = stepoverFromScallopMm(6, 0.01, 'ball')
    const b = stepoverFromScallopMm(6, 0.05, 'ball')
    expect(b).toBeGreaterThan(a)
  })

  it('caps near tool diameter', () => {
    const e = stepoverFromScallopMm(6, 5, 'ball')
    expect(e).toBeLessThanOrEqual(6 * 0.95 + 1e-6)
  })

  it('zero tool diameter clamps to minimum radius (1e-6) and returns finite stepover', () => {
    const e = stepoverFromScallopMm(0, 0.01, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThanOrEqual(0)
  })

  it('negative scallop is clamped to near-zero and returns minimum stepover', () => {
    const e = stepoverFromScallopMm(6, -1, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThan(0)
  })

  it('scallop at R boundary (h >= 0.999*R) returns cap value near 1.9*R', () => {
    // h = R → h >= R*0.999 → returns min(R*1.9, D*0.95) = min(5.7, 5.7) = 5.7 for 6mm tool
    const D = 6
    const R = D / 2
    const e = stepoverFromScallopMm(D, R, 'ball')
    expect(e).toBeCloseTo(Math.min(R * 1.9, D * 0.95), 5)
  })

  it('very small scallop (0.001mm) produces small stepover proportional to sqrt(R*h)', () => {
    const e = stepoverFromScallopMm(6, 0.001, 'ball')
    expect(e).toBeGreaterThan(0)
    expect(e).toBeLessThan(1) // 2*sqrt(2*3*0.001) ≈ 0.245 mm
  })

  it('flat and ball modes produce identical stepover (mode parameter is unused)', () => {
    // The _mode parameter is intentionally ignored — both tool types share the same
    // chord formula for small scallops (see file header comment).
    expect(stepoverFromScallopMm(6, 0.01, 'flat')).toBe(stepoverFromScallopMm(6, 0.01, 'ball'))
    expect(stepoverFromScallopMm(10, 0.05, 'flat')).toBe(stepoverFromScallopMm(10, 0.05, 'ball'))
  })
})

describe('resolve3dFinishStepoverMm', () => {
  it('prefers finishStepoverMm when positive', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: 0.4, finishScallopMm: 0.01 }
    })
    expect(r.stepoverMm).toBe(0.4)
    expect(r.source).toBe('finishStepoverMm')
  })

  it('uses scallop when finish stepover absent', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
    expect(r.stepoverMm).toBeGreaterThan(0)
    expect(r.stepoverMm).toBeLessThan(2)
  })

  it('falls back to base stepover', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.2,
      operationParams: {}
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(1.2)
  })

  it('falls back to base stepover when operationParams is null', () => {
    const r = resolve3dFinishStepoverMm({ toolDiameterMm: 6, baseStepoverMm: 1.5, operationParams: null })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(1.5)
  })

  it('ignores zero or negative finishStepoverMm and falls through to scallop', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: 0, finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it('uses flat scallop mode when finishScallopMode is flat', () => {
    const ball = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'ball' }
    })
    const flat = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'flat' }
    })
    // Both modes use the same formula (mode ignored in implementation but call path should work)
    expect(ball.source).toBe('finishScallopMm')
    expect(flat.source).toBe('finishScallopMm')
    expect(flat.stepoverMm).toBeGreaterThan(0)
  })
})
