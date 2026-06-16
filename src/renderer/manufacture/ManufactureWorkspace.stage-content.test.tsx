/**
 * UX MOVE 5 (Wave 2) — Stage-content swap render-pins.
 *
 * Wave 1 pinned the chrome (`WorkflowStageTabs.test.tsx`) and the
 * EmptyState-only shape of the per-stage bodies. Wave 2 fills the bodies
 * with real readouts:
 *
 *   FDM (K2 Plus):
 *     - 'preview' → `LayerPreviewBody` (EmptyState when no slice /
 *                   layer scrubber + metadata readout + per-layer table
 *                   when a `FdmLayerBreakdownResult` is present).
 *
 *   CNC (Laguna / Carvera):
 *     - 'simulate' → `ToolpathSimulationBody` (EmptyState when no
 *                    G-code / statistics readout when G-code parses
 *                    cleanly).
 *
 * CAD V1.5 update: `LayerPreviewBody` no longer takes raw `gcodeText`. The
 * coarse renderer-side `parseLayers` flow was replaced by the streaming
 * main-process parser (`slice:layerBreakdown` ->
 * `src/main/slicer/fdm-gcode-stream-parser.ts`); the body now takes a
 * `layerBreakdown: FdmLayerBreakdownResult | null` prop. These fixtures
 * build that result shape directly.
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
import type {
  FdmLayerBreakdown,
  FdmLayerBreakdownResult,
  FdmLineTypeCounts
} from '../../shared/fdm-gcode-layer-breakdown'

// ─── window.fab shim ─────────────────────────────────────────────────────────
// ManufactureWorkspace.tsx imports several modules that touch `window.fab`
// at module load. `renderToStaticMarkup` won't fire effects, but the module-
// load side effects still resolve, so a minimal stub keeps any defensive
// `window` access from blowing up.
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = {
  filamentsList: vi.fn().mockResolvedValue([]),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' }),
  readTextFile: vi.fn().mockResolvedValue(''),
  sliceLayerBreakdown: vi.fn().mockResolvedValue({
    ok: true,
    result: { layers: [], totalTimeSec: null, totalFilamentMm: null, layerCount: 0 }
  })
}
gAsRecord['window'] = globalThis

function renderPreview(props: LayerPreviewBodyProps): string {
  return renderToStaticMarkup(createElement(LayerPreviewBody, props))
}

function renderSimulate(props: ToolpathSimulationBodyProps): string {
  return renderToStaticMarkup(createElement(ToolpathSimulationBody, props))
}

/** Build a single layer with optional overrides. */
function makeLayer(over: Partial<FdmLayerBreakdown> & { index: number; zMm: number }): FdmLayerBreakdown {
  return {
    estTimeSec: null,
    estFilamentMm: null,
    lineTypeCounts: null,
    maxSpeedMmMin: null,
    ...over
  }
}

/** Build a result from a list of layers + optional header totals. */
function makeResult(
  layers: FdmLayerBreakdown[],
  totals?: { totalTimeSec?: number | null; totalFilamentMm?: number | null }
): FdmLayerBreakdownResult {
  return {
    layers,
    totalTimeSec: totals?.totalTimeSec ?? null,
    totalFilamentMm: totals?.totalFilamentMm ?? null,
    layerCount: layers.length
  }
}

// OrcaSlicer K2 Plus sample equivalent: 3 layers (Z 0.20 / 0.40 / 0.60) with
// the slicer header reporting 30m total time + 3000mm filament. The legacy
// uniform distribution => 600s / 1000mm per layer, exactly what the streaming
// parser produces as its fallback. (Matches the old ORCA_K2_GCODE fixture's
// observable output.)
const ORCA_K2_RESULT: FdmLayerBreakdownResult = makeResult(
  [
    makeLayer({ index: 1, zMm: 0.2, estTimeSec: 600, estFilamentMm: 1000 }),
    makeLayer({ index: 2, zMm: 0.4, estTimeSec: 600, estFilamentMm: 1000 }),
    makeLayer({ index: 3, zMm: 0.6, estTimeSec: 600, estFilamentMm: 1000 })
  ],
  { totalTimeSec: 1800, totalFilamentMm: 3000 }
)

