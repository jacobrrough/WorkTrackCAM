/**
 * Strategy unit tests — continuous (roughing + finishing alias)
 *
 * Continuous in v1 is implemented as roughing followed by finishing in a
 * single G-code stream — there is no real simultaneous 4-axis interpolation.
 * The strategy emits a warning so users know what they are getting.
 */
import { describe, expect, it } from 'vitest'
import { generateContinuous } from '../strategies/continuous'
import type { Triangle } from '../frame'

function makeBox(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number
): Triangle[] {
  const tris: Triangle[] = []
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMax, zMin]])
  tris.push([[xMin, yMin, zMin], [xMax, yMax, zMin], [xMin, yMax, zMin]])
  tris.push([[xMin, yMin, zMax], [xMax, yMax, zMax], [xMax, yMin, zMax]])
  tris.push([[xMin, yMin, zMax], [xMin, yMax, zMax], [xMax, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMin], [xMin, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMax], [xMin, yMin, zMax]])
  tris.push([[xMax, yMin, zMin], [xMax, yMax, zMax], [xMax, yMax, zMin]])
  tris.push([[xMax, yMin, zMin], [xMax, yMin, zMax], [xMax, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMax], [xMax, yMin, zMin]])
  tris.push([[xMin, yMin, zMin], [xMin, yMin, zMax], [xMax, yMin, zMax]])
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax]])
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMax], [xMin, yMax, zMax]])
  return tris
}

describe('generateContinuous', () => {
  it('produces a roughing section followed by a finishing section', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      stepXMm: 3,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const continuousHeader = result.lines.find((l) =>
      l.includes('Continuous 4-axis: roughing followed by finishing')
    )
    const finishHeader = result.lines.find((l) => l.includes('Finishing pass'))
    expect(continuousHeader).toBeDefined()
    expect(finishHeader).toBeDefined()
  })

  it('emits a warning that v1 is not true simultaneous 4-axis', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      stepXMm: 3,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const w = result.warnings.find((s) => s.includes('not true simultaneous 4-axis'))
    expect(w).toBeDefined()
  })

  it('roughing receives all-but-last depths, finishing receives the last', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // The finishing block targets a single depth — should appear after the
    // continuous separator comment.
    const finishIdx = result.lines.findIndex((l) => l.includes('Finishing pass'))
    expect(finishIdx).toBeGreaterThan(0)
    // After the finishing header, there should be at least one G1 cut.
    const afterFinish = result.lines.slice(finishIdx)
    const finishCuts = afterFinish.filter((l) => l.startsWith('G1'))
    expect(finishCuts.length).toBeGreaterThan(0)
  })

  it('handles a single depth (degenerate case): no roughing, finishing only', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // When zDepthsMm.length === 1, the strategy passes the single value to
    // both halves (roughDepths === [-4], finishDepth === -4) so both run.
    const continuousHeader = result.lines.find((l) =>
      l.includes('Continuous 4-axis: roughing followed by finishing')
    )
    expect(continuousHeader).toBeDefined()
  })
})



// ────────────────────────────────────────────────────────────────────────────
// [ID-0157] Continuous strategy edge-case + safety-emit invariants
// (DISCOVERED-2026-04-26 sibling-extension on Cycle 42 [ID-0010b] contour /
// Cycle 49 [ID-0010c] roughing / Cycle 58 [ID-0010d] finishing patterns).
// Pure test-only cycle: zero production-code edits.
// Tests pinning behavior of:
//   1. Section-separator literal strings (continuous header + finishing-pass
//      header) emitted in fixed order -- continuous-first, finishing-second.
//   2. v1-not-simultaneous warning is at warnings[0] with the documented
//      literal text; warnings list is non-empty regardless of input.
//   3. finishAllowanceMm hard-coded to 0 in the finishing sub-call (so the
//      finishing pass lands ON the surface) -- verified by cross-run
//      comparison: rough section shifts up with allowance=5, finish section
//      stays identical between allowance=0 and allowance=5 runs.
//   4. maxZMm clamps clearZ across the COMBINED stream -- every G0 Z line
//      in BOTH the roughing and finishing halves stays <= maxZMm-1.
//   5. adaptiveRefinement threads through to both sub-strategies -- total
//      G0 A line count exceeds the non-adaptive baseline (combined stream).
//   6. zDepthsMm split: with multi-depth, the roughing section has G1 Z
//      values spanning multiple cut levels (high variance) while the
//      finishing section clusters tightly around a single radius (low
//      variance) consistent with the LAST-depth single-target rule.
//   7. Single-depth degenerate (zDepthsMm.length===1) runs BOTH halves --
//      both section separators present, both sections emit G1 cuts, two
//      'return A to home' lines (one per sub-strategy returnHome).
// ────────────────────────────────────────────────────────────────────────────

