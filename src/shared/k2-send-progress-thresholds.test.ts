/**
 * Phase 2 [P2-K2-PUSH]/Cycle 359 -- behavioural tests for the K2 Plus
 * Send polite-announcement threshold helpers. Covers the pure
 * threshold-crossing detection function and the announcement
 * formatter. Source-text (export shape, immutability of the threshold
 * tuple, JSDoc roadmap tag) is pinned separately in
 * `k2-send-progress-thresholds-pin.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  K2_SEND_OUTCOME_FILENAME_MAX_CHARS,
  K2_SEND_PROGRESS_BRACKETS,
  K2_SEND_PROGRESS_THRESHOLDS,
  formatK2SendBracketAnnouncement,
  formatK2SendFailureAnnouncement,
  formatK2SendOutcomeFilenameSuffix,
  formatK2SendOutcomeLabel,
  formatK2SendOutcomeTimestampSuffix,
  formatK2SendThresholdAnnouncement,
  k2SendBracketsCrossed,
  k2SendThresholdsCrossed,
  truncateK2SendOutcomeFilename
} from './k2-send-progress-thresholds'

describe('K2_SEND_PROGRESS_THRESHOLDS constant', () => {
  it('is the ascending tuple [25, 50, 75] (no 0 / no 100)', () => {
    expect([...K2_SEND_PROGRESS_THRESHOLDS]).toEqual([25, 50, 75])
  })

  it('values are strictly ascending', () => {
    for (let i = 1; i < K2_SEND_PROGRESS_THRESHOLDS.length; i++) {
      expect(K2_SEND_PROGRESS_THRESHOLDS[i]).toBeGreaterThan(
        K2_SEND_PROGRESS_THRESHOLDS[i - 1]!
      )
    }
  })

  it('all values are in (0, 100) -- 0%/100% are reserved for start/terminal events', () => {
    for (const t of K2_SEND_PROGRESS_THRESHOLDS) {
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThan(100)
    }
  })
})

describe('k2SendThresholdsCrossed', () => {
  it('returns [] for percent below the lowest threshold', () => {
    expect(k2SendThresholdsCrossed(0, new Set())).toEqual([])
    expect(k2SendThresholdsCrossed(10, new Set())).toEqual([])
    expect(k2SendThresholdsCrossed(24, new Set())).toEqual([])
    // Boundary: 24.999 rounded by the renderer would be 24, still below 25.
    expect(k2SendThresholdsCrossed(24.999, new Set())).toEqual([])
  })

  it('returns [25] when percent is exactly 25 and nothing announced yet', () => {
    expect(k2SendThresholdsCrossed(25, new Set())).toEqual([25])
  })

  it('returns [25] for percent in [25, 50)', () => {
    expect(k2SendThresholdsCrossed(25.5, new Set())).toEqual([25])
    expect(k2SendThresholdsCrossed(40, new Set())).toEqual([25])
    expect(k2SendThresholdsCrossed(49, new Set())).toEqual([25])
  })

  it('returns [25, 50] sorted ascending when percent crosses both', () => {
    expect(k2SendThresholdsCrossed(60, new Set())).toEqual([25, 50])
  })

  it('returns [25, 50, 75] sorted ascending for percent >= 75 with empty announced set', () => {
    expect(k2SendThresholdsCrossed(75, new Set())).toEqual([25, 50, 75])
    expect(k2SendThresholdsCrossed(99, new Set())).toEqual([25, 50, 75])
    expect(k2SendThresholdsCrossed(100, new Set())).toEqual([25, 50, 75])
  })

  it('skips thresholds already in the announced set (idempotent across ticks)', () => {
    expect(k2SendThresholdsCrossed(60, new Set([25]))).toEqual([50])
    expect(k2SendThresholdsCrossed(80, new Set([25, 50]))).toEqual([75])
    expect(k2SendThresholdsCrossed(95, new Set([25, 50, 75]))).toEqual([])
  })

  it('returns [50, 75] when caller missed 50%-crossing tick but caught 75%', () => {
    // Realistic Moonraker case: a single chunk straddles two thresholds.
    // The renderer should still announce the lower threshold first so a
    // screen reader hears "...50%..." then "...75%..." in order.
    expect(k2SendThresholdsCrossed(80, new Set([25]))).toEqual([50, 75])
  })

  it('returns [] for non-finite percent (defence in depth)', () => {
    expect(k2SendThresholdsCrossed(Number.NaN, new Set())).toEqual([])
    expect(k2SendThresholdsCrossed(Number.POSITIVE_INFINITY, new Set())).toEqual([])
    expect(k2SendThresholdsCrossed(Number.NEGATIVE_INFINITY, new Set())).toEqual([])
  })

  it('returns [] for negative percent (the renderer clamps but defence in depth)', () => {
    expect(k2SendThresholdsCrossed(-10, new Set())).toEqual([])
  })

  it('does not mutate the alreadyAnnounced set', () => {
    const announced = new Set([25])
    k2SendThresholdsCrossed(80, announced)
    expect([...announced].sort((a, b) => a - b)).toEqual([25])
  })

  it('returns a fresh array on each call (no shared mutable state)', () => {
    const r1 = k2SendThresholdsCrossed(60, new Set())
    const r2 = k2SendThresholdsCrossed(60, new Set())
    expect(r1).not.toBe(r2)
    expect(r1).toEqual(r2)
  })
})

describe('formatK2SendThresholdAnnouncement', () => {
  it('formats 25 as "Uploading to K2 Plus: 25%…"', () => {
    expect(formatK2SendThresholdAnnouncement(25)).toBe('Uploading to K2 Plus: 25%…')
  })

  it('formats 50 as "Uploading to K2 Plus: 50%…"', () => {
    expect(formatK2SendThresholdAnnouncement(50)).toBe('Uploading to K2 Plus: 50%…')
  })

  it('formats 75 as "Uploading to K2 Plus: 75%…"', () => {
    expect(formatK2SendThresholdAnnouncement(75)).toBe('Uploading to K2 Plus: 75%…')
  })

  it('uses the U+2026 horizontal ellipsis character (matches start-of-upload message)', () => {
    // The C354 start-of-upload message is "Uploading to K2 Plus…" (U+2026).
    // Threshold messages must use the same ellipsis so a screen reader
    // renders the trail-off identically.
    const msg = formatK2SendThresholdAnnouncement(25)
    expect(msg.endsWith('…')).toBe(true)
    // And not three ASCII dots.
    expect(msg.endsWith('...')).toBe(false)
  })

  it('preserves the "Uploading to K2 Plus" prefix from the C354 start message', () => {
    // Continuity with the C354 polite live-region. A future regression
    // that drops the prefix (e.g. bare "25% uploaded") would break the
    // narrative coherence the live region provides.
    for (const t of K2_SEND_PROGRESS_THRESHOLDS) {
      expect(formatK2SendThresholdAnnouncement(t)).toMatch(/^Uploading to K2 Plus: /)
    }
  })
})

// ─── [P2-K2-PUSH]/Cycle 368 bracket helpers ──────────────────────────────
// Brackets fire at 0% (start of byte transfer) and 100% (terminal moment
// between meter-100% and the start_print acknowledgment). Pure helpers
// mirror the threshold-helper shape so the renderer can track brackets
// in a parallel useRef<Set<number>> and announce the highest bracket on
// each tick alongside the existing threshold logic.

describe('K2_SEND_PROGRESS_BRACKETS constant (Cycle 368)', () => {
  it('is the ascending tuple [0, 100]', () => {
    expect([...K2_SEND_PROGRESS_BRACKETS]).toEqual([0, 100])
  })

  it('values are strictly ascending', () => {
    for (let i = 1; i < K2_SEND_PROGRESS_BRACKETS.length; i++) {
      expect(K2_SEND_PROGRESS_BRACKETS[i]).toBeGreaterThan(
        K2_SEND_PROGRESS_BRACKETS[i - 1]!
      )
    }
  })

  it('does NOT overlap with K2_SEND_PROGRESS_THRESHOLDS (0/100 vs. 25/50/75)', () => {
    const tSet = new Set<number>(K2_SEND_PROGRESS_THRESHOLDS)
    for (const b of K2_SEND_PROGRESS_BRACKETS) {
      expect(tSet.has(b)).toBe(false)
    }
  })
})

describe('k2SendBracketsCrossed (Cycle 368)', () => {
  it('returns [0] for percent=0 with empty announced set', () => {
    expect(k2SendBracketsCrossed(0, new Set())).toEqual([0])
  })

  it('returns [0] for percent in (0, 100) with empty announced set (first-tick semantics)', () => {
    // The Moonraker chunked uploader writes the FIRST chunk before
    // invoking onProgress, so the very first tick can carry any
    // percent from 1..99. The 0-bracket is meant to fire on whichever
    // first tick arrives -- "Upload starting" confirms the IPC
    // channel is alive regardless of chunk size.
    expect(k2SendBracketsCrossed(1, new Set())).toEqual([0])
    expect(k2SendBracketsCrossed(5, new Set())).toEqual([0])
    expect(k2SendBracketsCrossed(50, new Set())).toEqual([0])
    expect(k2SendBracketsCrossed(99, new Set())).toEqual([0])
  })

  it('returns [0, 100] sorted ascending when percent=100 with empty announced set', () => {
    expect(k2SendBracketsCrossed(100, new Set())).toEqual([0, 100])
  })

  it('returns [100] when percent=100 and 0-bracket already announced', () => {
    expect(k2SendBracketsCrossed(100, new Set([0]))).toEqual([100])
  })

  it('returns [] when both brackets already announced (idempotent across ticks)', () => {
    expect(k2SendBracketsCrossed(100, new Set([0, 100]))).toEqual([])
    expect(k2SendBracketsCrossed(50, new Set([0, 100]))).toEqual([])
  })

  it('returns [] for percent below 0 (defence in depth, renderer also clamps)', () => {
    expect(k2SendBracketsCrossed(-1, new Set())).toEqual([])
    expect(k2SendBracketsCrossed(-100, new Set())).toEqual([])
  })

  it('returns [] for non-finite percent (defence in depth)', () => {
    expect(k2SendBracketsCrossed(Number.NaN, new Set())).toEqual([])
    expect(k2SendBracketsCrossed(Number.POSITIVE_INFINITY, new Set())).toEqual([])
    expect(k2SendBracketsCrossed(Number.NEGATIVE_INFINITY, new Set())).toEqual([])
  })

  it('does not mutate the alreadyAnnounced set', () => {
    const announced = new Set([0])
    k2SendBracketsCrossed(100, announced)
    expect([...announced].sort((a, b) => a - b)).toEqual([0])
  })

  it('returns a fresh array on each call (no shared mutable state)', () => {
    const r1 = k2SendBracketsCrossed(50, new Set())
    const r2 = k2SendBracketsCrossed(50, new Set())
    expect(r1).not.toBe(r2)
    expect(r1).toEqual(r2)
  })
})

describe('formatK2SendBracketAnnouncement (Cycle 368)', () => {
  it('formats 0 as "Upload starting"', () => {
    expect(formatK2SendBracketAnnouncement(0)).toBe('Upload starting')
  })

  it('formats 100 as "Upload complete — printer beginning the job"', () => {
    expect(formatK2SendBracketAnnouncement(100)).toBe(
      'Upload complete — printer beginning the job'
    )
  })

  it('uses U+2014 EM DASH in the 100-bracket message (not a hyphen-minus)', () => {
    const msg = formatK2SendBracketAnnouncement(100)
    expect(msg).toContain('—') // U+2014
    // Defensive: a future regression that swaps for a hyphen-minus
    // would alter screen-reader pacing and pronunciation.
    expect(msg).not.toContain(' - ')
    // ASCII double-hyphen also explicitly rejected.
    expect(msg).not.toContain('--')
  })

  it('falls back to a generic "Upload progress: N%" phrase for non-bracket inputs (defence in depth)', () => {
    // The const tuple is [0, 100]; this branch is unreachable in
    // production but provides a generic phrase for any future bracket
    // addition that forgets to update the formatter.
    expect(formatK2SendBracketAnnouncement(50)).toBe('Upload progress: 50%')
    expect(formatK2SendBracketAnnouncement(25)).toBe('Upload progress: 25%')
  })

  it('production branches do NOT share the threshold formatter prefix (different semantic)', () => {
    // "Uploading to K2 Plus: N%…" (threshold) vs "Upload starting" /
    // "Upload complete — printer beginning the job" (bracket) -- the
    // brackets describe DISTINCT moments and must read distinctly.
    expect(formatK2SendBracketAnnouncement(0)).not.toMatch(/^Uploading to K2 Plus/)
    expect(formatK2SendBracketAnnouncement(100)).not.toMatch(/^Uploading to K2 Plus/)
  })
})

// ─── [P2-K2-PUSH]/Cycle 373 assertive failure announcement ──────────────
// Cycle 373 adds a SECOND live region (aria-live="assertive" + role="alert")
// dedicated to FAILURE events on the K2 Send path. The polite region
// queues announcements until the screen reader is idle, which on a long
// upload can stack mid-stream threshold messages AHEAD of a terminal
// failure. The assertive region INTERRUPTS to deliver the failure
// immediately. The pure formatter here builds the announcement string;
// the renderer wires the state and the live region.

describe('formatK2SendFailureAnnouncement (Cycle 373)', () => {
  it('formats a plain message as "Send failed: <message>"', () => {
    expect(formatK2SendFailureAnnouncement('Connection refused')).toBe(
      'Send failed: Connection refused'
    )
  })

  it('formats a Moonraker-style "<error>: <detail>" message inline', () => {
    // The C354 polite-region failure path already routes through
    // `formatMoonrakerPushFailure(r)` which produces strings like
    // "fileUploadFailed: 503 Service Unavailable". The assertive
    // region wraps that with the "Send failed:" anchor.
    expect(formatK2SendFailureAnnouncement('fileUploadFailed: 503 Service Unavailable')).toBe(
      'Send failed: fileUploadFailed: 503 Service Unavailable'
    )
  })

  it('returns the bare "Send failed" prefix for an empty string', () => {
    expect(formatK2SendFailureAnnouncement('')).toBe('Send failed')
  })

  it('returns the bare "Send failed" prefix for a whitespace-only string', () => {
    expect(formatK2SendFailureAnnouncement('   ')).toBe('Send failed')
    expect(formatK2SendFailureAnnouncement('\t\n')).toBe('Send failed')
  })

  it('trims leading and trailing whitespace from a non-empty message', () => {
    // Renderer-side defence in depth: a message that arrives with
    // stray whitespace from a Moonraker proxy or an `Error.message`
    // should still produce a clean colon-separated announcement.
    expect(formatK2SendFailureAnnouncement('  Connection refused  ')).toBe(
      'Send failed: Connection refused'
    )
  })

  it('does NOT trim internal whitespace within the message', () => {
    expect(formatK2SendFailureAnnouncement('Connection  refused')).toBe(
      'Send failed: Connection  refused'
    )
  })

  it('coerces non-string input via String() (defence in depth)', () => {
    // The renderer catch block stringifies thrown values via
    // `e instanceof Error ? e.message : String(e)`, but the
    // formatter is a final defensive layer.
    expect(formatK2SendFailureAnnouncement(42 as unknown as string)).toBe('Send failed: 42')
    expect(formatK2SendFailureAnnouncement(true as unknown as string)).toBe(
      'Send failed: true'
    )
  })

  it('returns the bare "Send failed" prefix for null / undefined input', () => {
    // Defensive: a future caller that forgets to coerce a thrown
    // `null` / `undefined` value still gets a sensible announcement
    // rather than "Send failed: null".
    expect(formatK2SendFailureAnnouncement(null as unknown as string)).toBe('Send failed')
    expect(formatK2SendFailureAnnouncement(undefined as unknown as string)).toBe('Send failed')
  })

  it('uses a colon-space separator (consistent with Moonraker formatter prefix style)', () => {
    const out = formatK2SendFailureAnnouncement('X')
    expect(out).toContain(': ')
    expect(out.startsWith('Send failed: ')).toBe(true)
  })

  it('result starts with "Send failed" for every supported input shape', () => {
    // Anchor invariant: a screen reader hearing the assertive region
    // should always start with "Send failed" so the user has a clear
    // failure cue before the (variable) detail. A future regression
    // that drops the anchor (e.g. "Error: <msg>") would force every
    // user to re-learn the failure phrasing.
    for (const input of ['Connection refused', '', '   ', null, undefined, 42]) {
      const out = formatK2SendFailureAnnouncement(input as unknown as string)
      expect(out.startsWith('Send failed')).toBe(true)
    }
  })

  it('is deterministic and idempotent for repeated calls with the same input', () => {
    const r1 = formatK2SendFailureAnnouncement('Connection refused')
    const r2 = formatK2SendFailureAnnouncement('Connection refused')
    expect(r1).toBe(r2)
  })

  it('does NOT share the polite formatters\' prefixes (distinct semantic)', () => {
    // "Uploading to K2 Plus: …" (threshold) / "Upload starting" /
    // "Upload complete …" (bracket) all describe IN-PROGRESS or
    // SUCCESS states. The failure formatter must read distinctly so
    // a screen reader hearing "Send failed:" cannot be confused with
    // a polite progress update.
    const out = formatK2SendFailureAnnouncement('anything')
    expect(out).not.toMatch(/^Uploading to K2 Plus/)
    expect(out).not.toMatch(/^Upload starting/)
    expect(out).not.toMatch(/^Upload complete/)
  })
})

// ─── [P2-K2-PUSH]/Cycle 375 last-upload outcome label ──────────────────
// Cycle 375 adds a tiny sighted-only outcome summary line that surfaces
// a clear ✓ / ✗ glyph plus a brief label after each completed Send.
// The pure formatter here builds the label string; the renderer wires
// the state slot, the aria-hidden element, and the data-state attribute.

describe('formatK2SendOutcomeLabel (Cycle 375)', () => {
  it('formats a success outcome as "Last upload: ✓ Sent successfully"', () => {
    expect(formatK2SendOutcomeLabel('success')).toBe('Last upload: ✓ Sent successfully')
  })

  it('formats a failure outcome as "Last upload: ✗ Failed"', () => {
    expect(formatK2SendOutcomeLabel('failure')).toBe('Last upload: ✗ Failed')
  })

  it('success label uses the U+2713 CHECK MARK glyph (not U+221A square root)', () => {
    // ✓ U+2713 is the visually-balanced check mark widely supported on
    // both system and web fonts; ✔ U+2714 is the heavy variant which
    // some terminals render as a square. Pin to the lighter glyph.
    expect(formatK2SendOutcomeLabel('success')).toContain('✓')
    // Defensive: must NOT use the square root sign or a different
    // check-mark codepoint that screen readers would speak as "square".
    expect(formatK2SendOutcomeLabel('success')).not.toContain('√')
    expect(formatK2SendOutcomeLabel('success')).not.toContain('✔')
  })

  it('failure label uses the U+2717 BALLOT X glyph (not U+00D7 multiplication sign)', () => {
    // ✗ U+2717 is the ballot-X paired with ✓ U+2713 in established
    // outcome-indicator pairs. Pin to that codepoint so a future
    // refactor that "modernizes" the glyph to U+2715 / U+2716 / × does
    // not silently change the screen-reader rendering for users who
    // skim with a TalkBack-style preview.
    expect(formatK2SendOutcomeLabel('failure')).toContain('✗')
    expect(formatK2SendOutcomeLabel('failure')).not.toContain('×')
    expect(formatK2SendOutcomeLabel('failure')).not.toContain('✕')
  })

  it('both labels share the "Last upload: " prefix anchor', () => {
    expect(formatK2SendOutcomeLabel('success').startsWith('Last upload: ')).toBe(true)
    expect(formatK2SendOutcomeLabel('failure').startsWith('Last upload: ')).toBe(true)
  })

  it('is deterministic and idempotent for repeated calls with the same input', () => {
    const r1s = formatK2SendOutcomeLabel('success')
    const r2s = formatK2SendOutcomeLabel('success')
    expect(r1s).toBe(r2s)
    const r1f = formatK2SendOutcomeLabel('failure')
    const r2f = formatK2SendOutcomeLabel('failure')
    expect(r1f).toBe(r2f)
  })

  it('success and failure labels are distinct strings (no accidental glyph collision)', () => {
    // Defensive: a future regression that copy-pastes the success
    // branch into the failure branch (or vice versa) would silently
    // route both outcome states to the same label.
    expect(formatK2SendOutcomeLabel('success')).not.toBe(formatK2SendOutcomeLabel('failure'))
  })

  it('does NOT share the polite formatters\' prefixes (distinct semantic)', () => {
    // The outcome label is a sighted-only "summary" line, NOT a live
    // region announcement -- it must not start with the threshold /
    // bracket / failure prefixes so a future regression that wires the
    // outcome label into a live region by accident does not silently
    // collide with the polite-region's existing failure phrasing.
    const success = formatK2SendOutcomeLabel('success')
    const failure = formatK2SendOutcomeLabel('failure')
    for (const out of [success, failure]) {
      expect(out).not.toMatch(/^Uploading to K2 Plus/)
      expect(out).not.toMatch(/^Upload starting/)
      expect(out).not.toMatch(/^Upload complete/)
      expect(out).not.toMatch(/^Send failed/)
    }
  })

  it('failure label uses the literal word "Failed" (anchored capitalisation)', () => {
    // The capitalised "Failed" pairs with the assertive region's "Send
    // failed:" prefix at a glance; lowercase "failed" would visually
    // diverge from the C373 phrasing for sighted users skimming the
    // panel. Anchor the capital F.
    expect(formatK2SendOutcomeLabel('failure')).toContain('Failed')
  })

  it('success label includes the word "successfully" for screen-reader clarity if surfaced unwrapped', () => {
    // The renderer wraps this label in `aria-hidden="true"` so screen
    // readers do not re-announce it. But a future caller that reuses
    // the formatter for a screen-reader-visible context (e.g. a toast
    // log) would benefit from the explicit success word. Defensive:
    // assert the success label includes "successfully" so a future
    // refactor cannot drop it to a bare "Sent" that loses semantic.
    expect(formatK2SendOutcomeLabel('success').toLowerCase()).toContain('successfully')
  })
})

// ─── [P2-K2-PUSH]/Cycle 380 -- timestamp suffix behaviour ─────────────
// Companion formatter for the C375 outcome label. Returns ` (at HH:MM)`
// for a valid Date input (zero-padded local-time hours and minutes) and
// the empty string for null / undefined / non-Date / NaN-time inputs.
// The renderer concatenates the suffix into the existing JSX so a stale
// outcome line never shows up undated.
describe('formatK2SendOutcomeTimestampSuffix (Cycle 380)', () => {
  it('returns empty string for null (initial state slot)', () => {
    // The renderer initialises k2SendLastOutcomeAt to `null` and resets
    // it to `null` at the top of sendToK2Plus. Both code paths must
    // produce no suffix so the in-flight render is "Last upload: ✓ Sent
    // successfully" without a dangling " (at )".
    expect(formatK2SendOutcomeTimestampSuffix(null)).toBe('')
  })

  it('returns empty string for undefined (defensive)', () => {
    expect(formatK2SendOutcomeTimestampSuffix(undefined)).toBe('')
  })

  it('returns empty string for a Date with NaN time', () => {
    // `new Date('not-a-date')` produces a Date whose getTime() is NaN.
    // A future regression that captures `new Date(stringFromIPC)`
    // could land here; the formatter must NOT crash or emit "(at NaN:NaN)".
    const bad = new Date('not-a-date')
    expect(Number.isNaN(bad.getTime())).toBe(true)
    expect(formatK2SendOutcomeTimestampSuffix(bad)).toBe('')
  })

  it('returns empty string for a non-Date object (defence in depth)', () => {
    // TypeScript narrows the call site, but a runtime caller (e.g. a
    // test harness or a future JS interop) could hand in a number /
    // string / plain object. Defensive empty string keeps the renderer
    // crash-free.
    expect(formatK2SendOutcomeTimestampSuffix(0 as unknown as Date)).toBe('')
    expect(
      formatK2SendOutcomeTimestampSuffix('2026-05-07T20:14:00Z' as unknown as Date)
    ).toBe('')
    expect(
      formatK2SendOutcomeTimestampSuffix({ getTime: () => 0 } as unknown as Date)
    ).toBe('')
  })

  it('formats a single-digit hour with zero-padding (09:05 local)', () => {
    // Build a Date object at 09:05 LOCAL TIME using the local-time
    // constructor so the test is timezone-independent (the formatter
    // reads getHours / getMinutes which return local-time values).
    const d = new Date(2026, 4, 7, 9, 5, 0, 0) // 2026-05-07 09:05:00 local
    expect(formatK2SendOutcomeTimestampSuffix(d)).toBe(' (at 09:05)')
  })

  it('formats a top-of-day boundary (23:59 local)', () => {
    const d = new Date(2026, 4, 7, 23, 59, 0, 0)
    expect(formatK2SendOutcomeTimestampSuffix(d)).toBe(' (at 23:59)')
  })

  it('formats a start-of-day boundary (00:00 local)', () => {
    const d = new Date(2026, 4, 7, 0, 0, 0, 0)
    expect(formatK2SendOutcomeTimestampSuffix(d)).toBe(' (at 00:00)')
  })

  it('formats a single-digit minute with zero-padding (14:03 local)', () => {
    const d = new Date(2026, 4, 7, 14, 3, 0, 0)
    expect(formatK2SendOutcomeTimestampSuffix(d)).toBe(' (at 14:03)')
  })

  it('uses 24-hour format (no AM/PM marker)', () => {
    const morning = new Date(2026, 4, 7, 8, 30, 0, 0)
    const evening = new Date(2026, 4, 7, 20, 30, 0, 0)
    expect(formatK2SendOutcomeTimestampSuffix(morning)).toBe(' (at 08:30)')
    expect(formatK2SendOutcomeTimestampSuffix(evening)).toBe(' (at 20:30)')
    // Defensive: assert no AM/PM tokens leaked into either suffix.
    for (const d of [morning, evening]) {
      const out = formatK2SendOutcomeTimestampSuffix(d)
      expect(out).not.toContain('AM')
      expect(out).not.toContain('PM')
      expect(out).not.toContain('am')
      expect(out).not.toContain('pm')
    }
  })

  it('output starts with a leading space (renderer concatenates without extra space)', () => {
    // The renderer reads `formatK2SendOutcomeLabel(...) + formatK2SendOutcomeTimestampSuffix(...)`
    // without an extra interpolated space. The leading space MUST live
    // in the suffix so the concatenation reads naturally.
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    expect(formatK2SendOutcomeTimestampSuffix(d).startsWith(' ')).toBe(true)
  })

  it('output uses literal "(at " prefix and ")" suffix delimiters', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const out = formatK2SendOutcomeTimestampSuffix(d)
    expect(out).toContain('(at ')
    expect(out.endsWith(')')).toBe(true)
  })

  it('uses HH:MM colon separator (single colon, no seconds, no slash)', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const out = formatK2SendOutcomeTimestampSuffix(d)
    const colons = (out.match(/:/g) ?? []).length
    expect(colons).toBe(1)
    expect(out).not.toContain(':00')
    expect(out).not.toContain('/')
  })

  it('is deterministic for the same Date input (pure function)', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    expect(formatK2SendOutcomeTimestampSuffix(d)).toBe(formatK2SendOutcomeTimestampSuffix(d))
  })

  it('does not mutate the input Date', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const before = d.getTime()
    formatK2SendOutcomeTimestampSuffix(d)
    expect(d.getTime()).toBe(before)
  })

  it('paired with formatK2SendOutcomeLabel produces the full sighted-only summary line', () => {
    // The renderer concatenates label + suffix. Verify the joined string
    // reads naturally for both outcome states.
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    expect(formatK2SendOutcomeLabel('success') + formatK2SendOutcomeTimestampSuffix(d)).toBe(
      'Last upload: ✓ Sent successfully (at 14:23)'
    )
    expect(formatK2SendOutcomeLabel('failure') + formatK2SendOutcomeTimestampSuffix(d)).toBe(
      'Last upload: ✗ Failed (at 14:23)'
    )
  })

  it('paired with formatK2SendOutcomeLabel + null timestamp produces the bare label (no dangling parens)', () => {
    expect(formatK2SendOutcomeLabel('success') + formatK2SendOutcomeTimestampSuffix(null)).toBe(
      'Last upload: ✓ Sent successfully'
    )
    expect(formatK2SendOutcomeLabel('failure') + formatK2SendOutcomeTimestampSuffix(null)).toBe(
      'Last upload: ✗ Failed'
    )
  })
})

// ─── [P2-K2-PUSH]/Cycle 383 -- filename suffix behaviour ───────────────
// Companion formatter for the C375 outcome label (parallel of the C380
// timestamp suffix). Returns ` — <filename>` (U+2014 EM DASH separator)
// for a non-empty trimmed string and the empty string for null /
// undefined / non-string / whitespace-only inputs. The renderer
// concatenates the suffix into the existing JSX BEFORE the timestamp
// suffix so the operator-visible line reads
// "Last upload: ✓ Sent successfully — wrist-guard.gcode (at 14:23)".
describe('formatK2SendOutcomeFilenameSuffix (Cycle 383)', () => {
  it('returns empty string for null (initial state slot)', () => {
    // The renderer initialises k2SendLastOutcomeFilename to `null` and
    // resets it to `null` at the top of sendToK2Plus. Both code paths
    // must produce no suffix so the in-flight render is "Last upload:
    // ✓ Sent successfully" without a dangling " — ".
    expect(formatK2SendOutcomeFilenameSuffix(null)).toBe('')
  })

  it('returns empty string for undefined (defensive)', () => {
    expect(formatK2SendOutcomeFilenameSuffix(undefined)).toBe('')
  })

  it('returns empty string for an empty string (defence in depth)', () => {
    // A future regression that captures `r.filename` when Moonraker
    // returns an empty string would land here. The renderer never
    // intentionally passes '' (the `?? basename(...)` chain coerces
    // empty to a non-empty fallback) but the formatter must NOT emit
    // a dangling " — " in that case.
    expect(formatK2SendOutcomeFilenameSuffix('')).toBe('')
  })

  it('returns empty string for whitespace-only string (parallel of C373 trim behaviour)', () => {
    expect(formatK2SendOutcomeFilenameSuffix('   ')).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix('\t\n')).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix(' \t  \n  ')).toBe('')
  })

  it('returns empty string for a non-string input (defence in depth)', () => {
    // TypeScript narrows the call site, but a runtime caller (test
    // harness, future JS interop) could hand in a number / object /
    // boolean. Defensive empty string keeps the renderer crash-free.
    expect(formatK2SendOutcomeFilenameSuffix(0 as unknown as string)).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix(42 as unknown as string)).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix({} as unknown as string)).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix(true as unknown as string)).toBe('')
  })

  it('formats a simple basename (cam.gcode)', () => {
    expect(formatK2SendOutcomeFilenameSuffix('cam.gcode')).toBe(' — cam.gcode')
  })

  it('formats a typical sliced FDM filename', () => {
    expect(formatK2SendOutcomeFilenameSuffix('wrist-guard.gcode')).toBe(' — wrist-guard.gcode')
  })

  it('trims leading and trailing whitespace from the filename', () => {
    // Defensive: a future capture-site that wraps the basename in
    // accidental padding (e.g. `\n${basename}\n` from a malformed
    // log-line parser) must NOT show whitespace in the operator surface.
    expect(formatK2SendOutcomeFilenameSuffix('  cam.gcode  ')).toBe(' — cam.gcode')
    expect(formatK2SendOutcomeFilenameSuffix('\tcam.gcode\n')).toBe(' — cam.gcode')
  })

  it('preserves interior whitespace in the filename', () => {
    // Filenames CAN legitimately contain spaces ("multi word slice.gcode").
    // Trim must only strip leading/trailing whitespace, not collapse
    // interior runs.
    expect(formatK2SendOutcomeFilenameSuffix('multi word slice.gcode')).toBe(
      ' — multi word slice.gcode'
    )
  })

  it('output starts with a leading space (renderer concatenates without extra space)', () => {
    // The renderer reads `formatK2SendOutcomeLabel(...) + formatK2SendOutcomeFilenameSuffix(...) + ...`
    // without an extra interpolated space. The leading space MUST live
    // in the suffix so the concatenation reads naturally.
    expect(formatK2SendOutcomeFilenameSuffix('cam.gcode').startsWith(' ')).toBe(true)
  })

  it('output uses the literal U+2014 EM DASH separator (not a hyphen-minus or en-dash)', () => {
    // The em dash matches the C368 100-bracket announcement
    // ("Upload complete — printer beginning the job") so the sighted
    // operator reads consistent typographic punctuation across the
    // Send surface. A future regression that swaps in U+002D HYPHEN-MINUS
    // or U+2013 EN DASH would visually diverge.
    const out = formatK2SendOutcomeFilenameSuffix('cam.gcode')
    expect(out).toContain('—') // U+2014 EM DASH
    expect(out).not.toContain(' - ') // hyphen-minus surrounded by spaces
    expect(out).not.toContain(' – ') // en-dash surrounded by spaces (U+2013)
  })

  it('output uses " — " separator (em dash with surrounding spaces)', () => {
    // Pin the exact separator template so a future refactor that swaps
    // in ": " (double-colon awkwardness) or " (cam.gcode)" (parens form)
    // lands here.
    expect(formatK2SendOutcomeFilenameSuffix('cam.gcode')).toBe(' — cam.gcode')
  })

  it('does not add a trailing space, paren, or punctuation after the filename', () => {
    // The renderer concatenates the timestamp suffix AFTER this one;
    // a trailing space here would double-up with the timestamp's
    // leading space. A trailing paren / colon would break the joined
    // string shape pinned by the integration test below.
    const out = formatK2SendOutcomeFilenameSuffix('cam.gcode')
    expect(out.endsWith('cam.gcode')).toBe(true)
    expect(out.endsWith(' ')).toBe(false)
    expect(out.endsWith(')')).toBe(false)
    expect(out.endsWith(':')).toBe(false)
    expect(out.endsWith('.')).toBe(false) // the period is part of the filename, not the suffix
  })

  it('is deterministic for the same input (pure function)', () => {
    expect(formatK2SendOutcomeFilenameSuffix('cam.gcode')).toBe(
      formatK2SendOutcomeFilenameSuffix('cam.gcode')
    )
  })

  it('does not mutate the input string (defensive)', () => {
    const fname = 'cam.gcode'
    formatK2SendOutcomeFilenameSuffix(fname)
    expect(fname).toBe('cam.gcode')
  })

  it('paired with label + timestamp produces the full sighted-only summary line (success)', () => {
    // The renderer concatenates label + filename + timestamp. Verify
    // the joined string reads naturally for a successful upload.
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const out =
      formatK2SendOutcomeLabel('success') +
      formatK2SendOutcomeFilenameSuffix('wrist-guard.gcode') +
      formatK2SendOutcomeTimestampSuffix(d)
    expect(out).toBe('Last upload: ✓ Sent successfully — wrist-guard.gcode (at 14:23)')
  })

  it('paired with label + timestamp produces the full sighted-only summary line (failure)', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const out =
      formatK2SendOutcomeLabel('failure') +
      formatK2SendOutcomeFilenameSuffix('wrist-guard.gcode') +
      formatK2SendOutcomeTimestampSuffix(d)
    expect(out).toBe('Last upload: ✗ Failed — wrist-guard.gcode (at 14:23)')
  })

  it('paired with label + null filename + timestamp produces the bare-label-with-timestamp line', () => {
    // Defence in depth: if the renderer's filename capture fails (a
    // future regression that forgets to set k2SendLastOutcomeFilename)
    // the outcome line must still read coherently with just label +
    // timestamp.
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const out =
      formatK2SendOutcomeLabel('success') +
      formatK2SendOutcomeFilenameSuffix(null) +
      formatK2SendOutcomeTimestampSuffix(d)
    expect(out).toBe('Last upload: ✓ Sent successfully (at 14:23)')
  })

  it('paired with label + filename + null timestamp produces the bare-label-with-filename line', () => {
    // Defence in depth: if the renderer's timestamp capture fails the
    // outcome line must still read coherently with just label + filename.
    const out =
      formatK2SendOutcomeLabel('success') +
      formatK2SendOutcomeFilenameSuffix('cam.gcode') +
      formatK2SendOutcomeTimestampSuffix(null)
    expect(out).toBe('Last upload: ✓ Sent successfully — cam.gcode')
  })

  it('paired with label + null filename + null timestamp produces the bare label (full degradation)', () => {
    // The C375 outcome label alone must remain the operator-visible
    // floor when both companion suffixes degrade.
    const out =
      formatK2SendOutcomeLabel('success') +
      formatK2SendOutcomeFilenameSuffix(null) +
      formatK2SendOutcomeTimestampSuffix(null)
    expect(out).toBe('Last upload: ✓ Sent successfully')
  })
})

// ─── [P2-K2-PUSH]/Cycle 388 -- truncateK2SendOutcomeFilename ────────────
// Behaviour tests for the length-bounded truncation companion to the
// C383 filename suffix. Source-text pins live in the paired -pin.test.ts.

describe('K2_SEND_OUTCOME_FILENAME_MAX_CHARS constant', () => {
  it('is the canonical 30-char default', () => {
    // The 30-char value is empirically tuned for the Manufacture-panel
    // column width that keeps `label + filename + timestamp` on a single
    // line for typical slice basenames. A future regression that flips
    // it to 20 (would crop wrist-guard.gcode awkwardly) or 60 (would let
    // the timestamp suffix get pushed off-column) lands here.
    expect(K2_SEND_OUTCOME_FILENAME_MAX_CHARS).toBe(30)
  })
})

describe('truncateK2SendOutcomeFilename', () => {
  it('returns null for null input (defensive; preserves suffix-formatter chain)', () => {
    expect(truncateK2SendOutcomeFilename(null)).toBeNull()
  })

  it('returns null for undefined input (defensive)', () => {
    expect(truncateK2SendOutcomeFilename(undefined)).toBeNull()
  })

  it('returns null for non-string input (defence-in-depth)', () => {
    expect(truncateK2SendOutcomeFilename(123 as unknown as string)).toBeNull()
    expect(truncateK2SendOutcomeFilename({} as unknown as string)).toBeNull()
    expect(truncateK2SendOutcomeFilename(true as unknown as string)).toBeNull()
  })

  it('returns null for empty string (parallel of suffix formatter)', () => {
    expect(truncateK2SendOutcomeFilename('')).toBeNull()
  })

  it('returns null for whitespace-only input (parallel of suffix formatter trim)', () => {
    expect(truncateK2SendOutcomeFilename('   ')).toBeNull()
    expect(truncateK2SendOutcomeFilename('\t\n')).toBeNull()
  })

  it('returns the trimmed input unchanged when length is well under the default', () => {
    expect(truncateK2SendOutcomeFilename('cam.gcode')).toBe('cam.gcode')
    expect(truncateK2SendOutcomeFilename('drawer-pull.gcode')).toBe('drawer-pull.gcode')
    expect(truncateK2SendOutcomeFilename('wrist-guard.gcode')).toBe('wrist-guard.gcode')
  })

  it('strips leading and trailing whitespace from the returned value (parallel of suffix trim)', () => {
    expect(truncateK2SendOutcomeFilename('  cam.gcode  ')).toBe('cam.gcode')
    expect(truncateK2SendOutcomeFilename('\tcam.gcode\n')).toBe('cam.gcode')
  })

  it('returns the trimmed input unchanged at the 30-char boundary', () => {
    // 30 chars exactly = "abcdefghijklmnopqrstuvwxyz1234"
    const exactly30 = 'abcdefghijklmnopqrstuvwxyz1234'
    expect(exactly30.length).toBe(30)
    expect(truncateK2SendOutcomeFilename(exactly30)).toBe(exactly30)
  })

  it('truncates 31-char input to 29-char prefix + ellipsis (total 30 chars)', () => {
    // 31 chars = "abcdefghijklmnopqrstuvwxyz12345"
    const exactly31 = 'abcdefghijklmnopqrstuvwxyz12345'
    expect(exactly31.length).toBe(31)
    const out = truncateK2SendOutcomeFilename(exactly31)
    expect(out).toBe('abcdefghijklmnopqrstuvwxyz123' + '…')
    expect(out!.length).toBe(30)
  })

  it('truncates a realistic long basename to 29 chars + ellipsis', () => {
    // "wrist-guard-shell-finishing-pass.gcode" is 38 chars.
    const longName = 'wrist-guard-shell-finishing-pass.gcode'
    expect(longName.length).toBe(38)
    const out = truncateK2SendOutcomeFilename(longName)
    expect(out).toBe('wrist-guard-shell-finishing-p' + '…')
    expect(out!.length).toBe(30)
  })

  it('uses U+2026 HORIZONTAL ELLIPSIS (single codepoint, NOT three U+002E full stops)', () => {
    const longName = 'a'.repeat(50)
    const out = truncateK2SendOutcomeFilename(longName)
    expect(out).not.toBeNull()
    expect(out!.endsWith('…')).toBe(true)
    expect(out!.endsWith('...')).toBe(false)
    // Single codepoint check: last char's codePoint is 0x2026.
    expect(out!.codePointAt(out!.length - 1)).toBe(0x2026)
  })

  it('respects a custom maxChars when finite and >= 2', () => {
    expect(truncateK2SendOutcomeFilename('abcdefghij', 5)).toBe('abcd' + '…')
    expect(truncateK2SendOutcomeFilename('abcdefghij', 5)!.length).toBe(5)
  })

  it('respects maxChars=2 (single char + ellipsis)', () => {
    expect(truncateK2SendOutcomeFilename('abcdef', 2)).toBe('a' + '…')
    expect(truncateK2SendOutcomeFilename('abcdef', 2)!.length).toBe(2)
  })

  it('falls back to the default when maxChars is < 2 (refuses to truncate to ellipsis-only)', () => {
    // maxChars=0 / 1 cannot fit "1 informative char + ellipsis", so the
    // helper rejects the hostile value and uses the canonical default.
    expect(truncateK2SendOutcomeFilename('cam.gcode', 0)).toBe('cam.gcode')
    expect(truncateK2SendOutcomeFilename('cam.gcode', 1)).toBe('cam.gcode')
  })

  it('falls back to the default when maxChars is non-finite', () => {
    expect(truncateK2SendOutcomeFilename('cam.gcode', Number.NaN)).toBe('cam.gcode')
    expect(truncateK2SendOutcomeFilename('cam.gcode', Number.POSITIVE_INFINITY)).toBe('cam.gcode')
    expect(truncateK2SendOutcomeFilename('cam.gcode', Number.NEGATIVE_INFINITY)).toBe('cam.gcode')
  })

  it('floors a fractional finite maxChars (e.g. 5.7 -> 5)', () => {
    expect(truncateK2SendOutcomeFilename('abcdefghij', 5.7)).toBe('abcd' + '…')
  })

  it('does not mutate the input string (defensive)', () => {
    const fname = 'a'.repeat(40)
    truncateK2SendOutcomeFilename(fname)
    expect(fname).toBe('a'.repeat(40))
  })

  it('is deterministic for the same input (pure function)', () => {
    const longName = 'wrist-guard-shell-finishing-pass.gcode'
    expect(truncateK2SendOutcomeFilename(longName)).toBe(truncateK2SendOutcomeFilename(longName))
  })

  it('composes with formatK2SendOutcomeFilenameSuffix to yield a length-bounded suffix', () => {
    // The renderer threads truncate -> suffix. Verify the joined output
    // shape for a realistic long basename: ` — <29 chars>…`.
    const longName = 'wrist-guard-shell-finishing-pass.gcode'
    const out = formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename(longName))
    expect(out).toBe(' — wrist-guard-shell-finishing-p' + '…')
    // Total visible width: " — " (3) + 30 (truncated basename) = 33 chars
    expect(out.length).toBe(3 + 30)
  })

  it('composes with suffix to yield empty string when input degrades to null', () => {
    // truncate(null) -> null; suffix(null) -> ''. Defence-in-depth chain
    // intact.
    expect(formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename(null))).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename(undefined))).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename(''))).toBe('')
    expect(formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename('   '))).toBe('')
  })

  it('full sighted-only summary line stays single-line for a long basename (label + truncated filename + timestamp)', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const longName = 'wrist-guard-shell-finishing-pass.gcode'
    const out =
      formatK2SendOutcomeLabel('success') +
      formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename(longName)) +
      formatK2SendOutcomeTimestampSuffix(d)
    expect(out).toBe(
      'Last upload: ✓ Sent successfully — wrist-guard-shell-finishing-p' + '…' + ' (at 14:23)'
    )
  })

  it('full sighted-only summary line is unchanged for a short basename (truncate is a no-op)', () => {
    const d = new Date(2026, 4, 7, 14, 23, 0, 0)
    const out =
      formatK2SendOutcomeLabel('success') +
      formatK2SendOutcomeFilenameSuffix(truncateK2SendOutcomeFilename('cam.gcode')) +
      formatK2SendOutcomeTimestampSuffix(d)
    // Byte-identical to the C383 untruncated full-line shape; the
    // truncate helper is structurally inert below the threshold.
    expect(out).toBe('Last upload: ✓ Sent successfully — cam.gcode (at 14:23)')
  })
})
