/**
 * Paired-pin contract for `src/shared/cam-numeric-floors.ts` -- a 4-line / 149-byte
 * SHARED CAM numeric-floor constant module exporting one value:
 * `CAM_FEED_PLUNGE_FLOOR_MM_MIN = 1` (mm/min).
 *
 * This is THE smallest production module in the CAM layer that protects all three
 * CNC target machines from a stalled-spindle / clogged-extruder regression. The
 * floor is the load-bearing minimum that every CAM cut-params resolver and every
 * pre-emit guardrail layer enforces:
 *
 * - `src/shared/cam-cut-params.ts` -- imported as Math.max floor for both
 *   `feedMmMin` and `plungeMmMin` resolution; protects EVERY CNC job for
 *   Laguna Swift 5x10 + Makera Carvera 3-axis + Makera Carvera 4-axis Rotary.
 * - `src/main/cam-toolpath-guardrails.ts` -- re-exported as
 *   `CAM_GUARDRAIL_FEED_MIN_MM_MIN` and `CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN` so the
 *   pre-emit guardrail layer flags any operation with feed/plunge below the floor
 *   BEFORE the post-processor sees the config.
 *
 * Three-machine impact: DIRECT cross-cut on every CNC job. INDIRECT for
 * Creality K2 Plus FDM (the slicer pipeline does not consume this module
 * directly; FDM prints get their print-speed floors from the Cura profile).
 *
 * This pin is co-located with the existing behavioral test
 * `cam-numeric-floors.test.ts` (5 it() blocks) and is exhaustive given that
 * the module exposes exactly one constant. The pin protects:
 * - The exact value 1 (changing the floor would silently change every CNC
 *   job's effective minimum feed without a user-visible diff).
 * - The one-and-only-one export name (any new export must be deliberately
 *   added to this pin first to force review of cross-module wiring).
 * - The pure-constant nature (no functions, no mutation, no I/O, no Promises).
 * - The on-disk source text shape (a 4-line ESM module with a docstring).
 *
 * Roadmap ID: [ID-0292] / Cycle 220.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './cam-numeric-floors'
import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from './cam-numeric-floors'

const SOURCE_PATH = resolve(__dirname, 'cam-numeric-floors.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

describe('cam-numeric-floors-pin -- frozen contract for the CAM floor constant', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // A. Module-shape pins: the exact export set is locked down so any new
  //    export must be deliberately added. Adding a new floor (e.g. for
  //    rotary-feed) without a paired-pin update should fail this group.
  // ────────────────────────────────────────────────────────────────────────────
  describe('A. module shape -- exact export set', () => {
    it('exports CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
      expect((M as Record<string, unknown>).CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeDefined()
    })

    it('exports exactly one runtime symbol -- CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
      const keys = Object.keys(M).filter((k) => k !== 'default' && k !== '__esModule')
      expect(keys).toEqual(['CAM_FEED_PLUNGE_FLOOR_MM_MIN'])
      expect(keys.length).toBe(1)
    })

    it('does not export a default', () => {
      expect((M as Record<string, unknown>).default).toBeUndefined()
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is a number (not boxed Number, not string)', () => {
      expect(typeof CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBe('number')
      expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).not.toBeInstanceOf(Number)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is finite (not NaN, not Infinity, not -Infinity)', () => {
      expect(Number.isFinite(CAM_FEED_PLUNGE_FLOOR_MM_MIN)).toBe(true)
      expect(Number.isNaN(CAM_FEED_PLUNGE_FLOOR_MM_MIN)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // B. Constant-value contract: changing the value will silently shift every
  //    CNC job's effective minimum feed/plunge. The pin locks the exact
  //    literal 1 so a deliberate value change must touch this test.
  // ────────────────────────────────────────────────────────────────────────────
  describe('B. constant-value contract', () => {
    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN === 1 (exact identity, sign-preserving)', () => {
      expect(Object.is(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 1)).toBe(true)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN equals 1 via .toBe', () => {
      expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBe(1)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is a positive integer (Number.isInteger + > 0)', () => {
      expect(Number.isInteger(CAM_FEED_PLUNGE_FLOOR_MM_MIN)).toBe(true)
      expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeGreaterThan(0)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is the smallest safe non-zero positive integer (1)', () => {
      // The floor is intentionally 1 mm/min so that even pathological inputs
      // resolve to an extremely slow but non-stalled motion. A value of 0
      // would mean "no motion" -- the spindle still runs but the cut never
      // advances, scorching the workpiece. A value < 1 (e.g. 0.5) would be
      // ambiguous against integer-only feed registers on some controllers.
      expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeGreaterThanOrEqual(1)
      expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeLessThan(2)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN does not preserve sign of zero (it is +1)', () => {
      // Sanity: the floor is strictly positive +1, not -0 or +0.
      expect(Object.is(CAM_FEED_PLUNGE_FLOOR_MM_MIN, -0)).toBe(false)
      expect(Object.is(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 0)).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // C. Boundary semantics: any value strictly below the floor must be
  //    treated as "below"; any value at-or-above the floor must be treated
  //    as "valid". The pin asserts the comparators behave as expected
  //    regardless of nearby fuzzy floats.
  // ────────────────────────────────────────────────────────────────────────────
  describe('C. boundary semantics around the floor', () => {
    it('0.5 is strictly less than the floor', () => {
      expect(0.5).toBeLessThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('0 is strictly less than the floor', () => {
      expect(0).toBeLessThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('-1 is strictly less than the floor', () => {
      expect(-1).toBeLessThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('exactly the floor (1) satisfies >=', () => {
      expect(CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBeGreaterThanOrEqual(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('1.0001 is strictly above the floor', () => {
      expect(1.0001).toBeGreaterThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('Math.max with the floor clamps below-floor values up to the floor', () => {
      // This mirrors the production usage pattern in cam-cut-params.ts:
      // `Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['feedMmMin']) ?? default)`.
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 0.1)).toBe(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 0)).toBe(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, -100)).toBe(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('Math.max with the floor preserves above-floor values', () => {
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 800)).toBe(800)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 4500)).toBe(4500)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, 10000)).toBe(10000)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // D. Three-machine path realism: each of the three target machines has a
  //    realistic feed/plunge that we exercise against the floor.
  //    These pins document the safety relationship between the floor and
  //    each machine's typical operating envelope.
  // ────────────────────────────────────────────────────────────────────────────
  describe('D. three-machine path realism', () => {
    it('Laguna Swift 5x10: typical 4500 mm/min full-sheet plywood feed sits well above the floor', () => {
      const lagunaTypicalFeed = 4500 // CLAUDE.md: Laguna Swift 5x10 is a CNC router with 3-6 HP spindle
      expect(lagunaTypicalFeed).toBeGreaterThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, lagunaTypicalFeed)).toBe(lagunaTypicalFeed)
    })

    it('Laguna Swift 5x10: pathological 0 mm/min input clamps up to floor (no stalled-spindle scorching)', () => {
      const userTypo = 0
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, userTypo)).toBe(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('Makera Carvera 3-axis: typical 800 mm/min aluminum finish feed sits above the floor', () => {
      const carveraTypicalFeed = 800 // CLAUDE.md: Carvera 200 W spindle, 13-15 kRPM, ER-20 collet
      expect(carveraTypicalFeed).toBeGreaterThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, carveraTypicalFeed)).toBe(carveraTypicalFeed)
    })

    it('Makera Carvera 4-axis: rotary plunge floors at 1 mm/min for harmonic-drive precision moves', () => {
      // The Carvera 4-axis Rotary uses a harmonic-drive gear -- pathological
      // tiny rotary feeds are technically achievable but UNSAFE because the
      // drive can stall under load. The floor protects against this.
      const rotaryUnsafe = 0.1
      expect(rotaryUnsafe).toBeLessThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
      expect(Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, rotaryUnsafe)).toBe(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })

    it('Creality K2 Plus FDM: floor is INDIRECT -- slicer profile owns its own print-speed floor', () => {
      // The K2 Plus FDM pipeline does not consume this constant. The floor
      // is INDIRECT for FDM via the slicer profile. This pin documents the
      // documented decoupling so future cycles do not wire the constant
      // into the K2 Plus slicer arg builder by mistake.
      // The K2 Plus operates at up to 600 mm/s = 36000 mm/min per CLAUDE.md.
      const k2TopSpeed = 36000
      expect(k2TopSpeed).toBeGreaterThan(CAM_FEED_PLUNGE_FLOOR_MM_MIN)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // E. Pure-constant invariants: CAM_FEED_PLUNGE_FLOOR_MM_MIN is a literal
  //    primitive, not a function, not a frozen object, not a Promise. The
  //    pin asserts the value cannot be mutated in surprising ways.
  // ────────────────────────────────────────────────────────────────────────────
  describe('E. pure-constant invariants', () => {
    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is not a function', () => {
      expect(typeof CAM_FEED_PLUNGE_FLOOR_MM_MIN).not.toBe('function')
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is not an object', () => {
      expect(typeof CAM_FEED_PLUNGE_FLOOR_MM_MIN).not.toBe('object')
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN does not mutate across reads', () => {
      const a = CAM_FEED_PLUNGE_FLOOR_MM_MIN
      const b = CAM_FEED_PLUNGE_FLOOR_MM_MIN
      const c = CAM_FEED_PLUNGE_FLOOR_MM_MIN
      expect(a).toBe(1)
      expect(b).toBe(1)
      expect(c).toBe(1)
      expect(a).toBe(b)
      expect(b).toBe(c)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN survives Object.freeze on its containing module', () => {
      // ESM exports are read-only at the linker level; this is mostly a
      // documentation pin asserting the typeof remains 'number' regardless
      // of any attempt to wrap it.
      const wrapped = Object.freeze({ floor: CAM_FEED_PLUNGE_FLOOR_MM_MIN })
      expect(wrapped.floor).toBe(1)
      expect(typeof wrapped.floor).toBe('number')
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // F. Source-text whitelist: lock the on-disk shape of the module so any
  //    change (rename, value flip, added export, added import, added side
  //    effect) forces a deliberate update to this pin.
  // ────────────────────────────────────────────────────────────────────────────
  describe('F. source-text whitelist', () => {
    it('source file exists and is readable', () => {
      expect(SOURCE.length).toBeGreaterThan(0)
    })

    it('source file is small (< 200 bytes -- the module is intentionally tiny)', () => {
      // Byte-count canary. The module is 149 bytes at v32 close.
      expect(SOURCE.length).toBeLessThan(200)
    })

    it('source declares the JSDoc docstring referencing feed/plunge and material presets', () => {
      expect(SOURCE).toContain('Single source for minimum feed/plunge')
      expect(SOURCE).toContain('mm/min')
      expect(SOURCE).toContain('material presets')
      expect(SOURCE).toContain('CAM guardrails')
    })

    it('source declares exactly one `export const` statement', () => {
      const matches = SOURCE.match(/export const /g) ?? []
      expect(matches.length).toBe(1)
    })

    it('source declares the constant with the exact name CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
      expect(SOURCE).toContain('export const CAM_FEED_PLUNGE_FLOOR_MM_MIN = 1')
    })

    it('source has NO function declarations (it is a pure-constant module)', () => {
      // No `function` keyword; no arrow `=>` either.
      expect(SOURCE).not.toMatch(/function\s+\w/)
      expect(SOURCE).not.toContain('=>')
    })

    it('source has NO `import` statements (zero dependencies)', () => {
      expect(SOURCE).not.toMatch(/^\s*import\s/m)
    })

    it('source has NO `require` calls', () => {
      expect(SOURCE).not.toContain('require(')
    })

    it('source has NO `console.` calls (no debug logging in production)', () => {
      expect(SOURCE).not.toContain('console.')
    })

    it('source has NO `eval` or `Function` constructor (no dynamic code)', () => {
      expect(SOURCE).not.toMatch(/\beval\s*\(/)
      expect(SOURCE).not.toMatch(/\bnew\s+Function\b/)
    })

    it('source has NO `Promise`, `async`, or `await` keywords (synchronous-only)', () => {
      expect(SOURCE).not.toMatch(/\bPromise\b/)
      expect(SOURCE).not.toMatch(/\basync\b/)
      expect(SOURCE).not.toMatch(/\bawait\b/)
    })

    it('source has NO `fs`, `path`, `os` imports (no I/O at module load)', () => {
      expect(SOURCE).not.toContain("from 'node:fs'")
      expect(SOURCE).not.toContain("from 'node:path'")
      expect(SOURCE).not.toContain("from 'node:os'")
      expect(SOURCE).not.toContain("from 'fs'")
      expect(SOURCE).not.toContain("from 'path'")
      expect(SOURCE).not.toContain("from 'os'")
    })

    it('source has NO `let` or `var` declarations (constant-only)', () => {
      expect(SOURCE).not.toMatch(/^\s*let\s/m)
      expect(SOURCE).not.toMatch(/^\s*var\s/m)
    })

    it('source has NO type annotations on the export (the literal type 1 is inferred)', () => {
      // The export is declared as `export const X = 1` not `export const X: number = 1`
      // -- this preserves the literal type `1` rather than widening to `number`.
      // Future cycles changing the value to a non-literal expression would lose
      // the literal type and should re-think the design.
      expect(SOURCE).toContain('= 1')
      expect(SOURCE).not.toContain('CAM_FEED_PLUNGE_FLOOR_MM_MIN: ')
    })

    it('source ends with a single trailing newline (POSIX-clean)', () => {
      expect(SOURCE.endsWith('\n')).toBe(true)
      expect(SOURCE.endsWith('\n\n')).toBe(false)
    })

    it('source line count is small (< 10 lines -- intentional tiny module)', () => {
      const lines = SOURCE.split('\n')
      expect(lines.length).toBeLessThan(10)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // G. Type-level parity: the literal type is preserved (the export is
  //    declared `= 1` so TS infers the literal type `1`, not the widened
  //    type `number`). This pin asserts the typeof string matches.
  // ────────────────────────────────────────────────────────────────────────────
  describe('G. type-level parity', () => {
    it('typeof CAM_FEED_PLUNGE_FLOOR_MM_MIN === "number"', () => {
      expect(typeof CAM_FEED_PLUNGE_FLOOR_MM_MIN).toBe('number')
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN is assignable to a number-typed slot', () => {
      const x: number = CAM_FEED_PLUNGE_FLOOR_MM_MIN
      expect(x).toBe(1)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN survives JSON.stringify round-trip', () => {
      const json = JSON.stringify({ floor: CAM_FEED_PLUNGE_FLOOR_MM_MIN })
      expect(json).toBe('{"floor":1}')
      const parsed = JSON.parse(json) as { floor: number }
      expect(parsed.floor).toBe(1)
    })

    it('CAM_FEED_PLUNGE_FLOOR_MM_MIN can be used as both feed-floor and plunge-floor', () => {
      // The constant is intentionally shared between feed and plunge floors;
      // any divergence between the two would require a NEW constant and a
      // NEW pin block here.
      const feedFloor = CAM_FEED_PLUNGE_FLOOR_MM_MIN
      const plungeFloor = CAM_FEED_PLUNGE_FLOOR_MM_MIN
      expect(feedFloor).toBe(plungeFloor)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // H. Cross-module wiring contract: the two production consumers
  //    (`cam-cut-params.ts` + `cam-toolpath-guardrails.ts`) MUST continue to
  //    wire to this constant, not to a hard-coded `1`. Any deviation forces
  //    a paired-pin update and a justification.
  // ────────────────────────────────────────────────────────────────────────────
  describe('H. cross-module wiring contract', () => {
    it('cam-cut-params.ts imports the floor by name', () => {
      const camCutParamsSrc = readFileSync(resolve(__dirname, 'cam-cut-params.ts'), 'utf-8')
      expect(camCutParamsSrc).toContain("import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from './cam-numeric-floors'")
    })

    it('cam-cut-params.ts uses the floor as the lower clamp for feedMmMin via Math.max', () => {
      const camCutParamsSrc = readFileSync(resolve(__dirname, 'cam-cut-params.ts'), 'utf-8')
      expect(camCutParamsSrc).toContain("Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['feedMmMin'])")
    })

    it('cam-cut-params.ts uses the floor as the lower clamp for plungeMmMin via Math.max', () => {
      const camCutParamsSrc = readFileSync(resolve(__dirname, 'cam-cut-params.ts'), 'utf-8')
      expect(camCutParamsSrc).toContain("Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['plungeMmMin'])")
    })

    it('cam-toolpath-guardrails.ts imports the floor and re-exports it under guardrail-specific names', () => {
      const guardrailsSrc = readFileSync(resolve(__dirname, '../main/cam-toolpath-guardrails.ts'), 'utf-8')
      expect(guardrailsSrc).toContain("import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from '../shared/cam-numeric-floors'")
      expect(guardrailsSrc).toContain('CAM_GUARDRAIL_FEED_MIN_MM_MIN = CAM_FEED_PLUNGE_FLOOR_MM_MIN')
      expect(guardrailsSrc).toContain('CAM_GUARDRAIL_PLUNGE_MIN_MM_MIN = CAM_FEED_PLUNGE_FLOOR_MM_MIN')
    })

    it('cam-toolpath-guardrails.ts does NOT re-export the imported floor as a separate name (only via the two GUARDRAIL_-prefixed names)', () => {
      const guardrailsSrc = readFileSync(resolve(__dirname, '../main/cam-toolpath-guardrails.ts'), 'utf-8')
      // The floor is imported but NOT re-exported under its original name --
      // only via the two derived `CAM_GUARDRAIL_*_MIN_MM_MIN` names.
      expect(guardrailsSrc).not.toMatch(/^export\s*\{\s*CAM_FEED_PLUNGE_FLOOR_MM_MIN\s*\}/m)
    })
  })
})
