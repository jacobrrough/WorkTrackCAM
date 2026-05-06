/**
 * Render-contract pins for `MoonrakerPreviewBanner`
 * (`src/renderer/src/MoonrakerPreviewBanner.tsx`). Cycle 50 ui-polish
 * [ID-0072-followup].
 *
 * Tests render the component via `react-dom/server.renderToStaticMarkup`
 * to keep them in the existing `node` vitest environment without a
 * jsdom dependency. `renderToStaticMarkup` runs hooks in-tree so the
 * `useMemo` smoke test exercises the real production render path.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MoonrakerPreviewBanner from './MoonrakerPreviewBanner'
import type { GcodeTempSample } from '../../shared/gcode-temp-validator'

function render(samples: readonly GcodeTempSample[] | undefined): string {
  return renderToStaticMarkup(
    createElement(MoonrakerPreviewBanner, { samples })
  )
}

const noz = (targetC: number, lineNumber = 1): GcodeTempSample => ({
  lineNumber,
  command: 'M104',
  kind: 'nozzle',
  targetC,
  raw: `M104 S${targetC}`
})
const bed = (targetC: number, lineNumber = 2): GcodeTempSample => ({
  lineNumber,
  command: 'M140',
  kind: 'bed',
  targetC,
  raw: `M140 S${targetC}`
})
const chamber = (targetC: number, lineNumber = 3): GcodeTempSample => ({
  lineNumber,
  command: 'M141',
  kind: 'chamber',
  targetC,
  raw: `M141 S${targetC}`
})

describe('MoonrakerPreviewBanner -- [ID-0072-followup] render contract', () => {
  it('returns null when samples === undefined', () => {
    expect(render(undefined)).toBe('')
  })

  it('returns null when samples is an empty array', () => {
    expect(render([])).toBe('')
  })

  it('renders nozzle -> bed -> chamber in fixed order even if input order is shuffled', () => {
    // Shuffle: chamber first, then nozzle, then bed.
    const html = render([chamber(50), noz(240), bed(60)])
    const out = html
      .replace(/^.*data-testid="moonraker-preview-banner"[^>]*>/, '')
      .replace(/<\/div>\s*$/, '')
    // Section labels appear in the canonical formatter order.
    const idxNoz = out.indexOf('Nozzle:')
    const idxBed = out.indexOf('Bed:')
    const idxCham = out.indexOf('Chamber:')
    expect(idxNoz).toBeGreaterThanOrEqual(0)
    expect(idxBed).toBeGreaterThan(idxNoz)
    expect(idxCham).toBeGreaterThan(idxBed)
  })

  it('renders integer temps without a decimal and fractional temps with exactly one decimal', () => {
    const html = render([noz(240), bed(60.5)])
    expect(html).toContain('Nozzle: 240 C')
    expect(html).toContain('Bed: 60.5 C')
    // No accidental trailing decimal on the integer.
    expect(html).not.toContain('Nozzle: 240.0 C')
    // No accidental two-decimal precision on the fractional.
    expect(html).not.toContain('Bed: 60.50 C')
  })

  it('uses U+00B7 MIDDLE DOT as the bullet separator (NOT U+2022)', () => {
    const html = render([noz(240), bed(60), chamber(50)])
    // U+00B7 = `\u00b7` (2-byte UTF-8 c2 b7).
    expect(html).toContain(' \u00b7 ')
    // U+2022 (3-byte UTF-8 e2 80 a2) MUST NOT appear -- the
    // edit-workflow R1.5 hazard guard.
    expect(html).not.toContain('\u2022')
  })

  it('does not throw on samples whose targetC is non-finite', () => {
    const dirty: GcodeTempSample[] = [
      { ...noz(240) },
      { ...bed(Number.NaN) },
      { ...chamber(Number.POSITIVE_INFINITY) }
    ]
    // Should render the nozzle line and silently drop NaN/Infinity.
    let html = ''
    expect(() => { html = render(dirty) }).not.toThrow()
    expect(html).toContain('Nozzle: 240 C')
    expect(html).not.toContain('Bed:')
    expect(html).not.toContain('Chamber:')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('Infinity')
  })

  it('snapshot pin: realistic K2 PrusaSlicer 3-sample preview (240 / 65 / 50.5)', () => {
    const html = render([noz(240, 12), bed(65, 27), chamber(50.5, 41)])
    expect(html).toMatchInlineSnapshot(
      `"<div role="status" aria-label="Pre-upload temperature preview" data-testid="moonraker-preview-banner" class="mt-2 mb-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-mono text-amber-900 select-text">Nozzle: 240 C \u00b7 Bed: 65 C \u00b7 Chamber: 50.5 C</div>"`
    )
  })

  it('memoization smoke test: rendering the same samples reference twice yields byte-identical output', () => {
    const samples: readonly GcodeTempSample[] = Object.freeze([
      noz(240),
      bed(60),
      chamber(50)
    ])
    const a = render(samples)
    const b = render(samples)
    expect(a).toBe(b)
    // And the formatter result is non-trivial (so the equality
    // assertion is not vacuously true on `''`).
    expect(a.length).toBeGreaterThan(0)
  })

  it('takes the per-kind MAX target when multiple samples of the same kind are present', () => {
    // Tool-change preheat: two nozzle setpoints; max should win.
    const html = render([noz(200, 1), noz(255, 2), bed(60, 3)])
    expect(html).toContain('Nozzle: 255 C')
    expect(html).not.toContain('Nozzle: 200 C')
    expect(html).toContain('Bed: 60 C')
  })

  it('renders no console errors / warnings on a typical good payload (regression guard)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render([noz(240), bed(60)])
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
