/**
 * Settings — account & display prefs. Units & display + Appearance are the
 * flagship prefs (per the handoff). Local UI state for now; wiring the theme /
 * accent to the app's real theme system (the existing SettingsDrawer owns the
 * 10-theme picker) is a follow-up — see the design-system-unification plan.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Display, Input } from '../../ds'
import { HomeIcon } from '../icons'
import { ACCENT_SWATCHES, MODE_OPTS, SETTINGS_PANES, UNIT_OPTS } from '../home-sample-data'

type PaneId = (typeof SETTINGS_PANES)[number]['id']

export function SettingsScreen(): ReactElement {
  const [pane, setPane] = useState<PaneId>('units')
  const [units, setUnits] = useState('mm')
  const [coord, setCoord] = useState(true)
  const [mode, setMode] = useState('dark')
  const [accent, setAccent] = useState('signal-red')

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
                  onClick={() => setUnits(u.id)}
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
          <div className="wt-set__lead">Theme and accent for the whole app.</div>

          <div className="wt-set__row">
            <div>
              <div className="wt-set__row-label">Theme</div>
              <div className="wt-set__row-sub">Light or dark interface</div>
            </div>
            <div className="wt-set__seg" role="radiogroup" aria-label="Theme">
              {MODE_OPTS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  className={`wt-set__seg-btn${mode === m.id ? ' is-active' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wt-set__row wt-set__row--last">
            <div>
              <div className="wt-set__row-label">Accent</div>
              <div className="wt-set__row-sub">Signal Red is the WorkTrack default</div>
            </div>
            <div className="wt-set__swatches">
              {ACCENT_SWATCHES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-label={a.id}
                  aria-pressed={accent === a.id}
                  className={`wt-set__swatch${accent === a.id ? ' is-selected' : ''}`}
                  style={{ background: `rgb(${a.rgb})` }}
                  onClick={() => setAccent(a.id)}
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
