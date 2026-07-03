/**
 * Phase 2 [P2-K2-PUSH]/Cycle 359 + Cycle 368 -- Creality K2 Plus "Send
 * to Printer" polite live-region threshold + bracket helpers.
 *
 * The C358 upload-progress wiring streams percent ticks from the main
 * process Moonraker push handler to the renderer's `<progress>` meter.
 * For sighted users that meter (plus its "N% uploaded" label) is the
 * primary visual feedback. For screen-reader users the meter announces
 * via the implicit role="progressbar" mapping only when focus enters it,
 * which on a long upload leaves the user without mid-flight feedback
 * unless they navigate away from the Send button.
 *
 * The C354 polite live-region (`data-testid="k2-send-to-printer-status"`)
 * already announces the start ("Uploading to K2 Plus...") and terminal
 * ("Started on K2 Plus: <file>" / failure) transitions. Cycle 359 fills
 * the gap in the middle: at 25/50/75% the live region reads a coherent
 * "Uploading to K2 Plus: N%..." update so a screen-reader user hears
 * roughly four announcements (start + 3 thresholds + done) over a long
 * Moonraker push instead of just two. 100% is intentionally NOT a
 * threshold here -- it would race with the `Started on K2 Plus: <file>`
 * terminal announcement and clobber the more useful filename feedback.
 *
 * Cycle 368 (per the C366 hand-off Option 4 "fully-bracketed live-region
 * coverage") adds the matched BRACKET helpers at 0% and 100%. Brackets
 * are SEMANTICALLY DISTINCT from thresholds: the 0-bracket announces
 * "Upload starting" the moment the IPC channel begins streaming bytes
 * (confirming to a screen-reader user that the click-to-Send actually
 * fired vs. a silent IPC failure), and the 100-bracket announces
 * "Upload complete -- printer beginning the job" the moment the meter
 * reaches 100% (bridging the gap between byte-transfer-complete and the
 * subsequent `Started on K2 Plus: <file>` terminal announcement, which
 * arrives only after Moonraker accepts the start_print command). The
 * brackets and thresholds use SEPARATE Sets in the renderer so they
 * never starve each other out, and the renderer prioritises the most
 * informative message when both fire on the same tick:
 * 100-bracket > highest-threshold > 0-bracket.
 *
 * The threshold + bracket lists are exported as `readonly` tuples so a
 * future regression that flips the order or drops a value fails the
 * paired pin. Both detection helpers are PURE functions -- they accept
 * the current percent and the set of milestones already announced, and
 * return the (sorted ascending) list of newly-crossed milestones. The
 * renderer holds each `Set` in a `useRef` so the milestone-crossing
 * check does not trigger an extra re-render on every progress tick;
 * it only re-renders when the announcement updates the local status state.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Laguna
 * Swift 5x10 + Makera Carvera do not use the Moonraker push path
 * (Laguna posts to file + RichAuto controller, Carvera posts via
 * `carvera-cli`), so the threshold + bracket helpers are intentionally
 * K2-scoped inside `src/shared/` -- following the same K2-only pattern
 * as `src/shared/k2-plus-slice-presets.ts`.
 *
 * Roadmap: [P2-K2-PUSH]/Cycle 359 + Cycle 368 (post-Cycle-358 chunked-
 * upload meter polish per the C358 hand-off Option 4 + C366 hand-off
 * Option 4 fully-bracketed live-region coverage).
 */

/**
 * Polite live-region announcement thresholds for the K2 Plus Send
 * upload-progress feed. Ordered ascending so iteration that stops on
 * the highest-newly-crossed threshold reports the most informative
 * message first ("...50%..." beats "...25..." once both have crossed).
 *
 * The `as const` modifier forces a `readonly [25, 50, 75]` tuple type
 * so callers cannot accidentally mutate the shared list.
 */
export const K2_SEND_PROGRESS_THRESHOLDS = [25, 50, 75] as const

