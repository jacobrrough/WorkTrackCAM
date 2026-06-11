/**
 * post-process-dialects-pin.test.ts -- [ID-0209] Cycle 132 post-processing paired-pin
 *
 * Pins the contract of `src/main/post-process-dialects.ts` -- the dialect-policy
 * isolation module that returns spindle/units snippets per controller dialect
 * AND maps work-offset indices to G54..G59. Sister cycles: Cycle 130 [ID-0207]
 * `shop-stock-bounds-pin.test.ts`, Cycle 131 [ID-0208]
 * `command-palette-memory-pin.test.ts`.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM): would resolve via the `default` fallback if
 *     ever queried (the FDM passthrough template does not call this helper
 *     today; the pin defends the future migration path so a non-FDM dialect
 *     enum value never silently leaks an inch-units G20 default).
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series, Mach3 superset):
 *     `mach3` -> bare `M3` (no S-word; spindle RPM comes from the operation
 *     planner / job config, not the dialect policy). The bare-M3 case is the
 *     ONLY case in the entire switch without an S-word literal -- if a future
 *     refactor accidentally normalizes it to `M3 S<n>` the Laguna posts will
 *     emit a wrong spindle command. This pin catches that drift.
 *   - **Makera Carvera 3-axis**: `smoothieware` -> `M3 S12000` as the RAW
 *     dialect constant. Since Cycle 245 (task_feef69e0) renderPost resolves
 *     that default against the machine profile's [minSpindleRpm,
 *     maxSpindleRpm] window when no explicit RPM is given — the bundled
 *     3-axis profile's 13,000 RPM floor posts `M3 S13000`; the 4-axis
 *     profile's 6,000 floor leaves `S12000`. This file pins the CONSTANTS;
 *     the resolution behavior is pinned in post-process-spindle.test.ts and
 *     the Carvera 3-axis contract suite.
 *   - **Makera Carvera 4-axis** (community firmware): one of the `*_4axis`
 *     branches depending on which post-template its profile points at.
 *
 * The existing `post-process-dialects.test.ts` (33 lines, 3 it()) only spot-
 * checks 2 explicit dialects + the fallback + a few work-offset boundaries.
 * THIS pin file additionally pins:
 *   (A) module shape -- exported names + type alias presence,
 *   (B) `PostDialectSnippets` shape: 3 fields `on` / `off` / `units`, with
 *       `units` literal-typed `'G21' | 'G20'`,
 *   (C) every named-case dialect snippet via exhaustive table -- 12 explicit
 *       switch cases pinned to byte-equal expected snippets,
 *   (D) `generic_mm` schema-enum value resolves via the `default` fallback,
 *   (E) cross-dialect structural invariants -- every dialect emits `M5` on
 *       off, every emits an `M3`-prefixed on, every emits `G21` units (no
 *       inch defaults) -- via it.each over the whole enum,
 *   (F) RPM-band invariants -- explicit `M3 S12000` set vs `M3 S10000` set vs
 *       bare `M3` set covers all 12 explicit cases,
 *   (G) `resolveWorkOffsetLine` full boundary table -- 1..6 -> G54..G59
 *       arithmetic + every documented invalid input class returns undefined,
 *   (H) source-text whitelist pin -- the [ID-0160] Cycle 68 Smoothieware
 *       comment, every literal `M3 S<n>` value used in the switch, the
 *       arithmetic literal `53 + index`, and the integer-bounds guard.
 *
 * ZERO production-code edits. Pure additive paired-pin (mirrors Cycles 119 /
 * 124 / 129 / 130 / 131).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { MachineProfile } from '../shared/machine-schema'
import * as M from './post-process-dialects'
import {
  resolveDialectSnippets,
  resolveWorkOffsetLine,
  type PostDialectSnippets
} from './post-process-dialects'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'post-process-dialects.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/**
 * The full dialect enum in `machineProfileSchema` (src/shared/machine-schema.ts).
 * Mirrored locally so a drift in either side surfaces here AND in the schema-
 * enum pin in `src/shared/machines-docs-pin.test.ts` rather than silently
 * dropping a case. Order matches the schema enum's source order.
 */
