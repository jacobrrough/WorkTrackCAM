/**
 * fdm-gcode-layer-summary-pin.test.ts -- [ID-0212] Cycle 136 test-coverage paired-pin
 *
 * Companion to the (very minimal, 32-line / 4 it()) behavior-test file
 * `fdm-gcode-layer-summary.test.ts` that only spot-checks the happy paths.
 * THIS pin file additionally pins the contract of
 * `src/shared/fdm-gcode-layer-summary.ts` -- the K2-Plus-relevant FDM
 * G-code layer summarizer used by Utilities -> Slice for preview / QA.
 *
 * Sister cycles (renderer + shared pure-helper paired-pin chain
 * post-Cycle-127 reset):
 *   - 119 [ID-0196] derive-features
 *   - 124 [ID-0201] viewport3d-bounds
 *   - 129 [ID-0206] design-viewport-interaction
 *   - 130 [ID-0207] shop-stock-bounds
 *   - 131 [ID-0208] command-palette-memory
 *   - 132 [ID-0209] post-process-dialects
 *   - 134 [ID-0210] brand-bar-machine-badge
 *   - 135 [ID-0211] moonraker-push-payload
 *   - 136 [ID-0212] fdm-gcode-layer-summary (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact named exports + arities + symbol-key whitelist.
 *   (B) summarizeFdmGcodeLayers contract: case-insensitivity, whitespace
 *       tolerance, default maxLines=25000, CRLF/LF line endings, multiple
 *       ;LAYER_COUNT (last-wins), negative ;LAYER_COUNT rejected, negative
 *       ;LAYER indices, non-contiguous indices, linesScanned arithmetic,
 *       empty/whitespace-only input handling, purity invariants.
 *   (C) formatFdmLayerSummaryHuman contract: ordering of bits (declared
 *       before inferred), separator (";"), exact "Layer summary:" prefix,
 *       empty-string return when nothing useful, pluralisation invariants.
 *   (D) Source-text whitelist -- regex literal bytes, default maxLines
 *       literal, case-insensitive flag, "Layer summary:" prefix exact,
 *       no fs/subprocess/electron/react imports, 2 export function +
 *       1 export type.
 *
 * ZERO production-code edits. Pure paired-pin. NEW file < 800 lines so
 * the Write tool is safe per `docs/EDIT-WORKFLOW.md` R1.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './fdm-gcode-layer-summary'
import {
  formatFdmLayerSummaryHuman,
  summarizeFdmGcodeLayers,
  type FdmGcodeLayerSummary
} from './fdm-gcode-layer-summary'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'fdm-gcode-layer-summary.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0212] fdm-gcode-layer-summary module shape', () => {
  it('exports summarizeFdmGcodeLayers as a function', () => {
    expect(typeof summarizeFdmGcodeLayers).toBe('function')
  })

  it('exports formatFdmLayerSummaryHuman as a function', () => {
    expect(typeof formatFdmLayerSummaryHuman).toBe('function')
  })

  it('summarizeFdmGcodeLayers arity is exactly 2 (gcode + maxLines)', () => {
    // The default maxLines arg is a TS optional with a runtime default;
    // the function-length count includes only required parameters before
    // the first optional. Pin this so a future cycle does not accidentally
    // make `maxLines` required.
    expect(summarizeFdmGcodeLayers.length).toBe(1)
  })

  it('formatFdmLayerSummaryHuman arity is exactly 1', () => {
    expect(formatFdmLayerSummaryHuman.length).toBe(1)
  })

  it('runtime-keys whitelist: only the two value exports', () => {
    expect(Object.keys(M).sort()).toEqual([
      'formatFdmLayerSummaryHuman',
      'summarizeFdmGcodeLayers'
    ])
  })

  it('only Symbol key allowed on the namespace is Symbol.toStringTag', () => {
    const symbolKeys = Reflect.ownKeys(M).filter((k): k is symbol => typeof k === 'symbol')
    for (const s of symbolKeys) {
      expect(s).toBe(Symbol.toStringTag)
    }
  })
})

// ---------------------------------------------------------------------------
// (B) summarizeFdmGcodeLayers contract
// ---------------------------------------------------------------------------

describe('[ID-0212] summarizeFdmGcodeLayers -- empty/whitespace input', () => {
  it('empty string -> { null, null, 0 }', () => {
    expect(summarizeFdmGcodeLayers('')).toEqual({
      inferredLayerCount: null,
      declaredLayerCount: null,
      linesScanned: 0
    })
  })

  it('whitespace-only string is treated as empty (gcode.trim() short-circuit)', () => {
    expect(summarizeFdmGcodeLayers('   \n\t  \r\n   ')).toEqual({
      inferredLayerCount: null,
      declaredLayerCount: null,
      linesScanned: 0
    })
  })
})

describe('[ID-0212] summarizeFdmGcodeLayers -- inference from ;LAYER comments', () => {
  it('single ;LAYER:0 yields inferredLayerCount=1', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:0\n')
    expect(out.inferredLayerCount).toBe(1)
  })

  it('non-contiguous indices: max+1 wins (sparse Cura output)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:0\n;LAYER:5\n;LAYER:2\n')
    expect(out.inferredLayerCount).toBe(6)
  })

  it('case-insensitive regex (LAYER, layer, LaYeR all parse)', () => {
    expect(summarizeFdmGcodeLayers(';LAYER:3\n').inferredLayerCount).toBe(4)
    expect(summarizeFdmGcodeLayers(';layer:3\n').inferredLayerCount).toBe(4)
    expect(summarizeFdmGcodeLayers(';LaYeR:3\n').inferredLayerCount).toBe(4)
  })

  it('leading whitespace on the line is tolerated by t.trim()', () => {
    const out = summarizeFdmGcodeLayers('   ;LAYER:7\n')
    expect(out.inferredLayerCount).toBe(8)
  })

  it('trailing content after the index is ignored (regex anchored to start)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:4 some-trailing-comment\n')
    expect(out.inferredLayerCount).toBe(5)
  })

  it('negative ;LAYER:-1 (Cura uses -1 for raft init) yields inferredLayerCount=null because Math.max stays at -1', () => {
    // Source contract: maxLayer is initialized to -1; only n>=0 advances
    // it. -1 keeps maxLayer at -1, so inferredLayerCount stays null.
    const out = summarizeFdmGcodeLayers(';LAYER:-1\n')
    expect(out.inferredLayerCount).toBeNull()
  })

  it('mixed negative + positive indices: positive wins, negatives are no-ops', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:-2\n;LAYER:0\n;LAYER:3\n;LAYER:-1\n')
    expect(out.inferredLayerCount).toBe(4)
  })

  it('non-numeric ;LAYER: tag does not match the (-?\\d+) regex (safely ignored)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:abc\n;LAYER:2\n')
    expect(out.inferredLayerCount).toBe(3)
  })

  it('inline ;LAYER: with NO digits (just colon) does not match', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:\n;LAYER:2\n')
    expect(out.inferredLayerCount).toBe(3)
  })
})

describe('[ID-0212] summarizeFdmGcodeLayers -- declared from ;LAYER_COUNT', () => {
  it('basic ;LAYER_COUNT:42 -> declaredLayerCount=42', () => {
    expect(summarizeFdmGcodeLayers(';LAYER_COUNT:42\n').declaredLayerCount).toBe(42)
  })

  it('case-insensitive (Layer_Count, layer_count)', () => {
    expect(summarizeFdmGcodeLayers(';Layer_Count:7\n').declaredLayerCount).toBe(7)
    expect(summarizeFdmGcodeLayers(';layer_count:7\n').declaredLayerCount).toBe(7)
  })

  it('tolerates whitespace after colon (\\s* in the regex)', () => {
    expect(summarizeFdmGcodeLayers(';LAYER_COUNT:   12\n').declaredLayerCount).toBe(12)
    expect(summarizeFdmGcodeLayers(';LAYER_COUNT:\t12\n').declaredLayerCount).toBe(12)
  })

  it('declaredLayerCount=0 IS accepted (n >= 0 branch)', () => {
    // Empty job is a legitimate edge case (e.g., zero-line G-code); the
    // helper accepts 0 explicitly via `n >= 0`.
    expect(summarizeFdmGcodeLayers(';LAYER_COUNT:0\n').declaredLayerCount).toBe(0)
  })

  it('multiple ;LAYER_COUNT lines: LAST one wins (overwrites in loop order)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER_COUNT:5\n;LAYER_COUNT:9\n;LAYER_COUNT:7\n')
    expect(out.declaredLayerCount).toBe(7)
  })

  it('negative ;LAYER_COUNT does not match (\\d+ excludes leading minus)', () => {
    // The regex `/^;LAYER_COUNT:\s*(\d+)/i` lacks a `-?` so a leading
    // minus prevents the match entirely. Pin this so a future cycle
    // does not silently widen the regex and break the n>=0 guard
    // downstream.
    expect(summarizeFdmGcodeLayers(';LAYER_COUNT:-1\n').declaredLayerCount).toBeNull()
  })

  it('decimal ;LAYER_COUNT:1.5 captures "1" via the unanchored \\d+ prefix-match (NOT null)', () => {
    // Regex `/^;LAYER_COUNT:\\s*(\\d+)/i` is unanchored at the end so it
    // greedy-matches the integer prefix and stops at the decimal point.
    // ";LAYER_COUNT:1.5" -> capture "1" -> declared=1. Pin this so a
    // future cycle does not silently tighten the regex with `$` and
    // change downstream behaviour.
    expect(summarizeFdmGcodeLayers(';LAYER_COUNT:1.5\n').declaredLayerCount).toBe(1)
  })

  it('leading whitespace before ;LAYER_COUNT tolerated', () => {
    expect(summarizeFdmGcodeLayers('   ;LAYER_COUNT:8\n').declaredLayerCount).toBe(8)
  })

  it('inferred + declared coexist independently', () => {
    const out = summarizeFdmGcodeLayers(';LAYER_COUNT:10\n;LAYER:0\n;LAYER:9\n')
    expect(out.declaredLayerCount).toBe(10)
    expect(out.inferredLayerCount).toBe(10)
  })
})

describe('[ID-0212] summarizeFdmGcodeLayers -- linesScanned + maxLines truncation', () => {
  it('linesScanned counts split-array length when input fits under default maxLines (trailing \\n produces an extra empty element)', () => {
    // Source uses `gcode.split(/\\r?\\n/)` which produces N+1 elements
    // when the input ends with a newline (the last element is the empty
    // suffix). 4 newline-terminated lines therefore split into 5 elements.
    // Pin this so a future cycle does not silently switch to a `.filter()`
    // post-step that drops empties.
    const gcode = ';LAYER:0\nG1 X0\nG1 X1\nG1 X2\n'
    expect(summarizeFdmGcodeLayers(gcode).linesScanned).toBe(5)
  })

  it('linesScanned caps at custom maxLines (truncation branch)', () => {
    const gcode = Array.from({ length: 200 }, (_, i) => `G1 X${i}`).join('\n')
    expect(summarizeFdmGcodeLayers(gcode, 50).linesScanned).toBe(50)
  })

  it('maxLines=0 still trips the gcode.trim() guard so linesScanned=0 for empty input', () => {
    expect(summarizeFdmGcodeLayers('', 0).linesScanned).toBe(0)
  })

  it('maxLines=0 with non-empty input scans 0 lines and returns nulls (no inference)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:0\n;LAYER_COUNT:1\n', 0)
    expect(out.linesScanned).toBe(0)
    expect(out.inferredLayerCount).toBeNull()
    expect(out.declaredLayerCount).toBeNull()
  })

  it('default maxLines is 25000 (large input fully scanned up to that cap)', () => {
    // Build 30 lines and pin that all 30 are scanned -- proves the default
    // arg is at least 30. The exact 25000 default is pinned via source-
    // text whitelist below; this is the runtime confirmation that the
    // default is "much larger than 30".
    const gcode = Array.from({ length: 30 }, () => 'G1 X0').join('\n')
    expect(summarizeFdmGcodeLayers(gcode).linesScanned).toBe(30)
  })

  it('headers beyond the maxLines cap are NOT seen (truncation is firm)', () => {
    // First 3 lines are filler, line 4 has the layer comment.
    const gcode = 'G1 X0\nG1 X1\nG1 X2\n;LAYER:5\n'
    const out = summarizeFdmGcodeLayers(gcode, 3)
    expect(out.linesScanned).toBe(3)
    expect(out.inferredLayerCount).toBeNull()
  })
})

describe('[ID-0212] summarizeFdmGcodeLayers -- line endings', () => {
  it('handles CRLF line endings (Windows-saved G-code from Cura)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER_COUNT:3\r\n;LAYER:0\r\n;LAYER:2\r\n')
    expect(out.declaredLayerCount).toBe(3)
    expect(out.inferredLayerCount).toBe(3)
    expect(out.linesScanned).toBe(4) // includes the trailing empty line from final \r\n
  })

  it('handles bare LF line endings (Unix-saved G-code)', () => {
    const out = summarizeFdmGcodeLayers(';LAYER_COUNT:3\n;LAYER:0\n;LAYER:2\n')
    expect(out.declaredLayerCount).toBe(3)
    expect(out.inferredLayerCount).toBe(3)
  })

  it('mixed CRLF + LF line endings', () => {
    const out = summarizeFdmGcodeLayers(';LAYER_COUNT:3\r\n;LAYER:0\n;LAYER:2\r\n')
    expect(out.declaredLayerCount).toBe(3)
    expect(out.inferredLayerCount).toBe(3)
  })
})

describe('[ID-0212] summarizeFdmGcodeLayers -- purity & determinism', () => {
  it('input string is not mutated (string is immutable in JS, this is a sanity pin)', () => {
    const gcode = ';LAYER_COUNT:5\n;LAYER:0\n'
    const before = gcode
    summarizeFdmGcodeLayers(gcode)
    expect(gcode).toBe(before)
  })

  it('returns a fresh object every call', () => {
    const gcode = ';LAYER_COUNT:5\n;LAYER:0\n'
    const a = summarizeFdmGcodeLayers(gcode)
    const b = summarizeFdmGcodeLayers(gcode)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('determinism: N=10 calls with the same input produce equal output', () => {
    const gcode = ';LAYER_COUNT:5\n;LAYER:0\n;LAYER:4\n'
    const out0 = summarizeFdmGcodeLayers(gcode)
    for (let i = 0; i < 10; i++) {
      expect(summarizeFdmGcodeLayers(gcode)).toEqual(out0)
    }
  })

  it('output object has only the three documented keys', () => {
    const out = summarizeFdmGcodeLayers(';LAYER:0\n')
    expect(Object.keys(out).sort()).toEqual([
      'declaredLayerCount',
      'inferredLayerCount',
      'linesScanned'
    ])
  })
})

// ---------------------------------------------------------------------------
// (C) formatFdmLayerSummaryHuman contract
// ---------------------------------------------------------------------------

describe('[ID-0212] formatFdmLayerSummaryHuman -- formatting branches', () => {
  it('empty stub (linesScanned=0, no counts) -> empty string', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: null,
      declaredLayerCount: null,
      linesScanned: 0
    }
    expect(formatFdmLayerSummaryHuman(s)).toBe('')
  })

  it('linesScanned>0 but no counts -> "no Cura-style ;LAYER ..." message', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: null,
      declaredLayerCount: null,
      linesScanned: 100
    }
    expect(formatFdmLayerSummaryHuman(s)).toBe(
      'Layer summary: no Cura-style ;LAYER / ;LAYER_COUNT headers in the first 100 lines.'
    )
  })

  it('declared only', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: null,
      declaredLayerCount: 42,
      linesScanned: 50
    }
    expect(formatFdmLayerSummaryHuman(s)).toBe(
      'Layer summary: declared 42 (;LAYER_COUNT) (scanned 50 lines).'
    )
  })

  it('inferred only', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: 7,
      declaredLayerCount: null,
      linesScanned: 50
    }
    expect(formatFdmLayerSummaryHuman(s)).toBe(
      'Layer summary: inferred 7 (from ;LAYER comments) (scanned 50 lines).'
    )
  })

  it('both declared and inferred -> declared appears FIRST, joined with "; "', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: 7,
      declaredLayerCount: 7,
      linesScanned: 50
    }
    expect(formatFdmLayerSummaryHuman(s)).toBe(
      'Layer summary: declared 7 (;LAYER_COUNT); inferred 7 (from ;LAYER comments) (scanned 50 lines).'
    )
  })

  it('declared=0 and inferred=null still emits the declared bit (n >= 0 not falsy-checked)', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: null,
      declaredLayerCount: 0,
      linesScanned: 1
    }
    expect(formatFdmLayerSummaryHuman(s)).toBe(
      'Layer summary: declared 0 (;LAYER_COUNT) (scanned 1 lines).'
    )
  })

  it('"Layer summary:" prefix is invariant across all non-empty branches', () => {
    const cases: FdmGcodeLayerSummary[] = [
      { inferredLayerCount: 3, declaredLayerCount: null, linesScanned: 50 },
      { inferredLayerCount: null, declaredLayerCount: 4, linesScanned: 50 },
      { inferredLayerCount: 3, declaredLayerCount: 4, linesScanned: 50 },
      { inferredLayerCount: null, declaredLayerCount: null, linesScanned: 50 }
    ]
    for (const s of cases) {
      expect(formatFdmLayerSummaryHuman(s).startsWith('Layer summary: ')).toBe(true)
    }
  })

  it('does not mutate the input summary object', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: 3,
      declaredLayerCount: 4,
      linesScanned: 50
    }
    const before = JSON.stringify(s)
    formatFdmLayerSummaryHuman(s)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('determinism: N=10 same-input calls produce identical strings', () => {
    const s: FdmGcodeLayerSummary = {
      inferredLayerCount: 3,
      declaredLayerCount: 4,
      linesScanned: 50
    }
    const out0 = formatFdmLayerSummaryHuman(s)
    for (let i = 0; i < 10; i++) {
      expect(formatFdmLayerSummaryHuman(s)).toBe(out0)
    }
  })
})

// ---------------------------------------------------------------------------
// (D) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0212] source-text whitelist', () => {
  it('header documents Cura-style FDM G-code layer comments + preview/QA scope', () => {
    expect(SRC).toContain('Cura-style FDM G-code layer comments')
    expect(SRC).toContain('preview / QA only')
  })

  it('default maxLines = 25000 is the literal in the function signature', () => {
    expect(SRC).toContain('maxLines = 25000')
  })

  it('regex literals: /^;LAYER:(-?\\d+)/i and /^;LAYER_COUNT:\\s*(\\d+)/i exact', () => {
    // The integer-only +regex on LAYER_COUNT and the signed-integer regex
    // on LAYER are load-bearing: changing them flips the n>=0 guard
    // semantics and the negative-LAYER no-op behaviour pinned in (B).
    expect(SRC).toContain('/^;LAYER:(-?\\d+)/i')
    expect(SRC).toContain('/^;LAYER_COUNT:\\s*(\\d+)/i')
  })

  it('split uses the line-ending tolerant `/\\r?\\n/` regex (NOT a single-character split)', () => {
    expect(SRC).toContain('gcode.split(/\\r?\\n/)')
  })

  it('Math.max guard initial value is exactly -1 (drives the inferredLayerCount=null fallback)', () => {
    expect(SRC).toContain('let maxLayer = -1')
    expect(SRC).toContain('maxLayer >= 0 ? maxLayer + 1 : null')
  })

  it('declared count guard is `n >= 0` (allows 0, rejects negatives)', () => {
    expect(SRC).toContain('Number.isFinite(n) && n >= 0')
  })

  it('uses Number.isFinite (not the unsafe global isFinite) on both branches', () => {
    const matches = SRC.match(/Number\.isFinite/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2)
  })

  it('"Layer summary:" prefix appears verbatim in BOTH non-empty format branches', () => {
    const matches = SRC.match(/Layer summary:/g)
    expect(matches).not.toBeNull()
    // 2 occurrences: the "(declared|inferred)" branch + the "no Cura-style" fallback branch.
    expect(matches!.length).toBe(2)
  })

  it('has-counts branch joins with "; " (semicolon + space)', () => {
    expect(SRC).toContain("bits.join('; ')")
  })

  it('declared-bit format string is `declared ${n} (;LAYER_COUNT)` exactly', () => {
    expect(SRC).toContain('declared ${s.declaredLayerCount} (;LAYER_COUNT)')
  })

  it('inferred-bit format string is `inferred ${n} (from ;LAYER comments)` exactly', () => {
    expect(SRC).toContain('inferred ${s.inferredLayerCount} (from ;LAYER comments)')
  })

  it('declared check uses `!= null` loose-equality (handles both null + undefined)', () => {
    // Source uses `s.declaredLayerCount != null` -- the ESLint exception
    // for null-loose-equal. Pin this so a future cycle does not flip to
    // strict !== which would treat undefined as truthy.
    expect(SRC).toContain('s.declaredLayerCount != null')
    expect(SRC).toContain('s.inferredLayerCount != null')
  })

  it('exports exactly 2 `^export function` declarations + 1 `^export type`', () => {
    const fns = SRC.match(/^export function /gm)
    expect(fns).not.toBeNull()
    expect(fns!.length).toBe(2)
    const types = SRC.match(/^export type /gm)
    expect(types).not.toBeNull()
    expect(types!.length).toBe(1)
  })

  it('canonical export names exist verbatim', () => {
    expect(SRC).toContain('export type FdmGcodeLayerSummary =')
    expect(SRC).toContain('export function summarizeFdmGcodeLayers(')
    expect(SRC).toContain('export function formatFdmLayerSummaryHuman(')
  })

  it('no fs / subprocess / electron / react imports (pure helper invariant)', () => {
    expect(SRC).not.toMatch(/from ['"]node:fs/)
    expect(SRC).not.toMatch(/from ['"]node:child_process/)
    expect(SRC).not.toMatch(/from ['"]node:path/)
    expect(SRC).not.toMatch(/from ['"]electron/)
    expect(SRC).not.toMatch(/from ['"]react/)
    expect(SRC).not.toContain('window.')
    expect(SRC).not.toContain('document.')
  })

  it('no `any` type / `as any` / `<any>` (Safety Rule 3)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('FdmGcodeLayerSummary type contract: 3 keys with exact types', () => {
    expect(SRC).toContain('inferredLayerCount: number | null')
    expect(SRC).toContain('declaredLayerCount: number | null')
    expect(SRC).toContain('linesScanned: number')
  })
})
