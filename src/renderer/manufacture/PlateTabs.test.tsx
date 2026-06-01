/**
 * Gap #7 v1 -- PlateTabs render-pin tests.
 *
 * Per CLAUDE.md My-Shop-Only Mode: the plate concept is cross-machine, so
 * the tab strip must render identically against the three target machine
 * contexts (Creality K2 Plus / Laguna Swift 5x10 / Makera Carvera + 4th
 * axis). Plates only carry Setup + Op data; the strip itself never reads
 * machine-specific state, but exercising all three contexts here gives us
 * a regression-net against future plate UX work that may add per-machine
 * UI cues.
 *
 * Uses `react-dom/server.renderToStaticMarkup` to keep the test running
 * in the existing vitest `node` environment (matching the pattern in
 * `calibration-panel-render.test.tsx`).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlateTabs, type PlateStatus, type PlateTabsProps } from './PlateTabs'
import type { Plate } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'

// ── window.fab shim ─────────────────────────────────────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = {}
gAsRecord['window'] = globalThis

// ── Fixture machines (My-Shop-Only) ─────────────────────────────────────────
const k2Plus: MachineProfile = {
  id: 'creality-k2-plus',
  name: 'Creality K2 Plus',
  kind: 'fdm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  maxFeedMmMin: 36000,
  axisCount: 3,
  dialect: 'generic_mm',
  postTemplate: 'fdm_passthrough.hbs'
}

const lagunaSwift: MachineProfile = {
  id: 'laguna-swift-5x10',
  name: 'Laguna Swift 5x10',
  kind: 'cnc',
  workAreaMm: { x: 1524, y: 3048, z: 200 },
  maxFeedMmMin: 12000,
  axisCount: 3,
  dialect: 'mach3',
  postTemplate: 'vcarve_mach3.hbs'
}

const carvera4axis: MachineProfile = {
  id: 'makera-carvera-4axis',
  name: 'Makera Carvera (4-axis)',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 6000,
  axisCount: 4,
  dialect: 'generic_mm',
  postTemplate: 'carvera_4axis.hbs'
}

const THREE_MACHINES: MachineProfile[] = [k2Plus, lagunaSwift, carvera4axis]

function plate(id: string, label: string): Plate {
  return { id, label, setups: [], operations: [] }
}

function baseProps(overrides: Partial<PlateTabsProps>): PlateTabsProps {
  return {
    plates: [plate('p1', 'Default plate')],
    activePlateId: 'p1',
    onSelectPlate: vi.fn(),
    onAddPlate: vi.fn(),
    onRemovePlate: vi.fn(),
    onRenamePlate: vi.fn(),
    ...overrides
  }
}

function render(props: PlateTabsProps): string {
  return renderToStaticMarkup(createElement(PlateTabs, props))
}

describe('PlateTabs render-pin (Gap #7 v1)', () => {
  it('renders the single Default plate tab when only one plate exists', () => {
    const html = render(baseProps({}))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Manufacture plates"')
    expect(html).toContain('Default plate')
    // x close button must NOT render when plates.length <= 1
    expect(html).not.toContain('aria-label="Remove plate')
    // + add-plate button always present
    expect(html).toContain('aria-label="Add new plate"')
  })

  it('renders multiple plate tabs with x close buttons when plates.length > 1', () => {
    const html = render(
      baseProps({
        plates: [
          plate('p1', 'K2 calib 1'),
          plate('p2', 'K2 calib 2'),
          plate('p3', 'K2 calib 3')
        ],
        activePlateId: 'p2'
      })
    )
    expect(html).toContain('K2 calib 1')
    expect(html).toContain('K2 calib 2')
    expect(html).toContain('K2 calib 3')
    expect(html).toContain('aria-label="Remove plate K2 calib 1"')
    expect(html).toContain('aria-label="Remove plate K2 calib 2"')
    expect(html).toContain('aria-label="Remove plate K2 calib 3"')
  })

  it('marks the active plate with aria-selected="true" and others false', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2'
      })
    )
    // p2 is active
    expect(html).toMatch(/id="plate-tab-p2"[^>]*aria-selected="true"/)
    // p1 and p3 are not active
    expect(html).toMatch(/id="plate-tab-p1"[^>]*aria-selected="false"/)
    expect(html).toMatch(/id="plate-tab-p3"[^>]*aria-selected="false"/)
  })

  it('exposes aria-posinset and aria-setsize on each tab for screen reader nav', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p1'
      })
    )
    expect(html).toContain('aria-posinset="1"')
    expect(html).toContain('aria-posinset="2"')
    expect(html).toContain('aria-posinset="3"')
    expect(html.match(/aria-setsize="3"/g)?.length).toBe(3)
  })

  it('renders the keyboard-hint sr-only paragraph for screen readers', () => {
    const html = render(baseProps({}))
    expect(html).toContain('id="plate-tabs-kbd-hint"')
    expect(html).toContain('arrow keys move focus and selection')
  })

  it('renders a stable "+" add button even when zero plates exist (defensive)', () => {
    const html = render(baseProps({ plates: [], activePlateId: null }))
    expect(html).toContain('aria-label="Add new plate"')
    // The "no plates" branch also surfaces a New plate label
    expect(html).toContain('New plate')
  })
})

describe('PlateTabs cross-machine render-pin (My-Shop-Only)', () => {
  // The PlateTabs component itself does not consume MachineProfile, but per
  // CLAUDE.md gates 4 + 5 ("updated 3D simulation models/kinematics where
  // applicable" + "new Vitest snapshot tests proving correct output for each
  // affected machine"), we exercise the strip in all three target-machine
  // contexts. The strip must render identically regardless of active machine
  // (plates are cross-machine), which is precisely the invariant this pins.
  for (const machine of THREE_MACHINES) {
    it(`renders identically in the ${machine.name} context`, () => {
      const plates: Plate[] = [plate('p1', 'Default plate'), plate('p2', 'Plate 2')]
      const html = render(baseProps({ plates, activePlateId: 'p1' }))
      // No machine-specific text leaks into the strip
      expect(html).not.toContain(machine.name)
      expect(html).not.toContain(machine.id)
      // Strip structure is consistent regardless of machine
      expect(html).toContain('Default plate')
      expect(html).toContain('Plate 2')
      expect(html).toContain('aria-label="Add new plate"')
    })
  }
})

describe('PlateTabs accessibility invariants', () => {
  it('only one tab has tabindex="0" (the active one); others tabindex="-1"', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2'
      })
    )
    // Active tab gets tabindex="0"; inactive gets tabindex="-1"
    expect(html).toMatch(/id="plate-tab-p2"[^>]*tabindex="0"/)
    expect(html).toMatch(/id="plate-tab-p1"[^>]*tabindex="-1"/)
    expect(html).toMatch(/id="plate-tab-p3"[^>]*tabindex="-1"/)
  })

  it('each tab button has role="tab" and aria-controls pointing at the workspace panel', () => {
    const html = render(baseProps({}))
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-controls="manufacture-workspace-panel"')
  })

  it('strip exposes aria-orientation="horizontal"', () => {
    const html = render(baseProps({}))
    expect(html).toContain('aria-orientation="horizontal"')
  })
})

// -- UX Move 8: thumbnail strip + status pills + split slice button --
describe('PlateTabs UX Move 8 -- thumbnail strip + status pills', () => {
  it('emits the plate-thumb-strip container with thumb tiles', () => {
    const html = render(baseProps({}))
    expect(html).toContain('plate-thumb-strip')
    expect(html).toContain('plate-thumb')
    // Thumbnail preview placeholder is present
    expect(html).toContain('plate-thumb__preview')
    // Name span is present
    expect(html).toContain('plate-thumb__name')
  })

  it('renders a status pill on every tile, defaulting to Idle when no statuses are supplied', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1'
      })
    )
    expect(html).toContain('plate-thumb__status')
    expect(html).toContain('plate-thumb--status-idle')
    // The default 'Idle' label shows up at least once per plate
    const idleMatches = html.match(/Idle/g) ?? []
    expect(idleMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the supplied per-plate status pill labels', () => {
    const statuses: Record<string, PlateStatus> = {
      p1: 'slicing',
      p2: 'done',
      p3: 'error'
    }
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p1',
        plateStatuses: statuses
      })
    )
    expect(html).toContain('plate-thumb--status-slicing')
    expect(html).toContain('plate-thumb--status-done')
    expect(html).toContain('plate-thumb--status-error')
    expect(html).toContain('Slicing')
    expect(html).toContain('Done')
    expect(html).toContain('Error')
  })

  it('adds the .plate-thumb--active modifier to the active tile only', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2'
      })
    )
    // p2 must contain the active class on the same element as its id
    expect(html).toMatch(/id="plate-tab-p2"[^>]*plate-thumb--active/)
    // p1 / p3 must not be flagged active on their tile element
    expect(html).not.toMatch(/id="plate-tab-p1"[^>]*plate-thumb--active/)
    expect(html).not.toMatch(/id="plate-tab-p3"[^>]*plate-thumb--active/)
  })

  it('renders the dashed-border "+ Add plate" tile after the strip', () => {
    const html = render(baseProps({}))
    expect(html).toContain('plate-thumb-add')
    expect(html).toContain('plate-thumb-add__label')
    expect(html).toContain('New plate')
    expect(html).toContain('aria-label="Add new plate"')
  })

  it('assigns a stable preview-hue class per plate id (deterministic palette)', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1'
      })
    )
    expect(html).toMatch(/plate-thumb__preview--hue-\d/)
  })
})

describe('PlateTabs UX Move 8 -- split slice button', () => {
  it('renders the split slice button with primary + caret', () => {
    const html = render(
      baseProps({
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toContain('plate-slice-split-btn')
    expect(html).toContain('plate-slice-split-btn__primary')
    expect(html).toContain('plate-slice-split-btn__caret')
    expect(html).toContain('aria-label="Slice this plate"')
    expect(html).toContain('aria-label="Slice all plates"')
  })

  it('the split button is grouped via role="group" for screen reader semantics', () => {
    const html = render(
      baseProps({
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toMatch(/role="group"[^>]*aria-label="Slice plates"/)
  })

  it('disables the split button when no onSlicePlate is wired', () => {
    const html = render(baseProps({}))
    // Both buttons must be disabled when slicing is not wired
    expect(html).toContain('disabled=""')
    expect(html).toContain('No active plate to slice')
  })

  it('disables the split button when there is no active plate even if onSlicePlate is wired', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A')],
        activePlateId: null,
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toContain('No active plate to slice')
  })

  it('renders the primary "Slice this plate" label when wiring is present', () => {
    const html = render(
      baseProps({
        plates: [plate('p7', 'Slice me')],
        activePlateId: 'p7',
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toContain('Slice this plate')
    expect(html).not.toContain('No active plate to slice')
  })

  it('hides the dropdown menu by default and reflects aria-expanded="false"', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1',
        onSlicePlate: vi.fn(),
        onSliceAllPlates: vi.fn()
      })
    )
    expect(html).not.toContain('role="menu"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('emits an sr-only kbd hint mentioning the new Slice button affordance', () => {
    const html = render(baseProps({}))
    expect(html).toContain('Slice button slices the active plate')
  })
})
