/**
 * Machine — monitor/control the Carvera. Left: identity + telemetry + position +
 * controls + maintenance. Right: now-cutting preview + connection. DS primitives.
 * Sample telemetry is a design placeholder pending live machine wiring.
 */
import type { ReactElement } from 'react'
import { Button, Card, Display, Eyebrow, SectionTitle } from '../../ds'
import { HomeIcon } from '../icons'
import {
  MACHINE_CONNECTION,
  MACHINE_CONTROLS,
  MACHINE_HEADER,
  MACHINE_POSITION,
  MACHINE_TELEMETRY,
  MAINTENANCE,
  ON_MACHINE
} from '../home-sample-data'

export function MachineScreen(): ReactElement {
  return (
    <div className="wt-mach">
      <div className="wt-mach__col">
        {/* identity + telemetry */}
        <Card style={{ padding: '20px 22px' }}>
          <div className="wt-mach__header">
            <span className="wt-mach__chip">
              <HomeIcon name="machine" size={28} />
            </span>
            <div style={{ flex: 1 }}>
              <Display style={{ fontSize: 19 }}>{MACHINE_HEADER.name}</Display>
              <div className="mono" style={{ fontSize: 12, color: 'rgb(var(--c-text-subtle))' }}>
                {MACHINE_HEADER.firmware}
              </div>
            </div>
            <span className="wt-mach__status">
              <span className="wt-mach__status-dot" />
              {MACHINE_HEADER.status}
            </span>
          </div>
          <div className="wt-mach__telemetry">
            {MACHINE_TELEMETRY.map((t) => (
              <div key={t.k} className="wt-mach__tile">
                <Eyebrow style={{ fontSize: 10 }}>{t.k}</Eyebrow>
                <div className="wt-mach__tile-val">
                  <Display className="mono" style={{ fontSize: 22 }}>
                    {t.v}
                  </Display>
                  <span className="wt-mach__tile-unit">{t.u}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="wt-mach__position mono">
            Position
            <span>{MACHINE_POSITION.x}</span>
            <span>{MACHINE_POSITION.y}</span>
            <span>{MACHINE_POSITION.z}</span>
          </div>
        </Card>

        {/* controls */}
        <Card style={{ padding: '18px 22px' }}>
          <SectionTitle style={{ fontSize: 15, marginBottom: 14 }}>Controls</SectionTitle>
          <div className="wt-mach__controls">
            {MACHINE_CONTROLS.map((c) => (
              <button key={c.label} type="button" className="wt-mach__ctl">
                <HomeIcon name={c.icon} size={17} />
                {c.label}
              </button>
            ))}
          </div>
        </Card>

        {/* maintenance */}
        <Card style={{ padding: '18px 22px' }}>
          <div className="wt-mach__maint-head">
            <SectionTitle style={{ fontSize: 15 }}>Maintenance</SectionTitle>
            <Button variant="secondary" size="sm">
              Run calibration
            </Button>
          </div>
          {MAINTENANCE.map((m) => (
            <div key={m.label} className="wt-mach__maint-row">
              <span
                className="wt-mach__maint-chip"
                style={{
                  background: m.ok ? 'rgb(52 211 153 / 0.14)' : 'rgb(var(--c-accent) / 0.14)',
                  color: m.ok ? '#34d399' : 'rgb(var(--c-accent))'
                }}
              >
                <HomeIcon name={m.ok ? 'check' : 'clock'} size={16} />
              </span>
              <div style={{ flex: 1 }}>
                <div className="wt-mach__maint-label">{m.label}</div>
                <div className="wt-mach__maint-sub">{m.sub}</div>
              </div>
              <span
                className="wt-mach__maint-status"
                style={{ color: m.ok ? '#34d399' : 'rgb(var(--c-accent))' }}
              >
                {m.status}
              </span>
            </div>
          ))}
        </Card>
      </div>

      {/* right rail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="wt-mach__preview">
            <HomeIcon name="cube" size={70} />
          </div>
          <div style={{ padding: '16px 18px' }}>
            <Eyebrow>Now cutting</Eyebrow>
            <Display className="mono" style={{ fontSize: 16, marginTop: 4 }}>
              {ON_MACHINE.file}
            </Display>
            <div className="wt-home__progress" style={{ background: 'rgb(var(--c-surface-3))' }}>
              <div
                className="wt-home__progress-fill"
                style={{ width: `${ON_MACHINE.progressPct}%`, background: 'rgb(var(--c-accent))' }}
              />
            </div>
            <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgb(var(--c-text-muted))' }}>
              <span>{ON_MACHINE.progressPct}%</span>
              <span>{ON_MACHINE.eta}</span>
            </div>
          </div>
        </Card>

        <Card style={{ padding: '16px 18px' }}>
          <SectionTitle style={{ fontSize: 14, marginBottom: 10 }}>Connection</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="wt-mach__conn-row">
              <span>Interface</span>
              <span>{MACHINE_CONNECTION.interface}</span>
            </div>
            <div className="wt-mach__conn-row">
              <span>Wi-Fi</span>
              <span>{MACHINE_CONNECTION.wifi}</span>
            </div>
            <Button variant="secondary" size="sm" block style={{ marginTop: 6 }}>
              Manage connection
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
