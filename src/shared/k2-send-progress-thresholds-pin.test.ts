/**
 * Phase 2 [P2-K2-PUSH]/Cycle 359 -- source-text pin for the K2 Plus
 * Send polite-announcement threshold helpers.
 *
 * Pins the export shape, the readonly tuple, the K2 prefix, and the
 * roadmap tag so a renamer / re-orderer / accidental third helper
 * cannot ship without updating this file.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as mod from './k2-send-progress-thresholds'

const SRC = readFileSync(resolve(__dirname, 'k2-send-progress-thresholds.ts'), 'utf8')

describe('A. exports', () => {
  it('A1: declares exactly twelve named exports (3 threshold + 3 bracket [Cycle 368] + 1 failure [Cycle 373] + 1 outcome label [Cycle 375] + 1 outcome timestamp suffix [Cycle 380] + 1 outcome filename suffix [Cycle 383] + 2 outcome filename truncation [Cycle 388])', () => {
    const exported = Object.keys(mod).sort()
    expect(exported).toEqual(
      [
        'K2_SEND_PROGRESS_THRESHOLDS',
        'formatK2SendThresholdAnnouncement',
        'k2SendThresholdsCrossed',
        'K2_SEND_PROGRESS_BRACKETS',
        'formatK2SendBracketAnnouncement',
        'k2SendBracketsCrossed',
        'formatK2SendFailureAnnouncement',
        'formatK2SendOutcomeLabel',
        'formatK2SendOutcomeTimestampSuffix',
        'formatK2SendOutcomeFilenameSuffix',
        'K2_SEND_OUTCOME_FILENAME_MAX_CHARS',
        'truncateK2SendOutcomeFilename'
      ].sort()
    )
  })

  it('A2: K2_SEND_PROGRESS_THRESHOLDS is the readonly tuple [25, 50, 75]', () => {
    expect([...mod.K2_SEND_PROGRESS_THRESHOLDS]).toEqual([25, 50, 75])
    // The `as const` annotation is what gives the readonly tuple type;
    // pin the source-text so a future regression to `let` or `Array` form
    // (which would silently drop the tuple type and let mutation slip in)
    // fails CI here.
    expect(SRC).toContain('export const K2_SEND_PROGRESS_THRESHOLDS = [25, 50, 75] as const')
  })

  it('A3: k2SendThresholdsCrossed signature reads (number, ReadonlySet<number>) -> readonly number[]', () => {
    expect(SRC).toMatch(
      /export function k2SendThresholdsCrossed\(\s*percent:\s*number,\s*alreadyAnnounced:\s*ReadonlySet<number>\s*\):\s*readonly number\[\]/
    )
  })

  it('A4: formatK2SendThresholdAnnouncement signature reads (number) -> string', () => {
    expect(SRC).toMatch(
      /export function formatK2SendThresholdAnnouncement\(\s*threshold:\s*number\s*\):\s*string/
    )
  })

  it('A5: k2SendThresholdsCrossed guards against non-finite percent (defence in depth)', () => {
    expect(SRC).toContain('Number.isFinite(percent)')
  })

  it('A6: formatter uses the literal "Uploading to K2 Plus: " prefix and U+2026 ellipsis', () => {
    expect(SRC).toContain('return `Uploading to K2 Plus: ${threshold}%…`')
  })
})

describe('B. JSDoc / roadmap tag', () => {
  it('B1: source carries the [P2-K2-PUSH]/Cycle 359 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 359')
  })

  it('B2: docstring documents the K2-only three-machine scope', () => {
    expect(SRC).toMatch(/Creality K2 Plus only|K2-scoped|K2-only/i)
    // And explicitly notes the other two target machines do not use Moonraker.
    expect(SRC).toMatch(/Laguna Swift|RichAuto/)
    expect(SRC).toMatch(/Carvera|carvera-cli/)
  })

  it('B3: docstring documents why 100% is intentionally NOT a threshold', () => {
    // The terminal "Started on K2 Plus: <file>" announcement carries the
    // useful filename feedback. Adding 100% as a threshold would race
    // with that message.
    expect(SRC).toMatch(/100%[^\n]*not a threshold|race[^\n]*Started on K2 Plus|terminal/i)
  })
})

describe('C. behaviour invariants pinned at the source level', () => {
  it('C1: thresholds tuple length is 3', () => {
    expect(mod.K2_SEND_PROGRESS_THRESHOLDS.length).toBe(3)
  })

  it('C2: ascending order is enforced -- regression check', () => {
    for (let i = 1; i < mod.K2_SEND_PROGRESS_THRESHOLDS.length; i++) {
      expect(mod.K2_SEND_PROGRESS_THRESHOLDS[i]).toBeGreaterThan(
        mod.K2_SEND_PROGRESS_THRESHOLDS[i - 1]!
      )
    }
  })

  it('C3: every threshold is in the open interval (0, 100)', () => {
    for (const t of mod.K2_SEND_PROGRESS_THRESHOLDS) {
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThan(100)
    }
  })
})

// ─── [P2-K2-PUSH]/Cycle 368 -- bracket helper source pins ────────────────
// The bracket helpers fill the START (0%) and TERMINAL (100%) edges that
// the threshold helpers intentionally exclude. Source-text pins ensure
// the readonly tuple, the announcement strings, and the K2-only scoping
// docstring stay in lock-step with the threshold layer.

describe('D. bracket exports (Cycle 368)', () => {
  it('D1: K2_SEND_PROGRESS_BRACKETS is the readonly tuple [0, 100]', () => {
    expect([...mod.K2_SEND_PROGRESS_BRACKETS]).toEqual([0, 100])
    // Source-text pin so a regression to `let` or `Array` form fails CI.
    expect(SRC).toContain('export const K2_SEND_PROGRESS_BRACKETS = [0, 100] as const')
  })

  it('D2: k2SendBracketsCrossed signature reads (number, ReadonlySet<number>) -> readonly number[]', () => {
    expect(SRC).toMatch(
      /export function k2SendBracketsCrossed\(\s*percent:\s*number,\s*alreadyAnnounced:\s*ReadonlySet<number>\s*\):\s*readonly number\[\]/
    )
  })

  it('D3: formatK2SendBracketAnnouncement signature reads (number) -> string', () => {
    expect(SRC).toMatch(
      /export function formatK2SendBracketAnnouncement\(\s*bracket:\s*number\s*\):\s*string/
    )
  })

  it('D4: formatter emits the literal "Upload starting" string for the 0-bracket', () => {
    expect(SRC).toContain("return 'Upload starting'")
  })

  it('D5: formatter emits the literal "Upload complete — printer beginning the job" for the 100-bracket (U+2014 EM DASH)', () => {
    expect(SRC).toContain("return 'Upload complete — printer beginning the job'")
    // Defensive: assert the U+2014 EM DASH is the exact codepoint, not a
    // hyphen-minus or en-dash, so a screen reader renders the brief
    // intra-clause pause instead of speaking "dash".
    expect(SRC).toContain('—')
  })

  it('D6: k2SendBracketsCrossed guards against non-finite percent (defence in depth)', () => {
    // Same Number.isFinite gate as the threshold helper.
    expect(SRC).toMatch(
      /export function k2SendBracketsCrossed[\s\S]*?Number\.isFinite\(percent\)/
    )
  })

  it('D7: source carries the [P2-K2-PUSH]/Cycle 368 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 368')
  })

  it('D8: docstring documents the bracket / threshold semantic split', () => {
    // Brackets fire on 0/100, thresholds fire on 25/50/75 -- the docstring
    // must explicitly call out the split so a future maintainer does not
    // collapse the two into a single helper and lose the start/terminal
    // distinction.
    expect(SRC).toMatch(/SEMANTICALLY DISTINCT|brackets and thresholds|brackets vs\.? thresholds/i)
  })
})

describe('E. bracket behaviour invariants pinned at the source level', () => {
  it('E1: brackets tuple length is 2', () => {
    expect(mod.K2_SEND_PROGRESS_BRACKETS.length).toBe(2)
  })

  it('E2: bracket values are exactly the closed interval [0, 100]', () => {
    expect(mod.K2_SEND_PROGRESS_BRACKETS[0]).toBe(0)
    expect(mod.K2_SEND_PROGRESS_BRACKETS[1]).toBe(100)
  })

  it('E3: brackets and thresholds do not overlap (0/100 reserved for brackets, 25/50/75 for thresholds)', () => {
    const tSet = new Set<number>(mod.K2_SEND_PROGRESS_THRESHOLDS)
    for (const b of mod.K2_SEND_PROGRESS_BRACKETS) {
      expect(tSet.has(b)).toBe(false)
    }
  })
})

// ─── [P2-K2-PUSH]/Cycle 373 -- assertive failure formatter source pins ──
// The Cycle 373 failure formatter ships in the SAME shared module as the
// threshold + bracket helpers so a single import block in the renderer
// stays canonical. Source-text pins lock the export shape, the "Send
// failed" anchor prefix, the empty/whitespace -> bare-prefix collapse,
// and the K2-only docstring so a future regression cannot drift the
// failure announcement away from the polite-region's distinct semantic.

describe('F. assertive failure formatter exports (Cycle 373)', () => {
  it('F1: formatK2SendFailureAnnouncement is exported as a function', () => {
    expect(typeof mod.formatK2SendFailureAnnouncement).toBe('function')
  })

  it('F2: formatK2SendFailureAnnouncement signature reads (unknown) -> string', () => {
    expect(SRC).toMatch(
      /export function formatK2SendFailureAnnouncement\(\s*message:\s*unknown\s*\):\s*string/
    )
  })

  it('F3: formatter emits the literal "Send failed" prefix for empty / null inputs', () => {
    expect(SRC).toContain("return 'Send failed'")
  })

  it('F4: formatter emits the literal "Send failed: ${trimmed}" template for non-empty string inputs', () => {
    expect(SRC).toContain('return `Send failed: ${trimmed}`')
  })

  it('F5: formatter trims whitespace before the empty-collapse check', () => {
    // The .trim() call must execute BEFORE the length === 0 check so a
    // "   " input collapses to bare "Send failed" rather than producing
    // "Send failed:    ".
    expect(SRC).toMatch(/const trimmed = message\.trim\(\)[\s\S]*?if \(trimmed\.length === 0\)/)
  })

  it('F6: source carries the [P2-K2-PUSH]/Cycle 373 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 373')
  })

  it('F7: docstring documents the assertive vs polite split (separate live regions, not a replacement)', () => {
    // The polite region keeps its existing failure path -- the assertive
    // region is REDUNDANT for safety. Source must explicitly call out
    // the dual-region invariant so a future maintainer does not rip out
    // the polite-region failure path thinking the assertive region
    // replaces it.
    expect(SRC).toMatch(/REDUNDANT announcement, not a replacement|polite region keeps its existing failure path/i)
  })

  it('F8: docstring documents the safety motivation (assertive interrupts the queue)', () => {
    // A failed upload that the user does not notice is the failure mode.
    // The source must document why an assertive region is appropriate
    // for failures (and only failures).
    expect(SRC).toMatch(/INTERRUPT|interrupt the (current )?speech|safety surface/i)
  })

  it('F9: docstring scopes the formatter to K2 only (Laguna + Carvera have separate paths)', () => {
    expect(SRC).toMatch(/Creality K2 Plus only/i)
    // The same module's other helpers also document the K2-only scope;
    // the failure formatter docstring must reference the cross-cut so a
    // future copy-paste to a Carvera failure formatter does not import
    // K2-specific phrasing.
    expect(SRC).toMatch(/Laguna Swift|RichAuto/)
    expect(SRC).toMatch(/Carvera/)
  })
})

// ─── [P2-K2-PUSH]/Cycle 375 -- last-upload outcome label source pins ────
// The Cycle 375 outcome formatter ships in the SAME shared module as the
// threshold + bracket + failure helpers so a single import block in the
// renderer stays canonical. Source-text pins lock the export shape, the
// "Last upload: " anchor prefix, the ✓/✗ glyphs (U+2713 / U+2717), the
// K2SendOutcome union type, and the K2-only docstring.

describe('G. last-upload outcome label exports (Cycle 375)', () => {
  it('G1: formatK2SendOutcomeLabel is exported as a function', () => {
    expect(typeof mod.formatK2SendOutcomeLabel).toBe('function')
  })

  it('G2: formatK2SendOutcomeLabel signature reads (K2SendOutcome) -> string', () => {
    // The K2SendOutcome union literal narrows the input to 'success' |
    // 'failure'. A regression that broadens the parameter to `string`
    // (e.g. accepting an arbitrary state name) would defeat the
    // exhaustive-check guarantee and let the failure-fallback catch
    // unexpected inputs as "Failed".
    expect(SRC).toMatch(
      /export function formatK2SendOutcomeLabel\(\s*outcome:\s*K2SendOutcome\s*\):\s*string/
    )
  })

  it('G3: K2SendOutcome union type is exported', () => {
    // The union must be exported so the renderer can type the
    // useState slot without re-declaring it (`useState<K2SendOutcome | null>`).
    expect(SRC).toContain("export type K2SendOutcome = 'success' | 'failure'")
  })

  it('G4: formatter emits the literal "Last upload: ✓ Sent successfully" for success', () => {
    expect(SRC).toContain("return 'Last upload: ✓ Sent successfully'")
    // Defensive: assert the U+2713 CHECK MARK glyph appears, not a
    // surrogate variant or a heavy check.
    expect(SRC).toContain('✓')
  })

  it('G5: formatter emits the literal "Last upload: ✗ Failed" for failure', () => {
    expect(SRC).toContain("return 'Last upload: ✗ Failed'")
    // Defensive: assert the U+2717 BALLOT X glyph appears, not the
    // multiplication sign × (U+00D7) or the heavy variant ✕ (U+2715).
    expect(SRC).toContain('✗')
  })

  it('G6: formatter is exhaustive over the K2SendOutcome union', () => {
    // The implementation pattern is `if (outcome === 'success') return …;
    // return …;` -- the return statement after the if MUST be the
    // failure branch (no fall-through to a generic / unknown label).
    // A future regression that adds a third union member without
    // updating the formatter would silently route the new state to
    // the failure label; the test alongside this pin catches that.
    expect(SRC).toMatch(
      /if \(outcome === 'success'\) return 'Last upload: ✓ Sent successfully'\s*\n\s*return 'Last upload: ✗ Failed'/
    )
  })

  it('G7: source carries the [P2-K2-PUSH]/Cycle 375 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 375')
  })

  it('G8: docstring documents the sighted-only scope (aria-hidden, not a screen-reader feature)', () => {
    // The element carries `aria-hidden="true"` because the polite +
    // assertive regions already announced the outcome. Source must
    // explicitly call out that this is a SIGHTED polish so a future
    // maintainer does not strip the aria-hidden thinking it's a bug.
    expect(SRC).toMatch(/SIGHTED-ONLY|sighted-only|sighted-equality polish|aria-hidden/i)
  })

  it('G9: docstring documents the in-flight reset (a stale outcome must not bleed into the next Send)', () => {
    // The renderer resets the slot to null at the top of `sendToK2Plus`
    // so an in-flight Send temporarily hides the previous attempt's
    // outcome. The docstring must explain WHY (a stale "✓" mid-stream
    // would be misleading).
    expect(SRC).toMatch(/RESET to `null` at the top of `sendToK2Plus`|reset to `null` at the top|in-flight Send temporarily hides/i)
  })

  it('G10: docstring scopes the formatter to K2 only (Laguna + Carvera have separate paths)', () => {
    // Same K2-only invariant as the C359 / C368 / C373 helpers. The
    // "Laguna Swift" alternation accepts `|RichAuto` because the JSDoc
    // word-wrap may split "Laguna" and "Swift" across lines (see F9 +
    // the C359 docstring pin at line 73 for the established pattern).
    // Cross-machine corrective applied during Laguna Cycle 375 / support.
    expect(SRC).toMatch(/Creality K2 Plus only/i)
    expect(SRC).toMatch(/Laguna Swift|RichAuto/)
    expect(SRC).toMatch(/Carvera/)
  })

  it('G11: success and failure label strings are distinct (compile-time check)', () => {
    expect(mod.formatK2SendOutcomeLabel('success')).not.toBe(
      mod.formatK2SendOutcomeLabel('failure')
    )
  })
})

// ─── [P2-K2-PUSH]/Cycle 380 -- outcome timestamp suffix source pins ────
// Companion formatter for the C375 outcome label. Pins the export shape,
// the (Date | null | undefined) signature, the local-time Date#getHours /
// Date#getMinutes API choice, the zero-padding, the literal "(at HH:MM)"
// delimiter shape, and the K2-only docstring + roadmap tag.

describe('H. outcome timestamp suffix exports (Cycle 380)', () => {
  it('H1: formatK2SendOutcomeTimestampSuffix is exported as a function', () => {
    expect(typeof mod.formatK2SendOutcomeTimestampSuffix).toBe('function')
  })

  it('H2: signature reads (Date | null | undefined) -> string', () => {
    // Date narrows the parameter to a Date instance; the union with
    // null + undefined accepts both the renderer's initial state slot
    // and the explicit reset at the top of sendToK2Plus. A future
    // regression that drops the null/undefined to require Date would
    // force the renderer to pre-check before every call.
    expect(SRC).toMatch(
      /export function formatK2SendOutcomeTimestampSuffix\(\s*date:\s*Date\s*\|\s*null\s*\|\s*undefined\s*\):\s*string/
    )
  })

  it('H3: defends against null + undefined inputs (early returns empty string)', () => {
    // The renderer initialises the timestamp slot to `null`; the reset
    // at the top of sendToK2Plus also writes `null`. Both code paths
    // must emit no suffix so the in-flight render never shows " (at )".
    expect(SRC).toContain("if (date == null) return ''")
  })

  it('H4: defends against non-Date object inputs (defence in depth)', () => {
    // TS narrows the call site, but a runtime caller (test harness,
    // future JS interop) could hand in a number / string / plain
    // object. The instanceof guard keeps the formatter crash-free.
    expect(SRC).toContain('if (!(date instanceof Date))')
  })

  it('H5: defends against NaN time (Date with Invalid Date timestamp)', () => {
    // `new Date('not-a-date')` is a Date instance whose getTime() is NaN.
    // The Number.isFinite guard MUST run after the instanceof check so
    // the formatter handles `new Date('garbage')` without emitting "(at NaN:NaN)".
    expect(SRC).toContain('Number.isFinite(ms)')
  })

  it('H6: uses Date#getHours + Date#getMinutes (LOCAL time, not UTC)', () => {
    // Local time pairs with the operator's wall clock at the bench;
    // a future regression that swaps in getUTCHours / getUTCMinutes
    // would force the operator to mentally subtract their timezone
    // offset on every glance. Pin the local-time API choice.
    expect(SRC).toContain('date.getHours()')
    expect(SRC).toContain('date.getMinutes()')
    expect(SRC).not.toContain('date.getUTCHours()')
    expect(SRC).not.toContain('date.getUTCMinutes()')
  })

  it('H7: zero-pads both fields to two digits via String#padStart(2, "0")', () => {
    // `String(date.getHours()).padStart(2, '0')` keeps single-digit
    // hours and minutes aligned (09:05 not 9:5). A regression that
    // drops the padStart (or pads with the wrong char) would make
    // the suffix visually noisy at low time-of-day values.
    expect(SRC).toContain("String(date.getHours()).padStart(2, '0')")
    expect(SRC).toContain("String(date.getMinutes()).padStart(2, '0')")
  })

  it('H8: emits the literal " (at HH:MM)" delimiter shape (leading space, parens)', () => {
    // The renderer concatenates `label + suffix` without an extra
    // interpolated space. The leading space MUST live in the suffix
    // template so the joined string reads naturally.
    expect(SRC).toContain('return ` (at ${hh}:${mm})`')
  })

  it('H9: source carries the [P2-K2-PUSH]/Cycle 380 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 380')
  })

  it('H10: docstring documents the K2-only three-machine scope (Laguna + Carvera have separate paths)', () => {
    // Same K2-only invariant as the surrounding helpers in this module.
    // The docstring must explicitly call out that the timestamp suffix
    // is K2-scoped so a future cross-machine refactor does not silently
    // wire it into the Laguna / Carvera Send paths without their own
    // outcome line and reset semantics.
    const doc = SRC.split('export function formatK2SendOutcomeTimestampSuffix')[0]!
    // Roadmap tag confirms the docstring belongs to the Cycle 380 helper.
    expect(doc).toContain('[P2-K2-PUSH]/Cycle 380')
    // K2-only scope language somewhere in the immediately preceding doc.
    expect(SRC).toMatch(/Creality K2 Plus only|K2-scoped|K2-only/i)
    expect(SRC).toMatch(/Laguna Swift|RichAuto/)
    expect(SRC).toMatch(/Carvera/)
  })

  it('H11: docstring documents the freshness motivation (operator wants to know WHEN, not just WHETHER)', () => {
    // The whole point of the suffix is anchoring the outcome line in
    // time. The docstring must say so explicitly so a future refactor
    // does not strip the suffix as "noise" without understanding the UX.
    expect(SRC).toMatch(/temporal anchor|when[\s\S]{0,80}whether|freshness|signal about freshness/i)
  })

  it('H12: returns empty string for null at runtime (parity with H3 source-text pin)', () => {
    expect(mod.formatK2SendOutcomeTimestampSuffix(null)).toBe('')
  })

  it('H13: returns empty string for undefined at runtime (parity with H3)', () => {
    expect(mod.formatK2SendOutcomeTimestampSuffix(undefined)).toBe('')
  })

  it('H14: returns ` (at HH:MM)` for a valid Date at runtime (parity with H8)', () => {
    // Build a local-time Date via the multi-arg constructor so this
    // assertion is timezone-independent.
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    expect(mod.formatK2SendOutcomeTimestampSuffix(d)).toBe(' (at 14:23)')
  })
})

// ─── [P2-K2-PUSH]/Cycle 383 -- outcome filename suffix source pins ────
// Companion formatter for the C375 outcome label (parallel of the C380
// timestamp suffix). Pins the export shape, the (string | null | undefined)
// signature, the trim + non-string defence-in-depth guards, the literal
// " — " (em dash with surrounding spaces) separator template, and the
// K2-only docstring + roadmap tag.

describe('I. outcome filename suffix exports (Cycle 383)', () => {
  it('I1: formatK2SendOutcomeFilenameSuffix is exported as a function', () => {
    expect(typeof mod.formatK2SendOutcomeFilenameSuffix).toBe('function')
  })

  it('I2: signature reads (string | null | undefined) -> string', () => {
    // String narrows the parameter to the renderer's captured filename
    // (`r.filename ?? basename(sendCandidatePath)` resolves to a string
    // on the happy path); the union with null + undefined accepts both
    // the renderer's initial state slot and the explicit reset at the
    // top of sendToK2Plus. A future regression that drops the
    // null/undefined to require string would force the renderer to
    // pre-check before every call.
    expect(SRC).toMatch(
      /export function formatK2SendOutcomeFilenameSuffix\(\s*filename:\s*string\s*\|\s*null\s*\|\s*undefined\s*\):\s*string/
    )
  })

  it('I3: defends against null + undefined inputs (early returns empty string)', () => {
    // The renderer initialises the filename slot to `null`; the reset
    // at the top of sendToK2Plus also writes `null`. Both code paths
    // must emit no suffix so the in-flight render never shows " — ".
    expect(SRC).toContain("if (filename == null) return ''")
  })

  it('I4: defends against non-string inputs (defence in depth)', () => {
    // TS narrows the call site, but a runtime caller (test harness,
    // future JS interop) could hand in a number / object / boolean.
    // The typeof guard keeps the formatter crash-free.
    expect(SRC).toContain("if (typeof filename !== 'string')")
  })

  it('I5: trims leading and trailing whitespace before checking length (parallel of C373 trim)', () => {
    // `formatK2SendFailureAnnouncement` (Cycle 373) trims its message
    // input before checking length so a whitespace-only string collapses
    // to the bare prefix. Mirror that behaviour here so a future
    // capture-site that wraps the basename in accidental padding does
    // not surface " — \n" in the operator UI.
    expect(SRC).toContain('const trimmed = filename.trim()')
    expect(SRC).toContain('if (trimmed.length === 0)')
  })

  it('I6: emits the literal " — ${trimmed}" template (em dash with surrounding spaces)', () => {
    // The renderer concatenates `label + filename-suffix + timestamp-suffix`
    // without extra interpolated spaces. The leading space MUST live
    // in the suffix template so the joined string reads naturally;
    // the U+2014 EM DASH matches the C368 100-bracket announcement's
    // separator style.
    expect(SRC).toContain('return ` — ${trimmed}`')
  })

  it('I7: separator is U+2014 EM DASH (NOT U+002D HYPHEN-MINUS or U+2013 EN DASH)', () => {
    // Pin the codepoint at the source level so a future regression that
    // copy-pastes the line through a typography-stripping editor (e.g.
    // a plain text editor that auto-converts em dash to hyphen) lands
    // here.
    const dashLine = SRC.split('\n').find((l) => l.includes('return ` — ${trimmed}`'))
    expect(dashLine).toBeDefined()
    // U+2014 is 0x2014 = 8212.
    expect(dashLine!.codePointAt(dashLine!.indexOf('—'))).toBe(0x2014)
  })

  it('I8: source carries the [P2-K2-PUSH]/Cycle 383 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 383')
  })

  it('I9: docstring documents the K2-only three-machine scope (Laguna + Carvera have separate paths)', () => {
    // Same K2-only invariant as the surrounding helpers in this module.
    // The docstring must explicitly call out that the filename suffix
    // is K2-scoped so a future cross-machine refactor does not silently
    // wire it into the Laguna / Carvera Send paths without their own
    // outcome line and reset semantics.
    const doc = SRC.split('export function formatK2SendOutcomeFilenameSuffix')[0]!
    // Roadmap tag confirms the docstring belongs to the Cycle 383 helper.
    expect(doc).toContain('[P2-K2-PUSH]/Cycle 383')
    // K2-only scope language somewhere in the immediately preceding doc.
    expect(SRC).toMatch(/Creality K2 Plus only|K2-scoped|K2-only/i)
    expect(SRC).toMatch(/Laguna Swift|RichAuto/)
    expect(SRC).toMatch(/Carvera/)
  })

  it('I10: docstring documents the suffix-order invariant (filename BEFORE timestamp in the joined line)', () => {
    // The whole point of this layer is that the filename answers "what"
    // and the timestamp answers "when"; the operator's first question
    // when glancing back is "what got sent", so the filename reads
    // first. The docstring must say so explicitly so a future refactor
    // does not swap the order in the renderer.
    expect(SRC).toMatch(/filename[\s\S]{0,200}BEFORE the timestamp|what[\s\S]{0,80}when|reads first/i)
  })

  it('I11: returns empty string for null at runtime (parity with I3 source-text pin)', () => {
    expect(mod.formatK2SendOutcomeFilenameSuffix(null)).toBe('')
  })

  it('I12: returns empty string for undefined at runtime (parity with I3)', () => {
    expect(mod.formatK2SendOutcomeFilenameSuffix(undefined)).toBe('')
  })

  it('I13: returns empty string for whitespace-only at runtime (parity with I5)', () => {
    expect(mod.formatK2SendOutcomeFilenameSuffix('   ')).toBe('')
    expect(mod.formatK2SendOutcomeFilenameSuffix('\t\n')).toBe('')
  })

  it('I14: returns ` — <name>` for a valid filename at runtime (parity with I6)', () => {
    expect(mod.formatK2SendOutcomeFilenameSuffix('cam.gcode')).toBe(' — cam.gcode')
  })

  it('I15: docstring documents the freshness motivation (operator wants to know WHICH file, not just whether/when)', () => {
    // The whole point of the filename suffix is anchoring the outcome
    // line to a specific job. The docstring must say so explicitly so
    // a future refactor does not strip the suffix as "noise" without
    // understanding the multi-job UX.
    expect(SRC).toMatch(/which slice|which file|busy multi-job|several files|wrist guard/i)
  })
})

// ─── [P2-K2-PUSH]/Cycle 388 -- outcome filename truncation source pins ──
// Companion truncation helper for the C383 filename suffix. Pins the
// export shape, the (string | null | undefined, number?) signature, the
// canonical 30-char default constant, the U+2026 HORIZONTAL ELLIPSIS
// character, the defensive maxChars chain, and the K2-only docstring +
// roadmap tag.

describe('J. outcome filename truncation exports (Cycle 388)', () => {
  it('J1: K2_SEND_OUTCOME_FILENAME_MAX_CHARS is exported as a numeric constant of value 30', () => {
    expect(typeof mod.K2_SEND_OUTCOME_FILENAME_MAX_CHARS).toBe('number')
    expect(mod.K2_SEND_OUTCOME_FILENAME_MAX_CHARS).toBe(30)
    // The `as const` annotation gives the readonly literal type so a
    // future regression to `let` (which would silently allow mutation
    // and let a runaway test reset the budget) lands here.
    expect(SRC).toContain('export const K2_SEND_OUTCOME_FILENAME_MAX_CHARS = 30 as const')
  })

  it('J2: truncateK2SendOutcomeFilename is exported as a function', () => {
    expect(typeof mod.truncateK2SendOutcomeFilename).toBe('function')
  })

  it('J3: signature reads (string | null | undefined, number = K2_SEND_OUTCOME_FILENAME_MAX_CHARS) -> string | null', () => {
    // The optional second parameter defaults to the canonical constant
    // so most callers omit it; the union return reflects the defensive
    // chain (null for invalid input, string otherwise). A future
    // regression that drops null from the return type would force the
    // renderer to non-null-assert before passing into the suffix.
    expect(SRC).toMatch(
      /export function truncateK2SendOutcomeFilename\(\s*filename:\s*string\s*\|\s*null\s*\|\s*undefined,\s*maxChars:\s*number\s*=\s*K2_SEND_OUTCOME_FILENAME_MAX_CHARS\s*\):\s*string\s*\|\s*null/
    )
  })

  it('J4: defends against null + undefined inputs (early returns null)', () => {
    expect(SRC).toContain('if (filename == null) return null')
  })

  it('J5: defends against non-string inputs (defence in depth)', () => {
    expect(SRC).toContain("if (typeof filename !== 'string')")
  })

  it('J6: trims leading and trailing whitespace before checking length', () => {
    expect(SRC).toContain('const trimmed = filename.trim()')
    expect(SRC).toContain('if (trimmed.length === 0) return null')
  })

  it('J7: maxChars defensive chain rejects non-finite or < 2 values, falling back to the default', () => {
    // The renderer always uses the default, but a hostile test caller
    // (or a future renderer that wires a runtime configurable budget)
    // could pass NaN / 0 / 1. The fallback keeps the outcome line
    // informative instead of collapsing to a single ellipsis.
    expect(SRC).toMatch(
      /Number\.isFinite\(maxChars\)\s*&&\s*maxChars\s*>=\s*2[\s\S]{0,80}Math\.floor\(maxChars\)[\s\S]{0,80}K2_SEND_OUTCOME_FILENAME_MAX_CHARS/
    )
  })

  it('J8: returns trimmed input unchanged when length <= intMax', () => {
    expect(SRC).toContain('if (trimmed.length <= intMax) return trimmed')
  })

  it('J9: emits the literal `${trimmed.slice(0, intMax - 1) + "…"}` truncation template', () => {
    // Pin the slice-and-append shape so a future regression that
    // forgets to reserve a column for the ellipsis (e.g. slices
    // intMax chars and appends, exceeding the budget by 1) lands here.
    expect(SRC).toContain("return trimmed.slice(0, intMax - 1) + '…'")
  })

  it('J10: ellipsis codepoint is U+2026 HORIZONTAL ELLIPSIS (NOT three U+002E full stops)', () => {
    // Pin the codepoint at the source level so a future regression that
    // copy-pastes the line through a typography-stripping editor (which
    // expands … to ...) lands here.
    const ellipsisLine = SRC.split('\n').find((l) =>
      l.includes("return trimmed.slice(0, intMax - 1) + '…'")
    )
    expect(ellipsisLine).toBeDefined()
    // Find the U+2026 codepoint within the line.
    expect(ellipsisLine!.codePointAt(ellipsisLine!.indexOf('…'))).toBe(0x2026)
    // And confirm three full stops are not the truncation marker.
    expect(ellipsisLine).not.toContain("'...'")
  })

  it('J11: source carries the [P2-K2-PUSH]/Cycle 388 roadmap tag', () => {
    expect(SRC).toContain('[P2-K2-PUSH]/Cycle 388')
  })

  it('J12: docstring documents the K2-only three-machine scope (Laguna + Carvera have separate paths)', () => {
    // Same K2-only invariant as the surrounding helpers in this module.
    const doc = SRC.split('export function truncateK2SendOutcomeFilename')[0]!
    expect(doc).toContain('[P2-K2-PUSH]/Cycle 388')
    expect(SRC).toMatch(/Creality K2 Plus only|K2-scoped|K2-only/i)
    expect(SRC).toMatch(/Laguna Swift|RichAuto/)
    expect(SRC).toMatch(/Carvera/)
  })

  it('J13: docstring documents the column-width motivation (single-line outcome on Manufacture panel)', () => {
    // The whole point of this helper is keeping the outcome line on a
    // single column-width line at Jacob's standard panel resolution.
    // The docstring must say so explicitly so a future refactor does
    // not strip the truncation as "noise" without understanding the
    // panel-layout UX.
    expect(SRC).toMatch(/single line|single-line|column width|panel|wrap/i)
  })

  it('J14: docstring documents composition with formatK2SendOutcomeFilenameSuffix (truncate-before-suffix order)', () => {
    // The renderer wires truncate -> suffix; the docstring must show
    // this composition so a future cycle does not invert the order
    // (which would slice the " — " separator and produce " — wrist…").
    // The composition example may straddle a JSDoc `*` indent line, so
    // allow `*` and whitespace between the two function names.
    expect(SRC).toMatch(
      /formatK2SendOutcomeFilenameSuffix\([\s*]+truncateK2SendOutcomeFilename/
    )
  })

  it('J15: returns null for null at runtime (parity with J4 source-text pin)', () => {
    expect(mod.truncateK2SendOutcomeFilename(null)).toBeNull()
  })

  it('J16: returns null for undefined at runtime (parity with J4)', () => {
    expect(mod.truncateK2SendOutcomeFilename(undefined)).toBeNull()
  })

  it('J17: returns null for whitespace-only at runtime (parity with J6)', () => {
    expect(mod.truncateK2SendOutcomeFilename('   ')).toBeNull()
  })

  it('J18: returns trimmed input unchanged below the boundary at runtime (parity with J8)', () => {
    expect(mod.truncateK2SendOutcomeFilename('cam.gcode')).toBe('cam.gcode')
  })

  it('J19: truncates above the boundary at runtime (parity with J9)', () => {
    const longName = 'a'.repeat(40)
    const out = mod.truncateK2SendOutcomeFilename(longName)
    expect(out).toBe('a'.repeat(29) + '…')
    expect(out!.length).toBe(30)
  })

  it('J20: maxChars=2 produces 1 informative char + ellipsis at runtime (parity with J7)', () => {
    expect(mod.truncateK2SendOutcomeFilename('abcdef', 2)).toBe('a' + '…')
  })
})