/**
 * Detect which announcement thresholds the current percent has crossed
 * for the first time during this upload.
 *
 * The renderer tracks already-announced thresholds in a `useRef<Set<number>>`
 * scoped to the lifetime of a single Send invocation (reset to an empty
 * Set at the top of `sendToK2Plus`). On each progress tick the renderer
 * passes the current percent and the ref's Set; this helper returns the
 * newly-crossed thresholds (ascending) so the caller can update the
 * Set AND announce the highest-crossed threshold via the existing
 * `setK2SendStatus` call.
 *
 * Returns a `readonly number[]` rather than a single number so callers
 * that want to record every newly-crossed threshold (e.g. for a future
 * cumulative log) have access to the full list. Today the renderer
 * announces only the highest -- callers can pick `result[result.length - 1]`.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 * - percent < 25  -> []
 * - percent 25, alreadyAnnounced empty  -> [25]
 * - percent 60, alreadyAnnounced empty  -> [25, 50] (sorted ascending)
 * - percent 75, alreadyAnnounced has 25 -> [50, 75]
 * - percent 100, alreadyAnnounced has 25,50,75 -> []
 * - non-finite percent  -> []
 * - percent 99, alreadyAnnounced empty  -> [25, 50, 75]
 */
export function k2SendThresholdsCrossed(
  percent: number,
  alreadyAnnounced: ReadonlySet<number>
): readonly number[] {
  if (!Number.isFinite(percent)) return []
  const newly: number[] = []
  for (const threshold of K2_SEND_PROGRESS_THRESHOLDS) {
    if (percent >= threshold && !alreadyAnnounced.has(threshold)) {
      newly.push(threshold)
    }
  }
  return newly
}

/**
 * Format the polite live-region announcement string for a given
 * threshold. The renderer routes the result into `setK2SendStatus`
 * (the existing C354 live-region setter) so the same `aria-live="polite"
 * + aria-atomic="true"` paragraph announces it.
 *
 * Phrasing chosen to extend the start-of-upload message
 * "Uploading to K2 Plus..." into a coherent narrative -- a screen
 * reader reads "Uploading to K2 Plus..." then "Uploading to K2 Plus:
 * 25%..." rather than restarting context. The trailing horizontal
 * ellipsis (U+2026) matches the existing live-region punctuation so
 * speech engines render the trail-off the same way for both messages.
 */
export function formatK2SendThresholdAnnouncement(threshold: number): string {
  return `Uploading to K2 Plus: ${threshold}%…`
}

/**
 * Phase 2 [P2-K2-PUSH]/Cycle 368 -- bracket announcement constants for
 * the start (0%) and terminal (100%) edges of the Moonraker upload.
 *
 * Brackets are SEMANTICALLY DISTINCT from `K2_SEND_PROGRESS_THRESHOLDS`:
 *
 * - The 0-bracket fires the moment the IPC stream emits its first
 *   progress tick (which, because `MOONRAKER_UPLOAD_CHUNK_BYTES` writes
 *   the first chunk before invoking `onProgress`, may carry any percent
 *   from 1..100 -- but `k2SendBracketsCrossed` records 0 as crossed on
 *   that first tick because every percent is `>= 0`). This confirms to
 *   a screen-reader user that the click-to-Send actually started byte
 *   transfer rather than failing silently in the IPC plumbing.
 *
 * - The 100-bracket fires the moment the meter hits 100% -- bridging
 *   the gap between byte-transfer-complete and the subsequent terminal
 *   `Started on K2 Plus: <file>` announcement (which only arrives after
 *   Moonraker accepts the start_print command, which can take a perceptible
 *   beat on slow links). The 100-bracket message is intentionally
 *   different from the start-print announcement: "Upload complete --
 *   printer beginning the job" describes the precise transitional moment
 *   where the bytes are on the printer but the print has not yet started.
 *
 * The `as const` modifier forces a `readonly [0, 100]` tuple type so
 * callers cannot accidentally mutate the shared list.
 */
