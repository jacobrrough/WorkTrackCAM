/**
 * UX deep-dive move #5 — render-pin tests for `ProfileStack`.
 *
 * The ProfileStack is the right-side device/profile/send column that the
 * Manufacture workspace mounts next to the operation list. The component
 * is presentation-only; all state lives in the parent. These tests pin
 * the static HTML output so a future refactor cannot silently drop a
 * surface (mode toggle, filament row, quality dropdown, send button, etc.).
 *
 * Pattern matches `manufacture-aux-k2-send-render.test.tsx` —
 * `react-dom/server.renderToStaticMarkup` runs in the existing vitest
 * `node` environment without a jsdom dependency. Effects do NOT fire under
 * `renderToStaticMarkup`, which is why the `FilamentRow` carries a
 * `loaded` flag separate from `filaments.length` so the initial mount
 * renders the `FilamentPicker` instead of the empty state.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileStack, type ProfileStackProps } from './ProfileStack'
import type { MachineProfile } from '../../shared/machine-schema'
import type { AppSettings } from '../../shared/project-schema'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import type { ToolLibraryFile } from '../../shared/tool-schema'

// ── window.fab shim ─────────────────────────────────────────────────────────
// Same approach as `manufacture-aux-k2-send-render.test.tsx` —
// renderToStaticMarkup never invokes the `useEffect` that calls
// `window.fab.filamentsList()`, but the module still imports `window.fab`
// at load time. Provide a minimal stub so the import does not throw.
type FabStub = {
  filamentsList: () => Promise<unknown[]>
}
const fabStub: FabStub = {
  filamentsList: vi.fn().mockResolvedValue([])
}
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = fabStub
gAsRecord['window'] = globalThis

// ── Fixture machines ────────────────────────────────────────────────────────

const k2Plus: MachineProfile = {
  id: 'creality-k2-plus',
  name: 'Creality K2 Plus',
  kind: 'fdm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  maxFeedMmMin: 36000,
  axisCount: 3,
  dialect: 'generic_mm',
  postTemplate: 'fdm_passthrough.hbs',
  maxNozzleTempC: 350,
  maxBedTempC: 120,
  chamberTempC: 50
}

const lagunaSwift: MachineProfile = {
  id: 'laguna-swift-5x10',
  name: 'Laguna Swift 5x10',
  kind: 'cnc',
  workAreaMm: { x: 1524, y: 3048, z: 200 },
  maxFeedMmMin: 12000,
  axisCount: 3,
  dialect: 'mach3',
  postTemplate: 'vcarve_mach3.hbs',
  colletType: 'ER-20',
  maxSpindleRpm: 24000
}

const carvera3: MachineProfile = {
  id: 'makera-carvera',
  name: 'Makera Carvera',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 6000,
  axisCount: 3,
  dialect: 'smoothieware',
  postTemplate: 'carvera.hbs',
  atcSlotCount: 6,
  atcProbeSlot: 0,
  maxSpindleRpm: 15000
}

// ── Default-props builder ───────────────────────────────────────────────────

function makeProps(overrides: Partial<ProfileStackProps> = {}): ProfileStackProps {
  return {
    machineMode: 'fdm',
    machine: k2Plus,
    activeJob: null,
    settings: null,
    manufacture: null,
    tools: null,
    displayMode: 'recommended',
    onModeChange: vi.fn(),
    onSend: vi.fn(),
    onSaveSettingsField: vi.fn(),
    ...overrides
  }
}

function render(props: ProfileStackProps): string {
  return renderToStaticMarkup(createElement(ProfileStack, props))
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ProfileStack — Recommended mode (FDM)', () => {
  it('renders the root aside with the FDM machine-mode marker', () => {
    const html = render(makeProps({ machineMode: 'fdm', machine: k2Plus }))
    expect(html).toContain('data-testid="profile-stack"')
    expect(html).toContain('data-machine-mode="fdm"')
    expect(html).toContain('data-display-mode="recommended"')
  })

  it('renders the mode toggle pill with Recommended pressed', () => {
    const html = render(makeProps({ displayMode: 'recommended' }))
    expect(html).toContain('data-testid="profile-stack-mode-toggle"')
    expect(html).toMatch(
      /data-testid="profile-stack-mode-recommended"[^>]*aria-pressed="true"/,
    )
    expect(html).toMatch(
      /data-testid="profile-stack-mode-pro"[^>]*aria-pressed="false"/,
    )
  })

  it('renders the filament row (delegates to FilamentPicker on first mount)', () => {
    const html = render(makeProps({ machineMode: 'fdm', machine: k2Plus }))
    expect(html).toContain('data-testid="profile-stack-filament-row"')
    // Empty-state must NOT render on first mount — the `loaded` flag is
    // false until the IPC list call resolves.
    expect(html).not.toContain('data-testid="profile-stack-filament-empty"')
  })

  it('renders the K2 Plus quality dropdown with the default preset', () => {
    const html = render(makeProps({ machineMode: 'fdm', machine: k2Plus }))
    expect(html).toContain('data-testid="profile-stack-quality-row"')
    expect(html).toContain('data-testid="profile-stack-quality-select"')
    // Default preset id 'standard' must be the selected option.
    expect(html).toMatch(/<option[^>]*value="standard"[^>]*>/)
  })

  it('honors settings.k2QualityPresetId when the operator has picked high_speed', () => {
    const settings = {
      k2QualityPresetId: 'high_speed'
    } as unknown as AppSettings
    const html = render(
      makeProps({ machineMode: 'fdm', machine: k2Plus, settings })
    )
    // The <select> renders the selected value attribute on the element.
    expect(html).toMatch(
      /<select[^>]*data-testid="profile-stack-quality-select"[^>]*>/,
    )
    // The select carries `value="high_speed"` via React-DOM SSR.
    expect(html).toContain('high_speed')
  })

  it('hides the temps key-value row in Recommended mode (Pro-only content)', () => {
    const html = render(makeProps({ displayMode: 'recommended' }))
    expect(html).not.toContain('data-testid="profile-stack-temps-row"')
  })
})

describe('ProfileStack — Pro mode reveals extra rows', () => {
  it('reveals the temps row in Pro mode (FDM)', () => {
    const html = render(
      makeProps({
        machineMode: 'fdm',
        machine: k2Plus,
        displayMode: 'pro'
      })
    )
    expect(html).toContain('data-display-mode="pro"')
    expect(html).toContain('data-testid="profile-stack-temps-row"')
    expect(html).toContain('350') // maxNozzleTempC for K2 Plus
    expect(html).toContain('120') // maxBedTempC for K2 Plus
  })

  it('reveals the setup-sheet row in Pro mode (CNC)', () => {
    const html = render(
      makeProps({
        machineMode: 'cnc',
        machine: lagunaSwift,
        displayMode: 'pro'
      })
    )
    expect(html).toContain('data-testid="profile-stack-setup-sheet-row"')
    expect(html).toContain('No operations yet')
  })

  it('marks the Pro pill aria-pressed when displayMode is pro', () => {
    const html = render(makeProps({ displayMode: 'pro' }))
    expect(html).toMatch(
      /data-testid="profile-stack-mode-pro"[^>]*aria-pressed="true"/,
    )
    expect(html).toMatch(
      /data-testid="profile-stack-mode-recommended"[^>]*aria-pressed="false"/,
    )
  })
})

describe('ProfileStack — CNC dispatch (Laguna + Carvera)', () => {
  it('renders the stock summary row with Laguna work envelope + collet', () => {
    const html = render(
      makeProps({ machineMode: 'cnc', machine: lagunaSwift })
    )
    expect(html).toContain('data-testid="profile-stack-stock-row"')
    // 1524 x 3048 x 200 mm envelope
    expect(html).toContain('1524')
    expect(html).toContain('3048')
    expect(html).toContain('ER-20')
  })

  it('shows the tools empty state when no tool library is loaded', () => {
    const html = render(
      makeProps({ machineMode: 'cnc', machine: lagunaSwift, tools: null })
    )
    expect(html).toContain('data-testid="profile-stack-tools-empty"')
    expect(html).toContain('No tools yet')
  })

  it('renders tool chips when the active tool library has entries', () => {
    const tools: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 't1', name: '1/4 flat endmill', diameterMm: 6.35, type: 'flat' },
        { id: 't2', name: '1/8 ball nose', diameterMm: 3.175, type: 'ball' }
      ]
    } as unknown as ToolLibraryFile
    const html = render(
      makeProps({ machineMode: 'cnc', machine: carvera3, tools })
    )
    expect(html).toContain('data-testid="profile-stack-tool-row"')
    expect(html).toContain('data-testid="profile-stack-tool-chip-t1"')
    expect(html).toContain('data-testid="profile-stack-tool-chip-t2"')
    expect(html).toContain('1/4 flat endmill')
  })

  it('omits the FDM-only quality dropdown on CNC renders', () => {
    const html = render(
      makeProps({ machineMode: 'cnc', machine: lagunaSwift })
    )
    expect(html).not.toContain('data-testid="profile-stack-quality-row"')
    expect(html).not.toContain('data-testid="profile-stack-quality-select"')
  })
})

describe('ProfileStack — Send button gating + machine-specific labels', () => {
  it('renders the Send button enabled when onSend is a function (K2 Plus label)', () => {
    const onSend = vi.fn()
    const html = render(
      makeProps({ machineMode: 'fdm', machine: k2Plus, onSend })
    )
    expect(html).toContain('data-testid="profile-stack-send-button"')
    expect(html).toContain('Send to K2 Plus')
    // `aria-disabled="false"` IS expected; the literal `disabled` HTML
    // attribute (without the `aria-` prefix) MUST be absent.
    expect(html).toMatch(
      /data-testid="profile-stack-send-button"[^>]*aria-disabled="false"/,
    )
    expect(html).not.toMatch(
      /data-testid="profile-stack-send-button"[^>]*\sdisabled(?:>|=|\s)/,
    )
  })

  it('disables the Send button when onSend is null', () => {
    const html = render(
      makeProps({ machineMode: 'fdm', machine: k2Plus, onSend: null })
    )
    expect(html).toMatch(
      /data-testid="profile-stack-send-button"[^>]*\sdisabled(?:>|=|\s)/,
    )
    expect(html).toMatch(
      /data-testid="profile-stack-send-button"[^>]*aria-disabled="true"/,
    )
  })

  it('disables the Send button when onSend is undefined (parent not yet ready)', () => {
    const html = render(
      makeProps({
        machineMode: 'fdm',
        machine: k2Plus,
        onSend: undefined
      })
    )
    expect(html).toMatch(
      /data-testid="profile-stack-send-button"[^>]*\sdisabled(?:>|=|\s)/,
    )
  })

  it('uses the Carvera-specific label for the Makera Carvera', () => {
    const html = render(
      makeProps({ machineMode: 'cnc', machine: carvera3 })
    )
    expect(html).toContain('Send to Carvera')
    expect(html).not.toContain('Send to K2 Plus')
  })

  it('uses the Laguna-specific export label (no in-app push)', () => {
    const html = render(
      makeProps({ machineMode: 'cnc', machine: lagunaSwift })
    )
    expect(html).toContain('Export for Laguna')
    expect(html).not.toContain('Send to K2 Plus')
    expect(html).not.toContain('Send to Carvera')
  })

  it('falls back to a generic Send label when no machine is selected', () => {
    const html = render(
      makeProps({ machineMode: 'cnc', machine: null })
    )
    expect(html).toContain('Send to machine')
  })
})

describe('ProfileStack — empty + active-job surfaces', () => {
  it('renders the no-machine EmptyState when machine is null', () => {
    const html = render(makeProps({ machineMode: 'fdm', machine: null }))
    expect(html).toContain('data-testid="profile-stack-empty"')
    expect(html).toContain('No machine selected')
  })

  it('renders the active-job pill when activeJob is set', () => {
    const html = render(
      makeProps({ activeJob: { id: 'job-1', name: 'Bracket v3' } })
    )
    expect(html).toContain('data-testid="profile-stack-active-job"')
    expect(html).toContain('Bracket v3')
  })

  it('omits the active-job pill when activeJob is null', () => {
    const html = render(makeProps({ activeJob: null }))
    expect(html).not.toContain('data-testid="profile-stack-active-job"')
  })

  it('renders the setup-sheet row with op count in Pro mode (CNC + manufacture)', () => {
    const manufacture = {
      operations: [
        { id: 'op-1', kind: 'cnc_parallel', label: 'Roughing' },
        { id: 'op-2', kind: 'cnc_contour', label: 'Profile cut' }
      ]
    } as unknown as ManufactureFile
    const html = render(
      makeProps({
        machineMode: 'cnc',
        machine: lagunaSwift,
        displayMode: 'pro',
        manufacture
      })
    )
    expect(html).toContain('data-testid="profile-stack-setup-sheet-row"')
    expect(html).toContain('2 ops ready')
    expect(html).toMatch(
      /data-testid="profile-stack-setup-sheet-row"[^>]*data-status="ready"/,
    )
  })
})
