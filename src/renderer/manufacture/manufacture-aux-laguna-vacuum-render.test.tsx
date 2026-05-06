/**
 * Phase 2 [P2-LAGUNA-FULLSHEET]/Cycle 350 renderer render-pin: the
 * `CamManufacturePanel`'s 6-zone vacuum table picker must:
 *
 *   - Render only when the active machine ID/name matches /laguna/i
 *     (i.e. the active machine is the Laguna Swift 5x10).
 *   - Render exactly six toggle chips (Zone 1..6), each with a stable
 *     `data-testid="laguna-vacuum-zone-<n>"` and `aria-pressed`
 *     reflecting whether the zone is currently engaged.
 *   - Treat absent `appSettings.lagunaActiveZones` as "all six engaged"
 *     at read-time (the schema field is `.optional()` so the inferred
 *     `AppSettings` type stays `number[] | undefined`; the UI applies
 *     the [1..6] default itself).
 *   - Disengage a chip on click via `onSaveSettingsField` with the
 *     remaining zones (sorted ascending).
 *
 * Pairs the C346 backend integration test
 * (`post-process-laguna-fullsheet-integration.test.ts`) per the
 * UI/UX equality directive: every Phase 2 backend capability must
 * land a paired renderer surface in the same workspace tab.
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matching the
 * pattern in `manufacture-aux-k2-send-render.test.tsx` C349) so
 * the test runs under the existing `node` vitest environment with
 * no jsdom dependency. Toggle semantics are exercised via the pure
 * `computeNextLagunaActiveZones` helper because the panel uses hooks
 * and cannot be invoked directly outside a React render.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CamManufacturePanel,
  computeNextLagunaActiveZones,
  type ManufactureAuxPanelsProps
} from './ManufactureAuxPanels'
import type { MachineProfile } from '../../shared/machine-schema'

// ─── window.fab shim (same surface as the K2 send-render test) ───────
;(globalThis as { window?: typeof globalThis }).window = globalThis as typeof globalThis
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).window.fab = {
  filamentsList: vi.fn().mockResolvedValue([]),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' }),
  carveraUpload: vi
    .fn()
    .mockResolvedValue({ ok: true, filename: 'noop.nc' })
}

// ─── Fixture machines ────────────────────────────────────────────────

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

const carvera3Axis: MachineProfile = {
  id: 'makera-carvera-3axis',
  name: 'Makera Carvera 3-Axis',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 6000,
  axisCount: 3,
  dialect: 'smoothieware',
  postTemplate: 'carvera_3axis.hbs',
  atcSlotCount: 6,
  atcProbeSlot: 0
}

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

function baseProps(
  overrides: Partial<ManufactureAuxPanelsProps>
): ManufactureAuxPanelsProps {
  const props: ManufactureAuxPanelsProps = {
    machines: [k2Plus, lagunaSwift, carvera3Axis],
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
  return props
}

function renderHtml(props: ManufactureAuxPanelsProps): string {
  return renderToStaticMarkup(createElement(CamManufacturePanel, props))
}

describe('CamManufacturePanel — Laguna 6-zone vacuum picker gating', () => {
  it('renders the picker when active machine is Laguna Swift', () => {
    const html = renderHtml(baseProps({ activeMachine: lagunaSwift }))
    expect(html).toContain('data-testid="laguna-vacuum-zone-picker"')
    expect(html).toContain('Laguna 6-Zone Vacuum Table')
  })

  it('renders all six zone chips with stable testids', () => {
    const html = renderHtml(baseProps({ activeMachine: lagunaSwift }))
    for (const z of [1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`data-testid="laguna-vacuum-zone-${z}"`)
    }
  })

  it('omits the picker when active machine is the Makera Carvera', () => {
    const html = renderHtml(baseProps({ activeMachine: carvera3Axis }))
    expect(html).not.toContain('data-testid="laguna-vacuum-zone-picker"')
    expect(html).not.toContain('Laguna 6-Zone Vacuum Table')
    for (const z of [1, 2, 3, 4, 5, 6]) {
      expect(html).not.toContain(`data-testid="laguna-vacuum-zone-${z}"`)
    }
  })

  it('omits the picker when active machine is the K2 Plus FDM', () => {
    const html = renderHtml(baseProps({ activeMachine: k2Plus }))
    expect(html).not.toContain('data-testid="laguna-vacuum-zone-picker"')
  })

  it('omits the picker when activeMachine is undefined', () => {
    const html = renderHtml(baseProps({ activeMachine: undefined }))
    expect(html).not.toContain('data-testid="laguna-vacuum-zone-picker"')
  })

  it('treats absent appSettings.lagunaActiveZones as "all six engaged" (read-time default)', () => {
    const html = renderHtml(
      baseProps({
        activeMachine: lagunaSwift,
        settings: {} as ManufactureAuxPanelsProps['settings']
      })
    )
    // All six chips should be aria-pressed="true" when no setting is set.
    for (const z of [1, 2, 3, 4, 5, 6]) {
      expect(html).toMatch(
        new RegExp(`data-testid="laguna-vacuum-zone-${z}"[^>]*data-active="true"`)
      )
      expect(html).toMatch(
        new RegExp(`data-testid="laguna-vacuum-zone-${z}"[^>]*aria-pressed="true"`)
      )
    }
    expect(html).toContain('6 of 6 zones engaged: 1, 2, 3, 4, 5, 6.')
  })

  it('reflects a custom lagunaActiveZones subset on the chips', () => {
    const html = renderHtml(
      baseProps({
        activeMachine: lagunaSwift,
        settings: { lagunaActiveZones: [1, 3, 5] } as ManufactureAuxPanelsProps['settings']
      })
    )
    // Engaged: 1, 3, 5 → aria-pressed="true" + data-active="true"
    for (const z of [1, 3, 5]) {
      expect(html).toMatch(
        new RegExp(`data-testid="laguna-vacuum-zone-${z}"[^>]*data-active="true"`)
      )
    }
    // Disengaged: 2, 4, 6 → aria-pressed="false" + data-active="false"
    for (const z of [2, 4, 6]) {
      expect(html).toMatch(
        new RegExp(`data-testid="laguna-vacuum-zone-${z}"[^>]*data-active="false"`)
      )
    }
    expect(html).toContain('3 of 6 zones engaged: 1, 3, 5.')
  })

  it('renders the empty-zones helper text when lagunaActiveZones is []', () => {
    const html = renderHtml(
      baseProps({
        activeMachine: lagunaSwift,
        settings: {
          lagunaActiveZones: [] as number[]
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain(
      'No zones engaged — at least one zone is recommended for hold-down.'
    )
  })

  it('does not leak Laguna identifiers into a Carvera render', () => {
    const html = renderHtml(baseProps({ activeMachine: carvera3Axis }))
    expect(html).not.toContain('Laguna 6-Zone Vacuum Table')
    expect(html).not.toContain('M8 P&lt;n&gt;')
    expect(html).not.toContain('data-testid="laguna-vacuum-zone-picker"')
  })
})

// ---------------------------------------------------------------------------
// Cycle 352 [P2-LAGUNA-FULLSHEET] persistence-to-G-code preview badge
// ---------------------------------------------------------------------------

/**
 * The picker now drives emitted G-code through the postlude's
 * `activeZones` option (Cycle 352 in laguna-vacuum-postlude.ts). The
 * paired "Active in next post" badge tells the operator how many M64/M65
 * lines the current selection will produce so the picker can be verified
 * before posting -- the count scales with `lagunaActiveZones.length`.
 *
 * 3-clicks-from-launch acceptance: My Shop -> Laguna preset ->
 * Manufacture/CAM (vacuum picker + preview badge visible).
 */
