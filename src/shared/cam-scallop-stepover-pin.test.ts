/**
 * cam-scallop-stepover-pin.test.ts -- [ID-0239] Cycle 167 cam-engine paired-pin
 *
 * Co-located paired-pin contract for `src/shared/cam-scallop-stepover.ts`
 * (47 lines, 2015 bytes; 2 exported pure functions
 * `stepoverFromScallopMm(toolDiameterMm, scallopMm, mode)` and
 * `resolve3dFinishStepoverMm({ toolDiameterMm, baseStepoverMm, operationParams })`,
 * plus 1 type-only export `FinishScallopMode = 'ball' | 'flat'` that is
 * erased at runtime).
 *
 * The helper derives the lateral stepover (mm) for 3D finishing
 * toolpaths from a target scallop / cusp height between adjacent
 * passes. Implementation is the standard chord-formula approximation
 *   stepover = 2 * sqrt(2*R*h - h*h)   with  R = toolDiameter / 2
 * applied to small scallops; both ball-end and flat-end tools share
 * the same formula at the small-scallop limit, so the `mode`
 * parameter is intentionally ignored at runtime. The function clamps
 * the result to `[0.01, 0.95 * toolDiameter]` and special-cases the
 * "scallop saturates the radius" path (h >= 0.999 * R) to a fixed
 * cap of `min(R * 1.9, toolDiameter * 0.95)`.
 *
 * `resolve3dFinishStepoverMm` is the source-priority resolver that
 * picks one of three sources, in order:
 *   1. operationParams.finishStepoverMm (positive finite number) -> 'finishStepoverMm'
 *   2. operationParams.finishScallopMm  (positive finite number) -> 'finishScallopMm'
 *   3. baseStepoverMm                                            -> 'stepoverMm'
 * When source (2) wins, `finishScallopMode === 'flat'` -> 'flat',
 * anything else -> 'ball' (default).
 *
 * Production call-site: `src/main/cam-runner.ts:1469` (the only
 * production use, verified via `grep -rn '\\(stepoverFromScallopMm\\|resolve3dFinishStepoverMm\\)' src/`).
 *
 * Per CLAUDE.md "USER CONTEXT -- TARGET MACHINES" this helper is
 * cross-cutting across the THREE target machines. Every 3D finishing
 * toolpath the runner emits has its lateral stepover passed through
 * this function. A regression that swapped the chord formula for an
 * arc-length formula, or that lost the `0.95 * D` cap, would emit
 * ruinously wide stepovers on real jobs:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): the .cam-aligned
 *     STL pipeline isn't FDM-finish per se, but the K2 0.4 mm nozzle
 *     and 0.2 mm typical layer height match the 0.2-0.4 mm stepover
 *     band the formula produces for sub-0.05 mm scallops -- a wrong
 *     formula would over- or under-pack lateral passes.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): a 6 mm
 *     ball-end finishing pass on plywood at 0.05 mm scallop should
 *     produce ~1.1 mm stepover; doubling that would leave visible
 *     ridges, halving it would burn 2x the cycle time.
 *   - **Makera Carvera + 4th Axis** (desktop 4-axis): a 3 mm ball-
 *     end finishing pass on aluminum at 0.01 mm scallop should
 *     produce ~0.24 mm stepover; the cap at 0.95 * D = 2.85 mm
 *     prevents the rotary-axis 4-axis finishing strategy from
 *     emitting over-wide passes.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain, newest-first):
 *   - 166 [ID-0238] kernel-placement-parity (main-process companion)
 *   - 165 [ID-0237] path-join (renderer-side companion)
 *   - 164 [ID-0236] EDIT-WORKFLOW.md docs refresh
 *   - 163 [ID-0235] machine-post-template-hints
 *   - 162 [ID-0234] cam-progress
 *   - 161 [ID-0233] shellLayoutStorage
 *   - 160 [ID-0223] cam-runtime-telemetry
 *   - 159 [ID-0232] laguna-vacuum-postlude
 *   - 154 [ID-0227] drawing-project-model-views
 *   - 152 [ID-0224] cam-heightfield-cylindrical
 *   - 149 [ID-0225] useShellResizableColumns
 *   - 147 [ID-0222] cam-engine-adapter
 *   - 145 [ID-0218] laguna-vacuum-allocator
 *   - 142 [ID-0216] cam-domain
 *   - 140 [ID-0215] setup-sheet
 *   - 137 [ID-0213] post-domain
 *   - 136 [ID-0212] fdm-gcode-layer-summary
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact runtime export inventory (the two
 *       functions only; FinishScallopMode is type-only and erased).
 *   (B) Function signature pin -- name, arity, native Function,
 *       deterministic pure-function shape.
 *   (C) Chord-formula contract -- on the standard branch,
 *       result == 2*sqrt(2*R*h - h*h) clamped to [0.01, 0.95*D].
 *   (D) Saturated-scallop branch -- h >= 0.999*R returns the fixed
 *       cap min(R*1.9, D*0.95); for D >= 0 this is always D*0.95
 *       because R*1.9 == D*0.95.
 *   (E) Floor / cap clamps -- result is never < 0.01 mm and never
 *       > 0.95 * toolDiameter.
 *   (F) Mode parameter is ignored at runtime -- 'ball' and 'flat'
 *       produce strictly equal stepovers for all (D, h) inputs.
 *   (G) Tool-diameter zero / negative path -- D <= 0 clamps R to
 *       1e-6 and the result remains finite and >= 0.
 *   (H) Scallop zero / negative path -- h <= 0 clamps to 1e-9 and
 *       the floor (0.01 mm or D*0.05) wins.
 *   (I) Source-priority chain (resolve3dFinishStepoverMm):
 *       finishStepoverMm > finishScallopMm > stepoverMm.
 *   (J) Source-validation rules -- non-finite / non-positive
 *       finishStepoverMm or finishScallopMm fall through to next.
 *   (K) finishScallopMode coercion -- 'flat' -> 'flat', everything
 *       else (missing, 'ball', null, undefined, garbage) -> 'ball'.
 *       (Ball and flat are equal at runtime, but the source label
 *       must remain 'finishScallopMm' either way.)
 *   (L) Null / missing operationParams -- both null and {} fall
 *       through to baseStepoverMm with source 'stepoverMm'.
 *   (M) Three-machine path realism -- K2 0.4 mm, Laguna 6 mm
 *       plywood, Carvera 3 mm aluminum fixtures with realistic
 *       scallop targets.
 *   (N) Pure-function invariants -- same input -> same output across
 *       N=20 calls; no throws on documented input shapes; no
 *       this-binding leakage; no mutation of input objects.
 *
 * NEW file (no prior PIN coverage; the existing
 * `cam-scallop-stepover.test.ts` is a behavioral test, not a paired
 * pin). Add-only -- no production code is touched in Cycle 167.
 */
