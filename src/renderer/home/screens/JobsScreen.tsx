/**
 * Jobs — the CNC queue + history. Running job in the single accent PrimaryCard;
 * Queue / History tabs below. Sample content pending live job-feed wiring.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Card, Display, Eyebrow, IconButton, PrimaryCard } from '../../ds'
import { HomeIcon } from '../icons'
import { JOB_HISTORY, JOB_QUEUE, JOB_RUNNING } from '../home-sample-data'

type JobsTab = 'queue' | 'history'

export function JobsScreen(): ReactElement {
  const [tab, setTab] = useState<JobsTab>('queue')

  return (
    <div className="wt-jobs">
      <PrimaryCard className="wt-jobs__running">
        <div className="wt-jobs__running-body">
          <div className="wt-jobs__running-head">
            <Eyebrow style={{ color: 'rgb(var(--c-on-accent) / 0.8)' }}>Running now</Eyebrow>
            <span className="wt-jobs__running-machine">
              <span className="wt-jobs__running-dot" />
              {JOB_RUNNING.machine}
            </span>
          </div>
          <Display className="mono" style={{ fontSize: 22, color: 'rgb(var(--c-on-accent))', marginTop: 8 }}>
            {JOB_RUNNING.file}
          </Display>
          <div className="wt-jobs__progress">
            <div className="wt-jobs__progress-fill" style={{ width: `${JOB_RUNNING.progressPct}%` }} />
          </div>
          <div className="wt-jobs__running-meta mono">
            <span>{JOB_RUNNING.line1}</span>
            <span>{JOB_RUNNING.eta}</span>
            <span>{JOB_RUNNING.stock}</span>
          </div>
        </div>
        <div className="wt-jobs__round">
          <button type="button" className="wt-jobs__round-btn" aria-label="Pause job">
            <HomeIcon name="pause" size={20} />
          </button>
          <button type="button" className="wt-jobs__round-btn wt-jobs__round-btn--stop" aria-label="Stop job">
            <HomeIcon name="stop" size={18} />
          </button>
        </div>
      </PrimaryCard>

      <div className="wt-jobs__tabs" role="tablist">
        {(['queue', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`wt-jobs__tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'queue' ? 'Queue' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        <div className="wt-jobs__queue">
          {JOB_QUEUE.map((q) => (
            <Card key={q.name} className="wt-jobs__queue-row">
              <span className="wt-jobs__pos">{q.pos}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wt-jobs__queue-name mono">{q.name}</div>
                <div className="wt-jobs__queue-sub">
                  {q.material} · {q.dur}
                </div>
              </div>
              <span className="wt-jobs__queued">Queued</span>
              <IconButton size="sm" aria-label="More">
                <HomeIcon name="dots" size={16} style={{ color: 'rgb(var(--c-text-subtle))' }} />
              </IconButton>
            </Card>
          ))}
        </div>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div className="wt-jobs__hhead wt-home__thead">
            <span>File</span>
            <span>Material</span>
            <span>Duration</span>
            <span>Finished</span>
            <span>Status</span>
          </div>
          {JOB_HISTORY.map((h) => {
            const done = h.status === 'Completed'
            return (
              <div key={h.name} className="wt-jobs__hrow wt-home__trow">
                <span className="mono" style={{ fontSize: 13.5, color: 'rgb(var(--c-text))' }}>
                  {h.name}
                </span>
                <span style={{ fontSize: 12.5, color: 'rgb(var(--c-text-muted))' }}>{h.material}</span>
                <span className="mono" style={{ fontSize: 12.5, color: 'rgb(var(--c-text-muted))' }}>
                  {h.dur}
                </span>
                <span style={{ fontSize: 12.5, color: 'rgb(var(--c-text-muted))' }}>{h.when}</span>
                <span>
                  <span
                    className="wt-jobs__badge"
                    style={{
                      background: done ? 'rgb(52 211 153 / 0.14)' : 'rgb(var(--c-danger) / 0.14)',
                      color: done ? '#34d399' : 'rgb(var(--c-danger))'
                    }}
                  >
                    <span className="wt-jobs__badge-dot" />
                    {h.status}
                  </span>
                </span>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
