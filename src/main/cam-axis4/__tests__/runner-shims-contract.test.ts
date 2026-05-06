/**
 * Paired-pin contract set for `src/main/cam-axis4/runner-shims.ts` — pins
 * both the doc-string contract and the runtime behavior of the two helpers
 * that bridge `cam-axis4/index.ts` and `cam-runner.ts`. Companion to the
 * cam-axis4 strategies paired-pin family (Cycles 49 / 58 / 66 / 69 / 73)
 * and to the per-machine post-template paired-pin family.
 *
 * Roadmap: [ID-0170] (test-coverage, Cycle 82). Cross-cuts:
 *   - Makera Carvera + 4th Axis Rotary -- the only 4-axis target in
 *     CLAUDE.md "USER CONTEXT -- TARGET MACHINES"; all 5 routed kinds
 *     are exercised here.
 *   - Laguna Swift 5x10 RichAuto A-series -- the [ID-0064] dust-collection
 *     M7/M9 strict-true gate is pinned here so the post template's
 *     commented-reminder default stays in play unless the operator
 *     explicitly opts in.
 *
 * Pure helper-level unit tests: NO post template, NO machine profile,
 * NO `renderPost` invocation, NO production-code edits this cycle.
 */
import { describe, expect, it } from 'vitest'
import {
  manufactureKindUses4AxisEngine,
  extractPostProcessingOpts
} from '../runner-shims'
import type { SubroutineDialect, LineNumberingConfig } from '../../post-process'

describe('manufactureKindUses4AxisEngine', () => {
  it('returns true for cnc_4axis_roughing (the canonical roughing kind)', () => {
    expect(manufactureKindUses4AxisEngine('cnc_4axis_roughing')).toBe(true)
  })

  it('returns true for cnc_4axis_finishing (the canonical finishing kind)', () => {
    expect(manufactureKindUses4AxisEngine('cnc_4axis_finishing')).toBe(true)
  })

  it('returns true for cnc_4axis_contour (the canonical contour kind)', () => {
    expect(manufactureKindUses4AxisEngine('cnc_4axis_contour')).toBe(true)
  })

  it('returns true for cnc_4axis_indexed (the canonical indexed kind)', () => {
    expect(manufactureKindUses4AxisEngine('cnc_4axis_indexed')).toBe(true)
  })

  it('returns true for cnc_4axis_continuous (the canonical continuous kind)', () => {
    expect(manufactureKindUses4AxisEngine('cnc_4axis_continuous')).toBe(true)
  })

  it('returns false for undefined (the dispatch-helper default)', () => {
    expect(manufactureKindUses4AxisEngine(undefined)).toBe(false)
  })

  it('returns false for the empty string (no kind selected)', () => {
    expect(manufactureKindUses4AxisEngine('')).toBe(false)
  })

  it('returns false for non-4-axis kinds and case/typo variants', () => {
    // 3-axis routes elsewhere -- must NOT light up the 4-axis engine.
    expect(manufactureKindUses4AxisEngine('cnc_3axis_roughing')).toBe(false)
    // FDM routes to the K2 Plus slicer pipeline -- must NOT light up here.
    expect(manufactureKindUses4AxisEngine('fdm_print')).toBe(false)
    // 5-axis simultaneous is out of scope per CLAUDE.md "USER CONTEXT".
    expect(manufactureKindUses4AxisEngine('cnc_5axis_simul')).toBe(false)
    // Strict case-sensitive matching: upper-case must NOT match.
    expect(manufactureKindUses4AxisEngine('CNC_4AXIS_ROUGHING')).toBe(false)
    // Plausible-looking unknown kinds in the cnc_4axis_* family must
    // ALSO be rejected -- the dispatcher should not silently coerce
    // a typo into a routed kind.
    expect(manufactureKindUses4AxisEngine('cnc_4axis_unknown')).toBe(false)
  })
})

