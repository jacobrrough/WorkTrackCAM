/**
 * MoonrakerPreviewBanner -- pre-flight K2 Plus temperature preview banner.
 *
 * Surfaces the operator-facing preview string produced by
 * `formatFdmTempPreview` (`src/shared/fdm-temp-preview.ts`, [ID-0072]
 * landed in Cycle 27) as a compact single-line banner that the K2 fab
 * drawer renders ABOVE the Moonraker "Send" button. The Cycle 27 work
 * shipped only the pure formatter; this component is the renderer-side
 * wiring committed by Cycle 50 ui-polish [ID-0072-followup].
 *
 * Render contract (pinned by `MoonrakerPreviewBanner.test.tsx`):
 *   1. `samples === undefined` -> renders nothing (returns `null`).
 *   2. `samples === []`        -> renders nothing (returns `null`).
 *   3. Section order in the rendered string is ALWAYS
 *      nozzle -> bed -> chamber regardless of `samples` order.
 *   4. Integer temps render without a decimal; fractional temps render
 *      with exactly one decimal place.
 *   5. The bullet separator is `U+00B7 MIDDLE DOT` (2-byte UTF-8
 *      `c2 b7`) -- guards against accidental re-introduction of the
 *      `U+2022 BULLET` 3-byte hazard documented in
 *      `docs/EDIT-WORKFLOW.md` R1.5.
 *   6. Non-finite `targetC` values are silently filtered (delegates to
 *      the formatter contract; the banner itself never throws).
 *   7. Re-rendering with the same `samples` reference reuses the
 *      `useMemo`-cached formatted string -- pure smoke test, no
 *      side-effects in the render path.
 *
 * Safety Rule 2: pure presentational component, no I/O. No imports
 * from `electron`. Telemetry / Moonraker preview log events are
 * forwarded by the parent (`ShopApp.tsx`) through the
 * `moonrakerPreview` preload bridge -- this banner is render-only.
 */

import { useMemo, type JSX } from 'react'
import type { GcodeTempSample } from '../../shared/gcode-temp-validator'
import { formatFdmTempPreview } from '../../shared/fdm-temp-preview'

export type MoonrakerPreviewBannerProps = {
  /**
   * Parsed `GcodeTempSample[]` from
   * `MoonrakerPushResult.tempValidation.samples`. Renders nothing when
   * undefined / empty / fully invalid. Treated as immutable -- the
   * banner never mutates.
   */
  readonly samples: readonly GcodeTempSample[] | undefined
}

/**
 * Tailwind class string for the banner shell. Tuned to sit above the
 * Send button without disrupting the existing K2 drawer chrome:
 *   - mt-2 / mb-1 -- single-line gap above the button row.
 *   - rounded border w/ subtle background, monospace font for temps.
 *   - `data-testid` for renderer integration tests in ShopApp.tsx.
 */
const BANNER_CLASS =
  'mt-2 mb-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 ' +
  'text-xs font-mono text-amber-900 select-text'

export default function MoonrakerPreviewBanner(
  props: MoonrakerPreviewBannerProps
): JSX.Element | null {
  const { samples } = props
  // useMemo MUST be called unconditionally before any conditional
  // return to keep the hook call order stable across renders. The
  // formatter is cheap, but memoising over the `samples` reference
  // also gives us referential stability for downstream `React.memo`
  // wrappers should the banner ever be hoisted.
  const formatted = useMemo<string | null>(
    () => formatFdmTempPreview(samples),
    [samples]
  )

  if (formatted === null) return null

  return (
    <div
      role="status"
      aria-label="Pre-upload temperature preview"
      data-testid="moonraker-preview-banner"
      className={BANNER_CLASS}
    >
      {formatted}
    </div>
  )
}
