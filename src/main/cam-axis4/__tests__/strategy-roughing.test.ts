/**
 * Strategy unit tests — roughing
 *
 * Ported from `cam-axis4-realworld.test.ts` (the centered case + envelope
 * protection cases). The new strategy receives triangles ALREADY in machine
 * frame, so the off-center / ground-plane / auto-centering cases from the
 * old tests are now covered by `frame.test.ts` instead.
 *
 * These tests assert outcome-level behavior:
 *   - mesh hits produce variable cut Z values (proves the heightmap is used)
 *   - multiple depth levels produce multiple "Roughing: depth …" comments
 *   - cut Z values stay inside `[0, stockRadius + tolerance]` even at angles
 *     where the mesh is absent (envelope protection)
 *   - chuck-face safety: no negative X anywhere
 */
import { describe, expect, it } from 'vitest'
import { generateRoughing } from '../strategies/roughing'
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
  // bottom
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMin], [xMax, yMax, zMin]])
  tris.push([[xMin, yMin, zMin], [xMax, yMax, zMin], [xMin, yMax, zMin]])
  // top
  tris.push([[xMin, yMin, zMax], [xMax, yMax, zMax], [xMax, yMin, zMax]])
  tris.push([[xMin, yMin, zMax], [xMin, yMax, zMax], [xMax, yMax, zMax]])
  // -X face
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMin], [xMin, yMax, zMax]])
  tris.push([[xMin, yMin, zMin], [xMin, yMax, zMax], [xMin, yMin, zMax]])
  // +X face
  tris.push([[xMax, yMin, zMin], [xMax, yMax, zMax], [xMax, yMax, zMin]])
  tris.push([[xMax, yMin, zMin], [xMax, yMin, zMax], [xMax, yMax, zMax]])
  // -Y face
  tris.push([[xMin, yMin, zMin], [xMax, yMin, zMax], [xMax, yMin, zMin]])
  tris.push([[xMin, yMin, zMin], [xMin, yMin, zMax], [xMax, yMin, zMax]])
  // +Y face
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMin], [xMax, yMax, zMax]])
  tris.push([[xMin, yMax, zMin], [xMax, yMax, zMax], [xMin, yMax, zMax]])
  return tris
}

