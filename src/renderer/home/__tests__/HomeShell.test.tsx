/**
 * Node-env render pins for the DS-native Home shell + Home screen. These assert
 * the static markup carries the handoff's structure, the DS recipe classes, and
 * the sample content — the interactive behaviour (nav switching, entering the
 * workspace) is covered by `HomeShell.dom.spec.tsx`.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeShell } from '../HomeShell'
import { HomeScreen } from '../HomeScreen'

const shellHtml = (): string =>
  renderToStaticMarkup(createElement(HomeShell, { onEnterWorkspace: () => {} }))

const homeHtml = (): string =>
  renderToStaticMarkup(createElement(HomeScreen, { onEnterWorkspace: () => {}, onOpenScreen: () => {} }))

describe('HomeShell — DS-native app shell frame', () => {
  it('renders inside a .ds DsScope with the wt-home layout root', () => {
    const html = shellHtml()
    expect(html).toContain('class="ds ds-app-bg wt-home"')
  })

  it('renders the brand and the shop-relevant nav (no Team/Billing/Activity)', () => {
    const html = shellHtml()
    expect(html).toContain('WorkTrack')
    expect(html).toContain('CAD · CAM')
    for (const label of ['Home', 'Files', 'Templates', 'Machine', 'Jobs', 'Settings']) {
      expect(html).toContain(`>${label}</span>`)
    }
    // Out-of-scope SaaS screens must NOT appear in the sidebar.
    expect(html).not.toContain('>Team</span>')
    expect(html).not.toContain('>Billing</span>')
    expect(html).not.toContain('>Activity</span>')
  })

  it('marks Home active by default and pins the Jobs count badge', () => {
    const html = shellHtml()
    expect(html).toContain('wt-home__nav-item is-active')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('wt-home__nav-badge')
  })

  it('renders the top bar with title, search and a single primary action', () => {
    const html = shellHtml()
    expect(html).toContain('wt-home__topbar-title')
    expect(html).toContain('Search designs, files, jobs…')
    expect(html).toContain('⌘K')
    // One accent per screen: exactly one ds-btn-primary (the New design button).
    expect(html.match(/ds-btn-primary/g)?.length).toBe(1)
    expect(html).toContain('New design')
  })
})

describe('HomeScreen — dashboard content', () => {
  it('renders the greeting and quick-start tiles', () => {
    const html = homeHtml()
    expect(html).toContain('Good afternoon, Jacob')
    for (const label of ['New design', 'New from template', 'Import STEP / STL', 'Send to Carvera']) {
      expect(html).toContain(label)
    }
  })

  it('renders the Recent grid with mono file meta', () => {
    const html = homeHtml()
    expect(html).toContain('Recent')
    expect(html).toContain('bracket-mount')
    expect(html).toContain('wt-home__recent-card')
    expect(html).toContain('Design · 2m ago · 4.2 MB')
  })

  it('uses the single PrimaryCard for the "On the machine" surface (wired to the active machine)', () => {
    const html = homeHtml()
    expect(html.match(/ds-primary-card/g)?.length).toBe(1)
    expect(html).toContain('On the machine')
    // No live session in isolation → the sample fallback machine, idle (not a
    // fabricated running job).
    expect(html).toContain('Carvera')
    expect(html).toContain('Ready')
    expect(html).toContain('Open in Jobs')
  })

  it('renders the Activity card rows', () => {
    const html = homeHtml()
    expect(html).toContain('Activity')
    expect(html).toContain('Carvera finished gear-24t.nc')
    expect(html).toContain('18 minutes ago')
  })
})
