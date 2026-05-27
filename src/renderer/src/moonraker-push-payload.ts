/**
 * Moonraker push payload builder and failure-message formatter.
 *
 * Extracted from `ShopApp.tsx` as part of [ID-0080] so the renderer
 * call-site stays trivial and the payload contract (including the
 * `machineId` hook added by [ID-0078]) is covered by unit tests.
 *
 * Why this helper exists
 * ----------------------
 * Cycles 8–14 built a K2 Plus safety pipeline end-to-end:
 *   - [ID-0012] FDM capability fields on the machine profile
 *   - [ID-0068] CuraEngine `-s` bridge for the three temp ceilings
 *   - [ID-0070] pure `validateGcodeFileTemps` validator
 *   - [ID-0071] chamber / Klipper-macro coverage
 *   - [ID-0073] `moonrakerPush` pre-upload guard (zero bytes on the
 *     wire when the validator rejects)
 *   - [ID-0075] bounded 128 KiB header read for the validator
 *   - [ID-0078] IPC-layer resolver that turns `machineId` into the
 *     three temperature ceilings via `getMachineById` + an extractor
 *
 * Gap closed by [ID-0080]: the renderer's `fab().moonrakerPush(...)`
 * call at `ShopApp.tsx:1179` never threaded `machineId` into the
 * payload, so the IPC resolver's `machineId` branch was unreachable
 * in production and the pre-upload temperature guard was effectively
 * disarmed for every real K2 job. The preload / renderer IPC type
 * signatures did not even declare `machineId`, so a caller could not
 * opt in without a typecheck error.
 *
 * This helper + the preload/shop-types type extensions land the
 * missing wire: callers pass the `ShopJob` and get a payload that
 * opts into `machineId`-based capability resolution when available.
 */

import type { GcodeTempSample } from '../../shared/gcode-temp-validator'
import type { GcodeHeaderHealth } from '../../shared/gcode-header-health'
import { formatFdmTempPreview } from '../../shared/fdm-temp-preview'

/**
 * Outgoing payload shape for the `moonraker:push` IPC handler.
 *
 * Mirrors the subset of `MoonrakerPushIpcPayload` in
 * `src/main/ipc-fabrication.ts` that the renderer is allowed to send.
 * `machineCapabilities` is intentionally omitted here — the renderer
 * should rely on `machineId`-based resolution so the active machine
 * profile is always the single source of truth for capability values.
 */
export type MoonrakerPushPayload = {
  gcodePath: string
  printerUrl: string
  uploadPath?: string
  startAfterUpload?: boolean
  timeoutMs?: number
  machineId?: string
}

/**
 * Result shape returned by the `moonraker:push` IPC handler to the
 * renderer. Matches the renderer-visible subset of
 * `MoonrakerPushResult` from `src/main/moonraker-push.ts`.
 *
 * `detail` carries the `summarizeTempViolations(...)` output when the
 * pre-upload validator rejects the file (see [ID-0073]). The renderer
 * uses `formatMoonrakerPushFailure` below to surface it in a toast.
 */
export type MoonrakerPushResult = {
  ok: boolean
  filename?: string
  error?: string
  detail?: string
  /**
   * Present when the main-process pre-upload temperature validator
   * (see [ID-0070]/[ID-0073]) produced a sample set — either because a
   * violation blocked the upload, or because a future preview-only
   * handler populated it for the success path. [ID-0072] (Cycle 27)
   * surfaces `samples[]` to the renderer so the operator can see the
   * job's peak heat targets alongside the failure toast.
   *
   * The full `GcodeTempValidationResult` shape would force the
   * renderer to import the whole validator; this narrow subset is all
   * that `formatMoonrakerPushFailure` needs today. A future cycle can
   * widen this to carry `violations` if the banner grows a diff view.
   */
  tempValidation?: {
    samples?: readonly GcodeTempSample[]
  }
  /**
   * Quick-win bundle (undo/redo + K2 thumbnail + Klipper header):
   * non-fatal advisory warnings produced by the K2 thumbnail / Klipper
   * header parser. When present on the success path the renderer can
   * surface a soft "info" toast so the operator knows the upload went
   * through but Mainsail/Fluidd will show less metadata in the picker.
   * The upload is NEVER blocked on these warnings.
   */
  warnings?: string[]
  /**
   * Quick-win bundle: structured `GcodeHeaderHealth` snapshot so the
   * renderer can render a badge before Send (estimated time, filament
   * use, layer count, thumbnail metadata).
   */
  headerHealth?: GcodeHeaderHealth
}

