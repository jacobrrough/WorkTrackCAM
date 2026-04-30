/**
 * cam-machine-envelope-pin.test.ts -- [ID-0244] Cycle 172 cam-engine paired-pin
 *
 * Co-located paired-pin contract for `src/shared/cam-machine-envelope.ts`
 * (123-line / ~3.4 KB SHARED post-toolpath envelope-and-rotary-radial
 * validator). Five exported pure surfaces:
 *   - `computeToolpathBoundsFromSegments(segments)` -> bounds | null
 *   - `compareToolpathToMachineEnvelope(segments, workAreaMm)` -> check
 *   - `formatMachineEnvelopeHintForPostedGcode(gcode, workAreaMm)` -> string
 *   - `maxRadialExtentYZFromSegments(segments)` -> number (>= 0)
 *   - `formatRotaryRadialHintForPostedGcode(gcode, dia)` -> string
 * Plus the type-only triplet `MachineEnvelopeBoundsGcode`,
 * `MachineEnvelopeViolation`, `MachineEnvelopeCheck`.
 *
 * Production call-sites verified via `grep -rn` 2026-04-29:
 *   - `src/main/cam-runner.ts:33`           (main 3-axis runner re-export)
 *   - `src/main/cam-axis4/index.ts:29`      (4-axis runner re-export)
 *   - `src/renderer/manufacture/ManufactureCamSimulationPanel.tsx:6`
 *     (renderer-side simulation panel uses
 *     `compareToolpathToMachineEnvelope` to badge the simulation preview)
 *
 * Existing coverage: `src/shared/cam-machine-envelope.test.ts` (203 lines,
 * 18 it() blocks) covers happy path + several violation paths. This file
 * complements with the contract surface: module shape, function signatures,
 * exact return-object shapes, regex-stable hint message formats, three-machine
 * path realism (K2 Plus 350x350x350 mm bed; Laguna Swift 5x10 1524x3048x190
 * mm sheet; Carvera 360x240x140 mm + 4-axis rotary radial), pure-function
 * invariants (idempotent N=20, no input mutation, no this-binding leakage,
 * fresh return array each call), boundary conditions (exactly-on-edge,
 * sub-mm hairline, large-magnitude inputs), and the inclusive/exclusive
 * boundary semantics that downstream UX depends on.
 *
 * Per CLAUDE.md "USER CONTEXT -- TARGET MACHINES" this validator is the
 * LAST defensive check the runner emits before posted G-code reaches the
 * machine UI. A regression silently shipping out-of-envelope toolpaths
 * is the exact crash class the validator exists to prevent:
 *   - K2 Plus: above-bed Z would crash the toolhead into the gantry; out of
 *     350x350 in X/Y prints onto the chamber walls or the door.
 *   - Laguna Swift 5x10: out of 1524x3048 mm rams the gantry hard-stops at
 *     full feed; below-Z (negative) gouges the spoilboard / vacuum table.
 *   - Carvera + 4-axis: out of 360x240x140 envelope hits the enclosure or
 *     ATC carousel; rotary YZ exceeding nominal stock radius means the cutter
 *     reaches PAST the stock surface -- a tool-crash on aluminum / wax / wood.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain, newest-first):
 *   - 171 [ID-0243] stl-vec3                                   (test-coverage)
 *   - 170 [ID-0242] gcode-export-safety                        (ui-polish)
 *   - 169 [ID-0241]/[ID-0067-data-v24] EDIT-WORKFLOW.md docs   (docs-and-dx)
 *   - 168 [ID-0240] gcode-header-invariants                    (post-processing)
 *   - 167 [ID-0239] cam-scallop-stepover                       (cam-engine)
 *   - 166 [ID-0238] kernel-placement-parity                    (test-coverage)
 *   - 165 [ID-0237] path-join                                  (ui-polish)
 *   - 164 [ID-0236] EDIT-WORKFLOW.md docs                      (docs-and-dx)
 *   - 163 [ID-0235] machine-post-template-hints                (post-processing)
 *   - 162 [ID-0234] cam-progress                               (test-coverage)
 *
 * Pinned surfaces:
 *   (A) Module shape -- runtime export inventory: 5 functions, 0 non-function
 *       runtime exports. The 3 type-only exports MUST NOT appear at runtime.
 *   (B) Function signatures -- name / arity / native-Function for all 5.
 *   (C) computeToolpathBoundsFromSegments -- empty-list returns null;
 *       single-segment endpoints define the bounds; min/max picks the extreme
 *       of every endpoint; non-finite coords (NaN/Infinity) collapse to null
 *       via the `Number.isFinite(minX)` guard.
 *   (D) compareToolpathToMachineEnvelope -- empty-list yields
 *       `{withinEnvelope:true, bounds:null, violations:[]}`; the violation
 *       object EXACT 3-key shape `{axis,kind,excessMm}`; violation order
 *       matches the source-code emit order (X-min, X-max, Y-min, Y-max,
 *       Z-min, Z-max); `withinEnvelope` is exactly `violations.length === 0`.
 *   (E) Boundary semantics -- exactly-on-edge passes (no violation when
 *       coord == bound); sub-mm hairline drift triggers; >0 epsilon does NOT
 *       activate the boundary unless strictly outside.
 *   (F) formatMachineEnvelopeHintForPostedGcode -- empty/whitespace gcode
 *       returns `''`; within-envelope returns `''`; out-of-envelope hint
 *       starts with the literal ` Machine work volume warning:` (leading
 *       space) and ends with `MACHINES.md.`; per-violation suffix uses
 *       `(~N.N mm outside)` format with exactly one decimal place.
 *   (G) maxRadialExtentYZFromSegments -- empty-list returns 0; uses
 *       `Math.hypot(y, z)` over both endpoints; ignores X (axial); always
 *       returns a non-negative number; absolute-value invariance (sign of
 *       Y or Z does NOT change radius).
 *   (H) formatRotaryRadialHintForPostedGcode -- empty-string fast path; zero
 *       and negative diameter fast path; within-radius (R + 0.5 mm slop)
 *       returns `''`; outside emits the literal ` Rotary radial hint: YZ
 *       toolpath reach ~N.N mm vs nominal stock radius N.N mm (ON.N).` with
 *       the leading-space + Ø-symbol convention.
 *   (I) Three-machine path realism -- K2 Plus 350x350x350 happy + at-edge +
 *       above-bed Z fail; Laguna Swift 5x10 1524x3048x190 happy + below-Z +
 *       past-X fail; Carvera 360x240x140 happy + 4-axis rotary YZ-exceeds-
 *       stock-radius fail.
 *   (J) Pure-function invariants -- idempotent N=20 over each function;
 *       no input-segment mutation; no this-binding leakage on call/apply;
 *       fresh return object/array each call; plain-Array / plain-Object
 *       prototype.
 *   (K) Multi-violation accumulation -- violations from multiple axes
 *       co-exist in one check; the count matches the number of axes that
 *       breach; the order is deterministic.
 *   (L) Hint-message regex contract -- the suffix `MACHINES.md.` and the
 *       prefix space + capital-letter axis label are literal contract
 *       points downstream UX consumes. Full regex pinned.
 *   (M) Type-export non-runtime -- `MachineEnvelopeBoundsGcode`,
 *       `MachineEnvelopeViolation`, `MachineEnvelopeCheck` MUST be type-only
 *       and NOT show up on the runtime module record.
 */