describe('extractPostProcessingOpts -- defensive defaults', () => {
  it('returns the empty object when params is undefined (the dispatch default)', () => {
    expect(extractPostProcessingOpts(undefined)).toEqual({})
  })

  it('returns the empty object for an empty params record (and ignores bogus keys)', () => {
    expect(extractPostProcessingOpts({})).toEqual({})
    // Bogus keys not on the contract surface must be silently dropped --
    // the helper is a strict whitelist, not a passthrough.
    expect(
      extractPostProcessingOpts({
        notARealOption: 42,
        someUnrelatedFlag: true,
        randomString: 'hello'
      })
    ).toEqual({})
  })

  it('omits enableArcFitting when the flag is exactly false (strict-true gate)', () => {
    // The helper must NOT extract on `false` -- absence keeps the post
    // template's hard-coded default in play.
    expect(extractPostProcessingOpts({ enableArcFitting: false })).toEqual({})
    // Truthy-but-not-true values must ALSO be rejected.
    expect(extractPostProcessingOpts({ enableArcFitting: 1 })).toEqual({})
    expect(extractPostProcessingOpts({ enableArcFitting: 'true' })).toEqual({})
  })

  it('extracts enableArcFitting=true but omits arcTolerance when zero or negative', () => {
    // Tolerance must be a positive number to be carried through.
    expect(
      extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: 0 })
    ).toEqual({ enableArcFitting: true })
    expect(
      extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: -0.01 })
    ).toEqual({ enableArcFitting: true })
    // A positive tolerance IS carried through.
    expect(
      extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: 0.005 })
    ).toEqual({ enableArcFitting: true, arcTolerance: 0.005 })
    // Non-number tolerance values are dropped without disturbing
    // the enableArcFitting flag.
    expect(
      extractPostProcessingOpts({
        enableArcFitting: true,
        arcTolerance: 'tight'
      })
    ).toEqual({ enableArcFitting: true })
  })
})

