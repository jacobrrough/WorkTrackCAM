/**
 * gcode-export-safety-pin.test.ts -- [ID-0242] Cycle 170 ui-polish paired-pin
 *
 * Co-located paired-pin contract for `src/renderer/src/gcode-export-safety.ts`
 * (1 exported pure function
 * `assessGcodeForExportSafety` + 1 type-only export
 * `GcodeExportSafetyAssessment`; Wave 3l added a module-private
 * machine-envelope helper -- the runtime export inventory is unchanged). The helper is the renderer-side
 * pre-flight gate the export / send / Moonraker-upload buttons in
 * `ShopApp.tsx` (3 production call-sites at lines 1186, 1294, 1340)
 * consult BEFORE the user is allowed to ship a posted G-code file
 * downstream. Returning a non-empty `blockingErrors` array is what
 * disables the button; non-empty `warnings` only surfaces a yellow
 * banner.
 *
 * Per CLAUDE.md "USER CONTEXT -- TARGET MACHINES" this helper is
 * cross-cutting across the THREE target machines:
 *   - Creality K2 Plus (FDM, Klipper/Moonraker): the gate guards the
 *     Moonraker direct-push upload path. Klipper-flavored slicer
 *     output rarely uses M5 (no spindle) but DOES emit M104 S0 / M84
 *     end-of-print sequences -- regressions here would either block
 *     legitimate FDM uploads or wave through malformed CNC posts.
 *   - Laguna Swift 5x10 (RichAuto A-series): every full-sheet
 *     plywood / aluminum job posts via the GRBL/Mach3 dialect path;
 *     the `G0 Z<safeRetractZMm>` invariant prevents shipping a
 *     program that would re-engage the cutter at the wrong Z height
 *     after the last operation -- a known crash class.
 *   - Makera Carvera + 4th Axis: 3-axis ATC and 4-axis rotary jobs
 *     post via Smoothieware; the M5 spindle-stop check is the
 *     LAST-LINE pre-flight before ATC tool-list parking.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain, newest-first):
 *   - 169 [ID-0241]/[ID-0067-data-v24] EDIT-WORKFLOW.md docs refresh
 *   - 168 [ID-0240] gcode-header-invariants
 *   - 167 [ID-0239] cam-scallop-stepover
 *   - 166 [ID-0238] kernel-placement-parity
 *   - 165 [ID-0237] path-join
 *   - 164 [ID-0236] EDIT-WORKFLOW.md docs refresh
 *   - 163 [ID-0235] machine-post-template-hints
 *   - 162 [ID-0234] cam-progress
 *   - 161 [ID-0233] shellLayoutStorage
 *   - 160 [ID-0223] cam-runtime-telemetry
 *   - 159 [ID-0232] laguna-vacuum-postlude
 *   - 158 [ID-0231]/[ID-0067-data-v22] EDIT-WORKFLOW.md docs refresh
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact runtime export inventory: 1 function,
 *       0 non-function runtime exports. The type-only
 *       `GcodeExportSafetyAssessment` MUST NOT appear at runtime.
 *   (B) Function signature -- `assessGcodeForExportSafety` is a
 *       NATIVE function (not arrow / not bound), arity 1, name
 *       "assessGcodeForExportSafety", returns a plain object.
 *   (C) Return shape -- exactly 2 enumerable keys
 *       (`blockingErrors`, `warnings`); both are fresh `Array`
 *       instances; no extra keys leak through.
 *   (D) Dialect-compliance integration -- compliance issues with
 *       level 'error' flow into `blockingErrors`, level 'warning'
 *       into `warnings`. Each compliance issue is formatted EXACTLY
 *       as `[CODE] message`.
 *   (E) Spindle-stop invariant -- gcode that lacks `M5` (whole-word)
 *       MUST emit `'Missing spindle stop (M5).'` as a blocking error.
 *       Includes word-boundary verification (e.g. `M50` does NOT
 *       count as M5).
 *   (F) Program-end invariant -- gcode that lacks BOTH `M2` and
 *       `M30` (whole-word) MUST emit `'Missing program end (M2/M30).'`
 *       as a blocking error. Either M2 OR M30 is sufficient. M3 / M30
 *       boundary checks pinned.
 *   (G) G90 absolute-mode invariant -- gcode that lacks `G90` MUST
 *       emit a warning with EXACT text. Word-boundary respected.
 *   (H) Units invariant -- gcode that lacks BOTH `G20` and `G21`
 *       MUST emit a warning. Either G20 OR G21 is sufficient.
 *   (I) Safe-retract invariant -- the regex
 *       `\bG0\s+Z<N>(?:\.0+)?\b` is dynamically built from
 *       `safeRetractZMm`. Forms accepted: `G0 Z100`, `G0 Z100.0`,
 *       `G0 Z100.000`. Word-boundary excludes a longer prefix
 *       (e.g. retract=10 must not match `G0 Z100`).
 *   (J) Three-machine path realism -- pinned full-program fixtures
 *       for K2 Plus, Laguna Swift 5x10, and Carvera 4-axis.
 *   (K) Pure-function invariants -- idempotent N=20, no mutation
 *       on input string, no this-binding leakage, fresh array per
 *       call, plain-object return prototype.
 *   (L) Edge cases -- empty string, whitespace-only, comment-only,
 *       very long programs, mixed line endings.
 *   (N) Wave 3l INTENDED DRIFT -- machine work-area hard gate: OPTIONAL
 *       `workAreaMm` on the options object turns provable X/Y
 *       over-travel into BLOCKING errors (axis + overshoot named).
 *       Absent dims = byte-identical legacy behavior (never a false
 *       block). Z stays advisory-only. See the (N) section banner for
 *       the full drift rationale.
 */