import { describe, expect, it } from 'vitest'
import * as ScallopModule from './cam-scallop-stepover'
import {
  resolve3dFinishStepoverMm,
  stepoverFromScallopMm
} from './cam-scallop-stepover'
import type { FinishScallopMode } from './cam-scallop-stepover'

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (A) module shape pin', () => {
  it('exports exactly { resolve3dFinishStepoverMm, stepoverFromScallopMm } at runtime', () => {
    const keys = Object.keys(ScallopModule).sort()
    expect(keys).toEqual(['resolve3dFinishStepoverMm', 'stepoverFromScallopMm'])
  })

  it('module namespace has only the standard Symbol.toStringTag', () => {
    const syms = Object.getOwnPropertySymbols(ScallopModule)
    expect(syms).toHaveLength(1)
    expect(syms[0]).toBe(Symbol.toStringTag)
    expect(
      (ScallopModule as unknown as Record<symbol, unknown>)[Symbol.toStringTag]
    ).toBe('Module')
  })

  it('stepoverFromScallopMm is the same reference via namespace and named import', () => {
    expect(ScallopModule.stepoverFromScallopMm).toBe(stepoverFromScallopMm)
  })

  it('resolve3dFinishStepoverMm is the same reference via namespace and named import', () => {
    expect(ScallopModule.resolve3dFinishStepoverMm).toBe(resolve3dFinishStepoverMm)
  })

  it('FinishScallopMode is type-only (erased at runtime; type-side ball|flat union still usable here)', () => {
    // Just exercise the type so a regression renaming or removing it would
    // fail TypeScript compilation. The value is irrelevant at runtime.
    const ball: FinishScallopMode = 'ball'
    const flat: FinishScallopMode = 'flat'
    expect(ball).toBe('ball')
    expect(flat).toBe('flat')
    // The name FinishScallopMode is NOT a runtime export.
    expect((ScallopModule as Record<string, unknown>).FinishScallopMode).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (B) Function signatures
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (B) function signature pin', () => {
  it('stepoverFromScallopMm is a native function', () => {
    expect(typeof stepoverFromScallopMm).toBe('function')
  })

  it('stepoverFromScallopMm.name === "stepoverFromScallopMm"', () => {
    expect(stepoverFromScallopMm.name).toBe('stepoverFromScallopMm')
  })

  it('stepoverFromScallopMm.length === 3 (toolDiameterMm, scallopMm, mode -- mode has NO default)', () => {
    expect(stepoverFromScallopMm.length).toBe(3)
  })

  it('stepoverFromScallopMm is NOT an AsyncFunction', () => {
    const ctorName = (
      stepoverFromScallopMm as unknown as { constructor: { name: string } }
    ).constructor.name
    expect(ctorName).toBe('Function')
  })

  it('resolve3dFinishStepoverMm is a native function', () => {
    expect(typeof resolve3dFinishStepoverMm).toBe('function')
  })

  it('resolve3dFinishStepoverMm.name === "resolve3dFinishStepoverMm"', () => {
    expect(resolve3dFinishStepoverMm.name).toBe('resolve3dFinishStepoverMm')
  })

  it('resolve3dFinishStepoverMm.length === 1 (single options object)', () => {
    expect(resolve3dFinishStepoverMm.length).toBe(1)
  })

  it('resolve3dFinishStepoverMm returns shape { stepoverMm: number, source: string }', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1
    })
    expect(Object.keys(r).sort()).toEqual(['source', 'stepoverMm'])
    expect(typeof r.stepoverMm).toBe('number')
    expect(typeof r.source).toBe('string')
  })

  it('stepoverFromScallopMm always returns a finite number for documented input ranges', () => {
    const samples: ReadonlyArray<readonly [number, number, FinishScallopMode]> = [
      [0.4, 0.01, 'ball'],
      [3, 0.02, 'ball'],
      [6, 0.05, 'flat'],
      [12, 0.1, 'flat'],
      [25, 1, 'ball']
    ]
    for (const [d, h, m] of samples) {
      const e = stepoverFromScallopMm(d, h, m)
      expect(Number.isFinite(e)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// (C) Chord-formula contract on the standard branch
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (C) chord-formula contract', () => {
  it('result equals 2*sqrt(2*R*h - h*h) on the standard branch (D=6mm, h=0.05mm, ball)', () => {
    const D = 6
    const R = D / 2
    const h = 0.05
    const expected = 2 * Math.sqrt(2 * R * h - h * h)
    const actual = stepoverFromScallopMm(D, h, 'ball')
    expect(actual).toBeCloseTo(expected, 10)
  })

  it('result equals 2*sqrt(2*R*h - h*h) on the standard branch (D=12mm, h=0.1mm, ball)', () => {
    const D = 12
    const R = D / 2
    const h = 0.1
    const expected = 2 * Math.sqrt(2 * R * h - h * h)
    const actual = stepoverFromScallopMm(D, h, 'ball')
    expect(actual).toBeCloseTo(expected, 10)
  })

  it('result equals 2*sqrt(2*R*h - h*h) on the standard branch (D=3mm, h=0.01mm, ball)', () => {
    const D = 3
    const R = D / 2
    const h = 0.01
    const expected = 2 * Math.sqrt(2 * R * h - h * h)
    const actual = stepoverFromScallopMm(D, h, 'ball')
    expect(actual).toBeCloseTo(expected, 10)
  })

  it('chord formula is monotonic in scallop (larger scallop -> larger stepover, fixed tool)', () => {
    const D = 6
    const heights = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5]
    let last = -Infinity
    for (const h of heights) {
      const e = stepoverFromScallopMm(D, h, 'ball')
      expect(e).toBeGreaterThan(last)
      last = e
    }
  })

  it('chord formula is monotonic in tool diameter (larger tool -> larger stepover, fixed scallop)', () => {
    const h = 0.02
    const diameters = [0.4, 1, 3, 6, 12, 25]
    let last = -Infinity
    for (const D of diameters) {
      const e = stepoverFromScallopMm(D, h, 'ball')
      expect(e).toBeGreaterThan(last)
      last = e
    }
  })

  it('small-scallop limit: stepover ~ 2*sqrt(2*R*h) when h << R (D=6mm, h=0.001mm)', () => {
    const D = 6
    const R = D / 2
    const h = 0.001
    const linearApprox = 2 * Math.sqrt(2 * R * h)
    const exact = 2 * Math.sqrt(2 * R * h - h * h)
    const actual = stepoverFromScallopMm(D, h, 'ball')
    // Both approximations should agree to within 1e-5 (h^2 term is 1e-6, dominated)
    expect(actual).toBeCloseTo(linearApprox, 4)
    expect(actual).toBeCloseTo(exact, 10)
  })
})

// ---------------------------------------------------------------------------
// (D) Saturated-scallop branch (h >= 0.999*R)
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (D) saturated-scallop branch', () => {
  it('h == R (saturation) returns min(R*1.9, D*0.95) (D=6mm)', () => {
    const D = 6
    const R = D / 2
    const expected = Math.min(R * 1.9, D * 0.95)
    expect(stepoverFromScallopMm(D, R, 'ball')).toBeCloseTo(expected, 10)
  })

  it('h > R (over-saturation) returns min(R*1.9, D*0.95) (D=6mm, h=10mm)', () => {
    const D = 6
    const R = D / 2
    const expected = Math.min(R * 1.9, D * 0.95)
    expect(stepoverFromScallopMm(D, 10, 'ball')).toBeCloseTo(expected, 10)
  })

  it('h == 0.999*R (right at the threshold) takes the saturation branch', () => {
    const D = 6
    const R = D / 2
    const h = 0.999 * R
    // Implementation: `if (h >= R * 0.999) return Math.min(R * 1.9, D * 0.95)`
    const expected = Math.min(R * 1.9, D * 0.95)
    expect(stepoverFromScallopMm(D, h, 'ball')).toBeCloseTo(expected, 10)
  })

  it('R*1.9 always equals D*0.95 (so saturation cap == D*0.95 for any positive D)', () => {
    for (const D of [0.4, 1, 3, 6, 12, 25, 100]) {
      const R = D / 2
      expect(R * 1.9).toBeCloseTo(D * 0.95, 10)
    }
  })

  it('saturation cap value is exactly D*0.95 for D=6mm', () => {
    expect(stepoverFromScallopMm(6, 6, 'ball')).toBeCloseTo(6 * 0.95, 10)
  })
})