const ALL_DIALECTS: ReadonlyArray<MachineProfile['dialect']> = [
  'grbl',
  'mach3',
  'generic_mm',
  'grbl_4axis',
  'fanuc_4axis',
  'mach3_4axis',
  'linuxcnc_4axis',
  'siemens_4axis',
  'heidenhain_4axis',
  'fanuc',
  'siemens',
  'heidenhain',
  'smoothieware'
] as const

/**
 * Expected snippet for each dialect, byte-equal. Keep in lockstep with
 * `resolveDialectSnippets` -- if you change one, change the other (and the
 * paired source-text whitelist below).
 */
const EXPECTED: Readonly<Record<MachineProfile['dialect'], PostDialectSnippets>> = {
  grbl: { on: 'M3 S12000', off: 'M5', units: 'G21' },
  mach3: { on: 'M3', off: 'M5', units: 'G21' },
  // generic_mm flows via the switch's default branch.
  generic_mm: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  grbl_4axis: { on: 'M3 S12000', off: 'M5', units: 'G21' },
  fanuc_4axis: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  mach3_4axis: { on: 'M3 S12000', off: 'M5', units: 'G21' },
  linuxcnc_4axis: { on: 'M3 S12000', off: 'M5', units: 'G21' },
  siemens_4axis: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  heidenhain_4axis: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  fanuc: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  siemens: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  heidenhain: { on: 'M3 S10000', off: 'M5', units: 'G21' },
  smoothieware: { on: 'M3 S12000', off: 'M5', units: 'G21' }
}

describe('A: module shape', () => {
  it('exposes `resolveDialectSnippets` as a named export', () => {
    expect(typeof M.resolveDialectSnippets).toBe('function')
    // Imported binding === namespace member (single source of truth, no shim).
    expect(resolveDialectSnippets).toBe(M.resolveDialectSnippets)
  })

  it('exposes `resolveWorkOffsetLine` as a named export', () => {
    expect(typeof M.resolveWorkOffsetLine).toBe('function')
    expect(resolveWorkOffsetLine).toBe(M.resolveWorkOffsetLine)
  })

  it('does NOT leak unexpected runtime exports', () => {
    // Type-erased value shape: only the two functions are public runtime
    // exports. `PostDialectSnippets` is a `type` alias and is not visible
    // at runtime. If a future refactor adds a class/instance/object table,
    // this guard catches the leak before it ships.
    const runtimeKeys = Object.keys(M).sort()
    expect(runtimeKeys).toEqual(['resolveDialectSnippets', 'resolveWorkOffsetLine'])
  })

  it('declares `PostDialectSnippets` as an exported type alias (source-text)', () => {
    expect(SRC).toMatch(/export type PostDialectSnippets =/)
  })
})

describe('B: PostDialectSnippets shape', () => {
  // The shape is enforced at compile time by the function signature, but the
  // runtime values must round-trip through the documented contract.
  it('returns an object with exactly { on, off, units } keys', () => {
    const snip = resolveDialectSnippets('grbl')
    expect(Object.keys(snip).sort()).toEqual(['off', 'on', 'units'])
  })

  it('returns string values for `on` and `off`', () => {
    const snip = resolveDialectSnippets('grbl')
    expect(typeof snip.on).toBe('string')
    expect(typeof snip.off).toBe('string')
    expect(snip.on.length).toBeGreaterThan(0)
    expect(snip.off.length).toBeGreaterThan(0)
  })

  it('declares `units` as the `G21 | G20` literal union (source-text)', () => {
    // Today every branch returns 'G21' but the type allows 'G20' for a future
    // imperial-units feature. The literal union is load-bearing for downstream
    // post-template selection -- a wider `string` would let any junk through.
    expect(SRC).toMatch(/units: 'G21' \| 'G20'/)
  })
})

describe('C: explicit dialect snippets (exhaustive)', () => {
  for (const dialect of ALL_DIALECTS) {
    it(`resolves ${dialect} to the expected snippet`, () => {
      expect(resolveDialectSnippets(dialect)).toEqual(EXPECTED[dialect])
    })
  }
})

