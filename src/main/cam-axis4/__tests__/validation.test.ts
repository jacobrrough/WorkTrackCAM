/**
 * Tests for `validateAxis4Job` — pre-generation hard checks.
 *
 * Each error path has its own test with a specific assertion. The principle
 * being tested: validation should catch impossible / unsafe job configurations
 * BEFORE any G-code is generated, and produce actionable hints, not silent
 * miscentering or post-hoc warnings.
 */
import { describe, expect, it } from 'vitest'
import type { MeshFrameResult } from '../frame'
import {
  assertRotaryHeadstockXOffsetSet,
  assertYAxisIsZeroForProfile,
  validateAxis4Job,
  type ValidationContext
} from '../validation'

const BASE_FRAME: MeshFrameResult = {
  triangles: [],
  bbox: { min: [10, -5, -5], max: [90, 5, 5] },
  meshRadialMax: 5,
  meshRadialMin: 0,
  warnings: []
}

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    operationKind: 'cnc_4axis_roughing',
    stock: { lengthMm: 100, diameterMm: 40 },
    axisCount: 4,
    aAxisOrientation: 'x',
    dialect: 'cnc_4axis_grbl',
    frame: BASE_FRAME,
    machXStartMm: 5,
    machXEndMm: 95,
    zPassMm: -2,
    // Pre-launch punch-list rank 13: 4-axis machines REQUIRE a rotary
    // headstock X offset. Default to 5 (the bundled Carvera value) so the
    // happy-path tests skip the new validator gate; tests that exercise the
    // gate override this field.
    rotaryHeadstockXOffsetMm: 5,
    ...over
  }
}

describe('validateAxis4Job — happy path', () => {
  it('passes a sane roughing job with no warnings', () => {
    const r = validateAxis4Job(ctx())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })
})

describe('validateAxis4Job — operation kind', () => {
  it('rejects a non-4-axis kind (internal dispatch error)', () => {
    const r = validateAxis4Job(ctx({ operationKind: 'cnc_contour' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non-4-axis kind/)
  })
})

describe('validateAxis4Job — machine axis count', () => {
  it('rejects a 3-axis machine', () => {
    const r = validateAxis4Job(ctx({ axisCount: 3 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/axisCount ≥ 4/)
      expect(r.hint).toMatch(/Carvera|axisCount: 4/)
    }
  })
})

describe('validateAxis4Job — A-axis orientation', () => {
  it('rejects Y-axis rotary in v1', () => {
    const r = validateAxis4Job(ctx({ aAxisOrientation: 'y' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/around X/)
  })
})

describe('validateAxis4Job — post-process dialect', () => {
  it('rejects a non-grbl dialect', () => {
    const r = validateAxis4Job(ctx({ dialect: 'cnc_4axis_fanuc' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/GRBL/)
  })

  it('accepts cnc_4axis_grbl', () => {
    const r = validateAxis4Job(ctx({ dialect: 'cnc_4axis_grbl' }))
    expect(r.ok).toBe(true)
  })
})

describe('validateAxis4Job — stock geometry', () => {
  it('rejects zero or negative length', () => {
    const r = validateAxis4Job(ctx({ stock: { lengthMm: 0, diameterMm: 40 } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/length must be > 0/)
  })

  it('rejects zero or negative diameter', () => {
    const r = validateAxis4Job(ctx({ stock: { lengthMm: 100, diameterMm: 0 } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/diameter must be > 0/)
  })
})

describe('validateAxis4Job — zPassMm', () => {
  it('rejects NaN', () => {
    const r = validateAxis4Job(ctx({ zPassMm: NaN }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/finite/)
  })

  it('rejects depth that would cut past the rotation axis', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -15 })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock radius/)
  })

  it('accepts a depth equal to stock radius (with epsilon)', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -10 })
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateAxis4Job — machinable X span (chuck-face safety)', () => {
  it('rejects negative machXStartMm (chuck collision)', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: -1, machXEndMm: 95 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/chuck face/)
  })

  it('rejects empty machinable span', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 50, machXEndMm: 50 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/)
  })

  it('rejects machXEndMm beyond stock length', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 5, machXEndMm: 200 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock length/)
  })
})

describe('validateAxis4Job — radial extent (the undercut bug)', () => {
  it('rejects mesh that extends past stock OD', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      meshRadialMax: 25 // stock diameter is 40 → radius 20
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/past the stock OD/)
      expect(r.hint).toMatch(/Increase rotary stock Ø/)
      expect(r.hint).toMatch(/50/) // 2 × 25 mm
    }
  })

  it('accepts mesh that exactly fits within stock OD', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      meshRadialMax: 19.9
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(true)
  })
})

