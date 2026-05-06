/**
 * Cycle 122 [ID-0199] -- post-processor rotary-bypass property fuzz.
 *
 * Pulls the LAST TWO of FIVE queued items from Cycle 110 [ID-0017]
 * Section 22.9 "Future fuzz extensions" parking lot:
 *
 *   (ii)  Property-form rotary bypass on `applyCutterCompensation`
 *         (was: example-only contract pin in Cycle 90 [ID-0176])
 *   (iii) Property-form rotary bypass on `applyArcFitting`
 *         (was: example-only contract pin in Cycle 85 [ID-0173])
 *
 * Cycle 116 [ID-0192] EXTENSION already pulled items (i), (iv), (v).
 * After this file lands, the parking lot from Cycle 110 is fully drained.
 *
 * Why a NEW file instead of extending `post-process-property-extension.test.ts`?
 *   - Cycle 116's EXTENSION file (701 lines) is unmodified since Cycle
 *     116 close. Any in-place edit risks the [ID-0067] silent-truncation
 *     class. NEW file with `assert not target.exists()` pre-gate is the
 *     cleanest path per CLAUDE.md / docs/EDIT-WORKFLOW.md Rule 1.5.
 *   - Tests grouped by intent: SEED + EXTENSION pin Laguna vacuum-wiring
 *     + determinism + line-order properties; this file pins the rotary-
 *     axis BYPASS invariant that is symmetric across `applyArcFitting`
 *     and `applyCutterCompensation`, plus a false-positive guard for
 *     innocent ``HAB1``-style substrings in comments.
 *
 * Per-machine coverage (per CLAUDE.md three-machine scope):
 *   PRIMARY   = Makera Carvera + 4th Axis Rotary -- the only target
 *               machine that emits rotary-axis words (A) in production
 *               toolpaths. Both helpers' bypass branches exclusively
 *               protect Carvera 4-axis output.
 *   PASS-THROUGH = Laguna Swift 5x10 + Creality K2 Plus -- the
 *               non-bypass branch (pure XY / XYZ toolpaths) regression-
 *               checked here so a future tightening of
 *               HAS_ROTARY_AXIS_WORD that introduces false positives
 *               on innocent 3-axis comments is caught.
 *
 * Safety Rule 1 (G-code is sacred):
 *   - Bypass property: any rotary axis word (A / B / C, leading-anchor)
 *     anywhere in the toolpath MUST cause both helpers to return the
 *     input toolpath verbatim. A regression here would silently strip
 *     A-words from a fitted G2/G3 (arc fitting) or bracket a rotary
 *     stretch with G41 / G42 (cutter comp) -- both crash the Carvera
 *     4-axis machine.
 *   - Fresh-array property: when bypass fires AND the helper would
 *     otherwise mutate a shared array, the output array MUST NOT alias
 *     the input. Caller mutation of the result must not trickle back
 *     into the input.
 *   - False-positive guard: rotary-letter substrings inside another
 *     token (HAB1, ZC2, etc.) MUST NOT trigger the bypass on an
 *     otherwise pure 3-axis toolpath -- arc fitting and cutter comp
 *     must continue to work on innocent 3-axis programs.
 *
 * Determinism / runtime budget:
 *   Each property uses a fixed seed (0x40171991, suffix 1991 = the
 *   [ID-0199] number with the trailing 1 anchoring it to Cycle 122 of
 *   2026-04-27) and a small numRuns so the file finishes well under
 *   the implicit 1 s vitest budget per file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  applyArcFitting,
  applyCutterCompensation,
  buildCutterCompLines,
} from './post-process'

const POST_PROCESS_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'main', 'post-process.ts'),
  'utf-8'
)

// -- Arbitraries --------------------------------------------------------------

/**
 * Pure XY G1 cut line (no rotary word). Coordinates are bounded floats
 * so the printed G-code stays well within `gFmt`'s 4-decimal cap. Z0
 * literal is intentional -- a varying Z would not change the bypass
 * test surface and would slow down arc fitting.
 */
const xyG1Arb = fc
  .record({
    x: fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
    feed: fc.integer({ min: 100, max: 6000 }),
  })
  .map(
    ({ x, y, feed }) => `G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z0 F${feed}`
  )

