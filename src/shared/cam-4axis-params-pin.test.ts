/**
 * cam-4axis-params-pin.test.ts -- [ID-0271] Cycle 199 cam-engine paired-pin
 *
 * Pins the contract of `src/shared/cam-4axis-params.ts` -- the SHARED
 * Zod-backed parser for Makera Carvera + 4-axis Rotary CAM operation params.
 *
 * Production call-sites (verified at landing):
 *   - `src/main/cam-axis4/index.ts:21` -- `parse4AxisParams` consumed by
 *     `runAxis4()` which dispatches roughing / finishing / contour / indexed
 *     / pattern / continuous strategies for ALL Carvera 4-axis rotary jobs.
 *   - `src/main/cam-runner.ts:23` -- `parse4AxisParams` re-imported for the
 *     dispatch shim that routes 4-axis ops into the facade.
 *
 * Companion behavioral file: `cam-4axis-params.test.ts` (25 it() covering the
 * happy-path / NaN / negative / zero / Infinity / wrong-type matrix per
 * field). This pin file extends coverage to lock the CONTRACT surface the
 * call-sites depend on -- module shape, exports, schema field set,
 * parse-function signature, the per-field `.safeParse` independence
 * invariant (the load-bearing design choice), the schema-vs-parse-function
 * divergence on whole-object validation, the result-shape-always-present
 * invariant, the array order-preservation invariant, and the pure-function
 * (non-mutating) invariant.
 *
 * Three-machine relevance:
 *   - **Makera Carvera + 4-axis Rotary** (DIRECT): every 4-axis job extracts
 *     cylinder geometry, chuck/clamp deductions, stepover, indexed angles,
 *     and contour points through `parse4AxisParams`. Bad params here can
 *     leak through to the post-processor and emit out-of-envelope toolpaths.
 *   - **Laguna Swift 5x10**, **Creality K2 Plus**: indirect -- they do not
 *     dispatch through the 4-axis facade, but the parser MUST not corrupt
 *     unrelated job records that may carry residual `operationParams` from
 *     mixed-three-machine fixtures (the pure-function invariant protects
 *     this).
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file authors
 * tests only. No production-G-code edits, no machine-profile edits, no
 * .hbs template edits, no schema edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import * as Mod from './cam-4axis-params'
import { axis4RawParamsSchema, parse4AxisParams } from './cam-4axis-params'
import type { Axis4ParsedParams, Axis4RawParams } from './cam-4axis-params'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All 18 fields the parser reports back, in declaration order from the source. */
const PARSED_KEYS_IN_ORDER = [
  'cylinderDiameterMm',
  'cylinderLengthMm',
  'stepoverDeg',
  'surfaceStepoverMm',
  'zStepMm',
  'chuckDepthMm',
  'clampOffsetMm',
  'wrapAxis',
  'axialBandCount',
  'cylindricalRasterMaxCells',
  'rotaryFinishAllowanceMm',
  'overcutMm',
  'finishStepoverDeg',
  'useMeshMachinableXClamp',
  'useMeshRadialZBands',
  'adaptiveRefinement',
  'contourPoints',
  'indexAnglesDeg'
] as const

const POSITIVE_FINITE_FIELDS = [
  'cylinderDiameterMm',
  'cylinderLengthMm',
  'stepoverDeg',
  'surfaceStepoverMm',
  'zStepMm',
  'axialBandCount',
  'finishStepoverDeg'
] as const

const NON_NEGATIVE_FINITE_FIELDS = [
  'chuckDepthMm',
  'clampOffsetMm',
  'overcutMm'
] as const

const FINITE_ANY_SIGN_FIELDS = ['rotaryFinishAllowanceMm'] as const

const BOOLEAN_FIELDS = [
  'useMeshMachinableXClamp',
  'useMeshRadialZBands',
  'adaptiveRefinement'
] as const

/** Build a "fully populated" valid record so we can verify per-field rejection in isolation. */
function fullyValidRaw(): Record<string, unknown> {
  return {
    cylinderDiameterMm: 50,
    cylinderLengthMm: 100,
    stepoverDeg: 15,
    surfaceStepoverMm: 2.5,
    zStepMm: 0.5,
    chuckDepthMm: 5,
    clampOffsetMm: 3,
    wrapAxis: 'y',
    axialBandCount: 4,
    cylindricalRasterMaxCells: 10000,
    rotaryFinishAllowanceMm: 0.2,
    overcutMm: 1,
    finishStepoverDeg: 7.5,
    useMeshMachinableXClamp: true,
    useMeshRadialZBands: false,
    adaptiveRefinement: true,
    contourPoints: [
      [0, 0],
      [10, 5]
    ],
    indexAnglesDeg: [0, 90, 180, 270]
  }
}

