/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 360 -- Makera Carvera "Send to
 * Carvera" polite live-region phase helpers.
 *
 * The C356 Send-to-Carvera section in
 * `src/renderer/manufacture/ManufactureAuxPanels.tsx` already announces
 * the start ("Uploading to Carvera...") and terminal
 * ("Uploaded to Carvera: <fname>" / failure) transitions through the
 * existing `aria-live="polite"` region. The directive for Cycle 360 (per
 * `.claude/agent-coordination/daily-directives.md` Carvera P1) is to
 * mirror the K2 [P2-K2-PUSH]/Cycle 358-359 progress-feedback pattern --
 * but adapted to the carvera-cli reality.
 *
 * Unlike the Moonraker chunked HTTP write (where the K2 path streams
 * monotonically increasing byte counts and the renderer renders a
 * percent meter + 25/50/75 thresholds), `carvera-cli` is a child
 * process that emits stdout/stderr LINES as it walks through its
 * connect -> handshake -> transfer -> verify phases. There is no native
 * percent feed, so the Carvera analog of the K2 thresholds is
 * **phase detection**: each stdout line is matched against permissive
 * patterns and surfaces a phase string (`'connecting'`,
 * `'transferring'`, `'verifying'`) routed through the same polite
 * live-region setter that the existing start/terminal announcements use.
 *
 * The matchers are intentionally PERMISSIVE: if a line does not match
 * any phase pattern, no phase is emitted (the baseline
 * "Uploading to Carvera..." message stays visible). A future
 * carvera-cli release that retitles its log lines (or a host where the
 * CLI runs in a non-English locale) loses some intermediate phase
 * announcements but retains the start/terminal envelope -- the worst
 * case is identical to today's pre-Cycle-360 behaviour, never noisier
 * than it.
 *
 * Three-machine cross-cut: DIRECT on Makera Carvera 3-axis ATC only.
 * Carvera 4-axis rotary jobs upload via SD card (the rotary attachment
 * blocks the ATC bay, and the Send-to-Carvera renderer section is
 * gated `!is4Axis` accordingly). Creality K2 Plus uses Moonraker HTTP
 * (see `src/shared/k2-send-progress-thresholds.ts`); Laguna Swift 5x10
 * uses manual USB stick transfer. The phase-detection helpers are
 * therefore Carvera-scoped inside `src/shared/`, mirroring the K2-only
 * scoping of `src/shared/k2-send-progress-thresholds.ts`.
 */

/**
 * Ordered list of progress phases the Carvera Send live-region can
 * announce. Order matches the natural carvera-cli upload lifecycle:
 *
 *   `'connecting'`  -- TCP/USB handshake against the device
 *   `'transferring'` -- bytes flowing from host -> Carvera SD card
 *   `'verifying'`    -- post-transfer integrity / checksum step
 *
 * The completion ("Upload complete." / equivalent) is intentionally
 * NOT a phase here -- it would race with the renderer's terminal
 * "Uploaded to Carvera: <fname>" announcement and clobber the more
 * useful filename feedback. The `as const` modifier gives callers a
 * `readonly ['connecting', 'transferring', 'verifying']` tuple type so
 * a regression that drops or reorders an entry fails the paired pin.
 */
export const CARVERA_SEND_PHASES = ['connecting', 'transferring', 'verifying'] as const

/**
 * Discriminated union of the recognised phases. Exported as a type
 * alias from the readonly tuple so `CarveraSendPhase` always tracks
 * `CARVERA_SEND_PHASES` -- adding/removing a phase updates BOTH the
 * runtime tuple AND the type without manual sync.
 */
export type CarveraSendPhase = (typeof CARVERA_SEND_PHASES)[number]

