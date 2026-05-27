/**
 * Gap #4 renderer render-pin: the K2 Plus CalibrationPanel must:
 *
 *   - Render only the K2-Plus-gated "Calibrate" surface when active
 *     machine is the Creality K2 Plus.
 *   - Render an explanatory placeholder (NOT the calibration cards)
 *     when the active machine is a CNC (Laguna / Carvera).
 *   - Render a "open a project" placeholder when no projectDir is open
 *     (even if K2 Plus is active).
 *   - Render all three cards (temperature tower / flow rate / pressure
 *     advance) when K2 Plus + projectDir are both set.
 *   - Disable each card's "Send to K2 Plus" button until the test has
 *     been generated AND a Moonraker URL is set in app settings.
 *
 * Uses `react-dom/server.renderToStaticMarkup` (matching the pattern in
 * `manufacture-aux-k2-send-render.test.tsx`) so the test runs in the
 * existing `node` vitest environment without a jsdom dependency.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CalibrationPanel, calibrationOutputPath, type CalibrationPanelProps } from './CalibrationPanel'
import type { MachineProfile } from '../../shared/machine-schema'

// ── window.fab shim ─────────────────────────────────────────────────────────
type FabStub = {
  calibrationGenerate: (payload: unknown) => Promise<unknown>
  moonrakerPush: (payload: unknown) => Promise<{ ok: boolean; filename: string }>
}
const fabStub: FabStub = {
  calibrationGenerate: vi.fn().mockResolvedValue({ ok: true, outputGcodePath: '/tmp/out.gcode', description: 'stub', args: [] }),
  moonrakerPush: vi.fn().mockResolvedValue({ ok: true, filename: 'noop.gcode' })
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

function baseProps(overrides: Partial<CalibrationPanelProps>): CalibrationPanelProps {
  const props: CalibrationPanelProps = {
    activeMachine: k2Plus,
    settings: null,
    projectDir: '/tmp/proj',
    ...overrides
  }
  return props
}

function render(props: CalibrationPanelProps): string {
  return renderToStaticMarkup(createElement(CalibrationPanel, props))
}

describe('CalibrationPanel — K2 Plus gating', () => {
  it('renders the calibration panel when active machine is K2 Plus + projectDir is open', () => {
    const html = render(baseProps({}))
    expect(html).toContain('data-testid="calibration-panel"')
    expect(html).toContain('data-testid="calibration-card-temperature-tower"')
    expect(html).toContain('data-testid="calibration-card-flow-rate"')
    expect(html).toContain('data-testid="calibration-card-pressure-advance"')
  })

  it('renders all five Gap #4-ext cards (retraction / max-vol-flow / tolerance / cornering / vfa)', () => {
    const html = render(baseProps({}))
    expect(html).toContain('data-testid="calibration-card-retraction-tower"')
    expect(html).toContain('data-testid="calibration-card-max-volumetric-flow"')
    expect(html).toContain('data-testid="calibration-card-tolerance"')
    expect(html).toContain('data-testid="calibration-card-cornering"')
    expect(html).toContain('data-testid="calibration-card-vfa"')
  })

  it('renders a "K2 Plus only" placeholder when active machine is a CNC', () => {
    const html = render(baseProps({ activeMachine: lagunaSwift }))
    expect(html).not.toContain('data-testid="calibration-panel"')
    expect(html).not.toContain('data-testid="calibration-card-temperature-tower"')
    expect(html).toContain('K2 Plus only')
  })

  it('renders a "no project" placeholder when projectDir is null', () => {
    const html = render(baseProps({ projectDir: null }))
    expect(html).not.toContain('data-testid="calibration-panel"')
    expect(html).not.toContain('data-testid="calibration-card-temperature-tower"')
    expect(html).toContain('Open a project')
  })

  it('renders all eight Generate buttons enabled by default', () => {
    const html = render(baseProps({}))
    for (const id of [
      'cal-tower-generate',
      'cal-flow-generate',
      'cal-pa-generate',
      'cal-ret-generate',
      'cal-mvf-generate',
      'cal-tol-generate',
      'cal-scv-generate',
      'cal-vfa-generate'
    ]) {
      // Disabled attribute must NOT be present on the Generate buttons (idle state)
      expect(html).toMatch(new RegExp(`data-testid="${id}"(?![^>]*disabled)`))
    }
  })

  it('disables all eight Send buttons when no Moonraker URL is set', () => {
    const html = render(baseProps({ settings: null }))
    for (const id of [
      'cal-tower-send',
      'cal-flow-send',
      'cal-pa-send',
      'cal-ret-send',
      'cal-mvf-send',
      'cal-tol-send',
      'cal-scv-send',
      'cal-vfa-send'
    ]) {
      expect(html).toMatch(new RegExp(`data-testid="${id}"[^>]*disabled`))
    }
    expect(html).toContain('Add a Moonraker URL')
  })

  it('disables all eight Send buttons when Moonraker URL set but nothing generated yet', () => {
    const html = render(
      baseProps({ settings: { moonrakerUrl: 'http://k2plus.local' } as CalibrationPanelProps['settings'] })
    )
    for (const id of [
      'cal-tower-send',
      'cal-flow-send',
      'cal-pa-send',
      'cal-ret-send',
      'cal-mvf-send',
      'cal-tol-send',
      'cal-scv-send',
      'cal-vfa-send'
    ]) {
      expect(html).toMatch(new RegExp(`data-testid="${id}"[^>]*disabled`))
    }
    // The "Add a Moonraker URL" hint should NOT appear when URL is set.
    expect(html).not.toContain('Add a Moonraker URL')
  })

  it('default form values match the builder defaults', () => {
    const html = render(baseProps({}))
    // Temperature tower defaults
    expect(html).toMatch(/data-testid="cal-tower-start"[^>]*value="190"/)
    expect(html).toMatch(/data-testid="cal-tower-end"[^>]*value="220"/)
    expect(html).toMatch(/data-testid="cal-tower-step"[^>]*value="5"/)
    expect(html).toMatch(/data-testid="cal-tower-bed"[^>]*value="60"/)
    // Flow rate defaults
    expect(html).toMatch(/data-testid="cal-flow-cube"[^>]*value="30"/)
    expect(html).toMatch(/data-testid="cal-flow-height"[^>]*value="8"/)
    expect(html).toMatch(/data-testid="cal-flow-walls"[^>]*value="1"/)
    expect(html).toMatch(/data-testid="cal-flow-nozzle"[^>]*value="215"/)
    // Pressure advance defaults
    expect(html).toMatch(/data-testid="cal-pa-start"[^>]*value="0\.000"/)
    expect(html).toMatch(/data-testid="cal-pa-end"[^>]*value="0\.060"/)
    expect(html).toMatch(/data-testid="cal-pa-step"[^>]*value="0\.010"/)
    expect(html).toMatch(/data-testid="cal-pa-line-len"[^>]*value="60"/)
  })

  it('default form values for the Gap #4-ext cards match the builder defaults', () => {
    const html = render(baseProps({}))
    // Retraction tower
    expect(html).toMatch(/data-testid="cal-ret-start"[^>]*value="0\.0"/)
    expect(html).toMatch(/data-testid="cal-ret-end"[^>]*value="2\.0"/)
    expect(html).toMatch(/data-testid="cal-ret-step"[^>]*value="0\.2"/)
    expect(html).toMatch(/data-testid="cal-ret-speed"[^>]*value="40"/)
    // Max volumetric flow
    expect(html).toMatch(/data-testid="cal-mvf-start"[^>]*value="5"/)
    expect(html).toMatch(/data-testid="cal-mvf-end"[^>]*value="30"/)
    expect(html).toMatch(/data-testid="cal-mvf-step"[^>]*value="2"/)
    expect(html).toMatch(/data-testid="cal-mvf-density"[^>]*value="1\.24"/)
    // Tolerance
    expect(html).toMatch(/data-testid="cal-tol-cube"[^>]*value="20"/)
    expect(html).toMatch(/data-testid="cal-tol-pairs"[^>]*value="4"/)
    expect(html).toMatch(/data-testid="cal-tol-hole"[^>]*value="4"/)
    expect(html).toMatch(/data-testid="cal-tol-clearance"[^>]*value="0\.1"/)
    // Cornering / SCV
    expect(html).toMatch(/data-testid="cal-scv-start"[^>]*value="4"/)
    expect(html).toMatch(/data-testid="cal-scv-end"[^>]*value="9"/)
    expect(html).toMatch(/data-testid="cal-scv-step"[^>]*value="1"/)
    expect(html).toMatch(/data-testid="cal-scv-square"[^>]*value="40"/)
    expect(html).toMatch(/data-testid="cal-scv-speed"[^>]*value="150"/)
    // VFA
    expect(html).toMatch(/data-testid="cal-vfa-dia"[^>]*value="30"/)
    expect(html).toMatch(/data-testid="cal-vfa-height"[^>]*value="50"/)
    expect(html).toMatch(/data-testid="cal-vfa-speed"[^>]*value="60"/)
  })
})

describe('calibrationOutputPath — pure helper', () => {
  it('uses POSIX separators when projectDir contains forward slashes', () => {
    expect(calibrationOutputPath('/home/jrrou/myproj', 'temperature-tower')).toBe(
      '/home/jrrou/myproj/output/calibration/k2-temp-tower.gcode'
    )
    expect(calibrationOutputPath('/home/jrrou/myproj', 'flow-rate')).toBe(
      '/home/jrrou/myproj/output/calibration/k2-flow-rate.gcode'
    )
    expect(calibrationOutputPath('/home/jrrou/myproj', 'pressure-advance')).toBe(
      '/home/jrrou/myproj/output/calibration/k2-pressure-advance.gcode'
    )
  })

  it('uses Windows separators when projectDir contains backslashes', () => {
    expect(
      calibrationOutputPath('C:\\Users\\jrrou\\projects\\foo', 'temperature-tower')
    ).toBe('C:\\Users\\jrrou\\projects\\foo\\output\\calibration\\k2-temp-tower.gcode')
  })

  it('routes the five Gap #4-ext kinds to distinct filenames', () => {
    expect(calibrationOutputPath('/p', 'retraction-tower')).toBe('/p/output/calibration/k2-retraction-tower.gcode')
    expect(calibrationOutputPath('/p', 'max-volumetric-flow')).toBe('/p/output/calibration/k2-max-vol-flow.gcode')
    expect(calibrationOutputPath('/p', 'tolerance')).toBe('/p/output/calibration/k2-tolerance.gcode')
    expect(calibrationOutputPath('/p', 'cornering')).toBe('/p/output/calibration/k2-cornering.gcode')
    expect(calibrationOutputPath('/p', 'vfa')).toBe('/p/output/calibration/k2-vfa.gcode')
  })
})
