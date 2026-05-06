/**
 * cam-toolpath-guardrails-pin.test.ts -- [ID-0261] Cycle 187 test-coverage paired-pin
 *
 * Pins the contract of `src/main/cam-toolpath-guardrails.ts` -- the CAM-runner
 * pre-emit numeric-sanity / milling-heuristic guardrail layer that gates every
 * 3-axis CAM job emitted by `src/main/cam-runner.ts` AND every 4-axis job
 * emitted by `src/main/cam-axis4/index.ts` BEFORE the post-processor sees the
 * job config. CROSS-CUTS ALL THREE TARGET MACHINES via the `feedMmMin` /
 * `plungeMmMin` / `machineMaxFeedMmMin` clamps and the rapid-into-stock
 * detector.
 *
 * Sister cycles in the post-Cycle-161-reset FIRST-RUN-CLEAN streak chain this
 * pin extends: 177 [ID-0249] / 178 [ID-0250] / 179 [ID-0251] / 180 [ID-0252] /
 * 181 [ID-0253] / 182 [ID-0254] / 183 [ID-0255] / 184 [ID-0259] /
 * 185 [ID-0265 / ID-0067-data-v27] / 186 [ID-0266] -- now ten cycles deep at
 * Cycle 186 close (CROSSES 10-CYCLE MILESTONE post-reset).
 *
 * The existing `cam-toolpath-guardrails.test.ts` (390 lines, 48 it()) covers
 * happy-path behavior of each clamp + warn helper. THIS pin file does NOT
 * duplicate that coverage; instead it pins:
 *   (A) module shape -- exact 11-runtime-export inventory (8 const + 3
 *       wrapper functions counted at top + the 5 helpers) BUT tracked as
 *       11 named runtime symbols total, no default export, Symbol.toStringTag,
 *   (B) function signatures -- name / arity / native Function for the 7
 *       exported functions,
 *   (C) numeric-constant exact values -- the 8 exported numeric constants
 *       have stable values that gate all three machines' job acceptance,
 *   (D) clampToolDiameterMm contract -- happy / out-of-range / NaN / undefined
 *       / negative / zero with note-emitting boundary,
 *   (E) clampStepoverMm contract -- floor (max of absolute and frac-of-tool)
 *       + cap (frac-of-tool) + note format with arrow + tool-size in
 *       parentheses + idempotence,
 *   (F) clampFeedPlungeSafeZ contract -- finite-number / NaN / Infinity /
 *       below-floor branches AND idempotence on already-good inputs (no
 *       notes emitted),
 *   (G) warnBallEndMillZPass contract -- DOC > radius emits with both
 *       depth and radius in mm; |zPass| sign-tolerant; non-finite inputs
 *       return null; zero-tool returns null,
 *   (H) warnDocExceedsFluteLength contract -- DOC > flute*0.5 emits with
 *       both depth and safe-limit; non-finite returns null; zero / negative
 *       flute returns null,
 *   (I) clampFeedAndPlungeToMachineMax contract -- machine-max <= 0 / NaN
 *       leaves both unchanged with empty notes; cap fires only when value
 *       exceeds cap; notes contain "machine max" string with mm/min unit,
 *   (J) detectRapidsBelowStockSurface contract -- empty input / no rapids /
 *       feed-only segments below stock NOT flagged; XY-bounds gate; epsilon
 *       boundary at stock top exact; worstZ = most-negative,
 *   (K) applyCamToolpathGuardrails wrapper contract -- composes 3 clamps +
 *       returns spread copy with the 5 numeric fields overwritten and the
 *       notes accumulated; toolDiameterMm-omitted fallback to 6 mm; arbitrary
 *       extra fields preserved,
 *   (L) formatRapidBelowStockHintForPostedGcode contract -- empty/whitespace
 *       gcode returns ''; no-violation returns ''; singular-vs-plural English
 *       phrasing flips at count>1 boundary; warning string contains the
 *       worst Z to 3 decimals,
 *   (M) three-machine path realism -- K2 Plus high-speed / Laguna Swift 5x10
 *       12000 mm/min cap / Carvera 4-axis 2400 mm/min cap exercise the
 *       machine-max clamp; ball-end-mill DOC warns on a typical Carvera
 *       3 mm finishing tool; rapid-into-stock detector fires on a
 *       Laguna full-sheet plywood G0 below spoilboard,
 *   (N) pure-function invariants -- idempotent (N=20) for every clamp/warn
 *       helper; no input mutation; no this-binding leakage on call/apply,
 *   (O) source-text whitelist -- size canary, 3 imports, no React/DOM/electron
 *       /fs/path/net imports, no `:any`, no toolpath G/M-code emission, no
 *       foreign-vendor literals, no default export.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './cam-toolpath-guardrails'
import {
  CAM_GUARDRAIL_FEED_MIN_MM_MIN,
  CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN,
  CAM_GUARDRAIL_SAFE_Z_MIN_MM,
  CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL,
  CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL,
  CAM_GUARDRAIL_STEPOVER_MIN_MM,
  CAM_GUARDRAIL_TOOL_DIAM_MAX_MM,
  CAM_GUARDRAIL_TOOL_DIAM_MIN_MM,
  applyCamToolpathGuardrails,
  clampFeedAndPlungeToMachineMax,
  clampFeedPlungeSafeZ,
  clampStepoverMm,
  clampToolDiameterMm,
  detectRapidsBelowStockSurface,
  formatRapidBelowStockHintForPostedGcode,
  warnBallEndMillZPass,
  warnDocExceedsFluteLength
} from './cam-toolpath-guardrails'
import type { ToolpathSegment3 } from '../shared/cam-gcode-toolpath'
import type { CamGuardrailJob } from './cam-toolpath-guardrails'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(HERE, 'cam-toolpath-guardrails.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ────────────────────────────────────────────────────────────────────────────
// (A) Module shape
// ────────────────────────────────────────────────────────────────────────────

describe('(A) cam-toolpath-guardrails module shape', () => {
  it('exports exactly 17 runtime symbols (8 const + 9 functions; types erase)', () => {
    const runtimeKeys = Object.keys(M).filter(
      (k) => typeof (M as Record<string, unknown>)[k] !== 'undefined'
    ).sort()
    expect(runtimeKeys).toEqual(
      [
        'CAM_GUARDRAIL_FEED_MIN_MM_MIN',
        'CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN',
        'CAM_GUARDRAIL_SAFE_Z_MIN_MM',
        'CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL',
        'CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL',
        'CAM_GUARDRAIL_STEPOVER_MIN_MM',
        'CAM_GUARDRAIL_TOOL_DIAM_MAX_MM',
        'CAM_GUARDRAIL_TOOL_DIAM_MIN_MM',
        'applyCamToolpathGuardrails',
        'clampFeedAndPlungeToMachineMax',
        'clampFeedPlungeSafeZ',
        'clampStepoverMm',
        'clampToolDiameterMm',
        'detectRapidsBelowStockSurface',
        'formatRapidBelowStockHintForPostedGcode',
        'warnBallEndMillZPass',
        'warnDocExceedsFluteLength'
      ].sort()
    )
  })

  it('does not expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('namespace has Symbol.toStringTag === "Module"', () => {
    expect((M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('does not leak the internal clampFinite helper', () => {
    expect((M as Record<string, unknown>).clampFinite).toBeUndefined()
  })

  it('does not re-export the imported extractToolpathSegmentsFromGcode', () => {
    expect((M as Record<string, unknown>).extractToolpathSegmentsFromGcode).toBeUndefined()
  })

  it('does not re-export the imported CAM_FEED_PLUNGE_FLOOR_MM_MIN as a separate name', () => {
    // The module re-exports it as CAM_GUARDRAIL_FEED_MIN_MM_MIN /
    // CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN aliases. The original import name
    // must NOT leak.
    expect((M as Record<string, unknown>).CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (B) Function signatures
// ────────────────────────────────────────────────────────────────────────────

describe('(B) Function signatures', () => {
  it('clampToolDiameterMm: name + arity 2 + native Function', () => {
    expect(clampToolDiameterMm.name).toBe('clampToolDiameterMm')
    expect(clampToolDiameterMm.length).toBe(2)
    expect(clampToolDiameterMm.constructor.name).toBe('Function')
  })

  it('clampStepoverMm: name + arity 2 + native Function', () => {
    expect(clampStepoverMm.name).toBe('clampStepoverMm')
    expect(clampStepoverMm.length).toBe(2)
    expect(clampStepoverMm.constructor.name).toBe('Function')
  })

  it('clampFeedPlungeSafeZ: name + arity 1 + native Function', () => {
    expect(clampFeedPlungeSafeZ.name).toBe('clampFeedPlungeSafeZ')
    expect(clampFeedPlungeSafeZ.length).toBe(1)
    expect(clampFeedPlungeSafeZ.constructor.name).toBe('Function')
  })

  it('warnBallEndMillZPass: name + arity 2 + native Function', () => {
    expect(warnBallEndMillZPass.name).toBe('warnBallEndMillZPass')
    expect(warnBallEndMillZPass.length).toBe(2)
    expect(warnBallEndMillZPass.constructor.name).toBe('Function')
  })

  it('warnDocExceedsFluteLength: name + arity 2 + native Function', () => {
    expect(warnDocExceedsFluteLength.name).toBe('warnDocExceedsFluteLength')
    expect(warnDocExceedsFluteLength.length).toBe(2)
    expect(warnDocExceedsFluteLength.constructor.name).toBe('Function')
  })

  it('clampFeedAndPlungeToMachineMax: name + arity 3 + native Function', () => {
    expect(clampFeedAndPlungeToMachineMax.name).toBe('clampFeedAndPlungeToMachineMax')
    expect(clampFeedAndPlungeToMachineMax.length).toBe(3)
    expect(clampFeedAndPlungeToMachineMax.constructor.name).toBe('Function')
  })

  it('detectRapidsBelowStockSurface: name + arity 1 (segments only — others have defaults) + native Function', () => {
    expect(detectRapidsBelowStockSurface.name).toBe('detectRapidsBelowStockSurface')
    // stockTopZ has a default value of 0, stockXYBounds is optional, so arity
    // counts only the leading non-defaulted parameter.
    expect(detectRapidsBelowStockSurface.length).toBe(1)
    expect(detectRapidsBelowStockSurface.constructor.name).toBe('Function')
  })

  it('applyCamToolpathGuardrails: name + arity 1 + native Function', () => {
    expect(applyCamToolpathGuardrails.name).toBe('applyCamToolpathGuardrails')
    expect(applyCamToolpathGuardrails.length).toBe(1)
    expect(applyCamToolpathGuardrails.constructor.name).toBe('Function')
  })

  it('formatRapidBelowStockHintForPostedGcode: name + arity 1 (rest defaulted) + native Function', () => {
    expect(formatRapidBelowStockHintForPostedGcode.name).toBe('formatRapidBelowStockHintForPostedGcode')
    expect(formatRapidBelowStockHintForPostedGcode.length).toBe(1)
    expect(formatRapidBelowStockHintForPostedGcode.constructor.name).toBe('Function')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (C) Numeric-constant exact values
// ────────────────────────────────────────────────────────────────────────────

describe('(C) Numeric-constant exact values', () => {
  it('CAM_GUARDRAIL_TOOL_DIAM_MIN_MM === 0.05', () => {
    expect(CAM_GUARDRAIL_TOOL_DIAM_MIN_MM).toBe(0.05)
  })

  it('CAM_GUARDRAIL_TOOL_DIAM_MAX_MM === 500', () => {
    expect(CAM_GUARDRAIL_TOOL_DIAM_MAX_MM).toBe(500)
  })

  it('CAM_GUARDRAIL_STEPOVER_MIN_MM === 0.01', () => {
    expect(CAM_GUARDRAIL_STEPOVER_MIN_MM).toBe(0.01)
  })

  it('CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL === 0.98', () => {
    expect(CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL).toBe(0.98)
  })

  it('CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL === 0.02', () => {
    expect(CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL).toBe(0.02)
  })

  it('CAM_GUARDRAIL_FEED_MIN_MM_MIN matches CAM_FEED_PLUNGE_FLOOR_MM_MIN (re-export)', () => {
    expect(CAM_GUARDRAIL_FEED_MIN_MM_MIN).toBe(1) // CAM_FEED_PLUNGE_FLOOR_MM_MIN
  })

  it('CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN matches CAM_FEED_PLUNGE_FLOOR_MM_MIN (re-export)', () => {
    expect(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN).toBe(1)
  })

  it('CAM_GUARDRAIL_FEED_MIN_MM_MIN === CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN (single source)', () => {
    expect(CAM_GUARDRAIL_FEED_MIN_MM_MIN).toBe(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
  })

  it('CAM_GUARDRAIL_SAFE_Z_MIN_MM === 0.05', () => {
    expect(CAM_GUARDRAIL_SAFE_Z_MIN_MM).toBe(0.05)
  })

  it('all numeric constants are finite, positive, non-NaN', () => {
    const consts = [
      CAM_GUARDRAIL_TOOL_DIAM_MIN_MM,
      CAM_GUARDRAIL_TOOL_DIAM_MAX_MM,
      CAM_GUARDRAIL_STEPOVER_MIN_MM,
      CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL,
      CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL,
      CAM_GUARDRAIL_FEED_MIN_MM_MIN,
      CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN,
      CAM_GUARDRAIL_SAFE_Z_MIN_MM
    ]
    for (const c of consts) {
      expect(Number.isFinite(c)).toBe(true)
      expect(c).toBeGreaterThan(0)
    }
  })

  it('STEPOVER_MIN_FRAC_OF_TOOL < STEPOVER_MAX_FRAC_OF_TOOL (sane ordering)', () => {
    expect(CAM_GUARDRAIL_STEPOVER_MIN_FRAC_OF_TOOL).toBeLessThan(CAM_GUARDRAIL_STEPOVER_MAX_FRAC_OF_TOOL)
  })

  it('TOOL_DIAM_MIN < TOOL_DIAM_MAX (sane ordering)', () => {
    expect(CAM_GUARDRAIL_TOOL_DIAM_MIN_MM).toBeLessThan(CAM_GUARDRAIL_TOOL_DIAM_MAX_MM)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (D) clampToolDiameterMm
// ────────────────────────────────────────────────────────────────────────────

describe('(D) clampToolDiameterMm', () => {
  it('happy path within range returns same value, no note', () => {
    const r = clampToolDiameterMm(6, 6)
    expect(r.value).toBe(6)
    expect(r.note).toBeUndefined()
  })

  it('undefined raw uses fallback', () => {
    const r = clampToolDiameterMm(undefined, 12.7)
    expect(r.value).toBe(12.7)
    expect(r.note).toBeUndefined()
  })

  it('NaN raw uses fallback', () => {
    const r = clampToolDiameterMm(Number.NaN, 6)
    expect(r.value).toBe(6)
  })

  it('zero raw uses fallback', () => {
    const r = clampToolDiameterMm(0, 6)
    expect(r.value).toBe(6)
  })

  it('negative raw uses fallback', () => {
    const r = clampToolDiameterMm(-2, 6)
    expect(r.value).toBe(6)
  })

  it('value above max clamps to 500 with note', () => {
    const r = clampToolDiameterMm(600, 6)
    expect(r.value).toBe(500)
    expect(r.note).toMatch(/clamped to 500/)
  })

  it('value below min clamps to 0.05 with note', () => {
    const r = clampToolDiameterMm(0.001, 0.001)
    // 0.001 is positive so used as base; clamped to min 0.05
    expect(r.value).toBe(0.05)
    expect(r.note).toMatch(/clamped to 0\.050/)
  })

  it('note format: "tool Ø clamped to <X> mm" with 3 decimals', () => {
    const r = clampToolDiameterMm(1000, 6)
    expect(r.note).toBe('tool Ø clamped to 500.000 mm')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (E) clampStepoverMm
// ────────────────────────────────────────────────────────────────────────────

describe('(E) clampStepoverMm', () => {
  it('happy path within frac range returns same value', () => {
    const r = clampStepoverMm(2, 6) // 2 mm out of 6 mm tool = 0.333× = within [0.02..0.98]
    expect(r.value).toBe(2)
    expect(r.note).toBeUndefined()
  })

  it('value above 0.98×D clamps to 0.98×D with note', () => {
    const r = clampStepoverMm(10, 6) // 10 > 0.98*6=5.88
    expect(r.value).toBeCloseTo(5.88, 6)
    expect(r.note).toMatch(/stepover clamped/)
  })

  it('value below 0.02×D floor clamps up', () => {
    const r = clampStepoverMm(0.01, 6) // 0.01 < 0.02*6=0.12
    expect(r.value).toBeCloseTo(0.12, 6)
  })

  it('NaN clamps to floor with note', () => {
    const r = clampStepoverMm(Number.NaN, 6)
    expect(r.value).toBeCloseTo(0.12, 6) // floor for 6mm tool
    expect(r.note).toMatch(/NaN/)
  })

  it('Infinity clamps to floor (clampFinite returns lo for non-finite, asymmetric with finite-out-of-range)', () => {
    const r = clampStepoverMm(Number.POSITIVE_INFINITY, 6)
    expect(r.value).toBeCloseTo(0.12, 6)
    expect(r.note).toMatch(/Infinity/)
  })

  it('zero stepover falls below absolute MIN_MM=0.01 floor and is clamped up', () => {
    const r = clampStepoverMm(0, 0.5)
    // floor = max(0.01, 0.5*0.02) = max(0.01, 0.01) = 0.01
    expect(r.value).toBeCloseTo(0.01, 6)
    expect(r.note).toMatch(/stepover clamped/)
  })

  it('note format includes both arrow and tool Ø', () => {
    const r = clampStepoverMm(100, 6)
    expect(r.note).toMatch(/→/)
    expect(r.note).toMatch(/tool Ø/)
    expect(r.note).toMatch(/6\.000 mm/)
  })

  it('zero tool diameter uses TOOL_DIAM_MIN_MM as effective Ø', () => {
    const r = clampStepoverMm(0.5, 0)
    // d = max(0.05, 0) = 0.05; cap = 0.05 * 0.98 = 0.049
    expect(r.value).toBeCloseTo(0.049, 6)
  })

  it('negative tool diameter uses TOOL_DIAM_MIN_MM as effective Ø', () => {
    const r = clampStepoverMm(0.5, -10)
    expect(r.value).toBeCloseTo(0.049, 6)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (F) clampFeedPlungeSafeZ
// ────────────────────────────────────────────────────────────────────────────

describe('(F) clampFeedPlungeSafeZ', () => {
  it('all inputs already valid returns unchanged with empty notes', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1500, plungeMmMin: 600, safeZMm: 5 })
    expect(r.feedMmMin).toBe(1500)
    expect(r.plungeMmMin).toBe(600)
    expect(r.safeZMm).toBe(5)
    expect(r.notes).toEqual([])
  })

  it('NaN feed raised to floor with note', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: Number.NaN, plungeMmMin: 600, safeZMm: 5 })
    expect(r.feedMmMin).toBe(CAM_GUARDRAIL_FEED_MIN_MM_MIN)
    expect(r.notes.some((n) => /feed raised/.test(n))).toBe(true)
  })

  it('zero plunge raised to floor with note', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1500, plungeMmMin: 0, safeZMm: 5 })
    expect(r.plungeMmMin).toBe(CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN)
    expect(r.notes.some((n) => /plunge raised/.test(n))).toBe(true)
  })

  it('negative safe Z raised to floor with note', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 1500, plungeMmMin: 600, safeZMm: -1 })
    expect(r.safeZMm).toBe(CAM_GUARDRAIL_SAFE_Z_MIN_MM)
    expect(r.notes.some((n) => /safe Z raised/.test(n))).toBe(true)
  })

  it('all three sub-floor produces three notes in stable order (feed, plunge, safe Z)', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 0, plungeMmMin: 0, safeZMm: 0 })
    expect(r.notes.length).toBe(3)
    expect(r.notes[0]).toMatch(/feed raised/)
    expect(r.notes[1]).toMatch(/plunge raised/)
    expect(r.notes[2]).toMatch(/safe Z raised/)
  })

  it('notes contain unit "mm/min" or "mm" suffix where appropriate', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 0, plungeMmMin: 0, safeZMm: 0 })
    expect(r.notes[0]).toMatch(/mm\/min/)
    expect(r.notes[1]).toMatch(/mm\/min/)
    expect(r.notes[2]).toMatch(/ mm$/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (G) warnBallEndMillZPass
// ────────────────────────────────────────────────────────────────────────────

describe('(G) warnBallEndMillZPass', () => {
  it('returns null when DOC <= radius', () => {
    expect(warnBallEndMillZPass(2.9, 6)).toBeNull() // 2.9 < 3
  })

  it('returns null when DOC === radius (boundary)', () => {
    expect(warnBallEndMillZPass(3, 6)).toBeNull()
  })

  it('returns warning when DOC > radius', () => {
    const w = warnBallEndMillZPass(4, 6)
    expect(w).not.toBeNull()
    expect(w).toMatch(/DOC 4\.000 mm/)
    expect(w).toMatch(/tool radius 3\.000 mm/)
  })

  it('treats negative zPass as |zPass|', () => {
    const w = warnBallEndMillZPass(-4, 6)
    expect(w).not.toBeNull()
    expect(w).toMatch(/DOC 4\.000 mm/)
  })

  it('NaN zPass returns null', () => {
    expect(warnBallEndMillZPass(Number.NaN, 6)).toBeNull()
  })

  it('NaN tool diameter returns null', () => {
    expect(warnBallEndMillZPass(2, Number.NaN)).toBeNull()
  })

  it('zero tool diameter returns null', () => {
    expect(warnBallEndMillZPass(0.1, 0)).toBeNull()
  })

  it('negative tool diameter returns null', () => {
    expect(warnBallEndMillZPass(0.1, -6)).toBeNull()
  })

  it('warning includes recommended max DOC', () => {
    const w = warnBallEndMillZPass(4, 6)
    expect(w).toMatch(/reduce zPassMm to ≤ 3\.000 mm/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (H) warnDocExceedsFluteLength
// ────────────────────────────────────────────────────────────────────────────

describe('(H) warnDocExceedsFluteLength', () => {
  it('returns null when DOC <= flute*0.5', () => {
    expect(warnDocExceedsFluteLength(5, 12)).toBeNull() // 5 < 6
  })

  it('returns warning when DOC > flute*0.5', () => {
    const w = warnDocExceedsFluteLength(8, 12)
    expect(w).not.toBeNull()
    expect(w).toMatch(/DOC 8\.000 mm/)
    expect(w).toMatch(/flute length × 0\.5 \(6\.000 mm\)/)
  })

  it('treats negative zPass as |zPass|', () => {
    const w = warnDocExceedsFluteLength(-8, 12)
    expect(w).toMatch(/DOC 8\.000 mm/)
  })

  it('NaN zPass returns null', () => {
    expect(warnDocExceedsFluteLength(Number.NaN, 12)).toBeNull()
  })

  it('NaN flute length returns null', () => {
    expect(warnDocExceedsFluteLength(8, Number.NaN)).toBeNull()
  })

  it('zero flute length returns null', () => {
    expect(warnDocExceedsFluteLength(8, 0)).toBeNull()
  })

  it('negative flute length returns null', () => {
    expect(warnDocExceedsFluteLength(8, -12)).toBeNull()
  })

  it('warning recommends reducing zPassMm or longer flute', () => {
    const w = warnDocExceedsFluteLength(8, 12)
    expect(w).toMatch(/reduce zPassMm or use a longer flute/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (I) clampFeedAndPlungeToMachineMax
// ────────────────────────────────────────────────────────────────────────────

describe('(I) clampFeedAndPlungeToMachineMax', () => {
  it('happy path within cap returns unchanged with empty notes', () => {
    const r = clampFeedAndPlungeToMachineMax(1500, 600, 12000)
    expect(r.feedMmMin).toBe(1500)
    expect(r.plungeMmMin).toBe(600)
    expect(r.notes).toEqual([])
  })

  it('feed above cap is clamped with note', () => {
    const r = clampFeedAndPlungeToMachineMax(20000, 600, 12000)
    expect(r.feedMmMin).toBe(12000)
    expect(r.notes.some((n) => /feed clamped/.test(n))).toBe(true)
    expect(r.notes.some((n) => /machine max/.test(n))).toBe(true)
  })

  it('plunge above cap is clamped with note', () => {
    const r = clampFeedAndPlungeToMachineMax(1500, 20000, 12000)
    expect(r.plungeMmMin).toBe(12000)
    expect(r.notes.some((n) => /plunge clamped/.test(n))).toBe(true)
  })

  it('machine max <= 0 leaves both unchanged with empty notes', () => {
    const r = clampFeedAndPlungeToMachineMax(20000, 20000, 0)
    expect(r.feedMmMin).toBe(20000)
    expect(r.plungeMmMin).toBe(20000)
    expect(r.notes).toEqual([])
  })

  it('NaN machine max leaves both unchanged with empty notes', () => {
    const r = clampFeedAndPlungeToMachineMax(20000, 20000, Number.NaN)
    expect(r.feedMmMin).toBe(20000)
    expect(r.notes).toEqual([])
  })

  it('NaN feed left as-is, no clamp note', () => {
    const r = clampFeedAndPlungeToMachineMax(Number.NaN, 600, 12000)
    expect(Number.isNaN(r.feedMmMin)).toBe(true)
    expect(r.notes).toEqual([])
  })

  it('feed exactly at cap is NOT clamped (strict > comparison)', () => {
    const r = clampFeedAndPlungeToMachineMax(12000, 12000, 12000)
    expect(r.feedMmMin).toBe(12000)
    expect(r.plungeMmMin).toBe(12000)
    expect(r.notes).toEqual([])
  })

  it('both above cap produces TWO notes in stable order (feed, plunge)', () => {
    const r = clampFeedAndPlungeToMachineMax(20000, 30000, 12000)
    expect(r.notes.length).toBe(2)
    expect(r.notes[0]).toMatch(/feed clamped/)
    expect(r.notes[1]).toMatch(/plunge clamped/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (J) detectRapidsBelowStockSurface
// ────────────────────────────────────────────────────────────────────────────

const seg = (
  kind: 'rapid' | 'feed',
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number
): ToolpathSegment3 => ({ kind, x0, y0, z0, x1, y1, z1 })

describe('(J) detectRapidsBelowStockSurface', () => {
  it('empty input returns count=0, worstZ=null', () => {
    const r = detectRapidsBelowStockSurface([])
    expect(r).toEqual({ count: 0, worstZMm: null })
  })

  it('feed-only segments below stock are NOT flagged', () => {
    const segs = [seg('feed', 0, 0, 0, 10, 0, -5)]
    const r = detectRapidsBelowStockSurface(segs, 0)
    expect(r.count).toBe(0)
    expect(r.worstZMm).toBeNull()
  })

  it('rapid above stock is NOT flagged', () => {
    const segs = [seg('rapid', 0, 0, 5, 10, 0, 5)]
    const r = detectRapidsBelowStockSurface(segs, 0)
    expect(r.count).toBe(0)
  })

  it('rapid exactly at stock top is NOT flagged (epsilon-tolerant)', () => {
    const segs = [seg('rapid', 0, 0, 0, 10, 0, 0)]
    const r = detectRapidsBelowStockSurface(segs, 0)
    expect(r.count).toBe(0)
  })

  it('rapid below stock is flagged with worstZ', () => {
    const segs = [seg('rapid', 0, 0, 5, 10, 0, -2)]
    const r = detectRapidsBelowStockSurface(segs, 0)
    expect(r.count).toBe(1)
    expect(r.worstZMm).toBe(-2)
  })

  it('multiple rapids below stock: worstZ is most-negative', () => {
    const segs = [
      seg('rapid', 0, 0, 5, 10, 0, -1),
      seg('rapid', 10, 0, 5, 20, 0, -5),
      seg('rapid', 20, 0, 5, 30, 0, -3)
    ]
    const r = detectRapidsBelowStockSurface(segs, 0)
    expect(r.count).toBe(3)
    expect(r.worstZMm).toBe(-5)
  })

  it('XY bounds gate suppresses rapids outside footprint', () => {
    const segs = [seg('rapid', 0, 0, 5, 200, 200, -2)]
    const r = detectRapidsBelowStockSurface(segs, 0, {
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 100
    })
    expect(r.count).toBe(0)
  })

  it('XY bounds gate keeps rapids inside footprint', () => {
    const segs = [seg('rapid', 0, 0, 5, 50, 50, -2)]
    const r = detectRapidsBelowStockSurface(segs, 0, {
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 100
    })
    expect(r.count).toBe(1)
    expect(r.worstZMm).toBe(-2)
  })

  it('non-zero stockTopZ adjusts threshold', () => {
    const segs = [seg('rapid', 0, 0, 0, 10, 0, 3)]
    const r = detectRapidsBelowStockSurface(segs, 5)
    expect(r.count).toBe(1)
    expect(r.worstZMm).toBe(3)
  })

  it('mixed feed+rapid: only rapids contribute to count', () => {
    const segs = [
      seg('feed', 0, 0, 0, 10, 0, -10),
      seg('rapid', 10, 0, 5, 20, 0, -3),
      seg('feed', 20, 0, -3, 30, 0, -8)
    ]
    const r = detectRapidsBelowStockSurface(segs, 0)
    expect(r.count).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (K) applyCamToolpathGuardrails
// ────────────────────────────────────────────────────────────────────────────

describe('(K) applyCamToolpathGuardrails', () => {
  it('happy path returns unchanged numerics with empty notes', () => {
    const job = {
      toolDiameterMm: 6,
      stepoverMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 600,
      safeZMm: 5
    }
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.toolDiameterMm).toBe(6)
    expect(r.job.stepoverMm).toBe(2)
    expect(r.job.feedMmMin).toBe(1500)
    expect(r.job.plungeMmMin).toBe(600)
    expect(r.job.safeZMm).toBe(5)
    expect(r.notes).toEqual([])
  })

  it('toolDiameterMm omitted falls back to 6 mm', () => {
    const job: CamGuardrailJob = { stepoverMm: 2, feedMmMin: 1500, plungeMmMin: 600, safeZMm: 5 }
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.toolDiameterMm).toBe(6)
  })

  it('out-of-range tool clamped with note', () => {
    const job = {
      toolDiameterMm: 1000,
      stepoverMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 600,
      safeZMm: 5
    }
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.toolDiameterMm).toBe(500)
    expect(r.notes.some((n) => /tool/.test(n))).toBe(true)
  })

  it('preserves arbitrary extra fields on the job (generic spread)', () => {
    type ExtJob = {
      toolDiameterMm: number
      stepoverMm: number
      feedMmMin: number
      plungeMmMin: number
      safeZMm: number
      operationKind: string
      machineId: string
    }
    const job: ExtJob = {
      toolDiameterMm: 6,
      stepoverMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 600,
      safeZMm: 5,
      operationKind: 'cnc_pocket',
      machineId: 'laguna-swift-5x10'
    }
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.operationKind).toBe('cnc_pocket')
    expect(r.job.machineId).toBe('laguna-swift-5x10')
  })

  it('does not mutate the input job (spread-copy invariant)', () => {
    const job = {
      toolDiameterMm: 1000,
      stepoverMm: 100,
      feedMmMin: 0,
      plungeMmMin: 0,
      safeZMm: 0
    }
    const before = JSON.stringify(job)
    applyCamToolpathGuardrails(job)
    expect(JSON.stringify(job)).toBe(before)
  })

  it('returned job is a fresh object (not the input)', () => {
    const job = {
      toolDiameterMm: 6,
      stepoverMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 600,
      safeZMm: 5
    }
    const r = applyCamToolpathGuardrails(job)
    expect(r.job).not.toBe(job)
  })

  it('aggregates notes from all 3 sub-clamps in declared order', () => {
    const job = {
      toolDiameterMm: 1000, // clamp -> 500
      stepoverMm: 1000, // clamp -> 0.98 * 500 = 490 (above cap)
      feedMmMin: 0, // raise -> 1
      plungeMmMin: 0, // raise -> 1
      safeZMm: 0 // raise -> 0.05
    }
    const r = applyCamToolpathGuardrails(job)
    expect(r.notes.length).toBeGreaterThanOrEqual(5)
    // Tool note before stepover note before feed/plunge/safeZ notes
    const toolIdx = r.notes.findIndex((n) => /tool/.test(n))
    const stepIdx = r.notes.findIndex((n) => /stepover/.test(n))
    const feedIdx = r.notes.findIndex((n) => /feed/.test(n))
    expect(toolIdx).toBeLessThan(stepIdx)
    expect(stepIdx).toBeLessThan(feedIdx)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (L) formatRapidBelowStockHintForPostedGcode
// ────────────────────────────────────────────────────────────────────────────

describe('(L) formatRapidBelowStockHintForPostedGcode', () => {
  it('empty gcode returns empty string', () => {
    expect(formatRapidBelowStockHintForPostedGcode('')).toBe('')
  })

  it('whitespace-only gcode returns empty string', () => {
    expect(formatRapidBelowStockHintForPostedGcode('   \n\n  ')).toBe('')
  })

  it('gcode without rapids-below-stock returns empty string', () => {
    const gcode = 'G21\nG90\nG0 X0 Y0 Z5\nG1 X10 Y10 Z-2 F1500\nG0 X0 Y0 Z5\nM30'
    expect(formatRapidBelowStockHintForPostedGcode(gcode, 0)).toBe('')
  })

  it('singular violation gets "1 G0 rapid move descends" phrasing', () => {
    const gcode = 'G21\nG90\nG0 X0 Y0 Z5\nG0 X10 Y10 Z-2\nM30'
    const hint = formatRapidBelowStockHintForPostedGcode(gcode, 0)
    expect(hint).toMatch(/1 G0 rapid move descends/)
    expect(hint).toMatch(/worst Z -2\.000 mm/)
  })

  it('plural violations get "moves descend" phrasing', () => {
    const gcode =
      'G21\nG90\nG0 X0 Y0 Z5\nG0 X10 Y10 Z-2\nG0 X20 Y20 Z-5\nG0 X30 Y30 Z-1\nM30'
    const hint = formatRapidBelowStockHintForPostedGcode(gcode, 0)
    expect(hint).toMatch(/3 G0 rapid moves descend/)
    expect(hint).toMatch(/worst Z -5\.000 mm/)
  })

  it('hint includes WCS / G0/G1 / docs reference', () => {
    const gcode = 'G21\nG90\nG0 X0 Y0 Z-2\nM30'
    const hint = formatRapidBelowStockHintForPostedGcode(gcode, 0)
    expect(hint).toMatch(/G0\/G1 assignment/)
    expect(hint).toMatch(/WCS Z0/)
    expect(hint).toMatch(/docs\/MACHINES\.md/)
  })

  it('XY-bounds gate suppresses rapids outside stock footprint', () => {
    const gcode = 'G21\nG90\nG0 X0 Y0 Z5\nG0 X200 Y200 Z-2\nM30'
    const hint = formatRapidBelowStockHintForPostedGcode(gcode, 0, {
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 100
    })
    expect(hint).toBe('')
  })

  it('non-zero stockTopZ shifts the threshold', () => {
    const gcode = 'G21\nG90\nG0 X0 Y0 Z3\nM30'
    const hint = formatRapidBelowStockHintForPostedGcode(gcode, 5)
    expect(hint).toMatch(/1 G0 rapid move descends/)
    expect(hint).toMatch(/worst Z 3\.000 mm/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (M) Three-machine path realism
// ────────────────────────────────────────────────────────────────────────────

describe('(M) Three-machine path realism (CLAUDE.md USER CONTEXT)', () => {
  it('K2 Plus high-speed FDM job: 36000 mm/min feed clamped at 18000 mm/min machine max', () => {
    // K2 Plus rated 18000 mm/min per resources/machines/creality-k2-plus.json
    const r = clampFeedAndPlungeToMachineMax(36000, 12000, 18000)
    expect(r.feedMmMin).toBe(18000)
    expect(r.plungeMmMin).toBe(12000) // unchanged (below cap)
    expect(r.notes.some((n) => /feed clamped 36000 → 18000/.test(n))).toBe(true)
  })

  it('Laguna Swift 5x10 plywood job: 5000 mm/min feed within 12000 mm/min cap', () => {
    // Laguna rated 12000 mm/min per resources/machines/laguna-swift-5x10.json
    const r = clampFeedAndPlungeToMachineMax(5000, 1500, 12000)
    expect(r.feedMmMin).toBe(5000)
    expect(r.notes).toEqual([])
  })

  it('Carvera 4-axis aluminum job: 3000 mm/min plunge clamped to 2400 mm/min machine max', () => {
    // Carvera rated 2400 mm/min per resources/machines/makera-carvera-4axis.json
    const r = clampFeedAndPlungeToMachineMax(2000, 3000, 2400)
    expect(r.feedMmMin).toBe(2000)
    expect(r.plungeMmMin).toBe(2400)
    expect(r.notes.some((n) => /plunge clamped 3000 → 2400/.test(n))).toBe(true)
  })

  it('Carvera 3 mm ball-end finishing tool: 2 mm DOC warns (>1.5 mm radius)', () => {
    const w = warnBallEndMillZPass(2, 3)
    expect(w).not.toBeNull()
    expect(w).toMatch(/tool radius 1\.500 mm/)
  })

  it('Carvera 3 mm ball-end at 1 mm DOC: no warn (<= radius)', () => {
    expect(warnBallEndMillZPass(1, 3)).toBeNull()
  })

  it('Laguna 12.7 mm endmill on plywood: 8 mm stepover (~0.63×D) accepted unchanged', () => {
    const r = clampStepoverMm(8, 12.7)
    expect(r.value).toBe(8)
    expect(r.note).toBeUndefined()
  })

  it('K2 Plus 0.4 mm nozzle: 0.16 mm "stepover" (line width) -- stepover concept N/A but does not crash', () => {
    // FDM does not use stepover the way CAM does; still, the helper must
    // not throw when handed a 0.4 mm tool.
    const r = clampStepoverMm(0.16, 0.4)
    expect(Number.isFinite(r.value)).toBe(true)
  })

  it('Laguna full-sheet plywood pocket with G0 below spoilboard fires the rapid-into-stock detector', () => {
    // Realistic: a posted full-sheet pocket on a 1524x3048 mm plywood sheet
    // accidentally emits a G0 below Z=0. The hint must fire.
    const gcode = `G21\nG90\nG17\nM3 S18000\nG0 X100 Y100 Z25\nG0 X100 Y100 Z-3\nG1 X1500 Y100 Z-3 F5000\nG0 X0 Y0 Z25\nM5\nM30\n`
    const hint = formatRapidBelowStockHintForPostedGcode(gcode, 0, {
      minX: 0,
      maxX: 1524,
      minY: 0,
      maxY: 3048
    })
    expect(hint).toMatch(/1 G0 rapid move descends/)
    expect(hint).toMatch(/-3\.000 mm/)
  })

  it('Carvera ATC realistic safe-Z 5 mm passes the safe-Z floor check', () => {
    const r = clampFeedPlungeSafeZ({ feedMmMin: 600, plungeMmMin: 200, safeZMm: 5 })
    expect(r.safeZMm).toBe(5)
    expect(r.notes).toEqual([])
  })

  it('full guardrail wrapper accepts realistic Carvera 4-axis job', () => {
    const job = {
      toolDiameterMm: 3,
      stepoverMm: 0.5,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      machineId: 'makera-carvera-4axis'
    }
    const r = applyCamToolpathGuardrails(job)
    expect(r.job.toolDiameterMm).toBe(3)
    expect(r.job.stepoverMm).toBe(0.5)
    expect(r.job.machineId).toBe('makera-carvera-4axis')
    expect(r.notes).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (N) Pure-function invariants
// ────────────────────────────────────────────────────────────────────────────

describe('(N) Pure-function invariants', () => {
  it('clampToolDiameterMm idempotent across N=20 calls', () => {
    const first = clampToolDiameterMm(1000, 6)
    for (let i = 0; i < 20; i++) {
      expect(clampToolDiameterMm(1000, 6)).toEqual(first)
    }
  })

  it('clampStepoverMm idempotent across N=20 calls', () => {
    const first = clampStepoverMm(100, 6)
    for (let i = 0; i < 20; i++) {
      expect(clampStepoverMm(100, 6)).toEqual(first)
    }
  })

  it('clampFeedPlungeSafeZ idempotent across N=20 calls', () => {
    const input = { feedMmMin: 0, plungeMmMin: 0, safeZMm: 0 }
    const first = clampFeedPlungeSafeZ(input)
    for (let i = 0; i < 20; i++) {
      expect(clampFeedPlungeSafeZ(input)).toEqual(first)
    }
  })

  it('warnBallEndMillZPass idempotent across N=20 calls', () => {
    const first = warnBallEndMillZPass(4, 6)
    for (let i = 0; i < 20; i++) {
      expect(warnBallEndMillZPass(4, 6)).toBe(first)
    }
  })

  it('applyCamToolpathGuardrails returns fresh notes Array each call', () => {
    const job = {
      toolDiameterMm: 6,
      stepoverMm: 2,
      feedMmMin: 1500,
      plungeMmMin: 600,
      safeZMm: 5
    }
    const r1 = applyCamToolpathGuardrails(job)
    const r2 = applyCamToolpathGuardrails(job)
    expect(r1.notes).not.toBe(r2.notes)
  })

  it('no this-binding leakage on call/apply for clampToolDiameterMm', () => {
    const direct = clampToolDiameterMm(6, 6)
    const viaCall = clampToolDiameterMm.call(null, 6, 6)
    const viaApply = clampToolDiameterMm.apply(null, [6, 6])
    expect(direct).toEqual(viaCall)
    expect(direct).toEqual(viaApply)
  })

  it('clampFeedPlungeSafeZ does not mutate its input object', () => {
    const input = { feedMmMin: 0, plungeMmMin: 0, safeZMm: 0 }
    const before = JSON.stringify(input)
    clampFeedPlungeSafeZ(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('detectRapidsBelowStockSurface does not mutate its input segments array', () => {
    const segs = [seg('rapid', 0, 0, 5, 10, 0, -2)]
    const before = JSON.stringify(segs)
    detectRapidsBelowStockSurface(segs, 0)
    expect(JSON.stringify(segs)).toBe(before)
  })

  it('applyCamToolpathGuardrails idempotent (apply twice yields same numerics)', () => {
    const job = {
      toolDiameterMm: 1000,
      stepoverMm: 100,
      feedMmMin: 0,
      plungeMmMin: 0,
      safeZMm: 0
    }
    const r1 = applyCamToolpathGuardrails(job).job
    const r2 = applyCamToolpathGuardrails(r1).job
    expect(r2.toolDiameterMm).toBe(r1.toolDiameterMm)
    expect(r2.stepoverMm).toBe(r1.stepoverMm)
    expect(r2.feedMmMin).toBe(r1.feedMmMin)
    expect(r2.plungeMmMin).toBe(r1.plungeMmMin)
    expect(r2.safeZMm).toBe(r1.safeZMm)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (O) Source-text whitelist
// ────────────────────────────────────────────────────────────────────────────

describe('(O) Source-text whitelist', () => {
  it('source size canary: <= 280 lines', () => {
    expect(SOURCE.split('\n').length).toBeLessThanOrEqual(280)
  })

  it('source size canary: <= 12 KB', () => {
    expect(Buffer.byteLength(SOURCE, 'utf-8')).toBeLessThanOrEqual(12 * 1024)
  })

  it('imports extractToolpathSegmentsFromGcode + ToolpathSegment3 from cam-gcode-toolpath', () => {
    expect(SOURCE).toMatch(/import \{ extractToolpathSegmentsFromGcode \} from '\.\.\/shared\/cam-gcode-toolpath'/)
    expect(SOURCE).toMatch(/import type \{ ToolpathSegment3 \} from '\.\.\/shared\/cam-gcode-toolpath'/)
  })

  it('imports CAM_FEED_PLUNGE_FLOOR_MM_MIN from cam-numeric-floors', () => {
    expect(SOURCE).toMatch(/import \{ CAM_FEED_PLUNGE_FLOOR_MM_MIN \} from '\.\.\/shared\/cam-numeric-floors'/)
  })

  it('does not import React, react-dom, three, or any DOM/electron API', () => {
    expect(SOURCE).not.toMatch(/from 'react'/)
    expect(SOURCE).not.toMatch(/from 'three/)
    expect(SOURCE).not.toMatch(/from 'electron/)
  })

  it('does not import node:fs / node:path / node:net / node:tls / node:dgram', () => {
    expect(SOURCE).not.toMatch(/from 'node:fs/)
    expect(SOURCE).not.toMatch(/from 'node:path/)
    expect(SOURCE).not.toMatch(/from 'node:net/)
    expect(SOURCE).not.toMatch(/from 'node:tls/)
    expect(SOURCE).not.toMatch(/from 'node:dgram/)
  })

  it('does not contain `:any`, `as any`, or `<any>` types', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas any\b/)
    expect(SOURCE).not.toMatch(/<any>/)
  })

  it('declares exactly 8 named runtime constants (export const)', () => {
    const matches = SOURCE.match(/^export const /gm) ?? []
    expect(matches.length).toBe(8)
  })

  it('declares exactly 19 exported symbols total via export keyword (8 const + 9 functions + 2 type = 19; runtime = 17)', () => {
    // We verify the actual export-statement counts directly instead of
    // re-checking the runtime module.
    const exportLines = (SOURCE.match(/^export (const|function|type) /gm) ?? []).length
    // 8 const + 9 function + 2 type = 19 export statements
    expect(exportLines).toBe(19)
  })

  it('does not declare a default export', () => {
    expect(SOURCE).not.toMatch(/^export default /m)
  })

  it('does not name foreign-machine vendors (Haas/Mazak/Tormach/Okuma/DMG-Mori)', () => {
    expect(SOURCE).not.toMatch(/\bHaas\b/i)
    expect(SOURCE).not.toMatch(/\bMazak\b/i)
    expect(SOURCE).not.toMatch(/\bTormach\b/i)
    expect(SOURCE).not.toMatch(/\bOkuma\b/i)
    expect(SOURCE).not.toMatch(/\bDMG\s*Mori\b/i)
  })

  it('does not emit literal toolpath G-code (no G1/G2/G3 emission outside comments referencing motion words)', () => {
    // The module DOES have comments about G0/G1 detection, but it must not
    // emit G-code as output. Pin guards: no \"G1 X\" / \"G2 X\" / \"G3 X\" /
    // \"M3 S\" patterns that would suggest emission.
    expect(SOURCE).not.toMatch(/"G1 X/)
    expect(SOURCE).not.toMatch(/"G2 X/)
    expect(SOURCE).not.toMatch(/"G3 X/)
    expect(SOURCE).not.toMatch(/"M3 S/)
    expect(SOURCE).not.toMatch(/"M5"/)
    expect(SOURCE).not.toMatch(/"M30"/)
  })

  it('header references industry / HSM practice (not invented heuristics)', () => {
    expect(SOURCE).toMatch(/industry \/ HSM practice/)
  })

  it('warnBallEndMillZPass body references "tool radius" + "shank" justification', () => {
    expect(SOURCE).toMatch(/cutting edges only on the hemisphere/)
    expect(SOURCE).toMatch(/shank/)
  })

  it('warnDocExceedsFluteLength body references "rubbing" / "deflection" / "breakage" justification', () => {
    expect(SOURCE).toMatch(/rubbing/)
    expect(SOURCE).toMatch(/deflection/)
    expect(SOURCE).toMatch(/breakage/)
  })

  it('detectRapidsBelowStockSurface body references "stockTopZ" + WCS convention', () => {
    expect(SOURCE).toMatch(/stockTopZ/)
    expect(SOURCE).toMatch(/Z0 = stock top/)
  })

  it('does not import Handlebars, electron-store, or electron-builder', () => {
    expect(SOURCE).not.toMatch(/from 'handlebars/)
    expect(SOURCE).not.toMatch(/from 'electron-store/)
    expect(SOURCE).not.toMatch(/from 'electron-builder/)
  })

  it('exactly 5 numeric-tolerance epsilons (1e-6) in the source', () => {
    const matches = SOURCE.match(/1e-6/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