export const K2_SEND_PROGRESS_BRACKETS = [0, 100] as const

/**
 * Detect which bracket announcements the current percent has crossed
 * for the first time during this upload.
 *
 * Mirrors `k2SendThresholdsCrossed` shape exactly so the renderer can
 * track brackets in a parallel `useRef<Set<number>>` and announce the
 * highest bracket per tick alongside the threshold logic.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 * - percent < 0  -> [] (defence in depth; renderer also clamps)
 * - percent 0, alreadyAnnounced empty  -> [0]
 * - percent 5, alreadyAnnounced empty  -> [0] (first-tick semantics)
 * - percent 50, alreadyAnnounced has 0  -> []
 * - percent 100, alreadyAnnounced empty  -> [0, 100] (sorted ascending)
 * - percent 100, alreadyAnnounced has 0  -> [100]
 * - percent 100, alreadyAnnounced has 0,100  -> []
 * - non-finite percent  -> []
 */
export function k2SendBracketsCrossed(
  percent: number,
  alreadyAnnounced: ReadonlySet<number>
): readonly number[] {
  if (!Number.isFinite(percent)) return []
  const newly: number[] = []
  for (const bracket of K2_SEND_PROGRESS_BRACKETS) {
    if (percent >= bracket && !alreadyAnnounced.has(bracket)) {
      newly.push(bracket)
    }
  }
  return newly
}

/**
 * Format the polite live-region announcement string for a given bracket.
 *
 * - `0` -> "Upload starting" (start of byte transfer)
 * - `100` -> "Upload complete — printer beginning the job" (terminal
 *   moment between meter-100% and the Moonraker start_print acknowledgment)
 *
 * The 100-bracket uses a U+2014 EM DASH so a screen reader renders the
 * brief pause between the two clauses instead of speaking "dash". Any
 * other input falls back to a generic "Upload progress: N%" phrase --
 * defence in depth against a future bracket addition that forgets to
 * update this formatter; the paired pin asserts the two production
 * branches AND the fallback shape.
 */
export function formatK2SendBracketAnnouncement(bracket: number): string {
  if (bracket === 100) return 'Upload complete — printer beginning the job'
  if (bracket === 0) return 'Upload starting'
  return `Upload progress: ${bracket}%`
}

/**
 * Phase 2 [P2-K2-PUSH]/Cycle 373 -- assertive live-region failure
 * announcement formatter for the K2 Plus "Send to Printer" path.
 *
 * The C354 polite live-region announces normal status transitions
 * ("Uploading to K2 Plus…" -> "Started on K2 Plus: <file>") plus the
 * C359 threshold + C368 bracket milestones. Polite regions queue
 * announcements until the screen reader is idle, which on a long
 * upload can stack several mid-stream "Uploading: N%…" announcements
 * AHEAD of a terminal failure -- so a user who walks away mid-upload
 * may hear the failure long after it happened, after the printer is
 * already idle and they have moved on assuming the job is running.
 *
 * Cycle 373 adds a SECOND live region with `aria-live="assertive"` +
 * `role="alert"` dedicated to FAILURES only. Assertive regions
 * INTERRUPT the current speech queue so a Moonraker push failure or
 * a JS exception thrown out of `window.fab.moonrakerPush` reaches the
 * user immediately. This is a safety surface: a failed upload that
 * the user does not notice can lead to "I told the printer to start
 * but it never did, did the bytes even leave my computer?" confusion
 * AND (worse) blind reliance on a print that never began.
 *
 * The polite region keeps its existing failure path too -- this is a
 * REDUNDANT announcement, not a replacement -- so a user with a
 * screen reader configured to ignore assertive regions still hears
 * the failure via the polite queue. The only change in the renderer
 * is a NEW state slot + NEW dedicated live region; the existing
 * polite-region failure path is unchanged.
 *
 * Phrasing: "Send failed: <message>". The "Send failed:" prefix gives
 * the screen reader a clear semantic anchor before the (potentially
 * long, potentially Moonraker-formatted) detail. Empty / blank input
 * collapses to the bare "Send failed" prefix so the live region
 * never reads an empty colon-tail. Defensive: non-string input is
 * coerced to its string representation rather than thrown -- the
 * renderer's catch block already coerces `Error.message` and unknown
 * exceptions, so this helper is a defence-in-depth final formatter
 * not an exception barrier.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Laguna
 * Swift 5x10 + Makera Carvera have their own Send paths and their
 * own live regions (the Carvera path's "phase" announcer is the
 * structural model; an assertive failure region for Carvera is a
 * separate future cycle).
 *
 * Roadmap: [P2-K2-PUSH]/Cycle 373.
 */
