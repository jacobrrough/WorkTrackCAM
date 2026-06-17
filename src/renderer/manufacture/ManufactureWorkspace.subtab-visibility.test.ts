/**
 * Pin for the Manufacture sub-tab-strip visibility (Cycle 275 — step toward
 * retiring the legacy panelTab strip in favor of the workflow-stage tabs).
 *
 * The strip is FINE navigation that only the `prepare`/`setup`/`toolpaths` stages
 * delegate to (via `panelTabBody`). The dedicated-body stages render their own
 * content, so the strip is hidden there to remove the duplicate/disconnected tab
 * row. This pins exactly which stages show it, so a future change can't silently
 * re-add the strip everywhere (regressing the dedup) or hide it where content
 * lives (orphaning the sub-tabs).
 */
import { describe, expect, it, vi } from 'vitest'

// ManufactureWorkspace's dependency chain touches window.fab at module load in
// some modules; shim it (mirrors ManufactureWorkspace.stage-content.test.tsx).
const g = globalThis as unknown as Record<string, unknown>
g['fab'] = {
  filamentsList: vi.fn().mockResolvedValue([]),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' }),
  readTextFile: vi.fn().mockResolvedValue(''),
  sliceLayerBreakdown: vi
    .fn()
    .mockResolvedValue({ ok: true, result: { layers: [], totalTimeSec: null, totalFilamentMm: null, layerCount: 0 } })
}
g['window'] = globalThis

import { stageShowsSubTabStrip, type WorkflowStage } from './ManufactureWorkspace'

describe('stageShowsSubTabStrip — sub-tab strip only in panelTab-delegating stages', () => {
  it('SHOWS the strip in prepare/setup/toolpaths (they delegate to panelTabBody)', () => {
    for (const s of ['prepare', 'setup', 'toolpaths'] as WorkflowStage[]) {
      expect(stageShowsSubTabStrip(s)).toBe(true)
    }
  })

  it('HIDES the strip in the dedicated-body stages (preview/device/simulate/probing/send)', () => {
    for (const s of ['preview', 'device', 'simulate', 'probing', 'send'] as WorkflowStage[]) {
      expect(stageShowsSubTabStrip(s)).toBe(false)
    }
  })
})
