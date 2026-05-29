/**
 * env-routing-pin.test.ts -- [ID-0275] Cycle 203 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/src/environments/env-routing.ts` --
 * the pure-data resolver that translates between machine IDs / profile
 * lists and the three shop environments declared by `registry.ts`. The
 * resolver is the foundation that the brand-bar quick-switch resolver
 * (`quick-switch.ts`, pinned at Cycle 186 / [ID-0266]) builds on; a
 * regression in any of the four exported functions silently re-routes
 * the My-Shop-Only Mode UI surface to the wrong environment / wrong
 * machine, which would surface as posted G-code carrying the wrong
 * post-template, dialect, or work envelope.
 *
 * CROSS-CUTS ALL THREE TARGET MACHINES via the four real machine ids
 * the registry routes through (`laguna-swift-5x10`, `creality-k2-plus`,
 * `makera-carvera-3axis`, `makera-carvera-4axis`) per CLAUDE.md USER
 * CONTEXT. The resolver SHOULD return:
 *   - `vcarve_pro`     for `laguna-swift-5x10`,
 *   - `creality_print` for `creality-k2-plus`,
 *   - `makera_cam`     for both Carvera variants (3-axis + 4-axis HD).
 *
 * The existing `env-routing.test.ts` covers 11 happy-path behavioural
 * cases (each function + the registry round-trip). THIS pin file does
 * NOT duplicate that coverage; instead it pins the SHAPE invariants:
 *   (A) module shape -- exact 4-named-export inventory, no default
 *       export, no internal-helper leakage, Symbol.toStringTag-Module,
 *   (B) function signatures -- name / arity / native Function /
 *       no-prototype / not-AsyncFunction / Promise-not-returned,
 *   (C) getEnvironmentForMachine -- null on falsy / unknown,
 *       reference-equal lookup into ENVIRONMENT_LIST, returns the SAME
 *       ShopEnvironment object the registry already exposes,
 *   (D) getDefaultMachineForEnvironment -- happy path picks default by
 *       id, missing-default returns null, non-id matches do NOT match,
 *       reference equality preserved from input array,
 *   (E) getMachinesForEnvironment -- declared order preserved (NOT
 *       input-array order), empty owned-set returns plain Array,
 *       missing machines silently skipped, no-duplicate invariant,
 *   (F) getEnvironmentById -- all three IDs resolve to the registry
 *       singleton, throws on unknown ID with the documented prefix,
 *   (G) three-machine path realism -- exhaustive truth table across
 *       the three real ENVIRONMENTS using the four real machine
 *       profile ids per CLAUDE.md USER CONTEXT,
 *   (H) pure-function invariants -- idempotent (N=20), no input
 *       mutation, no this-binding leakage on call/apply, fresh Array
 *       per call from getMachinesForEnvironment, plain-Array prototype,
 *       no NaN drift, defensive-copy-not-required for ShopEnvironment
 *       (read-only contract),
 *   (I) source-text whitelist -- size canary (<=80 lines, <=3 KB), 4
 *       export-function forms, MachineProfile type-only import,
 *       registry import shape, no React/DOM/electron/fs/net imports,
 *       no foreign-machine vendor literals, no toolpath G-code or
 *       M-code emission, no `:any` / `as any` / `<any>` types, no
 *       default export, no class declaration,
 *   (J) registry-coupling invariants -- the resolver respects the
 *       registry's declared order, the registry's machine-id sets, and
 *       does NOT introduce duplicate or out-of-band machine ids.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { MachineProfile } from '../../../shared/machine-schema'
import {
  ENVIRONMENTS,
  ENVIRONMENT_LIST,
  type EnvironmentId,
  type ShopEnvironment
} from './registry'
import * as M from './env-routing'
import {
  getEnvironmentForMachine,
  getDefaultMachineForEnvironment,
  getMachinesForEnvironment,
  getEnvironmentById
} from './env-routing'

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mirror of the fixture helper in `env-routing.test.ts` and
 * `quick-switch-pin.test.ts`. Only the `id` is load-bearing for the
 * resolver; the other fields are required by the `MachineProfile` type
 * so we provide minimal valid scaffolding.
 */
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

/** Full four-profile shop spanning the three CLAUDE.md target machines. */
const fullShop: readonly MachineProfile[] = [
  fakeMachine('laguna-swift-5x10'),
  fakeMachine('creality-k2-plus', {
    kind: 'fdm',
    postTemplate: 'fdm_passthrough.hbs'
  }),
  fakeMachine('makera-carvera-3axis', {
    postTemplate: 'carvera_3axis.hbs',
    dialect: 'smoothieware'
  }),
  fakeMachine('makera-carvera-4axis', {
    postTemplate: 'carvera_4axis.hbs',
    dialect: 'grbl_4axis'
  })
]