describe('validateAxis4Job — axial bbox (the toolpath-doesnt-map bug)', () => {
  it('rejects mesh whose X bbox is entirely off the stock', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [200, -5, -5], max: [220, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/entirely outside|does not fit/)
  })

  it('rejects mesh whose X bbox starts at negative (chuck collision)', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [-10, -5, -5], max: [50, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/does not fit inside stock/)
  })

  it('warns (does not error) when mesh barely overlaps machinable span', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [0, -5, -5], max: [4, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame, machXStartMm: 5, machXEndMm: 95 }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => /barely overlap/.test(w))).toBe(true)
  })
})

describe('validateAxis4Job — contour mode', () => {
  const baseContour = {
    operationKind: 'cnc_4axis_contour' as const,
    contourPoints: [
      [10, 0],
      [50, 30],
      [90, 0]
    ] as ReadonlyArray<readonly [number, number]>
  }

  it('rejects fewer than 2 contour points', () => {
    const r = validateAxis4Job(
      ctx({ ...baseContour, contourPoints: [[10, 0]] })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least 2 contour points/)
  })

  it('rejects contour X out of machinable span', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseContour,
        contourPoints: [[10, 0], [200, 30]],
        machXStartMm: 5,
        machXEndMm: 95
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/do not fit inside machinable span/)
  })

  it('warns (does not error) when contour is not closed', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseContour,
        contourPoints: [
          [10, 0],
          [50, 30],
          [90, 60]
        ]
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => /not closed/.test(w))).toBe(true)
  })
})

describe('validateAxis4Job — indexed mode', () => {
  const baseIndexed = {
    operationKind: 'cnc_4axis_indexed' as const,
    indexAnglesDeg: [0, 90, 180, 270] as ReadonlyArray<number>
  }

  it('rejects empty indexAnglesDeg', () => {
    const r = validateAxis4Job(ctx({ ...baseIndexed, indexAnglesDeg: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least one indexAnglesDeg/)
  })

  it('rejects angles outside aAxisRangeDeg', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [0, 90, 200],
        aAxisRangeDeg: 180
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceed machine A-axis range/)
  })

  it('accepts angles within aAxisRangeDeg', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [-90, 0, 90],
        aAxisRangeDeg: 180
      })
    )
    expect(r.ok).toBe(true)
  })

  it('warns on duplicate indexed angles', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [0, 90, 90, 180]
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => /duplicates/.test(w))).toBe(true)
  })

  // [ID-0062] The bundled Carvera 4-axis profile uses `aAxisRangeDeg: 99999`
  // as a sentinel meaning "continuous rotary / effectively unbounded" (the
  // community firmware allows unlimited A revolutions). `Math.abs(99999)` is
  // treated as the in-range limit by `validateAxis4Job`, so any realistic
  // set of indexed angles (including multi-turn moves like 720deg or -540deg)
  // must pass without triggering the `exceed machine A-axis range` error.
  // This pins that behavior so a future caller does not accidentally clamp
  // the sentinel to 360 and break continuous-rotary Carvera jobs.
  it('treats aAxisRangeDeg: 99999 as effectively unbounded (Carvera continuous rotary)', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [0, 180, 360, 720, -540],
        aAxisRangeDeg: 99999
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.every((w) => !/exceed machine A-axis range/.test(w))).toBe(true)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Pre-launch punch-list rank 13 — defense-in-depth validators
// ───────────────────────────────────────────────────────────────────────────
//
// Two new standalone validators that close the upstream-caller gap left open
// by the existing safety stack: today's belt-and-suspenders is the post-emit
// `G0 Y0` hardcode in `resources/posts/carvera_4axis.hbs:73` (silent re-
// center) plus the chuck-span validator (catches some misconfig). Neither
// stops a hand-edited or CPS-imported profile from omitting the X-offset
// field or sending non-zero Y. These tests prove the validators surface
// those misconfigurations as ValidationFailure envelopes BEFORE G-code is
// generated.

