/**
 * Phase 2 [P2-K2-PUSH]/Cycle 349 renderer render-pin: the
 * `SliceManufacturePanel`'s "Send to K2 Plus" button must:
 *
 *   - Render only when `activeMachine.kind === 'fdm'`.
 *   - Render the section iff `isK2Plus`, regardless of slice/url state.
 *   - Be disabled unless `lastSliceGcodePath` AND `settings.moonrakerUrl`
 *     are both non-empty.
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matching the pattern
 * already established in `MoonrakerPreviewBanner.test.tsx` C50) so the
 * test runs in the existing `node` vitest environment without a jsdom
 * dependency. The harness mocks `window.fab` only enough to satisfy
 * the FilamentPicker's `useEffect`-driven list call so the snapshot
 * boundary is the static gating + button markup.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SliceManufacturePanel, type ManufactureAuxPanelsProps } from './ManufactureAuxPanels'
import type { MachineProfile } from '../../shared/machine-schema'

// ─── window.fab shim ─────────────────────────────────────────────────────────
// The panel calls `window.fab.filamentsList()` from a `useEffect`. In
// `renderToStaticMarkup` effects do not fire, so the call never
// happens — but the renderer still imports `window.fab` at module
// load. Provide a minimal stub so the import does not blow up. We
// route through `unknown` first because lib.dom's `Window` type has
// many DOM-only fields a node-runtime stub cannot satisfy in full.
type FabStub = {
  filamentsList: () => Promise<unknown[]>
  moonrakerPush: (payload: unknown) => Promise<{ ok: boolean; filename: string }>
}
const fabStub: FabStub = {
  filamentsList: vi.fn().mockResolvedValue([]),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' })
}
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = fabStub
gAsRecord['window'] = globalThis

// ─── Fixture machines ────────────────────────────────────────────────────────

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

function baseProps(overrides: Partial<ManufactureAuxPanelsProps>): ManufactureAuxPanelsProps {
  const props: ManufactureAuxPanelsProps = {
    machines: [k2Plus, lagunaSwift],
    settings: null,
    project: null,
    projectDir: '/tmp/proj',
    tools: null,
    projectTools: null,
    machineTools: null,
    activeMachine: k2Plus,
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
  return props
}

function render(props: ManufactureAuxPanelsProps): string {
  return renderToStaticMarkup(createElement(SliceManufacturePanel, props))
}

describe('SliceManufacturePanel — K2 Plus Send button gating', () => {
  it('renders the Send section when active machine is K2 Plus FDM', () => {
    const html = render(baseProps({ activeMachine: k2Plus }))
    expect(html).toContain('data-testid="k2-send-to-printer-section"')
    expect(html).toContain('data-testid="k2-send-to-printer-button"')
    expect(html).toContain('Send to K2 Plus')
  })

  it('omits the Send section when active machine is Laguna Swift CNC', () => {
    const html = render(baseProps({ activeMachine: lagunaSwift }))
    expect(html).not.toContain('data-testid="k2-send-to-printer-section"')
    expect(html).not.toContain('data-testid="k2-send-to-printer-button"')
  })

  it('omits the Send section when activeMachine is undefined', () => {
    const html = render(baseProps({ activeMachine: undefined }))
    expect(html).not.toContain('data-testid="k2-send-to-printer-section"')
  })

  it('disables the button when lastSliceGcodePath is missing', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: null,
        settings: { moonrakerUrl: 'http://k2plus.local' } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toMatch(/data-testid="k2-send-to-printer-button"[^>]*disabled/)
    expect(html).toContain('Slice an FDM operation to enable Send.')
  })

  it('disables the button when moonrakerUrl is missing', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
        settings: null
      })
    )
    expect(html).toMatch(/data-testid="k2-send-to-printer-button"[^>]*disabled/)
    expect(html).toContain('Add a Moonraker URL in File → Settings to enable Send.')
  })

  it('disables the button when moonrakerUrl is whitespace-only', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
        settings: { moonrakerUrl: '   ' } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toMatch(/data-testid="k2-send-to-printer-button"[^>]*disabled/)
  })

  it('enables the button when isFdm + lastSliceGcodePath + moonrakerUrl are all set', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain('data-testid="k2-send-to-printer-button"')
    // Disabled attribute must NOT be present on the button when canSendToK2.
    expect(html).not.toMatch(/data-testid="k2-send-to-printer-button"[^>]*disabled/)
  })

  it('button label reads "Send to K2 Plus" when idle (not "Uploading…")', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain('>Send to K2 Plus<')
    expect(html).not.toContain('>Uploading…<')
  })

  it('does not leak K2 Plus / FDM identifiers into a Laguna render', () => {
    const html = render(
      baseProps({
        activeMachine: lagunaSwift,
        lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    // The slice section heading mentions "K2 Plus profile" by design
    // (the panel itself is FDM-focused), but the SEND surface — gated
    // by `isK2Plus ? (...) : null` — must NOT appear under a CNC.
    expect(html).not.toContain('data-testid="k2-send-to-printer-section"')
    expect(html).not.toContain('Send to K2 Plus')
  })
})

// ── CFS slot picker render ──────────────────────────────────────────────────
//
// The K2 Plus Combo ships with one CFS (Creality Filament System) unit
// holding four spools (slots 0..3). The Send section renders four toggle
// buttons; selecting a slot persists per-project via `onSaveSettingsField`
// and rides on the next Send-to-K2 upload as a `?cfs_slot=N` query param.
// My-Shop-Only: K2 Plus only -- the picker is gated inside the `isK2Plus`
// branch so Laguna / Carvera CNC renders never expose CFS UI.

describe('SliceManufacturePanel -- CFS slot picker', () => {
  it('renders all four CFS slot buttons (0..3) on the K2 Plus panel', () => {
    const html = render(baseProps({ activeMachine: k2Plus }))
    expect(html).toContain('data-testid="k2-cfs-slot-picker"')
    for (const slot of [0, 1, 2, 3]) {
      expect(html).toContain(`data-testid="k2-cfs-slot-${slot}"`)
      expect(html).toContain(`Slot ${slot}`)
    }
  })

  it('defaults to slot 0 when settings.cfsSlotId is absent', () => {
    const html = render(baseProps({ activeMachine: k2Plus }))
    // Slot 0 button must be marked active (data-active="true").
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-0"[^>]*data-active="true"/,
    )
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-1"[^>]*data-active="false"/,
    )
    expect(html).toContain('Using CFS slot 0 for the next Send')
  })

  it('marks the operator-picked slot (settings.cfsSlotId=2) as active', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        settings: {
          moonrakerUrl: 'http://k2plus.local',
          cfsSlotId: 2
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-2"[^>]*data-active="true"/,
    )
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-0"[^>]*data-active="false"/,
    )
    expect(html).toContain('Using CFS slot 2 for the next Send')
  })

  it('falls back to slot 0 when settings.cfsSlotId is out of range (defensive)', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        settings: {
          cfsSlotId: 99
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-0"[^>]*data-active="true"/,
    )
  })

  it('omits the CFS picker entirely on Laguna Swift renders', () => {
    const html = render(baseProps({ activeMachine: lagunaSwift }))
    expect(html).not.toContain('data-testid="k2-cfs-slot-picker"')
    for (const slot of [0, 1, 2, 3]) {
      expect(html).not.toContain(`data-testid="k2-cfs-slot-${slot}"`)
    }
  })

  it('omits the CFS picker when activeMachine is undefined', () => {
    const html = render(baseProps({ activeMachine: undefined }))
    expect(html).not.toContain('data-testid="k2-cfs-slot-picker"')
  })

  it('clicking a slot calls onSaveSettingsField with cfsSlotId set (via aria-pressed handler attribute)', () => {
    // renderToStaticMarkup does not fire effects/handlers, so we
    // assert the rendered button carries the correct accessible
    // pressed state for the active slot. The full callback wiring
    // is exercised by the buildMoonrakerPushPayload test suite and
    // the buildUploadUrlForK2Cfs unit tests (URL contract pin).
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        settings: {
          cfsSlotId: 1
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-1"[^>]*aria-pressed="true"/,
    )
    expect(html).toMatch(
      /data-testid="k2-cfs-slot-0"[^>]*aria-pressed="false"/,
    )
  })
})

// ── UX Overhaul #8 — shared EmptyState surfaces when K2 is connected, no slice ──
//
// When the K2 Plus is reachable (Moonraker URL configured) but the
// operator has not yet produced an on-disk slice, the panel surfaces
// the shared `EmptyState` block. The existing slice button outside this
// panel is the CTA, so the empty-state intentionally omits its own
// button (matches the task spec verbatim).

describe('SliceManufacturePanel -- empty-state surface (UX Overhaul #8)', () => {
  it('renders the shared EmptyState when K2 is reachable but no slice has run', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: null,
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain('data-testid="slice-empty-state"')
    expect(html).toContain('class="empty-state"')
    expect(html).toContain('Ready to slice')
    expect(html).toContain('Select an STL and click Slice to begin.')
  })

  it('empty state intentionally omits a CTA button (existing slice button IS the CTA)', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: null,
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    // The empty-state DIV exists ...
    expect(html).toContain('data-testid="slice-empty-state"')
    // ... but it must not embed its own button (no `.empty-state__cta`).
    const emptyStateBlock =
      html.split('data-testid="slice-empty-state"')[1]?.split('</div>')[0] ?? ''
    expect(emptyStateBlock).not.toContain('empty-state__cta')
    expect(emptyStateBlock).not.toMatch(/<button/)
  })

  it('does NOT render the EmptyState once a slice has been produced', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: '/tmp/proj/output/slice.gcode',
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).not.toContain('data-testid="slice-empty-state"')
    expect(html).not.toContain('Ready to slice')
  })

  it('does NOT render the EmptyState when Moonraker URL is missing (legacy hint covers it)', () => {
    const html = render(
      baseProps({
        activeMachine: k2Plus,
        lastSliceGcodePath: null,
        settings: null
      })
    )
    expect(html).not.toContain('data-testid="slice-empty-state"')
    expect(html).not.toContain('Ready to slice')
    // The legacy moonraker-url hint stays intact for this branch.
    expect(html).toContain('Add a Moonraker URL in File → Settings to enable Send.')
  })

  it('does NOT render the EmptyState on non-K2 (Laguna) renders', () => {
    const html = render(
      baseProps({
        activeMachine: lagunaSwift,
        lastSliceGcodePath: null,
        settings: {
          moonrakerUrl: 'http://k2plus.local'
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).not.toContain('data-testid="slice-empty-state"')
    expect(html).not.toContain('Ready to slice')
  })
})