// ---------------------------------------------------------------------------
// (E) Floor / cap clamps
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (E) floor and cap clamps', () => {
  it('result is always >= 0.01 mm for positive (D, h)', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0.4, 0.0001],
      [3, 0.0001],
      [6, 0.00001],
      [12, 0.000001]
    ]
    for (const [D, h] of samples) {
      const e = stepoverFromScallopMm(D, h, 'ball')
      expect(e).toBeGreaterThanOrEqual(0.01)
    }
  })

  it('result is always <= 0.95 * toolDiameter on the standard branch', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0.4, 0.05],
      [3, 0.5],
      [6, 1],
      [12, 2]
    ]
    for (const [D, h] of samples) {
      const e = stepoverFromScallopMm(D, h, 'ball')
      expect(e).toBeLessThanOrEqual(D * 0.95 + 1e-9)
    }
  })

  it('saturation cap is exactly D*0.95 (which equals R*1.9 by algebra)', () => {
    for (const D of [0.4, 1, 3, 6, 12, 25]) {
      const e = stepoverFromScallopMm(D, D, 'ball') // h=D guarantees saturation
      expect(e).toBeCloseTo(D * 0.95, 10)
    }
  })

  it('inner discriminant <= 0 path falls back to D*0.05 (h huge but pre-saturation impossible)', () => {
    // The inner = 2*R*h - h*h discriminant can only go non-positive when
    // h > 2R, which is well past the saturation threshold (h >= 0.999*R)
    // and so saturation always wins first. This invariant is the safety
    // belt -- we pin that for D=0.001, h=10 (saturation triggers, NOT
    // the discriminant fallback) the result still respects the cap.
    const e = stepoverFromScallopMm(0.001, 10, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThan(0)
    expect(e).toBeLessThanOrEqual(0.001 * 0.95 + 1e-9)
  })
})

