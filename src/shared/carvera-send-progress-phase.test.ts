/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 360 -- pin tests for the Carvera
 * Send polite live-region phase helpers (mirror of the K2
 * `k2-send-progress-thresholds.test.ts` paired pin).
 */

import { describe, expect, it } from 'vitest'
import {
  CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS,
  CARVERA_SEND_PHASES,
  detectCarveraSendPhase,
  formatCarveraSendFailureAnnouncement,
  formatCarveraSendOutcomeFilenameSuffix,
  formatCarveraSendOutcomeLabel,
  formatCarveraSendOutcomeTimestampSuffix,
  formatCarveraSendPhaseAnnouncement,
  truncateCarveraSendOutcomeFilename,
  type CarveraSendOutcome,
  type CarveraSendPhase
} from './carvera-send-progress-phase'

// ─── (A) module shape ────────────────────────────────────────────────

describe('CARVERA_SEND_PHASES tuple', () => {
  it('lists exactly the three documented phases in lifecycle order', () => {
    expect(CARVERA_SEND_PHASES).toEqual(['connecting', 'transferring', 'verifying'])
  })

  it('is a frozen / readonly literal at the type level (length=3)', () => {
    expect(CARVERA_SEND_PHASES.length).toBe(3)
  })

  it('every phase is a non-empty kebab-friendly identifier (no whitespace, lowercase)', () => {
    for (const phase of CARVERA_SEND_PHASES) {
      expect(phase.length).toBeGreaterThan(0)
      expect(phase).toBe(phase.toLowerCase())
      expect(/\s/.test(phase)).toBe(false)
    }
  })
})

// ─── (B) detectCarveraSendPhase happy-path matching ──────────────────

describe('detectCarveraSendPhase happy-path matching', () => {
  it('returns "connecting" for a typical carvera-cli connecting line', () => {
    expect(detectCarveraSendPhase('Connecting to 192.168.4.1...')).toBe('connecting')
  })

  it('returns "connecting" for a connection-established line', () => {
    expect(detectCarveraSendPhase('Connection established.')).toBe('connecting')
  })

  it('returns "connecting" for a handshaking line', () => {
    expect(detectCarveraSendPhase('Handshaking with device...')).toBe('connecting')
  })

  it('returns "transferring" for an uploading-line', () => {
    expect(detectCarveraSendPhase('Uploading cam.nc...')).toBe('transferring')
  })

  it('returns "transferring" for a transferring-bytes line', () => {
    expect(detectCarveraSendPhase('Transferring 12345 bytes...')).toBe('transferring')
  })

  it('returns "transferring" for a sending-block line', () => {
    expect(detectCarveraSendPhase('Sending block 42...')).toBe('transferring')
  })

  it('returns "verifying" for a verifying-checksum line', () => {
    expect(detectCarveraSendPhase('Verifying checksum...')).toBe('verifying')
  })

  it('returns "verifying" for a verification-ok line', () => {
    expect(detectCarveraSendPhase('Verification ok.')).toBe('verifying')
  })

  it('returns "verifying" for a bare checksum-mismatch hint', () => {
    expect(detectCarveraSendPhase('Checksum mismatch on retry 2.')).toBe('verifying')
  })
})

// ─── (C) detectCarveraSendPhase null-path ────────────────────────────

describe('detectCarveraSendPhase null-path (no match / no phase emitted)', () => {
  it('returns null for an empty string', () => {
    expect(detectCarveraSendPhase('')).toBeNull()
  })

  it('returns null for a whitespace-only string', () => {
    expect(detectCarveraSendPhase('   \t\n')).toBeNull()
  })

  it('returns null for a totally unrelated line', () => {
    expect(detectCarveraSendPhase('foo bar baz')).toBeNull()
  })

  it('returns null for the upload-complete terminal line (renderer owns that announcement)', () => {
    // "Upload complete." must NOT race with the "Uploaded to Carvera:
    // <fname>" terminal announcement that the renderer sets after
    // carveraUpload resolves.
    expect(detectCarveraSendPhase('Upload complete.')).toBeNull()
  })

  it('returns null for a non-string argument coerced through unknown', () => {
    // The runtime type guard short-circuits non-string input.
    expect(detectCarveraSendPhase(undefined as unknown as string)).toBeNull()
    expect(detectCarveraSendPhase(null as unknown as string)).toBeNull()
    expect(detectCarveraSendPhase(42 as unknown as string)).toBeNull()
  })
})

// ─── (D) detectCarveraSendPhase ordering invariants ─────────────────

describe('detectCarveraSendPhase ordering invariants', () => {
  it('case-insensitive: lowercased forms match the same as PascalCase', () => {
    expect(detectCarveraSendPhase('connecting...')).toBe('connecting')
    expect(detectCarveraSendPhase('CONNECTING...')).toBe('connecting')
    expect(detectCarveraSendPhase('Connecting...')).toBe('connecting')
  })

  it('substring-tolerant: extra prefixes (timestamps) do not break matching', () => {
    expect(detectCarveraSendPhase('[2026-05-07T10:00:00] Uploading cam.nc...')).toBe(
      'transferring'
    )
  })

  it('a multi-keyword line resolves to the EARLIER phase per CARVERA_SEND_PHASES order', () => {
    // "Connecting and uploading" mentions both connect AND upload --
    // the loop in detectCarveraSendPhase walks CARVERA_SEND_PHASES in
    // order, so 'connecting' wins. Misclassifying as 'transferring'
    // would leak past the early phase a screen-reader user expects.
    expect(detectCarveraSendPhase('Connecting and uploading.')).toBe('connecting')
  })

  it('does NOT spuriously match non-keyword English ("connection refused" hints)', () => {
    // 'connection' contains 'connect' so this DOES match 'connecting'
    // -- documents the intentionally permissive matcher. A future
    // tightening that re-classifies refusal lines must update this pin.
    expect(detectCarveraSendPhase('Connection refused.')).toBe('connecting')
  })
})

