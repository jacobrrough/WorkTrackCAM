/**
 * Render-pin + unit tests for the live FDM job controls (Wave-3b).
 *
 * `renderToStaticMarkup` in the `node` vitest env (no jsdom). Effects do NOT
 * fire under SSR, so the polled `jobState` stays at its initial `unknown` —
 * which is exactly the "no live job ⇒ all controls disabled" surface we want
 * to pin. The pure `mapMoonrakerState` mapper is tested directly.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FdmDeviceControls,
  mapMoonrakerState,
  type FdmDeviceControlsProps
} from './FdmDeviceControls'

// window.fab shim — the module references window.fab inside callbacks; provide
// a minimal stub so module-load + SSR never throw. (Effects don't run here.)
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = {
  moonrakerStatus: vi.fn().mockResolvedValue({ ok: true, state: 'standby' }),
  moonrakerPause: vi.fn().mockResolvedValue({ ok: true }),
  moonrakerResume: vi.fn().mockResolvedValue({ ok: true }),
  moonrakerCancel: vi.fn().mockResolvedValue({ ok: true })
}
gAsRecord['window'] = globalThis

function render(props: FdmDeviceControlsProps): string {
  return renderToStaticMarkup(createElement(FdmDeviceControls, props))
}

describe('mapMoonrakerState — raw state → narrowed job state', () => {
  it('maps printing / paused / complete / error verbatim', () => {
    expect(mapMoonrakerState('printing')).toBe('printing')
    expect(mapMoonrakerState('paused')).toBe('paused')
    expect(mapMoonrakerState('complete')).toBe('complete')
    expect(mapMoonrakerState('error')).toBe('error')
  })

  it('folds cancelled / standby to idle', () => {
    expect(mapMoonrakerState('cancelled')).toBe('idle')
    expect(mapMoonrakerState('standby')).toBe('idle')
  })

  it('is case-insensitive', () => {
    expect(mapMoonrakerState('PRINTING')).toBe('printing')
    expect(mapMoonrakerState('Paused')).toBe('paused')
  })

  it('returns unknown for null / empty / unrecognized states', () => {
    expect(mapMoonrakerState(null)).toBe('unknown')
    expect(mapMoonrakerState(undefined)).toBe('unknown')
    expect(mapMoonrakerState('')).toBe('unknown')
    expect(mapMoonrakerState('weird')).toBe('unknown')
  })
})

describe('FdmDeviceControls — static surface', () => {
  it('renders all three job-control buttons', () => {
    const html = render({ printerUrl: 'http://192.168.1.50' })
    expect(html).toContain('data-testid="fdm-device-controls"')
    expect(html).toContain('data-testid="fdm-device-pause"')
    expect(html).toContain('data-testid="fdm-device-resume"')
    expect(html).toContain('data-testid="fdm-device-cancel"')
  })

  it('shows the "configure Moonraker" hint and disables all buttons without a URL', () => {
    const html = render({ printerUrl: '' })
    expect(html).toContain('data-testid="fdm-device-controls-no-url"')
    // All three buttons disabled when there is no printer URL.
    expect(html).toMatch(/data-testid="fdm-device-pause"[^>]*disabled/)
    expect(html).toMatch(/data-testid="fdm-device-resume"[^>]*disabled/)
    expect(html).toMatch(/data-testid="fdm-device-cancel"[^>]*disabled/)
  })

  it('treats a whitespace-only URL as "no URL"', () => {
    const html = render({ printerUrl: '   ' })
    expect(html).toContain('data-testid="fdm-device-controls-no-url"')
  })

  it('disables all buttons initially (unknown job state) even with a URL', () => {
    // SSR never fires the polling effect, so jobState is `unknown` ⇒ no job ⇒
    // every control is disabled (honest: we never enable Pause/Cancel until we
    // have confirmed a live job).
    const html = render({ printerUrl: 'http://k2plus.local:7125' })
    expect(html).toContain('data-testid="fdm-device-controls-state"')
    expect(html).toMatch(/data-testid="fdm-device-pause"[^>]*disabled/)
    expect(html).toMatch(/data-testid="fdm-device-resume"[^>]*disabled/)
    expect(html).toMatch(/data-testid="fdm-device-cancel"[^>]*disabled/)
  })
})