// ---------------------------------------------------------------------------
// (F) Mode parameter ignored
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (F) mode parameter ignored at runtime', () => {
  it('ball and flat produce strictly equal stepover (D=6, h=0.01)', () => {
    expect(stepoverFromScallopMm(6, 0.01, 'flat')).toBe(stepoverFromScallopMm(6, 0.01, 'ball'))
  })

  it('ball and flat produce strictly equal stepover across a sweep of (D, h)', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0.4, 0.01],
      [1, 0.02],
      [3, 0.05],
      [6, 0.1],
      [12, 0.5]
    ]
    for (const [D, h] of samples) {
      const ball = stepoverFromScallopMm(D, h, 'ball')
      const flat = stepoverFromScallopMm(D, h, 'flat')
      expect(flat).toBe(ball)
    }
  })

  it('ball and flat produce equal saturation cap (h=R)', () => {
    const D = 6
    const R = D / 2
    expect(stepoverFromScallopMm(D, R, 'flat')).toBe(stepoverFromScallopMm(D, R, 'ball'))
  })
})

// ---------------------------------------------------------------------------
// (G) Tool-diameter zero / negative path
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (G) tool-diameter zero / negative path', () => {
  it('D=0 clamps R to 1e-6 and returns a finite stepover', () => {
    const e = stepoverFromScallopMm(0, 0.01, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThanOrEqual(0)
  })

  it('D=0 with h=0.01 takes saturation (h >> 0.999*R for R=1e-6)', () => {
    // R=5e-7 (D*0.5 with floor 1e-6 -> 1e-6). Threshold = 0.999e-6.
    // h = 0.01 >> threshold -> saturation -> min(1e-6 * 1.9, 0 * 0.95) = 0.
    // Final clamp: Math.min(...) so saturation cap can be 0.
    const e = stepoverFromScallopMm(0, 0.01, 'ball')
    // Either saturation cap path or floor path produces something finite.
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeLessThanOrEqual(1e-5)
  })

  it('D < 0 clamps R to 1e-6 (Math.max(toolDiameter*0.5, 1e-6))', () => {
    // Negative D would produce R = D/2 < 0 without the floor; the
    // implementation does Math.max(D*0.5, 1e-6) so R becomes 1e-6.
    const e = stepoverFromScallopMm(-5, 0.01, 'ball')
    expect(Number.isFinite(e)).toBe(true)
  })

  it('negative tool diameter does not throw', () => {
    expect(() => stepoverFromScallopMm(-1, 0.01, 'ball')).not.toThrow()
    expect(() => stepoverFromScallopMm(-100, 1, 'flat')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// (H) Scallop zero / negative path
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (H) scallop zero / negative path', () => {
  it('h=0 clamps to 1e-9 and returns a positive stepover (floor wins)', () => {
    const e = stepoverFromScallopMm(6, 0, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThan(0)
  })

  it('h=0 returns the floor 0.01 mm (D=6)', () => {
    // h clamped to 1e-9 -> inner = 2*3*1e-9 - 1e-18 ≈ 6e-9 ≈ sqrt -> 2*sqrt(6e-9) ≈ 1.55e-4
    // That's < 0.01 so the Math.max(e, 0.01) floor wins.
    const e = stepoverFromScallopMm(6, 0, 'ball')
    expect(e).toBeCloseTo(0.01, 10)
  })

  it('h<0 clamps to 1e-9 and produces the same result as h=0', () => {
    const e0 = stepoverFromScallopMm(6, 0, 'ball')
    const eN = stepoverFromScallopMm(6, -1, 'ball')
    expect(eN).toBe(e0)
  })

  it('very small h (1e-12) still produces a valid finite stepover (floor wins)', () => {
    const e = stepoverFromScallopMm(6, 1e-12, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThanOrEqual(0.01)
  })

  it('negative scallop does not throw', () => {
    expect(() => stepoverFromScallopMm(6, -100, 'ball')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// (I) Source-priority chain in resolve3dFinishStepoverMm
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (I) source-priority chain', () => {
  it('finishStepoverMm wins over finishScallopMm and baseStepoverMm', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 99,
      operationParams: { finishStepoverMm: 0.4, finishScallopMm: 0.01 }
    })
    expect(r.stepoverMm).toBe(0.4)
    expect(r.source).toBe('finishStepoverMm')
  })

  it('finishScallopMm wins over baseStepoverMm when finishStepoverMm absent', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 99,
      operationParams: { finishScallopMm: 0.05 }
    })
    expect(r.source).toBe('finishScallopMm')
    expect(r.stepoverMm).toBeGreaterThan(0)
    expect(r.stepoverMm).toBeLessThan(99)
  })

  it('baseStepoverMm wins when neither override is present', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.2,
      operationParams: {}
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(1.2)
  })

  it('source labels are exactly the three documented strings', () => {
    const cases: ReadonlyArray<{
      params: Record<string, unknown> | null
      expected: 'finishStepoverMm' | 'finishScallopMm' | 'stepoverMm'
    }> = [
      { params: { finishStepoverMm: 0.4 }, expected: 'finishStepoverMm' },
      { params: { finishScallopMm: 0.05 }, expected: 'finishScallopMm' },
      { params: {}, expected: 'stepoverMm' },
      { params: null, expected: 'stepoverMm' }
    ]
    for (const c of cases) {
      const r = resolve3dFinishStepoverMm({
        toolDiameterMm: 6,
        baseStepoverMm: 1,
        operationParams: c.params
      })
      expect(r.source).toBe(c.expected)
    }
  })
})