export function formatK2SendFailureAnnouncement(message: unknown): string {
  if (typeof message !== 'string') {
    if (message == null) return 'Send failed'
    return `Send failed: ${String(message)}`
  }
  const trimmed = message.trim()
  if (trimmed.length === 0) return 'Send failed'
  return `Send failed: ${trimmed}`
}

/**
 * Phase 2 [P2-K2-PUSH]/Cycle 375 -- last-upload outcome label formatter
 * for the K2 Plus "Send to Printer" path.
 *
 * The C354 polite live-region announces normal status transitions
 * ("Uploading to K2 Plus…" -> "Started on K2 Plus: <file>" / failure)
 * and the C373 assertive region interrupts on failures. Both live
 * regions are read by screen readers but RENDER with muted styling
 * (`msg msg--muted`) -- so a sighted user has no at-a-glance way to
 * tell whether the most-recent Send succeeded or failed without parsing
 * the full live-region text. On a long upload the operator may glance
 * back at the panel, see "fileUploadFailed: 503 Service Unavailable"
 * in the same muted tone as a successful "Started on K2 Plus: …" and
 * miss the failure entirely.
 *
 * Cycle 375 adds a tiny SIGHTED-ONLY outcome summary line that
 * surfaces a clear ✓ (U+2713 CHECK MARK) / ✗ (U+2717 BALLOT X) glyph
 * plus a brief label after each completed Send. The renderer element
 * carries `aria-hidden="true"` so screen readers do NOT re-announce
 * (they already heard the polite + assertive regions); this is a
 * sighted-equality polish, not a screen-reader feature. The element
 * also carries `data-state="success" | "failure"` so future CSS can
 * tint the line green/red without changing the test surface, AND so
 * tests can assert the state transition without parsing glyphs.
 *
 * Outcome states:
 * - `'success'` -> "Last upload: ✓ Sent successfully"
 * - `'failure'` -> "Last upload: ✗ Failed"
 *
 * The renderer holds the outcome in a `useState<K2SendOutcome | null>`
 * slot. `null` (the initial state) renders no element. The slot is
 * RESET to `null` at the top of `sendToK2Plus` so an in-flight Send
 * temporarily hides the previous attempt's outcome line until the new
 * outcome resolves -- this is intentional UX: while uploading, the
 * progress meter + polite region are the authoritative feedback, and
 * a stale "✓ Sent successfully" from a prior attempt would be
 * misleading mid-stream.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Laguna
 * Swift 5x10 + Makera Carvera have their own Send paths and outcome
 * affordances are separate cycles -- the Carvera path's phase
 * announcer is a parallel pattern but its outcome surface (if any)
 * belongs to a future Carvera cycle.
 *
 * Roadmap: [P2-K2-PUSH]/Cycle 375.
 */
export type K2SendOutcome = 'success' | 'failure'

export function formatK2SendOutcomeLabel(outcome: K2SendOutcome): string {
  if (outcome === 'success') return 'Last upload: ✓ Sent successfully'
  return 'Last upload: ✗ Failed'
}

