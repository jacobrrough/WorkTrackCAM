import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import {
  getDefaultMachineForEnvironment,
  getEnvironmentById,
  getEnvironmentForMachine,
  getMachinesForEnvironment
} from './env-routing'
import { ENVIRONMENTS } from './registry'

const fakeMachine = (id: string, overrides: Partial<MachineProfile> = {}): MachineProfile => ({
  id,
  name: id,
  kind: 'cnc',
  workAreaMm: { x: 100, y: 100, z: 100 },
  maxFeedMmMin: 1000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'generic_mm',
  ...overrides
})

describe('environments/env-routing', () => {
  it('returns null when machineId is null/undefined/empty', () => {
    expect(getEnvironmentForMachine(null)).toBeNull()
    expect(getEnvironmentForMachine(undefined)).toBeNull()
    expect(getEnvironmentForMachine('')).toBeNull()
  })

  it('returns null for unknown machine IDs', () => {
    expect(getEnvironmentForMachine('totally-fake-machine')).toBeNull()
  })

  it('routes laguna-swift-5x10 to vcarve_pro', () => {
    const env = getEnvironmentForMachine('laguna-swift-5x10')
    expect(env?.id).toBe('vcarve_pro')
  })

  it('routes creality-k2-plus to creality_print', () => {
    const env = getEnvironmentForMachine('creality-k2-plus')
    expect(env?.id).toBe('creality_print')
  })

  it('routes both Makera Carvera variants to makera_cam', () => {
    expect(getEnvironmentForMachine('makera-carvera-3axis')?.id).toBe('makera_cam')
    expect(getEnvironmentForMachine('makera-carvera-4axis')?.id).toBe('makera_cam')
  })

  it('getDefaultMachineForEnvironment finds the env default in a machine list', () => {
    const machines = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('makera-carvera-3axis')
    ]
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, machines)
    expect(def?.id).toBe('laguna-swift-5x10')
  })

  it('getDefaultMachineForEnvironment returns null when default is missing from list', () => {
    const machines = [fakeMachine('some-other-machine')]
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, machines)).toBeNull()
  })

  it('getMachinesForEnvironment returns owned machines in declared order', () => {
    const machines = [
      fakeMachine('makera-carvera-4axis'), // out of declared order
      fakeMachine('makera-carvera-3axis'),
      fakeMachine('laguna-swift-5x10') // belongs to vcarve_pro, not makera
    ]
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, machines)
    expect(owned.map((m) => m.id)).toEqual(['makera-carvera-3axis', 'makera-carvera-4axis'])
  })

  it('getMachinesForEnvironment returns empty list when no owned machines are present', () => {
    const machines = [fakeMachine('unrelated')]
    expect(getMachinesForEnvironment(ENVIRONMENTS.creality_print, machines)).toEqual([])
  })

  it('getEnvironmentById resolves all three IDs', () => {
    expect(getEnvironmentById('vcarve_pro').id).toBe('vcarve_pro')
    expect(getEnvironmentById('creality_print').id).toBe('creality_print')
    expect(getEnvironmentById('makera_cam').id).toBe('makera_cam')
  })

  it('every machineId in the registry round-trips through getEnvironmentForMachine', () => {
    for (const env of [ENVIRONMENTS.vcarve_pro, ENVIRONMENTS.creality_print, ENVIRONMENTS.makera_cam]) {
      for (const id of env.machineIds) {
        expect(getEnvironmentForMachine(id)?.id).toBe(env.id)
      }
    }
  })
})