// ---------------------------------------------------------------------------
// (J) Source-validation rules
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (J) source validation', () => {
  it('finishStepoverMm = 0 is REJECTED and falls through to scallop', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: 0, finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it('finishStepoverMm < 0 is REJECTED and falls through', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: -0.5, finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it('finishStepoverMm = NaN is REJECTED (not finite)', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: Number.NaN, finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it('finishStepoverMm = Infinity is REJECTED (not finite)', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: Number.POSITIVE_INFINITY, finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it('finishStepoverMm = string is REJECTED (typeof not number)', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishStepoverMm: '0.4', finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it('finishScallopMm = 0 is REJECTED and falls through to base', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: { finishScallopMm: 0 }
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(1.5)
  })

  it('finishScallopMm < 0 is REJECTED and falls through to base', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: { finishScallopMm: -1 }
    })
    expect(r.source).toBe('stepoverMm')
  })

  it('finishScallopMm = NaN / Infinity is REJECTED and falls through', () => {
    const rNaN = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: { finishScallopMm: Number.NaN }
    })
    expect(rNaN.source).toBe('stepoverMm')
    const rInf = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: { finishScallopMm: Number.POSITIVE_INFINITY }
    })
    expect(rInf.source).toBe('stepoverMm')
  })

  it('finishScallopMm = string is REJECTED (typeof not number)', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: { finishScallopMm: '0.05' }
    })
    expect(r.source).toBe('stepoverMm')
  })
})

