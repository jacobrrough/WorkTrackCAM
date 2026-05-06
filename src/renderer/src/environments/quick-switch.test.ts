import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import { resolveQuickSwitchMachine } from './quick-switch'
import { ENVIRONMENTS } from './registry'

/**
 * Mirror of the fixture helper in `env-routing.test.ts` so the two suites
 * stay in lock-step. Only the machine `id` is load-bearing for the resolver
 * — the other fields are required by the `MachineProfile` type.
 */
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

/** Full three-machine shop for happy-path cases. */
const fullShop: readonly MachineProfile[] = [
  fakeMachine('laguna-swift-5x10'),
  fakeMachine('creality-k2-plus', { kind: 'fdm' }),
  fakeMachine('makera-carvera-3axis'),
  fakeMachine('makera-carvera-4axis')
]

describe('environments/quick-switch', () => {
  it('VCarve Pro quick-switch resolves to laguna-swift-5x10 regardless of current machine', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.vcarve_pro,
      fullShop,
      {},
      'makera-carvera-3axis'
    )
    expect(result?.id).toBe('laguna-swift-5x10')
  })

  it('Creality Print quick-switch resolves to creality-k2-plus regardless of current machine', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.creality_print,
      fullShop,
      {},
      'laguna-swift-5x10'
    )
    expect(result?.id).toBe('creality-k2-plus')
  })

  it('Makera CAM on fresh install returns the 3-axis default', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      {},
      null
    )
    expect(result?.id).toBe('makera-carvera-3axis')
  })

  it('Makera CAM restores last-used 4-axis variant from memory', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      null
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('Makera CAM preserves the current variant when already active', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-3axis' }, // variant memory deliberately mismatched
      'makera-carvera-4axis'
    )
    // Idempotent rule wins over variant memory: the env already owns the
    // current machine, so clicking "Makera CAM" is a no-op.
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('Returns null when no machine for the env is installed', () => {
    const shopWithoutK2: readonly MachineProfile[] = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('makera-carvera-3axis')
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.creality_print,
      shopWithoutK2,
      {},
      'laguna-swift-5x10'
    )
    expect(result).toBeNull()
  })
})