import { describe, expect, it } from 'vitest'
import * as mod from './gcode-export-safety'
import { assessGcodeForExportSafety } from './gcode-export-safety'
import type { GcodeExportSafetyAssessment } from './gcode-export-safety'
import type { MachineProfile } from '../../shared/machine-schema'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal happy-path GRBL program that satisfies every invariant. */
const HAPPY_GRBL_GCODE = [
  '; happy path',
  'G21',
  'G90',
  'G17',
  'M3 S12000',
  'G0 X0 Y0 Z10',
  'G1 X10 Y10 Z-1 F500',
  'M5',
  'M9',
  'G0 Z100',
  'M30'
].join('\n')

const ALL_DIALECTS: Array<MachineProfile['dialect']> = [
  'grbl',
  'mach3',
  'generic_mm',
  'grbl_4axis',
  'fanuc_4axis',
  'mach3_4axis',
  'linuxcnc_4axis',
  'siemens_4axis',
  'heidenhain_4axis',
  'fanuc',
  'siemens',
  'heidenhain',
  'smoothieware'
]

// ===========================================================================
// (A) Module shape
// ===========================================================================

describe('[ID-0242] (A) module shape -- runtime export inventory', () => {
  it('exposes assessGcodeForExportSafety as a function (the only runtime export)', () => {
    expect(typeof mod.assessGcodeForExportSafety).toBe('function')
  })

  it('does NOT leak GcodeExportSafetyAssessment at runtime (type-only export)', () => {
    expect((mod as unknown as Record<string, unknown>).GcodeExportSafetyAssessment).toBeUndefined()
  })

  it('runtime exports: exactly 1 function-typed key, 0 non-function-typed keys', () => {
    const keys = Object.keys(mod)
    const fnKeys = keys.filter((k) => typeof (mod as Record<string, unknown>)[k] === 'function')
    const nonFnKeys = keys.filter((k) => typeof (mod as Record<string, unknown>)[k] !== 'function')
    expect(fnKeys).toEqual(['assessGcodeForExportSafety'])
    expect(nonFnKeys).toEqual([])
  })

  it('the runtime keys are stable -- no accidental side-export drift', () => {
    expect(Object.keys(mod).sort()).toEqual(['assessGcodeForExportSafety'])
  })
})

// ===========================================================================
// (B) Function signature
// ===========================================================================

describe('[ID-0242] (B) function signature pin', () => {
  it('name is exactly "assessGcodeForExportSafety"', () => {
    expect(assessGcodeForExportSafety.name).toBe('assessGcodeForExportSafety')
  })

  it('arity is 1 (single options object parameter)', () => {
    expect(assessGcodeForExportSafety.length).toBe(1)
  })

  it('toString includes the "function" keyword (NOT an arrow)', () => {
    const src = assessGcodeForExportSafety.toString()
    expect(src.startsWith('function')).toBe(true)
  })

  it('is not a bound function (Function.prototype.bind would prefix the name with "bound ")', () => {
    expect(assessGcodeForExportSafety.name.startsWith('bound ')).toBe(false)
  })

  it('returns an object with exactly 2 own enumerable keys: blockingErrors + warnings', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(Object.keys(r).sort()).toEqual(['blockingErrors', 'warnings'])
  })

  it('return prototype is plain Object.prototype (not a class instance)', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
  })
})

// ===========================================================================
// (C) Return shape -- arrays, not generators / iterables
// ===========================================================================

describe('[ID-0242] (C) return shape -- both fields are real Arrays', () => {
  it('blockingErrors is an Array (Array.isArray === true)', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(Array.isArray(r.blockingErrors)).toBe(true)
  })

  it('warnings is an Array (Array.isArray === true)', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(Array.isArray(r.warnings)).toBe(true)
  })

  it('every blockingErrors entry is a string (no nested objects leak through)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G91 G28 Z0', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    for (const e of r.blockingErrors) {
      expect(typeof e).toBe('string')
    }
  })

  it('every warnings entry is a string (no nested objects leak through)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['M3', 'G1 X1 F100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    for (const w of r.warnings) {
      expect(typeof w).toBe('string')
    }
  })

  it('happy-path GRBL fixture produces zero blocking errors', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toEqual([])
  })
})

// ===========================================================================
// (D)/(E) Dialect-compliance integration -- format + level partition
// ===========================================================================

