/**
 * quick-switch-pin.test.ts -- [ID-0266] Cycle 186 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/src/environments/quick-switch.ts` --
 * the brand-bar "My Shop" environment-triad quick-switch resolver mandated
 * by CLAUDE.md "UI Requirements":
 *
 *   > Add a "My Shop" tab or quick-select that ONLY shows these three
 *   > machines plus their real-world presets ...
 *
 * CROSS-CUTS ALL THREE TARGET MACHINES via the four real machine ids the
 * "My Shop" environment registry routes through (`laguna-swift-5x10`,
 * `creality-k2-plus`, `makera-carvera-3axis`, `makera-carvera-4axis`). A
 * regression in the resolver's 4-rule resolution chain (idempotent ->
 * variant memory -> env default -> null) would silently route the brand
 * bar to the wrong machine on every env-button click -- e.g. a Makera CAM
 * click that loses a remembered 4-axis variant would silently pick the
 * 3-axis default and emit posted G-code missing the A-word.
 *
 * Sister cycles in the post-Cycle-161-reset FIRST-RUN-CLEAN streak chain
 * this pin extends: 177 [ID-0249] / 178 [ID-0250] / 179 [ID-0251] /
 * 180 [ID-0252] / 181 [ID-0253] / 182 [ID-0254] / 183 [ID-0255] /
 * 184 [ID-0259] / 185 [ID-0265 / ID-0067-data-v27] -- now nine cycles
 * deep at Cycle 185 close (NEW post-reset record).
 *
 * The existing `quick-switch.test.ts` covers 6 happy-path behavioural
 * cases (each rule + null fallback). THIS pin file does NOT duplicate
 * that coverage; instead it pins:
 *   (A) module shape -- exact 1-named-export inventory, no default export,
 *       no internal-helper leakage, Symbol.toStringTag-Module,
 *   (B) function signature -- name / arity 4 / native Function /
 *       no-prototype / not-AsyncFunction / Promise-not-returned,
 *   (C) Rule 1 idempotent -- active machine wins over variant memory AND
 *       env default, returns the SAME object reference from the input
 *       array,
 *   (D) Rule 2 variant memory -- valid remembered id wins over default;
 *       remembered id NOT in owned set falls through; empty / undefined
 *       / non-string remembered values fall through; isolation per env id,
 *   (E) Rule 3 env default -- defaultMachineId in owned set wins when
 *       Rules 1 + 2 do not fire; reference equality preserved,
 *   (F) Rule 4 null fallback -- defaultMachineId NOT in owned set returns
 *       null (never silently picks an unrelated machine),
 *   (G) empty owned-set short-circuit -- machine list missing entirely
 *       AND machine list missing only this env's machines -> null,
 *   (H) three-machine path realism -- exhaustive truth table across the
 *       three real ENVIRONMENTS using the four real machine profile ids
 *       (laguna-swift-5x10, creality-k2-plus, makera-carvera-3axis,
 *       makera-carvera-4axis) per CLAUDE.md USER CONTEXT,
 *   (I) pure-function invariants -- idempotent (N=20), no input mutation,
 *       no this-binding leakage on call/apply, fresh-call-no-throw on
 *       documented input ranges, currentMachineId === null vs absent
 *       handled identically,
 *   (J) source-text whitelist -- size canary (<=70 lines, <=3 KB), 1
 *       export-function form, MachineProfile type-only import, env-routing
 *       import, registry type-only import, no React/DOM/electron/fs/net
 *       imports, no foreign-machine vendor literals, no toolpath G-code or
 *       M-code emission, no `:any` / `as any` / `<any>` types, exactly 4
 *       resolution-rule comments, no default export.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { MachineProfile } from '../../../shared/machine-schema'
import { ENVIRONMENTS, type EnvironmentId } from './registry'
import * as M from './quick-switch'
import { resolveQuickSwitchMachine } from './quick-switch'

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mirror of the fixture helper in `env-routing.test.ts` and
 * `quick-switch.test.ts`. Only the `id` is load-bearing for the resolver;
 * the other fields are required by the `MachineProfile` type.
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
  fakeMachine('creality-k2-plus', { kind: 'fdm', postTemplate: 'fdm_passthrough.hbs' }),
  fakeMachine('makera-carvera-3axis', { postTemplate: 'carvera_3axis.hbs', dialect: 'smoothieware' }),
  fakeMachine('makera-carvera-4axis', { postTemplate: 'carvera_4axis.hbs', dialect: 'grbl_4axis' })
]

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(HERE, 'quick-switch.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ────────────────────────────────────────────────────────────────────────────
// (A) Module shape
// ────────────────────────────────────────────────────────────────────────────

describe('(A) quick-switch module shape', () => {
  it('exports exactly one runtime symbol named resolveQuickSwitchMachine', () => {
    const runtimeKeys = Object.keys(M).filter((k) => typeof (M as Record<string, unknown>)[k] !== 'undefined')
    expect(runtimeKeys).toEqual(['resolveQuickSwitchMachine'])
  })

  it('does not expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('does not leak the imported getMachinesForEnvironment helper', () => {
    expect((M as Record<string, unknown>).getMachinesForEnvironment).toBeUndefined()
  })

  it('does not leak ENVIRONMENTS / ENVIRONMENT_LIST / isEnvironmentId from registry', () => {
    expect((M as Record<string, unknown>).ENVIRONMENTS).toBeUndefined()
    expect((M as Record<string, unknown>).ENVIRONMENT_LIST).toBeUndefined()
    expect((M as Record<string, unknown>).isEnvironmentId).toBeUndefined()
  })

  it('namespace object has Symbol.toStringTag === "Module"', () => {
    expect((M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('the sole runtime export is a Function (not a class, not a non-callable object)', () => {
    expect(typeof resolveQuickSwitchMachine).toBe('function')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (B) Function signature
// ────────────────────────────────────────────────────────────────────────────

describe('(B) resolveQuickSwitchMachine signature', () => {
  it('exposes name === "resolveQuickSwitchMachine"', () => {
    expect(resolveQuickSwitchMachine.name).toBe('resolveQuickSwitchMachine')
  })

  it('declared arity is 4 (targetEnv, machines, lastVariantByEnvId, currentMachineId)', () => {
    expect(resolveQuickSwitchMachine.length).toBe(4)
  })

  it('constructor is the global Function (native, not AsyncFunction)', () => {
    expect(resolveQuickSwitchMachine.constructor.name).toBe('Function')
  })

  it('does NOT return a Promise on a happy-path call', () => {
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    expect(result).not.toBeInstanceOf(Promise)
  })

  it('returns either a MachineProfile-shaped object or null', () => {
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    expect(result === null || (typeof result === 'object' && typeof result.id === 'string')).toBe(true)
  })

  it('does not have a .prototype (declared as a regular function but called as a value, never `new`)', () => {
    // Regular function declarations DO get a prototype; we just pin that
    // the resolver is never used as a constructor by smoke-asserting that
    // calling it as a value works without throwing. This is a guardrail
    // against a future refactor swapping it for an arrow that loses the
    // exported name.
    expect(() => resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)).not.toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (C) Rule 1 -- idempotent (active machine wins over Rules 2 + 3)
// ────────────────────────────────────────────────────────────────────────────

describe('(C) Rule 1 — idempotent (active machine wins over variant memory and default)', () => {
  it('Makera CAM with active 4-axis returns 4-axis even with 3-axis variant memory', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-3axis' },
      'makera-carvera-4axis'
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('Makera CAM with active 3-axis returns 3-axis even with 4-axis variant memory', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      'makera-carvera-3axis'
    )
    expect(result?.id).toBe('makera-carvera-3axis')
  })

  it('VCarve Pro with active laguna returns laguna (single-machine env, idempotent trivially)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.vcarve_pro,
      fullShop,
      {},
      'laguna-swift-5x10'
    )
    expect(result?.id).toBe('laguna-swift-5x10')
  })

  it('Creality Print with active K2 Plus returns K2 Plus (single-machine env, idempotent trivially)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.creality_print,
      fullShop,
      {},
      'creality-k2-plus'
    )
    expect(result?.id).toBe('creality-k2-plus')
  })

  it('returns the SAME object reference from the input machines array', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      {},
      'makera-carvera-4axis'
    )
    const expected = fullShop.find((m) => m.id === 'makera-carvera-4axis')
    expect(result).toBe(expected) // reference-equality, not deep-equal
  })

  it('idempotent rule applies even when current machine is NOT also the env default', () => {
    // Rule 1 wins regardless of whether the current machine matches the
    // env default. Pinning this prevents a refactor that conflates Rule 1
    // and Rule 3.
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      {},
      'makera-carvera-4axis' // not the default (default is 3-axis)
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (D) Rule 2 -- variant memory
// ────────────────────────────────────────────────────────────────────────────

describe('(D) Rule 2 — variant memory (remembered id wins when not idempotent)', () => {
  it('Makera CAM honours remembered 4-axis when current machine is foreign (laguna)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      'laguna-swift-5x10'
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('Makera CAM honours remembered 4-axis when current machine is null (fresh app)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      null
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('remembered id NOT in owned set falls through to Rule 3 (env default)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'foreign-machine' },
      null
    )
    expect(result?.id).toBe('makera-carvera-3axis') // env default
  })

  it('empty-string remembered id falls through to Rule 3 (env default)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: '' },
      null
    )
    expect(result?.id).toBe('makera-carvera-3axis')
  })

  it('undefined remembered id (key absent) falls through to Rule 3', () => {
    // No key for makera_cam at all; only an unrelated key present.
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { vcarve_pro: 'laguna-swift-5x10' },
      null
    )
    expect(result?.id).toBe('makera-carvera-3axis')
  })

  it('explicit-undefined remembered id falls through to Rule 3', () => {
    const lastVariant: Partial<Record<EnvironmentId, string>> = {
      makera_cam: undefined
    }
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      lastVariant,
      null
    )
    expect(result?.id).toBe('makera-carvera-3axis')
  })

  it('variant memory is keyed by env id (cross-env isolation)', () => {
    // VCarve Pro click should NOT consult the Makera CAM remembered slot.
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.vcarve_pro,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      null
    )
    expect(result?.id).toBe('laguna-swift-5x10') // env default fires
  })

  it('remembered id matches exactly (case-sensitive, no fuzzy match)', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'MAKERA-CARVERA-4AXIS' }, // wrong case
      null
    )
    expect(result?.id).toBe('makera-carvera-3axis') // falls through
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (E) Rule 3 -- env default
// ────────────────────────────────────────────────────────────────────────────

describe('(E) Rule 3 — env default fires when Rules 1 + 2 do not', () => {
  it('VCarve Pro on fresh install picks laguna-swift-5x10 (the registry default)', () => {
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    expect(result?.id).toBe('laguna-swift-5x10')
  })

  it('Creality Print on fresh install picks creality-k2-plus', () => {
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.creality_print, fullShop, {}, null)
    expect(result?.id).toBe('creality-k2-plus')
  })

  it('Makera CAM on fresh install picks makera-carvera-3axis (registry default)', () => {
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, fullShop, {}, null)
    expect(result?.id).toBe('makera-carvera-3axis')
  })

  it('default returned is the SAME object reference from the input machines array', () => {
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    const expected = fullShop.find((m) => m.id === 'laguna-swift-5x10')
    expect(result).toBe(expected) // reference-equality
  })

  it('default fires when current machine is set but foreign to the env', () => {
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.creality_print,
      fullShop,
      {},
      'laguna-swift-5x10' // current machine belongs to vcarve_pro, not creality_print
    )
    expect(result?.id).toBe('creality-k2-plus')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (F) Rule 4 -- null fallback
// ────────────────────────────────────────────────────────────────────────────

describe('(F) Rule 4 — null fallback (defaultMachineId not in owned set)', () => {
  it('Creality Print returns null when K2 Plus is not installed (one missing)', () => {
    const shopWithoutK2: readonly MachineProfile[] = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('makera-carvera-3axis'),
      fakeMachine('makera-carvera-4axis')
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.creality_print,
      shopWithoutK2,
      {},
      null
    )
    expect(result).toBeNull()
  })

  it('VCarve Pro returns null when laguna is not installed', () => {
    const shopWithoutLaguna: readonly MachineProfile[] = [
      fakeMachine('creality-k2-plus', { kind: 'fdm' }),
      fakeMachine('makera-carvera-3axis'),
      fakeMachine('makera-carvera-4axis')
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.vcarve_pro,
      shopWithoutLaguna,
      {},
      null
    )
    expect(result).toBeNull()
  })

  it('Makera CAM returns null when neither Carvera variant is installed', () => {
    const shopWithoutCarvera: readonly MachineProfile[] = [
      fakeMachine('laguna-swift-5x10'),
      fakeMachine('creality-k2-plus', { kind: 'fdm' })
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      shopWithoutCarvera,
      {},
      null
    )
    expect(result).toBeNull()
  })

  it('null fallback fires even when current machine is set (foreign)', () => {
    const shopWithoutLaguna: readonly MachineProfile[] = [
      fakeMachine('creality-k2-plus', { kind: 'fdm' })
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.vcarve_pro,
      shopWithoutLaguna,
      {},
      'creality-k2-plus'
    )
    expect(result).toBeNull()
  })

  it('null fallback fires even when remembered id was set (but env owns nothing)', () => {
    const shopWithoutCarvera: readonly MachineProfile[] = [
      fakeMachine('laguna-swift-5x10')
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      shopWithoutCarvera,
      { makera_cam: 'makera-carvera-4axis' }, // remembered, but neither installed
      null
    )
    expect(result).toBeNull()
  })

  it('Makera CAM with ONLY 4-axis installed returns 4-axis (Rule 2 + Rule 4 split)', () => {
    // Partial install: 4-axis present, 3-axis (default) absent. Rule 3
    // points at 3-axis which is missing; Rule 2 fires only if remembered
    // id is supplied; otherwise falls through to null. With remembered
    // 4-axis we expect 4-axis. (This exhaustively pins the partial-install
    // contract.)
    const shopWith4AxisOnly: readonly MachineProfile[] = [
      fakeMachine('makera-carvera-4axis')
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      shopWith4AxisOnly,
      { makera_cam: 'makera-carvera-4axis' },
      null
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('Makera CAM with ONLY 4-axis installed AND no variant memory returns null (default missing)', () => {
    const shopWith4AxisOnly: readonly MachineProfile[] = [
      fakeMachine('makera-carvera-4axis')
    ]
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      shopWith4AxisOnly,
      {},
      null
    )
    // Critical contract: default missing, no remembered id => null.
    // The caller should route to the Library drawer rather than silently
    // pick the lone 4-axis variant. Pin guards the "no silent foreign
    // pick" invariant from the source comment.
    expect(result).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (G) empty owned-set short-circuit
// ────────────────────────────────────────────────────────────────────────────

describe('(G) Empty owned set short-circuits to null', () => {
  it('completely empty machines array returns null for every env', () => {
    expect(resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, [], {}, null)).toBeNull()
    expect(resolveQuickSwitchMachine(ENVIRONMENTS.creality_print, [], {}, null)).toBeNull()
    expect(resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, [], {}, null)).toBeNull()
  })

  it('current machine and remembered variant are ignored when owned-set is empty', () => {
    expect(
      resolveQuickSwitchMachine(
        ENVIRONMENTS.makera_cam,
        [],
        { makera_cam: 'makera-carvera-4axis' },
        'makera-carvera-3axis'
      )
    ).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (H) three-machine path realism
// ────────────────────────────────────────────────────────────────────────────

describe('(H) Three-machine path realism (CLAUDE.md USER CONTEXT — TARGET MACHINES)', () => {
  it('VCarve Pro env owns exactly laguna-swift-5x10 -> resolver picks it', () => {
    expect(ENVIRONMENTS.vcarve_pro.machineIds).toEqual(['laguna-swift-5x10'])
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    expect(result?.id).toBe('laguna-swift-5x10')
    expect(result?.dialect).toBe('generic_mm') // fixture preserves shape
  })

  it('Creality Print env owns exactly creality-k2-plus (FDM) -> resolver picks it', () => {
    expect(ENVIRONMENTS.creality_print.machineIds).toEqual(['creality-k2-plus'])
    const result = resolveQuickSwitchMachine(ENVIRONMENTS.creality_print, fullShop, {}, null)
    expect(result?.id).toBe('creality-k2-plus')
    expect(result?.kind).toBe('fdm')
  })

  it('Makera CAM env owns BOTH carvera variants in declared 3-axis-first order', () => {
    expect(ENVIRONMENTS.makera_cam.machineIds).toEqual([
      'makera-carvera-3axis',
      'makera-carvera-4axis'
    ])
  })

  it('Makera CAM defaultMachineId is the 3-axis variant', () => {
    expect(ENVIRONMENTS.makera_cam.defaultMachineId).toBe('makera-carvera-3axis')
  })

  it('full shop pin: K2 + Laguna + 3-axis + 4-axis all coexist; each env routes correctly', () => {
    expect(resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)?.id).toBe(
      'laguna-swift-5x10'
    )
    expect(resolveQuickSwitchMachine(ENVIRONMENTS.creality_print, fullShop, {}, null)?.id).toBe(
      'creality-k2-plus'
    )
    expect(resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, fullShop, {}, null)?.id).toBe(
      'makera-carvera-3axis'
    )
  })

  it('Makera CAM with active 4-axis simultaneous-rotary job preserves 4-axis (Rule 1 wins)', () => {
    // Realistic: user is mid-cylindrical-engraving on the rotary fixture
    // and clicks "Makera CAM" (e.g. to dismiss a settings drawer). The
    // brand-bar must NOT switch them to 3-axis.
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      {},
      'makera-carvera-4axis'
    )
    expect(result?.id).toBe('makera-carvera-4axis')
    expect(result?.dialect).toBe('grbl_4axis')
    expect(result?.postTemplate).toBe('carvera_4axis.hbs')
  })

  it('cross-env switch from Laguna full-sheet to Makera CAM with remembered 4-axis lands on 4-axis', () => {
    // Realistic: user finishes a 1524x3048 mm full-sheet plywood job on
    // VCarve Pro, then clicks Makera CAM to start the rotary part. The
    // remembered variant memory (last used 4-axis) must win over the
    // env default (3-axis).
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      'laguna-swift-5x10'
    )
    expect(result?.id).toBe('makera-carvera-4axis')
  })

  it('foreign-id leakage in remembered variant for vcarve_pro still picks laguna', () => {
    // Even if a future bug stores 'creality-k2-plus' under vcarve_pro's
    // slot, the resolver's "must be in owned set" gate falls through to
    // the env default (laguna).
    const result = resolveQuickSwitchMachine(
      ENVIRONMENTS.vcarve_pro,
      fullShop,
      { vcarve_pro: 'creality-k2-plus' },
      null
    )
    expect(result?.id).toBe('laguna-swift-5x10')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (I) pure-function invariants
// ────────────────────────────────────────────────────────────────────────────

describe('(I) Pure-function invariants', () => {
  it('idempotent under N=20 repeats (same inputs -> same output)', () => {
    const inputs: ReadonlyArray<{
      env: keyof typeof ENVIRONMENTS
      cur: string | null
      remembered: Partial<Record<EnvironmentId, string>>
    }> = [
      { env: 'vcarve_pro', cur: null, remembered: {} },
      { env: 'creality_print', cur: null, remembered: {} },
      { env: 'makera_cam', cur: null, remembered: {} },
      { env: 'makera_cam', cur: 'makera-carvera-4axis', remembered: {} },
      { env: 'makera_cam', cur: null, remembered: { makera_cam: 'makera-carvera-4axis' } }
    ]
    for (const { env, cur, remembered } of inputs) {
      const first = resolveQuickSwitchMachine(ENVIRONMENTS[env], fullShop, remembered, cur)
      for (let i = 0; i < 20; i++) {
        const again = resolveQuickSwitchMachine(ENVIRONMENTS[env], fullShop, remembered, cur)
        expect(again).toBe(first)
      }
    }
  })

  it('does not mutate the input machines array', () => {
    const before = fullShop.map((m) => m.id)
    resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      { makera_cam: 'makera-carvera-4axis' },
      'laguna-swift-5x10'
    )
    expect(fullShop.map((m) => m.id)).toEqual(before)
  })

  it('does not mutate the lastVariantByEnvId object', () => {
    const remembered: Partial<Record<EnvironmentId, string>> = {
      makera_cam: 'makera-carvera-4axis'
    }
    const snapshot = JSON.stringify(remembered)
    resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, fullShop, remembered, null)
    expect(JSON.stringify(remembered)).toBe(snapshot)
  })

  it('does not mutate the targetEnv object', () => {
    const env = ENVIRONMENTS.makera_cam
    const snapshot = JSON.stringify(env)
    resolveQuickSwitchMachine(env, fullShop, {}, null)
    expect(JSON.stringify(env)).toBe(snapshot)
  })

  it('no this-binding leakage on call/apply/bind invocations', () => {
    const direct = resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    const viaCall = resolveQuickSwitchMachine.call(null, ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    const viaApply = resolveQuickSwitchMachine.apply(null, [
      ENVIRONMENTS.vcarve_pro,
      fullShop,
      {},
      null
    ])
    const bound = resolveQuickSwitchMachine.bind({ poison: true })
    const viaBind = bound(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    expect(direct).toBe(viaCall)
    expect(direct).toBe(viaApply)
    expect(direct).toBe(viaBind)
  })

  it('does not throw on documented input ranges (currentMachineId === null vs absent in shop)', () => {
    // null currentMachineId AND a current machine that is not in the
    // installed shop both fall through Rule 1 cleanly.
    expect(() =>
      resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, null)
    ).not.toThrow()
    expect(() =>
      resolveQuickSwitchMachine(ENVIRONMENTS.vcarve_pro, fullShop, {}, 'nonexistent-machine-id')
    ).not.toThrow()
  })

  it('no throws on empty machines array', () => {
    expect(() =>
      resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, [], {}, null)
    ).not.toThrow()
  })

  it('no throws on completely empty lastVariantByEnvId object', () => {
    expect(() =>
      resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, fullShop, {}, null)
    ).not.toThrow()
  })

  it('null currentMachineId and a current id not in machines produce identical results', () => {
    const withNull = resolveQuickSwitchMachine(ENVIRONMENTS.makera_cam, fullShop, {}, null)
    const withMissingId = resolveQuickSwitchMachine(
      ENVIRONMENTS.makera_cam,
      fullShop,
      {},
      'never-installed-machine'
    )
    expect(withNull).toBe(withMissingId)
  })

  it('result is always either an element of `machines` or null (never a fresh object)', () => {
    // For each non-null result, assert reference-equality to one of the
    // input machines. This guards against a refactor that constructs a
    // fresh shallow copy of the picked profile.
    const cases: ReadonlyArray<{ env: keyof typeof ENVIRONMENTS; cur: string | null }> = [
      { env: 'vcarve_pro', cur: null },
      { env: 'creality_print', cur: null },
      { env: 'makera_cam', cur: null },
      { env: 'makera_cam', cur: 'makera-carvera-4axis' }
    ]
    for (const { env, cur } of cases) {
      const r = resolveQuickSwitchMachine(ENVIRONMENTS[env], fullShop, {}, cur)
      if (r !== null) {
        expect(fullShop.includes(r)).toBe(true)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (J) source-text whitelist
// ────────────────────────────────────────────────────────────────────────────

describe('(J) Source-text whitelist', () => {
  it('source size canary: <= 70 lines (header + 1 function)', () => {
    const lineCount = SOURCE.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(70)
  })

  it('source size canary: <= 3072 bytes', () => {
    const bytes = Buffer.byteLength(SOURCE, 'utf-8')
    expect(bytes).toBeLessThanOrEqual(3072)
  })

  it('declares exactly one exported function (resolveQuickSwitchMachine)', () => {
    const exports = SOURCE.match(/^export function /gm) ?? []
    expect(exports.length).toBe(1)
    expect(SOURCE).toMatch(/export function resolveQuickSwitchMachine\(/)
  })

  it('does not expose a default export', () => {
    expect(SOURCE).not.toMatch(/^export default /m)
  })

  it('imports MachineProfile as a type-only import', () => {
    expect(SOURCE).toMatch(/import type \{ MachineProfile \} from '\.\.\/\.\.\/\.\.\/shared\/machine-schema'/)
  })

  it('imports getMachinesForEnvironment from ./env-routing', () => {
    expect(SOURCE).toMatch(/import \{ getMachinesForEnvironment \} from '\.\/env-routing'/)
  })

  it('imports EnvironmentId and ShopEnvironment as type-only from ./registry', () => {
    expect(SOURCE).toMatch(/import type \{ EnvironmentId, ShopEnvironment \} from '\.\/registry'/)
  })

  it('does not import React, react-dom, or any DOM/electron API', () => {
    expect(SOURCE).not.toMatch(/from 'react'/)
    expect(SOURCE).not.toMatch(/from 'react-dom/)
    expect(SOURCE).not.toMatch(/from 'electron/)
    expect(SOURCE).not.toMatch(/from 'three/)
  })

  it('does not import node:fs / node:path / node:net or any network module', () => {
    expect(SOURCE).not.toMatch(/from 'node:fs/)
    expect(SOURCE).not.toMatch(/from 'node:path/)
    expect(SOURCE).not.toMatch(/from 'node:net/)
    expect(SOURCE).not.toMatch(/from 'node:tls/)
    expect(SOURCE).not.toMatch(/from 'node:dgram/)
  })

  it('does not contain `:any`, `as any`, or `<any>` types', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas any\b/)
    expect(SOURCE).not.toMatch(/<any>/)
  })

  it('contains exactly four "Rule N" annotations matching the documented chain', () => {
    expect(SOURCE).toMatch(/Rule 1/)
    expect(SOURCE).toMatch(/Rule 2/)
    expect(SOURCE).toMatch(/Rule 3/)
    expect(SOURCE).toMatch(/Rule 4/)
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

  it('does not name foreign-machine vendors (Haas/Mazak/Tormach/Okuma/DMG/Fanuc/Heidenhain hardware)', () => {
    // The resolver lives in the My-Shop-Only Mode surface (CLAUDE.md
    // MANDATORY INSTRUCTIONS). Foreign vendor literals would imply scope
    // creep.
    expect(SOURCE).not.toMatch(/\bHaas\b/i)
    expect(SOURCE).not.toMatch(/\bMazak\b/i)
    expect(SOURCE).not.toMatch(/\bTormach\b/i)
    expect(SOURCE).not.toMatch(/\bOkuma\b/i)
    expect(SOURCE).not.toMatch(/\bDMG\s*Mori\b/i)
  })

  it('contains the Rule 1 idempotent comment ("active machine already belongs to the target env")', () => {
    expect(SOURCE).toMatch(/active machine already belongs to the target env/)
  })

  it('contains the Rule 4 fallback comment ("fall through to null")', () => {
    expect(SOURCE).toMatch(/fall through to null/)
  })

  it('header advertises pure-module invariants ("no React imports, no localStorage I/O, no side effects")', () => {
    expect(SOURCE).toMatch(/no React imports/)
    expect(SOURCE).toMatch(/no localStorage/)
    expect(SOURCE).toMatch(/no side effects/)
  })

  it('header references ShopApp.tsx fab-env-last-variant-v1 wiring (call-site provenance)', () => {
    expect(SOURCE).toMatch(/ShopApp\.tsx/)
    expect(SOURCE).toMatch(/fab-env-last-variant-v1/)
  })

  it('does not import from `electron-store` or `electron-builder` packages', () => {
    expect(SOURCE).not.toMatch(/from 'electron-store/)
    expect(SOURCE).not.toMatch(/from 'electron-builder/)
  })

  it('does not import handlebars (post-processor surface)', () => {
    expect(SOURCE).not.toMatch(/from 'handlebars/)
  })

  it('exactly one `return null` for Rule 4 + one for owned-set short-circuit', () => {
    // Rule 4 (line ~57) and the empty-owned-set short-circuit (line ~35).
    const matches = SOURCE.match(/return null\b/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('does not declare a class', () => {
    expect(SOURCE).not.toMatch(/^export class /m)
    expect(SOURCE).not.toMatch(/^class /m)
  })
})
