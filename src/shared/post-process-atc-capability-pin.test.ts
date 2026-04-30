/**
 * post-process-atc-capability-pin.test.ts -- [ID-0228] Cycle 155
 * post-processing paired-pin for `src/shared/post-process-atc-capability.ts`.
 *
 * Sister to the existing `post-process-atc-capability.test.ts` (which
 * pins the behaviour-level surface of the helper across the bundled
 * fleet). This co-located paired-pin extends that coverage with module
 * shape (exact named-export inventory + arities + Symbol.toStringTag /
 * null-prototype invariants), discriminated-union shape contract,
 * defensive defaults (atcSlotCount === 0 -> 'no-atc-slots'; FDM with a
 * malformed atcSlotCount still returns 'fdm'), purity / referential
 * non-mutation across N=10 calls, AND a source-text whitelist pinning
 * roadmap-[ID-0093] provenance, CLAUDE.md USER CONTEXT decision-rule
 * comments, the discriminated-union literal, and Safety Rule 1/2/3
 * negative invariants (no electron/fs/path/child_process imports, no
 * `any` 3-form, no top-level `let`, no Handlebars tokens, no G-code or
 * M-code emission, no foreign-machine vendor names, no axisCount
 * consultation -- the JSDoc explicitly notes the helper does NOT
 * branch on axisCount because the bundled Carvera 4-axis profile
 * already encodes "no ATC in 4-axis mode" by omitting atcSlotCount).
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130
 * [ID-0207] / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135
 * [ID-0211] / 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140
 * [ID-0215] / 142 [ID-0216] / 144 [ID-0217] / 145 [ID-0218] / 146
 * [ID-0220] / 147 [ID-0222] / 149 [ID-0225] / 150 [ID-0221] / 151
 * [ID-0226] / 152 [ID-0224] / 153 [ID-0067-data-v21] / 154 [ID-0227].
 *
 * Three-machine impact: PRIMARY = Makera Carvera (3-axis: supported,
 * 6 slots + T0 probe; 4-axis: NOT supported, rotary occupies bay).
 * UNAFFECTED-but-fleet-tested = Creality K2 Plus (FDM never supports
 * ATC), Laguna Swift 5x10 (manual ER-20 collet, no ATC). Drift in the
 * helper would silently let the M6 macro emit on FDM (filament
 * extruder collision) or 4-axis Carvera (rotary collision with empty
 * ATC bay) -- both load-bearing safety rails for the post-processor.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './post-process-atc-capability'
import {
  deriveAtcCapability,
  machineSupportsAtc,
  type AtcCapability
} from './post-process-atc-capability'
import { machineProfileSchema, type MachineProfile } from './machine-schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'post-process-atc-capability.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

const RESOURCES_ROOT = join(process.cwd(), 'resources')
function loadProfile(filename: string): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', filename)
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

// Strip comments + string literals so source-text scans of executable
// code do not collide with JSDoc framing or docstring-embedded literals.
function codeOnly(src: string): string {
  // Remove block comments first (greedy lazy across lines)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove line comments
  out = out.replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  return out
}

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0228] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(['deriveAtcCapability', 'machineSupportsAtc'].sort())
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
  })

  it('has Symbol.toStringTag === "Module" on the ESM namespace', () => {
    expect((M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('declares Function.length === 1 for deriveAtcCapability (one machine arg)', () => {
    expect(M.deriveAtcCapability.length).toBe(1)
  })

  it('declares Function.length === 1 for machineSupportsAtc (one machine arg)', () => {
    expect(M.machineSupportsAtc.length).toBe(1)
  })

  it('both runtime symbols are functions', () => {
    expect(typeof M.deriveAtcCapability).toBe('function')
    expect(typeof M.machineSupportsAtc).toBe('function')
  })

  it('does NOT export AtcCapability as a runtime value (it is type-only)', () => {
    expect((M as Record<string, unknown>).AtcCapability).toBeUndefined()
  })

  it('does NOT expose any internal helpers (only the 2 documented exports)', () => {
    const runtimeKeys = Object.keys(M)
    expect(runtimeKeys).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// B) Discriminated-union return contract
// ---------------------------------------------------------------------------

describe('[ID-0228] B) AtcCapability discriminated-union shape', () => {
  it('FDM branch returns exactly { supported: false, reason }', () => {
    const cap = deriveAtcCapability({ kind: 'fdm' })
    expect(Object.keys(cap).sort()).toEqual(['reason', 'supported'].sort())
  })

  it('CNC-no-slots branch returns exactly { supported: false, reason }', () => {
    const cap = deriveAtcCapability({ kind: 'cnc' })
    expect(Object.keys(cap).sort()).toEqual(['reason', 'supported'].sort())
  })

  it('CNC-with-slots-no-probe branch returns exactly { supported: true, slotCount }', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 6 })
    expect(Object.keys(cap).sort()).toEqual(['slotCount', 'supported'].sort())
  })

  it('CNC-with-slots-and-probe branch returns exactly { supported: true, slotCount, probeSlot }', () => {
    const cap = deriveAtcCapability({
      kind: 'cnc',
      atcSlotCount: 6,
      atcProbeSlot: 0
    })
    expect(Object.keys(cap).sort()).toEqual(
      ['probeSlot', 'slotCount', 'supported'].sort()
    )
  })

  it('reason is one of the two documented literals on the not-supported branch', () => {
    const fdm = deriveAtcCapability({ kind: 'fdm' })
    const cnc = deriveAtcCapability({ kind: 'cnc' })
    expect(fdm.supported).toBe(false)
    expect(cnc.supported).toBe(false)
    if (!fdm.supported) expect(['fdm', 'no-atc-slots']).toContain(fdm.reason)
    if (!cnc.supported) expect(['fdm', 'no-atc-slots']).toContain(cnc.reason)
  })

  it('does NOT leak slotCount onto the not-supported branch (FDM)', () => {
    const cap = deriveAtcCapability({ kind: 'fdm' })
    expect((cap as Record<string, unknown>).slotCount).toBeUndefined()
    expect((cap as Record<string, unknown>).probeSlot).toBeUndefined()
  })

  it('does NOT leak slotCount onto the not-supported branch (CNC no-atc-slots)', () => {
    const cap = deriveAtcCapability({ kind: 'cnc' })
    expect((cap as Record<string, unknown>).slotCount).toBeUndefined()
    expect((cap as Record<string, unknown>).probeSlot).toBeUndefined()
  })

  it('does NOT leak reason onto the supported branch', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 6 })
    expect((cap as Record<string, unknown>).reason).toBeUndefined()
  })

  it('omits probeSlot key entirely (not just undefined) on supported branch when probe is unset', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 6 })
    expect(Object.prototype.hasOwnProperty.call(cap, 'probeSlot')).toBe(false)
  })

  it('TypeScript widens the helper return to AtcCapability (compile-time pin)', () => {
    // The cast is the pin -- if the return type drifted, this assignment
    // would fail at compile time.
    const cap: AtcCapability = deriveAtcCapability({ kind: 'fdm' })
    expect(cap.supported).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// C) FDM branch defensive coverage
// ---------------------------------------------------------------------------

describe('[ID-0228] C) FDM branch defensive coverage', () => {
  it('FDM with positive atcSlotCount STILL returns reason "fdm"', () => {
    const cap = deriveAtcCapability({
      kind: 'fdm',
      atcSlotCount: 6,
      atcProbeSlot: 0
    })
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('fdm')
  })

  it('FDM with atcSlotCount === 0 returns reason "fdm" (FDM short-circuits before slot check)', () => {
    const cap = deriveAtcCapability({ kind: 'fdm', atcSlotCount: 0 })
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('fdm')
  })

  it('FDM with atcSlotCount === undefined returns reason "fdm"', () => {
    const cap = deriveAtcCapability({ kind: 'fdm', atcSlotCount: undefined })
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('fdm')
  })

  it('FDM never returns supported:true regardless of probe slot value', () => {
    const cap = deriveAtcCapability({
      kind: 'fdm',
      atcSlotCount: 99,
      atcProbeSlot: 0
    })
    expect(cap.supported).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D) CNC branch defensive coverage
// ---------------------------------------------------------------------------

describe('[ID-0228] D) CNC branch defensive coverage', () => {
  it('CNC with atcSlotCount === 0 returns reason "no-atc-slots" (the <=0 guard fires)', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 0 })
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('no-atc-slots')
  })

  it('CNC with atcSlotCount === undefined returns reason "no-atc-slots"', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: undefined })
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('no-atc-slots')
  })

  it('CNC with atcSlotCount === 1 returns supported:true with slotCount=1', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 1 })
    expect(cap.supported).toBe(true)
    if (cap.supported) expect(cap.slotCount).toBe(1)
  })

  it('CNC with probeSlot === 0 (Carvera convention) is preserved verbatim', () => {
    const cap = deriveAtcCapability({
      kind: 'cnc',
      atcSlotCount: 6,
      atcProbeSlot: 0
    })
    expect(cap.supported).toBe(true)
    if (cap.supported) expect(cap.probeSlot).toBe(0)
  })

  it('CNC with probeSlot === undefined drops the probeSlot field (omitted, not undefined)', () => {
    const cap = deriveAtcCapability({
      kind: 'cnc',
      atcSlotCount: 6,
      atcProbeSlot: undefined
    })
    expect(cap.supported).toBe(true)
    if (cap.supported) {
      expect(cap.probeSlot).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(cap, 'probeSlot')).toBe(false)
    }
  })

  it('CNC with positive probeSlot (e.g. 1) is preserved verbatim', () => {
    const cap = deriveAtcCapability({
      kind: 'cnc',
      atcSlotCount: 8,
      atcProbeSlot: 1
    })
    expect(cap.supported).toBe(true)
    if (cap.supported) expect(cap.probeSlot).toBe(1)
  })

  it('CNC with large slotCount (e.g. 24) is preserved verbatim (no upper-bound clipping)', () => {
    const cap = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 24 })
    expect(cap.supported).toBe(true)
    if (cap.supported) expect(cap.slotCount).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// E) Purity / non-mutation invariants
// ---------------------------------------------------------------------------

describe('[ID-0228] E) purity and non-mutation invariants', () => {
  it('does NOT mutate the input machine object (FDM branch)', () => {
    const input = { kind: 'fdm' as const, atcSlotCount: 6, atcProbeSlot: 0 }
    const snapshot = JSON.stringify(input)
    deriveAtcCapability(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('does NOT mutate the input machine object (CNC supported branch)', () => {
    const input = { kind: 'cnc' as const, atcSlotCount: 6, atcProbeSlot: 0 }
    const snapshot = JSON.stringify(input)
    deriveAtcCapability(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('returns a fresh object each call (no shared instance reuse)', () => {
    const a = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 6 })
    const b = deriveAtcCapability({ kind: 'cnc', atcSlotCount: 6 })
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('is deeply equal across N=10 invocations with the same input (FDM)', () => {
    const baseline = deriveAtcCapability({ kind: 'fdm' })
    for (let i = 0; i < 10; i++) {
      expect(deriveAtcCapability({ kind: 'fdm' })).toEqual(baseline)
    }
  })

  it('is deeply equal across N=10 invocations with the same input (Carvera 3-axis)', () => {
    const baseline = deriveAtcCapability({
      kind: 'cnc',
      atcSlotCount: 6,
      atcProbeSlot: 0
    })
    for (let i = 0; i < 10; i++) {
      expect(
        deriveAtcCapability({ kind: 'cnc', atcSlotCount: 6, atcProbeSlot: 0 })
      ).toEqual(baseline)
    }
  })

  it('accepts a frozen input without throwing', () => {
    const frozen = Object.freeze({
      kind: 'cnc' as const,
      atcSlotCount: 6,
      atcProbeSlot: 0
    })
    expect(() => deriveAtcCapability(frozen)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// F) machineSupportsAtc convenience predicate
// ---------------------------------------------------------------------------

describe('[ID-0228] F) machineSupportsAtc convenience predicate', () => {
  it('agrees with deriveAtcCapability(...).supported for FDM', () => {
    expect(machineSupportsAtc({ kind: 'fdm' })).toBe(false)
  })

  it('agrees with deriveAtcCapability(...).supported for CNC no-slots', () => {
    expect(machineSupportsAtc({ kind: 'cnc' })).toBe(false)
  })

  it('agrees with deriveAtcCapability(...).supported for CNC with slots', () => {
    expect(machineSupportsAtc({ kind: 'cnc', atcSlotCount: 6 })).toBe(true)
  })

  it('returns boolean primitive (not truthy/falsy proxy)', () => {
    const r = machineSupportsAtc({ kind: 'cnc', atcSlotCount: 6 })
    expect(typeof r).toBe('boolean')
    expect(r).toBe(true)
  })

  it('returns false primitive for FDM (not undefined / null / 0)', () => {
    const r = machineSupportsAtc({ kind: 'fdm' })
    expect(typeof r).toBe('boolean')
    expect(r).toBe(false)
  })

  it('mirrors deriveAtcCapability across the bundled fleet', () => {
    for (const fname of [
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json',
      'laguna-swift-5x10.json',
      'creality-k2-plus.json'
    ] as const) {
      const m = loadProfile(fname)
      expect(machineSupportsAtc(m)).toBe(deriveAtcCapability(m).supported)
    }
  })
})

// ---------------------------------------------------------------------------
// G) Bundled-fleet pinning (extends existing test surface)
// ---------------------------------------------------------------------------

describe('[ID-0228] G) bundled-fleet pinning', () => {
  it('Carvera 3-axis result.slotCount matches the profile JSON atcSlotCount verbatim', () => {
    const m = loadProfile('makera-carvera-3axis.json')
    const cap = deriveAtcCapability(m)
    expect(cap.supported).toBe(true)
    if (cap.supported) expect(cap.slotCount).toBe(m.atcSlotCount)
  })

  it('Carvera 3-axis result.probeSlot matches the profile JSON atcProbeSlot verbatim', () => {
    const m = loadProfile('makera-carvera-3axis.json')
    const cap = deriveAtcCapability(m)
    expect(cap.supported).toBe(true)
    if (cap.supported) expect(cap.probeSlot).toBe(m.atcProbeSlot)
  })

  it('Carvera 4-axis profile has NO atcSlotCount field set (rotary occupies bay)', () => {
    const m = loadProfile('makera-carvera-4axis.json')
    expect(m.atcSlotCount).toBeUndefined()
  })

  it('Carvera 4-axis profile has NO atcProbeSlot field set', () => {
    const m = loadProfile('makera-carvera-4axis.json')
    expect(m.atcProbeSlot).toBeUndefined()
  })

  it('Laguna Swift profile has NO atcSlotCount field set (manual ER-20 collet)', () => {
    const m = loadProfile('laguna-swift-5x10.json')
    expect(m.atcSlotCount).toBeUndefined()
  })

  it('Creality K2 Plus profile is FDM (kind === "fdm")', () => {
    const m = loadProfile('creality-k2-plus.json')
    expect(m.kind).toBe('fdm')
  })

  it('all four bundled profiles agree with the helper across both branches', () => {
    const fixtures: ReadonlyArray<{ file: string; supported: boolean }> = [
      { file: 'makera-carvera-3axis.json', supported: true },
      { file: 'makera-carvera-4axis.json', supported: false },
      { file: 'laguna-swift-5x10.json', supported: false },
      { file: 'creality-k2-plus.json', supported: false }
    ]
    for (const { file, supported } of fixtures) {
      const cap = deriveAtcCapability(loadProfile(file))
      expect(cap.supported).toBe(supported)
    }
  })
})

// ---------------------------------------------------------------------------
// H) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0228] H) source-text whitelist', () => {
  it('JSDoc names roadmap [ID-0093] provenance', () => {
    expect(SRC).toMatch(/roadmap \[ID-0093\]/i)
  })

  it('JSDoc cites CLAUDE.md USER CONTEXT decision rules', () => {
    expect(SRC).toContain('CLAUDE.md USER CONTEXT')
  })

  it('JSDoc names Creality K2 Plus (FDM never supports ATC)', () => {
    expect(SRC).toContain('Creality K2 Plus')
  })

  it('JSDoc names Laguna Swift 5x10 (manual ER-20 collet)', () => {
    expect(SRC).toContain('Laguna Swift 5x10')
  })

  it('JSDoc names Makera Carvera 3-axis (T1-T6 + T0 probe -> supports ATC)', () => {
    expect(SRC).toContain('Makera Carvera 3-axis')
  })

  it('JSDoc names Makera Carvera 4-axis (rotary occupies bay -> no ATC)', () => {
    expect(SRC).toContain('Makera Carvera 4-axis')
  })

  it('JSDoc names the bundled `makera-carvera-4axis.json` profile', () => {
    expect(SRC).toContain('makera-carvera-4axis.json')
  })

  it('JSDoc names the helper as Pure (no I/O, no logging, no clock)', () => {
    expect(SRC).toMatch(/Pure: no I\/O, no logging, no clock/)
  })

  it('imports the MachineProfile type-only from machine-schema', () => {
    expect(SRC).toMatch(
      /^import type \{ MachineProfile \} from '\.\/machine-schema'$/m
    )
  })

  it('AtcCapability is exported as a TypeScript discriminated union via `export type`', () => {
    expect(SRC).toMatch(/^export type AtcCapability =$/m)
  })

  it('AtcCapability discriminated union names both reason literals: "fdm" and "no-atc-slots"', () => {
    expect(SRC).toContain("'fdm'")
    expect(SRC).toContain("'no-atc-slots'")
  })

  it('AtcCapability lists `readonly supported: false` and `readonly supported: true`', () => {
    expect(SRC).toMatch(/readonly supported:\s*false/)
    expect(SRC).toMatch(/readonly supported:\s*true/)
  })

  it('AtcCapability declares `readonly slotCount: number` on the supported branch', () => {
    expect(SRC).toMatch(/readonly slotCount:\s*number/)
  })

  it('AtcCapability declares `readonly probeSlot\\?: number` (optional) on the supported branch', () => {
    expect(SRC).toMatch(/readonly probeSlot\?:\s*number/)
  })

  it('exports `deriveAtcCapability` as a named function', () => {
    expect(SRC).toMatch(/^export function deriveAtcCapability\(/m)
  })

  it('exports `machineSupportsAtc` as a named function', () => {
    expect(SRC).toMatch(/^export function machineSupportsAtc\(/m)
  })

  it('parameter type uses Pick<MachineProfile, "kind" | "atcSlotCount" | "atcProbeSlot"> exactly', () => {
    expect(SRC).toMatch(
      /Pick<\s*MachineProfile,\s*'kind'\s*\|\s*'atcSlotCount'\s*\|\s*'atcProbeSlot'\s*>/
    )
  })

  it('FDM branch returns the literal { supported: false, reason: "fdm" }', () => {
    expect(SRC).toMatch(/return \{ supported: false, reason: 'fdm' \}/)
  })

  it('CNC-no-slots branch returns the literal { supported: false, reason: "no-atc-slots" }', () => {
    expect(SRC).toMatch(/return \{ supported: false, reason: 'no-atc-slots' \}/)
  })

  it('CNC-with-slots branch uses `slotCount <= 0` guard (catches 0 AND any future negative leak past zod)', () => {
    expect(SRC).toMatch(/slotCount\s*===\s*undefined\s*\|\|\s*slotCount\s*<=\s*0/)
  })

  it('CNC-with-probe branch checks `atcProbeSlot !== undefined`', () => {
    expect(SRC).toMatch(/machine\.atcProbeSlot\s*!==\s*undefined/)
  })

  it('module exports exactly 2 `export function` declarations', () => {
    const matches = SRC.match(/^export function /gm) ?? []
    expect(matches).toHaveLength(2)
  })

  it('module exports exactly 1 `export type` declaration', () => {
    const matches = SRC.match(/^export type /gm) ?? []
    expect(matches).toHaveLength(1)
  })

  it('module declares NO default export', () => {
    expect(SRC).not.toMatch(/^export default /m)
  })

  it('module declares NO top-level `let` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^let /m)
  })

  it('module declares NO top-level `var` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^var /m)
  })

  it('module has NO `: any` type annotation in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('module has NO `as any` cast in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bas\s+any\b/)
  })

  it('module has NO `<any>` generic argument in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/<any>/)
  })

  it('module imports NOTHING from electron / fs / path / child_process / dgram / net / tls (Safety Rule 4)', () => {
    expect(SRC).not.toMatch(/from\s+'electron'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?fs'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?path'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?child_process'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?dgram'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?net'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?tls'/)
  })

  it('module imports NOTHING React / DOM (lives under src/shared/)', () => {
    expect(SRC).not.toMatch(/from\s+'react'/)
    expect(SRC).not.toMatch(/from\s+'react-dom'/)
  })

  it('module emits NO Handlebars tokens (no {{...}} templates)', () => {
    expect(SRC).not.toMatch(/\{\{[^}]+\}\}/)
  })

  it('module emits NO G-code tokens in executable code (G0/G1/G17/G20/G21/G28/G54/G90/G91)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bG(?:0|1|17|18|19|20|21|28|54|90|91)\b/)
  })

  it('module emits NO M-code tokens in executable code (M3/M5/M6/M30/etc.)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bM(?:3|03|5|05|6|06|7|8|9|30)\b/)
  })

  it('module references NO foreign-machine vendor names (only the three target machines are named)', () => {
    expect(SRC).not.toMatch(
      /\b(?:Klipper|Moonraker|RichAuto|Bambu|Prusa|Voron|Ender-N|Onefinity|Shapeoko|Longmill)\b/
    )
  })

  it('module does NOT consult `axisCount` (per JSDoc -- profile JSON is single source of truth)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\baxisCount\b/)
  })

  it('module does NOT branch on machine `name` field', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/machine\.name/)
  })

  it('JSDoc explicitly notes the helper does NOT consult `axisCount`', () => {
    expect(SRC).toMatch(/does NOT consult `axisCount`/)
  })

  it('JSDoc states "Profile JSON is the single source of truth"', () => {
    expect(SRC).toContain('single source of truth')
  })

  it('source size stays under 200 lines (load-bearing terseness invariant)', () => {
    const lines = SRC.split('\n').length
    expect(lines).toBeLessThan(200)
  })

  it('source size stays under 8 KB (load-bearing terseness invariant)', () => {
    expect(Buffer.byteLength(SRC, 'utf8')).toBeLessThan(8 * 1024)
  })
})

// ---------------------------------------------------------------------------
// I) Cross-cutting safety
// ---------------------------------------------------------------------------

describe('[ID-0228] I) cross-cutting safety', () => {
  it('schema field names match helper input keys (kind / atcSlotCount / atcProbeSlot)', () => {
    // Spot-check the 3 keys exist on the parsed schema (they may be
    // optional but must be recognised by zod).
    const m = loadProfile('makera-carvera-3axis.json')
    expect(m.kind).toBeDefined()
    expect(m.atcSlotCount).toBeDefined()
    expect(m.atcProbeSlot).toBeDefined()
  })

  it('helper accepts the bundled MachineProfile shape directly (no adapter required)', () => {
    const m = loadProfile('makera-carvera-3axis.json')
    expect(() => deriveAtcCapability(m)).not.toThrow()
    expect(() => machineSupportsAtc(m)).not.toThrow()
  })

  it('helper returns the SAME branch when given a Pick subset vs the full MachineProfile', () => {
    const full = loadProfile('makera-carvera-3axis.json')
    const subset = {
      kind: full.kind,
      atcSlotCount: full.atcSlotCount,
      atcProbeSlot: full.atcProbeSlot
    }
    expect(deriveAtcCapability(full)).toEqual(deriveAtcCapability(subset))
  })

  it('Carvera 4-axis bundled profile NEVER returns supported:true (rotary occupies bay)', () => {
    const m = loadProfile('makera-carvera-4axis.json')
    expect(machineSupportsAtc(m)).toBe(false)
  })

  it('Creality K2 Plus bundled profile NEVER returns supported:true (FDM)', () => {
    const m = loadProfile('creality-k2-plus.json')
    expect(machineSupportsAtc(m)).toBe(false)
  })

  it('Laguna Swift bundled profile NEVER returns supported:true (manual ER-20)', () => {
    const m = loadProfile('laguna-swift-5x10.json')
    expect(machineSupportsAtc(m)).toBe(false)
  })
})
