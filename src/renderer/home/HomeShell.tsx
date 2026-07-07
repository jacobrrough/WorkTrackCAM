/**
 * HomeShell — the DS-native application shell (sidebar + top bar + content
 * region) that hosts the shop-relevant app screens. This is the "outer" surface
 * of the two-surface app: the dashboard/files/machine/jobs layer you land on,
 * from which "New design" / a recent file / a template opens the "inner"
 * modeling workspace (Canvas). The workspace's brand logo returns here.
 *
 * Rebuilt from the `WorkTrack CAD - App` handoff with the native DS components
 * and the `--c-*` token bridge, so the whole surface follows the app's active
 * theme. Structure lives in `styles/home/home-shell.css`.
 *
 * Cycle 1 scope: the shell frame + the Home screen. Files / Templates / Machine
 * / Jobs / Settings are honest "coming soon" placeholders wired into the same
 * sidebar routing; each becomes a real screen in a later cycle.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button, DsScope } from '../ds'
import { HomeIcon } from './icons'
import type { HomeIconName } from './icons'
import { HomeScreen } from './HomeScreen'
import { HOME_NAV, HOME_SCREEN_TITLES, type HomeScreenId } from './home-screens'

export interface HomeShellProps {
  /** Enter the modeling workspace (Canvas) — the app's "inner" surface. */
  onEnterWorkspace: () => void
}

/** Honest placeholder for a screen not yet built in this cycle. */
function ComingSoonScreen({ icon, title }: { icon: HomeIconName; title: string }): ReactElement {
  return (
    <div className="wt-home__placeholder">
      <span className="wt-home__placeholder-chip">
        <HomeIcon name={icon} size={26} />
      </span>
      <div className="ds-section-title" style={{ fontSize: 18 }}>
        {title}
      </div>
      <p className="wt-home__placeholder-body">
        The {title} screen is coming in a later cycle of the design-system
        unification. Its layout is specified in the handoff and will be rebuilt
        with the same DS components used on Home.
      </p>
    </div>
  )
}

export function HomeShell({ onEnterWorkspace }: HomeShellProps): ReactElement {
  const [screen, setScreen] = useState<HomeScreenId>('home')
  const title = HOME_SCREEN_TITLES[screen]

  return (
    <DsScope appBg className="wt-home">
      {/* ---- sidebar (248px) --------------------------------------------- */}
      <aside className="wt-home__sidebar">
        <div className="wt-home__brand">
          <span className="wt-home__brand-chip">
            <HomeIcon name="brand" size={20} />
          </span>
          <div>
            <div className="ds-display wt-home__brand-name">WorkTrack</div>
            <div className="wt-home__brand-caption">CAD · CAM</div>
          </div>
        </div>

        <nav className="wt-home__nav" aria-label="App sections">
          {HOME_NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`wt-home__nav-item${screen === n.id ? ' is-active' : ''}`}
              aria-current={screen === n.id ? 'page' : undefined}
              onClick={() => setScreen(n.id)}
            >
              <HomeIcon name={n.icon} size={20} />
              <span className="wt-home__nav-label">{n.label}</span>
              {n.badge ? <span className="wt-home__nav-badge">{n.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="wt-home__sidebar-footer">
          <button
            type="button"
            className="wt-home__machine-card"
            onClick={onEnterWorkspace}
            title="Open the modeling workspace"
          >
            <span className="wt-home__machine-chip">
              <HomeIcon name="machine" size={19} />
              <span className="wt-home__machine-dot" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgb(var(--c-text))' }}>Carvera</div>
              <div className="mono" style={{ fontSize: 11, color: 'rgb(var(--c-text-muted))' }}>
                Cutting · 46%
              </div>
            </div>
            <HomeIcon name="chevR" size={16} style={{ color: 'rgb(var(--c-text-subtle))' }} />
          </button>

          <div className="wt-home__user-row">
            <span className="wt-home__avatar">JR</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--c-text))' }}>Jacob Rough</div>
              <div
                style={{
                  fontSize: 11,
                  color: 'rgb(var(--c-text-subtle))',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                Pro plan
              </div>
            </div>
            <button type="button" className="ds-icon-btn ds-icon-btn--sm" aria-label="Sign out">
              <HomeIcon name="logout" size={16} style={{ color: 'rgb(var(--c-text-muted))' }} />
            </button>
          </div>
        </div>
      </aside>

      {/* ---- main column -------------------------------------------------- */}
      <div className="wt-home__main">
        <header className="wt-home__topbar" role="banner">
          <div className="ds-display wt-home__topbar-title">{title}</div>
          <div className="wt-home__search-wrap">
            <label className="wt-home__search">
              <HomeIcon name="search" size={17} style={{ color: 'rgb(var(--c-text-subtle))' }} />
              <input placeholder="Search designs, files, jobs…" aria-label="Search" />
              <span className="wt-home__kbd mono">⌘K</span>
            </label>
          </div>
          <div className="wt-home__topbar-actions">
            <button type="button" className="ds-icon-btn wt-home__bell" aria-label="Notifications">
              <HomeIcon name="bell" size={19} style={{ color: 'rgb(var(--c-text-muted))' }} />
              <span className="wt-home__bell-dot" />
            </button>
            <Button
              variant="primary"
              onClick={onEnterWorkspace}
              style={{ height: 40, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <HomeIcon name="plus" size={17} />
              New design
            </Button>
          </div>
        </header>

        <div className="wt-home__scroll">
          {screen === 'home' ? (
            <HomeScreen onEnterWorkspace={onEnterWorkspace} onOpenScreen={setScreen} />
          ) : (
            <ComingSoonScreen icon={navIconFor(screen)} title={title} />
          )}
        </div>
      </div>
    </DsScope>
  )
}

function navIconFor(screen: HomeScreenId): HomeIconName {
  return HOME_NAV.find((n) => n.id === screen)?.icon ?? 'grid'
}

export default HomeShell