describe('assertYAxisIsZeroForProfile (rank 13)', () => {
  it('passes through (returns null) when yAxisMustBeZero is undefined', () => {
    const r = assertYAxisIsZeroForProfile({
      toolpathYValues: [5, -3] // non-zero Y but the flag is off
    })
    expect(r).toBeNull()
  })

  it('passes through (returns null) when yAxisMustBeZero is false', () => {
    const r = assertYAxisIsZeroForProfile({
      yAxisMustBeZero: false,
      toolpathYValues: [5]
    })
    expect(r).toBeNull()
  })

  it('returns null when yAxisMustBeZero is true and all Y values are zero', () => {
    const r = assertYAxisIsZeroForProfile({
      yAxisMustBeZero: true,
      toolpathYValues: [0, 0, 0]
    })
    expect(r).toBeNull()
  })

  it('returns null when no toolpathYValues are provided (strategies build Y=0)', () => {
    // The 4-axis strategies (contour/pattern/indexed/etc.) build machine Y=0
    // by construction -- they never expose Y to the caller. The validator
    // is a defense-in-depth gate for FUTURE callers that author raw G-code;
    // omitting toolpathYValues is the typical case and must be a no-op.
    const r = assertYAxisIsZeroForProfile({ yAxisMustBeZero: true })
    expect(r).toBeNull()
  })

  it('rejects a toolpath segment with non-zero Y when yAxisMustBeZero is true', () => {
    const r = assertYAxisIsZeroForProfile({
      yAxisMustBeZero: true,
      toolpathYValues: [0, 3.5, 0]
    })
    expect(r).not.toBeNull()
    if (r) {
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/Y=0 \(yAxisMustBeZero\)/)
      expect(r.error).toMatch(/toolpath segment 1/)
      expect(r.error).toMatch(/Y=3\.5000/)
      expect(r.hint).toMatch(/Carvera 4-axis HD/)
      expect(r.hint).toMatch(/centered on the rotary axis/)
    }
  })

  it('rejects a tiny negative Y value (sign-agnostic |Y| > epsilon)', () => {
    const r = assertYAxisIsZeroForProfile({
      yAxisMustBeZero: true,
      toolpathYValues: [-0.001]
    })
    expect(r).not.toBeNull()
    if (r) {
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/toolpath segment 0/)
    }
  })

  it('accepts Y values smaller than the 1e-6 epsilon as effectively zero', () => {
    // Float precision floor — a Y component of 1e-9 (from frame rounding /
    // unwrap math) must NOT trip the validator.
    const r = assertYAxisIsZeroForProfile({
      yAxisMustBeZero: true,
      toolpathYValues: [1e-9, -1e-9]
    })
    expect(r).toBeNull()
  })
})

describe('assertRotaryHeadstockXOffsetSet (rank 13)', () => {
  it('passes through (returns null) when axisCount is 3 (3-axis CNC)', () => {
    // 3-axis machines have no rotary fixture — the field is meaningless.
    const r = assertRotaryHeadstockXOffsetSet({ axisCount: 3 })
    expect(r).toBeNull()
  })

  it('passes through (returns null) when axisCount is 5', () => {
    // Future 5-axis machines have their own headstock model; this validator
    // only fires for exact 4-axis profiles where the field is mandatory.
    const r = assertRotaryHeadstockXOffsetSet({ axisCount: 5 })
    expect(r).toBeNull()
  })

  it('rejects axisCount 4 with no rotaryHeadstockXOffsetMm', () => {
    const r = assertRotaryHeadstockXOffsetSet({ axisCount: 4 })
    expect(r).not.toBeNull()
    if (r) {
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/missing rotaryHeadstockXOffsetMm/)
      expect(r.hint).toMatch(/Add `rotaryHeadstockXOffsetMm`/)
      expect(r.hint).toMatch(/Carvera 4-axis profile uses 5 mm/)
    }
  })

  it('rejects axisCount 4 with rotaryHeadstockXOffsetMm = NaN', () => {
    const r = assertRotaryHeadstockXOffsetSet({
      axisCount: 4,
      rotaryHeadstockXOffsetMm: Number.NaN
    })
    expect(r).not.toBeNull()
    if (r) {
      expect(r.error).toMatch(/missing rotaryHeadstockXOffsetMm/)
    }
  })

  it('accepts axisCount 4 with rotaryHeadstockXOffsetMm = 0 (boundary inclusive)', () => {
    // The Zod schema permits non-negative values, including 0 (some operators
    // may set G54 X=0 directly at the chuck face). The validator must not
    // reject a legitimately-zero offset.
    const r = assertRotaryHeadstockXOffsetSet({
      axisCount: 4,
      rotaryHeadstockXOffsetMm: 0
    })
    expect(r).toBeNull()
  })

  it('accepts axisCount 4 with the bundled Carvera value (5 mm)', () => {
    const r = assertRotaryHeadstockXOffsetSet({
      axisCount: 4,
      rotaryHeadstockXOffsetMm: 5
    })
    expect(r).toBeNull()
  })
})