import { describe, expect, it } from 'vitest'
import * as mod from './cam-machine-envelope'
import {
  compareToolpathToMachineEnvelope,
  computeToolpathBoundsFromSegments,
  formatMachineEnvelopeHintForPostedGcode,
  formatRotaryRadialHintForPostedGcode,
  maxRadialExtentYZFromSegments
} from './cam-machine-envelope'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Standard simple unit-box envelope used in legacy behavioral tests. */
const box = { x: 100, y: 80, z: 50 } as const

const seg = (
  kind: 'rapid' | 'feed',
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number
): ToolpathSegment3 => ({ kind, x0, y0, z0, x1, y1, z1 })

const RAPID_AT_ORIGIN: ToolpathSegment3 = seg('rapid', 0, 0, 0, 0, 0, 0)

/** K2 Plus build volume (per CLAUDE.md). */
const K2_BED = { x: 350, y: 350, z: 350 } as const
/** Laguna Swift 5x10 envelope: 60" x 120" x ~7.5" Z clearance. */
const LAGUNA_5X10 = { x: 1524, y: 3048, z: 190 } as const
/** Makera Carvera 3-axis envelope. */
const CARVERA_3AX = { x: 360, y: 240, z: 140 } as const

// ===========================================================================
// (A) Module shape
// ===========================================================================

describe('[ID-0244] (A) module shape -- runtime export inventory', () => {
  it('exposes computeToolpathBoundsFromSegments as a function', () => {
    expect(typeof mod.computeToolpathBoundsFromSegments).toBe('function')
  })

  it('exposes compareToolpathToMachineEnvelope as a function', () => {
    expect(typeof mod.compareToolpathToMachineEnvelope).toBe('function')
  })

  it('exposes formatMachineEnvelopeHintForPostedGcode as a function', () => {
    expect(typeof mod.formatMachineEnvelopeHintForPostedGcode).toBe('function')
  })

  it('exposes maxRadialExtentYZFromSegments as a function', () => {
    expect(typeof mod.maxRadialExtentYZFromSegments).toBe('function')
  })

  it('exposes formatRotaryRadialHintForPostedGcode as a function', () => {
    expect(typeof mod.formatRotaryRadialHintForPostedGcode).toBe('function')
  })

  it('runtime export inventory is exactly the 5 functions (no extras, no type-export leak)', () => {
    const fnKeys = Object.keys(mod).filter(
      (k) => typeof (mod as unknown as Record<string, unknown>)[k] === 'function'
    )
    expect(fnKeys.sort()).toEqual([
      'compareToolpathToMachineEnvelope',
      'computeToolpathBoundsFromSegments',
      'formatMachineEnvelopeHintForPostedGcode',
      'formatRotaryRadialHintForPostedGcode',
      'maxRadialExtentYZFromSegments'
    ])
  })

  it('does NOT leak the type-only triplet at runtime', () => {
    const m = mod as unknown as Record<string, unknown>
    expect(m.MachineEnvelopeBoundsGcode).toBeUndefined()
    expect(m.MachineEnvelopeViolation).toBeUndefined()
    expect(m.MachineEnvelopeCheck).toBeUndefined()
  })
})

// ===========================================================================
// (B) Function signatures -- name / arity / native-Function
// ===========================================================================