// Source text for whitelist pins (Section I).
const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'env-routing.ts'), 'utf-8')

// ────────────────────────────────────────────────────────────────────────────
// (A) Module shape
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (A) module shape', () => {
  it('exports exactly four named symbols', () => {
    const keys = Object.keys(M).filter((k) => k !== 'default').sort()
    expect(keys).toEqual([
      'getDefaultMachineForEnvironment',
      'getEnvironmentById',
      'getEnvironmentForMachine',
      'getMachinesForEnvironment'
    ])
  })

  it('has no default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('Symbol.toStringTag is "Module"', () => {
    expect((M as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('does not leak internal helpers (no `_` / `internal` / `helper` exports)', () => {
    const leak = Object.keys(M).filter(
      (k) => k.startsWith('_') || k.toLowerCase().includes('internal') || k.toLowerCase().includes('helper')
    )
    expect(leak).toEqual([])
  })

  it('all four exports are functions (not classes, not constants)', () => {
    expect(typeof M.getEnvironmentForMachine).toBe('function')
    expect(typeof M.getDefaultMachineForEnvironment).toBe('function')
    expect(typeof M.getMachinesForEnvironment).toBe('function')
    expect(typeof M.getEnvironmentById).toBe('function')
  })

  it('exports are own enumerable properties (no `Object.defineProperty` non-enumerable hide)', () => {
    const ownKeys = Object.getOwnPropertyNames(M).filter((k) => k !== 'default')
    for (const k of [
      'getEnvironmentForMachine',
      'getDefaultMachineForEnvironment',
      'getMachinesForEnvironment',
      'getEnvironmentById'
    ]) {
      expect(ownKeys).toContain(k)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (B) Function signatures
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (B) function signatures', () => {
  it('getEnvironmentForMachine: name, arity 1, native', () => {
    expect(getEnvironmentForMachine.name).toBe('getEnvironmentForMachine')
    expect(getEnvironmentForMachine.length).toBe(1)
    expect(getEnvironmentForMachine).toBeInstanceOf(Function)
  })

  it('getDefaultMachineForEnvironment: name, arity 2, native', () => {
    expect(getDefaultMachineForEnvironment.name).toBe('getDefaultMachineForEnvironment')
    expect(getDefaultMachineForEnvironment.length).toBe(2)
    expect(getDefaultMachineForEnvironment).toBeInstanceOf(Function)
  })

  it('getMachinesForEnvironment: name, arity 2, native', () => {
    expect(getMachinesForEnvironment.name).toBe('getMachinesForEnvironment')
    expect(getMachinesForEnvironment.length).toBe(2)
    expect(getMachinesForEnvironment).toBeInstanceOf(Function)
  })

  it('getEnvironmentById: name, arity 1, native', () => {
    expect(getEnvironmentById.name).toBe('getEnvironmentById')
    expect(getEnvironmentById.length).toBe(1)
    expect(getEnvironmentById).toBeInstanceOf(Function)
  })

  it('none of the four exports is an AsyncFunction', () => {
    const AsyncFunction = (async () => {}).constructor
    for (const fn of [
      getEnvironmentForMachine,
      getDefaultMachineForEnvironment,
      getMachinesForEnvironment,
      getEnvironmentById
    ]) {
      expect(fn).not.toBeInstanceOf(AsyncFunction)
    }
  })

  it('none of the four exports returns a Promise on documented inputs', () => {
    expect(getEnvironmentForMachine('laguna-swift-5x10')).not.toBeInstanceOf(Promise)
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop)).not.toBeInstanceOf(Promise)
    expect(getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop)).not.toBeInstanceOf(Promise)
    expect(getEnvironmentById('vcarve_pro')).not.toBeInstanceOf(Promise)
  })

  it('none of the four exports has a `.prototype` indicating constructor intent', () => {
    // Pure helpers should be authored as `function` declarations -- they
    // DO have a `.prototype`. We pin the shape: prototype is plain Object,
    // not a class hierarchy.
    for (const fn of [
      getEnvironmentForMachine,
      getDefaultMachineForEnvironment,
      getMachinesForEnvironment,
      getEnvironmentById
    ]) {
      expect(Object.getPrototypeOf(fn.prototype)).toBe(Object.prototype)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (C) getEnvironmentForMachine
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (C) getEnvironmentForMachine', () => {
  it('null input returns null', () => {
    expect(getEnvironmentForMachine(null)).toBeNull()
  })

  it('undefined input returns null', () => {
    expect(getEnvironmentForMachine(undefined)).toBeNull()
  })

  it('empty string input returns null', () => {
    expect(getEnvironmentForMachine('')).toBeNull()
  })

  it('unknown machine id returns null', () => {
    expect(getEnvironmentForMachine('totally-fake-machine')).toBeNull()
    expect(getEnvironmentForMachine('haas-vf2')).toBeNull()
    expect(getEnvironmentForMachine('prusa-mk4')).toBeNull()
  })

  it('laguna-swift-5x10 routes to vcarve_pro', () => {
    expect(getEnvironmentForMachine('laguna-swift-5x10')?.id).toBe('vcarve_pro')
  })

  it('creality-k2-plus routes to creality_print', () => {
    expect(getEnvironmentForMachine('creality-k2-plus')?.id).toBe('creality_print')
  })

  it('makera-carvera-3axis routes to makera_cam', () => {
    expect(getEnvironmentForMachine('makera-carvera-3axis')?.id).toBe('makera_cam')
  })

  it('makera-carvera-4axis routes to makera_cam', () => {
    expect(getEnvironmentForMachine('makera-carvera-4axis')?.id).toBe('makera_cam')
  })

  it('returns reference-equal ShopEnvironment from ENVIRONMENT_LIST (not a clone)', () => {
    const got = getEnvironmentForMachine('laguna-swift-5x10')
    expect(got).toBe(ENVIRONMENTS.vcarve_pro)
  })

  it('case-sensitive match: upper-case variant does NOT route', () => {
    // The registry stores lowercase ids; uppercase must not silently match.
    expect(getEnvironmentForMachine('LAGUNA-SWIFT-5X10')).toBeNull()
  })

  it('whitespace-padded id does NOT route (no trim semantics in resolver)', () => {
    expect(getEnvironmentForMachine(' laguna-swift-5x10 ')).toBeNull()
  })

  it('hyphen-vs-underscore variant does NOT route', () => {
    expect(getEnvironmentForMachine('laguna_swift_5x10')).toBeNull()
  })

  it('returns null on partial-prefix substrings', () => {
    expect(getEnvironmentForMachine('laguna')).toBeNull()
    expect(getEnvironmentForMachine('makera-carvera')).toBeNull()
  })

  it('returns null on partial-suffix substrings', () => {
    expect(getEnvironmentForMachine('5x10')).toBeNull()
    expect(getEnvironmentForMachine('-3axis')).toBeNull()
  })

  it('handles all three null-ish input shapes identically (null === undefined === "")', () => {
    expect(getEnvironmentForMachine(null)).toBe(getEnvironmentForMachine(undefined))
    expect(getEnvironmentForMachine(undefined)).toBe(getEnvironmentForMachine(''))
    expect(getEnvironmentForMachine(null)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (D) getDefaultMachineForEnvironment
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (D) getDefaultMachineForEnvironment', () => {
  it('returns the env default when present in machine list', () => {
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop)
    expect(def?.id).toBe('laguna-swift-5x10')
  })

  it('returns null when default is missing from machine list', () => {
    const machines = [fakeMachine('some-other-machine')]
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, machines)).toBeNull()
  })

  it('returns null on empty machine list', () => {
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.makera_cam, [])).toBeNull()
  })

  it('VCarve Pro default = laguna-swift-5x10', () => {
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop)
    expect(def?.id).toBe('laguna-swift-5x10')
  })

  it('Creality Print default = creality-k2-plus', () => {
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.creality_print, fullShop)
    expect(def?.id).toBe('creality-k2-plus')
  })

  it('Makera CAM default = makera-carvera-3axis (NOT 4-axis)', () => {
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.makera_cam, fullShop)
    expect(def?.id).toBe('makera-carvera-3axis')
  })

  it('returns reference-equal MachineProfile from input array (not a clone)', () => {
    const lag = fullShop.find((m) => m.id === 'laguna-swift-5x10')
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop)
    expect(def).toBe(lag)
  })

  it('does NOT match by name field (only by id)', () => {
    const machines = [fakeMachine('different-id', { name: 'laguna-swift-5x10' })]
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, machines)).toBeNull()
  })

  it('does NOT mutate the machine list', () => {
    const list = [...fullShop]
    const before = list.map((m) => m.id).join(',')
    getDefaultMachineForEnvironment(ENVIRONMENTS.makera_cam, list)
    const after = list.map((m) => m.id).join(',')
    expect(after).toBe(before)
  })

  it('first matching id wins (no duplicate-detection beyond Array.find)', () => {
    const dup1 = fakeMachine('laguna-swift-5x10', { name: 'first' })
    const dup2 = fakeMachine('laguna-swift-5x10', { name: 'second' })
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, [dup1, dup2])
    expect(def?.name).toBe('first')
  })

  it('handles a single-element list correctly when default matches', () => {
    const machines = [fakeMachine('creality-k2-plus')]
    const def = getDefaultMachineForEnvironment(ENVIRONMENTS.creality_print, machines)
    expect(def?.id).toBe('creality-k2-plus')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (E) getMachinesForEnvironment
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (E) getMachinesForEnvironment', () => {
  it('returns owned machines in DECLARED order (NOT input-array order)', () => {
    const reordered = [
      fakeMachine('makera-carvera-4axis'),
      fakeMachine('makera-carvera-3axis')
    ]
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, reordered)
    expect(owned.map((m) => m.id)).toEqual(['makera-carvera-3axis', 'makera-carvera-4axis'])
  })

  it('returns an empty list when no owned machines are present', () => {
    const machines = [fakeMachine('unrelated')]
    expect(getMachinesForEnvironment(ENVIRONMENTS.creality_print, machines)).toEqual([])
  })

  it('returns an empty list on empty input', () => {
    expect(getMachinesForEnvironment(ENVIRONMENTS.makera_cam, [])).toEqual([])
  })

  it('skips missing machines silently (partial owned set)', () => {
    const machines = [fakeMachine('makera-carvera-3axis')]
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, machines)
    expect(owned.map((m) => m.id)).toEqual(['makera-carvera-3axis'])
  })

  it('VCarve Pro returns single Laguna profile', () => {
    const owned = getMachinesForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop)
    expect(owned.map((m) => m.id)).toEqual(['laguna-swift-5x10'])
  })

  it('Creality Print returns single K2 profile', () => {
    const owned = getMachinesForEnvironment(ENVIRONMENTS.creality_print, fullShop)
    expect(owned.map((m) => m.id)).toEqual(['creality-k2-plus'])
  })

  it('Makera CAM returns BOTH Carvera variants in declared order', () => {
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop)
    expect(owned.map((m) => m.id)).toEqual(['makera-carvera-3axis', 'makera-carvera-4axis'])
  })

  it('returns a fresh Array on every call (no shared reference)', () => {
    const a = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop)
    const b = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('returned Array has plain-Array prototype (no exotic subclass)', () => {
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop)
    expect(Object.getPrototypeOf(owned)).toBe(Array.prototype)
  })

  it('returned Array elements are reference-equal to inputs (no clone)', () => {
    const m3 = fullShop.find((m) => m.id === 'makera-carvera-3axis')
    const m4 = fullShop.find((m) => m.id === 'makera-carvera-4axis')
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop)
    expect(owned[0]).toBe(m3)
    expect(owned[1]).toBe(m4)
  })

  it('does NOT mutate the input machine array', () => {
    const list = [...fullShop]
    const before = list.map((m) => m.id).join(',')
    getMachinesForEnvironment(ENVIRONMENTS.makera_cam, list)
    expect(list.map((m) => m.id).join(',')).toBe(before)
  })

  it('returned Array length matches owned-machine count exactly', () => {
    expect(getMachinesForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop).length).toBe(1)
    expect(getMachinesForEnvironment(ENVIRONMENTS.creality_print, fullShop).length).toBe(1)
    expect(getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop).length).toBe(2)
  })

  it('first-match-wins on duplicate ids (Array.find semantics)', () => {
    const dup1 = fakeMachine('makera-carvera-3axis', { name: 'first' })
    const dup2 = fakeMachine('makera-carvera-3axis', { name: 'second' })
    const m4 = fakeMachine('makera-carvera-4axis')
    const owned = getMachinesForEnvironment(ENVIRONMENTS.makera_cam, [dup1, dup2, m4])
    expect(owned.length).toBe(2)
    expect(owned[0].name).toBe('first')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (F) getEnvironmentById
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (F) getEnvironmentById', () => {
  it('vcarve_pro resolves to the registry singleton', () => {
    expect(getEnvironmentById('vcarve_pro')).toBe(ENVIRONMENTS.vcarve_pro)
  })

  it('creality_print resolves to the registry singleton', () => {
    expect(getEnvironmentById('creality_print')).toBe(ENVIRONMENTS.creality_print)
  })

  it('makera_cam resolves to the registry singleton', () => {
    expect(getEnvironmentById('makera_cam')).toBe(ENVIRONMENTS.makera_cam)
  })

  it('unknown id throws an Error with the documented prefix', () => {
    // Cast through unknown to bypass the EnvironmentId compile-time check
    // because we are pinning the runtime guard.
    expect(() => getEnvironmentById('totally-fake' as unknown as EnvironmentId)).toThrow(
      /Unknown shop environment id:/
    )
  })

  it('unknown id throws an Error (instanceof Error)', () => {
    let caught: unknown = null
    try {
      getEnvironmentById('bogus' as unknown as EnvironmentId)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
  })

  it('unknown id message includes the input value', () => {
    expect(() => getEnvironmentById('zzz' as unknown as EnvironmentId)).toThrow(/zzz/)
  })

  it('returned ShopEnvironment id matches input', () => {
    for (const id of ['vcarve_pro', 'creality_print', 'makera_cam'] as const) {
      expect(getEnvironmentById(id).id).toBe(id)
    }
  })

  it('returned ShopEnvironment is the SAME object on repeated calls', () => {
    const a = getEnvironmentById('vcarve_pro')
    const b = getEnvironmentById('vcarve_pro')
    expect(a).toBe(b)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (G) Three-machine path realism
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (G) three-machine path realism', () => {
  it('every machineId in the registry round-trips through getEnvironmentForMachine', () => {
    for (const env of ENVIRONMENT_LIST) {
      for (const id of env.machineIds) {
        expect(getEnvironmentForMachine(id)?.id).toBe(env.id)
      }
    }
  })

  it('every env defaultMachineId is present in its machineIds set', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.machineIds).toContain(env.defaultMachineId)
    }
  })

  it('the four CLAUDE.md target machine ids are exactly the registry-routed ids (no foreign machines)', () => {
    const allIds = new Set<string>()
    for (const env of ENVIRONMENT_LIST) {
      for (const id of env.machineIds) {
        allIds.add(id)
      }
    }
    expect(Array.from(allIds).sort()).toEqual([
      'creality-k2-plus',
      'laguna-swift-5x10',
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('VCarve Pro env owns ONLY laguna-swift-5x10 (FDM and Carvera ids leak nothing)', () => {
    const env = getEnvironmentById('vcarve_pro')
    expect(env.machineIds).toEqual(['laguna-swift-5x10'])
  })

  it('Creality Print env owns ONLY creality-k2-plus (CNC ids leak nothing)', () => {
    const env = getEnvironmentById('creality_print')
    expect(env.machineIds).toEqual(['creality-k2-plus'])
  })

  it('Makera CAM env owns BOTH Carvera variants in declared order [3axis, 4axis]', () => {
    const env = getEnvironmentById('makera_cam')
    expect(env.machineIds).toEqual(['makera-carvera-3axis', 'makera-carvera-4axis'])
  })

  it('no env owns a machine outside the CLAUDE.md user-context list', () => {
    const allowed = new Set([
      'creality-k2-plus',
      'laguna-swift-5x10',
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
    for (const env of ENVIRONMENT_LIST) {
      for (const id of env.machineIds) {
        expect(allowed.has(id)).toBe(true)
      }
    }
  })

  it('no machine id appears in MORE than one env (envs partition the machine set)', () => {
    const seen = new Map<string, string>()
    for (const env of ENVIRONMENT_LIST) {
      for (const id of env.machineIds) {
        if (seen.has(id)) {
          throw new Error(`Machine ${id} declared in both ${seen.get(id)} and ${env.id}`)
        }
        seen.set(id, env.id)
      }
    }
    expect(seen.size).toBe(4)
  })

  it('full-shop default routing: each env returns its own default machine when given fullShop', () => {
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop)?.id).toBe('laguna-swift-5x10')
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.creality_print, fullShop)?.id).toBe('creality-k2-plus')
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.makera_cam, fullShop)?.id).toBe('makera-carvera-3axis')
  })

  it('full-shop owned-set routing: each env returns its declared owned set in order', () => {
    expect(getMachinesForEnvironment(ENVIRONMENTS.vcarve_pro, fullShop).map((m) => m.id)).toEqual([
      'laguna-swift-5x10'
    ])
    expect(getMachinesForEnvironment(ENVIRONMENTS.creality_print, fullShop).map((m) => m.id)).toEqual([
      'creality-k2-plus'
    ])
    expect(getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop).map((m) => m.id)).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('K2 Plus FDM profile (fdm kind) routes correctly through getEnvironmentForMachine', () => {
    // K2 Plus uses kind=fdm + fdm_passthrough.hbs; the resolver must NOT
    // route on dialect/kind heuristics, only on machine id.
    const k2 = fullShop.find((m) => m.id === 'creality-k2-plus')
    expect(k2?.kind).toBe('fdm')
    expect(getEnvironmentForMachine(k2?.id ?? null)?.id).toBe('creality_print')
  })

  it('Laguna Swift 5x10 routes regardless of work envelope size (1524x3048)', () => {
    const lagBig = fakeMachine('laguna-swift-5x10', {
      workAreaMm: { x: 3048, y: 1524, z: 200 }
    })
    expect(getEnvironmentForMachine(lagBig.id)?.id).toBe('vcarve_pro')
  })

  it('Carvera 4-axis routes to makera_cam regardless of dialect (grbl_4axis)', () => {
    const car4 = fullShop.find((m) => m.id === 'makera-carvera-4axis')
    expect(car4?.dialect).toBe('grbl_4axis')
    expect(getEnvironmentForMachine(car4?.id ?? null)?.id).toBe('makera_cam')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (H) Pure-function invariants
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (H) pure-function invariants', () => {
  it('getEnvironmentForMachine: idempotent over N=20', () => {
    for (let i = 0; i < 20; i++) {
      expect(getEnvironmentForMachine('laguna-swift-5x10')?.id).toBe('vcarve_pro')
    }
  })

  it('getDefaultMachineForEnvironment: idempotent over N=20 (same input -> same id)', () => {
    for (let i = 0; i < 20; i++) {
      expect(getDefaultMachineForEnvironment(ENVIRONMENTS.makera_cam, fullShop)?.id).toBe(
        'makera-carvera-3axis'
      )
    }
  })

  it('getMachinesForEnvironment: idempotent over N=20 (same input -> equal owned set)', () => {
    for (let i = 0; i < 20; i++) {
      expect(getMachinesForEnvironment(ENVIRONMENTS.makera_cam, fullShop).map((m) => m.id)).toEqual([
        'makera-carvera-3axis',
        'makera-carvera-4axis'
      ])
    }
  })

  it('getEnvironmentById: idempotent over N=20 (same id -> same singleton)', () => {
    const first = getEnvironmentById('vcarve_pro')
    for (let i = 0; i < 20; i++) {
      expect(getEnvironmentById('vcarve_pro')).toBe(first)
    }
  })

  it('no-input-mutation: getDefaultMachineForEnvironment does not change machine array length', () => {
    const list = [...fullShop]
    const len = list.length
    getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, list)
    expect(list.length).toBe(len)
  })

  it('no-input-mutation: getMachinesForEnvironment does not change input array order', () => {
    const list = [...fullShop]
    const ordersBefore = list.map((m) => m.id).join('|')
    getMachinesForEnvironment(ENVIRONMENTS.makera_cam, list)
    expect(list.map((m) => m.id).join('|')).toBe(ordersBefore)
  })

  it('no-input-mutation: getMachinesForEnvironment does not mutate ShopEnvironment.machineIds', () => {
    const env = ENVIRONMENTS.makera_cam
    const before = [...env.machineIds]
    getMachinesForEnvironment(env, fullShop)
    expect([...env.machineIds]).toEqual(before)
  })

  it('no this-binding leakage: getEnvironmentForMachine.call(undefined) works', () => {
    const ref = getEnvironmentForMachine
    expect(ref.call(undefined, 'laguna-swift-5x10')?.id).toBe('vcarve_pro')
  })

  it('no this-binding leakage: getEnvironmentById.apply(null) works', () => {
    const ref = getEnvironmentById
    expect(ref.apply(null, ['vcarve_pro'])).toBe(ENVIRONMENTS.vcarve_pro)
  })

  it('no this-binding leakage: getDefaultMachineForEnvironment.bind(null) works', () => {
    const bound = getDefaultMachineForEnvironment.bind(null, ENVIRONMENTS.vcarve_pro)
    expect(bound(fullShop)?.id).toBe('laguna-swift-5x10')
  })

  it('no this-binding leakage: getMachinesForEnvironment.bind(null) works', () => {
    const bound = getMachinesForEnvironment.bind(null, ENVIRONMENTS.makera_cam)
    expect(bound(fullShop).map((m) => m.id)).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('readonly machine list: passes through readonly array without copy attempt', () => {
    const ro: readonly MachineProfile[] = Object.freeze([fakeMachine('laguna-swift-5x10')])
    expect(getDefaultMachineForEnvironment(ENVIRONMENTS.vcarve_pro, ro)?.id).toBe('laguna-swift-5x10')
  })

  it('readonly machine list: getMachinesForEnvironment works on Object.freeze input', () => {
    const ro: readonly MachineProfile[] = Object.freeze([fakeMachine('makera-carvera-3axis')])
    expect(getMachinesForEnvironment(ENVIRONMENTS.makera_cam, ro).map((m) => m.id)).toEqual([
      'makera-carvera-3axis'
    ])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (I) Source-text whitelist
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (I) source-text whitelist', () => {
  it('source size canary: <= 80 lines', () => {
    const lineCount = SOURCE.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(80)
  })

  it('source size canary: <= 3072 bytes', () => {
    const bytes = Buffer.byteLength(SOURCE, 'utf-8')
    expect(bytes).toBeLessThanOrEqual(3072)
  })

  it('declares exactly four exported functions', () => {
    const exports = SOURCE.match(/^export function /gm) ?? []
    expect(exports.length).toBe(4)
  })

  it('exports the four documented symbols by name', () => {
    expect(SOURCE).toMatch(/export function getEnvironmentForMachine\(/)
    expect(SOURCE).toMatch(/export function getDefaultMachineForEnvironment\(/)
    expect(SOURCE).toMatch(/export function getMachinesForEnvironment\(/)
    expect(SOURCE).toMatch(/export function getEnvironmentById\(/)
  })

  it('does not expose a default export', () => {
    expect(SOURCE).not.toMatch(/^export default /m)
  })

  it('imports MachineProfile as a type-only import', () => {
    expect(SOURCE).toMatch(/import type \{ MachineProfile \} from '\.\.\/\.\.\/\.\.\/shared\/machine-schema'/)
  })

  it('imports ENVIRONMENT_LIST and ENVIRONMENTS as runtime values from ./registry', () => {
    expect(SOURCE).toMatch(/ENVIRONMENT_LIST/)
    expect(SOURCE).toMatch(/ENVIRONMENTS/)
    expect(SOURCE).toMatch(/from '\.\/registry'/)
  })

  it('imports EnvironmentId and ShopEnvironment as type-only from ./registry', () => {
    expect(SOURCE).toMatch(/type EnvironmentId/)
    expect(SOURCE).toMatch(/type ShopEnvironment/)
  })

  it('does not import React, react-dom, three, or any DOM/electron API', () => {
    expect(SOURCE).not.toMatch(/from 'react'/)
    expect(SOURCE).not.toMatch(/from 'react-dom/)
    expect(SOURCE).not.toMatch(/from 'electron/)
    expect(SOURCE).not.toMatch(/from 'three/)
  })

  it('does not import node:fs / node:path / node:net or any network/filesystem module', () => {
    expect(SOURCE).not.toMatch(/from 'node:fs/)
    expect(SOURCE).not.toMatch(/from 'node:path/)
    expect(SOURCE).not.toMatch(/from 'node:net/)
    expect(SOURCE).not.toMatch(/from 'node:tls/)
    expect(SOURCE).not.toMatch(/from 'node:dgram/)
    expect(SOURCE).not.toMatch(/from 'node:child_process/)
  })

  it('does not contain `:any`, `as any`, or `<any>` types', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas any\b/)
    expect(SOURCE).not.toMatch(/<any>/)
  })

  it('does not emit toolpath G-code or M-code (G0/G1/M3/M5 etc.)', () => {
    // A pure resolver must not contain literal G-code -- a regression here
    // would mean the resolver reached into post-processor territory.
    expect(SOURCE).not.toMatch(/\bG0\b/)
    expect(SOURCE).not.toMatch(/\bG1\b/)
    expect(SOURCE).not.toMatch(/\bM3\b/)
    expect(SOURCE).not.toMatch(/\bM5\b/)
    expect(SOURCE).not.toMatch(/\bM30\b/)
    expect(SOURCE).not.toMatch(/\bM104\b/)
    expect(SOURCE).not.toMatch(/\bM140\b/)
  })

  it('does not name foreign-machine vendors (Haas/Mazak/Tormach/Okuma/DMG hardware)', () => {
    expect(SOURCE).not.toMatch(/\bHaas\b/i)
    expect(SOURCE).not.toMatch(/\bMazak\b/i)
    expect(SOURCE).not.toMatch(/\bTormach\b/i)
    expect(SOURCE).not.toMatch(/\bOkuma\b/i)
    expect(SOURCE).not.toMatch(/\bDMG\s*Mori\b/i)
  })

  it('does not declare a class', () => {
    expect(SOURCE).not.toMatch(/^export class /m)
    expect(SOURCE).not.toMatch(/^class /m)
  })

  it('does not import handlebars (post-processor surface)', () => {
    expect(SOURCE).not.toMatch(/from 'handlebars/)
  })

  it('does not import from `electron-store` or `electron-builder`', () => {
    expect(SOURCE).not.toMatch(/from 'electron-store/)
    expect(SOURCE).not.toMatch(/from 'electron-builder/)
  })

  it('header comment advertises pure-data positioning ("Pure functions, no React, no localStorage")', () => {
    expect(SOURCE).toMatch(/Pure functions/)
    expect(SOURCE).toMatch(/no React/)
    expect(SOURCE).toMatch(/no localStorage/)
  })

  it('contains the documented null-fallback comment for getEnvironmentForMachine', () => {
    expect(SOURCE).toMatch(/no environment selected/)
  })

  it('throw site uses the documented prefix "Unknown shop environment id:"', () => {
    expect(SOURCE).toMatch(/Unknown shop environment id:/)
  })

  it('contains exactly one throw site (only getEnvironmentById throws)', () => {
    const throws = SOURCE.match(/\bthrow new Error\b/g) ?? []
    expect(throws.length).toBe(1)
  })

  it('uses Array.find for owned-set filtering (not Array.filter or Set lookup)', () => {
    // Pin the implementation choice: getMachinesForEnvironment iterates
    // env.machineIds in declared order and uses .find on the input array.
    expect(SOURCE).toMatch(/machines\.find/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (J) Registry-coupling invariants
// ────────────────────────────────────────────────────────────────────────────

describe('env-routing-pin (J) registry-coupling invariants', () => {
  it('ENVIRONMENT_LIST has exactly three entries (one per CLAUDE.md target environment)', () => {
    expect(ENVIRONMENT_LIST.length).toBe(3)
  })

  it('ENVIRONMENT_LIST id order matches splash card layout: [vcarve_pro, creality_print, makera_cam]', () => {
    expect(ENVIRONMENT_LIST.map((e) => e.id)).toEqual(['vcarve_pro', 'creality_print', 'makera_cam'])
  })

  it('ENVIRONMENTS map has exactly the three documented keys', () => {
    expect(Object.keys(ENVIRONMENTS).sort()).toEqual(['creality_print', 'makera_cam', 'vcarve_pro'])
  })

  it('ENVIRONMENT_LIST entries are reference-equal to ENVIRONMENTS map values', () => {
    expect(ENVIRONMENT_LIST[0]).toBe(ENVIRONMENTS.vcarve_pro)
    expect(ENVIRONMENT_LIST[1]).toBe(ENVIRONMENTS.creality_print)
    expect(ENVIRONMENT_LIST[2]).toBe(ENVIRONMENTS.makera_cam)
  })

  it('every env exposes all required ShopEnvironment fields (no undefined gaps)', () => {
    const required: readonly (keyof ShopEnvironment)[] = [
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
      'requiresSlicer'
    ]
    for (const env of ENVIRONMENT_LIST) {
      for (const k of required) {
        expect(env[k]).toBeDefined()
      }
    }
  })

  it('every env id is non-empty and matches its registry key', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.id.length).toBeGreaterThan(0)
      expect(ENVIRONMENTS[env.id].id).toBe(env.id)
    }
  })

  it('every env machineIds is a non-empty readonly array of strings', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.machineIds.length).toBeGreaterThan(0)
      for (const id of env.machineIds) {
        expect(typeof id).toBe('string')
        expect(id.length).toBeGreaterThan(0)
      }
    }
  })

  it('every env jobsStorageKey starts with the project namespace prefix "fab-jobs-"', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.jobsStorageKey.startsWith('fab-jobs-')).toBe(true)
    }
  })

  it('jobsStorageKey values are unique across environments (no localStorage collision)', () => {
    const keys = ENVIRONMENT_LIST.map((e) => e.jobsStorageKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('Creality Print is the only env that requires a slicer', () => {
    const reqSlicer = ENVIRONMENT_LIST.filter((e) => e.requiresSlicer)
    expect(reqSlicer.map((e) => e.id)).toEqual(['creality_print'])
  })

  it('VCarve Pro and Makera CAM are the two envs that require Python (CAM kernel)', () => {
    const reqPy = ENVIRONMENT_LIST.filter((e) => e.requiresPython).map((e) => e.id).sort()
    expect(reqPy).toEqual(['makera_cam', 'vcarve_pro'])
  })

  it('availableOpKinds is non-empty for every env', () => {
    for (const env of ENVIRONMENT_LIST) {
      expect(env.availableOpKinds.length).toBeGreaterThan(0)
    }
  })
})
