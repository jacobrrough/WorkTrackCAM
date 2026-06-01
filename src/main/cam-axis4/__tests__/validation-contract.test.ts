/**
 * Paired-pin contract for `src/main/cam-axis4/validation.ts`
 * (Cycle 125 [ID-0202] -- cam-engine slot).
 *
 * Companion to the existing `validation.test.ts`. The original file's 26 it()
 * blocks cover one example per error path; this file pins the broader behavior
 * surface the original left implicit:
 *
 *   A. FOUR_AXIS_KINDS membership (all 5 kinds accepted; non-members rejected).
 *   B. Sequential short-circuit precedence (each guard fires before later ones).
 *   C. Dialect regex case-insensitivity + substring semantics (/grbl/i).
 *   D. Stock geometry boundary table (NaN, -1, 0, Infinity, +epsilon).
 *   E. zPassMm sign-agnostic acceptance + magnitude epsilon (stockRadius+0.1).
 *   F. Machinable-X span boundaries (start<0, empty-+0.1, overstock-+0.1).
 *   G. Mesh radial-extent epsilon (stockRadius+0.05) + min-diameter hint format.
 *   H. Mesh axial bbox dual-branch coverage ("does not fit" vs "entirely outside").
 *   I. Soft-warning thresholds (overlap=0.5, contour gap=0.5, indexed dup rounding).
 *   J. Indexed-mode aAxisRangeDeg edge cases (undefined / null / 0 / NaN / Infinity / negative).
 *   K. Result-shape pin (failure has {ok:false, error, hint}; success has {ok:true, warnings}).
 *
 * ZERO production-code edits -- this is a pure additive paired-pin per the
 * recent cam-engine cycle pattern (Cycle 120 [ID-0197] heightmap, Cycle 119
 * [ID-0196] derive-features, Cycle 121 [ID-0198] kernel-build-messages).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { MeshFrameResult, Stock } from '../frame'
import { validateAxis4Job, type ValidationContext } from '../validation'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

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

// Resolve validation.ts source for source-text pins.
const __dirname_resolved = dirname(fileURLToPath(import.meta.url))
const VALIDATION_SOURCE_PATH = resolve(__dirname_resolved, '..', 'validation.ts')
const VALIDATION_SOURCE = readFileSync(VALIDATION_SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// SECTION A: FOUR_AXIS_KINDS membership
//   Pins the full list of accepted operation kinds; rejects non-members.
// ---------------------------------------------------------------------------

describe('A. FOUR_AXIS_KINDS membership pin', () => {
  const ALL_FIVE_KINDS = [
    'cnc_4axis_roughing',
    'cnc_4axis_finishing',
    'cnc_4axis_contour',
    'cnc_4axis_indexed',
    'cnc_4axis_continuous'
  ] as const

  it('accepts all 5 four-axis kinds (modulo per-kind required fields)', () => {
    for (const kind of ALL_FIVE_KINDS) {
      const opts: Partial<ValidationContext> = { operationKind: kind }
      // Contour and indexed need their per-kind fields populated to reach the
      // happy path; supply minimal valid data so the kind itself is accepted.
      if (kind === 'cnc_4axis_contour') {
        opts.contourPoints = [
          [10, 0],
          [50, 30],
          [90, 0]
        ] as ReadonlyArray<readonly [number, number]>
      } else if (kind === 'cnc_4axis_indexed') {
        opts.indexAnglesDeg = [0, 90, 180, 270]
      }
      const r = validateAxis4Job(ctx(opts))
      expect(r.ok, `expected ${kind} to validate`).toBe(true)
    }
  })

  it('rejects an empty-string operation kind with the dispatch error', () => {
    const r = validateAxis4Job(ctx({ operationKind: '' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/non-4-axis kind/)
      expect(r.hint).toMatch(/internal dispatch error/)
    }
  })

  it('rejects close-but-wrong kinds (case sensitivity, prefix variants)', () => {
    const sneaky = [
      'CNC_4AXIS_ROUGHING', // uppercase
      'cnc_4axis_rough', // truncated
      'cnc_5axis_roughing', // 5-axis
      'cnc_3axis_contour', // 3-axis
      'cnc_4axis_thread', // not in set
      ' cnc_4axis_roughing' // leading space
    ]
    for (const kind of sneaky) {
      const r = validateAxis4Job(ctx({ operationKind: kind }))
      expect(r.ok, `expected '${kind}' to be rejected`).toBe(false)
    }
  })

  it('source-text pin: validation.ts contains exactly the 5 expected kind literals', () => {
    for (const kind of ALL_FIVE_KINDS) {
      // Match the kind appearing as a single-quoted string literal in the source.
      const re = new RegExp(`'${kind.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}'`)
      expect(re.test(VALIDATION_SOURCE), `expected source to contain literal '${kind}'`).toBe(true)
    }
    // And the set is declared as a 5-element array literal.
    const setMatch = VALIDATION_SOURCE.match(/const FOUR_AXIS_KINDS = new Set\(\[([^\]]+)\]\)/m)
    expect(setMatch, 'FOUR_AXIS_KINDS Set declaration must be present').toBeTruthy()
    if (setMatch) {
      const literals = setMatch[1]!.match(/'([^']+)'/g) ?? []
      expect(literals).toHaveLength(5)
    }
  })
})

// ---------------------------------------------------------------------------
// SECTION B: Sequential short-circuit precedence
//   Pins the order in which checks fire so that the first-failure error
//   message is deterministic when multiple invariants are violated.
// ---------------------------------------------------------------------------

describe('B. Sequential short-circuit precedence', () => {
  it('operationKind error wins over axisCount error', () => {
    const r = validateAxis4Job(ctx({ operationKind: 'cnc_contour', axisCount: 3 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non-4-axis kind/)
  })

  it('axisCount error wins over orientation error', () => {
    const r = validateAxis4Job(ctx({ axisCount: 3, aAxisOrientation: 'y' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/axisCount/)
  })

  it('orientation error wins over dialect error', () => {
    const r = validateAxis4Job(
      ctx({ aAxisOrientation: 'y', dialect: 'cnc_4axis_fanuc' })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/around X/)
  })

  it('dialect error wins over stock-length error', () => {
    const r = validateAxis4Job(
      ctx({ dialect: 'cnc_4axis_fanuc', stock: { lengthMm: 0, diameterMm: 40 } })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/GRBL/)
  })

  it('stock-length error wins over stock-diameter error', () => {
    const r = validateAxis4Job(ctx({ stock: { lengthMm: 0, diameterMm: 0 } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/length must be > 0/)
  })

  it('stock-diameter error wins over zPassMm error', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 0 }, zPassMm: NaN })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/diameter must be > 0/)
  })

  it('zPassMm finite-check error wins over magnitude error', () => {
    // NaN fails the finite check; if we got past that we would also fail magnitude
    // (NaN > anything is false, so magnitude check would not trigger). The
    // intent here is to pin that finite-ness is checked first.
    const r = validateAxis4Job(ctx({ zPassMm: NaN }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/finite/)
  })

  it('zPassMm magnitude error wins over machinable-X error', () => {
    const r = validateAxis4Job(
      ctx({
        stock: { lengthMm: 100, diameterMm: 20 },
        zPassMm: -50,
        machXStartMm: -1
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock radius/)
  })

  it('machXStartMm<0 error wins over machXEndMm-empty error', () => {
    const r = validateAxis4Job(
      ctx({ machXStartMm: -1, machXEndMm: -1 })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/chuck face/)
  })

  it('machXEndMm-empty error wins over machXEndMm-overstock error', () => {
    // Empty span (start=end) triggers BEFORE overstock check would fire.
    const r = validateAxis4Job(ctx({ machXStartMm: 200, machXEndMm: 200 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/)
  })

  it('mesh-radial error wins over mesh-axial error', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      meshRadialMax: 30, // > stockRadius=20
      bbox: { min: [-10, -5, -5], max: [50, 5, 5] } // also fails axial
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/past the stock OD/)
  })
})

// ---------------------------------------------------------------------------
// SECTION C: Dialect regex /grbl/i semantics
//   The dialect check uses /grbl/i.test(...) -- case-insensitive and
//   substring-based. Pin both behaviors explicitly.
// ---------------------------------------------------------------------------

describe('C. Dialect regex /grbl/i semantics', () => {
  it('accepts uppercase GRBL', () => {
    const r = validateAxis4Job(ctx({ dialect: 'GRBL' }))
    expect(r.ok).toBe(true)
  })

  it('accepts mixed-case Grbl', () => {
    const r = validateAxis4Job(ctx({ dialect: 'Grbl' }))
    expect(r.ok).toBe(true)
  })

  it('accepts cnc_4axis_grbl bundled string verbatim', () => {
    const r = validateAxis4Job(ctx({ dialect: 'cnc_4axis_grbl' }))
    expect(r.ok).toBe(true)
  })

  it('accepts substring matches like grbl-makera-3.5 (substring semantics pin)', () => {
    const r = validateAxis4Job(ctx({ dialect: 'grbl-makera-3.5' }))
    expect(r.ok).toBe(true)
  })

  it('rejects close-but-wrong typos (gerbil, grbm)', () => {
    for (const dialect of ['gerbil', 'grbm', 'grb1', 'g_r_b_l']) {
      const r = validateAxis4Job(ctx({ dialect }))
      expect(r.ok, `expected '${dialect}' to be rejected`).toBe(false)
    }
  })

  it('rejects empty dialect string', () => {
    const r = validateAxis4Job(ctx({ dialect: '' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/GRBL/)
  })
})

// ---------------------------------------------------------------------------
// SECTION D: Stock geometry boundary table
// ---------------------------------------------------------------------------

describe('D. Stock geometry boundary table', () => {
  const BAD_LENGTHS: Array<[unknown, string]> = [
    [0, 'zero'],
    [-1, 'negative'],
    [-0.0001, 'tiny negative'],
    [Number.NaN, 'NaN']
  ]

  for (const [val, label] of BAD_LENGTHS) {
    it(`rejects stock length = ${label}`, () => {
      const r = validateAxis4Job(
        ctx({ stock: { lengthMm: val as number, diameterMm: 40 } })
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/length must be > 0/)
    })
  }

  it('accepts stock length = +Infinity (the > 0 guard does not bound it)', () => {
    // ASSUMPTION: validation.ts only requires lengthMm > 0; Infinity passes the
    // gate. Downstream checks (mesh axial fit) constrain ranges.
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: Number.POSITIVE_INFINITY, diameterMm: 40 } })
    )
    expect(r.ok).toBe(true)
  })

  for (const [val, label] of BAD_LENGTHS) {
    it(`rejects stock diameter = ${label}`, () => {
      const r = validateAxis4Job(
        ctx({ stock: { lengthMm: 100, diameterMm: val as number } })
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/diameter must be > 0/)
    })
  }
})

// ---------------------------------------------------------------------------
// SECTION E: zPassMm sign-agnostic + magnitude boundary
//   The runner normalizes zPassMm to negative; validation accepts either sign
//   but rejects magnitudes > stockRadius + 0.1 mm (would cut past the rotation
//   axis).
// ---------------------------------------------------------------------------

describe('E. zPassMm sign-agnostic + magnitude boundary', () => {
  it('accepts negative zPassMm at -2 mm (canonical case)', () => {
    const r = validateAxis4Job(ctx({ zPassMm: -2 }))
    expect(r.ok).toBe(true)
  })

  it('accepts positive zPassMm of equal magnitude', () => {
    const r = validateAxis4Job(ctx({ zPassMm: 2 }))
    expect(r.ok).toBe(true)
  })

  it('accepts zPassMm exactly at stockRadius (with +0.1 mm epsilon)', () => {
    // stock diameter 20 -> radius 10. Magnitude 10 is <= 10 + 0.1.
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -10 })
    )
    expect(r.ok).toBe(true)
  })

  it('accepts zPassMm at stockRadius + 0.1 mm exactly (boundary inclusive)', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -10.1 })
    )
    expect(r.ok).toBe(true)
  })

  it('rejects zPassMm just past stockRadius + 0.1 mm', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -10.2 })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock radius/)
  })

  it('rejects +Infinity zPassMm via the finite guard, not magnitude', () => {
    const r = validateAxis4Job(ctx({ zPassMm: Number.POSITIVE_INFINITY }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/finite/)
  })
})

// ---------------------------------------------------------------------------
// SECTION F: Machinable-X span boundaries
// ---------------------------------------------------------------------------

describe('F. Machinable-X span boundaries', () => {
  it('rejects machXStartMm = -0.0001 (any negative, not just whole numbers)', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: -0.0001, machXEndMm: 95 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/chuck face/)
  })

  it('accepts machXStartMm = 0 exactly (the < 0 guard is strict)', () => {
    // Set bbox so meshMinX >= 0 to avoid axial-fit complaints.
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [0, -5, -5], max: [50, 5, 5] }
    }
    const r = validateAxis4Job(
      ctx({ frame, machXStartMm: 0, machXEndMm: 95 })
    )
    expect(r.ok).toBe(true)
  })

  it('rejects empty span at exactly machXStartMm + 0.1 (strict <=)', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 5, machXEndMm: 5.1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/)
  })

  it('accepts span just above machXStartMm + 0.1', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 5, machXEndMm: 5.11 }))
    // Other downstream checks (mesh axial) must also pass; bbox [10,90] does
    // intersect [5, 5.11] (overlap is ~0.11). It is barely-overlapping but
    // emits a warning rather than an error.
    expect(r.ok).toBe(true)
  })

  it('accepts machXEndMm exactly at stockLengthMm + 0.1 (boundary inclusive)', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 5, machXEndMm: 100.1 }))
    expect(r.ok).toBe(true)
  })

  it('rejects machXEndMm just past stockLengthMm + 0.1', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 5, machXEndMm: 100.2 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock length/)
  })
})

// ---------------------------------------------------------------------------
// SECTION G: Mesh radial-extent epsilon + min-diameter hint format
// ---------------------------------------------------------------------------

describe('G. Mesh radial-extent epsilon + hint format', () => {
  it('accepts meshRadialMax = stockRadius (boundary inclusive minus epsilon)', () => {
    const frame: MeshFrameResult = { ...BASE_FRAME, meshRadialMax: 20 }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(true)
  })

  it('accepts meshRadialMax = stockRadius + 0.05 (boundary inclusive)', () => {
    const frame: MeshFrameResult = { ...BASE_FRAME, meshRadialMax: 20.05 }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(true)
  })

  it('rejects meshRadialMax just past stockRadius + 0.05', () => {
    const frame: MeshFrameResult = { ...BASE_FRAME, meshRadialMax: 20.06 }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/past the stock OD/)
      expect(r.hint).toMatch(/Increase rotary stock Ø/)
      // Min-diameter recommendation = 2 * meshRadialMax, formatted to 1 decimal.
      expect(r.hint).toMatch(/40\.1/)
    }
  })

  it('hint min-diameter recommendation rounds to 1 decimal place', () => {
    const frame: MeshFrameResult = { ...BASE_FRAME, meshRadialMax: 25.4789 }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 2 * 25.4789 = 50.9578 -> formatted as "50.96" via toFixed(1) ... wait,
      // toFixed(1) would yield "51.0". Pin actual behavior.
      expect(r.hint).toMatch(/51\.0/)
    }
  })
})

// ---------------------------------------------------------------------------
// SECTION H: Mesh axial bbox dual-branch coverage
//   The validator emits TWO different errors depending on the axial bbox:
//     (1) "does not fit inside stock" -- when bbox extends beyond
//         [-0.5, stockLengthMm + 0.5].
//     (2) "entirely outside stock"    -- when bbox fits the (1) tolerance band
//         but its UPPER bound is < 0 OR its LOWER bound is > stockLengthMm.
//   The original test only exercised (1) (bbox [200, 220] hits both). Pin
//   each branch separately.
// ---------------------------------------------------------------------------

describe('H. Mesh axial bbox dual-branch coverage', () => {
  it('emits "does not fit inside stock" when bbox upper bound is well past stock', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [10, -5, -5], max: [200, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/does not fit inside stock/)
  })

  it('emits "does not fit inside stock" when bbox lower bound is well below 0', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [-10, -5, -5], max: [50, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/does not fit inside stock/)
  })

  it('emits "entirely outside stock" when bbox sits inside the upper tolerance band', () => {
    // bbox in (stockLengthMm, stockLengthMm + 0.5]: passes "does not fit"
    // (because meshMaxX <= 100.5), but fails "entirely outside" (because
    // meshMinX > stockLengthMm).
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [100.3, -5, -5], max: [100.5, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/entirely outside/)
  })

  it('emits "entirely outside stock" when bbox sits inside the lower tolerance band', () => {
    // bbox in [-0.5, 0): passes "does not fit" (meshMinX >= -0.5), fails
    // "entirely outside" (meshMaxX < 0).
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [-0.4, -5, -5], max: [-0.1, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/entirely outside/)
  })
})

// ---------------------------------------------------------------------------
// SECTION I: Soft-warning thresholds
//   These do NOT fail validation; they accumulate in the `warnings` array of
//   the success result. Pin the threshold boundaries explicitly.
// ---------------------------------------------------------------------------

describe('I. Soft-warning thresholds', () => {
  it('emits no overlap-warning when overlap >= 0.5 mm', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [5, -5, -5], max: [5.5, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame, machXStartMm: 5, machXEndMm: 95 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => /barely overlap/.test(w))).toBe(false)
    }
  })

  it('emits overlap-warning when overlap < 0.5 mm (boundary strict)', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [5, -5, -5], max: [5.4, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame, machXStartMm: 5, machXEndMm: 95 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => /barely overlap/.test(w))).toBe(true)
    }
  })

  it('emits no contour-closure warning when gap < 0.5 mm', () => {
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_contour',
        contourPoints: [
          [10, 0],
          [50, 30],
          [10, 0.4]
        ] as ReadonlyArray<readonly [number, number]>
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => /not closed/.test(w))).toBe(false)
    }
  })

  it('emits contour-closure warning when gap > 0.5 mm', () => {
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_contour',
        contourPoints: [
          [10, 0],
          [50, 30],
          [10, 0.6]
        ] as ReadonlyArray<readonly [number, number]>
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => /not closed/.test(w))).toBe(true)
    }
  })

  it('does NOT emit closure warning for 2-point contour (skipped when length < 3)', () => {
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_contour',
        contourPoints: [
          [10, 0],
          [90, 30]
        ] as ReadonlyArray<readonly [number, number]>
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.every((w) => !/not closed/.test(w))).toBe(true)
    }
  })

  it('indexed dup-detection rounds to 2 decimal places (precision pin)', () => {
    // 90.001 rounds to 90.00 (Math.round(9000.1) = 9000); 89.995 rounds to
    // 90.00 (Math.round(8999.5) = 9000 via half-away-from-zero). Both share
    // a key, so 89.995 is reported as a duplicate of 90.001.
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_indexed',
        indexAnglesDeg: [90.001, 89.995]
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => /duplicates/.test(w))).toBe(true)
    }
  })

  it('indexed near-duplicates beyond 2-decimal precision are NOT flagged', () => {
    // 90.0 and 90.011 round to 90.00 and 90.01 respectively -- distinct keys.
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_indexed',
        indexAnglesDeg: [90.0, 90.011]
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.every((w) => !/duplicates/.test(w))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// SECTION J: Indexed-mode aAxisRangeDeg edge cases
//   The check fires only when `aAxisRangeDeg != null && Number.isFinite() && > 0`.
//   Each edge case below pins that the check is correctly skipped or applied.
// ---------------------------------------------------------------------------

describe('J. Indexed-mode aAxisRangeDeg edge cases', () => {
  const indexedBase = {
    operationKind: 'cnc_4axis_indexed' as const,
    indexAnglesDeg: [0, 90, 200] as ReadonlyArray<number>
  }

  it('skips range check when aAxisRangeDeg is undefined (default)', () => {
    const r = validateAxis4Job(ctx(indexedBase))
    expect(r.ok).toBe(true)
  })

  it('skips range check when aAxisRangeDeg is explicitly null', () => {
    // The runtime guard `!= null` rejects both null and undefined; cast for type.
    const r = validateAxis4Job(
      ctx({ ...indexedBase, aAxisRangeDeg: null as unknown as number })
    )
    expect(r.ok).toBe(true)
  })

  it('skips range check when aAxisRangeDeg is 0 (not > 0)', () => {
    const r = validateAxis4Job(ctx({ ...indexedBase, aAxisRangeDeg: 0 }))
    expect(r.ok).toBe(true)
  })

  it('skips range check when aAxisRangeDeg is negative (not > 0)', () => {
    const r = validateAxis4Job(ctx({ ...indexedBase, aAxisRangeDeg: -180 }))
    expect(r.ok).toBe(true)
  })

  it('skips range check when aAxisRangeDeg is NaN', () => {
    const r = validateAxis4Job(ctx({ ...indexedBase, aAxisRangeDeg: NaN }))
    expect(r.ok).toBe(true)
  })

  it('skips range check when aAxisRangeDeg is +Infinity', () => {
    const r = validateAxis4Job(
      ctx({ ...indexedBase, aAxisRangeDeg: Number.POSITIVE_INFINITY })
    )
    expect(r.ok).toBe(true)
  })

  it('applies range check (and rejects) when aAxisRangeDeg = 180 with 200deg request', () => {
    const r = validateAxis4Job(
      ctx({ ...indexedBase, aAxisRangeDeg: 180 })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceed machine A-axis range/)
  })

  it('Carvera continuous-rotary sentinel 99999 admits multi-turn moves', () => {
    const r = validateAxis4Job(
      ctx({
        operationKind: 'cnc_4axis_indexed',
        indexAnglesDeg: [0, 360, 720, -540, 1080],
        aAxisRangeDeg: 99999
      })
    )
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SECTION K: Result-shape pin
//   Pin the exact structural shape of ValidationFailure / ValidationSuccess
//   so callers can rely on TypeScript narrowing AND on runtime field set.
// ---------------------------------------------------------------------------

describe('K. Result-shape pin', () => {
  it('failure result has exactly { ok: false, error: string, hint: string }', () => {
    const r = validateAxis4Job(ctx({ axisCount: 3 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(typeof r.error).toBe('string')
      expect(typeof r.hint).toBe('string')
      expect(r.error.length).toBeGreaterThan(0)
      expect(r.hint.length).toBeGreaterThan(0)
      // No stray fields.
      expect(Object.keys(r).sort()).toEqual(['error', 'hint', 'ok'])
    }
  })

  it('success result has exactly { ok: true, warnings: string[] }', () => {
    const r = validateAxis4Job(ctx())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Array.isArray(r.warnings)).toBe(true)
      expect(Object.keys(r).sort()).toEqual(['ok', 'warnings'])
    }
  })

  it('success.warnings is a fresh array per call (no aliasing across invocations)', () => {
    const r1 = validateAxis4Job(ctx())
    const r2 = validateAxis4Job(ctx())
    expect(r1.ok && r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      // Distinct array references.
      expect(r1.warnings).not.toBe(r2.warnings)
      // Mutating one must not bleed into the other.
      r1.warnings.push('mutation-test')
      expect(r2.warnings).not.toContain('mutation-test')
    }
  })

  it('source-text pin: ValidationFailure / ValidationSuccess have the documented field shape', () => {
    expect(VALIDATION_SOURCE).toMatch(
      /export type ValidationFailure = \{\s*ok: false\s*error: string\s*hint: string\s*\}/m
    )
    expect(VALIDATION_SOURCE).toMatch(
      /export type ValidationSuccess = \{\s*ok: true\s*warnings: string\[\]\s*\}/m
    )
    // ValidationResult is the discriminated union.
    expect(VALIDATION_SOURCE).toMatch(
      /export type ValidationResult = ValidationFailure \| ValidationSuccess/
    )
  })

  it('source-text pin: validateAxis4Job + rank-13 helpers are the public function exports', () => {
    const exports = VALIDATION_SOURCE.match(/^export (function|type|const)\s+\w+/gm) ?? []
    // 4 type exports + 3 function exports (validateAxis4Job + the two rank-13
    // standalone helpers `assertYAxisIsZeroForProfile` and
    // `assertRotaryHeadstockXOffsetSet`) = 7 total.
    expect(exports.filter((e) => e.startsWith('export function')).sort()).toEqual([
      'export function assertRotaryHeadstockXOffsetSet',
      'export function assertYAxisIsZeroForProfile',
      'export function validateAxis4Job'
    ])
  })
})