describe('extractPostProcessingOpts -- per-feature pass-through', () => {
  it('honours cutter compensation left/right and gates the D-register on >= 1', () => {
    // 'left' is honoured; 'right' is honoured.
    expect(
      extractPostProcessingOpts({ cutterCompensation: 'left' })
    ).toEqual({ cutterCompensation: 'left' })
    expect(
      extractPostProcessingOpts({ cutterCompensation: 'right' })
    ).toEqual({ cutterCompensation: 'right' })
    // 'none' and bogus values are dropped (the post template's
    // G40-by-default keeps comp off in that case).
    expect(extractPostProcessingOpts({ cutterCompensation: 'none' })).toEqual(
      {}
    )
    expect(
      extractPostProcessingOpts({ cutterCompensation: 'middle' })
    ).toEqual({})
    // D-register requires the comp side to also be set (otherwise it's
    // a no-op anyway), and must be >= 1 -- a 0 or negative D-register
    // collides with G40 cancel and is dropped.
    expect(
      extractPostProcessingOpts({
        cutterCompensation: 'left',
        cutterCompDRegister: 0
      })
    ).toEqual({ cutterCompensation: 'left' })
    expect(
      extractPostProcessingOpts({
        cutterCompensation: 'right',
        cutterCompDRegister: 5
      })
    ).toEqual({ cutterCompensation: 'right', cutterCompDRegister: 5 })
    // D-register without any side is dropped silently.
    expect(
      extractPostProcessingOpts({ cutterCompDRegister: 5 })
    ).toEqual({})
  })

  it('extracts subroutines with fanuc/mach3/siemens dialects (and falls back to fanuc)', () => {
    // Default dialect when omitted is fanuc.
    expect(extractPostProcessingOpts({ enableSubroutines: true })).toEqual({
      enableSubroutines: true,
      subroutineDialect: 'fanuc' satisfies SubroutineDialect
    })
    // Explicit mach3 honoured (covers the Laguna Swift 5x10 superset).
    expect(
      extractPostProcessingOpts({
        enableSubroutines: true,
        subroutineDialect: 'mach3'
      })
    ).toEqual({
      enableSubroutines: true,
      subroutineDialect: 'mach3' satisfies SubroutineDialect
    })
    // Explicit siemens honoured.
    expect(
      extractPostProcessingOpts({
        enableSubroutines: true,
        subroutineDialect: 'siemens'
      })
    ).toEqual({
      enableSubroutines: true,
      subroutineDialect: 'siemens' satisfies SubroutineDialect
    })
    // Bogus dialect falls back to fanuc (the safest superset).
    expect(
      extractPostProcessingOpts({
        enableSubroutines: true,
        subroutineDialect: 'made-up-dialect'
      })
    ).toEqual({
      enableSubroutines: true,
      subroutineDialect: 'fanuc' satisfies SubroutineDialect
    })
    // Strict-true gate on enableSubroutines: false omits everything.
    expect(
      extractPostProcessingOpts({
        enableSubroutines: false,
        subroutineDialect: 'mach3'
      })
    ).toEqual({})
  })

  it('extracts line-numbering with start/increment defaults of 10/10', () => {
    // Strict-true gate on lineNumberingEnabled.
    expect(extractPostProcessingOpts({ lineNumberingEnabled: false })).toEqual(
      {}
    )
    // Defaults applied when start/increment omitted.
    const defaultsOnly = extractPostProcessingOpts({
      lineNumberingEnabled: true
    })
    const expectedDefault: { lineNumbering: LineNumberingConfig } = {
      lineNumbering: { enabled: true, start: 10, increment: 10 }
    }
    expect(defaultsOnly).toEqual(expectedDefault)
    // Explicit non-default start/increment carry through verbatim.
    expect(
      extractPostProcessingOpts({
        lineNumberingEnabled: true,
        lineNumberingStart: 100,
        lineNumberingIncrement: 5
      })
    ).toEqual({
      lineNumbering: {
        enabled: true,
        start: 100,
        increment: 5
      } satisfies LineNumberingConfig
    })
    // Non-number start/increment fall back to defaults.
    expect(
      extractPostProcessingOpts({
        lineNumberingEnabled: true,
        lineNumberingStart: 'one hundred',
        lineNumberingIncrement: null
      })
    ).toEqual({
      lineNumbering: {
        enabled: true,
        start: 10,
        increment: 10
      } satisfies LineNumberingConfig
    })
  })

  it('strict-true gate on inverseTimeFeed (rotary G93 mode)', () => {
    // The Carvera 4-axis post uses inverse-time feed when this flag is
    // set so simultaneous-axis moves are time-locked. The default is OFF
    // because most Carvera jobs are indexed-positioning, not simultaneous.
    expect(extractPostProcessingOpts({ inverseTimeFeed: true })).toEqual({
      inverseTimeFeed: true
    })
    expect(extractPostProcessingOpts({ inverseTimeFeed: false })).toEqual({})
    expect(extractPostProcessingOpts({ inverseTimeFeed: 1 })).toEqual({})
    expect(extractPostProcessingOpts({ inverseTimeFeed: 'true' })).toEqual({})
    expect(extractPostProcessingOpts({ inverseTimeFeed: undefined })).toEqual(
      {}
    )
  })

  it('[ID-0064] strict-true gate on dustCollection (Laguna Swift 5x10 RichAuto A-series)', () => {
    // This is the Laguna Swift safety pin: M7 (dust ON) and M9 (dust
    // OFF) only emit when the operator explicitly opts in via the
    // per-job UI checkbox. Anything else (false / undefined / coerced
    // truthy) leaves the post template's commented-reminder default
    // (`; M7 -- enable dust collection (operator)`) in play.
    expect(extractPostProcessingOpts({ dustCollection: true })).toEqual({
      dustCollection: true
    })
    // The five non-true variants must NOT enable dust-collection emission.
    expect(extractPostProcessingOpts({ dustCollection: false })).toEqual({})
    expect(extractPostProcessingOpts({ dustCollection: undefined })).toEqual(
      {}
    )
    expect(extractPostProcessingOpts({ dustCollection: 1 })).toEqual({})
    expect(extractPostProcessingOpts({ dustCollection: 'true' })).toEqual({})
    expect(extractPostProcessingOpts({ dustCollection: null })).toEqual({})
    // And dustCollection composes with the other flags without
    // perturbing them -- combined per-feature pass-through is the
    // realistic shape of a multi-flag opts payload.
    expect(
      extractPostProcessingOpts({
        enableArcFitting: true,
        arcTolerance: 0.01,
        dustCollection: true,
        cutterCompensation: 'left'
      })
    ).toEqual({
      enableArcFitting: true,
      arcTolerance: 0.01,
      dustCollection: true,
      cutterCompensation: 'left'
    })
  })
})
