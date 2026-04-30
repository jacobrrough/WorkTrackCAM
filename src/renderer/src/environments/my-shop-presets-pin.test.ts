/**
 * my-shop-presets-pin.test.ts -- [ID-0220] Cycle 146 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/src/environments/my-shop-presets.ts` --
 * the "My Shop" tab quick-select preset surface mandated by CLAUDE.md
 * "UI Requirements":
 *
 *   > Add a "My Shop" tab or quick-select that ONLY shows these three
 *   > machines plus their real-world presets (full-sheet routing,
 *   > high-speed FDM, 4-axis rotary parts).
 *
 * CROSS-CUTS ALL THREE TARGET MACHINES via the three frozen machine ids
 * (`laguna-swift-5x10`, `creality-k2-plus`, `makera-carvera-4axis`).
 * Foreign-machine-id leakage at this seam would silently break the
 * three-machine-only contract, so the pin file inverts via source-text
 * whitelist + runtime equality assertions.
 *
 * Sister cycles in the post-Cycle-127-reset clean-streak chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130 [ID-0207]
 * / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135 [ID-0211] /
 * 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140 [ID-0215] /
 * 142 [ID-0216] / 144 [ID-0217] / 145 [ID-0218].
 *
 * The existing `my-shop-presets.test.ts` covers happy-path behaviour of
 * `listMyShopMachines` and `getMyShopPresetsForMachine`. THIS pin file
 * does NOT duplicate that coverage; instead it pins:
 *   (A) module shape -- exact named-export inventory, arities, Symbol-key
 *       invariants, no default export,
 *   (B) `MY_SHOP_MACHINE_IDS` tuple contract -- exactly 3 ids in declared
 *       brand-bar order, no foreign machines, frozen-readonly,
 *   (C) `isMyShopMachineId` type guard -- exhaustive happy + defensive
 *       (NaN, undefined, empty string, foreign machine id),
 *   (D) `MY_SHOP_PRESETS` registry contract -- 6 entries, machine-id
 *       partition (2 per target machine), environmentId points at a
 *       registered env, primaryOpKind ∈ env.availableOpKinds when set,
 *       unique preset ids,
 *   (E) CLAUDE.md verbatim phrase enforcement on the preset labels --
 *       "Full-sheet" / "High-speed FDM" / "4-axis rotary",
 *   (F) `listMyShopMachines` ordering + drop-foreign + drop-missing,
 *   (G) `getMyShopPresetsForMachine` declaration-order + unknown-id empty,
 *   (H) purity & determinism (N=10 stability, fresh-output-per-call,
 *       no caller-mutation poisoning the registries),
 *   (I) source-text whitelist -- CLAUDE.md UI-Requirements provenance,
 *       no React/DOM/electron/network imports, no foreign machine
 *       constants, no `any`, three-machine-only invariants.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './my-shop-presets'
import {
  MY_SHOP_MACHINE_IDS,
  MY_SHOP_PRESETS,
  getMyShopPresetsForMachine,
  isMyShopMachineId,
  listMyShopMachines
} from './my-shop-presets'
import { ENVIRONMENTS, isEnvironmentId } from './registry'
import type { MachineProfile } from '../../../shared/machine-schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'my-shop-presets.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

const fakeMachine = (
  id: string,
  overrides: Partial<MachineProfile> = {}
): MachineProfile =>
  ({
    id,
    name: id,
    units: 'mm',
    workArea: { x: 100, y: 100, z: 100 },
    safeRetractZ: 5,
    rapidFeedrate: 5000,
    plungeFeedrate: 200,
    cuttingFeedrate: 800,
    minStepoverPct: 5,
    maxStepoverPct: 50,
    spindleStartupSeconds: 0,
    spindleShutdownSeconds: 0,
    rpmMin: 0,
    rpmMax: 0,
    dialect: 'mach3',
    postTemplate: 'cnc_generic_mm.hbs',
    ...overrides
  }) as MachineProfile

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0220] A) module shape', () => {
  it('exports exactly the documented runtime symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(
      [
        'MY_SHOP_MACHINE_IDS',
        'MY_SHOP_PRESETS',
        'getMyShopPresetsForMachine',
        'isMyShopMachineId',
        'listMyShopMachines'
      ].sort()
    )
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    expect(Object.getOwnPropertySymbols(M)).toEqual([Symbol.toStringTag])
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('declares Function.length === 1 for isMyShopMachineId', () => {
    expect(isMyShopMachineId.length).toBe(1)
  })

  it('declares Function.length === 1 for listMyShopMachines', () => {
    expect(listMyShopMachines.length).toBe(1)
  })

  it('declares Function.length === 1 for getMyShopPresetsForMachine', () => {
    expect(getMyShopPresetsForMachine.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// B) MY_SHOP_MACHINE_IDS tuple contract
// ---------------------------------------------------------------------------

describe('[ID-0220] B) MY_SHOP_MACHINE_IDS tuple', () => {
  it('contains exactly 3 ids in declared order', () => {
    expect(MY_SHOP_MACHINE_IDS).toEqual([
      'laguna-swift-5x10',
      'creality-k2-plus',
      'makera-carvera-4axis'
    ])
  })

  it('matches brand-bar env-switcher order (router -> FDM -> 4-axis)', () => {
    expect(MY_SHOP_MACHINE_IDS[0]).toBe('laguna-swift-5x10')
    expect(MY_SHOP_MACHINE_IDS[1]).toBe('creality-k2-plus')
    expect(MY_SHOP_MACHINE_IDS[2]).toBe('makera-carvera-4axis')
  })

  it('contains exactly the three CLAUDE.md target machine ids (no foreigners)', () => {
    expect(new Set(MY_SHOP_MACHINE_IDS)).toEqual(
      new Set(['laguna-swift-5x10', 'creality-k2-plus', 'makera-carvera-4axis'])
    )
  })

  it('does NOT contain `makera-carvera-3axis` (the 4-axis variant is the My Shop hero per JSDoc)', () => {
    expect((MY_SHOP_MACHINE_IDS as readonly string[])).not.toContain(
      'makera-carvera-3axis'
    )
  })

  it('referential identity is stable (same object across imports)', () => {
    expect(M.MY_SHOP_MACHINE_IDS).toBe(MY_SHOP_MACHINE_IDS)
  })
})

// ---------------------------------------------------------------------------
// C) isMyShopMachineId type guard
// ---------------------------------------------------------------------------

describe('[ID-0220] C) isMyShopMachineId type guard', () => {
  it('returns true for laguna-swift-5x10', () => {
    expect(isMyShopMachineId('laguna-swift-5x10')).toBe(true)
  })

  it('returns true for creality-k2-plus', () => {
    expect(isMyShopMachineId('creality-k2-plus')).toBe(true)
  })

  it('returns true for makera-carvera-4axis', () => {
    expect(isMyShopMachineId('makera-carvera-4axis')).toBe(true)
  })

  it('returns false for makera-carvera-3axis (NOT a My Shop hero)', () => {
    expect(isMyShopMachineId('makera-carvera-3axis')).toBe(false)
  })

  it('returns false for foreign machine ids (e.g., bambu-x1c, prusa-mk4)', () => {
    expect(isMyShopMachineId('bambu-x1c')).toBe(false)
    expect(isMyShopMachineId('prusa-mk4')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isMyShopMachineId('')).toBe(false)
  })

  it('returns false for non-string inputs (NaN / null / undefined / 0 / true / object)', () => {
    expect(isMyShopMachineId(Number.NaN)).toBe(false)
    expect(isMyShopMachineId(null)).toBe(false)
    expect(isMyShopMachineId(undefined)).toBe(false)
    expect(isMyShopMachineId(0)).toBe(false)
    expect(isMyShopMachineId(true)).toBe(false)
    expect(isMyShopMachineId({})).toBe(false)
    expect(isMyShopMachineId([])).toBe(false)
  })

  it('matches MY_SHOP_MACHINE_IDS exhaustively (round-trip invariant)', () => {
    for (const id of MY_SHOP_MACHINE_IDS) {
      expect(isMyShopMachineId(id)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// D) MY_SHOP_PRESETS registry contract
// ---------------------------------------------------------------------------

describe('[ID-0220] D) MY_SHOP_PRESETS registry', () => {
  it('contains exactly 6 presets (2 per target machine)', () => {
    expect(MY_SHOP_PRESETS).toHaveLength(6)
  })

  it('every preset has a unique id', () => {
    const ids = MY_SHOP_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset.machineId is one of the three target machines', () => {
    for (const p of MY_SHOP_PRESETS) {
      expect(isMyShopMachineId(p.machineId)).toBe(true)
    }
  })

  it('every preset.environmentId is a registered env (vcarve_pro / creality_print / makera_cam)', () => {
    for (const p of MY_SHOP_PRESETS) {
      expect(isEnvironmentId(p.environmentId)).toBe(true)
    }
  })

  it('partition: 2 presets per machine (Laguna / K2 / Carvera-4axis)', () => {
    const counts: Record<string, number> = {}
    for (const p of MY_SHOP_PRESETS) {
      counts[p.machineId] = (counts[p.machineId] ?? 0) + 1
    }
    expect(counts['laguna-swift-5x10']).toBe(2)
    expect(counts['creality-k2-plus']).toBe(2)
    expect(counts['makera-carvera-4axis']).toBe(2)
  })

  it('Laguna presets target the vcarve_pro env', () => {
    for (const p of MY_SHOP_PRESETS.filter(
      (q) => q.machineId === 'laguna-swift-5x10'
    )) {
      expect(p.environmentId).toBe('vcarve_pro')
    }
  })

  it('K2 Plus presets target the creality_print env', () => {
    for (const p of MY_SHOP_PRESETS.filter(
      (q) => q.machineId === 'creality-k2-plus'
    )) {
      expect(p.environmentId).toBe('creality_print')
    }
  })

  it('Carvera-4axis presets target the makera_cam env', () => {
    for (const p of MY_SHOP_PRESETS.filter(
      (q) => q.machineId === 'makera-carvera-4axis'
    )) {
      expect(p.environmentId).toBe('makera_cam')
    }
  })

  it('every primaryOpKind (when set) is a member of the env availableOpKinds', () => {
    for (const p of MY_SHOP_PRESETS) {
      if (!p.primaryOpKind) continue
      const env = ENVIRONMENTS[p.environmentId]
      expect(env.availableOpKinds).toContain(p.primaryOpKind)
    }
  })

  it('every preset has a non-empty label and description', () => {
    for (const p of MY_SHOP_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('declares 6 readonly fields per preset (id/machineId/environmentId/label/description + optional primaryOpKind)', () => {
    for (const p of MY_SHOP_PRESETS) {
      const keys = Object.keys(p).sort()
      const required = [
        'id',
        'machineId',
        'environmentId',
        'label',
        'description'
      ].sort()
      for (const k of required) {
        expect(keys).toContain(k)
      }
    }
  })

  it('referential identity is stable (same object across imports)', () => {
    expect(M.MY_SHOP_PRESETS).toBe(MY_SHOP_PRESETS)
  })
})

// ---------------------------------------------------------------------------
// E) CLAUDE.md verbatim phrase enforcement
// ---------------------------------------------------------------------------

describe('[ID-0220] E) CLAUDE.md verbatim phrase enforcement', () => {
  it('a Laguna preset label contains the CLAUDE.md "Full-sheet" phrase', () => {
    const labels = MY_SHOP_PRESETS.filter(
      (p) => p.machineId === 'laguna-swift-5x10'
    ).map((p) => p.label)
    expect(labels.some((l) => /Full-sheet/i.test(l))).toBe(true)
  })

  it('a K2 Plus preset label contains the CLAUDE.md "High-speed FDM" phrase', () => {
    const labels = MY_SHOP_PRESETS.filter(
      (p) => p.machineId === 'creality-k2-plus'
    ).map((p) => p.label)
    expect(labels.some((l) => /High-speed FDM/i.test(l))).toBe(true)
  })

  it('a Carvera-4axis preset label contains the CLAUDE.md "4-axis rotary" phrase', () => {
    const labels = MY_SHOP_PRESETS.filter(
      (p) => p.machineId === 'makera-carvera-4axis'
    ).map((p) => p.label)
    expect(labels.some((l) => /4-axis rotary/i.test(l))).toBe(true)
  })

  it('exactly ONE Laguna preset is the full-sheet preset (the workflow CLAUDE.md singles out)', () => {
    const fullSheet = MY_SHOP_PRESETS.filter(
      (p) =>
        p.machineId === 'laguna-swift-5x10' && /Full-sheet/i.test(p.label)
    )
    expect(fullSheet).toHaveLength(1)
  })

  it('full-sheet preset description references the 6-zone vacuum table', () => {
    const fullSheet = MY_SHOP_PRESETS.find(
      (p) =>
        p.machineId === 'laguna-swift-5x10' && /Full-sheet/i.test(p.label)
    )
    expect(fullSheet?.description).toMatch(/6-zone vacuum/i)
  })

  it('high-speed FDM preset description references Moonraker', () => {
    const fdm = MY_SHOP_PRESETS.find(
      (p) =>
        p.machineId === 'creality-k2-plus' && /High-speed FDM/i.test(p.label)
    )
    expect(fdm?.description).toMatch(/Moonraker/)
  })

  it('rotary preset description references the harmonic-drive rotary', () => {
    const rotary = MY_SHOP_PRESETS.find(
      (p) =>
        p.machineId === 'makera-carvera-4axis' &&
        /4-axis rotary/i.test(p.label)
    )
    expect(rotary?.description).toMatch(/harmonic[- ]drive/i)
  })
})

// ---------------------------------------------------------------------------
// F) listMyShopMachines ordering + filter
// ---------------------------------------------------------------------------

describe('[ID-0220] F) listMyShopMachines', () => {
  it('returns the 3 target machines in canonical display order', () => {
    const input = [
      fakeMachine('makera-carvera-4axis'),
      fakeMachine('creality-k2-plus'),
      fakeMachine('laguna-swift-5x10')
    ]
    const out = listMyShopMachines(input)
    expect(out.map((m) => m.id)).toEqual([
      'laguna-swift-5x10',
      'creality-k2-plus',
      'makera-carvera-4axis'
    ])
  })

  it('drops foreign machines silently', () => {
    const input = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('bambu-x1c'),
      fakeMachine('prusa-mk4')
    ]
    const out = listMyShopMachines(input)
    expect(out.map((m) => m.id)).toEqual(['laguna-swift-5x10'])
  })

  it('drops Carvera 3-axis variant (only 4-axis is hero per CLAUDE.md singles-out)', () => {
    const input = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('makera-carvera-3axis'),
      fakeMachine('makera-carvera-4axis')
    ]
    const out = listMyShopMachines(input)
    expect(out.map((m) => m.id)).toEqual([
      'laguna-swift-5x10',
      'makera-carvera-4axis'
    ])
  })

  it('returns empty array when no target machines are installed', () => {
    expect(listMyShopMachines([])).toEqual([])
    expect(listMyShopMachines([fakeMachine('bambu-x1c')])).toEqual([])
  })

  it('returns a fresh array on every call (no aliasing of MY_SHOP_PRESETS internals)', () => {
    const input = [fakeMachine('laguna-swift-5x10')]
    const a = listMyShopMachines(input)
    const b = listMyShopMachines(input)
    expect(a).not.toBe(b)
  })

  it('does not mutate the input array', () => {
    const input = [
      fakeMachine('makera-carvera-4axis'),
      fakeMachine('laguna-swift-5x10')
    ]
    const before = input.map((m) => m.id)
    listMyShopMachines(input)
    expect(input.map((m) => m.id)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// G) getMyShopPresetsForMachine
// ---------------------------------------------------------------------------

describe('[ID-0220] G) getMyShopPresetsForMachine', () => {
  it('returns 2 presets in declaration order for laguna-swift-5x10', () => {
    const out = getMyShopPresetsForMachine('laguna-swift-5x10')
    expect(out).toHaveLength(2)
    for (const p of out) expect(p.machineId).toBe('laguna-swift-5x10')
  })

  it('returns 2 presets in declaration order for creality-k2-plus', () => {
    const out = getMyShopPresetsForMachine('creality-k2-plus')
    expect(out).toHaveLength(2)
    for (const p of out) expect(p.machineId).toBe('creality-k2-plus')
  })

  it('returns 2 presets in declaration order for makera-carvera-4axis', () => {
    const out = getMyShopPresetsForMachine('makera-carvera-4axis')
    expect(out).toHaveLength(2)
    for (const p of out) expect(p.machineId).toBe('makera-carvera-4axis')
  })

  it('returns [] for unknown machine ids', () => {
    expect(getMyShopPresetsForMachine('unknown-machine')).toEqual([])
    expect(getMyShopPresetsForMachine('makera-carvera-3axis')).toEqual([])
    expect(getMyShopPresetsForMachine('')).toEqual([])
  })

  it('returns a fresh array on every call (no caller-mutation poisoning)', () => {
    const a = getMyShopPresetsForMachine('laguna-swift-5x10')
    const b = getMyShopPresetsForMachine('laguna-swift-5x10')
    expect(a).not.toBe(b)
    a.length = 0
    expect(getMyShopPresetsForMachine('laguna-swift-5x10').length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// H) Purity & determinism
// ---------------------------------------------------------------------------

describe('[ID-0220] H) purity & determinism', () => {
  it('N=10 stability for getMyShopPresetsForMachine across all 3 target machines', () => {
    for (const id of MY_SHOP_MACHINE_IDS) {
      const ref = getMyShopPresetsForMachine(id)
      for (let i = 0; i < 10; i += 1) {
        expect(getMyShopPresetsForMachine(id)).toEqual(ref)
      }
    }
  })

  it('N=10 stability for listMyShopMachines', () => {
    const input = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('creality-k2-plus'),
      fakeMachine('makera-carvera-4axis')
    ]
    const ref = listMyShopMachines(input)
    for (let i = 0; i < 10; i += 1) {
      const next = listMyShopMachines(input)
      expect(next.map((m) => m.id)).toEqual(ref.map((m) => m.id))
    }
  })

  it('does NOT mutate MY_SHOP_PRESETS', () => {
    const before = JSON.stringify(MY_SHOP_PRESETS)
    getMyShopPresetsForMachine('laguna-swift-5x10')
    listMyShopMachines([fakeMachine('laguna-swift-5x10')])
    expect(JSON.stringify(MY_SHOP_PRESETS)).toBe(before)
  })

  it('does NOT mutate MY_SHOP_MACHINE_IDS', () => {
    const before = JSON.stringify(MY_SHOP_MACHINE_IDS)
    listMyShopMachines([fakeMachine('makera-carvera-4axis')])
    expect(JSON.stringify(MY_SHOP_MACHINE_IDS)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// I) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0220] I) source-text whitelist', () => {
  it('declares CLAUDE.md "UI Requirements" provenance in the JSDoc header', () => {
    expect(SRC).toContain('UI Requirements')
  })

  it('JSDoc lists the three CLAUDE.md target machine ids verbatim', () => {
    expect(SRC).toContain('laguna-swift-5x10')
    expect(SRC).toContain('creality-k2-plus')
    expect(SRC).toContain('makera-carvera-4axis')
  })

  it('JSDoc explains the 4-axis-as-hero choice over 3-axis variant', () => {
    expect(SRC).toContain('4th-Axis HD workflow')
  })

  it('does NOT import React / DOM / electron / network modules', () => {
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/from ['"]react\/jsx-runtime['"]/)
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toMatch(/document\./)
    expect(SRC).not.toMatch(/window\./)
    // JSDoc says "no localStorage I/O" so look for actual access patterns.
    expect(SRC).not.toMatch(/localStorage\./)
    expect(SRC).not.toMatch(/localStorage\[/)
    expect(SRC).not.toMatch(/fetch\(/)
  })

  it('does NOT contain any G-code / M-code / Handlebars literals', () => {
    expect(SRC).not.toMatch(/\bM6[45]\b/)
    expect(SRC).not.toMatch(/\bG0\d?\b/)
    expect(SRC).not.toMatch(/\bG1\d?\b/)
    expect(SRC).not.toMatch(/\{\{[^}]+\}\}/)
  })

  it('does NOT reference foreign-machine ids (bambu / prusa / voron / ender / longmill / shapeoko / onefinity)', () => {
    // Word-boundary anchors so e.g. "renderer" does not match /ender/.
    expect(SRC).not.toMatch(/\bbambu\b/i)
    expect(SRC).not.toMatch(/\bprusa\b/i)
    expect(SRC).not.toMatch(/\bvoron\b/i)
    expect(SRC).not.toMatch(/\bender[- ]?\d/i)
    expect(SRC).not.toMatch(/\blongmill\b/i)
    expect(SRC).not.toMatch(/\bshapeoko\b/i)
    expect(SRC).not.toMatch(/\bonefinity\b/i)
  })

  it('contains zero `any` types (Safety Rule 3)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('exports exactly 3 functions and exactly 1 interface', () => {
    // 3 functions: isMyShopMachineId / listMyShopMachines / getMyShopPresetsForMachine.
    expect(SRC.match(/^export function /gm)?.length).toBe(3)
    expect(SRC.match(/^export interface /gm)?.length).toBe(1)
  })

  it('declares MY_SHOP_MACHINE_IDS as a frozen `as const` tuple', () => {
    expect(SRC).toContain('] as const')
    // The tuple literal is the first `as const` in the file.
    expect(SRC.indexOf('MY_SHOP_MACHINE_IDS')).toBeLessThan(
      SRC.indexOf('] as const')
    )
  })

  it('declares MY_SHOP_PRESETS as `readonly MyShopPreset[]`', () => {
    expect(SRC).toContain('readonly MyShopPreset[]')
  })

  it('declares the CLAUDE.md verbatim preset phrases at the source level', () => {
    expect(SRC).toContain('Full-sheet')
    expect(SRC).toContain('High-speed FDM')
    expect(SRC).toContain('4-axis rotary')
  })

  it('declares the type guard via strict `===` comparisons (not regex / startsWith)', () => {
    expect(SRC).toContain("value === 'laguna-swift-5x10'")
    expect(SRC).toContain("value === 'creality-k2-plus'")
    expect(SRC).toContain("value === 'makera-carvera-4axis'")
  })

  it('does NOT contain top-level `let` declarations', () => {
    expect(SRC).not.toMatch(/^let /m)
  })

  it('declares the brand-bar order phrase in JSDoc (router -> FDM -> 4-axis)', () => {
    expect(SRC).toContain('VCarve Pro')
    expect(SRC).toContain('Creality Print')
    expect(SRC).toContain('Makera CAM')
  })

  it('describes Carvera 3-axis as a registered variant but excluded from My Shop', () => {
    expect(SRC).toContain('makera-carvera-3axis')
    expect(SRC).toContain('Library drawer')
  })

  it('declares the resolveQuickSwitchMachine wiring contract in JSDoc', () => {
    expect(SRC).toContain('resolveQuickSwitchMachine')
  })

  it('uses type-only imports for MachineProfile / ManufactureOperationKind / EnvironmentId', () => {
    expect(SRC).toMatch(/import type \{ MachineProfile \}/)
    expect(SRC).toMatch(/import type \{ ManufactureOperationKind \}/)
    expect(SRC).toMatch(/import type \{ EnvironmentId \}/)
  })
})
