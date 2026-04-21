import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import type { MaterialRecord } from '../../../shared/material-schema'
import {
  buildQuickPickMaterials,
  FILAMENT_KEYWORDS,
  isFilamentMaterial,
  isFourAxisCarvera,
  isWoodMaterial,
  resolveMakeraVariants,
  WOOD_KEYWORDS
} from './env-action-strip-helpers'
import { ENVIRONMENTS } from './registry'

// ── Fixtures ────────────────────────────────────────────────────────────────

const fakeMaterial = (
  id: string,
  name: string,
  category: MaterialRecord['category'] = 'other'
): MaterialRecord => ({
  id,
  name,
  category,
  cutParams: {
    default: {
      surfaceSpeedMMin: 100,
      chiploadMm: 0.05,
      docFactor: 0.5,
      stepoverFactor: 0.4,
      plungeFactor: 0.3
    }
  }
})

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

// ── isWoodMaterial ──────────────────────────────────────────────────────────

describe('env-action-strip-helpers / isWoodMaterial', () => {
  it('matches by category for the bundled wood categories', () => {
    expect(isWoodMaterial(fakeMaterial('m1', 'Anything', 'softwood'))).toBe(true)
    expect(isWoodMaterial(fakeMaterial('m2', 'Anything', 'hardwood'))).toBe(true)
    expect(isWoodMaterial(fakeMaterial('m3', 'Anything', 'plywood'))).toBe(true)
    expect(isWoodMaterial(fakeMaterial('m4', 'Anything', 'mdf'))).toBe(true)
  })

  it('matches by name keyword (case-insensitive)', () => {
    expect(isWoodMaterial(fakeMaterial('m1', 'Red Oak Plank'))).toBe(true)
    expect(isWoodMaterial(fakeMaterial('m2', 'WALNUT slab'))).toBe(true)
    expect(isWoodMaterial(fakeMaterial('m3', 'Birch ply'))).toBe(true)
    expect(isWoodMaterial(fakeMaterial('m4', 'maple butcher block'))).toBe(true)
  })

  it('does not match CNC stock that is unrelated to wood', () => {
    expect(isWoodMaterial(fakeMaterial('m1', 'Aluminum 6061', 'aluminum_6061'))).toBe(false)
    expect(isWoodMaterial(fakeMaterial('m2', 'Mild Steel', 'steel_mild'))).toBe(false)
    expect(isWoodMaterial(fakeMaterial('m3', 'Acrylic', 'acrylic'))).toBe(false)
    expect(isWoodMaterial(fakeMaterial('m4', 'Brass'))).toBe(false)
  })

  it('exports a non-empty WOOD_KEYWORDS list with all keywords lowercase', () => {
    expect(WOOD_KEYWORDS.length).toBeGreaterThan(0)
    for (const kw of WOOD_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase())
    }
  })
})

// ── isFilamentMaterial ──────────────────────────────────────────────────────

describe('env-action-strip-helpers / isFilamentMaterial', () => {
  it('matches all major filament families by name', () => {
    expect(isFilamentMaterial(fakeMaterial('m1', 'PLA Generic'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m2', 'PETG Black'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m3', 'ABS White'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m4', 'TPU 95A'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m5', 'Nylon CF'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m6', 'ASA Outdoor'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m7', 'Polycarbonate Pro'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m8', 'PEEK CF30'))).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isFilamentMaterial(fakeMaterial('m1', 'pla generic'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m2', 'PETg Tough'))).toBe(true)
    expect(isFilamentMaterial(fakeMaterial('m3', 'tpu 95a'))).toBe(true)
  })

  it('does NOT match CNC stock from the bundled material library', () => {
    // None of the bundled CNC materials should ever appear in the filament strip.
    expect(isFilamentMaterial(fakeMaterial('m1', 'Softwood (Pine / Cedar)', 'softwood'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m2', 'Hardwood (Oak / Maple / Walnut)', 'hardwood'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m3', 'MDF', 'mdf'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m4', 'Plywood', 'plywood'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m5', 'Aluminum 6061', 'aluminum_6061'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m6', 'Mild Steel (A36 / 1018)', 'steel_mild'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m7', 'Stainless Steel (304 / 316)', 'stainless'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m8', 'Brass (360 Free-Machining)', 'brass'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m9', 'Acrylic (PMMA / Plexiglass)', 'acrylic'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m10', 'HDPE', 'hdpe'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m11', 'Delrin / POM / Acetal', 'delrin'))).toBe(false)
    expect(isFilamentMaterial(fakeMaterial('m12', 'Foam / Tooling Board', 'foam'))).toBe(false)
  })

  it('matches the literal "filament" keyword as a fallback', () => {
    expect(isFilamentMaterial(fakeMaterial('m1', 'Custom Filament'))).toBe(true)
  })

  it('exports a non-empty FILAMENT_KEYWORDS list with all keywords lowercase', () => {
    expect(FILAMENT_KEYWORDS.length).toBeGreaterThan(0)
    for (const kw of FILAMENT_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase())
    }
  })

  it('the wood and filament filters are mutually exclusive on the bundled library', () => {
    // Critical guarantee: a single record should never appear in BOTH the
    // VCarve and Creality strips simultaneously.
    const samples = [
      fakeMaterial('m1', 'Softwood (Pine / Cedar)', 'softwood'),
      fakeMaterial('m2', 'Hardwood (Oak / Maple / Walnut)', 'hardwood'),
      fakeMaterial('m3', 'MDF', 'mdf'),
      fakeMaterial('m4', 'Plywood', 'plywood'),
      fakeMaterial('m5', 'PLA Generic'),
      fakeMaterial('m6', 'PETG Tough'),
      fakeMaterial('m7', 'TPU 95A')
    ]
    for (const m of samples) {
      expect(isWoodMaterial(m) && isFilamentMaterial(m)).toBe(false)
    }
  })
})