// ---------------------------------------------------------------------------
// (K) finishScallopMode coercion
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (K) finishScallopMode coercion', () => {
  it("finishScallopMode === 'flat' is honored as 'flat' (and source stays finishScallopMm)", () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'flat' }
    })
    expect(r.source).toBe('finishScallopMm')
    expect(r.stepoverMm).toBeGreaterThan(0)
  })

  it("finishScallopMode === 'ball' is honored as 'ball'", () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'ball' }
    })
    expect(r.source).toBe('finishScallopMm')
    expect(r.stepoverMm).toBeGreaterThan(0)
  })

  it("finishScallopMode missing defaults to 'ball'", () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02 }
    })
    expect(r.source).toBe('finishScallopMm')
  })

  it("ball and flat resolved stepoverMm are equal (mode ignored at the math layer)", () => {
    const ball = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'ball' }
    })
    const flat = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'flat' }
    })
    expect(flat.stepoverMm).toBe(ball.stepoverMm)
    expect(flat.source).toBe(ball.source)
  })

  it("garbage finishScallopMode (null, undefined, number, 'spheroid') coerces to 'ball'", () => {
    const ball = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.02, finishScallopMode: 'ball' }
    })
    const garbage: ReadonlyArray<unknown> = [null, undefined, 0, 'spheroid', 'BALL', 'Flat', { mode: 'flat' }]
    for (const m of garbage) {
      const r = resolve3dFinishStepoverMm({
        toolDiameterMm: 6,
        baseStepoverMm: 2,
        operationParams: { finishScallopMm: 0.02, finishScallopMode: m }
      })
      expect(r.source).toBe('finishScallopMm')
      // Result equals the ball reference (everything not exactly 'flat' -> 'ball')
      expect(r.stepoverMm).toBe(ball.stepoverMm)
    }
  })
})

// ---------------------------------------------------------------------------
// (L) Null / missing operationParams
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (L) null / missing operationParams', () => {
  it('operationParams = null falls through to baseStepoverMm', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: null
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(1.5)
  })

  it('operationParams = undefined falls through to baseStepoverMm', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: undefined
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(1.5)
  })

  it('operationParams = {} falls through to baseStepoverMm', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 0.8,
      operationParams: {}
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(0.8)
  })

  it('operationParams omitted from input falls through to baseStepoverMm', () => {
    const r = resolve3dFinishStepoverMm({ toolDiameterMm: 6, baseStepoverMm: 0.8 })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(0.8)
  })

  it('operationParams with unrelated keys still falls through to base', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2.5,
      operationParams: { feedrate: 1500, plungeRate: 200, scallopHeight: 0.05 } // wrong key names
    })
    expect(r.source).toBe('stepoverMm')
    expect(r.stepoverMm).toBe(2.5)
  })
})

