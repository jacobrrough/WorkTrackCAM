/**
 * UX MOVE 4 render-pin: the workflow-stage tabs above the Manufacture
 * viewport must render the correct stage set for each env (FDM vs CNC).
 *
 * Stage sets are pinned by CLAUDE.md My-Shop-Only:
 *   - FDM (K2 Plus):                   Prepare / Preview / Device                  (3 tabs)
 *   - CNC (Laguna / Carvera 3+4-axis): Setup / Toolpaths / Simulate / Probing / Send (5 tabs)
 *
 * Wave 3a added the CNC "Probing" stage (mounts the formerly-dead
 * ProbeCyclePanel — 5 touch-probe cycle types). It sits between Simulate and
 * Send because probing is the last on-machine setup step before running.
 *
 * The strip uses roving-tabindex (only the active tab has tabIndex=0) and
 * carries a `data-testid` per tab so dependent tests / E2E flows can poke
 * a specific stage. The component itself is exported so this test can
 * exercise it in isolation -- the parent `ManufactureWorkspace` has too
 * many heavy imports (Three.js, plate state, etc.) for a node-env test
 * to mount the full workspace.
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matches
 * `manufacture-aux-k2-send-render.test.tsx` C50) so the test runs in the
 * existing vitest `node` environment without a jsdom dependency.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  WorkflowStageTabs,
  defaultWorkflowStageFor,
  type WorkflowStage,
  type WorkflowStageTabsProps
} from './ManufactureWorkspace'

// ── window.fab shim ─────────────────────────────────────────────────────────
// `ManufactureWorkspace` imports several modules that touch `window.fab` at
// module load (mostly via aux-panel imports). `renderToStaticMarkup` won't
// fire effects, but the module-load side effects still resolve, so a minimal
// stub keeps any defensive `window` access from blowing up.
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = {
  filamentsList: vi.fn().mockResolvedValue([]),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' })
}
gAsRecord['window'] = globalThis

function render(props: WorkflowStageTabsProps): string {
  return renderToStaticMarkup(createElement(WorkflowStageTabs, props))
}

function baseProps(overrides: Partial<WorkflowStageTabsProps>): WorkflowStageTabsProps {
  return {
    env: 'fdm',
    stage: 'prepare',
    onChange: () => {},
    ...overrides
  }
}

describe('WorkflowStageTabs -- FDM env (K2 Plus)', () => {
  it('renders exactly the three FDM stage buttons: Prepare / Preview / Device', () => {
    const html = render(baseProps({ env: 'fdm', stage: 'prepare' }))
    // Container present + env data attribute pinned
    expect(html).toContain('data-testid="workflow-stage-tabs"')
    expect(html).toContain('data-env="fdm"')

    // The three FDM stage buttons render
    expect(html).toContain('data-testid="workflow-stage-tab-prepare"')
    expect(html).toContain('data-testid="workflow-stage-tab-preview"')
    expect(html).toContain('data-testid="workflow-stage-tab-device"')

    // Visible labels
    expect(html).toContain('>Prepare<')
    expect(html).toContain('>Preview<')
    expect(html).toContain('>Device<')

    // CNC stages must NOT render under FDM env
    expect(html).not.toContain('data-testid="workflow-stage-tab-setup"')
    expect(html).not.toContain('data-testid="workflow-stage-tab-toolpaths"')
    expect(html).not.toContain('data-testid="workflow-stage-tab-simulate"')
    expect(html).not.toContain('data-testid="workflow-stage-tab-send"')
  })

  it('marks the active FDM stage with aria-selected=true and tabIndex=0', () => {
    const html = render(baseProps({ env: 'fdm', stage: 'preview' }))
    // Active tab: aria-selected=true + tabindex=0 + the data-stage testid
    expect(html).toMatch(
      /aria-selected="true"[^>]*tabindex="0"[^>]*data-stage="preview"/
    )
    // Inactive tabs: aria-selected=false + tabindex=-1
    expect(html).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-stage="prepare"/
    )
    expect(html).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-stage="device"/
    )
  })

  it('FDM strip carries the FDM aria-label and role=tablist', () => {
    const html = render(baseProps({ env: 'fdm', stage: 'prepare' }))
    expect(html).toContain('aria-label="FDM workflow stages"')
    expect(html).toContain('role="tablist"')
  })
})

describe('WorkflowStageTabs -- CNC env (Laguna / Carvera 3/4-axis)', () => {
  it('renders exactly the five CNC stage buttons: Setup / Toolpaths / Simulate / Probing / Send', () => {
    const html = render(baseProps({ env: 'cnc', stage: 'setup' }))
    expect(html).toContain('data-testid="workflow-stage-tabs"')
    expect(html).toContain('data-env="cnc"')

    // The five CNC stage buttons render
    expect(html).toContain('data-testid="workflow-stage-tab-setup"')
    expect(html).toContain('data-testid="workflow-stage-tab-toolpaths"')
    expect(html).toContain('data-testid="workflow-stage-tab-simulate"')
    expect(html).toContain('data-testid="workflow-stage-tab-probing"')
    expect(html).toContain('data-testid="workflow-stage-tab-send"')

    // Visible labels
    expect(html).toContain('>Setup<')
    expect(html).toContain('>Toolpaths<')
    expect(html).toContain('>Simulate<')
    expect(html).toContain('>Probing<')
    expect(html).toContain('>Send<')

    // FDM stages must NOT render under CNC env
    expect(html).not.toContain('data-testid="workflow-stage-tab-prepare"')
    expect(html).not.toContain('data-testid="workflow-stage-tab-preview"')
    expect(html).not.toContain('data-testid="workflow-stage-tab-device"')
  })

  it('marks the active CNC stage with aria-selected=true', () => {
    const html = render(baseProps({ env: 'cnc', stage: 'toolpaths' }))
    // Active tab carries aria-selected=true + tabindex=0
    expect(html).toMatch(
      /aria-selected="true"[^>]*tabindex="0"[^>]*data-stage="toolpaths"/
    )
    // Inactive tabs carry aria-selected=false + tabindex=-1
    expect(html).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-stage="setup"/
    )
    expect(html).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-stage="simulate"/
    )
    expect(html).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-stage="send"/
    )
  })

  it('CNC strip carries the CNC aria-label', () => {
    const html = render(baseProps({ env: 'cnc', stage: 'setup' }))
    expect(html).toContain('aria-label="CNC workflow stages"')
  })
})

describe('WorkflowStageTabs -- visible counts (Bambu/Orca/Fusion pattern)', () => {
  it('FDM env renders exactly 3 tab buttons (Prepare/Preview/Device)', () => {
    const html = render(baseProps({ env: 'fdm', stage: 'prepare' }))
    const buttons = html.match(/data-testid="workflow-stage-tab-/g)
    expect(buttons).not.toBeNull()
    expect(buttons!.length).toBe(3)
  })

  it('CNC env renders exactly 5 tab buttons (Setup/Toolpaths/Simulate/Probing/Send)', () => {
    const html = render(baseProps({ env: 'cnc', stage: 'setup' }))
    const buttons = html.match(/data-testid="workflow-stage-tab-/g)
    expect(buttons).not.toBeNull()
    expect(buttons!.length).toBe(5)
  })
})

describe('defaultWorkflowStageFor', () => {
  it('returns "prepare" for the FDM env (K2 Plus default landing stage)', () => {
    expect(defaultWorkflowStageFor('fdm')).toBe<WorkflowStage>('prepare')
  })

  it('returns "setup" for the CNC env (Laguna / Carvera default landing stage)', () => {
    expect(defaultWorkflowStageFor('cnc')).toBe<WorkflowStage>('setup')
  })
})
