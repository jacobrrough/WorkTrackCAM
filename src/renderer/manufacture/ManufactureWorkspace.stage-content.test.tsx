/**
 * UX MOVE 5 — Stage-content swap render-pins.
 *
 * The workflow-stage tabs above the Manufacture viewport are already pinned
 * by `WorkflowStageTabs.test.tsx`. This file pins the *body* that swaps in
 * underneath when the operator picks each stage:
 *
 *   FDM (K2 Plus):
 *     - 'prepare' → existing panelTab dispatch (not exercised here — the
 *                   chrome itself is unchanged for the default stage).
 *     - 'preview' → `LayerPreviewBody` (EmptyState when no slice / summary
 *                   when a G-code path is set).
 *     - 'device'  → ProfileStack + SliceManufacturePanel (not exercised at
 *                   the workspace level — ProfileStack has its own pins).
 *
 *   CNC (Laguna / Carvera):
 *     - 'setup' / 'toolpaths' → existing panelTab dispatch.
 *     - 'simulate' → `ToolpathSimulationBody` (EmptyState when no G-code /
 *                    motion-line summary when G-code present).
 *     - 'send'     → ProfileStack + CamManufacturePanel (own pins).
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matches
 * `WorkflowStageTabs.test.tsx`) so the test runs in the existing `node`
 * vitest environment. The parent `ManufactureWorkspace` has too many heavy
 * imports (Three.js, plate state) for a node-env test to mount the full
 * workspace — the stage bodies are exported standalone so they can be
 * exercised in isolation.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LayerPreviewBody,
  ToolpathSimulationBody,
  type LayerPreviewBodyProps,
  type ToolpathSimulationBodyProps
} from './ManufactureWorkspace'

// ─── window.fab shim ─────────────────────────────────────────────────────────
// ManufactureWorkspace.tsx imports several modules that touch `window.fab`
// at module load. `renderToStaticMarkup` won't fire effects, but the module-
// load side effects still resolve, so a minimal stub keeps any defensive
// `window` access from blowing up.
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = {
  filamentsList: vi.fn().mockResolvedValue([]),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' })
}
gAsRecord['window'] = globalThis

function renderPreview(props: LayerPreviewBodyProps): string {
  return renderToStaticMarkup(createElement(LayerPreviewBody, props))
}

function renderSimulate(props: ToolpathSimulationBodyProps): string {
  return renderToStaticMarkup(createElement(ToolpathSimulationBody, props))
}

describe('LayerPreviewBody — FDM "preview" stage body', () => {
  it('renders the EmptyState "Layer preview — slice first" when no slice has run', () => {
    const html = renderPreview({ sliceOut: '', lastSliceGcodePath: null })
    expect(html).toContain('data-testid="workflow-stage-body-preview"')
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).toContain('Layer preview — slice first')
  })

  it('treats whitespace-only lastSliceGcodePath as "no slice yet"', () => {
    const html = renderPreview({ sliceOut: 'noise', lastSliceGcodePath: '   ' })
    // Still empty-state — the path must be non-trivially non-empty.
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).not.toContain('data-testid="workflow-stage-preview-stats"')
  })

  it('renders the slice summary + slicer log line count when a G-code path exists', () => {
    const log = 'orca: starting slice\nLayer 1\nLayer 2\nLayer 3\nDone'
    const html = renderPreview({
      sliceOut: log,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // The empty-state surface is gone once a slice has produced output.
    expect(html).not.toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).toContain('data-testid="workflow-stage-preview-stats"')
    expect(html).toContain('data-testid="workflow-stage-preview-path"')
    expect(html).toContain('/tmp/proj/output/slice.gcode')
    // Slicer-log line count surfaces the number of lines in `sliceOut`.
    expect(html).toContain('data-testid="workflow-stage-preview-line-count"')
    expect(html).toMatch(/data-testid="workflow-stage-preview-line-count">5</)
  })
})

describe('ToolpathSimulationBody — CNC "simulate" stage body', () => {
  it('renders the EmptyState "No simulation yet — generate G-code first" when camOut is empty', () => {
    const html = renderSimulate({ camOut: '' })
    expect(html).toContain('data-testid="workflow-stage-body-simulate"')
    expect(html).toContain('data-testid="workflow-stage-simulate-empty"')
    expect(html).toContain('No simulation yet — generate G-code first')
  })

  it('treats whitespace-only camOut as "no toolpath yet"', () => {
    const html = renderSimulate({ camOut: '   \n  \r\n   ' })
    expect(html).toContain('data-testid="workflow-stage-simulate-empty"')
    expect(html).not.toContain('data-testid="workflow-stage-simulate-stats"')
  })

  it('renders motion-line + total-line counts when G-code is present', () => {
    const gcode = [
      'G21',
      '; comment-only line',
      'G0 X0 Y0 Z5',
      'G1 Z-1 F300',
      'G1 X10 Y0',
      'G1 X10 Y10',
      'G0 Z5',
      'M30'
    ].join('\n')
    const html = renderSimulate({ camOut: gcode })
    expect(html).not.toContain('data-testid="workflow-stage-simulate-empty"')
    expect(html).toContain('data-testid="workflow-stage-simulate-stats"')
    expect(html).toContain('data-testid="workflow-stage-simulate-total-lines"')
    expect(html).toMatch(/data-testid="workflow-stage-simulate-total-lines">8</)
    expect(html).toContain('data-testid="workflow-stage-simulate-motion-lines"')
    // 5 motion lines (two G0, three G1) — comments + G21 + M30 do not count.
    expect(html).toMatch(/data-testid="workflow-stage-simulate-motion-lines">5</)
  })
})

describe('Stage-body data-testid contracts', () => {
  it('LayerPreviewBody always carries the workflow-stage-body-preview testid', () => {
    const empty = renderPreview({ sliceOut: '', lastSliceGcodePath: null })
    const ready = renderPreview({
      sliceOut: 'one line',
      lastSliceGcodePath: '/tmp/x.gcode'
    })
    expect(empty).toContain('data-testid="workflow-stage-body-preview"')
    expect(ready).toContain('data-testid="workflow-stage-body-preview"')
  })

  it('ToolpathSimulationBody always carries the workflow-stage-body-simulate testid', () => {
    const empty = renderSimulate({ camOut: '' })
    const ready = renderSimulate({ camOut: 'G1 X1' })
    expect(empty).toContain('data-testid="workflow-stage-body-simulate"')
    expect(ready).toContain('data-testid="workflow-stage-body-simulate"')
  })
})
