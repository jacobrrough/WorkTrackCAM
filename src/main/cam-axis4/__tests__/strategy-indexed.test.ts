/**
 * Strategy unit tests — indexed
 *
 * Verifies the discrete-A facing pass: for each angle in `indexAnglesDeg`,
 * face along X at every depth level. Alternates direction for zigzag.
 */
import { describe, expect, it } from 'vitest'
import { generateIndexed } from '../strategies/indexed'

describe('generateIndexed', () => {
  it('rotates A to each requested angle', () => {
    const angles = [0, 90, 180, 270]
    const result = generateIndexed({
      indexAnglesDeg: angles,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Every requested angle should appear in some G0 A line.
    const aVals = new Set<number>()
    for (const line of result.lines) {
      const m = line.match(/^G0\s+A(-?\d+(?:\.\d+)?)/)
      if (m) aVals.add(parseFloat(m[1]!))
    }
    for (const ang of angles) {
      expect(aVals.has(ang)).toBe(true)
    }
  })

  it('emits one "Index N/M" comment per angle per depth', () => {
    const angles = [0, 45, 90]
    const depths = [-2, -4]
    const result = generateIndexed({
      indexAnglesDeg: angles,
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: depths,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const indexComments = result.lines.filter((l) => /Index \d+\/\d+/.test(l))
    expect(indexComments.length).toBe(angles.length * depths.length)
  })

  it('alternates X direction (zigzag) between consecutive passes', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0, 90, 180, 270],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Capture the X target on each cutting move (G1 X…).
    const cutXs = result.lines
      .filter((l) => /^G1\s+X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutXs.length).toBeGreaterThanOrEqual(4)
    // The cut targets should alternate between the high and low ends.
    const distinctSorted = Array.from(new Set(cutXs.map((x) => x.toFixed(2)))).sort()
    expect(distinctSorted.length).toBeGreaterThanOrEqual(2)
  })

  it('chuck-face safety: never emits negative X', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0, 180],
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 20,
      zDepthsMm: [-2],
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
    const result = generateIndexed({
      indexAnglesDeg: [0],
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-15], // R = 10 + (-15) = -5 → below 0.05
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const cutLines = result.lines.filter((l) => /^G1\s+X-?[\d.]/.test(l))
    expect(cutLines.length).toBe(0)
  })
})




// ────────────────────────────────────────────────────────────────────────────
// [ID-0158] Indexed strategy edge-case + safety-emit invariants
// (DISCOVERED-2026-04-26 sibling-extension on Cycle 42 [ID-0010b] contour /
// Cycle 49 [ID-0010c] roughing / Cycle 58 [ID-0010d] finishing /
// Cycle 66 [ID-0157] continuous patterns).
// Pure test-only cycle: zero production-code edits.
// Tests pinning behavior of:
//   1. Header comment trio (4-axis-indexed summary + D=Ymm + VERIFY safety
//      reminder) emitted in fixed order BEFORE the first retractToClear.
//      The VERIFY comment is operator-facing safety; if it disappears, the
//      operator loses the "A zero, stock zero, each index angle" reminder.
//   2. Per-depth section separator literal pin: K non-skipped depths emit
//      exactly K `; --- indexed passes at Z_pass=Z ---` comments with Z
//      formatted to 3 decimals.
//   3. maxZMm clamps clearZ across the stream — every G0 Z line stays
//      <= maxZMm-1+epsilon (mirrors Cycle 66 [ID-0157] test 4 shape).
//   4. Direction alternation: exact-sequence pin on cut X targets across
//      consecutive passes — direction *= -1 after each pass, so cuts
//      alternate between extXEnd and extXStart in lockstep.
//   5. overcutMm threading: omitted defaults to toolDiameterMm, explicit
//      numeric value is used directly, and zero shrinks the cut extents to
//      the bare machXStartMm/machXEndMm. Verified by inspecting the first
//      cut target across three runs.
//   6. Chuck-face safety clamp: when machXStartMm - overcutMm < 0, the
//      raw extXStart would go negative; the strategy's `Math.max(0, ...)`
//      clamps it to exactly 0 (NOT a small positive number, NOT the raw
//      negative). Verified by exact-equality on the alternated cut target.
//   7. returnHome trailing emission: even when all depths are skipped
//      (cutZ < 0.05 -> no passes), the strategy still emits returnHome's
//      two-line tail (G0 Z<clearZ> Y0 + G0 A0 ; return A to home).
// ────────────────────────────────────────────────────────────────────────────

describe('generateIndexed -- edge-case + safety-emit invariants (DISCOVERED-2026-04-26 [ID-0158])', () => {
  it('emits header comment trio (summary + D + VERIFY safety) BEFORE the first retractToClear', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0, 90, 180, 270],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // Summary uses a literal U+2014 EM DASH between "indexed" and "4 angles";
    // the regex uses \u2014 to keep this test file ASCII-clean per
    // docs/EDIT-WORKFLOW.md R1.5 multi-byte UTF-8 trigger.
    const summaryIdx = result.lines.findIndex((l) =>
      /^; 4-axis indexed \u2014 4 angles, X=\[10\.00\.\.80\.00\] \+overcut /.test(l)
    )
    const dIdx = result.lines.findIndex((l) => /^; D=50\.0mm$/.test(l))
    const verifyIdx = result.lines.findIndex(
      (l) => l === '; VERIFY: A zero, stock zero, each index angle before running'
    )
    const firstG0Z = result.lines.findIndex((l) => /^G0\s+Z/.test(l))
    expect(summaryIdx).toBeGreaterThanOrEqual(0)
    expect(dIdx).toBeGreaterThan(summaryIdx)
    expect(verifyIdx).toBeGreaterThan(dIdx)
    expect(firstG0Z).toBeGreaterThan(verifyIdx)
  })

  it('emits exactly one "--- indexed passes at Z_pass=<z> ---" separator per non-skipped depth', () => {
    const depths = [-2, -4, -6]
    const result = generateIndexed({
      indexAnglesDeg: [0, 90],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: depths,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    const seps = result.lines.filter((l) => /^; --- indexed passes at Z_pass=/.test(l))
    expect(seps.length).toBe(depths.length)
    // Each separator carries the depth formatted to 3 decimals.
    expect(seps[0]).toBe('; --- indexed passes at Z_pass=-2.000 ---')
    expect(seps[1]).toBe('; --- indexed passes at Z_pass=-4.000 ---')
    expect(seps[2]).toBe('; --- indexed passes at Z_pass=-6.000 ---')
  })

  it('maxZMm clamps clearZ across the entire stream (every G0 Z stays <= maxZMm-1+epsilon)', () => {
    const result = generateIndexed({
      indexAnglesDeg: [0, 120, 240],
      cylinderDiameterMm: 30,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-2, -4],
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

  it('direction alternation: cut X targets toggle exactly between extXEnd and extXStart across consecutive passes', () => {
    // overcutMm=0 -> extXStart=10, extXEnd=80 (mach extents preserved).
    const result = generateIndexed({
      indexAnglesDeg: [0, 90, 180, 270],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
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
    // direction starts at 1 -> pass 1 cuts to extXEnd=80; direction flips ->
    // pass 2 cuts to extXStart=10; etc. Exact 4-element pin.
    expect(cutXs).toEqual([80, 10, 80, 10])
  })

  it('overcutMm threading: omitted defaults to toolDiameterMm, explicit value used directly, zero shrinks to mach extents', () => {
    const baseParams = {
      indexAnglesDeg: [0, 180],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    }
    const omit = generateIndexed(baseParams)
    const zero = generateIndexed({ ...baseParams, overcutMm: 0 })
    const explicit = generateIndexed({ ...baseParams, overcutMm: 5 })

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
    const result = generateIndexed({
      indexAnglesDeg: [0, 90],
      cylinderDiameterMm: 30,
      machXStartMm: 2,
      machXEndMm: 30,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
      overcutMm: 10
    })
    // direction=1 -> pass 1 cuts to extXEnd=40; direction=-1 -> pass 2 cuts
    // to extXStart=0 (clamped). The exact-equality on 0 is the load-bearing
    // pin: any future regression that drops Math.max(0, ...) or replaces it
    // with a small-positive floor goes red here.
    const cutXs = result.lines
      .filter((l) => /^G1\s+X-?[\d.]/.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
    expect(cutXs).toEqual([40, 0])
  })

  it('returnHome trailing emission survives empty-pass run (all depths cutZ<0.05)', () => {
    // cylinderDiameterMm=20 -> stockR=10. zDepthsMm=[-15] -> cutZ=10+(-15)=-5 < 0.05.
    // All passes skipped, but the strategy still calls returnHome().
    const result = generateIndexed({
      indexAnglesDeg: [0, 90, 180],
      cylinderDiameterMm: 20,
      machXStartMm: 10,
      machXEndMm: 60,
      zDepthsMm: [-15],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175
    })
    // returnHome emits exactly two trailing lines per emit.ts:228-232.
    const last2 = result.lines.slice(-2)
    expect(last2[0]).toMatch(/^G0\s+Z\d+(\.\d+)?\s+Y0$/)
    expect(last2[1]).toBe('G0 A0 ; return A to home')
    // No "Index N/M" comments (no passes ran).
    const idxComments = result.lines.filter((l) => /Index \d+\/\d+/.test(l))
    expect(idxComments.length).toBe(0)
    // No G1 cuts (all depths skipped).
    const cuts = result.lines.filter((l) => /^G1\s/.test(l))
    expect(cuts.length).toBe(0)
    // No depth separator emitted either (the `continue` branch fires before
    // the separator emit per indexed.ts:58-59).
    const seps = result.lines.filter((l) => /^; --- indexed passes/.test(l))
    expect(seps.length).toBe(0)
  })
})
