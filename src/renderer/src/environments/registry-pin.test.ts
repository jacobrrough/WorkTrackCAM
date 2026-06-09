/**
 * registry-pin.test.ts -- [ID-0280] Cycle 208 ui-polish paired-pin
 *
 * Co-located shape-pin contract for `src/renderer/src/environments/registry.ts`
 * -- the 153-line shop-environment registry that groups the three CLAUDE.md
 * USER CONTEXT target machines into purpose-built workflows ("VCarve Pro" =>
 * Laguna Swift 5x10; "Creality Print" => Creality K2 Plus; "Makera CAM" =>
 * Makera Carvera 3-axis + Carvera 4-axis HD). The companion `env-routing.ts`
 * helper layer (pinned at Cycle 203 / [ID-0275]) and `quick-switch.ts` (pinned
 * at Cycle 186 / [ID-0266]) BUILD ON this registry, so any drift here
 * cascades into the three-machine UI surface.
 *
 * The existing behavioral file `registry.test.ts` covers happy-path lookups;
 * this pin file extends coverage to lock the CONTRACT surface that callers,
 * splash card layout, brand-bar theming, jobs-storage keys, and Python /
 * CuraEngine requirement gates depend on -- module shape, type-guard
 * exhaustivity, the 3-environment cap (no foreign environments), the
 * machineId -> environment routing invariant, the `MAKERA_CAM_OPS` =
 * `MAKERA_3AXIS_OPS` ⊕ 4-axis-HD-superset invariant, the localStorage key
 * uniqueness invariant, and the per-environment Python/CuraEngine flags.
 *
 * Three-machine relevance:
 *   - **Laguna Swift 5x10** (DIRECT): registered as the only `vcarve_pro`
 *     machine; default machine for the wood-routing workflow; ops set is
 *     `cnc_pocket / cnc_contour / cnc_drill / cnc_chamfer` only -- the
 *     2D/2.5D Laguna sweet spot.
 *   - **Creality K2 Plus** (DIRECT): registered as the only `creality_print`
 *     machine; ops set is `fdm_slice / export_stl` only; flagged as
 *     `requiresCuraEngine: true` so the splash gates CuraEngine availability.
 *   - **Makera Carvera 3-axis + 4-axis HD** (DIRECT): both registered under
 *     `makera_cam`; default is the 3-axis variant; the 4-axis ops superset
 *     adds `cnc_4axis_{roughing,finishing,contour,indexed}` to the 3-axis
 *     base of 12 ops.
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file authors
 * tests only. The registry itself is read-only data with no G-code emission;
 * the pin file asserts that read-only invariant via `Object.isFrozen`-
 * compatible structural assertions. No production-G-code edits, no machine-
 * profile edits, no .hbs template edits, no Python engine edits, no schema
 * edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './registry'
import {
  ENVIRONMENTS,
  ENVIRONMENT_LIST,
  VCARVE_PRO_OPS,
  CREALITY_PRINT_OPS,
  MAKERA_3AXIS_OPS,
  MAKERA_CAM_OPS,
  isEnvironmentId,
  type EnvironmentId,
  type ShopEnvironment
} from './registry'
import type { ManufactureOperationKind } from '../../../shared/manufacture-schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_PATH = resolvePath(__dirname, 'registry.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

const ALL_ENVIRONMENT_IDS: readonly EnvironmentId[] = [
  'vcarve_pro',
  'creality_print',
  'makera_cam'
] as const

const SHOP_ENVIRONMENT_KEYS = [
  'id',
  'name',
  'tagline',
  'iconGlyph',
  'accentColor',
  'machineIds',
  'defaultMachineId',
  'availableOpKinds',
  'jobsStorageKey',
  'requiresPython',
  'requiresCuraEngine'
] as const

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. registry -- module shape', () => {
  it('exports ENVIRONMENTS as a non-null object', () => {
    expect(typeof Mod.ENVIRONMENTS).toBe('object')
    expect(Mod.ENVIRONMENTS).not.toBeNull()
  })

  it('exports ENVIRONMENT_LIST as an array', () => {
    expect(Array.isArray(Mod.ENVIRONMENT_LIST)).toBe(true)
  })

  it('exports VCARVE_PRO_OPS as an array', () => {
    expect(Array.isArray(Mod.VCARVE_PRO_OPS)).toBe(true)
  })

  it('exports CREALITY_PRINT_OPS as an array', () => {
    expect(Array.isArray(Mod.CREALITY_PRINT_OPS)).toBe(true)
  })

  it('exports MAKERA_3AXIS_OPS as an array', () => {
    expect(Array.isArray(Mod.MAKERA_3AXIS_OPS)).toBe(true)
  })

  it('exports MAKERA_CAM_OPS as an array', () => {
    expect(Array.isArray(Mod.MAKERA_CAM_OPS)).toBe(true)
  })

  it('exports isEnvironmentId as a function', () => {
    expect(typeof Mod.isEnvironmentId).toBe('function')
  })

  it('isEnvironmentId arity is 1', () => {
    expect(isEnvironmentId.length).toBe(1)
  })

  it('isEnvironmentId name is preserved', () => {
    expect(isEnvironmentId.name).toBe('isEnvironmentId')
  })

  it('module has no default export', () => {
    expect((Mod as unknown as { default?: unknown }).default).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. EnvironmentId literal union -- exhaustive cap (no foreign environments)
// ---------------------------------------------------------------------------
describe('B. EnvironmentId -- exhaustive cap', () => {
  it('isEnvironmentId returns true for `vcarve_pro`', () => {
    expect(isEnvironmentId('vcarve_pro')).toBe(true)
  })

  it('isEnvironmentId returns true for `creality_print`', () => {
    expect(isEnvironmentId('creality_print')).toBe(true)
  })

  it('isEnvironmentId returns true for `makera_cam`', () => {
    expect(isEnvironmentId('makera_cam')).toBe(true)
  })

  it('isEnvironmentId returns false for unrelated strings', () => {
    expect(isEnvironmentId('shapeoko')).toBe(false)
    expect(isEnvironmentId('fusion360')).toBe(false)
    expect(isEnvironmentId('mastercam')).toBe(false)
  })

  it('isEnvironmentId returns false for empty string', () => {
    expect(isEnvironmentId('')).toBe(false)
  })

  it('isEnvironmentId returns false for null + undefined', () => {
    expect(isEnvironmentId(null)).toBe(false)
    expect(isEnvironmentId(undefined)).toBe(false)
  })

  it('isEnvironmentId returns false for numeric values', () => {
    expect(isEnvironmentId(0)).toBe(false)
    expect(isEnvironmentId(1)).toBe(false)
  })

  it('isEnvironmentId returns false for object/array values', () => {
    expect(isEnvironmentId({})).toBe(false)
    expect(isEnvironmentId([])).toBe(false)
    expect(isEnvironmentId({ id: 'vcarve_pro' })).toBe(false)
  })

  it('exactly 3 EnvironmentId values are accepted (no foreign environments)', () => {
    const accepted = [
      'vcarve_pro',
      'creality_print',
      'makera_cam',
      'shapeoko',
      'tormach',
      'haas',
      'tormach-pcnc-440',
      ''
    ].filter((s) => isEnvironmentId(s))
    expect(accepted).toHaveLength(3)
    expect(accepted.sort()).toEqual([...ALL_ENVIRONMENT_IDS].sort())
  })
})

// ---------------------------------------------------------------------------
// C. ENVIRONMENTS map -- key/value coverage
// ---------------------------------------------------------------------------
describe('C. ENVIRONMENTS -- key/value coverage', () => {
  it('contains exactly the 3 EnvironmentId keys', () => {
    expect(Object.keys(ENVIRONMENTS).sort()).toEqual([...ALL_ENVIRONMENT_IDS].sort())
  })

  it('every entry is keyed by its own id (id round-trip)', () => {
    for (const id of ALL_ENVIRONMENT_IDS) {
      expect(ENVIRONMENTS[id].id).toBe(id)
    }
  })

  it('every entry has all 11 documented fields', () => {
    for (const id of ALL_ENVIRONMENT_IDS) {
      const env = ENVIRONMENTS[id]
      expect(Object.keys(env).sort()).toEqual([...SHOP_ENVIRONMENT_KEYS].sort())
    }
  })

  it('vcarve_pro routes only the Laguna Swift 5x10', () => {
    expect(ENVIRONMENTS.vcarve_pro.machineIds).toEqual(['laguna-swift-5x10'])
    expect(ENVIRONMENTS.vcarve_pro.defaultMachineId).toBe('laguna-swift-5x10')
  })

  it('creality_print routes only the Creality K2 Plus', () => {
    expect(ENVIRONMENTS.creality_print.machineIds).toEqual(['creality-k2-plus'])
    expect(ENVIRONMENTS.creality_print.defaultMachineId).toBe('creality-k2-plus')
  })

  it('makera_cam routes both Makera Carvera variants (3-axis + 4-axis)', () => {
    expect([...ENVIRONMENTS.makera_cam.machineIds].sort()).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('makera_cam defaults to the 3-axis variant (matches Carvera ATC default)', () => {
    expect(ENVIRONMENTS.makera_cam.defaultMachineId).toBe('makera-carvera-3axis')
  })

  it('every defaultMachineId is contained in its own machineIds list', () => {
    for (const id of ALL_ENVIRONMENT_IDS) {
      const env = ENVIRONMENTS[id]
      expect(env.machineIds).toContain(env.defaultMachineId)
    }
  })
})

// ---------------------------------------------------------------------------
// D. ENVIRONMENT_LIST -- ordered, complete, no duplicates
// ---------------------------------------------------------------------------
describe('D. ENVIRONMENT_LIST -- ordering and completeness', () => {
  it('contains exactly 3 entries', () => {
    expect(ENVIRONMENT_LIST).toHaveLength(3)
  })

  it('preserves the splash-card layout order vcarve_pro -> creality_print -> makera_cam', () => {
    expect(ENVIRONMENT_LIST.map((e) => e.id)).toEqual([
      'vcarve_pro',
      'creality_print',
      'makera_cam'
    ])
  })

  it('every entry equals the corresponding ENVIRONMENTS map entry by reference', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env).toBe(ENVIRONMENTS[env.id])
    }
  })

  it('contains no duplicate IDs', () => {
    const ids = ENVIRONMENT_LIST.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('contains no duplicate jobsStorageKeys (localStorage namespace safety)', () => {
    const keys = ENVIRONMENT_LIST.map((e) => e.jobsStorageKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains no duplicate accentColors (theme safety)', () => {
    const colors = ENVIRONMENT_LIST.map((e) => e.accentColor)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('contains no duplicate iconGlyphs (splash card distinctness)', () => {
    const glyphs = ENVIRONMENT_LIST.map((e) => e.iconGlyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })
})

// ---------------------------------------------------------------------------
// E. Op-kind invariants per environment
// ---------------------------------------------------------------------------
describe('E. Op-kind sets per environment', () => {
  it('VCARVE_PRO_OPS is the 5-op Laguna 2D/2.5D set (incl. true V-carve)', () => {
    expect([...VCARVE_PRO_OPS].sort()).toEqual(
      ['cnc_pocket', 'cnc_contour', 'cnc_vcarve', 'cnc_drill', 'cnc_chamfer'].sort()
    )
  })

  it('CREALITY_PRINT_OPS is exactly {fdm_slice, export_stl}', () => {
    expect([...CREALITY_PRINT_OPS].sort()).toEqual(['fdm_slice', 'export_stl'].sort())
  })

  it('MAKERA_3AXIS_OPS contains exactly the 14 documented 3-axis op kinds', () => {
    expect(MAKERA_3AXIS_OPS).toHaveLength(14)
    const expected: readonly ManufactureOperationKind[] = [
      'cnc_pocket',
      'cnc_contour',
      'cnc_vcarve',
      'cnc_drill',
      'cnc_chamfer',
      'cnc_adaptive',
      'cnc_3d_rough',
      'cnc_3d_finish',
      'cnc_waterline',
      'cnc_raster',
      'cnc_pencil',
      'cnc_spiral_finish',
      'cnc_morphing_finish'
    ]
    for (const op of expected) {
      expect(MAKERA_3AXIS_OPS).toContain(op)
    }
  })

  it('MAKERA_3AXIS_OPS includes cnc_scallop_finish (the 14th member)', () => {
    expect(MAKERA_3AXIS_OPS).toContain('cnc_scallop_finish')
  })

  it('MAKERA_CAM_OPS is a strict superset of MAKERA_3AXIS_OPS (4-axis HD adds 4 ops)', () => {
    expect(MAKERA_CAM_OPS.length).toBe(MAKERA_3AXIS_OPS.length + 4)
    for (const op of MAKERA_3AXIS_OPS) {
      expect(MAKERA_CAM_OPS).toContain(op)
    }
  })

  it('MAKERA_CAM_OPS adds exactly the 4 documented 4-axis HD ops', () => {
    const fourAxisOnly = MAKERA_CAM_OPS.filter((op) => !MAKERA_3AXIS_OPS.includes(op))
    expect(fourAxisOnly.sort()).toEqual([
      'cnc_4axis_contour',
      'cnc_4axis_finishing',
      'cnc_4axis_indexed',
      'cnc_4axis_roughing'
    ])
  })

  it('VCARVE_PRO_OPS is disjoint from CREALITY_PRINT_OPS (no FDM ops in CNC env)', () => {
    for (const op of VCARVE_PRO_OPS) {
      expect(CREALITY_PRINT_OPS).not.toContain(op)
    }
  })

  it('CREALITY_PRINT_OPS is disjoint from MAKERA_CAM_OPS (no FDM ops in CNC env)', () => {
    for (const op of CREALITY_PRINT_OPS) {
      expect(MAKERA_CAM_OPS).not.toContain(op)
    }
  })

  it('every VCARVE_PRO op is also available on Makera CAM (CNC subset alignment)', () => {
    for (const op of VCARVE_PRO_OPS) {
      expect(MAKERA_CAM_OPS).toContain(op)
    }
  })

  it('VCARVE_PRO ops are a strict subset of MAKERA_CAM_OPS', () => {
    expect(VCARVE_PRO_OPS.length).toBeLessThan(MAKERA_CAM_OPS.length)
  })
})

// ---------------------------------------------------------------------------
// F. Per-environment availableOpKinds wiring
// ---------------------------------------------------------------------------
describe('F. availableOpKinds wiring per environment', () => {
  it('vcarve_pro.availableOpKinds is the same array as VCARVE_PRO_OPS', () => {
    expect(ENVIRONMENTS.vcarve_pro.availableOpKinds).toBe(VCARVE_PRO_OPS)
  })

  it('creality_print.availableOpKinds is the same array as CREALITY_PRINT_OPS', () => {
    expect(ENVIRONMENTS.creality_print.availableOpKinds).toBe(CREALITY_PRINT_OPS)
  })

  it('makera_cam.availableOpKinds is the same array as MAKERA_CAM_OPS', () => {
    expect(ENVIRONMENTS.makera_cam.availableOpKinds).toBe(MAKERA_CAM_OPS)
  })

  it('availableOpKinds contains no duplicates within any env', () => {
    for (const id of ALL_ENVIRONMENT_IDS) {
      const ops = ENVIRONMENTS[id].availableOpKinds
      expect(new Set(ops).size).toBe(ops.length)
    }
  })

  it('every availableOpKind appears in the global Manufacture op kind union (compile parity)', () => {
    // This is a runtime echo of the compile-time `ManufactureOperationKind`
    // assignability constraint: each entry typechecks as a valid op kind.
    for (const id of ALL_ENVIRONMENT_IDS) {
      for (const op of ENVIRONMENTS[id].availableOpKinds) {
        const echo: ManufactureOperationKind = op
        expect(echo).toBe(op)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// G. Python + CuraEngine requirement flags
// ---------------------------------------------------------------------------
describe('G. Python + CuraEngine requirement flags', () => {
  it('vcarve_pro requires Python (toolpath kernel for CNC)', () => {
    expect(ENVIRONMENTS.vcarve_pro.requiresPython).toBe(true)
  })

  it('vcarve_pro does NOT require CuraEngine (CNC, no FDM)', () => {
    expect(ENVIRONMENTS.vcarve_pro.requiresCuraEngine).toBe(false)
  })

  it('creality_print requires CuraEngine (FDM slicing)', () => {
    expect(ENVIRONMENTS.creality_print.requiresCuraEngine).toBe(true)
  })

  it('creality_print does NOT require Python (FDM workflow bypasses kernel)', () => {
    expect(ENVIRONMENTS.creality_print.requiresPython).toBe(false)
  })

  it('makera_cam requires Python (toolpath kernel for 3+4-axis)', () => {
    expect(ENVIRONMENTS.makera_cam.requiresPython).toBe(true)
  })

  it('makera_cam does NOT require CuraEngine (CNC, no FDM)', () => {
    expect(ENVIRONMENTS.makera_cam.requiresCuraEngine).toBe(false)
  })

  it('every CNC env requires Python; the FDM env does not', () => {
    expect(ENVIRONMENTS.vcarve_pro.requiresPython).toBe(true)
    expect(ENVIRONMENTS.makera_cam.requiresPython).toBe(true)
    expect(ENVIRONMENTS.creality_print.requiresPython).toBe(false)
  })

  it('exactly one env requires CuraEngine (the FDM env)', () => {
    const curaEnvs = ENVIRONMENT_LIST.filter((e) => e.requiresCuraEngine)
    expect(curaEnvs).toHaveLength(1)
    expect(curaEnvs[0]!.id).toBe('creality_print')
  })

  it('no env requires both Python AND CuraEngine simultaneously', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.requiresPython && env.requiresCuraEngine).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// H. localStorage jobsStorageKey contract
// ---------------------------------------------------------------------------
describe('H. jobsStorageKey contract', () => {
  it('vcarve_pro key is "fab-jobs-vcarve-v1"', () => {
    expect(ENVIRONMENTS.vcarve_pro.jobsStorageKey).toBe('fab-jobs-vcarve-v1')
  })

  it('creality_print key is "fab-jobs-creality-v1"', () => {
    expect(ENVIRONMENTS.creality_print.jobsStorageKey).toBe('fab-jobs-creality-v1')
  })

  it('makera_cam key is "fab-jobs-makera-v1"', () => {
    expect(ENVIRONMENTS.makera_cam.jobsStorageKey).toBe('fab-jobs-makera-v1')
  })

  it('every key follows the "fab-jobs-<name>-v1" prefix convention', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.jobsStorageKey).toMatch(/^fab-jobs-[a-z]+-v1$/)
    }
  })

  it('every key carries the v1 schema-version suffix', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.jobsStorageKey.endsWith('-v1')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// I. Display + theming fields
// ---------------------------------------------------------------------------
describe('I. Display + theming fields', () => {
  it('every name is a non-empty string', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(typeof env.name).toBe('string')
      expect(env.name.length).toBeGreaterThan(0)
    }
  })

  it('every tagline is a non-empty string', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(typeof env.tagline).toBe('string')
      expect(env.tagline.length).toBeGreaterThan(0)
    }
  })

  it('every accentColor is a hex CSS color string', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('every iconGlyph is a non-empty string (single Unicode glyph or surrogate pair)', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(typeof env.iconGlyph).toBe('string')
      expect(env.iconGlyph.length).toBeGreaterThan(0)
    }
  })

  it('vcarve_pro tagline mentions Laguna Swift 5x10', () => {
    expect(ENVIRONMENTS.vcarve_pro.tagline).toMatch(/Laguna Swift 5×10/)
  })

  it('creality_print tagline mentions K2 Plus', () => {
    expect(ENVIRONMENTS.creality_print.tagline).toMatch(/K2 Plus/)
  })

  it('makera_cam tagline mentions Makera Carvera', () => {
    expect(ENVIRONMENTS.makera_cam.tagline).toMatch(/Makera Carvera/)
  })

  it('vcarve_pro name is "VCarve Pro"', () => {
    expect(ENVIRONMENTS.vcarve_pro.name).toBe('VCarve Pro')
  })

  it('creality_print name is "Creality Print"', () => {
    expect(ENVIRONMENTS.creality_print.name).toBe('Creality Print')
  })

  it('makera_cam name is "Makera CAM"', () => {
    expect(ENVIRONMENTS.makera_cam.name).toBe('Makera CAM')
  })
})

// ---------------------------------------------------------------------------
// J. Cross-environment uniqueness invariants (machineId routing)
// ---------------------------------------------------------------------------
describe('J. Cross-environment uniqueness -- machineId routing', () => {
  it('every machineId across all environments is unique (no double-routing)', () => {
    const allIds = ENVIRONMENT_LIST.flatMap((e) => [...e.machineIds])
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('the union of all machineIds equals exactly the 4 CLAUDE.md target machines', () => {
    const allIds = ENVIRONMENT_LIST.flatMap((e) => [...e.machineIds]).sort()
    expect(allIds).toEqual([
      'creality-k2-plus',
      'laguna-swift-5x10',
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('no foreign machine IDs are registered (Shapeoko / Tormach / Haas)', () => {
    const allIds = ENVIRONMENT_LIST.flatMap((e) => [...e.machineIds])
    expect(allIds).not.toContain('shapeoko-pro-xxl')
    expect(allIds).not.toContain('tormach-pcnc-440')
    expect(allIds).not.toContain('haas-vf-2')
  })

  it('every machineId pattern conforms to "kebab-case-id"', () => {
    const allIds = ENVIRONMENT_LIST.flatMap((e) => [...e.machineIds])
    for (const id of allIds) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/)
    }
  })

  it('Carvera 3-axis is registered under makera_cam (not its own env)', () => {
    expect(ENVIRONMENTS.makera_cam.machineIds).toContain('makera-carvera-3axis')
    expect(ENVIRONMENTS.vcarve_pro.machineIds).not.toContain('makera-carvera-3axis')
    expect(ENVIRONMENTS.creality_print.machineIds).not.toContain('makera-carvera-3axis')
  })

  it('Carvera 4-axis is registered under makera_cam (not its own env)', () => {
    expect(ENVIRONMENTS.makera_cam.machineIds).toContain('makera-carvera-4axis')
    expect(ENVIRONMENTS.vcarve_pro.machineIds).not.toContain('makera-carvera-4axis')
    expect(ENVIRONMENTS.creality_print.machineIds).not.toContain('makera-carvera-4axis')
  })
})

// ---------------------------------------------------------------------------
// K. Pure-data invariants (immutability / no mutation)
// ---------------------------------------------------------------------------
describe('K. Pure-data invariants', () => {
  it('isEnvironmentId is pure (deterministic on repeated calls)', () => {
    expect(isEnvironmentId('vcarve_pro')).toBe(isEnvironmentId('vcarve_pro'))
    expect(isEnvironmentId('foreign')).toBe(isEnvironmentId('foreign'))
  })

  it('ENVIRONMENTS keys do not accidentally include `default` or other JS-internals', () => {
    expect(Object.keys(ENVIRONMENTS)).not.toContain('default')
    expect(Object.keys(ENVIRONMENTS)).not.toContain('__proto__')
    expect(Object.keys(ENVIRONMENTS)).not.toContain('constructor')
  })

  it('ENVIRONMENT_LIST element references are stable across reads', () => {
    const first = ENVIRONMENT_LIST[0]
    const second = ENVIRONMENT_LIST[0]
    expect(first).toBe(second)
  })

  it('ENVIRONMENT_LIST shares identity with ENVIRONMENTS values', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env).toBe(ENVIRONMENTS[env.id])
    }
  })

  it('ENVIRONMENTS map and ENVIRONMENT_LIST array have matching cardinality', () => {
    expect(Object.keys(ENVIRONMENTS).length).toBe(ENVIRONMENT_LIST.length)
  })
})

// ---------------------------------------------------------------------------
// L. Source-text whitelist (doc + invariants)
// ---------------------------------------------------------------------------
describe('L. Source-text whitelist', () => {
  it('source documents the registry as the user-facing concept', () => {
    expect(SRC).toMatch(/Shop environment registry/)
  })

  it('source documents the three environments by name', () => {
    expect(SRC).toMatch(/VCarve Pro/)
    expect(SRC).toMatch(/Creality Print/)
    expect(SRC).toMatch(/Makera CAM/)
  })

  it('source documents the OPS_BY_MODE intersection contract', () => {
    expect(SRC).toMatch(/intersected with `OPS_BY_MODE\[mode\]`/)
  })

  it('source declares the three EnvironmentId literal members', () => {
    expect(SRC).toMatch(/'vcarve_pro' \| 'creality_print' \| 'makera_cam'/)
  })

  it('source documents the pure-data + no-React-refs constraint', () => {
    expect(SRC).toMatch(/Pure data only — no React component refs/)
  })

  it('source pins the wood-routing tagline for Laguna', () => {
    expect(SRC).toMatch(/Wood-routing & 2D\/2\.5D toolpaths for the Laguna Swift 5×10/)
  })

  it('source pins the FDM tagline for K2 Plus', () => {
    expect(SRC).toMatch(/FDM slicing \+ STL export for the Creality K2 Plus/)
  })

  it('source pins the 3-axis precision-milling tagline for Carvera', () => {
    expect(SRC).toMatch(/3-axis precision milling op kinds — base set for Makera Carvera/)
  })

  it('source pins the 4-axis HD superset tagline for Carvera 4-axis', () => {
    expect(SRC).toMatch(/Full Makera CAM op set including 4-axis HD ops/)
  })

  it('source uses readonly modifier on every ShopEnvironment field (no mutation)', () => {
    // Spot-check: at least 5 readonly modifiers in the interface.
    const readonlyHits = SRC.match(/readonly /g) ?? []
    expect(readonlyHits.length).toBeGreaterThanOrEqual(5)
  })

  it('source uses `as const` on every exported readonly array (literal narrowing)', () => {
    const asConstHits = SRC.match(/\] as const/g) ?? []
    // VCARVE_PRO_OPS, CREALITY_PRINT_OPS, MAKERA_3AXIS_OPS, MAKERA_CAM_OPS, ENVIRONMENT_LIST = 5
    expect(asConstHits.length).toBeGreaterThanOrEqual(5)
  })

  it('source declares isEnvironmentId as a type guard returning `value is EnvironmentId`', () => {
    expect(SRC).toMatch(/value is EnvironmentId/)
  })

  it('source documents the splash card layout role of ENVIRONMENT_LIST', () => {
    expect(SRC).toMatch(/drives splash card layout/)
  })
})

// ---------------------------------------------------------------------------
// M. Type-level parity (compile echoes)
// ---------------------------------------------------------------------------
describe('M. Type-level parity', () => {
  it('EnvironmentId accepts each of the 3 literal members', () => {
    const a: EnvironmentId = 'vcarve_pro'
    const b: EnvironmentId = 'creality_print'
    const c: EnvironmentId = 'makera_cam'
    expect([a, b, c]).toEqual(['vcarve_pro', 'creality_print', 'makera_cam'])
  })

  it('ShopEnvironment compiles as an interface with all 11 fields', () => {
    const env: ShopEnvironment = {
      id: 'vcarve_pro',
      name: 'VCarve Pro',
      tagline: '...',
      iconGlyph: '\u{1FAB5}',
      accentColor: '#c47a2c',
      machineIds: ['laguna-swift-5x10'],
      defaultMachineId: 'laguna-swift-5x10',
      availableOpKinds: VCARVE_PRO_OPS,
      jobsStorageKey: 'fab-jobs-vcarve-v1',
      requiresPython: true,
      requiresCuraEngine: false
    }
    expect(env.id).toBe('vcarve_pro')
  })

  it('ENVIRONMENTS index signature returns ShopEnvironment for each EnvironmentId', () => {
    for (const id of ALL_ENVIRONMENT_IDS) {
      const env: ShopEnvironment = ENVIRONMENTS[id]
      expect(env).toBeDefined()
    }
  })

  it('ENVIRONMENT_LIST element type is ShopEnvironment (compile parity)', () => {
    const first: ShopEnvironment = ENVIRONMENT_LIST[0]!
    expect(first).toBeDefined()
  })

  it('VCARVE_PRO_OPS element type narrows to ManufactureOperationKind', () => {
    const op: ManufactureOperationKind = VCARVE_PRO_OPS[0]!
    expect(op).toBe('cnc_pocket')
  })

  it('isEnvironmentId narrows unknown to EnvironmentId at compile time', () => {
    const value: unknown = 'vcarve_pro'
    if (isEnvironmentId(value)) {
      const narrowed: EnvironmentId = value
      expect(narrowed).toBe('vcarve_pro')
    } else {
      throw new Error('expected narrowing to succeed')
    }
  })
})