/**
 * Detect the upload phase a single carvera-cli stdout/stderr line
 * implies, or `null` when the line does not match any known phase.
 *
 * Matchers are case-insensitive and substring-based so a future CLI
 * release that decorates the log line (e.g. timestamps, ANSI escapes,
 * extra prefixes) keeps matching as long as the keyword survives. The
 * renderer treats `null` as "no phase change" -- the live-region keeps
 * announcing the previous phase / baseline message.
 *
 * Order of the `for` loop matches `CARVERA_SEND_PHASES` so that a line
 * that contains keywords from multiple phases (rare but possible)
 * resolves to the EARLIER phase, never the later one. Misclassifying
 * an early line as the later phase would skip a screen-reader update;
 * the conservative direction is the early phase.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 * - empty / whitespace-only line                       -> null
 * - non-matching line ("foo bar baz")                  -> null
 * - "Connecting to 192.168.4.1..."                     -> 'connecting'
 * - "Connection established."                          -> 'connecting'
 * - "Uploading cam.nc..."                              -> 'transferring'
 * - "Transferring 12345 bytes..."                      -> 'transferring'
 * - "Sending block 42..."                              -> 'transferring'
 * - "Verifying checksum..."                            -> 'verifying'
 * - "Verification ok."                                 -> 'verifying'
 * - "Upload complete."                                 -> null (intentional)
 */
export function detectCarveraSendPhase(line: string): CarveraSendPhase | null {
  if (typeof line !== 'string') return null
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  const lower = trimmed.toLowerCase()
  for (const phase of CARVERA_SEND_PHASES) {
    if (matchesCarveraSendPhase(phase, lower)) return phase
  }
  return null
}

/**
 * Pure pattern table for `detectCarveraSendPhase`. Kept as an internal
 * helper rather than an exported map so callers cannot bypass the
 * loop ordering in `detectCarveraSendPhase` (which guarantees
 * earlier-phase resolution on multi-keyword lines).
 *
 * `lower` is assumed already lower-cased and trimmed by the caller.
 */
function matchesCarveraSendPhase(phase: CarveraSendPhase, lower: string): boolean {
  switch (phase) {
    case 'connecting':
      return /\b(connect(ing|ion)?|handshak\w+)\b/.test(lower)
    case 'transferring':
      return /\b(uploading|transfer(ring)?|sending)\b/.test(lower)
    case 'verifying':
      return /\b(verif(y|ying|ication)|checksum)\b/.test(lower)
  }
}

/**
 * Format the polite live-region announcement string for a given
 * phase. The renderer routes the result into `setCarveraSendStatus`
 * (the existing C356 live-region setter) so the same
 * `aria-live="polite" + aria-atomic="true"` paragraph announces it.
 *
 * Phrasing chosen to extend the start-of-upload message
 * "Uploading to Carvera..." into a coherent narrative -- a screen
 * reader reads "Uploading to Carvera..." then "Uploading to Carvera
 * (transferring)..." rather than restarting context. The trailing
 * horizontal ellipsis (U+2026) matches the existing live-region
 * punctuation so speech engines render the trail-off the same way for
 * both messages, AND matches the K2 sibling formatter in
 * `src/shared/k2-send-progress-thresholds.ts`.
 */
export function formatCarveraSendPhaseAnnouncement(phase: CarveraSendPhase): string {
  return `Uploading to Carvera (${phase})…`
}

