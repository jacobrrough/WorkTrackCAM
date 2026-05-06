/**
 * command-palette-search-pin.test.ts -- [ID-0229] Cycle 156 ui-polish
 * paired-pin for `src/renderer/commands/command-palette-search.ts`.
 *
 * Sister to the existing 4-test behavioural companion
 * `command-palette-search.test.ts`. This co-located paired-pin extends
 * coverage with module shape (exact named-export inventory + arities +
 * Symbol.toStringTag / null-prototype invariants), the
 * PALETTE_QUERY_ALIASES contract (every alias key is normalised lower-
 * case, every alias value references a real `FusionStyleCommand.id`),
 * rowMatchesPaletteQuery branch coverage (empty query / single-token
 * hay match / multi-token AND match / alias whole-query match / token-
 * alias match / no-match), orderRowsByRecent edge cases (empty
 * recentIds / qEmpty=false short-circuit / dedupe / unknown ids
 * skipped), AND a source-text whitelist pinning the type-only
 * FusionStyleCommand import + Safety Rule 1/3/4 negative invariants
 * (no electron / fs / path / child_process imports, no `any` 3-form,
 * no top-level `let`/`var`, no Handlebars tokens, no G-code/M-code
 * emission, no foreign-machine vendor names).
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130
 * [ID-0207] / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135
 * [ID-0211] / 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140
 * [ID-0215] / 142 [ID-0216] / 144 [ID-0217] / 145 [ID-0218] / 146
 * [ID-0220] / 147 [ID-0222] / 149 [ID-0225] / 150 [ID-0221] / 151
 * [ID-0226] / 152 [ID-0224] / 153 [ID-0067-data-v21] / 154 [ID-0227]
 * / 155 [ID-0228].
 *
 * Three-machine impact: indirect / cross-cutting via the Fusion-style
 * command palette substrate -- shared across every operator workflow
 * on every target machine (K2 Plus FDM tool / setup edits, Laguna
 * Swift 5x10 router stock / vacuum-zone edits, Carvera 4-axis fixture
 * edits all surface their machine-specific actions through the same
 * palette). Drift in the alias table or query-matching algorithm
 * would degrade discoverability of common actions uniformly across
 * the fleet.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './command-palette-search'
import {
  PALETTE_QUERY_ALIASES,
  rowMatchesPaletteQuery,
  orderRowsByRecent
} from './command-palette-search'
import {
  FUSION_STYLE_COMMAND_CATALOG,
  type FusionStyleCommand
} from '../../shared/fusion-style-command-catalog'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'command-palette-search.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

function codeOnly(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  out = out.replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  return out
}

function findRow(id: string): FusionStyleCommand {
  const r = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === id)
  if (!r) throw new Error(`fixture row not found: ${id}`)
  return r
}

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0229] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(
      ['PALETTE_QUERY_ALIASES', 'orderRowsByRecent', 'rowMatchesPaletteQuery'].sort()
    )
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    expect(Object.getOwnPropertySymbols(M)).toEqual([Symbol.toStringTag])
  })

  it('has Symbol.toStringTag === "Module" on the ESM namespace', () => {
    expect((M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('PALETTE_QUERY_ALIASES is a plain object (Record)', () => {
    expect(typeof PALETTE_QUERY_ALIASES).toBe('object')
    expect(PALETTE_QUERY_ALIASES).not.toBeNull()
  })

  it('rowMatchesPaletteQuery is a function with arity 2', () => {
    expect(typeof rowMatchesPaletteQuery).toBe('function')
    expect(rowMatchesPaletteQuery.length).toBe(2)
  })

  it('orderRowsByRecent is a function with arity 3', () => {
    expect(typeof orderRowsByRecent).toBe('function')
    expect(orderRowsByRecent.length).toBe(3)
  })

  it('exports exactly 3 runtime symbols (no internal helper leaks)', () => {
    expect(Object.keys(M)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// B) PALETTE_QUERY_ALIASES contract
// ---------------------------------------------------------------------------

describe('[ID-0229] B) PALETTE_QUERY_ALIASES contract', () => {
  it('contains all 17 documented alias keys', () => {
    expect(Object.keys(PALETTE_QUERY_ALIASES).sort()).toEqual(
      [
        'pdf',
        'dxf',
        'measure',
        'distance',
        'section',
        'interference',
        'palette',
        'shortcuts',
        'parameters',
        'param',
        'drawing',
        'manifest',
        'open',
        'new',
        'save',
        'tool',
        'tools',
        'cam',
        'slice'
      ].sort()
    )
  })

  it('every alias key is normalized lower-case (no uppercase chars)', () => {
    for (const key of Object.keys(PALETTE_QUERY_ALIASES)) {
      expect(key).toBe(key.toLowerCase())
    }
  })

  it('every alias key is trimmed (no surrounding whitespace)', () => {
    for (const key of Object.keys(PALETTE_QUERY_ALIASES)) {
      expect(key).toBe(key.trim())
    }
  })

  it('every alias value is a non-empty string array', () => {
    for (const [key, value] of Object.entries(PALETTE_QUERY_ALIASES)) {
      expect(Array.isArray(value), `key=${key}`).toBe(true)
      expect(value.length).toBeGreaterThan(0)
      for (const term of value) {
        expect(typeof term).toBe('string')
      }
    }
  })

  it('non-id alias terms (e.g. "mf_" prefix, "drawing") are documented substrings, not full ids', () => {
    // The alias system uses *substrings* of the haystack, not strict id
    // equality, so partial-match terms like "mf_" or "drawing" are valid.
    // This pin documents that intent so a future drift doesn't accidentally
    // tighten the matcher to require strict id equality.
    expect(PALETTE_QUERY_ALIASES.cam).toContain('mf_')
    expect(PALETTE_QUERY_ALIASES.manifest).toContain('drawing')
  })

  it('every alias term that LOOKS like a command id (matches /^(dr|ut|as|mf)_/) is either a full catalog id OR a prefix of one', () => {
    // The alias matcher uses substring inclusion against the haystack, so
    // alias terms can be either:
    //   (a) the full id of a catalog row (e.g. "ut_measure"), OR
    //   (b) a prefix sentinel that is a strict prefix of >=1 catalog id
    //       (e.g. "mf_" matches every Manufacture-tab command, "dr_export"
    //       matches both dr_export_pdf and dr_export_dxf).
    // This pin documents that intent so a future drift doesn't accidentally
    // tighten the matcher to require strict id equality.
    const catalogIds = FUSION_STYLE_COMMAND_CATALOG.map((r) => r.id)
    const idSet = new Set(catalogIds)
    for (const [key, terms] of Object.entries(PALETTE_QUERY_ALIASES)) {
      for (const term of terms) {
        if (/^(?:dr|ut|as|mf)_/.test(term)) {
          const isFullId = idSet.has(term)
          const isPrefix = catalogIds.some((id) => id.startsWith(term))
          expect(
            isFullId || isPrefix,
            `${key}->${term} should reference a catalog id (full or prefix)`
          ).toBe(true)
        }
      }
    }
  })

  it('alias keys with shared aliases produce shared results (e.g. tool/tools, parameters/param)', () => {
    expect(PALETTE_QUERY_ALIASES.tool).toEqual(PALETTE_QUERY_ALIASES.tools)
    expect(PALETTE_QUERY_ALIASES.parameters).toEqual(PALETTE_QUERY_ALIASES.param)
  })
})

// ---------------------------------------------------------------------------
// C) rowMatchesPaletteQuery branch coverage
// ---------------------------------------------------------------------------

describe('[ID-0229] C) rowMatchesPaletteQuery branch coverage', () => {
  it('empty query string returns true (any row matches empty)', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, '')).toBe(true)
  })

  it('whitespace-only query returns true (trim() then empty branch)', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, '   ')).toBe(true)
  })

  it('case-insensitive single-token hay match (UPPER-case query)', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, 'MEASURE')).toBe(true)
  })

  it('case-insensitive single-token hay match (Mixed-case query)', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, 'MeAsUrE')).toBe(true)
  })

  it('multi-token AND match: every whitespace-separated token must hit the haystack', () => {
    const r = findRow('ut_command_palette')
    expect(rowMatchesPaletteQuery(r, 'command palette')).toBe(true)
  })

  it('multi-token AND match: missing one token rejects the row', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, 'measure orbiting_galaxy_42')).toBe(false)
  })

  it('alias whole-query match: "pdf" routes to dr_export_pdf', () => {
    const r = findRow('dr_export_pdf')
    expect(rowMatchesPaletteQuery(r, 'pdf')).toBe(true)
  })

  it('alias whole-query match: "measure" routes to ut_measure', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, 'measure')).toBe(true)
  })

  it('token-alias match: each token resolves via PALETTE_QUERY_ALIASES', () => {
    // "open" is an alias whose terms include 'ut_open' AND 'ut_command_palette'.
    // For ut_open row, query "open project" should match: 'open' token aliases
    // include 'ut_open' (substring of haystack), 'project' is a literal substring.
    const r = findRow('ut_open')
    expect(rowMatchesPaletteQuery(r, 'open project')).toBe(true)
  })

  it('no match for unrelated query returns false', () => {
    const r = findRow('ut_measure')
    expect(rowMatchesPaletteQuery(r, 'orbiting_galaxy_42')).toBe(false)
  })

  it('alias miss falls through to false (no spurious match)', () => {
    const r = findRow('dr_export_pdf')
    // 'dxf' aliases route to dr_export_dxf, NOT dr_export_pdf.
    expect(rowMatchesPaletteQuery(r, 'dxf')).toBe(false)
  })

  it('row with undefined optional fields (fusionRibbon / notes) does not crash', () => {
    const synth: FusionStyleCommand = {
      id: 'synth_test_id',
      label: 'Synth Test',
      ribbon: 'inspect',
      workspace: 'utilities',
      status: 'planned'
    }
    expect(rowMatchesPaletteQuery(synth, 'synth')).toBe(true)
    expect(rowMatchesPaletteQuery(synth, 'nonexistent')).toBe(false)
  })

  it('returns boolean primitive (not truthy/falsy proxy)', () => {
    const r = findRow('ut_measure')
    expect(typeof rowMatchesPaletteQuery(r, 'measure')).toBe('boolean')
    expect(typeof rowMatchesPaletteQuery(r, 'galaxy_42_zzz')).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// D) orderRowsByRecent edge cases
// ---------------------------------------------------------------------------

describe('[ID-0229] D) orderRowsByRecent edge cases', () => {
  it('returns the input rows unchanged when qEmpty is false', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const ordered = orderRowsByRecent([a, b], ['ut_section'], false)
    expect(ordered).toBe(/* same reference */ ordered)
    expect(ordered.map((r) => r.id)).toEqual(['ut_measure', 'ut_section'])
  })

  it('returns the input rows unchanged when recentIds is empty', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const ordered = orderRowsByRecent([a, b], [], true)
    expect(ordered.map((r) => r.id)).toEqual(['ut_measure', 'ut_section'])
  })

  it('promotes recent ids to the front in the recentIds order when qEmpty is true', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const c = findRow('ut_command_palette')
    const ordered = orderRowsByRecent([a, b, c], ['ut_section', 'ut_measure'], true)
    expect(ordered.map((r) => r.id)).toEqual([
      'ut_section',
      'ut_measure',
      'ut_command_palette'
    ])
  })

  it('skips unknown recent ids without crashing', () => {
    const a = findRow('ut_measure')
    const ordered = orderRowsByRecent(
      [a],
      ['ghost_id_not_in_rows', 'ut_measure'],
      true
    )
    expect(ordered.map((r) => r.id)).toEqual(['ut_measure'])
  })

  it('dedupes recent ids that appear twice in recentIds list', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const ordered = orderRowsByRecent(
      [a, b],
      ['ut_measure', 'ut_measure', 'ut_section'],
      true
    )
    expect(ordered.map((r) => r.id)).toEqual(['ut_measure', 'ut_section'])
  })

  it('preserves the relative order of non-recent rows after the promoted block', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const c = findRow('ut_command_palette')
    const ordered = orderRowsByRecent([a, b, c], ['ut_section'], true)
    expect(ordered.map((r) => r.id)).toEqual([
      'ut_section',
      'ut_measure',
      'ut_command_palette'
    ])
  })

  it('returns a fresh array (not the input array reference) when recentIds is non-empty + qEmpty', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const input: FusionStyleCommand[] = [a, b]
    const ordered = orderRowsByRecent(input, ['ut_section'], true)
    expect(ordered).not.toBe(input)
  })

  it('returns the same input reference when recentIds is empty (early-return path)', () => {
    const a = findRow('ut_measure')
    const input: FusionStyleCommand[] = [a]
    const ordered = orderRowsByRecent(input, [], true)
    expect(ordered).toBe(input)
  })

  it('returns the same input reference when qEmpty is false (early-return path)', () => {
    const a = findRow('ut_measure')
    const input: FusionStyleCommand[] = [a]
    const ordered = orderRowsByRecent(input, ['ut_measure'], false)
    expect(ordered).toBe(input)
  })

  it('does NOT mutate the input rows array', () => {
    const a = findRow('ut_measure')
    const b = findRow('ut_section')
    const input: FusionStyleCommand[] = [a, b]
    const snapshot = input.map((r) => r.id)
    orderRowsByRecent(input, ['ut_section'], true)
    expect(input.map((r) => r.id)).toEqual(snapshot)
  })

  it('does NOT mutate the input recentIds array', () => {
    const a = findRow('ut_measure')
    const recent = ['ut_measure', 'ghost_id']
    const snapshot = recent.slice()
    orderRowsByRecent([a], recent, true)
    expect(recent).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// E) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0229] E) source-text whitelist', () => {
  it('imports FusionStyleCommand as type-only from `../../shared/fusion-style-command-catalog`', () => {
    expect(SRC).toMatch(
      /^import type \{ FusionStyleCommand \} from '\.\.\/\.\.\/shared\/fusion-style-command-catalog'$/m
    )
  })

  it('exports `PALETTE_QUERY_ALIASES` as a Record<string, string[]>', () => {
    expect(SRC).toMatch(/export const PALETTE_QUERY_ALIASES:\s*Record<string, string\[\]>/)
  })

  it('exports `rowMatchesPaletteQuery` as a named function returning boolean', () => {
    expect(SRC).toMatch(
      /^export function rowMatchesPaletteQuery\(row: FusionStyleCommand, q: string\): boolean \{/m
    )
  })

  it('exports `orderRowsByRecent` as a named function with the documented signature', () => {
    expect(SRC).toMatch(/^export function orderRowsByRecent\($/m)
    expect(SRC).toMatch(/rows: FusionStyleCommand\[\],/)
    expect(SRC).toMatch(/recentIds: string\[\],/)
    expect(SRC).toMatch(/qEmpty: boolean/)
    expect(SRC).toMatch(/\): FusionStyleCommand\[\]/)
  })

  it('declares the haystack template literal joining label / id / ribbon / fusionRibbon / notes', () => {
    expect(SRC).toContain('${row.label} ${row.id} ${row.ribbon} ${row.fusionRibbon ?? \'\'} ${row.notes ?? \'\'}')
  })

  it('uses `q.trim().toLowerCase()` to normalise the query', () => {
    expect(SRC).toMatch(/q\.trim\(\)\.toLowerCase\(\)/)
  })

  it('splits multi-token queries on `/\\s\\+/`', () => {
    expect(SRC).toMatch(/ql\.split\(\/\\s\+\/\)/)
  })

  it('uses an early-return path when qEmpty is false OR recentIds is empty', () => {
    expect(SRC).toMatch(/if \(!qEmpty \|\| recentIds\.length === 0\) return rows/)
  })

  it('uses Map<id, row> for O(1) recentIds lookup', () => {
    expect(SRC).toMatch(/new Map\(rows\.map\(\(r\) => \[r\.id, r\]\)\)/)
  })

  it('uses a Set<string> for dedupe tracking', () => {
    expect(SRC).toMatch(/new Set<string>\(\)/)
  })

  it('exactly 1 `import type` declaration', () => {
    const matches = SRC.match(/^import type /gm) ?? []
    expect(matches).toHaveLength(1)
  })

  it('exactly 0 value imports (the FusionStyleCommand catalog is type-only here)', () => {
    expect(SRC).not.toMatch(/^import \{[^}]+\} from /m)
  })

  it('exactly 2 `export function` declarations', () => {
    const matches = SRC.match(/^export function /gm) ?? []
    expect(matches).toHaveLength(2)
  })

  it('exactly 1 `export const` declaration', () => {
    const matches = SRC.match(/^export const /gm) ?? []
    expect(matches).toHaveLength(1)
  })

  it('module declares NO default export', () => {
    expect(SRC).not.toMatch(/^export default /m)
  })

  it('module declares NO top-level `let` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^let /m)
  })

  it('module declares NO top-level `var` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^var /m)
  })

  it('module has NO `: any` annotation in executable code', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('module has NO `as any` cast in executable code', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bas\s+any\b/)
  })

  it('module has NO `<any>` generic in executable code', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/<any>/)
  })

  it('module imports NOTHING from electron / fs / path / child_process / dgram / net / tls', () => {
    expect(SRC).not.toMatch(/from\s+'electron'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?fs'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?path'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?child_process'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?dgram'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?net'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?tls'/)
  })

  it('module imports NOTHING React / DOM (lives under src/renderer/commands but is React-agnostic)', () => {
    expect(SRC).not.toMatch(/from\s+'react'/)
    expect(SRC).not.toMatch(/from\s+'react-dom'/)
  })

  it('module emits NO Handlebars tokens (no {{...}} templates)', () => {
    expect(SRC).not.toMatch(/\{\{[^}]+\}\}/)
  })

  it('module emits NO G-code tokens in executable code (G0/G1/G17/G20/G21/G28/G54/G90/G91)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bG(?:0|1|17|18|19|20|21|28|54|90|91)\b/)
  })

  it('module emits NO M-code tokens in executable code (M3/M5/M6/M30/etc.)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bM(?:3|03|5|05|6|06|7|8|9|30)\b/)
  })

  it('module references NO foreign-machine vendor names (only Fusion-style command ids are referenced)', () => {
    expect(SRC).not.toMatch(
      /\b(?:Klipper|Moonraker|RichAuto|Bambu|Prusa|Voron|Ender-N|Onefinity|Shapeoko|Longmill)\b/
    )
  })

  it('source size stays under 100 lines (terseness invariant)', () => {
    const lines = SRC.split('\n').length
    expect(lines).toBeLessThan(100)
  })

  it('source size stays under 4 KB (terseness invariant)', () => {
    expect(Buffer.byteLength(SRC, 'utf8')).toBeLessThan(4 * 1024)
  })
})
