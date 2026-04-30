/**
 * Strategy unit tests — finishing
 *
 * Ported from `cam-axis4-realworld.test.ts` "finishing with single depth
 * follows mesh surface". The new finishing strategy always operates on a
 * single deepest depth and does surface-following at the finer angular
 * stepover (default = roughingStep / 2).
 */
import { describe, expect, it } from 'vitest'
import { generateFinishing } from '../strategies/finishing'
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

function extractAllXValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G[01]\s+.*X-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/X(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

function extractG1ZValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G1\s+.*Z-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/\bZ(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

describe('generateFinishing', () => {
  it('produces a high G1 count at single deepest depth', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 10,
      stepXMm: 2,
      finishDepthMm: -6,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const g1 = result.lines.filter((l) => l.startsWith('G1'))
    // Surface-following at fine angular density should yield > 100 G1 moves.
    expect(g1.length).toBeGreaterThan(100)
  })

  it('uses finer angular stepover than roughing (default = stepover/2)', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    // No explicit finishStepoverDeg → defaults to stepoverDeg/2 = 7.5°
    // → 360 / 7.5 = 48 angular passes minimum.
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      stepXMm: 3,
      finishDepthMm: -4,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('A step='))
    expect(header).toBeDefined()
    const m = header!.match(/A step=([\d.]+)°/)
    expect(m).toBeTruthy()
    const aStep = parseFloat(m![1]!)
    // Should be ≤ 7.5° (the implicit finer step), allowing for grid quantisation.
    expect(aStep).toBeLessThanOrEqual(7.6)
  })

  it('respects an explicit finishStepoverDeg', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 15,
      finishStepoverDeg: 5,
      stepXMm: 3,
      finishDepthMm: -4,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('A step='))
    expect(header).toBeDefined()
    const m = header!.match(/A step=([\d.]+)°/)
    const aStep = parseFloat(m![1]!)
    expect(aStep).toBeLessThanOrEqual(5.1)
  })

  it('chuck-face safety: never emits negative X', () => {
    const tris = makeBox(2, 30, -5, 5, -5, 5)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 30,
      stepoverDeg: 20,
      stepXMm: 3,
      finishDepthMm: -3,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const xs = extractAllXValues(result.lines)
    if (xs.length > 0) {
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    }
  })

  it('skips finishing when finish target is below cutting threshold', () => {
    // finishDepthMm well past the rotation axis → finishTargetR < 0.05
    const tris = makeBox(10, 60, -5, 5, -5, 5)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 15,
      stepXMm: 3,
      finishDepthMm: -15, // R = 10 + (-15) = -5 → below 0.05
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const skipComment = result.lines.find((l) => l.includes('Skipping finish'))
    expect(skipComment).toBeDefined()
  })
})


