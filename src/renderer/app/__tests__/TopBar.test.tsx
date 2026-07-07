/**
 * TopBar — FG-7 "bind the faked title chrome" pin.
 *
 * Before FG-7 the title chrome rendered the hard-coded `projectName` prop
 * verbatim ("Untitled project") with no dirty marker. FG-7 binds it to the live
 * project session (`useProjectSession`) and an honest dirty `*` driven by the
 * app's saved-indicator flag (`UIContext.savedIndicator`).
 *
 * This pin locks the deterministic boot state (node-env `renderToStaticMarkup`,
 * so the session/settings effects never fire — the markup is the initial,
 * pre-hydration render with no project open):
 *
 *   - With NO project open (`projectDir == null`), the fallback name from the
 *     prop still renders, and there is NO dirty `*` — we never fabricate
 *     dirtiness when nothing is loaded.
 *   - The E-STOP / command / settings / help buttons all keep an explicit
 *     `type="button"` (guarded globally by `new-shell-button-types`, re-asserted
 *     here for the title-chrome change).
 *
 * Wrapped in the real `AppProviders` so the `useToast` / `useUI` /
 * `useMachineSession` / `useProjectSession` hooks resolve; their async loads are
 * effects that static render does not run, keeping the assertion deterministic.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TopBar } from '../TopBar'
import { AppProviders } from '../../contexts/AppProviders'

const TOPBAR_SRC = readFileSync(join(__dirname, '..', 'TopBar.tsx'), 'utf-8')

function render(projectName: string): string {
  return renderToStaticMarkup(
    createElement(
      AppProviders,
      null,
      createElement(TopBar, {
        machine: null,
        projectName,
        onGoHome: () => {},
        onOpenCommand: () => {},
        onOpenSettings: () => {},
        onOpenHelp: () => {},
        onOpenMyShop: () => {}
      })
    )
  )
}

describe('TopBar (FG-7 honest title chrome)', () => {
  it('renders the fallback project name when no project is open', () => {
    expect(render('Untitled project')).toContain('Untitled project')
  })

  it('shows NO dirty marker when no project is open (never fabricates dirtiness)', () => {
    const html = render('Untitled project')
    expect(html).not.toContain('unsaved changes')
    // The dirty span carries a stable class hook; it must be absent with no project.
    expect(html).not.toContain('wt-project__dirty')
  })

  it('still emits an honest machine read-out and E-STOP control', () => {
    const html = render('Untitled project')
    expect(html).toContain('No machine')
    expect(html).toContain('E-STOP')
  })

  it('keeps explicit type="button" on the title-chrome buttons', () => {
    const html = render('Untitled project')
    // No bare <button> (defaults to submit inside a form — the ID-0152 footgun).
    expect(html).not.toMatch(/<button(?![^>]*type=)/)
  })
})

describe('TopBar — My Shop quick-select trigger', () => {
  it('renders a labeled My Shop button (the CLAUDE.md one-click quick-select)', () => {
    const html = render('Untitled project')
    expect(html).toContain('My Shop')
    expect(html).toContain('class="wt-myshop-btn"')
    // Accessible name + explicit button type.
    expect(html).toContain('aria-label="Open My Shop"')
    expect(html).toMatch(/class="wt-myshop-btn"[^>]*type="button"|type="button"[^>]*class="wt-myshop-btn"/)
  })

  it('sits beside the machine read-out so switching bays is one click', () => {
    const html = render('Untitled project')
    // The trigger and the machine status both render in the topbar.
    expect(html).toContain('wt-myshop-btn')
    expect(html).toContain('wt-machine')
  })

  it('wires the trigger onClick to the onOpenMyShop prop', () => {
    // Source-pin: node-env cannot dispatch a real click on static markup, so we
    // assert the handler is the passed prop (not a no-op / wrong callback).
    expect(TOPBAR_SRC).toContain('onClick={onOpenMyShop}')
    expect(TOPBAR_SRC).toContain('onOpenMyShop: () => void')
  })
})
