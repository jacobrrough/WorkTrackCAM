/**
 * Pinning test for the "My Shop" preset fixtures — enforces the three
 * CLAUDE.md target machines and the three real-world workflows named in
 * the UI Requirements. Drift from the three-machine scope fails this
 * vitest run before it can ship.
 *
 * No DOM rendering — the repo's vitest config runs in a node environment
 * (`vitest.config.ts` → `environment: 'node'`). The MyShopPanel component
 * is a pure function of this data, so pinning the data is equivalent to
 * asserting "only these machines are clickable in the tab surface".
 */
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import { ENVIRONMENTS, isEnvironmentId } from './registry'
import {
  MY_SHOP_MACHINE_IDS,
  MY_SHOP_PRESETS,
  getMyShopPresetsForMachine,
  isMyShopMachineId,
  listMyShopMachines,
  type MyShopMachineId
} from './my-shop-presets'

// Mirrors the fixture helper in `env-routing.test.ts` / `quick-switch.test.ts`
// so the suites stay in lock-step.
const fakeMachine = (
  id: string,
  overrides: Partial<MachineProfile> = {}
): MachineProfile => ({
  id,
  name: id,
  kind: 'cnc',
  workAreaMm: { x: 100, y: 100, z: 100 },
  maxFeedMmMin: 1000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'generic_mm',
  ...overrides
})

describe('environments/my-shop-presets — machine scope', () => {
  it('MY_SHOP_MACHINE_IDS is exactly the three CLAUDE.md target machines', () => {
    expect(MY_SHOP_MACHINE_IDS).toEqual([
      'laguna-swift-5x10',
      'creality-k2-plus',
      'makera-carvera-4axis'
    ])
  })

  it('MY_SHOP_MACHINE_IDS contains no other machine IDs', () => {
    expect(MY_SHOP_MACHINE_IDS.length).toBe(3)
  })

  it('isMyShopMachineId narrows the three target IDs and rejects others', () => {
    expect(isMyShopMachineId('laguna-swift-5x10')).toBe(true)
    expect(isMyShopMachineId('creality-k2-plus')).toBe(true)
    expect(isMyShopMachineId('makera-carvera-4axis')).toBe(true)
    // Makera 3-axis is a registered machine but NOT part of the My Shop
    // rotary-focused surface — the brand-bar env switcher handles that variant.
    expect(isMyShopMachineId('makera-carvera-3axis')).toBe(false)
    // Non-shop IDs must be rejected.
    expect(isMyShopMachineId('prusa-mk4')).toBe(false)
    expect(isMyShopMachineId('')).toBe(false)
    expect(isMyShopMachineId(null)).toBe(false)
    expect(isMyShopMachineId(undefined)).toBe(false)
    expect(isMyShopMachineId(42)).toBe(false)
  })

  it('MyShopMachineId compile-time exhaustive check covers all three IDs', () => {
    const exhaust = (id: MyShopMachineId): string => {
      switch (id) {
        case 'laguna-swift-5x10':
          return 'laguna'
        case 'creality-k2-plus':
          return 'k2'
        case 'makera-carvera-4axis':
          return 'carvera'
      }
    }
    expect(exhaust('laguna-swift-5x10')).toBe('laguna')
    expect(exhaust('creality-k2-plus')).toBe('k2')
    expect(exhaust('makera-carvera-4axis')).toBe('carvera')
  })
})