describe('[ID-0244] (B) function signatures -- name / arity / native', () => {
  it('computeToolpathBoundsFromSegments has name == "computeToolpathBoundsFromSegments"', () => {
    expect(computeToolpathBoundsFromSegments.name).toBe('computeToolpathBoundsFromSegments')
  })

  it('computeToolpathBoundsFromSegments arity == 1', () => {
    expect(computeToolpathBoundsFromSegments.length).toBe(1)
  })

  it('compareToolpathToMachineEnvelope has name == "compareToolpathToMachineEnvelope"', () => {
    expect(compareToolpathToMachineEnvelope.name).toBe('compareToolpathToMachineEnvelope')
  })

  it('compareToolpathToMachineEnvelope arity == 2', () => {
    expect(compareToolpathToMachineEnvelope.length).toBe(2)
  })

  it('formatMachineEnvelopeHintForPostedGcode has name == "formatMachineEnvelopeHintForPostedGcode"', () => {
    expect(formatMachineEnvelopeHintForPostedGcode.name).toBe('formatMachineEnvelopeHintForPostedGcode')
  })

  it('formatMachineEnvelopeHintForPostedGcode arity == 2', () => {
    expect(formatMachineEnvelopeHintForPostedGcode.length).toBe(2)
  })

  it('maxRadialExtentYZFromSegments has name == "maxRadialExtentYZFromSegments"', () => {
    expect(maxRadialExtentYZFromSegments.name).toBe('maxRadialExtentYZFromSegments')
  })

  it('maxRadialExtentYZFromSegments arity == 1', () => {
    expect(maxRadialExtentYZFromSegments.length).toBe(1)
  })

  it('formatRotaryRadialHintForPostedGcode has name == "formatRotaryRadialHintForPostedGcode"', () => {
    expect(formatRotaryRadialHintForPostedGcode.name).toBe('formatRotaryRadialHintForPostedGcode')
  })

  it('formatRotaryRadialHintForPostedGcode arity == 2', () => {
    expect(formatRotaryRadialHintForPostedGcode.length).toBe(2)
  })

  it('all 5 are user-defined functions (not native bound)', () => {
    // User-defined function bodies do not start with `function ... { [native code] }`
    expect(computeToolpathBoundsFromSegments.toString()).not.toMatch(/\[native code\]/)
    expect(compareToolpathToMachineEnvelope.toString()).not.toMatch(/\[native code\]/)
    expect(formatMachineEnvelopeHintForPostedGcode.toString()).not.toMatch(/\[native code\]/)
    expect(maxRadialExtentYZFromSegments.toString()).not.toMatch(/\[native code\]/)
    expect(formatRotaryRadialHintForPostedGcode.toString()).not.toMatch(/\[native code\]/)
  })
})

// ===========================================================================
// (C) computeToolpathBoundsFromSegments
// ===========================================================================

describe('[ID-0244] (C) computeToolpathBoundsFromSegments', () => {
  it('empty list returns null (NOT an empty bounds object)', () => {
    expect(computeToolpathBoundsFromSegments([])).toBeNull()
  })

  it('single-point degenerate segment yields a zero-width bounds (not null)', () => {
    const r = computeToolpathBoundsFromSegments([RAPID_AT_ORIGIN])
    expect(r).not.toBeNull()
    expect(r).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 })
  })

  it('considers BOTH endpoints (not just start or end)', () => {
    const segs = [seg('feed', -5, -3, -1, 7, 9, 11)]
    expect(computeToolpathBoundsFromSegments(segs)).toEqual({
      minX: -5, maxX: 7, minY: -3, maxY: 9, minZ: -1, maxZ: 11
    })
  })

  it('aggregates min/max across multiple segments', () => {
    const segs = [
      seg('rapid', 0, 0, 0, 10, 5, -2),
      seg('feed', 10, 5, -2, 10, 5, -5),
      seg('feed', 10, 5, -5, -3, 100, 0)
    ]
    expect(computeToolpathBoundsFromSegments(segs)).toEqual({
      minX: -3, maxX: 10, minY: 0, maxY: 100, minZ: -5, maxZ: 0
    })
  })

  it('returns null when ALL coords are NaN (Number.isFinite guard fires)', () => {
    const segs = [seg('feed', NaN, NaN, NaN, NaN, NaN, NaN)]
    expect(computeToolpathBoundsFromSegments(segs)).toBeNull()
  })

  it('returns null when X coords are non-finite (single-axis triggers the guard)', () => {
    const segs = [seg('feed', NaN, 0, 0, 1, 1, 1)]
    // The guard checks minX -- one NaN poisons the X axis to NaN/Infinity
    expect(computeToolpathBoundsFromSegments(segs)).toBeNull()
  })

  it('handles negative-only coordinates (full negative octant)', () => {
    const segs = [seg('feed', -10, -20, -30, -1, -2, -3)]
    expect(computeToolpathBoundsFromSegments(segs)).toEqual({
      minX: -10, maxX: -1, minY: -20, maxY: -2, minZ: -30, maxZ: -3
    })
  })

  it('preserves exact integer coordinates without floating-point drift', () => {
    const segs = [seg('rapid', 1, 2, 3, 4, 5, 6)]
    const r = computeToolpathBoundsFromSegments(segs)!
    expect(r.minX).toBe(1)
    expect(r.maxX).toBe(4)
    expect(r.minY).toBe(2)
    expect(r.maxY).toBe(5)
    expect(r.minZ).toBe(3)
    expect(r.maxZ).toBe(6)
  })

  it('returns a plain Object prototype (not a class instance)', () => {
    const r = computeToolpathBoundsFromSegments([RAPID_AT_ORIGIN])!
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
  })

  it('returned object has EXACTLY 6 keys (the documented bounds shape)', () => {
    const r = computeToolpathBoundsFromSegments([RAPID_AT_ORIGIN])!
    expect(Object.keys(r).sort()).toEqual(['maxX', 'maxY', 'maxZ', 'minX', 'minY', 'minZ'])
  })

  it('does NOT mutate the input segment array', () => {
    const segs = [seg('feed', 0, 0, 0, 1, 1, 1)]
    const before = JSON.stringify(segs)
    computeToolpathBoundsFromSegments(segs)
    expect(JSON.stringify(segs)).toBe(before)
  })
})

// ===========================================================================
// (D) compareToolpathToMachineEnvelope -- shape + axis emit order
// ===========================================================================