/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 382 -- last-upload outcome label
 * formatter for the Makera Carvera "Send to Carvera" path.
 *
 * The C356 polite live-region announces normal status transitions
 * ("Uploading to Carvera…" -> "Uploaded to Carvera: <fname>" / failure)
 * and the C360 phase announcer surfaces intermediate connect / transfer
 * / verify lifecycle ticks. Both live-region paragraphs render with
 * muted styling (`msg msg--muted`) -- so a sighted operator who glances
 * back at the Manufacture panel after a long upload has no at-a-glance
 * way to tell whether the most-recent Send succeeded or failed without
 * parsing the full live-region text. On a multi-machine workday the
 * operator may see "Carvera upload failed: …" in the same muted tone
 * as a successful "Uploaded to Carvera: cam.nc" and miss the failure
 * entirely.
 *
 * Cycle 382 closes that gap by mirroring the [P2-K2-PUSH]/Cycle 375
 * `formatK2SendOutcomeLabel` pattern: a tiny SIGHTED-ONLY outcome
 * summary line surfaces a clear ✓ (U+2713 CHECK MARK) / ✗ (U+2717
 * BALLOT X) glyph plus a brief label after each completed Send. The
 * renderer element carries `aria-hidden="true"` so screen readers do
 * NOT re-announce (they already heard the polite region); this is a
 * sighted-equality polish, not a screen-reader feature. The element
 * also carries `data-state="success" | "failure"` so future CSS can
 * tint the line green/red without changing the test surface AND so
 * tests can assert the state transition without parsing glyphs.
 *
 * Phrasing: IDENTICAL to the K2 sibling (`formatK2SendOutcomeLabel`)
 * so a sighted operator switching between machines on the My-Shop
 * preset bar reads the same outcome semantics regardless of target.
 * Cross-machine UX consistency is intentional -- the K2 evolution
 * (C375 outcome label + C378 colour cue + C380 timestamp suffix)
 * is the structural model and the Carvera path will follow the same
 * progression in subsequent cycles.
 *
 * Outcome states:
 * - `'success'` -> "Last upload: ✓ Sent successfully"
 * - `'failure'` -> "Last upload: ✗ Failed"
 *
 * The renderer holds the outcome in a `useState<CarveraSendOutcome |
 * null>` slot. `null` (the initial state) renders no element. The slot
 * is RESET to `null` at the top of `sendToCarvera` so an in-flight
 * Send temporarily hides the previous attempt's outcome line until the
 * new outcome resolves -- this is intentional UX: while uploading, the
 * progress meter + polite region are the authoritative feedback, and
 * a stale "✓ Sent successfully" from a prior attempt would be
 * misleading mid-stream.
 *
 * Three-machine cross-cut: DIRECT on Makera Carvera 3-axis ATC only.
 * The Carvera 4-axis rotary path uploads via SD card (the rotary
 * attachment occupies the ATC bay); the renderer Send section is
 * gated `!is4Axis` so this outcome line never appears on the 4-axis
 * branch. K2 Plus has its own outcome label (C375) on the K2 Send
 * section; Laguna Swift 5x10 uses manual USB stick transfer.
 *
 * Roadmap: [P2-CARVERA-PUSH-MOCK]/Cycle 382.
 */
export type CarveraSendOutcome = 'success' | 'failure'

export function formatCarveraSendOutcomeLabel(outcome: CarveraSendOutcome): string {
  if (outcome === 'success') return 'Last upload: ✓ Sent successfully'
  return 'Last upload: ✗ Failed'
}

