/**
 * Active-machine wiring for the DS Home shell.
 *
 * Pure resolvers + a thin hook over the real {@link useMachineSessionOptional}
 * session. The shell reads the LIVE selected machine (name, kind, profile specs)
 * when mounted in the app, and falls back to {@link SAMPLE_MACHINE} in isolation
 * (tests / no provider). Telemetry here is the machine's real *spec* envelope
 * (from its profile) — live DRO/spindle telemetry doesn't exist for CNC; live
 * FDM temps come separately from Moonraker (see `useK2Telemetry`).
 */
import type { MachineProfile } from '../../shared/machine-schema'
import { useMachineSessionOptional } from '../contexts/MachineSessionContext'
import { fab, getMachineMode, MODE_LABELS } from '../src/shop-types'

/** Fallback machine for isolated renders (no session) — a realistic Carvera. */
export const SAMPLE_MACHINE: MachineProfile = {
  id: 'makera-carvera-3axis',
  name: 'Carvera',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 3000,
  postTemplate: 'carvera.hbs',
  dialect: 'smoothieware',
  axisCount: 3,
  maxSpindleRpm: 15000,
  minSpindleRpm: 5000,
  atcSlotCount: 6,
  meta: { manufacturer: 'Makera', model: 'Carvera', source: 'bundled', cncProfile: '3d' }
}

/** The active machine = live session → last used → first installed → null. */
export function resolveActiveMachine(
  sessionMachine: MachineProfile | null,
  machines: readonly MachineProfile[],
  lastMachineId: string | null
): MachineProfile | null {
  if (sessionMachine) return sessionMachine
  if (lastMachineId) {
    const found = machines.find((m) => m.id === lastMachineId)
    if (found) return found
  }
  return machines[0] ?? null
}

export interface MachineIdentity {
  readonly name: string
  readonly modeLabel: string
  readonly isFdm: boolean
}

export function machineIdentity(m: MachineProfile): MachineIdentity {
  return { name: m.name, modeLabel: MODE_LABELS[getMachineMode(m)], isFdm: m.kind === 'fdm' }
}

export interface TelemetryTile {
  readonly k: string
  readonly v: string
  readonly u: string
}

const num = (n: number | undefined): string => (typeof n === 'number' ? String(n) : '—')

/** Machine-adaptive SPEC tiles derived from the profile (not live values). */
export function machineTelemetry(m: MachineProfile): TelemetryTile[] {
  if (m.kind === 'fdm') {
    return [
      { k: 'Nozzle max', v: num(m.maxNozzleTempC), u: '°C' },
      { k: 'Bed max', v: num(m.maxBedTempC), u: '°C' },
      { k: 'Chamber', v: m.chamberTempC ? String(m.chamberTempC) : '—', u: '°C' },
      { k: 'Max speed', v: num(m.maxFeedMmMin), u: 'mm/min' }
    ]
  }
  const spindle =
    typeof m.maxSpindleRpm === 'number'
      ? { v: String(m.maxSpindleRpm), u: 'rpm' }
      : typeof m.spindleVariantHp === 'number'
        ? { v: String(m.spindleVariantHp), u: 'HP' }
        : { v: '—', u: 'rpm' }
  return [
    { k: 'Spindle', v: spindle.v, u: spindle.u },
    { k: 'Max feed', v: num(m.maxFeedMmMin), u: 'mm/min' },
    { k: 'Work X', v: String(m.workAreaMm.x), u: 'mm' },
    { k: 'Work Y', v: String(m.workAreaMm.y), u: 'mm' }
  ]
}

export interface WorkEnvelope {
  readonly x: string
  readonly y: string
  readonly z: string
}

export function machineWorkEnvelope(m: MachineProfile): WorkEnvelope {
  return { x: `X ${m.workAreaMm.x}`, y: `Y ${m.workAreaMm.y}`, z: `Z ${m.workAreaMm.z}` }
}

export interface MachineConnection {
  readonly interfaceLabel: string
  readonly detail: string
}

export function machineConnection(m: MachineProfile): MachineConnection {
  if (m.kind === 'fdm') return { interfaceLabel: 'Wi-Fi', detail: 'Moonraker' }
  if (m.dialect === 'smoothieware') return { interfaceLabel: 'USB', detail: 'Makera Controller' }
  return { interfaceLabel: 'USB', detail: 'RichAuto A-series' }
}

export interface ActiveMachineView {
  /** Live active machine, or the sample fallback when no session is mounted. */
  readonly machine: MachineProfile
  /** True when a real session is present (vs. the isolated sample fallback). */
  readonly isLive: boolean
  readonly machines: readonly MachineProfile[]
  /** Switch the active machine (the canonical session-switch quad). No-op offline. */
  readonly select: (id: string) => void
}

export function useActiveMachine(): ActiveMachineView {
  const session = useMachineSessionOptional()
  if (!session) {
    return { machine: SAMPLE_MACHINE, isLive: false, machines: [], select: () => {} }
  }
  const machine = resolveActiveMachine(session.sessionMachine, session.machines, session.lastMachineId)
  const select = (id: string): void => {
    const next = session.machines.find((m) => m.id === id)
    if (!next) return
    session.setSessionMachine(next)
    session.setLastMachineId(next.id)
    void fab().settingsSet({ lastMachineId: next.id })
    void session.loadToolsForMachine(next.id)
  }
  return {
    machine: machine ?? SAMPLE_MACHINE,
    isLive: machine !== null,
    machines: session.machines,
    select
  }
}
