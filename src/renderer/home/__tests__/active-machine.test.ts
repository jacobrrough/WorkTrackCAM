/**
 * Unit pins for the pure active-machine resolvers (no React, no IPC).
 */
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import {
  machineConnection,
  machineIdentity,
  machineTelemetry,
  machineWorkEnvelope,
  resolveActiveMachine
} from '../active-machine'

const k2: MachineProfile = {
  id: 'creality-k2-plus',
  name: 'K2 Plus',
  kind: 'fdm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  maxFeedMmMin: 36000,
  postTemplate: 'k2.hbs',
  dialect: 'generic_mm',
  maxNozzleTempC: 350,
  maxBedTempC: 120,
  chamberTempC: 60
}
const carvera: MachineProfile = {
  id: 'makera-carvera-3axis',
  name: 'Carvera',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 3000,
  postTemplate: 'carvera.hbs',
  dialect: 'smoothieware',
  axisCount: 3,
  maxSpindleRpm: 15000,
  meta: { cncProfile: '3d' }
}
const laguna: MachineProfile = {
  id: 'laguna-swift-5x10',
  name: 'Laguna Swift',
  kind: 'cnc',
  workAreaMm: { x: 1524, y: 3048, z: 200 },
  maxFeedMmMin: 8000,
  postTemplate: 'laguna.hbs',
  dialect: 'mach3',
  spindleVariantHp: 6
}

describe('resolveActiveMachine', () => {
  it('prefers the live session machine', () => {
    expect(resolveActiveMachine(carvera, [k2, laguna], 'k2')?.id).toBe('makera-carvera-3axis')
  })
  it('falls back to lastMachineId, then first, then null', () => {
    expect(resolveActiveMachine(null, [k2, laguna], 'laguna-swift-5x10')?.id).toBe('laguna-swift-5x10')
    expect(resolveActiveMachine(null, [k2, laguna], 'gone')?.id).toBe('creality-k2-plus')
    expect(resolveActiveMachine(null, [], null)).toBeNull()
  })
})

describe('machineIdentity', () => {
  it('maps kind → mode label + isFdm', () => {
    expect(machineIdentity(k2)).toMatchObject({ name: 'K2 Plus', modeLabel: 'FDM Printer', isFdm: true })
    expect(machineIdentity(carvera).modeLabel).toBe('CNC 3D')
    expect(machineIdentity(laguna).isFdm).toBe(false)
  })
})

describe('machineTelemetry (adaptive by kind)', () => {
  it('FDM shows temp + speed spec tiles', () => {
    const t = machineTelemetry(k2)
    expect(t.map((x) => x.k)).toEqual(['Nozzle max', 'Bed max', 'Chamber', 'Max speed'])
    expect(t[0]).toEqual({ k: 'Nozzle max', v: '350', u: '°C' })
    expect(t[3]).toEqual({ k: 'Max speed', v: '36000', u: 'mm/min' })
  })
  it('CNC shows spindle/feed/work-area tiles; HP fallback when no rpm', () => {
    const c = machineTelemetry(carvera)
    expect(c[0]).toEqual({ k: 'Spindle', v: '15000', u: 'rpm' })
    expect(c[2]).toEqual({ k: 'Work X', v: '360', u: 'mm' })
    expect(machineTelemetry(laguna)[0]).toEqual({ k: 'Spindle', v: '6', u: 'HP' })
  })
})

describe('machineWorkEnvelope + machineConnection', () => {
  it('formats the work envelope', () => {
    expect(machineWorkEnvelope(carvera)).toEqual({ x: 'X 360', y: 'Y 240', z: 'Z 140' })
  })
  it('derives connection by kind/dialect', () => {
    expect(machineConnection(k2)).toEqual({ interfaceLabel: 'Wi-Fi', detail: 'Moonraker' })
    expect(machineConnection(carvera)).toEqual({ interfaceLabel: 'USB', detail: 'Makera Controller' })
    expect(machineConnection(laguna).detail).toBe('RichAuto A-series')
  })
})