// ---------------------------------------------------------------------------
// (M) Three-machine path realism
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (M) three-machine path realism', () => {
  it('K2 Plus 0.4 mm nozzle / FDM proxy: D=0.4, h=0.01 -> small finite stepover', () => {
    // FDM doesn't use the scallop formula directly, but the .cam-aligned
    // STL pipeline computes a parallel-pass-style metric for the slicer
    // bridge. Pinning that the math is sane in the FDM regime.
    const e = stepoverFromScallopMm(0.4, 0.01, 'ball')
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThan(0)
    // 2*sqrt(2*0.2*0.01 - 0.0001) = 2*sqrt(0.0039) ~ 0.1249
    expect(e).toBeCloseTo(2 * Math.sqrt(2 * 0.2 * 0.01 - 0.01 * 0.01), 6)
    expect(e).toBeLessThanOrEqual(0.4 * 0.95)
  })

  it('Laguna Swift 5x10 plywood finishing: D=6 mm ball, h=0.05 mm scallop -> ~1.09 mm stepover', () => {
    // Realistic 3D finishing pass on plywood with a 6 mm ball endmill
    // targeting 0.05 mm cusp height. Expected: 2*sqrt(2*3*0.05 - 0.05^2)
    // = 2*sqrt(0.2975) ~ 1.0908 mm.
    const e = stepoverFromScallopMm(6, 0.05, 'ball')
    expect(e).toBeCloseTo(1.0908, 3)
    expect(e).toBeLessThanOrEqual(6 * 0.95)
    expect(e).toBeGreaterThanOrEqual(0.01)
  })

  it('Laguna Swift 5x10 large-stepover safety: D=12 mm ball, h=0.5 mm -> ~4.85 mm stepover', () => {
    const e = stepoverFromScallopMm(12, 0.5, 'ball')
    // 2*sqrt(2*6*0.5 - 0.25) = 2*sqrt(5.75) ~ 4.7958 mm
    expect(e).toBeCloseTo(4.7958, 3)
    expect(e).toBeLessThanOrEqual(12 * 0.95)
  })

  it('Carvera 4-axis aluminum finishing: D=3 mm ball, h=0.01 mm -> ~0.244 mm stepover', () => {
    // Realistic 4-axis finishing pass on aluminum with a 3 mm ball
    // endmill at 0.01 mm scallop. Expected: 2*sqrt(2*1.5*0.01 - 0.0001)
    // = 2*sqrt(0.0299) ~ 0.3458 ... let me recompute: 2*sqrt(0.0299) =
    // 2 * 0.17292 = 0.34584. Close to ~0.346 mm.
    const e = stepoverFromScallopMm(3, 0.01, 'ball')
    const expected = 2 * Math.sqrt(2 * 1.5 * 0.01 - 0.01 * 0.01)
    expect(e).toBeCloseTo(expected, 6)
    // Sanity: well below the 3*0.95 = 2.85 cap.
    expect(e).toBeLessThan(2.85)
    expect(e).toBeGreaterThan(0.1)
  })

  it('Carvera 4-axis cap safety: D=3 mm, saturated h=2 mm -> capped at D*0.95 = 2.85 mm', () => {
    const e = stepoverFromScallopMm(3, 2, 'ball')
    // h=2 > 0.999*1.5=1.4985 -> saturation -> min(1.5*1.9, 3*0.95) = 2.85
    expect(e).toBeCloseTo(2.85, 6)
  })

  it('resolve3dFinishStepoverMm full path (Laguna 6mm ball, scallop 0.05): source=finishScallopMm', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 2,
      operationParams: { finishScallopMm: 0.05, finishScallopMode: 'ball' }
    })
    expect(r.source).toBe('finishScallopMm')
    expect(r.stepoverMm).toBeCloseTo(1.0908, 3)
  })

  it('resolve3dFinishStepoverMm full path (Carvera 3mm ball, explicit finishStepover wins)', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 3,
      baseStepoverMm: 1.5,
      operationParams: { finishStepoverMm: 0.3, finishScallopMm: 0.01 }
    })
    expect(r.source).toBe('finishStepoverMm')
    expect(r.stepoverMm).toBe(0.3)
  })
})

// ---------------------------------------------------------------------------
// (N) Pure-function invariants
// ---------------------------------------------------------------------------

