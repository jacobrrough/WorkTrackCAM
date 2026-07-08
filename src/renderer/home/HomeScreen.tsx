/**
 * Home — the app landing/dashboard (screen 1 of the WorkTrack CAD app shell).
 *
 * Rebuilt from the `WorkTrack CAD - App` prototype using the native DS
 * primitives (Display / SectionTitle / Eyebrow / Card / PrimaryCard / Button)
 * + the `--c-*` token bridge — NOT the prototype's inline styles. Layout lives
 * in `styles/home/home-shell.css`; sample content in `home-sample-data.ts`.
 *
 * One accent per screen: the single accent surface is the "On the machine"
 * {@link PrimaryCard}; the one accent action is the "New design" quick-start
 * tile. Everything else stays neutral.
 */
import type { ReactElement } from 'react'
import { Button, Card, Display, Eyebrow, PrimaryCard, SectionTitle } from '../ds'
import { HomeIcon } from './icons'
import { machineIdentity, useActiveMachine } from './active-machine'
import { useK2Telemetry } from './useK2Telemetry'
import type { HomeScreenId } from './home-screens'
import { GREETING, GREETING_SUB, HOME_ACTIVITY, QUICK_START, RECENTS } from './home-sample-data'

export interface HomeScreenProps {
  /** Open the modeling workspace (Canvas) — New design, recent files, import. */
  onEnterWorkspace: () => void
  /** Switch to another app screen (View all → Files, Open in Jobs → Jobs, …). */
  onOpenScreen: (screen: HomeScreenId) => void
}

export function HomeScreen({ onEnterWorkspace, onOpenScreen }: HomeScreenProps): ReactElement {
  const { machine } = useActiveMachine()
  const k2 = useK2Telemetry(machine)
  const printing = machine.kind === 'fdm' && Boolean(k2?.online) && k2?.progressPct != null && Boolean(k2?.filename)
  const machineMode = machineIdentity(machine).modeLabel

  const onQuick = (key: string): void => {
    switch (key) {
      case 'new-design':
      case 'import':
        onEnterWorkspace()
        break
      case 'new-template':
        onOpenScreen('templates')
        break
      case 'send-carvera':
        onOpenScreen('machine')
        break
      default:
        break
    }
  }

  return (
    <div className="wt-home__page">
      {/* ---- left column ---------------------------------------------------- */}
      <div className="wt-home__page-col">
        <div>
          <Display style={{ fontSize: 26 }}>{GREETING}</Display>
          <div className="wt-home__greeting-sub">{GREETING_SUB}</div>
        </div>

        <div className="wt-home__quickstart">
          {QUICK_START.map((q) => (
            <button key={q.key} type="button" className="wt-home__qtile" onClick={() => onQuick(q.key)}>
              <span
                className="wt-home__qtile-chip"
                style={{
                  background: q.accent ? 'rgb(var(--c-accent))' : 'rgb(var(--c-surface-2))',
                  color: q.accent ? 'rgb(var(--c-on-accent))' : 'rgb(var(--c-accent))'
                }}
              >
                <HomeIcon name={q.icon} size={21} />
              </span>
              <span className="wt-home__qtile-label">{q.label}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="wt-home__section-head">
            <SectionTitle style={{ fontSize: 15 }}>Recent</SectionTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenScreen('files')}
              style={{ background: 'transparent', color: 'rgb(var(--c-text-muted))' }}
            >
              View all
            </Button>
          </div>
          <div className="wt-home__recent-grid">
            {RECENTS.map((r, i) => (
              <button
                key={r.name}
                type="button"
                className={`ds-card ds-card-interactive wt-home__recent-card`}
                onClick={onEnterWorkspace}
              >
                <div className={`wt-home__recent-thumb ${i % 2 === 0 ? 'wt-home__recent-thumb--a' : 'wt-home__recent-thumb--b'}`}>
                  <HomeIcon name="cube" size={46} style={{ opacity: 0.9 }} />
                </div>
                <div className="wt-home__recent-body">
                  <div className="wt-home__recent-name">{r.name}</div>
                  <div className="wt-home__recent-meta mono">
                    {r.kind} · {r.edited} · {r.size}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- right rail ----------------------------------------------------- */}
      <div className="wt-home__rail">
        <PrimaryCard style={{ padding: 18 }}>
          <div className="wt-home__rail-head">
            <Eyebrow style={{ color: 'rgb(var(--c-on-accent) / 0.8)' }}>On the machine</Eyebrow>
            <span className="wt-home__status">
              {printing || k2?.online ? <span className="wt-home__status-dot" /> : null}
              {printing ? 'Printing' : k2?.online ? 'Online' : 'Ready'}
            </span>
          </div>
          <Display className="mono" style={{ fontSize: 19, color: 'rgb(var(--c-on-accent))', marginTop: 10 }}>
            {printing ? k2?.filename : machine.name}
          </Display>
          {printing ? (
            <>
              <div className="wt-home__progress">
                <div className="wt-home__progress-fill" style={{ width: `${k2?.progressPct ?? 0}%` }} />
              </div>
              <div className="wt-home__primary-meta">
                <span>{k2?.state ?? 'Printing'}</span>
                <span className="mono">{k2?.eta ?? ''}</span>
              </div>
            </>
          ) : (
            <div className="wt-home__primary-meta" style={{ marginTop: 12 }}>
              <span>{machineMode}</span>
              <span className="mono">
                {machine.workAreaMm.x}×{machine.workAreaMm.y} mm
              </span>
            </div>
          )}
          <button type="button" className="wt-home__primary-btn" onClick={() => onOpenScreen('jobs')}>
            Open in Jobs
          </button>
        </PrimaryCard>

        <Card style={{ padding: '16px 18px' }}>
          <SectionTitle style={{ fontSize: 14, marginBottom: 6 }}>Activity</SectionTitle>
          {HOME_ACTIVITY.map((a) => (
            <div key={a.text} className="wt-home__activity-row">
              <span className="wt-home__activity-chip">
                <HomeIcon name={a.icon} size={16} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="wt-home__activity-text">{a.text}</div>
                <div className="wt-home__activity-time">{a.time}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