/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 388 -- timestamp suffix for the
 * Cycle 382 sighted-only last-upload outcome label (mirror of the K2
 * [P2-K2-PUSH]/Cycle 380 `formatK2SendOutcomeTimestampSuffix`).
 *
 * The C382 outcome label ("Last upload: ✓ Sent successfully" / "Last
 * upload: ✗ Failed") tells a sighted Carvera operator WHETHER the last
 * Send-to-Carvera succeeded but not WHEN it resolved. On a multi-job
 * day at the bench (drilling a wrist guard, then a calibration cube,
 * then a fixture plate) the operator may glance back at the Manufacture
 * panel after a long ATC tool-change run away from the desk and see
 * "Last upload: ✓ Sent successfully" with no temporal anchor -- is that
 * from the upload they kicked off five seconds ago, or from this
 * morning before lunch? The line is a SUMMARY (it persists across
 * re-renders, with the only reset being the start of the next Send),
 * so without a timestamp it provides no signal about freshness.
 *
 * Cycle 388 closes that gap by porting the K2 C380 structural model:
 * `formatCarveraSendOutcomeTimestampSuffix(date)` returns ` (at HH:MM)`
 * for a valid Date input and the empty string for null / undefined /
 * non-Date / NaN-time inputs (defence in depth -- the renderer captures
 * `new Date()` at the moment the outcome resolves so the happy path
 * always passes a valid Date, but a future regression that forgets to
 * capture the timestamp must NOT crash the panel).
 *
 * The renderer concatenates the suffix into the existing JSX:
 *   {formatCarveraSendOutcomeLabel(carveraSendLastOutcome)
 *    + formatCarveraSendOutcomeTimestampSuffix(carveraSendLastOutcomeAt)}
 *
 * Pure separation lets the C382 source-text pin keep enforcing the
 * single-arg `formatCarveraSendOutcomeLabel(CarveraSendOutcome): string`
 * signature -- the timestamp is a SECOND helper rather than a second
 * parameter, so a future cycle that wants to localise / reformat the
 * timestamp affects only this companion and the renderer's `useState`
 * slot for the captured Date.
 *
 * Format choice: 24-hour HH:MM with the operator's LOCAL timezone
 * (Date#getHours / Date#getMinutes) and zero-padding via padStart.
 * Local time pairs with the operator's wall clock at the bench; UTC
 * would require an extra mental conversion every glance. The literal
 * " (at HH:MM)" prefix matches the K2 sibling formatter byte-for-byte
 * so a sighted operator switching between machines via the My-Shop
 * preset bar reads the same temporal-anchor format regardless of
 * target. The leading space is part of the suffix so the renderer's
 * concatenation reads naturally without an extra space-template at
 * the call site.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 *  - null               -> '' (initial state slot)
 *  - undefined          -> '' (defensive)
 *  - non-Date object    -> '' (defence-in-depth; TS keeps the call
 *    site honest, but a runtime caller could pass a number / string)
 *  - Date with NaN time (`new Date('not-a-date')`)  -> ''
 *  - 09:05 local time   -> ' (at 09:05)' (zero-padded both fields)
 *  - 23:59 local time   -> ' (at 23:59)' (top-of-day boundary)
 *  - 00:00 local time   -> ' (at 00:00)' (start-of-day boundary)
 *
 * Three-machine cross-cut: DIRECT on Makera Carvera 3-axis ATC only.
 * Same Carvera-only invariant as the surrounding helpers in this
 * module -- Carvera 4-axis rotary uploads via SD card (rotary
 * attachment occupies the ATC bay), K2 Plus has its own timestamp
 * suffix (K2 C380), Laguna Swift 5x10 uses manual USB stick transfer.
 *
 * Roadmap: [P2-CARVERA-PUSH-MOCK]/Cycle 388.
 */
export function formatCarveraSendOutcomeTimestampSuffix(
  date: Date | null | undefined
): string {
  if (date == null) return ''
  if (!(date instanceof Date)) return ''
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return ` (at ${hh}:${mm})`
}

/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 390 -- filename suffix for the
 * C382 sighted-only last-upload outcome label (mirror of the K2
 * [P2-K2-PUSH]/Cycle 383 `formatK2SendOutcomeFilenameSuffix`).
 *
 * The C382 outcome label tells the operator WHETHER the last Send
 * succeeded; the C388 timestamp suffix tells them WHEN it resolved.
 * Both are useful but answer questions about the LAST upload as a
 * single event. On a busy multi-job day where the operator has posted
 * several Carvera 3-axis ATC jobs in a row -- a wrist-guard pocket,
 * a fixture-plate drill cycle, a calibration cube -- the outcome line
 * "Last upload: ✓ Sent successfully (at 14:23)" still requires the
 * operator to remember which post they pushed last to know whether
 * they need to re-Send the wrist-guard or the cube.
 *
 * Cycle 390 closes that gap with a tiny pure-formatter companion:
 * `formatCarveraSendOutcomeFilenameSuffix(filename)` returns
 * ` — <filename>` (U+2014 EM DASH separator, byte-identical to the K2
 * sibling) for a non-empty string input and the empty string for null
 * / undefined / non-string / whitespace-only inputs (defence in depth
 * -- the renderer captures `r.filename ?? basename(carveraSendCandidatePath)`
 * at success and the bare basename at failure, so the happy path
 * always passes a non-empty string, but a future regression that
 * forgets to capture the filename must NOT crash the panel).
 *
 * The renderer concatenates the suffix into the existing JSX:
 *   {formatCarveraSendOutcomeLabel(carveraSendLastOutcome)
 *    + formatCarveraSendOutcomeFilenameSuffix(
 *        truncateCarveraSendOutcomeFilename(carveraSendLastOutcomeFilename))
 *    + formatCarveraSendOutcomeTimestampSuffix(carveraSendLastOutcomeAt)}
 *
 * Pure separation lets the C382 source-text pin keep enforcing the
 * single-arg `formatCarveraSendOutcomeLabel(CarveraSendOutcome): string`
 * signature -- the filename is a THIRD helper rather than a second
 * parameter on the existing label or timestamp formatters, so a future
 * cycle that wants to abbreviate / link / colourise the filename
 * affects only this companion and the renderer's `useState` slot for
 * the captured filename.
 *
 * Format choice: ` — <filename>` (em dash with surrounding spaces),
 * BYTE-IDENTICAL to the K2 sibling so a sighted operator switching
 * between machines via the My-Shop preset bar reads the same
 * typographic punctuation regardless of target. The em dash matches
 * the C368 K2 bracket-announcement separator style for cross-surface
 * consistency. The leading space + em dash + trailing space are part
 * of the suffix so the renderer's concatenation reads naturally
 * without an extra space-template at the call site (parallel of the
 * C388 timestamp leading-space invariant).
 *
 * Suffix-order in the renderer: label + filename + timestamp
 * (mirroring the K2 C383 + C380 sibling ordering). The filename sits
 * BEFORE the timestamp because:
 *   - "Last upload: ✓ Sent successfully — wrist-guard.nc (at 14:23)"
 *     reads more naturally than
 *   - "Last upload: ✓ Sent successfully (at 14:23) — wrist-guard.nc"
 *
 * The filename answers "what" and the timestamp answers "when"; the
 * "what" is the more decision-relevant scrap of context for an operator
 * deciding whether to re-Send a job, so it reads first.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 *  - null  -> '' (defensive)
 *  - undefined  -> '' (defensive)
 *  - empty string  -> '' (defence-in-depth; renderer never passes this
 *    intentionally but a future regression that captures `r.filename`
 *    when carvera-cli returns an empty string would land here)
 *  - whitespace-only string  -> '' (parallel of the K2 sibling)
 *  - non-string input  -> '' (defence-in-depth; TS narrows the call
 *    site, but a runtime caller could pass a number / object)
 *  - 'cam.nc'  -> ' — cam.nc'
 *  - '  cam.nc  '  -> ' — cam.nc' (trim leading/trailing whitespace)
 *  - 'multi word slice.nc'  -> ' — multi word slice.nc' (interior
 *    whitespace preserved)
 *
 * Three-machine cross-cut: DIRECT on Makera Carvera 3-axis ATC only.
 * Same Carvera-only invariant as the surrounding helpers -- Carvera
 * 4-axis rotary uploads via SD card (rotary attachment occupies the
 * ATC bay), K2 Plus has its own filename suffix (K2 C383), Laguna
 * Swift 5x10 uses manual USB stick transfer.
 *
 * Roadmap: [P2-CARVERA-PUSH-MOCK]/Cycle 390.
 */
export function formatCarveraSendOutcomeFilenameSuffix(
  filename: string | null | undefined
): string {
  if (filename == null) return ''
  if (typeof filename !== 'string') return ''
  const trimmed = filename.trim()
  if (trimmed.length === 0) return ''
  return ` — ${trimmed}`
}

/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 390 -- length-bounded truncation
 * companion for the filename suffix above (mirror of the K2
 * [P2-K2-PUSH]/Cycle 388 `truncateK2SendOutcomeFilename`).
 *
 * The filename suffix surfaces the basename of the last-uploaded post
 * in the sighted-only outcome line so a sighted operator on a busy
 * multi-job day knows WHICH file the outcome refers to. On Jacob's
 * Manufacture-panel column width the outcome line is one line of muted
 * body text -- a long basename like
 * "wrist-guard-shell-rotary-finishing-pass.nc" (42 chars) either wraps
 * to a second line (breaking the panel's vertical rhythm) or pushes
 * the C388 timestamp suffix off the visible column entirely (so the
 * operator loses the freshness anchor that C388 added).
 *
 * Cycle 390 closes that gap with a tiny pure-truncation companion:
 * `truncateCarveraSendOutcomeFilename(filename, maxChars?)` returns a
 * length-bounded version of the input filename, replacing the tail
 * with a U+2026 HORIZONTAL ELLIPSIS character if the trimmed input
 * exceeds `maxChars`. Defaults to `CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS`
 * (30) -- byte-identical to the K2 sibling default for cross-machine
 * column-width parity on Jacob's standard Manufacture-panel resolution
 * that keeps `label + filename + timestamp` on a single line for typical
 * post basenames (cam.nc / drawer-pull.nc / wrist-guard.nc) without
 * cropping.
 *
 * Composition: the renderer threads the helper BEFORE the suffix
 * formatter so the suffix's defensive null/undefined chain stays intact:
 *   formatCarveraSendOutcomeFilenameSuffix(
 *     truncateCarveraSendOutcomeFilename(carveraSendLastOutcomeFilename)
 *   )
 *
 * Returns `string | null`:
 *  - `null` for null / undefined / non-string / whitespace-only input
 *    (so `formatCarveraSendOutcomeFilenameSuffix(null)` resolves to ''
 *    via its existing defence-in-depth chain -- no double-implementation)
 *  - the trimmed input string when its length is <= maxChars
 *  - `<first (maxChars - 1) chars>…` when the trimmed input exceeds
 *    maxChars (the U+2026 occupies one display column so we reserve
 *    one char for it within the budget)
 *
 * `maxChars` parameter is defensive: a non-finite or < 2 value falls
 * back to the canonical 30-char default. A maxChars < 2 cannot fit
 * even one informative char + the ellipsis, so the helper refuses to
 * truncate to a degenerate "…"-only line and uses the default instead.
 *
 * Format choice: U+2026 HORIZONTAL ELLIPSIS (single codepoint) instead
 * of three U+002E FULL STOPs ("..."). The single codepoint reads as
 * one character in screen-readers (the renderer keeps `aria-hidden="true"`
 * so this is sighted-only, but the codepoint choice still matters for
 * future re-use in announce paths). Three dots would visually consume
 * 3 columns + a kerning ambiguity that defeats the truncation purpose.
 *
 * The C390 separator (` — `) and the C388 timestamp ` (at HH:MM)`
 * format remain pinned at their respective helpers; this cycle only
 * shortens the basename slot.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 *  - null  -> null (defensive; renderer's initial state slot)
 *  - undefined  -> null (defensive)
 *  - empty string  -> null (defence-in-depth; matches suffix's chain)
 *  - whitespace-only string  -> null (parallel of suffix's trim)
 *  - non-string input  -> null (defence-in-depth; TS narrows call site)
 *  - 'cam.nc'  -> 'cam.nc' (unchanged; well under 30)
 *  - 30-char input  -> 30-char input unchanged (boundary)
 *  - 31-char input  -> 29-char prefix + '…' (truncated)
 *  - 'wrist-guard-shell-rotary-finishing.nc' (37 chars) ->
 *    'wrist-guard-shell-rotary-fini…' (29 chars + ellipsis = 30 chars)
 *  - leading/trailing whitespace stripped before length check
 *  - maxChars=NaN  -> default 30
 *  - maxChars=Infinity  -> default 30
 *  - maxChars=0 / 1  -> default 30 (refuses to truncate to "…"-only)
 *  - maxChars=2  -> 1-char prefix + '…'
 *
 * Three-machine cross-cut: DIRECT on Makera Carvera 3-axis ATC only.
 * Same Carvera-only invariant as the surrounding helpers in this
 * module -- K2 Plus has its own truncation (K2 C388), Laguna Swift
 * 5x10 uses manual USB stick transfer (no filename feedback).
 *
 * Roadmap: [P2-CARVERA-PUSH-MOCK]/Cycle 390.
 */
export const CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS = 30 as const

export function truncateCarveraSendOutcomeFilename(
  filename: string | null | undefined,
  maxChars: number = CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS
): string | null {
  if (filename == null) return null
  if (typeof filename !== 'string') return null
  const trimmed = filename.trim()
  if (trimmed.length === 0) return null
  const intMax =
    Number.isFinite(maxChars) && maxChars >= 2
      ? Math.floor(maxChars)
      : CARVERA_SEND_OUTCOME_FILENAME_MAX_CHARS
  if (trimmed.length <= intMax) return trimmed
  return trimmed.slice(0, intMax - 1) + '…'
}

/**
 * Phase 2 [P2-CARVERA-PUSH-MOCK]/Cycle 394 -- assertive live-region
 * failure announcement formatter for the Makera Carvera "Send to
 * Carvera" path (mirror of the K2 [P2-K2-PUSH]/Cycle 373
 * `formatK2SendFailureAnnouncement`).
 *
 * The C356 polite live-region announces normal status transitions
 * ("Uploading to Carvera…" -> "Uploaded to Carvera: <fname>" / failure)
 * and the C360 phase announcer surfaces intermediate connect / transfer
 * / verify lifecycle ticks. Polite regions queue announcements until
 * the screen reader is idle, which on a long carvera-cli upload (the
 * connect → handshake → transfer → verify lifecycle is multi-second
 * even on a clean LAN) can stack several mid-stream
 * "Uploading to Carvera (transferring)…" announcements AHEAD of a
 * terminal failure -- so an operator who walks away mid-upload may
 * hear the failure long after it happened, after they have already
 * moved on assuming the job is staged on the Carvera SD card.
 *
 * Cycle 394 closes that gap by porting the K2 C373 structural model:
 * a SECOND live region with `aria-live="assertive"` + `role="alert"`
 * dedicated to FAILURES only. Assertive regions INTERRUPT the current
 * speech queue so a carvera-cli child-process exit-code-non-zero, a
 * `CarveraUploadResult.ok=false`, or a JS exception thrown out of
 * `window.fab.carveraCliRun` reaches the operator immediately. This is
 * a safety surface: a failed upload that the operator does not notice
 * can lead to "I told carvera-cli to stage the job but the SD card
 * never received the file, did the bytes even leave my computer?"
 * confusion AND (worse) blind reliance on a stale prior post the
 * operator forgot was still on the SD card.
 *
 * The polite region keeps its existing failure path too -- this is a
 * REDUNDANT announcement, not a replacement -- so an operator with a
 * screen reader configured to ignore assertive regions still hears
 * the failure via the polite queue. The only change in the renderer
 * is a NEW state slot + NEW dedicated live region; the existing
 * polite-region failure path is unchanged.
 *
 * Phrasing: "Send failed: <message>". BYTE-IDENTICAL to the K2 sibling
 * `formatK2SendFailureAnnouncement` so a sighted+screen-reader operator
 * switching between machines via the My-Shop preset bar reads the same
 * failure-announcement format regardless of target. The "Send failed:"
 * prefix gives the screen reader a clear semantic anchor before the
 * (potentially long, potentially carvera-cli-formatted) detail. Empty
 * / blank input collapses to the bare "Send failed" prefix so the
 * live region never reads an empty colon-tail. Defensive: non-string
 * input is coerced to its string representation rather than thrown --
 * the renderer's catch block already coerces `Error.message` and
 * unknown exceptions, so this helper is a defence-in-depth final
 * formatter not an exception barrier.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 *  - 'Connection refused'         -> 'Send failed: Connection refused'
 *  - 'carveraCliFailed: ENOENT'   -> 'Send failed: carveraCliFailed: ENOENT'
 *  - ''                           -> 'Send failed'
 *  - '   ' / '\t\n'               -> 'Send failed'
 *  - '  Connection refused  '     -> 'Send failed: Connection refused'
 *  - 'Connection  refused'        -> 'Send failed: Connection  refused'
 *    (interior whitespace preserved)
 *  - 42 (non-string)              -> 'Send failed: 42'
 *  - true (non-string)            -> 'Send failed: true'
 *  - null / undefined             -> 'Send failed'
 *
 * Three-machine cross-cut: DIRECT on Makera Carvera 3-axis ATC only.
 * Same Carvera-only invariant as the surrounding helpers in this
 * module -- Carvera 4-axis rotary uploads via SD card (rotary
 * attachment occupies the ATC bay, Send section gated `!is4Axis`),
 * K2 Plus has its own assertive failure formatter (K2 C373), Laguna
 * Swift 5x10 uses manual USB stick transfer (no live region needed).
 *
 * Roadmap: [P2-CARVERA-PUSH-MOCK]/Cycle 394.
 */
export function formatCarveraSendFailureAnnouncement(message: unknown): string {
  if (typeof message !== 'string') {
    if (message == null) return 'Send failed'
    return `Send failed: ${String(message)}`
  }
  const trimmed = message.trim()
  if (trimmed.length === 0) return 'Send failed'
  return `Send failed: ${trimmed}`
}
