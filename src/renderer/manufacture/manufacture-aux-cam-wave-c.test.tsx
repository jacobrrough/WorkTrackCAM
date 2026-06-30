/**
 * Wave C render-pins for CamManufacturePanel (the CNC CAM aux panel):
 *
 *   1. Laguna 6-zone vacuum ALLOCATOR ([ID-0020]) is mounted and gated to the
 *      Laguna Swift — present under Laguna, absent under Carvera / undefined.
 *   2. Feeds & Speeds "Apply to op" button is wired through the panel: present
 *      when `onApplyFeedsSpeedsToActiveOp` is supplied (CNC machine active),
 *      absent when the callback is omitted (advisory-only — the deferred
 *      ManufactureWorkspace thread).
 *
 * Node vitest environment + `react-dom/server.renderToStaticMarkup`, matching
 * manufacture-aux-k2-send-render.test.tsx. CamManufacturePanel fires no
 * `window.fab` calls during render (its fab references are inside click
 * handlers), but we stub `window` minimally for parity / safety.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CamManufacturePanel, type ManufactureAuxPanelsProps } from './ManufactureAuxPanels'
import type { MachineProfile } from '../../shared/machine-schema'

// Minimal window.fab stub (render path does not call it, but the module touches
// window.fab at import via the lazy GateIo arrow — keep a no-op shim for safety).
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = { readTextFile: vi.fn().mockResolvedValue('') }
gAsRecord['window'] = globalThis

const lagunaSwift: MachineProfile = {
  id: 'laguna-swift-5x10',
  name: 'Laguna Swift 5x10',
  kind: 'cnc',
  workAreaMm: { x: 1524, y: 3048, z: 203 },
  maxFeedMmMin: 15000,
  minSpindleRpm: 8000,
  maxSpindleRpm: 18000,
  axisCount: 3,
  dialect: 'mach3',
  postTemplate: 'vcarve_mach3.hbs'
}

const carvera3: MachineProfile = {
  id: 'makera-carvera',
  name: 'Makera Carvera',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 2400,
  minSpindleRpm: 13000,
  maxSpindleRpm: 15000,
  axisCount: 3,
  dialect: 'smoothieware',
  postTemplate: 'carvera_3axis.hbs'
}

function baseProps(overrides: Partial<ManufactureAuxPanelsProps>): ManufactureAuxPanelsProps {
  return {
    machines: [lagunaSwift, carvera3],
    settings: null,
    project: null,
    projectDir: '/tmp/proj',
    tools: null,
    projectTools: null,
    machineTools: null,
    activeMachine: lagunaSwift,
    sliceOut: '',
    camOut: '',
    camLastHint: '',
    importText: '',
    onImportTextChange: () => {},
    onSaveSettingsField: () => {},
    onRunSlice: () => {},
    onRunCam: () => {},
    onImportTools: () => {},
    onImportToolLibraryFromFile: () => {},
    manufacture: null,
    onGoSettings: () => {},
    onGoProject: () => {},
    ...overrides
  }
}

function render(props: ManufactureAuxPanelsProps): string {
  return renderToStaticMarkup(createElement(CamManufacturePanel, props))
}

describe('CamManufacturePanel — Laguna vacuum allocator gating', () => {
  it('mounts the allocator panel when the active machine is the Laguna Swift', () => {
    const html = render(baseProps({ activeMachine: lagunaSwift }))
    expect(html).toContain('data-testid="laguna-vacuum-allocator"')
    expect(html).toContain('Vacuum Zone Allocator')
    // It coexists with the existing manual toggle picker.
    expect(html).toContain('data-testid="laguna-vacuum-zone-picker"')
  })

  it('omits the allocator panel under a Carvera (non-Laguna CNC)', () => {
    const html = render(baseProps({ activeMachine: carvera3 }))
    expect(html).not.toContain('data-testid="laguna-vacuum-allocator"')
  })

  it('omits the allocator panel when no machine is active', () => {
    const html = render(baseProps({ activeMachine: undefined }))
    expect(html).not.toContain('data-testid="laguna-vacuum-allocator"')
  })
})

describe('CamManufacturePanel — Feeds & Speeds Apply-to-op threading', () => {
  it('renders the Apply button when onApplyFeedsSpeedsToActiveOp is supplied', () => {
    const html = render(
      baseProps({ activeMachine: lagunaSwift, onApplyFeedsSpeedsToActiveOp: () => {} })
    )
    expect(html).toContain('data-testid="fs-apply-button"')
    expect(html).toContain('>Apply to op<')
  })

  it('omits the Apply button when no callback is supplied (advisory-only default)', () => {
    const html = render(baseProps({ activeMachine: lagunaSwift }))
    // The FeedsSpeedsCard still renders, just without the Apply affordance.
    expect(html).toContain('data-testid="feeds-speeds-card"')
    expect(html).not.toContain('data-testid="fs-apply-button"')
  })

  it('passes the active-op label into the apply hint', () => {
    const html = render(
      baseProps({
        activeMachine: lagunaSwift,
        onApplyFeedsSpeedsToActiveOp: () => {},
        activeOpLabel: 'Op 3 · Pocket'
      })
    )
    expect(html).toContain('Op 3 · Pocket')
  })
})