// ── resolveMakeraVariants & isFourAxisCarvera ───────────────────────────────

describe('env-action-strip-helpers / resolveMakeraVariants', () => {
  it('returns variants in the order declared by the environment', () => {
    // Intentionally pass machines in reverse order to prove the function
    // honors `env.machineIds` order, not the input order.
    const machines = [
      fakeMachine('makera-carvera-4axis', { axisCount: 4, dialect: 'grbl_4axis' }),
      fakeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'grbl' })
    ]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants.map((m) => m.id)).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('omits variants that are missing from the global machine list', () => {
    const machines = [fakeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'grbl' })]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants.map((m) => m.id)).toEqual(['makera-carvera-3axis'])
  })

  it('returns an empty array when no Carvera variants are installed', () => {
    const machines = [fakeMachine('laguna-swift-5x10', { axisCount: 3 })]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants).toEqual([])
  })
})

describe('env-action-strip-helpers / isFourAxisCarvera', () => {
  it('detects 4-axis variants by axisCount', () => {
    expect(isFourAxisCarvera(fakeMachine('m', { axisCount: 4 }))).toBe(true)
    expect(isFourAxisCarvera(fakeMachine('m', { axisCount: 5 }))).toBe(true)
  })

  it('detects 4-axis variants by dialect string', () => {
    expect(isFourAxisCarvera(fakeMachine('m', { dialect: 'grbl_4axis' }))).toBe(true)
    expect(isFourAxisCarvera(fakeMachine('m', { dialect: 'fanuc_4axis' }))).toBe(true)
    expect(isFourAxisCarvera(fakeMachine('m', { dialect: 'mach3_4axis' }))).toBe(true)
  })

  it('returns false for 3-axis machines', () => {
    expect(isFourAxisCarvera(fakeMachine('m', { axisCount: 3, dialect: 'grbl' }))).toBe(false)
    expect(isFourAxisCarvera(fakeMachine('m', { axisCount: 3, dialect: 'mach3' }))).toBe(false)
  })

  it('treats missing axisCount as 3 (defaults to false unless dialect indicates 4-axis)', () => {
    expect(isFourAxisCarvera(fakeMachine('m', { dialect: 'mach3' }))).toBe(false)
    expect(isFourAxisCarvera(fakeMachine('m', { dialect: 'siemens_4axis' }))).toBe(true)
  })
})

describe('env-action-strip-helpers / buildQuickPickMaterials', () => {
  it('keeps the currently selected material visible', () => {
    const mats = [
      fakeMaterial('a', 'Aluminum 6061', 'aluminum_6061'),
      fakeMaterial('b', 'Plywood', 'plywood'),
      fakeMaterial('c', 'Hardwood', 'hardwood')
    ]
    const picks = buildQuickPickMaterials(mats, 'a', isWoodMaterial, 2)
    expect(picks.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('falls back to all materials when no records match the filter', () => {
    const mats = [
      fakeMaterial('a', 'Aluminum 6061', 'aluminum_6061'),
      fakeMaterial('b', 'Mild Steel', 'steel_mild')
    ]
    const picks = buildQuickPickMaterials(mats, null, isFilamentMaterial, 2)
    expect(picks.map((m) => m.id)).toEqual(['a', 'b'])
  })
})