describe('[ID-0242] (D) dialect-compliance integration', () => {
  it('GRBL_NO_G28 (error level) flows into blockingErrors with [CODE] prefix', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G91 G28 Z0', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors.some((e) => e.startsWith('[GRBL_NO_G28]'))).toBe(true)
  })

  it('issue formatting is EXACTLY `[CODE] message` (single space, no padding)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G91 G28 Z0', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const grblG28 = r.blockingErrors.find((e) => e.startsWith('[GRBL_NO_G28]'))
    expect(grblG28).toBeDefined()
    // EXACT prefix: opening bracket immediately, closing bracket
    // immediately followed by a single space.
    expect(grblG28!.startsWith('[GRBL_NO_G28] ')).toBe(true)
    // No double-space directly after the prefix.
    expect(grblG28!.startsWith('[GRBL_NO_G28]  ')).toBe(false)
  })

  it('warning-level dialect issues do NOT appear in blockingErrors', () => {
    // GRBL_LINE_LENGTH is warning-level; long line shouldn't block.
    const longLine = 'G1 X' + '1'.repeat(300) + ' F500'
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', longLine, 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors.some((e) => e.startsWith('[GRBL_LINE_LENGTH]'))).toBe(false)
  })

  it('warning-level dialect issues DO appear in warnings with [CODE] prefix', () => {
    const longLine = 'G1 X' + '1'.repeat(300) + ' F500'
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', longLine, 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.startsWith('[GRBL_LINE_LENGTH]'))).toBe(true)
  })

  it('error-level dialect issues do NOT appear in warnings (level partition)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G91 G28 Z0', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.startsWith('[GRBL_NO_G28]'))).toBe(false)
  })

  it('Siemens dialect: SIEMENS_NO_G28 error flows into blockingErrors', () => {
    // Siemens dialect-compliance flags G91 G28 as SIEMENS_NO_G28
    // (mirror of the GRBL guard).
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G91 G28', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'siemens',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors.some((e) => e.startsWith('[SIEMENS_NO_G28]'))).toBe(true)
  })

  it('Smoothieware dialect: parses without throwing on Carvera-style ATC G-code', () => {
    const carvera = [
      '; carvera 4-axis ATC',
      'G21',
      'G90',
      'G17',
      'G54',
      'M6 T1',
      'G43 H1',
      'M3 S15000',
      'G0 X0 Y0 Z5 A0',
      'G1 X10 A45 F800',
      'G49',
      'M5',
      'G0 Z90',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: carvera,
      dialect: 'smoothieware',
      safeRetractZMm: 90
    })
    // Smoothieware accepts G43/G49 (TLC) -- must NOT raise GRBL_NO_TLC.
    expect(r.warnings.some((w) => w.startsWith('[GRBL_NO_TLC]'))).toBe(false)
  })

  it('all dialects accept the happy-path fixture without throwing', () => {
    for (const d of ALL_DIALECTS) {
      expect(() =>
        assessGcodeForExportSafety({
          gcode: HAPPY_GRBL_GCODE,
          dialect: d,
          safeRetractZMm: 100
        })
      ).not.toThrow()
    }
  })
})

// ===========================================================================
// (E) Spindle-stop invariant
// ===========================================================================

describe('[ID-0242] (E) spindle-stop M5 invariant', () => {
  it('missing M5 -> blockingError with EXACT message "Missing spindle stop (M5)."', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
  })

  it('present M5 -> NO "Missing spindle stop (M5)." in blockingErrors', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).not.toContain('Missing spindle stop (M5).')
  })

  it('M5 must be a WHOLE word -- "M50" alone does NOT satisfy the check', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M50', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
  })

  it('M5 must be a WHOLE word -- "M51" alone does NOT satisfy the check', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M51', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
  })

  it('M5 followed by a comment/end-of-line satisfies the check', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M5 ; spindle off', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).not.toContain('Missing spindle stop (M5).')
  })

  it('M5 anywhere in the line satisfies the check (not just first column)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z5 M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).not.toContain('Missing spindle stop (M5).')
  })
})

// ===========================================================================
// (F) Program-end invariant
// ===========================================================================

describe('[ID-0242] (F) program-end M2/M30 invariant', () => {
  it('missing both M2 and M30 -> blockingError with EXACT text', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100', 'M5'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
  })

  it('M2 alone is sufficient (does NOT need M30 too)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100', 'M2'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).not.toContain('Missing program end (M2/M30).')
  })

  it('M30 alone is sufficient', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).not.toContain('Missing program end (M2/M30).')
  })

  it('M3 (spindle on) does NOT satisfy program-end (word boundary)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
  })

  it('M20 / M21 / M22 / M29 do NOT satisfy program-end (word boundary)', () => {
    for (const m of ['M20', 'M21', 'M22', 'M29']) {
      const r = assessGcodeForExportSafety({
        gcode: ['G21', 'G90', 'M3', m, 'M5'].join('\n'),
        dialect: 'grbl',
        safeRetractZMm: 100
      })
      expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
    }
  })

  it('M200 / M300 do NOT satisfy program-end (word boundary on right side)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M200', 'M300', 'M5'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
  })
})

// ===========================================================================
// (G) G90 absolute-mode invariant -- warning-level
// ===========================================================================

describe('[ID-0242] (G) G90 absolute-mode warning', () => {
  const G90_WARN = 'Absolute distance mode (G90) is not present in the posted file.'

  it('missing G90 -> warning with EXACT text', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain(G90_WARN)
  })

  it('present G90 -> NO G90 warning', () => {
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).not.toContain(G90_WARN)
  })

  it('G900 / G901 do NOT satisfy G90 (word boundary)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'M3', 'G900', 'G901', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain(G90_WARN)
  })

  it('G90 inside a comment still satisfies the check (regex sees it)', () => {
    // ASSUMPTION: regex is run against raw gcode text, not a
    // comment-stripped form (verified from impl: `/\bG90\b/.test(input.gcode)`).
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'M3', '; using G90 mode', 'G1 X1 F100', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).not.toContain(G90_WARN)
  })
})

