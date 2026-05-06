import { describe, expect, it } from 'vitest'

import type { GcodeTempSample } from './gcode-temp-validator'
import {
  FDM_TEMP_PREVIEW_KIND_ORDER,
  FDM_TEMP_PREVIEW_LABELS,
  formatFdmTempPreview,
  renderFdmTempPreview,
  summarizeFdmTempSamples,
  type FdmTempPreviewSummary
} from './fdm-temp-preview'

/**
 * Tests for the [ID-0072] pre-flight FDM temperature preview formatter
 * (Cycle 27 / ui-polish). Pin the rendered format so future refactors
 * to `src/shared/gcode-temp-validator.ts` can't silently change the
 * operator-visible banner text.
 */

const mkSample = (overrides: Partial<GcodeTempSample> = {}): GcodeTempSample => ({
  lineNumber: 1,
  command: 'M104',
  kind: 'nozzle',
  targetC: 210,
  raw: 'M104 S210',
  ...overrides
})

describe('[ID-0072] summarizeFdmTempSamples — per-kind peak extraction', () => {
  it('returns null for an empty array', () => {
    expect(summarizeFdmTempSamples([])).toBeNull()
  })

  it('returns null for null input', () => {
    expect(summarizeFdmTempSamples(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(summarizeFdmTempSamples(undefined)).toBeNull()
  })

  it('returns null for non-array input (defensive)', () => {
    // Cast-guarded entry so downstream callers with loose types cannot
    // poison the summary. Safety Rule 3 compliance (no `any`).
    expect(summarizeFdmTempSamples('not an array' as unknown as GcodeTempSample[])).toBeNull()
  })

  it('picks the single target when only one sample is present per kind', () => {
    const out = summarizeFdmTempSamples([mkSample({ kind: 'nozzle', targetC: 215 })])
    expect(out).toEqual({ nozzle: 215 })
  })

  it('picks the MAX per kind across multiple samples (peak = what the operator needs)', () => {
    const out = summarizeFdmTempSamples([
      mkSample({ kind: 'nozzle', targetC: 210, command: 'M104' }),
      mkSample({ kind: 'nozzle', targetC: 240, command: 'M109' }),
      mkSample({ kind: 'nozzle', targetC: 225, command: 'M104' })
    ])
    expect(out).toEqual({ nozzle: 240 })
  })

  it('routes nozzle / bed / chamber samples to their own slots', () => {
    const out = summarizeFdmTempSamples([
      mkSample({ kind: 'nozzle', targetC: 240, command: 'M109' }),
      mkSample({ kind: 'bed', targetC: 60, command: 'M190' }),
      mkSample({ kind: 'chamber', targetC: 50, command: 'M141' })
    ])
    expect(out).toEqual({ nozzle: 240, bed: 60, chamber: 50 })
  })

  it('omits absent kinds from the summary (no zero-fill)', () => {
    const out = summarizeFdmTempSamples([mkSample({ kind: 'nozzle', targetC: 200 })])
    expect(out).toEqual({ nozzle: 200 })
    expect('bed' in (out ?? {})).toBe(false)
    expect('chamber' in (out ?? {})).toBe(false)
  })

  it('ignores samples with non-finite targetC', () => {
    const out = summarizeFdmTempSamples([
      mkSample({ kind: 'nozzle', targetC: Number.NaN }),
      mkSample({ kind: 'nozzle', targetC: Number.POSITIVE_INFINITY }),
      mkSample({ kind: 'nozzle', targetC: 200 })
    ])
    expect(out).toEqual({ nozzle: 200 })
  })

  it('returns null when every sample has a non-finite targetC', () => {
    const out = summarizeFdmTempSamples([
      mkSample({ kind: 'nozzle', targetC: Number.NaN }),
      mkSample({ kind: 'bed', targetC: Number.POSITIVE_INFINITY })
    ])
    expect(out).toBeNull()
  })

  it('skips samples with an unknown kind (defensive against future widening)', () => {
    const out = summarizeFdmTempSamples([
      // Synthetic sample with an off-list kind; type-cast constrained so
      // the test exercises the runtime guard without a bare `any`.
      mkSample({ kind: 'mystery' as unknown as GcodeTempSample['kind'], targetC: 999 }),
      mkSample({ kind: 'nozzle', targetC: 210 })
    ])
    expect(out).toEqual({ nozzle: 210 })
  })

  it('collapses multi-tool nozzle samples to a single max (per-tool is out of scope)', () => {
    const out = summarizeFdmTempSamples([
      mkSample({ kind: 'nozzle', targetC: 205, tool: 0 }),
      mkSample({ kind: 'nozzle', targetC: 250, tool: 1 }),
      mkSample({ kind: 'nozzle', targetC: 215, tool: 0 })
    ])
    expect(out).toEqual({ nozzle: 250 })
  })
})

describe('[ID-0072] renderFdmTempPreview — rendered string format', () => {
  it('returns null for null summary', () => {
    expect(renderFdmTempPreview(null)).toBeNull()
  })

  it('returns null for an empty summary object', () => {
    expect(renderFdmTempPreview({})).toBeNull()
  })

  it('renders nozzle-only as a single segment', () => {
    expect(renderFdmTempPreview({ nozzle: 240 })).toBe('Nozzle: 240 C')
  })

  it('renders bed-only as a single segment', () => {
    expect(renderFdmTempPreview({ bed: 60 })).toBe('Bed: 60 C')
  })

  it('renders chamber-only as a single segment', () => {
    expect(renderFdmTempPreview({ chamber: 50 })).toBe('Chamber: 50 C')
  })

  it('renders all three kinds in nozzle -> bed -> chamber order', () => {
    expect(renderFdmTempPreview({ nozzle: 240, bed: 60, chamber: 50 })).toBe(
      'Nozzle: 240 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C'
    )
  })

  it('orders sections deterministically regardless of insertion order', () => {
    // Build a summary with chamber first, then bed, then nozzle.
    const s: FdmTempPreviewSummary = {}
    s.chamber = 50
    s.bed = 60
    s.nozzle = 240
    expect(renderFdmTempPreview(s)).toBe(
      'Nozzle: 240 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C'
    )
  })

  it('skips missing kinds (nozzle + chamber only, no bed)', () => {
    expect(renderFdmTempPreview({ nozzle: 240, chamber: 50 })).toBe(
      'Nozzle: 240 C \u00b7 Chamber: 50 C'
    )
  })

  it('skips a kind whose value is non-finite (defensive)', () => {
    expect(
      renderFdmTempPreview({ nozzle: 240, bed: Number.NaN, chamber: 50 })
    ).toBe('Nozzle: 240 C \u00b7 Chamber: 50 C')
  })

  it('renders integer temps without a decimal point', () => {
    expect(renderFdmTempPreview({ nozzle: 210 })).toBe('Nozzle: 210 C')
  })

  it('renders fractional temps with exactly one decimal place', () => {
    expect(renderFdmTempPreview({ nozzle: 215.5 })).toBe('Nozzle: 215.5 C')
  })

  it('renders zero as an integer (edge case: bed off)', () => {
    expect(renderFdmTempPreview({ bed: 0 })).toBe('Bed: 0 C')
  })
})

describe('[ID-0072] formatFdmTempPreview — one-shot convenience', () => {
  it('returns null for empty input (no banner should render)', () => {
    expect(formatFdmTempPreview([])).toBeNull()
    expect(formatFdmTempPreview(null)).toBeNull()
    expect(formatFdmTempPreview(undefined)).toBeNull()
  })

  it('matches the realistic K2 PrusaSlicer/Orca header shape', () => {
    const samples: GcodeTempSample[] = [
      mkSample({ kind: 'bed', targetC: 60, command: 'M190', raw: 'M190 S60' }),
      mkSample({ kind: 'chamber', targetC: 50, command: 'M141', raw: 'M141 S50' }),
      mkSample({ kind: 'nozzle', targetC: 215, command: 'M104', raw: 'M104 S215' }),
      mkSample({ kind: 'nozzle', targetC: 240, command: 'M109', raw: 'M109 S240' }),
      mkSample({ kind: 'chamber', targetC: 50, command: 'M191', raw: 'M191 S50' })
    ]
    // Nozzle peak is 240 (M109), bed 60, chamber 50. Order is fixed.
    expect(formatFdmTempPreview(samples)).toBe(
      'Nozzle: 240 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C'
    )
  })

  it('pins the bullet separator to U+00B7 MIDDLE DOT (2-byte UTF-8)', () => {
    const out = formatFdmTempPreview([
      mkSample({ kind: 'nozzle', targetC: 210 }),
      mkSample({ kind: 'bed', targetC: 60 })
    ])
    expect(out).toContain('\u00b7')
    // Bytes-check — guards against an Edit-tool swap to the visually
    // similar U+2022 BULLET (3-byte UTF-8, per `docs/EDIT-WORKFLOW.md` R1.5).
    const middle = out?.match(/ (\u00b7) /)
    expect(middle?.[1]).toBe('\u00b7')
  })
})

describe('[ID-0072] public constants — order + labels drift guard', () => {
  it('orders kinds nozzle -> bed -> chamber', () => {
    expect(FDM_TEMP_PREVIEW_KIND_ORDER).toEqual(['nozzle', 'bed', 'chamber'])
  })

  it('labels every kind with a capitalized word', () => {
    expect(FDM_TEMP_PREVIEW_LABELS.nozzle).toBe('Nozzle')
    expect(FDM_TEMP_PREVIEW_LABELS.bed).toBe('Bed')
    expect(FDM_TEMP_PREVIEW_LABELS.chamber).toBe('Chamber')
  })
})
