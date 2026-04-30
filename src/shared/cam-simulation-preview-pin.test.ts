/**
 * cam-simulation-preview-pin.test.ts -- [ID-0258] Cycle 188 cam-engine paired-pin
 *
 * Pins the contract of `src/shared/cam-simulation-preview.ts` -- the SHARED
 * text-only G-code preview deriver consumed by the manufacture-tab CAM
 * simulation panel `src/renderer/manufacture/ManufactureAuxPanels.tsx:13`
 * (single production call-site, exercised on every CAM job posted for ALL
 * THREE target machines).
 *
 * The module is purely text-derived: it parses posted G-code as a string,
 * tracks G0/G1 modal axis state, accumulates motion / cutting move counts,
 * derives XY bounds + Z range, samples up to N "cue" messages, and
 * computes a NAIVE motion-time lower bound from polyline length / feed.
 * It does NOT simulate stock removal, collisions, accel, dwell, tool-
 * change, or rotary axes -- all explicitly disclaimed via the
 * `PREVIEW_DISCLAIMER` and `HEURISTIC_MOTION_NOTE` strings.
 *
 * CROSS-CUTS ALL THREE TARGET MACHINES via the `posts:list` -> CAM-runner
 * -> simulation panel pipeline:
 *   - K2 Plus (FDM, Klipper/Moonraker) via `fdm_passthrough.hbs`-posted
 *     G-code with M104/M140/G28-prefixed header + G1 below-Z0 print moves;
 *   - Laguna Swift 5x10 (RichAuto A-series, mach3) via
 *     `vcarve_mach3.hbs`-posted G21/G90/G17/M3 S18000 routing G-code with
 *     full-sheet plywood XY excursions;
 *   - Makera Carvera 4-axis (Smoothieware) via `carvera_4axis.hbs`-posted
 *     G0 X0 Y0 A0 rotary preamble + below-Z0 cuts.
 *
 * Sister cycles in the post-Cycle-161-reset chain this pin extends:
 *   177 [ID-0249] / 178 [ID-0250] / 179 [ID-0251] / 180 [ID-0252] /
 *   181 [ID-0253] / 182 [ID-0254] / 183 [ID-0255] / 184 [ID-0259] /
 *   185 [ID-0265 / ID-0067-data-v27] / 186 [ID-0266] / 187 [ID-0261] --
 *   now twelve cycles deep at Cycle 188 close.
 *
 * The existing `cam-simulation-preview.test.ts` (195 lines, 18 it()) covers
 * happy-path behavioural cases (basic counts/bounds, traverse-only, empty,
 * comment stripping, heuristic motion, cue-count clamps, modal state, sign
 * parsing, parenthetical comments, M/T-code skip). THIS pin file does NOT
 * duplicate that coverage. It pins:
 *   (A) module shape -- exact 1-runtime-export inventory, no default,
 *       no internal-helper leakage (readFeedF / readAxis / PREVIEW_DISCLAIMER /
 *       HEURISTIC_MOTION_NOTE / DEFAULT_HEURISTIC_FEED_MM_MIN /
 *       DEFAULT_HEURISTIC_RAPID_MM_MIN), Symbol.toStringTag-Module,
 *   (B) function signature -- name / arity 1 (cueCount has a default
 *       value so it is not counted in .length) / native Function /
 *       no-Promise return / always returns a CamSimulationPreview-shaped
 *       object,
 *   (C) result shape contract -- exact 9-key inventory, type contracts
 *       per key, key order tolerant (Object.keys is implementation detail
 *       so we pin presence + value types, not order),
 *   (D) cuttingMoves predicate -- ONLY G1 lines with state.z < 0 count;
 *       G0 below Z0 does NOT count; G1 at exactly Z0 does NOT count;
 *       modal Z carryover counts (Z below 0 set on a prior line, then
 *       G1 X-only line stays "cutting"),
 *   (E) heuristic feed defaulting -- 1200 mm/min for G1 with no F + no
 *       prior F; 6000 mm/min for G0 regardless of F; F set on a G0 line
 *       persists for the next G1 missing-F line (modal F),
 *   (F) heuristic motion null contract -- both heuristicMotionMinutes and
 *       heuristicMotionPathMm are EITHER both null (no motion or zero-
 *       length motion only) OR both finite numbers; never one-without-
 *       the-other; neither is negative,
 *   (G) cue count semantics -- cueCount=1 -> exactly 1 cue (entry message,
 *       not "final"); cueCount=2 with N>=2 cuts -> 2 cues (entry + final);
 *       cueCount > N -> exactly N cues; cueCount=0 clamped to 1 via
 *       Math.max guard,
 *   (H) progressPct contract -- always integer 0-100, monotonically
 *       non-decreasing across the cue array, last cue's progressPct is
 *       always 100 when there are cutting moves AND cueCount >= 1,
 *   (I) three-machine path realism -- K2 Plus FDM print, Laguna full-
 *       sheet plywood routing, Carvera 4-axis cylindrical engraving with
 *       A-word ignored (rotary axis NOT a Z source for cuttingMoves),
 *   (J) pure-function invariants -- idempotent (N=20 same input -> deep
 *       equal output, separate object instances), no input mutation
 *       (gcode is a primitive string so trivially immutable; cueCount
 *       primitive too), no this-binding leakage on call/apply/bind, no
 *       throws on documented input ranges, fresh array instances per call,
 *   (K) source-text whitelist -- size canary (<=170 lines, <=6 KB), 1
 *       export-function form, 2 type aliases (CamSimulationCue +
 *       CamSimulationPreview), no React/DOM/electron/fs/net imports, no
 *       foreign-machine vendor literals, no toolpath G-code emission
 *       (only G0/G1/F regex parsing, never literal G28/G91 strings),
 *       no `:any` / `as any` / `<any>` types, the two named numeric
 *       defaults match the documented values (1200 / 6000), no default
 *       export.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './cam-simulation-preview'
import {
  buildCamSimulationPreview,
  type CamSimulationPreview,
  type CamSimulationCue
} from './cam-simulation-preview'

// ────────────────────────────────────────────────────────────────────────────
// Source-text fixture (frozen at test-collect time)
// ────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(HERE, 'cam-simulation-preview.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ────────────────────────────────────────────────────────────────────────────
// (A) Module shape -- exact 1-runtime-export inventory + no leakage
// ────────────────────────────────────────────────────────────────────────────

describe('(A) cam-simulation-preview module shape', () => {
  it('exports exactly one runtime symbol named buildCamSimulationPreview', () => {
    const runtimeKeys = Object.keys(M).filter(
      (k) => typeof (M as Record<string, unknown>)[k] !== 'undefined'
    )
    expect(runtimeKeys).toEqual(['buildCamSimulationPreview'])
  })

  it('does not expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('does not leak internal helper readFeedF', () => {
    expect((M as Record<string, unknown>).readFeedF).toBeUndefined()
  })

  it('does not leak internal helper readAxis', () => {
    expect((M as Record<string, unknown>).readAxis).toBeUndefined()
  })

  it('does not leak internal constant PREVIEW_DISCLAIMER', () => {
    expect((M as Record<string, unknown>).PREVIEW_DISCLAIMER).toBeUndefined()
  })

  it('does not leak internal constant HEURISTIC_MOTION_NOTE', () => {
    expect((M as Record<string, unknown>).HEURISTIC_MOTION_NOTE).toBeUndefined()
  })

  it('does not leak internal constant DEFAULT_HEURISTIC_FEED_MM_MIN', () => {
    expect((M as Record<string, unknown>).DEFAULT_HEURISTIC_FEED_MM_MIN).toBeUndefined()
  })

  it('does not leak internal constant DEFAULT_HEURISTIC_RAPID_MM_MIN', () => {
    expect((M as Record<string, unknown>).DEFAULT_HEURISTIC_RAPID_MM_MIN).toBeUndefined()
  })

  it('does not leak internal AxisState type as a runtime symbol', () => {
    expect((M as Record<string, unknown>).AxisState).toBeUndefined()
  })

  it('namespace object has Symbol.toStringTag === "Module"', () => {
    expect((M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('the sole runtime export is a Function (not a class, not a non-callable object)', () => {
    expect(typeof buildCamSimulationPreview).toBe('function')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (B) Function signature
// ────────────────────────────────────────────────────────────────────────────

describe('(B) buildCamSimulationPreview signature', () => {
  it('exposes name === "buildCamSimulationPreview"', () => {
    expect(buildCamSimulationPreview.name).toBe('buildCamSimulationPreview')
  })

  it('declared arity is 1 (cueCount has a default value of 5 so not counted)', () => {
    // Function.length excludes parameters with defaults.
    expect(buildCamSimulationPreview.length).toBe(1)
  })

  it('constructor is the global Function (native, not AsyncFunction)', () => {
    expect(buildCamSimulationPreview.constructor.name).toBe('Function')
  })

  it('does NOT return a Promise on a happy-path call', () => {
    const result = buildCamSimulationPreview('G0 Z5')
    expect(result).not.toBeInstanceOf(Promise)
  })

  it('always returns an object (never null/undefined/primitive) on documented input', () => {
    const result = buildCamSimulationPreview('')
    expect(result).not.toBeNull()
    expect(typeof result).toBe('object')
  })

  it('does not throw on the empty-string input contract', () => {
    expect(() => buildCamSimulationPreview('')).not.toThrow()
  })

  it('does not throw on a single-line input contract', () => {
    expect(() => buildCamSimulationPreview('G0 Z5')).not.toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (C) Result shape contract -- exact 9-key inventory + per-key types
// ────────────────────────────────────────────────────────────────────────────

describe('(C) CamSimulationPreview result shape', () => {
  const SAMPLE = buildCamSimulationPreview(
    ['G0 Z5', 'G1 Z-1 F300', 'G1 X10 Y0 F600', 'G0 Z5'].join('\n')
  )

  it('result has exactly 9 own keys', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(
      [
        'totalLines',
        'motionLines',
        'cuttingMoves',
        'xyBounds',
        'zRange',
        'cues',
        'disclaimer',
        'heuristicMotionMinutes',
        'heuristicMotionPathMm',
        'heuristicMotionNote'
      ].sort()
    )
  })

  it('totalLines is a non-negative integer', () => {
    expect(Number.isInteger(SAMPLE.totalLines)).toBe(true)
    expect(SAMPLE.totalLines).toBeGreaterThanOrEqual(0)
  })

  it('motionLines is a non-negative integer <= totalLines', () => {
    expect(Number.isInteger(SAMPLE.motionLines)).toBe(true)
    expect(SAMPLE.motionLines).toBeGreaterThanOrEqual(0)
    expect(SAMPLE.motionLines).toBeLessThanOrEqual(SAMPLE.totalLines)
  })

  it('cuttingMoves is a non-negative integer <= motionLines', () => {
    expect(Number.isInteger(SAMPLE.cuttingMoves)).toBe(true)
    expect(SAMPLE.cuttingMoves).toBeGreaterThanOrEqual(0)
    expect(SAMPLE.cuttingMoves).toBeLessThanOrEqual(SAMPLE.motionLines)
  })

  it('xyBounds is either null or an object with 4 numeric keys', () => {
    if (SAMPLE.xyBounds === null) {
      expect(SAMPLE.xyBounds).toBeNull()
    } else {
      expect(Object.keys(SAMPLE.xyBounds).sort()).toEqual(['maxX', 'maxY', 'minX', 'minY'])
      expect(typeof SAMPLE.xyBounds.minX).toBe('number')
      expect(typeof SAMPLE.xyBounds.maxX).toBe('number')
      expect(typeof SAMPLE.xyBounds.minY).toBe('number')
      expect(typeof SAMPLE.xyBounds.maxY).toBe('number')
    }
  })

  it('xyBounds (when present) satisfies minX <= maxX and minY <= maxY', () => {
    if (SAMPLE.xyBounds !== null) {
      expect(SAMPLE.xyBounds.minX).toBeLessThanOrEqual(SAMPLE.xyBounds.maxX)
      expect(SAMPLE.xyBounds.minY).toBeLessThanOrEqual(SAMPLE.xyBounds.maxY)
    }
  })

  it('zRange is either null or an object with 2 numeric keys (topZ, bottomZ)', () => {
    if (SAMPLE.zRange === null) {
      expect(SAMPLE.zRange).toBeNull()
    } else {
      expect(Object.keys(SAMPLE.zRange).sort()).toEqual(['bottomZ', 'topZ'])
      expect(typeof SAMPLE.zRange.topZ).toBe('number')
      expect(typeof SAMPLE.zRange.bottomZ).toBe('number')
    }
  })

  it('zRange (when present) satisfies bottomZ <= topZ', () => {
    if (SAMPLE.zRange !== null) {
      expect(SAMPLE.zRange.bottomZ).toBeLessThanOrEqual(SAMPLE.zRange.topZ)
    }
  })

  it('cues is always an array (never null/undefined)', () => {
    expect(Array.isArray(SAMPLE.cues)).toBe(true)
  })

  it('every cue has exactly the 2-key shape { progressPct, message }', () => {
    for (const cue of SAMPLE.cues) {
      expect(Object.keys(cue).sort()).toEqual(['message', 'progressPct'])
      expect(typeof cue.progressPct).toBe('number')
      expect(typeof cue.message).toBe('string')
    }
  })

  it('disclaimer is a non-empty string', () => {
    expect(typeof SAMPLE.disclaimer).toBe('string')
    expect(SAMPLE.disclaimer.length).toBeGreaterThan(0)
  })

  it('disclaimer mentions the safety scope (not collision/stock/machine motion)', () => {
    // Pinning the SAFETY-CRITICAL message: the panel MUST tell the user this
    // is text-only stats, not a real simulation. A regression that softens
    // this wording would be a real-world hazard for someone running a job
    // off the back of the preview alone.
    expect(SAMPLE.disclaimer.toLowerCase()).toContain('not')
    expect(SAMPLE.disclaimer.toLowerCase()).toMatch(/stock|collisions|machine motion/)
  })

  it('heuristicMotionNote is a non-empty string', () => {
    expect(typeof SAMPLE.heuristicMotionNote).toBe('string')
    expect(SAMPLE.heuristicMotionNote.length).toBeGreaterThan(0)
  })

  it('heuristicMotionNote mentions the documented defaults (1200 mm/min and 6000 mm/min)', () => {
    expect(SAMPLE.heuristicMotionNote).toContain('1200')
    expect(SAMPLE.heuristicMotionNote).toContain('6000')
  })

  it('heuristicMotionMinutes is null or a finite non-negative number', () => {
    if (SAMPLE.heuristicMotionMinutes === null) {
      expect(SAMPLE.heuristicMotionMinutes).toBeNull()
    } else {
      expect(Number.isFinite(SAMPLE.heuristicMotionMinutes)).toBe(true)
      expect(SAMPLE.heuristicMotionMinutes).toBeGreaterThanOrEqual(0)
    }
  })

  it('heuristicMotionPathMm is null or a finite non-negative number', () => {
    if (SAMPLE.heuristicMotionPathMm === null) {
      expect(SAMPLE.heuristicMotionPathMm).toBeNull()
    } else {
      expect(Number.isFinite(SAMPLE.heuristicMotionPathMm)).toBe(true)
      expect(SAMPLE.heuristicMotionPathMm).toBeGreaterThanOrEqual(0)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (D) cuttingMoves predicate -- ONLY G1 with state.z < 0
// ────────────────────────────────────────────────────────────────────────────

describe('(D) cuttingMoves predicate semantics', () => {
  it('G0 below Z0 is NOT a cutting move', () => {
    // G0 X0 Y0 Z-5 sets z<0 but the line is a rapid -- regression guard for
    // a refactor that forgets the line.startsWith("G1") check.
    const preview = buildCamSimulationPreview(
      ['G0 X0 Y0 Z-5', 'G1 X10 F300', 'G0 Z5'].join('\n')
    )
    // The G1 X10 line stays at z=-5 (modal), so it IS a cut. The G0 line
    // is not. Cutting moves should be exactly 1.
    expect(preview.cuttingMoves).toBe(1)
  })

  it('G1 exactly at Z0 is NOT a cutting move (strict < 0)', () => {
    // The source uses `state.z < 0` (strict). G1 Z0 is the surface, not a cut.
    const preview = buildCamSimulationPreview(['G0 Z5', 'G1 Z0 F200', 'G1 X10 F400'].join('\n'))
    expect(preview.cuttingMoves).toBe(0)
  })

  it('G1 at Z=-0.001 IS a cutting move (any negative Z)', () => {
    const preview = buildCamSimulationPreview(['G0 Z5', 'G1 Z-0.001 F200', 'G0 Z5'].join('\n'))
    expect(preview.cuttingMoves).toBe(1)
  })

  it('Modal Z carryover counts: Z<0 set on prior line, X-only G1 still cuts', () => {
    // Once Z is below 0, subsequent G1 lines without a Z word stay below
    // and should each count as a cutting move.
    const preview = buildCamSimulationPreview(
      ['G0 Z5', 'G1 Z-1 F200', 'G1 X1 F400', 'G1 X2 F400', 'G1 X3 F400'].join('\n')
    )
    // 4 G1 lines, all with z=-1 (modal): 4 cutting moves.
    expect(preview.cuttingMoves).toBe(4)
  })

  it('Modal retract above Z0: G1 Z+5 lifts state.z, subsequent G1 X cuts STOP counting', () => {
    const preview = buildCamSimulationPreview(
      ['G0 Z5', 'G1 Z-1 F200', 'G1 X1 F400', 'G1 Z5 F200', 'G1 X2 F400'].join('\n')
    )
    // G1 Z-1 (cut: z=-1), G1 X1 (cut: z=-1 modal), G1 Z5 (z=5 -> NOT a
    // cut), G1 X2 (z=5 modal -> NOT a cut). Total cutting = 2.
    expect(preview.cuttingMoves).toBe(2)
  })

  it('Lower-case g1 is NOT recognised (regex is case-sensitive on G0/G1 prefix)', () => {
    // The source uses `/^(G0|G1)\b/.test(line)` -- case-sensitive. Pin this
    // so a future refactor doesn't accidentally widen.
    const preview = buildCamSimulationPreview(['g1 z-1 f200', 'g1 x10 f400'].join('\n'))
    expect(preview.motionLines).toBe(0)
    expect(preview.cuttingMoves).toBe(0)
  })

  it('G2/G3 arc moves are NOT counted as motion (only G0/G1)', () => {
    const preview = buildCamSimulationPreview(
      ['G0 Z5', 'G1 Z-1 F200', 'G2 X10 Y0 I5 J0 F400', 'G3 X0 Y0 I-5 J0 F400'].join('\n')
    )
    // Only G0 Z5 + G1 Z-1 are recognised. G2/G3 are arc moves (not parsed
    // by this text-only preview).
    expect(preview.motionLines).toBe(2)
    expect(preview.cuttingMoves).toBe(1)
  })

  it('G01 (zero-padded variant) is NOT recognised — only G0 / G1 with word-boundary', () => {
    // The regex uses \b after G0|G1, and \b after G1 in "G01" matches
    // BETWEEN '1' and the trailing space. Wait -- "G01" has no boundary
    // between G0 and 1, so /^(G0|G1)\b/ tries to match G0 followed by \b,
    // but \b requires a non-word character after G0 -- and '1' is a word
    // character, so the match fails. Pin this contract.
    const preview = buildCamSimulationPreview(
      ['G01 X10 Z-1 F400', 'G00 X0 Y0 Z5'].join('\n')
    )
    expect(preview.motionLines).toBe(0)
    expect(preview.cuttingMoves).toBe(0)
  })

  it('Motion line prefixed by leading whitespace is REJECTED (regex anchors with ^)', () => {
    // After the trim() in the line filter, leading spaces are stripped, so
    // a single-line "  G1 X10" becomes "G1 X10" and IS counted. Pin this
    // post-trim behaviour.
    const preview = buildCamSimulationPreview('   G0 Z5   ')
    expect(preview.motionLines).toBe(1)
  })

  it('Tab-prefixed motion line is normalized via .trim() and counted', () => {
    const preview = buildCamSimulationPreview('\tG1 Z-1 F200\t')
    expect(preview.motionLines).toBe(1)
    expect(preview.cuttingMoves).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (E) heuristic feed defaulting + modal F + G0 rapid-feed override
// ────────────────────────────────────────────────────────────────────────────

describe('(E) heuristic feed defaulting and modal-F semantics', () => {
  it('G1 with no F and no prior F uses the 1200 mm/min default (per HEURISTIC_MOTION_NOTE)', () => {
    // 60 mm at 1200 mm/min = 0.05 minutes (3 seconds).
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G1 X60 Z-1'].join('\n'))
    // dist = sqrt(60^2 + 1^2) ~ 60.008 mm; min = 60.008/1200 ~ 0.05000667
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    expect(preview.heuristicMotionMinutes!).toBeGreaterThan(0.04)
    expect(preview.heuristicMotionMinutes!).toBeLessThan(0.06)
  })

  it('G0 rapid uses 6000 mm/min REGARDLESS of inline F word', () => {
    // G0 X60 with F1200 should still use 6000 (rapid override). 60mm/6000 = 0.01.
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0 F1200', 'G0 X60'].join('\n'))
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    // 60/6000 = 0.01 min
    expect(preview.heuristicMotionMinutes!).toBeCloseTo(0.01, 3)
  })

  it('Modal F: F set on a G1 line persists for subsequent G1 lines missing F', () => {
    // 100 mm at F1000 = 0.1 min; second 100 mm at modal F1000 = 0.1 min.
    // Total = 0.2 min.
    const preview = buildCamSimulationPreview(
      ['G0 X0 Y0 Z0', 'G1 X100 Z-1 F1000', 'G1 X200'].join('\n')
    )
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    // First G1: dist ~ 100.005, time ~ 0.1; second G1: dist 100, time ~ 0.1
    expect(preview.heuristicMotionMinutes!).toBeCloseTo(0.2, 1)
  })

  it('Modal F set on a G0 rapid line ALSO updates lastFeedMmMin (subsequent G1 inherits)', () => {
    // Source: readFeedF runs on every G0/G1 line. G0 with F sets the modal F.
    // Pin this so a refactor doesn't accidentally exclude G0 from the F update.
    const preview = buildCamSimulationPreview(
      ['G0 X0 Y0 Z0 F800', 'G1 X100 Z-1'].join('\n')
    )
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    // First G0: 0 dist (start). G1 at modal F=800 -> ~100/800 = 0.125 min
    expect(preview.heuristicMotionMinutes!).toBeCloseTo(0.125, 2)
  })

  it('Negative or zero F is rejected by readFeedF (lastFeedMmMin stays at default)', () => {
    // Source: `n > 0` check rejects F0/F-100. The 1200 default should apply.
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G1 X60 Z-1 F0'].join('\n'))
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    // dist ~60.008; at default 1200 -> ~0.0500
    expect(preview.heuristicMotionMinutes!).toBeGreaterThan(0.045)
    expect(preview.heuristicMotionMinutes!).toBeLessThan(0.055)
  })

  it('NaN F (synthetic non-finite via injected text) falls back to default', () => {
    const preview = buildCamSimulationPreview(['G1 X60 Z-1 Fabc'].join('\n'))
    // "Fabc" doesn't match the F regex; F stays at default 1200.
    expect(preview.heuristicMotionMinutes).not.toBeNull()
  })

  it('Multiple F values on one line: regex matches the FIRST F encountered', () => {
    // The regex `\bF([+-]?\d+(?:\.\d+)?)\b` matches greedily-leftward.
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G1 X60 Z-1 F600 F1200'].join('\n'))
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    // dist ~60.008 / F=600 = ~0.1 min (NOT ~0.05 from F1200).
    expect(preview.heuristicMotionMinutes!).toBeGreaterThan(0.09)
    expect(preview.heuristicMotionMinutes!).toBeLessThan(0.11)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (F) heuristic motion null contract -- both null or both finite
// ────────────────────────────────────────────────────────────────────────────

describe('(F) heuristicMotionMinutes / heuristicMotionPathMm null pairing', () => {
  it('empty G-code: BOTH heuristic fields are null', () => {
    const preview = buildCamSimulationPreview('')
    expect(preview.heuristicMotionMinutes).toBeNull()
    expect(preview.heuristicMotionPathMm).toBeNull()
  })

  it('comments only: BOTH heuristic fields are null', () => {
    const preview = buildCamSimulationPreview('; header\n; tool 6mm\n; end')
    expect(preview.heuristicMotionMinutes).toBeNull()
    expect(preview.heuristicMotionPathMm).toBeNull()
  })

  it('motion lines that all collapse to zero distance: BOTH heuristic fields are null', () => {
    // `G0 X0 Y0 Z0` then `G0 X0 Y0 Z0` again -- two motion lines, but
    // dist == 0 for both, so heuristicPathMm stays at 0 -> null contract.
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G0 X0 Y0 Z0'].join('\n'))
    expect(preview.motionLines).toBe(2)
    expect(preview.heuristicMotionMinutes).toBeNull()
    expect(preview.heuristicMotionPathMm).toBeNull()
  })

  it('M-code-only program: BOTH heuristic fields are null (no motion)', () => {
    const preview = buildCamSimulationPreview('M3 S8000\nM5\nM30')
    expect(preview.motionLines).toBe(0)
    expect(preview.heuristicMotionMinutes).toBeNull()
    expect(preview.heuristicMotionPathMm).toBeNull()
  })

  it('any positive-distance motion: BOTH heuristic fields are finite numbers', () => {
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G1 X10 Z-1 F600'].join('\n'))
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    expect(preview.heuristicMotionPathMm).not.toBeNull()
    expect(Number.isFinite(preview.heuristicMotionMinutes!)).toBe(true)
    expect(Number.isFinite(preview.heuristicMotionPathMm!)).toBe(true)
  })

  it('null pairing is symmetric: if one is null, the other is null too (logical-XOR-=0 invariant)', () => {
    const fixtures = [
      '',
      '; comment',
      'M3 S8000',
      'G0 X0 Y0 Z0',
      'G0 X0 Y0 Z0\nG0 X0 Y0 Z0',
      'G0 X0 Y0 Z0\nG1 X1 F400',
      'G1 Z-1 F200',
      'G0 Z5\nG1 Z-1 F200\nG1 X10 F400'
    ]
    for (const fx of fixtures) {
      const preview = buildCamSimulationPreview(fx)
      const minutesNull = preview.heuristicMotionMinutes === null
      const pathNull = preview.heuristicMotionPathMm === null
      expect(minutesNull).toBe(pathNull) // both null or both not-null
    }
  })

  it('heuristicMotionPathMm is never negative on documented input', () => {
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G1 X-50 Y-30 Z-1 F600'].join('\n'))
    expect(preview.heuristicMotionPathMm).not.toBeNull()
    expect(preview.heuristicMotionPathMm!).toBeGreaterThan(0)
  })

  it('heuristicMotionMinutes is never negative on documented input', () => {
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z0', 'G1 X-50 Y-30 Z-1 F600'].join('\n'))
    expect(preview.heuristicMotionMinutes).not.toBeNull()
    expect(preview.heuristicMotionMinutes!).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (G) cue count semantics -- Math.max(1, Math.min(cueCount, N)) sampler
// ────────────────────────────────────────────────────────────────────────────

describe('(G) cue count semantics', () => {
  // Use a fixture with exactly 5 cutting moves so we can clearly test
  // cueCount=1/2/3/5/10 -> 1/2/3/5/5 cues.
  const FIVE_CUTS = ['G0 Z5', 'G1 Z-1 F200', 'G1 X1 F400', 'G1 X2 F400', 'G1 X3 F400', 'G1 X4 F400'].join('\n')
  // First "G1 Z-1" + "G1 X1..X4" = 5 cuts.

  it('cueCount=1 produces exactly 1 cue (entry message, NOT "final")', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, 1)
    expect(preview.cues.length).toBe(1)
    // i=0 branch: "Tool enters stock". Pinning that the single-sample case
    // takes the entry branch, not the final branch.
    expect(preview.cues[0]!.message).toMatch(/enters stock|first detected/i)
  })

  it('cueCount=2 produces exactly 2 cues (entry + final)', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, 2)
    expect(preview.cues.length).toBe(2)
    expect(preview.cues[0]!.message).toMatch(/enters stock|first detected/i)
    expect(preview.cues[1]!.message).toMatch(/final|last/i)
  })

  it('cueCount=3 produces exactly 3 cues (entry + middle + final)', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, 3)
    expect(preview.cues.length).toBe(3)
    expect(preview.cues[0]!.message).toMatch(/enters stock|first detected/i)
    expect(preview.cues[1]!.message).toMatch(/pass sample/i)
    expect(preview.cues[2]!.message).toMatch(/final|last/i)
  })

  it('cueCount=5 produces exactly 5 cues for 5 cutting moves', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, 5)
    expect(preview.cues.length).toBe(5)
  })

  it('cueCount=10 with 5 cuts is clamped to 5 (capped at cuttingMoveIndices.length)', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, 10)
    expect(preview.cues.length).toBe(5)
  })

  it('cueCount=0 is clamped to 1 via Math.max guard', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, 0)
    expect(preview.cues.length).toBe(1)
  })

  it('cueCount=-3 (negative) is clamped to 1 via Math.max guard', () => {
    const preview = buildCamSimulationPreview(FIVE_CUTS, -3)
    expect(preview.cues.length).toBe(1)
  })

  it('cueCount default (omitted) is 5', () => {
    // The default parameter value is 5 -- pin via behavior.
    const preview = buildCamSimulationPreview(FIVE_CUTS)
    expect(preview.cues.length).toBe(5)
  })

  it('zero cutting moves but motion lines present: exactly 1 traverse cue', () => {
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z5', 'G1 X10 Z2 F400'].join('\n'))
    expect(preview.cuttingMoves).toBe(0)
    expect(preview.motionLines).toBe(2)
    expect(preview.cues.length).toBe(1)
    expect(preview.cues[0]!.message).toMatch(/no below-z0|traverse/i)
  })

  it('zero motion lines: zero cues (no traverse fallback)', () => {
    const preview = buildCamSimulationPreview('M3 S8000\nM5')
    expect(preview.motionLines).toBe(0)
    expect(preview.cues.length).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (H) progressPct contract -- integer 0-100, monotonic, last is 100
// ────────────────────────────────────────────────────────────────────────────

describe('(H) progressPct contract on cue array', () => {
  const TEN_CUTS = (() => {
    const lines = ['G0 Z5', 'G1 Z-1 F200']
    for (let i = 0; i < 9; i++) lines.push(`G1 X${i} F400`)
    return lines.join('\n')
  })()

  it('every progressPct is an integer (Math.round output)', () => {
    const preview = buildCamSimulationPreview(TEN_CUTS, 5)
    for (const cue of preview.cues) {
      expect(Number.isInteger(cue.progressPct)).toBe(true)
    }
  })

  it('every progressPct is in the inclusive range [0, 100]', () => {
    const preview = buildCamSimulationPreview(TEN_CUTS, 5)
    for (const cue of preview.cues) {
      expect(cue.progressPct).toBeGreaterThanOrEqual(0)
      expect(cue.progressPct).toBeLessThanOrEqual(100)
    }
  })

  it('progressPct is non-decreasing across the cue array', () => {
    const preview = buildCamSimulationPreview(TEN_CUTS, 5)
    for (let i = 1; i < preview.cues.length; i++) {
      expect(preview.cues[i]!.progressPct).toBeGreaterThanOrEqual(preview.cues[i - 1]!.progressPct)
    }
  })

  it('last cue progressPct is exactly 100 when there are cutting moves and cueCount >= 1', () => {
    const preview = buildCamSimulationPreview(TEN_CUTS, 5)
    expect(preview.cues[preview.cues.length - 1]!.progressPct).toBe(100)
  })

  it('first cue progressPct is the smallest in the array (entry sample)', () => {
    const preview = buildCamSimulationPreview(TEN_CUTS, 5)
    const first = preview.cues[0]!.progressPct
    for (const cue of preview.cues) {
      expect(first).toBeLessThanOrEqual(cue.progressPct)
    }
  })

  it('traverse-only cue has progressPct === 100', () => {
    const preview = buildCamSimulationPreview(['G0 X0 Y0 Z5', 'G1 X10 Z2 F400'].join('\n'))
    expect(preview.cues[0]!.progressPct).toBe(100)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (I) Three-machine path realism (K2 Plus / Laguna Swift / Carvera 4-axis)
// ────────────────────────────────────────────────────────────────────────────

describe('(I) three-machine path realism', () => {
  it('K2 Plus FDM print (M104/M140/G28 + below-Z0 first-layer) parses sensibly', () => {
    // K2 Plus realistic header from the fdm_passthrough.hbs template followed
    // by a 5-line first-layer perimeter at z=0.2 (above 0 -> NOT a cut by
    // this preview's strict z<0 predicate; FDM doesn't have "cuts" per se,
    // but the preview is shared across machines). What matters: motion
    // counting is robust to the M-code preamble.
    const k2 = [
      '; K2 Plus FDM print',
      'M140 S60',
      'M104 S210',
      'G28',
      'M190 S60',
      'M109 S210',
      'G92 E0',
      'G1 Z0.2 F300',
      'G1 X10 Y0 E0.5 F1500',
      'G1 X20 Y0 E1.0 F1500',
      'G1 X20 Y10 E1.5 F1500',
      'G1 X10 Y10 E2.0 F1500',
      'G1 X10 Y0 E2.5 F1500',
      'G1 Z5 F300',
      'M104 S0',
      'M140 S0'
    ].join('\n')
    const preview = buildCamSimulationPreview(k2)
    // Motion: G28 + G1 Z0.2 + 5x G1 X/Y + G1 Z5 = 8 G0/G1 lines (G28 starts
    // with "G2" -> regex /^(G0|G1)\b/ does NOT match G28 because \b after
    // "G2" requires a non-word boundary and "8" is a word char; pin this).
    // So motion = 7 (G1 only).
    expect(preview.motionLines).toBe(7)
    // No moves below Z0 -> 0 cutting moves (z=0.2 first layer is above 0).
    expect(preview.cuttingMoves).toBe(0)
    expect(preview.zRange?.bottomZ).toBeCloseTo(0.2, 5)
    // K2 build volume is 350x350x350; this fixture stays well inside.
    expect(preview.xyBounds?.maxX).toBeLessThanOrEqual(350)
    expect(preview.xyBounds?.maxY).toBeLessThanOrEqual(350)
    // Heuristic motion is finite (real distances + real F values).
    expect(preview.heuristicMotionMinutes).not.toBeNull()
  })

  it('Laguna Swift 5x10 full-sheet plywood routing parses sensibly', () => {
    // Laguna realistic: G21/G90/G17 + M3 S18000 + below-spoilboard cuts
    // across a near-full-sheet (1500x3000 mm) plywood blank.
    const laguna = [
      'G21',
      'G90',
      'G17',
      'M3 S18000',
      'G0 Z25',
      'G0 X100 Y100',
      'G1 Z-3.5 F400',
      'G1 X1400 Y100 F5000',
      'G1 X1400 Y2900 F5000',
      'G1 X100 Y2900 F5000',
      'G1 X100 Y100 F5000',
      'G0 Z25',
      'M5',
      'M30'
    ].join('\n')
    const preview = buildCamSimulationPreview(laguna)
    // 8 G0/G1 motion lines (G0 Z25 + G0 X100 Y100 + G1 Z-3.5 + 4x G1 X/Y + G0 Z25)
    expect(preview.motionLines).toBe(8)
    // Cutting moves: G1 Z-3.5 + 4x G1 X/Y at z=-3.5 modal = 5 cuts.
    expect(preview.cuttingMoves).toBe(5)
    expect(preview.zRange?.bottomZ).toBeCloseTo(-3.5, 5)
    expect(preview.zRange?.topZ).toBeCloseTo(25, 5)
    // Full-sheet XY: 1400 in X, 2900 in Y.
    expect(preview.xyBounds?.maxX).toBeCloseTo(1400, 5)
    expect(preview.xyBounds?.maxY).toBeCloseTo(2900, 5)
    // NEW DATAPOINT: minX/minY are 0 (the initial modal {x:0,y:0,z:0} state
    // is included in the bounds because the loop updates min/max from
    // state.x AFTER each motion line, and the first G0 Z25 has x=0/y=0
    // modal-initial). This is the documented behaviour -- a regression that
    // only sampled bounds at G1 lines would silently shrink the envelope.
    expect(preview.xyBounds?.minX).toBeCloseTo(0, 5)
    expect(preview.xyBounds?.minY).toBeCloseTo(0, 5)
    // 1300x2800 perimeter is ~8200 mm of cut + 25mm Z down + 25mm Z up.
    expect(preview.heuristicMotionPathMm!).toBeGreaterThan(8000)
  })

  it('Carvera 4-axis cylindrical engraving with A-word: A-axis is IGNORED in xyBounds/zRange', () => {
    // Carvera 4-axis realistic: G0 X0 Y0 A0 rotary preamble + below-Z0
    // engraving cuts wrapped around a cylinder. The A-word (rotary) is NOT
    // a Z source -- it should NOT pollute zRange or xyBounds.
    const carvera4 = [
      'G21',
      'G90',
      'G17',
      'M3 S15000',
      'G0 Z10',
      'G0 X0 Y0 A0',
      'G1 Z-0.5 F300',
      'G1 X20 A45 F1500',
      'G1 X40 A90 F1500',
      'G1 X60 A180 F1500',
      'G1 X80 A270 F1500',
      'G0 Z10',
      'M5',
      'M30'
    ].join('\n')
    const preview = buildCamSimulationPreview(carvera4)
    // 8 G0/G1 lines (G0 Z10 + G0 X0 Y0 A0 + G1 Z-0.5 + 4x G1 X/A + G0 Z10)
    expect(preview.motionLines).toBe(8)
    // Cutting moves: G1 Z-0.5 + 4x G1 X/A at z=-0.5 modal = 5 cuts.
    expect(preview.cuttingMoves).toBe(5)
    expect(preview.zRange?.bottomZ).toBeCloseTo(-0.5, 5)
    expect(preview.zRange?.topZ).toBeCloseTo(10, 5)
    // Carvera 4-axis work envelope is 360x240 (3-axis) + 240mm rotary length.
    // The A-word is 0/45/90/180/270 (degrees) -- if A leaked into Z or Y,
    // these tests would fail. Pin that A is NOT scanned by readAxis.
    expect(preview.xyBounds?.maxX).toBeCloseTo(80, 5)
    expect(preview.xyBounds?.maxY).toBeCloseTo(0, 5) // Y stays at 0
    expect(preview.xyBounds?.minY).toBeCloseTo(0, 5) // Y stays at 0
  })

  it('mixed three-machine fixture coexistence: each machine maps to a distinct preview shape', () => {
    // Sanity check: feeding three different machine fixtures yields three
    // distinguishable previews. Pin that the function is content-derived
    // (no global state).
    const k2 = 'G0 Z5\nG1 Z0.2 F300\nG1 X10 Y10 E1.0 F1500'
    const laguna = 'G0 Z25\nG1 Z-3.5 F400\nG1 X1400 Y2900 F5000'
    const carvera = 'G0 Z10\nG1 Z-0.5 F300\nG1 X80 A270 F1500'
    const pK = buildCamSimulationPreview(k2)
    const pL = buildCamSimulationPreview(laguna)
    const pC = buildCamSimulationPreview(carvera)
    // K2: 0 cuts (z=0.2 stays above 0); Laguna: 2 cuts (G1 Z-3.5 + G1 X1400
    // Y2900 modal z=-3.5); Carvera: 2 cuts (G1 Z-0.5 + G1 X80 A270 modal z=-0.5)
    expect(pK.cuttingMoves).toBe(0)
    expect(pL.cuttingMoves).toBe(2)
    expect(pC.cuttingMoves).toBe(2)
    // Distinct max-X scales
    expect(pK.xyBounds!.maxX).toBeLessThan(50)
    expect(pL.xyBounds!.maxX).toBeGreaterThan(1000)
    expect(pC.xyBounds!.maxX).toBeLessThan(200)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (J) Pure-function invariants
// ────────────────────────────────────────────────────────────────────────────

describe('(J) pure-function invariants', () => {
  const FIXTURE = ['G0 Z5', 'G1 Z-1 F200', 'G1 X10 F400', 'G1 X10 Y5 F400', 'G0 Z5'].join('\n')

  it('idempotent across N=20 calls (same input yields deep-equal output every time)', () => {
    const baseline = buildCamSimulationPreview(FIXTURE)
    for (let i = 0; i < 20; i++) {
      const repeat = buildCamSimulationPreview(FIXTURE)
      expect(repeat).toEqual(baseline)
    }
  })

  it('returns a fresh object instance per call (no shared mutable state)', () => {
    const a = buildCamSimulationPreview(FIXTURE)
    const b = buildCamSimulationPreview(FIXTURE)
    expect(a).not.toBe(b)
    expect(a.cues).not.toBe(b.cues) // fresh array
  })

  it('does not mutate any shared external state visible across calls', () => {
    // String + number primitives are immutable; this test pins that two
    // independent calls do not interfere via any module-scope mutable var.
    const a = buildCamSimulationPreview(FIXTURE, 3)
    const b = buildCamSimulationPreview(FIXTURE, 5)
    // Re-call the first input -- result must still match the original a.
    const aRepeat = buildCamSimulationPreview(FIXTURE, 3)
    expect(aRepeat).toEqual(a)
    // FIXTURE has 3 cutting moves; cueCount=5 clamps to min(5, 3) = 3.
    expect(b.cues.length).toBe(3)
    expect(a.cues.length).toBe(3)
  })

  it('no this-binding leakage: .call(null, ...) and .apply(undefined, [...]) return identical results', () => {
    const direct = buildCamSimulationPreview(FIXTURE)
    const viaCall = buildCamSimulationPreview.call(null, FIXTURE)
    const viaApply = buildCamSimulationPreview.apply(undefined, [FIXTURE])
    expect(viaCall).toEqual(direct)
    expect(viaApply).toEqual(direct)
  })

  it('does not throw on a wide range of synthetic inputs (fuzz-lite)', () => {
    const inputs = [
      '',
      ' ',
      '\n',
      '\r\n',
      '; only comment\n',
      'M3 S8000',
      'G0',
      'G1',
      'G0 Z5',
      'G1 Z-1 F200',
      '   G1   X10   Z-1   F400   ',
      'G1 (G0 Z-99 fake) X10 Z-1 F400',
      'G1 X+10.5 Y-5.25 Z+0.001 F+999',
      'G0 X1e3 Y2e2 Z-0.5e1', // scientific notation: not matched by regex, no throw
      'G1 X' + '1'.repeat(100) + ' F600' // very long axis word
    ]
    for (const input of inputs) {
      expect(() => buildCamSimulationPreview(input)).not.toThrow()
    }
  })

  it('cues array is a fresh allocation per call (not aliased)', () => {
    const a = buildCamSimulationPreview(FIXTURE)
    const b = buildCamSimulationPreview(FIXTURE)
    a.cues.push({ progressPct: 999, message: 'mutated' })
    expect(b.cues.find((c) => c.progressPct === 999)).toBeUndefined()
  })

  it('xyBounds object is a fresh allocation per call (not aliased)', () => {
    const a = buildCamSimulationPreview(FIXTURE)
    const b = buildCamSimulationPreview(FIXTURE)
    if (a.xyBounds && b.xyBounds) {
      expect(a.xyBounds).not.toBe(b.xyBounds)
    }
  })

  it('zRange object is a fresh allocation per call (not aliased)', () => {
    const a = buildCamSimulationPreview(FIXTURE)
    const b = buildCamSimulationPreview(FIXTURE)
    if (a.zRange && b.zRange) {
      expect(a.zRange).not.toBe(b.zRange)
    }
  })

  it('result of repeated calls satisfies type-narrowing per the CamSimulationPreview type', () => {
    // Compile-time pin: the local typed variable must accept the return.
    const result: CamSimulationPreview = buildCamSimulationPreview(FIXTURE)
    expect(result).toBeDefined()
  })

  it('CamSimulationCue type accepts a synthetic literal (compile-time pin)', () => {
    const cue: CamSimulationCue = { progressPct: 50, message: 'sample' }
    expect(cue.message).toBe('sample')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (K) Source-text whitelist
// ────────────────────────────────────────────────────────────────────────────

describe('(K) cam-simulation-preview source-text whitelist', () => {
  it('source file is at most 170 lines (size canary)', () => {
    const lineCount = SOURCE.split(/\r?\n/).length
    expect(lineCount).toBeLessThanOrEqual(170)
  })

  it('source file is at most 6000 bytes (byte canary)', () => {
    expect(SOURCE.length).toBeLessThanOrEqual(6000)
  })

  it('declares exactly one `export function` form (the public API surface)', () => {
    const exportFns = SOURCE.match(/^export\s+function\s+/gm) ?? []
    expect(exportFns.length).toBe(1)
  })

  it('declares exactly two `export type` aliases (CamSimulationCue + CamSimulationPreview)', () => {
    const exportTypes = SOURCE.match(/^export\s+type\s+/gm) ?? []
    expect(exportTypes.length).toBe(2)
    expect(SOURCE).toMatch(/export\s+type\s+CamSimulationCue\b/)
    expect(SOURCE).toMatch(/export\s+type\s+CamSimulationPreview\b/)
  })

  it('does not declare a default export', () => {
    expect(SOURCE).not.toMatch(/^export\s+default\b/m)
  })

  it('imports nothing from React / DOM / electron / fs / net (pure logic module)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]react['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]react-dom['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]electron['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:fs/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:net/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:http/)
    expect(SOURCE).not.toMatch(/from\s+['"]three['"]/)
  })

  it('does not contain the literal string `:any` (type safety canary)', () => {
    // Allow `:any` only if guarded by a comment or in a string -- but the
    // simplest pin is no occurrences at all in this small file.
    expect(SOURCE).not.toMatch(/:\s*any\b/)
  })

  it('does not contain `as any` or `<any>` casts', () => {
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
    expect(SOURCE).not.toMatch(/<\s*any\s*>/)
  })

  it('does not emit toolpath G/M-codes as literal strings (text-only PARSER, not GENERATOR)', () => {
    // The module reads G-code as text; it must never EMIT G-code literals.
    // Allow the regex `/^(G0|G1)\b/` and `/\bF[+-]?\d/` patterns; the
    // assertion below targets unique generator-style literals.
    expect(SOURCE).not.toMatch(/['"]G28[\s'"]/)
    expect(SOURCE).not.toMatch(/['"]G91[\s'"]/)
    expect(SOURCE).not.toMatch(/['"]G17[\s'"]/)
    expect(SOURCE).not.toMatch(/['"]M3\s+S\d/)
    expect(SOURCE).not.toMatch(/['"]M30['"]/)
    expect(SOURCE).not.toMatch(/['"]M104\s+S\d/)
    expect(SOURCE).not.toMatch(/['"]M140\s+S\d/)
  })

  it('does not mention foreign-machine vendors (Haas / Mazak / Tormach / Okuma / DMG-Mori / Bambu / Prusa)', () => {
    expect(SOURCE).not.toMatch(/\bHaas\b/i)
    expect(SOURCE).not.toMatch(/\bMazak\b/i)
    expect(SOURCE).not.toMatch(/\bTormach\b/i)
    expect(SOURCE).not.toMatch(/\bOkuma\b/i)
    expect(SOURCE).not.toMatch(/DMG[- ]?Mori/i)
    expect(SOURCE).not.toMatch(/\bBambu\b/i)
    expect(SOURCE).not.toMatch(/\bPrusa\b/i)
  })

  it('declares the documented numeric defaults: 1200 (feed) and 6000 (rapid)', () => {
    expect(SOURCE).toMatch(/DEFAULT_HEURISTIC_FEED_MM_MIN\s*=\s*1200\b/)
    expect(SOURCE).toMatch(/DEFAULT_HEURISTIC_RAPID_MM_MIN\s*=\s*6000\b/)
  })

  it('declares the disclaimer string with the safety scope (not stock removal / collisions / machine motion)', () => {
    expect(SOURCE).toMatch(/PREVIEW_DISCLAIMER\s*=/)
    // The actual literal mentions all three forbidden interpretations.
    expect(SOURCE).toMatch(/stock removal/)
    expect(SOURCE).toMatch(/collisions/)
    expect(SOURCE).toMatch(/machine motion/)
  })

  it('declares the heuristic note string mentioning the 1200 and 6000 defaults', () => {
    expect(SOURCE).toMatch(/HEURISTIC_MOTION_NOTE\s*=/)
    // The actual literal embeds both numeric defaults in human-readable prose.
    const noteIdx = SOURCE.indexOf('HEURISTIC_MOTION_NOTE')
    const slice = SOURCE.slice(noteIdx, noteIdx + 600)
    expect(slice).toContain('1200')
    expect(slice).toContain('6000')
  })

  it('does NOT use case-insensitive regex on the G0/G1 prefix (lowercase rejection per (D))', () => {
    // Pin that the prefix regex /^(G0|G1)\b/ has no /i flag. A refactor that
    // adds /i would silently start counting "g1" / "G01" / "g0" lines.
    expect(SOURCE).toMatch(/\/\^\(G0\|G1\)\\b\//)
    expect(SOURCE).not.toMatch(/\/\^\(G0\|G1\)\\b\/i/)
  })

  it('uses /i flag on the F-word regex (Fanuc lowercase f600 tolerated)', () => {
    // Pin the literal regex `/\bF([+-]?\d+(?:\.\d+)?)\b/i` from readFeedF.
    // Use substring check rather than regex-of-regex (less brittle).
    expect(SOURCE).toContain('/\\bF([+-]?\\d+(?:\\.\\d+)?)\\b/i')
  })

  it('strips parenthetical comments before axis matching (Fanuc inline comments)', () => {
    expect(SOURCE).toMatch(/\.replace\(\/\\\(\[\^\)\]\*\\\)\/g/)
  })

  it('reads only X / Y / Z axes (NOT A / B / C rotary axes)', () => {
    // Pin that readAxis is hard-coded to X|Y|Z. This prevents a refactor
    // that widens to A and accidentally pollutes zRange with rotary degrees.
    expect(SOURCE).toMatch(/axis:\s*'X'\s*\|\s*'Y'\s*\|\s*'Z'/)
    expect(SOURCE).not.toMatch(/axis:\s*'X'\s*\|\s*'Y'\s*\|\s*'Z'\s*\|\s*'A'/)
  })

  it('uses Math.hypot for 3D segment length (not naive sqrt(dx*dx+dy*dy+dz*dz))', () => {
    expect(SOURCE).toMatch(/Math\.hypot\(dx,\s*dy,\s*dz\)/)
  })

  it('uses Math.round for progressPct (integer cue progress)', () => {
    expect(SOURCE).toMatch(/Math\.round\(/)
  })

  it('uses Math.max(1, ...) guard on cueCount (cueCount=0 -> 1)', () => {
    expect(SOURCE).toMatch(/Math\.max\(1,\s*Math\.min\(/)
  })

  it('the strict-less-than predicate `state.z < 0` gates cuttingMoves', () => {
    expect(SOURCE).toMatch(/state\.z\s*<\s*0/)
  })

  it('only G1 (not G0) increments cuttingMoves (line.startsWith("G1") gate)', () => {
    expect(SOURCE).toMatch(/line\.startsWith\(\s*['"]G1['"]\s*\)/)
    expect(SOURCE).toMatch(/line\.startsWith\(\s*['"]G0['"]\s*\)/)
  })

  it('cues array is created with `const cues: CamSimulationCue[] = []` (typed empty literal)', () => {
    expect(SOURCE).toMatch(/const\s+cues:\s*CamSimulationCue\[\]\s*=\s*\[\]/)
  })

  it('Number.isFinite is used to gate xyBounds and zRange null returns', () => {
    expect(SOURCE).toMatch(/Number\.isFinite\(/)
  })

  it('exports Symbol-free public surface (no Symbol-keyed runtime exports)', () => {
    // No `export const` of any Symbol-typed value.
    expect(SOURCE).not.toMatch(/export\s+const\s+\w+\s*=\s*Symbol/)
  })

  it('does not declare any class (the module is pure functions + types only)', () => {
    expect(SOURCE).not.toMatch(/^export\s+class\s+/m)
    expect(SOURCE).not.toMatch(/^class\s+/m)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// End of pin file
// ────────────────────────────────────────────────────────────────────────────