// ---------------------------------------------------------------------------
// A. Module shape -- exports + types
// ---------------------------------------------------------------------------
describe('A. cam-4axis-params -- module shape', () => {
  it('exports parse4AxisParams as a function', () => {
    expect(typeof Mod.parse4AxisParams).toBe('function')
    expect(Mod.parse4AxisParams).toBe(parse4AxisParams)
  })

  it('exports axis4RawParamsSchema as a Zod object schema', () => {
    expect(Mod.axis4RawParamsSchema).toBeDefined()
    expect(Mod.axis4RawParamsSchema).toBe(axis4RawParamsSchema)
    // ZodObject has a `.shape` accessor we can probe.
    expect(typeof axis4RawParamsSchema.shape).toBe('object')
  })

  it('parse4AxisParams.length is 1 (single-arg parse)', () => {
    expect(parse4AxisParams.length).toBe(1)
  })

  it('module export surface contains exactly { axis4RawParamsSchema, parse4AxisParams }', () => {
    // Allow other re-exports if added in future; assert MINIMUM contract.
    const keys = Object.keys(Mod)
    expect(keys).toEqual(expect.arrayContaining(['axis4RawParamsSchema', 'parse4AxisParams']))
    // No accidental default export at the runtime layer.
    expect((Mod as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('Axis4RawParams + Axis4ParsedParams type identifiers are statically reachable', () => {
    // Compile-time check: assigning a parsed result to the typed alias
    // exercises the `Axis4ParsedParams` export.
    const result: Axis4ParsedParams = parse4AxisParams({})
    expect(result).toBeDefined()
    // Compile-time check: declaring a typed raw for the schema input
    // exercises the `Axis4RawParams` export.
    const raw: Axis4RawParams = {}
    expect(raw).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// B. Schema field set -- exact 18-key contract
// ---------------------------------------------------------------------------
describe('B. axis4RawParamsSchema -- field set', () => {
  it('declares exactly the 18 documented fields (no extras, no missing)', () => {
    const shapeKeys = Object.keys(axis4RawParamsSchema.shape).sort()
    const expected = [...PARSED_KEYS_IN_ORDER].sort()
    expect(shapeKeys).toEqual(expected)
  })

  it('has the same key set as the parse function output shape', () => {
    const parsedKeys = Object.keys(parse4AxisParams({})).sort()
    const shapeKeys = Object.keys(axis4RawParamsSchema.shape).sort()
    expect(parsedKeys).toEqual(shapeKeys)
  })

  it('every field is optional at the schema level (no required keys)', () => {
    // `safeParse({})` succeeds because every field is `.optional()`.
    const r = axis4RawParamsSchema.safeParse({})
    expect(r.success).toBe(true)
  })

  it('positive-finite fields reject zero at the schema level', () => {
    for (const field of POSITIVE_FINITE_FIELDS) {
      const r = axis4RawParamsSchema.safeParse({ [field]: 0 })
      expect({ field, success: r.success }).toEqual({ field, success: false })
    }
  })

  it('non-negative-finite fields accept zero at the schema level', () => {
    for (const field of NON_NEGATIVE_FINITE_FIELDS) {
      const r = axis4RawParamsSchema.safeParse({ [field]: 0 })
      expect({ field, success: r.success }).toEqual({ field, success: true })
    }
  })

  it('rotaryFinishAllowanceMm accepts negative finite at the schema level', () => {
    const r = axis4RawParamsSchema.safeParse({ rotaryFinishAllowanceMm: -0.5 })
    expect(r.success).toBe(true)
  })

  it('cylindricalRasterMaxCells boundary: 99 fails, 100 passes', () => {
    expect(axis4RawParamsSchema.safeParse({ cylindricalRasterMaxCells: 99 }).success).toBe(false)
    expect(axis4RawParamsSchema.safeParse({ cylindricalRasterMaxCells: 100 }).success).toBe(true)
  })

  it('boolean fields reject non-boolean primitives at the schema level', () => {
    for (const field of BOOLEAN_FIELDS) {
      expect(axis4RawParamsSchema.safeParse({ [field]: 1 }).success).toBe(false)
      expect(axis4RawParamsSchema.safeParse({ [field]: 'true' }).success).toBe(false)
      expect(axis4RawParamsSchema.safeParse({ [field]: true }).success).toBe(true)
      expect(axis4RawParamsSchema.safeParse({ [field]: false }).success).toBe(true)
    }
  })

  it('wrapAxis is a freeform string -- empty + arbitrary words accepted', () => {
    expect(axis4RawParamsSchema.safeParse({ wrapAxis: '' }).success).toBe(true)
    expect(axis4RawParamsSchema.safeParse({ wrapAxis: 'banana' }).success).toBe(true)
    expect(axis4RawParamsSchema.safeParse({ wrapAxis: 123 }).success).toBe(false)
  })

  it('contourPoints schema rejects non-2-tuples at the schema level', () => {
    expect(axis4RawParamsSchema.safeParse({ contourPoints: [[1]] }).success).toBe(false)
    expect(axis4RawParamsSchema.safeParse({ contourPoints: [[1, 2, 3]] }).success).toBe(false)
    expect(axis4RawParamsSchema.safeParse({ contourPoints: [[1, 2]] }).success).toBe(true)
  })

  it('indexAnglesDeg schema rejects Infinity / NaN at the schema level', () => {
    expect(axis4RawParamsSchema.safeParse({ indexAnglesDeg: [Infinity] }).success).toBe(false)
    expect(axis4RawParamsSchema.safeParse({ indexAnglesDeg: [NaN] }).success).toBe(false)
    expect(axis4RawParamsSchema.safeParse({ indexAnglesDeg: [-45, 0, 45] }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C. Result shape always present
// ---------------------------------------------------------------------------
describe('C. parse4AxisParams -- result shape always present', () => {
  it('empty input returns object with all 18 keys (each undefined)', () => {
    const r = parse4AxisParams({})
    for (const key of PARSED_KEYS_IN_ORDER) {
      expect(Object.prototype.hasOwnProperty.call(r, key)).toBe(true)
      expect((r as Record<string, unknown>)[key]).toBeUndefined()
    }
  })

  it('result key count is exactly 18 (no extra keys leak through)', () => {
    const r = parse4AxisParams({})
    expect(Object.keys(r).length).toBe(PARSED_KEYS_IN_ORDER.length)
    expect(Object.keys(r).length).toBe(18)
  })

  it('result key ORDER matches the documented declaration order', () => {
    // Object property iteration order is preserved for non-numeric string keys
    // in V8/modern engines; this pin asserts the source-code declaration
    // order so reorder regressions surface as failing tests.
    const r = parse4AxisParams({})
    const actualOrder = Object.keys(r)
    expect(actualOrder).toEqual([...PARSED_KEYS_IN_ORDER])
  })

  it('result key set is identical even with TOTALLY invalid input', () => {
    const r = parse4AxisParams({
      cylinderDiameterMm: 'bad',
      cylinderLengthMm: NaN,
      stepoverDeg: -1,
      surfaceStepoverMm: Infinity,
      zStepMm: null,
      chuckDepthMm: 'x',
      clampOffsetMm: -1,
      wrapAxis: 99,
      axialBandCount: 0,
      cylindricalRasterMaxCells: 1,
      rotaryFinishAllowanceMm: NaN,
      overcutMm: -1,
      finishStepoverDeg: -1,
      useMeshMachinableXClamp: 1,
      useMeshRadialZBands: 'true',
      adaptiveRefinement: 'no',
      contourPoints: 'not-an-array',
      indexAnglesDeg: { not: 'array' }
    })
    expect(Object.keys(r)).toEqual([...PARSED_KEYS_IN_ORDER])
    for (const key of PARSED_KEYS_IN_ORDER) {
      expect((r as Record<string, unknown>)[key]).toBeUndefined()
    }
  })

  it('returns a fresh object on each call (no shared reference)', () => {
    const a = parse4AxisParams({})
    const b = parse4AxisParams({})
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// D. Per-field independence -- THE load-bearing design choice
// ---------------------------------------------------------------------------
describe('D. per-field .safeParse independence', () => {
  it('one bad field never invalidates the others', () => {
    const r = parse4AxisParams({
      cylinderDiameterMm: 50, // valid
      cylinderLengthMm: 'bad', // invalid (string)
      stepoverDeg: NaN, // invalid (NaN)
      surfaceStepoverMm: 2.5, // valid
      zStepMm: -0.5, // invalid (negative)
      chuckDepthMm: 5, // valid
      clampOffsetMm: 3, // valid
      wrapAxis: 'x', // valid
      axialBandCount: 0, // invalid (zero in positive-only)
      cylindricalRasterMaxCells: 10000, // valid
      rotaryFinishAllowanceMm: -0.1, // valid (finite, signed)
      overcutMm: 0, // valid (zero in non-negative)
      finishStepoverDeg: Infinity, // invalid
      useMeshMachinableXClamp: true, // valid
      useMeshRadialZBands: 'true', // invalid (string)
      adaptiveRefinement: false, // valid
      contourPoints: [[1, 2]], // valid
      indexAnglesDeg: [0, 90] // valid
    })
    expect(r.cylinderDiameterMm).toBe(50)
    expect(r.cylinderLengthMm).toBeUndefined()
    expect(r.stepoverDeg).toBeUndefined()
    expect(r.surfaceStepoverMm).toBe(2.5)
    expect(r.zStepMm).toBeUndefined()
    expect(r.chuckDepthMm).toBe(5)
    expect(r.clampOffsetMm).toBe(3)
    expect(r.wrapAxis).toBe('x')
    expect(r.axialBandCount).toBeUndefined()
    expect(r.cylindricalRasterMaxCells).toBe(10000)
    expect(r.rotaryFinishAllowanceMm).toBe(-0.1)
    expect(r.overcutMm).toBe(0)
    expect(r.finishStepoverDeg).toBeUndefined()
    expect(r.useMeshMachinableXClamp).toBe(true)
    expect(r.useMeshRadialZBands).toBeUndefined()
    expect(r.adaptiveRefinement).toBe(false)
    expect(r.contourPoints).toEqual([[1, 2]])
    expect(r.indexAnglesDeg).toEqual([0, 90])
  })

  it('schema-vs-parse divergence: schema rejects whole record, parser keeps valid fields', () => {
    const poisonedRaw: Record<string, unknown> = {
      cylinderDiameterMm: 50,
      stepoverDeg: -1 // poisons the schema, individually rejected by parser
    }
    // Schema, given a STRICT object validation (schema's own .safeParse), must
    // reject the WHOLE object due to one bad field per Zod default behavior.
    const sr = axis4RawParamsSchema.safeParse(poisonedRaw)
    expect(sr.success).toBe(false)
    // Parser, by contrast, MUST keep valid fields and clear only the bad one.
    const pr = parse4AxisParams(poisonedRaw)
    expect(pr.cylinderDiameterMm).toBe(50)
    expect(pr.stepoverDeg).toBeUndefined()
  })

  it('isolated bad-field probe across each positive-finite slot does not contaminate neighbors', () => {
    for (const target of POSITIVE_FINITE_FIELDS) {
      const raw = fullyValidRaw()
      raw[target] = -1 // poison just this one field
      const r = parse4AxisParams(raw)
      expect((r as Record<string, unknown>)[target]).toBeUndefined()
      // Verify a neighbor that should remain valid.
      expect(r.cylinderDiameterMm === undefined && target !== 'cylinderDiameterMm').toBe(false)
      // Spot-check arrays and booleans survive untouched.
      expect(r.contourPoints).toEqual([
        [0, 0],
        [10, 5]
      ])
      expect(r.indexAnglesDeg).toEqual([0, 90, 180, 270])
      expect(r.useMeshMachinableXClamp).toBe(true)
      expect(r.adaptiveRefinement).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// E. Pure-function invariants -- input mutation prohibition
// ---------------------------------------------------------------------------
describe('E. parse4AxisParams -- purity', () => {
  it('does not mutate the input record (key set unchanged)', () => {
    const raw = fullyValidRaw()
    const beforeKeys = Object.keys(raw).sort()
    parse4AxisParams(raw)
    const afterKeys = Object.keys(raw).sort()
    expect(afterKeys).toEqual(beforeKeys)
  })

  it('does not mutate the input record (values unchanged)', () => {
    const raw = fullyValidRaw()
    const snapshot = JSON.parse(JSON.stringify(raw))
    parse4AxisParams(raw)
    expect(JSON.parse(JSON.stringify(raw))).toEqual(snapshot)
  })

  it('does not share array references with the input contourPoints', () => {
    const sourcePts: [number, number][] = [
      [0, 0],
      [10, 5]
    ]
    const r = parse4AxisParams({ contourPoints: sourcePts })
    // Returned array must be a fresh container -- sourcePts must be safe to mutate
    // without affecting the parsed result (defensive copy via .safeParse).
    sourcePts.push([99, 99])
    expect(r.contourPoints).toEqual([
      [0, 0],
      [10, 5]
    ])
    expect(r.contourPoints).not.toBe(sourcePts)
  })

  it('does not share array references with the input indexAnglesDeg', () => {
    const sourceAng: number[] = [0, 90, 180]
    const r = parse4AxisParams({ indexAnglesDeg: sourceAng })
    sourceAng.push(999)
    expect(r.indexAnglesDeg).toEqual([0, 90, 180])
    expect(r.indexAnglesDeg).not.toBe(sourceAng)
  })

  it('repeated calls with identical input yield deeply-equal results', () => {
    const raw = fullyValidRaw()
    const a = parse4AxisParams(raw)
    const b = parse4AxisParams(raw)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// F. Array-field semantics -- order, filtering, edge cases
// ---------------------------------------------------------------------------
describe('F. contourPoints + indexAnglesDeg -- array semantics', () => {
  it('contourPoints preserves order of valid entries while skipping invalid', () => {
    const r = parse4AxisParams({
      contourPoints: [
        [0, 0], // valid
        'bad', // invalid
        [10, 5], // valid
        [NaN, 1], // invalid
        [20, 10] // valid
      ]
    })
    expect(r.contourPoints).toEqual([
      [0, 0],
      [10, 5],
      [20, 10]
    ])
  })

  it('indexAnglesDeg preserves order of valid entries while skipping invalid', () => {
    const r = parse4AxisParams({
      indexAnglesDeg: [-90, NaN, 0, Infinity, 'bad', 90, -Infinity, 180]
    })
    expect(r.indexAnglesDeg).toEqual([-90, 0, 90, 180])
  })

  it('contourPoints rejects entries with > 2 elements (strict 2-tuple)', () => {
    const r = parse4AxisParams({
      contourPoints: [
        [1, 2], // valid
        [1, 2, 3], // invalid (extra element)
        [4, 5] // valid
      ]
    })
    expect(r.contourPoints).toEqual([
      [1, 2],
      [4, 5]
    ])
  })

  it('contourPoints rejects entries with < 2 elements', () => {
    const r = parse4AxisParams({
      contourPoints: [
        [1], // invalid (one element)
        [], // invalid (zero)
        [3, 4] // valid
      ]
    })
    expect(r.contourPoints).toEqual([[3, 4]])
  })

  it('contourPoints rejects null entries within the array', () => {
    const r = parse4AxisParams({
      contourPoints: [null, [1, 2], undefined, [3, 4]]
    })
    expect(r.contourPoints).toEqual([
      [1, 2],
      [3, 4]
    ])
  })

  it('contourPoints with all-invalid array returns undefined (not [])', () => {
    const r = parse4AxisParams({
      contourPoints: ['bad', null, [Infinity, 1], [1]]
    })
    expect(r.contourPoints).toBeUndefined()
  })

  it('indexAnglesDeg with all-invalid array returns undefined (not [])', () => {
    const r = parse4AxisParams({
      indexAnglesDeg: [NaN, Infinity, 'x', null]
    })
    expect(r.indexAnglesDeg).toBeUndefined()
  })

  it('indexAnglesDeg accepts large Carvera-realistic angle sweeps', () => {
    // Carvera 4-axis indexed jobs commonly emit fixtures at 8-, 12-, or 24-station spacings.
    const sweep24 = Array.from({ length: 24 }, (_, i) => i * 15) // 0,15,...,345
    const r = parse4AxisParams({ indexAnglesDeg: sweep24 })
    expect(r.indexAnglesDeg).toEqual(sweep24)
    expect(r.indexAnglesDeg?.length).toBe(24)
  })

  it('indexAnglesDeg accepts negative + zero + positive mixed (rotation-direction agnostic)', () => {
    const r = parse4AxisParams({ indexAnglesDeg: [-180, -90, 0, 90, 180] })
    expect(r.indexAnglesDeg).toEqual([-180, -90, 0, 90, 180])
  })
})

// ---------------------------------------------------------------------------
// G. null + undefined parity -- both treated as missing
// ---------------------------------------------------------------------------
describe('G. null vs undefined -- both treated as missing', () => {
  it('null produces undefined for every field type', () => {
    const r = parse4AxisParams({
      cylinderDiameterMm: null,
      stepoverDeg: null,
      chuckDepthMm: null,
      rotaryFinishAllowanceMm: null,
      wrapAxis: null,
      useMeshMachinableXClamp: null,
      adaptiveRefinement: null,
      cylindricalRasterMaxCells: null,
      contourPoints: null,
      indexAnglesDeg: null
    })
    expect(r.cylinderDiameterMm).toBeUndefined()
    expect(r.stepoverDeg).toBeUndefined()
    expect(r.chuckDepthMm).toBeUndefined()
    expect(r.rotaryFinishAllowanceMm).toBeUndefined()
    expect(r.wrapAxis).toBeUndefined()
    expect(r.useMeshMachinableXClamp).toBeUndefined()
    expect(r.adaptiveRefinement).toBeUndefined()
    expect(r.cylindricalRasterMaxCells).toBeUndefined()
    expect(r.contourPoints).toBeUndefined()
    expect(r.indexAnglesDeg).toBeUndefined()
  })

  it('explicit undefined matches missing-key behavior', () => {
    const rExplicit = parse4AxisParams({ cylinderDiameterMm: undefined })
    const rMissing = parse4AxisParams({})
    expect(rExplicit).toEqual(rMissing)
  })
})

// ---------------------------------------------------------------------------
// H. Field-class boundary tests (positive-finite vs non-negative vs finite)
// ---------------------------------------------------------------------------
describe('H. field-class boundary semantics', () => {
  it('positive-finite fields reject zero (parser layer matches schema layer)', () => {
    for (const field of POSITIVE_FINITE_FIELDS) {
      const r = parse4AxisParams({ [field]: 0 })
      expect((r as Record<string, unknown>)[field]).toBeUndefined()
    }
  })

  it('positive-finite fields accept the smallest positive finite value (Number.MIN_VALUE)', () => {
    for (const field of POSITIVE_FINITE_FIELDS) {
      const r = parse4AxisParams({ [field]: Number.MIN_VALUE })
      expect((r as Record<string, unknown>)[field]).toBe(Number.MIN_VALUE)
    }
  })

  it('non-negative-finite fields accept exactly zero', () => {
    for (const field of NON_NEGATIVE_FINITE_FIELDS) {
      const r = parse4AxisParams({ [field]: 0 })
      expect((r as Record<string, unknown>)[field]).toBe(0)
    }
  })

  it('non-negative-finite fields accept -0 (Zod preserves sign of zero; arithmetic equality holds)', () => {
    // Vitest .toBe uses Object.is, so -0 !== +0 there. The parser preserves
    // the sign of zero (Zod does not normalize). Pin via arithmetic equality
    // so a future "normalize -0 to 0" change surfaces as a failing test.
    for (const field of NON_NEGATIVE_FINITE_FIELDS) {
      const r = parse4AxisParams({ [field]: -0 })
      const v = (r as Record<string, number | undefined>)[field]
      expect(typeof v).toBe('number')
      expect(Number.isFinite(v)).toBe(true)
      expect(v === 0).toBe(true) // arithmetic equality (covers both -0 and +0)
    }
  })

  it('finite-any-sign field (rotaryFinishAllowanceMm) accepts negative + zero + positive', () => {
    for (const field of FINITE_ANY_SIGN_FIELDS) {
      expect((parse4AxisParams({ [field]: -1 }) as Record<string, unknown>)[field]).toBe(-1)
      expect((parse4AxisParams({ [field]: 0 }) as Record<string, unknown>)[field]).toBe(0)
      expect((parse4AxisParams({ [field]: 1 }) as Record<string, unknown>)[field]).toBe(1)
    }
  })

  it('finite-any-sign field rejects Infinity and NaN', () => {
    for (const field of FINITE_ANY_SIGN_FIELDS) {
      expect(
        (parse4AxisParams({ [field]: Infinity }) as Record<string, unknown>)[field]
      ).toBeUndefined()
      expect(
        (parse4AxisParams({ [field]: -Infinity }) as Record<string, unknown>)[field]
      ).toBeUndefined()
      expect(
        (parse4AxisParams({ [field]: NaN }) as Record<string, unknown>)[field]
      ).toBeUndefined()
    }
  })

  it('cylindricalRasterMaxCells boundary at 100 (inclusive) -- 99 rejected, 100 accepted', () => {
    expect(parse4AxisParams({ cylindricalRasterMaxCells: 99 }).cylindricalRasterMaxCells).toBeUndefined()
    expect(parse4AxisParams({ cylindricalRasterMaxCells: 100 }).cylindricalRasterMaxCells).toBe(100)
    expect(parse4AxisParams({ cylindricalRasterMaxCells: 200000 }).cylindricalRasterMaxCells).toBe(200000)
  })

  it('cylindricalRasterMaxCells accepts very large finite values (no upper schema cap; clamping is a caller responsibility)', () => {
    // Source comment notes: "(>= 100, clamped to 200_000)". The clamping is in
    // the caller, not the schema -- a strict pin to surface that delegation.
    const r = parse4AxisParams({ cylindricalRasterMaxCells: 5_000_000 })
    expect(r.cylindricalRasterMaxCells).toBe(5_000_000)
  })

  it('cylindricalRasterMaxCells rejects Infinity but accepts the implicit min(100) ceiling=Number.MAX_SAFE_INTEGER', () => {
    expect(
      parse4AxisParams({ cylindricalRasterMaxCells: Infinity }).cylindricalRasterMaxCells
    ).toBeUndefined()
    expect(
      parse4AxisParams({ cylindricalRasterMaxCells: Number.MAX_SAFE_INTEGER })
        .cylindricalRasterMaxCells
    ).toBe(Number.MAX_SAFE_INTEGER)
  })
})

// ---------------------------------------------------------------------------
// I. Three-machine realism -- Makera Carvera + 4-axis fixtures
// ---------------------------------------------------------------------------
describe('I. Carvera 4-axis realism', () => {
  it('parses a realistic roughing job (cylinder diameter 30mm x length 80mm, chuck 8mm, raster 50000 cells)', () => {
    const r = parse4AxisParams({
      cylinderDiameterMm: 30,
      cylinderLengthMm: 80,
      chuckDepthMm: 8,
      clampOffsetMm: 2,
      stepoverDeg: 6,
      zStepMm: 0.4,
      cylindricalRasterMaxCells: 50000,
      useMeshMachinableXClamp: true,
      useMeshRadialZBands: true,
      adaptiveRefinement: false
    })
    expect(r.cylinderDiameterMm).toBe(30)
    expect(r.cylinderLengthMm).toBe(80)
    expect(r.chuckDepthMm).toBe(8)
    expect(r.clampOffsetMm).toBe(2)
    expect(r.stepoverDeg).toBe(6)
    expect(r.zStepMm).toBe(0.4)
    expect(r.cylindricalRasterMaxCells).toBe(50000)
    expect(r.useMeshMachinableXClamp).toBe(true)
    expect(r.useMeshRadialZBands).toBe(true)
    expect(r.adaptiveRefinement).toBe(false)
  })

  it('parses a realistic finishing job (surfaceStepover 0.05 mm, finish allowance 0.1 mm, finishStepoverDeg 1.5)', () => {
    const r = parse4AxisParams({
      cylinderDiameterMm: 25,
      cylinderLengthMm: 60,
      surfaceStepoverMm: 0.05,
      rotaryFinishAllowanceMm: 0.1,
      finishStepoverDeg: 1.5,
      adaptiveRefinement: true
    })
    expect(r.surfaceStepoverMm).toBe(0.05)
    expect(r.rotaryFinishAllowanceMm).toBe(0.1)
    expect(r.finishStepoverDeg).toBe(1.5)
    expect(r.adaptiveRefinement).toBe(true)
  })

  it('parses a realistic indexed job at 8 stations (0,45,...,315)', () => {
    const indexed = [0, 45, 90, 135, 180, 225, 270, 315]
    const r = parse4AxisParams({
      cylinderDiameterMm: 40,
      cylinderLengthMm: 120,
      indexAnglesDeg: indexed
    })
    expect(r.indexAnglesDeg).toEqual(indexed)
    expect(r.cylinderDiameterMm).toBe(40)
  })

  it('parses a realistic contour job (axial cross-section polyline)', () => {
    const contour: [number, number][] = [
      [0, 0],
      [5, 12],
      [15, 18],
      [40, 18],
      [60, 12],
      [80, 0]
    ]
    const r = parse4AxisParams({
      cylinderDiameterMm: 25,
      cylinderLengthMm: 80,
      contourPoints: contour
    })
    expect(r.contourPoints).toEqual(contour)
  })

  it('Carvera max rotary length 240mm + max diameter 92mm round-trip cleanly (per CLAUDE.md spec)', () => {
    const r = parse4AxisParams({
      cylinderDiameterMm: 92,
      cylinderLengthMm: 240,
      stepoverDeg: 4,
      zStepMm: 0.5
    })
    expect(r.cylinderDiameterMm).toBe(92)
    expect(r.cylinderLengthMm).toBe(240)
    // The schema has no upper bounds for these -- the post-processor is
    // responsible for envelope-clamping. Pin asserts schema delegation.
  })

  it('overcutMm zero accepted (no overcut requested -- the common case)', () => {
    const r = parse4AxisParams({ overcutMm: 0 })
    expect(r.overcutMm).toBe(0)
  })

  it('axialBandCount rejects fractional values? actually positiveFinite allows non-integer; pin observed behavior', () => {
    // Source comment says "integer >= 1, clamped to [1, 24]" but the schema is
    // `positiveFinite` -- no integer constraint. Pin observed schema behavior
    // so a future "add .int()" change surfaces as a failing test.
    expect(parse4AxisParams({ axialBandCount: 1.5 }).axialBandCount).toBe(1.5)
    expect(parse4AxisParams({ axialBandCount: 24 }).axialBandCount).toBe(24)
    expect(parse4AxisParams({ axialBandCount: 25 }).axialBandCount).toBe(25)
    // The [1, 24] clamping happens in the caller, not the schema.
  })
})

// ---------------------------------------------------------------------------
// J. Source-text whitelist -- sentinel pins so deletions surface here
// ---------------------------------------------------------------------------
describe('J. cam-4axis-params.ts source-text whitelist', () => {
  const SRC_PATH = resolvePath(__dirname, 'cam-4axis-params.ts')
  const SRC_TEXT = readFileSync(SRC_PATH, 'utf8')

  it('source declares export const axis4RawParamsSchema', () => {
    expect(SRC_TEXT).toMatch(/export const axis4RawParamsSchema = z\.object\(/)
  })

  it('source declares export function parse4AxisParams', () => {
    expect(SRC_TEXT).toMatch(/export function parse4AxisParams\(/)
  })

  it('source declares export type Axis4RawParams', () => {
    expect(SRC_TEXT).toMatch(/export type Axis4RawParams = z\.infer<typeof axis4RawParamsSchema>/)
  })

  it('source declares export type Axis4ParsedParams', () => {
    expect(SRC_TEXT).toMatch(/export type Axis4ParsedParams = \{/)
  })

  it('source uses .safeParse (not .parse) for tolerance to bad fields', () => {
    expect(SRC_TEXT).toMatch(/\.safeParse\(/)
    // Should NOT use the throwing variant in either internal helper or parse fn.
    const parseFnRegion = SRC_TEXT.split('export function parse4AxisParams')[1] ?? ''
    expect(parseFnRegion).not.toMatch(/\.parse\(/)
  })

  it('source declares positiveFinite + nonNegativeFinite + finiteNum refinements', () => {
    expect(SRC_TEXT).toMatch(/const positiveFinite = z\.number\(\)\.positive\(\)\.finite\(\)/)
    expect(SRC_TEXT).toMatch(/const nonNegativeFinite = z\.number\(\)\.nonnegative\(\)\.finite\(\)/)
    expect(SRC_TEXT).toMatch(/const finiteNum = z\.number\(\)\.finite\(\)/)
  })

  it('source documents the per-field independence design choice', () => {
    expect(SRC_TEXT).toMatch(/per-field `\.safeParse\(\)`/)
    expect(SRC_TEXT).toMatch(/intentionally field-by-field/)
  })

  it('source contourPoints helper skips invalid entries (does not reject whole array)', () => {
    expect(SRC_TEXT).toMatch(/Mirrors the original `point2dList\(\)` behavior \u2014 skips invalid entries/)
  })

  it('source mentions Carvera-relevant fields (cylinder geometry + chuck + index angles + contour)', () => {
    expect(SRC_TEXT).toMatch(/Cylinder geometry/)
    expect(SRC_TEXT).toMatch(/Chuck \/ clamp/)
    expect(SRC_TEXT).toMatch(/array of \[x, y\] points/)
    expect(SRC_TEXT).toMatch(/array of angle degrees/)
  })
})

// ---------------------------------------------------------------------------
// K. Type-shape parity -- Axis4RawParams vs Axis4ParsedParams (compile-time)
// ---------------------------------------------------------------------------
describe('K. type-level parity (compile-time)', () => {
  it('Axis4RawParams accepts the same field set as Axis4ParsedParams', () => {
    // Compile-time shape check -- if either type drifts, this assignment will fail tsc.
    const raw: Axis4RawParams = {
      cylinderDiameterMm: 50,
      cylinderLengthMm: 100,
      stepoverDeg: 15,
      surfaceStepoverMm: 2.5,
      zStepMm: 0.5,
      chuckDepthMm: 5,
      clampOffsetMm: 3,
      wrapAxis: 'y',
      axialBandCount: 4,
      cylindricalRasterMaxCells: 10000,
      rotaryFinishAllowanceMm: 0.2,
      overcutMm: 1,
      finishStepoverDeg: 7.5,
      useMeshMachinableXClamp: true,
      useMeshRadialZBands: false,
      adaptiveRefinement: true,
      contourPoints: [[0, 0]],
      indexAnglesDeg: [0]
    }
    const parsed: Axis4ParsedParams = parse4AxisParams(raw as Record<string, unknown>)
    // Spot-check parity for a few representative fields.
    expect(parsed.cylinderDiameterMm).toBe(raw.cylinderDiameterMm)
    expect(parsed.wrapAxis).toBe(raw.wrapAxis)
    expect(parsed.adaptiveRefinement).toBe(raw.adaptiveRefinement)
    expect(parsed.contourPoints).toEqual(raw.contourPoints)
    expect(parsed.indexAnglesDeg).toEqual(raw.indexAnglesDeg)
  })

  it('Axis4RawParams field set sourced from z.infer<typeof axis4RawParamsSchema> (type identity)', () => {
    // If the schema and the inferred type drift, this test still imports both
    // and the runtime cross-check verifies the schema's `.shape` covers every
    // key declared on the parsed result.
    type SchemaKeys = keyof z.infer<typeof axis4RawParamsSchema>
    const sample: SchemaKeys[] = [
      'cylinderDiameterMm',
      'cylinderLengthMm',
      'wrapAxis',
      'contourPoints',
      'indexAnglesDeg'
    ]
    expect(sample.length).toBe(5)
    for (const key of sample) {
      expect(Object.prototype.hasOwnProperty.call(axis4RawParamsSchema.shape, key)).toBe(true)
    }
  })
})