/**
 * Phase 2 [P2-K2-PUSH]/Cycle 380 -- timestamp suffix for the C375
 * sighted-only last-upload outcome label.
 *
 * The C375 outcome label ("Last upload: ✓ Sent successfully" / "Last
 * upload: ✗ Failed") tells a sighted operator WHETHER the last Send
 * succeeded but not WHEN it resolved. On a multi-machine workday the
 * operator may glance back at the Manufacture panel after a long run
 * away from the desk and see "Last upload: ✓ Sent successfully" with
 * no temporal anchor -- is that from five seconds ago, or from this
 * morning? The line is a SUMMARY (it persists across re-renders, with
 * the only reset being the start of the next Send), so without a
 * timestamp it provides no signal about freshness.
 *
 * Cycle 380 closes that gap with a tiny pure-formatter companion:
 * `formatK2SendOutcomeTimestampSuffix(date)` returns ` (at HH:MM)`
 * for a valid Date input and the empty string for null / undefined /
 * non-Date / NaN-time inputs (defence in depth -- the renderer
 * captures `new Date()` at the moment the outcome resolves so the
 * happy path always passes a valid Date, but a future regression
 * that forgets to capture the timestamp must NOT crash the panel).
 *
 * The renderer concatenates the suffix into the existing JSX:
 *   {formatK2SendOutcomeLabel(k2SendLastOutcome)
 *    + formatK2SendOutcomeTimestampSuffix(k2SendLastOutcomeAt)}
 *
 * Pure separation lets the C375 source-text pin G2 keep enforcing the
 * single-arg `formatK2SendOutcomeLabel(K2SendOutcome): string`
 * signature -- the timestamp is a SECOND helper rather than a second
 * parameter, so a future cycle that wants to localise / reformat the
 * timestamp affects only this companion and the renderer's `useState`
 * slot for the captured Date.
 *
 * Format choice: 24-hour HH:MM with the operator's LOCAL timezone
 * (Date#getHours / Date#getMinutes) and zero-padding via padStart.
 * Local time pairs with the operator's wall clock at the bench; UTC
 * would require an extra mental conversion every glance. The literal
 * " (at HH:MM)" prefix mirrors a casual operator gloss ("the upload
 * went out at 14:23") and the leading space is part of the suffix
 * so the renderer's concatenation reads naturally without an extra
 * space-template at the call site.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 *  - null  -> '' (initial state slot)
 *  - undefined  -> '' (defensive)
 *  - non-Date object  -> '' (defence-in-depth; TS keeps the call
 *    site honest, but a runtime caller could pass a number / string)
 *  - Date with NaN time (`new Date('not-a-date')`)  -> ''
 *  - 09:05 local time  -> ' (at 09:05)' (zero-padded both fields)
 *  - 23:59 local time  -> ' (at 23:59)' (top-of-day boundary)
 *  - 00:00 local time  -> ' (at 00:00)' (start-of-day boundary)
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Same
 * K2-only invariant as the surrounding helpers in this module --
 * Laguna Swift 5x10 + Makera Carvera have their own Send paths; a
 * timestamped outcome line for those machines is a separate cycle.
 *
 * Roadmap: [P2-K2-PUSH]/Cycle 380.
 */
export function formatK2SendOutcomeTimestampSuffix(date: Date | null | undefined): string {
  if (date == null) return ''
  if (!(date instanceof Date)) return ''
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return ` (at ${hh}:${mm})`
}