describe('[ID-0244] (D) compareToolpathToMachineEnvelope -- shape + emit order', () => {
  it('empty segment list yields {withinEnvelope:true, bounds:null, violations:[]}', () => {
    const r = compareToolpathToMachineEnvelope([], box)
    expect(r).toEqual({ withinEnvelope: true, bounds: null, violations: [] })
  })

  it('returned object has EXACTLY 3 keys (withinEnvelope, bounds, violations)', () => {
    const r = compareToolpathToMachineEnvelope([RAPID_AT_ORIGIN], box)
    expect(Object.keys(r).sort()).toEqual(['bounds', 'violations', 'withinEnvelope'])
  })

  it('withinEnvelope is exactly violations.length === 0', () => {
    // happy
    const happy = compareToolpathToMachineEnvelope([seg('feed', 0, 0, 0, 1, 1, 1)], box)
    expect(happy.withinEnvelope).toBe(happy.violations.length === 0)
    expect(happy.withinEnvelope).toBe(true)
    // sad
    const sad = compareToolpathToMachineEnvelope([seg('feed', 0, 0, 0, 999, 1, 1)], box)
    expect(sad.withinEnvelope).toBe(sad.violations.length === 0)
    expect(sad.withinEnvelope).toBe(false)
  })

  it('bounds is non-null when there is at least one segment', () => {
    const r = compareToolpathToMachineEnvelope([RAPID_AT_ORIGIN], box)
    expect(r.bounds).not.toBeNull()
  })

  it('violation object has EXACTLY the 3 documented keys axis/kind/excessMm', () => {
    const r = compareToolpathToMachineEnvelope([seg('feed', 0, 0, 0, 999, 1, 1)], box)
    expect(r.violations.length).toBeGreaterThanOrEqual(1)
    for (const v of r.violations) {
      expect(Object.keys(v).sort()).toEqual(['axis', 'excessMm', 'kind'])
    }
  })

  it('violation.axis is one of "x"|"y"|"z" (lowercase only)', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', -5, -5, -5, 999, 999, 999)],
      box
    )
    for (const v of r.violations) {
      expect(['x', 'y', 'z']).toContain(v.axis)
    }
  })

  it('violation.kind is one of "below_min"|"above_max"', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', -5, -5, -5, 999, 999, 999)],
      box
    )
    for (const v of r.violations) {
      expect(['below_min', 'above_max']).toContain(v.kind)
    }
  })

  it('violation.excessMm is a non-negative finite number', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', -5, -5, -5, 999, 999, 999)],
      box
    )
    for (const v of r.violations) {
      expect(Number.isFinite(v.excessMm)).toBe(true)
      expect(v.excessMm).toBeGreaterThanOrEqual(0)
    }
  })

  it('emits violations in source-code order: X-min, X-max, Y-min, Y-max, Z-min, Z-max', () => {
    // Construct a path that violates ALL six axes:
    // negative on each axis by at least 1, and positive past each bound by at least 1.
    const segs = [seg('feed', -1, -1, -1, 200, 200, 200)]
    const r = compareToolpathToMachineEnvelope(segs, box)
    // Expected order = each pair (axis, kind) in source order
    expect(r.violations.map((v) => `${v.axis}:${v.kind}`)).toEqual([
      'x:below_min',
      'x:above_max',
      'y:below_min',
      'y:above_max',
      'z:below_min',
      'z:above_max'
    ])
  })

  it('returned violations is a plain Array', () => {
    const r = compareToolpathToMachineEnvelope([RAPID_AT_ORIGIN], box)
    expect(Array.isArray(r.violations)).toBe(true)
    expect(Object.getPrototypeOf(r.violations)).toBe(Array.prototype)
  })

  it('returned check object is a plain Object (not a class instance)', () => {
    const r = compareToolpathToMachineEnvelope([RAPID_AT_ORIGIN], box)
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
  })

  it('different calls produce different array identities (no cached singleton)', () => {
    const a = compareToolpathToMachineEnvelope([RAPID_AT_ORIGIN], box)
    const b = compareToolpathToMachineEnvelope([RAPID_AT_ORIGIN], box)
    expect(a).not.toBe(b)
    expect(a.violations).not.toBe(b.violations)
  })
})

// ===========================================================================
// (E) Boundary semantics -- exactly-on-edge passes; sub-mm drift triggers
// ===========================================================================

describe('[ID-0244] (E) boundary semantics -- inclusive edge, strict outside', () => {
  it('exactly on max edge does NOT violate (`bounds.maxX > wx` is strict)', () => {
    // box.x = 100; reach exactly 100
    const segs = [seg('rapid', 0, 0, 0, 100, 0, 0)]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(true)
  })

  it('exactly on min edge (0) does NOT violate (`bounds.minX < 0` is strict)', () => {
    const segs = [seg('rapid', 0, 0, 0, 0, 0, 0)]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(true)
  })

  it('hairline 0.001 mm above max DOES violate (sub-mm precision preserved)', () => {
    const segs = [seg('feed', 0, 0, 0, 100.001, 0, 0)]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    const v = r.violations.find((vv) => vv.axis === 'x' && vv.kind === 'above_max')!
    expect(v.excessMm).toBeCloseTo(0.001, 6)
  })

  it('hairline -0.001 mm DOES violate as below_min', () => {
    const segs = [seg('feed', 0, 0, 0, -0.001, 0.5, 0.5)]
    const r = compareToolpathToMachineEnvelope(segs, box)
    expect(r.withinEnvelope).toBe(false)
    const v = r.violations.find((vv) => vv.axis === 'x' && vv.kind === 'below_min')!
    expect(v.excessMm).toBeCloseTo(0.001, 6)
  })

  it('reports the largest extreme as the excess (max-X across multiple segments)', () => {
    const segs = [
      seg('feed', 0, 0, 0, 110, 0, 0),
      seg('feed', 110, 0, 0, 130, 0, 0)
    ]
    const r = compareToolpathToMachineEnvelope(segs, box)
    const v = r.violations.find((vv) => vv.axis === 'x' && vv.kind === 'above_max')!
    expect(v.excessMm).toBeCloseTo(30) // 130 - 100
  })
})