function extractG1Z(lines: string[]): number[] {
  return lines
    .filter((l) => /^G1\s+.*\bZ-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/\bZ(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

function extractG0Z(lines: string[]): number[] {
  return lines
    .filter((l) => /^G0\s+.*\bZ-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/\bZ(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

function variance(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
}

describe('generateContinuous -- edge-case + safety-emit invariants (DISCOVERED-2026-04-26 [ID-0157])', () => {
  it('emits section separators in fixed order: continuous header THEN finishing-pass header', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2, -4, -6],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const continuousIdx = result.lines.findIndex(
      (l) => l === '; \u2500\u2500\u2500 Continuous 4-axis: roughing followed by finishing \u2500\u2500\u2500'
    )
    const finishIdx = result.lines.findIndex(
      (l) => l === '; \u2500\u2500\u2500 Finishing pass \u2500\u2500\u2500'
    )
    expect(continuousIdx).toBeGreaterThanOrEqual(0)
    expect(finishIdx).toBeGreaterThan(continuousIdx)
    // Exactly one of each separator in the combined stream.
    expect(
      result.lines.filter((l) => l.includes('Continuous 4-axis: roughing followed by finishing')).length
    ).toBe(1)
    expect(result.lines.filter((l) => l.includes('Finishing pass')).length).toBe(1)
  })

  it('warnings[0] is the v1-not-simultaneous notice with documented literal text', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toBe(
      'cnc_4axis_continuous in v1 emits roughing + finishing in sequence, not true simultaneous 4-axis interpolation. Open an issue if your job requires the latter.'
    )
  })

  it('finishAllowanceMm hard-coded to 0 in the finishing sub-call (rough shifts, finish stays)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const baseParams = {
      triangles: tris,
      cylinderDiameterMm: 30, // stockR=15
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-10, -12], // roughDepth=-10 (targetCutR=5; below max compR=8.49 so allowance=4 shifts cut up), finishDepth=-12 (finishTargetR=3)
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const noAllow = generateContinuous(baseParams)
    const withAllow = generateContinuous({ ...baseParams, finishAllowanceMm: 4 })

    const noAllowFinishIdx = noAllow.lines.findIndex((l) => l.includes('Finishing pass'))
    const withAllowFinishIdx = withAllow.lines.findIndex((l) => l.includes('Finishing pass'))
    expect(noAllowFinishIdx).toBeGreaterThan(0)
    expect(withAllowFinishIdx).toBeGreaterThan(0)

    // Roughing section: WITH allowance=4 the cut-Z distribution shifts up
    // because rough's compR+allowance dominates DEEPER-pass cells (mirror of
    // [ID-0010c] roughing test 1 + [ID-0010d] finishing test 1). Note: the
    // mesh-aware depth scheduler inserts shallow intermediate depths so
    // MAX cut-Z is bounded by the shallowest pass (allowance has no effect
    // there). The MEAN, however, captures the deeper-pass shift.
    const noAllowRoughZ = extractG1Z(noAllow.lines.slice(0, noAllowFinishIdx))
    const withAllowRoughZ = extractG1Z(withAllow.lines.slice(0, withAllowFinishIdx))
    expect(noAllowRoughZ.length).toBeGreaterThan(0)
    expect(withAllowRoughZ.length).toBeGreaterThan(0)
    const noAllowRoughMean = noAllowRoughZ.reduce((a, b) => a + b, 0) / noAllowRoughZ.length
    const withAllowRoughMean = withAllowRoughZ.reduce((a, b) => a + b, 0) / withAllowRoughZ.length
    expect(withAllowRoughMean).toBeGreaterThan(noAllowRoughMean + 0.1)

    // Finishing section: hard-coded allowance=0 means BOTH runs produce
    // identical cuts in the finishing half.
    const noAllowFinishZ = extractG1Z(noAllow.lines.slice(noAllowFinishIdx))
    const withAllowFinishZ = extractG1Z(withAllow.lines.slice(withAllowFinishIdx))
    expect(noAllowFinishZ.length).toBeGreaterThan(0)
    expect(noAllowFinishZ.length).toBe(withAllowFinishZ.length)
    for (let i = 0; i < noAllowFinishZ.length; i++) {
      expect(Math.abs(noAllowFinishZ[i]! - withAllowFinishZ[i]!)).toBeLessThan(0.001)
    }
  })

  it('maxZMm clamps clearZ across the COMBINED stream (rough + finish halves)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxZMm: 20, // clamps clearZ to 19 in BOTH sub-strategies
      toolDiameterMm: 3.175
    })
    const finishIdx = result.lines.findIndex((l) => l.includes('Finishing pass'))
    expect(finishIdx).toBeGreaterThan(0)

    // Slice both halves.
    const roughZ = extractG0Z(result.lines.slice(0, finishIdx))
    const finishZ = extractG0Z(result.lines.slice(finishIdx))
    expect(roughZ.length).toBeGreaterThan(0)
    expect(finishZ.length).toBeGreaterThan(0)

    // maxZMm-1 = 19; emitter rounds to 1 decimal, so allow a tiny epsilon.
    expect(Math.max(...roughZ)).toBeLessThanOrEqual(20 - 1 + 1e-6)
    expect(Math.max(...finishZ)).toBeLessThanOrEqual(20 - 1 + 1e-6)
  })

  it('adaptiveRefinement threads through to BOTH sub-strategies', () => {
    const tris = makeBox(10, 60, -8, 8, -8, 8)
    const baseParams = {
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 15,
      stepXMm: 5,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const without = generateContinuous(baseParams)
    const withAdaptive = generateContinuous({ ...baseParams, adaptiveRefinement: true })

    const aWithout = without.lines.filter((l) => /^G0\s+A/i.test(l)).length
    const aWithAdaptive = withAdaptive.lines.filter((l) => /^G0\s+A/i.test(l)).length

    // Adaptive flag adds A passes at high-curvature angles in BOTH halves;
    // total combined G0 A count must exceed the non-adaptive baseline.
    expect(aWithAdaptive).toBeGreaterThan(aWithout)
  })

  it('zDepthsMm split: roughing has multi-level Z variance, finishing clusters tight', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50, // stockR=25
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2, -4, -6], // rough=[-2,-4], finish=-6
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const finishIdx = result.lines.findIndex((l) => l.includes('Finishing pass'))
    expect(finishIdx).toBeGreaterThan(0)

    const roughZ = extractG1Z(result.lines.slice(0, finishIdx))
    const finishZ = extractG1Z(result.lines.slice(finishIdx))
    expect(roughZ.length).toBeGreaterThan(0)
    expect(finishZ.length).toBeGreaterThan(0)

    // Roughing iterates two depth levels (-2, -4) -> Z values fall into two
    // bands (compR fallback + finishTargetR per depth). Finishing operates
    // at a single depth -> Z values cluster on a tighter band.
    const roughVar = variance(roughZ)
    const finishVar = variance(finishZ)
    expect(roughVar).toBeGreaterThan(finishVar)
  })

  it('single-depth degenerate (zDepthsMm.length===1) runs BOTH halves with cuts + dual returnHome', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateContinuous({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const continuousIdx = result.lines.findIndex((l) =>
      l.includes('Continuous 4-axis: roughing followed by finishing')
    )
    const finishIdx = result.lines.findIndex((l) => l.includes('Finishing pass'))
    expect(continuousIdx).toBeGreaterThanOrEqual(0)
    expect(finishIdx).toBeGreaterThan(continuousIdx)

    // Both halves emit G1 cuts.
    const roughCuts = result.lines.slice(continuousIdx, finishIdx).filter((l) => l.startsWith('G1'))
    const finishCuts = result.lines.slice(finishIdx).filter((l) => l.startsWith('G1'))
    expect(roughCuts.length).toBeGreaterThan(0)
    expect(finishCuts.length).toBeGreaterThan(0)

    // Each sub-strategy emits its own returnHome, so the combined stream
    // contains exactly two 'return A to home' lines.
    const returnHomeLines = result.lines.filter((l) => /\breturn\s+A\s+to\s+home\b/i.test(l))
    expect(returnHomeLines.length).toBe(2)
  })
})