/**
 * Phase 2 [P2-K2-PUSH]/Cycle 383 -- filename suffix for the C375
 * sighted-only last-upload outcome label.
 *
 * The C375 outcome label tells the operator WHETHER the last Send
 * succeeded; the C380 timestamp suffix tells them WHEN it resolved.
 * Both are useful but answer questions about the LAST upload as a
 * single event. On a busy multi-job day where the operator has sliced
 * several files in a row -- a wrist guard, a drawer-pull, a calibration
 * cube -- the outcome line "Last upload: ✓ Sent successfully (at 14:23)"
 * still requires the operator to remember which slice they pushed last
 * to know whether they need to re-Send the wrist guard or the cube.
 *
 * Cycle 383 closes that gap with a tiny pure-formatter companion:
 * `formatK2SendOutcomeFilenameSuffix(filename)` returns ` — <filename>`
 * (U+2014 EM DASH separator, mirroring the C368 100-bracket announcement
 * "Upload complete — printer beginning the job") for a non-empty string
 * input and the empty string for null / undefined / non-string /
 * whitespace-only inputs (defence in depth -- the renderer captures
 * `r.filename ?? basename(sendCandidatePath)` at success and the bare
 * basename at failure, so the happy path always passes a non-empty
 * string, but a future regression that forgets to capture the filename
 * must NOT crash the panel).
 *
 * The renderer concatenates the suffix into the existing JSX:
 *   {formatK2SendOutcomeLabel(k2SendLastOutcome)
 *    + formatK2SendOutcomeFilenameSuffix(k2SendLastOutcomeFilename)
 *    + formatK2SendOutcomeTimestampSuffix(k2SendLastOutcomeAt)}
 *
 * Pure separation lets the C375 source-text pin G2 keep enforcing the
 * single-arg `formatK2SendOutcomeLabel(K2SendOutcome): string`
 * signature -- the filename is a THIRD helper rather than a second
 * parameter on the existing label or timestamp formatters, so a future
 * cycle that wants to truncate / abbreviate / link the filename affects
 * only this companion and the renderer's `useState` slot for the
 * captured filename.
 *
 * Format choice: ` — <filename>` (em dash with surrounding spaces). The
 * em dash matches the C368 bracket-announcement separator style so the
 * sighted operator reads consistent typographic punctuation across the
 * Send surface. The leading space + em dash + trailing space are part
 * of the suffix so the renderer's concatenation reads naturally without
 * an extra space-template at the call site (parallel of the C380
 * leading-space invariant).
 *
 * Suffix-order in the renderer: label + filename + timestamp. The
 * filename sits BEFORE the timestamp because:
 *   - "Last upload: ✓ Sent successfully — wrist-guard.gcode (at 14:23)"
 *     reads more naturally than
 *   - "Last upload: ✓ Sent successfully (at 14:23) — wrist-guard.gcode"
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
 *    when Moonraker returns an empty string would land here)
 *  - whitespace-only string  -> '' (parallel of the C373 failure
 *    formatter's whitespace-trim behaviour)
 *  - 'cam.gcode'  -> ' — cam.gcode'
 *  - '  cam.gcode  '  -> ' — cam.gcode' (trim leading/trailing whitespace)
 *  - 'multi word slice.gcode'  -> ' — multi word slice.gcode' (interior
 *    whitespace preserved)
 *  - non-string input  -> '' (defence-in-depth; TS narrows the call
 *    site, but a runtime caller could pass a number / object)
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Same
 * K2-only invariant as the surrounding helpers in this module --
 * Laguna Swift 5x10 (manual USB stick transfer, no filename feedback)
 * + Makera Carvera (separate `formatCarveraSendOutcomeLabel` in
 * `carvera-send-progress-phase.ts`; a Carvera filename suffix would be
 * a parallel cycle on that module).
 *
 * Roadmap: [P2-K2-PUSH]/Cycle 383.
 */
export function formatK2SendOutcomeFilenameSuffix(
  filename: string | null | undefined
): string {
  if (filename == null) return ''
  if (typeof filename !== 'string') return ''
  const trimmed = filename.trim()
  if (trimmed.length === 0) return ''
  return ` — ${trimmed}`
}

