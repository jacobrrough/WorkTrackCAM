/**
 * Paired-pin contract set for `src/main/cam-axis4/index.ts` -- the public
 * facade for the 4-Axis CAM engine. Pins the module's ABI surface
 * (re-exports, exported types, exported functions, exported constants) AND
 * the load-bearing source-text invariants of `runAxis4`'s dispatch +
 * validation flow. Companion to the existing `depth-passes-contract.test.ts`
 * (which pins the three depth-helper pure functions) and `integration.test.ts`
 * (which exercises `runAxis4` end-to-end through `cam-runner`); this
 * paired-pin locks the FACADE surface that neither of those files asserts
 * directly.
 *
 * Roadmap: [ID-0203] (test-coverage, Cycle 126). Pulled per Cycle 125
 * Section 38.10 hand-off recommendation -- `index.ts` was the LAST
 * cam-axis4 module without a `-contract` paired-pin (the rest of the
 * cam-axis4 family -- carvera-pipeline / depth-passes / emit / heightmap /
 * kinematics / rasterize / runner-shims / tool-comp / validation -- is
 * already paired-pinned). Cross-cuts:
 *   - PRIMARY = Makera Carvera + 4th Axis Rotary -- `runAxis4` is the
 *     entry point for every `cnc_4axis_*` operation kind. The dispatch
 *     covers all 5 kinds defined in `manufactureKindUses4AxisEngine` plus
 *     the pattern-fallback default branch.
 *   - PASS-THROUGH = K2 Plus / Laguna Swift 5x10 -- the
 *     `manufactureKindUses4AxisEngine` re-export must NOT light up for
 *     these machines' operation kinds; one negative-case test pins this.
 *
 * Pure source-text + ABI-shape contract: NO STL fixtures, NO machine
 * profiles, NO `renderPost` invocation, NO file I/O at module-level
 * (only `readFileSync` of the index.ts source for source-text pins),
 * NO mocking. Mirrors the Cycle 121 [ID-0198] (kernel-build-messages-
 * contract) and Cycle 122 [ID-0199] (post-process-rotary-bypass-property)
 * source-text-driven patterns. ZERO production-code edits this cycle.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  manufactureKindUses4AxisEngine,
  normalizeRadialZPassMm,
  iterDepthsMm,
  computeDepthsMm,
  runAxis4
} from '../index'
import { manufactureKindUses4AxisEngine as RUNNER_SHIMS_KIND_GUARD } from '../runner-shims'

const INDEX_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'main', 'cam-axis4', 'index.ts'),
  'utf-8'
)

// ── (A) module re-export identity contract ──────────────────────────────────
describe('[ID-0203] (A) module re-export identity contract', () => {
  it('re-exports `manufactureKindUses4AxisEngine` from runner-shims with strict identity (same function object, no wrapping)', () => {
    expect(manufactureKindUses4AxisEngine).toBe(RUNNER_SHIMS_KIND_GUARD)
  })

  it('exposes the value re-export as a plain `export { manufactureKindUses4AxisEngine }` form (NOT export *)', () => {
    expect(INDEX_SOURCE).toContain('export { manufactureKindUses4AxisEngine }')
    expect(INDEX_SOURCE).not.toMatch(/^export \*/m)
  })

  it('re-exports the `Placement` type from frame.ts (compile-time pin via source text)', () => {
    expect(INDEX_SOURCE).toMatch(/export type \{ Placement \} from '\.\/frame'/)
  })

  it('imports the routing helper from `./runner-shims` (NOT a duplicate definition in this file)', () => {
    expect(INDEX_SOURCE).toMatch(
      /import \{ extractPostProcessingOpts, manufactureKindUses4AxisEngine \} from '\.\/runner-shims'/
    )
    // And the file does NOT redeclare the helper as a function.
    expect(INDEX_SOURCE).not.toMatch(/^export function manufactureKindUses4AxisEngine/m)
  })
})