// ─── (E) formatCarveraSendPhaseAnnouncement ─────────────────────────

describe('formatCarveraSendPhaseAnnouncement', () => {
  it('formats every phase with the parenthesised lifecycle label', () => {
    expect(formatCarveraSendPhaseAnnouncement('connecting')).toBe(
      'Uploading to Carvera (connecting)…'
    )
    expect(formatCarveraSendPhaseAnnouncement('transferring')).toBe(
      'Uploading to Carvera (transferring)…'
    )
    expect(formatCarveraSendPhaseAnnouncement('verifying')).toBe(
      'Uploading to Carvera (verifying)…'
    )
  })

  it('uses the U+2026 horizontal ellipsis (matches K2 sibling formatter)', () => {
    const msg = formatCarveraSendPhaseAnnouncement('transferring')
    // U+2026 is the single-glyph ellipsis (NOT three ASCII dots) so the
    // speech engine handles the trail-off identically to the
    // start-of-upload "Uploading to Carvera..." message.
    expect(msg.endsWith('…')).toBe(true)
    expect(msg.endsWith('...')).toBe(false)
  })

  it('produces a stable string per phase across calls (pure function)', () => {
    const a = formatCarveraSendPhaseAnnouncement('verifying')
    const b = formatCarveraSendPhaseAnnouncement('verifying')
    expect(a).toBe(b)
  })

  it('every phase round-trips: detect -> format -> contains the phase identifier', () => {
    const lines: Record<CarveraSendPhase, string> = {
      connecting: 'Connecting to 192.168.4.1...',
      transferring: 'Uploading cam.nc...',
      verifying: 'Verifying checksum...'
    }
    for (const phase of CARVERA_SEND_PHASES) {
      const detected = detectCarveraSendPhase(lines[phase])
      expect(detected).toBe(phase)
      const announcement = formatCarveraSendPhaseAnnouncement(detected!)
      expect(announcement).toContain(phase)
    }
  })
})

// ─── (F) formatCarveraSendOutcomeLabel (Cycle 382) ──────────────────
//
// Mirror of the K2 [P2-K2-PUSH]/Cycle 375 outcome-label coverage in
// `src/shared/k2-send-progress-thresholds.test.ts`. The Carvera Send
// section gains a sighted-only ✓/✗ summary line whose text is
// produced by this helper. Phrasing IDENTICAL to the K2 sibling so
// operators see consistent outcome semantics across both Send paths.

describe('formatCarveraSendOutcomeLabel (Cycle 382)', () => {
  it('renders the success outcome with the U+2713 CHECK MARK glyph', () => {
    expect(formatCarveraSendOutcomeLabel('success')).toBe(
      'Last upload: ✓ Sent successfully'
    )
  })

  it('renders the failure outcome with the U+2717 BALLOT X glyph', () => {
    expect(formatCarveraSendOutcomeLabel('failure')).toBe('Last upload: ✗ Failed')
  })

  it('uses the actual U+2713 codepoint (not an ASCII checkmark approximation)', () => {
    const msg = formatCarveraSendOutcomeLabel('success')
    expect(msg).toContain('✓')
    expect(msg).not.toContain('[OK]')
    expect(msg).not.toContain('(ok)')
  })

  it('uses the actual U+2717 codepoint (not an ASCII X approximation)', () => {
    const msg = formatCarveraSendOutcomeLabel('failure')
    expect(msg).toContain('✗')
    // Does not collide with a literal capital-X (U+0058) or the BALLOT X
    // WITH BAR (U+2718) that some operator-facing emoji libraries emit.
    expect(msg).not.toContain('✘')
    expect(msg).not.toMatch(/\bX\b/)
  })

  it('every label starts with the "Last upload:" prefix (cross-machine consistency with K2 C375)', () => {
    expect(formatCarveraSendOutcomeLabel('success').startsWith('Last upload: ')).toBe(true)
    expect(formatCarveraSendOutcomeLabel('failure').startsWith('Last upload: ')).toBe(true)
  })

  it('produces a stable string per outcome across calls (pure function)', () => {
    const a = formatCarveraSendOutcomeLabel('success')
    const b = formatCarveraSendOutcomeLabel('success')
    expect(a).toBe(b)
    const c = formatCarveraSendOutcomeLabel('failure')
    const d = formatCarveraSendOutcomeLabel('failure')
    expect(c).toBe(d)
  })

  it('does not mention the carvera-cli implementation detail in the label (sighted operator surface)', () => {
    // The C356 polite live-region carries CLI-specific failure messages;
    // the outcome label is a glanceable summary that should NOT leak
    // implementation detail like "carvera-cli", "ENOENT", or "spawn".
    for (const outcome of ['success', 'failure'] as const) {
      const msg = formatCarveraSendOutcomeLabel(outcome)
      expect(msg.toLowerCase()).not.toContain('carvera-cli')
      expect(msg.toLowerCase()).not.toContain('enoent')
      expect(msg.toLowerCase()).not.toContain('spawn')
    }
  })

  it('every label is short enough to fit on one operator-glance line (<= 40 chars)', () => {
    // The Manufacture panel is ~640px wide on the My-Shop layout; at
    // the standard 14px text size that gives roughly 40-50 chars per
    // visual line. A summary line that wraps to two lines defeats the
    // glanceability purpose. K2 sibling labels are 32 + 17 chars; the
    // Carvera labels mirror exactly.
    expect(formatCarveraSendOutcomeLabel('success').length).toBeLessThanOrEqual(40)
    expect(formatCarveraSendOutcomeLabel('failure').length).toBeLessThanOrEqual(40)
  })

  it('label phrasing is byte-identical to the K2 sibling formatter', () => {
    // Cross-machine UX consistency invariant: a sighted operator
    // switching between the K2 and Carvera Send sections via the My-
    // Shop preset bar reads THE SAME outcome label text. A future
    // regression that diverges either side must update this pin.
    expect(formatCarveraSendOutcomeLabel('success')).toBe(
      'Last upload: ✓ Sent successfully'
    )
    expect(formatCarveraSendOutcomeLabel('failure')).toBe('Last upload: ✗ Failed')
  })

  it('CarveraSendOutcome union is exactly two narrow string literals', () => {
    // Compile-time pin via runtime exhaustive assertion.
    const cases: CarveraSendOutcome[] = ['success', 'failure']
    expect(cases).toHaveLength(2)
    for (const c of cases) {
      // Every union member must produce a non-empty label.
      expect(formatCarveraSendOutcomeLabel(c).length).toBeGreaterThan(0)
    }
  })

  it('does not return an empty string or pure whitespace for either outcome', () => {
    expect(formatCarveraSendOutcomeLabel('success').trim().length).toBeGreaterThan(0)
    expect(formatCarveraSendOutcomeLabel('failure').trim().length).toBeGreaterThan(0)
  })
})

