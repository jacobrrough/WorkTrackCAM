import { describe, expect, it } from 'vitest'
import {
  CREALITY_PRINT_OPS,
  ENVIRONMENT_LIST,
  ENVIRONMENTS,
  isEnvironmentId,
  MAKERA_3AXIS_OPS,
  MAKERA_CAM_OPS,
  VCARVE_PRO_OPS,
  type EnvironmentId
} from './registry'

describe('environments/registry', () => {
  it('exports exactly three environments in stable order', () => {
    expect(ENVIRONMENT_LIST.map((e) => e.id)).toEqual([
      'vcarve_pro',
      'creality_print',
      'makera_cam'
    ])
  })

  it('every environment definition has matching id between map and list', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(ENVIRONMENTS[env.id]).toBe(env)
    }
  })

  it('every environment has a non-empty machineIds list and a default that exists in it', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.machineIds.length).toBeGreaterThan(0)
      expect(env.machineIds).toContain(env.defaultMachineId)
    }
  })

  it('jobsStorageKey is unique per environment and prefixed `fab-jobs-`', () => {
    const seen = new Set<string>()
    for (const env of ENVIRONMENT_LIST) {
      expect(env.jobsStorageKey).toMatch(/^fab-jobs-/)
      expect(seen.has(env.jobsStorageKey)).toBe(false)
      seen.add(env.jobsStorageKey)
    }
  })

  it('VCarve Pro routes to laguna-swift-5x10 only', () => {
    expect(ENVIRONMENTS.vcarve_pro.machineIds).toEqual(['laguna-swift-5x10'])
    expect(ENVIRONMENTS.vcarve_pro.defaultMachineId).toBe('laguna-swift-5x10')
    expect(ENVIRONMENTS.vcarve_pro.requiresPython).toBe(true)
    expect(ENVIRONMENTS.vcarve_pro.requiresCuraEngine).toBe(false)
  })

  it('Creality Print routes to creality-k2-plus only', () => {
    expect(ENVIRONMENTS.creality_print.machineIds).toEqual(['creality-k2-plus'])
    expect(ENVIRONMENTS.creality_print.defaultMachineId).toBe('creality-k2-plus')
    expect(ENVIRONMENTS.creality_print.requiresPython).toBe(false)
    expect(ENVIRONMENTS.creality_print.requiresCuraEngine).toBe(true)
  })

  it('Makera CAM routes to both Carvera variants and defaults to 3-axis', () => {
    expect(ENVIRONMENTS.makera_cam.machineIds).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
    expect(ENVIRONMENTS.makera_cam.defaultMachineId).toBe('makera-carvera-3axis')
    expect(ENVIRONMENTS.makera_cam.requiresPython).toBe(true)
  })

  it('VCarve op kinds are wood-routing only and exclude FDM/4-axis', () => {
    for (const kind of VCARVE_PRO_OPS) {
      expect(kind.startsWith('cnc_')).toBe(true)
      expect(kind.startsWith('cnc_4axis')).toBe(false)
      expect(kind).not.toBe('fdm_slice')
    }
  })

  it('Creality op kinds only contain FDM and STL export', () => {
    expect(CREALITY_PRINT_OPS).toContain('fdm_slice')
    expect(CREALITY_PRINT_OPS).toContain('export_stl')
    for (const kind of CREALITY_PRINT_OPS) {
      expect(kind.startsWith('cnc_')).toBe(false)
    }
  })

  it('Makera 3-axis ops are a strict subset of Makera 4-axis ops', () => {
    for (const kind of MAKERA_3AXIS_OPS) {
      expect(MAKERA_CAM_OPS).toContain(kind)
    }
    expect(MAKERA_CAM_OPS.length).toBeGreaterThan(MAKERA_3AXIS_OPS.length)
  })

  it('Makera 4-axis ops include all 4-axis kinds', () => {
    expect(MAKERA_CAM_OPS).toContain('cnc_4axis_roughing')
    expect(MAKERA_CAM_OPS).toContain('cnc_4axis_finishing')
    expect(MAKERA_CAM_OPS).toContain('cnc_4axis_contour')
    expect(MAKERA_CAM_OPS).toContain('cnc_4axis_indexed')
  })

  it('every environment exposes a non-empty op kind list', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.availableOpKinds.length).toBeGreaterThan(0)
    }
  })

  it('every environment has a CSS-parseable accent color', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('isEnvironmentId narrows valid IDs and rejects others', () => {
    expect(isEnvironmentId('vcarve_pro')).toBe(true)
    expect(isEnvironmentId('creality_print')).toBe(true)
    expect(isEnvironmentId('makera_cam')).toBe(true)
    expect(isEnvironmentId('fdm')).toBe(false)
    expect(isEnvironmentId('')).toBe(false)
    expect(isEnvironmentId(null)).toBe(false)
    expect(isEnvironmentId(undefined)).toBe(false)
    expect(isEnvironmentId(42)).toBe(false)
  })

  it('EnvironmentId type covers all three IDs at compile time', () => {
    // Compile-time exhaustive check — fails to typecheck if the union grows
    // without updating callers.
    const exhaust = (id: EnvironmentId): string => {
      switch (id) {
        case 'vcarve_pro':
          return 'v'
        case 'creality_print':
          return 'c'
        case 'makera_cam':
          return 'm'
      }
    }
    expect(exhaust('vcarve_pro')).toBe('v')
    expect(exhaust('creality_print')).toBe('c')
    expect(exhaust('makera_cam')).toBe('m')
  })
})
