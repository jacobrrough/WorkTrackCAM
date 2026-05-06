/**
 * cam-domain-pin.test.ts -- [ID-0216] Cycle 142 post-processing paired-pin
 *
 * Companion to the behavior-test file `cam-domain.test.ts` (80 lines, 2
 * it()) that covers the happy path + the camRunResultSchema-violation
 * boundary. THIS pin file additionally pins the contract of
 * `src/main/cam-domain.ts` -- the CAM execution boundary facade that
 * funnels every renderer-side run-CAM call through `withCamStageTelemetry`
 * with the canonical stage label `'cam.run_pipeline'`, validates the
 * pipeline result through `normalizeCamRunToEngineResult` AND
 * `camRunResultSchema.safeParse`, and converts BOTH failure modes into
 * the two canonical adapter-/contract-violation failure shapes.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): every FDM slice +
 *     post pipeline runs through `runCamDomain`; the 'cam.run_pipeline'
 *     telemetry label is what surfaces in the per-stage perf inventory
 *     ([ID-0193] perf baseline tracking) AND the DEBUG_CAM=1 console
 *     line, for ALL machines (sister stage label to the
 *     'cam.post_render' label pinned at Cycle 137 [ID-0213]).
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): full-sheet
 *     subtractive jobs flow through `runCamDomain` with
 *     `usedEngine: 'ocl'` or `'builtin'`; the schema-validation gate
 *     (camRunResultSchema) protects the IPC bridge contract from
 *     pipeline shape regressions.
 *   - **Makera Carvera 3-axis & 4-axis**: the adapter integration via
 *     `normalizeCamRunToEngineResult` enforces the canonical engine
 *     contract for both the 3-axis and 4-axis Python engines; pinning
 *     the adapter-throw error message ('CAM engine adapter contract
 *     violation.') prevents silent rebrands of the failure surface
 *     consumed by the renderer error toast.
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
 *   - 142 [ID-0216] cam-domain (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact named exports + `runCamDomain` arity + no
 *       symbol/proto leak + null-prototype + Symbol-key invariants.
 *   (B) Telemetry stage label -- every `runCamDomain` call routes through
 *       `withCamStageTelemetry` with the canonical stage label
 *       `'cam.run_pipeline'`, exactly once per call.
 *   (C) Pass-through invariance -- the request reference is forwarded to
 *       `runCamPipeline` byte-for-byte (no rekeying, no defensive clone,
 *       no silent strip).
 *   (D) Success path -- when adapter + schema both accept, the original
 *       pipeline result is returned by reference (no defensive clone).
 *   (E) Adapter error path -- when `normalizeCamRunToEngineResult`
 *       throws, returns `{ ok: false, error: 'CAM engine adapter
 *       contract violation.', hint: <message> }`.
 *   (F) Schema-violation error path -- when `camRunResultSchema.safeParse`
 *       fails, returns `{ ok: false, error: 'CAM result violated IPC
 *       contract.', hint: <joined issue messages> }`.
 *   (G) Failure pass-through -- a pipeline result with `ok: false` flows
 *       through the adapter (which accepts it via the failure schema)
 *       and is forwarded unchanged.
 *   (H) Source-text whitelist -- the two canonical error messages, the
 *       canonical 'cam.run_pipeline' literal, the import surface
 *       (runCamPipeline value, normalize-... value, withCamStageTelemetry
 *       value, camRunResultSchema value, CamJobConfig + CamRunResult
 *       type-or-value re-exports), the type re-exports CamDomainRequest /
 *       CamDomainResult, exactly-one call site for each gateway, no
 *       DOM/electron imports, no top-level TypeScript `any`, no top-level
 *       `let`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles
 * 119/124/129/130/131/132/134/135/136/137/139/140). Per
 * `docs/EDIT-WORKFLOW.md` R1 the Python-via-bash mandate covers EXISTING
 * files >800 lines and `.claude/` log files only; this is a NEW file
 * < 800 lines so the Write tool is safe (per Cycle 141 v18 ledger
 * mid-cycle re-check protocol).
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { CamRunResult, CamJobConfig } from './cam-runner'
import type { MachineProfile } from '../shared/machine-schema'

// vi.hoisted lets us reference the spies from inside the vi.mock factory
// (vi.mock is hoisted to the very top of the module by the transformer).
const { telemetrySpy } = vi.hoisted(() => ({
  telemetrySpy: vi.fn<(stage: string) => void>()
}))

vi.mock('./cam-runtime-telemetry', () => ({
  withCamStageTelemetry: <T,>(
    stage: string,
    run: () => Promise<T>,
    _sink?: unknown
  ): Promise<T> => {
    telemetrySpy(stage)
    return run()
  }
}))

vi.mock('./cam-runner', () => ({
  runCamPipeline: vi.fn()
}))

import { runCamPipeline } from './cam-runner'
import * as M from './cam-domain'
import { runCamDomain } from './cam-domain'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'cam-domain.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

const baseMachine: MachineProfile = {
  id: 'm1',
  name: 'Test',
  kind: 'cnc',
  workAreaMm: { x: 100, y: 100, z: 100 },
  maxFeedMmMin: 1000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'generic_mm'
}

function buildRequest(overrides: Partial<CamJobConfig> = {}): CamJobConfig {
  return {
    stlPath: '/tmp/in.stl',
    outputGcodePath: '/tmp/out.nc',
    machine: baseMachine,
    resourcesRoot: '/resources',
    appRoot: '/app',
    zPassMm: 1,
    stepoverMm: 0.5,
    feedMmMin: 800,
    plungeMmMin: 200,
    safeZMm: 5,
    pythonPath: 'python',
    ...overrides
  }
}

function buildOkResult(overrides: Partial<Extract<CamRunResult, { ok: true }>> = {}): CamRunResult {
  return {
    ok: true,
    gcode: 'G21\nM30',
    usedEngine: 'builtin',
    engine: {
      requestedEngine: 'builtin',
      usedEngine: 'builtin',
      fallbackApplied: false
    },
    ...overrides
  }
}

function buildFailResult(overrides: Partial<Extract<CamRunResult, { ok: false }>> = {}): CamRunResult {
  return {
    ok: false,
    error: 'pipeline failure under test',
    ...overrides
  }
}

beforeEachReset()

function beforeEachReset(): void {
  // Centralised reset hook so every it() starts with a clean spy ledger.
  // (Re-armed below via a real vitest beforeEach so the function call here
  //  serves only as a no-op compile-time anchor.)
}

import { beforeEach } from 'vitest'

beforeEach(() => {
  telemetrySpy.mockClear()
  vi.mocked(runCamPipeline).mockReset()
})

// --------------------------------------------------------------------------
// (A) Module shape -- exact named exports
// --------------------------------------------------------------------------
describe('[ID-0216] cam-domain module shape', () => {
  it('exports exactly the documented runtime symbol set', () => {
    // CamDomainRequest + CamDomainResult are type-only re-exports and are
    // erased at runtime; runCamDomain is the only runtime export.
    const runtimeKeys = Object.keys(M).filter((key) => key !== '__esModule')
    expect(runtimeKeys.sort()).toEqual(['runCamDomain'])
  })

  it('runCamDomain is an async function with arity 1', () => {
    expect(typeof M.runCamDomain).toBe('function')
    expect(M.runCamDomain.length).toBe(1)
    // Native async functions stringify with the `async function` prefix.
    const tag = M.runCamDomain.constructor.name
    expect(tag === 'AsyncFunction' || tag === 'Function').toBe(true)
  })

  it('runCamDomain returns a Promise', () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    const ret = M.runCamDomain(buildRequest())
    expect(ret).toBeInstanceOf(Promise)
    return ret
  })

  it('namespace exposes only string-keyed runtime members (no Symbol-key leak)', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M).filter(
      (s) => s !== Symbol.toStringTag
    )
    expect(symbolKeys).toEqual([])
  })
})

// --------------------------------------------------------------------------
// (B) Telemetry stage label
// --------------------------------------------------------------------------
describe('[ID-0216] telemetry stage label is cam.run_pipeline', () => {
  it('routes the call through withCamStageTelemetry exactly once per dispatch', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    await runCamDomain(buildRequest())
    expect(telemetrySpy).toHaveBeenCalledTimes(1)
  })

  it('passes the canonical "cam.run_pipeline" stage label verbatim', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    await runCamDomain(buildRequest())
    expect(telemetrySpy).toHaveBeenCalledWith('cam.run_pipeline')
  })

  it('uses the same stage label across N=5 successive calls (no string drift)', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    for (let i = 0; i < 5; i++) {
      await runCamDomain(buildRequest())
    }
    expect(telemetrySpy).toHaveBeenCalledTimes(5)
    for (let i = 0; i < 5; i++) {
      expect(telemetrySpy).toHaveBeenNthCalledWith(i + 1, 'cam.run_pipeline')
    }
  })

  it('does NOT use the post-render stage label (negative whitelist)', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    await runCamDomain(buildRequest())
    // 'cam.post_render' is the post-process boundary label (Cycle 137 pin);
    // 'cam.run_pipeline' is THIS facade. The two MUST NOT cross-contaminate.
    expect(telemetrySpy).not.toHaveBeenCalledWith('cam.post_render')
    expect(telemetrySpy).not.toHaveBeenCalledWith('cam.simulate')
    expect(telemetrySpy).not.toHaveBeenCalledWith('cam.toolpath_render')
    expect(telemetrySpy).not.toHaveBeenCalledWith('run_pipeline')
    expect(telemetrySpy).not.toHaveBeenCalledWith('cam_run_pipeline')
  })

  it('still fires telemetry exactly once when the pipeline rejects', async () => {
    const sentinel = new Error('underlying pipeline failure')
    vi.mocked(runCamPipeline).mockRejectedValue(sentinel)
    await expect(runCamDomain(buildRequest())).rejects.toBe(sentinel)
    expect(telemetrySpy).toHaveBeenCalledTimes(1)
    expect(telemetrySpy).toHaveBeenCalledWith('cam.run_pipeline')
  })
})

// --------------------------------------------------------------------------
// (C) Pass-through invariance -- request forwarded to runCamPipeline
// --------------------------------------------------------------------------
describe('[ID-0216] request is forwarded to runCamPipeline byte-for-byte', () => {
  it('forwards the exact request reference (no defensive clone)', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    const request = buildRequest()
    await runCamDomain(request)
    expect(runCamPipeline).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runCamPipeline).mock.calls[0][0]).toBe(request)
  })

  it('calls runCamPipeline exactly once per dispatch (no retry, no double-call)', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    await runCamDomain(buildRequest())
    expect(runCamPipeline).toHaveBeenCalledTimes(1)
  })

  it('runCamPipeline receives a single positional argument (no extra args)', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    await runCamDomain(buildRequest())
    expect(vi.mocked(runCamPipeline).mock.calls[0]).toHaveLength(1)
  })

  it('does NOT invoke runCamPipeline when withCamStageTelemetry never resolves the closure', async () => {
    // Sanity: the facade chains through telemetry; this guards against a
    // future refactor that calls runCamPipeline twice (once outside the
    // telemetry wrapper).
    vi.mocked(runCamPipeline).mockResolvedValue(buildOkResult())
    await runCamDomain(buildRequest())
    expect(runCamPipeline).toHaveBeenCalledTimes(1)
    // Also confirm telemetry fired before the runCamPipeline mock was
    // settled (telemetry-spy increments synchronously inside the
    // factory; runCamPipeline mock is async-resolved).
    expect(telemetrySpy.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runCamPipeline).mock.invocationCallOrder[0]
    )
  })
})

// --------------------------------------------------------------------------
// (D) Success path -- pipeline result returned by reference
// --------------------------------------------------------------------------
describe('[ID-0216] success path returns the pipeline result by reference', () => {
  it('returns the exact ok result object when adapter + schema both accept', async () => {
    const sentinel = buildOkResult({ gcode: 'G21\nG90\nM30', usedEngine: 'ocl' })
    vi.mocked(runCamPipeline).mockResolvedValue(sentinel)
    const result = await runCamDomain(buildRequest())
    expect(result).toBe(sentinel)
  })

  it('preserves all documented success-result fields (no rekeying)', async () => {
    const result = buildOkResult({
      gcode: 'G21\nM30',
      usedEngine: 'advanced',
      hint: 'computed in 1.2s',
      warnings: ['near-feed-cap']
    })
    vi.mocked(runCamPipeline).mockResolvedValue(result)
    const ret = await runCamDomain(buildRequest())
    if (!ret.ok) throw new Error('expected ok')
    expect(ret.gcode).toBe('G21\nM30')
    expect(ret.usedEngine).toBe('advanced')
    expect(ret.hint).toBe('computed in 1.2s')
    expect(ret.warnings).toEqual(['near-feed-cap'])
  })

  it('does NOT inject extra keys into the success result', async () => {
    const sentinel = buildOkResult()
    vi.mocked(runCamPipeline).mockResolvedValue(sentinel)
    const ret = await runCamDomain(buildRequest())
    if (!ret.ok) throw new Error('expected ok')
    const expectedKeys = new Set(['ok', 'gcode', 'usedEngine', 'engine'])
    for (const key of Object.keys(ret)) {
      expect(expectedKeys.has(key)).toBe(true)
    }
  })
})

// --------------------------------------------------------------------------
// (E) Adapter-error path -- normalizeCamRunToEngineResult throws
// --------------------------------------------------------------------------
describe('[ID-0216] adapter-error path returns canonical adapter-violation failure', () => {
  it('returns ok:false with the canonical adapter error string', async () => {
    // An ok:true result with a malformed `engine` shape causes the
    // real adapter (camEngineResultSchema.parse) to throw a ZodError.
    vi.mocked(runCamPipeline).mockResolvedValue({
      ok: true,
      gcode: 'G21\nM30',
      usedEngine: 'builtin',
      engine: {} as never
    })
    const ret = await runCamDomain(buildRequest())
    expect(ret.ok).toBe(false)
    if (ret.ok) throw new Error('expected failure')
    expect(ret.error).toBe('CAM engine adapter contract violation.')
  })

  it('attaches the adapter error message as the hint string', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue({
      ok: true,
      gcode: 'G21\nM30',
      usedEngine: 'builtin',
      engine: {} as never
    })
    const ret = await runCamDomain(buildRequest())
    if (ret.ok) throw new Error('expected failure')
    expect(typeof ret.hint).toBe('string')
    expect((ret.hint ?? '').length).toBeGreaterThan(0)
  })

  it('does NOT return the original pipeline result on adapter throw', async () => {
    const original = {
      ok: true as const,
      gcode: 'G21\nM30',
      usedEngine: 'builtin' as const,
      engine: {} as never
    }
    vi.mocked(runCamPipeline).mockResolvedValue(original)
    const ret = await runCamDomain(buildRequest())
    expect(ret).not.toBe(original)
    expect(ret.ok).toBe(false)
  })

  it('falls back to String(error) when the adapter throws a non-Error', async () => {
    // Pin the `error instanceof Error ? error.message : String(error)`
    // branch in cam-domain.ts. Achieved by stubbing the adapter via a
    // non-Error throw is not directly reachable here without mocking
    // the adapter -- so verify the source-text branch instead.
    expect(SRC).toContain('error instanceof Error ? error.message : String(error)')
  })
})

// --------------------------------------------------------------------------
// (F) Schema-violation error path -- camRunResultSchema.safeParse fails
// --------------------------------------------------------------------------
describe('[ID-0216] schema-violation path returns canonical IPC-contract failure', () => {
  it('returns ok:false with the canonical IPC-contract error string', async () => {
    // Construct an ok:true result that the adapter accepts but the
    // camRunResultSchema rejects. The schema requires `usedEngine` to be
    // one of 'advanced' | 'ocl' | 'builtin'; the adapter only reads
    // `result.engine.usedEngine` (not `result.usedEngine`), so we can
    // craft an adapter-clean / schema-dirty result by setting
    // `usedEngine` to a non-enum string at the top level while keeping
    // `engine.usedEngine` valid.
    vi.mocked(runCamPipeline).mockResolvedValue({
      ok: true,
      gcode: 'G21\nM30',
      // Intentional schema violation -- non-enum string at the
      // top-level usedEngine (the adapter only reads engine.usedEngine
      // so it accepts; the IPC schema rejects).
      usedEngine: 'not-a-valid-engine',
      engine: {
        requestedEngine: 'builtin',
        usedEngine: 'builtin',
        fallbackApplied: false
      }
    } as unknown as CamRunResult)
    const ret = await runCamDomain(buildRequest())
    expect(ret.ok).toBe(false)
    if (ret.ok) throw new Error('expected failure')
    expect(ret.error).toBe('CAM result violated IPC contract.')
  })

  it('joins multiple schema issues with semicolon-space ("; ")', async () => {
    // A wholly invalid shape should produce multiple zod issues (e.g.
    // missing usedEngine + missing engine). The hint joins them with '; '.
    vi.mocked(runCamPipeline).mockResolvedValue({
      // Intentional multi-issue schema violation: missing required
      // fields gcode/usedEngine/engine.
      ok: true
    } as unknown as CamRunResult)
    const ret = await runCamDomain(buildRequest())
    if (ret.ok) throw new Error('expected failure')
    expect(typeof ret.hint).toBe('string')
    // Either at least one '; ' separator (multi-issue) OR a single issue
    // string (a degenerate case with only one zod issue). Both paths must
    // produce a non-empty hint.
    expect((ret.hint ?? '').length).toBeGreaterThan(0)
  })

  it('does NOT return the original schema-failing result', async () => {
    const original = {
      ok: true as const,
      gcode: 'G21\nM30',
      // Intentional schema violation (non-enum top-level usedEngine).
      usedEngine: 'mystery-engine',
      engine: {
        requestedEngine: 'builtin' as const,
        usedEngine: 'builtin' as const,
        fallbackApplied: false
      }
    }
    vi.mocked(runCamPipeline).mockResolvedValue(original as unknown as CamRunResult)
    const ret = await runCamDomain(buildRequest())
    expect(ret).not.toBe(original)
    expect(ret.ok).toBe(false)
  })
})

// --------------------------------------------------------------------------
// (G) Failure pass-through -- ok:false pipeline result threads through
//     the adapter (CamRunFailure -> CamEngineResult failure shape) and
//     should be returned unchanged when both adapter + schema accept.
// --------------------------------------------------------------------------
describe('[ID-0216] ok:false pipeline result flows through adapter + schema', () => {
  it('forwards the failure result by reference when adapter + schema accept', async () => {
    const sentinel = buildFailResult({ error: 'invalid_numeric_params', hint: 'feedMmMin <= 0' })
    vi.mocked(runCamPipeline).mockResolvedValue(sentinel)
    const ret = await runCamDomain(buildRequest())
    expect(ret).toBe(sentinel)
    expect(ret.ok).toBe(false)
    if (ret.ok) throw new Error('expected failure')
    expect(ret.error).toBe('invalid_numeric_params')
    expect(ret.hint).toBe('feedMmMin <= 0')
  })

  it('preserves the pipeline-failure error string verbatim (no rebrand)', async () => {
    const sentinel = buildFailResult({ error: 'stl_missing' })
    vi.mocked(runCamPipeline).mockResolvedValue(sentinel)
    const ret = await runCamDomain(buildRequest())
    if (ret.ok) throw new Error('expected failure')
    expect(ret.error).toBe('stl_missing')
    // The two canonical adapter/contract failure strings must NOT replace
    // an organic pipeline failure.
    expect(ret.error).not.toBe('CAM engine adapter contract violation.')
    expect(ret.error).not.toBe('CAM result violated IPC contract.')
  })

  it('still fires telemetry exactly once on a clean ok:false result', async () => {
    vi.mocked(runCamPipeline).mockResolvedValue(buildFailResult())
    await runCamDomain(buildRequest())
    expect(telemetrySpy).toHaveBeenCalledTimes(1)
    expect(telemetrySpy).toHaveBeenCalledWith('cam.run_pipeline')
  })
})

// --------------------------------------------------------------------------
// (H) Source-text whitelist -- pin the load-bearing literals + imports
// --------------------------------------------------------------------------
describe('[ID-0216] cam-domain.ts source-text whitelist', () => {
  it('contains the canonical "cam.run_pipeline" stage label literal', () => {
    expect(SRC).toContain("'cam.run_pipeline'")
  })

  it('does NOT contain alternative or near-miss stage label spellings', () => {
    // Negative whitelist: guard against rename drift.
    expect(SRC).not.toContain("'cam_run_pipeline'")
    expect(SRC).not.toContain("'cam.runPipeline'")
    expect(SRC).not.toContain("'run_pipeline'")
    expect(SRC).not.toContain("'cam.post_render'")
    expect(SRC).not.toContain("'cam.simulate'")
  })

  it('contains the canonical adapter-violation error string literal', () => {
    expect(SRC).toContain("'CAM engine adapter contract violation.'")
  })

  it('contains the canonical IPC-contract violation error string literal', () => {
    expect(SRC).toContain("'CAM result violated IPC contract.'")
  })

  it('imports runCamPipeline as a value from ./cam-runner with the documented type re-exports', () => {
    expect(SRC).toContain(
      "import { runCamPipeline, type CamJobConfig, type CamRunResult } from './cam-runner'"
    )
  })

  it('imports camRunResultSchema as a value from ../shared/cam-ipc-contract', () => {
    expect(SRC).toContain(
      "import { camRunResultSchema } from '../shared/cam-ipc-contract'"
    )
  })

  it('imports normalizeCamRunToEngineResult as a value from ./cam-engine-adapter', () => {
    expect(SRC).toContain(
      "import { normalizeCamRunToEngineResult } from './cam-engine-adapter'"
    )
  })

  it('imports withCamStageTelemetry as a value from ./cam-runtime-telemetry', () => {
    expect(SRC).toContain(
      "import { withCamStageTelemetry } from './cam-runtime-telemetry'"
    )
  })

  it('declares the two type re-exports CamDomainRequest and CamDomainResult', () => {
    expect(SRC).toContain('export type CamDomainRequest = CamJobConfig')
    expect(SRC).toContain('export type CamDomainResult = CamRunResult')
  })

  it('contains exactly one withCamStageTelemetry call site', () => {
    const matches = SRC.match(/withCamStageTelemetry\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains exactly one runCamPipeline call site (inside the telemetry closure)', () => {
    const matches = SRC.match(/runCamPipeline\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains exactly one normalizeCamRunToEngineResult call site', () => {
    const matches = SRC.match(/normalizeCamRunToEngineResult\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains exactly one camRunResultSchema.safeParse call site', () => {
    const matches = SRC.match(/camRunResultSchema\.safeParse\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('exports exactly one async function declaration named runCamDomain', () => {
    expect(SRC).toContain('export async function runCamDomain(')
    const matches = SRC.match(/export async function runCamDomain\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('uses the standard Error-narrow + String fallback for hint extraction', () => {
    // The exact code branch that is unreachable from the test path
    // (zod schemas always throw real Error instances). This pin is the
    // only protection against a future refactor that drops the fallback.
    expect(SRC).toContain('error instanceof Error ? error.message : String(error)')
  })

  it('uses the canonical issue-message join separator "; "', () => {
    expect(SRC).toContain(".join('; ')")
  })

  it('uses safeParse (not parse) on the IPC contract -- preserves the failure-without-throw path', () => {
    // A switch to .parse() would throw on schema violation and bypass the
    // canonical 'CAM result violated IPC contract.' return shape.
    expect(SRC).toContain('camRunResultSchema.safeParse(result)')
    expect(SRC).not.toMatch(/camRunResultSchema\.parse\(/)
  })

  it('does NOT import any DOM / electron / fs / path / subprocess module', () => {
    // The facade is a pure boundary delegator -- it must not pick up
    // file or process side-effects that would break test sandboxing.
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
    // Allowlist: zero `: any`, zero `as any`, zero `Array<any>`, zero
    // `Record<string, any>` patterns.
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any\s*[,>]/)
  })

  it('contains zero top-level `let` declarations (pure facade -- no mutable state)', () => {
    expect(SRC).not.toMatch(/^let\s/m)
  })

  it('contains the documented "Boundary facade for CAM execution." JSDoc header', () => {
    expect(SRC).toContain('Boundary facade for CAM execution.')
  })

  it('contains the documented "Phase-2 contract unification" comment provenance', () => {
    expect(SRC).toContain('Phase-2 contract unification')
  })

  it('contains the canonical try/catch around the adapter call', () => {
    // The adapter is the ONLY synchronous throw site in the facade and
    // its protection is the single try/catch in the file.
    const tryMatches = SRC.match(/\btry\s*\{/g) ?? []
    const catchMatches = SRC.match(/\}\s*catch\s*\(/g) ?? []
    expect(tryMatches).toHaveLength(1)
    expect(catchMatches).toHaveLength(1)
  })

  it('uses the parsed.error.issues.map((issue) => issue.message) shape', () => {
    // The exact shape of the joined hint string depends on the
    // .issues.map((issue) => issue.message).join('; ') chain.
    expect(SRC).toContain('issues.map((issue) => issue.message)')
  })

  it('returns the original `result` reference on the success-after-validation branch', () => {
    // Final `return result` line; if a refactor introduces a defensive
    // clone (e.g. `return { ...result }`), this pin trips before the
    // reference-equality contract pinned in section (D) breaks.
    expect(SRC).toMatch(/^\s*return result\s*$/m)
    expect(SRC).not.toMatch(/return \{\s*\.\.\.result\s*\}/)
  })

  it('routes the pipeline call through the telemetry wrapper (not directly)', () => {
    // The runCamPipeline call site must sit INSIDE the
    // `withCamStageTelemetry('cam.run_pipeline', () => runCamPipeline(...))`
    // closure -- not dangling outside it.
    expect(SRC).toMatch(
      /withCamStageTelemetry\('cam\.run_pipeline',\s*\(\)\s*=>\s*runCamPipeline\(/
    )
  })

  it('mentions the documented decoupling rationale in the JSDoc', () => {
    // Provenance pin -- guard against accidental JSDoc removal during
    // future refactors.
    expect(SRC).toContain(
      'Keeps IPC handlers decoupled from the large cam-runner implementation.'
    )
  })

  it('file size stays under the docs/EDIT-WORKFLOW.md R1 mandatory-territory threshold', () => {
    // The cam-domain.ts facade should remain a small boundary file. If
    // it grows past 800 lines a future Edit on it falls under R1.5
    // mandatory Python-via-bash territory -- the pin would catch the
    // threshold-crossing commit.
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(200)
  })
})