// ────────────────────────────────────────────────────────────────────────────
// [ID-0010d] Finishing strategy edge-case + safety-emit invariants
// (DISCOVERED-2026-04-25 sibling-extension on Cycle 42 [ID-0010b]
// strategy-contour and Cycle 49 [ID-0010c] strategy-roughing patterns).
// Pure test-only cycle: zero production-code edits.
// Tests pinning behavior of:
//   1. finishAllowanceMm shifts the cut-Z distribution upward (compR + allow)
//   2. maxZMm clamps clearZ so no rapid Z exceeds maxZMm-1
//   3. adaptiveRefinement: true produces additional A angles outside the
//      regular finishStepoverDeg grid
//   4. plunge G1 Z lines (no X word) use plungeMmMin feed (NOT cut feed)
//   5. lateral cut moves at constant Z (G1 X with no Z word) use feedMmMin
//   6. returnHome trailing-line sequence (G0 Z<clearZ> Y0; G0 A0 ; return A)
//   7. overcutMm: 0 keeps cuts inside [machXStart, machXEnd] tolerance
// ────────────────────────────────────────────────────────────────────────────
describe('generateFinishing -- edge-case + safety-emit invariants (DISCOVERED-2026-04-25 [ID-0010d])', () => {
  it('finishAllowanceMm shifts the cut-Z distribution upward', () => {
    // Box of half-width 6 → max mesh compR at corners = sqrt(72) ≈ 8.49.
    // We pick finishDepthMm=-10 → finishTargetR = stockR + (-10) = 5, so
    // mesh-hit cells DOMINATE the max (8.49 > 5 without allowance, and
    // 8.49 + 4 > 8.49 with allowance=4) instead of being masked by the
    // finishTargetR fallback for no-hit cells. Pin BOTH max + mean.
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const baseParams = {
      triangles: tris,
      cylinderDiameterMm: 30, // stockR = 15
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      finishDepthMm: -10, // finishTargetR = 5 (well below mesh corner R≈8.49)
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const noAllowance = generateFinishing(baseParams)
    const withAllowance = generateFinishing({ ...baseParams, finishAllowanceMm: 4 })

    const zNoAllow = extractG1ZValues(noAllowance.lines)
    const zWithAllow = extractG1ZValues(withAllowance.lines)
    expect(zNoAllow.length).toBeGreaterThan(0)
    expect(zWithAllow.length).toBeGreaterThan(0)

    const maxNoAllow = Math.max(...zNoAllow)
    const maxWithAllow = Math.max(...zWithAllow)
    // With allowance=4 the surface-following cuts shift up by ~4mm relative
    // to baseline at the corner cells (compR + allowance dominates).
    expect(maxWithAllow).toBeGreaterThan(maxNoAllow + 0.5)

    const meanNoAllow = zNoAllow.reduce((a, b) => a + b, 0) / zNoAllow.length
    const meanWithAllow = zWithAllow.reduce((a, b) => a + b, 0) / zWithAllow.length
    expect(meanWithAllow).toBeGreaterThan(meanNoAllow)
  })

  it('maxZMm clamps clearZ -- no rapid Z above maxZMm - 1', () => {
    // stockR=15, safeZMm=10 → rawClear=25; maxZMm=20 → clamped clearZ=19.
    // Every G0 Z value in the program must respect the maxZMm-1 ceiling.
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      finishDepthMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxZMm: 20,
      toolDiameterMm: 3.175
    })
    const allG0Z = result.lines
      .filter((l) => /^G0\s+Z[\d.]/i.test(l))
      .flatMap((l) => {
        const m = l.match(/Z(\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(allG0Z.length).toBeGreaterThan(0)
    expect(Math.max(...allG0Z)).toBeLessThanOrEqual(20 - 1 + 1e-6)
  })

  it('adaptiveRefinement: true inserts extra A angles outside the stepover grid', () => {
    // Square cross-section has 4 sharp corners → high angular curvature at
    // those bands. buildAdaptiveAngles inserts midpoint passes there, so the
    // total count of G0 A lines (one per finishing pass) must exceed the
    // non-adaptive baseline.
    const tris = makeBox(10, 60, -8, 8, -8, 8)
    const baseParams = {
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 15, // → finishStepDeg=7.5, na ~ 48
      stepXMm: 5,
      finishDepthMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const without = generateFinishing(baseParams)
    const withAdaptive = generateFinishing({ ...baseParams, adaptiveRefinement: true })

    const aWithout = without.lines.filter((l) => /^G0\s+A/i.test(l)).length
    const aWithAdaptive = withAdaptive.lines.filter((l) => /^G0\s+A/i.test(l)).length
    expect(aWithAdaptive).toBeGreaterThan(aWithout)
  })

  it('plunge G1 Z lines use plungeMmMin feed (not cut feed)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      finishDepthMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Pure-plunge lines (G1 Z<...> F<...> with no X) come from emit.plungeZ().
    // Finishing emits one plunge per pass (firstPass + per-angle reposition).
    const plungeLines = result.lines.filter(
      (l) => /^G1\s+Z[\d.]/i.test(l) && !/X-?[\d.]/.test(l)
    )
    expect(plungeLines.length).toBeGreaterThan(0)
    for (const line of plungeLines) {
      const fm = line.match(/F(\d+)/)
      expect(fm).not.toBeNull()
      expect(parseInt(fm![1]!, 10)).toBe(300)
    }
  })

  it('lateral cut moves at constant Z use feedMmMin (not plunge feed)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      finishDepthMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Constant-Z lateral cuts (G1 X<...> with no Z word -- emitter omits Z
    // when |dz| <= 0.005 mm) use the cut feed by construction. Among them,
    // F800 must appear at least once and F300 must NEVER appear.
    const cutLines = result.lines.filter((l) => /^G1\s+X-?[\d.]/i.test(l))
    expect(cutLines.length).toBeGreaterThan(0)
    const flatLateralCuts = cutLines.filter((l) => !/\bZ-?[\d.]/.test(l))
    expect(flatLateralCuts.length).toBeGreaterThan(0)
    const f800FlatCuts = flatLateralCuts.filter((l) => /\bF800\b/.test(l))
    const f300FlatCuts = flatLateralCuts.filter((l) => /\bF300\b/.test(l))
    expect(f800FlatCuts.length).toBeGreaterThan(0)
    expect(f300FlatCuts.length).toBe(0)
  })

  it('program ends with returnHome sequence (G0 Z Y0; G0 A0)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      finishDepthMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const len = result.lines.length
    expect(len).toBeGreaterThan(2)
    const last = result.lines[len - 1]!
    const secondLast = result.lines[len - 2]!
    expect(last).toMatch(/^G0\s+A0(?:\.\d+)?\s+;\s*return\s+A\s+to\s+home/i)
    expect(secondLast).toMatch(/^G0\s+Z[\d.]+\s+Y0\b/i)
  })

  it('overcutMm: 0 keeps cuts inside [machXStart, machXEnd]', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateFinishing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      finishDepthMm: -2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
      overcutMm: 0
    })
    const xs = extractAllXValues(result.lines)
    expect(xs.length).toBeGreaterThan(0)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    const cutLines = result.lines.filter((l) => /^G1\s+X-?[\d.]/i.test(l))
    expect(cutLines.length).toBeGreaterThan(0)
    // With overcut=0 the X range stays inside [machXStart, machXEnd] within
    // a 1-cell tolerance because the grid samples at the boundaries.
    expect(Math.max(...xs)).toBeLessThanOrEqual(60 + 0.05)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 0.05)
  })
})