describe('environments/my-shop-presets — preset catalog', () => {
  it('every preset targets a machine in MY_SHOP_MACHINE_IDS', () => {
    for (const preset of MY_SHOP_PRESETS) {
      expect(MY_SHOP_MACHINE_IDS).toContain(preset.machineId)
    }
  })

  it('every preset routes to an environment whose machineIds include the preset machine', () => {
    for (const preset of MY_SHOP_PRESETS) {
      expect(isEnvironmentId(preset.environmentId)).toBe(true)
      const env = ENVIRONMENTS[preset.environmentId]
      expect(env.machineIds).toContain(preset.machineId)
    }
  })

  it('every preset has a non-empty id, label, description, and unique id', () => {
    const seenIds = new Set<string>()
    for (const preset of MY_SHOP_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
      expect(preset.label.length).toBeGreaterThanOrEqual(3)
      expect(preset.description.length).toBeGreaterThanOrEqual(10)
      expect(seenIds.has(preset.id)).toBe(false)
      seenIds.add(preset.id)
    }
  })

  it('every preset primaryOpKind (if set) is in the target environment availableOpKinds', () => {
    for (const preset of MY_SHOP_PRESETS) {
      if (preset.primaryOpKind === undefined) continue
      const env = ENVIRONMENTS[preset.environmentId]
      expect(env.availableOpKinds).toContain(preset.primaryOpKind)
    }
  })

  it('every target machine has at least one preset', () => {
    for (const machineId of MY_SHOP_MACHINE_IDS) {
      const presetsForMachine = MY_SHOP_PRESETS.filter((p) => p.machineId === machineId)
      expect(presetsForMachine.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('Laguna preset catalog includes the CLAUDE.md "full-sheet routing" workflow', () => {
    const laguna = MY_SHOP_PRESETS.filter((p) => p.machineId === 'laguna-swift-5x10')
    expect(laguna.length).toBeGreaterThanOrEqual(1)
    // CLAUDE.md UI Requirements verbatim: "full-sheet routing"
    const text = laguna.map((p) => `${p.label} ${p.description}`).join(' ').toLowerCase()
    expect(text).toMatch(/full[- ]sheet/)
  })

  it('K2 Plus preset catalog includes the CLAUDE.md "high-speed FDM" workflow', () => {
    const k2 = MY_SHOP_PRESETS.filter((p) => p.machineId === 'creality-k2-plus')
    expect(k2.length).toBeGreaterThanOrEqual(1)
    // CLAUDE.md UI Requirements verbatim: "high-speed FDM"
    const text = k2.map((p) => `${p.label} ${p.description}`).join(' ').toLowerCase()
    expect(text).toMatch(/high[- ]speed fdm/)
  })

  it('Carvera 4-axis preset catalog includes the CLAUDE.md "4-axis rotary parts" workflow', () => {
    const carvera = MY_SHOP_PRESETS.filter((p) => p.machineId === 'makera-carvera-4axis')
    expect(carvera.length).toBeGreaterThanOrEqual(1)
    // CLAUDE.md UI Requirements verbatim: "4-axis rotary parts"
    const text = carvera.map((p) => `${p.label} ${p.description}`).join(' ').toLowerCase()
    expect(text).toMatch(/4[- ]axis rotary/)
  })

  it('no preset references the Makera 3-axis variant (scope-control; 4-axis rotary is the headline workflow)', () => {
    for (const preset of MY_SHOP_PRESETS) {
      expect(preset.machineId).not.toBe('makera-carvera-3axis')
    }
  })
})

describe('environments/my-shop-presets — listMyShopMachines', () => {
  it('returns the three target machines in canonical order when all are present', () => {
    const fullShop: readonly MachineProfile[] = [
      fakeMachine('creality-k2-plus', { kind: 'fdm' }),
      fakeMachine('makera-carvera-3axis'),
      fakeMachine('makera-carvera-4axis'),
      fakeMachine('laguna-swift-5x10')
    ]
    const ordered = listMyShopMachines(fullShop).map((m) => m.id)
    expect(ordered).toEqual([
      'laguna-swift-5x10',
      'creality-k2-plus',
      'makera-carvera-4axis'
    ])
  })

  it('filters out machines not in the My Shop scope (including 3-axis Carvera)', () => {
    const mixedShop: readonly MachineProfile[] = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('creality-k2-plus', { kind: 'fdm' }),
      fakeMachine('makera-carvera-3axis'),
      fakeMachine('makera-carvera-4axis'),
      fakeMachine('prusa-mk4', { kind: 'fdm' }),
      fakeMachine('shapeoko-pro')
    ]
    const ids = listMyShopMachines(mixedShop).map((m) => m.id)
    expect(ids).toEqual([
      'laguna-swift-5x10',
      'creality-k2-plus',
      'makera-carvera-4axis'
    ])
    expect(ids).not.toContain('makera-carvera-3axis')
    expect(ids).not.toContain('prusa-mk4')
    expect(ids).not.toContain('shapeoko-pro')
  })

  it('returns an empty array when no target machines are installed', () => {
    const foreignShop: readonly MachineProfile[] = [
      fakeMachine('prusa-mk4', { kind: 'fdm' }),
      fakeMachine('shapeoko-pro')
    ]
    expect(listMyShopMachines(foreignShop)).toEqual([])
  })

  it('tolerates a partial shop and keeps the canonical order for what is present', () => {
    const partialShop: readonly MachineProfile[] = [
      fakeMachine('makera-carvera-4axis'),
      fakeMachine('laguna-swift-5x10')
    ]
    const ordered = listMyShopMachines(partialShop).map((m) => m.id)
    expect(ordered).toEqual(['laguna-swift-5x10', 'makera-carvera-4axis'])
  })
})

describe('environments/my-shop-presets — getMyShopPresetsForMachine', () => {
  it('returns all presets for a target machine in declaration order', () => {
    const laguna = getMyShopPresetsForMachine('laguna-swift-5x10')
    expect(laguna.length).toBeGreaterThanOrEqual(1)
    for (const p of laguna) expect(p.machineId).toBe('laguna-swift-5x10')

    const k2 = getMyShopPresetsForMachine('creality-k2-plus')
    expect(k2.length).toBeGreaterThanOrEqual(1)
    for (const p of k2) expect(p.machineId).toBe('creality-k2-plus')

    const carvera = getMyShopPresetsForMachine('makera-carvera-4axis')
    expect(carvera.length).toBeGreaterThanOrEqual(1)
    for (const p of carvera) expect(p.machineId).toBe('makera-carvera-4axis')
  })

  it('returns an empty array for non-target machines', () => {
    expect(getMyShopPresetsForMachine('makera-carvera-3axis')).toEqual([])
    expect(getMyShopPresetsForMachine('prusa-mk4')).toEqual([])
    expect(getMyShopPresetsForMachine('')).toEqual([])
  })

  it('concatenated per-machine preset lists equal the full MY_SHOP_PRESETS catalog', () => {
    const concatenated = MY_SHOP_MACHINE_IDS.flatMap((id) =>
      getMyShopPresetsForMachine(id)
    )
    expect(concatenated).toEqual([...MY_SHOP_PRESETS])
  })
})
