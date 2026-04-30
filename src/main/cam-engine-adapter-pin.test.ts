/**
 * cam-engine-adapter-pin.test.ts -- [ID-0222] Cycle 147 cam-engine paired-pin
 *
 * Companion to the behavior-test file `cam-engine-adapter.test.ts` (38
 * lines, 2 it()) that covers the success-mapping happy path and the
 * failure-mapping happy path. THIS pin file additionally pins the contract
 * of `src/main/cam-engine-adapter.ts` -- the canonical adapter for mapping
 * CamRunResult shapes (TS fallback `builtin` + Python-backed `advanced` /
 * `ocl`) into the shared CamEngineResult contract consumed across the
 * IPC boundary by `runCamDomain` ([ID-0216] Cycle 142) and by the
 * renderer-side engine status panel.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): the FDM CAM-aligned
 *     STL pipeline is normalized through this adapter before its result
 *     is forwarded to renderPost. Any change to the engineId enum
 *     ('advanced' | 'ocl' | 'builtin') flips the IPC contract for the
 *     K2's slice-then-post flow.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): full-sheet
 *     subtractive jobs run through the `ocl` (OpenCamLib) and `advanced`
 *     (Python-backed) engines; the adapter is the choke point that
 *     promotes their CamRunResult into the canonical engine-result shape
 *     before downstream IPC consumers see it. Every warning string from
 *     the OCL backend funnels through the `'runtime_warning'` code label
 *     pinned here.
 *   - **Makera Carvera 3-axis & 4-axis**: the Python `advanced` engine
 *     produces both the 3-axis and 4-axis toolpaths; the adapter's
 *     unconditional `'builtin'` engineId on the failure branch (vs the
 *     dynamic `result.engine.usedEngine` on the success branch) is the
 *     load-bearing fallback contract that lets the cam-domain.ts wrapper
 *     surface a recoverable error to the UI without losing engine
 *     attribution on the success path. Pinning the asymmetric
 *     'builtin'-on-failure shape blocks accidental rebrands.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain):
 *   - 119 [ID-0196] derive-features
 *   - 124 [ID-0201] viewport3d-bounds
 *   - 129 [ID-0206] design-viewport-interaction
 *   - 130 [ID-0207] shop-stock-bounds
 *   - 131 [ID-0208] command-palette-memory
 *   - 132 [ID-0209] post-process-dialects
 *   - 134 [ID-0210] brand-bar-machine-badge
 *   - 135 [ID-0211] moonraker-push-payload
 *   - 136 [ID-0212] fdm-gcode-layer-summary
 *   - 137 [ID-0213] post-domain
 *   - 139 [ID-0214] laguna-vacuum-allocator-ui
 *   - 140 [ID-0215] setup-sheet
 *   - 142 [ID-0216] cam-domain
 *   - 143 [ID-0067-data-v19] docs-and-dx ledger
 *   - 144 [ID-0217] stock-fit-engine
 *   - 145 [ID-0218] laguna-vacuum-allocator
 *   - 146 [ID-0220] my-shop-presets
 *   - 147 [ID-0222] cam-engine-adapter (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact named exports + `normalizeCamRunToEngineResult`
 *       arity + no symbol/proto leak + null-prototype + Symbol-key invariants.
 *   (B) Success-mapping contract -- ok:true input maps to canonical success
 *       shape with engineId from result.engine.usedEngine (not result
 *       top-level usedEngine); postedGcode mirrors result.gcode; warnings
 *       array maps each input warning string to {code:'runtime_warning',
 *       message}.
 *   (C) Failure-mapping contract -- ok:false input maps to canonical
 *       failure shape with engineId UNCONDITIONALLY 'builtin'; failure
 *       object {code:'cam_run_failed', message:result.error,
 *       detail:result.hint}.
 *   (D) Warnings handling -- undefined warnings → empty array; empty
 *       warnings → empty array; non-empty warnings → 1:1 mapping with
 *       'runtime_warning' code; warning order is preserved.
 *   (E) Engine-id pass-through -- all three engineId enum values
 *       (advanced/ocl/builtin) flow through on the success branch via
 *       result.engine.usedEngine.
 *   (F) Schema validation -- the result is run through
 *       camEngineResultSchema.parse on BOTH branches, so malformed
 *       input throws (e.g. empty postedGcode triggers the min(1) zod
 *       constraint; engineId 'unknown' triggers the enum constraint).
 *   (G) Object-construction discipline -- the adapter returns a NEW
 *       object on each call (no input-result aliasing, no defensive
 *       clone of the input).
 *   (H) Source-text whitelist -- 'runtime_warning' / 'cam_run_failed'
 *       literals, the lone 'builtin' literal in the failure branch, the
 *       camEngineResultSchema.parse call sites (exactly two), the
 *       documented JSDoc header, the import surface, no DOM/electron/fs
 *       imports, no top-level TypeScript `any`, no top-level `let`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles
 * 119/124/129/130/131/132/134/135/136/137/139/140/142/144/145/146).
 * Per `docs/EDIT-WORKFLOW.md` R1 the Python-via-bash mandate covers
 * EXISTING files >800 lines and `.claude/` log files only; this is a
 * NEW file < 800 lines so the Write tool is safe (per Cycle 141 v18
 * ledger mid-cycle re-check protocol).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { CamRunResult } from './cam-runner'
import * as M from './cam-engine-adapter'
import { normalizeCamRunToEngineResult } from './cam-engine-adapter'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'cam-engine-adapter.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Test-fixture builders
// ---------------------------------------------------------------------------

function buildOkResult(
  overrides: Partial<Extract<CamRunResult, { ok: true }>> = {}
): Extract<CamRunResult, { ok: true }> {
  return {
    ok: true,
    gcode: 'G21\nG90\nM30',
    usedEngine: 'builtin',
    engine: {
      requestedEngine: 'builtin',
      usedEngine: 'builtin',
      fallbackApplied: false
    },
    ...overrides
  }
}

function buildFailResult(
  overrides: Partial<Extract<CamRunResult, { ok: false }>> = {}
): Extract<CamRunResult, { ok: false }> {
  return {
    ok: false,
    error: 'pipeline failure under test',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0222] cam-engine-adapter module shape', () => {
  it('exports normalizeCamRunToEngineResult as a function', () => {
    expect(typeof normalizeCamRunToEngineResult).toBe('function')
  })

  it('normalizeCamRunToEngineResult arity is exactly 1', () => {
    // The adapter takes ONE positional CamRunResult argument. If a
    // refactor accidentally fans out to (gcode, engine, warnings) every
    // call site breaks; this pin catches that drift.
    expect(normalizeCamRunToEngineResult.length).toBe(1)
  })

  it('runtime-keys whitelist: only the normalizeCamRunToEngineResult value export', () => {
    // CamEngineResult is a type-only re-export (erased at runtime).
    const keys = Object.keys(M).sort()
    expect(keys).toEqual(['normalizeCamRunToEngineResult'])
  })

  it('module-namespace has only string-keyed value exports (Symbol.toStringTag only)', () => {
    const stringKeys = Reflect.ownKeys(M)
      .filter((k): k is string => typeof k === 'string')
      .sort()
    const symbolKeys = Reflect.ownKeys(M).filter(
      (k): k is symbol => typeof k === 'symbol'
    )
    expect(stringKeys).toEqual(['normalizeCamRunToEngineResult'])
    for (const s of symbolKeys) {
      expect(s).toBe(Symbol.toStringTag)
    }
  })

  it('module-namespace prototype is null (per ESM spec)', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

})

// ---------------------------------------------------------------------------
// (B) Success-mapping contract
// ---------------------------------------------------------------------------

describe('[ID-0222] success-mapping contract: ok:true → canonical engine success shape', () => {
  it('maps ok:true input to ok:true output', () => {
    const out = normalizeCamRunToEngineResult(buildOkResult())
    expect(out.ok).toBe(true)
  })

  it('engineId on success is sourced from result.engine.usedEngine', () => {
    // The adapter reads result.engine.usedEngine, NOT result.usedEngine.
    // This pin catches any refactor that swaps the source field.
    const out = normalizeCamRunToEngineResult(
      buildOkResult({
        usedEngine: 'builtin',
        engine: {
          requestedEngine: 'advanced',
          usedEngine: 'advanced',
          fallbackApplied: false
        }
      })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.engineId).toBe('advanced')
  })

  it('postedGcode mirrors result.gcode verbatim', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ gcode: 'G21\nG90\nG0 X10 Y10\nM30' })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.postedGcode).toBe('G21\nG90\nG0 X10 Y10\nM30')
  })

  it('warnings is an array on every success result', () => {
    const out = normalizeCamRunToEngineResult(buildOkResult())
    if (!out.ok) throw new Error('expected ok')
    expect(Array.isArray(out.warnings)).toBe(true)
  })

  it('output is plain object with exactly four success-keys ok/engineId/postedGcode/warnings', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: ['hello'] })
    )
    if (!out.ok) throw new Error('expected ok')
    const keys = Object.keys(out).sort()
    expect(keys).toEqual(['engineId', 'ok', 'postedGcode', 'warnings'])
  })

  it('output is NOT the same reference as the input', () => {
    const input = buildOkResult()
    const out = normalizeCamRunToEngineResult(input)
    expect(out).not.toBe(input as unknown as object)
  })

  it('does NOT inject a top-level "engine" key on the success output', () => {
    // The output uses engineId, not the nested engine outcome object.
    const out = normalizeCamRunToEngineResult(buildOkResult())
    expect('engine' in out).toBe(false)
  })

  it('does NOT inject a top-level "usedEngine" key on the success output', () => {
    const out = normalizeCamRunToEngineResult(buildOkResult())
    expect('usedEngine' in out).toBe(false)
  })

  it('does NOT inject a top-level "gcode" key on the success output', () => {
    // The output uses postedGcode, not gcode (the rebrand pin).
    const out = normalizeCamRunToEngineResult(buildOkResult())
    expect('gcode' in out).toBe(false)
  })

  it('does NOT inject a top-level "hint" key on the success output', () => {
    const out = normalizeCamRunToEngineResult(buildOkResult({ hint: 'fast' }))
    expect('hint' in out).toBe(false)
  })

  it('does NOT inject a top-level "failure" key on the success output', () => {
    // Discriminated-union safety: success must never carry a failure key.
    const out = normalizeCamRunToEngineResult(buildOkResult())
    expect('failure' in out).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (C) Failure-mapping contract
// ---------------------------------------------------------------------------

describe('[ID-0222] failure-mapping contract: ok:false → canonical engine failure shape', () => {
  it('maps ok:false input to ok:false output', () => {
    const out = normalizeCamRunToEngineResult(buildFailResult())
    expect(out.ok).toBe(false)
  })

  it('engineId on failure is UNCONDITIONALLY "builtin"', () => {
    // The failure path has no engine outcome to attribute (the pipeline
    // failed before producing one). The adapter falls back to 'builtin'
    // as the canonical attribution. This pin catches any refactor that
    // tries to thread a different default through the failure branch.
    const out = normalizeCamRunToEngineResult(buildFailResult())
    if (out.ok) throw new Error('expected failure')
    expect(out.engineId).toBe('builtin')
  })

  it('failure.code is "cam_run_failed"', () => {
    const out = normalizeCamRunToEngineResult(buildFailResult())
    if (out.ok) throw new Error('expected failure')
    expect(out.failure.code).toBe('cam_run_failed')
  })

  it('failure.message mirrors result.error verbatim', () => {
    const out = normalizeCamRunToEngineResult(
      buildFailResult({ error: 'invalid_numeric_params' })
    )
    if (out.ok) throw new Error('expected failure')
    expect(out.failure.message).toBe('invalid_numeric_params')
  })

  it('failure.detail mirrors result.hint when present', () => {
    const out = normalizeCamRunToEngineResult(
      buildFailResult({ error: 'stl_missing', hint: 'binary STL required' })
    )
    if (out.ok) throw new Error('expected failure')
    expect(out.failure.detail).toBe('binary STL required')
  })

  it('failure.detail is undefined when result.hint is omitted', () => {
    const out = normalizeCamRunToEngineResult(buildFailResult({ error: 'X' }))
    if (out.ok) throw new Error('expected failure')
    expect(out.failure.detail).toBeUndefined()
  })

  it('output is plain object with exactly three failure-keys ok/engineId/failure', () => {
    const out = normalizeCamRunToEngineResult(
      buildFailResult({ error: 'X', hint: 'Y' })
    )
    if (out.ok) throw new Error('expected failure')
    const keys = Object.keys(out).sort()
    expect(keys).toEqual(['engineId', 'failure', 'ok'])
  })

  it('failure object has exactly the documented {code, message, detail} key set', () => {
    const out = normalizeCamRunToEngineResult(
      buildFailResult({ error: 'X', hint: 'Y' })
    )
    if (out.ok) throw new Error('expected failure')
    const keys = Object.keys(out.failure).sort()
    expect(keys).toEqual(['code', 'detail', 'message'])
  })

  it('output is NOT the same reference as the input', () => {
    const input = buildFailResult()
    const out = normalizeCamRunToEngineResult(input)
    expect(out).not.toBe(input as unknown as object)
  })

  it('does NOT inject a top-level "warnings" key on the failure output', () => {
    // Discriminated-union safety: failure must never carry warnings.
    const out = normalizeCamRunToEngineResult(buildFailResult())
    expect('warnings' in out).toBe(false)
  })

  it('does NOT inject a top-level "postedGcode" key on the failure output', () => {
    const out = normalizeCamRunToEngineResult(buildFailResult())
    expect('postedGcode' in out).toBe(false)
  })

  it('does NOT inject a top-level "error" key on the failure output (rebrand to failure.message)', () => {
    // The CamRunResult uses `error`; the engine-result contract uses
    // failure.message. The adapter must REBRAND, not duplicate.
    const out = normalizeCamRunToEngineResult(
      buildFailResult({ error: 'rebrand-me' })
    )
    expect('error' in out).toBe(false)
  })

  it('does NOT inject a top-level "hint" key on the failure output (rebrand to failure.detail)', () => {
    const out = normalizeCamRunToEngineResult(
      buildFailResult({ error: 'X', hint: 'rebrand-me' })
    )
    expect('hint' in out).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (D) Warnings handling
// ---------------------------------------------------------------------------

describe('[ID-0222] warnings handling on the success branch', () => {
  it('undefined warnings on input → empty array on output', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: undefined })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).toEqual([])
  })

  it('omitted warnings (no key on input) → empty array on output', () => {
    // buildOkResult does not include warnings unless overridden; the
    // result is the same as undefined for the nullish-coalesce branch.
    const result = buildOkResult()
    delete (result as { warnings?: string[] }).warnings
    const out = normalizeCamRunToEngineResult(result)
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).toEqual([])
  })

  it('empty warnings array → empty array on output', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: [] })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).toEqual([])
  })

  it('single-warning input → single mapped output with code "runtime_warning"', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: ['near-feed-cap'] })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).toEqual([
      { code: 'runtime_warning', message: 'near-feed-cap' }
    ])
  })

  it('multi-warning input → 1:1 mapped output preserving order', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({
        warnings: ['first', 'second', 'third', 'fourth']
      })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).toEqual([
      { code: 'runtime_warning', message: 'first' },
      { code: 'runtime_warning', message: 'second' },
      { code: 'runtime_warning', message: 'third' },
      { code: 'runtime_warning', message: 'fourth' }
    ])
  })

  it('every mapped warning has the canonical code "runtime_warning"', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: ['a', 'b', 'c'] })
    )
    if (!out.ok) throw new Error('expected ok')
    for (const warning of out.warnings) {
      expect(warning.code).toBe('runtime_warning')
    }
  })

  it('mapped warning has exactly the documented {code, message} key set', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: ['only-one'] })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).toHaveLength(1)
    const keys = Object.keys(out.warnings[0]!).sort()
    expect(keys).toEqual(['code', 'message'])
  })

  it('warnings array is NEW (not a reference share with the input warnings)', () => {
    const inputWarnings = ['a', 'b']
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: inputWarnings })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.warnings).not.toBe(inputWarnings as unknown as object)
  })

  it('mutating the output warnings does not mutate the input warnings', () => {
    const inputWarnings = ['a']
    const out = normalizeCamRunToEngineResult(
      buildOkResult({ warnings: inputWarnings })
    )
    if (!out.ok) throw new Error('expected ok')
    out.warnings.push({ code: 'runtime_warning', message: 'new' })
    expect(inputWarnings).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// (E) Engine-id pass-through (all three enum values)
// ---------------------------------------------------------------------------

describe('[ID-0222] engineId enum pass-through on the success branch', () => {
  for (const id of ['advanced', 'ocl', 'builtin'] as const) {
    it(`maps engine.usedEngine === "${id}" through to output.engineId`, () => {
      const out = normalizeCamRunToEngineResult(
        buildOkResult({
          usedEngine: id,
          engine: {
            requestedEngine: id,
            usedEngine: id,
            fallbackApplied: false
          }
        })
      )
      if (!out.ok) throw new Error('expected ok')
      expect(out.engineId).toBe(id)
    })
  }

  it('preserves engine attribution when fallbackApplied=true (advanced→builtin fallback)', () => {
    // Real-world fallback scenario: requested 'advanced', used 'builtin'
    // because the python engine spawn failed. The adapter MUST report
    // 'builtin' as the engineId (what actually ran).
    const out = normalizeCamRunToEngineResult(
      buildOkResult({
        usedEngine: 'builtin',
        engine: {
          requestedEngine: 'advanced',
          usedEngine: 'builtin',
          fallbackApplied: true,
          fallbackReason: 'advanced_engine_failed',
          fallbackDetail: 'python crashed'
        }
      })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.engineId).toBe('builtin')
  })

  it('does NOT inject the requestedEngine into the output (only the actual usedEngine)', () => {
    const out = normalizeCamRunToEngineResult(
      buildOkResult({
        engine: {
          requestedEngine: 'ocl',
          usedEngine: 'builtin',
          fallbackApplied: true,
          fallbackReason: 'ocl_runtime_or_empty'
        }
      })
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.engineId).toBe('builtin')
    expect(out.engineId).not.toBe('ocl')
  })
})

// ---------------------------------------------------------------------------
// (F) Schema validation (camEngineResultSchema.parse on both branches)
// ---------------------------------------------------------------------------

describe('[ID-0222] schema validation runs on both branches', () => {
  it('throws when ok:true input has empty postedGcode (zod min(1))', () => {
    // The CamRunResult type allows any string for gcode, but the
    // engine contract enforces min(1). The adapter routes through
    // .parse() so the violation surfaces synchronously.
    expect(() =>
      normalizeCamRunToEngineResult(buildOkResult({ gcode: '' }))
    ).toThrow()
  })

  it('throws when ok:true input has an invalid engine.usedEngine value', () => {
    expect(() =>
      normalizeCamRunToEngineResult(
        buildOkResult({
          engine: {
            requestedEngine: 'builtin',
            // Intentional enum-violation: not one of advanced/ocl/builtin.
            usedEngine: 'mystery-engine' as never,
            fallbackApplied: false
          }
        })
      )
    ).toThrow()
  })

  it('throws when ok:false input has an empty error string (zod min(1) on failure.message)', () => {
    expect(() =>
      normalizeCamRunToEngineResult(buildFailResult({ error: '' }))
    ).toThrow()
  })

  it('does NOT throw when ok:false input has only the required error (no hint)', () => {
    // hint is optional on the engine contract; the adapter passes
    // detail: undefined when hint is absent.
    expect(() =>
      normalizeCamRunToEngineResult(buildFailResult({ error: 'X' }))
    ).not.toThrow()
  })

  it('does NOT throw on a minimal valid ok:true result', () => {
    expect(() => normalizeCamRunToEngineResult(buildOkResult())).not.toThrow()
  })

  it('does NOT throw on a minimal valid ok:false result', () => {
    expect(() => normalizeCamRunToEngineResult(buildFailResult())).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// (G) Object-construction discipline / determinism
// ---------------------------------------------------------------------------

describe('[ID-0222] object-construction discipline and determinism', () => {
  it('returns a NEW object on each call (no caching)', () => {
    const input = buildOkResult()
    const a = normalizeCamRunToEngineResult(input)
    const b = normalizeCamRunToEngineResult(input)
    expect(a).not.toBe(b)
  })

  it('output is structurally stable across N=10 successive calls (determinism)', () => {
    const input = buildOkResult({ warnings: ['x', 'y'] })
    const first = normalizeCamRunToEngineResult(input)
    for (let i = 0; i < 10; i++) {
      expect(normalizeCamRunToEngineResult(input)).toEqual(first)
    }
  })

  it('output for the failure branch is structurally stable across N=10 calls', () => {
    const input = buildFailResult({ error: 'E', hint: 'H' })
    const first = normalizeCamRunToEngineResult(input)
    for (let i = 0; i < 10; i++) {
      expect(normalizeCamRunToEngineResult(input)).toEqual(first)
    }
  })

  it('does NOT mutate the input ok:true result', () => {
    const input = buildOkResult({ warnings: ['a'] })
    const inputBefore = JSON.parse(JSON.stringify(input))
    normalizeCamRunToEngineResult(input)
    expect(input).toEqual(inputBefore)
  })

  it('does NOT mutate the input ok:false result', () => {
    const input = buildFailResult({ error: 'E', hint: 'H' })
    const inputBefore = JSON.parse(JSON.stringify(input))
    normalizeCamRunToEngineResult(input)
    expect(input).toEqual(inputBefore)
  })
})

// ---------------------------------------------------------------------------
// (H) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0222] cam-engine-adapter.ts source-text whitelist', () => {
  it('contains the canonical "runtime_warning" warning code literal', () => {
    expect(SRC).toContain("'runtime_warning'")
  })

  it('contains the canonical "cam_run_failed" failure code literal', () => {
    expect(SRC).toContain("'cam_run_failed'")
  })

  it('contains the lone "builtin" string literal in the failure-engineId branch', () => {
    expect(SRC).toContain("engineId: 'builtin'")
  })

  it('does NOT contain alternative or near-miss warning code spellings', () => {
    // Negative whitelist: drift would silently rebrand the warning
    // surface consumed by the renderer toast/log.
    expect(SRC).not.toContain("'runtime-warning'")
    expect(SRC).not.toContain("'runtimeWarning'")
    expect(SRC).not.toContain("'warning'")
  })

  it('does NOT contain alternative or near-miss failure code spellings', () => {
    expect(SRC).not.toContain("'cam-run-failed'")
    expect(SRC).not.toContain("'camRunFailed'")
    expect(SRC).not.toContain("'cam_failed'")
    expect(SRC).not.toContain("'pipeline_failed'")
  })

  it('imports CamRunResult as a type-only import from ./cam-runner', () => {
    expect(SRC).toContain(
      "import type { CamRunResult } from './cam-runner'"
    )
  })

  it('imports camEngineResultSchema as a value AND CamEngineResult as a type from ../shared/cam-engine-contract', () => {
    expect(SRC).toContain(
      "import { camEngineResultSchema, type CamEngineResult } from '../shared/cam-engine-contract'"
    )
  })

  it('exports exactly one function declaration named normalizeCamRunToEngineResult', () => {
    expect(SRC).toContain('export function normalizeCamRunToEngineResult(')
    const matches = SRC.match(/export function normalizeCamRunToEngineResult\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains exactly two camEngineResultSchema.parse call sites (one per branch)', () => {
    // The adapter has one .parse() inside the if(result.ok) branch and
    // one .parse() in the failure branch. A drift to .safeParse() OR a
    // collapse to a single shared call site would break the discriminated
    // union type-narrowing the adapter relies on.
    const matches = SRC.match(/camEngineResultSchema\.parse\(/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('does NOT use camEngineResultSchema.safeParse', () => {
    // The adapter is a strict-throw boundary; safeParse would silently
    // hide schema violations and break the cam-domain.ts adapter-error
    // path pinned at Cycle 142 [ID-0216].
    expect(SRC).not.toMatch(/camEngineResultSchema\.safeParse\(/)
  })

  it('uses the result.warnings ?? [] nullish-coalesce idiom', () => {
    // The empty-array fallback is what makes warnings optional on input
    // while still mapping to a defined empty array on output.
    expect(SRC).toContain('result.warnings ?? []')
  })

  it('uses the documented warnings.map((message) => ...) arrow function', () => {
    // Pin the arrow signature so a future refactor cannot quietly rename
    // the parameter (which would break IDE rename refactors that target
    // the variable directly).
    expect(SRC).toMatch(/\.map\(\(message\)\s*=>/)
  })

  it('emits the exact { code, message } warning shape', () => {
    expect(SRC).toContain("code: 'runtime_warning'")
    expect(SRC).toContain('message')
  })

  it('emits the exact failure shape with code/message/detail keys', () => {
    expect(SRC).toContain("code: 'cam_run_failed'")
    expect(SRC).toContain('message: result.error')
    expect(SRC).toContain('detail: result.hint')
  })

  it('reads engineId from result.engine.usedEngine on the success branch', () => {
    // The single load-bearing source-of-truth field for engineId. A
    // refactor to result.usedEngine would change the value when a
    // fallback was applied; this pin blocks that drift.
    expect(SRC).toContain('engineId: result.engine.usedEngine')
  })

  it('reads postedGcode from result.gcode on the success branch', () => {
    expect(SRC).toContain('postedGcode: result.gcode')
  })

  it('contains the documented "Canonical adapter" JSDoc header', () => {
    expect(SRC).toContain('Canonical adapter for mapping')
  })

  it('contains the documented "shared engine contract" JSDoc rationale', () => {
    expect(SRC).toContain('shared engine contract')
  })

  it('contains the documented "TS fallback and Python-backed paths" JSDoc rationale', () => {
    expect(SRC).toContain('TS fallback and Python-backed paths')
  })

  it('returns CamEngineResult on the type signature', () => {
    expect(SRC).toContain(': CamEngineResult')
  })

  it('takes CamRunResult on the type signature', () => {
    expect(SRC).toContain('result: CamRunResult')
  })

  it('contains exactly one if(result.ok) branch (single discriminator check)', () => {
    const matches = SRC.match(/if\s*\(\s*result\.ok\s*\)/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('does NOT import any DOM / electron / fs / path / subprocess module', () => {
    expect(SRC).not.toMatch(/from ['"]fs['"]/)
    expect(SRC).not.toMatch(/from ['"]node:fs['"]/)
    expect(SRC).not.toMatch(/from ['"]path['"]/)
    expect(SRC).not.toMatch(/from ['"]node:path['"]/)
    expect(SRC).not.toMatch(/from ['"]child_process['"]/)
    expect(SRC).not.toMatch(/from ['"]node:child_process['"]/)
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toMatch(/from ['"]react['"]/)
  })

  it('contains zero top-level TypeScript `any` annotations', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any\s*[,>]/)
  })

  it('contains zero top-level `let` declarations (pure adapter -- no mutable state)', () => {
    expect(SRC).not.toMatch(/^let\s/m)
  })

  it('does NOT use a switch statement (the discriminator is a single if/return)', () => {
    // The two-branch shape is canonical; a switch would imply more than
    // two engine-result discriminator states (there are only two:
    // ok:true and ok:false).
    expect(SRC).not.toMatch(/\bswitch\s*\(/)
  })

  it('does NOT use try/catch (parse() is allowed to throw to the caller)', () => {
    // The adapter is strict-throw; the cam-domain.ts wrapper Cycle 142
    // [ID-0216] has the matching try/catch that converts the throw
    // into the canonical adapter-violation failure shape. Adding a
    // try/catch HERE would defeat that boundary.
    expect(SRC).not.toMatch(/\btry\s*\{/)
    expect(SRC).not.toMatch(/\}\s*catch\s*\(/)
  })

  it('file size stays under the docs/EDIT-WORKFLOW.md R1 mandatory-territory threshold', () => {
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(200)
  })

  it('file size stays small enough to be a pure boundary adapter (under 80 lines)', () => {
    // A growing adapter is a smell -- additional logic belongs in the
    // engine contract or the cam-domain.ts wrapper. This pin is the
    // canary.
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(80)
  })

  it('exports exactly one symbol (the function only)', () => {
    // Source-text count of `export ` keyword should be 1 (the function
    // export). Type re-exports would add to this count; the adapter has
    // no type re-exports.
    const matches = SRC.match(/^export\s+/gm) ?? []
    expect(matches).toHaveLength(1)
  })
})