// ===========================================================================
// (H) Units G20/G21 invariant
// ===========================================================================

describe('[ID-0242] (H) units G20/G21 warning', () => {
  const UNITS_WARN = 'Units mode (G20/G21) is not explicitly set.'

  it('missing both G20 and G21 -> warning', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G90', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain(UNITS_WARN)
  })

  it('G20 alone is sufficient (inch mode)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G20', 'G90', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).not.toContain(UNITS_WARN)
  })

  it('G21 alone is sufficient (mm mode)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100', 'M5', 'G0 Z100', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).not.toContain(UNITS_WARN)
  })

  it('G200 / G210 do NOT satisfy units (word boundary)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G200', 'G210', 'G90', 'M3', 'G1 X1 F100', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain(UNITS_WARN)
  })

  it('both G20 and G21 present (rare but legal) -> NO units warning', () => {
    // E.g. G20 in inline preamble comment + G21 in actual code.
    const r = assessGcodeForExportSafety({
      gcode: ['; G20 example header', 'G21', 'G90', 'M3', 'G1 X1', 'M5', 'M30', 'G0 Z100'].join(
        '\n'
      ),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).not.toContain(UNITS_WARN)
  })
})

// ===========================================================================
// (I) Safe-retract invariant
// ===========================================================================

describe('[ID-0242] (I) safe-retract invariant', () => {
  it('exact integer match: G0 Z100 satisfies safeRetractZMm=100', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })

  it('decimal-zero suffix: G0 Z100.0 satisfies safeRetractZMm=100', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z100.0', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })

  it('multi-zero suffix: G0 Z100.000 satisfies safeRetractZMm=100', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z100.000', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })

  it('missing G0 Z<retract> -> warning with the EXACT formatted retract value', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z50', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z100) not found.')
  })

  it('warning includes the user-supplied retract value verbatim (e.g. 90)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z50', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 90
    })
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z90) not found.')
  })

  it('retract numeric is NOT formatted -- decimals are passed through', () => {
    // ASSUMPTION: the helper trusts the caller's value; the regex
    // body uses `${input.safeRetractZMm}` which is JS .toString().
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z50', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 99.5
    })
    expect(r.warnings.some((w) => w.includes('G0 Z99.5'))).toBe(true)
  })

  it('LARGER retract value: G0 Z100 does NOT satisfy safeRetractZMm=10 (word boundary)', () => {
    // Word-boundary protects against a 100-vs-10 substring fluke.
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 10
    })
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z10) not found.')
  })

  it('SHORTER retract value: G0 Z10 alone satisfies safeRetractZMm=10', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z10', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 10
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })

  it('multi-space between G0 and Z is allowed (matches \\s+)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0    Z100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })

  it('tab between G0 and Z is allowed (matches \\s+)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0\tZ100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })

  it('missing space between G0 and Z (G0Z100) does NOT match (\\s+ requires ≥1)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0Z100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    // No safe retract is detected because regex demands whitespace.
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z100) not found.')
  })

  it('G0 anywhere in the program (not last line) is sufficient', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'G0 Z100', 'M3', 'G1 X1 F100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings.some((w) => w.includes('Safe retract'))).toBe(false)
  })
})

// ===========================================================================
// (J) Three-machine path realism
// ===========================================================================