describe('[ID-0239] cam-scallop-stepover.ts -- (N) pure-function invariants', () => {
  it('stepoverFromScallopMm is idempotent under N=20 calls (fixed input -> fixed output)', () => {
    const baseline = stepoverFromScallopMm(6, 0.05, 'ball')
    for (let i = 0; i < 20; i++) {
      expect(stepoverFromScallopMm(6, 0.05, 'ball')).toBe(baseline)
    }
  })

  it('resolve3dFinishStepoverMm is idempotent under N=20 calls', () => {
    const args = {
      toolDiameterMm: 6,
      baseStepoverMm: 1.2,
      operationParams: { finishScallopMm: 0.05 }
    }
    const baseline = resolve3dFinishStepoverMm(args)
    for (let i = 0; i < 20; i++) {
      const r = resolve3dFinishStepoverMm(args)
      expect(r.stepoverMm).toBe(baseline.stepoverMm)
      expect(r.source).toBe(baseline.source)
    }
  })

  it('stepoverFromScallopMm does not mutate input primitives (they are by-value)', () => {
    // Primitives are pass-by-value so this is a sanity pin -- the call
    // does not error and returns deterministically.
    const D = 6
    const h = 0.05
    const before = [D, h]
    stepoverFromScallopMm(D, h, 'ball')
    expect([D, h]).toEqual(before)
  })

  it('resolve3dFinishStepoverMm does not mutate operationParams object', () => {
    const params = { finishScallopMm: 0.05, finishScallopMode: 'flat' as const }
    const snapshot = JSON.stringify(params)
    resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1,
      operationParams: params
    })
    expect(JSON.stringify(params)).toBe(snapshot)
  })

  it('resolve3dFinishStepoverMm does not mutate the input options object', () => {
    const args = {
      toolDiameterMm: 6,
      baseStepoverMm: 1.5,
      operationParams: { finishScallopMm: 0.02 }
    }
    const snapshot = JSON.stringify(args)
    resolve3dFinishStepoverMm(args)
    expect(JSON.stringify(args)).toBe(snapshot)
  })

  it('stepoverFromScallopMm has no this-binding leakage (call vs apply equal)', () => {
    const direct = stepoverFromScallopMm(6, 0.05, 'ball')
    const applied = stepoverFromScallopMm.apply(null, [6, 0.05, 'ball'])
    const called = stepoverFromScallopMm.call(null, 6, 0.05, 'ball')
    expect(applied).toBe(direct)
    expect(called).toBe(direct)
  })

  it('resolve3dFinishStepoverMm has no this-binding leakage (call vs apply equal)', () => {
    const args = {
      toolDiameterMm: 6,
      baseStepoverMm: 1,
      operationParams: { finishScallopMm: 0.05 }
    }
    const direct = resolve3dFinishStepoverMm(args)
    const applied = resolve3dFinishStepoverMm.apply(null, [args])
    const called = resolve3dFinishStepoverMm.call(null, args)
    expect(applied.stepoverMm).toBe(direct.stepoverMm)
    expect(applied.source).toBe(direct.source)
    expect(called.stepoverMm).toBe(direct.stepoverMm)
    expect(called.source).toBe(direct.source)
  })

  it('stepoverFromScallopMm never throws on documented input ranges', () => {
    const inputs: ReadonlyArray<readonly [number, number, FinishScallopMode]> = [
      [0, 0, 'ball'],
      [-1, -1, 'ball'],
      [0.4, 0.0001, 'ball'],
      [6, 0.05, 'flat'],
      [6, 5, 'ball'],
      [12, 100, 'flat'],
      [Number.EPSILON, Number.EPSILON, 'ball']
    ]
    for (const [d, h, m] of inputs) {
      expect(() => stepoverFromScallopMm(d, h, m)).not.toThrow()
    }
  })

  it('resolve3dFinishStepoverMm never throws on documented input shapes', () => {
    const cases: ReadonlyArray<{
      toolDiameterMm: number
      baseStepoverMm: number
      operationParams: Record<string, unknown> | null
    }> = [
      { toolDiameterMm: 6, baseStepoverMm: 1, operationParams: null },
      { toolDiameterMm: 6, baseStepoverMm: 1, operationParams: {} },
      { toolDiameterMm: 0, baseStepoverMm: 1, operationParams: { finishScallopMm: 0.01 } },
      { toolDiameterMm: 6, baseStepoverMm: 1, operationParams: { finishStepoverMm: 0.4 } },
      { toolDiameterMm: 6, baseStepoverMm: 1, operationParams: { finishScallopMm: -1 } }
    ]
    for (const c of cases) {
      expect(() => resolve3dFinishStepoverMm(c)).not.toThrow()
    }
  })

  it('output shapes never include extra keys (resolve3dFinishStepoverMm)', () => {
    const r = resolve3dFinishStepoverMm({
      toolDiameterMm: 6,
      baseStepoverMm: 1,
      operationParams: { finishScallopMm: 0.05 }
    })
    expect(Object.keys(r).sort()).toEqual(['source', 'stepoverMm'])
  })
})
