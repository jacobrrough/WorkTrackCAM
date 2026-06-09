/**
 * Unit tests for `src/main/ipc-cad.ts` -- the TS IPC layer for the new
 * parametric CAD Design workspace (BUILD 2). Covers:
 *
 *   A. Handler-shape pin -- the three documented channels
 *      (`cad:execute`, `cad:export`, `cad:listOperations`) MUST be
 *      registered. Mirrors the pin in `ipc-modeling.test.ts`.
 *   B. Validator coverage -- pure-function units for the three
 *      `validate*Payload` helpers exercise the documented error paths
 *      (missing fields, null-byte in outPath, oversized scripts, bad
 *      `buildParameters` shapes, unknown format).
 *   C. Bridge-error mapping -- `mapBridgeError` translates every
 *      `PythonBridgeError` code into a deterministic `{ error, hint }`
 *      envelope. The renderer keys off `error`, so drift here is a
 *      contract break.
 *   D. Result coercion -- malformed sidecar responses are scrubbed
 *      (defense-in-depth) instead of being passed through to the
 *      renderer as `undefined`.
 *
 * NOT covered here:
 *   - End-to-end sidecar round-trip. That lives in `cad-import-step.test.ts`
 *     style sidecar tests and will be added by the BUILD 3 follow-up that
 *     wires the Python handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track ipcMain registrations so we can pin the channel list.
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app')
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [], pythonPath: 'python' })
}))

// Mock the PythonBridge so unit tests never spawn a real sidecar. The
// `vi.mock` factory is hoisted ABOVE module imports, so we cannot capture
// `vi.fn()` instances in module-scope `const`s -- they would not exist yet.
// Instead the factory creates fresh mocks every test run, and we recover
// the handles via `vi.mocked(...)` inside `beforeEach`.
vi.mock('./sidecar/python-bridge', () => {
  const bridgeCall = vi.fn()
  const bridgeStop = vi.fn().mockResolvedValue(undefined)
  const bridgeStart = vi.fn(() => ({ call: bridgeCall, stop: bridgeStop }))
  return {
    PythonBridge: { start: bridgeStart },
    // Test-only exports so the test file can grab the same mock instances
    // the production code is actually calling.
    __mocks: { bridgeCall, bridgeStop, bridgeStart }
  }
})

import {
  CAD_DRAWING_EXPORT_FORMATS,
  CAD_EXPORT_FORMATS,
  CAD_SCRIPT_MAX_BYTES,
  coerceCreateAssemblyResult,
  coerceExecuteResult,
  coerceListOperationsResult,
  coerceProjectDrawingResult,
  coerceSolveSketchResult,
  coerceTessellateAssemblyResult,
  coerceTessellateWithIdsResult,
  mapBridgeError,
  registerCadIpc,
  validateCreateAssemblyPayload,
  validateExecutePayload,
  validateExportAssemblyPayload,
  validateExportDrawingPayload,
  validateExportPayload,
  validateListOperationsPayload,
  validateProjectDrawingPayload,
  validateSolveSketchPayload,
  validateTessellateAssemblyPayload,
  validateTessellateWithIdsPayload,
  v15ValidateAnnotateGdtPayload,
  v15ValidateGdtFrame,
  v15CoerceAnnotateGdtResult,
  v15ValidateDetailDrawingPayload,
  v15CoerceDetailDrawingResult,
  v15ValidateSectionDrawingPayload,
  V15_GDT_CHARACTERISTICS,
  type CadCreateAssemblyResponse,
  type CadExecuteResponse,
  type CadExportAssemblyResponse,
  type CadExportDrawingResponse,
  type CadExportResponse,
  type CadListOperationsResponse,
  type CadProjectDrawingResponse,
  type CadSolveSketchResponse,
  type CadTessellateAssemblyResponse,
  type CadTessellateWithIdsResponse
} from './ipc-cad'
import type { MainIpcWindowContext } from './ipc-context'
import * as pythonBridgeModule from './sidecar/python-bridge'

// Re-expose the mocked PythonBridge handles for per-test scripting. The
// `__mocks` field is injected by the `vi.mock` factory above.
const bridgeMocks = (
  pythonBridgeModule as unknown as {
    __mocks: { bridgeCall: ReturnType<typeof vi.fn>; bridgeStop: ReturnType<typeof vi.fn>; bridgeStart: ReturnType<typeof vi.fn> }
  }
).__mocks
const bridgeCallMock = bridgeMocks.bridgeCall
const bridgeStopMock = bridgeMocks.bridgeStop
const bridgeStartMock = bridgeMocks.bridgeStart

function createMockContext(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

beforeEach(() => {
  handlers.clear()
  bridgeCallMock.mockReset()
  bridgeStopMock.mockReset().mockResolvedValue(undefined)
  bridgeStartMock.mockClear()
})

// ── A. Handler-shape pin ────────────────────────────────────────────────────

describe('registerCadIpc', () => {
  it('registers the ten documented CAD channels', () => {
    registerCadIpc(createMockContext())
    for (const ch of [
      'cad:execute',
      'cad:export',
      'cad:listOperations',
      'cad:tessellateWithIds',
      'cad:solveSketch',
      // CAD V2 assembly + drawing channels (parallel work).
      'cad:createAssembly',
      'cad:tessellateAssembly',
      'cad:exportAssembly',
      'cad:projectDrawing',
      'cad:exportDrawing'
    ]) {
      expect(handlers.has(ch), `missing handler for channel "${ch}"`).toBe(true)
    }
  })

  it('exports the canonical format whitelist', () => {
    // Pin: the format whitelist drives the renderer's "Export" dropdown.
    // If a format is added without UI work, the dropdown desyncs.
    expect([...CAD_EXPORT_FORMATS].sort()).toEqual(['dxf', 'step', 'stl'])
  })

  it('exposes a 100 KB script length cap', () => {
    expect(CAD_SCRIPT_MAX_BYTES).toBe(100 * 1024)
  })

  it('exposes the drawing-export format whitelist (pdf / dxf only)', () => {
    // CAD V2 drawing exports are 2D documentation -- STEP/STL are 3D-only.
    expect([...CAD_DRAWING_EXPORT_FORMATS].sort()).toEqual(['dxf', 'pdf'])
  })
})

// ── B. Validator coverage ───────────────────────────────────────────────────

describe('validateExecutePayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateExecutePayload(null) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing script', () => {
    const r = validateExecutePayload({}) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_script')
  })

  it('rejects empty-string script', () => {
    const r = validateExecutePayload({ script: '' }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_script')
  })

  it('rejects oversized scripts', () => {
    const big = 'x'.repeat(CAD_SCRIPT_MAX_BYTES + 1)
    const r = validateExecutePayload({ script: big }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('script_too_large')
  })

  it('accepts a minimal valid script', () => {
    const r = validateExecutePayload({ script: 'import cadquery as cq' })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.script).toBe('import cadquery as cq')
      expect(r.payload.buildParameters).toBeUndefined()
    }
  })

  it('passes through scalar buildParameters values', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: { width: 10, debug: true, label: 'top' }
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.buildParameters).toEqual({ width: 10, debug: true, label: 'top' })
    }
  })

  it('rejects non-finite numeric buildParameters', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: { width: Number.POSITIVE_INFINITY }
    }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_build_parameters')
  })

  it('rejects nested objects in buildParameters', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: { box: { x: 1 } }
    }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_build_parameters')
  })

  it('rejects array buildParameters', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: [1, 2, 3]
    }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_build_parameters')
  })
})

describe('validateExportPayload', () => {
  it('rejects missing fields', () => {
    const noHandle = validateExportPayload({ outPath: '/a/b.stl', format: 'stl' }) as CadExportResponse
    expect(noHandle.ok).toBe(false)
    if (!noHandle.ok) expect(noHandle.error).toBe('missing_handle')

    const noOut = validateExportPayload({ handle: 'h1', format: 'stl' }) as CadExportResponse
    expect(noOut.ok).toBe(false)
    if (!noOut.ok) expect(noOut.error).toBe('missing_out_path')

    const noFormat = validateExportPayload({ handle: 'h1', outPath: '/a/b.stl' }) as CadExportResponse
    expect(noFormat.ok).toBe(false)
    if (!noFormat.ok) expect(noFormat.error).toBe('invalid_format')
  })

  it('rejects null-byte in outPath', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b\0.stl',
      format: 'stl'
    }) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
  })

  it('rejects unknown format', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b.iges',
      format: 'iges'
    }) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_format')
  })

  it('rejects non-positive toleranceMm', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b.stl',
      format: 'stl',
      toleranceMm: 0
    }) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_tolerance')
  })

  it('accepts each whitelisted format', () => {
    for (const fmt of CAD_EXPORT_FORMATS) {
      const r = validateExportPayload({ handle: 'h1', outPath: `/a/b.${fmt}`, format: fmt })
      expect('payload' in r, `expected ok for format=${fmt}`).toBe(true)
      if ('payload' in r) expect(r.payload.format).toBe(fmt)
    }
  })

  it('round-trips an explicit toleranceMm', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b.stl',
      format: 'stl',
      toleranceMm: 0.05
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) expect(r.payload.toleranceMm).toBe(0.05)
  })
})

describe('validateListOperationsPayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateListOperationsPayload(null) as CadListOperationsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing script', () => {
    const r = validateListOperationsPayload({}) as CadListOperationsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_script')
  })

  it('rejects oversized script', () => {
    const big = 'x'.repeat(CAD_SCRIPT_MAX_BYTES + 1)
    const r = validateListOperationsPayload({ script: big }) as CadListOperationsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('script_too_large')
  })

  it('accepts a minimal valid payload', () => {
    const r = validateListOperationsPayload({ script: 'pass' })
    expect('payload' in r).toBe(true)
    if ('payload' in r) expect(r.payload.script).toBe('pass')
  })
})

// ── C. Bridge-error mapping pin ─────────────────────────────────────────────

describe('mapBridgeError', () => {
  it('maps python_spawn_failed to a Settings-Paths hint', () => {
    const r = mapBridgeError({ code: 'python_spawn_failed', message: 'ENOENT' })
    expect(r.error).toBe('python_spawn_failed')
    expect(r.hint.length).toBeGreaterThan(0)
  })

  it('maps bridge_closed to sidecar_closed', () => {
    const r = mapBridgeError({ code: 'bridge_closed', message: 'child exited' })
    expect(r.error).toBe('sidecar_closed')
  })

  it('maps bridge_timeout to sidecar_timeout', () => {
    const r = mapBridgeError({ code: 'bridge_timeout', message: 'after 5000ms' })
    expect(r.error).toBe('sidecar_timeout')
  })

  it('passes through structured sidecar error codes', () => {
    const r = mapBridgeError({
      code: 'sidecar_error',
      message: 'unsafe import',
      sidecarCode: 'unsafe_script'
    })
    expect(r.error).toBe('unsafe_script')
    expect(r.hint).toBe('unsafe import')
  })

  it('maps bad_response to sidecar_protocol_error', () => {
    const r = mapBridgeError({ code: 'bad_response', message: 'invalid json' })
    expect(r.error).toBe('sidecar_protocol_error')
  })
})

// ── D. Result coercion ──────────────────────────────────────────────────────

describe('coerceExecuteResult', () => {
  it('drops malformed mesh entries', () => {
    const r = coerceExecuteResult({
      meshes: [
        { handle: 'h1', stlPath: '/a/b.stl', triangleCount: 12, bbox: { min: [0, 0, 0], max: [1, 1, 1] } },
        { handle: 'missing-fields' },
        null,
        42
      ],
      faceCount: 6,
      log: ['line one', 'line two', 99]
    })
    expect(r.meshes).toHaveLength(1)
    expect(r.meshes[0]?.handle).toBe('h1')
    expect(r.faceCount).toBe(6)
    expect(r.log).toEqual(['line one', 'line two'])
    expect(r.error).toBeUndefined()
  })

  it('preserves a structured error envelope', () => {
    const r = coerceExecuteResult({
      meshes: [],
      faceCount: 0,
      log: [],
      error: { code: 'unsafe_script', message: 'banned token: __import__' }
    })
    expect(r.error?.code).toBe('unsafe_script')
  })

  it('defaults non-finite faceCount to 0', () => {
    const r = coerceExecuteResult({ meshes: [], faceCount: Number.NaN, log: [] })
    expect(r.faceCount).toBe(0)
  })
})

describe('coerceListOperationsResult', () => {
  it('drops malformed parameter / operation entries', () => {
    const r = coerceListOperationsResult({
      parameters: [
        { name: 'width', value: 10, kind: 'number' },
        { name: 'enabled', value: true, kind: 'boolean' },
        { name: 'bad', value: { nested: 1 }, kind: 'number' },
        null
      ],
      operations: [
        { index: 0, kind: 'workplane', line: 3, summary: 'XY' },
        { index: 1, kind: 'extrude', line: 7, summary: '10 mm', extra: 'ignored' },
        { kind: 'missing-index' }
      ]
    })
    expect(r.parameters.map((p) => p.name)).toEqual(['width', 'enabled'])
    expect(r.operations.map((o) => o.kind)).toEqual(['workplane', 'extrude'])
    expect(r.parseError).toBeUndefined()
  })

  it('passes through a parse error', () => {
    const r = coerceListOperationsResult({
      parameters: [],
      operations: [],
      parseError: { line: 4, message: 'unexpected EOF' }
    })
    expect(r.parseError?.line).toBe(4)
  })
})

// ── E. End-to-end IPC handler behavior with mocked sidecar ──────────────────

describe('cad:execute handler', () => {
  it('short-circuits on invalid payload BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    const r = (await handler({}, null)) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
    // No bridge spawned -- pure validation.
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('reports python_spawn_failed cleanly when the bridge cannot start', async () => {
    bridgeCallMock.mockRejectedValueOnce({ code: 'python_spawn_failed', message: 'ENOENT: python' })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    const r = (await handler({}, { script: 'pass' })) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('python_spawn_failed')
    expect(bridgeStopMock).toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.execute_script with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      meshes: [
        { handle: 'h1', stlPath: '/tmp/m.stl', triangleCount: 4, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }
      ],
      faceCount: 6,
      log: ['ok']
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    const r = (await handler(
      {},
      { script: 'cq.Workplane()', buildParameters: { w: 10 } }
    )) as CadExecuteResponse
    expect(r.ok).toBe(true)
    expect(bridgeCallMock).toHaveBeenCalledTimes(1)
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.execute_script')
    expect(paramsArg).toEqual({ script: 'cq.Workplane()', buildParameters: { w: 10 } })
  })

  it('omits buildParameters from the wire payload when not supplied', async () => {
    bridgeCallMock.mockResolvedValueOnce({ meshes: [], faceCount: 0, log: [] })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    await handler({}, { script: 'pass' })
    const [, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(paramsArg).toEqual({ script: 'pass' })
  })
})

describe('cad:export handler', () => {
  it('short-circuits on null-byte outPath', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:export')!
    const r = (await handler({}, {
      handle: 'h1',
      outPath: '/a/b\0.stl',
      format: 'stl'
    })) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.export with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({ outPath: '/a/b.stl', bytesWritten: 1234 })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:export')!
    const r = (await handler({}, {
      handle: 'h1',
      outPath: '/a/b.stl',
      format: 'stl',
      toleranceMm: 0.1
    })) as CadExportResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.outPath).toBe('/a/b.stl')
      expect(r.result.bytesWritten).toBe(1234)
    }
    const [methodArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.export')
  })

  it('translates sidecar invalid_handle error envelopes', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'not found',
      sidecarCode: 'invalid_handle'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:export')!
    const r = (await handler({}, {
      handle: 'stale',
      outPath: '/a/b.stl',
      format: 'stl'
    })) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_handle')
  })
})

describe('cad:listOperations handler', () => {
  it('dispatches valid payload to cad.list_operations with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      parameters: [{ name: 'w', value: 10, kind: 'number' }],
      operations: [{ index: 0, kind: 'workplane', line: 1, summary: 'XY' }]
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:listOperations')!
    const r = (await handler({}, { script: 'cq.Workplane()' })) as CadListOperationsResponse
    expect(r.ok).toBe(true)
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.list_operations')
    expect(paramsArg).toEqual({ script: 'cq.Workplane()' })
  })

  it('preserves a parseError from the sidecar', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      parameters: [],
      operations: [],
      parseError: { line: 3, message: 'invalid syntax' }
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:listOperations')!
    const r = (await handler({}, { script: 'broken script' })) as CadListOperationsResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.parseError?.line).toBe(3)
      expect(r.result.parameters).toEqual([])
    }
  })
})

// ── F. cad.tessellate_with_ids -- validator + coercer + handler ─────────────
//
// New selection-grade tessellator (CAD V1 selection foundation). The
// sidecar returns ``{ vertices, indices, faceIds, triangleCount, bbox,
// faceMap }``; the IPC layer enforces:
//   - `handle` is required at the boundary (no spawn until validated)
//   - `toleranceMm` is optional but typed (positive, finite) when present
//   - malformed sidecar envelopes coerce to `sidecar_protocol_error`
//   - the wire `cad.tessellate_with_ids` method name is the dispatch key

describe('validateTessellateWithIdsPayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateTessellateWithIdsPayload(null) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing handle', () => {
    const r = validateTessellateWithIdsPayload({}) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
  })

  it('rejects empty-string handle', () => {
    const r = validateTessellateWithIdsPayload({ handle: '' }) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
  })

  it('rejects non-positive toleranceMm', () => {
    const r = validateTessellateWithIdsPayload({
      handle: 'h1',
      toleranceMm: -0.001
    }) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_tolerance')

    const zero = validateTessellateWithIdsPayload({
      handle: 'h1',
      toleranceMm: 0
    }) as CadTessellateWithIdsResponse
    expect(zero.ok).toBe(false)
    if (!zero.ok) expect(zero.error).toBe('invalid_tolerance')
  })

  it('rejects non-finite toleranceMm', () => {
    const r = validateTessellateWithIdsPayload({
      handle: 'h1',
      toleranceMm: Number.NaN
    }) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_tolerance')
  })

  it('accepts a minimal handle-only payload', () => {
    const r = validateTessellateWithIdsPayload({ handle: 'h1' })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.handle).toBe('h1')
      expect(r.payload.toleranceMm).toBeUndefined()
    }
  })

  it('round-trips an explicit toleranceMm', () => {
    const r = validateTessellateWithIdsPayload({ handle: 'h1', toleranceMm: 0.05 })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.toleranceMm).toBe(0.05)
    }
  })
})

describe('coerceTessellateWithIdsResult', () => {
  function validResultRaw(): Record<string, unknown> {
    return {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      faceIds: [3],
      triangleCount: 1,
      bbox: { min: [0, 0, 0], max: [1, 1, 0] },
      faceMap: { '3': { kind: 'face', occtHash: 12345, area: 0.5 } }
    }
  }

  it('returns null when vertices array is missing', () => {
    const raw = validResultRaw()
    delete raw.vertices
    expect(coerceTessellateWithIdsResult(raw)).toBeNull()
  })

  it('returns null when indices array is missing', () => {
    const raw = validResultRaw()
    delete raw.indices
    expect(coerceTessellateWithIdsResult(raw)).toBeNull()
  })

  it('returns null when faceIds array is missing', () => {
    const raw = validResultRaw()
    delete raw.faceIds
    expect(coerceTessellateWithIdsResult(raw)).toBeNull()
  })

  it('returns null when bbox is malformed', () => {
    const raw = validResultRaw()
    raw.bbox = { min: [0, 0], max: [1, 1, 1] } // wrong arity
    expect(coerceTessellateWithIdsResult(raw)).toBeNull()
  })

  it('preserves the mesh buffers and integer face ids', () => {
    const r = coerceTessellateWithIdsResult(validResultRaw())
    expect(r).not.toBeNull()
    expect(r?.vertices).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(r?.indices).toEqual([0, 1, 2])
    expect(r?.faceIds).toEqual([3])
    expect(r?.triangleCount).toBe(1)
    expect(r?.faceMap['3']?.occtHash).toBe(12345)
    expect(r?.faceMap['3']?.area).toBe(0.5)
  })

  it('replaces non-integer / negative face ids with -1 sentinel', () => {
    const raw = validResultRaw()
    raw.faceIds = [0, 1.5, -1, Number.NaN, 4]
    raw.indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6]
    raw.triangleCount = 5
    const r = coerceTessellateWithIdsResult(raw)
    expect(r).not.toBeNull()
    expect(r?.faceIds).toEqual([0, -1, -1, -1, 4])
  })

  it('drops malformed faceMap entries (wrong kind / missing occtHash)', () => {
    const raw = validResultRaw()
    raw.faceMap = {
      '0': { kind: 'face', occtHash: 100 },
      '1': { kind: 'edge', occtHash: 200 }, // wrong kind
      '2': { kind: 'face' }, // missing occtHash
      '3': null
    }
    const r = coerceTessellateWithIdsResult(raw)
    expect(r).not.toBeNull()
    expect(Object.keys(r?.faceMap ?? {}).sort()).toEqual(['0'])
  })

  it('falls back to faceIds.length when triangleCount is missing', () => {
    const raw = validResultRaw()
    raw.faceIds = [0, 1, 2, 3]
    delete raw.triangleCount
    const r = coerceTessellateWithIdsResult(raw)
    expect(r?.triangleCount).toBe(4)
  })

  // --- FG-5b: occtId on faces + the new edgeMap ---

  it('carries the stable occtId on a faceMap entry when present', () => {
    const raw = validResultRaw()
    raw.faceMap = { '3': { kind: 'face', occtHash: 0, occtId: 'f:abc123', area: 0.5 } }
    const r = coerceTessellateWithIdsResult(raw)
    expect(r?.faceMap['3']?.occtId).toBe('f:abc123')
  })

  it('coerces the edgeMap and drops malformed edge entries', () => {
    const raw = validResultRaw()
    raw.edgeMap = {
      'e:aaa': { kind: 'edge', occtId: 'e:aaa', occtHash: 0, length: 10 },
      'e:bbb': { kind: 'face', occtId: 'e:bbb', occtHash: 0, length: 5 }, // wrong kind
      'e:ccc': { kind: 'edge', occtHash: 0, length: 5 }, // missing occtId
      'e:ddd': null
    }
    const r = coerceTessellateWithIdsResult(raw)
    expect(Object.keys(r?.edgeMap ?? {}).sort()).toEqual(['e:aaa'])
    expect(r?.edgeMap['e:aaa']?.length).toBe(10)
  })

  it('defaults edgeMap to an empty object when the sidecar omits it', () => {
    const r = coerceTessellateWithIdsResult(validResultRaw())
    expect(r?.edgeMap).toEqual({})
  })

  // --- FG-5: per-edge polyline list (viewport edge picking) ---

  it('coerces the edges polyline list and drops malformed polylines', () => {
    const raw = validResultRaw()
    raw.edges = [
      { id: 'e:aaa', points: [[0, 0, 0], [10, 0, 0]] },
      { id: '', points: [[0, 0, 0], [1, 0, 0]] }, // empty id → drop
      { id: 'e:short', points: [[0, 0, 0]] }, // < 2 points → drop
      { id: 'e:nan', points: [[0, 0, 0], [Number.NaN, 0, 0]] }, // non-finite → drop
      { id: 'e:bad', points: [[0, 0], [1, 1]] }, // wrong arity → drop
      null
    ]
    const r = coerceTessellateWithIdsResult(raw)
    expect(r?.edges).toHaveLength(1)
    expect(r?.edges[0].id).toBe('e:aaa')
    expect(r?.edges[0].points).toEqual([[0, 0, 0], [10, 0, 0]])
  })

  it('defaults edges to an empty array when the sidecar omits it', () => {
    const r = coerceTessellateWithIdsResult(validResultRaw())
    expect(r?.edges).toEqual([])
  })
})

describe('cad:tessellateWithIds handler', () => {
  function validBridgeResponse(): Record<string, unknown> {
    return {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      faceIds: [3],
      triangleCount: 1,
      bbox: { min: [0, 0, 0], max: [1, 1, 0] },
      faceMap: { '3': { kind: 'face', occtHash: 999, area: 0.5 } }
    }
  }

  it('short-circuits on missing handle BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateWithIds')!
    const r = (await handler({}, {})) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.tessellate_with_ids with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce(validBridgeResponse())
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateWithIds')!
    const r = (await handler({}, { handle: 'h1', toleranceMm: 0.05 })) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.vertices).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
      expect(r.result.faceIds).toEqual([3])
      expect(r.result.faceMap['3']?.occtHash).toBe(999)
    }
    expect(bridgeCallMock).toHaveBeenCalledTimes(1)
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.tessellate_with_ids')
    expect(paramsArg).toEqual({ handle: 'h1', toleranceMm: 0.05 })
  })

  it('omits toleranceMm from the wire payload when not supplied', async () => {
    bridgeCallMock.mockResolvedValueOnce(validBridgeResponse())
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateWithIds')!
    await handler({}, { handle: 'h1' })
    const [, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(paramsArg).toEqual({ handle: 'h1' })
  })

  it('translates sidecar invalid_handle error envelopes', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'handle not found',
      sidecarCode: 'invalid_handle'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateWithIds')!
    const r = (await handler({}, { handle: 'stale' })) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_handle')
    expect(bridgeStopMock).toHaveBeenCalled()
  })

  it('folds malformed sidecar responses into sidecar_protocol_error', async () => {
    // Sidecar drift: returns usable vertices but no faceIds key at all.
    const broken = validBridgeResponse()
    delete broken.faceIds
    bridgeCallMock.mockResolvedValueOnce(broken)
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateWithIds')!
    const r = (await handler({}, { handle: 'h1' })) as CadTessellateWithIdsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sidecar_protocol_error')
  })
})

// ── G. cad.solve_sketch -- validator + coercer + handler ────────────────────
//
// CAD V1 sketcher (Agent S1 sidecar method ``cad.solve_sketch``). The IPC
// layer enforces:
//   - ``sketch`` is an object at the boundary (no spawn until validated).
//   - ``constraints`` is an array at the boundary.
//   - malformed sidecar envelopes (missing ``points`` map) coerce to
//     ``sidecar_protocol_error``.
//   - the wire ``cad.solve_sketch`` method name is the dispatch key.

describe('validateSolveSketchPayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateSolveSketchPayload(null) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing sketch', () => {
    const r = validateSolveSketchPayload({ constraints: [] }) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_sketch')
  })

  it('rejects non-object sketch (array)', () => {
    const r = validateSolveSketchPayload({
      sketch: [],
      constraints: []
    }) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_sketch')
  })

  it('rejects missing constraints', () => {
    const r = validateSolveSketchPayload({
      sketch: { points: {} }
    }) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_constraints')
  })

  it('rejects non-array constraints', () => {
    const r = validateSolveSketchPayload({
      sketch: { points: {} },
      constraints: 'nope'
    }) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_constraints')
  })

  it('accepts a minimal valid payload (empty constraints allowed)', () => {
    const r = validateSolveSketchPayload({
      sketch: { points: { p1: { x: 0, y: 0 } } },
      constraints: []
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.sketch).toEqual({ points: { p1: { x: 0, y: 0 } } })
      expect(r.payload.constraints).toEqual([])
    }
  })

  it('round-trips a non-empty constraints array', () => {
    const cons = [{ id: 'c1', type: 'horizontal', a: { pointId: 'p1' }, b: { pointId: 'p2' } }]
    const r = validateSolveSketchPayload({
      sketch: { points: { p1: { x: 0, y: 0 }, p2: { x: 5, y: 1 } } },
      constraints: cons
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.constraints).toEqual(cons)
    }
  })
})

describe('coerceSolveSketchResult', () => {
  it('returns null when points map is missing', () => {
    expect(coerceSolveSketchResult({})).toBeNull()
  })

  it('returns null when points is an array', () => {
    expect(coerceSolveSketchResult({ points: [] })).toBeNull()
  })

  it('coerces a minimal valid points map', () => {
    const r = coerceSolveSketchResult({
      points: { p1: { x: 1.5, y: -2.25 }, p2: { x: 3, y: 4, fixed: true } }
    })
    expect(r).not.toBeNull()
    expect(r?.points.p1).toEqual({ x: 1.5, y: -2.25 })
    expect(r?.points.p2).toEqual({ x: 3, y: 4, fixed: true })
  })

  it('collapses malformed point entries to (0, 0)', () => {
    // Defense-in-depth: drop the key would cause coordinate drift in the
    // renderer's points dict; we keep the key with a deterministic value.
    const r = coerceSolveSketchResult({
      points: {
        good: { x: 1, y: 2 },
        broken: { x: 'nope', y: Number.NaN }
      }
    })
    expect(r).not.toBeNull()
    expect(r?.points.good).toEqual({ x: 1, y: 2 })
    expect(r?.points.broken).toEqual({ x: 0, y: 0 })
  })

  it('preserves optional residual / iterations / converged / log fields', () => {
    const r = coerceSolveSketchResult({
      points: { p1: { x: 0, y: 0 } },
      residual: 1e-9,
      iterations: 42,
      converged: true,
      log: ['solved in 42 iters', 99]
    })
    expect(r?.residual).toBe(1e-9)
    expect(r?.iterations).toBe(42)
    expect(r?.converged).toBe(true)
    expect(r?.log).toEqual(['solved in 42 iters'])
  })

  it('drops malformed optional fields silently', () => {
    const r = coerceSolveSketchResult({
      points: { p1: { x: 0, y: 0 } },
      residual: 'nope',
      iterations: -1,
      converged: 'truthy',
      log: 'not-an-array'
    })
    expect(r?.residual).toBeUndefined()
    expect(r?.iterations).toBeUndefined()
    expect(r?.converged).toBeUndefined()
    expect(r?.log).toBeUndefined()
  })
})

describe('cad:solveSketch handler', () => {
  function validSketchPayload(): { sketch: Record<string, unknown>; constraints: unknown[] } {
    return {
      sketch: { points: { p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 } }, parameters: {} },
      constraints: [
        { id: 'c1', type: 'horizontal', a: { pointId: 'p1' }, b: { pointId: 'p2' } }
      ]
    }
  }

  function validBridgeResponse(): Record<string, unknown> {
    return {
      points: { p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 } },
      residual: 0,
      iterations: 5,
      converged: true,
      log: ['converged at iter 5']
    }
  }

  it('short-circuits on invalid payload BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:solveSketch')!
    const r = (await handler({}, null)) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('short-circuits on missing sketch BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:solveSketch')!
    const r = (await handler({}, { constraints: [] })) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_sketch')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('short-circuits on missing constraints BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:solveSketch')!
    const r = (await handler({}, { sketch: { points: {} } })) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_constraints')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.solve_sketch with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce(validBridgeResponse())
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:solveSketch')!
    const payload = validSketchPayload()
    const r = (await handler({}, payload)) as CadSolveSketchResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.points.p2).toEqual({ x: 10, y: 0 })
      expect(r.result.iterations).toBe(5)
      expect(r.result.converged).toBe(true)
    }
    expect(bridgeCallMock).toHaveBeenCalledTimes(1)
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.solve_sketch')
    expect(paramsArg).toEqual({ sketch: payload.sketch, constraints: payload.constraints })
  })

  it('translates sidecar error envelopes to the documented error code', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'unknown point id',
      sidecarCode: 'invalid_constraint'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:solveSketch')!
    const r = (await handler({}, validSketchPayload())) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_constraint')
    expect(bridgeStopMock).toHaveBeenCalled()
  })

  it('folds malformed sidecar responses into sidecar_protocol_error', async () => {
    bridgeCallMock.mockResolvedValueOnce({ residual: 0 }) // no points key
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:solveSketch')!
    const r = (await handler({}, validSketchPayload())) as CadSolveSketchResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sidecar_protocol_error')
  })
})

// ── G. CAD V2 Assembly + Drawing IPC plumbing ──────────────────────────────
//
// Five new channels bridge the renderer's CAD V2 Assembly + Drawing views
// to the sidecar (Agents A1 + A2 own the Python). The IPC layer enforces
// envelope shape only -- payload bodies (the assembly tree, the sheet
// blob) are intentionally permissive ``Record<string, unknown>`` at the
// boundary; the sidecar owns the deep validation.
//
// What's pinned here
// ------------------
//   - Validator coverage for all 5 payloads (missing fields, null-byte
//     paths, unknown formats, non-positive tolerance).
//   - Result coercers drop malformed entries (defense-in-depth) rather
//     than letting ``undefined`` propagate.
//   - End-to-end handler behavior: handlers short-circuit BEFORE
//     spawning Python on invalid payloads; sidecar errors translate to
//     the documented error codes; wire method names are pinned.

describe('validateCreateAssemblyPayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateCreateAssemblyPayload(null) as CadCreateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing parts', () => {
    const r = validateCreateAssemblyPayload({}) as CadCreateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_parts')
  })

  it('rejects an empty parts array', () => {
    const r = validateCreateAssemblyPayload({ parts: [] }) as CadCreateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_parts')
  })

  it('accepts a minimal valid payload (parts list)', () => {
    const r = validateCreateAssemblyPayload({
      parts: [{ handle: 'script:abc', name: 'p0', transform: 'identity' }]
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.parts.length).toBe(1)
    }
  })
})

describe('validateTessellateAssemblyPayload', () => {
  it('rejects missing handle', () => {
    const r = validateTessellateAssemblyPayload({}) as CadTessellateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
  })

  it('rejects non-positive toleranceMm', () => {
    const r = validateTessellateAssemblyPayload({
      handle: 'asm-1',
      toleranceMm: -0.001
    }) as CadTessellateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_tolerance')
  })

  it('round-trips an explicit toleranceMm', () => {
    const r = validateTessellateAssemblyPayload({ handle: 'asm-1', toleranceMm: 0.05 })
    expect('payload' in r).toBe(true)
    if ('payload' in r) expect(r.payload.toleranceMm).toBe(0.05)
  })
})

describe('validateExportAssemblyPayload', () => {
  it('rejects missing handle / outPath / format', () => {
    const noHandle = validateExportAssemblyPayload({
      outPath: '/a/b.step',
      format: 'step'
    }) as CadExportAssemblyResponse
    expect(noHandle.ok).toBe(false)
    if (!noHandle.ok) expect(noHandle.error).toBe('missing_handle')

    const noOut = validateExportAssemblyPayload({
      handle: 'asm-1',
      format: 'step'
    }) as CadExportAssemblyResponse
    expect(noOut.ok).toBe(false)
    if (!noOut.ok) expect(noOut.error).toBe('missing_out_path')
  })

  it('rejects null-byte in outPath', () => {
    const r = validateExportAssemblyPayload({
      handle: 'asm-1',
      outPath: '/a/b\0.step',
      format: 'step'
    }) as CadExportAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
  })

  it('rejects dxf format (3D assembly must be step or stl)', () => {
    const r = validateExportAssemblyPayload({
      handle: 'asm-1',
      outPath: '/a/b.dxf',
      format: 'dxf'
    }) as CadExportAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_format')
  })

  it('accepts step + stl whitelist', () => {
    for (const fmt of ['step', 'stl'] as const) {
      const r = validateExportAssemblyPayload({
        handle: 'asm-1',
        outPath: `/a/b.${fmt}`,
        format: fmt
      })
      expect('payload' in r, `expected ok for format=${fmt}`).toBe(true)
      if ('payload' in r) expect(r.payload.format).toBe(fmt)
    }
  })
})

describe('validateProjectDrawingPayload', () => {
  it('rejects missing handle', () => {
    const r = validateProjectDrawingPayload({
      sheet: { id: 's1', name: 'Sheet 1' }
    }) as CadProjectDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
  })

  it('rejects missing sheet', () => {
    const r = validateProjectDrawingPayload({ handle: 'part-1' }) as CadProjectDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_sheet')
  })

  it('accepts a minimal valid payload', () => {
    const sheet = { id: 's1', name: 'Sheet 1', viewPlaceholders: [] }
    const r = validateProjectDrawingPayload({ handle: 'part-1', sheet })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.handle).toBe('part-1')
      expect(r.payload.sheet).toEqual(sheet)
    }
  })
})

describe('validateExportDrawingPayload', () => {
  it('rejects missing handle / outPath / format / sheet', () => {
    const r = validateExportDrawingPayload({}) as CadExportDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
  })

  it('rejects null-byte in outPath', () => {
    const r = validateExportDrawingPayload({
      handle: 'part-1',
      outPath: '/a/b\0.pdf',
      format: 'pdf',
      sheet: { id: 's1', name: 'Sheet 1' }
    }) as CadExportDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
  })

  it('rejects formats outside the drawing whitelist (pdf / dxf)', () => {
    const r = validateExportDrawingPayload({
      handle: 'part-1',
      outPath: '/a/b.step',
      format: 'step',
      sheet: { id: 's1', name: 'Sheet 1' }
    }) as CadExportDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_format')
  })

  it('accepts pdf + dxf', () => {
    for (const fmt of CAD_DRAWING_EXPORT_FORMATS) {
      const r = validateExportDrawingPayload({
        handle: 'part-1',
        outPath: `/a/b.${fmt}`,
        format: fmt,
        sheet: { id: 's1', name: 'Sheet 1' }
      })
      expect('payload' in r, `expected ok for format=${fmt}`).toBe(true)
      if ('payload' in r) expect(r.payload.format).toBe(fmt)
    }
  })
})

describe('coerceCreateAssemblyResult', () => {
  it('returns null on missing handle', () => {
    const r = coerceCreateAssemblyResult({
      bbox: { min: [0, 0, 0], max: [1, 1, 1] }
    })
    expect(r).toBeNull()
  })

  it('returns null on malformed bbox', () => {
    const r = coerceCreateAssemblyResult({
      handle: 'asm-1',
      bbox: { min: [0, 0], max: [1, 1] }
    })
    expect(r).toBeNull()
  })

  it('defaults non-integer instanceCount to 0', () => {
    const r = coerceCreateAssemblyResult({
      handle: 'asm-1',
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
      instanceCount: 'bogus'
    })
    expect(r?.instanceCount).toBe(0)
  })

  it('preserves a well-formed envelope', () => {
    const r = coerceCreateAssemblyResult({
      handle: 'asm-1',
      bbox: { min: [0, 0, 0], max: [10, 5, 2] },
      instanceCount: 3
    })
    expect(r?.handle).toBe('asm-1')
    expect(r?.instanceCount).toBe(3)
  })
})

describe('coerceTessellateAssemblyResult', () => {
  it('returns null when meshes is missing', () => {
    const r = coerceTessellateAssemblyResult({
      bbox: { min: [0, 0, 0], max: [1, 1, 1] }
    })
    expect(r).toBeNull()
  })

  it('drops malformed per-instance entries', () => {
    const r = coerceTessellateAssemblyResult({
      meshes: [
        {
          instanceId: 'i1',
          handle: 'h1',
          stlPath: '/tmp/i1.stl',
          triangleCount: 12,
          bbox: { min: [0, 0, 0], max: [1, 1, 1] }
        },
        { instanceId: 'broken' }, // missing fields
        null,
        42
      ],
      bbox: { min: [0, 0, 0], max: [1, 1, 1] }
    })
    expect(r?.meshes).toHaveLength(1)
    expect(r?.meshes[0]?.instanceId).toBe('i1')
  })
})

describe('coerceProjectDrawingResult', () => {
  it('returns null when views is missing', () => {
    expect(coerceProjectDrawingResult({})).toBeNull()
  })

  it('drops malformed segments inside a view', () => {
    const r = coerceProjectDrawingResult({
      views: [
        {
          placeholderId: 'top',
          segments: [
            [[0, 0], [1, 0]],
            [[0, 0]], // wrong arity
            'not a segment',
            [[0, 0], [Number.NaN, 0]] // NaN coord
          ],
          hiddenSegments: [],
          bbox: { min: [0, 0], max: [1, 1] }
        },
        // Drop this entry -- placeholder id is missing.
        {
          segments: [[[0, 0], [1, 0]]],
          hiddenSegments: [],
          bbox: { min: [0, 0], max: [1, 1] }
        }
      ]
    })
    expect(r?.views).toHaveLength(1)
    expect(r?.views[0]?.segments).toHaveLength(1)
  })

  it('passes through an optional log array', () => {
    const r = coerceProjectDrawingResult({
      views: [],
      log: ['fell back to tier B', 42, 'ok']
    })
    expect(r?.log).toEqual(['fell back to tier B', 'ok'])
  })
})

// ── End-to-end handler behavior for the 5 new channels ─────────────────────

describe('cad:createAssembly handler', () => {
  it('short-circuits on missing parts BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:createAssembly')!
    const r = (await handler({}, {})) as CadCreateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_parts')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.create_assembly', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      handle: 'asm-1',
      bbox: { min: [0, 0, 0], max: [10, 5, 2] },
      instanceCount: 4
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:createAssembly')!
    const parts = [{ handle: 'script:a', name: 'p0', transform: 'identity' }]
    const r = (await handler({}, { parts })) as CadCreateAssemblyResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.handle).toBe('asm-1')
      expect(r.result.instanceCount).toBe(4)
    }
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.create_assembly')
    expect(paramsArg).toEqual({ parts })
  })

  it('translates sidecar invalid_assembly error envelopes', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'instance references missing part',
      sidecarCode: 'invalid_assembly'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:createAssembly')!
    const r = (await handler(
      {},
      { parts: [{ handle: 'script:a', transform: 'identity' }] }
    )) as CadCreateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_assembly')
    expect(bridgeStopMock).toHaveBeenCalled()
  })

  it('folds malformed sidecar responses into sidecar_protocol_error', async () => {
    bridgeCallMock.mockResolvedValueOnce({ bbox: { min: [0, 0, 0], max: [1, 1, 1] } }) // no handle
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:createAssembly')!
    const r = (await handler(
      {},
      { parts: [{ handle: 'script:a', transform: 'identity' }] }
    )) as CadCreateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sidecar_protocol_error')
  })
})

describe('cad:tessellateAssembly handler', () => {
  it('short-circuits on missing handle BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateAssembly')!
    const r = (await handler({}, {})) as CadTessellateAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.tessellate_assembly with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      meshes: [
        {
          instanceId: 'i1',
          handle: 'h1',
          stlPath: '/tmp/i1.stl',
          triangleCount: 12,
          bbox: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      ],
      bbox: { min: [0, 0, 0], max: [1, 1, 1] }
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateAssembly')!
    const r = (await handler({}, { handle: 'asm-1', toleranceMm: 0.05 })) as CadTessellateAssemblyResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.meshes).toHaveLength(1)
      expect(r.result.meshes[0]?.instanceId).toBe('i1')
    }
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.tessellate_assembly')
    expect(paramsArg).toEqual({ handle: 'asm-1', toleranceMm: 0.05 })
  })

  it('omits toleranceMm from the wire payload when not supplied', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      meshes: [],
      bbox: { min: [0, 0, 0], max: [1, 1, 1] }
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:tessellateAssembly')!
    await handler({}, { handle: 'asm-1' })
    const [, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(paramsArg).toEqual({ handle: 'asm-1' })
  })
})

describe('cad:exportAssembly handler', () => {
  it('short-circuits on null-byte outPath BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:exportAssembly')!
    const r = (await handler({}, {
      handle: 'asm-1',
      outPath: '/a/b\0.step',
      format: 'step'
    })) as CadExportAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.export_assembly with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({ outPath: '/a/b.step', bytesWritten: 4096 })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:exportAssembly')!
    const r = (await handler({}, {
      handle: 'asm-1',
      outPath: '/a/b.step',
      format: 'step'
    })) as CadExportAssemblyResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.outPath).toBe('/a/b.step')
      expect(r.result.bytesWritten).toBe(4096)
    }
    const [methodArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.export_assembly')
  })

  it('translates sidecar invalid_handle error envelopes', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'no such assembly handle',
      sidecarCode: 'invalid_handle'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:exportAssembly')!
    const r = (await handler({}, {
      handle: 'stale',
      outPath: '/a/b.step',
      format: 'step'
    })) as CadExportAssemblyResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_handle')
  })
})

describe('cad:projectDrawing handler', () => {
  it('short-circuits on missing sheet BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:projectDrawing')!
    const r = (await handler({}, { handle: 'part-1' })) as CadProjectDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_sheet')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.project_drawing with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      views: [
        {
          placeholderId: 'top',
          segments: [[[0, 0], [10, 0]]],
          hiddenSegments: [],
          bbox: { min: [0, 0], max: [10, 0] }
        }
      ],
      log: ['ok']
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:projectDrawing')!
    const sheet = { id: 's1', name: 'Sheet 1', viewPlaceholders: [{ id: 'top', kind: 'base' }] }
    const r = (await handler({}, { handle: 'part-1', sheet })) as CadProjectDrawingResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.views).toHaveLength(1)
      expect(r.result.views[0]?.placeholderId).toBe('top')
    }
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.project_drawing')
    expect(paramsArg).toEqual({ handle: 'part-1', sheet })
  })

  it('folds malformed sidecar responses into sidecar_protocol_error', async () => {
    bridgeCallMock.mockResolvedValueOnce({ log: ['no views key'] })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:projectDrawing')!
    const r = (await handler({}, {
      handle: 'part-1',
      sheet: { id: 's1', name: 'Sheet 1' }
    })) as CadProjectDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('sidecar_protocol_error')
  })
})

describe('cad:exportDrawing handler', () => {
  it('short-circuits on unsupported format BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:exportDrawing')!
    const r = (await handler({}, {
      handle: 'part-1',
      outPath: '/a/b.stl',
      format: 'stl',
      sheet: { id: 's1', name: 'Sheet 1' }
    })) as CadExportDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_format')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.export_drawing with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({ outPath: '/a/b.pdf', bytesWritten: 8192 })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:exportDrawing')!
    const sheet = { id: 's1', name: 'Sheet 1', viewPlaceholders: [] }
    const r = (await handler({}, {
      handle: 'part-1',
      outPath: '/a/b.pdf',
      format: 'pdf',
      sheet
    })) as CadExportDrawingResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.outPath).toBe('/a/b.pdf')
      expect(r.result.bytesWritten).toBe(8192)
    }
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.export_drawing')
    expect(paramsArg).toEqual({ handle: 'part-1', outPath: '/a/b.pdf', format: 'pdf', sheet })
  })

  it('translates sidecar export errors', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'no view placeholders projected',
      sidecarCode: 'empty_drawing'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:exportDrawing')!
    const r = (await handler({}, {
      handle: 'part-1',
      outPath: '/a/b.pdf',
      format: 'pdf',
      sheet: { id: 's1', name: 'Sheet 1' }
    })) as CadExportDrawingResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('empty_drawing')
    expect(bridgeStopMock).toHaveBeenCalled()
  })
})

// ── CAD V1.5 (GD&T feature control frames) IPC validators + coercer ──────────
//
// Boundary-shape coverage for the cad:annotateGdt channel. The deep escaping /
// rendering guard lives in the Python pytest (test_gdt_datum_is_xml_escaped);
// these pins verify the TS boundary rejects malformed frames before they reach
// the wire and accepts a well-formed payload unchanged.

describe('V15_GDT_CHARACTERISTICS', () => {
  it('lists the 14 ASME Y14.5 characteristics', () => {
    expect(V15_GDT_CHARACTERISTICS).toHaveLength(14)
    expect(V15_GDT_CHARACTERISTICS).toContain('position')
    expect(V15_GDT_CHARACTERISTICS).toContain('total_runout')
  })
})

describe('v15ValidateGdtFrame', () => {
  it('rejects a non-object frame', () => {
    const r = v15ValidateGdtFrame(42, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_gdt_frame')
  })

  it('rejects an unknown characteristic', () => {
    const r = v15ValidateGdtFrame(
      { characteristic: 'bogus', toleranceMm: 0.1, placement: { x: 0, y: 0 } },
      0,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_gdt_frame')
  })

  it('rejects a negative tolerance', () => {
    const r = v15ValidateGdtFrame(
      { characteristic: 'flatness', toleranceMm: -0.01, placement: { x: 0, y: 0 } },
      0,
    )
    expect(r.ok).toBe(false)
  })

  it('rejects more than 3 datums', () => {
    const r = v15ValidateGdtFrame(
      {
        characteristic: 'position',
        toleranceMm: 0.1,
        datums: ['A', 'B', 'C', 'D'],
        placement: { x: 0, y: 0 },
      },
      0,
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a non-string datum', () => {
    const r = v15ValidateGdtFrame(
      {
        characteristic: 'position',
        toleranceMm: 0.1,
        datums: ['A', 5],
        placement: { x: 0, y: 0 },
      },
      0,
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a malformed placement', () => {
    const r = v15ValidateGdtFrame(
      { characteristic: 'position', toleranceMm: 0.1, placement: { x: 'nope', y: 0 } },
      0,
    )
    expect(r.ok).toBe(false)
  })

  it('accepts a well-formed frame and normalizes datums/label', () => {
    const r = v15ValidateGdtFrame(
      {
        characteristic: 'position',
        toleranceMm: 0.1,
        datums: ['A', 'B'],
        placement: { x: 10, y: 12 },
        label: 'DATUM TARGET',
      },
      0,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.characteristic).toBe('position')
      expect(r.value.toleranceMm).toBe(0.1)
      expect(r.value.datums).toEqual(['A', 'B'])
      expect(r.value.placement).toEqual({ x: 10, y: 12 })
      expect(r.value.label).toBe('DATUM TARGET')
    }
  })

  it('accepts a frame with no datums (omits the key)', () => {
    const r = v15ValidateGdtFrame(
      { characteristic: 'straightness', toleranceMm: 0.05, placement: { x: 0, y: 0 } },
      0,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.datums).toBeUndefined()
  })
})

describe('v15ValidateAnnotateGdtPayload', () => {
  it('rejects a non-object payload', () => {
    const r = v15ValidateAnnotateGdtPayload(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects an empty svg', () => {
    const r = v15ValidateAnnotateGdtPayload({ svg: '', frames: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_svg')
  })

  it('rejects a non-array frames', () => {
    const r = v15ValidateAnnotateGdtPayload({ svg: '<svg></svg>', frames: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_frames')
  })

  it('propagates a per-frame validation error', () => {
    const r = v15ValidateAnnotateGdtPayload({
      svg: '<svg></svg>',
      frames: [{ characteristic: 'nope', toleranceMm: 0.1, placement: { x: 0, y: 0 } }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_gdt_frame')
  })

  it('accepts an empty frames array (layer-off round trip)', () => {
    const r = v15ValidateAnnotateGdtPayload({ svg: '<svg></svg>', frames: [] })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.svg).toBe('<svg></svg>')
      expect(r.payload.frames).toEqual([])
    }
  })

  it('accepts a well-formed payload', () => {
    const r = v15ValidateAnnotateGdtPayload({
      svg: '<svg></svg>',
      frames: [
        { characteristic: 'position', toleranceMm: 0.1, datums: ['A'], placement: { x: 5, y: 5 } },
      ],
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.frames).toHaveLength(1)
      expect(r.payload.frames[0].characteristic).toBe('position')
    }
  })
})

describe('v15CoerceAnnotateGdtResult', () => {
  it('returns null when svg is missing', () => {
    expect(v15CoerceAnnotateGdtResult({ bytes: 10, frameCount: 1 })).toBeNull()
  })

  it('coerces a well-formed result', () => {
    const out = v15CoerceAnnotateGdtResult({ svg: '<svg/>', bytes: 6, frameCount: 2 })
    expect(out).not.toBeNull()
    expect(out?.svg).toBe('<svg/>')
    expect(out?.bytes).toBe(6)
    expect(out?.frameCount).toBe(2)
  })

  it('recomputes bytes when absent and clamps a bad frameCount to 0', () => {
    const out = v15CoerceAnnotateGdtResult({ svg: '<svg/>', frameCount: -3 })
    expect(out).not.toBeNull()
    expect(out?.bytes).toBe(Buffer.byteLength('<svg/>', 'utf8'))
    expect(out?.frameCount).toBe(0)
  })
})

// Boundary-shape coverage for the cad:sectionDrawing channel's NEW optional
// `label` forwarding. The label is additive operator free-text the renderer's
// Section control threads through; the sidecar normalizes + entity-escapes it
// (Safety Rule 4 — verified in test_v15_section_label_is_xml_escaped). These
// pins assert the TS boundary forwards a string label and rejects a non-string.
describe('v15ValidateSectionDrawingPayload — section label forwarding', () => {
  const goodPlane = { axis: 'z', offset: 0, keepSide: 'positive' }

  it('omits the label key when not supplied (default A-A path preserved)', () => {
    const r = v15ValidateSectionDrawingPayload({ handle: 'body:1', view: 'front', plane: goodPlane })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect('label' in r.payload).toBe(false)
    }
  })

  it('forwards a string label verbatim (sidecar escapes it)', () => {
    const r = v15ValidateSectionDrawingPayload({
      handle: 'body:1',
      view: 'front',
      plane: goodPlane,
      label: '</text><script>alert(1)</script>',
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      // Boundary passes the raw string through; the sidecar is the escaping site.
      expect(r.payload.label).toBe('</text><script>alert(1)</script>')
    }
  })

  it('rejects a non-string label', () => {
    const r = v15ValidateSectionDrawingPayload({
      handle: 'body:1',
      view: 'front',
      plane: goodPlane,
      label: 42,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_label')
  })
})

// Boundary-shape coverage for the cad:detailDrawing channel. The deep crop /
// scaled-viewBox / escaping guards live in the Python pytest
// (test_detail_drawing_returns_scaled_viewbox / _label_is_xml_escaped); these
// pins verify the TS boundary rejects a malformed crop before it reaches the
// wire and accepts a well-formed payload unchanged.

describe('v15ValidateDetailDrawingPayload', () => {
  const goodCenter = { x: 100, y: 80 }

  it('rejects a non-object payload', () => {
    const r = v15ValidateDetailDrawingPayload(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects a missing handle', () => {
    const r = v15ValidateDetailDrawingPayload({ view: 'front', center: goodCenter, radiusMm: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_handle')
  })

  it('rejects an unknown view', () => {
    const r = v15ValidateDetailDrawingPayload({
      handle: 'body:1',
      view: 'fornt',
      center: goodCenter,
      radiusMm: 5,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_view')
  })

  it('rejects a malformed center', () => {
    const r = v15ValidateDetailDrawingPayload({
      handle: 'body:1',
      view: 'front',
      center: { x: 'nope', y: 0 },
      radiusMm: 5,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a non-positive radius', () => {
    for (const radiusMm of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = v15ValidateDetailDrawingPayload({
        handle: 'body:1',
        view: 'front',
        center: goodCenter,
        radiusMm,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('invalid_radius')
    }
  })

  it('rejects a non-positive scale when provided', () => {
    const r = v15ValidateDetailDrawingPayload({
      handle: 'body:1',
      view: 'front',
      center: goodCenter,
      radiusMm: 5,
      scale: -2,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_scale')
  })

  it('rejects a non-string label when provided', () => {
    const r = v15ValidateDetailDrawingPayload({
      handle: 'body:1',
      view: 'front',
      center: goodCenter,
      radiusMm: 5,
      label: 42,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_label')
  })

  it('accepts a minimal payload and omits optional scale/label keys', () => {
    const r = v15ValidateDetailDrawingPayload({
      handle: 'body:1',
      view: 'top',
      center: goodCenter,
      radiusMm: 12.5,
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.handle).toBe('body:1')
      expect(r.payload.view).toBe('top')
      expect(r.payload.center).toEqual(goodCenter)
      expect(r.payload.radiusMm).toBe(12.5)
      expect(r.payload.scale).toBeUndefined()
      expect(r.payload.label).toBeUndefined()
    }
  })

  it('accepts a full payload (scale + label)', () => {
    const r = v15ValidateDetailDrawingPayload({
      handle: 'body:1',
      view: 'front',
      center: goodCenter,
      radiusMm: 8,
      scale: 2,
      label: 'DETAIL A',
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.scale).toBe(2)
      expect(r.payload.label).toBe('DETAIL A')
    }
  })
})

describe('v15CoerceDetailDrawingResult', () => {
  it('returns null when svg is missing', () => {
    expect(
      v15CoerceDetailDrawingResult({ view: 'front', center: { x: 0, y: 0 }, radiusMm: 5 }),
    ).toBeNull()
  })

  it('returns null when view is unknown', () => {
    expect(
      v15CoerceDetailDrawingResult({
        svg: '<svg/>',
        view: 'fornt',
        center: { x: 0, y: 0 },
        radiusMm: 5,
      }),
    ).toBeNull()
  })

  it('returns null when center is malformed', () => {
    expect(
      v15CoerceDetailDrawingResult({
        svg: '<svg/>',
        view: 'front',
        center: { x: 0 },
        radiusMm: 5,
      }),
    ).toBeNull()
  })

  it('coerces a well-formed result and echoes the escaped label', () => {
    const out = v15CoerceDetailDrawingResult({
      svg: '<svg/>',
      view: 'front',
      bytes: 6,
      center: { x: 100, y: 80 },
      radiusMm: 40,
      scale: 2,
      label: '&lt;script&gt;',
    })
    expect(out).not.toBeNull()
    expect(out?.svg).toBe('<svg/>')
    expect(out?.view).toBe('front')
    expect(out?.center).toEqual({ x: 100, y: 80 })
    expect(out?.radiusMm).toBe(40)
    expect(out?.scale).toBe(2)
    expect(out?.label).toBe('&lt;script&gt;')
  })

  it('defaults scale to 2, recomputes bytes, and empties a missing label', () => {
    const out = v15CoerceDetailDrawingResult({
      svg: '<svg/>',
      view: 'top',
      center: { x: 1, y: 2 },
      radiusMm: 10,
    })
    expect(out).not.toBeNull()
    expect(out?.scale).toBe(2)
    expect(out?.bytes).toBe(Buffer.byteLength('<svg/>', 'utf8'))
    expect(out?.label).toBe('')
  })
})