/**
 * Minimal `ShopJob`-shaped contract for payload construction. Accepts
 * the fields `sendToPrinter` has already gated on (`gcodeOut` non-null,
 * `printerUrl` non-empty) plus the optional `machineId` that the
 * caller may leave `null` on a brand-new job.
 */
export type ShopJobForPush = {
  gcodeOut: string
  printerUrl: string
  machineId?: string | null
}

/**
 * Optional knobs that the caller can pass alongside the job. All
 * fields are optional; `startAfterUpload` defaults to `true` because
 * the existing production call-site sets it explicitly to `true`
 * (Safety Rule 2: preserve the pre-[ID-0080] default so this extract
 * does not silently change network behavior).
 */
export type MoonrakerPushOptions = {
  startAfterUpload?: boolean
  uploadPath?: string
  timeoutMs?: number
}

/**
 * Build the outgoing `moonraker:push` IPC payload from an active job.
 *
 * Rules:
 *   - `machineId` is included iff `job.machineId` is a non-empty
 *     string. `null`, `undefined`, and `''` are all dropped so the
 *     IPC resolver sees "absent" and falls through to its
 *     no-capability pass-through branch (Safety Rule 2: byte-identical
 *     to pre-[ID-0078] when no machine is linked to the job).
 *   - `startAfterUpload` defaults to `true` — matches the existing
 *     production call-site. Any explicit value (including `false`) is
 *     honored verbatim.
 *   - `uploadPath` is included iff the caller supplies a string. Any
 *     other type (including `null`) is treated as "not set".
 *   - `timeoutMs` is included iff the caller supplies a finite
 *     positive number. Non-finite values (NaN, ±Infinity) and
 *     non-positive values are dropped so the IPC handler uses its
 *     default timeout.
 */
export function buildMoonrakerPushPayload(
  job: ShopJobForPush,
  opts?: MoonrakerPushOptions
): MoonrakerPushPayload {
  const out: MoonrakerPushPayload = {
    gcodePath: job.gcodeOut,
    printerUrl: job.printerUrl,
    startAfterUpload: opts?.startAfterUpload ?? true
  }
  if (typeof job.machineId === 'string' && job.machineId.length > 0) {
    out.machineId = job.machineId
  }
  if (typeof opts?.uploadPath === 'string' && opts.uploadPath.length > 0) {
    out.uploadPath = opts.uploadPath
  }
  if (
    typeof opts?.timeoutMs === 'number' &&
    Number.isFinite(opts.timeoutMs) &&
    opts.timeoutMs > 0
  ) {
    out.timeoutMs = opts.timeoutMs
  }
  return out
}

/**
 * Format a failed `moonraker:push` result into a single-line operator
 * message for a toast.
 *
 * Preference order:
 *   1. `error` + `detail` together — `"{error}: {detail}"`. Used when
 *      both are present (typical rejection path: `error =
 *      "Upload blocked -- G-code exceeds machine temperature ceiling."`
 *      and `detail = "M109 targets 400 C but exceeds the nozzle
 *      ceiling of 350 C declared by the machine profile. (+2 more)"`).
 *   2. `detail` alone when `error` is empty/missing.
 *   3. `error` alone when `detail` is empty/missing.
 *   4. `"Send failed"` fallback when both are missing.
 *
 * Empty strings are treated as "missing" so a zero-length value in
 * either slot does not produce `": detail"` or `"error: "` output.
 */
export function formatMoonrakerPushFailure(result: MoonrakerPushResult): string {
  const error = typeof result.error === 'string' && result.error.length > 0 ? result.error : null
  const detail = typeof result.detail === 'string' && result.detail.length > 0 ? result.detail : null
  // [ID-0072] Append an operator-facing "will heat" preview derived from
  // the validator's `samples[]`. `formatFdmTempPreview` returns null when
  // there is nothing to show (absent tempValidation / empty samples), so
  // callers that never thread samples through see byte-identical output
  // vs pre-[ID-0072] (Safety Rule 2 pin in the test suite).
  const preview = formatFdmTempPreview(result.tempValidation?.samples)
  const base =
    error !== null && detail !== null
      ? `${error}: ${detail}`
      : detail !== null
        ? detail
        : error !== null
          ? error
          : 'Send failed'
  return preview !== null ? `${base} — will heat: ${preview}` : base
}

