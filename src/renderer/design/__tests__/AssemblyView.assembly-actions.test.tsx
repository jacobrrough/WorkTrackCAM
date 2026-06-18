/**
 * AssemblyView — SAVED-assembly IPC actions (this cycle's wiring).
 *
 * Proves the four new toolbar controls + their pure bridge helpers that reach
 * the previously-stranded `assembly:interferenceCheck` / `assembly:exportBom` /
 * `assembly:simulate` / `assembly:summary` main-process handlers:
 *
 *   (A) RENDER PINS — the Check Interference / Export BOM / Motion Study /
 *       Summary buttons render with stable testids in the populated toolbar.
 *       The three SAVED-assembly actions disable (no project dir / no provider
 *       in a static render) with an honest title hint; Motion Study disables
 *       only on an empty assembly.
 *   (B) BRIDGE INVOCATION — the exported pure helpers (`runAssemblyInterference
 *       Check`, `runAssemblyBomExport`) call the bridge with the project dir and
 *       fold the result; `formatInterferenceResultSummary` phrases the count.
 *       The project's node-env vitest renders statically and cannot fire click
 *       handlers, so the invocation contract is pinned on the pure helpers the
 *       onClick delegates to (same seam posture as `assembly-render-seam`).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AssemblyView,
  formatInterferenceResultSummary,
  runAssemblyBomExport,
  runAssemblyInterferenceCheck,
  type AssemblyActionBridge,
  type AssemblyPart,
} from '../AssemblyView'
import type { AssemblyInterferenceReport } from '../../../shared/assembly-schema'

// ── window.fab shim (matches AssemblyView.test.tsx) ─────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const samplePart = (overrides: Partial<AssemblyPart> = {}): AssemblyPart => ({
  id: 'p1',
  name: 'Bracket',
  handle: 'script:abcdef',
  ...overrides,
})

const parts: readonly AssemblyPart[] = [
  samplePart({ id: 'p1', name: 'Bracket' }),
  samplePart({ id: 'p2', name: 'Plate', transform: { position: [25, 0, 0] } }),
]

const clearReport = (overrides: Partial<AssemblyInterferenceReport> = {}): AssemblyInterferenceReport => ({
  ok: true,
  message: 'stub',
  conflictingPairs: [],
  ...overrides,
})

// ── (A) Render pins ─────────────────────────────────────────────────────────

describe('AssemblyView — SAVED-assembly action toolbar (render)', () => {
  it('renders all four new action buttons with stable testids', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-check-interference"')
    expect(html).toContain('data-testid="design-assembly-export-bom"')
    expect(html).toContain('data-testid="design-assembly-motion-study"')
    expect(html).toContain('data-testid="design-assembly-summary-action"')
    // Default labels.
    expect(html).toContain('Check Interference')
    expect(html).toContain('Export BOM')
    expect(html).toContain('Motion Study')
  })

  it('disables the project-dir actions when no project dir / provider is available', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toMatch(/data-testid="design-assembly-check-interference"[^>]*disabled/)
    expect(html).toMatch(/data-testid="design-assembly-export-bom"[^>]*disabled/)
    expect(html).toMatch(/data-testid="design-assembly-summary-action"[^>]*disabled/)
  })

  it('enables the project-dir actions when an explicit projectDir prop is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, projectDir: 'C:/proj' }),
    )
    // The Check Interference button tag must NOT carry a bare `disabled`
    // (aria-disabled="false" is acceptable and stripped before the check).
    const match = html.match(/data-testid="design-assembly-check-interference"[^>]*>/)
    expect(match).not.toBeNull()
    const tag = (match?.[0] ?? '').replace(/aria-disabled="[^"]*"/, '')
    expect(/[\s"]disabled(=|>|\s|$)/.test(tag)).toBe(false)
  })

  it('does not surface the motion-study badge until a study has run', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).not.toContain('data-testid="design-assembly-motion-badge"')
  })

  it('does not render the action buttons in the empty-state branch', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [] }))
    expect(html).not.toContain('data-testid="design-assembly-check-interference"')
    expect(html).not.toContain('data-testid="design-assembly-export-bom"')
  })

  it('does not emit console errors rendering the action toolbar', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(createElement(AssemblyView, { parts, projectDir: 'C:/proj' }))
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── (B) Bridge invocation (pure helpers) ─────────────────────────────────────

describe('runAssemblyInterferenceCheck', () => {
  const baseBridge = (): AssemblyActionBridge => ({
    assemblyInterferenceCheck: vi.fn(async () => clearReport()),
    assemblyInterferenceCheckSimulated: vi.fn(async () => clearReport()),
    assemblyExportBom: vi.fn(async () => 'C:/proj/output/bom.csv'),
    assemblySummary: vi.fn(async () => ({
      name: 'a',
      componentCount: 0,
      activeComponentCount: 0,
    } as never)),
  })

  it('invokes assemblyInterferenceCheck with the project dir and returns the report', async () => {
    const bridge = baseBridge()
    const report = clearReport({ conflictingPairs: [{ aId: 'p1', bId: 'p2' }], meshResolvedCount: 2 })
    ;(bridge.assemblyInterferenceCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce(report)
    const res = await runAssemblyInterferenceCheck(bridge, 'C:/proj')
    expect(bridge.assemblyInterferenceCheck).toHaveBeenCalledWith('C:/proj')
    expect(res).toEqual({ ok: true, report })
  })

  it('short-circuits without invoking the bridge when no project dir is set', async () => {
    const bridge = baseBridge()
    const res = await runAssemblyInterferenceCheck(bridge, null)
    expect(bridge.assemblyInterferenceCheck).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, error: 'no_project_dir' })
  })

  it('folds a rejected bridge promise into a structured error (never throws)', async () => {
    const bridge = baseBridge()
    ;(bridge.assemblyInterferenceCheck as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    )
    const res = await runAssemblyInterferenceCheck(bridge, 'C:/proj')
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})

describe('runAssemblyBomExport', () => {
  const baseBridge = (): AssemblyActionBridge => ({
    assemblyInterferenceCheck: vi.fn(async () => clearReport()),
    assemblyInterferenceCheckSimulated: vi.fn(async () => clearReport()),
    assemblyExportBom: vi.fn(async () => 'C:/proj/output/bom.csv'),
    assemblySummary: vi.fn(async () => ({
      name: 'a',
      componentCount: 0,
      activeComponentCount: 0,
    } as never)),
  })

  it('invokes assemblyExportBom and returns the output path', async () => {
    const bridge = baseBridge()
    const res = await runAssemblyBomExport(bridge, 'C:/proj')
    expect(bridge.assemblyExportBom).toHaveBeenCalledWith('C:/proj')
    expect(res).toEqual({ ok: true, path: 'C:/proj/output/bom.csv' })
  })

  it('short-circuits without invoking the bridge when no project dir is set', async () => {
    const bridge = baseBridge()
    const res = await runAssemblyBomExport(bridge, undefined)
    expect(bridge.assemblyExportBom).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, error: 'no_project_dir' })
  })
})

describe('formatInterferenceResultSummary', () => {
  it('reports "No interferences detected" for an empty report', () => {
    const s = formatInterferenceResultSummary(clearReport({ meshResolvedCount: 2 }))
    expect(s).toContain('No interferences detected')
    expect(s).toContain('2 meshes checked')
  })

  it('pluralizes a single interfering pair correctly', () => {
    const s = formatInterferenceResultSummary(
      clearReport({ conflictingPairs: [{ aId: 'p1', bId: 'p2' }], meshResolvedCount: 1 }),
    )
    expect(s).toContain('1 interfering pair detected')
    expect(s).toContain('1 mesh checked')
  })

  it('pluralizes multiple interfering pairs and flags the placement heuristic', () => {
    const s = formatInterferenceResultSummary(
      clearReport({
        conflictingPairs: [
          { aId: 'p1', bId: 'p2' },
          { aId: 'p2', bId: 'p3' },
        ],
      }),
    )
    expect(s).toContain('2 interfering pairs detected')
    expect(s).toContain('placement heuristic — no usable meshes')
  })
})
