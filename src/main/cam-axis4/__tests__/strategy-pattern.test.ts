/**
 * Strategy unit tests — pattern (no-mesh fallback)
 *
 * Verifies the simple pattern-parallel routine used when no STL is provided:
 * for each Z depth, sweep A from 0 → 360 stepping by `stepoverDeg`, cutting
 * along X at each angle.
 */
import { describe, expect, it } from 'vitest'
import { generatePattern } from '../strategies/pattern'

describe('generatePattern', () => {
  it('emits one A rotation per stepover increment per depth', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 30,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // 360/30 = 12 + 1 (the inclusive end) = 13 rotations
    const aRotations = result.lines.filter((l) => /^G0\s+A-?[\d.]/.test(l))
    expect(aRotations.length).toBeGreaterThanOrEqual(12)
  })

  it('produces a header naming the strategy', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 30,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const header = result.lines.find((l) => l.includes('cylindrical parallel (pattern)'))
    expect(header).toBeDefined()
  })

  it('multiple Z depths each generate a depth comment', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2, -4, -6],
      stepoverDeg: 60,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const depthComments = result.lines.filter((l) => /Z depth/.test(l))
    expect(depthComments.length).toBe(3)
  })

  it('chuck-face safety: never emits negative X', () => {
    const result = generatePattern({
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 20,
      zDepthsMm: [-2],
      stepoverDeg: 90,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const xs = result.lines
      .filter((l) => /^G[01]\s+.*X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0)
  })

  it('skips depths whose target R < 0.05', () => {
    const result = generatePattern({
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-15], // R = 10 + (-15) = -5
      stepoverDeg: 60,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutLines = result.lines.filter((l) => /^G1\s+X-?[\d.]/.test(l))
    expect(cutLines.length).toBe(0)
  })
})





// ----------------------------------------------------------------------------
// [ID-0159] Pattern strategy edge-case + safety-emit invariants
// (DISCOVERED-2026-04-26 sibling-extension on Cycle 42 [ID-0010b] contour /
// Cycle 49 [ID-0010c] roughing / Cycle 58 [ID-0010d] finishing /
// Cycle 66 [ID-0157] continuous / Cycle 69 [ID-0158] indexed patterns).
// Pure test-only cycle: zero production-code edits. Closes the
// `cam-axis4/strategies/` 7-pin family at 5 of 5 (only `contour.ts` remains
// from the 6 strategy files; that one is already pinned via
// strategy-contour.test.ts which holds 11 tests of its own).
// Tests pinning behavior of:
//   1. Header pair (combined summary + VERIFY safety reminder) emitted in
//      fixed order BEFORE the first retractToClear. The VERIFY comment is
//      operator-facing safety; if it disappears, the operator loses the
//      "cylinder diameter, stock zero, A WCS home, chuck bounds" reminder.
//   2. Per-depth section separator literal pin: K non-skipped depths emit
//      exactly K `; --- Z depth Z mm (radial cut Z=R) ---` comments with
//      both Z and R formatted to 3 decimals.
//   3. maxZMm clamps clearZ across the stream (mirrors Cycle 66 [ID-0157]
//      test 4 / Cycle 69 [ID-0158] test 3 shape).
//   4. Direction alternation: exact-sequence pin on cut X targets across
//      consecutive passes -- direction *= -1 after each pass within the
//      A-angle loop, so cuts alternate between extXEnd and extXStart in
//      lockstep. The inclusive-end loop guard `aAngle <= 360 + 1e-6` means
//      stepoverDeg=90 emits 5 passes per depth, NOT 4.
//   5. overcutMm threading: omitted defaults to toolDiameterMm, explicit
//      numeric value is used directly, and zero shrinks the cut extents to
//      the bare machXStartMm/machXEndMm.
//   6. Chuck-face safety clamp: when machXStartMm - overcutMm < 0, the raw
//      extXStart would go negative; the strategy's `Math.max(0, ...)`
//      clamps it to exactly 0 (NOT a small positive number, NOT the raw
//      negative). Verified by exact-equality on the alternated cut target.
//   7. returnHome trailing emission: even when all depths are skipped
//      (cutZ < 0.05 -> no passes, no separator), the strategy still emits
//      returnHome's two-line tail (G0 Z<clearZ> Y0 + G0 A0 ; return A to
//      home).
// ----------------------------------------------------------------------------

describe('generatePattern -- edge-case + safety-emit invariants (DISCOVERED-2026-04-26 [ID-0159])', () => {
  it('emits header pair (combined summary + VERIFY safety) BEFORE the first retractToClear', () => {
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 30,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Summary uses a literal U+2014 EM DASH between "(pattern)" and "D=";
    // the regex uses \u2014 to keep this test file ASCII-clean per
    // docs/EDIT-WORKFLOW.md R1.5 multi-byte UTF-8 trigger. ocMm defaults to
    // toolDiameterMm=3.175 -> ocMm.toFixed(1)='3.2'. step.toFixed(1)='30.0'.
    const summaryIdx = result.lines.findIndex((l) =>
      /^; 4-axis cylindrical parallel \(pattern\) \u2014 D=50\.0mm, X=\[10\.00\.\.80\.00\] \+overcut 3\.2mm, Z levels=1, A step=30\.0/.test(l)
    )
    const verifyIdx = result.lines.findIndex(
      (l) => l === '; VERIFY: cylinder diameter, stock zero, A WCS home, chuck bounds'
    )
    const firstG0Z = result.lines.findIndex((l) => /^G0\s+Z/.test(l))
    expect(summaryIdx).toBeGreaterThanOrEqual(0)
    expect(verifyIdx).toBeGreaterThan(summaryIdx)
    expect(firstG0Z).toBeGreaterThan(verifyIdx)
  })

  it('emits exactly one "--- Z depth <z> mm (radial cut Z=<r>) ---" separator per non-skipped depth', () => {
    const depths = [-2, -4, -6]
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: depths,
      stepoverDeg: 90,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const seps = result.lines.filter((l) => /^; --- Z depth /.test(l))
    expect(seps.length).toBe(depths.length)
    // stockR = 25 mm; cutZ = 25 + depth; both Z and R formatted to 3 decimals.
    expect(seps[0]).toBe('; --- Z depth -2.000 mm (radial cut Z=23.000) ---')
    expect(seps[1]).toBe('; --- Z depth -4.000 mm (radial cut Z=21.000) ---')
    expect(seps[2]).toBe('; --- Z depth -6.000 mm (radial cut Z=19.000) ---')
  })

  it('maxZMm clamps clearZ across the entire stream (every G0 Z stays <= maxZMm-1+epsilon)', () => {
    const result = generatePattern({
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-2, -4],
      stepoverDeg: 120,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      maxZMm: 20, // raw clearZ = stockR(15)+safeZMm(10)=25; clamps to 20-1=19
      toolDiameterMm: 3.175
    })
    const g0Zs = result.lines
      .filter((l) => /^G0\s+.*\bZ-?[\d.]/i.test(l))
      .flatMap((l) => {
        const m = l.match(/\bZ(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(g0Zs.length).toBeGreaterThan(0)
    for (const z of g0Zs) expect(z).toBeLessThanOrEqual(20 - 1 + 1e-6)
  })

  it('direction alternation: cut X targets toggle between extXEnd and extXStart with inclusive 360 boundary (5 passes at step=90)', () => {
    // overcutMm=0 -> extXStart=10, extXEnd=80 (mach extents preserved).
    // Inclusive loop guard `aAngle <= 360 + 1e-6` -> step=90 emits passes at
    // 0, 90, 180, 270, 360 = 5 passes per depth.
    const result = generatePattern({
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 90,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
      overcutMm: 0
    })
    const cutXs = result.lines
      .filter((l) => /^G1\s+X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    // direction starts at 1 -> pass 1 cuts to extXEnd=80; flip -> pass 2 cuts
    // to extXStart=10; flip -> pass 3 cuts to extXEnd=80; flip -> pass 4
    // cuts to extXStart=10; flip -> pass 5 cuts to extXEnd=80.
    expect(cutXs).toEqual([80, 10, 80, 10, 80])
  })

  it('overcutMm threading: omitted defaults to toolDiameterMm, explicit value used directly, zero shrinks to mach extents', () => {
    const baseParams = {
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      stepoverDeg: 180,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const omit = generatePattern(baseParams)
    const zero = generatePattern({ ...baseParams, overcutMm: 0 })
    const explicit = generatePattern({ ...baseParams, overcutMm: 5 })

    const firstCutX = (lines: string[]): number => {
      for (const l of lines) {
        const m = l.match(/^G1\s+X(-?\d+(?:\.\d+)?)/)
        if (m) return parseFloat(m[1]!)
      }
      return NaN
    }
    // direction=1 -> first pass cuts to extXEnd = machXEndMm + ocMm.
    expect(firstCutX(omit.lines)).toBeCloseTo(80 + 3.175, 3)
    expect(firstCutX(zero.lines)).toBeCloseTo(80, 3)
    expect(firstCutX(explicit.lines)).toBeCloseTo(85, 3)
  })

  it('chuck-face safety: extXStart clamps to 0 when machXStartMm - overcutMm < 0 (NOT a small positive, NOT raw negative)', () => {
    // machXStartMm=2, overcutMm=10 -> raw extXStart = -8 -> Math.max(0, -8) = 0.
    // stepoverDeg=180 + inclusive 360 -> 3 passes. extXEnd = 30+10 = 40.
    const result = generatePattern({
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 30,
      zDepthsMm: [-2],
      stepoverDeg: 180,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
      overcutMm: 10
    })
    // direction=1 -> pass 1 cuts to extXEnd=40; flip -> pass 2 cuts to
    // extXStart=0 (clamped); flip -> pass 3 cuts to extXEnd=40. The
    // exact-equality on 0 is the load-bearing pin: any future regression
    // that drops Math.max(0, ...) or replaces it with a small-positive
    // floor goes red here.
    const cutXs = result.lines
      .filter((l) => /^G1\s+X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutXs).toEqual([40, 0, 40])
  })

  it('returnHome trailing emission survives empty-pass run (all depths cutZ<0.05)', () => {
    // cylinderDiameterMm=20 -> stockR=10. zDepthsMm=[-15] -> cutZ=10+(-15)=-5 < 0.05.
    // All passes skipped (the `continue` fires BEFORE the separator emit per
    // pattern.ts:58-59), but the strategy still calls returnHome().
    const result = generatePattern({
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-15],
      stepoverDeg: 90,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // returnHome emits exactly two trailing lines per emit.ts:228-232.
    const last2 = result.lines.slice(-2)
    expect(last2[0]).toMatch(/^G0\s+Z\d+(\.\d+)?\s+Y0$/)
    expect(last2[1]).toBe('G0 A0 ; return A to home')
    // No "Pass N  A=" comments (no passes ran).
    const passComments = result.lines.filter((l) => /Pass \d+\s+A=/.test(l))
    expect(passComments.length).toBe(0)
    // No G1 cuts (all depths skipped).
    const cuts = result.lines.filter((l) => /^G1\s/.test(l))
    expect(cuts.length).toBe(0)
    // No depth separator emitted either (the `continue` branch fires before
    // the separator emit per pattern.ts:58-59).
    const seps = result.lines.filter((l) => /^; --- Z depth /.test(l))
    expect(seps.length).toBe(0)
  })
})


// ----------------------------------------------------------------------------
// [ID-0306] Cycle 234 — pattern.ts non-positive / non-finite stepover guard
// pattern is the dispatch fallback (index.ts `default` case, reached by any
// FOUR_AXIS kind not explicitly switched). Unlike roughing/finishing it does
// NOT clamp stepoverDeg, and its `while (aAngle <= 360) { aAngle += step }`
// loop would spin the MAIN process forever on a step <= 0 or NaN. The guard
// emits zero passes + a warning instead of hanging, while leaving every valid
// step > 0 (including the coarse 120/180 the [ID-0159] pins use) byte-identical.
// ----------------------------------------------------------------------------
describe('generatePattern -- non-positive / non-finite stepover guard ([ID-0306])', () => {
  const baseParams = {
    cylinderDiameterMm: 50,
    machXStartMm: 10,
    machXEndMm: 80,
    zDepthsMm: [-2, -4],
    feedMmMin: 800,
    plungeMmMin: 300,
    safeZMm: 10,
    toolDiameterMm: 3.175
  }

  for (const bad of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`stepoverDeg=${String(bad)} terminates with zero passes + a warning (no infinite loop)`, () => {
      // If the guard regressed, this test would hang until vitest's timeout
      // rather than passing — the assertions below only run because the call
      // returned.
      const result = generatePattern({ ...baseParams, stepoverDeg: bad })
      expect(result.lines.filter((l) => /^G1\s/.test(l)).length).toBe(0)
      expect(result.lines.filter((l) => /Pass \d+\s+A=/.test(l)).length).toBe(0)
      expect(result.lines.filter((l) => /^; --- Z depth /.test(l)).length).toBe(0)
      // A clear warning names the stepover so the operator knows why the
      // program homes without cutting.
      expect(result.warnings.some((w) => /stepover/i.test(w))).toBe(true)
      // Header + returnHome tail still emitted (a valid, safe no-op program).
      expect(result.lines.some((l) => l.includes('cylindrical parallel (pattern)'))).toBe(true)
      expect(result.lines[result.lines.length - 1]).toBe('G0 A0 ; return A to home')
    })
  }

  it('valid stepover (30) still emits passes and no stepover warning (regression)', () => {
    const result = generatePattern({ ...baseParams, stepoverDeg: 30 })
    expect(result.lines.filter((l) => /^G1\s/.test(l)).length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => /stepover must be/i.test(w))).toBe(false)
  })

  it('coarse stepover > 90 (180) is preserved, not clamped ([ID-0159] compatibility)', () => {
    // overcutMm=0 -> extXStart=10, extXEnd=80. step=180 over one depth emits
    // passes at A=0/180/360 = 3 cuts; direction alternates 80 -> 10 -> 80.
    const result = generatePattern({
      ...baseParams,
      zDepthsMm: [-2],
      stepoverDeg: 180,
      overcutMm: 0
    })
    const cutXs = result.lines
      .filter((l) => /^G1\s+X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutXs).toEqual([80, 10, 80])
  })
})
