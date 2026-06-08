/**
 * StatusBar — FG-7 "bind the faked status chrome" pin.
 *
 * Before FG-7 the status bar hard-coded X/Y/Z `0.00`, an always-on
 * "Sidecar ready" badge, and the workspace label map carried a stale
 * `manufacture: 'Manufacture'` entry. This pin locks in the honest initial
 * render:
 *
 *   - The sidecar badge starts at the honest `checking…` state, NOT a faked
 *     "ready" — health is only asserted after the async `pythonDeps:check`
 *     probe resolves (an effect that does not run under static render).
 *   - Cursor coordinates degrade gracefully to an em dash `—` because no live
 *     viewport cursor source is mounted yet (FG-2) — never a faked `0.00`.
 *   - The workspace read-out uses the LIVE nav-rail label (`manufacture` →
 *     "Make"), matching `WorkspaceNav` / the FG-1 command engine labels.
 *
 * Node-env vitest (no jsdom): we assert on `renderToStaticMarkup` output, the
 * same pattern as the sibling DesignWorkspaceHost / DesignWorkspace pins.
 * `useEffect` does not fire under static render, so the markup reflects the
 * component's initial (pre-probe) state — exactly the honest defaults we pin.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusBar } from '../StatusBar'
import type { WorkspaceId } from '../useWorkspaceRouter'

function render(props: {
  machineName: string | null
  units: 'mm' | 'inch'
  activeWorkspace: WorkspaceId
}): string {
  return renderToStaticMarkup(createElement(StatusBar, props))
}

describe('StatusBar (FG-7 honest status chrome)', () => {
  it('does NOT fake "Sidecar ready" — initial state is the honest "checking…"', () => {
    const html = render({ machineName: null, units: 'mm', activeWorkspace: 'design' })
    expect(html).toContain('checking')
    // The literal always-on "ready" badge must be gone from the initial render.
    expect(html).not.toContain('>ready<')
  })

  it('does NOT hard-code 0.00 coordinates — degrades to an em dash', () => {
    const html = render({ machineName: null, units: 'mm', activeWorkspace: 'design' })
    expect(html).not.toContain('0.00')
    // Three coordinate slots (X/Y/Z) each render the honest placeholder.
    const dashes = html.split('—').length - 1
    expect(dashes).toBeGreaterThanOrEqual(3)
  })

  it('renders the live nav-rail workspace label (manufacture → "Make")', () => {
    const html = render({ machineName: null, units: 'mm', activeWorkspace: 'manufacture' })
    expect(html).toContain('Make')
    expect(html).not.toContain('Manufacture')
  })

  it('shows the passed units fallback until settings load', () => {
    expect(render({ machineName: null, units: 'inch', activeWorkspace: 'design' })).toContain('inch')
    expect(render({ machineName: null, units: 'mm', activeWorkspace: 'design' })).toContain('mm')
  })

  it('shows the machine name, or an honest "No machine" when none', () => {
    expect(render({ machineName: 'Creality K2 Plus', units: 'mm', activeWorkspace: 'design' })).toContain(
      'Creality K2 Plus'
    )
    expect(render({ machineName: null, units: 'mm', activeWorkspace: 'design' })).toContain('No machine')
  })

  it('uses themed tokens (not raw hex) for the sidecar dot colour', () => {
    const html = render({ machineName: null, units: 'mm', activeWorkspace: 'design' })
    // Initial "unknown" health → warn token, applied via inline CSS variable.
    expect(html).toContain('var(--warn)')
  })
})