describe('[ID-0242] (J) three-machine path realism', () => {
  it('Creality K2 Plus FDM passthrough: M5/G90 absent on slicer output is captured', () => {
    // K2 Plus Klipper-flavored slicer output -- no M5 (no spindle).
    // The export-safety helper still runs the CNC checks because
    // its caller in ShopApp.tsx does not yet branch on machine.kind;
    // this pin documents the current end-to-end behavior so a future
    // FDM short-circuit refactor surfaces here.
    const k2 = [
      ';FLAVOR:Marlin',
      ';TIME:1234',
      ';Filament used: 1.5m',
      'G21',
      'G90',
      'M82',
      'G28',
      'G1 Z0.2 F600',
      'G1 X10 Y10 E5 F1500',
      'M104 S0',
      'M140 S0',
      'M84'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: k2,
      dialect: 'grbl', // ShopApp routes K2 export through the same gate today
      safeRetractZMm: 350
    })
    // Documented behavior: missing M5 + missing M2/M30 + missing
    // safe-retract-to-Z350 -- ALL surfaced today.
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z350) not found.')
  })

  it('Laguna Swift 5x10 happy path: G21 + G90 + M5 + M30 + G0 Z100 -> zero blockers', () => {
    const laguna = [
      '; LAGUNA SWIFT 5x10 -- vacuum-zone-aware full-sheet pocket',
      'G21',
      'G90',
      'G17',
      'G54',
      '(VAC ZONE 1 ON)',
      'M3 S18000',
      'G0 X10 Y10 Z5',
      'G1 Z-3 F600',
      'G1 X100 Y100 F2000',
      'G0 Z25',
      'M5',
      '(VAC ZONE 1 OFF)',
      'G0 Z100',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: laguna,
      dialect: 'mach3',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toEqual([])
  })

  it('Laguna Swift 5x10: missing dust-collection postlude does NOT block (out-of-scope here)', () => {
    // Dust-collection M-codes are NOT part of the export-safety
    // pre-flight; they belong to the post-template render step.
    const laguna = [
      'G21',
      'G90',
      'G17',
      'M3 S18000',
      'G1 X10 Y10 Z-3 F600',
      'M5',
      'G0 Z100',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: laguna,
      dialect: 'mach3',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toEqual([])
  })

  it('Carvera 4-axis happy path with rotary A-word + G43/G49: zero blockers', () => {
    const carvera = [
      '; MAKERA CARVERA 4-AXIS ROTARY',
      'G21',
      'G90',
      'G17',
      'G54',
      'M6 T1',
      'G43 H1',
      'M3 S15000',
      'G0 X0 Y0 Z5 A0',
      'G1 X10 A45 F800',
      'G49',
      'M5',
      'G0 Z90',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: carvera,
      dialect: 'smoothieware',
      safeRetractZMm: 90
    })
    expect(r.blockingErrors).toEqual([])
  })

  it('Carvera 3-axis ATC: M5 missing because tool-park sequence forgotten -> blocked', () => {
    const carvera = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M6 T1',
      'G43 H1',
      'M3 S15000',
      'G0 X0 Y0 Z5',
      'G1 X10 F800',
      'G49',
      'G0 Z90',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: carvera,
      dialect: 'smoothieware',
      safeRetractZMm: 90
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
  })

  it('Carvera 4-axis: G49 (TLC cancel) does NOT trigger spurious GRBL_NO_TLC because dialect is smoothieware', () => {
    const carvera = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M6 T1',
      'G43 H1',
      'M3 S15000',
      'G0 X0 Y0 Z5 A0',
      'G1 X10 A45 F800',
      'G49',
      'M5',
      'G0 Z90',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: carvera,
      dialect: 'smoothieware',
      safeRetractZMm: 90
    })
    expect(r.warnings.some((w) => w.startsWith('[GRBL_NO_TLC]'))).toBe(false)
  })
})

// ===========================================================================
// (K) Pure-function invariants
// ===========================================================================