// ===========================================================================
// (F) formatMachineEnvelopeHintForPostedGcode -- string contract
// ===========================================================================

describe('[ID-0244] (F) formatMachineEnvelopeHintForPostedGcode -- format contract', () => {
  it('empty gcode returns ""', () => {
    expect(formatMachineEnvelopeHintForPostedGcode('', box)).toBe('')
  })

  it('whitespace-only gcode returns ""', () => {
    expect(formatMachineEnvelopeHintForPostedGcode('   \n\t', box)).toBe('')
  })

  it('within envelope returns ""', () => {
    expect(formatMachineEnvelopeHintForPostedGcode('G0 X10 Y10 Z5', box)).toBe('')
  })

  it('out-of-envelope hint starts with leading-space + "Machine work volume warning:"', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150 Y10 Z5', box)
    expect(h.startsWith(' Machine work volume warning:')).toBe(true)
  })

  it('hint ends with the literal "MACHINES.md."', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150 Y10 Z5', box)
    expect(h.endsWith('MACHINES.md.')).toBe(true)
  })

  it('above_max suffix uses "past work volume max" phrasing with one decimal', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150 Y10 Z5', box)
    expect(h).toMatch(/X past work volume max \(~50\.0 mm outside\)/)
  })

  it('below_min suffix uses "below machine origin" phrasing with one decimal', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X-7.5 Y10 Z5', box)
    expect(h).toMatch(/X below machine origin \(~7\.5 mm outside\)/)
  })

  it('axis label is uppercase in the hint regardless of internal "x"/"y"/"z"', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X10 Y200 Z200', box)
    expect(h).toContain(' Y past work volume max ')
    expect(h).toContain(' Z past work volume max ')
    // Lowercase axis should NOT appear in the hint string (the literal " Machine"
    // header contains "M" but no axis letters; check that lowercase " y past" /
    // " z past" do not show up)
    expect(h).not.toMatch(/[ (][yz] past work volume max/)
  })

  it('multi-axis violations are joined by "; " in the suffix list', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150 Y200 Z60', box)
    // Three violations -> two "; " separators between them
    const sep = h.match(/; /g) || []
    expect(sep.length).toBe(2)
  })

  it('hint is a non-empty string when out of envelope', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150', box)
    expect(typeof h).toBe('string')
    expect(h.length).toBeGreaterThan(0)
  })

  it('Z above max emits the past-max phrasing for the Z axis', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G0 X5 Y5 Z60', box)
    expect(h).toMatch(/Z past work volume max \(~10\.0 mm outside\)/)
  })

  it('decimal formatting is exactly one decimal place (toFixed(1) contract)', () => {
    // Excess of 5.678 -> "5.7"
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X105.678 Y10 Z5', box)
    expect(h).toContain('~5.7 mm outside')
    expect(h).not.toContain('~5.68')
    expect(h).not.toContain('~5.6780')
  })
})

// ===========================================================================
// (G) maxRadialExtentYZFromSegments
// ===========================================================================

describe('[ID-0244] (G) maxRadialExtentYZFromSegments -- YZ-only hypot', () => {
  it('empty list returns 0 (not -Infinity, not NaN)', () => {
    expect(maxRadialExtentYZFromSegments([])).toBe(0)
  })

  it('uses Math.hypot(y, z) on each endpoint (3-4-5 triangle)', () => {
    const segs = [seg('feed', 0, 3, 4, 0, 3, 4)]
    expect(maxRadialExtentYZFromSegments(segs)).toBeCloseTo(5, 9)
  })

  it('considers BOTH endpoints, not just start', () => {
    // Start at radius=5 (3,4); end at radius=13 (5,12)
    const segs = [seg('feed', 0, 3, 4, 0, 5, 12)]
    expect(maxRadialExtentYZFromSegments(segs)).toBeCloseTo(13, 9)
  })

  it('returns the MAX across multiple segments', () => {
    const segs = [
      seg('feed', 0, 3, 4, 0, 0, 0),
      seg('feed', 0, 6, 8, 0, 0, 0)
    ]
    // r0 = 5, r1 = 10
    expect(maxRadialExtentYZFromSegments(segs)).toBeCloseTo(10, 9)
  })

  it('ignores X (axial) entirely', () => {
    const segs = [seg('feed', 9999, 3, 4, 9999, 3, 4)]
    expect(maxRadialExtentYZFromSegments(segs)).toBeCloseTo(5, 9)
  })

  it('absolute-value invariance -- sign of Y or Z does NOT change the radius', () => {
    const r1 = maxRadialExtentYZFromSegments([seg('feed', 0, 3, 4, 0, 3, 4)])
    const r2 = maxRadialExtentYZFromSegments([seg('feed', 0, -3, 4, 0, -3, 4)])
    const r3 = maxRadialExtentYZFromSegments([seg('feed', 0, 3, -4, 0, 3, -4)])
    const r4 = maxRadialExtentYZFromSegments([seg('feed', 0, -3, -4, 0, -3, -4)])
    expect(r1).toBeCloseTo(5, 9)
    expect(r2).toBeCloseTo(5, 9)
    expect(r3).toBeCloseTo(5, 9)
    expect(r4).toBeCloseTo(5, 9)
  })

  it('always returns a non-negative number', () => {
    expect(maxRadialExtentYZFromSegments([])).toBeGreaterThanOrEqual(0)
    expect(
      maxRadialExtentYZFromSegments([seg('feed', 0, -100, -100, 0, -100, -100)])
    ).toBeGreaterThanOrEqual(0)
  })

  it('does NOT mutate the input segment array', () => {
    const segs = [seg('feed', 0, 3, 4, 0, 5, 12)]
    const before = JSON.stringify(segs)
    maxRadialExtentYZFromSegments(segs)
    expect(JSON.stringify(segs)).toBe(before)
  })
})