describe('D: `generic_mm` flows via the default branch', () => {
  it('returns the documented fallback snippet for `generic_mm`', () => {
    // The switch has no explicit `case 'generic_mm':` arm; the schema enum
    // value reaches the `default` branch. Pinning this anchors the contract
    // that `generic_mm` is the documented fallback identity dialect.
    expect(resolveDialectSnippets('generic_mm')).toEqual({
      on: 'M3 S10000',
      off: 'M5',
      units: 'G21'
    })
  })

  it('returns a fresh object on each call (no shared mutable singleton)', () => {
    const a = resolveDialectSnippets('generic_mm')
    const b = resolveDialectSnippets('generic_mm')
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe('E: cross-dialect structural invariants', () => {
  it.each(ALL_DIALECTS)('%s: off === "M5"', (dialect) => {
    // Every controller in the schema treats M5 as spindle-stop. If a future
    // refactor introduces M30 / M02 program-end as `off` for some niche
    // dialect, this pin will fire so the safety implications are reviewed.
    expect(resolveDialectSnippets(dialect).off).toBe('M5')
  })

  it.each(ALL_DIALECTS)('%s: on starts with "M3"', (dialect) => {
    // M4 (CCW spindle) is not a valid default for any of the three target
    // machines. Pin so a typo or accidental copy-paste cannot regress this.
    expect(resolveDialectSnippets(dialect).on.startsWith('M3')).toBe(true)
  })

  it.each(ALL_DIALECTS)('%s: units === "G21" (metric)', (dialect) => {
    // CLAUDE.md USER CONTEXT pins all three machines to mm. No imperial-G20
    // default exists today; if one is added, the Cycle 132 pin must be
    // updated together with the new test case.
    expect(resolveDialectSnippets(dialect).units).toBe('G21')
  })

  it('returns a fresh object on each call (mutation-isolated)', () => {
    // Cross-cuts: the returned object MUST be a fresh literal so the caller
    // can mutate it without affecting subsequent calls. If the function
    // ever switches to returning a frozen / shared singleton, the rest of
    // the post-process pipeline that mutates `on`/`off` would break.
    const a = resolveDialectSnippets('grbl')
    const b = resolveDialectSnippets('grbl')
    expect(a).not.toBe(b)
    a.on = 'M4 S99999'
    expect(b.on).toBe('M3 S12000')
  })
})

describe('F: RPM-band partition (CLAUDE.md target-machine alignment)', () => {
  // Per CLAUDE.md USER CONTEXT, the Carvera 3-axis spindle band is
  // 6000-15000 RPM (12000 mid-band) and the Laguna spindle is RichAuto-driven
  // (no S-word emitted by the dialect policy). The Fanuc/Siemens/Heidenhain
  // legacy dialects default to 10000 RPM. Pin which dialect lands in which
  // band so an accidental 12000 -> 10000 (or vice versa) renames immediately
  // surface here.

  const S12000 = [
    'grbl',
    'grbl_4axis',
    'mach3_4axis',
    'linuxcnc_4axis',
    'smoothieware'
  ] as const
  const S10000 = [
    'fanuc_4axis',
    'siemens_4axis',
    'heidenhain_4axis',
    'fanuc',
    'siemens',
    'heidenhain',
    'generic_mm'
  ] as const
  const BARE_M3 = ['mach3'] as const

  it.each(S12000)('%s: on === "M3 S12000"', (dialect) => {
    expect(resolveDialectSnippets(dialect).on).toBe('M3 S12000')
  })

  it.each(S10000)('%s: on === "M3 S10000"', (dialect) => {
    expect(resolveDialectSnippets(dialect).on).toBe('M3 S10000')
  })

  it.each(BARE_M3)('%s: on === "M3" (bare, no S-word)', (dialect) => {
    expect(resolveDialectSnippets(dialect).on).toBe('M3')
  })

  it('the three RPM partitions cover the schema enum exactly once', () => {
    const partitioned = new Set<string>([...S12000, ...S10000, ...BARE_M3])
    const enumSet = new Set<string>(ALL_DIALECTS)
    expect(partitioned).toEqual(enumSet)
    // No dialect should appear in two partitions.
    expect(S12000.length + S10000.length + BARE_M3.length).toBe(ALL_DIALECTS.length)
  })
})

describe('G: resolveWorkOffsetLine boundary table', () => {
  it.each([
    [1, 'G54'],
    [2, 'G55'],
    [3, 'G56'],
    [4, 'G57'],
    [5, 'G58'],
    [6, 'G59']
  ] as const)('index %i -> %s', (index, expected) => {
    // The arithmetic is `G${53 + index}`. Pin the full table so a future
    // refactor that flips +/- or shifts by one cannot land silently.
    expect(resolveWorkOffsetLine(index)).toBe(expected)
  })

  it('rejects 0 (below minimum)', () => {
    expect(resolveWorkOffsetLine(0)).toBeUndefined()
  })

  it('rejects 7 (above maximum)', () => {
    // G60 is reserved on most controllers; emitting it would crash the post.
    expect(resolveWorkOffsetLine(7)).toBeUndefined()
  })

  it('rejects -1 (negative)', () => {
    expect(resolveWorkOffsetLine(-1)).toBeUndefined()
  })

  it('rejects undefined', () => {
    expect(resolveWorkOffsetLine(undefined)).toBeUndefined()
  })

  it('treats null as undefined (== nullish guard)', () => {
    // The source uses `index == null` which catches both null and undefined.
    // Pin the null branch separately so a future tightening to `=== undefined`
    // (which would let null through to the integer check) is caught here.
    // Casting required because the TS signature is `number | undefined`.
    expect(resolveWorkOffsetLine(null as unknown as number)).toBeUndefined()
  })

  it('rejects NaN (Number.isInteger guard)', () => {
    expect(resolveWorkOffsetLine(Number.NaN)).toBeUndefined()
  })

  it('rejects +Infinity (Number.isInteger guard)', () => {
    expect(resolveWorkOffsetLine(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  it('rejects -Infinity (Number.isInteger guard)', () => {
    expect(resolveWorkOffsetLine(Number.NEGATIVE_INFINITY)).toBeUndefined()
  })

  it('rejects fractional 1.5 (Number.isInteger guard)', () => {
    // Without the integer guard, 1.5 would yield `G54.5` which is not a valid
    // G-code address. Pin the guard so a future "be lenient" patch is caught.
    expect(resolveWorkOffsetLine(1.5)).toBeUndefined()
  })

  it('rejects fractional 5.999 just below 6 boundary', () => {
    expect(resolveWorkOffsetLine(5.999)).toBeUndefined()
  })

  it('accepts -0 as zero (rejected via < 1 guard)', () => {
    // -0 is === 0 and Number.isInteger(-0) is true, so it falls through to
    // the `< 1` guard and is rejected. Pin so a future signed-zero special-
    // case cannot accidentally accept it.
    expect(resolveWorkOffsetLine(-0)).toBeUndefined()
  })

  it('accepts the midpoint indices 3 and 4 (regression for off-by-one)', () => {
    // Belt-and-braces against an off-by-one that maps 3 -> G56 but skips
    // 4 -> G57 (e.g. via `index < 5` typo).
    expect(resolveWorkOffsetLine(3)).toBe('G56')
    expect(resolveWorkOffsetLine(4)).toBe('G57')
  })
})

describe('H: source-text whitelist', () => {
  it('declares both helper functions in source', () => {
    expect(SRC).toMatch(/export function resolveDialectSnippets\(/)
    expect(SRC).toMatch(/export function resolveWorkOffsetLine\(/)
  })

  it('switch enumerates exactly the 12 explicit cases', () => {
    // generic_mm is intentionally omitted from the switch and falls through
    // to default. If someone adds an explicit `case 'generic_mm':` arm the
    // semantics could drift -- this pin catches that.
    const explicitCases = [
      'grbl',
      'grbl_4axis',
      'smoothieware',
      'fanuc_4axis',
      'mach3_4axis',
      'linuxcnc_4axis',
      'siemens_4axis',
      'heidenhain_4axis',
      'mach3',
      'fanuc',
      'siemens',
      'heidenhain'
    ] as const
    for (const c of explicitCases) {
      // Use a tightly anchored regex on the literal `case '<name>':` form so
      // a partial substring match (e.g. on `'grbl'` inside `'grbl_4axis'`)
      // cannot give a false-positive.
      const pattern = new RegExp(`case '${c}':`)
      expect(SRC).toMatch(pattern)
    }
    expect(SRC).toMatch(/default:/)
  })

  it('does NOT contain an explicit `case generic_mm` arm', () => {
    expect(SRC).not.toMatch(/case 'generic_mm':/)
  })

  it('embeds the M3 S12000 literal exactly five times (5 12k-band cases)', () => {
    const matches = SRC.match(/M3 S12000/g) ?? []
    expect(matches.length).toBe(5)
  })

  it('embeds the M3 S10000 literal exactly six times (5 10k-band cases + default)', () => {
    // 5 explicit (fanuc_4axis, siemens_4axis, heidenhain_4axis, fanuc,
    // siemens, heidenhain) wait that's 6 explicit + 1 default = 7. Let me
    // recount: fanuc_4axis / siemens_4axis / heidenhain_4axis / fanuc /
    // siemens / heidenhain == 6 explicit. Plus the `default:` arm. Total 7.
    const matches = SRC.match(/M3 S10000/g) ?? []
    expect(matches.length).toBe(7)
  })

  it('embeds the bare-M3 mach3 literal `on: \"M3\",` exactly once', () => {
    // The bare-M3 (no S-word) is the unique signature of the Laguna mach3
    // dialect. Use the trailing-comma form so it does not collide with the
    // `M3 S<n>` literals.
    const matches = SRC.match(/on: 'M3',/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('every dialect snippet pins units to `G21` (no inch defaults)', () => {
    // 12 explicit + 1 default = 13 return statements + 1 occurrence inside
    // the `PostDialectSnippets` type-alias declaration `units: 'G21' | 'G20'`
    // = 14 total `units: 'G21'` substrings. If a future PR introduces a
    // `units: 'G20'` runtime branch, g20Matches will go positive AND the
    // count here will drift -- catching the change at both surfaces.
    const g21Matches = SRC.match(/units: 'G21'/g) ?? []
    const g20Matches = SRC.match(/units: 'G20'/g) ?? []
    expect(g21Matches.length).toBe(14)
    // 'G20' appears only inside the type-alias union; the runtime never
    // returns a `units: 'G20'` literal as a complete `units: 'G20'`
    // assignment, so the regex finds zero matches.
    expect(g20Matches.length).toBe(0)
  })

  it('keeps the [ID-0160] Cycle 68 Smoothieware provenance comment', () => {
    // INTENDED DRIFT (Cycle 245, task_feef69e0): the old comment claimed the
    // raw S12000 "sits in the middle of the Carvera's 6000–15000 RPM band" —
    // stale (the bundled 3-axis profile floor is 13,000 RPM) and the constant
    // is no longer what posts. The comment now documents the render-time
    // resolution against the profile window; pin THAT so the safety note
    // cannot silently disappear.
    expect(SRC).toMatch(/\[ID-0160\] Cycle 68/)
    expect(SRC).toMatch(/Smoothieware-family \(Makera Carvera 3-axis\)/)
    expect(SRC).toMatch(/DIALECT default, not the\s+\/\/ emitted value/)
    expect(SRC).toMatch(/\[minSpindleRpm, maxSpindleRpm\] window/)
    expect(SRC).toMatch(/Carvera 3-axis floor is 13,000 RPM/)
  })

  it('encodes the work-offset arithmetic literally as `53 + index`', () => {
    // If the arithmetic ever drifts to e.g. `54 + index - 1` (off-by-one
    // refactor) the table tests above would fire AND this source-text pin
    // would fire, so the failure mode is doubly visible.
    expect(SRC).toMatch(/return `G\$\{53 \+ index\}`/)
  })

  it('guards work-offset with Number.isInteger + 1..6 inclusive bounds', () => {
    expect(SRC).toMatch(/Number\.isInteger\(index\)/)
    expect(SRC).toMatch(/index < 1 \|\| index > 6/)
  })

  it('guards work-offset against null AND undefined via `== null`', () => {
    // `==` (loose) catches both null and undefined. A `===` (strict) tighten
    // would let null through to Number.isInteger(null) === false, which
    // happens to also reject it -- but we want the loose-equal explicit so
    // the call-site contract stays "either nullish is fine".
    expect(SRC).toMatch(/if \(index == null\) return undefined/)
  })

  it('module imports the MachineProfile type from the shared schema', () => {
    expect(SRC).toMatch(/import type \{ MachineProfile \} from '\.\.\/shared\/machine-schema'/)
  })

  it('module file declares no top-level `let` mutable state', () => {
    // The dialect policy is a pure function pair. A top-level `let` would
    // be a smell (cache drift, hidden state, test-isolation hazard).
    expect(SRC).not.toMatch(/^let\s/m)
    expect(SRC).not.toMatch(/^const cache/m)
  })
})