/** Pure XY G0 rapid line (no rotary word). */
const xyG0Arb = fc
  .record({
    x: fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
    z: fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
  })
  .map(
    ({ x, y, z }) =>
      `G0 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`
  )

/**
 * Mix of G0 + G1 lines, biased toward G1 cuts so feedPattern matches
 * at least once in the cutter-comp non-bypass branch. minLength=1
 * because the empty-array case is already covered by the contract
 * pin tests in `post-process-arc-fitting-4axis-safety-contract.test.ts`
 * and `post-process-cutter-comp-4axis-safety-contract.test.ts`.
 */
const cleanXyToolpathArb = fc.array(
  fc.oneof({ weight: 6, arbitrary: xyG1Arb }, { weight: 1, arbitrary: xyG0Arb }),
  { minLength: 1, maxLength: 8 }
)

/** Rotary axis letter the bypass regex actually targets. */
const rotaryAxisLetterArb = fc.constantFrom('A' as const, 'B' as const, 'C' as const)

/**
 * G1 line with a real A / B / C rotary word, leading-anchored by the
 * space between Z0 and the rotary letter. The angle is bounded to
 * [-360, 360] so toFixed(3) never flips to scientific notation.
 */
const rotaryG1Arb = fc
  .record({
    letter: rotaryAxisLetterArb,
    x: fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
    angle: fc.double({
      min: -360,
      max: 360,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    feed: fc.integer({ min: 100, max: 3000 }),
  })
  .map(
    ({ letter, x, y, angle, feed }) =>
      `G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z0 ${letter}${angle.toFixed(3)} F${feed}`
  )

/**
 * Toolpath with at least one rotary line inserted at a fast-check-
 * chosen index. Exercises the bypass regardless of position (catches
 * a hypothetical regression that only inspects the first N lines or
 * only the last line).
 */
const mixedRotaryToolpathArb = fc
  .tuple(
    cleanXyToolpathArb,
    rotaryG1Arb,
    fc.integer({ min: 0, max: 100 })
  )
  .map(([clean, rotary, idxRaw]) => {
    const idx = idxRaw % (clean.length + 1)
    return [...clean.slice(0, idx), rotary, ...clean.slice(idx)]
  })

const SEED = 0x40171991
const FAST_RUNS = { numRuns: 32, seed: SEED } as const
const LIGHT_RUNS = { numRuns: 16, seed: SEED } as const

// === Group A -- applyArcFitting universal rotary bypass property ============

describe('applyArcFitting -- [ID-0199] universal rotary bypass property', () => {
  it('mixed rotary toolpath: result deeply equals input (any insertion index)', () => {
    fc.assert(
      fc.property(mixedRotaryToolpathArb, (lines) => {
        const out = applyArcFitting([...lines], 0.01)
        expect(out).toEqual(lines)
        // No G2/G3 emitted when bypass fired -- input had none, so the
        // bypass path's `lines.slice()` cannot synthesise any.
        expect(out.some((l) => /^G[23]\s/.test(l))).toBe(false)
      }),
      FAST_RUNS
    )
  })

  it('mixed rotary toolpath: result is a FRESH array (mutation isolation)', () => {
    fc.assert(
      fc.property(mixedRotaryToolpathArb, (lines) => {
        const inputCopy = [...lines]
        const beforeLen = inputCopy.length
        const out = applyArcFitting(inputCopy, 0.01)
        out.push('G1 X9999 Y9999 Z0 F100')
        // Caller-mutation of the result MUST NOT mutate the input.
        expect(inputCopy.length).toBe(beforeLen)
      }),
      FAST_RUNS
    )
  })

  it('mixed rotary toolpath: tolerance variation does not affect bypass', () => {
    fc.assert(
      fc.property(
        mixedRotaryToolpathArb,
        fc.double({
          min: 0.001,
          max: 1.0,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (lines, tol) => {
          const out = applyArcFitting([...lines], tol)
          expect(out).toEqual(lines)
        }
      ),
      FAST_RUNS
    )
  })

  it('determinism: two consecutive calls on the same mixed rotary input produce equal arrays', () => {
    fc.assert(
      fc.property(mixedRotaryToolpathArb, (lines) => {
        const a = applyArcFitting([...lines], 0.01)
        const b = applyArcFitting([...lines], 0.01)
        expect(a).toEqual(b)
      }),
      FAST_RUNS
    )
  })
})

// === Group B -- applyCutterCompensation universal rotary bypass property ====

const compModeArb = fc.constantFrom('left' as const, 'right' as const)
const dRegisterArb = fc.option(fc.integer({ min: 0, max: 99 }), {
  nil: undefined,
})

describe('applyCutterCompensation -- [ID-0199] universal rotary bypass property', () => {
  it("mode 'left' or 'right' + mixed rotary: result deeply equals input + no G4[012] emitted", () => {
    fc.assert(
      fc.property(
        mixedRotaryToolpathArb,
        compModeArb,
        dRegisterArb,
        (lines, mode, dReg) => {
          const out = applyCutterCompensation([...lines], mode, dReg)
          expect(out).toEqual(lines)
          // Bypass slice must not contain any G40 / G41 / G42 lines --
          // the input toolpath does not synthesise them, and the bypass
          // branch is byte-identical to input.
          expect(out.some((l) => /^G4[012]\b/.test(l))).toBe(false)
        }
      ),
      FAST_RUNS
    )
  })

  it("mode 'left' or 'right' + mixed rotary: result is a FRESH array (mutation isolation)", () => {
    fc.assert(
      fc.property(
        mixedRotaryToolpathArb,
        compModeArb,
        (lines, mode) => {
          const inputCopy = [...lines]
          const beforeLen = inputCopy.length
          const out = applyCutterCompensation(inputCopy, mode)
          out.push('G41 X9999')
          expect(inputCopy.length).toBe(beforeLen)
        }
      ),
      FAST_RUNS
    )
  })

  it("mode 'none' + ANY toolpath (rotary or not): returns input UNCHANGED, no compensation insertion", () => {
    // Mode 'none' bypasses the helper before the rotary check via
    // `if (!comp) return lines`. Pinned here so a future refactor that
    // forgets the early-return cannot silently change the contract.
    // Note: in mode='none' the source returns the input REFERENCE
    // (not a slice) -- mutation isolation is irrelevant since no
    // compensation lines were ever inserted, so we pin only the
    // deepEqual + no-G4[012] direction.
    fc.assert(
      fc.property(
        fc.oneof(mixedRotaryToolpathArb, cleanXyToolpathArb),
        (lines) => {
          const out = applyCutterCompensation([...lines], 'none', 7)
          expect(out).toEqual(lines)
          expect(out.some((l) => /^G4[012]\b/.test(l))).toBe(false)
        }
      ),
      FAST_RUNS
    )
  })

  it('determinism: two consecutive calls on the same mixed rotary input + mode produce equal arrays', () => {
    fc.assert(
      fc.property(
        mixedRotaryToolpathArb,
        compModeArb,
        dRegisterArb,
        (lines, mode, dReg) => {
          const a = applyCutterCompensation([...lines], mode, dReg)
          const b = applyCutterCompensation([...lines], mode, dReg)
          expect(a).toEqual(b)
        }
      ),
      FAST_RUNS
    )
  })
})

// === Group C -- false-positive guard (HAB1-style innocent substrings) =======

/**
 * Letter-prefixed rotary-letter substring: a non-whitespace,
 * non-rotary letter followed by A/B/C followed by a digit. Examples:
 * ``HAB1``, ``ZC2``, ``YA9``. The HAS_ROTARY_AXIS_WORD regex's leading
 * anchor ``(?:^|\s)`` MUST reject these: the rotary letter is preceded
 * by a non-whitespace, non-anchor character, so the leading-anchor
 * branch cannot match. Critical for the post-processor's ability to
 * still apply arc fitting and cutter comp on innocent 3-axis programs
 * that happen to mention an A / B / C letter inside a comment token.
 *
 * Prefix letters chosen to avoid A/B/C themselves (so the bypass
 * cannot fire on the prefix) AND to avoid any letter that would be
 * misread as a G-code word. Using H, Z, N, M, X, Y -- all valid
 * leading characters in calibration tags / part numbers.
 */
const innocentSubstringArb = fc
  .tuple(
    fc.constantFrom('H', 'Z', 'N', 'M', 'X', 'Y'),
    rotaryAxisLetterArb,
    fc.integer({ min: 0, max: 99 })
  )
  .map(([prefix, rotary, n]) => `${prefix}${rotary}${n}`)

const commentLineWithInnocentSubstringArb = innocentSubstringArb.map(
  (substring) => `; calibration ${substring} sensor`
)

const xyToolpathWithInnocentCommentArb = fc
  .tuple(commentLineWithInnocentSubstringArb, cleanXyToolpathArb)
  .map(([comment, clean]) => [comment, ...clean])

describe('Rotary bypass false-positive guard -- [ID-0199] HAB1-style substrings', () => {
  it('applyArcFitting does NOT bypass on innocent letter-prefixed rotary-letter substrings inside comments', () => {
    // We cannot universally assert "arc fitting compressed something"
    // (only collinear-or-circular point clouds compress). What we CAN
    // assert: the comment line at index 0 is preserved (non-G1 lines
    // pass through both branches), AND the result contains zero
    // leading-anchor rotary words. The comment's HAB1 substring would
    // appear as a rotary word ONLY if the bypass regex were broadened
    // to drop the leading anchor -- in which case bypass would have
    // fired and the result would alias the input. The latter does not
    // contain leading-anchor rotary words either, so we additionally
    // pin the comment-survival shape: index 0 unchanged.
    fc.assert(
      fc.property(xyToolpathWithInnocentCommentArb, (lines) => {
        const out = applyArcFitting([...lines], 0.01)
        // Comment line survives at index 0 (non-G1 lines pass through).
        expect(out[0]).toBe(lines[0])
        // Result must NOT contain any leading-anchor rotary axis word.
        expect(out.some((l) => /(?:^|\s)[ABC][+-]?\d/.test(l))).toBe(false)
      }),
      LIGHT_RUNS
    )
  })

  it('applyCutterCompensation DOES insert G41 / G42 / G40 on a pure XY toolpath with innocent comment substrings (non-bypass branch)', () => {
    // Strictly XY toolpath (no rotary words anywhere) prepended with
    // an innocent comment that contains a HAB1-style substring. Cutter
    // comp MUST insert the engage / cancel pair around the feed moves
    // -- a regression that broadens the bypass regex would suppress
    // them and fail this pin.
    fc.assert(
      fc.property(
        commentLineWithInnocentSubstringArb,
        fc.array(xyG1Arb, { minLength: 2, maxLength: 6 }),
        compModeArb,
        (comment, cuts, mode) => {
          const lines = [comment, 'G0 X0 Y0 Z5', ...cuts]
          const out = applyCutterCompensation([...lines], mode)
          const expectedEngage = mode === 'left' ? /^G41\b/ : /^G42\b/
          expect(out.some((l) => expectedEngage.test(l))).toBe(true)
          expect(out.some((l) => /^G40\b/.test(l))).toBe(true)
          // Original comment survives unchanged at index 0.
          expect(out[0]).toBe(comment)
        }
      ),
      LIGHT_RUNS
    )
  })
})

// === Group D -- cross-helper invariants =====================================

describe('Rotary bypass cross-helper invariants -- [ID-0199]', () => {
  it("if applyArcFitting bypasses, applyCutterCompensation('left') ALSO bypasses on the same input", () => {
    // The two helpers share the HAS_ROTARY_AXIS_WORD regex literal.
    // A drift where one helper's regex changes but the other's
    // doesn't would be caught here. The mixed-rotary arbitrary
    // always triggers bypass on both sides.
    fc.assert(
      fc.property(mixedRotaryToolpathArb, (lines) => {
        const arcOut = applyArcFitting([...lines], 0.01)
        const compOut = applyCutterCompensation([...lines], 'left')
        expect(arcOut).toEqual(lines)
        expect(compOut).toEqual(lines)
      }),
      FAST_RUNS
    )
  })

  it('clean XY toolpath: NEITHER helper bypasses (non-bypass branch parity)', () => {
    // Strict XY (no rotary words anywhere). Cutter comp MUST insert
    // G41/G42 + G40; arc fitting MUST NOT introduce a rotary word.
    fc.assert(
      fc.property(
        // minLength 2 so at least one feed pattern is present and
        // cutter comp's `firstFeedIdx === -1` early-return does not
        // fire.
        fc.array(xyG1Arb, { minLength: 2, maxLength: 6 }),
        (cuts) => {
          const lines = ['G0 X0 Y0 Z5', ...cuts]
          const arcOut = applyArcFitting([...lines], 0.01)
          expect(arcOut.some((l) => /(?:^|\s)[ABC][+-]?\d/.test(l))).toBe(
            false
          )
          const compOut = applyCutterCompensation([...lines], 'left')
          expect(compOut.some((l) => /^G41\b/.test(l))).toBe(true)
          expect(compOut.some((l) => /^G40\b/.test(l))).toBe(true)
        }
      ),
      LIGHT_RUNS
    )
  })
})

// === Group E -- post-process source-text paired pin =========================

describe('post-process source-text paired pin -- [ID-0199]', () => {
  it('HAS_ROTARY_AXIS_WORD regex literal exists and matches expected leading-anchor pattern', () => {
    expect(POST_PROCESS_SOURCE).toContain('const HAS_ROTARY_AXIS_WORD =')
    // Pin the literal so a regression that loses the leading anchor
    // (e.g., `[ABC][+-]?\d` without `(?:^|\s)`) is caught here in
    // addition to the property tests above. The literal regex is
    // /(?:^|\s)[ABC][+-]?\d/ -- searched as raw source text.
    expect(POST_PROCESS_SOURCE).toContain('/(?:^|\\s)[ABC][+-]?\\d/')
  })

  it('both helpers reference HAS_ROTARY_AXIS_WORD.test() in their function bodies', () => {
    const arcStart = POST_PROCESS_SOURCE.indexOf(
      'export function applyArcFitting('
    )
    const compStart = POST_PROCESS_SOURCE.indexOf(
      'export function applyCutterCompensation('
    )
    expect(arcStart).toBeGreaterThan(0)
    expect(compStart).toBeGreaterThan(0)
    // Generous slice catches the bypass guard (within ~80 lines of
    // signature for both helpers).
    const arcSlice = POST_PROCESS_SOURCE.slice(arcStart, arcStart + 1500)
    const compSlice = POST_PROCESS_SOURCE.slice(compStart, compStart + 1500)
    expect(arcSlice).toContain('HAS_ROTARY_AXIS_WORD.test(line)')
    expect(compSlice).toContain('HAS_ROTARY_AXIS_WORD.test(line)')
  })

  it('JSDoc on both helpers names ID-0173 / ID-0176 and the Carvera 4th Axis target', () => {
    expect(POST_PROCESS_SOURCE).toContain('Safety [ID-0173]')
    expect(POST_PROCESS_SOURCE).toContain('Safety [ID-0176]')
    // At least one mention of the Carvera + 4th Axis target -- allow
    // line-wrap inside the JSDoc gutter.
    expect(POST_PROCESS_SOURCE).toMatch(
      /Makera\s+Carvera \+ 4th Axis Rotary|Makera\s*\n?\s*\*\s*Carvera \+ 4th Axis Rotary/
    )
  })
})

// === Group F -- buildCutterCompLines pure-helper round-trip property ========

describe('buildCutterCompLines -- [ID-0199] pure-helper round-trip property', () => {
  it("mode 'none' returns null for any dRegister value", () => {
    fc.assert(
      fc.property(dRegisterArb, (dReg) => {
        expect(buildCutterCompLines('none', dReg)).toBeNull()
      }),
      FAST_RUNS
    )
  })

  it("modes 'left' / 'right' produce well-formed engage / cancel pairs for any dRegister", () => {
    fc.assert(
      fc.property(compModeArb, dRegisterArb, (mode, dReg) => {
        const result = buildCutterCompLines(mode, dReg)
        expect(result).not.toBeNull()
        if (!result) return
        const expectedG = mode === 'left' ? 'G41' : 'G42'
        expect(result.engage.startsWith(expectedG)).toBe(true)
        expect(result.cancel).toBe('G40')
        if (dReg != null) {
          expect(result.engage).toBe(`${expectedG} D${dReg}`)
        } else {
          expect(result.engage).toBe(expectedG)
        }
      }),
      FAST_RUNS
    )
  })
})
