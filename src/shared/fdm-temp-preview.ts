/**
 * Pre-flight FDM temperature preview formatter.
 *
 * [ID-0072] (Cycle 27 / ui-polish): surfaces the `GcodeTempSample[]`
 * output of the Cycle 8 -> 18 -> 24 K2 Plus safety pipeline
 * (`src/shared/gcode-temp-validator.ts::parseGcodeTempCommands`) as a
 * concise operator-facing preview string suitable for a toast banner
 * or a pre-upload confirm dialog.
 *
 * Example output:
 *   "Nozzle: 240 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C"
 *
 * Rules:
 *   - `samples` is grouped by `kind` (nozzle / bed / chamber) and the
 *     MAX target per kind is rendered -- this is what the job will
 *     peak at, which is the number the operator needs to see.
 *   - Section order is ALWAYS nozzle -> bed -> chamber regardless of
 *     source order so the preview is deterministic across slicer
 *     variants. Absent kinds are omitted entirely (no empty "Bed: "
 *     labels).
 *   - Multi-tool nozzle samples collapse to a single `Nozzle:` line
 *     because this helper is a banner, not a per-tool table.
 *   - Returns `null` when there is nothing to show (empty / non-array
 *     / every sample has a non-finite `targetC`).
 *   - Temperature values render as integers when the target is a whole
 *     number (the slicer norm) and with one decimal place otherwise.
 *     Units suffix is `C` (no degree sign to avoid the edit-workflow
 *     multi-byte UTF-8 separator hazard documented in
 *     `docs/EDIT-WORKFLOW.md` R1.5).
 *
 * Safety Rule 2: pure function, no I/O, no global state. Additive /
 * optional -- callers that never invoke it see byte-identical behavior.
 */

import type { GcodeTempSample } from './gcode-temp-validator'

/** The ordered list of kinds in a preview line. */
export const FDM_TEMP_PREVIEW_KIND_ORDER: readonly ('nozzle' | 'bed' | 'chamber')[] = [
  'nozzle',
  'bed',
  'chamber'
]

/** The label for each kind, used in the rendered preview string. */
export const FDM_TEMP_PREVIEW_LABELS: Readonly<Record<'nozzle' | 'bed' | 'chamber', string>> = {
  nozzle: 'Nozzle',
  bed: 'Bed',
  chamber: 'Chamber'
}

/** Per-kind summary extracted from a `GcodeTempSample[]`. */
export type FdmTempPreviewSummary = {
  nozzle?: number
  bed?: number
  chamber?: number
}

/**
 * Reduce a `GcodeTempSample[]` to the peak target per kind. Samples
 * with a non-finite `targetC` are ignored so malformed inputs do not
 * poison the summary. Returns `null` when no valid per-kind target is
 * present.
 */
export function summarizeFdmTempSamples(
  samples: readonly GcodeTempSample[] | null | undefined
): FdmTempPreviewSummary | null {
  if (!Array.isArray(samples) || samples.length === 0) return null
  const out: FdmTempPreviewSummary = {}
  for (const s of samples) {
    if (!s || typeof s.targetC !== 'number' || !Number.isFinite(s.targetC)) continue
    let kind: 'nozzle' | 'bed' | 'chamber' | null = null
    if (s.kind === 'nozzle') kind = 'nozzle'
    else if (s.kind === 'bed') kind = 'bed'
    else if (s.kind === 'chamber') kind = 'chamber'
    if (kind === null) continue
    const prev = out[kind]
    if (prev === undefined || s.targetC > prev) {
      out[kind] = s.targetC
    }
  }
  if (out.nozzle === undefined && out.bed === undefined && out.chamber === undefined) return null
  return out
}

/**
 * Format a single temperature value. Integers stay integers; all other
 * finite numbers are rendered with exactly one decimal place.
 */
function formatTempC(value: number): string {
  if (Number.isInteger(value)) return `${value} C`
  return `${value.toFixed(1)} C`
}

/**
 * Render an `FdmTempPreviewSummary` as the single-line operator
 * preview. Section order is fixed to `FDM_TEMP_PREVIEW_KIND_ORDER` so
 * callers can rely on the output being deterministic.
 */
export function renderFdmTempPreview(summary: FdmTempPreviewSummary | null): string | null {
  if (summary == null) return null
  const parts: string[] = []
  for (const kind of FDM_TEMP_PREVIEW_KIND_ORDER) {
    const v = summary[kind]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    parts.push(`${FDM_TEMP_PREVIEW_LABELS[kind]}: ${formatTempC(v)}`)
  }
  if (parts.length === 0) return null
  // Bullet separator: ASCII-space + U+00B7 MIDDLE DOT + ASCII-space.
  // 2-byte UTF-8 `c2 b7` -- avoids the U+2022 BULLET 3-byte hazard.
  return parts.join(' \u00b7 ')
}

/**
 * Convenience one-shot: turn a `GcodeTempSample[]` straight into the
 * rendered preview string (or `null` when there is nothing to show).
 */
export function formatFdmTempPreview(
  samples: readonly GcodeTempSample[] | null | undefined
): string | null {
  return renderFdmTempPreview(summarizeFdmTempSamples(samples))
}