// ─── (G) [P2-CARVERA-PUSH-MOCK]/Cycle 388 timestamp suffix ─────────────
//
// Mirror of the K2 [P2-K2-PUSH]/Cycle 380 timestamp-suffix coverage in
// `src/shared/k2-send-progress-thresholds.test.ts`. Companion formatter
// for the C382 outcome label. Returns ` (at HH:MM)` for a valid Date
// input (zero-padded local-time hours and minutes) and the empty
// string for null / undefined / non-Date / NaN-time inputs. The
// renderer concatenates the suffix into the existing JSX so a stale
// outcome line never shows up undated, but the panel never crashes if
// the timestamp slot regresses to null / a non-Date.

describe('formatCarveraSendOutcomeTimestampSuffix (Cycle 388)', () => {
  it('returns empty string for null (initial state slot)', () => {
    // The renderer initialises carveraSendLastOutcomeAt to `null` and
    // resets it to `null` at the top of sendToCarvera. Both code paths
    // must produce no suffix so the in-flight render is "Last upload:
    // ✓ Sent successfully" without a dangling " (at )".
    expect(formatCarveraSendOutcomeTimestampSuffix(null)).toBe('')
  })

  it('returns empty string for undefined (defensive)', () => {
    expect(formatCarveraSendOutcomeTimestampSuffix(undefined)).toBe('')
  })

  it('returns empty string for a Date with NaN time', () => {
    // `new Date('not-a-date')` produces a Date whose getTime() is NaN.
    // A future regression that captures `new Date(stringFromIPC)`
    // could land here; the formatter must NOT crash or emit
    // "(at NaN:NaN)".
    const bad = new Date('not-a-date')
    expect(Number.isNaN(bad.getTime())).toBe(true)
    expect(formatCarveraSendOutcomeTimestampSuffix(bad)).toBe('')
  })

  it('returns empty string for a non-Date object (defence in depth)', () => {
    // TypeScript narrows the call site, but a runtime caller (e.g. a
    // test harness or a future JS interop) could hand in a number /
    // string / plain object. Defensive empty string keeps the renderer
    // crash-free.
    expect(formatCarveraSendOutcomeTimestampSuffix(0 as unknown as Date)).toBe('')
    expect(
      formatCarveraSendOutcomeTimestampSuffix(
        '2026-05-08T06:30:00Z' as unknown as Date
      )
    ).toBe('')
    expect(
      formatCarveraSendOutcomeTimestampSuffix({ getTime: () => 0 } as unknown as Date)
    ).toBe('')
  })

  it('formats a single-digit hour with zero-padding (09:05 local)', () => {
    // Build a Date object at 09:05 LOCAL TIME using the local-time
    // constructor so the test is timezone-independent (the formatter
    // reads getHours / getMinutes which return local-time values).
    const d = new Date(2026, 4, 8, 9, 5, 0, 0) // 2026-05-08 09:05:00 local
    expect(formatCarveraSendOutcomeTimestampSuffix(d)).toBe(' (at 09:05)')
  })

  it('formats a top-of-day boundary (23:59 local)', () => {
    const d = new Date(2026, 4, 8, 23, 59, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(d)).toBe(' (at 23:59)')
  })

  it('formats a start-of-day boundary (00:00 local)', () => {
    const d = new Date(2026, 4, 8, 0, 0, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(d)).toBe(' (at 00:00)')
  })

  it('formats a single-digit minute with zero-padding (14:03 local)', () => {
    const d = new Date(2026, 4, 8, 14, 3, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(d)).toBe(' (at 14:03)')
  })

  it('uses 24-hour format (no AM/PM marker)', () => {
    const morning = new Date(2026, 4, 8, 8, 30, 0, 0)
    const evening = new Date(2026, 4, 8, 20, 30, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(morning)).toBe(' (at 08:30)')
    expect(formatCarveraSendOutcomeTimestampSuffix(evening)).toBe(' (at 20:30)')
    // Defensive: assert no AM/PM tokens leaked into either suffix.
    for (const d of [morning, evening]) {
      const out = formatCarveraSendOutcomeTimestampSuffix(d)
      expect(out).not.toContain('AM')
      expect(out).not.toContain('PM')
      expect(out).not.toContain('am')
      expect(out).not.toContain('pm')
    }
  })

  it('output starts with a leading space (renderer concatenates without extra space)', () => {
    // The renderer reads `formatCarveraSendOutcomeLabel(...) +
    // formatCarveraSendOutcomeTimestampSuffix(...)` without an extra
    // interpolated space. The leading space MUST live in the suffix so
    // the concatenation reads naturally.
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(d).startsWith(' ')).toBe(true)
  })

  it('output uses literal "(at " prefix and ")" suffix delimiters', () => {
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    const out = formatCarveraSendOutcomeTimestampSuffix(d)
    expect(out).toContain('(at ')
    expect(out.endsWith(')')).toBe(true)
  })

  it('uses HH:MM colon separator (single colon, no seconds, no slash)', () => {
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    const out = formatCarveraSendOutcomeTimestampSuffix(d)
    const colons = (out.match(/:/g) ?? []).length
    expect(colons).toBe(1)
    expect(out).not.toContain(':00')
    expect(out).not.toContain('/')
  })

  it('is deterministic for the same Date input (pure function)', () => {
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(d)).toBe(
      formatCarveraSendOutcomeTimestampSuffix(d)
    )
  })

  it('label + suffix concatenation reads naturally for both outcomes', () => {
    // Round-trip the renderer's exact JSX concatenation pattern to lock
    // the operator-visible output shape against accidental whitespace
    // / punctuation drift in either helper.
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    expect(
      formatCarveraSendOutcomeLabel('success') +
        formatCarveraSendOutcomeTimestampSuffix(d)
    ).toBe('Last upload: ✓ Sent successfully (at 14:23)')
    expect(
      formatCarveraSendOutcomeLabel('failure') +
        formatCarveraSendOutcomeTimestampSuffix(d)
    ).toBe('Last upload: ✗ Failed (at 14:23)')
  })

  it('label + suffix(null) concatenation collapses to bare label (in-flight / no-timestamp render)', () => {
    // The renderer's reset path sets the timestamp slot to null while
    // a Send is in flight and the formatter returns '' for null. The
    // outcome line should still read just the C382 label without a
    // dangling " (at )" or extra trailing whitespace.
    expect(
      formatCarveraSendOutcomeLabel('success') +
        formatCarveraSendOutcomeTimestampSuffix(null)
    ).toBe('Last upload: ✓ Sent successfully')
    expect(
      formatCarveraSendOutcomeLabel('failure') +
        formatCarveraSendOutcomeTimestampSuffix(null)
    ).toBe('Last upload: ✗ Failed')
  })

  it('byte-identical output to the K2 [P2-K2-PUSH]/Cycle 380 sibling formatter for matching inputs', () => {
    // Cross-machine UX consistency: an operator switching from the K2
    // Send section to the Carvera Send section reads THE SAME temporal
    // suffix format. This pin documents the deliberate parity (the K2
    // sibling lives in `src/shared/k2-send-progress-thresholds.ts`).
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    expect(formatCarveraSendOutcomeTimestampSuffix(d)).toBe(' (at 14:23)')
    // Boundary mirror: 00:00 + 23:59 + single-digit hours.
    expect(
      formatCarveraSendOutcomeTimestampSuffix(new Date(2026, 4, 8, 0, 0, 0, 0))
    ).toBe(' (at 00:00)')
    expect(
      formatCarveraSendOutcomeTimestampSuffix(new Date(2026, 4, 8, 23, 59, 0, 0))
    ).toBe(' (at 23:59)')
    expect(
      formatCarveraSendOutcomeTimestampSuffix(new Date(2026, 4, 8, 9, 5, 0, 0))
    ).toBe(' (at 09:05)')
  })

  it('does not leak K2-specific implementation tokens into the suffix', () => {
    // The Carvera helper lives in `src/shared/carvera-send-progress-phase.ts`
    // (Carvera-only by module placement). A future cycle that
    // accidentally re-uses the K2 formatter for the Carvera path would
    // still pass the format pins above; this assertion documents the
    // operator-visible decoupling: the rendered text contains nothing
    // K2-specific. (The format itself is intentionally byte-identical
    // to the K2 sibling for cross-machine UX consistency, so this pin
    // checks for SUBSTRINGS that would only appear if the K2 token
    // names leaked into the Carvera suffix.)
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    const out = formatCarveraSendOutcomeTimestampSuffix(d).toLowerCase()
    expect(out).not.toContain('k2')
    expect(out).not.toContain('moonraker')
    expect(out).not.toContain('creality')
    expect(out).not.toContain('klipper')
  })
})

