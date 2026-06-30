/**
 * Pin for the Manufacture sub-tab-strip RETIREMENT (Wave D).
 *
 * History: Cycle 275 only HID the legacy `ManufactureSubTabStrip` in the five
 * dedicated-body stages; the three `panelTabBody` stages still rendered it, so
 * the workspace hosted TWO parallel tab systems (the user's "I keep seeing the
 * same thing twice" complaint). Wave D fully retired the global strip — the
 * workflow-stage tabs (`WorkflowStageTabs`) are now the SOLE primary navigation
 * and every legacy sub-tab's content is re-homed into the workflow stage it
 * belongs to.
 *
 * These are SOURCE-TEXT pins (node-friendly, mirroring `calibration-ipc-pin`)
 * so a future change can't silently:
 *   - re-mount the global `<ManufactureSubTabStrip>` (regressing the dedup), or
 *   - drop the re-homed Calibrate / Simulate-playback content.
 *
 * The full per-stage body behaviour is render-pinned in
 * `ManufactureWorkspace.stage-content.test.tsx`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WORKSPACE_SRC = readFileSync(
  resolve(__dirname, 'ManufactureWorkspace.tsx'),
  'utf8'
)

describe('Manufacture sub-tab strip retirement (Wave D)', () => {
  it('no longer IMPORTS or RENDERS the global ManufactureSubTabStrip component', () => {
    // The import line is gone…
    expect(WORKSPACE_SRC).not.toMatch(/import\s*\{\s*ManufactureSubTabStrip\s*\}/)
    // …and the JSX element is never rendered (the duplicate top strip is gone).
    expect(WORKSPACE_SRC).not.toContain('<ManufactureSubTabStrip')
  })

  it('drops the dead stageShowsSubTabStrip helper (no strip ⇒ no visibility gate)', () => {
    expect(WORKSPACE_SRC).not.toContain('stageShowsSubTabStrip')
  })

  it('keeps WorkflowStageTabs as the sole primary navigation', () => {
    expect(WORKSPACE_SRC).toContain('<WorkflowStageTabs')
    // The tabpanel is now labelled by the active workflow-stage tab, not a
    // legacy sub-tab button id.
    expect(WORKSPACE_SRC).toMatch(/aria-labelledby=\{`workflow-stage-\$\{workflowStage\}`\}/)
  })

  it('routes every workflow stage to a dedicated re-homed body', () => {
    for (const body of [
      'prepareStageBody',
      'previewStageBody',
      'deviceStageBody',
      'setupStageBody',
      'toolpathsStageBody',
      'simulateStageBody',
      'probingStageBody',
      'sendStageBody'
    ]) {
      expect(WORKSPACE_SRC).toContain(body)
    }
  })

  it('re-homes the Calibrate panel under the FDM Prepare stage (panelTab === calibrate survives)', () => {
    // The calibrate routing literal must survive (the calibration-ipc-pin D2
    // pin also asserts this), now living inside the Prepare stage body.
    expect(WORKSPACE_SRC).toMatch(/panelTab === 'calibrate'/)
    expect(WORKSPACE_SRC).toMatch(/<CalibrationPanel[\s\S]+?activeMachine=/)
  })

  it('mounts the full R3F simulation panel as the primary Simulate-stage content', () => {
    // The CNC Simulate stage renders both the text-stats body AND the R3F
    // playback panel (formerly only reachable from the legacy `simulate` sub-tab).
    const simStart = WORKSPACE_SRC.indexOf('const simulateStageBody')
    expect(simStart).toBeGreaterThan(-1)
    const simBody = WORKSPACE_SRC.slice(simStart, simStart + 1200)
    expect(simBody).toContain('<ToolpathSimulationBody')
    expect(simBody).toContain('camSimulationViewer')
  })

  it('re-homes Slice + Tools panels into the prepare/toolpaths stages', () => {
    // The legacy slice / cam / tools sub-tabs are re-homed: SliceManufacturePanel
    // under Prepare, CamManufacturePanel + ToolsManufacturePanel under Toolpaths.
    expect(WORKSPACE_SRC).toContain('<SliceManufacturePanel')
    expect(WORKSPACE_SRC).toContain('<CamManufacturePanel')
    expect(WORKSPACE_SRC).toContain('<ToolsManufacturePanel')
    // The CNC Setup stage stacks the job tree + the stock/WCS/4-axis SetupTab.
    expect(WORKSPACE_SRC).toContain('<ManufactureSetupTab')
  })

  it('threads the feeds & speeds Apply-to-op callback into auxPanelProps via updateOp', () => {
    // The deferred Wave C thread: the aux-panel bundle wires
    // onApplyFeedsSpeedsToActiveOp to the existing updateOp op-mutation path so
    // the FeedsSpeedsCard "Apply to op" button writes spindleRpm + feedMmMin onto
    // the selected op's params (no re-clamp). activeOpLabel surfaces the target op.
    expect(WORKSPACE_SRC).toContain('onApplyFeedsSpeedsToActiveOp:')
    expect(WORKSPACE_SRC).toMatch(
      /onApplyFeedsSpeedsToActiveOp:[\s\S]{0,400}updateOp\(selectedOpIndex,\s*\{\s*params:[\s\S]{0,120}spindleRpm,\s*feedMmMin/
    )
    expect(WORKSPACE_SRC).toMatch(/activeOpLabel:\s*effectiveMfg\.operations\[selectedOpIndex\]\?\.label/)
  })
})
