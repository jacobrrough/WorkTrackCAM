/**
 * env-action-strip-helpers-pin.test.ts -- [ID-0285] Cycle 213 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/src/environments/env-action-strip-helpers.ts`
 * (118-line / 4038-byte SHARED renderer-side helpers used by `EnvActionStrip.tsx`
 * to power the per-environment quick-pick + variant pill UI). Exports:
 *   - 2 runtime keyword arrays: `WOOD_KEYWORDS`, `FILAMENT_KEYWORDS`.
 *   - 5 pure runtime functions: `isWoodMaterial`, `isFilamentMaterial`,
 *     `resolveMakeraVariants`, `isFourAxisCarvera`, `buildQuickPickMaterials`.
 *
 * Companion behavioral file: `env-action-strip-helpers.test.ts` (5 describe
 * groups / 21 it() blocks). This pin file extends coverage to lock the
 * CONTRACT surface the EnvActionStrip + its three-machine consumers depend on.
 *
 * Three-machine relevance:
 *   - **Laguna Swift 5x10** (DIRECT): the `vcarve_pro` environment uses
 *     `isWoodMaterial` to filter the material library down to wood/MDF/
 *     plywood/oak/pine/maple/birch/walnut/softwood/hardwood for the
 *     Laguna full-sheet routing quick-pick.
 *   - **Creality K2 Plus** (DIRECT): the `creality_print` environment uses
 *     `isFilamentMaterial` to filter the material library down to filament
 *     families (PLA / PETG / ABS / ASA / TPU / nylon / PA6 / PA12 / PC /
 *     polycarbonate / PVA / HIPS / PEEK / PEI / PEKK + literal "filament").
 *   - **Makera Carvera 3-axis + 4-axis HD** (DIRECT): the `makera_cam`
 *     environment uses `resolveMakeraVariants` to pick the 3-axis-then-
 *     4-axis-HD pill ordering, and `isFourAxisCarvera` to label the pill
 *     ("4-Axis HD" vs "3-Axis"). The helper handles both axisCount and
 *     dialect-substring detection (Safety: must match the FOUR 4-axis
 *     dialects shipped in machine-schema.ts -- grbl_4axis / fanuc_4axis /
 *     mach3_4axis / linuxcnc_4axis / siemens_4axis / heidenhain_4axis).
 *   - **Cross-cutting** (DIRECT): the wood and filament filters MUST be
 *     mutually exclusive on the bundled material library so a single
 *     record never appears in both the VCarve and Creality strips
 *     simultaneously. `buildQuickPickMaterials` provides the merge logic
 *     that keeps the currently-selected material visible while
 *     prioritizing predicate-matched records.
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file authors
 * tests only. No production-G-code edits, no machine-profile edits, no .hbs
 * template edits, no Python engine edits, no schema edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './env-action-strip-helpers'
import {
  WOOD_KEYWORDS,
  FILAMENT_KEYWORDS,
  isWoodMaterial,
  isFilamentMaterial,
  resolveMakeraVariants,
  isFourAxisCarvera,
  buildQuickPickMaterials
} from './env-action-strip-helpers'
import { ENVIRONMENTS } from './registry'
import type { MachineProfile } from '../../../shared/machine-schema'
import type { MaterialRecord } from '../../../shared/material-schema'

// ---------------------------------------------------------------------------
// Helpers (fixture factories)
// ---------------------------------------------------------------------------

const SRC_PATH = resolvePath(__dirname, 'env-action-strip-helpers.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

function makeMaterial(
  id: string,
  name: string,
  category: MaterialRecord['category'] = 'other'
): MaterialRecord {
  return {
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
  }
}

function makeMachine(id: string, overrides: Partial<MachineProfile> = {}): MachineProfile {
  return {
    id,
    name: id,
    kind: 'cnc',
    workAreaMm: { x: 100, y: 100, z: 100 },
    maxFeedMmMin: 1000,
    postTemplate: 'cnc_generic_mm.hbs',
    dialect: 'generic_mm',
    ...overrides
  } as MachineProfile
}

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------

describe('A. module shape -- env-action-strip-helpers', () => {
  it('exports exactly 7 runtime symbols (2 keyword arrays + 5 functions)', () => {
    const keys = Object.keys(Mod)
      .filter((k) => k !== 'default')
      .sort()
    expect(keys).toEqual(
      [
        'FILAMENT_KEYWORDS',
        'WOOD_KEYWORDS',
        'buildQuickPickMaterials',
        'isFilamentMaterial',
        'isFourAxisCarvera',
        'isWoodMaterial',
        'resolveMakeraVariants'
      ].sort()
    )
  })

  it('has Symbol.toStringTag of Module (ESM module record)', () => {
    expect((Mod as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('has no default export', () => {
    expect((Mod as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('keyword arrays are exported as arrays of strings', () => {
    expect(Array.isArray(Mod.WOOD_KEYWORDS)).toBe(true)
    expect(Array.isArray(Mod.FILAMENT_KEYWORDS)).toBe(true)
    for (const kw of Mod.WOOD_KEYWORDS) expect(typeof kw).toBe('string')
    for (const kw of Mod.FILAMENT_KEYWORDS) expect(typeof kw).toBe('string')
  })

  it('the 5 function exports are functions (not classes / objects)', () => {
    expect(typeof Mod.isWoodMaterial).toBe('function')
    expect(typeof Mod.isFilamentMaterial).toBe('function')
    expect(typeof Mod.resolveMakeraVariants).toBe('function')
    expect(typeof Mod.isFourAxisCarvera).toBe('function')
    expect(typeof Mod.buildQuickPickMaterials).toBe('function')
  })

  it('does not export a "default" / re-export the registry / pull React', () => {
    expect((Mod as unknown as Record<string, unknown>).ENVIRONMENTS).toBeUndefined()
    expect((Mod as unknown as Record<string, unknown>).default).toBeUndefined()
    expect((Mod as unknown as Record<string, unknown>).React).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. WOOD_KEYWORDS contract
// ---------------------------------------------------------------------------

describe('B. WOOD_KEYWORDS contract', () => {
  it('contains exactly the 10 expected wood keywords', () => {
    expect(WOOD_KEYWORDS).toEqual([
      'wood',
      'plywood',
      'mdf',
      'oak',
      'pine',
      'maple',
      'birch',
      'walnut',
      'softwood',
      'hardwood'
    ])
  })

  it('all keywords are lowercase (case-insensitive matching is by lower()-ing input)', () => {
    for (const kw of WOOD_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase())
    }
  })

  it('all keywords are non-empty strings (no accidental "")', () => {
    for (const kw of WOOD_KEYWORDS) {
      expect(typeof kw).toBe('string')
      expect(kw.length).toBeGreaterThan(0)
    }
  })

  it('contains no duplicate entries', () => {
    expect(new Set(WOOD_KEYWORDS).size).toBe(WOOD_KEYWORDS.length)
  })

  it('does NOT contain filament family keywords (mutual exclusion at array level)', () => {
    const wood = new Set(WOOD_KEYWORDS)
    const offenders = ['pla', 'petg', 'abs', 'tpu', 'nylon', 'polycarbonate', 'peek']
    for (const o of offenders) expect(wood.has(o)).toBe(false)
  })

  it('contains the 4 main bundled MDF/plywood category names', () => {
    const wood = new Set(WOOD_KEYWORDS)
    expect(wood.has('mdf')).toBe(true)
    expect(wood.has('plywood')).toBe(true)
    expect(wood.has('softwood')).toBe(true)
    expect(wood.has('hardwood')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C. FILAMENT_KEYWORDS contract
// ---------------------------------------------------------------------------

describe('C. FILAMENT_KEYWORDS contract', () => {
  it('contains exactly the 17 expected filament keywords', () => {
    expect(FILAMENT_KEYWORDS).toEqual([
      'pla',
      'petg',
      'pet-g',
      'abs',
      'asa',
      'tpu',
      'nylon',
      'pa6',
      'pa12',
      'pc',
      'polycarbonate',
      'pva',
      'hips',
      'peek',
      'pei',
      'pekk',
      'filament'
    ])
  })

  it('all keywords are lowercase', () => {
    for (const kw of FILAMENT_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase())
    }
  })

  it('contains both PETG variants (with and without dash)', () => {
    expect(FILAMENT_KEYWORDS).toContain('petg')
    expect(FILAMENT_KEYWORDS).toContain('pet-g')
  })

  it('contains the literal "filament" fallback as the last entry', () => {
    expect(FILAMENT_KEYWORDS[FILAMENT_KEYWORDS.length - 1]).toBe('filament')
  })

  it('does NOT contain wood keywords (mutual exclusion at array level)', () => {
    const filament = new Set(FILAMENT_KEYWORDS)
    const offenders = ['wood', 'plywood', 'mdf', 'oak', 'pine', 'maple', 'birch', 'walnut', 'softwood', 'hardwood']
    for (const o of offenders) expect(filament.has(o)).toBe(false)
  })

  it('contains all engineering filament families', () => {
    const filament = new Set(FILAMENT_KEYWORDS)
    expect(filament.has('peek')).toBe(true)
    expect(filament.has('pei')).toBe(true)
    expect(filament.has('pekk')).toBe(true)
    expect(filament.has('polycarbonate')).toBe(true)
  })

  it('contains no duplicate entries', () => {
    expect(new Set(FILAMENT_KEYWORDS).size).toBe(FILAMENT_KEYWORDS.length)
  })
})

// ---------------------------------------------------------------------------
// D. isWoodMaterial behavior
// ---------------------------------------------------------------------------

describe('D. isWoodMaterial -- VCarve Pro / Laguna wood filter', () => {
  it('has function name "isWoodMaterial" and arity 1', () => {
    expect(isWoodMaterial.name).toBe('isWoodMaterial')
    expect(isWoodMaterial.length).toBe(1)
  })

  it('matches WALNUT (uppercase) by name keyword', () => {
    expect(isWoodMaterial(makeMaterial('m', 'WALNUT slab'))).toBe(true)
  })

  it('matches by category (softwood, hardwood, plywood, mdf)', () => {
    expect(isWoodMaterial(makeMaterial('m', 'X', 'softwood'))).toBe(true)
    expect(isWoodMaterial(makeMaterial('m', 'X', 'hardwood'))).toBe(true)
    expect(isWoodMaterial(makeMaterial('m', 'X', 'plywood'))).toBe(true)
    expect(isWoodMaterial(makeMaterial('m', 'X', 'mdf'))).toBe(true)
  })

  it('returns false for empty / missing name AND empty category', () => {
    expect(isWoodMaterial(makeMaterial('m', '', 'other'))).toBe(false)
    const noName = { id: 'x', cutParams: { default: { surfaceSpeedMMin: 1, chiploadMm: 0.01, docFactor: 0.5, stepoverFactor: 0.4, plungeFactor: 0.3 } } } as unknown as MaterialRecord
    expect(isWoodMaterial(noName)).toBe(false)
  })

  it('handles undefined name without throwing (?? fallback to "")', () => {
    const m = { id: 'x', cutParams: { default: { surfaceSpeedMMin: 1, chiploadMm: 0.01, docFactor: 0.5, stepoverFactor: 0.4, plungeFactor: 0.3 } } } as unknown as MaterialRecord
    expect(() => isWoodMaterial(m)).not.toThrow()
    expect(isWoodMaterial(m)).toBe(false)
  })

  it('does not match aluminum / steel / brass / acrylic stock', () => {
    expect(isWoodMaterial(makeMaterial('m', 'Aluminum 6061', 'aluminum_6061'))).toBe(false)
    expect(isWoodMaterial(makeMaterial('m', 'Mild Steel', 'steel_mild'))).toBe(false)
    expect(isWoodMaterial(makeMaterial('m', 'Brass'))).toBe(false)
    expect(isWoodMaterial(makeMaterial('m', 'Acrylic', 'acrylic'))).toBe(false)
  })

  it('matches partial substrings (Birch ply -> birch keyword)', () => {
    expect(isWoodMaterial(makeMaterial('m', 'Birch ply'))).toBe(true)
  })

  it('matches mixed-case names (Pine Cedar -> pine keyword)', () => {
    expect(isWoodMaterial(makeMaterial('m', 'Pine Cedar Board'))).toBe(true)
  })

  it('does NOT mutate the material record', () => {
    const m = makeMaterial('m', 'Walnut')
    const snapshot = JSON.parse(JSON.stringify(m))
    isWoodMaterial(m)
    expect(JSON.parse(JSON.stringify(m))).toEqual(snapshot)
  })

  it('returns false when only name has unrelated wood-like substring (no keyword match)', () => {
    expect(isWoodMaterial(makeMaterial('m', 'Foam', 'foam'))).toBe(false)
    expect(isWoodMaterial(makeMaterial('m', 'HDPE', 'hdpe'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E. isFilamentMaterial behavior
// ---------------------------------------------------------------------------

describe('E. isFilamentMaterial -- Creality Print / K2 Plus filament filter', () => {
  it('has function name "isFilamentMaterial" and arity 1', () => {
    expect(isFilamentMaterial.name).toBe('isFilamentMaterial')
    expect(isFilamentMaterial.length).toBe(1)
  })

  it('matches all major filament families by name (case-insensitive)', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'PLA Generic'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'PETG Black'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'PET-G Tough'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'ABS White'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'TPU 95A'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'Nylon CF'))).toBe(true)
  })

  it('matches "filament" literal as fallback', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'Custom Filament'))).toBe(true)
  })

  it('matches engineering filaments PEEK / PEI / PEKK', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'PEEK CF30'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'PEI High Temp'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'PEKK Ultra'))).toBe(true)
  })

  it('does NOT match wood / metal / acrylic CNC stock', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'Plywood', 'plywood'))).toBe(false)
    expect(isFilamentMaterial(makeMaterial('m', 'Aluminum 6061', 'aluminum_6061'))).toBe(false)
    expect(isFilamentMaterial(makeMaterial('m', 'Mild Steel', 'steel_mild'))).toBe(false)
    expect(isFilamentMaterial(makeMaterial('m', 'Acrylic', 'acrylic'))).toBe(false)
  })

  it('handles undefined name without throwing', () => {
    const m = { id: 'x', cutParams: { default: { surfaceSpeedMMin: 1, chiploadMm: 0.01, docFactor: 0.5, stepoverFactor: 0.4, plungeFactor: 0.3 } } } as unknown as MaterialRecord
    expect(() => isFilamentMaterial(m)).not.toThrow()
    expect(isFilamentMaterial(m)).toBe(false)
  })

  it('matches case-insensitively (lowercase name with uppercase keyword)', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'pla generic'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'petg tough'))).toBe(true)
  })

  it('matches by category alone (when name does not match)', () => {
    // Per source: matches `name OR category` -- if category contains keyword, match.
    expect(isFilamentMaterial(makeMaterial('m', 'Generic Material', 'pla' as MaterialRecord['category']))).toBe(true)
  })

  it('matches "polycarbonate" full word', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'Polycarbonate Pro'))).toBe(true)
  })

  it('matches PA6 and PA12 short names', () => {
    expect(isFilamentMaterial(makeMaterial('m', 'PA6 GF'))).toBe(true)
    expect(isFilamentMaterial(makeMaterial('m', 'PA12'))).toBe(true)
  })

  it('does NOT mutate the material record', () => {
    const m = makeMaterial('m', 'PLA Generic')
    const snapshot = JSON.parse(JSON.stringify(m))
    isFilamentMaterial(m)
    expect(JSON.parse(JSON.stringify(m))).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// F. wood-vs-filament mutual exclusion
// ---------------------------------------------------------------------------

describe('F. wood vs filament mutual exclusion (cross-strip safety)', () => {
  it('the bundled CNC catalog should never match the filament filter', () => {
    const cncSamples = [
      makeMaterial('m1', 'Softwood (Pine / Cedar)', 'softwood'),
      makeMaterial('m2', 'Hardwood (Oak / Maple / Walnut)', 'hardwood'),
      makeMaterial('m3', 'MDF', 'mdf'),
      makeMaterial('m4', 'Plywood', 'plywood'),
      makeMaterial('m5', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('m6', 'Mild Steel (A36 / 1018)', 'steel_mild'),
      makeMaterial('m7', 'Stainless Steel', 'stainless'),
      makeMaterial('m8', 'Brass'),
      makeMaterial('m9', 'Acrylic', 'acrylic'),
      makeMaterial('m10', 'HDPE', 'hdpe'),
      makeMaterial('m11', 'Delrin'),
      makeMaterial('m12', 'Foam', 'foam')
    ]
    for (const m of cncSamples) {
      expect(isFilamentMaterial(m)).toBe(false)
    }
  })

  it('the filament catalog should never match the wood filter', () => {
    const filamentSamples = [
      makeMaterial('m1', 'PLA Generic'),
      makeMaterial('m2', 'PETG Tough'),
      makeMaterial('m3', 'ABS White'),
      makeMaterial('m4', 'TPU 95A'),
      makeMaterial('m5', 'Nylon CF'),
      makeMaterial('m6', 'PEEK CF30')
    ]
    for (const m of filamentSamples) {
      expect(isWoodMaterial(m)).toBe(false)
    }
  })

  it('a single record is never matched by BOTH filters simultaneously', () => {
    const samples = [
      makeMaterial('m1', 'Softwood (Pine / Cedar)', 'softwood'),
      makeMaterial('m2', 'Hardwood (Oak / Maple / Walnut)', 'hardwood'),
      makeMaterial('m3', 'MDF', 'mdf'),
      makeMaterial('m4', 'Plywood', 'plywood'),
      makeMaterial('m5', 'PLA Generic'),
      makeMaterial('m6', 'PETG Tough'),
      makeMaterial('m7', 'TPU 95A'),
      makeMaterial('m8', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('m9', 'PEEK')
    ]
    for (const m of samples) {
      expect(isWoodMaterial(m) && isFilamentMaterial(m)).toBe(false)
    }
  })

  it('bundled "Foam / Tooling Board" record matches NEITHER filter', () => {
    const m = makeMaterial('m', 'Foam / Tooling Board', 'foam')
    expect(isWoodMaterial(m)).toBe(false)
    expect(isFilamentMaterial(m)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// G. resolveMakeraVariants behavior
// ---------------------------------------------------------------------------

describe('G. resolveMakeraVariants -- Carvera 3-axis + 4-axis HD pill ordering', () => {
  it('has function name "resolveMakeraVariants" and arity 2', () => {
    expect(resolveMakeraVariants.name).toBe('resolveMakeraVariants')
    expect(resolveMakeraVariants.length).toBe(2)
  })

  it('returns variants in env.machineIds order (NOT input order)', () => {
    const reversed = [
      makeMachine('makera-carvera-4axis', { axisCount: 4, dialect: 'grbl_4axis' }),
      makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'grbl' })
    ]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, reversed)
    expect(variants.map((m) => m.id)).toEqual(['makera-carvera-3axis', 'makera-carvera-4axis'])
  })

  it('omits variants missing from the global machine list', () => {
    const machines = [makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'grbl' })]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants.map((m) => m.id)).toEqual(['makera-carvera-3axis'])
  })

  it('returns [] when no Carvera variants are installed', () => {
    const machines = [makeMachine('laguna-swift-5x10', { axisCount: 3 })]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants).toEqual([])
  })

  it('returns [] when input machines is empty', () => {
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, [])
    expect(variants).toEqual([])
  })

  it('preserves the MachineProfile reference (no clone)', () => {
    const m3 = makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'grbl' })
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, [m3])
    expect(variants[0]).toBe(m3)
  })

  it('does NOT mutate the input machines array', () => {
    const machines = [
      makeMachine('makera-carvera-4axis', { axisCount: 4, dialect: 'grbl_4axis' }),
      makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'grbl' })
    ]
    const lenBefore = machines.length
    const idsBefore = machines.map((m) => m.id)
    resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(machines.length).toBe(lenBefore)
    expect(machines.map((m) => m.id)).toEqual(idsBefore)
  })

  it('handles duplicate machineIds gracefully (find returns first)', () => {
    // Two records with the same id; resolver picks the first via .find().
    const dup1 = makeMachine('makera-carvera-3axis', { axisCount: 3 })
    const dup2 = makeMachine('makera-carvera-3axis', { axisCount: 3, name: 'Other' })
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, [dup1, dup2])
    expect(variants.length).toBe(1)
    expect(variants[0]).toBe(dup1)
  })
})

// ---------------------------------------------------------------------------
// H. isFourAxisCarvera behavior
// ---------------------------------------------------------------------------

describe('H. isFourAxisCarvera -- pill label predicate', () => {
  it('has function name "isFourAxisCarvera" and arity 1', () => {
    expect(isFourAxisCarvera.name).toBe('isFourAxisCarvera')
    expect(isFourAxisCarvera.length).toBe(1)
  })

  it('detects 4-axis by axisCount=4', () => {
    expect(isFourAxisCarvera(makeMachine('m', { axisCount: 4 }))).toBe(true)
  })

  it('detects 5-axis (axisCount>=4) as well', () => {
    expect(isFourAxisCarvera(makeMachine('m', { axisCount: 5 }))).toBe(true)
  })

  it('detects 4-axis by dialect substring (grbl_4axis)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'grbl_4axis' }))).toBe(true)
  })

  it('detects 4-axis by dialect substring (fanuc_4axis)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'fanuc_4axis' }))).toBe(true)
  })

  it('detects 4-axis by dialect substring (mach3_4axis)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'mach3_4axis' }))).toBe(true)
  })

  it('detects 4-axis by dialect substring (linuxcnc_4axis, siemens_4axis, heidenhain_4axis)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'linuxcnc_4axis' }))).toBe(true)
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'siemens_4axis' }))).toBe(true)
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'heidenhain_4axis' }))).toBe(true)
  })

  it('returns false for 3-axis machines (axisCount=3, dialect grbl)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { axisCount: 3, dialect: 'grbl' }))).toBe(false)
  })

  it('returns false for 3-axis machines (axisCount=3, dialect mach3)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { axisCount: 3, dialect: 'mach3' }))).toBe(false)
  })

  it('returns false for 3-axis machines (axisCount=3, dialect smoothieware)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { axisCount: 3, dialect: 'smoothieware' }))).toBe(false)
  })

  it('treats missing axisCount as 3 (uses (axisCount ?? 3) >= 4 fallback)', () => {
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'grbl' }))).toBe(false)
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'mach3' }))).toBe(false)
  })

  it('returns true when axisCount missing but dialect contains 4axis', () => {
    expect(isFourAxisCarvera(makeMachine('m', { dialect: 'siemens_4axis' }))).toBe(true)
  })

  it('does NOT mutate the machine profile', () => {
    const m = makeMachine('m', { axisCount: 4, dialect: 'grbl_4axis' })
    const snapshot = JSON.parse(JSON.stringify(m))
    isFourAxisCarvera(m)
    expect(JSON.parse(JSON.stringify(m))).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// I. buildQuickPickMaterials behavior
// ---------------------------------------------------------------------------

describe('I. buildQuickPickMaterials -- quick-pick subset builder', () => {
  it('has function name "buildQuickPickMaterials" and arity 3 (limit has default)', () => {
    expect(buildQuickPickMaterials.name).toBe('buildQuickPickMaterials')
    // Function.length counts params before first default; `limit = 6` is default-initialized -> not counted.
    expect(buildQuickPickMaterials.length).toBe(3)
  })

  it('keeps the currently selected material visible at index 0', () => {
    const mats = [
      makeMaterial('a', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('b', 'Plywood', 'plywood'),
      makeMaterial('c', 'Hardwood', 'hardwood')
    ]
    const picks = buildQuickPickMaterials(mats, 'a', isWoodMaterial, 2)
    expect(picks[0].id).toBe('a')
  })

  it('prioritizes predicate-matched records when no selection', () => {
    const mats = [
      makeMaterial('a', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('b', 'Plywood', 'plywood'),
      makeMaterial('c', 'Hardwood', 'hardwood')
    ]
    const picks = buildQuickPickMaterials(mats, null, isWoodMaterial, 2)
    expect(picks.map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('falls back to all materials when no records match the filter', () => {
    const mats = [
      makeMaterial('a', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('b', 'Mild Steel', 'steel_mild')
    ]
    const picks = buildQuickPickMaterials(mats, null, isFilamentMaterial, 2)
    expect(picks.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('honors the limit parameter (default 6)', () => {
    const mats = Array.from({ length: 20 }, (_, i) => makeMaterial(`m${i}`, `PLA ${i}`))
    const picks = buildQuickPickMaterials(mats, null, isFilamentMaterial)
    expect(picks.length).toBe(6)
  })

  it('honors a custom limit', () => {
    const mats = Array.from({ length: 10 }, (_, i) => makeMaterial(`m${i}`, `PLA ${i}`))
    const picks = buildQuickPickMaterials(mats, null, isFilamentMaterial, 3)
    expect(picks.length).toBe(3)
  })

  it('selected NOT in materials list is silently ignored (no exception)', () => {
    const mats = [makeMaterial('a', 'Plywood', 'plywood')]
    const picks = buildQuickPickMaterials(mats, 'unknown', isWoodMaterial, 2)
    expect(picks.map((m) => m.id)).toEqual(['a'])
  })

  it('selected null behaves like no-selection (predicate path)', () => {
    const mats = [makeMaterial('a', 'PLA Generic'), makeMaterial('b', 'PETG')]
    const picks = buildQuickPickMaterials(mats, null, isFilamentMaterial)
    expect(picks.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('does not produce duplicates when selected is also predicate-matched', () => {
    const mats = [
      makeMaterial('a', 'Plywood', 'plywood'),
      makeMaterial('b', 'Hardwood', 'hardwood')
    ]
    const picks = buildQuickPickMaterials(mats, 'a', isWoodMaterial, 5)
    expect(picks.map((m) => m.id)).toEqual(['a', 'b'])
    // 'a' should NOT appear twice.
    expect(new Set(picks.map((m) => m.id)).size).toBe(picks.length)
  })

  it('returns empty array when materials list is empty', () => {
    expect(buildQuickPickMaterials([], null, isWoodMaterial, 5)).toEqual([])
    expect(buildQuickPickMaterials([], 'a', isWoodMaterial, 5)).toEqual([])
  })

  it('does NOT mutate the materials array', () => {
    const mats = [
      makeMaterial('a', 'PLA Generic'),
      makeMaterial('b', 'PETG')
    ]
    const lenBefore = mats.length
    const idsBefore = mats.map((m) => m.id)
    buildQuickPickMaterials(mats, null, isFilamentMaterial)
    expect(mats.length).toBe(lenBefore)
    expect(mats.map((m) => m.id)).toEqual(idsBefore)
  })

  it('returned array is a fresh reference (not the input)', () => {
    const mats = [makeMaterial('a', 'PLA Generic')]
    const picks = buildQuickPickMaterials(mats, null, isFilamentMaterial)
    expect(picks).not.toBe(mats)
  })

  it('selected always appears at index 0 (selected push happens before limit check)', () => {
    // Note: the function pushes the selected unconditionally BEFORE the loop
    // checks limit, so limit=1 with both selected + fallback yields length 2.
    // The CONTRACT pin is: index 0 is always the selected material.
    const mats = [
      makeMaterial('a', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('b', 'Plywood', 'plywood')
    ]
    const picks = buildQuickPickMaterials(mats, 'a', isWoodMaterial, 1)
    expect(picks[0]).toBe(mats[0])
    expect(picks.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// J. Three-machine path realism
// ---------------------------------------------------------------------------

describe('J. three-machine path realism', () => {
  it('VCarve Pro / Laguna -- bundled wood catalog quick-pick', () => {
    const catalog = [
      makeMaterial('softwood', 'Softwood (Pine / Cedar)', 'softwood'),
      makeMaterial('hardwood', 'Hardwood (Oak / Maple / Walnut)', 'hardwood'),
      makeMaterial('mdf', 'MDF', 'mdf'),
      makeMaterial('plywood', 'Plywood', 'plywood'),
      makeMaterial('aluminum', 'Aluminum 6061', 'aluminum_6061')
    ]
    const picks = buildQuickPickMaterials(catalog, null, isWoodMaterial)
    expect(picks.map((m) => m.id)).toEqual(['softwood', 'hardwood', 'mdf', 'plywood'])
  })

  it('Creality Print / K2 Plus -- bundled filament catalog quick-pick', () => {
    const catalog = [
      makeMaterial('pla', 'PLA Generic'),
      makeMaterial('petg', 'PETG Tough'),
      makeMaterial('abs', 'ABS White'),
      makeMaterial('tpu', 'TPU 95A'),
      makeMaterial('peek', 'PEEK CF30'),
      makeMaterial('aluminum', 'Aluminum 6061', 'aluminum_6061')
    ]
    const picks = buildQuickPickMaterials(catalog, null, isFilamentMaterial)
    expect(picks.map((m) => m.id)).toEqual(['pla', 'petg', 'abs', 'tpu', 'peek'])
  })

  it('Makera CAM / Carvera -- both 3-axis and 4-axis variants resolve in declared order', () => {
    const machines = [
      makeMachine('laguna-swift-5x10', { axisCount: 3, dialect: 'mach3' }),
      makeMachine('makera-carvera-4axis', { axisCount: 4, dialect: 'grbl_4axis' }),
      makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'smoothieware' })
    ]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants.map((m) => m.id)).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
    expect(isFourAxisCarvera(variants[0])).toBe(false)
    expect(isFourAxisCarvera(variants[1])).toBe(true)
  })

  it('Carvera 3-axis only (4-axis HD module not installed): one variant', () => {
    const machines = [makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'smoothieware' })]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants.length).toBe(1)
    expect(isFourAxisCarvera(variants[0])).toBe(false)
  })

  it('Carvera 4-axis only (3-axis variant absent from registry): pill labels 4-Axis HD', () => {
    const machines = [makeMachine('makera-carvera-4axis', { axisCount: 4, dialect: 'grbl_4axis' })]
    const variants = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(variants.length).toBe(1)
    expect(isFourAxisCarvera(variants[0])).toBe(true)
  })

  it('the wood and filament filters are mutually exclusive on the 4-machine bundled catalog', () => {
    const samples = [
      makeMaterial('m1', 'Plywood', 'plywood'),
      makeMaterial('m2', 'PLA Generic'),
      makeMaterial('m3', 'Aluminum 6061', 'aluminum_6061'),
      makeMaterial('m4', 'Walnut', 'hardwood'),
      makeMaterial('m5', 'PETG'),
      makeMaterial('m6', 'PEEK CF30')
    ]
    for (const m of samples) {
      expect(isWoodMaterial(m) && isFilamentMaterial(m)).toBe(false)
    }
  })

  it('environment registry is referenced via the makera_cam env id (CLAUDE.md USER CONTEXT)', () => {
    expect(ENVIRONMENTS.makera_cam.machineIds).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })
})

// ---------------------------------------------------------------------------
// K. Source-text whitelist
// ---------------------------------------------------------------------------

describe('K. source-text whitelist -- production source invariants', () => {
  it('declares WOOD_KEYWORDS as an exported const array', () => {
    expect(SRC).toContain('export const WOOD_KEYWORDS')
  })

  it('declares FILAMENT_KEYWORDS as an exported const array', () => {
    expect(SRC).toContain('export const FILAMENT_KEYWORDS')
  })

  it('declares the 5 functions as exports', () => {
    expect(SRC).toContain('export function isWoodMaterial(')
    expect(SRC).toContain('export function isFilamentMaterial(')
    expect(SRC).toContain('export function resolveMakeraVariants(')
    expect(SRC).toContain('export function isFourAxisCarvera(')
    expect(SRC).toContain('export function buildQuickPickMaterials(')
  })

  it('uses .toLowerCase() for case-insensitive matching', () => {
    expect(SRC).toContain('.toLowerCase()')
  })

  it('uses .some(...) for keyword scan (not .every() / .find())', () => {
    expect(SRC).toContain('.some((kw) => name.includes(kw) || category.includes(kw))')
  })

  it('uses (axisCount ?? 3) >= 4 for 4-axis detection (not >= 3)', () => {
    expect(SRC).toContain('(m.axisCount ?? 3) >= 4')
    expect(SRC).not.toContain('(m.axisCount ?? 3) >= 3')
  })

  it('uses dialect.includes("4axis") substring check', () => {
    expect(SRC).toContain("m.dialect.includes('4axis')")
  })

  it('preserves the env.machineIds order in resolveMakeraVariants', () => {
    expect(SRC).toContain('env.machineIds')
    expect(SRC).toContain('.map((id) => machines.find((m) => m.id === id))')
  })

  it('uses ?? "" fallback for name and category to avoid undefined.toLowerCase()', () => {
    expect(SRC).toContain("(m.name ?? '').toLowerCase()")
  })

  it('is a renderer-side .ts module (no React import; can run in node)', () => {
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/import React/)
  })

  it('imports MachineProfile + MaterialRecord via type-only import', () => {
    expect(SRC).toMatch(/import type \{ MachineProfile, MaterialRecord \} from '\.\.\/shop-types'/)
  })

  it('imports ShopEnvironment via type-only import', () => {
    expect(SRC).toMatch(/import type \{ ShopEnvironment \} from '\.\/registry'/)
  })

  it('does NOT contain TODO / FIXME / HACK markers', () => {
    expect(SRC).not.toMatch(/\bTODO\b/)
    expect(SRC).not.toMatch(/\bFIXME\b/)
    expect(SRC).not.toMatch(/\bHACK\b/)
  })

  it('does NOT contain `: any` / `as any` annotations (Safety Rule 4)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas any\b/)
  })

  it('uses readonly readonly on the resolveMakeraVariants machines parameter', () => {
    expect(SRC).toContain('readonly MachineProfile[]')
  })

  it('declares the limit default of 6 in buildQuickPickMaterials', () => {
    expect(SRC).toContain('limit = 6')
  })

  it('uses the prioritized.length > 0 ? prioritized : [...materials] fallback pattern', () => {
    expect(SRC).toContain('prioritized.length > 0 ? prioritized : [...materials]')
  })
})

// ---------------------------------------------------------------------------
// L. Pure-function invariants
// ---------------------------------------------------------------------------

describe('L. pure-function invariants -- no input mutation, deterministic', () => {
  it('isWoodMaterial: repeated calls return the same value', () => {
    const m = makeMaterial('m', 'Walnut')
    expect(isWoodMaterial(m)).toBe(isWoodMaterial(m))
  })

  it('isFilamentMaterial: repeated calls return the same value', () => {
    const m = makeMaterial('m', 'PLA')
    expect(isFilamentMaterial(m)).toBe(isFilamentMaterial(m))
  })

  it('resolveMakeraVariants: repeated calls return deeply-equal arrays', () => {
    const machines = [
      makeMachine('makera-carvera-4axis', { axisCount: 4, dialect: 'grbl_4axis' }),
      makeMachine('makera-carvera-3axis', { axisCount: 3, dialect: 'smoothieware' })
    ]
    const r1 = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    const r2 = resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)
    expect(r1).toEqual(r2)
  })

  it('isFourAxisCarvera: repeated calls return the same value', () => {
    const m = makeMachine('m', { axisCount: 4, dialect: 'grbl_4axis' })
    expect(isFourAxisCarvera(m)).toBe(isFourAxisCarvera(m))
  })

  it('buildQuickPickMaterials: repeated calls return deeply-equal arrays', () => {
    const mats = [makeMaterial('a', 'PLA'), makeMaterial('b', 'PETG')]
    const r1 = buildQuickPickMaterials(mats, 'a', isFilamentMaterial)
    const r2 = buildQuickPickMaterials(mats, 'a', isFilamentMaterial)
    expect(r1).toEqual(r2)
  })

  it('all 5 functions can run on a frozen input without throwing', () => {
    const m = Object.freeze(makeMaterial('m', 'PLA')) as MaterialRecord
    expect(() => isWoodMaterial(m)).not.toThrow()
    expect(() => isFilamentMaterial(m)).not.toThrow()

    const machine = Object.freeze(makeMachine('m', { axisCount: 4, dialect: 'grbl_4axis' })) as MachineProfile
    expect(() => isFourAxisCarvera(machine)).not.toThrow()

    const machines = Object.freeze([machine]) as readonly MachineProfile[]
    expect(() => resolveMakeraVariants(ENVIRONMENTS.makera_cam, machines)).not.toThrow()

    const mats = Object.freeze([m]) as readonly MaterialRecord[]
    expect(() => buildQuickPickMaterials(mats, null, isFilamentMaterial)).not.toThrow()
  })
})