function extractG1ZValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G1\s+.*Z[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/Z(\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

function extractAllXValues(lines: string[]): number[] {
  return lines
    .filter((l) => /^G[01]\s+.*X-?[\d.]/i.test(l))
    .flatMap((l) => {
      const m = l.match(/X(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
}

describe('generateRoughing', () => {
  it('centered box: gets mesh hits, variable Z depths', () => {
    // Box centered on the rotation axis: Y∈[-8,8], Z∈[-8,8]
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateRoughing({
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
    const g1 = result.lines.filter((l) => l.startsWith('G1'))
    const zVals = extractG1ZValues(result.lines)
    expect(g1.length).toBeGreaterThan(10)
    // Variable Z values prove the mesh heightmap is feeding the cut depths.
    const uniqueZ = new Set(zVals.map((z) => z.toFixed(2)))
    expect(uniqueZ.size).toBeGreaterThan(2)
  })

  it('produces multiple depth levels', () => {
    const tris = makeBox(10, 80, -8, 8, -8, 8)
    const result = generateRoughing({
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
    const roughComments = result.lines.filter((l) => l.includes('Roughing: depth'))
    expect(roughComments.length).toBeGreaterThanOrEqual(2)
  })

  it('mesh-envelope protection: cut Z stays inside stock cylinder', () => {
    // Small partial mesh: the upper half only, Y∈[-4,4], Z∈[0,8].
    // At angles where the mesh is absent the engine cuts at the waterline
    // depth — but it must never produce a Z deeper than `stockRadius + tol`.
    const tris = makeBox(10, 80, -4, 4, 0, 8)
    const cylinderDiameterMm = 40
    const toolDiameterMm = 3.175
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm,
      machXStartMm: 10,
      machXEndMm: 80,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-10, -15],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 15,
      toolDiameterMm
    })
    const zVals = extractG1ZValues(result.lines)
    expect(zVals.length).toBeGreaterThan(0)
    const cylR = cylinderDiameterMm / 2
    const minZ = Math.min(...zVals)
    const maxZ = Math.max(...zVals)
    expect(minZ).toBeGreaterThanOrEqual(0)
    expect(maxZ).toBeLessThanOrEqual(cylR + toolDiameterMm)
  })

  it('chuck-face safety: never emits negative X', () => {
    const tris = makeBox(2, 20, -5, 5, -5, 5)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 20,
      stepoverDeg: 30,
      stepXMm: 3,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const xs = extractAllXValues(result.lines)
    expect(xs.length).toBeGreaterThan(0)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
  })

  it('emits a comment header naming the strategy', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('cylindrical roughing'))
    expect(header).toBeDefined()
  })

  it('returns warnings array (may be empty for nominal jobs)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    expect(Array.isArray(result.warnings)).toBe(true)
  })
})


// ────────────────────────────────────────────────────────────────────────────
// [ID-0010c] Roughing strategy edge-case + safety-emit invariants
// (DISCOVERED-2026-04-25 sibling-extension on Cycle 42 [ID-0010b]
// strategy-contour pattern). Pure test-only cycle: zero production-code edits.
// Tests pinning behavior of:
//   1. finishAllowanceMm leaves additional radial material on the mesh surface
//   2. maxZMm clamps clearZ so no rapid Z exceeds maxZMm-1
//   3. adaptiveRefinement: true produces additional A angles outside the
//      regular stepoverDeg grid
//   4. plunge G1 Z lines use plungeMmMin feed (NOT cut feed)
//   5. cut G1 X lines declare feedMmMin and never plungeMmMin
//   6. returnHome trailing-line sequence (G0 Z Y0; G0 A0)
//   7. overcutMm: 0 still produces valid passes within [machXStart, machXEnd]
// ────────────────────────────────────────────────────────────────────────────
describe('generateRoughing -- edge-case + safety-emit invariants (DISCOVERED-2026-04-25 [ID-0010c])', () => {
  it('finishAllowanceMm shifts the cut-Z distribution upward', () => {
    // The allowance bumps cuts wherever the surface limit dominates
    // (`cutZ = max(compR + allowance, targetCutR)`). The waterline floor and
    // the no-mesh cells are unaffected, so we expect SET (zWithAllow) to
    // include at least one G1-Z value larger than max(zNoAllow), proving the
    // allowance term is reaching the cut depth selection. We also assert
    // that mean(zWithAllow) >= mean(zNoAllow) (allowance can only push cuts
    // shallower-from-axis = larger Z value).
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const baseParams = {
      triangles: tris,
      cylinderDiameterMm: 30, // stockR = 15
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-6, -10],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const noAllowance = generateRoughing(baseParams)
    const withAllowance = generateRoughing({ ...baseParams, finishAllowanceMm: 4 })

    const zNoAllow = extractG1ZValues(noAllowance.lines)
    const zWithAllow = extractG1ZValues(withAllowance.lines)
    expect(zNoAllow.length).toBeGreaterThan(0)
    expect(zWithAllow.length).toBeGreaterThan(0)

    const maxNoAllow = Math.max(...zNoAllow)
    const maxWithAllow = Math.max(...zWithAllow)
    // With allowance=4 the corner cuts shift up by ~4mm relative to baseline
    // wherever compR > targetCutR - allowance. Pin the strict ordering.
    expect(maxWithAllow).toBeGreaterThan(maxNoAllow + 0.5)

    const meanNoAllow = zNoAllow.reduce((a, b) => a + b, 0) / zNoAllow.length
    const meanWithAllow = zWithAllow.reduce((a, b) => a + b, 0) / zWithAllow.length
    expect(meanWithAllow).toBeGreaterThanOrEqual(meanNoAllow)
  })

  it('maxZMm clamps clearZ -- no rapid Z above maxZMm - 1', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30, // stockR = 15
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10, // raw clearZ = 25, would normally clamp to maxZMm - 1
      maxZMm: 20, // clamped clearZ = min(25, 19) = 19
      toolDiameterMm: 3.175
    })
    const allG0Z = result.lines
      .filter((l) => /^G0\s+Z[\d.]/i.test(l))
      .flatMap((l) => {
        const m = l.match(/Z(\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(allG0Z.length).toBeGreaterThan(0)
    // Every rapid-Z must respect the maxZMm-1 cap.
    expect(Math.max(...allG0Z)).toBeLessThanOrEqual(20 - 1 + 1e-6)
  })

  it('adaptiveRefinement: true inserts extra A angles outside the stepover grid', () => {
    // Square cross-section has 4 sharp corners -> high angular curvature at
    // those bands. buildAdaptiveAngles inserts midpoint passes there, so the
    // total count of G0 A lines must exceed the non-adaptive baseline.
    const tris = makeBox(10, 60, -8, 8, -8, 8)
    const baseParams = {
      triangles: tris,
      cylinderDiameterMm: 40,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 15, // base na ~ 24
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const without = generateRoughing(baseParams)
    const withAdaptive = generateRoughing({ ...baseParams, adaptiveRefinement: true })

    const aWithout = without.lines.filter((l) => /^G0\s+A/i.test(l)).length
    const aWithAdaptive = withAdaptive.lines.filter((l) => /^G0\s+A/i.test(l)).length
    expect(aWithAdaptive).toBeGreaterThan(aWithout)
  })

  it('plunge G1 Z lines use plungeMmMin feed (not cut feed)', () => {
    const tris = makeBox(10, 60, -6, 6, -6, 6)
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Pure-plunge lines (G1 Z<...> F<...> with no X) come from emit.plungeZ().
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
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Lateral cuts at constant Z (G1 X<...> with no Z word -- the emitter
    // omits Z when |dz| <= 0.005 mm) use the cut feed by construction. A
    // deepening lateral cut > 0.5 mm intentionally borrows the plunge feed
    // (see emit.cutTo()), so we exclude those by filtering for "no Z word"
    // cut lines. Among constant-Z lateral cuts, F800 must be declared at
    // least once (after each plunge, the cut feed is emitted), and F300
    // must NEVER appear (that would mean a flat lateral move is misusing
    // plunge feed).
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
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
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
    const result = generateRoughing({
      triangles: tris,
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      stepoverDeg: 30,
      stepXMm: 5,
      zDepthsMm: [-2],
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
    // With overcut=0 the X range stays inside [machXStart, machXEnd] (within
    // a 1-cell tolerance because the grid samples at the boundaries).
    expect(Math.max(...xs)).toBeLessThanOrEqual(60 + 0.05)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 0.05)
  })
})