// ===========================================================================
// (H) formatRotaryRadialHintForPostedGcode
// ===========================================================================

describe('[ID-0244] (H) formatRotaryRadialHintForPostedGcode -- format contract', () => {
  it('empty string gcode returns ""', () => {
    expect(formatRotaryRadialHintForPostedGcode('', 80)).toBe('')
  })

  it('whitespace-only gcode returns ""', () => {
    expect(formatRotaryRadialHintForPostedGcode('   \n\t', 80)).toBe('')
  })

  it('zero diameter returns "" (fast-path guard)', () => {
    expect(formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 0)).toBe('')
  })

  it('negative diameter returns "" (fast-path guard)', () => {
    expect(formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', -10)).toBe('')
  })

  it('within radius (R + 0.5 mm slop) returns ""', () => {
    // dia=80 -> R=40; YZ radius=5 (3,4) is well within
    expect(formatRotaryRadialHintForPostedGcode('G1 X0 Y3 Z4', 80)).toBe('')
  })

  it('exactly on R + 0.5 mm slop boundary returns "" (inclusive slop)', () => {
    // dia=80 -> R=40; reach exactly 40.5
    // y=24.3, z=32.4 -> hypot ≈ 40.5
    expect(formatRotaryRadialHintForPostedGcode('G1 X0 Y24.3 Z32.4', 80)).toBe('')
  })

  it('R + 0.6 mm DOES emit the hint', () => {
    // y=24.36, z=32.48 -> hypot ≈ 40.6
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y24.36 Z32.48', 80)
    expect(h).not.toBe('')
  })

  it('hint starts with leading-space + "Rotary radial hint:"', () => {
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h.startsWith(' Rotary radial hint:')).toBe(true)
  })

  it('hint contains the diameter symbol "Ø" with one-decimal formatting', () => {
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h).toContain('Ø80.0')
  })

  it('hint contains the nominal stock radius with one-decimal formatting', () => {
    // dia=80 -> R=40
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h).toContain('nominal stock radius 40.0 mm')
  })

  it('hint ends with "MACHINES.md."', () => {
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h.endsWith('MACHINES.md.')).toBe(true)
  })

  it('reach value uses toFixed(1) (one decimal)', () => {
    // y=30,z=40 -> hypot=50
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h).toMatch(/YZ toolpath reach ~50\.0 mm/)
  })
})

// ===========================================================================
// (I) Three-machine path realism
// ===========================================================================

describe('[ID-0244] (I) three-machine path realism', () => {
  // ----------- K2 Plus (350x350x350) -----------

  it('K2 Plus -- 100x100 mm test square at center is within envelope', () => {
    const segs = [
      seg('rapid', 125, 125, 0.2, 125, 225, 0.2),
      seg('feed', 125, 225, 0.2, 225, 225, 0.2),
      seg('feed', 225, 225, 0.2, 225, 125, 0.2),
      seg('feed', 225, 125, 0.2, 125, 125, 0.2)
    ]
    const r = compareToolpathToMachineEnvelope(segs, K2_BED)
    expect(r.withinEnvelope).toBe(true)
    expect(r.bounds).toEqual({ minX: 125, maxX: 225, minY: 125, maxY: 225, minZ: 0.2, maxZ: 0.2 })
  })

  it('K2 Plus -- exactly-at-edge corner (350,350,0) is within envelope (inclusive)', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('rapid', 0, 0, 0, 350, 350, 0)],
      K2_BED
    )
    expect(r.withinEnvelope).toBe(true)
  })

  it('K2 Plus -- above-bed Z (351 mm) DOES violate (gantry crash class)', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('rapid', 175, 175, 351, 175, 175, 351)],
      K2_BED
    )
    expect(r.withinEnvelope).toBe(false)
    expect(
      r.violations.some((v) => v.axis === 'z' && v.kind === 'above_max')
    ).toBe(true)
  })

  // ----------- Laguna Swift 5x10 (1524x3048x190) -----------

  it('Laguna Swift -- full-sheet contour stays within 60x120" envelope', () => {
    const segs = [
      seg('rapid', 10, 10, 5, 1514, 10, 5),
      seg('feed', 1514, 10, 5, 1514, 3038, 5),
      seg('feed', 1514, 3038, 5, 10, 3038, 5),
      seg('feed', 10, 3038, 5, 10, 10, 5)
    ]
    const r = compareToolpathToMachineEnvelope(segs, LAGUNA_5X10)
    expect(r.withinEnvelope).toBe(true)
  })

  it('Laguna Swift -- past-X (1525 mm) DOES violate', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', 0, 0, 5, 1525, 0, 5)],
      LAGUNA_5X10
    )
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'x' && v.kind === 'above_max')).toBe(true)
  })

  it('Laguna Swift -- below-Z (negative -3 mm) gouges spoilboard, MUST violate', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', 100, 100, 0, 100, 100, -3)],
      LAGUNA_5X10
    )
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'z' && v.kind === 'below_min')).toBe(true)
  })

  it('Laguna Swift -- hint format names the X axis when overshoot occurs', () => {
    const g = `G0 X1525 Y100 Z5`
    const h = formatMachineEnvelopeHintForPostedGcode(g, LAGUNA_5X10)
    expect(h).toContain('X past work volume max')
    expect(h).toContain('MACHINES.md.')
  })

  // ----------- Carvera (360x240x140) + 4-axis rotary -----------

  it('Carvera -- 100x100 mm pocket at 0,0,5 is within envelope', () => {
    const r = compareToolpathToMachineEnvelope(
      [
        seg('rapid', 0, 0, 5, 100, 0, 5),
        seg('feed', 100, 0, 5, 100, 100, 5),
        seg('feed', 100, 100, 5, 0, 100, 5)
      ],
      CARVERA_3AX
    )
    expect(r.withinEnvelope).toBe(true)
  })

  it('Carvera -- past-X (361 mm) DOES violate (enclosure crash class)', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', 0, 0, 5, 361, 0, 5)],
      CARVERA_3AX
    )
    expect(r.withinEnvelope).toBe(false)
    expect(r.violations.some((v) => v.axis === 'x' && v.kind === 'above_max')).toBe(true)
  })

  it('Carvera 4-axis -- YZ extent within stock radius emits no rotary hint', () => {
    // 25 mm dia rotary stock -> R=12.5 mm
    // YZ reach = 12.0 mm, well within R+0.5 slop = 13.0
    const g = `G1 X0 Y0 Z12 A45`
    expect(formatRotaryRadialHintForPostedGcode(g, 25)).toBe('')
  })

  it('Carvera 4-axis -- YZ extent BEYOND stock radius emits rotary hint (tool-crash class)', () => {
    // 25 mm dia rotary stock -> R=12.5 mm
    // YZ reach = 14.0 mm, beyond R+0.5 slop = 13.0
    const g = `G1 X0 Y0 Z14 A45`
    const h = formatRotaryRadialHintForPostedGcode(g, 25)
    expect(h).not.toBe('')
    expect(h).toContain('Rotary radial hint')
    expect(h).toContain('Ø25.0')
  })

  it('Carvera 4-axis -- max stock diameter ~92 mm with 30 mm reach is within slop', () => {
    // 92 mm dia -> R=46 mm; reach 30 mm well within R+0.5
    const g = `G1 X0 Y20 Z22.36 A0`
    expect(formatRotaryRadialHintForPostedGcode(g, 92)).toBe('')
  })
})

