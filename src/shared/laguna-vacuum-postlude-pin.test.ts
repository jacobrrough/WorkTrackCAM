/**
 * laguna-vacuum-postlude-pin.test.ts -- [ID-0232] Cycle 159 post-processing paired-pin
 *
 * Pins the contract of `src/shared/laguna-vacuum-postlude.ts` -- the
 * Laguna Swift 5x10 vacuum-zone preamble / postamble line builder
 * ([ID-0020-followup]).
 *
 * LAGUNA-SWIFT-SPECIFIC -- the Laguna Swift 5x10 is the only target
 * machine with a 6-zone vacuum bed; the Creality K2 Plus has a
 * magnetic flexible build plate (no zoned vacuum) and the Makera
 * Carvera + 4th Axis has a T-slot hold-down (no zoned vacuum). The
 * sister kernel `src/shared/laguna-vacuum-allocator.ts` was
 * paired-pinned at Cycle 145 [ID-0218]; THIS file pins the post-side
 * helper that wraps the allocator output into the operator-readable
 * preamble / postamble blocks consumed by a future post-template
 * splice.
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that
 * this pin extends (most-recent first): 158 [ID-0231] /
 * 157 [ID-0230] / 156 [ID-0229] / 155 [ID-0228] / 154 [ID-0227] /
 * 153 [ID-0067-data-v21] / 152 [ID-0224] / 151 [ID-0226] /
 * 150 [ID-0221] / 149 [ID-0220] / 148 [ID-0219] / 147 [ID-0218] /
 * 146 / 145 / 144 / 142 / 140 / 139 / 137 / 136 / 135 / 134 / 132 /
 * 131 / 130 / 129 / 124 / 119.
 *
 * The existing `laguna-vacuum-postlude.test.ts` (~629 lines) covers
 * the runtime BEHAVIOUR of the preamble / postamble builders across
 * happy-path, partial-sheet, defensive-coercion, and M-code-opt-in
 * scenarios. THIS pin file does NOT duplicate that coverage; instead
 * it pins:
 *   (A) module shape -- exact named-export inventory, arities, ESM
 *       namespace Symbol-key invariants, no default export, exact
 *       runtime-key count.
 *   (B) stable marker constant byte-equality + format invariants
 *       (semicolon prefix, ASCII-only, no trailing whitespace).
 *   (C) LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP contract -- frozen,
 *       column-major registry order, P0..P5 dense, 1:1 with
 *       LAGUNA_VACUUM_ZONES, integer-only.
 *   (D) lagunaVacuumZonePNumber contract -- type-guard fallbacks,
 *       null on unknown / empty / non-string.
 *   (E) preamble line-ordering invariants -- always non-empty,
 *       always brackets between OPEN and CLOSE, always-on portions
 *       are semicolon comments only (Safety Rule 1).
 *   (F) postamble line-ordering invariants -- mirrors preamble shape.
 *   (G) wrapLagunaToolpathWithVacuumBlocks structural invariants --
 *       toolpath bytes never mutated; sandwich shape preserved.
 *   (H) Mach3 digital-output opt-in safety -- M64 / M65 emit ONLY
 *       when `enableMach3DigitalOutputs === true` AND there is at
 *       least one engaged zone; warning ALWAYS prefixes any M-code
 *       cluster.
 *   (I) source-text whitelist -- [ID-0020-followup] provenance,
 *       Safety-Rule-1 no-G-code-emit framing, Safety-Rule-2
 *       additive-module framing, no foreign-machine constants
 *       (Bambu / Prusa / Anycubic / Snapmaker / etc.), no
 *       electron / node:fs / node:path / node:child_process imports,
 *       no React / DOM imports, no Handlebars tokens, no `:any` or
 *       `as any` or `<any>` casts.
 *   (J) cross-fleet uniqueness -- the Laguna-only nature of the
 *       module is enforced by the source-text whitelist (no K2 /
 *       Carvera profile names appear in the source).
 *
 * ZERO production-code edits. Pure paired-pin (mirrors prior chain
 * since Cycle 119).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './laguna-vacuum-postlude'
import {
  LAGUNA_VACUUM_PREAMBLE_OPEN,
  LAGUNA_VACUUM_PREAMBLE_CLOSE,
  LAGUNA_VACUUM_POSTAMBLE_OPEN,
  LAGUNA_VACUUM_POSTAMBLE_CLOSE,
  LAGUNA_VACUUM_MCODE_WARNING,
  LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING,
  LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP,
  lagunaVacuumZonePNumber,
  buildLagunaVacuumPreambleLines,
  buildLagunaVacuumPostambleLines,
  wrapLagunaToolpathWithVacuumBlocks
} from './laguna-vacuum-postlude'
import {
  LAGUNA_VACUUM_ZONES,
  allocateLagunaVacuumZones,
  type LagunaVacuumZoneAllocation
} from './laguna-vacuum-allocator'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'laguna-vacuum-postlude.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

// Strip JSDoc + line comments + block comments so source-text negative
// regex assertions only see executable code, not the doc-prose.
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const CODE = codeOnly(SRC)

// ---------------------------------------------------------------------------
// Helper: build a synthetic full-bed allocation deterministically through
// the real allocator so we never hand-roll a structurally-invalid fixture.
// ---------------------------------------------------------------------------
function fullBedAllocation(): LagunaVacuumZoneAllocation {
  return allocateLagunaVacuumZones(0, 0, 1524, 3048)
}

function emptyAllocation(): LagunaVacuumZoneAllocation {
  // Zero-size stock engages NO zones per the allocator contract.
  return allocateLagunaVacuumZones(0, 0, 0, 0)
}

function partialAllocation(): LagunaVacuumZoneAllocation {
  // 600 x 600 sheet at origin engages exactly the back-left zone X0Y0.
  return allocateLagunaVacuumZones(0, 0, 600, 600)
}

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0232] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(
      [
        'LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP',
        'LAGUNA_VACUUM_MCODE_WARNING',
        'LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING',
        'LAGUNA_VACUUM_POSTAMBLE_CLOSE',
        'LAGUNA_VACUUM_POSTAMBLE_OPEN',
        'LAGUNA_VACUUM_PREAMBLE_CLOSE',
        'LAGUNA_VACUUM_PREAMBLE_OPEN',
        'buildLagunaVacuumPostambleLines',
        'buildLagunaVacuumPreambleLines',
        'lagunaVacuumZonePNumber',
        'wrapLagunaToolpathWithVacuumBlocks'
      ].sort()
    )
  })

  it('exposes exactly 11 runtime keys (string + Symbol non-leak guard)', () => {
    const stringKeys = Object.keys(M)
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(stringKeys.length).toBe(11)
    // Vitest / esbuild stamps the namespace with Symbol.toStringTag only.
    expect(symbolKeys.length).toBeLessThanOrEqual(1)
    if (symbolKeys.length === 1) {
      expect(symbolKeys[0]).toBe(Symbol.toStringTag)
      expect((M as unknown as Record<symbol, string>)[Symbol.toStringTag]).toBe(
        'Module'
      )
    }
  })

  it('module namespace has null prototype (esbuild ESM convention)', () => {
    expect(Object.getPrototypeOf(M)).toBe(null)
  })

  it('exposes no default export', () => {
    expect((M as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('lagunaVacuumZonePNumber arity is 1', () => {
    expect(lagunaVacuumZonePNumber.length).toBe(1)
  })

  it('buildLagunaVacuumPreambleLines arity is 1 (options optional)', () => {
    // Required positional params only -- options has a default.
    expect(buildLagunaVacuumPreambleLines.length).toBe(1)
  })

  it('buildLagunaVacuumPostambleLines arity is 1 (options optional)', () => {
    expect(buildLagunaVacuumPostambleLines.length).toBe(1)
  })

  it('wrapLagunaToolpathWithVacuumBlocks arity is 2 (options optional)', () => {
    expect(wrapLagunaToolpathWithVacuumBlocks.length).toBe(2)
  })

  it('exactly 4 functions exported (lookup + 2 builders + 1 wrapper)', () => {
    const funcs = Object.values(M).filter((v) => typeof v === 'function')
    expect(funcs.length).toBe(4)
  })

  it('exactly 6 string-marker exports', () => {
    const strings = Object.values(M).filter((v) => typeof v === 'string')
    expect(strings.length).toBe(6)
  })

  it('exactly 1 object export (the frozen P-number map)', () => {
    const objects = Object.values(M).filter(
      (v) => typeof v === 'object' && v !== null
    )
    expect(objects.length).toBe(1)
    expect(objects[0]).toBe(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP)
  })
})

// ---------------------------------------------------------------------------
// B) Stable marker constants -- byte equality + format invariants
// ---------------------------------------------------------------------------

describe('[ID-0232] B) marker constants', () => {
  it('PREAMBLE_OPEN byte-equal', () => {
    expect(LAGUNA_VACUUM_PREAMBLE_OPEN).toBe(
      '; --- Laguna Swift 5x10 vacuum zone allocation ---'
    )
  })

  it('PREAMBLE_CLOSE byte-equal', () => {
    expect(LAGUNA_VACUUM_PREAMBLE_CLOSE).toBe(
      '; --- end vacuum zone allocation ---'
    )
  })

  it('POSTAMBLE_OPEN byte-equal', () => {
    expect(LAGUNA_VACUUM_POSTAMBLE_OPEN).toBe(
      '; --- Laguna Swift 5x10 vacuum zone release ---'
    )
  })

  it('POSTAMBLE_CLOSE byte-equal', () => {
    expect(LAGUNA_VACUUM_POSTAMBLE_CLOSE).toBe(
      '; --- end vacuum zone release ---'
    )
  })

  it('MCODE_WARNING byte-equal', () => {
    expect(LAGUNA_VACUUM_MCODE_WARNING).toBe(
      '; OPERATOR: confirm wiring before running -- M64/M65 fire digital outputs'
    )
  })

  it('OUTSIDE_ENVELOPE_WARNING byte-equal', () => {
    expect(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING).toBe(
      '; WARNING: stock extends past bed envelope -- verify clamps before cycle start'
    )
  })

  it('every marker constant starts with a semicolon (Mach3 strips comments)', () => {
    const markers = [
      LAGUNA_VACUUM_PREAMBLE_OPEN,
      LAGUNA_VACUUM_PREAMBLE_CLOSE,
      LAGUNA_VACUUM_POSTAMBLE_OPEN,
      LAGUNA_VACUUM_POSTAMBLE_CLOSE,
      LAGUNA_VACUUM_MCODE_WARNING,
      LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING
    ]
    for (const marker of markers) {
      expect(marker.startsWith(';')).toBe(true)
    }
  })

  it('every marker constant is ASCII-only (RichAuto controllers are byte-fragile)', () => {
    const asciiOnly = /^[\x20-\x7E]+$/
    expect(asciiOnly.test(LAGUNA_VACUUM_PREAMBLE_OPEN)).toBe(true)
    expect(asciiOnly.test(LAGUNA_VACUUM_PREAMBLE_CLOSE)).toBe(true)
    expect(asciiOnly.test(LAGUNA_VACUUM_POSTAMBLE_OPEN)).toBe(true)
    expect(asciiOnly.test(LAGUNA_VACUUM_POSTAMBLE_CLOSE)).toBe(true)
    expect(asciiOnly.test(LAGUNA_VACUUM_MCODE_WARNING)).toBe(true)
    expect(asciiOnly.test(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)).toBe(true)
  })

  it('every marker constant has no trailing whitespace', () => {
    const trailing = /\s+$/
    expect(trailing.test(LAGUNA_VACUUM_PREAMBLE_OPEN)).toBe(false)
    expect(trailing.test(LAGUNA_VACUUM_PREAMBLE_CLOSE)).toBe(false)
    expect(trailing.test(LAGUNA_VACUUM_POSTAMBLE_OPEN)).toBe(false)
    expect(trailing.test(LAGUNA_VACUUM_POSTAMBLE_CLOSE)).toBe(false)
    expect(trailing.test(LAGUNA_VACUUM_MCODE_WARNING)).toBe(false)
    expect(trailing.test(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)).toBe(false)
  })

  it('every marker constant contains no embedded newline', () => {
    const markers = [
      LAGUNA_VACUUM_PREAMBLE_OPEN,
      LAGUNA_VACUUM_PREAMBLE_CLOSE,
      LAGUNA_VACUUM_POSTAMBLE_OPEN,
      LAGUNA_VACUUM_POSTAMBLE_CLOSE,
      LAGUNA_VACUUM_MCODE_WARNING,
      LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING
    ]
    for (const marker of markers) {
      expect(marker.includes('\n')).toBe(false)
      expect(marker.includes('\r')).toBe(false)
    }
  })

  it('PREAMBLE / POSTAMBLE marker pairs share the "end" close-tag prefix', () => {
    // Future drift would be a pair where OPEN and CLOSE no longer match
    // structurally. Pin asserts close starts with "; --- end ".
    expect(LAGUNA_VACUUM_PREAMBLE_CLOSE.startsWith('; --- end ')).toBe(true)
    expect(LAGUNA_VACUUM_POSTAMBLE_CLOSE.startsWith('; --- end ')).toBe(true)
  })

  it('PREAMBLE_OPEN names "Laguna Swift 5x10" exactly (no other target machines)', () => {
    expect(LAGUNA_VACUUM_PREAMBLE_OPEN).toContain('Laguna Swift 5x10')
    // Negative cross-fleet checks: the K2 Plus + Carvera names MUST NOT
    // appear in the marker (Laguna-specific module).
    expect(LAGUNA_VACUUM_PREAMBLE_OPEN).not.toMatch(/K2 Plus|Carvera|Creality|Makera/)
  })

  it('POSTAMBLE_OPEN names "Laguna Swift 5x10" exactly (no other target machines)', () => {
    expect(LAGUNA_VACUUM_POSTAMBLE_OPEN).toContain('Laguna Swift 5x10')
    expect(LAGUNA_VACUUM_POSTAMBLE_OPEN).not.toMatch(
      /K2 Plus|Carvera|Creality|Makera/
    )
  })
})

// ---------------------------------------------------------------------------
// C) LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP -- frozen, column-major, dense
// ---------------------------------------------------------------------------

describe('[ID-0232] C) LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP', () => {
  it('has exactly 6 keys (one per zone)', () => {
    expect(Object.keys(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP).length).toBe(6)
  })

  it('keys match LAGUNA_VACUUM_ZONES registry ids exactly', () => {
    const mapKeys = Object.keys(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP).sort()
    const zoneIds = LAGUNA_VACUUM_ZONES.map((z) => z.id).sort()
    expect(mapKeys).toEqual(zoneIds)
  })

  it('values form the dense 0..5 range', () => {
    const values = Object.values(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP).sort(
      (a, b) => a - b
    )
    expect(values).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('column-major P-number map matches the documented JSDoc table', () => {
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X0Y0']).toBe(0)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X0Y1']).toBe(1)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X0Y2']).toBe(2)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X1Y0']).toBe(3)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X1Y1']).toBe(4)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X1Y2']).toBe(5)
  })

  it('every value is a non-negative integer', () => {
    for (const v of Object.values(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP)) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('map P-number for zone N matches that zone\'s registry index', () => {
    LAGUNA_VACUUM_ZONES.forEach((zone, index) => {
      expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[zone.id]).toBe(index)
    })
  })

  it('map is frozen (Object.freeze invariant)', () => {
    expect(Object.isFrozen(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP)).toBe(true)
  })

  it('attempting to mutate the map throws in strict mode', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP as Record<string, number>)['X0Y0'] = 99
    }).toThrow()
  })

  it('attempting to add a new key to the map throws in strict mode', () => {
    expect(() => {
      ;(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP as Record<string, number>)['X9Y9'] = 9
    }).toThrow()
  })

  it('values are unique (no two zones share a P-number)', () => {
    const values = Object.values(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP)
    expect(new Set(values).size).toBe(values.length)
  })
})

// ---------------------------------------------------------------------------
// D) lagunaVacuumZonePNumber lookup contract
// ---------------------------------------------------------------------------

describe('[ID-0232] D) lagunaVacuumZonePNumber', () => {
  it('returns the correct P-number for every known zone id', () => {
    expect(lagunaVacuumZonePNumber('X0Y0')).toBe(0)
    expect(lagunaVacuumZonePNumber('X0Y1')).toBe(1)
    expect(lagunaVacuumZonePNumber('X0Y2')).toBe(2)
    expect(lagunaVacuumZonePNumber('X1Y0')).toBe(3)
    expect(lagunaVacuumZonePNumber('X1Y1')).toBe(4)
    expect(lagunaVacuumZonePNumber('X1Y2')).toBe(5)
  })

  it('returns null for unknown zone id strings (not undefined, not NaN)', () => {
    expect(lagunaVacuumZonePNumber('X9Y9')).toBe(null)
    expect(lagunaVacuumZonePNumber('Zone1')).toBe(null)
    expect(lagunaVacuumZonePNumber('x0y0')).toBe(null) // lowercase rejected
  })

  it('returns null for empty string (defensive)', () => {
    expect(lagunaVacuumZonePNumber('')).toBe(null)
  })

  it('returns null for non-string inputs (defensive type guard)', () => {
    // The signature is string-typed but the runtime guard exists for
    // belt-and-braces safety. Cast via `unknown` to exercise the guard
    // without `any`.
    const lookup = lagunaVacuumZonePNumber as unknown as (
      v: unknown
    ) => number | null
    expect(lookup(null)).toBe(null)
    expect(lookup(undefined)).toBe(null)
    expect(lookup(0)).toBe(null)
    expect(lookup({})).toBe(null)
    expect(lookup([])).toBe(null)
  })

  it('result is one of {null, 0, 1, 2, 3, 4, 5}', () => {
    const ids = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    for (const id of ids) {
      const p = lagunaVacuumZonePNumber(id)
      expect([0, 1, 2, 3, 4, 5]).toContain(p)
    }
  })

  it('idempotent: same input -> same output across N=10 invocations', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(lagunaVacuumZonePNumber('X1Y1')).toBe(4)
      expect(lagunaVacuumZonePNumber('Z9Z9')).toBe(null)
    }
  })
})

// ---------------------------------------------------------------------------
// E) buildLagunaVacuumPreambleLines line ordering + content
// ---------------------------------------------------------------------------

describe('[ID-0232] E) buildLagunaVacuumPreambleLines', () => {
  it('always produces a non-empty array', () => {
    expect(buildLagunaVacuumPreambleLines(emptyAllocation()).length).toBeGreaterThan(
      0
    )
    expect(
      buildLagunaVacuumPreambleLines(fullBedAllocation()).length
    ).toBeGreaterThan(0)
  })

  it('first line is always the open marker', () => {
    expect(buildLagunaVacuumPreambleLines(fullBedAllocation())[0]).toBe(
      LAGUNA_VACUUM_PREAMBLE_OPEN
    )
  })

  it('last line is always the close marker', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation())
    expect(lines[lines.length - 1]).toBe(LAGUNA_VACUUM_PREAMBLE_CLOSE)
  })

  it('default options emit ZERO M-codes (Safety: comments only)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation())
    for (const line of lines) {
      expect(line.startsWith('M64')).toBe(false)
      expect(line.startsWith('M65')).toBe(false)
    }
  })

  it('every default-options line is a comment (starts with semicolon)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation())
    for (const line of lines) {
      expect(line.startsWith(';')).toBe(true)
    }
  })

  it('engagement summary "N of 6 zones engaged" appears verbatim', () => {
    const full = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const empty = buildLagunaVacuumPreambleLines(emptyAllocation())
    expect(full.some((l) => l.includes('6 of 6 zones engaged'))).toBe(true)
    expect(empty.some((l) => l.includes('0 of 6 zones engaged'))).toBe(true)
  })

  it('coverage % uses exactly one decimal place (byte-stable width)', () => {
    const full = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const summary = full.find((l) => l.includes('zones engaged'))
    expect(summary).toBeDefined()
    expect(summary!).toMatch(/\d+\.\d% bed coverage/)
    // No two-or-more decimal places.
    expect(summary!).not.toMatch(/\d+\.\d{2,}/)
  })

  it('engaged-zones line lists every engaged id (full bed -> all 6 ids)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const engagedLine = lines.find((l) => l.startsWith('; Engaged zones:'))
    expect(engagedLine).toBeDefined()
    for (const zone of LAGUNA_VACUUM_ZONES) {
      expect(engagedLine!).toContain(zone.id)
    }
  })

  it('engaged-zones line shows "(none)" sentinel when no zones engaged', () => {
    const lines = buildLagunaVacuumPreambleLines(emptyAllocation())
    const engagedLine = lines.find((l) => l.startsWith('; Engaged zones:'))
    expect(engagedLine).toBe('; Engaged zones: (none)')
  })

  it('idle-zones line shows "(none)" sentinel when full bed engaged', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const idleLine = lines.find((l) => l.startsWith('; Idle zones:'))
    expect(idleLine).toBe('; Idle zones:    (none)')
  })

  it('idle-zones line lists every idle id when no zones engaged', () => {
    const lines = buildLagunaVacuumPreambleLines(emptyAllocation())
    const idleLine = lines.find((l) => l.startsWith('; Idle zones:'))
    expect(idleLine).toBeDefined()
    for (const zone of LAGUNA_VACUUM_ZONES) {
      expect(idleLine!).toContain(zone.id)
    }
  })

  it('outside-envelope warning emitted only when allocation flag is true', () => {
    // Construct an allocation that overhangs the bed envelope.
    const overhang = allocateLagunaVacuumZones(0, 0, 2000, 4000)
    const linesOver = buildLagunaVacuumPreambleLines(overhang)
    expect(
      linesOver.some((l) => l === LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)
    ).toBe(true)
    // Full-bed allocation does NOT overhang.
    const linesFull = buildLagunaVacuumPreambleLines(fullBedAllocation())
    expect(
      linesFull.some((l) => l === LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)
    ).toBe(false)
  })

  it('always emits the operator-confirm hint exactly once', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const hits = lines.filter((l) =>
      l.includes('confirm vacuum zones engaged on panel before cycle start')
    )
    expect(hits.length).toBe(1)
  })

  it('returns a fresh array on each invocation', () => {
    const a = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const b = buildLagunaVacuumPreambleLines(fullBedAllocation())
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('byte-stable: same allocation -> same output across N=10 invocations', () => {
    const baseline = buildLagunaVacuumPreambleLines(fullBedAllocation())
    for (let i = 0; i < 10; i += 1) {
      expect(buildLagunaVacuumPreambleLines(fullBedAllocation())).toEqual(
        baseline
      )
    }
  })
})

// ---------------------------------------------------------------------------
// F) buildLagunaVacuumPostambleLines line ordering + content
// ---------------------------------------------------------------------------

describe('[ID-0232] F) buildLagunaVacuumPostambleLines', () => {
  it('always produces a non-empty array', () => {
    expect(
      buildLagunaVacuumPostambleLines(emptyAllocation()).length
    ).toBeGreaterThan(0)
    expect(
      buildLagunaVacuumPostambleLines(fullBedAllocation()).length
    ).toBeGreaterThan(0)
  })

  it('first line is always the postamble open marker', () => {
    expect(buildLagunaVacuumPostambleLines(fullBedAllocation())[0]).toBe(
      LAGUNA_VACUUM_POSTAMBLE_OPEN
    )
  })

  it('last line is always the postamble close marker', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation())
    expect(lines[lines.length - 1]).toBe(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
  })

  it('default options emit ZERO M-codes (Safety: comments only)', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation())
    for (const line of lines) {
      expect(line.startsWith('M64')).toBe(false)
      expect(line.startsWith('M65')).toBe(false)
    }
  })

  it('every default-options line is a comment', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation())
    for (const line of lines) {
      expect(line.startsWith(';')).toBe(true)
    }
  })

  it('release summary "Releasing N zone(s)" appears verbatim', () => {
    const full = buildLagunaVacuumPostambleLines(fullBedAllocation())
    const empty = buildLagunaVacuumPostambleLines(emptyAllocation())
    expect(full.some((l) => l === '; Releasing 6 zone(s)')).toBe(true)
    expect(empty.some((l) => l === '; Releasing 0 zone(s)')).toBe(true)
  })

  it('returns a fresh array on each invocation', () => {
    const a = buildLagunaVacuumPostambleLines(fullBedAllocation())
    const b = buildLagunaVacuumPostambleLines(fullBedAllocation())
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// G) wrapLagunaToolpathWithVacuumBlocks structural invariants
// ---------------------------------------------------------------------------

describe('[ID-0232] G) wrapLagunaToolpathWithVacuumBlocks', () => {
  const TOOLPATH_FIXTURE = [
    'G21',
    'G90',
    'G0 X0 Y0 Z5',
    'G1 X100 Y100 F1500',
    'G0 Z25',
    'M2'
  ]

  it('output starts with preamble open marker', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation()
    )
    expect(wrapped[0]).toBe(LAGUNA_VACUUM_PREAMBLE_OPEN)
  })

  it('output ends with postamble close marker', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation()
    )
    expect(wrapped[wrapped.length - 1]).toBe(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
  })

  it('toolpath bytes appear in the middle slice, byte-identical', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation()
    )
    const preamble = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const postamble = buildLagunaVacuumPostambleLines(fullBedAllocation())
    const middle = wrapped.slice(preamble.length, wrapped.length - postamble.length)
    expect(middle).toEqual(TOOLPATH_FIXTURE)
  })

  it('original toolpath array is not mutated', () => {
    const original = [...TOOLPATH_FIXTURE]
    wrapLagunaToolpathWithVacuumBlocks(TOOLPATH_FIXTURE, fullBedAllocation())
    expect(TOOLPATH_FIXTURE).toEqual(original)
  })

  it('total length === preamble + toolpath + postamble', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation()
    )
    const preamble = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const postamble = buildLagunaVacuumPostambleLines(fullBedAllocation())
    expect(wrapped.length).toBe(
      preamble.length + TOOLPATH_FIXTURE.length + postamble.length
    )
  })

  it('passes options through to BOTH preamble and postamble', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation(),
      { enableMach3DigitalOutputs: true }
    )
    const m64s = wrapped.filter((l) => l.startsWith('M64'))
    const m65s = wrapped.filter((l) => l.startsWith('M65'))
    expect(m64s.length).toBe(6)
    expect(m65s.length).toBe(6)
  })

  it('readonly toolpath input is accepted (TS readonly contract)', () => {
    const ro: readonly string[] = ['G21', 'M2']
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(ro, fullBedAllocation())
    expect(wrapped.length).toBeGreaterThan(2)
  })

  it('empty toolpath -> sandwich is preamble + postamble back-to-back', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks([], fullBedAllocation())
    const preamble = buildLagunaVacuumPreambleLines(fullBedAllocation())
    const postamble = buildLagunaVacuumPostambleLines(fullBedAllocation())
    expect(wrapped.length).toBe(preamble.length + postamble.length)
  })

  it('returns a fresh array on each invocation', () => {
    const a = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation()
    )
    const b = wrapLagunaToolpathWithVacuumBlocks(
      TOOLPATH_FIXTURE,
      fullBedAllocation()
    )
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// H) Mach3 digital-output opt-in safety
// ---------------------------------------------------------------------------

describe('[ID-0232] H) Mach3 digital-output opt-in safety', () => {
  it('enableMach3DigitalOutputs:false suppresses M-codes (preamble)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: false
    })
    expect(lines.some((l) => l.startsWith('M64'))).toBe(false)
    expect(lines.some((l) => l.startsWith('M65'))).toBe(false)
  })

  it('enableMach3DigitalOutputs:false suppresses M-codes (postamble)', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: false
    })
    expect(lines.some((l) => l.startsWith('M64'))).toBe(false)
    expect(lines.some((l) => l.startsWith('M65'))).toBe(false)
  })

  it('enableMach3DigitalOutputs:true emits exactly N M64 lines (one per engaged zone)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const m64 = lines.filter((l) => l.startsWith('M64'))
    expect(m64.length).toBe(6)
  })

  it('enableMach3DigitalOutputs:true emits exactly N M65 lines (one per engaged zone)', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const m65 = lines.filter((l) => l.startsWith('M65'))
    expect(m65.length).toBe(6)
  })

  it('zero engaged zones -> zero M-codes even when enabled (preamble)', () => {
    const lines = buildLagunaVacuumPreambleLines(emptyAllocation(), {
      enableMach3DigitalOutputs: true
    })
    expect(lines.some((l) => l.startsWith('M64'))).toBe(false)
    expect(lines.some((l) => l.startsWith('M65'))).toBe(false)
  })

  it('zero engaged zones -> zero M-codes even when enabled (postamble)', () => {
    const lines = buildLagunaVacuumPostambleLines(emptyAllocation(), {
      enableMach3DigitalOutputs: true
    })
    expect(lines.some((l) => l.startsWith('M64'))).toBe(false)
    expect(lines.some((l) => l.startsWith('M65'))).toBe(false)
  })

  it('zero engaged zones -> NO M-code warning emitted (preamble; nothing to warn about)', () => {
    const lines = buildLagunaVacuumPreambleLines(emptyAllocation(), {
      enableMach3DigitalOutputs: true
    })
    expect(lines.some((l) => l === LAGUNA_VACUUM_MCODE_WARNING)).toBe(false)
  })

  it('M-code warning appears EXACTLY ONCE when M-codes are emitted (preamble)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const warns = lines.filter((l) => l === LAGUNA_VACUUM_MCODE_WARNING)
    expect(warns.length).toBe(1)
  })

  it('M-code warning appears EXACTLY ONCE when M-codes are emitted (postamble)', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const warns = lines.filter((l) => l === LAGUNA_VACUUM_MCODE_WARNING)
    expect(warns.length).toBe(1)
  })

  it('warning appears BEFORE the first M-code (preamble)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const warnIndex = lines.indexOf(LAGUNA_VACUUM_MCODE_WARNING)
    const firstM64 = lines.findIndex((l) => l.startsWith('M64'))
    expect(warnIndex).toBeGreaterThanOrEqual(0)
    expect(firstM64).toBeGreaterThan(warnIndex)
  })

  it('warning appears BEFORE the first M-code (postamble)', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const warnIndex = lines.indexOf(LAGUNA_VACUUM_MCODE_WARNING)
    const firstM65 = lines.findIndex((l) => l.startsWith('M65'))
    expect(warnIndex).toBeGreaterThanOrEqual(0)
    expect(firstM65).toBeGreaterThan(warnIndex)
  })

  it('M64 P-numbers in registry order (preamble) match the digital-output map', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const m64 = lines.filter((l) => l.startsWith('M64'))
    // Engaged in registry order -> P0..P5.
    m64.forEach((line, index) => {
      expect(line).toMatch(new RegExp(`^M64 P${index}\\b`))
    })
  })

  it('M65 P-numbers in registry order (postamble) match the digital-output map', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const m65 = lines.filter((l) => l.startsWith('M65'))
    m65.forEach((line, index) => {
      expect(line).toMatch(new RegExp(`^M65 P${index}\\b`))
    })
  })

  it('partial allocation emits M-codes only for engaged zones', () => {
    const partial = partialAllocation()
    const lines = buildLagunaVacuumPreambleLines(partial, {
      enableMach3DigitalOutputs: true
    })
    const m64 = lines.filter((l) => l.startsWith('M64'))
    expect(m64.length).toBe(partial.engagedCount)
    expect(m64.length).toBeGreaterThan(0)
    expect(m64.length).toBeLessThan(6)
  })

  it('M-codes carry the trailing "engage <zoneId>" comment (preamble)', () => {
    const lines = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    for (const line of lines.filter((l) => l.startsWith('M64'))) {
      expect(line).toMatch(/; engage X\dY\d$/)
    }
  })

  it('M-codes carry the trailing "release <zoneId>" comment (postamble)', () => {
    const lines = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    for (const line of lines.filter((l) => l.startsWith('M65'))) {
      expect(line).toMatch(/; release X\dY\d$/)
    }
  })
})

// ---------------------------------------------------------------------------
// I) Source-text whitelist (Safety Rule 1, no foreign machines, etc.)
// ---------------------------------------------------------------------------

describe('[ID-0232] I) source-text whitelist', () => {
  it('cites the [ID-0020-followup] tracking provenance', () => {
    expect(SRC).toContain('[ID-0020-followup]')
  })

  it('cites Safety Rule 1 (G-code is sacred) framing', () => {
    expect(SRC).toContain('Safety Rule 1')
    expect(SRC).toMatch(/G-code is sacred/)
  })

  it('cites Safety Rule 2 (additive module / no schema migration)', () => {
    expect(SRC).toContain('Safety Rule 2')
    expect(SRC).toMatch(/ADDITIVE module/)
  })

  it('imports type-only LagunaVacuumZoneAllocation from the sister allocator', () => {
    expect(CODE).toMatch(/import\s+type\s*\{\s*LagunaVacuumZoneAllocation\s*\}/)
  })

  it('imports value LAGUNA_VACUUM_ZONES from the sister allocator', () => {
    expect(CODE).toMatch(/import\s*\{\s*LAGUNA_VACUUM_ZONES\s*\}/)
  })

  it('exactly 4 export functions in the source (regex code-only)', () => {
    const matches = CODE.match(/export\s+function\s+/g) ?? []
    expect(matches.length).toBe(4)
  })

  it('exactly 7 export consts in the source (6 strings + 1 frozen Record)', () => {
    const matches = CODE.match(/export\s+const\s+/g) ?? []
    expect(matches.length).toBe(7)
  })

  it('exactly 1 export interface (LagunaVacuumPostludeOptions)', () => {
    const matches = CODE.match(/export\s+interface\s+/g) ?? []
    expect(matches.length).toBe(1)
    expect(CODE).toContain('LagunaVacuumPostludeOptions')
  })

  it('no default export', () => {
    expect(CODE).not.toMatch(/export\s+default/)
  })

  it('no top-level `let` (codeOnly)', () => {
    // Match top-of-line `let` only (no leading whitespace) -- locals
    // inside functions are indented in this codebase\'s ESLint config.
    expect(CODE).not.toMatch(/^let\s/m)
  })

  it('no top-level `var` (codeOnly)', () => {
    expect(CODE).not.toMatch(/^var\s/m)
  })

  it('no `:any` type annotations (codeOnly)', () => {
    expect(CODE).not.toMatch(/:\s*any\b/)
  })

  it('no `as any` casts (codeOnly)', () => {
    expect(CODE).not.toMatch(/\bas\s+any\b/)
  })

  it('no `<any>` casts (codeOnly)', () => {
    expect(CODE).not.toMatch(/<any>/)
  })

  it('no electron / node:fs / node:path / node:child_process imports (Safety: pure helper)', () => {
    expect(CODE).not.toMatch(/from\s+['"]electron['"]/)
    expect(CODE).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(CODE).not.toMatch(/from\s+['"]fs['"]/)
    expect(CODE).not.toMatch(/from\s+['"]node:path['"]/)
    expect(CODE).not.toMatch(/from\s+['"]path['"]/)
    expect(CODE).not.toMatch(/from\s+['"]node:child_process['"]/)
    expect(CODE).not.toMatch(/from\s+['"]child_process['"]/)
  })

  it('no React / DOM / Three.js imports (Safety: pure helper, no UI)', () => {
    expect(CODE).not.toMatch(/from\s+['"]react['"]/)
    expect(CODE).not.toMatch(/from\s+['"]react-dom['"]/)
    expect(CODE).not.toMatch(/from\s+['"]three['"]/)
    expect(CODE).not.toMatch(/\bdocument\./)
    expect(CODE).not.toMatch(/\bwindow\./)
  })

  it('no Handlebars tokens (codeOnly) -- this module is NOT a post template', () => {
    // {{ }} would be Handlebars; this is a TS module.
    expect(CODE).not.toMatch(/\{\{/)
    expect(CODE).not.toMatch(/\}\}/)
  })

  it('no Handlebars or post-template imports (codeOnly)', () => {
    expect(CODE).not.toMatch(/from\s+['"]handlebars['"]/)
    expect(CODE).not.toMatch(/post-process(?!-)/)
  })

  it('no foreign-machine vendor names (Bambu, Prusa, Anycubic, Snapmaker, etc.)', () => {
    const foreignVendors =
      /\b(Bambu|Prusa|Anycubic|Snapmaker|Voron|Ultimaker|Markforged|Tormach|Haas|Fanuc|Mazak|DMG|DMU|Pocket\s*NC|Onefinity|Shapeoko|X-Carve)\b/i
    expect(CODE).not.toMatch(foreignVendors)
  })

  it('NO Creality / K2 Plus references in source code (Laguna-only module)', () => {
    expect(CODE).not.toMatch(/\bCreality\b/)
    expect(CODE).not.toMatch(/\bK2\s*Plus\b/)
  })

  it('NO Makera / Carvera references in source code (Laguna-only module)', () => {
    expect(CODE).not.toMatch(/\bMakera\b/)
    expect(CODE).not.toMatch(/\bCarvera\b/)
  })

  it('JSDoc names "Laguna Swift 5x10" exactly (target machine cite)', () => {
    expect(SRC).toContain('Laguna Swift 5x10')
  })

  it('JSDoc cites RichAuto A-series controller compatibility', () => {
    expect(SRC).toContain('RichAuto A-series')
  })

  it('JSDoc cites Mach3 digital-output convention M64 / M65', () => {
    expect(SRC).toContain('M64')
    expect(SRC).toContain('M65')
  })

  it('JSDoc spells out the column-major P-number table for the operator', () => {
    expect(SRC).toContain('X0Y0 -> P0')
    expect(SRC).toContain('X1Y2 -> P5')
  })

  it('JSDoc warns about wiring verification before opt-in', () => {
    expect(SRC).toMatch(/multimeter|control-panel|verify/i)
  })

  it('JSDoc cites the off-by-default M-code emission policy', () => {
    expect(SRC).toMatch(/[Oo]ff by default|OFF by default|Default:\s*false/)
  })

  it('source emits NO toolpath G-code (Safety Rule 1) -- no G0/G1/G17/G18/G19/G20/G21/G54-G59/G90/G91 motion in source', () => {
    // Only the test fixture should contain G-words; the production source
    // must not. Codeonly guards comments / JSDoc.
    expect(CODE).not.toMatch(/\bG0\b/)
    expect(CODE).not.toMatch(/\bG1\b/)
    expect(CODE).not.toMatch(/\bG17\b/)
    expect(CODE).not.toMatch(/\bG18\b/)
    expect(CODE).not.toMatch(/\bG19\b/)
    expect(CODE).not.toMatch(/\bG20\b/)
    expect(CODE).not.toMatch(/\bG21\b/)
    expect(CODE).not.toMatch(/\bG54\b/)
    expect(CODE).not.toMatch(/\bG55\b/)
    expect(CODE).not.toMatch(/\bG56\b/)
    expect(CODE).not.toMatch(/\bG57\b/)
    expect(CODE).not.toMatch(/\bG58\b/)
    expect(CODE).not.toMatch(/\bG59\b/)
    expect(CODE).not.toMatch(/\bG90\b/)
    expect(CODE).not.toMatch(/\bG91\b/)
  })

  it('source uses M64/M65 ONLY in template literals (digital-output emission, not toolpath M-codes)', () => {
    // M3 / M5 / M6 / M30 are toolpath M-codes that must NOT appear.
    expect(CODE).not.toMatch(/\bM3\b/)
    expect(CODE).not.toMatch(/\bM4\b/)
    expect(CODE).not.toMatch(/\bM5\b/)
    expect(CODE).not.toMatch(/\bM6\b/)
    expect(CODE).not.toMatch(/\bM30\b/)
    // M64 + M65 ARE allowed (digital-output convention pinned in section H).
    expect(CODE).toMatch(/M64\s+P/)
    expect(CODE).toMatch(/M65\s+P/)
  })

  it('source size is under 300 lines', () => {
    expect(SRC.split('\n').length).toBeLessThan(300)
  })

  it('source size is under 12 KB', () => {
    expect(SRC.length).toBeLessThan(12 * 1024)
  })

  it('JSDoc explicitly names [ID-0014b] sister allocator + [ID-0020] sister UI helper', () => {
    expect(SRC).toContain('[ID-0014b]')
    expect(SRC).toContain('[ID-0020]')
  })

  it('JSDoc explicitly states "PRIMARY = Laguna Swift 5x10" + "UNAFFECTED = Creality K2 Plus / Makera Carvera"', () => {
    expect(SRC).toContain('PRIMARY')
    expect(SRC).toContain('Laguna Swift 5x10')
    expect(SRC).toContain('UNAFFECTED')
    expect(SRC).toContain('Creality K2 Plus')
    expect(SRC).toContain('Makera Carvera')
  })
})

// ---------------------------------------------------------------------------
// J) Cross-helper invariants
// ---------------------------------------------------------------------------

describe('[ID-0232] J) cross-helper invariants', () => {
  it('preamble + postamble share the M-code warning constant exactly', () => {
    const pre = buildLagunaVacuumPreambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    const post = buildLagunaVacuumPostambleLines(fullBedAllocation(), {
      enableMach3DigitalOutputs: true
    })
    expect(pre.find((l) => l === LAGUNA_VACUUM_MCODE_WARNING)).toBe(
      post.find((l) => l === LAGUNA_VACUUM_MCODE_WARNING)
    )
  })

  it('preamble M64 count === postamble M65 count for any allocation', () => {
    for (const alloc of [
      emptyAllocation(),
      partialAllocation(),
      fullBedAllocation()
    ]) {
      const pre = buildLagunaVacuumPreambleLines(alloc, {
        enableMach3DigitalOutputs: true
      })
      const post = buildLagunaVacuumPostambleLines(alloc, {
        enableMach3DigitalOutputs: true
      })
      const m64 = pre.filter((l) => l.startsWith('M64')).length
      const m65 = post.filter((l) => l.startsWith('M65')).length
      expect(m64).toBe(m65)
    }
  })

  it('lookup map and lookup function agree for every registered zone id', () => {
    for (const zone of LAGUNA_VACUUM_ZONES) {
      expect(lagunaVacuumZonePNumber(zone.id)).toBe(
        LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[zone.id]
      )
    }
  })

  it('wrap output never contains a duplicate preamble OR postamble open marker', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      ['G21'],
      fullBedAllocation()
    )
    expect(
      wrapped.filter((l) => l === LAGUNA_VACUUM_PREAMBLE_OPEN).length
    ).toBe(1)
    expect(
      wrapped.filter((l) => l === LAGUNA_VACUUM_POSTAMBLE_OPEN).length
    ).toBe(1)
    expect(
      wrapped.filter((l) => l === LAGUNA_VACUUM_PREAMBLE_CLOSE).length
    ).toBe(1)
    expect(
      wrapped.filter((l) => l === LAGUNA_VACUUM_POSTAMBLE_CLOSE).length
    ).toBe(1)
  })

  it('wrap output preamble appears strictly before postamble (sandwich invariant)', () => {
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      ['G21'],
      fullBedAllocation()
    )
    const preIdx = wrapped.indexOf(LAGUNA_VACUUM_PREAMBLE_OPEN)
    const postIdx = wrapped.indexOf(LAGUNA_VACUUM_POSTAMBLE_OPEN)
    expect(preIdx).toBeLessThan(postIdx)
  })

  it('options object is not mutated by the helpers (defensive non-mutation)', () => {
    const opts = { enableMach3DigitalOutputs: true } as const
    const before = { ...opts }
    buildLagunaVacuumPreambleLines(fullBedAllocation(), opts)
    buildLagunaVacuumPostambleLines(fullBedAllocation(), opts)
    wrapLagunaToolpathWithVacuumBlocks(['G21'], fullBedAllocation(), opts)
    expect(opts).toEqual(before)
  })
})
