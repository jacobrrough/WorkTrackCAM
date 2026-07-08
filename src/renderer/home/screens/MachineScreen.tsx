/**
 * Machine — monitor the active machine. Wired to the real machine session:
 * identity, machine-adaptive spec tiles, work envelope, and a switcher across
 * installed machines. For the K2 Plus (FDM) it shows LIVE Moonraker telemetry
 * (nozzle/bed temps, print state + progress) when a printer URL is configured;
 * everything else shows the machine's real profile specs. Maintenance +
 * controls remain design placeholders (no motion-control IPC exists yet).
 */
import type { ReactElement } from 'react'
import { Button, Card, Display, Eyebrow, SectionTitle } from '../../ds'
import { HomeIcon } from '../icons'
import {
  machineConnection,
  machineIdentity,
  machineTelemetry,
  machineWorkEnvelope,
  useActiveMachine,
  type TelemetryTile
} from '../active-machine'
import { useK2Telemetry } from '../useK2Telemetry'
import { MACHINE_CONTROLS, MAINTENANCE } from '../home-sample-data'

export function MachineScreen(): ReactElement {
  const { machine, machines, select } = useActiveMachine()
  const k2 = useK2Telemetry(machine)
  const id = machineIdentity(machine)
  const env = machineWorkEnvelope(machine)
  const conn = machineConnection(machine)

  const liveTemps = id.isFdm && k2?.online && (k2.nozzle !== undefined || k2.bed !== undefined)
  const tiles: TelemetryTile[] = liveTemps
    ? [
        { k: 'Nozzle', v: k2?.nozzle?.presentC?.toFixed(0) ?? '—', u: '°C' },
        { k: 'Bed', v: k2?.bed?.presentC?.toFixed(0) ?? '—', u: '°C' },
        { k: 'State', v: k2?.state ?? 'idle', u: '' },
        { k: 'Progress', v: k2?.progressPct != null ? String(k2.progressPct) : '0', u: '%' }
      ]
    : machineTelemetry(machine)

  const printing = id.isFdm && k2?.online && k2.progressPct != null && Boolean(k2.filename)
  const sub =
    [machine.meta?.manufacturer, machine.meta?.model].filter(Boolean).join(' ') || id.modeLabel
  const subLine = k2?.online && k2.firmwareVersion ? `${sub} · Klipper ${k2.firmwareVersion}` : sub

  return (
    <div className="wt-mach">
      <div className="wt-mach__col">
        {/* identity + telemetry */}
        <Card style={{ padding: '20px 22px' }}>
          <div className="wt-mach__header">
            <span className="wt-mach__chip">
              <HomeIcon name="machine" size={28} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Display style={{ fontSize: 19 }}>{machine.name}</Display>
              <div className="mono" style={{ fontSize: 12, color: 'rgb(var(--c-text-subtle))' }}>
                {subLine}
              </div>
            </div>
            {k2?.online ? (
              <span className="wt-mach__status">
                <span className="wt-mach__status-dot" />
                Online{k2.state ? ` · ${k2.state}` : ''}
              </span>
            ) : (
              <span
                className="wt-mach__status"
                style={{ background: 'rgb(var(--c-surface-2))', color: 'rgb(var(--c-text-muted))' }}
              >
                {id.modeLabel}
              </span>
            )}
          </div>

          {machines.length > 1 ? (
            <div className="wt-tpl__chips" style={{ marginTop: 16 }} role="group" aria-label="Switch machine">
              {machines.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`wt-tpl__chip${m.id === machine.id ? ' is-active' : ''}`}
                  aria-pressed={m.id === machine.id}
                  onClick={() => select(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="wt-mach__telemetry">
            {tiles.map((t) => (
              <div key={t.k} className="wt-mach__tile">
                <Eyebrow style={{ fontSize: 10 }}>{t.k}</Eyebrow>
                <div className="wt-mach__tile-val">
                  <Display className="mono" style={{ fontSize: 22 }}>
                    {t.v}
                  </Display>
                  {t.u ? <span className="wt-mach__tile-unit">{t.u}</span> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="wt-mach__position mono">
            Work area
            <span>{env.x}</span>
            <span>{env.y}</span>
            <span>{env.z}</span>
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
            <Eyebrow>{printing ? 'Now printing' : 'Machine'}</Eyebrow>
            <Display className="mono" style={{ fontSize: 16, marginTop: 4 }}>
              {printing ? k2?.filename : machine.name}
            </Display>
            {printing ? (
              <>
                <div className="wt-home__progress" style={{ background: 'rgb(var(--c-surface-3))' }}>
                  <div
                    className="wt-home__progress-fill"
                    style={{ width: `${k2?.progressPct ?? 0}%`, background: 'rgb(var(--c-accent))' }}
                  />
                </div>
                <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgb(var(--c-text-muted))' }}>
                  <span>{k2?.progressPct ?? 0}%</span>
                  <span>{k2?.eta ?? ''}</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'rgb(var(--c-text-subtle))', marginTop: 6 }}>
                {k2?.online ? 'Online · idle' : 'Ready to send'}
              </div>
            )}
          </div>
        </Card>

        <Card style={{ padding: '16px 18px' }}>
          <SectionTitle style={{ fontSize: 14, marginBottom: 10 }}>Connection</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="wt-mach__conn-row">
              <span>Interface</span>
              <span>{conn.interfaceLabel}</span>
            </div>
            <div className="wt-mach__conn-row">
              <span>Controller</span>
              <span>{k2?.online && k2.hostname ? k2.hostname : conn.detail}</span>
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