describe('validateAxis4Job — rank 13 integration (composed gates)', () => {
  it('rejects a job whose machine profile omits rotaryHeadstockXOffsetMm', () => {
    // Drop the default-5 from the test ctx() so we exercise the gate.
    const r = validateAxis4Job(
      ctx({ rotaryHeadstockXOffsetMm: undefined })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/missing rotaryHeadstockXOffsetMm/)
      expect(r.hint).toMatch(/bundled Makera Carvera 4-axis profile uses 5 mm/)
    }
  })

  it('rejects a job whose explicit toolpathYValues include non-zero Y on a yAxisMustBeZero machine', () => {
    // Note: 4-axis contour points use [axialX, unwrapDistance] (the second
    // component is NOT machine Y; the strategy maps it to A-axis angles).
    // The yAxisMustBeZero gate fires on explicit machine-Y values, which
    // strategies build internally as 0. A caller that authors raw G-code
    // segments with Y values (e.g. hand-edited toolpath or `.cps` import)
    // must surface those through `toolpathYValues` so this gate fires
    // before the post-emit `G0 Y0` silently re-centers.
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_roughing',
        yAxisMustBeZero: true,
        toolpathYValues: [0, 12.5, 0] // off-axis Y -- should be rejected
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/Y=0 \(yAxisMustBeZero\)/)
      expect(r.error).toMatch(/Y=12\.5000/)
    }
  })

  it('accepts a job with Y=0 throughout on a yAxisMustBeZero machine', () => {
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_roughing',
        yAxisMustBeZero: true,
        toolpathYValues: [0, 0, 0]
      })
    )
    expect(r.ok).toBe(true)
  })

  it('contour job with valid unwrap-Y in contourPoints passes (contour Y is unwrap-space, not machine Y)', () => {
    // This is the load-bearing pin for the "validator does NOT scan
    // contour points" contract: the second component of contourPoints is
    // the unwrap-circumference distance which the strategy maps to A
    // angles. If the validator misinterpreted it as machine Y, the
    // bundled Carvera contour jobs (Y values up to pi*D) would fail to
    // pre-validate.
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_contour',
        yAxisMustBeZero: true,
        contourPoints: [
          [20, 0],
          [40, 94.248], // pi*30, real unwrap distance from a contour job
          [60, 188.496]
        ] as ReadonlyArray<readonly [number, number]>
      })
    )
    expect(r.ok).toBe(true)
  })

  it('headstock-missing error wins over yAxisMustBeZero error (precedence)', () => {
    // When BOTH gates would fire, the headstock check fires first. This
    // pins the deterministic error-message order so a future refactor that
    // swaps the gates is caught.
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_roughing',
        rotaryHeadstockXOffsetMm: undefined,
        yAxisMustBeZero: true,
        toolpathYValues: [5]
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/missing rotaryHeadstockXOffsetMm/)
      // Should NOT mention the Y=0 invariant — that gate is downstream.
      expect(r.error).not.toMatch(/yAxisMustBeZero/)
    }
  })
})