// ===========================================================================
// (J) Pure-function invariants -- idempotent, no mutation, no this-leak
// ===========================================================================

describe('[ID-0244] (J) pure-function invariants', () => {
  it('computeToolpathBoundsFromSegments idempotent over N=20 invocations (deep-equal)', () => {
    const segs = [seg('feed', -3, 4, 5, 6, -7, 8)]
    const first = computeToolpathBoundsFromSegments(segs)
    for (let i = 0; i < 20; i++) {
      expect(computeToolpathBoundsFromSegments(segs)).toEqual(first)
    }
  })

  it('compareToolpathToMachineEnvelope idempotent over N=20 invocations (deep-equal)', () => {
    const segs = [seg('feed', -1, -1, -1, 200, 200, 200)]
    const first = compareToolpathToMachineEnvelope(segs, box)
    for (let i = 0; i < 20; i++) {
      expect(compareToolpathToMachineEnvelope(segs, box)).toEqual(first)
    }
  })

  it('formatMachineEnvelopeHintForPostedGcode idempotent over N=20 invocations', () => {
    const g = `G1 X150 Y10 Z5`
    const first = formatMachineEnvelopeHintForPostedGcode(g, box)
    for (let i = 0; i < 20; i++) {
      expect(formatMachineEnvelopeHintForPostedGcode(g, box)).toBe(first)
    }
  })

  it('maxRadialExtentYZFromSegments idempotent over N=20 invocations', () => {
    const segs = [seg('feed', 0, 3, 4, 0, 5, 12)]
    const first = maxRadialExtentYZFromSegments(segs)
    for (let i = 0; i < 20; i++) {
      expect(maxRadialExtentYZFromSegments(segs)).toBe(first)
    }
  })

  it('formatRotaryRadialHintForPostedGcode idempotent over N=20 invocations', () => {
    const g = `G1 X0 Y30 Z40`
    const first = formatRotaryRadialHintForPostedGcode(g, 80)
    for (let i = 0; i < 20; i++) {
      expect(formatRotaryRadialHintForPostedGcode(g, 80)).toBe(first)
    }
  })

  it('compareToolpathToMachineEnvelope returns a fresh object each call (no aliasing)', () => {
    const segs = [seg('feed', -1, -1, -1, 200, 200, 200)]
    const a = compareToolpathToMachineEnvelope(segs, box)
    const b = compareToolpathToMachineEnvelope(segs, box)
    expect(a).not.toBe(b)
    expect(a.bounds).not.toBe(b.bounds)
    expect(a.violations).not.toBe(b.violations)
  })

  it('compareToolpathToMachineEnvelope does NOT mutate the input segment array', () => {
    const segs = [seg('feed', 0, 0, 0, 999, 999, 999)]
    const before = JSON.stringify(segs)
    compareToolpathToMachineEnvelope(segs, box)
    expect(JSON.stringify(segs)).toBe(before)
  })

  it('compareToolpathToMachineEnvelope does NOT mutate the input workArea', () => {
    const segs = [seg('feed', 0, 0, 0, 999, 999, 999)]
    const wa = { x: 100, y: 80, z: 50 }
    const before = { ...wa }
    compareToolpathToMachineEnvelope(segs, wa)
    expect(wa).toEqual(before)
  })

  it('compareToolpathToMachineEnvelope works under .call(undefined, ...) -- no this-binding leak', () => {
    const segs = [seg('feed', 0, 0, 0, 1, 1, 1)]
    const r = compareToolpathToMachineEnvelope.call(undefined, segs, box)
    expect(r.withinEnvelope).toBe(true)
  })

  it('formatMachineEnvelopeHintForPostedGcode works under .apply(null, ...) -- no this-binding leak', () => {
    const r = formatMachineEnvelopeHintForPostedGcode.apply(null, ['G0 X10', box])
    expect(r).toBe('')
  })

  it('maxRadialExtentYZFromSegments returns the SAME numeric value with no NaN drift across 100 iterations', () => {
    const segs = [seg('feed', 0, 3, 4, 0, 0, 0)]
    let last = -Infinity
    for (let i = 0; i < 100; i++) {
      const v = maxRadialExtentYZFromSegments(segs)
      if (i > 0) expect(v).toBe(last)
      last = v
    }
    expect(last).toBeCloseTo(5, 9)
  })
})