describe('CamManufacturePanel — Laguna 6-zone vacuum picker post preview badge', () => {
  it('renders the preview badge with stable testid only when machine is Laguna', () => {
    const lagunaHtml = renderHtml(baseProps({ activeMachine: lagunaSwift }))
    expect(lagunaHtml).toContain('data-testid="laguna-vacuum-zone-preview"')
    const carveraHtml = renderHtml(baseProps({ activeMachine: carvera3Axis }))
    expect(carveraHtml).not.toContain('data-testid="laguna-vacuum-zone-preview"')
    const k2Html = renderHtml(baseProps({ activeMachine: k2Plus }))
    expect(k2Html).not.toContain('data-testid="laguna-vacuum-zone-preview"')
  })

  it('default selection (all 6) produces 6 M64 + 6 M65 lines (12 total)', () => {
    const html = renderHtml(
      baseProps({
        activeMachine: lagunaSwift,
        settings: {} as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain('6 M64 line(s)')
    expect(html).toContain('6 M65 line(s)')
    expect(html).toContain('(12 total)')
  })

  it('subset [1, 3, 5] produces 3 M64 + 3 M65 lines (6 total)', () => {
    const html = renderHtml(
      baseProps({
        activeMachine: lagunaSwift,
        settings: { lagunaActiveZones: [1, 3, 5] } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain('3 M64 line(s)')
    expect(html).toContain('3 M65 line(s)')
    expect(html).toContain('(6 total)')
  })

  it('empty [] produces the no-zones-picked sentinel', () => {
    const html = renderHtml(
      baseProps({
        activeMachine: lagunaSwift,
        settings: {
          lagunaActiveZones: [] as number[]
        } as ManufactureAuxPanelsProps['settings']
      })
    )
    expect(html).toContain('0 M64/M65 lines (no zones picked)')
    expect(html).not.toContain('M64 line(s)')
  })

  it('mentions the Mach3 digital outputs gate so the operator knows it is opt-in', () => {
    const html = renderHtml(baseProps({ activeMachine: lagunaSwift }))
    expect(html).toMatch(/Mach3 digital outputs/)
  })

  it('preview badge count scales 1:1 with picker selection size', () => {
    // 1 zone -> 1+1=2 total. 2 zones -> 2+2=4. 4 zones -> 4+4=8.
    for (const [pick, m, total] of [
      [[2], 1, 2],
      [[1, 6], 2, 4],
      [[1, 2, 5, 6], 4, 8]
    ] as const) {
      const html = renderHtml(
        baseProps({
          activeMachine: lagunaSwift,
          settings: {
            lagunaActiveZones: [...pick]
          } as ManufactureAuxPanelsProps['settings']
        })
      )
      expect(html).toContain(`${m} M64 line(s)`)
      expect(html).toContain(`${m} M65 line(s)`)
      expect(html).toContain(`(${total} total)`)
    }
  })
})

describe('computeNextLagunaActiveZones — toggle semantics', () => {
  // Pure helper consumed by the panel's onClick. Verifying it directly
  // mirrors the render-pin pattern but avoids React's render lifecycle
  // (the panel uses hooks; calling it outside react-dom blows up). The
  // panel passes the helper's output through onSaveSettingsField so
  // these assertions are equivalent to "what would land in storage on
  // click".
  it('removes a zone that is currently engaged (sorted result)', () => {
    expect(computeNextLagunaActiveZones([1, 2, 3, 4, 5, 6], 3)).toEqual([
      1, 2, 4, 5, 6
    ])
  })

  it('adds a zone that is currently disengaged (sorted result)', () => {
    expect(computeNextLagunaActiveZones([1, 3, 5], 2)).toEqual([1, 2, 3, 5])
  })

  it('adds a zone to an empty selection', () => {
    expect(computeNextLagunaActiveZones([], 6)).toEqual([6])
  })

  it('removes the only engaged zone leaving an empty selection', () => {
    expect(computeNextLagunaActiveZones([4], 4)).toEqual([])
  })

  it('always returns a sorted ascending array (insert into middle)', () => {
    expect(computeNextLagunaActiveZones([1, 6], 3)).toEqual([1, 3, 6])
  })

  it('idempotently dedupes when the input has duplicate zones', () => {
    // Defensive: even if a caller hands us a malformed array with
    // duplicate zone numbers, the Set-backed toggle should always
    // emit a properly deduped, sorted array.
    expect(computeNextLagunaActiveZones([2, 2, 4], 5)).toEqual([2, 4, 5])
  })

  it('does not mutate the input array', () => {
    const input: readonly number[] = [1, 2, 3]
    const before = [...input]
    void computeNextLagunaActiveZones(input, 5)
    expect([...input]).toEqual(before)
  })
})