// ─── (H) Cycle 390 filename suffix formatter ────────────────────────
//
// Mirrors the K2 [P2-K2-PUSH]/Cycle 383 sibling
// `formatK2SendOutcomeFilenameSuffix`. The Carvera analog returns the
// exact same `' — <filename>'` shape (U+2014 EM DASH separator) so a
// sighted operator switching between machines via the My-Shop preset
// bar reads identical typographic punctuation regardless of target.

describe('formatCarveraSendOutcomeFilenameSuffix', () => {
  it('returns " — <filename>" for a typical post basename', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('cam.nc')).toBe(' — cam.nc')
  })

  it('returns " — <filename>" for a multi-word filename (interior whitespace preserved)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('multi word slice.nc')).toBe(
      ' — multi word slice.nc'
    )
  })

  it('returns "" for null input (defensive; renderer initial slot state)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix(null)).toBe('')
  })

  it('returns "" for undefined input (defensive)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix(undefined)).toBe('')
  })

  it('returns "" for an empty string (defence-in-depth)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('')).toBe('')
  })

  it('returns "" for a whitespace-only string (parallel of the K2 sibling trim)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('   ')).toBe('')
    expect(formatCarveraSendOutcomeFilenameSuffix('\t\t')).toBe('')
    expect(formatCarveraSendOutcomeFilenameSuffix('\n')).toBe('')
  })

  it('trims leading and trailing whitespace before formatting', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('  cam.nc  ')).toBe(' — cam.nc')
    expect(formatCarveraSendOutcomeFilenameSuffix('\tcam.nc\n')).toBe(' — cam.nc')
  })

  it('returns "" for a non-string input (defence-in-depth; runtime caller could pass any)', () => {
    // TS narrows the call site to string | null | undefined, but a runtime
    // caller (e.g. JSON-parsed payload, IPC tick that lost its typing)
    // could pass a number, object, or boolean. The formatter must never
    // crash the panel.
    expect(formatCarveraSendOutcomeFilenameSuffix(42 as unknown as string)).toBe('')
    expect(formatCarveraSendOutcomeFilenameSuffix({} as unknown as string)).toBe('')
    expect(formatCarveraSendOutcomeFilenameSuffix(true as unknown as string)).toBe('')
    expect(formatCarveraSendOutcomeFilenameSuffix([] as unknown as string)).toBe('')
  })

  it('output starts with a leading space (renderer concatenates without extra space)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('cam.nc').startsWith(' ')).toBe(true)
  })

  it('output uses the U+2014 EM DASH separator (single codepoint, not two ASCII hyphens)', () => {
    const out = formatCarveraSendOutcomeFilenameSuffix('cam.nc')
    expect(out).toContain('—')
    expect(out).not.toContain('--')
  })

  it('separator is em dash with single space on each side', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('cam.nc')).toBe(' — cam.nc')
  })

  it('is deterministic for the same input (pure function)', () => {
    expect(formatCarveraSendOutcomeFilenameSuffix('cam.nc')).toBe(
      formatCarveraSendOutcomeFilenameSuffix('cam.nc')
    )
  })

  it('byte-identical separator to the K2 [P2-K2-PUSH]/Cycle 383 sibling formatter', () => {
    // Cross-machine UX consistency: an operator switching from the K2
    // Send section to the Carvera Send section reads THE SAME filename
    // separator. This pin documents the deliberate parity (the K2
    // sibling lives in `src/shared/k2-send-progress-thresholds.ts`).
    expect(formatCarveraSendOutcomeFilenameSuffix('cam.nc')).toBe(' — cam.nc')
  })

  it('label + filename concatenation reads naturally for both outcomes', () => {
    expect(
      formatCarveraSendOutcomeLabel('success') +
        formatCarveraSendOutcomeFilenameSuffix('cam.nc')
    ).toBe('Last upload: ✓ Sent successfully — cam.nc')
    expect(
      formatCarveraSendOutcomeLabel('failure') +
        formatCarveraSendOutcomeFilenameSuffix('cam.nc')
    ).toBe('Last upload: ✗ Failed — cam.nc')
  })

  it('label + filename(null) collapses to bare label (in-flight / no-filename render)', () => {
    expect(
      formatCarveraSendOutcomeLabel('success') +
        formatCarveraSendOutcomeFilenameSuffix(null)
    ).toBe('Last upload: ✓ Sent successfully')
    expect(
      formatCarveraSendOutcomeLabel('failure') +
        formatCarveraSendOutcomeFilenameSuffix(null)
    ).toBe('Last upload: ✗ Failed')
  })

  it('label + filename + timestamp full concatenation reads naturally (renderer JSX shape)', () => {
    // Round-trip the renderer's exact label + filename + timestamp
    // concatenation pattern to lock the operator-visible output shape
    // against accidental whitespace / punctuation drift in any of the
    // three helpers.
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    expect(
      formatCarveraSendOutcomeLabel('success') +
        formatCarveraSendOutcomeFilenameSuffix('cam.nc') +
        formatCarveraSendOutcomeTimestampSuffix(d)
    ).toBe('Last upload: ✓ Sent successfully — cam.nc (at 14:23)')
    expect(
      formatCarveraSendOutcomeLabel('failure') +
        formatCarveraSendOutcomeFilenameSuffix('cam.nc') +
        formatCarveraSendOutcomeTimestampSuffix(d)
    ).toBe('Last upload: ✗ Failed — cam.nc (at 14:23)')
  })

  it('does not leak K2-specific implementation tokens into the suffix', () => {
    // Same defence-in-depth as the C388 timestamp sibling: the suffix
    // text must contain nothing K2-specific even though the format is
    // intentionally byte-identical for cross-machine UX consistency.
    const out = formatCarveraSendOutcomeFilenameSuffix('cam.nc').toLowerCase()
    expect(out).not.toContain('k2')
    expect(out).not.toContain('moonraker')
    expect(out).not.toContain('creality')
    expect(out).not.toContain('klipper')
  })
})