/**
 * [ID-0088] Split a failed `moonraker:push` result into a short toast
 * title and a long-form detail line, so the renderer can render the two
 * on separate lines (with a "Copy" affordance for the detail) instead
 * of cramming both into one ~150-char string.
 *
 * Why split, when we already have `formatMoonrakerPushFailure`?
 * Cycles 14 and 16 introduced longer real-world rejection messages of
 * the shape `"{error}: {summary}. (+N more)"` with an optional
 * " -- will heat: ..." suffix from [ID-0072]. The single-line output
 * exceeded the toast's `max-width: 360px` bubble and the inline
 * `formatErrorForToast` truncation at 200 chars routinely chopped the
 * validator's `(+N more)` tail mid-word. Splitting lets the toast
 * render the actionable title prominently and the violation summary on
 * a wrap-friendly second row, with the full text still recoverable via
 * the Copy button. Safety Rule 2: no operator-visible information loss
 * vs the legacy single-line render.
 *
 * Contract:
 *   - `title` is the short, operator-facing label that fits in the
 *     toast's first line. Always a non-empty string. Falls back to
 *     `result.detail` (when only `detail` is present) and finally to
 *     the literal `'Send failed'` so the caller never has to
 *     substitute.
 *   - `detail` is the long-form body or `null` if there is nothing
 *     more to say. When non-null it is a single line that combines
 *     `result.detail` (only when `result.error` is also present, since
 *     otherwise `detail` is hoisted into the title slot) and the
 *     [ID-0072] "will heat: ..." temperature preview, joined with
 *     `' -- '` so the two remain visually distinct.
 *
 * The two outputs together must reconstruct the same surface area
 * `formatMoonrakerPushFailure` produces today: callers concatenate
 * with `': '` for byte-identical legacy text. This is asserted in the
 * test suite so the legacy single-line rendering remains a one-line
 * fallback for any caller that has not yet adopted the multi-line
 * toast variant.
 */
export type MoonrakerPushFailureToastParts = {
  title: string
  detail: string | null
}

export function splitMoonrakerPushFailureForToast(
  result: MoonrakerPushResult
): MoonrakerPushFailureToastParts {
  const error = typeof result.error === 'string' && result.error.length > 0 ? result.error : null
  const detail = typeof result.detail === 'string' && result.detail.length > 0 ? result.detail : null
  const preview = formatFdmTempPreview(result.tempValidation?.samples)

  // Title preference order:
  //   1. `error` (short, actionable, fits the first line).
  //   2. `detail` (when error is missing -- the substantive message
  //      should still be the most prominent thing, not "Send failed").
  //   3. Literal `'Send failed'` (only when both `error` and `detail`
  //      are missing, e.g. preview-only or completely empty result).
  const title = error !== null ? error : detail !== null ? detail : 'Send failed'

  // Detail body: the long-form half. Only includes `result.detail`
  // when it has NOT been hoisted into the title slot (i.e. when both
  // `error` and `detail` are present). Always includes the temp
  // preview when one was generated.
  const parts: string[] = []
  if (error !== null && detail !== null) parts.push(detail)
  if (preview !== null) parts.push(`will heat: ${preview}`)
  const detailOut = parts.length > 0 ? parts.join(' -- ') : null

  return { title, detail: detailOut }
}

/**
 * [ID-0088] Build the clipboard payload that the toast's Copy button
 * writes when the operator clicks it. Combines title + detail into the
 * same single-line shape `formatMoonrakerPushFailure` produces, so what
 * lands in the clipboard is a self-contained one-line string that an
 * operator can paste into a bug report or chat without losing context.
 *
 * Exposed as a pure helper (rather than inlined in the React onClick)
 * so it can be unit-tested without a DOM.
 */
export function buildMoonrakerPushFailureClipboardText(
  parts: MoonrakerPushFailureToastParts
): string {
  if (parts.detail === null || parts.detail.length === 0) return parts.title
  return `${parts.title}: ${parts.detail}`
}