// ── (B) Axis4JobConfig source-text shape contract ────────────────────────────
describe('[ID-0203] (B) Axis4JobConfig source-text shape contract', () => {
  it('declares the type with the documented required fields', () => {
    // Required (non-optional) primitive fields on the job config -- pinned
    // here so a future contributor cannot silently turn one optional and
    // surprise the cam-runner caller.
    expect(INDEX_SOURCE).toMatch(/stlPath: string/)
    expect(INDEX_SOURCE).toMatch(/outputGcodePath: string/)
    expect(INDEX_SOURCE).toMatch(/machine: MachineProfile/)
    expect(INDEX_SOURCE).toMatch(/resourcesRoot: string/)
    expect(INDEX_SOURCE).toMatch(/zPassMm: number/)
    expect(INDEX_SOURCE).toMatch(/stepoverMm: number/)
    expect(INDEX_SOURCE).toMatch(/feedMmMin: number/)
    expect(INDEX_SOURCE).toMatch(/plungeMmMin: number/)
    expect(INDEX_SOURCE).toMatch(/safeZMm: number/)
    expect(INDEX_SOURCE).toMatch(/operationKind: string/)
  })

  it('declares the documented optional fields (each suffixed with `?:`)', () => {
    // Optional fields -- the ? sigil keeps the dispatch flexible. Pinned
    // here so a contributor cannot silently make one required.
    expect(INDEX_SOURCE).toMatch(/operationLabel\?: string/)
    expect(INDEX_SOURCE).toMatch(/operationParams\?: Record<string, unknown>/)
    expect(INDEX_SOURCE).toMatch(/workCoordinateIndex\?: number/)
    expect(INDEX_SOURCE).toMatch(/toolDiameterMm\?: number/)
    expect(INDEX_SOURCE).toMatch(/toolSlot\?: number/)
    expect(INDEX_SOURCE).toMatch(/rotaryStockLengthMm\?: number/)
    expect(INDEX_SOURCE).toMatch(/rotaryStockDiameterMm\?: number/)
    expect(INDEX_SOURCE).toMatch(/rotaryChuckDepthMm\?: number/)
    expect(INDEX_SOURCE).toMatch(/rotaryClampOffsetMm\?: number/)
    expect(INDEX_SOURCE).toMatch(/placement\?: Placement/)
    expect(INDEX_SOURCE).toMatch(/rotaryFixture\?: RotaryFixtureConfig/)
  })

  it('exports `Axis4JobConfig` as a `type` (not interface; not a const; not unexported)', () => {
    // Discriminated-shape vs. interface matters because cam-runner.ts uses
    // `Pick<Axis4JobConfig, ...>` patterns.
    expect(INDEX_SOURCE).toMatch(/export type Axis4JobConfig = \{/)
    expect(INDEX_SOURCE).not.toMatch(/^export interface Axis4JobConfig/m)
  })
})

// ── (C) Axis4Result discriminated-union source-text contract ─────────────────
describe('[ID-0203] (C) Axis4Result discriminated-union source-text contract', () => {
  it('exports `Axis4Result` as a discriminated union (two ok-tagged branches)', () => {
    expect(INDEX_SOURCE).toMatch(/export type Axis4Result =\s*\|\s*\{/)
    // Both branches present.
    expect(INDEX_SOURCE).toMatch(/ok: true/)
    expect(INDEX_SOURCE).toMatch(/ok: false/)
  })

  it('ok=true branch carries the gcode payload, engine metadata, and hint string', () => {
    // The exact tuple that cam-runner.ts unpacks; all four are required
    // on the success branch (not optional). Scope by anchoring on the
    // line immediately above the ok=false branch's `| {` sentinel.
    const okTrueBlock =
      INDEX_SOURCE.match(/ok: true[\s\S]*?warnings\?: string\[\]/)?.[0] ?? ''
    expect(okTrueBlock).toContain('gcode: string')
    expect(okTrueBlock).toMatch(/usedEngine: 'builtin'/)
    expect(okTrueBlock).toMatch(/engine: \{[^}]*requestedEngine: 'builtin'/)
    expect(okTrueBlock).toMatch(/fallbackApplied: false/)
    expect(okTrueBlock).toContain('hint: string')
    expect(okTrueBlock).toMatch(/warnings\?: string\[\]/)
  })

  it('ok=false branch carries the error string and an optional hint', () => {
    const okFalseBlock = INDEX_SOURCE.match(/\|\s*\{\s*ok: false[\s\S]*?\}/)?.[0] ?? ''
    expect(okFalseBlock).toContain('error: string')
    expect(okFalseBlock).toMatch(/hint\?: string/)
    // Failure branch must NOT carry gcode -- the cam-runner consumer
    // narrows on `ok: false` and assumes no payload to write.
    expect(okFalseBlock).not.toContain('gcode')
  })

  it('engine metadata literal types are pinned to the `builtin` discriminant (no string drift)', () => {
    // The runtime side composes this exact object at the bottom of runAxis4.
    expect(INDEX_SOURCE).toMatch(/usedEngine: 'builtin'/)
    expect(INDEX_SOURCE).toMatch(/engine: \{ requestedEngine: 'builtin'; usedEngine: 'builtin'; fallbackApplied: false \}/)
  })
})

// ── (D) UNVERIFIED warning constant ──────────────────────────────────────────
describe('[ID-0203] (D) UNVERIFIED warning constant contract', () => {
  it('declares `UNVERIFIED` as a module-private const string (no export, no let)', () => {
    expect(INDEX_SOURCE).toMatch(/^const UNVERIFIED =$/m)
    expect(INDEX_SOURCE).not.toMatch(/^export const UNVERIFIED/m)
    expect(INDEX_SOURCE).not.toMatch(/^let UNVERIFIED/m)
  })

  it('warning text mandates an air cut with spindle OFF before any real cut', () => {
    // This text is composed into every successful runAxis4 hint string.
    // CLAUDE.md "G-code is sacred" -- the warning is the user's last
    // safety reminder before they hit Run.
    expect(INDEX_SOURCE).toContain('air cut')
    expect(INDEX_SOURCE).toContain('spindle OFF')
    expect(INDEX_SOURCE).toContain('before any real cut')
  })

  it('UNVERIFIED is composed into the success-branch hint via template-literal interpolation', () => {
    // `${UNVERIFIED}` appears immediately after the operation-kind tag in
    // the hint composition at the bottom of `runAxis4`.
    expect(INDEX_SOURCE).toMatch(/\$\{opKind\}\) posted\. \$\{UNVERIFIED\}/)
  })
})

// ── (E) dispatch switch covers the 5 routed kinds + pattern fallback ────────
describe('[ID-0203] (E) runAxis4 dispatch invariants', () => {
  it('switch dispatches on `opKind` (NOT on operationKind directly -- the local alias is part of the contract)', () => {
    expect(INDEX_SOURCE).toMatch(/const opKind = job\.operationKind/)
    expect(INDEX_SOURCE).toMatch(/switch \(opKind\) \{/)
  })

  it('has an explicit case for each of the 5 cnc_4axis_* kinds', () => {
    expect(INDEX_SOURCE).toContain("case 'cnc_4axis_roughing':")
    expect(INDEX_SOURCE).toContain("case 'cnc_4axis_finishing':")
    expect(INDEX_SOURCE).toContain("case 'cnc_4axis_continuous':")
    expect(INDEX_SOURCE).toContain("case 'cnc_4axis_contour':")
    expect(INDEX_SOURCE).toContain("case 'cnc_4axis_indexed':")
  })

  it('default branch falls through to `generatePattern` (no mesh, no specific match)', () => {
    // The default branch is the SAFE no-op for unknown 4-axis-shaped
    // requests -- it produces a parallel pattern toolpath instead of
    // crashing or routing to a 3-axis path.
    const defaultBlock = INDEX_SOURCE.match(/default: \{[\s\S]*?break\n\s*\}\n\s*\}/)?.[0] ?? ''
    expect(defaultBlock).toContain('generatePattern')
    // And every other strategy-generator must appear OUTSIDE the default
    // block (i.e. each in its own case).
    expect(INDEX_SOURCE).toMatch(/generateRoughing\(/)
    expect(INDEX_SOURCE).toMatch(/generateFinishing\(/)
    expect(INDEX_SOURCE).toMatch(/generateContinuous\(/)
    expect(INDEX_SOURCE).toMatch(/generateContour\(/)
    expect(INDEX_SOURCE).toMatch(/generateIndexed\(/)
  })

  it('every case ends with `break` (no implicit fall-through)', () => {
    // A missing break would silently route TWO strategies on a single op
    // kind -- catastrophic for G-code correctness.
    const breakCount = (INDEX_SOURCE.match(/break\n\s*\}/g) ?? []).length
    // 5 explicit cases + 1 default = 6 break statements.
    expect(breakCount).toBeGreaterThanOrEqual(6)
  })

  it('mesh-required ops are EXACTLY roughing / finishing / continuous (the `needsMesh` flag)', () => {
    expect(INDEX_SOURCE).toMatch(/const needsMesh =[\s\S]*?'cnc_4axis_roughing'/)
    expect(INDEX_SOURCE).toMatch(/'cnc_4axis_finishing'/)
    expect(INDEX_SOURCE).toMatch(/'cnc_4axis_continuous'/)
    // `cnc_4axis_contour` and `cnc_4axis_indexed` MUST NOT appear inside
    // the `needsMesh` declaration -- they tolerate a missing mesh.
    // Cap the match at the trailing 'cnc_4axis_continuous' string literal
    // so the subsequent `if (needsMesh || ...)` line is excluded.
    const needsMeshBlock =
      INDEX_SOURCE.match(/const needsMesh =[\s\S]*?'cnc_4axis_continuous'/)?.[0] ?? ''
    expect(needsMeshBlock).not.toMatch(/cnc_4axis_contour/)
    expect(needsMeshBlock).not.toMatch(/cnc_4axis_indexed/)
  })

  it('empty toolpath produces an ok=false result with the documented error string', () => {
    expect(INDEX_SOURCE).toMatch(/if \(lines\.length === 0\)/)
    expect(INDEX_SOURCE).toContain("error: '4-axis toolpath is empty.'")
    expect(INDEX_SOURCE).toMatch(/Check zPassMm, stepover, and stock diameter/)
  })

  it('mesh-required op with a missing mesh produces a guarded error (not a silent empty result)', () => {
    expect(INDEX_SOURCE).toMatch(/if \(needsMesh && \(frame == null \|\| frame\.triangles\.length === 0\)\)/)
    expect(INDEX_SOURCE).toMatch(/4-axis \$\{opKind\} requires a readable STL mesh\./)
  })
})

// ── (F) validation-before-dispatch flow ──────────────────────────────────────
describe('[ID-0203] (F) validation-before-dispatch flow', () => {
  it('imports `validateAxis4Job` from the validation module (not inlined)', () => {
    expect(INDEX_SOURCE).toMatch(/import \{ validateAxis4Job \} from '\.\/validation'/)
  })

  it('runs validation BEFORE the strategy dispatch (source-order pin)', () => {
    const validateIdx = INDEX_SOURCE.indexOf('validateAxis4Job(')
    const switchIdx = INDEX_SOURCE.indexOf('switch (opKind) {')
    expect(validateIdx).toBeGreaterThan(0)
    expect(switchIdx).toBeGreaterThan(0)
    expect(validateIdx).toBeLessThan(switchIdx)
  })

  it('validation failure short-circuits with the validator-supplied error/hint (no further work)', () => {
    expect(INDEX_SOURCE).toMatch(/if \(validation\.ok === false\) \{\s*return \{ ok: false, error: validation\.error, hint: validation\.hint \}/)
  })

  it('aAxisOrientation defaults to "x" when the machine profile omits it OR sets a non-"y" value', () => {
    // The lowercase coercion + string-equal check pins the contract:
    // ONLY the literal 'y' selects the y-orientation; everything else
    // (including 'X', 'Y', undefined, nonsense) lands on 'x'.
    expect(INDEX_SOURCE).toMatch(
      /const aAxisOrientationRaw = String\(job\.machine\.aAxisOrientation \?\? 'x'\)\.toLowerCase\(\)/
    )
    expect(INDEX_SOURCE).toMatch(
      /const aAxisOrientation: 'x' \| 'y' = aAxisOrientationRaw === 'y' \? 'y' : 'x'/
    )
  })

  it('frame fallback for validation when the mesh is unavailable has bbox [0,0,0]..[stockLength,0,0]', () => {
    // This synthetic frame is what gets passed to validateAxis4Job for
    // contour/indexed jobs that legitimately have no mesh.
    expect(INDEX_SOURCE).toMatch(/triangles: \[\]/)
    expect(INDEX_SOURCE).toMatch(/bbox: \{ min: \[0, 0, 0\], max: \[stockLength, 0, 0\] \}/)
    expect(INDEX_SOURCE).toMatch(/meshRadialMax: 0/)
    expect(INDEX_SOURCE).toMatch(/meshRadialMin: 0/)
  })
})

// ── (G) STL load + truncation contract ───────────────────────────────────────
describe('[ID-0203] (G) STL load + truncation contract', () => {
  it('readStlTriangles tries binary FIRST, ASCII SECOND, with a binary FALLBACK for misnamed files', () => {
    // Order matters -- binary check is cheaper, ASCII is the fallback,
    // and finally we try binary again because some STLs are mislabeled.
    // Slice the function body by anchoring on the next top-level `function`
    // declaration (`envelopeHint`); the non-greedy {.*?} would otherwise
    // close on the inner `Promise<{...}>` return-type literal.
    const fnStart = INDEX_SOURCE.indexOf('async function readStlTriangles(')
    const fnEnd = INDEX_SOURCE.indexOf('function envelopeHint(', fnStart)
    expect(fnStart).toBeGreaterThan(0)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const fnBlock = INDEX_SOURCE.slice(fnStart, fnEnd)
    const binaryFirstIdx = fnBlock.indexOf('isBinaryStlLayout(buf)')
    const asciiIdx = fnBlock.indexOf('isLikelyAsciiStl(buf)')
    expect(binaryFirstIdx).toBeGreaterThan(0)
    expect(asciiIdx).toBeGreaterThan(0)
    expect(binaryFirstIdx).toBeLessThan(asciiIdx)
    // Binary fallback: a third call to collectBinaryStlTriangles outside
    // the if-branches.
    const binaryCalls = (fnBlock.match(/collectBinaryStlTriangles\(/g) ?? []).length
    expect(binaryCalls).toBeGreaterThanOrEqual(2)
  })

  it('truncation cap is 500_000 triangles across all three load paths', () => {
    // Two `collectBinaryStlTriangles(buf, 500_000)` calls (binary + binary
    // fallback) and one `collectAsciiStlTriangles(buf, 500_000)` call.
    const counts = (INDEX_SOURCE.match(/, 500_000\)/g) ?? []).length
    expect(counts).toBeGreaterThanOrEqual(3)
    expect(INDEX_SOURCE).toMatch(/collectBinaryStlTriangles\(buf, 500_000\)/)
    expect(INDEX_SOURCE).toMatch(/collectAsciiStlTriangles\(buf, 500_000\)/)
  })

  it('truncated meshes surface a hint to simplify the model', () => {
    expect(INDEX_SOURCE).toMatch(/Mesh was truncated to 500k triangles/)
    expect(INDEX_SOURCE).toMatch(/simplify the model for full coverage/)
  })

  it('readStlTriangles is a private async function (NOT exported -- caller is `runAxis4` only)', () => {
    expect(INDEX_SOURCE).toMatch(/^async function readStlTriangles\(/m)
    expect(INDEX_SOURCE).not.toMatch(/^export async function readStlTriangles/m)
  })
})

// ── (H) JSDoc + module purpose ──────────────────────────────────────────────
describe('[ID-0203] (H) JSDoc + module purpose', () => {
  it('top-of-file JSDoc names the module the "Public Facade" for the 4-axis engine', () => {
    expect(INDEX_SOURCE).toMatch(/4-Axis CAM Engine/)
    expect(INDEX_SOURCE).toMatch(/Public Facade/)
  })

  it('JSDoc enumerates the 5-step pipeline (read -> frame -> validate -> dispatch -> renderPost)', () => {
    expect(INDEX_SOURCE).toContain('Read STL')
    expect(INDEX_SOURCE).toContain('frame.ts')
    expect(INDEX_SOURCE).toContain('validation.ts')
    expect(INDEX_SOURCE).toContain('Dispatch to one of 6 strategies')
    expect(INDEX_SOURCE).toContain('renderPost')
  })

  it('JSDoc names the 6 strategies routed by the dispatch (roughing/finishing/contour/indexed/pattern/continuous)', () => {
    expect(INDEX_SOURCE).toContain('roughing/finishing/contour/indexed/')
    expect(INDEX_SOURCE).toContain('pattern/continuous')
  })

  it('JSDoc states the facade does NOT know about IPC, file paths beyond the input STL, or the renderer', () => {
    expect(INDEX_SOURCE).toMatch(/does not know anything about IPC, file paths beyond the input/)
  })

  it('depth helpers carry the [ID-0178] cross-link to the depth-passes-contract pin set', () => {
    // The three pure helpers are the [ID-0178] family -- their JSDoc
    // explicitly names the pin set so a reader can find the contract.
    expect(INDEX_SOURCE).toContain('[ID-0178]')
    expect(INDEX_SOURCE).toContain('depth-passes-contract.test.ts')
  })
})

// ── (I) imports + dependency invariants ──────────────────────────────────────
describe('[ID-0203] (I) imports + dependency invariants', () => {
  it('imports node:fs/promises for `readFile` + `writeFile` (NOT the sync variants)', () => {
    expect(INDEX_SOURCE).toMatch(/import \{ readFile, writeFile \} from 'node:fs\/promises'/)
    // Sync variants must NOT be imported -- the runtime path is async-only
    // because cam-runner awaits the result.
    expect(INDEX_SOURCE).not.toMatch(/from 'node:fs'$/m)
  })

  it('imports each of the 6 strategy generators from `./strategies/*`', () => {
    expect(INDEX_SOURCE).toMatch(/import \{ generateRoughing \} from '\.\/strategies\/roughing'/)
    expect(INDEX_SOURCE).toMatch(/import \{ generateFinishing \} from '\.\/strategies\/finishing'/)
    expect(INDEX_SOURCE).toMatch(/import \{ generateContour \} from '\.\/strategies\/contour'/)
    expect(INDEX_SOURCE).toMatch(/import \{ generateIndexed \} from '\.\/strategies\/indexed'/)
    expect(INDEX_SOURCE).toMatch(/import \{ generatePattern \} from '\.\/strategies\/pattern'/)
    expect(INDEX_SOURCE).toMatch(/import \{ generateContinuous \} from '\.\/strategies\/continuous'/)
  })

  it('imports the rotary fixture collision helpers from the shared module', () => {
    expect(INDEX_SOURCE).toMatch(/checkRotaryFixtureCollision/)
    expect(INDEX_SOURCE).toMatch(/formatRotaryCollisionWarnings/)
    expect(INDEX_SOURCE).toMatch(/from '\.\.\/\.\.\/shared\/rotary-collision'/)
  })

  it('imports `renderPost` from the post-process module (NOT a re-implementation)', () => {
    expect(INDEX_SOURCE).toMatch(/import \{ renderPost \} from '\.\.\/post-process'/)
  })

  it('imports the frame helpers and the `Triangle` / `Placement` types from `./frame`', () => {
    expect(INDEX_SOURCE).toMatch(/identityPlacement,\s*meshToMachineFrame,\s*type Placement,\s*type Triangle/)
    expect(INDEX_SOURCE).toMatch(/from '\.\/frame'/)
  })
})

// ── (J) runtime smoke: unrouted ops + depth-helper sanity ────────────────────
describe('[ID-0203] (J) runtime smoke: depth helpers + facade-routing reach the runtime', () => {
  it('the three depth-helper exports are callable functions (not undefined / not type-only)', () => {
    expect(typeof normalizeRadialZPassMm).toBe('function')
    expect(typeof iterDepthsMm).toBe('function')
    expect(typeof computeDepthsMm).toBe('function')
  })

  it('`runAxis4` is an async function (Promise-returning) at runtime', () => {
    expect(typeof runAxis4).toBe('function')
    // An async function's `constructor.name` is 'AsyncFunction'.
    expect(runAxis4.constructor.name).toBe('AsyncFunction')
  })

  it('`manufactureKindUses4AxisEngine` re-export rejects K2 Plus + Laguna kinds (PASS-THROUGH cross-cut)', () => {
    // The CLAUDE.md hard-constraint pass-through machines must never
    // light up the 4-axis engine via this routing helper.
    expect(manufactureKindUses4AxisEngine('fdm_print')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_3axis_roughing')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_3axis_finishing')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_3axis_drill')).toBe(false)
    // Strict case-sensitivity: an upper-case copy of a 4-axis kind is
    // still a typo and must not route.
    expect(manufactureKindUses4AxisEngine('CNC_4AXIS_ROUGHING')).toBe(false)
  })

  it('`normalizeRadialZPassMm` returns a strictly-negative or sentinel value across the documented inputs', () => {
    // One representative check per branch -- the deep pin set lives in
    // depth-passes-contract.test.ts. This is a smoke check that the
    // export wired through index.ts works.
    expect(normalizeRadialZPassMm(-3)).toBe(-3)
    expect(normalizeRadialZPassMm(2)).toBe(-2)
    expect(normalizeRadialZPassMm(0)).toBe(-0.5)
  })

  it('`iterDepthsMm` ends every multi-pass schedule on the target zPass exactly (final-element pin)', () => {
    const sched = iterDepthsMm(-5, 2)
    expect(sched[sched.length - 1]).toBe(-5)
    // And single-pass (degenerate-step) cases reduce to [zPass].
    expect(iterDepthsMm(-5, 0)).toEqual([-5])
  })

  it('`computeDepthsMm` falls through to iterDepthsMm when useMeshRadial=false (smoke)', () => {
    // Same final-element pin via the mesh-aware entry point.
    const sched = computeDepthsMm(-5, 2, 25, false, 10)
    expect(sched[sched.length - 1]).toBe(-5)
  })
})