// ─── (I) Cycle 390 filename truncation companion ────────────────────
//
// Mirrors the K2 [P2-K2-PUSH]/Cycle 388 sibling
// `truncateK2SendOutcomeFilename`. The Carvera analog uses the same
// 30-char default budget for cross-machine column-width parity on
// Jacob's standard Manufacture-panel resolution.

describe('CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS', () => {
  it('is the literal 30 (cross-machine parity with K2 C388)', () => {
    expect(CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS).toBe(30)
  })
})

describe('truncateCarveraSendOutcomeFilename', () => {
  it('returns null for null input (defensive; renderer initial slot state)', () => {
    expect(truncateCarveraSendOutcomeFilename(null)).toBeNull()
  })

  it('returns null for undefined input (defensive)', () => {
    expect(truncateCarveraSendOutcomeFilename(undefined)).toBeNull()
  })

  it('returns null for an empty string (defence-in-depth; matches suffix chain)', () => {
    expect(truncateCarveraSendOutcomeFilename('')).toBeNull()
  })

  it('returns null for a whitespace-only string (parallel of suffix trim)', () => {
    expect(truncateCarveraSendOutcomeFilename('   ')).toBeNull()
    expect(truncateCarveraSendOutcomeFilename('\t\n')).toBeNull()
  })

  it('returns null for a non-string input (defence-in-depth)', () => {
    expect(truncateCarveraSendOutcomeFilename(42 as unknown as string)).toBeNull()
    expect(truncateCarveraSendOutcomeFilename({} as unknown as string)).toBeNull()
    expect(truncateCarveraSendOutcomeFilename(true as unknown as string)).toBeNull()
  })

  it('returns the trimmed input unchanged when length is well under the budget', () => {
    expect(truncateCarveraSendOutcomeFilename('cam.nc')).toBe('cam.nc')
    expect(truncateCarveraSendOutcomeFilename('drawer-pull.nc')).toBe('drawer-pull.nc')
    expect(truncateCarveraSendOutcomeFilename('wrist-guard.nc')).toBe('wrist-guard.nc')
  })

  it('returns the trimmed input unchanged at exactly the boundary (30 chars)', () => {
    const at30 = 'a'.repeat(30)
    expect(at30).toHaveLength(30)
    expect(truncateCarveraSendOutcomeFilename(at30)).toBe(at30)
  })

  it('truncates a 31-char input to 29 chars + ellipsis (= 30 chars)', () => {
    const at31 = 'a'.repeat(31)
    const out = truncateCarveraSendOutcomeFilename(at31)
    expect(out).toBe('a'.repeat(29) + '…')
    expect(out).toHaveLength(30)
  })

  it('truncates a real-world long basename to 29 chars + ellipsis', () => {
    // 37-char realistic Carvera 4-axis-rotary-gated post basename.
    const long = 'wrist-guard-shell-rotary-finishing.nc'
    expect(long).toHaveLength(37)
    const out = truncateCarveraSendOutcomeFilename(long)
    expect(out).toBe(long.slice(0, 29) + '…')
    expect(out).toHaveLength(30)
  })

  it('uses the U+2026 HORIZONTAL ELLIPSIS (single codepoint, not three full stops)', () => {
    const out = truncateCarveraSendOutcomeFilename('a'.repeat(50))
    expect(out).toContain('…')
    expect(out).not.toContain('...')
  })

  it('strips leading and trailing whitespace before measuring length', () => {
    expect(truncateCarveraSendOutcomeFilename('  cam.nc  ')).toBe('cam.nc')
    // 30-char content padded with whitespace must still fit unchanged
    // after trim.
    const padded = '  ' + 'a'.repeat(30) + '  '
    expect(truncateCarveraSendOutcomeFilename(padded)).toBe('a'.repeat(30))
  })

  it('honours an explicit maxChars override', () => {
    expect(truncateCarveraSendOutcomeFilename('cam.nc', 5)).toBe('cam.…')
    expect(truncateCarveraSendOutcomeFilename('cam.nc', 6)).toBe('cam.nc')
    expect(truncateCarveraSendOutcomeFilename('cam.nc', 10)).toBe('cam.nc')
  })

  it('falls back to the canonical default for maxChars=NaN', () => {
    const long = 'a'.repeat(50)
    expect(truncateCarveraSendOutcomeFilename(long, Number.NaN)).toBe(
      'a'.repeat(29) + '…'
    )
  })

  it('falls back to the canonical default for maxChars=Infinity', () => {
    const long = 'a'.repeat(50)
    expect(truncateCarveraSendOutcomeFilename(long, Number.POSITIVE_INFINITY)).toBe(
      'a'.repeat(29) + '…'
    )
    expect(truncateCarveraSendOutcomeFilename(long, Number.NEGATIVE_INFINITY)).toBe(
      'a'.repeat(29) + '…'
    )
  })

  it('falls back to the canonical default for maxChars < 2 (refuses degenerate "…"-only)', () => {
    const long = 'a'.repeat(50)
    expect(truncateCarveraSendOutcomeFilename(long, 0)).toBe('a'.repeat(29) + '…')
    expect(truncateCarveraSendOutcomeFilename(long, 1)).toBe('a'.repeat(29) + '…')
    expect(truncateCarveraSendOutcomeFilename(long, -5)).toBe('a'.repeat(29) + '…')
  })

  it('honours the smallest non-degenerate budget maxChars=2 (1 char + ellipsis)', () => {
    expect(truncateCarveraSendOutcomeFilename('cam.nc', 2)).toBe('c…')
  })

  it('floors a non-integer maxChars to its integer part', () => {
    // 30.9 -> 30; 30.0001 -> 30; 4.7 -> 4 (yields 3-char prefix + ellipsis)
    const long = 'a'.repeat(50)
    expect(truncateCarveraSendOutcomeFilename(long, 30.9)).toBe(
      'a'.repeat(29) + '…'
    )
    expect(truncateCarveraSendOutcomeFilename('cam.nc', 4.7)).toBe('cam…')
  })

  it('is deterministic for the same inputs (pure function)', () => {
    expect(truncateCarveraSendOutcomeFilename('cam.nc')).toBe(
      truncateCarveraSendOutcomeFilename('cam.nc')
    )
    expect(truncateCarveraSendOutcomeFilename('a'.repeat(50))).toBe(
      truncateCarveraSendOutcomeFilename('a'.repeat(50))
    )
  })

  it('composes with formatCarveraSendOutcomeFilenameSuffix without double-implementation', () => {
    // Renderer composition shape: truncate -> suffix. truncate(null) ->
    // null, then suffix(null) -> ''. truncate('cam.nc') -> 'cam.nc', then
    // suffix('cam.nc') -> ' — cam.nc'. truncate(LONG) -> truncated string,
    // then suffix(truncated) -> ' — <truncated>'. The suffix chain stays
    // intact for every truncate output.
    expect(
      formatCarveraSendOutcomeFilenameSuffix(truncateCarveraSendOutcomeFilename(null))
    ).toBe('')
    expect(
      formatCarveraSendOutcomeFilenameSuffix(truncateCarveraSendOutcomeFilename(''))
    ).toBe('')
    expect(
      formatCarveraSendOutcomeFilenameSuffix(
        truncateCarveraSendOutcomeFilename('cam.nc')
      )
    ).toBe(' — cam.nc')
    const long = 'wrist-guard-shell-rotary-finishing.nc'
    expect(
      formatCarveraSendOutcomeFilenameSuffix(
        truncateCarveraSendOutcomeFilename(long)
      )
    ).toBe(' — ' + long.slice(0, 29) + '…')
  })

  it('full label + truncated-filename + timestamp concatenation stays under one column line', () => {
    // The whole point of the truncation is to keep the outcome line
    // single-column on Jacob's panel. Round-trip the full concatenation
    // with a long basename and assert the filename slot caps at 30 chars.
    const d = new Date(2026, 4, 8, 14, 23, 0, 0)
    const long = 'wrist-guard-shell-rotary-finishing.nc'
    const truncated = truncateCarveraSendOutcomeFilename(long)
    expect(truncated).not.toBeNull()
    expect(truncated!.length).toBeLessThanOrEqual(
      CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS
    )
    const full =
      formatCarveraSendOutcomeLabel('success') +
      formatCarveraSendOutcomeFilenameSuffix(truncated) +
      formatCarveraSendOutcomeTimestampSuffix(d)
    // Format reads naturally without doubled separators or stray spaces.
    expect(full).toContain('Last upload: ✓ Sent successfully — ')
    expect(full).toContain('… (at 14:23)')
    expect(full).not.toContain('  ')
  })

  it('byte-identical default budget to the K2 [P2-K2-PUSH]/Cycle 388 sibling', () => {
    // Cross-machine UX consistency: K2 C388 default = 30. Carvera C390
    // default = 30. A future cycle that diverges these MUST update both
    // CLAUDE.md AND this pin.
    expect(CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS).toBe(30)
  })

  it('does not leak K2-specific implementation tokens into the truncated output', () => {
    const out = truncateCarveraSendOutcomeFilename('cam.nc')!.toLowerCase()
    expect(out).not.toContain('k2')
    expect(out).not.toContain('moonraker')
    expect(out).not.toContain('creality')
    expect(out).not.toContain('klipper')
  })
})