describe('[ID-0242] (K) pure-function invariants', () => {
  it('idempotent: 20 sequential calls return EQUAL (deep) results', () => {
    const args = {
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl' as const,
      safeRetractZMm: 100
    }
    const first = assessGcodeForExportSafety(args)
    for (let i = 0; i < 20; i++) {
      const next = assessGcodeForExportSafety(args)
      expect(next).toEqual(first)
    }
  })

  it('idempotent: each call produces a FRESH `blockingErrors` array (no aliasing)', () => {
    const args = {
      gcode: ['G91 G28 Z0', 'M30'].join('\n'),
      dialect: 'grbl' as const,
      safeRetractZMm: 100
    }
    const a = assessGcodeForExportSafety(args)
    const b = assessGcodeForExportSafety(args)
    expect(a.blockingErrors).not.toBe(b.blockingErrors)
  })

  it('idempotent: each call produces a FRESH `warnings` array (no aliasing)', () => {
    const args = {
      gcode: ['G21', 'M3', 'G1 X1 F100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl' as const,
      safeRetractZMm: 100
    }
    const a = assessGcodeForExportSafety(args)
    const b = assessGcodeForExportSafety(args)
    expect(a.warnings).not.toBe(b.warnings)
  })

  it('does not mutate the input gcode string (strings are immutable, but pin guards a future "normalize-and-pass" rewrite)', () => {
    const before = HAPPY_GRBL_GCODE
    const beforeLen = before.length
    assessGcodeForExportSafety({
      gcode: before,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(before).toBe(HAPPY_GRBL_GCODE)
    expect(before.length).toBe(beforeLen)
  })

  it('does not mutate the input options object', () => {
    const args = {
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl' as const,
      safeRetractZMm: 100
    }
    const argsCopy = { ...args }
    assessGcodeForExportSafety(args)
    expect(args).toEqual(argsCopy)
  })

  it('no this-binding leakage: calling via .call(otherThis) yields the same result', () => {
    const a = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const b = (assessGcodeForExportSafety as Function).call(
      { sneakyThis: 'should be ignored' },
      {
        gcode: HAPPY_GRBL_GCODE,
        dialect: 'grbl',
        safeRetractZMm: 100
      }
    ) as GcodeExportSafetyAssessment
    expect(b).toEqual(a)
  })

  it('no this-binding leakage: calling via .apply(otherThis) yields the same result', () => {
    const a = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const b = (assessGcodeForExportSafety as Function).apply({ sneakyThis: 'ignored' }, [
      {
        gcode: HAPPY_GRBL_GCODE,
        dialect: 'grbl',
        safeRetractZMm: 100
      }
    ]) as GcodeExportSafetyAssessment
    expect(b).toEqual(a)
  })

  it('does not throw on any happy-path dialect/retract combo', () => {
    for (const d of ALL_DIALECTS) {
      for (const ret of [10, 50, 90, 100, 200, 350]) {
        expect(() =>
          assessGcodeForExportSafety({
            gcode: HAPPY_GRBL_GCODE,
            dialect: d,
            safeRetractZMm: ret
          })
        ).not.toThrow()
      }
    }
  })

  it('blockingErrors is a fresh Array.prototype-backed array (not a sub-class)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G91 G28 Z0', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(Object.getPrototypeOf(r.blockingErrors)).toBe(Array.prototype)
  })

  it('warnings is a fresh Array.prototype-backed array (not a sub-class)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'M3', 'G1 X1 F100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(Object.getPrototypeOf(r.warnings)).toBe(Array.prototype)
  })
})

// ===========================================================================
// (L) Edge cases -- empty / whitespace / mixed line endings
// ===========================================================================

describe('[ID-0242] (L) edge cases', () => {
  it('empty string input -> all blocking checks fire (no M5, no M2/M30)', () => {
    const r = assessGcodeForExportSafety({
      gcode: '',
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
  })

  it('empty string input -> warnings include G90 + G20/G21 + safe-retract', () => {
    const r = assessGcodeForExportSafety({
      gcode: '',
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain('Absolute distance mode (G90) is not present in the posted file.')
    expect(r.warnings).toContain('Units mode (G20/G21) is not explicitly set.')
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z100) not found.')
  })

  it('whitespace-only input -> same blockers as empty string', () => {
    const r = assessGcodeForExportSafety({
      gcode: '   \n\t  \n',
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
  })

  it('comment-only input -> all blockers fire (regex sees raw text but no M5/M30)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['; comment 1', '(comment 2)', '; M5 in comment does count via regex'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    // `\bM5\b` test ignores comment delimiter, so the M5 text in the
    // comment ALSO satisfies the M5 check.  This is a documented
    // current-behavior quirk: the comment-strip is NOT applied here.
    expect(r.blockingErrors).not.toContain('Missing spindle stop (M5).')
  })

  it('CRLF line endings work the same as LF', () => {
    const lf = HAPPY_GRBL_GCODE
    const crlf = lf.replace(/\n/g, '\r\n')
    const a = assessGcodeForExportSafety({
      gcode: lf,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const b = assessGcodeForExportSafety({
      gcode: crlf,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(b.blockingErrors).toEqual(a.blockingErrors)
  })

  it('very long program (10k lines) does not throw or hang', () => {
    const lines = ['G21', 'G90', 'M3']
    for (let i = 0; i < 10000; i++) {
      lines.push(`G1 X${i} Y${i} F500`)
    }
    lines.push('M5', 'G0 Z100', 'M30')
    const big = lines.join('\n')
    const r = assessGcodeForExportSafety({
      gcode: big,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toEqual([])
  })

  it('program with only the bare minimum to pass: G21 G90 M3 ... M5 ... G0 Z100 M30', () => {
    const minimal = ['G21', 'G90', 'M3', 'G1 X1 F500', 'M5', 'G0 Z100', 'M30'].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: minimal,
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toEqual([])
  })

  it('safeRetractZMm = 0 (degenerate) -> regex looks for "G0 Z0" literal', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z0', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 0
    })
    expect(r.warnings).not.toContain('Safe retract to machine max Z (G0 Z0) not found.')
  })

  it('order is stable across runs: blockingErrors[0] is the first compliance error if any', () => {
    // Compliance errors come from validateDialectCompliance and are
    // pushed FIRST; the M5/M30 blockers come AFTER. So if a dialect
    // error exists, it occupies index 0.
    const r = assessGcodeForExportSafety({
      gcode: ['G91 G28 Z0', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    if (r.blockingErrors.length > 0) {
      expect(r.blockingErrors[0].startsWith('[GRBL_NO_G28]')).toBe(true)
    }
  })

  it('order is stable across runs: M5 missing comes BEFORE M2/M30 missing', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1 F100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const m5Idx = r.blockingErrors.indexOf('Missing spindle stop (M5).')
    const m30Idx = r.blockingErrors.indexOf('Missing program end (M2/M30).')
    expect(m5Idx).toBeGreaterThanOrEqual(0)
    expect(m30Idx).toBeGreaterThan(m5Idx)
  })

  it('order is stable across runs: G90 warning comes BEFORE units warning', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['M3', 'G1 X1 F100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const g90Idx = r.warnings.indexOf(
      'Absolute distance mode (G90) is not present in the posted file.'
    )
    const unitsIdx = r.warnings.indexOf('Units mode (G20/G21) is not explicitly set.')
    expect(g90Idx).toBeGreaterThanOrEqual(0)
    expect(unitsIdx).toBeGreaterThan(g90Idx)
  })

  it('order is stable across runs: units warning comes BEFORE safe-retract warning', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['M3', 'G1 X1 F100', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    const unitsIdx = r.warnings.indexOf('Units mode (G20/G21) is not explicitly set.')
    const retractIdx = r.warnings.indexOf('Safe retract to machine max Z (G0 Z100) not found.')
    expect(unitsIdx).toBeGreaterThanOrEqual(0)
    expect(retractIdx).toBeGreaterThan(unitsIdx)
  })
})

// ===========================================================================
// (M) Regex-contract surface -- pin the EXACT regex shapes
// ===========================================================================

describe('[ID-0242] (M) regex-contract surface', () => {
  it('M5 regex is /\\bM5\\b/ -- does NOT consume "M5." with a digit suffix', () => {
    // Force a case where the only "M5" is "M50" (digit suffix breaks
    // word boundary on the right side).
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M50', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing spindle stop (M5).')
  })

  it('program-end regex is /\\bM(?:2|30)\\b/ -- M3 alone does NOT satisfy', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M5'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.blockingErrors).toContain('Missing program end (M2/M30).')
  })

  it('program-end regex: M30 matches even when surrounded by other tokens on the line', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'M5', '(end of program) M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100,
    })
    expect(r.blockingErrors).not.toContain('Missing program end (M2/M30).')
  })

  it('G90 regex is /\\bG90\\b/ -- does NOT match G900 / G901', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'M3', 'G900', 'M5', 'M30', 'G0 Z100'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain('Absolute distance mode (G90) is not present in the posted file.')
  })

  it('safe-retract regex tolerates trailing zeros (/\\.0+)?\\b/) but NOT non-zero decimals on a longer literal', () => {
    // safeRetractZMm = 100 expects to match Z100, Z100.0, Z100.000.
    // It must NOT match Z1000 (longer integer).
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G0 Z1000', 'M5', 'M30'].join('\n'),
      dialect: 'grbl',
      safeRetractZMm: 100
    })
    expect(r.warnings).toContain('Safe retract to machine max Z (G0 Z100) not found.')
  })
})

// ===========================================================================
// (N) Wave 3l INTENDED DRIFT -- machine work-area hard gate
// ===========================================================================
//
// INTENDED DRIFT (Wave 3l): `assessGcodeForExportSafety` ADDITIVELY accepts
// the machine profile's `workAreaMm` on its single options object. Arity
// stays 1, the runtime export inventory stays exactly
// ['assessGcodeForExportSafety'], and the return shape stays
// { blockingErrors, warnings } -- sections (A)-(C) above keep pinning all of
// that unchanged. What changed: when `workAreaMm` IS provided, posted X/Y
// extents that PROVABLY exceed the machine travel append BLOCKING errors
// naming the axis + overshoot (parsed with the same shared helpers as the
// in-app advisory hint -- extractToolpathSegmentsFromGcode +
// computeToolpathBoundsFromSegments). When absent, behavior is
// byte-identical to the pre-Wave-3l contract (pinned by N4 deep equality),
// so dims-less callers can never be false-blocked. The gate is provability-
// conservative: Z is advisory-only (cut depths are WCS-relative), a program
// that never declares G90 is not hard-gated (the parser assumes absolute
// coordinates), and a below-origin extent only blocks when the total span
// exceeds the axis travel (no work-origin shift could fit it).

describe('[ID-0242] (N) Wave 3l -- machine work-area hard gate', () => {
  /** Real bundled profile dims (resources/machines/*.json). */
  const LAGUNA = { x: 1524, y: 3048, z: 203 }
  const CARVERA = { x: 360, y: 240, z: 140 }
  const K2_PLUS = { x: 350, y: 350, z: 350 }

  function programWithMoves(moves: string[]): string {
    return ['G21', 'G90', 'G17', 'M3 S18000', ...moves, 'M5', 'G0 Z100', 'M30'].join('\n')
  }

  it('N1: Laguna Y overshoot blocks with axis + exact overshoot text', () => {
    const r = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X100 Y3100 Z-3 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    const msg = r.blockingErrors.find((e) => e.includes('machine Y work area'))
    expect(msg).toBeDefined()
    expect(msg).toContain('Y3100.0 mm')
    expect(msg).toContain('3048 mm')
    expect(msg).toContain('52.0 mm past the limit')
  })

  it('N2: Laguna X overshoot blocks (1600 on a 1524 mm axis = 76.0 mm over)', () => {
    const r = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X1600 Y100 Z-3 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    expect(
      r.blockingErrors.some(
        (e) => e.includes('machine X work area') && e.includes('76.0 mm past the limit')
      )
    ).toBe(true)
  })

  it('N3: a full-sheet Laguna program inside 1524x3048 passes with zero blockers', () => {
    const r = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X1500 Y3000 Z-3 F2000', 'G1 X10 Y10 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    expect(r.blockingErrors).toEqual([])
  })

  it('N4: ABSENT workAreaMm is byte-identical legacy behavior (deep-equal result)', () => {
    const gcode = programWithMoves(['G1 X9000 Y9000 Z-3 F2000'])
    const withoutDims = assessGcodeForExportSafety({
      gcode,
      dialect: 'mach3',
      safeRetractZMm: 100
    })
    // Even 9 meters off the bed cannot block without machine dims.
    expect(withoutDims.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
    // And for an in-bed program the entire result is identical with dims.
    const inBed = programWithMoves(['G1 X100 Y100 Z-3 F2000'])
    const a = assessGcodeForExportSafety({ gcode: inBed, dialect: 'mach3', safeRetractZMm: 100 })
    const b = assessGcodeForExportSafety({
      gcode: inBed,
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    expect(b).toEqual(a)
  })

  it('N5: below-origin extents block ONLY when the total span is unfittable', () => {
    // Span -100..1500 = 1600 mm on a 1524 mm axis: no origin shift fits it.
    const over = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X-100 Y100 Z-3 F2000', 'G1 X1500 Y100 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    const msg = over.blockingErrors.find((e) => e.includes('machine X work area'))
    expect(msg).toBeDefined()
    expect(msg).toContain('No work-origin shift can make this fit')
    expect(msg).toContain('76.0 mm more than the axis can move')
    // Span -100..1300 = 1400 mm fits with a shifted origin: advisory
    // territory, NEVER a hard block.
    const fits = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X-100 Y100 Z-3 F2000', 'G1 X1300 Y100 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    expect(fits.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
  })

  it('N6: Z is advisory-only -- deep cuts and tall retracts never trip the hard gate', () => {
    const r = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X100 Y100 Z-50 F600', 'G0 Z300']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA // z: 203 -- both Z-50 and Z300 are outside [0, 203]
    })
    expect(r.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
  })

  it('N7: a program that never declares G90 is not hard-gated (parser assumes absolute)', () => {
    const noG90 = ['G21', 'G17', 'M3 S18000', 'G1 X2000 Y100 Z-3 F2000', 'M5', 'M30'].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: noG90,
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    expect(r.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
    // The existing G90 warning still surfaces the gap.
    expect(r.warnings).toContain('Absolute distance mode (G90) is not present in the posted file.')
  })

  it('N8: non-positive / non-finite work-area dims are skipped per-axis (never a false block)', () => {
    const gcode = programWithMoves(['G1 X1600 Y3100 Z-3 F2000'])
    const zeroX = assessGcodeForExportSafety({
      gcode,
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: { x: 0, y: Number.NaN, z: 203 }
    })
    expect(zeroX.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
  })

  it('N9: both axes over -> two messages, X before Y', () => {
    const r = assessGcodeForExportSafety({
      gcode: programWithMoves(['G1 X1600 Y3100 Z-3 F2000']),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    const xIdx = r.blockingErrors.findIndex((e) => e.includes('machine X work area'))
    const yIdx = r.blockingErrors.findIndex((e) => e.includes('machine Y work area'))
    expect(xIdx).toBeGreaterThanOrEqual(0)
    expect(yIdx).toBeGreaterThan(xIdx)
  })

  it('N10: envelope blockers are APPENDED after the M5/M30 blockers (stable order)', () => {
    const r = assessGcodeForExportSafety({
      gcode: ['G21', 'G90', 'M3', 'G1 X1600 Y100 Z-3 F2000'].join('\n'),
      dialect: 'mach3',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    const m30Idx = r.blockingErrors.indexOf('Missing program end (M2/M30).')
    const envIdx = r.blockingErrors.findIndex((e) => e.includes('machine X work area'))
    expect(m30Idx).toBeGreaterThanOrEqual(0)
    expect(envIdx).toBeGreaterThan(m30Idx)
  })

  it('N11: K2 Plus 350-cube realism -- in-volume Klipper-flavored output is not envelope-blocked', () => {
    const k2 = [
      ';FLAVOR:Marlin',
      'G21',
      'G90',
      'M82',
      'G28',
      'G1 Z0.2 F600',
      'G1 X340 Y340 E5 F1500',
      'M104 S0',
      'M84'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: k2,
      dialect: 'grbl',
      safeRetractZMm: 350,
      workAreaMm: K2_PLUS
    })
    expect(r.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
  })

  it('N12: Carvera realism -- X400 on the 360 mm bed is blocked with the overshoot named', () => {
    const carvera = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S15000',
      'G1 X400 Y100 Z-1 F800',
      'M5',
      'G0 Z90',
      'M30'
    ].join('\n')
    const r = assessGcodeForExportSafety({
      gcode: carvera,
      dialect: 'smoothieware',
      safeRetractZMm: 90,
      workAreaMm: CARVERA
    })
    expect(
      r.blockingErrors.some(
        (e) => e.includes('machine X work area') && e.includes('40.0 mm past the limit')
      )
    ).toBe(true)
  })

  it('N13: contract surfaces unchanged -- arity 1, sole runtime export, 2-key return', () => {
    expect(assessGcodeForExportSafety.length).toBe(1)
    expect(Object.keys(mod).sort()).toEqual(['assessGcodeForExportSafety'])
    const r = assessGcodeForExportSafety({
      gcode: HAPPY_GRBL_GCODE,
      dialect: 'grbl',
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    })
    expect(Object.keys(r).sort()).toEqual(['blockingErrors', 'warnings'])
  })

  it('N14: empty / motion-less programs with dims produce no envelope blockers', () => {
    for (const gcode of ['', '   \n\t  \n', ['G21', 'G90', 'M3', 'M5', 'M30'].join('\n')]) {
      const r = assessGcodeForExportSafety({
        gcode,
        dialect: 'grbl',
        safeRetractZMm: 100,
        workAreaMm: LAGUNA
      })
      expect(r.blockingErrors.some((e) => e.includes('work area'))).toBe(false)
    }
  })

  it('N15: the hard gate is idempotent and allocation-fresh like the rest of the contract', () => {
    const args = {
      gcode: programWithMoves(['G1 X1600 Y100 Z-3 F2000']),
      dialect: 'mach3' as const,
      safeRetractZMm: 100,
      workAreaMm: LAGUNA
    }
    const a = assessGcodeForExportSafety(args)
    const b = assessGcodeForExportSafety(args)
    expect(b).toEqual(a)
    expect(b.blockingErrors).not.toBe(a.blockingErrors)
  })
})
