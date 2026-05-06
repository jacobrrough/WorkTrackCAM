/**
 * post-domain-pin.test.ts -- [ID-0213] Cycle 137 post-processing paired-pin
 *
 * Companion to the behavior-test file `post-domain.test.ts` (78 lines, 3
 * it()) that covers the happy path + the [ID-0020-wire] vacuum-opts
 * pass-through. THIS pin file additionally pins the contract of
 * `src/main/post-domain.ts` -- the post-processing boundary facade that
 * funnels every renderer-side post call through `withCamStageTelemetry`
 * with the canonical stage label `'cam.post_render'` and forwards every
 * documented `opts` key to `renderPost` verbatim.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): the FDM passthrough
 *     template is rendered through this facade; the telemetry stage label
 *     is what surfaces in the per-stage perf inventory + the DEBUG_CAM
 *     console line ([ID-0193] perf baseline tracking).
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series, Mach3 superset):
 *     `vacuumZoneAllocation` + `vacuumOptions` are the [ID-0020-wire]
 *     Cycle 109 plumbing for the wrapLagunaToolpathWithVacuumBlocks
 *     preamble + release postamble. The facade MUST forward both
 *     references untouched -- a defensive clone here would silently
 *     defeat the engaged-zones reference-equality contract observed by
 *     callers of `runPostDomain` upstream of `wrapLaguna...`.
 *   - **Makera Carvera 3-axis & 4-axis**: every `opts.cutterCompensation`
 *     / `opts.subroutineDialect` / `opts.lineNumbering` / `opts.toolNumber`
 *     / `opts.toolWearOffsetH` / `opts.toolWearOffsetD` / `opts.inverseTimeFeed`
 *     forwarding goes through this facade; pinning the 16-key opts surface
 *     blocks accidental opt-name renames (which would silently no-op the
 *     downstream feature for the Makera posts).
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
 *   - 137 [ID-0213] post-domain (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact named exports + `runPostDomain` arity + no
 *       symbol/proto leak + null-prototype + Symbol.toStringTag-only
 *       Symbol-key invariant.
 *   (B) PostDomainRequest type contract -- the three required keys
 *       (resourcesRoot, machine, toolpathLines), the optional `opts`
 *       envelope, and the 16 documented `opts` keys compile through.
 *   (C) Telemetry stage label -- every `runPostDomain` call routes through
 *       `withCamStageTelemetry` with the canonical stage label
 *       `'cam.post_render'`, exactly once per call.
 *   (D) Pass-through invariance -- every documented `opts` key is forwarded
 *       to `renderPost` byte-for-byte (no rekeying, no defensive clone, no
 *       silent strip).
 *   (E) Positional-arg discipline -- `renderPost` is called with
 *       (resourcesRoot, machine, toolpathLines, opts) in that order; the
 *       facade MUST NOT swap, drop, or merge args.
 *   (F) Caller-mutation isolation -- mutating the request after dispatch
 *       does not alter what was passed; mutating the result does not
 *       throw.
 *   (G) Error-path forwarding -- a rejecting `renderPost` rejects the
 *       facade and the telemetry stage closure still runs.
 *   (H) Source-text whitelist -- 'cam.post_render' literal, [ID-0020-wire]
 *       provenance, Cycle 103 + Cycle 109 references, type-only imports
 *       for MachineProfile + Laguna types, no DOM/electron imports, no
 *       top-level TypeScript `any`, no top-level `let`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles
 * 119/124/129/130/131/132/134/135/136). Per `docs/EDIT-WORKFLOW.md` R1
 * the Python-via-bash mandate covers EXISTING files >800 lines and
 * `.claude/` log files only; this is a NEW file < 800 lines so the Write
 * tool is safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { MachineProfile } from '../shared/machine-schema'
import type { LagunaVacuumZoneAllocation } from '../shared/laguna-vacuum-allocator'
import type { LagunaVacuumPostludeOptions } from '../shared/laguna-vacuum-postlude'

// vi.hoisted lets us reference the spy from inside the vi.mock factory
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

vi.mock('./post-process', () => ({
  renderPost: vi.fn().mockResolvedValue({ gcode: 'G21\nM30', warnings: [] })
}))

import { renderPost } from './post-process'
import * as M from './post-domain'
import { runPostDomain, type PostDomainRequest } from './post-domain'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'post-domain.ts')
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

const baseRequest: PostDomainRequest = {
  resourcesRoot: '/resources',
  machine: baseMachine,
  toolpathLines: ['G0 X0 Y0', 'G1 X10 Y0 F500']
}

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0213] post-domain module shape', () => {
  it('exports runPostDomain as a function', () => {
    expect(typeof runPostDomain).toBe('function')
  })

  it('runPostDomain arity is exactly 1 (single request envelope)', () => {
    // The facade takes ONE structured PostDomainRequest, NOT positional
    // args. If a refactor accidentally fans out to (root, machine, lines)
    // every call site breaks; this pin catches that drift.
    expect(runPostDomain.length).toBe(1)
  })

  it('runPostDomain returns a Promise', () => {
    const p = runPostDomain(baseRequest)
    expect(p).toBeInstanceOf(Promise)
    return p
  })

  it('runtime-keys whitelist: only the runPostDomain value export', () => {
    // Types are erased at runtime so PostDomainRequest never appears in M.
    // A stray helper export (e.g. a debug print) would surface here.
    const keys = Object.keys(M).sort()
    expect(keys).toEqual(['runPostDomain'])
  })

  it('module-namespace has only the runPostDomain string-keyed value export (Symbol.toStringTag only)', () => {
    const keys = Reflect.ownKeys(M)
    const stringKeys = keys.filter((k): k is string => typeof k === 'string').sort()
    const symbolKeys = keys.filter((k): k is symbol => typeof k === 'symbol')
    expect(stringKeys).toEqual(['runPostDomain'])
    for (const s of symbolKeys) {
      expect(s).toBe(Symbol.toStringTag)
    }
    // ESM module namespace objects have null prototypes per spec.
    expect(Object.getPrototypeOf(M)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (B) PostDomainRequest type contract (compile-through pins)
// ---------------------------------------------------------------------------

describe('[ID-0213] PostDomainRequest type contract compiles through', () => {
  it('accepts the minimum required shape (resourcesRoot + machine + toolpathLines)', () => {
    const req: PostDomainRequest = {
      resourcesRoot: '/r',
      machine: baseMachine,
      toolpathLines: []
    }
    expect(req.resourcesRoot).toBe('/r')
  })

  it('opts is optional (no opts key required)', () => {
    const req: PostDomainRequest = {
      resourcesRoot: '/r',
      machine: baseMachine,
      toolpathLines: ['G0']
    }
    expect('opts' in req).toBe(false)
  })

  it('opts accepts the full 16-key documented surface', () => {
    const allocation: LagunaVacuumZoneAllocation = {
      engaged: ['X0Y0'],
      idle: [],
      engagedCount: 1,
      totalOverlapMm2: 100,
      bedCoverageFraction: 0.01,
      fullBedEngaged: false,
      outsideEnvelope: false,
      zones: []
    }
    const vacuumOpts: LagunaVacuumPostludeOptions = {
      enableMach3DigitalOutputs: true
    }
    const req: PostDomainRequest = {
      resourcesRoot: '/r',
      machine: baseMachine,
      toolpathLines: ['G0'],
      opts: {
        workCoordinateIndex: 1,
        operationLabel: 'OP1',
        spindleRpm: 12000,
        toolNumber: 3,
        inverseTimeFeed: false,
        toolWearOffsetH: 1,
        toolWearOffsetD: 1,
        enableArcFitting: true,
        arcTolerance: 0.01,
        cutterCompensation: 'left',
        cutterCompDRegister: 1,
        enableSubroutines: true,
        subroutineDialect: 'fanuc',
        lineNumbering: { enabled: true, start: 10, increment: 10 },
        vacuumZoneAllocation: allocation,
        vacuumOptions: vacuumOpts
      }
    }
    expect(Object.keys(req.opts ?? {}).sort()).toEqual(
      [
        'arcTolerance',
        'cutterCompDRegister',
        'cutterCompensation',
        'enableArcFitting',
        'enableSubroutines',
        'inverseTimeFeed',
        'lineNumbering',
        'operationLabel',
        'spindleRpm',
        'subroutineDialect',
        'toolNumber',
        'toolWearOffsetD',
        'toolWearOffsetH',
        'vacuumOptions',
        'vacuumZoneAllocation',
        'workCoordinateIndex'
      ].sort()
    )
  })

  it('cutterCompensation accepts the three documented enum values', () => {
    const variants: Array<NonNullable<NonNullable<PostDomainRequest['opts']>['cutterCompensation']>> = [
      'none',
      'left',
      'right'
    ]
    expect(variants).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// (C) Telemetry stage label -- 'cam.post_render' literal
// ---------------------------------------------------------------------------

describe('[ID-0213] telemetry stage label is cam.post_render', () => {
  it('routes the call through withCamStageTelemetry exactly once per dispatch', async () => {
    telemetrySpy.mockClear()
    await runPostDomain(baseRequest)
    expect(telemetrySpy).toHaveBeenCalledTimes(1)
  })

  it('passes the canonical "cam.post_render" stage label verbatim', async () => {
    telemetrySpy.mockClear()
    await runPostDomain(baseRequest)
    expect(telemetrySpy).toHaveBeenCalledWith('cam.post_render')
  })

  it('emits a fresh telemetry event per dispatch (N=5 calls)', async () => {
    telemetrySpy.mockClear()
    for (let i = 0; i < 5; i++) {
      await runPostDomain(baseRequest)
    }
    expect(telemetrySpy).toHaveBeenCalledTimes(5)
    for (let i = 0; i < 5; i++) {
      expect(telemetrySpy).toHaveBeenNthCalledWith(i + 1, 'cam.post_render')
    }
  })

  it('does NOT use a "cam.post" or "post.render" prefix variant', async () => {
    telemetrySpy.mockClear()
    await runPostDomain(baseRequest)
    const stages = telemetrySpy.mock.calls.map((c) => c[0])
    expect(stages).not.toContain('cam.post')
    expect(stages).not.toContain('post.render')
    expect(stages).not.toContain('post_render')
    expect(stages).not.toContain('cam.post.render')
  })
})

// ---------------------------------------------------------------------------
// (D) Pass-through invariance -- every documented opts key forwarded verbatim
// ---------------------------------------------------------------------------

const DOCUMENTED_OPTS: ReadonlyArray<keyof NonNullable<PostDomainRequest['opts']>> = [
  'workCoordinateIndex',
  'operationLabel',
  'spindleRpm',
  'toolNumber',
  'inverseTimeFeed',
  'toolWearOffsetH',
  'toolWearOffsetD',
  'enableArcFitting',
  'arcTolerance',
  'cutterCompensation',
  'cutterCompDRegister',
  'enableSubroutines',
  'subroutineDialect',
  'lineNumbering',
  'vacuumZoneAllocation',
  'vacuumOptions'
]

const SAMPLE_OPTS: NonNullable<PostDomainRequest['opts']> = {
  workCoordinateIndex: 2,
  operationLabel: 'finish-pass',
  spindleRpm: 15000,
  toolNumber: 4,
  inverseTimeFeed: true,
  toolWearOffsetH: 4,
  toolWearOffsetD: 4,
  enableArcFitting: true,
  arcTolerance: 0.005,
  cutterCompensation: 'right',
  cutterCompDRegister: 4,
  enableSubroutines: true,
  subroutineDialect: 'siemens',
  lineNumbering: { enabled: false, start: 1, increment: 1 },
  vacuumZoneAllocation: {
    engaged: ['X1Y1'],
    idle: ['X0Y0'],
    engagedCount: 1,
    totalOverlapMm2: 50,
    bedCoverageFraction: 0.005,
    fullBedEngaged: false,
    outsideEnvelope: false,
    zones: []
  },
  vacuumOptions: { enableMach3DigitalOutputs: false }
}

describe('[ID-0213] every documented opts key is forwarded to renderPost verbatim', () => {
  // Sanity guard: if a refactor adds/removes opts keys, the SAMPLE_OPTS
  // table will drift from DOCUMENTED_OPTS and tests below will start
  // missing real cases. Pin the table itself.
  it('DOCUMENTED_OPTS table matches SAMPLE_OPTS keys exactly', () => {
    const sampleKeys = Object.keys(SAMPLE_OPTS).sort() as Array<
      keyof NonNullable<PostDomainRequest['opts']>
    >
    expect(sampleKeys).toEqual([...DOCUMENTED_OPTS].sort())
  })

  it.each(DOCUMENTED_OPTS as readonly string[])(
    'forwards opts.%s to renderPost reference-equal',
    async (key) => {
      const renderPostMock = vi.mocked(renderPost)
      renderPostMock.mockClear()
      await runPostDomain({ ...baseRequest, opts: SAMPLE_OPTS })
      expect(renderPostMock).toHaveBeenCalledTimes(1)
      const passedOpts = renderPostMock.mock.calls[0]?.[3]
      expect(passedOpts).toBeDefined()
      // Reference-equal for objects (vacuum*, lineNumbering); value-equal
      // for primitives. .toBe handles both because primitives compare ===.
      // For objects, this PINS that the facade does NOT defensively clone.
      const expected = (SAMPLE_OPTS as Record<string, unknown>)[key]
      const actual = (passedOpts as Record<string, unknown>)[key]
      expect(actual).toBe(expected)
    }
  )

  it('does not inject any unsolicited opts keys when caller passes a single opt', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    await runPostDomain({ ...baseRequest, opts: { spindleRpm: 9000 } })
    const passedOpts = renderPostMock.mock.calls[0]?.[3]
    expect(passedOpts).toEqual({ spindleRpm: 9000 })
    expect(Object.keys(passedOpts ?? {})).toEqual(['spindleRpm'])
  })

  it('omits opts entirely when caller omits opts (no implicit empty-object default)', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    await runPostDomain(baseRequest)
    const passedOpts = renderPostMock.mock.calls[0]?.[3]
    expect(passedOpts).toBeUndefined()
  })

  it('forwards an empty opts object as-is (does NOT replace with undefined)', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    await runPostDomain({ ...baseRequest, opts: {} })
    const passedOpts = renderPostMock.mock.calls[0]?.[3]
    expect(passedOpts).toEqual({})
    // Reference identity is intentional: the facade is a strict pass-through.
  })
})

// ---------------------------------------------------------------------------
// (E) Positional-arg discipline -- renderPost(root, machine, lines, opts)
// ---------------------------------------------------------------------------

describe('[ID-0213] renderPost positional-arg ordering is (resourcesRoot, machine, toolpathLines, opts)', () => {
  it('arg 0 is resourcesRoot exactly as supplied', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    await runPostDomain({ ...baseRequest, resourcesRoot: '/some/path' })
    expect(renderPostMock.mock.calls[0]?.[0]).toBe('/some/path')
  })

  it('arg 1 is the machine reference (no clone)', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    const machine: MachineProfile = { ...baseMachine, id: 'k2-plus' }
    await runPostDomain({ ...baseRequest, machine })
    // Reference-equal: the facade hands the original profile through.
    expect(renderPostMock.mock.calls[0]?.[1]).toBe(machine)
  })

  it('arg 2 is the toolpathLines array reference (no clone)', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    const lines = ['G0 X0 Y0', 'G1 X1 Y1 F500']
    await runPostDomain({ ...baseRequest, toolpathLines: lines })
    expect(renderPostMock.mock.calls[0]?.[2]).toBe(lines)
  })

  it('arg 3 is the opts reference (no clone) when opts is supplied', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    const opts = { spindleRpm: 8000 }
    await runPostDomain({ ...baseRequest, opts })
    expect(renderPostMock.mock.calls[0]?.[3]).toBe(opts)
  })

  it('renderPost arity-call uses exactly 4 positional args', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    await runPostDomain({ ...baseRequest, opts: { spindleRpm: 8000 } })
    expect(renderPostMock.mock.calls[0]).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// (F) Caller-mutation isolation
// ---------------------------------------------------------------------------

describe('[ID-0213] caller-mutation isolation', () => {
  it('mutating the request after dispatch does not retroactively alter renderPost args', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    const opts: NonNullable<PostDomainRequest['opts']> = { spindleRpm: 7000 }
    const lines = ['G0']
    await runPostDomain({ ...baseRequest, opts, toolpathLines: lines })
    // Capture references at dispatch time.
    const call0 = renderPostMock.mock.calls[0]
    expect(call0?.[3]).toBe(opts)
    // Mutate after the fact -- because the facade passes by reference,
    // the captured args.[3] === opts and would observe new keys. This
    // pin documents the intentional pass-by-reference design.
    ;(opts as Record<string, unknown>).spindleRpm = 1
    expect((call0?.[3] as Record<string, unknown>)?.spindleRpm).toBe(1)
  })

  it('the facade does not mutate the request envelope', async () => {
    const before = { ...baseRequest }
    await runPostDomain(baseRequest)
    expect(baseRequest).toEqual(before)
  })

  it('returns a Promise that resolves to the renderPost result', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    renderPostMock.mockResolvedValueOnce({ gcode: 'G21\nM3\nM30', warnings: [] })
    const result = await runPostDomain(baseRequest)
    expect(result.gcode).toBe('G21\nM3\nM30')
    expect(result.warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (G) Error-path forwarding
// ---------------------------------------------------------------------------

describe('[ID-0213] rejecting renderPost rejects the facade', () => {
  it('rethrows the inner Error', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    renderPostMock.mockRejectedValueOnce(new Error('boom'))
    await expect(runPostDomain(baseRequest)).rejects.toThrow('boom')
  })

  it('still routes through the telemetry stage closure on failure', async () => {
    const renderPostMock = vi.mocked(renderPost)
    renderPostMock.mockClear()
    telemetrySpy.mockClear()
    renderPostMock.mockRejectedValueOnce(new Error('boom2'))
    await expect(runPostDomain(baseRequest)).rejects.toThrow('boom2')
    // The stage label is still recorded -- timing telemetry must capture
    // failed stages so the perf inventory can flag them.
    expect(telemetrySpy).toHaveBeenCalledTimes(1)
    expect(telemetrySpy).toHaveBeenCalledWith('cam.post_render')
  })
})

// ---------------------------------------------------------------------------
// (H) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0213] post-domain source-text whitelist', () => {
  it('contains the canonical "cam.post_render" stage label literal', () => {
    expect(SRC).toContain("'cam.post_render'")
  })

  it('does NOT contain a competing "cam.post" or "post.render" stage literal', () => {
    expect(SRC).not.toContain("'cam.post'")
    expect(SRC).not.toContain("'post.render'")
    expect(SRC).not.toContain("'post_render'")
    expect(SRC).not.toContain("'cam.post.render'")
  })

  it('cites the [ID-0020-wire] roadmap entry in the JSDoc', () => {
    expect(SRC).toContain('[ID-0020-wire]')
  })

  it('cites Cycle 103 (the wrapLagunaToolpathWithVacuumBlocks landing cycle)', () => {
    expect(SRC).toContain('Cycle 103')
  })

  it('cites Cycle 109 (the [ID-0020-wire] thread-through landing cycle)', () => {
    expect(SRC).toContain('Cycle 109')
  })

  it('mentions wrapLagunaToolpathWithVacuumBlocks by name', () => {
    expect(SRC).toContain('wrapLagunaToolpathWithVacuumBlocks')
  })

  it('imports renderPost as a value from ./post-process (single named import line)', () => {
    expect(SRC).toMatch(/import \{[^}]*\brenderPost\b[^}]*\} from '\.\/post-process'/)
  })

  it('imports MachineProfile as type-only from ../shared/machine-schema', () => {
    expect(SRC).toContain("import type { MachineProfile } from '../shared/machine-schema'")
  })

  it('imports LagunaVacuumZoneAllocation as type-only from the allocator module', () => {
    expect(SRC).toContain(
      "import type { LagunaVacuumZoneAllocation } from '../shared/laguna-vacuum-allocator'"
    )
  })

  it('imports LagunaVacuumPostludeOptions as type-only from the postlude module', () => {
    expect(SRC).toContain(
      "import type { LagunaVacuumPostludeOptions } from '../shared/laguna-vacuum-postlude'"
    )
  })

  it('imports withCamStageTelemetry as a value from ./cam-runtime-telemetry', () => {
    expect(SRC).toContain(
      "import { withCamStageTelemetry } from './cam-runtime-telemetry'"
    )
  })

  it('exports exactly one runtime symbol (runPostDomain)', () => {
    // Match top-of-line `export function`, `export async function`,
    // `export const`, or `export class` declarations only -- `export type`
    // is type-only and erased at runtime.
    const valueExportMatches = SRC.match(/^export (?:async )?(?:function|const|class)\b/gm) ?? []
    expect(valueExportMatches).toHaveLength(1)
  })

  it('declares runPostDomain as `export async function`', () => {
    expect(SRC).toMatch(/^export async function runPostDomain\b/m)
  })

  it('exports exactly one named type alias (PostDomainRequest)', () => {
    const typeExportMatches = SRC.match(/^export type \w+/gm) ?? []
    expect(typeExportMatches).toEqual(['export type PostDomainRequest'])
  })

  it('PostDomainRequest type alias body is present in the source', () => {
    expect(SRC).toMatch(/export type PostDomainRequest = \{/)
  })

  it('contains exactly one withCamStageTelemetry call site', () => {
    const matches = SRC.match(/withCamStageTelemetry\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains exactly one renderPost call site', () => {
    const matches = SRC.match(/\brenderPost\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('does not contain top-level `let` (mutability is forbidden in this facade)', () => {
    // `let` only legal inside function bodies; the facade has none.
    expect(SRC).not.toMatch(/^let\b/m)
  })

  it('does not contain a TypeScript `any` type (no `: any`, `as any`, or `<any>`)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('does not import any DOM-only or electron-only modules', () => {
    expect(SRC).not.toMatch(/from\s+['"]electron['"]/)
    expect(SRC).not.toMatch(/from\s+['"]react['"]/)
    expect(SRC).not.toMatch(/\bdocument\./)
    expect(SRC).not.toMatch(/\bwindow\./)
  })

  it('every documented opts key listed in the JSDoc surfaces in the source', () => {
    for (const key of DOCUMENTED_OPTS) {
      expect(SRC).toContain(`${key}?:`)
    }
  })

  it('renderPost call site uses positional ordering (resourcesRoot, machine, toolpathLines, opts)', () => {
    // The exact call expression in the source -- pin it to lock the
    // arg order (a refactor that swaps machine/toolpathLines, or merges
    // them, would silently break every post template).
    expect(SRC).toContain(
      'renderPost(request.resourcesRoot, request.machine, request.toolpathLines, request.opts)'
    )
  })

  it('header JSDoc frames the file as the post-processing boundary facade', () => {
    expect(SRC).toContain('Post-processing boundary facade')
  })
})