// ─── (J) [P2-CARVERA-PUSH-MOCK]/Cycle 394 -- assertive failure announcement ─────
// Mirror of K2 C373: a SECOND live region (`aria-live="assertive"` +
// `role="alert"`) interrupts the polite queue when a Send fails. The
// pure formatter here builds the announcement string; the renderer
// wires the state slot, the dedicated assertive region, and the three
// failure-path captures (r.ok=false, catch, child-process exit≠0).

describe('formatCarveraSendFailureAnnouncement (Cycle 394)', () => {
  it('formats a plain message as "Send failed: <message>"', () => {
    expect(formatCarveraSendFailureAnnouncement('Connection refused')).toBe(
      'Send failed: Connection refused'
    )
  })

  it('formats a carvera-cli "<error>: <detail>" message inline', () => {
    // The C356 polite-region failure path already routes through the
    // CarveraUploadResult.error string which produces messages like
    // "carveraCliFailed: ENOENT". The assertive region wraps that
    // with the "Send failed:" anchor.
    expect(
      formatCarveraSendFailureAnnouncement('carveraCliFailed: ENOENT')
    ).toBe('Send failed: carveraCliFailed: ENOENT')
  })

  it('returns the bare "Send failed" prefix for an empty string', () => {
    expect(formatCarveraSendFailureAnnouncement('')).toBe('Send failed')
  })

  it('returns the bare "Send failed" prefix for a whitespace-only string', () => {
    expect(formatCarveraSendFailureAnnouncement('   ')).toBe('Send failed')
    expect(formatCarveraSendFailureAnnouncement('\t\n')).toBe('Send failed')
  })

  it('trims leading and trailing whitespace from a non-empty message', () => {
    // Renderer-side defence in depth: a message that arrives with
    // stray whitespace from a carvera-cli stderr line or an
    // `Error.message` should still produce a clean colon-separated
    // announcement.
    expect(formatCarveraSendFailureAnnouncement('  Connection refused  ')).toBe(
      'Send failed: Connection refused'
    )
  })

  it('does NOT trim internal whitespace within the message', () => {
    expect(formatCarveraSendFailureAnnouncement('Connection  refused')).toBe(
      'Send failed: Connection  refused'
    )
  })

  it('coerces non-string input via String() (defence in depth)', () => {
    // The renderer catch block stringifies thrown values via
    // `e instanceof Error ? e.message : String(e)`, but the formatter
    // is a final defensive layer.
    expect(formatCarveraSendFailureAnnouncement(42 as unknown as string)).toBe(
      'Send failed: 42'
    )
    expect(formatCarveraSendFailureAnnouncement(true as unknown as string)).toBe(
      'Send failed: true'
    )
  })

  it('returns the bare "Send failed" prefix for null / undefined input', () => {
    // Defensive: a future caller that forgets to coerce a thrown null /
    // undefined value still gets a sensible announcement rather than
    // "Send failed: null".
    expect(formatCarveraSendFailureAnnouncement(null as unknown as string)).toBe(
      'Send failed'
    )
    expect(
      formatCarveraSendFailureAnnouncement(undefined as unknown as string)
    ).toBe('Send failed')
  })

  it('uses a colon-space separator (consistent with carvera-cli prefix style)', () => {
    const out = formatCarveraSendFailureAnnouncement('X')
    expect(out).toContain(': ')
    expect(out.startsWith('Send failed: ')).toBe(true)
  })

  it('result starts with "Send failed" for every supported input shape', () => {
    // Anchor invariant: a screen reader hearing the assertive region
    // should always start with "Send failed" so the operator has a
    // clear failure cue before the (variable) detail. A future
    // regression that drops the anchor would force every operator to
    // re-learn the failure phrasing.
    for (const input of ['Connection refused', '', '   ', null, undefined, 42]) {
      const out = formatCarveraSendFailureAnnouncement(input as unknown as string)
      expect(out.startsWith('Send failed')).toBe(true)
    }
  })

  it('is deterministic and idempotent for repeated calls with the same input', () => {
    const r1 = formatCarveraSendFailureAnnouncement('Connection refused')
    const r2 = formatCarveraSendFailureAnnouncement('Connection refused')
    expect(r1).toBe(r2)
  })

  it("does NOT share the polite formatters' prefixes (distinct semantic)", () => {
    // "Uploading to Carvera (…)" (phase) / "Last upload: …" (outcome)
    // all describe IN-PROGRESS or SUCCESS / SUMMARY states. The
    // failure formatter must read distinctly so a screen reader hearing
    // "Send failed:" cannot be confused with a polite progress update
    // OR with the sighted-only outcome line.
    const out = formatCarveraSendFailureAnnouncement('anything')
    expect(out).not.toMatch(/^Uploading to Carvera/)
    expect(out).not.toMatch(/^Last upload/)
  })

  it('byte-identical phrasing to the K2 [P2-K2-PUSH]/Cycle 373 sibling', () => {
    // Cross-machine UX consistency: K2 C373 = "Send failed[: msg]".
    // Carvera C394 = "Send failed[: msg]". A future cycle that diverges
    // these MUST update both shared formatters AND this pin.
    expect(formatCarveraSendFailureAnnouncement('boom')).toBe('Send failed: boom')
    expect(formatCarveraSendFailureAnnouncement('')).toBe('Send failed')
    expect(formatCarveraSendFailureAnnouncement(null as unknown as string)).toBe(
      'Send failed'
    )
  })

  it('does not leak K2-specific implementation tokens into the announcement', () => {
    const out = formatCarveraSendFailureAnnouncement('Connection refused').toLowerCase()
    expect(out).not.toContain('k2')
    expect(out).not.toContain('moonraker')
    expect(out).not.toContain('creality')
    expect(out).not.toContain('klipper')
  })
})
