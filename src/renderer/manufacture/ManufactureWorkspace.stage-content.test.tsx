/**
 * UX MOVE 5 (Wave 2) — Stage-content swap render-pins.
 *
 * Wave 1 pinned the chrome (`WorkflowStageTabs.test.tsx`) and the
 * EmptyState-only shape of the per-stage bodies. Wave 2 fills the bodies
 * with real readouts:
 *
 *   FDM (K2 Plus):
 *     - 'preview' → `LayerPreviewBody` (EmptyState when no slice /
 *                   layer scrubber + metadata readout when G-code text
 *                   has been parsed for OrcaSlicer layer markers).
 *
 *   CNC (Laguna / Carvera):
 *     - 'simulate' → `ToolpathSimulationBody` (EmptyState when no
 *                    G-code / statistics readout when G-code parses
 *                    cleanly).
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matches the Wave 1
 * setup + `WorkflowStageTabs.test.tsx`) so the test runs in the
 * existing `node` vitest environment. The parent `ManufactureWorkspace`
 * has too many heavy imports (Three.js, plate state) for a node-env
 * test to mount the full workspace — the stage bodies are exported
 * standalone so they can be exercised in isolation.
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
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' }),
  readTextFile: vi.fn().mockResolvedValue('')
}
gAsRecord['window'] = globalThis

function renderPreview(props: LayerPreviewBodyProps): string {
  return renderToStaticMarkup(createElement(LayerPreviewBody, props))
}

function renderSimulate(props: ToolpathSimulationBodyProps): string {
  return renderToStaticMarkup(createElement(ToolpathSimulationBody, props))
}

// OrcaSlicer K2 Plus sample: 3 layers + total estimates header.
const ORCA_K2_GCODE = [
  '; estimated printing time (normal mode) = 30m',
  '; total filament used [mm] = 3000',
  ';BEFORE_LAYER_CHANGE',
  ';0.20',
  'G1 X0 Y0 E5',
  ';BEFORE_LAYER_CHANGE',
  ';0.40',
  'G1 X10 Y10 E10',
  ';BEFORE_LAYER_CHANGE',
  ';0.60',
  'G1 X20 Y20 E15'
].join('\n')

// Carvera 3-axis CNC sample with M3 + M6 + arc + cut moves.
const CARVERA_GCODE = [
  '; CARVERA — Makera Controller',
  'G21 G90',
  'M6 T1',
  'M3 S15000',
  'G0 X10 Y10 Z5',
  'G1 Z-1 F300',
  'G1 X20 Y10',
  'G2 X30 Y10 I5 J0',
  'G0 Z5',
  'M5',
  'M30'
].join('\n')

describe('LayerPreviewBody — FDM "preview" stage body', () => {
  it('renders the EmptyState "Layer preview — slice first" when no slice has run', () => {
    const html = renderPreview({ gcodeText: '', lastSliceGcodePath: null })
    expect(html).toContain('data-testid="workflow-stage-body-preview"')
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).toContain('Layer preview — slice first')
  })

  it('treats whitespace-only lastSliceGcodePath as "no slice yet"', () => {
    const html = renderPreview({ gcodeText: ORCA_K2_GCODE, lastSliceGcodePath: '   ' })
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).not.toContain('data-testid="workflow-stage-preview-stats"')
  })

  it('renders the EmptyState when the path is set but G-code has no layer markers', () => {
    const html = renderPreview({
      gcodeText: 'G1 X0\nG1 X10\nG1 X20',
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // Path is set but no layer markers — still empty-state.
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
  })

  it('renders the layer-scrubber + metadata readout when G-code parses', () => {
    const html = renderPreview({
      gcodeText: ORCA_K2_GCODE,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // EmptyState is gone once we have parsed layers.
    expect(html).not.toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).toContain('data-testid="workflow-stage-preview-stats"')
    expect(html).toContain('data-testid="workflow-stage-preview-path"')
    expect(html).toContain('/tmp/proj/output/slice.gcode')
    // Scrubber surfaces.
    expect(html).toContain('data-testid="workflow-stage-preview-slider"')
    expect(html).toContain('data-testid="workflow-stage-preview-slider-input"')
    expect(html).toContain('data-testid="workflow-stage-preview-slider-readout"')
  })

  it('defaults the selected layer to the top (highest-Z) when no selection prop set', () => {
    const html = renderPreview({
      gcodeText: ORCA_K2_GCODE,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // 3 layers parsed; default picks the top one (index 3 / 3).
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-index">3 \/ 3</)
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-z">0\.60 mm</)
  })

  it('honours selectedLayerIndex prop to drive the metadata readout', () => {
    const html = renderPreview({
      gcodeText: ORCA_K2_GCODE,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
      selectedLayerIndex: 1
    })
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-index">1 \/ 3</)
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-z">0\.20 mm</)
  })

  it('surfaces per-layer time + filament estimates when the slicer header is present', () => {
    const html = renderPreview({
      gcodeText: ORCA_K2_GCODE,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // 30m / 3 layers = 10m per layer
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-time">10m 0s</)
    // 3000mm / 3 layers = 1000mm per layer => "1.00 m"
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-filament">1\.00 m</)
  })

  it('falls back to em-dash for time/filament when slicer headers are missing', () => {
    const noHeader = [
      ';BEFORE_LAYER_CHANGE',
      ';0.20',
      ';BEFORE_LAYER_CHANGE',
      ';0.40'
    ].join('\n')
    const html = renderPreview({
      gcodeText: noHeader,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-time">—</)
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-filament">—</)
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

  it('renders the full statistics readout when G-code is present', () => {
    const html = renderSimulate({ camOut: CARVERA_GCODE })
    expect(html).not.toContain('data-testid="workflow-stage-simulate-empty"')
    expect(html).toContain('data-testid="workflow-stage-simulate-stats"')
    // All nine stat rows must be wired with their data-testid hooks.
    expect(html).toContain('data-testid="workflow-stage-simulate-total-lines"')
    expect(html).toContain('data-testid="workflow-stage-simulate-motion-lines"')
    expect(html).toContain('data-testid="workflow-stage-simulate-rapid-count"')
    expect(html).toContain('data-testid="workflow-stage-simulate-cut-count"')
    expect(html).toContain('data-testid="workflow-stage-simulate-arc-count"')
    expect(html).toContain('data-testid="workflow-stage-simulate-rapid-distance"')
    expect(html).toContain('data-testid="workflow-stage-simulate-cut-distance"')
    expect(html).toContain('data-testid="workflow-stage-simulate-tool-changes"')
    expect(html).toContain('data-testid="workflow-stage-simulate-spindle-starts"')
  })

  it('counts tool changes (M6) and spindle starts (M3) from the Carvera fixture', () => {
    const html = renderSimulate({ camOut: CARVERA_GCODE })
    // CARVERA_GCODE has 1 M6 and 1 M3
    expect(html).toMatch(/data-testid="workflow-stage-simulate-tool-changes">1</)
    expect(html).toMatch(/data-testid="workflow-stage-simulate-spindle-starts">1</)
  })

  it('counts arc moves (G2/G3) separately from straight cuts', () => {
    const html = renderSimulate({ camOut: CARVERA_GCODE })
    // CARVERA_GCODE has 1 G2 arc
    expect(html).toMatch(/data-testid="workflow-stage-simulate-arc-count">1</)
  })
})

describe('Stage-body data-testid contracts', () => {
  it('LayerPreviewBody always carries the workflow-stage-body-preview testid', () => {
    const empty = renderPreview({ gcodeText: '', lastSliceGcodePath: null })
    const ready = renderPreview({
      gcodeText: ORCA_K2_GCODE,
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