// ===========================================================================
// (K) Multi-violation accumulation
// ===========================================================================

describe('[ID-0244] (K) multi-violation accumulation', () => {
  it('three axes simultaneously violated -> at least three violations', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', 0, 0, 5, 120, -5, -1)],
      box
    )
    expect(r.violations.length).toBeGreaterThanOrEqual(3)
    const axes = new Set(r.violations.map((v) => v.axis))
    expect(axes.has('x')).toBe(true)
    expect(axes.has('y')).toBe(true)
    expect(axes.has('z')).toBe(true)
  })

  it('all six (axis,kind) pairs can co-exist in a single check', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', -1, -1, -1, 200, 200, 200)],
      box
    )
    expect(r.violations.length).toBe(6)
  })

  it('order is deterministic across multiple invocations', () => {
    const segs = [seg('feed', -1, -1, -1, 200, 200, 200)]
    const a = compareToolpathToMachineEnvelope(segs, box).violations.map((v) => `${v.axis}:${v.kind}`)
    const b = compareToolpathToMachineEnvelope(segs, box).violations.map((v) => `${v.axis}:${v.kind}`)
    expect(a).toEqual(b)
  })

  it('only-Y violation -> exactly one violation (X and Z untouched)', () => {
    const r = compareToolpathToMachineEnvelope(
      [seg('feed', 5, 200, 5, 5, 200, 5)],
      box
    )
    expect(r.violations.length).toBe(1)
    expect(r.violations[0]!.axis).toBe('y')
    expect(r.violations[0]!.kind).toBe('above_max')
  })
})

// ===========================================================================
// (L) Hint-message regex contract -- pinned literal patterns
// ===========================================================================

describe('[ID-0244] (L) hint-message regex contract', () => {
  it('envelope hint matches the full canonical regex', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150 Y200 Z60', box)
    // ` Machine work volume warning: <list>. Confirm WCS vs profile workAreaMm — docs/MACHINES.md.`
    expect(h).toMatch(
      /^ Machine work volume warning: .+\. Confirm WCS vs profile workAreaMm — docs\/MACHINES\.md\.$/
    )
  })

  it('envelope hint per-violation suffix is "(~N.N mm outside)" exactly', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X105 Y10 Z5', box)
    // 5 mm overshoot -> "~5.0 mm outside"
    expect(h).toMatch(/\(~\d+\.\d mm outside\)/)
  })

  it('rotary hint matches the full canonical regex', () => {
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h).toMatch(
      /^ Rotary radial hint: YZ toolpath reach ~\d+\.\d mm vs nominal stock radius \d+\.\d mm \(Ø\d+\.\d\)\. Confirm stock diameter and WCS — docs\/MACHINES\.md\.$/
    )
  })

  it('axis labels in envelope hint are exactly the literal capital letters X/Y/Z', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X-5 Y-5 Z-5', box)
    // First "X below" then "Y below" then "Z below" in source order
    const order: string[] = []
    for (const ch of h) {
      if (ch === 'X' || ch === 'Y' || ch === 'Z') order.push(ch)
    }
    // The first 3 axis tokens should be X, Y, Z in that order
    expect(order.slice(0, 3)).toEqual(['X', 'Y', 'Z'])
  })

  it('rotary hint always starts with leading space (caller prepends to existing message)', () => {
    const h = formatRotaryRadialHintForPostedGcode('G1 X0 Y30 Z40', 80)
    expect(h[0]).toBe(' ')
  })

  it('envelope hint always starts with leading space (caller prepends to existing message)', () => {
    const h = formatMachineEnvelopeHintForPostedGcode('G1 X150', box)
    expect(h[0]).toBe(' ')
  })
})

// ===========================================================================
// (M) Cross-function consistency invariants
// ===========================================================================

describe('[ID-0244] (M) cross-function consistency', () => {
  it('formatMachineEnvelopeHintForPostedGcode returns "" iff compareToolpathToMachineEnvelope reports withinEnvelope=true', () => {
    const happy = `G0 X10 Y10 Z5\nG1 X20 Y20 Z5`
    const sad = `G0 X10 Y10 Z5\nG1 X150 Y10 Z5`
    expect(formatMachineEnvelopeHintForPostedGcode(happy, box)).toBe('')
    expect(formatMachineEnvelopeHintForPostedGcode(sad, box)).not.toBe('')
  })

  it('compareToolpathToMachineEnvelope.bounds matches computeToolpathBoundsFromSegments for the same input', () => {
    const segs = [seg('feed', 1, 2, 3, 4, 5, 6)]
    const direct = computeToolpathBoundsFromSegments(segs)
    const viaCheck = compareToolpathToMachineEnvelope(segs, box).bounds
    expect(viaCheck).toEqual(direct)
  })

  it('formatRotaryRadialHintForPostedGcode emits "" iff parsed maxRadialExtent <= R + 0.5', () => {
    // dia=80 -> R=40, slop boundary = 40.5
    const within = `G1 X0 Y24.3 Z32.4`  // ~40.5 reach
    const outside = `G1 X0 Y24.36 Z32.48` // ~40.6 reach
    expect(formatRotaryRadialHintForPostedGcode(within, 80)).toBe('')
    expect(formatRotaryRadialHintForPostedGcode(outside, 80)).not.toBe('')
  })

  it('empty-segment compareToolpathToMachineEnvelope and empty-gcode formatMachineEnvelopeHintForPostedGcode both report no violation', () => {
    expect(compareToolpathToMachineEnvelope([], box).withinEnvelope).toBe(true)
    expect(formatMachineEnvelopeHintForPostedGcode('', box)).toBe('')
  })
})