// No-header equivalent: 2 layers, no per-layer time/filament.
const NO_HEADER_RESULT: FdmLayerBreakdownResult = makeResult([
  makeLayer({ index: 1, zMm: 0.2 }),
  makeLayer({ index: 2, zMm: 0.4 })
])

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
  it('renders the EmptyState "Layer preview — slice first" when no breakdown', () => {
    const html = renderPreview({ layerBreakdown: null, lastSliceGcodePath: null })
    expect(html).toContain('data-testid="workflow-stage-body-preview"')
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).toContain('Layer preview — slice first')
  })

  it('treats whitespace-only lastSliceGcodePath as "no slice yet"', () => {
    const html = renderPreview({ layerBreakdown: ORCA_K2_RESULT, lastSliceGcodePath: '   ' })
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
    expect(html).not.toContain('data-testid="workflow-stage-preview-stats"')
  })

  it('renders the EmptyState when the path is set but the breakdown has no layers', () => {
    const html = renderPreview({
      layerBreakdown: makeResult([]),
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // Path is set but zero layers — still empty-state.
    expect(html).toContain('data-testid="workflow-stage-preview-empty"')
  })

  it('renders the layer-scrubber + metadata readout when a breakdown is present', () => {
    const html = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
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
      layerBreakdown: ORCA_K2_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // 3 layers; default picks the top one (index 3 / 3).
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-index">3 \/ 3</)
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-z">0\.60 mm</)
  })

  it('honours selectedLayerIndex prop to drive the metadata readout', () => {
    const html = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
      selectedLayerIndex: 1
    })
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-index">1 \/ 3</)
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-z">0\.20 mm</)
  })

  it('surfaces per-layer time + filament estimates', () => {
    const html = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    // 600s per layer => "10m 0s"
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-time">10m 0s</)
    // 1000mm per layer => "1.00 m"
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-filament">1\.00 m</)
  })

  it('falls back to em-dash for time/filament when the breakdown has null values', () => {
    const html = renderPreview({
      layerBreakdown: NO_HEADER_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-time">—</)
    expect(html).toMatch(/data-testid="workflow-stage-preview-layer-filament">—</)
  })

  it('renders a per-layer table with one row per layer', () => {
    const html = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    expect(html).toContain('data-testid="workflow-stage-preview-table"')
    expect(html).toContain('data-testid="workflow-stage-preview-table-row-1"')
    expect(html).toContain('data-testid="workflow-stage-preview-table-row-2"')
    expect(html).toContain('data-testid="workflow-stage-preview-table-row-3"')
    // Row 3's Z renders in the table cell.
    expect(html).toContain('0.60')
  })

  it('marks the active layer row with aria-current', () => {
    const html = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
      selectedLayerIndex: 2
    })
    // The active row (index 2) carries aria-current; render order puts the
    // attribute right before the row's testid is far, so just assert both
    // the active class + the aria attribute appear.
    expect(html).toContain('layer-breakdown-table__row--active')
    expect(html).toContain('aria-current="true"')
  })

  it('omits the line-type row when no layer carries lineTypeCounts', () => {
    const html = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    expect(html).not.toContain('data-testid="workflow-stage-preview-layer-linetypes"')
  })

  it('renders the line-type row for the active layer when lineTypeCounts present', () => {
    const counts: FdmLineTypeCounts = { 'Outer wall': 4, 'Sparse infill': 12 }
    const result = makeResult([makeLayer({ index: 1, zMm: 0.2, lineTypeCounts: counts })])
    const html = renderPreview({
      layerBreakdown: result,
      lastSliceGcodePath: '/tmp/proj/output/slice.gcode'
    })
    expect(html).toContain('data-testid="workflow-stage-preview-layer-linetypes"')
    expect(html).toContain('Outer wall 4')
    expect(html).toContain('Sparse infill 12')
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

describe('ToolpathSimulationBody — stock-removal voxel approximation', () => {
  it('shows the no-stock note when G-code is present but no stock box is set', () => {
    const html = renderSimulate({ camOut: CARVERA_GCODE })
    expect(html).toContain('data-testid="workflow-stage-simulate-no-stock"')
    expect(html).not.toContain('data-testid="stock-removal-sim"')
  })

  it('renders the voxel heatmap + removal stats when a box stock is provided', () => {
    const html = renderSimulate({
      camOut: CARVERA_GCODE,
      stockBox: { x: 40, y: 40, z: 10 },
      toolDiameterMm: 6,
      toolShape: 'flat'
    })
    // Still shows the legacy motion stats...
    expect(html).toContain('data-testid="workflow-stage-simulate-stats"')
    // ...plus the new voxel-approximation block.
    expect(html).toContain('data-testid="stock-removal-sim"')
    expect(html).toContain('data-testid="stock-removal-sim-canvas"')
    expect(html).toContain('data-testid="stock-removal-sim-stats"')
    expect(html).toContain('data-testid="stock-removal-sim-removed"')
    expect(html).toContain('data-testid="stock-removal-sim-resolution"')
    expect(html).not.toContain('data-testid="workflow-stage-simulate-no-stock"')
  })

  it('labels the preview as a voxel approximation (honesty caveat)', () => {
    const html = renderSimulate({
      camOut: CARVERA_GCODE,
      stockBox: { x: 40, y: 40, z: 10 }
    })
    expect(html).toContain('voxel approximation')
    expect(html).toMatch(/Approximation only/i)
  })

  it('shows a skip message when the stock box is invalid', () => {
    const html = renderSimulate({
      camOut: CARVERA_GCODE,
      stockBox: { x: 40, y: 0, z: 10 }
    })
    expect(html).toContain('data-testid="stock-removal-sim-skip"')
    expect(html).not.toContain('data-testid="stock-removal-sim-canvas"')
  })

  it('shows a skip message when the G-code has stock but no machinable motion', () => {
    // `camOut` is non-empty (has spindle M-codes) so the outer body renders its
    // stats, but the voxel sim finds no G0/G1/G2/G3 motion → skip branch.
    const html = renderSimulate({
      camOut: 'G21 G90\nM3 S12000\nM5\nM30',
      stockBox: { x: 40, y: 40, z: 10 }
    })
    expect(html).toContain('data-testid="stock-removal-sim-skip"')
    expect(html).not.toContain('data-testid="stock-removal-sim-canvas"')
  })
})

describe('Stage-body data-testid contracts', () => {
  it('LayerPreviewBody always carries the workflow-stage-body-preview testid', () => {
    const empty = renderPreview({ layerBreakdown: null, lastSliceGcodePath: null })
    const ready = renderPreview({
      layerBreakdown: ORCA_K2_RESULT,
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
