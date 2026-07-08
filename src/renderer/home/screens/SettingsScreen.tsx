/**
 * Settings — account & display prefs, wired to the app's real preference store.
 *
 * - **Appearance → Theme**: drives the real 10-theme system. Clicking a swatch
 *   calls `applyTheme` (instant `<html data-theme>` flip — the whole app + DS
 *   surface re-themes) and persists via `settingsSet({ theme })`. Each swatch
 *   previews its theme's accent by carrying its own `data-theme`, so the token
 *   bridge resolves `--c-accent` for that theme.
 * - **Units & display → Units**: persisted via `settingsSet({ units })`.
 * - **Coordinate readout / Decimal places / Angle units**: local UI only — those
 *   preference keys don't exist in the backend yet (honest placeholder controls).
 *
 * `fab()` is guarded so the screen still renders in isolation (tests) with
 * defaults; persistence only runs in the real app where `window.fab` exists.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Display, Input } from '../../ds'
import { fab } from '../../src/shop-types'
import { THEMES } from '../../theme/theme-registry'
import { applyTheme } from '../../theme/useTheme'
import { HomeIcon } from '../icons'
import { SETTINGS_PANES, UNIT_OPTS } from '../home-sample-data'

type PaneId = (typeof SETTINGS_PANES)[number]['id']

const hasFab = (): boolean => typeof window !== 'undefined' && Boolean((window as { fab?: unknown }).fab)

const currentAppliedTheme = (): string =>
  typeof document !== 'undefined' ? document.documentElement.dataset.theme ?? 'graphite' : 'graphite'

export function SettingsScreen(): ReactElement {
  const [pane, setPane] = useState<PaneId>('units')
  const [units, setUnits] = useState('mm')
  const [coord, setCoord] = useState(true)
  const [theme, setTheme] = useState<string>(currentAppliedTheme)

  // Hydrate the persisted units + reflect the live applied theme.
  useEffect(() => {
    setTheme(currentAppliedTheme())
    if (!hasFab()) return
    let cancelled = false
    void fab()
      .settingsGet()
      .then((s) => {
        if (!cancelled && (s.units === 'mm' || s.units === 'inch')) setUnits(String(s.units))
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const chooseUnits = (id: string): void => {
    setUnits(id)
    if (hasFab()) void fab().settingsSet({ units: id })
  }

  const chooseTheme = (id: string): void => {
    setTheme(id)
    applyTheme(id) // instant re-theme of the whole app + DS surface
    if (hasFab()) void fab().settingsSet({ theme: id })
  }

  return (
    <div className="wt-home__split">
      <div className="wt-home__rail-col">
        {SETTINGS_PANES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`wt-home__nav-item${pane === p.id ? ' is-active' : ''}`}
            aria-current={pane === p.id ? 'true' : undefined}
            onClick={() => setPane(p.id)}
          >
            <span className="wt-home__nav-label">{p.label}</span>
          </button>
        ))}
      </div>

      {pane === 'units' ? (
        <div className="wt-set__form">
          <Display style={{ fontSize: 20, marginBottom: 4 }}>Units &amp; display</Display>
          <div className="wt-set__lead">How measurements and coordinates appear across the workspace.</div>

          <div className="wt-set__row">
            <div>
              <div className="wt-set__row-label">Units</div>
              <div className="wt-set__row-sub">Default unit for new designs</div>
            </div>
            <div className="wt-set__seg" role="radiogroup" aria-label="Units">
              {UNIT_OPTS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="radio"
                  aria-checked={units === u.id}
                  className={`wt-set__seg-btn${units === u.id ? ' is-active' : ''}`}
                  onClick={() => chooseUnits(u.id)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wt-set__row">
            <div>
              <div className="wt-set__row-label">Coordinate readout</div>
              <div className="wt-set__row-sub">Show live X / Y / Z in the viewport</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={coord}
              aria-label="Coordinate readout"
              className={`wt-set__toggle${coord ? ' is-on' : ''}`}
              onClick={() => setCoord((c) => !c)}
            >
              <span className="wt-set__knob" />
            </button>
          </div>

          <div className="wt-set__row">
            <div>
              <div className="wt-set__row-label">Decimal places</div>
              <div className="wt-set__row-sub">Precision in fields and readouts</div>
            </div>
            <Input className="mono wt-set__decimals" defaultValue="2" aria-label="Decimal places" />
          </div>

          <div className="wt-set__row wt-set__row--last">
            <div>
              <div className="wt-set__row-label">Angle units</div>
              <div className="wt-set__row-sub">Degrees or radians</div>
            </div>
            <button type="button" className="wt-set__dropdown">
              Degrees
              <HomeIcon name="chevDown" size={15} style={{ color: 'rgb(var(--c-text-subtle))' }} />
            </button>
          </div>

          <Display style={{ fontSize: 20, margin: '30px 0 4px' }}>Appearance</Display>
          <div className="wt-set__lead">
            Theme for the whole app — {THEMES.find((t) => t.id === theme)?.label ?? 'Graphite Pro'}.
          </div>

          <div className="wt-set__row wt-set__row--last">
            <div>
              <div className="wt-set__row-label">Theme</div>
              <div className="wt-set__row-sub">Ten shop themes — applies instantly and is saved</div>
            </div>
            <div className="wt-set__swatches">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-theme={t.id}
                  aria-label={t.label}
                  aria-pressed={theme === t.id}
                  title={t.label}
                  className={`wt-set__swatch${theme === t.id ? ' is-selected' : ''}`}
                  style={{ background: 'rgb(var(--c-accent))' }}
                  onClick={() => chooseTheme(t.id)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="wt-set__form">
          <Display style={{ fontSize: 20, marginBottom: 4 }}>
            {SETTINGS_PANES.find((p) => p.id === pane)?.label}
          </Display>
          <div className="wt-set__lead">
            This settings section is coming in a later cycle of the design-system
            unification.
          </div>
        </div>
      )}
    </div>
  )
}