/**
 * Phase 2 [P2-K2-PUSH]/Cycle 388 -- length-bounded truncation companion
 * for the C383 outcome filename suffix.
 *
 * The C383 suffix surfaces the basename of the last-uploaded slice in
 * the sighted-only outcome line so a sighted operator on a busy
 * multi-job day knows WHICH file the outcome refers to. On Jacob's
 * actual Manufacture-panel column width the outcome line is one
 * line of muted body text -- a long basename like
 * "wrist-guard-shell-finishing-pass-with-supports.gcode" (52 chars)
 * either wraps to a second line (breaking the panel's vertical rhythm)
 * or pushes the C380 timestamp suffix off the visible column entirely
 * (so the operator loses the freshness anchor that C380 added).
 *
 * Cycle 388 closes that gap with a tiny pure-truncation companion:
 * `truncateK2SendOutcomeFilename(filename, maxChars?)` returns a
 * length-bounded version of the input filename, replacing the tail with
 * a U+2026 HORIZONTAL ELLIPSIS character if the trimmed input exceeds
 * `maxChars`. Defaults to `K2_SEND_OUTCOME_FILENAME_MAX_CHARS` (30) --
 * empirically the column width on Jacob's standard Manufacture panel
 * resolution that keeps `label + filename + timestamp` on a single line
 * for typical slice basenames (cube.gcode / drawer-pull.gcode /
 * wrist-guard.gcode) without cropping.
 *
 * Composition: the renderer threads the helper BEFORE the suffix
 * formatter so the suffix's defensive null/undefined chain stays intact:
 *   formatK2SendOutcomeFilenameSuffix(
 *     truncateK2SendOutcomeFilename(k2SendLastOutcomeFilename)
 *   )
 *
 * Returns `string | null`:
 *  - `null` for null / undefined / non-string / whitespace-only input
 *    (so `formatK2SendOutcomeFilenameSuffix(null)` resolves to '' via
 *    its existing defence-in-depth chain -- no double-implementation)
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
 * The C383 separator (` — `) and the C380 timestamp ` (at HH:MM)`
 * format remain pinned at their respective helpers; this cycle only
 * shortens the basename slot.
 *
 * Edge cases pinned by the paired `*.test.ts`:
 *  - null  -> null (defensive; renderer's initial state slot)
 *  - undefined  -> null (defensive)
 *  - empty string  -> null (defence-in-depth; matches suffix's chain)
 *  - whitespace-only string  -> null (parallel of suffix's trim)
 *  - non-string input  -> null (defence-in-depth; TS narrows call site)
 *  - 'cam.gcode'  -> 'cam.gcode' (unchanged; well under 30)
 *  - 30-char input  -> 30-char input unchanged (boundary)
 *  - 31-char input  -> 29-char prefix + '…' (truncated)
 *  - 'wrist-guard-shell-finishing-pass.gcode' (37 chars) ->
 *    'wrist-guard-shell-finishing-p…' (29 chars + ellipsis = 30 chars)
 *  - leading/trailing whitespace stripped before length check
 *  - maxChars=NaN  -> default 30
 *  - maxChars=Infinity  -> default 30
 *  - maxChars=0 / 1  -> default 30 (refuses to truncate to "…"-only)
 *  - maxChars=2  -> 1-char prefix + '…'
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Same
 * K2-only invariant as the surrounding helpers in this module --
 * Laguna Swift 5x10 (manual USB stick transfer, no filename feedback)
 * + Makera Carvera (separate `formatCarveraSendOutcomeLabel`; a
 * Carvera filename truncation would be a parallel cycle on
 * `carvera-send-progress-phase.ts`).
 *
 * Roadmap: [P2-K2-PUSH]/Cycle 388.
 */
export const K2_SEND_OUTCOME_FILENAME_MAX_CHARS = 30 as const

export function truncateK2SendOutcomeFilename(
  filename: string | null | undefined,
  maxChars: number = K2_SEND_OUTCOME_FILENAME_MAX_CHARS
): string | null {
  if (filename == null) return null
  if (typeof filename !== 'string') return null
  const trimmed = filename.trim()
  if (trimmed.length === 0) return null
  const intMax =
    Number.isFinite(maxChars) && maxChars >= 2
      ? Math.floor(maxChars)
      : K2_SEND_OUTCOME_FILENAME_MAX_CHARS
  if (trimmed.length <= intMax) return trimmed
  return trimmed.slice(0, intMax - 1) + '…'
}
